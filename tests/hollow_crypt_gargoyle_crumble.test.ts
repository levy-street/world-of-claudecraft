// The Chapel Gargoyle's death (docs: src/render/hollow_crypt/CLAUDE.md): the
// pure plan (crypt_gargoyle_crumble_core.ts), the rig seam that hides the body
// and leaves a clickable corpse on the heap (characters/gesture_mesh_toggles.ts
// `remains`, read by CharacterVisual), and the shipped rubble pieces the plan's
// sizes are pinned to (public/models/props/hollow_crypt_kit.glb).

import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AnimState } from '../src/render/characters/anim_state';
import {
  GestureMeshToggles,
  meshToggleRemains,
  remainsPickHeight,
  splitGestureDrop,
} from '../src/render/characters/gesture_mesh_toggles';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import type { CharacterVisual } from '../src/render/characters/visual';
import {
  CRUMBLE,
  CRUMBLE_CALM,
  CRUMBLE_CHUNKS,
  CRUMBLE_GRAVITY,
  type CrumbleChunk,
  type CrumbleChunkPose,
  type CrumblePhase,
  crumbleChunkCount,
  crumbleChunkInto,
  crumbleChunkPoseInto,
  crumbleChunksSeconds,
  crumbleFallSeconds,
  crumbleHeapYaw,
  crumblePhaseInto,
  GARGOYLE_AUTHORED_SCALE,
  GARGOYLE_CROUCH_TOP,
  GARGOYLE_REMAINS,
  GARGOYLE_RUBBLE,
  GARGOYLE_RUBBLE_GESTURE,
  GARGOYLE_WHOLE_GESTURE,
  gargoyleRubbleGesture,
} from '../src/render/hollow_crypt/crypt_gargoyle_crumble_core';
import { CryptTrashKitFx } from '../src/render/hollow_crypt/crypt_trash_kit_fx';
import {
  CRYPT_KIT_MOBS,
  CRYPT_KIT_SLOTS,
} from '../src/render/hollow_crypt/crypt_trash_kit_fx_core';
import { HOLLOW_CRYPT_SPAWNS } from '../src/sim/content/hollow_crypt';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import type { Entity } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

/** A player stands 2.6 yd; the knee is a little over a quarter of that. */
const PLAYER_KNEE = 0.7;

const phase = (): CrumblePhase => ({
  cracks: 0,
  crackGlow: 0,
  broken: false,
  flash: 0,
  heap: 0,
  settling: 0,
  done: false,
});
const chunk = (): CrumbleChunk => ({
  x: 0,
  y: 0,
  z: 0,
  delay: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  size: 1,
  shard: false,
  yaw: 0,
  spin: 0,
  ax: 0,
  ay: 1,
  az: 0,
  survives: false,
});
const pose = (): CrumbleChunkPose => ({
  x: 0,
  y: 0,
  z: 0,
  angle: 0,
  scale: 1,
  impactAt: 0,
  landed: false,
});

describe('the gargoyle crumble: the beat', () => {
  it('holds while the cracks race, then the body is gone, well inside two seconds', () => {
    const p = phase();
    crumblePhaseInto(0, 0, false, p);
    expect(p.broken).toBe(false);
    expect(p.cracks).toBe(0);
    expect(p.heap).toBe(0);
    // The cracks only ever spread while the body stands.
    let last = 0;
    for (let t = 0; t < CRUMBLE.crack; t += 0.02) {
      crumblePhaseInto(t, 0, false, p);
      expect(p.broken).toBe(false);
      expect(p.cracks).toBeGreaterThanOrEqual(last);
      expect(p.flash).toBe(0);
      last = p.cracks;
    }
    expect(last).toBeGreaterThan(0.8);
    crumblePhaseInto(CRUMBLE.crack, 0, false, p);
    expect(p.broken).toBe(true);
    expect(p.cracks).toBe(0);
    expect(p.flash).toBe(1);
    expect(CRUMBLE.crack).toBeLessThan(0.6);
    // Every block is down, and the heap fully up, inside two seconds of the death.
    expect(CRUMBLE.crack + crumbleChunksSeconds(0)).toBeLessThan(4);
    crumblePhaseInto(2, 0, false, p);
    expect(p.heap).toBe(1);
    expect(p.flash).toBe(0);
    expect(p.done).toBe(false);
    crumblePhaseInto(CRUMBLE.settle, 0, false, p);
    expect(p.done).toBe(true);
    expect(p.settling).toBe(0);
  });

  it('the calm beat throws nothing: no cracks, no flash, the heap inside a second', () => {
    const p = phase();
    for (let t = 0; t < 3; t += 0.05) {
      crumblePhaseInto(t, 0, true, p);
      expect(p.cracks).toBe(0);
      expect(p.flash).toBe(0);
      expect(p.broken).toBe(t >= CRUMBLE_CALM.veil);
    }
    crumblePhaseInto(CRUMBLE_CALM.veil + CRUMBLE_CALM.heap, 0, true, p);
    expect(p.heap).toBe(1);
    expect(CRUMBLE_CALM.veil + CRUMBLE_CALM.heap).toBeLessThan(1);
    crumblePhaseInto(CRUMBLE_CALM.settle, 0, true, p);
    expect(p.done).toBe(true);
  });

  it('a body that broke in the air: the heap waits for the stone to reach the floor', () => {
    const drop = 8.4;
    const fall = crumbleFallSeconds(drop, GARGOYLE_AUTHORED_SCALE);
    expect(fall).toBeCloseTo(
      Math.sqrt((2 * drop) / (CRUMBLE_GRAVITY * GARGOYLE_AUTHORED_SCALE)),
      9,
    );
    expect(crumbleFallSeconds(0, 1.5)).toBe(0);
    expect(crumbleFallSeconds(-3, 1.5)).toBe(0);
    const ground = phase();
    const air = phase();
    const t = CRUMBLE.crack + 0.14 + CRUMBLE.heap * 0.5;
    crumblePhaseInto(t, 0, false, ground);
    crumblePhaseInto(t, fall, false, air);
    expect(ground.heap).toBeGreaterThan(0.4);
    expect(air.heap).toBe(0);
    // The rig goes at the same moment either way.
    expect(air.broken).toBe(true);
    crumblePhaseInto(t + fall, fall, false, air);
    expect(air.heap).toBeCloseTo(ground.heap, 9);
  });
});

