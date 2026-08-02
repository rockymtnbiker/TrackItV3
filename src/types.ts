export type KeyResultStatus = 'not_started' | 'in_progress' | 'completed';

export type LinkedGoalType = 'objective' | 'keyResult';

export type Weekday =
  | 'sunday'
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday';

export interface Objective {
  id: string;
  title: string;
  createdDate: string;
  targetCompletionDate: string;
  affirmation?: string;
  deletedAt?: string;
}

export interface KeyResult {
  id: string;
  objectiveId: string;
  title: string;
  targetNumber: number;
  unit: string;
  startDate: string;
  endDate: string;
  currentProgress: number;
  status: KeyResultStatus;
  deletedAt?: string;
}

export interface KeyActivity {
  id: string;
  title: string;
  cadence: 'weekly';
  /** Derived from scheduledDays.length at creation time. */
  weeklyTarget: number;
  scheduledDays: Weekday[];
  linkedGoalId?: string;
  linkedGoalType?: LinkedGoalType;
  completionLog: string[];
  deletedAt?: string;
}

export interface DailyHabit {
  id: string;
  title: string;
  linkedGoalId?: string;
  linkedGoalType?: LinkedGoalType;
  completionLog: string[];
  streakCount: number;
  deletedAt?: string;
}

export type MoveTarget =
  | { scope: 'standalone' }
  | { scope: 'objective'; objectiveId: string }
  | { scope: 'keyResult'; keyResultId: string };
