import "server-only";
import mammoth from "mammoth";

const INLINE = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const MAX_TEXT = 40_000;
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** What was read from one attached file: sent to Gemini inline (PDF, images) or as extracted text. */
export interface ReadFile {
  name: string;
  mimeType: string;
  kind: "inline" | "text";
  data?: string; // base64, for inline files
  text?: string;
}

/** Thrown with an English, user-safe message (the UI translates it). */
export class FileError extends Error {}

/** Open an attachment: PDFs and images stay binary for Gemini's multimodal input, everything else becomes text. */
export async function readFile(name: string, declaredType: string, bytes: Buffer): Promise<ReadFile> {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  let mimeType = declaredType;
  if (!mimeType || mimeType === "application/octet-stream") {
    mimeType = ({ pdf: "application/pdf", docx: DOCX, txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" } as Record<string, string>)[ext] ?? mimeType;
  }
  if (INLINE.has(mimeType)) return { name, mimeType, kind: "inline", data: bytes.toString("base64") };
  if (mimeType === DOCX || ext === "docx") {
    try {
      const text = (await mammoth.extractRawText({ buffer: bytes })).value.trim();
      if (!text) throw new FileError("No readable text in that file.");
      return { name, mimeType: DOCX, kind: "text", text: text.slice(0, MAX_TEXT) };
    } catch (e) {
      throw e instanceof FileError ? e : new FileError("Couldn't read that Word document.");
    }
  }
  if (mimeType.startsWith("text/") || mimeType === "application/json" || ["txt", "md", "csv", "json"].includes(ext)) {
    const text = bytes.toString("utf8").trim();
    if (!text) throw new FileError("No readable text in that file.");
    return { name, mimeType, kind: "text", text: text.slice(0, MAX_TEXT) };
  }
  throw new FileError("Unsupported file type. Use PDF, DOCX, TXT, MD, CSV, JSON or an image (PNG, JPG, WEBP).");
}
