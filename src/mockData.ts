import type { Goal, Habit, Milestone } from './types';
import { ALL_WEEKDAYS } from './types';

/**
 * Migrated mock data. Prior freeform unit "runs/week" re-parsed into
 * unit: "runs" + period: "Week" (target 3 preserved).
 */
export const goals: Goal[] = [
  {
    id: 'goal-1',
    title: 'Run a marathon',
    sortOrder: 0,
    createdDate: '2026-07-01',
    targetStartDate: '2026-07-01',
    targetEndDate: '2027-01-01',
    status: 'active',
  },
  {
    id: 'goal-2',
    title: 'Become Regional Manager',
    sortOrder: 1,
    createdDate: '2026-08-01',
    targetStartDate: '2026-08-01',
    targetEndDate: '2027-05-01',
    status: 'active',
  },
];

export const milestones: Milestone[] = [
  {
    id: 'milestone-1',
    goalId: 'goal-1',
    title: 'Establish a weekly workout rhythm of 3 runs per week',
    sortOrder: 0,
    target: 3,
    unit: 'runs',
    period: 'Week',
    targetStartDate: '2026-08-01',
    targetEndDate: '2026-08-29',
    status: 'active',
    createdDate: '2026-07-01',
  },
  {
    id: 'milestone-ns-1',
    goalId: 'goal-2',
    title:
      'Research the regional manager role — requirements and responsibilities',
    sortOrder: 0,
    status: 'active',
    createdDate: '2026-08-01',
  },
  {
    id: 'milestone-ns-2',
    goalId: 'goal-2',
    title: 'Talk to my boss about my interest in the promotion',
    sortOrder: 1,
    status: 'active',
    createdDate: '2026-08-01',
  },
  {
    id: 'milestone-ns-3',
    goalId: 'goal-2',
    title: "Complete the 'Financials for Regional Managers' course",
    sortOrder: 2,
    status: 'active',
    createdDate: '2026-08-01',
  },
  {
    id: 'milestone-ns-4',
    goalId: 'goal-2',
    title: 'Build relationships with 3 store managers',
    sortOrder: 3,
    status: 'active',
    createdDate: '2026-08-01',
  },
];

export const habits: Habit[] = [
  {
    id: 'habit-1',
    title: 'Stretch',
    sortOrder: 0,
    linkedGoalId: 'milestone-1',
    linkedGoalType: 'milestone',
    scheduledDays: [...ALL_WEEKDAYS],
    weeklyTarget: 7,
    streakCount: 6,
    createdDate: '2026-08-01',
    startDate: '2026-08-01',
    endDate: '2026-08-29',
    status: 'active',
    completionLog: [
      '2026-08-09',
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
    ],
  },
  {
    id: 'habit-2',
    title: 'Run',
    sortOrder: 1,
    linkedGoalId: 'milestone-1',
    linkedGoalType: 'milestone',
    scheduledDays: ['monday', 'wednesday', 'saturday'],
    weeklyTarget: 3,
    streakCount: 0,
    createdDate: '2026-08-01',
    startDate: '2026-08-01',
    endDate: '2026-08-29',
    status: 'active',
    completionLog: ['2026-08-10', '2026-08-12'],
  },
  {
    id: 'habit-3',
    title: 'Reach out to a store manager',
    sortOrder: 0,
    linkedGoalId: 'milestone-ns-4',
    linkedGoalType: 'milestone',
    scheduledDays: ['friday'],
    weeklyTarget: 1,
    streakCount: 0,
    createdDate: '2026-08-01',
    startDate: '2026-08-01',
    endDate: '2027-05-01',
    status: 'active',
    completionLog: [],
  },
];
