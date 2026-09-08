import type { AbilityVfxFx } from './fx';
import { OVERLAY_CELL } from './fx_textures';
import type { OverlaySprites } from './overlay_sprites';

const STACKS = [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }] as const;

/** Sunder is a shared armor status: a Warrior can refresh a Rogue-created
 * instance without changing its stored id. The real kind/stacks stay truthful. */
export function holdWarriorControlMark(
  fx: AbilityVfxFx,
  id: number,
  aura: { id: string; kind?: string; remaining?: number; stacks?: number },
  alive: boolean,
): boolean {
  const armor = aura.kind === 'sunder';
  if (!armor && !(aura.id === 'hamstring_slow' && aura.kind === 'slow')) return false;
  if (!alive || (aura.remaining ?? 0) <= 0) return true;
  const stack = Math.min(5, Math.max(1, Math.floor(aura.stacks ?? 1)));
  fx.orbit(
    id,
    armor ? 'armorShear' : 'hamstringMark',
    armor ? 0xe7c797 : 0xc35654,
    STACKS[stack - 1],
    0,
  );
  return true;
}

export function drawWarriorControlMark(
  sink: OverlaySprites,
  armor: boolean,
  stacks: number,
  at: { x: number; y: number; z: number },
  toward: { x: number; y: number; z: number },
): void {
  const cell = armor
    ? OVERLAY_CELL.armorShear0 + Math.min(4, Math.max(0, Math.round(stacks) - 1))
    : OVERLAY_CELL.hamstring;
  const offset = armor ? 1.2 : 0.65;
  sink.push(
    at.x - toward.x * offset,
    at.y - toward.y * offset,
    at.z - toward.z * offset,
    0xffffff,
    armor ? 1.35 : 1.2,
    cell,
    0.95,
    1,
    1,
  );
}

/** Borrow a decorative band under contention, preserving charge/readiness and
 * other status marks. The same per-entity and global capacities still apply. */
export function evictDecorationForWarriorMark<T extends { style: string }>(
  orbits: Map<number, T[]>,
  entityId: number,
  ownFull: boolean,
): boolean {
  for (const [id, bands] of orbits) {
    if (ownFull && id !== entityId) continue;
    for (let i = bands.length - 1; i >= 0; i--) {
      const style = bands[i].style;
      if (
        style !== 'halo' &&
        style !== 'sparks' &&
        style !== 'runes' &&
        style !== 'wings' &&
        style !== 'heartbeat' &&
        style !== 'leaves'
      )
        continue;
      bands.splice(i, 1);
      // Leave the requested entity's live array attached for its incoming band.
      if (!bands.length && id !== entityId) orbits.delete(id);
      return true;
    }
  }
  return false;
}
