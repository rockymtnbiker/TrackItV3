import type {
  GoalEntry,
  Goal,
  GoalStatus,
  RepeatPeriod,
} from '../types/goal';
import { todayDateString } from '../utils/date';
import { ENTRIES_TABLE, GOALS_TABLE, amountToNumber } from './goalTables';
import { isRepeating } from './goalTree';
import { captureStatusDates } from './statusDates';
import { supabase } from './supabase';

type GoalRow = {
  id: string;
  user_id: string;
  parent_id: string | null;
  title: string;
  description: string | null;
  category: string | null;
  sort_order: number | null;
  status: string;
  target_start_date: string | null;
  target_end_date: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
  completed_on: string | null;
  created_date: string | null;
  deleted_at: string | null;
  unit: string | null;
  target_amount: number | string | null;
  repeat_period: string | null;
  planned_days: number[] | null;
};

export type GoalInput = {
  title: string;
  parentId?: string | null;
  description?: string | null;
  category?: string | null;
  status?: GoalStatus;
  targetStartDate?: string | null;
  targetEndDate?: string | null;
  actualStartDate?: string | null;
  actualEndDate?: string | null;
  unit?: string | null;
  targetAmount?: number | null;
  repeatPeriod?: RepeatPeriod | null;
  plannedDays?: number[] | null;
};

export type GoalUpdates = Partial<
  Omit<GoalInput, 'parentId' | 'title'>
> & {
  title?: string;
  sortOrder?: number;
};

type EntryRow = {
  id: string;
  goal_id: string;
  entry_date: string;
  value: number | string | null;
};

function blankToNull(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function dateOrNull(value: string | null | undefined): string | null {
  if (value == null || value === '') {
    return null;
  }
  return value.slice(0, 10);
}

function mapRepeatPeriod(
  value: string | null | undefined,
): RepeatPeriod | null {
  const period = value?.toLowerCase();
  if (period === 'day') {
    return 'week';
  }
  if (period === 'week' || period === 'month') {
    return period;
  }
  return null;
}

function mapRowToNode(row: GoalRow): Goal {
  const status: GoalStatus =
    row.status === 'pending' || row.status === 'active' || row.status === 'done'
      ? row.status
      : 'pending';

  return {
    id: row.id,
    userId: row.user_id,
    parentId: row.parent_id,
    title: row.title,
    description: row.description,
    category: row.category,
    sortOrder: row.sort_order ?? 0,
    status,
    targetStartDate: dateOrNull(row.target_start_date),
    targetEndDate: dateOrNull(row.target_end_date),
    actualStartDate: dateOrNull(row.actual_start_date),
    actualEndDate: dateOrNull(row.actual_end_date),
    completedOn: dateOrNull(row.completed_on),
    createdDate: (row.created_date ?? '').slice(0, 10),
    unit: row.unit,
    targetAmount: amountToNumber(row.target_amount) ?? null,
    repeatPeriod: mapRepeatPeriod(row.repeat_period),
    plannedDays: row.planned_days,
  };
}

function mapRowToEntry(row: EntryRow): GoalEntry {
  return {
    id: row.id,
    goalId: row.goal_id,
    entryDate: row.entry_date.slice(0, 10),
    value: amountToNumber(row.value) ?? null,
  };
}

/**
 * Repeat on: period is week or month and planned days is an array (maybe empty).
 * Repeat off: both are null. Setting only the period turns days into [].
 */
function normalizeRepeat(
  repeatPeriod: RepeatPeriod | null,
  plannedDays: number[] | null,
): { repeat_period: RepeatPeriod | null; planned_days: number[] | null } {
  if (plannedDays === null && repeatPeriod === null) {
    return { repeat_period: null, planned_days: null };
  }
  if (repeatPeriod == null) {
    throw new Error('A repeating step needs a repeat period of week or month.');
  }
  return {
    repeat_period: repeatPeriod,
    planned_days: plannedDays ?? [],
  };
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

async function fetchNodeRow(
  id: string,
  userId: string,
): Promise<GoalRow | null> {
  const { data, error } = await supabase
    .from(GOALS_TABLE)
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as GoalRow | null) ?? null;
}

export async function getAllGoals(): Promise<Goal[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from(GOALS_TABLE)
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });

  if (error) {
    throw error;
  }

  return ((data as GoalRow[] | null) ?? []).map(mapRowToNode);
}

