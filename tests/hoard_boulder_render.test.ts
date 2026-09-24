// Grask's Rolling Boulder on screen: the pure look, the pooled adapter, and the
// shipped Blender rock. The pin that matters most: the rock on screen is where
// the sim's rock is, and the ring on the floor is the ring that counts.
import { existsSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ASSETS } from '../scripts/assets/boulder/build.mjs';
import { HoardBossFx } from '../src/render/hoard_boss_fx';
import { BOULDER_ASSET_URL, HoardBoulderFx } from '../src/render/hoard_boulder';
import {
  BOULDER_LOOK,
  boulderPose,
  boulderReturnPose,
  makeBoulderPose,
  shardFlight,
  supportRing,
} from '../src/render/hoard_boulder_core';
import {
  BOULDER,
  boulderProgress,
  boulderRunsOver,
  boulderTravelSec,
  standsWith,
  supportersNeeded,
} from '../src/sim/rift/hoard_boulder_core';
import type { IWorld } from '../src/world_api';
import type { HoardBossCueView } from '../src/world_api/dungeons';

const TRAVEL = 2;
const TOTAL = BOULDER.warningSec + TRAVEL;

describe('the boulder look (pure)', () => {
  it('is hefted over his head through the warning, then thrown down and rolls', () => {
    const early = boulderPose(0.2, TOTAL, TRAVEL, 18, makeBoulderPose());
    expect(early.progress).toBe(0);
    expect(early.scale).toBeGreaterThan(0);
    expect(early.scale).toBeLessThan(1);
    const held = boulderPose(BOULDER.warningSec - 0.05, TOTAL, TRAVEL, 18, makeBoulderPose());
    expect(held.progress).toBe(0);
    expect(held.scale).toBe(1);
    expect(held.height).toBeCloseTo(BOULDER.boulderRadius + BOULDER_LOOK.heftHeight, 3);
    expect(held.roll).toBe(0);
    const rolling = boulderPose(BOULDER.warningSec + 1.2, TOTAL, TRAVEL, 18, makeBoulderPose());
    expect(rolling.height).toBeLessThan(BOULDER.boulderRadius + 1.5);
    expect(rolling.dust).toBeGreaterThan(0);
    const arrived = boulderPose(TOTAL, TOTAL, TRAVEL, 18, makeBoulderPose());
    expect(arrived.progress).toBe(1);
    // On the floor exactly as it arrives: what is judged is what is seen.
    expect(arrived.height).toBeCloseTo(BOULDER.boulderRadius, 6);
  });

  it('is exactly where the sim says it is, and turns as far as it has rolled', () => {
    for (const elapsed of [BOULDER.warningSec + 0.3, BOULDER.warningSec + 1, TOTAL - 0.1]) {
      const pose = boulderPose(elapsed, TOTAL, TRAVEL, 18, makeBoulderPose());
      expect(pose.progress).toBe(boulderProgress(elapsed, TOTAL, TRAVEL));
      expect(pose.roll).toBeCloseTo((pose.progress * 18) / BOULDER.boulderRadius, 9);
    }
  });

  it('goes back in a flat arc, turning the other way, and lands on the floor', () => {
    const mid = boulderReturnPose(0.5, 1, 16, makeBoulderPose());
    expect(mid.progress).toBeCloseTo(0.5, 9);
    expect(mid.height).toBeGreaterThan(BOULDER.boulderRadius + 2);
    expect(mid.roll).toBeLessThan(0);
    expect(boulderReturnPose(1, 1, 16, makeBoulderPose()).height).toBeCloseTo(
      BOULDER.boulderRadius,
      6,
    );
  });

  it('throws its pieces outward from where they sat, down to the floor, and away', () => {
    const out = { x: 0, y: 0, z: 0, spin: 0, scale: 1 };
    shardFlight(2, 0, 1, 0.5, 0, out);
    expect(out).toMatchObject({ x: 1, y: 0.5, z: 0, scale: 1 });
    shardFlight(2, 0.4, 1, 0.5, 0, out);
    expect(out.x).toBeGreaterThan(2.5);
    expect(out.z).toBeCloseTo(0, 9);
    shardFlight(2, BOULDER.crushSec, 1, 0.5, 0, out);
    expect(out.scale).toBeCloseTo(0, 6);
    // Never under the floor (the offsets are from the rock's centre, a radius up).
    expect(out.y).toBeGreaterThanOrEqual(-BOULDER.boulderRadius);
  });

  it('shows what the ring asks and how far it has been answered', () => {
    const out = { ring: 0, answered: 0, pips: 0 };
    supportRing(1, 2, 1, out);
    expect(out).toMatchObject({ ring: 1, pips: 2, answered: 0.5 });
    supportRing(1, 2, 5, out);
    expect(out.answered).toBe(1);
    // Every count the sim can ask for has a pip.
    for (let living = 1; living <= 12; living++)
      expect(supportersNeeded(living)).toBeLessThanOrEqual(BOULDER_LOOK.pips);
  });
});

