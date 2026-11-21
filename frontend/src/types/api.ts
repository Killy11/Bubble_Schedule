import type {
  ChangeSummary,
  ChatMessage,
  DateKey,
  ISODateTime,
  Schedule,
  Task,
} from "./index";

export interface ScheduleRequest {
  message?: string; // omitted for pure "Auto-Schedule"
  trigger: "auto-schedule" | "user-message";
  targetDate: DateKey;
  nowISO: ISODateTime; // client clock, for "I overslept"
  /** UI language: the AI writes its summary and replies in it. */
  lang?: "en" | "uk";
}

/** Structured output from gpt-4o-mini (response_format: json_schema, strict) */
export interface AiScheduleResult {
  taskEstimates: Array<{
    taskId: string;
    durationMin: number;
    reasoning: string;
  }>;
  blocks: Array<{
    taskId: string;
    start: ISODateTime;
    end: ISODateTime;
    reason: string;
  }>;
  unscheduled: Array<{ taskId: string; reason: string }>;
  changes: ChangeSummary["changes"];
  reply: string;
}

export interface ScheduleResponse {
  schedule: Schedule;
  assistantMessage: ChatMessage;
  updatedTasks: Task[];
}

/** POST /api/session */
export interface SessionRequest {
  idToken: string;
}

/** POST /api/assistant: natural language → structured tasks / intent */
export interface AssistantRequest {
  message: string;
  nowISO: ISODateTime;
  /** The device's real IANA zone (e.g. "Europe/Kyiv"): the server clock is UTC, so "10:00" must be read in this zone. */
  timeZone?: string;
}

/** A task the assistant extracted, matching the Task schema (title, time). */
export interface AssistantTask {
  title: string; // ≤ 100 chars
  /** UTC ISO. Omitted when the user stated no date or time: the task has no deadline. */
  deadline?: ISODateTime;
  durationMin?: number;
  /** Requested time window ("from 17:00 to 19:00"): the task is pinned to exactly this slot. */
  fixedStart?: ISODateTime;
}

/** A change to an existing task, applied on the client through the shared task state. */
export interface AssistantAction {
  type: "update" | "complete" | "delete" | "split" | "defer_others";
  taskId: string;
  /** Plan this task no earlier than this moment ("the rest tomorrow"). Never changes the deadline. */
  deferUntil?: ISODateTime;
  /** split: how many parts. */
  parts?: number;
  title?: string;
  deadline?: ISODateTime;
  removeDeadline?: boolean;
  durationMin?: number;
  /** Pin the task to exactly this start (its length is durationMin). */
  fixedStart?: ISODateTime;
  /** Release a fixed time slot: the planner moves the task freely again. */
  clearFixed?: boolean;
  /** Set: the change is for this one part of the task only (its time window, or "complete" / "delete" of that part). */
  subtaskId?: string;
  /** Filled by the server, for the one-line "latest AI change" note. */
  taskTitle?: string;
  subtaskTitle?: string;
}

export interface AssistantResponse {
  /** create_tasks: add these bubbles · schedule: re-plan the day (client calls /api/schedule) · answer: just reply */
  intent: "create_tasks" | "modify_tasks" | "schedule" | "answer";
  reply: string;
  tasks: AssistantTask[];
  actions: AssistantAction[];
  /** true when GEMINI_API_KEY is missing and a canned heuristic response was returned */
  mock?: boolean;
}
