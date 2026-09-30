import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { emitTurretSelfKeys } from '../server/turret_self_wire';
import { dispatchVehicleCommand } from '../server/vehicle_command_wire';
import {
  TURRET_FIRE_SFX,
  TurretDefenseSfx,
  turretSfxCueInto,
} from '../src/game/turret_defense_sfx';
import { type QuestWorldCommand, QuestWorldWireState } from '../src/net/quest_world_wire_state';
import { setBuildSpanSink } from '../src/render/build_spans';
import { PUFF } from '../src/render/cannon_puff_core';
import {
  CANNON_MUZZLE,
  type CannonPoint,
  type CannonShotTimeline,
  cannonRecoilOffset,
} from '../src/render/cannon_shell_core';
import {
  type CannonShellHost,
  CannonShellVisuals,
  resetCannonShotTexelsForTest,
} from '../src/render/cannon_shell_visuals';
import { visualKeyFor } from '../src/render/characters/manifest';
import { drawProgramSignature } from '../src/render/draw_program_signature_core';
import { floorVfxRenderOrder } from '../src/render/floor_vfx_layer';
import type { IdleBudget, IdleScheduler } from '../src/render/idle_queue';
import { turretBodyCapacity, turretRigCapacities } from '../src/render/turret_defense_pool_core';
import { TURRET_MARKER_LIFT, turretMarkerRadius } from '../src/render/turret_ground_marker_core';
import type { TurretGroundMarkers } from '../src/render/turret_ground_markers';
import { turretShockwaveCounts } from '../src/render/turret_shockwave_core';
import {
  TURRET_BARREL,
  TURRET_GUNNER,
  TURRET_HEAD,
  TURRET_HEAD_HOP,
  TURRET_TOWER_MODEL,
  turretBarrelPitch,
} from '../src/render/turret_tower_core';
import { TURRET_TOWER_MATERIAL_PREFIX, TURRET_TOWER_NAME } from '../src/render/turret_tower_visual';
import {
  buildWorldQuestTraceStandIn,
  worldQuestTraceMaterials,
} from '../src/render/world_quest_trace_materials';
import { TURRET_EXPLOSIVE_BARREL, TURRET_TIMING } from '../src/sim/content/turret_defense';
import { BUILTIN_WORLD, MOBS } from '../src/sim/data';
import { FIRE_AND_FLY_TOWER } from '../src/sim/fire_and_fly_field';
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
import { burstTurretFrag, TURRET_BOMBLETS } from '../src/sim/minigames/turret_fragmentation';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type SimEvent, type WorldContent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';
import { TurretAimCore } from '../src/ui/hud/vehicle/turret_aim_core';
import { TurretOwnShotLedger } from '../src/ui/hud/vehicle/turret_own_shot_core';
import type { IWorldVehicles, TurretSessionView } from '../src/world_api/vehicles';
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
  holdFrame: ReturnType<typeof vi.fn>;
  respondToElement: ReturnType<typeof vi.fn>;
  setFarBakeGate: ReturnType<typeof vi.fn>;
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
    holdFrame = vi.fn();
    respondToElement = vi.fn();
    setFarBakeGate = vi.fn();
    isMidOneShot = false;
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
// The tower's GLB never arrives unless a case hands the painter a model of its own.
vi.mock('../src/render/assets/loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/assets/loader')>()),
  loadGltf: () => new Promise(() => {}),
}));

import { TurretDefenseVisual } from '../src/render/turret_defense_visual';

const flat: ThrowProbe = { ground: () => 0, water: () => null };

/** Builds the page's cannon texels, so a weapon prepared later asks no idle slot for them. */
function warmCannonTexels(): void {
  const weapon = new CannonShellVisuals({ blastRadius: 6, groundAt: () => 0 });
  weapon.prepare(new THREE.Scene());
  weapon.dispose();
}

beforeAll(warmCannonTexels);
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

/** hex_tower_cannon.glb's node tree as GLTFLoader builds it: the painter reads its names and transforms. */
function towerModel(): THREE.Group {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.4 });
  material.name = 'hexagons_medieval';
  const box = new THREE.BoxGeometry();
  const scene = new THREE.Group();
  const root = new THREE.Group();
  root.name = 'building_tower_cannon_green';
  const body = new THREE.Mesh(box, material);
  body.position.set(0, 0.75, 0.024);
  const head = new THREE.Group();
  head.name = TURRET_TOWER_MODEL.headNode;
  head.position.y = 1.4;
  const headMesh = new THREE.Mesh(box, material);
  headMesh.position.set(0.04, 0.282, 0);
  const barrel = new THREE.Mesh(box, material);
  barrel.name = TURRET_TOWER_MODEL.barrelNode;
  barrel.position.set(0, TURRET_TOWER_MODEL.barrelPivot.y, TURRET_TOWER_MODEL.barrelPivot.z);
  barrel.scale.setScalar(TURRET_TOWER_MODEL.barrelHalfLength);
  head.add(barrel, headMesh);
  root.add(head, body);
  scene.add(root);
  return scene;
}

/** A turret painter whose tower is built (its gate settled at once) once seated. */
async function seatedWithTower(view: TurretSessionView, self?: { group: THREE.Group }) {
  const source = vi.fn(async () => towerModel());
  const visual = new TurretDefenseVisual(
    new THREE.Scene(),
    () => 0,
    () => Promise.resolve(),
    undefined,
    source,
  );
  visual.update(view, 0, 0, 0.016, false, self);
  await flush();
  return { visual, source };
}

function part(visual: TurretDefenseVisual, name: string): THREE.Object3D {
  const found = visual.group.getObjectByName(name);
  if (!found) throw new Error(`missing ${name}`);
  return found;
}

function markers(visual: TurretDefenseVisual): THREE.Mesh[] {
  return part(visual, 'fire-and-fly-markers').children as THREE.Mesh[];
}

