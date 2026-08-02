import type { DailyHabit, KeyActivity, KeyResult, Objective } from './types';

export const objectives: Objective[] = [
  {
    id: 'objective-1',
    title: 'Run a Marathon',
    createdDate: '2026-01-15',
    targetCompletionDate: '2026-11-01',
    affirmation: 'I am a marathon runner who trains with discipline every day',
  },
];

export const keyResults: KeyResult[] = [
  {
    id: 'key-result-1',
    objectiveId: 'objective-1',
    title: 'Complete training miles',
    targetNumber: 500,
    unit: 'miles',
    startDate: '2026-01-15',
    endDate: '2026-10-15',
    currentProgress: 142,
    status: 'in_progress',
  },
  {
    id: 'key-result-2',
    objectiveId: 'objective-1',
    title: 'Finish race day',
    targetNumber: 1,
    unit: 'marathon',
    startDate: '2026-11-01',
    endDate: '2026-11-01',
    currentProgress: 0,
    status: 'not_started',
  },
];

export const dailyHabits: DailyHabit[] = [
  {
    id: 'daily-habit-1',
    title: 'Morning run',
    linkedGoalId: 'key-result-1',
    linkedGoalType: 'keyResult',
    streakCount: 12,
    completionLog: ['2026-07-05', '2026-07-06', '2026-07-07', '2026-07-08'],
  },
  {
    id: 'daily-habit-2',
    title: 'Stretch daily',
    streakCount: 5,
    completionLog: ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17'],
  },
];

export const keyActivities: KeyActivity[] = [
  {
    id: 'key-activity-1',
    title: 'Long run',
    cadence: 'weekly',
    weeklyTarget: 3,
    scheduledDays: ['monday', 'wednesday', 'saturday'],
    linkedGoalId: 'key-result-1',
    linkedGoalType: 'keyResult',
    completionLog: ['2026-07-15', '2026-07-16'],
  },
];
