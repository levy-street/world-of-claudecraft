// Composed-look PIECES: the decal maps and cuts a composed body needs, built a
// band at a time on the GPU work queue and deduped by style key, so a live
// view build off a never-seen look is a cache hit instead of 60 to 200 ms of
// texture painting inside the frame (src/render/characters/look_pieces.ts).
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  composedLookPiecesFor,
  composedLookReady,
  DECAL_ATTACH_LABEL,
  DECAL_GEOMETRY_LABEL,
  enqueueComposedLookPieces,
  LOOK_BAND_ROWS,
  type LookPieceQueue,
  lookPiecesStats,
  lookTextureBands,
  MAKEUP_BAND_LABEL,
  noteLookAttached,
  noteLookDeferred,
  resetLookPiecesForTest,
  STUBBLE_BAND_LABEL,
} from '../src/render/characters/look_pieces';
import {
  ensureMakeupGeometry,
  hasMakeupGeometry,
  hasMakeupTexture,
  MAKEUP_TEX_SIZE,
  makeupTexture,
  makeupTextureData,
  makeupTextureFromData,
  makeupTextureRows,
} from '../src/render/characters/makeup';
import { VISUALS } from '../src/render/characters/manifest';
import {
  DEFAULT_APPEARANCE,
  MODULAR_WARRIOR_KEY,
  type ModularAppearance,
  type ModularLook,
  makeupSelection,
  type StubbleSelection,
  stubbleDecals,
} from '../src/render/characters/modular';
import {
  DECAL_TEX_SIZE,
  decalKey,
  decalTexture,
  decalTextureData,
  decalTextureFromData,
  decalTextureRows,
  ensureDecalGeometry,
  hasDecalGeometry,
  hasDecalTexture,
} from '../src/render/characters/stubble';
import { gpuPrepKindOfLabel } from '../src/render/gpu_prep_budget_core';

const DEF = VISUALS[MODULAR_WARRIOR_KEY];

function lookWith(app: Partial<ModularAppearance>): ModularLook {
  return { app: { ...DEFAULT_APPEARANCE, ...app }, worn: {} };
}

/** A synthetic head (the stubble test's ellipsoid) as a SkinnedMesh, enough
 *  for the cut path without the shipped GLB. */
function sphereHead(): THREE.SkinnedMesh {
  const geo = new THREE.SphereGeometry(1, 24, 18);
  geo.scale(1, 0.95, 1.1);
  geo.computeVertexNormals();
  const pos = geo.getAttribute('position');
  const skinIndex = new Uint16Array(pos.count * 4);
  const skinWeight = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    skinIndex[i * 4] = 0;
    skinWeight[i * 4] = 1;
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  const bone = new THREE.Bone();
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone]));
  return mesh;
}

