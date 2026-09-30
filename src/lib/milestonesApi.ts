import type {
  GoalCategory,
  GoalStatus,
  Milestone,
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

function mapRowToMilestone(row: GoalsV2Row): Milestone {
  return {
    id: row.id,
    goalId: row.parent_id ?? '',
    title: row.title,
    description: row.description || undefined,
    sortOrder: row.sort_order ?? 0,
    createdDate: toDateOnly(row.created_date) ?? '',
    targetStartDate: toDateOnly(row.target_start_date),
    targetEndDate: toDateOnly(row.target_end_date),
    actualStartDate: toDateOnly(row.actual_start_date),
    actualEndDate: toDateOnly(row.actual_end_date),
    category: (row.category as GoalCategory | null) || undefined,
    target: amountToNumber(row.target_amount),
    unit: row.unit || undefined,
    period: repeatPeriodToPeriod(row.repeat_period),
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
    throw new Error('You must be signed in to manage milestones.');
  }
  return userId;
}

export async function getMilestonesForGoal(goalId: string): Promise<Milestone[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from(GOALS_TABLE)
    .select('*')
    .eq('user_id', userId)
    .eq('parent_id', goalId)
    .is('planned_days', null)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });

  if (error) {
    throw error;
  }

  return (data as GoalsV2Row[] | null)?.map(mapRowToMilestone) ?? [];
}

export async function getMilestones(): Promise<Milestone[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from(GOALS_TABLE)
    .select('*')
    .eq('user_id', userId)
    .not('parent_id', 'is', null)
    .is('planned_days', null)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });

  if (error) {
    throw error;
  }

  return (data as GoalsV2Row[] | null)?.map(mapRowToMilestone) ?? [];
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
    .from(GOALS_TABLE)
    .select('*')
    .eq('user_id', userId)
    .not('parent_id', 'is', null)
    .is('planned_days', null)
    .is('deleted_at', null)
    .or(`status.eq.active,actual_end_date.eq.${today}`)
    .order('sort_order', { ascending: true });

  if (error) {
    throw error;
  }

  return (data as GoalsV2Row[] | null)?.map(mapRowToMilestone) ?? [];
}

export async function getMilestone(id: string): Promise<Milestone | null> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from(GOALS_TABLE)
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)
    .not('parent_id', 'is', null)
    .is('planned_days', null)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? mapRowToMilestone(data as GoalsV2Row) : null;
}

export async function createMilestone(
  milestone: MilestoneInput,
): Promise<Milestone> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from(GOALS_TABLE)
    .insert({
      user_id: userId,
      parent_id: milestone.goalId,
      title: milestone.title,
      description: milestone.description?.trim() || null,
      category: milestone.category || null,
      target_amount: milestone.target ?? null,
      unit: milestone.unit || null,
      repeat_period: periodToRepeatPeriod(milestone.period),
      planned_days: null,
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

  return mapRowToMilestone(data as GoalsV2Row);
}

export async function updateMilestone(
  id: string,
  updates: MilestoneUpdates,
): Promise<Milestone> {
  const row = toRowUpdates(updates);
  const { data, error } = await supabase
    .from(GOALS_TABLE)
    .update(row)
    .eq('id', id)
    .not('parent_id', 'is', null)
    .is('planned_days', null)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return mapRowToMilestone(data as GoalsV2Row);
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
    .from(GOALS_TABLE)
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .not('parent_id', 'is', null)
    .is('planned_days', null)
    .maybeSingle();

  if (fetchError) {
    throw fetchError;
  }
  if (!existing) {
    throw new Error('Milestone not found.');
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
  // pending: do not modify actual_start_date or actual_end_date

  const { data, error } = await supabase
    .from(GOALS_TABLE)
    .update(updates)
    .eq('id', id)
    .not('parent_id', 'is', null)
    .is('planned_days', null)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return mapRowToMilestone(data as GoalsV2Row);
}

export async function softDeleteMilestone(id: string): Promise<void> {
  const { error } = await supabase
    .from(GOALS_TABLE)
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .not('parent_id', 'is', null)
    .is('planned_days', null);

  if (error) {
    throw error;
  }
}

export async function deleteMilestone(id: string): Promise<void> {
  const { error } = await supabase
    .from(GOALS_TABLE)
    .delete()
    .eq('id', id)
    .not('parent_id', 'is', null)
    .is('planned_days', null);

  if (error) {
    throw error;
  }
}
