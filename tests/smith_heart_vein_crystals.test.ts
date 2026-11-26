// The vein crystals (src/render/smith_heart/vein_crystal_core.ts and vein_crystal.ts, the
// owner's ask of 2026-11-26): a collar of slabs over the bare end of each vein's light river,
// in its guardian's arena, and the small crystal of that vein's element that grows out of it
// when the guardian dies. This pins the plan (where each stands, how it grows, a late
// arrival), the painter over a model built by hand (hidden until the vein lights, written
// only while it changes), and the shipped GLB (every vein's pair, one painting, the owner's
// size budget).

import { readFileSync, statSync } from 'node:fs';
import type { Root } from '@gltf-transform/core';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { createGlbIO } from '../scripts/anim/pose_blend.mjs';
import { HEART_RIVER_HALF_WIDTH } from '../src/render/smith_heart/heart_rivers_core';
import { newHeartSealView } from '../src/render/smith_heart/heart_seal_core';
import {
  bakeVeinCrystalModel,
  buildVeinCrystals,
  VEIN_CRYSTAL_GLOW,
} from '../src/render/smith_heart/vein_crystal';
import {
  newVeinCrystalPose,
  planVeinCrystals,
  SMITH_HEART_VEIN_CRYSTALS_URL,
  VEIN_CRYSTAL,
  veinCrystalBound,
  veinCrystalNodes,
  veinCrystalPoseInto,
  veinCrystalSettled,
  veinCrystalSpot,
} from '../src/render/smith_heart/vein_crystal_core';
import {
  LIGHT_RIVERS,
  SMITH_HEART_BOSS_SPOTS,
  SMITH_HEART_FIELD,
  SMITH_HEART_VEINS,
} from '../src/sim/content/smith_heart_layout';
import { authoredFieldHeight } from '../src/sim/instances/authored_field';

interface GlbJson {
  materials: { name?: string }[];
  images?: { mimeType?: string }[];
  extensionsRequired?: string[];
}

function glbJson(rel: string): GlbJson {
  const buf = readFileSync(`public/${rel}`);
  return JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
}

