export const DAY_MS = 24 * 60 * 60 * 1000;

/** The task is in its last 24 hours (and not yet overdue). */
export const withinOneDay = (deadlineIso: string, nowMs: number): boolean => {
  const left = Date.parse(deadlineIso) - nowMs;
  return left > 0 && left <= DAY_MS;
};

/**
 * Value for `oneDayNotified` on a new or re-dated task: a deadline already inside the last day
 * gets no "1 day left" warning (it would be stale on arrival), a later one will get it when it comes.
 */
export const oneDayFlagFor = (deadlineIso: string, nowMs: number): boolean =>
  Date.parse(deadlineIso) - nowMs <= DAY_MS;

/** "⏰ 1 day left" message body: due today vs tomorrow, in the user's local time. */
export function oneDayBody(deadlineIso: string, nowMs: number, t: (en: string) => string = (x) => x): string {
  const d = new Date(deadlineIso);
  const sameDay = d.toDateString() === new Date(nowMs).toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${sameDay ? t("Due today at") : t("Due tomorrow at")} ${time}`;
}
