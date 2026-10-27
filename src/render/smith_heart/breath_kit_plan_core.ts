// Pure plan of the Breath vein's Blender kit (phase 2G: docs/design/raid/kit/
// build_smith_heart_breath_kit.py, painted by breath_kit.ts): where every
// Kit_* piece of the Breath stands, from its mouth up to the Storm Cornice.
//
//   - the Cornice's lightning rods (a strike's scar of fused glass at each
//     foot), its two great stone wind-horns (their bells open to the rim),
//     and the wind bridge's shelters, on the layout's props and colliders;
//   - the Wind Bridge's natural arch under its ramp (the field then draws
//     only a shallow keel under the deck, `BREATH_KIT_SHALLOW`);
//   - the low walls along every Breath walk over the void (the shared lip
//     planner's modules, lip_walls_core.ts: past the lip over the drop, never
//     over a walk);
//   - each wind channel (the notches in the Cornice's rim) flanked by two
//     cheek stones past its mouth's corners, the groove the Smith cut leading
//     the updraft in from it across the floor;
//   - wind-carved standing stones past the landings' rims, and the cracked
//     plateau's fissures (flat inlays every telegraph draws over).
//
// Nothing render-only stands over a walked floor beyond a hand: the inlays
// are flat, the walls, the jambs and the stones stand past the lips, and
// every solid a body can touch stands on a layout collider. Three-free,
// DOM-free, deterministic (a hash, never rng).

import {
  BREATH,
  CORNICE_CHANNELS,
  SMITH_HEART_FIELD,
  WIND_BRIDGE,
} from '../../sim/content/smith_heart_layout';
import {
  authoredFieldCliffRuns,
  authoredFieldHeight,
  authoredFieldSurfaceAt,
} from '../../sim/instances/authored_field';
import type { HeartKitPlacement } from './heart_kit_core';
import { heartHash, heartPropBase } from './heart_plan_core';
import { lipWallClear, planLipWalls } from './lip_walls_core';

/** The layout prop kinds the kit draws in place of their placeholders. */
export const BREATH_KIT_KINDS: ReadonlySet<string> = new Set([
  'sh_lightning_rod',
  'sh_broken_bellows',
  'sh_wind_shelter',
  'sh_channel_jamb',
  'sh_storm_stone',
]);

/** Every walked floor of the Breath (their lips over the void take the
 *  low walls). */
export const BREATH_WALK_SURFACES: ReadonlySet<string> = new Set([
  'breath_mouth',
  'breath_b1',
  'breath_chimney',
  'breath_b2',
  'wind_bridge',
  'breath_b3',
  'cornice_climb',
  'storm_cornice',
]);

/** The floors whose drop the kit's own rock draws (the Wind Bridge's arch):
 *  once the kit has landed the field draws only a shallow keel under them,
 *  and the mountain's hanging lips leave them alone. */
export const BREATH_KIT_SHALLOW: ReadonlySet<string> = new Set(['wind_bridge']);
/** How deep the field's keel runs under a shallow floor (yards). */
export const BREATH_KIT_KEEL = 3;

/** A wall module's half length at stretch 1, and its span out past the lip
 *  (yards, pinned against the GLB). */
export const BREATH_WALL = { half: 3, near: 0.05, far: 1.0, height: 0.95 } as const;

/** The measures of the Wind Bridge (its ramp's run along +X of the arch). */
export function windBridgeFrame(): { x: number; z: number; rot: number; run: number } {
  const dx = WIND_BRIDGE.toX - WIND_BRIDGE.fromX;
  const dz = WIND_BRIDGE.toZ - WIND_BRIDGE.fromZ;
  const run = Math.hypot(dx, dz);
  // Local +X (cos rot, -sin rot) along the ramp.
  return { x: WIND_BRIDGE.fromX, z: WIND_BRIDGE.fromZ, rot: Math.atan2(-dz, dx), run };
}

const F = SMITH_HEART_FIELD;

/** The point at compass `deg` on the Cornice's rim ellipse, `inset` yards in. */
function corniceAt(deg: number, inset: number): { x: number; z: number } {
  const C = BREATH.cornice;
  const a = (deg * Math.PI) / 180;
  return { x: C.x + Math.sin(a) * (C.rx - inset), z: C.z + Math.cos(a) * (C.rz - inset) };
}

/** The channel nearest (x, z) on the Cornice: the stone's compass bearing
 *  and which side of the channel's line it stands (+1: the channel lies
 *  clockwise of it). */
function nearestChannel(x: number, z: number): { at: number; side: number } {
  const C = BREATH.cornice;
  const at = ((((Math.atan2(x - C.x, z - C.z) * 180) / Math.PI) % 360) + 360) % 360;
  let best = CORNICE_CHANNELS[0];
  let off = 999;
  for (const ch of CORNICE_CHANNELS) {
    let d = ch.deg - at;
    d = ((d + 540) % 360) - 180;
    if (Math.abs(d) < Math.abs(off)) {
      off = d;
      best = ch;
    }
  }
  return { at: best.deg - off, side: off > 0 ? 1 : -1 };
}

