"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, MessageCircle, Plus, Sparkles } from "lucide-react";
import { Orb } from "@/components/Orb";
import { useAuth } from "@/context/AuthProvider";
import { useChat } from "@/hooks/useChat";
import { useNow } from "@/hooks/useNow";
import { useSchedule } from "@/hooks/useSchedule";
import { useTasks } from "@/hooks/useTasks";
import { useUserProfile } from "@/hooks/useUserProfile";
import { dateKeyInTz, formatTime } from "@/lib/time";
import { BubbleCanvas } from "@/components/bubbles/BubbleCanvas";
import { TaskDetailSheet } from "@/components/bubbles/TaskDetailSheet";
import { TaskFormSheet } from "@/components/bubbles/TaskFormSheet";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { SchedulePanel } from "@/components/schedule/SchedulePanel";
import { BlockEditSheet } from "@/components/schedule/BlockEditSheet";
import { ProfileSheet } from "@/components/profile/ProfileSheet";
import { Header } from "./Header";
import type { Task } from "@/types";

type Tab = "bubbles" | "schedule" | "chat";

export function DashboardShell() {
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const uid = user?.uid;
  const now = useNow();
  const { timezone } = useUserProfile(uid);
  const today = dateKeyInTz(now, timezone);

  const { tasks, loading: tasksLoading, error, addTask, deleteTask, setCompleted, logMinutes } = useTasks(uid);
  const { schedule, markTaskBlocksDone, editBlock } = useSchedule(uid, today);
  const { messages, pending, send, ask } = useChat(uid, today, addTask);

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

  async function completeTask(t: Task) {
    await Promise.all([setCompleted(t.id), markTaskBlocksDone(t.id)]);
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
      <TaskFormSheet open={formOpen} onClose={() => setFormOpen(false)} onSubmit={addTask} />
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
      />
    </div>
  );
}
