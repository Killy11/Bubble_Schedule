"use client";

import { useCallback, useEffect, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  increment,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { taskConverter, toFirestoreData } from "@/lib/firebase/converters";
import type { Priority, Task } from "@/types";

export interface NewTaskInput {
  title: string;
  deadline: string; // ISO
  durationMin?: number;
  priority?: Priority;
  description?: string;
}

export function useTasks(uid: string | undefined) {
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
      const now = new Date().toISOString();
      const task: Task = {
        id: ref.id,
        title: input.title.trim(),
        deadline: input.deadline,
        description: input.description?.trim() || undefined,
        durationMin: input.durationMin,
        loggedMinutes: 0,
        priority: input.priority,
        status: "active",
        createdAt: now,
        updatedAt: now,
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

  const setCompleted = useCallback(
    async (id: string) => {
      if (!uid) return;
      const now = new Date();
      await updateDoc(
        doc(db, "users", uid, "tasks", id),
        toFirestoreData({
          status: "completed",
          completedAt: now.toISOString(),
          updatedAt: now.toISOString(),
        }) as Record<string, unknown>,
      );
    },
    [uid],
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

  return { tasks, loading, error, addTask, deleteTask, setCompleted, logMinutes };
}
