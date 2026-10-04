// Fire and Fly keg spots, as a lot lays them (layTurretKegs in turret_barrels.ts stands them):
// one keg, or a tight cluster of 2 or 3 around one spot, each keg at the lot's spacing from
// every keg already standing. A spaced lot keeps its kegs out of chain reach of every other,
// and the kegs laid after keep out of theirs (TURRET_KEG_SPACING, held by each spaced keg);
// a cluster's kegs stand 1.5 to 2 yd apart, so lighting one sets off the rest through the
// blast chain. Pure: content in, numbers out, no draw.

import { TURRET_EXPLOSIVE_BARREL, TURRET_KEG_SPACING } from '../content/turret_defense';
import type { TurretKegClusterDef, TurretKegLotDef } from '../types';

/** How a lot lays one of its spots. */
export interface TurretKegLay {
  /** The closest a keg of the spot stands to any keg already standing (yd). */
  readonly spacing: number;
  /** Kegs at the spot: 1, or a cluster's 2 or 3. */
  readonly kegs: number;
}

/** Where a cluster's draws come from: a stream, its index, and the spot's own key. */
export interface TurretKegClusterSite {
  readonly stream: number;
  readonly index: number;
  readonly key: number;
}

/** A lone keg at the barrels' own spacing: every lot the shipped content lays. */
export const TURRET_KEG_LONE: TurretKegLay = {
  spacing: TURRET_EXPLOSIVE_BARREL.minSpacing,
  kegs: 1,
};

/** Whether a lot keeps its kegs out of chain reach: a crown lot, a spaced one, one with clusters. */
export function turretKegLotSpaced(lot: TurretKegLotDef): boolean {
  return lot.mode === 'crown' || lot.spaced === true || lot.cluster !== undefined;
}

/** How a lot lays its `i`-th spot: its first `clusters` spots are clusters (absent: all). */
export function turretKegLay(lot: TurretKegLotDef, i: number): TurretKegLay {
  const spacing = turretKegLotSpaced(lot)
    ? TURRET_KEG_SPACING.isolated
    : TURRET_EXPLOSIVE_BARREL.minSpacing;
  const clusters = lot.mode === 'path' ? 1 : (lot.clusters ?? Number.POSITIVE_INFINITY);
  const kegs = lot.cluster !== undefined && i < clusters ? lot.cluster : 1;
  return { spacing, kegs };
}

/** The kegs a lot lays at most: each cluster's kegs counted one by one. */
export function turretKegLotKegs(lot: TurretKegLotDef): number {
  if (lot.mode === 'path') return lot.cluster ?? 1;
  const clusters = lot.cluster === undefined ? 0 : (lot.clusters ?? lot.count);
  return lot.count + clusters * ((lot.cluster ?? 1) - 1);
}

/** A lot's cluster fields: both absent, or a cluster of 2 or 3 on at most every spot. */
export function turretKegClusterValid(lot: TurretKegClusterDef, spots: number): boolean {
  if (lot.cluster === undefined) return lot.clusters === undefined;
  if (lot.cluster !== 2 && lot.cluster !== 3) return false;
  return (
    lot.clusters === undefined ||
    (Number.isSafeInteger(lot.clusters) && lot.clusters >= 1 && lot.clusters <= spots)
  );
}

/**
 * A cluster's kegs around (x, z) for one draw pair (`turn` and `gap`, each in [0, 1)): two
 * either side of it, or three on a triangle around it, `gap` setting how far apart they
 * stand (TURRET_KEG_SPACING.clusterMin to clusterMax) and `turn` the way they face.
 */
export function turretKegClusterSpots(
  x: number,
  z: number,
  kegs: number,
  turn: number,
  gap: number,
): { x: number; z: number }[] {
  if (kegs <= 1) return [{ x, z }];
  const apart =
    TURRET_KEG_SPACING.clusterMin +
    gap * (TURRET_KEG_SPACING.clusterMax - TURRET_KEG_SPACING.clusterMin);
  // Two kegs `apart` across a centre, or three on a triangle of that side.
  const r = kegs === 2 ? apart / 2 : apart / Math.sqrt(3);
  const a0 = turn * Math.PI * 2;
  const spots: { x: number; z: number }[] = [];
  for (let k = 0; k < kegs; k++) {
    const a = a0 + (k * Math.PI * 2) / kegs;
    spots.push({ x: x + Math.sin(a) * r, z: z + Math.cos(a) * r });
  }
  return spots;
}
