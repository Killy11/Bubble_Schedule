"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, MessageCircle, Plus, Sparkles } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { Orb } from "@/components/Orb";
import { useAuth } from "@/context/AuthProvider";
import { useToast } from "@/context/ToastProvider";
import { useLang } from "@/context/LanguageProvider";
import { Celebrations, type BurstSpec } from "@/components/Celebration";
import { FeedbackSheet } from "@/components/FeedbackSheet";
import { SupportPrompt } from "@/components/SupportPrompt";
import { playBubblePop, playTimerChime, preloadBubblePop, stopBubblePop } from "@/lib/bubblePopSound";
import { useLocalReminders } from "@/hooks/useLocalReminders";
import { useSecondTick } from "@/hooks/useSecondTick";
import { formatClock, sessionSeconds } from "@/lib/remaining";
import { useTimerCompletion } from "@/hooks/useTimerCompletion";
import { showLocalNotification } from "@/lib/localNotify";
import { useSupport } from "@/context/SupportProvider";
import { OverdueSheet } from "@/components/bubbles/OverdueSheet";
import { deadlineMs, isLiveTask, isOverdueTask } from "@/lib/deadline";
import { pacingOf } from "@/lib/pacing";
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
import { CompletedSheet } from "@/components/bubbles/CompletedSheet";
import { RescheduleSheet } from "@/components/bubbles/RescheduleSheet";
import { InteractiveTutorial, TutorialWelcome, TUTORIAL_KEY } from "@/components/InteractiveTutorial";
import { TaskDetailSheet } from "@/components/bubbles/TaskDetailSheet";
import { TaskFormSheet } from "@/components/bubbles/TaskFormSheet";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { SchedulePanel } from "@/components/schedule/SchedulePanel";
import { BlockEditSheet } from "@/components/schedule/BlockEditSheet";
import { ProfileSheet } from "@/components/profile/ProfileSheet";
import { useDecompose } from "@/hooks/useDecompose";
import { oneDayBody } from "@/lib/oneDay";
import { useRebalance } from "@/hooks/useRebalance";
import { formatWindow, nextSubtask } from "@/lib/subtasks";
import { Header } from "./Header";
import type { Subtask, Task } from "@/types";
import type { AssistantAction } from "@/types/api";
import { PartDetailSheet } from "@/components/schedule/PartDetailSheet";
import type { NewTaskInput } from "@/hooks/useTasks";