const firedAt160: TurretFeedback = {
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
const impactAt168: TurretFeedback = {
  seq: 2,
  tick: 168,
  event: { type: 'impact', shotId: 1, x: 20, y: 0, z: 0, hits: [] },
};

function weaponPiece(visual: TurretDefenseVisual, role: string): THREE.Mesh {
  const found = visual.group.getObjectByName(`cannonShell:${role}`);
  if (!(found instanceof THREE.Mesh)) throw new Error(`missing weapon ${role}`);
  return found;
}

/** The shells drawn, or for any other role the puffs of that kind (cannon_puff_core PUFF). */
function weaponDrawn(visual: TurretDefenseVisual, role: 'shell' | keyof typeof PUFF): number {
  if (role === 'shell') {
    const mesh = weaponPiece(visual, 'shell') as THREE.InstancedMesh;
    return mesh.visible ? mesh.count : 0;
  }
  if (!visual.group.getObjectByName('cannonShell:puff')?.visible) return 0;
  const weapon = (visual as unknown as { weapon: CannonShellVisuals }).weapon;
  return weapon.drawnPuffs(PUFF[role]);
}

function scorchShown(visual: TurretDefenseVisual): boolean {
  return weaponPiece(visual, 'scorch').visible;
}

function weaponPosition(visual: TurretDefenseVisual, role: string): THREE.Vector3 {
  const m = new THREE.Matrix4();
  (weaponPiece(visual, role) as THREE.InstancedMesh).getMatrixAt(0, m);
  return new THREE.Vector3().setFromMatrixPosition(m);
}

function groundMarkers(visual: TurretDefenseVisual): THREE.InstancedMesh {
  const found = part(visual, 'fire-and-fly-ground-markers').children[0];
  if (!(found instanceof THREE.InstancedMesh)) throw new Error('ground marker pool expected');
  return found;
}

/** Where each drawn ground marker lies, and its radius. */
function groundMarkerSpots(visual: TurretDefenseVisual): { p: THREE.Vector3; radius: number }[] {
  const mesh = groundMarkers(visual);
  if (!mesh.visible) return [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const spots: { p: THREE.Vector3; radius: number }[] = [];
  for (let i = 0; i < mesh.count; i++) {
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    mesh.getMatrixAt(i, m);
    m.decompose(p, q, s);
    spots.push({ p, radius: s.x });
  }
  return spots;
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
  it('paints health bars and strike rings over the dust, the bar upright to the camera whatever the tumble', async () => {
    actors.made.length = 0;
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0, undefined, immediate);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(-9, 8, -14);
    camera.lookAt(4, 1, 6);
    camera.updateMatrixWorld();
    visual.setHost({
      vfx: { burst: vi.fn() },
      camera,
      addShake: vi.fn(),
      punchFov: vi.fn(),
    } as unknown as CannonShellHost);
    const state = engine(0);
    const flight = {
      kind: 'fly' as const,
      start: 0,
      end: 40,
      x: 5,
      y: 0,
      z: 0,
      vx: 4,
      vy: 12,
      vz: 0,
      g: 30,
      contact: 'ground' as const,
      nx: 0,
      nz: 0,
    };
    const flyer = wolf(state, { id: 1, hp: 50, state: 'fly', seg: flight });
    const striker = wolf(state, {
      id: 2,
      state: 'windup',
      seg: stillSegment(0, TURRET_TIMING.windupTicks, { x: 3, y: 0, z: 4 }),
    });
    const view = viewOf({ ...state, monsters: [flyer, striker] });
    await buildAll(visual, view, 1);
    const bar = markers(visual).find((m) => m.visible && m.geometry instanceof THREE.BoxGeometry);
    const ring = markers(visual).find((m) => m.visible && m.geometry instanceof THREE.RingGeometry);
    if (!bar || !ring) throw new Error('a health bar and a strike ring expected');
    // Both are what a player acts on: they sort after the puff draw, which
    // writes no depth, so the dust never paints over them.
    const puff = weaponPiece(visual, 'puff');
    expect((puff.material as THREE.Material).depthWrite).toBe(false);
    for (const marker of [bar, ring]) {
      expect((marker.material as THREE.Material).transparent).toBe(true);
      expect(marker.renderOrder).toBeGreaterThan(puff.renderOrder);
    }
    const rig = actors.made.find((a) => a.update.mock.calls.length > 0 && rigRootOf(a).visible);
    if (!rig) throw new Error('a drawn rig expected');
    const attitudes = new Set<string>();
    for (const tick of [2, 5, 8, 11, 14]) {
      visual.update(view, tick, tick * DT, 0.016);
      attitudes.add(
        rigRootOf(rig)
          .quaternion.toArray()
          .map((v) => v.toFixed(3))
          .join(),
      );
      expect(bar.quaternion.angleTo(camera.quaternion)).toBeLessThan(1e-6);
      expect(bar.scale.y).toBeCloseTo(0.12, 12);
      expect(bar.scale.z).toBeCloseTo(0.12, 12);
      expect(bar.scale.x).toBeCloseTo(1.2 * 0.5, 12);
      const body = rigRootOf(rig).position;
      expect(bar.position.x).toBeCloseTo(body.x, 9);
      expect(bar.position.y).toBeGreaterThan(body.y);
    }
    // The body really tumbled under a bar that never did.
    expect(attitudes.size).toBeGreaterThan(3);
    visual.dispose();
  });

  it("builds the cannon's texels in its own idle slot, never on the frame the player is seated", async () => {
    resetCannonShotTexelsForTest();
    const slots: ((deadline?: IdleBudget) => void)[] = [];
    const held: IdleScheduler = (callback) => {
      slots.push(callback);
    };
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0, undefined, held);
    visual.update(viewOf(engine(0)), 0, 0, 0.016);
    const atlas = () =>
      (
        (weaponPiece(visual, 'puff').material as THREE.ShaderMaterial).uniforms.uAtlas
          .value as THREE.DataTexture
      ).image.data as Uint8Array;
    expect(atlas().some((b) => b !== 0)).toBe(false);
    expect(slots.length).toBeGreaterThan(0);
    while (slots.length > 0) slots.shift()?.(IDLE);
    await flush();
    expect(atlas().some((b) => b !== 0)).toBe(true);
    visual.dispose();
  });

  it('builds nothing until the player is first seen seated in the turret', () => {
    actors.made.length = 0;
    const scene = new THREE.Scene();
    const visual = new TurretDefenseVisual(scene, () => 0);
    for (let i = 0; i < 5; i++) visual.update(null, null, i * 0.016, 0.016);
    expect(actors.made).toHaveLength(0);
    expect(markers(visual)).toHaveLength(0);
    expect(visual.group.getObjectByName('fire-and-fly-ground-markers')).toBeUndefined();
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
    expect(markers(visual)).toHaveLength(turretBodyCapacity(plan) * 3);
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
    for (const m of state.monsters) {
      // The stand-in stands as tall as the plan's own body for the kind.
      const standHeight = state.plan.kinds[m.kind].height;
      const p = positionAt(m.seg, 160, flat);
      const capsule = shown.find(
        (c) => Math.abs(c.position.x - p.x) < 1e-9 && Math.abs(c.position.z - p.z) < 1e-9,
      );
      expect(capsule?.position.y).toBeCloseTo(p.y + standHeight / 2, 9);
      expect(capsule?.scale.y).toBeCloseTo(standHeight / 2, 9);
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

  it('marks every living monster on the ground under it, in flight too, and never a corpse, a gone body or a windup', () => {
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0);
    const state = engine(0);
    const flight = {
      kind: 'fly' as const,
      start: 0,
      end: 40,
      x: 5,
      y: 0,
      z: 0,
      vx: 4,
      vy: 12,
      vz: 0,
      g: 30,
      contact: 'ground' as const,
      nx: 0,
      nz: 0,
    };
    const still = (x: number, z: number) => stillSegment(0, 40, { x, y: 0, z });
    const monsters = [
      wolf(state, { id: 1, hp: 50, state: 'fly', seg: flight }),
      wolf(state, { id: 2, seg: marchSegment(0, 30, 0, 0, 0, 0, 4, 2) }),
      wolf(state, { id: 3, state: 'down', seg: still(-8, 6) }),
      wolf(state, { id: 4, hp: 0, state: 'dead', seg: still(12, 12) }),
      wolf(state, { id: 5, hp: 0, state: 'gone', seg: still(-12, -12) }),
      wolf(state, { id: 6, state: 'windup', seg: still(3, 4) }),
      // Killed mid-air: a corpse in flight loses its marker at once.
      wolf(state, { id: 7, hp: 0, state: 'fly', seg: { ...flight, x: -5, vx: -4 } }),
    ];
    const tick = 10;
    visual.update(viewOf({ ...state, monsters }), tick, 0, 0.016);
    const spots = groundMarkerSpots(visual);
    expect(spots).toHaveLength(3);
    const radius = turretMarkerRadius(state.plan.kinds[wolfKind(state)].radius);
    for (const id of [1, 2, 3]) {
      const m = monsters.find((w) => w.id === id);
      if (!m) throw new Error(`monster ${id}`);
      const body = positionAt(m.seg, tick, flat);
      const spot = spots.find(
        (s) => Math.abs(s.p.x - body.x) < 1e-5 && Math.abs(s.p.z - body.z) < 1e-5,
      );
      expect(spot, `monster ${id}`).toBeDefined();
      expect(spot?.p.y).toBeCloseTo(TURRET_MARKER_LIFT, 5);
      expect(spot?.radius).toBeCloseTo(radius, 5);
    }
    // The flyer is well up in the air over its marker.
    expect(positionAt(flight, tick, flat).y).toBeGreaterThan(2);
    // Over the dust, under every body's capsule, strike ring and health bar.
    const order = groundMarkers(visual).renderOrder;
    expect(order).toBeGreaterThan(weaponPiece(visual, 'puff').renderOrder);
    for (const mesh of markers(visual)) expect(order).toBeLessThan(mesh.renderOrder);
    // The capsule writes no depth, so only its order keeps the disc off its lower
    // half; it still paints under the ring and the bar.
    const [capsule] = capsules(visual);
    expect((capsule.material as THREE.Material).depthWrite).toBe(false);
    for (const mesh of markers(visual)) {
      if (mesh.geometry instanceof THREE.CapsuleGeometry) continue;
      expect(capsule.renderOrder).toBeLessThan(mesh.renderOrder);
    }
    visual.update(viewOf({ ...state, monsters: [] }), tick, 0, 0.016);
    expect(groundMarkerSpots(visual)).toHaveLength(0);
    visual.dispose();
  });

  it('builds the ground markers once at the commitment, sized for every body, behind the same gate', () => {
    const gate = vi.fn((_target: THREE.Object3D) => new Promise<void>(() => {}));
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0, gate);
    const state = engine(0);
    visual.update(viewOf(state), 0, 0, 0.016);
    const root = part(visual, 'fire-and-fly-ground-markers');
    expect(gate).toHaveBeenCalledWith(root);
    expect(root.visible).toBe(false);
    const mesh = groundMarkers(visual);
    expect(mesh.instanceMatrix.count).toBe(turretBodyCapacity(state.plan));
    visual.update(viewOf(engine(200)), 200, 0, 0.016);
    expect(groundMarkers(visual)).toBe(mesh);
    expect(gate.mock.calls.filter(([target]) => target === root)).toHaveLength(1);
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
    // A launch cuts the body's own swing short.
    expect(target?.playHit).toHaveBeenCalledWith(true);
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

  it('kicks up dust once per contact entry, on the weapon draw, sized by the body', async () => {
    actors.made.length = 0;
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0, undefined, immediate);
    const state = engine(160);
    const k = wolfKind(state);
    const launch = { x: 5, y: 0, z: 0, vx: 8, vy: -6, vz: 0 };
    const flight = {
      kind: 'fly' as const,
      start: 159.5,
      end: 175,
      x: 5,
      y: 0,
      z: 0,
      vx: 8,
      vy: 3,
      vz: 0,
      g: 30,
      contact: 'ground' as const,
      nx: 0,
      nz: 0,
    };
    const flyer = wolf(state, { id: 1, kind: k, state: 'fly', seg: flight });
    const bounce: TurretFeedback = {
      seq: 1,
      tick: 160,
      event: { type: 'bounce', id: 1, surface: 'ground', ...launch, speed: 14 },
    };
    const view = viewOf({ ...state, monsters: [flyer] }, [bounce]);
    await buildAll(visual, viewOf({ ...state, monsters: [flyer] }), 160);
    const weapon = (
      visual as unknown as { weapon: { pools: { bursts: { slots: { active: boolean }[] } } } }
    ).weapon;
    const live = () => weapon.pools.bursts.slots.filter((b) => b.active).length;
    expect(live()).toBe(0);
    visual.update(view, 160, 1, 0.016);
    expect(live()).toBe(1);
    expect(weaponDrawn(visual, 'shock')).toBeGreaterThan(0);
    expect(weaponDrawn(visual, 'dirt')).toBeGreaterThan(0);
    // Read again (the same entries in a fresh view object): nothing new is launched.
    visual.update(viewOf({ ...state, monsters: [flyer] }, [bounce]), 160, 1.02, 0.016);
    expect(live()).toBe(1);
    // A landing, a trunk and a knock each kick their own.
    const more: TurretFeedback[] = [
      bounce,
      { seq: 2, tick: 161, event: { type: 'landed', id: 1, x: 7, y: 0, z: 0 } },
      {
        seq: 3,
        tick: 161,
        event: { type: 'bounce', id: 1, surface: 'wall', x: 7, y: 0.4, z: 0, speed: 9 },
      },
      {
        seq: 4,
        tick: 161,
        event: {
          type: 'bowled',
          flyerId: 1,
          struckId: 1,
          x: 7,
          y: 0,
          z: 0,
          speed: 12,
          damage: 3,
        },
      },
    ];
    visual.update(viewOf({ ...state, monsters: [flyer] }, more), 161, 1.05, 0.016);
    expect(live()).toBe(4);
    expect(weaponDrawn(visual, 'bark')).toBeGreaterThan(0);
    // A contact of a body no longer in the view kicks nothing.
    const gone: TurretFeedback = {
      seq: 5,
      tick: 162,
      event: { type: 'landed', id: 99, x: 7, y: 0, z: 0 },
    };
    visual.update(viewOf({ ...state, monsters: [flyer] }, [...more, gone]), 162, 1.1, 0.016);
    expect(live()).toBe(4);
    visual.dispose();
  });

  it('freezes a core-hit rig on the blast and scorches every rig the blast struck', async () => {
    actors.made.length = 0;
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0, undefined, immediate);
    const state = engine(160);
    await buildAll(visual, viewOf(state), 160);
    const [core, graze] = state.monsters;
    const rigOf = (m: TurretMonster) => {
      const p = positionAt(m.seg, 160, flat);
      return actorAt(p.x, p.z);
    };
    const coreRig = rigOf(core);
    const grazeRig = rigOf(graze);
    expect(coreRig).toBeDefined();
    expect(grazeRig).toBeDefined();
    const hits = [
      { id: core.id, falloff: 1, damage: 60, x: 0, y: 0, z: 0 },
      { id: graze.id, falloff: 0.4, damage: 24, x: 0, y: 0, z: 0 },
    ];
    const feedback: TurretFeedback[] = [
      { seq: 1, tick: 160, event: { type: 'impact', shotId: 1, x: 0, y: 0, z: 0, hits } },
      {
        seq: 2,
        tick: 160,
        event: { type: 'launched', id: core.id, x: 0, y: 0, z: 0, vx: 1, vy: 5, vz: 0 },
      },
      {
        seq: 3,
        tick: 160,
        event: { type: 'launched', id: graze.id, x: 0, y: 0, z: 0, vx: 1, vy: 5, vz: 0 },
      },
    ];
    visual.update(viewOf(state, feedback), 160, 0, 0.016);
    expect(coreRig?.holdFrame).toHaveBeenCalledTimes(1);
    expect(coreRig?.holdFrame).toHaveBeenCalledWith(0.05, 0.12);
    expect(grazeRig?.holdFrame).not.toHaveBeenCalled();
    expect(coreRig?.respondToElement).toHaveBeenCalledWith('fire', 0.9);
    expect(grazeRig?.respondToElement).toHaveBeenCalledWith('fire', 0.35 + 0.55 * 0.4);
    // Reduced motion keeps the scorch and drops the hitstop.
    const calm = new TurretDefenseVisual(new THREE.Scene(), () => 0, undefined, immediate);
    actors.made.length = 0;
    await buildAll(calm, viewOf(state), 160);
    const calmRig = rigOf(core);
    calm.update(viewOf(state, feedback), 160, 0, 0.016, true);
    expect(calmRig?.holdFrame).not.toHaveBeenCalled();
    expect(calmRig?.respondToElement).toHaveBeenCalledTimes(1);
    visual.dispose();
    calm.dispose();
  });

  it('keeps a rig with no airborne clip in its hit reactions while it flies, never one that has one', async () => {
    actors.made.length = 0;
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0, undefined, immediate);
    const state = engine(0);
    const boarKind = state.plan.kinds.findIndex((k) => k.templateId === 'wild_boar');
    expect(boarKind).toBeGreaterThanOrEqual(0);
    const flight = {
      kind: 'fly' as const,
      start: 0,
      end: 40,
      x: 5,
      y: 0,
      z: 0,
      vx: 4,
      vy: 12,
      vz: 0,
      g: 30,
      contact: 'ground' as const,
      nx: 0,
      nz: 0,
    };
    const boar = wolf(state, { id: 1, kind: boarKind, state: 'fly', seg: flight });
    const flyingWolf = wolf(state, { id: 2, state: 'fly', seg: { ...flight, x: -5 } });
    const view = viewOf({ ...state, wave: 1, monsters: [boar, flyingWolf] });
    await buildAll(visual, view, 1);
    const boarKey = visualKeyFor({ kind: 'mob', templateId: 'wild_boar' } as Entity);
    const boarRig = actors.made.find((a) => a.key === boarKey && a.update.mock.calls.length > 0);
    const wolfRig = actors.made.find(
      (a) => a.key !== boarKey && a.update.mock.calls.length > 0,
    ) as MockActor & { isMidOneShot: boolean };
    expect(boarRig).toBeDefined();
    expect(wolfRig).toBeDefined();
    for (const a of actors.made) a.playHit.mockClear();
    visual.update(view, 2, 0, 0.016);
    expect(boarRig?.playHit).toHaveBeenCalledTimes(1);
    expect(wolfRig.playHit).not.toHaveBeenCalled();
    (boarRig as MockActor & { isMidOneShot: boolean }).isMidOneShot = true;
    visual.update(view, 3, 0, 0.016);
    expect(boarRig?.playHit).toHaveBeenCalledTimes(1);
    visual.dispose();
  });

  it("links a rig's scorch materials behind the rig's own compile gate before they swap in", async () => {
    actors.made.length = 0;
    const gate = vi.fn(() => Promise.resolve());
    const gated = new TurretDefenseVisual(new THREE.Scene(), () => 0, gate, immediate);
    await buildAll(gated, viewOf(engine(0)), 0);
    const installed = actors.made[0].setFarBakeGate.mock.calls[0]?.[0];
    expect(typeof installed).toBe('function');
    const target = new THREE.Group();
    const settled = vi.fn();
    installed(target, settled);
    expect(gate).toHaveBeenCalledWith(target);
    await flush();
    expect(settled).toHaveBeenCalledTimes(1);
    gated.dispose();
    actors.made.length = 0;
    const bare = new TurretDefenseVisual(new THREE.Scene(), () => 0, undefined, immediate);
    await buildAll(bare, viewOf(engine(0)), 0);
    expect(actors.made[0].setFarBakeGate).toHaveBeenCalledWith(null);
    bare.dispose();
  });

  it('flies the cannon shell from the fired entry and shows the blast from the impact entry', async () => {
    actors.made.length = 0;
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0, undefined, immediate);
    const state = engine(160);
    await buildAll(visual, viewOf(state), 160);
    expect(weaponDrawn(visual, 'shell')).toBe(0);
    visual.update(viewOf(state, [firedAt160]), 164, 0, 0.016);
    expect(weaponDrawn(visual, 'shell')).toBe(1);
    expect(weaponDrawn(visual, 'trailSmoke')).toBeGreaterThan(0);
    const shell = weaponPosition(visual, 'shell');
    expect(shell.x).toBeGreaterThan(2);
    expect(shell.x).toBeLessThan(20);
    visual.update(viewOf(state, [firedAt160, impactAt168]), 168, 0.4, 0.016);
    visual.update(viewOf(state, [firedAt160, impactAt168]), 168, 0.45, 0.016);
    expect(weaponDrawn(visual, 'shell')).toBe(0);
    expect(weaponDrawn(visual, 'flash')).toBe(1);
    expect(weaponDrawn(visual, 'shock')).toBeGreaterThan(0);
    expect(weaponDrawn(visual, 'fireball')).toBeGreaterThan(0);
    expect(scorchShown(visual)).toBe(true);
    // The blast is laid where the impact entry says: the scorch's middle vertex.
    const scorch = weaponPiece(visual, 'scorch').geometry.getAttribute('position');
    expect(scorch.getX(40)).toBeCloseTo(20, 6);
    expect(scorch.getZ(40)).toBeCloseTo(0, 6);
    visual.dispose();
  });

  it("rings every standing barrel, lights its fuse, and blows it through the cannon's blast, wider, scorching the rigs it struck", async () => {
    actors.made.length = 0;
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0, undefined, immediate);
    const state = engine(160);
    expect(state.barrels.length).toBeGreaterThan(0);
    await buildAll(visual, viewOf(state), 160);
    const rings = () =>
      (part(visual, 'fire-and-fly-barrel-rings').children as THREE.Mesh[]).filter((r) => r.visible);
    expect(rings()).toHaveLength(state.barrels.length);
    const [core] = state.monsters;
    const p = positionAt(core.seg, 160, flat);
    const rig = actorAt(p.x, p.z);
    expect(rig).toBeDefined();
    const b = state.barrels[0];
    const lit: TurretFeedback = {
      seq: 1,
      tick: 160,
      event: { type: 'barrelLit', id: b.id, x: b.x, y: b.y, z: b.z, fuseTicks: 5 },
    };
    const hits = [{ id: core.id, falloff: 1, damage: 120, x: p.x, y: p.y, z: p.z }];
    const blown: TurretFeedback = {
      seq: 2,
      tick: 165,
      event: { type: 'barrelExploded', id: b.id, x: b.x, y: b.y, z: b.z, hits },
    };
    visual.update(viewOf(state, [lit]), 160, 0.4, 0.016);
    visual.update(viewOf(state, [lit]), 161, 0.45, 0.016);
    expect(weaponDrawn(visual, 'glow')).toBeGreaterThan(0);
    const standing = { ...state, barrels: state.barrels.slice(1) };
    visual.update(viewOf(standing, [lit, blown]), 165, 0.65, 0.016);
    visual.update(viewOf(standing, [lit, blown]), 165, 0.75, 0.016);
    expect(rings()).toHaveLength(standing.barrels.length);
    expect(weaponDrawn(visual, 'flash')).toBe(1);
    expect(weaponDrawn(visual, 'fireball')).toBeGreaterThan(8);
    expect(weaponDrawn(visual, 'flame')).toBeGreaterThan(0);
    expect(scorchShown(visual)).toBe(true);
    // The scorch is laid on the barrel, as wide as a barrel's blast, not a shell's.
    const scorch = weaponPiece(visual, 'scorch').geometry.getAttribute('position');
    expect(scorch.getX(40)).toBeCloseTo(b.x, 4);
    expect(scorch.getZ(40)).toBeCloseTo(b.z, 4);
    const half = Math.hypot(scorch.getX(0) - b.x, scorch.getZ(0) - b.z) / Math.SQRT2;
    expect(half).toBeCloseTo(9 * 0.45, 4);
    expect(rig?.respondToElement).toHaveBeenCalledWith('fire', 0.9);
    visual.dispose();
  });

  it("keeps a shell's blast and a whole chain's on the ground at once, none taken over", () => {
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0);
    const feed: TurretFeedback[] = [impactAt168];
    for (let id = 1; id <= TURRET_EXPLOSIVE_BARREL.cap; id++) {
      feed.push({
        seq: 2 + id,
        tick: 168,
        event: { type: 'barrelExploded', id, x: 10 * id, y: 0, z: 30, hits: [] },
      });
    }
    visual.update(viewOf(engine(0), feed), 168, 0, 0.016);
    expect(weaponDrawn(visual, 'flash')).toBe(1 + TURRET_EXPLOSIVE_BARREL.cap);
    visual.dispose();
  });

  it('clears the shots of a previous seat when a new one starts', () => {
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0);
    const state = engine(0);
    visual.update(viewOf(state, [firedAt160]), 164, 0, 0.016);
    expect(weaponDrawn(visual, 'shell')).toBe(1);
    visual.update(viewOf({ ...state, startTick: 150 }), 164, 0, 0.016);
    expect(weaponDrawn(visual, 'shell')).toBe(0);
    visual.dispose();
  });

  it("draws nothing of the ended run on a replayed seat's first frame", () => {
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0);
    const state = engine(0);
    const at = (x: number) => stillSegment(150, 40, { x, y: 0, z: 0 });
    const monsters = [
      wolf(state, { id: 1, hp: 40, state: 'rise', seg: at(4) }),
      wolf(state, { id: 2, state: 'windup', seg: at(3) }),
      wolf(state, { id: 3, hp: 0, state: 'dead', seg: at(12) }),
    ];
    const ended = { ...state, phase: 'lost' as const, monsters };
    visual.update(viewOf(ended, [firedAt160]), 164, 0, 0.016);
    expect(markers(visual).some((m) => m.visible)).toBe(true);
    expect(groundMarkerSpots(visual).length).toBeGreaterThan(0);
    expect(weaponDrawn(visual, 'shell')).toBe(1);

    const replayed = createTurretDefense(state.plan, { x: 0, z: 0 }, 11, 900);
    visual.update(viewOf(replayed), 900, 0, 0.016);
    expect(markers(visual).filter((m) => m.visible)).toEqual([]);
    expect(groundMarkerSpots(visual)).toHaveLength(0);
    expect(weaponDrawn(visual, 'shell')).toBe(0);
    expect(weaponDrawn(visual, 'flash')).toBe(0);
    expect(visual.group.visible).toBe(true);
    visual.dispose();
  });

  it('draws no shot from an entry already stale when first read', () => {
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0);
    const state = engine(0);
    visual.update(viewOf(state, [firedAt160, impactAt168]), 200, 0, 0.016);
    for (const role of ['shell', 'trailSmoke', 'flame', 'flash', 'shock'] as const) {
      expect(weaponDrawn(visual, role), role).toBe(0);
    }
    expect(scorchShown(visual)).toBe(false);
    visual.dispose();
  });

  it('draws a shot entry exactly ten ticks old at its first read, not eleven', () => {
    const state = engine(0);
    const fresh = new TurretDefenseVisual(new THREE.Scene(), () => 0);
    fresh.update(viewOf(state, [firedAt160]), 170, 0, 0.016);
    expect(weaponDrawn(fresh, 'flash')).toBe(1);
    fresh.dispose();
    const late = new TurretDefenseVisual(new THREE.Scene(), () => 0);
    late.update(viewOf(state, [firedAt160]), 171, 0, 0.016);
    expect(weaponDrawn(late, 'flash')).toBe(0);
    late.dispose();
  });

  it('fires from the same fallback muzzle the cannon report is played at, with no barrel', () => {
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0);
    const state = engine(0);
    const view = viewOf(state, [firedAt160]);
    visual.update(view, 160, 0, 0.016);
    const heard = turretSfxCueInto(firedAt160.event, view.origin, {
      key: '',
      x: 0,
      y: 0,
      z: 0,
      gain: 0,
      rate: 0,
      jitter: false,
    });
    const shell = weaponPosition(visual, 'shell');
    expect(shell.distanceTo(new THREE.Vector3(2, 2.2, 0))).toBeLessThan(1e-6);
    expect(shell.distanceTo(new THREE.Vector3(heard?.x, heard?.y, heard?.z))).toBeLessThan(1e-6);
    visual.dispose();
  });

  it('files the weapon build in the build ledger once, at the commitment', () => {
    const spans: string[] = [];
    setBuildSpanSink((kind) => spans.push(kind));
    try {
      const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0);
      const view = viewOf(engine(0));
      visual.update(view, 0, 0, 0.016);
      visual.update(view, 1, 0.05, 0.016);
      visual.update(view, 2, 0.1, 0.016);
      expect(spans.filter((kind) => kind === 'zone:turret-weapon')).toHaveLength(1);
      visual.dispose();
    } finally {
      setBuildSpanSink(null);
    }
  });

  it('prewarms the tower, the weapon and the kegs hidden before a seat, and builds them once', async () => {
    const spans: string[] = [];
    setBuildSpanSink((kind) => spans.push(kind));
    try {
      const source = vi.fn(async () => towerModel());
      const gated: THREE.Object3D[] = [];
      const visual = new TurretDefenseVisual(
        new THREE.Scene(),
        () => 0,
        (target) => {
          gated.push(target);
          return Promise.resolve();
        },
        undefined,
        source,
      );
      visual.prewarmKit(3);
      visual.prewarmKit(3.05);
      await flush();
      expect(source).toHaveBeenCalledTimes(1);
      expect(gated.map((root) => root.name)).toContain(TURRET_TOWER_NAME);
      expect(visual.group.visible).toBe(false);
      expect(visual.group.getObjectByName(TURRET_TOWER_NAME)?.parent).toBe(visual.group);
      const view = viewOf(engine(0));
      visual.update(view, 0, 4, 0.016);
      await flush();
      expect(visual.group.visible).toBe(true);
      expect(source).toHaveBeenCalledTimes(1);
      expect(spans.filter((kind) => kind === 'zone:turret-weapon')).toHaveLength(1);
      expect(spans.filter((kind) => kind === 'zone:turret-tower')).toHaveLength(1);
      visual.dispose();
      visual.prewarmKit(5);
      expect(source).toHaveBeenCalledTimes(1);
    } finally {
      setBuildSpanSink(null);
    }
  });

  it('files the tower build in the build ledger once, when its model lands', async () => {
    const spans: string[] = [];
    setBuildSpanSink((kind) => spans.push(kind));
    try {
      const view = viewOf(engine(0));
      const { visual } = await seatedWithTower(view);
      visual.update(view, 1, 0.05, 0.016);
      visual.update(view, 2, 0.1, 0.016);
      await flush();
      expect(spans.filter((kind) => kind === 'zone:turret-tower')).toHaveLength(1);
      visual.dispose();
    } finally {
      setBuildSpanSink(null);
    }
  });

  it('tries a tower model that failed to load again after the view retry cooldown, not every frame', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const view = viewOf(engine(0));
      const source = vi
        .fn<() => Promise<THREE.Object3D>>()
        .mockRejectedValueOnce(new Error('offline'))
        .mockImplementation(async () => towerModel());
      const visual = new TurretDefenseVisual(
        new THREE.Scene(),
        () => 0,
        () => Promise.resolve(),
        undefined,
        source,
      );
      visual.update(view, 0, 0, 0.016);
      await flush();
      expect(source).toHaveBeenCalledTimes(1);
      visual.update(view, 1, 1, 0.016);
      visual.update(view, 2, 1.9, 0.016);
      await flush();
      expect(source).toHaveBeenCalledTimes(1);
      expect(visual.group.getObjectByName(TURRET_TOWER_MODEL.headNode)).toBeUndefined();
      visual.update(view, 3, 2.1, 0.016);
      await flush();
      expect(source).toHaveBeenCalledTimes(2);
      expect(visual.group.getObjectByName(TURRET_TOWER_MODEL.headNode)).toBeDefined();
      visual.dispose();
    } finally {
      errors.mockRestore();
    }
  });

  it('builds the cannon tower once at the commitment, behind the gate, its roof under the seated feet', async () => {
    const state = engine(0);
    const view = { ...viewOf(state), origin: { x: 0, y: 7, z: 0 } };
    const source = vi.fn(async () => towerModel());
    const gate = vi.fn(() => new Promise<void>(() => {}));
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0, gate, undefined, source);
    await flush();
    expect(source).not.toHaveBeenCalled();
    visual.update(view, 0, 0, 0.016);
    visual.update(view, 1, 0.05, 0.016);
    await flush();
    expect(source).toHaveBeenCalledTimes(1);
    const tower = part(visual, TURRET_TOWER_NAME);
    expect(gate).toHaveBeenCalledWith(tower);
    expect(tower.visible).toBe(false);
    visual.update(view, 2, 0.1, 0.016);
    const head = part(visual, TURRET_TOWER_MODEL.headNode);
    head.updateWorldMatrix(true, false);
    expect(new THREE.Vector3().setFromMatrixPosition(head.matrixWorld).y).toBeCloseTo(7, 9);
    expect(tower.position.y).toBeCloseTo(7 - FIRE_AND_FLY_TOWER.roofY, 12);
    expect(tower.children[0].scale.x).toBe(FIRE_AND_FLY_TOWER.scale);
    // One material of its own, named, dielectric: the kit's shared one is never touched.
    const materials = new Set<THREE.Material>();
    tower.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      materials.add(mesh.material as THREE.Material);
      expect(mesh.castShadow && mesh.receiveShadow).toBe(true);
    });
    expect(materials.size).toBe(1);
    const [material] = materials;
    expect(material.name).toBe(`${TURRET_TOWER_MATERIAL_PREFIX}hexagons_medieval`);
    if (material instanceof THREE.MeshStandardMaterial) expect(material.metalness).toBe(0);
    let lights = 0;
    visual.group.traverse((node) => {
      if ((node as THREE.Light).isLight) lights++;
    });
    expect(lights).toBe(0);
    visual.dispose();
  });

  it('turns only the head toward the aim, eased and never past 540 degrees a second', async () => {
    const state = engine(0);
    const view = viewOf(state);
    const self = { group: new THREE.Group() };
    const { visual } = await seatedWithTower(view, self);
    const head = part(visual, TURRET_TOWER_MODEL.headNode);
    const root = part(visual, 'building_tower_cannon_green');
    const tower = part(visual, TURRET_TOWER_NAME);
    expect(head.rotation.y).toBeCloseTo(0, 12);
    const target = Math.PI / 2;
    const frame = 1 / 60;
    let last = head.rotation.y;
    let frames = 0;
    for (; frames < 120 && Math.abs(target - head.rotation.y) > 1e-3; frames++) {
      // The renderer turns the self model toward the reticle before the painter runs.
      self.group.rotation.y = target;
      visual.update(view, frames, frames * frame, frame, false, self);
      const turned = head.rotation.y - last;
      expect(turned).toBeGreaterThan(0);
      expect(turned).toBeLessThanOrEqual(TURRET_HEAD.maxTurnRate * frame + 1e-9);
      last = head.rotation.y;
    }
    expect(frames).toBeGreaterThan(5);
    expect(frames).toBeLessThan(60);
    expect(root.rotation.y).toBe(0);
    expect(tower.rotation.y).toBe(0);
    expect(part(visual, TURRET_TOWER_MODEL.barrelNode).rotation.y).toBe(0);
    visual.dispose();
  });

  it('stands the player behind the breech on the head yaw, on the parapet, facing along the barrel', async () => {
    const state = engine(0);
    const view = { ...viewOf(state), origin: { x: 0, y: 7, z: 0 } };
    const self = { group: new THREE.Group() };
    self.group.rotation.y = Math.PI;
    const { visual } = await seatedWithTower(view, self);
    self.group.rotation.y = Math.PI;
    visual.update(view, 1, 0.05, 0.016, false, self);
    expect(self.group.position.x).toBeCloseTo(0, 9);
    expect(self.group.position.z).toBeCloseTo(TURRET_GUNNER.behind, 9);
    expect(self.group.position.y).toBeCloseTo(7 + TURRET_GUNNER.lift, 12);
    expect(Math.cos(self.group.rotation.y)).toBeCloseTo(-1, 9);
    visual.dispose();
  });

  it('fires from the barrel tip, lying head and barrel on the shot, and kicks the barrel alone back', async () => {
    const state = engine(0);
    const view = { ...viewOf(state), origin: { x: 0, y: 7, z: 0 } };
    const self = { group: new THREE.Group() };
    const { visual } = await seatedWithTower(view, self);
    const head = part(visual, TURRET_TOWER_MODEL.headNode);
    const barrel = part(visual, TURRET_TOWER_MODEL.barrelNode);
    const tower = part(visual, TURRET_TOWER_NAME);
    const headRest = head.position.clone();
    const barrelRest = barrel.position.clone();
    // The aim still faces the default heading: the shot, due +x, lays the head on it at once.
    self.group.rotation.y = 0;
    const fired = { ...viewOf(state, [firedAt160]), origin: view.origin };
    visual.update(fired, 160, 1, 0.016, false, self);
    expect(head.rotation.y).toBeCloseTo(Math.PI / 2, 12);
    const pitch = turretBarrelPitch(20, 0 - 7);
    expect(pitch).toBeGreaterThan(0);
    expect(barrel.rotation.x).toBeCloseTo(-pitch, 12);
    barrel.updateWorldMatrix(true, false);
    const tip = new THREE.Vector3(0, 0, 1).applyMatrix4(barrel.matrixWorld);
    expect(weaponPosition(visual, 'shell').distanceTo(tip)).toBeLessThan(1e-6);
    // The tip leans toward the shot and above the roof.
    expect(tip.x).toBeGreaterThan(1);
    expect(tip.y).toBeGreaterThan(7 + 1);
    visual.update(fired, 160, 1 + CANNON_MUZZLE.recoilAttack, 0.016, false, self);
    const kick = barrel.position.clone().sub(barrelRest);
    const scale = TURRET_BARREL.recoilKick / CANNON_MUZZLE.recoilKick;
    expect(kick.length()).toBeCloseTo(cannonRecoilOffset(CANNON_MUZZLE.recoilAttack) * scale, 9);
    const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(barrel.quaternion);
    expect(kick.normalize().dot(axis)).toBeCloseTo(-1, 9);
    expect(head.position.equals(headRest)).toBe(true);
    expect(tower.position.y).toBeCloseTo(7 - FIRE_AND_FLY_TOWER.roofY, 12);
    visual.update(fired, 161, 3, 0.016, false, self);
    expect(barrel.position.equals(barrelRest)).toBe(true);
    visual.dispose();
  });

  it('builds the weapon at the commitment behind the same gate as the rigs', () => {
    const gate = vi.fn(() => new Promise<void>(() => {}));
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0, gate);
    expect(visual.group.getObjectByName('fire-and-fly-weapon')?.children ?? []).toHaveLength(0);
    visual.update(viewOf(engine(0)), 0, 0, 0.016);
    const weapon = part(visual, 'fire-and-fly-weapon');
    expect(weapon.children.length).toBeGreaterThan(0);
    expect(gate).toHaveBeenCalledWith(weapon);
    expect(weapon.visible).toBe(false);
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

  it('reports a ground marker disposal failure alongside a rig failure, never in place of it', async () => {
    actors.made.length = 0;
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0, undefined, never);
    const view = viewOf(engine(0));
    visual.update(view, 0, 0, 0.016);
    await flush();
    visual.update(view, 0, 0, 0.016);
    const rigFailure = new Error('rig');
    actors.made[0].dispose.mockImplementation(() => {
      throw rigFailure;
    });
    const markerFailure = new Error('markers');
    const inner = visual as unknown as { groundMarkers: TurretGroundMarkers };
    vi.spyOn(inner.groundMarkers, 'dispose').mockImplementation(() => {
      throw markerFailure;
    });
    let thrown: unknown = null;
    try {
      visual.dispose();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toEqual([rigFailure, markerFailure]);
  });
});

