import type { Weekday } from '../types';

const WEEKDAY_ORDER: Weekday[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

export const WEEKDAYS = WEEKDAY_ORDER;

export const WEEKDAY_SHORT_LABELS: Record<Weekday, string> = {
  sunday: 'Sun',
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
};

export function getWeekday(dateString: string = todayDateString()): Weekday {
  return WEEKDAY_ORDER[parseDateString(dateString).getDay()];
}

export function isScheduledToday(
  scheduledDays: Weekday[],
  dateString: string = todayDateString(),
): boolean {
  return scheduledDays.includes(getWeekday(dateString));
}

/** Alias — checks whether an activity is scheduled on a specific date. */
export const isScheduledOnDate = isScheduledToday;

export function compareDateStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

export function isFutureDate(
  dateString: string,
  referenceToday: string = todayDateString(),
): boolean {
  return dateString > referenceToday;
}

export function isPastDate(
  dateString: string,
  referenceToday: string = todayDateString(),
): boolean {
  return dateString < referenceToday;
}

export type WeekDayCell = {
  dateString: string;
  weekday: Weekday;
  dayNumber: number;
};

/** Returns Sun–Sat date cells for the week containing referenceDate. */
export function getWeekDays(
  referenceDate: string = todayDateString(),
): WeekDayCell[] {
  const weekStart = getWeekStart(referenceDate);

  return WEEKDAYS.map((weekday, index) => {
    const dateString = addDays(weekStart, index);
    return {
      dateString,
      weekday,
      dayNumber: parseDateString(dateString).getDate(),
    };
  });
}

export function formatScheduledDays(scheduledDays: Weekday[]): string {
  return scheduledDays
    .map((day) => WEEKDAY_SHORT_LABELS[day])
    .join(', ');
}

export function todayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDate(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00`);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function toggleDateInLog(log: string[], date: string): string[] {
  return log.includes(date)
    ? log.filter((entry) => entry !== date)
    : [...log, date];
}

export function addDays(dateString: string, delta: number): string {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + delta);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function toDateString(
  year: number,
  monthIndex: number,
  day: number,
): string {
  const month = String(monthIndex + 1).padStart(2, '0');
  const dayString = String(day).padStart(2, '0');
  return `${year}-${month}-${dayString}`;
}

export function parseDateString(dateString: string): Date {
  return new Date(`${dateString}T00:00:00`);
}

/** Returns the Sunday (start) of the week containing the given date. */
export function getWeekStart(dateString: string): string {
  const date = parseDateString(dateString);
  const dayOfWeek = date.getDay();
  return addDays(dateString, -dayOfWeek);
}

export function isDateInWeek(
  dateString: string,
  referenceDate: string = todayDateString(),
): boolean {
  const weekStart = getWeekStart(referenceDate);
  const weekEnd = addDays(weekStart, 6);
  return dateString >= weekStart && dateString <= weekEnd;
}

export function isDateInMonth(
  dateString: string,
  referenceDate: string = todayDateString(),
): boolean {
  const ref = parseDateString(referenceDate);
  const date = parseDateString(dateString);
  return (
    date.getFullYear() === ref.getFullYear() &&
    date.getMonth() === ref.getMonth()
  );
}

export function weeksInMonth(
  referenceDate: string = todayDateString(),
): number {
  const ref = parseDateString(referenceDate);
  const daysInMonth = new Date(
    ref.getFullYear(),
    ref.getMonth() + 1,
    0,
  ).getDate();
  return Math.ceil(daysInMonth / 7);
}

export function countCompletionsInWeek(
  completionLog: string[],
  referenceDate: string = todayDateString(),
): number {
  return completionLog.filter((date) => isDateInWeek(date, referenceDate))
    .length;
}

export function countCompletionsInMonth(
  completionLog: string[],
  referenceDate: string = todayDateString(),
): number {
  return completionLog.filter((date) => isDateInMonth(date, referenceDate))
    .length;
}