function cue(partial: Partial<HoardBossCueView> & { variant: HoardBossCueView['variant'] }) {
  return {
    instanceId: 1,
    cueId: 6,
    kind: 'mark',
    phase: 'warning',
    x: 10,
    z: -20,
    radius: BOULDER.supportRadius,
    innerRadius: 2,
    targetId: 50,
    remaining: TOTAL,
    total: TOTAL,
    ...partial,
  } as HoardBossCueView;
}
const carrier = (more: Partial<HoardBossCueView> = {}) =>
  cue({
    variant: 'brute-boulder-throw',
    kind: 'sweep',
    cueId: 5,
    x: 10,
    z: -2,
    facing: Math.PI,
    halfAngle: Math.PI,
    innerRadius: undefined,
    targetId: undefined,
    total: 12,
    remaining: 10,
    ...more,
  });
const rolling = (elapsed: number, more: Partial<HoardBossCueView> = {}) =>
  cue({ variant: 'brute-boulder', remaining: TOTAL - elapsed, ...more });
const CALM_OFF = () => false;
const named = (scene: THREE.Scene, name: string): THREE.Object3D[] => {
  const out: THREE.Object3D[] = [];
  scene.traverse((node) => {
    if (node.name === name) out.push(node);
  });
  return out;
};
const shown = (scene: THREE.Scene, name: string) =>
  named(scene, name).filter((node) => node.visible).length;
const first = (scene: THREE.Scene, name: string) =>
  named(scene, name).find((node) => node.visible) as THREE.Mesh;

function worldOf(players: Array<{ id: number; x: number; z: number; dead?: boolean }>): IWorld {
  const entities = new Map(
    players.map((p) => [
      p.id,
      { id: p.id, kind: 'player', dead: !!p.dead, pos: { x: p.x, y: 0, z: p.z } },
    ]),
  );
  return { entities } as unknown as IWorld;
}
const make = (
  scene: THREE.Scene,
  world?: IWorld,
  tier: 'high' | 'low' = 'high',
  shake?: (n: number) => void,
) => new HoardBoulderFx(scene, () => 0, world, undefined, CALM_OFF, shake, tier, new THREE.Group());

