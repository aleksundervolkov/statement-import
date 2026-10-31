import { useState, useSyncExternalStore } from 'react';
import { Alert, AppState, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { controller } from '../controller';
import { formatMinor, monthlyTotalMinor } from '../core/money';
import { prepareFile } from '../core/prepare';
import type { JobView, Phase, RecurringItem } from '../core/types';
import type { Rejection } from '../core/validate';
import { fileIo, pickStatement, releasePicked } from '../native/files';
import { devLog } from '../devLog';
import { Activity, Diagnostics } from './Diagnostics';
import { Badge, Busy, Button, Card, Notice, Outcome, Pill, Row, colors, styles, type Tone, useStacked } from './kit';
import { describeError, formatBytes, rejectionText } from './strings';

const rejectionLog: Record<Rejection, string> = {
  empty: 'empty file',
  too_large: 'larger than 10 MiB',
  unsupported_content: 'not a real PDF or CSV inside',
  unreadable: 'could not read the file',
};

export function ImportScreen() {
  const operation = useSyncExternalStore(controller.subscribe, controller.getState);
  const insets = useSafeAreaInsets();
  const [rejection, setRejection] = useState<Rejection | null>(null);
  const [busy, setBusy] = useState<'opening' | 'picking' | 'checking' | null>(null);
  const [detail, setDetail] = useState<RecurringItem | null>(null);
  const error = describeError(operation.error);

  async function choose() {
    if (busy) return;
    setRejection(null);
    setBusy('opening');
    // There is no event for "picker is on screen": Android leaves the app, iOS gets a timer.
    const settle = () => setBusy(current => (current === 'opening' ? 'picking' : current));
    const timer = setTimeout(settle, 1500);
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') settle();
    });
    let picked: Awaited<ReturnType<typeof pickStatement>>;
    try {
      picked = await pickStatement();
    } catch {
      setBusy(null);
      setRejection('unreadable');
      return;
    } finally {
      clearTimeout(timer);
      subscription.remove();
    }
    if (!picked) {
      setBusy(null);
      return;
    }
    setBusy('checking');
    try {
      const result = await prepareFile(picked, fileIo);
      if (__DEV__) {
        console.log('[import]', 'prepare', 'rejection' in result ? result.rejection : result.file.format, 'file' in result ? result.file.size : picked.size);
      }
      if ('rejection' in result) {
        if (__DEV__) devLog.add(`Checked on device: ${rejectionLog[result.rejection]}`, 'ok', 'Rejected. No request sent.');
        setRejection(result.rejection);
      } else {
        if (__DEV__) devLog.add(`Checked on device: ${result.file.format.toUpperCase()}, ${result.file.size} B`, 'plain', 'Accepted. Waiting for Send.');
        controller.stage(result.file);
      }
    } catch {
      if (__DEV__) console.log('[import]', 'prepare_failed');
      setRejection('unreadable');
    } finally {
      releasePicked(picked);
      setBusy(null);
    }
  }

  function confirmDelete() {
    Alert.alert('Delete this import?', 'The server will be asked to delete the uploaded statement and its report.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => controller.remove() },
    ]);
  }

  function confirmLeave() {
    Alert.alert('Leave this import?', 'The server may still keep this statement. Leaving will not delete it.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => controller.discard() },
    ]);
  }

  const file = operation.file;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 24, gap: 16 }}>
        <View style={{ gap: 4, paddingHorizontal: 4, marginBottom: 4 }}>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.title}>Statements</Text>
          <Text style={styles.subtitle}>Find recurring payments in a bank statement.</Text>
        </View>

        {operation.phase === 'idle' && (
          <Card>
            <Badge text="+" size={48} />
            <View style={{ gap: 4 }}>
              <Text style={styles.heading}>Import a statement</Text>
              <Text style={styles.bodyMuted}>PDF or CSV up to 10 MiB. The file is checked on this device before anything is sent.</Text>
            </View>
            {busy === 'opening' && <Busy label="Opening files…" />}
            {busy === 'checking' && <Busy label="Checking file…" />}
            {(!busy || busy === 'picking') && <Button label="Choose PDF or CSV" disabled={busy === 'picking'} onPress={choose} />}
            {rejection && <Notice tone="error" title="File not accepted">{rejectionText[rejection]} Nothing was sent.</Notice>}
          </Card>
        )}

        {operation.phase === 'uploading' && !file?.name && <Card><Busy label="Sending file to the server…" /></Card>}

        {(operation.phase === 'confirm' || operation.phase === 'uploading') && file?.name && (
          <Card>
            <Text style={styles.heading}>{operation.phase === 'confirm' ? 'Send this file?' : 'Sending'}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Badge text={file.format.toUpperCase()} size={44} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.body, { fontWeight: '600' }]}>{file.name}</Text>
                <Text style={styles.bodyMuted}>{formatBytes(file.size)} · {file.format.toUpperCase()}</Text>
              </View>
            </View>
            {operation.phase === 'confirm' ? (
              <View style={{ gap: 4 }}>
                <Button label="Send" onPress={() => controller.upload()} />
                <Button label="Cancel" kind="plain" onPress={() => controller.cancel()} />
              </View>
            ) : (
              <Busy label="Sending file to the server…" />
            )}
          </Card>
        )}

        {operation.phase === 'unknown' && (
          <Card>
            <Notice tone="warn" title="Upload not confirmed">
              The server may or may not have received the file. {error}
            </Notice>
            <View style={{ gap: 8 }}>
              <Button label="Check again" onPress={() => controller.recover()} />
              <Button label="Send again (same upload)" kind="tinted" onPress={() => controller.retryUpload()} />
              <Button label="Discard" kind="plain" onPress={confirmLeave} />
            </View>
          </Card>
        )}

        {operation.job && ['tracking', 'delete_pending', 'delete_failed'].includes(operation.phase) && (
          <Report job={operation.job} phase={operation.phase} errorCode={operation.error} onDetails={setDetail} onDelete={confirmDelete} onLeave={confirmLeave} />
        )}

        {operation.phase === 'not_on_server' && (
          <Card>
            <Outcome tone="warn" mark="?" title="Server has no record">The server does not know this import. Nothing to delete there.</Outcome>
            <Button label="Start over" onPress={() => controller.discard()} />
          </Card>
        )}

        {operation.phase === 'deleted' && (
          <Card>
            <Outcome tone="ok" mark="✓" title="Deleted on the server">The server confirmed that this import and its report were deleted.</Outcome>
            <Button label="Start a new import" onPress={() => controller.discard()} />
          </Card>
        )}

        {operation.phase === 'failed' && (
          <Card>
            <Outcome tone="error" mark="!" title="Import failed">{error ?? 'Something went wrong.'}</Outcome>
            <Button label="Start over" onPress={() => controller.discard()} />
          </Card>
        )}

        {__DEV__ && (
          <View style={{ gap: 8, marginTop: 8 }}>
            <Text style={styles.sectionLabel}>Developer</Text>
            <Activity />
            <Diagnostics />
          </View>
        )}
      </ScrollView>

      <Modal visible={detail !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDetail(null)}>
        <SafeAreaProvider>
          {detail && operation.job?.currency && (
            <DetailSheet item={detail} currency={operation.job.currency} onClose={() => setDetail(null)} />
          )}
        </SafeAreaProvider>
      </Modal>
    </SafeAreaView>
  );
}

