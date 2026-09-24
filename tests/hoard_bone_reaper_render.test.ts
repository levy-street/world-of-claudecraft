// Bonelord Xarreth's Wandering Scythe and Soul Harvest on screen: the pure look
// (src/render/hoard_bone_reaper_core.ts), the pooled adapter
// (src/render/hoard_bone_reaper.ts), and the shipped Blender assets, including
// the one pin that matters most: the modelled blade sits inside the hit sector.
import { existsSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ASSETS } from '../scripts/assets/bone_reaper/build.mjs';
import { BONE_REAPER_ASSET_URLS, HoardBoneReaperFx } from '../src/render/hoard_bone_reaper';
import {
  BONE_REAPER_LOOK,
  harvestedLook,
  type ScythePose,
  type SoulPose,
  scythePose,
  scytheTipAt,
  soulEnding,
  soulPose,
} from '../src/render/hoard_bone_reaper_core';
import { HoardBossFx } from '../src/render/hoard_boss_fx';
import {
  BONE_SCYTHE,
  BONE_SCYTHE_TOTAL_SEC,
  pointInScytheBlade,
  SOUL_HARVEST,
  scytheAngle,
  scytheFrameFor,
  scythePivot,
  soulLifeSec,
} from '../src/sim/rift/hoard_bone_reaper_core';
import type { HoardBossCueView } from '../src/world_api/dungeons';

const FRAME = scytheFrameFor(24, 28, -1);
const blankScythe = (): ScythePose => ({
  x: 0,
  z: 0,
  angle: 0,
  formed: 0,
  lift: 0,
  leanX: 0,
  leanZ: 0,
  glow: 0,
  broken: 0,
  speed: 0,
  dirX: 0,
  dirZ: 0,
  active: false,
});
const blankSoul = (): SoulPose => ({
  x: 0,
  z: 0,
  y: 0,
  yaw: 0,
  scale: 0,
  glow: 0,
  stretch: 1,
  travelled: 0,
  drawn: false,
});

describe('the scythe look', () => {
  it('is drawn exactly where the sim says the hazard is', () => {
    for (const elapsed of [0.4, 2, 6.5, 11, 14]) {
      const pose = scythePose(blankScythe(), 100, -50, 0.7, 1, FRAME, elapsed);
      const pivot = scythePivot(100, -50, 1, FRAME, elapsed);
      expect([pose.x, pose.z]).toEqual([pivot.x, pivot.z]);
      expect(pose.angle).toBe(scytheAngle(0.7, elapsed));
    }
  });

  it('assembles out of the floor, runs whole, then breaks apart', () => {
    const early = scythePose(blankScythe(), 0, 0, 0, 0, FRAME, 0.1);
    expect(early.active).toBe(false);
    expect(early.formed).toBeLessThan(0.2);
    expect(early.lift).toBeLessThan(-1);
    const live = scythePose(blankScythe(), 0, 0, 0, 0, FRAME, BONE_SCYTHE.castSec + 4);
    expect(live).toMatchObject({ active: true, formed: 1, lift: 0, broken: 0, glow: 1 });
    const dying = scythePose(blankScythe(), 0, 0, 0, 0, FRAME, BONE_SCYTHE_TOTAL_SEC - 0.2);
    expect(dying.active).toBe(false);
    expect(dying.broken).toBeGreaterThan(0.6);
    expect(dying.glow).toBeLessThan(0.4);
  });

  it('leans into its travel like something heavy, never past a small angle', () => {
    let leaned = 0;
    for (let t = BONE_SCYTHE.castSec; t < BONE_SCYTHE.castSec + BONE_SCYTHE.activeSec; t += 0.25) {
      const pose = scythePose(blankScythe(), 0, 0, 0, 2, FRAME, t);
      const lean = Math.hypot(pose.leanX, pose.leanZ);
      expect(lean).toBeLessThanOrEqual(BONE_REAPER_LOOK.maxLean + 1e-9);
      leaned = Math.max(leaned, lean);
      // The lean is across the direction of travel, so it tips INTO the motion.
      if (pose.speed > 1) expect(pose.leanX * pose.dirX + pose.leanZ * pose.dirZ).toBeCloseTo(0, 9);
    }
    expect(leaned).toBeGreaterThan(0.05);
    // At rest while it is summoned: no lean at all.
    expect(scythePose(blankScythe(), 0, 0, 0, 2, FRAME, 0.5).speed).toBe(0);
  });

  it('trails the blade along its TRUE path, and only briefly', () => {
    // A trail sample is on the hit sector of the moment it was taken.
    const out = { x: 0, z: 0 };
    const mid = (BONE_SCYTHE.bladeInner + BONE_SCYTHE.reach) / 2;
    for (const t of [2, 5.5, 9]) {
      scytheTipAt(out, 10, 20, 0.3, 0, FRAME, t, mid);
      expect(pointInScytheBlade(scythePivot(10, 20, 0, FRAME, t), scytheAngle(0.3, t), out)).toBe(
        true,
      );
    }
    // Short: a small part of one turn, so it can never close into a standing ring.
    const swept = ((Math.PI * 2) / BONE_SCYTHE.rotationPeriod) * BONE_REAPER_LOOK.trailSec;
    expect(swept).toBeLessThan(Math.PI / 3);
  });
});

