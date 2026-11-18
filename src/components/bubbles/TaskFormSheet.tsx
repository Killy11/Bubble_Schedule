"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Loader2, Paperclip, Scissors } from "lucide-react";
import { ESTIMATE_ACCEPT, estimateFile, focusToPacing, type FileEstimate } from "@/lib/estimate";
import { MicButton } from "@/components/MicButton";
import { Sheet } from "@/components/Sheet";
import { PacingSelector } from "@/components/PacingSelector";
import { DeadlineField } from "@/components/DeadlineField";
import { RecurrencePicker } from "./RecurrencePicker";
import { isTutorialActive } from "@/lib/tutorialLock";
import { useLang } from "@/context/LanguageProvider";
import { DECOMPOSE_AT_MIN } from "@/lib/subtasks";
import { detectPacing, parseSplitRequest } from "@/lib/pacing";
import { TaskLimitError, type NewTaskInput } from "@/hooks/useTasks";
import { suggestDuration } from "@/lib/history";
import type { HistoryRecord, Pacing, Recurrence } from "@/types";
import { DurationFields } from "@/components/DurationFields";
import { clampDuration, splitMinutes, totalMinutes } from "@/lib/duration";

const field =
  "glass w-full rounded-2xl px-4 py-2.5 text-sm outline-none transition focus:border-[rgb(var(--glow-a))] placeholder:text-muted";

/** Wait for the user to pause typing before the (cheap but non-trivial) title analysis runs. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function defaultDeadline(): string {
  const d = new Date();
  d.setHours(18, 0, 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function TaskFormSheet({
  open,
  onClose,
  onSubmit,
  history,
  defaultPacing,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: NewTaskInput) => Promise<void>;
  history: readonly HistoryRecord[];
  defaultPacing: Pacing;
}) {
  const { t } = useLang();
  return (
    <Sheet open={open} onClose={onClose} title={t("New bubble")} tourId="create">
      {/* Remounts on each open, so the form resets and gets a fresh default deadline. */}
      {open && <Form onClose={onClose} onSubmit={onSubmit} history={history} defaultPacing={defaultPacing} />}
    </Sheet>
  );
}