describe('the gargoyle crumble: the falling blocks', () => {
  const plans = Array.from({ length: CRUMBLE_CHUNKS }, (_, i) => crumbleChunkInto(i, chunk()));

  it('is stateless: the same index is always the same block', () => {
    for (let i = 0; i < CRUMBLE_CHUNKS; i++) expect(crumbleChunkInto(i, chunk())).toEqual(plans[i]);
  });

  it('cuts the blocks out of the standing body, feet first', () => {
    let shards = 0;
    for (const c of plans) {
      expect(c.y).toBeGreaterThan(0);
      expect(c.y).toBeLessThanOrEqual(GARGOYLE_CROUCH_TOP + 0.01);
      // Inside the wingspan and the body's length.
      expect(Math.abs(c.x)).toBeLessThan(5);
      expect(Math.abs(c.z)).toBeLessThan(3.6);
      expect(c.delay).toBeGreaterThanOrEqual(0);
      expect(c.delay).toBeLessThanOrEqual(CRUMBLE.release);
      expect(Math.hypot(c.ax, c.ay, c.az)).toBeCloseTo(1, 6);
      expect(c.size).toBeGreaterThan(0.25);
      expect(c.size).toBeLessThan(1.05);
      if (c.shard) shards++;
    }
    // Both blocks and splinters fall, and both sides of the body break.
    expect(shards).toBeGreaterThan(4);
    expect(shards).toBeLessThan(CRUMBLE_CHUNKS / 2);
    expect(plans.some((c) => c.x > 1.5)).toBe(true);
    expect(plans.some((c) => c.x < -1.5)).toBe(true);
    // The feet give way before the wing tips.
    const low = plans.filter((c) => c.y < 1.5);
    const high = plans.filter((c) => c.y > 4.2);
    const mean = (list: CrumbleChunk[]) => list.reduce((s, c) => s + c.delay, 0) / list.length;
    expect(low.length).toBeGreaterThan(2);
    expect(high.length).toBeGreaterThan(2);
    expect(mean(low)).toBeLessThan(mean(high));
    // Some blocks survive the fall and some smash.
    expect(plans.some((c) => c.survives)).toBe(true);
    expect(plans.some((c) => !c.survives)).toBe(true);
  });

  it.each([0, 5.6, 8])('every block ends ON the floor (broke %s yd up)', (lift) => {
    const out = pose();
    const end = crumbleChunksSeconds(lift);
    for (const c of plans) {
      let landedAt = -1;
      for (let t = 0; t <= end + 0.5; t += 1 / 60) {
        crumbleChunkPoseInto(c, t, lift, out);
        // Never under the floor, never over where it started.
        expect(out.y).toBeGreaterThanOrEqual(-1e-6);
        expect(out.y).toBeLessThanOrEqual(c.y + lift + 0.5);
        expect(out.scale).toBeGreaterThanOrEqual(0);
        expect(out.scale).toBeLessThanOrEqual(1);
        if (out.landed && landedAt < 0) landedAt = t;
        if (!out.landed) expect(out.scale).toBe(1);
      }
      // It landed when the plan says, and is gone by the end.
      expect(landedAt).toBeGreaterThan(0);
      expect(landedAt).toBeGreaterThanOrEqual(out.impactAt - 1e-6);
      expect(landedAt).toBeLessThanOrEqual(out.impactAt + 1 / 60 + 1e-6);
      expect(out.scale).toBe(0);
      // It came down round the heap, not across the room.
      expect(Math.hypot(out.x, out.z)).toBeLessThan(6 + lift * 0.6);
    }
  });

  it('holds its place until it lets go, and a smashed block is gone the frame it lands', () => {
    const out = pose();
    for (const c of plans) {
      crumbleChunkPoseInto(c, 0, 0, out);
      expect([out.x, out.y, out.z]).toEqual([c.x, c.y, c.z]);
      expect(out.angle).toBe(c.yaw);
      crumbleChunkPoseInto(c, out.impactAt + 1e-3, 0, out);
      expect(out.landed).toBe(true);
      if (c.survives) expect(out.scale).toBe(1);
      else expect(out.scale).toBe(0);
    }
  });

  it('falls farther, and so longer, from the air', () => {
    const a = pose();
    const b = pose();
    for (const c of plans) {
      crumbleChunkPoseInto(c, 0, 0, a);
      crumbleChunkPoseInto(c, 0, 6, b);
      expect(b.impactAt).toBeGreaterThan(a.impactAt);
      expect(b.y - a.y).toBeCloseTo(6, 9);
    }
    expect(crumbleChunksSeconds(6)).toBeGreaterThan(crumbleChunksSeconds(0));
  });

  it('sheds blocks with the effects tier, never to nothing', () => {
    expect(crumbleChunkCount(1)).toBe(CRUMBLE_CHUNKS);
    expect(crumbleChunkCount(0.45)).toBe(Math.round(CRUMBLE_CHUNKS * 0.45));
    expect(crumbleChunkCount(0.45)).toBeLessThan(CRUMBLE_CHUNKS / 2);
    expect(crumbleChunkCount(0)).toBe(10);
    expect(crumbleChunkCount(7)).toBe(CRUMBLE_CHUNKS);
  });
});

