"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Clock, MessageCircle, Plus, Sparkles } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { Orb } from "@/components/Orb";
import { useAuth } from "@/context/AuthProvider";
import { useToast } from "@/context/ToastProvider";
import { useHistory } from "@/hooks/useHistory";
import { useChat } from "@/hooks/useChat";
import { useNow } from "@/hooks/useNow";
import { useSchedule } from "@/hooks/useSchedule";
import { useTasks } from "@/hooks/useTasks";
import { useUserProfile } from "@/hooks/useUserProfile";
import { dateKeyInTz, formatTime } from "@/lib/time";
import { describeSuggestion, suggestDuration } from "@/lib/history";
import { markOnboardingComplete } from "@/lib/firebase/users";
import { BubbleCanvas } from "@/components/bubbles/BubbleCanvas";
import { POP_MS } from "@/components/bubbles/Bubble";
import { ExpiredSheet } from "@/components/bubbles/ExpiredSheet";
import { OnboardingTour } from "@/components/OnboardingTour";
import { TaskDetailSheet } from "@/components/bubbles/TaskDetailSheet";
import { TaskFormSheet } from "@/components/bubbles/TaskFormSheet";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { SchedulePanel } from "@/components/schedule/SchedulePanel";
import { BlockEditSheet } from "@/components/schedule/BlockEditSheet";
import { ProfileSheet } from "@/components/profile/ProfileSheet";
import { useDecompose } from "@/hooks/useDecompose";
import { formatWindow, nextSubtask } from "@/lib/subtasks";
import { Header } from "./Header";
import type { Subtask, Task } from "@/types";
import type { NewTaskInput } from "@/hooks/useTasks";

