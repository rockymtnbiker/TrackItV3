import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import SwipeableRow from '../components/SwipeableRow';
import {
  keyResultsForObjective,
  linkedActivitiesForKeyResult,
  linkedActivitiesForObjective,
  linkedHabitsForKeyResult,
  linkedHabitsForObjective,
  useAppData,
} from '../context/AppDataContext';
import type {
  DailyHabit,
  KeyActivity,
  KeyResult,
  LinkedGoalType,
  MoveTarget,
  Objective,
  Weekday,
} from '../types';
import {
  countKeyResultDependents,
  countObjectiveDependents,
} from '../utils/activeItems';
import {
  formatDate,
  formatScheduledDays,
  todayDateString,
  WEEKDAY_SHORT_LABELS,
  WEEKDAYS,
} from '../utils/date';
import {
  detectDateRangeConflicts,
  formatDateRangeConflictMessage,
} from '../utils/dateRange';
import { calculateStreak } from '../utils/streak';
import {
  createId,
  getFormTitle,
  populateFormFromItem,
  type DateConflictPrompt,
  type DeletePrompt,
  type FormMode,
  type ItemLinkContext,
  type KeyResultKeepChoice,
  type MovePrompt,
} from './goalsScreenTypes';

function resolveItemLink(
  link: ItemLinkContext,
  itemLinked: boolean,
): { linkedGoalId?: string; linkedGoalType?: LinkedGoalType } {
  if (link.scope === 'standalone') {
    return {};
  }

  if (link.scope === 'objective') {
    return {
      linkedGoalId: link.objectiveId,
      linkedGoalType: 'objective',
    };
  }

  if (!itemLinked) {
    return {};
  }

  return {
    linkedGoalId: link.keyResultId,
    linkedGoalType: 'keyResult',
  };
}

function AddButton({
  label,
  onPress,
  small,
}: {
  label: string;
  onPress: () => void;
  small?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        small ? styles.addButtonSmall : styles.addButton,
        pressed && styles.pressed,
      ]}
    >
      <Text style={small ? styles.addButtonTextSmall : styles.addButtonText}>
        {label}
      </Text>
    </Pressable>
  );
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

