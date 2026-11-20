// Every Updraft ride of the Islands of the Wind clears all the solid round it
// (Jose's playtest of 2026-11-18: "I go in and pass through the isle from
// underneath" on the east chain, high over the Cornice). Each ride, out from
// the Cornice, isle to isle and home, is sampled along its fixed arc
// (breath_isle_geometry.ts rideArc) against every isle's floor slab and the
// crag hanging under it (with a skirt for the sculpt's lip past the walk), the
// field's floors, the mountain's rock and the crown ridge's crags; and each
// comes down onto its landing from above.

import { describe, expect, it } from 'vitest';
import { BREATH_ENV_ROCK } from '../src/render/smith_heart/breath_env_plan_core';
import { planHeartCrownSpires } from '../src/render/smith_heart/heart_crown_ridge_core';
import { heartMountainHeight } from '../src/render/smith_heart/heart_mountain_core';
import { ISLE_KIT } from '../src/render/smith_heart_fx/breath_isles_fx_core';
import {
  BREATH,
  BREATH_ISLE_REACH,
  BREATH_ISLES,
  SMITH_HEART_FIELD,
} from '../src/sim/content/smith_heart_layout';
import {
  cornicePads,
  isleSpots,
  RIDE_SHAPE,
  rideArc,
} from '../src/sim/encounters/smith_heart/breath_isle_geometry';
import { authoredFieldHeight, authoredFieldSurfaceAt } from '../src/sim/instances/authored_field';

const C = BREATH.cornice;
type P = { x: number; y: number; z: number };
/** The sculpt's rock past the walk's polygon (its lip, its satellites). */
const SKIRT = 6;
/** A rider's height (yards): no part of the body may be in rock. */
const BODY = 2;

function legs(): { name: string; a: P; b: P }[] {
  const sp = isleSpots();
  const out: { name: string; a: P; b: P }[] = [];
  for (const side of [0, 1] as const) {
    const pad = cornicePads()[side];
    const i0 = side * 3;
    out.push({
      name: `out ${side}`,
      a: { x: pad.x, y: C.h, z: pad.z },
      b: { x: sp[i0].land.x, y: sp[i0].h, z: sp[i0].land.z },
    });
    for (let k = 0; k < 2; k++) {
      const from = sp[i0 + k].pad;
      if (!from) throw new Error('no pad');
      out.push({
        name: `isle ${i0 + k} to ${i0 + k + 1}`,
        a: { x: from.x, y: sp[i0 + k].h, z: from.z },
        b: { x: sp[i0 + k + 1].land.x, y: sp[i0 + k + 1].h, z: sp[i0 + k + 1].land.z },
      });
    }
    for (let k = 0; k < 3; k++) {
      const s = sp[i0 + k];
      // Home from anywhere on the isle: its middle and its far side.
      for (const [dx, dz] of [
        [0, 0],
        [4, 4],
        [-4, -4],
      ])
        out.push({
          name: `home ${i0 + k} (${dx},${dz})`,
          a: { x: s.x + dx, y: s.h, z: s.z + dz },
          b: { x: s.back.x, y: C.h, z: s.back.z },
        });
    }
  }
  return out;
}

/** What a body at `p` (feet) is inside, or null. */
function solidAt(p: P, endpoints: readonly P[]): string | null {
  // Standing on a ride's own start or landing is the floor, never inside it.
  const onEnd = endpoints.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < 0.5 && p.y >= q.y - 1e-6);
  for (let i = 0; i < BREATH_ISLES.length; i++) {
    const isle = BREATH_ISLES[i];
    const d = Math.hypot(p.x - isle.x, p.z - isle.z);
    if (d > BREATH_ISLE_REACH[i] + SKIRT) continue;
    // The slab and its crag: from under the crag's point to the floor's top.
    if (p.y < isle.h - 0.05 && p.y + BODY > isle.h - ISLE_KIT[i].depth - 2)
      return `isle ${isle.id} (${d.toFixed(1)} yd out, ${(p.y - isle.h).toFixed(1)} under its floor)`;
  }
  if (!onEnd) {
    const s = authoredFieldSurfaceAt(SMITH_HEART_FIELD, p.x, p.z);
    if (s && !s.hidden && authoredFieldHeight(SMITH_HEART_FIELD, p.x, p.z) > p.y + 0.05)
      return `floor ${s.id}`;
  }
  if (heartMountainHeight(p.x, p.z) > p.y) return 'mountain rock';
  for (const c of planHeartCrownSpires()) {
    const m = BREATH_ENV_ROCK[c.piece];
    const k = c.scale ?? 1;
    const top = c.y + m.h * k * (c.rise ?? 1);
    if (Math.hypot(p.x - c.x, p.z - c.z) < (m.w * k * (c.stretch ?? 1)) / 2 && p.y < top)
      return `crown crag ${c.piece}`;
  }
  return null;
}

describe('the Updraft rides clear every solid', () => {
  it('no sample of any ride, east or west, out or home, stands in rock or under an isle', () => {
    const bad: string[] = [];
    for (const { name, a, b } of legs())
      for (let k = 0; k <= 1 + 1e-9; k += 0.01) {
        const p = rideArc(a, b, k);
        const hit = solidAt(p, [a, b]);
        if (hit) bad.push(`${name} at ${k.toFixed(2)}: ${hit}`);
      }
    expect(bad.slice(0, 8)).toEqual([]);
  });

  it('climbs before it glides and comes down onto its landing from above', () => {
    for (const { name, a, b } of legs()) {
      const top = Math.max(a.y, b.y);
      // Over its landing well before it gets there, and never under it at the end.
      const mid = rideArc(a, b, RIDE_SHAPE.up);
      expect(mid.y, name).toBeGreaterThan(top + 5);
      for (let k = RIDE_SHAPE.up; k <= 1 + 1e-9; k += 0.02)
        expect(rideArc(a, b, k).y, `${name} ${k}`).toBeGreaterThanOrEqual(b.y - 1e-6);
      // The glide only begins once the climb is well under way, and the body
      // comes down only once it is nearly over its landing.
      const early = rideArc(a, b, RIDE_SHAPE.glide[0]);
      expect(Math.hypot(early.x - a.x, early.z - a.z), name).toBeLessThan(1e-6);
      const fall = rideArc(a, b, 1 - RIDE_SHAPE.down);
      const span = Math.hypot(b.x - a.x, b.z - a.z);
      expect(Math.hypot(fall.x - b.x, fall.z - b.z), name).toBeLessThan(span * 0.1 + 1e-6);
      expect(rideArc(a, b, 0)).toEqual(a);
      const end = rideArc(a, b, 1);
      expect(Math.hypot(end.x - b.x, end.y - b.y, end.z - b.z)).toBeLessThan(1e-9);
    }
  });
});
