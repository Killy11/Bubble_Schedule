"use client";

import { useCallback, useEffect, useRef } from "react";
import { effectiveDuration, effectivePriority } from "@/lib/bubbles/effective";
import type { Task } from "@/types";

/**
 * What the planner depends on. Completing a task or a part doesn't change it (finishing something
 * must not reshuffle the rest of the day), but creating, deleting, restoring, or changing a
 * deadline, priority, duration or the parts does.
 */
function planSignature(tasks: readonly Task[]): string {
  return tasks
    .filter((t) => t.status !== "completed")
    .map((t) =>
      [
        t.id,
        t.deadline,
        effectivePriority(t) ?? "",
        effectiveDuration(t) ?? "",
        t.pacing ?? "balanced",
        t.requestedParts ?? "",
        (t.subtasks ?? []).map((s) => `${s.id}:${s.durationMinutes}:${s.pinned ? s.scheduledStart : ""}`).join(","),
      ].join("|"),
    )
    .sort()
    .join("\n");
}

const DEBOUNCE_MS = 800;

/**
 * Keeps the whole plan in order: whenever the set of tasks, or a task's deadline / priority /
 * duration / parts, changes, ask /api/rebalance to re-plan everything by earliest deadline, then
 * priority. Changes made while the app was closed are picked up on the next edit, not on load.
 */
export function useRebalance(
  tasks: readonly Task[],
  ready: boolean,
  onResult: (unplaced: Array<{ id: string; title: string }>) => void,
) {
  const last = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef(false);
  const again = useRef(false);
  const cb = useRef(onResult);
  useEffect(() => {
    cb.current = onResult;
  });

  const run = useCallback(async () => {
    if (running.current) {
      again.current = true; // something changed mid-flight: go once more afterwards
      return;
    }
    running.current = true;
    try {
      do {
        again.current = false;
        const res = await fetch("/api/rebalance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nowISO: new Date().toISOString() }),
        });
        if (!res.ok) throw new Error(`rebalance ${res.status}`);
        const data = (await res.json()) as { unplaced?: Array<{ id: string; title: string }> };
        cb.current(data.unplaced ?? []);
      } while (again.current);
    } catch (e) {
      console.warn("rebalance failed:", e);
    } finally {
      running.current = false;
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    const sig = planSignature(tasks);
    if (last.current === null) {
      last.current = sig; // first look at the data: nothing to react to yet
      return;
    }
    if (sig === last.current) return;
    last.current = sig;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void run(), DEBOUNCE_MS);
  }, [tasks, ready, run]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
}
