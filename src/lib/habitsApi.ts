import type { Habit, HabitStatus, Weekday } from '../types';
import { ALL_WEEKDAYS } from '../types';
import { addDays, getWeekday, todayDateString } from '../utils/date';
import {
  ENTRIES_TABLE,
  GOALS_TABLE,
  amountToNumber,
  plannedDaysToWeekdays,
  weekdaysToPlannedDays,
  type GoalsV2Row,
} from './goalTables';
import { supabase } from './supabase';

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

type HabitLinks = {
  goalId: string | null;
  milestoneId: string | null;
};

function linksForHabit(
  row: GoalsV2Row,
  parents: Map<string, GoalsV2Row>,
): HabitLinks {
  if (!row.parent_id) {
    return { goalId: null, milestoneId: null };
  }

  const parent = parents.get(row.parent_id);
  if (!parent || parent.planned_days != null) {
    return { goalId: null, milestoneId: null };
  }
  if (parent.parent_id == null) {
    return { goalId: parent.id, milestoneId: null };
  }
  return { goalId: parent.parent_id, milestoneId: parent.id };
}

function mapRowToHabit(row: GoalsV2Row, links: HabitLinks): Habit {
  const scheduledDays = plannedDaysToWeekdays(row.planned_days);
  let linkedGoalId: string | undefined;
  let linkedGoalType: Habit['linkedGoalType'];

  if (links.milestoneId) {
    linkedGoalId = links.milestoneId;
    linkedGoalType = 'milestone';
  } else if (links.goalId) {
    linkedGoalId = links.goalId;
    linkedGoalType = 'goal';
  }

  return {
    id: row.id,
    title: row.title,
    sortOrder: row.sort_order ?? 0,
    scheduledDays,
    weeklyTarget: amountToNumber(row.target_amount) ?? scheduledDays.length,
    linkedGoalId,
    linkedGoalType,
    completionLog: [],
    streakCount: 0,
    createdDate: (row.created_date ?? '').slice(0, 10),
    startDate: row.actual_start_date || undefined,
    endDate: row.target_end_date || undefined,
    status: (row.status as HabitStatus) || 'active',
    deletedAt: row.deleted_at ? row.deleted_at.slice(0, 10) : undefined,
  };
}

function mapParentRow(row: GoalsV2Row | undefined): ActiveHabitParent | null {
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

function toRowUpdates(updates: HabitUpdates): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (updates.title !== undefined) {
    row.title = updates.title;
  }
  if (updates.goalId !== undefined || updates.milestoneId !== undefined) {
    const milestoneId =
      updates.milestoneId !== undefined ? updates.milestoneId || null : undefined;
    const goalId =
      updates.goalId !== undefined ? updates.goalId || null : undefined;
    row.parent_id = milestoneId ?? goalId ?? null;
  }
  if (updates.status !== undefined) {
    row.status = updates.status;
  }
  if (updates.scheduledDays !== undefined) {
    row.planned_days = weekdaysToPlannedDays(updates.scheduledDays);
    row.target_amount = updates.weeklyTarget ?? updates.scheduledDays.length;
  } else if (updates.weeklyTarget !== undefined) {
    row.target_amount = updates.weeklyTarget;
  }
  if (updates.startDate !== undefined) {
    row.actual_start_date = updates.startDate || null;
  }
  if (updates.endDate !== undefined) {
    row.target_end_date = updates.endDate || null;
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

async function fetchRowsByIds(ids: string[]): Promise<Map<string, GoalsV2Row>> {
  const unique = [...new Set(ids)];
  const map = new Map<string, GoalsV2Row>();
  if (unique.length === 0) {
    return map;
  }

  const { data, error } = await supabase
    .from(GOALS_TABLE)
    .select('*')
    .in('id', unique);

  if (error) {
    throw error;
  }

  for (const row of (data as GoalsV2Row[] | null) ?? []) {
    map.set(row.id, row);
  }
  return map;
}

async function mapHabitRows(rows: GoalsV2Row[]): Promise<Habit[]> {
  const parentIds = rows.flatMap((row) => (row.parent_id ? [row.parent_id] : []));
  const parents = await fetchRowsByIds(parentIds);
  return rows.map((row) => mapRowToHabit(row, linksForHabit(row, parents)));
}

export async function getHabitsForGoal(goalId: string): Promise<Habit[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from(GOALS_TABLE)
    .select('*')
    .eq('user_id', userId)
    .eq('parent_id', goalId)
    .not('planned_days', 'is', null)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });

  if (error) {
    throw error;
  }

  const habits = await mapHabitRows((data as GoalsV2Row[] | null) ?? []);
  return habits.filter(
    (habit) => habit.linkedGoalType === 'goal' && habit.linkedGoalId === goalId,
  );
}

