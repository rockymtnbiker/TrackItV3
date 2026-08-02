import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  dailyHabits as initialDailyHabits,
  keyActivities as initialKeyActivities,
  keyResults as initialKeyResults,
  objectives as initialObjectives,
} from '../mockData';
import type {
  DailyHabit,
  KeyActivity,
  KeyResult,
  MoveTarget,
  Objective,
} from '../types';
import { filterActive } from '../utils/activeItems';
import { toggleDateInLog, todayDateString } from '../utils/date';
import { calculateStreak } from '../utils/streak';

interface AppDataContextValue {
  objectives: Objective[];
  keyResults: KeyResult[];
  dailyHabits: DailyHabit[];
  keyActivities: KeyActivity[];
  activeObjectives: Objective[];
  activeKeyResults: KeyResult[];
  activeDailyHabits: DailyHabit[];
  activeKeyActivities: KeyActivity[];
  setObjectives: React.Dispatch<React.SetStateAction<Objective[]>>;
  setKeyResults: React.Dispatch<React.SetStateAction<KeyResult[]>>;
  setDailyHabits: React.Dispatch<React.SetStateAction<DailyHabit[]>>;
  setKeyActivities: React.Dispatch<React.SetStateAction<KeyActivity[]>>;
  toggleDailyHabitCompletion: (habitId: string, date: string) => void;
  toggleKeyActivityCompletion: (activityId: string, date: string) => void;
  softDeleteObjective: (
    objectiveId: string,
    cascade: boolean,
    reassignKeyResultsToObjectiveId?: string,
  ) => void;
  softDeleteKeyResult: (
    keyResultId: string,
    cascade: boolean,
    relinkChildrenToObjective?: boolean,
  ) => void;
  softDeleteDailyHabit: (habitId: string) => void;
  softDeleteKeyActivity: (activityId: string) => void;
  moveDailyHabit: (habitId: string, target: MoveTarget) => void;
  moveKeyActivity: (activityId: string, target: MoveTarget) => void;
  moveKeyResult: (keyResultId: string, objectiveId: string) => void;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

function stampDeleted<T extends { deletedAt?: string }>(item: T): T {
  return { ...item, deletedAt: todayDateString() };
}

function resolveMoveTarget(
  target: MoveTarget,
): { linkedGoalId?: string; linkedGoalType?: 'objective' | 'keyResult' } {
  if (target.scope === 'standalone') {
    return { linkedGoalId: undefined, linkedGoalType: undefined };
  }

  if (target.scope === 'objective') {
    return {
      linkedGoalId: target.objectiveId,
      linkedGoalType: 'objective',
    };
  }

  return {
    linkedGoalId: target.keyResultId,
    linkedGoalType: 'keyResult',
  };
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [objectives, setObjectives] =
    useState<Objective[]>(initialObjectives);
  const [keyResults, setKeyResults] =
    useState<KeyResult[]>(initialKeyResults);
  const [dailyHabits, setDailyHabits] =
    useState<DailyHabit[]>(initialDailyHabits);
  const [keyActivities, setKeyActivities] =
    useState<KeyActivity[]>(initialKeyActivities);

  const activeObjectives = useMemo(
    () => filterActive(objectives),
    [objectives],
  );
  const activeKeyResults = useMemo(
    () => filterActive(keyResults),
    [keyResults],
  );
  const activeDailyHabits = useMemo(
    () => filterActive(dailyHabits),
    [dailyHabits],
  );
  const activeKeyActivities = useMemo(
    () => filterActive(keyActivities),
    [keyActivities],
  );

  const toggleDailyHabitCompletion = (habitId: string, date: string) => {
    setDailyHabits((current) =>
      current.map((habit) => {
        if (habit.id !== habitId) {
          return habit;
        }

        const completionLog = toggleDateInLog(habit.completionLog, date);
        return {
          ...habit,
          completionLog,
          streakCount: calculateStreak(completionLog, date),
        };
      }),
    );
  };

  const toggleKeyActivityCompletion = (activityId: string, date: string) => {
    setKeyActivities((current) =>
      current.map((activity) =>
        activity.id === activityId
          ? {
              ...activity,
              completionLog: toggleDateInLog(activity.completionLog, date),
            }
          : activity,
      ),
    );
  };

  const softDeleteDailyHabit = (habitId: string) => {
    setDailyHabits((current) =>
      current.map((habit) =>
        habit.id === habitId ? stampDeleted(habit) : habit,
      ),
    );
  };

  const softDeleteKeyActivity = (activityId: string) => {
    setKeyActivities((current) =>
      current.map((activity) =>
        activity.id === activityId ? stampDeleted(activity) : activity,
      ),
    );
  };

  const softDeleteKeyResult = (
    keyResultId: string,
    cascade: boolean,
    relinkChildrenToObjective = false,
  ) => {
    const keyResult = keyResults.find((item) => item.id === keyResultId);
    if (!keyResult) {
      return;
    }

    const deletedAt = todayDateString();

    setKeyResults((current) =>
      current.map((item) =>
        item.id === keyResultId ? { ...item, deletedAt } : item,
      ),
    );

    if (cascade) {
      setDailyHabits((current) =>
        current.map((habit) =>
          habit.linkedGoalType === 'keyResult' &&
          habit.linkedGoalId === keyResultId
            ? stampDeleted(habit)
            : habit,
        ),
      );
      setKeyActivities((current) =>
        current.map((activity) =>
          activity.linkedGoalType === 'keyResult' &&
          activity.linkedGoalId === keyResultId
            ? stampDeleted(activity)
            : activity,
        ),
      );
      return;
    }

    const childLink = relinkChildrenToObjective
      ? {
          linkedGoalId: keyResult.objectiveId,
          linkedGoalType: 'objective' as const,
        }
      : {
          linkedGoalId: undefined,
          linkedGoalType: undefined,
        };

    setDailyHabits((current) =>
      current.map((habit) =>
        habit.linkedGoalType === 'keyResult' &&
        habit.linkedGoalId === keyResultId
          ? { ...habit, ...childLink }
          : habit,
      ),
    );
    setKeyActivities((current) =>
      current.map((activity) =>
        activity.linkedGoalType === 'keyResult' &&
        activity.linkedGoalId === keyResultId
          ? { ...activity, ...childLink }
          : activity,
      ),
    );
  };

  const softDeleteObjective = (
    objectiveId: string,
    cascade: boolean,
    reassignKeyResultsToObjectiveId?: string,
  ) => {
    const deletedAt = todayDateString();

    setObjectives((current) =>
      current.map((objective) =>
        objective.id === objectiveId ? { ...objective, deletedAt } : objective,
      ),
    );

    if (cascade) {
      setKeyResults((current) =>
        current.map((keyResult) =>
          keyResult.objectiveId === objectiveId
            ? stampDeleted(keyResult)
            : keyResult,
        ),
      );
      setDailyHabits((current) =>
        current.map((habit) =>
          habit.linkedGoalType === 'objective' &&
          habit.linkedGoalId === objectiveId
            ? stampDeleted(habit)
            : habit,
        ),
      );
      setKeyActivities((current) =>
        current.map((activity) =>
          activity.linkedGoalType === 'objective' &&
          activity.linkedGoalId === objectiveId
            ? stampDeleted(activity)
            : activity,
        ),
      );
      return;
    }

    setDailyHabits((current) =>
      current.map((habit) =>
        habit.linkedGoalType === 'objective' &&
        habit.linkedGoalId === objectiveId
          ? {
              ...habit,
              linkedGoalId: undefined,
              linkedGoalType: undefined,
            }
          : habit,
      ),
    );
    setKeyActivities((current) =>
      current.map((activity) =>
        activity.linkedGoalType === 'objective' &&
        activity.linkedGoalId === objectiveId
          ? {
              ...activity,
              linkedGoalId: undefined,
              linkedGoalType: undefined,
            }
          : activity,
      ),
    );

    if (reassignKeyResultsToObjectiveId) {
      setKeyResults((current) =>
        current.map((keyResult) =>
          keyResult.objectiveId === objectiveId
            ? {
                ...keyResult,
                objectiveId: reassignKeyResultsToObjectiveId,
              }
            : keyResult,
        ),
      );
    } else {
      setKeyResults((current) =>
        current.map((keyResult) =>
          keyResult.objectiveId === objectiveId
            ? stampDeleted(keyResult)
            : keyResult,
        ),
      );
    }
  };

  const moveDailyHabit = (habitId: string, target: MoveTarget) => {
    const link = resolveMoveTarget(target);
    setDailyHabits((current) =>
      current.map((habit) =>
        habit.id === habitId ? { ...habit, ...link } : habit,
      ),
    );
  };

  const moveKeyActivity = (activityId: string, target: MoveTarget) => {
    const link = resolveMoveTarget(target);
    setKeyActivities((current) =>
      current.map((activity) =>
        activity.id === activityId ? { ...activity, ...link } : activity,
      ),
    );
  };

  const moveKeyResult = (keyResultId: string, objectiveId: string) => {
    setKeyResults((current) =>
      current.map((keyResult) =>
        keyResult.id === keyResultId ? { ...keyResult, objectiveId } : keyResult,
      ),
    );
  };

  const value = useMemo(
    () => ({
      objectives,
      keyResults,
      dailyHabits,
      keyActivities,
      activeObjectives,
      activeKeyResults,
      activeDailyHabits,
      activeKeyActivities,
      setObjectives,
      setKeyResults,
      setDailyHabits,
      setKeyActivities,
      toggleDailyHabitCompletion,
      toggleKeyActivityCompletion,
      softDeleteObjective,
      softDeleteKeyResult,
      softDeleteDailyHabit,
      softDeleteKeyActivity,
      moveDailyHabit,
      moveKeyActivity,
      moveKeyResult,
    }),
    [
      objectives,
      keyResults,
      dailyHabits,
      keyActivities,
      activeObjectives,
      activeKeyResults,
      activeDailyHabits,
      activeKeyActivities,
    ],
  );

  return (
    <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
  );
}

export function useAppData() {
  const context = useContext(AppDataContext);
  if (!context) {
    throw new Error('useAppData must be used within AppDataProvider');
  }
  return context;
}

export {
  keyResultsForObjective,
  linkedActivitiesForKeyResult,
  linkedActivitiesForObjective,
  linkedHabitsForKeyResult,
  linkedHabitsForObjective,
} from '../utils/activeItems';
