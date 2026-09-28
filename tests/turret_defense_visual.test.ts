import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { visualKeyFor } from '../src/render/characters/manifest';
import { drawProgramSignature } from '../src/render/draw_program_signature_core';
import { floorVfxRenderOrder } from '../src/render/floor_vfx_layer';
import type { IdleBudget, IdleScheduler } from '../src/render/idle_queue';
import { turretBodyCapacity, turretRigCapacities } from '../src/render/turret_defense_pool_core';
import { TURRET_STAND_IN_HEIGHT } from '../src/render/turret_monster_pose_core';
import {
  buildWorldQuestTraceStandIn,
  worldQuestTraceMaterials,
} from '../src/render/world_quest_trace_materials';
import { TURRET_TIMING } from '../src/sim/content/turret_defense';
import { MOBS } from '../src/sim/data';
import {
  marchSegment,
  positionAt,
  stillSegment,
  type ThrowProbe,
} from '../src/sim/minigames/thrown_body';
import {
  createTurretDefense,
  type TurretDefenseState,
  type TurretMonster,
  tickTurretDefense,
} from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import type { TurretFeedback } from '../src/sim/minigames/turret_feedback';
import type { Entity } from '../src/sim/types';
import type { TurretSessionView } from '../src/world_api/vehicles';
import { drawsUnder, threeProgramKeys } from './helpers/three_program_keys';

interface MockActor {
  key: string;
  color: number;
  root: THREE.Group;
  snaps: Record<string, unknown>[];
  update: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  playHit: ReturnType<typeof vi.fn>;
  playAttack: ReturnType<typeof vi.fn>;
  setShadow: ReturnType<typeof vi.fn>;
  setProxyShadow: ReturnType<typeof vi.fn>;
}
const actors = vi.hoisted(() => ({
  made: [] as MockActor[],
  /** Visual keys whose next constructions throw, like a streamed GLB not yet resident. */
  failures: new Map<string, number>(),
}));
vi.mock('../src/render/characters', () => ({
  CharacterVisual: class {
    root = new THREE.Group();
    height = 2;
    gait = undefined;
    snaps: Record<string, unknown>[] = [];
    // The painter reuses one AnimState object, so each call is snapshotted.
    update = vi.fn((_dt: number, state: Record<string, unknown>) => {
      this.snaps.push({ ...state });
    });
    dispose = vi.fn();
    playHit = vi.fn();
    playAttack = vi.fn();
    setShadow = vi.fn();
    setProxyShadow = vi.fn();
    constructor(
      readonly key: string,
      readonly color: number,
    ) {
      const failures = actors.failures.get(key) ?? 0;
      if (failures > 0) {
        actors.failures.set(key, failures - 1);
        throw new Error(`character asset not preloaded: ${key}`);
      }
      actors.made.push(this as unknown as MockActor);
    }
  },
}));
vi.mock('../src/render/characters/assets', () => ({
  charactersReady: () => Promise.resolve(),
}));

import { TurretDefenseVisual } from '../src/render/turret_defense_visual';

const flat: ThrowProbe = { ground: () => 0, water: () => null };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const IDLE: IdleBudget = { didTimeout: false, timeRemaining: () => 10 };
const immediate: IdleScheduler = (callback) => callback(IDLE);
const never: IdleScheduler = () => {};

function engine(ticks: number): TurretDefenseState {
  const state = createTurretDefense(resolveTurretPlan(), { x: 0, z: 0 }, 7, 0);
  for (let t = 1; t <= ticks; t++) tickTurretDefense(state, t, flat);
  return state;
}

function viewOf(state: TurretDefenseState, feedback: TurretFeedback[] = []): TurretSessionView {
  return {
    origin: { x: state.cx, y: 0, z: state.cz },
    defense: {
      ...state,
      monsters: state.monsters.map((m) => ({ ...m, seg: { ...m.seg } })),
    } as unknown as TurretSessionView['defense'],
    waveCount: state.plan.waves.length,
    monstersLeft: 0,
    feedback,
  };
}

function wolfKind(state: TurretDefenseState): number {
  return state.plan.kinds.findIndex((k) => k.templateId === 'forest_wolf');
}

