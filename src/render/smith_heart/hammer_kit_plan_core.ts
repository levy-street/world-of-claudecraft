// Pure plan of the Hammer vein's Blender kit (docs/design/raid/kit/
// build_smith_heart_hammer_kit.py, painted by hammer_kit.ts): where every
// Kit_* piece stands over the Cleft, the Hammer Gallery, the Smith's Quarry,
// the Slab and the Balcony.
//
//   - the layout's own `sh_*` props of the vein, each fitted with its piece
//     (the colossi kneel on the first step, carved out of the terraces);
//   - the quarry faces and lips along every cliff run of the vein's floors
//     (the shared edge planner, field_edge_plan_core.ts): a worked riser on
//     each terrace step, a flat worked rim where the pit's walked floor meets
//     the first step (the void lips are the rock kit's since phase 2E);
//   - the render-only dressing: a scaffold against the Vigil, chain hoists
//     hung off the Gallery's lips, spoil heaps on the terraces, chips on the
//     walked floors, the collapse spot's overhang over the lower Gallery, and
//     the two lookout statues at the Balcony's sides.
//
// Nothing render-only stands over a reachable walked floor (the chips are
// flat, the overhang hangs nine yards up); the terraces are dressing floors
// nobody reaches. Three-free, DOM-free, deterministic (a hash, never rng).

import {
  BALCONY,
  CLEFT,
  GALLERY_LANDINGS,
  HAMMER_PIT,
  QUARRY_TERRACES,
  SLAB,
  SMITH_HEART_FIELD,
} from '../../sim/content/smith_heart_layout';
import {
  authoredFieldHeight,
  authoredFieldSurfaceAt,
  type FieldCliffRun,
} from '../../sim/instances/authored_field';
import {
  type FieldEdgeKind,
  type FieldEdgePiece,
  planFieldEdgePieces,
} from '../authored_field/field_edge_plan_core';
import { planHammerWalk } from './hammer_walk_plan_core';
import type { HeartKitPlacement } from './heart_kit_core';
import { heartHash, heartPropBase } from './heart_plan_core';

/** The vein's floors (their cliff runs take the kit's faces and lips). */
export const HAMMER_KIT_SURFACES: ReadonlySet<string> = new Set([
  'cleft',
  'gallery_upper',
  'gallery_h1',
  'gallery_middle',
  'gallery_h2',
  'gallery_lower',
  'gallery_h3',
  'quarry_step_1',
  'quarry_step_2',
  'quarry_step_3',
  'quarry_step_4',
  'hammer_pit',
  'pit_descent',
  'slab_stair',
]);

/** The terrace steps: dressing floors nobody walks (no path reaches them). */
export function isQuarryStep(surfaceId: string | undefined): boolean {
  return !!surfaceId && surfaceId.startsWith('quarry_step_');
}

/** The layout prop kinds the kit draws (their placeholders step aside once
 *  the kit has landed: heart_props.ts). */
export const HAMMER_KIT_KINDS: ReadonlySet<string> = new Set([
  'sh_cleft_mouth',
  'sh_rough_statue',
  'sh_geode',
  'sh_pit_column',
  'sh_quarry_colossus',
  'sh_quarry_block',
  'sh_quarry_derrick',
  'sh_slab_frame',
  'sh_fallen_block',
]);

/** The three colossi, in the layout's order (east, south-east, south). */
export const HAMMER_COLOSSI = ['Kit_ColossusVigil', 'Kit_ColossusWaking', 'Kit_ColossusBearer'];

/** The kit's sizes the plan fits (yards, measured off the Blender build and
 *  pinned by tests/smith_heart_hammer_kit.test.ts). */
export const HAMMER_KIT_SIZES = {
  /** A quarry face or rim module: half its run, its drop. */
  faceHalf: 4.4,
  faceDrop: 7.4,
  /** A lip station over the void (the hoists' spacing): half its run. */
  lipHalf: 5.4,
  /** How far the colossi reach from their origin across the ground. */
  colossusReach: 14,
  /** How far past the pit's rim the great cliffs stand (on the top step,
   *  their faces' feet on its lip). */
  crownOut: 30,
  /** How far a great cliff's face reaches out of its origin (+Z). */
  crownFront: 7,
} as const;

