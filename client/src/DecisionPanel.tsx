import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { Alert, Button, FormControlLabel, Paper, Stack, Switch, TextField, Typography } from '@mui/material';
import { COURT_MAP, type CourtId } from '../../shared/config.js';
import { AUTO_DECISION_REASON, automaticOrder, rankMatch } from '../../shared/scoring.js';
import { ActionButton } from './components.js';
import type { RootState } from './store.js';

export function DecisionPanel() {
  const match = useSelector((s: RootState) => s.match);
  const baseline = automaticOrder(match);
  const baselineKey = baseline.join(',');
  const savedOrderKey = match.ruling?.order.join(',') ?? '';
  const savedReason = match.ruling?.reason ?? '';
  const [order, setOrder] = useState<CourtId[]>([]);
  const [reason, setReason] = useState('');
  const [editing, setEditing] = useState(false);
  useEffect(() => { setOrder((savedOrderKey || baselineKey).split(',').filter(Boolean) as CourtId[]); setReason(savedReason); setEditing(!!savedOrderKey); }, [match.id, baselineKey, savedOrderKey, savedReason]);
  const automatic = rankMatch({ ...match, ruling: null });
  const hasTies = automatic.some(s => s.tied);
  const changed = order.length === baseline.length && order.some((id, i) => id !== baseline[i]);
  const needsReason = changed;
  const nameOf = (id: CourtId) => `${COURT_MAP[id].number} ${match.fields[id].participant.name || '未登録'}`;
  function canMove(index: number, delta: number) {
    const a = automatic.find(s => s.courtId === order[index]);
    const b = automatic.find(s => s.courtId === order[index + delta]);
    return a?.tied && b?.tied && a.rank === b.rank;
  }
  function move(index: number, delta: number) { const next = [...order]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; setOrder(next); }
  return <Paper className="panel"><Stack spacing={2}>
    <Typography variant="h6">判定理由</Typography>
    <Alert severity={match.ruling ? 'success' : 'info'}>{match.ruling ? `主審判定：${match.ruling.reason}` : AUTO_DECISION_REASON}</Alert>
    <Typography color="text.secondary">自動判定のまま確定する場合は、理由の入力は不要です。判定を変更する場合だけ記録してください。</Typography>
    {hasTies && !match.ruling && <Alert severity="info">同点でうちゅうエリアに未到達の場合は、同順位のまま確定できます。</Alert>}
    <FormControlLabel control={<Switch checked={editing} disabled={match.phase !== 'review' || !hasTies} onChange={e => setEditing(e.target.checked)} />} label="同点時の主審判定を入力する" />
    {editing && <Stack spacing={1}>
      <Typography variant="body2" color="text.secondary">必要な場合だけ、同順位の参加者の並びを変更できます。変更すると理由が必要です。</Typography>
      {order.map((id, index) => <Stack key={id} direction="row" spacing={1} alignItems="center"><Typography sx={{ flex: 1 }}>{index + 1}. {nameOf(id)}</Typography><Button variant="outlined" aria-label={`${nameOf(id)}を上へ`} disabled={match.phase !== 'review' || !canMove(index, -1)} onClick={() => move(index, -1)}>↑</Button><Button variant="outlined" aria-label={`${nameOf(id)}を下へ`} disabled={match.phase !== 'review' || !canMove(index, 1)} onClick={() => move(index, 1)}>↓</Button></Stack>)}
      {needsReason ? <TextField label="変更・主審判定の理由（3文字以上）" required multiline minRows={2} value={reason} disabled={match.phase !== 'review'} onChange={e => setReason(e.target.value)} inputProps={{ maxLength: 1000 }} /> : <Typography variant="body2">自動判定から変更がないため、理由の入力は不要です。</Typography>}
      <ActionButton disabled={match.phase !== 'review' || needsReason && reason.trim().length < 3} command={{ type: 'ruling', matchId: match.id, order, reason: needsReason ? reason : '' }}>主審判定を反映</ActionButton>
    </Stack>}
    {match.ruling && <ActionButton variant="outlined" disabled={match.phase !== 'review'} command={{ type: 'clearRuling', matchId: match.id }} onSuccess={() => setEditing(false)}>自動判定に戻す</ActionButton>}
    <Typography variant="caption" color="text.secondary">得点・到達順・失格を変更すると、主審判定は解除されます。</Typography>
  </Stack></Paper>;
}
