// @vitest-environment happy-dom
// The WOC geometry levels through the REAL CharacterVisual, built the way the world view builds
// it (index.ts createCharacterVisual), over the shared fixture body whose every geometry ships
// coarser levels (tests/helpers/woc_visual_harness.ts `lods`: mid every other triangle, far
// every fourth). Pins the policy table of src/render/characters/woc_lod_core.ts end to end: a
// crowd body draws mid everywhere up close (the body, every armor part, every head piece the
// sliders do not move, and the merged head and merged armor built from them; a slider piece
// drawn on its own keeps level 0), the local player's own body draws level 0, the low preset
// draws mid for everyone, and the far bake freezes the far levels.
import type * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FULL_KIT_EQUIPPED,
  IDLE,
  player,
  releaseWocVisualHarness,
  type WocHarnessVisual,
  type WocVisualHarnessOptions,
  wocVisualHarness,
} from './helpers/woc_visual_harness';

type Visual = WocHarnessVisual;

afterEach(releaseWocVisualHarness);

async function world(opts: WocVisualHarnessOptions = {}) {
  const h = await wocVisualHarness({ kit: 'full', lods: true, ...opts });
  const lod = await import('../src/render/assets/geometry_lod');
  const gfx = await import('../src/render/gfx');
  if (!opts.lowTier) {
    // a desktop on the high preset: the full-detail arm draws level 0
    gfx.activateGfxProfile({
      ...gfx.getActiveGfxProfile(),
      settings: gfx.gfxInternalsForTest.settingsFor('high', { search: '?gfx=high' }),
    });
  }
  const { createCharacterVisual } = await import('../src/render/characters/index');
  /** A world body: the local player's own (`local`) or anyone else's, its compile gate in
   *  (no work queue: a stand-in mounts on the spot), dressed in the full kit. */
  const body = (
    local: boolean,
    app: Record<string, unknown> = { ...h.DEFAULT_APPEARANCE },
  ): Visual => {
    const v = createCharacterVisual(player(app), undefined, undefined, local);
    if (!v) throw new Error('the fixture body did not build');
    v.setFarBakeGate((target, settle) => h.gates.push({ target, settle }));
    v.setWocEquipment(FULL_KIT_EQUIPPED, false);
    return v;
  };
  /** Frames until every gate settles and the stand-ins stand. */
  const settle = (bodies: readonly Visual[]): void => {
    for (let i = 0; i < 6; i++) {
      h.nextFrame(16);
      for (const v of bodies) v.update(0.016, IDLE, true);
      for (const g of h.gates.splice(0)) g.settle(() => true);
    }
  };
  return { h, lod, gfx, body, settle };
}

type Lod = Awaited<ReturnType<typeof world>>['lod'];

/** Every mesh of a body's rig, by what it is. */
function meshesOf(v: Visual) {
  const rig = v.root.getObjectByName('character_model_wrap');
  if (!rig) throw new Error('the body has no rig');
  const out = {
    body: [] as THREE.Mesh[],
    parts: [] as THREE.Mesh[],
    pieces: [] as THREE.Mesh[],
    merged: [] as THREE.Mesh[],
  };
  rig.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (o.userData.wocHeadMerged || o.userData.wocArmorMerged) out.merged.push(mesh);
    else if (o.userData.wocHeadPart) out.pieces.push(mesh);
    else if (o.userData.wocArmorPart) out.parts.push(mesh);
    else out.body.push(mesh);
  });
  return out;
}

const levels = (lod: Lod, meshes: readonly THREE.Mesh[]): string[] => [
  ...new Set(meshes.map((m) => lod.geometryLodLevelOf(m.geometry))),
];

