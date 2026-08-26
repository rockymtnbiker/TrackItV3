-- Add optional description fields for goals and milestones.
alter table goals add column if not exists description text;
alter table milestones add column if not exists description text;
