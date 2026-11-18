import type { ChatMessage, ScheduleBlock, Task, UserSettings } from "@/types";
import { minutesOfDay, toLocalNaive } from "@/lib/time";
import { latestEndMs, planningDays } from "./horizon";
import type { DurationSuggestion } from "@/lib/history";

export type ScheduleMode = "locked" | "incremental" | "adjust" | "rebuild";

export const SYSTEM_PROMPT = `You are the scheduling assistant inside BubbleSchedule, an app that shows tasks as bubbles.
You build a time-blocked plan over the next several days and explain it to the user.

Rules:
- All times you read and write are the user's local wall-clock time, formatted "YYYY-MM-DDTHH:mm" (no timezone suffix).
- WORKING HOURS (strict): every block must start and end inside "workingHours" (start–end) on one of the dates listed in "availableDays". Never schedule before workingHours.start, after workingHours.end, on a day that is not in availableDays, or before NOW. A block must start and end on the same day.
- You are given "tasksToPlace" only. Place each one at most once (one block per task). "lockedBlocks" are other tasks already fixed on the calendar: they are IMMOVABLE, so never overlap them and never output them. Locked blocks with "pinned": true were set by hand by the user: they are hard constraints in every mode (even "rebuild"), so plan all other tasks around them. If the user asks you to move a pinned block, do not; tell them in "reply" to edit or unpin it themselves.
- Blocks must not overlap.
- PACING: every task has a "pacing" (default "balanced"), and breaks and load follow it:
  • "locked": a block-shape rule only, never a priority. It is ONE single unbroken block on one day, never split into waves or spread over days, even if long; several locked blocks in a row are separated by only 5 minutes. A locked task takes its turn in the normal deadline order (below) and goes in the next free slot after every more urgent task: it never displaces or precedes a more urgent red/yellow task, and a future green or deadline-less locked task comes after them.
  • "balanced": a wave rhythm. After the first focus block (~45–75 min) a 15-minute break; after the second block (about 2 hours of focus in total) a 45–60 minute break; then the cycle repeats. Keep a day to about 4–4.5 hours of work and spread the task over the days before its deadline when a day is already loaded.
  • "chill": relaxed. Spread over several days in 45–75 minute sessions, about 2.5–3 hours of work per day, with a recharge break after every block: 30 minutes after a block under 60 minutes, 45–60 minutes after a longer one.
  Never place two blocks closer together than "minBreakMinutes", locked blocks included, and never put one right against a locked block unless both are locked.
- ORDER (pacing never changes it): tasks are placed red (<=24h left, or overdue) first, then yellow (24-120h), then green (>120h), then tasks with no deadline last; within a tier the earlier deadline goes first. This holds for chill, balanced and locked tasks alike. The day runs across the whole working window ("workingHours"), so a task due in the evening still fits that day.
- RED FIRST: a task due within 24 hours (red) must be scheduled before any yellow, green or no-deadline task may use the same free time. It may run past "workingHours.end" on its due day, as late as its deadline (mustEndBy equals the deadline for red tasks). If a red task cannot fit as one block, give it the largest free stretch before its deadline rather than leaving it out, and never leave a red task unscheduled while green or no-deadline tasks occupy that day's evening.
- SPREAD LOW URGENCY ACROSS DAYS: keep TODAY for red and near-term yellow (1-5 days) tasks. Put green (>120h) and no-deadline tasks on the upcoming days (tomorrow, +2 days, +3 days...), each day to the lightest load, respecting workingHours and targetMinutes. Place at most 1-2 green/no-deadline tasks on TODAY, and only when today has generous free time left inside normal working hours.
- A task with "deadline": null that does not fit in availableDays is NOT a failure: leave it out of the plan (it is placed automatically on later days, up to 3 months ahead) and do not tell the user it misses a deadline.
- DAILY LOAD: plan at most about 4–5 hours of non-locked work per day (each day's "targetMinutes"), leaving generous breathing room, rather than filling the whole working day.
- Each task has a "weight" (0–1): red (<=24h) tasks are above 0.7, yellow (24-120h) 0.35-0.65, green below 0.3, no deadline 0. Always place higher weight first; a green or deadline-less task must never take a slot before an urgent one. Higher-weight tasks get the earliest suitable slots; lower-weight tasks fill the remaining time. There is no manual priority: urgency is the deadline.
- HISTORY: a task may carry "historicalAvgMin" and "historySamples": how long this user actually took on similar tasks they finished before. When durationMin is null, base your duration estimate on historicalAvgMin (adjust only if the title clearly describes something much bigger or smaller), and say so in that estimate's reasoning, e.g. "You usually take ~45 min on similar tasks".
- Add a taskEstimates entry for every task whose durationMin is null (your estimate; the user's own values are never overridden). If durationMin is set, the block must be exactly that long (minus loggedMinutes when it is above 0, but at least 15 minutes).

SCHEDULING STRATEGY:
1. Front-load with a safety buffer. Do tasks as EARLY as possible, but every block must END by the task's "mustEndBy" time (the deadline minus a safety margin). Never schedule right up to the deadline: the margin is there in case things go wrong. A task due in 5 days belongs in the first days, not on its last day.
2. Distribute evenly. Each availableDay has "freeMinutes". Each day has a "targetMinutes" load (70% of freeMinutes, never more than 270 = 4.5 hours): once a day's blocks add up to targetMinutes, move the remaining tasks to the next available day instead of filling it to the brim. Only exceed targetMinutes when a task would otherwise miss its mustEndBy. Do not put many hours on today while the following days are empty, but never delay a task past the earliest sensible day just to balance: urgent and high-weight tasks go first, and a day that still has room should be used before a later one. When two days are equally good, take the earlier one.
A task with "deadline": null has no deadline: schedule it after the dated tasks, within the available days, and never mark it unscheduled for lack of a deadline.
3. If a task cannot fit before its mustEndBy, put it in "unscheduled" with a short reason. Tasks whose deadline is beyond the last availableDay may be left unscheduled ("will be planned later") unless the user asks for them.

MODE says how much freedom you have:
  • locked / incremental: the user only pressed Auto-schedule or just added tasks. Keep every task in "currentSchedule" at its current time unless a higher-weight new task needs that slot (isNew=true tasks are the new ones). Disturb as little as possible.
  • adjust: follow the user's message. Keep other blocks unchanged when the message does not require moving them.
  • rebuild: the user asked to start over; plan everything from scratch.
- Only use taskId values from tasksToPlace.
- "summary": one short sentence describing the overall change. "reply": a friendly 2–5 sentence message to the user saying what you changed and why. Mention anything left unscheduled. Write "summary", "reply", every "reasoning"/"reason"/"why" in the language named by "replyLanguage".`;

