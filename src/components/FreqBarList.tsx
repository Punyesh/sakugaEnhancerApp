import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

export interface FreqEntry {
  name: string;
  count: number;
}

interface Props {
  entries: FreqEntry[];
  /** 'artist' = amber accent, 'show' = blue — matches the tag-chip color
   * coding used everywhere else in the app, so the two directions of this
   * feature stay visually distinct at a glance. */
  variant: 'artist' | 'show';
  onPress: (name: string) => void;
}

export default function FreqBarList({ entries, variant, onPress }: Props) {
  if (!entries.length) return null;
  const maxCount = entries[0].count;
  const accent = variant === 'show' ? colors.link : colors.amber;
  const accentDim = variant === 'show' ? '#2c5170' : colors.amberDim;

  return (
    <View style={styles.list}>
      {entries.map((e, i) => {
        const pct = Math.max(6, Math.round((e.count / maxCount) * 100));
        return (
          <TouchableOpacity key={e.name} style={styles.row} onPress={() => onPress(e.name)}>
            <Text style={styles.rank}>{i + 1}</Text>
            <Text style={[styles.name, { color: accent }]} numberOfLines={1}>
              {e.name}
            </Text>
            <View style={styles.barWrap}>
              <View style={[styles.bar, { width: `${pct}%`, backgroundColor: accent, opacity: 0.55 + (pct / 100) * 0.45 }]} />
            </View>
            <Text style={styles.count}>{e.count}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.panel,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  rank: { width: 14, textAlign: 'right', fontSize: 10, color: colors.dim, fontFamily: 'monospace' },
  name: { width: 112, fontSize: 12 },
  barWrap: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.bg, overflow: 'hidden' },
  bar: { height: '100%', borderRadius: 3 },
  count: { width: 34, textAlign: 'right', fontSize: 11, color: colors.dim, fontFamily: 'monospace' },
});
