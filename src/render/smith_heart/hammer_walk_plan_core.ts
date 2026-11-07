// Pure plan of the Hammer Gallery's walk dressing (phase 2E; the pieces are
// the Hammer kit's, docs/design/raid/kit/walk_pieces.py, painted with the
// rest of the kit by hammer_kit.ts): a worn kerb along every lip of the
// Gallery's paths and landings where they fall into the chasm, broken away
// here and there into a rubble edge, and the masons' chain rail set into the
// brink past the kerb, a post or two lost along the way. The fallen blocks
// lying on the walk are layout props (`sh_fallen_block`, on colliders), the
// paving is the walk's own ground (`paving`, field_textures.ts).
//
// Nothing here stands over a walked floor: a kerb is under a hand's height,
// a rail stands past the lip, over the drop. Three-free, DOM-free,
// deterministic (a hash, never rng).

import { SMITH_HEART_FIELD } from '../../sim/content/smith_heart_layout';
import { authoredFieldSurfaceAt } from '../../sim/instances/authored_field';
import { planFieldEdgePieces } from '../authored_field/field_edge_plan_core';
import type { HeartKitPlacement } from './heart_kit_core';
import { heartHash } from './heart_plan_core';

/** The Gallery's walked floors (their lips over the chasm take the kerb). */
export const HAMMER_WALK_SURFACES: ReadonlySet<string> = new Set([
  'gallery_upper',
  'gallery_h1',
  'gallery_middle',
  'gallery_h2',
  'gallery_lower',
  'gallery_h3',
]);

/** A kerb or rail module's half length at stretch 1 (yards). */
export const HAMMER_WALK_HALF = 3;

/** A rail module's reach along its run past its half length (its posts'
 *  footings) and its span out past the lip (yards, pinned against the GLB). */
export const HAMMER_RAIL = { overhang: 0.3, near: 0.3, far: 1.0 } as const;

/** Does a rail module at (x, z) turned by `rot` stand wholly over the drop? */
export function railClear(x: number, z: number, rot: number, stretch: number): boolean {
  const F = SMITH_HEART_FIELD;
  const ux = Math.cos(rot);
  const uz = -Math.sin(rot);
  const nx = Math.sin(rot);
  const nz = Math.cos(rot);
  const half = HAMMER_WALK_HALF * stretch + HAMMER_RAIL.overhang;
  for (let k = -6; k <= 6; k++) {
    const a = (k / 6) * half;
    for (const w of [HAMMER_RAIL.near, (HAMMER_RAIL.near + HAMMER_RAIL.far) / 2, HAMMER_RAIL.far]) {
      if (authoredFieldSurfaceAt(F, x + ux * a + nx * w, z + uz * a + nz * w)) return false;
    }
  }
  return true;
}

/** The kerb and the rail along the Gallery's lips. */
export function planHammerWalk(): HeartKitPlacement[] {
  const F = SMITH_HEART_FIELD;
  const edges = planFieldEdgePieces(F, {
    segment: HAMMER_WALK_HALF * 2,
    minDrop: 6,
    kindFor(run) {
      if (!HAMMER_WALK_SURFACES.has(run.surface) || run.low > F.voidHeight + 1) return null;
      return { piece: 'Kit_WalkCurbA', inset: 0, halfLength: HAMMER_WALK_HALF, halfDepth: 0.6 };
    },
  });
  const out: HeartKitPlacement[] = [];
  edges.forEach((e, i) => {
    if (e.stretch < 0.5 || e.stretch > 1.5) return;
    const h = heartHash(Math.round(e.x * 3), Math.round(e.z * 3));
    const base = {
      x: e.x,
      y: e.y,
      z: e.z,
      rot: e.rot,
      stretch: e.stretch,
      shear: e.shear,
      noShadow: true,
      cosmetic: true,
    };
    // The kerb, broken away into rubble about one module in four.
    out.push({ ...base, piece: h < 0.27 ? 'Kit_WalkCurbB' : 'Kit_WalkCurbA' });
    // The rail, a stretch of it lost now and then (never two in a row), and
    // none where the lip bends round onto another floor (a straight rail
    // would run on over the walk there).
    if (!(h > 0.82 && i % 2 === 0) && railClear(e.x, e.z, e.rot, e.stretch))
      out.push({ ...base, piece: 'Kit_WalkRail' });
  });
  return out;
}
