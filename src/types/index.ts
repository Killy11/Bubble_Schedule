export type ISODateTime = string; // "2026-11-16T09:30:00.000Z"; converters map to/from Timestamp
export type DateKey = string; // "YYYY-MM-DD" in the user's timezone
/** Focus intensity: how a task is laid out in the schedule. */
export type Pacing = "chill" | "balanced" | "locked";

/** users/{uid} */
export interface User {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  timezone: string; // IANA, e.g. "Europe/Kyiv"
  settings: UserSettings;
  /** FCM registration tokens, one per browser/device that enabled notifications. */
  fcmTokens?: string[];
  /** Set once the user has finished (or skipped) the first-run walkthrough. */
  hasCompletedOnboarding?: boolean;
  createdAt: ISODateTime;
  lastLoginAt: ISODateTime;
}

export interface UserSettings {
  workingHours: { start: string; end: string }; // "HH:mm"
  workingDays: number[]; // 0–6, Sun=0
  defaultTaskMinutes: number;
  reminderLeadMinutes: number;
  notificationsEnabled: boolean;
  /** Interface language (default English). */
  language?: "en" | "uk";
  /** Quiet hours: 24-hour deadline reminders wait until they end. Start-of-task alerts are still sent. */
  quietHoursEnabled?: boolean;
  /** "HH:MM". Unless `quietHoursCustom`, these follow the working hours (quiet = end of the day → start of the next). */
  quietHoursStart?: string;
  quietHoursEnd?: string;
  quietHoursCustom?: boolean;
  /** Older nested form, still read as a fallback. */
  quietHours?: { enabled: boolean; start: string; end: string };
}

/** users/{uid}/devices/{tokenHash} */
export interface Device {
  token: string;
  userAgent: string;
  createdAt: ISODateTime;
  lastSeenAt: ISODateTime;
}

/** How a task repeats. "weekly" repeats on the weekday of its deadline; "custom" uses `days` (0–6, Sun=0). */
export interface Recurrence {
  type: "daily" | "weekdays" | "weekly" | "custom";
  days?: number[];
}

/** users/{uid}/history/{taskId}: one record per completed task with a known actual duration. */
export interface HistoryRecord {
  id: string;
  title: string;
  normalizedTitle: string;
  keywords: string[];
  estimatedMin?: number;
  actualMin: number;
  completedAt: ISODateTime;
}

/** One part of a large task, with the time window in which to work on it. */
export interface Subtask {
  id: string;
  title: string;
  durationMinutes: number;
  scheduledStart?: ISODateTime;
  scheduledEnd?: ISODateTime;
  completed: boolean;
  /** The user set this time by hand: automatic re-planning works around it instead of moving it. */
  pinned?: boolean;
  /** The start time the "starting in 5 min" push was sent for. A different start (moved / snoozed) re-arms it. */
  notified5mStart?: string;
}

/** users/{uid}/tasks/{taskId} */
export interface Task {
  id: string;
  title: string; // REQUIRED
  /** OPTIONAL. Without one the task stays active, is always green and never becomes overdue. */
  deadline?: ISODateTime;
  description?: string;
  durationMin?: number; // OPTIONAL, user-provided
  loggedMinutes: number; // whole minutes already spent (defaults to 0); shrinks the bubble
  /** Exact time spent / left / planned, in seconds. `loggedMinutes` and `durationMin` are kept in step (floor / ceil). */
  spentSeconds?: number;
  remainingSeconds?: number;
  durationSeconds?: number;
  aiEstimate?: {
    durationMin?: number;
    reasoning?: string;
    estimatedAt: ISODateTime;
  };
  status: "active" | "completed" | "expired";
  /** Focus intensity (default "balanced"). */
  pacing?: Pacing;
  /** The user explicitly asked to split this task into this many parts. */
  requestedParts?: number;
  /** Large tasks are split into sequential parts, each with its own time slot. */
  subtasks?: Subtask[];
  /** AI splitting has been tried (success or not), so it isn't tried again automatically. */
  subtasksAttempted?: boolean;
  /** Repeat rule. Occurrences of one series share `seriesId`; the next one is created when this one ends. */
  recurrence?: Recurrence;
  seriesId?: string;
  /** The next occurrence has been created (so it is never created twice). */
  nextSpawned?: boolean;
  /** Set while the task's timer is running. */
  startedAt?: ISODateTime;
  /** Set when the deadline passed without the task being completed. */
  expiredAt?: ISODateTime;
  /** Set by /api/cron/notifications once the "due soon" / "overdue" push has been sent. */
  notified?: boolean;
  notifiedOverdue?: boolean;
  /** The "1 day left" warning has been shown / pushed (once per task). */
  oneDayNotified?: boolean;
  /** The background "1 day left" push has been claimed (the server also honours `oneDayNotified`). */
  notified24hDue?: boolean;
  completedAt?: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}
// Effective values: durationMin ?? aiEstimate?.durationMin ?? settings.defaultTaskMinutes.
// User values always win. The AI never overwrites durationMin.

/** users/{uid}/schedules/{dateKey} */
export interface Schedule {
  dateKey: DateKey;
  blocks: ScheduleBlock[]; // sorted by start
  version: number;
  /** Active task ids the AI had seen at the last run; anything outside it is a "new" task. */
  consideredTaskIds?: string[];
  lastChange?: ChangeSummary;
  generatedBy: "ai" | "manual";
  updatedAt: ISODateTime;
}

export interface ScheduleBlock {
  id: string;
  taskId: string;
  title: string; // denormalized for rendering and push text
  start: ISODateTime;
  end: ISODateTime;
  reason?: string;
  status: "planned" | "done" | "skipped";
  /** User set this time by hand. The AI treats it as immovable and plans around it. */
  isPinned?: boolean;
  /** The start time the "starting in 5 min" push was sent for (see Subtask.notified5mStart). */
  notified5mStart?: string;
}

export interface ChangeSummary {
  summary: string;
  /** Machine-readable form of `summary` for server-written messages, so the UI can show it in its own language. */
  code?: "replanned" | "replanned_unplaced";
  count?: number;
  changes: Array<{
    type: "added" | "moved" | "removed" | "resized";
    taskId: string;
    title: string;
    from?: { start: ISODateTime; end: ISODateTime };
    to?: { start: ISODateTime; end: ISODateTime };
    why: string;
  }>;
  triggeredBy: "auto-schedule" | "user-message";
  messageId?: string;
  at: ISODateTime;
}

/** users/{uid}/messages/{messageId} */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  kind: "text" | "auto-schedule-request" | "schedule-update" | "note";
  scheduleVersion?: number;
  changeSummary?: ChangeSummary;
  status: "sent" | "pending" | "error";
  /** Files attached to this message (names and a tiny preview only; the files themselves are not stored). */
  attachments?: Array<{ name: string; type: string; size: number; thumb?: string }>;
  createdAt: ISODateTime;
}

/** reminders/{reminderId}; written server-side only */
export interface Reminder {
  id: string; // `${uid}_${blockId}`
  uid: string;
  taskId: string;
  blockId: string;
  title: string;
  fireAt: ISODateTime; // block.start − reminderLeadMinutes
  sent: boolean;
  sentAt?: ISODateTime;
}
