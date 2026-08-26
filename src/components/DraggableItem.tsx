import { useMemo, useRef, type ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

export const DEFAULT_DRAGGABLE_ITEM_HEIGHT = 52;
export const LONG_PRESS_MS = 400;

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

  const translateY = useSharedValue(0);
  const lifted = useSharedValue(0);

  const beginDrag = () => {
    dragSessionRef.current = true;
    onDragStartRef.current();
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
    const pan = Gesture.Pan()
      .activateAfterLongPress(LONG_PRESS_MS)
      .enabled(enabled)
      .onStart(() => {
        // Set immediately so zIndex/elevation kick in before the first frame.
        lifted.value = 1;
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

    if (!onPress) {
      return pan;
    }

    // Pan is listed first so a successful long-press drag cancels the tap.
    // Tap.maxDuration ensures a long hold can't fire navigation on release
    // if the pan gesture fails to activate for any reason.
    const tap = Gesture.Tap()
      .enabled(enabled)
      .maxDuration(LONG_PRESS_MS - 50)
      .onEnd(() => {
        runOnJS(handlePress)();
      });

    return Gesture.Exclusive(pan, tap);
    // Shared values + refs keep handlers current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, Boolean(onPress)]);

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

const styles = StyleSheet.create({
  base: {
    position: 'relative',
    shadowColor: '#000',
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
});
