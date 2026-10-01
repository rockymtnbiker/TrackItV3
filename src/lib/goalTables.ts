export const GOALS_TABLE = 'goals';
export const ENTRIES_TABLE = 'goal_entries';

export function amountToNumber(
  value: number | string | null | undefined,
): number | undefined {
  if (value == null || value === '') {
    return undefined;
  }
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : undefined;
}
