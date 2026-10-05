// The WOC head library store (woc_head_packs.ts) over a mocked loader: one fetch per
// split file (memoized, resident once parsed, ready listeners told the url), a failed
// fetch re-armed only after its cooldown, the creator's prefetches fetching EXACTLY the
// files they name (a slot's files; a look's core, hairstyle and facial hair), and the
// hang: one wrapper per file on the head bone, pieces hidden, files aggregated per model.
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

import { DEFAULT_APPEARANCE } from '../src/render/characters/modular';
import {
  wocHeadAllUrls,
  wocHeadCoreUrl,
  wocHeadPieceUrl,
} from '../src/render/characters/woc_head_catalog';
import {
  ensureWocHeadCoreForFit,
  ensureWocHeadFile,
  ensureWocHeadForAppearance,
  hangWocHead,
  hangWocHeadFile,
  onWocHeadFileReady,
  prefetchWocHeadLook,
  prefetchWocHeadSlot,
  resetWocHeadFilesForTest,
  setWocHeadFileForTest,
  unhangWocHead,
  WOC_HEAD_WRAPPER,
  wocHeadAppearanceResident,
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
