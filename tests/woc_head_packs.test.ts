// The WOC head library store (woc_head_packs.ts) over a mocked loader: one fetch per
// split file (memoized, resident once parsed, ready listeners told the url), a failed
// fetch re-armed only after its cooldown, the creator's prefetches fetching EXACTLY the
// files they name (a slot's files; a look's core, hairstyle and facial hair), and the
// hang: PIECES of a file in one wrapper on the head bone, hidden, aggregated per model; a
// body born with the pieces its look draws and nothing else of the library, a piece hung
// later in a wrapper of its own, one taken off leaving the scene graph, and a far bake's
// throwaway hanging exactly its part set.
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loads = vi.hoisted(() => ({
  calls: [] as string[],
  pending: new Map<string, { resolve: (g: unknown) => void; reject: (e: unknown) => void }>(),
}));
vi.mock('../src/render/assets/loader', () => ({
  loadGltf: vi.fn(
    (url: string) =>
      new Promise((resolve, reject) => {
        loads.calls.push(url);
        loads.pending.set(url, { resolve, reject });
      }),
  ),
}));

import { geometryLodVariant, setGeometryLod } from '../src/render/assets/geometry_lod';
import { DEFAULT_APPEARANCE } from '../src/render/characters/modular';
import {
  WOC_HEAD_TYPES,
  wocHeadAllNodes,
  wocHeadAllUrls,
  wocHeadCoreUrl,
  wocHeadPieceUrl,
  wocHeadVisibleNodes,
} from '../src/render/characters/woc_head_catalog';
import {
  ensureWocHeadCoreForFit,
  ensureWocHeadFile,
  ensureWocHeadForAppearance,
  hangWocHead,
  hangWocHeadAtBuild,
  hangWocHeadFile,
  hangWocHeadNamed,
  hangWocHeadPieces,
  onWocHeadFileReady,
  prefetchWocHeadLook,
  prefetchWocHeadSlot,
  resetWocHeadFilesForTest,
  setWocHeadFileForTest,
  unhangWocHead,
  unhangWocHeadPieces,
  WOC_HEAD_WRAPPER,
  wocHeadAppearanceResident,
  wocHeadFilePieceNames,
  wocHeadFileResident,
  wocHeadRigOf,
} from '../src/render/characters/woc_head_packs';
import { splitHeadScenes } from './helpers/woc_head_split_fixture';

const DIR = 'models/chars/players/woc';

/** A landed parse (a `head` node with one piece). */
const parse = (): unknown => {
  const scene = new THREE.Group();
  const head = new THREE.Object3D();
  head.name = 'head';
  scene.add(head);
  return { scene, animations: [] };
};

const settle = async (url: string, ok = true): Promise<void> => {
  const p = loads.pending.get(url);
  if (!p) throw new Error(`no fetch in flight for ${url}`);
  loads.pending.delete(url);
  if (ok) p.resolve(parse());
  else p.reject(new Error(`asset load failed: ${url}`));
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  loads.calls.length = 0;
  loads.pending.clear();
});
afterEach(() => {
  resetWocHeadFilesForTest();
  vi.restoreAllMocks();
});

