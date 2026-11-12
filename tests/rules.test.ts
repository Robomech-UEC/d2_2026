import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOXES, COURTS, type CourtId } from '../shared/config.js';
import { emptyMatch, initialState, type Command, type State, type Participant } from '../shared/model.js';
import { calculateScore, rankMatch, remainingMs } from '../shared/scoring.js';
import { commandSchema, stateSchema } from '../shared/validation.js';
import { advanceClock, applyCommand } from '../server/src/engine.js';

const participants = Object.fromEntries(COURTS.map(c => [c.id, { name: `参加者${c.number}`, robot: `ロボ${c.number}` }])) as Record<CourtId, Participant>;
function prepared() { return applyCommand(initialState(), { type: 'newMatch', matchId: 'initial', name: '第1試合', participants }, 1000); }
function running() { const s = prepared(); const next = applyCommand(s, { type: 'begin', matchId: s.match.id }, 1000); advanceClock(next, 4000); return next; }
const command = (s: State, cmd: Omit<Command, 'matchId'> | object, now = 5000) => applyCommand(s, { ...cmd, matchId: s.match.id }, now);

test('zero, maximum 800, unit prices, and every rocket box', () => {
  const m = emptyMatch(); const f = m.fields.court1;
  assert.equal(calculateScore(f).total, 0);
  f.tasks.start = true; f.entry = { elapsedMs: 1000, recordedAt: 5000, corrected: false };
  f.tasks.debris = 4; f.tasks.samples = 12;
  BOXES.forEach(b => { f.tasks.boxes[b.id].correct = 4; });
  for (let fuel = 0; fuel <= 4; fuel++) {
    f.tasks.fuel = fuel;
    assert.equal(calculateScore(f).unit, 20 + 5 * fuel);
    assert.equal(calculateScore(f).rocket, 12 * (20 + 5 * fuel));
  }
  assert.equal(calculateScore(f).total, 800);
});
test('mixed colors choose the lowest scoring four; adding a wrong ball reduces the score', () => {
  const f = emptyMatch().fields.court1; f.tasks.fuel = 4;
  for (const b of BOXES) {
    f.tasks.boxes[b.id] = { correct: 3, wrong: 1 };
    assert.equal(calculateScore(f).boxes[b.id], 120);
    f.tasks.boxes[b.id].correct = 4;
    assert.equal(calculateScore(f).boxes[b.id], 120);
    f.tasks.boxes[b.id].wrong = 0;
    assert.equal(calculateScore(f).boxes[b.id], 160);
    f.tasks.boxes[b.id].wrong = 1;
    assert.equal(calculateScore(f).boxes[b.id], 120);
    f.tasks.boxes[b.id] = { correct: 50, wrong: 4 };
    assert.equal(calculateScore(f).boxes[b.id], 0);
    f.tasks.boxes[b.id].wrong = 50;
    assert.equal(calculateScore(f).boxes[b.id], 0);
  }
});
test('rank by score and entry order; unentered ties share a rank without waiting for a ruling', () => {
  const m = emptyMatch();
  assert.ok(rankMatch(m).every(s => s.rank === 1 && s.tied && !s.pending));
  for (const id of ['court2', 'court1'] as const) m.fields[id].entry = { elapsedMs: 1000, recordedAt: 1, corrected: false };
  m.entryOrder = ['court2', 'court1'];
  const ranked = rankMatch(m);
  assert.equal(ranked[1].rank, 1); assert.equal(ranked[0].rank, 2); assert.equal(ranked[2].rank, 3); assert.equal(ranked[3].rank, 3); assert.equal(ranked[2].tied, true);
  m.ruling = { order: ['court4', 'court3', 'court1', 'court2'], reason: '主審判定' };
  const ruled = rankMatch(m);
  assert.equal(ruled[1].rank, 1); assert.equal(ruled[3].rank, 3); assert.equal(ruled[2].rank, 4);
  m.fields.court2.disqualified = true;
  assert.equal(rankMatch(m)[1].rank, null); assert.equal(rankMatch(m)[1].disqualified, true);
  assert.equal(rankMatch(m)[0].rank, 1);
});
test('reached participant beats an unentered participant with the same score', () => {
  const m = emptyMatch(); m.fields.court1.entry = { elapsedMs: 10, recordedAt: 10, corrected: false }; m.entryOrder = ['court1'];
  m.fields.court2.tasks.start = true;
  assert.equal(rankMatch(m)[0].rank, 1); assert.equal(rankMatch(m)[1].rank, 2);
});
test('bounds, fractions, negative values, unknown courts, and invalid paths are rejected', () => {
  const s = running();
  for (const [path, value] of [['debris', 5], ['fuel', 5], ['samples', 13], ['debris', -1], ['fuel', 1.5], ['boxes.blue.correct', -1], ['boxes.blue.wrong', .5], ['boxes.blue.wrong', Number.MAX_SAFE_INTEGER + 1]]) {
    assert.throws(() => command(s, { type: 'setCount', courtId: 'court1', path, value, expectedValue: 0 }));
  }
  assert.throws(() => command(s, { type: 'count', courtId: 'court5', path: 'debris', delta: 1 }));
  assert.throws(() => command(s, { type: 'count', courtId: 'court1', path: '__proto__.x', delta: 1 }));
  assert.throws(() => command(s, { type: 'count', courtId: 'court1', path: 'debris', delta: -1 }));
  assert.ok(!commandSchema.safeParse({ type: 'entryOrder', matchId: s.match.id, order: ['court1', 'court1'] }).success);
  assert.equal(s.match.fields.court1.tasks.debris, 0);
});
test('entry is idempotent; correction and cancellation update score and ranking', () => {
  let s = running();
  s = command(s, { type: 'entry', courtId: 'court1' });
  s = command(s, { type: 'entry', courtId: 'court1' }, 6000);
  s = command(s, { type: 'entry', courtId: 'court2' }, 7000);
  assert.deepEqual(s.match.entryOrder, ['court1', 'court2']);
  assert.equal(s.match.fields.court1.entry?.elapsedMs, 1000);
  assert.equal(calculateScore(s.match.fields.court1).space, 20);
  s = command(s, { type: 'entryOrder', order: ['court2', 'court1'] });
  assert.equal(rankMatch(s.match)[1].rank, 1); assert.equal(s.match.fields.court1.entry?.corrected, true);
  s = command(s, { type: 'cancelEntry', courtId: 'court1' });
  assert.equal(calculateScore(s.match.fields.court1).space, 0); assert.deepEqual(s.match.entryOrder, ['court2']);
  assert.throws(() => command(s, { type: 'entryOrder', order: ['court1'] }));
});
test('server clock ends after 5 minutes without any browser; overdue countdown catches up', () => {
  const p = prepared(); const s = command(p, { type: 'begin' }, 1000);
  assert.equal(s.match.phase, 'countdown');
  assert.equal(remainingMs(s.match, 900), 3000, 'display clock just behind the server must not show a fourth countdown second');
  assert.equal(advanceClock(s, 3999), false);
  advanceClock(s, 4000); assert.equal(s.match.phase, 'running');
  assert.equal(remainingMs(s.match, 4000), 300_000);
  assert.equal(remainingMs(s.match, 3990), 300_000, 'display clock lag must not show 5:01');
  advanceClock(s, 303_999); assert.equal(s.match.phase, 'running');
  advanceClock(s, 304_000); assert.equal(s.match.phase, 'review');
  const overdue = command(p, { type: 'begin' }, 1000); advanceClock(overdue, 900_000); assert.equal(overdue.match.phase, 'review');
});
test('emergency pause preserves remaining time and entry elapsed time', () => {
  let s = running(); s = command(s, { type: 'pause' }, 10_000);
  assert.equal(remainingMs(s.match, 99_000), 294_000); assert.equal(advanceClock(s, 900_000), false);
  s = command(s, { type: 'resume' }, 20_000);
  s = command(s, { type: 'entry', courtId: 'court1' }, 21_000);
  assert.equal(s.match.fields.court1.entry?.elapsedMs, 7000);
  advanceClock(s, 313_999); assert.equal(s.match.phase, 'running');
  advanceClock(s, 314_000); assert.equal(s.match.phase, 'review');
});
test('ties can be confirmed directly; confirmation locks editing and reopening replaces the same history entry', () => {
  let s = running(); s = command(s, { type: 'finish' });
  assert.ok(command(s, { type: 'confirm' }).resultRecords[0].standings.every(row => row.rank === 1 && row.tied));
  s = command(s, { type: 'ruling', order: ['court1', 'court2', 'court3', 'court4'], reason: '両者未到達のため主審判定' });
  s = command(s, { type: 'confirm' }); assert.equal(s.resultRecords.length, 1);
  assert.throws(() => command(s, { type: 'count', courtId: 'court1', path: 'debris', delta: 1 }));
  s = command(s, { type: 'reopen' });
  s = command(s, { type: 'count', courtId: 'court1', path: 'debris', delta: 1 }); assert.equal(s.match.ruling, null);
  s = command(s, { type: 'ruling', order: ['court1', 'court2', 'court3', 'court4'], reason: '採点訂正後の主審判定' });
  s = command(s, { type: 'confirm' }); assert.equal(s.resultRecords.length, 1); assert.equal(s.resultRecords[0].revision, 2);
  assert.equal(s.resultRecords[0].standings[0].score.total, 25); assert.equal(stateSchema.safeParse(s).success, true);
});
test('new match rejects old commands; absolute corrections reject stale values', () => {
  let s = running();
  s = command(s, { type: 'count', courtId: 'court1', path: 'fuel', delta: 1 });
  assert.throws(() => command(s, { type: 'setCount', courtId: 'court1', path: 'fuel', expectedValue: 0, value: 3 }), /別の端末/);
  assert.throws(() => applyCommand(s, { type: 'entry', courtId: 'court1', matchId: 'initial' }, 5000), /試合が切り替わって/);
  assert.throws(() => command(s, { type: 'newMatch', name: '次の試合', participants }), /確定して/);
});
