import { useSelector } from 'react-redux';
import { Link as RouterLink } from 'react-router-dom';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, Divider, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { COURTS, COURT_MAP, type CourtId } from '../../shared/config.js';
import { decisionReason, formatRank, standingFor } from '../../shared/scoring.js';
import { ActionButton, entryTime, PHASE_LABELS, ScoreCard, ScoreDetails, ScoreEditor, Timer } from './components.js';
import type { RootState } from './store.js';
import { MatchPlanning } from './MatchPlanning.js';
import { DecisionPanel } from './DecisionPanel.js';
import { ResultCsvButton } from './ResultCsvButton.js';

export function AdminPage() {
  const match = useSelector((s: RootState) => s.match);
  return <Stack spacing={3}>
    <PageHeading eyebrow="MATCH CONTROL" title="試合管理" description="4人をひとつのタイマーで進行します。" />
    <Paper className="panel"><Stack spacing={2}>
      <Stack direction="row" alignItems="center" justifyContent="space-between"><Typography variant="h6">{match.name || '試合を登録してください'}</Typography><Chip label={PHASE_LABELS[match.phase]} /></Stack>
      <Timer />
      <Box className="button-grid">
        <ActionButton command={{ type: 'begin', matchId: match.id }} disabled={match.phase !== 'preparing' || !match.name}>3・2・1で競技開始</ActionButton>
        <ActionButton variant="outlined" color="warning" command={{ type: match.pausedAt === null ? 'pause' : 'resume', matchId: match.id }} disabled={!['running', 'countdown'].includes(match.phase)}>{match.pausedAt === null ? '緊急一時停止' : '競技を再開'}</ActionButton>
        <ActionButton variant="outlined" command={{ type: 'finish', matchId: match.id }} disabled={match.phase !== 'running'}>競技を終了して採点へ</ActionButton>
        <ActionButton variant="outlined" command={{ type: 'save', matchId: match.id }}>保存を再試行</ActionButton>
      </Box>
      <Typography variant="caption" color="text.secondary">通常のリトライでは一時停止しません。5分で自動的に採点確認へ進みます。</Typography>
      <Button component={RouterLink} to="/referee">主審の採点・結果確定へ →</Button>
    </Stack></Paper>
    <MatchPlanning />
  </Stack>;
}

export function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <Box className="page-heading"><Typography className="eyebrow">{eyebrow}</Typography><Typography component="h1" variant="h4" fontWeight={800}>{title}</Typography><Typography color="text.secondary" sx={{ mt: 1 }}>{description}</Typography></Box>;
}

export function ScorePage({ courtId }: { courtId: CourtId }) {
  const { match, standings } = useSelector((s: RootState) => s);
  const court = COURT_MAP[courtId];
  const standing = standingFor(standings, courtId);
  return <Stack spacing={3}>
    <PageHeading eyebrow={`COURT ${court.number} · ${court.label}`} title={`${court.number} ${court.label}コートの得点入力`} description="入力は全端末に同期されます。終了後に最終状態を確認してください。" />
    {!['running', 'review'].includes(match.phase) && <Alert severity="info">{match.phase === 'confirmed' ? '結果は確定済みです。訂正は主審画面で確定解除してください。' : '競技開始後に入力できます。'}</Alert>}
    {standing.disqualified && <Alert severity="warning">失格として記録されています。得点・順位の対象外です。</Alert>}
    <Box className="input-layout"><Paper className="panel"><ScoreEditor key={match.id} courtId={courtId} /></Paper>
      <Stack spacing={2} className="input-summary"><Timer /><ScoreCard courtId={courtId} match={match} standing={standing} compact /><Paper className="panel"><ScoreDetails standing={standing} /></Paper></Stack>
    </Box>
  </Stack>;
}

