"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { userConverter } from "@/lib/firebase/converters";
import { DEFAULT_SETTINGS } from "@/lib/firebase/users";
import type { User, UserSettings } from "@/types";

export function useUserProfile(uid: string | undefined) {
  const [profile, setProfile] = useState<User | null>(null);
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      doc(db, "users", uid).withConverter(userConverter),
      (snap) => setProfile(snap.exists() ? snap.data() : null),
      (e) => {
        console.warn("profile listener:", e.code);
        setProfile(null);
      },
    );
  }, [uid]);

  const timezone = profile?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Legacy docs can hold a partial `settings` (e.g. only notificationsEnabled, written by the push
  // setup), so fill every missing field from the defaults.
  const saved: Partial<UserSettings> = profile?.settings ?? {};
  const hoursOk = (t: unknown) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  const settings: UserSettings = {
    ...DEFAULT_SETTINGS,
    ...saved,
    workingHours:
      hoursOk(saved.workingHours?.start) && hoursOk(saved.workingHours?.end)
        ? saved.workingHours!
        : DEFAULT_SETTINGS.workingHours,
  };
  return { profile, timezone, settings };
}
