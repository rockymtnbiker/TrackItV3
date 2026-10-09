import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { dateFromIso, todayDateString } from '../utils/date';

function todayAtMidnight(): Date {
  return dateFromIso(todayDateString());
}

function clampDate(date: Date, minimumDate?: Date, maximumDate?: Date): Date {
  if (minimumDate && date.getTime() < minimumDate.getTime()) {
    return minimumDate;
  }
  if (maximumDate && date.getTime() > maximumDate.getTime()) {
    return maximumDate;
  }
  return date;
}

export function DatePickerModal({
  title,
  value,
  minimumDate,
  maximumDate,
  onConfirm,
  onCancel,
}: {
  title: string;
  value: Date | null;
  minimumDate?: Date;
  maximumDate?: Date;
  onConfirm: (date: Date) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() =>
    clampDate(value ?? todayAtMidnight(), minimumDate, maximumDate),
  );

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <DateTimePicker
            value={draft}
            mode="date"
            display="inline"
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            onChange={(_event, date) => {
              if (date) {
                setDraft(clampDate(date, minimumDate, maximumDate));
              }
            }}
            style={styles.picker}
          />
          <View style={styles.actions}>
            <Pressable onPress={onCancel} style={styles.cancelButton}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={() => onConfirm(draft)} style={styles.doneButton}>
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111',
    marginBottom: 12,
  },
  picker: {
    height: 340,
    alignSelf: 'stretch',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  cancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#555',
  },
  doneButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#007aff',
  },
  doneText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
});