/** The great cliffs crowning the quarry's back wall, on its top step behind
 *  the colossi (bearing from the pit's centre, piece, scale): the mountain
 *  cut by the Smith in giant benches, breaking the terraces' skyline. */
export const HAMMER_CROWN: readonly { deg: number; piece: string; scale: number }[] = [
  { deg: 46, piece: 'Kit_GreatCliffB', scale: 0.95 },
  { deg: 74, piece: 'Kit_GreatCliffA', scale: 1.0 },
  { deg: 101, piece: 'Kit_GreatCliffC', scale: 0.92 },
  { deg: 128, piece: 'Kit_GreatCliffB', scale: 1.08 },
  { deg: 155, piece: 'Kit_GreatCliffA', scale: 0.96 },
  { deg: 182, piece: 'Kit_GreatCliffC', scale: 1.0 },
  { deg: 206, piece: 'Kit_GreatCliffB', scale: 0.9 },
];

/** Where the quarry faces, rims and lips stand along every cliff run of the
 *  vein (two passes: the risers and rims at 7 yd modules, the lips at 9.5). */
export function planHammerEdges(): FieldEdgePiece[] {
  const F = SMITH_HEART_FIELD;
  const kind = (piece: string, half: number, inset: number): FieldEdgeKind => ({
    piece,
    inset,
    halfLength: half,
    halfDepth: 1.5,
  });
  const lowSurface = (run: FieldCliffRun): string | undefined => {
    const mx = (run.ax + run.bx) / 2 + run.nx * 1.2;
    const mz = (run.az + run.bz) / 2 + run.nz * 1.2;
    return authoredFieldSurfaceAt(F, mx, mz)?.id;
  };
  const intoVoid = (run: FieldCliffRun): boolean => run.low <= F.voidHeight + 1;
  const risers = planFieldEdgePieces(F, {
    segment: 7,
    minDrop: 4,
    kindFor(run, index) {
      if (!HAMMER_KIT_SURFACES.has(run.surface) || intoVoid(run)) return null;
      const low = lowSurface(run);
      if (low === 'hammer_pit') {
        return kind(
          index % 3 === 1 ? 'Kit_QuarryRimB' : 'Kit_QuarryRimA',
          HAMMER_KIT_SIZES.faceHalf,
          -0.22,
        );
      }
      if (!isQuarryStep(low)) return null;
      const pick = ['Kit_QuarryFaceA', 'Kit_QuarryFaceB', 'Kit_QuarryFaceA', 'Kit_QuarryFaceC'][
        index % 4
      ];
      return kind(pick, HAMMER_KIT_SIZES.faceHalf, -0.05);
    },
  });
  // The lip stations over the void: no kit piece of their own since phase
  // 2E (the rock kit's lips hang there, heart_rock_plan_core.ts); the chain
  // hoists hang off them.
  const lips = planFieldEdgePieces(F, {
    segment: 9.5,
    minDrop: 6,
    kindFor(run, index) {
      if (!HAMMER_KIT_SURFACES.has(run.surface) || !intoVoid(run)) return null;
      return kind(index % 2 ? 'Kit_QuarryLipB' : 'Kit_QuarryLipA', HAMMER_KIT_SIZES.lipHalf, 0);
    },
  });
  const colossi = colossusSpots();
  const keep = (e: FieldEdgePiece): boolean => {
    // Not through a colossus (its own rock is the riser there).
    if (colossi.some((c) => Math.hypot(e.x - c.x, e.z - c.z) < HAMMER_KIT_SIZES.colossusReach))
      return false;
    // Not through the Slab's jambs.
    if (Math.abs(e.z - SLAB.z) < 6 && Math.abs(e.x - SLAB.x) < 13) return false;
    // Not a sliver squashed into a short bend (the bare rock reads better).
    return e.stretch >= 0.4;
  };
  return [...risers, ...lips].filter(keep);
}

