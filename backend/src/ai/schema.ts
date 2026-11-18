
/**
 * What the model returns. Times are WALL-CLOCK local times ("YYYY-MM-DDTHH:mm", user's timezone);
 * the server converts them to UTC ISO and computes the detailed `changes` diff itself, so the
 * model cannot get offsets or the diff wrong. Final result is the agreed AiScheduleResult.
 */
export interface AiRawResult {
  taskEstimates: Array<{ taskId: string; durationMin: number; reasoning: string }>;
  blocks: Array<{ taskId: string; start: string; end: string; reason: string }>;
  unscheduled: Array<{ taskId: string; reason: string }>;
  summary: string;
  reply: string;
}

/** JSON Schema the model's reply is constrained to (Gemini responseJsonSchema). */
export const SCHEDULE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["taskEstimates", "blocks", "unscheduled", "summary", "reply"],
  properties: {
    taskEstimates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["taskId", "durationMin", "reasoning"],
        properties: {
          taskId: { type: "string" },
          durationMin: { type: "integer" },
          reasoning: { type: "string" },
        },
      },
    },
    blocks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["taskId", "start", "end", "reason"],
        properties: {
          taskId: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
    unscheduled: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["taskId", "reason"],
        properties: { taskId: { type: "string" }, reason: { type: "string" } },
      },
    },
    summary: { type: "string" },
    reply: { type: "string" },
  },
} as const;
