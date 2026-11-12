import { z } from 'zod';
import type { State } from './model.js';

export const courtSchema = z.enum(['court1', 'court2', 'court3', 'court4']);
const int = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const box = z.object({ correct: int, wrong: int }).strict();
const participant = z.object({ name: z.string().max(100), robot: z.string().max(100) }).strict();
const record4 = <T extends z.ZodTypeAny>(value: T) => z.object({ court1: value, court2: value, court3: value, court4: value }).strict();
export const matchPlanInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  participants: record4(participant.extend({ name: z.string().trim().min(1).max(100) })),
}).strict();
const field = z.object({
  participant, tasks: z.object({ start: z.boolean(), debris: int.max(4), fuel: int.max(4), samples: int.max(12), boxes: z.object({ blue: box, yellow: box, red: box }).strict() }).strict(),
  entry: z.object({ elapsedMs: int.max(300_000), recordedAt: int, corrected: z.boolean() }).strict().nullable(),
  disqualified: z.boolean(),
}).strict();
const order = z.array(courtSchema).max(4).refine(a => new Set(a).size === a.length, '順番に重複があります');
export const matchSchema = z.object({
  id: z.string().min(1), name: z.string().max(100), phase: z.enum(['preparing', 'countdown', 'running', 'review', 'confirmed']),
  fields: record4(field), entryOrder: order,
  ruling: z.object({ order, reason: z.string().trim().min(3).max(1000) }).strict().nullable(),
  phaseStartedAt: int.nullable(), deadline: int.nullable(), pausedAt: int.nullable(), pausedMs: int,
}).strict().superRefine((m, ctx) => {
  const reached = Object.entries(m.fields).filter(([, f]) => f.entry !== null).map(([id]) => id);
  if (reached.length !== m.entryOrder.length || !reached.every(id => m.entryOrder.includes(id as z.infer<typeof courtSchema>))) ctx.addIssue({ code: 'custom', message: '到達順と到達者が一致しません' });
  if (['running', 'countdown'].includes(m.phase) && (m.deadline === null || m.phaseStartedAt === null)) ctx.addIssue({ code: 'custom', message: '競技時刻がありません' });
});
const score = z.object({ start: int, space: int, debris: int, fuel: int, samples: int, boxes: z.object({ blue: int, yellow: int, red: int }), unit: int, rocket: int, total: int.max(800) });
const standing = z.object({ courtId: courtSchema, score, rank: z.number().int().min(1).max(4).nullable(), pending: z.boolean(), disqualified: z.boolean(), tied: z.boolean().optional() });
export const stateSchema: z.ZodType<State, z.ZodTypeDef, unknown> = z.object({
  schemaVersion: z.literal(2026), revision: int, match: matchSchema,
  resultRecords: z.array(z.object({ match: matchSchema, standings: z.array(standing).length(4), confirmedAt: int, revision: int, decisionReason: z.string().optional() })),
  matchPlans: z.array(matchPlanInputSchema.extend({ id: z.string().min(1), matchId: z.string().min(1).nullable() })).default([]),
}).strict();

const path = z.enum(['debris', 'fuel', 'samples', 'boxes.blue.correct', 'boxes.blue.wrong', 'boxes.yellow.correct', 'boxes.yellow.wrong', 'boxes.red.correct', 'boxes.red.wrong']);
const common = { matchId: z.string().min(1).max(100) };
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ ...common, type: z.literal('newMatch'), name: z.string().trim().min(1).max(100), participants: record4(participant.extend({ name: z.string().trim().min(1).max(100) })) }).strict(),
  ...(['begin', 'finish', 'pause', 'resume', 'confirm', 'reopen', 'save', 'clearRuling', 'prepareNext'] as const).map(type => z.object({ ...common, type: z.literal(type) }).strict()),
  z.object({ ...common, type: z.literal('addPlans'), plans: z.array(matchPlanInputSchema).min(1).max(200) }).strict(),
  z.object({ ...common, type: z.literal('updatePlan'), planId: z.string().min(1), plan: matchPlanInputSchema }).strict(),
  z.object({ ...common, type: z.literal('removePlan'), planId: z.string().min(1) }).strict(),
  z.object({ ...common, type: z.literal('preparePlan'), planId: z.string().min(1) }).strict(),
  z.object({ ...common, type: z.literal('movePlan'), planId: z.string().min(1), direction: z.enum(['up', 'down']) }).strict(),
  z.object({ ...common, type: z.literal('count'), courtId: courtSchema, path, delta: z.union([z.literal(1), z.literal(-1)]) }).strict(),
  z.object({ ...common, type: z.literal('setCount'), courtId: courtSchema, path, value: int, expectedValue: int }).strict(),
  z.object({ ...common, type: z.literal('setStart'), courtId: courtSchema, value: z.boolean() }).strict(),
  z.object({ ...common, type: z.literal('entry'), courtId: courtSchema }).strict(),
  z.object({ ...common, type: z.literal('cancelEntry'), courtId: courtSchema }).strict(),
  z.object({ ...common, type: z.literal('disqualify'), courtId: courtSchema, value: z.boolean() }).strict(),
  z.object({ ...common, type: z.literal('entryOrder'), order }).strict(),
  z.object({ ...common, type: z.literal('ruling'), order, reason: z.string().trim().max(1000) }).strict(),
]);
export const requestSchema = z.object({ type: z.literal('command'), requestId: z.string().min(1).max(100), command: commandSchema }).strict();
