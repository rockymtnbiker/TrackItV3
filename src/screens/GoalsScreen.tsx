import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useMemo, useState, type ReactNode } from 'react';
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
  linkedHabitsForGoal,
  linkedHabitsForMilestone,
  milestonesForGoal,
  useAppData,
} from '../context/AppDataContext';
import type {
  Goal,
  GoalCategory,
  GoalStatus,
  Habit,
  LinkedGoalType,
  Milestone,
  MoveTarget,
  TargetPeriod,
  Weekday,
} from '../types';
import {
  ALL_WEEKDAYS,
  GOAL_CATEGORIES,
} from '../types';
import {
  countGoalDependents,
  countMilestoneDependents,
} from '../utils/activeItems';
import {
  dateFromIso,
  formatDate,
  formatDateMDY,
  formatScheduledDays,
  isoFromDate,
  todayDateString,
  WEEKDAY_SHORT_LABELS,
  WEEKDAYS,
} from '../utils/date';
import {
  detectDateRangeConflicts,
  formatDateRangeConflictMessage,
} from '../utils/dateRange';
import { calculateStreak } from '../utils/streak';
import { formatTargetLabel } from '../utils/targetLabel';
import {
  createId,
  getFormTitle,
  populateFormFromItem,
  type DateConflictPrompt,
  type DeletePrompt,
  type FormMode,
  type ItemLinkContext,
  type MilestoneKeepChoice,
  type MovePrompt,
} from './goalsScreenTypes';

function resolveItemLink(
  link: ItemLinkContext,
  itemLinked: boolean,
): { linkedGoalId?: string; linkedGoalType?: LinkedGoalType } {
  if (link.scope === 'standalone') {
    return {};
  }

  if (link.scope === 'goal') {
    return {
      linkedGoalId: link.goalId,
      linkedGoalType: 'goal',
    };
  }

  if (!itemLinked) {
    return {};
  }

  return {
    linkedGoalId: link.milestoneId,
    linkedGoalType: 'milestone',
  };
}

function cycleGoalStatus(current: GoalStatus): GoalStatus {
  return current === 'active' ? 'done' : 'active';
}

function parseOptionalTarget(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
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

function FormFieldRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.formFieldRow}>
      <Text style={styles.formFieldLabel}>{label}</Text>
      <View style={styles.formFieldControl}>{children}</View>
    </View>
  );
}

const PERIOD_OPTIONS: { value: TargetPeriod; label: string }[] = [
  { value: 'None', label: 'None' },
  { value: 'Day', label: 'Day' },
  { value: 'Week', label: 'Week' },
  { value: 'Month', label: 'Month' },
  { value: 'Instance', label: 'Per Session' },
];

