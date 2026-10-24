// @vitest-environment happy-dom
// A WOC body's far LOD is built OFF the frame (src/render/characters/visual.ts with
// woc_far_bake.ts queueWocFarBake), on a REAL CharacterVisual with only asset IO stubbed
// (tests/helpers/woc_far_fixture.ts). Every case is something the synchronous far bake
// did to a live frame, each named where it is pinned: a body in the middle distance
// baked its whole far silhouette the frame the shadow plan asked for a proxy, and again
// from update() until it had one; the bake was one unit of work nobody could price; a
// re-dress while it waited mounted the stale silhouette or baked it twice; a crowd in one
// look paid a bake each; a body still waiting for its head baked a headless far mesh
// nobody saw; the far key was built again on every ask; and a WOC body was born with a
// far mesh its first dressing threw away, at the cost of a full material sweep.
import type * as THREE from 'three';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  GPU_QUEUE_SHUTDOWN_ERROR_NAME,
  GPU_WORK_PRIORITY,
} from '../src/render/background_gpu_queue';
import { gpuPrepKindOfLabel } from '../src/render/gpu_prep_budget_core';
import {
  boxVertices,
  heldQueue,
  IDLE,
  IDLE_SHIFT,
  KEY,
  PART,
  releaseWocFarFixture,
  type WocFarFixture,
  type WocFarFixtureVisual,
  wocFarFixture,
} from './helpers/woc_far_fixture';
import {
  FULL_KIT_EQUIPPED,
  IDLE as HEAD_IDLE,
  releaseWocVisualHarness,
  wocVisualHarness,
} from './helpers/woc_visual_harness';

type Visual = WocFarFixtureVisual;
type Gate = { target: THREE.Object3D; settle: (ready?: () => boolean) => void };

const ASSEMBLE = 'woc-far-assemble:male';
const SKIN = 'woc-far-skin:male';
const FOLD = 'woc-far-fold:male';
const MOUNT = 'woc-far-mount:male';

/** The rule the head and armor dressings read before they build a merged stand-in. */
const rigToStay = (v: Visual): boolean =>
  (v as unknown as { wocRigDrawn(): boolean }).wocRigDrawn();
const farMesh = (v: Visual): THREE.Mesh | undefined =>
  v.root.getObjectByName('character_far_mesh') as THREE.Mesh | undefined;
const rig = (v: Visual): THREE.Object3D =>
  v.root.getObjectByName('character_model_wrap') as THREE.Object3D;
const vertices = (mesh: THREE.Mesh | undefined): number =>
  mesh?.geometry.getAttribute('position').count ?? -1;

/** How many far bakes started: each assembles one throwaway model at the far level with
 *  no held prop (woc_far_bake.ts), which nothing else does once a key is prepared. */
function farBakes(assembled: { mock: { calls: unknown[][] } }): number {
  return assembled.mock.calls.filter(([def, , , , opts]) => {
    const o = opts as { wocLod?: string } | undefined;
    const d = def as { attach?: unknown[] };
    return o?.wocLod === 'far' && d.attach?.length === 0;
  }).length;
}

/** A body the way the world wires one: the compile gate with the work queue riding in
 *  beside it, then its first worn-set diff. */
function wired(
  f: WocFarFixture,
  queue: ReturnType<typeof heldQueue> | undefined,
  gates: Gate[],
  equipped: Record<string, string> = {},
): Visual {
  const v = f.body();
  v.setFarBakeGate((target, settle) => gates.push({ target, settle }), queue);
  v.setWocEquipment(equipped, false);
  return v;
}

/** One frame of a far body: the LOD pass, the shadow plan, the update. */
function farFrame(f: WocFarFixture, v: Visual, proxy = true): void {
  f.nextFrame(16);
  v.setFar(true);
  v.setProxyShadow(proxy);
  v.update(0.016, IDLE, true);
}

/** Everything of a far geometry a far mesh draws, as plain data. */
function drawn(geometry: THREE.BufferGeometry | undefined) {
  if (!geometry) throw new Error('no far geometry');
  return {
    position: [...geometry.getAttribute('position').array],
    normal: [...geometry.getAttribute('normal').array],
    uv: [...geometry.getAttribute('uv').array],
    index: [...(geometry.index?.array ?? [])],
    groups: geometry.groups.map((g) => [g.start, g.count, g.materialIndex]),
  };
}

/** Push every idle far bake out of the bounded idle cache: more idle bakes than it keeps,
 *  each newer than anything baked before (other keys' bodies come and gone). A bake still
 *  there afterwards is HELD by somebody. */
async function floodIdleBakes(f: WocFarFixture, tag: string): Promise<void> {
  const { VISUALS } = await import('../src/render/characters/manifest');
  const files = [{ set: 'fixture', url: f.kitUrl }];
  for (let i = 0; i < 40; i++) {
    const alias = `woc-far-queue-${tag}-${i}`;
    VISUALS[alias] = { ...VISUALS[KEY] };
    f.farBake.retainWocFarBake(alias, new Set(['Character_Body']), files)?.release();
  }
}

/** What a queue shut down with its renderer rejects a unit with. */
function shutdownError(): Error {
  return Object.assign(new Error('Renderer shut down'), { name: GPU_QUEUE_SHUTDOWN_ERROR_NAME });
}

// The module graph behind a visual is large: transform it once, outside any case's own
// budget (each fixture then only evaluates it again).
beforeAll(async () => {
  await import('../src/render/characters/visual');
}, 120_000);

afterEach(() => {
  releaseWocFarFixture();
  releaseWocVisualHarness();
});

