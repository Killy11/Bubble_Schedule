"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Logo } from "@/components/Logo";
import { Orb } from "@/components/Orb";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/context/AuthProvider";
import { useLang } from "@/context/LanguageProvider";

const BUBBLES = [
  { size: 150, x: "7%", y: "10%", hue: "green", delay: 0 },
  { size: 84, x: "80%", y: "14%", hue: "red", delay: 1.2 },
  { size: 190, x: "68%", y: "66%", hue: "yellow", delay: 0.6 },
  { size: 64, x: "12%", y: "74%", hue: "green", delay: 1.8 },
] as const;

function friendlyError(code?: string): string | null {
  switch (code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return null;
    case "auth/invalid-email":
      return "That email address doesn't look right.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Incorrect email or password.";
    case "auth/email-already-in-use":
      return "An account with this email already exists. Try signing in instead.";
    case "auth/weak-password":
      return "Password is too weak. Use at least 6 characters.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    case "auth/operation-not-allowed":
      return "Email sign-in isn't enabled for this project yet.";
    case "auth/account-exists-with-different-credential":
      return "This email is registered with a different sign-in method.";
    default:
      return "Something went wrong. Please try again.";
  }
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.5 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { t } = useLang();
  const { user, loading, signInWithGoogle, signInWithEmail, syncSession } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Firebase says we're signed in but proxy.ts let us through to /login (no/expired cookie):
  // re-mint the session cookie, then continue.
  const restoreStarted = useRef(false);
  const restoring = !loading && !!user && !error;
  const disabled = busy || loading || restoring;
  useEffect(() => {
    if (loading || !user || restoreStarted.current) return;
    restoreStarted.current = true;
    syncSession(true)
      .then(() => router.replace("/dashboard"))
      .catch(() => setError("Could not restore your session. Please sign in again."));
  }, [loading, user, syncSession, router]);

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      router.replace("/dashboard");
    } catch (e) {
      setError(friendlyError((e as { code?: string }).code));
      setBusy(false);
    }
  }

  const handleGoogle = () => run(signInWithGoogle);
  function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    void run(() => signInWithEmail(mode, email.trim(), password));
  }

  return (
    <main className="ambient relative flex min-h-dvh flex-1 items-center justify-center overflow-hidden px-4">
      <div className="absolute right-4 top-4 z-20"><ThemeToggle /></div>
      {BUBBLES.map((b, i) => (
        <motion.div
          key={i}
          aria-hidden
          className="absolute"
          style={{ left: b.x, top: b.y }}
          animate={{ y: [0, -18, 0], x: [0, 8, 0] }}
          transition={{ duration: 6 + i, repeat: Infinity, ease: "easeInOut", delay: b.delay }}
        >
          <Orb hue={b.hue} size={b.size} />
        </motion.div>
      ))}

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="glass relative z-10 w-full max-w-sm rounded-[2rem] p-8 text-center shadow-2xl"
      >
        <div className="mx-auto mb-5 flex justify-center"><Logo size={52} /></div>
        <h1 className="text-2xl font-semibold tracking-tight">BubbleSchedule</h1>
        <p className="mt-2 text-sm text-muted">
          {t("Your day, planned by AI.")}
        </p>

        <form onSubmit={handleEmailSubmit} className="mt-8 space-y-3 text-left">
          <input
            type="email"
            required
            autoComplete="email"
            placeholder={t("Email")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="glass w-full rounded-full px-5 py-3 text-sm outline-none transition placeholder:text-muted focus:border-[rgb(var(--glow-a))]"
          />
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              required
              minLength={6}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              placeholder={t("Password")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="glass w-full rounded-full py-3 pl-5 pr-12 text-sm outline-none transition placeholder:text-muted focus:border-[rgb(var(--glow-a))]"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? t("Hide password") : t("Show password")}
              aria-pressed={showPassword}
              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted transition hover:text-foreground"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <button
            type="submit"
            disabled={disabled}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background shadow transition hover:opacity-90 disabled:opacity-60"
          >
            {disabled && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === "signup" ? t("Create account") : t("Sign in")}
          </button>
        </form>

        <p className="mt-3 text-sm text-muted">
          {mode === "signup" ? t("Already have an account?") : t("New to BubbleSchedule?")}{" "}
          <button
            type="button"
            onClick={() => {
              setMode(mode === "signup" ? "signin" : "signup");
              setError(null);
            }}
            className="font-medium text-[rgb(var(--glow-a))] hover:underline"
          >
            {mode === "signup" ? t("Sign in") : t("Create account")}
          </button>
        </p>

        <div className="my-5 flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-line" />
          {t("or")}
          <span className="h-px flex-1 bg-line" />
        </div>

        <button
          type="button"
          onClick={handleGoogle}
          disabled={disabled}
          className="flex w-full items-center justify-center gap-3 glass rounded-full px-5 py-3 text-sm font-medium transition hover:brightness-125 disabled:opacity-60"
        >
          <GoogleLogo />
          {t("Continue with Google")}
        </button>

        {error && (
          <p role="alert" className="mt-4 text-sm text-red-500">
            {t(error)}
          </p>
        )}
      </motion.div>
    </main>
  );
}
