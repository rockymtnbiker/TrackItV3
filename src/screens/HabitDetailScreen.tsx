import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useHeaderHeight } from '@react-navigation/elements';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  FormDateRow,
  FormFieldRow,
  FormInlineInput,
  FormScheduledDaysBlock,
  formFieldStyles,
} from '../components/FormFields';
import { deleteHabit, getHabit, updateHabit } from '../lib/habitsApi';
import type { DetailStackParamList } from '../navigation/GoalsStackNavigator';
import type { Habit, Weekday } from '../types';
import { ALL_WEEKDAYS } from '../types';
import { WEEKDAYS } from '../utils/date';

type Props = NativeStackScreenProps<DetailStackParamList, 'HabitDetail'>;

export default function HabitDetailScreen({ navigation, route }: Props) {
  const { habitId } = route.params;
  const headerHeight = useHeaderHeight();

  const [habit, setHabit] = useState<Habit | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [title, setTitle] = useState('');
  const [scheduledDays, setScheduledDays] = useState<Weekday[]>([
    ...ALL_WEEKDAYS,
  ]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const applyHabitToDraft = useCallback((next: Habit) => {
    setTitle(next.title);
    setScheduledDays(
      next.scheduledDays?.length ? [...next.scheduledDays] : [...ALL_WEEKDAYS],
    );
    setStartDate(next.startDate ?? '');
    setEndDate(next.endDate ?? '');
  }, []);

  const loadHabit = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const found = await getHabit(habitId);
      setHabit(found);
      if (found) {
        applyHabitToDraft(found);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load habit.';
      setLoadError(message);
      setHabit(null);
    } finally {
      setLoading(false);
    }
  }, [applyHabitToDraft, habitId]);

  useEffect(() => {
    void loadHabit();
  }, [loadHabit]);

  const draftRef = useRef({
    title,
    scheduledDays,
    startDate,
    endDate,
  });
  draftRef.current = {
    title,
    scheduledDays,
    startDate,
    endDate,
  };

  const persist = useCallback(() => {
    if (!habit || deleting) {
      return;
    }

    const draft = draftRef.current;
    const trimmedTitle = draft.title.trim();
    if (!trimmedTitle) {
      return;
    }

    const orderedDays = WEEKDAYS.filter((day) =>
      draft.scheduledDays.includes(day),
    );
    const days = orderedDays.length > 0 ? orderedDays : [...ALL_WEEKDAYS];

    void updateHabit(habitId, {
      title: trimmedTitle,
      scheduledDays: days,
      weeklyTarget: days.length,
      startDate: draft.startDate.trim() || null,
      endDate: draft.endDate.trim() || null,
    })
      .then((updated) => {
        setHabit(updated);
      })
      .catch((error) => {
        console.warn('Failed to save habit', error);
      });
  }, [deleting, habit, habitId]);

  useEffect(() => {
    const unsubscribeBlur = navigation.addListener('blur', persist);
    const unsubscribeRemove = navigation.addListener('beforeRemove', persist);
    return () => {
      unsubscribeBlur();
      unsubscribeRemove();
    };
  }, [navigation, persist]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        persist();
      }
    });
    return () => subscription.remove();
  }, [persist]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: title.trim() || habit?.title || 'Habit',
    });
  }, [habit?.title, navigation, title]);

  const toggleScheduledDay = (day: Weekday) => {
    setScheduledDays((current) =>
      current.includes(day)
        ? current.filter((entry) => entry !== day)
        : [...current, day],
    );
  };

  const confirmDeleteHabit = () => {
    if (deleting) {
      return;
    }
    Alert.alert(
      'Delete Habit',
      'Are you sure you want to delete this habit? This will permanently remove all associated results.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setDeleting(true);
            void deleteHabit(habitId)
              .then(() => {
                navigation.goBack();
              })
              .catch((error) => {
                console.warn('Failed to delete habit', error);
                Alert.alert(
                  'Delete failed',
                  error instanceof Error
                    ? error.message
                    : 'Could not delete this habit.',
                );
              })
              .finally(() => {
                setDeleting(false);
              });
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.missing}>
        <ActivityIndicator color="#007aff" />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingText}>{loadError}</Text>
        <Pressable
          onPress={() => void loadHabit()}
          style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
        >
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!habit) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingText}>This habit is no longer available.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}
    >
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.sectionCard}>
        <View style={styles.fields}>
          <FormFieldRow label="Title">
            <FormInlineInput
              value={title}
              onChangeText={setTitle}
              placeholder="Enter title"
            />
          </FormFieldRow>

          <FormScheduledDaysBlock
            selectedDays={scheduledDays}
            onToggleDay={toggleScheduledDay}
          />

          <FormFieldRow label="Weekly">
            <Text style={formFieldStyles.formReadOnlyValue}>
              {scheduledDays.length} day
              {scheduledDays.length === 1 ? '' : 's'}/week
            </Text>
          </FormFieldRow>

          <FormDateRow label="Start" value={startDate} onChange={setStartDate} />
          <FormDateRow label="End" value={endDate} onChange={setEndDate} />
        </View>
      </View>

      <Pressable
        onPress={confirmDeleteHabit}
        disabled={deleting}
        style={({ pressed }) => [
          styles.deleteButton,
          pressed && styles.pressed,
          deleting && styles.deleteButtonDisabled,
        ]}
      >
        {deleting ? (
          <ActivityIndicator color="#c62828" />
        ) : (
          <Text style={styles.deleteButtonText}>Delete Habit</Text>
        )}
      </Pressable>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f2f2f7',
  },
  content: {
    padding: 12,
    paddingBottom: 28,
    gap: 8,
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
    backgroundColor: '#f2f2f7',
  },
  missingText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
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
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 10,
    gap: 6,
  },
  fields: {
    gap: 6,
  },
  deleteButton: {
    marginTop: 4,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ffcdd2',
  },
  deleteButtonDisabled: {
    opacity: 0.6,
  },
  deleteButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#c62828',
  },
  pressed: {
    opacity: 0.7,
  },
});
