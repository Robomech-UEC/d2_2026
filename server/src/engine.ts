import { randomUUID } from 'node:crypto';
import { COURTS, RULES, type BoxId } from '../../shared/config.js';
import { emptyMatch, type Command, type Match, type State } from '../../shared/model.js';
import { automaticOrder, decisionReason, elapsedMs, rankMatch } from '../../shared/scoring.js';
import { commandSchema } from '../../shared/validation.js';

export function advanceClock(state: State, now: number): boolean {
  const m = state.match;
  if (m.pausedAt !== null || m.deadline === null || now < m.deadline) return false;
  if (m.phase === 'countdown') {
    m.phase = 'running'; m.phaseStartedAt = m.deadline; m.deadline += RULES.matchMs; m.pausedMs = 0;
    state.revision++;
    if (now < m.deadline) return true;
  }
  if (m.phase === 'running') { m.phase = 'review'; m.deadline = null; state.revision++; return true; }
  return false;
}

function editable(match: Match) {
  if (match.phase !== 'running' && match.phase !== 'review') throw new Error('得点入力は競技中または採点確認中に行ってください。');
}
function canPrepare(match: Match) {
  if (match.phase !== 'preparing' && match.phase !== 'confirmed') throw new Error('現在の試合を確定してから次の試合を準備してください。');
}
function releasePreparedPlan(state: State) {
  if (state.match.phase === 'preparing') {
    const current = state.matchPlans.find(p => p.matchId === state.match.id);
    if (current) current.matchId = null;
  }
}
export function applyCommand(previous: State, input: unknown, now: number): State {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) throw new Error(`入力が不正です：${parsed.error.issues[0]?.message ?? '値を確認してください。'}`);
  const cmd: Command = parsed.data;
  const state: State = structuredClone(previous);
  const m = state.match;
  if (cmd.matchId !== m.id) throw new Error('試合が切り替わっています。最新の画面で操作してください。');
  if (cmd.type === 'save') return state;
  if (cmd.type === 'addPlans') {
    state.matchPlans.push(...cmd.plans.map(plan => ({ ...plan, id: randomUUID(), matchId: null })));
  } else if (cmd.type === 'updatePlan') {
    const plan = state.matchPlans.find(p => p.id === cmd.planId);
    if (!plan) throw new Error('試合予定が見つかりません。');
    if (plan.matchId !== null && !(plan.matchId === m.id && m.phase === 'preparing')) throw new Error('開始済みの試合予定は編集できません。');
    plan.name = cmd.plan.name; plan.participants = cmd.plan.participants;
    if (plan.matchId === m.id) { m.name = plan.name; COURTS.forEach(c => { m.fields[c.id].participant = plan.participants[c.id]; }); }
  } else if (cmd.type === 'removePlan') {
    const plan = state.matchPlans.find(p => p.id === cmd.planId);
    if (!plan) throw new Error('試合予定が見つかりません。');
    if (plan.matchId !== null) throw new Error('準備中・開始済みの試合予定は削除できません。');
    state.matchPlans = state.matchPlans.filter(p => p.id !== cmd.planId);
  } else if (cmd.type === 'movePlan') {
    const indices = state.matchPlans.map((plan, i) => plan.matchId === null ? i : -1).filter(i => i >= 0);
    const source = indices.findIndex(i => state.matchPlans[i].id === cmd.planId);
    if (source < 0) throw new Error('未開始の試合予定のみ並べ替えできます。');
    const target = source + (cmd.direction === 'up' ? -1 : 1);
    if (target >= 0 && target < indices.length) {
      const [a, b] = [indices[source], indices[target]];
      [state.matchPlans[a], state.matchPlans[b]] = [state.matchPlans[b], state.matchPlans[a]];
    }
  } else if (cmd.type === 'preparePlan' || cmd.type === 'prepareNext') {
    canPrepare(m);
    const selectedId = 'planId' in cmd ? cmd.planId : null;
    const plan = cmd.type === 'prepareNext' ? state.matchPlans.find(p => p.matchId === null) : state.matchPlans.find(p => p.id === selectedId);
    if (!plan) throw new Error('未開始の試合予定がありません。');
    if (plan.matchId !== null) throw new Error('この試合予定は準備済み・開始済みです。');
    releasePreparedPlan(state);
    state.match = emptyMatch(randomUUID(), plan.name, plan.participants);
    plan.matchId = state.match.id;
  } else if (cmd.type === 'newMatch') {
    canPrepare(m); releasePreparedPlan(state);
    state.match = emptyMatch(randomUUID(), cmd.name, cmd.participants);
  } else if (cmd.type === 'begin') {
    if (m.phase !== 'preparing' || !m.name || COURTS.some(c => !m.fields[c.id].participant.name.trim())) throw new Error('試合名と4人の参加者を登録してください。');
    m.phase = 'countdown'; m.phaseStartedAt = now; m.deadline = now + RULES.countdownMs; m.pausedAt = null; m.pausedMs = 0;
  } else if (cmd.type === 'finish') {
    if (m.phase !== 'running') throw new Error('競技中のみ終了できます。');
    m.phase = 'review'; m.deadline = null; m.pausedAt = null;
  } else if (cmd.type === 'pause' || cmd.type === 'resume') {
    if (m.phase !== 'running' && m.phase !== 'countdown') throw new Error('競技中のみ一時停止・再開できます。');
    if (cmd.type === 'pause') { if (m.pausedAt === null) m.pausedAt = now; }
    else if (m.pausedAt !== null && m.deadline !== null) { const delay = now - m.pausedAt; m.deadline += delay; m.pausedMs += delay; m.pausedAt = null; }
  } else if (cmd.type === 'confirm') {
    if (m.phase !== 'review') throw new Error('採点確認中のみ結果を確定できます。');
    const standings = rankMatch(m);
    m.phase = 'confirmed';
    const index = state.resultRecords.findIndex(r => r.match.id === m.id);
    const result = { match: structuredClone(m), standings, decisionReason: decisionReason(m), confirmedAt: now, revision: index < 0 ? 1 : state.resultRecords[index].revision + 1 };
    if (index < 0) state.resultRecords.push(result); else state.resultRecords[index] = result;
  } else if (cmd.type === 'reopen') {
    if (m.phase !== 'confirmed') throw new Error('確定済みの試合のみ確定解除できます。');
    m.phase = 'review';
  } else if (cmd.type === 'clearRuling') {
    if (m.phase !== 'review') throw new Error('自動判定に戻す操作は採点確認中に行ってください。');
    m.ruling = null;
  } else if (cmd.type === 'ruling') {
    if (m.phase !== 'review') throw new Error('同点判定は採点確認中に行ってください。');
    const active = COURTS.filter(c => !m.fields[c.id].disqualified).map(c => c.id);
    if (cmd.order.length !== active.length || !active.every(id => cmd.order.includes(id))) throw new Error('失格者を除く全員を、重複のない順番で指定してください。');
    const baseline = automaticOrder(m);
    const changed = baseline.some((id, i) => cmd.order[i] !== id);
    if (!changed) m.ruling = null;
    else {
      if (cmd.reason.trim().length < 3) throw new Error('自動判定の変更・同点の主審判定には、理由を3文字以上で記録してください。');
      m.ruling = { order: cmd.order, reason: cmd.reason };
    }
  } else if (cmd.type === 'entryOrder') {
    editable(m);
    if (cmd.order.length !== m.entryOrder.length || !m.entryOrder.every(id => cmd.order.includes(id))) throw new Error('到達済みの参加者全員を指定してください。');
    m.entryOrder = cmd.order; m.ruling = null;
    cmd.order.forEach(id => { const entry = m.fields[id].entry; if (entry) entry.corrected = true; });
  } else if ('courtId' in cmd) {
    editable(m);
    const f = m.fields[cmd.courtId];
    if (cmd.type === 'count' || cmd.type === 'setCount') {
      const parts = cmd.path.split('.');
      const key = parts[0] as 'debris' | 'fuel' | 'samples';
      const box = parts[1] as BoxId;
      const kind = parts[2] as 'correct' | 'wrong';
      const current = parts[0] === 'boxes' ? f.tasks.boxes[box][kind] : f.tasks[key];
      if (cmd.type === 'setCount' && cmd.expectedValue !== current) throw new Error('別の端末で個数が更新されました。最新の値を確認して入力し直してください。');
      const value = cmd.type === 'count' ? current + cmd.delta : cmd.value;
      const max = parts[0] === 'boxes' ? Number.MAX_SAFE_INTEGER : { debris: RULES.debrisMax, fuel: RULES.fuelMax, samples: RULES.sampleMax }[key];
      if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new Error(`個数は0〜${max}の整数で入力してください。`);
      if (parts[0] === 'boxes') f.tasks.boxes[box][kind] = value; else f.tasks[key] = value;
    } else if (cmd.type === 'setStart') f.tasks.start = cmd.value;
    else if (cmd.type === 'disqualify') f.disqualified = cmd.value;
    else if (cmd.type === 'entry') {
      if (f.entry) return previous;
      f.entry = { recordedAt: now, elapsedMs: elapsedMs(m, now), corrected: m.phase === 'review' };
      m.entryOrder.push(cmd.courtId);
    } else if (cmd.type === 'cancelEntry') { f.entry = null; m.entryOrder = m.entryOrder.filter(id => id !== cmd.courtId); }
    m.ruling = null;
  }
  state.revision++;
  return state;
}
