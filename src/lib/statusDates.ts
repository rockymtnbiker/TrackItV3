import type { GoalStatus } from '../types/goal';

/**
 * Actual-date rules when a goal's status changes:
 * - active: set actual_start_date to today if null
 * - done: set actual_end_date to the chosen day, or today
 * - any other status: clear actual_end_date
 */
export function captureStatusDates(
  newStatus: GoalStatus,
  existing: {
    actual_start_date: string | null;
    actual_end_date: string | null;
  },
  today: string,
  endDate?: string,
): Record<string, string | null> {
  const updates: Record<string, string | null> = { status: newStatus };

  if (newStatus === 'active' && !existing.actual_start_date) {
    updates.actual_start_date = today;
  }

  if (newStatus === 'done') {
    const selected = endDate?.slice(0, 10);
    updates.actual_end_date =
      selected && /^\d{4}-\d{2}-\d{2}$/.test(selected) ? selected : today;
  } else {
    updates.actual_end_date = null;
  }

  return updates;
}
