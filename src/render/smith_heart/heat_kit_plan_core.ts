// Pure plan of the Heat vein's Blender kit (phase 2I: docs/design/raid/kit/
// build_smith_heart_heat_kit.py, painted by heat_kit.ts): where every Kit_*
// piece of the Heat stands, from its mouth on the Ring to the Hearth.
//
// The Heat is no forge (the owner's decision, phase 2I): it is the Hearth,
// the Smith's first flame in its crystal and its dark basalt. Every layout
// id, collider and spot the sim uses keeps its place; only its look changes:
//   - the great hearth (`sh_great_hearth`) is the Hearth's mouth, a vast
//     natural mouth in the mountain framed by radiating basalt columns, full
//     of the first flame's crystal; the giant anvil (`sh_giant_anvil`) is a
//     great altar-stone of fire-veined basalt on its footprint; the pour
//     crucible (`sh_pour_crucible`) is a cracked wellspring brimming with
//     white-gold fire at the Pour Channel's head; the crucibles
//     (`sh_crucible`) are clusters of fire crystal; the bellows
//     (`sh_great_bellows`) ember boulders split by a seam of fire; the
//     casting channels (`sh_casting_channel`) seams of fire in the floor;
//   - the Pour Channel is a carved channel in the casting floor (flat: its
//     bed under every telegraph, its kerbs a hand high), its spill a notch
//     in the floor's south lip the fire pours through;
//   - the anvil bridge stands on a natural arch of basalt (the field then
//     draws only a shallow keel under its deck, `HEAT_KIT_SHALLOW`);
//   - bundles of basalt columns rise out of the chasm at the Forge's
//     corners (the hall's sides as carved mountain), past its lips;
//   - low walls of basalt columns stand along every Heat lip over the void
//     (the shared lip planner's modules, never over a walk), seams of fire
//     lie flat in the floors and drifts of ash banked at the walls' feet.
//
// Nothing render-only stands over a walked floor beyond a hand, and every
// solid a body can touch stands on a layout collider. Three-free, DOM-free,
// deterministic (a hash, never rng).

import {
  GREAT_HEARTH,
  HEAT,
  POUR_CHANNEL,
  SMITH_HEART_FIELD,
} from '../../sim/content/smith_heart_layout';
import { authoredFieldHeight, authoredFieldSurfaceAt } from '../../sim/instances/authored_field';
import type { FieldSurface } from '../../sim/instances/authored_field/types';
import type { HeartKitPlacement } from './heart_kit_core';
import { heartHash, heartPropBase } from './heart_plan_core';
import { lipWallClear, planLipWalls } from './lip_walls_core';

/** The layout prop kinds the kit draws in place of their placeholders. */
export const HEAT_KIT_KINDS: ReadonlySet<string> = new Set([
  'sh_crucible',
  'sh_pour_crucible',
  'sh_great_hearth',
  'sh_great_bellows',
  'sh_giant_anvil',
  'sh_casting_channel',
]);

/** Every walked floor of the Heat (their lips over the void take the low
 *  walls). */
export const HEAT_WALK_SURFACES: ReadonlySet<string> = new Set([
  'forge_hall',
  'casting_floor',
  'anvil_bridge',
  'smiths_forge',
]);

/** The flat Heat floors ash banks on and its seams of fire lie in. */
export const HEAT_DRESS_FLOORS: ReadonlySet<string> = new Set([
  'forge_hall',
  'casting_floor',
  'smiths_forge',
]);

/** The floors whose drop the kit's own rock draws (the bridge's arch): once
 *  the kit has landed the field draws only a shallow keel under them, and
 *  the mountain's hanging lips leave them alone. */
export const HEAT_KIT_SHALLOW: ReadonlySet<string> = new Set(['anvil_bridge']);

/** A wall module's half length at stretch 1, and its span out past the lip
 *  (yards, pinned against the GLB). */
export const HEAT_WALL = { half: 3, near: 0.05, far: 1.0, height: 1.05 } as const;
/** A wall module's length along a lip (yards: its own, so its columns are
 *  never squeezed into a fence). */
export const HEAT_WALL_MODULE = 6;

/** Where the wellspring's fire brims over its foot (the kit's WELL['fire'],
 *  heat_pieces.py), pinned against the GLB. */
export const HEAT_WELL_FIRE = 2.22;
/** How far in front of the wellspring's centre its chute meets the floor
 *  (the Pour Channel's head), toward its front. */
