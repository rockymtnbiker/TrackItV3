import type { TargetPeriod, Weekday } from '../types';
import { ALL_WEEKDAYS } from '../types';

/** Rename target: change these two lines when goals_v2 becomes goals. */
export const GOALS_TABLE = 'goals_v2';
export const ENTRIES_TABLE = 'goal_entries';

export type GoalsV2Row = {
  id: string;
  user_id: string;
  parent_id: string | null;
  title: string;
  description: string | null;
  category: string | null;
  sort_order: number | null;
  status: string;
  target_start_date: string | null;
  target_end_date: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
  created_date: string | null;
  deleted_at: string | null;
  unit: string | null;
  target_amount: number | string | null;
  repeat_period: string | null;
  planned_days: number[] | null;
};

const WEEKDAY_BY_INDEX: Weekday[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

const INDEX_BY_WEEKDAY: Record<Weekday, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export function amountToNumber(
  value: number | string | null | undefined,
): number | undefined {
  if (value == null || value === '') {
    return undefined;
  }
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : undefined;
}

/** null repeat_period becomes undefined so the UI keeps treating it as None. */
export function repeatPeriodToPeriod(
  repeatPeriod: string | null | undefined,
): TargetPeriod | undefined {
  const value = repeatPeriod?.toLowerCase();
  if (value === 'week') {
    return 'Week';
  }
  if (value === 'month') {
    return 'Month';
  }
  return undefined;
}

/** Day, Instance, None, and null all store no repeat. */
export function periodToRepeatPeriod(
  period: TargetPeriod | null | undefined,
): 'week' | 'month' | null {
  if (period === 'Week') {
    return 'week';
  }
  if (period === 'Month') {
    return 'month';
  }
  return null;
}

export function plannedDaysToWeekdays(days: number[] | null): Weekday[] {
  if (!days || days.length === 0) {
    return [...ALL_WEEKDAYS];
  }
  return days
    .map((day) => WEEKDAY_BY_INDEX[day])
    .filter((day): day is Weekday => day != null);
}

/** Always an array, including [] so the row stays a habit. */
export function weekdaysToPlannedDays(days: Weekday[]): number[] {
  return days.map((day) => INDEX_BY_WEEKDAY[day]);
}