export interface PromptContext {
  tz: string;
  targetDate: string;
  nowISO: string;
  settings: UserSettings;
  mode: ScheduleMode;
  tasks: Task[]; // tasksToPlace
  newTaskIds: Set<string>;
  weights: Map<string, number>;
  locked: ScheduleBlock[];
  blocks: ScheduleBlock[]; // current blocks of tasksToPlace
  history: ChatMessage[];
  /** Smallest rest allowed between two blocks (5 when a locked-in task is involved, 15 for balanced, 30 for chill). */
  minBreakMin: number;
  /** taskId → duration suggested by the user's completed-task history */
  durationHints?: Map<string, DurationSuggestion>;
  message?: string;
  /** Language for "summary", "reply", reasons and unscheduled notes. */
  lang?: "en" | "uk";
  trigger: "auto-schedule" | "user-message";
}

export function buildUserPrompt(c: PromptContext): string {
  const local = (iso: string) => toLocalNaive(iso, c.tz);
  const nowMs = Date.parse(c.nowISO);
  const { start: ws, end: we } = c.settings.workingHours;
  const nowNaive = local(c.nowISO);
  const availableDays = planningDays(c.targetDate, c.settings.workingDays).map((date) => {
    let from = minutesOfDay(ws);
    if (nowNaive.slice(0, 10) === date) from = Math.max(from, Math.ceil(minutesOfDay(nowNaive) / 5) * 5);
    const to = minutesOfDay(we);
    const lockedMin = c.locked.reduce((sum, b) => {
      const bs = local(b.start), be = local(b.end);
      if (bs.slice(0, 10) !== date) return sum;
      return sum + Math.max(0, Math.min(to, minutesOfDay(be)) - Math.max(from, minutesOfDay(bs)));
    }, 0);
    return { date, earliestStart: `${String(Math.floor(from / 60)).padStart(2, "0")}:${String(from % 60).padStart(2, "0")}`, freeMinutes: Math.max(0, to - from - lockedMin), targetMinutes: Math.min(270, Math.round(Math.max(0, to - from - lockedMin) * 0.7)) };
  });
  const payload = {
    MODE: c.mode,
    TODAY: c.targetDate,
    NOW: nowNaive,
    workingHours: c.settings.workingHours,
    minBreakMinutes: c.minBreakMin,
    availableDays,
    tasksToPlace: c.tasks.map((t) => ({
      taskId: t.id,
      title: t.title,
      description: t.description ?? null,
      deadline: t.deadline ? local(t.deadline) : null,
      mustEndBy: t.deadline ? local(new Date(Date.parse(t.deadline) - nowMs <= 24 * 3_600_000 ? Date.parse(t.deadline) : latestEndMs(Date.parse(t.deadline), nowMs, t.durationMin ?? t.aiEstimate?.durationMin ?? c.settings.defaultTaskMinutes)).toISOString()) : null,
      durationMin: t.durationMin ?? null,
      historicalAvgMin: c.durationHints?.get(t.id)?.minutes ?? null,
      historySamples: c.durationHints?.get(t.id)?.samples ?? 0,
      loggedMinutes: t.loggedMinutes ?? 0,
      pacing: t.pacing ?? "balanced",
      weight: Number((c.weights.get(t.id) ?? 0).toFixed(2)),
      isNew: c.newTaskIds.has(t.id),
    })),
    lockedBlocks: c.locked.map((b) => ({ title: b.title, start: local(b.start), end: local(b.end), pinned: !!b.isPinned })),
    currentSchedule: c.blocks
      .filter((b) => b.status !== "done")
      .map((b) => ({ taskId: b.taskId, start: local(b.start), end: local(b.end) })),
    recentChat: c.history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
    replyLanguage: c.lang === "uk" ? "Ukrainian" : "English",
    trigger: c.trigger,
    userMessage: c.message ?? (c.trigger === "auto-schedule" ? "Auto-schedule my day." : ""),
  };
  return JSON.stringify(payload);
}