function nearestLanding(x: number, z: number): { x: number; z: number } {
  let best: { x: number; z: number } = BREATH.b1;
  for (const c of [BREATH.b1, BREATH.b2, BREATH.b3])
    if (Math.hypot(x - c.x, z - c.z) < Math.hypot(x - best.x, z - best.z)) best = c;
  return best;
}

/** The layout's props fitted with their pieces: the rods (and their
 *  scars), the horns (each bell turned to the rim) and the shelters. */
export function planBreathProps(): HeartKitPlacement[] {
  const out: HeartKitPlacement[] = [];
  const C = BREATH.cornice;
  for (const p of F.props) {
    if (!BREATH_KIT_KINDS.has(p.kind)) continue;
    const y = heartPropBase(p.x, p.z);
    if (p.kind === 'sh_lightning_rod') {
      // The fork's opening (local X) across the bearing: the crown's
      // crystal faces the Cornice's middle.
      const rot = Math.atan2(C.x - p.x, C.z - p.z);
      out.push({ piece: 'Kit_StormRod', x: p.x, y, z: p.z, rot });
      out.push({
        piece: 'Kit_StrikeScar',
        x: p.x,
        y: y + 0.02,
        z: p.z,
        rot: heartHash(Math.round(p.x), Math.round(p.z)) * Math.PI * 2,
        noShadow: true,
        cosmetic: true,
      });
    } else if (p.kind === 'sh_broken_bellows') {
      // The collider box is symmetric: turn the bell (local +Z) to whichever
      // end faces out to the rim.
      const ox = p.x - C.x;
      const oz = p.z - C.z;
      const facesOut = Math.sin(p.rot) * ox + Math.cos(p.rot) * oz > 0;
      out.push({
        piece: 'Kit_WindHorn',
        x: p.x,
        y,
        z: p.z,
        rot: facesOut ? p.rot : p.rot + Math.PI,
      });
    } else if (p.kind === 'sh_channel_jamb') {
      // The blade leans (local +X) out over its channel's line.
      const ch = nearestChannel(p.x, p.z);
      const a = (ch.at * Math.PI) / 180;
      out.push({ piece: 'Kit_ChannelJamb', x: p.x, y, z: p.z, rot: ch.side > 0 ? a : a + Math.PI });
    } else if (p.kind === 'sh_storm_stone') {
      // Its scalloped windward face (local +Z) out to the gale past the rim.
      const c = nearestLanding(p.x, p.z);
      out.push({
        piece: 'Kit_StormStone',
        x: p.x,
        y,
        z: p.z,
        rot: Math.atan2(p.x - c.x, p.z - c.z),
      });
    } else {
      out.push({ piece: 'Kit_WindShelter', x: p.x, y, z: p.z, rot: p.rot });
    }
  }
  const b = windBridgeFrame();
  out.push({ piece: 'Kit_WindBridge', x: b.x, y: BREATH.b2.h, z: b.z, rot: b.rot, noShadow: true });
  return out;
}

/** A wall module's length along a lip (yards): short enough that its chord
 *  hugs a landing's curve (the walls bend round it a module at a time). */
export const BREATH_WALL_MODULE = 4;

/** The low walls along every Breath walk's lip over the void (the shared
 *  lip planner: lip_walls_core.ts). */
export function planBreathWalls(): HeartKitPlacement[] {
  return planLipWalls({
    surfaces: BREATH_WALK_SURFACES,
    pieceA: 'Kit_BreathWallA',
    pieceB: 'Kit_BreathWallB',
    bShare: 0.22,
    module: BREATH_WALL_MODULE,
    half: BREATH_WALL.half,
    far: BREATH_WALL.far,
  });
}

/** Does a wall module at (x, z) turned by `rot` stand wholly over the drop
 *  (none where the lip bends onto another floor)? */
export function wallClear(x: number, z: number, rot: number, stretch: number): boolean {
  return lipWallClear(x, z, rot, stretch, BREATH_WALL.half, BREATH_WALL.far);
}

/** Each wind channel's groove, cut in the Cornice's floor to lead the
 *  updraft in from its notch (its cheek stones are layout props). */
export function planBreathChannels(): HeartKitPlacement[] {
  const C = BREATH.cornice;
  return CORNICE_CHANNELS.map((ch) => {
    // The groove's notch end (local +Z) toward the rim.
    const tip = corniceAt(ch.deg, ch.depth + 7);
    return {
      piece: 'Kit_WindGroove',
      x: tip.x,
      y: C.h + 0.015,
      z: tip.z,
      rot: (ch.deg * Math.PI) / 180,
      noShadow: true,
      cosmetic: true,
    };
  });
}

/** The cracked plateau's fissures, flat on the Cornice's floor (more
 *  toward its rim) and a star on each landing. */
