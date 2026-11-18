/**
 * Shrink an image in the browser: longest edge ≤ `maxEdge` px, re-encoded as JPEG (quality 0.8), then squeezed
 * further if the result is still bigger than `maxChars` base64 characters (so it fits a Firestore document).
 * Returns a data URL.
 */
export async function compressImage(file: File, maxEdge = 1280, quality = 0.8, maxChars = 450_000): Promise<string> {
  const bitmap = await loadBitmap(file);
  let scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  let q = quality;
  for (let attempt = 0; attempt < 8; attempt++) {
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas isn't available");
    ctx.fillStyle = "#fff"; // JPEG has no transparency
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const url = canvas.toDataURL("image/jpeg", q);
    if (url.length <= maxChars) return url;
    if (q > 0.5) q -= 0.1;
    else scale *= 0.8;
  }
  throw new Error("That image is too large");
}

async function loadBitmap(file: File): Promise<{ width: number; height: number } & CanvasImageSource> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall back to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}
