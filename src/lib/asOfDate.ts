import type { Goal, GoalEntry } from '../types/goal';
import { parseDateString } from '../utils/date';
import { goalStartDate, isRepeating, periodTotal } from './goalTree';

export { periodBounds, weeklyTarget } from './goalTree';

/** True when D is on or after the step's start date. Both sides are local calendar dates. */
export function startedOnOrBefore(goal: Goal, asOf: string): boolean {
  const start = goalStartDate(goal);
  const day = asOf.slice(0, 10);
  if (!start || !day) {
    return true;
  }
  return parseDateString(day).getTime() >= parseDateString(start).getTime();
}

/**
 * How a one-time step appears on calendar date D.
 * Repeating steps are `hidden` here; they keep their own visibility rules.
 *
 * - open: still unfinished on D (active, or done later than D)
 * - done: completed on D
 * - hidden: completed before D, done with no date, or not an open one-time step
 */
export type OneTimeOnDate = 'hidden' | 'open' | 'done';

export function oneTimeOnDate(node: Goal, asOf: string): OneTimeOnDate {
  if (isRepeating(node) || node.repeatPeriod != null) {
    return 'hidden';
  }
  if (!startedOnOrBefore(node, asOf)) {
    return 'hidden';
  }

  const completed = node.actualEndDate?.slice(0, 10) || null;
  if (node.status === 'done' && completed == null) {
    return 'hidden';
  }
  if (completed != null && completed < asOf) {
    return 'hidden';
  }
  if (completed === asOf) {
    return 'done';
  }
  if (node.status === 'done' && completed != null && completed > asOf) {
    return 'open';
  }
  if (node.status === 'active') {
    return 'open';
  }
  return 'hidden';
}

/** Entries dated on or before D. Later logs do not count when viewing D. */
export function entriesOnOrBefore(
  entries: GoalEntry[],
  asOf: string,
): GoalEntry[] {
  return entries.filter((entry) => entry.entryDate <= asOf);
}

/**
 * Period total as of D: the week (Sun–Sat) or month that contains D,
 * counting only entries in that period dated on or before D.
 */
export function periodTotalAsOf(
  node: Goal,
  entries: GoalEntry[],
  asOf: string,
): number {
  return periodTotal(node, entriesOnOrBefore(entries, asOf), asOf);
}

/** False when the step has no target amount. Uses the as-of-D period total. */
export function isPeriodTargetMetAsOf(
  node: Goal,
  entries: GoalEntry[],
  asOf: string,
): boolean {
  if (node.targetAmount == null) {
    return false;
  }
  return periodTotalAsOf(node, entries, asOf) >= node.targetAmount;
}
