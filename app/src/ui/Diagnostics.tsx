import { useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import { API_BASE_URL } from '../config';
import { devLog, type LogTone } from '../devLog';
import { Button, Card, Pill, colors, styles } from './kit';

const scenarios = ['happy', 'lost_ack', 'stale_status', 'delete_failure'] as const;
type Scenario = (typeof scenarios)[number];

const scenarioHint: Record<Scenario, string> = {
  happy: 'Normal responses.',
  lost_ack: 'The server saves the first upload but drops its response.',
  stale_status: 'After ready, revision 3, the server sends processing, revision 2.',
  delete_failure: 'Delete answers 503 and keeps the import.',
};

type MockState = {
  mode: string;
  stats: { createRequests: number; newJobs: number; duplicateHits: number; acceptedBytes: number; deleteRequests: number };
};

function isScenario(value: unknown): value is Scenario {
  return typeof value === 'string' && (scenarios as readonly string[]).includes(value);
}

async function readMock(): Promise<MockState> {
  const response = await fetch(`${API_BASE_URL}/__test/state`);
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

/** Re-reads the mock after every activity change, so the counters move while the log grows. */
function useMockState() {
  const entries = useSyncExternalStore(devLog.subscribe, devLog.get);
  const [state, setState] = useState<MockState | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const settled = entries.filter(entry => entry.tone !== 'pending').length;

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      readMock()
        .then(next => { if (alive) { setState(next); setUnreachable(false); } })
        .catch(() => { if (alive) setUnreachable(true); });
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [settled, entries.length]);

  return { entries, state, unreachable, reload: () => readMock().then(setState) };
}

function clock(at: number) {
  const time = new Date(at);
  return [time.getHours(), time.getMinutes(), time.getSeconds()].map(part => String(part).padStart(2, '0')).join(':');
}

const toneColor: Record<LogTone, string> = {
  plain: colors.neutralText,
  ok: colors.okText,
  warn: colors.warnText,
  error: colors.errorText,
  pending: colors.faint,
};

/** Reviewer-only view of the app's own requests and decisions. Rendered in __DEV__ builds only. */
export function Activity() {
  const { entries, state, unreachable } = useMockState();
  const stats = state?.stats;

  return (
    <Card>
      <View style={{ gap: 2 }}>
        <Text style={styles.heading}>What the app is doing</Text>
        <Text style={[styles.bodyMuted, { fontSize: 13, lineHeight: 18 }]}>Requests to the server, its answers and the app’s decisions.</Text>
      </View>

      {entries.length === 0 ? (
        <Text style={[styles.bodyMuted, { fontSize: 13, lineHeight: 18 }]}>Nothing yet. Choose a file to start.</Text>
      ) : (
        <View style={{ gap: 8 }}>
          {entries.map(entry => (
            <View key={entry.id} style={{ flexDirection: 'row', gap: 8 }}>
              <Text style={[styles.mono, { color: colors.faint }]}>{clock(entry.at)}</Text>
              <View style={{ flex: 1 }}>
                <Text selectable style={[styles.mono, { color: entry.note ? colors.text : toneColor[entry.tone], fontWeight: entry.note ? '600' : '400' }]}>
                  {entry.text}{entry.repeat > 1 ? `  ×${entry.repeat}` : ''}
                </Text>
                {entry.note && <Text selectable style={[styles.mono, { color: toneColor[entry.tone] }]}>{entry.note}</Text>}
              </View>
            </View>
          ))}
        </View>
      )}

      <View style={{ padding: 12, borderRadius: 14, backgroundColor: colors.bg, gap: 4 }}>
        <Text style={[styles.mono, { fontWeight: '700', color: colors.text }]}>Mock server counters</Text>
        {unreachable && <Text style={[styles.mono, { color: colors.errorText }]}>Mock not reachable.</Text>}
        {stats && ([
          ['upload requests', stats.createRequests],
          ['new jobs', stats.newJobs],
          ['same-key repeats', stats.duplicateHits],
          ['bytes received', stats.acceptedBytes],
          ['delete requests', stats.deleteRequests],
        ] as const).map(([name, value]) => (
          <View key={name} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text style={styles.mono}>{name}</Text>
            <Text selectable style={[styles.mono, { fontWeight: '700', color: colors.text }]}>{value}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

/** Reviewer-only switches for the kit's /__test routes. Rendered in __DEV__ builds only. */
export function Diagnostics() {
  const [open, setOpen] = useState(false);
  const { state, unreachable, reload } = useMockState();
  const [chosen, setChosen] = useState<Scenario | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const active = isScenario(state?.mode) ? state.mode : chosen;

  async function post(path: string, body?: object) {
    setFailure(null);
    try {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw new Error(String(response.status));
      return true;
    } catch {
      setFailure(`Mock did not accept ${path}.`);
      return false;
    }
  }

  async function choose(mode: Scenario) {
    if (await post('/__test/scenario', { mode })) {
      setChosen(mode);
      reload().catch(() => undefined);
    }
  }

  async function reset() {
    if (await post('/__test/reset')) {
      devLog.clear();
      reload().catch(() => undefined);
    }
  }

  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(!open)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.heading}>{open ? 'Hide mock diagnostics' : 'Mock diagnostics'}</Text>
          <Text style={[styles.bodyMuted, { fontSize: 13, lineHeight: 18 }]}>
            {unreachable ? 'Mock not reachable.' : `Scenario: ${active ?? 'unknown'}`}
          </Text>
        </View>
        <Text style={{ fontSize: 22, lineHeight: 24, color: colors.faint, transform: [{ rotate: open ? '-90deg' : '90deg' }] }}>›</Text>
      </Pressable>

      {open && (
        <View style={{ gap: 4 }}>
          {scenarios.map(mode => {
            const on = active === mode;
            return (
              <Pressable
                key={mode}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`Scenario: ${mode}`}
                onPress={() => choose(mode)}
                android_ripple={{ color: 'rgba(0,0,0,0.06)' }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  padding: 12,
                  borderRadius: 14,
                  borderWidth: 1.5,
                  borderColor: on ? colors.accent : colors.line,
                  backgroundColor: on ? colors.accentSoft : pressed ? colors.bg : colors.card,
                })}
              >
                <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: on ? colors.accent : colors.faint, alignItems: 'center', justifyContent: 'center' }}>
                  {on && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent }} />}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.body, { fontWeight: '600' }]}>{mode}</Text>
                  <Text style={[styles.bodyMuted, { fontSize: 13, lineHeight: 18 }]}>{scenarioHint[mode]}</Text>
                </View>
                {on && <Pill label="On" tone="ok" />}
              </Pressable>
            );
          })}

          <View style={{ marginTop: 8 }}>
            <Button label="Reset mock" kind="tinted" onPress={reset} />
          </View>
          <Text style={[styles.bodyMuted, { fontSize: 13, lineHeight: 18 }]}>Reset clears the mock’s jobs and counters and this log.</Text>
          {failure && <Text style={[styles.mono, { color: colors.errorText }]}>{failure}</Text>}
        </View>
      )}
    </Card>
  );
}