export function RefereePage() {
  const { match, standings, resultRecords } = useSelector((s: RootState) => s);
  const currentResult = resultRecords.find(result => result.match.id === match.id);
  const editable = ['running', 'review'].includes(match.phase);
  const move = (list: CourtId[], index: number, delta: number) => { const next = [...list]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; return next; };
  const nameOf = (id: CourtId) => `${COURT_MAP[id].number} ${match.fields[id].participant.name || '未登録'}`;
  return <Stack spacing={3}>
    <PageHeading eyebrow="REFEREE" title="主審入力" description="内訳と到達順を確認し、4人分の結果を確定します。" />
    <Paper className="panel"><Typography variant="h6">{match.name || '試合未登録'}</Typography><Timer />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <ActionButton command={{ type: 'confirm', matchId: match.id }} disabled={match.phase !== 'review'}>試合結果を確定</ActionButton>
        <ActionButton variant="outlined" command={{ type: 'reopen', matchId: match.id }} disabled={match.phase !== 'confirmed'}>確定解除して訂正</ActionButton>
        {match.phase === 'confirmed' && currentResult && <ResultCsvButton result={currentResult} />}
      </Stack>
    </Paper>
    <Box className="courts-grid">{COURTS.map(c => <Stack key={c.id} spacing={1}>
      <ScoreCard courtId={c.id} match={match} standing={standingFor(standings, c.id)} compact />
      <Paper className="panel"><ScoreDetails standing={standingFor(standings, c.id)} />
        <Stack spacing={1} sx={{ mt: 2 }}>
          <Typography variant="body2">到達時刻：{match.fields[c.id].entry ? entryTime(match.fields[c.id].entry?.elapsedMs ?? 0) : '未到達'}{match.fields[c.id].entry?.corrected ? '（訂正・補記あり）' : ''}</Typography>
          <ActionButton variant="outlined" disabled={!editable || !match.fields[c.id].entry} command={{ type: 'cancelEntry', matchId: match.id, courtId: c.id }}>到達の誤入力を取り消す</ActionButton>
          <ActionButton variant="outlined" disabled={!editable} color={match.fields[c.id].disqualified ? 'success' : 'error'} command={{ type: 'disqualify', matchId: match.id, courtId: c.id, value: !match.fields[c.id].disqualified }}>{match.fields[c.id].disqualified ? '失格を取り消す' : '失格にする'}</ActionButton>
        </Stack>
      </Paper>
      <Accordion><AccordionSummary expandIcon={<span>＋</span>}>得点を訂正する</AccordionSummary><AccordionDetails><ScoreEditor key={match.id} courtId={c.id} /></AccordionDetails></Accordion>
    </Stack>)}</Box>
    <Paper className="panel"><Typography variant="h6" sx={{ mb: 1 }}>うちゅうエリアへの到達順</Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>サーバの受付順で記録しています。実際の順番と異なる場合は上下に移動してください。</Typography>
      <Stack spacing={1}>{match.entryOrder.length === 0 && <Typography>到達者はいません。</Typography>}{match.entryOrder.map((id, index) => <Stack key={id} direction="row" alignItems="center" spacing={1}>
        <Typography sx={{ flex: 1 }}>{index + 1}番目：{nameOf(id)}</Typography>
        <ActionButton variant="outlined" disabled={!editable || index === 0} command={{ type: 'entryOrder', matchId: match.id, order: index > 0 ? move(match.entryOrder, index, -1) : match.entryOrder }}>↑</ActionButton>
        <ActionButton variant="outlined" disabled={!editable || index === match.entryOrder.length - 1} command={{ type: 'entryOrder', matchId: match.id, order: index < match.entryOrder.length - 1 ? move(match.entryOrder, index, 1) : match.entryOrder }}>↓</ActionButton>
      </Stack>)}</Stack>
    </Paper>
    <DecisionPanel />
  </Stack>;
}

export function HomePage() {
  const { match, standings, resultRecords } = useSelector((s: RootState) => s);
  return <Stack spacing={3}>
    <PageHeading eyebrow="D2 ROBOCON · 2026" title="うちゅうのミッションに挑戦！" description="5分間、最高800点。4人の挑戦をリアルタイムに。" />
    <Paper className="panel"><Stack direction="row" alignItems="center" justifyContent="space-between"><Typography variant="h6">{match.name || '試合開始準備'}</Typography><Chip label={match.phase === 'confirmed' ? '確定結果' : '暫定結果'} color={match.phase === 'confirmed' ? 'success' : 'default'} /></Stack><Timer /></Paper>
    <Box className="courts-grid">{COURTS.map(c => <Box key={c.id}><ScoreCard courtId={c.id} match={match} standing={standingFor(standings, c.id)} compact /><Button fullWidth component={RouterLink} to={`/score/${c.id}`} sx={{ mt: 1 }}>このコートの得点を入力 →</Button></Box>)}</Box>
    <Divider />
    <Box><Typography component="h2" variant="h5" fontWeight={800}>試合履歴</Typography><Typography color="text.secondary" sx={{ mt: 1 }}>主審が確定した結果を記録しています。</Typography></Box>
    {resultRecords.length === 0 && <Paper className="panel"><Typography color="text.secondary">確定済みの試合はまだありません。</Typography></Paper>}
    {[...resultRecords].reverse().map(result => <Paper component="article" aria-label={`試合結果 ${result.match.name}`} key={result.match.id} className="panel">
      <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap"><Typography variant="h6">{result.match.name}</Typography><Chip size="small" label={`確定 第${result.revision}版`} />{result.match.id === match.id && match.phase === 'review' && <Chip size="small" color="warning" label="再採点中・前回確定分" />}<ResultCsvButton result={result} /></Stack>
      <Typography variant="caption" color="text.secondary">{new Date(result.confirmedAt).toLocaleString('ja-JP')}</Typography>
      <Box sx={{ overflowX: 'auto' }}><Table size="small"><TableHead><TableRow><TableCell>順位</TableCell><TableCell>参加者 / ロボット</TableCell><TableCell align="right">得点</TableCell><TableCell>到達順 / 時刻</TableCell></TableRow></TableHead><TableBody>
        {[...result.standings].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).map(s => { const f = result.match.fields[s.courtId]; return <TableRow key={s.courtId}><TableCell>{formatRank(s)}</TableCell><TableCell>{f.participant.name}<Typography variant="caption" display="block" color="text.secondary">{f.participant.robot}</Typography></TableCell><TableCell align="right">{s.disqualified ? '—' : s.score.total}</TableCell><TableCell>{f.entry ? `${result.match.entryOrder.indexOf(s.courtId) + 1}番目 / ${entryTime(f.entry.elapsedMs)}` : '未到達'}</TableCell></TableRow>; })}
      </TableBody></Table></Box>
      <Alert severity="info" sx={{ mt: 2 }}>判定理由：{result.decisionReason ?? decisionReason(result.match)}</Alert>
    </Paper>)}
  </Stack>;
}
