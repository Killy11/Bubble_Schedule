"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Check, Copy, Download, Share2 } from "lucide-react";
import { Sheet } from "@/components/Sheet";
import { useLang } from "@/context/LanguageProvider";

const noopSubscribe = () => () => {};
const QR_SIZE = 220;

/** "Share BubbleSchedule": a scannable QR code (always dark on white), the link with a copy button, PNG download, native share. */
export function ShareSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang } = useLang();
  const url = useSyncExternalStore(noopSubscribe, () => window.location.origin, () => "");
  const canShare = useSyncExternalStore(noopSubscribe, () => typeof navigator !== "undefined" && typeof navigator.share === "function", () => false);
  const holder = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API blocked (insecure context): fall back to a temporary textarea.
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  /** PNG with a white quiet zone around the code so every scanner reads it. */
  function download() {
    const src = holder.current?.querySelector("canvas");
    if (!src) return;
    const margin = 40;
    const out = document.createElement("canvas");
    out.width = src.width + margin * 2;
    out.height = src.height + margin * 2;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, margin, margin);
    const a = document.createElement("a");
    a.href = out.toDataURL("image/png");
    a.download = "bubbleschedule-qr.png";
    a.click();
  }

  async function share() {
    try {
      await navigator.share({
        title: "BubbleSchedule",
        text: lang === "uk" ? "Плануй день у вигляді бульбашок із таймером та ШІ-помічником" : "Plan your day as bubbles, with a timer and an AI assistant",
        url,
      });
    } catch {
      /* the user closed the share sheet */
    }
  }

  const btn = "flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm transition disabled:opacity-60";
  return (
    <Sheet open={open} onClose={onClose} title={t("Share BubbleSchedule")}>
      <div className="space-y-4">
        {/* Always dark modules on white, in dark mode too, so any camera scans it. */}
        <div ref={holder} className="mx-auto w-fit rounded-2xl bg-white p-4 shadow-sm">
          {url && <QRCodeCanvas value={url} size={QR_SIZE} level="M" marginSize={0} bgColor="#ffffff" fgColor="#0f172a" />}
        </div>

        <div className="flex items-center gap-2">
          <input
            readOnly
            value={url}
            aria-label={t("Link")}
            onFocus={(e) => e.target.select()}
            className="glass min-w-0 flex-1 rounded-full px-4 py-2.5 text-sm text-foreground outline-none"
          />
        </div>
        <button type="button" onClick={copy} className={`${btn} bg-foreground font-medium text-background hover:opacity-90`}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? t("✓ Copied") : t("Copy link")}
        </button>
        <button type="button" onClick={download} className={`${btn} glass hover:brightness-125`}>
          <Download className="h-4 w-4" /> {t("Download QR (PNG)")}
        </button>
        {canShare && (
          <button type="button" onClick={share} className={`${btn} glass hover:brightness-125`}>
            <Share2 className="h-4 w-4" /> {t("Send...")}
          </button>
        )}
      </div>
    </Sheet>
  );
}