describe("the vein crystals' plan", () => {
  it("stands one on the head of every vein's light river, facing down it", () => {
    const spots = planVeinCrystals();
    expect(spots.map((s) => s.vein)).toEqual([...SMITH_HEART_VEINS]);
    for (const s of spots) {
      const river = LIGHT_RIVERS[s.vein];
      expect([s.x, s.z]).toEqual([river[0].x, river[0].z]);
      // The model's front (+z) turned by the yaw points at the river's next point.
      const d = Math.hypot(river[1].x - river[0].x, river[1].z - river[0].z);
      expect(Math.sin(s.yaw)).toBeCloseTo((river[1].x - river[0].x) / d, 6);
      expect(Math.cos(s.yaw)).toBeCloseTo((river[1].z - river[0].z) / d, 6);
      expect(veinCrystalSpot(s.vein)).toEqual(s);
    }
    // In the guardian's own arena where the river starts there (the Hammer's and the
    // Quench's start under the guardian itself).
    for (const vein of ['hammer', 'quench'] as const) {
      const spot = veinCrystalSpot(vein);
      const boss = SMITH_HEART_BOSS_SPOTS[vein];
      expect(Math.hypot(spot.x - boss.x, spot.z - boss.z)).toBeLessThan(1);
    }
  });

  it("covers the ribbon's bare end: the collar is wider than the river, and small", () => {
    expect(VEIN_CRYSTAL.collarR).toBeGreaterThan(HEART_RIVER_HALF_WIDTH * 2);
    // A small crystal, by the owner's word: a few yards, never a set piece.
    expect(VEIN_CRYSTAL.collarR).toBeLessThan(3.5);
    expect(VEIN_CRYSTAL.sink).toBeGreaterThan(0);
  });

  it("is not there while its guardian lives: only the collar's dim seam", () => {
    const p = veinCrystalPoseInto(-1, newVeinCrystalPose());
    expect(p.shown).toBe(false);
    expect(p.rise).toBe(0);
    expect(p.glow).toBe(0);
    expect(p.collar).toBe(VEIN_CRYSTAL.collarAsleep);
    expect(p.collar).toBeGreaterThan(0);
    expect(p.collar).toBeLessThan(0.5);
  });

  it('grows out of the collar when the vein lights: up, filling out, with a flare', () => {
    const p = newVeinCrystalPose();
    const first = { ...veinCrystalPoseInto(0, p) };
    expect(first.shown).toBe(true);
    expect(first.rise).toBeLessThan(0.1);
    expect(first.girth).toBeCloseTo(VEIN_CRYSTAL.girthFrom, 6);
    expect(first.glow).toBeCloseTo(1 + VEIN_CRYSTAL.flash, 6);
    // It rises the whole way, never shrinking back below where it has been by much, and
    // overshoots a little before it settles (a living thing, not a slide).
    let peak = 0;
    let lastGirth = first.girth;
    for (let t = 0; t <= VEIN_CRYSTAL.grow; t += 0.05) {
      veinCrystalPoseInto(t, p);
      peak = Math.max(peak, p.rise);
      expect(p.girth).toBeGreaterThanOrEqual(lastGirth - 1e-9);
      lastGirth = p.girth;
    }
    expect(peak).toBeGreaterThan(1.02);
    expect(peak).toBeLessThan(1.2);
    const grown = veinCrystalPoseInto(VEIN_CRYSTAL.grow, p);
    expect(grown.rise).toBeCloseTo(1, 6);
    expect(grown.girth).toBeCloseTo(1, 6);
    // Half way it is well on its way up but not there.
    const half = veinCrystalPoseInto(VEIN_CRYSTAL.grow / 2, newVeinCrystalPose());
    expect(half.rise).toBeGreaterThan(0.6);
    // The flare dies; the collar's seam is lit from then on.
    const after = veinCrystalPoseInto(VEIN_CRYSTAL.flashFall + 0.01, newVeinCrystalPose());
    expect(after.glow).toBeCloseTo(1, 6);
    expect(veinCrystalPoseInto(VEIN_CRYSTAL.settled, p).collar).toBeCloseTo(1, 6);
  });

  it('a late arrival finds it fully grown and at rest', () => {
    const p = veinCrystalPoseInto(999, newVeinCrystalPose());
    expect(p).toEqual({ shown: true, rise: 1, girth: 1, glow: 1, collar: 1 });
    expect(veinCrystalSettled(999)).toBe(true);
    expect(veinCrystalSettled(VEIN_CRYSTAL.grow)).toBe(false);
    expect(VEIN_CRYSTAL.settled).toBeGreaterThan(VEIN_CRYSTAL.grow);
    expect(VEIN_CRYSTAL.settled).toBeGreaterThan(VEIN_CRYSTAL.flashFall);
  });

  it('bounds the grown piece for the sightline pin: its reach, and its overshoot in the height', () => {
    const bound = veinCrystalBound();
    expect(bound.r).toBeCloseTo(VEIN_CRYSTAL.collarR * VEIN_CRYSTAL.modelReach, 9);
    // Taller than the crystal at rest (the rise overshoots), and by a breath only.
    const atRest = VEIN_CRYSTAL.collarR * VEIN_CRYSTAL.modelTall;
    expect(bound.h).toBeGreaterThan(atRest * 1.02);
    expect(bound.h).toBeLessThan(atRest * 1.15);
    // Small: a body is taller than the collar, and the crystal stands under three bodies.
    expect(bound.h).toBeLessThan(6);
  });

  it('is built with the interior and driven from its seal view every frame', () => {
    const src = readFileSync('src/render/smith_heart/heart_interior.ts', 'utf8');
    // Awaited with the other kits, before the interior's group is built and gated.
    const from = src.indexOf('await Promise.all([');
    const awaited = src.slice(from, src.indexOf(']);', from));
    expect(from).toBeGreaterThan(0);
    expect(awaited).toContain('ensureVeinCrystals(),');
    expect(src.indexOf('const veinCrystals = buildVeinCrystals();')).toBeGreaterThan(from);
    expect(src).toContain('const veinCrystals = buildVeinCrystals();');
    expect(src).toContain('group.add(veinCrystals.group);');
    // Beside the rivers it caps, from the same view.
    expect(src).toMatch(/rivers\.update\(view\);\s+veinCrystals\.update\(view\);/);
  });
});

