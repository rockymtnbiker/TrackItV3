import { Ionicons } from '@expo/vector-icons';
import { useRef } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';

const ACTION_WIDTH = 56;
const SWIPE_THRESHOLD = ACTION_WIDTH * 1.5;

type SwipeableRowProps = {
  children: React.ReactNode;
  onEdit: () => void;
  onMove?: () => void;
  onDelete: () => void;
  style?: ViewStyle;
};

export default function SwipeableRow({
  children,
  onEdit,
  onMove,
  onDelete,
  style,
}: SwipeableRowProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const openOffset = useRef(-(onMove ? ACTION_WIDTH * 3 : ACTION_WIDTH * 2));

  const close = () => {
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 0,
    }).start();
  };

  const open = () => {
    Animated.spring(translateX, {
      toValue: openOffset.current,
      useNativeDriver: true,
      bounciness: 0,
    }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderMove: (_, gesture) => {
        const next = Math.min(0, Math.max(openOffset.current, gesture.dx));
        translateX.setValue(next);
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx < -SWIPE_THRESHOLD) {
          open();
          return;
        }

        close();
      },
    }),
  ).current;

  const runAction = (action: () => void) => {
    close();
    action();
  };

  return (
    <View style={[styles.container, style]}>
      <View style={styles.actions}>
        <Pressable
          onPress={() => runAction(onEdit)}
          style={[styles.actionButton, styles.editButton]}
        >
          <Ionicons name="pencil" size={20} color="#fff" />
        </Pressable>
        {onMove ? (
          <Pressable
            onPress={() => runAction(onMove)}
            style={[styles.actionButton, styles.moveButton]}
          >
            <Ionicons name="arrow-forward" size={20} color="#fff" />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => runAction(onDelete)}
          style={[styles.actionButton, styles.deleteButton]}
        >
          <Ionicons name="trash" size={20} color="#fff" />
        </Pressable>
      </View>

      <Animated.View
        style={[styles.content, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  actions: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  actionButton: {
    width: ACTION_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editButton: {
    backgroundColor: '#007aff',
  },
  moveButton: {
    backgroundColor: '#5856d6',
  },
  deleteButton: {
    backgroundColor: '#ff3b30',
  },
  content: {
    backgroundColor: '#fff',
  },
});
