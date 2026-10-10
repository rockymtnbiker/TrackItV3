import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Children, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { EditableOrderedRow } from '../components/EditableOrderedRow';
import { DatePickerModal } from '../components/DatePickerModal';
import {
  FormDateRow,
  FormFieldRow,
  FormInlineInput,
  FormSelectRow,
  formFieldStyles,
} from '../components/FormFields';
import { KeyboardSafe } from '../components/KeyboardSafe';
import { confirmDeleteGoal, descendantIds } from '../lib/goalDeleteConfirm';
import { PendingStatusCircle } from '../components/PendingStatusCircle';
import { ProgressLineChart } from '../components/ProgressLineChart';
import { UNIT_OPTIONS } from '../constants';
import {
  createGoal,
  deleteGoal,
  getAllGoals,
  getEntries,
  reorderGoals,
  setGoalStatus,
  updateGoal,
} from '../lib/goalTreeApi';
import {
  buildChildrenMap,
  isDaily,
  paceInfo,
  periodTotal,
  rollupTotal,
} from '../lib/goalTree';
import {
  buildProgressSeries,
  dailyAmounts,
  goalStartDate,
  monthlyPlanned,
  planSources,
  weeklyTarget,
} from '../lib/metrics';
import type { GoalsStackParamList } from '../navigation/GoalsStackNavigator';
import type {
  GoalEntry,
  Goal,
  GoalStatus,
  RepeatPeriod,
} from '../types/goal';
import { nextGoalStatus } from '../types';
import {
  addDays,
  dateFromIso,
  getWeekStart,
  isoFromDate,
  parseDateString,
  todayDateString,
} from '../utils/date';

type Props = NativeStackScreenProps<GoalsStackParamList, 'StepDetail'>;

const CUSTOM_UNIT = '__custom__';
const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const UNIT_CHOICES = [
  ...UNIT_OPTIONS.map((unit) => ({ value: unit, label: unit })),
  { value: CUSTOM_UNIT, label: 'Custom…' },
];

const ALL_PLANNED_DAYS = [0, 1, 2, 3, 4, 5, 6];

