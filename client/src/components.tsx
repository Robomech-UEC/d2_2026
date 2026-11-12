import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSelector } from 'react-redux';
import { Alert, Box, Button, Chip, Paper, Stack, Table, TableBody, TableCell, TableRow, TextField, Typography } from '@mui/material';
import { BOXES, COURT_MAP, RULES, type CourtId } from '../../shared/config.js';
import type { Command, CountPath, Match, Standing } from '../../shared/model.js';
import { formatRank, remainingMs } from '../../shared/scoring.js';
import type { RootState } from './store.js';
import { useConnection, useNow } from './connection.js';

export const PHASE_LABELS = { preparing: '試合開始準備', countdown: 'まもなくスタート', running: '競技中', review: '採点確認', confirmed: '結果確定' };
export const formatTime = (ms: number) => `${Math.floor(Math.ceil(ms / 1000) / 60)}:${String(Math.ceil(ms / 1000) % 60).padStart(2, '0')}`;
export const entryTime = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;

export function ActionButton({ command, children, disabled = false, color = 'primary', variant = 'contained', onSuccess }: {
  command: Command; children: ReactNode; disabled?: boolean; color?: 'primary' | 'error' | 'success' | 'warning'; variant?: 'outlined' | 'contained' | 'text'; onSuccess?: () => void;
}) {
  const { connected, send } = useConnection();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <Box><Button fullWidth variant={variant} color={color} disabled={!connected || disabled || busy} onClick={() => {
    setBusy(true); setError(null); void send(command).then(onSuccess).catch((e: Error) => setError(e.message)).finally(() => setBusy(false));
  }}>{children}</Button>{error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}</Box>;
}

export function Timer({ large = false }: { large?: boolean }) {
  const match = useSelector((s: RootState) => s.match);
  const now = useNow();
  const remaining = remainingMs(match, now);
  const label = match.phase === 'countdown' ? String(Math.max(1, Math.ceil(remaining / 1000))) : formatTime(remaining);
  return <Box className={`timer ${large ? 'timer-large' : ''}`}>
    <Typography component="div" className="phase-label">{PHASE_LABELS[match.phase]}{match.pausedAt !== null ? '・一時停止' : ''}</Typography>
    <Typography component="div" className="clock" sx={{ color: match.phase === 'running' && remaining <= 30_000 ? '#c62828' : 'inherit' }}>{label}</Typography>
  </Box>;
}

export function ScoreCard({ courtId, match, standing, compact = false }: { courtId: CourtId; match: Match; standing: Standing; compact?: boolean }) {
  const court = COURT_MAP[courtId];
  const f = match.fields[courtId];
  return <Paper className={`score-card ${compact ? 'compact' : ''}`} elevation={0} sx={{ borderColor: court.color, bgcolor: court.tint }}>
    <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
      <Chip size="small" label={`${court.number} ${court.label}`} sx={{ bgcolor: court.color, color: '#fff' }} />
      <Typography className="rank" fontWeight={800}>{formatRank(standing)}</Typography>
    </Stack>
    <Typography className="participant-name" title={f.participant.name} fontWeight={800}>{f.participant.name || '参加者未登録'}</Typography>
    <Typography className="robot-name" title={f.participant.robot} color="text.secondary">{f.participant.robot || '—'}</Typography>
    <Box className="score-value">{standing.disqualified ? '—' : standing.score.total}<span> / 800</span></Box>
    <Typography className="entry-label" color="text.secondary">{f.entry ? `うちゅう到達 ${match.entryOrder.indexOf(courtId) + 1}番目` : 'うちゅう未到達'}</Typography>
  </Paper>;
}

export function ScoreDetails({ standing }: { standing: Standing }) {
  const s = standing.score;
  return <Table size="small" aria-label="得点内訳"><TableBody>
    {([['スタート', s.start], ['うちゅう到達', s.space], ['A デブリ', s.debris], ['B 燃料仕分け', s.fuel], ['C サンプル', s.samples], ...BOXES.map(b => [`D ${b.label}の箱`, s.boxes[b.id]] as const)] as const).map(([label, value]) => <TableRow key={label}><TableCell>{label}</TableCell><TableCell align="right">{value}点</TableCell></TableRow>)}
    <TableRow><TableCell>サンプル単価</TableCell><TableCell align="right">{s.unit}点／個</TableCell></TableRow>
    <TableRow><TableCell><strong>合計</strong></TableCell><TableCell align="right"><strong>{s.total}点</strong></TableCell></TableRow>
  </TableBody></Table>;
}

