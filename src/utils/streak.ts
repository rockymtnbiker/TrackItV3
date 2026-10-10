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

/** Longest run of consecutive days in the log. Days before startedOn are ignored. */
export function longestStreak(
  completionLog: string[],
  startedOn?: string,
): number {
  const start = startedOn?.slice(0, 10) || null;
  const dates = [
    ...new Set(completionLog.map((date) => date.slice(0, 10))),
  ]
    .filter((date) => start == null || date >= start)
    .sort();

  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const date of dates) {
    run = previous != null && addDays(previous, 1) === date ? run + 1 : 1;
    if (run > best) {
      best = run;
    }
    previous = date;
  }
  return best;
}

/**
 * Week flags in chronological order. The last flag is the current week:
 * it extends the current streak only when met, and a miss there does not
 * break the streak of weeks before it. Best is the longest run of mets.
 */
export function metWeekStreak(met: boolean[]): { current: number; best: number } {
  let best = 0;
  let run = 0;
  for (const week of met) {
    run = week ? run + 1 : 0;
    if (run > best) {
      best = run;
    }
  }

  let current = 0;
  for (let index = met.length - 1; index >= 0; index -= 1) {
    const week = met[index];
    if (index === met.length - 1 && !week) {
      continue;
    }
    if (!week) {
      break;
    }
    current += 1;
  }

  return { current, best };
}
