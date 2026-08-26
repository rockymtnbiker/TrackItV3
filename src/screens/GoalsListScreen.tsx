import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Pressable, ScrollView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DraggableItem } from '../components/DraggableItem';
import {
  FormDateRow,
  FormFieldRow,
  FormInlineInput,
  FormSelectRow,
  PERIOD_OPTIONS,
} from '../components/FormFields';
import { createGoal as createGoalApi, getGoals, updateGoal } from '../lib/goalsApi';
import {
  createHabit as createHabitApi,
  getStandaloneHabits,
  updateHabit,
} from '../lib/habitsApi';
import type { GoalsStackParamList } from '../navigation/GoalsStackNavigator';
import type {
  Goal,
  GoalCategory,
  GoalStatus,
  Habit,
  TargetPeriod,
} from '../types';
import { GOAL_CATEGORIES } from '../types';
import { formatDate, todayDateString } from '../utils/date';
import { withGoalSortOrder, withHabitSortOrder } from '../utils/habitDrafts';

type Props = NativeStackScreenProps<GoalsStackParamList, 'GoalsList'>;

/** Approximate Goal/Habit card height (padding + title + meta + margin). */
const LIST_CARD_HEIGHT = 84;

function parseOptionalTarget(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function cycleGoalStatus(status: GoalStatus): GoalStatus {
  return status === 'active' ? 'done' : 'active';
}

export default function GoalsListScreen({ navigation }: Props) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [goalsLoading, setGoalsLoading] = useState(true);
  const [habitsLoading, setHabitsLoading] = useState(true);
  const [goalsError, setGoalsError] = useState<string | null>(null);
  const [habitsError, setHabitsError] = useState<string | null>(null);
  const [creatingGoal, setCreatingGoal] = useState(false);
  const [creatingHabit, setCreatingHabit] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [typePickerVisible, setTypePickerVisible] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<GoalCategory | ''>('');
  const [target, setTarget] = useState('');
  const [unit, setUnit] = useState('');
  const [period, setPeriod] = useState<TargetPeriod>('None');
  const [startDate, setStartDate] = useState(todayDateString());
  const [endDate, setEndDate] = useState('');
  const [status, setStatus] = useState<GoalStatus>('active');
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const loadGoals = useCallback(async () => {
    setGoalsLoading(true);
    setGoalsError(null);
    try {
      const next = await getGoals();
      setGoals(next);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load goals.';
      setGoalsError(message);
    } finally {
      setGoalsLoading(false);
    }
  }, []);

  const loadHabits = useCallback(async () => {
    setHabitsLoading(true);
    setHabitsError(null);
    try {
      const next = await getStandaloneHabits();
      setHabits(next);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load habits.';
      setHabitsError(message);
    } finally {
      setHabitsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadGoals();
      void loadHabits();
    }, [loadGoals, loadHabits]),
  );

  const visibleGoals = useMemo(
    () =>
      goals
        .filter((goal) => !goal.deletedAt && goal.status !== 'done')
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [goals],
  );

  const visibleHabits = useMemo(
    () =>
      habits
        .filter((habit) => !habit.deletedAt && habit.status !== 'done')
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [habits],
  );
  const goalsListRef = useRef(visibleGoals);
  goalsListRef.current = visibleGoals;
  const habitsListRef = useRef(visibleHabits);
  habitsListRef.current = visibleHabits;

  const openTypePicker = () => setTypePickerVisible(true);

  const openCreateGoal = () => {
    setTypePickerVisible(false);
    setTitle('');
    setCategory('');
    setTarget('');
    setUnit('');
    setPeriod('None');
    setStartDate(todayDateString());
    setEndDate('');
    setStatus('active');
    setCreateError(null);
    setCreateVisible(true);
  };

  const handleCreateGoal = async () => {
    if (!title.trim() || !startDate.trim() || !endDate.trim() || creatingGoal) {
      return;
    }

    const optionalTarget = parseOptionalTarget(target);
    const maxOrder = visibleGoals.reduce(
      (max, goal) => Math.max(max, goal.sortOrder),
      -1,
    );

    setCreatingGoal(true);
    setCreateError(null);
    try {
      const created = await createGoalApi({
        title: title.trim(),
        sortOrder: maxOrder + 1,
        startDate: startDate.trim(),
        endDate: endDate.trim(),
        category: category || undefined,
        target: optionalTarget,
        unit: unit.trim() || undefined,
        period: optionalTarget != null ? period : undefined,
        status,
      });
      setCreateVisible(false);
      await loadGoals();
      navigation.navigate('GoalDetail', { goalId: created.id });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to create goal.';
      setCreateError(message);
    } finally {
      setCreatingGoal(false);
    }
  };

  const createHabitFromPicker = async () => {
    if (creatingHabit) {
      return;
    }
    setTypePickerVisible(false);
    const maxOrder = visibleHabits.reduce(
      (max, item) => Math.max(max, item.sortOrder),
      -1,
    );
    setCreatingHabit(true);
    try {
      const created = await createHabitApi({
        title: '',
        goalId: null,
        milestoneId: null,
        sortOrder: maxOrder + 1,
        status: 'active',
      });
      setHabits((current) => [...current, created]);
      navigation.navigate('HabitDetail', { habitId: created.id });
    } catch (error) {
      console.warn('Failed to create habit', error);
      void loadHabits();
    } finally {
      setCreatingHabit(false);
    }
  };

  const reorderGoals = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) {
      return;
    }
    const ordered = [...visibleGoals];
    const [moved] = ordered.splice(fromIndex, 1);
    ordered.splice(toIndex, 0, moved);
    const withOrder = withGoalSortOrder(ordered);
    setGoals((current) => {
      const byId = new Map(withOrder.map((item) => [item.id, item]));
      return current.map((item) => byId.get(item.id) ?? item);
    });
    void Promise.all(
      withOrder.map((goal) =>
        updateGoal(goal.id, { sortOrder: goal.sortOrder }),
      ),
    ).catch((error) => {
      console.warn('Failed to persist goal order', error);
      void loadGoals();
    });
  };

  const reorderHabits = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) {
      return;
    }
    const ordered = [...visibleHabits];
    const [moved] = ordered.splice(fromIndex, 1);
    ordered.splice(toIndex, 0, moved);
    const withOrder = withHabitSortOrder(ordered);
    setHabits((current) => {
      const byId = new Map(withOrder.map((item) => [item.id, item]));
      return current.map((item) => byId.get(item.id) ?? item);
    });
    void Promise.all(
      withOrder.map((habit) =>
        updateHabit(habit.id, { sortOrder: habit.sortOrder }),
      ),
    ).catch((error) => {
      console.warn('Failed to persist habit order', error);
      void loadHabits();
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={draggingId == null}
      >
        <View style={styles.headerRow}>
          <Text style={styles.sectionHeader}>Goals</Text>
          <Pressable
            onPress={openTypePicker}
            style={({ pressed }) => [
              styles.addButton,
              pressed && styles.pressed,
            ]}
            accessibilityLabel="Add goal or habit"
          >
            <Ionicons name="add" size={32} color="#111" />
          </Pressable>
        </View>

        {goalsLoading ? (
          <View style={styles.goalsStatus}>
            <ActivityIndicator color="#007aff" />
          </View>
        ) : goalsError ? (
          <View style={styles.goalsStatus}>
            <Text style={styles.errorText}>{goalsError}</Text>
            <Pressable
              onPress={() => void loadGoals()}
              style={({ pressed }) => [
                styles.retryButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          </View>
        ) : visibleGoals.length === 0 ? (
          <Text style={styles.emptyText}>
            No goals yet. Tap + to create one.
          </Text>
        ) : (
          visibleGoals.map((goal, index) => (
            <DraggableItem
              key={goal.id}
              index={index}
              itemHeight={LIST_CARD_HEIGHT}
              onPress={() =>
                navigation.navigate('GoalDetail', { goalId: goal.id })
              }
              onDragStart={() => setDraggingId(goal.id)}
              onDragMove={() => {}}
              onDragEnd={(from, to) => {
                const clampedTo = Math.max(
                  0,
                  Math.min(goalsListRef.current.length - 1, to),
                );
                reorderGoals(from, clampedTo);
                setDraggingId(null);
              }}
              style={styles.card}
            >
              <Text style={styles.cardTitle}>{goal.title}</Text>
              <Text style={styles.cardMeta}>
                {formatDate(goal.startDate)} – {formatDate(goal.endDate)}
                {goal.category ? ` · ${goal.category}` : ''}
              </Text>
            </DraggableItem>
          ))
        )}

        <Text style={[styles.sectionHeader, styles.habitsHeader]}>Habits</Text>

        {habitsLoading ? (
          <View style={styles.goalsStatus}>
            <ActivityIndicator color="#007aff" />
          </View>
        ) : habitsError ? (
          <View style={styles.goalsStatus}>
            <Text style={styles.errorText}>{habitsError}</Text>
            <Pressable
              onPress={() => void loadHabits()}
              style={({ pressed }) => [
                styles.retryButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          </View>
        ) : visibleHabits.length === 0 ? (
          <Text style={styles.emptyText}>No standalone habits yet.</Text>
        ) : (
          visibleHabits.map((habit, index) => (
            <DraggableItem
              key={habit.id}
              index={index}
              itemHeight={LIST_CARD_HEIGHT}
              onPress={() =>
                navigation.navigate('HabitDetail', { habitId: habit.id })
              }
              onDragStart={() => setDraggingId(habit.id)}
              onDragMove={() => {}}
              onDragEnd={(from, to) => {
                const clampedTo = Math.max(
                  0,
                  Math.min(habitsListRef.current.length - 1, to),
                );
                reorderHabits(from, clampedTo);
                setDraggingId(null);
              }}
              style={styles.card}
            >
              <Text style={styles.cardTitle}>
                {habit.title || 'Untitled habit'}
              </Text>
            </DraggableItem>
          ))
        )}
      </ScrollView>

      <Modal
        visible={typePickerVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setTypePickerVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setTypePickerVisible(false)}
        >
          <Pressable style={styles.typePickerCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Add</Text>
            <Pressable
              onPress={openCreateGoal}
              style={({ pressed }) => [
                styles.typeOption,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.typeOptionText}>Goal</Text>
            </Pressable>
            <Pressable
              onPress={() => void createHabitFromPicker()}
              disabled={creatingHabit}
              style={({ pressed }) => [
                styles.typeOption,
                pressed && styles.pressed,
              ]}
            >
              {creatingHabit ? (
                <ActivityIndicator color="#007aff" />
              ) : (
                <Text style={styles.typeOptionText}>Habit</Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => setTypePickerVisible(false)}
              style={styles.modalButtonSecondary}
            >
              <Text style={styles.modalButtonSecondaryText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={createVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setCreateVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <ScrollView
            contentContainerStyle={styles.modalScroll}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Add Goal</Text>
              <View style={styles.fields}>
                <FormFieldRow label="Title">
                  <FormInlineInput
                    value={title}
                    onChangeText={setTitle}
                    placeholder="Enter title"
                    autoFocus
                  />
                </FormFieldRow>
                <FormSelectRow
                  label="Category"
                  value={category}
                  placeholder="Optional"
                  options={[
                    { value: '', label: 'None' },
                    ...GOAL_CATEGORIES.map((entry) => ({
                      value: entry,
                      label: entry,
                    })),
                  ]}
                  onChange={(value) =>
                    setCategory((value as GoalCategory) || '')
                  }
                />
                <FormFieldRow label="Target">
                  <FormInlineInput
                    value={target}
                    onChangeText={setTarget}
                    placeholder="Optional"
                    keyboardType="numeric"
                  />
                </FormFieldRow>
                <FormFieldRow label="Unit">
                  <FormInlineInput
                    value={unit}
                    onChangeText={setUnit}
                    placeholder="e.g. miles, runs"
                  />
                </FormFieldRow>
                <FormSelectRow
                  label="Period"
                  value={period}
                  placeholder="None"
                  options={PERIOD_OPTIONS}
                  onChange={(value) =>
                    setPeriod((value as TargetPeriod) || 'None')
                  }
                />
                <FormDateRow
                  label="Start"
                  value={startDate}
                  onChange={setStartDate}
                />
                <FormDateRow label="End" value={endDate} onChange={setEndDate} />
                <FormFieldRow label="Status">
                  <Pressable
                    onPress={() =>
                      setStatus((current) => cycleGoalStatus(current))
                    }
                    style={({ pressed }) => [
                      styles.statusChip,
                      status === 'active' && styles.statusChipActive,
                      status === 'done' && styles.statusChipDone,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.statusChipText}>{status}</Text>
                  </Pressable>
                </FormFieldRow>
              </View>

              {createError ? (
                <Text style={styles.errorText}>{createError}</Text>
              ) : null}

              <View style={styles.modalActions}>
                <Pressable
                  onPress={() => setCreateVisible(false)}
                  style={styles.modalButtonSecondary}
                >
                  <Text style={styles.modalButtonSecondaryText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => void handleCreateGoal()}
                  disabled={
                    creatingGoal ||
                    !title.trim() ||
                    !startDate.trim() ||
                    !endDate.trim()
                  }
                  style={[
                    styles.modalButtonPrimary,
                    (creatingGoal ||
                      !title.trim() ||
                      !startDate.trim() ||
                      !endDate.trim()) &&
                      styles.modalButtonDisabled,
                  ]}
                >
                  {creatingGoal ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.modalButtonPrimaryText}>Create</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#f2f2f7',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sectionHeader: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111',
  },
  habitsHeader: {
    marginTop: 24,
    marginBottom: 16,
  },
  addButton: {
    padding: 4,
  },
  emptyText: {
    fontSize: 15,
    color: '#888',
  },
  goalsStatus: {
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 8,
  },
  errorText: {
    fontSize: 14,
    color: '#c62828',
    marginTop: 8,
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
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111',
    marginBottom: 4,
  },
  cardMeta: {
    fontSize: 13,
    color: '#666',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
  },
  modalScroll: {
    padding: 20,
    justifyContent: 'center',
    flexGrow: 1,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
  },
  typePickerCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginHorizontal: 40,
    gap: 8,
  },
  typeOption: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#f5f5f7',
  },
  typeOptionText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#111',
    textAlign: 'center',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
    color: '#111',
  },
  fields: {
    gap: 10,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  },
  modalButtonSecondary: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
    alignSelf: 'flex-end',
    marginTop: 4,
  },
  modalButtonSecondaryText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#555',
  },
  modalButtonPrimary: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#007aff',
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalButtonDisabled: {
    backgroundColor: '#a8c8f0',
  },
  modalButtonPrimaryText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  statusChip: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#eee',
  },
  statusChipActive: {
    backgroundColor: '#e3f2fd',
  },
  statusChipDone: {
    backgroundColor: '#e8f5e9',
  },
  statusChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    textTransform: 'lowercase',
  },
  pressed: {
    opacity: 0.7,
  },
});