function DayPicker({
  selectedDays,
  onToggleDay,
}: {
  selectedDays: Weekday[];
  onToggleDay: (day: Weekday) => void;
}) {
  return (
    <View style={styles.dayPicker}>
      {WEEKDAYS.map((day) => {
        const isSelected = selectedDays.includes(day);
        return (
          <Pressable
            key={day}
            onPress={() => onToggleDay(day)}
            style={({ pressed }) => [
              styles.dayChip,
              isSelected && styles.dayChipSelected,
              pressed && styles.pressed,
            ]}
          >
            <Text
              style={[
                styles.dayChipText,
                isSelected && styles.dayChipTextSelected,
              ]}
            >
              {WEEKDAY_SHORT_LABELS[day]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function HabitListItem({
  habit,
  onEdit,
  onMove,
  onDelete,
}: {
  habit: DailyHabit;
  onEdit: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  return (
    <SwipeableRow onEdit={onEdit} onMove={onMove} onDelete={onDelete}>
      <View style={styles.swipeRowContent}>
        <Text style={styles.subListItem}>{habit.title}</Text>
        <StreakBadge streak={calculateStreak(habit.completionLog)} />
      </View>
    </SwipeableRow>
  );
}

function ActivityListItem({
  activity,
  onEdit,
  onMove,
  onDelete,
}: {
  activity: KeyActivity;
  onEdit: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  return (
    <SwipeableRow onEdit={onEdit} onMove={onMove} onDelete={onDelete}>
      <View style={styles.swipeRowContent}>
        <Text style={styles.subListItem}>
          {activity.title} ({formatScheduledDays(activity.scheduledDays)})
        </Text>
      </View>
    </SwipeableRow>
  );
}

function KeyResultRow({
  keyResult,
  dailyHabits,
  keyActivities,
  isExpanded,
  onToggle,
  onAddDailyHabit,
  onAddKeyActivity,
  onEdit,
  onMove,
  onDelete,
  onEditHabit,
  onMoveHabit,
  onDeleteHabit,
  onEditActivity,
  onMoveActivity,
  onDeleteActivity,
}: {
  keyResult: KeyResult;
  dailyHabits: DailyHabit[];
  keyActivities: KeyActivity[];
  isExpanded: boolean;
  onToggle: () => void;
  onAddDailyHabit: () => void;
  onAddKeyActivity: () => void;
  onEdit: () => void;
  onMove: () => void;
  onDelete: () => void;
  onEditHabit: (habit: DailyHabit) => void;
  onMoveHabit: (habit: DailyHabit) => void;
  onDeleteHabit: (habit: DailyHabit) => void;
  onEditActivity: (activity: KeyActivity) => void;
  onMoveActivity: (activity: KeyActivity) => void;
  onDeleteActivity: (activity: KeyActivity) => void;
}) {
  const linkedHabits = linkedHabitsForKeyResult(dailyHabits, keyResult.id);
  const linkedActivities = linkedActivitiesForKeyResult(
    keyActivities,
    keyResult.id,
  );

  return (
    <View style={styles.keyResultCard}>
      <SwipeableRow onEdit={onEdit} onMove={onMove} onDelete={onDelete}>
        <Pressable
          onPress={onToggle}
          style={({ pressed }) => [
            styles.keyResultHeader,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.keyResultTitle}>{keyResult.title}</Text>
          <Text style={styles.keyResultProgress}>
            {keyResult.currentProgress} / {keyResult.targetNumber}{' '}
            {keyResult.unit}
          </Text>
          <Text style={styles.keyResultDates}>
            {formatDate(keyResult.startDate)} – {formatDate(keyResult.endDate)}
          </Text>
        </Pressable>
      </SwipeableRow>

      {isExpanded && (
        <View style={styles.linkedSection}>
          <Text style={styles.subListLabel}>Daily Habits</Text>
          <View style={styles.subList}>
            {linkedHabits.length > 0 ? (
              linkedHabits.map((habit) => (
                <HabitListItem
                  key={habit.id}
                  habit={habit}
                  onEdit={() => onEditHabit(habit)}
                  onMove={() => onMoveHabit(habit)}
                  onDelete={() => onDeleteHabit(habit)}
                />
              ))
            ) : (
              <Text style={styles.subListEmpty}>None</Text>
            )}
          </View>

          <Text style={styles.subListLabel}>Key Activities</Text>
          <View style={styles.subList}>
            {linkedActivities.length > 0 ? (
              linkedActivities.map((activity) => (
                <ActivityListItem
                  key={activity.id}
                  activity={activity}
                  onEdit={() => onEditActivity(activity)}
                  onMove={() => onMoveActivity(activity)}
                  onDelete={() => onDeleteActivity(activity)}
                />
              ))
            ) : (
              <Text style={styles.subListEmpty}>None</Text>
            )}
          </View>

          <View style={styles.inlineAddButtons}>
            <AddButton label="+ Add Daily Habit" onPress={onAddDailyHabit} small />
            <AddButton
              label="+ Add Key Activity"
              onPress={onAddKeyActivity}
              small
            />
          </View>
        </View>
      )}
    </View>
  );
}

export default function GoalsScreen() {
  const {
    objectives,
    keyResults,
    activeDailyHabits,
    activeKeyActivities,
    dailyHabits,
    keyActivities,
    setObjectives,
    setKeyResults,
    setDailyHabits,
    setKeyActivities,
    softDeleteObjective,
    softDeleteKeyResult,
    softDeleteDailyHabit,
    softDeleteKeyActivity,
    moveDailyHabit,
    moveKeyActivity,
    moveKeyResult,
  } = useAppData();

  const [expandedObjectiveId, setExpandedObjectiveId] = useState<string | null>(
    null,
  );
  const [expandedKeyResultId, setExpandedKeyResultId] = useState<
    string | null
  >(null);

  const activeObjectives = useMemo(
    () => objectives.filter((item) => !item.deletedAt),
    [objectives],
  );
  const activeKeyResults = useMemo(
    () => keyResults.filter((item) => !item.deletedAt),
    [keyResults],
  );

  const standaloneHabits = useMemo(
    () => activeDailyHabits.filter((habit) => !habit.linkedGoalId),
    [activeDailyHabits],
  );
  const standaloneActivities = useMemo(
    () => activeKeyActivities.filter((activity) => !activity.linkedGoalId),
    [activeKeyActivities],
  );

  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [deletePrompt, setDeletePrompt] = useState<DeletePrompt | null>(null);
  const [movePrompt, setMovePrompt] = useState<MovePrompt | null>(null);
  const [dateConflictPrompt, setDateConflictPrompt] =
    useState<DateConflictPrompt | null>(null);
  const [keyResultKeepChoice, setKeyResultKeepChoice] =
    useState<KeyResultKeepChoice>('standalone');
  const [reassignObjectiveId, setReassignObjectiveId] = useState<string | null>(
    null,
  );

  const [title, setTitle] = useState('');
  const [affirmation, setAffirmation] = useState('');
  const [targetNumber, setTargetNumber] = useState('');
  const [unit, setUnit] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [scheduledDays, setScheduledDays] = useState<Weekday[]>([]);
  const [itemLinked, setItemLinked] = useState(true);

  const resetForm = () => {
    setTitle('');
    setAffirmation('');
    setTargetNumber('');
    setUnit('');
    setStartDate('');
    setEndDate('');
    setScheduledDays([]);
    setItemLinked(true);
  };

  const closeForm = () => {
    setFormMode(null);
    setDateConflictPrompt(null);
    resetForm();
  };

  const openCreateForm = (mode: FormMode) => {
    resetForm();
    setFormMode(mode);
    setStartDate(todayDateString());
    if (
      mode.action === 'create' &&
      (mode.type === 'dailyHabit' || mode.type === 'keyActivity') &&
      mode.link.scope === 'keyResult'
    ) {
      setItemLinked(true);
    }
  };

  const openEditForm = (mode: FormMode) => {
    const values = populateFormFromItem(
      mode,
      objectives,
      keyResults,
      dailyHabits,
      keyActivities,
    );
    setFormMode(mode);
    setTitle(values.title);
    setAffirmation(values.affirmation);
    setTargetNumber(values.targetNumber);
    setUnit(values.unit);
    setStartDate(values.startDate);
    setEndDate(values.endDate);
    setScheduledDays(values.scheduledDays);
    setItemLinked(values.itemLinked);
  };

  const toggleScheduledDay = (day: Weekday) => {
    setScheduledDays((current) =>
      current.includes(day)
        ? current.filter((entry) => entry !== day)
        : [...current, day],
    );
  };

  const toggleObjective = (objectiveId: string) => {
    setExpandedObjectiveId((current) =>
      current === objectiveId ? null : objectiveId,
    );
    setExpandedKeyResultId(null);
  };

  const toggleKeyResult = (keyResultId: string) => {
    setExpandedKeyResultId((current) =>
      current === keyResultId ? null : keyResultId,
    );
  };

  const applySave = () => {
    if (!formMode || !title.trim()) {
      return;
    }

    const trimmedStart = startDate.trim();
    const trimmedEnd = endDate.trim();

    if (formMode.type === 'objective') {
      if (!trimmedStart || !trimmedEnd) {
        return;
      }

      const trimmedTitle = title.trim();
      if (formMode.action === 'create') {
        const newObjective: Objective = {
          id: createId('objective'),
          title: trimmedTitle,
          createdDate: todayDateString(),
          startDate: trimmedStart,
          endDate: trimmedEnd,
          affirmation:
            affirmation.trim() || `I am achieving: ${trimmedTitle}`,
        };
        setObjectives((current) => [...current, newObjective]);
        setExpandedObjectiveId(newObjective.id);
        setExpandedKeyResultId(null);
      } else {
        setObjectives((current) =>
          current.map((objective) =>
            objective.id === formMode.id
              ? {
                  ...objective,
                  title: trimmedTitle,
                  startDate: trimmedStart,
                  endDate: trimmedEnd,
                  affirmation:
                    affirmation.trim() || `I am achieving: ${trimmedTitle}`,
                }
              : objective,
          ),
        );
      }
    }

    if (formMode.type === 'keyResult') {
      const parsedTarget = Number(targetNumber);
      if (
        !Number.isFinite(parsedTarget) ||
        !unit.trim() ||
        !trimmedStart ||
        !trimmedEnd
      ) {
        return;
      }

      if (formMode.action === 'create') {
        const newKeyResult: KeyResult = {
          id: createId('key-result'),
          objectiveId: formMode.objectiveId,
          title: title.trim(),
          targetNumber: parsedTarget,
          unit: unit.trim(),
          startDate: trimmedStart,
          endDate: trimmedEnd,
          currentProgress: 0,
          status: 'in_progress',
          createdDate: todayDateString(),
        };
        setKeyResults((current) => [...current, newKeyResult]);
        setExpandedKeyResultId(newKeyResult.id);
      } else {
        setKeyResults((current) =>
          current.map((keyResult) =>
            keyResult.id === formMode.id
              ? {
                  ...keyResult,
                  title: title.trim(),
                  targetNumber: parsedTarget,
                  unit: unit.trim(),
                  startDate: trimmedStart,
                  endDate: trimmedEnd,
                }
              : keyResult,
          ),
        );
      }
    }

    if (formMode.type === 'dailyHabit') {
      if (!trimmedStart || !trimmedEnd) {
        return;
      }

      if (formMode.action === 'create') {
        const link = resolveItemLink(formMode.link, itemLinked);
        const created = todayDateString();
        const newHabit: DailyHabit = {
          id: createId('daily-habit'),
          title: title.trim(),
          ...link,
          streakCount: 0,
          completionLog: [],
          createdDate: created,
          startDate: trimmedStart,
          endDate: trimmedEnd,
        };
        setDailyHabits((current) => [...current, newHabit]);
      } else {
        setDailyHabits((current) =>
          current.map((habit) =>
            habit.id === formMode.id
              ? {
                  ...habit,
                  title: title.trim(),
                  startDate: trimmedStart,
                  endDate: trimmedEnd,
                }
              : habit,
          ),
        );
      }
    }

    if (formMode.type === 'keyActivity') {
      if (scheduledDays.length === 0 || !trimmedStart || !trimmedEnd) {
        return;
      }

      if (formMode.action === 'create') {
        const link = resolveItemLink(formMode.link, itemLinked);
        const created = todayDateString();
        const newActivity: KeyActivity = {
          id: createId('key-activity'),
          title: title.trim(),
          cadence: 'weekly',
          weeklyTarget: scheduledDays.length,
          scheduledDays: [...scheduledDays],
          ...link,
          completionLog: [],
          createdDate: created,
          startDate: trimmedStart,
          endDate: trimmedEnd,
        };
        setKeyActivities((current) => [...current, newActivity]);
      } else {
        setKeyActivities((current) =>
          current.map((activity) =>
            activity.id === formMode.id
              ? {
                  ...activity,
                  title: title.trim(),
                  scheduledDays: [...scheduledDays],
                  weeklyTarget: scheduledDays.length,
                  startDate: trimmedStart,
                  endDate: trimmedEnd,
                }
              : activity,
          ),
        );
      }
    }

    closeForm();
  };

  const handleSave = () => {
    if (!formMode || !title.trim()) {
      return;
    }

    const trimmedStart = startDate.trim();
    const trimmedEnd = endDate.trim();
    if (!trimmedStart || !trimmedEnd) {
      return;
    }

    if (
      formMode.action === 'edit' &&
      (formMode.type === 'dailyHabit' || formMode.type === 'keyActivity')
    ) {
      const existing =
        formMode.type === 'dailyHabit'
          ? dailyHabits.find((item) => item.id === formMode.id)
          : keyActivities.find((item) => item.id === formMode.id);

      if (existing) {
        const conflicts = detectDateRangeConflicts(
          existing.completionLog,
          existing.startDate,
          existing.endDate,
          trimmedStart,
          trimmedEnd,
        );

        if (conflicts.length > 0) {
          setDateConflictPrompt({
            message: `${formatDateRangeConflictMessage(conflicts)}\n\nContinue?`,
            onConfirm: () => {
              setDateConflictPrompt(null);
              applySave();
            },
          });
          return;
        }
      }
    }

    applySave();
  };

  const cancelDateConflict = () => {
    if (!formMode || formMode.action !== 'edit') {
      setDateConflictPrompt(null);
      return;
    }

    const values = populateFormFromItem(
      formMode,
      objectives,
      keyResults,
      dailyHabits,
      keyActivities,
    );
    setStartDate(values.startDate);
    setEndDate(values.endDate);
    setDateConflictPrompt(null);
  };

  const promptDeleteHabit = (habit: DailyHabit) => {
    setDeletePrompt({
      kind: 'dailyHabit',
      id: habit.id,
      title: habit.title,
    });
  };

  const promptDeleteActivity = (activity: KeyActivity) => {
    setDeletePrompt({
      kind: 'keyActivity',
      id: activity.id,
      title: activity.title,
    });
  };

  const promptDeleteKeyResult = (keyResult: KeyResult) => {
    const parentObjective = objectives.find(
      (objective) => objective.id === keyResult.objectiveId,
    );
    setKeyResultKeepChoice('standalone');
    setDeletePrompt({
      kind: 'keyResult',
      id: keyResult.id,
      title: keyResult.title,
      dependentCount: countKeyResultDependents(
        keyResult.id,
        dailyHabits,
        keyActivities,
      ),
      parentObjectiveTitle: parentObjective?.title ?? 'Objective',
      parentObjectiveId: keyResult.objectiveId,
    });
  };

  const promptDeleteObjective = (objective: Objective) => {
    const otherObjectives = activeObjectives.filter(
      (item) => item.id !== objective.id,
    );
    setReassignObjectiveId(otherObjectives[0]?.id ?? null);
    setDeletePrompt({
      kind: 'objective',
      id: objective.id,
      title: objective.title,
      dependentCount: countObjectiveDependents(
        objective.id,
        keyResults,
        dailyHabits,
        keyActivities,
      ),
      keyResultCount: keyResultsForObjective(keyResults, objective.id).length,
      otherObjectives,
    });
  };

  const confirmDelete = (cascade = false) => {
    if (!deletePrompt) {
      return;
    }

    if (deletePrompt.kind === 'dailyHabit') {
      softDeleteDailyHabit(deletePrompt.id);
    } else if (deletePrompt.kind === 'keyActivity') {
      softDeleteKeyActivity(deletePrompt.id);
    } else if (deletePrompt.kind === 'keyResult') {
      if (cascade) {
        softDeleteKeyResult(deletePrompt.id, true);
      } else {
        softDeleteKeyResult(
          deletePrompt.id,
          false,
          keyResultKeepChoice === 'relinkObjective',
        );
      }
    } else if (deletePrompt.kind === 'objective') {
      if (cascade) {
        softDeleteObjective(deletePrompt.id, true);
      } else {
        softDeleteObjective(
          deletePrompt.id,
          false,
          reassignObjectiveId ?? undefined,
        );
      }
    }

    setDeletePrompt(null);
  };

  const confirmMove = (target: MoveTarget) => {
    if (!movePrompt) {
      return;
    }

    if (movePrompt.kind === 'dailyHabit') {
      moveDailyHabit(movePrompt.id, target);
    } else if (movePrompt.kind === 'keyActivity') {
      moveKeyActivity(movePrompt.id, target);
    } else if (movePrompt.kind === 'keyResult' && target.scope === 'objective') {
      moveKeyResult(movePrompt.id, target.objectiveId);
    }

    setMovePrompt(null);
  };

  const formTitle = getFormTitle(formMode);
  const isEdit = formMode?.action === 'edit';

  const linkHint =
    formMode?.action === 'create' &&
    (formMode.type === 'dailyHabit' || formMode.type === 'keyActivity')
      ? formMode.link.scope === 'objective'
        ? 'Will link to this Objective'
        : formMode.link.scope === 'keyResult'
          ? itemLinked
            ? 'Will link to this Key Result'
            : 'Will be standalone'
          : 'Will be standalone'
      : null;

  const canSubmit =
    title.trim().length > 0 &&
    startDate.trim().length > 0 &&
    endDate.trim().length > 0 &&
    (formMode?.type === 'objective'
      ? true
      : formMode?.type === 'keyResult'
        ? Number.isFinite(Number(targetNumber)) && unit.trim().length > 0
        : formMode?.type === 'keyActivity'
          ? scheduledDays.length > 0
          : formMode?.type === 'dailyHabit');

  const moveOptions = useMemo(() => {
    if (!movePrompt) {
      return [];
    }

    if (movePrompt.kind === 'keyResult') {
      return activeObjectives
        .filter((objective) => objective.id !== movePrompt.currentObjectiveId)
        .map((objective) => ({
          label: objective.title,
          target: {
            scope: 'objective' as const,
            objectiveId: objective.id,
          },
        }));
    }

    const options: { label: string; target: MoveTarget }[] = [
      { label: 'Standalone', target: { scope: 'standalone' } },
    ];

    for (const objective of activeObjectives) {
      options.push({
        label: `Objective: ${objective.title}`,
        target: { scope: 'objective', objectiveId: objective.id },
      });
    }

    for (const keyResult of activeKeyResults) {
      const parent = activeObjectives.find(
        (objective) => objective.id === keyResult.objectiveId,
      );
      options.push({
        label: `Key Result: ${keyResult.title}${parent ? ` (${parent.title})` : ''}`,
        target: { scope: 'keyResult', keyResultId: keyResult.id },
      });
    }

    return options;
  }, [movePrompt, activeObjectives, activeKeyResults]);

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.screenTitle}>Goals</Text>

        <AddButton
          label="+ Add Objective"
          onPress={() => openCreateForm({ type: 'objective', action: 'create' })}
        />

        <View style={styles.topLevelAddRow}>
          <AddButton
            label="+ Add Daily Habit"
            onPress={() =>
              openCreateForm({
                type: 'dailyHabit',
                action: 'create',
                link: { scope: 'standalone' },
              })
            }
            small
          />
          <AddButton
            label="+ Add Key Activity"
            onPress={() =>
              openCreateForm({
                type: 'keyActivity',
                action: 'create',
                link: { scope: 'standalone' },
              })
            }
            small
          />
        </View>

        {(standaloneHabits.length > 0 || standaloneActivities.length > 0) && (
          <View style={styles.standaloneSection}>
            <Text style={styles.standaloneTitle}>Standalone Items</Text>
            <View style={styles.subList}>
              {standaloneHabits.map((habit) => (
                <HabitListItem
                  key={habit.id}
                  habit={habit}
                  onEdit={() =>
                    openEditForm({
                      type: 'dailyHabit',
                      action: 'edit',
                      id: habit.id,
                    })
                  }
                  onMove={() =>
                    setMovePrompt({
                      kind: 'dailyHabit',
                      id: habit.id,
                      title: habit.title,
                    })
                  }
                  onDelete={() => promptDeleteHabit(habit)}
                />
              ))}
              {standaloneActivities.map((activity) => (
                <ActivityListItem
                  key={activity.id}
                  activity={activity}
                  onEdit={() =>
                    openEditForm({
                      type: 'keyActivity',
                      action: 'edit',
                      id: activity.id,
                    })
                  }
                  onMove={() =>
                    setMovePrompt({
                      kind: 'keyActivity',
                      id: activity.id,
                      title: activity.title,
                    })
                  }
                  onDelete={() => promptDeleteActivity(activity)}
                />
              ))}
            </View>
          </View>
        )}

        {activeObjectives.map((objective) => {
          const isObjectiveExpanded = expandedObjectiveId === objective.id;
          const objectiveKeyResults = keyResultsForObjective(
            keyResults,
            objective.id,
          );
          const objectiveHabits = linkedHabitsForObjective(
            dailyHabits,
            objective.id,
          );
          const objectiveActivities = linkedActivitiesForObjective(
            keyActivities,
            objective.id,
          );

          return (
            <View key={objective.id} style={styles.card}>
              <SwipeableRow
                onEdit={() =>
                  openEditForm({
                    type: 'objective',
                    action: 'edit',
                    id: objective.id,
                  })
                }
                onDelete={() => promptDeleteObjective(objective)}
              >
                <Pressable
                  onPress={() => toggleObjective(objective.id)}
                  style={({ pressed }) => [
                    styles.cardHeader,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.objectiveTitle}>{objective.title}</Text>
                <Text style={styles.objectiveDate}>
                  {formatDate(objective.startDate)} –{' '}
                  {formatDate(objective.endDate)}
                </Text>
                </Pressable>
              </SwipeableRow>

              {isObjectiveExpanded && (
                <View style={styles.keyResultList}>
                  <View style={styles.objectiveLinkedSection}>
                    <Text style={styles.subListLabel}>
                      Daily Habits (Objective)
                    </Text>
                    <View style={styles.subList}>
                      {objectiveHabits.length > 0 ? (
                        objectiveHabits.map((habit) => (
                          <HabitListItem
                            key={habit.id}
                            habit={habit}
                            onEdit={() =>
                              openEditForm({
                                type: 'dailyHabit',
                                action: 'edit',
                                id: habit.id,
                              })
                            }
                            onMove={() =>
                              setMovePrompt({
                                kind: 'dailyHabit',
                                id: habit.id,
                                title: habit.title,
                              })
                            }
                            onDelete={() => promptDeleteHabit(habit)}
                          />
                        ))
                      ) : (
                        <Text style={styles.subListEmpty}>None</Text>
                      )}
                    </View>

                    <Text style={styles.subListLabel}>
                      Key Activities (Objective)
                    </Text>
                    <View style={styles.subList}>
                      {objectiveActivities.length > 0 ? (
                        objectiveActivities.map((activity) => (
                          <ActivityListItem
                            key={activity.id}
                            activity={activity}
                            onEdit={() =>
                              openEditForm({
                                type: 'keyActivity',
                                action: 'edit',
                                id: activity.id,
                              })
                            }
                            onMove={() =>
                              setMovePrompt({
                                kind: 'keyActivity',
                                id: activity.id,
                                title: activity.title,
                              })
                            }
                            onDelete={() => promptDeleteActivity(activity)}
                          />
                        ))
                      ) : (
                        <Text style={styles.subListEmpty}>None</Text>
                      )}
                    </View>

                    <View style={styles.inlineAddButtons}>
                      <AddButton
                        label="+ Add Daily Habit"
                        onPress={() =>
                          openCreateForm({
                            type: 'dailyHabit',
                            action: 'create',
                            link: {
                              scope: 'objective',
                              objectiveId: objective.id,
                            },
                          })
                        }
                        small
                      />
                      <AddButton
                        label="+ Add Key Activity"
                        onPress={() =>
                          openCreateForm({
                            type: 'keyActivity',
                            action: 'create',
                            link: {
                              scope: 'objective',
                              objectiveId: objective.id,
                            },
                          })
                        }
                        small
                      />
                    </View>
                  </View>

                  {objectiveKeyResults.map((keyResult) => (
                    <KeyResultRow
                      key={keyResult.id}
                      keyResult={keyResult}
                      dailyHabits={dailyHabits}
                      keyActivities={keyActivities}
                      isExpanded={expandedKeyResultId === keyResult.id}
                      onToggle={() => toggleKeyResult(keyResult.id)}
                      onEdit={() =>
                        openEditForm({
                          type: 'keyResult',
                          action: 'edit',
                          id: keyResult.id,
                        })
                      }
                      onMove={() =>
                        setMovePrompt({
                          kind: 'keyResult',
                          id: keyResult.id,
                          title: keyResult.title,
                          currentObjectiveId: keyResult.objectiveId,
                        })
                      }
                      onDelete={() => promptDeleteKeyResult(keyResult)}
                      onAddDailyHabit={() =>
                        openCreateForm({
                          type: 'dailyHabit',
                          action: 'create',
                          link: {
                            scope: 'keyResult',
                            keyResultId: keyResult.id,
                          },
                        })
                      }
                      onAddKeyActivity={() =>
                        openCreateForm({
                          type: 'keyActivity',
                          action: 'create',
                          link: {
                            scope: 'keyResult',
                            keyResultId: keyResult.id,
                          },
                        })
                      }
                      onEditHabit={(habit) =>
                        openEditForm({
                          type: 'dailyHabit',
                          action: 'edit',
                          id: habit.id,
                        })
                      }
                      onMoveHabit={(habit) =>
                        setMovePrompt({
                          kind: 'dailyHabit',
                          id: habit.id,
                          title: habit.title,
                        })
                      }
                      onDeleteHabit={promptDeleteHabit}
                      onEditActivity={(activity) =>
                        openEditForm({
                          type: 'keyActivity',
                          action: 'edit',
                          id: activity.id,
                        })
                      }
                      onMoveActivity={(activity) =>
                        setMovePrompt({
                          kind: 'keyActivity',
                          id: activity.id,
                          title: activity.title,
                        })
                      }
                      onDeleteActivity={promptDeleteActivity}
                    />
                  ))}

                  <AddButton
                    label="+ Add Key Result"
                    onPress={() =>
                      openCreateForm({
                        type: 'keyResult',
                        action: 'create',
                        objectiveId: objective.id,
                      })
                    }
                    small
                  />
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      <Modal
        visible={formMode !== null}
        animationType="slide"
        transparent
        onRequestClose={closeForm}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <ScrollView
            contentContainerStyle={styles.modalScrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>{formTitle}</Text>

              <Text style={styles.fieldLabel}>Title</Text>
              <TextInput
                style={styles.input}
                value={title}
                onChangeText={setTitle}
                placeholder="Enter title"
                autoFocus
              />

              {(formMode?.type === 'objective' ||
                formMode?.type === 'keyResult' ||
                formMode?.type === 'dailyHabit' ||
                formMode?.type === 'keyActivity') && (
                <>
                  <Text style={styles.fieldLabel}>Start Date</Text>
                  <TextInput
                    style={styles.input}
                    value={startDate}
                    onChangeText={setStartDate}
                    placeholder="YYYY-MM-DD"
                  />

                  <Text style={styles.fieldLabel}>End Date</Text>
                  <TextInput
                    style={styles.input}
                    value={endDate}
                    onChangeText={setEndDate}
                    placeholder="YYYY-MM-DD"
                  />
                </>
              )}

              {formMode?.type === 'objective' && (
                <>
                  <Text style={styles.fieldLabel}>Affirmation (optional)</Text>
                  <TextInput
                    style={styles.input}
                    value={affirmation}
                    onChangeText={setAffirmation}
                    placeholder="I am a World Cup soccer player"
                  />
                </>
              )}

              {formMode?.type === 'keyResult' && (
                <>
                  <Text style={styles.fieldLabel}>Target Number</Text>
                  <TextInput
                    style={styles.input}
                    value={targetNumber}
                    onChangeText={setTargetNumber}
                    placeholder="e.g. 10"
                    keyboardType="numeric"
                  />

                  <Text style={styles.fieldLabel}>Unit</Text>
                  <TextInput
                    style={styles.input}
                    value={unit}
                    onChangeText={setUnit}
                    placeholder="e.g. goals, miles"
                  />
                </>
              )}

              {formMode?.type === 'keyActivity' && (
                <>
                  <Text style={styles.fieldLabel}>Scheduled Days</Text>
                  <Text style={styles.fieldHint}>
                    Select which days this activity is due. Weekly target:{' '}
                    {scheduledDays.length}
                  </Text>
                  <DayPicker
                    selectedDays={scheduledDays}
                    onToggleDay={toggleScheduledDay}
                  />
                </>
              )}

              {linkHint ? (
                <Text style={styles.linkHint}>{linkHint}</Text>
              ) : null}

              {formMode?.action === 'create' &&
              (formMode.type === 'dailyHabit' ||
                formMode.type === 'keyActivity') &&
              formMode.link.scope === 'keyResult' ? (
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>
                    Linked to this Key Result
                  </Text>
                  <Switch value={itemLinked} onValueChange={setItemLinked} />
                </View>
              ) : null}

              <View style={styles.modalActions}>
                <Pressable
                  onPress={closeForm}
                  style={({ pressed }) => [
                    styles.modalButtonSecondary,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.modalButtonSecondaryText}>Cancel</Text>
                </Pressable>

                <Pressable
                  onPress={handleSave}
                  disabled={!canSubmit}
                  style={({ pressed }) => [
                    styles.modalButtonPrimary,
                    !canSubmit && styles.modalButtonDisabled,
                    pressed && canSubmit && styles.pressed,
                  ]}
                >
                  <Text style={styles.modalButtonPrimaryText}>
                    {isEdit ? 'Save' : 'Create'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={deletePrompt !== null}
        animationType="fade"
        transparent
        onRequestClose={() => setDeletePrompt(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {deletePrompt?.kind === 'dailyHabit' ||
            deletePrompt?.kind === 'keyActivity' ? (
              <>
                <Text style={styles.modalTitle}>Delete item?</Text>
                <Text style={styles.dialogBody}>
                  Delete {deletePrompt.title}? This cannot be undone.
                </Text>
                <View style={styles.modalActions}>
                  <Pressable
                    onPress={() => setDeletePrompt(null)}
                    style={styles.modalButtonSecondary}
                  >
                    <Text style={styles.modalButtonSecondaryText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => confirmDelete()}
                    style={styles.modalButtonDanger}
                  >
                    <Text style={styles.modalButtonPrimaryText}>Delete</Text>
                  </Pressable>
                </View>
              </>
            ) : null}

            {deletePrompt?.kind === 'keyResult' ? (
              <>
                <Text style={styles.modalTitle}>Delete Key Result?</Text>
                {deletePrompt.dependentCount > 0 ? (
                  <>
                    <Text style={styles.dialogBody}>
                      This Key Result has {deletePrompt.dependentCount} linked
                      item{deletePrompt.dependentCount === 1 ? '' : 's'}. What
                      would you like to do with them?
                    </Text>
                    <Pressable
                      onPress={() => setKeyResultKeepChoice('standalone')}
                      style={[
                        styles.choiceRow,
                        keyResultKeepChoice === 'standalone' &&
                          styles.choiceRowSelected,
                      ]}
                    >
                      <Text style={styles.choiceText}>
                        Keep linked items (make standalone)
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        setKeyResultKeepChoice('relinkObjective')
                      }
                      style={[
                        styles.choiceRow,
                        keyResultKeepChoice === 'relinkObjective' &&
                          styles.choiceRowSelected,
                      ]}
                    >
                      <Text style={styles.choiceText}>
                        Re-link to {deletePrompt.parentObjectiveTitle}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => confirmDelete(true)}
                      style={styles.choiceRow}
                    >
                      <Text style={[styles.choiceText, styles.dangerText]}>
                        Delete everything
                      </Text>
                    </Pressable>
                    <View style={styles.modalActions}>
                      <Pressable
                        onPress={() => setDeletePrompt(null)}
                        style={styles.modalButtonSecondary}
                      >
                        <Text style={styles.modalButtonSecondaryText}>
                          Cancel
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => confirmDelete(false)}
                        style={styles.modalButtonPrimary}
                      >
                        <Text style={styles.modalButtonPrimaryText}>
                          Delete Key Result
                        </Text>
                      </Pressable>
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={styles.dialogBody}>
                      Delete {deletePrompt.title}? This cannot be undone.
                    </Text>
                    <View style={styles.modalActions}>
                      <Pressable
                        onPress={() => setDeletePrompt(null)}
                        style={styles.modalButtonSecondary}
                      >
                        <Text style={styles.modalButtonSecondaryText}>
                          Cancel
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => confirmDelete()}
                        style={styles.modalButtonDanger}
                      >
                        <Text style={styles.modalButtonPrimaryText}>
                          Delete
                        </Text>
                      </Pressable>
                    </View>
                  </>
                )}
              </>
            ) : null}

            {deletePrompt?.kind === 'objective' ? (
              <>
                <Text style={styles.modalTitle}>Delete Objective?</Text>
                {deletePrompt.dependentCount > 0 ? (
                  <>
                    <Text style={styles.dialogBody}>
                      This Objective has {deletePrompt.dependentCount} linked
                      item{deletePrompt.dependentCount === 1 ? '' : 's'}. What
                      would you like to do with them?
                    </Text>
                    {deletePrompt.keyResultCount > 0 &&
                    deletePrompt.otherObjectives.length > 0 ? (
                      <>
                        <Text style={styles.fieldLabel}>
                          Move Key Results to
                        </Text>
                        {deletePrompt.otherObjectives.map((objective) => (
                          <Pressable
                            key={objective.id}
                            onPress={() => setReassignObjectiveId(objective.id)}
                            style={[
                              styles.choiceRow,
                              reassignObjectiveId === objective.id &&
                                styles.choiceRowSelected,
                            ]}
                          >
                            <Text style={styles.choiceText}>
                              {objective.title}
                            </Text>
                          </Pressable>
                        ))}
                      </>
                    ) : null}
                    <Pressable
                      onPress={() => confirmDelete(false)}
                      style={styles.choiceRow}
                    >
                      <Text style={styles.choiceText}>
                        Keep Daily Habits / Key Activities as standalone
                        {deletePrompt.keyResultCount > 0 &&
                        deletePrompt.otherObjectives.length === 0
                          ? ' (Key Results will also be deleted)'
                          : ''}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => confirmDelete(true)}
                      style={styles.choiceRow}
                    >
                      <Text style={[styles.choiceText, styles.dangerText]}>
                        Delete everything
                      </Text>
                    </Pressable>
                    <View style={styles.modalActions}>
                      <Pressable
                        onPress={() => setDeletePrompt(null)}
                        style={styles.modalButtonSecondary}
                      >
                        <Text style={styles.modalButtonSecondaryText}>
                          Cancel
                        </Text>
                      </Pressable>
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={styles.dialogBody}>
                      Delete {deletePrompt.title}? This cannot be undone.
                    </Text>
                    <View style={styles.modalActions}>
                      <Pressable
                        onPress={() => setDeletePrompt(null)}
                        style={styles.modalButtonSecondary}
                      >
                        <Text style={styles.modalButtonSecondaryText}>
                          Cancel
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => confirmDelete()}
                        style={styles.modalButtonDanger}
                      >
                        <Text style={styles.modalButtonPrimaryText}>
                          Delete
                        </Text>
                      </Pressable>
                    </View>
                  </>
                )}
              </>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal
        visible={movePrompt !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setMovePrompt(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              Move {movePrompt?.title ?? 'item'}
            </Text>
            <Text style={styles.dialogBody}>
              Select a new {movePrompt?.kind === 'keyResult' ? 'Objective' : 'parent'}:
            </Text>
            <ScrollView style={styles.moveList}>
              {moveOptions.map((option) => (
                <Pressable
                  key={option.label}
                  onPress={() => confirmMove(option.target)}
                  style={({ pressed }) => [
                    styles.choiceRow,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.choiceText}>{option.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setMovePrompt(null)}
                style={styles.modalButtonSecondary}
              >
                <Text style={styles.modalButtonSecondaryText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={dateConflictPrompt !== null}
        animationType="fade"
        transparent
        onRequestClose={cancelDateConflict}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Confirm date change</Text>
            <Text style={styles.dialogBody}>{dateConflictPrompt?.message}</Text>
            <View style={styles.modalActions}>
              <Pressable
                onPress={cancelDateConflict}
                style={styles.modalButtonSecondary}
              >
                <Text style={styles.modalButtonSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => dateConflictPrompt?.onConfirm()}
                style={styles.modalButtonDanger}
              >
                <Text style={styles.modalButtonPrimaryText}>Continue</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
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
  screenTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111',
    marginBottom: 16,
  },
  topLevelAddRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  standaloneSection: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    overflow: 'hidden',
  },
  standaloneTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  addButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#007aff',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
  },
  addButtonSmall: {
    backgroundColor: '#e8f1ff',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  addButtonTextSmall: {
    color: '#007aff',
    fontSize: 13,
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    overflow: 'hidden',
  },
  cardHeader: {
    padding: 16,
  },
  objectiveTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111',
    marginBottom: 6,
  },
  objectiveDate: {
    fontSize: 14,
    color: '#666',
  },
  keyResultList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5ea',
    padding: 12,
    gap: 8,
  },
  objectiveLinkedSection: {
    backgroundColor: '#f9f9fb',
    borderRadius: 10,
    padding: 12,
    gap: 6,
    marginBottom: 4,
  },
  keyResultCard: {
    backgroundColor: '#f9f9fb',
    borderRadius: 10,
    overflow: 'hidden',
  },
  keyResultHeader: {
    padding: 12,
  },
  keyResultTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#222',
    marginBottom: 4,
  },
  keyResultProgress: {
    fontSize: 14,
    color: '#555',
  },
  keyResultDates: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  linkedSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5ea',
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 6,
  },
  subListLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
  },
  subList: {
    gap: 0,
    marginBottom: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  swipeRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  subListItem: {
    fontSize: 14,
    color: '#444',
    flex: 1,
  },
  subListEmpty: {
    fontSize: 14,
    color: '#aaa',
    fontStyle: 'italic',
    paddingLeft: 4,
  },
  inlineAddButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
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
  pressed: {
    opacity: 0.7,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  modalScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111',
    marginBottom: 16,
  },
  dialogBody: {
    fontSize: 15,
    color: '#444',
    lineHeight: 22,
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
    marginBottom: 6,
    marginTop: 8,
  },
  fieldHint: {
    fontSize: 13,
    color: '#888',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#fafafa',
  },
  dayPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  dayChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  dayChipSelected: {
    backgroundColor: '#e8f1ff',
    borderColor: '#007aff',
  },
  dayChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  dayChipTextSelected: {
    color: '#007aff',
  },
  linkHint: {
    fontSize: 13,
    color: '#007aff',
    marginTop: 12,
    fontStyle: 'italic',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    paddingVertical: 4,
  },
  switchLabel: {
    fontSize: 15,
    color: '#333',
    flex: 1,
    marginRight: 12,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 24,
  },
  modalButtonSecondary: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
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
  },
  modalButtonDanger: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#ff3b30',
  },
  modalButtonDisabled: {
    backgroundColor: '#a8c8f0',
  },
  modalButtonPrimaryText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  choiceRow: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#f5f5f7',
    marginBottom: 8,
  },
  choiceRowSelected: {
    backgroundColor: '#e8f1ff',
    borderWidth: 1,
    borderColor: '#007aff',
  },
  choiceText: {
    fontSize: 15,
    color: '#333',
  },
  dangerText: {
    color: '#ff3b30',
    fontWeight: '600',
  },
  moveList: {
    maxHeight: 280,
    marginBottom: 8,
  },
});
