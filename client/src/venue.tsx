import { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material';
import { COURTS } from '../../shared/config.js';
import type { RootState } from './store.js';
import { ScoreCard, Timer } from './components.js';
import { useConnection, useNow } from './connection.js';
import { remainingMs, standingFor } from '../../shared/scoring.js';

function SoundControl() {
  const match = useSelector((s: RootState) => s.match);
  const now = useNow();
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState('');
  const audio = useRef<{ short: HTMLAudioElement; long: HTMLAudioElement }>();
  const played = useRef(new Set<string>());
  const previous = useRef({ id: match.id, phase: match.phase, remaining: remainingMs(match, now) });
  useEffect(() => {
    const current = remainingMs(match, now);
    const old = previous.current;
    previous.current = { id: match.id, phase: match.phase, remaining: current };
    if (!enabled || !audio.current || match.pausedAt !== null) return;
    let event = '';
    let long = false;
    if (match.phase === 'countdown' && current > 0) event = `countdown-${Math.ceil(current / 1000)}`;
    if (match.phase === 'running') {
      if (old.id === match.id && old.phase === 'countdown') { event = 'start'; long = true; }
      for (const threshold of [60_000, 30_000, 5_000, 4_000, 3_000, 2_000, 1_000]) {
        if (old.id === match.id && old.phase === 'running' && old.remaining > threshold && current <= threshold) { event = `remaining-${threshold}`; long = threshold > 5_000; }
      }
    }
    if (match.phase === 'review' && old.id === match.id && old.phase === 'running') { event = 'finish'; long = true; }
    const key = `${match.id}:${event}`;
    if (event && !played.current.has(key)) {
      played.current.add(key);
      const target = long ? audio.current.long : audio.current.short;
      target.currentTime = 0;
      void target.play().catch(() => { setError('音声を再生できません。「音声ON」を押し直してください。'); setEnabled(false); });
    }
  }, [match, now, enabled]);
  return <Box className="sound-control"><Button variant="outlined" size="small" onClick={() => {
    if (enabled) { setEnabled(false); return; }
    audio.current ??= { short: new Audio('/tone_440hz_500ms.mp3'), long: new Audio('/tone_880hz_1000ms.mp3') };
    setError(''); void audio.current.short.play().then(() => setEnabled(true)).catch(() => setError('ブラウザの音声設定を確認してください。'));
  }}>{enabled ? '音声ON（この画面）' : '音声を有効にする'}</Button>{error && <Alert severity="warning">{error}</Alert>}</Box>;
}

export function VenuePage({ overlay = false }: { overlay?: boolean }) {
  const { match, standings, saveError } = useSelector((s: RootState) => s);
  const { connected } = useConnection();
  return <Box className={overlay ? 'overlay-canvas' : 'venue-canvas'}>
    <Stack className="venue-header" direction="row" alignItems="center" justifyContent="space-between" gap={2}>
      <Box><Typography className="eyebrow">D2 ROBOCON 2026</Typography><Typography className="venue-match-name" fontWeight={800}>{match.name || 'うちゅうのミッションに挑戦！'}</Typography></Box>
      <Chip label={match.phase === 'confirmed' ? '確定結果' : '暫定得点'} color={match.phase === 'confirmed' ? 'success' : 'default'} />
    </Stack>
    <Timer large />
    <Box className="venue-grid">{COURTS.map(c => <ScoreCard key={c.id} courtId={c.id} match={match} standing={standingFor(standings, c.id)} />)}</Box>
    {!overlay && <SoundControl />}
    <Box className="venue-alerts">{!connected && <Alert severity="error">サーバに再接続中です。表示は最後に取得した状態です。</Alert>}{saveError && <Alert severity="error">自動保存に失敗しています。試合管理画面を確認してください。</Alert>}</Box>
  </Box>;
}