const PERIOD_CHOICES = [
  { value: 'daily', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
];

function isPresetUnit(unit: string): boolean {
  return (UNIT_OPTIONS as readonly string[]).includes(unit);
}

function cappedToToday(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const today = todayDateString();
  return trimmed > today ? today : trimmed;
}

function parseAmount(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const amount = Number(trimmed);
  return Number.isFinite(amount) ? amount : null;
}

function periodWord(period: RepeatPeriod | null): string {
  return period === 'month' ? 'month' : 'week';
}

function TimelineRows({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children);
  return (
    <View>
      {rows.map((row, index) => (
        <View
          key={index}
          style={index < rows.length - 1 ? styles.hairlineRow : undefined}
        >
          {row}
        </View>
      ))}
    </View>
  );
}

function DetailCard({
  title,
  guide,
  headerRight,
  children,
}: {
  title?: string;
  guide?: string;
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={styles.detailCard}>
      {title ? (
        <View style={styles.cardIntro}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardHeader}>{title}</Text>
            {headerRight}
          </View>
          {guide ? <Text style={styles.cardGuide}>{guide}</Text> : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** Same-unit daily totals the progress bar rolls up, including days before the start. */
function rolledUpEntries(
  node: Goal,
  nodes: Goal[],
  entries: GoalEntry[],
  endDate: string,
  today: string,
): GoalEntry[] {
  const last = endDate.slice(0, 10) > today ? endDate.slice(0, 10) : today;
  const amounts = dailyAmounts(node, nodes, entries, '1970-01-01', last);
  return [...amounts].map(([date, value]) => ({
    id: date,
    goalId: node.id,
    entryDate: date,
    value,
  }));
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

function descendantCount(rootId: string, nodes: Goal[]): number {
  return Math.max(0, subtreeIds(rootId, nodes).length - 1);
}

function formatMetricAmount(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function daysFrom(start: string, end: string): number {
  const ms =
    parseDateString(end.slice(0, 10)).getTime() -
    parseDateString(start.slice(0, 10)).getTime();
  return Math.round(ms / 86_400_000);
}

const WEEK_WINDOW = 6;

function visibleWeekStarts(
  bottom: string,
  startWeek: string,
  currentWeek: string,
): string[] {
  const weeks: string[] = [];
  for (let index = WEEK_WINDOW - 1; index >= 0; index -= 1) {
    const start = addDays(bottom, -7 * index);
    if (start >= startWeek && start <= currentWeek) {
      weeks.push(start);
    }
  }
  return weeks;
}

function weekAmount(
  weekStart: string,
  amounts: Map<string, number>,
  startDate: string,
  today: string,
): number {
  let total = 0;
  for (let index = 0; index < 7; index += 1) {
    const date = addDays(weekStart, index);
    if (date < startDate || date > today) {
      continue;
    }
    total += amounts.get(date) ?? 0;
  }
  return total;
}

function MetricsSections({
  node,
  nodes,
  entries,
}: {
  node: Goal;
  nodes: Goal[];
  entries: GoalEntry[];
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const sources = planSources(node, nodes);

  useEffect(() => {
    setWeekOffset(0);
  }, [node.id]);

  if (node.unit == null || sources.length === 0) {
    return null;
  }

  const today = todayDateString();
  const startDate = goalStartDate(node);
  const currentWeek = getWeekStart(today);
  const startWeek = getWeekStart(startDate);
  const historyWeeks =
    startWeek <= currentWeek
      ? Math.round(daysFrom(startWeek, currentWeek) / 7) + 1
      : 0;
  const maxOffset = Math.max(0, historyWeeks - WEEK_WINDOW);
  if (weekOffset > maxOffset) {
    setWeekOffset(maxOffset);
  }
  const offset = Math.min(weekOffset, maxOffset);
  const bottom = addDays(currentWeek, -7 * offset);
  const weeks =
    historyWeeks > 0 ? visibleWeekStarts(bottom, startWeek, currentWeek) : [];
  const canGoBack = offset < maxOffset;
  const canGoForward = offset > 0;

  const month = parseDateString(today);
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEndDate = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const monthEnd = `${today.slice(0, 7)}-${String(monthEndDate.getDate()).padStart(2, '0')}`;
  const monthFrom = startDate > monthStart ? startDate : monthStart;
  const monthAmounts = dailyAmounts(node, nodes, entries, monthFrom, monthEnd);
  let completed = 0;
  for (const value of monthAmounts.values()) {
    completed += value;
  }
  const planned = monthlyPlanned(sources, today, startDate);
  const monthPct = planned > 0 ? Math.round((completed / planned) * 100) : null;
  const monthName = month.toLocaleDateString(undefined, { month: 'long' });

  const windowFrom = weeks[0] ?? today;
  const windowTo = weeks.length > 0 ? addDays(weeks[weeks.length - 1], 6) : today;
  const weekAmounts = dailyAmounts(node, nodes, entries, windowFrom, windowTo);

  let amountSum = 0;
  let pctSum = 0;
  const weekRows = weeks.map((weekStart) => {
    const total = weekAmount(weekStart, weekAmounts, startDate, today);
    const target = weeklyTarget(sources, weekStart);
    const pct = target > 0 ? (total / target) * 100 : null;
    const weekEnd = addDays(weekStart, 6);
    const met = target > 0 && total >= target;
    const missed = target > 0 && !met && weekEnd < today;
    amountSum += total;
    pctSum += pct ?? 0;
    return { weekStart, total, pct, met, missed };
  });

  const includesCurrent = weeks.includes(currentWeek);
  const divisor = includesCurrent
    ? weeks.filter((start) => start !== currentWeek).length +
      Math.min(7, Math.max(0, daysFrom(currentWeek, today) + 1)) / 7
    : weeks.length;
  const avgAmount = divisor > 0 ? amountSum / divisor : 0;
  const avgPct = divisor > 0 ? pctSum / divisor : 0;

  return (
    <>
      <View style={styles.metricsCard}>
        <Text style={styles.metricsTitle}>{monthName}</Text>
        <View style={styles.metricsLabelRow}>
          <Text style={styles.progress}>
            {formatMetricAmount(completed)} / {formatMetricAmount(planned)}{' '}
            {node.unit}
          </Text>
          <Text style={styles.progress}>
            {monthPct == null ? '—' : `${monthPct}%`}
          </Text>
        </View>
        <View style={styles.barTrack}>
          <View
            style={[
              styles.barFill,
              {
                width: `${Math.max(0, Math.min(100, monthPct ?? 0))}%`,
              },
            ]}
          />
        </View>
      </View>

      {weeks.length > 0 ? (
        <View style={styles.metricsCard}>
          <View style={styles.weekNav}>
            <Text style={styles.metricsTitle}>Weeks</Text>
            <View style={styles.weekNavButtons}>
              <Pressable
                onPress={() =>
                  setWeekOffset((value) => Math.min(maxOffset, value + 1))
                }
                disabled={!canGoBack}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Earlier weeks"
                accessibilityState={{ disabled: !canGoBack }}
                style={({ pressed }) => [
                  styles.weekNavButton,
                  !canGoBack && styles.weekNavDisabled,
                  pressed && canGoBack && styles.pressed,
                ]}
              >
                <Ionicons name="chevron-up" size={18} color="#007aff" />
              </Pressable>
              <Pressable
                onPress={() =>
                  setWeekOffset((value) => Math.max(0, value - 1))
                }
                disabled={!canGoForward}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Later weeks"
                accessibilityState={{ disabled: !canGoForward }}
                style={({ pressed }) => [
                  styles.weekNavButton,
                  !canGoForward && styles.weekNavDisabled,
                  pressed && canGoForward && styles.pressed,
                ]}
              >
                <Ionicons name="chevron-down" size={18} color="#007aff" />
              </Pressable>
            </View>
          </View>

          <View style={styles.weekRow}>
            {DAY_LABELS.map((label, index) => (
              <View key={`${label}-${index}`} style={styles.dayCell}>
                <Text style={styles.dayHeaderText}>{label}</Text>
              </View>
            ))}
            <View style={styles.totalCell}>
              <Text style={styles.dayHeaderText}>Total</Text>
            </View>
            <View style={styles.pctCell}>
              <Text style={styles.dayHeaderText}>%</Text>
            </View>
          </View>

          {weekRows.map((row) => (
            <View key={row.weekStart} style={styles.weekRow}>
              {DAY_LABELS.map((_, index) => {
                const date = addDays(row.weekStart, index);
                const blank = date < startDate || date > today;
                return (
                  <View key={date} style={styles.dayCell}>
                    <Text style={styles.dayAmount}>
                      {blank
                        ? ''
                        : formatMetricAmount(weekAmounts.get(date) ?? 0)}
                    </Text>
                  </View>
                );
              })}
              <View style={styles.totalCell}>
                <Text style={styles.dayAmount}>
                  {formatMetricAmount(row.total)}
                </Text>
              </View>
              <View style={styles.pctCell}>
                <Text style={styles.dayAmount}>
                  {row.pct == null ? '—' : `${Math.round(row.pct)}%`}
                </Text>
                {row.met ? (
                  <Text style={styles.markMet}>✓</Text>
                ) : row.missed ? (
                  <Text style={styles.markMissed}>✗</Text>
                ) : (
                  <Text style={styles.markSpacer}> </Text>
                )}
              </View>
            </View>
          ))}

          <View style={[styles.weekRow, styles.weekSummaryRow]}>
            <View style={styles.avgLabelCell}>
              <Text style={styles.dayHeaderText}>Avg</Text>
            </View>
            <View style={styles.totalCell}>
              <Text style={styles.dayAmount}>{formatMetricAmount(avgAmount)}</Text>
            </View>
            <View style={styles.pctCell}>
              <Text style={styles.dayAmount}>
                {weekRows.some((row) => row.pct != null)
                  ? `${Math.round(avgPct)}%`
                  : '—'}
              </Text>
              <Text style={styles.markSpacer}> </Text>
            </View>
          </View>
        </View>
      ) : null}
    </>
  );
}

function deleteMessage(count: number): string {
  if (count <= 0) {
    return 'This step will be deleted.';
  }
  if (count === 1) {
    return 'This step and 1 step inside it will be deleted.';
  }
  return `This step and ${count} steps inside it will be deleted.`;
}

function StatusCircle({
  status,
  onPress,
}: {
  status: GoalStatus;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.statusHit, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Status ${status}. Tap to change.`}
    >
      {status === 'pending' ? (
        <PendingStatusCircle size={22} color="#b0b0b5" />
      ) : (
        <Ionicons
          name={status === 'done' ? 'radio-button-on' : 'radio-button-off'}
          size={24}
          color={status === 'done' ? '#34c759' : '#c7c7cc'}
        />
      )}
    </Pressable>
  );
}

export function GoalReadout({
  node,
  nodes,
  entries,
}: {
  node: Goal;
  nodes: Goal[];
  entries: GoalEntry[];
}) {
  const displayUnit = node.unit;
  const repeatOn = node.plannedDays !== null;
  const today = todayDateString();
  const total = displayUnit
    ? repeatOn
      ? periodTotal(node, entries, today)
      : (rollupTotal(node, nodes, entries) ?? 0)
    : null;
  const pace =
    displayUnit && !repeatOn ? paceInfo(node, total ?? 0, today) : null;

  return (
    <>
      {displayUnit ? (
        <View style={styles.progressCard}>
          <Text style={styles.progress}>
            {total ?? 0} / {node.targetAmount ?? '—'} {displayUnit}
            {repeatOn ? ` this ${periodWord(node.repeatPeriod)}` : ''}
          </Text>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                {
                  width: `${Math.max(
                    0,
                    Math.min(
                      100,
                      node.targetAmount
                        ? ((total ?? 0) / node.targetAmount) * 100
                        : 0,
                    ),
                  )}%`,
                },
              ]}
            />
            {pace ? (
              <View
                style={[
                  styles.paceTick,
                  {
                    left: `${Math.max(0, Math.min(100, pace.pctExpected))}%`,
                  },
                ]}
              />
            ) : null}
          </View>
          {pace && node.targetAmount != null && node.targetEndDate ? (
            <ProgressLineChart
              series={buildProgressSeries({
                entries: rolledUpEntries(
                  node,
                  nodes,
                  entries,
                  node.targetEndDate,
                  today,
                ),
                startDate: goalStartDate(node),
                endDate: node.targetEndDate,
                target: node.targetAmount,
                today,
              })}
            />
          ) : null}
          {!repeatOn && pace ? (
            <Text
              style={[
                styles.paceLine,
                pace.delta < 0 && !pace.onPace
                  ? styles.paceBehind
                  : styles.paceAhead,
              ]}
            >
              {pace.onPace
                ? 'On pace'
                : `${Math.round(pace.pctDone)}% done · ${Math.round(Math.abs(pace.delta))}% ${pace.delta < 0 ? 'behind' : 'ahead'}`}
            </Text>
          ) : null}
          {!repeatOn && !node.targetEndDate ? (
            <Text style={styles.hint}>Add a target end date to see your pace.</Text>
          ) : null}
        </View>
      ) : null}
      <MetricsSections node={node} nodes={nodes} entries={entries} />
    </>
  );
}

export default function StepDetailScreen({ navigation, route }: Props) {
  const { goalId } = route.params;
  const [node, setNode] = useState<Goal | null>(null);
  const [allNodes, setAllNodes] = useState<Goal[]>([]);
  const [entries, setEntries] = useState<GoalEntry[]>([]);
  const [children, setChildren] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [why, setWhy] = useState('');
  const [whyOpen, setWhyOpen] = useState(false);
  const [trackOn, setTrackOn] = useState(false);
  const [unitChoice, setUnitChoice] = useState('');
  const [customUnit, setCustomUnit] = useState('');
  const [target, setTarget] = useState('');
  const [repeatOn, setRepeatOn] = useState(false);
  const [repeatPeriod, setRepeatPeriod] = useState<RepeatPeriod>('week');
  const [plannedDays, setPlannedDays] = useState<number[]>([]);
  const [actualStartDate, setActualStartDate] = useState('');
  const [actualEndDate, setActualEndDate] = useState('');
  const [targetStartDate, setTargetStartDate] = useState('');
  const [targetEndDate, setTargetEndDate] = useState('');
  const [donePrompt, setDonePrompt] = useState<{
    id: string;
    scope: 'self' | 'child';
    initialDate: string;
    minimumDate: string | null;
  } | null>(null);
  const [newStepTitle, setNewStepTitle] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const skipPersistRef = useRef(false);
  const aliveRef = useRef(true);
  const childrenRef = useRef(children);
  childrenRef.current = children;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const applyNodeToDraft = useCallback((next: Goal) => {
    const preset = next.unit != null && isPresetUnit(next.unit);
    setTitle(next.title);
    setDescription(next.description ?? '');
    setWhy(next.why ?? '');
    setWhyOpen(false);
    setTrackOn(next.unit != null);
    setUnitChoice(next.unit == null ? '' : preset ? next.unit : CUSTOM_UNIT);
    setCustomUnit(next.unit != null && !preset ? next.unit : '');
    setTarget(next.targetAmount != null ? String(next.targetAmount) : '');
    setRepeatOn(next.plannedDays != null);
    setRepeatPeriod(next.repeatPeriod ?? 'week');
    setPlannedDays(next.plannedDays ?? []);
    setActualStartDate(next.actualStartDate ?? '');
    setActualEndDate(next.actualEndDate ?? '');
    setTargetStartDate(next.targetStartDate ?? '');
    setTargetEndDate(next.targetEndDate ?? '');
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const nodes = await getAllGoals();
      const found = nodes.find((item) => item.id === goalId) ?? null;
      const ids = found ? subtreeIds(found.id, nodes) : [];
      const nextEntries = ids.length > 0 ? await getEntries(ids) : [];
      setAllNodes(nodes);
      setNode(found);
      setEntries(nextEntries);
      setChildren(buildChildrenMap(nodes).get(goalId) ?? []);
      if (found) {
        applyNodeToDraft(found);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load step.';
      setLoadError(message);
      setNode(null);
    } finally {
      setLoading(false);
    }
  }, [applyNodeToDraft, goalId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const draftRef = useRef({
    title,
    description,
    why,
    trackOn,
    unitChoice,
    customUnit,
    target,
    repeatOn,
    repeatPeriod,
    plannedDays,
    actualStartDate,
    actualEndDate,
    targetStartDate,
    targetEndDate,
  });
  draftRef.current = {
    title,
    description,
    why,
    trackOn,
    unitChoice,
    customUnit,
    target,
    repeatOn,
    repeatPeriod,
    plannedDays,
    actualStartDate,
    actualEndDate,
    targetStartDate,
    targetEndDate,
  };

  const resolvedUnit = (
    choice: string,
    custom: string,
    tracking: boolean,
  ): string | null => {
    if (!tracking) {
      return null;
    }
    if (choice === CUSTOM_UNIT) {
      return custom.trim() || null;
    }
    return choice.trim() || null;
  };

  const persist = useCallback(() => {
    if (!node || skipPersistRef.current) {
      return;
    }

    const draft = draftRef.current;
    const trimmedTitle = draft.title.trim();
    if (!trimmedTitle) {
      return;
    }

    const unit = resolvedUnit(draft.unitChoice, draft.customUnit, draft.trackOn);
    const amount =
      !draft.trackOn && !draft.repeatOn ? null : parseAmount(draft.target);

    const payload = {
      title: trimmedTitle,
      description: draft.description.trim() || null,
      why: node.parentId == null ? draft.why.trim() || null : undefined,
      unit,
      targetAmount: amount,
      repeatPeriod: draft.repeatOn ? draft.repeatPeriod : null,
      plannedDays: draft.repeatOn ? draft.plannedDays : null,
      ...(draft.actualStartDate.trim()
        ? {
            actualStartDate:
              draft.actualStartDate.trim() > todayDateString()
                ? todayDateString()
                : draft.actualStartDate.trim(),
          }
        : {}),
      targetStartDate: draft.targetStartDate.trim() || null,
      targetEndDate: draft.targetEndDate.trim() || null,
      actualEndDate: cappedToToday(draft.actualEndDate),
    };
    void updateGoal(goalId, payload)
      .then((updated) => {
        setNode((current) => {
          if (current == null || current.id !== updated.id) {
            return current;
          }
          return {
            ...current,
            title: updated.title,
            description: updated.description,
            why: updated.why,
            unit: updated.unit,
            targetAmount: updated.targetAmount,
            repeatPeriod: updated.repeatPeriod,
            plannedDays: updated.plannedDays,
            actualStartDate: updated.actualStartDate,
            actualEndDate: updated.actualEndDate,
            targetStartDate: updated.targetStartDate,
            targetEndDate: updated.targetEndDate,
          };
        });
      })
      .catch((error) => {
        console.warn('Failed to save step', error);
      });
  }, [goalId, node]);

  useEffect(() => {
    const unsubscribeBlur = navigation.addListener('blur', persist);
    const unsubscribeRemove = navigation.addListener('beforeRemove', persist);
    return () => {
      unsubscribeBlur();
      unsubscribeRemove();
    };
  }, [navigation, persist]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        persist();
      }
    });
    return () => subscription.remove();
  }, [persist]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: 'Edit goal',
      headerTitleAlign: 'center',
      headerRight: () => (
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Done"
          hitSlop={8}
        >
          <Text style={styles.headerDone}>Done</Text>
        </Pressable>
      ),
    });
  }, [navigation]);

  const parent =
    node?.parentId != null
      ? (allNodes.find((item) => item.id === node.parentId) ?? null)
      : null;
  const hasChildren = children.length > 0;
  const displayUnit = resolvedUnit(unitChoice, customUnit, trackOn);
  const progressNode: Goal | null = node
    ? {
        ...node,
        unit: displayUnit,
        targetAmount: parseAmount(target),
        repeatPeriod: repeatOn ? repeatPeriod : null,
        plannedDays: repeatOn ? plannedDays : null,
        actualStartDate: actualStartDate.trim() || null,
        targetEndDate: targetEndDate.trim() || null,
      }
    : null;
  const today = todayDateString();
  const total =
    progressNode && displayUnit
      ? repeatOn
        ? periodTotal(progressNode, entries, today)
        : (rollupTotal(progressNode, allNodes, entries) ?? 0)
      : null;
  const pace =
    progressNode && displayUnit && !repeatOn
      ? paceInfo(progressNode, total ?? 0, today)
      : null;
  const doneCount = children.filter((child) => child.status === 'done').length;
  const activeCount = children.filter(
    (child) => child.status === 'active',
  ).length;

  const showingDaily = isDaily({
    repeatPeriod: repeatPeriod === 'month' ? 'month' : 'week',
    plannedDays,
    unit: trackOn ? displayUnit : null,
    targetAmount: parseAmount(target),
  });
  const periodChoice = repeatPeriod === 'month' ? 'month' : showingDaily ? 'daily' : 'week';
  const amountField = (label: string) => (
    <FormFieldRow label={label} labelWidth={150}>
      <FormInlineInput
        value={target}
        onChangeText={setTarget}
        placeholder="Optional"
        keyboardType="numeric"
      />
    </FormFieldRow>
  );

  const applySavedStatus = (updated: Goal, scope: 'self' | 'child') => {
    if (scope === 'self') {
      setNode(updated);
      setActualStartDate((current) => current.trim() || updated.actualStartDate || '');
      const end = updated.actualEndDate ?? '';
      setActualEndDate(end);
      draftRef.current = { ...draftRef.current, actualEndDate: end };
      return;
    }
    setChildren((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
    setAllNodes((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
  };

  const saveStatus = (
    id: string,
    status: GoalStatus,
    scope: 'self' | 'child',
    endDate?: string,
  ) => {
    void setGoalStatus(id, status, endDate)
      .then((updated) => applySavedStatus(updated, scope))
      .catch((error) => {
        console.warn('Failed to update status', error);
        void load();
      });
  };

  const cycleStatus = () => {
    if (!node || skipPersistRef.current) {
      return;
    }
    const next = nextGoalStatus(node.status);
    if (next === 'done') {
      setDonePrompt({
        id: goalId,
        scope: 'self',
        initialDate: actualEndDate.trim() || today,
        minimumDate: actualStartDate.trim() || null,
      });
      return;
    }
    setActualEndDate('');
    draftRef.current = { ...draftRef.current, actualEndDate: '' };
    setNode({
      ...node,
      status: next,
      actualEndDate: null,
    });
    saveStatus(goalId, next, 'self');
  };

  const cycleChildStatus = (child: Goal) => {
    const next = nextGoalStatus(child.status);
    if (next === 'done') {
      setDonePrompt({
        id: child.id,
        scope: 'child',
        initialDate: child.actualEndDate ?? today,
        minimumDate: child.actualStartDate,
      });
      return;
    }
    const clearEnd = (item: Goal): Goal =>
      item.id === child.id ? { ...item, status: next, actualEndDate: null } : item;
    setChildren((current) => current.map(clearEnd));
    setAllNodes((current) => current.map(clearEnd));
    saveStatus(child.id, next, 'child');
  };

  const confirmDoneDate = (isoDate: string) => {
    const prompt = donePrompt;
    setDonePrompt(null);
    if (!prompt || !node || skipPersistRef.current) {
      return;
    }
    const date = cappedToToday(isoDate) ?? today;
    if (prompt.scope === 'self') {
      setActualEndDate(date);
      draftRef.current = { ...draftRef.current, actualEndDate: date };
      setNode({
        ...node,
        status: 'done',
        actualEndDate: date,
      });
    } else {
      const markDone = (item: Goal): Goal =>
        item.id === prompt.id
          ? { ...item, status: 'done', actualEndDate: date }
          : item;
      setChildren((current) => current.map(markDone));
      setAllNodes((current) => current.map(markDone));
    }
    saveStatus(prompt.id, 'done', prompt.scope, date);
  };

  const cancelDoneDate = () => {
    const prompt = donePrompt;
    setDonePrompt(null);
    if (!prompt || !node) {
      return;
    }
    if (prompt.scope === 'self') {
      setActualEndDate('');
      draftRef.current = { ...draftRef.current, actualEndDate: '' };
      setNode({ ...node, status: 'active', actualEndDate: null });
      return;
    }
    const keepActive = (item: Goal): Goal =>
      item.id === prompt.id
        ? { ...item, status: 'active', actualEndDate: null }
        : item;
    setChildren((current) => current.map(keepActive));
    setAllNodes((current) => current.map(keepActive));
  };

  const openChild = (childId: string) => {
    navigation.push('StepDetail', { goalId: childId });
  };

  const confirmDelete = (id: string) => {
    const count = descendantCount(id, allNodes);
    Alert.alert('Delete step?', deleteMessage(count), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          const removed = new Set(subtreeIds(id, allNodes));
          void deleteGoal(id)
            .then(() => {
              if (id === goalId) {
                skipPersistRef.current = true;
                if (aliveRef.current) {
                  navigation.goBack();
                }
                return;
              }
              setAllNodes((current) =>
                current.filter((item) => !removed.has(item.id)),
              );
              setChildren((current) =>
                current.filter((item) => item.id !== id),
              );
              setEntries((current) =>
                current.filter((entry) => !removed.has(entry.goalId)),
              );
            })
            .catch((error) => {
              console.warn('Failed to delete step', error);
              Alert.alert(
                'Delete failed',
                error instanceof Error
                  ? error.message
                  : 'Could not delete this step.',
              );
            });
        },
      },
    ]);
  };

  const reorderChildren = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) {
      return;
    }
    setChildren((current) => {
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      if (!moved) {
        return current;
      }
      next.splice(toIndex, 0, moved);
      const ordered = next.map((item, index) => ({
        ...item,
        sortOrder: index,
      }));
      void reorderGoals(ordered.map((item) => item.id)).catch((error) => {
        console.warn('Failed to reorder steps', error);
        void load();
      });
      return ordered;
    });
  };

  const addStep = () => {
    const trimmed = newStepTitle.trim();
    if (!trimmed || !node || adding || repeatOn) {
      return;
    }
    setAdding(true);
    void createGoal({ title: trimmed, parentId: node.id })
      .then((created) => {
        setNewStepTitle('');
        navigation.push('StepDetail', { goalId: created.id });
      })
      .catch((error) => {
        console.warn('Failed to add step', error);
        Alert.alert(
          'Could not add step',
          error instanceof Error ? error.message : 'Could not add a step.',
        );
      })
      .finally(() => {
        setAdding(false);
      });
  };

  const togglePlannedDay = (day: number) => {
    const next = plannedDays.includes(day)
      ? plannedDays.filter((entry) => entry !== day)
      : [...plannedDays, day].sort((a, b) => a - b);
    setPlannedDays(next);
    const allSelected = ALL_PLANNED_DAYS.every((value) => next.includes(value));
    if (allSelected && !trackOn && repeatPeriod !== 'month') {
      setTarget('');
    }
  };

  if (loading && !node) {
    return (
      <View style={styles.missing}>
        <ActivityIndicator color="#007aff" />
      </View>
    );
  }

  if (loadError && !node) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingText}>{loadError}</Text>
        <Pressable
          onPress={() => void load()}
          style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
        >
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!node || !progressNode) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingText}>This step is no longer available.</Text>
      </View>
    );
  }

  return (
    <KeyboardSafe style={styles.container}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        scrollEnabled={draggingId == null}
      >
        {parent ? (
          <Pressable
            onPress={() =>
              navigation.push('StepDetail', { goalId: parent.id })
            }
            hitSlop={6}
            style={({ pressed }) => [
              styles.parentLink,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Open parent ${parent.title}`}
          >
            <Ionicons name="chevron-up" size={16} color="#007aff" />
            <Text style={styles.parentLinkText} numberOfLines={1}>
              {parent.title}
            </Text>
          </Pressable>
        ) : null}
        <Text style={styles.kindLabel}>
          {node.parentId == null ? 'Goal' : 'Step'}
        </Text>

        <View style={styles.detailCards}>
        <View style={styles.detailCard}>
          <FormFieldRow label="Title">
            <FormInlineInput
              value={title}
              onChangeText={setTitle}
              placeholder="Enter title"
            />
          </FormFieldRow>
          {node.parentId == null ? (
            <View style={styles.whyBlock}>
              <Text style={styles.whyLabel}>Why it matters</Text>
              {whyOpen || why.length > 0 ? (
                <TextInput
                  autoFocus={whyOpen}
                  value={why}
                  onChangeText={setWhy}
                  placeholder="What will this change for you?"
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                  onBlur={() => {
                    if (!why.trim()) {
                      setWhyOpen(false);
                    }
                  }}
                  style={formFieldStyles.formMultilineInput}
                />
              ) : (
                <Pressable
                  onPress={() => setWhyOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Add your why"
                  style={styles.whyAddHit}
                >
                  <Text style={styles.whyAdd}>+ Add your why</Text>
                </Pressable>
              )}
            </View>
          ) : null}
        </View>

        <DetailCard title="Timeline" guide="When does this happen?">
          <TimelineRows>
            <FormFieldRow label="Status">
              <View style={styles.statusRow}>
                <StatusCircle status={node.status} onPress={cycleStatus} />
                <Text style={styles.statusWord}>{node.status}</Text>
              </View>
            </FormFieldRow>
            <FormDateRow
              label="Started"
              labelWidth={118}
              value={actualStartDate}
              maximumDate={dateFromIso(
                actualEndDate.trim() && actualEndDate.trim() < today
                  ? actualEndDate.trim()
                  : today,
              )}
              onChange={setActualStartDate}
            />
            {node.status === 'done' ? (
              <FormDateRow
                label="Actual end"
                labelWidth={118}
                value={actualEndDate}
                minimumDate={
                  actualStartDate.trim()
                    ? dateFromIso(actualStartDate.trim())
                    : undefined
                }
                maximumDate={dateFromIso(today)}
                onChange={setActualEndDate}
              />
            ) : (
              <FormFieldRow label="Actual end" labelWidth={118}>
                <View>
                  <Text style={styles.lockedDate}>—</Text>
                  <Text style={styles.lockedDateCaption}>Set when marked done</Text>
                </View>
              </FormFieldRow>
            )}
            <FormDateRow
              label="Target start"
              labelWidth={118}
              value={targetStartDate}
              onChange={setTargetStartDate}
            />
            <FormDateRow
              label="Target end"
              labelWidth={118}
              value={targetEndDate}
              onChange={setTargetEndDate}
            />
          </TimelineRows>
        </DetailCard>

        <DetailCard
          title="Track an amount"
          guide="Want to measure progress? Count minutes, miles, pages and more toward a target."
          headerRight={
            <Switch
              value={trackOn}
              onValueChange={(on) => {
                setTrackOn(on);
                if (!on && !repeatOn) {
                  setTarget('');
                }
              }}
            />
          }
        >
          {trackOn ? (
            <View style={styles.fields}>
              <FormSelectRow
                label="Unit"
                value={unitChoice}
                placeholder="Choose"
                options={UNIT_CHOICES}
                onChange={setUnitChoice}
              />
              {unitChoice === CUSTOM_UNIT ? (
                <FormFieldRow label="Custom unit">
                  <FormInlineInput
                    value={customUnit}
                    onChangeText={setCustomUnit}
                    placeholder="e.g. laps"
                  />
                </FormFieldRow>
              ) : null}
              {amountField(
                repeatOn ? `Target per ${periodWord(repeatPeriod)}` : 'Total target',
              )}
            </View>
          ) : null}
        </DetailCard>

        <DetailCard
          title="Repeat"
          guide="Is this something you do regularly? Like 3 times a week, or every day."
          headerRight={
            <Switch
              value={repeatOn}
              disabled={hasChildren}
              onValueChange={(on) => {
                if (hasChildren) {
                  return;
                }
                setRepeatOn(on);
                if (on) {
                  setRepeatPeriod((current) => current ?? 'week');
                  setPlannedDays((current) => current ?? []);
                } else if (!trackOn) {
                  setTarget('');
                }
              }}
            />
          }
        >
          {hasChildren ? (
            <Text style={styles.hint}>Steps with sub-steps can't repeat.</Text>
          ) : null}
          {repeatOn ? (
            <View style={styles.fields}>
              <FormSelectRow
                label="Period"
                value={periodChoice}
                placeholder="Weekly"
                options={PERIOD_CHOICES}
                onChange={(value) => {
                  if (value === 'month') {
                    setRepeatPeriod('month');
                    return;
                  }
                  setRepeatPeriod('week');
                  if (value === 'daily') {
                    setPlannedDays(ALL_PLANNED_DAYS);
                    if (!trackOn) {
                      setTarget('');
                    }
                  }
                }}
              />
              <View style={styles.formStackedBlock}>
                <Text style={formFieldStyles.formFieldLabel}>Days</Text>
                <View style={formFieldStyles.dayPicker}>
                  {DAY_LABELS.map((label, day) => {
                    const selected = plannedDays.includes(day);
                    return (
                      <Pressable
                        key={DAY_NAMES[day]}
                        onPress={() => togglePlannedDay(day)}
                        style={({ pressed }) => [
                          formFieldStyles.dayChip,
                          selected && formFieldStyles.dayChipSelected,
                          pressed && styles.pressed,
                        ]}
                        accessibilityLabel={DAY_NAMES[day]}
                        accessibilityState={{ selected }}
                      >
                        <Text
                          style={[
                            formFieldStyles.dayChipText,
                            selected && formFieldStyles.dayChipTextSelected,
                          ]}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              {!trackOn ? amountField(`Times per ${periodWord(repeatPeriod)}`) : null}
            </View>
          ) : null}
        </DetailCard>

        <DetailCard title="Notes">
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Optional"
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            style={formFieldStyles.formMultilineInput}
          />
        </DetailCard>
        </View>

        <Pressable
          onPress={() =>
            confirmDeleteGoal(descendantIds(node.id, allNodes).length, () => {
              void deleteGoal(node.id)
                .then(() => {
                  skipPersistRef.current = true;
                  if (aliveRef.current) {
                    navigation.goBack();
                  }
                })
                .catch((error) => {
                  console.warn('Failed to delete goal', error);
                  Alert.alert(
                    'Delete failed',
                    error instanceof Error
                      ? error.message
                      : 'Could not delete this step.',
                  );
                });
            })
          }
          style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={
            node.parentId == null ? 'Delete goal' : 'Delete step'
          }
        >
          <Text style={styles.deleteButtonText}>
            {node.parentId == null ? 'Delete goal' : 'Delete step'}
          </Text>
        </Pressable>
      </ScrollView>
      {donePrompt ? (
        <DatePickerModal
          title="Actual end"
          value={dateFromIso(donePrompt.initialDate)}
          minimumDate={
            donePrompt.minimumDate ? dateFromIso(donePrompt.minimumDate) : undefined
          }
          maximumDate={dateFromIso(today)}
          onCancel={cancelDoneDate}
          onConfirm={(date) => confirmDoneDate(isoFromDate(date))}
        />
      ) : null}
    </KeyboardSafe>
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
  kindLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8e8e93',
  },
  parentLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  parentLinkText: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#007aff',
  },
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 10,
    gap: 4,
    overflow: 'visible',
  },
  detailCards: {
    gap: 12,
  },
  detailCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  cardIntro: {
    gap: 4,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardHeader: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    color: '#6B6B70',
  },
  cardGuide: {
    fontSize: 14,
    color: '#6B6B70',
  },
  whyBlock: {
    gap: 6,
  },
  whyLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111',
  },
  whyAddHit: {
    minHeight: 44,
    justifyContent: 'center',
  },
  whyAdd: {
    fontSize: 15,
    fontWeight: '600',
    color: '#007aff',
  },
  fields: {
    gap: 6,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusHit: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusWord: {
    fontSize: 15,
    color: '#111',
    textTransform: 'capitalize',
  },
  lockedDate: {
    fontSize: 15,
    color: '#C7C7CC',
    paddingVertical: 10,
  },
  lockedDateCaption: {
    fontSize: 12,
    color: '#C7C7CC',
    marginTop: -6,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    gap: 12,
  },
  switchLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111',
  },
  hint: {
    fontSize: 13,
    color: '#8e8e93',
    marginTop: -2,
  },
  formStackedBlock: {
    gap: 6,
  },
  progressCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  progress: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  barTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#e5e5ea',
    overflow: 'visible',
    position: 'relative',
  },
  barFill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#007aff',
  },
  paceTick: {
    position: 'absolute',
    top: -3,
    width: 2,
    height: 14,
    marginLeft: -1,
    borderRadius: 1,
    backgroundColor: '#111',
  },
  paceLine: {
    fontSize: 13,
    fontWeight: '600',
  },
  paceAhead: {
    color: '#248a3d',
  },
  paceBehind: {
    color: '#b8860b',
  },
  sectionPrompt: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginTop: 4,
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
    marginTop: 12,
    backgroundColor: '#fff',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    minHeight: 44,
  },
  deleteButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#c62828',
  },
  headerDone: {
    fontSize: 17,
    fontWeight: '600',
    color: '#007aff',
  },
  hairlineRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  metricsCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 10,
    gap: 6,
  },
  metricsTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111',
  },
  metricsLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  weekNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  weekNavButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  weekNavButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekNavDisabled: {
    opacity: 0.3,
  },
  weekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 20,
  },
  weekSummaryRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5ea',
    marginTop: 2,
    paddingTop: 4,
  },
  dayCell: {
    flex: 1,
    alignItems: 'center',
  },
  totalCell: {
    flex: 1.45,
    alignItems: 'center',
  },
  pctCell: {
    flex: 1.85,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 1,
  },
  avgLabelCell: {
    flex: 7,
    alignItems: 'flex-end',
    paddingRight: 4,
  },
  dayHeaderText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#8e8e93',
  },
  dayAmount: {
    fontSize: 10,
    color: '#111',
    fontVariant: ['tabular-nums'],
  },
  markMet: {
    width: 12,
    fontSize: 10,
    textAlign: 'center',
    color: '#34c759',
  },
  markMissed: {
    width: 12,
    fontSize: 10,
    textAlign: 'center',
    color: '#c62828',
  },
  markSpacer: {
    width: 12,
    fontSize: 10,
  },
  pressed: {
    opacity: 0.7,
  },
});
