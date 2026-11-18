import type { Task } from "@/types";

const HOUR = 3_600_000;

/** Any deadline shape (ISO string, Date, Firestore Timestamp, epoch ms) → epoch ms, or null when there is none. */
export function toMillis(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  if (typeof v === "object" && typeof (v as { toMillis?: unknown }).toMillis === "function") {
    return (v as { toMillis(): number }).toMillis();
  }
  if (typeof v === "object" && typeof (v as { toDate?: unknown }).toDate === "function") {
    return (v as { toDate(): Date }).toDate().getTime();
  }
  return null;
}

/** 0 = red (≤24h, incl. already due), 1 = yellow (≤120h), 2 = green (>120h), 3 = no deadline. */
export function urgencyTier(dueMs: number | null, nowMs: number): 0 | 1 | 2 | 3 {
  if (dueMs === null) return 3;
  const hours = (dueMs - nowMs) / HOUR;
  return hours <= 24 ? 0 : hours <= 120 ? 1 : 2;
}

/**
 * Scheduling order: tier first (red, yellow, green, none), then earliest deadline, then oldest.
 * A future green or deadline-less task never outranks an urgent one.
 */
export function comparePriority(a: Pick<Task, "deadline" | "createdAt">, b: Pick<Task, "deadline" | "createdAt">, nowMs: number): number {
  const aDue = toMillis(a.deadline);
  const bDue = toMillis(b.deadline);
  const ta = urgencyTier(aDue, nowMs);
  const tb = urgencyTier(bDue, nowMs);
  if (ta !== tb) return ta - tb;
  if (aDue !== null && bDue !== null && aDue !== bDue) return aDue - bDue;
  return String(a.createdAt).localeCompare(String(b.createdAt));
}
