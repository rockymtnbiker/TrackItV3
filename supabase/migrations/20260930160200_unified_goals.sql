-- Unified goals schema and a one-time copy from the existing tables.
-- Creates goals_v2 and goal_entries only. Does not drop or alter
-- goals, milestones, habits, or habit_completions.
--
-- How to run in the Supabase SQL editor:
-- 1. Run only the PRE-CHECK section and review the result sets.
-- 2. Then run from BEGIN through COMMIT.

-- =============================================================================
-- PRE-CHECK (read-only). Review before the copy.
-- Status outside pending/active/done, including null, is copied as 'active'.
-- Period other than week/month/instance (case-insensitive), except null,
-- is copied with repeat_period null. 'Day' shows up here.
-- An unmapped scheduled day aborts the copy.
-- =============================================================================

select source_table, id, title, status
from (
  select 'goals'::text as source_table, id, title, status
  from public.goals
  where status is null
     or status not in ('pending', 'active', 'done')

  union all

  select 'milestones'::text, id, title, status
  from public.milestones
  where status is null
     or status not in ('pending', 'active', 'done')

  union all

  select 'habits'::text, id, title, status
  from public.habits
  where status is null
     or status not in ('pending', 'active', 'done')
) unexpected_status
order by source_table, id;

select source_table, id, title, period
from (
  select 'goals'::text as source_table, id, title, period
  from public.goals
  where period is not null
    and lower(period) not in ('week', 'month', 'instance')

  union all

  select 'milestones'::text, id, title, period
  from public.milestones
  where period is not null
    and lower(period) not in ('week', 'month', 'instance')
) unexpected_period
order by source_table, id;

select h.id, h.title, day_name as scheduled_day
from public.habits h
cross join lateral unnest(h.scheduled_days) as day_name
where lower(day_name) not in (
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'
)
order by h.id, day_name;

-- =============================================================================
-- Schema and copy. One transaction: a failure rolls the new tables back.
-- =============================================================================

begin;

create table public.goals_v2 (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  parent_id uuid references public.goals_v2 (id) on delete cascade,
  title text not null,
  description text,
  category text,
  sort_order int not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'done')),
  target_start_date date,
  target_end_date date,
  actual_start_date date,
  actual_end_date date,
  created_date timestamptz not null default now(),
  deleted_at timestamptz,
  unit text,
  target_amount numeric,
  repeat_period text
    check (repeat_period in ('week', 'month')),
  planned_days smallint[]
);

create index goals_v2_user_id_idx on public.goals_v2 (user_id);
create index goals_v2_parent_id_idx on public.goals_v2 (parent_id);

create table public.goal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  goal_id uuid not null references public.goals_v2 (id) on delete cascade,
  entry_date date not null,
  value numeric,
  created_at timestamptz not null default now(),
  unique (goal_id, entry_date)
);

create index goal_entries_goal_id_entry_date_idx
  on public.goal_entries (goal_id, entry_date);

alter table public.goals_v2 enable row level security;
alter table public.goal_entries enable row level security;

create policy "Users manage their own goals_v2"
  on public.goals_v2
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage their own goal_entries"
  on public.goal_entries
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

do $$
declare
  collision_count integer;
  bad_days text;
begin
  select count(*)
  into collision_count
  from (
    select id from public.goals
    intersect
    select id from public.milestones
    union
    select id from public.goals
    intersect
    select id from public.habits
    union
    select id from public.milestones
    intersect
    select id from public.habits
  ) collisions;

  if collision_count > 0 then
    raise exception
      'Refusing to copy: % shared id(s) across goals, milestones, and habits.',
      collision_count;
  end if;

  select string_agg(distinct day_name, ', ' order by day_name)
  into bad_days
  from public.habits
  cross join lateral unnest(scheduled_days) as day_name
  where lower(day_name) not in (
    'sunday', 'monday', 'tuesday', 'wednesday',
    'thursday', 'friday', 'saturday'
  );

  if bad_days is not null then
    raise exception
      'Refusing to copy: unmapped habit scheduled_days values: %',
      bad_days;
  end if;
end $$;

