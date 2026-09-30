import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import {
  FormDateRow,
  FormDescriptionField,
  FormFieldRow,
  FormInlineInput,
  FormSelectRow,
  formFieldStyles,
} from '../components/FormFields';
import { KeyboardSafe } from '../components/KeyboardSafe';
import { PendingStatusCircle } from '../components/PendingStatusCircle';
import { UNIT_OPTIONS } from '../constants';
import {
  createGoalNode,
  deleteGoalNode,
  getAllGoalNodes,
  getEntries,
  reorderGoalNodes,
  setGoalNodeStatus,
  updateGoalNode,
} from '../lib/goalTreeApi';
import { buildChildrenMap, rollupTotal } from '../lib/goalTree';
import type { GoalsStackParamList } from '../navigation/GoalsStackNavigator';
import type {
  GoalEntry,
  GoalNode,
  GoalNodeStatus,
  RepeatPeriod,
} from '../types/goalNode';
import { nextGoalStatus } from '../types';
import { formatDateMDY } from '../utils/date';

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

const PERIOD_CHOICES = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

function isPresetUnit(unit: string): boolean {
  return (UNIT_OPTIONS as readonly string[]).includes(unit);
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

function subtreeIds(rootId: string, nodes: GoalNode[]): string[] {
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

function descendantCount(rootId: string, nodes: GoalNode[]): number {
  return Math.max(0, subtreeIds(rootId, nodes).length - 1);
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
  status: GoalNodeStatus;
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

export default function StepDetailScreen({ navigation, route }: Props) {
  const { goalId } = route.params;
  const [node, setNode] = useState<GoalNode | null>(null);
  const [allNodes, setAllNodes] = useState<GoalNode[]>([]);
  const [entries, setEntries] = useState<GoalEntry[]>([]);
  const [children, setChildren] = useState<GoalNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [trackOn, setTrackOn] = useState(false);
  const [unitChoice, setUnitChoice] = useState('');
  const [customUnit, setCustomUnit] = useState('');
  const [target, setTarget] = useState('');
  const [repeatOn, setRepeatOn] = useState(false);
  const [repeatPeriod, setRepeatPeriod] = useState<RepeatPeriod>('week');
  const [plannedDays, setPlannedDays] = useState<number[]>([]);
  const [targetStartDate, setTargetStartDate] = useState('');
  const [targetEndDate, setTargetEndDate] = useState('');
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

  const applyNodeToDraft = useCallback((next: GoalNode) => {
    const preset = next.unit != null && isPresetUnit(next.unit);
    setTitle(next.title);
    setDescription(next.description ?? '');
    setTrackOn(next.unit != null);
    setUnitChoice(next.unit == null ? '' : preset ? next.unit : CUSTOM_UNIT);
    setCustomUnit(next.unit != null && !preset ? next.unit : '');
    setTarget(next.targetAmount != null ? String(next.targetAmount) : '');
    setRepeatOn(next.plannedDays != null);
    setRepeatPeriod(next.repeatPeriod ?? 'week');
    setPlannedDays(next.plannedDays ?? []);
    setTargetStartDate(next.targetStartDate ?? '');
    setTargetEndDate(next.targetEndDate ?? '');
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const nodes = await getAllGoalNodes();
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
    trackOn,
    unitChoice,
    customUnit,
    target,
    repeatOn,
    repeatPeriod,
    plannedDays,
    targetStartDate,
    targetEndDate,
  });
  draftRef.current = {
    title,
    description,
    trackOn,
    unitChoice,
    customUnit,
    target,
    repeatOn,
    repeatPeriod,
    plannedDays,
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

    void updateGoalNode(goalId, {
      title: trimmedTitle,
      description: draft.description.trim() || null,
      unit,
      targetAmount: amount,
      repeatPeriod: draft.repeatOn ? draft.repeatPeriod : null,
      plannedDays: draft.repeatOn ? draft.plannedDays : null,
      targetStartDate: draft.targetStartDate.trim() || null,
      targetEndDate: draft.targetEndDate.trim() || null,
    })
      .then((updated) => {
        setNode(updated);
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
      title: title.trim() || node?.title || 'Step',
    });
  }, [navigation, node?.title, title]);

  const parent =
    node?.parentId != null
      ? (allNodes.find((item) => item.id === node.parentId) ?? null)
      : null;
  const hasChildren = children.length > 0;
  const displayUnit = resolvedUnit(unitChoice, customUnit, trackOn);
  const progressNode: GoalNode | null = node
    ? {
        ...node,
        unit: displayUnit,
        targetAmount: parseAmount(target),
        repeatPeriod: repeatOn ? repeatPeriod : null,
        plannedDays: repeatOn ? plannedDays : null,
      }
    : null;
  const total =
    progressNode && displayUnit
      ? rollupTotal(progressNode, allNodes, entries)
      : null;
  const doneCount = children.filter((child) => child.status === 'done').length;
  const activeCount = children.filter(
    (child) => child.status === 'active',
  ).length;

  const targetLabel = !repeatOn
    ? 'Total target'
    : trackOn
      ? `Target per ${periodWord(repeatPeriod)}`
      : `Times per ${periodWord(repeatPeriod)}`;

  const cycleStatus = () => {
    if (!node || skipPersistRef.current) {
      return;
    }
    const next = nextGoalStatus(node.status);
    setNode({ ...node, status: next });
    void setGoalNodeStatus(goalId, next)
      .then((updated) => {
        setNode(updated);
      })
      .catch((error) => {
        console.warn('Failed to update status', error);
        void load();
      });
  };

  const cycleChildStatus = (child: GoalNode) => {
    const next = nextGoalStatus(child.status);
    setChildren((current) =>
      current.map((item) =>
        item.id === child.id ? { ...item, status: next } : item,
      ),
    );
    void setGoalNodeStatus(child.id, next)
      .then((updated) => {
        setChildren((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
        setAllNodes((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
      })
      .catch((error) => {
        console.warn('Failed to update step status', error);
        void load();
      });
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
          void deleteGoalNode(id)
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
      void reorderGoalNodes(ordered.map((item) => item.id)).catch((error) => {
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
    void createGoalNode({ title: trimmed, parentId: node.id })
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
    setPlannedDays((current) =>
      current.includes(day)
        ? current.filter((entry) => entry !== day)
        : [...current, day].sort((a, b) => a - b),
    );
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
        <Text style={styles.kindLabel}>
          {node.parentId == null ? 'Goal' : 'Step'}
        </Text>
        {parent ? (
          <Text style={styles.parentTitle} numberOfLines={1}>
            {parent.title}
          </Text>
        ) : null}

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
            <FormFieldRow label="Status">
              <View style={styles.statusRow}>
                <StatusCircle status={node.status} onPress={cycleStatus} />
                <Text style={styles.statusWord}>{node.status}</Text>
              </View>
            </FormFieldRow>
            <FormFieldRow label="Actual start" labelWidth={118}>
              <Text style={formFieldStyles.formReadOnlyValue}>
                {node.actualStartDate
                  ? formatDateMDY(node.actualStartDate)
                  : '—'}
              </Text>
            </FormFieldRow>
            <FormFieldRow label="Actual end" labelWidth={118}>
              <Text style={formFieldStyles.formReadOnlyValue}>
                {node.actualEndDate ? formatDateMDY(node.actualEndDate) : '—'}
              </Text>
            </FormFieldRow>
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

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Track an amount</Text>
              <Switch
                value={trackOn}
                onValueChange={(on) => {
                  setTrackOn(on);
                  if (!on && !repeatOn) {
                    setTarget('');
                  }
                }}
              />
            </View>
            {trackOn ? (
              <>
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
              </>
            ) : null}
            {trackOn || repeatOn ? (
              <FormFieldRow label={targetLabel} labelWidth={150}>
                <FormInlineInput
                  value={target}
                  onChangeText={setTarget}
                  placeholder="Optional"
                  keyboardType="numeric"
                />
              </FormFieldRow>
            ) : null}

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Repeat</Text>
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
            </View>
            {hasChildren ? (
              <Text style={styles.hint}>Steps with sub-steps can't repeat.</Text>
            ) : null}
            {repeatOn ? (
              <>
                <FormSelectRow
                  label="Period"
                  value={repeatPeriod}
                  placeholder="Week"
                  options={PERIOD_CHOICES}
                  onChange={(value) =>
                    setRepeatPeriod(value === 'month' ? 'month' : 'week')
                  }
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
              </>
            ) : null}
          </View>
        </View>

        {displayUnit ? (
          <Text style={styles.progress}>
            {total ?? 0} / {progressNode.targetAmount ?? '—'} {displayUnit}
          </Text>
        ) : hasChildren ? (
          <Text style={styles.progress}>
            {doneCount} done · {activeCount} active
          </Text>
        ) : null}

        {!repeatOn ? (
          <>
            <Text style={styles.sectionPrompt}>Steps</Text>
            <View style={styles.sectionCard}>
              {children.length === 0 ? (
                <Text style={styles.emptyText}>No steps yet.</Text>
              ) : (
                children.map((child, index) => (
                  <EditableOrderedRow
                    key={child.id}
                    title={child.title}
                    status={child.status}
                    onStatusPress={() => cycleChildStatus(child)}
                    index={index}
                    isDragging={draggingId === child.id}
                    dragOffsetY={0}
                    titlePlaceholder="Step title"
                    openAccessibilityLabel="Open step"
                    deleteAccessibilityLabel="Delete step"
                    swipeToDelete
                    repeating={child.plannedDays != null}
                    onTitleChange={() => {}}
                    onRowPress={() => openChild(child.id)}
                    onOpen={() => openChild(child.id)}
                    onDelete={() => confirmDelete(child.id)}
                    onDragStart={() => setDraggingId(child.id)}
                    onDragMove={() => {}}
                    onDragEnd={(from, to) => {
                      const clampedTo = Math.max(
                        0,
                        Math.min(childrenRef.current.length - 1, to),
                      );
                      reorderChildren(from, clampedTo);
                      setDraggingId(null);
                    }}
                  />
                ))
              )}

              <View style={styles.addRow}>
                <TextInput
                  style={styles.addInput}
                  value={newStepTitle}
                  onChangeText={setNewStepTitle}
                  placeholder="+ Add a step"
                  returnKeyType="done"
                  onSubmitEditing={addStep}
                />
                <Pressable
                  onPress={addStep}
                  disabled={adding || !newStepTitle.trim()}
                  style={({ pressed }) => [
                    styles.addButton,
                    pressed && styles.pressed,
                  ]}
                >
                  {adding ? (
                    <ActivityIndicator color="#007aff" />
                  ) : (
                    <Ionicons name="add" size={22} color="#007aff" />
                  )}
                </Pressable>
              </View>
            </View>
          </>
        ) : null}

        <Pressable
          onPress={() => confirmDelete(goalId)}
          style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}
        >
          <Text style={styles.deleteButtonText}>Delete</Text>
        </Pressable>
      </ScrollView>
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
  parentTitle: {
    fontSize: 13,
    color: '#8e8e93',
    marginTop: -4,
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
  progress: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    paddingHorizontal: 4,
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
  deleteButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#c62828',
  },
  pressed: {
    opacity: 0.7,
  },
});
