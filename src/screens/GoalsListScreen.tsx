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
import { KeyboardSafe } from '../components/KeyboardSafe';
import { FormFieldRow, FormInlineInput } from '../components/FormFields';
import {
  createGoal,
  getAllGoals,
  getEntries,
  reorderGoals,
} from '../lib/goalTreeApi';
import {
  buildChildrenMap,
  isRepeating,
  isTracked,
  rollupTotal,
} from '../lib/goalTree';
import type { GoalsStackParamList } from '../navigation/GoalsStackNavigator';
import type { GoalEntry, Goal } from '../types/goal';

type Props = NativeStackScreenProps<GoalsStackParamList, 'GoalsList'>;

/** Approximate goal card height (padding + title + meta + margin). */
const LIST_CARD_HEIGHT = 72;

function cardSubtitle(
  node: Goal,
  nodes: Goal[],
  entries: GoalEntry[],
  childrenMap: Map<string | null, Goal[]>,
): string {
  if (isRepeating(node)) {
    const amount = node.targetAmount != null ? String(node.targetAmount) : '—';
    const unit = node.unit ?? 'times';
    const period = node.repeatPeriod === 'month' ? 'month' : 'week';
    return `${amount} ${unit} / ${period}`;
  }

  if (isTracked(node)) {
    const total = rollupTotal(node, nodes, entries) ?? 0;
    const amount = node.targetAmount != null ? String(node.targetAmount) : '—';
    return `${total} / ${amount} ${node.unit}`;
  }

  const children = childrenMap.get(node.id) ?? [];
  if (children.length === 0) {
    return '';
  }

  const doneCount = children.filter((child) => child.status === 'done').length;
  const activeCount = children.filter((child) => child.status === 'active').length;
  return `${doneCount} done · ${activeCount} active`;
}

export default function GoalsListScreen({ navigation }: Props) {
  const [nodes, setNodes] = useState<Goal[]>([]);
  const [entries, setEntries] = useState<GoalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createVisible, setCreateVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const nextNodes = await getAllGoals();
      const ids = nextNodes.map((node) => node.id);
      const nextEntries = ids.length > 0 ? await getEntries(ids) : [];
      setNodes(nextNodes);
      setEntries(nextEntries);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load goals.';
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const childrenMap = useMemo(() => buildChildrenMap(nodes), [nodes]);
  const visibleNodes = useMemo(
    () =>
      nodes
        .filter((node) => node.parentId == null)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [nodes],
  );
  const listRef = useRef(visibleNodes);
  listRef.current = visibleNodes;

  const openCreate = () => {
    setTitle('');
    setCreateError(null);
    setCreateVisible(true);
  };

  const handleCreate = async () => {
    const trimmed = title.trim();
    if (!trimmed || creating) {
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const created = await createGoal({
        title: trimmed,
        parentId: null,
      });
      setCreateVisible(false);
      navigation.push('StepDetail', { goalId: created.id });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to create goal.';
      setCreateError(message);
    } finally {
      setCreating(false);
    }
  };

  const reorderNodes = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) {
      return;
    }
    const ordered = [...visibleNodes];
    const [moved] = ordered.splice(fromIndex, 1);
    if (!moved) {
      return;
    }
    ordered.splice(toIndex, 0, moved);
    const withOrder = ordered.map((node, index) => ({
      ...node,
      sortOrder: index,
    }));
    const byId = new Map(withOrder.map((node) => [node.id, node]));
    setNodes((current) =>
      current.map((node) => byId.get(node.id) ?? node),
    );
    void reorderGoals(withOrder.map((node) => node.id)).catch((error) => {
      console.warn('Failed to persist goal order', error);
      void load();
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        // The gesture-handler scroll view otherwise cancels the long-press
        // drag as soon as the finger moves.
        disallowInterruption={false}
      >
        <View style={styles.headerRow}>
          <Pressable
            onPress={openCreate}
            style={({ pressed }) => [
              styles.addButton,
              pressed && styles.pressed,
            ]}
            accessibilityLabel="Add goal"
          >
            <Ionicons name="add" size={32} color="#111" />
          </Pressable>
        </View>

        {loading && visibleNodes.length === 0 ? (
          <View style={styles.goalsStatus}>
            <ActivityIndicator color="#007aff" />
          </View>
        ) : loadError && visibleNodes.length === 0 ? (
          <View style={styles.goalsStatus}>
            <Text style={styles.errorText}>{loadError}</Text>
            <Pressable
              onPress={() => void load()}
              style={({ pressed }) => [
                styles.retryButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          </View>
        ) : visibleNodes.length === 0 ? (
          <Text style={styles.emptyText}>
            No goals yet. Tap + to create one.
          </Text>
        ) : (
          visibleNodes.map((node, index) => (
              <DraggableItem
                key={node.id}
                index={index}
                itemHeight={LIST_CARD_HEIGHT}
                onPress={() =>
                  navigation.navigate('StepDetail', { goalId: node.id })
                }
                onDragStart={() => {}}
                onDragMove={() => {}}
                onDragEnd={(from, to) => {
                  const clampedTo = Math.max(
                    0,
                    Math.min(listRef.current.length - 1, to),
                  );
                  reorderNodes(from, clampedTo);
                }}
                style={styles.dragHost}
              >
                <View style={styles.card}>
                  <View style={styles.titleRow}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {node.title || 'Untitled'}
                    </Text>
                    {isRepeating(node) ? (
                      <Ionicons
                        name="repeat"
                        size={16}
                        color="#8e8e93"
                        accessibilityLabel="Repeats"
                      />
                    ) : null}
                  </View>
                  <Text style={styles.cardMeta}>
                    {cardSubtitle(node, nodes, entries, childrenMap)}
                  </Text>
                </View>
              </DraggableItem>
          ))
        )}
      </ScrollView>

      <Modal
        visible={createVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setCreateVisible(false)}
      >
        <KeyboardSafe style={styles.modalOverlay} keyboardVerticalOffset={0}>
          <ScrollView
            contentContainerStyle={styles.modalScroll}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Add Goal</Text>
              <FormFieldRow label="Title">
                <FormInlineInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder="Enter title"
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    if (title.trim()) {
                      void handleCreate();
                    }
                  }}
                />
              </FormFieldRow>

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
                  onPress={() => void handleCreate()}
                  disabled={creating || !title.trim()}
                  style={[
                    styles.modalButtonPrimary,
                    (creating || !title.trim()) && styles.modalButtonDisabled,
                  ]}
                >
                  {creating ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.modalButtonPrimaryText}>Create</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </KeyboardSafe>
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
    padding: 12,
    paddingBottom: 28,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginBottom: 10,
  },
  addButton: {
    padding: 4,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
  dragHost: {
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardTitle: {
    flexShrink: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#111',
    marginBottom: 2,
  },
  cardMeta: {
    fontSize: 13,
    color: '#666',
    minHeight: 16,
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
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
    color: '#111',
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
  pressed: {
    opacity: 0.7,
  },
});
