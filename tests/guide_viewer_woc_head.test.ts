// The Guide viewer's WOC head hookup (src/guide/viewer/woc_head.ts, driven by model.ts
// buildModel): a wiki figure on a split WOC body wears its fit's modular head at the
// DEFAULT look through the renderer's own head store + dressing, as a default character
// draws in game. A base file ends at the neck (the head files ARE the head), so a figure
// whose head files fail to load fails to build, never a headless figure.
// The head library ships split, so a figure fetches exactly its default look's files (the
// type's core, its default hairstyle's and facial hair's), never the rest of the library.
// The GLB loader is mocked additively and memoized per url like the real one (synthetic
// base, split head files and armor scenes), so this runs in plain Node with no WebGL:
// everything asserted is scene-graph and material state.
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  scenes: new Map<string, () => unknown>(),
  /** Every loadGltf call, by url. */
  calls: [] as string[],
  /** Every real parse (a memo miss), by url. */
  fetches: [] as string[],
  memo: new Map<string, Promise<unknown>>(),
}));

vi.mock('../src/render/assets/loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/assets/loader')>()),
  // the real loadGltf memoizes one promise per url and evicts a rejected one
  loadGltf: vi.fn((url: string) => {
    fixtures.calls.push(url);
    let p = fixtures.memo.get(url);
    if (!p) {
      fixtures.fetches.push(url);
      const make = fixtures.scenes.get(url);
      p = make ? Promise.resolve(make()) : Promise.reject(new Error(`asset load failed: ${url}`));
      p.catch(() => fixtures.memo.delete(url));
      fixtures.memo.set(url, p);
    }
    return p;
  }),
}));

import { GUIDE_CLASSES, GUIDE_MODELS, type GuideModelSpec } from '../src/guide/content.generated';
import { buildModel } from '../src/guide/viewer/model';
import { guideWocHeadOf } from '../src/guide/viewer/woc_head';
import { wocArmorPackUrl, wocBaseUrl } from '../src/render/characters/woc_armor_core';
import {
  WOC_HEAD_MORPH_RANGE,
  WOC_HEAD_MORPHS,
  WOC_HEAD_TYPES,
  type WocHeadType,
  wocHeadAllUrls,
  wocHeadCoreUrl,
  wocHeadLookUrls,
  wocHeadPieceUrl,
  wocHeadTuckMorph,
  wocHeadVisibleNodes,
} from '../src/render/characters/woc_head_catalog';
import { WocHeadDressing } from '../src/render/characters/woc_head_dressing';
import { wocHeadLookFromAppearance } from '../src/render/characters/woc_head_look_core';
import {
  hangWocHead,
  resetWocHeadFilesForTest,
  WOC_HEAD_WRAPPER,
  wocHeadRigOf,
} from '../src/render/characters/woc_head_packs';
import { wocHeadTintOf } from '../src/render/characters/woc_head_tint';
import { splitHeadScenes } from './helpers/woc_head_split_fixture';

type Fit = 'male' | 'female';
const typeOf = (fit: Fit): WocHeadType => (fit === 'female' ? 'b' : 'a');

function mat(name: string): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial();
  m.name = name;
  return m;
}

/** A base-file-like scene: a two-bone skinned body that ends at the neck. */
function baseScene(): GLTF {
  const scene = new THREE.Group();
  const hips = new THREE.Bone();
  hips.name = 'hips';
  const head = new THREE.Bone();
  head.name = 'head';
  head.position.y = 1.5;
  hips.add(head);
  scene.add(hips);
  const geo = new THREE.BoxGeometry(0.5, 1.8, 0.3);
  geo.translate(0, 0.9, 0);
  const n = geo.getAttribute('position').count;
  const weights = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) weights[i * 4] = 1;
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const body = new THREE.SkinnedMesh(geo, mat('body'));
  body.name = 'Character_Body';
  scene.add(body);
  scene.updateMatrixWorld(true);
  body.bind(new THREE.Skeleton([hips, head]));
  return { scene, animations: [] } as unknown as GLTF;
}

