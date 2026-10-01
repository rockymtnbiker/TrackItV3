import type { GoalStatus } from './types/goal';

export type { GoalStatus };

export const GOAL_STATUS_CYCLE: GoalStatus[] = ['pending', 'active', 'done'];

export function nextGoalStatus(current: GoalStatus): GoalStatus {
  const index = GOAL_STATUS_CYCLE.indexOf(current);
  return GOAL_STATUS_CYCLE[(index < 0 ? 0 : index + 1) % GOAL_STATUS_CYCLE.length];
}

export type Weekday =
  | 'sunday'
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday';