export async function getGoal(id: string): Promise<Goal | null> {
  const userId = await requireUserId();
  const row = await fetchNodeRow(id, userId);
  return row ? mapRowToNode(row) : null;
}

export async function getChildren(
  parentId: string | null,
): Promise<Goal[]> {
  const userId = await requireUserId();
  let query = supabase
    .from(GOALS_TABLE)
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });

  query =
    parentId == null
      ? query.is('parent_id', null)
      : query.eq('parent_id', parentId);

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  return ((data as GoalRow[] | null) ?? []).map(mapRowToNode);
}

export async function createGoal(input: GoalInput): Promise<Goal> {
  const userId = await requireUserId();
  const parentId = input.parentId ?? null;

  if (parentId) {
    const parent = await fetchNodeRow(parentId, userId);
    if (!parent) {
      throw new Error('Parent step not found.');
    }
    if (isRepeating(mapRowToNode(parent))) {
      throw new Error("Repeating steps can't have children.");
    }
  }

  const repeat = normalizeRepeat(
    input.repeatPeriod ?? null,
    input.plannedDays === undefined ? null : input.plannedDays,
  );
  const repeating = repeat.planned_days !== null;

  let siblingQuery = supabase
    .from(GOALS_TABLE)
    .select('sort_order')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: false })
    .limit(1);

  siblingQuery =
    parentId == null
      ? siblingQuery.is('parent_id', null)
      : siblingQuery.eq('parent_id', parentId);

  const { data: siblings, error: siblingError } = await siblingQuery;
  if (siblingError) {
    throw siblingError;
  }

  const maxOrder =
    (siblings as { sort_order: number | null }[] | null)?.[0]?.sort_order ??
    -1;

  const { data, error } = await supabase
    .from(GOALS_TABLE)
    .insert({
      user_id: userId,
      parent_id: parentId,
      title: input.title,
      description: blankToNull(input.description),
      category: blankToNull(input.category),
      sort_order: maxOrder + 1,
      status: input.status ?? (repeating ? 'active' : 'pending'),
      target_start_date: dateOrNull(input.targetStartDate),
      target_end_date: dateOrNull(input.targetEndDate),
      actual_start_date: dateOrNull(input.actualStartDate),
      actual_end_date: dateOrNull(input.actualEndDate),
      unit: blankToNull(input.unit),
      target_amount: input.targetAmount ?? null,
      repeat_period: repeat.repeat_period,
      planned_days: repeat.planned_days,
    })
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return mapRowToNode(data as GoalRow);
}

export async function updateGoal(
  id: string,
  updates: GoalUpdates,
): Promise<Goal> {
  const userId = await requireUserId();
  const existing = await fetchNodeRow(id, userId);
  if (!existing) {
    throw new Error('Step not found.');
  }

  const row: Record<string, unknown> = {};

  if (updates.title !== undefined) {
    row.title = updates.title;
  }
  if (updates.description !== undefined) {
    row.description = blankToNull(updates.description);
  }
  if (updates.category !== undefined) {
    row.category = blankToNull(updates.category);
  }
  if (updates.status !== undefined) {
    row.status = updates.status;
  }
  if (updates.targetStartDate !== undefined) {
    row.target_start_date = dateOrNull(updates.targetStartDate);
  }
  if (updates.targetEndDate !== undefined) {
    row.target_end_date = dateOrNull(updates.targetEndDate);
  }
  if (updates.actualStartDate !== undefined) {
    row.actual_start_date = dateOrNull(updates.actualStartDate);
  }
  if (updates.actualEndDate !== undefined) {
    row.actual_end_date = dateOrNull(updates.actualEndDate);
  }
  if (updates.unit !== undefined) {
    row.unit = blankToNull(updates.unit);
  }
  if (updates.targetAmount !== undefined) {
    row.target_amount = updates.targetAmount;
  }
  if (updates.sortOrder !== undefined) {
    row.sort_order = updates.sortOrder;
  }

  const touchesRepeat =
    updates.plannedDays !== undefined || updates.repeatPeriod !== undefined;

  if (touchesRepeat) {
    const repeat = normalizeRepeat(
      updates.repeatPeriod !== undefined
        ? updates.repeatPeriod
        : mapRepeatPeriod(existing.repeat_period),
      updates.plannedDays !== undefined
        ? updates.plannedDays
        : existing.planned_days,
    );

    if (repeat.planned_days !== null) {
      const { count, error: countError } = await supabase
        .from(GOALS_TABLE)
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('parent_id', id)
        .is('deleted_at', null);

      if (countError) {
        throw countError;
      }
      if ((count ?? 0) > 0) {
        throw new Error("A step with children can't be repeating.");
      }
    }

    row.repeat_period = repeat.repeat_period;
    row.planned_days = repeat.planned_days;
  }

  const { data, error } = await supabase
    .from(GOALS_TABLE)
    .update(row)
    .eq('id', id)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return mapRowToNode(data as GoalRow);
}

