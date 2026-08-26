import type {
  Goal,
  GoalCategory,
  GoalStatus,
  TargetPeriod,
} from '../types';
import { todayDateString } from '../utils/date';
import { supabase } from './supabase';

type GoalRow = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  category: string | null;
  target: number | string | null;
  unit: string | null;
  period: string | null;
  status: string;
  target_start_date: string | null;
  target_end_date: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
  created_date: string | null;
  sort_order: number | null;
  deleted_at: string | null;
};

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

function mapRowToGoal(row: GoalRow): Goal {
  const target =
    row.target == null || row.target === ''
      ? undefined
      : Number(row.target);

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
    target: Number.isFinite(target) ? target : undefined,
    unit: row.unit || undefined,
    period: (row.period as TargetPeriod | null) || undefined,
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
    row.target = updates.target ?? null;
  }
  if (updates.unit !== undefined) {
    row.unit = updates.unit || null;
  }
  if (updates.period !== undefined) {
    row.period =
      updates.period && updates.period !== 'None' ? updates.period : null;
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
    .from('goals')
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });

  if (error) {
    throw error;
  }

  return (data as GoalRow[] | null)?.map(mapRowToGoal) ?? [];
}

export async function createGoal(goal: GoalInput): Promise<Goal> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('goals')
    .insert({
      user_id: userId,
      title: goal.title,
      description: goal.description?.trim() || null,
      category: goal.category || null,
      target: goal.target ?? null,
      unit: goal.unit || null,
      period:
        goal.period && goal.period !== 'None' ? goal.period : null,
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

  return mapRowToGoal(data as GoalRow);
}

export async function updateGoal(
  id: string,
  updates: GoalUpdates,
): Promise<Goal> {
  const row = toRowUpdates(updates);
  const { data, error } = await supabase
    .from('goals')
    .update(row)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return mapRowToGoal(data as GoalRow);
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
    .from('goals')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (fetchError) {
    throw fetchError;
  }
  if (!existing) {
    throw new Error('Goal not found.');
  }

  const row = existing as GoalRow;
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
    .from('goals')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return mapRowToGoal(data as GoalRow);
}

export async function softDeleteGoal(id: string): Promise<void> {
  const { error } = await supabase
    .from('goals')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    throw error;
  }
}

export async function deleteGoal(id: string): Promise<void> {
  const { error } = await supabase.from('goals').delete().eq('id', id);

  if (error) {
    throw error;
  }
}
