import type {
  DailyHabit,
  KeyActivity,
  KeyResult,
  Objective,
} from '../types';
import { existsOnDate, todayDateString } from './date';

export function isActive<T extends { deletedAt?: string }>(item: T): boolean {
  return item.deletedAt == null;
}

export function existsByDate<T extends { createdDate: string }>(
  item: T,
  dateString: string = todayDateString(),
): boolean {
  return existsOnDate(item.createdDate, dateString);
}

/**
 * Completions that count for active progress:
 * on/after createdDate and within [startDate, endDate].
 * Raw log entries outside the range are preserved but excluded here.
 */
export function completionsInActiveRange(
  completionLog: string[],
  createdDate: string,
  startDate: string,
  endDate: string,
): string[] {
  return completionLog.filter(
    (date) =>
      date >= createdDate && date >= startDate && date <= endDate,
  );
}

/** @deprecated Prefer completionsInActiveRange */
export function completionsSinceCreated(
  completionLog: string[],
  createdDate: string,
): string[] {
  return completionLog.filter((date) => date >= createdDate);
}

export function filterActive<T extends { deletedAt?: string }>(
  items: T[],
): T[] {
  return items.filter(isActive);
}

export function hasHistoricalData(
  item: DailyHabit | KeyActivity,
): boolean {
  return item.completionLog.length > 0;
}

/**
 * Dashboard trackable items: active (and already created by referenceDate),
 * or soft-deleted with completion history that can still count historically.
 */
export function dashboardTrackableHabits(
  habits: DailyHabit[],
  referenceDate: string = todayDateString(),
): DailyHabit[] {
  return habits.filter(
    (habit) =>
      (isActive(habit) && existsByDate(habit, referenceDate)) ||
      (!isActive(habit) && hasHistoricalData(habit)),
  );
}

export function dashboardTrackableActivities(
  activities: KeyActivity[],
  referenceDate: string = todayDateString(),
): KeyActivity[] {
  return activities.filter(
    (activity) =>
      (isActive(activity) && existsByDate(activity, referenceDate)) ||
      (!isActive(activity) && hasHistoricalData(activity)),
  );
}

export function activeKeyResultsForObjective(
  keyResults: KeyResult[],
  objectiveId: string,
): KeyResult[] {
  return filterActive(keyResults).filter(
    (keyResult) => keyResult.objectiveId === objectiveId,
  );
}

export function linkedHabitsForKeyResult(
  habits: DailyHabit[],
  keyResultId: string,
): DailyHabit[] {
  return filterActive(habits).filter(
    (habit) =>
      habit.linkedGoalType === 'keyResult' &&
      habit.linkedGoalId === keyResultId,
  );
}

export function linkedActivitiesForKeyResult(
  activities: KeyActivity[],
  keyResultId: string,
): KeyActivity[] {
  return filterActive(activities).filter(
    (activity) =>
      activity.linkedGoalType === 'keyResult' &&
      activity.linkedGoalId === keyResultId,
  );
}

export function linkedHabitsForObjective(
  habits: DailyHabit[],
  objectiveId: string,
): DailyHabit[] {
  return filterActive(habits).filter(
    (habit) =>
      habit.linkedGoalType === 'objective' &&
      habit.linkedGoalId === objectiveId,
  );
}

export function linkedActivitiesForObjective(
  activities: KeyActivity[],
  objectiveId: string,
): KeyActivity[] {
  return filterActive(activities).filter(
    (activity) =>
      activity.linkedGoalType === 'objective' &&
      activity.linkedGoalId === objectiveId,
  );
}

export function keyResultsForObjective(
  keyResults: KeyResult[],
  objectiveId: string,
): KeyResult[] {
  return filterActive(keyResults).filter(
    (keyResult) => keyResult.objectiveId === objectiveId,
  );
}

export function countObjectiveDependents(
  objectiveId: string,
  keyResults: KeyResult[],
  dailyHabits: DailyHabit[],
  keyActivities: KeyActivity[],
): number {
  return (
    keyResultsForObjective(keyResults, objectiveId).length +
    linkedHabitsForObjective(dailyHabits, objectiveId).length +
    linkedActivitiesForObjective(keyActivities, objectiveId).length
  );
}

export function countKeyResultDependents(
  keyResultId: string,
  dailyHabits: DailyHabit[],
  keyActivities: KeyActivity[],
): number {
  return (
    linkedHabitsForKeyResult(dailyHabits, keyResultId).length +
    linkedActivitiesForKeyResult(keyActivities, keyResultId).length
  );
}
