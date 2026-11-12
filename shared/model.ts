import { BOXES, COURTS, type BoxId, type CourtId } from './config.js';

export type Phase = 'preparing' | 'countdown' | 'running' | 'review' | 'confirmed';
export type Participant = { name: string; robot: string };
export type MatchPlanInput = { name: string; participants: Record<CourtId, Participant> };
export type MatchPlan = MatchPlanInput & { id: string; matchId: string | null };
export type Tasks = { start: boolean; debris: number; fuel: number; samples: number; boxes: Record<BoxId, { correct: number; wrong: number }> };
export type Entry = { elapsedMs: number; recordedAt: number; corrected: boolean };
export type Field = { participant: Participant; tasks: Tasks; entry: Entry | null; disqualified: boolean };
export type Ruling = { order: CourtId[]; reason: string };
export type Match = {
  id: string; name: string; phase: Phase; fields: Record<CourtId, Field>;
  entryOrder: CourtId[]; ruling: Ruling | null; phaseStartedAt: number | null;
  deadline: number | null; pausedAt: number | null; pausedMs: number;
};
export type ScoreDetail = { start: number; space: number; debris: number; fuel: number; samples: number; boxes: Record<BoxId, number>; unit: number; rocket: number; total: number };
export type Standing = { courtId: CourtId; score: ScoreDetail; rank: number | null; pending: boolean; disqualified: boolean; tied?: boolean };
export type Result = { match: Match; standings: Standing[]; confirmedAt: number; revision: number; decisionReason?: string };
export type State = { schemaVersion: 2026; revision: number; match: Match; resultRecords: Result[]; matchPlans: MatchPlan[] };
export type Snapshot = State & { standings: Standing[]; saveError: string | null };
export type CountPath = 'debris' | 'fuel' | 'samples' | `boxes.${BoxId}.correct` | `boxes.${BoxId}.wrong`;
export type Command =
  | { type: 'newMatch'; matchId: string; name: string; participants: Record<CourtId, Participant> }
  | { type: 'begin' | 'finish' | 'pause' | 'resume' | 'confirm' | 'reopen' | 'save' | 'clearRuling' | 'prepareNext'; matchId: string }
  | { type: 'addPlans'; matchId: string; plans: MatchPlanInput[] }
  | { type: 'updatePlan'; matchId: string; planId: string; plan: MatchPlanInput }
  | { type: 'removePlan' | 'preparePlan'; matchId: string; planId: string }
  | { type: 'movePlan'; matchId: string; planId: string; direction: 'up' | 'down' }
  | { type: 'count'; matchId: string; courtId: CourtId; path: CountPath; delta: 1 | -1 }
  | { type: 'setCount'; matchId: string; courtId: CourtId; path: CountPath; value: number; expectedValue: number }
  | { type: 'setStart'; matchId: string; courtId: CourtId; value: boolean }
  | { type: 'entry' | 'cancelEntry'; matchId: string; courtId: CourtId }
  | { type: 'disqualify'; matchId: string; courtId: CourtId; value: boolean }
  | { type: 'entryOrder'; matchId: string; order: CourtId[] }
  | { type: 'ruling'; matchId: string; order: CourtId[]; reason: string };
export type Request = { type: 'command'; requestId: string; command: Command };
export type ServerMessage =
  | { type: 'welcome' | 'state'; time: number; state: Snapshot }
  | { type: 'ack'; requestId: string }
  | { type: 'error'; requestId?: string; message: string }
  | { type: 'pong'; time: number; sentAt: number };

export function emptyTasks(): Tasks {
  return { start: false, debris: 0, fuel: 0, samples: 0, boxes: Object.fromEntries(BOXES.map(b => [b.id, { correct: 0, wrong: 0 }])) as Tasks['boxes'] };
}
export function emptyMatch(id = 'initial', name = '', participants?: Record<CourtId, Participant>): Match {
  return {
    id, name, phase: 'preparing',
    fields: Object.fromEntries(COURTS.map(c => [c.id, { participant: participants?.[c.id] ?? { name: '', robot: '' }, tasks: emptyTasks(), entry: null, disqualified: false }])) as Match['fields'],
    entryOrder: [], ruling: null, phaseStartedAt: null, deadline: null, pausedAt: null, pausedMs: 0,
  };
}
export function initialState(): State { return { schemaVersion: 2026, revision: 0, match: emptyMatch(), resultRecords: [], matchPlans: [] }; }
