import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { COURTS, type CourtId } from '../shared/config.js';
import { initialState, type MatchPlanInput, type Participant, type State } from '../shared/model.js';
import { CSV_HEADERS, decodeMatchCsv, parseMatchCsv } from '../shared/matchCsv.js';
import { AUTO_DECISION_REASON, automaticOrder } from '../shared/scoring.js';
import { stateSchema } from '../shared/validation.js';
import { advanceClock, applyCommand } from '../server/src/engine.js';

const participants = Object.fromEntries(COURTS.map(c => [c.id, { name: `参加者${c.number}`, robot: `ロボ${c.number}` }])) as Record<CourtId, Participant>;
const plan = (name: string): MatchPlanInput => ({ name, participants: structuredClone(participants) });
const apply = (s: State, command: object, now = 1000) => applyCommand(s, { ...command, matchId: s.match.id }, now);
function running() {
  let s = apply(initialState(), { type: 'newMatch', ...plan('試合1') });
  s = apply(s, { type: 'begin' }); advanceClock(s, 4000); return s;
}

test('CSV accepts BOM, CRLF, blank lines, optional robots, and short color headers', () => {
  const csv = '\uFEFF試合名,紫,赤,黄,緑\r\n試合1,太郎,花子,ひかり,そら\r\n\r\n試合2,A,B,C,D\r\n';
  const plans = parseMatchCsv(csv);
  assert.equal(plans.length, 2); assert.equal(plans[0].participants.court1.name, '太郎'); assert.equal(plans[0].participants.court4.robot, '');
  assert.equal(decodeMatchCsv(new TextEncoder().encode(csv)), csv.slice(1));
  assert.equal(decodeMatchCsv(Uint8Array.from([0x82, 0xa0])), 'あ');
});
test('CSV handles quoted commas, escaped quotes, newlines, and the downloadable template', async () => {
  const csv = `${CSV_HEADERS.join(',')}\r\n第1試合,"太郎, 一郎","ロボ""A""",B,,C,,D,"2行\r\nロボット"\r\n`;
  const [result] = parseMatchCsv(csv);
  assert.equal(result.participants.court1.name, '太郎, 一郎'); assert.equal(result.participants.court1.robot, 'ロボ"A"');
  assert.equal(result.participants.court4.robot, '2行\nロボット');
  const template = await readFile('client/public/matches-template.csv', 'utf8');
  assert.equal(parseMatchCsv(template).length, 2);
});
test('CSV rejects invalid rows, duplicate aliases, missing columns, broken quotes, and oversized batches', () => {
  assert.throws(() => parseMatchCsv('試合名,紫,赤,黄,緑\n試合1,A,B,C,D\n試合2,A,,C,D'), /3行目.*赤/);
  assert.throws(() => parseMatchCsv('試合名,紫,赤,黄\n試合1,A,B,C'), /緑/);
  assert.throws(() => parseMatchCsv('試合名,紫,紫_参加者名,赤,黄,緑\n試合1,A,A,B,C,D'), /重複/);
  assert.throws(() => parseMatchCsv('試合名,紫,赤,黄,緑\n試合1,"A,B,C,D'), /引用符が閉じて/);
  assert.throws(() => parseMatchCsv('試合名,紫,赤,黄,緑\n試合1,"A"x,B,C,D'), /不正な文字/);
  assert.throws(() => parseMatchCsv('試合名,紫,赤,黄,緑\n試合1,A,B,C,D,extra'), /列が多く/);
  assert.throws(() => parseMatchCsv('試合名,紫,赤,黄,緑\n' + Array.from({ length: 201 }, (_, i) => `試合${i},A,B,C,D`).join('\n')), /200試合/);
  assert.throws(() => parseMatchCsv('試合名,紫,赤,黄,緑\n試合1,' + '名'.repeat(101) + ',B,C,D'), /100文字/);
});
test('plans can be created during competition without changing its timer or score', () => {
  let s = running(); const current = structuredClone(s.match);
  s = apply(s, { type: 'addPlans', plans: [plan('予選1'), plan('予選2')] });
  assert.deepEqual(s.match, current); assert.equal(s.matchPlans.length, 2);
  const bad = [plan('正常な予定'), { ...plan('不正な予定'), name: '' }];
  assert.throws(() => apply(s, { type: 'addPlans', plans: bad })); assert.equal(s.matchPlans.length, 2);
  assert.throws(() => apply(s, { type: 'prepareNext' }), /確定して/);
  assert.throws(() => apply(s, { type: 'preparePlan', planId: s.matchPlans[0].id }), /確定して/);
});
test('queue supports editing, reordering, removing, and one-click preparation', () => {
  let s = apply(initialState(), { type: 'addPlans', plans: [plan('予選1'), plan('予選2'), plan('予選3')] });
  const [a, b, c] = s.matchPlans.map(p => p.id);
  s = apply(s, { type: 'movePlan', planId: b, direction: 'up' }); assert.deepEqual(s.matchPlans.map(p => p.id), [b, a, c]);
  s = apply(s, { type: 'removePlan', planId: c });
  s = apply(s, { type: 'updatePlan', planId: b, plan: plan('予選2 改') });
  s = apply(s, { type: 'prepareNext' });
  assert.equal(s.match.name, '予選2 改'); assert.equal(s.match.phase, 'preparing'); assert.equal(s.matchPlans[0].matchId, s.match.id);
  assert.equal(s.match.fields.court1.participant.name, '参加者1');
  assert.throws(() => apply(s, { type: 'removePlan', planId: b }), /準備中/);
  s = apply(s, { type: 'updatePlan', planId: b, plan: { ...plan('予選2 最終'), participants: { ...participants, court1: { name: '訂正した名前', robot: '訂正ロボ' } } } });
  assert.equal(s.match.fields.court1.participant.name, '訂正した名前');
  s = apply(s, { type: 'preparePlan', planId: a });
  assert.equal(s.match.name, '予選1'); assert.equal(s.matchPlans.find(p => p.id === b)?.matchId, null, 'unstarted preparation returns to the queue');
  s = apply(s, { type: 'begin' }); advanceClock(s, 4000);
  assert.throws(() => apply(s, { type: 'updatePlan', planId: a, plan: plan('変更') }), /開始済み/);
});
test('finished scheduled matches stay in history when preparing the next match', () => {
  let s = apply(initialState(), { type: 'addPlans', plans: [plan('予定1'), plan('予定2')] });
  s = apply(s, { type: 'prepareNext' }); const firstId = s.match.id;
  s = apply(s, { type: 'begin' }); advanceClock(s, 4000);
  for (const c of COURTS) s = apply(s, { type: 'entry', courtId: c.id }, 5000 + c.number);
  s = apply(s, { type: 'finish' }, 6000); s = apply(s, { type: 'confirm' }, 7000);
  assert.equal(s.resultRecords[0].decisionReason, AUTO_DECISION_REASON);
  s = apply(s, { type: 'prepareNext' }, 8000);
  assert.equal(s.match.name, '予定2'); assert.equal(s.match.phase, 'preparing');
  assert.equal(s.match.fields.court1.entry, null); assert.equal(s.resultRecords[0].match.id, firstId);
  assert.equal(s.matchPlans[0].matchId, firstId);
});
test('automatic decisions and shared ranks need no typed reason; manual changes require one', () => {
  let s = running();
  for (const c of COURTS) s = apply(s, { type: 'entry', courtId: c.id }, 5000 + c.number);
  s = apply(s, { type: 'finish' }, 6000);
  s = apply(s, { type: 'ruling', order: automaticOrder(s.match), reason: '' });
  assert.equal(s.match.ruling, null);
  s = apply(s, { type: 'confirm' }); assert.equal(s.resultRecords[0].decisionReason, AUTO_DECISION_REASON);
  let tied = apply(running(), { type: 'finish' });
  tied = apply(tied, { type: 'ruling', order: automaticOrder(tied.match), reason: '' });
  assert.ok(apply(tied, { type: 'confirm' }).resultRecords[0].standings.every(s => s.rank === 1 && s.tied));
  assert.throws(() => apply(tied, { type: 'ruling', order: ['court4', 'court3', 'court2', 'court1'], reason: '' }), /理由/);
  tied = apply(tied, { type: 'ruling', order: ['court4', 'court3', 'court2', 'court1'], reason: '未到達同点のため主審が順位を決定' });
  tied = apply(tied, { type: 'confirm' }); assert.equal(tied.resultRecords[0].decisionReason, '未到達同点のため主審が順位を決定');
  tied = apply(tied, { type: 'reopen' }); tied = apply(tied, { type: 'clearRuling' }); assert.equal(tied.match.ruling, null);
});
test('legacy 2026 saved data gains an empty queue without resetting current match or history', () => {
  const previous = { ...initialState() } as Partial<State>;
  delete previous.matchPlans;
  previous.revision = 143;
  const restored = stateSchema.parse(previous);
  assert.deepEqual(restored.matchPlans, []); assert.equal(restored.revision, 143); assert.equal(restored.match.id, 'initial');
});