describe("a WOC far bake is units of the renderer's work queue", () => {
  it('runs nothing inside setFar, setProxyShadow or update: the queue is handed labelled units, one at a time', async () => {
    const f = await wocFarFixture();
    const assembled = vi.spyOn(f.assets, 'assembleModel');
    // the bake budget of the synchronous path, OPEN (the real one): a body that still baked
    // on the spot would bake here, and a queued body never even asks it
    const budget = vi.spyOn(f.assets, 'takeFarBakeBudget');
    const queue = heldQueue();
    const gates: Gate[] = [];
    const v = wired(f, queue, gates);
    assembled.mockClear();
    // frame after frame in the far band, the queue running nothing (its budget is spent)
    for (let frame = 0; frame < 4; frame++) farFrame(f, v);
    expect(farBakes(assembled)).toBe(0);
    expect(assembled).not.toHaveBeenCalled();
    expect(farMesh(v)).toBeUndefined();
    expect(gates).toHaveLength(0);
    // the rig is what draws meanwhile: never a hidden body
    expect(rig(v).visible).toBe(true);
    // ONE unit waits, however many frames asked: the next is asked for by the one before
    expect(queue.labels()).toEqual([ASSEMBLE]);
    expect(queue.units[0].priority).toBe(GPU_WORK_PRIORITY.VISIBLE_PREWARM);

    // the queue gets to them, one unit a turn: the throwaway and its pose, the vertices,
    // the merge, then this body's own mount
    const ran: (string | undefined)[] = [];
    const priorities = new Set<number | undefined>();
    while (queue.units.length > 0) {
      expect(queue.units).toHaveLength(1);
      priorities.add(queue.units[0].priority);
      ran.push(await queue.runNext());
      // between two units the body still draws its rig and asks for nothing more
      farFrame(f, v);
      if (ran[ran.length - 1] !== MOUNT) expect(farMesh(v)).toBeUndefined();
    }
    expect(ran).toEqual([ASSEMBLE, SKIN, FOLD, MOUNT]);
    expect([...priorities]).toEqual([GPU_WORK_PRIORITY.VISIBLE_PREWARM]);
    // each label's kind is one the frame budget can learn a cost for
    expect(ran.map((label) => gpuPrepKindOfLabel(label ?? ''))).toEqual([
      'woc-far-assemble',
      'woc-far-skin',
      'woc-far-fold',
      'woc-far-mount',
    ]);
    expect(farBakes(assembled)).toBe(1);
    // mounted without the synchronous path's budget ever being asked: the queue paced it
    expect(vertices(farMesh(v))).toBe(boxVertices(1));
    expect(budget).not.toHaveBeenCalled();
    v.dispose();
  });

  it('asks the queue for nothing in the proxy band: a body that is not far bakes nothing, however it is dressed', async () => {
    // guards: the shadow plan asked every mid-range body for its far silhouette (a whole
    // far bake each, in the frame), and a re-dress there armed it again from update()
    const f = await wocFarFixture();
    const assembled = vi.spyOn(f.assets, 'assembleModel');
    const queue = heldQueue();
    const queued = wired(f, queue, []);
    const direct = wired(f, undefined, []);
    assembled.mockClear();
    const midFrame = (v: Visual): void => {
      f.nextFrame(40);
      v.setFar(false);
      v.setProxyShadow(true);
      v.update(0.016, IDLE, true);
    };
    for (const v of [queued, direct]) {
      for (let frame = 0; frame < 4; frame++) midFrame(v);
      // a new worn set in the band, then more frames: still nothing
      v.setWocEquipment({ chest: 'some-chest' }, false);
      for (let frame = 0; frame < 4; frame++) midFrame(v);
      expect(farMesh(v)).toBeUndefined();
      // what casts meanwhile is the key's stand-in
      expect(v.root.getObjectByName('character_shadow_stand_in')?.visible).toBe(true);
    }
    expect(queue.units).toHaveLength(0);
    expect(farBakes(assembled)).toBe(0);
    // (the spy does see a bake: the far crossing asks for one, on either path)
    farFrame(f, direct);
    expect(farBakes(assembled)).toBe(1);
    // ...and the queued body's own crossing finds that look baked: its mount alone
    farFrame(f, queued);
    await queue.settle();
    expect(queue.labels()).toEqual([MOUNT]);
    expect(farBakes(assembled)).toBe(1);
    queued.dispose();
    direct.dispose();
  });

  it('bakes the idle pose however many frames lie between its units', async () => {
    // the pose is sampled once, in the first unit, and read by every later one: a bake
    // that lost it between two units would freeze the rest pose (at the origin here)
    const f = await wocFarFixture({ segments: 20 });
    const queue = heldQueue();
    const v = wired(f, queue, []);
    farFrame(f, v);
    while (queue.units.length > 0) {
      await queue.runNext();
      // whole frames of the live body between two units, its own mixer running
      for (let frame = 0; frame < 3; frame++) farFrame(f, v);
    }
    const geometry = farMesh(v)?.geometry;
    if (!geometry) throw new Error('no far mesh');
    geometry.computeBoundingBox();
    const box = geometry.boundingBox as THREE.Box3;
    const { normScale } = f.assets.prepareVisual(KEY);
    // the fixture's idle carries the body IDLE_SHIFT across; at rest it straddles the origin
    expect(Math.abs((box.min.x + box.max.x) / 2)).toBeCloseTo(IDLE_SHIFT * normScale, 4);
    expect(box.max.x - box.min.x).toBeCloseTo(normScale, 4);
    v.dispose();
  });

  it('keeps the rig drawing until the mounted far mesh has linked behind the gate', async () => {
    const f = await wocFarFixture();
    const queue = heldQueue();
    const gates: Gate[] = [];
    const v = wired(f, queue, gates);
    farFrame(f, v);
    await queue.runAll();
    // mounted by its unit, hidden: the unit reveals nothing by itself
    const far = farMesh(v);
    expect(vertices(far)).toBe(boxVertices(1));
    expect(far?.visible).toBe(false);
    expect(rig(v).visible).toBe(true);
    expect(gates.map((gate) => gate.target.name)).toEqual(['character_far_wrap']);
    farFrame(f, v);
    expect(far?.visible).toBe(false);
    expect(rig(v).visible).toBe(true);
    // linked: the settle only flags, the next per-frame pass hands over
    gates[0].settle();
    expect(rig(v).visible).toBe(true);
    v.setFar(true);
    expect(far?.visible).toBe(true);
    expect(rig(v).visible).toBe(false);
    v.dispose();
  });

  it('cuts the vertices into bands: a body of more than one band is more than one skin unit', async () => {
    const f = await wocFarFixture({ segments: 20 });
    const { WOC_FAR_BAKE_BAND } = f.farBake;
    // the fixture body alone overflows a band, and the whole kit fits two
    const kit = f.bodyVertices + 2 * PART;
    expect(f.bodyVertices).toBeGreaterThan(WOC_FAR_BAKE_BAND);
    expect(kit).toBeLessThan(2 * WOC_FAR_BAKE_BAND);
    const queue = heldQueue();
    const equipped = { helmet: 'some-helm', chest: 'some-chest' };
    const v = wired(f, queue, [], equipped);
    farFrame(f, v);
    // two bands, so two skin units between the throwaway and the merge
    expect(await queue.runAll()).toEqual([ASSEMBLE, SKIN, SKIN, FOLD, MOUNT]);
    expect(vertices(farMesh(v))).toBe(kit);
    const banded = drawn(farMesh(v)?.geometry);
    v.dispose();
    // ...and the banded bake is THE bake: in a world of its own, a body with no queue
    // bakes the very same mesh on the spot (both paths run one list of steps)
    releaseWocFarFixture();
    const g = await wocFarFixture({ segments: 20 });
    const direct = wired(g, undefined, [], equipped);
    g.nextFrame();
    direct.setFar(true);
    expect(drawn(farMesh(direct)?.geometry)).toEqual(banded);
    direct.dispose();
  }, 60_000);

  it('records a span in the CPU build ledger for every unit, the mount under its own kind', async () => {
    const f = await wocFarFixture();
    // this module world's ledger seam (the fixture imports every module fresh)
    const { setBuildSpanSink } = await import('../src/render/build_spans');
    const spans: string[] = [];
    setBuildSpanSink((kind) => spans.push(kind));
    const queue = heldQueue();
    const v = wired(f, queue, []);
    farFrame(f, v);
    // asking for the bake is no build: nothing is recorded until a unit runs
    expect(spans.filter((kind) => kind.startsWith('view:woc-far'))).toEqual([]);
    spans.length = 0;
    const ran = await queue.runAll();
    expect(ran).toEqual([ASSEMBLE, SKIN, FOLD, MOUNT]);
    // one view-lane span per bake unit (the frame it lands in owns its milliseconds),
    // then the body's mount
    expect(spans).toEqual([
      'view:woc-far-bake',
      'view:woc-far-bake',
      'view:woc-far-bake',
      'view:woc-far-mount',
    ]);
    v.dispose();
  });

  it('bakes on the spot for a body with no queue behind it (a direct build)', async () => {
    const f = await wocFarFixture();
    const assembled = vi.spyOn(f.assets, 'assembleModel');
    const gates: Gate[] = [];
    const v = wired(f, undefined, gates);
    assembled.mockClear();
    f.nextFrame();
    v.setFar(true);
    expect(farBakes(assembled)).toBe(1);
    expect(vertices(farMesh(v))).toBe(boxVertices(1));
    expect(gates).toHaveLength(1);
    v.dispose();
  });

  it('bakes on the spot once its gate is taken away, whatever queue it once had', async () => {
    // a body with no gate has no renderer behind it: a queue it met earlier is not its to use
    const f = await wocFarFixture();
    const queue = heldQueue();
    const v = wired(f, queue, []);
    v.setFarBakeGate(null);
    f.nextFrame();
    v.setFar(true);
    expect(queue.units).toHaveLength(0);
    expect(vertices(farMesh(v))).toBe(boxVertices(1));
    // no gate: nothing to wait for, the far mesh stands in at once
    expect(farMesh(v)?.visible).toBe(true);
    expect(rig(v).visible).toBe(false);
    v.dispose();
  });

  it('records ONE span for a bake on the spot: the mount, the bake inside it', async () => {
    // the direct path runs the same steps, and a span per step under the mount's own
    // would count that bake twice in the ledger
    const f = await wocFarFixture();
    const { setBuildSpanSink } = await import('../src/render/build_spans');
    const spans: string[] = [];
    setBuildSpanSink((kind) => spans.push(kind));
    const v = wired(f, undefined, []);
    spans.length = 0;
    f.nextFrame();
    v.setFar(true);
    expect(farMesh(v)).toBeDefined();
    expect(spans.filter((kind) => kind.startsWith('view:woc-far'))).toEqual(['view:woc-far-mount']);
    v.dispose();
  });
});