const ONBOARDED_KEY = "bs:onboarded";
const EXPIRED_SEEN_KEY = "bs:expiredSeenAt";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readLocal(key: string): string | null {
  if (typeof window === "undefined") return null; // prerender
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

type Tab = "bubbles" | "schedule" | "chat";

export function DashboardShell() {
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const uid = user?.uid;
  const now = useNow();
  const { profile, timezone } = useUserProfile(uid);
  const today = dateKeyInTz(now, timezone);
  const { toast } = useToast();
  const reducedMotion = useReducedMotion();
  const history = useHistory(uid);

  const [expiredOpen, setExpiredOpen] = useState(false);
  const [popping, setPopping] = useState<ReadonlySet<string>>(new Set());
  const [tourOpen, setTourOpen] = useState(false);
  const [tourDismissed, setTourDismissed] = useState(() => readLocal(ONBOARDED_KEY) === "1");

  // Bubbles that expired just now: say which, and offer a one-tap way to bring them back.
  const handleExpired = useCallback(
    (expired: Task[]) => {
      const first = expired[0];
      toast({
        title: expired.length === 1 ? `“${first.title}” expired` : `${expired.length} bubbles expired`,
        body: expired.length === 1 ? "Its deadline passed. Reschedule it?" : `“${first.title}” and ${expired.length - 1} more passed their deadline.`,
        action: { label: "Reschedule", onClick: () => setExpiredOpen(true) },
      });
      writeLocal(EXPIRED_SEEN_KEY, String(Date.now()));
    },
    [toast],
  );

  const {
    tasks, loading: tasksLoading, error, addTask, deleteTask, complete, logMinutes,
    startTimer, stopTimer, setRecurrence, updateTask, saveSubtasks, toggleSubtask, reschedule,
  } = useTasks(uid, timezone, now, handleExpired);

  // Big tasks are split into scheduled parts automatically (and on demand from the task modal).
  const { working: splitting, split } = useDecompose(
    tasks,
    !!uid && !tasksLoading,
    ({ task, subtasks, placed, total }) => {
      const next = nextSubtask(subtasks);
      toast({
        title: `“${task.title}” split into ${total} parts`,
        body: placed < total
          ? `Only ${placed} of ${total} fit before the deadline. Check the times.`
          : next ? `First up: ${formatWindow(next, Date.now())}` : undefined,
        onClick: () => setOpenId(task.id),
      });
    },
    (task, message, manual) => {
      if (manual) toast({ title: `Couldn't split “${task.title}”`, body: message });
    },
  );
  const { schedule, markTaskBlocksDone, renameTaskBlocks, editBlock } = useSchedule(uid, today);

  // Tasks made without a duration (e.g. from chat) get one from similar tasks the user finished before.
  const addTaskSmart = useCallback(
    (input: NewTaskInput) => {
      const s = input.durationMin ? null : suggestDuration(input.title, history);
      return addTask(s ? { ...input, historyEstimate: { durationMin: s.minutes, reasoning: describeSuggestion(s) } } : input);
    },
    [addTask, history],
  );
  const { messages, pending, send, ask } = useChat(uid, today, addTaskSmart);

  const [tab, setTab] = useState<Tab>("bubbles");
  const [formOpen, setFormOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editBlockId, setEditBlockId] = useState<string | null>(null);

  // Cookie says signed in but Firebase says otherwise: clear the cookie so /login doesn't bounce back.
  useEffect(() => {
    if (!loading && !user) {
      fetch("/api/session", { method: "DELETE" }).finally(() => router.replace("/login"));
    }
  }, [loading, user, router]);

  const active = useMemo(() => tasks.filter((t) => t.status === "active"), [tasks]);
  const expired = useMemo(
    () => tasks.filter((t) => t.status === "expired").sort((a, b) => b.deadline.localeCompare(a.deadline)).slice(0, 30),
    [tasks],
  );

  // Expired while the app was closed (e.g. by the server): mention it once on the next visit.
  const welcomed = useRef(false);
  useEffect(() => {
    if (tasksLoading || welcomed.current) return;
    welcomed.current = true;
    const seen = Number(readLocal(EXPIRED_SEEN_KEY) ?? 0);
    const missed = expired.filter((t) => Date.parse(t.expiredAt ?? t.deadline) > seen);
    if (seen > 0 && missed.length) handleExpired(missed);
    else writeLocal(EXPIRED_SEEN_KEY, String(Date.now()));
  }, [tasksLoading, expired, handleExpired]);

  // First-run tutorial: a brand-new account (no tasks yet) that hasn't seen it.
  const autoTour =
    !!profile && !profile.hasCompletedOnboarding && !tasksLoading && tasks.length === 0 && !tourDismissed;
  const closeTour = () => {
    setTourOpen(false);
    setTourDismissed(true);
    writeLocal(ONBOARDED_KEY, "1");
    if (uid) markOnboardingComplete(uid).catch((e) => console.warn("onboarding flag:", e));
  };
  const openTask = active.find((t) => t.id === openId) ?? null;
  const doneToday = tasks.filter(
    (t) => t.status === "completed" && t.completedAt && dateKeyInTz(t.completedAt, timezone) === today,
  ).length;

  const summary = useMemo(() => {
    if (tasksLoading) return "Loading your bubbles…";
    if (active.length === 0) return doneToday ? `All clear · ${doneToday} done today` : "No bubbles yet · add your first task";
    const planned = (schedule?.blocks ?? []).filter((b) => b.status === "planned");
    const next = planned.find((b) => new Date(b.end).getTime() > now);
    const parts = [`${active.length} active`, `${planned.length} scheduled`];
    if (doneToday) parts.push(`${doneToday} done`);
    if (next) parts.push(`next: ${next.title} ${formatTime(next.start)}`);
    return parts.join(" · ");
  }, [tasksLoading, active.length, schedule, doneToday, now]);

  /** Check / uncheck a part. Checking the last one finishes the whole task, with the full pop. */
  async function toggleSubtaskFlow(t: Task, sub: Subtask) {
    const checked = !sub.completed;
    try {
      const othersLeft = (t.subtasks ?? []).some((s) => s.id !== sub.id && !s.completed);
      if (checked && !othersLeft) {
        setOpenId(null);
        await completeTask({ ...t, loggedMinutes: (t.loggedMinutes ?? 0) + sub.durationMinutes });
      } else {
        await toggleSubtask(t, sub.id, checked);
      }
    } catch (e) {
      console.warn("toggle part failed:", e);
      toast({ title: "Couldn't update that part", body: "Please try again." });
    }
  }

  /** Pop the bubble first, then write the completion (so the canvas and Firestore change together). */
  async function completeTask(t: Task, actualMin?: number) {
    setPopping((p) => new Set(p).add(t.id));
    try {
      await sleep(reducedMotion ? 120 : POP_MS);
      await Promise.all([complete(t, { actualMin }), markTaskBlocksDone(t.id)]);
    } catch (e) {
      console.warn("complete failed:", e);
      toast({ title: "Couldn't complete that bubble", body: "Please try again." });
    } finally {
      setPopping((p) => {
        const n = new Set(p);
        n.delete(t.id);
        return n;
      });
    }
  }

  if (loading || !user) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Orb hue="green" size={64} className="animate-pulse" />
      </div>
    );
  }

  const panel: Exclude<Tab, "bubbles"> = tab === "bubbles" ? "schedule" : tab;
  const TABS: Array<{ id: Tab; label: string; icon: typeof Plus }> = [
    { id: "bubbles", label: "Bubbles", icon: Sparkles },
    { id: "schedule", label: "Schedule", icon: Calendar },
    { id: "chat", label: "AI Chat", icon: MessageCircle },
  ];

  return (
    <div className="ambient relative flex min-h-dvh flex-1 flex-col">
      <Header
        summary={summary}
        name={user.displayName || user.email || "You"}
        photoURL={user.photoURL}
        onOpenProfile={() => setProfileOpen(true)}
        onOpenHelp={() => setTourOpen(true)}
        onSignOut={async () => {
          await signOut();
          router.replace("/login");
        }}
      />

      <main className="mx-auto flex w-full max-w-[1600px] flex-1 gap-4 p-4 pb-24 lg:pb-4">
        {/* Bubble canvas */}
        <section className={`${tab === "bubbles" ? "flex" : "hidden"} min-h-0 flex-1 flex-col lg:flex`}>
          <div className="mb-3 flex items-center justify-between">
            <h1 className="text-sm font-medium text-muted">Today&apos;s bubbles</h1>
            <div className="flex gap-2">
              {expired.length > 0 && (
                <button
                  onClick={() => setExpiredOpen(true)}
                  className="flex items-center gap-1.5 rounded-full glass px-4 py-2 text-xs font-medium text-muted transition hover:text-foreground"
                >
                  <Clock className="h-3.5 w-3.5" /> Expired ({expired.length})
                </button>
              )}
              <button
                onClick={() => send("auto-schedule")}
                disabled={pending || active.length === 0}
                className="flex items-center gap-1.5 rounded-full glass px-4 py-2 text-xs font-medium text-foreground transition hover:brightness-125 disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" /> {pending ? "Planning…" : "Auto-schedule"}
              </button>
              <button
                onClick={() => setFormOpen(true)}
                className="flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-xs font-medium text-background transition hover:opacity-90"
              >
                <Plus className="h-3.5 w-3.5" /> New bubble
              </button>
            </div>
          </div>
          <div className="relative min-h-[360px] flex-1">
            {error ? (
              <p className="absolute inset-0 flex items-center justify-center text-sm text-red-500">{error}</p>
            ) : (
              <BubbleCanvas
                tasks={active}
                now={now}
                poppingIds={popping}
                onOpen={(id) => {
                  // A scheduled bubble opens its time editor (with a link to the details); others open details.
                  const block = schedule?.blocks.find((b) => b.taskId === id && b.status !== "done");
                  if (block) setEditBlockId(block.id);
                  else setOpenId(id);
                }}
              />
            )}
            {!tasksLoading && active.length === 0 && !error && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4 text-center">
                <Orb hue="green" size={96} className="opacity-70" />
                <p className="text-sm text-muted">Your sky is clear.<br />Tap <span className="text-foreground">New bubble</span> to add a task.</p>
              </div>
            )}
          </div>
        </section>

        {/* Side panel (desktop) / tab content (mobile) */}
        <aside
          className={`${tab === "bubbles" ? "hidden" : "flex"} glass min-h-0 w-full flex-col overflow-hidden rounded-3xl lg:flex lg:w-[400px] lg:shrink-0`}
          style={{ height: "calc(100dvh - 7.5rem)" }}
        >
          <div className="hidden gap-1 border-b border-line p-2 lg:flex">
            {TABS.filter((t) => t.id !== "bubbles").map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-xs transition ${
                  panel === id ? "bg-foreground text-background" : "text-muted hover:text-foreground"}`}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            {panel === "schedule" ? (
              <SchedulePanel
                schedule={schedule}
                tasks={active}
                now={now}
                onOpenBlock={setEditBlockId}
                onOpenTask={setOpenId}
                onToggleSubtask={(t, s) => void toggleSubtaskFlow(t, s)}
                onComplete={(taskId) => {
                  const t = active.find((x) => x.id === taskId);
                  if (t) void completeTask(t);
                }}
              />
            ) : (
              <ChatPanel messages={messages} pending={pending} hasTasks={active.length > 0} onSend={send} onAsk={ask} />
            )}
          </div>
        </aside>
      </main>

      {/* Mobile tab bar */}
      <nav className="glass fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 flex rounded-full p-1.5 backdrop-blur-xl lg:hidden" aria-label="Sections">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            aria-current={tab === id}
            className={`flex flex-1 flex-col items-center gap-0.5 rounded-full py-2 text-[11px] transition ${
              tab === id ? "bg-foreground text-background" : "text-muted"}`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </nav>

      <ProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} />
      <TaskFormSheet open={formOpen} onClose={() => setFormOpen(false)} onSubmit={addTask} history={history} />
      <ExpiredSheet
        open={expiredOpen}
        tasks={expired}
        now={now}
        onClose={() => setExpiredOpen(false)}
        onReschedule={reschedule}
        onDelete={(t) => deleteTask(t.id)}
      />
      <OnboardingTour open={tourOpen || autoTour} onClose={closeTour} />
      <BlockEditSheet
        block={schedule?.blocks.find((b) => b.id === editBlockId && b.status !== "done") ?? null}
        others={(schedule?.blocks ?? []).filter((b) => b.id !== editBlockId && b.status !== "done")}
        onClose={() => setEditBlockId(null)}
        onSave={editBlock}
        onShowTask={() => {
          const taskId = schedule?.blocks.find((b) => b.id === editBlockId)?.taskId;
          setEditBlockId(null);
          if (taskId) setOpenId(taskId);
        }}
      />
      <TaskDetailSheet
        task={openTask}
        now={now}
        onClose={() => setOpenId(null)}
        onComplete={completeTask}
        onDelete={(t) => deleteTask(t.id)}
        onLogTime={(t, m) => logMinutes(t.id, m)}
        onStartTimer={(t) => startTimer(t.id)}
        onStopTimer={stopTimer}
        onSetRecurrence={setRecurrence}
        splitting={!!openTask && splitting.has(openTask.id)}
        onToggleSubtask={(t, s, checked) => (checked === !s.completed ? toggleSubtaskFlow(t, s) : Promise.resolve())}
        onSaveSubtasks={saveSubtasks}
        onSplit={(t) => void split(t)}
        onEdit={async (t, patch) => {
          await updateTask(t, patch);
          if (patch.title.trim() !== t.title) await renameTaskBlocks(t.id, patch.title.trim()).catch(() => {});
        }}
      />
    </div>
  );
}