/** A wolf of the engine's plan in a hand-picked state. */
function wolf(state: TurretDefenseState, over: Partial<TurretMonster>): TurretMonster {
  const kind = wolfKind(state);
  const maxHp = 100;
  return {
    id: 1,
    kind,
    hp: maxHp,
    maxHp,
    state: 'march',
    seg: stillSegment(0, 0, { x: 0, y: 0, z: 0 }),
    facing: 0,
    airSince: -1,
    throwX: 0,
    throwZ: 0,
    throwOpen: false,
    ...over,
  } as TurretMonster;
}

function part(visual: TurretDefenseVisual, name: string): THREE.Object3D {
  const found = visual.group.getObjectByName(name);
  if (!found) throw new Error(`missing ${name}`);
  return found;
}

function markers(visual: TurretDefenseVisual): THREE.Mesh[] {
  return part(visual, 'fire-and-fly-markers').children as THREE.Mesh[];
}

function capsules(visual: TurretDefenseVisual): THREE.Mesh[] {
  return markers(visual).filter((c) => c.geometry instanceof THREE.CapsuleGeometry);
}

/** The pivot group each rig is placed by: the actor root's grandparent. */
function rigRootOf(actor: MockActor): THREE.Object3D {
  const root = actor.root.parent?.parent;
  if (!root) throw new Error(`rig ${actor.key} lost its pivot`);
  return root;
}

/** Drawn: every node from `object` up to `top` is visible and attached. */
function drawnUnder(object: THREE.Object3D, top: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (!node.visible) return false;
    if (node === top) return true;
  }
  return false;
}

function inGraph(object: THREE.Object3D, top: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (node === top) return true;
  }
  return false;
}

function drawnRigs(visual: TurretDefenseVisual): MockActor[] {
  return actors.made.filter((a) => drawnUnder(rigRootOf(a), visual.group));
}

function actorAt(x: number, z: number): MockActor | undefined {
  return actors.made.find((a) => {
    const p = rigRootOf(a).position;
    return Math.abs(p.x - x) < 1e-9 && Math.abs(p.z - z) < 1e-9;
  });
}

async function frames(
  visual: TurretDefenseVisual,
  view: TurretSessionView,
  clock: number,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    visual.update(view, clock, 0, 0.016);
    await Promise.resolve();
  }
}

async function buildAll(visual: TurretDefenseVisual, view: TurretSessionView, clock: number) {
  visual.update(view, clock, 0, 0.016);
  await flush();
  await frames(visual, view, clock, 200);
}

function totalRigs(state: TurretDefenseState): number {
  return [...turretRigCapacities(state.plan).values()].reduce((a, b) => a + b, 0);
}

