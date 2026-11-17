import type {
  ChangeSummary,
  ChatMessage,
  DateKey,
  ISODateTime,
  Priority,
  Schedule,
  Task,
} from "./index";

export interface ScheduleRequest {
  message?: string; // omitted for pure "Auto-Schedule"
  trigger: "auto-schedule" | "user-message";
  targetDate: DateKey;
  nowISO: ISODateTime; // client clock, for "I overslept"
}

/** Structured output from gpt-4o-mini (response_format: json_schema, strict) */
export interface AiScheduleResult {
  taskEstimates: Array<{
    taskId: string;
    durationMin: number;
    priority: Priority;
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
}

/** A task the assistant extracted, matching the Task schema (title, priority, time). */
export interface AssistantTask {
  title: string; // ≤ 100 chars
  deadline: ISODateTime; // required; UTC ISO
  priority?: Priority;
  durationMin?: number;
  /** The user gave no time, so the server picked one (end of today, or tomorrow). */
  assumedDeadline: boolean;
}

export interface AssistantResponse {
  /** create_tasks: add these bubbles · schedule: re-plan the day (client calls /api/schedule) · answer: just reply */
  intent: "create_tasks" | "schedule" | "answer";
  reply: string;
  tasks: AssistantTask[];
  /** true when GEMINI_API_KEY is missing and a canned heuristic response was returned */
  mock?: boolean;
}
