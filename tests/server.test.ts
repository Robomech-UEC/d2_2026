import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { COURTS, type CourtId } from '../shared/config.js';
import type { Participant, ServerMessage, Snapshot } from '../shared/model.js';
import { createScoreboard } from '../server/src/app.js';
import { loadState, saveState } from '../server/src/persistence.js';
import { initialState } from '../shared/model.js';

class Client {
  ws: WebSocket;
  messages: ServerMessage[] = [];
  listeners = new Set<() => void>();
  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.ws.on('message', raw => { this.messages.push(JSON.parse(raw.toString()) as ServerMessage); this.listeners.forEach(fn => fn()); });
  }
  async wait(predicate: (m: ServerMessage) => boolean): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.listeners.delete(check); reject(new Error('WebSocket response timeout')); }, 5000);
      const check = () => { const index = this.messages.findIndex(predicate); if (index >= 0) { const [message] = this.messages.splice(index, 1); clearTimeout(timeout); this.listeners.delete(check); resolve(message); } };
      this.listeners.add(check); check();
    });
  }
  async welcome() { const m = await this.wait(m => m.type === 'welcome'); return (m as Extract<ServerMessage, { type: 'welcome' | 'state' }>).state; }
  async command(command: object) {
    const requestId = randomUUID();
    this.ws.send(JSON.stringify({ type: 'command', requestId, command }));
    return this.wait(m => (m.type === 'ack' || m.type === 'error') && m.requestId === requestId);
  }
}
const participants = Object.fromEntries(COURTS.map(c => [c.id, { name: `参加者${c.number}`, robot: '' }])) as Record<CourtId, Participant>;

test('7 devices synchronize concurrent increments, reconnect, stale-match rejection, persistence, and expiry', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'd2-2026-test-'));
  let now = 1000;
  const options = { saveDirectory: directory, clientDirectory: path.resolve('client/dist'), now: () => now, tickMs: 60_000 };
  let board = await createScoreboard(options);
  const clients: Client[] = [];
  try {
    const port = await board.listen(0, '127.0.0.1');
    for (let i = 0; i < 7; i++) clients.push(new Client(port));
    await Promise.all(clients.map(c => c.welcome()));
    const admin = clients[0];
    assert.equal((await admin.command({ type: 'newMatch', matchId: 'initial', name: '同期試験', participants })).type, 'ack');
    const id = board.snapshot().match.id;
    await admin.command({ type: 'begin', matchId: id });
    now = 4000; await board.tick();
    const actions = clients.slice(1, 5).map((client, i) => client.command({ type: 'count', matchId: id, courtId: COURTS[i].id, path: 'debris', delta: 1 }));
    assert.ok((await Promise.all(actions)).every(m => m.type === 'ack'));
    await Promise.all(clients.slice(1, 5).map(client => client.command({ type: 'count', matchId: id, courtId: 'court1', path: 'boxes.blue.correct', delta: 1 })));
    assert.equal(board.snapshot().match.fields.court1.tasks.boxes.blue.correct, 4);
    await Promise.all(clients.slice(1, 5).map((client, i) => client.command({ type: 'entry', matchId: id, courtId: COURTS[i].id })));
    const snapshot = board.snapshot();
    assert.equal(snapshot.match.entryOrder.length, 4);
    for (const client of clients) await client.wait(m => m.type === 'state' && m.state.revision === snapshot.revision);
    const httpState = await fetch(`http://127.0.0.1:${port}/api/state`).then(r => r.json()) as Snapshot;
    assert.deepEqual(httpState.match, snapshot.match);
    const reconnect = new Client(port); clients.push(reconnect);
    assert.equal((await reconnect.welcome()).revision, snapshot.revision);
    const invalid = await admin.command({ type: 'count', matchId: id, courtId: 'court1', path: 'fuel', delta: 1.5 });
    assert.equal(invalid.type, 'error'); assert.equal(board.snapshot().match.fields.court1.tasks.fuel, 0);
    await board.close();
    now = 304_000;
    board = await createScoreboard(options);
    assert.equal(board.snapshot().match.phase, 'review');
    assert.equal(board.snapshot().match.fields.court1.tasks.boxes.blue.correct, 4);
    const port2 = await board.listen(0, '127.0.0.1');
    const judge = new Client(port2); clients.push(judge); await judge.welcome();
    assert.equal((await judge.command({ type: 'confirm', matchId: id })).type, 'ack');
    assert.equal(board.snapshot().resultRecords.length, 1);
    assert.equal((await judge.command({ type: 'newMatch', matchId: id, name: '次の試合', participants })).type, 'ack');
    assert.notEqual(board.snapshot().match.id, id);
    const stale = await judge.command({ type: 'count', matchId: id, courtId: 'court1', path: 'debris', delta: 1 });
    assert.equal(stale.type, 'error'); assert.equal(board.snapshot().match.fields.court1.tasks.debris, 0);
    assert.equal(board.snapshot().resultRecords.length, 1);
  } finally { clients.forEach(c => c.ws.terminate()); await board.close(); await rm(directory, { recursive: true, force: true }); }
});

