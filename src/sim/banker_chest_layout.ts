// The banker's strongbox: where the decorative chest stands beside a banker
// NPC. A pure leaf shared by src/render/banker_chest.ts (which places the
// mesh) and src/sim/colliders.ts (which gives it a standable collider), so
// the drawn chest and the solid chest are always the same box. Extracted
// from the render module, byte-identical placement math: the ordered local
// candidates try behind-left, behind-right, then the front corners, and the
// first placement whose sampled footprint is fully clear wins.

export const BANKER_CHEST_TARGET_HEIGHT = 1.3;
export const BANKER_CHEST_HALF_WIDTH = 1.09;
export const BANKER_CHEST_HALF_DEPTH = 0.65;
export const BANKER_CHEST_SAMPLE_COLUMNS = 9;
export const BANKER_CHEST_SAMPLE_ROWS = 5;

// Local +z is the NPC's forward/approach direction. Keep the decoration behind
// and to one side when space permits so the banker remains the clear target.
// The ordered alternatives let cramped authored or custom-world locations use
// the other side, then a front-side position, without moving into the banker.
//
// The chest is a SOLID, standable collider now, so every candidate stands the
// whole box at least BANKER_ANCHOR_CLEARANCE clear of the banker's own point:
// that point is where players stand to bank (service routes end on it at
// body radius up to 0.8), and the old hugging offsets put a box corner inside
// it. Behind-and-beside placements come first, then the pushed-out front
// corners for cramped spots.
export const BANKER_CHEST_PLACEMENTS = Object.freeze([
  Object.freeze({ x: 1.15, y: 0, z: -1.6, rotationY: 0 }),
  Object.freeze({ x: -1.15, y: 0, z: -1.6, rotationY: 0 }),
  Object.freeze({ x: 2.0, y: 0, z: 0.9, rotationY: 0 }),
  Object.freeze({ x: -2.0, y: 0, z: 0.9, rotationY: 0 }),
]);

/** Minimum gap between the chest's box and the banker's interaction point. */
export const BANKER_ANCHOR_CLEARANCE = 0.85;

export interface BankerChestAnchor {
  pos: { x: number; z: number };
  facing: number;
}

export type BankerChestLocalPlacement = (typeof BANKER_CHEST_PLACEMENTS)[number];

export type BankerChestBlockedAt = (
  seed: number,
  x: number,
  z: number,
  radius: number,
  ignoreFences: boolean,
) => boolean;

export function bankerChestCenterWorld(
  anchor: BankerChestAnchor,
  placement: BankerChestLocalPlacement,
): { x: number; z: number } {
  const facingCos = Math.cos(anchor.facing);
  const facingSin = Math.sin(anchor.facing);
  return {
    x: anchor.pos.x + placement.x * facingCos + placement.z * facingSin,
    z: anchor.pos.z - placement.x * facingSin + placement.z * facingCos,
  };
}

export function bankerChestBlockedSampleCount(
  anchor: BankerChestAnchor,
  worldSeed: number,
  placement: BankerChestLocalPlacement,
  blockedAt: BankerChestBlockedAt,
  bestSoFar: number,
): number {
  const facingCos = Math.cos(anchor.facing);
  const facingSin = Math.sin(anchor.facing);
  const localCos = Math.cos(placement.rotationY);
  const localSin = Math.sin(placement.rotationY);
  let blocked = 0;

  for (let column = 0; column < BANKER_CHEST_SAMPLE_COLUMNS; column++) {
    const across =
      -BANKER_CHEST_HALF_WIDTH +
      (2 * BANKER_CHEST_HALF_WIDTH * column) / (BANKER_CHEST_SAMPLE_COLUMNS - 1);
    for (let row = 0; row < BANKER_CHEST_SAMPLE_ROWS; row++) {
      const depth =
        -BANKER_CHEST_HALF_DEPTH +
        (2 * BANKER_CHEST_HALF_DEPTH * row) / (BANKER_CHEST_SAMPLE_ROWS - 1);
      const localX = placement.x + across * localCos + depth * localSin;
      const localZ = placement.z - across * localSin + depth * localCos;
      const worldX = anchor.pos.x + localX * facingCos + localZ * facingSin;
      const worldZ = anchor.pos.z - localX * facingSin + localZ * facingCos;
      if (blockedAt(worldSeed, worldX, worldZ, 0, false)) {
        blocked++;
        if (blocked >= bestSoFar) return blocked;
      }
    }
  }
  return blocked;
}

/** Does this candidate's box keep the required gap from the banker point?
 *  The box is axis-aligned in the anchor's local frame (rotationY 0), so the
 *  closest-point test is a plain clamped-rectangle distance. */
export function placementClearsBanker(placement: BankerChestLocalPlacement): boolean {
  const dx = Math.max(0, Math.abs(placement.x) - BANKER_CHEST_HALF_WIDTH);
  const dz = Math.max(0, Math.abs(placement.z) - BANKER_CHEST_HALF_DEPTH);
  return Math.hypot(dx, dz) >= BANKER_ANCHOR_CLEARANCE;
}

/** The winning local placement for a banker's chest: fewest blocked footprint
 *  samples among the candidates that keep the banker point clear, ties to
 *  the earliest candidate, early-out on a fully clear one. */
export function resolveBankerChestLocalPlacement(
  anchor: BankerChestAnchor,
  worldSeed: number,
  blockedAt: BankerChestBlockedAt,
): BankerChestLocalPlacement {
  let best = BANKER_CHEST_PLACEMENTS[0];
  let bestBlocked = Number.POSITIVE_INFINITY;
  for (const placement of BANKER_CHEST_PLACEMENTS) {
    const blocked = bankerChestBlockedSampleCount(
      anchor,
      worldSeed,
      placement,
      blockedAt,
      bestBlocked,
    );
    if (blocked < bestBlocked) {
      best = placement;
      bestBlocked = blocked;
      if (blocked === 0) break;
    }
  }
  return best;
}

/**
 * The placement the SOLID chest may take: the first candidate that both
 * keeps the banker point clear and has a fully clear sampled footprint.
 * Null when the spot is too cramped, in which case the chest stays a
 * decorative mesh with no collider (the pre-solid behavior).
 */
export function resolveSolidBankerChestPlacement(
  anchor: BankerChestAnchor,
  worldSeed: number,
  blockedAt: BankerChestBlockedAt,
): BankerChestLocalPlacement | null {
  for (const placement of BANKER_CHEST_PLACEMENTS) {
    if (!placementClearsBanker(placement)) continue;
    const blocked = bankerChestBlockedSampleCount(anchor, worldSeed, placement, blockedAt, 1);
    if (blocked === 0) return placement;
  }
  return null;
}
