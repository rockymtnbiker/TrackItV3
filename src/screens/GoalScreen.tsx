import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import Svg, { Circle, Path } from 'react-native-svg';
import { KeyboardSafe } from '../components/KeyboardSafe';
import { PendingStatusCircle } from '../components/PendingStatusCircle';
import {
  bigDealSummary,
  goalAnalysis,
  goalStreaks,
  stepTree,
  type AnalysisTone,
} from '../lib/goalAnalysis';
import { periodTotalAsOf } from '../lib/asOfDate';
import {
  createGoal,
  deleteEntry,
  getAllGoals,
  getEntries,
  setGoalStatus,
  upsertEntry,
} from '../lib/goalTreeApi';
import {
  buildChildrenMap,
  goalStartDate,
  isDaily,
  isRepeating,
  isTracked,
  rollupTotal,
  weeklyTarget,
} from '../lib/goalTree';
import type { GoalsStackParamList } from '../navigation/GoalsStackNavigator';
import type { Goal, GoalEntry, GoalStatus } from '../types/goal';
import {
  formatDate,
  formatShortDate,
  getWeekDays,
  getWeekStart,
  isPastDate,
  todayDateString,
} from '../utils/date';
import { GoalReadout } from './StepDetailScreen';

type Props = NativeStackScreenProps<GoalsStackParamList, 'Goal'>;

const STATUS_LABEL: Record<GoalStatus, string> = {
  active: 'Active',
  pending: 'Pending',
  done: 'Done',
};

const TONE_COLOR: Record<AnalysisTone, string> = {
  good: '#248A3D',
  warn: '#C2410C',
  neutral: '#1C1C1E',
};

const RING_SIZE = 56;
const RING_CENTER = 28;
const RING_RADIUS = 22.75;
const RING_STROKE = 5.25;
const SEGMENT_GAP = 5.25;

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