/** A model built by hand: each vein's two nodes on one painted material. */
function handModel() {
  const scene = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
  for (const vein of SMITH_HEART_VEINS) {
    const names = veinCrystalNodes(vein);
    for (const name of [names.collar, names.crystal]) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
      mesh.name = name;
      scene.add(mesh);
    }
  }
  return { scene, material };
}

describe("the vein crystals' painter", () => {
  const veinIndex = (vein: string) => SMITH_HEART_VEINS.indexOf(vein as never);
  const parts = (group: THREE.Object3D, vein: string) => {
    const collar = group.getObjectByName(`veinCrystal:${vein}:collar`) as THREE.Mesh;
    const crystal = group.getObjectByName(`veinCrystal:${vein}:crystal`) as THREE.Mesh;
    return {
      holder: collar.parent as THREE.Object3D,
      collar,
      crystal,
      collarMat: collar.material as THREE.MeshStandardMaterial,
      crystalMat: crystal.material as THREE.MeshStandardMaterial,
    };
  };

  it('reads every pair by its node name, and nothing from a scene without them', () => {
    const { scene, material } = handModel();
    const model = bakeVeinCrystalModel(scene);
    expect(Object.keys(model?.parts ?? {}).sort()).toEqual([...SMITH_HEART_VEINS].sort());
    expect(model?.material).toBe(material);
    expect(bakeVeinCrystalModel(new THREE.Group())).toBeNull();
    // A vein missing one of its two nodes is left out; the others still stand.
    const partial = handModel().scene;
    partial.remove(partial.getObjectByName(veinCrystalNodes('heat').crystal) as THREE.Object3D);
    expect(Object.keys(bakeVeinCrystalModel(partial)?.parts ?? {})).not.toContain('heat');
  });

  it("stands each on its river's head, on the floor, at the collar's size", () => {
    const vc = buildVeinCrystals(bakeVeinCrystalModel(handModel().scene));
    for (const spot of planVeinCrystals()) {
      const p = parts(vc.group, spot.vein);
      expect(p.holder.position.x).toBe(spot.x);
      expect(p.holder.position.z).toBe(spot.z);
      const floor = authoredFieldHeight(SMITH_HEART_FIELD, spot.x, spot.z);
      expect(p.holder.position.y).toBeCloseTo(floor - VEIN_CRYSTAL.sink, 6);
      expect(p.holder.rotation.y).toBeCloseTo(spot.yaw, 6);
      expect(p.holder.scale.x).toBe(VEIN_CRYSTAL.collarR);
      // No shadow of its own; the painting is its glow map; a material of its own per part.
      expect(p.collar.castShadow).toBe(false);
      expect(p.crystalMat.emissiveMap).toBe(p.crystalMat.map);
      expect(p.crystalMat).not.toBe(p.collarMat);
    }
  });

  it('shows only the collar while the guardian lives, then grows the crystal', () => {
    const vc = buildVeinCrystals(bakeVeinCrystalModel(handModel().scene));
    const view = newHeartSealView();
    vc.update(view);
    for (const vein of SMITH_HEART_VEINS) {
      const p = parts(vc.group, vein);
      expect(p.collar.visible).toBe(true);
      expect(p.crystal.visible).toBe(false);
      expect(p.collarMat.emissiveIntensity).toBeCloseTo(
        VEIN_CRYSTAL_GLOW.collar * VEIN_CRYSTAL.collarAsleep,
        6,
      );
    }
    // The Quench guardian falls: its crystal alone appears, low and thin, flaring.
    view.since[veinIndex('quench')] = 0;
    vc.update(view);
    const q = parts(vc.group, 'quench');
    expect(q.crystal.visible).toBe(true);
    expect(q.crystal.scale.y).toBeLessThan(0.1);
    expect(q.crystal.scale.x).toBeCloseTo(VEIN_CRYSTAL.girthFrom, 6);
    expect(q.crystalMat.emissiveIntensity).toBeGreaterThan(VEIN_CRYSTAL_GLOW.crystal * 2);
    for (const vein of ['hammer', 'breath', 'heat'])
      expect(parts(vc.group, vein).crystal.visible).toBe(false);
    // Grown: full size, its own light at rest, the collar's seam lit.
    view.since[veinIndex('quench')] = VEIN_CRYSTAL.settled;
    vc.update(view);
    expect(q.crystal.scale.toArray()).toEqual([1, 1, 1]);
    expect(q.crystalMat.emissiveIntensity).toBeCloseTo(VEIN_CRYSTAL_GLOW.crystal, 6);
    expect(q.collarMat.emissiveIntensity).toBeCloseTo(VEIN_CRYSTAL_GLOW.collar, 6);
  });

  it('writes nothing while nothing changes (asleep, or settled)', () => {
    const vc = buildVeinCrystals(bakeVeinCrystalModel(handModel().scene));
    const view = newHeartSealView();
    view.since[veinIndex('heat')] = 500;
    vc.update(view);
    const h = parts(vc.group, 'heat');
    const a = parts(vc.group, 'hammer');
    // Poison what a write would restore: a settled or sleeping crystal is not written again.
    h.crystal.scale.set(7, 7, 7);
    a.collarMat.emissiveIntensity = 9;
    view.since[veinIndex('heat')] = 501;
    vc.update(view);
    expect(h.crystal.scale.x).toBe(7);
    expect(a.collarMat.emissiveIntensity).toBe(9);
    // A growing one is written every step.
    view.since[veinIndex('hammer')] = 0.5;
    vc.update(view);
    expect(a.collarMat.emissiveIntensity).not.toBe(9);
  });

  it('a late arrival sees every fallen guardian with its crystal standing', () => {
    const vc = buildVeinCrystals(bakeVeinCrystalModel(handModel().scene));
    const view = newHeartSealView();
    for (let i = 0; i < view.since.length; i++) view.since[i] = 999;
    vc.update(view);
    for (const vein of SMITH_HEART_VEINS) {
      const p = parts(vc.group, vein);
      expect(p.crystal.visible).toBe(true);
      expect(p.crystal.scale.toArray()).toEqual([1, 1, 1]);
    }
  });

  it('builds nothing, and breaks nothing, when the model has not landed', () => {
    const vc = buildVeinCrystals(null);
    expect(vc.group.children).toHaveLength(0);
    expect(() => vc.update(newHeartSealView())).not.toThrow();
  });
});

