import type { Goal, GoalEntry } from '../types/goal';
import { addDays, getWeekStart, parseDateString } from '../utils/date';
import { buildChildrenMap, isLeaf, isRepeating, isTracked, periodTotal } from './goalTree';

export type WeeklyItem = {
  goalId: string;
  title: string;
  parentTitle: string | null;
  isDone: boolean;
  /** 0–1. Repeating weekly steps can be in between; one-time steps are only 0 or 1. */
  partial: number;
};

export type WeeklyReview = {
  items: WeeklyItem[];
  doneCount: number;
  totalCount: number;
  donePct: number;
  partialPct: number;
};

function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function day(value: string | null | undefined): string | null {
  if (value == null || value === '') {
    return null;
  }
  return value.slice(0, 10);
}

/**
 * When the step starts. Actual start wins; otherwise the planned start, then
 * the day it was created.
 */
function startDate(goal: Goal): string {
  return (goal.actualStartDate ?? goal.targetStartDate ?? goal.createdDate).slice(0, 10);
}

function parentTitle(goal: Goal, byId: Map<string, Goal>): string | null {
  if (goal.parentId == null) {
    return null;
  }
  return byId.get(goal.parentId)?.title ?? null;
}

function endOfWeek(weekStart: Date): Date {
  const saturday = parseDateString(addDays(localDateString(weekStart), 6));
  saturday.setHours(23, 59, 59, 999);
  return saturday;
}

/**
 * Actionable steps for the Sunday–Saturday week that starts at weekStart.
 * Week bounds are local calendar days, matching the 6-week section.
 * asOf defaults to Saturday 23:59. Entries and completions after that moment
 * do not count.
 */
export function getWeeklyItems(
  goals: Goal[],
  entries: GoalEntry[],
  weekStart: Date,
  asOf?: Date,
): WeeklyReview {
  const start = localDateString(weekStart);
  const end = addDays(start, 6);
  const cutoff = localDateString(asOf ?? endOfWeek(weekStart));
  const visibleEntries = entries.filter((entry) => entry.entryDate.slice(0, 10) <= cutoff);
  const childrenMap = buildChildrenMap(goals);
  const byId = new Map(goals.map((goal) => [goal.id, goal]));
  const items: WeeklyItem[] = [];

  for (const goal of goals) {
    if (!isLeaf(goal, childrenMap)) {
      continue;
    }
    if (startDate(goal) > end) {
      continue;
    }
    if (goal.repeatPeriod === 'month') {
      continue;
    }

    if (isRepeating(goal) && goal.repeatPeriod === 'week') {
      const total = periodTotal(goal, visibleEntries, start);
      const target = goal.targetAmount;
      const partial = target != null && target > 0 ? Math.min(total / target, 1) : 0;
      items.push({
        goalId: goal.id,
        title: goal.title,
        parentTitle: parentTitle(goal, byId),
        isDone: partial >= 1,
        partial,
      });
      continue;
    }

    if (isRepeating(goal)) {
      continue;
    }

    const deadline = day(goal.targetEndDate);
    const completedOn = day(goal.actualEndDate);
    const deadlineThisWeek = deadline != null && deadline >= start && deadline <= end;
    const completionAfterCutoff = completedOn != null && completedOn > cutoff;
    const completedThisWeek =
      goal.status === 'done' &&
      completedOn != null &&
      !completionAfterCutoff &&
      completedOn >= start &&
      completedOn <= end;
    const openAtCutoff = goal.status === 'active' || completionAfterCutoff;
    if (!openAtCutoff && !deadlineThisWeek && !completedThisWeek) {
      continue;
    }

    const isDone = goal.status === 'done' && !completionAfterCutoff;
    items.push({
      goalId: goal.id,
      title: goal.title,
      parentTitle: parentTitle(goal, byId),
      isDone,
      partial: isDone ? 1 : 0,
    });
  }

  const totalCount = items.length;
  const doneCount = items.filter((item) => item.isDone).length;
  const donePct = totalCount === 0 ? 0 : doneCount / totalCount;
  const partialPct =
    totalCount === 0 ? 0 : items.reduce((sum, item) => sum + item.partial, 0) / totalCount;

  return { items, doneCount, totalCount, donePct, partialPct };
}

const WEEK_STREAK_LOOKBACK = 52;
const WEEK_STREAK_DONE = 0.8;

/**
 * Consecutive weeks at 80%+ done, walking back from last week.
 * The current week adds 1 when it is already at 80%, and does not break the
 * streak when it is not.
 */
