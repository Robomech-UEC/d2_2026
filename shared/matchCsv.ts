import { COURTS, type CourtId } from './config.js';
import type { MatchPlanInput, Participant } from './model.js';
import { matchPlanInputSchema } from './validation.js';

export const CSV_HEADERS = ['試合名', ...COURTS.flatMap(c => [`${c.label}_参加者名`, `${c.label}_ロボット名`])];
export const CSV_MAX_MATCHES = 200;
export const CSV_MAX_BYTES = 1024 * 1024;

export function decodeMatchCsv(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('shift_jis', { fatal: true }).decode(bytes); }
}

/** Quoted commas, escaped quotes, embedded newlines, BOM, and CRLF are supported. */
function readRows(input: string): { cells: string[]; line: number }[] {
  const text = input.replace(/^\uFEFF/, '');
  const rows: { cells: string[]; line: number }[] = [];
  let cells: string[] = [];
  let value = '';
  let quoted = false;
  let closedQuote = false;
  let line = 1;
  let startLine = 1;
  function finishCell() { cells.push(value); value = ''; closedQuote = false; }
  function finishRow() { finishCell(); if (cells.some(c => c.trim())) rows.push({ cells, line: startLine }); cells = []; }
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { value += '"'; i++; }
        else { quoted = false; closedQuote = true; }
      } else if (char === '\r' || char === '\n') {
        value += '\n'; line++; if (char === '\r' && text[i + 1] === '\n') i++;
      } else value += char;
    } else if (char === ',') finishCell();
    else if (char === '\r' || char === '\n') {
      finishRow(); line++; startLine = line; if (char === '\r' && text[i + 1] === '\n') i++;
    } else if (closedQuote) {
      if (char !== ' ' && char !== '\t') throw new Error(`${line}行目：閉じた引用符の後に不正な文字があります。`);
    } else if (char === '"') {
      if (value.trim()) throw new Error(`${line}行目：引用符を含むセル全体をダブルクォーテーションで囲んでください。`);
      value = ''; quoted = true;
    } else value += char;
  }
  if (quoted) throw new Error(`${startLine}行目：引用符が閉じていません。`);
  if (value || cells.length || closedQuote) finishRow();
  return rows;
}

const normalize = (header: string) => header.trim().replace(/[\s_＿-]/g, '').toLowerCase();
export function parseMatchCsv(text: string): MatchPlanInput[] {
  const rows = readRows(text);
  if (rows.length < 2) throw new Error('見出しと、1試合以上のデータを入力してください。');
  if (rows.length - 1 > CSV_MAX_MATCHES) throw new Error(`CSVは一度に${CSV_MAX_MATCHES}試合まで読み込めます。`);
  const headers = rows[0].cells.map(normalize);
  function column(aliases: string[], required: boolean, label: string) {
    const indices = headers.flatMap((h, i) => aliases.map(normalize).includes(h) ? [i] : []);
    if (indices.length > 1) throw new Error(`「${label}」に対応する列が重複しています。`);
    if (!indices.length && required) throw new Error(`CSVに「${label}」の列がありません。ひな形を確認してください。`);
    return indices[0] ?? -1;
  }
  const nameIndex = column(['試合名', 'match', 'match_name'], true, '試合名');
  const columns = COURTS.map(c => ({ ...c,
    name: column([`${c.label}_参加者名`, `${c.label}_名前`, c.label, `${c.number}_参加者名`, `${c.id}_name`], true, `${c.label}_参加者名`),
    robot: column([`${c.label}_ロボット名`, `${c.number}_ロボット名`, `${c.id}_robot`], false, `${c.label}_ロボット名`),
  }));
  return rows.slice(1).map(row => {
    if (row.cells.length > headers.length) throw new Error(`${row.line}行目：見出しより列が多くなっています。名前にカンマを使う場合は引用符で囲んでください。`);
    const cell = (index: number) => row.cells[index]?.trim() ?? '';
    const plan = { name: cell(nameIndex), participants: Object.fromEntries(columns.map(c => [c.id, { name: cell(c.name), robot: cell(c.robot) }])) as Record<CourtId, Participant> };
    const result = matchPlanInputSchema.safeParse(plan);
    if (!result.success) {
      const issue = result.error.issues[0];
      const court = COURTS.find(c => issue.path.includes(c.id));
      const label = court ? `${court.label}の${issue.path.includes('robot') ? 'ロボット名' : '参加者名'}` : '試合名';
      throw new Error(`${row.line}行目：${label}を確認してください。試合名と4人の参加者名は必須、各項目は100文字以内です。`);
    }
    return result.data;
  });
}