/** Triangles a mesh draws. */
const tris = (mesh: THREE.Mesh): number =>
  (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3;

/** A face piece the sliders move: drawn piece by piece it keeps level 0 at every level
 *  (woc_head_packs.ts hangWocHeadPieces: a variant would cost a second morph texture). */
const morphed = (mesh: THREE.Mesh): boolean =>
  Object.values(mesh.geometry.morphAttributes).some((list) => list.length > 0);

describe('who draws which level up close', () => {
  it('a crowd body draws mid on every piece; the local player draws level 0', async () => {
    const { lod, gfx, body } = await world();
    expect(gfx.GFX.constrainedMemory).toBe(false);
    const crowd = meshesOf(body(false));
    const local = meshesOf(body(true));
    for (const [what, meshes] of Object.entries(crowd)) {
      if (what === 'merged') continue;
      expect(meshes.length, what).toBeGreaterThan(0);
      const plain = meshes.filter((mesh) => !morphed(mesh));
      expect(levels(lod, plain), `crowd ${what}`).toEqual(['mid']);
    }
    // the face pieces the sliders move keep level 0 even for the crowd (the merged head,
    // which bakes their morphs, is what draws their mid)
    const sliders = crowd.pieces.filter(morphed);
    expect(sliders.length).toBeGreaterThan(0);
    expect(levels(lod, sliders)).toEqual(['lod0']);
    for (const what of ['body', 'parts', 'pieces'] as const) {
      expect(levels(lod, local[what]), `local ${what}`).toEqual(['lod0']);
    }
    // the same pieces, over the same shared buffers: the crowd's draw half the triangles
    const total = (m: ReturnType<typeof meshesOf>) =>
      [...m.body, ...m.parts, ...m.pieces]
        .filter((mesh) => !morphed(mesh))
        .reduce((n, mesh) => n + tris(mesh), 0);
    expect(total(crowd) * 2).toBe(total(local));
    for (const mesh of crowd.pieces) {
      expect(mesh.geometry.getAttribute('position')).toBe(
        lod.geometryLodSourceOf(mesh.geometry).getAttribute('position'),
      );
    }
  });

  it('a body built directly (a preview, a portrait) draws level 0', async () => {
    const { lod, h } = await world();
    const preview = new h.CharacterVisual('player_paladin', 0xffffff, 0);
    preview.setWocEquipment(FULL_KIT_EQUIPPED, false);
    const m = meshesOf(preview);
    expect(levels(lod, [...m.body, ...m.parts, ...m.pieces])).toEqual(['lod0']);
  });

  it('the low preset draws mid for everyone, the local player included', async () => {
    const { lod, body } = await world({ lowTier: true });
    for (const local of [true, false]) {
      const m = meshesOf(body(local));
      const all = [...m.body, ...m.parts, ...m.pieces];
      expect(
        levels(
          lod,
          all.filter((mesh) => !morphed(mesh)),
        ),
        `local ${local}`,
      ).toEqual(['mid']);
      expect(levels(lod, all.filter(morphed)), `local ${local} sliders`).toEqual(['lod0']);
    }
  });
});

describe('the merged head and armor draw the level their pieces draw', () => {
  it('share one buffer per look and kit, each body drawing its own level of it', async () => {
    const { h, lod, body, settle } = await world();
    const crowd = body(false);
    const local = body(true);
    settle([crowd, local]);
    const c = meshesOf(crowd);
    const l = meshesOf(local);
    // a head and a kit of several materials: a merged head and merged armor on each
    expect(c.merged.length).toBeGreaterThan(1);
    expect(c.merged.length).toBe(l.merged.length);
    expect(levels(lod, c.merged)).toEqual(['mid']);
    expect(levels(lod, l.merged)).toEqual(['lod0']);
    // one cache entry per merged geometry, leased by both bodies
    expect(h.headMergeCache.size).toBe(1);
    for (const entry of [...h.headMergeCache.values(), ...h.armorMergeCache.values()]) {
      expect(entry.refs).toBe(2);
    }
    const sources = c.merged.map((m) => lod.geometryLodSourceOf(m.geometry));
    expect(sources).toEqual(l.merged.map((m) => m.geometry));
    // never one mesh for two levels
    for (const mesh of c.merged) expect(l.merged).not.toContain(mesh);
  });

  it('a merged mesh at mid draws exactly the mid triangles of the pieces it folds', async () => {
    const { lod, body, settle } = await world();
    const crowd = body(false);
    settle([crowd]);
    const m = meshesOf(crowd);
    // the pieces a stand-in folds are out of the render lists
    const folded = [...m.pieces, ...m.parts].filter((mesh) => mesh.layers.mask === 0);
    expect(folded.length).toBeGreaterThan(2);
    const mergedTris = m.merged.reduce((n, mesh) => n + tris(mesh), 0);
    // the stand-ins draw the MID of every piece they fold, the slider pieces included
    const midTris = (mesh: THREE.Mesh): number => {
      const mid = lod.geometryLodVariant(mesh.geometry, 'mid');
      return (mid.index?.count ?? mid.getAttribute('position').count) / 3;
    };
    expect(mergedTris).toBe(folded.reduce((n, mesh) => n + midTris(mesh), 0));
    // while folded, the plain pieces drew their mid and the slider pieces their level 0
    expect(
      levels(
        lod,
        folded.filter((mesh) => !morphed(mesh)),
      ),
    ).toEqual(['mid']);
    expect(levels(lod, folded.filter(morphed))).toEqual(['lod0']);
    expect(mergedTris).toBeLessThan(folded.reduce((n, mesh) => n + tris(mesh), 0));
  });
});

describe('the far bake freezes the far levels', () => {
  /** The triangles of a body's far mesh, once minted and linked. */
  async function farTris(lods: boolean): Promise<number> {
    const { h } = await world({ lods });
    const v = h.farVisual({ ...h.DEFAULT_APPEARANCE }, FULL_KIT_EQUIPPED);
    const far = v.root.getObjectByName('character_far_mesh') as THREE.Mesh | undefined;
    if (!far) throw new Error('no far mesh');
    const count = (far.geometry.index?.count ?? 0) / 3;
    releaseWocVisualHarness();
    return count;
  }

  it('a quarter of the full triangles: every piece baked at its far level', async () => {
    const without = await farTris(false);
    const withLods = await farTris(true);
    expect(without).toBeGreaterThan(0);
    // every fixture box has a multiple of four triangles, its far level exactly a quarter
    expect(withLods * 4).toBe(without);
  });
});

describe('?woclod=off, the before arm of a capture', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('draws level 0 everywhere, the crowd and the far bake included', async () => {
    // render_dev_flags.ts reads the location once, when the harness imports it fresh
    vi.stubGlobal('location', { search: '?woclod=off' });
    const { h, lod, body } = await world();
    const m = meshesOf(body(false));
    expect(levels(lod, [...m.body, ...m.parts, ...m.pieces])).toEqual(['lod0']);
    const v = h.farVisual({ ...h.DEFAULT_APPEARANCE }, FULL_KIT_EQUIPPED);
    const far = v.root.getObjectByName('character_far_mesh') as THREE.Mesh | undefined;
    // the same bake a file without levels makes (the quarter case above, measured whole)
    expect(far?.geometry.index?.count).toBeGreaterThan(0);
    const farOf = (mesh: THREE.Mesh) => (mesh.geometry.index?.count ?? 0) / 3;
    vi.unstubAllGlobals();
    releaseWocVisualHarness();
    const plain = await world({ lods: false });
    const w = plain.h.farVisual({ ...plain.h.DEFAULT_APPEARANCE }, FULL_KIT_EQUIPPED);
    const wholeFar = w.root.getObjectByName('character_far_mesh') as THREE.Mesh;
    expect(farOf(far as THREE.Mesh)).toBe(farOf(wholeFar));
  });
});