describe('the per-file store', () => {
  it('fetches a file once, makes it resident, and tells the ready listeners its url', async () => {
    const url = wocHeadCoreUrl('a');
    const ready: string[] = [];
    const off = onWocHeadFileReady((u) => ready.push(u));
    ensureWocHeadFile(url);
    ensureWocHeadFile(url);
    expect(loads.calls).toEqual([url]);
    expect(wocHeadFileResident(url)).toBe(false);
    await settle(url);
    expect(wocHeadFileResident(url)).toBe(true);
    expect(ready).toEqual([url]);
    // resident: never fetched again
    ensureWocHeadFile(url);
    expect(loads.calls).toEqual([url]);
    off();
  });

  it('re-arms a failed fetch only after its cooldown', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let now = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const url = `${DIR}/head_type_a_hair_quiff.glb`;
    ensureWocHeadFile(url);
    await settle(url, false);
    expect(wocHeadFileResident(url)).toBe(false);
    now += 1000;
    ensureWocHeadFile(url);
    expect(loads.calls).toEqual([url]);
    now += 8000;
    ensureWocHeadFile(url);
    expect(loads.calls).toEqual([url, url]);
  });

  it('the core rides the first WOC body of its type, by fit', () => {
    ensureWocHeadCoreForFit('female');
    expect(loads.calls).toEqual([`${DIR}/head_type_b_core.glb`]);
    ensureWocHeadCoreForFit('male');
    expect(loads.calls).toEqual([`${DIR}/head_type_b_core.glb`, `${DIR}/head_type_a_core.glb`]);
  });
});

describe('the prefetches fetch exactly the files they name', () => {
  it('a Hairstyle prefetch fetches every hairstyle file of the type and nothing else', () => {
    prefetchWocHeadSlot('a', 'hair');
    expect([...loads.calls].sort()).toEqual(
      [
        'braid',
        'long',
        'mohawk',
        'ponytail',
        'quiff',
        'shoulder',
        'swept',
        'topknot',
        'undercut',
        'waves',
      ].map((id) => `${DIR}/head_type_a_hair_${id}.glb`),
    );
    // a second open is free: every file is already in flight
    prefetchWocHeadSlot('a', 'hair');
    expect(loads.calls).toHaveLength(10);
  });

  it('a Facial Hair prefetch fetches the beards file and the handlebar only', () => {
    prefetchWocHeadSlot('b', 'beard');
    expect([...loads.calls].sort()).toEqual([
      `${DIR}/head_type_b_beard_handlebar.glb`,
      `${DIR}/head_type_b_beards.glb`,
    ]);
  });

  it("the creator's boot prefetch is the type's default look: core, hairstyle, beard", () => {
    expect(prefetchWocHeadLook('a')).toBe(false);
    expect(loads.calls).toEqual([
      `${DIR}/head_type_a_core.glb`,
      `${DIR}/head_type_a_hair_swept.glb`,
      `${DIR}/head_type_a_beards.glb`,
    ]);
    loads.calls.length = 0;
    // Type B opens clean shaven: no beard file at all
    prefetchWocHeadLook('b');
    expect(loads.calls).toEqual([
      `${DIR}/head_type_b_core.glb`,
      `${DIR}/head_type_b_hair_braid.glb`,
    ]);
  });

  it("a player's own head: its files only, bald and clean shaven needing just the core", async () => {
    const app = { ...DEFAULT_APPEARANCE, headHair: 'bald', headBeard: 'none' };
    expect(ensureWocHeadForAppearance('male', app)).toBe(false);
    expect(loads.calls).toEqual([`${DIR}/head_type_a_core.glb`]);
    expect(wocHeadAppearanceResident('male', app)).toBe(false);
    await settle(`${DIR}/head_type_a_core.glb`);
    expect(wocHeadAppearanceResident('male', app)).toBe(true);
    expect(ensureWocHeadForAppearance('male', app)).toBe(true);
    // a styled look adds its own files, never the library's others
    loads.calls.length = 0;
    ensureWocHeadForAppearance('male', { ...app, headHair: 'long', headBeard: 'handlebar' });
    expect(loads.calls).toEqual([
      `${DIR}/head_type_a_hair_long.glb`,
      `${DIR}/head_type_a_beard_handlebar.glb`,
    ]);
  });
});

/** A base-like model: a skinned body on a two-bone rig. */
function model(): THREE.Object3D {
  const root = new THREE.Group();
  const hips = new THREE.Bone();
  hips.name = 'hips';
  const head = new THREE.Bone();
  head.name = 'head';
  hips.add(head);
  root.add(hips);
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const n = geo.getAttribute('position').count;
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
  geo.setAttribute(
    'skinWeight',
    new THREE.Float32BufferAttribute(new Float32Array(n * 4).fill(0.25), 4),
  );
  const body = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
  body.name = 'Character_Body';
  root.add(body);
  root.updateMatrixWorld(true);
  body.bind(new THREE.Skeleton([hips, head]));
  return root;
}