describe('the soul look', () => {
  it('forms, holds brightening, then is drawn; and is pulled thin as it is taken', () => {
    const total = soulLifeSec(20);
    const forming = soulPose(blankSoul(), 20, 0, 0, 0, 0.3, total, 1);
    const holding = soulPose(blankSoul(), 20, 0, 0, 0, SOUL_HARVEST.castSec + 0.5, total, 1);
    const drawn = soulPose(blankSoul(), 20, 0, 0, 0, total * 0.7, total, 1);
    const taken = soulPose(blankSoul(), 20, 0, 0, 0, total - 0.05, total, 1);
    expect(forming.scale).toBeLessThan(holding.scale);
    expect(forming.glow).toBeLessThan(holding.glow);
    expect(holding.drawn).toBe(false);
    expect(drawn).toMatchObject({ drawn: true, glow: 1, stretch: 1 });
    expect(drawn.travelled).toBeGreaterThan(0.4);
    expect(taken.stretch).toBeGreaterThan(1.8);
    expect(taken.scale).toBeLessThan(drawn.scale);
    // It faces the boss it is walking to.
    expect(drawn.yaw).toBeCloseTo(Math.atan2(-drawn.x, 0), 6);
  });

  it('gives a vanished soul the right ending', () => {
    expect(soulEnding(SOUL_HARVEST.absorbRadius + 0.2, 0, 0, 0)).toBe('absorbed');
    expect(soulEnding(9, 3, 0, 0)).toBe('released');
  });

  it('escalates the empowered boss cleanly with his stacks', () => {
    expect(harvestedLook(0)).toEqual({ ribs: 0, veins: 0, aura: 0, orbiters: 0 });
    let last = harvestedLook(0);
    for (let stacks = 1; stacks <= SOUL_HARVEST.maxStacks; stacks++) {
      const look = harvestedLook(stacks);
      expect(look.ribs).toBeGreaterThanOrEqual(last.ribs);
      expect(look.aura).toBeGreaterThanOrEqual(last.aura);
      last = look;
    }
    expect(harvestedLook(1).ribs).toBeGreaterThan(0);
    expect(harvestedLook(2).aura).toBe(0);
    expect(harvestedLook(4).orbiters).toBe(1);
    expect(harvestedLook(99)).toEqual(harvestedLook(SOUL_HARVEST.maxStacks));
  });
});

