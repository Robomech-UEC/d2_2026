import { COURTS } from './config.js';
import type { Result } from './model.js';
import { decisionReason } from './scoring.js';

export const RESULT_CSV_HEADERS = [
  '試合名', '確定日時(JST)', '結果版', 'コート番号', 'コート色', '参加者名', 'ロボット名',
  '順位', '同順位', '失格', '合計点', 'スタート点', '宇宙到達点', 'A_デブリ点',
  'B_燃料仕分け点', 'C_サンプル点', 'D_ロケット点', '宇宙到達順', '宇宙到達時刻(秒)', '判定理由',
];

function csvCell(value: string | number): string {
  // Text fields remain literal when opened by spreadsheet software.
  const literal = typeof value === 'string' && /^[\s\uFEFF]*[=+\-@]/.test(value) ? `'${value}` : String(value);
  return `"${literal.replace(/"/g, '""')}"`;
}
function jstTime(timestamp: number): string {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(timestamp);
  const get = (key: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === key)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

/** Use the confirmed snapshot, even when a different match is currently running. */
export function resultToCsv(result: Result): string {
  const rows: (string | number)[][] = [RESULT_CSV_HEADERS];
  for (const court of COURTS) {
    const field = result.match.fields[court.id];
    const standing = result.standings.find(s => s.courtId === court.id);
    if (!standing) throw new Error('確定結果の参加者情報が不足しています。');
    const score = standing.score;
    rows.push([
      result.match.name, jstTime(result.confirmedAt), result.revision, court.number, court.label,
      field.participant.name, field.participant.robot,
      standing.disqualified ? '' : standing.rank ?? '', standing.tied ? 'はい' : 'いいえ', standing.disqualified ? 'はい' : 'いいえ',
      standing.disqualified ? '' : score.total, score.start, score.space, score.debris, score.fuel, score.samples, score.rocket,
      field.entry ? result.match.entryOrder.indexOf(court.id) + 1 : '', field.entry ? field.entry.elapsedMs / 1000 : '',
      result.decisionReason ?? decisionReason(result.match),
    ]);
  }
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function resultCsvFilename(result: Result): string {
  const safeName = result.match.name.replace(/[<>:"/\\|?*]|\p{Cc}/gu, '_').replace(/[.\s]+$/g, '').slice(0, 80) || '試合';
  return `D2_2026_${safeName}_結果_v${result.revision}.csv`;
}
