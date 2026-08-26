import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import {
  DEFAULT_DRAGGABLE_ITEM_HEIGHT,
  DraggableItem,
} from './DraggableItem';

export { DEFAULT_DRAGGABLE_ITEM_HEIGHT as ORDERED_ROW_HEIGHT };

type Props = {
  title: string;
  index: number;
  isDragging: boolean;
  dragOffsetY: number;
  titlePlaceholder?: string;
  openAccessibilityLabel: string;
  deleteAccessibilityLabel: string;
  onTitleChange: (title: string) => void;
  onOpen: () => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragMove: (dy: number) => void;
  onDragEnd: (fromIndex: number, toIndex: number) => void;
};

export function EditableOrderedRow({
  title,
  index,
  isDragging,
  dragOffsetY: _dragOffsetY,
  titlePlaceholder = 'Title',
  openAccessibilityLabel,
  deleteAccessibilityLabel,
  onTitleChange,
  onOpen,
  onDelete,
  onDragStart,
  onDragMove,
  onDragEnd,
}: Props) {
  const [editingTitle, setEditingTitle] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (isDragging) {
      setEditingTitle(false);
      inputRef.current?.blur();
    }
  }, [isDragging]);

  const handleDragStart = () => {
    setEditingTitle(false);
    inputRef.current?.blur();
    onDragStart();
  };

  const startEditingTitle = () => {
    setEditingTitle(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <DraggableItem
      index={index}
      itemHeight={DEFAULT_DRAGGABLE_ITEM_HEIGHT}
      enabled={!editingTitle}
      onDragStart={handleDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      style={styles.row}
    >
      <Pressable
        onPress={startEditingTitle}
        style={styles.mainHit}
        disabled={editingTitle}
      >
        <TextInput
          ref={inputRef}
          style={styles.titleInput}
          value={title}
          onChangeText={onTitleChange}
          placeholder={titlePlaceholder}
          editable={editingTitle}
          onBlur={() => setEditingTitle(false)}
          showSoftInputOnFocus
          pointerEvents={editingTitle ? 'auto' : 'none'}
        />
      </Pressable>

      <Pressable
        onPress={onOpen}
        hitSlop={8}
        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        accessibilityLabel={openAccessibilityLabel}
      >
        <Text style={styles.chevron}>›</Text>
      </Pressable>

      <Pressable
        onPress={onDelete}
        hitSlop={8}
        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        accessibilityLabel={deleteAccessibilityLabel}
      >
        <Ionicons name="trash-outline" size={18} color="#c62828" />
      </Pressable>
    </DraggableItem>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: DEFAULT_DRAGGABLE_ITEM_HEIGHT,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
    backgroundColor: '#fff',
  },
  mainHit: {
    flex: 1,
    minHeight: DEFAULT_DRAGGABLE_ITEM_HEIGHT - 12,
    justifyContent: 'center',
  },
  titleInput: {
    fontSize: 15,
    color: '#111',
    paddingVertical: 8,
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
  pressed: {
    opacity: 0.7,
  },
});
