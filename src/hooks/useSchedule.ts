"use client";

import { useCallback, useEffect, useState } from "react";
import { doc, onSnapshot, runTransaction, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { scheduleConverter, toFirestoreData } from "@/lib/firebase/converters";
import type { DateKey, Schedule, ScheduleBlock } from "@/types";

export function useSchedule(uid: string | undefined, dateKey: DateKey) {
  const [schedule, setSchedule] = useState<Schedule | null>(null);

  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      doc(db, "users", uid, "schedules", dateKey).withConverter(scheduleConverter),
      (snap) => setSchedule(snap.exists() ? snap.data() : null),
      (e) => {
        console.warn("schedule listener:", e.code);
        setSchedule(null);
      },
    );
  }, [uid, dateKey]);

  /** Mark every block of a task as done (called when its bubble is completed). */
  const markTaskBlocksDone = useCallback(
    async (taskId: string) => {
      if (!uid || !schedule?.blocks.some((b) => b.taskId === taskId)) return;
      const blocks = schedule.blocks.map((b) =>
        b.taskId === taskId ? { ...b, status: "done" as const } : b,
      );
      await updateDoc(doc(db, "users", uid, "schedules", dateKey), {
        blocks: toFirestoreData(blocks),
        updatedAt: new Date(),
      });
    },
    [uid, dateKey, schedule],
  );

  /** Keep the denormalized block titles in sync after a task is renamed. */
  const renameTaskBlocks = useCallback(
    async (taskId: string, title: string) => {
      if (!uid || !schedule?.blocks.some((b) => b.taskId === taskId && b.title !== title)) return;
      const blocks = schedule.blocks.map((b) => (b.taskId === taskId ? { ...b, title } : b));
      await updateDoc(doc(db, "users", uid, "schedules", dateKey), {
        blocks: toFirestoreData(blocks),
        updatedAt: new Date(),
      });
    },
    [uid, dateKey, schedule],
  );

  /**
   * Change one block (read-modify-write in a transaction, so it can't clobber a concurrent AI write).
   * `patch` null = leave it as is.
   */
  const patchBlock = useCallback(
    async (blockId: string, patch: (b: ScheduleBlock) => ScheduleBlock) => {
      if (!uid) return;
      const ref = doc(db, "users", uid, "schedules", dateKey).withConverter(scheduleConverter);
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const cur = snap.data();
        if (!cur?.blocks.some((b) => b.id === blockId)) throw new Error("That block no longer exists");
        const blocks = cur.blocks.map((b) => (b.id === blockId ? patch(b) : b)).sort((a, b) => a.start.localeCompare(b.start));
        tx.update(doc(db, "users", uid, "schedules", dateKey), {
          blocks: toFirestoreData(blocks),
          updatedAt: new Date(),
        });
      });
    },
    [uid, dateKey],
  );

  /** Manual edit: new time. `pinned` decides whether the AI may move the block later. */
  const editBlock = useCallback(
    (blockId: string, start: string, end: string, pinned: boolean) =>
      patchBlock(blockId, (b) => ({ ...b, start, end, isPinned: pinned, reason: "Time set by you" })),
    [patchBlock],
  );

  return { schedule, markTaskBlocksDone, renameTaskBlocks, editBlock };
}