describe('the gargoyle crumble: the heap is the corpse', () => {
  const template = MOBS[CRYPT_KIT_MOBS.gargoyle];

  it('is sized for the gargoyle as the template draws it, under a knee', () => {
    expect(template.scale).toBe(GARGOYLE_AUTHORED_SCALE);
    expect(GARGOYLE_RUBBLE.height).toBeLessThan(PLAYER_KNEE);
    expect(GARGOYLE_REMAINS.height * GARGOYLE_AUTHORED_SCALE).toBeCloseTo(
      GARGOYLE_RUBBLE.height,
      9,
    );
    expect(GARGOYLE_REMAINS.radius * GARGOYLE_AUTHORED_SCALE).toBeCloseTo(
      GARGOYLE_RUBBLE.radius,
      9,
    );
  });

  it('has a slot for every gargoyle of the run lying at once', () => {
    const inRun = HOLLOW_CRYPT_SPAWNS.filter((s) => s.mobId === CRYPT_KIT_MOBS.gargoyle).length;
    expect(inRun).toBeGreaterThan(0);
    expect(CRYPT_KIT_SLOTS.rubble).toBeGreaterThanOrEqual(inRun);
  });

  it('turns each heap its own way', () => {
    const yaws = new Set([1, 2, 3, 4, 5].map((id) => crumbleHeapYaw(id, 0).toFixed(2)));
    expect(yaws.size).toBe(5);
    expect(crumbleHeapYaw(7, 1.25) - crumbleHeapYaw(7, 0)).toBeCloseTo(1.25, 9);
  });

  it('the rig hides its whole model on the gesture and shrinks onto the heap', () => {
    const def = VISUALS[visualKeyFor({ kind: 'mob', templateId: template.id } as Entity)];
    expect(def).toBe(VISUALS.mob_crypt_gargoyle);
    expect(def.meshToggles).toEqual([
      {
        nodes: ['*'],
        hideNow: GARGOYLE_RUBBLE_GESTURE,
        showNow: GARGOYLE_WHOLE_GESTURE,
        remains: GARGOYLE_REMAINS,
      },
    ]);
    // The nameplate anchors at height * scale: on the heap, not nine yards up.
    expect(GARGOYLE_REMAINS.height * template.scale).toBeLessThan(PLAYER_KNEE);
    expect(def.height * template.scale).toBeGreaterThan(8);
  });

  it('says how far under a body left in the air the heap lies', () => {
    expect(gargoyleRubbleGesture(0, 1.5)).toBe(GARGOYLE_RUBBLE_GESTURE);
    expect(gargoyleRubbleGesture(0.02, 1.5)).toBe(GARGOYLE_RUBBLE_GESTURE);
    expect(gargoyleRubbleGesture(8.43, 1.5)).toBe(`${GARGOYLE_RUBBLE_GESTURE}@5.62`);
    expect(gargoyleRubbleGesture(8.43, 0)).toBe(GARGOYLE_RUBBLE_GESTURE);
    expect(splitGestureDrop(gargoyleRubbleGesture(8.43, 1.5))).toEqual({
      id: GARGOYLE_RUBBLE_GESTURE,
      drop: 5.62,
    });
    expect(splitGestureDrop(GARGOYLE_RUBBLE_GESTURE)).toEqual({
      id: GARGOYLE_RUBBLE_GESTURE,
      drop: 0,
    });
    // A suffix that is no positive number is no drop.
    expect(splitGestureDrop('x@').drop).toBe(0);
    expect(splitGestureDrop('x@nonsense')).toEqual({ id: 'x', drop: 0 });
    expect(splitGestureDrop('x@-4').drop).toBe(0);
  });
});

