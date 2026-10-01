import { Ionicons } from '@expo/vector-icons';
import { useMemo, useRef, type ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector, Pressable } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

export const DEFAULT_DRAGGABLE_ITEM_HEIGHT = 52;
export const LONG_PRESS_MS = 400;
const SWIPE_DELETE_WIDTH = 72;

type Props = {
  index: number;
  /** Used to convert drag distance into an index delta on release. */
  itemHeight?: number;
  enabled?: boolean;
  /** Short tap (not used when a long-press drag activates). */
  onPress?: () => void;
  onDragStart: () => void;
  onDragMove: (dy: number) => void;
  onDragEnd: (fromIndex: number, toIndex: number) => void;
  /** Reveals a delete button on a horizontal swipe. Kept in the same gesture as drag so the two don't block each other. */
  onSwipeDelete?: () => void;
  deleteAccessibilityLabel?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function DraggableItem({
  index,
  itemHeight = DEFAULT_DRAGGABLE_ITEM_HEIGHT,
  enabled = true,
  onPress,
  onDragStart,
  onDragMove,
  onDragEnd,
  onSwipeDelete,
  deleteAccessibilityLabel = 'Delete',
  children,
  style,
}: Props) {
  const indexRef = useRef(index);
  indexRef.current = index;
  const itemHeightRef = useRef(itemHeight);
  itemHeightRef.current = itemHeight;

  const dragSessionRef = useRef(false);

  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;
  const onDragStartRef = useRef(onDragStart);
  onDragStartRef.current = onDragStart;
  const onDragMoveRef = useRef(onDragMove);
  onDragMoveRef.current = onDragMove;
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;
  const onSwipeDeleteRef = useRef(onSwipeDelete);
  onSwipeDeleteRef.current = onSwipeDelete;

  const translateY = useSharedValue(0);
  const swipeX = useSharedValue(0);
  const lifted = useSharedValue(0);

  const beginDrag = () => {
    dragSessionRef.current = true;
    onDragStartRef.current();
  };

  const handleSwipeDelete = () => {
    swipeX.value = withTiming(0, { duration: 180 });
    onSwipeDeleteRef.current?.();
  };

  const moveDrag = (dy: number) => {
    onDragMoveRef.current(dy);
  };

  const endDrag = (dy: number) => {
    if (!dragSessionRef.current) {
      return;
    }
    dragSessionRef.current = false;
    const fromIndex = indexRef.current;
    const toIndex = Math.max(
      0,
      fromIndex + Math.round(dy / itemHeightRef.current),
    );
    onDragEndRef.current(fromIndex, toIndex);
  };

  const handlePress = () => {
    onPressRef.current?.();
  };

  const gesture = useMemo(() => {
    const swipe =
      onSwipeDelete != null
        ? Gesture.Pan()
            .enabled(enabled)
            .activeOffsetX([-15, 15])
            .failOffsetY([-12, 12])
            .onUpdate((event) => {
              swipeX.value = Math.min(
                0,
                Math.max(-SWIPE_DELETE_WIDTH, event.translationX),
              );
            })
            .onEnd((event) => {
              const open =
                event.translationX < -SWIPE_DELETE_WIDTH / 2 ||
                event.velocityX < -500;
              swipeX.value = withTiming(open ? -SWIPE_DELETE_WIDTH : 0, {
                duration: 180,
              });
            })
        : null;

    const pan = Gesture.Pan()
      .activateAfterLongPress(LONG_PRESS_MS)
      .enabled(enabled);
    if (swipe) {
      pan.blocksExternalGesture(swipe);
    }
    pan
      .onStart(() => {
        // Set immediately so zIndex/elevation kick in before the first frame.
        lifted.value = 1;
        swipeX.value = 0;
        runOnJS(beginDrag)();
      })
      .onUpdate((event) => {
        translateY.value = event.translationY;
        runOnJS(moveDrag)(event.translationY);
      })
      .onEnd((event) => {
        runOnJS(endDrag)(event.translationY);
        translateY.value = withTiming(0, { duration: 120 });
        lifted.value = withTiming(0, { duration: 120 });
      })
      .onFinalize((_event, success) => {
        if (!success) {
          runOnJS(endDrag)(0);
          translateY.value = withTiming(0, { duration: 120 });
          lifted.value = withTiming(0, { duration: 120 });
        }
      });

    // Race so a long-press drag and a horizontal swipe can each win.
    // blocksExternalGesture lets the drag take the touch from the swipe.
    const dragOrSwipe = swipe != null ? Gesture.Race(pan, swipe) : pan;

    if (!onPress) {
      return dragOrSwipe;
    }

    // Pan is listed first so a successful long-press drag cancels the tap.
    // Tap.maxDuration ensures a long hold can't fire navigation on release
    // if the pan gesture fails to activate for any reason.
    const tap = Gesture.Tap()
      .enabled(enabled)
      .maxDuration(LONG_PRESS_MS - 50)
      .onEnd(() => {
        if (swipeX.value < -1) {
          swipeX.value = withTiming(0, { duration: 180 });
          return;
        }
        runOnJS(handlePress)();
      });

    return Gesture.Exclusive(dragOrSwipe, tap);
    // Shared values + refs keep handlers current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, Boolean(onPress), onSwipeDelete != null]);

  const swipeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: swipeX.value }],
  }));

  const animatedStyle = useAnimatedStyle(() => {
    const active = lifted.value > 0;
    return {
      transform: [
        { translateY: translateY.value },
        { scale: 1 + lifted.value * 0.03 },
      ],
      zIndex: active ? 1000 : 0,
      elevation: active ? 24 : 0,
      shadowOpacity: active ? 0.2 : 0.06,
    };
  });

  if (!onSwipeDelete) {
    return (
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[styles.base, style, animatedStyle]}
          accessibilityHint="Long press and drag to reorder"
          accessibilityRole={onPress ? 'button' : undefined}
        >
          {children}
        </Animated.View>
      </GestureDetector>
    );
  }

  return (
    <Animated.View style={[style, animatedStyle]}>
      <Pressable
        onPress={handleSwipeDelete}
        style={styles.swipeDelete}
        accessibilityLabel={deleteAccessibilityLabel}
      >
        <Ionicons name="trash" size={20} color="#fff" />
      </Pressable>
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[styles.base, swipeStyle]}
          accessibilityHint="Long press and drag to reorder"
          accessibilityRole={onPress ? 'button' : undefined}
        >
          {children}
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    position: 'relative',
    shadowColor: '#000',
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  swipeDelete: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: SWIPE_DELETE_WIDTH,
    backgroundColor: '#ff3b30',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
