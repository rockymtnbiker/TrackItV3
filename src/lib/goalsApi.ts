import type {
  Goal,
  GoalCategory,
  GoalStatus,
  TargetPeriod,
} from '../types';
import { todayDateString } from '../utils/date';
import {
  GOALS_TABLE,
  amountToNumber,
  periodToRepeatPeriod,
  repeatPeriodToPeriod,
  type GoalsV2Row,
} from './goalTables';
import { supabase } from './supabase';

export type GoalInput = {
  title: string;
  description?: string | null;
  category?: GoalCategory | null;
  target?: number | null;
  unit?: string | null;
  period?: TargetPeriod | null;
  status?: GoalStatus;
  targetStartDate?: string | null;
  targetEndDate?: string | null;
  actualStartDate?: string | null;
  actualEndDate?: string | null;
  sortOrder?: number;
};

export type GoalUpdates = Partial<GoalInput>;

function mapRowToGoal(row: GoalsV2Row): Goal {
  return {
    id: row.id,
    title: row.title,
    description: row.description || undefined,
    sortOrder: row.sort_order ?? 0,
    createdDate: (row.created_date ?? '').slice(0, 10),
    targetStartDate: row.target_start_date || undefined,
    targetEndDate: row.target_end_date || undefined,
    actualStartDate: row.actual_start_date || undefined,
    actualEndDate: row.actual_end_date || undefined,
    category: (row.category as GoalCategory | null) || undefined,
    target: amountToNumber(row.target_amount),
    unit: row.unit || undefined,
    period: repeatPeriodToPeriod(row.repeat_period),
    status: (row.status as GoalStatus) || 'active',
    deletedAt: row.deleted_at ? row.deleted_at.slice(0, 10) : undefined,
  };
}

function toRowUpdates(updates: GoalUpdates): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (updates.title !== undefined) {
    row.title = updates.title;
  }
  if (updates.description !== undefined) {
    row.description = updates.description?.trim() || null;
  }
  if (updates.category !== undefined) {
    row.category = updates.category || null;
  }
  if (updates.target !== undefined) {
    row.target_amount = updates.target ?? null;
  }
  if (updates.unit !== undefined) {
    row.unit = updates.unit || null;
  }
  if (updates.period !== undefined) {
    row.repeat_period = periodToRepeatPeriod(updates.period);
  }
  if (updates.status !== undefined) {
    row.status = updates.status;
  }
  if (updates.targetStartDate !== undefined) {
    row.target_start_date = updates.targetStartDate || null;
  }
  if (updates.targetEndDate !== undefined) {
    row.target_end_date = updates.targetEndDate || null;
  }
  if (updates.actualStartDate !== undefined) {
    row.actual_start_date = updates.actualStartDate || null;
  }
  if (updates.actualEndDate !== undefined) {
    row.actual_end_date = updates.actualEndDate || null;
  }
  if (updates.sortOrder !== undefined) {
    row.sort_order = updates.sortOrder;
  }
  return row;
}

async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    throw error;
  }
  const userId = data.user?.id;
  if (!userId) {
    throw new Error('You must be signed in to manage goals.');
  }
  return userId;
}

export async function getGoals(): Promise<Goal[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from(GOALS_TABLE)
    .select('*')
    .eq('user_id', userId)
    .is('parent_id', null)
    .is('planned_days', null)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });

  if (error) {
    throw error;
  }

  return (data as GoalsV2Row[] | null)?.map(mapRowToGoal) ?? [];
}

export async function createGoal(goal: GoalInput): Promise<Goal> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from(GOALS_TABLE)
    .insert({
      user_id: userId,
      parent_id: null,
      title: goal.title,
      description: goal.description?.trim() || null,
      category: goal.category || null,
      target_amount: goal.target ?? null,
      unit: goal.unit || null,
      repeat_period: periodToRepeatPeriod(goal.period),
      planned_days: null,
      status: goal.status ?? 'active',
      target_start_date: goal.targetStartDate || null,
      target_end_date: goal.targetEndDate || null,
      actual_start_date: goal.actualStartDate || null,
      actual_end_date: goal.actualEndDate || null,
      sort_order: goal.sortOrder ?? 0,
    })
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return mapRowToGoal(data as GoalsV2Row);
}

export async function updateGoal(
  id: string,
  updates: GoalUpdates,
): Promise<Goal> {
  const row = toRowUpdates(updates);
  const { data, error } = await supabase
    .from(GOALS_TABLE)
    .update(row)
    .eq('id', id)
    .is('parent_id', null)
    .is('planned_days', null)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return mapRowToGoal(data as GoalsV2Row);
}

/**
 * Updates status and auto-manages actual dates:
 * - active: set actual_start_date to today if null; clear actual_end_date if set
 * - done: set actual_end_date to today
 * - pending: no automatic date changes
 */
export async function setGoalStatus(
  id: string,
  newStatus: GoalStatus,
): Promise<Goal> {
  const userId = await requireUserId();
  const { data: existing, error: fetchError } = await supabase
    .from(GOALS_TABLE)
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .is('parent_id', null)
    .is('planned_days', null)
    .maybeSingle();

  if (fetchError) {
    throw fetchError;
  }
  if (!existing) {
    throw new Error('Goal not found.');
  }

  const row = existing as GoalsV2Row;
  const today = todayDateString();
  const updates: Record<string, unknown> = { status: newStatus };

  if (newStatus === 'active') {
    if (!row.actual_start_date) {
      updates.actual_start_date = today;
    }
    if (row.actual_end_date) {
      updates.actual_end_date = null;
    }
  } else if (newStatus === 'done') {
    updates.actual_end_date = today;
  }

  const { data, error } = await supabase
    .from(GOALS_TABLE)
    .update(updates)
    .eq('id', id)
    .is('parent_id', null)
    .is('planned_days', null)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return mapRowToGoal(data as GoalsV2Row);
}

export async function softDeleteGoal(id: string): Promise<void> {
  const { error } = await supabase
    .from(GOALS_TABLE)
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('parent_id', null)
    .is('planned_days', null);

  if (error) {
    throw error;
  }
}

export async function deleteGoal(id: string): Promise<void> {
  const { error } = await supabase
    .from(GOALS_TABLE)
    .delete()
    .eq('id', id)
    .is('parent_id', null)
    .is('planned_days', null);

  if (error) {
    throw error;
  }
}