export const HEAT_WELL_FRONT = 3.6;

/** The Pour Channel's module (yards: its half length at stretch 1). */
export const HEAT_CHANNEL_HALF = 3;

/** The anvil bridge's frame: its east end on its axis, the deck along +X
 *  (the kit's BRIDGE, heat_pieces.py). */
export const HEAT_BRIDGE = { run: 18, half: 7, span0: 3.6, span1: 14.4 } as const;

/** The Forge's corner pillars: how far out past each corner along its
 *  bisector, and the bundle's reach (the kit's PILLAR and the crystal
 *  breaking out of its side). */
export const HEAT_PILLAR = { out: 4.2, r: 3.5 } as const;

/** The Hearth's mouth's reach toward the Forge from its origin (the kit's
 *  MOUTH['face'] and its crystal, past which nothing of it stands). */
export const HEAT_HEARTH_FACE = 7;

const F = SMITH_HEART_FIELD;

function surface(id: string): FieldSurface {
  const s = F.surfaces.find((q) => q.id === id);
  if (!s) throw new Error(`no surface ${id}`);
  return s;
}

/** The pour's wellspring (the layout's `sh_pour_crucible`). */
export function heatWellspring(): { x: number; z: number; rot: number } {
  const p = F.props.find((q) => q.kind === 'sh_pour_crucible');
  if (!p) throw new Error('no pour crucible');
  return { x: p.x, z: p.z, rot: p.rot };
}

/** The Pour Channel's run: from the wellspring's chute down to the casting
 *  floor's south lip (instance-local z, the channel's axis at POUR_CHANNEL.x). */
export function heatChannelRun(): { x: number; z0: number; z1: number } {
  const w = heatWellspring();
  return { x: POUR_CHANNEL.x, z0: HEAT.floor.z0, z1: w.z - HEAT_WELL_FRONT };
}

/** The layout's props fitted with their pieces: the Hearth's mouth, the
 *  altar-stone, the wellspring, the crystal clusters, the ember boulders,
 *  and the casting channels' seams of fire. */
export function planHeatProps(): HeartKitPlacement[] {
  const out: HeartKitPlacement[] = [];
  let crystal = 0;
  for (const p of F.props) {
    if (!HEAT_KIT_KINDS.has(p.kind)) continue;
    const y = heartPropBase(p.x, p.z);
    if (p.kind === 'sh_great_hearth') {
      // Its front (local +Z) to the Forge; no shadow (the key comes from
      // behind it: its mass would darken the whole arena).
      out.push({ piece: 'Kit_HearthMouth', x: p.x, y, z: p.z, rot: p.rot, noShadow: true });
    } else if (p.kind === 'sh_giant_anvil') {
      out.push({ piece: 'Kit_AltarStone', x: p.x, y, z: p.z, rot: p.rot });
    } else if (p.kind === 'sh_pour_crucible') {
      out.push({ piece: 'Kit_Wellspring', x: p.x, y, z: p.z, rot: p.rot });
    } else if (p.kind === 'sh_great_bellows') {
      out.push({ piece: 'Kit_EmberBoulder', x: p.x, y, z: p.z, rot: p.rot });
    } else if (p.kind === 'sh_crucible') {
      const spin = heartHash(Math.round(p.x * 7), Math.round(p.z * 7)) * Math.PI * 2;
      out.push({
        piece: crystal++ % 2 ? 'Kit_FireCrystalB' : 'Kit_FireCrystalA',
        x: p.x,
        y,
        z: p.z,
        rot: spin,
      });
    } else {
      // A casting channel (a strip along its local +Z, 64 long): seams of
      // fire laid along it end to end, each wandering off the line a little.
      const ux = Math.sin(p.rot);
      const uz = Math.cos(p.rot);
      for (let k = 0; k < 5; k++) {
        const along = -26 + k * 13 + (heartHash(k, Math.round(p.z)) - 0.5) * 3;
        const x = p.x + ux * along;
        const z = p.z + uz * along;
        if (!HEAT_DRESS_FLOORS.has(authoredFieldSurfaceAt(F, x, z)?.id ?? '')) continue;
        out.push({
          piece: k % 2 ? 'Kit_FireCrackB' : 'Kit_FireCrackA',
          x,
          y: authoredFieldHeight(F, x, z) + 0.012,
          z,
          // Local +X along the strip.
          rot: Math.atan2(-uz, ux) + (heartHash(k, 59) - 0.5) * 0.3,
          noShadow: true,
          cosmetic: true,
        });
      }
    }
  }
  return out;
}