/** Local calendar date (YYYY-MM-DD), or today when the caller omits one. */
function completedOnDate(value: string | undefined): string {
  const date = dateOrNull(value);
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date;
  }
  return todayDateString();
}

export async function setGoalStatus(
  id: string,
  status: GoalStatus,
  completedOn?: string,
): Promise<Goal> {
  const userId = await requireUserId();
  const existing = await fetchNodeRow(id, userId);
  if (!existing) {
    throw new Error('Step not found.');
  }

  const today = todayDateString();
  const updates = captureStatusDates(status, existing, today);
  const fillStart = updates.actual_start_date ?? null;
  delete updates.actual_start_date;
  updates.completed_on =
    status === 'done' ? completedOnDate(completedOn) : null;

  if (fillStart) {
    const { error: startError } = await supabase
      .from(GOALS_TABLE)
      .update({ actual_start_date: fillStart })
      .eq('id', id)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .is('actual_start_date', null);

    if (startError) {
      throw startError;
    }
  }

  const { data, error } = await supabase
    .from(GOALS_TABLE)
    .update(updates)
    .eq('id', id)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return mapRowToNode(data as GoalRow);
}

export async function deleteGoal(id: string): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase
    .from(GOALS_TABLE)
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    throw error;
  }
}

export async function reorderGoals(orderedIds: string[]): Promise<void> {
  const userId = await requireUserId();

  for (let index = 0; index < orderedIds.length; index += 1) {
    const { error } = await supabase
      .from(GOALS_TABLE)
      .update({ sort_order: index })
      .eq('id', orderedIds[index])
      .eq('user_id', userId);

    if (error) {
      throw error;
    }
  }
}

export async function getEntries(
  goalIds: string[],
  from?: string,
  to?: string,
): Promise<GoalEntry[]> {
  if (goalIds.length === 0) {
    return [];
  }

  const userId = await requireUserId();
  let query = supabase
    .from(ENTRIES_TABLE)
    .select('id, goal_id, entry_date, value')
    .eq('user_id', userId)
    .in('goal_id', goalIds)
    .order('entry_date', { ascending: true });

  if (from) {
    query = query.gte('entry_date', from);
  }
  if (to) {
    query = query.lte('entry_date', to);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  return ((data as EntryRow[] | null) ?? []).map(mapRowToEntry);
}

export async function upsertEntry(
  goalId: string,
  entryDate: string,
  value: number | null,
): Promise<GoalEntry> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from(ENTRIES_TABLE)
    .upsert(
      {
        user_id: userId,
        goal_id: goalId,
        entry_date: entryDate,
        value,
      },
      { onConflict: 'goal_id,entry_date' },
    )
    .select('id, goal_id, entry_date, value')
    .single();

  if (error) {
    throw error;
  }

  return mapRowToEntry(data as EntryRow);
}

export async function deleteEntry(
  goalId: string,
  entryDate: string,
): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase
    .from(ENTRIES_TABLE)
    .delete()
    .eq('user_id', userId)
    .eq('goal_id', goalId)
    .eq('entry_date', entryDate);

  if (error) {
    throw error;
  }
}
