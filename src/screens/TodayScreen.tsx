import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { KeyboardSafe } from '../components/KeyboardSafe';
import {
  deleteEntry,
  getAllGoals,
  getEntries,
  setGoalStatus,
  upsertEntry,
} from '../lib/goalTreeApi';
import {
  entriesOnOrBefore,
  isPeriodTargetMetAsOf,
  oneTimeOnDate,
  periodTotalAsOf,
  startedOnOrBefore,
  type OneTimeOnDate,
} from '../lib/asOfDate';
import { goalStartDate } from '../lib/metrics';
import {
  buildChildrenMap,
  isLeaf,
  completionDates,
  isRepeating,
  isTracked,
  rollupTotal,
  weeklyTarget,
} from '../lib/goalTree';
import type { TodayStackParamList } from '../navigation/GoalsStackNavigator';
import type { GoalEntry, Goal, GoalStatus } from '../types/goal';
import {
  addDays,
  formatDate,
  formatShortDate,
  getWeekday,
  getWeekDays,
  getWeekStart,
  isFutureDate,
  isPastDate,
  parseDateString,
  todayDateString,
  WEEKDAY_SHORT_LABELS,
  type WeekDayCell,
} from '../utils/date';
import { calculateStreak, STREAK_LOOKBACK_DAYS } from '../utils/streak';

const RING_SIZE = 32;
const RING_CENTER = 16;
const RING_RADIUS = 13;
const RING_STROKE = 3;
const SEGMENT_GAP = 3;

type RepeatingRow = {
  id: string;
  title: string;
  tracked: boolean;
  isComplete: boolean;
  isInteractive: boolean;
  met: boolean;
  streak: number;
  periodCount: number;
  periodWord: string;
  progressRatio: number;
};

type ControlAction = 'toggle' | 'status' | 'log';

type StepControl =
  | { type: 'empty'; action: ControlAction }
  | { type: 'complete'; action: ControlAction }
  | {
      type: 'segmented';
      total: number;
      filled: number;
      loggedOnDay: boolean;
      action: 'toggle';
    }
  | { type: 'continuous'; progress: number; action: 'log' };

type StepGroup = {
  id: string;
  label: string | null;
  steps: Goal[];
};

/** Month rows still count against the month's own target, not the weekly equivalent. */
function monthPeriodTarget(step: Goal): number | null {
  if (step.targetAmount != null && step.targetAmount > 0) {
    return step.targetAmount;
  }
  const planned = step.plannedDays?.length ?? 0;
  return planned > 0 ? planned : null;
}

function formatAmount(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(Math.round(value * 100) / 100);
}

function dayValue(entries: GoalEntry[], goalId: string, date: string): number {
  const entry = entries.find(
    (item) => item.goalId === goalId && item.entryDate === date,
  );
  return entry?.value ?? 0;
}

function withUpsertedEntry(
  entries: GoalEntry[],
  goalId: string,
  date: string,
  value: number | null,
): GoalEntry[] {
  const index = entries.findIndex(
    (entry) => entry.goalId === goalId && entry.entryDate === date,
  );
  if (index >= 0) {
    const next = entries.slice();
    const current = entries[index];
    if (current) {
      next[index] = { ...current, value };
    }
    return next;
  }
  return [
    ...entries,
    { id: `local-${goalId}-${date}`, goalId, entryDate: date, value },
  ];
}

function withoutEntry(
  entries: GoalEntry[],
  goalId: string,
  date: string,
): GoalEntry[] {
  return entries.filter(
    (entry) => !(entry.goalId === goalId && entry.entryDate === date),
  );
}

function progressRatio(total: number, target: number | null): number {
  if (target == null || target <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, total / target));
}

function topLevelAncestor(
  node: Goal,
  byId: Map<string, Goal>,
): Goal | null {
  let current: Goal | undefined = node;
  let top: Goal | null = null;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    top = current;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return top;
}

/** Parent title only when the parent is not the top-level goal (depth 2+). */
function parentRowTitle(
  node: Goal,
  byId: Map<string, Goal>,
): string | undefined {
  if (node.parentId == null) {
    return undefined;
  }
  const parent = byId.get(node.parentId);
  if (!parent) {
    return undefined;
  }
  const top = topLevelAncestor(node, byId);
  if (!top || parent.id === top.id) {
    return undefined;
  }
  return parent.title;
}

function groupActionableSteps(
  steps: Goal[],
  byId: Map<string, Goal>,
): StepGroup[] {
  const groups: StepGroup[] = [];
  const indexById = new Map<string, number>();

  for (const step of steps) {
    const top = topLevelAncestor(step, byId) ?? step;
    let index = indexById.get(top.id);
    if (index == null) {
      index = groups.length;
      indexById.set(top.id, index);
      groups.push({ id: top.id, label: null, steps: [] });
    }
    groups[index]?.steps.push(step);
  }

  for (const group of groups) {
    const hasDescendant = group.steps.some((step) => step.id !== group.id);
    if (hasDescendant) {
      group.label = byId.get(group.id)?.title ?? null;
    }
  }

  return groups;
}

function buildStepControl(
  step: Goal,
  row: RepeatingRow | undefined,
  nodes: Goal[],
  entries: GoalEntry[],
  oneTimeDone: boolean,
): StepControl {
  if (!row) {
    if (oneTimeDone) {
      return { type: 'complete', action: 'status' };
    }
    if (isTracked(step)) {
      const total = rollupTotal(step, nodes, entries) ?? 0;
      const progress = progressRatio(total, step.targetAmount);
      if (progress >= 1) {
        return { type: 'complete', action: 'log' };
      }
      return { type: 'continuous', progress, action: 'log' };
    }
    return { type: 'empty', action: 'status' };
  }

  const tracked = isTracked(step);
  const month = step.repeatPeriod === 'month';
  const amountTarget =
    step.targetAmount != null && step.targetAmount > 7;
  if (tracked || month || amountTarget) {
    const progress = tracked
      ? row.progressRatio
      : progressRatio(
          row.periodCount,
          step.repeatPeriod === 'month' ? monthPeriodTarget(step) : weeklyTarget(step),
        );
    if (progress >= 1 || (tracked && row.met)) {
      return { type: 'complete', action: 'log' };
    }
    return { type: 'continuous', progress, action: 'log' };
  }

  const target = weeklyTarget(step);
  if (target != null && target <= 7) {
    const total = Math.max(1, Math.round(target));
    const filled = Math.min(total, Math.max(0, Math.round(row.periodCount)));
    if (filled >= total) {
      return { type: 'complete', action: 'toggle' };
    }
    return {
      type: 'segmented',
      total,
      filled,
      loggedOnDay: row.isComplete,
      action: 'toggle',
    };
  }

  if (row.isComplete) {
    return { type: 'complete', action: 'toggle' };
  }
  return { type: 'empty', action: 'toggle' };
}