describe('mesh toggle remains (what a hidden body left behind)', () => {
  const defs = [
    { nodes: ['Howdah'], hideNow: 'break' },
    { nodes: ['*'], hideNow: 'rubble', showNow: 'whole', remains: { height: 0.4, radius: 1.5 } },
  ];

  it('are those of a hidden toggle that declares them, with the hide`s drop', () => {
    const model = new THREE.Group();
    const toggles = new GestureMeshToggles(model, defs);
    expect(toggles.remains()).toBeNull();
    // A toggle with no remains leaves none.
    expect(toggles.handle('break')).toBe(true);
    expect(toggles.remains()).toBeNull();
    expect(toggles.handle('rubble@5.62')).toBe(true);
    expect(model.visible).toBe(false);
    expect(toggles.hidden()).toBe('whole');
    expect(toggles.remains()).toEqual({ height: 0.4, radius: 1.5, drop: 5.62 });
    // Sent again (a view rebuilt later): idempotent.
    expect(toggles.handle('rubble@5.62')).toBe(true);
    expect(toggles.remains()).toEqual({ height: 0.4, radius: 1.5, drop: 5.62 });
    // A plain hide lies where the body stands.
    expect(toggles.handle('rubble')).toBe(true);
    expect(toggles.remains()?.drop).toBe(0);
    expect(toggles.handle('whole')).toBe(true);
    expect(model.visible).toBe(true);
    expect(toggles.remains()).toBeNull();
    toggles.handle('rubble@2');
    toggles.reset();
    expect(toggles.remains()).toBeNull();
    expect(model.visible).toBe(true);
  });

  it('an unknown gesture, suffixed or not, is not consumed', () => {
    const toggles = new GestureMeshToggles(new THREE.Group(), defs);
    expect(toggles.handle('attack')).toBe(false);
    expect(toggles.handle('attack@3')).toBe(false);
    expect(toggles.remains()).toBeNull();
  });

  it('the pure pick: the first hidden toggle with remains, a low capsule', () => {
    const shown = { shown: true, hideIn: null, clipSeen: false };
    const hidden = { shown: false, hideIn: null, clipSeen: false };
    expect(meshToggleRemains(defs, [hidden, shown], [0, 3])).toBeNull();
    expect(meshToggleRemains(defs, [shown, hidden], [0, 3])).toEqual({
      height: 0.4,
      radius: 1.5,
      drop: 3,
    });
    expect(remainsPickHeight({ height: 0.4, radius: 1.5 })).toBeCloseTo(0.8, 9);
  });
});

// ---- the rig: the click capsule and the height follow the remains ------------------------

const dummyEntity = {
  kind: 'mob',
  id: 1,
  templateId: 'training_dummy',
  color: 0xffffff,
  skin: 0,
  mainhandItemId: null,
} as unknown as Entity;

const anim = (dead: boolean): AnimState => ({
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead,
  casting: false,
  swimming: false,
  submerged: false,
  swimPitch: 0,
  wading: false,
  sitting: false,
});

function stubGltf() {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
  mesh.name = 'body';
  scene.add(mesh);
  const clip = (name: string) =>
    new THREE.AnimationClip(name, 1, [
      new THREE.NumberKeyframeTrack('body.position[x]', [0, 1], [0, 0]),
    ]);
  return { scene, animations: ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'].map(clip) };
}

/** The training dummy's rig (the one stub-loadable creature) wearing the
 *  gargoyle's own toggle row. */
async function makeCrumblingVisual(): Promise<CharacterVisual> {
  vi.resetModules();
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(() => Promise.resolve(stubGltf())),
    loadTexture: vi.fn(() => new Promise(() => undefined)),
    loadKtx2Texture: vi.fn(() => new Promise(() => undefined)),
    releaseGltf: vi.fn(),
  }));
  const manifest = await import('../src/render/characters/manifest');
  manifest.VISUALS.mob_training_dummy.meshToggles = manifest.VISUALS.mob_crypt_gargoyle.meshToggles;
  const { preloadTrainingDummyAssets } = await import('../src/render/characters/assets');
  await preloadTrainingDummyAssets();
  const { createCharacterVisual } = await import('../src/render/characters/index');
  const visual = createCharacterVisual(dummyEntity);
  if (!visual) throw new Error('test harness failed to build a CharacterVisual');
  visual.update(0, anim(false), true);
  return visual;
}

