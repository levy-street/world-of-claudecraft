import { FORGE_QUEST_ID } from './content/world_quest_forging';
import { FORGE_STRIKES, sanitizeForgeResult } from './minigames/forge_workshop';
import type { WorldQuestForgeState } from './types';

function clock(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
function unit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Session-only owner readout. Save loading deliberately never calls this. */
export function decodeForgeState(
  value: unknown,
  questId: string,
): WorldQuestForgeState | undefined {
  if (questId !== FORGE_QUEST_ID || !value || typeof value !== 'object') return;
  const row = value as Partial<WorldQuestForgeState>;
  if (
    !['countdown', 'working', 'success', 'failed'].includes(row.phase ?? '') ||
    !['ready', 'hit', 'miss', 'cold', 'stoked'].includes(row.feedback ?? '')
  )
    return;
  for (const field of [
    'readyAt',
    'startedAt',
    'lockUntil',
    'observedAt',
    'heatAt',
    'stokeReadyAt',
  ] as const)
    if (!clock(row[field])) return;
  if (
    !Number.isSafeInteger(row.seed) ||
    (row.seed as number) < 0 ||
    !Number.isSafeInteger(row.strikes) ||
    (row.strikes as number) < 0 ||
    (row.strikes as number) > FORGE_STRIKES ||
    !unit(row.band) ||
    !unit(row.bandHalf) ||
    typeof row.heat !== 'number' ||
    !Number.isFinite(row.heat) ||
    row.heat < 0 ||
    row.heat > 100 ||
    !Number.isSafeInteger(row.mistakes) ||
    (row.mistakes as number) < 0 ||
    (row.mistakes as number) > 100000
  )
    return;
  if (row.phase === 'success' ? row.strikes !== FORGE_STRIKES : row.strikes === FORGE_STRIKES)
    return;
  const result = sanitizeForgeResult(row.result);
  if (row.phase === 'success' && !result) return;
  return {
    phase: row.phase as WorldQuestForgeState['phase'],
    observedAt: row.observedAt as number,
    seed: row.seed as number,
    readyAt: row.readyAt as number,
    startedAt: row.startedAt as number,
    strikes: row.strikes as number,
    band: row.band as number,
    bandHalf: row.bandHalf as number,
    heat: row.heat,
    heatAt: row.heatAt as number,
    stokeReadyAt: row.stokeReadyAt as number,
    lockUntil: row.lockUntil as number,
    mistakes: row.mistakes as number,
    feedback: row.feedback as WorldQuestForgeState['feedback'],
    ...(row.phase === 'success' ? { result } : {}),
  };
}