function colossusSpots(): { x: number; z: number; rot: number }[] {
  return SMITH_HEART_FIELD.props
    .filter((p) => p.kind === 'sh_quarry_colossus')
    .map((p) => ({ x: p.x, z: p.z, rot: p.rot }));
}

/** A point `lx` across and `lz` ahead of an origin turned by `rot`. */
function local(o: { x: number; z: number; rot: number }, lx: number, lz: number) {
  const c = Math.cos(o.rot);
  const s = Math.sin(o.rot);
  return { x: o.x + lx * c + lz * s, z: o.z - lx * s + lz * c };
}

/** Every layout prop of the vein fitted with its kit piece. */
export function planHammerProps(): HeartKitPlacement[] {
  const out: HeartKitPlacement[] = [];
  const count = new Map<string, number>();
  for (const prop of SMITH_HEART_FIELD.props) {
    if (!HAMMER_KIT_KINDS.has(prop.kind)) continue;
    const i = count.get(prop.kind) ?? 0;
    count.set(prop.kind, i + 1);
    const base = heartPropBase(prop.x, prop.z);
    const at = { x: prop.x, z: prop.z, y: base, rot: prop.rot };
    switch (prop.kind) {
      case 'sh_cleft_mouth':
        // On the landing's height (the crack's foot is out past its lip).
        out.push({ ...at, y: CLEFT.h, piece: 'Kit_CleftGate', noShadow: true });
        break;
      case 'sh_rough_statue':
        out.push({ ...at, piece: i % 2 ? 'Kit_RoughStatueB' : 'Kit_RoughStatueA' });
        break;
      case 'sh_geode':
        out.push({ ...at, piece: i % 2 ? 'Kit_GeodeB' : 'Kit_GeodeA' });
        break;
      case 'sh_pit_column':
        // The column itself is the Hammer Council's (it cracks, falls and
        // stands again: smith_heart_fx/council_fx.ts draws it from its
        // pillar object); the socket it stands in stays.
        out.push({ ...at, piece: 'Kit_PitColumnSocket', noShadow: true });
        break;
      case 'sh_quarry_colossus':
        // Kneeling on the first step, the figure carved out of the steps above.
        out.push({ ...at, y: QUARRY_TERRACES.steps[0].h, piece: HAMMER_COLOSSI[i % 3] });
        break;
      case 'sh_quarry_block':
        out.push({ ...at, piece: i % 2 ? 'Kit_CutBlockB' : 'Kit_CutBlockA' });
        break;
      case 'sh_quarry_derrick':
        out.push({ ...at, piece: 'Kit_Derrick' });
        break;
      case 'sh_slab_frame':
        out.push({ ...at, piece: 'Kit_SlabFrame' });
        break;
      case 'sh_fallen_block':
        out.push({ ...at, piece: i % 2 ? 'Kit_FallenBlockB' : 'Kit_FallenBlockA' });
        break;
    }
  }
  return out;
}

/** The point on the lower Gallery under the collapse spot's overhang: the
 *  path's south-east rim, half way along `gallery_lower`, and the yaw that
 *  turns the overhang's front (local +Z) over the path. */
export function collapseSpot(): { x: number; z: number; y: number; rot: number } {
  const a = { x: -92, z: -228 };
  const b = { x: -70, z: -209 };
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const ux = (b.x - a.x) / len;
  const uz = (b.z - a.z) / len;
  // The rim on the south-east side, a yard past the path's half width.
  const nx = uz;
  const nz = -ux;
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  const y = authoredFieldHeight(SMITH_HEART_FIELD, mx, mz);
  return { x: mx + nx * 8, z: mz + nz * 8, y, rot: Math.atan2(-nx, -nz) };
}

