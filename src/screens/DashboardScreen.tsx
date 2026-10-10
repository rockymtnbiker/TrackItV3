import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, type NavigationProp } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { entriesOnOrBefore, periodTotalAsOf, weeklyTarget } from '../lib/asOfDate';
import {
  bigDealSummary,
  goalAnalysis,
  goalStreaks,
  type AnalysisTone,
} from '../lib/goalAnalysis';
import {
  buildChildrenMap,
  goalStartDate,
  isLeaf,
  isRepeating,
  isTracked,
  paceInfo,
  rollupTotal,
} from '../lib/goalTree';
import {
  getAtRiskItems,
  getWeekStreak,
  getWeeklyItems,
  type AtRiskItem,
  type WeeklyReview,
} from '../lib/weeklyReview';
import { getAllGoals, getEntries } from '../lib/goalTreeApi';
import type { DashboardStackParamList, RootTabParamList } from '../navigation/TabNavigator';
import type { GoalEntry, Goal } from '../types/goal';
import {
  addDays,
  formatDateMDY,
  formatShortDate,
  getWeekDays,
  getWeekday,
  getWeekStart,
  parseDateString,
  toDateString,
  todayDateString,
  WEEKDAY_SHORT_LABELS,
} from '../utils/date';
import { STREAK_LOOKBACK_DAYS } from '../utils/streak';

type Props = NativeStackScreenProps<DashboardStackParamList, 'DashboardMain'>;

type DashboardPeriod = 'daily' | 'weekly' | 'monthly';

const DASHBOARD_PERIODS: { id: DashboardPeriod; label: string }[] = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
];

const DONUT_SIZE = 148;
const DONUT_STROKE = 14;

