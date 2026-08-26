import type {
  GoalCategory,
  GoalStatus,
  Milestone,
  TargetPeriod,
} from '../types';
import { supabase } from './supabase';

type MilestoneRow = {
  id: string;
  goal_id: string;
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

export type MilestoneInput = {
  goalId: string;
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

export type MilestoneUpdates = Partial<Omit<MilestoneInput, 'goalId'>>;

function mapRowToMilestone(row: MilestoneRow): Milestone {
  const target =
    row.target == null || row.target === ''
      ? undefined
      : Number(row.target);

  return {
    id: row.id,
    goalId: row.goal_id,
    title: row.title,
    sortOrder: row.sort_order ?? 0,
    createdDate: (row.created_date ?? '').slice(0, 10),
    startDate: row.start_date || undefined,
    endDate: row.end_date || undefined,
    category: (row.category as GoalCategory | null) || undefined,
    target: Number.isFinite(target) ? target : undefined,
    unit: row.unit || undefined,
    period: (row.period as TargetPeriod | null) || undefined,
    status: (row.status as GoalStatus) || 'active',
    deletedAt: row.deleted_at ? row.deleted_at.slice(0, 10) : undefined,
  };
}

function toRowUpdates(updates: MilestoneUpdates): Record<string, unknown> {
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
    throw new Error('You must be signed in to manage milestones.');
  }
  return userId;
}

export async function getMilestonesForGoal(goalId: string): Promise<Milestone[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('milestones')
    .select('*')
    .eq('user_id', userId)
    .eq('goal_id', goalId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });

  if (error) {
    throw error;
  }

  return (data as MilestoneRow[] | null)?.map(mapRowToMilestone) ?? [];
}

export async function getMilestones(): Promise<Milestone[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('milestones')
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });

  if (error) {
    throw error;
  }

  return (data as MilestoneRow[] | null)?.map(mapRowToMilestone) ?? [];
}

export async function getMilestone(id: string): Promise<Milestone | null> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('milestones')
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? mapRowToMilestone(data as MilestoneRow) : null;
}

export async function createMilestone(
  milestone: MilestoneInput,
): Promise<Milestone> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('milestones')
    .insert({
      user_id: userId,
      goal_id: milestone.goalId,
      title: milestone.title,
      category: milestone.category || null,
      target: milestone.target ?? null,
      unit: milestone.unit || null,
      period:
        milestone.period && milestone.period !== 'None'
          ? milestone.period
          : null,
      status: milestone.status ?? 'active',
      start_date: milestone.startDate || null,
      end_date: milestone.endDate || null,
      sort_order: milestone.sortOrder ?? 0,
    })
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return mapRowToMilestone(data as MilestoneRow);
}

export async function updateMilestone(
  id: string,
  updates: MilestoneUpdates,
): Promise<Milestone> {
  const row = toRowUpdates(updates);
  const { data, error } = await supabase
    .from('milestones')
    .update(row)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return mapRowToMilestone(data as MilestoneRow);
}

export async function softDeleteMilestone(id: string): Promise<void> {
  const { error } = await supabase
    .from('milestones')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    throw error;
  }
}