export function getWeekStreak(goals: Goal[], entries: GoalEntry[], today: Date): number {
  // TODO: one-time steps need completed_at for history
  const repeatingGoals = goals.filter(
    (goal) => isRepeating(goal) && goal.repeatPeriod === 'week',
  );
  const currentWeekStart = getWeekStart(localDateString(today));
  let streak = 0;

  for (let weeksAgo = 1; weeksAgo <= WEEK_STREAK_LOOKBACK; weeksAgo += 1) {
    const start = addDays(currentWeekStart, -7 * weeksAgo);
    const end = addDays(start, 6);
    const review = getWeeklyItems(repeatingGoals, entries, parseDateString(start));
    const beforeAnyStart =
      review.totalCount === 0 && goals.every((goal) => startDate(goal) > end);
    if (beforeAnyStart || review.donePct < WEEK_STREAK_DONE) {
      break;
    }
    streak += 1;
  }

  const current = getWeeklyItems(goals, entries, parseDateString(currentWeekStart), today);
  if (current.donePct >= WEEK_STREAK_DONE) {
    streak += 1;
  }

  return streak;
}

export type AtRiskItem = {
  goalId: string;
  title: string;
  parentTitle: string | null;
  detail: string;
};

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const AT_RISK_RATE = 1.5;
const AT_RISK_LIMIT = 3;

type RankedRisk = AtRiskItem & {
  /** Lower sorts first: overdue, then can't-finish, then rate. */
  group: number;
  severity: number;
};

function daysBetween(start: string, end: string): number {
  const ms = parseDateString(end).getTime() - parseDateString(start).getTime();
  return Math.round(ms / 86_400_000);
}

function formatQty(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function dayCountLabel(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/**
 * Not-done weekly steps that can no longer be finished at a normal pace.
 * Overdue one-time steps and repeating steps that cannot finish this week
 * sort ahead of pace risk. Returns at most three.
 */
export function getAtRiskItems(
  goals: Goal[],
  entries: GoalEntry[],
  today: Date,
): AtRiskItem[] {
  const todayString = localDateString(today);
  const weekStart = getWeekStart(todayString);
  const weekEnd = addDays(weekStart, 6);
  const daysLeft = daysBetween(todayString, weekEnd) + 1;
  const review = getWeeklyItems(goals, entries, parseDateString(weekStart), today);
  const visibleEntries = entries.filter((entry) => entry.entryDate.slice(0, 10) <= todayString);
  const byId = new Map(goals.map((goal) => [goal.id, goal]));
  const ranked: RankedRisk[] = [];

  for (const item of review.items) {
    if (item.isDone) {
      continue;
    }
    const goal = byId.get(item.goalId);
    if (goal == null) {
      continue;
    }

    if (isRepeating(goal) && goal.repeatPeriod === 'week') {
      const target = goal.targetAmount;
      if (target == null || target <= 0 || daysLeft <= 0) {
        continue;
      }
      const remaining = target - periodTotal(goal, visibleEntries, todayString);
      if (remaining <= 0) {
        continue;
      }
      const normalRate = target / 7;
      const requiredRate = remaining / daysLeft;
      const severity = normalRate > 0 ? requiredRate / normalRate : Number.POSITIVE_INFINITY;
      const cantFinish = !isTracked(goal) && remaining > daysLeft;
      if (!cantFinish && requiredRate <= AT_RISK_RATE * normalRate) {
        continue;
      }
      const amountLabel = isTracked(goal)
        ? `${formatQty(remaining)} ${goal.unit} left · ${dayCountLabel(daysLeft)}`
        : `${formatQty(remaining)} ${remaining === 1 ? 'time' : 'times'} left · ${dayCountLabel(daysLeft)}`;
      ranked.push({
        goalId: goal.id,
        title: item.title,
        parentTitle: item.parentTitle,
        detail: cantFinish ? "can't finish this week" : amountLabel,
        group: cantFinish ? 1 : 2,
        severity,
      });
      continue;
    }

    if (isRepeating(goal)) {
      continue;
    }

    const deadline = day(goal.targetEndDate);
    if (deadline == null) {
      continue;
    }
    const daysUntil = daysBetween(todayString, deadline);
    if (daysUntil > 2) {
      continue;
    }
    const overdue = daysUntil < 0;
    ranked.push({
      goalId: goal.id,
      title: item.title,
      parentTitle: item.parentTitle,
      detail: overdue
        ? 'overdue'
        : `due ${WEEKDAY_LABELS[parseDateString(deadline).getDay()]}`,
      group: overdue ? 0 : 2,
      severity: overdue ? -daysUntil : 1.5 + (2 - daysUntil) * 0.5,
    });
  }

  ranked.sort((a, b) => a.group - b.group || b.severity - a.severity);
  return ranked.slice(0, AT_RISK_LIMIT).map(({ goalId, title, parentTitle, detail }) => ({
    goalId,
    title,
    parentTitle,
    detail,
  }));
}