/** The render-only dressing of the vein. */
export function planHammerDressing(): HeartKitPlacement[] {
  const F = SMITH_HEART_FIELD;
  const out: HeartKitPlacement[] = [];
  const colossi = colossusSpots();
  const props = F.props.filter((p) => HAMMER_KIT_KINDS.has(p.kind));
  const clear = (x: number, z: number, r: number): boolean =>
    colossi.every((c) => Math.hypot(x - c.x, z - c.z) > HAMMER_KIT_SIZES.colossusReach + r) &&
    props.every((p) => Math.hypot(x - p.x, z - p.z) > (p.r ?? 3) + r + 1);
  // A scaffold against the Vigil's right side, on the terrace.
  const vigil = colossi[0];
  if (vigil) {
    const p = local(vigil, -15.5, 1.5);
    out.push({
      piece: 'Kit_Scaffold',
      x: p.x,
      z: p.z,
      y: authoredFieldHeight(F, p.x, p.z),
      rot: vigil.rot,
    });
  }
  // Spoil heaps on the terraces, mid-band, away from the colossi and props.
  for (let i = 1; i < QUARRY_TERRACES.steps.length; i++) {
    const out0 = QUARRY_TERRACES.steps[i - 1].out;
    const out1 = QUARRY_TERRACES.steps[i].out;
    for (let k = 0; k < 6; k++) {
      const deg = QUARRY_TERRACES.fromDeg + 12 + ((k * 29 + i * 11) % 156);
      const o = (out0 + out1) / 2;
      const a = (deg * Math.PI) / 180;
      const x = HAMMER_PIT.x + Math.sin(a) * (HAMMER_PIT.rx + o);
      const z = HAMMER_PIT.z + Math.cos(a) * (HAMMER_PIT.rz + o);
      if (!isQuarryStep(authoredFieldSurfaceAt(F, x, z)?.id) || !clear(x, z, 3)) continue;
      out.push({
        piece: 'Kit_RubblePile',
        x,
        z,
        y: authoredFieldHeight(F, x, z),
        rot: heartHash(i, k) * Math.PI * 2,
        scale: 0.8 + heartHash(k, i + 7) * 0.5,
        noShadow: true,
        cosmetic: true,
      });
    }
  }
  // The great cliffs on the top step (render only, far dressing: shed on the
  // low tier, no shadow).
  const top = QUARRY_TERRACES.steps[QUARRY_TERRACES.steps.length - 1];
  for (const c of HAMMER_CROWN) {
    const a = (c.deg * Math.PI) / 180;
    const x = HAMMER_PIT.x + Math.sin(a) * (HAMMER_PIT.rx + HAMMER_KIT_SIZES.crownOut);
    const z = HAMMER_PIT.z + Math.cos(a) * (HAMMER_PIT.rz + HAMMER_KIT_SIZES.crownOut);
    out.push({
      piece: c.piece,
      x,
      z,
      y: top.h,
      rot: Math.atan2(HAMMER_PIT.x - x, HAMMER_PIT.z - z),
      scale: c.scale,
      noShadow: true,
      cosmetic: true,
    });
  }
  // Cracks in the pit's bedrock floor (flat inlays under the telegraphs'
  // lift), clear of the columns' sockets.
  const columns = F.props.filter((p) => p.kind === 'sh_pit_column');
  for (let k = 0, placed = 0; k < 40 && placed < 12; k++) {
    const a = heartHash(k, 61) * Math.PI * 2;
    const r = 0.15 + heartHash(k, 67) * 0.75;
    const x = HAMMER_PIT.x + Math.sin(a) * HAMMER_PIT.rx * r;
    const z = HAMMER_PIT.z + Math.cos(a) * HAMMER_PIT.rz * r;
    if (authoredFieldSurfaceAt(F, x, z)?.id !== 'hammer_pit') continue;
    if (columns.some((c) => Math.hypot(c.x - x, c.z - z) < 9)) continue;
    out.push({
      piece: k % 3 === 0 ? 'Kit_FloorCrackB' : 'Kit_FloorCrackA',
      x,
      z,
      y: authoredFieldHeight(F, x, z) + 0.01,
      rot: heartHash(k, 71) * Math.PI * 2,
      noShadow: true,
      cosmetic: true,
    });
    placed++;
  }
  // Chips round the columns and on the Gallery's landings (flat).
  const chipAt = (x: number, z: number, seed: number) => {
    out.push({
      piece: 'Kit_ChipScatter',
      x,
      z,
      y: authoredFieldHeight(F, x, z) + 0.02,
      rot: heartHash(seed, 3) * Math.PI * 2,
      noShadow: true,
      cosmetic: true,
    });
  };
  F.props
    .filter((p) => p.kind === 'sh_pit_column')
    .forEach((p, i) => {
      const a = heartHash(i, 41) * Math.PI * 2;
      chipAt(p.x + Math.sin(a) * 5, p.z + Math.cos(a) * 5, i);
    });
  Object.values(GALLERY_LANDINGS).forEach((l, i) => {
    const a = heartHash(i, 43) * Math.PI * 2;
    chipAt(l.x + Math.sin(a) * 6, l.z + Math.cos(a) * 6, 10 + i);
  });
  // Chain hoists hung off the Gallery's lips, a few yards down the face.
  const edges = planHammerEdges().filter(
    (e) => e.piece.startsWith('Kit_QuarryLip') && /^gallery_|^cleft$/.test(surfaceOf(e) ?? ''),
  );
  edges.forEach((e, i) => {
    if (i % 4 !== 1) return;
    out.push({
      piece: 'Kit_ChainHoist',
      x: e.x + Math.sin(e.rot) * 1.4,
      z: e.z + Math.cos(e.rot) * 1.4,
      y: e.y - 3.5,
      rot: e.rot,
      noShadow: true,
      // Hung off a lip module: shed with it on the low tier.
      cosmetic: true,
    });
  });
  // The collapse spot: the overhang over the lower Gallery.
  const c = collapseSpot();
  out.push({ piece: 'Kit_CollapseOverhang', ...c, noShadow: false });
  // The lookouts at the Balcony's sides, bowls toward the heart.
  for (const s of [-1, 1]) {
    out.push({
      piece: 'Kit_LookoutStatue',
      x: s * (BALCONY.x1 + 3.6),
      z: (BALCONY.z0 + BALCONY.z1) / 2 - 8,
      y: BALCONY.h - 0.2,
      rot: 0,
    });
  }
  return out;
}

