"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { addDoc, collection } from "firebase/firestore";
import { Sheet } from "@/components/Sheet";
import { useAuth } from "@/context/AuthProvider";
import { useLang } from "@/context/LanguageProvider";
import { useToast } from "@/context/ToastProvider";
import { db } from "@/lib/firebase/client";

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
  const { t } = useLang();
  const { user } = useAuth();
  const { toast } = useToast();
  const [category, setCategory] = useState<Category>("general");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState(user?.email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label: Record<Category, string> = { bug: t("Bug report"), feature: t("Feature request"), general: t("General feedback") };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = message.trim();
    if (!text) return setError(t("Write a message first."));
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await addDoc(collection(db, "feedback"), {
        message: text.slice(0, 2000),
        category,
        email: email.trim().slice(0, 200),
        userId: user.uid,
        createdAt: new Date(),
      });
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
          className={`${field} mt-1 resize-none text-foreground`}
        />
      </label>
      <label className="block text-xs text-muted">
        {t("Email (optional)")}
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200}
          autoComplete="email" className={`${field} mt-1 text-foreground`} />
      </label>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <button type="submit" disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("Send")}
      </button>
    </form>
  );
}
