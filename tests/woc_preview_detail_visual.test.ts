// @vitest-environment happy-dom
// A preview body's armor detail through the REAL CharacterVisual (its setWocArmorDetail seam
// and the build options of src/render/characters/preview_armor_detail_core.ts), over the shared
// fixture body whose every geometry ships coarser levels (tests/helpers/woc_visual_harness.ts
// `lods`). What a preview that draws the crowd's ARMOR detail must keep: the full geometry
// level on its body, its armor parts and its head, the body it was built as when its detail
// changes, and the file it draws until the replacement's own programs link.
import type * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FULL_KIT_EQUIPPED,
  IDLE,
  KEY,
  releaseWocVisualHarness,
  type WocHarnessVisual,
  wocVisualHarness,
} from './helpers/woc_visual_harness';

/** What the store logged as an error during a case: only the fixture's own notice is
 *  expected (its top file carries no top level that fits its plain maps, so the high pack
 *  draws the medium maps, which is all these cases need of one). */
let logged: string[] = [];

afterEach(() => {
  const unexpected = logged.filter((message) => !message.includes('no top level fits'));
  releaseWocVisualHarness();
  expect(unexpected).toEqual([]);
});

async function world() {
  logged = [];
  const h = await wocVisualHarness({ kit: 'full', lods: true });
  const lod = await import('../src/render/assets/geometry_lod');
  const gfx = await import('../src/render/gfx');
  // a desktop on the high preset: the one profile where the two details draw different files
  gfx.activateGfxProfile({
    ...gfx.getActiveGfxProfile(),
    settings: gfx.gfxInternalsForTest.settingsFor('high', { search: '?gfx=high' }),
  });
  vi.spyOn(console, 'error').mockImplementation((message: unknown) => {
    logged.push(String(message));
  });
  const rule = await import('../src/render/characters/preview_armor_detail_core');
  const packs = await import('../src/render/characters/woc_armor_packs');
  const { wocArmorPackUrl } = await import('../src/render/characters/woc_armor_core');
  const medium = wocArmorPackUrl('male', 'fixture', 'medium');
  const high = wocArmorPackUrl('male', 'fixture', 'high');
  /** A preview body at an armor detail, built as CharacterPreview.setVisualKey builds it:
   *  the rule's own options, its compile gate in, dressed and wearing a look. */
  const preview = (detail: 'full' | 'crowd'): WocHarnessVisual => {
    const v = new h.CharacterVisual(
      KEY,
      0xffffff,
      0,
      null,
      null,
      null,
      null,
      rule.previewArmorBuildOptions(gfx.GFX, detail),
    );
    v.setFarBakeGate((target, settle) => h.gates.push({ target, settle }));
    v.setWocEquipment(FULL_KIT_EQUIPPED, false);
    v.setWocHeadLook({ ...h.DEFAULT_APPEARANCE });
    return v;
  };
  /** Every link the body asked of its compile gate settles. */
  const link = (): void => {
    for (const g of h.gates.splice(0)) g.settle(() => true);
  };
  /** Frames of the body's own loop, each after whatever was fetched has landed. `linked:
   *  false` leaves the compile gate holding what those frames asked of it. */
  const frames = async (v: WocHarnessVisual, count: number, linked = true): Promise<void> => {
    for (let i = 0; i < count; i++) {
      await new Promise<void>((done) => setTimeout(done, 0));
      h.nextFrame(16);
      v.update(0.016, IDLE, true);
      if (linked) link();
    }
  };
  /** Frames until every file landed, attached and linked. */
  const settle = (v: WocHarnessVisual): Promise<void> => frames(v, 6);
  /** The armor files hung on a body, and whether each DRAWS: every node it hangs revealed
   *  (a replacement still linking hangs hidden) and its worn parts shown (a file revealed
   *  before the body was dressed in it would draw nothing). */
  const hung = (v: WocHarnessVisual): Record<string, boolean> => {
    const out: Record<string, boolean> = {};
    v.root.traverse((o) => {
      const url = o.userData[packs.WOC_ARMOR_CONTAINER];
      if (typeof url !== 'string') return;
      const pieces = packs.wocArmorPieces(o);
      let shown = 0;
      for (const piece of pieces) {
        piece.traverse((part) => {
          if ((part as THREE.Mesh).isMesh && part.visible) shown++;
        });
      }
      out[url] = pieces.every((piece) => piece.visible) && shown > 0;
    });
    return out;
  };
  /** Every mesh of a body's rig, by what it is (the head's flag first: a head piece is
   *  adopted through the armor's own seam). */
  const meshes = (v: WocHarnessVisual) => {
    const rig = v.root.getObjectByName('character_model_wrap');
    if (!rig) throw new Error('the body has no rig');
    const out = { body: [] as THREE.Mesh[], parts: [] as THREE.Mesh[], pieces: [] as THREE.Mesh[] };
    rig.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (o.userData.wocHeadPart) out.pieces.push(mesh);
      else if (o.userData.wocArmorPart) out.parts.push(mesh);
      else out.body.push(mesh);
    });
    return out;
  };
  const all = (v: WocHarnessVisual): THREE.Mesh[] => Object.values(meshes(v)).flat();
  const levels = (list: readonly THREE.Mesh[]): string[] => [
    ...new Set(list.map((m) => lod.geometryLodLevelOf(m.geometry))),
  ];
  return {
    h,
    gfx,
    lod,
    packs,
    medium,
    high,
    preview,
    frames,
    link,
    settle,
    hung,
    meshes,
    all,
    levels,
  };
}

