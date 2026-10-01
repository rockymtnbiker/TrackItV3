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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import {
  buildChildrenMap,
  completionDates,
  isRepeating,
  isTracked,
  paceInfo,
  periodTotal,
  rollupTotal,
} from '../lib/goalTree';
import { getAllGoals, getEntries } from '../lib/goalTreeApi';
import type { DashboardStackParamList } from '../navigation/TabNavigator';
import type { GoalEntry, Goal } from '../types/goal';
import {
  addDays,
  formatDateMDY,
  getWeekStart,
  parseDateString,
  toDateString,
  todayDateString,
} from '../utils/date';
import { calculateStreak, STREAK_LOOKBACK_DAYS } from '../utils/streak';

type Props = NativeStackScreenProps<DashboardStackParamList, 'DashboardMain'>;

function ProgressBar({ percent }: { percent: number }) {
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${percent}%` }]} />
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
  const [completedOpen, setCompletedOpen] = useState(false);

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

      const weekEnd = addDays(getWeekStart(today), 6);
      const periodEnd = weekEnd > monthEnd(today) ? weekEnd : monthEnd(today);
      const from = addDays(today, -STREAK_LOOKBACK_DAYS);
      const [cumulativeEntries, repeatingEntries] = await Promise.all([
        cumulativeIds.size > 0 ? getEntries([...cumulativeIds]) : Promise.resolve([]),
        repeatingIds.length > 0
          ? getEntries(repeatingIds, from, periodEnd)
          : Promise.resolve([]),
      ]);

      setNodes(nextNodes);
      setEntries([...cumulativeEntries, ...repeatingEntries]);
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
  const childrenMap = useMemo(() => buildChildrenMap(nodes), [nodes]);
  const activeGoals = useMemo(
    () =>
      nodes
        .filter((node) => node.parentId == null && node.status !== 'done')
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [nodes],
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

        <Text style={styles.sectionTitle}>Active</Text>
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
