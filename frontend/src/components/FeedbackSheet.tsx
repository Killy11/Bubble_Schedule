"use client";

import { useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { MicButton } from "@/components/MicButton";
import { compressImage } from "@/lib/image";
import { Sheet } from "@/components/Sheet";
import { useAuth } from "@/context/AuthProvider";
import { useLang } from "@/context/LanguageProvider";
import { useToast } from "@/context/ToastProvider";

const MAX_PHOTOS = 3;
const CATEGORIES = ["bug", "feature", "general"] as const;
type Category = (typeof CATEGORIES)[number];
const field =
  "glass w-full rounded-2xl px-4 py-2.5 text-sm outline-none transition focus:border-[rgb(var(--glow-a))] placeholder:text-muted";

/** Bug reports, ideas and general feedback → the Firestore `feedback` collection. */
export function FeedbackSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLang();
  return (
    <Sheet open={open} onClose={onClose} title={t("Feedback")}>
      {open && <Form onClose={onClose} />}
    </Sheet>
  );
}

function Form({ onClose }: { onClose: () => void }) {
  const { t, lang } = useLang();
  const { user } = useAuth();
  const { toast } = useToast();
  const [category, setCategory] = useState<Category>("general");
  const [message, setMessage] = useState("");
  const [photos, setPhotos] = useState<string[]>([]); // compressed JPEG data URLs, max 3
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label: Record<Category, string> = { bug: t("Bug report"), feature: t("Feature request"), general: t("General feedback") };

  /** Add images from the picker or the clipboard: resized to 1280px / JPEG 0.8 before they are kept. */
  async function addPhotos(files: File[]) {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    setError(null);
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) return setError(t("Up to 3 photos."));
    try {
      const done = await Promise.all(images.slice(0, room).map((f) => compressImage(f)));
      setPhotos((p) => [...p, ...done].slice(0, MAX_PHOTOS));
      if (images.length > room) setError(t("Up to 3 photos."));
    } catch {
      setError(t("Couldn't read that image."));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = message.trim();
    if (!text) return setError(t("Write a message first."));
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, message: text, images: photos }),
      });
      if (res.status === 429) {
        setError(t("Too many messages. Please try again in an hour."));
        setBusy(false);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: t("Thanks! Feedback sent.") });
      onClose();
    } catch (err) {
      console.warn("feedback failed:", err);
      setError(t("Couldn't send. Please try again."));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div role="radiogroup" aria-label={t("Category")} className="glass flex rounded-full p-1">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={category === c}
            onClick={() => setCategory(c)}
            className={`flex-1 rounded-full px-2 py-1.5 text-xs transition ${
              category === c ? "bg-foreground font-medium text-background" : "text-muted hover:text-foreground"
            }`}
          >
            {label[c]}
          </button>
        ))}
      </div>
      <label className="block text-xs text-muted">
        <span className="flex justify-between"><span>{t("Message")}</span><span>{message.length}/2000</span></span>
        <textarea
          autoFocus
          required
          rows={5}
          maxLength={2000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.some((f) => f.type.startsWith("image/"))) {
              e.preventDefault(); // a pasted screenshot becomes an attachment
              void addPhotos(files);
            }
          }}
          className={`${field} mt-1 resize-none text-foreground`}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <MicButton value={message} onChange={(v) => setMessage(v.slice(0, 2000))} size="sm" fixedLang={lang === "uk" ? "uk-UA" : "en-US"} />
        <label
          className={`glass flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs text-muted transition hover:text-foreground ${
            photos.length >= MAX_PHOTOS ? "pointer-events-none opacity-50" : ""
          }`}
        >
          <ImagePlus className="h-4 w-4" /> {t("Attach photo")} ({photos.length}/{MAX_PHOTOS})
          <input type="file" accept="image/*" multiple className="sr-only"
            onChange={(e) => { void addPhotos([...(e.target.files ?? [])]); e.target.value = ""; }} />
        </label>
      </div>
      {photos.length > 0 && (
        <ul className="flex gap-2">
          {photos.map((src, i) => (
            <li key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-16 w-16 rounded-xl border border-line object-cover" />
              <button type="button" onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))} aria-label={t("Remove photo")}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background shadow">
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <button type="submit" disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("Send")}
      </button>
    </form>
  );
}
