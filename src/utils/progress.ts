import type { Milestone } from '../types';
import {
  countCompletionsInMonth,
  countCompletionsInWeek,
  todayDateString,
  weeksInMonth,
} from './date';

export function milestoneProgressPercent(milestone: Milestone): number {
  if (milestone.target == null || milestone.target <= 0) {
    return 0;
  }

  // No currentProgress field — optional targets are informational until tracked.
  return 0;
}

export function goalProgressPercent(
  goalId: string,
  milestones: Milestone[],
  referenceDate: string = todayDateString(),
): number {
  const goalMilestones = milestones.filter(
    (milestone) =>
      milestone.goalId === goalId && milestone.createdDate <= referenceDate,
  );

  if (goalMilestones.length === 0) {
    return 0;
  }

  const measurable = goalMilestones.filter(
    (milestone) => milestone.target != null && milestone.target > 0,
  );

  if (measurable.length === 0) {
    return 0;
  }

  const total = measurable.reduce(
    (sum, milestone) => sum + milestoneProgressPercent(milestone),
    0,
  );

  return Math.round(total / measurable.length);
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