describe('the adapter', () => {
  it('hides its cues from the generic floor telegraph', async () => {
    const scene = new THREE.Scene();
    const generic = new HoardBossFx(scene, () => 0);
    await generic.readyForEntry;
    generic.sync([
      carrier(),
      rolling(1),
      cue({ variant: 'brute-boulder-return', cueId: 7 }),
      cue({ variant: 'brute-boulder-crush', cueId: 8 }),
    ]);
    const root = scene.getObjectByName('hoard-boss-actionable-cues');
    expect(root?.children.every((slot) => !slot.visible)).toBe(true);
    generic.dispose();
  });

  it('puts the rock exactly on the path the sim rolls it along', async () => {
    const scene = new THREE.Scene();
    const fx = make(scene);
    await fx.readyForEntry;
    fx.update(0.016);
    expect(shown(scene, 'Boulder')).toBe(0);
    // Hefted: over HIS head, where the carrier is.
    fx.sync([carrier(), rolling(1)]);
    fx.update(0.016);
    const rock = first(scene, 'Boulder');
    expect(rock.position.x).toBeCloseTo(10, 1);
    expect(rock.position.z).toBeCloseTo(-2, 6);
    expect(rock.position.y).toBeGreaterThan(BOULDER.boulderRadius + 3);
    // Rolling: on the line from him to the mark, at the sim's progress, and a
    // player standing under the drawn rock IS run over by the sim's.
    const elapsed = BOULDER.warningSec + 1.4;
    fx.sync([carrier(), rolling(elapsed)]);
    fx.update(0.016);
    const p = boulderProgress(elapsed, TOTAL, TRAVEL);
    expect(rock.position.z).toBeCloseTo(-2 + (-20 - -2) * p, 5);
    expect(rock.position.x).toBeCloseTo(10, 6);
    expect(
      boulderRunsOver(10, -2, 10, -20, p - 0.02, p, rock.position.x, rock.position.z, 0.5),
    ).toBe(true);
    fx.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('reads a second boulder off its own staggered clock', async () => {
    const scene = new THREE.Scene();
    const fx = make(scene);
    await fx.readyForEntry;
    const total = BOULDER.warningSec + BOULDER.doubleStaggerSec + TRAVEL;
    // Still in his hands through its stagger, though the first warning is over.
    fx.sync([
      carrier(),
      cue({ variant: 'brute-boulder', cueId: 7, total, remaining: total - BOULDER.warningSec - 1 }),
    ]);
    fx.update(0.016);
    expect(first(scene, 'Boulder').position.z).toBeCloseTo(-2, 6);
    fx.dispose();
  });

  it('draws a green ring where standing counts, with a pip for each ally it asks', async () => {
    const scene = new THREE.Scene();
    const world = worldOf([
      { id: 50, x: 10, z: -20 }, // the mark never counts for itself
      { id: 51, x: 12, z: -21 },
      { id: 52, x: 10 + BOULDER.supportRadius + 1, z: -20 }, // outside
      { id: 53, x: 11, z: -19, dead: true },
    ]);
    const fx = make(scene, world);
    await fx.readyForEntry;
    fx.sync([carrier(), rolling(1)]);
    fx.update(0.016);
    expect(shown(scene, 'BoulderRing')).toBe(1);
    expect(shown(scene, 'BoulderLane')).toBe(0);
    expect(shown(scene, 'BoulderPip')).toBe(2);
    const ring = first(scene, 'BoulderRing');
    const position = ring.geometry.getAttribute('position');
    for (let column = 0; column < position.count / 2; column++) {
      const ox = position.getX(column * 2 + 1);
      const oz = position.getZ(column * 2 + 1);
      // Its outer edge IS the sim's support radius: just inside counts, just outside does not.
      const scale = (r: number) => [10 + (ox - 10) * r, -20 + (oz + 20) * r] as const;
      expect(standsWith(10, -20, ...scale(0.99))).toBe(true);
      expect(standsWith(10, -20, ...scale(1.01))).toBe(false);
    }
    // One of the two it asks for is standing there: one pip lit.
    const lit = named(scene, 'BoulderPip').filter(
      (pip) => pip.visible && (pip as THREE.Mesh).scale.x > 0.7,
    );
    expect(lit).toHaveLength(1);
    expect(
      ((ring as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.tint.value.getHex(),
    ).toBe(BOULDER_LOOK.stand);
    fx.dispose();
  });

  it('keeps the ring, its pips and the count on ONE circle when the mark is moved', async () => {
    const scene = new THREE.Scene();
    const fx = make(scene);
    await fx.readyForEntry;
    fx.sync([carrier(), rolling(1)]);
    fx.update(0.016);
    // The rooted mark is knocked aside: the cue rides them, so the ring follows.
    fx.sync([carrier(), rolling(1.2, { x: 16, z: -23 })]);
    fx.update(0.016);
    const position = first(scene, 'BoulderRing').geometry.getAttribute('position');
    for (let column = 0; column < position.count / 2; column++) {
      const d = Math.hypot(position.getX(column * 2 + 1) - 16, position.getZ(column * 2 + 1) + 23);
      expect(d).toBeCloseTo(BOULDER.supportRadius, 4);
    }
    const pip = first(scene, 'BoulderPip');
    expect(Math.hypot(pip.position.x - 16, pip.position.z + 23)).toBeCloseTo(
      BOULDER.supportRadius,
      4,
    );
    fx.dispose();
  });

  it('bakes the model once and shares it between rigs', async () => {
    const scene = new THREE.Scene();
    const fx = make(scene);
    await fx.readyForEntry;
    const bodies = named(scene, 'Boulder') as THREE.Group[];
    expect(bodies).toHaveLength(2);
    expect((bodies[0].children[0] as THREE.Mesh).geometry).toBe(
      (bodies[1].children[0] as THREE.Mesh).geometry,
    );
    const shards = named(scene, 'BoulderShard') as THREE.Mesh[];
    expect(shards[0].geometry).toBe(shards[BOULDER_LOOK.shards].geometry);
    fx.dispose();
  });

  it('alone draws the lane instead, as wide as the rock, from him to its end', async () => {
    const scene = new THREE.Scene();
    const fx = make(scene);
    await fx.readyForEntry;
    fx.sync([carrier(), rolling(1, { innerRadius: 0, targetId: undefined })]);
    fx.update(0.016);
    expect(shown(scene, 'BoulderRing')).toBe(0);
    expect(shown(scene, 'BoulderPip')).toBe(0);
    expect(shown(scene, 'BoulderLane')).toBe(1);
    const lane = first(scene, 'BoulderLane').geometry.getAttribute('position');
    expect(Math.abs(lane.getX(0) - lane.getX(1))).toBeCloseTo(BOULDER.boulderRadius * 2, 5);
    expect(lane.getZ(0)).toBeCloseTo(-2, 6);
    expect(lane.getZ(2)).toBeCloseTo(-20, 6);
    fx.dispose();
  });

  it('throws it back along the same line, then breaks it into its pieces', async () => {
    const scene = new THREE.Scene();
    const shakes: number[] = [];
    const fx = make(scene, undefined, 'high', (n) => shakes.push(n));
    await fx.readyForEntry;
    fx.sync([carrier(), rolling(1)]);
    fx.update(0.016);
    fx.sync([
      carrier(),
      cue({ variant: 'brute-boulder-return', total: 1, remaining: 0.5, targetId: undefined }),
    ]);
    fx.update(0.016);
    expect(shown(scene, 'BoulderRing')).toBe(0);
    const rock = first(scene, 'Boulder');
    expect(rock.position.z).toBeCloseTo(-11, 5);
    // Broken at HIS feet: the rock is gone, its pieces fly, the camera jolts.
    fx.sync([
      cue({
        variant: 'brute-boulder-crush',
        x: 10,
        z: -2,
        innerRadius: 1,
        targetId: undefined,
        total: BOULDER.crushSec,
        remaining: BOULDER.crushSec - 0.2,
      }),
    ]);
    fx.update(0.016);
    expect(shown(scene, 'Boulder')).toBe(0);
    expect(shown(scene, 'BoulderShard')).toBe(BOULDER_LOOK.shards);
    expect(shakes).toHaveLength(1);
    fx.sync([]);
    fx.update(0.016);
    expect(shown(scene, 'BoulderShard')).toBe(0);
    fx.dispose();
  });

  it('never carries the last boulder onto a reused rig', async () => {
    const scene = new THREE.Scene();
    const fx = make(scene);
    await fx.readyForEntry;
    fx.sync([carrier(), rolling(BOULDER.warningSec + 1)]);
    fx.update(0.016);
    fx.sync([]);
    fx.update(0.016);
    // The same ids in another hoard, somewhere else, freshly cast.
    fx.sync([
      carrier({ instanceId: 2, x: 300, z: -60 }),
      rolling(0.5, { instanceId: 2, x: 300, z: -80 }),
    ]);
    fx.update(0.016);
    const rock = first(scene, 'Boulder');
    expect(rock.position.x).toBeCloseTo(300, 0);
    expect(rock.position.z).toBeCloseTo(-60, 5);
    fx.dispose();
  });

  it('puts the late Blender asset in place BEFORE the compile gate sees the root', async () => {
    const asset = new THREE.Group();
    const holder = new THREE.Group();
    holder.name = 'Boulder_ROOT';
    for (const name of ['Boulder_Rock', 'Boulder_Shard_00']) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ name: 'BoulderStone' }),
      );
      mesh.name = name;
      mesh.position.set(name === 'Boulder_Rock' ? 0 : 1.5, 0, 0);
      holder.add(mesh);
    }
    asset.add(holder);
    let deliver: (value: THREE.Group) => void = () => {};
    const late = new Promise<THREE.Group>((resolve) => {
      deliver = resolve;
    });
    const seen: number[] = [];
    const scene = new THREE.Scene();
    const gate = async (root: THREE.Object3D) => {
      let boxes = 0;
      root.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry.getAttribute('position').count === 24) boxes++;
      });
      seen.push(boxes);
    };
    const fx = new HoardBoulderFx(
      scene,
      () => 0,
      undefined,
      gate,
      CALM_OFF,
      undefined,
      'high',
      late,
    );
    expect(scene.children).toHaveLength(0);
    deliver(asset);
    await fx.readyForEntry;
    // The rock and its one shard, on each of the two rigs, baked in before the gate ran.
    expect(seen).toEqual([4]);
    expect(holder.children).toHaveLength(2); // the cached asset is never mutated
    // A shard is re-centred on its own middle.
    const shard = named(scene, 'BoulderShard')[0] as THREE.Mesh;
    shard.geometry.computeBoundingBox();
    expect(shard.geometry.boundingBox?.getCenter(new THREE.Vector3()).length()).toBeCloseTo(0, 5);
    fx.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('frees what it owns exactly once, and never the shared surface materials', async () => {
    const scene = new THREE.Scene();
    const fx = make(scene);
    await fx.readyForEntry;
    const owned = new Map<string, number>();
    const shared = new Map<string, number>();
    const listening = new Set<string>();
    scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.geometry || !mesh.material) return;
      if (!listening.has(mesh.geometry.uuid)) {
        listening.add(mesh.geometry.uuid);
        mesh.geometry.addEventListener('dispose', () =>
          owned.set(mesh.geometry.uuid, (owned.get(mesh.geometry.uuid) ?? 0) + 1),
        );
      }
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (listening.has(material.uuid)) continue;
        listening.add(material.uuid);
        const lit =
          (material as THREE.MeshStandardMaterial).isMeshStandardMaterial ||
          (material as THREE.MeshLambertMaterial).isMeshLambertMaterial;
        const bucket = lit ? shared : owned;
        material.addEventListener('dispose', () =>
          bucket.set(material.uuid, (bucket.get(material.uuid) ?? 0) + 1),
        );
      }
    });
    fx.dispose();
    fx.dispose();
    expect(owned.size).toBeGreaterThan(8);
    expect([...owned.values()].every((count) => count === 1)).toBe(true);
    expect(shared.size).toBe(0);
  });

  it('on the low tier sheds only the dust, and keeps everything a player acts on', async () => {
    const high = new THREE.Scene();
    const low = new THREE.Scene();
    const a = make(high, undefined, 'high');
    const b = make(low, undefined, 'low');
    await Promise.all([a.readyForEntry, b.readyForEntry]);
    const count = (scene: THREE.Scene, type: string) => {
      let n = 0;
      scene.traverse((node) => {
        if (node.type === type) n++;
      });
      return n;
    };
    expect(count(high, 'Points')).toBe(1);
    expect(count(low, 'Points')).toBe(0);
    expect(named(high, 'BoulderShadow')).toHaveLength(2);
    // The shadow says where an airborne boulder is: it draws on every tier.
    expect(named(low, 'BoulderShadow')).toHaveLength(2);
    b.sync([carrier(), rolling(BOULDER.warningSec + 1)]);
    b.update(0.016);
    expect(shown(low, 'Boulder')).toBe(1);
    expect(shown(low, 'BoulderRing')).toBe(1);
    expect(shown(low, 'BoulderPip')).toBe(2);
    a.dispose();
    b.dispose();
  });
});

