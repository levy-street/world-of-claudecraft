// The Fire and Fly arena built hidden at intent
// (src/render/fire_and_fly_arena_prebuild.ts): through the live path's builder
// and compile gate under a holder that never shows, on the same page-lifetime
// materials the live copy draws, and released exactly once.
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  GPU_QUEUE_SHUTDOWN_ERROR_NAME,
  GPU_WORK_PRIORITY,
} from '../src/render/background_gpu_queue';
import type { ArenaIntentWorld } from '../src/render/fire_and_fly_arena_intent_core';
import { ARENA_INTENT_LAPSE_MS } from '../src/render/fire_and_fly_arena_intent_core';
import {
  ARENA_WARM_LABEL,
  type ArenaPrebuildBuilder,
  type ArenaPrebuildQueue,
  FIRE_AND_FLY_PREBUILD_NAME,
  FireAndFlyArenaPrebuild,
} from '../src/render/fire_and_fly_arena_prebuild';
import { GFX } from '../src/render/gfx';
import type { IdleScheduler } from '../src/render/idle_queue';
import { openFieldInteriorBuilder } from '../src/render/open_field_interiors';
import {
  FIRE_AND_FLY_DUNGEON_DEFS,
  FIRE_AND_FLY_DUNGEON_ID,
} from '../src/sim/content/fire_and_fly_arena';
import {
  FIRE_AND_FLY_NPC_DEF,
  FIRE_AND_FLY_NPC_ID,
  FIRE_AND_FLY_QUEST_ID,
} from '../src/sim/content/world_quest_fire_and_fly';
import { instanceOrigin } from '../src/sim/data';

// The lean tier: the arena's canvas-painted cards need a DOM the Node run lacks.
vi.mock('../src/render/gfx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/gfx')>();
  return { ...actual, GFX: actual.gfxInternalsForTest.settingsFor('low') };
});

const ARENA_INDEX = FIRE_AND_FLY_DUNGEON_DEFS[FIRE_AND_FLY_DUNGEON_ID].index;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function world(targetId: number | null, seated = false): ArenaIntentWorld {
  return {
    player: {
      pos: { x: FIRE_AND_FLY_NPC_DEF.pos.x + 2, z: FIRE_AND_FLY_NPC_DEF.pos.z },
      level: 60,
      dead: false,
      ghost: false,
      targetId,
    },
    worldQuestLog: new Map([[FIRE_AND_FLY_QUEST_ID, { state: 'active' as const }]]),
    turretSession: seated ? {} : null,
  };
}

const talking = world(FIRE_AND_FLY_NPC_ID);
const passing = world(null);

function holderOf(scene: THREE.Object3D): THREE.Object3D | undefined {
  return scene.getObjectByName(FIRE_AND_FLY_PREBUILD_NAME);
}

function drawnUnder(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

function resources(root: THREE.Object3D): Set<unknown> {
  const found = new Set<unknown>();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh && !(node as THREE.Points).isPoints) return;
    found.add(mesh.material);
    // An instanced batch draws a per-build shell; every other mesh is cached.
    if (!(mesh as THREE.InstancedMesh).isInstancedMesh) found.add(mesh.geometry);
  });
  return found;
}

// Idle slots granted at once, so a test drives the whole warm chain in microtasks.
const now: IdleScheduler = (callback) => callback();
const noWarm = { warmSteps: () => [], idle: now };

