// The hammer round (2026-11-05): from the floor the great hammer reads as a hammer
// (its head clears the Hammer altar's crown, its haft rises from it), the Hammer's root
// stands off it, and the Heat's altar is a heap of forge rock with its fire crystal
// half sunk in a flank (no longer a candle under a ball of light).

import { existsSync, readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import { ASSET } from '../scripts/assets/smith_heart_heart_kit/build.mjs';
import { heartLandmarkSpots } from '../src/render/smith_heart/heart_landmarks_core';
import { planHeartLights } from '../src/render/smith_heart/heart_plan_core';
import {
  HEART_ALTAR_RISE,
  heartAltarRise,
  heartRootGripPoint,
} from '../src/render/smith_heart/heart_room_kit_plan_core';
import {
  HEART_ROOT_LOOK,
  heartRootEmissiveGlsl,
} from '../src/render/smith_heart/heart_root_look_core';
import { HEART_ALTAR_R, HEART_ROOM } from '../src/sim/content/smith_heart_layout';

const kit = (f: string) => readFileSync(`docs/design/raid/kit/${f}`, 'utf8');
const KIT = ASSET.target;
const haveKit = existsSync(KIT);

/** A Python tuple constant's numbers. */
function tuple(src: string, name: string): number[] {
  const m = src.match(new RegExp(`^${name} = \\(([^)]*)\\)`, 'm'));
  if (!m) throw new Error(`no ${name}`);
  return m[1].split(',').map((x) => Number(x.trim()));
}
function scalar(src: string, name: string): number {
  const m = src.match(new RegExp(`^${name} = ([-\\d.]+)`, 'm'));
  if (!m) throw new Error(`no ${name}`);
  return Number(m[1]);
}

type V3 = [number, number, number];
const pieces = new Map<string, Map<string, V3[]>>();

beforeAll(async () => {
  if (!haveKit) return;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.readBinary(new Uint8Array(readFileSync(KIT)));
  for (const node of doc.getRoot().listNodes()) {
    const name = node.getName();
    if (name !== 'Kit_AltarHeat' && name !== 'Kit_AltarHammer') continue;
    const byMat = new Map<string, V3[]>();
    const m = node.getWorldMatrix();
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      const a = prim.getAttribute('POSITION');
      if (!a) continue;
      const mat = prim.getMaterial()?.getName() ?? '';
      const list = byMat.get(mat) ?? [];
      const e: number[] = [];
      for (let i = 0; i < a.getCount(); i++) {
        a.getElement(i, e);
        list.push([
          m[0] * e[0] + m[4] * e[1] + m[8] * e[2] + m[12],
          m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13],
          m[2] * e[0] + m[6] * e[1] + m[10] * e[2] + m[14],
        ]);
      }
      byMat.set(mat, list);
    }
    pieces.set(name, byMat);
  }
});

const top = (pts: V3[]) => pts.reduce((t, p) => Math.max(t, p[1]), -Infinity);

