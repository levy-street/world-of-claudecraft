// Morthen's Rite effects, the Three side (src/render/hollow_crypt/
// morthen_rite_fx.ts and rite_candle_decor.ts):
//  - the host's every program is prepared by its compile gate: the gate is
//    handed the host's one root with every material already under it, and the
//    gate's piece walk (compile_gate_pieces.ts, over three's own compile, which
//    prepares materials on a full `traverse`) reaches the HIDDEN meshes too;
//  - the root never shows before that gate settles, even when the player
//    already stands in the crypt;
//  - the candle decor is per claimed slot, found by tags in the scene: a Rite
//    in one slot never snuffs another's, a retired interior is never written,
//    a kit rebuilt in place is found again, and a low-tier lamp gets its level
//    on the flicker's own base and loses it again when restored.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { linkPiecesOf } from '../src/render/compile_gate_pieces';
import { TelegraphKit } from '../src/render/floor_telegraph';
import { cragDrapeMemo, drapeFanOnCrag } from '../src/render/hollow_crypt/crag_fan_drape';
import { MorthenRiteFx } from '../src/render/hollow_crypt/morthen_rite_fx';
import {
  CRAG_FLOOR_BAND,
  cragRimRadius,
  onCragFloor,
} from '../src/render/hollow_crypt/morthen_rite_fx_core';
import {
  RITE_INTERIOR_NAME,
  RiteCandleDecor,
  tagRiteCandleGlow,
  tagRiteCandleLamp,
} from '../src/render/hollow_crypt/rite_candle_decor';
import { HOLLOW_CRYPT_FIELD } from '../src/sim/content/hollow_crypt_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { KNELL_TUNING, knellHalfYaw, RITE_RING } from '../src/sim/encounters/hollow_crypt/ids';
import { RITE_CANDLE_SPOTS } from '../src/sim/encounters/hollow_crypt/morthen_ids';
import { authoredFieldHeight } from '../src/sim/instances/authored_field';
import type { IWorld } from '../src/world_api';

function materialsUnder(root: THREE.Object3D): Set<string> {
  const out = new Set<string>();
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) out.add(mat.uuid);
  });
  return out;
}