describe('the Fire and Fly arena prebuild', () => {
  it('builds nothing until the player turns to Alder', () => {
    const scene = new THREE.Scene();
    const build = vi.fn<ArenaPrebuildBuilder>(() => Promise.resolve());
    const warmSteps = vi.fn(() => []);
    const prebuild = new FireAndFlyArenaPrebuild(scene, undefined, { build, warmSteps });
    for (let t = 0; t < 20; t++) prebuild.update(passing, t * 50);
    expect(build).not.toHaveBeenCalled();
    expect(warmSteps).not.toHaveBeenCalled();
    expect(prebuild.built).toBe(false);
    expect(scene.children).toHaveLength(0);
  });

  it('links the live arena hidden through the gate, on the materials the live copy draws', async () => {
    const scene = new THREE.Scene();
    const gated: THREE.Object3D[] = [];
    const gate = (target: THREE.Object3D) => {
      gated.push(target);
      return Promise.resolve();
    };
    const prebuild = new FireAndFlyArenaPrebuild(scene, gate, { idle: now });
    prebuild.update(talking, 0);
    prebuild.update(talking, 50);
    await flush();
    const holder = holderOf(scene);
    const arena = holder?.getObjectByName('fireAndFlyArena');
    expect(holder?.visible).toBe(false);
    expect(arena?.position.toArray()).toEqual([
      instanceOrigin(ARENA_INDEX, 0).x,
      0,
      instanceOrigin(ARENA_INDEX, 0).z,
    ]);
    // Every root of the copy passed the gate, the ground ahead of the rest.
    expect(gated.map((root) => root.name)).toEqual(['fireAndFlyGround', 'fireAndFlyDressing']);
    // The gate revealed the roots inside the holder; the holder itself never draws.
    for (const root of gated) expect(drawnUnder(root)).toBe(false);
    // The copy the player lands in (another slot) draws the very same materials
    // and cached meshes: their programs are the ones the prebuild linked.
    const field = openFieldInteriorBuilder('fire_and_fly');
    const live = field?.build({
      lowGfx: !GFX.standardMaterials,
      flames: [],
      fireLights: { push: () => 0 },
      origin: instanceOrigin(ARENA_INDEX, 7),
    });
    if (!arena || !live) throw new Error('no arena');
    const linked = resources(arena);
    expect(linked.size).toBeGreaterThanOrEqual(4);
    expect(resources(live)).toEqual(linked);
    prebuild.dispose();
    expect(holderOf(scene)).toBeUndefined();
  });

  it('fills the caches over idle slots before the build, and stops at a release', async () => {
    const scene = new THREE.Scene();
    const slots: (() => void)[] = [];
    // A spent idle period: one step each.
    const idle: IdleScheduler = (callback) =>
      slots.push(() => callback({ didTimeout: false, timeRemaining: () => 0.001 }));
    const ran: number[] = [];
    const build = vi.fn<ArenaPrebuildBuilder>(() => Promise.resolve());
    const warmSteps = () => [0, 1, 2].map((id) => () => void ran.push(id));
    const prebuild = new FireAndFlyArenaPrebuild(scene, undefined, { build, warmSteps, idle });
    prebuild.update(talking, 0);
    expect(ran).toEqual([]);
    const grant = async () => {
      slots.shift()?.();
      await flush();
    };
    await grant();
    expect(ran).toEqual([0]);
    await grant();
    await grant();
    expect(ran).toEqual([0, 1, 2]);
    expect(build).toHaveBeenCalledTimes(1);
    prebuild.dispose();

    const early = vi.fn<ArenaPrebuildBuilder>(() => Promise.resolve());
    ran.length = 0;
    const second = new FireAndFlyArenaPrebuild(scene, undefined, {
      build: early,
      warmSteps,
      idle,
    });
    second.update(talking, 0);
    await grant();
    second.update(world(FIRE_AND_FLY_NPC_ID, true), 50);
    await grant();
    await grant();
    expect(ran).toEqual([0]);
    expect(early).not.toHaveBeenCalled();
    expect(holderOf(scene)).toBeUndefined();
  });

  it('rides the preparation queue when one is lent: one approaching unit per step, in order', async () => {
    const units: { label?: string; priority?: number }[] = [];
    const pending: (() => void)[] = [];
    const queue: ArenaPrebuildQueue = {
      run: <T>(work: () => T | Promise<T>, priority?: number, label?: string) => {
        units.push({ label, priority });
        return new Promise<T>((resolve) => pending.push(() => resolve(work() as T)));
      },
    };
    const ran: number[] = [];
    const build = vi.fn<ArenaPrebuildBuilder>(() => Promise.resolve());
    const idle = vi.fn<IdleScheduler>();
    const prebuild = new FireAndFlyArenaPrebuild(new THREE.Scene(), undefined, {
      build,
      warmSteps: () => [0, 1, 2].map((id) => () => void ran.push(id)),
      idle,
    });
    prebuild.setQueue(queue);
    prebuild.update(talking, 0);
    // One unit in the queue at a time: the next is enqueued from the last one's completion.
    expect(units).toHaveLength(1);
    for (let i = 0; i < 3; i++) {
      pending.shift()?.();
      await flush();
    }
    expect(ran).toEqual([0, 1, 2]);
    expect(units.map((unit) => unit.label)).toEqual([
      `${ARENA_WARM_LABEL}:fire-and-fly:0`,
      `${ARENA_WARM_LABEL}:fire-and-fly:1`,
      `${ARENA_WARM_LABEL}:fire-and-fly:2`,
    ]);
    expect(new Set(units.map((unit) => unit.priority))).toEqual(
      new Set([GPU_WORK_PRIORITY.VISIBLE_PREWARM]),
    );
    expect(build).toHaveBeenCalledTimes(1);
    expect(idle).not.toHaveBeenCalled();
    prebuild.dispose();
  });

  it('drops a queued step once the copy is released, and a queue shutdown quietly', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const pending: (() => void)[] = [];
      const queue: ArenaPrebuildQueue = {
        run: <T>(work: () => T | Promise<T>) =>
          new Promise<T>((resolve) => pending.push(() => resolve(work() as T))),
      };
      const ran: number[] = [];
      const build = vi.fn<ArenaPrebuildBuilder>(() => Promise.resolve());
      const prebuild = new FireAndFlyArenaPrebuild(new THREE.Scene(), undefined, {
        build,
        warmSteps: () => [0, 1].map((id) => () => void ran.push(id)),
      });
      prebuild.setQueue(queue);
      prebuild.update(talking, 0);
      prebuild.update(world(FIRE_AND_FLY_NPC_ID, true), 50);
      pending.shift()?.();
      await flush();
      expect(ran).toEqual([]);
      expect(pending).toHaveLength(0);
      expect(build).not.toHaveBeenCalled();

      const shutdown = new Error('renderer gone');
      shutdown.name = GPU_QUEUE_SHUTDOWN_ERROR_NAME;
      const closed = new FireAndFlyArenaPrebuild(new THREE.Scene(), undefined, {
        build,
        warmSteps: () => [() => {}],
      });
      closed.setQueue({ run: () => Promise.reject(shutdown) });
      closed.update(talking, 0);
      await flush();
      expect(closed.built).toBe(false);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  it('runs as many steps as an idle period holds', async () => {
    const ran: number[] = [];
    const build = vi.fn<ArenaPrebuildBuilder>(() => Promise.resolve());
    const prebuild = new FireAndFlyArenaPrebuild(new THREE.Scene(), undefined, {
      build,
      warmSteps: () => [0, 1, 2, 3].map((id) => () => void ran.push(id)),
      idle: (callback) => callback({ didTimeout: false, timeRemaining: () => 1_000 }),
    });
    prebuild.update(talking, 0);
    await flush();
    expect(ran).toEqual([0, 1, 2, 3]);
    expect(build).toHaveBeenCalledTimes(1);
    prebuild.dispose();
  });

  it('warms the very meshes the build then draws, the hills in crown slices', async () => {
    vi.resetModules();
    const arena = await import('../src/render/fire_and_fly_arena');
    const core = await import('../src/render/fire_and_fly_arena_core');
    const crowns = core.fireAndFlyBackdropCrowns();
    const near = crowns.filter((crown) => crown.near).length;
    const slices = (n: number) => Math.ceil(n / arena.BACKDROP_CROWNS_PER_WARM_STEP);
    const steps = arena.fireAndFlyArenaWarmSteps(true);
    // The ground, then each hill ring in slices plus its merge (lean: no cover cards).
    expect(steps).toHaveLength(1 + slices(near) + 1 + slices(crowns.length - near) + 1);
    for (const step of steps) step();
    const origin = instanceOrigin(ARENA_INDEX, 3);
    const warmed = resources(arena.buildFireAndFlyArenaInterior({ lowGfx: true, origin }));
    expect(warmed.size).toBeGreaterThanOrEqual(4);
    // Once the caches are full the steps are no-ops and the build reuses them all.
    expect(arena.fireAndFlyArenaWarmSteps(true)).toHaveLength(1);
    expect(resources(arena.buildFireAndFlyArenaInterior({ lowGfx: true, origin }))).toEqual(warmed);
    // The sliced hills are the very mesh a cold build shapes in one go.
    vi.resetModules();
    const cold = await import('../src/render/fire_and_fly_arena');
    const hills = (root: THREE.Object3D) =>
      (root.getObjectByName('fireAndFlyBackdrop')?.children ?? []).map((mesh) =>
        Array.from(
          ((mesh as THREE.Mesh).geometry.getAttribute('position') as THREE.BufferAttribute).array,
        ),
      );
    const sliced = hills(arena.buildFireAndFlyArenaInterior({ lowGfx: true, origin }));
    expect(sliced).toHaveLength(2);
    expect(hills(cold.buildFireAndFlyArenaInterior({ lowGfx: true, origin }))).toEqual(sliced);
  });

  it('releases the copy exactly once: at the seat, then never again', async () => {
    const scene = new THREE.Scene();
    const released = vi.fn();
    const build: ArenaPrebuildBuilder = (holder, registry) => {
      holder.add(new THREE.Group());
      registry.add({ dispose: released });
      return Promise.resolve();
    };
    const prebuild = new FireAndFlyArenaPrebuild(scene, undefined, { ...noWarm, build });
    prebuild.update(talking, 0);
    await flush();
    expect(prebuild.built).toBe(true);
    prebuild.update(world(FIRE_AND_FLY_NPC_ID, true), 50);
    expect(released).toHaveBeenCalledTimes(1);
    expect(prebuild.built).toBe(false);
    expect(holderOf(scene)).toBeUndefined();
    prebuild.update(world(FIRE_AND_FLY_NPC_ID, true), 100);
    prebuild.dispose();
    expect(released).toHaveBeenCalledTimes(1);
  });

  it('releases a copy whose intent lapsed, and on teardown only what still stands', async () => {
    const scene = new THREE.Scene();
    const released: number[] = [];
    let copies = 0;
    const build: ArenaPrebuildBuilder = (_holder, registry) => {
      const id = copies++;
      registry.add({ dispose: () => released.push(id) });
      return Promise.resolve();
    };
    const prebuild = new FireAndFlyArenaPrebuild(scene, undefined, { ...noWarm, build });
    prebuild.update(talking, 0);
    await flush();
    prebuild.update(passing, ARENA_INTENT_LAPSE_MS - 1);
    expect(released).toEqual([]);
    prebuild.update(passing, ARENA_INTENT_LAPSE_MS);
    expect(released).toEqual([0]);
    prebuild.update(talking, ARENA_INTENT_LAPSE_MS + 50);
    await flush();
    expect(copies).toBe(2);
    prebuild.dispose();
    prebuild.dispose();
    expect(released).toEqual([0, 1]);
    prebuild.update(talking, ARENA_INTENT_LAPSE_MS + 100);
    expect(copies).toBe(2);
  });

  it('cancels a gate still pending on a released copy: nothing is revealed or attached late', async () => {
    const scene = new THREE.Scene();
    const settles: (() => void)[] = [];
    const gate = () => new Promise<void>((resolve) => settles.push(resolve));
    const prebuild = new FireAndFlyArenaPrebuild(scene, gate, { idle: now });
    prebuild.update(talking, 0);
    await flush();
    const arena = holderOf(scene)?.getObjectByName('fireAndFlyArena');
    expect(arena).toBeDefined();
    expect(settles.length).toBeGreaterThan(0);
    prebuild.update(world(FIRE_AND_FLY_NPC_ID, true), 50);
    for (const settle of settles) settle();
    await flush();
    expect(holderOf(scene)).toBeUndefined();
    expect(arena?.visible).toBe(false);
  });

  it('survives a builder that throws: no copy stands, the live path links at entry', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const scene = new THREE.Scene();
      const prebuild = new FireAndFlyArenaPrebuild(scene, undefined, {
        ...noWarm,
        build: () => {
          throw new Error('no foliage');
        },
      });
      prebuild.update(talking, 0);
      await flush();
      expect(prebuild.built).toBe(false);
      expect(holderOf(scene)).toBeUndefined();
      expect(errors).toHaveBeenCalledTimes(1);
    } finally {
      errors.mockRestore();
    }
  });
});