describe('who asks the queue, and who stops asking', () => {
  it('finds its queue by its gate at the far crossing: a pooled body handed the gate before anybody paired it', async () => {
    // guards: a body the pool handed out before the renderer had paired its gate with
    // its queue met no queue, and baked its far mesh on the spot for the rest of its life
    const f = await wocFarFixture();
    const assembled = vi.spyOn(f.assets, 'assembleModel');
    const queue = heldQueue();
    const gates: Gate[] = [];
    const gate = (target: THREE.Object3D, settle: Gate['settle']): void => {
      gates.push({ target, settle });
    };
    // the pool's take: the gate alone, and nobody has paired this gate with a queue yet
    const pooled = f.body();
    pooled.setFarBakeGate(gate);
    pooled.setWocEquipment({}, false);
    // the renderer then builds a body the usual way: the gate and its queue together
    const fresh = f.body();
    fresh.setFarBakeGate(gate, queue);
    fresh.setWocEquipment({ chest: 'some-chest' }, false);
    assembled.mockClear();
    // the pooled body's far crossing asks the queue: nothing baked in the frame
    farFrame(f, pooled);
    expect(farBakes(assembled)).toBe(0);
    expect(farMesh(pooled)).toBeUndefined();
    expect(queue.labels()).toEqual([ASSEMBLE]);
    expect(await queue.runAll()).toEqual([ASSEMBLE, SKIN, FOLD, MOUNT]);
    expect(vertices(farMesh(pooled))).toBe(boxVertices(1));
    pooled.dispose();
    fresh.dispose();
  });

  it('a parked body stops waiting: its look leaves the line, and nothing mounts on it', async () => {
    // guards: a body streamed out with its look still in line was baked for ahead of the
    // looks visible bodies waited on, and mounted a far mesh nobody could see
    const f = await wocFarFixture();
    const assembled = vi.spyOn(f.assets, 'assembleModel');
    const queue = heldQueue();
    const gates: Gate[] = [];
    const seen = wired(f, queue, gates);
    const gone = wired(f, queue, gates, { chest: 'some-chest' });
    assembled.mockClear();
    farFrame(f, seen);
    farFrame(f, gone);
    // its entity streams out: the pool parks it (pooled_visual_lifecycle.ts store)
    gone.parked();
    expect(await queue.runAll()).toEqual([ASSEMBLE, SKIN, FOLD, MOUNT]);
    expect(farBakes(assembled)).toBe(1);
    expect(farMesh(seen)).toBeDefined();
    expect(farMesh(gone)).toBeUndefined();
    expect(gates).toHaveLength(1);
    // taken again for another entity, it asks like any body
    gone.setFar(false);
    gone.setFarBakeGate((target, settle) => gates.push({ target, settle }), queue);
    farFrame(f, gone);
    expect(await queue.runAll()).toEqual([ASSEMBLE, SKIN, FOLD, MOUNT]);
    expect(vertices(farMesh(gone))).toBe(boxVertices(1) + PART);
    seen.dispose();
    gone.dispose();
  });

  it('mounts nothing over a head re-dress still owed: the body asks again once it is dressed', async () => {
    // guards: a head that changed between two frames re-keys the far look at the next
    // update, and a mount that ran first froze the old head behind a compile gate
    const f = await wocFarFixture();
    const assembled = vi.spyOn(f.assets, 'assembleModel');
    const queue = heldQueue();
    const gates: Gate[] = [];
    const v = wired(f, queue, gates);
    assembled.mockClear();
    farFrame(f, v);
    for (const label of [ASSEMBLE, SKIN, FOLD]) expect(await queue.runNext()).toBe(label);
    // a head reveal lands between two frames (the head dressing's relive)
    (v as unknown as { wocHeadRedress: boolean }).wocHeadRedress = true;
    expect(await queue.runNext()).toBe(MOUNT);
    expect(farMesh(v)).toBeUndefined();
    expect(gates).toHaveLength(0);
    // its next frame re-dresses (the look is the same here) and asks again: the bake is
    // there already, so the ask is a mount
    farFrame(f, v);
    farFrame(f, v);
    expect(await queue.runAll()).toEqual([MOUNT]);
    expect(vertices(farMesh(v))).toBe(boxVertices(1));
    expect(farBakes(assembled)).toBe(1);
    v.dispose();
  });
});

