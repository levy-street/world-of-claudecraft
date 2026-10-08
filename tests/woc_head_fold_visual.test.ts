// @vitest-environment happy-dom
// The merged head's fold as a CHAIN of queue units, on a REAL CharacterVisual with only
// asset IO stubbed (tests/helpers/woc_visual_harness.ts, its base head big enough to be
// several bands of the fold: woc_head_merge_core.ts). The fold itself and the rig that
// drives it are pinned on fixtures elsewhere (tests/woc_head_merge.test.ts); this suite
// pins the wiring nothing else would notice going missing, the way the world view wires
// it (index.ts createCharacterVisual, then renderer.ts createCharacterVisualWithRetry):
// a head nobody built is folded ONE band a unit of the renderer's work queue, each unit
// asking for the next, and mounted by a unit of its own kind once it is whole; every body
// in one face drives the one fold, and a crowd of new faces is folded one head after
// another; a head that changes, goes far, loses its gate, is switched off or disposed
// mid-chain lets the fold go where it stands (nothing half built is ever mounted, cached
// or left behind); a body with no queue behind it mounts whole on the spot; the chain
// runs on the renderer's real queue; and a seeded run of the whole lifecycle never shows
// a stand-in that is not the head its pieces draw.
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { createBackgroundGpuQueue, GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import {
  WOC_HEAD_MERGE_BAND_INDICES,
  WOC_HEAD_MERGE_BAND_VERTICES,
  wocHeadMergeFoldUnits,
} from '../src/render/characters/woc_head_merge_core';
import { Rng } from '../src/sim/rng';
import {
  BASE,
  BIG_BASE_SEGMENTS,
  IDLE,
  player,
  releaseWocVisualHarness,
  type WocHarnessVisual,
  type WocVisualHarness,
  wocVisualHarness,
} from './helpers/woc_visual_harness';

type Visual = WocHarnessVisual;
type Appearance = Record<string, unknown>;
type Gate = (target: THREE.Object3D, settle: (ready?: () => boolean) => void) => void;

/** The work-queue labels of a head's units (`kind:instance`): a band of a fold, and the
 *  mount of a head that is whole. */
const HEAD_MERGE_UNIT = 'woc-head-merge:a';
const HEAD_MOUNT_UNIT = 'woc-head-mount:a';
/** The compile-gate target of a merged head (its wrapper). */
const HEAD_GATE = 'woc_head_merged';
const PROVEN = (): boolean => true;

/** The big base head: its vertices and index entries (a box of BIG_BASE_SEGMENTS a side). */
const BASE_VERTICES = 6 * (BIG_BASE_SEGMENTS + 1) ** 2;
const BASE_INDICES = 6 * BIG_BASE_SEGMENTS ** 2 * 6;

interface Unit {
  readonly run: () => void;
  readonly priority: number | undefined;
  readonly label: string | undefined;
}

/** The renderer's background work queue as a body sees it, holding every unit until the
 *  case runs it: what the real one's frame budget does to a crowd arriving at once. */
function heldQueue() {
  const units: Unit[] = [];
  return {
    units,
    run<T>(work: () => T | Promise<T>, priority?: number, label?: string): Promise<T> {
      return new Promise<T>((resolve) => {
        units.push({ run: () => resolve(work() as T), priority, label });
      });
    },
  };
}
type Queue = ReturnType<typeof heldQueue>;
/** What a body asks of the queue the renderer hands it (visual.ts CharacterWorkQueue). */
interface WorkQueue {
  run<T>(work: () => T | Promise<T>, priority?: number, label?: string): Promise<T>;
}

/** A harness whose bodies are built the way the world view builds them, bare (the armor
 *  has its own chain of nothing: only the head is under test). */
async function world() {
  const h = await wocVisualHarness({ bigHead: true });
  const { createCharacterVisual } = await import('../src/render/characters/index');
  const gate: Gate = (target, settle) => h.gates.push({ target, settle });
  const body = (app: Appearance, queue?: WorkQueue): Visual => {
    const v = createCharacterVisual(player(app));
    if (!v) throw new Error('the fixture body did not build');
    v.setFarBakeGate(gate, queue);
    v.setWocEquipment({}, false);
    return v;
  };
  /** One frame of every body given; the gate requests in flight are left to the case. */
  const frame = (...bodies: Visual[]): void => {
    h.nextFrame(16);
    for (const v of bodies) v.update(0.016, IDLE, true);
  };
  /** Settle every gate request in flight (the links land). */
  const link = (): string[] => {
    const asked = h.gates.map((g) => g.target.name);
    for (const g of h.gates.splice(0)) g.settle(PROVEN);
    return asked;
  };
  /** The default look with its chin at `chin`: a face (and so a merged head) of its own. */
  const face = (chin: number): Appearance => ({
    ...h.DEFAULT_APPEARANCE,
    headShape: { ...h.DEFAULT_APPEARANCE.headShape, chinWidth: chin },
  });
  /** A body behind a gate of its own that no work queue ever came with: its units run on
   *  the spot (visual.ts scheduleWocWork). */
  const bare = (app: Appearance): Visual => {
    const v = createCharacterVisual(player(app));
    if (!v) throw new Error('the fixture body did not build');
    v.setFarBakeGate((target, settle) => h.gates.push({ target, settle }));
    v.setWocEquipment({}, false);
    return v;
  };
  /** Every build span from here on, by kind (the module instance the bodies record to). */
  const spans = async (): Promise<string[]> => {
    const kinds: string[] = [];
    const { setBuildSpanSink } = await import('../src/render/build_spans');
    setBuildSpanSink((kind) => kinds.push(kind));
    return kinds;
  };
  return { h, body, bare, frame, link, face, gate, spans };
}

function rigOf(v: Visual): THREE.Object3D {
  const rig = v.root.getObjectByName('character_model_wrap');
  if (!rig) throw new Error('the body has no rig');
  return rig;
}

/** The merged head mesh mounted on a body (drawn or still linking), or null. */
function mergedHeadOf(v: Visual): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  rigOf(v).traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.userData.wocHeadMerged) found = o as THREE.Mesh;
  });
  return found;
}

