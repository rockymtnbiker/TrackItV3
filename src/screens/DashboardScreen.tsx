import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import {
  buildChildrenMap,
  completionDates,
  isLeaf,
  isRepeating,
  isTracked,
  paceInfo,
  periodTotal,
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
import type { DashboardStackParamList } from '../navigation/TabNavigator';
import type { GoalEntry, Goal } from '../types/goal';
import {
  addDays,
  formatDateMDY,
  formatShortDate,
  getWeekStart,
  parseDateString,
  toDateString,
  todayDateString,
} from '../utils/date';
import { calculateStreak, STREAK_LOOKBACK_DAYS } from '../utils/streak';

type Props = NativeStackScreenProps<DashboardStackParamList, 'DashboardMain'>;

type DashboardPeriod = 'daily' | 'weekly' | 'monthly';

const DASHBOARD_PERIODS: { id: DashboardPeriod; label: string }[] = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
];

function ProgressBar({ percent }: { percent: number }) {
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${percent}%` }]} />
    </View>
  );
}

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
  onPress,
}: {
  items: AtRiskItem[];
  onPress: (goalId: string) => void;
}) {
  return (
    <View style={styles.weeklyCard}>
      <Text style={styles.weeklyCardTitle}>Needs attention</Text>
      {items.length === 0 ? (
        <Text style={styles.weeklyEmpty}>Everything's on track.</Text>
      ) : (
        items.map((item, index) => (
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
            </View>
            <Text style={styles.attentionDetail}>{item.detail}</Text>
          </Pressable>
        ))
      )}
    </View>
  );
}

function formatAmount(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(Math.round(value * 100) / 100);
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

function ActiveGoalCard({
  node,
  nodes,
  entries,
  today,
  childrenMap,
  onPress,
}: {
  node: Goal;
  nodes: Goal[];
  entries: GoalEntry[];
  today: string;
  childrenMap: Map<string | null, Goal[]>;
  onPress: () => void;
}) {
  const repeating = isRepeating(node);
  const tracked = isTracked(node);
  const children = childrenMap.get(node.id) ?? [];

  let label: string | null = null;
  let percent = 0;
  let showBar = false;
  let paceLine: string | null = null;
  let paceBehind = false;
  let streak: number | null = null;
  let statusLabel: string | null = null;

  if (tracked && !repeating) {
    const total = rollupTotal(node, nodes, entries) ?? 0;
    const target =
      node.targetAmount != null ? formatAmount(node.targetAmount) : '—';
    label = `${formatAmount(total)} / ${target} ${node.unit}`;
    percent = barPercent(total, node.targetAmount);
    showBar = true;
    const pace = paceInfo(node, total, today);
    if (pace) {
      paceBehind = pace.delta < 0 && !pace.onPace;
      paceLine = `${Math.round(pace.pctDone)}% done · ${Math.round(Math.abs(pace.delta))}% ${paceBehind ? 'behind' : 'ahead'}`;
    }
  } else if (repeating) {
    const total = periodTotal(node, entries, today);
    const target =
      node.targetAmount != null ? formatAmount(node.targetAmount) : '—';
    const unit = node.unit ?? 'times';
    const period = node.repeatPeriod === 'month' ? 'this month' : 'this week';
    label = `${formatAmount(total)} / ${target} ${unit} ${period}`;
    percent = barPercent(total, node.targetAmount);
    showBar = true;
    streak = calculateStreak(completionDates(node, entries), today);
  } else if (children.length > 0) {
    const doneCount = children.filter((child) => child.status === 'done').length;
    const activeCount = children.filter((child) => child.status === 'active').length;
    label = `${doneCount} done · ${activeCount} active`;
  } else {
    statusLabel = node.status;
  }

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.goalRow, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Open ${node.title}`}
    >
      <View style={styles.goalHeader}>
        <Text style={styles.goalTitle}>{node.title}</Text>
        {streak != null ? (
          <View style={styles.streakMeta}>
            <Ionicons name="flame" size={16} color="#ff6b00" />
            <Text style={styles.streakCount}>{streak}</Text>
          </View>
        ) : null}
      </View>
      {label ? <Text style={styles.progressRowLabel}>{label}</Text> : null}
      {showBar ? <ProgressBar percent={percent} /> : null}
      {paceLine ? (
        <Text style={[styles.paceLine, paceBehind ? styles.paceBehind : styles.paceAhead]}>
          {paceLine}
        </Text>
      ) : null}
      {statusLabel ? <Text style={styles.statusLabel}>{statusLabel}</Text> : null}
    </Pressable>
  );
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
            ? getEntries(reviewIds, addDays(weekStart, -52 * 7), weekEnd)
            : Promise.resolve([]),
          nextNodes.length > 0
            ? getEntries(
                nextNodes.map((node) => node.id),
                weekStart,
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
  const weekStart = getWeekStart(today);
  const weekRange = `${formatShortDate(weekStart)} – ${formatShortDate(addDays(weekStart, 6))}`;
  const review = useMemo(
    () => getWeeklyItems(nodes, reviewEntries, parseDateString(weekStart)),
    [nodes, reviewEntries, weekStart],
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
        const total = rollupTotal(goal, nodes, entries) ?? 0;
        const pace = paceInfo(goal, total, today);
        return pace != null && pace.pctDone >= pace.pctExpected;
      }).length,
    [deadlineGoals, nodes, entries, today],
  );
  const weekDelta = useMemo(() => {
    const asOf = parseDateString(today);
    const lastAsOf = parseDateString(addDays(today, -7));
    const thisWeek = getWeeklyItems(nodes, reviewEntries, parseDateString(weekStart), asOf);
    const lastWeek = getWeeklyItems(
      nodes,
      reviewEntries,
      parseDateString(addDays(weekStart, -7)),
      lastAsOf,
    );
    return thisWeek.donePct - lastWeek.donePct;
  }, [nodes, reviewEntries, weekStart, today]);
  const weekStreak = useMemo(
    () => getWeekStreak(nodes, reviewEntries, parseDateString(today)),
    [nodes, reviewEntries, today],
  );
  const activeDates = useMemo(() => {
    const dates = new Set<string>();
    for (const entry of activityEntries) {
      const date = entry.entryDate.slice(0, 10);
      if (date >= weekStart && date <= today) {
        dates.add(date);
      }
    }
    for (const goal of nodes) {
      if (isRepeating(goal) || goal.actualEndDate == null) {
        continue;
      }
      const completed = goal.actualEndDate.slice(0, 10);
      if (completed >= weekStart && completed <= today) {
        dates.add(completed);
      }
    }
    return dates;
  }, [activityEntries, nodes, weekStart, today]);
  const atRiskItems = useMemo(
    () => getAtRiskItems(nodes, reviewEntries, parseDateString(today)),
    [nodes, reviewEntries, today],
  );
  const doneGoals = useMemo(
    () =>
      nodes
        .filter((node) => node.parentId == null && node.status === 'done')
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [nodes],
  );

  const openGoal = (goalId: string) => {
    navigation.navigate('StepDetail', { goalId });
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
          <Text style={styles.screenTitle}>Dashboard</Text>
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
              <Text style={styles.weekTitle}>This week</Text>
              <Text style={styles.weekRange}>{weekRange}</Text>
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
            <NeedsAttentionCard items={atRiskItems} onPress={openGoal} />
            <Text style={styles.sectionTitle}>Goals</Text>
            <View style={styles.sectionCard}>
              {activeGoals.length > 0 ? (
                activeGoals.map((goal, index) => (
                  <View
                    key={goal.id}
                    style={index < activeGoals.length - 1 ? styles.rowBorder : undefined}
                  >
                    <ActiveGoalCard
                      node={goal}
                      nodes={nodes}
                      entries={entries}
                      today={today}
                      childrenMap={childrenMap}
                      onPress={() => openGoal(goal.id)}
                    />
                  </View>
                ))
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
                    <View
                      key={goal.id}
                      style={[
                        styles.completedRow,
                        index < doneGoals.length - 1 && styles.rowBorder,
                      ]}
                    >
                      <Text style={[styles.goalTitle, styles.doneTitle]}>{goal.title}</Text>
                      <Text style={styles.completedDate}>
                        {goal.actualEndDate ? formatDateMDY(goal.actualEndDate) : '—'}
                      </Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.emptyText}>No completed goals.</Text>
                )}
              </View>
            ) : null}
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
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111',
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
  weekRange: {
    fontSize: 15,
    color: '#8e8e93',
    marginTop: 2,
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
