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
import { OnboardingTour } from "@/components/OnboardingTour";
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
  const [tourOpen, setTourOpen] = useState(false);
  // New tasks (form, chat) default to Balanced; the form's Focus intensity picks per task.
  const defaultPacing = "balanced" as const;
  const [tourDismissed, setTourDismissed] = useState(() => readLocal(ONBOARDED_KEY) === "1");

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
      toast({
        title: list.length === 1 ? `⏰ ${t("1 day left")}: «${first.title}»` : `⏰ ${t("1 day left")}: ${list.length}`,
        body: list.length === 1 && first.deadline ? oneDayBody(first.deadline, Date.now(), t) : undefined,
        onClick: () => setOpenId(first.id),
      });
    },
    [toast, t],
  );

  const {
    tasks, loading: tasksLoading, error, addTask, deleteTask, deleteMany, restoreDeleted, restoreTask, undoComplete, complete, logMinutes,
    startTimer, stopTimer, setRecurrence, updateTask, saveSubtasks, toggleSubtask, reschedule,
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

  // Any create / edit / delete re-plans everything by earliest deadline.
  const lastUnplaced = useRef("");
  useRebalance(tasks, !!uid && !tasksLoading, (unplaced) => {
    const key = unplaced.map((t) => t.id).sort().join(",");
    if (!key || key === lastUnplaced.current) {
      lastUnplaced.current = key;
      return;
    }
    lastUnplaced.current = key;
    const names = unplaced.slice(0, 2).map((t) => `“${t.title}”`).join(", ");
    toast({
      title: unplaced.length === 1 ? t("A task can't fit before its deadline") : t("{n} tasks can't fit before their deadlines", { n: unplaced.length }),
      body: `${names}${unplaced.length > 2 ? "…" : ""}`,
    });
  });

  // Tasks made without a duration (e.g. from chat) get one from similar tasks the user finished before.
  const addTaskSmart = useCallback(
    (input: NewTaskInput) => {
      const s = input.durationMin ? null : suggestDuration(input.title, history);
      const withPacing = { ...input, pacing: input.pacing ?? defaultPacing };
      return addTask(s ? { ...withPacing, historyEstimate: { durationMin: s.minutes, reasoning: describeSuggestion(s) } } : withPacing);
    },
    [addTask, history, defaultPacing],
  );
  // AI edits go through the same task functions as the UI, so the canvas and the timeline change together.
  const applyRef = useRef<(actions: AssistantAction[]) => Promise<void>>(async () => {});
  const applyActions = useCallback((actions: AssistantAction[]) => applyRef.current(actions), []);
  const { messages, pending, send, ask } = useChat(uid, today, addTaskSmart, defaultPacing, applyActions);

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
    if (celebrate && box && box.width > 0 && box.height > 0) {
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
            Promise.all([undoComplete(undo), markTaskBlocksPlanned(task.id)]).catch((e) => {
              console.warn("undo failed:", e);
              toast({ title: t("Couldn't undo") });
            });
          },
        },
      });
    }
  }

  /** Pop the bubble first, then write the completion (so the canvas and Firestore change together). */
  async function completeTask(task: Task, actualMin?: number) {
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
    <div className="ambient relative flex min-h-dvh flex-1 flex-col">
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

      <main className="mx-auto flex w-full max-w-[1600px] flex-1 gap-4 p-4 pb-24 lg:pb-4">
        {/* Bubble canvas */}
        <section className={`${tab === "bubbles" ? "flex" : "hidden"} min-h-0 flex-1 flex-col lg:flex`}>
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
                className="flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-xs font-medium text-background transition hover:opacity-90"
              >
                <Plus className="h-3.5 w-3.5" /> {t("New bubble")}
              </button>
            </div>
          </div>
          <div ref={canvasHost} className="relative min-h-[360px] flex-1">
            <Celebrations bursts={bursts} onDone={(id) => setBursts((b) => b.filter((x) => x.id !== id))} />
            {error ? (
              <p className="absolute inset-0 flex items-center justify-center text-sm text-red-500">{t("Couldn't load your tasks.")}</p>
            ) : (
              <BubbleCanvas
                tasks={active}
                now={now}
                poppingIds={popping}
                onOpen={(id) => {
                  // A scheduled bubble opens its time editor (with a link to the details); others open details.
                  const hasParts = !!active.find((x) => x.id === id)?.subtasks?.length; // parts have no single block to edit
                  const block = hasParts ? undefined : schedule?.blocks.find((b) => b.taskId === id && b.status !== "done");
                  if (block) setEditBlockId(block.id);
                  else setOpenId(id);
                }}
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
          className={`${tab === "bubbles" ? "hidden" : "flex"} glass min-h-0 w-full flex-col overflow-hidden rounded-3xl lg:flex lg:w-[400px] lg:shrink-0`}
          style={{ height: "calc(100dvh - 7.5rem)" }}
        >
          <div className="hidden gap-1 border-b border-line p-2 lg:flex">
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
                onComplete={(taskId) => {
                  const task = active.find((x) => x.id === taskId);
                  if (task) void completeTask(task);
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

      <ProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} onOpenFeedback={() => setFeedbackOpen(true)} />
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
      <OnboardingTour open={tourOpen || autoTour} onClose={closeTour} />
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
        onLogTime={(task, m) => logMinutes(task.id, m)}
        onStartTimer={(task) => startTimer(task.id)}
        onStopTimer={stopTimer}
        onSetRecurrence={setRecurrence}
        splitting={!!openTask && splitting.has(openTask.id)}
        onToggleSubtask={(task, sub, checked) => (checked === !sub.completed ? toggleSubtaskFlow(task, sub) : Promise.resolve())}
        onSaveSubtasks={saveSubtasks}
        onSplit={(task, n) => void split(task, n)}
        onEdit={async (task, patch) => {
          await updateTask(task, patch);
          if (patch.title.trim() !== task.title) await renameTaskBlocks(task.id, patch.title.trim()).catch(() => {});
        }}
      />
    </div>
  );
}
