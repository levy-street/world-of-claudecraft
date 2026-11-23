// Collision for the solid pieces of a seasonal event's city dressing: the keeper's
// stalls, the hay bales, the big lit pumpkins and the corn shocks stop a body the way
// any crate or well does, but only while the event runs.
//
// The pieces come from the resolved layout (seasonal_decor_layout.ts), so collision and
// drawing are the same list and cannot drift. They join the static collider grid as ONE
// gated set (colliders.ts setColliderGateOpen): built the first time the event opens (a
// world that never sees the event never pays for it), registered while it runs, out of
// every cell the moment it closes. Every collision consumer (movement, support, sight,
// the online client's self-prediction) reads those cells, so the event's furniture is
// there or gone for all of them at once. The owning world re-applies its own answer
// at the top of every tick and at construction (the Sim, world_gates.ts) or on every
// season change (the online ClientWorld, net/seasonal_wire_state.ts), the transport
// gates' contract. Built-in world only (the dressing is resolved against its towns).
//
// Never a trap: the shapes sit a little inside each piece's drawn silhouette (a body
// brushes past a skirt of straw instead of snagging on it), the low ones (bales, big
// pumpkins) can be jumped (moveTopY), and the layout already keeps every piece off the
// roads, off NPC spots and out of narrow passages; tests/seasonal_decor_colliders.test.ts
// walks every dressed town both ways and pins that nothing reachable gets cut off. Old
// Thatchgrin's field ring is dressing only (no collision): it rings a boss arena.
//
// Pure and deterministic: no rng, no clock, no Three. The layout read is memoized.
import type { Collider } from './collider_shapes';
import { setColliderGateOpen } from './colliders';
import { GOURDLIGHT_EVE_ID } from './content/gourdlight_eve';
import {
  type SeasonalGroundKind,
  type SeasonalGroundPiece,
  type SeasonalStall,
  seasonalDecorLayout,
} from './seasonal_decor_layout';
import { stallLocalToWorld } from './seasonal_decor_stall';

/** The collider gate the Gourdlight Eve dressing rides on. */
export const GOURDLIGHT_DECOR_GATE = 'seasonal:gourdlight_eve';

/** A solid ground piece's body, against its authored model (model.py / stall.py), at
 *  DECOR_KIND_SCALE 1: `r` a circle radius or `hw`/`hd` a box, `top` its height. Only the
 *  pieces listed here collide; gourds, small pumpkins and garland poles stay open. */
const SOLID_PIECES: Readonly<
  Partial<
    Record<
      SeasonalGroundKind,
      { r?: number; hw?: number; hd?: number; top: number; jump?: boolean }
    >
  >
> = {
  // the festival pumpkin: rind radius 0.36, a little inside it
  pumpkin_lit: { r: 0.3, top: 0.55, jump: true },
  // a corn shock's waist and skirt (corn_shock.py: the foot flares to 0.5)
  corn_shock: { r: 0.36, top: 2.2 },
  // the bound bale (1.05 x 0.55 x 0.48) under its pumpkin
  hay_bale: { hw: 0.5, hd: 0.25, top: 0.5, jump: true },
};

/** The stall's solid parts, in its own frame (yards, BEFORE STALL_SCALE; stall.py's
 *  Blender X is +x, its -Y is +z): the booth, the hay stack on its left, the crate stack
 *  on its right, the two corn shocks lashed to the front posts and the side pumpkin. */
const STALL_PARTS: readonly {
  lx: number;
  lz: number;
  hw?: number;
  hd?: number;
  r?: number;
  top: number;
}[] = [
  { lx: 0, lz: -0.05, hw: 2.32, hd: 1.1, top: 3.75 },
  { lx: -3.15, lz: -0.27, hw: 0.3, hd: 0.95, top: 1.6 },
  { lx: 3.02, lz: -0.1, hw: 0.36, hd: 0.58, top: 1.3 },
  { lx: -2.4, lz: 1.33, r: 0.3, top: 2.8 },
  { lx: 2.4, lz: 1.33, r: 0.3, top: 2.8 },
  { lx: 2.85, lz: 0.85, r: 0.26, top: 0.5 },
];

/** Whether a piece of this kind collides at all. */
export function decorPieceIsSolid(kind: SeasonalGroundKind): boolean {
  return SOLID_PIECES[kind] !== undefined;
}

function pieceCollider(p: SeasonalGroundPiece): Collider | null {
  const body = SOLID_PIECES[p.kind];
  if (!body) return null;
  // the layout's own scale already carries DECOR_KIND_SCALE (seat()), so it is the size
  const k = p.scale;
  const top = p.y + body.top * k;
  const heights = { cameraTopY: top, underY: p.y, ...(body.jump ? { moveTopY: top } : {}) };
  if (body.r !== undefined) return { type: 'circle', x: p.x, z: p.z, r: body.r * k, ...heights };
  return {
    type: 'obb',
    x: p.x,
    z: p.z,
    hw: (body.hw ?? 0) * k,
    hd: (body.hd ?? 0) * k,
    rot: p.yaw,
    ...heights,
  };
}

function stallColliders(stall: SeasonalStall, out: Collider[]): void {
  const s = stall.scale;
  for (const part of STALL_PARTS) {
    const c = stallLocalToWorld(stall.x, stall.z, stall.yaw, part.lx * s, part.lz * s);
    const heights = { cameraTopY: stall.y + part.top * s, underY: stall.y };
    if (part.r !== undefined)
      out.push({ type: 'circle', x: c.x, z: c.z, r: part.r * s, ...heights });
    else
      out.push({
        type: 'obb',
        x: c.x,
        z: c.z,
        hw: (part.hw ?? 0) * s,
        hd: (part.hd ?? 0) * s,
        rot: stall.yaw,
        ...heights,
      });
  }
}

/** Every collider of the dressing at `seed`, fresh objects (the grid stamps its own
 *  bookkeeping onto each, so two grids must never share them). */
export function seasonalDecorColliders(seed: number): Collider[] {
  const layout = seasonalDecorLayout(seed);
  const out: Collider[] = [];
  for (const stall of layout.stalls) stallColliders(stall, out);
  for (const p of layout.ground) {
    // Old Thatchgrin's field ring stays open: a wall of tall shocks round a boss arena would
    // block casters' sight lines and snag players kiting his rain; it is dressing, not a fence
    if (p.anchor.startsWith('field:')) continue;
    const c = pieceCollider(p);
    if (c) out.push(c);
  }
  return out;
}

/**
 * Apply which event runs to the seed's collider grid: the Gourdlight Eve dressing
 * collides iff that event is the one running. Cheap and idempotent (an unchanged gate is
 * a no-op there), so the owning world calls it every tick. The first opening resolves
 * the layout BEFORE its colliders join the grid, so the dressing is always seated
 * against the bare town, never against itself.
 */
export function syncSeasonalDecorColliders(seed: number, activeEventId: string | null): void {
  const open = activeEventId === GOURDLIGHT_EVE_ID;
  setColliderGateOpen(seed, GOURDLIGHT_DECOR_GATE, open, () => seasonalDecorColliders(seed));
}
