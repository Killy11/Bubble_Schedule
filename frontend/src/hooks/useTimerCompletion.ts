"use client";

import { useEffect, useRef } from "react";
import { remainingMinutes, targetEndAt } from "@/lib/remaining";
import type { Task } from "@/types";

const KEY = "bs:timerDone";

function seenBefore(key: string): boolean {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[];
    if (list.includes(key)) return true;
    localStorage.setItem(KEY, JSON.stringify([...list.slice(-49), key]));
  } catch {
    /* storage blocked: the in-memory set still dedupes this session */
  }
  return false;
}

/**
 * Fires `onDone` once when a RUNNING timer's countdown reaches 00:00. The check compares real epoch time with
 * `targetEndAt` (start time + the time left), so it is exact after a background tab or a locked phone wakes up: it
 * runs every second AND on visibilitychange / focus. Each completion fires once (keyed by task and end time), so a
 * snapshot update or a reload never repeats it; adding more time creates a new end time and a new alert.
 */
export function useTimerCompletion(tasks: readonly Task[], onDone: (task: Task) => void) {
  const latest = useRef({ tasks, onDone });
  useEffect(() => {
    latest.current = { tasks, onDone };
  });
  const fired = useRef(new Set<string>());
  const anyRunning = tasks.some((t) => !!t.startedAt && t.status === "active");

  useEffect(() => {
    if (!anyRunning) return;
    const check = () => {
      const now = Date.now();
      for (const t of latest.current.tasks) {
        if (t.status !== "active" || !t.startedAt) continue;
        const end = targetEndAt(t);
        if (end === null || remainingMinutes(t) <= 0 || now < end) continue;
        const key = `${t.id}:${Math.round(end / 1000)}`;
        if (fired.current.has(key)) continue;
        fired.current.add(key);
        if (!seenBefore(key)) latest.current.onDone(t);
      }
    };
    check();
    const id = setInterval(check, 1000);
    const onWake = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", check);
    };
  }, [anyRunning]);
}
