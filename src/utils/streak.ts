import { addDays, todayDateString } from './date';

/** Days of entry history kept so a streak can be counted through today. */
export const STREAK_LOOKBACK_DAYS = 90;

export function calculateStreak(
  completionLog: string[],
  referenceDate: string = todayDateString(),
): number {
  const completedDates = new Set(completionLog);
  let anchorDate = referenceDate;

  if (!completedDates.has(anchorDate)) {
    anchorDate = addDays(referenceDate, -1);
    if (!completedDates.has(anchorDate)) {
      return 0;
    }
  }

  let streak = 0;
  let currentDate = anchorDate;

  while (completedDates.has(currentDate)) {
    streak += 1;
    currentDate = addDays(currentDate, -1);
  }

  return streak;
}