test('save failures are visible, operations continue, and retry saves the latest state', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'd2-save-failure-'));
  let fail = true;
  const board = await createScoreboard({ saveDirectory: directory, clientDirectory: path.resolve('client/dist'), save: async (dir, state) => { if (fail) throw new Error('試験用の書き込み失敗'); await saveState(dir, state); } });
  let client: Client | undefined;
  try {
    const port = await board.listen(0, '127.0.0.1'); client = new Client(port); await client.welcome();
    const ack = await client.command({ type: 'newMatch', matchId: 'initial', name: '保存試験', participants });
    assert.equal(ack.type, 'ack'); assert.match(board.snapshot().saveError ?? '', /自動保存に失敗/);
    fail = false;
    await client.command({ type: 'save', matchId: board.snapshot().match.id });
    assert.equal(board.snapshot().saveError, null);
    const stored = JSON.parse(await readFile(path.join(directory, 'current.json'), 'utf8')) as Snapshot;
    assert.equal(stored.match.name, '保存試験');
  } finally { client?.ws.terminate(); await board.close(); await rm(directory, { recursive: true, force: true }); }
});

test('first startup is safe, corrupt current data falls back, and corrupt backups never get overwritten', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'd2-backup-'));
  try {
    assert.equal((await loadState(path.join(directory, 'new'))).state.schemaVersion, 2026);
    const state = initialState(); await saveState(directory, state); state.revision++; await saveState(directory, state);
    await writeFile(path.join(directory, 'current.json'), '{invalid');
    const fallback = await loadState(directory); assert.equal(fallback.state.revision, 0); assert.ok(fallback.error);
    await writeFile(path.join(directory, 'previous.json'), '{invalid');
    await assert.rejects(loadState(directory), /保存データ/);
    assert.equal(await readFile(path.join(directory, 'current.json'), 'utf8'), '{invalid');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('large plan imports synchronize to another device and survive restart', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'd2-plans-sync-'));
  const options = { saveDirectory: directory, clientDirectory: path.resolve('client/dist') };
  let board = await createScoreboard(options);
  const clients: Client[] = [];
  try {
    const port = await board.listen(0, '127.0.0.1');
    const admin = new Client(port); const observer = new Client(port); clients.push(admin, observer);
    await Promise.all(clients.map(c => c.welcome()));
    const longParticipants = Object.fromEntries(COURTS.map(c => [c.id, { name: '名'.repeat(100), robot: '機'.repeat(100) }])) as Record<CourtId, Participant>;
    const plans = Array.from({ length: 40 }, (_, i) => ({ name: `予定${i + 1}`, participants: longParticipants }));
    assert.ok(Buffer.byteLength(JSON.stringify(plans)) > 64 * 1024);
    assert.equal((await admin.command({ type: 'addPlans', matchId: 'initial', plans })).type, 'ack');
    await observer.wait(m => m.type === 'state' && m.state.matchPlans.length === 40);
    assert.equal((await admin.command({ type: 'prepareNext', matchId: 'initial' })).type, 'ack');
    const matchId = board.snapshot().match.id;
    assert.equal(board.snapshot().match.name, '予定1');
    await board.close();
    board = await createScoreboard(options);
    assert.equal(board.snapshot().match.id, matchId); assert.equal(board.snapshot().matchPlans.length, 40);
    assert.equal(board.snapshot().matchPlans[0].matchId, matchId);
    const port2 = await board.listen(0, '127.0.0.1');
    const restored = new Client(port2); clients.push(restored);
    assert.equal((await restored.welcome()).matchPlans[39].participants.court4.name, '名'.repeat(100));
  } finally {
    clients.forEach(c => c.ws.terminate()); await board.close();
    const absolute = path.resolve(directory);
    assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()), 'cleanup must stay in the temporary directory');
    assert.match(path.basename(absolute), /^d2-plans-sync-/);
    await rm(absolute, { recursive: true, force: true });
  }
});
