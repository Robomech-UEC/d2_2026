/** D2ロボコン2026 ルールブック Ver.3（2026-11-12） */
export const RULES = {
  name: 'D2ロボコン2026', version: '2026-ver3', matchMs: 300_000, countdownMs: 3_000,
  startPoints: 20, spacePoints: 20, debrisPoints: 25, debrisMax: 4,
  fuelPoints: 30, fuelMax: 4, samplePoints: 5, sampleMax: 12,
  boxCapacity: 4, boxBasePoints: 20, boxFuelBonus: 5,
} as const;
export const COURTS = [
  { id: 'court1', number: 1, label: '紫', color: '#7b1fa2', tint: '#f5edf8' },
  { id: 'court2', number: 2, label: '赤', color: '#c62828', tint: '#fff0ef' },
  { id: 'court3', number: 3, label: '黄', color: '#946900', tint: '#fff8df' },
  { id: 'court4', number: 4, label: '緑', color: '#237447', tint: '#ebf6ee' },
] as const;
export const BOXES = [
  { id: 'blue', label: '青', color: '#1565c0' },
  { id: 'yellow', label: '黄', color: '#946900' },
  { id: 'red', label: '赤', color: '#c62828' },
] as const;
export type CourtId = typeof COURTS[number]['id'];
export type BoxId = typeof BOXES[number]['id'];
export const COURT_MAP = Object.fromEntries(COURTS.map(c => [c.id, c])) as Record<CourtId, typeof COURTS[number]>;
