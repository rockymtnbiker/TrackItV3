import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { getGoals } from '../lib/goalsApi';
import {
  addCompletion,
  getAllActiveHabits,
  getCompletionsForHabit,
  removeCompletion,
  type ActiveHabit,
} from '../lib/habitsApi';
import {
  addDays,
  formatDate,
  getWeekDays,
  getWeekStart,
  todayDateString,
  toggleDateInLog,
  WEEKDAY_SHORT_LABELS,
  type WeekDayCell,
} from '../utils/date';
import { calculateStreak } from '../utils/streak';
import {
  buildChecklistSections,
  type ChecklistItem,
} from '../utils/todayChecklist';

/** Extra days before the visible week so streak badges stay accurate. */
const COMPLETION_LOOKBACK_DAYS = 90;

function isDatedItemVisible(
  item: {
    createdDate: string;
    startDate?: string;
    endDate?: string;
    deletedAt?: string;
  },
  dateString: string,
): boolean {
  if (item.deletedAt) {
    return false;
  }
  if (dateString < item.createdDate) {
    return false;
  }
  if (item.startDate && dateString < item.startDate) {
    return false;
  }
  if (item.endDate && dateString > item.endDate) {
    return false;
  }
  return true;
}

function withCompletions(
  habits: ActiveHabit[],
  completionsByHabitId: Map<string, string[]>,
): ActiveHabit[] {
  return habits.map((habit) => {
    const completionLog = completionsByHabitId.get(habit.id) ?? [];
    return {
      ...habit,
      completionLog,
      streakCount: calculateStreak(completionLog),
    };
  });
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
}: {
  item: ChecklistItem;
  onToggle: () => void;
}) {
  const iconName = item.isComplete
    ? 'radio-button-on'
    : item.isPlanned
      ? 'ellipse-outline'
      : 'radio-button-off';
  const iconColor = item.isComplete
    ? '#34c759'
    : item.isPlanned
      ? '#d1d1d6'
      : '#c7c7cc';

  return (
    <Pressable
      onPress={item.isInteractive ? onToggle : undefined}
      disabled={!item.isInteractive}
      style={({ pressed }) => [
        styles.checklistRow,
        item.isComplete && styles.checklistRowComplete,
        item.isPlanned && styles.checklistRowPlanned,
        item.isInteractive && pressed && styles.pressed,
      ]}
    >
      <Ionicons
        name={iconName}
        size={24}
        color={iconColor}
        style={styles.radio}
      />
      <View style={styles.checklistContent}>
        <View style={styles.titleRow}>
          <Text
            style={[
              styles.checklistTitle,
              (item.isComplete || item.isStatusDone) &&
                styles.checklistTitleComplete,
              item.isPlanned && styles.checklistTitlePlanned,
            ]}
          >
            {item.title}
          </Text>
          {item.streak !== undefined ? <StreakBadge streak={item.streak} /> : null}
          {item.isPlanned ? (
            <Text style={styles.plannedLabel}>Planned</Text>
          ) : null}
        </View>
      </View>
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
  const today = todayDateString();
  const todayWeekStart = getWeekStart(today);

  const [selectedDate, setSelectedDate] = useState(today);
  const [visibleWeekStart, setVisibleWeekStart] = useState(todayWeekStart);
  const [weekStarts, setWeekStarts] = useState(() =>
    buildWeekWindow(todayWeekStart, INITIAL_SIDE_WEEKS),
  );
  const [pageIndex, setPageIndex] = useState(INITIAL_SIDE_WEEKS);
  const listRef = useRef<FlatList<string> | null>(null);

  const [habits, setHabits] = useState<ActiveHabit[]>([]);
  const [headerTitle, setHeaderTitle] = useState('Set a Goal to get started');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const pendingTogglesRef = useRef<Set<string>>(new Set());
  const visibleWeekStartRef = useRef(visibleWeekStart);
  const habitsRef = useRef(habits);
  visibleWeekStartRef.current = visibleWeekStart;
  habitsRef.current = habits;

  const loadCompletions = useCallback(
    async (habitList: ActiveHabit[], weekStart: string) => {
      const rangeStart = addDays(weekStart, -COMPLETION_LOOKBACK_DAYS);
      const rangeEnd = addDays(weekStart, 6);

      const results = await Promise.all(
        habitList.map(async (habit) => {
          const dates = await getCompletionsForHabit(
            habit.id,
            rangeStart,
            rangeEnd,
          );
          return [habit.id, dates] as const;
        }),
      );

      return new Map<string, string[]>(results);
    },
    [],
  );

  const loadTodayData = useCallback(
    async (weekStart: string) => {
      setLoading(true);
      setLoadError(null);
      try {
        const [nextHabits, goals] = await Promise.all([
          getAllActiveHabits(),
          getGoals(),
        ]);

        const primaryGoal = goals.find(
          (goal) => !goal.deletedAt && goal.status !== 'done',
        );
        setHeaderTitle(primaryGoal?.title ?? 'Set a Goal to get started');

        const completionsByHabitId = await loadCompletions(
          nextHabits,
          weekStart,
        );
        setHabits(withCompletions(nextHabits, completionsByHabitId));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to load today.';
        setLoadError(message);
      } finally {
        setLoading(false);
      }
    },
    [loadCompletions],
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
          const completionsByHabitId = await loadCompletions(
            habitsRef.current,
            weekStart,
          );
          setHabits((current) =>
            withCompletions(current, completionsByHabitId),
          );
        } catch (error) {
          console.warn('Failed to refresh completions for week', error);
        }
      })();
    },
    [loadCompletions],
  );

  const weekDays = useMemo(
    () => getWeekDays(visibleWeekStart),
    [visibleWeekStart],
  );
  const isViewingCurrentWeek = visibleWeekStart === todayWeekStart;

  const milestoneTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const habit of habits) {
      const milestone = habit.parentMilestone;
      if (milestone && isDatedItemVisible(milestone, selectedDate)) {
        map.set(milestone.id, milestone.title);
      }
    }
    return map;
  }, [habits, selectedDate]);

  const goalTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const habit of habits) {
      const goal = habit.parentGoal;
      if (goal && isDatedItemVisible(goal, selectedDate)) {
        map.set(goal.id, goal.title);
      }
    }
    return map;
  }, [habits, selectedDate]);

  const sections = useMemo(
    () =>
      buildChecklistSections(
        selectedDate,
        habits,
        milestoneTitles,
        goalTitles,
        today,
      ),
    [selectedDate, habits, milestoneTitles, goalTitles, today],
  );

  const totalItems = sections.reduce(
    (sum, section) => sum + section.items.length,
    0,
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

  const handleToggle = (item: ChecklistItem) => {
    if (!item.isInteractive || item.type !== 'habit') {
      return;
    }

    const toggleKey = `${item.id}:${selectedDate}`;
    if (pendingTogglesRef.current.has(toggleKey)) {
      return;
    }

    const habit = habits.find((entry) => entry.id === item.id);
    if (!habit) {
      return;
    }

    const wasComplete = habit.completionLog.includes(selectedDate);
    const previousLog = habit.completionLog;
    const nextLog = toggleDateInLog(previousLog, selectedDate);

    setHabits((current) =>
      current.map((entry) =>
        entry.id === item.id
          ? {
              ...entry,
              completionLog: nextLog,
              streakCount: calculateStreak(nextLog, selectedDate),
            }
          : entry,
      ),
    );

    pendingTogglesRef.current.add(toggleKey);
    const persist = wasComplete
      ? removeCompletion(item.id, selectedDate)
      : addCompletion(item.id, selectedDate);

    void persist
      .catch((error) => {
        console.warn('Failed to toggle habit completion', error);
        setHabits((current) =>
          current.map((entry) =>
            entry.id === item.id
              ? {
                  ...entry,
                  completionLog: previousLog,
                  streakCount: calculateStreak(previousLog, selectedDate),
                }
              : entry,
          ),
        );
      })
      .finally(() => {
        pendingTogglesRef.current.delete(toggleKey);
      });
  };

  if (loading && habits.length === 0) {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator color="#007aff" />
      </View>
    );
  }

  if (loadError && habits.length === 0) {
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

      {totalItems > 0 ? (
        sections.map((section) => (
          <View key={section.key} style={styles.sectionBlock}>
            <Text style={styles.sectionHeader}>{section.title}</Text>
            <View style={styles.checklistCard}>
              {section.items.map((checklistItem) => (
                <ChecklistRow
                  key={`${checklistItem.type}-${checklistItem.id}`}
                  item={checklistItem}
                  onToggle={() => handleToggle(checklistItem)}
                />
              ))}
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
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f4f4f6',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
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
    marginBottom: 20,
    paddingHorizontal: 8,
  },
  weekHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
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
    marginBottom: 24,
    minHeight: 64,
  },
  weekStrip: {
    flexDirection: 'row',
    gap: 4,
  },
  weekDayCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#fff',
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
    marginBottom: 4,
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
    marginBottom: 12,
  },
  sectionBlock: {
    marginBottom: 16,
  },
  sectionHeader: {
    fontSize: 15,
    fontWeight: '600',
    color: '#555',
    marginBottom: 8,
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
    alignItems: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
  },
  checklistRowComplete: {
    backgroundColor: '#f8fff9',
  },
  checklistRowPlanned: {
    opacity: 0.85,
  },
  radio: {
    marginRight: 12,
    marginTop: 1,
  },
  checklistContent: {
    flex: 1,
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
  checklistTitlePlanned: {
    color: '#666',
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
    padding: 20,
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
});
