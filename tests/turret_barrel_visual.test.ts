import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { setBuildSpanSink } from '../src/render/build_spans';
import { CannonPuffBursts } from '../src/render/cannon_puff_burst_core';
import { PUFF } from '../src/render/cannon_puff_core';
import { drawProgramSignature } from '../src/render/draw_program_signature_core';
import { floorVfxRenderOrder } from '../src/render/floor_vfx_layer';
import {
  TURRET_BARREL_FIRE_PUFFS,
  TURRET_BARREL_LOOK,
  TURRET_BARREL_SHARDS,
  TURRET_FUSE_FIXED_PUFFS,
  turretBarrelCounts,
} from '../src/render/turret_barrel_core';
import {
  TURRET_BARREL_BURSTS,
  TURRET_BARREL_MATERIAL_PREFIX,
  TURRET_BARREL_NAME,
  TurretBarrelVisual,
  turretBarrelBlast,
} from '../src/render/turret_barrel_visual';
import { TURRET_CONTACT_PUFFS } from '../src/render/turret_contact_dust_core';
import {
  buildWorldQuestTraceStandIn,
  worldQuestTraceMaterials,
} from '../src/render/world_quest_trace_materials';
import { TURRET_EXPLOSIVE_BARREL } from '../src/sim/content/turret_defense';
import type { TurretEvent } from '../src/sim/minigames/turret_defense';
import { DT } from '../src/sim/types';
import type { TurretSessionView } from '../src/world_api/vehicles';
import { drawsUnder, threeProgramKeys } from './helpers/three_program_keys';

type Barrel = TurretSessionView['defense']['barrels'][number];

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** fuel_a_barrel_dirty.glb's shape as GLTFLoader builds it: one drum mesh on its kit material. */
function drumModel(): THREE.Group {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0 });
  material.name = 'resource';
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.008, 0.75), material);
  mesh.position.y = 0.504;
  scene.add(mesh);
  return scene;
}

function barrel(over: Partial<Barrel> = {}): Barrel {
  return { id: 1, x: 10, y: 2, z: 20, litTick: -1, blowTick: -1, ...over };
}

async function built(gate = vi.fn((_t: THREE.Object3D) => Promise.resolve())) {
  const parent = new THREE.Group();
  const source = vi.fn(async () => drumModel());
  const visual = new TurretBarrelVisual(() => 2, gate, source);
  visual.prepare(parent);
  await flush();
  return { visual, parent, source, gate };
}

function slotRoots(visual: TurretBarrelVisual): THREE.Group[] {
  const drums = visual.group.getObjectByName(`${TURRET_BARREL_NAME}:drums`);
  return (drums?.children ?? []) as THREE.Group[];
}

function rings(visual: TurretBarrelVisual): THREE.Mesh[] {
  return visual.rings.children as THREE.Mesh[];
}

function shardMesh(visual: TurretBarrelVisual): THREE.InstancedMesh {
  const mesh = visual.group.getObjectByName(`${TURRET_BARREL_MATERIAL_PREFIX}shards`);
  if (!mesh) throw new Error('no shards');
  return mesh as THREE.InstancedMesh;
}

