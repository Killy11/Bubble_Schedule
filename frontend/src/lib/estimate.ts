import type { Pacing } from "@/types";

export const ESTIMATE_MAX_BYTES = 4 * 1024 * 1024;
/** What the file picker accepts. */
export const ESTIMATE_ACCEPT = ".pdf,.docx,.txt,.md,application/pdf,image/png,image/jpeg,image/webp,text/plain,text/markdown";

export interface FileEstimate {
  suggestedTitle: string;
  estimatedMinutes: number;
  recommendedFocus: "chill" | "balanced" | "locked-in";
  reasoning: string;
  shouldSplit: boolean;
  suggestedParts: number | null;
}

export const focusToPacing = (f: FileEstimate["recommendedFocus"]): Pacing => (f === "locked-in" ? "locked" : f);

/** Upload one file for analysis. Throws an Error with a message that is safe to show (English; the UI translates known ones). */
export async function estimateFile(file: File, lang: "en" | "uk", message?: string, signal?: AbortSignal): Promise<FileEstimate> {
  if (file.size > ESTIMATE_MAX_BYTES) throw new Error("The file is larger than 4 MB.");
  const form = new FormData();
  form.set("file", file);
  form.set("lang", lang);
  if (message) form.set("message", message);
  const res = await fetch("/api/estimate-task", { method: "POST", body: form, signal });
  const body = (await res.json().catch(() => null)) as (FileEstimate & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? "Couldn't analyse that file.");
  return body;
}