insert into public.goals_v2 (
  id,
  user_id,
  parent_id,
  title,
  description,
  category,
  sort_order,
  status,
  target_start_date,
  target_end_date,
  actual_start_date,
  actual_end_date,
  created_date,
  deleted_at,
  unit,
  target_amount,
  repeat_period,
  planned_days
)
select
  g.id,
  g.user_id,
  null,
  g.title,
  g.description,
  g.category,
  coalesce(g.sort_order, 0),
  case
    when g.status in ('pending', 'active', 'done') then g.status
    else 'active'
  end,
  g.target_start_date,
  g.target_end_date,
  g.actual_start_date,
  g.actual_end_date,
  coalesce(g.created_date, now()),
  g.deleted_at,
  g.unit,
  g.target,
  case lower(g.period)
    when 'week' then 'week'
    when 'month' then 'month'
    else null
  end,
  null
from public.goals g;

insert into public.goals_v2 (
  id,
  user_id,
  parent_id,
  title,
  description,
  category,
  sort_order,
  status,
  target_start_date,
  target_end_date,
  actual_start_date,
  actual_end_date,
  created_date,
  deleted_at,
  unit,
  target_amount,
  repeat_period,
  planned_days
)
select
  m.id,
  m.user_id,
  m.goal_id,
  m.title,
  m.description,
  m.category,
  coalesce(m.sort_order, 0),
  case
    when m.status in ('pending', 'active', 'done') then m.status
    else 'active'
  end,
  m.target_start_date,
  m.target_end_date,
  m.actual_start_date,
  m.actual_end_date,
  coalesce(m.created_date, now()),
  m.deleted_at,
  m.unit,
  m.target,
  case lower(m.period)
    when 'week' then 'week'
    when 'month' then 'month'
    else null
  end,
  null
from public.milestones m;

insert into public.goals_v2 (
  id,
  user_id,
  parent_id,
  title,
  description,
  category,
  sort_order,
  status,
  target_start_date,
  target_end_date,
  actual_start_date,
  actual_end_date,
  created_date,
  deleted_at,
  unit,
  target_amount,
  repeat_period,
  planned_days
)
select
  h.id,
  h.user_id,
  coalesce(h.milestone_id, h.goal_id),
  h.title,
  null,
  null,
  coalesce(h.sort_order, 0),
  case
    when h.status in ('pending', 'active', 'done') then h.status
    else 'active'
  end,
  null,
  h.end_date,
  h.start_date,
  null,
  coalesce(h.created_date, now()),
  h.deleted_at,
  null,
  h.weekly_target,
  'week',
  (
    select coalesce(
      array_agg(
        case lower(day_name)
          when 'sunday' then 0::smallint
          when 'monday' then 1::smallint
          when 'tuesday' then 2::smallint
          when 'wednesday' then 3::smallint
          when 'thursday' then 4::smallint
          when 'friday' then 5::smallint
          when 'saturday' then 6::smallint
        end
        order by ord
      ),
      '{}'::smallint[]
    )
    from unnest(h.scheduled_days) with ordinality as u(day_name, ord)
  )
from public.habits h;

insert into public.goal_entries (
  id,
  user_id,
  goal_id,
  entry_date,
  value,
  created_at
)
select
  c.id,
  c.user_id,
  c.habit_id,
  c.completed_date,
  null,
  coalesce(c.created_at, now())
from public.habit_completions c;

commit;

-- =============================================================================
-- Verification (commented). Run after COMMIT.
-- Level 0 is parent_id null: former goals and standalone habits.
-- Level 1 is children of those: milestones, and habits linked only to a goal.
-- Level 2 is habits whose parent is a milestone.
-- =============================================================================

-- select
--   (select count(*) from public.goals) as goals,
--   (select count(*) from public.goals_v2 where id in (select id from public.goals)) as goals_copied,
--   (select count(*) from public.milestones) as milestones,
--   (select count(*) from public.goals_v2 where id in (select id from public.milestones)) as milestones_copied,
--   (select count(*) from public.habits) as habits,
--   (select count(*) from public.goals_v2 where id in (select id from public.habits)) as habits_copied,
--   (select count(*) from public.habit_completions) as habit_completions,
--   (select count(*) from public.goal_entries) as goal_entries,
--   (select count(*) from public.goals_v2) as goals_v2;

-- with recursive tree as (
--   select id, 0 as parent_level
--   from public.goals_v2
--   where parent_id is null
--   union all
--   select child.id, tree.parent_level + 1
--   from public.goals_v2 child
--   join tree on child.parent_id = tree.id
-- )
-- select parent_level, count(*) as row_count
-- from tree
-- group by parent_level
-- order by parent_level;
