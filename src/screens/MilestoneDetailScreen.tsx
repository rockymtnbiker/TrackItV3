import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { EditableOrderedRow } from '../components/EditableOrderedRow';
import {
  FormDateRow,
  FormFieldRow,
  FormInlineInput,
  FormSelectRow,
  PERIOD_OPTIONS,
} from '../components/FormFields';
import {
  createHabit,
  getHabitsForMilestone,
  softDeleteHabit,
  updateHabit,
} from '../lib/habitsApi';
import {
  getMilestone,
  updateMilestone,
} from '../lib/milestonesApi';
import type { GoalsStackParamList } from '../navigation/GoalsStackNavigator';
import type {
  GoalCategory,
  Habit,
  Milestone,
  TargetPeriod,
} from '../types';
import { GOAL_CATEGORIES } from '../types';
import { withHabitSortOrder } from '../utils/habitDrafts';

type Props = NativeStackScreenProps<GoalsStackParamList, 'MilestoneDetail'>;

function parseOptionalTarget(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export default function MilestoneDetailScreen({ navigation, route }: Props) {
  const { milestoneId } = route.params;

  const [milestone, setMilestone] = useState<Milestone | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<GoalCategory | ''>('');
  const [target, setTarget] = useState('');
  const [unit, setUnit] = useState('');
  const [period, setPeriod] = useState<TargetPeriod>('None');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [habits, setHabits] = useState<Habit[]>([]);
  const [newHabitTitle, setNewHabitTitle] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState(0);

  const habitTitleTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const applyMilestoneToDraft = useCallback((next: Milestone) => {
    setTitle(next.title);
    setCategory(next.category ?? '');
    setTarget(next.target != null ? String(next.target) : '');
    setUnit(next.unit ?? '');
    setPeriod(next.period ?? 'None');
    setStartDate(next.startDate ?? '');
    setEndDate(next.endDate ?? '');
  }, []);

  const loadHabits = useCallback(async () => {
    try {
      const nextHabits = await getHabitsForMilestone(milestoneId);
      setHabits(nextHabits);
    } catch (error) {
      console.warn('Failed to load milestone habits', error);
    }
  }, [milestoneId]);

  const loadMilestone = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const found = await getMilestone(milestoneId);
      setMilestone(found);
      if (found) {
        applyMilestoneToDraft(found);
        await loadHabits();
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load milestone.';
      setLoadError(message);
      setMilestone(null);
    } finally {
      setLoading(false);
    }
  }, [applyMilestoneToDraft, loadHabits, milestoneId]);

  useEffect(() => {
    void loadMilestone();
  }, [loadMilestone]);

  const draftRef = useRef({
    title,
    category,
    target,
    unit,
    period,
    startDate,
    endDate,
  });
  draftRef.current = {
    title,
    category,
    target,
    unit,
    period,
    startDate,
    endDate,
  };

  const habitsListRef = useRef(habits);
  habitsListRef.current = habits;

  const persistMilestone = useCallback(() => {
    if (!milestone) {
      return;
    }

    const draft = draftRef.current;
    const trimmedTitle = draft.title.trim();
    if (!trimmedTitle) {
      return;
    }

    const optionalTarget = parseOptionalTarget(draft.target);
    const optionalUnit = draft.unit.trim() || undefined;
    const optionalPeriod: TargetPeriod | undefined =
      optionalTarget != null ? draft.period : undefined;
    const optionalStart = draft.startDate.trim() || null;
    const optionalEnd = draft.endDate.trim() || null;

    void updateMilestone(milestoneId, {
      title: trimmedTitle,
      category: draft.category || null,
      target: optionalTarget ?? null,
      unit: optionalUnit ?? null,
      period: optionalPeriod ?? null,
      startDate: optionalStart,
      endDate: optionalEnd,
    })
      .then((updated) => {
        setMilestone(updated);
      })
      .catch((error) => {
        console.warn('Failed to save milestone', error);
      });
  }, [milestone, milestoneId]);

  useEffect(() => {
    const unsubscribeBlur = navigation.addListener('blur', persistMilestone);
    const unsubscribeRemove = navigation.addListener(
      'beforeRemove',
      persistMilestone,
    );
    const unsubscribeFocus = navigation.addListener('focus', () => {
      void loadHabits();
    });
    return () => {
      unsubscribeBlur();
      unsubscribeRemove();
      unsubscribeFocus();
    };
  }, [navigation, persistMilestone, loadHabits]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        persistMilestone();
      }
    });
    return () => subscription.remove();
  }, [persistMilestone]);

  useEffect(() => {
    return () => {
      for (const timer of habitTitleTimers.current.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: title.trim() || milestone?.title || 'Milestone',
    });
  }, [milestone?.title, navigation, title]);

  const persistHabitOrder = (ordered: Habit[]) => {
    void Promise.all(
      ordered.map((item) => updateHabit(item.id, { sortOrder: item.sortOrder })),
    ).catch((error) => {
      console.warn('Failed to persist habit order', error);
      void loadHabits();
    });
  };

  const reorderHabits = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) {
      return;
    }
    setHabits((current) => {
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      const ordered = withHabitSortOrder(next);
      persistHabitOrder(ordered);
      return ordered;
    });
  };

  const updateHabitTitleLocal = (id: string, nextTitle: string) => {
    setHabits((current) =>
      current.map((item) =>
        item.id === id ? { ...item, title: nextTitle } : item,
      ),
    );

    const existing = habitTitleTimers.current.get(id);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      habitTitleTimers.current.delete(id);
      const trimmed = nextTitle.trim();
      if (!trimmed) {
        return;
      }
      void updateHabit(id, { title: trimmed }).catch((error) => {
        console.warn('Failed to save habit title', error);
      });
    }, 400);
    habitTitleTimers.current.set(id, timer);
  };

  const removeHabit = (id: string) => {
    const existing = habitTitleTimers.current.get(id);
    if (existing) {
      clearTimeout(existing);
      habitTitleTimers.current.delete(id);
    }

    setHabits((current) => {
      const ordered = withHabitSortOrder(
        current.filter((item) => item.id !== id),
      );
      void softDeleteHabit(id)
        .then(() => persistHabitOrder(ordered))
        .catch((error) => {
          console.warn('Failed to delete habit', error);
          void loadHabits();
        });
      return ordered;
    });
  };

  const addHabit = () => {
    const trimmed = newHabitTitle.trim();
    if (!trimmed || !milestone) {
      return;
    }
    const maxOrder = habits.reduce(
      (max, item) => Math.max(max, item.sortOrder),
      -1,
    );
    setNewHabitTitle('');
    void createHabit({
      title: trimmed,
      goalId: milestone.goalId,
      milestoneId,
      sortOrder: maxOrder + 1,
      status: 'active',
    })
      .then((created) => {
        setHabits((current) => [...current, created]);
      })
      .catch((error) => {
        console.warn('Failed to create habit', error);
      });
  };

  const openHabitDetail = (habitId: string) => {
    persistMilestone();
    navigation.navigate('HabitDetail', { habitId });
  };

  if (loading) {
    return (
      <View style={styles.missing}>
        <ActivityIndicator color="#007aff" />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingText}>{loadError}</Text>
        <Pressable
          onPress={() => void loadMilestone()}
          style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
        >
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!milestone) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingText}>
          This milestone is no longer available.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      scrollEnabled={draggingId == null}
    >
      <View style={styles.sectionCard}>
        <View style={styles.fields}>
          <FormFieldRow label="Title">
            <FormInlineInput
              value={title}
              onChangeText={setTitle}
              placeholder="Enter title"
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
            onChange={(value) => setCategory((value as GoalCategory) || '')}
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
            onChange={(value) => setPeriod((value as TargetPeriod) || 'None')}
          />
          <FormDateRow label="Start" value={startDate} onChange={setStartDate} />
          <FormDateRow label="End" value={endDate} onChange={setEndDate} />
        </View>
      </View>

      <Text style={styles.sectionPrompt}>Habits</Text>
      <View style={styles.sectionCard}>
        {habits.length === 0 ? (
          <Text style={styles.emptyText}>No habits yet.</Text>
        ) : (
          habits.map((habit, index) => (
            <EditableOrderedRow
              key={habit.id}
              title={habit.title}
              index={index}
              isDragging={draggingId === habit.id}
              dragOffsetY={draggingId === habit.id ? dragOffsetY : 0}
              titlePlaceholder="Habit title"
              openAccessibilityLabel="Open habit"
              deleteAccessibilityLabel="Remove habit"
              onTitleChange={(text) => updateHabitTitleLocal(habit.id, text)}
              onOpen={() => openHabitDetail(habit.id)}
              onDelete={() => removeHabit(habit.id)}
              onDragStart={() => {
                setDraggingId(habit.id);
                setDragOffsetY(0);
              }}
              onDragMove={setDragOffsetY}
              onDragEnd={(from, to) => {
                const clampedTo = Math.max(
                  0,
                  Math.min(habitsListRef.current.length - 1, to),
                );
                reorderHabits(from, clampedTo);
                setDraggingId(null);
                setDragOffsetY(0);
              }}
            />
          ))
        )}

        <View style={styles.addRow}>
          <TextInput
            style={styles.addInput}
            value={newHabitTitle}
            onChangeText={setNewHabitTitle}
            placeholder="+ Add a habit"
            onSubmitEditing={addHabit}
            returnKeyType="done"
          />
          <Pressable
            onPress={addHabit}
            style={({ pressed }) => [
              styles.addButton,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="add" size={22} color="#007aff" />
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f2f2f7',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 12,
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
    backgroundColor: '#f2f2f7',
  },
  missingText: {
    fontSize: 16,
    color: '#666',
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
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  fields: {
    gap: 10,
  },
  sectionPrompt: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginTop: 8,
    marginBottom: 2,
  },
  emptyText: {
    fontSize: 14,
    color: '#aaa',
    fontStyle: 'italic',
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  addInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  addButton: {
    padding: 6,
  },
  pressed: {
    opacity: 0.7,
  },
});
