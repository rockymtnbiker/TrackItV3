import type { DailyHabit, KeyActivity } from '../types';
import { isFutureDate, isItemActiveOnDate, isScheduledOnDate } from './date';
import { calculateStreak } from './streak';

export type ChecklistItem = {
  id: string;
  title: string;
  type: 'dailyHabit' | 'keyActivity';
  isComplete: boolean;
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
  keyResultTitles: Map<string, string>,
  objectiveTitles: Map<string, string>,
): string {
  if (sectionKey === 'standalone') {
    return 'Standalone';
  }

  if (sectionKey.startsWith('objective:')) {
    const objectiveId = sectionKey.replace('objective:', '');
    const title = objectiveTitles.get(objectiveId);
    return title ? `Objective: ${title}` : 'Other';
  }

  return keyResultTitles.get(sectionKey) ?? 'Other';
}

function getSectionKey(
  linkedGoalId?: string,
  linkedGoalType?: 'objective' | 'keyResult',
): string {
  if (linkedGoalType === 'keyResult' && linkedGoalId) {
    return linkedGoalId;
  }

  if (linkedGoalType === 'objective' && linkedGoalId) {
    return `objective:${linkedGoalId}`;
  }

  return 'standalone';
}

function buildSectionsFromMap(
  sectionMap: Map<string, ChecklistItem[]>,
  keyResultTitles: Map<string, string>,
  objectiveTitles: Map<string, string>,
): ChecklistSection[] {
  const keyResultSections = [...sectionMap.entries()]
    .filter(([key]) => keyResultTitles.has(key))
    .map(([key, items]) => ({
      key,
      title: getSectionTitle(key, keyResultTitles, objectiveTitles),
      items,
    }));

  const otherSections = [...sectionMap.entries()]
    .filter(([key]) => !keyResultTitles.has(key))
    .map(([key, items]) => ({
      key,
      title: getSectionTitle(key, keyResultTitles, objectiveTitles),
      items,
    }));

  return [...keyResultSections, ...otherSections];
}

export function buildChecklistSections(
  selectedDate: string,
  dailyHabits: DailyHabit[],
  keyActivities: KeyActivity[],
  keyResultTitles: Map<string, string>,
  objectiveTitles: Map<string, string>,
  today: string,
): ChecklistSection[] {
  const isFuture = isFutureDate(selectedDate, today);
  const isInteractive = !isFuture;
  const sectionMap = new Map<string, ChecklistItem[]>();

  for (const habit of dailyHabits) {
    if (!isItemActiveOnDate(habit, selectedDate)) {
      continue;
    }

    const sectionKey = getSectionKey(habit.linkedGoalId, habit.linkedGoalType);
    const items = sectionMap.get(sectionKey) ?? [];
    items.push({
      id: habit.id,
      title: habit.title,
      type: 'dailyHabit',
      isComplete: habit.completionLog.includes(selectedDate),
      isInteractive,
      isPlanned: isFuture,
      streak: calculateStreak(habit.completionLog, selectedDate),
      sectionKey,
    });
    sectionMap.set(sectionKey, items);
  }

  for (const activity of keyActivities) {
    if (!isItemActiveOnDate(activity, selectedDate)) {
      continue;
    }

    if (!isScheduledOnDate(activity.scheduledDays, selectedDate)) {
      continue;
    }

    const sectionKey = getSectionKey(
      activity.linkedGoalId,
      activity.linkedGoalType,
    );
    const items = sectionMap.get(sectionKey) ?? [];
    items.push({
      id: activity.id,
      title: activity.title,
      type: 'keyActivity',
      isComplete: activity.completionLog.includes(selectedDate),
      isInteractive,
      isPlanned: isFuture,
      streak: calculateStreak(activity.completionLog, selectedDate),
      sectionKey,
    });
    sectionMap.set(sectionKey, items);
  }

  return buildSectionsFromMap(sectionMap, keyResultTitles, objectiveTitles);
}