/** The Pour Channel's modules down the casting floor, and its spill at the
 *  floor's south lip. */
export function planHeatChannel(): HeartKitPlacement[] {
  const run = heatChannelRun();
  const len = run.z1 - run.z0;
  const pieces = Math.max(1, Math.round(len / (HEAT_CHANNEL_HALF * 2)));
  const step = len / pieces;
  const out: HeartKitPlacement[] = [];
  for (let k = 0; k < pieces; k++) {
    const z = run.z1 - (k + 0.5) * step;
    out.push({
      piece: 'Kit_PourChannel',
      x: run.x,
      y: authoredFieldHeight(F, run.x, z) + 0.002,
      z,
      // Local +X down the channel (toward -z).
      rot: Math.PI / 2,
      stretch: step / (HEAT_CHANNEL_HALF * 2),
      noShadow: true,
    });
  }
  out.push({
    piece: 'Kit_PourSpill',
    x: run.x,
    y: authoredFieldHeight(F, run.x, run.z0 + 0.5),
    z: run.z0,
    // Its drop (local +Z) toward the south.
    rot: Math.PI,
    noShadow: true,
  });
  return out;
}

/** The Forge's corners the column bundles rise at (every corner but the two
 *  the Hearth's mouth frames), each `HEAT_PILLAR.out` past it on the
 *  corner's outward bisector. */
export function planHeatPillars(): HeartKitPlacement[] {
  const s = surface('smiths_forge');
  if (s.kind !== 'poly') return [];
  const pts = s.points;
  const out: HeartKitPlacement[] = [];
  // The outline's winding (the sign of its area), so an edge's outward
  // normal points out of the floor.
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i];
    const [cx, cz] = pts[(i + 1) % pts.length];
    area += ax * cz - cx * az;
  }
  const wind = area > 0 ? 1 : -1;
  const outward = (ax: number, az: number, cx: number, cz: number) => {
    const dx = cx - ax;
    const dz = cz - az;
    const l = Math.hypot(dx, dz) || 1;
    return [(-dz / l) * -wind, (dx / l) * -wind] as const;
  };
  for (let i = 0; i < pts.length; i++) {
    const [x, z] = pts[i];
    if (x <= GREAT_HEARTH.x + 9 && Math.abs(z) <= GREAT_HEARTH.halfWidth) continue;
    const [px, pz] = pts[(i + pts.length - 1) % pts.length];
    const [nx, nz] = pts[(i + 1) % pts.length];
    // The corner's outward bisector: the mean of its two edges' outward
    // normals.
    const a = outward(px, pz, x, z);
    const b = outward(x, z, nx, nz);
    let bx = a[0] + b[0];
    let bz = a[1] + b[1];
    const bl = Math.hypot(bx, bz) || 1;
    bx /= bl;
    bz /= bl;
    const cx = x + bx * HEAT_PILLAR.out;
    const cz = z + bz * HEAT_PILLAR.out;
    out.push({
      piece: 'Kit_HearthPillar',
      x: cx,
      y: authoredFieldHeight(F, x - bx * 0.5, z - bz * 0.5),
      z: cz,
      rot: heartHash(i, 83) * Math.PI * 2,
      scale: 0.92 + heartHash(i, 89) * 0.16,
    });
  }
  return out;
}

/** The anvil bridge's arch. */
export function planHeatBridge(): HeartKitPlacement[] {
  const b = surface('anvil_bridge');
  if (b.kind !== 'path') return [];
  const [ax, az, ah] = b.points[0];
  const [bx, bz] = b.points[b.points.length - 1];
  // Local +X along the bridge: (cos rot, -sin rot) toward its far end.
  const rot = Math.atan2(-(bz - az), bx - ax);
  return [{ piece: 'Kit_HeatBridge', x: ax, y: ah, z: az, rot }];
}

/** Is (x, z) near the Pour Channel's spill or the Hearth's mouth, where no
 *  wall stands (the fire pours through the one, the mouth frames the other)? */
function wallBarred(x: number, z: number): boolean {
  const run = heatChannelRun();
  if (Math.abs(x - run.x) < 5.5 && Math.abs(z - run.z0) < 3) return true;
  if (x < GREAT_HEARTH.x + 10 && Math.abs(z) < GREAT_HEARTH.halfWidth + 3) return true;
  return planHeatPillars().some((p) => Math.hypot(p.x - x, p.z - z) < HEAT_PILLAR.r + 1.5);
}

