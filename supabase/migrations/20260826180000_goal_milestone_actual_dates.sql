-- Rename goal/milestone date columns and add actual date tracking.
alter table public.goals rename column start_date to target_start_date;
alter table public.goals rename column end_date to target_end_date;
alter table public.goals add column if not exists actual_start_date date;
alter table public.goals add column if not exists actual_end_date date;

alter table public.milestones rename column start_date to target_start_date;
alter table public.milestones rename column end_date to target_end_date;
alter table public.milestones add column if not exists actual_start_date date;
alter table public.milestones add column if not exists actual_end_date date;
