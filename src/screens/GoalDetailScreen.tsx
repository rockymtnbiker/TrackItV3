import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { ScrollView } from 'react-native-gesture-handler';
import { EditableOrderedRow } from '../components/EditableOrderedRow';
import {
  FormDateRow,
  FormDescriptionField,
  FormFieldRow,
  FormInlineInput,
  FormSelectRow,
  FormStatusSegment,
  PERIOD_OPTIONS,
} from '../components/FormFields';
import { deleteGoal, getGoals, setGoalStatus, updateGoal } from '../lib/goalsApi';
import {
  createHabit,
  deleteHabit,
  getHabitsForGoal,
  updateHabit,
} from '../lib/habitsApi';
import {
  createMilestone,
  deleteMilestone,
  getMilestonesForGoal,
  setMilestoneStatus,
  updateMilestone,
} from '../lib/milestonesApi';
import type { GoalsStackParamList } from '../navigation/GoalsStackNavigator';
import type {
  Goal,
  GoalCategory,
  GoalStatus,
  Habit,
  Milestone,
  TargetPeriod,
} from '../types';
import { GOAL_CATEGORIES, nextGoalStatus } from '../types';
import { formatOptionalDateRange } from '../utils/date';
import { withHabitSortOrder } from '../utils/habitDrafts';

type Props = NativeStackScreenProps<GoalsStackParamList, 'GoalDetail'>;