function WeeklyProgressCard({ review }: { review: WeeklyReview }) {
  const donePercent = Math.round(review.donePct * 100);
  const partialPercent = Math.round(review.partialPct * 100);
  const radius = (DONUT_SIZE - DONUT_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = DONUT_SIZE / 2;

  return (
    <View style={styles.weeklyCard}>
      <Text style={styles.weeklyCardTitle}>Weekly Progress</Text>
      {review.totalCount === 0 ? (
        <Text style={styles.weeklyEmpty}>Nothing scheduled this week.</Text>
      ) : (
        <>
          <View style={styles.donutWrap}>
            <Svg width={DONUT_SIZE} height={DONUT_SIZE}>
              <Circle
                cx={center}
                cy={center}
                r={radius}
                stroke="#e5e5ea"
                strokeWidth={DONUT_STROKE}
                fill="none"
              />
              {donePercent > 0 ? (
                <Circle
                  cx={center}
                  cy={center}
                  r={radius}
                  stroke="#007aff"
                  strokeWidth={DONUT_STROKE}
                  fill="none"
                  strokeDasharray={`${circumference} ${circumference}`}
                  strokeDashoffset={circumference * (1 - review.donePct)}
                  strokeLinecap="round"
                  rotation={-90}
                  origin={`${center}, ${center}`}
                />
              ) : null}
            </Svg>
            <Text style={styles.donutValue}>{donePercent}%</Text>
          </View>
          <Text style={styles.weeklyDoneCount}>
            {review.doneCount} of {review.totalCount} done
          </Text>
          {partialPercent !== donePercent ? (
            <Text style={styles.weeklyPartial}>
              {partialPercent}% including partial progress
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

function formatWeekDelta(delta: number): { text: string; color: string } {
  const points = Math.round(delta * 100);
  if (points > 0) {
    return { text: `↑ +${points}%`, color: '#248a3d' };
  }
  if (points < 0) {
    return { text: `↓ −${Math.abs(points)}%`, color: '#c62828' };
  }
  return { text: '0%', color: '#111' };
}

function WeekTiles({
  onPaceCount,
  deadlineCount,
  weekDelta,
  weekStreak,
}: {
  onPaceCount: number;
  deadlineCount: number;
  weekDelta: number;
  weekStreak: number;
}) {
  const delta = formatWeekDelta(weekDelta);
  return (
    <View style={styles.tileRow}>
      <View style={styles.tile}>
        <Text style={styles.tileValue}>
          {deadlineCount === 0 ? '—' : `${onPaceCount}/${deadlineCount}`}
        </Text>
        <Text style={styles.tileLabel}>
          {deadlineCount === 0 ? 'no deadline goals' : 'goals on pace'}
        </Text>
      </View>
      <View style={styles.tile}>
        <Text style={[styles.tileValue, { color: delta.color }]}>{delta.text}</Text>
        <Text style={styles.tileLabel}>vs. this point last week</Text>
      </View>
      <View style={styles.tile}>
        <Text style={styles.tileValue}>{weekStreak}</Text>
        <Text style={styles.tileLabel}>week streak · 80%+ done</Text>
      </View>
    </View>
  );
}

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const TONE_COLOR: Record<AnalysisTone, string> = {
  good: '#248A3D',
  warn: '#C2410C',
  neutral: '#1C1C1E',
};

const WIN_LIMIT = 5;

function DaysActiveCard({
  weekStart,
  today,
  activeDates,
}: {
  weekStart: string;
  today: string;
  activeDates: ReadonlySet<string>;
}) {
  const days = DAY_LETTERS.map((letter, index) => {
    const date = addDays(weekStart, index);
    const future = date > today;
    return {
      letter,
      date,
      future,
      isToday: date === today,
      filled: !future && activeDates.has(date),
    };
  });
  const elapsed = days.filter((day) => !day.future);
  const activeCount = elapsed.filter((day) => day.filled).length;

  return (
    <View style={styles.weeklyCard}>
      <Text style={styles.weeklyCardTitle}>
        Days active: {activeCount} of {elapsed.length} so far
      </Text>
      <View style={styles.dayRow}>
        {days.map((day) => (
          <View
            key={day.date}
            style={[styles.daySlot, day.isToday && styles.daySlotToday, day.future && styles.daySlotFuture]}
          >
            <View style={[styles.dayCircle, day.filled ? styles.dayCircleFilled : styles.dayCircleEmpty]}>
              <Text style={[styles.dayLetter, day.filled && styles.dayLetterFilled]}>{day.letter}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function NeedsAttentionCard({
  items,
  nodes,
  onPress,
}: {
  items: AtRiskItem[];
  nodes: Goal[];
  onPress: (goalId: string) => void;
}) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return (
    <View style={styles.weeklyCard}>
      <Text style={styles.weeklyCardTitle}>Needs attention</Text>
      {items.length === 0 ? (
        <Text style={styles.weeklyEmpty}>Everything's on track.</Text>
      ) : (
        items.map((item, index) => {
          const goal = byId.get(item.goalId);
          const why = goal ? topLevelGoal(goal, byId).why?.trim() ?? '' : '';
          return (
            <Pressable
              key={item.goalId}
              onPress={() => onPress(item.goalId)}
              style={({ pressed }) => [
                styles.attentionRow,
                index > 0 && styles.attentionRowBorder,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.title}`}
            >
              <View style={styles.attentionText}>
                {item.parentTitle ? (
                  <Text style={styles.attentionParent}>{item.parentTitle}</Text>
                ) : null}
                <Text style={styles.attentionTitle}>{item.title}</Text>
                {why ? (
                  <Text style={styles.whyLine} numberOfLines={1}>
                    {why}
                  </Text>
                ) : null}
              </View>
              <Text
                style={[
                  styles.attentionDetail,
                  attentionWarn(item.detail) && styles.attentionWarn,
                ]}
              >
                {item.detail}
              </Text>
              <Ionicons name="chevron-forward" size={18} color="#c7c7cc" />
            </Pressable>
          );
        })
      )}
    </View>
  );
}

function formatQty(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function barPercent(total: number, target: number | null): number {
  if (target == null || target <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, (total / target) * 100));
}

function monthEnd(date: string): string {
  const parsed = parseDateString(date);
  const lastDay = new Date(parsed.getFullYear(), parsed.getMonth() + 1, 0).getDate();
  return toDateString(parsed.getFullYear(), parsed.getMonth(), lastDay);
}

function subtreeIds(rootId: string, nodes: Goal[]): string[] {
  const childrenMap = buildChildrenMap(nodes);
  const ids: string[] = [];
  const seen = new Set<string>();
  const stack = [rootId];

  while (stack.length > 0) {
    const id = stack.pop();
    if (id == null || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
    for (const child of childrenMap.get(id) ?? []) {
      stack.push(child.id);
    }
  }

  return ids;
}

function topLevelGoal(goal: Goal, byId: Map<string, Goal>): Goal {
  let current = goal;
  const seen = new Set<string>();
  while (current.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = byId.get(current.parentId);
    if (!parent) {
      break;
    }
    current = parent;
  }
  return current;
}

function planOrder(nodes: Goal[], childrenMap: Map<string | null, Goal[]>): Goal[] {
  const ordered: Goal[] = [];
  const walk = (node: Goal) => {
    ordered.push(node);
    for (const child of childrenMap.get(node.id) ?? []) {
      walk(child);
    }
  };
  for (const root of childrenMap.get(null) ?? []) {
    walk(root);
  }
  const seen = new Set(ordered.map((node) => node.id));
  for (const node of nodes) {
    if (!seen.has(node.id)) {
      ordered.push(node);
    }
  }
  return ordered;
}

function mergeEntries(groups: GoalEntry[][]): GoalEntry[] {
  const byKey = new Map<string, GoalEntry>();
  for (const group of groups) {
    for (const entry of group) {
      const date = entry.entryDate.slice(0, 10);
      byKey.set(`${entry.goalId}:${date}`, { ...entry, entryDate: date });
    }
  }
  return [...byKey.values()];
}

type WinRow = {
  key: string;
  goalId: string;
  title: string;
  parentTitle: string | null;
  kind: 'done' | 'met' | 'streak';
  detail: string;
};

function winsThisWeek(
  nodes: Goal[],
  entries: GoalEntry[],
  today: string,
  weekStart: string,
): WinRow[] {
  const childrenMap = buildChildrenMap(nodes);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const weekEnd = addDays(weekStart, 6);
  const wins: WinRow[] = [];

  const parentTitle = (goal: Goal): string | null => {
    if (goal.parentId == null) {
      return null;
    }
    return byId.get(goal.parentId)?.title ?? null;
  };

  for (const goal of planOrder(nodes, childrenMap)) {
    if (isRepeating(goal)) {
      continue;
    }
    const completed = goal.actualEndDate?.slice(0, 10) || null;
    if (completed == null || completed < weekStart || completed > weekEnd || completed > today) {
      continue;
    }
    wins.push({
      key: `done:${goal.id}`,
      goalId: goal.id,
      title: goal.title || 'Untitled',
      parentTitle: parentTitle(goal),
      kind: 'done',
      detail: `Done ${WEEKDAY_SHORT_LABELS[getWeekday(completed)]}`,
    });
  }

  for (const goal of planOrder(nodes, childrenMap)) {
    if (!isRepeating(goal)) {
      continue;
    }
    const target = weeklyTarget(goal, weekStart);
    if (target == null || target <= 0) {
      continue;
    }
    const total = periodTotalAsOf(goal, entries, today);
    if (total < target) {
      continue;
    }
    wins.push({
      key: `met:${goal.id}`,
      goalId: goal.id,
      title: goal.title || 'Untitled',
      parentTitle: parentTitle(goal),
      kind: 'met',
      detail: `${formatQty(total)} of ${formatQty(target)} this week`,
    });
  }

  for (const goal of planOrder(nodes, childrenMap)) {
    if (!isRepeating(goal)) {
      continue;
    }
    const streak = goalStreaks(goal, entries, today);
    if (streak == null || streak.current < 3) {
      continue;
    }
    wins.push({
      key: `streak:${goal.id}`,
      goalId: goal.id,
      title: goal.title || 'Untitled',
      parentTitle: parentTitle(goal),
      kind: 'streak',
      detail: `${streak.current}-${streak.unit} streak`,
    });
  }

  return wins;
}

function FlameMark() {
  return (
    <Svg width={14} height={16} viewBox="0 0 14 16">
      <Path
        d="M7 0.6c.3 2.5-1.4 3.7-2.5 5C3.2 7 2.2 8.4 2.2 10.2 2.2 13 4.3 15.2 7 15.2s4.8-2.2 4.8-5c0-2-.9-3.4-1.8-4.6C9 4.3 7.8 3 7 .6z"
        fill="#C2410C"
      />
    </Svg>
  );
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
      .filter((entry) => {
        const date = entry.entryDate.slice(0, 10);
        return entry.goalId === goal.id && date <= asOf && date >= start;
      })
      .map((entry) => entry.entryDate.slice(0, 10)),
  );

  return (
    <View style={styles.weekDots} pointerEvents="none">
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

function ThinBar({ percent }: { percent: number }) {
  return (
    <View style={styles.thinTrack}>
      <View style={[styles.thinFill, { width: `${Math.max(0, Math.min(100, percent))}%` }]} />
    </View>
  );
}

function attentionWarn(detail: string): boolean {
  return (
    detail === 'overdue' ||
    detail === "can't finish this week" ||
    detail.startsWith('Missed')
  );
}

function defaultReviewWeek(today: string): string {
  const current = getWeekStart(today);
  const weekday = parseDateString(today).getDay();
  return weekday === 0 || weekday === 1 ? addDays(current, -7) : current;
}

function reviewWeekTitle(viewed: string, current: string): string {
  if (viewed === current) {
    return 'This week';
  }
  if (viewed === addDays(current, -7)) {
    return 'Last week';
  }
  return `Week of ${formatShortDate(viewed)}`;
}

function missedThisWeek(
  review: WeeklyReview,
  nodes: Goal[],
  entries: GoalEntry[],
  asOf: string,
  weekStart: string,
): AtRiskItem[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const missed: AtRiskItem[] = [];
  for (const item of review.items) {
    if (item.isDone) {
      continue;
    }
    const goal = byId.get(item.goalId);
    if (goal == null) {
      continue;
    }
    let detail = 'Missed';
    if (isRepeating(goal)) {
      const target = weeklyTarget(goal, weekStart);
      if (target != null && target > 0) {
        const total = periodTotalAsOf(goal, entries, asOf);
        detail = `Missed: ${formatQty(total)} of ${formatQty(target)}`;
      }
    }
    missed.push({
      goalId: item.goalId,
      title: item.title,
      parentTitle: item.parentTitle,
      detail,
    });
  }
  return missed;
}

export default function DashboardScreen({ navigation }: Props) {
  const { signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nodes, setNodes] = useState<Goal[]>([]);
  const [entries, setEntries] = useState<GoalEntry[]>([]);
  const [reviewEntries, setReviewEntries] = useState<GoalEntry[]>([]);
  const [activityEntries, setActivityEntries] = useState<GoalEntry[]>([]);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [period, setPeriod] = useState<DashboardPeriod>('weekly');
  const [viewedWeek, setViewedWeek] = useState(() => defaultReviewWeek(todayDateString()));

  const loadDashboard = useCallback(async () => {
    setLoadError(null);
    try {
      const today = todayDateString();
      const nextNodes = await getAllGoals();
      const topLevel = nextNodes.filter((node) => node.parentId == null);
      const active = topLevel.filter((node) => node.status !== 'done');

      const cumulativeIds = new Set<string>();
      const repeatingIds: string[] = [];
      for (const node of active) {
        if (isRepeating(node)) {
          repeatingIds.push(node.id);
        } else if (isTracked(node)) {
          for (const id of subtreeIds(node.id, nextNodes)) {
            cumulativeIds.add(id);
          }
        }
      }

      const weekStart = getWeekStart(today);
      const weekEnd = addDays(weekStart, 6);
      const periodEnd = weekEnd > monthEnd(today) ? weekEnd : monthEnd(today);
      const from = addDays(today, -STREAK_LOOKBACK_DAYS);
      let earliestDay = today;
      for (const node of nextNodes) {
        const start = goalStartDate(node);
        if (start < earliestDay) {
          earliestDay = start;
        }
      }
      const historyStart = getWeekStart(earliestDay);
      const reviewFromCandidate = addDays(weekStart, -52 * 7);
      const reviewFrom =
        historyStart < reviewFromCandidate ? historyStart : reviewFromCandidate;
      const reviewChildren = buildChildrenMap(nextNodes);
      const reviewIds = nextNodes
        .filter(
          (node) =>
            isLeaf(node, reviewChildren) &&
            isRepeating(node) &&
            node.repeatPeriod === 'week',
        )
        .map((node) => node.id);
      const [cumulativeEntries, repeatingEntries, nextReviewEntries, nextActivityEntries] =
        await Promise.all([
          cumulativeIds.size > 0 ? getEntries([...cumulativeIds]) : Promise.resolve([]),
          repeatingIds.length > 0
            ? getEntries(repeatingIds, from, periodEnd)
            : Promise.resolve([]),
          reviewIds.length > 0
            ? getEntries(reviewIds, reviewFrom, weekEnd)
            : Promise.resolve([]),
          nextNodes.length > 0
            ? getEntries(
                nextNodes.map((node) => node.id),
                historyStart,
                weekEnd,
              )
            : Promise.resolve([]),
        ]);

      setNodes(nextNodes);
      setEntries([...cumulativeEntries, ...repeatingEntries]);
      setReviewEntries(nextReviewEntries);
      setActivityEntries(nextActivityEntries);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load dashboard.';
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadDashboard();
    }, [loadDashboard]),
  );

  const handleSignOut = async () => {
    if (signingOut) {
      return;
    }
    setSigningOut(true);
    await signOut();
    setSigningOut(false);
  };

  const today = todayDateString();
  const currentWeek = getWeekStart(today);
  const earliestWeek = useMemo(() => {
    if (nodes.length === 0) {
      return currentWeek;
    }
    let earliest = today;
    for (const node of nodes) {
      const start = goalStartDate(node);
      if (start < earliest) {
        earliest = start;
      }
    }
    const week = getWeekStart(earliest);
    return week > currentWeek ? currentWeek : week;
  }, [nodes, today, currentWeek]);
  const weekStart =
    viewedWeek < earliestWeek ? earliestWeek : viewedWeek > currentWeek ? currentWeek : viewedWeek;
  const asOf = weekStart === currentWeek ? today : addDays(weekStart, 6);
  const canGoPrevious = weekStart > earliestWeek;
  const canGoNext = weekStart < currentWeek;
  const weekRange = `${formatShortDate(weekStart)} – ${formatShortDate(addDays(weekStart, 6))}`;

  useEffect(() => {
    if (loading) {
      return;
    }
    setViewedWeek((current) => {
      if (current < earliestWeek) {
        return earliestWeek;
      }
      if (current > currentWeek) {
        return currentWeek;
      }
      return current;
    });
  }, [loading, earliestWeek, currentWeek]);

  const displayEntries = useMemo(
    () => mergeEntries([entries, reviewEntries, activityEntries]),
    [entries, reviewEntries, activityEntries],
  );
  const asOfEntries = useMemo(
    () => entriesOnOrBefore(displayEntries, asOf),
    [displayEntries, asOf],
  );
  const review = useMemo(
    () =>
      getWeeklyItems(
        nodes,
        reviewEntries,
        parseDateString(weekStart),
        parseDateString(asOf),
      ),
    [nodes, reviewEntries, weekStart, asOf],
  );
  const childrenMap = useMemo(() => buildChildrenMap(nodes), [nodes]);
  const activeGoals = useMemo(
    () =>
      nodes
        .filter((node) => node.parentId == null && node.status !== 'done')
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [nodes],
  );
  const deadlineGoals = useMemo(
    () =>
      activeGoals.filter(
        (goal) => goal.targetAmount != null && goal.targetEndDate,
      ),
    [activeGoals],
  );
  const onPaceCount = useMemo(
    () =>
      deadlineGoals.filter((goal) => {
        const total = rollupTotal(goal, nodes, asOfEntries) ?? 0;
        const pace = paceInfo(goal, total, asOf);
        return pace != null && pace.pctDone >= pace.pctExpected;
      }).length,
    [deadlineGoals, nodes, asOfEntries, asOf],
  );
  const weekDelta = useMemo(() => {
    const viewedAsOf = parseDateString(asOf);
    const priorAsOf = parseDateString(addDays(asOf, -7));
    const thisWeek = getWeeklyItems(nodes, reviewEntries, parseDateString(weekStart), viewedAsOf);
    const lastWeek = getWeeklyItems(
      nodes,
      reviewEntries,
      parseDateString(addDays(weekStart, -7)),
      priorAsOf,
    );
    return thisWeek.donePct - lastWeek.donePct;
  }, [nodes, reviewEntries, weekStart, asOf]);
  const weekStreak = useMemo(
    () => getWeekStreak(nodes, reviewEntries, parseDateString(asOf)),
    [nodes, reviewEntries, asOf],
  );
  const activeDates = useMemo(() => {
    const dates = new Set<string>();
    const weekEnd = addDays(weekStart, 6);
    for (const entry of activityEntries) {
      const date = entry.entryDate.slice(0, 10);
      if (date >= weekStart && date <= asOf && date <= weekEnd) {
        dates.add(date);
      }
    }
    for (const goal of nodes) {
      if (isRepeating(goal) || goal.actualEndDate == null) {
        continue;
      }
      const completed = goal.actualEndDate.slice(0, 10);
      if (completed >= weekStart && completed <= asOf && completed <= weekEnd) {
        dates.add(completed);
      }
    }
    return dates;
  }, [activityEntries, nodes, weekStart, asOf]);
  const atRiskItems = useMemo(
    () =>
      weekStart === currentWeek
        ? getAtRiskItems(nodes, reviewEntries, parseDateString(today))
        : missedThisWeek(review, nodes, displayEntries, asOf, weekStart),
    [weekStart, currentWeek, nodes, reviewEntries, today, review, displayEntries, asOf],
  );
  const weekWins = useMemo(
    () => winsThisWeek(nodes, displayEntries, asOf, weekStart),
    [nodes, displayEntries, asOf, weekStart],
  );
  const doneGoals = useMemo(
    () =>
      nodes
        .filter((node) => node.parentId == null && node.status === 'done')
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [nodes],
  );

  const openGoal = (goalId: string) => {
    navigation.navigate('Goal', { goalId });
  };

  if (loading && nodes.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.loadingState}>
          <ActivityIndicator color="#007aff" />
        </View>
      </SafeAreaView>
    );
  }

  if (loadError && nodes.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.loadingState}>
          <Text style={styles.errorText}>{loadError}</Text>
          <Pressable
            onPress={() => void loadDashboard()}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={handleSignOut}
            disabled={signingOut}
            hitSlop={8}
            style={({ pressed }) => [styles.logoutButton, pressed && styles.pressed]}
            accessibilityLabel="Log out"
          >
            {signingOut ? (
              <ActivityIndicator size="small" color="#007aff" />
            ) : (
              <Ionicons name="log-out-outline" size={24} color="#007aff" />
            )}
          </Pressable>
        </View>

        <View style={styles.segmentTrack}>
          {DASHBOARD_PERIODS.map((option) => {
            const selected = period === option.id;
            return (
              <Pressable
                key={option.id}
                onPress={() => setPeriod(option.id)}
                style={[styles.segment, selected && styles.segmentSelected]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={option.label}
              >
                <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {period === 'weekly' ? (
          <>
            <View style={styles.weekHeader}>
              <Text style={styles.weekTitle}>{reviewWeekTitle(weekStart, currentWeek)}</Text>
              <View style={styles.weekNavRow}>
                <Pressable
                  onPress={() => setViewedWeek(addDays(weekStart, -7))}
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
                <Text style={styles.weekRange}>{weekRange}</Text>
                <Pressable
                  onPress={() => setViewedWeek(addDays(weekStart, 7))}
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
            </View>
            <View>
              {/* weekly metric cards go here */}
              <WeeklyProgressCard review={review} />
            </View>
            <WeekTiles
              onPaceCount={onPaceCount}
              deadlineCount={deadlineGoals.length}
              weekDelta={weekDelta}
              weekStreak={weekStreak}
            />
            <DaysActiveCard weekStart={weekStart} today={today} activeDates={activeDates} />
            <View style={styles.weeklyCard}>
              <Text style={styles.weeklyCardTitle}>Wins this week</Text>
              {weekWins.length === 0 ? (
                <Text style={styles.weeklyEmpty}>
                  Wins will show up here as you check things off.
                </Text>
              ) : (
                <>
                  {weekWins.slice(0, WIN_LIMIT).map((win, index) => (
                    <Pressable
                      key={win.key}
                      onPress={() => openGoal(win.goalId)}
                      style={({ pressed }) => [
                        styles.winRow,
                        index > 0 && styles.attentionRowBorder,
                        pressed && styles.pressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${win.title}`}
                    >
                      <View style={styles.attentionText}>
                        {win.parentTitle ? (
                          <Text style={styles.attentionParent}>{win.parentTitle}</Text>
                        ) : null}
                        <View style={styles.winTitleRow}>
                          {win.kind === 'streak' ? (
                            <FlameMark />
                          ) : (
                            <Ionicons name="checkmark" size={16} color="#248A3D" />
                          )}
                          <Text style={styles.winTitle} numberOfLines={1}>
                            {win.title}
                          </Text>
                        </View>
                        <Text style={styles.winDetail}>{win.detail}</Text>
                      </View>
                    </Pressable>
                  ))}
                  {weekWins.length > WIN_LIMIT ? (
                    <Text style={styles.moreWins}>+{weekWins.length - WIN_LIMIT} more</Text>
                  ) : null}
                </>
              )}
            </View>
            <NeedsAttentionCard items={atRiskItems} nodes={nodes} onPress={openGoal} />
            <View style={styles.sectionCard}>
              <Text style={styles.cardHeader}>All goals</Text>
              {activeGoals.length > 0 ? (
                activeGoals.map((goal, index) => {
                  const analysis =
                    goalAnalysis(goal, nodes, displayEntries, asOf) ??
                    bigDealSummary(goal, nodes, asOf);
                  const children = childrenMap.get(goal.id) ?? [];
                  const showDots = isRepeating(goal);
                  const showBar = !showDots && (children.length > 0 || isTracked(goal));
                  const barTarget = isRepeating(goal)
                    ? weeklyTarget(goal, weekStart)
                    : goal.targetAmount;
                  const barTotal = children.length > 0
                    ? null
                    : isRepeating(goal)
                      ? periodTotalAsOf(goal, displayEntries, asOf)
                      : (rollupTotal(goal, nodes, asOfEntries) ?? 0);
                  const deal = children.length > 0 ? bigDealSummary(goal, nodes, asOf) : null;
                  const percent = deal
                    ? deal.total > 0
                      ? (deal.done / deal.total) * 100
                      : 0
                    : barPercent(barTotal ?? 0, barTarget);
                  return (
                    <Pressable
                      key={goal.id}
                      onPress={() => openGoal(goal.id)}
                      style={({ pressed }) => [
                        styles.allGoalRow,
                        index > 0 && styles.attentionRowBorder,
                        pressed && styles.pressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${goal.title}`}
                    >
                      <View style={styles.attentionText}>
                        <Text style={styles.allGoalTitle} numberOfLines={2}>
                          {goal.title || 'Untitled'}
                        </Text>
                        {analysis ? (
                          <Text style={styles.analysisLine} numberOfLines={1}>
                            <Text style={{ color: TONE_COLOR[analysis.tone] }}>
                              {analysis.headline}
                            </Text>
                            {analysis.detail ? (
                              <Text style={styles.analysisDetail}>{` ${analysis.detail}`}</Text>
                            ) : null}
                          </Text>
                        ) : null}
                      </View>
                      <View style={styles.allGoalTrailing}>
                        {showDots ? (
                          <WeekDots goal={goal} entries={asOfEntries} asOf={asOf} />
                        ) : null}
                        {showBar ? <ThinBar percent={percent} /> : null}
                        <Ionicons name="chevron-forward" size={18} color="#c7c7cc" />
                      </View>
                    </Pressable>
                  );
                })
              ) : (
                <Text style={styles.emptyText}>No active goals.</Text>
              )}
            </View>

            <Pressable
              onPress={() => setCompletedOpen((open) => !open)}
              style={({ pressed }) => [styles.completedHeader, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityState={{ expanded: completedOpen }}
              accessibilityLabel={`Completed, ${doneGoals.length}`}
            >
              <Text style={[styles.sectionTitle, styles.completedTitle]}>
                Completed ({doneGoals.length})
              </Text>
              <Ionicons
                name={completedOpen ? 'chevron-down' : 'chevron-forward'}
                size={16}
                color="#888"
              />
            </Pressable>
            {completedOpen ? (
              <View style={styles.sectionCard}>
                {doneGoals.length > 0 ? (
                  doneGoals.map((goal, index) => (
                    <Pressable
                      key={goal.id}
                      onPress={() => openGoal(goal.id)}
                      style={({ pressed }) => [
                        styles.completedRow,
                        index < doneGoals.length - 1 && styles.rowBorder,
                        pressed && styles.pressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${goal.title}`}
                    >
                      <Text style={[styles.goalTitle, styles.doneTitle]}>{goal.title}</Text>
                      <Text style={styles.completedDate}>
                        {goal.actualEndDate ? formatDateMDY(goal.actualEndDate) : '—'}
                      </Text>
                    </Pressable>
                  ))
                ) : (
                  <Text style={styles.emptyText}>No completed goals.</Text>
                )}
              </View>
            ) : null}
            <Pressable
              onPress={() =>
                navigation.getParent<NavigationProp<RootTabParamList>>()?.navigate('Goals')
              }
              style={({ pressed }) => [styles.planButton, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Plan next week"
            >
              <Text style={styles.planButtonText}>Plan next week →</Text>
            </Pressable>
          </>
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>Coming soon</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f2f2f7',
  },
  container: {
    flex: 1,
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginBottom: 10,
  },
  logoutButton: {
    padding: 4,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentTrack: {
    flexDirection: 'row',
    backgroundColor: '#e5e5ea',
    borderRadius: 9,
    padding: 2,
    marginBottom: 16,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    borderRadius: 7,
  },
  segmentSelected: {
    backgroundColor: '#fff',
  },
  segmentLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111',
  },
  segmentLabelSelected: {
    color: '#111',
  },
  weekHeader: {
    marginBottom: 12,
  },
  weekTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111',
  },
  weekNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  weekNavButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekRange: {
    flex: 1,
    fontSize: 15,
    color: '#8e8e93',
    textAlign: 'center',
  },
  planButton: {
    backgroundColor: '#007aff',
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  planButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  placeholder: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 15,
    color: '#8e8e93',
  },
  weeklyCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  weeklyCardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111',
    marginBottom: 12,
  },
  weeklyEmpty: {
    fontSize: 15,
    color: '#666',
    paddingBottom: 4,
  },
  donutWrap: {
    width: DONUT_SIZE,
    height: DONUT_SIZE,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  donutValue: {
    position: 'absolute',
    fontSize: 32,
    fontWeight: '700',
    color: '#111',
  },
  weeklyDoneCount: {
    fontSize: 16,
    fontWeight: '500',
    color: '#111',
    textAlign: 'center',
  },
  weeklyPartial: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    marginTop: 4,
  },
  tileRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  tile: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  tileValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111',
    textAlign: 'center',
  },
  tileLabel: {
    fontSize: 12,
    lineHeight: 16,
    color: '#666',
    textAlign: 'center',
    marginTop: 4,
  },
  dayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  daySlot: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  daySlotToday: {
    borderColor: '#007aff',
  },
  daySlotFuture: {
    opacity: 0.35,
  },
  dayCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircleFilled: {
    backgroundColor: '#007aff',
  },
  dayCircleEmpty: {
    backgroundColor: '#f2f2f7',
  },
  dayLetter: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111',
  },
  dayLetterFilled: {
    color: '#fff',
  },
  attentionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  attentionRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5ea',
  },
  attentionText: {
    flex: 1,
  },
  attentionParent: {
    fontSize: 12,
    color: '#8e8e93',
    marginBottom: 2,
  },
  attentionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111',
  },
  attentionDetail: {
    flexShrink: 1,
    maxWidth: '46%',
    fontSize: 13,
    lineHeight: 18,
    color: '#666',
    textAlign: 'right',
  },
  attentionWarn: {
    color: '#C2410C',
  },
  whyLine: {
    fontSize: 13,
    fontStyle: 'italic',
    color: '#8e8e93',
    marginTop: 2,
  },
  winRow: {
    paddingVertical: 8,
  },
  winTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  winTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#111',
  },
  winDetail: {
    fontSize: 14,
    color: '#6B6B70',
    marginTop: 2,
    marginLeft: 22,
  },
  moreWins: {
    fontSize: 14,
    color: '#8e8e93',
    paddingTop: 8,
  },
  cardHeader: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111',
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 4,
  },
  allGoalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  allGoalTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#111',
  },
  analysisLine: {
    fontSize: 13,
    marginTop: 2,
  },
  analysisDetail: {
    color: '#6B6B70',
  },
  allGoalTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  thinTrack: {
    width: 60,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E5EA',
    overflow: 'hidden',
  },
  thinFill: {
    height: 4,
    backgroundColor: '#248A3D',
  },
  weekDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
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
  pressed: {
    opacity: 0.7,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  completedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  completedTitle: {
    flex: 1,
    marginBottom: 0,
  },
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    overflow: 'hidden',
  },
  goalRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
  },
  goalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  goalTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#111',
    marginRight: 12,
  },
  doneTitle: {
    color: '#888',
    textDecorationLine: 'line-through',
    fontWeight: '600',
  },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: '#e5e5ea',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#007aff',
    borderRadius: 5,
  },
  progressRowLabel: {
    fontSize: 12,
    color: '#888',
    marginBottom: 6,
  },
  paceLine: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 6,
  },
  paceAhead: {
    color: '#248a3d',
  },
  paceBehind: {
    color: '#b8860b',
  },
  statusLabel: {
    fontSize: 13,
    color: '#888',
    textTransform: 'capitalize',
  },
  streakMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  streakCount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ff6b00',
  },
  completedRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  completedDate: {
    fontSize: 14,
    color: '#888',
  },
  emptyText: {
    padding: 14,
    fontSize: 14,
    color: '#aaa',
  },
});
