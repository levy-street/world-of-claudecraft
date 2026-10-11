// @vitest-environment happy-dom
//
// The armor detail a character preview draws, through the REAL CharacterPreview (built by its
// own constructor), the real CharacterVisual, the real dressing and the real armor store, over
// every shipped WOC class and both bodies (their real manifests, so the files asked for are the
// shipped ones): the Inspect stage and the creator ask for the crowd's files and never a top
// file, the creator asks for exactly one top file once a class is chosen and lets it go when
// the player flips away, the character sheet and the roster still draw full detail, and the low
// preset and a phone ask for the low file everywhere
// (src/render/characters/preview_armor_detail_core.ts).
//
// Stubbed: the loader (a two-bone body for every file, an armor file landing only when the
// case lands it, so every request is on the log), the preview's WebGL context (nothing here
// looks at pixels) and its compile gate (held until the case settles it, so a swap in flight
// can be looked at).
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterPreview } from '../src/render/characters/preview';
import { WOC_BODY_CLASSES } from '../src/render/characters/woc_parts_core';
import { CLASSES } from '../src/sim/data';
import type { PlayerClass } from '../src/sim/types';
import type { PreviewSubject } from '../src/ui/preview_subject';
import { failWocHeads } from './helpers/woc_streamed';

/** Every class on a WOC body, in both bodies: what "flipping through the creator" stages. */
const WOC_CLASSES = (Object.keys(CLASSES) as PlayerClass[]).filter((cls) =>
  WOC_BODY_CLASSES.has(cls),
);
const BODIES = ['male', 'female'] as const;
type Body = (typeof BODIES)[number];
const EVERY_BODY: readonly (readonly [PlayerClass, Body])[] = WOC_CLASSES.flatMap((cls) =>
  BODIES.map((body) => [cls, body] as const),
);

/** A worn set in every dressable slot (any id dresses a slot with the wearer's own piece). */
const FULL_KIT = {
  helmet: 'any-helm',
  shoulder: 'any-shoulders',
  gloves: 'any-gloves',
  chest: 'any-chest',
  waist: 'any-waist',
  feet: 'any-boots',
} as const;

interface Level {
  data: Uint8Array;
  width: number;
  height: number;
}

function chain(width: number, height: number, levels = 99): Level[] {
  const out: Level[] = [];
  let w = width;
  let h = height;
  while (out.length < levels) {
    out.push({ data: new Uint8Array(Math.max(16, w * h)).fill(w), width: w, height: h });
    if (w === 1 && h === 1) break;
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  return out;
}

function compressed(name: string, levels: Level[]): THREE.CompressedTexture {
  const t = new THREE.CompressedTexture(
    levels as unknown as THREE.CompressedTextureMipmap[],
    levels[0].width,
    levels[0].height,
    THREE.RGBA_ASTC_4x4_Format,
    THREE.UnsignedByteType,
  );
  t.name = name;
  t.needsUpdate = true;
  return t;
}

function rig(scene: THREE.Object3D): { root: THREE.Bone; head: THREE.Bone } {
  const root = new THREE.Bone();
  root.name = 'root';
  const head = new THREE.Bone();
  head.name = 'head';
  head.position.set(0, 2, 0);
  root.add(head);
  scene.add(root);
  return { root, head };
}

/** Every file that is not an armor file: a skinned body on a two-bone rig, ending at the
 *  neck, with one clip (a base file's shape; a clip library, a weapon and a creature read
 *  the same scene). */
function bodyFile() {
  const scene = new THREE.Group();
  const { root, head } = rig(scene);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute(
    'skinIndex',
    new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4),
  );
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const body = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  body.name = 'Character_Body';
  scene.add(body);
  scene.updateMatrixWorld(true);
  body.bind(new THREE.Skeleton([root, head]));
  return { scene, animations: [new THREE.AnimationClip('Idle', 1, [])] };
}

/** A set's low or medium file: every part the set names, rigid on the root bone, on one
 *  material over a half-size map. */
function armorFile(set: string, nodes: readonly string[]) {
  const scene = new THREE.Group();
  const { root } = rig(scene);
  const material = new THREE.MeshStandardMaterial({
    name: `${set} atlas`,
    map: compressed('full_color_atlas', chain(8, 4)),
  });
  for (const name of nodes) {
    const part = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), material);
    part.name = name;
    root.add(part);
  }
  return { scene, animations: [] };
}

/** A set's top file: the top level of its medium file's map, on one degenerate mesh. */
function topFile() {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial({ map: compressed('full_color_atlas', chain(16, 8, 1)) }),
  );
  mesh.name = 'top_levels';
  scene.add(mesh);
  return { scene, animations: [] };
}