describe('a queue bakes one look at a time', () => {
  it('keeps a second look in line as a record: one unit in the queue, and the first body mounts before the next bake starts', async () => {
    // guards: every look asked for started its own throwaway at once, their units took
    // turns, and a crowd's far meshes all arrived together at the very end
    const f = await wocFarFixture();
    const assembled = vi.spyOn(f.assets, 'assembleModel');
    const queue = heldQueue();
    const bare = wired(f, queue, []);
    const chest = wired(f, queue, [], { chest: 'some-chest' });
    const helm = wired(f, queue, [], { helmet: 'some-helm' });
    assembled.mockClear();
    for (const v of [bare, chest, helm]) farFrame(f, v);
    // three looks asked for in one frame: ONE unit waits, and no throwaway exists yet
    expect(queue.labels()).toEqual([ASSEMBLE]);
    expect(farBakes(assembled)).toBe(0);
    // the third body changes its mind before its turn: it wears the first look now
    helm.setWocEquipment({}, false);
    farFrame(f, helm);
    expect(queue.labels()).toEqual([ASSEMBLE]);
    const order: string[] = [];
    while (queue.units.length > 0) {
      const label = await queue.runNext();
      order.push(`${label} after ${farBakes(assembled)} bakes begun`);
    }
    expect(order).toEqual([
      // the first look, whole, then BOTH bodies that wear it by then...
      `${ASSEMBLE} after 1 bakes begun`,
      `${SKIN} after 1 bakes begun`,
      `${FOLD} after 1 bakes begun`,
      `${MOUNT} after 1 bakes begun`,
      `${MOUNT} after 1 bakes begun`,
      // ...and only then the second look. The helm look nobody wears any more never
      // starts: no unit, no throwaway.
      `${ASSEMBLE} after 2 bakes begun`,
      `${SKIN} after 2 bakes begun`,
      `${FOLD} after 2 bakes begun`,
      `${MOUNT} after 2 bakes begun`,
    ]);
    expect(vertices(farMesh(bare))).toBe(boxVertices(1));
    expect(farMesh(helm)?.geometry).toBe(farMesh(bare)?.geometry);
    expect(vertices(farMesh(chest))).toBe(boxVertices(1) + PART);
    for (const v of [bare, chest, helm]) v.dispose();
  });

  it('moves on to the next look, and keeps the bake, when a throwaway cannot be torn down', async () => {
    // guards: one bake at a time means one bake that never ends its turn stops every far
    // mesh behind it for the session
    const f = await wocFarFixture();
    const queue = heldQueue();
    const first = wired(f, queue, []);
    const second = wired(f, queue, [], { chest: 'some-chest' });
    vi.mocked(console.warn).mockClear();
    farFrame(f, first);
    farFrame(f, second);
    // the first look's throwaway cannot be given back when its bake ends
    vi.spyOn(f.armor, 'releaseWocArmorOf').mockImplementationOnce(() => {
      throw new Error('no release');
    });
    // its bake stands all the same (it was stored before the teardown), and the second
    // look is baked and mounted behind it
    expect(await queue.runAll()).toEqual([
      ASSEMBLE,
      SKIN,
      FOLD,
      MOUNT,
      ASSEMBLE,
      SKIN,
      FOLD,
      MOUNT,
    ]);
    expect(vertices(farMesh(first))).toBe(boxVertices(1));
    expect(vertices(farMesh(second))).toBe(boxVertices(1) + PART);
    // the failed teardown is reported once (dev channel), naming what stopped
    const told = vi
      .mocked(console.warn)
      .mock.calls.filter(([message]) => String(message).includes('[woc-far-bake]'));
    expect(told).toHaveLength(1);
    expect(String(told[0][0])).toContain('(teardown)');
    first.dispose();
    second.dispose();
  });

  it('bakes nothing for a look somebody else baked while it waited in line', async () => {
    const f = await wocFarFixture();
    const assembled = vi.spyOn(f.assets, 'assembleModel');
    const queue = heldQueue();
    const ahead = wired(f, queue, []);
    const waiting = wired(f, queue, [], { chest: 'some-chest' });
    const direct = wired(f, undefined, [], { chest: 'some-chest' });
    assembled.mockClear();
    farFrame(f, ahead);
    farFrame(f, waiting);
    expect(queue.labels()).toEqual([ASSEMBLE]);
    // a body with no queue bakes the waiting look on the spot before its turn comes
    f.nextFrame();
    direct.setFar(true);
    expect(farBakes(assembled)).toBe(1);
    // the look in line has nothing left to bake: its turn is a mount, no throwaway
    expect(await queue.runAll()).toEqual([ASSEMBLE, SKIN, FOLD, MOUNT, MOUNT]);
    expect(farBakes(assembled)).toBe(2);
    expect(farMesh(waiting)?.geometry).toBe(farMesh(direct)?.geometry);
    // ...and it is held for the body that waited, like a bake of its own
    direct.dispose();
    await floodIdleBakes(f, 'baked-elsewhere');
    expect(farMesh(waiting)?.geometry).toBeDefined();
    const files = [{ set: 'fixture', url: f.kitUrl }];
    expect(
      f.farBake.peekWocFarBake(KEY, new Set(['Character_Body', 'Chest']), files),
    ).not.toBeNull();
    ahead.dispose();
    waiting.dispose();
  });

  it('keeps baking for the bodies still waiting when one of them lets go', async () => {
    const f = await wocFarFixture();
    const assembled = vi.spyOn(f.assets, 'assembleModel');
    const queue = heldQueue();
    const first = wired(f, queue, [], { chest: 'some-chest' });
    const second = wired(f, queue, [], { chest: 'some-chest' });
    assembled.mockClear();
    farFrame(f, first);
    farFrame(f, second);
    expect(await queue.runNext()).toBe(ASSEMBLE);
    // one of the two is re-dressed mid-bake, and leaves the far band
    first.setWocEquipment({}, false);
    f.nextFrame(16);
    first.setFar(false);
    // the other still waits: the bake runs on to its end, and it alone mounts
    expect(await queue.runAll()).toEqual([SKIN, FOLD, MOUNT]);
    expect(farBakes(assembled)).toBe(1);
    expect(vertices(farMesh(second))).toBe(boxVertices(1) + PART);
    expect(farMesh(first)).toBeUndefined();
    first.dispose();
    second.dispose();
  });

  it('counts each ask once: letting go twice is letting go once', async () => {
    const f = await wocFarFixture();
    const queue = heldQueue();
    const files = [{ set: 'fixture', url: f.kitUrl }];
    const parts = new Set(['Character_Body']);
    const { queueWocFarBake, peekWocFarBake } = f.farBake;
    const one = queueWocFarBake(KEY, parts, files, null, queue, GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    const two = queueWocFarBake(KEY, parts, files, null, queue, GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    expect(queue.labels()).toEqual([ASSEMBLE]);
    one.release();
    one.release();
    // the second ask still stands: every unit runs
    expect(await queue.runAll()).toEqual([ASSEMBLE, SKIN, FOLD]);
    expect(await two.ready).toBe(true);
    const baked = peekWocFarBake(KEY, parts, files);
    expect(baked).not.toBeNull();
    // ...and it holds the bake until it lets go too
    await floodIdleBakes(f, 'held');
    expect(peekWocFarBake(KEY, parts, files)).toBe(baked);
    two.release();
    two.release();
    await floodIdleBakes(f, 'idle');
    expect(peekWocFarBake(KEY, parts, files)).toBeNull();
    // with nobody left at all, a bake stops at the one unit it had already asked for
    const lone = queueWocFarBake(KEY, parts, files, null, queue, GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    lone.release();
    expect(await queue.runAll()).toEqual([ASSEMBLE]);
    expect(await lone.ready).toBe(false);
    expect(peekWocFarBake(KEY, parts, files)).toBeNull();
  });

  it('lets a body with no queue bake the same look on the spot meanwhile, and keeps one bake of it', async () => {
    const f = await wocFarFixture();
    const queue = heldQueue();
    const queued = wired(f, queue, [], { chest: 'some-chest' });
    const direct = wired(f, undefined, [], { chest: 'some-chest' });
    farFrame(f, queued);
    expect(await queue.runNext()).toBe(ASSEMBLE);
    f.nextFrame();
    direct.setFar(true);
    const standing = farMesh(direct)?.geometry;
    expect(standing).toBeDefined();
    // the queued bake ends second: it gives way, and its body mounts the one in the cache
    expect(await queue.runAll()).toEqual([SKIN, FOLD, MOUNT]);
    expect(farMesh(queued)?.geometry).toBe(standing);
    queued.dispose();
    direct.dispose();
  });

  it('replaces an idle bake whose armor file was freed and fetched again', async () => {
    const f = await wocFarFixture();
    const queue = heldQueue();
    const files = [{ set: 'fixture', url: f.kitUrl }];
    const parts = new Set(['Character_Body', 'Chest']);
    const { retainWocFarBake, peekWocFarBake, queueWocFarBake } = f.farBake;
    const lease = retainWocFarBake(KEY, parts, files);
    if (!lease) throw new Error('no bake');
    const stale = lease.bake.geo;
    const disposed = vi.spyOn(stale, 'dispose');
    lease.release();
    // idle, it pins nothing: the file is freed past its idle window, then fetched again (on
    // a profile that frees an idle set at all: a desktop keeps the tier its crowd draws,
    // woc_armor_core.ts wocArmorIdleEvictMs)
    const gfx = await import('../src/render/gfx');
    const restoreProfile = gfx.gfxInternalsForTest.overrideSettings({ constrainedMemory: true });
    f.armor.setWocArmorClockForTest(() => 1e12);
    f.armor.sweepWocArmorPacks();
    restoreProfile();
    expect(f.armor.wocArmorPackResident(f.kitUrl)).toBe(false);
    f.armor.setWocArmorClockForTest(null);
    f.armor.ensureWocArmorPack(f.kitUrl);
    await vi.waitFor(() => expect(f.armor.wocArmorPackResident(f.kitUrl)).toBe(true));
    // its materials were that parse's: it is no bake any more, and is asked for afresh
    expect(peekWocFarBake(KEY, parts, files)).toBeNull();
    const request = queueWocFarBake(
      KEY,
      parts,
      files,
      null,
      queue,
      GPU_WORK_PRIORITY.VISIBLE_PREWARM,
    );
    expect(await queue.runAll()).toEqual([ASSEMBLE, SKIN, FOLD]);
    expect(await request.ready).toBe(true);
    const fresh = peekWocFarBake(KEY, parts, files);
    expect(fresh).not.toBeNull();
    expect(fresh?.geo).not.toBe(stale);
    expect(disposed).toHaveBeenCalledTimes(1);
    request.release();
  });
});

describe('a re-dress, a new gate and a dispose under a queued bake', () => {
  it('mounts nothing stale: a re-dress before the first unit bakes only the new silhouette', async () => {
    const f = await wocFarFixture();
    const assembled = vi.spyOn(f.assets, 'assembleModel');
    const queue = heldQueue();
    const gates: Gate[] = [];
    const v = wired(f, queue, gates);
    assembled.mockClear();
    farFrame(f, v);
    expect(queue.labels()).toEqual([ASSEMBLE]);
    // the worn set changes while the bake waits for its first unit
    v.setWocEquipment({ helmet: 'some-helm', chest: 'some-chest' }, false);
    // however many frames pass, the new silhouette is asked for ONCE, and waits its turn:
    // a queue bakes one look at a time, and the old look's unit is still in it
    for (let frame = 0; frame < 3; frame++) farFrame(f, v);
    expect(queue.labels()).toEqual([ASSEMBLE]);
    const ran = await queue.runAll();
    // the first ask's unit ran as nothing (nobody waits for it): one bake, one mount
    expect(ran).toEqual([ASSEMBLE, ASSEMBLE, SKIN, FOLD, MOUNT]);
    expect(ran.filter((label) => label === MOUNT)).toHaveLength(1);
    expect(farBakes(assembled)).toBe(1);
    expect(vertices(farMesh(v))).toBe(boxVertices(1) + 2 * PART);
    expect(gates).toHaveLength(1);
    v.dispose();
  });

  it('stops a bake nobody waits for between two units, and never mounts it', async () => {
    const f = await wocFarFixture();
    const assembled = vi.spyOn(f.assets, 'assembleModel');
    const queue = heldQueue();
    const gates: Gate[] = [];
    const v = wired(f, queue, gates);
    assembled.mockClear();
    farFrame(f, v);
    expect(await queue.runNext()).toBe(ASSEMBLE);
    expect(queue.labels()).toEqual([SKIN]);
    // re-dressed with the old silhouette half baked
    v.setWocEquipment({ chest: 'some-chest' }, false);
    farFrame(f, v);
    const ran = await queue.runAll();
    // the old bake's next unit was already asked for: it runs as nothing, and no unit
    // of it follows (no fold, no mount); the new silhouette is baked whole and mounted
    expect(ran).toEqual([SKIN, ASSEMBLE, SKIN, FOLD, MOUNT]);
    expect(farBakes(assembled)).toBe(2);
    expect(vertices(farMesh(v))).toBe(boxVertices(1) + PART);
    expect(gates).toHaveLength(1);
    // the abandoned silhouette never reached the cache (the finished one did)
    const files = [{ set: 'fixture', url: f.kitUrl }];
    const { peekWocFarBake } = f.farBake;
    expect(peekWocFarBake(KEY, new Set(['Character_Body', 'Chest']), files)).not.toBeNull();
    expect(peekWocFarBake(KEY, new Set(['Character_Body']), files)).toBeNull();
    v.dispose();
  });

  it('picks a bake up where it was when the body goes back to the look it left', async () => {
    const f = await wocFarFixture();
    const assembled = vi.spyOn(f.assets, 'assembleModel');
    const queue = heldQueue();
    const v = wired(f, queue, []);
    assembled.mockClear();
    farFrame(f, v);
    expect(await queue.runNext()).toBe(ASSEMBLE);
    // away and back before the queue gets to anything else
    v.setWocEquipment({ chest: 'some-chest' }, false);
    v.setWocEquipment({}, false);
    farFrame(f, v);
    const ran = await queue.runAll();
    // the bare bake was never started twice: its own next unit carried on, and the one
    // ask still standing mounts it
    expect(ran).toEqual([SKIN, FOLD, MOUNT]);
    expect(farBakes(assembled)).toBe(1);
    expect(vertices(farMesh(v))).toBe(boxVertices(1));
    v.dispose();
  });

  it('a crowd in one look shares one bake and mounts a body per unit; a look already baked only mounts', async () => {
    const f = await wocFarFixture();
    const assembled = vi.spyOn(f.assets, 'assembleModel');
    const queue = heldQueue();
    const gates: Gate[] = [];
    const crowd = [0, 1, 2].map(() => wired(f, queue, gates, { chest: 'some-chest' }));
    assembled.mockClear();
    for (const v of crowd) farFrame(f, v);
    expect(queue.labels()).toEqual([ASSEMBLE]);
    expect(await queue.runAll()).toEqual([ASSEMBLE, SKIN, FOLD, MOUNT, MOUNT, MOUNT]);
    expect(farBakes(assembled)).toBe(1);
    const geometry = farMesh(crowd[0])?.geometry;
    for (const v of crowd) expect(farMesh(v)?.geometry).toBe(geometry);
    // a fourth body in that look, later: no bake unit at all, its mount alone
    const late = wired(f, queue, gates, { chest: 'another-chest' });
    farFrame(f, late);
    expect(await queue.runAll()).toEqual([MOUNT]);
    expect(farMesh(late)?.geometry).toBe(geometry);
    expect(farBakes(assembled)).toBe(1);
    for (const v of [...crowd, late]) v.dispose();
  });

  it('gives everything back when a body is disposed under its queued bake', async () => {
    const f = await wocFarFixture();
    const queue = heldQueue();
    const gates: Gate[] = [];
    expect(f.armor.wocArmorPackRefs(f.kitUrl)).toBe(0);
    const v = wired(f, queue, gates, { chest: 'some-chest' });
    const held = f.armor.wocArmorPackRefs(f.kitUrl);
    expect(held).toBeGreaterThan(0);
    farFrame(f, v);
    expect(await queue.runNext()).toBe(ASSEMBLE);
    // the throwaway holds the body's armor file while its bake is in flight
    expect(f.armor.wocArmorPackRefs(f.kitUrl)).toBeGreaterThan(held);
    v.dispose();
    const ran = await queue.runAll();
    expect(ran).toEqual([SKIN]);
    expect(farMesh(v)).toBeUndefined();
    expect(gates).toHaveLength(0);
    expect(f.armor.wocArmorPackRefs(f.kitUrl)).toBe(0);
  });

  it('asks the new queue again when the gate is replaced under a queued bake (a pooled body)', async () => {
    const f = await wocFarFixture();
    const old = heldQueue();
    const next = heldQueue();
    const gates: Gate[] = [];
    const v = wired(f, old, gates);
    farFrame(f, v);
    expect(old.labels()).toEqual([ASSEMBLE]);
    v.setFarBakeGate((target, settle) => gates.push({ target, settle }), next);
    farFrame(f, v);
    expect(next.labels()).toEqual([ASSEMBLE]);
    // what the old queue still holds mounts nothing, whenever it runs
    await old.runAll();
    expect(farMesh(v)).toBeUndefined();
    expect(await next.runAll()).toEqual([ASSEMBLE, SKIN, FOLD, MOUNT]);
    expect(vertices(farMesh(v))).toBe(boxVertices(1));
    expect(gates).toHaveLength(1);
    v.dispose();
  });

  it('finishes a bake a body asked for and then walked back from: the next crossing is free', async () => {
    const f = await wocFarFixture();
    const queue = heldQueue();
    const gates: Gate[] = [];
    const v = wired(f, queue, gates);
    farFrame(f, v);
    // near again before the queue ran anything
    f.nextFrame(16);
    v.setFar(false);
    v.update(0.016, IDLE, true);
    expect(await queue.runAll()).toEqual([ASSEMBLE, SKIN, FOLD, MOUNT]);
    // mounted hidden: the rig draws, the far mesh waits for a far frame
    expect(farMesh(v)?.visible).toBe(false);
    expect(rig(v).visible).toBe(true);
    gates[0].settle();
    v.setFar(false);
    expect(rig(v).visible).toBe(true);
    v.setFar(true);
    expect(farMesh(v)?.visible).toBe(true);
    expect(queue.units).toHaveLength(0);
    v.dispose();
  });
});

describe('a queued bake that leaves nothing to mount', () => {
  const reports = (): unknown[][] =>
    vi
      .mocked(console.warn)
      .mock.calls.filter(([message]) => String(message).includes('[woc-far-bake]'));

  it('a unit that throws is reported once and leaves the rig: no mount, no bake on the spot, no ask a frame', async () => {
    const f = await wocFarFixture();
    const assembled = vi.spyOn(f.assets, 'assembleModel');
    const queue = heldQueue();
    const gates: Gate[] = [];
    const v = wired(f, queue, gates);
    assembled.mockClear();
    vi.mocked(console.warn).mockClear();
    farFrame(f, v);
    // its far mesh is on its way: the rig is a stopgap, no stand-in is built for it
    expect(rigToStay(v)).toBe(false);
    // the throwaway cannot be assembled
    assembled.mockImplementationOnce(() => {
      throw new Error('no throwaway');
    });
    // the bake ends at the unit that threw, and NO mount unit follows it: a mount would
    // find no bake in the cache and bake one on the spot, inside its frame
    expect(await queue.runAll()).toEqual([ASSEMBLE]);
    expect(reports()).toHaveLength(1);
    expect(assembled).toHaveBeenCalledTimes(1);
    // frames pass in the far band: the body keeps its rig and asks for nothing more
    for (let frame = 0; frame < 4; frame++) farFrame(f, v);
    expect(queue.units).toHaveLength(0);
    // no far mesh is coming any more: its rig is here to stay, and may be merged like any
    expect(rigToStay(v)).toBe(true);
    expect(assembled).toHaveBeenCalledTimes(1);
    expect(farMesh(v)).toBeUndefined();
    expect(rig(v).visible).toBe(true);
    expect(gates).toHaveLength(0);
    expect(reports()).toHaveLength(1);
    // a second body in that look fails the same way: the look was reported already
    const peer = wired(f, queue, gates);
    assembled.mockImplementationOnce(() => {
      throw new Error('no throwaway');
    });
    farFrame(f, peer);
    expect(await queue.runAll()).toEqual([ASSEMBLE]);
    expect(farBakes(assembled)).toBe(2);
    expect(reports()).toHaveLength(1);
    // its next dressing asks again, and that bake is whole
    v.setWocEquipment({ chest: 'some-chest' }, false);
    farFrame(f, v);
    expect(await queue.runAll()).toEqual([ASSEMBLE, SKIN, FOLD, MOUNT]);
    expect(vertices(farMesh(v))).toBe(boxVertices(1) + PART);
    v.dispose();
    peer.dispose();
  });

  it('leaves no wait behind when the ask ends in nothing: the rig is here to stay, whatever held the ask up meanwhile', async () => {
    // guards: a head reveal between two frames puts the far ask back on hold; the ask
    // then ended in nothing, the hold was never lifted, and the body counted as "its far
    // mesh is coming" for good: no far mesh, and no merged stand-in either
    const f = await wocFarFixture();
    const assembled = vi.spyOn(f.assets, 'assembleModel');
    const queue = heldQueue();
    const v = wired(f, queue, []);
    assembled.mockClear();
    farFrame(f, v);
    expect(queue.labels()).toEqual([ASSEMBLE]);
    // the reveal lands, and the LOD pass runs before the frame's update (the hold)
    (v as unknown as { wocHeadRedress: boolean }).wocHeadRedress = true;
    f.nextFrame(16);
    v.setFar(true);
    expect(rigToStay(v)).toBe(false);
    assembled.mockImplementationOnce(() => {
      throw new Error('no throwaway');
    });
    expect(await queue.runAll()).toEqual([ASSEMBLE]);
    expect(farMesh(v)).toBeUndefined();
    expect(rigToStay(v)).toBe(true);
    v.dispose();
  });

  it('gives the throwaway and its armor file back when a later unit throws', async () => {
    const f = await wocFarFixture();
    const queue = heldQueue();
    const v = wired(f, queue, [], { chest: 'some-chest' });
    const held = f.armor.wocArmorPackRefs(f.kitUrl);
    vi.mocked(console.warn).mockClear();
    farFrame(f, v);
    expect(await queue.runNext()).toBe(ASSEMBLE);
    // the throwaway exists now, and holds the body's armor file
    expect(f.armor.wocArmorPackRefs(f.kitUrl)).toBeGreaterThan(held);
    vi.spyOn(f.assets, 'composedFarMeshes').mockImplementationOnce(() => {
      throw new Error('no walk');
    });
    expect(await queue.runAll()).toEqual([SKIN]);
    expect(f.armor.wocArmorPackRefs(f.kitUrl)).toBe(held);
    expect(reports()).toHaveLength(1);
    expect(farMesh(v)).toBeUndefined();
    expect(rig(v).visible).toBe(true);
    v.dispose();
    expect(f.armor.wocArmorPackRefs(f.kitUrl)).toBe(0);
  });

  it('a queue shut down with its renderer is no failure: nothing reported, nothing baked, nothing asked again', async () => {
    const f = await wocFarFixture();
    const assembled = vi.spyOn(f.assets, 'assembleModel');
    let asked = 0;
    const dead = {
      run<T>(): Promise<T> {
        asked++;
        return Promise.reject(shutdownError());
      },
    };
    const gates: Gate[] = [];
    const v = f.body();
    v.setFarBakeGate((target, settle) => gates.push({ target, settle }), dead);
    v.setWocEquipment({}, false);
    assembled.mockClear();
    vi.mocked(console.warn).mockClear();
    farFrame(f, v);
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let frame = 0; frame < 4; frame++) farFrame(f, v);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(asked).toBe(1);
    expect(reports()).toHaveLength(0);
    expect(assembled).not.toHaveBeenCalled();
    expect(farMesh(v)).toBeUndefined();
    expect(rig(v).visible).toBe(true);
    // handed a live renderer's gate and queue afterwards, it asks again: the answer of a
    // queue that died is not a verdict on the look
    const live = heldQueue();
    v.setFarBakeGate((target, settle) => gates.push({ target, settle }), live);
    farFrame(f, v);
    expect(await live.runAll()).toEqual([ASSEMBLE, SKIN, FOLD, MOUNT]);
    expect(vertices(farMesh(v))).toBe(boxVertices(1));
    v.dispose();
  });

  it('a mount unit the queue refuses lets go of the bake it was held for', async () => {
    const f = await wocFarFixture();
    const queue = heldQueue();
    // the renderer shuts down between the bake's last unit and the body's mount
    const refusing = {
      run<T>(work: () => T | Promise<T>, priority?: number, label?: string): Promise<T> {
        if (label?.startsWith('woc-far-mount')) return Promise.reject(shutdownError());
        return queue.run(work, priority, label);
      },
    };
    const v = f.body();
    v.setFarBakeGate(() => undefined, refusing);
    v.setWocEquipment({}, false);
    vi.mocked(console.warn).mockClear();
    farFrame(f, v);
    expect(await queue.runAll()).toEqual([ASSEMBLE, SKIN, FOLD]);
    const files = [{ set: 'fixture', url: f.kitUrl }];
    const parts = new Set(['Character_Body']);
    expect(f.farBake.peekWocFarBake(KEY, parts, files)).not.toBeNull();
    expect(farMesh(v)).toBeUndefined();
    expect(reports()).toHaveLength(0);
    // the body is still alive, and holds nothing: the bake is idle, and goes with the rest
    await floodIdleBakes(f, 'refused');
    expect(f.farBake.peekWocFarBake(KEY, parts, files)).toBeNull();
    for (let frame = 0; frame < 3; frame++) farFrame(f, v);
    expect(queue.units).toHaveLength(0);
    v.dispose();
  });

  it('a mount that throws is reported, keeps the rig, and its half-taken lease goes at the next dressing', async () => {
    const f = await wocFarFixture();
    const queue = heldQueue();
    const gates: Gate[] = [];
    const v = wired(f, queue, gates);
    vi.mocked(console.warn).mockClear();
    farFrame(f, v);
    // the far materials cannot be derived: the mount throws after it took its lease
    const tinted = vi.spyOn(f.assets, 'tintedFarMaterials').mockImplementationOnce(() => {
      throw new Error('no far materials');
    });
    expect(await queue.runAll()).toEqual([ASSEMBLE, SKIN, FOLD, MOUNT]);
    expect(tinted).toHaveBeenCalledTimes(1);
    expect(reports()).toHaveLength(1);
    expect(farMesh(v)).toBeUndefined();
    expect(rig(v).visible).toBe(true);
    expect(gates).toHaveLength(0);
    for (let frame = 0; frame < 3; frame++) farFrame(f, v);
    expect(queue.units).toHaveLength(0);
    // the lease it took is still the body's (the bake is held)...
    const files = [{ set: 'fixture', url: f.kitUrl }];
    const parts = new Set(['Character_Body']);
    await floodIdleBakes(f, 'thrown');
    expect(f.farBake.peekWocFarBake(KEY, parts, files)).not.toBeNull();
    // ...until its next dressing takes the far LOD down, mesh or no mesh
    v.setWocEquipment({ chest: 'some-chest' }, false);
    await floodIdleBakes(f, 'redressed');
    expect(f.farBake.peekWocFarBake(KEY, parts, files)).toBeNull();
    v.dispose();
  });

  it('a look that bakes to nothing mounts nothing and is not asked for again', async () => {
    const f = await wocFarFixture();
    const assembled = vi.spyOn(f.assets, 'assembleModel');
    // nothing of this body is far geometry (every piece opted out)
    const walked = vi.spyOn(f.assets, 'composedFarMeshes').mockReturnValue([]);
    const queue = heldQueue();
    const gates: Gate[] = [];
    const v = wired(f, queue, gates);
    assembled.mockClear();
    farFrame(f, v);
    // every unit of the bake runs, and no mount: there is nothing to mount
    expect(await queue.runAll()).toEqual([ASSEMBLE, SKIN, FOLD]);
    expect(walked).toHaveBeenCalled();
    for (let frame = 0; frame < 4; frame++) farFrame(f, v);
    expect(queue.units).toHaveLength(0);
    expect(farBakes(assembled)).toBe(1);
    expect(farMesh(v)).toBeUndefined();
    expect(rig(v).visible).toBe(true);
    expect(gates).toHaveLength(0);
    // an empty look is no failure: nothing is reported
    expect(reports()).toHaveLength(0);
    v.dispose();
  });

  it('holds a finished bake for the bodies that asked until each has mounted it: other looks cannot push it out', async () => {
    // guards: a finished bake entered the cache idle, the idle cache is bounded, and a
    // crowd's bakes end close together: the next few trimmed it before its own body's
    // mount unit ran, and that body baked its look a second time
    const f = await wocFarFixture();
    const assembled = vi.spyOn(f.assets, 'assembleModel');
    const queue = heldQueue();
    const gates: Gate[] = [];
    const v = wired(f, queue, gates);
    assembled.mockClear();
    farFrame(f, v);
    for (const label of [ASSEMBLE, SKIN, FOLD]) expect(await queue.runNext()).toBe(label);
    expect(queue.labels()).toEqual([MOUNT]);
    const files = [{ set: 'fixture', url: f.kitUrl }];
    const parts = new Set(['Character_Body']);
    const baked = f.farBake.peekWocFarBake(KEY, parts, files);
    expect(baked).not.toBeNull();
    // more idle bakes than the cache keeps, every one of them newer than this one
    await floodIdleBakes(f, 'before-mount');
    expect(f.farBake.peekWocFarBake(KEY, parts, files)).toBe(baked);
    // the mount unit retains that very bake: no bake inside it
    const before = farBakes(assembled);
    expect(await queue.runNext()).toBe(MOUNT);
    expect(farBakes(assembled)).toBe(before);
    expect(farMesh(v)?.geometry).toBe(baked?.geo);
    // a second body asks for the look while it is baked already: its ask holds the bake
    // too, through the first body leaving and another flood, until its own mount
    const late = wired(f, queue, gates);
    farFrame(f, late);
    await queue.settle();
    expect(queue.labels()).toEqual([MOUNT]);
    v.dispose();
    await floodIdleBakes(f, 'between');
    expect(f.farBake.peekWocFarBake(KEY, parts, files)).toBe(baked);
    expect(await queue.runNext()).toBe(MOUNT);
    expect(farMesh(late)?.geometry).toBe(baked?.geo);
    // (the flood's own forty bakes, and not one more of this look)
    expect(farBakes(assembled)).toBe(before + 40);
    // nobody holds it past its bodies: once the last one goes it is idle like any other
    late.dispose();
    await floodIdleBakes(f, 'after');
    expect(f.farBake.peekWocFarBake(KEY, parts, files)).toBeNull();
  });

  it('lets a finished bake go idle when the body that asked is re-dressed before it mounts', async () => {
    const f = await wocFarFixture();
    const queue = heldQueue();
    const gates: Gate[] = [];
    const v = wired(f, queue, gates);
    farFrame(f, v);
    for (const label of [ASSEMBLE, SKIN, FOLD]) expect(await queue.runNext()).toBe(label);
    const files = [{ set: 'fixture', url: f.kitUrl }];
    const parts = new Set(['Character_Body']);
    expect(f.farBake.peekWocFarBake(KEY, parts, files)).not.toBeNull();
    // re-dressed with its mount still queued: that mount builds nothing, and holds nothing
    v.setWocEquipment({ chest: 'some-chest' }, false);
    await floodIdleBakes(f, 'dropped');
    expect(f.farBake.peekWocFarBake(KEY, parts, files)).toBeNull();
    expect(await queue.runNext()).toBe(MOUNT);
    expect(farMesh(v)).toBeUndefined();
    expect(gates).toHaveLength(0);
    v.dispose();
  });
});

describe('the far key is built once per dressing', () => {
  /** The far keys built so far: every stringify of a [parts, files, face] triple. */
  function keysBuilt(stringify: { mock: { calls: unknown[][] } }): number {
    return stringify.mock.calls.filter(
      ([value]) =>
        Array.isArray(value) &&
        value.length === 3 &&
        Array.isArray(value[0]) &&
        Array.isArray(value[1]) &&
        typeof value[2] === 'string',
    ).length;
  }

  it('never per ask: a pending bake costs no key, queued or waiting on the bake budget', async () => {
    const f = await wocFarFixture();
    const stringify = vi.spyOn(JSON, 'stringify');
    const queue = heldQueue();
    // one body behind a queue, one with none (it waits on the bake budget instead)
    const queued = wired(f, queue, []);
    const direct = wired(f, undefined, []);
    const budget = vi.spyOn(f.assets, 'takeFarBakeBudget').mockReturnValue(false);
    // dressed: one key each
    expect(keysBuilt(stringify)).toBe(2);
    for (let frame = 0; frame < 5; frame++) {
      farFrame(f, queued);
      farFrame(f, direct);
    }
    // both asked every frame (a unit waits, the budget was consulted), and neither built a key
    expect(queue.labels()).toEqual([ASSEMBLE]);
    expect(budget.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(farMesh(direct)).toBeUndefined();
    expect(keysBuilt(stringify)).toBe(2);
    // the bake itself reuses it too: units, mount and the direct body's bake build none
    budget.mockReturnValue(true);
    await queue.runAll();
    farFrame(f, direct);
    expect(farMesh(queued)).toBeDefined();
    expect(farMesh(direct)).toBeDefined();
    expect(keysBuilt(stringify)).toBe(2);
    // an input changes: exactly one key, for the dressing that changed it
    queued.setWocEquipment({ chest: 'some-chest' }, false);
    expect(keysBuilt(stringify)).toBe(3);
    expect(farMesh(queued)).toBeUndefined();
    for (let frame = 0; frame < 3; frame++) farFrame(f, queued);
    await queue.runAll();
    const rebaked = farMesh(queued);
    expect(rebaked).toBeDefined();
    expect(keysBuilt(stringify)).toBe(3);
    // a dressing that changes nothing drawn builds one more and compares it: the same
    // key, so the far mesh it had is kept
    queued.setWocEquipment({ chest: 'another-chest' }, false);
    expect(keysBuilt(stringify)).toBe(4);
    expect(farMesh(queued)).toBe(rebaked);
    queued.dispose();
    direct.dispose();
  });
});

describe('a WOC body is born with no far mesh', () => {
  it('builds none at construction, claims no far material, and its first dressing sweeps nothing', async () => {
    const f = await wocFarFixture();
    const tinted = vi.spyOn(f.assets, 'tintedFarMaterials');
    // biome-ignore lint/suspicious/noExplicitAny: a private method of the class under test
    const sweeps = vi.spyOn(f.CharacterVisual.prototype as any, 'applyVisualMaterials');
    const v = f.body();
    expect(farMesh(v)).toBeUndefined();
    expect(v.root.getObjectByName('character_far_wrap')).toBeUndefined();
    expect(v.root.getObjectByName('character_shadow_proxy')).toBeUndefined();
    expect(tinted).not.toHaveBeenCalled();
    // the key bakes no far geometry for a WOC body at all
    expect(f.assets.prepareVisual(KEY).idleGeo).toBeNull();
    expect(f.assets.prepareVisual(KEY).idleSrcMats).toEqual([]);
    // dressed for the first time (the world's first worn-set diff), then re-dressed near:
    // no far mesh was mounted, so there is nothing to take down and nothing is swept
    v.setWocEquipment({}, false);
    v.setWocEquipment({ chest: 'some-chest' }, false);
    v.update(0.016, IDLE, true);
    expect(sweeps).not.toHaveBeenCalled();
    expect(tinted).not.toHaveBeenCalled();
    // (the sweep is still what takes a MOUNTED far mesh down: an effect staged over it
    // has to be planned again)
    f.nextFrame();
    v.setFar(true);
    expect(farMesh(v)).toBeDefined();
    // (both spies do see their call: the far crossing derives its materials and sweeps)
    expect(tinted).toHaveBeenCalledTimes(1);
    expect(sweeps).toHaveBeenCalled();
    sweeps.mockClear();
    v.setWocEquipment({}, false);
    expect(farMesh(v)).toBeUndefined();
    expect(sweeps).toHaveBeenCalledTimes(1);
    v.dispose();
  });
});

describe('a body still waiting for its head bakes nothing', () => {
  const QUIFF = 'models/chars/players/woc/head_type_a_hair_quiff.glb';

  it('asks the queue for no far bake until its head is live, then for one, with its head', async () => {
    const h = await wocVisualHarness({ held: [QUIFF] });
    const assets = await import('../src/render/characters/assets');
    const assembled = vi.spyOn(assets, 'assembleModel');
    const queue = heldQueue();
    const v = new h.CharacterVisual(KEY, 0xffffff, 0);
    v.setFarBakeGate((target, settle) => h.gates.push({ target, settle }), queue);
    v.setWocEquipment({}, false);
    // the hairstyle is still on the wire: the body draws nothing, far or near
    v.setWocHeadLook({ ...h.DEFAULT_APPEARANCE, headHair: 'quiff' });
    const frame = (): void => {
      h.nextFrame(16);
      v.setFar(true);
      v.setProxyShadow(true);
      v.update(0.016, HEAD_IDLE, true);
    };
    for (let i = 0; i < 4; i++) frame();
    expect(v.root.getObjectByName('character_model_wrap')?.visible).toBe(false);
    expect(queue.units).toHaveLength(0);
    expect(farBakes(assembled)).toBe(0);
    // the file lands and is hung behind the gate, as a unit of the work queue (never inside
    // a frame, woc_head_dressing.ts): still nothing to bake
    h.releases.get(QUIFF)?.();
    await vi.waitFor(() => expect(h.heads.wocHeadFileResident(QUIFF)).toBe(true));
    frame();
    expect(queue.labels()).toEqual(['woc-head-hang:a']);
    await queue.runAll();
    expect(h.gates).toHaveLength(1);
    frame();
    expect(queue.units).toHaveLength(0);
    // revealed between two frames: the head is live, but the dressing that puts it into
    // the far key is update()'s, and the LOD pass runs first (twice here: the first one
    // ends the body's wait, so the second meets a drawn body whose key is still stale).
    // No bake of the stale key.
    for (const gate of h.gates.splice(0)) gate.settle();
    h.nextFrame(16);
    v.setFar(true);
    v.setFar(true);
    expect(queue.units).toHaveLength(0);
    v.update(0.016, HEAD_IDLE, true);
    // re-dressed with its head: ONE bake is asked for, and it carries the head
    expect(queue.labels()).toEqual([ASSEMBLE]);
    for (let i = 0; i < 3; i++) frame();
    expect(queue.labels()).toEqual([ASSEMBLE]);
    await queue.runAll();
    expect(farBakes(assembled)).toBe(1);
    const lease = (v as unknown as { wocFarLease: { bake: { tints: unknown[] } } | null })
      .wocFarLease;
    expect(lease?.bake.tints.some((t) => t !== null && 'slots' in (t as object))).toBe(true);
    v.dispose();
  });
});

describe("the head's pose rides the bands too", () => {
  it('poses a head larger than a band across several skin units, and bakes the mesh a single pass bakes', async () => {
    // guards: the head's morphs were posed whole inside one unit, whatever the band
    type Harness = Awaited<ReturnType<typeof wocVisualHarness>>;
    const face = (h: Harness, chinWidth: number) => ({
      ...h.DEFAULT_APPEARANCE,
      headHair: 'topknot',
      headShape: { ...h.DEFAULT_APPEARANCE.headShape, chinWidth },
    });
    /** A queued full-kit body with that chin, far, its head live: the unit labels its far
     *  LOD ran as (a frame between every two), and the body. */
    async function queuedBake(h: Harness, queue: ReturnType<typeof heldQueue>, chinWidth: number) {
      const v = new h.CharacterVisual(KEY, 0xffffff, 0);
      v.setFarBakeGate((target, settle) => h.gates.push({ target, settle }), queue);
      v.setWocEquipment({ ...FULL_KIT_EQUIPPED }, false);
      v.setWocHeadLook(face(h, chinWidth));
      const ran: string[] = [];
      for (let i = 0; i < 400 && !v.root.getObjectByName('character_far_mesh'); i++) {
        h.nextFrame(16);
        v.setFar(true);
        v.update(0.016, HEAD_IDLE, true);
        for (const gate of h.gates.splice(0)) gate.settle();
        const label = await queue.runNext();
        if (label) ran.push(label);
      }
      return { v, ran };
    }
    const everything = (geometry: THREE.BufferGeometry | undefined) => ({
      ...drawn(geometry),
      slot: [...(geometry?.getAttribute('aWocHmSlot').array ?? [])],
    });
    const skins = (ran: string[]): number => ran.filter((label) => label === SKIN).length;

    // a world whose band is a handful of vertices: the fixture head spans it many times
    const h = await wocVisualHarness({ kit: 'full' });
    const farBake = await import('../src/render/characters/woc_far_bake');
    const BAND = 16;
    farBake.setWocFarBakeBandForTest(BAND);
    const queue = heldQueue();
    const still = await queuedBake(h, queue, 0);
    const posed = await queuedBake(h, queue, 1);
    const stillFar = still.v.root.getObjectByName('character_far_mesh') as THREE.Mesh;
    const posedFar = posed.v.root.getObjectByName('character_far_mesh') as THREE.Mesh;
    // the same body twice: the same far mesh but for the face
    const total = vertices(stillFar);
    expect(vertices(posedFar)).toBe(total);
    const banded = everything(posedFar.geometry);
    const rest = everything(stillFar.geometry);
    let moved = 0;
    for (let i = 0; i < total; i++) {
      if ([0, 1, 2].some((c) => banded.position[i * 3 + c] !== rest.position[i * 3 + c])) moved++;
    }
    // the chin moves whole pieces of the head: far more vertices than a band holds
    expect(moved).toBeGreaterThan(2 * BAND);
    // The bake alone is its vertices over the band. Even the still face poses a piece (the
    // topknot's bald crown), and a pose done whole inside one unit would cost exactly one
    // unit more than the bake, however many vertices it moved: posed a band at a time, it
    // costs its own vertices over the band, and the chin's pieces cost theirs on top.
    const bakeAlone = Math.ceil(total / BAND);
    expect(skins(still.ran)).toBeGreaterThan(bakeAlone + 1);
    expect(skins(posed.ran)).toBeGreaterThanOrEqual(skins(still.ran) + 2);
    // every unit is one band at most: none of them hid a whole pose or a whole bake
    expect(skins(posed.ran)).toBeGreaterThanOrEqual(Math.ceil((moved + total) / BAND));
    still.v.dispose();
    posed.v.dispose();
    releaseWocVisualHarness();

    // a single pass, in a world of its own: the shipped band, no queue
    const g = await wocVisualHarness({ kit: 'full' });
    const direct = g.farVisual(face(g, 1), FULL_KIT_EQUIPPED);
    const whole = everything(
      (direct.root.getObjectByName('character_far_mesh') as THREE.Mesh).geometry,
    );
    expect(banded).toEqual(whole);
    direct.dispose();
  }, 60_000);
});

describe('a far bake transforms only what its far level draws', () => {
  /** A full-kit body's far mesh, with or without coarser levels on every fixture geometry:
   *  its vertices, and each triangle as its three corners (position, uv, head slot). */
  async function farBakeOf(lods: boolean) {
    const h = await wocVisualHarness({ kit: 'full', lods });
    // a face off its default (a chin morph on the base, the swept hair's tuck): the head's
    // pose reads its morph targets off the geometry the bake was cut down to
    const v = h.farVisual(
      {
        ...h.DEFAULT_APPEARANCE,
        headHair: 'swept',
        headShape: { ...h.DEFAULT_APPEARANCE.headShape, chinWidth: 1 },
      },
      FULL_KIT_EQUIPPED,
    );
    expect(
      (v as unknown as { wocFarHead: { morphs: Record<string, number> } | null }).wocFarHead?.morphs
        .FS_Chin_Softness,
    ).toBeGreaterThan(0);
    const geometry = (v.root.getObjectByName('character_far_mesh') as THREE.Mesh).geometry;
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    const slot = geometry.getAttribute('aWocHmSlot');
    const index = [...(geometry.index?.array ?? [])];
    const corner = (i: number): string =>
      [position.getX(i), position.getY(i), position.getZ(i), uv.getX(i), uv.getY(i), slot.getX(i)]
        .map((n) => n.toFixed(5))
        .join(',');
    const triangles: string[] = [];
    for (let k = 0; k < index.length; k += 3) {
      triangles.push([corner(index[k]), corner(index[k + 1]), corner(index[k + 2])].join(' | '));
    }
    v.dispose();
    releaseWocVisualHarness();
    return { vertices: position.count, drawn: new Set(index).size, triangles };
  }

  it("bakes no vertex the far mesh never draws, and every triangle it draws is the whole bake's own", async () => {
    const whole = await farBakeOf(false);
    const far = await farBakeOf(true);
    // level 0 draws every vertex of a fixture box: nothing to drop, nothing dropped
    expect(whole.drawn).toBe(whole.vertices);
    // the far level draws a quarter of the triangles (tests/woc_lod_visual.test.ts) over
    // a fraction of the vertices: the bake holds exactly those, not one more
    expect(far.triangles.length * 4).toBe(whole.triangles.length);
    expect(far.vertices).toBe(far.drawn);
    expect(far.vertices).toBeLessThan(whole.vertices);
    // ...and it is the same mesh where it is drawn: each far triangle is a triangle of
    // the whole bake, corner for corner (where it stands, its uv, its head slot)
    const all = new Set(whole.triangles);
    const strangers = far.triangles.filter((t) => !all.has(t));
    expect(strangers).toEqual([]);
  }, 60_000);
});
