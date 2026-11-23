// @vitest-environment happy-dom
// A WOC body in the WORLD and its head files, through the real factory
// (src/render/characters/index.ts createCharacterVisual) and the real CharacterVisual,
// with only asset IO stubbed (tests/helpers/woc_visual_harness.ts):
//   - it never waits on a hairstyle or a beard file (the head half of B1 in the PR 4360
//     review: a player whose files stream had no body, no nameplate, no click target).
//     It is built with whatever pieces of its look are resident and draws at once, the
//     bare head standing in; the missing piece joins hidden until linked; a failed file
//     never hides, beheads or delays it, and is asked for again after its cooldown;
//   - it hangs only what its look draws (S2 of the same review): the rest of the head
//     library never enters its scene graph, its material passes or its tint clones;
//   - a body built directly (a preview, a portrait) keeps the whole-look rule.
// The rules themselves are pinned pure in tests/woc_head_stream_core.test.ts and on the
// dressing in tests/woc_head_dressing.test.ts; the far bake's side (one bake, never a
// bald one) in tests/woc_far_lod_head.test.ts.
import type * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entity } from '../src/sim/types';
import {
  BASE,
  BOXED,
  DEFAULT_MESHES,
  HAIR_QUIFF,
  IDLE,
  KEY,
  NOSE,
  player,
  releaseWocVisualHarness,
  SWEPT,
  type WocHarnessVisual,
  type WocVisualHarness,
  type WocVisualHarnessOptions,
  wocVisualHarness,
} from './helpers/woc_visual_harness';

type Visual = WocHarnessVisual;

const DIR = 'models/chars/players/woc';
const CORE = `${DIR}/head_type_a_core.glb`;
const QUIFF = `${DIR}/head_type_a_hair_quiff.glb`;
const SWEPT_FILE = `${DIR}/head_type_a_hair_swept.glb`;
const BEARDS = `${DIR}/head_type_a_beards.glb`;
/** The wrapper a head file's pieces ride (woc_head_packs.ts): its gate target's name. */
const wrapperOf = (url: string): string =>
  `woc_head_${url.slice(url.lastIndexOf('/') + 1).replace(/\.glb$/, '')}_head`;

/** The harness, and bodies built the way the world view builds them: the real factory,
 *  THEN the renderer's compile gate (renderer.ts createCharacterVisualWithRetry), then
 *  the first worn-set diff. */
async function world(opts: WocVisualHarnessOptions = {}) {
  const h = await wocVisualHarness(opts);
  const index = await import('../src/render/characters/index');
  const body = (e: Entity, build?: { fetchStreamed?: boolean }): Visual => {
    const v = index.createCharacterVisual(e, undefined, build);
    // a head file on the wire is never a reason to build nothing
    if (!v) throw new Error('the world body did not build');
    v.setFarBakeGate((target, settle) => h.gates.push({ target, settle }));
    v.setWocEquipment({}, false);
    return v;
  };
  const frame = (v: Visual): void => {
    h.nextFrame(16);
    v.update(0.016, IDLE, true);
  };
  /** Settle every gate ask in flight (the links landed). */
  const link = (): void => {
    for (const gate of h.gates.splice(0)) gate.settle(() => true);
  };
  return { h, body, frame, link };
}

const wrapOf = (v: Visual): THREE.Object3D => {
  const wrap = v.root.getObjectByName('character_model_wrap');
  if (!wrap) throw new Error('the body has no rig');
  return wrap;
};
const drawn = (v: Visual, name: string): boolean => {
  for (let at = v.root.getObjectByName(name) ?? null; at; at = at.parent) {
    if (!at.visible) return false;
    if (at === v.root) return true;
  }
  return false;
};
/** Every head piece MESH in a body's scene graph (the tag the hang stamps). */
function headMeshes(v: Visual): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  v.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && o.userData.wocHeadPart && !o.userData.wocHeadMerged) out.push(mesh);
  });
  return out;
}
/** The gate asks in flight for head PIECES (a wrapper of a head file's): a merged
 *  stand-in's own gate is another matter (tests/woc_merge_visual.test.ts). */
