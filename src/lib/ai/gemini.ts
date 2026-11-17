import "server-only";
import { ApiError, GoogleGenAI, ThinkingLevel } from "@google/genai";

/** Preferred model. Override with GEMINI_API_MODEL (or GEMINI_MODEL) in .env.local. */
export const GEMINI_MODEL =
  process.env.GEMINI_API_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";

/**
 * Tried in order when the preferred model is retired for your key (404) or unavailable (overloaded /
 * timing out). Google has stopped offering 2.5 Flash to new API keys, so this skips it automatically.
 * Fast Flash-Lite models come first because the full Flash models were timing out under load; the
 * first model that works is remembered for later calls.
 */
const FALLBACK_MODELS = ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.7-flash"];
/** Worth one retry on the same model. (504/timeouts are not: that model is stuck, so move on.) */
const RETRY_SAME_MODEL = new Set([429, 500, 503]);
const MOVE_ON = new Set([404, 504]);

let activeModel = GEMINI_MODEL;

export const hasGeminiKey = (): boolean => !!process.env.GEMINI_API_KEY;

export interface Turn {
  role: "user" | "model";
  text: string;
}

export class AiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

let client: GoogleGenAI | null = null;
// A request that hangs (overloaded model) must not hang the API route: time out and move on.
const REQUEST_TIMEOUT_MS = 15_000;
const getClient = () =>
  (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { timeout: REQUEST_TIMEOUT_MS } }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * "none" = as little reasoning as the model allows (fastest), "low" = a little reasoning.
 * Families configure this differently, and not every model accepts every setting.
 */
export type Effort = "none" | "low";
/** Models that rejected a thinking setting: from then on they run with their own default. */
const noThinkingConfig = new Set<string>();
function thinkingFor(model: string, effort: Effort) {
  if (noThinkingConfig.has(model)) return {};
  if (/gemini-2\.5-flash/i.test(model))
    return { thinkingConfig: { thinkingBudget: effort === "none" ? 0 : 1024 } };
  if (/gemini-3/i.test(model)) return { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } };
  return {}; // unknown family (e.g. Pro): the model's default
}

async function callOnce<T>(model: string, o: { system: string; turns: Turn[]; schema: unknown; temperature: number; effort: Effort }): Promise<T> {
  const res = await getClient().models.generateContent({
    model,
    contents: o.turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    config: {
      systemInstruction: o.system,
      responseMimeType: "application/json",
      responseJsonSchema: o.schema,
      temperature: o.temperature,
      ...thinkingFor(model, o.effort),
    },
  });
  const text = res.text;
  if (!text) {
    const why = res.promptFeedback?.blockReason ?? res.candidates?.[0]?.finishReason ?? "empty response";
    throw new AiError(`No answer from the model (${why})`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AiError("The model returned malformed JSON");
  }
}

/**
 * One structured-JSON call to Gemini. The reply is constrained to `schema` (JSON Schema), so it is
 * always parseable JSON of that shape. Transient errors are retried, then the next model is tried.
 */
export async function generateJson<T>(opts: {
  system: string;
  turns: Turn[];
  schema: unknown;
  temperature?: number;
  effort?: Effort;
}): Promise<T> {
  const o = { ...opts, temperature: opts.temperature ?? 0.3, effort: opts.effort ?? "low" };
  const candidates = [...new Set([activeModel, GEMINI_MODEL, ...FALLBACK_MODELS])];
  let lastError: unknown;

  for (const model of candidates) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = await callOnce<T>(model, o);
        activeModel = model;
        return out;
      } catch (e) {
        const timedOut = !(e instanceof ApiError) && /timeout|timed out|abort/i.test(String((e as Error)?.message ?? e));
        const err = e instanceof ApiError ? new AiError(e.message, e.status) : timedOut ? new AiError("Request timed out", 504) : e;
        lastError = err;
        const status = err instanceof AiError ? err.status : undefined;
        const msg = err instanceof Error ? err.message : "";
        if (status !== undefined && MOVE_ON.has(status)) break; // retired or stuck: next model
        if (status === 400 && /thinking/i.test(msg) && !noThinkingConfig.has(model)) {
          noThinkingConfig.add(model); // this model dislikes our thinking setting: retry without it
          attempt--;
          continue;
        }
        if (status !== undefined && RETRY_SAME_MODEL.has(status)) {
          if (attempt === 0) await sleep(800);
          continue; // retry once, then fall through to the next model
        }
        throw err instanceof Error ? err : new AiError("AI request failed");
      }
    }
  }
  throw lastError instanceof Error ? lastError : new AiError("AI request failed");
}

/** HTTP status + a user-safe message for an AI failure (details stay in the server log). */
export function describeAiError(e: unknown): { message: string; status: number } {
  const status = e instanceof AiError ? e.status : undefined;
  if (status === 429 || status === 503)
    return { message: "The AI is busy right now. Please try again in a moment.", status: 503 };
  if (status === 400 || status === 401 || status === 403)
    return { message: "The AI request was rejected. Check GEMINI_API_KEY in .env.local.", status: 502 };
  if (status === 404)
    return { message: "No available Gemini model for this key. Set GEMINI_API_MODEL in .env.local.", status: 502 };
  return { message: "The AI assistant is unavailable right now. Please try again.", status: 502 };
}
