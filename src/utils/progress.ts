import type { KeyResult } from '../types';
import {
  countCompletionsInMonth,
  countCompletionsInWeek,
  todayDateString,
  weeksInMonth,
} from './date';

export const DAILY_HABIT_WEEKLY_TARGET = 7;

export function keyResultProgressPercent(keyResult: KeyResult): number {
  if (keyResult.targetNumber <= 0) {
    return 0;
  }

  return Math.min(
    100,
    (keyResult.currentProgress / keyResult.targetNumber) * 100,
  );
}

export function objectiveProgressPercent(
  objectiveId: string,
  keyResults: KeyResult[],
): number {
  const objectiveKeyResults = keyResults.filter(
    (keyResult) => keyResult.objectiveId === objectiveId,
  );

  if (objectiveKeyResults.length === 0) {
    return 0;
  }

  const total = objectiveKeyResults.reduce(
    (sum, keyResult) => sum + keyResultProgressPercent(keyResult),
    0,
  );

  return Math.round(total / objectiveKeyResults.length);
}

export function weeklyProgressPercent(
  completionLog: string[],
  weeklyTarget: number,
  referenceDate: string = todayDateString(),
): number {
  if (weeklyTarget <= 0) {
    return 0;
  }

  const completions = countCompletionsInWeek(completionLog, referenceDate);
  return Math.min(100, Math.round((completions / weeklyTarget) * 100));
}

export function monthlyProgressPercent(
  completionLog: string[],
  weeklyTarget: number,
  referenceDate: string = todayDateString(),
): number {
  const monthWeeks = weeksInMonth(referenceDate);
  const monthlyTarget = weeklyTarget * monthWeeks;

  if (monthlyTarget <= 0) {
    return 0;
  }

  const completions = countCompletionsInMonth(completionLog, referenceDate);
  return Math.min(100, Math.round((completions / monthlyTarget) * 100));
}

export function weeklyProgressLabel(
  completionLog: string[],
  weeklyTarget: number,
  referenceDate: string = todayDateString(),
): string {
  const completions = countCompletionsInWeek(completionLog, referenceDate);
  return `${completions}/${weeklyTarget}`;
}

export function monthlyProgressLabel(
  completionLog: string[],
  weeklyTarget: number,
  referenceDate: string = todayDateString(),
): string {
  const monthWeeks = weeksInMonth(referenceDate);
  const monthlyTarget = weeklyTarget * monthWeeks;
  const completions = countCompletionsInMonth(completionLog, referenceDate);
  return `${completions}/${monthlyTarget}`;
}
