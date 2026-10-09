-- Daily is a weekly step with every day selected.
-- Leaves the repeat_period check constraint unchanged.

update public.goals
set
  repeat_period = 'week',
  planned_days = '{0,1,2,3,4,5,6}',
  target_amount = case
    when unit is null then null
    else target_amount * 7
  end
where repeat_period = 'day';
