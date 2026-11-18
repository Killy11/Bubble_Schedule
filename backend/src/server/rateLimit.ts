import "server-only";
import { adminDb } from "@backend/firebase/admin";

/** Take one of `max` slots per hour for (uid, key). Stored in a server-only collection. */
export async function takeHourlySlot(uid: string, key: string, max: number): Promise<boolean> {
  const ref = adminDb().doc(`rateLimits/${key}_${uid}`);
  const now = Date.now();
  return adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const recent = ((snap.get("at") as number[] | undefined) ?? []).filter((t) => t > now - 3_600_000);
    if (recent.length >= max) return false;
    tx.set(ref, { at: [...recent, now] });
    return true;
  });
}
