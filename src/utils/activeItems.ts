import type { Goal, Habit, Milestone } from '../types';
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

export function completionsInActiveRange(
  completionLog: string[],
  createdDate: string,
  startDate?: string,
  endDate?: string,
): string[] {
  const rangeStart = startDate || createdDate;
  return completionLog.filter((date) => {
    if (date < createdDate || date < rangeStart) {
      return false;
    }
    if (endDate && date > endDate) {
      return false;
    }
    return true;
  });
}

/** @deprecated Prefer completionsInActiveRange */
export function completionsSinceCreated(
  completionLog: string[],
  createdDate: string,
): string[] {
  return completionLog.filter((date) => date >= createdDate);
}

export function filterActive<T extends { deletedAt?: string }>(items: T[]): T[] {
  return items.filter(isActive);
}

export function hasHistoricalData(item: Habit): boolean {
  return item.completionLog.length > 0;
}

export function dashboardTrackableHabits(
  habits: Habit[],
  referenceDate: string = todayDateString(),
): Habit[] {
  return habits.filter(
    (habit) =>
      (isActive(habit) && existsByDate(habit, referenceDate)) ||
      (!isActive(habit) && hasHistoricalData(habit)),
  );
}

export function milestonesForGoal(
  milestones: Milestone[],
  goalId: string,
): Milestone[] {
  return filterActive(milestones)
    .filter((milestone) => milestone.goalId === goalId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function linkedHabitsForMilestone(
  habits: Habit[],
  milestoneId: string,
): Habit[] {
  return filterActive(habits)
    .filter(
      (habit) =>
        habit.linkedGoalType === 'milestone' &&
        habit.linkedGoalId === milestoneId,
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function linkedHabitsForGoal(habits: Habit[], goalId: string): Habit[] {
  return filterActive(habits)
    .filter(
      (habit) =>
        habit.linkedGoalType === 'goal' && habit.linkedGoalId === goalId,
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Habits not linked to a Goal or Milestone. */
export function standaloneHabits(habits: Habit[]): Habit[] {
  return filterActive(habits)
    .filter((habit) => !habit.linkedGoalId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function countGoalDependents(
  goalId: string,
  milestones: Milestone[],
  habits: Habit[],
): number {
  return (
    milestonesForGoal(milestones, goalId).length +
    linkedHabitsForGoal(habits, goalId).length
  );
}

export function countMilestoneDependents(
  milestoneId: string,
  habits: Habit[],
): number {
  return linkedHabitsForMilestone(habits, milestoneId).length;
}
