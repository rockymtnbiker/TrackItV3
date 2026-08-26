import type {
  Goal,
  GoalCategory,
  GoalStatus,
  TargetPeriod,
} from '../types';
import { supabase } from './supabase';

type GoalRow = {
  id: string;
  user_id: string;
  title: string;
  category: string | null;
  target: number | string | null;
  unit: string | null;
  period: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  created_date: string | null;
  sort_order: number | null;
  deleted_at: string | null;
};

export type GoalInput = {
  title: string;
  category?: GoalCategory | null;
  target?: number | null;
  unit?: string | null;
  period?: TargetPeriod | null;
  status?: GoalStatus;
  startDate?: string | null;
  endDate?: string | null;
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
    sortOrder: row.sort_order ?? 0,
    createdDate: (row.created_date ?? '').slice(0, 10),
    startDate: row.start_date ?? '',
    endDate: row.end_date ?? '',
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
  if (updates.startDate !== undefined) {
    row.start_date = updates.startDate || null;
  }
  if (updates.endDate !== undefined) {
    row.end_date = updates.endDate || null;
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
      category: goal.category || null,
      target: goal.target ?? null,
      unit: goal.unit || null,
      period:
        goal.period && goal.period !== 'None' ? goal.period : null,
      status: goal.status ?? 'active',
      start_date: goal.startDate || null,
      end_date: goal.endDate || null,
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

export async function softDeleteGoal(id: string): Promise<void> {
  const { error } = await supabase
    .from('goals')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    throw error;
  }
}
