export type GoalStatus = 'active' | 'done';

export type GoalCategory =
  | 'Health'
  | 'Career'
  | 'Finance'
  | 'Personal'
  | 'Spiritual';

/** Recurring window for a numeric target, or cumulative / per-occurrence. */
export type TargetPeriod = 'None' | 'Day' | 'Week' | 'Month' | 'Instance';

export type LinkedGoalType = 'goal' | 'milestone';

export type Weekday =
  | 'sunday'
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday';

export const GOAL_CATEGORIES: GoalCategory[] = [
  'Health',
  'Career',
  'Finance',
  'Personal',
  'Spiritual',
];

export const TARGET_PERIODS: TargetPeriod[] = [
  'None',
  'Day',
  'Week',
  'Month',
  'Instance',
];

export const ALL_WEEKDAYS: Weekday[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

export interface Goal {
  id: string;
  title: string;
  /** Order within the top-level Goals list (0-based). */
  sortOrder: number;
  createdDate: string;
  startDate: string;
  endDate: string;
  category?: GoalCategory;
  target?: number;
  /** Freeform display label (e.g. "dollars", "miles", "runs"). */
  unit?: string;
  period?: TargetPeriod;
  status: GoalStatus;
  deletedAt?: string;
}

export interface Milestone {
  id: string;
  goalId: string;
  title: string;
  /** Order within the parent Goal's milestones list (0-based). */
  sortOrder: number;
  target?: number;
  /** Freeform display label (e.g. "dollars", "miles", "runs"). */
  unit?: string;
  period?: TargetPeriod;
  startDate?: string;
  endDate?: string;
  category?: GoalCategory;
  status: GoalStatus;
  createdDate: string;
  deletedAt?: string;
}

export interface Habit {
  id: string;
  title: string;
  /** Order within the parent Goal or Milestone habits list (0-based). */
  sortOrder: number;
  /** Selecting all 7 days represents a daily habit. */
  scheduledDays: Weekday[];
  /** Derived as scheduledDays.length — not set independently by the user. */
  weeklyTarget: number;
  linkedGoalId?: string;
  linkedGoalType?: LinkedGoalType;
  completionLog: string[];
  streakCount: number;
  createdDate: string;
  startDate?: string;
  endDate?: string;
  status: GoalStatus;
  deletedAt?: string;
}

export type MoveTarget =
  | { scope: 'standalone' }
  | { scope: 'goal'; goalId: string }
  | { scope: 'milestone'; milestoneId: string };