const asked = (h: WocVisualHarness): string[] =>
  h.gates.map((g) => g.target.name).filter((name) => name.startsWith('woc_head_head_type_'));

afterEach(() => releaseWocVisualHarness());

describe('a world body never waits on a hairstyle or a beard file', () => {
  it('builds at once with its hairstyle on the wire: the bare head stands in, the hair joins hidden until linked', async () => {
    const { h, body, frame, link } = await world({ held: [QUIFF] });
    // base, library, core and beards are resident; its hairstyle is still on the wire
    const v = body(player({ ...h.DEFAULT_APPEARANCE, headHair: 'quiff' }));
    // the whole body draws from its first frame: head, face and beard, no hairstyle yet
    expect(wrapOf(v).visible).toBe(true);
    expect(v.wocHeadLook?.look.hair).toBe('quiff');
    expect(v.wocHeadDrawnLook?.hair).toBe('bald');
    expect(drawn(v, BASE)).toBe(true);
    expect(drawn(v, NOSE)).toBe(true);
    expect(drawn(v, BOXED)).toBe(true);
    expect(v.root.getObjectByName(HAIR_QUIFF)).toBeUndefined();
    // born with its head: nothing of it waits behind a gate
    frame(v);
    expect(asked(h)).toEqual([]);
    expect(wrapOf(v).visible).toBe(true);
    // the file lands: the next frame hangs it HIDDEN behind the gate, the bare head drawn
    h.releases.get(QUIFF)?.();
    await vi.waitFor(() => expect(h.heads.wocHeadFileResident(QUIFF)).toBe(true));
    frame(v);
    expect(asked(h)).toEqual([wrapperOf(QUIFF)]);
    expect(h.gates.find((g) => g.target.name === wrapperOf(QUIFF))?.target.visible).toBe(false);
    expect(v.root.getObjectByName(HAIR_QUIFF)).toBeDefined();
    expect(drawn(v, HAIR_QUIFF)).toBe(false);
    expect(v.wocHeadDrawnLook?.hair).toBe('bald');
    expect(wrapOf(v).visible).toBe(true);
    // linked: it joins, with no frame in which the body was hidden
    link();
    expect(drawn(v, HAIR_QUIFF)).toBe(true);
    expect(v.wocHeadDrawnLook?.hair).toBe('quiff');
    expect(wrapOf(v).visible).toBe(true);
    v.dispose();
  });

  it('a hairstyle whose fetch FAILED never hides, beheads or delays the body, and is asked for again after its cooldown', async () => {
    const { h, body, frame } = await world({ failed: [QUIFF] });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const loader = await import('../src/render/assets/loader');
    const fetches = (): number =>
      vi.mocked(loader.loadGltf).mock.calls.filter(([url]) => url === QUIFF).length;
    const v = body(player({ ...h.DEFAULT_APPEARANCE, headHair: 'quiff' }));
    // built and drawn on the frame it was asked for, the fetch still in flight
    expect(wrapOf(v).visible).toBe(true);
    expect(drawn(v, BASE)).toBe(true);
    expect(fetches()).toBe(1);
    await vi.waitFor(() => expect(h.heads.wocHeadFileState(QUIFF)).toBe('failed'));
    for (let i = 0; i < 5; i++) frame(v);
    // still the whole body and its bare head, and no storm of retries inside the cooldown
    expect(wrapOf(v).visible).toBe(true);
    expect(drawn(v, BASE)).toBe(true);
    expect(drawn(v, BOXED)).toBe(true);
    expect(v.wocHeadDrawnLook?.hair).toBe('bald');
    expect(fetches()).toBe(1);
    // past the store's cooldown the head asks again by itself (and is refused again)
    h.nextFrame(8100);
    frame(v);
    expect(fetches()).toBe(2);
    await vi.waitFor(() => expect(h.heads.wocHeadFileState(QUIFF)).toBe('failed'));
    frame(v);
    expect(wrapOf(v).visible).toBe(true);
    expect(drawn(v, BASE)).toBe(true);
    v.dispose();
  });

  it('a beard whose fetch failed: clean shaven meanwhile, hair and all the rest drawn', async () => {
    const { h, body, frame } = await world({ failed: [BEARDS] });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const v = body(player({ ...h.DEFAULT_APPEARANCE }));
    await vi.waitFor(() => expect(h.heads.wocHeadFileState(BEARDS)).toBe('failed'));
    frame(v);
    expect(wrapOf(v).visible).toBe(true);
    expect(drawn(v, BASE)).toBe(true);
    expect(drawn(v, SWEPT)).toBe(true);
    expect(v.root.getObjectByName(BOXED)).toBeUndefined();
    expect(v.wocHeadDrawnLook?.beard).toBe('none');
    expect(v.wocHeadDrawnLook?.hair).toBe('swept');
    v.dispose();
  });

  it('not even a core still on the wire hides the body: built and drawn without a head, which goes live bare when the core lands', async () => {
    // World entry awaits both cores (woc_entry_preload.ts), so a world never meets this; a
    // host that built a world without that gate still gets a body, never nothing.
    const { h, body, frame, link } = await world({ held: [CORE, SWEPT_FILE] });
    const e = player({ ...h.DEFAULT_APPEARANCE });
    // the factory builds on the first ask (the helper throws on a null build)
    const v = body(e);
    expect(v.wocHeadLook).toBeNull();
    expect(wrapOf(v).visible).toBe(true);
    expect(drawn(v, BASE)).toBe(false);
    for (let i = 0; i < 3; i++) frame(v);
    expect(wrapOf(v).visible).toBe(true);
    // the core lands, the hairstyle still on the wire: the face pieces hang in one wrapper,
    // hidden behind the gate, then the head is live on its bare stand-in
    h.releases.get(CORE)?.();
    await vi.waitFor(() => expect(h.heads.wocHeadFileResident(CORE)).toBe(true));
    frame(v);
    expect(asked(h)).toEqual([wrapperOf(CORE)]);
    link();
    expect(v.wocHeadDrawnLook?.hair).toBe('bald');
    for (const name of [BASE, NOSE, BOXED]) expect(drawn(v, name), name).toBe(true);
    v.dispose();
  });

  it('a core whose fetch FAILED never hides the body: built and drawn without a head, which goes live when a retry lands', async () => {
    const { h, body, frame, link } = await world({ held: [CORE] });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // the state a dead request leaves (the store's own seam: no loader round trip)
    h.heads.failWocHeadFileForTest(CORE);
    const v = body(player({ ...h.DEFAULT_APPEARANCE }));
    // no head to draw, and nothing of a head floats on the neck, but the body is there
    expect(v.wocHeadLook).toBeNull();
    expect(wrapOf(v).visible).toBe(true);
    expect(drawn(v, SWEPT)).toBe(false);
    expect(drawn(v, BOXED)).toBe(false);
    for (let i = 0; i < 3; i++) frame(v);
    expect(wrapOf(v).visible).toBe(true);
    expect(v.wocHeadLook).toBeNull();
    // past the cooldown the head asks again by itself; this time it lands
    h.nextFrame(8100);
    frame(v);
    await vi.waitFor(() => expect(h.releases.has(CORE)).toBe(true));
    h.releases.get(CORE)?.();
    await vi.waitFor(() => expect(h.heads.wocHeadFileResident(CORE)).toBe(true));
    frame(v);
    // every face piece hung in one wrapper, hidden behind the gate, then live
    expect(asked(h)).toEqual([wrapperOf(CORE)]);
    expect(v.wocHeadLook).toBeNull();
    link();
    expect(v.wocHeadLook?.look.hair).toBe('swept');
    for (const name of [BASE, NOSE, SWEPT, BOXED]) expect(drawn(v, name), name).toBe(true);
    v.dispose();
  });

  it("with the renderer's work queue behind them, a crowd that waited for one hairstyle hangs it a unit at a time, never all in the frame it lands", async () => {
    const { h, frame, link } = await world({ held: [QUIFF] });
    const index = await import('../src/render/characters/index');
    const units: { work: () => unknown; label?: string }[] = [];
    const queue = {
      run: (work: () => unknown, _priority?: number, label?: string) => {
        units.push({ work, label });
        return Promise.resolve(undefined as never);
      },
    };
    const hangs = (): string[] =>
      units.map((u) => u.label ?? '').filter((label) => label.startsWith('woc-head-hang'));
    // three wearers of the same hairstyle arrive while its file is on the wire
    const crowd = [0, 1, 2].map((i) => {
      const v = index.createCharacterVisual(
        player({ ...h.DEFAULT_APPEARANCE, headHair: 'quiff', headShape: { chinWidth: i / 4 } }),
      );
      if (!v) throw new Error('the world body did not build');
      v.setFarBakeGate((target, settle) => h.gates.push({ target, settle }), queue);
      v.setWocEquipment({}, false);
      frame(v);
      expect(v.wocHeadDrawnLook?.hair).toBe('bald');
      return v;
    });
    expect(hangs()).toEqual([]);
    h.releases.get(QUIFF)?.();
    await vi.waitFor(() => expect(h.heads.wocHeadFileResident(QUIFF)).toBe(true));
    // the frame it lands: every body asks the queue, and none hangs anything itself
    for (const v of crowd) frame(v);
    expect(hangs()).toEqual(['woc-head-hang:a', 'woc-head-hang:a', 'woc-head-hang:a']);
    for (const v of crowd) expect(v.root.getObjectByName(HAIR_QUIFF)).toBeUndefined();
    expect(asked(h)).toEqual([]);
    // the queue's budget gives one unit its turn: one body hangs, behind the gate
    const pending = units.filter((u) => u.label?.startsWith('woc-head-hang'));
    pending[0].work();
    expect(crowd.map((v) => v.root.getObjectByName(HAIR_QUIFF) !== undefined)).toEqual([
      true,
      false,
      false,
    ]);
    expect(asked(h)).toEqual([wrapperOf(QUIFF)]);
    expect(drawn(crowd[0], HAIR_QUIFF)).toBe(false);
    // the rest in later frames, then the links: every head whole
    pending[1].work();
    pending[2].work();
    link();
    for (const v of crowd) {
      frame(v);
      expect(drawn(v, HAIR_QUIFF)).toBe(true);
      expect(v.wocHeadDrawnLook?.hair).toBe('quiff');
      v.dispose();
    }
  });

  it('a mob on a WOC body is born in the default look, live on its first frame with no gate', async () => {
    const { h, body, frame } = await world();
    const mob = { ...player({}), kind: 'mob', modularAppearance: undefined } as unknown as Entity;
    vi.spyOn(await import('../src/render/characters/manifest'), 'visualKeyFor').mockReturnValue(
      KEY,
    );
    const v = body(mob);
    expect(
      headMeshes(v)
        .map((m) => m.name)
        .sort(),
    ).toEqual([...DEFAULT_MESHES].sort());
    expect(wrapOf(v).visible).toBe(true);
    frame(v);
    expect(v.wocHeadLook?.look.hair).toBe('swept');
    expect(drawn(v, SWEPT)).toBe(true);
    expect(asked(h)).toEqual([]);
    v.dispose();
  });

  it('a mob whose default hairstyle is on the wire stands in bare too', async () => {
    const { h, body, frame, link } = await world({ held: [SWEPT_FILE] });
    const mob = { ...player({}), kind: 'mob', modularAppearance: undefined } as unknown as Entity;
    vi.spyOn(await import('../src/render/characters/manifest'), 'visualKeyFor').mockReturnValue(
      KEY,
    );
    const v = body(mob);
    frame(v);
    expect(wrapOf(v).visible).toBe(true);
    expect(v.wocHeadDrawnLook?.hair).toBe('bald');
    h.releases.get(SWEPT_FILE)?.();
    await vi.waitFor(() => expect(h.heads.wocHeadFileResident(SWEPT_FILE)).toBe(true));
    frame(v);
    link();
    expect(drawn(v, SWEPT)).toBe(true);
    v.dispose();
  });
});

