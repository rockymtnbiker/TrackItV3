import type { TargetPeriod } from '../types';

type TargetDisplayFields = {
  target?: number;
  unit?: string;
  period?: TargetPeriod;
};

/** UI label for period suffix (Instance → "session"). */
export function formatPeriodLabel(period: TargetPeriod): string {
  switch (period) {
    case 'Day':
      return 'day';
    case 'Week':
      return 'week';
    case 'Month':
      return 'month';
    case 'Instance':
      return 'session';
    case 'None':
    default:
      return '';
  }
}

/**
 * Formats target for list/dashboard display.
 * None → "3 runs"; Week → "3 runs/week"; Instance → "5 miles/session".
 */
export function formatTargetLabel(item: TargetDisplayFields): string | null {
  if (item.target == null) {
    return null;
  }

  const unit = item.unit?.trim() ?? '';
  const base = unit ? `${item.target} ${unit}` : String(item.target);
  const period = item.period ?? 'None';

  if (period === 'None') {
    return base;
  }

  return `${base}/${formatPeriodLabel(period)}`;
}
