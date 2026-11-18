"use client";

import { useEffect, useRef } from "react";
import { doc, runTransaction } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { fromFirestoreData, toFirestoreData } from "@/lib/firebase/converters";
import type { DateKey, Schedule, Subtask, Task } from "@/types";

const LEAD_MS = 5 * 60_000;
const GRACE_MS = 2 * 60_000;
const CHECK_MS = 15_000;

export interface StartReminder {
  taskId: string;
  title: string;
  start: string;
}

/**
 * Foreground reminders: while the app is open, a task or part that starts within 5 minutes is announced from the
 * page itself (every 15 s), so it does not depend on the server's cron or on the push service.
 *
 * It uses the same claim as the server (`notified5mStart` = the start time alerted for, written in a transaction),
 * so a start is announced exactly once across this tab, other devices and the server's push.
 */
export function useLocalReminders(
  uid: string | undefined,
  tasks: readonly Task[],
  schedule: Schedule | null,
  dateKey: DateKey,
  onFire: (r: StartReminder) => void,
) {
  const latest = useRef({ tasks, schedule, onFire });
  useEffect(() => {
    latest.current = { tasks, schedule, onFire };
  });
  const busy = useRef(new Set<string>());

  useEffect(() => {
    if (!uid) return;
    const inWindow = (iso: string | undefined, now: number) => {
      const d = iso ? Date.parse(iso) - now : NaN;
      return d > -GRACE_MS && d <= LEAD_MS;
    };

    async function claim(ref: ReturnType<typeof doc>, field: "subtasks" | "blocks", id: string, start: string): Promise<boolean> {
      return runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return false;
        const list = fromFirestoreData<Array<Subtask & { start?: string }>>(snap.get(field) ?? []);
        const i = list.findIndex((x) => x.id === id);
        if (i < 0) return false;
        const startOf = field === "subtasks" ? list[i].scheduledStart : list[i].start;
        if (startOf !== start || list[i].notified5mStart === start) return false; // moved, or already announced
        tx.update(ref, { [field]: toFirestoreData(list.map((x, j) => (j === i ? { ...x, notified5mStart: start } : x))) });
        return true;
      });
    }

    async function check() {
      const { tasks: ts, schedule: sch, onFire: fire } = latest.current;
      const now = Date.now();
      const live = ts.filter((t) => t.status === "active" && (!t.deadline || Date.parse(t.deadline) > now));
      const byId = new Map(live.map((t) => [t.id, t]));

      type Item = { key: string; field: "subtasks" | "blocks"; docRef: ReturnType<typeof doc>; id: string; start: string; taskId: string; title: string };
      const items: Item[] = [];
      for (const t of live) {
        for (const s of t.subtasks ?? []) {
          if (!s.completed && s.scheduledStart && inWindow(s.scheduledStart, now) && s.notified5mStart !== s.scheduledStart) {
            items.push({ key: `p:${s.id}:${s.scheduledStart}`, field: "subtasks", docRef: doc(db, "users", uid!, "tasks", t.id), id: s.id, start: s.scheduledStart, taskId: t.id, title: s.title || t.title });
          }
        }
      }
      for (const b of sch?.blocks ?? []) {
        const t = byId.get(b.taskId);
        if (!t || t.subtasks?.length || b.status !== "planned") continue;
        if (inWindow(b.start, now) && b.notified5mStart !== b.start) {
          items.push({ key: `b:${b.id}:${b.start}`, field: "blocks", docRef: doc(db, "users", uid!, "schedules", dateKey), id: b.id, start: b.start, taskId: b.taskId, title: b.title || t.title });
        }
      }

      for (const it of items) {
        if (busy.current.has(it.key)) continue;
        busy.current.add(it.key);
        try {
          if (await claim(it.docRef, it.field, it.id, it.start)) fire({ taskId: it.taskId, title: it.title, start: it.start });
        } catch (e) {
          console.warn("local reminder claim failed:", e);
          busy.current.delete(it.key); // try again on the next check
        }
      }
    }

    void check();
    const id = setInterval(() => void check(), CHECK_MS);
    const onVisible = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [uid, dateKey]);
}
