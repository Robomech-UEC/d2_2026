import { useState } from 'react';
import { useSelector } from 'react-redux';
import { Alert, Box, Button, Chip, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { COURTS, type CourtId } from '../../shared/config.js';
import type { Command, MatchPlanInput, Participant } from '../../shared/model.js';
import { CSV_HEADERS, CSV_MAX_BYTES, decodeMatchCsv, parseMatchCsv } from '../../shared/matchCsv.js';
import { ActionButton } from './components.js';
import { useConnection } from './connection.js';
import type { RootState } from './store.js';

const emptyParticipants = () => Object.fromEntries(COURTS.map(c => [c.id, { name: '', robot: '' }])) as Record<CourtId, Participant>;

export function MatchPlanning() {
  const { match, resultRecords, matchPlans = [] } = useSelector((s: RootState) => s);
  const { connected, send } = useConnection();
  const [name, setName] = useState('');
  const [participants, setParticipants] = useState(emptyParticipants);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<MatchPlanInput[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const canPrepare = match.phase === 'preparing' || match.phase === 'confirmed';
  const pending = matchPlans.filter(p => p.matchId === null);
  const valid = !!name.trim() && COURTS.every(c => !!participants[c.id].name.trim());
  function resetForm() { setName(''); setParticipants(emptyParticipants()); setEditingId(null); }
  function submit(command: Command, success: () => void) {
    setError(''); setMessage(''); setBusy(true);
    void send(command).then(success).catch((e: Error) => setError(e.message)).finally(() => setBusy(false));
  }
  return <>
    <Paper className="panel"><Stack spacing={2}>
      <Typography variant="h6">CSVで試合を一括登録</Typography>
      <Typography color="text.secondary">1行に1試合。試合名と4人の参加者名を入力し、ロボット名は空欄でも使えます。読み込んだ順に予定の末尾へ追加します。</Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Button variant="outlined" component="a" href="/matches-template.csv" download="d2-2026-matches.csv">CSVひな形をダウンロード</Button>
        <Button variant="contained" component="label" disabled={!connected || busy}>CSVを選択<input hidden type="file" accept=".csv,text/csv" onChange={event => {
          const file = event.target.files?.[0]; event.target.value = '';
          if (!file) return;
          setError(''); setMessage(''); setPreview(null); setFileName(file.name);
          if (file.size > CSV_MAX_BYTES) { setError('CSVは1MB以内にしてください。'); return; }
          setBusy(true);
          void file.arrayBuffer().then(bytes => setPreview(parseMatchCsv(decodeMatchCsv(new Uint8Array(bytes))))).catch((e: Error) => setError(e.message)).finally(() => setBusy(false));
        }} /></Button>
      </Stack>
      <Typography variant="caption" color="text.secondary">UTF-8・Shift_JIS対応。1回200試合まで。簡易形式「試合名,紫,赤,黄,緑」でも読み込めます。</Typography>
      {preview && <>
        <Typography fontWeight={700}>{fileName}：{preview.length}試合を確認してください</Typography>
        <Box className="csv-preview"><Table size="small" aria-label="CSV読み込み内容"><TableHead><TableRow><TableCell>試合名</TableCell>{COURTS.map(c => <TableCell key={c.id}>{c.label}</TableCell>)}</TableRow></TableHead><TableBody>{preview.map((p, i) => <TableRow key={i}><TableCell>{p.name}</TableCell>{COURTS.map(c => <TableCell key={c.id}>{p.participants[c.id].name}<Typography variant="caption" display="block" color="text.secondary">{p.participants[c.id].robot}</Typography></TableCell>)}</TableRow>)}</TableBody></Table></Box>
        <Button variant="contained" disabled={!connected || busy} onClick={() => submit({ type: 'addPlans', matchId: match.id, plans: preview }, () => { setMessage(`${preview.length}試合を予定に追加しました。`); setPreview(null); })}>この{preview.length}試合を予定に追加</Button>
        <Button disabled={busy} onClick={() => setPreview(null)}>読み込みを取り消す</Button>
      </>}
    </Stack></Paper>
    {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
    {message && <Alert severity="success" onClose={() => setMessage('')}>{message}</Alert>}
    <Paper className="panel"><Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2}>
        <Box><Typography variant="h6">試合予定（未開始 {pending.length}件）</Typography><Typography variant="body2" color="text.secondary">試合終了・結果確定後は「次の試合を準備」を押すだけです。</Typography></Box>
        <ActionButton disabled={!canPrepare || pending.length === 0} command={{ type: 'prepareNext', matchId: match.id }}>次の試合を準備</ActionButton>
      </Stack>
      {!canPrepare && <Alert severity="info">競技中も先の試合を登録・編集できます。次の試合への切り替えは、現在の結果を確定した後に行えます。</Alert>}
      {matchPlans.length === 0 && <Typography color="text.secondary">予定はまだありません。CSVまたは下のフォームから事前登録してください。</Typography>}
      {matchPlans.map(plan => {
        const current = plan.matchId === match.id;
        const completed = plan.matchId !== null && (resultRecords.some(r => r.match.id === plan.matchId) || !current);
        const editable = plan.matchId === null || current && match.phase === 'preparing';
        const index = pending.findIndex(p => p.id === plan.id);
        return <Paper component="article" key={plan.id} variant="outlined" className="planned-match" aria-label={`試合予定 ${plan.name}`}>
          <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap"><Typography fontWeight={800}>{plan.name}</Typography><Chip size="small" color={current && !completed ? 'primary' : completed ? 'success' : 'default'} label={completed ? '終了' : current ? '現在の試合' : '未開始'} /></Stack>
          <Box className="planned-participants">{COURTS.map(c => <Typography key={c.id} variant="body2"><span style={{ color: c.color, fontWeight: 800 }}>{c.number} {c.label}：</span>{plan.participants[c.id].name}{plan.participants[c.id].robot ? ` / ${plan.participants[c.id].robot}` : ''}</Typography>)}</Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <ActionButton variant="outlined" disabled={!canPrepare || plan.matchId !== null} command={{ type: 'preparePlan', matchId: match.id, planId: plan.id }}>この試合を準備</ActionButton>
            <Button disabled={!connected || !editable || busy} onClick={() => { setName(plan.name); setParticipants(structuredClone(plan.participants)); setEditingId(plan.id); setError(''); setMessage(''); document.getElementById('match-plan-form')?.scrollIntoView({ behavior: 'smooth' }); }}>編集</Button>
            <ActionButton variant="text" disabled={index <= 0} command={{ type: 'movePlan', matchId: match.id, planId: plan.id, direction: 'up' }}>前へ</ActionButton>
            <ActionButton variant="text" disabled={index < 0 || index === pending.length - 1} command={{ type: 'movePlan', matchId: match.id, planId: plan.id, direction: 'down' }}>後へ</ActionButton>
            <ActionButton variant="text" color="error" disabled={plan.matchId !== null} command={{ type: 'removePlan', matchId: match.id, planId: plan.id }}>削除</ActionButton>
          </Stack>
        </Paper>;
      })}
    </Stack></Paper>
    <Paper className="panel" id="match-plan-form"><Typography variant="h6" sx={{ mb: 2 }}>{editingId ? '試合予定を編集' : '試合を事前登録'}</Typography>
      <Box component="form" onSubmit={event => {
        event.preventDefault();
        const plan = { name, participants };
        submit(editingId ? { type: 'updatePlan', matchId: match.id, planId: editingId, plan } : { type: 'addPlans', matchId: match.id, plans: [plan] }, () => { setMessage(editingId ? '試合予定を更新しました。' : '試合を予定に追加しました。'); resetForm(); });
      }}><Stack spacing={2}>
        <TextField label="試合名" required value={name} onChange={e => setName(e.target.value)} disabled={!connected || busy} inputProps={{ maxLength: 100 }} />
        <Box className="registration-grid">{COURTS.map(c => <Box key={c.id} sx={{ borderTop: `4px solid ${c.color}`, pt: 2 }}>
          <Typography fontWeight={800} sx={{ mb: 1 }}>{c.number} {c.label}コート</Typography>
          <Stack spacing={2}><TextField label={`${c.number} 参加者名`} value={participants[c.id].name} required disabled={!connected || busy} inputProps={{ maxLength: 100 }} onChange={e => setParticipants(p => ({ ...p, [c.id]: { ...p[c.id], name: e.target.value } }))} /><TextField label={`${c.number} ロボット名`} value={participants[c.id].robot} disabled={!connected || busy} inputProps={{ maxLength: 100 }} onChange={e => setParticipants(p => ({ ...p, [c.id]: { ...p[c.id], robot: e.target.value } }))} /></Stack>
        </Box>)}</Box>
        <Button type="submit" variant="contained" disabled={!connected || busy || !valid}>{editingId ? '予定を更新' : '予定に追加'}</Button>
        {editingId ? <Button onClick={resetForm}>編集を取り消す</Button> : <ActionButton variant="outlined" disabled={!canPrepare || busy || !valid} command={{ type: 'newMatch', matchId: match.id, name, participants }}>4人を登録・得点を初期化</ActionButton>}
        <Typography variant="caption" color="text.secondary">「予定に追加」は現在の試合を変更しません。CSVの列：{CSV_HEADERS.join(', ')}</Typography>
      </Stack></Box>
    </Paper>
  </>;
}
