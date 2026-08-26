import type { Habit, HabitStatus, Weekday } from '../types';
import { ALL_WEEKDAYS } from '../types';
import { addDays, getWeekday, todayDateString } from '../utils/date';
import { supabase } from './supabase';

type HabitRow = {
  id: string;
  goal_id: string | null;
  milestone_id: string | null;
  user_id: string;
  title: string;
  status: string;
  scheduled_days: string[] | null;
  weekly_target: number | null;
  start_date: string | null;
  end_date: string | null;
  created_date: string | null;
  sort_order: number | null;
  deleted_at: string | null;
};

export type HabitInput = {
  title: string;
  goalId?: string | null;
  milestoneId?: string | null;
  status?: HabitStatus;
  scheduledDays?: Weekday[];
  weeklyTarget?: number;
  startDate?: string | null;
  endDate?: string | null;
  sortOrder?: number;
};

export type HabitUpdates = Partial<HabitInput>;

export type ActiveHabitParent = {
  id: string;
  title: string;
  createdDate: string;
  startDate?: string;
  endDate?: string;
  deletedAt?: string;
};

/** Active habit plus optional parent goal/milestone metadata for Today grouping. */
export type ActiveHabit = Habit & {
  parentGoal: ActiveHabitParent | null;
  parentMilestone: ActiveHabitParent | null;
};

type ParentRow = {
  id: string;
  title: string;
  created_date: string | null;
  target_start_date: string | null;
  target_end_date: string | null;
  deleted_at: string | null;
};

type ActiveHabitRow = HabitRow & {
  goal: ParentRow | ParentRow[] | null;
  milestone: ParentRow | ParentRow[] | null;
};

function mapScheduledDays(days: string[] | null): Weekday[] {
  if (!days || days.length === 0) {
    return [...ALL_WEEKDAYS];
  }
  return days.filter((day): day is Weekday =>
    (ALL_WEEKDAYS as string[]).includes(day),
  );
}

function unwrapRelation<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) {
    return null;
  }
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function mapParentRow(row: ParentRow | null): ActiveHabitParent | null {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    title: row.title,
    createdDate: (row.created_date ?? '').slice(0, 10),
    startDate: row.target_start_date || undefined,
    endDate: row.target_end_date || undefined,
    deletedAt: row.deleted_at ? row.deleted_at.slice(0, 10) : undefined,
  };
}

function mapRowToHabit(row: HabitRow): Habit {
  const scheduledDays = mapScheduledDays(row.scheduled_days);
  let linkedGoalId: string | undefined;
  let linkedGoalType: Habit['linkedGoalType'];

  if (row.milestone_id) {
    linkedGoalId = row.milestone_id;
    linkedGoalType = 'milestone';
  } else if (row.goal_id) {
    linkedGoalId = row.goal_id;
    linkedGoalType = 'goal';
  }

  return {
    id: row.id,
    title: row.title,
    sortOrder: row.sort_order ?? 0,
    scheduledDays,
    weeklyTarget: row.weekly_target ?? scheduledDays.length,
    linkedGoalId,
    linkedGoalType,
    completionLog: [],
    streakCount: 0,
    createdDate: (row.created_date ?? '').slice(0, 10),
    startDate: row.start_date || undefined,
    endDate: row.end_date || undefined,
    status: (row.status as HabitStatus) || 'active',
    deletedAt: row.deleted_at ? row.deleted_at.slice(0, 10) : undefined,
  };
}

function mapRowToActiveHabit(row: ActiveHabitRow): ActiveHabit {
  return {
    ...mapRowToHabit(row),
    parentGoal: mapParentRow(unwrapRelation(row.goal)),
    parentMilestone: mapParentRow(unwrapRelation(row.milestone)),
  };
}

function toRowUpdates(updates: HabitUpdates): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (updates.title !== undefined) {
    row.title = updates.title;
  }
  if (updates.goalId !== undefined) {
    row.goal_id = updates.goalId || null;
  }
  if (updates.milestoneId !== undefined) {
    row.milestone_id = updates.milestoneId || null;
  }
  if (updates.status !== undefined) {
    row.status = updates.status;
  }
  if (updates.scheduledDays !== undefined) {
    row.scheduled_days = updates.scheduledDays;
    row.weekly_target =
      updates.weeklyTarget ?? updates.scheduledDays.length;
  } else if (updates.weeklyTarget !== undefined) {
    row.weekly_target = updates.weeklyTarget;
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
    throw new Error('You must be signed in to manage habits.');
  }
  return userId;
}

export async function getHabitsForGoal(goalId: string): Promise<Habit[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('habits')
    .select('*')
    .eq('user_id', userId)
    .eq('goal_id', goalId)
    .is('milestone_id', null)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });

  if (error) {
    throw error;
  }

  return (data as HabitRow[] | null)?.map(mapRowToHabit) ?? [];
}

export async function getHabitsForMilestone(
  milestoneId: string,
): Promise<Habit[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('habits')
    .select('*')
    .eq('user_id', userId)
    .eq('milestone_id', milestoneId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });

  if (error) {
    throw error;
  }

  return (data as HabitRow[] | null)?.map(mapRowToHabit) ?? [];
}

export async function getStandaloneHabits(): Promise<Habit[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('habits')
    .select('*')
    .eq('user_id', userId)
    .is('goal_id', null)
    .is('milestone_id', null)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });

  if (error) {
    throw error;
  }

  return (data as HabitRow[] | null)?.map(mapRowToHabit) ?? [];
}