/** Is the rig's body mesh drawn (itself and everything over it visible)? */
function bodyDrawn(visual: CharacterVisual): boolean {
  const body = visual.root.getObjectByName('body');
  if (!body) throw new Error('rig body mesh missing');
  for (let o: THREE.Object3D | null = body; o; o = o.parent) if (!o.visible) return false;
  return true;
}

describe('CharacterVisual: a crumbled body is clicked and read on its heap', () => {
  it('shrinks the click capsule and the height onto the remains, and restores both', async () => {
    const visual = await makeCrumblingVisual();
    const proxy = visual.clickProxy;
    const standing = { h: visual.height, sx: proxy.scale.x, sy: proxy.scale.y };
    expect(standing.h).toBeGreaterThan(GARGOYLE_REMAINS.height * 2);
    expect(bodyDrawn(visual)).toBe(true);

    // It dies: the corpse capsule, still the body's width.
    visual.update(0, anim(true), true);
    expect(proxy.scale.x).toBe(standing.sx);
    expect(proxy.position.y).toBe(0);
    expect(bodyDrawn(visual)).toBe(true);

    // The beat hides the rig: the capsule is the heap's, on the floor.
    expect(visual.playAttack(GARGOYLE_RUBBLE_GESTURE)).toBe(0);
    expect(bodyDrawn(visual)).toBe(false);
    expect(visual.height).toBeCloseTo(GARGOYLE_REMAINS.height, 9);
    expect(proxy.scale.x).toBeCloseTo(GARGOYLE_REMAINS.radius * 2, 9);
    expect(proxy.scale.z).toBeCloseTo(GARGOYLE_REMAINS.radius * 2, 9);
    expect(proxy.scale.y).toBeCloseTo(remainsPickHeight(GARGOYLE_REMAINS), 9);
    expect(proxy.position.y).toBe(0);
    // The capsule is rooted at the feet: it covers the heap from the floor up.
    expect(proxy.scale.y).toBeGreaterThanOrEqual(GARGOYLE_REMAINS.height);

    // A body the sim left in the air: the capsule drops onto the heap below.
    visual.playAttack(`${GARGOYLE_RUBBLE_GESTURE}@5.62`);
    expect(proxy.position.y).toBeCloseTo(-5.62, 9);
    expect(visual.height).toBeCloseTo(GARGOYLE_REMAINS.height, 9);

    // It lives again: the whole rig, its own capsule.
    visual.update(0, anim(false), true);
    expect(bodyDrawn(visual)).toBe(true);
    expect(visual.height).toBe(standing.h);
    expect(proxy.scale.x).toBe(standing.sx);
    expect(proxy.scale.y).toBe(standing.sy);
    expect(proxy.position.y).toBe(0);
  });

  it('keeps the heap`s capsule when the rig`s own death edge comes after the hide', async () => {
    // The fx sees the death at once; the rig's collapse can be held for the
    // blade that dealt it (contact_queue.ts), so the hide may land first.
    const visual = await makeCrumblingVisual();
    const proxy = visual.clickProxy;
    visual.playAttack(GARGOYLE_RUBBLE_GESTURE);
    visual.update(0, anim(true), true);
    expect(proxy.scale.y).toBeCloseTo(remainsPickHeight(GARGOYLE_REMAINS), 9);
    expect(proxy.scale.x).toBeCloseTo(GARGOYLE_REMAINS.radius * 2, 9);
  });

  it('a pooled rig handed to another entity carries no hide and no heap capsule', async () => {
    // Parked hidden (the hide can land before the rig's own death edge, so no
    // revive edge follows): the next entity must not get an invisible body.
    const visual = await makeCrumblingVisual();
    const proxy = visual.clickProxy;
    const standing = { h: visual.height, sx: proxy.scale.x, sy: proxy.scale.y };
    visual.playAttack(`${GARGOYLE_RUBBLE_GESTURE}@5.62`);
    expect(bodyDrawn(visual)).toBe(false);
    visual.resetForReuse();
    expect(bodyDrawn(visual)).toBe(true);
    expect(visual.height).toBe(standing.h);
    expect(proxy.scale.x).toBe(standing.sx);
    expect(proxy.scale.y).toBe(standing.sy);
    expect(proxy.position.y).toBe(0);
  });

  it('the show gesture brings the rig and its corpse capsule back', async () => {
    const visual = await makeCrumblingVisual();
    const proxy = visual.clickProxy;
    visual.update(0, anim(true), true);
    const corpse = { sx: proxy.scale.x, sy: proxy.scale.y };
    visual.playAttack(`${GARGOYLE_RUBBLE_GESTURE}@3`);
    expect(bodyDrawn(visual)).toBe(false);
    visual.playAttack(GARGOYLE_WHOLE_GESTURE);
    expect(bodyDrawn(visual)).toBe(true);
    expect(proxy.scale.x).toBe(corpse.sx);
    expect(proxy.scale.y).toBe(corpse.sy);
    expect(proxy.position.y).toBe(0);
  });
});