/** The head piece meshes of a body that its look shows. */
function shownPieces(v: Visual): THREE.Mesh[] {
  const rig = rigOf(v);
  const out: THREE.Mesh[] = [];
  rig.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !o.userData.wocHeadPart || o.userData.wocHeadMerged) return;
    for (let at: THREE.Object3D | null = o; at && at !== rig; at = at.parent) {
      if (!at.visible) return;
    }
    out.push(mesh);
  });
  return out;
}

/** Whether a body's merged head draws: mounted, revealed, its rig shown. */
function headStands(v: Visual): boolean {
  const head = mergedHeadOf(v);
  return head !== null && head.parent?.visible === true && head.layers.mask !== 0;
}

/**
 * What is wrong with how a body draws its head right now (empty: all is well): each shown
 * piece is drawn exactly once, by itself or by a stand-in that draws, and a stand-in that
 * draws is the head its pieces draw NOW: as many vertices as they have, and the base
 * head's (folded first: the pieces fold by name) where the live base mesh, posed as it
 * is, puts them. A fold started on one face and mounted on another fails the last.
 */
function headProblems(v: Visual): string[] {
  const out: string[] = [];
  const head = mergedHeadOf(v);
  const pieces = shownPieces(v);
  const folded = pieces.filter((piece) => piece.layers.mask === 0);
  if (!headStands(v)) {
    if (folded.length > 0) out.push(`${folded.length} pieces are folded with no stand-in drawn`);
    return out;
  }
  const geometry = (head as THREE.Mesh).geometry;
  const position = geometry.getAttribute('position');
  if (folded.length !== pieces.length) out.push('a shown piece draws beside its stand-in');
  const total = pieces.reduce((n, piece) => n + piece.geometry.getAttribute('position').count, 0);
  if (position.count !== total) {
    out.push(`the stand-in has ${position.count} vertices, its pieces ${total}`);
  }
  const base = pieces.find((piece) => piece.name === BASE);
  const bone = v.root.getObjectByName('head');
  if (!base || !bone) return [...out, 'no base head to hold the stand-in to'];
  v.root.updateMatrixWorld(true);
  const toBone = new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(base.matrixWorld);
  const count = base.geometry.getAttribute('position').count;
  const at = new THREE.Vector3();
  const drawn = new THREE.Vector3();
  for (const i of [0, Math.floor(count / 2), count - 1]) {
    base.getVertexPosition(i, drawn).applyMatrix4(toBone);
    at.fromBufferAttribute(position, i);
    if (at.distanceTo(drawn) > 1e-5) {
      out.push(`the stand-in's base vertex ${i} is not where the posed base head draws it`);
      break;
    }
  }
  return out;
}

const labels = (queue: Queue): (string | undefined)[] => queue.units.map((unit) => unit.label);

/** The vertices and index entries folded so far by the folds in flight. */
function foldedSoFar(h: WocVisualHarness): { vertices: number; indices: number } {
  let vertices = 0;
  let indices = 0;
  for (const { fold } of h.headMergeFolds.values()) {
    vertices += fold.foldedVertices;
    indices += fold.foldedIndices;
  }
  return { vertices, indices };
}

/** Run a body's chain to its end: every unit it queues, one at a time. Returns how many
 *  ran (a case that needs the gate settles it after). */
function runChain(queue: Queue, onUnit?: (unit: Unit) => void): number {
  let ran = 0;
  while (queue.units.length > 0) {
    const [unit] = queue.units.splice(0, 1);
    unit.run();
    onUnit?.(unit);
    if (++ran > 1000) throw new Error('the chain never ends');
  }
  return ran;
}

afterEach(() => releaseWocVisualHarness());

