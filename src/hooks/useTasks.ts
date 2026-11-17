"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  increment,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { historyConverter, taskConverter } from "@/lib/firebase/converters";
import { cleanRecurrence, nextOccurrence } from "@/lib/recurrence";
import { makeHistoryRecord } from "@/lib/history";
import type { Priority, Recurrence, Task } from "@/types";

export interface NewTaskInput {
  title: string;
  deadline: string; // ISO
  durationMin?: number;
  priority?: Priority;
  description?: string;
  recurrence?: Recurrence;
  /** Duration guessed from the user's history; stored as an AI-style estimate, not as a user value. */
  historyEstimate?: { durationMin: number; reasoning: string };
}

const minutesSince = (iso: string, nowMs: number) => Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60_000));

export function useTasks(
  uid: string | undefined,
  timezone: string,
  now: number,
  onExpired?: (tasks: Task[]) => void,
) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, "users", uid, "tasks").withConverter(taskConverter),
      orderBy("deadline", "asc"),
    );
    return onSnapshot(
      q,
      (snap) => {
        setTasks(snap.docs.map((d) => d.data()));
        setLoading(false);
        setError(null);
      },
      (e) => {
        console.warn("tasks listener:", e.code);
        setError("Couldn't load your tasks.");
        setLoading(false);
      },
    );
  }, [uid]);

  const addTask = useCallback(
    async (input: NewTaskInput) => {
      if (!uid) return;
      const ref = doc(collection(db, "users", uid, "tasks")).withConverter(taskConverter);
      const nowIso = new Date().toISOString();
      const recurrence = cleanRecurrence(input.recurrence);
      const task: Task = {
        id: ref.id,
        title: input.title.trim(),
        deadline: input.deadline,
        description: input.description?.trim() || undefined,
        durationMin: input.durationMin,
        loggedMinutes: 0,
        priority: input.priority,
        aiEstimate: input.historyEstimate
          ? { durationMin: input.historyEstimate.durationMin, reasoning: input.historyEstimate.reasoning, estimatedAt: nowIso }
          : undefined,
        recurrence,
        seriesId: recurrence ? ref.id : undefined,
        status: "active",
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      await setDoc(ref, task);
    },
    [uid],
  );

  const deleteTask = useCallback(
    async (id: string) => {
      if (uid) await deleteDoc(doc(db, "users", uid, "tasks", id));
    },
    [uid],
  );

  /**
   * Create the next occurrence of a recurring task. The new task's id is derived from the series and
   * its day, and the whole thing is one transaction, so concurrent callers (two tabs, the new-day
   * sweep) can never create duplicates.
   */
  const ensureNext = useCallback(
    async (task: Task) => {
      if (!uid || !task.recurrence) return;
      const next = nextOccurrence(task.deadline, task.recurrence, timezone, Date.now());
      if (!next) return;
      const series = task.seriesId ?? task.id;
      const nextRef = doc(db, "users", uid, "tasks", `${series}_${next.dateKey}`).withConverter(taskConverter);
      const prevRef = doc(db, "users", uid, "tasks", task.id);
      const nowIso = new Date().toISOString();
      await runTransaction(db, async (tx) => {
        const existing = await tx.get(nextRef);
        if (!existing.exists()) {
          const copy: Task = {
            id: nextRef.id,
            title: task.title,
            deadline: next.deadline,
            description: task.description,
            durationMin: task.durationMin,
            loggedMinutes: 0,
            priority: task.priority,
            recurrence: task.recurrence,
            seriesId: series,
            status: "active",
            createdAt: nowIso,
            updatedAt: nowIso,
          };
          tx.set(nextRef, copy);
        }
        tx.update(prevRef, { nextSpawned: true });
      });
    },
    [uid, timezone],
  );

  /** Complete a task: record the actual time, save it to the history, and create the next occurrence. */
  const complete = useCallback(
    async (task: Task, opts: { actualMin?: number } = {}) => {
      if (!uid) return;
      const nowDate = new Date();
      const tracked = (task.loggedMinutes ?? 0) + (task.startedAt ? minutesSince(task.startedAt, nowDate.getTime()) : 0);
      const picked = opts.actualMin ?? (tracked > 0 ? tracked : undefined);
      const actual = picked && Number.isFinite(picked) ? Math.max(1, Math.min(1440, Math.round(picked))) : undefined;

      await updateDoc(doc(db, "users", uid, "tasks", task.id), {
        status: "completed",
        completedAt: nowDate,
        updatedAt: nowDate,
        startedAt: deleteField(),
        ...(actual ? { loggedMinutes: actual } : {}),
      });

      // Best effort: the task is already completed, so a failure here must not look like one.
      const extras: Promise<unknown>[] = [];
      if (actual) {
        extras.push(
          setDoc(
            doc(db, "users", uid, "history", task.id).withConverter(historyConverter),
            makeHistoryRecord(task, actual, nowDate.toISOString()),
          ),
        );
      }
      if (task.recurrence) extras.push(ensureNext(task));
      const results = await Promise.allSettled(extras);
      for (const r of results) if (r.status === "rejected") console.warn("task completion follow-up failed:", r.reason);
    },
    [uid, ensureNext],
  );

  /**
   * Add time spent. Writes only the task doc: it never calls /api/schedule and never touches
   * the schedule, so logging time can't move existing blocks.
   */
  const logMinutes = useCallback(
    async (id: string, minutes: number) => {
      if (!uid) return;
      const m = Math.round(minutes);
      if (!Number.isFinite(m) || m < 1 || m > 1440) throw new Error("Enter 1–1440 minutes");
      await updateDoc(doc(db, "users", uid, "tasks", id), {
        loggedMinutes: increment(m),
        updatedAt: new Date(),
      });
    },
    [uid],
  );

  const startTimer = useCallback(
    async (id: string) => {
      if (uid) await updateDoc(doc(db, "users", uid, "tasks", id), { startedAt: new Date(), updatedAt: new Date() });
    },
    [uid],
  );

  /** Stop the timer and add the elapsed minutes to the time spent. */
  const stopTimer = useCallback(
    async (task: Task) => {
      if (!uid || !task.startedAt) return;
      const elapsed = Math.min(1440, minutesSince(task.startedAt, Date.now()));
      await updateDoc(doc(db, "users", uid, "tasks", task.id), {
        startedAt: deleteField(),
        updatedAt: new Date(),
        ...(elapsed > 0 ? { loggedMinutes: increment(elapsed) } : {}),
      });
    },
    [uid],
  );

  const setRecurrence = useCallback(
    async (task: Task, recurrence: Recurrence | null) => {
      if (!uid) return;
      const clean = cleanRecurrence(recurrence);
      await updateDoc(doc(db, "users", uid, "tasks", task.id), {
        recurrence: clean ?? deleteField(),
        ...(clean ? { seriesId: task.seriesId ?? task.id } : {}),
        updatedAt: new Date(),
      });
    },
    [uid],
  );

  /** Bring an expired (or active) task back with a new deadline. */
  const reschedule = useCallback(
    async (task: Task, deadlineIso: string) => {
      if (!uid) return;
      await updateDoc(doc(db, "users", uid, "tasks", task.id), {
        status: "active",
        deadline: new Date(deadlineIso),
        expiredAt: deleteField(),
        notified: false,
        notifiedOverdue: false,
        updatedAt: new Date(),
      });
    },
    [uid],
  );

  // ── Auto-expire: an active task whose deadline has passed leaves the canvas ──────────
  const expiring = useRef(new Set<string>());
  const onExpiredRef = useRef(onExpired);
  useEffect(() => {
    onExpiredRef.current = onExpired;
  });

  useEffect(() => {
    if (!uid || loading) return;
    const overdue = tasks.filter(
      (t) => t.status === "active" && Date.parse(t.deadline) <= now && !expiring.current.has(t.id),
    );
    if (overdue.length === 0) return;
    overdue.forEach((t) => expiring.current.add(t.id));
    void (async () => {
      const done: Task[] = [];
      for (const t of overdue) {
        try {
          const at = new Date();
          await updateDoc(doc(db, "users", uid, "tasks", t.id), {
            status: "expired",
            expiredAt: at,
            updatedAt: at,
          });
          done.push(t);
          if (t.recurrence) await ensureNext({ ...t, status: "expired" });
        } catch (e) {
          console.warn("expire failed:", t.id, e);
          expiring.current.delete(t.id); // retry on the next tick
        }
      }
      if (done.length) onExpiredRef.current?.(done);
    })();
  }, [uid, loading, tasks, now, ensureNext]);

  // ── New-day / app-load sweep: a series whose latest occurrence ended without a successor ──
  const sweptSeries = useRef(new Set<string>());
  useEffect(() => {
    if (!uid || loading) return;
    const latest = new Map<string, Task>();
    for (const t of tasks) {
      if (!t.recurrence) continue;
      const key = t.seriesId ?? t.id;
      const cur = latest.get(key);
      if (!cur || t.deadline > cur.deadline) latest.set(key, t);
    }
    for (const t of latest.values()) {
      if (t.status === "active" || t.nextSpawned || sweptSeries.current.has(t.id)) continue;
      sweptSeries.current.add(t.id);
      ensureNext(t).catch((e) => console.warn("recurrence sweep failed:", e));
    }
  }, [uid, loading, tasks, ensureNext]);

  return {
    tasks,
    loading,
    error,
    addTask,
    deleteTask,
    complete,
    logMinutes,
    startTimer,
    stopTimer,
    setRecurrence,
    reschedule,
  };
}