describe("the vein crystals' model", () => {
  /** A node's true bounds and triangle count: the shipped file quantizes its vertex data and
   *  leaves the way back on the node, so every vertex is read out and carried by its node. */
  interface Part {
    min: number[];
    max: number[];
    triangles: number;
    material: string;
  }
  const parts = new Map<string, Part>();
  let root: Root;

  beforeAll(async () => {
    await MeshoptDecoder.ready;
    root = (await createGlbIO().read(`public/${SMITH_HEART_VEIN_CRYSTALS_URL}`)).getRoot();
    const v = new THREE.Vector3();
    for (const node of root.listNodes()) {
      const mesh = node.getMesh();
      if (!mesh) continue;
      const world = new THREE.Matrix4().fromArray(node.getWorldMatrix());
      const box = new THREE.Box3();
      let triangles = 0;
      let material = '';
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        if (!pos) continue;
        const e: number[] = [];
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, e);
          box.expandByPoint(v.set(e[0], e[1], e[2]).applyMatrix4(world));
        }
        triangles += (prim.getIndices()?.getCount() ?? 0) / 3;
        material = prim.getMaterial()?.getName() ?? '';
      }
      parts.set(node.getName(), {
        min: box.min.toArray(),
        max: box.max.toArray(),
        triangles,
        material,
      });
    }
  });

  const part = (name: string): Part => {
    const p = parts.get(name);
    if (!p) throw new Error(`no node ${name}`);
    return p;
  };

  it('carries a collar and a crystal for every vein on one painting', () => {
    for (const vein of SMITH_HEART_VEINS) {
      const names = veinCrystalNodes(vein);
      expect(parts.has(names.collar), names.collar).toBe(true);
      expect(parts.has(names.crystal), names.crystal).toBe(true);
    }
    expect(parts.size).toBe(SMITH_HEART_VEINS.length * 2);
    // One material, one painting, shipped as KTX2: eight parts on one program.
    const json = glbJson(SMITH_HEART_VEIN_CRYSTALS_URL);
    expect(json.materials).toHaveLength(1);
    expect(json.images ?? []).toHaveLength(1);
    expect((json.images ?? []).every((i) => i.mimeType === 'image/ktx2')).toBe(true);
    expect(json.extensionsRequired).toContain('KHR_texture_basisu');
    expect(new Set([...parts.values()].map((p) => p.material)).size).toBe(1);
    const size = root.listTextures()[0]?.getSize();
    expect(Math.max(size?.[0] ?? 0, size?.[1] ?? 0)).toBeLessThanOrEqual(1024);
  });

  it('is authored in the frame the painter reads: collar radius 1 on the floor, crystal above', () => {
    for (const vein of SMITH_HEART_VEINS) {
      const names = veinCrystalNodes(vein);
      const collar = part(names.collar);
      const crystal = part(names.crystal);
      // The collar: a unit-radius ring of slabs round the origin, its foot on the floor, low.
      for (const axis of [0, 2]) {
        expect(collar.max[axis], `${vein} collar reach`).toBeGreaterThan(0.9);
        // (`modelReach`, `modelTall`: the bound the sightline pin draws round the piece.)
        expect(collar.max[axis], `${vein} collar reach`).toBeLessThan(VEIN_CRYSTAL.modelReach);
        expect(collar.min[axis], `${vein} collar reach`).toBeLessThan(-0.9);
        expect(collar.min[axis], `${vein} collar reach`).toBeGreaterThan(-VEIN_CRYSTAL.modelReach);
      }
      expect(Math.abs(collar.min[1]), `${vein} collar foot`).toBeLessThan(0.03);
      expect(collar.max[1], `${vein} collar top`).toBeGreaterThan(0.1);
      expect(collar.max[1], `${vein} collar top`).toBeLessThan(0.35);
      // The crystal: rooted inside the collar (it grows out of it), about as tall as the
      // collar is wide, and never wider than the collar.
      expect(crystal.min[1], `${vein} crystal root`).toBeLessThan(collar.max[1]);
      expect(crystal.min[1], `${vein} crystal root`).toBeGreaterThanOrEqual(-0.02);
      expect(crystal.max[1], `${vein} crystal height`).toBeGreaterThan(1.6);
      expect(crystal.max[1], `${vein} crystal height`).toBeLessThan(VEIN_CRYSTAL.modelTall);
      for (const axis of [0, 2]) {
        expect(crystal.max[axis], `${vein} crystal girth`).toBeLessThan(1.05);
        expect(crystal.min[axis], `${vein} crystal girth`).toBeGreaterThan(-1.05);
      }
    }
  });

  it('stays low poly and inside the budget for a small object', () => {
    let triangles = 0;
    for (const vein of SMITH_HEART_VEINS) {
      const names = veinCrystalNodes(vein);
      const own = part(names.collar).triangles + part(names.crystal).triangles;
      // Each crystal about two thousand triangles (Tripo's Smart Mesh, P2), collar and lid in.
      expect(own, vein).toBeGreaterThan(800);
      expect(own, vein).toBeLessThan(3000);
      triangles += own;
    }
    expect(triangles).toBeLessThan(10000);
    // The owner's budget: under 1 MB with a 1k painting on a small object.
    expect(statSync(`public/${SMITH_HEART_VEIN_CRYSTALS_URL}`).size).toBeLessThan(1_000_000);
  });
});
