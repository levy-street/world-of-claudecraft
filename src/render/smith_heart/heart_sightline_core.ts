// The Smith's Heart's render-only solids as plain volumes, for the sightline
// pin: every piece of the mountain's rock kit and every walk's lip (turned
// boxes bounding them, heart_rock_plan_core.ts), every crag (a cylinder
// bounding it, lean included), every
// placeholder prop part (a cylinder bounding it, tilt included) and every
// gate part at a given openness (a turned box), all from the SAME plans the
// painters draw (heart_walls_core.ts, heart_plan_core.ts,
// heart_gates_core.ts). tests/smith_heart_render_core.test.ts casts the
// raid's key sightlines (the Ring and the Balcony to the seal, the Balcony
// to each causeway mouth) through them.
//
// Three-free, DOM-free, deterministic.

import { SMITH_HEART_GATES } from '../../sim/content/smith_heart';
import { SMITH_HEART_FIELD } from '../../sim/content/smith_heart_layout';
import { authoredFieldHeight } from '../../sim/instances/authored_field';
import { heartGatePartPose, heartGateParts, heartGateRig } from './heart_gates_core';
import { HEART_PROP_RECIPES, type HeartPart, heartPropBase } from './heart_plan_core';
import {
  HEART_ROCK_LIP,
  HEART_ROCK_NEEDLES,
  heartRockPieceOf,
  planHeartLips,
  planHeartNeedles,
  planHeartRock,
  planHeartUnderCliffs,
} from './heart_rock_plan_core';
import { heartWallReach, planHeartWalls } from './heart_walls_core';
import { planRingEdges, planRingMouths, ringSpireSpots } from './ring_kit_plan_core';

/** An upright cylinder (y0 to y1, radius r) or a box turned by `yaw` about
 *  its centre (three's rotation.y), half extents hw x hh x hd. */
export type HeartSolid =
  | { kind: 'cyl'; x: number; z: number; r: number; y0: number; y1: number; what: string }
  | {
      kind: 'box';
      x: number;
      y: number;
      z: number;
      hw: number;
      hh: number;
      hd: number;
      yaw: number;
      what: string;
    };

/** Every rock block as its bounding cylinder. */
export function heartWallSolids(spacing = 5): HeartSolid[] {
  return planHeartWalls(spacing).map((b) => ({
    kind: 'cyl',
    x: b.x,
    z: b.z,
    r: heartWallReach(b),
    y0: b.base,
    y1: b.top,
    what: `wall (${b.x.toFixed(1)}, ${b.z.toFixed(1)})`,
  }));
}

/** Every piece of the mountain's rock (phase 2E) as a turned box bounding
 *  it (its whole reach across, its body back from the front plane, foot to
 *  crest), and every lip module under a walk as a box from its brink down
 *  its drop, out over the void as far as its face leans. */