const merchantTints = [
  { tint: '#3D5AFE', soft: '#ECEFFF' },
  { tint: '#D9480F', soft: '#FFF0E6' },
  { tint: '#0B8A6A', soft: '#E3F6F0' },
  { tint: '#8E3FD8', soft: '#F4EAFD' },
  { tint: '#C2185B', soft: '#FDE8F0' },
];

function merchantTint(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return merchantTints[hash % merchantTints.length];
}

function initials(name: string) {
  const capitals = name.match(/[A-Z]/g);
  return (capitals && capitals.length >= 2 ? capitals.slice(0, 2).join('') : name.slice(0, 2)).toUpperCase();
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function statusPill(job: JobView, phase: Phase, errorCode: string | undefined): { label: string; tone: Tone } {
  if (phase === 'delete_pending') return { label: 'Deleting', tone: 'warn' };
  if (phase === 'delete_failed') return { label: UNCONFIRMED_DELETE.includes(errorCode ?? '') ? 'Not confirmed' : 'Not deleted', tone: 'error' };
  if (job.status === 'ready') return { label: 'Ready', tone: 'ok' };
  if (job.status === 'queued') return { label: 'Queued', tone: 'warn' };
  if (job.status === 'processing') return { label: 'Processing', tone: 'warn' };
  return { label: capitalize(job.status), tone: 'neutral' };
}

const UNCONFIRMED_DELETE = ['delete_unconfirmed', 'delete_not_confirmed'];

type ReportProps = {
  job: JobView;
  phase: Phase;
  errorCode: string | undefined;
  onDetails: (item: RecurringItem) => void;
  onDelete: () => void;
  onLeave: () => void;
};

function Report({ job, phase, errorCode, onDetails, onDelete, onLeave }: ReportProps) {
  const ready = job.status === 'ready';
  const error = describeError(errorCode);
  const pill = statusPill(job, phase, errorCode);
  const items = ready && job.items && job.currency ? job.items : null;
  const deleteTitle = UNCONFIRMED_DELETE.includes(errorCode ?? '') ? 'Deletion not confirmed' : 'Not deleted';

  return (
    <>
      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <Text style={styles.bodyMuted}>Recurring payments</Text>
          <Pill label={pill.label} tone={pill.tone} />
        </View>
        {items && (
          <View style={{ gap: 2 }}>
            <Text maxFontSizeMultiplier={1.3} style={styles.hero}>{formatMinor(monthlyTotalMinor(items), job.currency!)}</Text>
            <Text style={styles.bodyMuted}>per month · {items.length} {items.length === 1 ? 'subscription' : 'subscriptions'}</Text>
          </View>
        )}
        {job.status === 'queued' && <Busy label="In the queue. The report is not ready yet." />}
        {job.status === 'processing' && <Busy label="Reading the statement. The report is not ready yet." />}
        {phase === 'delete_pending' && <Busy label="Deletion sent. The server has not confirmed it yet." />}
        {phase === 'delete_failed' && <Notice tone="error" title={deleteTitle}>{error ?? 'The server has not deleted this import.'}</Notice>}
        {phase === 'tracking' && error && <Notice tone="warn" title="Status may be outdated">{error}</Notice>}
      </Card>

      {items && (
        <Card flush>
          {items.map(item => (
            <PaymentRow key={item.id} item={item} currency={job.currency!} onPress={() => onDetails(item)} />
          ))}
        </Card>
      )}

      {ready && phase !== 'delete_pending' && (
        <View style={{ gap: 8 }}>
          {phase === 'tracking' && <Button label="Refresh status" kind="tinted" onPress={() => controller.refresh()} />}
          <Button label={phase === 'delete_failed' ? 'Retry deletion' : 'Delete import'} kind="destructive" onPress={phase === 'delete_failed' ? () => controller.remove() : onDelete} />
          {phase === 'delete_failed' && <Button label="Start over" kind="plain" onPress={onLeave} />}
        </View>
      )}

      <Text style={[styles.caption, { textAlign: 'center' }]}>Job {job.jobId} · revision {job.revision}</Text>
    </>
  );
}

function PaymentRow({ item, currency, onPress }: { item: RecurringItem; currency: string; onPress: () => void }) {
  const stacked = useStacked();
  const { tint, soft } = merchantTint(item.merchant);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Details for ${item.merchant}`}
      onPress={onPress}
      android_ripple={{ color: 'rgba(0,0,0,0.06)' }}
      style={({ pressed }) => [
        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 12, backgroundColor: pressed ? colors.bg : 'transparent' },
      ]}
    >
      <Badge text={initials(item.merchant)} tint={tint} soft={soft} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.body, { fontSize: 16, fontWeight: '600' }]}>{item.merchant}</Text>
        <Text style={[styles.bodyMuted, { fontSize: 13, lineHeight: 18 }]}>{capitalize(item.cadence)}</Text>
        {stacked && <Text style={[styles.body, { fontWeight: '600', fontVariant: ['tabular-nums'] }]}>{formatMinor(item.amountMinor, currency)}</Text>}
        {stacked && <Text style={{ fontSize: 13, fontWeight: '600', color: colors.accent }}>Details</Text>}
      </View>
      {!stacked && (
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Text style={[styles.body, { fontWeight: '600', fontVariant: ['tabular-nums'] }]}>{formatMinor(item.amountMinor, currency)}</Text>
          <Text style={{ fontSize: 13, lineHeight: 18, fontWeight: '600', color: colors.accent }}>Details</Text>
        </View>
      )}
    </Pressable>
  );
}

function DetailSheet({ item, currency, onClose }: { item: RecurringItem; currency: string; onClose: () => void }) {
  const { tint, soft } = merchantTint(item.merchant);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom', 'left', 'right']}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingLeft: 20, paddingRight: 8, paddingTop: 8 }}>
        <Text style={styles.heading}>Details</Text>
        <Button label="Close" kind="plain" onPress={onClose} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 8 }}>
          <Badge text={initials(item.merchant)} size={64} tint={tint} soft={soft} />
          <Text accessibilityRole="header" style={[styles.heading, { fontSize: 20, lineHeight: 25 }]}>{item.merchant}</Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.hero}>{formatMinor(item.amountMinor, currency)}</Text>
          <View><Pill label={capitalize(item.cadence)} tone="neutral" /></View>
        </View>
        <Card>
          <View>
            <Row first label="Repeats" value={capitalize(item.cadence)} />
            <Row label="Last seen" value={item.lastSeen} />
          </View>
        </Card>
        <Text style={[styles.caption, { textAlign: 'center', paddingHorizontal: 16 }]}>Found by the server in your statement. This app does not cancel subscriptions.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
