import { Alert } from 'react-native';
import type { Goal } from '../types/goal';
import { buildChildrenMap } from './goalTree';

export function descendantIds(rootId: string, nodes: Goal[]): string[] {
  const childrenMap = buildChildrenMap(nodes);
  const ids: string[] = [];
  const seen = new Set<string>();
  const stack = [...(childrenMap.get(rootId) ?? [])];

  while (stack.length > 0) {
    const child = stack.pop();
    if (!child || seen.has(child.id)) {
      continue;
    }
    seen.add(child.id);
    ids.push(child.id);
    for (const grandchild of childrenMap.get(child.id) ?? []) {
      stack.push(grandchild);
    }
  }

  return ids;
}

export function deleteMessage(count: number): string {
  if (count <= 0) {
    return 'This goal will be deleted.';
  }
  if (count === 1) {
    return 'This goal and 1 sub-step will be deleted.';
  }
  return `This goal and ${count} sub-steps will be deleted.`;
}

/** Same dialog the Plan list uses for swipe-to-delete. */
export function confirmDeleteGoal(count: number, onDelete: () => void): void {
  Alert.alert('Delete goal?', deleteMessage(count), [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: onDelete },
  ]);
}
