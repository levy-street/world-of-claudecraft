// The Gauntlet venue's physical footprint: platform ground heights and static
// colliders, derived from the SAME content anchors the renderer builds the
// venue from (GAUNTLET_VENUE / GAUNTLET_LAYOUT), so what you see is what you
// stand on and collide with. Instance-local coordinates throughout; the
// callers (world.groundHeight and colliders.resolvePosition) subtract the
// slot origin first. Pure data-as-derivation: no rng, no Sim state.
//
// Platform edges are RAMPED, never sheer: the movement climb gate rejects a
// step whose rise/run exceeds PLAYER_MAX_CLIMB_SLOPE, so each walk-on surface
// blends to the sand over a skirt wide enough that any legal step is under
// the limit (the dais skirt matches its beveled render rim; the span deck
// gets matching render ramps at both crossing ends).

import type { Collider } from '../colliders';
import { GAUNTLET, GAUNTLET_LAYOUT, GAUNTLET_VENUE, sigilRingAngle } from '../content/gauntlet';

// The etching dais: flat disc top, conical rim (the render bevel).
const DAIS_TOP = 0.5;
const DAIS_SKIRT = 0.6;
// The brittle span deck: panel-top height over its whole footprint, ramped at
// the two crossing ends.
const SPAN_DECK_TOP = 0.58;
const SPAN_RAMP = 0.9;

/** Venue ground height at an instance-local point (0 = the band floor). */
export function gauntletVenueLocalGround(lx: number, lz: number): number {
  const S = GAUNTLET_VENUE.sigils;
  const daisD = Math.hypot(lx - S.x, lz - S.z);
  if (daisD < S.radius + DAIS_SKIRT) {
    if (daisD <= S.radius) return DAIS_TOP;
    return DAIS_TOP * (1 - (daisD - S.radius) / DAIS_SKIRT);
  }
  const V = GAUNTLET_VENUE.span;
  const t = GAUNTLET.span;
  const halfLen = (t.steps * t.panelLength) / 2;
  const halfW = t.panelGap / 2 + t.panelWidth + 0.4;
  const dx = Math.abs(lx - V.x);
  const dz = Math.abs(lz - V.z);
  if (dx <= halfW && dz <= halfLen + SPAN_RAMP) {
    if (dz <= halfLen) return SPAN_DECK_TOP;
    return SPAN_DECK_TOP * (1 - (dz - halfLen) / SPAN_RAMP);
  }
  return 0;
}

function circle(x: number, z: number, r: number): Collider {
  return { type: 'circle', x, z, r };
}

function obb(x: number, z: number, hw: number, hd: number, rot = 0): Collider {
  return { type: 'obb', x, z, hw, hd, rot };
}

let cache: Collider[] | null = null;

/** The venue's static colliders, instance-local. Built once; every entry
 * mirrors a solid the renderer places from the same anchors. */
