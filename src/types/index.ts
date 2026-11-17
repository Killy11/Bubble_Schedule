export type ISODateTime = string; // "2026-11-16T09:30:00.000Z"; converters map to/from Timestamp
export type DateKey = string; // "YYYY-MM-DD" in the user's timezone
export type Priority = "low" | "medium" | "high";

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
}

/** users/{uid}/tasks/{taskId} */
export interface Task {
  id: string;
  title: string; // REQUIRED
  deadline: ISODateTime; // REQUIRED
  description?: string;
  durationMin?: number; // OPTIONAL, user-provided
  loggedMinutes: number; // time already spent (defaults to 0); shrinks the bubble
  priority?: Priority; // OPTIONAL, user-provided
  aiEstimate?: {
    durationMin?: number;
    priority?: Priority;
    reasoning?: string;
    estimatedAt: ISODateTime;
  };
  status: "active" | "completed" | "expired";
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
  completedAt?: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}
// Effective values: durationMin ?? aiEstimate?.durationMin ?? settings.defaultTaskMinutes.
// User values always win. The AI never overwrites durationMin or priority.

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
}

export interface ChangeSummary {
  summary: string;
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
  kind: "text" | "auto-schedule-request" | "schedule-update";
  scheduleVersion?: number;
  changeSummary?: ChangeSummary;
  status: "sent" | "pending" | "error";
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
