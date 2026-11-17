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
  status: "active" | "completed";
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
