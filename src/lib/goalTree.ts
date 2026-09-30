import type { GoalEntry, GoalNode, RepeatPeriod } from '../types/goalNode';
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
  node: GoalNode,
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
  node: GoalNode,
  entries: GoalEntry[],
  date: string,
): boolean {
  if (node.targetAmount == null) {
    return false;
  }
  return periodTotal(node, entries, date) >= node.targetAmount;
}

/** Repeating steps store planned days. An empty array still repeats. */
export function isRepeating(node: GoalNode): boolean {
  return node.plannedDays !== null;
}

export function isTracked(node: GoalNode): boolean {
  return node.unit !== null;
}

export function buildChildrenMap(
  nodes: GoalNode[],
): Map<string | null, GoalNode[]> {
  const childrenMap = new Map<string | null, GoalNode[]>();

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
  node: GoalNode,
  childrenMap: Map<string | null, GoalNode[]>,
): boolean {
  return (childrenMap.get(node.id)?.length ?? 0) === 0;
}

/**
 * Repeating leaves of any status except done, plus one-time leaves that are
 * active. A top-level step with no children is a leaf.
 */
export function getActionableSteps(nodes: GoalNode[]): GoalNode[] {
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
  node: GoalNode,
  nodes: GoalNode[],
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
