import { timingSafeEqual } from "node:crypto";
import { FieldPath } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { fromFirestoreData, toFirestoreData } from "@/lib/firebase/converters";
import { effectiveQuiet } from "@/lib/settings";
import { COPY, sendPush, signAction, type Lang } from "@/lib/server/push";
import { addDays, dateKeyInTz, toLocalNaive } from "@/lib/time";
import type { Schedule, Subtask, Task, User } from "@/types";

/**
 * Background push dispatcher. Call it every minute or two (an external cron such as cron-job.org, or Vercel Cron on
 * a plan that allows it) with `Authorization: Bearer $CRON_SECRET`, via GET or POST.
 *
 *  a) 5 minutes before a scheduled start (a part, or a standalone task's block): 0 < start − now ≤ 5 min.
 *  b) 24 hours before a deadline: 0 < due − now ≤ 24 h. Quiet Hours hold this one back until they end
 *     (the window is open-ended, so it goes out on the first run after quiet hours).
 *
 * Deduplication: every alert is CLAIMED in a transaction before it is sent. Start alerts store the start time they
 * were sent for (`notified5mStart`), so moving or snoozing the task re-arms the alert by itself; deadline alerts use
 * `notified24hDue` (and honour the client's `oneDayNotified`). A failed send releases the claim.
 */
export const maxDuration = 60;

const LEAD_MS = 5 * 60_000;
const DAY_MS = 24 * 3_600_000;
const MAX_USERS = 500;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
function inQuietHours(user: User, now: number): boolean {
  const q = effectiveQuiet(user.settings); // the user's own window, or the inverse of their working hours
  if (!q.enabled) return false;
  const local = toMin(toLocalNaive(new Date(now), user.timezone || "UTC").slice(11, 16));
  const s = toMin(q.start);
  const e = toMin(q.end);
  return s > e ? local >= s || local < e : local >= s && local < e;
}

interface StartItem {
  kind: "part" | "block";
  taskId: string;
  ref: string; // subtask id or block id
  title: string;
  start: string;
}