describe("Smith's Heart, the hammer round", () => {
  it.skipIf(!haveKit)(
    "lifts the hammer's head clear of the lowered Hammer altar from the approach",
    () => {
      const src = kit('landmark_pieces.py');
      const [cu, , cz] = tuple(src, 'HAMMER_HEAD');
      const [hu, , hz] = tuple(src, 'HAMMER_HEAD_HALF');
      const tilt = scalar(src, 'HAMMER_TILT');
      // The head's front lower and upper edges (its long axis across, tilted back along
      // its haft).
      const edgeU = cu - hu * Math.cos(tilt) - hz * Math.sin(tilt);
      const edgeZ = cz + hu * Math.sin(tilt) - hz * Math.cos(tilt);
      const topU = cu - hu * Math.cos(tilt) + hz * Math.sin(tilt);
      const topZ = cz + hu * Math.sin(tilt) + hz * Math.cos(tilt);
      // The Hammer altar stands lower than the other three, still taller than a raider.
      expect(heartAltarRise('hammer')).toBeLessThan(HEART_ALTAR_RISE);
      const altar = pieces.get('Kit_AltarHammer');
      const crown = top([...(altar?.values() ?? [])].flat()) * heartAltarRise('hammer');
      expect(crown).toBeGreaterThan(9);
      // A raider's camera on the hammer's line (3 yd up), from the room's centre to 25 yd
      // short of the altar: the line over the altar's crown (its front, 2 yd before its
      // foot) leaves most of the head's face in sight (before the round it hid the head
      // to its cheeks), and from the centre its lower edge clears the crown outright.
      const front = HEART_ALTAR_R - 2;
      const line = (camU: number, u: number) => 3 + ((crown - 3) * (u - camU)) / (front - camU);
      for (const camU of [4.5, 15, HEART_ALTAR_R - 25]) {
        const hid = Math.max(edgeZ, line(camU, edgeU));
        expect((topZ - hid) / (topZ - edgeZ), `camera at ${camU}`).toBeGreaterThan(0.8);
      }
      expect(edgeZ).toBeGreaterThan(line(4.5, edgeU));
      expect(topU).toBeGreaterThan(edgeU);
      // Its haft rises nearly upright from it (a T the room reads, never a spire leaning
      // away out of sight), leaning across away from the Hammer's root.
      expect(tilt).toBeLessThan(0.3);
      expect(scalar(src, 'HAMMER_LEAN')).toBeGreaterThan(0.08);
      expect(scalar(src, 'HAMMER_HAFT_LEN')).toBeGreaterThan(30);
      // The head and the haft are the Smith's blue-grey granite, apart from the ochre crag.
      expect(src).toContain('(0.3, 0.32, 0.38), (0.47, 0.5, 0.56), (0.74, 0.76, 0.78)');
      // The landmark's first spot rides the head's crack, never the air before it.
      const s0 = heartLandmarkSpots('hammer')[0];
      expect(Math.hypot(s0.x, s0.z)).toBeGreaterThan(edgeU - 1);
      expect(s0.y).toBeGreaterThan(edgeZ);
    },
  );

  it("stands the Hammer's root and its grip off the hammer's head", () => {
    const g = heartRootGripPoint('hammer');
    const bearing = (Math.atan2(g.x - HEART_ROOM.x, g.z - HEART_ROOM.z) * 180) / Math.PI;
    const off = Math.abs(((bearing - 180 + 540) % 360) - 180);
    // The head spans about eight degrees either side of its bearing; the arm clamps the
    // lip well past it (it came down at 11 degrees before the round).
    expect(off).toBeGreaterThan(14);
    expect(
      Math.abs(Math.hypot(g.x - HEART_ROOM.x, g.z - HEART_ROOM.z) - HEART_ROOM.r),
    ).toBeLessThan(1);
  });

  it('gives the Heat and the Hammer altars no halo card, the other two theirs', () => {
    const lights = planHeartLights();
    for (const v of ['heat', 'hammer'] as const)
      expect(lights.find((l) => l.id === `altar:${v}`)?.noHalo, v).toBe(true);
    for (const v of ['breath', 'quench'] as const)
      expect(lights.find((l) => l.id === `altar:${v}`)?.noHalo, v).toBeFalsy();
  });

  it.skipIf(!haveKit)(
    "builds the Heat's altar as forge rock, its crystal sunk in a flank under the rock's crown",
    () => {
      const altar = pieces.get('Kit_AltarHeat');
      expect(altar).toBeDefined();
      const stone = altar?.get('KitStone') ?? [];
      const glow = altar?.get('KitGlow') ?? [];
      expect(glow.length).toBeGreaterThan(20);
      // The rock's crown stands over the fire crystal: it bursts from a flank, it never
      // tops the altar like a candle's flame.
      expect(top(stone)).toBeGreaterThan(top(glow));
      // Broad at its foot, narrowing as it rises (the columns stood straight up).
      const width = (z0: number, z1: number) =>
        stone
          .filter((p) => p[1] > z0 && p[1] < z1)
          .reduce((r, p) => Math.max(r, Math.hypot(p[0], p[2])), 0);
      expect(width(1.0, 2.0)).toBeGreaterThan(width(4.5, 5.5) + 0.6);
      const src = kit('heart_pieces.py');
      const body = src.slice(
        src.indexOf('def _heat_altar_rock('),
        src.indexOf('def _heat_altar_paint('),
      );
      expect(body).not.toContain('hex_column');
      const [lx, ly, lz] = tuple(src, 'HEAT_ALTAR_LEAN');
      expect(Math.hypot(lx, ly)).toBeGreaterThan(lz);
      // Its embers are painted into the stone and burn there.
      expect(src).toContain("slot=STONE, reach=5.0, gap=0.4, lift=0.03, colour=A['ember']");
    },
  );

  it('burns a saturated ember paint in the painted stone, never the rock paint', () => {
    const glsl = heartRootEmissiveGlsl();
    const [lo, hi] = HEART_ROOT_LOOK.ember;
    expect(glsl).toContain(
      `smoothstep( ${lo.toFixed(2)}, ${hi.toFixed(2)}, diffuseColor.r - diffuseColor.b )`,
    );
    // sRGB to linear, as the kit's colours reach the shader.
    const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const redOverBlue = (c: readonly number[]) => lin(c[0]) - lin(c[2]);
    // The ember and the hot core glow; the altar's warmest rock, the roots' and the
    // plinth's paint stay under the band.
    expect(redOverBlue([1.0, 0.46, 0.13])).toBeGreaterThan(hi);
    expect(redOverBlue([1.0, 0.7, 0.32])).toBeGreaterThan(hi);
    for (const rock of [
      [0.66, 0.52, 0.41],
      [0.58, 0.53, 0.48],
      [0.77, 0.69, 0.57],
    ])
      expect(redOverBlue(rock), rock.join()).toBeLessThan(lo);
  });
});