export async function getHabitsForMilestone(
  milestoneId: string,
): Promise<Habit[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from(GOALS_TABLE)
    .select('*')
    .eq('user_id', userId)
    .eq('parent_id', milestoneId)
    .not('planned_days', 'is', null)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });

  if (error) {
    throw error;
  }

  const habits = await mapHabitRows((data as GoalsV2Row[] | null) ?? []);
  return habits.filter(
    (habit) =>
      habit.linkedGoalType === 'milestone' &&
      habit.linkedGoalId === milestoneId,
  );
}

export async function getStandaloneHabits(): Promise<Habit[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from(GOALS_TABLE)
    .select('*')
    .eq('user_id', userId)
    .is('parent_id', null)
    .not('planned_days', 'is', null)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });

  if (error) {
    throw error;
  }

  return mapHabitRows((data as GoalsV2Row[] | null) ?? []);
}

export async function getAllActiveHabits(): Promise<ActiveHabit[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from(GOALS_TABLE)
    .select('*')
    .eq('user_id', userId)
    .not('planned_days', 'is', null)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });

  if (error) {
    throw error;
  }

  const rows = (data as GoalsV2Row[] | null) ?? [];
  const parents = await fetchRowsByIds(
    rows.flatMap((row) => (row.parent_id ? [row.parent_id] : [])),
  );
  const grandparentIds: string[] = [];
  for (const parent of parents.values()) {
    if (parent.planned_days == null && parent.parent_id) {
      grandparentIds.push(parent.parent_id);
    }
  }
  const grandparents = await fetchRowsByIds(grandparentIds);

  return rows.map((row) => {
    const links = linksForHabit(row, parents);
    const parent = row.parent_id ? parents.get(row.parent_id) : undefined;
    let parentGoal: ActiveHabitParent | null = null;
    let parentMilestone: ActiveHabitParent | null = null;

    if (parent && parent.planned_days == null && parent.parent_id == null) {
      parentGoal = mapParentRow(parent);
    } else if (parent && parent.planned_days == null && parent.parent_id) {
      parentMilestone = mapParentRow(parent);
      const goal = grandparents.get(parent.parent_id);
      if (goal && goal.planned_days == null && goal.parent_id == null) {
        parentGoal = mapParentRow(goal);
      }
    }

    return {
      ...mapRowToHabit(row, links),
      parentGoal,
      parentMilestone,
    };
  });
}

export async function getHabit(id: string): Promise<Habit | null> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from(GOALS_TABLE)
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)
    .not('planned_days', 'is', null)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }

  const [habit] = await mapHabitRows([data as GoalsV2Row]);
  return habit ?? null;
}

export async function createHabit(habit: HabitInput): Promise<Habit> {
  const userId = await requireUserId();
  const scheduledDays = habit.scheduledDays?.length
    ? habit.scheduledDays
    : [...ALL_WEEKDAYS];

  const { data, error } = await supabase
    .from(GOALS_TABLE)
    .insert({
      user_id: userId,
      parent_id: habit.milestoneId || habit.goalId || null,
      title: habit.title,
      status: habit.status ?? 'active',
      planned_days: weekdaysToPlannedDays(scheduledDays),
      target_amount: habit.weeklyTarget ?? scheduledDays.length,
      repeat_period: 'week',
      unit: null,
      actual_start_date: habit.startDate || null,
      target_end_date: habit.endDate || null,
      sort_order: habit.sortOrder ?? 0,
    })
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  const [created] = await mapHabitRows([data as GoalsV2Row]);
  return created;
}

export async function updateHabit(
  id: string,
  updates: HabitUpdates,
): Promise<Habit> {
  const row = toRowUpdates(updates);
  const { data, error } = await supabase
    .from(GOALS_TABLE)
    .update(row)
    .eq('id', id)
    .not('planned_days', 'is', null)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  const [updated] = await mapHabitRows([data as GoalsV2Row]);
  return updated;
}

export async function softDeleteHabit(id: string): Promise<void> {
  const { error } = await supabase
    .from(GOALS_TABLE)
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .not('planned_days', 'is', null);

  if (error) {
    throw error;
  }
}

export async function deleteHabit(id: string): Promise<void> {
  const { error } = await supabase
    .from(GOALS_TABLE)
    .delete()
    .eq('id', id)
    .not('planned_days', 'is', null);

  if (error) {
    throw error;
  }
}

export async function addCompletion(
  habitId: string,
  date: string,
): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase.from(ENTRIES_TABLE).upsert(
    {
      goal_id: habitId,
      user_id: userId,
      entry_date: date,
      value: null,
    },
    { onConflict: 'goal_id,entry_date' },
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
    .from(ENTRIES_TABLE)
    .delete()
    .eq('user_id', userId)
    .eq('goal_id', habitId)
    .eq('entry_date', date);

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
    .from(ENTRIES_TABLE)
    .select('entry_date')
    .eq('user_id', userId)
    .eq('goal_id', habitId)
    .order('entry_date', { ascending: true });

  if (startDate) {
    query = query.gte('entry_date', startDate);
  }
  if (endDate) {
    query = query.lte('entry_date', endDate);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  return (
    (data as { entry_date: string }[] | null)?.map((row) => row.entry_date) ??
    []
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