describe('the Rite host and its compile gate', () => {
  it('gates one root carrying every material, hidden meshes included', async () => {
    const scene = new THREE.Scene();
    const gated: THREE.Object3D[] = [];
    let settle: () => void = () => {};
    const gate = (target: THREE.Object3D) => {
      gated.push(target);
      return new Promise<void>((r) => {
        settle = r;
      });
    };
    const fx = new MorthenRiteFx(scene, () => 0, undefined, gate);
    expect(gated).toHaveLength(1);
    const root = gated[0];
    // Everything the painters draw is built up front, most of it hidden.
    let hidden = 0;
    root.traverse((o) => {
      if (o !== root && !o.visible) hidden++;
    });
    expect(hidden).toBeGreaterThan(10);
    const all = materialsUnder(root);
    expect(all.size).toBeGreaterThan(20);
    const pieced = new Set<string>();
    for (const piece of linkPiecesOf(root))
      for (const node of piece) {
        const m = (node as THREE.Mesh).material;
        for (const mat of Array.isArray(m) ? m : [m]) pieced.add(mat.uuid);
      }
    expect([...all].filter((u) => !pieced.has(u))).toEqual([]);
    settle();
    await fx.readyForEntry;
    fx.dispose();
  });

  it('relies on three preparing materials over the whole subtree, hidden or not', () => {
    // WebGLRenderer.compile gathers LIGHTS with traverseVisible but prepares
    // every material on a plain traverse: the hidden meshes link too.
    const src = readFileSync('node_modules/three/build/three.module.js', 'utf8');
    expect(src).toMatch(
      /Only initialize materials in the new scene, not the targetScene\.\s*const materials = new Set\(\);\s*scene\.traverse\( function \( object \) \{/,
    );
  });

  it('never shows the root before its gate settles, in the crypt or not', async () => {
    const scene = new THREE.Scene();
    let settle: () => void = () => {};
    const gate = () =>
      new Promise<void>((r) => {
        settle = r;
      });
    const o = instanceOrigin(DUNGEONS.hollow_crypt.index, 0);
    const world = {
      entities: new Map(),
      player: { pos: { x: o.x, y: 0, z: o.z + 205 } },
    } as unknown as IWorld;
    const fx = new MorthenRiteFx(scene, () => 0, world, gate);
    const root = scene.getObjectByName('crypt-morthen-rite-fx');
    expect(root).toBeDefined();
    fx.update(0.6);
    expect(root?.visible).toBe(false);
    settle();
    await fx.readyForEntry;
    fx.update(0.6);
    expect(root?.visible).toBe(true);
    fx.dispose();
  });
});

/** A fake crypt interior at the slot origin (ox, oz), its candles tagged as
 *  crypt_lights.ts and crypt_kit.ts tag them. */
function interior(ox: number, oz: number, lowTier = false) {
  const root = new THREE.Group();
  root.name = RITE_INTERIOR_NAME;
  root.position.set(ox, 0, oz);
  const flames: THREE.Mesh[] = [];
  const lights: THREE.PointLight[] = [];
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial();
  for (const c of RITE_CANDLE_SPOTS) {
    const flame = new THREE.Mesh(geo, mat);
    const halo = new THREE.Sprite();
    const light = new THREE.PointLight(0xffffff, 8);
    if (!lowTier) light.userData.baseIntensity = 14.4;
    root.add(flame, halo, light);
    tagRiteCandleLamp(c.x, c.z, flame, halo, light);
    flames.push(flame);
    lights.push(light);
  }
  const kit = new THREE.Group();
  const glow = new THREE.InstancedMesh(geo, mat, RITE_CANDLE_SPOTS.length);
  RITE_CANDLE_SPOTS.forEach((c, k) => {
    glow.setMatrixAt(k, new THREE.Matrix4().makeTranslation(c.x, 3.55, c.z));
  });
  tagRiteCandleGlow(glow, RITE_CANDLE_SPOTS);
  kit.add(glow);
  root.add(kit);
  return { root, flames, lights, glow, kit, geo, mat };
}

function instanceScale(mesh: THREE.InstancedMesh, k: number): number {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(k, m);
  return new THREE.Vector3().setFromMatrixScale(m).x;
}

describe('the Remembrance Candles decor', () => {
  it('snuffs a candle in its own slot only', () => {
    const scene = new THREE.Scene();
    const a = interior(1000, 0);
    const b = interior(2000, 0);
    scene.add(a.root, b.root);
    const decor = new RiteCandleDecor(scene);
    expect(decor.set(1000, 0, 2, false, 0.12)).toBe(true);
    expect(a.flames[2].visible).toBe(false);
    expect(instanceScale(a.glow, 2)).toBe(0);
    expect(a.lights[2].userData.baseIntensity).toBeCloseTo(14.4 * 0.12, 9);
    // The other candles of slot A, and every candle of slot B, untouched.
    expect(a.flames[1].visible).toBe(true);
    expect(instanceScale(a.glow, 1)).toBe(1);
    expect(b.flames[2].visible).toBe(true);
    expect(instanceScale(b.glow, 2)).toBe(1);
    expect(b.lights[2].userData.baseIntensity).toBe(14.4);
    decor.set(1000, 0, 2, true, 1);
    expect(a.flames[2].visible).toBe(true);
    expect(instanceScale(a.glow, 2)).toBe(1);
    expect(a.lights[2].userData.baseIntensity).toBe(14.4);
  });

  it('touches the baked flame batch only when the flame changes', () => {
    const scene = new THREE.Scene();
    const a = interior(0, 0);
    scene.add(a.root);
    const decor = new RiteCandleDecor(scene);
    decor.set(0, 0, 0, false, 0.12);
    const v = a.glow.instanceMatrix.version;
    decor.set(0, 0, 0, false, 0.5);
    decor.set(0, 0, 0, false, 0.12);
    expect(a.glow.instanceMatrix.version).toBe(v);
    decor.set(0, 0, 0, true, 1);
    expect(a.glow.instanceMatrix.version).toBe(v + 1);
  });

  it('gives a low-tier lamp the flicker base and takes it back', () => {
    const scene = new THREE.Scene();
    const a = interior(0, 0, true);
    scene.add(a.root);
    const decor = new RiteCandleDecor(scene);
    expect('baseIntensity' in a.lights[3].userData).toBe(false);
    decor.set(0, 0, 3, false, 0.12);
    expect(a.lights[3].userData.baseIntensity).toBeCloseTo(11 * 0.12, 9);
    decor.set(0, 0, 3, true, 1);
    expect('baseIntensity' in a.lights[3].userData).toBe(false);
  });

  it('never writes a retired interior, and finds a kit rebuilt in place', () => {
    const scene = new THREE.Scene();
    const a = interior(0, 0);
    scene.add(a.root);
    const decor = new RiteCandleDecor(scene);
    decor.set(0, 0, 1, false, 0.12);
    // The kit swaps its stand-ins for the baked kit: a fresh batch, full flames.
    const fresh = new THREE.Group();
    const glow2 = new THREE.InstancedMesh(a.geo, a.mat, RITE_CANDLE_SPOTS.length);
    RITE_CANDLE_SPOTS.forEach((c, k) => {
      glow2.setMatrixAt(k, new THREE.Matrix4().makeTranslation(c.x, 3.55, c.z));
    });
    tagRiteCandleGlow(glow2, RITE_CANDLE_SPOTS);
    fresh.add(glow2);
    a.root.add(fresh);
    a.kit.removeFromParent();
    decor.set(0, 0, 1, false, 0.12);
    expect(instanceScale(glow2, 1)).toBe(0);
    // The interior retires: nothing is written into it any more.
    a.root.removeFromParent();
    a.flames[1].visible = false;
    expect(decor.set(0, 0, 1, true, 1)).toBe(false);
    decor.restoreAll();
    expect(a.flames[1].visible).toBe(false);
    expect(instanceScale(glow2, 1)).toBe(0);
  });

  it('restores every live slot when the host lets go', () => {
    const scene = new THREE.Scene();
    const a = interior(0, 0);
    scene.add(a.root);
    const decor = new RiteCandleDecor(scene);
    for (let i = 0; i < 4; i++) decor.set(0, 0, i, false, 0.12);
    decor.restoreAll();
    for (let i = 0; i < 4; i++) {
      expect(a.flames[i].visible).toBe(true);
      expect(instanceScale(a.glow, i)).toBe(1);
      expect(a.lights[i].userData.baseIntensity).toBe(14.4);
    }
  });
});

describe('the fight paints the crag top only', () => {
  // A crag top 20 yd round the origin; past its rim the floor drops 19 yd
  // (the Choir Loft under the Rite Ring's south rim).
  const crag = (x: number, z: number) => (Math.hypot(x, z) <= 20 ? 0 : -19);

  it('cuts a fan back to the rim along every spoke, the curtain too', () => {
    const root = new THREE.Group();
    const kit = new TelegraphKit(root, true);
    const fan = kit.fan(13);
    kit.layOutFan(fan, 180, { color: 0xff2d44 });
    const memo = cragDrapeMemo();
    drapeFanOnCrag(kit, fan, crag, 6, 0, 0, Math.PI / 2, 32, memo);
    const pos = fan.floor.geometry.getAttribute('position');
    let cut = 0;
    for (let i = 0; i < pos.count; i++) {
      // Local units scale by the range; turned by the yaw, offset by the centre.
      const lx = pos.getX(i) * 32;
      const lz = pos.getZ(i) * 32;
      const wx = 6 + lx * Math.cos(Math.PI / 2) + lz * Math.sin(Math.PI / 2);
      const wz = -lx * Math.sin(Math.PI / 2) + lz * Math.cos(Math.PI / 2);
      expect(Math.hypot(wx, wz)).toBeLessThanOrEqual(20.05);
      expect(pos.getY(i)).toBeGreaterThanOrEqual(-CRAG_FLOOR_BAND);
      if (Math.hypot(pos.getX(i), pos.getZ(i)) < 0.99 && Math.hypot(pos.getX(i), pos.getZ(i)) > 0.4)
        cut++;
    }
    expect(cut).toBeGreaterThan(0);
    const cp = fan.curtain?.geometry.getAttribute('position');
    for (let i = 0; i < fan.stations; i++)
      expect(cp?.getY(i * 2)).toBeGreaterThanOrEqual(-CRAG_FLOOR_BAND);
    // Unmoved, it is not draped again.
    const version = () => (pos as { version: number }).version;
    const v = version();
    drapeFanOnCrag(kit, fan, crag, 6, 0, 0, Math.PI / 2, 32, memo);
    expect(version()).toBe(v);
    kit.dispose();
  });

  it('finds the rim along a spoke, and keeps the whole reach on open crag', () => {
    expect(cragRimRadius(crag, 0, 0, 1, 0, 0, 32)).toBeCloseTo(20, 1);
    expect(cragRimRadius(crag, 0, 0, 0, 1, 0, 12)).toBe(12);
    expect(onCragFloor(-2.9, 0)).toBe(true);
    expect(onCragFloor(-19, 0)).toBe(false);
    expect(CRAG_FLOOR_BAND).toBe(KNELL_TUNING.floorBand);
  });
});

describe('the Burning Knell on the real Rite Ring', () => {
  it('never drapes any half past the south rim onto the Choir Loft', () => {
    const ground = (x: number, z: number) => authoredFieldHeight(HOLLOW_CRYPT_FIELD, x, z);
    const floor = ground(RITE_RING.x, RITE_RING.z);
    const root = new THREE.Group();
    const kit = new TelegraphKit(root, true);
    const fan = kit.fan(13);
    kit.layOutFan(fan, 180, { color: 0xff2d44 });
    let lowest = 0;
    for (let half = 0; half < 4; half++) {
      drapeFanOnCrag(
        kit,
        fan,
        ground,
        RITE_RING.x,
        floor,
        RITE_RING.z,
        knellHalfYaw(half),
        KNELL_TUNING.reach,
        cragDrapeMemo(),
      );
      const pos = fan.floor.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) lowest = Math.min(lowest, pos.getY(i));
    }
    expect(lowest).toBeGreaterThanOrEqual(-KNELL_TUNING.floorBand);
    kit.dispose();
  });
});
