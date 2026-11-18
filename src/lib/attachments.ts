import { compressImage } from "@/lib/image";

/** Everything the chat can open: documents, text formats and images. */
export const CHAT_ACCEPT = ".pdf,.txt,.md,.csv,.json,.docx,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp,application/pdf";
export const CHAT_MAX_FILES = 3;
/** One request must stay well below the host's ~4.5 MB body limit. */
export const CHAT_MAX_TOTAL_BYTES = 4 * 1024 * 1024;

const EXT_OK = new Set(["pdf", "txt", "md", "csv", "json", "docx", "png", "jpg", "jpeg", "webp"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp"]);

export const extOf = (name: string) => name.toLowerCase().split(".").pop() ?? "";
export const isImage = (f: { name: string; type: string }) => f.type.startsWith("image/") || IMAGE_EXT.has(extOf(f.name));

/** English UI message for a file the chat can't take, or null when it is fine (translate with t()). */
export function attachmentProblem(f: File): string | null {
  const ext = extOf(f.name);
  if (!EXT_OK.has(ext) && !(f.type.startsWith("image/") && ["image/png", "image/jpeg", "image/webp"].includes(f.type))) {
    return "Unsupported file type. Use PDF, DOCX, TXT, MD, CSV, JSON or an image (PNG, JPG, WEBP).";
  }
  if (!isImage(f) && f.size > CHAT_MAX_TOTAL_BYTES) return "The file is larger than 4 MB.";
  return null;
}

/** Large photos are shrunk in the browser first (JPEG, ≤1600 px) so the upload stays small. */
export async function prepareAttachment(f: File): Promise<File> {
  if (!isImage(f) || f.size <= 700_000) return f;
  const url = await compressImage(f, 1600, 0.8, 900_000);
  const blob = await (await fetch(url)).blob();
  return new File([blob], f.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
}

/** A tiny preview for the sent message bubble (images only). */
export async function thumbnailOf(f: File): Promise<string | undefined> {
  if (!isImage(f)) return undefined;
  try {
    return await compressImage(f, 72, 0.6, 12_000);
  } catch {
    return undefined;
  }
}

export const formatBytes = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
