import { HeaderHeightContext } from '@react-navigation/elements';
import { useContext, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

type Props = {
  children: ReactNode;
  /**
   * Distance from the top of the screen to this view.
   * Stack screens default to the navigation header height when that context exists.
   */
  keyboardVerticalOffset?: number;
  style?: StyleProp<ViewStyle>;
};

export function KeyboardSafe({
  children,
  keyboardVerticalOffset,
  style,
}: Props) {
  const headerHeight = useContext(HeaderHeightContext);
  const offset = keyboardVerticalOffset ?? headerHeight ?? 0;

  return (
    <KeyboardAvoidingView
      style={[styles.fill, style]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={offset}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