describe('Fire and Fly own shot on screen', () => {
  const click = { x: 20, z: 0, dirX: 1, dirZ: 0, range: 20 };
  const ownFired = (tick: number, impactTick = tick + 8): TurretFeedback => ({
    seq: 1,
    tick,
    event: {
      type: 'fired',
      shotId: 1,
      fromX: 0,
      fromZ: 0,
      x: 20,
      y: 0,
      z: 0,
      flightTicks: impactTick - tick,
      impactTick,
    },
  });

  function ownRig(groundAt: (x: number, z: number) => number = () => 0) {
    const shots = new TurretOwnShotLedger();
    const visual = new TurretDefenseVisual(
      new THREE.Scene(),
      groundAt,
      undefined,
      undefined,
      undefined,
      undefined,
      shots,
    );
    const weapon = (visual as unknown as { weapon: CannonShellVisuals }).weapon;
    const launched = vi.spyOn(weapon, 'launchOwn');
    const fired = vi.spyOn(weapon, 'fire');
    const reports = () =>
      launched.mock.calls.length + fired.mock.calls.filter((call) => call[4] !== false).length;
    return { shots, visual, launched, fired, reports };
  }

  it('plays the shot on the click frame, then flies the same shell on its fired entry', () => {
    const { shots, visual, launched, fired } = ownRig();
    const state = engine(0);
    const idle = viewOf(state);
    visual.update(idle, 160, 0, 0.016);
    shots.mark(idle, 160, click);
    visual.update(idle, 160, 0.016, 0.016);
    expect(launched).toHaveBeenCalledTimes(1);
    expect(weaponDrawn(visual, 'shell')).toBe(1);
    expect(weaponDrawn(visual, 'flash')).toBe(1);
    // Online its entry comes a round trip later: the shell carries on, nothing plays again.
    const confirmed = viewOf(state, [ownFired(163)]);
    visual.update(confirmed, 163, 0.17, 0.016);
    visual.update(confirmed, 164, 0.2, 0.016);
    expect(fired).not.toHaveBeenCalled();
    expect(launched).toHaveBeenCalledTimes(1);
    expect(weaponDrawn(visual, 'shell')).toBe(1);
    expect(shots.status(1)).toBe('confirmed');
    // Online the display runs ahead of the clock: the shell waits at its blast point for its impact.
    visual.update(confirmed, 171, 0.6, 0.016);
    expect(weaponDrawn(visual, 'shell')).toBe(1);
    const impact: TurretFeedback = { ...impactAt168, tick: 171 };
    visual.update(viewOf(state, [ownFired(163), impact]), 171, 0.62, 0.016);
    visual.update(viewOf(state, [ownFired(163), impact]), 171, 0.67, 0.016);
    expect(weaponDrawn(visual, 'shell')).toBe(0);
    expect(weaponDrawn(visual, 'shock')).toBeGreaterThan(0);
    visual.dispose();
  });

  it('adopts the fired entry offline on the click frame itself: one report, one shell', () => {
    const { shots, visual, launched, fired } = ownRig();
    const state = engine(0);
    visual.update(viewOf(state), 160, 0, 0.016);
    shots.mark(viewOf(state), 160, click);
    visual.update(viewOf(state, [ownFired(160)]), 160, 0.016, 0.016);
    expect(launched).toHaveBeenCalledTimes(1);
    expect(fired).not.toHaveBeenCalled();
    expect(weaponDrawn(visual, 'shell')).toBe(1);
    visual.dispose();
  });

  it('shrinks a shot the server never fired away with no blast, and flies a late one unheard', () => {
    const { shots, visual, fired, reports } = ownRig();
    const state = engine(0);
    const idle = viewOf(state);
    visual.update(idle, 160, 0, 0.016);
    shots.mark(idle, 160, click);
    visual.update(idle, 160, 0.016, 0.016);
    expect(weaponDrawn(visual, 'shell')).toBe(1);
    const expiry = 160 + shots.confirmWindow + 1;
    visual.update(idle, expiry, 0.1, 0.016);
    expect(shots.status(1)).toBe('refused');
    visual.update(idle, expiry, 0.4, 0.016);
    visual.update(idle, expiry, 0.45, 0.016);
    expect(weaponDrawn(visual, 'shell')).toBe(0);
    expect(weaponDrawn(visual, 'shock')).toBe(0);
    expect(scorchShown(visual)).toBe(false);
    // The server did fire it after all: a fresh shell, and its report played on the click.
    const late = viewOf(state, [ownFired(expiry)]);
    visual.update(late, expiry, 0.5, 0.016);
    expect(fired).toHaveBeenCalledTimes(1);
    expect(fired.mock.calls[0][4]).toBe(false);
    expect(reports()).toBe(1);
    expect(weaponDrawn(visual, 'shell')).toBe(1);
    visual.dispose();
  });

  it('never replays a shot an earlier visual of the page already played', () => {
    const shots = new TurretOwnShotLedger();
    const state = engine(0);
    shots.mark(viewOf(state), 160, click);
    // A rebuilt visual (a graphics rebuild) shares the page's ledger.
    const rebuilt = new TurretDefenseVisual(
      new THREE.Scene(),
      () => 0,
      undefined,
      undefined,
      undefined,
      undefined,
      shots,
    );
    const weapon = (rebuilt as unknown as { weapon: CannonShellVisuals }).weapon;
    const launched = vi.spyOn(weapon, 'launchOwn');
    rebuilt.update(viewOf(state), 161, 0.05, 0.016);
    expect(launched).not.toHaveBeenCalled();
    shots.mark(viewOf(state), 170, { ...click, z: 3 });
    rebuilt.update(viewOf(state), 170, 0.5, 0.016);
    expect(launched).toHaveBeenCalledTimes(1);
    rebuilt.dispose();
  });

  it('flies a fresh shell with no second report when its own shell is gone', () => {
    const { shots, visual, fired, reports } = ownRig();
    const state = engine(0);
    const idle = viewOf(state);
    visual.update(idle, 160, 0, 0.016);
    shots.mark(idle, 160, click);
    visual.update(idle, 160, 0.016, 0.016);
    // A frame with no seat mirrored clears the shots; the same seat comes back.
    visual.update(null, 161, 0.05, 0.016);
    visual.update(viewOf(state, [ownFired(162)]), 162, 0.1, 0.016);
    expect(fired).toHaveBeenCalledTimes(1);
    expect(fired.mock.calls[0][4]).toBe(false);
    expect(reports()).toBe(1);
    expect(weaponDrawn(visual, 'shell')).toBe(1);
    visual.dispose();
  });

  describe('never plays a shot twice, on either host', () => {
    const EMPTY_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
    const FPS = 60;
    const groundAt = (x: number, z: number) => groundHeight(x, z, WORLD_SEED);

    function listeners(
      world: Pick<IWorldVehicles, 'turretSession' | 'turretClock' | 'useVehicleAction'>,
    ) {
      const rig = ownRig(groundAt);
      const aim = new TurretAimCore(world, rig.shots);
      const sink = {
        playAt: vi.fn((_key: string, _x: number, _y: number, _z: number, _opts?: unknown) => true),
        preload: vi.fn((_key: string) => {}),
      };
      const sounds = new TurretDefenseSfx(
        sink,
        () => null,
        () => 0,
        rig.shots,
      );
      const heard = () =>
        sink.playAt.mock.calls.filter((call) => call[0] === TURRET_FIRE_SFX).length;
      return { ...rig, aim, sounds, heard };
    }

    /** One of a ring of aim points, a new one every click. */
    const pointFor = (n: number, cx: number, cz: number) => ({
      x: cx + Math.sin(n * 1.7) * (8 + (n % 5) * 9),
      z: cz + Math.cos(n * 1.7) * (8 + (n % 5) * 9),
    });

    it('offline: the report and the sound play once per shot the sim fired', () => {
      const sim = new Sim({
        seed: WORLD_SEED,
        playerClass: 'warrior',
        devCommands: true,
        world: EMPTY_WORLD,
      });
      sim.chat('/dev turret');
      const host = listeners(sim);
      let clicks = 0;
      let acc = 0;
      for (let frame = 0; frame < FPS * 20; frame++) {
        const time = frame / FPS;
        acc += 1 / FPS;
        while (acc >= DT) {
          sim.tick();
          acc -= DT;
        }
        const session = sim.turretSession!;
        if (frame % 13 === 0 && frame > FPS) {
          host.aim.commitAt(pointFor(clicks++, session.defense.cx, session.defense.cz));
        }
        host.visual.update(sim.turretSession, sim.turretClock, time, 1 / FPS);
        host.sounds.update(sim.turretSession, sim.turretClock);
      }
      const shots = sim.turretSession!.defense.stats.shots;
      expect(clicks).toBeGreaterThan(shots);
      expect(shots).toBeGreaterThan(20);
      // Offline the mirror is the sim itself: every shot it fires was played on its click.
      expect(host.launched.mock.calls.length).toBe(shots);
      expect(host.reports()).toBe(shots);
      expect(host.heard()).toBe(shots);
      host.visual.dispose();
    });

    interface Link {
      /** One-way delay and its jitter, ms. */
      delay?: number;
      jitter?: number;
      seed?: number;
      /** Clicks besides the ones on a bright reticle: none, every 17 frames, or every 5. */
      early?: 0 | 17 | 5;
      /** Every click on one point, so the fired entries cannot tell the clicks apart. */
      samePoint?: boolean;
      /** Seconds of clicking. */
      seconds?: number;
    }

    /** A seat played online; by default 60 ms plus or minus 30 ms each way, clicking when bright. */
    function online(link: Link) {
      const { delay: oneWay = 60, jitter = 30, seed = 0x60d, early = 0, samePoint } = link;
      const seconds = link.seconds ?? 19;
      const sim = new Sim({
        seed: WORLD_SEED,
        playerClass: 'warrior',
        devCommands: true,
        noPlayer: true,
        world: EMPTY_WORLD,
      });
      const pid = sim.addPlayer('warrior', 'Gunner', { characterId: 7 });
      sim.drainEvents();
      sim.chat('/dev turret', pid);
      const rng = new Rng(seed);
      const delay = () => (oneWay + rng.range(-jitter, jitter)) / 1000;
      const uplink: { at: number; command: QuestWorldCommand }[] = [];
      const downlink: {
        at: number;
        events: SimEvent[];
        self: Record<string, unknown>;
        time: number;
        tick: number;
      }[] = [];
      let now = 0;
      class Client extends QuestWorldWireState {
        protected override sendQuestWorldCommand(command: QuestWorldCommand): void {
          const last = uplink.at(-1)?.at ?? 0;
          uplink.push({ at: Math.max(last, now + delay()), command });
        }
        route(event: SimEvent): void {
          this.applyQuestWorldEvent(JSON.parse(JSON.stringify(event)) as SimEvent);
        }
      }
      const client = new Client();
      const host = listeners(client);
      const sent: Record<string, string> = {};
      let serverTicks = 0;
      let arrival = 0;
      let clicks = 0;
      let fired = 0;
      // Whether each click sent played its report, in send order; a played one the server refuses is a phantom.
      const sentPlayed: boolean[] = [];
      let dispatched = 0;
      let phantoms = 0;
      const shotsFired = () => sim.turretSession?.defense.stats.shots ?? 0;
      for (let frame = 0; frame < FPS * (seconds + 5); frame++) {
        now = frame / FPS;
        while (serverTicks * DT <= now) {
          while (uplink.length && uplink[0].at <= serverTicks * DT) {
            const before = shotsFired();
            dispatchVehicleCommand(sim, pid, JSON.parse(JSON.stringify(uplink.shift()!.command)));
            if (sentPlayed[dispatched++] && shotsFired() === before) phantoms++;
          }
          const events = sim.tick().filter((e) => e.pid === pid);
          for (const e of events) {
            if (e.type === 'turretDefense' && e.event.type === 'fired') fired++;
          }
          serverTicks++;
          let extra = '';
          emitTurretSelfKeys(
            (key, serialized) => {
              if (sent[key] === serialized) return;
              sent[key] = serialized;
              extra += `,"${key}":${serialized}`;
            },
            sim.meta(pid)!,
            sim.tickCount,
          );
          arrival = Math.max(arrival, serverTicks * DT + delay());
          downlink.push({
            at: arrival,
            events,
            self: JSON.parse(`{${extra.slice(1)}}`),
            time: sim.time,
            tick: sim.tickCount,
          });
        }
        while (downlink.length && downlink[0].at <= now) {
          const d = downlink.shift()!;
          for (const event of d.events) client.route(event);
          client.applyQuestSelfSnapshot(d.self, d.time, d.tick);
        }
        const session = client.turretSession;
        const target = session
          ? pointFor(samePoint ? 0 : clicks, session.defense.cx, session.defense.cz)
          : null;
        host.aim.updatePoint(target);
        // A player clicking once the reticle brightens, and maybe early clicks too.
        const ready = host.aim.reticle()?.dimmed === false;
        const eager = early > 0 && frame % early === 0;
        if (session && target && frame > FPS && frame < FPS * (seconds + 1) && (ready || eager)) {
          const before = host.launched.mock.calls.length;
          const played = host.shots.canMark(session, client.turretClock);
          sentPlayed.push(played);
          host.aim.commitAt(target);
          clicks++;
          host.visual.update(client.turretSession, client.turretClock, now, 1 / FPS);
          // A click the mirrors accept plays its report on that very frame.
          expect(host.launched.mock.calls.length).toBe(before + (played ? 1 : 0));
        } else host.visual.update(client.turretSession, client.turretClock, now, 1 / FPS);
        host.sounds.update(client.turretSession, client.turretClock);
      }
      expect(fired).toBeGreaterThan(20);
      expect(shotsFired()).toBe(fired);
      expect(sentPlayed).toHaveLength(dispatched);
      expect(phantoms).toBe(0);
      expect(host.reports()).toBe(fired);
      expect(host.heard()).toBe(fired);
      expect(host.shots.leadTicks).toBeGreaterThan(1);
      host.visual.dispose();
      return { fired, clicks, launched: host.launched.mock.calls.length };
    }

    it('online: a player clicking once the reticle brightens hears and sees every shot on the click', () => {
      const run = online({});
      expect(run.launched).toBe(run.fired);
    });

    const SEEDS = [0x60d, 0x1234, 0x9999];

    it('online over 150 ms plus or minus 75 ms: every shot on the click, none the server refuses', () => {
      for (const seed of SEEDS) {
        const run = online({ delay: 150, jitter: 75, seed, seconds: 60 });
        expect(run.launched).toBe(run.fired);
      }
    });

    it('online with impatient clicks too: still once per shot, most of them on the click', () => {
      // The mirror's clock trails the server's by a trip, so an early click it shows
      // cooling down can reach the server ready: that shot reports once, from its entry.
      const run = online({ early: 17 });
      expect(run.clicks).toBeGreaterThan(run.fired);
      expect(run.launched).toBeLessThan(run.fired);
      expect(run.launched).toBeGreaterThan(run.fired * 0.6);
    });

    it('online with every click on one point: once per shot, none played the server refuses', () => {
      // Its entries cannot tell the clicks apart: an older click the server refused must
      // not be read as a longer trip, or the reticle brightens too early.
      for (const seed of SEEDS) {
        online({ delay: 150, jitter: 75, seed, seconds: 60, samePoint: true });
        online({ delay: 100, jitter: 50, seed, seconds: 60, samePoint: true });
      }
      online({ early: 17, samePoint: true, seconds: 60 });
      online({ delay: 150, jitter: 75, early: 17, samePoint: true, seconds: 60 });
    });

    it('online with rapid clicks: once per shot, never a click played the server may refuse', () => {
      // Five clicks a cooldown: the server takes whichever arrives first once ready, which
      // no click can know, so the shots report from their entries.
      const run = online({ early: 5 });
      expect(run.clicks).toBeGreaterThan(3 * run.fired);
      online({ delay: 150, jitter: 75, seed: 0x1234, early: 5, seconds: 60 });
      online({ delay: 150, jitter: 75, seed: 0x1234, early: 5, samePoint: true, seconds: 60 });
    });
  });
});