/** The materials one pack piece is drawn with, the way the export names them: an eye is an
 *  eyelid shell plus the eyeball, and a hairstyle over a scalp cap is strands plus scalp
 *  (both load as a Group of meshes, `<piece>_1`, `<piece>_2`). */
function pieceMaterials(type: WocHeadType, name: string): string[] {
  const side = name.endsWith('_L') ? 'L' : 'R';
  if (name.includes('_eyes_')) return [`skin_eyelid_${side}`, `eye_${side}`];
  if (name.includes('_beard_')) return [`hair_beard_${name.split('_beard_')[1]}`];
  if (name.includes('_hair_')) {
    const style = name.split('_hair_')[1];
    return style === WOC_HEAD_TYPES[type].defaults.hair
      ? [`hair_${style}`, `hair_${style}_scalp`]
      : [`hair_${style}`];
  }
  if (name.includes('_brows_')) return [`brow_${side}`];
  if (name.includes('_ears_')) return [`skin_ear_${side}`];
  if (name.includes('piercing')) return ['metal_gold'];
  if (name.includes('_nose_')) return ['skin_nose'];
  if (name.includes('_mouth_')) return ['skin_mouth'];
  return ['skin_head'];
}

/** The morph targets one pack mesh carries (a subset of the shipped export's). */
function pieceTargets(type: WocHeadType, name: string): string[] {
  const tucks = WOC_HEAD_TYPES[type].slots.hair
    .filter((v) => v.id !== 'bald')
    .slice(0, 3)
    .map((v) => wocHeadTuckMorph(v.id));
  if (name.endsWith('_base')) {
    return [WOC_HEAD_MORPHS.eyeSize, WOC_HEAD_MORPHS.chinWidth, 'FS_Bald_Crown', ...tucks];
  }
  if (name.includes('_beard_') || name.includes('_mouth_') || name.includes('_nose_')) {
    return [WOC_HEAD_MORPHS.chinWidth];
  }
  if (name.includes('_eyes_') || name.includes('_brows_')) return [WOC_HEAD_MORPHS.eyeSize];
  if (name.includes('_ears_')) return tucks;
  return [];
}

function packMesh(name: string, material: string, targets: readonly string[]): THREE.Mesh {
  const g = new THREE.BoxGeometry(0.05, 0.05, 0.05);
  g.morphAttributes.position = targets.map(() => g.getAttribute('position').clone());
  const m = new THREE.Mesh(g, mat(material));
  m.name = name;
  if (targets.length > 0) {
    m.morphTargetDictionary = Object.fromEntries(targets.map((t, i) => [t, i]));
    m.morphTargetInfluences = targets.map(() => 0);
  }
  return m;
}

/** One rigid piece of `type`: a mesh, or a Group of one mesh per material. */
function packPiece(type: WocHeadType, name: string): THREE.Object3D {
  const materials = pieceMaterials(type, name);
  const targets = pieceTargets(type, name);
  if (materials.length === 1) return packMesh(name, materials[0], targets);
  const group = new THREE.Group();
  group.name = name;
  for (const [i, m] of materials.entries()) group.add(packMesh(`${name}_${i + 1}`, m, targets));
  return group;
}

/** The split head library of `type`: one scene per file, by url. */
const packFiles = (type: WocHeadType): Map<string, GLTF> =>
  splitHeadScenes(type, (name) => packPiece(type, name));

/** The files a type's DEFAULT look draws (its core, hairstyle and facial hair). */
const defaultFiles = (type: WocHeadType): string[] => wocHeadLookUrls(type, null);

/** Every head file fetched, in order. */
const headFetches = (): string[] => fixtures.fetches.filter((u) => u.includes('/head_type_'));

/** An armor file with nothing in it: the helm rule reads the file's set, not its meshes. */
const emptyArmor = (): GLTF => ({ scene: new THREE.Group(), animations: [] }) as unknown as GLTF;

function wocSpec(fit: Fit, armorSet: string | null): GuideModelSpec {
  return {
    url: wocBaseUrl(fit),
    idle: null,
    height: 2.86,
    ...(armorSet ? { armor: [wocArmorPackUrl(fit, armorSet, 'medium')] } : {}),
  };
}

