import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  goals as initialGoals,
  habits as initialHabits,
  milestones as initialMilestones,
} from '../mockData';
import type { Goal, Habit, LinkedGoalType, Milestone, MoveTarget } from '../types';
import { filterActive } from '../utils/activeItems';
import { toggleDateInLog, todayDateString } from '../utils/date';
import { calculateStreak } from '../utils/streak';

interface AppDataContextValue {
  goals: Goal[];
  milestones: Milestone[];
  habits: Habit[];
  activeGoals: Goal[];
  activeMilestones: Milestone[];
  activeHabits: Habit[];
  setGoals: React.Dispatch<React.SetStateAction<Goal[]>>;
  setMilestones: React.Dispatch<React.SetStateAction<Milestone[]>>;
  setHabits: React.Dispatch<React.SetStateAction<Habit[]>>;
  toggleHabitCompletion: (habitId: string, date: string) => void;
  softDeleteGoal: (
    goalId: string,
    cascade: boolean,
    reassignMilestonesToGoalId?: string,
  ) => void;
  softDeleteMilestone: (
    milestoneId: string,
    cascade: boolean,
    relinkChildrenToGoal?: boolean,
  ) => void;
  softDeleteHabit: (habitId: string) => void;
  moveHabit: (habitId: string, target: MoveTarget) => void;
  moveMilestone: (milestoneId: string, goalId: string) => void;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

function stampDeleted<T extends { deletedAt?: string }>(item: T): T {
  return { ...item, deletedAt: todayDateString() };
}

function resolveMoveTarget(
  target: MoveTarget,
): { linkedGoalId?: string; linkedGoalType?: LinkedGoalType } {
  if (target.scope === 'standalone') {
    return { linkedGoalId: undefined, linkedGoalType: undefined };
  }

  if (target.scope === 'goal') {
    return {
      linkedGoalId: target.goalId,
      linkedGoalType: 'goal',
    };
  }

  return {
    linkedGoalId: target.milestoneId,
    linkedGoalType: 'milestone',
  };
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [goals, setGoals] = useState<Goal[]>(initialGoals);
  const [milestones, setMilestones] =
    useState<Milestone[]>(initialMilestones);
  const [habits, setHabits] = useState<Habit[]>(initialHabits);

  const activeGoals = useMemo(() => filterActive(goals), [goals]);
  const activeMilestones = useMemo(
    () => filterActive(milestones),
    [milestones],
  );
  const activeHabits = useMemo(() => filterActive(habits), [habits]);

  const toggleHabitCompletion = (habitId: string, date: string) => {
    setHabits((current) =>
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

  const softDeleteHabit = (habitId: string) => {
    setHabits((current) =>
      current.map((habit) =>
        habit.id === habitId ? stampDeleted(habit) : habit,
      ),
    );
  };

  const softDeleteMilestone = (
    milestoneId: string,
    cascade: boolean,
    relinkChildrenToGoal = false,
  ) => {
    const milestone = milestones.find((item) => item.id === milestoneId);
    if (!milestone) {
      return;
    }

    const deletedAt = todayDateString();

    setMilestones((current) =>
      current.map((item) =>
        item.id === milestoneId ? { ...item, deletedAt } : item,
      ),
    );

    if (cascade) {
      setHabits((current) =>
        current.map((habit) =>
          habit.linkedGoalType === 'milestone' &&
          habit.linkedGoalId === milestoneId
            ? stampDeleted(habit)
            : habit,
        ),
      );
      return;
    }

    const childLink = relinkChildrenToGoal
      ? {
          linkedGoalId: milestone.goalId,
          linkedGoalType: 'goal' as const,
        }
      : {
          linkedGoalId: undefined,
          linkedGoalType: undefined,
        };

    setHabits((current) =>
      current.map((habit) =>
        habit.linkedGoalType === 'milestone' &&
        habit.linkedGoalId === milestoneId
          ? { ...habit, ...childLink }
          : habit,
      ),
    );
  };

  const softDeleteGoal = (
    goalId: string,
    cascade: boolean,
    reassignMilestonesToGoalId?: string,
  ) => {
    const deletedAt = todayDateString();

    setGoals((current) =>
      current.map((goal) =>
        goal.id === goalId ? { ...goal, deletedAt } : goal,
      ),
    );

    if (cascade) {
      setMilestones((current) =>
        current.map((milestone) =>
          milestone.goalId === goalId ? stampDeleted(milestone) : milestone,
        ),
      );
      setHabits((current) =>
        current.map((habit) =>
          habit.linkedGoalType === 'goal' && habit.linkedGoalId === goalId
            ? stampDeleted(habit)
            : habit,
        ),
      );
      return;
    }

    setHabits((current) =>
      current.map((habit) =>
        habit.linkedGoalType === 'goal' && habit.linkedGoalId === goalId
          ? {
              ...habit,
              linkedGoalId: undefined,
              linkedGoalType: undefined,
            }
          : habit,
      ),
    );

    if (reassignMilestonesToGoalId) {
      setMilestones((current) =>
        current.map((milestone) =>
          milestone.goalId === goalId
            ? { ...milestone, goalId: reassignMilestonesToGoalId }
            : milestone,
        ),
      );
    } else {
      setMilestones((current) =>
        current.map((milestone) =>
          milestone.goalId === goalId ? stampDeleted(milestone) : milestone,
        ),
      );
    }
  };

  const moveHabit = (habitId: string, target: MoveTarget) => {
    const link = resolveMoveTarget(target);
    setHabits((current) =>
      current.map((habit) =>
        habit.id === habitId ? { ...habit, ...link } : habit,
      ),
    );
  };

  const moveMilestone = (milestoneId: string, goalId: string) => {
    setMilestones((current) =>
      current.map((milestone) =>
        milestone.id === milestoneId ? { ...milestone, goalId } : milestone,
      ),
    );
  };

  const value = useMemo(
    () => ({
      goals,
      milestones,
      habits,
      activeGoals,
      activeMilestones,
      activeHabits,
      setGoals,
      setMilestones,
      setHabits,
      toggleHabitCompletion,
      softDeleteGoal,
      softDeleteMilestone,
      softDeleteHabit,
      moveHabit,
      moveMilestone,
    }),
    [goals, milestones, habits, activeGoals, activeMilestones, activeHabits],
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
  linkedHabitsForGoal,
  linkedHabitsForMilestone,
  milestonesForGoal,
  standaloneHabits,
} from '../utils/activeItems';
