import type { GoalEntry, Goal, RepeatPeriod } from '../types/goal';
import { addDays, getWeekStart, parseDateString, toDateString } from '../utils/date';

export type PeriodRange = {
  start: string;
  end: string;
};

/** Week is Sunday–Saturday. Month is the calendar month containing the date. */
export function getPeriodRange(
  date: string,
  repeatPeriod: RepeatPeriod,
): PeriodRange {
  if (repeatPeriod === 'month') {
    const parsed = parseDateString(date);
    const year = parsed.getFullYear();
    const monthIndex = parsed.getMonth();
    const lastDay = new Date(year, monthIndex + 1, 0).getDate();
    return {
      start: toDateString(year, monthIndex, 1),
      end: toDateString(year, monthIndex, lastDay),
    };
  }

  const start = getWeekStart(date);
  return { start, end: addDays(start, 6) };
}

/**
 * This step's own entries in the period containing date.
 * Tracked steps sum values. Yes/no steps count entries.
 */
export function periodTotal(
  node: Goal,
  entries: GoalEntry[],
  date: string,
): number {
  const range = getPeriodRange(date, node.repeatPeriod ?? 'week');
  const own = entries.filter(
    (entry) =>
      entry.goalId === node.id &&
      entry.entryDate >= range.start &&
      entry.entryDate <= range.end,
  );

  if (isTracked(node)) {
    return own.reduce((sum, entry) => sum + (entry.value ?? 0), 0);
  }

  return own.length;
}

/** False when the step has no target amount. */
export function isPeriodTargetMet(
  node: Goal,
  entries: GoalEntry[],
  date: string,
): boolean {
  if (node.targetAmount == null) {
    return false;
  }
  return periodTotal(node, entries, date) >= node.targetAmount;
}

/** Repeating steps store planned days. An empty array still repeats. */
export function isRepeating(node: Goal): boolean {
  return node.plannedDays !== null;
}

export function isTracked(node: Goal): boolean {
  return node.unit !== null;
}

/**
 * Dates that count toward a streak. Tracked steps count a day only when the
 * entry value is greater than zero. Yes/no steps count any entry.
 */
export function completionDates(node: Goal, entries: GoalEntry[]): string[] {
  return entries
    .filter((entry) => entry.goalId === node.id)
    .filter((entry) => (isTracked(node) ? (entry.value ?? 0) > 0 : true))
    .map((entry) => entry.entryDate);
}

export function buildChildrenMap(
  nodes: Goal[],
): Map<string | null, Goal[]> {
  const childrenMap = new Map<string | null, Goal[]>();

  for (const node of nodes) {
    const siblings = childrenMap.get(node.parentId);
    if (siblings) {
      siblings.push(node);
    } else {
      childrenMap.set(node.parentId, [node]);
    }
  }

  for (const siblings of childrenMap.values()) {
    siblings.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  return childrenMap;
}

export function isLeaf(
  node: Goal,
  childrenMap: Map<string | null, Goal[]>,
): boolean {
  return (childrenMap.get(node.id)?.length ?? 0) === 0;
}

/**
 * Repeating leaves of any status except done, plus one-time leaves that are
 * active. A top-level step with no children is a leaf.
 */
export function getActionableSteps(nodes: Goal[]): Goal[] {
  const childrenMap = buildChildrenMap(nodes);

  return nodes.filter((node) => {
    if (!isLeaf(node, childrenMap)) {
      return false;
    }
    if (isRepeating(node)) {
      return node.status !== 'done';
    }
    return node.status === 'active';
  });
}

/**
 * Sum of entry values on this step and descendants that use the same unit.
 * Null when the step does not track a unit. Null entry values are skipped.
 */
export function rollupTotal(
  node: Goal,
  nodes: Goal[],
  entries: GoalEntry[],
): number | null {
  if (node.unit == null) {
    return null;
  }

  const childrenMap = buildChildrenMap(nodes);
  const byId = new Map(nodes.map((item) => [item.id, item]));
  const matchingIds = new Set<string>();
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
      matchingIds.add(id);
    }

    for (const child of childrenMap.get(id) ?? []) {
      stack.push(child.id);
    }
  }

  let total = 0;
  for (const entry of entries) {
    if (matchingIds.has(entry.goalId) && entry.value != null) {
      total += entry.value;
    }
  }

  return total;
}

export type PaceInfo = {
  pctDone: number;
  pctExpected: number;
  delta: number;
  onPace: boolean;
};

function calendarDaysBetween(start: string, end: string): number {
  const ms =
    parseDateString(end.slice(0, 10)).getTime() -
    parseDateString(start.slice(0, 10)).getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * Cumulative pace from the actual start (or created date) through the target end.
 * Null when there is no target amount or deadline, or the deadline is not after the start.
 */
export function paceInfo(
  node: Goal,
  total: number,
  today: string,
): PaceInfo | null {
  const start = (node.actualStartDate ?? node.createdDate).slice(0, 10);
  const deadline = node.targetEndDate?.slice(0, 10) || null;
  if (node.targetAmount == null || !deadline || deadline <= start) {
    return null;
  }

  const totalDays = calendarDaysBetween(start, deadline) + 1;
  const elapsedDays = Math.min(
    totalDays,
    Math.max(0, calendarDaysBetween(start, today.slice(0, 10)) + 1),
  );
  const pctDone = (total / node.targetAmount) * 100;
  const pctExpected = (elapsedDays / totalDays) * 100;
  const delta = pctDone - pctExpected;

  return {
    pctDone,
    pctExpected,
    delta,
    onPace: Math.abs(delta) < 1,
  };
}
