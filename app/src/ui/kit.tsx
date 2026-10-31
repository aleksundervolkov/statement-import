import type { ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

export const colors = {
  bg: '#F3F4F7',
  card: '#FFFFFF',
  text: '#0B0D12',
  muted: '#6A707C',
  faint: '#A3A8B2',
  line: '#ECEEF2',
  accent: '#3D5AFE',
  accentPressed: '#2F47D9',
  accentSoft: '#ECEFFF',
  accentSoftPressed: '#DDE2FF',
  okText: '#12805C',
  okBg: '#E5F6EF',
  warnText: '#94560A',
  warnBg: '#FFF3DE',
  errorText: '#D0312D',
  errorBg: '#FDECEB',
  errorBgPressed: '#F9DAD8',
  neutralText: '#4A505C',
  neutralBg: '#EEF0F4',
};

export type Tone = 'ok' | 'warn' | 'error' | 'neutral';

const toneColors: Record<Tone, { fg: string; bg: string }> = {
  ok: { fg: colors.okText, bg: colors.okBg },
  warn: { fg: colors.warnText, bg: colors.warnBg },
  error: { fg: colors.errorText, bg: colors.errorBg },
  neutral: { fg: colors.neutralText, bg: colors.neutralBg },
};

/** Large text past this scale stacks label/value rows instead of squeezing them side by side. */
export function useStacked() {
  return useWindowDimensions().fontScale > 1.35;
}

type ButtonKind = 'primary' | 'tinted' | 'plain' | 'destructive';

const buttonPalette: Record<ButtonKind, { bg: string; pressed: string; fg: string }> = {
  primary: { bg: colors.accent, pressed: colors.accentPressed, fg: '#FFFFFF' },
  tinted: { bg: colors.accentSoft, pressed: colors.accentSoftPressed, fg: colors.accent },
  plain: { bg: 'transparent', pressed: colors.neutralBg, fg: colors.accent },
  destructive: { bg: colors.errorBg, pressed: colors.errorBgPressed, fg: colors.errorText },
};

export function Button({ label, onPress, kind = 'primary', disabled }: { label: string; onPress: () => void; kind?: ButtonKind; disabled?: boolean }) {
  const palette = buttonPalette[kind];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      android_ripple={{ color: 'rgba(0,0,0,0.08)', borderless: false }}
      style={({ pressed }) => [
        styles.button,
        kind === 'plain' && styles.buttonPlain,
        disabled && { opacity: 0.45 },
        { backgroundColor: pressed && Platform.OS === 'ios' ? palette.pressed : palette.bg },
      ]}
    >
      <Text style={[styles.buttonLabel, { color: palette.fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children, flush }: { children: ReactNode; flush?: boolean }) {
  return <View style={[styles.card, flush && styles.cardFlush]}>{children}</View>;
}

export function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export function Notice({ tone, title, children }: { tone: Tone; title: string; children?: ReactNode }) {
  const { fg, bg } = toneColors[tone];
  return (
    <View accessibilityRole="alert" style={[styles.notice, { backgroundColor: bg }]}>
      <Text style={[styles.noticeTitle, { color: fg }]}>{title}</Text>
      {children ? <Text style={styles.noticeBody}>{children}</Text> : null}
    </View>
  );
}

export function Busy({ label }: { label: string }) {
  return (
    <View style={styles.busy}>
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.bodyMuted}>{label}</Text>
    </View>
  );
}

export function Pill({ label, tone }: { label: string; tone: Tone }) {
  const { fg, bg } = toneColors[tone];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <View style={[styles.pillDot, { backgroundColor: fg }]} />
      <Text style={[styles.pillLabel, { color: fg }]}>{label}</Text>
    </View>
  );
}

/** Round badge with short text: merchant initials or a file format. */
export function Badge({ text, size = 40, tint = colors.accent, soft = colors.accentSoft }: { text: string; size?: number; tint?: string; soft?: string }) {
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: size / 2, backgroundColor: soft }]}>
      <Text maxFontSizeMultiplier={1.2} style={[styles.badgeText, { color: tint, fontSize: Math.round(size * 0.36) }]}>{text}</Text>
    </View>
  );
}

export function Row({ label, value, first }: { label: string; value: string; first?: boolean }) {
  const stacked = useStacked();
  return (
    <View style={[styles.row, !first && styles.divider, stacked && styles.rowStacked]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, stacked && { textAlign: 'left' }]}>{value}</Text>
    </View>
  );
}

/** Centered outcome: deleted, failed, server has no record. */
export function Outcome({ tone, mark, title, children }: { tone: Tone; mark: string; title: string; children: ReactNode }) {
  const { fg, bg } = toneColors[tone];
  return (
    <View accessibilityRole="alert" style={styles.outcome}>
      <View style={[styles.outcomeMark, { backgroundColor: bg }]}>
        <Text maxFontSizeMultiplier={1.2} style={[styles.outcomeMarkText, { color: fg }]}>{mark}</Text>
      </View>
      <Text style={styles.heading}>{title}</Text>
      <Text style={[styles.bodyMuted, { textAlign: 'center' }]}>{children}</Text>
    </View>
  );
}

const android = Platform.OS === 'android';
const tight = (ios: number) => (android ? 0 : ios);
const noPad = android ? { includeFontPadding: false } : {};

export const styles = StyleSheet.create({
  title: { fontSize: 30, lineHeight: 36, fontWeight: '700', color: colors.text, letterSpacing: tight(-0.6) },
  subtitle: { fontSize: 15, lineHeight: 20, color: colors.muted },
  hero: { fontSize: 36, lineHeight: 42, fontWeight: '700', color: colors.text, letterSpacing: tight(-0.8), fontVariant: ['tabular-nums'] },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600', color: colors.text, flexShrink: 1 },
  body: { fontSize: 15, lineHeight: 20, color: colors.text, flexShrink: 1 },
  bodyMuted: { fontSize: 15, lineHeight: 20, color: colors.muted, flexShrink: 1 },
  caption: { fontSize: 12, lineHeight: 16, color: colors.faint },
  sectionLabel: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: colors.muted, marginLeft: 4, marginBottom: -4 },
  mono: { fontSize: 12, lineHeight: 17, color: colors.neutralText, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },

  button: { minHeight: 50, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 13, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  buttonPlain: { minHeight: 44, paddingVertical: 10 },
  buttonLabel: { fontSize: 16, lineHeight: 21, fontWeight: '600', textAlign: 'center', ...noPad },

  card: { backgroundColor: colors.card, borderRadius: 24, padding: 20, gap: 14 },
  cardFlush: { paddingHorizontal: 0, paddingVertical: 6, gap: 0, overflow: 'hidden' },

  notice: { borderRadius: 16, padding: 14, gap: 4 },
  noticeTitle: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  noticeBody: { fontSize: 14, lineHeight: 19, color: colors.text },

  busy: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50 },

  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start' },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillLabel: { fontSize: 12, lineHeight: 16, fontWeight: '600', ...noPad },

  badge: { alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontWeight: '700', ...noPad },

  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16, paddingVertical: 12 },
  rowStacked: { flexDirection: 'column', alignItems: 'flex-start', gap: 2 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  rowLabel: { fontSize: 15, lineHeight: 20, color: colors.muted },
  rowValue: { fontSize: 15, lineHeight: 20, fontWeight: '500', color: colors.text, flexShrink: 1, textAlign: 'right' },

  outcome: { alignItems: 'center', gap: 10, paddingTop: 8 },
  outcomeMark: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  outcomeMarkText: { fontSize: 26, fontWeight: '700', ...noPad },
});
