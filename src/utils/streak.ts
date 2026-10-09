import { addDays, todayDateString } from './date';

/** Days of entry history kept so a streak can be counted through today. */
export const STREAK_LOOKBACK_DAYS = 90;

export function calculateStreak(
  completionLog: string[],
  referenceDate: string = todayDateString(),
  startedOn?: string,
): number {
  const completedDates = new Set(completionLog);
  const start = startedOn?.slice(0, 10) || null;
  let anchorDate = referenceDate;

  if (start && anchorDate < start) {
    return 0;
  }

  if (!completedDates.has(anchorDate)) {
    anchorDate = addDays(referenceDate, -1);
    if ((start && anchorDate < start) || !completedDates.has(anchorDate)) {
      return 0;
    }
  }

  let streak = 0;
  let currentDate = anchorDate;

  while (
    completedDates.has(currentDate) &&
    (start == null || currentDate >= start)
  ) {
    streak += 1;
    currentDate = addDays(currentDate, -1);
  }

  return streak;
}
