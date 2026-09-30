import type { GoalNodeStatus } from '../types/goalNode';

/**
 * Same actual-date rules as setGoalStatus and setMilestoneStatus:
 * - active: set actual_start_date to today if null; clear actual_end_date if set
 * - done: set actual_end_date to today
 * - pending: status only
 */
export function captureStatusDates(
  newStatus: GoalNodeStatus,
  existing: {
    actual_start_date: string | null;
    actual_end_date: string | null;
  },
  today: string,
): Record<string, string | null> {
  const updates: Record<string, string | null> = { status: newStatus };

  if (newStatus === 'active') {
    if (!existing.actual_start_date) {
      updates.actual_start_date = today;
    }
    if (existing.actual_end_date) {
      updates.actual_end_date = null;
    }
  } else if (newStatus === 'done') {
    updates.actual_end_date = today;
  }

  return updates;
}
