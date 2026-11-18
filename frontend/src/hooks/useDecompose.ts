"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { needsDecomposition } from "@/lib/subtasks";
import type { Subtask, Task } from "@/types";

export interface DecomposeResult {
  task: Task;
  subtasks: Subtask[];
  placed: number;
  total: number;
}

/**
 * Splits big tasks into scheduled parts via /api/decompose.
 *  - automatic: any active task estimated over 2 h that hasn't been split or tried yet
 *    (covers text, voice, chat, and durations the AI planner estimates later)
 *  - manual: `split(task)` from the "Split into subtasks with AI" button
 */
export function useDecompose(
  tasks: Task[],
  ready: boolean,
  onDone: (r: DecomposeResult) => void,
  onFail: (task: Task, message: string, manual: boolean) => void,
) {
  const [working, setWorking] = useState<ReadonlySet<string>>(new Set());
  const tried = useRef(new Set<string>());
  const cb = useRef({ onDone, onFail });
  useEffect(() => {
    cb.current = { onDone, onFail };
  });

  const run = useCallback(async (task: Task, force: boolean, parts?: number) => {
    setWorking((w) => new Set(w).add(task.id));
    try {
      const res = await fetch("/api/decompose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id, nowISO: new Date().toISOString(), force, parts }),
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; skipped?: boolean; subtasks?: Subtask[]; placed?: number; total?: number }
        | null;
      if (!res.ok) throw new Error(data?.error ?? "Couldn't split this task.");
      if (data?.subtasks) cb.current.onDone({ task, subtasks: data.subtasks, placed: data.placed ?? 0, total: data.total ?? 0 });
    } catch (e) {
      cb.current.onFail(task, e instanceof Error ? e.message : "Couldn't split this task.", force);
    } finally {
      setWorking((w) => {
        const n = new Set(w);
        n.delete(task.id);
        return n;
      });
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    for (const t of tasks) {
      if (!needsDecomposition(t) || tried.current.has(t.id)) continue;
      tried.current.add(t.id);
      void run(t, false);
    }
  }, [tasks, ready, run]);

  /** Manual split; `parts` is the number the user asked for (omit to let the AI decide). */
  const split = useCallback((task: Task, parts?: number) => run(task, true, parts), [run]);
  return { working, split };
}