describe('Fire and Fly monsters on screen', () => {
  it('builds nothing until the player is first seen seated in the turret', () => {
    actors.made.length = 0;
    const scene = new THREE.Scene();
    const visual = new TurretDefenseVisual(scene, () => 0);
    for (let i = 0; i < 5; i++) visual.update(null, null, i * 0.016, 0.016);
    expect(actors.made).toHaveLength(0);
    expect(markers(visual)).toHaveLength(0);
    expect(visual.group.visible).toBe(false);
    visual.dispose();
    expect(scene.children).not.toContain(visual.group);
  });

  it('sizes each pool from the plan, builds one rig per frame current wave first, and never mints on reuse', async () => {
    actors.made.length = 0;
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0, undefined, immediate);
    const state = engine(0);
    const plan = state.plan;
    visual.update(viewOf(state), 0, 0, 0.016);
    expect(markers(visual)).toHaveLength(turretBodyCapacity(plan) * 3 + 12);
    expect(actors.made).toHaveLength(0);
    await flush();
    visual.update(viewOf(state), 0, 0, 0.016);
    visual.update(viewOf(state), 0, 0, 0.016);
    expect(actors.made).toHaveLength(2);
    const wolfKey = visualKeyFor({ kind: 'mob', templateId: 'forest_wolf' } as Entity);
    expect(actors.made.map((a) => a.key)).toEqual([wolfKey, wolfKey]);
    expect(actors.made[0].color).toBe(MOBS.forest_wolf.color);
    await frames(visual, viewOf(state), 0, 200);
    const capacities = turretRigCapacities(plan);
    expect(new Map(visual.rigCounts)).toEqual(capacities);
    const total = totalRigs(state);
    expect(actors.made).toHaveLength(total);
    expect(actors.made.every((a) => a.setShadow.mock.calls[0]?.[0] === false)).toBe(true);
    expect(actors.made.every((a) => a.setProxyShadow.mock.calls[0]?.[0] === false)).toBe(true);
    const later = engine(400);
    expect(later.monsters.length).toBeGreaterThan(0);
    await frames(visual, viewOf(later), 400, 20);
    expect(actors.made).toHaveLength(total);
    expect(drawnRigs(visual)).toHaveLength(later.monsters.length);
    visual.dispose();
    expect(actors.made.every((a) => a.dispose.mock.calls.length === 1)).toBe(true);
  });

  it('builds the current and next wave on the frame, later waves only in idle slots while seated', async () => {
    actors.made.length = 0;
    const slots: ((deadline?: IdleBudget) => void)[] = [];
    const held: IdleScheduler = (callback) => {
      slots.push(callback);
    };
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0, undefined, held);
    const state = engine(0);
    const view = viewOf(state);
    visual.update(view, 0, 0, 0.016);
    await flush();
    for (let i = 0; i < 60; i++) visual.update(view, 0, 0, 0.016);
    const capacities = turretRigCapacities(state.plan);
    const urgent = (capacities.get('forest_wolf') ?? 0) + (capacities.get('wild_boar') ?? 0);
    expect(actors.made).toHaveLength(urgent);
    expect(new Set(visual.rigCounts.keys())).toEqual(new Set(['forest_wolf', 'wild_boar']));
    expect(slots).toHaveLength(1);
    slots.shift()?.(IDLE);
    await flush();
    expect(actors.made).toHaveLength(urgent + 1);
    const third = state.plan.kinds[state.plan.waves[2].spawns[0]].templateId;
    expect(actors.made.at(-1)?.key).toBe(
      visualKeyFor({ kind: 'mob', templateId: third } as Entity),
    );
    visual.update(view, 0, 0, 0.016);
    expect(slots).toHaveLength(1);
    visual.update(null, null, 0, 0.016);
    slots.shift()?.(IDLE);
    await flush();
    expect(actors.made).toHaveLength(urgent + 1);
    visual.dispose();
  });

  it('tries a template whose rig failed to build again once the retry cooldown has passed', async () => {
    actors.made.length = 0;
    const wolfKey = visualKeyFor({ kind: 'mob', templateId: 'forest_wolf' } as Entity);
    actors.failures.set(wolfKey, 1);
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0, undefined, never);
    const view = viewOf(engine(0));
    visual.update(view, 0, 0, 0.016);
    await flush();
    for (let i = 0; i < 20; i++) visual.update(view, 0, i * 0.09, 0.016);
    expect(visual.rigCounts.get('forest_wolf') ?? 0).toBe(0);
    expect(visual.rigCounts.get('wild_boar')).toBeGreaterThan(0);
    visual.update(view, 0, 2.1, 0.016);
    expect(visual.rigCounts.get('forest_wolf')).toBe(1);
    quiet.mockRestore();
    actors.failures.clear();
    visual.dispose();
  });

  it('takes every free rig out of the scene graph, and the whole pool while the player is away', async () => {
    actors.made.length = 0;
    const scene = new THREE.Scene();
    const visual = new TurretDefenseVisual(scene, () => 0, undefined, immediate);
    const state = engine(160);
    const view = viewOf(state);
    await buildAll(visual, view, 160);
    expect(actors.made).toHaveLength(totalRigs(state));
    const attached = () => actors.made.filter((a) => inGraph(a.root, scene));
    expect(attached()).toHaveLength(state.monsters.length);
    expect(drawnRigs(visual)).toHaveLength(state.monsters.length);
    visual.update(null, null, 0, 0.016);
    expect(attached()).toHaveLength(0);
    visual.update(view, 160, 0, 0.016);
    expect(attached()).toHaveLength(state.monsters.length);
    expect(drawnRigs(visual)).toHaveLength(state.monsters.length);
    visual.dispose();
  });

  it('draws a capsule at each monster until its rig links, then the rig at the same spot', async () => {
    actors.made.length = 0;
    const release: (() => void)[] = [];
    const gate = () => new Promise<void>((resolve) => release.push(resolve));
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0, gate, immediate);
    const state = engine(160);
    const view = viewOf(state);
    expect(state.monsters.length).toBeGreaterThan(1);
    await buildAll(visual, view, 160);
    expect(actors.made.length).toBeGreaterThan(state.monsters.length);
    expect(drawnRigs(visual)).toHaveLength(0);
    const shown = capsules(visual).filter((c) => c.visible);
    expect(shown).toHaveLength(state.monsters.length);
    const standHeight = TURRET_STAND_IN_HEIGHT.small;
    for (const m of state.monsters) {
      const p = positionAt(m.seg, 160, flat);
      const capsule = shown.find(
        (c) => Math.abs(c.position.x - p.x) < 1e-9 && Math.abs(c.position.z - p.z) < 1e-9,
      );
      expect(capsule?.position.y).toBeCloseTo(p.y + standHeight / 2, 9);
    }
    for (const done of release) done();
    await flush();
    visual.update(view, 160, 0, 0.016);
    expect(capsules(visual).some((c) => c.visible)).toBe(false);
    expect(drawnRigs(visual)).toHaveLength(state.monsters.length);
    for (const m of state.monsters) {
      const p = positionAt(m.seg, 160, flat);
      const actor = actorAt(p.x, p.z);
      expect(actor).toBeDefined();
      if (!actor) continue;
      const rigHeight = 2 * (MOBS[state.plan.kinds[m.kind].templateId].scale ?? 1);
      expect(rigRootOf(actor).position.y).toBeCloseTo(p.y + rigHeight / 2, 9);
    }
    visual.dispose();
  });

  it('draws its markers on the programs the world-quest-trace prewarm stages', () => {
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0);
    visual.update(viewOf(engine(0)), 0, 0, 0.016);
    const staged = drawsUnder(buildWorldQuestTraceStandIn());
    const signatures = new Set(staged.map((d) => drawProgramSignature(d.object, d.material)));
    const keys = new Set(staged.flatMap((d) => threeProgramKeys(d.material, d.object).split('\n')));
    const draws = drawsUnder(part(visual, 'fire-and-fly-markers'));
    expect(draws.length).toBeGreaterThan(0);
    for (const draw of draws) {
      const name = (draw.object as THREE.Mesh).geometry.type;
      expect(signatures.has(drawProgramSignature(draw.object, draw.material)), name).toBe(true);
      for (const key of threeProgramKeys(draw.material, draw.object).split('\n')) {
        expect(keys.has(key), name).toBe(true);
      }
    }
    visual.dispose();
  });

  it('shows a health bar over a damaged living monster only, sized to its health', () => {
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0);
    const state = engine(0);
    const at = (x: number) => stillSegment(0, 40, { x, y: 0, z: 0 });
    const monsters = [
      wolf(state, { id: 1, hp: 40, state: 'rise', seg: at(4) }),
      wolf(state, { id: 2, state: 'rise', seg: at(8) }),
      wolf(state, { id: 3, hp: 0, state: 'dead', seg: at(12) }),
    ];
    visual.update(viewOf({ ...state, monsters }), 10, 0, 0.016);
    const bars = markers(visual).filter(
      (m) => m.visible && m.geometry instanceof THREE.BoxGeometry,
    );
    expect(bars).toHaveLength(1);
    expect(bars[0].position.x).toBeCloseTo(4, 9);
    expect(bars[0].scale.x).toBeCloseTo(1.2 * 0.4, 9);
    visual.dispose();
  });

  it('draws the red strike ring under a winding-up monster only, on the encounter floor band', () => {
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0);
    const state = engine(0);
    const monsters = [
      wolf(state, {
        id: 1,
        state: 'windup',
        seg: stillSegment(0, TURRET_TIMING.windupTicks, { x: 3, y: 0, z: 4 }),
      }),
      wolf(state, { id: 2, seg: marchSegment(0, 30, 0, 0, 0, 0, 4, 2) }),
    ];
    visual.update(viewOf({ ...state, monsters }), 10, 0, 0.016);
    const red = worldQuestTraceMaterials().red;
    const rings = markers(visual).filter(
      (m) => m.visible && m.geometry instanceof THREE.RingGeometry && m.material === red,
    );
    expect(rings).toHaveLength(1);
    expect(rings[0].position.x).toBeCloseTo(3, 9);
    expect(rings[0].position.z).toBeCloseTo(4, 9);
    expect(rings[0].renderOrder).toBe(floorVfxRenderOrder('encounter'));
    visual.dispose();
  });

  it('updates each drawn rig once per frame with its monster animation state', async () => {
    actors.made.length = 0;
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0, undefined, immediate);
    const state = engine(160);
    const march = marchSegment(150, 30, 0, 0, 0, 0, 4, 2);
    const corpse = stillSegment(150, TURRET_TIMING.corpseTicks, { x: -6, y: 0, z: 5 });
    const monsters = [
      wolf(state, { id: 1, seg: march }),
      wolf(state, { id: 2, hp: 0, state: 'dead', seg: corpse }),
    ];
    const view = viewOf({ ...state, monsters });
    await buildAll(visual, view, 160);
    for (const actor of actors.made) {
      actor.update.mockClear();
      actor.snaps.length = 0;
    }
    visual.update(view, 160, 0, 0.016);
    const updated = actors.made.filter((a) => a.update.mock.calls.length > 0);
    expect(updated).toHaveLength(2);
    for (const actor of updated) expect(actor.update).toHaveBeenCalledTimes(1);
    const walking = positionAt(march, 160, flat);
    const walker = actorAt(walking.x, walking.z);
    expect(walker?.snaps[0]).toMatchObject({ moving: true, speed: march.speed, dead: false });
    expect(actorAt(-6, 5)?.snaps[0]).toMatchObject({ dead: true, moving: false });
    visual.dispose();
  });

  it('sinks a corpse into the ground over its last second', async () => {
    actors.made.length = 0;
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0, undefined, immediate);
    const state = engine(160);
    const end = 170;
    const corpse = stillSegment(end - TURRET_TIMING.corpseTicks, TURRET_TIMING.corpseTicks, {
      x: 5,
      y: 0,
      z: 5,
    });
    const view = viewOf({
      ...state,
      monsters: [wolf(state, { id: 1, hp: 0, state: 'dead', seg: corpse })],
    });
    await buildAll(visual, view, 160);
    const actor = actorAt(5, 5);
    expect(actor).toBeDefined();
    if (!actor) return;
    const height = 2 * (MOBS.forest_wolf.scale ?? 1);
    const sink = 0.5 * Math.max(height, 1.1);
    expect(rigRootOf(actor).position.y).toBeCloseTo(height / 2 - sink, 9);
    visual.dispose();
  });

  it('plays the hit and the strike clips once per feedback entry on the monster own rig', async () => {
    actors.made.length = 0;
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0, undefined, immediate);
    const state = engine(160);
    await buildAll(visual, viewOf(state), 160);
    const m = state.monsters[1];
    const p = positionAt(m.seg, 160, flat);
    const target = actorAt(p.x, p.z);
    expect(target).toBeDefined();
    expect(target).not.toBe(actors.made[0]);
    const id = m.id;
    const feedback: TurretFeedback[] = [
      {
        seq: 1,
        tick: 160,
        event: { type: 'launched', id, x: 0, y: 0, z: 0, vx: 1, vy: 5, vz: 0 },
      },
      { seq: 2, tick: 160, event: { type: 'windupStart', id, x: 0, z: 0 } },
    ];
    visual.update(viewOf(state, feedback), 160, 0, 0.016);
    visual.update(viewOf(state, feedback), 160, 0, 0.016);
    const hit = actors.made.filter((a) => a.playHit.mock.calls.length > 0);
    expect(hit).toHaveLength(1);
    expect(hit[0]).toBe(target);
    expect(target?.playHit).toHaveBeenCalledTimes(1);
    expect(target?.playAttack).toHaveBeenCalledTimes(1);
    const contacts: TurretFeedback[] = [
      ...feedback,
      {
        seq: 3,
        tick: 161,
        event: { type: 'bounce', id, surface: 'ground', x: 0, y: 0, z: 0, speed: 9 },
      },
      { seq: 4, tick: 162, event: { type: 'landed', id, x: 0, y: 0, z: 0 } },
    ];
    visual.update(viewOf(state, contacts), 162, 0, 0.016);
    expect(target?.playHit).toHaveBeenCalledTimes(3);
    const empty = { ...state, monsters: [] };
    visual.update(viewOf(empty, contacts), 162, 0, 0.016);
    expect(drawnRigs(visual)).toHaveLength(0);
    expect(capsules(visual).some((c) => c.visible)).toBe(false);
    visual.update(null, null, 0, 0.016);
    expect(visual.group.visible).toBe(false);
    visual.dispose();
  });

  it('flies a placeholder shell from the fired entry and shows the blast from the impact entry', async () => {
    actors.made.length = 0;
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0, undefined, immediate);
    const state = engine(160);
    await buildAll(visual, viewOf(state), 160);
    const fired: TurretFeedback = {
      seq: 1,
      tick: 160,
      event: {
        type: 'fired',
        shotId: 1,
        fromX: 0,
        fromZ: 0,
        x: 20,
        y: 0,
        z: 0,
        flightTicks: 8,
        impactTick: 168,
      },
    };
    const spheres = () =>
      markers(visual).filter((m) => m.visible && m.geometry instanceof THREE.SphereGeometry);
    expect(spheres()).toHaveLength(0);
    visual.update(viewOf(state, [fired]), 164, 0, 0.016);
    const flying = spheres();
    expect(flying).toHaveLength(1);
    expect(flying[0].position.x).toBeGreaterThan(2);
    expect(flying[0].position.x).toBeLessThan(20);
    const impact: TurretFeedback = {
      seq: 2,
      tick: 168,
      event: { type: 'impact', shotId: 1, x: 20, y: 0, z: 0, hits: [] },
    };
    visual.update(viewOf(state, [fired, impact]), 168, 0, 0.016);
    const blast = markers(visual).filter((m) => m.visible && m.position.x === 20);
    expect(blast.map((m) => m.geometry.type).sort()).toEqual(['RingGeometry', 'SphereGeometry']);
    visual.dispose();
  });

  it('clears the shells of a previous seat when a new one starts', () => {
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0);
    const state = engine(0);
    const fired: TurretFeedback = {
      seq: 1,
      tick: 160,
      event: {
        type: 'fired',
        shotId: 1,
        fromX: 0,
        fromZ: 0,
        x: 20,
        y: 0,
        z: 0,
        flightTicks: 8,
        impactTick: 168,
      },
    };
    const spheres = () =>
      markers(visual).filter((m) => m.visible && m.geometry instanceof THREE.SphereGeometry);
    visual.update(viewOf(state, [fired]), 164, 0, 0.016);
    expect(spheres()).toHaveLength(1);
    visual.update(viewOf({ ...state, startTick: 150 }), 164, 0, 0.016);
    expect(spheres()).toHaveLength(0);
    visual.dispose();
  });

  it('rebuilds its build order when the wave changes', async () => {
    actors.made.length = 0;
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0, undefined, never);
    const state = engine(0);
    visual.update(viewOf(state), 0, 0, 0.016);
    await flush();
    visual.update(viewOf(state), 0, 0, 0.016);
    expect(actors.made).toHaveLength(1);
    visual.update(viewOf({ ...state, wave: 3 }), 0, 0, 0.016);
    expect(actors.made).toHaveLength(2);
    const first = state.plan.kinds[state.plan.waves[3].spawns[0]].templateId;
    expect(first).not.toBe('forest_wolf');
    expect(actors.made[1].key).toBe(visualKeyFor({ kind: 'mob', templateId: first } as Entity));
    visual.dispose();
  });

  it('releases every rig and geometry even when one rig fails to dispose, then reports it', async () => {
    actors.made.length = 0;
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0, undefined, never);
    const view = viewOf(engine(0));
    visual.update(view, 0, 0, 0.016);
    await flush();
    for (let i = 0; i < 3; i++) visual.update(view, 0, 0, 0.016);
    expect(actors.made).toHaveLength(3);
    actors.made[0].dispose.mockImplementation(() => {
      throw new Error('boom');
    });
    const geometries = new Set(markers(visual).map((m) => m.geometry));
    const released = [...geometries].map((g) => vi.spyOn(g, 'dispose'));
    expect(() => visual.dispose()).toThrow(AggregateError);
    for (const actor of actors.made) expect(actor.dispose).toHaveBeenCalledTimes(1);
    for (const spy of released) expect(spy).toHaveBeenCalledTimes(1);
  });
});