function isRowDone(
  row: RepeatingRow | undefined,
  oneTimeDone: boolean,
  control: StepControl,
): boolean {
  if (!row) {
    return oneTimeDone;
  }
  if (control.type === 'complete') {
    return true;
  }
  return row.isComplete || row.met;
}

function periodPhrase(step: Goal): string {
  if (step.repeatPeriod === 'month') {
    return 'this month';
  }
  return 'this week';
}

function detailSubtitle(
  step: Goal,
  row: RepeatingRow | undefined,
  entries: GoalEntry[],
  nodes: Goal[],
  done: boolean,
  asOf: string,
): { text: string; overdue: boolean } | null {
  if (isTracked(step)) {
    const total = row
      ? row.periodCount
      : (rollupTotal(step, nodes, entriesOnOrBefore(entries, asOf)) ?? 0);
    const target =
      step.targetAmount != null ? formatAmount(step.targetAmount) : '—';
    const unit = step.unit ?? '';
    const amount = `${formatAmount(total)} / ${target} ${unit}`.trim();
    const period = periodPhrase(step);
    return {
      text: row ? `${amount} ${period}` : amount,
      overdue: false,
    };
  }

  if (row) {
    const target =
      step.repeatPeriod === 'month' ? monthPeriodTarget(step) : weeklyTarget(step);
    const count = formatAmount(row.periodCount);
    const text =
      target != null
        ? `${count} of ${formatAmount(target)} ${row.periodWord}`
        : `${count} ${row.periodWord}`;
    return { text, overdue: false };
  }

  if (step.targetEndDate) {
    const overdue = !done && isPastDate(step.targetEndDate, asOf);
    if (overdue) {
      return {
        text: `Overdue · ${formatShortDate(step.targetEndDate)}`,
        overdue: true,
      };
    }
    return { text: `Due ${formatShortDate(step.targetEndDate)}`, overdue: false };
  }

  return null;
}

/** Repeating steps stay on Today until they are marked done. */
function listedAsRepeating(node: Goal): boolean {
  return (
    (isRepeating(node) || node.repeatPeriod != null) && node.status !== 'done'
  );
}

/** True when a descendant is already the row for this branch on D. */
function workLivesOnDescendant(
  node: Goal,
  asOf: string,
  childrenMap: Map<string | null, Goal[]>,
): boolean {
  const stack = [...(childrenMap.get(node.id) ?? [])];
  const seen = new Set<string>();

  while (stack.length > 0) {
    const child = stack.pop();
    if (!child || seen.has(child.id)) {
      continue;
    }
    seen.add(child.id);
    if (listedAsRepeating(child) && startedOnOrBefore(child, asOf)) {
      return true;
    }
    if (oneTimeOnDate(child, asOf) !== 'hidden') {
      return true;
    }
    for (const grandchild of childrenMap.get(child.id) ?? []) {
      stack.push(grandchild);
    }
  }

  return false;
}

function showsInProgress(
  node: Goal,
  asOf: string,
  childrenMap: Map<string | null, Goal[]>,
): boolean {
  const appearance = oneTimeOnDate(node, asOf);
  if (appearance === 'hidden') {
    return false;
  }
  if (workLivesOnDescendant(node, asOf, childrenMap)) {
    return false;
  }
  return isLeaf(node, childrenMap) || appearance === 'open';
}

/**
 * Steps that already qualify for Today, in the same order as the Plan list:
 * top-level goals by sort order, then each goal's steps depth-first.
 */
function actionableInPlanOrder(
  nodes: Goal[],
  childrenMap: Map<string | null, Goal[]>,
  asOf: string,
): Goal[] {
  const included = new Set(
    nodes
      .filter(
        (node) =>
          (listedAsRepeating(node) && startedOnOrBefore(node, asOf)) ||
          showsInProgress(node, asOf, childrenMap),
      )
      .map((node) => node.id),
  );
  const ordered: Goal[] = [];
  const seen = new Set<string>();

  const walk = (node: Goal) => {
    seen.add(node.id);
    if (included.has(node.id)) {
      ordered.push(node);
    }
    for (const child of childrenMap.get(node.id) ?? []) {
      walk(child);
    }
  };

  for (const root of childrenMap.get(null) ?? []) {
    walk(root);
  }

  const leftovers = nodes
    .filter((node) => included.has(node.id) && !seen.has(node.id))
    .sort(
      (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title),
    );
  return [...ordered, ...leftovers];
}

/** Weeks rendered on each side of the initially focused week. */
const INITIAL_SIDE_WEEKS = 12;
/** Extend the window when the user is this many pages from an edge. */
const EXTEND_THRESHOLD = 4;
/** How many weeks to append/prepend when extending. */
const EXTEND_BATCH = 12;
/** Max weeks kept in the window (trim the far side). */
const MAX_WINDOW_WEEKS = 40;

function buildWeekWindow(centerWeekStart: string, sideWeeks: number): string[] {
  const weeks: string[] = [];
  for (let offset = -sideWeeks; offset <= sideWeeks; offset += 1) {
    weeks.push(addDays(centerWeekStart, offset * 7));
  }
  return weeks;
}

function prependWeeks(weekStarts: string[], count: number): string[] {
  const first = weekStarts[0];
  if (!first) {
    return weekStarts;
  }

  const prepended: string[] = [];
  for (let i = count; i >= 1; i -= 1) {
    prepended.push(addDays(first, -i * 7));
  }
  return [...prepended, ...weekStarts];
}

function appendWeeks(weekStarts: string[], count: number): string[] {
  const last = weekStarts[weekStarts.length - 1];
  if (!last) {
    return weekStarts;
  }

  const appended: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    appended.push(addDays(last, i * 7));
  }
  return [...weekStarts, ...appended];
}

function boundedWeekWindow(
  focusWeekStart: string,
  minWeekStart: string,
  maxWeekStart: string,
  sideWeeks: number,
): { weeks: string[]; index: number } {
  const focus =
    focusWeekStart < minWeekStart
      ? minWeekStart
      : focusWeekStart > maxWeekStart
        ? maxWeekStart
        : focusWeekStart;
  const weeks = buildWeekWindow(focus, sideWeeks).filter(
    (week) => week >= minWeekStart && week <= maxWeekStart,
  );
  const safeWeeks = weeks.length > 0 ? weeks : [focus];
  return { weeks: safeWeeks, index: Math.max(0, safeWeeks.indexOf(focus)) };
}

function trimWeekWindow(
  weekStarts: string[],
  focusedIndex: number,
): { weeks: string[]; index: number } {
  if (weekStarts.length <= MAX_WINDOW_WEEKS) {
    return { weeks: weekStarts, index: focusedIndex };
  }

  const keepRadius = Math.floor(MAX_WINDOW_WEEKS / 2);
  let start = Math.max(0, focusedIndex - keepRadius);
  let end = start + MAX_WINDOW_WEEKS;
  if (end > weekStarts.length) {
    end = weekStarts.length;
    start = Math.max(0, end - MAX_WINDOW_WEEKS);
  }

  return {
    weeks: weekStarts.slice(start, end),
    index: focusedIndex - start,
  };
}