/** A queue that records every unit and runs it on demand (or at once). */
function fakeQueue(mode: 'immediate' | 'manual' = 'immediate') {
  const runs: { label: string; priority: number }[] = [];
  const parked: {
    work: () => unknown;
    resolve: (v: unknown) => void;
    reject: (e: unknown) => void;
  }[] = [];
  const queue: LookPieceQueue = {
    run<T>(work: () => T | Promise<T>, priority = 0, label = 'unlabeled'): Promise<T> {
      runs.push({ label, priority });
      if (mode === 'immediate') {
        try {
          return Promise.resolve(work());
        } catch (err) {
          return Promise.reject(err);
        }
      }
      return new Promise<T>((resolve, reject) => {
        parked.push({ work, resolve: resolve as (v: unknown) => void, reject });
      });
    },
  };
  const step = (): boolean => {
    const next = parked.shift();
    if (!next) return false;
    try {
      next.resolve(next.work());
    } catch (err) {
      next.reject(err);
    }
    return true;
  };
  return { queue, runs, parked, step };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const bandsOf = (fn: (out: Uint8Array, a: number, b: number) => void, size: number) => {
  const out = new Uint8Array(size * size * 4);
  // painted out of order on purpose: a band depends on its own rows only
  for (let band = lookTextureBands(size) - 1; band >= 0; band--) {
    fn(out, band * LOOK_BAND_ROWS, (band + 1) * LOOK_BAND_ROWS);
  }
  return out;
};

describe('row-sliced decal maps', () => {
  const SIZE = 64;
  it.each<StubbleSelection>([
    { scalp: 'crew', beard: null },
    { scalp: 'buzz', beard: 'stubble' },
    { scalp: null, beard: 'scruff' },
    { scalp: null, beard: null },
  ])('stubble bands concatenate to the byte-identical full map (%o)', (sel) => {
    const whole = decalTextureData(sel, SIZE);
    const banded = bandsOf((out, a, b) => decalTextureRows(sel, out, a, b, SIZE), SIZE);
    expect(banded.length).toBe(whole.length);
    expect(Buffer.from(banded).equals(Buffer.from(whole))).toBe(true);
    // not a trivially empty map for the selections that wear something
    if (sel.scalp || sel.beard) expect(whole.some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
  });

  it.each([
    { blush: 'rose', eyeshadow: 'plum' },
    { blush: 'none', eyeshadow: 'teal' },
    { blush: 'peach', eyeshadow: 'none' },
    { blush: 'none', eyeshadow: 'none' },
  ] as const)('makeup bands concatenate to the byte-identical full map (%o)', (sel) => {
    const whole = makeupTextureData(sel, SIZE);
    const banded = bandsOf((out, a, b) => makeupTextureRows(sel, out, a, b, SIZE), SIZE);
    expect(banded.length).toBe(whole.length);
    expect(Buffer.from(banded).equals(Buffer.from(whole))).toBe(true);
    // painted for the selections that wear something, and only for those
    const wearsAny = sel.blush !== 'none' || sel.eyeshadow !== 'none';
    expect(whole.some((v, i) => i % 4 === 3 && v > 0)).toBe(wearsAny);
  });

  it('the shipped sizes split evenly into the structural bands (a fraction of the map, not a count)', () => {
    expect(LOOK_BAND_ROWS).toBe(8);
    expect(DECAL_TEX_SIZE % LOOK_BAND_ROWS).toBe(0);
    expect(MAKEUP_TEX_SIZE % LOOK_BAND_ROWS).toBe(0);
    // the unit count follows the map: the larger stubble map is more units,
    // never a bigger unit
    expect(lookTextureBands(DECAL_TEX_SIZE)).toBe(128);
    expect(lookTextureBands(MAKEUP_TEX_SIZE)).toBe(64);
    expect(lookTextureBands(DECAL_TEX_SIZE) * LOOK_BAND_ROWS).toBe(DECAL_TEX_SIZE);
    // a size that does not divide gets a short last band, never a dropped row
    expect(lookTextureBands(1020)).toBe(128);
    expect(lookTextureBands(1)).toBe(1);
  });

  it('residency flips when a map is published from data, and the getter then serves it', () => {
    const sel: StubbleSelection = { scalp: 'horseshoe', beard: 'scruff' };
    expect(hasDecalTexture(sel)).toBe(false);
    const data = decalTextureData(sel, DECAL_TEX_SIZE);
    const tex = decalTextureFromData(sel, data);
    expect(hasDecalTexture(sel)).toBe(true);
    expect(decalTexture(sel)).toBe(tex);
    expect(tex.image.data).toBe(data);
    // first publish wins
    expect(decalTextureFromData(sel, decalTextureData(sel, DECAL_TEX_SIZE))).toBe(tex);

    const makeup = { blush: 'mauve', eyeshadow: 'bronze' } as const;
    expect(hasMakeupTexture(makeup)).toBe(false);
    const mtex = makeupTextureFromData(makeup, makeupTextureData(makeup));
    expect(hasMakeupTexture(makeup)).toBe(true);
    expect(makeupTexture(makeup)).toBe(mtex);
  });

  it('cuts become resident through ensure, keyed per head geometry', () => {
    const head = sphereHead();
    const sel: StubbleSelection = { scalp: 'buzz', beard: null };
    expect(hasDecalGeometry(head.geometry, sel)).toBe(false);
    ensureDecalGeometry(head, sel);
    expect(hasDecalGeometry(head.geometry, sel)).toBe(true);
    // per (head, styles): another style on the same head is its own cut
    expect(hasDecalGeometry(head.geometry, { scalp: 'crew', beard: null })).toBe(false);
    expect(hasMakeupGeometry(head.geometry)).toBe(false);
    ensureMakeupGeometry(head);
    expect(hasMakeupGeometry(head.geometry)).toBe(true);
    // a head with no frame is resident as null once ensured, never waited on
    const bare = new THREE.SkinnedMesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial(),
    );
    ensureDecalGeometry(bare, sel);
    expect(hasDecalGeometry(bare.geometry, sel)).toBe(true);
  });
});

describe('composed look pieces on the GPU work queue', () => {
  beforeEach(() => {
    resetLookPiecesForTest();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a look with no decal at all is ready at once and enqueues nothing', () => {
    const look = lookWith({ hair: 'bald', beard: 'none' });
    const q = fakeQueue();
    expect(composedLookReady(DEF, look, null)).toBe(true);
    const pieces = composedLookPiecesFor(DEF, look, null, q.queue, 30);
    expect(pieces.ready).toBe(true);
    expect(q.runs).toEqual([]);
    expect(lookPiecesStats()).toEqual({
      pending: 0,
      completedPieces: 0,
      bandsRun: 0,
      deferred: 0,
      attached: 0,
    });
  });

  it('a stubble map is a chain of band units, one in the queue at a time, then resident', async () => {
    const look = lookWith({ hair: 'buzz', beard: 'stubble' });
    const sel = stubbleDecals(look.app, look.worn);
    expect(sel).toEqual({ scalp: 'buzz', beard: 'stubble' });
    expect(hasDecalTexture(sel)).toBe(false);
    const bands = lookTextureBands(DECAL_TEX_SIZE);
    const q = fakeQueue('manual');
    const first = composedLookPiecesFor(DEF, look, null, q.queue, 30);
    expect(first.ready).toBe(false);
    expect(lookPiecesStats()).toMatchObject({ pending: 1, deferred: 1 });
    // never all at once: the first band alone sits in the queue
    expect(q.runs.map((r) => r.label)).toEqual([`${STUBBLE_BAND_LABEL}:${decalKey(sel)}:0`]);
    expect(q.runs[0].priority).toBe(30);
    // a second deferral for the same look (another entity of the crowd)
    // dedupes the piece and waits on the SAME in-flight chain
    const second = composedLookPiecesFor(DEF, look, null, q.queue, 30);
    expect(second.ready).toBe(false);
    expect(q.runs).toHaveLength(1);
    expect(lookPiecesStats().deferred).toBe(2);
    let firstReady = false;
    let secondReady = false;
    void first.whenReady.then(() => {
      firstReady = true;
    });
    void second.whenReady.then(() => {
      secondReady = true;
    });
    for (let band = 0; band < bands; band++) {
      expect(q.step()).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (band < bands - 1) {
        expect(q.runs).toHaveLength(band + 2);
        expect(q.runs[band + 1].label).toBe(`${STUBBLE_BAND_LABEL}:${decalKey(sel)}:${band + 1}`);
        expect(hasDecalTexture(sel)).toBe(false);
        expect(firstReady).toBe(false);
      }
    }
    await flush();
    expect(q.runs).toHaveLength(bands);
    expect(hasDecalTexture(sel)).toBe(true);
    expect(firstReady).toBe(true);
    expect(secondReady).toBe(true);
    expect(composedLookReady(DEF, look, null)).toBe(true);
    expect(composedLookPiecesFor(DEF, look, null, q.queue, 30).ready).toBe(true);
    expect(lookPiecesStats()).toEqual({
      pending: 0,
      completedPieces: 1,
      bandsRun: bands,
      deferred: 2,
      attached: 0,
    });
    // the published map is the banded paint, byte-identical to the whole
    const published = decalTexture(sel).image.data as Uint8Array;
    expect(Buffer.from(published).equals(Buffer.from(decalTextureData(sel)))).toBe(true);
    // the kind the budget learns is the texture family
    expect(gpuPrepKindOfLabel(q.runs[0].label)).toBe(STUBBLE_BAND_LABEL);
  });

  it('allocates the map buffer inside the first band unit, never in the deciding frame', async () => {
    // The deferral exists to spare the frame the entity enters range; a 4 MB
    // allocation in that frame is the very cost it defers.
    // a selection no other case publishes, so its map is not resident yet
    const look = lookWith({ hair: 'bald', beard: 'scruff' });
    expect(hasDecalTexture(stubbleDecals(look.app, look.worn))).toBe(false);
    const bytes = DECAL_TEX_SIZE * DECAL_TEX_SIZE * 4;
    const RealArrayBuffer = globalThis.ArrayBuffer;
    const allocated: number[] = [];
    globalThis.ArrayBuffer = class extends RealArrayBuffer {
      constructor(length: number) {
        super(length);
        allocated.push(length);
      }
    } as unknown as ArrayBufferConstructor;
    try {
      const q = fakeQueue('manual');
      expect(composedLookPiecesFor(DEF, look, null, q.queue, 30).ready).toBe(false);
      expect(allocated).not.toContain(bytes);
      expect(q.step()).toBe(true);
      expect(allocated).toContain(bytes);
    } finally {
      globalThis.ArrayBuffer = RealArrayBuffer;
    }
  });

  it('a makeup map is its own band family, and a look wearing both maps needs both', async () => {
    const look = lookWith({ hair: 'crew', beard: 'none', blush: 'rose', eyeshadow: 'teal' });
    const q = fakeQueue();
    enqueueComposedLookPieces(DEF, look, null, q.queue, 30);
    await flush();
    const kinds = new Set(q.runs.map((r) => gpuPrepKindOfLabel(r.label)));
    expect(kinds).toEqual(new Set([STUBBLE_BAND_LABEL, MAKEUP_BAND_LABEL]));
    expect(q.runs.filter((r) => r.label.startsWith(MAKEUP_BAND_LABEL))).toHaveLength(
      lookTextureBands(MAKEUP_TEX_SIZE),
    );
    expect(hasMakeupTexture(makeupSelection(look.app, look.worn))).toBe(true);
    expect(composedLookReady(DEF, look, null)).toBe(true);
    expect(lookPiecesStats()).toMatchObject({ pending: 0, completedPieces: 2 });
  });

  it('whenReady waits on every piece of THIS look, including one another look started', async () => {
    // look A starts the stubble map; look B needs that same map plus its own
    // makeup map, so B settles only once BOTH chains are done
    const a = lookWith({ hair: 'buzz', beard: 'scruff', blush: 'none', eyeshadow: 'none' });
    const b = lookWith({ hair: 'buzz', beard: 'scruff', blush: 'peach', eyeshadow: 'plum' });
    const q = fakeQueue('manual');
    const piecesA = composedLookPiecesFor(DEF, a, null, q.queue, 30);
    const piecesB = composedLookPiecesFor(DEF, b, null, q.queue, 30);
    expect(piecesA.ready).toBe(false);
    expect(piecesB.ready).toBe(false);
    // the shared stubble chain is in flight once; B added only its makeup chain
    expect(q.runs.map((r) => gpuPrepKindOfLabel(r.label))).toEqual([
      STUBBLE_BAND_LABEL,
      MAKEUP_BAND_LABEL,
    ]);
    let aReady = false;
    let bReady = false;
    void piecesA.whenReady.then(() => {
      aReady = true;
    });
    void piecesB.whenReady.then(() => {
      bReady = true;
    });
    // run every parked unit to completion (each step re-parks the next band)
    while (q.step()) await new Promise((resolve) => setTimeout(resolve, 0));
    await flush();
    expect(hasDecalTexture(stubbleDecals(a.app, a.worn))).toBe(true);
    expect(hasMakeupTexture(makeupSelection(b.app, b.worn))).toBe(true);
    expect(aReady).toBe(true);
    expect(bReady).toBe(true);
    expect(lookPiecesStats()).toMatchObject({ pending: 0, completedPieces: 2, deferred: 2 });
  });

  it('with the head resolved, the cuts are one unit each and run once', async () => {
    const head = sphereHead();
    const look = lookWith({ hair: 'crew', beard: 'none', blush: 'rose', eyeshadow: 'none' });
    const sel = stubbleDecals(look.app, look.worn);
    const q = fakeQueue();
    expect(composedLookReady(DEF, look, head)).toBe(false);
    enqueueComposedLookPieces(DEF, look, head, q.queue, 30);
    enqueueComposedLookPieces(DEF, look, head, q.queue, 30);
    await flush();
    const geometryUnits = q.runs.filter(
      (r) => gpuPrepKindOfLabel(r.label) === DECAL_GEOMETRY_LABEL,
    );
    expect(geometryUnits.map((r) => r.label).sort()).toEqual([
      `${DECAL_GEOMETRY_LABEL}:makeup-geometry:${head.geometry.uuid}`,
      `${DECAL_GEOMETRY_LABEL}:stubble-geometry:${head.geometry.uuid}|${decalKey(sel)}`,
    ]);
    expect(hasDecalGeometry(head.geometry, sel)).toBe(true);
    expect(hasMakeupGeometry(head.geometry)).toBe(true);
    expect(composedLookReady(DEF, look, head)).toBe(true);
    // a second look on the same head with the same styles shares every piece
    expect(composedLookReady(DEF, lookWith({ ...look.app, skinHue: 200 }), head)).toBe(true);
    // ...and a differently cut style needs only its own cut and map
    q.runs.length = 0;
    enqueueComposedLookPieces(DEF, lookWith({ hair: 'buzz', beard: 'none' }), head, q.queue, 30);
    await flush();
    const kinds = q.runs.map((r) => gpuPrepKindOfLabel(r.label));
    const bands = lookTextureBands(DECAL_TEX_SIZE);
    expect(kinds.filter((k) => k === STUBBLE_BAND_LABEL)).toHaveLength(bands);
    expect(kinds.filter((k) => k === DECAL_GEOMETRY_LABEL)).toHaveLength(1);
    expect(kinds).toHaveLength(bands + 1);
    // without a head there is nothing to cut and nothing to wait on
    expect(composedLookReady(DEF, look, null)).toBe(true);
  });

  it('a failing band drops the key so a later enqueue retries, warning once, and settles the wait', async () => {
    const look = lookWith({ hair: 'crew', beard: 'scruff' });
    const sel = stubbleDecals(look.app, look.worn);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = fakeQueue('manual');
    const pieces = composedLookPiecesFor(DEF, look, null, failing.queue, 30);
    expect(lookPiecesStats().pending).toBe(1);
    const unit = failing.parked.shift();
    unit?.reject(new Error('queue shut down'));
    // never a rejection for the waiter: it settles, and the attach paints
    // what is missing synchronously (fail-soft)
    await expect(pieces.whenReady).resolves.toBeUndefined();
    await flush();
    expect(lookPiecesStats().pending).toBe(0);
    expect(hasDecalTexture(sel)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    // retried on the next enqueue, from band 0
    const q = fakeQueue();
    enqueueComposedLookPieces(DEF, look, null, q.queue, 30);
    await flush();
    expect(q.runs[0].label).toBe(`${STUBBLE_BAND_LABEL}:${decalKey(sel)}:0`);
    expect(hasDecalTexture(sel)).toBe(true);
    // a second failure of the same key is not reported again
    resetLookPiecesForTest();
    warn.mockClear();
    const again = fakeQueue('manual');
    const retry = lookWith({ hair: 'crew', beard: 'stubble' });
    enqueueComposedLookPieces(DEF, retry, null, again.queue, 30);
    again.parked.shift()?.reject(new Error('one'));
    await flush();
    enqueueComposedLookPieces(DEF, retry, null, again.queue, 30);
    again.parked.shift()?.reject(new Error('two'));
    await flush();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('attachWhenReady runs the attach as one budgeted unit per body once the pieces land, never in the settle turn', async () => {
    // three peers of the crowd wearing one never-seen look: one shared piece
    // chain, three attach units, each admitted by the queue on its own slot
    const look = lookWith({ hair: 'bald', beard: 'stubble', blush: 'none', eyeshadow: 'none' });
    const q = fakeQueue('manual');
    const peers = [1, 2, 3].map(() => composedLookPiecesFor(DEF, look, null, q.queue, 30));
    const attached: number[] = [];
    peers.forEach((pieces, i) => {
      expect(pieces.ready).toBe(false);
      pieces.attachWhenReady(`peer-${i}`, () => attached.push(i));
    });
    // land every band (each step re-parks the next band of the one chain)
    let steps = 0;
    while (q.parked.length > 0 && !q.runs.some((r) => r.label.startsWith(DECAL_ATTACH_LABEL))) {
      q.step();
      steps++;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(steps).toBe(lookTextureBands(DECAL_TEX_SIZE));
    await flush();
    // the pieces are resident, yet nothing attached: the three attaches sit
    // in the queue as units of their own, labelled per body at the priority
    expect(hasDecalTexture(stubbleDecals(look.app, look.worn))).toBe(true);
    expect(attached).toEqual([]);
    const units = q.runs.filter((r) => gpuPrepKindOfLabel(r.label) === DECAL_ATTACH_LABEL);
    expect(units.map((r) => r.label)).toEqual([
      `${DECAL_ATTACH_LABEL}:peer-0`,
      `${DECAL_ATTACH_LABEL}:peer-1`,
      `${DECAL_ATTACH_LABEL}:peer-2`,
    ]);
    expect(units.every((r) => r.priority === 30)).toBe(true);
    // one admitted slot, one body
    expect(q.step()).toBe(true);
    await flush();
    expect(attached).toEqual([0]);
    while (q.step()) await flush();
    expect(attached).toEqual([0, 1, 2]);
    // a unit the queue refuses is dropped, never an unhandled rejection
    const shut = composedLookPiecesFor(DEF, look, null, q.queue, 30);
    expect(shut.ready).toBe(true);
    let ran = false;
    shut.attachWhenReady('late', () => {
      ran = true;
    });
    await flush();
    q.parked.shift()?.reject(new Error('queue shut down'));
    await flush();
    expect(ran).toBe(false);
  });

  it('a fixed rig def has no pieces', () => {
    const q = fakeQueue();
    expect(composedLookReady(VISUALS.player_warrior, lookWith({ hair: 'buzz' }), null)).toBe(true);
    enqueueComposedLookPieces(
      VISUALS.player_warrior,
      lookWith({ hair: 'buzz' }),
      null,
      q.queue,
      30,
    );
    expect(q.runs).toEqual([]);
    noteLookDeferred();
    noteLookAttached();
    expect(lookPiecesStats()).toMatchObject({ deferred: 1, attached: 1 });
  });
});
