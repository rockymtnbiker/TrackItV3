import type { DailyHabit, KeyActivity, KeyResult, Objective } from '../types';

export type ItemLinkContext =
  | { scope: 'objective'; objectiveId: string }
  | { scope: 'keyResult'; keyResultId: string }
  | { scope: 'standalone' };

export type FormMode =
  | { type: 'objective'; action: 'create' }
  | { type: 'objective'; action: 'edit'; id: string }
  | { type: 'keyResult'; action: 'create'; objectiveId: string }
  | { type: 'keyResult'; action: 'edit'; id: string }
  | { type: 'dailyHabit'; action: 'create'; link: ItemLinkContext }
  | { type: 'dailyHabit'; action: 'edit'; id: string }
  | { type: 'keyActivity'; action: 'create'; link: ItemLinkContext }
  | { type: 'keyActivity'; action: 'edit'; id: string };

export type DeletePrompt =
  | { kind: 'dailyHabit'; id: string; title: string }
  | { kind: 'keyActivity'; id: string; title: string }
  | {
      kind: 'keyResult';
      id: string;
      title: string;
      dependentCount: number;
      parentObjectiveTitle: string;
      parentObjectiveId: string;
    }
  | {
      kind: 'objective';
      id: string;
      title: string;
      dependentCount: number;
      keyResultCount: number;
      otherObjectives: Objective[];
    };

export type MovePrompt =
  | { kind: 'dailyHabit'; id: string; title: string }
  | { kind: 'keyActivity'; id: string; title: string }
  | {
      kind: 'keyResult';
      id: string;
      title: string;
      currentObjectiveId: string;
    };

export type KeyResultKeepChoice = 'standalone' | 'relinkObjective';

export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}`;
}

export function getFormTitle(formMode: FormMode | null): string {
  if (!formMode) {
    return '';
  }

  const labels: Record<FormMode['type'], string> = {
    objective: 'Objective',
    keyResult: 'Key Result',
    dailyHabit: 'Daily Habit',
    keyActivity: 'Key Activity',
  };

  const verb = formMode.action === 'edit' ? 'Edit' : 'Add';
  return `${verb} ${labels[formMode.type]}`;
}

export function populateFormFromItem(
  formMode: FormMode,
  objectives: Objective[],
  keyResults: KeyResult[],
  dailyHabits: DailyHabit[],
  keyActivities: KeyActivity[],
): {
  title: string;
  targetCompletionDate: string;
  affirmation: string;
  targetNumber: string;
  unit: string;
  startDate: string;
  endDate: string;
  scheduledDays: KeyActivity['scheduledDays'];
  itemLinked: boolean;
} {
  const empty = {
    title: '',
    targetCompletionDate: '',
    affirmation: '',
    targetNumber: '',
    unit: '',
    startDate: '',
    endDate: '',
    scheduledDays: [] as KeyActivity['scheduledDays'],
    itemLinked: true,
  };

  if (formMode.action !== 'edit') {
    return empty;
  }

  if (formMode.type === 'objective') {
    const objective = objectives.find((item) => item.id === formMode.id);
    if (!objective) {
      return empty;
    }

    return {
      ...empty,
      title: objective.title,
      targetCompletionDate: objective.targetCompletionDate,
      affirmation: objective.affirmation ?? '',
    };
  }

  if (formMode.type === 'keyResult') {
    const keyResult = keyResults.find((item) => item.id === formMode.id);
    if (!keyResult) {
      return empty;
    }

    return {
      ...empty,
      title: keyResult.title,
      targetNumber: String(keyResult.targetNumber),
      unit: keyResult.unit,
      startDate: keyResult.startDate,
      endDate: keyResult.endDate,
    };
  }

  if (formMode.type === 'dailyHabit') {
    const habit = dailyHabits.find((item) => item.id === formMode.id);
    if (!habit) {
      return empty;
    }

    return {
      ...empty,
      title: habit.title,
      itemLinked: Boolean(habit.linkedGoalId),
    };
  }

  const activity = keyActivities.find((item) => item.id === formMode.id);
  if (!activity) {
    return empty;
  }

  return {
    ...empty,
    title: activity.title,
    scheduledDays: [...activity.scheduledDays],
    itemLinked: Boolean(activity.linkedGoalId),
  };
}
