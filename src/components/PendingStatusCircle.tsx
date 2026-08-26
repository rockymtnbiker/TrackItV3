import { StyleSheet, View } from 'react-native';

const DASH_COUNT = 8;

type Props = {
  size?: number;
  color?: string;
};

/** Dashed hollow circle for pending milestone status (no icon font dependency). */
export function PendingStatusCircle({
  size = 20,
  color = '#b0b0b5',
}: Props) {
  const radius = size / 2 - 1.5;
  const dashWidth = 2.5;
  const dashHeight = Math.max(3.5, size * 0.18);

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      {Array.from({ length: DASH_COUNT }, (_, index) => {
        const angle = (index / DASH_COUNT) * Math.PI * 2 - Math.PI / 2;
        const x = size / 2 + radius * Math.cos(angle) - dashWidth / 2;
        const y = size / 2 + radius * Math.sin(angle) - dashHeight / 2;
        return (
          <View
            key={index}
            style={[
              styles.dash,
              {
                left: x,
                top: y,
                width: dashWidth,
                height: dashHeight,
                backgroundColor: color,
                transform: [{ rotate: `${(angle * 180) / Math.PI}deg` }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
  },
  dash: {
    position: 'absolute',
    borderRadius: 1,
  },
});