/** One request the body made of the preview's compile gate: what it asked to link, and the
 *  settle the case calls when that link is over. */
interface Gate {
  readonly target: THREE.Object3D;
  readonly settle: () => void;
}

/** The previews a case built, destroyed when it ends. */
const stages: CharacterPreview[] = [];

/** The budget of a case that walks every class and body: each stop builds a real body, so
 *  the walk is given room a single build does not need (well under a second each on an
 *  idle machine). */
const WALK_BUDGET_MS = 60_000;

/** `phone`: the same preset on a touch phone (the memory-constrained profile).
 *  `holdFemaleBodies`: the female base and clip library stream until the case lands them
 *  (`landBodies`), as on a slow link. */
async function world(
  tier: 'low' | 'medium' | 'high',
  opts: { phone?: boolean; holdFemaleBodies?: boolean } = {},
) {
  vi.resetModules();
  /** Every armor file asked of the loader, in order. */
  const fetches: string[] = [];
  const pending = new Map<string, (gltf: unknown) => void>();
  const heldBodies: (() => void)[] = [];
  const gates: Gate[] = [];
  vi.doMock('three', async (importOriginal) => {
    const actual = await importOriginal<typeof import('three')>();
    class FakeWebGLRenderer {
      debug = { checkShaderErrors: true };
      shadowMap = { enabled: true };
      setPixelRatio(): void {}
      setSize(): void {}
      render(): void {}
      forceContextLoss(): void {}
      dispose(): void {}
    }
    return { ...actual, WebGLRenderer: FakeWebGLRenderer };
  });
  // this module world's level store: every stub geometry ships coarser levels, as the
  // loader's plugin stores them for a shipped file (mid every other triangle, far every
  // fourth), so which level a body draws can be read off it
  const lod = await import('../src/render/assets/geometry_lod');
  const withLevels = <T extends { scene: THREE.Object3D }>(gltf: T): T => {
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const index = mesh.isMesh ? mesh.geometry.index : null;
      if (!index) return;
      const mid: number[] = [];
      const far: number[] = [];
      for (let t = 0; t < index.count / 3; t++) {
        const tri = [index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2)];
        if (t % 2 === 0) mid.push(...tri);
        if (t % 4 === 0) far.push(...tri);
      }
      mesh.geometry.clearGroups();
      lod.setGeometryLod(mesh.geometry, {
        mid: new THREE.BufferAttribute(new Uint16Array(mid), 1),
        far: new THREE.BufferAttribute(new Uint16Array(far), 1),
      });
    });
    return gltf;
  };
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn((url: string) => {
      if (url.includes('/armor/')) {
        fetches.push(url);
        return new Promise((resolve) => pending.set(url, resolve));
      }
      // no head library here: the bodies draw headless (failWocHeads)
      if (url.includes('head_type_')) return new Promise(() => undefined);
      if (opts.holdFemaleBodies && /woc\/(base|anims)_female\.glb$/.test(url)) {
        return new Promise((resolve) => heldBodies.push(() => resolve(withLevels(bodyFile()))));
      }
      return Promise.resolve(withLevels(bodyFile()));
    }),
    loadHdr: vi.fn(() => new Promise(() => undefined)),
    loadTexture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    loadKtx2Texture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    releaseGltf: vi.fn(),
  }));
  vi.doMock('../src/render/characters/preview_material_gate', () => ({
    previewMaterialGate: () => (target: THREE.Object3D, settle: () => void) => {
      gates.push({ target, settle });
    },
  }));
  // the preview's loop is run a frame at a time by the case (`frame`)
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);

  const gfx = await import('../src/render/gfx');
  const hints = opts.phone ? { maxTouchPoints: 5, coarsePointer: true, narrowViewport: true } : {};
  gfx.activateGfxProfile({
    ...gfx.getActiveGfxProfile(),
    settings: gfx.gfxInternalsForTest.settingsFor(tier, { search: `?gfx=${tier}`, ...hints }),
  });
  // the profile every case below is named for
  expect(gfx.GFX.tier).toBe(tier);
  expect(gfx.GFX.constrainedMemory).toBe(opts.phone === true);
  const { playerVisualKey } = await import('../src/render/characters/manifest');
  const assets = await import('../src/render/characters/assets');
  await assets.charactersReady();
  const heads = await import('../src/render/characters/woc_head_packs');
  failWocHeads(heads);
  const packs = await import('../src/render/characters/woc_armor_packs');
  const core = await import('../src/render/characters/woc_armor_core');
  const catalog = await import('../src/render/characters/woc_armor_catalog');
  const display = await import('../src/render/characters/woc_item_display');
  const modular = await import('../src/render/characters/modular');
  const appearance = await import('../src/render/characters/preview_appearance');
  const subject = await import('../src/ui/preview_subject');
  const { CharacterPreview: Preview } = await import('../src/render/characters/preview');
  const { CharacterVisual } = await import('../src/render/characters/visual');
  let now = 0;
  packs.setWocArmorClockForTest(() => now);

  const keyOf = (cls: PlayerClass, body: Body): string => playerVisualKey(cls, { gender: body });
  // every body's base and clip library resident, as the preview's own retry would land them
  // (but the bodies a case holds back)
  const keys = EVERY_BODY.filter(([, body]) => !(opts.holdFemaleBodies && body === 'female')).map(
    ([cls, body]) => keyOf(cls, body),
  );
  await vi.waitFor(
    () => {
      expect(keys.every((key) => assets.visualAssetsResident(key))).toBe(true);
    },
    { timeout: 10_000 },
  );

  /** A preview as its hosts build one: on a stage with a size, its canvas in the page. */
  const stage = (): CharacterPreview => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 300 });
    Object.defineProperty(container, 'clientHeight', { value: 400 });
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);
    document.body.appendChild(container);
    const preview = new Preview(container, canvas);
    stages.push(preview);
    return preview;
  };

  /** The live body of a preview, and the armor files hung on it: each file's url and
   *  whether it DRAWS, which takes both halves of the dressing: every node it hangs on the
   *  body revealed (a replacement still linking hangs hidden) and its worn parts shown (a
   *  file revealed before the body was dressed in it would draw nothing). */
  const bodyOf = (preview: CharacterPreview) =>
    (preview as unknown as { currentVisual: { root: THREE.Object3D } | null }).currentVisual;
  const hung = (preview: CharacterPreview): Record<string, boolean> => {
    const out: Record<string, boolean> = {};
    bodyOf(preview)?.root.traverse((o) => {
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
  /** The geometry levels a body draws, over every mesh whose file ships levels (the body
   *  and the armor parts). */
  const levelsUnder = (root: THREE.Object3D | undefined): string[] => {
    const out = new Set<string>();
    root?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && lod.geometryLodOf(mesh.geometry)) {
        out.add(lod.geometryLodLevelOf(mesh.geometry));
      }
    });
    return [...out].sort();
  };
  const levels = (preview: CharacterPreview): string[] => levelsUnder(bodyOf(preview)?.root);

  const settle = (): void => {
    for (const gate of gates.splice(0)) gate.settle();
  };
  /** One frame of the preview's own loop (the body's update is where a landed file
   *  attaches). `link: false` leaves the compile gate holding what the frame asked of it. */
  const frame = (preview: CharacterPreview, link = true): void => {
    (preview as unknown as { animateFrame(): void }).animateFrame();
    if (link) settle();
  };
  /** Everything a landing sets off has run (the store settles in promise callbacks). */
  const flush = (): Promise<void> => new Promise((done) => setTimeout(done, 0));
  /** Land armor files (every one asked for and not yet landed when none is named), then
   *  run frames until the stage is still. `link: false` leaves what those frames asked of
   *  the compile gate unsettled. */
  const land = async (
    preview: CharacterPreview,
    urls?: readonly string[],
    link = true,
  ): Promise<void> => {
    for (const url of urls ?? [...pending.keys()]) {
      const parsed = core.parseWocArmorPackUrl(url);
      const resolve = pending.get(url);
      if (!parsed || !resolve) throw new Error(`no armor file is being fetched: ${url}`);
      pending.delete(url);
      const nodes = Object.values(catalog.wocSetItems(parsed.fit, parsed.set)).flatMap(
        (item) => item.nodes,
      );
      resolve(parsed.tier === 'high' ? topFile() : withLevels(armorFile(parsed.set, nodes)));
    }
    await flush();
    for (let i = 0; i < 3; i++) frame(preview, link);
  };
  /** The held body files land; the preview builds what was waiting on them by itself (its
   *  constructor listens for a character file landing). */
  const landBodies = async (preview: CharacterPreview): Promise<void> => {
    for (const release of heldBodies.splice(0)) release();
    await vi.waitFor(() => expect(bodyOf(preview)).not.toBeNull(), { timeout: 10_000 });
  };

  const url = (cls: PlayerClass, body: Body, fileTier: 'low' | 'medium' | 'high') =>
    core.wocArmorPackUrl(body, cls, fileTier);
  const app = (body: Body) => ({ ...modular.DEFAULT_APPEARANCE, gender: body });

  /** The subject the HUD mounts on the Inspect stage for a player (hud.ts
   *  mountInspectPreview), and on the character sheet for the player's own
   *  (mountCharPreview): the same fields, the stage's own framing. */
  const hudSubject = (
    cls: PlayerClass,
    body: Body,
    framing: 'inspect' | 'sheet',
  ): PreviewSubject => ({
    cls,
    skin: 0,
    previewKey: subject.wocPreviewKey(cls, app(body)),
    wocAppearance: app(body),
    look: null,
    mainhand: null,
    offhand: null,
    weaponSkinId: null,
    wornEquipment: FULL_KIT,
    helmHidden: false,
    framing,
  });
  const mount = (
    preview: CharacterPreview,
    cls: PlayerClass,
    body: Body,
    framing: 'inspect' | 'sheet',
  ): void => subject.applyPreviewSubject(preview, hudSubject(cls, body, framing));

  /** Character creation staging a class chip (main.ts previewClassBody): the stored look,
   *  the class kit bare-headed, the class starters in hand. */
  const browse = (preview: CharacterPreview, cls: PlayerClass, body: Body): void =>
    preview.setCreationClass(app(body), { head: null }, cls);

  /** The roster's pick (main.ts showCharselectCharacter). `hands`: what it holds (a
   *  fresh character holds its class starters, as the creator's body does). */
  const roster = (
    preview: CharacterPreview,
    cls: PlayerClass,
    body: Body,
    hands: { mainhandItemId?: string | null; offhandItemId?: string | null } = {},
  ): void =>
    preview.setAppearance(
      appearance.charselectPreviewAppearance({
        class: cls,
        appearance: { gender: body },
        ...hands,
      }),
    );

  return {
    gfx,
    packs,
    core,
    display,
    CharacterVisual,
    fetches,
    stage,
    bodyOf,
    hung,
    levels,
    levelsUnder,
    frame,
    land,
    settle,
    url,
    mount,
    browse,
    roster,
    keyOf,
    app,
    hudSubject,
    apply: subject.applyPreviewSubject,
    landBodies,
    tops: () => fetches.filter((u) => u.endsWith('_top.glb')),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

afterEach(() => {
  for (const preview of stages.splice(0)) preview.destroy();
  document.body.innerHTML = '';
  vi.doUnmock('three');
  vi.doUnmock('../src/render/assets/loader');
  vi.doUnmock('../src/render/characters/preview_material_gate');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('the classes these cases walk', () => {
  it('are every class on a WOC body, in both bodies (never an empty walk)', () => {
    expect(WOC_CLASSES.length).toBeGreaterThan(1);
    expect(EVERY_BODY.length).toBe(WOC_CLASSES.length * 2);
  });
});

describe('the Inspect stage on a High desktop', () => {
  it(
    'asks for the medium file of every class and body it shows, and never a top file',
    async () => {
      const w = await world('high');
      const preview = w.stage();
      for (const [cls, body] of EVERY_BODY) {
        w.mount(preview, cls, body, 'inspect');
        await w.land(preview);
        // what the world already draws that player with: the one medium file, drawing
        expect(w.hung(preview), `${cls}/${body}`).toEqual({ [w.url(cls, body, 'medium')]: true });
        // ...over the full geometry: only the textures are the crowd's
        expect(w.levels(preview), `${cls}/${body}`).toEqual(['lod0']);
      }
      expect(w.tops()).toEqual([]);
      expect([...w.fetches].sort()).toEqual(
        EVERY_BODY.map(([cls, body]) => w.url(cls, body, 'medium')).sort(),
      );
    },
    WALK_BUDGET_MS,
  );

  it('stays the crowd detail whichever way the subject is mounted', async () => {
    const w = await world('high');
    const preview = w.stage();
    // a composed look (the subject's first arm), then the plain class rig (its last): both
    // go through an entry that leaves the creator, and neither may lift the inspect stage
    w.apply(preview, {
      ...w.hudSubject('warlock', 'female', 'inspect'),
      look: { app: w.app('female'), worn: {} },
    });
    await w.land(preview);
    expect(w.hung(preview)).toEqual({ [w.url('warlock', 'female', 'medium')]: true });
    w.apply(preview, { ...w.hudSubject('druid', 'male', 'inspect'), previewKey: undefined });
    await w.land(preview);
    expect(w.hung(preview)).toEqual({ [w.url('druid', 'male', 'medium')]: true });
    expect(w.tops()).toEqual([]);
  });

  it("never asks for the top file of a set only the inspected player wore, back on the player's own sheet", async () => {
    const w = await world('high');
    // one of the peer's items shows another set's piece (woc_item_display.ts: no row
    // ships today, a new helm is one)
    (w.display.WOC_ITEM_DISPLAY as Record<string, { set: string }>)['peer-helm'] = { set: 'mage' };
    const preview = w.stage();
    const own = w.hudSubject('warrior', 'male', 'sheet');
    w.apply(preview, own);
    await w.land(preview);
    const body = w.bodyOf(preview);
    expect(w.tops()).toEqual([w.url('warrior', 'male', 'high')]);

    // a peer of the player's class, body and hands: the turntable keeps its body
    w.apply(preview, {
      ...w.hudSubject('warrior', 'male', 'inspect'),
      wornEquipment: { ...FULL_KIT, helmet: 'peer-helm' },
    });
    await w.land(preview);
    expect(w.bodyOf(preview)).toBe(body);
    expect(w.fetches).toContain(w.url('mage', 'male', 'medium'));

    // back on the sheet, the same body again: it sharpens for the sets the PLAYER wears
    w.apply(preview, own);
    await w.land(preview);
    expect(w.bodyOf(preview)).toBe(body);
    expect(w.hung(preview)).toEqual({ [w.url('warrior', 'male', 'high')]: true });
    expect(w.tops()).toEqual([w.url('warrior', 'male', 'high')]);
  });
});

describe('the creator on a High desktop', () => {
  it(
    'asks only for medium files while every class and both bodies are flipped through',
    async () => {
      const w = await world('high');
      const preview = w.stage();
      for (const [cls, body] of EVERY_BODY) {
        w.browse(preview, cls, body);
        await w.land(preview);
        expect(w.hung(preview), `${cls}/${body}`).toEqual({ [w.url(cls, body, 'medium')]: true });
        expect(w.levels(preview), `${cls}/${body}`).toEqual(['lod0']);
      }
      // ...and again, the way a player goes back and forth: nothing more is asked for
      for (const [cls, body] of EVERY_BODY) {
        w.browse(preview, cls, body);
        w.frame(preview);
      }
      expect(w.tops()).toEqual([]);
      expect([...w.fetches].sort()).toEqual(
        EVERY_BODY.map(([cls, body]) => w.url(cls, body, 'medium')).sort(),
      );
      // the levels read above are real: a body the WORLD builds at the crowd's detail draws
      // the coarser one off the same files
      const crowd = new w.CharacterVisual(
        w.keyOf('mage', 'male'),
        0xffffff,
        0,
        null,
        null,
        null,
        null,
        {
          wocArmorDetail: 'crowd',
        },
      );
      expect(w.levelsUnder(crowd.root)).toEqual(['mid']);
      crowd.dispose();
    },
    WALK_BUDGET_MS,
  );

  it("asks for exactly the chosen class and body's top file, the medium file drawing until it links", async () => {
    const w = await world('high');
    const preview = w.stage();
    const medium = w.url('mage', 'female', 'medium');
    const top = w.url('mage', 'female', 'high');
    w.browse(preview, 'mage', 'female');
    await w.land(preview);
    const body = w.bodyOf(preview);
    expect(w.fetches).toEqual([medium]);

    // chosen: its next frame asks for the one file
    preview.markChosen();
    w.frame(preview);
    expect(w.fetches).toEqual([medium, top]);
    // the body on the stage is the one that sharpens: never a rebuild
    expect(w.bodyOf(preview)).toBe(body);
    expect(w.hung(preview)).toEqual({ [medium]: true });

    // the top levels land: the high pack hangs hidden while it links, the medium file draws
    await w.land(preview, [top], false);
    expect(w.hung(preview)).toEqual({ [medium]: true, [top]: false });
    // linked: one step from the medium file to the high pack, dressed, before any frame
    w.settle();
    expect(w.hung(preview)).toEqual({ [top]: true });
    w.frame(preview);
    expect(w.hung(preview)).toEqual({ [top]: true });
    expect(w.bodyOf(preview)).toBe(body);
    expect(w.levels(preview)).toEqual(['lod0']);
    // a look edit on the chosen body asks for nothing more
    w.browse(preview, 'mage', 'female');
    preview.markChosen();
    w.frame(preview);
    expect(w.fetches).toEqual([medium, top]);
  });

  it('lets the top file go when the player flips away before it lands, and asks again on return', async () => {
    const w = await world('high');
    const preview = w.stage();
    const top = w.url('warrior', 'male', 'high');
    const other = w.url('rogue', 'male', 'medium');
    w.browse(preview, 'warrior', 'male');
    await w.land(preview);
    preview.markChosen();
    w.frame(preview);
    expect(w.tops()).toEqual([top]);

    // flipped to another class while the top file is still on its way
    w.browse(preview, 'rogue', 'male');
    await w.land(preview, [other]);
    expect(w.hung(preview)).toEqual({ [other]: true });
    expect(w.tops()).toEqual([top]);
    // it lands late: nothing on the stage takes it, and nobody holds it
    await w.land(preview, [top]);
    expect(w.hung(preview)).toEqual({ [other]: true });
    expect(w.packs.wocArmorPackResident(top)).toBe(true);
    expect(w.packs.wocArmorPackRefs(top)).toBe(0);
    // ...so it is the store's to free once its idle window has passed
    w.advance(w.core.WOC_ARMOR_IDLE_EVICT_MS);
    w.packs.sweepWocArmorPacks();
    expect(w.packs.wocArmorPackResident(top)).toBe(false);

    // back on the chosen class: its top file is asked for again, and this time it lands
    w.browse(preview, 'warrior', 'male');
    expect(w.tops()).toEqual([top, top]);
    await w.land(preview);
    expect(w.hung(preview)).toEqual({ [top]: true });
  });

  it('releases the top file of a chosen class the moment its body leaves the stage', async () => {
    const w = await world('high');
    const preview = w.stage();
    const top = w.url('paladin', 'female', 'high');
    w.browse(preview, 'paladin', 'female');
    await w.land(preview);
    preview.markChosen();
    w.frame(preview);
    await w.land(preview);
    expect(w.hung(preview)).toEqual({ [top]: true });
    expect(w.packs.wocArmorPackRefs(top)).toBe(1);

    w.browse(preview, 'paladin', 'male');
    expect(w.packs.wocArmorPackRefs(top)).toBe(0);
    await w.land(preview);
    // the other body of the chosen class is still being browsed: its medium file, no top
    expect(w.hung(preview)).toEqual({ [w.url('paladin', 'male', 'medium')]: true });
    expect(w.tops()).toEqual([top]);

    // back while the pack is still in memory: it draws at once, with nothing fetched
    w.browse(preview, 'paladin', 'female');
    expect(w.hung(preview)).toEqual({ [top]: true });
    expect(w.tops()).toEqual([top]);
  });

  it.each([
    ['chosen while its body still streams', true, 'high'],
    ['only browsed while its body still streams', false, 'medium'],
  ] as const)('builds a class %s at the detail it has by then', async (_name, chosen, drawn) => {
    const w = await world('high', { holdFemaleBodies: true });
    const preview = w.stage();
    w.browse(preview, 'mage', 'female');
    // its base is on its way: nothing is built, and nothing of its armor is asked for
    expect(w.bodyOf(preview)).toBeNull();
    expect(w.fetches).toEqual([]);
    // the editor is up before the body is: the player may already be working on the look
    if (chosen) preview.markChosen();
    await w.landBodies(preview);
    expect(w.tops()).toEqual(chosen ? [w.url('mage', 'female', 'high')] : []);
    await w.land(preview);
    expect(w.hung(preview)).toEqual({ [w.url('mage', 'female', drawn)]: true });
  });

  it('keeps an entity tint when a streamed preview body lands', async () => {
    const w = await world('high', { holdFemaleBodies: true });
    const { VISUALS } = await import('../src/render/characters/manifest');
    const key = w.keyOf('mage', 'female');
    // Give the held body the entity-tint contract used by creature previews.
    VISUALS[key].tint = 'entity';
    VISUALS[key].tintStrength = 1;
    const preview = w.stage();
    preview.setVisualKey(key, null, null, null, 0x336699);
    expect(w.bodyOf(preview)).toBeNull();
    await w.landBodies(preview);
    const mesh = w.bodyOf(preview)?.root.getObjectByName('Character_Body') as THREE.Mesh;
    expect(mesh).toBeDefined();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    expect(
      materials.map((material) => (material as THREE.MeshStandardMaterial).color.getHex()),
    ).toEqual([0x336699]);
  });

  it('holds one choice: choosing another class forgets the first', async () => {
    const w = await world('high');
    const preview = w.stage();
    const warriorTop = w.url('warrior', 'male', 'high');
    const mageTop = w.url('mage', 'male', 'high');
    w.browse(preview, 'warrior', 'male');
    await w.land(preview);
    preview.markChosen();
    w.frame(preview);
    await w.land(preview);
    expect(w.hung(preview)).toEqual({ [warriorTop]: true });

    w.browse(preview, 'mage', 'male');
    await w.land(preview);
    expect(w.hung(preview)).toEqual({ [w.url('mage', 'male', 'medium')]: true });
    preview.markChosen();
    w.frame(preview);
    await w.land(preview);
    expect(w.hung(preview)).toEqual({ [mageTop]: true });
    expect(w.tops()).toEqual([warriorTop, mageTop]);

    // the warrior is browsed again, not chosen: its medium file, whatever is in memory
    w.browse(preview, 'warrior', 'male');
    await w.land(preview);
    expect(w.packs.wocArmorPackResident(warriorTop)).toBe(true);
    expect(w.hung(preview)).toEqual({ [w.url('warrior', 'male', 'medium')]: true });
    expect(w.tops()).toEqual([warriorTop, mageTop]);
  });

  it('forgets the choice once the creator is left: coming back starts at the crowd detail', async () => {
    const w = await world('high');
    const preview = w.stage();
    const top = w.url('hunter', 'female', 'high');
    w.browse(preview, 'hunter', 'female');
    await w.land(preview);
    preview.markChosen();
    w.frame(preview);
    await w.land(preview);
    expect(w.hung(preview)).toEqual({ [top]: true });

    // off to the roster, then into the creator again on the same class and body
    w.roster(preview, 'priest', 'male');
    await w.land(preview);
    w.browse(preview, 'hunter', 'female');
    await w.land(preview);
    expect(w.packs.wocArmorPackResident(top)).toBe(true);
    expect(w.hung(preview)).toEqual({ [w.url('hunter', 'female', 'medium')]: true });
    expect(w.tops()).toEqual([top, w.url('priest', 'male', 'high')]);
  });
});

describe('the own character on a High desktop', () => {
  it(
    'draws every class and body at full detail on the character sheet',
    async () => {
      const w = await world('high');
      const preview = w.stage();
      for (const [cls, body] of EVERY_BODY) {
        w.mount(preview, cls, body, 'sheet');
        // its top file is asked for with its medium file, the moment it is mounted
        expect(w.fetches.slice(-2).sort(), `${cls}/${body}`).toEqual(
          [w.url(cls, body, 'medium'), w.url(cls, body, 'high')].sort(),
        );
        await w.land(preview);
        expect(w.hung(preview), `${cls}/${body}`).toEqual({ [w.url(cls, body, 'high')]: true });
      }
      expect(w.tops().sort()).toEqual(
        EVERY_BODY.map(([cls, body]) => w.url(cls, body, 'high')).sort(),
      );
    },
    WALK_BUDGET_MS,
  );

  it("draws the roster's pick at full detail on a preview nobody told what it shows", async () => {
    const w = await world('high');
    const preview = w.stage();
    for (const [cls, body] of [
      ['mage', 'female'],
      ['warrior', 'male'],
    ] as const) {
      w.roster(preview, cls, body);
      await w.land(preview);
      expect(w.hung(preview), `${cls}/${body}`).toEqual({ [w.url(cls, body, 'high')]: true });
    }
  });

  it.each([
    ["the roster's pick", 'setAppearance'],
    ['a redesign draft', 'setModular'],
    ['a class rig', 'setClass'],
  ] as const)('draws %s at full detail on a stage the creator just used', async (_name, entry) => {
    const w = await world('high');
    const preview = w.stage();
    w.browse(preview, 'druid', 'male');
    w.browse(preview, 'priest', 'female');
    await w.land(preview);
    expect(w.tops()).toEqual([]);
    const top = w.url('priest', 'female', 'high');
    if (entry === 'setAppearance') w.roster(preview, 'priest', 'female');
    else if (entry === 'setModular') {
      preview.setModular(w.app('female'), { head: null }, 'priest', null, null);
    } else {
      // a class rig is the male body: setClass takes no look
      preview.setClass('priest', null, null);
    }
    const shown = entry === 'setClass' ? w.url('priest', 'male', 'high') : top;
    expect(w.tops()).toEqual([shown]);
    await w.land(preview);
    expect(w.hung(preview)).toEqual({ [shown]: true });
  });

  it('gives a class the creator staged its full detail when the roster takes it over', async () => {
    const w = await world('high');
    const preview = w.stage();
    const medium = w.url('rogue', 'female', 'medium');
    const top = w.url('rogue', 'female', 'high');
    w.browse(preview, 'rogue', 'female');
    await w.land(preview);
    const body = w.bodyOf(preview);
    expect(w.hung(preview)).toEqual({ [medium]: true });

    // a fresh rogue of that body holds the same starters: the body on the stage is kept
    w.roster(preview, 'rogue', 'female', {
      mainhandItemId: CLASSES.rogue.startWeapon ?? null,
      offhandItemId: CLASSES.rogue.startOffhand ?? null,
    });
    expect(w.bodyOf(preview)).toBe(body);
    w.frame(preview);
    expect(w.tops()).toEqual([top]);
    await w.land(preview);
    expect(w.hung(preview)).toEqual({ [top]: true });
    expect(w.bodyOf(preview)).toBe(body);

    // ...and a pick in the roster's own editor (the redesign) is no creator's choice: the
    // class goes back to the crowd's detail when the creator stages it again
    preview.markChosen();
    w.browse(preview, 'rogue', 'female');
    expect(w.bodyOf(preview)).toBe(body);
    w.frame(preview, false);
    expect(w.hung(preview)).toEqual({ [top]: true, [medium]: false });
    w.settle();
    expect(w.hung(preview)).toEqual({ [medium]: true });
  });

  it('changes the detail of a body the sheet and the Inspect stage both show, in place', async () => {
    const w = await world('high');
    const preview = w.stage();
    const medium = w.url('hunter', 'male', 'medium');
    const top = w.url('hunter', 'male', 'high');
    w.mount(preview, 'hunter', 'male', 'sheet');
    await w.land(preview);
    const body = w.bodyOf(preview);
    expect(w.hung(preview)).toEqual({ [top]: true });
    // a player card shot taken of the own character, cached by the preview
    const shots = (preview as unknown as { closeupCache: Map<string, unknown> }).closeupCache;
    shots.set('hero', {});

    // a peer of the same class, body and hands is inspected: the turntable keeps its body
    w.mount(preview, 'hunter', 'male', 'inspect');
    expect(w.bodyOf(preview)).toBe(body);
    // ...and the shots cached of it show the detail it is leaving
    expect(shots.size).toBe(0);
    // the medium file takes over behind the gate, the high pack drawing until it has
    w.frame(preview, false);
    expect(w.hung(preview)).toEqual({ [top]: true, [medium]: false });
    // linked: the medium file draws on that very step, dressed, before any other frame
    w.settle();
    expect(w.hung(preview)).toEqual({ [medium]: true });
    expect(w.packs.wocArmorPackRefs(top)).toBe(0);
    w.frame(preview);
    expect(w.hung(preview)).toEqual({ [medium]: true });

    // back on the sheet: the own character sharpens again, with nothing fetched
    shots.set('hero', {});
    w.mount(preview, 'hunter', 'male', 'sheet');
    expect(w.bodyOf(preview)).toBe(body);
    expect(shots.size).toBe(0);
    w.frame(preview, false);
    expect(w.hung(preview)).toEqual({ [medium]: true, [top]: false });
    w.settle();
    expect(w.hung(preview)).toEqual({ [top]: true });
    w.frame(preview);
    expect(w.hung(preview)).toEqual({ [top]: true });
    expect(w.fetches).toEqual([medium, top]);
    // a mount that changes nothing keeps the shots
    shots.set('hero', {});
    w.mount(preview, 'hunter', 'male', 'sheet');
    expect(shots.size).toBe(1);
  });
});

describe('the low preset and a phone', () => {
  it.each([
    ['the low preset', 'low', false],
    ['a touch phone on the high preset', 'high', true],
  ] as const)(
    'ask for the low file on every stage on %s',
    async (_name, tier, phone) => {
      const w = await world(tier, { phone });
      const preview = w.stage();
      for (const [cls, body] of EVERY_BODY) {
        const low = { [w.url(cls, body, 'low')]: true };
        w.mount(preview, cls, body, 'inspect');
        await w.land(preview);
        expect(w.hung(preview), `inspect ${cls}/${body}`).toEqual(low);
        w.browse(preview, cls, body);
        preview.markChosen();
        await w.land(preview);
        expect(w.hung(preview), `creator ${cls}/${body}`).toEqual(low);
        w.mount(preview, cls, body, 'sheet');
        w.roster(preview, cls, body);
        await w.land(preview);
        expect(w.hung(preview), `own ${cls}/${body}`).toEqual(low);
        // the level a body built directly has always drawn there
        expect(w.levels(preview), `${cls}/${body}`).toEqual(['mid']);
      }
      expect([...w.fetches].sort()).toEqual(
        EVERY_BODY.map(([cls, body]) => w.url(cls, body, 'low')).sort(),
      );
    },
    WALK_BUDGET_MS,
  );
});

describe('the medium preset', () => {
  it('draws the medium file on every stage, the own character included, and never a top file', async () => {
    const w = await world('medium');
    const preview = w.stage();
    const medium = { [w.url('shaman', 'male', 'medium')]: true };
    w.mount(preview, 'shaman', 'male', 'inspect');
    await w.land(preview);
    expect(w.hung(preview)).toEqual(medium);
    w.browse(preview, 'shaman', 'male');
    preview.markChosen();
    await w.land(preview);
    expect(w.hung(preview)).toEqual(medium);
    w.mount(preview, 'shaman', 'male', 'sheet');
    await w.land(preview);
    expect(w.hung(preview)).toEqual(medium);
    expect(w.fetches).toEqual([w.url('shaman', 'male', 'medium')]);
  });
});