describe('hanging split files', () => {
  const piece = (name: string): THREE.Object3D => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.1),
      new THREE.MeshStandardMaterial(),
    );
    m.material.name = name.includes('_hair_') ? 'hair_x' : 'skin_x';
    m.name = name;
    return m;
  };

  it('hangs each file in one wrapper on the head bone, hidden, and aggregates them per model', () => {
    const library = splitHeadScenes('a', piece);
    const core = wocHeadCoreUrl('a');
    const long = wocHeadPieceUrl('a', 'hair', 'long') as string;
    setWocHeadFileForTest(core, library.get(core) ?? null);
    setWocHeadFileForTest(long, library.get(long) ?? null);
    const m = model();
    const coreFile = hangWocHeadFile(m, 'a', core);
    expect(coreFile?.wrappers).toHaveLength(1);
    expect(coreFile?.wrappers[0].parent?.name).toBe('head');
    expect(coreFile?.wrappers[0].userData[WOC_HEAD_WRAPPER]).toBe('a');
    expect(coreFile?.pieces.has('WocHead_A_base')).toBe(true);
    expect(coreFile?.pieces.has('WocHead_A_hair_long')).toBe(false);
    for (const p of coreFile?.pieces.values() ?? []) expect(p.visible).toBe(false);
    // a file hangs once per model; one that is not resident does not hang at all
    expect(hangWocHeadFile(m, 'a', core)).toBeNull();
    expect(hangWocHeadFile(m, 'a', wocHeadPieceUrl('a', 'hair', 'quiff') as string)).toBeNull();
    // the model's head gathers every file it carries
    const rig = hangWocHead(m, 'a');
    expect([...(rig?.files.keys() ?? [])]).toEqual([core, long]);
    expect(rig?.pieces.get('WocHead_A_hair_long')?.parent).toBe(rig?.files.get(long)?.wrappers[0]);
    expect(rig?.wrappers).toHaveLength(2);
    // the tint role rides each mesh, read off its file material's name
    const hair = rig?.pieces.get('WocHead_A_hair_long') as THREE.Mesh;
    expect(hair.userData.wocHeadTintRole).toBe('hair');
    unhangWocHead(m);
    expect(wocHeadRigOf(m)).toBeNull();
    expect(m.getObjectByName('WocHead_A_base')).toBeUndefined();
  });

  it('by default hangs every resident file of the library, never a missing one', () => {
    const library = splitHeadScenes('a', piece);
    for (const url of wocHeadAllUrls('a')) setWocHeadFileForTest(url, library.get(url) ?? null);
    setWocHeadFileForTest(wocHeadPieceUrl('a', 'hair', 'swept') as string, null);
    const rig = hangWocHead(model(), 'a');
    expect(rig?.files.size).toBe(wocHeadAllUrls('a').length - 1);
    expect(rig?.pieces.has('WocHead_A_hair_swept')).toBe(false);
    expect(rig?.pieces.has('WocHead_A_beard_handlebar')).toBe(true);
  });
});

