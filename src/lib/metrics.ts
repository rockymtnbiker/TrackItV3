import type { GoalEntry, Goal } from '../types/goal';
import { addDays, parseDateString, toDateString } from '../utils/date';
import { buildChildrenMap, isRepeating, weeklyTarget as goalWeeklyTarget } from './goalTree';

export { goalStartDate } from './goalTree';

function calendarDaysBetween(start: string, end: string): number {
  const ms =
    parseDateString(end.slice(0, 10)).getTime() -
    parseDateString(start.slice(0, 10)).getTime();
  return Math.round(ms / 86_400_000);
}

function monthOf(date: string): { start: string; end: string; days: number } {
  const parsed = parseDateString(date.slice(0, 10));
  const year = parsed.getFullYear();
  const monthIndex = parsed.getMonth();
  const days = new Date(year, monthIndex + 1, 0).getDate();
  return {
    start: toDateString(year, monthIndex, 1),
    end: toDateString(year, monthIndex, days),
    days,
  };
}

/** This node and descendants that track the same unit. */
function sameUnitNodes(node: Goal, nodes: Goal[]): Goal[] {
  if (node.unit == null) {
    return [];
  }

  const childrenMap = buildChildrenMap(nodes);
  const byId = new Map(nodes.map((item) => [item.id, item]));
  const matched: Goal[] = [];
  const seen = new Set<string>();
  const stack = [node.id];

  while (stack.length > 0) {
    const id = stack.pop();
    if (id == null || seen.has(id)) {
      continue;
    }
    seen.add(id);

    const current = id === node.id ? node : byId.get(id);
    if (current && current.unit === node.unit) {
      matched.push(current);
    }

    for (const child of childrenMap.get(id) ?? []) {
      stack.push(child.id);
    }
  }

  return matched;
}

/** Repeating nodes in the subtree, including this node, that share its unit. */
export function planSources(node: Goal, nodes: Goal[]): Goal[] {
  return sameUnitNodes(node, nodes).filter(isRepeating);
}

/**
 * Per-date sums of entry values on this node and same-unit descendants.
 * Dates are inclusive. Days with no entry are omitted.
 */
export function dailyAmounts(
  node: Goal,
  nodes: Goal[],
  entries: GoalEntry[],
  from: string,
  to: string,
): Map<string, number> {
  const totals = new Map<string, number>();
  const start = from.slice(0, 10);
  const end = to.slice(0, 10);
  if (node.unit == null || start > end) {
    return totals;
  }

  const ids = new Set(sameUnitNodes(node, nodes).map((item) => item.id));
  for (const entry of entries) {
    if (!ids.has(entry.goalId) || entry.value == null) {
      continue;
    }
    const date = entry.entryDate.slice(0, 10);
    if (date < start || date > end) {
      continue;
    }
    totals.set(date, (totals.get(date) ?? 0) + entry.value);
  }

  return totals;
}

/**
 * Weekly plan for the Sunday–Saturday week starting at weekStart.
 * Each repeating step contributes weeklyTarget from goalTree.
 * Month goals contribute targetAmount * 7 / days in the week-start month.
 */
export function weeklyTarget(sources: Goal[], weekStart: string): number {
  let total = 0;

  for (const source of sources) {
    const amount = goalWeeklyTarget(source, weekStart);
    if (amount == null) {
      continue;
    }
    total += amount;
  }

  return total;
}

/**
 * Planned amount for a calendar month, prorated from max(month start, startDate)
 * through the month end.
 */
export function monthlyPlanned(
  sources: Goal[],
  month: string,
  startDate: string,
): number {
  const bounds = monthOf(month);
  const from = startDate.slice(0, 10) > bounds.start ? startDate.slice(0, 10) : bounds.start;
  if (from > bounds.end) {
    return 0;
  }

  const days = calendarDaysBetween(from, bounds.end) + 1;
  let total = 0;

  for (const source of sources) {
    if (source.repeatPeriod === 'month') {
      if (source.targetAmount == null) {
        continue;
      }
      total += (source.targetAmount * days) / bounds.days;
      continue;
    }
    const amount = goalWeeklyTarget(source, bounds.start);
    if (amount == null) {
      continue;
    }
    total += (amount * days) / 7;
  }

  return total;
}

export type ProgressPoint = {
  date: string;
  /** Null after today. Cumulative logged amount through that day, as a percent of target. */
  actualPct: number | null;
  expectedPct: number;
};

export type ProgressSeries = {
  days: ProgressPoint[];
  maxPct: number;
};

/**
 * One point per calendar day from start through max(end, today).
 * Entries are already the same-unit amounts the progress bar rolls up.
 * Expected percent uses the pace tick: elapsed days / total days, clamped at 100.
 */
export function buildProgressSeries({
  entries,
  startDate,
  endDate,
  target,
  today,
}: {
  entries: GoalEntry[];
  startDate: string;
  endDate: string;
  target: number;
  today: string;
}): ProgressSeries {
  const start = startDate.slice(0, 10);
  const end = endDate.slice(0, 10);
  const todayDate = today.slice(0, 10);
  const last = end > todayDate ? end : todayDate;
  const totalDays = calendarDaysBetween(start, end) + 1;

  const byDate = new Map<string, number>();
  let beforeStart = 0;
  for (const entry of entries) {
    if (entry.value == null) {
      continue;
    }
    const date = entry.entryDate.slice(0, 10);
    if (date < start) {
      beforeStart += entry.value;
    } else if (date <= last) {
      byDate.set(date, (byDate.get(date) ?? 0) + entry.value);
    }
  }

  const days: ProgressPoint[] = [];
  let cumulative = beforeStart;
  if (start <= last && totalDays > 0) {
    for (let date = start; date <= last; date = addDays(date, 1)) {
      cumulative += byDate.get(date) ?? 0;
      const elapsed = calendarDaysBetween(start, date) + 1;
      const expectedPct =
        totalDays <= 0 ? 0 : Math.min(100, (elapsed / totalDays) * 100);
      let actualPct: number | null = null;
      if (date <= todayDate) {
        actualPct = target > 0 ? (cumulative / target) * 100 : 0;
      }
      days.push({ date, actualPct, expectedPct });
    }
  }

  let maxPct = 100;
  for (const day of days) {
    if (day.actualPct != null && day.actualPct > maxPct) {
      maxPct = day.actualPct;
    }
  }

  return { days, maxPct };
}