/** Serve a fit's base (a fresh parse per memo miss), EVERY file of its split head library
 *  but `missing` (one parse each, returned so a test can watch their shared resources) and
 *  an optional armor file. */
function install(
  fit: Fit,
  armorSet: string | null,
  missing: readonly string[] = [],
): Map<string, GLTF> {
  fixtures.scenes.set(wocBaseUrl(fit), () => baseScene());
  const files = packFiles(typeOf(fit));
  for (const [url, gltf] of files) {
    if (missing.includes(url)) files.delete(url);
    else fixtures.scenes.set(url, () => gltf);
  }
  if (armorSet) fixtures.scenes.set(wocArmorPackUrl(fit, armorSet, 'medium'), emptyArmor);
  return files;
}

/** Drawn: visible along the whole ancestor chain (a hidden piece hides its meshes). */
const shown = (o: THREE.Object3D | undefined): boolean => {
  if (!o) return false;
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
};

/** The hung head pieces (the direct children of the head's wrappers), by node name. */
function headPieces(root: THREE.Object3D): Map<string, THREE.Object3D> {
  const out = new Map<string, THREE.Object3D>();
  root.traverse((o) => {
    if (o.parent?.userData[WOC_HEAD_WRAPPER]) out.set(o.name, o);
  });
  return out;
}

const drawnPieces = (root: THREE.Object3D): string[] =>
  [...headPieces(root)]
    .filter(([, o]) => shown(o))
    .map(([name]) => name)
    .sort();

interface DrawnMesh {
  morphs: Record<string, number>;
  tint: { role: string; color: number[]; mix: number } | null;
}

/** Every mesh that draws, by name: its morph influences and its head tint, if any. */
function drawnState(root: THREE.Object3D): Record<string, DrawnMesh> {
  const out: Record<string, DrawnMesh> = {};
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !shown(o)) return;
    const morphs: Record<string, number> = {};
    for (const [target, at] of Object.entries(mesh.morphTargetDictionary ?? {})) {
      morphs[target] = mesh.morphTargetInfluences?.[at] ?? 0;
    }
    const u = wocHeadTintOf(mesh.material as THREE.Material);
    out[o.name] = {
      morphs,
      tint: u ? { role: u.role, color: u.tint.value.toArray(), mix: u.mix.value } : null,
    };
  });
  return out;
}

/** The runtime's own head steps straight on a plain base (its default look's files already
 *  resident): the hang at build, then CharacterVisual's dressing, tint wrap and helm, live
 *  on the default look. No viewer pass runs, so a match proves the viewer's other passes
 *  (armor, tagging, tint, normalizing) leave the head exactly as the runtime dresses it. */
function referenceHead(fit: Fit, helm: boolean): THREE.Object3D {
  const model = baseScene().scene;
  expect(hangWocHead(model, typeOf(fit), defaultFiles(typeOf(fit)))).not.toBeNull();
  const dressing = new WocHeadDressing(
    {
      model,
      adopt: (_n, retint) => retint(),
      forget: () => {},
      reveal: (_n, live) => live(true),
      relive: () => {},
      baseMaterial: (mesh) => mesh.material,
      rigDrawn: () => true,
    },
    typeOf(fit),
  );
  dressing.retint();
  dressing.setHelm(helm);
  dressing.setAppearance(null);
  expect(dressing.isLive).toBe(true);
  return model;
}

const influence = (root: THREE.Object3D, node: string, target: string): number | undefined => {
  const mesh = root.getObjectByName(node) as THREE.Mesh | undefined;
  const at = mesh?.morphTargetDictionary?.[target];
  return at === undefined ? undefined : mesh?.morphTargetInfluences?.[at];
};

const tintOf = (root: THREE.Object3D, node: string) => {
  const mesh = root.getObjectByName(node) as THREE.Mesh | undefined;
  return mesh ? wocHeadTintOf(mesh.material as THREE.Material) : null;
};