// ---- the painter, driven through the real kit host ------------------------------------

interface FakeMob {
  id: number;
  kind: 'mob';
  templateId: string;
  dead: boolean;
  corpseTimer: number;
  scale: number;
  facing: number;
  pos: { x: number; y: number; z: number };
  auras: never[];
}

function crumbleRig(calm = false) {
  const origin = instanceOrigin(DUNGEONS.hollow_crypt.index, 0);
  const entities = new Map<number, FakeMob>();
  const world = { player: { pos: { x: origin.x, y: 0, z: origin.z } }, entities };
  const gestures: [number, string][] = [];
  let shakes = 0;
  const scene = new THREE.Scene();
  const fx = new CryptTrashKitFx(
    scene,
    () => 0,
    world as unknown as IWorld,
    undefined,
    () => calm,
    () => {
      shakes++;
    },
    (id, gesture) => gestures.push([id, gesture]),
  );
  const batch = (piece: string): THREE.InstancedMesh => {
    const mesh = fx.root.getObjectByName(`crypt-gargoyle-crumble:${piece}`);
    if (!(mesh instanceof THREE.InstancedMesh)) throw new Error(`${piece} batch missing`);
    return mesh;
  };
  const m = new THREE.Matrix4();
  /** Instances of a batch drawn right now (a zero-scale matrix draws nothing). */
  const drawn = (mesh: THREE.InstancedMesh): THREE.Matrix4[] => {
    const out: THREE.Matrix4[] = [];
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      if (Math.abs(m.elements[5]) + Math.abs(m.elements[0]) > 1e-9) out.push(m.clone());
    }
    return out;
  };
  const gargoyle = (id: number, dx: number, y = 0): FakeMob => {
    const mob: FakeMob = {
      id,
      kind: 'mob',
      templateId: CRYPT_KIT_MOBS.gargoyle,
      dead: false,
      corpseTimer: 60,
      scale: GARGOYLE_AUTHORED_SCALE,
      facing: 0,
      pos: { x: origin.x + dx, y, z: origin.z },
      auras: [],
    };
    entities.set(id, mob);
    return mob;
  };
  /** Run the host for `seconds` at 60 frames a second. */
  const run = (seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 60) fx.update(1 / 60);
  };
  return {
    fx,
    entities,
    gestures,
    gargoyle,
    run,
    drawn,
    heaps: batch('Kit_GargoyleRubble'),
    blocks: batch('Kit_GargoyleChunk'),
    shards: batch('Kit_GargoyleShard'),
    shakes: () => shakes,
  };
}