export function heartRockSolids(): HeartSolid[] {
  const out: HeartSolid[] = [];
  for (const p of [...planHeartRock(), ...planHeartUnderCliffs()]) {
    const m = heartRockPieceOf(p.piece);
    const k = p.scale ?? 1;
    const hh = (m.height * k * (p.rise ?? 1)) / 2;
    const back = (m.depth * k) / 2;
    out.push({
      kind: 'box',
      x: p.x - Math.sin(p.rot) * back,
      y: p.y + hh,
      z: p.z - Math.cos(p.rot) * back,
      hw: m.reach * k,
      hh,
      hd: back,
      yaw: p.rot,
      what: `rock ${p.piece} (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`,
    });
  }
  // The crest's needles: a box round each one's lower half and its spire.
  for (const p of planHeartNeedles()) {
    const m = HEART_ROCK_NEEDLES[p.piece];
    const k = p.scale ?? 1;
    for (const [z0, z1, w] of [
      [0, 0.45, 1],
      [0.45, 1, 0.45],
    ] as const) {
      const hh = ((z1 - z0) * m.height * k) / 2;
      out.push({
        kind: 'box',
        x: p.x,
        y: p.y + z0 * m.height * k + hh,
        z: p.z,
        hw: m.half * k * w,
        hh,
        hd: m.half * k * w,
        yaw: p.rot,
        what: `needle ${p.piece} (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`,
      });
    }
  }
  // A lip leans out as it falls: bound it in two lifts (the first ten yards
  // under the brink, then the rest), each out as far as its foot leans.
  const lifts: [number, number][] = [
    [0.12, 10],
    [10, HEART_ROCK_LIP.drop],
  ];
  // A lip on a stair is sheared up its slope: it is bounded in four boxes
  // along its run, each at the slope's height there.
  const parts = 4;
  for (const p of planHeartLips()) {
    const hw = (HEART_ROCK_LIP.half + 2.6) * (p.stretch ?? 1);
    const shear = p.shear ?? 0;
    const ux = Math.cos(p.rot);
    const uz = -Math.sin(p.rot);
    for (const [top, foot] of lifts) {
      const reach = HEART_ROCK_LIP.out * foot + 1;
      const hd = (reach + HEART_ROCK_LIP.depth + 0.5) / 2;
      const mid = reach - hd;
      for (let i = 0; i < parts; i++) {
        const along = ((i + 0.5) / parts) * 2 * hw - hw;
        out.push({
          kind: 'box',
          x: p.x + Math.sin(p.rot) * mid + ux * along,
          y: p.y + shear * along - (top + foot) / 2,
          z: p.z + Math.cos(p.rot) * mid + uz * along,
          hw: hw / parts,
          hh: (foot - top) / 2 + (Math.abs(shear) * hw) / parts,
          hd,
          yaw: p.rot,
          what: `lip ${p.piece} (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`,
        });
      }
    }
  }
  return out;
}

function partBound(p: HeartPart): { r: number; hh: number } {
  const across = p.shape === 'box' ? Math.hypot(p.w / 2, p.d / 2) : Math.max(p.w, p.d) / 2;
  const tilt = Math.max(Math.abs(Math.sin(p.tiltX ?? 0)), Math.abs(Math.sin(p.tiltZ ?? 0)));
  return { r: across + (p.h / 2) * tilt, hh: p.h / 2 + across * tilt };
}

/** Every placeholder prop part as its bounding cylinder. */
export function heartPropSolids(): HeartSolid[] {
  const out: HeartSolid[] = [];
  for (const prop of SMITH_HEART_FIELD.props) {
    const recipe = HEART_PROP_RECIPES[prop.kind] ?? [];
    if (recipe.length === 0) continue;
    const base = heartPropBase(prop.x, prop.z);
    const c = Math.cos(prop.rot);
    const s = Math.sin(prop.rot);
    const k = prop.scale ?? 1;
    for (const p of recipe) {
      const { r, hh } = partBound(p);
      out.push({
        kind: 'cyl',
        x: prop.x + (p.x * c + p.z * s) * k,
        z: prop.z + (-p.x * s + p.z * c) * k,
        r: r * k,
        y0: base + (p.y - hh) * k,
        y1: base + (p.y + hh) * k,
        what: prop.kind,
      });
    }
  }
  return out;
}

/** Every drawn gate part at openness `k` as a turned box. */
export function heartGateSolids(k: number): HeartSolid[] {
  const out: HeartSolid[] = [];
  for (const gate of SMITH_HEART_GATES) {
    const rig = heartGateRig(gate.kind);
    if (!rig) continue;
    const ground = authoredFieldHeight(SMITH_HEART_FIELD, gate.x, gate.z);
    const c = Math.cos(gate.rot);
    const s = Math.sin(gate.rot);
    for (const part of heartGateParts(rig, gate.hw * 2)) {
      // The curtain and the channel's light are light, never a solid.
      if (part.light) continue;
      const pose = heartGatePartPose(part, rig, k);
      if (!pose.shown) continue;
      out.push({
        kind: 'box',
        x: gate.x + pose.x * c + pose.z * s,
        y: ground + pose.y,
        z: gate.z - pose.x * s + pose.z * c,
        hw: part.w / 2,
        hh: part.h / 2,
        hd: part.d / 2,
        yaw: gate.rot,
        what: `${gate.id}:${part.role}`,
      });
    }
  }
  return out;
}

