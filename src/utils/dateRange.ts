import { formatDate } from './date';

export type DateRangeConflict = {
  kind: 'startForward' | 'endBackward';
  count: number;
  fromDate: string;
  toDate: string;
};

/** Completions that fall outside [startDate, endDate] (inclusive). */
export function completionsOutsideRange(
  completionLog: string[],
  startDate: string,
  endDate: string,
): string[] {
  return completionLog.filter((date) => date < startDate || date > endDate);
}

/**
 * Completions newly excluded by moving startDate later:
 * dates on/after the old start and before the new start.
 */
export function conflictsFromStartMovedLater(
  completionLog: string[],
  oldStartDate: string,
  newStartDate: string,
): string[] {
  if (newStartDate <= oldStartDate) {
    return [];
  }

  return completionLog
    .filter((date) => date >= oldStartDate && date < newStartDate)
    .sort();
}

/**
 * Completions newly excluded by moving endDate earlier:
 * dates after the new end and on/before the old end.
 */
export function conflictsFromEndMovedEarlier(
  completionLog: string[],
  oldEndDate: string,
  newEndDate: string,
): string[] {
  if (newEndDate >= oldEndDate) {
    return [];
  }

  return completionLog
    .filter((date) => date > newEndDate && date <= oldEndDate)
    .sort();
}

export function detectDateRangeConflicts(
  completionLog: string[],
  oldStartDate: string,
  oldEndDate: string,
  newStartDate: string,
  newEndDate: string,
): DateRangeConflict[] {
  const conflicts: DateRangeConflict[] = [];

  const startConflicts = conflictsFromStartMovedLater(
    completionLog,
    oldStartDate,
    newStartDate,
  );
  if (startConflicts.length > 0) {
    conflicts.push({
      kind: 'startForward',
      count: startConflicts.length,
      fromDate: startConflicts[0],
      toDate: startConflicts[startConflicts.length - 1],
    });
  }

  const endConflicts = conflictsFromEndMovedEarlier(
    completionLog,
    oldEndDate,
    newEndDate,
  );
  if (endConflicts.length > 0) {
    conflicts.push({
      kind: 'endBackward',
      count: endConflicts.length,
      fromDate: endConflicts[0],
      toDate: endConflicts[endConflicts.length - 1],
    });
  }

  return conflicts;
}

export function formatDateRangeConflictMessage(
  conflicts: DateRangeConflict[],
): string {
  return conflicts
    .map((conflict) => {
      const action =
        conflict.kind === 'startForward'
          ? 'Moving the start date'
          : 'Moving the end date';
      const noun =
        conflict.count === 1 ? 'completion' : 'completions';
      return `${action} will remove ${conflict.count} logged ${noun} from ${formatDate(conflict.fromDate)} to ${formatDate(conflict.toDate)}.`;
    })
    .join('\n\n');
}

/** True when a calendar date falls within the item's active date range. */
export function isWithinDateRange(
  dateString: string,
  startDate: string,
  endDate: string,
): boolean {
  return dateString >= startDate && dateString <= endDate;
}