describe('the shipped Blender boulder', () => {
  it('exists, keeps its named parts, is small, and is as wide as the rock that hits', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    expect(ASSETS.map((a) => a.target)).toEqual([`public${BOULDER_ASSET_URL}`]);
    const asset = ASSETS[0];
    expect(existsSync(asset.source)).toBe(true);
    expect(existsSync(asset.target)).toBe(true);
    const shipped = (await io.read(asset.target)).getRoot();
    expect(
      shipped
        .listNodes()
        .map((node) => node.getName())
        .sort(),
    ).toEqual(asset.nodes);
    expect(asset.nodes.filter((n) => n.startsWith('Boulder_Shard_'))).toHaveLength(
      BOULDER_LOOK.shards,
    );
    expect((shipped.getExtras() as { authoring?: string }).authoring).toBe('Blender');
    expect(shipped.listTextures()).toHaveLength(0);
    let triangles = 0;
    for (const mesh of shipped.listMeshes())
      for (const primitive of mesh.listPrimitives())
        triangles += (primitive.getIndices()?.getCount() ?? 0) / 3;
    expect(triangles).toBeLessThan(1500);
    // The unoptimized export, in metres: centred on the origin, never wider than
    // the hitbox, and close to it.
    const root = (
      await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(asset.source)
    ).getRoot();
    const v = [0, 0, 0];
    let widest = 0;
    for (const node of root.listNodes()) {
      if (node.getName() !== 'Boulder_Rock' && node.getName() !== 'Boulder_Bands') continue;
      for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
        const position = primitive.getAttribute('POSITION');
        if (!position) continue;
        for (let i = 0; i < position.getCount(); i++) {
          position.getElement(i, v);
          widest = Math.max(widest, Math.hypot(v[0], v[1], v[2]));
        }
      }
    }
    expect(widest).toBeLessThanOrEqual(BOULDER.boulderRadius + 1e-3);
    expect(widest).toBeGreaterThan(BOULDER.boulderRadius * 0.95);
    expect(boulderTravelSec(0)).toBe(BOULDER.minTravelSec);
  });
});