afterEach(() => {
  fixtures.scenes.clear();
  fixtures.memo.clear();
  fixtures.calls.length = 0;
  fixtures.fetches.length = 0;
  resetWocHeadFilesForTest();
  vi.restoreAllMocks();
});

describe('guideWocHeadOf', () => {
  it('gives every class figure its fit head (every class body is a WOC base)', () => {
    expect(GUIDE_CLASSES.length).toBeGreaterThan(0);
    for (const c of GUIDE_CLASSES) {
      const spec = GUIDE_MODELS[c.model];
      const head = guideWocHeadOf(spec);
      expect(head, c.id).not.toBeNull();
      if (!head) continue;
      expect(spec.url, c.id).toBe(wocBaseUrl(head.fit));
      expect(WOC_HEAD_TYPES[head.type].fit, c.id).toBe(head.fit);
    }
  });

  it('reads Type B off the female base, and hides the hair only under a drawn helm', () => {
    expect(guideWocHeadOf(wocSpec('female', 'mage'))).toEqual({
      fit: 'female',
      type: 'b',
      helm: true,
    });
    expect(guideWocHeadOf(wocSpec('male', 'warrior'))).toEqual({
      fit: 'male',
      type: 'a',
      helm: true,
    });
    // a bare body, or a file that is no WOC armor pack, keeps its hair
    expect(guideWocHeadOf(wocSpec('male', null))?.helm).toBe(false);
    expect(guideWocHeadOf({ ...wocSpec('female', null), armor: [] })?.helm).toBe(false);
    expect(
      guideWocHeadOf({ url: wocBaseUrl('male'), armor: ['models/weapons/staff.glb'] })?.helm,
    ).toBe(false);
    // a set with no manifest of its own is minted by the class-set convention, helm included
    expect(guideWocHeadOf(wocSpec('male', 'probe_crown'))?.helm).toBe(true);
  });

  it('is null for every figure that is not a WOC base', () => {
    const others = Object.entries(GUIDE_MODELS).filter(
      ([, s]) => s.url !== wocBaseUrl('male') && s.url !== wocBaseUrl('female'),
    );
    expect(others.length).toBeGreaterThan(0);
    for (const [key, spec] of others) expect(guideWocHeadOf(spec), key).toBeNull();
  });
});

