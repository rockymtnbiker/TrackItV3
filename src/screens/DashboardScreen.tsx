import { useMemo } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppData } from '../context/AppDataContext';
import {
  dashboardTrackableActivities,
  dashboardTrackableHabits,
  filterActive,
} from '../utils/activeItems';
import {
  DAILY_HABIT_WEEKLY_TARGET,
  monthlyProgressLabel,
  monthlyProgressPercent,
  objectiveProgressPercent,
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
  type: 'dailyHabit' | 'keyActivity';
  completionLog: string[];
  weeklyTarget: number;
  isArchived: boolean;
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

export default function DashboardScreen() {
  const { objectives, keyResults, dailyHabits, keyActivities } = useAppData();

  const activeObjectives = useMemo(
    () => filterActive(objectives),
    [objectives],
  );
  const activeKeyResults = useMemo(
    () => filterActive(keyResults),
    [keyResults],
  );

  const trackableItems = useMemo<TrackableItem[]>(() => {
    const habits: TrackableItem[] = dashboardTrackableHabits(dailyHabits).map(
      (habit) => ({
        id: habit.id,
        title: habit.title,
        type: 'dailyHabit',
        completionLog: habit.completionLog,
        weeklyTarget: DAILY_HABIT_WEEKLY_TARGET,
        isArchived: Boolean(habit.deletedAt),
      }),
    );

    const activities: TrackableItem[] = dashboardTrackableActivities(
      keyActivities,
    ).map((activity) => ({
      id: activity.id,
      title: activity.title,
      type: 'keyActivity',
      completionLog: activity.completionLog,
      weeklyTarget: activity.weeklyTarget,
      isArchived: Boolean(activity.deletedAt),
    }));

    return [...habits, ...activities];
  }, [dailyHabits, keyActivities]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.screenTitle}>Dashboard</Text>

        <Text style={styles.sectionTitle}>Objectives</Text>
        <View style={styles.sectionCard}>
          {activeObjectives.length > 0 ? (
            activeObjectives.map((objective, index) => {
              const progress = objectiveProgressPercent(
                objective.id,
                activeKeyResults,
              );

              return (
                <View
                  key={objective.id}
                  style={[
                    styles.objectiveRow,
                    index < activeObjectives.length - 1 && styles.rowBorder,
                  ]}
                >
                  <View style={styles.objectiveHeader}>
                    <Text style={styles.objectiveTitle}>{objective.title}</Text>
                    <Text style={styles.objectivePercent}>{progress}%</Text>
                  </View>
                  <ProgressBar percent={progress} />
                </View>
              );
            })
          ) : (
            <Text style={styles.emptyText}>No objectives yet.</Text>
          )}
        </View>

        <Text style={styles.sectionTitle}>Weekly Progress</Text>
        <View style={styles.sectionCard}>
          {trackableItems.length > 0 ? (
            trackableItems.map((item, index) => (
              <View
                key={`weekly-${item.type}-${item.id}`}
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
            <Text style={styles.emptyText}>
              No daily habits or key activities yet.
            </Text>
          )}
        </View>

        <Text style={styles.sectionTitle}>Monthly Progress</Text>
        <View style={styles.sectionCard}>
          {trackableItems.length > 0 ? (
            trackableItems.map((item, index) => (
              <View
                key={`monthly-${item.type}-${item.id}`}
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
            <Text style={styles.emptyText}>
              No daily habits or key activities yet.
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f4f4f6',
  },
  container: {
    flex: 1,
    backgroundColor: '#f4f4f6',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111',
    marginBottom: 12,
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
  objectiveRow: {
    padding: 16,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
  },
  objectiveHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  objectiveTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#111',
    marginRight: 12,
  },
  objectivePercent: {
    fontSize: 15,
    fontWeight: '600',
    color: '#007aff',
  },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ececf0',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: '#007aff',
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
    color: '#222',
    marginRight: 12,
  },
  archivedLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#999',
  },
  progressRowPercent: {
    fontSize: 15,
    fontWeight: '600',
    color: '#007aff',
  },
  progressRowLabel: {
    fontSize: 13,
    color: '#888',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 15,
    color: '#666',
    padding: 20,
    textAlign: 'center',
  },
});
