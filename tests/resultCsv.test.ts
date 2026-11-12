import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COURTS } from '../shared/config.js';
import { emptyMatch, type Result } from '../shared/model.js';
import { AUTO_DECISION_REASON, formatRank, rankMatch } from '../shared/scoring.js';
import { RESULT_CSV_HEADERS, resultCsvFilename, resultToCsv } from '../shared/resultCsv.js';

function fixture(): Result {
  const match = emptyMatch('csv-test', '予選 第1試合'); match.phase = 'confirmed';
  for (const c of COURTS) match.fields[c.id].participant = { name: `参加者${c.number}`, robot: `ロボット${c.number}` };
  match.fields.court1.tasks.debris = 2; match.fields.court2.tasks.debris = 2; match.fields.court3.tasks.debris = 1;
  return { match, standings: rankMatch(match), confirmedAt: Date.UTC(2026, 10, 12, 10, 30, 5), revision: 1 };
}

test('unentered equal scores share competition ranks and a readable tie label', () => {
  const result = fixture();
  assert.deepEqual(result.standings.map(s => s.rank), [1, 1, 3, 4]);
  assert.deepEqual(result.standings.map(s => s.tied), [true, true, false, false]);
  assert.ok(result.standings.every(s => !s.pending));
  assert.equal(formatRank(result.standings[0]), '1位タイ'); assert.equal(formatRank(result.standings[2]), '3位');
});
test('each result CSV contains a UTF-8 BOM, Japanese headers, four participants, scores, ties, and JST time', () => {
  const result = fixture(); const csv = resultToCsv(result);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const rows = csv.slice(1).trimEnd().split('\r\n');
  assert.equal(rows.length, 5);
  assert.equal(rows[0], RESULT_CSV_HEADERS.map(x => `"${x}"`).join(','));
  for (let i = 1; i <= 4; i++) {
    assert.ok(rows[i].startsWith('"予選 第1試合","2026-11-12 19:30:05","1",'));
    assert.ok(rows[i].includes(`"参加者${i}","ロボット${i}"`));
    assert.equal(rows[i].split(',').length, RESULT_CSV_HEADERS.length);
    assert.ok(rows[i].endsWith(`"${AUTO_DECISION_REASON}"`));
  }
  assert.ok(rows[1].includes('"1","はい","いいえ","50"'));
  assert.ok(rows[3].includes('"3","いいえ","いいえ","25"'));
});
test('CSV quotes names and comments, protects text formulas, and uses the confirmed numeric score', () => {
  const result = fixture();
  result.match.fields.court1.participant = { name: '太郎, "宇宙"', robot: '2行\nロボット' };
  result.match.fields.court2.participant.name = '=HYPERLINK("example")';
  result.match.fields.court1.tasks.debris = 4;
  result.decisionReason = '理由, "確認済み"';
  const csv = resultToCsv(result);
  assert.ok(csv.includes('"太郎, ""宇宙""","2行\nロボット"'));
  assert.ok(csv.includes('"\'=HYPERLINK(""example"")"'));
  assert.ok(csv.includes('"理由, ""確認済み"""'));
  assert.ok(csv.includes('"1","はい","いいえ","50"'), 'the confirmed score stays 50 even if raw task data differs');
});
test('CSV distinguishes disqualification, unentered participants, and entry at zero milliseconds', () => {
  const result = fixture();
  result.match.fields.court1.entry = { elapsedMs: 0, recordedAt: 1000, corrected: false };
  result.match.entryOrder = ['court1']; result.match.fields.court4.disqualified = true;
  result.standings = rankMatch(result.match);
  const rows = resultToCsv(result).slice(1).trimEnd().split('\r\n');
  const first = rows[1].split(',').map(x => x.slice(1, -1));
  const fourth = rows[4].split(',').map(x => x.slice(1, -1));
  assert.equal(first[17], '1'); assert.equal(first[18], '0');
  assert.equal(fourth[7], ''); assert.equal(fourth[9], 'はい'); assert.equal(fourth[10], '');
  assert.equal(fourth[17], ''); assert.equal(fourth[18], ''); assert.equal(formatRank(result.standings[3]), '失格');
  result.match.name = '予選:/第1試合?\n';
  assert.equal(resultCsvFilename(result), 'D2_2026_予選__第1試合___結果_v1.csv');
});