export async function getAllActiveHabits(): Promise<ActiveHabit[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('habits')
    .select(
      `
      *,
      goal:goals (
        id,
        title,
        created_date,
        target_start_date,
        target_end_date,
        deleted_at
      ),
      milestone:milestones (
        id,
        title,
        created_date,
        target_start_date,
        target_end_date,
        deleted_at
      )
    `,
    )
    .eq('user_id', userId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });

  if (error) {
    throw error;
  }

  return (data as ActiveHabitRow[] | null)?.map(mapRowToActiveHabit) ?? [];
}

export async function getHabit(id: string): Promise<Habit | null> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('habits')
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? mapRowToHabit(data as HabitRow) : null;
}

export async function createHabit(habit: HabitInput): Promise<Habit> {
  const userId = await requireUserId();
  const scheduledDays = habit.scheduledDays?.length
    ? habit.scheduledDays
    : [...ALL_WEEKDAYS];

  const { data, error } = await supabase
    .from('habits')
    .insert({
      user_id: userId,
      goal_id: habit.goalId || null,
      milestone_id: habit.milestoneId || null,
      title: habit.title,
      status: habit.status ?? 'active',
      scheduled_days: scheduledDays,
      weekly_target: habit.weeklyTarget ?? scheduledDays.length,
      start_date: habit.startDate || null,
      end_date: habit.endDate || null,
      sort_order: habit.sortOrder ?? 0,
    })
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return mapRowToHabit(data as HabitRow);
}

export async function updateHabit(
  id: string,
  updates: HabitUpdates,
): Promise<Habit> {
  const row = toRowUpdates(updates);
  const { data, error } = await supabase
    .from('habits')
    .update(row)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return mapRowToHabit(data as HabitRow);
}

export async function softDeleteHabit(id: string): Promise<void> {
  const { error } = await supabase
    .from('habits')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    throw error;
  }
}

export async function deleteHabit(id: string): Promise<void> {
  const { error } = await supabase.from('habits').delete().eq('id', id);

  if (error) {
    throw error;
  }
}

export async function addCompletion(
  habitId: string,
  date: string,
): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase.from('habit_completions').upsert(
    {
      habit_id: habitId,
      user_id: userId,
      completed_date: date,
    },
    { onConflict: 'habit_id,completed_date' },
  );

  if (error) {
    throw error;
  }
}

export async function removeCompletion(
  habitId: string,
  date: string,
): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase
    .from('habit_completions')
    .delete()
    .eq('user_id', userId)
    .eq('habit_id', habitId)
    .eq('completed_date', date);

  if (error) {
    throw error;
  }
}

export async function getCompletionsForHabit(
  habitId: string,
  startDate?: string,
  endDate?: string,
): Promise<string[]> {
  const userId = await requireUserId();
  let query = supabase
    .from('habit_completions')
    .select('completed_date')
    .eq('user_id', userId)
    .eq('habit_id', habitId)
    .order('completed_date', { ascending: true });

  if (startDate) {
    query = query.gte('completed_date', startDate);
  }
  if (endDate) {
    query = query.lte('completed_date', endDate);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  return (
    (data as { completed_date: string }[] | null)?.map(
      (row) => row.completed_date,
    ) ?? []
  );
}

/** Completions for a habit within an inclusive date range. */
export async function getCompletionsInRange(
  habitId: string,
  startDate: string,
  endDate: string,
): Promise<string[]> {
  return getCompletionsForHabit(habitId, startDate, endDate);
}

/**
 * Current streak counting only scheduled days.
 * Walks backward from today (or the prior scheduled day) until a scheduled
 * day with no completion is found; non-scheduled days are skipped.
 */
export async function getStreakCount(habitId: string): Promise<number> {
  const habit = await getHabit(habitId);
  if (!habit) {
    return 0;
  }

  const today = todayDateString();
  const rangeStart =
    habit.createdDate && habit.createdDate.length >= 10
      ? habit.createdDate
      : addDays(today, -730);
  const completions = await getCompletionsInRange(habitId, rangeStart, today);
  const completed = new Set(completions);
  const scheduled = new Set(habit.scheduledDays);

  const isEligibleDay = (dateString: string): boolean => {
    if (!scheduled.has(getWeekday(dateString))) {
      return false;
    }
    if (dateString < habit.createdDate) {
      return false;
    }
    if (habit.startDate && dateString < habit.startDate) {
      return false;
    }
    if (habit.endDate && dateString > habit.endDate) {
      return false;
    }
    return true;
  };

  const previousEligibleDay = (fromDate: string): string | null => {
    let cursor = addDays(fromDate, -1);
    for (let i = 0; i < 400; i += 1) {
      if (isEligibleDay(cursor)) {
        return cursor;
      }
      if (cursor < rangeStart) {
        return null;
      }
      cursor = addDays(cursor, -1);
    }
    return null;
  };

  let anchor: string | null = null;
  if (isEligibleDay(today)) {
    if (completed.has(today)) {
      anchor = today;
    } else {
      anchor = previousEligibleDay(today);
      if (!anchor || !completed.has(anchor)) {
        return 0;
      }
    }
  } else {
    anchor = previousEligibleDay(today);
    if (!anchor || !completed.has(anchor)) {
      return 0;
    }
  }

  let streak = 0;
  let cursor: string | null = anchor;
  while (cursor && completed.has(cursor)) {
    streak += 1;
    cursor = previousEligibleDay(cursor);
    if (cursor && !completed.has(cursor)) {
      break;
    }
  }

  return streak;
}
