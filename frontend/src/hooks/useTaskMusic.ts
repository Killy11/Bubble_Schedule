"use client";

import { useEffect, useSyncExternalStore } from "react";
import { isMusicMuted, startTaskMusic, stopTaskMusic, subscribeMusicMuted } from "@/lib/taskMusic";

/** Plays the task music while at least one timer is running, and stops it when none is (pause, credit, complete). */
export function useTaskMusic(timerRunning: boolean) {
  useEffect(() => {
    if (timerRunning) startTaskMusic();
    else stopTaskMusic();
    return () => stopTaskMusic();
  }, [timerRunning]);
}

/** Mute state for the Music button. */
export function useMusicMuted(): boolean {
  return useSyncExternalStore(subscribeMusicMuted, isMusicMuted, () => false);
}