/** Does the point lie inside the solid? */
export function heartSolidContains(s: HeartSolid, x: number, y: number, z: number): boolean {
  if (s.kind === 'cyl') {
    return y >= s.y0 && y <= s.y1 && Math.hypot(x - s.x, z - s.z) <= s.r;
  }
  if (Math.abs(y - s.y) > s.hh) return false;
  const dx = x - s.x;
  const dz = z - s.z;
  const c = Math.cos(s.yaw);
  const sn = Math.sin(s.yaw);
  return Math.abs(dx * c - dz * sn) <= s.hw && Math.abs(dx * sn + dz * c) <= s.hd;
}

/** The solids a straight sightline from a to b passes through (sampled every
 *  `step` yards; a solid is skipped early when its footprint is far from the
 *  line's). */
export function heartSightlineHits(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  solids: readonly HeartSolid[],
  step = 0.2,
): string[] {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const length = Math.hypot(dx, b.y - a.y, dz);
  const n = Math.max(1, Math.ceil(length / step));
  const hits: string[] = [];
  for (const s of solids) {
    const reach = s.kind === 'cyl' ? s.r : Math.hypot(s.hw, s.hd);
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((s.x - a.x) * dx + (s.z - a.z) * dz) / len2)) : 0;
    if (Math.hypot(a.x + dx * t - s.x, a.z + dz * t - s.z) > reach + step) continue;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      if (heartSolidContains(s, a.x + dx * u, a.y + (b.y - a.y) * u, a.z + dz * u)) {
        hits.push(s.what);
        break;
      }
    }
  }
  return hits;
}

/** The Ring kit's render-only solids (phase 2F; its standing stones, cairns
 *  and the Hammer's jambs are layout props, `heartPropSolids`): the vein
 *  mouths' jambs, the spires' crystal leaning in over the seal (three
 *  lifts, each at the lean's reach there), the stairs' parapets. */
export function heartRingSolids(): HeartSolid[] {
  const out: HeartSolid[] = [];
  for (const p of planRingMouths()) {
    if (!p.piece.startsWith('Kit_Jamb')) continue;
    out.push({
      kind: 'cyl',
      x: p.x,
      z: p.z,
      r: 2.2,
      y0: p.y,
      y1: p.y + 10.5,
      what: `jamb ${p.piece}`,
    });
  }
  for (const s of ringSpireSpots()) {
    // The crystal leans 3.2 yd in over its 16: three lifts up the lean.
    for (const [y0, y1, r] of [
      [2.2, 7, 1.0],
      [7, 11.5, 0.8],
      [11.5, 16, 0.55],
    ] as const) {
      const inward = (((y0 + y1) / 2 - 2.2) / 13.8) * 3.2;
      out.push({
        kind: 'cyl',
        x: s.x - Math.sin(s.rot) * inward,
        z: s.z - Math.cos(s.rot) * inward,
        r,
        y0: s.y + y0,
        y1: s.y + y1,
        what: `spire ${s.vein}`,
      });
    }
  }
  // A parapet (0.8 over its walk, past the lip) in three boxes along its
  // run, each at the stair's slope there.
  for (const e of planRingEdges()) {
    if (!e.piece.startsWith('Kit_StairParapet')) continue;
    const half = 3 * (e.stretch ?? 1);
    const shear = e.shear ?? 0;
    const ux = Math.cos(e.rot);
    const uz = -Math.sin(e.rot);
    for (const k of [-2 / 3, 0, 2 / 3]) {
      const a = k * half;
      out.push({
        kind: 'box',
        x: e.x + ux * a + Math.sin(e.rot) * 0.5,
        y: e.y + shear * a + 0.42,
        z: e.z + uz * a + Math.cos(e.rot) * 0.5,
        hw: half / 3,
        hh: 0.42 + (Math.abs(shear) * half) / 3,
        hd: 0.45,
        yaw: e.rot,
        what: `parapet (${e.x.toFixed(1)}, ${e.z.toFixed(1)})`,
      });
    }
  }
  return out;
}
