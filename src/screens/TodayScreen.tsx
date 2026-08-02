import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAppData } from '../context/AppDataContext';
import {
  formatDate,
  getWeekDays,
  todayDateString,
  WEEKDAY_SHORT_LABELS,
  type WeekDayCell,
} from '../utils/date';
import {
  buildChecklistSections,
  type ChecklistItem,
} from '../utils/todayChecklist';

function StreakBadge({ streak }: { streak: number }) {
  if (streak < 3) {
    return null;
  }

  return (
    <View style={styles.streakBadge}>
      <Ionicons name="flame" size={12} color="#ff6b00" />
      <Text style={styles.streakBadgeText}>{streak}</Text>
    </View>
  );
}

function WeekDateStrip({
  days,
  today,
  selectedDate,
  onSelectDate,
}: {
  days: WeekDayCell[];
  today: string;
  selectedDate: string;
  onSelectDate: (dateString: string) => void;
}) {
  return (
    <View style={styles.weekStrip}>
      {days.map((day) => {
        const isToday = day.dateString === today;
        const isSelected = day.dateString === selectedDate;

        return (
          <Pressable
            key={day.dateString}
            onPress={() => onSelectDate(day.dateString)}
            style={({ pressed }) => [
              styles.weekDayCell,
              isToday && styles.weekDayCellToday,
              isSelected && !isToday && styles.weekDayCellSelected,
              isSelected && isToday && styles.weekDayCellSelectedToday,
              pressed && styles.pressed,
            ]}
          >
            <Text
              style={[
                styles.weekDayAbbrev,
                isToday && styles.weekDayTextToday,
                isSelected && !isToday && styles.weekDayTextSelected,
              ]}
            >
              {WEEKDAY_SHORT_LABELS[day.weekday]}
            </Text>
            <Text
              style={[
                styles.weekDayNumber,
                isToday && styles.weekDayTextToday,
                isSelected && !isToday && styles.weekDayTextSelected,
              ]}
            >
              {day.dayNumber}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ChecklistRow({
  item,
  onToggle,
}: {
  item: ChecklistItem;
  onToggle: () => void;
}) {
  const iconName = item.isComplete
    ? 'radio-button-on'
    : item.isPlanned
      ? 'ellipse-outline'
      : 'radio-button-off';
  const iconColor = item.isComplete
    ? '#34c759'
    : item.isPlanned
      ? '#d1d1d6'
      : '#c7c7cc';

  return (
    <Pressable
      onPress={item.isInteractive ? onToggle : undefined}
      disabled={!item.isInteractive}
      style={({ pressed }) => [
        styles.checklistRow,
        item.isComplete && styles.checklistRowComplete,
        item.isPlanned && styles.checklistRowPlanned,
        item.isInteractive && pressed && styles.pressed,
      ]}
    >
      <Ionicons
        name={iconName}
        size={24}
        color={iconColor}
        style={styles.radio}
      />
      <View style={styles.checklistContent}>
        <View style={styles.titleRow}>
          <Text
            style={[
              styles.checklistTitle,
              item.isComplete && styles.checklistTitleComplete,
              item.isPlanned && styles.checklistTitlePlanned,
            ]}
          >
            {item.title}
          </Text>
          {item.streak !== undefined ? <StreakBadge streak={item.streak} /> : null}
          {item.isPlanned ? (
            <Text style={styles.plannedLabel}>Planned</Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function getChecklistHeading(selectedDate: string, today: string): string {
  if (selectedDate === today) {
    return 'Today';
  }

  return formatDate(selectedDate);
}

export default function TodayScreen() {
  const {
    objectives,
    keyResults,
    activeDailyHabits,
    activeKeyActivities,
    toggleDailyHabitCompletion,
    toggleKeyActivityCompletion,
  } = useAppData();

  const today = todayDateString();
  const [selectedDate, setSelectedDate] = useState(today);

  const weekDays = useMemo(() => getWeekDays(today), [today]);

  const primaryObjective = useMemo(
    () => objectives.find((objective) => !objective.deletedAt),
    [objectives],
  );
  const affirmation =
    primaryObjective?.affirmation ??
    (primaryObjective
      ? `I am achieving: ${primaryObjective.title}`
      : 'Set an Objective to see your affirmation');

  const keyResultTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const keyResult of keyResults) {
      if (!keyResult.deletedAt) {
        map.set(keyResult.id, keyResult.title);
      }
    }
    return map;
  }, [keyResults]);

  const objectiveTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const objective of objectives) {
      if (!objective.deletedAt) {
        map.set(objective.id, objective.title);
      }
    }
    return map;
  }, [objectives]);

  const sections = useMemo(
    () =>
      buildChecklistSections(
        selectedDate,
        activeDailyHabits,
        activeKeyActivities,
        keyResultTitles,
        objectiveTitles,
        today,
      ),
    [
      selectedDate,
      activeDailyHabits,
      activeKeyActivities,
      keyResultTitles,
      objectiveTitles,
      today,
    ],
  );

  const totalItems = sections.reduce(
    (sum, section) => sum + section.items.length,
    0,
  );

  const checklistHeading = getChecklistHeading(selectedDate, today);

  const handleToggle = (item: ChecklistItem) => {
    if (!item.isInteractive) {
      return;
    }

    if (item.type === 'dailyHabit') {
      toggleDailyHabitCompletion(item.id, selectedDate);
      return;
    }

    toggleKeyActivityCompletion(item.id, selectedDate);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.affirmation}>{affirmation}</Text>

      <WeekDateStrip
        days={weekDays}
        today={today}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
      />

      <Text style={styles.screenTitle}>{checklistHeading}</Text>

      {totalItems > 0 ? (
        sections.map((section) => (
          <View key={section.key} style={styles.sectionBlock}>
            <Text style={styles.sectionHeader}>{section.title}</Text>
            <View style={styles.checklistCard}>
              {section.items.map((item) => (
                <ChecklistRow
                  key={`${item.type}-${item.id}`}
                  item={item}
                  onToggle={() => handleToggle(item)}
                />
              ))}
            </View>
          </View>
        ))
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            {selectedDate === today
              ? 'No daily habits or key activities due today. Add some on the Goals tab.'
              : 'Nothing scheduled for this day.'}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f4f4f6',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  affirmation: {
    fontSize: 26,
    fontWeight: '700',
    color: '#111',
    textAlign: 'center',
    lineHeight: 34,
    marginBottom: 20,
    paddingHorizontal: 8,
  },
  weekStrip: {
    flexDirection: 'row',
    marginBottom: 24,
    gap: 4,
  },
  weekDayCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  weekDayCellToday: {
    backgroundColor: '#007aff',
  },
  weekDayCellSelected: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#007aff',
  },
  weekDayCellSelectedToday: {
    backgroundColor: '#007aff',
    borderWidth: 2,
    borderColor: '#0051a8',
  },
  weekDayAbbrev: {
    fontSize: 12,
    fontWeight: '600',
    color: '#888',
    marginBottom: 4,
  },
  weekDayNumber: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
  },
  weekDayTextToday: {
    color: '#fff',
  },
  weekDayTextSelected: {
    color: '#007aff',
  },
  screenTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111',
    marginBottom: 12,
  },
  sectionBlock: {
    marginBottom: 16,
  },
  sectionHeader: {
    fontSize: 15,
    fontWeight: '600',
    color: '#555',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  checklistCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    overflow: 'hidden',
  },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
  },
  checklistRowComplete: {
    backgroundColor: '#f8fff9',
  },
  checklistRowPlanned: {
    opacity: 0.85,
  },
  radio: {
    marginRight: 12,
    marginTop: 1,
  },
  checklistContent: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  checklistTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#222',
  },
  checklistTitleComplete: {
    color: '#888',
    textDecorationLine: 'line-through',
  },
  checklistTitlePlanned: {
    color: '#666',
  },
  plannedLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#999',
    backgroundColor: '#f0f0f0',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  streakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#fff4e8',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  streakBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#ff6b00',
  },
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  emptyText: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    lineHeight: 22,
  },
  pressed: {
    opacity: 0.7,
  },
});
