"use client";

import { scaleSubtasks } from "@/lib/subtasks";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  increment,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { historyConverter, taskConverter, toFirestoreData } from "@/lib/firebase/converters";
import { MAX_TOTAL_MIN, remainingMinutes, sessionMinutes, sessionSeconds, totalMinutes } from "@/lib/remaining";
import { cleanRecurrence, nextOccurrence } from "@/lib/recurrence";
import { makeHistoryRecord } from "@/lib/history";
import { oneDayFlagFor, withinOneDay } from "@/lib/oneDay";
import { deadlineMs, hasDeadline } from "@/lib/deadline";
import type { Pacing, Recurrence, Subtask, Task } from "@/types";

/** A user may keep at most this many active (uncompleted) tasks. */
export const MAX_ACTIVE_TASKS = 100;

/** Thrown when adding tasks would pass MAX_ACTIVE_TASKS. The message is the English UI text (translate with t()). */
export class TaskLimitError extends Error {
  constructor() {
    super("Active task limit (100) reached. Complete or remove some current tasks before adding more.");
  }
}

export interface NewTaskInput {
  title: string;
  deadline?: string; // ISO; omitted = no deadline
  durationMin?: number;
  description?: string;
  recurrence?: Recurrence;
  pacing?: Pacing;
  /** The user asked for exactly this many parts. */
  requestedParts?: number;
  /** Fixed time slot: the task starts exactly here and lasts durationMin. */
  fixedStartTime?: string;
  /** Duration guessed from the user's history; stored as an AI-style estimate, not as a user value. */
  historyEstimate?: { durationMin: number; reasoning: string };
}

/** What it takes to take a completion back. */
export interface CompleteUndo {
  before: Task;
  spawnedId: string | null;
}

/** Earliest deadline first; tasks without one go last. */
const byDeadline = (a: Task, b: Task) => deadlineMs(a) - deadlineMs(b) || (a.createdAt < b.createdAt ? -1 : 1);