describe('the gargoyle crumble painter', () => {
  it('builds its batches once, hidden, on the stone material of the kit', () => {
    const rig = crumbleRig();
    expect(rig.heaps.material).toBe(rig.blocks.material);
    expect(rig.heaps.material).toBe(rig.shards.material);
    // The heap batch has room for every slot and submits none while none lies.
    expect(rig.heaps.instanceMatrix.count).toBe(CRYPT_KIT_SLOTS.rubble);
    expect(rig.heaps.count).toBe(0);
    for (const mesh of [rig.heaps, rig.blocks, rig.shards]) {
      expect(mesh.visible).toBe(false);
      expect(rig.drawn(mesh)).toHaveLength(0);
      // The batch shape of the kit: position, normal and a three-component colour.
      expect(mesh.geometry.getAttribute('color').itemSize).toBe(3);
      expect(mesh.geometry.getAttribute('normal')).toBeDefined();
      expect(mesh.instanceColor).toBeNull();
    }
    rig.fx.dispose();
  });

  it('a death seen: the rig goes at the break, blocks fall, the heap is left on the floor', () => {
    const rig = crumbleRig();
    const mob = rig.gargoyle(7, 12);
    rig.run(0.3);
    expect(rig.gestures).toHaveLength(0);
    mob.dead = true;
    // The held beat: the body still stands.
    rig.run(CRUMBLE.crack - 0.15);
    expect(rig.gestures).toHaveLength(0);
    expect(rig.drawn(rig.heaps)).toHaveLength(0);
    rig.run(0.4);
    expect(rig.gestures[0]).toEqual([7, GARGOYLE_RUBBLE_GESTURE]);
    expect(rig.shakes()).toBeGreaterThan(0);
    expect(rig.blocks.visible).toBe(true);
    expect(rig.drawn(rig.blocks).length + rig.drawn(rig.shards).length).toBeGreaterThan(10);
    rig.run(2);
    // Inside two seconds of the break: one heap, at the corpse, on the floor, full size.
    const heaps = rig.drawn(rig.heaps);
    expect(heaps).toHaveLength(1);
    expect(heaps[0].elements[12]).toBeCloseTo(mob.pos.x, 3);
    expect(heaps[0].elements[13]).toBe(0);
    expect(heaps[0].elements[5]).toBeCloseTo(1, 6);
    expect(rig.heaps.visible).toBe(true);
    // Every block is gone a little later, and the hide is still being sent
    // for a view built after the fact.
    const sent = rig.gestures.length;
    rig.run(3);
    expect(rig.blocks.visible).toBe(false);
    expect(rig.drawn(rig.blocks)).toHaveLength(0);
    expect(rig.drawn(rig.shards)).toHaveLength(0);
    expect(rig.gestures.length).toBeGreaterThan(sent);
    expect(rig.gestures.every(([id, g]) => id === 7 && g === GARGOYLE_RUBBLE_GESTURE)).toBe(true);
    expect(rig.drawn(rig.heaps)).toHaveLength(1);
    rig.fx.dispose();
  });

  it('a corpse found already lying is only its heap: no beat, no shake', () => {
    const rig = crumbleRig();
    const mob = rig.gargoyle(9, -8);
    mob.dead = true;
    rig.run(0.3);
    expect(rig.gestures[0]).toEqual([9, GARGOYLE_RUBBLE_GESTURE]);
    expect(rig.shakes()).toBe(0);
    expect(rig.blocks.visible).toBe(false);
    const heaps = rig.drawn(rig.heaps);
    expect(heaps).toHaveLength(1);
    expect(heaps[0].elements[5]).toBeCloseTo(1, 6);
    rig.fx.dispose();
  });

  it('killed in the air: the heap is on the floor and the gesture says how far under the body', () => {
    const rig = crumbleRig();
    const mob = rig.gargoyle(11, 5, 8.43);
    rig.run(0.3);
    mob.dead = true;
    rig.run(CRUMBLE.crack + 0.3);
    expect(rig.gestures[0]).toEqual([11, `${GARGOYLE_RUBBLE_GESTURE}@5.62`]);
    // The stone is still falling: no heap yet.
    expect(rig.drawn(rig.heaps)).toHaveLength(0);
    for (const block of rig.drawn(rig.blocks)) expect(block.elements[13]).toBeGreaterThan(-1e-6);
    rig.run(3);
    const heaps = rig.drawn(rig.heaps);
    expect(heaps).toHaveLength(1);
    expect(heaps[0].elements[13]).toBe(0);
    rig.fx.dispose();
  });

  it('reduced motion: no flying stone and no shake, the heap inside a second', () => {
    const rig = crumbleRig(true);
    const mob = rig.gargoyle(3, 0);
    rig.run(0.3);
    mob.dead = true;
    rig.run(1.1);
    expect(rig.gestures[0]).toEqual([3, GARGOYLE_RUBBLE_GESTURE]);
    expect(rig.shakes()).toBe(0);
    expect(rig.blocks.visible).toBe(false);
    expect(rig.drawn(rig.blocks)).toHaveLength(0);
    const heaps = rig.drawn(rig.heaps);
    expect(heaps).toHaveLength(1);
    expect(heaps[0].elements[5]).toBeCloseTo(1, 6);
    rig.fx.dispose();
  });

  it('a third gargoyle breaking at once still hides and leaves its heap', () => {
    const rig = crumbleRig();
    const mobs = [rig.gargoyle(1, 0), rig.gargoyle(2, 10), rig.gargoyle(3, 20)];
    rig.run(0.3);
    for (const mob of mobs) mob.dead = true;
    rig.run(3);
    expect(new Set(rig.gestures.map(([id]) => id))).toEqual(new Set([1, 2, 3]));
    expect(rig.drawn(rig.heaps)).toHaveLength(3);
    rig.fx.dispose();
  });

  it('it lives again: the rig is shown and the heap goes at once', () => {
    const rig = crumbleRig();
    const mob = rig.gargoyle(4, 0);
    rig.run(0.3);
    mob.dead = true;
    rig.run(1);
    expect(rig.drawn(rig.heaps)).toHaveLength(1);
    // One heap lying is one instance submitted, never the whole pool.
    expect(rig.heaps.count).toBe(1);
    mob.dead = false;
    rig.run(0.3);
    expect(rig.gestures.at(-1)).toEqual([4, GARGOYLE_WHOLE_GESTURE]);
    expect(rig.drawn(rig.heaps)).toHaveLength(0);
    expect(rig.drawn(rig.blocks)).toHaveLength(0);
    expect(rig.heaps.visible).toBe(false);
    expect(rig.heaps.count).toBe(0);
    // And it can die, and crumble, again.
    mob.dead = true;
    rig.run(3);
    expect(rig.gestures.at(-1)).toEqual([4, GARGOYLE_RUBBLE_GESTURE]);
    expect(rig.drawn(rig.heaps)).toHaveLength(1);
    rig.fx.dispose();
  });

  it('the heap sinks away when its corpse goes (despawned, or decayed)', () => {
    const rig = crumbleRig();
    const gone = rig.gargoyle(5, 0);
    const decayed = rig.gargoyle(6, 10);
    gone.dead = true;
    decayed.dead = true;
    rig.run(0.5);
    expect(rig.drawn(rig.heaps)).toHaveLength(2);
    expect(rig.heaps.count).toBe(2);
    rig.entities.delete(5);
    decayed.corpseTimer = 0;
    rig.run(1.5);
    expect(rig.drawn(rig.heaps)).toHaveLength(0);
    expect(rig.heaps.visible).toBe(false);
    expect(rig.heaps.count).toBe(0);
    // A rig that outlived its heap is never left hidden.
    const shown = rig.gestures.filter(([, g]) => g === GARGOYLE_WHOLE_GESTURE).map(([id]) => id);
    expect(shown.sort()).toEqual([5, 6]);
    rig.fx.dispose();
  });

  it('past the last slot a corpse keeps its plain body: no hide without a heap', () => {
    const rig = crumbleRig();
    for (let i = 0; i <= CRYPT_KIT_SLOTS.rubble; i++) rig.gargoyle(20 + i, i * 6).dead = true;
    rig.run(0.5);
    expect(rig.drawn(rig.heaps)).toHaveLength(CRYPT_KIT_SLOTS.rubble);
    expect(new Set(rig.gestures.map(([id]) => id)).size).toBe(CRYPT_KIT_SLOTS.rubble);
    rig.fx.dispose();
  });
});