describe('a preview body at the crowd armor detail', () => {
  it('draws the medium file over the FULL geometry level: only the textures step down', async () => {
    const w = await world();
    const v = w.preview('crowd');
    await w.settle(v);
    expect(w.hung(v)).toEqual({ [w.medium]: true });
    // the body, every armor part and every head piece at level 0, as a body built directly
    for (const [what, list] of Object.entries(w.meshes(v))) {
      expect(list.length, what).toBeGreaterThan(0);
      expect(w.levels(list), what).toEqual(['lod0']);
    }
    // ...where a crowd body of the WORLD draws mid: the same detail without the rule's level
    const crowd = new w.h.CharacterVisual(KEY, 0xffffff, 0, null, null, null, null, {
      wocArmorDetail: 'crowd',
    });
    crowd.setWocEquipment(FULL_KIT_EQUIPPED, false);
    await w.settle(crowd);
    expect(w.levels(w.meshes(crowd).body)).toEqual(['mid']);
    expect(w.levels(w.meshes(crowd).parts)).toEqual(['mid']);
    v.dispose();
    crowd.dispose();
  });

  it('is the body a full detail preview is, but for the file its armor draws', async () => {
    const w = await world();
    const crowd = w.preview('crowd');
    const full = w.preview('full');
    await w.settle(crowd);
    await w.settle(full);
    expect(w.hung(crowd)).toEqual({ [w.medium]: true });
    expect(w.hung(full)).toEqual({ [w.high]: true });
    const names = (v: WocHarnessVisual) =>
      w
        .all(v)
        .filter((m) => m.visible)
        .map((m) => m.name)
        .sort();
    expect(names(crowd).length).toBeGreaterThan(0);
    expect(names(crowd)).toEqual(names(full));
    expect(w.levels(w.all(full))).toEqual(['lod0']);
    crowd.dispose();
    full.dispose();
  });
});

describe('CharacterVisual.setWocArmorDetail', () => {
  it('steps a live body up without rebuilding it, the medium file drawing until the high pack links', async () => {
    const w = await world();
    const v = w.preview('crowd');
    await w.settle(v);
    const bodyMesh = v.root.getObjectByName('Character_Body');
    expect(bodyMesh).toBeDefined();

    v.setWocArmorDetail('full');
    // from its next frames: the top file lands and attaches behind the gate, and until
    // that settles the medium file is the one that draws
    await w.frames(v, 3, false);
    expect(w.hung(v)).toEqual({ [w.medium]: true, [w.high]: false });
    // linked: the high pack draws on that very step, dressed, before any other frame
    w.link();
    expect(w.hung(v)).toEqual({ [w.high]: true });
    await w.settle(v);
    expect(w.hung(v)).toEqual({ [w.high]: true });
    // the same body, its new parts at the level it was built at
    expect(v.root.getObjectByName('Character_Body')).toBe(bodyMesh);
    expect(w.meshes(v).parts.length).toBeGreaterThan(0);
    expect(w.levels(w.all(v))).toEqual(['lod0']);
    v.dispose();
  });

  it('steps a live body back down the same way, and is a no-op on a repeat', async () => {
    const w = await world();
    const v = w.preview('full');
    await w.settle(v);
    expect(w.hung(v)).toEqual({ [w.high]: true });
    // a repeat asks for nothing: no frame attaches or links anything
    v.setWocArmorDetail('full');
    await w.frames(v, 2, false);
    expect(w.h.gates).toEqual([]);
    expect(w.hung(v)).toEqual({ [w.high]: true });

    // the medium file is in memory under the high pack: its next frame attaches it, hidden
    v.setWocArmorDetail('crowd');
    await w.frames(v, 1, false);
    expect(w.hung(v)).toEqual({ [w.high]: true, [w.medium]: false });
    w.link();
    expect(w.hung(v)).toEqual({ [w.medium]: true });
    await w.settle(v);
    expect(w.hung(v)).toEqual({ [w.medium]: true });
    expect(w.packs.wocArmorPackRefs(w.high)).toBe(0);
    expect(w.levels(w.all(v))).toEqual(['lod0']);
    v.dispose();
  });

  it('takes effect with the dressing that follows it, before any frame', async () => {
    const w = await world();
    const v = w.preview('full');
    await w.settle(v);
    // a stage that changes hands: the detail of what it shows now, then what that wears
    v.setWocArmorDetail('crowd');
    expect(w.hung(v)).toEqual({ [w.high]: true });
    const { helmet: _helm, ...bareHeaded } = FULL_KIT_EQUIPPED;
    v.setWocEquipment(bareHeaded, false);
    expect(w.hung(v)).toEqual({ [w.high]: true, [w.medium]: false });
    w.link();
    expect(w.hung(v)).toEqual({ [w.medium]: true });
    v.dispose();
  });

  it('has nothing to do on a disposed body, or on a rig with no streamed armor', async () => {
    const w = await world();
    const v = w.preview('crowd');
    await w.settle(v);
    v.dispose();
    expect(() => v.setWocArmorDetail('full')).not.toThrow();
    const { VISUALS } = await import('../src/render/characters/manifest');
    const plain = Object.keys(VISUALS).find(
      (key) => key.startsWith('mob_') && !VISUALS[key].wocCharacter && !VISUALS[key].modular,
    );
    if (!plain) throw new Error('no plain rig in the manifest');
    const mob = new w.h.CharacterVisual(plain, 0xffffff, 0);
    expect(() => mob.setWocArmorDetail('crowd')).not.toThrow();
    mob.dispose();
    // neither asked the store for anything: the one high pack is the first body's alone
    expect(w.packs.wocArmorPackRefs(w.high)).toBe(0);
  });
});