export function planBreathDressing(): HeartKitPlacement[] {
  const out: HeartKitPlacement[] = [];
  // The cracked plateau: long fissures and stars on the Cornice's floor,
  // more toward its rim, a few on the landings.
  const cracks: { x: number; z: number; piece: string }[] = [];
  for (let k = 0; k < 16; k++) {
    const deg = k * 22.5 + heartHash(k, 71) * 14;
    const inset = 8 + heartHash(k, 73) * 26;
    const p = corniceAt(deg, inset);
    cracks.push({ ...p, piece: k % 3 === 2 ? 'Kit_PlateauCrackB' : 'Kit_PlateauCrackA' });
  }
  for (const c of [BREATH.b1, BREATH.b2, BREATH.b3])
    cracks.push({ x: c.x + 2, z: c.z - 3, piece: 'Kit_PlateauCrackB' });
  for (const [i, c] of cracks.entries()) {
    const s = authoredFieldSurfaceAt(F, c.x, c.z);
    if (!s || !BREATH_WALK_SURFACES.has(s.id)) continue;
    out.push({
      piece: c.piece,
      x: c.x,
      y: authoredFieldHeight(F, c.x, c.z) + 0.012,
      z: c.z,
      rot: heartHash(i, 79) * Math.PI * 2,
      noShadow: true,
      cosmetic: true,
    });
  }
  return out;
}

/** Where the Cornice's rim wall breaks at its gaps (the field's
 *  lipOpenings: the open lip runs): each end of an open stretch, with its
 *  outward normal and the direction along the lip away from the gap. */
export function breathGapEnds(): {
  x: number;
  z: number;
  nx: number;
  nz: number;
  ux: number;
  uz: number;
}[] {
  const open = authoredFieldCliffRuns(F).filter((r) => r.open);
  const ends: { x: number; z: number; nx: number; nz: number; ux: number; uz: number }[] = [];
  const touches = (x: number, z: number, self: number) =>
    open.some(
      (r, i) =>
        i !== self &&
        (Math.hypot(r.ax - x, r.az - z) < 0.05 || Math.hypot(r.bx - x, r.bz - z) < 0.05),
    );
  open.forEach((r, i) => {
    const len = Math.hypot(r.bx - r.ax, r.bz - r.az) || 1;
    const ux = (r.bx - r.ax) / len;
    const uz = (r.bz - r.az) / len;
    if (!touches(r.ax, r.az, i))
      ends.push({ x: r.ax, z: r.az, nx: r.nx, nz: r.nz, ux: -ux, uz: -uz });
    if (!touches(r.bx, r.bz, i)) ends.push({ x: r.bx, z: r.bz, nx: r.nx, nz: r.nz, ux, uz });
  });
  return ends;
}

/** The gaps' broken coping: at each end of an open stretch a short broken
 *  stub of the rim wall (past the lip, over the drop, like the walls) and a
 *  tumbled coping block hanging over the lip's edge, and a couple of chips
 *  lying flat on the floor where the wall came down. Nothing solid stands
 *  over the open lip: the stubs and blocks are past it, the chips a hand
 *  high (cosmetic, shed on the low tier). */
export function planBreathGaps(): HeartKitPlacement[] {
  const out: HeartKitPlacement[] = [];
  const H = BREATH.cornice.h;
  breathGapEnds().forEach((e, i) => {
    const rot = Math.atan2(e.nx, e.nz);
    // The stub: a short module of the wall, just past the lip, beyond the
    // gap's end (along the lip away from the opening).
    out.push({
      piece: 'Kit_BreathWallB',
      x: e.x + e.nx * 0.5 + e.ux * 0.7,
      y: H,
      z: e.z + e.nz * 0.5 + e.uz * 0.7,
      rot,
      stretch: 0.32,
      shear: (heartHash(i, 401) - 0.5) * 0.5,
      noShadow: true,
    });
    // A coping block tumbled half over the edge, its outer end sunk.
    out.push({
      piece: 'Kit_BreathWallA',
      x: e.x + e.nx * 1.0 - e.ux * 0.9,
      y: H - 0.45,
      z: e.z + e.nz * 1.0 - e.uz * 0.9,
      rot: rot + (heartHash(i, 409) - 0.5) * 0.9,
      scale: 0.55,
      stretch: 0.5,
      shear: 0.35,
      noShadow: true,
      cosmetic: true,
    });
    // Chips on the floor inside the lip where the wall came down.
    for (let k = 0; k < 2; k++) {
      const a = heartHash(i * 7 + k, 419) * Math.PI * 2;
      const back = 1.2 + heartHash(i * 7 + k, 421) * 1.4;
      out.push({
        piece: 'Kit_StormStone',
        x: e.x - e.nx * back - e.ux * (0.6 + k),
        y: H - 0.05,
        z: e.z - e.nz * back - e.uz * (0.6 + k),
        rot: a,
        scale: 0.03 + heartHash(i * 7 + k, 431) * 0.02,
        noShadow: true,
        cosmetic: true,
      });
    }
  });
  return out;
}

/** The whole Breath kit's dressing. */
export function planBreathKit(): HeartKitPlacement[] {
  return [
    ...planBreathProps(),
    ...planBreathWalls(),
    ...planBreathChannels(),
    ...planBreathDressing(),
    ...planBreathGaps(),
  ];
}