const CALM_OFF = () => false;
function cue(partial: Partial<HoardBossCueView> & { variant: HoardBossCueView['variant'] }) {
  return {
    instanceId: 1,
    cueId: 1,
    kind: 'sweep',
    phase: 'warning',
    x: 0,
    z: 0,
    radius: 9,
    remaining: 10,
    total: BONE_SCYTHE_TOTAL_SEC,
    facing: 0,
    halfAngle: -28,
    ...partial,
  } as HoardBossCueView;
}

function meshesOf(scene: THREE.Scene, name: string): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  scene.traverse((node) => {
    if (node.name === name) out.push(node);
  });
  return out;
}

describe('the adapter', () => {
  it('hides the carriers from the generic floor telegraph', async () => {
    // Their cue numbers carry a route, not a floor shape: drawn generically, the
    // scythe carrier would paint a nonsense cone and each soul a danger disc.
    const scene = new THREE.Scene();
    const generic = new HoardBossFx(scene, () => 0);
    await generic.readyForEntry;
    generic.sync([
      cue({ variant: 'bone-scythe' }),
      cue({ cueId: 2, variant: 'bone-harvest' }),
      cue({ cueId: 3, kind: 'mark', variant: 'bone-soul', radius: 2.4, total: 6, remaining: 5 }),
    ]);
    const root = scene.getObjectByName('hoard-boss-actionable-cues');
    expect(root).toBeDefined();
    expect(root?.children.every((slot) => !slot.visible)).toBe(true);
    // The guard is not vacuous: an ordinary mark does draw.
    generic.sync([cue({ cueId: 4, kind: 'mark', variant: 'buried-mark', radius: 3 })]);
    expect(root?.children.some((slot) => slot.visible)).toBe(true);
    generic.dispose();
  });

  it('moves the pivot AND turns the blade about it, from one cue', async () => {
    const scene = new THREE.Scene();
    const fx = new HoardBoneReaperFx(scene, () => 0, undefined, undefined, CALM_OFF, 'high', []);
    await fx.readyForEntry;
    const pivot = meshesOf(scene, 'MovementPivot')[0];
    const spin = meshesOf(scene, 'RotationPivot')[0];
    expect(pivot.visible).toBe(false);
    const scythe = cue({ variant: 'bone-scythe', remaining: BONE_SCYTHE_TOTAL_SEC - 3 });
    fx.sync([scythe]);
    fx.update(0);
    const first = { x: pivot.position.x, z: pivot.position.z, turn: spin.rotation.y };
    expect(pivot.visible).toBe(true);
    // The adapter runs its own clock between cue updates, off the same closed form.
    fx.sync([scythe]);
    fx.update(1.5);
    const expected = scythePivot(0, 0, 1, scytheFrameFor(0, 0, -1), 4.5);
    expect(Math.hypot(pivot.position.x - first.x, pivot.position.z - first.z)).toBeGreaterThan(1);
    expect(spin.rotation.y).not.toBe(first.turn);
    expect(spin.rotation.y).toBeCloseTo(scytheAngle(0, 4.5), 6);
    expect(expected).toBeDefined();
    // The cue ends: nothing is left standing.
    fx.sync([]);
    fx.update(0.016);
    expect(pivot.visible).toBe(false);
    fx.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('draws one instance per soul and clears them with their cues', async () => {
    const scene = new THREE.Scene();
    const fx = new HoardBoneReaperFx(scene, () => 0, undefined, undefined, CALM_OFF, 'high', []);
    await fx.readyForEntry;
    const body = meshesOf(scene, 'Soul_SpectralBody')[0] as THREE.InstancedMesh;
    const soul = (id: number, x: number) =>
      cue({ cueId: id, kind: 'mark', variant: 'bone-soul', x, z: -20, total: 6, remaining: 5 });
    fx.sync([
      cue({ cueId: 9, variant: 'bone-harvest', total: 7, remaining: 6 }),
      soul(2, -8),
      soul(3, 8),
    ]);
    fx.update(0.016);
    expect(body.count).toBe(2);
    fx.sync([cue({ cueId: 9, variant: 'bone-harvest', total: 7, remaining: 5 }), soul(3, 8)]);
    fx.update(0.016);
    expect(body.count).toBe(1);
    fx.sync([]);
    fx.update(0.016);
    expect(body.count).toBe(0);
    fx.dispose();
  });

  it('puts the late Blender assets in place BEFORE the compile gate sees the root', async () => {
    // The real path: the GLBs arrive after construction. Whatever the gate walks
    // is what gets compiled, so the authored weapon and soul geometry must already
    // be on the root then, never swapped in afterwards.
    const part = (name: string, size: number) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshStandardMaterial(),
      );
      mesh.name = name;
      return mesh;
    };
    const scytheAsset = new THREE.Group();
    scytheAsset.add(part('Scythe_Blade', 3), part('Scythe_Fragments', 1));
    const soulAsset = new THREE.Group();
    for (const name of ['SpectralBody', 'SoulCore', 'OuterWisps', 'FaceHint'])
      soulAsset.add(part(name, 2));
    let deliver: (value: readonly THREE.Group[]) => void = () => {};
    const late = new Promise<readonly THREE.Group[]>((resolve) => {
      deliver = resolve;
    });
    const seen: { weapon: string[]; soulVertices: number; attached: boolean }[] = [];
    const scene = new THREE.Scene();
    const gate = async (root: THREE.Object3D) => {
      const weapon: string[] = [];
      root.traverse((node) => {
        if (node.name.startsWith('Scythe_')) weapon.push(node.name);
      });
      const body = root.getObjectByName('Soul_SpectralBody') as THREE.InstancedMesh;
      seen.push({
        weapon: weapon.sort(),
        soulVertices: body.geometry.getAttribute('position').count,
        attached: root.parent !== null,
      });
    };
    const fx = new HoardBoneReaperFx(scene, () => 0, undefined, gate, CALM_OFF, 'high', late);
    expect(scene.children).toHaveLength(0);
    deliver([scytheAsset, soulAsset]);
    await fx.readyForEntry;
    expect(seen).toHaveLength(1);
    // Both rigs (a full party in a rare enough hoard faces a pair) wear the asset.
    expect(seen[0].weapon).toEqual([
      'Scythe_Blade',
      'Scythe_Blade',
      'Scythe_Fragments',
      'Scythe_Fragments',
    ]);
    // A box has 24 vertices; the stand-in cone it replaced has a different count.
    expect(seen[0].soulVertices).toBe(24);
    expect(scene.children).toHaveLength(1);
    // The cached asset is never mutated: the rig works on a clone and baked copies.
    expect(scytheAsset.children).toHaveLength(2);
    expect(soulAsset.children[0].parent).toBe(soulAsset);
    fx.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('frees its instanced pools on dispose, and only once', async () => {
    const scene = new THREE.Scene();
    const fx = new HoardBoneReaperFx(scene, () => 0, undefined, undefined, CALM_OFF, 'high', []);
    await fx.readyForEntry;
    const pools: THREE.InstancedMesh[] = [];
    scene.traverse((node) => {
      if ((node as THREE.InstancedMesh).isInstancedMesh) pools.push(node as THREE.InstancedMesh);
    });
    // Four soul parts, their floor markers, their halos.
    expect(pools).toHaveLength(6);
    // Empty pools cost nothing: hidden until a soul exists.
    fx.update(0.016);
    expect(pools.every((pool) => !pool.visible && pool.count === 0)).toBe(true);
    const disposed: string[] = [];
    for (const pool of pools) pool.addEventListener('dispose', () => disposed.push(pool.name));
    fx.dispose();
    fx.dispose();
    expect(disposed).toHaveLength(6);
  });

  it('on the low tier sheds the flourish and keeps everything a player acts on', async () => {
    const count = (scene: THREE.Scene, type: string) => {
      let n = 0;
      scene.traverse((node) => {
        if (node.type === type) n++;
      });
      return n;
    };
    const high = new THREE.Scene();
    const low = new THREE.Scene();
    const a = new HoardBoneReaperFx(high, () => 0, undefined, undefined, CALM_OFF, 'high', []);
    const b = new HoardBoneReaperFx(low, () => 0, undefined, undefined, CALM_OFF, 'low', []);
    await Promise.all([a.readyForEntry, b.readyForEntry]);
    expect(count(high, 'Points')).toBe(1);
    expect(count(low, 'Points')).toBe(0);
    expect(count(low, 'Mesh')).toBeLessThan(count(high, 'Mesh'));
    // The weapon, its floor footprint and the souls are on both.
    for (const scene of [high, low]) {
      expect(meshesOf(scene, 'MovementPivot')).toHaveLength(2);
      expect(meshesOf(scene, 'Soul_SpectralBody')).toHaveLength(1);
      expect(count(scene, 'Line')).toBe(2);
    }
    a.dispose();
    b.dispose();
  });
});

describe('the shipped Blender assets', () => {
  it('exist, keep their named parts, and are small', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    expect(BONE_REAPER_ASSET_URLS.map((url) => `public${url}`)).toEqual(
      ASSETS.map((a) => a.target),
    );
    for (const asset of ASSETS) {
      expect(existsSync(asset.source), asset.source).toBe(true);
      expect(existsSync(asset.target), asset.target).toBe(true);
      const root = (await io.read(asset.target)).getRoot();
      expect(
        root
          .listNodes()
          .map((node) => node.getName())
          .sort(),
      ).toEqual(asset.nodes);
      expect((root.getExtras() as { authoring?: string }).authoring).toBe('Blender');
      expect(root.listTextures()).toHaveLength(0);
      expect(root.listAnimations()).toHaveLength(0);
      let triangles = 0;
      for (const mesh of root.listMeshes())
        for (const primitive of mesh.listPrimitives())
          triangles += (primitive.getIndices()?.getCount() ?? 0) / 3;
      expect(triangles).toBeLessThan(2600);
    }
  });

  it('models the blade INSIDE the sim hit sector: what you see is what hits', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    // The unoptimized Blender export: plain float positions in metres.
    const root = (await io.read(ASSETS[0].source)).getRoot();
    const blade = root.listNodes().find((node) => node.getName() === 'Scythe_Blade');
    const primitive = blade
      ?.getMesh()
      ?.listPrimitives()
      .find((p) => p.getMaterial()?.getName() === 'BladeEdge');
    const position = primitive?.getAttribute('POSITION');
    if (!position) throw new Error('missing blade edge');
    let inside = 0;
    const v = [0, 0, 0];
    for (let i = 0; i < position.getCount(); i++) {
      position.getElement(i, v);
      // glTF: game forward is +Z, the blade leads toward +X.
      const radius = Math.hypot(v[0], v[2]);
      const ahead = Math.atan2(v[0], v[2]) * BONE_SCYTHE.rotationDirection;
      expect(radius, `edge vertex ${i} radius`).toBeGreaterThan(BONE_SCYTHE.bladeInner);
      expect(radius, `edge vertex ${i} radius`).toBeLessThanOrEqual(BONE_SCYTHE.reach + 1e-3);
      expect(ahead, `edge vertex ${i} angle`).toBeGreaterThanOrEqual(-BONE_SCYTHE.bladeTrail);
      expect(ahead, `edge vertex ${i} angle`).toBeLessThanOrEqual(BONE_SCYTHE.bladeArc + 1e-3);
      if (pointInScytheBlade({ x: 0, z: 0 }, 0, { x: v[0], z: v[2] })) inside++;
    }
    // All of it, bar the last column of the tip, which sits ON the sector's edge
    // (ahead === bladeArc to the last bit) and can round either way.
    expect(inside).toBeGreaterThanOrEqual(position.getCount() - 4);
    expect(position.getCount()).toBeGreaterThan(20);
  });
});