/** The floor a placed edge piece stands on (its high side). */
function surfaceOf(e: FieldEdgePiece): string | undefined {
  return authoredFieldSurfaceAt(
    SMITH_HEART_FIELD,
    e.x - Math.sin(e.rot) * 0.8,
    e.z - Math.cos(e.rot) * 0.8,
  )?.id;
}

/** The whole plan: the props, the edges, the dressing and the Gallery's
 *  walk (phase 2E: its kerb and chain rail, hammer_walk_plan_core.ts). */
export function planHammerKit(): HeartKitPlacement[] {
  // The void lips are the rock kit's now (phase 2E, heart_rock_plan_core.ts
  // planHeartLips): a quarried lip's worked face stood on the lip line, inside
  // the field's own rock flaring out under it, and never read. The planner
  // still places them: the hoists hang where they were.
  const edges: HeartKitPlacement[] = planHammerEdges()
    .filter((e) => !e.piece.startsWith('Kit_QuarryLip'))
    .map((e) => ({
      piece: e.piece,
      x: e.x,
      y: e.y,
      z: e.z,
      rot: e.rot,
      stretch: e.stretch,
      shear: e.shear,
      noShadow: true,
      // The low tier keeps the pit's own rim (the arena's edge) and sheds the
      // far dressing: the terraces' risers and the void lips fall back to the
      // field's own rock faces.
      cosmetic: !e.piece.startsWith('Kit_QuarryRim'),
    }));
  return [...planHammerProps(), ...edges, ...planHammerDressing(), ...planHammerWalk()];
}
