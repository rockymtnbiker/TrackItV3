import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useMemo, useRef, useState } from 'react';
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
import { KeyboardSafe } from '../components/KeyboardSafe';
import { PendingStatusCircle } from '../components/PendingStatusCircle';
import {
  deleteEntry,
  getAllGoals,
  getEntries,
  setGoalStatus,
  upsertEntry,
} from '../lib/goalTreeApi';
import {
  buildChildrenMap,
  isLeaf,
  isPeriodTargetMet,
  completionDates,
  isRepeating,
  isTracked,
  periodTotal,
  rollupTotal,
} from '../lib/goalTree';
import type { TodayStackParamList } from '../navigation/GoalsStackNavigator';
import { nextGoalStatus } from '../types';
import type { GoalEntry, Goal, GoalStatus } from '../types/goal';
import {
  addDays,
  formatDate,
  formatShortDate,
  getWeekday,
  getWeekDays,
  getWeekStart,
  isFutureDate,
  todayDateString,
  WEEKDAY_SHORT_LABELS,
  type WeekDayCell,
} from '../utils/date';
import { calculateStreak, STREAK_LOOKBACK_DAYS } from '../utils/streak';

const WEEKDAY_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
} as const;

type RepeatingRow = {
  id: string;
  title: string;
  tracked: boolean;
  isComplete: boolean;
  isInteractive: boolean;
  plannedToday: boolean;
  met: boolean;
  streak: number;
  contextTitle?: string;
  progressLabel?: string;
  progressRatio: number;
};

