import { WORLD_LAYOUT } from './active';

/** Native civic models have gameplay identities and derived service sockets. */
export const CIVIC_ASSETS = {
  eastbrook_weekly_vault: 'tidehold/vault',
  eastbrook_market_stall_world_market: 'props/eastbrook_market_stall',
  eastbrook_market_stall_provisions: 'props/eastbrook_market_stall',
  fenbridge_mirelight_cistern: 'props/fenbridge_mirelight_cistern',
  fenbridge_provision_stall: 'props/fenbridge_provision_stall',
} as const;
export type CivicId = keyof typeof CIVIC_ASSETS;
export interface CivicPlacement {
  x: number;
  z: number;
  rotation: number;
  lift: number;
  groundY?: number;
}

export function civicPosition(id: CivicId, position: { x: number; z: number }, rotation = 0) {
  const edit = WORLD_LAYOUT.civic?.[id];
  return edit
    ? { position: { x: edit.x, z: edit.z }, rotation: edit.rotation }
    : { position, rotation };
}

/** Procedural vault geometry retains its buried footing; normalized GLBs do not. */
export function civicGroundY(
  id: string | undefined,
  position: { x: number; z: number },
  groundAt: (x: number, z: number) => number,
  fallback = groundAt(position.x, position.z),
): number {
  const edit = id && WORLD_LAYOUT.civic?.[id as CivicId];
  // A custom-world record moved elsewhere is not this canonical civic object.
  if (!edit || edit.x !== position.x || edit.z !== position.z) return fallback;
  return (
    (edit.groundY ?? groundAt(edit.x, edit.z)) +
    edit.lift +
    (id === 'eastbrook_weekly_vault' ? 1.45 : 0)
  );
}

/** Preserve the authored ground seat when exporting native models back to Studio. */
export function civicPlacementFields(id: string) {
  const edit = WORLD_LAYOUT.civic?.[id as CivicId];
  return edit
    ? {
        y: edit.lift,
        ...(edit.groundY === undefined ? {} : { detached: true, groundY: edit.groundY }),
      }
    : {};
}