describe('a world body hangs only what its look draws', () => {
  /** The host's own per-mesh records (private on CharacterVisual): what its material
   *  sweeps walk and its shadow switch flips. */
  interface HostRecords {
    readonly originalMaterials: Map<THREE.Mesh, unknown>;
    readonly casters: THREE.Mesh[];
    readonly wocHead: { readonly tintClones: number };
  }

  it('the rest of the library is not in its scene graph, its material records or its tint clones', async () => {
    // the whole library is resident, as it is once a session has seen a town
    const { h, body, frame } = await world();
    const v = body(player({ ...h.DEFAULT_APPEARANCE }));
    frame(v);
    // exactly the meshes the look draws: of a library the body used to hang whole
    const meshes = headMeshes(v);
    expect(meshes.map((m) => m.name).sort()).toEqual([...DEFAULT_MESHES].sort());
    expect(meshes.every((m) => drawn(v, m.name))).toBe(true);
    // nothing the look does not draw: another nose, another beard of the SAME files
    expect(v.root.getObjectByName('WocHead_A_nose_broad')).toBeUndefined();
    expect(v.root.getObjectByName('WocHead_A_beard_goatee')).toBeUndefined();
    expect(v.root.getObjectByName(HAIR_QUIFF)).toBeUndefined();
    // one wrapper per file of its look on the head bone, three of the library's thirteen
    const head = v.root.getObjectByName('head');
    expect(
      head?.children
        .map((c) => c.name)
        .filter((name) => name.startsWith('woc_head_head_type_'))
        .sort(),
    ).toEqual([CORE, SWEPT_FILE, BEARDS].map(wrapperOf).sort());
    // the host's material passes and shadow switch walk what is drawn, never the library
    const records = v as unknown as HostRecords;
    const recorded = [...records.originalMaterials.keys()].filter(
      (m) => m.userData.wocHeadPart && !m.userData.wocHeadMerged,
    );
    expect(recorded.map((m) => m.name).sort()).toEqual([...DEFAULT_MESHES].sort());
    // a tint clone per material that draws: the body's, and the look's (its two eyeliners
    // share one untinted material)
    expect(records.wocHead.tintClones).toBe(1 + DEFAULT_MESHES.length - 2);
    v.dispose();
  });

  it('a look change on a live body links the new piece hidden, then takes the old one off the body and out of the records', async () => {
    const { h, body, frame, link } = await world();
    const v = body(player({ ...h.DEFAULT_APPEARANCE }));
    frame(v);
    const records = v as unknown as HostRecords;
    const clones = records.wocHead.tintClones;
    const old = v.root.getObjectByName(NOSE) as THREE.Mesh;
    // the player redesigns a face piece: hung in that call (its file is resident), hidden
    // behind the gate like anything attached to a body already drawn, the old one held
    v.setWocHeadLook({ ...h.DEFAULT_APPEARANCE, headNose: 'broad' });
    const broad = v.root.getObjectByName('WocHead_A_nose_broad') as THREE.Mesh;
    expect(broad).toBeDefined();
    expect(asked(h)).toEqual([wrapperOf(CORE)]);
    expect(h.gates.find((g) => g.target.name === wrapperOf(CORE))?.target.children).toEqual([
      broad,
    ]);
    expect(drawn(v, 'WocHead_A_nose_broad')).toBe(false);
    expect(drawn(v, NOSE)).toBe(true);
    link();
    expect(drawn(v, 'WocHead_A_nose_broad')).toBe(true);
    // the nose it replaced: out of the graph, the material records and the shadow casters
    expect(old.parent).toBeNull();
    expect(records.originalMaterials.has(old)).toBe(false);
    expect(records.casters).not.toContain(old);
    expect(records.originalMaterials.has(broad)).toBe(true);
    // one clone freed, one minted: the count follows the look
    expect(records.wocHead.tintClones).toBe(clones);
    expect(headMeshes(v)).toHaveLength(DEFAULT_MESHES.length);
    frame(v);
    v.dispose();
  });

  it('a helm hides the hair without taking it off the body: it comes back with no hang and no gate', async () => {
    const { h, body, frame } = await world();
    const v = body(player({ ...h.DEFAULT_APPEARANCE }));
    frame(v);
    const hair = v.root.getObjectByName(SWEPT);
    v.setWocEquipment({ helmet: 'some-helm' }, false);
    frame(v);
    expect(drawn(v, SWEPT)).toBe(false);
    expect(v.root.getObjectByName(SWEPT)).toBe(hair);
    v.setWocEquipment({}, false);
    expect(drawn(v, SWEPT)).toBe(true);
    expect(asked(h)).toEqual([]);
    v.dispose();
  });
});

