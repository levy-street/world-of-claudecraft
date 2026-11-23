import { applyFenbridgeTouchupToWorld } from './fenbridge_touchup';
import { freezeObjectMoves } from './moved_objects';
import type { WorldContent } from './types';

/** Reviewable spatial layers only. Gameplay tables and native scenery stay owned by code. */
export type WorldTouchupChanges = Partial<
  Pick<
    WorldContent,
    | 'terrainEdits'
    | 'terrainVertexEdits'
    | 'biomePaint'
    | 'detailRegions'
    | 'grassClear'
    | 'decorationExclusions'
    | 'objectMoves'
    | 'fenbridgeTouchup'
    | 'roads'
    | 'placements'
  >
>;

export interface WorldTouchup {
  version: 1;
  base: string | null;
  changes: WorldTouchupChanges;
}

/** Compare provenance across JS engines without rewriting any game values.
 * Native trigonometry differs by a final ULP between Chrome and Node. Twelve
 * significant digits retain sub-nanoyard precision across the overworld. */
export function worldTouchupIdentity(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'number') return Number(item.toPrecision(12));
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(
        Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    }
    return item;
  });
}

/** Deterministic drift token, not an authentication or security hash. */
export function worldTouchupBase(world: WorldContent): string {
  // Unlike ordinary record keys, NPC insertion order controls spawn entity ids.
  return worldTouchupToken({ world, npcOrder: Object.keys(world.npcs) });
}

export function worldTouchupToken(value: unknown): string {
  const text = worldTouchupIdentity(value) ?? '';
  let a = 0x811c9dc5;
  let b = 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193);
    b = Math.imul(b ^ text.charCodeAt(i), 0x01000193);
  }
  return `${text.length.toString(16)}-${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`;
}

export function applyWorldTouchup(base: WorldContent, patch: WorldTouchup): WorldContent {
  if (patch.version !== 1) throw new Error('Unsupported live-world patch version');
  if (patch.base !== null && patch.base !== worldTouchupBase(base)) {
    throw new Error('Live-world patch baseline changed. Rebase and review the map edits.');
  }
  if (Object.keys(patch.changes).length === 0) return base;
  const next: WorldContent = { ...base, ...patch.changes };
  if (next.objectMoves) {
    const frozen = freezeObjectMoves(next.objectMoves);
    if (frozen) next.objectMoves = frozen;
    else delete next.objectMoves;
  }
  return applyFenbridgeTouchupToWorld(next);
}