describe('the barrel visual', () => {
  it('builds at the commitment: rings at once, shards and drums each behind the gate', async () => {
    const gate = vi.fn((_t: THREE.Object3D) => new Promise<void>(() => {}));
    const spans: string[] = [];
    setBuildSpanSink((kind) => spans.push(kind));
    const { visual, parent, source } = await built(gate);
    setBuildSpanSink(null);
    expect(source).toHaveBeenCalledTimes(1);
    expect(spans.filter((kind) => kind === 'zone:turret-barrels')).toHaveLength(1);
    expect(visual.rings.parent).toBe(parent);
    expect(visual.group.parent).toBe(parent);
    expect(rings(visual)).toHaveLength(TURRET_EXPLOSIVE_BARREL.cap);
    const gated = gate.mock.calls.map(([target]) => target.name);
    expect(gated).toEqual([`${TURRET_BARREL_NAME}:shards`, `${TURRET_BARREL_NAME}:drums`]);
    for (const [target] of gate.mock.calls) expect(target.visible).toBe(false);
    expect(slotRoots(visual)).toHaveLength(TURRET_EXPLOSIVE_BARREL.cap);
    visual.prepare(parent);
    expect(source).toHaveBeenCalledTimes(1);
    visual.dispose();
  });

  it('draws its warning rings on the programs the world-quest-trace prewarm stages', async () => {
    const { visual } = await built();
    visual.update([barrel(), barrel({ id: 2, x: -5, litTick: 10, blowTick: 15 })], false, 12, 5);
    const staged = drawsUnder(buildWorldQuestTraceStandIn());
    const signatures = new Set(staged.map((d) => drawProgramSignature(d.object, d.material)));
    const keys = new Set(staged.flatMap((d) => threeProgramKeys(d.material, d.object).split('\n')));
    const draws = drawsUnder(visual.rings);
    expect(draws).toHaveLength(TURRET_EXPLOSIVE_BARREL.cap);
    for (const draw of draws) {
      expect(signatures.has(drawProgramSignature(draw.object, draw.material))).toBe(true);
      for (const key of threeProgramKeys(draw.material, draw.object).split('\n')) {
        expect(keys.has(key)).toBe(true);
      }
    }
    visual.dispose();
  });

  it('stands a drum sized to the sim on a gold ring where the barrel is, popping up when new', async () => {
    const { visual } = await built();
    const b = barrel();
    visual.update([b], false, 100, 5);
    const [ring] = rings(visual).filter((r) => r.visible);
    expect(ring.material).toBe(worldQuestTraceMaterials().gold);
    expect(ring.position.toArray()).toEqual([10, 2 + TURRET_BARREL_LOOK.ringLift, 20]);
    expect(ring.renderOrder).toBe(floorVfxRenderOrder('encounter'));
    const root = slotRoots(visual).find((r) => r.visible) ?? null;
    // First seen this very frame: its pop has not begun.
    expect(root).toBeNull();
    visual.update([b], false, 101, 5 + TURRET_BARREL_LOOK.popSeconds / 2);
    const drum = slotRoots(visual).find((r) => r.visible);
    expect(drum).toBeDefined();
    expect(drum?.scale.x).toBeGreaterThan(0.5);
    visual.update([b], false, 102, 5 + TURRET_BARREL_LOOK.popSeconds);
    expect(drum?.scale.x).toBe(1);
    expect(drum?.position.toArray()).toEqual([10, 2, 20]);
    // The model's height is the sim's drum height, its foot on the barrel's ground.
    drum?.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(drum as THREE.Object3D);
    expect(box.max.y - box.min.y).toBeCloseTo(TURRET_EXPLOSIVE_BARREL.height, 6);
    expect(box.min.y).toBeCloseTo(2, 6);
    expect(Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2).toBeLessThanOrEqual(
      TURRET_EXPLOSIVE_BARREL.radius * Math.SQRT2,
    );
    visual.dispose();
  });

  it('turns the ring red and rattles and swells the drum through the fuse; a lost session holds it still', async () => {
    const { visual } = await built();
    const b = barrel({ litTick: 100, blowTick: 105 });
    visual.update([barrel()], false, 90, 0);
    visual.update([b], false, 104.5, 1);
    const [ring] = rings(visual).filter((r) => r.visible);
    expect(ring.material).toBe(worldQuestTraceMaterials().red);
    const drum = slotRoots(visual).find((r) => r.visible) as THREE.Group;
    expect(drum.scale.x).toBeGreaterThan(1.05);
    const moved =
      Math.hypot(drum.position.x - 10, drum.position.z - 20) + Math.abs(drum.rotation.x);
    expect(moved).toBeGreaterThan(0);
    visual.update([b], true, 104.5, 1.1);
    expect(ring.material).toBe(worldQuestTraceMaterials().gold);
    expect(drum.scale.x).toBe(1);
    expect(drum.position.toArray()).toEqual([10, 2, 20]);
    visual.dispose();
  });

  it('keeps each barrel on its slot and frees the slot of one gone', async () => {
    const { visual } = await built();
    const a = barrel({ id: 1 });
    const b = barrel({ id: 2, x: 30 });
    visual.update([a, b], false, 0, 0);
    visual.update([a, b], false, 1, 1);
    const drumOf = (x: number) => slotRoots(visual).find((r) => r.visible && r.position.x === x);
    const second = drumOf(30);
    visual.update([b], false, 2, 2);
    expect(drumOf(30)).toBe(second);
    expect(drumOf(10)).toBeUndefined();
    expect(rings(visual).filter((r) => r.visible)).toHaveLength(1);
    visual.update([], false, 3, 3);
    expect(rings(visual).filter((r) => r.visible)).toHaveLength(0);
    visual.dispose();
  });

  it('lights a fuse on one pooled burst and blows its fire column across two', async () => {
    const { visual } = await built();
    const bursts = new CannonPuffBursts(4, TURRET_CONTACT_PUFFS);
    const lit: TurretEvent = { type: 'barrelLit', id: 3, x: 10, y: 2, z: 20, fuseTicks: 5 };
    visual.light(lit as Extract<TurretEvent, { type: 'barrelLit' }>, bursts.take(7), 7);
    const fuse = bursts.slots[0];
    expect(fuse.count).toBe(TURRET_FUSE_FIXED_PUFFS + turretBarrelCounts(false).fuseSparks);
    expect(fuse.puffs[0]).toMatchObject({ kind: PUFF.glow, x: 10, z: 20 });
    expect(fuse.puffs[0].y).toBeGreaterThan(2 + TURRET_EXPLOSIVE_BARREL.height);
    expect(fuse.life).toBeGreaterThanOrEqual(0.25);
    expect(fuse.at).toBe(7);
    const take = vi.fn((now: number) => bursts.take(now));
    const blast = {
      type: 'barrelExploded',
      id: 3,
      x: 10,
      y: 2,
      z: 20,
      hits: [],
    } as Extract<TurretEvent, { type: 'barrelExploded' }>;
    visual.explode(blast, take, 7.1);
    expect(take).toHaveBeenCalledTimes(2);
    const fire = bursts.slots.filter((s) => s !== fuse && s.active);
    expect(fire.reduce((n, s) => n + s.count, 0)).toBe(TURRET_BARREL_FIRE_PUFFS);
    for (const s of fire) expect(s.life).toBeGreaterThan(0.5);
    visual.dispose();
  });

  it('keeps a whole chain on its bursts: every fuse and fire column alive at once, none stolen', async () => {
    const { visual } = await built();
    const bursts = new CannonPuffBursts(TURRET_BARREL_BURSTS, TURRET_CONTACT_PUFFS);
    const take = (now: number) => {
      const free = bursts.slots.some((s) => !s.active || (s.life > 0 && now - s.at >= s.life));
      expect(free).toBe(true);
      return bursts.take(now);
    };
    const fuse = TURRET_EXPLOSIVE_BARREL.fuseTicks * DT;
    const lit = (id: number) =>
      ({ type: 'barrelLit', id, x: 10 * id, y: 0, z: 0, fuseTicks: 5 }) as Extract<
        TurretEvent,
        { type: 'barrelLit' }
      >;
    const blown = (id: number) =>
      ({ type: 'barrelExploded', id, x: 10 * id, y: 0, z: 0, hits: [] }) as Extract<
        TurretEvent,
        { type: 'barrelExploded' }
      >;
    // A ripple through the cap: each blast lights the next as it blows.
    visual.light(lit(1), take(0), 0);
    for (let id = 1; id <= TURRET_EXPLOSIVE_BARREL.cap; id++) {
      const now = id * fuse;
      visual.explode(blown(id), take, now);
      if (id < TURRET_EXPLOSIVE_BARREL.cap) visual.light(lit(id + 1), take(now), now);
    }
    const alive = bursts.slots.filter((s) => s.active && s.count > 0);
    expect(alive.length).toBeGreaterThan(12);
    visual.dispose();
  });

  it("throws the drum's shards and lets them fall and fade within their life", async () => {
    const { visual } = await built();
    const blast = {
      type: 'barrelExploded',
      id: 3,
      x: 10,
      y: 2,
      z: 20,
      hits: [],
    } as Extract<TurretEvent, { type: 'barrelExploded' }>;
    visual.update([], false, 0, 1);
    expect(shardMesh(visual).visible).toBe(false);
    visual.explode(blast, () => null, 1);
    visual.update([], false, 0, 1.3);
    const mesh = shardMesh(visual);
    expect(mesh.visible).toBe(true);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    let above = 0;
    for (let i = 0; i < TURRET_BARREL_SHARDS.perBlast; i++) {
      mesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      if (p.y > 2.5) above++;
    }
    expect(above).toBeGreaterThan(TURRET_BARREL_SHARDS.perBlast / 2);
    visual.update([], false, 0, 1 + TURRET_BARREL_SHARDS.life + 0.01);
    expect(mesh.visible).toBe(false);
    expect(mesh.count).toBe(0);
    visual.dispose();
  });

  it('draws its blast through the cannon visuals wider and hotter than a shell, on no shell id', () => {
    const blast = turretBarrelBlast({
      type: 'barrelExploded',
      id: 3,
      x: 10,
      y: 2,
      z: 20,
      hits: [{ id: 1, falloff: 1, damage: 120, x: 10, y: 2, z: 21 }],
    });
    expect(blast).toMatchObject({
      shotId: -3,
      x: 10,
      y: 2,
      z: 20,
      radius: TURRET_EXPLOSIVE_BARREL.blastRadius,
      scale: TURRET_BARREL_LOOK.blastScale,
    });
    expect(blast.scale).toBeGreaterThan(1);
    expect(blast.hits).toHaveLength(1);
  });

  it('owns its named materials, disposing them and never the loader cache', async () => {
    const source = drumModel();
    const kit = (source.children[0] as THREE.Mesh).material as THREE.Material;
    const kitDispose = vi.spyOn(kit, 'dispose');
    const visual = new TurretBarrelVisual(
      () => 0,
      () => Promise.resolve(),
      async () => source,
    );
    visual.prepare(new THREE.Group());
    await flush();
    const mats = new Set<THREE.Material>();
    visual.group.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) mats.add(mesh.material as THREE.Material);
    });
    expect([...mats].every((m) => m.name.startsWith(TURRET_BARREL_MATERIAL_PREFIX))).toBe(true);
    expect(mats.has(kit)).toBe(false);
    const spies = [...mats].map((m) => vi.spyOn(m, 'dispose'));
    visual.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
    expect(kitDispose).not.toHaveBeenCalled();
    expect(visual.group.parent).toBeNull();
  });

  it('builds and attaches nothing when disposed while the model is still on its way', async () => {
    let arrive: (scene: THREE.Object3D) => void = () => {};
    const source = vi.fn(
      () =>
        new Promise<THREE.Object3D>((resolve) => {
          arrive = resolve;
        }),
    );
    const gate = vi.fn((_t: THREE.Object3D) => Promise.resolve());
    const visual = new TurretBarrelVisual(() => 0, gate, source);
    visual.prepare(new THREE.Group());
    await flush();
    visual.dispose();
    arrive(drumModel());
    await flush();
    expect(visual.modelReady).toBe(false);
    for (const root of slotRoots(visual)) expect(root.children).toHaveLength(0);
    expect(gate.mock.calls.map(([target]) => target.name)).toEqual([
      `${TURRET_BARREL_NAME}:shards`,
    ]);
  });

  it('never reveals the drums when disposed while their compile gate is pending', async () => {
    const pending: (() => void)[] = [];
    const gate = vi.fn(
      (_t: THREE.Object3D) =>
        new Promise<void>((resolve) => {
          pending.push(resolve);
        }),
    );
    const { visual } = await built(gate);
    const drums = visual.group.getObjectByName(`${TURRET_BARREL_NAME}:drums`) as THREE.Group;
    expect(drums.visible).toBe(false);
    visual.dispose();
    for (const resolve of pending) resolve();
    await flush();
    expect(drums.visible).toBe(false);
    expect(shardMesh(visual).parent?.visible).toBe(false);
  });

  it('lights, blows and draws nothing once disposed, and disposes once', async () => {
    const { visual } = await built();
    visual.update([barrel()], false, 0, 0);
    const ring = rings(visual)[0];
    const shards = shardMesh(visual);
    const owned = [ring.geometry, shards.geometry, shards.material as THREE.Material];
    const spies = owned.map((o) => vi.spyOn(o, 'dispose'));
    const drumMats = new Set<THREE.Material>();
    visual.group.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh && mesh !== shards) drumMats.add(mesh.material as THREE.Material);
    });
    const drumSpies = [...drumMats].map((m) => vi.spyOn(m, 'dispose'));
    const traceDispose = vi.spyOn(worldQuestTraceMaterials().gold, 'dispose');
    visual.dispose();
    visual.dispose();
    for (const spy of [...spies, ...drumSpies]) expect(spy).toHaveBeenCalledTimes(1);
    expect(traceDispose).not.toHaveBeenCalled();
    const bursts = new CannonPuffBursts(4, TURRET_CONTACT_PUFFS);
    const burst = bursts.take(1);
    const lit = { type: 'barrelLit', id: 3, x: 0, y: 0, z: 0, fuseTicks: 5 } as const;
    visual.light(lit, burst, 1);
    expect(burst?.count).toBe(0);
    const take = vi.fn((now: number) => bursts.take(now));
    visual.explode({ type: 'barrelExploded', id: 3, x: 0, y: 0, z: 0, hits: [] }, take, 1);
    expect(take).not.toHaveBeenCalled();
    expect(() => visual.update([barrel({ id: 9, x: 44 })], false, 1, 1)).not.toThrow();
    expect(ring.visible).toBe(true);
    expect(ring.position.x).toBe(10);
  });

  it('keeps its rings when the model fails to load, and tries the load again', async () => {
    const source = vi.fn(() => Promise.reject(new Error('streaming')));
    const onUnavailable = vi.fn();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const visual = new TurretBarrelVisual(() => 0, undefined, source);
    const parent = new THREE.Group();
    visual.prepare(parent, onUnavailable);
    await flush();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(visual.prepared).toBe(false);
    visual.update([barrel()], false, 0, 0);
    expect(rings(visual).filter((r) => r.visible)).toHaveLength(1);
    visual.prepare(parent, onUnavailable);
    expect(source).toHaveBeenCalledTimes(2);
    expect(rings(visual)).toHaveLength(TURRET_EXPLOSIVE_BARREL.cap);
    errors.mockRestore();
    visual.dispose();
  });
});
