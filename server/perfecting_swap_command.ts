import type { PerfectingSwapRequest } from '../src/sim/professions/perfecting_swap';
import { parsePerfectItemRef } from './perfect_item_ref';

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Rank exchange has no legacy unpinned form. Ignore all claimed outcomes. */
export function parsePerfectingSwapCommand(value: unknown): PerfectingSwapRequest | null {
  if (!object(value) || !object(value.source) || !object(value.target)) return null;
  const source = parsePerfectItemRef(value.source);
  const target = parsePerfectItemRef(value.target);
  return source?.copy && target?.copy ? { source, target } : null;
}