function isPlannedOnDate(
  plannedDays: number[] | null,
  dateString: string,
): boolean {
  if (plannedDays == null || plannedDays.length === 0) {
    return true;
  }
  return plannedDays.includes(WEEKDAY_INDEX[getWeekday(dateString)]);
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

function contextTitle(
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
  if (!top || top.id === parent.id) {
    return parent.title;
  }
  return `${parent.title} · ${top.title}`;
}

/** Repeating steps stay on Today until they are marked done. Planned days only affect order. */
function listedAsRepeating(node: Goal): boolean {
  return (
    (isRepeating(node) || node.repeatPeriod != null) && node.status !== 'done'
  );
}

function isInProgressStatus(node: Goal, today: string): boolean {
  return node.status === 'active' || node.actualEndDate === today;
}

/** True when a descendant is already the Today row for this branch. */
function workLivesOnDescendant(
  node: Goal,
  today: string,
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
    if (listedAsRepeating(child)) {
      return true;
    }
    if (!isRepeating(child) && isInProgressStatus(child, today)) {
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
  today: string,
  childrenMap: Map<string | null, Goal[]>,
): boolean {
  if (
    isRepeating(node) ||
    node.repeatPeriod != null ||
    !isInProgressStatus(node, today)
  ) {
    return false;
  }
  if (workLivesOnDescendant(node, today, childrenMap)) {
    return false;
  }
  return isLeaf(node, childrenMap) || node.status === 'active';
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

function StreakBadge({ streak }: { streak: number }) {
  if (streak < 3) {
    return null;
  }

  return (
    <View style={styles.streakBadge}>
      <Ionicons name="flame" size={12} color="#ff6b00" />
      <Text style={styles.streakBadgeText}>{streak}</Text>
    </View>
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
}) {
  const [pageWidth, setPageWidth] = useState(0);
  const isAdjustingRef = useRef(false);
  const pageIndexRef = useRef(pageIndex);
  const selectedDateRef = useRef(selectedDate);
  const weekStartsRef = useRef(weekStarts);
  pageIndexRef.current = pageIndex;
  selectedDateRef.current = selectedDate;
  weekStartsRef.current = weekStarts;

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

      if (index < EXTEND_THRESHOLD) {
        next = prependWeeks(next, EXTEND_BATCH);
        nextIndex = index + EXTEND_BATCH;
        needsScrollAdjust = true;
      } else if (index > current.length - 1 - EXTEND_THRESHOLD) {
        next = appendWeeks(next, EXTEND_BATCH);
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
      onSelectDate(addDays(weekStart, selectedOffset));
      ensureWindowCapacity(index);
    },
    [ensureWindowCapacity, onSelectDate, onVisibleWeekChange, setPageIndex],
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
          initialScrollIndex={INITIAL_SIDE_WEEKS}
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

function ChecklistRow({
  item,
  onToggle,
  onOpen,
  onLog,
}: {
  item: RepeatingRow;
  onToggle: () => void;
  onOpen: () => void;
  onLog?: () => void;
}) {
  const iconName = item.isComplete ? 'radio-button-on' : 'radio-button-off';
  const iconColor = item.isComplete ? '#34c759' : '#c7c7cc';

  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [
        styles.checklistRow,
        item.isComplete && !item.tracked && styles.checklistRowComplete,
        item.met && styles.checklistRowMet,
        pressed && styles.pressed,
      ]}
    >
      {item.tracked ? (
        item.met ? (
          <View style={styles.radioHit} accessibilityLabel="Target met">
            <Ionicons name="checkmark" size={22} color="#34c759" />
          </View>
        ) : (
          <View style={styles.radioHit} />
        )
      ) : (
        <Pressable
          onPress={item.isInteractive ? onToggle : undefined}
          disabled={!item.isInteractive}
          hitSlop={4}
          style={({ pressed }) => [
            styles.radioHit,
            item.isInteractive && pressed && styles.pressed,
          ]}
          accessibilityRole="checkbox"
          accessibilityState={{
            checked: item.isComplete,
            disabled: !item.isInteractive,
          }}
          accessibilityLabel={
            item.isComplete ? 'Mark habit incomplete' : 'Mark habit complete'
          }
        >
          <Ionicons name={iconName} size={24} color={iconColor} />
        </Pressable>
      )}
      <View style={styles.checklistContent}>
        <View style={styles.titleRow}>
          {item.plannedToday && !item.met ? (
            <View style={styles.planDot} accessibilityLabel="Planned for this day" />
          ) : null}
          {item.met && !item.tracked ? (
            <Ionicons
              name="checkmark"
              size={16}
              color="#34c759"
              accessibilityLabel="Target met"
            />
          ) : null}
          <Text
            style={[
              styles.checklistTitle,
              item.isComplete && !item.tracked && styles.checklistTitleComplete,
              item.met && styles.checklistTitleMuted,
            ]}
          >
            {item.title}
          </Text>
          <StreakBadge streak={item.streak} />
        </View>
        {item.contextTitle ? (
          <Text style={styles.contextTitle} numberOfLines={1}>
            {item.contextTitle}
          </Text>
        ) : null}
        {item.tracked && item.progressLabel ? (
          <View style={styles.progressBlock}>
            <Text
              style={[
                styles.progressLabel,
                item.met && styles.checklistTitleMuted,
              ]}
            >
              {item.progressLabel}
            </Text>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${item.progressRatio * 100}%` },
                  item.met && styles.progressFillMet,
                ]}
              />
            </View>
          </View>
        ) : null}
      </View>
      {onLog ? (
        <Pressable
          onPress={onLog}
          hitSlop={6}
          style={({ pressed }) => [
            styles.logAddButton,
            pressed && styles.pressed,
          ]}
          accessibilityLabel="Log an amount"
        >
          <Ionicons name="add" size={22} color="#007aff" />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function InProgressRow({
  step,
  context,
  progressLabel,
  onOpen,
  onToggleStatus,
  onLog,
}: {
  step: Goal;
  context?: string;
  progressLabel?: string;
  onOpen: () => void;
  onToggleStatus: () => void;
  onLog?: () => void;
}) {
  const isDone = step.status === 'done';
  const isPending = step.status === 'pending';

  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [
        styles.inProgressRow,
        isDone && styles.checklistRowComplete,
        pressed && styles.pressed,
      ]}
    >
      <Pressable
        onPress={onToggleStatus}
        hitSlop={4}
        style={({ pressed }) => [
          styles.radioHit,
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Status ${step.status}. Tap to change.`}
      >
        {isDone ? (
          <Ionicons name="radio-button-on" size={24} color="#34c759" />
        ) : isPending ? (
          <PendingStatusCircle size={20} color="#b0b0b5" />
        ) : (
          <Ionicons name="radio-button-off" size={24} color="#c7c7cc" />
        )}
      </Pressable>
      <View style={styles.checklistContent}>
        <Text
          style={[
            styles.checklistTitle,
            isDone && styles.checklistTitleComplete,
            isPending && styles.checklistTitlePending,
          ]}
          numberOfLines={2}
        >
          {step.title}
        </Text>
        {context ? (
          <Text style={styles.contextTitle} numberOfLines={1}>
            {context}
          </Text>
        ) : null}
        {step.targetEndDate ? (
          <Text
            style={[
              styles.dueLabel,
              isDone && styles.checklistTitleComplete,
              isPending && styles.dueLabelPending,
            ]}
          >
            Due {formatShortDate(step.targetEndDate)}
          </Text>
        ) : null}
        {progressLabel ? (
          <Text style={styles.progressLabel}>{progressLabel}</Text>
        ) : null}
      </View>
      {onLog ? (
        <Pressable
          onPress={onLog}
          hitSlop={6}
          style={({ pressed }) => [
            styles.logAddButton,
            pressed && styles.pressed,
          ]}
          accessibilityLabel="Log an amount"
        >
          <Ionicons name="add" size={22} color="#007aff" />
        </Pressable>
      ) : null}
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
  const [weekStarts, setWeekStarts] = useState(() =>
    buildWeekWindow(todayWeekStart, INITIAL_SIDE_WEEKS),
  );
  const [pageIndex, setPageIndex] = useState(INITIAL_SIDE_WEEKS);
  const listRef = useRef<FlatList<string> | null>(null);

  const [nodes, setNodes] = useState<Goal[]>([]);
  const [entries, setEntries] = useState<GoalEntry[]>([]);
  const [headerTitle, setHeaderTitle] = useState('Set a Goal to get started');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [logStepId, setLogStepId] = useState<string | null>(null);
  const [logAmount, setLogAmount] = useState('');
  const [logError, setLogError] = useState<string | null>(null);
  const pendingTogglesRef = useRef<Set<string>>(new Set());
  const visibleWeekStartRef = useRef(visibleWeekStart);
  const nodesRef = useRef(nodes);
  const entriesRef = useRef(entries);
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
      return getEntries(
        ids,
        addDays(weekStart, -STREAK_LOOKBACK_DAYS),
        addDays(weekStart, 6),
      );
    },
    [],
  );

  const loadTodayData = useCallback(
    async (weekStart: string) => {
      setLoadError(null);
      try {
        const nextNodes = await getAllGoals();
        const topLevel = nextNodes
          .filter((node) => node.parentId == null && node.status !== 'done')
          .sort((a, b) => a.sortOrder - b.sortOrder);
        const primary =
          topLevel.find((node) => !isRepeating(node)) ?? topLevel[0];
        setHeaderTitle(primary?.title || 'Set a Goal to get started');
        setNodes(nextNodes);
        setEntries(await loadEntryLogs(nextNodes, weekStart));
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
      void (async () => {
        try {
          const nextEntries = await loadEntryLogs(nodesRef.current, weekStart);
          setEntries(nextEntries);
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

  const nodesById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  const childrenMap = useMemo(() => buildChildrenMap(nodes), [nodes]);

  const repeatingRows = useMemo(() => {
    const future = isFutureDate(selectedDate, today);
    return nodes
      .filter((node) => listedAsRepeating(node))
      .sort((a, b) => {
        const rank = (node: Goal) => {
          if (isPeriodTargetMet(node, entries, selectedDate)) {
            return 2;
          }
          return isPlannedOnDate(node.plannedDays, selectedDate) ? 0 : 1;
        };
        const byRank = rank(a) - rank(b);
        if (byRank !== 0) {
          return byRank;
        }
        return a.sortOrder - b.sortOrder || a.title.localeCompare(b.title);
      })
      .map((node): RepeatingRow => {
        const tracked = isTracked(node);
        const total = periodTotal(node, entries, selectedDate);
        const period = node.repeatPeriod === 'month' ? 'this month' : 'this week';
        const target =
          node.targetAmount != null ? formatAmount(node.targetAmount) : '—';
        return {
          id: node.id,
          title: node.title,
          tracked,
          isComplete: entries.some(
            (entry) =>
              entry.goalId === node.id && entry.entryDate === selectedDate,
          ),
          isInteractive: !future,
          plannedToday: isPlannedOnDate(node.plannedDays, selectedDate),
          met: isPeriodTargetMet(node, entries, selectedDate),
          streak: calculateStreak(
            completionDates(node, entries),
            selectedDate,
          ),
          contextTitle: contextTitle(node, nodesById),
          progressLabel: tracked
            ? `${formatAmount(total)} / ${target} ${node.unit} ${period}`
            : undefined,
          progressRatio: progressRatio(total, node.targetAmount),
        };
      });
  }, [entries, nodes, nodesById, selectedDate, today]);

  const inProgressSteps = useMemo(
    () =>
      nodes
        .filter((node) => showsInProgress(node, today, childrenMap))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title)),
    [childrenMap, nodes, today],
  );

  const checklistHeading = getChecklistHeading(selectedDate, today);

  const jumpToToday = () => {
    const centered = buildWeekWindow(todayWeekStart, INITIAL_SIDE_WEEKS);
    const index = INITIAL_SIDE_WEEKS;
    setWeekStarts(centered);
    setPageIndex(index);
    setSelectedDate(today);
    handleVisibleWeekChange(todayWeekStart);

    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index, animated: true });
    });
  };

  const applyStatus = (
    node: Goal,
    next: GoalStatus,
    todayStr: string,
  ): Goal => {
    if (next === 'done') {
      return { ...node, status: next, actualEndDate: todayStr };
    }
    if (next === 'active') {
      return {
        ...node,
        status: next,
        actualEndDate: null,
        actualStartDate: node.actualStartDate ?? todayStr,
      };
    }
    return { ...node, status: next };
  };

  const handleStatusCycle = (step: Goal) => {
    const next = nextGoalStatus(step.status);
    const todayStr = todayDateString();
    const previous = nodes.find((node) => node.id === step.id) ?? step;

    setNodes((current) =>
      current.map((node) =>
        node.id === step.id ? applyStatus(node, next, todayStr) : node,
      ),
    );

    void setGoalStatus(step.id, next)
      .then((updated) => {
        setNodes((current) =>
          current.map((node) => {
            if (node.id !== updated.id) {
              return node;
            }
            if (
              updated.status === 'pending' &&
              !updated.actualEndDate &&
              node.actualEndDate
            ) {
              return { ...updated, actualEndDate: node.actualEndDate };
            }
            return updated;
          }),
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
      <View style={styles.loadingState}>
        <ActivityIndicator color="#007aff" />
      </View>
    );
  }

  if (loadError && nodes.length === 0) {
    return (
      <View style={styles.loadingState}>
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
      </View>
    );
  }

  return (
    <View style={styles.container}>
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.affirmation}>{headerTitle}</Text>

      <View style={styles.weekHeader}>
        <Text style={styles.weekLabel}>
          {formatDate(weekDays[0]?.dateString ?? visibleWeekStart)} –{' '}
          {formatDate(weekDays[6]?.dateString ?? visibleWeekStart)}
        </Text>
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
      />

      <Text style={styles.screenTitle}>{checklistHeading}</Text>

      {inProgressSteps.length > 0 ? (
        <View style={styles.sectionBlock}>
          <Text style={styles.sectionHeader}>In Progress</Text>
          <View style={styles.checklistCard}>
            {inProgressSteps.map((step) => {
              const tracked = isTracked(step);
              const total = tracked ? (rollupTotal(step, nodes, entries) ?? 0) : 0;
              const target =
                step.targetAmount != null
                  ? formatAmount(step.targetAmount)
                  : '—';
              return (
                <InProgressRow
                  key={step.id}
                  step={step}
                  context={contextTitle(step, nodesById)}
                  progressLabel={
                    tracked
                      ? `${formatAmount(total)} / ${target} ${step.unit}`
                      : undefined
                  }
                  onOpen={() =>
                    navigation.navigate('StepDetail', { goalId: step.id })
                  }
                  onToggleStatus={() => handleStatusCycle(step)}
                  onLog={tracked ? () => openLog(step.id) : undefined}
                />
              );
            })}
          </View>
        </View>
      ) : null}

      {repeatingRows.length > 0 ? (
        <View style={styles.sectionBlock}>
          <Text style={styles.sectionHeader}>Habits</Text>
          <View style={styles.checklistCard}>
            {repeatingRows.map((row) => (
              <ChecklistRow
                key={row.id}
                item={row}
                onToggle={() => handleToggle(row)}
                onOpen={() =>
                  navigation.navigate('StepDetail', { goalId: row.id })
                }
                onLog={row.tracked ? () => openLog(row.id) : undefined}
              />
            ))}
          </View>
        </View>
      ) : inProgressSteps.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            {selectedDate === today
              ? 'No daily habits or key activities due today. Add some on the Goals tab.'
              : 'Nothing scheduled for this day.'}
          </Text>
        </View>
      ) : null}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f4f4f6',
  },
  content: {
    padding: 12,
    paddingBottom: 24,
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
  affirmation: {
    fontSize: 26,
    fontWeight: '700',
    color: '#111',
    textAlign: 'center',
    lineHeight: 34,
    marginBottom: 12,
    paddingHorizontal: 8,
  },
  weekHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    minHeight: 28,
  },
  weekLabel: {
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
    marginBottom: 8,
  },
  sectionBlock: {
    marginBottom: 10,
  },
  sectionHeader: {
    fontSize: 15,
    fontWeight: '600',
    color: '#555',
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  checklistCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    overflow: 'hidden',
  },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
  },
  inProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
  },
  checklistRowComplete: {
    backgroundColor: '#f8fff9',
  },
  checklistRowPlanned: {
    opacity: 0.85,
  },
  radioHit: {
    width: 44,
    height: 44,
    marginRight: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checklistContent: {
    flex: 1,
  },
  contextTitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#888',
    marginTop: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  checklistTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#222',
  },
  checklistTitleComplete: {
    color: '#888',
    textDecorationLine: 'line-through',
  },
  checklistTitlePending: {
    color: '#999',
    fontStyle: 'italic',
    fontWeight: '500',
  },
  checklistTitlePlanned: {
    color: '#666',
  },
  dueLabel: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  dueLabelPending: {
    color: '#aaa',
    fontStyle: 'italic',
  },
  plannedLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#999',
    backgroundColor: '#f0f0f0',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  streakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#fff4e8',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  streakBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#ff6b00',
  },
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
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
  checklistRowMet: {
    backgroundColor: '#fafafa',
  },
  checklistTitleMuted: {
    color: '#999',
  },
  planDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#007aff',
  },
  progressBlock: {
    marginTop: 6,
    gap: 4,
  },
  progressLabel: {
    fontSize: 13,
    color: '#555',
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#e5e5ea',
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    backgroundColor: '#007aff',
  },
  progressFillMet: {
    backgroundColor: '#34c759',
  },
  logAddButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