describe('Fire and Fly limited weapons on screen', () => {
  const shockwaveAt = (seq: number, tick: number): TurretFeedback => ({
    seq,
    tick,
    event: { type: 'shockwave', id: 1, x: 0, y: 0, z: 0, startTick: tick, reach: 12 },
  });

  function hosted(visual: TurretDefenseVisual) {
    const host = {
      vfx: { burst: vi.fn() },
      camera: new THREE.PerspectiveCamera(),
      addShake: vi.fn(),
      punchFov: vi.fn(),
    };
    visual.setHost(host as unknown as CannonShellHost);
    return host;
  }

  it('plays a Shockwave from its ring entry: the head hops, chips fly, the dust wall rolls, the mark is laid', async () => {
    const state = engine(0);
    const view = { ...viewOf(state), origin: { x: 0, y: 7, z: 0 } };
    const { visual } = await seatedWithTower(view);
    const host = hosted(visual);
    const head = part(visual, TURRET_TOWER_MODEL.headNode);
    visual.update(view, 199, 1, 0.016);
    const rest = head.position.y;
    const slammed = { ...viewOf(state, [shockwaveAt(1, 200)]), origin: view.origin };
    visual.update(slammed, 200, 2, 0.016);
    expect(host.addShake).toHaveBeenCalled();
    expect(host.punchFov).toHaveBeenCalled();
    visual.update(slammed, 201, 2 + TURRET_HEAD_HOP.riseTime, 0.016);
    expect(head.position.y).toBeGreaterThan(rest);
    expect(weaponDrawn(visual, 'stone')).toBe(turretShockwaveCounts(false).chips);
    expect(weaponDrawn(visual, 'shock')).toBe(turretShockwaveCounts(false).wall);
    expect(scorchShown(visual)).toBe(true);
    visual.update(slammed, 230, 4, 0.016);
    expect(head.position.y).toBeCloseTo(rest, 12);
    // Read once: a later frame plays nothing again.
    expect(host.addShake).toHaveBeenCalledTimes(1);
    visual.dispose();
  });

  it("plays an own Shockwave's slam on the click, and only its front from its entry", () => {
    const shots = new TurretOwnShotLedger();
    const visual = new TurretDefenseVisual(
      new THREE.Scene(),
      () => 0,
      undefined,
      undefined,
      undefined,
      undefined,
      shots,
    );
    const host = hosted(visual);
    const weapons = (visual as unknown as { weapons: { slam: () => void } }).weapons;
    const slam = vi.spyOn(weapons, 'slam');
    const launched = vi.spyOn(
      (visual as unknown as { weapon: CannonShellVisuals }).weapon,
      'launchOwn',
    );
    const state = engine(0);
    const idle = viewOf(state);
    visual.update(idle, 160, 0, 0.016);
    shots.markWeapon(idle, 160, { x: 0, z: 0, dirX: 0, dirZ: 1, range: 0 }, 'shock', 'played');
    visual.update(idle, 160, 0.016, 0.016);
    expect(slam).toHaveBeenCalledTimes(1);
    expect(host.addShake).toHaveBeenCalledTimes(1);
    // A Shockwave is no shell: nothing leaves the barrel.
    expect(launched).not.toHaveBeenCalled();
    expect(weaponDrawn(visual, 'shell')).toBe(0);
    expect(weaponDrawn(visual, 'shock')).toBe(0);
    const confirmed = viewOf(state, [shockwaveAt(1, 163)]);
    visual.update(confirmed, 163, 0.17, 0.016);
    visual.update(confirmed, 164, 0.2, 0.016);
    expect(slam).toHaveBeenCalledTimes(1);
    expect(weaponDrawn(visual, 'shock')).toBeGreaterThan(0);
    visual.dispose();
  });

  it('fizzes a frag shell in flight, bursts it into its bomblets and lands each one in a small, cloudless blast', () => {
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0);
    const state = engine(0);
    const frag: TurretFeedback = {
      ...firedAt160,
      event: {
        ...(firedAt160.event as Extract<TurretFeedback['event'], { type: 'fired' }>),
        weapon: 'frag',
      },
    };
    visual.update(viewOf(state, [firedAt160]), 164, 0.2, 0.016);
    const plainSparks = weaponDrawn(visual, 'trailSpark');
    visual.dispose();
    const fizzing = new TurretDefenseVisual(new THREE.Scene(), () => 0);
    fizzing.update(viewOf(state, [frag]), 164, 0.2, 0.016);
    expect(weaponDrawn(fizzing, 'trailSpark')).toBeGreaterThan(plainSparks);
    const shot = { id: 1, x: 20, z: 0, damage: 60, impactTick: 168, weapon: 'frag' as const };
    const burst = burstTurretFrag(shot as never, 0, 0, 168, flat).event;
    if (burst.type !== 'fragBurst') throw new Error('fragBurst expected');
    const feed: TurretFeedback[] = [frag, { seq: 2, tick: 168, event: burst }];
    fizzing.update(viewOf(state, feed), 168, 0.4, 0.016);
    expect(weaponDrawn(fizzing, 'shell')).toBe(TURRET_BOMBLETS);
    expect(weaponDrawn(fizzing, 'flash')).toBe(1);
    let seq = 3;
    for (const b of burst.bomblets) {
      feed.push({
        seq: seq++,
        tick: b.landTick,
        event: { type: 'bomblet', shotId: 1, index: b.index, x: b.x, y: b.y, z: b.z, hits: [] },
      });
      fizzing.update(viewOf(state, feed), b.landTick, 0.4 + (b.landTick - 168) * DT, 0.016);
    }
    expect(weaponDrawn(fizzing, 'shell')).toBe(0);
    expect(scorchShown(fizzing)).toBe(true);
    for (const time of [1, 1.4, 1.8]) {
      fizzing.update(viewOf(state, feed), 180, time, 0.016);
      expect(weaponDrawn(fizzing, 'dust')).toBe(0);
    }
    fizzing.dispose();
  });

  function shellEnd(visual: TurretDefenseVisual, shotId: number): CannonPoint {
    const timeline = (visual as unknown as { weapon: { pools: { timeline: CannonShotTimeline } } })
      .weapon.pools.timeline;
    const index = timeline.shells.findIndex((s) => s.shotId === shotId && !s.landed);
    if (index < 0) throw new Error(`no shell of shot ${shotId}`);
    const end = { x: 0, y: 0, z: 0 };
    timeline.arcPointInto(index, 1, end);
    return end;
  }

  const fragBurstOf = (id: number) => {
    const shot = { id, x: 20, z: 0, damage: 60, impactTick: 168, weapon: 'frag' as const };
    const burst = burstTurretFrag(shot as never, 0, 0, 168, flat).event;
    if (burst.type !== 'fragBurst') throw new Error('fragBurst expected');
    return burst;
  };

  it('flies a frag shell to its airburst point, the barrel laid on it, not to the ground under it', async () => {
    const state = engine(0);
    const view = { ...viewOf(state), origin: { x: 0, y: 7, z: 0 } };
    const { visual } = await seatedWithTower(view);
    const barrel = part(visual, TURRET_TOWER_MODEL.barrelNode);
    const frag: TurretFeedback = {
      ...firedAt160,
      event: {
        ...(firedAt160.event as Extract<TurretFeedback['event'], { type: 'fired' }>),
        weapon: 'frag',
      },
    };
    visual.update({ ...viewOf(state, [frag]), origin: view.origin }, 160, 1, 0.016);
    const burst = fragBurstOf(1);
    const end = shellEnd(visual, 1);
    expect(end.x).toBeCloseTo(burst.x, 9);
    expect(end.y).toBeCloseTo(burst.y, 9);
    expect(end.z).toBeCloseTo(burst.z, 9);
    expect(barrel.rotation.x).toBeCloseTo(-turretBarrelPitch(20, burst.y - 7), 12);
    visual.dispose();
  });

  it('flies an own frag shell to its airburst point from the click, and still once its entry adopts it', () => {
    const shots = new TurretOwnShotLedger();
    const visual = new TurretDefenseVisual(
      new THREE.Scene(),
      () => 0,
      undefined,
      undefined,
      undefined,
      undefined,
      shots,
    );
    const state = engine(0);
    const idle = viewOf(state);
    visual.update(idle, 160, 0, 0.016);
    const click = { x: 20, z: 0, dirX: 1, dirZ: 0, range: 20 };
    const serial = shots.markWeapon(idle, 160, click, 'frag', 'played');
    visual.update(idle, 160, 0.016, 0.016);
    const burst = fragBurstOf(1);
    expect(shellEnd(visual, -serial).y).toBeCloseTo(burst.y, 9);
    const fired: TurretFeedback = {
      seq: 1,
      tick: 163,
      event: {
        type: 'fired',
        shotId: 1,
        fromX: 0,
        fromZ: 0,
        x: 20,
        y: 0,
        z: 0,
        flightTicks: 5,
        impactTick: 168,
        weapon: 'frag',
      },
    };
    visual.update(viewOf(state, [fired]), 163, 0.17, 0.016);
    const end = shellEnd(visual, 1);
    expect(end.x).toBeCloseTo(burst.x, 9);
    expect(end.y).toBeCloseTo(burst.y, 9);
    expect(end.z).toBeCloseTo(burst.z, 9);
    visual.dispose();
  });

  it("keeps a frag's blasts, a whole keg chain's and a shell's on the ground at once, none taken over", () => {
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0);
    const shot = { id: 2, x: 30, z: 0, damage: 60, impactTick: 168, weapon: 'frag' as const };
    const burst = burstTurretFrag(shot as never, 0, 0, 168, flat).event;
    if (burst.type !== 'fragBurst') throw new Error('fragBurst expected');
    const feed: TurretFeedback[] = [impactAt168, { seq: 2, tick: 168, event: burst }];
    for (const b of burst.bomblets) {
      feed.push({
        seq: feed.length + 1,
        tick: 168,
        event: { type: 'bomblet', shotId: 2, index: b.index, x: b.x, y: b.y, z: b.z, hits: [] },
      });
    }
    for (let id = 1; id <= TURRET_EXPLOSIVE_BARREL.cap; id++) {
      feed.push({
        seq: feed.length + 1,
        tick: 168,
        event: { type: 'barrelExploded', id, x: 10 * id, y: 0, z: 30, hits: [] },
      });
    }
    visual.update(viewOf(engine(0), feed), 168, 0, 0.016);
    expect(weaponDrawn(visual, 'flash')).toBe(
      1 + 1 + TURRET_BOMBLETS + TURRET_EXPLOSIVE_BARREL.cap,
    );
    visual.dispose();
  });

  it('draws the limited weapons on the programs the weapon linked at the commitment', () => {
    const visual = new TurretDefenseVisual(new THREE.Scene(), () => 0);
    hosted(visual);
    const state = engine(0);
    visual.update(viewOf(state), 160, 0, 0.016);
    const weaponRoot = part(visual, 'fire-and-fly-weapon');
    const keysOf = () =>
      new Set(drawsUnder(weaponRoot).map((d) => threeProgramKeys(d.material, d.object)));
    const built = keysOf();
    const materials = new Set(drawsUnder(weaponRoot).map((d) => d.material));
    const shot = { id: 1, x: 20, z: 0, damage: 60, impactTick: 168, weapon: 'frag' as const };
    const burst = burstTurretFrag(shot as never, 0, 0, 168, flat).event;
    const feed: TurretFeedback[] = [
      shockwaveAt(1, 166),
      { seq: 2, tick: 168, event: burst },
      {
        seq: 3,
        tick: 172,
        event: { type: 'bomblet', shotId: 1, index: 0, x: 20, y: 0, z: 0, hits: [] },
      },
    ];
    for (const [tick, time] of [
      [166, 0.1],
      [168, 0.2],
      [172, 0.4],
      [175, 0.6],
    ] as const) {
      visual.update(viewOf(state, feed), tick, time, 0.016);
    }
    expect(weaponDrawn(visual, 'shock')).toBeGreaterThan(0);
    expect(keysOf()).toEqual(built);
    expect(new Set(drawsUnder(weaponRoot).map((d) => d.material))).toEqual(materials);
    let lights = 0;
    visual.group.traverse((node) => {
      if ((node as THREE.Light).isLight) lights++;
    });
    expect(lights).toBe(0);
    visual.dispose();
  });
});