/** The walls along every Heat walk's lip over the void. */
export function planHeatWalls(): HeartKitPlacement[] {
  return planLipWalls({
    surfaces: HEAT_WALK_SURFACES,
    pieceA: 'Kit_HeatWallA',
    pieceB: 'Kit_HeatWallB',
    bShare: 0.25,
    module: HEAT_WALL_MODULE,
    half: HEAT_WALL.half,
    far: HEAT_WALL.far,
  }).filter((w) => !wallBarred(w.x, w.z));
}

/** Does a Heat wall module stand wholly over the drop? */
export function heatWallClear(x: number, z: number, rot: number, stretch: number): boolean {
  return lipWallClear(x, z, rot, stretch, HEAT_WALL.half, HEAT_WALL.far);
}

/** The seams of fire scattered over the floors (flat inlays every telegraph
 *  draws over; never across the Pour Channel or the gate), and drifts of
 *  ash banked against the low walls on the flat floors. */
export function planHeatDressing(): HeartKitPlacement[] {
  const out: HeartKitPlacement[] = [];
  const run = heatChannelRun();
  const spots: { x: number; z: number; piece: string }[] = [
    // The hall, from the Ring's side in.
    { x: -84, z: 6, piece: 'Kit_FireCrackB' },
    { x: -96, z: -7, piece: 'Kit_FireCrackA' },
    { x: -116, z: 5, piece: 'Kit_FireCrackA' },
    // The casting floor, either side of the channel.
    { x: -134, z: 26, piece: 'Kit_FireCrackA' },
    { x: -138, z: -12, piece: 'Kit_FireCrackB' },
    { x: -160, z: 22, piece: 'Kit_FireCrackB' },
    { x: -158, z: -26, piece: 'Kit_FireCrackA' },
    // The Forge, round its floor (the casting channels' seams are props).
    { x: -190, z: 28, piece: 'Kit_FireCrackB' },
    { x: -190, z: -28, piece: 'Kit_FireCrackA' },
    { x: -214, z: 34, piece: 'Kit_FireCrackA' },
    { x: -214, z: -34, piece: 'Kit_FireCrackB' },
    { x: -244, z: 22, piece: 'Kit_FireCrackB' },
    { x: -244, z: -22, piece: 'Kit_FireCrackA' },
  ];
  for (const [i, s] of spots.entries()) {
    const id = authoredFieldSurfaceAt(F, s.x, s.z)?.id ?? '';
    if (!HEAT_DRESS_FLOORS.has(id)) continue;
    // Never across the channel (its seam reaches 6 yd from its middle).
    if (Math.abs(s.x - run.x) < 9 && s.z > run.z0 && s.z < run.z1 + 4) continue;
    out.push({
      piece: s.piece,
      x: s.x,
      y: authoredFieldHeight(F, s.x, s.z) + 0.012,
      z: s.z,
      rot: heartHash(i, 71) * Math.PI * 2,
      noShadow: true,
      cosmetic: true,
    });
  }
  // Drifts of ash banked against the low walls on the flat floors (a yard
  // in from the wall, along it).
  for (const [i, w] of planHeatWalls().entries()) {
    if (heartHash(i, 23) > 0.42) continue;
    const x = w.x - Math.sin(w.rot) * 1.3;
    const z = w.z - Math.cos(w.rot) * 1.3;
    const id = authoredFieldSurfaceAt(F, x, z)?.id ?? '';
    if (!HEAT_DRESS_FLOORS.has(id)) continue;
    if (Math.abs(x - run.x) < 6) continue;
    out.push({
      piece: heartHash(i, 29) < 0.7 ? 'Kit_AshDriftA' : 'Kit_AshDriftB',
      x,
      y: authoredFieldHeight(F, x, z) + 0.01,
      z,
      rot: w.rot + (heartHash(i, 31) - 0.5) * 0.2,
      scale: 0.65 + heartHash(i, 37) * 0.4,
      noShadow: true,
      cosmetic: true,
    });
  }
  return out;
}

/** The whole Heat kit's dressing. */
export function planHeatKit(): HeartKitPlacement[] {
  return [
    ...planHeatProps(),
    ...planHeatChannel(),
    ...planHeatPillars(),
    ...planHeatBridge(),
    ...planHeatWalls(),
    ...planHeatDressing(),
  ];
}