export function gauntletVenueColliders(): Collider[] {
  if (cache) return cache;
  const out: Collider[] = [];
  const V = GAUNTLET_VENUE;
  const L = GAUNTLET.sentinel.fieldLength;
  const halfW = GAUNTLET.sentinel.fieldHalfWidth;

  // Grandstands: one box per tiered segment (the east side splits around the
  // spectators' terrace), spanning the tiers and the back wall.
  const deckZ0 = GAUNTLET_LAYOUT.spectatorZ - 12;
  const deckZ1 = GAUNTLET_LAYOUT.spectatorZ + 12;
  const segments: Array<[number, number, number]> = [
    [-1, V.standZMin, V.standZMax],
    [1, V.standZMin, deckZ0],
    [1, deckZ1, V.standZMax],
  ];
  for (const [side, z0, z1] of segments) {
    out.push(obb(side * (V.standX + 5.95), (z0 + z1) / 2, 5.95, (z1 - z0) / 2));
  }
  // Field kerbs and the torches pacing them.
  out.push(obb(-(halfW + 3.4), L / 2, 0.4, (L + 12) / 2));
  out.push(obb(halfW + 3.4, L / 2, 0.4, (L + 12) / 2));
  for (let z = 6; z < L; z += 21) {
    out.push(circle(-(halfW + 2.6), z, 0.3));
    out.push(circle(halfW + 2.6, z, 0.3));
  }
  // Signal pylons, the Stone Warden, and the braziers at its pedestal.
  const wz = L + GAUNTLET_LAYOUT.watcherMargin + 4;
  out.push(circle(-(halfW - 2), L + 3, 0.9));
  out.push(circle(halfW - 2, L + 3, 0.9));
  out.push(circle(0, wz, 5.4));
  out.push(circle(-7, wz - 1, 0.75));
  out.push(circle(7, wz - 1, 0.75));

  // Staging plaza: the arch's two feet, banner poles, torches.
  out.push(circle(-2.6, -2.4, 0.6));
  out.push(circle(2.6, -2.4, 0.6));
  out.push(circle(-(GAUNTLET_LAYOUT.stagingHalfWidth + 2.5), GAUNTLET_LAYOUT.stagingZ - 4, 0.2));
  out.push(circle(GAUNTLET_LAYOUT.stagingHalfWidth + 2.5, GAUNTLET_LAYOUT.stagingZ - 4, 0.2));
  out.push(circle(-5.2, -2.2, 0.3));
  out.push(circle(5.2, -2.2, 0.3));

  // The podium block (base + steps, one solid), its poles and braziers.
  const pz = GAUNTLET_LAYOUT.podiumZ - 4;
  out.push(obb(0, pz, 6, 3));
  out.push(circle(-5.4, pz - 3.4, 0.2));
  out.push(circle(5.4, pz - 3.4, 0.2));
  out.push(circle(-5.4, pz + 2.6, 0.75));
  out.push(circle(5.4, pz + 2.6, 0.75));

  // Spectators' terrace: benches, the field-side rail, end torches.
  const dx = GAUNTLET_LAYOUT.spectatorX + 4;
  const dz = GAUNTLET_LAYOUT.spectatorZ;
  out.push(obb(dx + 5, dz - 6, 0.6, 4));
  out.push(obb(dx + 5, dz + 6, 0.6, 4));
  out.push(obb(dx - 7.6, dz, 0.12, 10.9));
  out.push(circle(dx, dz - 10.4, 0.3));
  out.push(circle(dx, dz + 10.4, 0.3));

  // Sigils pavilion: the ringing pillars, every lectern (interactive one at
  // the center, the cosmetic ring at the shared angles), the banner.
  const S = V.sigils;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    out.push(
      circle(S.x + Math.sin(a) * (S.radius + 1.6), S.z + Math.cos(a) * (S.radius + 1.6), 0.5),
    );
  }
  out.push(circle(S.x, S.z, 0.55));
  for (let i = 0; i < S.ring.count; i++) {
    const a = sigilRingAngle(i, S.ring.count);
    out.push(circle(S.x + Math.sin(a) * S.ring.radius, S.z + Math.cos(a) * S.ring.radius, 0.55));
  }
  out.push(circle(S.x, S.z - S.radius - 1.4, 0.2));

  // The pull lane: threshold stakes, the beat drum, the banner.
  const P = V.pull;
  out.push(circle(P.x - P.knotTravel, P.z + P.pitHalfZ + 1.4, 0.15));
  out.push(circle(P.x + P.knotTravel, P.z + P.pitHalfZ + 1.4, 0.15));
  out.push(circle(P.x, P.z + P.pitHalfZ + 2.8, 1.0));
  out.push(circle(P.x, P.z + P.width / 2 + 1.6, 0.2));

  // The echo courtyard's three walls (the east side is the open entrance).
  const W = V.echo;
  out.push(obb(W.x, W.z - W.size / 2, W.size / 2, 0.35));
  out.push(obb(W.x, W.z + W.size / 2, W.size / 2, 0.35));
  out.push(obb(W.x - W.size / 2, W.z, 0.35, W.size / 2));

  // Span end torches + banner (the deck itself is a walk-on platform).
  const SP = V.span;
  const t = GAUNTLET.span;
  const spanHalfLen = (t.steps * t.panelLength) / 2;
  const sideX = t.panelGap / 2 + t.panelWidth / 2;
  out.push(circle(SP.x - sideX - 2.4, SP.z - spanHalfLen - 1.5, 0.3));
  out.push(circle(SP.x + sideX + 2.4, SP.z - spanHalfLen - 1.5, 0.3));
  out.push(circle(SP.x, SP.z - spanHalfLen - 3, 0.2));

  // The final court's corner torches and banner.
  const C = V.court;
  const c = GAUNTLET.court;
  const cz0 = C.z - c.courtLength / 2;
  for (const side of [-1, 1]) {
    out.push(circle(C.x + side * (c.courtHalfWidth + 2), cz0 + 2, 0.3));
    out.push(circle(C.x + side * (c.courtHalfWidth + 2), cz0 + c.courtLength - 2, 0.3));
  }
  out.push(circle(C.x, cz0 - 2, 0.2));

  cache = out;
  return out;
}
