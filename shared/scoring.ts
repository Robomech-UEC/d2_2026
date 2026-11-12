import { BOXES, COURTS, RULES, type CourtId } from './config.js';
import type { Field, Match, ScoreDetail, Standing } from './model.js';

export const AUTO_DECISION_REASON = '変更がなく、得点とうちゅう到達順から自動的に決まったため';
export const decisionReason = (match: Match) => match.ruling?.reason ?? AUTO_DECISION_REASON;
export function automaticOrder(match: Match): CourtId[] {
  const scores = Object.fromEntries(COURTS.map(c => [c.id, calculateScore(match.fields[c.id]).total])) as Record<CourtId, number>;
  const entryIndex = (id: CourtId) => match.fields[id].entry ? match.entryOrder.indexOf(id) : Number.POSITIVE_INFINITY;
  return COURTS.map(c => c.id).filter(id => !match.fields[id].disqualified).sort((a, b) => scores[b] - scores[a] || (entryIndex(a) - entryIndex(b) || 0));
}

export function calculateScore(field: Field): ScoreDetail {
  const { tasks } = field;
  const unit = RULES.boxBasePoints + RULES.boxFuelBonus * tasks.fuel;
  const boxes = Object.fromEntries(BOXES.map(({ id }) => {
    const { correct, wrong } = tasks.boxes[id];
    return [id, Math.max(0, Math.min(correct, RULES.boxCapacity - wrong)) * unit];
  })) as ScoreDetail['boxes'];
  const detail = {
    start: tasks.start ? RULES.startPoints : 0, space: field.entry ? RULES.spacePoints : 0,
    debris: tasks.debris * RULES.debrisPoints, fuel: tasks.fuel * RULES.fuelPoints,
    samples: tasks.samples * RULES.samplePoints, boxes, unit,
    rocket: Object.values(boxes).reduce((a, b) => a + b, 0), total: 0,
  };
  detail.total = detail.start + detail.space + detail.debris + detail.fuel + detail.samples + detail.rocket;
  return detail;
}

/** Score, then entry order. Unentered ties share a competition rank (1, 1, 3). */
export function rankMatch(match: Match): Standing[] {
  const scores = Object.fromEntries(COURTS.map(c => [c.id, calculateScore(match.fields[c.id])])) as Record<CourtId, ScoreDetail>;
  const entryIndex = (id: CourtId) => match.fields[id].entry ? match.entryOrder.indexOf(id) : Number.POSITIVE_INFINITY;
  const compare = (a: CourtId, b: CourtId) => scores[b].total - scores[a].total || (entryIndex(a) - entryIndex(b) || 0);
  const active = COURTS.map(c => c.id).filter(id => !match.fields[id].disqualified).sort(compare);
  const standings = new Map<CourtId, Standing>();
  for (let i = 0; i < active.length;) {
    const group = active.filter(id => compare(active[i], id) === 0);
    const ruling = match.ruling;
    const resolved = group.length === 1 || ruling !== null && group.every(id => ruling.order.includes(id));
    if (ruling && resolved && group.length > 1) group.sort((a, b) => ruling.order.indexOf(a) - ruling.order.indexOf(b));
    group.forEach((id, j) => standings.set(id, { courtId: id, score: scores[id], rank: resolved ? i + j + 1 : i + 1, pending: false, disqualified: false, tied: !resolved }));
    i += group.length;
  }
  return COURTS.map(({ id }) => standings.get(id) ?? { courtId: id, score: scores[id], rank: null, pending: false, disqualified: true, tied: false });
}

export function formatRank(standing: Standing): string {
  if (standing.disqualified) return '失格';
  if (standing.rank === null) return '—';
  return `${standing.rank}位${standing.tied ? 'タイ' : ''}`;
}

export function remainingMs(match: Match, now: number): number {
  if (match.phase === 'preparing') return RULES.matchMs;
  if (match.deadline === null) return 0;
  const duration = match.phase === 'countdown' ? RULES.countdownMs : RULES.matchMs;
  return Math.min(duration, Math.max(0, match.deadline - (match.pausedAt ?? now)));
}
export function elapsedMs(match: Match, now: number): number {
  return Math.min(RULES.matchMs, Math.max(0, (match.pausedAt ?? now) - (match.phaseStartedAt ?? now) - match.pausedMs));
}
export function standingFor(standings: Standing[], courtId: CourtId): Standing {
  const value = standings.find(s => s.courtId === courtId);
  if (!value) throw new Error(`順位情報がありません: ${courtId}`);
  return value;
}