describe('a body built directly keeps the whole-look rule', () => {
  it('a preview or a portrait never draws a bare head: nothing draws until the hairstyle is in', async () => {
    const h = await wocVisualHarness({ held: [QUIFF] });
    // built directly, with no opt-in: the creation preview, a portrait's capture rig
    // (bare-headed: the fixture kit's helm would hide the hair under test)
    const v = new h.CharacterVisual(KEY, 0xffffff, 0);
    v.setWocEquipment({}, false);
    v.setWocHeadLook({ ...h.DEFAULT_APPEARANCE, headHair: 'quiff' });
    v.update(0.05, IDLE, true);
    expect(v.wocHeadLook).toBeNull();
    expect(wrapOf(v).visible).toBe(false);
    h.releases.get(QUIFF)?.();
    await vi.waitFor(() => expect(h.heads.wocHeadFileResident(QUIFF)).toBe(true));
    v.update(0.05, IDLE, true);
    v.update(0.05, IDLE, true);
    // whole at once: never a frame of the bare head
    expect(v.wocHeadLook?.look.hair).toBe('quiff');
    expect(v.wocHeadDrawnLook?.hair).toBe('quiff');
    expect(wrapOf(v).visible).toBe(true);
    expect(drawn(v, HAIR_QUIFF)).toBe(true);
    v.dispose();
  });

  it('with every file of its look resident (what a portrait waits for) it is whole from its look hand-off, before any frame', async () => {
    const h = await wocVisualHarness();
    const app = { ...h.DEFAULT_APPEARANCE, headHair: 'quiff', headNose: 'broad' };
    const v = new h.CharacterVisual(KEY, 0xffffff, 0);
    // the look is handed in right after the build (portrait.ts buildVisual): its pieces
    // hang on the spot, so the texture sweep and the link that follow see every one
    v.setWocHeadLook(app);
    expect(v.wocHeadLook?.look.hair).toBe('quiff');
    expect(v.wocHeadDrawnLook).toEqual(v.wocHeadLook?.look);
    for (const name of [BASE, HAIR_QUIFF, 'WocHead_A_nose_broad', BOXED]) {
      expect(v.root.getObjectByName(name), name).toBeDefined();
    }
    // ...and the default look's pieces it was born with are off it already
    expect(v.root.getObjectByName(SWEPT)).toBeUndefined();
    expect(v.root.getObjectByName(NOSE)).toBeUndefined();
    v.dispose();
  });
});