// ---- the shipped pieces ---------------------------------------------------------------

describe('the shipped rubble pieces', () => {
  const bounds = new Map<string, { min: number[]; max: number[]; triangles: number }>();

  beforeAll(async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const doc = await io.readBinary(
      new Uint8Array(readFileSync('public/models/props/hollow_crypt_kit.glb')),
    );
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh();
      if (!mesh || !node.getName().startsWith('Kit_Gargoyle')) continue;
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      let triangles = 0;
      const el = [0, 0, 0];
      // The shipped positions are quantized: the node's matrix carries them to yards.
      const world = new THREE.Matrix4().fromArray(node.getWorldMatrix());
      const point = new THREE.Vector3();
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        if (!pos) continue;
        // The kit is one material slot of stone here: no glow, no silk.
        expect(prim.getMaterial()?.getName()).toBe('KitStone');
        expect(prim.getAttribute('COLOR_0')).not.toBeNull();
        triangles += (prim.getIndices()?.getCount() ?? pos.getCount()) / 3;
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, el);
          const at = point.fromArray(el).applyMatrix4(world).toArray();
          for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], at[k]);
            max[k] = Math.max(max[k], at[k]);
          }
        }
      }
      bounds.set(node.getName(), { min, max, triangles });
    }
  });

  it('the heap stands on the floor, under a knee, inside its click radius', () => {
    const heap = bounds.get('Kit_GargoyleRubble');
    if (!heap) throw new Error('Kit_GargoyleRubble missing from the shipped kit');
    // Its blocks are sunk a little into the grit, never hung over the floor.
    expect(heap.min[1]).toBeGreaterThanOrEqual(-0.2);
    expect(heap.min[1]).toBeLessThan(0.05);
    expect(heap.max[1]).toBeLessThanOrEqual(GARGOYLE_RUBBLE.height + 1e-3);
    expect(heap.max[1]).toBeGreaterThan(0.4);
    const reach = Math.max(-heap.min[0], heap.max[0], -heap.min[2], heap.max[2]);
    expect(reach).toBeLessThanOrEqual(GARGOYLE_RUBBLE.radius + 0.75);
    // A real heap, not a pebble: it fills most of what a click on it covers.
    expect(reach).toBeGreaterThan(GARGOYLE_RUBBLE.radius * 0.7);
    expect(heap.triangles).toBeLessThan(7000);
  });

  it('the falling block and splinter tumble about their own middle', () => {
    for (const name of ['Kit_GargoyleChunk', 'Kit_GargoyleShard']) {
      const piece = bounds.get(name);
      if (!piece) throw new Error(`${name} missing from the shipped kit`);
      for (let k = 0; k < 3; k++) {
        expect(Math.abs((piece.min[k] + piece.max[k]) / 2)).toBeLessThan(0.2);
      }
      expect(piece.triangles).toBeLessThan(200);
    }
    const chunk = bounds.get('Kit_GargoyleChunk');
    const shard = bounds.get('Kit_GargoyleShard');
    if (!chunk || !shard) throw new Error('pieces missing');
    // About a yard across at size 1, and the splinter long.
    expect(chunk.max[0] - chunk.min[0]).toBeGreaterThan(0.6);
    expect(chunk.max[0] - chunk.min[0]).toBeLessThan(1.5);
    expect(shard.max[0] - shard.min[0]).toBeGreaterThan(1.2);
  });
});
