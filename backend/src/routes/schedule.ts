import { NextResponse } from "next/server";
import { adminDb } from "@backend/firebase/admin";
import { getSessionUid } from "@backend/firebase/serverAuth";
import { fromFirestoreData, toFirestoreData } from "@/lib/firebase/converters";
import { SCHEDULE_JSON_SCHEMA, type AiRawResult } from "@backend/ai/schema";
import { describeAiError, generateJson, hasGeminiKey, type Turn } from "@backend/ai/gemini";
import { buildUserPrompt, SYSTEM_PROMPT, type ScheduleMode } from "@backend/ai/prompt";
import { checkBlocks, type CheckedBlock, type Rejected } from "@backend/ai/validate";
import { comparePriority } from "@/lib/priority";
import { taskWeight } from "@/lib/bubbles/weight";
import { DEFAULT_SETTINGS } from "@/lib/firebase/users";
import { horizonFor, sanitizeSettings } from "@/lib/ai/horizon";
import { minutesOfDay, toLocalNaive, weekdayOf } from "@/lib/time";
import { suggestDuration } from "@/lib/history";
import type { ChangeSummary, ChatMessage, HistoryRecord, Schedule, ScheduleBlock, Task, User } from "@/types";
import type { ScheduleRequest, ScheduleResponse } from "@/types/api";


const MAX_TASKS = 60;
const MAX_MESSAGE = 1000;
/** Explicit "throw it all away" requests in chat. Anything else leaves unrelated blocks alone. */
const REBUILD_RE =
  /\b(from scratch|start (over|afresh)|re-?build|re-?plan (everything|all|the (whole|entire))|redo (the |my )?(whole |entire )?(schedule|plan)|re-?schedule (everything|all))\b/i;

/** The user explicitly wants short breaks / back-to-back work ("без перерв", "підряд", "back-to-back"…). */
const SHORT_BREAK_RE =
  /без\s+перерв|без\s+пауз|без\s+відпочинку|підряд|корот[кш]\S*\s+перерв|мінімальн\S*\s+перерв|back[\s-]*to[\s-]*back|no\s+breaks?|without\s+breaks?|short(er)?\s+breaks?|minimal\s+breaks?|quick\s+breaks?/iu;