function timesLabel(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function summaryLine(node: Goal): string | null {
  if (isRepeating(node)) {
    const since = formatShortDate(goalStartDate(node));
    if (isDaily(node)) {
      return `Daily · since ${since}`;
    }
    const perMonth = node.repeatPeriod === 'month';
    const count = perMonth ? node.targetAmount : weeklyTarget(node);
    const period = perMonth ? 'month' : 'week';
    if (count == null) {
      return `Since ${since}`;
    }
    return `${timesLabel(count)}× per ${period} · since ${since}`;
  }

  const start = node.targetStartDate?.slice(0, 10) || null;
  const end = node.targetEndDate?.slice(0, 10) || null;
  if (start && end) {
    return `${formatShortDate(start)} → ${formatDate(end)}`;
  }
  if (end) {
    return formatDate(end);
  }
  if (start) {
    return formatShortDate(start);
  }
  return null;
}

function overdueLine(step: Goal, today: string): string | null {
  const end = step.targetEndDate?.slice(0, 10);
  if (!end || step.status === 'done' || !isPastDate(end, today)) {
    return null;
  }
  return `Overdue · ${formatShortDate(end)}`;
}

function StatusMark({ status }: { status: GoalStatus }) {
  if (status === 'pending') {
    return <PendingStatusCircle size={22} color="#b0b0b5" />;
  }
  return (
    <Ionicons
      name={status === 'done' ? 'radio-button-on' : 'radio-button-off'}
      size={24}
      color={status === 'done' ? '#34c759' : '#c7c7cc'}
    />
  );
}

export default function GoalScreen({ navigation, route }: Props) {
  const { goalId } = route.params;
  const today = todayDateString();
  const addRef = useRef<TextInput>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [node, setNode] = useState<Goal | null>(null);
  const [nodes, setNodes] = useState<Goal[]>([]);
  const [entries, setEntries] = useState<GoalEntry[]>([]);
  const [children, setChildren] = useState<Goal[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logAmount, setLogAmount] = useState('');
  const [logError, setLogError] = useState<string | null>(null);
  const entryBusy = useRef(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const nextNodes = await getAllGoals();
      const found = nextNodes.find((item) => item.id === goalId) ?? null;
      const ids = found ? subtreeIds(found.id, nextNodes) : [];
      const nextEntries = ids.length > 0 ? await getEntries(ids) : [];
      setNodes(nextNodes);
      setNode(found);
      setEntries(nextEntries);
      setChildren(buildChildrenMap(nextNodes).get(goalId) ?? []);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load goal.');
      setNode(null);
    } finally {
      setLoading(false);
    }
  }, [goalId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const openEdit = useCallback(() => {
    navigation.push('StepDetail', { goalId });
  }, [goalId, navigation]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: '',
      headerRight: () => (
        <Pressable
          onPress={openEdit}
          accessibilityRole="button"
          accessibilityLabel="Edit"
          hitSlop={8}
        >
          <Text style={styles.headerEdit}>Edit</Text>
        </Pressable>
      ),
    });
  }, [navigation, openEdit]);

  const addStep = () => {
    const trimmed = newTitle.trim();
    if (!trimmed || !node || adding || isRepeating(node)) {
      return;
    }
    setAdding(true);
    void createGoal({ title: trimmed, parentId: node.id })
      .then((created) => {
        setNewTitle('');
        setShowAdd(false);
        navigation.push('Goal', { goalId: created.id });
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

  const revealAdd = () => {
    setShowAdd(true);
    requestAnimationFrame(() => addRef.current?.focus());
  };

  const replaceEntries = (
    goal: string,
    date: string,
    value: number | null | undefined,
  ) => {
    setEntries((current) => {
      const index = current.findIndex(
        (entry) => entry.goalId === goal && entry.entryDate.slice(0, 10) === date,
      );
      if (value === undefined) {
        return index >= 0 ? current.filter((_, item) => item !== index) : current;
      }
      if (index >= 0) {
        const next = current.slice();
        const existing = current[index];
        if (existing) {
          next[index] = { ...existing, value };
        }
        return next;
      }
      return [
        ...current,
        { id: `local-${goal}-${date}`, goalId: goal, entryDate: date, value },
      ];
    });
  };

  const toggleToday = (tracked: boolean) => {
    if (!node || entryBusy.current) {
      return;
    }
    const logged = entries.some(
      (entry) =>
        entry.goalId === node.id && entry.entryDate.slice(0, 10) === today,
    );
    entryBusy.current = true;
    const previous = entries;
    if (logged) {
      replaceEntries(node.id, today, undefined);
    } else if (!tracked) {
      replaceEntries(node.id, today, null);
    }
    const persist = logged
      ? deleteEntry(node.id, today)
      : upsertEntry(node.id, today, null);
    void persist
      .then((saved) => {
        if (!logged && saved && typeof saved !== 'boolean') {
          setEntries((current) =>
            current.map((entry) =>
              entry.goalId === saved.goalId &&
              entry.entryDate.slice(0, 10) === saved.entryDate.slice(0, 10)
                ? saved
                : entry,
            ),
          );
        }
      })
      .catch((error) => {
        console.warn('Failed to update today', error);
        setEntries(previous);
      })
      .finally(() => {
        entryBusy.current = false;
      });
  };

  const openLog = () => {
    setLogAmount('');
    setLogError(null);
    setLogOpen(true);
  };

  const closeLog = () => {
    setLogOpen(false);
    setLogAmount('');
    setLogError(null);
  };

  const saveLog = () => {
    if (!node || entryBusy.current) {
      return;
    }
    const trimmed = logAmount.trim();
    const amount = Number(trimmed);
    if (!trimmed || !Number.isFinite(amount) || amount <= 0) {
      setLogError('Enter a number greater than zero.');
      return;
    }
    const existing = entries.find(
      (entry) =>
        entry.goalId === node.id && entry.entryDate.slice(0, 10) === today,
    );
    const nextValue = (existing?.value ?? 0) + amount;
    const previous = entries;
    entryBusy.current = true;
    replaceEntries(node.id, today, nextValue);
    closeLog();
    void upsertEntry(node.id, today, nextValue)
      .then((saved) => {
        setEntries((current) =>
          current.map((entry) =>
            entry.goalId === saved.goalId &&
            entry.entryDate.slice(0, 10) === saved.entryDate.slice(0, 10)
              ? saved
              : entry,
          ),
        );
      })
      .catch((error) => {
        console.warn('Failed to log amount', error);
        setEntries(previous);
      })
      .finally(() => {
        entryBusy.current = false;
      });
  };

  const completeOneTime = () => {
    if (!node || entryBusy.current || isRepeating(node)) {
      return;
    }
    const markingDone = node.status !== 'done';
    const previous = node;
    const nextStatus: GoalStatus = markingDone ? 'done' : 'active';
    const optimistic: Goal = markingDone
      ? { ...node, status: 'done', actualEndDate: today }
      : { ...node, status: 'active', actualEndDate: null };
    setNode(optimistic);
    setNodes((current) =>
      current.map((item) => (item.id === node.id ? optimistic : item)),
    );
    entryBusy.current = true;
    void setGoalStatus(node.id, nextStatus, markingDone ? today : undefined)
      .then((updated) => {
        setNode(updated);
        setNodes((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
      })
      .catch((error) => {
        console.warn('Failed to update status', error);
        setNode(previous);
        setNodes((current) =>
          current.map((item) => (item.id === previous.id ? previous : item)),
        );
      })
      .finally(() => {
        entryBusy.current = false;
      });
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
      </View>
    );
  }

  if (!node) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingText}>This goal is no longer available.</Text>
      </View>
    );
  }

  const parent =
    node.parentId != null
      ? (nodes.find((item) => item.id === node.parentId) ?? null)
      : null;
  const line = summaryLine(node);
  const analysis = goalAnalysis(node, nodes, entries, today);
  const deal = bigDealSummary(node, nodes, today);
  const tree = deal ? stepTree(node, nodes) : [];
  const nextUp =
    deal?.nextUpId != null
      ? (nodes.find((item) => item.id === deal.nextUpId) ?? null)
      : null;
  const streaks = goalStreaks(node, entries, today);
  const whyText = node.why?.trim() ?? '';
  const loggedToday = entries.some(
    (entry) => entry.goalId === node.id && entry.entryDate.slice(0, 10) === today,
  );
  const needsSetup =
    !isTracked(node) && !isRepeating(node) && children.length === 0;
  const addField = (
    <TextInput
      ref={addRef}
      value={newTitle}
      onChangeText={setNewTitle}
      placeholder="+ Add a step"
      placeholderTextColor="#8e8e93"
      style={styles.addInput}
      returnKeyType="done"
      editable={!adding}
      onSubmitEditing={addStep}
    />
  );

  return (
    <KeyboardSafe style={styles.container}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={styles.titleBlock}>
          {parent ? (
            <Pressable
              onPress={() => navigation.push('Goal', { goalId: parent.id })}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`Open ${parent.title}`}
            >
              <Text style={styles.parentTitle} numberOfLines={1}>
                {parent.title || 'Untitled'}
              </Text>
            </Pressable>
          ) : null}
          <Text style={styles.title}>{node.title || 'Untitled'}</Text>
          <View style={styles.metaRow}>
            <View style={[styles.pill, styles[`pill_${node.status}`]]}>
              <Text style={[styles.pillText, styles[`pillText_${node.status}`]]}>
                {STATUS_LABEL[node.status]}
              </Text>
            </View>
            {line ? <Text style={styles.metaLine}>{line}</Text> : null}
          </View>
        </View>

        {deal ? (
          <View style={styles.analysisCard}>
            <Text style={styles.dealHeadline}>{deal.headline}</Text>
            <Text style={[styles.analysisDetail, { color: TONE_COLOR[deal.tone] }]}>
              {deal.detail}
            </Text>
            <View style={styles.dealTrack}>
              <View
                style={[
                  styles.dealFill,
                  {
                    width: `${deal.total > 0 ? (deal.done / deal.total) * 100 : 0}%`,
                  },
                ]}
              />
            </View>
            {nextUp ? (
              <Pressable
                onPress={() => navigation.push('Goal', { goalId: nextUp.id })}
                style={({ pressed }) => [styles.nextUp, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Next up ${nextUp.title || 'Untitled'}`}
              >
                <Text style={styles.sectionLabel}>Next up</Text>
                <View style={styles.nextUpRow}>
                  <Text style={styles.stepTitle} numberOfLines={2}>
                    {nextUp.title || 'Untitled'}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color="#c7c7cc" />
                </View>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {analysis && isRepeating(node) ? (
          <WeeklyAnalysis
            node={node}
            entries={entries}
            today={today}
            analysis={analysis}
            loggedToday={loggedToday}
            onPress={() => {
              if (isTracked(node)) {
                if (loggedToday) {
                  toggleToday(true);
                } else {
                  openLog();
                }
                return;
              }
              toggleToday(false);
            }}
          />
        ) : null}

        {analysis && !isRepeating(node) ? (
          <View style={styles.analysisCard}>
            <View style={styles.analysisRow}>
              <Pressable
                onPress={completeOneTime}
                accessibilityRole="button"
                accessibilityLabel={
                  node.status === 'done' ? 'Mark not done' : 'Mark done'
                }
                hitSlop={4}
              >
                <OneTimeMark status={node.status} />
              </Pressable>
              <AnalysisCopy analysis={analysis} />
            </View>
          </View>
        ) : null}

        {whyText ? (
          <View style={styles.paddedCard}>
            <Text style={styles.sectionLabel}>Why it matters</Text>
            <Text style={styles.whyQuote}>{`“${whyText}”`}</Text>
          </View>
        ) : null}

        {streaks ? (
          <View style={styles.streakRow}>
            <StreakTile
              label="Current streak"
              value={streaks.current}
              unit={streaks.unit}
            />
            <StreakTile label="Best streak" value={streaks.best} unit={streaks.unit} />
          </View>
        ) : null}

        <GoalReadout node={node} nodes={nodes} entries={entries} />

        {tree.length > 0 ? (
          <View style={styles.treeCard}>
            {tree.map((row, index) => {
              const item = nodes.find((entry) => entry.id === row.id);
              if (!item) {
                return null;
              }
              const overdue = row.leaf ? overdueLine(item, today) : null;
              return (
                <Pressable
                  key={row.id}
                  onPress={() => navigation.push('Goal', { goalId: item.id })}
                  style={({ pressed }) => [
                    styles.treeRow,
                    { paddingLeft: 16 + row.depth * 36 },
                    index > 0 && styles.stepBorder,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={item.title || 'Untitled'}
                >
                  {row.leaf ? (
                    item.status === 'done' ? (
                      <Ionicons name="checkmark-circle" size={24} color="#248A3D" />
                    ) : (
                      <StatusMark status={item.status} />
                    )
                  ) : (
                    <Ionicons name="folder-outline" size={22} color="#6B6B70" />
                  )}
                  <View style={styles.stepBody}>
                    <Text
                      style={[
                        row.leaf ? styles.stepTitle : styles.treeParentTitle,
                        row.leaf && item.status === 'done' && styles.treeTitleDone,
                      ]}
                      numberOfLines={2}
                    >
                      {item.title || 'Untitled'}
                    </Text>
                    {row.leaf ? (
                      overdue ? <Text style={styles.overdue}>{overdue}</Text> : null
                    ) : (
                      <Text style={styles.treeCount}>
                        {row.done} of {row.total} steps
                      </Text>
                    )}
                    {row.leaf ? (
                      <LeafAmountBar
                        node={item}
                        nodes={nodes}
                        entries={entries}
                        today={today}
                      />
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#c7c7cc" />
                </Pressable>
              );
            })}
            {!isRepeating(node) ? <View style={styles.treeAdd}>{addField}</View> : null}
          </View>
        ) : null}

        {needsSetup ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Set it up</Text>
            <SetupRow label="Track an amount" onPress={openEdit} />
            <SetupRow label="Repeat" onPress={openEdit} />
            <SetupRow label="Add steps" onPress={revealAdd} />
            {showAdd ? addField : null}
          </View>
        ) : null}

        <Pressable
          onPress={openEdit}
          style={({ pressed }) => [styles.card, styles.linkRow, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Notes, timeline and settings"
        >
          <Text style={styles.linkText}>Notes, timeline & settings</Text>
          <Ionicons name="chevron-forward" size={18} color="#c7c7cc" />
        </Pressable>
      </ScrollView>

      <Modal visible={logOpen} animationType="fade" transparent onRequestClose={closeLog}>
        <KeyboardSafe style={styles.modalOverlay} keyboardVerticalOffset={0}>
          <Pressable style={styles.modalBackdrop} onPress={closeLog}>
            <Pressable style={styles.logCard} onPress={() => {}}>
              <Text style={styles.logTitle}>{node.title || 'Log amount'}</Text>
              <Text style={styles.logDate}>
                Today: {formatQty(dayValue(entries, node.id, today))} {node.unit ?? ''}
              </Text>
              <View style={styles.logInputRow}>
                <TextInput
                  style={styles.logInput}
                  value={logAmount}
                  onChangeText={(value) => {
                    setLogAmount(value);
                    setLogError(null);
                  }}
                  placeholder="0"
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                  onSubmitEditing={saveLog}
                  autoFocus
                />
                <Text style={styles.logUnit}>{node.unit ?? ''}</Text>
                <Pressable
                  onPress={saveLog}
                  style={({ pressed }) => [styles.logAdd, pressed && styles.pressed]}
                >
                  <Text style={styles.logAddText}>Add</Text>
                </Pressable>
              </View>
              {logError ? <Text style={styles.logError}>{logError}</Text> : null}
            </Pressable>
          </Pressable>
        </KeyboardSafe>
      </Modal>
    </KeyboardSafe>
  );
}

function formatQty(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function dayValue(entries: GoalEntry[], goalId: string, date: string): number {
  const entry = entries.find(
    (item) => item.goalId === goalId && item.entryDate.slice(0, 10) === date,
  );
  return entry?.value ?? 0;
}

function segmentArcPath(index: number, count: number): string {
  const gap = SEGMENT_GAP / RING_RADIUS;
  const sweep = (2 * Math.PI - count * gap) / count;
  const start = -Math.PI / 2 + index * (sweep + gap);
  const end = start + sweep;
  const x1 = RING_CENTER + RING_RADIUS * Math.cos(start);
  const y1 = RING_CENTER + RING_RADIUS * Math.sin(start);
  const x2 = RING_CENTER + RING_RADIUS * Math.cos(end);
  const y2 = RING_CENTER + RING_RADIUS * Math.sin(end);
  const large = sweep > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${RING_RADIUS} ${RING_RADIUS} 0 ${large} 1 ${x2} ${y2}`;
}

function WeekRing({
  total,
  target,
  tracked,
  loggedToday,
}: {
  total: number;
  target: number | null;
  tracked: boolean;
  loggedToday: boolean;
}) {
  const progress =
    target != null && target > 0 ? Math.max(0, Math.min(1, total / target)) : 0;
  const complete = target != null && target > 0 && total >= target;
  const segmented = !tracked && target != null && target <= 7;

  if (complete) {
    return (
      <View style={styles.ringBox}>
        <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
          <Circle
            cx={RING_CENTER}
            cy={RING_CENTER}
            r={RING_RADIUS + RING_STROKE / 2}
            fill="#248A3D"
          />
        </Svg>
        <View style={styles.ringOverlay} pointerEvents="none">
          <Ionicons name="checkmark" size={28} color="#FFFFFF" />
        </View>
      </View>
    );
  }

  if (segmented && target != null) {
    const count = Math.max(1, Math.round(target));
    const filled = Math.max(0, Math.min(count, Math.round(total)));
    return (
      <View style={styles.ringBox}>
        <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
          {Array.from({ length: count }, (_, index) => (
            <Path
              key={index}
              d={segmentArcPath(index, count)}
              stroke={index < filled ? '#248A3D' : '#E3E3E8'}
              strokeWidth={RING_STROKE}
              fill="none"
            />
          ))}
        </Svg>
        {loggedToday ? (
          <View style={styles.ringOverlay} pointerEvents="none">
            <Ionicons name="checkmark" size={20} color="#248A3D" />
          </View>
        ) : null}
      </View>
    );
  }

  const circumference = 2 * Math.PI * RING_RADIUS;
  return (
    <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
      <Circle
        cx={RING_CENTER}
        cy={RING_CENTER}
        r={RING_RADIUS}
        stroke="#E3E3E8"
        strokeWidth={RING_STROKE}
        fill="none"
      />
      {progress > 0 ? (
        <Circle
          cx={RING_CENTER}
          cy={RING_CENTER}
          r={RING_RADIUS}
          stroke="#248A3D"
          strokeWidth={RING_STROKE}
          fill="none"
          strokeDasharray={`${circumference * progress} ${circumference}`}
          rotation={-90}
          origin={`${RING_CENTER}, ${RING_CENTER}`}
        />
      ) : null}
    </Svg>
  );
}

function OneTimeMark({ status }: { status: GoalStatus }) {
  if (status === 'done') {
    return (
      <View style={styles.ringBox}>
        <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
          <Circle
            cx={RING_CENTER}
            cy={RING_CENTER}
            r={RING_RADIUS + RING_STROKE / 2}
            fill="#248A3D"
          />
        </Svg>
        <View style={styles.ringOverlay} pointerEvents="none">
          <Ionicons name="checkmark" size={28} color="#FFFFFF" />
        </View>
      </View>
    );
  }
  if (status === 'pending') {
    return <PendingStatusCircle size={RING_SIZE} color="#b0b0b5" />;
  }
  return (
    <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
      <Circle
        cx={RING_CENTER}
        cy={RING_CENTER}
        r={RING_RADIUS}
        stroke="#C7C7CC"
        strokeWidth={4}
        fill="none"
      />
    </Svg>
  );
}

function AnalysisCopy({
  analysis,
}: {
  analysis: { headline: string; detail: string; tone: AnalysisTone };
}) {
  return (
    <View style={styles.analysisCopy}>
      <Text style={[styles.headline, { color: TONE_COLOR[analysis.tone] }]}>
        {analysis.headline}
      </Text>
      {analysis.detail ? <Text style={styles.analysisDetail}>{analysis.detail}</Text> : null}
    </View>
  );
}

function WeekStrip({
  node,
  entries,
  today,
}: {
  node: Goal;
  entries: GoalEntry[];
  today: string;
}) {
  const start = goalStartDate(node);
  const logged = new Set(
    entries
      .filter(
        (entry) =>
          entry.goalId === node.id &&
          entry.entryDate.slice(0, 10) <= today &&
          entry.entryDate.slice(0, 10) >= start,
      )
      .map((entry) => entry.entryDate.slice(0, 10)),
  );

  return (
    <View style={styles.weekStrip}>
      {getWeekDays(today).map((day) => {
        if (day.dateString < start) {
          return <View key={day.dateString} style={styles.dotSlot} />;
        }
        const isToday = day.dateString === today;
        const after = day.dateString > today;
        const hasEntry = logged.has(day.dateString);
        return (
          <View key={day.dateString} style={styles.dotSlot}>
            {isToday ? <View style={styles.dotRing} /> : null}
            <View
              style={[
                styles.dot,
                after ? styles.dotHollow : hasEntry ? styles.dotDone : styles.dotMissed,
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

function WeeklyAnalysis({
  node,
  entries,
  today,
  analysis,
  loggedToday,
  onPress,
}: {
  node: Goal;
  entries: GoalEntry[];
  today: string;
  analysis: { headline: string; detail: string; tone: AnalysisTone };
  loggedToday: boolean;
  onPress: () => void;
}) {
  const target = weeklyTarget(node, getWeekStart(today));
  const total = periodTotalAsOf(node, entries, today);
  return (
    <View style={styles.analysisCard}>
      <View style={styles.analysisRow}>
        <WeekRing
          total={total}
          target={target}
          tracked={isTracked(node)}
          loggedToday={loggedToday}
        />
        <AnalysisCopy analysis={analysis} />
      </View>
      <WeekStrip node={node} entries={entries} today={today} />
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.todayButton, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={loggedToday ? 'Logged today. Tap to undo' : 'Log today'}
      >
        <Text style={styles.todayButtonText}>
          {loggedToday ? '✓ Logged today · tap to undo' : 'Log today'}
        </Text>
      </Pressable>
    </View>
  );
}

function LeafAmountBar({
  node,
  nodes,
  entries,
  today,
}: {
  node: Goal;
  nodes: Goal[];
  entries: GoalEntry[];
  today: string;
}) {
  if (!isTracked(node) || node.targetAmount == null || node.targetAmount <= 0) {
    return null;
  }
  const total = isRepeating(node)
    ? periodTotalAsOf(node, entries, today)
    : (rollupTotal(node, nodes, entries) ?? 0);
  const ratio = Math.max(0, Math.min(1, total / node.targetAmount));
  return (
    <View style={styles.miniTrack}>
      <View style={[styles.miniFill, { width: `${ratio * 100}%` }]} />
    </View>
  );
}

function StreakTile({
  label,
  value,
  unit,
}: {
  label: string;
  value: number;
  unit: 'day' | 'week';
}) {
  const unitLabel =
    value === 1 ? unit : unit === 'day' ? 'days' : 'weeks';
  return (
    <View style={styles.streakTile}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.streakValueRow}>
        {value > 0 ? <Ionicons name="flame" size={22} color="#C2410C" /> : null}
        <Text style={styles.streakValue}>{value}</Text>
      </View>
      <Text style={styles.streakUnit}>{unitLabel}</Text>
    </View>
  );
}

function SetupRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.setupRow, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={styles.setupLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color="#c7c7cc" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f2f2f7',
  },
  content: {
    padding: 16,
    gap: 12,
    paddingBottom: 32,
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f2f2f7',
    padding: 24,
  },
  missingText: {
    fontSize: 16,
    color: '#6b6b70',
    textAlign: 'center',
  },
  headerEdit: {
    fontSize: 17,
    color: '#007aff',
  },
  titleBlock: {
    gap: 6,
    paddingHorizontal: 4,
  },
  parentTitle: {
    fontSize: 15,
    color: '#6b6b70',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
  },
  pill_active: {
    backgroundColor: '#e5f8ea',
  },
  pillText_active: {
    color: '#248a3d',
  },
  pill_pending: {
    backgroundColor: '#ececf0',
  },
  pillText_pending: {
    color: '#6b6b70',
  },
  pill_done: {
    backgroundColor: '#e5f8ea',
  },
  pillText_done: {
    color: '#248a3d',
  },
  metaLine: {
    fontSize: 15,
    color: '#6b6b70',
    flexShrink: 1,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b6b70',
    textTransform: 'uppercase',
    paddingTop: 12,
    paddingBottom: 4,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  stepBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5ea',
  },
  stepBody: {
    flex: 1,
    gap: 2,
  },
  stepTitle: {
    fontSize: 17,
    color: '#111',
  },
  overdue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#c2410c',
  },
  addInput: {
    fontSize: 17,
    color: '#111',
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5ea',
  },
  setupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5ea',
  },
  setupLabel: {
    fontSize: 17,
    color: '#111',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
  },
  linkText: {
    fontSize: 17,
    color: '#111',
  },
  pressed: {
    opacity: 0.55,
  },
  analysisCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    gap: 16,
  },
  analysisRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  analysisCopy: {
    flex: 1,
    gap: 4,
  },
  headline: {
    fontSize: 17,
    fontWeight: '700',
  },
  analysisDetail: {
    fontSize: 15,
    lineHeight: 20,
    color: '#6B6B70',
  },
  dealHeadline: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  dealTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E5E5EA',
    overflow: 'hidden',
  },
  dealFill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#248A3D',
  },
  nextUp: {
    gap: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5ea',
    paddingTop: 12,
  },
  nextUpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  treeCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 4,
  },
  treeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingRight: 16,
  },
  treeParentTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#111',
  },
  treeTitleDone: {
    color: '#6B6B70',
  },
  treeCount: {
    fontSize: 14,
    color: '#6B6B70',
  },
  treeAdd: {
    paddingHorizontal: 16,
  },
  miniTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E5EA',
    overflow: 'hidden',
    marginTop: 4,
  },
  miniFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#248A3D',
  },
  ringBox: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dotSlot: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  dotDone: {
    backgroundColor: '#248A3D',
  },
  dotMissed: {
    backgroundColor: '#D1D1D6',
  },
  dotHollow: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#D1D1D6',
  },
  dotRing: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#1C1C1E',
  },
  todayButton: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#007aff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  todayButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
  },
  paddedCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    gap: 8,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B6B70',
    textTransform: 'uppercase',
  },
  whyQuote: {
    fontSize: 17,
    fontStyle: 'italic',
    color: '#1C1C1E',
    lineHeight: 24,
  },
  streakRow: {
    flexDirection: 'row',
    gap: 12,
  },
  streakTile: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    gap: 6,
  },
  streakValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  streakValue: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  streakUnit: {
    fontSize: 15,
    color: '#6B6B70',
  },
  modalOverlay: {
    flex: 1,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 24,
  },
  logCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    gap: 8,
  },
  logTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111',
  },
  logDate: {
    fontSize: 15,
    color: '#555',
  },
  logInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 17,
    minHeight: 44,
  },
  logUnit: {
    fontSize: 15,
    color: '#555',
  },
  logAdd: {
    backgroundColor: '#007aff',
    borderRadius: 8,
    paddingHorizontal: 14,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logAddText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  logError: {
    fontSize: 13,
    color: '#c62828',
  },
});