export function Counter({ courtId, path, value, label, max = Number.MAX_SAFE_INTEGER, disabled }: { courtId: CourtId; path: CountPath; value: number; label: string; max?: number; disabled: boolean }) {
  const matchId = useSelector((s: RootState) => s.match.id);
  const { send, connected } = useConnection();
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const expected = useRef(value);
  const [error, setError] = useState('');
  useEffect(() => { if (!editing) setDraft(String(value)); }, [value, editing]);
  const change = (delta: 1 | -1) => { setError(''); void send({ type: 'count', matchId, courtId, path, delta }).catch((e: Error) => setError(e.message)); };
  const commit = () => {
    setError('');
    setEditing(false);
    if (draft === String(expected.current)) { setDraft(String(value)); return; }
    const next = Number(draft);
    if (!/^\d+$/.test(draft) || !Number.isSafeInteger(next) || next > max) { setError(`0〜${max === Number.MAX_SAFE_INTEGER ? '安全な整数の範囲' : max}で入力してください。`); setDraft(String(value)); return; }
    setSaving(true);
    void send({ type: 'setCount', matchId, courtId, path, value: next, expectedValue: expected.current }).catch((e: Error) => { setError(e.message); setDraft(String(value)); }).finally(() => setSaving(false));
  };
  return <Box className="counter"><Typography fontWeight={600}>{label}</Typography>
    <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
      <Button aria-label={`${label}を1減らす`} variant="outlined" disabled={disabled || !connected || saving || value <= 0} onClick={() => change(-1)}>−</Button>
      <TextField size="small" value={draft} disabled={disabled || !connected || saving} inputProps={{ inputMode: 'numeric', 'aria-label': label, style: { textAlign: 'center' } }} onFocus={() => { setEditing(true); expected.current = value; }} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.querySelector('input')?.blur(); }} />
      <Button aria-label={`${label}を1増やす`} variant="contained" disabled={disabled || !connected || saving || value >= max} onClick={() => change(1)}>＋</Button>
    </Stack>{error && <Typography role="alert" color="error" variant="caption">{error}</Typography>}
  </Box>;
}

export function ScoreEditor({ courtId }: { courtId: CourtId }) {
  const match = useSelector((s: RootState) => s.match);
  const { connected } = useConnection();
  const f = match.fields[courtId];
  const disabled = !connected || !['running', 'review'].includes(match.phase);
  return <Box component="fieldset" disabled={disabled} className="editor-fieldset">
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} className="achievement-row">
        <ActionButton disabled={disabled} variant={f.tasks.start ? 'contained' : 'outlined'} command={{ type: 'setStart', matchId: match.id, courtId, value: !f.tasks.start }}>{f.tasks.start ? '✓ スタート達成 20点' : 'スタート達成 ＋20点'}</ActionButton>
        <ActionButton disabled={disabled || f.entry !== null} color="success" variant={f.entry ? 'contained' : 'outlined'} command={{ type: 'entry', matchId: match.id, courtId }}>{f.entry ? `✓ うちゅう到達 ${match.entryOrder.indexOf(courtId) + 1}番目` : 'うちゅう到達 ＋20点'}</ActionButton>
      </Stack>
      <Counter disabled={disabled} courtId={courtId} path="debris" value={f.tasks.debris} label="A デブリをたおした数" max={RULES.debrisMax} />
      <Counter disabled={disabled} courtId={courtId} path="fuel" value={f.tasks.fuel} label="B 正しく仕分けた玉の数" max={RULES.fuelMax} />
      <Counter disabled={disabled} courtId={courtId} path="samples" value={f.tasks.samples} label="C 落としたサンプルの採点対象数" max={RULES.sampleMax} />
      <Typography variant="caption" color="text.secondary">Cは最大12個。持っている玉・箱に運んだ玉・リトライで戻した玉も含みます。</Typography>
      <Typography variant="h6">D ロケットエリア</Typography>
      <Alert severity="info">各箱の玉をすべて数えて入力します。違う色の玉が混ざると得点が下がります。</Alert>
      {BOXES.map(b => <Paper key={b.id} variant="outlined" sx={{ p: 2, borderTop: `4px solid ${b.color}` }}>
        <Typography fontWeight={800} sx={{ mb: 2 }}>{b.label}の箱</Typography>
        <Stack spacing={2}><Counter disabled={disabled} courtId={courtId} path={`boxes.${b.id}.correct`} value={f.tasks.boxes[b.id].correct} label={`${b.label}の箱：正しい色の個数`} /><Counter disabled={disabled} courtId={courtId} path={`boxes.${b.id}.wrong`} value={f.tasks.boxes[b.id].wrong} label={`${b.label}の箱：違う色の個数`} /></Stack>
      </Paper>)}
      <Typography variant="caption" color="text.secondary">リトライ中も時間は進みます。リトライによる減点はありません。</Typography>
    </Stack>
  </Box>;
}