const err = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function POST(request: Request) {
  const uid = await getSessionUid();
  if (!uid) return err("Not signed in", 401);
  if (!hasGeminiKey()) return err("GEMINI_API_KEY is not configured", 500);

  let body: ScheduleRequest;
  try {
    body = (await request.json()) as ScheduleRequest;
  } catch {
    return err("Invalid request body", 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.targetDate ?? "") || Number.isNaN(Date.parse(body.nowISO))) {
    return err("targetDate or nowISO is invalid", 400);
  }
  const message = body.message?.slice(0, MAX_MESSAGE);
  const now = new Date(body.nowISO);
  if (Math.abs(now.getTime() - Date.now()) > 10 * 60_000) return err("Your device clock looks wrong", 400);

  const db = adminDb();
  const [userSnap, taskSnap, schedSnap, msgSnap, histSnap] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.collection(`users/${uid}/tasks`).where("status", "==", "active").limit(MAX_TASKS).get(),
    db.doc(`users/${uid}/schedules/${body.targetDate}`).get(),
    db.collection(`users/${uid}/messages`).orderBy("createdAt", "desc").limit(8).get(),
    db.collection(`users/${uid}/history`).orderBy("completedAt", "desc").limit(200).get(),
  ]);
  const pastWork = histSnap.docs.map((d) => ({ ...fromFirestoreData<HistoryRecord>(d.data()), id: d.id }));

  const user = userSnap.exists ? fromFirestoreData<User>(userSnap.data()) : null;
  const tz = user?.timezone ?? "UTC";
  const settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...user?.settings });
  const allTasks = taskSnap.docs.map((d) => {
    const t = fromFirestoreData<Task>(d.data());
    return { ...t, id: d.id, loggedMinutes: t.loggedMinutes ?? 0 }; // older docs predate the field
  }).filter((t) => !t.deadline || Date.parse(t.deadline) > now.getTime())
    .sort((a, b) => comparePriority(a, b, now.getTime())); // red, yellow, green, then no deadline // overdue tasks can't be placed before their deadline: they stay out of the plan
  const prev = schedSnap.exists ? fromFirestoreData<Schedule>(schedSnap.data()) : null;
  const history = msgSnap.docs
    .map((d) => ({ ...fromFirestoreData<ChatMessage>(d.data()), id: d.id }))
    .reverse();

  if (allTasks.length === 0) return err("You have no active tasks yet. Add a bubble first.", 400);

  // Tasks split into scheduled parts are planned by those parts: the day planner leaves the parent
  // alone and treats each upcoming part as an immovable block to plan around.
  const hasPlannedParts = (t: Task) => !!t.subtasks?.some((s) => !s.completed && s.scheduledStart && s.scheduledEnd);
  const tasks = allTasks.filter((t) => !hasPlannedParts(t));
  const partBlocks: ScheduleBlock[] = allTasks.filter(hasPlannedParts).flatMap((t) =>
    t.subtasks!
      .filter((s) => !s.completed && s.scheduledStart && s.scheduledEnd && Date.parse(s.scheduledEnd) > now.getTime())
      .map((s) => ({
        id: `part_${s.id}`, taskId: t.id, title: `${t.title}: ${s.title}`,
        start: s.scheduledStart!, end: s.scheduledEnd!, status: "planned" as const, isPinned: true,
      })),
  );

  // ── Decide what is allowed to move ─────────────────────────────────────────────────
  const nowMs = now.getTime();
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const weightOf = (t: Task) => taskWeight(t, nowMs);
  const weights = new Map(tasks.map((t) => [t.id, weightOf(t)]));

  const prevBlocks = prev?.blocks ?? [];
  const doneBlocks = prevBlocks.filter((b) => b.status === "done");
  // Blocks of tasks that were completed/deleted elsewhere are simply dropped.
  const livePlanned = prevBlocks.filter((b) => b.status !== "done" && taskById.has(b.taskId));
  // Blocks that no longer fit the user's working hours/days (they changed them) are re-planned too.
  const outsideHours = (b: ScheduleBlock) => {
    const s = toLocalNaive(b.start, tz), e = toLocalNaive(b.end, tz);
    return (
      !settings.workingDays.includes(weekdayOf(s.slice(0, 10))) ||
      minutesOfDay(s) < minutesOfDay(settings.workingHours.start) ||
      minutesOfDay(e) > minutesOfDay(settings.workingHours.end)
    );
  };
  // Pinned = the user set this time by hand: a hard constraint in EVERY mode, even a full rebuild.
  // (Once a pinned block is in the past it has nothing left to protect, so it is treated as overdue.)
  const isPinnedNow = (b: ScheduleBlock) => !!b.isPinned && new Date(b.end).getTime() >= nowMs;
  const pinned = livePlanned.filter(isPinnedNow);
  const pinnedTaskIds = new Set(pinned.map((b) => b.taskId));
  const overdue = livePlanned.filter(
    (b) => !isPinnedNow(b) && (new Date(b.end).getTime() < nowMs || outsideHours(b)),
  );

  // "New" = the model hasn't seen this task yet (older schedule docs: no block and created after it).
  const considered = new Set(prev?.consideredTaskIds ?? []);
  const hadBlock = new Set(prevBlocks.map((b) => b.taskId));
  const newTasks = tasks.filter((t) =>
    !prev ? true
    : prev.consideredTaskIds ? !considered.has(t.id)
    : !hadBlock.has(t.id) && t.createdAt > prev.updatedAt,
  );

  const userDirected = body.trigger === "user-message" && !!message?.trim();
  const mode: ScheduleMode =
    userDirected && REBUILD_RE.test(message!) ? "rebuild"
    : userDirected ? "adjust"
    : newTasks.length ? "incremental"
    : "locked";

  let toPlace: Task[];
  let locked: ScheduleBlock[];
  if (mode === "rebuild" || mode === "adjust") {
    toPlace = tasks.filter((t) => !pinnedTaskIds.has(t.id));
    locked = pinned;
  } else {
    // A block becomes movable only if a NEW task outweighs it, or it is completely overdue.
    // Higher/equal-weight blocks stay exactly where they are; new tasks fill the free time.
    const maxNew = newTasks.length ? Math.max(...newTasks.map(weightOf)) : -1;
    const movable = new Set<string>([
      ...newTasks.map((t) => t.id),
      ...overdue.map((b) => b.taskId),
      ...(mode === "incremental"
        ? livePlanned.filter((b) => weightOf(taskById.get(b.taskId)!) < maxNew).map((b) => b.taskId)
        : []),
    ]);
    toPlace = tasks.filter((t) => movable.has(t.id) && !pinnedTaskIds.has(t.id));
    locked = livePlanned.filter((b) => isPinnedNow(b) || !movable.has(b.taskId));
  }

  // Smallest rest any block needs: 5 with a locked-in task (or "no breaks" wording), 15 for the balanced
  // wave, 30 when everything is chill. The prompt spells out the full per-pacing rhythm.
  const horizonDays = horizonFor(toPlace, nowMs); // 7 days, or up to 90 for undated / far-off tasks
  const pacings = toPlace.map((t) => t.pacing ?? "balanced");
  const minBreakMin =
    pacings.includes("locked") || (message && SHORT_BREAK_RE.test(message)) ? 5 : pacings.every((p) => p === "chill") ? 30 : 15;
  const nowIso = new Date().toISOString();
  const assistantRef = db.collection(`users/${uid}/messages`).doc();

  // Nothing new, nothing overdue: leave the schedule untouched and skip the AI call entirely.
  if (toPlace.length === 0) {
    const assistantMessage: ChatMessage = {
      id: assistantRef.id,
      role: "assistant",
      content:
        "Your schedule is already up to date. No new tasks were added, so I left every block where it is. " +
        "Tell me what you'd like to change and I'll adjust it.",
      kind: "text",
      status: "sent",
      createdAt: nowIso,
    };
    const { id: _id, ...data } = assistantMessage;
    void _id;
    await assistantRef.set(toFirestoreData(data) as Record<string, unknown>);
    const unchanged: Schedule = prev ?? {
      dateKey: body.targetDate, blocks: [], version: 0, generatedBy: "ai", updatedAt: nowIso,
    };
    return NextResponse.json({ schedule: unchanged, assistantMessage, updatedTasks: [] } satisfies ScheduleResponse);
  }

  // ── Ask the model (validate → retry once with the problems → drop what still fails) ──
  locked = [...locked, ...partBlocks];
  const busy = locked.map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
  const placeIds = new Set(toPlace.map((t) => t.id));
  const turns: Turn[] = [
    {
      role: "user",
      text: buildUserPrompt({
        tz, targetDate: body.targetDate, nowISO: body.nowISO, settings, mode, horizonDays,
        tasks: toPlace, newTaskIds: new Set(newTasks.map((t) => t.id)), weights, locked,
        blocks: livePlanned.filter((b) => placeIds.has(b.taskId)),
        history, message, trigger: body.trigger, minBreakMin, lang: body.lang === "uk" ? "uk" : "en",
        durationHints: new Map(
          toPlace.flatMap((t) => {
            const h = suggestDuration(t.title, pastWork);
            return h ? [[t.id, h] as const] : [];
          }),
        ),
      }),
    },
  ];

  let raw: AiRawResult | null = null;
  let ok: CheckedBlock[] = [];
  let rejected: Rejected[] = [];
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      raw = await generateJson<AiRawResult>({
        system: SYSTEM_PROMPT,
        turns,
        schema: SCHEDULE_JSON_SCHEMA,
        temperature: 0.3,
        effort: "low", // a little reasoning helps fit blocks without overlaps
      });
      ({ ok, rejected } = checkBlocks({
        tz, targetDate: body.targetDate, now, settings, tasks: toPlace, busy, raw, horizonDays,
        minBreakMin, strictBreaks: attempt === 0, // the retry only insists on no overlaps, so a task is never dropped just for a short break
      }));
      if (rejected.length === 0) break;
      turns.push(
        { role: "model", text: JSON.stringify(raw) },
        {
          role: "user",
          text:
            "These blocks broke the rules, fix them and return the full result again:\n" +
            rejected.map((r) => `- ${r.taskId}: ${r.problem}`).join("\n"),
        },
      );
    }
  } catch (e) {
    console.error("schedule: model call failed", e);
    const { message, status } = describeAiError(e);
    return err(message, status);
  }
  if (!raw) return err("The AI assistant returned nothing.", 502);

  // ── Assemble the new schedule: locked blocks verbatim + the AI's placements ──
  const prevByTask = new Map(livePlanned.map((b) => [b.taskId, b]));
  const planned: ScheduleBlock[] = ok.map((b) => ({
    id: prevByTask.get(b.taskId)?.id ?? db.collection("_").doc().id,
    taskId: b.taskId,
    title: taskById.get(b.taskId)!.title,
    start: b.start.toISOString(),
    end: b.end.toISOString(),
    reason: b.reason,
    status: "planned",
  }));

  // Safety net: if the model silently dropped a block it was supposed to re-place, keep the old one
  // when it is still valid and free, rather than letting a task vanish from the plan.
  const mentioned = new Set([
    ...raw.blocks.map((b) => b.taskId),
    ...raw.unscheduled.map((u) => u.taskId),
    ...rejected.map((r) => r.taskId),
  ]);
  const overlaps = (a: ScheduleBlock, list: ScheduleBlock[]) =>
    list.some((x) => a.start < x.end && a.end > x.start);
  for (const b of livePlanned) {
    if (!placeIds.has(b.taskId) || mentioned.has(b.taskId)) continue;
    if (new Date(b.end).getTime() < nowMs) continue;
    if (!overlaps(b, [...locked, ...planned])) planned.push(b);
  }

  const finalPlanned = [...locked, ...planned];
  const blocks = [...doneBlocks, ...finalPlanned].sort((a, b) => a.start.localeCompare(b.start));

  const whyUnscheduled = new Map<string, string>([
    ...raw.unscheduled.map((u) => [u.taskId, u.reason] as const),
    ...rejected.map((r) => [r.taskId, `Couldn't fit it: ${r.problem}.`] as const),
  ]);

  // Diff old vs new (locked blocks are identical, so they never show up as changes).
  const newByTask = new Map(finalPlanned.map((b) => [b.taskId, b]));
  const changes: ChangeSummary["changes"] = [];
  for (const b of finalPlanned) {
    const o = prevByTask.get(b.taskId);
    const to = { start: b.start, end: b.end };
    if (!o) changes.push({ type: "added", taskId: b.taskId, title: b.title, to, why: b.reason ?? "" });
    else if (o.start !== b.start)
      changes.push({ type: "moved", taskId: b.taskId, title: b.title, from: { start: o.start, end: o.end }, to, why: b.reason ?? "" });
    else if (o.end !== b.end)
      changes.push({ type: "resized", taskId: b.taskId, title: b.title, from: { start: o.start, end: o.end }, to, why: b.reason ?? "" });
  }
  for (const o of livePlanned) {
    if (!newByTask.has(o.taskId))
      changes.push({
        type: "removed", taskId: o.taskId, title: o.title,
        from: { start: o.start, end: o.end },
        why: whyUnscheduled.get(o.taskId) ?? "No longer part of the plan.",
      });
  }

  const changeSummary: ChangeSummary = {
    summary: raw.summary,
    changes,
    triggeredBy: body.trigger,
    messageId: assistantRef.id,
    at: nowIso,
  };
  const schedule: Schedule = {
    dateKey: body.targetDate,
    blocks,
    version: (prev?.version ?? 0) + 1,
    consideredTaskIds: tasks.map((t) => t.id),
    lastChange: changeSummary,
    generatedBy: "ai",
    updatedAt: nowIso,
  };
  const assistantMessage: ChatMessage = {
    id: assistantRef.id,
    role: "assistant",
    content: raw.reply,
    kind: "schedule-update",
    scheduleVersion: schedule.version,
    changeSummary,
    status: "sent",
    createdAt: nowIso,
  };

  // AI estimates fill gaps only; user-provided values are never overwritten.
  const updatedTasks: Task[] = [];
  const batch = db.batch();
  for (const e of raw.taskEstimates) {
    const t = taskById.get(e.taskId);
    if (!t || !placeIds.has(t.id)) continue;
    if (t.durationMin !== undefined) continue;
    const aiEstimate: NonNullable<Task["aiEstimate"]> = {
      durationMin: Math.max(5, Math.min(480, Math.round(e.durationMin))),
      reasoning: e.reasoning,
      estimatedAt: nowIso,
    };
    batch.update(db.doc(`users/${uid}/tasks/${t.id}`), toFirestoreData({ aiEstimate, updatedAt: nowIso }) as Record<string, unknown>);
    updatedTasks.push({ ...t, aiEstimate, updatedAt: nowIso });
  }

  const { dateKey, ...scheduleData } = schedule;
  void dateKey;
  batch.set(db.doc(`users/${uid}/schedules/${body.targetDate}`), toFirestoreData(scheduleData) as Record<string, unknown>);
  const { id: messageId, ...messageData } = assistantMessage;
  void messageId;
  batch.set(assistantRef, toFirestoreData(messageData) as Record<string, unknown>);

  // Reminders: only touch blocks that actually changed (so untouched ones can't re-fire).
  if (settings.notificationsEnabled) {
    const prevById = new Map(livePlanned.map((b) => [b.id, b]));
    const unchanged = (b: ScheduleBlock) => {
      const o = prevById.get(b.id);
      return !!o && o.start === b.start && o.end === b.end;
    };
    const finalIds = new Set(finalPlanned.map((b) => b.id));
    for (const o of livePlanned) {
      if (!finalIds.has(o.id) || !unchanged(finalPlanned.find((b) => b.id === o.id)!))
        batch.delete(db.doc(`reminders/${uid}_${o.id}`));
    }
    for (const b of finalPlanned) {
      if (unchanged(b)) continue;
      const fireAt = new Date(new Date(b.start).getTime() - settings.reminderLeadMinutes * 60_000);
      if (fireAt.getTime() <= Date.now()) continue;
      batch.set(
        db.doc(`reminders/${uid}_${b.id}`),
        toFirestoreData({
          uid, taskId: b.taskId, blockId: b.id, title: b.title,
          fireAt: fireAt.toISOString(), sent: false,
        }) as Record<string, unknown>,
      );
    }
  }

  try {
    await batch.commit();
  } catch (e) {
    console.error("schedule: write failed", e);
    return err("Couldn't save the new schedule.", 500);
  }

  const response: ScheduleResponse = { schedule, assistantMessage, updatedTasks };
  return NextResponse.json(response);
}