describe("a merged head's fold rides the renderer's work queue a band a unit", () => {
  it('queues ONE unit at a time: a band of the fold each, then the mount as a unit of its own kind', async () => {
    // guards: the fold of a whole head (ten thousand vertices and more through their
    // morphs) ran inside the one unit that mounted it, several times the budget's
    // smallest slice on a weak machine, once per distinct look of an arriving crowd
    const { h, body, frame, link } = await world();
    const queue = heldQueue();
    const v = body({ ...h.DEFAULT_APPEARANCE }, queue);
    expect(queue.units).toHaveLength(0);
    frame(v);
    expect(labels(queue)).toEqual([HEAD_MERGE_UNIT]);
    expect(h.headMergeFolds.size).toBe(0);
    const bands: { vertices: number; indices: number }[] = [];
    let units = 0;
    while (h.headMergeCache.size === 0) {
      // the chain holds one slot of the queue, at the stand-ins' priority
      expect(labels(queue)).toEqual([HEAD_MERGE_UNIT]);
      expect(queue.units[0].priority).toBe(GPU_WORK_PRIORITY.VISIBLE_PREWARM);
      const before = foldedSoFar(h);
      queue.units.splice(0, 1)[0].run();
      units++;
      // a band and nothing else: nothing mounted, nothing asked of the gate
      expect(mergedHeadOf(v)).toBeNull();
      expect(h.gates).toHaveLength(0);
      expect(headProblems(v)).toEqual([]);
      if (h.headMergeCache.size === 0) {
        // more to fold: one fold in flight
        expect(h.headMergeFolds.size).toBe(1);
        const after = foldedSoFar(h);
        bands.push({
          vertices: after.vertices - before.vertices,
          indices: after.indices - before.indices,
        });
        // frames while its unit waits ask for no second one
        frame(v);
        frame(v);
      }
      if (units > 1000) throw new Error('the chain never ends');
    }
    // whole: the cache's, idle, the fold gone, and the mount asked for as a unit of the
    // kind that only mounts (the budget prices a band and a mount apart)
    expect(h.headMergeFolds.size).toBe(0);
    expect([...h.headMergeCache.values()].map((entry) => entry.refs)).toEqual([0]);
    expect(labels(queue)).toEqual([HEAD_MOUNT_UNIT]);
    expect(queue.units[0].priority).toBe(GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    frame(v);
    frame(v);
    expect(labels(queue)).toEqual([HEAD_MOUNT_UNIT]);
    queue.units.splice(0, 1)[0].run();
    // mounted by that unit, hidden while it links
    const head = mergedHeadOf(v) as THREE.Mesh;
    expect(head).not.toBeNull();
    expect([...h.headMergeCache.values()].map((entry) => entry.refs)).toEqual([1]);
    const vertices = head.geometry.getAttribute('position').count;
    const indices = head.geometry.index?.count ?? 0;
    expect(vertices).toBeGreaterThan(BASE_VERTICES);
    expect(indices).toBeGreaterThan(BASE_INDICES);
    // literal for this fixture: nine bands of vertices, the last going on to the first of
    // two bands of triangles
    expect(units).toBe(10);
    expect(units).toBe(wocHeadMergeFoldUnits(vertices, indices));
    expect(bands.length).toBe(units - 1);
    for (const band of bands) {
      expect(band.vertices).toBeLessThanOrEqual(WOC_HEAD_MERGE_BAND_VERTICES);
      expect(band.indices).toBeLessThanOrEqual(WOC_HEAD_MERGE_BAND_INDICES);
    }
    // full bands, not dribbles: all but the last band of vertices fold a whole one
    expect(bands.slice(0, 8).map((band) => band.vertices)).toEqual(
      new Array<number>(8).fill(WOC_HEAD_MERGE_BAND_VERTICES),
    );
    expect(h.headMergeFolds.size).toBe(0);
    expect(queue.units).toHaveLength(0);
    expect(headStands(v)).toBe(false);
    expect(link()).toEqual([HEAD_GATE]);
    expect(headStands(v)).toBe(true);
    expect(headProblems(v)).toEqual([]);
    // steady state: a standing head asks for nothing more
    frame(v);
    frame(v);
    expect(queue.units).toHaveLength(0);
    v.dispose();
    expect([...h.headMergeCache.values()].map((entry) => entry.refs)).toEqual([0]);
  });

  it('two bodies in one face fold ONE head between them, and a newcomer only mounts', async () => {
    const { h, body, frame, link } = await world();
    const queue = heldQueue();
    const a = body({ ...h.DEFAULT_APPEARANCE }, queue);
    const b = body({ ...h.DEFAULT_APPEARANCE }, queue);
    frame(a, b);
    expect(labels(queue)).toEqual([HEAD_MERGE_UNIT, HEAD_MERGE_UNIT]);
    // their units, turn about: each folds the next band of the same fold
    queue.units.splice(0, 1)[0].run();
    queue.units.splice(0, 1)[0].run();
    expect(h.headMergeFolds.size).toBe(1);
    const [shared] = h.headMergeFolds.values();
    expect(shared.drivers).toBe(2);
    expect(shared.fold.foldedVertices).toBe(2 * WOC_HEAD_MERGE_BAND_VERTICES);
    const kinds: (string | undefined)[] = [];
    const ran = 2 + runChain(queue, (unit) => kinds.push(unit.label));
    // ten bands between them, never ten each; the body whose unit did not fold the last
    // band finds the head whole (its unit folds nothing); then a mount each
    expect(ran).toBe(13);
    expect(kinds).toEqual([
      ...new Array<string>(9).fill(HEAD_MERGE_UNIT),
      HEAD_MOUNT_UNIT,
      HEAD_MOUNT_UNIT,
    ]);
    expect(h.headMergeCache.size).toBe(1);
    expect(h.headMergeFolds.size).toBe(0);
    expect(link()).toEqual([HEAD_GATE, HEAD_GATE]);
    expect(headStands(a) && headStands(b)).toBe(true);
    expect(mergedHeadOf(a)?.geometry).toBe(mergedHeadOf(b)?.geometry);
    expect(headProblems(a)).toEqual([]);
    expect(headProblems(b)).toEqual([]);
    // a third body in that face finds it built: one unit, of the kind that only mounts
    const c = body({ ...h.DEFAULT_APPEARANCE }, queue);
    frame(c);
    expect(labels(queue)).toEqual([HEAD_MOUNT_UNIT]);
    expect(runChain(queue)).toBe(1);
    link();
    expect(mergedHeadOf(c)?.geometry).toBe(mergedHeadOf(a)?.geometry);
    expect(h.headMergeCache.size).toBe(1);
    for (const v of [a, b, c]) v.dispose();
    expect([...h.headMergeCache.values()].map((entry) => entry.refs)).toEqual([0]);
  });
});

describe('a crowd of new faces', () => {
  it('folds its heads one after another: the first is whole, and mounted, while the second has barely begun', async () => {
    // guards: the bodies' chains advancing a band each in turn (the order their units
    // leave the queue in), so no head is whole until they all nearly are and a crowd of
    // new faces stands in together at the very end, every body in its pieces until then
    const { h, body, frame, link, face } = await world();
    const queue = heldQueue();
    const a = body(face(0.2), queue);
    const b = body(face(0.8), queue);
    frame(a, b);
    expect(labels(queue)).toEqual([HEAD_MERGE_UNIT, HEAD_MERGE_UNIT]);
    // their units, turn about as the queue holds them: ten bands, every one of them the
    // first body's head, which is whole while the second has not folded a vertex
    for (let unit = 0; unit < 10; unit++) queue.units.splice(0, 1)[0].run();
    expect(h.headMergeCache.size).toBe(1);
    expect(h.headMergeFolds.size).toBe(1);
    expect(foldedSoFar(h)).toEqual({ vertices: 0, indices: 0 });
    expect(mergedHeadOf(a)).toBeNull();
    // the first body's unit finds its head whole and asks for its mount; the second's
    // folds its own first band; the mount runs
    expect(labels(queue)).toEqual([HEAD_MERGE_UNIT, HEAD_MERGE_UNIT]);
    queue.units.splice(0, 1)[0].run();
    expect(labels(queue)).toEqual([HEAD_MERGE_UNIT, HEAD_MOUNT_UNIT]);
    queue.units.splice(0, 1)[0].run();
    queue.units.splice(0, 1)[0].run();
    expect(mergedHeadOf(a)).not.toBeNull();
    expect(link()).toEqual([HEAD_GATE]);
    expect(headStands(a)).toBe(true);
    expect(headProblems(a)).toEqual([]);
    // ...thirteen units in, where the second head is one band along
    expect(mergedHeadOf(b)).toBeNull();
    expect(foldedSoFar(h)).toEqual({ vertices: WOC_HEAD_MERGE_BAND_VERTICES, indices: 0 });
    expect(headProblems(b)).toEqual([]);
    // its nine bands left and its mount, by its own units, and it stands in its own head
    // (at once: the first head's gate linked the program they both draw with)
    expect(runChain(queue)).toBe(9 + 1);
    expect(link()).toEqual([]);
    expect(headStands(b)).toBe(true);
    expect(headProblems(b)).toEqual([]);
    expect(mergedHeadOf(a)?.geometry).not.toBe(mergedHeadOf(b)?.geometry);
    expect(h.headMergeFolds.size).toBe(0);
    a.dispose();
    b.dispose();
    expect([...h.headMergeCache.values()].map((entry) => entry.refs)).toEqual([0, 0]);
  });

  it('a body with no queue behind its gate mounts whole on the spot, and folds nobody else a band', async () => {
    // guards: with nothing running between its units, such a body's chain ran nested, a
    // band a call, through its own head and through every head ahead of it in the line
    const { h, body, bare, frame, face, spans } = await world();
    const queue = heldQueue();
    const queued = body(face(0.2), queue);
    frame(queued);
    queue.units.splice(0, 1)[0].run();
    queue.units.splice(0, 1)[0].run();
    expect(foldedSoFar(h).vertices).toBe(2 * WOC_HEAD_MERGE_BAND_VERTICES);
    const kinds = await spans();
    const lone = bare(face(0.8));
    lone.update(0.016, IDLE, true);
    // mounted inside that frame, built in ONE piece: a mount's span, never a band's
    expect(mergedHeadOf(lone)).not.toBeNull();
    expect(kinds.filter((kind) => kind.startsWith('view:woc-head'))).toEqual([
      'view:woc-head-merge',
    ]);
    expect(h.headMergeCache.size).toBe(1);
    // the queued body's fold stands exactly where its own units left it
    expect(h.headMergeFolds.size).toBe(1);
    expect(foldedSoFar(h).vertices).toBe(2 * WOC_HEAD_MERGE_BAND_VERTICES);
    expect(labels(queue)).toEqual([HEAD_MERGE_UNIT]);
    expect(headProblems(lone)).toEqual([]);
    expect(headProblems(queued)).toEqual([]);
    queued.dispose();
    lone.dispose();
  });

  it('a mount unit whose head the cache dropped while it waited goes back to folding, a band a unit', async () => {
    // guards: the mount unit built the whole head itself (the build a mount does on a
    // miss), the one atomic unit the chain exists to break up, and under the mount's label
    const { h, body, frame, link, spans } = await world();
    const { clearIdleWocHeadMerges } = await import('../src/render/characters/woc_head_merge');
    const queue = heldQueue();
    const v = body({ ...h.DEFAULT_APPEARANCE }, queue);
    frame(v);
    for (let unit = 0; unit < 10; unit++) queue.units.splice(0, 1)[0].run();
    expect(labels(queue)).toEqual([HEAD_MOUNT_UNIT]);
    expect(h.headMergeCache.size).toBe(1);
    // idle until its mount: a profile change drops it
    clearIdleWocHeadMerges();
    expect(h.headMergeCache.size).toBe(0);
    const kinds = await spans();
    queue.units.splice(0, 1)[0].run();
    // nothing built and nothing mounted by that unit: it asked for a band instead
    expect(kinds).toEqual([]);
    expect(mergedHeadOf(v)).toBeNull();
    expect(h.headMergeCache.size).toBe(0);
    expect(labels(queue)).toEqual([HEAD_MERGE_UNIT]);
    // ten bands again, then the mount
    expect(runChain(queue)).toBe(10 + 1);
    expect(kinds).toEqual([
      ...new Array<string>(10).fill('view:woc-head-fold'),
      'view:woc-head-merge',
    ]);
    expect(link()).toEqual([HEAD_GATE]);
    expect(headStands(v)).toBe(true);
    expect(headProblems(v)).toEqual([]);
    v.dispose();
  });
});

describe('a head that stops being wanted mid-fold', () => {
  /** A body two bands into its fold, its next unit queued. */
  async function midFold() {
    const w = await world();
    const queue = heldQueue();
    const v = w.body(w.face(0.2), queue);
    w.frame(v);
    queue.units.splice(0, 1)[0].run();
    queue.units.splice(0, 1)[0].run();
    expect(w.h.headMergeFolds.size).toBe(1);
    expect(foldedSoFar(w.h).vertices).toBe(2 * WOC_HEAD_MERGE_BAND_VERTICES);
    expect(labels(queue)).toEqual([HEAD_MERGE_UNIT]);
    return { ...w, queue, v };
  }

  it('a face changed mid-fold: the old fold is let go at once, and the chain folds and mounts the new face', async () => {
    // guards: a fold started on one face and finished on another (mounted under the
    // first one's key), or a fold left half built for the session
    const { h, face, frame, link, queue, v } = await midFold();
    const [old] = h.headMergeFolds.keys();
    v.setWocHeadLook(face(0.9));
    // inside the look change: nobody folds the old face any more
    expect(h.headMergeFolds.size).toBe(0);
    frame(v);
    // one unit per head at a time: the one already queued looks again when it runs
    expect(labels(queue)).toEqual([HEAD_MERGE_UNIT]);
    queue.units.splice(0, 1)[0].run();
    expect([...h.headMergeFolds.keys()]).not.toEqual([old]);
    // the new face, from its first band: nine more, and its mount
    expect(foldedSoFar(h).vertices).toBe(WOC_HEAD_MERGE_BAND_VERTICES);
    expect(runChain(queue)).toBe(9 + 1);
    expect(link()).toEqual([HEAD_GATE]);
    expect(headStands(v)).toBe(true);
    expect(headProblems(v)).toEqual([]);
    // only the face that draws was ever built
    expect([...h.headMergeCache.keys()]).toHaveLength(1);
    expect(h.headMergeCache.has(old)).toBe(false);
    v.dispose();
  });

  it('a body gone to its far mesh mid-fold: its unit folds nothing more and the half fold is dropped', async () => {
    const { h, frame, link, queue, v } = await midFold();
    // into the far band: the body asks the queue for its far mesh (woc_far_bake.ts), and
    // from that ask on its rig is a stopgap (CharacterVisual farLodArriving)
    h.nextFrame();
    v.setFar(true);
    expect(labels(queue)[0]).toBe(HEAD_MERGE_UNIT);
    // the unit looks again when it runs: nothing to fold for a rig on its way out
    queue.units.splice(0, 1)[0].run();
    expect(h.headMergeFolds.size).toBe(0);
    expect(h.headMergeCache.size).toBe(0);
    expect(mergedHeadOf(v)).toBeNull();
    // the far mesh arrives through its own units, mounts, links and stands in for the rig
    for (let round = 0; round < 40; round++) {
      runChain(queue);
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (queue.units.length === 0 && round > 2) break;
    }
    link();
    v.setFar(true);
    expect(rigOf(v).visible).toBe(false);
    expect(mergedHeadOf(v)).toBeNull();
    frame(v);
    frame(v);
    expect(queue.units).toHaveLength(0);
    // near again: asked again, and the fold starts over from its first band
    v.setFar(false);
    frame(v);
    expect(labels(queue)).toEqual([HEAD_MERGE_UNIT]);
    queue.units.splice(0, 1)[0].run();
    expect(foldedSoFar(h).vertices).toBe(WOC_HEAD_MERGE_BAND_VERTICES);
    expect(runChain(queue)).toBe(9 + 1);
    link();
    expect(headStands(v)).toBe(true);
    expect(headProblems(v)).toEqual([]);
    v.dispose();
  });

  it.each([
    ['disposed', (v: Visual) => v.dispose()],
    ['switched off the merged draws', (v: Visual) => v.setWocDrawMerge(false)],
  ])(
    'a body %s mid-fold lets the fold go at once, and its queued unit does nothing',
    async (_what, end) => {
      const { h, queue, v } = await midFold();
      end(v);
      // nothing half built is kept: no fold, no geometry
      expect(h.headMergeFolds.size).toBe(0);
      expect(h.headMergeCache.size).toBe(0);
      expect(runChain(queue)).toBe(1);
      expect(h.headMergeFolds.size).toBe(0);
      expect(h.headMergeCache.size).toBe(0);
      expect(h.gates.filter((g) => g.target.name === HEAD_GATE)).toEqual([]);
      v.dispose();
    },
  );

  it('a body whose gate is taken away mid-fold lets the fold go at once, and starts over when one comes back', async () => {
    const { h, frame, link, gate, queue, v } = await midFold();
    v.setFarBakeGate(null);
    // no gate, no stand-in: nothing half built is kept, and the queued unit does nothing
    expect(h.headMergeFolds.size).toBe(0);
    expect(h.headMergeCache.size).toBe(0);
    expect(runChain(queue)).toBe(1);
    expect(h.headMergeFolds.size).toBe(0);
    frame(v);
    frame(v);
    expect(queue.units).toHaveLength(0);
    expect(mergedHeadOf(v)).toBeNull();
    expect(headProblems(v)).toEqual([]);
    // gated again: asked again, from the first band
    v.setFarBakeGate(gate, queue);
    frame(v);
    expect(labels(queue)).toEqual([HEAD_MERGE_UNIT]);
    queue.units.splice(0, 1)[0].run();
    expect(foldedSoFar(h).vertices).toBe(WOC_HEAD_MERGE_BAND_VERTICES);
    expect(runChain(queue)).toBe(9 + 1);
    expect(link()).toEqual([HEAD_GATE]);
    expect(headStands(v)).toBe(true);
    expect(headProblems(v)).toEqual([]);
    v.dispose();
  });

  it('a gate installed again mid-fold never leaves one head two chains: the unit left behind does nothing', async () => {
    // guards: the gate change let the head ask again while its old unit still sat in the
    // same queue, and that unit, which used to run once, now asked for a successor every
    // band: one head held two slots of the queue for the rest of its fold
    const { h, frame, link, gate, queue, v } = await midFold();
    v.setFarBakeGate(gate, queue);
    expect(h.headMergeFolds.size).toBe(0);
    frame(v);
    // the unit left behind, and the one the head asked for since
    expect(labels(queue)).toEqual([HEAD_MERGE_UNIT, HEAD_MERGE_UNIT]);
    queue.units.splice(0, 1)[0].run();
    expect(h.headMergeFolds.size).toBe(0);
    expect(labels(queue)).toEqual([HEAD_MERGE_UNIT]);
    // one chain from here: a unit in the queue at a time, ten bands, one mount
    let ran = 0;
    while (queue.units.length > 0) {
      expect(queue.units).toHaveLength(1);
      queue.units.splice(0, 1)[0].run();
      ran++;
      frame(v);
    }
    expect(ran).toBe(10 + 1);
    expect(link()).toEqual([HEAD_GATE]);
    expect(headStands(v)).toBe(true);
    expect(headProblems(v)).toEqual([]);
    expect(h.headMergeCache.size).toBe(1);
    v.dispose();
  });

  it('a second body keeps the fold a first one left, and goes on from where they got to', async () => {
    const { h, face, link, queue, v, body, frame } = await midFold();
    const peer = body(face(0.2), queue);
    frame(peer);
    expect(labels(queue)).toEqual([HEAD_MERGE_UNIT, HEAD_MERGE_UNIT]);
    // the peer's first unit joins the fold: its third band
    queue.units.splice(1, 1)[0].run();
    expect([...h.headMergeFolds.values()][0].drivers).toBe(2);
    expect(foldedSoFar(h).vertices).toBe(3 * WOC_HEAD_MERGE_BAND_VERTICES);
    v.dispose();
    expect(h.headMergeFolds.size).toBe(1);
    expect([...h.headMergeFolds.values()][0].drivers).toBe(1);
    // ten bands in all: three are folded, the disposed body's unit does nothing, and the
    // peer's mount is a unit of its own
    expect(runChain(queue)).toBe(1 + 7 + 1);
    link();
    expect(headStands(peer)).toBe(true);
    expect(headProblems(peer)).toEqual([]);
    peer.dispose();
  });
});

describe("the chain on the renderer's real work queue", () => {
  it('runs as that many units of the merge kind, one after another, then mounts the head under the mount kind', async () => {
    // guards: a unit that asks for the next from inside its own run (the queue is still
    // on it) must be granted like any other unit
    const { h, body, frame, link } = await world();
    const queue = createBackgroundGpuQueue();
    const v = body({ ...h.DEFAULT_APPEARANCE }, queue);
    frame(v);
    for (let i = 0; i < 400 && mergedHeadOf(v) === null; i++) await Promise.resolve();
    expect(mergedHeadOf(v)).not.toBeNull();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    const stats = queue.stats();
    expect(stats.pending).toBe(0);
    // ten bands of the merge kind, then the mount under its own
    expect(stats.units).toBe(11);
    const ran = stats.slowest.map((unit) => unit.label);
    expect(ran.filter((label) => label === HEAD_MERGE_UNIT)).toHaveLength(10);
    expect(ran.filter((label) => label === HEAD_MOUNT_UNIT)).toHaveLength(1);
    expect(new Set(stats.slowest.map((unit) => unit.priority))).toEqual(
      new Set([GPU_WORK_PRIORITY.VISIBLE_PREWARM]),
    );
    expect(link()).toEqual([HEAD_GATE]);
    expect(headStands(v)).toBe(true);
    expect(headProblems(v)).toEqual([]);
    v.dispose();
    await queue.shutdown();
  });
});

describe('a seeded run of heads that take a chain to fold', () => {
  it('never shows a stand-in that is not the head its pieces draw, and leaves no fold behind', async () => {
    // guards: the interleavings no scripted case names (a face over a band, a far crossing
    // over a queued unit, a unit run after a dispose, two bodies trading a fold, ...)
    const SEED = 4360;
    const STEPS = 4000;
    const { h, face, gate } = await world();
    const { createCharacterVisual } = await import('../src/render/characters/index');
    const rng = new Rng(SEED);
    const random = (): number => rng.next();
    const chance = (p: number): boolean => random() < p;
    const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
    const queue = heldQueue();
    // many faces, so most are new to the cache when a body takes one (a fold each), and
    // what each body wears, so a peer can take the very face its neighbour is folding
    const faces = Array.from({ length: 48 }, (_face, k) => face(k / 48));
    const wearing: Appearance[] = [];
    const born = (at: number): Visual => {
      wearing[at] = pick(faces);
      const v = createCharacterVisual(player(wearing[at]));
      if (!v) throw new Error('the fixture body did not build');
      v.setFarBakeGate(gate, queue);
      v.setWocEquipment({}, false);
      return v;
    };
    const crowd: Visual[] = [born(0), born(1), born(2)];
    const history: string[] = [];
    /** Units that left a fold in flight behind them, folds more than one body drove,
     *  stand-ins that came to stand, folds let go of half built (gone from the line and
     *  never handed to the cache), and each way out taken while a fold was in flight: a
     *  run without them would hold every rule below for free. */
    const seen = { midFold: 0, stood: 0, shared: 0, dropped: 0 };
    const exits: Record<string, number> = {};
    const standing = crowd.map(() => false);
    const audit = (did: string): void => {
      history.push(did);
      for (const [i, v] of crowd.entries()) {
        const problems = headProblems(v);
        if (problems.length > 0) {
          throw new Error(
            `seed ${SEED}, operation ${history.length}, body ${i}: ${problems.join('; ')}\n  after: ${history.slice(-12).join(' | ')}`,
          );
        }
        const now = headStands(v);
        if (now && !standing[i]) seen.stood++;
        standing[i] = now;
      }
      // a fold in flight is somebody's: never more of them than bodies, never an orphan
      expect(h.headMergeFolds.size).toBeLessThanOrEqual(crowd.length);
      for (const { drivers } of h.headMergeFolds.values()) {
        expect(drivers).toBeGreaterThan(0);
        if (drivers > 1) seen.shared++;
      }
    };
    const operations: readonly (readonly [number, (v: Visual, at: number) => string])[] = [
      [
        250,
        () => {
          h.nextFrame(16);
          for (const each of crowd) each.update(0.016, IDLE, true);
          return 'frame';
        },
      ],
      [
        600,
        () => {
          const unit = queue.units.splice(Math.floor(random() * queue.units.length), 1)[0];
          if (!unit) return 'unit (none)';
          unit.run();
          if (h.headMergeFolds.size > 0) seen.midFold++;
          return `unit ${unit.label}`;
        },
      ],
      [
        120,
        () => {
          const g = h.gates.splice(Math.floor(random() * h.gates.length), 1)[0];
          if (!g) return 'settle (none)';
          const proven = !chance(0.1);
          g.settle(() => proven);
          return `settle ${g.target.name} ${proven}`;
        },
      ],
      [
        30,
        (v, at) => {
          wearing[at] = pick(faces);
          v.setWocHeadLook(wearing[at]);
          return 'face';
        },
      ],
      [
        30,
        (v, at) => {
          wearing[at] = wearing[(at + 1) % crowd.length];
          v.setWocHeadLook(wearing[at]);
          return 'peer (its face)';
        },
      ],
      [
        25,
        (v) => {
          const far = chance(0.4);
          h.nextFrame();
          v.setFar(far);
          return `far ${far}`;
        },
      ],
      [
        30,
        (v) => {
          const on = chance(0.5);
          v.setActive(on);
          return `active ${on}`;
        },
      ],
      [
        12,
        (v) => {
          const on = chance(0.7);
          v.setWocDrawMerge(on);
          return `merge ${on}`;
        },
      ],
      [
        12,
        (v) => {
          v.setFarBakeGate(gate, queue);
          return 'gate (installed again)';
        },
      ],
      [
        12,
        (v) => {
          const on = chance(0.4);
          v.setGhost(on, 'stealth');
          return `stealth ${on}`;
        },
      ],
      [
        12,
        (v, at) => {
          v.dispose();
          crowd[at] = born(at);
          standing[at] = false;
          return 'dispose (and a newcomer)';
        },
      ],
    ];
    const weights = operations.reduce((sum, [weight]) => sum + weight, 0);
    for (let step = 0; step < STEPS; step++) {
      const at = Math.floor(random() * crowd.length);
      let roll = random() * weights;
      const [, operation] =
        operations.find(([weight]) => {
          roll -= weight;
          return roll < 0;
        }) ?? operations[0];
      const inFlight = [...h.headMergeFolds.keys()];
      const did = operation(crowd[at], at);
      // a fold that left the line and is not the cache's was let go of half built
      const dropped = inFlight.filter(
        (key) => !h.headMergeFolds.has(key) && !h.headMergeCache.has(key),
      ).length;
      seen.dropped += dropped;
      const kind = did.split(' ')[0];
      if (dropped > 0) exits[kind] = (exits[kind] ?? 0) + 1;
      audit(`#${at} ${did}`);
    }
    // the run chained, shared, merged and let go: the rules above were not held for free
    expect(history.length).toBe(STEPS);
    expect(seen.midFold).toBeGreaterThan(250);
    expect(seen.shared).toBeGreaterThan(25);
    expect(seen.stood).toBeGreaterThan(40);
    expect(seen.dropped).toBeGreaterThan(20);
    // ...by every way out: a face (its own, a peer's), a unit that finds its body hidden
    // or far, a dispose, a gate installed again, the merged draws switched off
    expect((exits.face ?? 0) + (exits.peer ?? 0)).toBeGreaterThan(10);
    expect(exits.unit ?? 0).toBeGreaterThan(1);
    expect(exits.dispose ?? 0).toBeGreaterThan(1);
    expect(exits.gate ?? 0).toBeGreaterThan(1);
    expect(exits.merge ?? 0).toBeGreaterThan(0);

    // Whatever came before, an idle queue and a healthy gate end with every body merged.
    for (const v of crowd) {
      v.setGhost(false);
      v.setActive(true);
      h.nextFrame();
      v.setFar(false);
      v.setWocDrawMerge(true);
      v.setFarBakeGate(gate, queue);
      v.setWocHeadLook(face(0.35));
    }
    for (let i = 0; i < 40; i++) {
      h.nextFrame(16);
      for (const v of crowd) v.update(0.016, IDLE, true);
      runChain(queue);
      for (const g of h.gates.splice(0)) g.settle(PROVEN);
      audit('a healthy frame');
    }
    for (const v of crowd) expect(headStands(v)).toBe(true);
    expect(new Set(crowd.map((v) => mergedHeadOf(v)?.geometry)).size).toBe(1);

    // dispose: no fold left in flight, every lease returned, and nothing a disposed body
    // left queued takes one again
    for (const v of crowd) v.dispose();
    expect(h.headMergeFolds.size).toBe(0);
    const leased = (): number[] =>
      [...h.headMergeCache.values()].map((entry) => entry.refs).filter((n) => n !== 0);
    expect(leased()).toEqual([]);
    runChain(queue);
    for (const g of h.gates.splice(0)) g.settle(PROVEN);
    expect(h.headMergeFolds.size).toBe(0);
    expect(leased()).toEqual([]);
    // ...nor is any head still waited for by a body that is gone: all are idle, and the
    // cache holds no more of them than its cap (a wait never given back would keep its
    // head for good)
    expect([...h.headMergeCache.values()].map((entry) => entry.awaited)).toEqual(
      [...h.headMergeCache.values()].map(() => 0),
    );
    expect(h.headMergeCache.size).toBeGreaterThan(0);
    expect(h.headMergeCache.size).toBeLessThanOrEqual(12);
  });
});
