import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'node:path';
import type { ServerMessage, Snapshot, State } from '../../shared/model.js';
import { rankMatch } from '../../shared/scoring.js';
import { requestSchema } from '../../shared/validation.js';
import { advanceClock, applyCommand } from './engine.js';
import { loadState, saveState } from './persistence.js';

type Options = { saveDirectory: string; clientDirectory: string; now?: () => number; save?: typeof saveState; tickMs?: number };
export async function createScoreboard(options: Options) {
  const now = options.now ?? Date.now;
  const loaded = await loadState(options.saveDirectory);
  let state: State = loaded.state;
  let saveError = loaded.error;
  const persist = options.save ?? saveState;
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2 * 1024 * 1024 });
  const snapshot = (): Snapshot => ({ ...structuredClone(state), standings: rankMatch(state.match), saveError });
  const send = (ws: WebSocket, body: ServerMessage) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(body)); };
  const broadcast = () => { const message: ServerMessage = { type: 'state', time: now(), state: snapshot() }; wss.clients.forEach(ws => send(ws, message)); };
  let queue: Promise<void> = Promise.resolve();
  function enqueue(task: () => Promise<void>) { queue = queue.then(task).catch(error => console.error(error)); return queue; }
  async function saveAndPublish() {
    try { await persist(options.saveDirectory, state); saveError = null; }
    catch (error) { saveError = `自動保存に失敗しました。試合は継続しています。「保存を再試行」で再保存してください。${(error as Error).message}`; }
    broadcast();
  }
  async function tick() { if (advanceClock(state, now())) await saveAndPublish(); }
  const timer = setInterval(() => { void enqueue(tick); }, options.tickMs ?? 100);
  await tick();
  wss.on('connection', ws => {
    send(ws, { type: 'welcome', time: now(), state: snapshot() });
    const seen = new Set<string>();
    ws.on('message', data => {
      void enqueue(async () => {
        let requestId: string | undefined;
        try {
          await tick();
          const body: unknown = JSON.parse(data.toString());
          if (typeof body === 'object' && body !== null && 'type' in body && body.type === 'ping' && 'sentAt' in body && typeof body.sentAt === 'number') {
            send(ws, { type: 'pong', time: now(), sentAt: body.sentAt }); return;
          }
          const parsed = requestSchema.safeParse(body);
          if (!parsed.success) throw new Error(`入力が不正です：${parsed.error.issues[0]?.message ?? '形式を確認してください。'}`);
          requestId = parsed.data.requestId;
          if (seen.has(requestId)) { send(ws, { type: 'ack', requestId }); return; }
          state = applyCommand(state, parsed.data.command, now());
          seen.add(requestId);
          if (seen.size > 1000) seen.delete(seen.values().next().value as string);
          await saveAndPublish();
          send(ws, { type: 'ack', requestId });
        } catch (error) {
          // Preserve request correlation even when command validation fails.
          if (!requestId) { try { const body = JSON.parse(data.toString()) as { requestId?: unknown }; if (typeof body.requestId === 'string') requestId = body.requestId; } catch { /* malformed JSON */ } }
          send(ws, { type: 'error', requestId, message: (error as Error).message });
        }
      });
    });
    ws.on('error', error => console.error('WebSocket:', error.message));
  });
  app.get('/api/state', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(snapshot()); });
  app.get('/api/health', (_req, res) => res.json({ ok: !saveError, ruleVersion: '2026-ver3', revision: state.revision }));
  app.use(express.static(options.clientDirectory));
  app.get('*', (_req, res) => res.sendFile(path.resolve(options.clientDirectory, 'index.html')));
  return {
    app, server, snapshot, tick: () => enqueue(tick),
    async listen(port = 8000, host = '0.0.0.0') {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); resolve(); }); });
      return (server.address() as AddressInfo).port;
    },
    async close() {
      clearInterval(timer); await queue;
      wss.clients.forEach(ws => ws.terminate());
      await new Promise<void>(resolve => wss.close(() => resolve()));
      if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
