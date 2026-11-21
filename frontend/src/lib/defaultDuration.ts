/**
 * A realistic duration for a task whose length nobody stated (chat: "prepare for probability by Nov 22").
 * Never 0 / empty: 60 min for ordinary work, up to 120–180 min for study, exams and projects. Anything of
 * 180 min or more is split into parts by the planner automatically.
 */
const BIG = /(іспит|екзамен|exam|курсов|coursework|диплом|thesis|проєкт|проект|project|research|дослід|вивч|study|learn|підготу|prepar|revise|повтор|probab|ймовірн|алгоритм|lecture|лекці)/i;
const MEDIUM = /(домашн|домашк|homework|assignment|реферат|essay|звіт|report|лаб|lab\b|презентац|presentation|tutorial|практик|контрольн|quiz|тест|написа|write|draft)/i;

export function estimateDefaultMinutes(title: string): number {
  if (BIG.test(title)) return 120;
  if (MEDIUM.test(title)) return 90;
  return 60;
}
