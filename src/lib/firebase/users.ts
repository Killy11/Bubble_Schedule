import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import type { User as FirebaseUser } from "firebase/auth";
import { db } from "./client";
import { userConverter } from "./converters";
import type { User, UserSettings } from "@/types";

export const DEFAULT_SETTINGS: UserSettings = {
  workingHours: { start: "09:00", end: "18:00" },
  workingDays: [1, 2, 3, 4, 5],
  defaultTaskMinutes: 30,
  reminderLeadMinutes: 10,
  notificationsEnabled: false,
};

/** Create users/{uid} on first login; otherwise just bump lastLoginAt. */
export async function upsertUserProfile(fbUser: FirebaseUser): Promise<void> {
  const ref = doc(db, "users", fbUser.uid).withConverter(userConverter);
  const now = new Date().toISOString();
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(doc(db, "users", fbUser.uid), { lastLoginAt: new Date(now) });
    return;
  }
  const profile: User = {
    uid: fbUser.uid,
    displayName: fbUser.displayName,
    email: fbUser.email,
    photoURL: fbUser.photoURL,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    settings: DEFAULT_SETTINGS,
    createdAt: now,
    lastLoginAt: now,
  };
  await setDoc(ref, profile);
}

/** Remember that the user has seen (or skipped) the first-run tutorial. */
export async function markOnboardingComplete(uid: string): Promise<void> {
  await updateDoc(doc(db, "users", uid), { hasCompletedOnboarding: true });
}
