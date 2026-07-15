import {
  MAX_LOADOUTS,
  repairAllocation,
  SAVED_LOADOUT_BAR_SLOTS,
  type SavedLoadout,
} from './content/talents';
import type { PlayerClass } from './types';

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function repairBar(value: unknown): (string | null)[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, SAVED_LOADOUT_BAR_SLOTS)
    .map((slot) => (typeof slot === 'string' ? slot : null));
}

/**
 * Repair every persisted loadout and remap the active index after malformed
 * entries are dropped. The helper is pure and bounded for untrusted JSONB.
 */
export function repairTalentLoadouts(
  cls: PlayerClass,
  playerLevel: number,
  value: unknown,
  activeValue: unknown,
): { loadouts: SavedLoadout[]; activeLoadout: number } {
  if (!Array.isArray(value)) return { loadouts: [], activeLoadout: -1 };

  const rawActive =
    typeof activeValue === 'number' && Number.isSafeInteger(activeValue) ? activeValue : -1;
  const loadouts: SavedLoadout[] = [];
  let activeLoadout = -1;
  const source = value.slice(0, MAX_LOADOUTS);

  for (let rawIndex = 0; rawIndex < source.length; rawIndex++) {
    const raw = recordValue(source[rawIndex]);
    if (!raw) continue;
    const name = (typeof raw.name === 'string' && raw.name ? raw.name : 'Build').slice(0, 24);
    const repaired: SavedLoadout = {
      name,
      alloc: repairAllocation(cls, raw.alloc, playerLevel),
      bar: repairBar(raw.bar),
    };
    if (rawIndex === rawActive) activeLoadout = loadouts.length;
    loadouts.push(repaired);
  }

  return { loadouts, activeLoadout };
}
