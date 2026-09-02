import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

export default function EmptyState({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.wrap}>
      <Ionicons name={icon} size={40} color={colors.dim} style={styles.icon} />
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, paddingBottom: 80 },
  icon: { marginBottom: 14, opacity: 0.6 },
  text: { color: colors.dim, fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