function Form({
  onClose,
  onSubmit,
  history,
  defaultPacing,
}: {
  onClose: () => void;
  onSubmit: (i: NewTaskInput) => Promise<void>;
  history: readonly HistoryRecord[];
  defaultPacing: Pacing;
}) {
  const { t, lang } = useLang();
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState(defaultDeadline);
  const [noDeadline, setNoDeadline] = useState(false);
  const [hours, setHours] = useState("");
  const [mins, setMins] = useState("");
  const [durationTouched, setDurationTouched] = useState(false);
  const [recurrence, setRecurrence] = useState<Recurrence | null>(null);
  const [pacingPick, setPacingPick] = useState<Pacing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Assignment file analysis
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState<FileEstimate | null>(null);
  const [partsPick, setPartsPick] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  async function analyse(file: File | undefined) {
    if (!file || estimating) return;
    setEstimating(true);
    setError(null);
    try {
      const r = await estimateFile(file, lang, title.trim() || undefined);
      const d = splitMinutes(r.estimatedMinutes);
      if (!title.trim()) setTitle(r.suggestedTitle.slice(0, 100)); // never overwrite a title the user typed
      setHours(d.hours);
      setMins(d.minutes);
      setDurationTouched(true);
      setPacingPick(focusToPacing(r.recommendedFocus));
      setPartsPick(null);
      setEstimate(r);
    } catch (e) {
      setError(t(e instanceof Error ? e.message : "Couldn't analyse that file."));
    } finally {
      setEstimating(false);
    }
  }

  // Typing only updates `title`. Everything that analyses it (history lookup, pacing words, "split into N parts")
  // runs on a debounced copy, at low priority, so keystrokes are never blocked by it.
  const settled = useDeferredValue(useDebounced(title, 350));
  const suggestion = useMemo(() => suggestDuration(settled, history), [settled, history]);
  const detected = useMemo(() => detectPacing(settled), [settled]);
  const requestedParts = useMemo(() => parseSplitRequest(settled) ?? undefined, [settled]);

  const suggested = splitMinutes(suggestion?.minutes);
  const shownHours = durationTouched ? hours : suggested.hours;
  const shownMins = durationTouched ? mins : suggested.minutes;
  const totalMin = totalMinutes(shownHours, shownMins); // blank both → undefined → the AI estimates
  const anchorDow = new Date(deadline).getDay();
  const pacing: Pacing = pacingPick ?? detected ?? defaultPacing;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const when = new Date(deadline);
    if (!title.trim()) return setError(t("Give your bubble a title."));
    if (!noDeadline && Number.isNaN(when.getTime())) return setError(t("Pick a deadline."));
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        title,
        deadline: noDeadline ? undefined : when.toISOString(),
        durationMin: totalMin ? clampDuration(totalMin) : undefined,
        recurrence: noDeadline ? undefined : (recurrence ?? undefined),
        pacing,
        requestedParts: partsPick ?? parseSplitRequest(title) ?? requestedParts,
      });
      onClose();
    } catch (e) {
      setError(e instanceof TaskLimitError ? t(e.message) : t("Couldn't save. Please try again."));
      setBusy(false);
    }
  }

  const splitAt = DECOMPOSE_AT_MIN[pacing];
  const parts = partsPick ?? requestedParts;
  const hint = parts
    ? t("Will be split into {n} parts", { n: parts })
    : pacing !== "locked" && splitAt && (totalMin ?? 0) >= splitAt
      ? t("Will be split into parts")
      : null;

  return (
    <form
      onSubmit={submit}
      // While the tutorial runs, Enter inside a field must not submit: the form is sent only by pressing Create.
      onKeyDown={(e) => {
        if (e.key === "Enter" && isTutorialActive() && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
      }}
      className="space-y-3"
    >
      <label data-tour="field-title" className="block text-xs text-muted">
        <span className="flex justify-between">
          <span>{t("Title")}</span>
          <span aria-live="polite">{title.length}/100</span>
        </span>
        <div className="mt-1 flex items-center gap-2">
          <input autoFocus required maxLength={100} value={title} onChange={(e) => setTitle(e.target.value.slice(0, 100))}
            spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="sentences"
            placeholder={t("Write project report")} className={`${field} min-w-0 flex-1`} />
          <MicButton value={title} onChange={(v) => setTitle(v.slice(0, 100))} size="sm" />
        </div>
      </label>
      {/* Attach an assignment file (PDF, DOCX, TXT, photo): the AI reads it and estimates the time. Nothing is stored. */}
      <label
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); void analyse(e.dataTransfer.files[0]); }}
        className={`glass flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-2.5 text-xs text-muted transition hover:text-foreground ${
          dragging ? "border-[rgb(var(--glow-a))]" : "border-line"
        } ${estimating ? "pointer-events-none opacity-70" : ""}`}
      >
        {estimating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
        {estimating ? t("Analysing the file…") : t("📎 Attach assignment file (PDF, DOCX, photo)")}
        <input type="file" accept={ESTIMATE_ACCEPT} className="sr-only" disabled={estimating}
          onChange={(e) => { void analyse(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      <div data-tour="field-duration" className="text-xs text-muted">
        <span className="mb-1 block">{t("Duration")}</span>
        <DurationFields
          hours={shownHours}
          minutes={shownMins}
          onHours={(v) => { setHours(v); setMins(shownMins); setDurationTouched(true); }}
          onMinutes={(v) => { setMins(v); setHours(shownHours); setDurationTouched(true); }}
        />
        {estimate && (
          <div className="glass mt-2 flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2 text-[11px] text-foreground">
            <span className="min-w-0 flex-1">✨ {estimate.reasoning}</span>
            {estimate.shouldSplit && estimate.suggestedParts && (
              <button
                type="button"
                onClick={() => setPartsPick(partsPick ? null : estimate.suggestedParts)}
                aria-pressed={!!partsPick}
                className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 transition ${
                  partsPick ? "bg-foreground text-background" : "border border-line text-muted hover:text-foreground"
                }`}
              >
                <Scissors className="h-3 w-3" /> {t("Split into {n} parts", { n: estimate.suggestedParts })}
              </button>
            )}
          </div>
        )}
        {hint && <p className="mt-1 text-[11px]">{hint}</p>}
        {suggestion && !durationTouched && <p className="mt-1 text-[11px]">{t("From {n} similar tasks", { n: suggestion.samples })}</p>}
      </div>
      {/* Focus intensity lives here only. */}
      <div data-tour="field-mode" className="text-xs text-muted">
        <span className="mb-1 block">{t("Focus intensity")}</span>
        <PacingSelector value={pacing} onChange={setPacingPick} />
      </div>
      <DeadlineField value={deadline} none={noDeadline} onValue={setDeadline} onNone={setNoDeadline} />
      {!noDeadline && (
        <div className="text-xs text-muted">
          <span className="mb-1 block">{t("Repeat")}</span>
          <RecurrencePicker value={recurrence} onChange={setRecurrence} anchorDow={anchorDow} />
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <button type="submit" disabled={busy} data-tour="field-submit"
        className="flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("Add bubble")}
      </button>
    </form>
  );
}
