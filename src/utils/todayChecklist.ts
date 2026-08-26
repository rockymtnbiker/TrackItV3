import type { Habit, LinkedGoalType, Milestone } from '../types';
import { isFutureDate, isItemActiveOnDate, isScheduledOnDate } from './date';
import { calculateStreak } from './streak';

export type ChecklistItem = {
  id: string;
  title: string;
  type: 'habit';
  isComplete: boolean;
  isStatusDone: boolean;
  isInteractive: boolean;
  isPlanned: boolean;
  streak?: number;
  sectionKey: string;
};

export type ChecklistSection = {
  key: string;
  title: string;
  items: ChecklistItem[];
};

function getSectionTitle(
  sectionKey: string,
  milestoneTitles: Map<string, string>,
  goalTitles: Map<string, string>,
): string {
  if (sectionKey === 'standalone') {
    return 'Standalone';
  }

  if (sectionKey.startsWith('goal:')) {
    const goalId = sectionKey.replace('goal:', '');
    const title = goalTitles.get(goalId);
    return title ? `Goal: ${title}` : 'Other';
  }

  return milestoneTitles.get(sectionKey) ?? 'Other';
}

function getSectionKey(
  linkedGoalId?: string,
  linkedGoalType?: LinkedGoalType,
): string {
  if (linkedGoalType === 'milestone' && linkedGoalId) {
    return linkedGoalId;
  }

  if (linkedGoalType === 'goal' && linkedGoalId) {
    return `goal:${linkedGoalId}`;
  }

  return 'standalone';
}

function buildSectionsFromMap(
  sectionMap: Map<string, ChecklistItem[]>,
  milestoneTitles: Map<string, string>,
  goalTitles: Map<string, string>,
): ChecklistSection[] {
  const milestoneSections = [...sectionMap.entries()]
    .filter(([key]) => milestoneTitles.has(key))
    .map(([key, items]) => ({
      key,
      title: getSectionTitle(key, milestoneTitles, goalTitles),
      items,
    }));

  const otherSections = [...sectionMap.entries()]
    .filter(([key]) => !milestoneTitles.has(key))
    .map(([key, items]) => ({
      key,
      title: getSectionTitle(key, milestoneTitles, goalTitles),
      items,
    }));

  return [...milestoneSections, ...otherSections];
}

export function buildChecklistSections(
  selectedDate: string,
  habits: Habit[],
  milestoneTitles: Map<string, string>,
  goalTitles: Map<string, string>,
  today: string,
  _milestones: Milestone[] = [],
): ChecklistSection[] {
  const isFuture = isFutureDate(selectedDate, today);
  const isInteractive = !isFuture;
  const sectionMap = new Map<string, ChecklistItem[]>();

  for (const habit of habits) {
    if (!isItemActiveOnDate(habit, selectedDate)) {
      continue;
    }

    if (!isScheduledOnDate(habit.scheduledDays, selectedDate)) {
      continue;
    }

    const sectionKey = getSectionKey(habit.linkedGoalId, habit.linkedGoalType);
    const items = sectionMap.get(sectionKey) ?? [];
    const isStatusDone = habit.status === 'done';
    items.push({
      id: habit.id,
      title: habit.title,
      type: 'habit',
      isComplete: habit.completionLog.includes(selectedDate),
      isStatusDone,
      isInteractive: isInteractive && !isStatusDone,
      isPlanned: isFuture,
      streak: calculateStreak(habit.completionLog, selectedDate),
      sectionKey,
    });
    sectionMap.set(sectionKey, items);
  }

  return buildSectionsFromMap(sectionMap, milestoneTitles, goalTitles);
}
