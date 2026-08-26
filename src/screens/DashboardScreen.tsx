import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
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
import { getGoals } from '../lib/goalsApi';
import {
  getAllActiveHabits,
  getCompletionsInRange,
  getStreakCount,
  type ActiveHabit,
} from '../lib/habitsApi';
import { getMilestones } from '../lib/milestonesApi';
import type { Goal, Milestone } from '../types';
import {
  completionsInActiveRange,
  dashboardTrackableHabits,
  existsByDate,
  filterActive,
} from '../utils/activeItems';
import {
  addDays,
  getWeekStart,
  todayDateString,
} from '../utils/date';
import {
  goalProgressPercent,
  monthlyProgressLabel,
  monthlyProgressPercent,
  weeklyProgressLabel,
  weeklyProgressPercent,
} from '../utils/progress';

function ProgressBar({ percent }: { percent: number }) {
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${percent}%` }]} />
    </View>
  );
}

type TrackableItem = {
  id: string;
  title: string;
  completionLog: string[];
  weeklyTarget: number;
  isArchived: boolean;
};

type HabitStreakItem = {
  id: string;
  title: string;
  streak: number;
};

function ProgressRow({
  item,
  percent,
  label,
}: {
  item: TrackableItem;
  percent: number;
  label: string;
}) {
  return (
    <View style={styles.progressRow}>
      <View style={styles.progressRowHeader}>
        <Text style={styles.progressRowTitle}>
          {item.title}
          {item.isArchived ? (
            <Text style={styles.archivedLabel}> (archived)</Text>
          ) : null}
        </Text>
        <Text style={styles.progressRowPercent}>{percent}%</Text>
      </View>
      <Text style={styles.progressRowLabel}>{label}</Text>
      <ProgressBar percent={percent} />
    </View>
  );
}

/** Flame badge shown once a habit reaches a 14-day streak. */
function StreakBadge({ streak }: { streak: number }) {
  if (streak < 14) {
    return null;
  }

  return (
    <View style={styles.streakBadge}>
      <Ionicons name="flame" size={12} color="#ff6b00" />
      <Text style={styles.streakBadgeText}>{streak}</Text>
    </View>
  );
}

function monthBounds(referenceDate: string): { start: string; end: string } {
  const [year, month] = referenceDate.split('-').map(Number);
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

export default function DashboardScreen() {
  const { signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [habits, setHabits] = useState<ActiveHabit[]>([]);
  const [streaks, setStreaks] = useState<HabitStreakItem[]>([]);
  const today = todayDateString();

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [nextGoals, nextMilestones, nextHabits] = await Promise.all([
        getGoals(),
        getMilestones(),
        getAllActiveHabits(),
      ]);

      const weekStart = getWeekStart(today);
      const weekEnd = addDays(weekStart, 6);
      const { start: monthStart, end: monthEnd } = monthBounds(today);
      const rangeStart = monthStart < weekStart ? monthStart : weekStart;
      const rangeEnd = monthEnd > weekEnd ? monthEnd : weekEnd;

      const [completionsByHabit, streakCounts] = await Promise.all([
        Promise.all(
          nextHabits.map(async (habit) => {
            const dates = await getCompletionsInRange(
              habit.id,
              rangeStart,
              rangeEnd,
            );
            return [habit.id, dates] as const;
          }),
        ),
        Promise.all(
          nextHabits.map(async (habit) => {
            const streak = await getStreakCount(habit.id);
            return [habit.id, streak] as const;
          }),
        ),
      ]);

      const completionMap = new Map(completionsByHabit);
      const streakMap = new Map(streakCounts);

      setGoals(nextGoals);
      setMilestones(nextMilestones);
      setHabits(
        nextHabits.map((habit) => ({
          ...habit,
          completionLog: completionMap.get(habit.id) ?? [],
          streakCount: streakMap.get(habit.id) ?? 0,
        })),
      );
      setStreaks(
        nextHabits.map((habit) => ({
          id: habit.id,
          title: habit.title,
          streak: streakMap.get(habit.id) ?? 0,
        })),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load dashboard.';
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [today]);

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

  const activeGoals = useMemo(
    () =>
      filterActive(goals).filter(
        (item) => existsByDate(item, today) && item.status !== 'done',
      ),
    [goals, today],
  );
  const doneGoals = useMemo(
    () =>
      filterActive(goals).filter(
        (item) => existsByDate(item, today) && item.status === 'done',
      ),
    [goals, today],
  );
  const activeMilestones = useMemo(
    () => filterActive(milestones).filter((item) => existsByDate(item, today)),
    [milestones, today],
  );

  const trackableItems = useMemo<TrackableItem[]>(
    () =>
      dashboardTrackableHabits(habits, today).map((habit) => ({
        id: habit.id,
        title: habit.title,
        completionLog: completionsInActiveRange(
          habit.completionLog,
          habit.createdDate,
          habit.startDate,
          habit.endDate,
        ),
        weeklyTarget: habit.weeklyTarget,
        isArchived: Boolean(habit.deletedAt),
      })),
    [habits, today],
  );

  if (loading && goals.length === 0 && habits.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.loadingState}>
          <ActivityIndicator color="#007aff" />
        </View>
      </SafeAreaView>
    );
  }

  if (loadError && goals.length === 0 && habits.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.loadingState}>
          <Text style={styles.errorText}>{loadError}</Text>
          <Pressable
            onPress={() => void loadDashboard()}
            style={({ pressed }) => [
              styles.retryButton,
              pressed && styles.pressed,
            ]}
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
            style={({ pressed }) => [
              styles.logoutButton,
              pressed && styles.pressed,
            ]}
            accessibilityLabel="Log out"
          >
            {signingOut ? (
              <ActivityIndicator size="small" color="#007aff" />
            ) : (
              <Ionicons name="log-out-outline" size={24} color="#007aff" />
            )}
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>Goals</Text>
        <View style={styles.sectionCard}>
          {activeGoals.length > 0 ? (
            activeGoals.map((goal, index) => {
              const progress = goalProgressPercent(goal.id, activeMilestones);

              return (
                <View
                  key={goal.id}
                  style={[
                    styles.goalRow,
                    index < activeGoals.length - 1 && styles.rowBorder,
                  ]}
                >
                  <View style={styles.goalHeader}>
                    <Text style={styles.goalTitle}>{goal.title}</Text>
                    <Text style={styles.goalPercent}>{progress}%</Text>
                  </View>
                  <ProgressBar percent={progress} />
                </View>
              );
            })
          ) : (
            <Text style={styles.emptyText}>No goals yet.</Text>
          )}
        </View>

        <Text style={styles.sectionTitle}>Done Goals</Text>
        <View style={styles.sectionCard}>
          {doneGoals.length > 0 ? (
            doneGoals.map((goal, index) => (
              <View
                key={goal.id}
                style={[
                  styles.goalRow,
                  index < doneGoals.length - 1 && styles.rowBorder,
                ]}
              >
                <Text style={[styles.goalTitle, styles.doneTitle]}>
                  {goal.title}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No done goals yet.</Text>
          )}
        </View>

        <Text style={styles.sectionTitle}>Habit Streaks</Text>
        <View style={styles.sectionCard}>
          {streaks.length > 0 ? (
            streaks.map((item, index) => (
              <View
                key={item.id}
                style={[
                  styles.streakRow,
                  index < streaks.length - 1 && styles.rowBorder,
                ]}
              >
                <Text style={styles.streakTitle}>
                  {item.title || 'Untitled habit'}
                </Text>
                <View style={styles.streakMeta}>
                  <StreakBadge streak={item.streak} />
                  <Text style={styles.streakCount}>
                    {item.streak} day{item.streak === 1 ? '' : 's'}
                  </Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No habits yet.</Text>
          )}
        </View>

        <Text style={styles.sectionTitle}>Weekly Progress</Text>
        <View style={styles.sectionCard}>
          {trackableItems.length > 0 ? (
            trackableItems.map((item, index) => (
              <View
                key={`weekly-${item.id}`}
                style={index < trackableItems.length - 1 && styles.rowBorder}
              >
                <ProgressRow
                  item={item}
                  percent={weeklyProgressPercent(
                    item.completionLog,
                    item.weeklyTarget,
                  )}
                  label={weeklyProgressLabel(
                    item.completionLog,
                    item.weeklyTarget,
                  )}
                />
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No habits yet.</Text>
          )}
        </View>

        <Text style={styles.sectionTitle}>Monthly Progress</Text>
        <View style={styles.sectionCard}>
          {trackableItems.length > 0 ? (
            trackableItems.map((item, index) => (
              <View
                key={`monthly-${item.id}`}
                style={index < trackableItems.length - 1 && styles.rowBorder}
              >
                <ProgressRow
                  item={item}
                  percent={monthlyProgressPercent(
                    item.completionLog,
                    item.weeklyTarget,
                  )}
                  label={monthlyProgressLabel(
                    item.completionLog,
                    item.weeklyTarget,
                  )}
                />
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No habits yet.</Text>
          )}
        </View>
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
    padding: 16,
    paddingBottom: 32,
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
    marginBottom: 16,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111',
  },
  logoutButton: {
    padding: 4,
    minWidth: 32,
    minHeight: 32,
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
    marginBottom: 8,
  },
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    overflow: 'hidden',
  },
  goalRow: {
    padding: 16,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
  },
  goalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
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
  goalPercent: {
    fontSize: 15,
    fontWeight: '600',
    color: '#007aff',
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
  progressRow: {
    padding: 16,
  },
  progressRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  progressRowTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#111',
    marginRight: 12,
  },
  archivedLabel: {
    fontSize: 13,
    fontWeight: '400',
    color: '#888',
  },
  progressRowPercent: {
    fontSize: 14,
    fontWeight: '600',
    color: '#007aff',
  },
  progressRowLabel: {
    fontSize: 12,
    color: '#888',
    marginBottom: 8,
  },
  streakRow: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  streakTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#111',
  },
  streakMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  streakCount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#007aff',
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
  emptyText: {
    padding: 16,
    fontSize: 14,
    color: '#aaa',
  },
});