describe('buildModel hangs the default WOC head', () => {
  it('Type A: the default look, the original face retired, the hair under the helm', async () => {
    install('male', 'mage');
    const built = await buildModel(wocSpec('male', 'mage'), null);
    // exactly the default look's files: the core, the swept hair and the beards, nothing more
    expect(headFetches().sort()).toEqual(
      [
        wocHeadCoreUrl('a'),
        wocHeadPieceUrl('a', 'hair', 'swept'),
        wocHeadPieceUrl('a', 'beard', 'boxed'),
      ].sort(),
    );
    const root = built.root;
    const defaults = WOC_HEAD_TYPES.a.defaults;
    expect(drawnPieces(root)).toEqual(
      [...wocHeadVisibleNodes('a', defaults, { helm: true })].sort(),
    );
    // the helm hides the hair, never the beard
    expect(shown(root.getObjectByName(`WocHead_A_hair_${defaults.hair}`))).toBe(false);
    expect(shown(root.getObjectByName(`WocHead_A_beard_${defaults.beard}`))).toBe(true);
    expect(influence(root, 'WocHead_A_base', WOC_HEAD_MORPHS.chinWidth)).toBeCloseTo(
      WOC_HEAD_MORPH_RANGE.chinWidth.def,
      6,
    );
    // and mesh for mesh (morphs and tints) the head the runtime dresses for this look
    expect(drawnState(root)).toEqual(drawnState(referenceHead('male', true)));
    built.dispose();
  });

  it('tints the head and the body skin with the default look colours, as in game', async () => {
    install('male', null);
    const built = await buildModel(wocSpec('male', null), null);
    const root = built.root;
    const colors = wocHeadLookFromAppearance(null, 'a').colors;
    const expectTint = (node: string, role: string, want: readonly number[]): void => {
      const u = tintOf(root, node);
      expect(u?.role, node).toBe(role);
      expect(u?.mix.value, node).toBe(1);
      const got = u?.tint.value.toArray() ?? [];
      for (let i = 0; i < 3; i++) expect(got[i], `${node}[${i}]`).toBeCloseTo(want[i], 6);
    };
    const defaults = WOC_HEAD_TYPES.a.defaults;
    // a multi-material piece: strands and scalp both take the hair colour
    expectTint(`WocHead_A_hair_${defaults.hair}_1`, 'hair', colors.hair);
    expectTint(`WocHead_A_hair_${defaults.hair}_2`, 'hair', colors.hair);
    expectTint(`WocHead_A_beard_${defaults.beard}`, 'hair', colors.hair);
    expectTint(`WocHead_A_brows_${defaults.brows}_L`, 'brow', colors.brow);
    // the eyelid shell is skin, the eyeball is the eye
    expectTint(`WocHead_A_eyes_${defaults.eyes}_L_1`, 'skin', colors.skin);
    expectTint(`WocHead_A_eyes_${defaults.eyes}_L_2`, 'eye', colors.eye);
    expectTint('WocHead_A_base', 'skin', colors.skin);
    expectTint('Character_Body', 'skin', colors.skin);
    // the game's own rule (woc_skin_tint_core.ts): the viewer's body draws its base file's
    // suit, so its skin paint takes the tone through the suit key at full strength, and a
    // head piece's skin stays the plain skin layer
    expect(tintOf(root, 'Character_Body')?.surface).toBe('suit');
    expect(tintOf(root, 'WocHead_A_base')?.surface).toBeUndefined();
    built.dispose();
  });

  it('keeps only the pieces it draws, so its prewarm links and uploads nothing else', async () => {
    const files = install('male', 'mage');
    const built = await buildModel(wocSpec('male', 'mage'), null);
    const pieces = headPieces(built.root);
    const want = wocHeadVisibleNodes('a', WOC_HEAD_TYPES.a.defaults, { helm: true });
    expect([...pieces.keys()].sort()).toEqual([...want].sort());
    for (const [name, piece] of pieces) expect(shown(piece), name).toBe(true);
    // no material of an undrawn piece (or a tint clone of one) is left in the model
    const drawnSources = new Set<string>(want.flatMap((n) => pieceMaterials('a', n)));
    let packMaterials = 0;
    for (const url of defaultFiles('a')) {
      files.get(url)?.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) packMaterials++;
      });
    }
    built.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !o.userData.wocHeadPart) return;
      expect(drawnSources.has((mesh.material as THREE.Material).name), o.name).toBe(true);
    });
    expect(packMaterials).toBeGreaterThan(want.length);
    built.dispose();
  });

  it('wraps the head tint over an entity tint, never under it (the pass order is pinned)', async () => {
    install('male', null);
    const built = await buildModel({ ...wocSpec('male', null), tintStrength: 0.4 }, 0xff0000);
    const mesh = built.root.getObjectByName('WocHead_A_base') as THREE.Mesh;
    const material = mesh.material as THREE.MeshStandardMaterial;
    // the head tint layer survived the entity tint's bare clone...
    expect(wocHeadTintOf(material)?.role).toBe('skin');
    // ...and rides a material the entity tint already lerped toward red
    expect(material.color.r).toBeCloseTo(1, 6);
    expect(material.color.g).toBeCloseTo(0.6, 6);
    built.dispose();
  });

  it('Type B on the female body: its own default look, the hair shown on a bare kit', async () => {
    install('female', null);
    const built = await buildModel(wocSpec('female', null), null);
    // Type B's core and its braid: clean shaven needs no beard file, and no Type A file
    expect(headFetches().sort()).toEqual(
      [wocHeadCoreUrl('b'), wocHeadPieceUrl('b', 'hair', 'braid')].sort(),
    );
    for (const url of wocHeadAllUrls('a')) expect(fixtures.fetches).not.toContain(url);
    const defaults = WOC_HEAD_TYPES.b.defaults;
    expect(drawnPieces(built.root)).toEqual(
      [...wocHeadVisibleNodes('b', defaults, { helm: false })].sort(),
    );
    expect(shown(built.root.getObjectByName(`WocHead_B_hair_${defaults.hair}`))).toBe(true);
    expect(drawnState(built.root)).toEqual(drawnState(referenceHead('female', false)));
    built.dispose();
  });

  it("two builds racing one look share each file's single fetch and both wear the head", async () => {
    install('male', null);
    const [a, b] = await Promise.all([
      buildModel(wocSpec('male', null), null),
      buildModel(wocSpec('male', null), null),
    ]);
    for (const url of defaultFiles('a')) {
      expect(
        fixtures.fetches.filter((u) => u === url),
        url,
      ).toHaveLength(1);
    }
    for (const built of [a, b]) {
      expect(shown(built.root.getObjectByName('WocHead_A_base'))).toBe(true);
    }
    a.dispose();
    b.dispose();
  });

  it('dispose frees the wrapped clones and unhangs the head, never the shared files', async () => {
    const files = install('male', null);
    const packMaterials = new Set<THREE.Material>();
    const packGeometries = new Set<THREE.BufferGeometry>();
    for (const gltf of files.values()) {
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        packMaterials.add(mesh.material as THREE.Material);
        packGeometries.add(mesh.geometry);
      });
    }
    const packDisposes = [
      ...[...packMaterials].map((m) => vi.spyOn(m, 'dispose')),
      ...[...packGeometries].map((g) => vi.spyOn(g, 'dispose')),
    ];
    const built = await buildModel(wocSpec('male', null), null);
    const model = built.root.children[0];
    expect(wocHeadRigOf(model)).not.toBeNull();
    const base = model.getObjectByName('WocHead_A_base') as THREE.Mesh;
    const wrapped = base.material as THREE.Material;
    // this build's own tint clone over the pack's shared material and geometry
    expect(wocHeadTintOf(wrapped)).not.toBeNull();
    expect(packMaterials.has(wrapped)).toBe(false);
    expect(packGeometries.has(base.geometry)).toBe(true);
    const wrappedDispose = vi.spyOn(wrapped, 'dispose');
    built.dispose();
    built.dispose(); // a second dispose is a no-op
    expect(wrappedDispose).toHaveBeenCalledTimes(1);
    for (const spy of packDisposes) expect(spy).not.toHaveBeenCalled();
    expect(wocHeadRigOf(model)).toBeNull();
    expect(model.getObjectByName('WocHead_A_base')).toBeUndefined();
    // a second build reuses the resident files (no refetch) and draws a fresh head over them
    fixtures.fetches.length = 0;
    const again = await buildModel(wocSpec('male', null), null);
    expect(headFetches()).toEqual([]);
    const next = again.root.getObjectByName('WocHead_A_base') as THREE.Mesh;
    expect(shown(next)).toBe(true);
    expect(packGeometries.has(next.geometry)).toBe(true);
    again.dispose();
  });

  it('never headless: a failed core fails the figure, exactly as a failed base would', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    install('male', null, wocHeadAllUrls('a'));
    await expect(buildModel(wocSpec('male', null), null)).rejects.toThrow(/head files/);
    expect(fixtures.calls).toContain(wocHeadCoreUrl('a'));
  });

  it('never bald: a failed hairstyle file fails the figure too', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const swept = wocHeadPieceUrl('a', 'hair', 'swept') as string;
    install('male', null, [swept]);
    // the core and the beards landed, but a head without its hair is no head
    await expect(buildModel(wocSpec('male', null), null)).rejects.toThrow(/head files/);
    expect(fixtures.calls).toContain(swept);
  });

  it('a figure that is not a WOC body fetches no head pack and hangs nothing', async () => {
    const url = 'models/creatures/probe_wolf.glb';
    fixtures.scenes.set(url, () => baseScene());
    const built = await buildModel({ url, idle: null, height: 1 }, null);
    expect(fixtures.calls.some((u) => u.includes('head_type_'))).toBe(false);
    expect(drawnPieces(built.root)).toEqual([]);
    expect(shown(built.root.getObjectByName('Character_Body'))).toBe(true);
    built.dispose();
  });
});