function ContinuousRing({ progress }: { progress: number }) {
  const circumference = 2 * Math.PI * RING_RADIUS;
  const clamped = Math.max(0, Math.min(1, progress));

  return (
    <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
      <Circle
        cx={RING_CENTER}
        cy={RING_CENTER}
        r={RING_RADIUS}
        stroke="#E3E3E8"
        strokeWidth={RING_STROKE}
        fill="none"
      />
      {clamped > 0 ? (
        <Circle
          cx={RING_CENTER}
          cy={RING_CENTER}
          r={RING_RADIUS}
          stroke="#248A3D"
          strokeWidth={RING_STROKE}
          fill="none"
          strokeDasharray={`${circumference * clamped} ${circumference}`}
          rotation={-90}
          origin={`${RING_CENTER}, ${RING_CENTER}`}
        />
      ) : null}
    </Svg>
  );
}

function segmentArcPath(index: number, count: number): string {
  const gap = SEGMENT_GAP / RING_RADIUS;
  const sweep = (2 * Math.PI - count * gap) / count;
  const start = -Math.PI / 2 + index * (sweep + gap);
  const end = start + sweep;
  const x1 = RING_CENTER + RING_RADIUS * Math.cos(start);
  const y1 = RING_CENTER + RING_RADIUS * Math.sin(start);
  const x2 = RING_CENTER + RING_RADIUS * Math.cos(end);
  const y2 = RING_CENTER + RING_RADIUS * Math.sin(end);
  const large = sweep > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${RING_RADIUS} ${RING_RADIUS} 0 ${large} 1 ${x2} ${y2}`;
}

function SegmentedRing({ total, filled }: { total: number; filled: number }) {
  const count = Math.max(1, Math.round(total));
  const done = Math.max(0, Math.min(count, Math.round(filled)));
  return (
    <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
      {Array.from({ length: count }, (_, index) => (
        <Path
          key={index}
          d={segmentArcPath(index, count)}
          stroke={index < done ? '#248A3D' : '#E3E3E8'}
          strokeWidth={RING_STROKE}
          fill="none"
        />
      ))}
    </Svg>
  );
}

function StepControlGraphic({ control }: { control: StepControl }) {
  if (control.type === 'complete') {
    return (
      <View style={styles.graphic}>
        <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
          <Circle
            cx={RING_CENTER}
            cy={RING_CENTER}
            r={RING_RADIUS + RING_STROKE / 2}
            fill="#248A3D"
          />
        </Svg>
        <View style={styles.graphicOverlay} pointerEvents="none">
          <Ionicons name="checkmark" size={16} color="#FFFFFF" />
        </View>
      </View>
    );
  }

  if (control.type === 'empty') {
    return (
      <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
        <Circle
          cx={RING_CENTER}
          cy={RING_CENTER}
          r={RING_RADIUS}
          stroke="#C7C7CC"
          strokeWidth={2.5}
          fill="none"
        />
      </Svg>
    );
  }

  if (control.type === 'segmented') {
    return (
      <View style={styles.graphic}>
        <SegmentedRing total={control.total} filled={control.filled} />
        {control.loggedOnDay ? (
          <View style={styles.graphicOverlay} pointerEvents="none">
            <Ionicons name="checkmark" size={12} color="#248A3D" />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.graphic}>
      <ContinuousRing progress={control.progress} />
      <View style={styles.graphicOverlay} pointerEvents="none">
        <Ionicons name="add" size={14} color="#0062CC" />
      </View>
    </View>
  );
}

function DetailLine({
  parentTitle,
  detail,
  overdue,
  streak,
  minStreak = 3,
}: {
  parentTitle?: string;
  detail?: string;
  overdue: boolean;
  streak: number;
  minStreak?: number;
}) {
  const showStreak = streak >= minStreak;

  return (
    <>
      {parentTitle ? (
        <Text style={styles.subtitle} numberOfLines={1}>
          {parentTitle}
        </Text>
      ) : null}
      {detail || showStreak ? (
        <Text style={styles.subtitle}>
          {detail ? (
            <Text style={overdue ? styles.subtitleOverdue : undefined}>{detail}</Text>
          ) : null}
          {detail && showStreak ? ' · ' : null}
          {showStreak ? (
            <Text style={styles.streakText}>
              <Ionicons name="flame" size={13} color="#C2410C" />
              {` ${streak}-day streak`}
            </Text>
          ) : null}
        </Text>
      ) : null}
    </>
  );
}

function WeekPage({
  days,
  today,
  selectedDate,
  onSelectDate,
  width,
}: {
  days: WeekDayCell[];
  today: string;
  selectedDate: string;
  onSelectDate: (dateString: string) => void;
  width: number;
}) {
  return (
    <View style={[styles.weekStrip, { width }]}>
      {days.map((day) => {
        const isToday = day.dateString === today;
        const isSelected = day.dateString === selectedDate;

        return (
          <Pressable
            key={day.dateString}
            onPress={() => onSelectDate(day.dateString)}
            style={({ pressed }) => [
              styles.weekDayCell,
              isToday && styles.weekDayCellToday,
              isSelected && !isToday && styles.weekDayCellSelected,
              isSelected && isToday && styles.weekDayCellSelectedToday,
              pressed && styles.pressed,
            ]}
          >
            <Text
              style={[
                styles.weekDayAbbrev,
                isToday && styles.weekDayTextToday,
                isSelected && !isToday && styles.weekDayTextSelected,
              ]}
            >
              {WEEKDAY_SHORT_LABELS[day.weekday]}
            </Text>
            <Text
              style={[
                styles.weekDayNumber,
                isToday && styles.weekDayTextToday,
                isSelected && !isToday && styles.weekDayTextSelected,
              ]}
            >
              {day.dayNumber}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function InfiniteWeekPager({
  today,
  selectedDate,
  onSelectDate,
  onVisibleWeekChange,
  listRef,
  weekStarts,
  setWeekStarts,
  pageIndex,
  setPageIndex,
  minWeekStart,
  maxWeekStart,
  pinnedSelectionRef,
}: {
  today: string;
  selectedDate: string;
  onSelectDate: (dateString: string) => void;
  onVisibleWeekChange: (weekStart: string) => void;
  listRef: React.RefObject<FlatList<string> | null>;
  weekStarts: string[];
  setWeekStarts: React.Dispatch<React.SetStateAction<string[]>>;
  pageIndex: number;
  setPageIndex: React.Dispatch<React.SetStateAction<number>>;
  minWeekStart: string;
  maxWeekStart: string;
  pinnedSelectionRef: { current: string | null };
}) {
  const [pageWidth, setPageWidth] = useState(0);
  const isAdjustingRef = useRef(false);
  const pageIndexRef = useRef(pageIndex);
  const selectedDateRef = useRef(selectedDate);
  const weekStartsRef = useRef(weekStarts);
  const minWeekRef = useRef(minWeekStart);
  const maxWeekRef = useRef(maxWeekStart);
  pageIndexRef.current = pageIndex;
  selectedDateRef.current = selectedDate;
  weekStartsRef.current = weekStarts;
  minWeekRef.current = minWeekStart;
  maxWeekRef.current = maxWeekStart;

  const scrollToIndexSafe = useCallback(
    (index: number, animated: boolean) => {
      requestAnimationFrame(() => {
        listRef.current?.scrollToIndex({ index, animated });
        requestAnimationFrame(() => {
          isAdjustingRef.current = false;
        });
      });
    },
    [listRef],
  );

  const ensureWindowCapacity = useCallback(
    (index: number) => {
      const current = weekStartsRef.current;
      let next = current;
      let nextIndex = index;
      let needsScrollAdjust = false;

      if (index < EXTEND_THRESHOLD && current[0] > minWeekRef.current) {
        const extended = prependWeeks(next, EXTEND_BATCH).filter(
          (week) => week >= minWeekRef.current,
        );
        const added = extended.length - next.length;
        next = extended;
        nextIndex = index + added;
        needsScrollAdjust = added > 0;
      } else if (
        index > current.length - 1 - EXTEND_THRESHOLD &&
        current[current.length - 1] < maxWeekRef.current
      ) {
        next = appendWeeks(next, EXTEND_BATCH).filter(
          (week) => week <= maxWeekRef.current,
        );
      }

      const trimmed = trimWeekWindow(next, nextIndex);
      if (trimmed.index !== nextIndex) {
        needsScrollAdjust = true;
      }

      const weeksChanged =
        trimmed.weeks.length !== current.length ||
        trimmed.weeks[0] !== current[0] ||
        trimmed.weeks[trimmed.weeks.length - 1] !==
          current[current.length - 1];

      if (!weeksChanged && trimmed.index === index) {
        return;
      }

      if (needsScrollAdjust) {
        isAdjustingRef.current = true;
      }

      weekStartsRef.current = trimmed.weeks;
      pageIndexRef.current = trimmed.index;
      setWeekStarts(trimmed.weeks);
      setPageIndex(trimmed.index);

      if (needsScrollAdjust) {
        scrollToIndexSafe(trimmed.index, false);
      }
    },
    [scrollToIndexSafe, setPageIndex, setWeekStarts],
  );

  const handleWeekSettled = useCallback(
    (index: number) => {
      if (isAdjustingRef.current) {
        return;
      }

      const weekStart = weekStartsRef.current[index];
      if (!weekStart) {
        return;
      }

      const currentSelected = selectedDateRef.current;
      const selectedOffset = Math.max(
        0,
        Math.min(
          6,
          getWeekDays(getWeekStart(currentSelected)).findIndex(
            (day) => day.dateString === currentSelected,
          ),
        ),
      );

      pageIndexRef.current = index;
      setPageIndex(index);
      onVisibleWeekChange(weekStart);
      const pinned = pinnedSelectionRef.current;
      if (pinned && getWeekStart(pinned) === weekStart) {
        pinnedSelectionRef.current = null;
        onSelectDate(pinned);
      } else {
        pinnedSelectionRef.current = null;
        onSelectDate(addDays(weekStart, selectedOffset));
      }
      ensureWindowCapacity(index);
    },
    [
      ensureWindowCapacity,
      onSelectDate,
      onVisibleWeekChange,
      pinnedSelectionRef,
      setPageIndex,
    ],
  );

  const onMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!pageWidth || isAdjustingRef.current) {
        return;
      }

      const index = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
      const clamped = Math.max(
        0,
        Math.min(weekStartsRef.current.length - 1, index),
      );

      if (clamped === pageIndexRef.current) {
        ensureWindowCapacity(clamped);
        return;
      }

      handleWeekSettled(clamped);
    },
    [ensureWindowCapacity, handleWeekSettled, pageWidth],
  );

  const renderItem = useCallback(
    ({ item: weekStart }: ListRenderItemInfo<string>) => (
      <WeekPage
        days={getWeekDays(weekStart)}
        today={today}
        selectedDate={selectedDate}
        onSelectDate={onSelectDate}
        width={pageWidth}
      />
    ),
    [onSelectDate, pageWidth, selectedDate, today],
  );

  const getItemLayout = useCallback(
    (_: ArrayLike<string> | null | undefined, index: number) => ({
      length: pageWidth,
      offset: pageWidth * index,
      index,
    }),
    [pageWidth],
  );

  return (
    <View
      style={styles.weekPager}
      onLayout={(event) => {
        const width = event.nativeEvent.layout.width;
        if (width > 0 && width !== pageWidth) {
          setPageWidth(width);
        }
      }}
    >
      {pageWidth > 0 ? (
        <FlatList
          ref={listRef}
          data={weekStarts}
          keyExtractor={(item) => item}
          horizontal
          pagingEnabled
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={pageIndex}
          getItemLayout={getItemLayout}
          renderItem={renderItem}
          onMomentumScrollEnd={onMomentumScrollEnd}
          onScrollToIndexFailed={({ index }) => {
            listRef.current?.scrollToOffset({
              offset: index * pageWidth,
              animated: false,
            });
          }}
          windowSize={5}
          maxToRenderPerBatch={3}
          initialNumToRender={3}
          removeClippedSubviews
        />
      ) : null}
    </View>
  );
}

function controlLabel(
  step: Goal,
  control: StepControl,
  loggedOnDay: boolean,
): string {
  if (control.action === 'log') {
    return 'Log an amount';
  }
  if (control.action === 'status') {
    return `Status ${step.status}. Tap to change.`;
  }
  return loggedOnDay || control.type === 'complete'
    ? 'Mark habit incomplete'
    : 'Mark habit complete';
}

function WeekDots({
  goal,
  entries,
  asOf,
}: {
  goal: Goal;
  entries: GoalEntry[];
  asOf: string;
}) {
  const days = getWeekDays(asOf);
  const start = goalStartDate(goal);
  const logged = new Set(
    entries
      .filter(
        (entry) =>
          entry.goalId === goal.id &&
          entry.entryDate <= asOf &&
          entry.entryDate >= start,
      )
      .map((entry) => entry.entryDate),
  );
  const doneNames = days
    .filter((day) => logged.has(day.dateString))
    .map((day) => WEEKDAY_SHORT_LABELS[day.weekday]);
  const label =
    doneNames.length > 0 ? `Done ${doneNames.join(', ')}` : 'No days done';

  return (
    <View
      accessible
      accessibilityLabel={label}
      pointerEvents="none"
      style={styles.weekDots}
    >
      {days.map((day) => {
        if (day.dateString < start) {
          return <View key={day.dateString} style={styles.weekDotSlot} />;
        }
        const selected = day.dateString === asOf;
        const after = day.dateString > asOf;
        const hasEntry = logged.has(day.dateString);
        return (
          <View key={day.dateString} style={styles.weekDotSlot}>
            {selected ? <View style={styles.weekDotRing} /> : null}
            <View
              style={[
                styles.weekDot,
                after
                  ? styles.weekDotHollow
                  : hasEntry
                    ? styles.weekDotDone
                    : styles.weekDotMissed,
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

function DoRow({
  title,
  parentTitle,
  detail,
  overdue,
  streak,
  minStreak,
  done,
  control,
  controlDisabled,
  controlLabelText,
  loggedOnDay,
  trailing,
  onOpen,
  onControl,
}: {
  title: string;
  parentTitle?: string;
  detail?: string;
  overdue: boolean;
  streak: number;
  minStreak?: number;
  done: boolean;
  control: StepControl;
  controlDisabled: boolean;
  controlLabelText: string;
  loggedOnDay: boolean;
  trailing?: ReactNode;
  onOpen: () => void;
  onControl: () => void;
}) {
  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [styles.doRow, pressed && styles.pressed]}
    >
      <Pressable
        onPress={onControl}
        disabled={controlDisabled}
        hitSlop={4}
        style={({ pressed }) => [
          styles.controlHit,
          controlDisabled && styles.controlDisabled,
          pressed && !controlDisabled && styles.pressed,
        ]}
        accessibilityRole={control.action === 'toggle' ? 'checkbox' : 'button'}
        accessibilityState={{
          disabled: controlDisabled,
          checked:
            control.action === 'toggle'
              ? loggedOnDay || control.type === 'complete'
              : undefined,
        }}
        accessibilityLabel={controlLabelText}
      >
        <StepControlGraphic control={control} />
      </Pressable>
      <View style={styles.checklistContent}>
        <Text style={[styles.checklistTitle, done && styles.checklistTitleDone]}>
          {title}
        </Text>
        <DetailLine
          parentTitle={parentTitle}
          detail={detail}
          overdue={overdue}
          streak={streak}
          minStreak={minStreak}
        />
      </View>
      {trailing}
    </Pressable>
  );
}

function getChecklistHeading(selectedDate: string, today: string): string {
  if (selectedDate === today) {
    return 'Today';
  }

  return formatDate(selectedDate);
}

export default function TodayScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<TodayStackParamList>>();
  const today = todayDateString();
  const todayWeekStart = getWeekStart(today);

  const [selectedDate, setSelectedDate] = useState(today);
  const [visibleWeekStart, setVisibleWeekStart] = useState(todayWeekStart);
  const [goalsLoaded, setGoalsLoaded] = useState(false);
  const [weekStarts, setWeekStarts] = useState(() =>
    boundedWeekWindow(
      todayWeekStart,
      addDays(todayWeekStart, -INITIAL_SIDE_WEEKS * 7),
      todayWeekStart,
      INITIAL_SIDE_WEEKS,
    ).weeks,
  );
  const [pageIndex, setPageIndex] = useState(INITIAL_SIDE_WEEKS);
  const pinnedSelectionRef = useRef<string | null>(null);
  const selectedDateRef = useRef(selectedDate);
  selectedDateRef.current = selectedDate;
  const listRef = useRef<FlatList<string> | null>(null);

  const [nodes, setNodes] = useState<Goal[]>([]);
  const [entries, setEntries] = useState<GoalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [logStepId, setLogStepId] = useState<string | null>(null);
  const [logAmount, setLogAmount] = useState('');
  const [logError, setLogError] = useState<string | null>(null);
  const pendingTogglesRef = useRef<Set<string>>(new Set());
  const visibleWeekStartRef = useRef(visibleWeekStart);
  const nodesRef = useRef(nodes);
  const entriesRef = useRef(entries);
  const requestedWeekRef = useRef(visibleWeekStart);
  visibleWeekStartRef.current = visibleWeekStart;
  nodesRef.current = nodes;
  entriesRef.current = entries;

  const loadEntryLogs = useCallback(
    async (nodeList: Goal[], weekStart: string) => {
      const ids = nodeList
        .filter((node) => isRepeating(node) || isTracked(node))
        .map((node) => node.id);
      if (ids.length === 0) {
        return [];
      }
      const weekEnd = addDays(weekStart, 6);
      const monthStart = `${weekStart.slice(0, 7)}-01`;
      const lookbackStart = addDays(weekStart, -STREAK_LOOKBACK_DAYS);
      return getEntries(
        ids,
        lookbackStart < monthStart ? lookbackStart : monthStart,
        weekEnd,
      );
    },
    [],
  );

  const loadTodayData = useCallback(
    async (weekStart: string) => {
      setLoadError(null);
      try {
        const nextNodes = await getAllGoals();
        setNodes(nextNodes);
        setGoalsLoaded(true);
        requestedWeekRef.current = weekStart;
        const nextEntries = await loadEntryLogs(nextNodes, weekStart);
        if (requestedWeekRef.current === weekStart) {
          setEntries(nextEntries);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to load today.';
        setLoadError(message);
      } finally {
        setLoading(false);
      }
    },
    [loadEntryLogs],
  );

  useFocusEffect(
    useCallback(() => {
      void loadTodayData(visibleWeekStartRef.current);
    }, [loadTodayData]),
  );

  const handleVisibleWeekChange = useCallback(
    (weekStart: string) => {
      setVisibleWeekStart(weekStart);
      requestedWeekRef.current = weekStart;
      void (async () => {
        try {
          const nextEntries = await loadEntryLogs(nodesRef.current, weekStart);
          if (requestedWeekRef.current === weekStart) {
            setEntries(nextEntries);
          }
        } catch (error) {
          console.warn('Failed to refresh completions for week', error);
        }
      })();
    },
    [loadEntryLogs],
  );

  const weekDays = useMemo(
    () => getWeekDays(visibleWeekStart),
    [visibleWeekStart],
  );
  const isViewingCurrentWeek = visibleWeekStart === todayWeekStart;
  const earliestWeekStart = useMemo(() => {
    const fallback = addDays(todayWeekStart, -INITIAL_SIDE_WEEKS * 7);
    if (!goalsLoaded) {
      return fallback;
    }
    if (nodes.length === 0) {
      return todayWeekStart;
    }
    let earliest = today;
    for (const node of nodes) {
      const start = goalStartDate(node);
      if (start < earliest) {
        earliest = start;
      }
    }
    const week = getWeekStart(earliest);
    return week > todayWeekStart ? todayWeekStart : week;
  }, [goalsLoaded, nodes, today, todayWeekStart]);
  const canGoPrevious = visibleWeekStart > earliestWeekStart;
  const canGoNext = visibleWeekStart < todayWeekStart;

  const showWeek = useCallback(
    (weekStart: string, nextDate: string) => {
      const target =
        weekStart < earliestWeekStart
          ? earliestWeekStart
          : weekStart > todayWeekStart
            ? todayWeekStart
            : weekStart;
      const date =
        getWeekStart(nextDate) === target ? nextDate : addDays(target, parseDateString(nextDate).getDay());
      pinnedSelectionRef.current = date;
      setSelectedDate(date);
      setVisibleWeekStart(target);
      requestedWeekRef.current = target;

      const existingIndex = weekStarts.indexOf(target);
      if (existingIndex >= 0) {
        setPageIndex(existingIndex);
        requestAnimationFrame(() => {
          listRef.current?.scrollToIndex({ index: existingIndex, animated: true });
        });
      } else {
        const window = boundedWeekWindow(
          target,
          earliestWeekStart,
          todayWeekStart,
          INITIAL_SIDE_WEEKS,
        );
        setWeekStarts(window.weeks);
        setPageIndex(window.index);
        requestAnimationFrame(() => {
          listRef.current?.scrollToIndex({ index: window.index, animated: false });
        });
      }

      void (async () => {
        try {
          const nextEntries = await loadEntryLogs(nodesRef.current, target);
          if (requestedWeekRef.current === target) {
            setEntries(nextEntries);
          }
        } catch (error) {
          console.warn('Failed to refresh completions for week', error);
        }
      })();
    },
    [earliestWeekStart, loadEntryLogs, todayWeekStart, weekStarts],
  );

  useEffect(() => {
    if (!goalsLoaded) {
      return;
    }
    const focus = visibleWeekStartRef.current;
    const window = boundedWeekWindow(
      focus,
      earliestWeekStart,
      todayWeekStart,
      INITIAL_SIDE_WEEKS,
    );
    const nextWeek = window.weeks[window.index] ?? todayWeekStart;
    setWeekStarts(window.weeks);
    setPageIndex(window.index);
    if (nextWeek !== focus) {
      const nextDate = addDays(nextWeek, parseDateString(selectedDateRef.current).getDay());
      pinnedSelectionRef.current = nextDate;
      setSelectedDate(nextDate);
      setVisibleWeekStart(nextWeek);
      requestedWeekRef.current = nextWeek;
      void loadEntryLogs(nodesRef.current, nextWeek)
        .then((nextEntries) => {
          if (requestedWeekRef.current === nextWeek) {
            setEntries(nextEntries);
          }
        })
        .catch((error) => {
          console.warn('Failed to refresh completions for week', error);
        });
    }
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index: window.index, animated: false });
    });
  }, [earliestWeekStart, goalsLoaded, loadEntryLogs, todayWeekStart]);

  const nodesById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  const childrenMap = useMemo(() => buildChildrenMap(nodes), [nodes]);

  const repeatingRows = useMemo(() => {
    const future = isFutureDate(selectedDate, today);
    return nodes
      .filter((node) => listedAsRepeating(node))
      .map((node): RepeatingRow => {
        const tracked = isTracked(node);
        const total = periodTotalAsOf(node, entries, selectedDate);
        const period = periodPhrase(node);
        return {
          id: node.id,
          title: node.title,
          tracked,
          isComplete: entries.some(
            (entry) =>
              entry.goalId === node.id && entry.entryDate === selectedDate,
          ),
          isInteractive: !future,
          met: isPeriodTargetMetAsOf(node, entries, selectedDate),
          streak: calculateStreak(
            completionDates(node, entriesOnOrBefore(entries, selectedDate)),
            selectedDate,
            goalStartDate(node),
          ),
          periodCount: total,
          periodWord: period,
          progressRatio: progressRatio(total, node.targetAmount),
        };
      });
  }, [entries, nodes, selectedDate, today]);

  const orderedSteps = useMemo(
    () => actionableInPlanOrder(nodes, childrenMap, selectedDate),
    [childrenMap, nodes, selectedDate],
  );
  const stepGroups = useMemo(
    () => groupActionableSteps(orderedSteps, nodesById),
    [nodesById, orderedSteps],
  );
  const repeatingById = useMemo(
    () => new Map(repeatingRows.map((row) => [row.id, row])),
    [repeatingRows],
  );

  const jumpToToday = () => {
    showWeek(todayWeekStart, today);
  };

  const handleOneTime = (step: Goal, appearance: OneTimeOnDate) => {
    if (appearance === 'hidden' || isFutureDate(selectedDate, today)) {
      return;
    }

    const markingDone = appearance === 'open';
    const next: GoalStatus = markingDone ? 'done' : 'active';
    const previous = nodes.find((node) => node.id === step.id) ?? step;

    setNodes((current) =>
      current.map((node) => {
        if (node.id !== step.id) {
          return node;
        }
        if (markingDone) {
          return {
            ...node,
            status: 'done',
            actualEndDate: selectedDate,
          };
        }
        return {
          ...node,
          status: next,
          actualEndDate: null,
        };
      }),
    );

    void setGoalStatus(step.id, next, markingDone ? selectedDate : undefined)
      .then((updated) => {
        setNodes((current) =>
          current.map((node) => (node.id === updated.id ? updated : node)),
        );
      })
      .catch((error) => {
        console.warn('Failed to update step status', error);
        setNodes((current) =>
          current.map((node) => (node.id === step.id ? previous : node)),
        );
      });
  };

  const handleToggle = (item: RepeatingRow) => {
    if (!item.isInteractive || item.tracked) {
      return;
    }

    const toggleKey = `${item.id}:${selectedDate}`;
    if (pendingTogglesRef.current.has(toggleKey)) {
      return;
    }

    const previous = entriesRef.current;
    const wasComplete = previous.some(
      (entry) => entry.goalId === item.id && entry.entryDate === selectedDate,
    );
    setEntries(
      wasComplete
        ? withoutEntry(previous, item.id, selectedDate)
        : withUpsertedEntry(previous, item.id, selectedDate, null),
    );

    pendingTogglesRef.current.add(toggleKey);
    const persist = wasComplete
      ? deleteEntry(item.id, selectedDate)
      : upsertEntry(item.id, selectedDate, null);

    void persist
      .then((saved) => {
        if (wasComplete || saved == null || typeof saved === 'boolean') {
          return;
        }
        setEntries((current) =>
          current.map((entry) =>
            entry.goalId === saved.goalId && entry.entryDate === saved.entryDate
              ? saved
              : entry,
          ),
        );
      })
      .catch((error) => {
        console.warn('Failed to toggle habit completion', error);
        setEntries(previous);
      })
      .finally(() => {
        pendingTogglesRef.current.delete(toggleKey);
      });
  };

  const openLog = (goalId: string) => {
    if (isFutureDate(selectedDate, today)) {
      return;
    }
    setLogAmount('');
    setLogError(null);
    setLogStepId(goalId);
  };

  const closeLog = () => {
    setLogStepId(null);
    setLogAmount('');
    setLogError(null);
  };

  const applyEntryChange = (
    goalId: string,
    date: string,
    nextEntries: GoalEntry[],
    persist: Promise<GoalEntry | void>,
  ) => {
    const previous = entriesRef.current;
    const toggleKey = `${goalId}:${date}`;
    if (pendingTogglesRef.current.has(toggleKey)) {
      return;
    }
    setEntries(nextEntries);
    closeLog();
    pendingTogglesRef.current.add(toggleKey);
    void persist
      .then((saved) => {
        if (!saved) {
          return;
        }
        setEntries((current) =>
          current.map((entry) =>
            entry.goalId === saved.goalId && entry.entryDate === saved.entryDate
              ? saved
              : entry,
          ),
        );
      })
      .catch((error) => {
        console.warn('Failed to update log', error);
        setEntries(previous);
      })
      .finally(() => {
        pendingTogglesRef.current.delete(toggleKey);
      });
  };

  const handleAddAmount = () => {
    if (!logStepId) {
      return;
    }
    const trimmed = logAmount.trim();
    const amount = Number(trimmed);
    if (!trimmed || !Number.isFinite(amount) || amount <= 0) {
      setLogError('Enter a number greater than zero.');
      return;
    }
    const nextValue = dayValue(entriesRef.current, logStepId, selectedDate) + amount;
    applyEntryChange(
      logStepId,
      selectedDate,
      withUpsertedEntry(entriesRef.current, logStepId, selectedDate, nextValue),
      upsertEntry(logStepId, selectedDate, nextValue),
    );
  };

  const handleClearDay = () => {
    if (!logStepId) {
      return;
    }
    const goalId = logStepId;
    Alert.alert(
      'Clear this day?',
      'This removes the amount logged for this day.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            applyEntryChange(
              goalId,
              selectedDate,
              withoutEntry(entriesRef.current, goalId, selectedDate),
              deleteEntry(goalId, selectedDate),
            );
          },
        },
      ],
    );
  };

  const logStep = logStepId
    ? nodes.find((node) => node.id === logStepId) ?? null
    : null;

  if (loading && nodes.length === 0) {
    return (
      <SafeAreaView style={styles.loadingState} edges={['top']}>
        <ActivityIndicator color="#007aff" />
      </SafeAreaView>
    );
  }

  if (loadError && nodes.length === 0) {
    return (
      <SafeAreaView style={styles.loadingState} edges={['top']}>
        <Text style={styles.errorText}>{loadError}</Text>
        <Pressable
          onPress={() => void loadTodayData(visibleWeekStart)}
          style={({ pressed }) => [
            styles.retryButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerBlock}>
      <View style={styles.weekHeader}>
        <View style={styles.weekRange}>
          <Pressable
            onPress={() =>
              showWeek(
                addDays(visibleWeekStart, -7),
                addDays(selectedDate, -7),
              )
            }
            disabled={!canGoPrevious}
            accessibilityRole="button"
            accessibilityLabel="Previous week"
            accessibilityState={{ disabled: !canGoPrevious }}
            style={({ pressed }) => [
              styles.weekNavButton,
              pressed && canGoPrevious && styles.pressed,
            ]}
          >
            <Ionicons
              name="chevron-back"
              size={22}
              color={canGoPrevious ? '#1C1C1E' : '#C7C7CC'}
            />
          </Pressable>
          <Text style={styles.weekLabel} numberOfLines={1}>
            {formatDate(weekDays[0]?.dateString ?? visibleWeekStart)} –{' '}
            {formatDate(weekDays[6]?.dateString ?? visibleWeekStart)}
          </Text>
          <Pressable
            onPress={() =>
              showWeek(addDays(visibleWeekStart, 7), addDays(selectedDate, 7))
            }
            disabled={!canGoNext}
            accessibilityRole="button"
            accessibilityLabel="Next week"
            accessibilityState={{ disabled: !canGoNext }}
            style={({ pressed }) => [
              styles.weekNavButton,
              pressed && canGoNext && styles.pressed,
            ]}
          >
            <Ionicons
              name="chevron-forward"
              size={22}
              color={canGoNext ? '#1C1C1E' : '#C7C7CC'}
            />
          </Pressable>
        </View>
        {!isViewingCurrentWeek ? (
          <Pressable
            onPress={jumpToToday}
            style={({ pressed }) => [
              styles.todayButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.todayButtonText}>Today</Text>
          </Pressable>
        ) : null}
      </View>

      <InfiniteWeekPager
        today={today}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        onVisibleWeekChange={handleVisibleWeekChange}
        listRef={listRef}
        weekStarts={weekStarts}
        setWeekStarts={setWeekStarts}
        pageIndex={pageIndex}
        setPageIndex={setPageIndex}
        minWeekStart={earliestWeekStart}
        maxWeekStart={todayWeekStart}
        pinnedSelectionRef={pinnedSelectionRef}
      />

      <View style={styles.headingRow}>
        <Text style={styles.screenTitle}>
          {selectedDate === today
            ? 'Today'
            : `${WEEKDAY_SHORT_LABELS[getWeekday(selectedDate)]}, ${formatShortDate(selectedDate)}`}
        </Text>
        {selectedDate !== today ? (
          <Pressable
            onPress={jumpToToday}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Back to today"
          >
            <Text style={styles.backToToday}>Back to today</Text>
          </Pressable>
        ) : null}
      </View>
      </View>

      {orderedSteps.length > 0 ? (
        stepGroups.map((group, groupIndex) => (
          <View
            key={group.id}
            style={
              groupIndex > 0
                ? group.label
                  ? styles.groupSpacedLabeled
                  : styles.groupSpaced
                : undefined
            }
          >
            {group.label ? (
              <Text style={styles.groupLabel}>{group.label}</Text>
            ) : null}
            <View style={styles.checklistCard}>
              {group.steps.map((step, rowIndex) => {
                const row = repeatingById.get(step.id);
                const futureDay = isFutureDate(selectedDate, today);
                const appearance = oneTimeOnDate(step, selectedDate);
                const oneTimeDone = appearance === 'done';
                const control = buildStepControl(
                  step,
                  row,
                  nodes,
                  entriesOnOrBefore(entries, selectedDate),
                  oneTimeDone,
                );
                const done = isRowDone(row, oneTimeDone, control);
                const detail = detailSubtitle(
                  step,
                  row,
                  entries,
                  nodes,
                  done,
                  selectedDate,
                );
                const streak = row?.streak ?? 0;
                const loggedOnDay = row?.isComplete ?? false;
                const onControl = () => {
                  if (futureDay) {
                    return;
                  }
                  if (control.action === 'log') {
                    openLog(step.id);
                    return;
                  }
                  if (!row) {
                    handleOneTime(step, appearance);
                    return;
                  }
                  if (control.action === 'toggle') {
                    handleToggle(row);
                  }
                };

                return (
                  <View key={step.id}>
                    {rowIndex > 0 ? <View style={styles.hairline} /> : null}
                    <DoRow
                      title={step.title}
                      parentTitle={parentRowTitle(step, nodesById)}
                      detail={detail?.text}
                      overdue={detail?.overdue ?? false}
                      streak={streak}
                      done={done}
                      control={control}
                      controlDisabled={futureDay}
                      controlLabelText={controlLabel(step, control, loggedOnDay)}
                      loggedOnDay={loggedOnDay}
                      trailing={
                        row ? (
                          <WeekDots
                            goal={step}
                            entries={entries}
                            asOf={selectedDate}
                          />
                        ) : undefined
                      }
                      onOpen={() =>
                        navigation.navigate('Goal', { goalId: step.id })
                      }
                      onControl={onControl}
                    />
                  </View>
                );
              })}
            </View>
          </View>
        ))
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            {selectedDate === today
              ? 'No daily habits or key activities due today. Add some on the Goals tab.'
              : 'Nothing scheduled for this day.'}
          </Text>
        </View>
      )}
    </ScrollView>

      <Modal
        visible={logStep != null}
        animationType="fade"
        transparent
        onRequestClose={closeLog}
      >
        <KeyboardSafe style={styles.modalOverlay} keyboardVerticalOffset={0}>
          <Pressable style={styles.modalBackdrop} onPress={closeLog}>
            <Pressable style={styles.logCard} onPress={() => {}}>
              <Text style={styles.logTitle}>
                {logStep?.title || 'Log amount'}
              </Text>
              <Text style={styles.logDate}>
                {getChecklistHeading(selectedDate, today)}
                {': '}
                {formatAmount(
                  logStep
                    ? dayValue(entries, logStep.id, selectedDate)
                    : 0,
                )}{' '}
                {logStep?.unit ?? ''}
              </Text>
              <View style={styles.logInputRow}>
                <TextInput
                  style={styles.logInput}
                  value={logAmount}
                  onChangeText={(value) => {
                    setLogAmount(value);
                    setLogError(null);
                  }}
                  placeholder="0"
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                  onSubmitEditing={handleAddAmount}
                  autoFocus
                />
                <Text style={styles.logUnit}>{logStep?.unit ?? ''}</Text>
                <Pressable
                  onPress={handleAddAmount}
                  style={({ pressed }) => [
                    styles.logAddAction,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.logAddActionText}>Add</Text>
                </Pressable>
              </View>
              {logError ? (
                <Text style={styles.logError}>{logError}</Text>
              ) : null}
              <Pressable
                onPress={handleClearDay}
                style={({ pressed }) => [
                  styles.logClearButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.logClearText}>Clear</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </KeyboardSafe>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f4f4f6',
  },
  content: {
    paddingTop: 12,
    paddingBottom: 24,
  },
  headerBlock: {
    paddingHorizontal: 12,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#f4f4f6',
    padding: 24,
  },
  errorText: {
    fontSize: 15,
    color: '#c62828',
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#007aff',
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  weekHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    minHeight: 44,
  },
  weekRange: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  weekNavButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekLabel: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#888',
  },
  todayButton: {
    backgroundColor: '#e8f1ff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  todayButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#007aff',
  },
  weekPager: {
    marginBottom: 14,
    minHeight: 64,
  },
  weekStrip: {
    flexDirection: 'row',
    gap: 4,
  },
  weekDayCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#fff',
    minHeight: 44,
    justifyContent: 'center',
  },
  weekDayCellToday: {
    backgroundColor: '#007aff',
  },
  weekDayCellSelected: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#007aff',
  },
  weekDayCellSelectedToday: {
    backgroundColor: '#007aff',
    borderWidth: 2,
    borderColor: '#0051a8',
  },
  weekDayAbbrev: {
    fontSize: 12,
    fontWeight: '600',
    color: '#888',
    marginBottom: 2,
  },
  weekDayNumber: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
  },
  weekDayTextToday: {
    color: '#fff',
  },
  weekDayTextSelected: {
    color: '#007aff',
  },
  screenTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111',
    flexShrink: 1,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  backToToday: {
    fontSize: 13,
    fontWeight: '600',
    color: '#007aff',
  },
  groupSpaced: {
    marginTop: 12,
  },
  groupSpacedLabeled: {
    marginTop: 20,
  },
  groupLabel: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#6B6B70',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  checklistCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    marginHorizontal: 16,
    overflow: 'hidden',
  },
  hairline: {
    height: 1,
    backgroundColor: '#ECECEF',
  },
  doRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    paddingVertical: 10,
    paddingLeft: 8,
    paddingRight: 16,
    gap: 10,
  },
  controlHit: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlDisabled: {
    opacity: 0.4,
  },
  weekDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flexShrink: 0,
  },
  weekDotSlot: {
    width: 8,
    height: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  weekDotDone: {
    backgroundColor: '#248A3D',
  },
  weekDotMissed: {
    backgroundColor: '#D1D1D6',
  },
  weekDotHollow: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: '#D1D1D6',
  },
  weekDotRing: {
    position: 'absolute',
    top: -3.5,
    right: -3.5,
    bottom: -3.5,
    left: -3.5,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#1C1C1E',
  },
  graphic: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  graphicOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checklistContent: {
    flex: 1,
    gap: 2,
  },
  checklistTitle: {
    fontSize: 17,
    fontWeight: '500',
    color: '#1C1C1E',
  },
  checklistTitleDone: {
    color: '#6B6B70',
  },
  subtitle: {
    fontSize: 14,
    color: '#6B6B70',
  },
  subtitleOverdue: {
    color: '#C2410C',
    fontWeight: '500',
  },
  streakText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#C2410C',
  },
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    marginHorizontal: 16,
    padding: 16,
  },
  emptyText: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    lineHeight: 22,
  },
  pressed: {
    opacity: 0.7,
  },
  modalOverlay: {
    flex: 1,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 24,
  },
  logCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    gap: 8,
  },
  logTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111',
  },
  logDate: {
    fontSize: 15,
    color: '#555',
  },
  logInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 17,
    minHeight: 44,
  },
  logUnit: {
    fontSize: 15,
    color: '#555',
  },
  logAddAction: {
    backgroundColor: '#007aff',
    borderRadius: 8,
    paddingHorizontal: 14,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logAddActionText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  logError: {
    fontSize: 13,
    color: '#c62828',
  },
  logClearButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
  },
  logClearText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#c62828',
  },
});
