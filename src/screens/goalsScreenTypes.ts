import type {
  Goal,
  GoalCategory,
  GoalStatus,
  Habit,
  Milestone,
  TargetPeriod,
  Weekday,
} from '../types';

export type ItemLinkContext =
  | { scope: 'goal'; goalId: string }
  | { scope: 'milestone'; milestoneId: string }
  | { scope: 'standalone' };

export type FormMode =
  | { type: 'goal'; action: 'create' }
  | { type: 'goal'; action: 'edit'; id: string }
  | { type: 'milestone'; action: 'create'; goalId: string }
  | { type: 'milestone'; action: 'edit'; id: string }
  | { type: 'habit'; action: 'create'; link: ItemLinkContext }
  | { type: 'habit'; action: 'edit'; id: string };

export type DeletePrompt =
  | { kind: 'habit'; id: string; title: string }
  | {
      kind: 'milestone';
      id: string;
      title: string;
      dependentCount: number;
      parentGoalTitle: string;
      parentGoalId: string;
    }
  | {
      kind: 'goal';
      id: string;
      title: string;
      dependentCount: number;
      milestoneCount: number;
      otherGoals: Goal[];
    };

export type MovePrompt =
  | { kind: 'habit'; id: string; title: string }
  | {
      kind: 'milestone';
      id: string;
      title: string;
      currentGoalId: string;
    };

export type DateConflictPrompt = {
  message: string;
  onConfirm: () => void;
};

export type MilestoneKeepChoice = 'standalone' | 'relinkGoal';

export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}`;
}

export function getFormTitle(formMode: FormMode | null): string {
  if (!formMode) {
    return '';
  }

  const labels: Record<FormMode['type'], string> = {
    goal: 'Goal',
    milestone: 'Milestone',
    habit: 'Habit',
  };

  const verb = formMode.action === 'edit' ? 'Edit' : 'Add';
  return `${verb} ${labels[formMode.type]}`;
}

export type FormValues = {
  title: string;
  category: GoalCategory | '';
  target: string;
  unit: string;
  period: TargetPeriod;
  startDate: string;
  endDate: string;
  scheduledDays: Weekday[];
  itemLinked: boolean;
  status: GoalStatus;
};

export function populateFormFromItem(
  formMode: FormMode,
  goals: Goal[],
  milestones: Milestone[],
  habits: Habit[],
): FormValues {
  const empty: FormValues = {
    title: '',
    category: '',
    target: '',
    unit: '',
    period: 'None',
    startDate: '',
    endDate: '',
    scheduledDays: [],
    itemLinked: true,
    status: 'active',
  };

  if (formMode.action !== 'edit') {
    if (formMode.type === 'milestone') {
      const parent = goals.find((goal) => goal.id === formMode.goalId);
      return {
        ...empty,
        category: parent?.category ?? '',
      };
    }
    return empty;
  }

  if (formMode.type === 'goal') {
    const goal = goals.find((item) => item.id === formMode.id);
    if (!goal) {
      return empty;
    }

    return {
      ...empty,
      title: goal.title,
      startDate: goal.startDate,
      endDate: goal.endDate,
      category: goal.category ?? '',
      target: goal.target != null ? String(goal.target) : '',
      unit: goal.unit ?? '',
      period: goal.period ?? 'None',
      status: goal.status ?? 'active',
    };
  }

  if (formMode.type === 'milestone') {
    const milestone = milestones.find((item) => item.id === formMode.id);
    if (!milestone) {
      return empty;
    }

    return {
      ...empty,
      title: milestone.title,
      startDate: milestone.startDate ?? '',
      endDate: milestone.endDate ?? '',
      category: milestone.category ?? '',
      target: milestone.target != null ? String(milestone.target) : '',
      unit: milestone.unit ?? '',
      period: milestone.period ?? 'None',
      status: milestone.status ?? 'active',
    };
  }

  const habit = habits.find((item) => item.id === formMode.id);
  if (!habit) {
    return empty;
  }

  return {
    ...empty,
    title: habit.title,
    startDate: habit.startDate ?? '',
    endDate: habit.endDate ?? '',
    scheduledDays: [...habit.scheduledDays],
    itemLinked: Boolean(habit.linkedGoalId),
    status: habit.status ?? 'active',
  };
}
