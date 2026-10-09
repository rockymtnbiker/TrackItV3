-- Allow repeat_period 'day' on the live goals table.
-- Existing rows stay as they are (a weekly step with 7 planned days stays weekly).

do $$
declare
  rec record;
begin
  for rec in
    select n.nspname as schema_name, c.relname as table_name, con.conname
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('goals', 'goals_v2')
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%repeat_period%'
  loop
    execute format(
      'alter table %I.%I drop constraint %I',
      rec.schema_name,
      rec.table_name,
      rec.conname
    );
  end loop;
end $$;

alter table public.goals
  add constraint goals_repeat_period_check
  check (repeat_period is null or repeat_period in ('day', 'week', 'month'));

do $$
begin
  if to_regclass('public.goals_v2') is not null then
    alter table public.goals_v2
      add constraint goals_v2_repeat_period_check
      check (repeat_period is null or repeat_period in ('day', 'week', 'month'));
  end if;
end $$;