async function run(): Promise<Record<string, number>> {
  const db = adminDb();
  const now = Date.now();
  const stats = { users: 0, sent: 0, failed: 0, skipped: 0 };
  const usersSnap = await db.collection("users").where("settings.notificationsEnabled", "==", true).limit(MAX_USERS).get();

  for (const u of usersSnap.docs) {
    const user = fromFirestoreData<User>(u.data());
    const tokens = Array.isArray(user.fcmTokens) ? user.fcmTokens : [];
    if (tokens.length === 0) continue;
    const uid = u.id;
    const lang: Lang = user.settings?.language === "uk" ? "uk" : "en";
    stats.users++;

    const taskSnap = await db.collection(`users/${uid}/tasks`).where("status", "==", "active").limit(200).get();
    const tasks = taskSnap.docs.map((d) => ({ ...fromFirestoreData<Task>(d.data()), id: d.id }));
    const live = tasks.filter((t) => !t.deadline || Date.parse(t.deadline) > now); // overdue tasks get nothing
    const liveById = new Map(live.map((t) => [t.id, t]));

    const deliver = async (data: Record<string, string>, release: () => Promise<unknown>) => {
      try {
        if (await sendPush(uid, tokens, data)) stats.sent++;
        else throw new Error("no device accepted the message");
      } catch (e) {
        console.error("dispatch: send failed", uid, e);
        stats.failed++;
        await release().catch(() => {});
      }
    };

    // ── (b) 24 hours before the deadline ────────────────────────────────────────────────────
    if (!inQuietHours(user, now)) {
      for (const t of live) {
        if (!t.deadline || t.notified24hDue || t.oneDayNotified) continue;
        const left = Date.parse(t.deadline) - now;
        if (left <= 0 || left > DAY_MS) continue;
        const ref = db.doc(`users/${uid}/tasks/${t.id}`);
        const claimed = await db.runTransaction(async (tx) => {
          const cur = await tx.get(ref);
          if (!cur.exists || cur.get("status") !== "active" || cur.get("notified24hDue") === true || cur.get("oneDayNotified") === true) return false;
          tx.update(ref, { notified24hDue: true, oneDayNotified: true });
          return true;
        });
        if (!claimed) continue;
        await deliver(
          {
            title: COPY.due(lang, t.title),
            body: COPY.dueBody(lang, Math.max(1, Math.round(left / 3_600_000))),
            url: "/dashboard",
            blockId: `${t.id}_24h`,
            actionToken: signAction({ uid, taskId: t.id, kind: "task" }),
            doneLabel: COPY.done(lang),
            snoozeLabel: "",
          },
          () => ref.update({ notified24hDue: false, oneDayNotified: false }),
        );
      }
    } else {
      stats.skipped++;
    }

    // ── (a) 5 minutes before a scheduled start ──────────────────────────────────────────────
    const inWindow = (iso?: string) => {
      const d = iso ? Date.parse(iso) - now : NaN;
      return d > 0 && d <= LEAD_MS;
    };
    const items: StartItem[] = [];
    for (const t of live) {
      for (const s of t.subtasks ?? []) {
        if (!s.completed && s.scheduledStart && inWindow(s.scheduledStart) && s.notified5mStart !== s.scheduledStart) {
          items.push({ kind: "part", taskId: t.id, ref: s.id, title: s.title || t.title, start: s.scheduledStart });
        }
      }
    }
    const schedSnap = await db
      .collection(`users/${uid}/schedules`)
      .where(FieldPath.documentId(), ">=", addDays(dateKeyInTz(now, user.timezone || "UTC"), -1))
      .limit(10)
      .get();
    const schedDocs: Array<{ id: string; blocks: Schedule["blocks"] }> = schedSnap.docs.map((d) => ({
      id: d.id,
      blocks: fromFirestoreData<Schedule>(d.data()).blocks ?? [],
    }));
    for (const sd of schedDocs) {
      for (const b of sd.blocks) {
        const task = liveById.get(b.taskId);
        if (!task || task.subtasks?.length || b.status !== "planned") continue; // tasks with parts alert per part
        if (inWindow(b.start) && b.notified5mStart !== b.start) {
          items.push({ kind: "block", taskId: b.taskId, ref: b.id, title: b.title || task.title, start: b.start });
        }
      }
    }

    for (const it of items) {
      // Claim: re-read inside a transaction and record the start time we alert for.
      let docRef: FirebaseFirestore.DocumentReference;
      let field: "subtasks" | "blocks";
      if (it.kind === "part") {
        docRef = db.doc(`users/${uid}/tasks/${it.taskId}`);
        field = "subtasks";
      } else {
        const owner = schedDocs.find((sd) => sd.blocks.some((b) => b.id === it.ref));
        if (!owner) continue;
        docRef = db.doc(`users/${uid}/schedules/${owner.id}`);
        field = "blocks";
      }
      const mark = (value: string | null) =>
        db.runTransaction(async (tx) => {
          const cur = await tx.get(docRef);
          if (!cur.exists) return false;
          const list = fromFirestoreData<Array<Subtask & { start?: string }>>(cur.get(field) ?? []);
          const idx = list.findIndex((x) => x.id === it.ref);
          if (idx < 0) return false;
          const startOf = it.kind === "part" ? list[idx].scheduledStart : list[idx].start;
          if (value !== null && (startOf !== it.start || list[idx].notified5mStart === it.start)) return false; // moved, or already claimed
          const next = list.map((x, i) => {
            if (i !== idx) return x;
            const { notified5mStart: _old, ...rest } = x;
            void _old;
            return value === null ? rest : { ...rest, notified5mStart: value };
          });
          tx.update(docRef, { [field]: toFirestoreData(next) });
          return true;
        });
      if (!(await mark(it.start))) continue;
      await deliver(
        {
          title: COPY.start(lang, it.title),
          body: COPY.startBody(lang),
          url: "/dashboard",
          blockId: `${it.ref}_start`,
          actionToken: signAction({ uid, taskId: it.taskId, kind: it.kind, ref: it.ref }),
          doneLabel: COPY.done(lang),
          snoozeLabel: COPY.snooze(lang),
        },
        () => mark(null),
      );
    }
  }
  return stats;
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await run());
}
export const POST = GET;
