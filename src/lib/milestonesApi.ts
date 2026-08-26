import type {
  GoalCategory,
  GoalStatus,
  Milestone,
  TargetPeriod,
} from '../types';
import { todayDateString } from '../utils/date';
import { supabase } from './supabase';

type MilestoneRow = {
  id: string;
  goal_id: string;
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

export type MilestoneInput = {
  goalId: string;
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

export type MilestoneUpdates = Partial<Omit<MilestoneInput, 'goalId'>>;

function toDateOnly(value: string | null | undefined): string | undefined {
  if (value == null || value === '') {
    return undefined;
  }
  return String(value).slice(0, 10);
}

function mapRowToMilestone(row: MilestoneRow): Milestone {
  const target =
    row.target == null || row.target === ''
      ? undefined
      : Number(row.target);

  return {
    id: row.id,
    goalId: row.goal_id,
    title: row.title,
    description: row.description || undefined,
    sortOrder: row.sort_order ?? 0,
    createdDate: toDateOnly(row.created_date) ?? '',
    targetStartDate: toDateOnly(row.target_start_date),
    targetEndDate: toDateOnly(row.target_end_date),
    actualStartDate: toDateOnly(row.actual_start_date),
    actualEndDate: toDateOnly(row.actual_end_date),
    category: (row.category as GoalCategory | null) || undefined,
    target: Number.isFinite(target) ? target : undefined,
    unit: row.unit || undefined,
    period: (row.period as TargetPeriod | null) || undefined,
    status: (row.status as GoalStatus) || 'active',
    deletedAt: toDateOnly(row.deleted_at),
  };
}

function toRowUpdates(updates: MilestoneUpdates): Record<string, unknown> {
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

/** Visible on Today's In Progress: active, or actual_end_date is today. */
export function isInProgressMilestone(
  milestone: Pick<Milestone, 'status' | 'actualEndDate'>,
  today: string = todayDateString(),
): boolean {
  if (milestone.status === 'active') {
    return true;
  }
  return toDateOnly(milestone.actualEndDate) === today;
}

/** Active milestones, plus any with actual_end_date = today (even if pending). */
export async function getAllActiveMilestones(): Promise<Milestone[]> {
  const userId = await requireUserId();
  const today = todayDateString();
  const { data, error } = await supabase
    .from('milestones')
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .or(`status.eq.active,actual_end_date.eq.${today}`)
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
      description: milestone.description?.trim() || null,
      category: milestone.category || null,
      target: milestone.target ?? null,
      unit: milestone.unit || null,
      period:
        milestone.period && milestone.period !== 'None'
          ? milestone.period
          : null,
      status: milestone.status ?? 'active',
      target_start_date: milestone.targetStartDate || null,
      target_end_date: milestone.targetEndDate || null,
      actual_start_date: milestone.actualStartDate || null,
      actual_end_date: milestone.actualEndDate || null,
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

/**
 * Updates status and auto-manages actual dates:
 * - active: set actual_start_date to today if null; clear actual_end_date if set
 * - done: set actual_end_date to today
 * - pending: status only — leave actual_start_date and actual_end_date untouched
 */
export async function setMilestoneStatus(
  id: string,
  newStatus: GoalStatus,
): Promise<Milestone> {
  const userId = await requireUserId();
  const { data: existing, error: fetchError } = await supabase
    .from('milestones')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (fetchError) {
    throw fetchError;
  }
  if (!existing) {
    throw new Error('Milestone not found.');
  }

  const row = existing as MilestoneRow;
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
  // pending: do not modify actual_start_date or actual_end_date

  const { data, error } = await supabase
    .from('milestones')
    .update(updates)
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

export async function deleteMilestone(id: string): Promise<void> {
  const { error } = await supabase.from('milestones').delete().eq('id', id);

  if (error) {
    throw error;
  }
}