export function useTasks(
  uid: string | undefined,
  timezone: string,
  now: number,
  /** Called with tasks that pass their deadline while the app is open. */
  onOverdue?: (tasks: Task[]) => void,
  /** Called when tasks enter their last 24 hours while the app is open ("1 day left"). */
  onOneDay?: (tasks: Task[]) => void,
) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    // No orderBy("deadline"): Firestore would silently drop tasks that have no deadline.
    const q = query(collection(db, "users", uid, "tasks").withConverter(taskConverter));
    return onSnapshot(
      q,
      (snap) => {
        setTasks(snap.docs.map((d) => d.data()).sort(byDeadline));
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

  const adjusting = useRef(new Set<string>()); // tasks with a time-left write in flight
  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  });

  /**
   * Create several tasks at once: ONE Firestore batch (so listeners see one update, not N) and the 100-active-task
   * limit checked up front. Nothing is written if the limit would be exceeded.
   */
  const addTasks = useCallback(
    async (inputs: NewTaskInput[]) => {
      if (!uid || inputs.length === 0) return;
      const active = tasksRef.current.filter((t) => t.status === "active").length;
      if (active + inputs.length > MAX_ACTIVE_TASKS) throw new TaskLimitError();
      const nowIso = new Date().toISOString();
      for (let i = 0; i < inputs.length; i += 400) {
        const batch = writeBatch(db);
        for (const input of inputs.slice(i, i + 400)) {
          const ref = doc(collection(db, "users", uid, "tasks")).withConverter(taskConverter);
          const recurrence = cleanRecurrence(input.recurrence);
          const task: Task = {
            id: ref.id,
            title: input.title.trim(),
            deadline: input.deadline || undefined,
            description: input.description?.trim() || undefined,
            durationMin: input.durationMin,
            loggedMinutes: 0,
            aiEstimate: input.historyEstimate
              ? { durationMin: input.historyEstimate.durationMin, reasoning: input.historyEstimate.reasoning, estimatedAt: nowIso }
              : undefined,
            oneDayNotified: (input.deadline && oneDayFlagFor(input.deadline, Date.now())) || undefined,
            recurrence,
            pacing: input.pacing,
            requestedParts: input.requestedParts,
            ...(input.fixedStartTime ? { isFixedTime: true, fixedStartTime: input.fixedStartTime, subtasksAttempted: true } : {}),
            seriesId: recurrence ? ref.id : undefined,
            status: "active",
            createdAt: nowIso,
            updatedAt: nowIso,
          };
          batch.set(ref, task);
        }
        await batch.commit();
      }
    },
    [uid],
  );
  const addTask = useCallback((input: NewTaskInput) => addTasks([input]), [addTasks]);

  const deleteTask = useCallback(
    async (task: Task) => {
      if (uid) await deleteDoc(doc(db, "users", uid, "tasks", task.id));
    },
    [uid],
  );

  /**
   * Create the next occurrence of a recurring task. The new task's id is derived from the series and
   * its day, and the whole thing is one transaction, so concurrent callers (two tabs, the new-day
   * sweep) can never create duplicates.
   */
  const ensureNext = useCallback(
    async (task: Task): Promise<string | null> => {
      if (!uid || !task.recurrence || !task.deadline) return null;
      const next = nextOccurrence(task.deadline, task.recurrence, timezone, Date.now());
      if (!next) return null;
      const series = task.seriesId ?? task.id;
      const nextRef = doc(db, "users", uid, "tasks", `${series}_${next.dateKey}`).withConverter(taskConverter);
      const prevRef = doc(db, "users", uid, "tasks", task.id);
      const nowIso = new Date().toISOString();
      let createdId: string | null = null;
      await runTransaction(db, async (tx) => {
        createdId = null; // the callback may run more than once
        const existing = await tx.get(nextRef);
        if (!existing.exists()) {
          createdId = nextRef.id;
          const copy: Task = {
            id: nextRef.id,
            title: task.title,
            deadline: next.deadline,
            description: task.description,
            durationMin: task.durationMin,
            loggedMinutes: 0,
            oneDayNotified: oneDayFlagFor(next.deadline, Date.now()) || undefined,
            recurrence: task.recurrence,
            pacing: task.pacing,
            seriesId: series,
            status: "active",
            createdAt: nowIso,
            updatedAt: nowIso,
          };
          tx.set(nextRef, copy);
        }
        tx.update(prevRef, { nextSpawned: true });
      });
      return createdId;
    },
    [uid, timezone],
  );

  /** Complete a task: record the actual time, save it to the history, and create the next occurrence. */
  const complete = useCallback(
    async (task: Task, opts: { actualMin?: number } = {}): Promise<CompleteUndo | null> => {
      if (!uid) return null;
      const nowDate = new Date();
      // Minutes already logged, plus whole minutes of an open timer session (rounded down).
      const tracked = (task.loggedMinutes ?? 0) + sessionMinutes(task, nowDate.getTime());
      const picked = opts.actualMin ?? (tracked > 0 ? tracked : undefined);
      const actual = picked && Number.isFinite(picked) ? Math.max(1, Math.min(1440, Math.round(picked))) : undefined;

      await updateDoc(doc(db, "users", uid, "tasks", task.id), {
        status: "completed",
        completedAt: nowDate,
        updatedAt: nowDate,
        startedAt: deleteField(),
        ...(actual ? { loggedMinutes: actual } : {}),
        accumulatedSeconds: deleteField(),
        // Finishing the task finishes all its parts.
        ...(task.subtasks?.length
          ? { subtasks: toFirestoreData(task.subtasks.map((s) => ({ ...s, completed: true }))) }
          : {}),
      });

      // Best effort: the task is already completed, so a failure here must not look like one.
      let spawnedId: string | null = null;
      const extras: Promise<unknown>[] = [];
      if (actual) {
        extras.push(
          setDoc(
            doc(db, "users", uid, "history", task.id).withConverter(historyConverter),
            makeHistoryRecord(task, actual, nowDate.toISOString()),
          ),
        );
      }
      if (task.recurrence) extras.push(ensureNext(task).then((id) => { spawnedId = id; }));
      const results = await Promise.allSettled(extras);
      for (const r of results) if (r.status === "rejected") console.warn("task completion follow-up failed:", r.reason);
      return { before: task, spawnedId };
    },
    [uid, ensureNext],
  );

  /** Take back a completion made seconds ago: the task, its history record and any spawned next occurrence. */
  const undoComplete = useCallback(
    async ({ before, spawnedId }: CompleteUndo) => {
      if (!uid) return;
      await updateDoc(doc(db, "users", uid, "tasks", before.id), {
        status: "active",
        completedAt: deleteField(),
        loggedMinutes: before.loggedMinutes ?? 0,
        startedAt: before.startedAt ? new Date(before.startedAt) : deleteField(),
        accumulatedSeconds: before.accumulatedSeconds ?? deleteField(),
        ...(before.subtasks ? { subtasks: toFirestoreData(before.subtasks) } : {}),
        ...(before.nextSpawned ? {} : { nextSpawned: deleteField() }),
        updatedAt: new Date(),
      });
      const cleanup: Promise<unknown>[] = [deleteDoc(doc(db, "users", uid, "history", before.id))];
      if (spawnedId) {
        // Only remove the auto-created copy if nobody has touched it since.
        const ref = doc(db, "users", uid, "tasks", spawnedId);
        cleanup.push(
          getDoc(ref).then((snap) => {
            const d = snap.data();
            if (snap.exists() && d?.status === "active" && !(d.loggedMinutes > 0)) return deleteDoc(ref);
          }),
        );
      }
      const results = await Promise.allSettled(cleanup);
      for (const r of results) if (r.status === "rejected") console.warn("undo cleanup failed:", r.reason);
    },
    [uid],
  );

  /**
   * Bring a completed task back to the canvas. If every part was done, the last one is reopened
   * (and its time taken back) so the task isn't "active" at 100%.
   */
  const restoreTask = useCallback(
    async (task: Task) => {
      if (!uid) return;
      const subs = task.subtasks;
      let reopen: Subtask | undefined;
      if (subs?.length && subs.every((s) => s.completed)) {
        reopen = [...subs].sort((a, b) => (b.scheduledStart ?? "").localeCompare(a.scheduledStart ?? ""))[0];
      }
      await updateDoc(doc(db, "users", uid, "tasks", task.id), {
        status: "active",
        completedAt: deleteField(),
        updatedAt: new Date(),
        ...(reopen && subs
          ? {
              subtasks: toFirestoreData(subs.map((s) => (s.id === reopen!.id ? { ...s, completed: false } : s))),
              loggedMinutes: Math.max(0, (task.loggedMinutes ?? 0) - reopen.durationMinutes),
            }
          : {}),
      });
    },
    [uid],
  );

  /** Bring back a task document that was just deleted (all fields as they were). */
  const restoreDeleted = useCallback(
    async (task: Task) => {
      if (uid) await setDoc(doc(db, "users", uid, "tasks", task.id).withConverter(taskConverter), task);
    },
    [uid],
  );

  /** Permanently delete tasks (chunks of 400, under the batch limit). */
  const deleteMany = useCallback(
    async (ids: string[]) => {
      if (!uid) return;
      for (let i = 0; i < ids.length; i += 400) {
        const batch = writeBatch(db);
        for (const id of ids.slice(i, i + 400)) batch.delete(doc(db, "users", uid, "tasks", id));
        await batch.commit();
      }
    },
    [uid],
  );

  /**
   * Add whole minutes spent. Writes only the task doc: it never calls /api/schedule and never touches
   * the schedule, so logging time can't move existing blocks.
   */
  const logMinutes = useCallback(
    async (task: Task, minutes: number) => {
      if (!uid) return;
      const m = Math.round(minutes);
      if (!Number.isFinite(m) || m < 1 || m > 1440) throw new Error("Enter 1–1440 minutes");
      await updateDoc(doc(db, "users", uid, "tasks", task.id), { loggedMinutes: increment(m), updatedAt: new Date() });
    },
    [uid],
  );

  /** Start (or resume) the timer: only `startedAt` is written; paused time stays in `accumulatedSeconds`. */
  const startTimer = useCallback(
    async (id: string) => {
      if (uid) await updateDoc(doc(db, "users", uid, "tasks", id), { startedAt: new Date(), updatedAt: new Date() });
    },
    [uid],
  );

  /** Pause: the elapsed seconds move into `accumulatedSeconds`; nothing is credited yet. */
  const stopTimer = useCallback(
    async (task: Task) => {
      if (!uid || !task.startedAt) return;
      await updateDoc(doc(db, "users", uid, "tasks", task.id), {
        startedAt: deleteField(),
        accumulatedSeconds: Math.round(sessionSeconds(task, Date.now())),
        updatedAt: new Date(),
      });
    },
    [uid],
  );

  /**
   * Stop & confirm: end the session, credit its WHOLE minutes (rounded down: 03:40 → 3, 00:40 → 0) to the time spent
   * (the time left follows, never below 0) and clear the session. Returns the minutes credited.
   */
  const confirmTimer = useCallback(
    async (task: Task): Promise<number> => {
      if (!uid) return 0;
      const minutes = sessionMinutes(task, Date.now());
      await updateDoc(doc(db, "users", uid, "tasks", task.id), {
        startedAt: deleteField(),
        accumulatedSeconds: deleteField(),
        ...(minutes > 0 ? { loggedMinutes: increment(minutes) } : {}),
        updatedAt: new Date(),
      });
      return minutes;
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

  /** Replace the whole parts list (add / edit / remove a part). */
  const saveSubtasks = useCallback(
    async (task: Task, subtasks: Subtask[]) => {
      if (!uid) return;
      await updateDoc(doc(db, "users", uid, "tasks", task.id), {
        subtasks: toFirestoreData(subtasks),
        subtasksAttempted: true,
        updatedAt: new Date(),
      });
    },
    [uid],
  );

  /**
   * Check / uncheck one part. Its duration is added to (or taken back from) the time spent, so the
   * remaining time drops and the bubble shrinks.
   */
  const toggleSubtask = useCallback(
    async (task: Task, subtaskId: string, completed: boolean) => {
      if (!uid) return;
      const sub = task.subtasks?.find((s) => s.id === subtaskId);
      if (!sub || sub.completed === completed) return;
      const subtasks = task.subtasks!.map((s) => (s.id === subtaskId ? { ...s, completed } : s));
      const delta = completed ? sub.durationMinutes : -Math.min(sub.durationMinutes, task.loggedMinutes ?? 0);
      await updateDoc(doc(db, "users", uid, "tasks", task.id), {
        subtasks: toFirestoreData(subtasks),
        ...(delta !== 0 ? { loggedMinutes: increment(delta) } : {}),
        updatedAt: new Date(),
      });
    },
    [uid],
  );

  /**
   * Add or take away planned time in 15-minute steps (the time left moves by `deltaMin`). Whole minutes only; never
   * less than 5 minutes left. Writes `durationMin`, so the bubble resizes and the plan follows.
   */
  const adjustRemaining = useCallback(
    async (task: Task, deltaMin: number) => {
      if (!uid) return;
      // One click = one change of exactly `deltaMin` on the TIME LEFT. The new value is worked out from the time left
      // the user is looking at and written as an absolute duration (spent + new time left), never as an increment on
      // top of a value that may already have been changed; and a second call for the same task is ignored while the
      // first write is in flight, so a doubled tap or handler can never apply the step twice.
      if (adjusting.current.has(task.id)) return;
      const current = remainingMinutes(task);
      const nextRemaining = Math.max(0, current + deltaMin);
      const total = Math.min(MAX_TOTAL_MIN, (task.loggedMinutes ?? 0) + nextRemaining);
      if (total === totalMinutes(task) && task.durationMin !== undefined) return;
      adjusting.current.add(task.id);
      try {
        await updateDoc(doc(db, "users", uid, "tasks", task.id), { durationMin: total, updatedAt: new Date() });
      } finally {
        adjusting.current.delete(task.id);
      }
    },
    [uid],
  );

  /**
   * Time SPENT, in exact whole minutes: the time left follows (total − spent, never below 0). The new value is
   * absolute and worked out from what is on screen, and a second call for the same task is ignored while the first
   * write is in flight, so one click can only ever change the time by one step.
   */
  const adjustSpent = useCallback(
    async (task: Task, deltaMin: number) => {
      if (!uid || adjusting.current.has(task.id)) return;
      const next = Math.min(MAX_TOTAL_MIN, Math.max(0, (task.loggedMinutes ?? 0) + deltaMin));
      if (next === (task.loggedMinutes ?? 0)) return;
      adjusting.current.add(task.id);
      try {
        await updateDoc(doc(db, "users", uid, "tasks", task.id), { loggedMinutes: next, updatedAt: new Date() });
      } finally {
        adjusting.current.delete(task.id);
      }
    },
    [uid],
  );
  const setSpent = useCallback(
    async (task: Task, minutes: number) => {
      if (!uid || !Number.isFinite(minutes) || adjusting.current.has(task.id)) return;
      const next = Math.min(MAX_TOTAL_MIN, Math.max(0, Math.floor(minutes)));
      if (next === (task.loggedMinutes ?? 0)) return;
      adjusting.current.add(task.id);
      try {
        await updateDoc(doc(db, "users", uid, "tasks", task.id), { loggedMinutes: next, updatedAt: new Date() });
      } finally {
        adjusting.current.delete(task.id);
      }
    },
    [uid],
  );

  /** Set the time left to an exact number of whole minutes (typed by the user). */
  const setRemaining = useCallback(
    async (task: Task, minutes: number) => {
      if (!uid || !Number.isFinite(minutes) || adjusting.current.has(task.id)) return;
      const next = Math.max(0, Math.floor(minutes));
      const total = Math.min(MAX_TOTAL_MIN, (task.loggedMinutes ?? 0) + next);
      if (total === totalMinutes(task) && task.durationMin !== undefined) return;
      adjusting.current.add(task.id);
      try {
        await updateDoc(doc(db, "users", uid, "tasks", task.id), { durationMin: total, updatedAt: new Date() });
      } finally {
        adjusting.current.delete(task.id);
      }
    },
    [uid],
  );

  /** Edit the basic fields. `durationMin` null = back to "let the AI guess". */
  const updateTask = useCallback(
    async (
      task: Task,
      patch: {
        title: string; deadline: string | null; durationMin: number | null; pacing: Pacing; loggedMinutes?: number;
        /** string: pin to this start · null: release the fixed slot · undefined: leave as is */
        fixedStartTime?: string | null;
      },
    ) => {
      if (!uid) return;
      const deadlineChanged = (patch.deadline ? Date.parse(patch.deadline) : null) !== (task.deadline ? Date.parse(task.deadline) : null);
      await updateDoc(doc(db, "users", uid, "tasks", task.id), {
        title: patch.title.trim(),
        deadline: patch.deadline ? new Date(patch.deadline) : deleteField(),
        durationMin: patch.durationMin ?? deleteField(),
        pacing: patch.pacing,
        ...(patch.loggedMinutes !== undefined ? { loggedMinutes: patch.loggedMinutes } : {}),
        // A new total on a split task: the parts are rescaled so they add up to it (the re-plan then re-packs them).
        ...(task.subtasks?.length && patch.durationMin && patch.durationMin !== task.durationMin && typeof patch.fixedStartTime !== "string"
          ? { subtasks: toFirestoreData(scaleSubtasks(task.subtasks, patch.durationMin)) }
          : {}),
        ...(typeof patch.fixedStartTime === "string"
          ? { isFixedTime: true, fixedStartTime: new Date(patch.fixedStartTime), subtasks: deleteField(), subtasksAttempted: true }
          : patch.fixedStartTime === null
            ? { isFixedTime: deleteField(), fixedStartTime: deleteField() }
            : {}),
        // A new deadline deserves fresh "due soon" / "expired" alerts.
        ...(deadlineChanged
          ? { notified: false, notifiedOverdue: false, notified24hDue: false, oneDayNotified: patch.deadline ? oneDayFlagFor(patch.deadline, Date.now()) : deleteField() }
          : {}),
        updatedAt: new Date(),
      });
    },
    [uid],
  );

  /**
   * Move an overdue (or any) task to a new deadline. Its old part slots are in the past, so they are
   * cleared: the re-plan that follows the deadline change gives the parts fresh slots.
   */
  const reschedule = useCallback(
    async (task: Task, deadlineIso: string | null) => {
      if (!uid) return;
      const nowMs = Date.now();
      const stale = (s: Subtask) => !s.completed && !!s.scheduledEnd && Date.parse(s.scheduledEnd) < nowMs;
      const subtasks = task.subtasks?.some(stale)
        ? task.subtasks.map((s) => {
            if (!stale(s)) return s;
            const { scheduledStart: _a, scheduledEnd: _b, pinned: _c, ...rest } = s;
            void _a; void _b; void _c;
            return rest;
          })
        : null;
      await updateDoc(doc(db, "users", uid, "tasks", task.id), {
        status: "active",
        deadline: deadlineIso ? new Date(deadlineIso) : deleteField(),
        expiredAt: deleteField(),
        notified: false,
        notifiedOverdue: false,
        notified24hDue: false,
        oneDayNotified: deadlineIso ? oneDayFlagFor(deadlineIso, Date.now()) : deleteField(),
        ...(subtasks ? { subtasks: toFirestoreData(subtasks) } : {}),
        updatedAt: new Date(),
      });
    },
    [uid],
  );

  const sweptSeries = useRef(new Set<string>());

  // ── Overdue tasks are never removed: they stay on the canvas in their own "Overdue" state. ──
  // Here we only (a) tell the user when something becomes overdue while the app is open, and
  // (b) make sure a recurring task's next occurrence exists even if the old one is never finished.
  const seenOverdue = useRef<Set<string> | null>(null);
  const onOverdueRef = useRef(onOverdue);
  useEffect(() => {
    onOverdueRef.current = onOverdue;
  });
  useEffect(() => {
    if (!uid || loading) return;
    const overdue = tasks.filter((t) => t.status === "active" && deadlineMs(t) < now);
    if (seenOverdue.current === null) {
      seenOverdue.current = new Set(overdue.map((t) => t.id)); // already overdue when the app opened: no toast
    } else {
      const fresh = overdue.filter((t) => !seenOverdue.current!.has(t.id));
      fresh.forEach((t) => seenOverdue.current!.add(t.id));
      if (fresh.length) onOverdueRef.current?.(fresh);
    }
    for (const t of overdue) {
      if (!t.recurrence || t.nextSpawned || sweptSeries.current.has(`o:${t.id}`)) continue;
      sweptSeries.current.add(`o:${t.id}`);
      ensureNext(t).catch((e) => console.warn("recurrence (overdue) failed:", e));
    }
  }, [uid, loading, tasks, now, ensureNext]);

  // ── "1 day left": once per task, when it enters its last 24 hours ───────────────────────
  // The claim is a transaction on the task's `oneDayNotified` flag, so two tabs (or the server's
  // reminder job) can never announce the same task twice. Runs on every clock tick and on load.
  const onOneDayRef = useRef(onOneDay);
  useEffect(() => {
    onOneDayRef.current = onOneDay;
  });
  const claiming = useRef(new Set<string>());
  useEffect(() => {
    if (!uid || loading) return;
    const due = tasks.filter(
      (t) => t.status === "active" && !t.oneDayNotified && hasDeadline(t) && withinOneDay(t.deadline!, now) && !claiming.current.has(t.id),
    );
    if (due.length === 0) return;
    due.forEach((t) => claiming.current.add(t.id));
    void (async () => {
      const won: Task[] = [];
      for (const t of due) {
        try {
          const ref = doc(db, "users", uid, "tasks", t.id);
          const claimed = await runTransaction(db, async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists() || snap.get("status") !== "active" || snap.get("oneDayNotified") === true) return false;
            tx.update(ref, { oneDayNotified: true });
            return true;
          });
          if (claimed) won.push(t);
        } catch (e) {
          console.warn("1-day notice failed:", t.id, e);
          claiming.current.delete(t.id); // try again on the next tick
        }
      }
      if (won.length) onOneDayRef.current?.(won);
    })();
  }, [uid, loading, tasks, now]);

  // Tasks that older versions marked "expired" are brought back: they show as Overdue now.
  const revived = useRef(new Set<string>());
  useEffect(() => {
    if (!uid || loading) return;
    for (const t of tasks) {
      if (t.status !== "expired" || revived.current.has(t.id)) continue;
      revived.current.add(t.id);
      updateDoc(doc(db, "users", uid, "tasks", t.id), { status: "active", expiredAt: deleteField(), updatedAt: new Date() }).catch(
        (e) => console.warn("revive failed:", e),
      );
    }
  }, [uid, loading, tasks]);

  // ── New-day / app-load sweep: a series whose latest occurrence ended without a successor ──
  useEffect(() => {
    if (!uid || loading) return;
    const latest = new Map<string, Task>();
    for (const t of tasks) {
      if (!t.recurrence) continue;
      const key = t.seriesId ?? t.id;
      const cur = latest.get(key);
      if (!cur || deadlineMs(t) > deadlineMs(cur)) latest.set(key, t);
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
    addTasks,
    deleteTask,
    deleteMany,
    restoreDeleted,
    restoreTask,
    undoComplete,
    complete,
    logMinutes,
    confirmTimer,
    startTimer,
    stopTimer,
    setRecurrence,
    saveSubtasks,
    toggleSubtask,
    updateTask,
    adjustRemaining,
    setRemaining,
    adjustSpent,
    setSpent,
    reschedule,
  };
}
