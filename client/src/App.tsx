import { useSelector } from 'react-redux';
import { Link as RouterLink, Navigate, NavLink, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material';
import { COURTS, type CourtId } from '../../shared/config.js';
import type { RootState } from './store.js';
import { useConnection } from './connection.js';
import { AdminPage, HomePage, RefereePage, ScorePage } from './pages.js';
import { VenuePage } from './venue.js';

function CourtRoute() {
  const { courtId } = useParams();
  return COURTS.some(c => c.id === courtId) ? <ScorePage key={courtId} courtId={courtId as CourtId} /> : <Navigate to="/" replace />;
}
export default function App() {
  const location = useLocation();
  const { connected, error, dismissError } = useConnection();
  const { saveError } = useSelector((s: RootState) => s);
  if (location.pathname === '/screen') return <VenuePage />;
  if (location.pathname === '/streaming-overlay') return <VenuePage overlay />;
  return <Box className="app-shell">
    <Box component="aside" className="sidebar">
      <RouterLink to="/" className="brand"><span className="brand-mark">D2</span><span>ROBOCON<strong>2026</strong></span></RouterLink>
      <Typography className="nav-caption">大会運営</Typography>
      <Box component="nav" className="nav-list">
        <NavLink to="/" end>得点・試合履歴</NavLink><NavLink to="/admin">試合管理</NavLink><NavLink to="/referee">主審入力</NavLink>
        {COURTS.map(c => <NavLink key={c.id} to={`/score/${c.id}`}><span className="court-dot" style={{ background: c.color }} />{c.number} {c.label}コート入力</NavLink>)}
      </Box>
      <Typography className="nav-caption">会場・配信</Typography>
      <Box className="nav-list display-links"><a href="/screen" target="_blank" rel="noreferrer">会場スクリーン ↗</a><a href="/streaming-overlay" target="_blank" rel="noreferrer">配信オーバーレイ ↗</a></Box>
      <Box className="sidebar-footer"><Chip size="small" color={connected ? 'success' : 'warning'} label={connected ? 'サーバ接続中' : '再接続中'} /><Typography variant="caption" display="block" sx={{ mt: 1 }}>ルール Ver.3 · 5分 / 800点</Typography></Box>
    </Box>
    <Box component="main" className="main-content">
      <Stack spacing={2} className="global-alerts">
        {!connected && <Alert severity="warning">サーバに接続中です。再接続が完了するまで入力できません。</Alert>}
        {saveError && <Alert severity="error" action={<Button component={RouterLink} to="/admin" color="inherit">保存の再試行へ</Button>}>{saveError}</Alert>}
        {error && <Alert severity="error" onClose={dismissError}>{error}</Alert>}
      </Stack>
      <Routes><Route path="/" element={<HomePage />} /><Route path="/admin" element={<AdminPage />} /><Route path="/referee" element={<RefereePage />} /><Route path="/score/:courtId" element={<CourtRoute />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes>
      <Typography component="footer" className="page-footer">電気通信大学 ロボメカ工房 · D2ロボコン2026</Typography>
    </Box>
  </Box>;
}
