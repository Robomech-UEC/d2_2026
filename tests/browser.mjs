/** Optional UI acceptance test: installed Chrome by default, see README. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createScoreboard } from '../dist/server/src/app.js';

const directory = await mkdtemp(path.join(os.tmpdir(), 'd2-browser-'));
const board = await createScoreboard({ saveDirectory: directory, clientDirectory: path.resolve('client/dist') });
const errors = [];
let browser;
const captureDirectory = path.resolve('test-results');
await mkdir(captureDirectory, { recursive: true });
try {
  const port = await board.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({ channel: process.env.D2_BROWSER_CHANNEL ?? 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  // Count media calls so repeated renders cannot silently duplicate effects.
  await context.addInitScript(() => {
    window.__soundCalls = [];
    window.__sockets = [];
    const OriginalSocket = window.WebSocket;
    window.WebSocket = class extends OriginalSocket { constructor(...args) { super(...args); window.__sockets.push(this); } };
    HTMLMediaElement.prototype.play = function () { window.__soundCalls.push(this.src); return Promise.resolve(); };
  });
  const page = async route => {
    const p = await context.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.goto(`${base}${route}`);
    await p.locator('main, .venue-canvas, .overlay-canvas').waitFor();
    await p.waitForFunction(() => !document.body.textContent.includes('サーバに接続中です。'));
    return p;
  };
  const admin = await page('/admin');
  console.log('UI: registration');
  await admin.getByRole('textbox', { name: /^試合名/ }).fill('第1試合・うちゅうミッション');
  for (let i = 1; i <= 4; i++) {
    await admin.getByRole('textbox', { name: new RegExp(`^${i} 参加者名`) }).fill(['宇宙 太郎', 'ロボ 花子', '星野 ひかり', '月野 そら'][i - 1]);
    await admin.getByLabel(`${i} ロボット名`, { exact: true }).fill(['スペースエクスプローラー', 'あかいロケット号', 'スターコレクター', 'グリーンアーム'][i - 1]);
  }
  await admin.getByRole('button', { name: '4人を登録・得点を初期化' }).click();
  await admin.waitForFunction(() => document.querySelector('h6')?.textContent?.includes('第1試合'));
  const venue = await page('/screen');
  console.log('UI: countdown and 4 inputs');
  await venue.getByRole('button', { name: '音声を有効にする' }).click();
  await admin.getByRole('button', { name: '3・2・1で競技開始' }).click();
  await admin.waitForFunction(async () => (await (await fetch('/api/state')).json()).match.phase === 'running');
  const scorePages = await Promise.all([1, 2, 3, 4].map(i => page(`/score/court${i}`)));
  await Promise.all(scorePages.map(p => p.getByRole('button', { name: 'A デブリをたおした数を1増やす', exact: true }).click()));
  await Promise.all(scorePages.map(p => p.getByRole('button', { name: 'スタート達成 ＋20点', exact: true }).click()));
  await Promise.all(scorePages.map(p => p.getByRole('button', { name: 'うちゅう到達 ＋20点', exact: true }).click()));
  const purple = scorePages[0];
  for (const [label, value] of [
    ['A デブリをたおした数', '4'], ['B 正しく仕分けた玉の数', '4'], ['C 落としたサンプルの採点対象数', '12'],
    ['青の箱：正しい色の個数', '4'], ['黄の箱：正しい色の個数', '4'], ['赤の箱：正しい色の個数', '4'],
  ]) {
    const input = purple.getByRole('textbox', { name: label, exact: true });
    await input.fill(value); await input.press('Tab');
  }
  await venue.waitForFunction(() => document.querySelector('.score-card .score-value')?.textContent?.startsWith('800'));
  const wrong = purple.getByRole('textbox', { name: '赤の箱：違う色の個数', exact: true });
  await wrong.fill('1'); await wrong.press('Tab');
  await venue.waitForFunction(() => document.querySelector('.score-card .score-value')?.textContent?.startsWith('760'));
  await wrong.fill('0'); await wrong.press('Tab');
  await venue.waitForFunction(() => document.querySelector('.score-card .score-value')?.textContent?.startsWith('800'));
  await venue.screenshot({ path: path.join(captureDirectory, 'screen-1600x900.png') });
  console.log('UI: screen, audio, overlay, and mobile');
  const cardsFit = await venue.locator('.score-card').evaluateAll(cards => cards.every(c => { const r = c.getBoundingClientRect(); return r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; }));
  assert.ok(cardsFit, 'venue cards must fit the 1600×900 viewport');
  const calls = await venue.evaluate(() => window.__soundCalls);
  assert.equal(calls.length, 5, 'one activation, three countdown tones, and one start tone');
  const overlay = await page('/streaming-overlay');
  await overlay.screenshot({ path: path.join(captureDirectory, 'overlay-1600x900.png'), omitBackground: true });
  assert.equal(await overlay.locator('.score-card').count(), 4);
  assert.equal(await overlay.locator('.sound-control').count(), 0);
  assert.equal(await overlay.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert.equal(await overlay.evaluate(() => window.__soundCalls.length), 0);
  await purple.setViewportSize({ width: 390, height: 844 });
  await purple.evaluate(() => window.scrollTo(0, 0));
  assert.equal(await purple.locator('nav').isVisible(), true, 'mobile operation navigation must remain visible');
  await purple.screenshot({ path: path.join(captureDirectory, 'input-mobile.png'), fullPage: true });
  assert.ok(await purple.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile input must not overflow horizontally');
  await context.setOffline(true);
  for (const p of context.pages()) await p.evaluate(() => window.__sockets.forEach(ws => ws.close()));
  await purple.getByText('サーバに接続中です。再接続が完了するまで入力できません。', { exact: true }).waitFor();
  assert.equal(await purple.getByRole('button', { name: '赤の箱：違う色の個数を1増やす', exact: true }).isDisabled(), true);
  await context.setOffline(false);
  await admin.getByText('サーバ接続中', { exact: true }).waitFor();
  await purple.waitForFunction(() => !document.querySelector('[aria-label="赤の箱：違う色の個数を1増やす"]')?.disabled);
  console.log('UI: confirmation, revision, and history');
  const referee = await page('/referee');
  await admin.getByRole('button', { name: '競技を終了して採点へ' }).click();
  await referee.getByRole('button', { name: '試合結果を確定', exact: true }).click();
  await referee.waitForFunction(async () => (await (await fetch('/api/state')).json()).match.phase === 'confirmed');
  await referee.getByRole('button', { name: '確定解除して訂正', exact: true }).click();
  await referee.waitForFunction(async () => (await (await fetch('/api/state')).json()).match.phase === 'review');
  await referee.getByRole('button', { name: '試合結果を確定', exact: true }).click();
  const home = await page('/');
  await home.getByText('確定 第2版', { exact: true }).waitFor();
  await home.screenshot({ path: path.join(captureDirectory, 'dashboard.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Browser acceptance passed: registration, countdown, 4 inputs, 800 points, mixed colors, screen fit, sound deduplication, transparent overlay, mobile, confirmation/revision, reconnect.');
} catch (error) {
  if (browser) for (const [index, p] of browser.contexts().flatMap(c => c.pages()).entries()) { await p.screenshot({ path: path.join(captureDirectory, `failure-${index}.png`), fullPage: true }).catch(() => {}); }
  console.error('Page errors:', errors);
  console.error('Scores:', board.snapshot().standings.map(s => [s.courtId, s.score.total]));
  throw error;
} finally {
  await browser?.close(); await board.close(); await rm(directory, { recursive: true, force: true });
}
