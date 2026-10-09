-- Date a one-time step was marked done. Null while it is not done.
-- Run in the Supabase SQL editor.

alter table public.goals
  add column if not exists completed_on date null;

-- Backfill done rows from updated_at when that column exists.
-- This schema has no updated_at, so those rows stay null.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'goals'
      and column_name = 'updated_at'
  ) then
    execute $backfill$
      update public.goals
      set completed_on = updated_at::date
      where status = 'done'
        and completed_on is null
    $backfill$;
  end if;
end $$;