function FormSelectRow({
  label,
  value,
  placeholder,
  options,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabel =
    options.find((option) => option.value === value)?.label ?? '';

  return (
    <>
      <FormFieldRow label={label}>
        <Pressable
          onPress={() => setOpen(true)}
          style={({ pressed }) => [
            styles.formSelectButton,
            pressed && styles.pressed,
          ]}
        >
          <Text
            style={[
              styles.formSelectText,
              !selectedLabel && styles.formSelectPlaceholder,
            ]}
            numberOfLines={1}
          >
            {selectedLabel || placeholder}
          </Text>
          <Ionicons name="chevron-down" size={16} color="#666" />
        </Pressable>
      </FormFieldRow>

      <Modal
        visible={open}
        animationType="fade"
        transparent
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.menuCard}>
            <Text style={styles.modalTitle}>{label}</Text>
            <ScrollView style={styles.moveList}>
              {options.map((option) => (
                <Pressable
                  key={option.value}
                  onPress={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.choiceRow,
                    option.value === value && styles.choiceRowSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.choiceText}>{option.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setOpen(false)}
                style={styles.modalButtonSecondary}
              >
                <Text style={styles.modalButtonSecondaryText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function FormDateRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (isoDate: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const pickerValue = dateFromIso(value || todayDateString());

  const handleChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') {
      setOpen(false);
    }
    if (event.type === 'dismissed') {
      setOpen(false);
      return;
    }
    if (date) {
      onChange(isoFromDate(date));
    }
  };

  return (
    <>
      <FormFieldRow label={label}>
        <Pressable
          onPress={() => setOpen(true)}
          style={({ pressed }) => [
            styles.formSelectButton,
            pressed && styles.pressed,
          ]}
        >
          <Text
            style={[
              styles.formSelectText,
              !value && styles.formSelectPlaceholder,
            ]}
          >
            {value ? formatDateMDY(value) : 'mm/dd/yyyy'}
          </Text>
          <Ionicons name="calendar-outline" size={16} color="#666" />
        </Pressable>
      </FormFieldRow>

      {open && Platform.OS === 'android' ? (
        <DateTimePicker
          value={pickerValue}
          mode="date"
          display="default"
          onChange={handleChange}
        />
      ) : null}

      <Modal
        visible={open && Platform.OS === 'ios'}
        animationType="fade"
        transparent
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.menuCard}>
            <Text style={styles.modalTitle}>{label}</Text>
            <DateTimePicker
              value={pickerValue}
              mode="date"
              display="spinner"
              onChange={handleChange}
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setOpen(false)}
                style={styles.modalButtonPrimary}
              >
                <Text style={styles.modalButtonPrimaryText}>Done</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function HabitListItem({
  habit,
  onEdit,
  onMove,
  onDelete,
}: {
  habit: Habit;
  onEdit: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  const daysSummary =
    habit.scheduledDays.length === ALL_WEEKDAYS.length
      ? 'daily'
      : formatScheduledDays(habit.scheduledDays);

  return (
    <SwipeableRow onEdit={onEdit} onMove={onMove} onDelete={onDelete}>
      <Pressable
        onPress={onEdit}
        style={({ pressed }) => [
          styles.swipeRowContent,
          pressed && styles.pressed,
        ]}
      >
        <Text
          style={[
            styles.subListItem,
            habit.status === 'done' && styles.titleDone,
          ]}
        >
          H: {habit.title}
          {daysSummary ? ` (${daysSummary})` : ''}
        </Text>
        <StreakBadge streak={calculateStreak(habit.completionLog)} />
      </Pressable>
    </SwipeableRow>
  );
}

function MilestoneRow({
  milestone,
  habits,
  isExpanded,
  onToggleExpand,
  onEdit,
  onMove,
  onDelete,
  onEditHabit,
  onMoveHabit,
  onDeleteHabit,
}: {
  milestone: Milestone;
  habits: Habit[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onMove: () => void;
  onDelete: () => void;
  onEditHabit: (habit: Habit) => void;
  onMoveHabit: (habit: Habit) => void;
  onDeleteHabit: (habit: Habit) => void;
}) {
  const linkedHabits = linkedHabitsForMilestone(habits, milestone.id);
  const hasDates = Boolean(milestone.startDate || milestone.endDate);
  const targetLabel = formatTargetLabel(milestone);

  return (
    <View style={styles.milestoneCard}>
      <SwipeableRow onEdit={onEdit} onMove={onMove} onDelete={onDelete}>
        <View style={styles.milestoneHeader}>
          <Pressable
            onPress={onEdit}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            <Text
              style={[
                styles.milestoneTitle,
                milestone.status === 'done' && styles.titleDone,
              ]}
            >
              M: {milestone.title}
            </Text>
          </Pressable>
          {targetLabel ? (
            <Text style={styles.milestoneProgress}>{targetLabel}</Text>
          ) : null}
          <View style={styles.dateExpandRow}>
            {hasDates ? (
              <Text style={styles.milestoneDates}>
                {milestone.startDate
                  ? formatDate(milestone.startDate)
                  : '—'}{' '}
                –{' '}
                {milestone.endDate ? formatDate(milestone.endDate) : '—'}
              </Text>
            ) : (
              <View style={styles.dateExpandSpacer} />
            )}
            <Pressable
              onPress={onToggleExpand}
              hitSlop={8}
              style={({ pressed }) => [
                styles.expandButton,
                pressed && styles.pressed,
              ]}
              accessibilityLabel={isExpanded ? 'Collapse' : 'Expand'}
            >
              <Ionicons
                name={isExpanded ? 'chevron-up' : 'chevron-down'}
                size={20}
                color="#666"
              />
            </Pressable>
          </View>
        </View>
      </SwipeableRow>

      {isExpanded && linkedHabits.length > 0 ? (
        <View style={styles.linkedSection}>
          <View style={styles.subList}>
            {linkedHabits.map((habit) => (
              <HabitListItem
                key={habit.id}
                habit={habit}
                onEdit={() => onEditHabit(habit)}
                onMove={() => onMoveHabit(habit)}
                onDelete={() => onDeleteHabit(habit)}
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

export default function GoalsScreen() {
  const {
    goals,
    milestones,
    habits,
    activeGoals,
    activeMilestones,
    activeHabits,
    setGoals,
    setMilestones,
    setHabits,
    softDeleteGoal,
    softDeleteMilestone,
    softDeleteHabit,
    moveHabit,
    moveMilestone,
  } = useAppData();

  const [expandedGoalIds, setExpandedGoalIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedMilestoneIds, setExpandedMilestoneIds] = useState<
    Set<string>
  >(() => new Set());

  const visibleGoals = useMemo(
    () => activeGoals.filter((goal) => goal.status !== 'done'),
    [activeGoals],
  );

  const allUndeletedGoals = useMemo(
    () => goals.filter((goal) => !goal.deletedAt),
    [goals],
  );

  const standaloneHabits = useMemo(
    () => activeHabits.filter((habit) => !habit.linkedGoalId),
    [activeHabits],
  );

  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [typeMenuVisible, setTypeMenuVisible] = useState(false);
  const [childTypeMenu, setChildTypeMenu] = useState<{
    parentType: 'goal' | 'milestone';
    parentId: string;
  } | null>(null);
  const [linkPickerType, setLinkPickerType] = useState<
    'milestone' | 'habit' | null
  >(null);
  const [deletePrompt, setDeletePrompt] = useState<DeletePrompt | null>(null);
  const [movePrompt, setMovePrompt] = useState<MovePrompt | null>(null);
  const [dateConflictPrompt, setDateConflictPrompt] =
    useState<DateConflictPrompt | null>(null);
  const [milestoneKeepChoice, setMilestoneKeepChoice] =
    useState<MilestoneKeepChoice>('standalone');
  const [reassignGoalId, setReassignGoalId] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<GoalCategory | ''>('');
  const [target, setTarget] = useState('');
  const [unit, setUnit] = useState('');
  const [period, setPeriod] = useState<TargetPeriod>('None');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [scheduledDays, setScheduledDays] = useState<Weekday[]>([]);
  const [itemLinked, setItemLinked] = useState(true);
  const [itemStatus, setItemStatus] = useState<GoalStatus>('active');

  const resetForm = () => {
    setTitle('');
    setCategory('');
    setTarget('');
    setUnit('');
    setPeriod('None');
    setStartDate('');
    setEndDate('');
    setScheduledDays([]);
    setItemLinked(true);
    setItemStatus('active');
  };

  const applyFormValues = (
    values: ReturnType<typeof populateFormFromItem>,
  ) => {
    setTitle(values.title);
    setCategory(values.category);
    setTarget(values.target);
    setUnit(values.unit);
    setPeriod(values.period);
    setStartDate(values.startDate);
    setEndDate(values.endDate);
    setScheduledDays(values.scheduledDays);
    setItemLinked(values.itemLinked);
    setItemStatus(values.status);
  };

  const closeForm = () => {
    setFormMode(null);
    setDateConflictPrompt(null);
    resetForm();
  };

  const openCreateForm = (mode: FormMode) => {
    resetForm();
    const values = populateFormFromItem(mode, goals, milestones, habits);
    applyFormValues(values);
    // Milestones allow empty dates; Goal/Habit default start to today.
    if (mode.type === 'milestone') {
      setStartDate(values.startDate);
      setEndDate(values.endDate);
    } else {
      setStartDate(values.startDate || todayDateString());
    }
    setFormMode(mode);
    setTypeMenuVisible(false);
    setLinkPickerType(null);
    if (
      mode.action === 'create' &&
      mode.type === 'habit' &&
      mode.link.scope === 'milestone'
    ) {
      setItemLinked(true);
    }
  };

  const handleTypeSelected = (type: 'goal' | 'milestone' | 'habit') => {
    setTypeMenuVisible(false);

    if (type === 'goal') {
      openCreateForm({ type: 'goal', action: 'create' });
      return;
    }

    setLinkPickerType(type);
  };

  const handleLinkSelected = (link: ItemLinkContext) => {
    if (!linkPickerType) {
      return;
    }

    if (linkPickerType === 'milestone') {
      if (link.scope !== 'goal') {
        return;
      }
      openCreateForm({
        type: 'milestone',
        action: 'create',
        goalId: link.goalId,
      });
      return;
    }

    openCreateForm({
      type: 'habit',
      action: 'create',
      link,
    });
  };

  const linkPickerOptions = useMemo(() => {
    if (!linkPickerType) {
      return [] as { label: string; onPress: () => void }[];
    }

    const options: { label: string; onPress: () => void }[] = [];

    if (linkPickerType === 'habit') {
      options.push({
        label: 'Standalone / No Link',
        onPress: () => handleLinkSelected({ scope: 'standalone' }),
      });
    }

    for (const goal of visibleGoals) {
      options.push({
        label: `Goal: ${goal.title}`,
        onPress: () =>
          handleLinkSelected({
            scope: 'goal',
            goalId: goal.id,
          }),
      });
    }

    if (linkPickerType === 'habit') {
      for (const milestone of activeMilestones) {
        const parent = visibleGoals.find(
          (goal) => goal.id === milestone.goalId,
        );
        options.push({
          label: `Milestone: ${milestone.title}${
            parent ? ` (${parent.title})` : ''
          }`,
          onPress: () =>
            handleLinkSelected({
              scope: 'milestone',
              milestoneId: milestone.id,
            }),
        });
      }
    }

    return options;
  }, [linkPickerType, visibleGoals, activeMilestones]);

  const openEditForm = (mode: FormMode) => {
    const values = populateFormFromItem(mode, goals, milestones, habits);
    setFormMode(mode);
    applyFormValues(values);
  };

  const toggleScheduledDay = (day: Weekday) => {
    setScheduledDays((current) =>
      current.includes(day)
        ? current.filter((entry) => entry !== day)
        : [...current, day],
    );
  };

  const toggleGoal = (goalId: string) => {
    setExpandedGoalIds((current) => {
      const next = new Set(current);
      if (next.has(goalId)) {
        next.delete(goalId);
      } else {
        next.add(goalId);
      }
      return next;
    });
  };

  const toggleMilestone = (milestoneId: string) => {
    setExpandedMilestoneIds((current) => {
      const next = new Set(current);
      if (next.has(milestoneId)) {
        next.delete(milestoneId);
      } else {
        next.add(milestoneId);
      }
      return next;
    });
  };

  const applySave = () => {
    if (!formMode || !title.trim()) {
      return;
    }

    const trimmedStart = startDate.trim();
    const trimmedEnd = endDate.trim();
    const trimmedTitle = title.trim();
    const optionalTarget = parseOptionalTarget(target);
    const optionalUnit = unit.trim() || undefined;
    const optionalPeriod: TargetPeriod | undefined =
      optionalTarget != null ? period : undefined;
    const optionalCategory = category || undefined;

    if (formMode.type === 'goal') {
      if (!trimmedStart || !trimmedEnd) {
        return;
      }

      if (formMode.action === 'create') {
        const maxOrder = goals.reduce(
          (max, goal) => Math.max(max, goal.sortOrder ?? -1),
          -1,
        );
        const newGoal: Goal = {
          id: createId('goal'),
          title: trimmedTitle,
          sortOrder: maxOrder + 1,
          createdDate: todayDateString(),
          startDate: trimmedStart,
          endDate: trimmedEnd,
          category: optionalCategory,
          target: optionalTarget,
          unit: optionalUnit,
          period: optionalPeriod,
          status: 'active',
        };
        setGoals((current) => [...current, newGoal]);
        setExpandedGoalIds((current) => new Set(current).add(newGoal.id));
      } else {
        setGoals((current) =>
          current.map((goal) =>
            goal.id === formMode.id
              ? {
                  ...goal,
                  title: trimmedTitle,
                  startDate: trimmedStart,
                  endDate: trimmedEnd,
                  category: optionalCategory,
                  target: optionalTarget,
                  unit: optionalUnit,
                  period: optionalPeriod,
                  status: itemStatus,
                }
              : goal,
          ),
        );
      }
    }

    if (formMode.type === 'milestone') {
      const optionalStart = trimmedStart || undefined;
      const optionalEnd = trimmedEnd || undefined;

      if (formMode.action === 'create') {
        const siblings = milestones.filter(
          (item) =>
            item.goalId === formMode.goalId && !item.deletedAt,
        );
        const maxOrder = siblings.reduce(
          (max, item) => Math.max(max, item.sortOrder),
          -1,
        );
        const newMilestone: Milestone = {
          id: createId('milestone'),
          goalId: formMode.goalId,
          title: trimmedTitle,
          sortOrder: maxOrder + 1,
          target: optionalTarget,
          unit: optionalUnit,
          period: optionalPeriod,
          startDate: optionalStart,
          endDate: optionalEnd,
          category: optionalCategory,
          status: 'active',
          createdDate: todayDateString(),
        };
        setMilestones((current) => [...current, newMilestone]);
        setExpandedMilestoneIds((current) =>
          new Set(current).add(newMilestone.id),
        );
      } else {
        setMilestones((current) =>
          current.map((milestone) =>
            milestone.id === formMode.id
              ? {
                  ...milestone,
                  title: trimmedTitle,
                  target: optionalTarget,
                  unit: optionalUnit,
                  period: optionalPeriod,
                  startDate: optionalStart,
                  endDate: optionalEnd,
                  category: optionalCategory,
                  status: itemStatus,
                }
              : milestone,
          ),
        );
      }
    }

    if (formMode.type === 'habit') {
      if (!trimmedStart || !trimmedEnd) {
        return;
      }

      const orderedDays = WEEKDAYS.filter((day) =>
        scheduledDays.includes(day),
      );

      if (formMode.action === 'create') {
        const link = resolveItemLink(formMode.link, itemLinked);
        const created = todayDateString();
        const siblings = habits.filter(
          (habit) =>
            !habit.deletedAt &&
            habit.linkedGoalId === link.linkedGoalId &&
            habit.linkedGoalType === link.linkedGoalType,
        );
        const maxOrder = siblings.reduce(
          (max, habit) => Math.max(max, habit.sortOrder ?? -1),
          -1,
        );
        const newHabit: Habit = {
          id: createId('habit'),
          title: trimmedTitle,
          sortOrder: maxOrder + 1,
          scheduledDays: orderedDays,
          weeklyTarget: orderedDays.length,
          ...link,
          streakCount: 0,
          completionLog: [],
          createdDate: created,
          startDate: trimmedStart,
          endDate: trimmedEnd,
          status: 'active',
        };
        setHabits((current) => [...current, newHabit]);
      } else {
        setHabits((current) =>
          current.map((habit) =>
            habit.id === formMode.id
              ? {
                  ...habit,
                  title: trimmedTitle,
                  scheduledDays: orderedDays,
                  weeklyTarget: orderedDays.length,
                  startDate: trimmedStart,
                  endDate: trimmedEnd,
                  status: itemStatus,
                }
              : habit,
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
    const datesOptional = formMode.type === 'milestone';
    if (!datesOptional && (!trimmedStart || !trimmedEnd)) {
      return;
    }

    if (formMode.action === 'edit' && formMode.type === 'habit') {
      const existing = habits.find((item) => item.id === formMode.id);

      if (existing) {
        const conflicts = detectDateRangeConflicts(
          existing.completionLog,
          existing.startDate ?? existing.createdDate,
          existing.endDate ?? trimmedEnd,
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
      goals,
      milestones,
      habits,
    );
    setStartDate(values.startDate);
    setEndDate(values.endDate);
    setDateConflictPrompt(null);
  };

  const promptDeleteHabit = (habit: Habit) => {
    setDeletePrompt({
      kind: 'habit',
      id: habit.id,
      title: habit.title,
    });
  };

  const promptDeleteMilestone = (milestone: Milestone) => {
    const parentGoal = goals.find((goal) => goal.id === milestone.goalId);
    setMilestoneKeepChoice('standalone');
    setDeletePrompt({
      kind: 'milestone',
      id: milestone.id,
      title: milestone.title,
      dependentCount: countMilestoneDependents(milestone.id, habits),
      parentGoalTitle: parentGoal?.title ?? 'Goal',
      parentGoalId: milestone.goalId,
    });
  };

  const promptDeleteGoal = (goal: Goal) => {
    const otherGoals = allUndeletedGoals.filter(
      (item) => item.id !== goal.id && item.status !== 'done',
    );
    setReassignGoalId(otherGoals[0]?.id ?? null);
    setDeletePrompt({
      kind: 'goal',
      id: goal.id,
      title: goal.title,
      dependentCount: countGoalDependents(goal.id, milestones, habits),
      milestoneCount: milestonesForGoal(milestones, goal.id).length,
      otherGoals,
    });
  };

  const confirmDelete = (cascade = false) => {
    if (!deletePrompt) {
      return;
    }

    if (deletePrompt.kind === 'habit') {
      softDeleteHabit(deletePrompt.id);
    } else if (deletePrompt.kind === 'milestone') {
      if (cascade) {
        softDeleteMilestone(deletePrompt.id, true);
      } else {
        softDeleteMilestone(
          deletePrompt.id,
          false,
          milestoneKeepChoice === 'relinkGoal',
        );
      }
    } else if (deletePrompt.kind === 'goal') {
      if (cascade) {
        softDeleteGoal(deletePrompt.id, true);
      } else {
        softDeleteGoal(
          deletePrompt.id,
          false,
          reassignGoalId ?? undefined,
        );
      }
    }

    setDeletePrompt(null);
  };

  const confirmMove = (target: MoveTarget) => {
    if (!movePrompt) {
      return;
    }

    if (movePrompt.kind === 'habit') {
      moveHabit(movePrompt.id, target);
    } else if (movePrompt.kind === 'milestone' && target.scope === 'goal') {
      moveMilestone(movePrompt.id, target.goalId);
    }

    setMovePrompt(null);
  };

  const formTitle = getFormTitle(formMode);
  const isEdit = formMode?.action === 'edit';
  const canAddChildFromEdit =
    isEdit &&
    (formMode?.type === 'goal' || formMode?.type === 'milestone');

  const linkHint =
    formMode?.action === 'create' && formMode.type === 'habit'
      ? formMode.link.scope === 'goal'
        ? 'Will link to this Goal'
        : formMode.link.scope === 'milestone'
          ? itemLinked
            ? 'Will link to this Milestone'
            : 'Will be standalone'
          : 'Will be standalone'
      : null;

  const canSubmit =
    title.trim().length > 0 &&
    (formMode?.type === 'milestone'
      ? true
      : startDate.trim().length > 0 && endDate.trim().length > 0);

  const handleFormAddChild = () => {
    if (!formMode || formMode.action !== 'edit' || !canSubmit) {
      return;
    }
    if (formMode.type !== 'goal' && formMode.type !== 'milestone') {
      return;
    }

    const parentType = formMode.type;
    const parentId = formMode.id;
    applySave();
    setChildTypeMenu({ parentType, parentId });
  };

  const handleChildTypeSelected = (childType: 'milestone' | 'habit') => {
    if (!childTypeMenu) {
      return;
    }

    const { parentType, parentId } = childTypeMenu;
    setChildTypeMenu(null);

    if (parentType === 'goal') {
      if (childType === 'milestone') {
        openCreateForm({
          type: 'milestone',
          action: 'create',
          goalId: parentId,
        });
        return;
      }
      openCreateForm({
        type: 'habit',
        action: 'create',
        link: { scope: 'goal', goalId: parentId },
      });
      return;
    }

    openCreateForm({
      type: 'habit',
      action: 'create',
      link: { scope: 'milestone', milestoneId: parentId },
    });
  };

  const moveOptions = useMemo(() => {
    if (!movePrompt) {
      return [];
    }

    if (movePrompt.kind === 'milestone') {
      return visibleGoals
        .filter((goal) => goal.id !== movePrompt.currentGoalId)
        .map((goal) => ({
          label: goal.title,
          target: {
            scope: 'goal' as const,
            goalId: goal.id,
          },
        }));
    }

    const options: { label: string; target: MoveTarget }[] = [
      { label: 'Standalone', target: { scope: 'standalone' } },
    ];

    for (const goal of visibleGoals) {
      options.push({
        label: `Goal: ${goal.title}`,
        target: { scope: 'goal', goalId: goal.id },
      });
    }

    for (const milestone of activeMilestones) {
      const parent = visibleGoals.find(
        (goal) => goal.id === milestone.goalId,
      );
      options.push({
        label: `Milestone: ${milestone.title}${
          parent ? ` (${parent.title})` : ''
        }`,
        target: { scope: 'milestone', milestoneId: milestone.id },
      });
    }

    return options;
  }, [movePrompt, visibleGoals, activeMilestones]);

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        <View style={styles.goalsTitleRow}>
          <Text style={styles.screenTitle}>Goals</Text>
          <Pressable
            onPress={() => setTypeMenuVisible(true)}
            style={({ pressed }) => [
              styles.addIconButton,
              pressed && styles.pressed,
            ]}
            accessibilityLabel="Add item"
          >
            <Ionicons name="add" size={36} color="#111" />
          </Pressable>
        </View>

        {standaloneHabits.length > 0 ? (
          <View style={styles.standaloneSection}>
            <Text style={styles.standaloneTitle}>Standalone Habits</Text>
            <View style={styles.subList}>
              {standaloneHabits.map((habit) => (
                <HabitListItem
                  key={habit.id}
                  habit={habit}
                  onEdit={() =>
                    openEditForm({
                      type: 'habit',
                      action: 'edit',
                      id: habit.id,
                    })
                  }
                  onMove={() =>
                    setMovePrompt({
                      kind: 'habit',
                      id: habit.id,
                      title: habit.title,
                    })
                  }
                  onDelete={() => promptDeleteHabit(habit)}
                />
              ))}
            </View>
          </View>
        ) : null}

        {visibleGoals.map((goal) => {
          const isGoalExpanded = expandedGoalIds.has(goal.id);
          const goalMilestones = milestonesForGoal(milestones, goal.id);
          const goalHabits = linkedHabitsForGoal(habits, goal.id);

          return (
            <View key={goal.id} style={styles.card}>
              <SwipeableRow
                onEdit={() =>
                  openEditForm({
                    type: 'goal',
                    action: 'edit',
                    id: goal.id,
                  })
                }
                onDelete={() => promptDeleteGoal(goal)}
              >
                <View style={styles.cardHeader}>
                  <Pressable
                    onPress={() =>
                      openEditForm({
                        type: 'goal',
                        action: 'edit',
                        id: goal.id,
                      })
                    }
                    style={({ pressed }) => [pressed && styles.pressed]}
                  >
                    <Text
                      style={[
                        styles.goalTitle,
                        goal.status === 'done' && styles.titleDone,
                      ]}
                    >
                      {goal.title}
                    </Text>
                  </Pressable>
                  {formatTargetLabel(goal) ? (
                    <Text style={styles.goalTarget}>
                      {formatTargetLabel(goal)}
                    </Text>
                  ) : null}
                  <View style={styles.dateExpandRow}>
                    <Text style={styles.goalDate}>
                      {formatDate(goal.startDate)} –{' '}
                      {formatDate(goal.endDate)}
                    </Text>
                    <Pressable
                      onPress={() => toggleGoal(goal.id)}
                      hitSlop={8}
                      style={({ pressed }) => [
                        styles.expandButton,
                        pressed && styles.pressed,
                      ]}
                      accessibilityLabel={
                        isGoalExpanded ? 'Collapse' : 'Expand'
                      }
                    >
                      <Ionicons
                        name={
                          isGoalExpanded ? 'chevron-up' : 'chevron-down'
                        }
                        size={22}
                        color="#666"
                      />
                    </Pressable>
                  </View>
                </View>
              </SwipeableRow>

              {isGoalExpanded ? (
                <View style={styles.childList}>
                  {goalHabits.length > 0 ? (
                    <View style={styles.subList}>
                      {goalHabits.map((habit) => (
                        <HabitListItem
                          key={habit.id}
                          habit={habit}
                          onEdit={() =>
                            openEditForm({
                              type: 'habit',
                              action: 'edit',
                              id: habit.id,
                            })
                          }
                          onMove={() =>
                            setMovePrompt({
                              kind: 'habit',
                              id: habit.id,
                              title: habit.title,
                            })
                          }
                          onDelete={() => promptDeleteHabit(habit)}
                        />
                      ))}
                    </View>
                  ) : null}

                  {goalMilestones.map((milestone) => (
                    <MilestoneRow
                      key={milestone.id}
                      milestone={milestone}
                      habits={habits}
                      isExpanded={expandedMilestoneIds.has(milestone.id)}
                      onToggleExpand={() => toggleMilestone(milestone.id)}
                      onEdit={() =>
                        openEditForm({
                          type: 'milestone',
                          action: 'edit',
                          id: milestone.id,
                        })
                      }
                      onMove={() =>
                        setMovePrompt({
                          kind: 'milestone',
                          id: milestone.id,
                          title: milestone.title,
                          currentGoalId: milestone.goalId,
                        })
                      }
                      onDelete={() => promptDeleteMilestone(milestone)}
                      onEditHabit={(habit) =>
                        openEditForm({
                          type: 'habit',
                          action: 'edit',
                          id: habit.id,
                        })
                      }
                      onMoveHabit={(habit) =>
                        setMovePrompt({
                          kind: 'habit',
                          id: habit.id,
                          title: habit.title,
                        })
                      }
                      onDeleteHabit={promptDeleteHabit}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      <Modal
        visible={typeMenuVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setTypeMenuVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.menuCard}>
            <Text style={styles.modalTitle}>Add</Text>
            {(
              [
                { label: 'Goal', type: 'goal' as const },
                { label: 'Milestone', type: 'milestone' as const },
                { label: 'Habit', type: 'habit' as const },
              ] as const
            ).map((option) => (
              <Pressable
                key={option.type}
                onPress={() => handleTypeSelected(option.type)}
                style={({ pressed }) => [
                  styles.choiceRow,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.choiceText}>{option.label}</Text>
              </Pressable>
            ))}
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setTypeMenuVisible(false)}
                style={styles.modalButtonSecondary}
              >
                <Text style={styles.modalButtonSecondaryText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={childTypeMenu !== null}
        animationType="fade"
        transparent
        onRequestClose={() => setChildTypeMenu(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.menuCard}>
            <Text style={styles.modalTitle}>Add</Text>
            {childTypeMenu?.parentType === 'goal'
              ? (
                  [
                    { label: 'Milestone', type: 'milestone' as const },
                    { label: 'Habit', type: 'habit' as const },
                  ] as const
                ).map((option) => (
                  <Pressable
                    key={option.type}
                    onPress={() => handleChildTypeSelected(option.type)}
                    style={({ pressed }) => [
                      styles.choiceRow,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.choiceText}>{option.label}</Text>
                  </Pressable>
                ))
              : (
                  [{ label: 'Habit', type: 'habit' as const }] as const
                ).map((option) => (
                  <Pressable
                    key={option.type}
                    onPress={() => handleChildTypeSelected(option.type)}
                    style={({ pressed }) => [
                      styles.choiceRow,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.choiceText}>{option.label}</Text>
                  </Pressable>
                ))}
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setChildTypeMenu(null)}
                style={styles.modalButtonSecondary}
              >
                <Text style={styles.modalButtonSecondaryText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={linkPickerType !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setLinkPickerType(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              Link this {linkPickerType === 'milestone' ? 'Milestone' : 'Habit'}{' '}
              to:
            </Text>
            {linkPickerType === 'milestone' && visibleGoals.length === 0 ? (
              <Text style={styles.dialogBody}>
                Create a Goal first — Milestones must belong to a Goal.
              </Text>
            ) : (
              <ScrollView style={styles.moveList}>
                {linkPickerOptions.map((option) => (
                  <Pressable
                    key={option.label}
                    onPress={option.onPress}
                    style={({ pressed }) => [
                      styles.choiceRow,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.choiceText}>{option.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setLinkPickerType(null)}
                style={styles.modalButtonSecondary}
              >
                <Text style={styles.modalButtonSecondaryText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

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
              <View style={styles.formTitleRow}>
                <Text style={[styles.modalTitle, styles.formTitleText]}>
                  {formTitle}
                </Text>
                {canAddChildFromEdit ? (
                  <Pressable
                    onPress={handleFormAddChild}
                    disabled={!canSubmit}
                    style={({ pressed }) => [
                      styles.addIconButton,
                      !canSubmit && styles.modalButtonDisabled,
                      pressed && canSubmit && styles.pressed,
                    ]}
                    accessibilityLabel="Add child item"
                  >
                    <Ionicons name="add" size={28} color="#111" />
                  </Pressable>
                ) : null}
              </View>

              {formMode?.type === 'goal' ? (
                <View style={styles.goalFormFields}>
                  <FormFieldRow label="Title">
                    <TextInput
                      style={styles.formInlineInput}
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
                    <TextInput
                      style={styles.formInlineInput}
                      value={target}
                      onChangeText={setTarget}
                      placeholder="Optional"
                      keyboardType="numeric"
                    />
                  </FormFieldRow>

                  <FormFieldRow label="Unit">
                    <TextInput
                      style={styles.formInlineInput}
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

                  <FormDateRow
                    label="End"
                    value={endDate}
                    onChange={setEndDate}
                  />

                  <FormFieldRow label="Status">
                    <Pressable
                      onPress={() =>
                        setItemStatus((current) => cycleGoalStatus(current))
                      }
                      style={({ pressed }) => [
                        styles.statusChip,
                        itemStatus === 'active' && styles.statusChipActive,
                        itemStatus === 'done' && styles.statusChipDone,
                        pressed && styles.pressed,
                      ]}
                      accessibilityLabel={`Status ${itemStatus}. Tap to change.`}
                    >
                      <Text style={styles.statusChipText}>{itemStatus}</Text>
                    </Pressable>
                  </FormFieldRow>
                </View>
              ) : null}

              {formMode?.type === 'milestone' ? (
                <View style={styles.goalFormFields}>
                  <FormFieldRow label="Title">
                    <TextInput
                      style={styles.formInlineInput}
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
                    <TextInput
                      style={styles.formInlineInput}
                      value={target}
                      onChangeText={setTarget}
                      placeholder="Optional"
                      keyboardType="numeric"
                    />
                  </FormFieldRow>

                  <FormFieldRow label="Unit">
                    <TextInput
                      style={styles.formInlineInput}
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

                  <FormDateRow
                    label="End"
                    value={endDate}
                    onChange={setEndDate}
                  />

                  <FormFieldRow label="Status">
                    <Pressable
                      onPress={() =>
                        setItemStatus((current) => cycleGoalStatus(current))
                      }
                      style={({ pressed }) => [
                        styles.statusChip,
                        itemStatus === 'active' && styles.statusChipActive,
                        itemStatus === 'done' && styles.statusChipDone,
                        pressed && styles.pressed,
                      ]}
                      accessibilityLabel={`Status ${itemStatus}. Tap to change.`}
                    >
                      <Text style={styles.statusChipText}>{itemStatus}</Text>
                    </Pressable>
                  </FormFieldRow>
                </View>
              ) : null}

              {formMode?.type === 'habit' ? (
                <View style={styles.goalFormFields}>
                  <FormFieldRow label="Title">
                    <TextInput
                      style={styles.formInlineInput}
                      value={title}
                      onChangeText={setTitle}
                      placeholder="Enter title"
                      autoFocus
                    />
                  </FormFieldRow>

                  <View style={styles.formStackedBlock}>
                    <Text style={styles.formFieldLabel}>Days</Text>
                    <DayPicker
                      selectedDays={scheduledDays}
                      onToggleDay={toggleScheduledDay}
                    />
                  </View>

                  <FormFieldRow label="Weekly">
                    <Text style={styles.formReadOnlyValue}>
                      {scheduledDays.length} day
                      {scheduledDays.length === 1 ? '' : 's'}/week
                    </Text>
                  </FormFieldRow>

                  <FormDateRow
                    label="Start"
                    value={startDate}
                    onChange={setStartDate}
                  />

                  <FormDateRow
                    label="End"
                    value={endDate}
                    onChange={setEndDate}
                  />
                </View>
              ) : null}

              {linkHint ? (
                <Text style={styles.linkHint}>{linkHint}</Text>
              ) : null}

              {formMode?.action === 'create' &&
              formMode.type === 'habit' &&
              formMode.link.scope === 'milestone' ? (
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>
                    Linked to this Milestone
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
            {deletePrompt?.kind === 'habit' ? (
              <>
                <Text style={styles.modalTitle}>Delete Habit?</Text>
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

            {deletePrompt?.kind === 'milestone' ? (
              <>
                <Text style={styles.modalTitle}>Delete Milestone?</Text>
                {deletePrompt.dependentCount > 0 ? (
                  <>
                    <Text style={styles.dialogBody}>
                      This Milestone has {deletePrompt.dependentCount} linked
                      habit
                      {deletePrompt.dependentCount === 1 ? '' : 's'}. What would
                      you like to do with them?
                    </Text>
                    <Pressable
                      onPress={() => setMilestoneKeepChoice('standalone')}
                      style={[
                        styles.choiceRow,
                        milestoneKeepChoice === 'standalone' &&
                          styles.choiceRowSelected,
                      ]}
                    >
                      <Text style={styles.choiceText}>
                        Keep linked habits (make standalone)
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setMilestoneKeepChoice('relinkGoal')}
                      style={[
                        styles.choiceRow,
                        milestoneKeepChoice === 'relinkGoal' &&
                          styles.choiceRowSelected,
                      ]}
                    >
                      <Text style={styles.choiceText}>
                        Re-link to {deletePrompt.parentGoalTitle}
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
                          Delete Milestone
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

            {deletePrompt?.kind === 'goal' ? (
              <>
                <Text style={styles.modalTitle}>Delete Goal?</Text>
                {deletePrompt.dependentCount > 0 ? (
                  <>
                    <Text style={styles.dialogBody}>
                      This Goal has {deletePrompt.dependentCount} linked item
                      {deletePrompt.dependentCount === 1 ? '' : 's'}. What would
                      you like to do with them?
                    </Text>
                    {deletePrompt.milestoneCount > 0 &&
                    deletePrompt.otherGoals.length > 0 ? (
                      <>
                        <Text style={styles.fieldLabel}>
                          Move Milestones to
                        </Text>
                        {deletePrompt.otherGoals.map((otherGoal) => (
                          <Pressable
                            key={otherGoal.id}
                            onPress={() => setReassignGoalId(otherGoal.id)}
                            style={[
                              styles.choiceRow,
                              reassignGoalId === otherGoal.id &&
                                styles.choiceRowSelected,
                            ]}
                          >
                            <Text style={styles.choiceText}>
                              {otherGoal.title}
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
                        Keep Habits as standalone
                        {deletePrompt.milestoneCount > 0 &&
                        deletePrompt.otherGoals.length === 0
                          ? ' (Milestones will also be deleted)'
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
              Select a new{' '}
              {movePrompt?.kind === 'milestone' ? 'Goal' : 'parent'}:
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
    flex: 1,
  },
  goalsTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  addIconButton: {
    padding: 4,
    marginLeft: 8,
  },
  menuCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 20,
    marginHorizontal: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
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
  dateExpandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 4,
  },
  expandButton: {
    padding: 4,
  },
  goalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111',
    marginBottom: 6,
  },
  goalTarget: {
    fontSize: 13,
    color: '#666',
    marginBottom: 4,
  },
  goalDate: {
    fontSize: 14,
    color: '#666',
  },
  childList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5ea',
    padding: 12,
    gap: 8,
  },
  milestoneCard: {
    backgroundColor: '#f9f9fb',
    borderRadius: 10,
    overflow: 'hidden',
  },
  milestoneHeader: {
    padding: 12,
  },
  milestoneTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#222',
    marginBottom: 4,
  },
  milestoneProgress: {
    fontSize: 14,
    color: '#555',
  },
  milestoneDates: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  dateExpandSpacer: {
    flex: 1,
  },
  linkedSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5ea',
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 6,
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
  formTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  formTitleText: {
    flex: 1,
    marginBottom: 0,
  },
  titleDone: {
    textDecorationLine: 'line-through',
  },
  statusChip: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#f0f0f2',
    marginBottom: 4,
  },
  statusChipActive: {
    backgroundColor: '#e8f1ff',
  },
  statusChipDone: {
    backgroundColor: '#e8e8e8',
  },
  statusChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    textTransform: 'lowercase',
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
  goalFormFields: {
    gap: 10,
    marginTop: 4,
  },
  formFieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 40,
  },
  formFieldLabel: {
    width: 78,
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
  },
  formFieldControl: {
    flex: 1,
  },
  formInlineInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    color: '#111',
    backgroundColor: '#fff',
  },
  formSelectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  formSelectText: {
    flex: 1,
    fontSize: 15,
    color: '#111',
  },
  formSelectPlaceholder: {
    color: '#aaa',
  },
  formStackedBlock: {
    gap: 8,
  },
  formReadOnlyValue: {
    fontSize: 15,
    color: '#444',
    paddingVertical: 10,
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