const ONBOARDED_KEY = "bs:onboarded";
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
  const { openSupport } = useSupport();
  const reducedMotion = useReducedMotion();
  const history = useHistory(uid);

  const { t, lang, setLang } = useLang();
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [overdueOpen, setOverdueOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [popping, setPopping] = useState<ReadonlySet<string>>(new Set());
  const [bursts, setBursts] = useState<BurstSpec[]>([]);
  const canvasHost = useRef<HTMLDivElement>(null);
  const lastCelebration = useRef(0);
  // Tasks that already celebrated: a task celebrates once per completion, and only when the user (or the AI) completes it
  // (never because a snapshot flipped its status). Undo / Restore removes it, so completing it again celebrates again.
  const celebratedIds = useRef(new Set<string>());
  /** The guided tour closes the New bubble / Task windows when it moves on. */
  const closeDialogs = useCallback(() => {
    setOpenId(null);
    setFormOpen(false);
  }, []);
  /** Stop everything celebratory right now (Undo): bursts, particles, poppers, sound. */
  const cancelCelebration = () => {
    setBursts([]); // unmounting a burst clears its timers and resets its confetti canvas
    lastCelebration.current = 0;
    stopBubblePop();
  };
  const [tourOpen, setTourOpen] = useState(false);
  const [supportPromptOpen, setSupportPromptOpen] = useState(false);
  // New tasks (form, chat) default to Balanced; the form's Focus intensity picks per task.
  const defaultPacing = "balanced" as const;
  const [tourDismissed, setTourDismissed] = useState(() => readLocal(ONBOARDED_KEY) === "1" || readLocal(TUTORIAL_KEY) === "1");

  // Look for a custom /sounds/bubble-pop.* once, so the first pop has no delay.
  useEffect(() => {
    void preloadBubblePop();
  }, []);

  // The language saved in the account is adopted on a device that has no choice of its own yet.
  const savedLang = profile?.settings?.language;
  useEffect(() => {
    if (savedLang && readLocal("bs:lang") === null) setLang(savedLang);
  }, [savedLang, setLang]);

  // A bubble just passed its deadline: it leaves the canvas for Overdue. A quiet notice with a way to act on it.
  const handleOverdue = useCallback(
    (late: Task[]) => {
      const first = late[0];
      toast({
        title: late.length === 1 ? t("“{title}” is overdue", { title: first.title }) : t("{n} tasks are overdue", { n: late.length }),
        body: t("Moved to Overdue"),
        action: { label: t("View"), onClick: () => setOverdueOpen(true) },
      });
    },
    [toast, t],
  );

  // A bubble just entered its last 24 hours: one warning per task.
  const handleOneDay = useCallback(
    (list: Task[]) => {
      const first = list[0];
      // With the tab in the background there is no toast to see: raise a system notification too.
      if (typeof document !== "undefined" && document.hidden) {
        void showLocalNotification(
          list.length === 1 ? `⏳ ${t("1 day left until deadline")}: ${first.title}` : `⏳ ${t("1 day left")}: ${list.length}`,
          first.deadline ? oneDayBody(first.deadline, Date.now(), t) : "",
          `${first.id}_24h`,
        );
      }
      toast({
        title: list.length === 1 ? `⏰ ${t("1 day left")}: «${first.title}»` : `⏰ ${t("1 day left")}: ${list.length}`,
        body: list.length === 1 && first.deadline ? oneDayBody(first.deadline, Date.now(), t) : undefined,
        onClick: () => setOpenId(first.id),
      });
    },
    [toast, t],
  );

  const {
    tasks, loading: tasksLoading, error, addTask, addTasks, adjustRemaining, deleteTask, deleteMany, restoreDeleted, restoreTask, undoComplete, complete, confirmTimer, adjustSpent, setRecurrence, saveSubtasks,
    startTimer, stopTimer, updateTask, toggleSubtask, reschedule,
  } = useTasks(uid, timezone, now, handleOverdue, handleOneDay);

  // Big tasks are split into scheduled parts automatically (and on demand from the task modal).
  const { working: splitting, split } = useDecompose(
    tasks,
    !!uid && !tasksLoading,
    ({ task, subtasks, placed, total }) => {
      const next = nextSubtask(subtasks);
      toast({
        title: t("“{title}” split into {n} parts", { title: task.title, n: total }),
        body: placed < total
          ? t("Only {a} of {b} fit before the deadline", { a: placed, b: total })
          : next ? `${t("First up")}: ${formatWindow(next, Date.now(), t, lang)}` : undefined,
        onClick: () => setOpenId(task.id),
      });
    },
    (task, message, manual) => {
      if (manual) toast({ title: t("Couldn't split “{title}”", { title: task.title }), body: message });
    },
  );
  const {
    schedule, markTaskBlocksDone, markTaskBlocksPlanned, removeTaskBlocks, restoreBlocks, renameTaskBlocks, editBlock,
  } = useSchedule(uid, today);

  // A running timer reached 00:00: chime, a system notification (tagged by task, so never twice), and an in-app prompt.
  useTimerCompletion(tasks, (task) => {
    playTimerChime();
    void showLocalNotification(t("⏰ Time's up"), t("Timer for “{title}” has finished", { title: task.title }), `timer_${task.id}`);
    toast({
      title: t("⏰ Time's up"),
      body: t("Timer for “{title}” has finished", { title: task.title }),
      durationMs: 15000,
      onClick: () => setOpenId(task.id), // the modal shows Done / +15 min
      action: { label: t("Done"), onClick: () => void completeTask(task) },
    });
  });

  // "Starting in 5 min" while the app is open: toast when visible, a system notification when the tab is hidden.
  useLocalReminders(uid, tasks, schedule, today, ({ taskId, title, start }) => {
    const heading = t("⏰ Starting in 5 min: {title}", { title });
    const body = t("Time to get going.");
    if (document.hidden) void showLocalNotification(heading, body, `${taskId}_${start}`);
    else toast({ title: heading, body, onClick: () => setOpenId(taskId) });
  });

  // Any create / edit / delete re-plans everything by earliest deadline.
  const lastUnplaced = useRef("");
  useRebalance(tasks, !!uid && !tasksLoading, (unplaced) => {
    const key = unplaced.map((t) => t.id).sort().join(",");
    if (!key || key === lastUnplaced.current) {
      lastUnplaced.current = key;
      return;
    }
    lastUnplaced.current = key;
    const names = unplaced.slice(0, 2).map((x) => `“${x.title}”`).join(", ");
    // Tasks without a deadline only fail when the whole 3-month window is full; dated ones when their deadline can't be met.
    const undated = unplaced.filter((x) => !tasks.find((tk) => tk.id === x.id)?.deadline);
    if (undated.length > 0 && undated.length === unplaced.length) {
      toast({ title: t("Too many tasks to fit within the next 3 months. Try reducing the count or freeing up schedule slots."), durationMs: 10000 });
      return;
    }
    toast({
      title: unplaced.length === 1 ? t("A task can't fit before its deadline") : t("{n} tasks can't fit before their deadlines", { n: unplaced.length }),
      body: `${names}${unplaced.length > 2 ? "…" : ""}`,
    });
  });

  // Tasks made without a duration (e.g. from chat) get one from similar tasks the user finished before.
  const addTasksSmart = useCallback(
    (inputs: NewTaskInput[]) =>
      addTasks(
        inputs.map((input) => {
          const s = input.durationMin ? null : suggestDuration(input.title, history);
          const withPacing = { ...input, pacing: input.pacing ?? defaultPacing };
          return s ? { ...withPacing, historyEstimate: { durationMin: s.minutes, reasoning: describeSuggestion(s) } } : withPacing;
        }),
      ),
    [addTasks, history, defaultPacing],
  );
  // AI edits go through the same task functions as the UI, so the canvas and the timeline change together.
  const applyRef = useRef<(actions: AssistantAction[]) => Promise<void>>(async () => {});
  const applyActions = useCallback((actions: AssistantAction[]) => applyRef.current(actions), []);
  const { messages, pending, send, ask, stop } = useChat(uid, today, addTasksSmart, defaultPacing, applyActions);

  const [tab, setTab] = useState<Tab>("bubbles");
  const [formOpen, setFormOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openPart, setOpenPart] = useState<{ taskId: string; subId: string } | null>(null);
  const [editBlockId, setEditBlockId] = useState<string | null>(null);

  // Cookie says signed in but Firebase says otherwise: clear the cookie so /login doesn't bounce back.
  useEffect(() => {
    if (!loading && !user) {
      fetch("/api/session", { method: "DELETE" }).finally(() => router.replace("/login"));
    }
  }, [loading, user, router]);

  // Canvas and timeline show live tasks only; past-deadline ones wait in Overdue.
  const active = useMemo(() => tasks.filter((x) => isLiveTask(x, now)), [tasks, now]);
  const overdue = useMemo(
    () => tasks.filter((x) => isOverdueTask(x, now)).sort((a, b) => deadlineMs(a) - deadlineMs(b)),
    [tasks, now],
  );
  const completed = useMemo(
    () => tasks.filter((t) => t.status === "completed").sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")),
    [tasks],
  );
  const rescheduleTask = tasks.find((x) => x.id === rescheduleId && x.status === "active") ?? null;

  // First-run tutorial: a brand-new account (no tasks yet) that hasn't seen it.
  const autoTour =
    !!profile && !profile.hasCompletedOnboarding && !tasksLoading && tasks.length === 0 && !tourDismissed;
  // One support prompt per open browser tab (sessionStorage), once the dashboard is ready and no tutorial is showing.
  const dashboardReady = !!uid && !tasksLoading;
  useEffect(() => {
    if (!dashboardReady || tourOpen || autoTour) return;
    const id = setTimeout(() => {
      try {
        if (sessionStorage.getItem("bubble_support_prompt_shown")) return;
        sessionStorage.setItem("bubble_support_prompt_shown", "1");
      } catch {
        return; // storage blocked: skip rather than nag on every load
      }
      setSupportPromptOpen(true);
    }, 1200);
    return () => clearTimeout(id);
  }, [dashboardReady, tourOpen, autoTour]);

  /** The welcome question for a new account. Either answer is remembered (device and profile), so it is asked once. */
  const answerWelcome = (wantsTour: boolean) => {
    setTourDismissed(true);
    writeLocal(ONBOARDED_KEY, "1");
    if (!wantsTour) writeLocal(TUTORIAL_KEY, "1");
    if (uid) markOnboardingComplete(uid).catch((e) => console.warn("onboarding flag:", e));
    if (wantsTour) setTourOpen(true);
  };
  const closeTour = () => {
    setTourOpen(false);
    setTourDismissed(true);
    writeLocal(ONBOARDED_KEY, "1");
    writeLocal(TUTORIAL_KEY, "1"); // never auto-launches again; replay from ? or the profile
    if (uid) markOnboardingComplete(uid).catch((e) => console.warn("onboarding flag:", e));
  };
  // A timer that is running stays visible on every tab and with every window closed. Its state lives on the task in
  // Firestore (startedAt + accumulatedSeconds), so it also survives tab switches and reloads.
  const runningTasks = active.filter((x) => !!x.startedAt);
  const timerTick = useSecondTick(runningTasks.length > 0);
  const openTask = active.find((t) => t.id === openId) ?? null;
  const doneToday = tasks.filter(
    (t) => t.status === "completed" && t.completedAt && dateKeyInTz(t.completedAt, timezone) === today,
  ).length;

  const summary = useMemo(() => {
    if (tasksLoading) return "";
    if (active.length === 0) return doneToday ? t("{n} done today", { n: doneToday }) : "";
    const planned = (schedule?.blocks ?? []).filter((b) => b.status === "planned");
    const next = planned.find((b) => new Date(b.end).getTime() > now);
    const parts = [t("{n} active", { n: active.length })];
    if (doneToday) parts.push(t("{n} done", { n: doneToday }));
    if (next) parts.push(`${t("Next")}: ${next.title} ${formatTime(next.start)}`);
    return parts.join(" · ");
  }, [tasksLoading, active.length, schedule, doneToday, now, t]);

  /** Delete a bubble (and its slot in today's plan), with a 6 s way back. */
  async function removeTask(task: Task) {
    try {
      const blocks = await removeTaskBlocks([task.id]);
      await deleteTask(task);
      toast({
        title: t("Task deleted"),
        body: task.title,
        placement: "bottom",
        durationMs: 6000,
        action: {
          label: t("Undo"),
          onClick: () => {
            restoreDeleted(task)
              .then(() => restoreBlocks(blocks))
              .catch((e) => {
                console.warn("undo delete failed:", e);
                toast({ title: t("Couldn't restore that task") });
              });
          },
        },
      });
    } catch (e) {
      console.warn("delete failed:", e);
      toast({ title: t("Couldn't delete that task") });
    }
  }

  async function restoreCompleted(task: Task) {
    celebratedIds.current.delete(task.id);
    await restoreTask(task);
    await markTaskBlocksPlanned(task.id).catch(() => {});
    toast({ title: t("Task restored"), body: task.title });
  }
  async function deleteForever(taskIds: string[]) {
    await deleteMany(taskIds);
    await removeTaskBlocks(taskIds).catch(() => {});
  }

  /** Check / uncheck a part. Checking the last one finishes the whole task, with the full pop. */
  async function toggleSubtaskFlow(task: Task, sub: Subtask) {
    const checked = !sub.completed;
    try {
      const othersLeft = (task.subtasks ?? []).some((x) => x.id !== sub.id && !x.completed);
      if (checked && !othersLeft) {
        setOpenId(null);
        setOpenPart(null);
        await completeTask({ ...task, loggedMinutes: (task.loggedMinutes ?? 0) + sub.durationMinutes });
      } else {
        await toggleSubtask(task, sub.id, checked);
      }
    } catch (e) {
      console.warn("toggle part failed:", e);
      toast({ title: t("Couldn't update that part") });
    }
  }

  /** Write a completion and offer the 6 s Undo. */
  async function finish(task: Task, actualMin?: number, celebrate = true) {
    const [undo] = await Promise.all([complete(task, { actualMin }), markTaskBlocksDone(task.id)]);
    // Plays inside the bubble canvas only. On a phone that canvas is hidden while Schedule / Chat is open
    // (its box is 0×0 then), so nothing plays there.
    const box = canvasHost.current?.getBoundingClientRect();
    // One celebration per ~3 s: bulk or rapid completions never stack poppers or overlapping particle bursts.
    if (celebrate && !celebratedIds.current.has(task.id) && box && box.width > 0 && box.height > 0 && Date.now() - lastCelebration.current > 3000) {
      celebratedIds.current.add(task.id);
      lastCelebration.current = Date.now();
      setBursts((b) => [...b, { id: Date.now() + Math.random(), w: Math.round(box.width), h: Math.round(box.height) }]);
    }
    if (undo) {
      toast({
        title: t("Task completed"),
        body: task.title,
        placement: "bottom",
        durationMs: 6000,
        action: {
          label: t("Undo"),
          onClick: () => {
            cancelCelebration();
            celebratedIds.current.delete(task.id);
            Promise.all([undoComplete(undo), markTaskBlocksPlanned(task.id)]).catch((e) => {
              console.warn("undo failed:", e);
              toast({ title: t("Couldn't undo") });
            });
          },
        },
      });
    }
  }

  /** ▶ starts the countdown, ⏸ pauses it (the elapsed minutes are logged). */
  function toggleTimer(task: Task) {
    const run = task.startedAt ? stopTimer(task) : startTimer(task.id);
    void run.catch(() => toast({ title: t("Couldn't update the timer") }));
  }

  /** Pop the bubble first, then write the completion (so the canvas and Firestore change together). */
  async function completeTask(task: Task, actualMin?: number) {
    playBubblePop(); // at the moment the bubble pops
    setPopping((p) => new Set(p).add(task.id));
    try {
      await sleep(reducedMotion ? 120 : POP_MS);
      await finish(task, actualMin);
    } catch (e) {
      console.warn("complete failed:", e);
      toast({ title: t("Couldn't complete that bubble") });
    } finally {
      setPopping((p) => {
        const n = new Set(p);
        n.delete(task.id);
        return n;
      });
    }
  }

  /** "I already did this" on an overdue task: straight to Completed (it isn't on the canvas, so no pop). */
  async function markOverdueDone(task: Task) {
    playBubblePop();
    await finish(task);
  }

  /** Reschedule (new deadline, or none) and let the auto re-plan place it again. */
  async function rescheduleTo(task: Task, iso: string | null) {
    await reschedule(task, iso);
    toast({
      title: t("Rescheduled"),
      body: iso ? `${task.title} · ${new Date(iso).toLocaleString(lang, { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : `${task.title} · ${t("No deadline")}`,
    });
  }

  // What the AI chat can change. Same code paths as the buttons, so there is one source of truth.
  useEffect(() => {
    applyRef.current = async (actions) => {
      for (const a of actions) {
        const task = tasks.find((x) => x.id === a.taskId && x.status === "active");
        if (!task) continue;
        if (a.type === "delete") {
          await removeTask(task);
        } else if (a.type === "complete") {
          playBubblePop();
          await finish(task, undefined, true);
        } else {
          const deadline = a.removeDeadline ? null : (a.deadline ?? task.deadline ?? null);
          const title = a.title ?? task.title;
          if (isOverdueTask(task, Date.now()) && (deadline === null || Date.parse(deadline) > Date.now())) {
            await reschedule(task, deadline); // also re-activates its parts and alerts
          } else {
            await updateTask(task, { title, deadline, durationMin: a.durationMin ?? task.durationMin ?? null, pacing: pacingOf(task) });
          }
          if (a.durationMin && isOverdueTask(task, Date.now())) {
            await updateTask(task, { title, deadline, durationMin: a.durationMin, pacing: pacingOf(task) });
          }
          if (title !== task.title) await renameTaskBlocks(task.id, title).catch(() => {});
        }
      }
    };
  });

  if (loading || !user) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Orb hue="green" size={64} className="animate-pulse" />
      </div>
    );
  }

  const panel: Exclude<Tab, "bubbles"> = tab === "bubbles" ? "schedule" : tab;
  const TABS: Array<{ id: Tab; label: string; icon: typeof Plus }> = [
    { id: "bubbles", label: t("Bubbles"), icon: Sparkles },
    { id: "schedule", label: t("Schedule"), icon: Calendar },
    { id: "chat", label: t("AI Chat"), icon: MessageCircle },
  ];

  return (
    <div className="ambient relative flex h-dvh w-full max-w-full flex-col overflow-hidden">
      <Header
        summary={summary}
        name={user.displayName || user.email || "You"}
        photoURL={user.photoURL}
        onOpenProfile={() => setProfileOpen(true)}
        onOpenHelp={() => setTourOpen(true)}
        onOpenFeedback={() => setFeedbackOpen(true)}
        onSignOut={async () => {
          await signOut();
          router.replace("/login");
        }}
      />

      {runningTasks[0] && (
        <div className="mx-auto flex w-full max-w-[1600px] shrink-0 justify-center px-4 pt-2">
          <button
            type="button"
            onClick={() => setOpenId(runningTasks[0].id)}
            className="glass flex max-w-full items-center gap-2 rounded-full px-4 py-1.5 text-xs shadow-lg transition hover:brightness-125"
          >
            <span className="animate-pulse">⏱</span>
            <span className="min-w-0 truncate">{runningTasks[0].title}</span>
            <span className="tabular-nums text-muted">• {formatClock(sessionSeconds(runningTasks[0], timerTick) * 1000)}</span>
            {runningTasks.length > 1 && <span className="text-muted">+{runningTasks.length - 1}</span>}
          </button>
        </div>
      )}

      <main className="mx-auto flex min-h-0 w-full min-w-0 max-w-[1600px] flex-1 gap-4 overflow-hidden p-4 pb-24 lg:pb-4">
        {/* Bubble canvas */}
        <section className={`${tab === "bubbles" ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 flex-col lg:flex`}>
          <div className="mb-3 flex items-center justify-end">
            <div className="flex gap-2">
              <button
                onClick={() => send("auto-schedule")}
                disabled={pending || active.length === 0}
                className="flex items-center gap-1.5 rounded-full glass px-4 py-2 text-xs font-medium text-foreground transition hover:brightness-125 disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" /> {pending ? t("Planning…") : t("Auto-schedule")}
              </button>
              <button
                onClick={() => setFormOpen(true)}
                data-tour="add-task-btn"
                className="flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-xs font-medium text-background transition hover:opacity-90"
              >
                <Plus className="h-3.5 w-3.5" /> {t("New bubble")}
              </button>
            </div>
          </div>
          <div ref={canvasHost} data-tour="bubble-canvas" className="relative min-h-0 flex-1 overflow-hidden">
            <Celebrations bursts={bursts} onDone={(id) => setBursts((b) => b.filter((x) => x.id !== id))} />
            {error ? (
              <p className="absolute inset-0 flex items-center justify-center text-sm text-red-500">{t("Couldn't load your tasks.")}</p>
            ) : (
              <BubbleCanvas
                tasks={active}
                now={now}
                poppingIds={popping}
                onOpen={setOpenId} // a tap opens the Task modal; complete and the timer live there
              />
            )}
            {!tasksLoading && active.length === 0 && !error && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4 text-center">
                <Orb hue="green" size={96} className="opacity-70" />
                <p className="text-sm text-muted">{t("Tap New bubble to start")}</p>
              </div>
            )}
          </div>
        </section>

        {/* Side panel (desktop) / tab content (mobile) */}
        <aside
          data-tour="side-panel"
          className={`${tab === "bubbles" ? "hidden" : "flex"} glass min-h-0 w-full min-w-0 max-w-full flex-col overflow-hidden rounded-3xl lg:flex lg:w-[400px] lg:shrink-0`}
        >
          <div data-tour="desktop-tabs" className="hidden gap-1 border-b border-line p-2 lg:flex">
            {TABS.filter((x) => x.id !== "bubbles").map(({ id, label, icon: Icon }) => (
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
                completedCount={completed.length}
                overdueCount={overdue.length}
                onOpenCompleted={() => setCompletedOpen(true)}
                onOpenOverdue={() => setOverdueOpen(true)}
                onEditBlockTime={setEditBlockId}
                onOpenTask={setOpenId}
                onOpenPart={(taskId, subId) => setOpenPart({ taskId, subId })}
                onToggleSubtask={(task, sub) => void toggleSubtaskFlow(task, sub)}
                onAdjust={(task, d) => void adjustRemaining(task, d).catch(() => toast({ title: t("Couldn't save. Please try again.") }))}
                onToggleTimer={toggleTimer}
                onComplete={(taskId) => {
                  const task = active.find((x) => x.id === taskId);
                  if (task) void completeTask(task);
                }}
              />
            ) : (
              <ChatPanel messages={messages} pending={pending} hasTasks={active.length > 0} onSend={send} onAsk={ask} onStop={stop} />
            )}
          </div>
        </aside>
      </main>

      {/* Mobile tab bar */}
      <nav data-tour="mobile-nav" className="glass fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 flex rounded-full p-1.5 backdrop-blur-xl lg:hidden" aria-label="Sections">
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

      <ProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} onOpenFeedback={() => setFeedbackOpen(true)} onShowTutorial={() => { setProfileOpen(false); setTourOpen(true); }} />
      <SupportPrompt
        open={supportPromptOpen}
        onClose={() => setSupportPromptOpen(false)}
        onSupport={() => {
          setSupportPromptOpen(false);
          openSupport(); // the same Support modal as the header button
        }}
      />
      <FeedbackSheet open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
      <TaskFormSheet open={formOpen} onClose={() => setFormOpen(false)} onSubmit={addTask} history={history} defaultPacing={defaultPacing} />
      <RescheduleSheet
        task={rescheduleTask}
        now={now}
        onClose={() => setRescheduleId(null)}
        onReschedule={rescheduleTo}
      />
      <OverdueSheet
        open={overdueOpen}
        tasks={overdue}
        now={now}
        onClose={() => setOverdueOpen(false)}
        onDone={markOverdueDone}
        onReschedule={(task) => setRescheduleId(task.id)}
      />
      <CompletedSheet
        open={completedOpen}
        tasks={completed}
        onClose={() => setCompletedOpen(false)}
        onRestore={restoreCompleted}
        onDelete={(task) => deleteForever([task.id])}
        onClearAll={() => deleteForever(completed.map((x) => x.id))}
      />
      <TutorialWelcome open={autoTour && !tourOpen} onYes={() => answerWelcome(true)} onNo={() => answerWelcome(false)} />
      <InteractiveTutorial open={tourOpen} onClose={closeTour} onSelectTab={setTab} bubbleCount={active.length} onCloseDialogs={closeDialogs} />
      <PartDetailSheet
        task={active.find((x) => x.id === openPart?.taskId) ?? null}
        sub={active.find((x) => x.id === openPart?.taskId)?.subtasks?.find((x) => x.id === openPart?.subId) ?? null}
        now={now}
        onClose={() => setOpenPart(null)}
        onToggle={(task, sub) => toggleSubtaskFlow(task, sub)}
        onEditParent={(task) => {
          setOpenPart(null);
          setOpenId(task.id);
        }}
      />
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
        onDelete={removeTask}
        onConfirmTimer={confirmTimer}
        onAdjustSpent={(task, d) => adjustSpent(task, d)}
        onSetRecurrence={setRecurrence}
        splitting={!!openTask && splitting.has(openTask.id)}
        onToggleSubtask={(task, sub, checked) => (checked === !sub.completed ? toggleSubtaskFlow(task, sub) : Promise.resolve())}
        onSaveSubtasks={saveSubtasks}
        onSplit={(task, n) => void split(task, n)}
        onStartTimer={(task) => startTimer(task.id)}
        onStopTimer={stopTimer}
        onEdit={async (task, patch) => {
          await updateTask(task, patch);
          if (patch.title.trim() !== task.title) await renameTaskBlocks(task.id, patch.title.trim()).catch(() => {});
        }}
      />
    </div>
  );
}
