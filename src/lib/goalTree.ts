import type { GoalEntry, GoalNode } from '../types/goalNode';

/** Repeating steps store planned days. An empty array still repeats. */
export function isRepeating(node: GoalNode): boolean {
  return node.plannedDays !== null;
}

export function isTracked(node: GoalNode): boolean {
  return node.unit !== null;
}

export function buildChildrenMap(
  nodes: GoalNode[],
): Map<string | null, GoalNode[]> {
  const childrenMap = new Map<string | null, GoalNode[]>();

  for (const node of nodes) {
    const siblings = childrenMap.get(node.parentId);
    if (siblings) {
      siblings.push(node);
    } else {
      childrenMap.set(node.parentId, [node]);
    }
  }

  for (const siblings of childrenMap.values()) {
    siblings.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  return childrenMap;
}

export function isLeaf(
  node: GoalNode,
  childrenMap: Map<string | null, GoalNode[]>,
): boolean {
  return (childrenMap.get(node.id)?.length ?? 0) === 0;
}

/**
 * Repeating leaves of any status except done, plus one-time leaves that are
 * active. A top-level step with no children is a leaf.
 */
export function getActionableSteps(nodes: GoalNode[]): GoalNode[] {
  const childrenMap = buildChildrenMap(nodes);

  return nodes.filter((node) => {
    if (!isLeaf(node, childrenMap)) {
      return false;
    }
    if (isRepeating(node)) {
      return node.status !== 'done';
    }
    return node.status === 'active';
  });
}

/**
 * Sum of entry values on this step and descendants that use the same unit.
 * Null when the step does not track a unit. Null entry values are skipped.
 */
export function rollupTotal(
  node: GoalNode,
  nodes: GoalNode[],
  entries: GoalEntry[],
): number | null {
  if (node.unit == null) {
    return null;
  }

  const childrenMap = buildChildrenMap(nodes);
  const byId = new Map(nodes.map((item) => [item.id, item]));
  const matchingIds = new Set<string>();
  const seen = new Set<string>();
  const stack = [node.id];

  while (stack.length > 0) {
    const id = stack.pop();
    if (id == null || seen.has(id)) {
      continue;
    }
    seen.add(id);

    const current = id === node.id ? node : byId.get(id);
    if (current && current.unit === node.unit) {
      matchingIds.add(id);
    }

    for (const child of childrenMap.get(id) ?? []) {
      stack.push(child.id);
    }
  }

  let total = 0;
  for (const entry of entries) {
    if (matchingIds.has(entry.goalId) && entry.value != null) {
      total += entry.value;
    }
  }

  return total;
}
