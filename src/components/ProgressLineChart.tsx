import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import type { ProgressSeries } from '../lib/metrics';

const CHART_HEIGHT = 160;
const PAD_LEFT = 36;
const PAD_RIGHT = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 22;

const ACTUAL_COLOR = '#007aff';
const EXPECTED_COLOR = '#111';
const GRID_COLOR = '#e5e5ea';
const LABEL_COLOR = '#8e8e93';

type Props = {
  series: ProgressSeries;
};

function formatMonthDay(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
}

function yFor(pct: number, maxPct: number, plotTop: number, plotHeight: number): number {
  const ratio = maxPct <= 0 ? 0 : Math.max(0, pct) / maxPct;
  return plotTop + plotHeight * (1 - ratio);
}

export function ProgressLineChart({ series }: Props) {
  const [width, setWidth] = useState(0);
  const actualDays = series.days.filter((day) => day.actualPct != null);

  if (actualDays.length < 2) {
    return <Text style={styles.placeholder}>Graph fills in after day one</Text>;
  }

  const plotWidth = Math.max(0, width - PAD_LEFT - PAD_RIGHT);
  const plotHeight = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const lastIndex = series.days.length - 1;

  const xFor = (index: number) =>
    lastIndex <= 0 ? PAD_LEFT : PAD_LEFT + (index / lastIndex) * plotWidth;

  const expectedPoints = series.days
    .map((day, index) => {
      const y = yFor(day.expectedPct, series.maxPct, PAD_TOP, plotHeight);
      return `${xFor(index)},${y}`;
    })
    .join(' ');

  const actualPoints = series.days
    .flatMap((day, index) => {
      if (day.actualPct == null) {
        return [];
      }
      const y = yFor(day.actualPct, series.maxPct, PAD_TOP, plotHeight);
      return [`${xFor(index)},${y}`];
    })
    .join(' ');

  const todayIndex = series.days.findIndex(
    (day, index) => day.actualPct != null && series.days[index + 1]?.actualPct == null,
  );
  const todayPoint =
    todayIndex >= 0 ? series.days[todayIndex] : actualDays[actualDays.length - 1];
  const todayDrawIndex =
    todayIndex >= 0 ? todayIndex : series.days.findIndex((day) => day.date === todayPoint?.date);

  const gridPercents = [0, 50, 100];

  return (
    <View
      onLayout={(event) => {
        const next = event.nativeEvent.layout.width;
        if (next !== width) {
          setWidth(next);
        }
      }}
    >
      {width > 0 ? (
        <Svg width={width} height={CHART_HEIGHT}>
          {gridPercents.map((pct) => {
            const y = yFor(pct, series.maxPct, PAD_TOP, plotHeight);
            return (
              <Line
                key={pct}
                x1={PAD_LEFT}
                x2={width - PAD_RIGHT}
                y1={y}
                y2={y}
                stroke={GRID_COLOR}
                strokeWidth={1}
              />
            );
          })}
          {gridPercents.map((pct) => {
            const y = yFor(pct, series.maxPct, PAD_TOP, plotHeight);
            return (
              <SvgText
                key={`label-${pct}`}
                x={PAD_LEFT - 6}
                y={y + 3}
                fontSize={10}
                fill={LABEL_COLOR}
                textAnchor="end"
              >
                {pct}%
              </SvgText>
            );
          })}
          <Polyline
            points={expectedPoints}
            fill="none"
            stroke={EXPECTED_COLOR}
            strokeWidth={2}
            strokeDasharray="4 4"
          />
          <Polyline
            points={actualPoints}
            fill="none"
            stroke={ACTUAL_COLOR}
            strokeWidth={2}
          />
          {todayPoint?.actualPct != null && todayDrawIndex >= 0 ? (
            <Circle
              cx={xFor(todayDrawIndex)}
              cy={yFor(todayPoint.actualPct, series.maxPct, PAD_TOP, plotHeight)}
              r={3.5}
              fill={ACTUAL_COLOR}
            />
          ) : null}
          <SvgText
            x={xFor(0)}
            y={CHART_HEIGHT - 4}
            fontSize={10}
            fill={LABEL_COLOR}
            textAnchor="start"
          >
            {formatMonthDay(series.days[0].date)}
          </SvgText>
          <SvgText
            x={xFor(lastIndex)}
            y={CHART_HEIGHT - 4}
            fontSize={10}
            fill={LABEL_COLOR}
            textAnchor="end"
          >
            {formatMonthDay(series.days[lastIndex].date)}
          </SvgText>
        </Svg>
      ) : (
        <View style={styles.chartSpacer} />
      )}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={styles.actualSwatch} />
          <Text style={styles.legendText}>Actual</Text>
        </View>
        <View style={styles.legendItem}>
          <Svg width={16} height={4}>
            <Line
              x1={0}
              x2={16}
              y1={2}
              y2={2}
              stroke={EXPECTED_COLOR}
              strokeWidth={2}
              strokeDasharray="3 2"
            />
          </Svg>
          <Text style={styles.legendText}>Expected</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    fontSize: 13,
    color: LABEL_COLOR,
  },
  chartSpacer: {
    height: CHART_HEIGHT,
  },
  legend: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 4,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendText: {
    fontSize: 12,
    color: LABEL_COLOR,
  },
  actualSwatch: {
    width: 16,
    height: 2,
    backgroundColor: ACTUAL_COLOR,
  },
});
