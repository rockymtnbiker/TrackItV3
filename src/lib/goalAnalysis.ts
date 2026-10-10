import type { Goal, GoalEntry } from '../types/goal';
import { addDays, formatShortDate, getWeekStart, parseDateString } from '../utils/date';
import { calculateStreak, longestStreak, metWeekStreak } from '../utils/streak';
import { entriesOnOrBefore, periodTotalAsOf } from './asOfDate';
import {
  buildChildrenMap,
  completionDates,
  goalStartDate,
  isDaily,
  isLeaf,
  isRepeating,
  isTracked,
  periodTotal,
  weeklyTarget,
} from './goalTree';

export type AnalysisTone = 'good' | 'warn' | 'neutral';

export type GoalAnalysis = {
  headline: string;
  detail: string;
  tone: AnalysisTone;
};

export type GoalStreaks = {
  current: number;
  best: number;
  unit: 'day' | 'week';
};

const WEEK_WINDOW = 6;

function daysBetween(start: string, end: string): number {
  const ms =
    parseDateString(end.slice(0, 10)).getTime() -
    parseDateString(start.slice(0, 10)).getTime();
  return Math.round(ms / 86_400_000);
}

function formatQty(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function dayWord(count: number): string {
  return count === 1 ? 'day' : 'days';
}

function hasChildren(node: Goal, nodes: Goal[]): boolean {
  return (buildChildrenMap(nodes).get(node.id)?.length ?? 0) > 0;
}

function recentWeekStarts(node: Goal, today: string): string[] {
  const current = getWeekStart(today);
  const startWeek = getWeekStart(goalStartDate(node));
  const firstCandidate = addDays(current, -7 * (WEEK_WINDOW - 1));
  const first = firstCandidate < startWeek ? startWeek : firstCandidate;
  const weeks: string[] = [];
  for (let week = first; week <= current; week = addDays(week, 7)) {
    weeks.push(week);
  }
  return weeks;
}

/** Mean of weekly completion over the last six weeks, as a whole percent. */
function sixWeekAverage(node: Goal, entries: GoalEntry[], today: string): number | null {
  const visible = entriesOnOrBefore(entries, today);
  let sum = 0;
  let count = 0;
  for (const week of recentWeekStarts(node, today)) {
    const target = weeklyTarget(node, week);
    if (target == null || target <= 0) {
      continue;
    }
    sum += periodTotal(node, visible, week) / target;
    count += 1;
  }
  if (count === 0) {
    return null;
  }
  return Math.round((sum / count) * 100);
}

function progressDetail(
  node: Goal,
  total: number,
  target: number | null,
  average: number | null,
): string {
  const averageText = average == null ? null : `6-week average ${average}%`;
  const amount = isTracked(node)
    ? `${formatQty(total)} / ${target == null ? '—' : formatQty(target)} ${node.unit ?? ''}`.trim()
    : `${formatQty(total)} of ${target == null ? '—' : formatQty(target)} days`;
  return averageText ? `${amount} · ${averageText}` : amount;
}

function weeklyAnalysis(
  node: Goal,
  entries: GoalEntry[],
  today: string,
): GoalAnalysis | null {
  const weekStart = getWeekStart(today);
  const target = weeklyTarget(node, weekStart);
  if (target == null || target <= 0) {
    return null;
  }

  const total = periodTotalAsOf(node, entries, today);
  const stats = progressDetail(node, total, target, sixWeekAverage(node, entries, today));
  if (total >= target) {
    return { headline: 'Week complete', detail: stats, tone: 'good' };
  }

  const daysElapsed = daysBetween(weekStart, today) + 1;
  if (total >= (target * daysElapsed) / 7) {
    return { headline: 'On pace this week', detail: stats, tone: 'good' };
  }

  const remaining = target - total;
  const daysLeft = daysBetween(today, addDays(weekStart, 6)) + 1;
  const cantFinish = !isTracked(node) && remaining > daysLeft;
  if (cantFinish) {
    return { headline: "Can't finish this week", detail: stats, tone: 'warn' };
  }

  return {
    headline: 'Behind this week',
    detail: `Needs ${formatQty(remaining)} more by Saturday · ${stats}`,
    tone: 'warn',
  };
}

function oneTimeAnalysis(node: Goal, today: string): GoalAnalysis {
  const completed = node.actualEndDate?.slice(0, 10) || null;
  if (node.status === 'done') {
    return {
      headline: completed ? `Done on ${formatShortDate(completed)}` : 'Done',
      detail: '',
      tone: 'good',
    };
  }

  const deadline = node.targetEndDate?.slice(0, 10) || null;
  if (deadline && deadline < today) {
    const overdue = daysBetween(deadline, today);
    return {
      headline: `Overdue by ${overdue} ${dayWord(overdue)}`,
      detail: '',
      tone: 'warn',
    };
  }
  if (deadline) {
    const left = daysBetween(today, deadline);
    return {
      headline: `Due ${formatShortDate(deadline)} · ${left} ${dayWord(left)} left`,
      detail: '',
      tone: 'neutral',
    };
  }

  return { headline: 'No due date', detail: '', tone: 'neutral' };
}

/**
 * Read-only analysis for one goal as of today.
 * Parents with steps return null; bigDealSummary covers that case.
 * Monthly repeats return null; their week headlines would be the wrong period.
 */
export function goalAnalysis(
  node: Goal,
  nodes: Goal[],
  entries: GoalEntry[],
  today: string,
): GoalAnalysis | null {
  if (hasChildren(node, nodes)) {
    return null;
  }

  const day = today.slice(0, 10);
  if (isRepeating(node)) {
    if (node.repeatPeriod === 'month') {
      return null;
    }
    return weeklyAnalysis(node, entries, day);
  }

  return oneTimeAnalysis(node, day);
}

function weekWasMet(
  node: Goal,
  entries: GoalEntry[],
  weekStart: string,
  today: string,
): boolean {
  const target = weeklyTarget(node, weekStart);
  if (target == null || target <= 0) {
    return false;
  }
  return periodTotal(node, entriesOnOrBefore(entries, today), weekStart) >= target;
}

/** Current and best streak for a repeating step. Null when it does not repeat. */
export function goalStreaks(
  node: Goal,
  entries: GoalEntry[],
  today: string,
): GoalStreaks | null {
  if (!isRepeating(node)) {
    return null;
  }

  const day = today.slice(0, 10);
  const start = goalStartDate(node);
  if (isDaily(node)) {
    const dates = completionDates(node, entriesOnOrBefore(entries, day));
    return {
      current: calculateStreak(dates, day, start),
      best: longestStreak(dates, start),
      unit: 'day',
    };
  }

  const startWeek = getWeekStart(start);
  const currentWeek = getWeekStart(day);
  const met: boolean[] = [];
  for (let week = startWeek; week <= currentWeek; week = addDays(week, 7)) {
    met.push(weekWasMet(node, entries, week, day));
  }
  const streak = metWeekStreak(met);
  return { current: streak.current, best: streak.best, unit: 'week' };
}

export type BigDealSummary = {
  headline: string;
  detail: string;
  tone: AnalysisTone;
  done: number;
  total: number;
  nextUpId: string | null;
};

export type StepTreeRow = {
  id: string;
  depth: number;
  leaf: boolean;
  done: number;
  total: number;
};

function leafOverdue(node: Goal, today: string): boolean {
  const end = node.targetEndDate?.slice(0, 10) || null;
  return end != null && node.status !== 'done' && end < today.slice(0, 10);
}

function leafCounts(
  id: string,
  childrenMap: Map<string | null, Goal[]>,
): { done: number; total: number } {
  const children = childrenMap.get(id) ?? [];
  let done = 0;
  let total = 0;
  for (const child of children) {
    if (isLeaf(child, childrenMap)) {
      total += 1;
      if (child.status === 'done') {
        done += 1;
      }
    } else {
      const nested = leafCounts(child.id, childrenMap);
      done += nested.done;
      total += nested.total;
    }
  }
  return { done, total };
}

/** Leaf completion for a goal that has children. Null when it has none. */
export function bigDealSummary(
  node: Goal,
  nodes: Goal[],
  today: string,
): BigDealSummary | null {
  const childrenMap = buildChildrenMap(nodes);
  if (isLeaf(node, childrenMap)) {
    return null;
  }

  const counts = leafCounts(node.id, childrenMap);
  const leaves: Goal[] = [];
  const walkLeaves = (id: string) => {
    for (const child of childrenMap.get(id) ?? []) {
      if (isLeaf(child, childrenMap)) {
        leaves.push(child);
      } else {
        walkLeaves(child.id);
      }
    }
  };
  walkLeaves(node.id);

  const overdue = leaves.filter((leaf) => leafOverdue(leaf, today)).length;
  const complete = counts.total > 0 && counts.done === counts.total;
  const next = leaves.find((leaf) => leaf.status !== 'done') ?? null;
  const stepWord = counts.total === 1 ? 'step' : 'steps';

  let detail = 'On track';
  let tone: AnalysisTone = 'good';
  if (complete) {
    detail = 'All steps done';
  } else if (overdue > 0) {
    detail = `${overdue} ${overdue === 1 ? 'step' : 'steps'} overdue`;
    tone = 'warn';
  }

  return {
    headline: `${counts.done} of ${counts.total} ${stepWord} done`,
    detail,
    tone,
    done: counts.done,
    total: counts.total,
    nextUpId: complete ? null : (next?.id ?? null),
  };
}

/** Every descendant, depth-first in sort order. Depth 0 is a direct child. */
export function stepTree(node: Goal, nodes: Goal[]): StepTreeRow[] {
  const childrenMap = buildChildrenMap(nodes);
  const rows: StepTreeRow[] = [];

  const walk = (id: string, depth: number) => {
    for (const child of childrenMap.get(id) ?? []) {
      const leaf = isLeaf(child, childrenMap);
      const counts = leaf
        ? { done: child.status === 'done' ? 1 : 0, total: 1 }
        : leafCounts(child.id, childrenMap);
      rows.push({
        id: child.id,
        depth,
        leaf,
        done: counts.done,
        total: counts.total,
      });
      if (!leaf) {
        walk(child.id, depth + 1);
      }
    }
  };

  walk(node.id, 0);
  return rows;
}
