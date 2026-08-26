import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useState, type ReactNode } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { TargetPeriod, Weekday } from '../types';
import {
  dateFromIso,
  formatDateMDY,
  isoFromDate,
  todayDateString,
  WEEKDAY_SHORT_LABELS,
  WEEKDAYS,
} from '../utils/date';

export const PERIOD_OPTIONS: { value: TargetPeriod; label: string }[] = [
  { value: 'None', label: 'None' },
  { value: 'Day', label: 'Day' },
  { value: 'Week', label: 'Week' },
  { value: 'Month', label: 'Month' },
  { value: 'Instance', label: 'Per Session' },
];

export function FormFieldRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.formFieldRow}>
      <Text style={styles.formFieldLabel}>{label}</Text>
      <View style={styles.formFieldControl}>{children}</View>
    </View>
  );
}

export function FormSelectRow({
  label,
  value,
  placeholder,
  options,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabel =
    options.find((option) => option.value === value)?.label ?? '';

  return (
    <>
      <FormFieldRow label={label}>
        <Pressable
          onPress={() => setOpen(true)}
          style={({ pressed }) => [
            styles.formSelectButton,
            pressed && styles.pressed,
          ]}
        >
          <Text
            style={[
              styles.formSelectText,
              !selectedLabel && styles.formSelectPlaceholder,
            ]}
            numberOfLines={1}
          >
            {selectedLabel || placeholder}
          </Text>
          <Ionicons name="chevron-down" size={16} color="#666" />
        </Pressable>
      </FormFieldRow>

      <Modal
        visible={open}
        animationType="fade"
        transparent
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.menuCard}>
            <Text style={styles.modalTitle}>{label}</Text>
            <ScrollView style={styles.moveList}>
              {options.map((option) => (
                <Pressable
                  key={option.value}
                  onPress={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.choiceRow,
                    option.value === value && styles.choiceRowSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.choiceText}>{option.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setOpen(false)}
                style={styles.modalButtonSecondary}
              >
                <Text style={styles.modalButtonSecondaryText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

export function FormDateRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (isoDate: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const pickerValue = dateFromIso(value || todayDateString());

  const handleChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') {
      setOpen(false);
    }
    if (event.type === 'dismissed') {
      setOpen(false);
      return;
    }
    if (date) {
      onChange(isoFromDate(date));
    }
  };

  return (
    <>
      <FormFieldRow label={label}>
        <Pressable
          onPress={() => setOpen(true)}
          style={({ pressed }) => [
            styles.formSelectButton,
            pressed && styles.pressed,
          ]}
        >
          <Text
            style={[
              styles.formSelectText,
              !value && styles.formSelectPlaceholder,
            ]}
          >
            {value ? formatDateMDY(value) : 'mm/dd/yyyy'}
          </Text>
          <Ionicons name="calendar-outline" size={16} color="#666" />
        </Pressable>
      </FormFieldRow>

      {open && Platform.OS === 'android' ? (
        <DateTimePicker
          value={pickerValue}
          mode="date"
          display="default"
          onChange={handleChange}
        />
      ) : null}

      <Modal
        visible={open && Platform.OS === 'ios'}
        animationType="fade"
        transparent
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.menuCard}>
            <Text style={styles.modalTitle}>{label}</Text>
            <DateTimePicker
              value={pickerValue}
              mode="date"
              display="spinner"
              onChange={handleChange}
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setOpen(false)}
                style={styles.modalButtonPrimary}
              >
                <Text style={styles.modalButtonPrimaryText}>Done</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

export function FormInlineInput(props: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'email-address';
  autoFocus?: boolean;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoCorrect?: boolean;
  textContentType?: 'none' | 'emailAddress' | 'password' | 'newPassword';
}) {
  return <TextInput style={styles.formInlineInput} {...props} />;
}

export function FormDayPicker({
  selectedDays,
  onToggleDay,
}: {
  selectedDays: Weekday[];
  onToggleDay: (day: Weekday) => void;
}) {
  return (
    <View style={styles.dayPicker}>
      {WEEKDAYS.map((day) => {
        const isSelected = selectedDays.includes(day);
        return (
          <Pressable
            key={day}
            onPress={() => onToggleDay(day)}
            style={({ pressed }) => [
              styles.dayChip,
              isSelected && styles.dayChipSelected,
              pressed && styles.pressed,
            ]}
          >
            <Text
              style={[
                styles.dayChipText,
                isSelected && styles.dayChipTextSelected,
              ]}
            >
              {WEEKDAY_SHORT_LABELS[day]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function FormScheduledDaysBlock({
  selectedDays,
  onToggleDay,
}: {
  selectedDays: Weekday[];
  onToggleDay: (day: Weekday) => void;
}) {
  return (
    <View style={styles.formStackedBlock}>
      <Text style={styles.formFieldLabel}>Scheduled Days</Text>
      <FormDayPicker selectedDays={selectedDays} onToggleDay={onToggleDay} />
    </View>
  );
}

export const formFieldStyles = StyleSheet.create({
  formFieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 40,
  },
  formFieldLabel: {
    width: 78,
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
  },
  formFieldControl: {
    flex: 1,
  },
  formStackedBlock: {
    gap: 8,
  },
  formInlineInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    color: '#111',
    backgroundColor: '#fff',
  },
  formSelectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  formSelectText: {
    flex: 1,
    fontSize: 15,
    color: '#111',
  },
  formSelectPlaceholder: {
    color: '#aaa',
  },
  formReadOnlyValue: {
    fontSize: 15,
    color: '#444',
    paddingVertical: 10,
  },
  dayPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  dayChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  dayChipSelected: {
    backgroundColor: '#e8f1ff',
    borderColor: '#007aff',
  },
  dayChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  dayChipTextSelected: {
    color: '#007aff',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 24,
  },
  menuCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    maxHeight: '70%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111',
    marginBottom: 12,
  },
  moveList: {
    maxHeight: 280,
  },
  choiceRow: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#f5f5f7',
    marginBottom: 8,
  },
  choiceRowSelected: {
    backgroundColor: '#e8f1ff',
    borderWidth: 1,
    borderColor: '#007aff',
  },
  choiceText: {
    fontSize: 16,
    color: '#111',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  modalButtonSecondary: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  modalButtonSecondaryText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#555',
  },
  modalButtonPrimary: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#007aff',
  },
  modalButtonPrimaryText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  pressed: {
    opacity: 0.7,
  },
});

const styles = formFieldStyles;
