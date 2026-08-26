-- TrackItV3 initial schema + RLS
-- Apply in Supabase Dashboard → SQL Editor (or via supabase db push when CLI is linked).

create table goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  title text not null,
  description text,
  category text,
  target numeric,
  unit text,
  period text,
  status text not null default 'active',
  start_date date,
  end_date date,
  created_date timestamptz default now(),
  sort_order int default 0,
  deleted_at timestamptz
);

create table milestones (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid references goals(id) on delete cascade not null,
  user_id uuid references auth.users not null,
  title text not null,
  description text,
  category text,
  target numeric,
  unit text,
  period text,
  status text not null default 'active',
  start_date date,
  end_date date,
  created_date timestamptz default now(),
  sort_order int default 0,
  deleted_at timestamptz
);

create table habits (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid references goals(id) on delete cascade,
  milestone_id uuid references milestones(id) on delete cascade,
  user_id uuid references auth.users not null,
  title text not null,
  status text not null default 'active',
  scheduled_days text[] not null default '{monday,tuesday,wednesday,thursday,friday,saturday,sunday}',
  weekly_target int not null default 7,
  start_date date,
  end_date date,
  created_date timestamptz default now(),
  sort_order int default 0,
  deleted_at timestamptz
);

create table habit_completions (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid references habits(id) on delete cascade not null,
  user_id uuid references auth.users not null,
  completed_date date not null,
  created_at timestamptz default now(),
  unique(habit_id, completed_date)
);

alter table goals enable row level security;
alter table milestones enable row level security;
alter table habits enable row level security;
alter table habit_completions enable row level security;

create policy "Users manage their own goals" on goals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage their own milestones" on milestones
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage their own habits" on habits
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage their own completions" on habit_completions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