describe('hanging pieces: a body carries what its look draws, never the library', () => {
  const piece = (name: string): THREE.Object3D => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.1),
      new THREE.MeshStandardMaterial(),
    );
    m.material.name = name.includes('_hair_') ? 'hair_x' : 'skin_x';
    m.name = name;
    return m;
  };
  const CORE = wocHeadCoreUrl('a');
  const BEARDS = wocHeadPieceUrl('a', 'beard', 'boxed') as string;
  const SWEPT = wocHeadPieceUrl('a', 'hair', 'swept') as string;
  const LONG = wocHeadPieceUrl('a', 'hair', 'long') as string;
  const DEFAULT_NODES = wocHeadVisibleNodes('a', WOC_HEAD_TYPES.a.defaults, { helm: false });

  /** The whole library resident. */
  function installAll(): void {
    const library = splitHeadScenes('a', piece);
    for (const url of wocHeadAllUrls('a')) setWocHeadFileForTest(url, library.get(url) ?? null);
  }
  /** Every head piece node in the model's scene graph. */
  const inGraph = (m: THREE.Object3D): string[] => {
    const out: string[] = [];
    m.traverse((o) => {
      if (o.name.startsWith('WocHead_')) out.push(o.name);
    });
    return out.sort();
  };

  it('hangWocHeadPieces hangs the named pieces of one file, hidden, in one wrapper', () => {
    installAll();
    const m = model();
    const hang = hangWocHeadPieces(m, 'a', CORE, ['WocHead_A_base', 'WocHead_A_nose_broad']);
    expect([...(hang?.pieces.keys() ?? [])]).toEqual(['WocHead_A_base', 'WocHead_A_nose_broad']);
    expect(hang?.wrappers).toHaveLength(1);
    expect(hang?.wrappers[0].parent?.name).toBe('head');
    expect(hang?.wrappers[0].userData[WOC_HEAD_WRAPPER]).toBe('a');
    expect(hang?.meshes).toHaveLength(2);
    for (const node of hang?.pieces.values() ?? []) {
      expect(node.visible).toBe(false);
      expect(node.parent).toBe(hang?.wrappers[0]);
    }
    // nothing else of the core's dozens of pieces is in the graph
    expect(inGraph(m)).toEqual(['WocHead_A_base', 'WocHead_A_nose_broad']);
    const rig = wocHeadRigOf(m);
    expect([...(rig?.files.keys() ?? [])]).toEqual([CORE]);
    expect(rig?.meshes).toHaveLength(2);
  });

  it('a later hang of the same file rides a wrapper of its own, and never doubles a piece', () => {
    installAll();
    const m = model();
    const first = hangWocHeadPieces(m, 'a', CORE, ['WocHead_A_base']);
    // asked again with one piece already there: only the new one hangs
    const second = hangWocHeadPieces(m, 'a', CORE, ['WocHead_A_base', 'WocHead_A_nose_broad']);
    expect([...(second?.pieces.keys() ?? [])]).toEqual(['WocHead_A_nose_broad']);
    // its own wrapper: one compile-gate call hides and reveals the late pieces alone
    expect(second?.wrappers).toHaveLength(1);
    expect(second?.wrappers[0]).not.toBe(first?.wrappers[0]);
    expect(first?.pieces.get('WocHead_A_base')?.parent).toBe(first?.wrappers[0]);
    const rig = wocHeadRigOf(m);
    expect(rig?.files.get(CORE)?.wrappers).toEqual([first?.wrappers[0], second?.wrappers[0]]);
    expect(rig?.wrappers).toHaveLength(2);
    expect(rig?.pieces.size).toBe(2);
    // nothing new to hang: null, and nothing added
    expect(hangWocHeadPieces(m, 'a', CORE, ['WocHead_A_base', 'WocHead_A_nose_broad'])).toBeNull();
    expect(m.getObjectByName('head')?.children).toHaveLength(2);
    // every hang shares the file's one geometry and material per piece
    const other = model();
    const again = hangWocHeadPieces(other, 'a', CORE, ['WocHead_A_base']);
    const a = first?.meshes[0] as THREE.Mesh;
    const b = again?.meshes[0] as THREE.Mesh;
    expect(b).not.toBe(a);
    expect(b.geometry).toBe(a.geometry);
    expect(b.material).toBe(a.material);
  });

  it('names a piece the file does not carry, or a file that is not resident: nothing hangs', () => {
    installAll();
    setWocHeadFileForTest(LONG, null);
    const m = model();
    expect(hangWocHeadPieces(m, 'a', CORE, ['WocHead_A_hair_long'])).toBeNull();
    expect(hangWocHeadPieces(m, 'a', LONG, ['WocHead_A_hair_long'])).toBeNull();
    expect(wocHeadRigOf(m)).toBeNull();
    expect(m.getObjectByName('head')?.children).toHaveLength(0);
    // what a file carries, by name; null for a file that is not resident or a rigless model
    expect(wocHeadFilePieceNames(m, CORE)?.has('WocHead_A_nose_broad')).toBe(true);
    expect(wocHeadFilePieceNames(m, CORE)?.has('WocHead_A_hair_long')).toBe(false);
    expect(wocHeadFilePieceNames(m, LONG)).toBeNull();
    expect(wocHeadFilePieceNames(new THREE.Group(), SWEPT)).toBeNull();
  });

  it('unhangWocHeadPieces takes pieces out of the graph, an emptied wrapper and file with them', () => {
    installAll();
    const m = model();
    hangWocHeadPieces(m, 'a', CORE, ['WocHead_A_base', 'WocHead_A_nose_broad']);
    const hair = hangWocHeadPieces(m, 'a', SWEPT, null);
    const head = m.getObjectByName('head') as THREE.Object3D;
    expect(head.children).toHaveLength(2);
    const nose = m.getObjectByName('WocHead_A_nose_broad') as THREE.Mesh;
    // one piece of two: the wrapper stays for the other
    expect(unhangWocHeadPieces(m, ['WocHead_A_nose_broad', 'WocHead_A_no_such_piece'])).toEqual([
      nose,
    ]);
    expect(nose.parent).toBeNull();
    expect(inGraph(m)).toEqual(['WocHead_A_base', 'WocHead_A_hair_swept']);
    const rig = wocHeadRigOf(m);
    expect(rig?.pieces.has('WocHead_A_nose_broad')).toBe(false);
    expect(rig?.meshes).not.toContain(nose);
    expect(rig?.files.get(CORE)?.meshes).not.toContain(nose);
    expect(head.children).toHaveLength(2);
    // the file's only piece: its wrapper leaves the bone, and the file the model
    const [node] = unhangWocHeadPieces(m, ['WocHead_A_hair_swept']);
    expect(node).toBe(hair?.pieces.get('WocHead_A_hair_swept'));
    expect(hair?.wrappers[0].parent).toBeNull();
    expect(head.children).toHaveLength(1);
    expect([...(rig?.files.keys() ?? [])]).toEqual([CORE]);
    expect(rig?.wrappers).toHaveLength(1);
    // a piece taken off can be hung again: the file is still resident
    expect(hangWocHeadPieces(m, 'a', SWEPT, null)?.pieces.size).toBe(1);
    // the last piece gone: the model carries no head at all
    unhangWocHeadPieces(m, ['WocHead_A_base', 'WocHead_A_hair_swept']);
    expect(wocHeadRigOf(m)).toBeNull();
    expect(head.children).toHaveLength(0);
    expect(unhangWocHeadPieces(m, ['WocHead_A_base'])).toEqual([]);
  });

  it("hangWocHeadAtBuild hangs the pieces of the born look's resident files, and nothing else", () => {
    installAll();
    const m = model();
    hangWocHeadAtBuild(m, 'male', 'lod0', null);
    // the type's default look: its eleven pieces of the library's fifty-seven
    expect(inGraph(m)).toEqual([...DEFAULT_NODES].sort());
    expect(inGraph(m)).toHaveLength(11);
    expect(wocHeadAllNodes('a')).toHaveLength(57);
    expect([...(wocHeadRigOf(m)?.files.keys() ?? [])]).toEqual([CORE, SWEPT, BEARDS]);
    expect(m.getObjectByName('head')?.children).toHaveLength(3);

    // a stored appearance: its own picks, one file's pieces each, never the default's
    const mine = model();
    const app = {
      ...DEFAULT_APPEARANCE,
      headHair: 'long',
      headBeard: 'none',
      headNose: 'broad',
      headPiercing: 'lobes',
    };
    hangWocHeadAtBuild(mine, 'male', 'lod0', app);
    expect(inGraph(mine)).toContain('WocHead_A_hair_long');
    expect(inGraph(mine)).toContain('WocHead_A_nose_broad');
    expect(inGraph(mine)).toContain('WocHead_A_piercing_lobe_l');
    expect(inGraph(mine)).not.toContain('WocHead_A_nose_default');
    expect(inGraph(mine)).not.toContain('WocHead_A_hair_swept');
    expect(inGraph(mine).filter((name) => name.includes('_beard_'))).toEqual([]);
    expect([...(wocHeadRigOf(mine)?.files.keys() ?? [])]).toEqual([CORE, LONG]);
  });

  it('a file not resident at build is left for the dressing, and the core is kicked', () => {
    const library = splitHeadScenes('a', piece);
    setWocHeadFileForTest(SWEPT, library.get(SWEPT) ?? null);
    const m = model();
    hangWocHeadAtBuild(m, 'male', 'lod0', null);
    // its hairstyle is there, its core and beard are not: what is resident hangs
    expect(inGraph(m)).toEqual(['WocHead_A_hair_swept']);
    expect(loads.calls).toEqual([CORE]);
  });

  it('a throwaway is built with no head at all, and a far bake hangs exactly its part set', () => {
    installAll();
    const library = splitHeadScenes('a', piece);
    // the hairstyle ships a far level (a glTF primitive has no groups: a box does)
    const levelled = (url: string, name: string): THREE.BufferGeometry => {
      const mesh = library.get(url)?.scene.getObjectByName(name) as THREE.Mesh;
      const index = mesh.geometry.index as THREE.BufferAttribute;
      const far = new THREE.BufferAttribute(new Uint16Array([...index.array].slice(0, 6)), 1);
      mesh.geometry.clearGroups();
      setGeometryLod(mesh.geometry, { far });
      setWocHeadFileForTest(url, library.get(url) ?? null);
      return mesh.geometry;
    };
    const sweptGeometry = levelled(SWEPT, 'WocHead_A_hair_swept');
    const temp = model();
    // no `born` look: assembleModel's step notes the model and hangs nothing
    hangWocHeadAtBuild(temp, 'male', 'far');
    expect(wocHeadRigOf(temp)).toBeNull();
    expect(inGraph(temp)).toEqual([]);
    // the bake's part set: head pieces of three files, an armor part, another type's piece
    hangWocHeadNamed(temp, [
      'WocHead_A_base',
      'Armor_Chest',
      'WocHead_A_hair_swept',
      'WocHead_A_beard_goatee',
      'WocHead_B_base',
    ]);
    expect(inGraph(temp)).toEqual([
      'WocHead_A_base',
      'WocHead_A_beard_goatee',
      'WocHead_A_hair_swept',
    ]);
    // ...at the level the model was built at: the far one
    const swept = temp.getObjectByName('WocHead_A_hair_swept') as THREE.Mesh;
    expect(swept.geometry).toBe(geometryLodVariant(sweptGeometry, 'far'));
    expect(swept.geometry).not.toBe(sweptGeometry);
    // asked again: nothing doubles
    hangWocHeadNamed(temp, ['WocHead_A_base', 'WocHead_A_nose_default']);
    expect(inGraph(temp)).toEqual([
      'WocHead_A_base',
      'WocHead_A_beard_goatee',
      'WocHead_A_hair_swept',
      'WocHead_A_nose_default',
    ]);
    // a model this store never built is left untouched
    const stranger = model();
    hangWocHeadNamed(stranger, ['WocHead_A_base']);
    expect(wocHeadRigOf(stranger)).toBeNull();
  });
});
