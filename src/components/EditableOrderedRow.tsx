import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Pressable, Swipeable } from 'react-native-gesture-handler';
import type { GoalStatus } from '../types';
import {
  DEFAULT_DRAGGABLE_ITEM_HEIGHT,
  DraggableItem,
} from './DraggableItem';

export { DEFAULT_DRAGGABLE_ITEM_HEIGHT as ORDERED_ROW_HEIGHT };

const SWIPE_DELETE_WIDTH = 72;
const EXTRA_LINE_HEIGHT = 16;

type Props = {
  title: string;
  /** Parent goal/milestone title shown above the habit title. */
  parentTitle?: string;
  /** Secondary line below the title (e.g. date range). */
  subtitle?: string;
  /** Optional status circle (Pending / Active / Done cycling). */
  status?: GoalStatus;
  onStatusPress?: () => void;
  index: number;
  isDragging: boolean;
  dragOffsetY: number;
  titlePlaceholder?: string;
  openAccessibilityLabel: string;
  deleteAccessibilityLabel: string;
  /** When true, hide the trash icon and use swipe-left-to-delete instead. */
  swipeToDelete?: boolean;
  onTitleChange: (title: string) => void;
  onOpen: () => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragMove: (dy: number) => void;
  onDragEnd: (fromIndex: number, toIndex: number) => void;
};

function rowHeightFor(parentTitle?: string, subtitle?: string): number {
  let height = DEFAULT_DRAGGABLE_ITEM_HEIGHT;
  if (parentTitle) {
    height += EXTRA_LINE_HEIGHT;
  }
  if (subtitle) {
    height += EXTRA_LINE_HEIGHT;
  }
  return height;
}

function statusIcon(status: GoalStatus): {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
} {
  if (status === 'done') {
    return { name: 'radio-button-on', color: '#34c759' };
  }
  if (status === 'pending') {
    return { name: 'ellipse-outline', color: '#d1d1d6' };
  }
  return { name: 'radio-button-off', color: '#c7c7cc' };
}

export function EditableOrderedRow({
  title,
  parentTitle,
  subtitle,
  status,
  onStatusPress,
  index,
  isDragging,
  dragOffsetY: _dragOffsetY,
  titlePlaceholder = 'Title',
  openAccessibilityLabel,
  deleteAccessibilityLabel,
  swipeToDelete = false,
  onTitleChange,
  onOpen,
  onDelete,
  onDragStart,
  onDragMove,
  onDragEnd,
}: Props) {
  const [editingTitle, setEditingTitle] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const swipeableRef = useRef<Swipeable | null>(null);
  const rowHeight = rowHeightFor(parentTitle, subtitle);
  const isDone = status === 'done';

  useEffect(() => {
    if (isDragging) {
      setEditingTitle(false);
      inputRef.current?.blur();
      swipeableRef.current?.close();
    }
  }, [isDragging]);

  const handleDragStart = () => {
    setEditingTitle(false);
    inputRef.current?.blur();
    swipeableRef.current?.close();
    onDragStart();
  };

  const startEditingTitle = () => {
    setEditingTitle(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleSwipeDelete = () => {
    swipeableRef.current?.close();
    onDelete();
  };

  const icon = status ? statusIcon(status) : null;

  const row = (
    <DraggableItem
      index={index}
      itemHeight={rowHeight}
      enabled={!editingTitle}
      onDragStart={handleDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      style={[styles.row, { minHeight: rowHeight }]}
    >
      {status && onStatusPress ? (
        <Pressable
          onPress={onStatusPress}
          style={({ pressed }) => [
            styles.statusHit,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Status ${status}. Tap to change.`}
        >
          <Ionicons name={icon!.name} size={22} color={icon!.color} />
        </Pressable>
      ) : null}

      <Pressable
        onPress={startEditingTitle}
        style={[styles.mainHit, { minHeight: rowHeight - 8 }]}
        disabled={editingTitle}
      >
        {parentTitle ? (
          <Text style={styles.parentTitle} numberOfLines={1}>
            {parentTitle}
          </Text>
        ) : null}
        <TextInput
          ref={inputRef}
          style={[styles.titleInput, isDone && styles.titleDone]}
          value={title}
          onChangeText={onTitleChange}
          placeholder={titlePlaceholder}
          editable={editingTitle}
          onBlur={() => setEditingTitle(false)}
          showSoftInputOnFocus
          pointerEvents={editingTitle ? 'auto' : 'none'}
        />
        {subtitle ? (
          <Text style={[styles.subtitle, isDone && styles.subtitleDone]}>
            {subtitle}
          </Text>
        ) : null}
      </Pressable>

      <Pressable
        onPress={onOpen}
        hitSlop={8}
        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        accessibilityLabel={openAccessibilityLabel}
      >
        <Text style={styles.chevron}>›</Text>
      </Pressable>

      {!swipeToDelete ? (
        <Pressable
          onPress={onDelete}
          hitSlop={8}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          accessibilityLabel={deleteAccessibilityLabel}
        >
          <Ionicons name="trash-outline" size={18} color="#c62828" />
        </Pressable>
      ) : null}
    </DraggableItem>
  );

  const stackingStyle = isDragging ? styles.draggingWrap : undefined;

  if (!swipeToDelete) {
    return <View style={stackingStyle}>{row}</View>;
  }

  return (
    <View style={stackingStyle}>
      <Swipeable
        ref={swipeableRef}
        enabled={!isDragging && !editingTitle}
        overshootRight={false}
        containerStyle={isDragging ? styles.draggingWrap : undefined}
        renderRightActions={() => (
          <Pressable
            onPress={handleSwipeDelete}
            style={styles.swipeDeleteAction}
            accessibilityLabel={deleteAccessibilityLabel}
          >
            <Ionicons name="trash" size={20} color="#fff" />
          </Pressable>
        )}
      >
        {row}
      </Swipeable>
    </View>
  );
}

const styles = StyleSheet.create({
  draggingWrap: {
    zIndex: 1000,
    elevation: 24,
    position: 'relative',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: DEFAULT_DRAGGABLE_ITEM_HEIGHT,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
    backgroundColor: '#fff',
  },
  statusHit: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainHit: {
    flex: 1,
    minHeight: DEFAULT_DRAGGABLE_ITEM_HEIGHT - 8,
    justifyContent: 'center',
  },
  parentTitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#888',
    marginBottom: 1,
  },
  titleInput: {
    fontSize: 15,
    color: '#111',
    paddingVertical: 2,
  },
  titleDone: {
    color: '#888',
    textDecorationLine: 'line-through',
  },
  subtitle: {
    fontSize: 12,
    color: '#888',
    marginTop: 1,
    paddingBottom: 1,
  },
  subtitleDone: {
    color: '#aaa',
  },
  iconButton: {
    paddingHorizontal: 2,
  },
  chevron: {
    fontSize: 22,
    color: '#c7c7cc',
    fontWeight: '600',
    lineHeight: 24,
  },
  swipeDeleteAction: {
    width: SWIPE_DELETE_WIDTH,
    backgroundColor: '#ff3b30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
