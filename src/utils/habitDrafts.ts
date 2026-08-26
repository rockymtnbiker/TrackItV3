import type { Goal, Habit } from '../types';
import { todayDateString } from './date';

export function withHabitSortOrder(habits: Habit[]): Habit[] {
  return habits.map((habit, index) => ({ ...habit, sortOrder: index }));
}

export function withGoalSortOrder(goals: Goal[]): Goal[] {
  return goals.map((goal, index) => ({ ...goal, sortOrder: index }));
}

export function mergeHabitDraftsIntoList(
  current: Habit[],
  draftHabits: Habit[],
  removedIds: string[],
  belongsToParent: (habit: Habit) => boolean,
): Habit[] {
  const deletedAt = todayDateString();
  const removed = new Set(removedIds);
  const ordered = withHabitSortOrder(draftHabits);
  const orderedById = new Map(ordered.map((item) => [item.id, item]));

  const next = current.map((item) => {
    if (!belongsToParent(item)) {
      return item;
    }
    if (removed.has(item.id)) {
      return { ...item, deletedAt: item.deletedAt ?? deletedAt };
    }
    const draftItem = orderedById.get(item.id);
    if (draftItem) {
      return { ...item, ...draftItem, deletedAt: undefined };
    }
    return item;
  });

  const existingIds = new Set(current.map((item) => item.id));
  for (const item of ordered) {
    if (!existingIds.has(item.id)) {
      next.push({ ...item, deletedAt: undefined });
    }
  }

  return next;
}