function parseOptionalTarget(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function withMilestoneSortOrder(steps: Milestone[]): Milestone[] {
  return steps.map((step, index) => ({ ...step, sortOrder: index }));
}

export default function GoalDetailScreen({ navigation, route }: Props) {
  const { goalId } = route.params;
  const headerHeight = useHeaderHeight();

  const [goal, setGoal] = useState<Goal | null>(null);
  const [goalLoading, setGoalLoading] = useState(true);
  const [goalError, setGoalError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<GoalCategory | ''>('');
  const [target, setTarget] = useState('');
  const [unit, setUnit] = useState('');
  const [period, setPeriod] = useState<TargetPeriod>('None');
  const [targetStartDate, setTargetStartDate] = useState('');
  const [targetEndDate, setTargetEndDate] = useState('');
  const [actualStartDate, setActualStartDate] = useState('');
  const [actualEndDate, setActualEndDate] = useState('');
  const [status, setStatus] = useState<GoalStatus>('active');
  const [deletingGoal, setDeletingGoal] = useState(false);

  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [newMilestoneTitle, setNewMilestoneTitle] = useState('');
  const [newHabitTitle, setNewHabitTitle] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState(0);

  const milestoneTitleTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const habitTitleTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const applyGoalToDraft = useCallback((next: Goal) => {
    setTitle(next.title);
    setDescription(next.description ?? '');
    setCategory(next.category ?? '');
    setTarget(next.target != null ? String(next.target) : '');
    setUnit(next.unit ?? '');
    setPeriod(next.period ?? 'None');
    setTargetStartDate(next.targetStartDate ?? '');
    setTargetEndDate(next.targetEndDate ?? '');
    setActualStartDate(next.actualStartDate ?? '');
    setActualEndDate(next.actualEndDate ?? '');
    setStatus(next.status);
  }, []);

  const loadLinkedItems = useCallback(async () => {
    try {
      const [nextMilestones, nextHabits] = await Promise.all([
        getMilestonesForGoal(goalId),
        getHabitsForGoal(goalId),
      ]);
      setMilestones(nextMilestones);
      setHabits(nextHabits);
    } catch (error) {
      console.warn('Failed to load milestones/habits', error);
    }
  }, [goalId]);

  const loadGoal = useCallback(async () => {
    setGoalLoading(true);
    setGoalError(null);
    try {
      const goals = await getGoals();
      const found = goals.find((item) => item.id === goalId) ?? null;
      setGoal(found);
      if (found) {
        applyGoalToDraft(found);
        await loadLinkedItems();
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load goal.';
      setGoalError(message);
      setGoal(null);
    } finally {
      setGoalLoading(false);
    }
  }, [applyGoalToDraft, goalId, loadLinkedItems]);

  useEffect(() => {
    void loadGoal();
  }, [loadGoal]);

  const draftRef = useRef({
    title,
    description,
    category,
    target,
    unit,
    period,
    targetStartDate,
    targetEndDate,
    actualStartDate,
    actualEndDate,
  });
  draftRef.current = {
    title,
    description,
    category,
    target,
    unit,
    period,
    targetStartDate,
    targetEndDate,
    actualStartDate,
    actualEndDate,
  };

  const milestonesListRef = useRef(milestones);
  milestonesListRef.current = milestones;
  const habitsListRef = useRef(habits);
  habitsListRef.current = habits;

  const persistGoal = useCallback(() => {
    if (!goal || deletingGoal) {
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

    void updateGoal(goalId, {
      title: trimmedTitle,
      description: draft.description.trim() || null,
      category: draft.category || null,
      target: optionalTarget ?? null,
      unit: optionalUnit ?? null,
      period: optionalPeriod ?? null,
      targetStartDate: draft.targetStartDate.trim() || null,
      targetEndDate: draft.targetEndDate.trim() || null,
      actualStartDate: draft.actualStartDate.trim() || null,
      actualEndDate: draft.actualEndDate.trim() || null,
    })
      .then((updated) => {
        setGoal(updated);
      })
      .catch((error) => {
        console.warn('Failed to save goal', error);
      });
  }, [deletingGoal, goal, goalId]);

  const applyGoalDates = (updated: Goal) => {
    setGoal(updated);
    setStatus(updated.status);
    setActualStartDate(updated.actualStartDate ?? '');
    setActualEndDate(updated.actualEndDate ?? '');
    setTargetStartDate(updated.targetStartDate ?? '');
    setTargetEndDate(updated.targetEndDate ?? '');
  };

  const handleStatusChange = (next: GoalStatus) => {
    setStatus(next);
    if (!goal || deletingGoal) {
      return;
    }
    void setGoalStatus(goalId, next)
      .then(applyGoalDates)
      .catch((error) => {
        console.warn('Failed to update goal status', error);
      });
  };

  const saveGoalDate = (
    field:
      | 'targetStartDate'
      | 'targetEndDate'
      | 'actualStartDate'
      | 'actualEndDate',
    value: string,
  ) => {
    if (!goal || deletingGoal) {
      return;
    }
    void updateGoal(goalId, { [field]: value.trim() || null })
      .then(applyGoalDates)
      .catch((error) => {
        console.warn('Failed to update goal date', error);
      });
  };

  const cycleMilestoneStatus = (milestone: Milestone) => {
    const next = nextGoalStatus(milestone.status);
    setMilestones((current) =>
      current.map((item) =>
        item.id === milestone.id ? { ...item, status: next } : item,
      ),
    );
    void setMilestoneStatus(milestone.id, next)
      .then((updated) => {
        setMilestones((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
      })
      .catch((error) => {
        console.warn('Failed to update milestone status', error);
        void loadLinkedItems();
      });
  };

  useEffect(() => {
    const unsubscribeBlur = navigation.addListener('blur', persistGoal);
    const unsubscribeRemove = navigation.addListener(
      'beforeRemove',
      persistGoal,
    );
    const unsubscribeFocus = navigation.addListener('focus', () => {
      void loadLinkedItems();
    });
    return () => {
      unsubscribeBlur();
      unsubscribeRemove();
      unsubscribeFocus();
    };
  }, [navigation, persistGoal, loadLinkedItems]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        persistGoal();
      }
    });
    return () => subscription.remove();
  }, [persistGoal]);

  useEffect(() => {
    return () => {
      for (const timer of milestoneTitleTimers.current.values()) {
        clearTimeout(timer);
      }
      for (const timer of habitTitleTimers.current.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: title.trim() || goal?.title || 'Goal',
      headerRight: undefined,
    });
  }, [goal?.title, navigation, title]);

  const persistMilestoneOrder = (ordered: Milestone[]) => {
    void Promise.all(
      ordered.map((item) =>
        updateMilestone(item.id, { sortOrder: item.sortOrder }),
      ),
    ).catch((error) => {
      console.warn('Failed to persist milestone order', error);
      void loadLinkedItems();
    });
  };

  const persistHabitOrder = (ordered: Habit[]) => {
    void Promise.all(
      ordered.map((item) => updateHabit(item.id, { sortOrder: item.sortOrder })),
    ).catch((error) => {
      console.warn('Failed to persist habit order', error);
      void loadLinkedItems();
    });
  };

  const reorderMilestones = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) {
      return;
    }
    setMilestones((current) => {
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      const ordered = withMilestoneSortOrder(next);
      persistMilestoneOrder(ordered);
      return ordered;
    });
  };

  const updateMilestoneTitle = (id: string, nextTitle: string) => {
    setMilestones((current) =>
      current.map((item) =>
        item.id === id ? { ...item, title: nextTitle } : item,
      ),
    );

    const existing = milestoneTitleTimers.current.get(id);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      milestoneTitleTimers.current.delete(id);
      const trimmed = nextTitle.trim();
      if (!trimmed) {
        return;
      }
      void updateMilestone(id, { title: trimmed }).catch((error) => {
        console.warn('Failed to save milestone title', error);
      });
    }, 400);
    milestoneTitleTimers.current.set(id, timer);
  };

  const removeMilestone = (id: string) => {
    const existing = milestoneTitleTimers.current.get(id);
    if (existing) {
      clearTimeout(existing);
      milestoneTitleTimers.current.delete(id);
    }

    setMilestones((current) => {
      const ordered = withMilestoneSortOrder(
        current.filter((item) => item.id !== id),
      );
      void deleteMilestone(id)
        .then(() => persistMilestoneOrder(ordered))
        .catch((error) => {
          console.warn('Failed to delete milestone', error);
          void loadLinkedItems();
        });
      return ordered;
    });
  };

  const confirmDeleteMilestone = (id: string) => {
    Alert.alert(
      'Delete Milestone',
      'Are you sure you want to delete this milestone? This will permanently remove all associated habits and results.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => removeMilestone(id),
        },
      ],
    );
  };

  const confirmDeleteGoal = () => {
    if (deletingGoal) {
      return;
    }
    Alert.alert(
      'Delete Goal',
      'Are you sure you want to delete this goal? This will permanently remove all associated milestones, habits, and results.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setDeletingGoal(true);
            void deleteGoal(goalId)
              .then(() => {
                navigation.navigate('GoalsList');
              })
              .catch((error) => {
                console.warn('Failed to delete goal', error);
                Alert.alert(
                  'Delete failed',
                  error instanceof Error
                    ? error.message
                    : 'Could not delete this goal.',
                );
              })
              .finally(() => {
                setDeletingGoal(false);
              });
          },
        },
      ],
    );
  };

  const addMilestone = () => {
    const trimmed = newMilestoneTitle.trim();
    if (!trimmed) {
      return;
    }
    const maxOrder = milestones.reduce(
      (max, item) => Math.max(max, item.sortOrder),
      -1,
    );
    setNewMilestoneTitle('');
    void createMilestone({
      goalId,
      title: trimmed,
      sortOrder: maxOrder + 1,
      status: 'active',
    })
      .then((created) => {
        setMilestones((current) => [...current, created]);
      })
      .catch((error) => {
        console.warn('Failed to create milestone', error);
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
      void deleteHabit(id)
        .then(() => persistHabitOrder(ordered))
        .catch((error) => {
          console.warn('Failed to delete habit', error);
          void loadLinkedItems();
        });
      return ordered;
    });
  };

  const confirmDeleteHabit = (id: string) => {
    Alert.alert(
      'Delete Habit',
      'Are you sure you want to delete this habit? This will permanently remove all associated results.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => removeHabit(id),
        },
      ],
    );
  };

  const addHabit = () => {
    const trimmed = newHabitTitle.trim();
    if (!trimmed) {
      return;
    }
    const maxOrder = habits.reduce(
      (max, item) => Math.max(max, item.sortOrder),
      -1,
    );
    setNewHabitTitle('');
    void createHabit({
      title: trimmed,
      goalId,
      milestoneId: null,
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

  const openMilestoneDetail = (milestoneId: string) => {
    persistGoal();
    navigation.navigate('MilestoneDetail', { milestoneId });
  };

  const openHabitDetail = (habitId: string) => {
    persistGoal();
    navigation.navigate('HabitDetail', { habitId });
  };

  if (goalLoading) {
    return (
      <View style={styles.missing}>
        <ActivityIndicator color="#007aff" />
      </View>
    );
  }

  if (goalError) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingText}>{goalError}</Text>
        <Pressable
          onPress={() => void loadGoal()}
          style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
        >
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!goal) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingText}>This goal is no longer available.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}
    >
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
          <FormDescriptionField
            value={description}
            onChangeText={setDescription}
          />
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
          <FormDateRow
            label="Target Start Date"
            value={targetStartDate}
            labelWidth={118}
            onChange={(value) => {
              setTargetStartDate(value);
              saveGoalDate('targetStartDate', value);
            }}
          />
          <FormDateRow
            label="Target End Date"
            value={targetEndDate}
            labelWidth={118}
            onChange={(value) => {
              setTargetEndDate(value);
              saveGoalDate('targetEndDate', value);
            }}
          />
          <FormDateRow
            label="Actual Start Date"
            value={actualStartDate}
            labelWidth={118}
            onChange={(value) => {
              setActualStartDate(value);
              saveGoalDate('actualStartDate', value);
            }}
          />
          <FormDateRow
            label="Actual End Date"
            value={actualEndDate}
            labelWidth={118}
            onChange={(value) => {
              setActualEndDate(value);
              saveGoalDate('actualEndDate', value);
            }}
          />
          <FormFieldRow label="Status">
            <FormStatusSegment value={status} onChange={handleStatusChange} />
          </FormFieldRow>
        </View>
      </View>

      <Text style={styles.sectionPrompt}>
        What milestones will get you there?
      </Text>
      <View style={styles.sectionCard}>
        {milestones.length === 0 ? (
          <Text style={styles.emptyText}>No milestones yet.</Text>
        ) : (
          milestones.map((milestone, index) => (
            <EditableOrderedRow
              key={milestone.id}
              title={milestone.title}
              subtitle={formatOptionalDateRange(
                milestone.targetStartDate,
                milestone.targetEndDate,
              )}
              status={milestone.status}
              onStatusPress={() => cycleMilestoneStatus(milestone)}
              index={index}
              isDragging={draggingId === milestone.id}
              dragOffsetY={draggingId === milestone.id ? dragOffsetY : 0}
              titlePlaceholder="Milestone title"
              openAccessibilityLabel="Open milestone"
              deleteAccessibilityLabel="Delete milestone"
              swipeToDelete
              onTitleChange={(text) =>
                updateMilestoneTitle(milestone.id, text)
              }
              onOpen={() => openMilestoneDetail(milestone.id)}
              onDelete={() => confirmDeleteMilestone(milestone.id)}
              onDragStart={() => {
                setDraggingId(milestone.id);
                setDragOffsetY(0);
              }}
              onDragMove={setDragOffsetY}
              onDragEnd={(from, to) => {
                const clampedTo = Math.max(
                  0,
                  Math.min(milestonesListRef.current.length - 1, to),
                );
                reorderMilestones(from, clampedTo);
                setDraggingId(null);
                setDragOffsetY(0);
              }}
            />
          ))
        )}

        <View style={styles.addRow}>
          <TextInput
            style={styles.addInput}
            value={newMilestoneTitle}
            onChangeText={setNewMilestoneTitle}
            placeholder="+ Add a milestone"
            onSubmitEditing={addMilestone}
            returnKeyType="done"
          />
          <Pressable
            onPress={addMilestone}
            style={({ pressed }) => [
              styles.addButton,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="add" size={22} color="#007aff" />
          </Pressable>
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
              parentTitle={title.trim() || undefined}
              index={index}
              isDragging={draggingId === habit.id}
              dragOffsetY={draggingId === habit.id ? dragOffsetY : 0}
              titlePlaceholder="Habit title"
              openAccessibilityLabel="Open habit"
              deleteAccessibilityLabel="Delete habit"
              swipeToDelete
              onTitleChange={(text) => updateHabitTitleLocal(habit.id, text)}
              onOpen={() => openHabitDetail(habit.id)}
              onDelete={() => confirmDeleteHabit(habit.id)}
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

      <Pressable
        onPress={confirmDeleteGoal}
        disabled={deletingGoal}
        style={({ pressed }) => [
          styles.deleteButton,
          pressed && styles.pressed,
          deletingGoal && styles.deleteButtonDisabled,
        ]}
      >
        {deletingGoal ? (
          <ActivityIndicator color="#c62828" />
        ) : (
          <Text style={styles.deleteButtonText}>Delete Goal</Text>
        )}
      </Pressable>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f2f2f7',
  },
  content: {
    padding: 12,
    paddingBottom: 28,
    gap: 8,
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
    padding: 10,
    gap: 4,
    overflow: 'visible',
  },
  fields: {
    gap: 6,
  },
  sectionPrompt: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginTop: 4,
    marginBottom: 0,
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
    marginTop: 4,
  },
  addInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    minHeight: 44,
  },
  addButton: {
    padding: 6,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButton: {
    marginTop: 4,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ffcdd2',
  },
  deleteButtonDisabled: {
    opacity: 0.6,
  },
  deleteButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#c62828',
  },
  pressed: {
    opacity: 0.7,
  },
});
