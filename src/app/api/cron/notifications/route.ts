import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, adminMessaging } from "@/lib/firebase/admin";

/**
 * Cron endpoint (every ~5 min): pushes "due soon" and "overdue" alerts for tasks.
 *
 *  - due soon: active task whose deadline is within the next SOON_MIN minutes   -> sets `notified: true`
 *  - overdue : active task whose deadline passed within the last OVERDUE_MIN    -> sets `notifiedOverdue: true`
 *              and marks the task `expired` (it leaves the bubble canvas; the user can reschedule it)
 *
 * Each flag is claimed in a transaction BEFORE sending, so overlapping runs can't double-send; if every
 * send fails the claim is released so the next run retries.
 * Auth: `Authorization: Bearer $CRON_SECRET` (Vercel Cron adds this header automatically).
 */
export const maxDuration = 60;

const SOON_MIN = 30;
const OVERDUE_MIN = 60; // don't announce things that went overdue long ago
const MAX_TASKS = 300;
const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

type Kind = "soon" | "overdue";
const FLAG: Record<Kind, "notified" | "notifiedOverdue"> = { soon: "notified", overdue: "notifiedOverdue" };

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed: an unset secret must never mean "open"
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = adminDb();
  const now = Date.now();
  const snap = await db
    .collectionGroup("tasks")
    .where("status", "==", "active")
    .where("deadline", ">=", new Date(now - OVERDUE_MIN * 60_000))
    .where("deadline", "<=", new Date(now + SOON_MIN * 60_000))
    .limit(MAX_TASKS)
    .get();

  // Work out which alert (if any) each task needs.
  const jobs = snap.docs.flatMap((d) => {
    const data = d.data();
    const uid = d.ref.parent.parent?.id;
    const dl = (data.deadline as { toDate(): Date }).toDate().getTime();
    const kind: Kind = dl <= now ? "overdue" : "soon";
    if (!uid || data[FLAG[kind]] === true) return [];
    return [{ ref: d.ref, uid, kind, title: String(data.title ?? "Task"), minutes: Math.max(1, Math.round((dl - now) / 60_000)) }];
  });

  const result = { checked: snap.size, sent: 0, skipped: 0, failed: 0 };
  const byUser = Map.groupBy(jobs, (j) => j.uid);

  for (const [uid, userJobs] of byUser) {
    const user = (await db.doc(`users/${uid}`).get()).data();
    const tokens: string[] = Array.isArray(user?.fcmTokens) ? user.fcmTokens : [];
    if (!user?.settings?.notificationsEnabled || tokens.length === 0) {
      result.skipped += userJobs.length; // not claimed: they can still be alerted if they enable reminders in time
      continue;
    }

    for (const job of userJobs) {
      const flag = FLAG[job.kind];
      // Claim: only one run wins. Overdue also implies the "soon" alert is no longer relevant.
      const claimed = await db.runTransaction(async (tx) => {
        const cur = await tx.get(job.ref);
        if (!cur.exists || cur.get("status") !== "active" || cur.get(flag) === true) return false;
        tx.update(
          job.ref,
          job.kind === "overdue"
            ? { notified: true, notifiedOverdue: true, status: "expired", expiredAt: FieldValue.serverTimestamp() }
            : { notified: true },
        );
        return true;
      });
      if (!claimed) continue;

      const body = job.kind === "overdue" ? "Its deadline passed. Open the app to reschedule it." : `Due in ${job.minutes} min.`;
      try {
        // Data-only: public/firebase-messaging-sw.js builds the notification.
        const res = await adminMessaging().sendEachForMulticast({
          tokens,
          data: { title: job.kind === "overdue" ? `Expired: ${job.title}` : job.title, body, url: "/dashboard", blockId: `${job.ref.id}_${job.kind}` },
          webpush: { headers: { Urgency: "high", TTL: "1800" } },
        });
        const dead = tokens.filter((_, i) => {
          const code = res.responses[i].error?.code;
          return code !== undefined && DEAD_TOKEN_CODES.has(code);
        });
        if (dead.length) await db.doc(`users/${uid}`).update({ fcmTokens: FieldValue.arrayRemove(...dead) });
        if (res.successCount > 0) {
          result.sent++;
        } else {
          throw new Error("no device accepted the message");
        }
      } catch (e) {
        console.error("cron/notifications: send failed", job.ref.path, e);
        result.failed++;
        // Release the claim so the next run retries.
        await job.ref.update(job.kind === "overdue" ? { notifiedOverdue: false } : { notified: false });
      }
    }
  }
  return NextResponse.json(result);
}
