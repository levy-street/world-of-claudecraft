// The WOC head's three.js half (woc_head_packs.ts + woc_head_dressing.ts) over a
// synthetic SPLIT library (the core, one file per hairstyle, the beard files). A body
// carries only the pieces its look draws: a piece it no longer draws leaves its scene
// graph (and its tint clone goes with it), one it starts to draw is hung on the spot.
// WHOLE LOOK (the default: a preview, a portrait): the body is AWAITED (its host draws
// none of it) until EVERY piece of the look is hung AND revealed (never a headless
// body, never a bald one popping its hair later), and a failed file ends that wait.
// BARE STAND-IN (the world view's opt-in): the head goes live on its core alone, the
// bare head standing in for a hairstyle or a beard still on the wire or failed, which
// joins hidden until linked; the body never waits. In both, a later change of any piece
// keeps the old one drawn until the new one is revealed, bald and clean shaven need no
// file, a look change happens in place on the same model, the helm hides the hair (which
// stays hung), and every head material (a late piece's too) and the body's skin are
// wrapped with their tint layer. The body's layer follows the body ATLAS
// (woc_skin_tint_core.ts): on under its own suit, off under a class under-armor atlas,
// a uniform write either way. Asked to (setMerged), the head also draws as ONE mesh
// (woc_head_merge.ts): planned by every pass, mounted from the poll (or by the unit the
// poll queued on the host's work queue) once the head is whole, at rest and drawn,
// hidden until its programs are linked (a head whose program a witness still proves
// skips that gate: woc_head_merge_proof_core.ts), dropped by whatever changes the drawn
// head, and tinted through the merged layer's uniform rows.
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loads = vi.hoisted(() => ({ calls: [] as string[], fail: new Set<string>() }));
// every fetch the dressing kicks is recorded and never lands (or fails, for a url a case
// put in `loads.fail`): a file is resident only when a case installs it
// (setWocHeadFileForTest)
vi.mock('../src/render/assets/loader', () => ({
  loadGltf: vi.fn((url: string) => {
    loads.calls.push(url);
    return loads.fail.has(url)
      ? Promise.reject(new Error('offline'))
      : new Promise(() => undefined);
  }),
}));

import { DEFAULT_APPEARANCE, skinColor } from '../src/render/characters/modular';
import {
  createSurfaceResponseMaterial,
  surfaceResponseUniforms,
} from '../src/render/characters/surface_response';
import {
  WOC_HEAD_TYPES,
  wocHeadAllNodes,
  wocHeadCoreUrl,
  wocHeadPieceUrl,
  wocHeadVisibleNodes,
} from '../src/render/characters/woc_head_catalog';
import {
  applyWocHeadBakeVisibility,
  WOC_HEAD_HANG_LABEL,
  WOC_HEAD_MERGE_LABEL,
  WOC_HEAD_MOUNT_LABEL,
  WocHeadDressing,
  type WocHeadDressingHost,
} from '../src/render/characters/woc_head_dressing';
import { hexToLinear } from '../src/render/characters/woc_head_look_core';
import { wocHeadMergeInternalsForTest } from '../src/render/characters/woc_head_merge';
import { WOC_HEAD_MERGE_MAX_SLOTS } from '../src/render/characters/woc_head_merge_core';
import {
  failWocHeadFileForTest,
  hangWocHead,
  hangWocHeadAtBuild,
  resetWocHeadFilesForTest,
  setWocHeadFileForTest,
  wocHeadFileMaterial,
  wocHeadRigOf,
} from '../src/render/characters/woc_head_packs';
import { wocHeadMergedTintOf, wocHeadTintOf } from '../src/render/characters/woc_head_tint';
import { cloneMaterialWithHooks } from '../src/render/material_clone_hooks';
import { splitHeadScene, splitHeadScenes } from './helpers/woc_head_split_fixture';

function mat(name: string): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial();
  m.name = name;
  return m;
}

/** A base-like model: a two-bone skinned body that ends at the neck (no head of its own). */
function baseModel(): THREE.Object3D {
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
  const body = new THREE.SkinnedMesh(geo, mat('body'));
  body.name = 'Character_Body';
  root.add(body);
  root.updateMatrixWorld(true);
  body.bind(new THREE.Skeleton([hips, head]));
  return root;
}

/** The morph targets a synthetic piece carries, the way the export ships them:
 *  the chin rides the head, the lips, the nose and every beard; the bald crown
 *  and the scalp tucks only the base; the eye controls the eyes; the hair none. */
function targetsOf(name: string): string[] {
  if (name.endsWith('_base')) {
    return ['FS_Chin_Softness', 'FS_Bald_Crown', 'FS_Tuck_swept', 'FS_Tuck_long'];
  }
  if (name.includes('_beard_') || name.includes('_mouth_') || name.includes('_nose_')) {
    return ['FS_Chin_Softness'];
  }
  if (name.includes('_eyes_')) return ['FS_Eyes_Size'];
  return [];
}

/** One piece: a mesh on a material named with its tint role (facial hair is a hair_
 *  material: it takes the hair colour). */
function piece(name: string): THREE.Mesh {
  const role = name.includes('_beard_')
    ? 'hair_beard_x'
    : name.includes('_hair_')
      ? 'hair_x'
      : name.includes('_brows_')
        ? 'brow_x'
        : name.includes('_eyes_')
          ? 'eye_x'
          : name.includes('piercing')
            ? 'metal_gold'
            : 'skin_x';
  const g = new THREE.BoxGeometry(0.05, 0.05, 0.05);
  const targets = targetsOf(name);
  g.morphAttributes.position = targets.map(() => g.getAttribute('position').clone());
  const m = new THREE.Mesh(g, mat(role));
  m.name = name;
  if (targets.length > 0) {
    m.morphTargetDictionary = Object.fromEntries(targets.map((t, i) => [t, i]));
    m.morphTargetInfluences = targets.map(() => 0);
  }
  return m;
}

/** Type A's split library, one scene per file. */
const LIBRARY = splitHeadScenes('a', piece);
const CORE = wocHeadCoreUrl('a');
const hairUrl = (id: string): string => wocHeadPieceUrl('a', 'hair', id) as string;
const beardUrl = (id: string): string => wocHeadPieceUrl('a', 'beard', id) as string;
const DEFAULT_HAIR = WOC_HEAD_TYPES.a.defaults.hair;
const DEFAULT_BEARD = WOC_HEAD_TYPES.a.defaults.beard;

/** Make these files resident (as landed parses). */
function install(...urls: string[]): void {
  for (const url of urls) {
    const gltf = LIBRARY.get(url);
    if (!gltf) throw new Error(`no fixture file ${url}`);
    setWocHeadFileForTest(url, gltf);
  }
}
const installAll = (): void => install(...LIBRARY.keys());

/** A body as assembleModel builds it (woc_head_packs.ts hangWocHeadAtBuild): the pieces
 *  the look of `app` draws (null: Type A's default look) hung out of the files resident
 *  right now, and nothing else of the library. */
function bornModel(app: Record<string, unknown> | null = null): THREE.Object3D {
  const model = baseModel();
  hangWocHeadAtBuild(model, 'male', 'lod0', app);
  return model;
}

/** A host whose reveals wait (gated: the compile gate in flight) or land at once. */
function host(model: THREE.Object3D, gated: boolean) {
  const reveals: ((prepared: boolean) => void)[] = [];
  const forgotten: THREE.Object3D[] = [];
  let relived = 0;
  const h: WocHeadDressingHost = {
    model,
    adopt: (_node, retint) => retint(),
    forget: (node) => {
      forgotten.push(node);
    },
    reveal: (_node, live) => {
      if (gated) reveals.push(live);
      else live(true);
    },
    relive: () => {
      relived++;
    },
    // no effect overlay and no far mesh in this fake: a mesh draws what it wears
    baseMaterial: (mesh) => mesh.material,
    rigDrawn: () => true,
  };
  /** Settle every reveal in flight (the gate linked). */
  const link = (): void => {
    for (const live of reveals.splice(0)) live(true);
  };
  return { h, link, forgotten, relived: () => relived, inFlight: () => reveals.length };
}

const visible = (model: THREE.Object3D, name: string): boolean =>
  model.getObjectByName(name)?.visible === true;

/** Every hung head piece by node name. */
function hangedPieces(model: THREE.Object3D): Map<string, THREE.Object3D> {
  const out = new Map<string, THREE.Object3D>();
  model.traverse((o) => {
    if (o.name.startsWith('WocHead_')) out.set(o.name, o);
  });
  return out;
}

/** The hair pieces drawn right now. */
const drawnHair = (model: THREE.Object3D): string[] =>
  [...hangedPieces(model)]
    .filter(([name, o]) => name.includes('_hair_') && o.visible)
    .map(([name]) => name);

/** A hung piece's influence for one morph target, or undefined when it has none. */
function influence(model: THREE.Object3D, node: string, target: string): number | undefined {
  const mesh = model.getObjectByName(node) as THREE.Mesh | undefined;
  const at = mesh?.morphTargetDictionary?.[target];
  return at === undefined ? undefined : mesh?.morphTargetInfluences?.[at];
}

/** The pieces Type A's default look draws (all a body in it hangs). */
const DEFAULT_NODES = wocHeadVisibleNodes('a', WOC_HEAD_TYPES.a.defaults, { helm: false });

/** A model born in the default look, the whole library resident, and a dressing live on it. */
function liveDressing(gated = false) {
  installAll();
  const model = bornModel();
  const hh = host(model, gated);
  const dressing = new WocHeadDressing(hh.h, 'a');
  dressing.retint();
  expect(dressing.poll()).toBe(true); // went live on the look it was born with
  return { model, dressing, ...hh };
}

beforeEach(() => {
  loads.calls.length = 0;
  loads.fail.clear();
});
afterEach(() => resetWocHeadFilesForTest());

describe('WocHeadDressing: going live on a streamed look', () => {
  it('keeps the body awaited until the core, the hairstyle AND the beard are all hung and revealed', () => {
    const model = baseModel();
    const { h, link, relived } = host(model, true);
    const dressing = new WocHeadDressing(h, 'a');
    // Type A opens bearded: its look is the core, the swept hair and the beards file
    expect(dressing.lookUrls).toEqual([CORE, hairUrl(DEFAULT_HAIR), beardUrl(DEFAULT_BEARD)]);
    expect(dressing.poll()).toBe(false); // nothing resident
    expect(dressing.awaited).toBe(true);
    // the core lands and links: still no head (the look's hair and beard stream)
    install(CORE);
    expect(dressing.poll()).toBe(true);
    link();
    expect(dressing.isLive).toBe(false);
    expect(dressing.awaited).toBe(true);
    expect(visible(model, 'WocHead_A_base')).toBe(false);
    expect(dressing.drawnNames.size).toBe(0);
    // the hairstyle too: still no head (never a beardless one popping its beard later)
    install(hairUrl(DEFAULT_HAIR));
    expect(dressing.poll()).toBe(true);
    link();
    expect(dressing.isLive).toBe(false);
    expect(dressing.awaited).toBe(true);
    expect(visible(model, `WocHead_A_hair_${DEFAULT_HAIR}`)).toBe(false);
    // the beards land: hung but still linking, the body still waits
    install(beardUrl(DEFAULT_BEARD));
    expect(dressing.poll()).toBe(true);
    expect(dressing.isLive).toBe(false);
    expect(dressing.awaited).toBe(true);
    expect(relived()).toBe(0);
    link();
    // every file of the look is revealed: live, and the wait ends in the same step
    expect(dressing.isLive).toBe(true);
    expect(dressing.awaited).toBe(false);
    expect(relived()).toBe(1);
    expect(visible(model, 'WocHead_A_base')).toBe(true);
    expect(visible(model, `WocHead_A_hair_${DEFAULT_HAIR}`)).toBe(true);
    expect(visible(model, `WocHead_A_beard_${DEFAULT_BEARD}`)).toBe(true);
    expect(dressing.drawnNames.has('WocHead_A_base')).toBe(true);
    // settled: the next poll is free and reports nothing
    expect(dressing.poll()).toBe(false);
  });

  it('never goes live in its constructor, then goes live on the look it is handed', () => {
    installAll();
    const app = { ...DEFAULT_APPEARANCE, headHair: 'long' };
    // built for its own look: its pieces hung with the body, never the default look's
    const model = bornModel(app);
    const { h, inFlight } = host(model, true);
    const dressing = new WocHeadDressing(h, 'a', 'lod0', app);
    dressing.retint();
    // every piece of its look is hung, but no look was handed in yet: nothing of the head
    // draws, and the body waits for the look
    expect(dressing.isLive).toBe(false);
    expect(dressing.awaited).toBe(true);
    expect(drawnHair(model)).toEqual([]);
    // the player's look: live at once, on ITS hairstyle (never the default first), and
    // with no gate at all (the pieces ride the body's own first draw)
    expect(dressing.setAppearance(app)).toBe(true);
    expect(dressing.isLive).toBe(true);
    expect(drawnHair(model)).toEqual(['WocHead_A_hair_long']);
    expect(dressing.awaited).toBe(false);
    expect(inFlight()).toBe(0);
    // the default hairstyle was never on this body
    expect(model.getObjectByName(`WocHead_A_hair_${DEFAULT_HAIR}`)).toBeUndefined();
  });

  it("a body born in the default look and handed another draws nothing of the default's", () => {
    installAll();
    // a body built directly (a preview): the default look's pieces hung with it
    const model = bornModel();
    const { h, link } = host(model, true);
    const dressing = new WocHeadDressing(h, 'a');
    dressing.retint();
    expect(model.getObjectByName(`WocHead_A_hair_${DEFAULT_HAIR}`)).toBeDefined();
    // its own look: the new hairstyle is hung in the same call (its file is resident),
    // behind the gate...
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headHair: 'long' });
    expect(dressing.isLive).toBe(false);
    expect(drawnHair(model)).toEqual([]);
    expect(model.getObjectByName('WocHead_A_hair_long')).toBeDefined();
    // ...and the default's, which this head will never draw, is off the body already
    expect(model.getObjectByName(`WocHead_A_hair_${DEFAULT_HAIR}`)).toBeUndefined();
    link();
    expect(dressing.isLive).toBe(true);
    expect(drawnHair(model)).toEqual(['WocHead_A_hair_long']);
  });

  it('born with its default look repeated: live on the repeat (a change for the caller)', () => {
    installAll();
    const model = bornModel();
    const dressing = new WocHeadDressing(host(model, true).h, 'a');
    // the same look as the default key, handed in: the head goes live on it
    expect(dressing.setAppearance(null)).toBe(true);
    expect(dressing.isLive).toBe(true);
    // ...and a second repeat is no work
    expect(dressing.setAppearance(null)).toBe(false);
  });

  it("a body built before its OWN hairstyle landed waits for it, never drawing the default's", () => {
    // the default look's files are resident at build, the player's hairstyle is not
    install(CORE, hairUrl(DEFAULT_HAIR), beardUrl(DEFAULT_BEARD));
    const model = bornModel();
    const { h, link } = host(model, true);
    const dressing = new WocHeadDressing(h, 'a');
    dressing.retint();
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headHair: 'mohawk' });
    // not live: the body waits, and no hairstyle at all (the default's is never shown)
    expect(dressing.isLive).toBe(false);
    expect(dressing.awaited).toBe(true);
    expect(drawnHair(model)).toEqual([]);
    // its file was kicked the moment the look was set
    expect(loads.calls).toContain(hairUrl('mohawk'));
    expect(dressing.poll()).toBe(false);
    install(hairUrl('mohawk'));
    expect(dressing.poll()).toBe(true);
    expect(dressing.isLive).toBe(false);
    link();
    expect(dressing.isLive).toBe(true);
    expect(drawnHair(model)).toEqual(['WocHead_A_hair_mohawk']);
  });

  it('waiting on a streaming file costs the frame no re-dress: poll never re-applies the head', () => {
    install(CORE, beardUrl(DEFAULT_BEARD));
    const model = bornModel();
    const { h, link } = host(model, true);
    const dressing = new WocHeadDressing(h, 'a');
    dressing.retint();
    dressing.setAppearance(null); // the default hair is still streaming
    expect(dressing.isLive).toBe(false);
    const apply = vi.spyOn(dressing, 'apply');
    for (let i = 0; i < 10; i++) expect(dressing.poll()).toBe(false);
    // ...and a repeat of the same look while waiting is no work either
    expect(dressing.setAppearance(null)).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    // the file lands: one attach, one live step, then settled (free) polls again
    install(hairUrl(DEFAULT_HAIR));
    expect(dressing.poll()).toBe(true);
    link();
    expect(dressing.isLive).toBe(true);
    apply.mockClear();
    for (let i = 0; i < 10; i++) expect(dressing.poll()).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it('bald and clean shaven need no piece file: the core alone goes live', () => {
    const model = baseModel();
    const { h, link } = host(model, true);
    const dressing = new WocHeadDressing(h, 'a');
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headHair: 'bald', headBeard: 'none' });
    expect(dressing.lookUrls).toEqual([CORE]);
    install(CORE);
    expect(dressing.poll()).toBe(true);
    link();
    expect(dressing.isLive).toBe(true);
    expect(visible(model, 'WocHead_A_base')).toBe(true);
    expect(dressing.awaited).toBe(false);
    // no hairstyle or beard file was ever asked for, and none is hung
    expect(loads.calls).toEqual([CORE]);
    expect([...(wocHeadRigOf(model)?.files.keys() ?? [])]).toEqual([CORE]);
    expect(influence(model, 'WocHead_A_base', 'FS_Bald_Crown')).toBe(1);
  });
});

describe('WocHeadDressing: a head file that cannot arrive ends the wait', () => {
  it('a failed fetch: the body is no longer awaited, and goes live when a later load lands', async () => {
    install(CORE, beardUrl(DEFAULT_BEARD));
    loads.fail.add(hairUrl(DEFAULT_HAIR));
    const model = bornModel();
    const { h } = host(model, false);
    const dressing = new WocHeadDressing(h, 'a');
    dressing.setAppearance(null);
    // the hairstyle is on the wire: the body waits
    expect(dressing.isLive).toBe(false);
    expect(dressing.awaited).toBe(true);
    // its fetch fails: a dead request never hides a character, the body draws headless
    await vi.waitFor(() => expect(dressing.awaited).toBe(false));
    expect(dressing.isLive).toBe(false);
    expect(drawnHair(model)).toEqual([]);
    expect(visible(model, 'WocHead_A_base')).toBe(false);
    // a retry lands later: the head goes live on the next poll
    install(hairUrl(DEFAULT_HAIR));
    expect(dressing.poll()).toBe(true);
    expect(dressing.isLive).toBe(true);
    expect(dressing.awaited).toBe(false);
    expect(drawnHair(model)).toEqual([`WocHead_A_hair_${DEFAULT_HAIR}`]);
  });

  it('a file that cannot hang on this body: refused, and the body is not awaited', () => {
    installAll();
    // a body with no `head` bone: nothing can hang
    const model = new THREE.Group();
    const { h } = host(model, false);
    const dressing = new WocHeadDressing(h, 'a');
    expect(dressing.awaited).toBe(true); // resident, not tried yet
    const missed = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // the look is handed in: every file is tried on the spot, and none can hang
    dressing.setAppearance(null);
    expect(dressing.isLive).toBe(false);
    expect(dressing.awaited).toBe(false);
    expect(wocHeadRigOf(model)).toBeNull();
    // refused for good: a poll never tries the same file again
    const tries = missed.mock.calls.length;
    for (let i = 0; i < 3; i++) dressing.poll();
    expect(missed.mock.calls.length).toBe(tries);
    expect(dressing.awaited).toBe(false);
    vi.restoreAllMocks();
  });

  it('a piece its resident file does not carry never keeps the head back', () => {
    // the core ships without the default nose: nothing will ever draw it
    const core = splitHeadScene(
      [...(LIBRARY.get(CORE)?.scene.children[0].children ?? [])]
        .map((node) => node.name)
        .filter((name) => name !== 'WocHead_A_nose_default'),
      piece,
    );
    setWocHeadFileForTest(CORE, core);
    install(hairUrl(DEFAULT_HAIR), beardUrl(DEFAULT_BEARD));
    const model = bornModel();
    const dressing = new WocHeadDressing(host(model, false).h, 'a');
    dressing.retint();
    // whole look: live all the same, on every piece that exists
    expect(dressing.setAppearance(null)).toBe(true);
    expect(dressing.isLive).toBe(true);
    expect(dressing.awaited).toBe(false);
    expect(model.getObjectByName('WocHead_A_nose_default')).toBeUndefined();
    expect(visible(model, 'WocHead_A_base')).toBe(true);
    expect(dressing.poll()).toBe(false);
  });
});

describe('WocHeadDressing: the bare head stands in (a body in the world)', () => {
  /** A world body: born with whatever of its look is resident, the stand-in opted into
   *  before the look is handed in (src/render/characters/index.ts createCharacterVisual). */
  function worldBody(app: Record<string, unknown> | null, gated = true) {
    const model = bornModel(app);
    const hh = host(model, gated);
    const dressing = new WocHeadDressing(hh.h, 'a', 'lod0', app);
    dressing.retint();
    dressing.setBareStandIn(true);
    dressing.setAppearance(app);
    return { model, dressing, ...hh };
  }
  const beardDrawn = (model: THREE.Object3D): string[] =>
    [...hangedPieces(model)]
      .filter(([name, o]) => name.includes('_beard_') && o.visible)
      .map(([name]) => name);

  it('every file resident: live at once on the whole look, with no gate', () => {
    install(CORE, hairUrl(DEFAULT_HAIR), beardUrl(DEFAULT_BEARD));
    const { model, dressing, inFlight } = worldBody(null);
    expect(dressing.isLive).toBe(true);
    expect(dressing.awaited).toBe(false);
    expect(dressing.joining).toBe(false);
    expect([...dressing.drawnNames].sort()).toEqual([...DEFAULT_NODES].sort());
    expect(drawnHair(model)).toEqual([`WocHead_A_hair_${DEFAULT_HAIR}`]);
    expect(inFlight()).toBe(0);
    expect(dressing.poll()).toBe(false);
  });

  it('a hairstyle still on the wire: live at once, bald, and it joins hidden until linked', () => {
    install(CORE, beardUrl(DEFAULT_BEARD));
    const { model, dressing, link, relived } = worldBody(null);
    // live from the first frame, never awaited: the body draws, the bare head standing in
    expect(dressing.isLive).toBe(true);
    expect(dressing.awaited).toBe(false);
    expect(visible(model, 'WocHead_A_base')).toBe(true);
    expect(drawnHair(model)).toEqual([]);
    expect(beardDrawn(model)).toEqual([`WocHead_A_beard_${DEFAULT_BEARD}`]);
    // what it draws is the look, bald: the bald crown, no scalp tuck
    expect(dressing.look.look.hair).toBe(DEFAULT_HAIR);
    expect(dressing.drawnLook?.hair).toBe('bald');
    expect(influence(model, 'WocHead_A_base', 'FS_Bald_Crown')).toBe(1);
    expect(influence(model, 'WocHead_A_base', 'FS_Tuck_swept')).toBe(0);
    // its file was asked for, and the head is about to change
    expect(loads.calls).toContain(hairUrl(DEFAULT_HAIR));
    expect(dressing.joining).toBe(true);
    for (let i = 0; i < 3; i++) expect(dressing.poll()).toBe(false);
    expect(relived()).toBe(0);
    // it lands: hung, hidden behind the gate, the bare head still what draws
    install(hairUrl(DEFAULT_HAIR));
    expect(dressing.poll()).toBe(true);
    const hair = model.getObjectByName(`WocHead_A_hair_${DEFAULT_HAIR}`);
    expect(hair).toBeDefined();
    expect(drawnHair(model)).toEqual([]);
    expect(dressing.joining).toBe(true);
    expect(relived()).toBe(0);
    // linked: it joins in that step, the scalp tucked under it, and the host is told (the
    // far bake and the merged stand-in key on what is drawn)
    link();
    expect(drawnHair(model)).toEqual([`WocHead_A_hair_${DEFAULT_HAIR}`]);
    expect(dressing.drawnLook?.hair).toBe(DEFAULT_HAIR);
    expect(influence(model, 'WocHead_A_base', 'FS_Bald_Crown')).toBe(0);
    expect(influence(model, 'WocHead_A_base', 'FS_Tuck_swept')).toBe(1);
    expect(relived()).toBe(1);
    expect(dressing.joining).toBe(false);
    expect(dressing.poll()).toBe(false);
  });

  it('a hairstyle whose fetch FAILED never hides, beheads or delays the body, and joins when a retry lands', async () => {
    install(CORE, beardUrl(DEFAULT_BEARD));
    loads.fail.add(hairUrl(DEFAULT_HAIR));
    const { model, dressing, link } = worldBody(null);
    expect(dressing.isLive).toBe(true);
    expect(dressing.awaited).toBe(false);
    await vi.waitFor(() => expect(dressing.joining).toBe(false));
    // at rest in what it holds: the head, its face and its beard, no hairstyle
    expect(visible(model, 'WocHead_A_base')).toBe(true);
    expect(drawnHair(model)).toEqual([]);
    expect(beardDrawn(model)).toEqual([`WocHead_A_beard_${DEFAULT_BEARD}`]);
    // it keeps asking (the store's own cooldown paces the retries), never settling
    for (let i = 0; i < 3; i++) expect(dressing.poll()).toBe(false);
    // a retry lands: hung and revealed like any late piece
    install(hairUrl(DEFAULT_HAIR));
    expect(dressing.poll()).toBe(true);
    link();
    expect(drawnHair(model)).toEqual([`WocHead_A_hair_${DEFAULT_HAIR}`]);
    expect(dressing.poll()).toBe(false);
  });

  it('a beard whose fetch failed: clean shaven meanwhile, the hairstyle drawn', async () => {
    install(CORE, hairUrl(DEFAULT_HAIR));
    loads.fail.add(beardUrl(DEFAULT_BEARD));
    const { model, dressing, link } = worldBody(null);
    expect(dressing.isLive).toBe(true);
    expect(dressing.awaited).toBe(false);
    expect(drawnHair(model)).toEqual([`WocHead_A_hair_${DEFAULT_HAIR}`]);
    expect(beardDrawn(model)).toEqual([]);
    expect(dressing.drawnLook?.beard).toBe('none');
    await vi.waitFor(() => expect(dressing.joining).toBe(false));
    install(beardUrl(DEFAULT_BEARD));
    dressing.poll();
    link();
    expect(beardDrawn(model)).toEqual([`WocHead_A_beard_${DEFAULT_BEARD}`]);
    // of the seven beards its file ships, the one it draws is all that was hung
    expect([...hangedPieces(model).keys()].filter((name) => name.includes('_beard_'))).toEqual([
      `WocHead_A_beard_${DEFAULT_BEARD}`,
    ]);
  });

  it('neither there yet: each joins as its own file lands, in whichever order', () => {
    install(CORE);
    const app = { ...DEFAULT_APPEARANCE, headHair: 'long', headBeard: 'handlebar' };
    const { model, dressing, link, relived } = worldBody(app);
    expect(dressing.isLive).toBe(true);
    expect(drawnHair(model)).toEqual([]);
    expect(beardDrawn(model)).toEqual([]);
    install(beardUrl('handlebar'));
    dressing.poll();
    link();
    expect(beardDrawn(model)).toEqual(['WocHead_A_beard_handlebar']);
    expect(drawnHair(model)).toEqual([]);
    expect(dressing.joining).toBe(true);
    install(hairUrl('long'));
    dressing.poll();
    link();
    expect(drawnHair(model)).toEqual(['WocHead_A_hair_long']);
    expect(relived()).toBe(2);
    expect(dressing.joining).toBe(false);
  });

  it('the core missing: no head to draw, the body still not awaited, live when it lands', () => {
    // its hairstyle and beard are resident, its core is not
    install(hairUrl(DEFAULT_HAIR), beardUrl(DEFAULT_BEARD));
    const { model, dressing, link, relived } = worldBody(null);
    expect(dressing.isLive).toBe(false);
    // a body in the world never waits on a head file, the core included
    expect(dressing.awaited).toBe(false);
    expect(dressing.drawnNames.size).toBe(0);
    // nothing of a head is drawn without the head itself: no hair floating on a neck
    expect(drawnHair(model)).toEqual([]);
    expect(dressing.joining).toBe(true);
    install(CORE);
    expect(dressing.poll()).toBe(true);
    expect(dressing.isLive).toBe(false);
    link();
    expect(dressing.isLive).toBe(true);
    expect([...dressing.drawnNames].sort()).toEqual([...DEFAULT_NODES].sort());
    expect(relived()).toBe(1);
  });

  it('a later pick holds the old piece exactly as before: the opt-in changes only how a head is born', () => {
    install(CORE, hairUrl(DEFAULT_HAIR), beardUrl(DEFAULT_BEARD));
    const { model, dressing, link } = worldBody(null);
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headHair: 'mohawk' });
    // never bald in between: the swept hair stays until the mohawk is linked
    expect(drawnHair(model)).toEqual([`WocHead_A_hair_${DEFAULT_HAIR}`]);
    install(hairUrl('mohawk'));
    dressing.poll();
    expect(drawnHair(model)).toEqual([`WocHead_A_hair_${DEFAULT_HAIR}`]);
    link();
    expect(drawnHair(model)).toEqual(['WocHead_A_hair_mohawk']);
  });

  it('WITHOUT the opt-in the same body waits whole: a preview never draws a bare head', () => {
    install(CORE, beardUrl(DEFAULT_BEARD));
    const model = bornModel();
    const { h, link } = host(model, true);
    const dressing = new WocHeadDressing(h, 'a');
    dressing.retint();
    dressing.setAppearance(null);
    expect(dressing.isLive).toBe(false);
    expect(dressing.awaited).toBe(true);
    expect(visible(model, 'WocHead_A_base')).toBe(false);
    install(hairUrl(DEFAULT_HAIR));
    dressing.poll();
    link();
    expect(dressing.isLive).toBe(true);
    expect(drawnHair(model)).toEqual([`WocHead_A_hair_${DEFAULT_HAIR}`]);
  });

  it('a replaced gate: a hairstyle still linking is asked of the new one, and the old settle counts for nothing', () => {
    install(CORE, beardUrl(DEFAULT_BEARD));
    const model = bornModel();
    const reveals: { node: THREE.Object3D; live: (prepared: boolean) => void }[] = [];
    const { h } = host(model, true);
    h.reveal = (node, live) => {
      reveals.push({ node, live });
    };
    const dressing = new WocHeadDressing(h, 'a');
    dressing.retint();
    dressing.setBareStandIn(true);
    dressing.setAppearance(null);
    install(hairUrl(DEFAULT_HAIR));
    dressing.poll();
    expect(reveals).toHaveLength(1);
    expect(drawnHair(model)).toEqual([]);
    // the body is handed to another renderer generation while the hairstyle links: its old
    // gate may never settle, so the same wrapper is asked of the new one
    dressing.gateChanged();
    expect(reveals).toHaveLength(2);
    expect(reveals[1].node).toBe(reveals[0].node);
    // the old gate settling late shows nothing: its link proves nothing of the new context
    reveals[0].live(true);
    expect(drawnHair(model)).toEqual([]);
    expect(dressing.joining).toBe(true);
    // the new gate's settle is the one that counts
    reveals[1].live(true);
    expect(drawnHair(model)).toEqual([`WocHead_A_hair_${DEFAULT_HAIR}`]);
    expect(dressing.joining).toBe(false);
    // nothing in flight: another gate change asks for nothing
    dressing.gateChanged();
    expect(reveals).toHaveLength(2);
  });

  /** A world body with the renderer's work queue behind it (and its gate in flight). */
  function queuedWorldBody() {
    const model = bornModel(null);
    const hh = worldHost(model, { gated: true, queue: true });
    const dressing = new WocHeadDressing(hh.h, 'a', 'lod0', null);
    dressing.retint();
    dressing.setBareStandIn(true);
    dressing.setAppearance(null);
    return { model, dressing, ...hh };
  }
  const HAIR_NODE = `WocHead_A_hair_${DEFAULT_HAIR}`;

  it('with a work queue behind the host, a landed file hangs as ONE queued unit, never inside the poll', () => {
    expect(WOC_HEAD_HANG_LABEL).toBe('woc-head-hang');
    install(CORE, beardUrl(DEFAULT_BEARD));
    const { model, dressing, link, queued, runQueued, state } = queuedWorldBody();
    expect(dressing.isLive).toBe(true);
    // nothing to hang while the file is on the wire: no unit
    dressing.poll();
    expect(queued).toEqual([]);
    // it lands: the poll asks the queue and hangs nothing itself (guards: a crowd that
    // waited for one file all hung it, cloned and re-dressed in the frame it landed)
    install(hairUrl(DEFAULT_HAIR));
    expect(dressing.poll()).toBe(false);
    expect(queued.map((unit) => unit.label)).toEqual(['woc-head-hang:a']);
    expect(model.getObjectByName(HAIR_NODE)).toBeUndefined();
    // still on its way: the far bake and the merged stand-in keep waiting
    expect(dressing.joining).toBe(true);
    // later frames, the unit still queued: never a second one
    dressing.poll();
    dressing.poll();
    expect(queued).toHaveLength(1);
    // its turn: hung hidden behind the gate, and the host told to re-dress (no poll is
    // running to hear a return value)
    const before = state.relived;
    runQueued();
    expect(model.getObjectByName(HAIR_NODE)).toBeDefined();
    expect(drawnHair(model)).toEqual([]);
    expect(state.relived).toBe(before + 1);
    expect(dressing.poll()).toBe(false);
    expect(queued).toEqual([]);
    link();
    expect(drawnHair(model)).toEqual([HAIR_NODE]);
    expect(dressing.joining).toBe(false);
  });

  it('one queued unit hangs everything that landed by its turn', () => {
    install(CORE);
    const { model, dressing, link, queued, runQueued } = queuedWorldBody();
    install(hairUrl(DEFAULT_HAIR));
    dressing.poll();
    install(beardUrl(DEFAULT_BEARD));
    dressing.poll();
    expect(queued).toHaveLength(1);
    runQueued();
    link();
    expect(drawnHair(model)).toEqual([HAIR_NODE]);
    expect(model.getObjectByName(`WocHead_A_beard_${DEFAULT_BEARD}`)?.visible).toBe(true);
    expect(dressing.poll()).toBe(false);
    expect(queued).toEqual([]);
  });

  it('a queued hang its queue dropped is asked again after a gate change, and a stale or orphaned unit hangs nothing', () => {
    install(CORE);
    const { model, dressing, queued, runQueued } = queuedWorldBody();
    install(hairUrl(DEFAULT_HAIR));
    dressing.poll();
    // the queue it sat on went with its renderer: the unit never runs, and no poll asks twice
    const dropped = queued.splice(0);
    expect(dropped).toHaveLength(1);
    dressing.poll();
    expect(queued).toEqual([]);
    // a gate change (the body handed to the next renderer) lets the head ask again
    dressing.gateChanged();
    dressing.poll();
    expect(queued.map((unit) => unit.label)).toEqual(['woc-head-hang:a']);
    // the dropped unit, should it run after all, belongs to nothing
    for (const unit of dropped) unit.work();
    expect(model.getObjectByName(HAIR_NODE)).toBeUndefined();
    // ...and neither does one whose body was disposed before its turn
    dressing.dispose();
    runQueued();
    expect(model.getObjectByName(HAIR_NODE)).toBeUndefined();
  });

  it('a hang re-asked with no gate left is drawn all the same: revealed means visible', () => {
    install(CORE, beardUrl(DEFAULT_BEARD));
    const model = bornModel(null);
    // the real host's gate: it hides the wrapper it is handed until its link settles
    const hidden: { node: THREE.Object3D; live: (prepared: boolean) => void }[] = [];
    let gate = true;
    const { h } = host(model, true);
    h.reveal = (node, live) => {
      if (!gate) {
        live(true);
        return;
      }
      node.visible = false;
      hidden.push({ node, live });
    };
    const dressing = new WocHeadDressing(h, 'a', 'lod0', null);
    dressing.retint();
    dressing.setBareStandIn(true);
    dressing.setAppearance(null);
    install(hairUrl(DEFAULT_HAIR));
    dressing.poll();
    expect(hidden).toHaveLength(1);
    const wrapper = hidden[0].node;
    expect(wrapper.visible).toBe(false);
    // the gate is taken away while the hang links: asked again, it settles at once
    gate = false;
    dressing.gateChanged();
    expect(drawnHair(model)).toEqual([HAIR_NODE]);
    // guards: its pieces counted as shown while the wrapper the old ask hid stayed hidden
    expect(wrapper.visible).toBe(true);
    expect(dressing.joining).toBe(false);
  });

  it('a head not live yet but a poll away is on its way: its host holds the far bake until it is', () => {
    install(CORE, hairUrl(DEFAULT_HAIR), beardUrl(DEFAULT_BEARD));
    const model = bornModel(null);
    const { h } = host(model, true);
    const dressing = new WocHeadDressing(h, 'a', 'lod0', null);
    dressing.retint();
    dressing.setBareStandIn(true);
    // every piece hung at build, the head live on its first poll: until then what the body
    // draws of its head (nothing) is not what it will keep
    expect(dressing.isLive).toBe(false);
    expect(dressing.joining).toBe(true);
    dressing.poll();
    expect(dressing.isLive).toBe(true);
    expect(dressing.joining).toBe(false);
  });

  it('a head whose core FAILED is not on its way: its body bakes as it is', () => {
    install(hairUrl(DEFAULT_HAIR), beardUrl(DEFAULT_BEARD));
    failWocHeadFileForTest(CORE);
    const model = bornModel(null);
    const { h } = host(model, true);
    const dressing = new WocHeadDressing(h, 'a', 'lod0', null);
    dressing.retint();
    dressing.setBareStandIn(true);
    dressing.setAppearance(null);
    dressing.poll();
    expect(dressing.isLive).toBe(false);
    expect(dressing.awaited).toBe(false);
    expect(dressing.joining).toBe(false);
  });

  it('opting in on a head already waiting lets it go live on the next poll', () => {
    install(CORE, beardUrl(DEFAULT_BEARD));
    const model = bornModel();
    const dressing = new WocHeadDressing(host(model, true).h, 'a');
    dressing.retint();
    dressing.setAppearance(null);
    expect(dressing.awaited).toBe(true);
    dressing.setBareStandIn(true);
    // no longer awaited from that call on, live on the poll
    expect(dressing.awaited).toBe(false);
    expect(dressing.poll()).toBe(true);
    expect(dressing.isLive).toBe(true);
    expect(drawnHair(model)).toEqual([]);
  });
});

describe('WocHeadDressing: a look change while a file streams', () => {
  it('keeps the old hairstyle drawn until the new file is hung and revealed, then swaps', () => {
    // live on the default look (swept), the mohawk not resident yet
    install(CORE, hairUrl(DEFAULT_HAIR), beardUrl(DEFAULT_BEARD));
    const model = bornModel();
    const { h, link, relived } = host(model, true);
    const dressing = new WocHeadDressing(h, 'a');
    dressing.retint();
    dressing.setAppearance(null);
    expect(dressing.isLive).toBe(true);
    const swept = `WocHead_A_hair_${DEFAULT_HAIR}`;
    expect(drawnHair(model)).toEqual([swept]);
    // pick the mohawk: the swept hair stays (no bald frame), its scalp tuck with it
    expect(dressing.setAppearance({ ...DEFAULT_APPEARANCE, headHair: 'mohawk' })).toBe(true);
    expect(dressing.look.look.hair).toBe('mohawk');
    expect(dressing.drawnLook?.hair).toBe(DEFAULT_HAIR);
    expect(drawnHair(model)).toEqual([swept]);
    expect(influence(model, 'WocHead_A_base', 'FS_Tuck_swept')).toBe(1);
    expect(influence(model, 'WocHead_A_base', 'FS_Bald_Crown')).toBe(0);
    expect(loads.calls).toContain(hairUrl('mohawk'));
    // a slot that rides the core is hung in the same call (its file is always there), and
    // holds the old piece the same way until the new one is linked: no hole in the face
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headHair: 'mohawk', headNose: 'broad' });
    expect(model.getObjectByName('WocHead_A_nose_broad')).toBeDefined();
    expect(visible(model, 'WocHead_A_nose_broad')).toBe(false);
    expect(visible(model, 'WocHead_A_nose_default')).toBe(true);
    expect(dressing.drawnLook?.nose).toBe('default');
    link();
    expect(visible(model, 'WocHead_A_nose_broad')).toBe(true);
    // ...and the nose it replaced is off the body
    expect(model.getObjectByName('WocHead_A_nose_default')).toBeUndefined();
    expect(relived()).toBe(1);
    expect(drawnHair(model)).toEqual([swept]);
    // the file lands and hangs, still linking: the swept hair stays
    expect(dressing.poll()).toBe(false);
    install(hairUrl('mohawk'));
    expect(dressing.poll()).toBe(true);
    expect(drawnHair(model)).toEqual([swept]);
    expect(relived()).toBe(1);
    // revealed: swapped in the same step, the tuck with it, and the far bake told
    link();
    expect(drawnHair(model)).toEqual(['WocHead_A_hair_mohawk']);
    expect(dressing.drawnLook?.hair).toBe('mohawk');
    expect(influence(model, 'WocHead_A_base', 'FS_Tuck_swept')).toBe(0);
    expect(relived()).toBe(2);
    expect(dressing.drawnNames.has('WocHead_A_hair_mohawk')).toBe(true);
    expect(dressing.drawnNames.has(swept)).toBe(false);
    // the hairstyle it held meanwhile left with the swap
    expect(model.getObjectByName(swept)).toBeUndefined();
  });

  it('holds the old beard until the new one is revealed, whichever file ships it', () => {
    install(CORE, hairUrl(DEFAULT_HAIR), beardUrl(DEFAULT_BEARD));
    const model = bornModel();
    const { h, link } = host(model, true);
    const dressing = new WocHeadDressing(h, 'a');
    dressing.setAppearance(null);
    const boxed = `WocHead_A_beard_${DEFAULT_BEARD}`;
    expect(visible(model, boxed)).toBe(true);
    // of the seven beards the shared file ships, this body hangs the one it draws
    expect(model.getObjectByName('WocHead_A_beard_goatee')).toBeUndefined();
    // a beard of the same resident file: hung in the same call, the boxed one held until
    // it is linked
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headBeard: 'goatee' });
    expect(model.getObjectByName('WocHead_A_beard_goatee')).toBeDefined();
    expect(visible(model, 'WocHead_A_beard_goatee')).toBe(false);
    expect(visible(model, boxed)).toBe(true);
    link();
    expect(visible(model, 'WocHead_A_beard_goatee')).toBe(true);
    expect(model.getObjectByName(boxed)).toBeUndefined();
    // the handlebar ships alone: the goatee stays until it lands and is revealed
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headBeard: 'handlebar' });
    expect(visible(model, 'WocHead_A_beard_goatee')).toBe(true);
    install(beardUrl('handlebar'));
    dressing.poll();
    expect(visible(model, 'WocHead_A_beard_goatee')).toBe(true);
    expect(visible(model, 'WocHead_A_beard_handlebar')).toBe(false);
    link();
    expect(visible(model, 'WocHead_A_beard_handlebar')).toBe(true);
    expect(model.getObjectByName('WocHead_A_beard_goatee')).toBeUndefined();
  });

  it('a pick changed back before its file lands draws the old one at once, and stays', () => {
    install(CORE, hairUrl(DEFAULT_HAIR), beardUrl(DEFAULT_BEARD));
    const model = bornModel();
    const { h, link, relived } = host(model, true);
    const dressing = new WocHeadDressing(h, 'a');
    dressing.setAppearance(null);
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headHair: 'quiff' });
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headHair: 'long' });
    // both stream; back to the swept hair, which never left
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headHair: DEFAULT_HAIR });
    expect(drawnHair(model)).toEqual([`WocHead_A_hair_${DEFAULT_HAIR}`]);
    // the files landing later hang nothing the look no longer wants
    install(hairUrl('quiff'), hairUrl('long'));
    expect(dressing.poll()).toBe(false);
    link();
    expect(drawnHair(model)).toEqual([`WocHead_A_hair_${DEFAULT_HAIR}`]);
    expect(relived()).toBe(0);
    expect(model.getObjectByName('WocHead_A_hair_long')).toBeUndefined();
  });

  it('a bald head picking a hairstyle stays bald (live, never awaited again) until it is revealed', () => {
    install(CORE, beardUrl(DEFAULT_BEARD));
    const model = bornModel({ ...DEFAULT_APPEARANCE, headHair: 'bald' });
    const { h, link } = host(model, true);
    const dressing = new WocHeadDressing(h, 'a');
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headHair: 'bald' });
    expect(dressing.isLive).toBe(true);
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headHair: 'swept' });
    expect(dressing.isLive).toBe(true);
    expect(dressing.awaited).toBe(false);
    expect(drawnHair(model)).toEqual([]);
    expect(influence(model, 'WocHead_A_base', 'FS_Bald_Crown')).toBe(1);
    install(hairUrl('swept'));
    dressing.poll();
    link();
    expect(drawnHair(model)).toEqual(['WocHead_A_hair_swept']);
    expect(influence(model, 'WocHead_A_base', 'FS_Bald_Crown')).toBe(0);
  });

  it("a NEW subject ('look' hold) keeps the previous head WHOLE, never its hair on the new face", () => {
    install(CORE, hairUrl(DEFAULT_HAIR), beardUrl(DEFAULT_BEARD));
    const model = bornModel();
    const { h, link, relived } = host(model, true);
    const dressing = new WocHeadDressing(h, 'a');
    dressing.retint();
    const red = { ...DEFAULT_APPEARANCE, hairHue: 0, hairSat: 1, hairLight: 0.5 };
    dressing.setAppearance(red);
    const hairTint = wocHeadTintOf(
      (model.getObjectByName(`WocHead_A_hair_${DEFAULT_HAIR}`) as THREE.Mesh)
        .material as THREE.Material,
    );
    // another character on the same stage: a mohawk still streaming, a broad nose, blue
    // hair and a narrow chin; its head is not drawn at all until it can be drawn whole
    const other = {
      ...DEFAULT_APPEARANCE,
      headHair: 'mohawk',
      headNose: 'broad',
      hairHue: 240,
      hairSat: 1,
      hairLight: 0.5,
      headShape: { ...DEFAULT_APPEARANCE.headShape, chinWidth: 1 },
    };
    expect(dressing.setAppearance(other, 'look')).toBe(true);
    expect(dressing.look.look.hair).toBe('mohawk');
    expect(drawnHair(model)).toEqual([`WocHead_A_hair_${DEFAULT_HAIR}`]);
    expect(visible(model, 'WocHead_A_nose_default')).toBe(true);
    expect(visible(model, 'WocHead_A_nose_broad')).toBe(false);
    expect(hairTint?.tint.value.x).toBeCloseTo(1, 5); // still the red of the head on screen
    expect(hairTint?.tint.value.z).toBeCloseTo(0, 5);
    expect(influence(model, 'WocHead_A_base', 'FS_Chin_Softness')).toBeCloseTo(0.65, 6);
    // its file lands and links: the new head, every piece, colour and morph at once
    install(hairUrl('mohawk'));
    dressing.poll();
    expect(drawnHair(model)).toEqual([`WocHead_A_hair_${DEFAULT_HAIR}`]);
    link();
    expect(drawnHair(model)).toEqual(['WocHead_A_hair_mohawk']);
    expect(visible(model, 'WocHead_A_nose_broad')).toBe(true);
    expect(visible(model, 'WocHead_A_nose_default')).toBe(false);
    expect(hairTint?.tint.value.z).toBeCloseTo(1, 5);
    expect(influence(model, 'WocHead_A_base', 'FS_Chin_Softness')).toBe(1);
    expect(relived()).toBe(1);
    // the previous subject's pieces left with the swap: nothing of it stays on the body
    expect(model.getObjectByName(`WocHead_A_hair_${DEFAULT_HAIR}`)).toBeUndefined();
    expect(model.getObjectByName('WocHead_A_nose_default')).toBeUndefined();
  });

  it("a 'look' hold stands through later picks, then draws the latest whole; a drawable one never holds", () => {
    install(CORE, hairUrl(DEFAULT_HAIR), beardUrl(DEFAULT_BEARD), hairUrl('long'));
    const model = bornModel();
    const { h, link } = host(model, true);
    const dressing = new WocHeadDressing(h, 'a');
    dressing.setAppearance(null);
    // a subject whose files are all resident: hung in the same call, the head on screen
    // held whole until its pieces are linked, then drawn whole
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headHair: 'long', headNose: 'broad' }, 'look');
    expect(drawnHair(model)).toEqual([`WocHead_A_hair_${DEFAULT_HAIR}`]);
    expect(visible(model, 'WocHead_A_nose_default')).toBe(true);
    link();
    expect(drawnHair(model)).toEqual(['WocHead_A_hair_long']);
    expect(visible(model, 'WocHead_A_nose_broad')).toBe(true);
    // a subject whose every piece is on the body already draws at once: nothing to hold
    dressing.setAppearance(
      { ...DEFAULT_APPEARANCE, headHair: 'long', headNose: 'broad', hairHue: 120 },
      'look',
    );
    expect(dressing.drawnLook?.hair).toBe('long');
    expect(dressing.poll()).toBe(false);
    // two streaming subjects in a row: the head on screen holds for both
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headHair: 'quiff' }, 'look');
    dressing.setAppearance(
      { ...DEFAULT_APPEARANCE, headHair: 'undercut', headNose: 'aquiline' },
      'look',
    );
    expect(drawnHair(model)).toEqual(['WocHead_A_hair_long']);
    expect(visible(model, 'WocHead_A_nose_broad')).toBe(true);
    // the first subject's file landing draws nothing of it
    install(hairUrl('quiff'));
    dressing.poll();
    link();
    expect(drawnHair(model)).toEqual(['WocHead_A_hair_long']);
    // the latest subject's file: drawn whole
    install(hairUrl('undercut'));
    dressing.poll();
    link();
    expect(drawnHair(model)).toEqual(['WocHead_A_hair_undercut']);
    expect(visible(model, 'WocHead_A_nose_aquiline')).toBe(true);
    expect(visible(model, 'WocHead_A_nose_broad')).toBe(false);
    // and settled again: nothing left to hold
    expect(dressing.poll()).toBe(false);
  });

  it("wraps a late file's materials with the look's CURRENT colours, and drives its morphs", () => {
    install(CORE, hairUrl(DEFAULT_HAIR), beardUrl(DEFAULT_BEARD));
    const model = bornModel();
    const { h, link } = host(model, true);
    const dressing = new WocHeadDressing(h, 'a');
    dressing.retint();
    const red = { ...DEFAULT_APPEARANCE, hairHue: 0, hairSat: 1, hairLight: 0.5 };
    dressing.setAppearance(red);
    dressing.setAppearance({
      ...red,
      headBeard: 'handlebar',
      headShape: { ...DEFAULT_APPEARANCE.headShape, chinWidth: 1 },
    });
    install(beardUrl('handlebar'));
    dressing.poll();
    link();
    const handlebar = model.getObjectByName('WocHead_A_beard_handlebar') as THREE.Mesh;
    const u = wocHeadTintOf(handlebar.material as THREE.Material);
    expect(u?.role).toBe('hair');
    expect(u?.mix.value).toBe(1);
    expect(u?.tint.value.x).toBeCloseTo(1, 5);
    expect(u?.tint.value.y).toBeCloseTo(0, 5);
    // the file's shared material is never the one drawn (a per-visual clone)
    const shared = LIBRARY.get(beardUrl('handlebar'))?.scene.getObjectByName(
      'WocHead_A_beard_handlebar',
    ) as THREE.Mesh;
    expect(handlebar.material).not.toBe(shared.material);
    expect(influence(model, 'WocHead_A_beard_handlebar', 'FS_Chin_Softness')).toBe(1);
  });
});

describe('WocHeadDressing: the drawn head', () => {
  it('changes a look in place: the same body and head, new pieces, morphs and tint uniforms', () => {
    const { model, dressing } = liveDressing();
    const base = model.getObjectByName('WocHead_A_base');
    const eye = model.getObjectByName('WocHead_A_eyes_default_L') as THREE.Mesh;
    const changed = dressing.setAppearance({
      ...DEFAULT_APPEARANCE,
      headHair: 'mohawk',
      headNose: 'broad',
      headShape: { ...DEFAULT_APPEARANCE.headShape, eyeSize: 0.5 },
      hairHue: 0,
      hairSat: 1,
      hairLight: 0.5,
    });
    expect(changed).toBe(true);
    // nothing rebuilt: every piece the two looks share is the very node it was
    expect(model.getObjectByName('WocHead_A_base')).toBe(base);
    expect(model.getObjectByName('WocHead_A_eyes_default_L')).toBe(eye);
    // the pieces the new look adds are hung and drawn (no gate here: at once)...
    expect(visible(model, 'WocHead_A_hair_mohawk')).toBe(true);
    expect(visible(model, 'WocHead_A_nose_broad')).toBe(true);
    // ...and the ones it no longer draws are off the body, never left hidden on it
    expect(model.getObjectByName('WocHead_A_hair_swept')).toBeUndefined();
    expect(model.getObjectByName('WocHead_A_nose_default')).toBeUndefined();
    expect(eye.morphTargetInfluences?.[0]).toBe(0.5);
    const hair = model.getObjectByName('WocHead_A_hair_mohawk') as THREE.Mesh;
    const u = wocHeadTintOf(hair.material as THREE.Material);
    expect(u?.role).toBe('hair');
    // pure red, linear: r = 1, g = b = 0
    expect(u?.tint.value.x).toBeCloseTo(1, 5);
    expect(u?.tint.value.y).toBeCloseTo(0, 5);
    expect(u?.mix.value).toBe(1);
    // an equal look is no work
    expect(
      dressing.setAppearance({
        ...DEFAULT_APPEARANCE,
        headHair: 'mohawk',
        headNose: 'broad',
        headShape: { ...DEFAULT_APPEARANCE.headShape, eyeSize: 0.5 },
        hairHue: 0,
        hairSat: 1,
        hairLight: 0.5,
      }),
    ).toBe(false);
  });

  it("hangs only the pieces its look draws, each file's in one wrapper on the head bone", () => {
    const { model } = liveDressing();
    const rig = wocHeadRigOf(model);
    // the whole library is resident: the body carries its look's three files of it
    expect([...(rig?.files.keys() ?? [])]).toEqual([
      CORE,
      hairUrl(DEFAULT_HAIR),
      beardUrl(DEFAULT_BEARD),
    ]);
    const head = model.getObjectByName('head');
    for (const file of rig?.files.values() ?? []) {
      expect(file.wrappers).toHaveLength(1);
      expect(file.wrappers[0].parent).toBe(head);
    }
    // exactly what the look draws, once each: never the library
    expect([...hangedPieces(model).keys()].sort()).toEqual([...DEFAULT_NODES].sort());
    expect(hangedPieces(model).size).toBe(11);
    expect(wocHeadAllNodes('a').length).toBe(57);
  });

  it('a body whose files were hung WHOLE is pruned to its look by the first pass', () => {
    installAll();
    // a host that hangs files whole (the Guide viewer): every piece of the library
    const model = baseModel();
    hangWocHead(model, 'a');
    expect(hangedPieces(model).size).toBe(wocHeadAllNodes('a').length);
    const { h, forgotten } = host(model, false);
    const dressing = new WocHeadDressing(h, 'a');
    dressing.retint();
    // the first pass leaves the look's pieces and takes everything else off the body...
    expect([...hangedPieces(model).keys()].sort()).toEqual([...DEFAULT_NODES].sort());
    expect(wocHeadRigOf(model)?.files.size).toBe(3);
    // ...telling the host (its per-mesh record lets go of them), and freeing their clones
    expect(forgotten).toHaveLength(wocHeadAllNodes('a').length - DEFAULT_NODES.length);
    expect(dressing.poll()).toBe(true);
    expect(dressing.isLive).toBe(true);
    expect([...dressing.drawnNames].sort()).toEqual([...DEFAULT_NODES].sort());
  });

  it('a piece no longer drawn leaves the graph, the host forgets it, and its tint clone is freed', () => {
    const { model, dressing, forgotten } = liveDressing();
    const nose = model.getObjectByName('WocHead_A_nose_default') as THREE.Mesh;
    const wrapper = nose.parent;
    const clone = nose.material as THREE.Material;
    expect(wocHeadTintOf(clone)?.role).toBe('skin');
    const freed = vi.fn();
    clone.addEventListener('dispose', freed);
    // the body and each piece of the look that takes a tint: one clone each
    const before = dressing.tintClones;
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headNose: 'broad' });
    // out of the scene graph (no matrix update or material pass will visit it again)
    expect(nose.parent).toBeNull();
    expect(model.getObjectByName('WocHead_A_nose_default')).toBeUndefined();
    expect(wocHeadRigOf(model)?.pieces.has('WocHead_A_nose_default')).toBe(false);
    expect(wocHeadRigOf(model)?.meshes).not.toContain(nose);
    expect(forgotten).toEqual([nose]);
    expect(freed).toHaveBeenCalledOnce();
    // one clone left, one minted for the nose that replaced it: the count follows the look
    expect(dressing.tintClones).toBe(before);
    // its wrapper stays for the core's other pieces
    expect(wrapper?.parent).toBe(model.getObjectByName('head'));
    // a colour change no longer reaches the freed clone
    const u = wocHeadTintOf(clone);
    const was = u?.tint.value.toArray();
    dressing.setAppearance({
      ...DEFAULT_APPEARANCE,
      headNose: 'broad',
      skinHue: 20,
      skinSat: 0.33,
      skinLight: 0.16,
    });
    expect(u?.tint.value.toArray()).toEqual(was);
  });

  it('the tint clones follow the look: clean shaven and bald hold fewer, never the library', () => {
    const { model, dressing } = liveDressing();
    // every piece of this fixture has a material of its own: the body, and one per piece
    expect(dressing.tintClones).toBe(1 + DEFAULT_NODES.length);
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headHair: 'bald', headBeard: 'none' });
    expect(dressing.tintClones).toBe(1 + DEFAULT_NODES.length - 2);
    expect(hangedPieces(model).size).toBe(DEFAULT_NODES.length - 2);
    // a file left with no piece on the body is no longer hung on it at all
    expect([...(wocHeadRigOf(model)?.files.keys() ?? [])]).toEqual([CORE]);
    expect(model.getObjectByName('head')?.children).toHaveLength(1);
    // back: hung afresh, a clone each again
    dressing.setAppearance(DEFAULT_APPEARANCE);
    expect(dressing.tintClones).toBe(1 + DEFAULT_NODES.length);
    expect(drawnHair(model)).toEqual([`WocHead_A_hair_${DEFAULT_HAIR}`]);
  });

  it('a piece taken off and picked again is hung afresh, hidden until it is linked', () => {
    const { model, dressing, link, inFlight } = liveDressing(true);
    const first = model.getObjectByName('WocHead_A_nose_default');
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headNose: 'broad' });
    link();
    expect(first?.parent).toBeNull();
    // picked again: another node over the same shared geometry, behind the gate like any
    // piece hung on a body already drawn (its program may have been released meanwhile)
    dressing.setAppearance(DEFAULT_APPEARANCE);
    const again = model.getObjectByName('WocHead_A_nose_default') as THREE.Mesh;
    expect(again).toBeDefined();
    expect(again).not.toBe(first);
    expect(again.geometry).toBe((first as THREE.Mesh).geometry);
    expect(inFlight()).toBe(1);
    expect(again.visible).toBe(false);
    expect(visible(model, 'WocHead_A_nose_broad')).toBe(true);
    link();
    expect(again.visible).toBe(true);
    expect(model.getObjectByName('WocHead_A_nose_broad')).toBeUndefined();
  });

  it('a piece still linking is never hung twice: frames change nothing, and a later pick out of the same file lands', () => {
    const { model, dressing, link, inFlight } = liveDressing(true);
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headNose: 'broad' });
    const broad = model.getObjectByName('WocHead_A_nose_broad');
    expect(broad).toBeDefined();
    expect(inFlight()).toBe(1);
    // frames pass while its programs link: nothing is hung again and the gate is not asked again
    for (let i = 0; i < 3; i++) expect(dressing.poll()).toBe(false);
    expect(inFlight()).toBe(1);
    expect(model.getObjectByName('WocHead_A_nose_broad')).toBe(broad);
    expect(dressing.joining).toBe(true);
    link();
    expect(visible(model, 'WocHead_A_nose_broad')).toBe(true);
    expect(dressing.joining).toBe(false);
    // guards: a poll that tried to hang the linking piece again found nothing left to hang
    // and wrote its whole FILE off as unable to hang on this body, so no later pick out of
    // the core ever landed
    dressing.setAppearance(DEFAULT_APPEARANCE);
    expect(model.getObjectByName('WocHead_A_nose_default')).toBeDefined();
    expect(inFlight()).toBe(1);
    link();
    expect(visible(model, 'WocHead_A_nose_default')).toBe(true);
    expect(model.getObjectByName('WocHead_A_nose_broad')).toBeUndefined();
  });

  it('a pick taken back before it links leaves at once, and its late settle changes nothing', () => {
    const { model, dressing, link, forgotten, relived } = liveDressing(true);
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headNose: 'broad' });
    const broad = model.getObjectByName('WocHead_A_nose_broad');
    expect(broad).toBeDefined();
    // taken back while its programs link: off the body, the nose that never left still drawn
    dressing.setAppearance(DEFAULT_APPEARANCE);
    expect(broad?.parent).toBeNull();
    expect(forgotten).toEqual([broad]);
    expect(visible(model, 'WocHead_A_nose_default')).toBe(true);
    // nothing is on its way any more: the head is at rest and the poll is free
    expect(dressing.joining).toBe(false);
    expect(dressing.poll()).toBe(false);
    const was = relived();
    link();
    expect(visible(model, 'WocHead_A_nose_default')).toBe(true);
    expect(model.getObjectByName('WocHead_A_nose_broad')).toBeUndefined();
    expect(relived()).toBe(was);
  });

  it('wraps the body skin and every tinted head role, reusing clones on a retint', () => {
    const { model, dressing } = liveDressing();
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headPiercing: 'lip' });
    const body = model.getObjectByName('Character_Body') as THREE.Mesh;
    const bodyMat = body.material as THREE.Material;
    expect(wocHeadTintOf(bodyMat)?.role).toBe('skin');
    expect(wocHeadTintOf(bodyMat)?.surface).toBe('suit');
    const piercing = model.getObjectByName('WocHead_A_piercing_lip') as THREE.Mesh;
    expect(wocHeadTintOf(piercing.material as THREE.Material)).toBeNull();
    const brow = model.getObjectByName('WocHead_A_brows_relaxed_L') as THREE.Mesh;
    expect(wocHeadTintOf(brow.material as THREE.Material)?.role).toBe('brow');
    dressing.retint();
    expect(body.material).toBe(bodyMat);
    // one program per layer: the body's own atlas wears the suit skin layer, a head
    // piece's skin the plain one (the cache key is the layer plus the base program)
    expect(bodyMat.customProgramCacheKey()).toContain('woc_head_tint|skin_suit|');
    const face = (model.getObjectByName('WocHead_A_base') as THREE.Mesh).material as THREE.Material;
    expect(wocHeadTintOf(face)?.surface).toBeUndefined();
    expect(face.customProgramCacheKey()).toContain('woc_head_tint|skin|');
  });

  it("switches the body's tint off under an under-armor atlas: a uniform write, the head untouched", () => {
    const { model, dressing } = liveDressing();
    const body = model.getObjectByName('Character_Body') as THREE.Mesh;
    const bodyMat = body.material as THREE.Material;
    const u = wocHeadTintOf(bodyMat);
    const face = wocHeadTintOf(
      (model.getObjectByName('WocHead_A_base') as THREE.Mesh).material as THREE.Material,
    );
    const hair = wocHeadTintOf(
      (model.getObjectByName(`WocHead_A_hair_${DEFAULT_HAIR}`) as THREE.Mesh)
        .material as THREE.Material,
    );
    // its own suit: the skin paint takes the tone
    expect(u?.mix.value).toBe(1);
    const key = bodyMat.customProgramCacheKey();
    // a class under-armor atlas has no skin on it: nothing of the body takes the tone
    dressing.retint('underArmor');
    expect(u?.mix.value).toBe(0);
    expect(face?.mix.value).toBe(1);
    expect(hair?.mix.value).toBe(1);
    // the same material and program: the switch is the strength uniform
    expect(body.material).toBe(bodyMat);
    expect(bodyMat.customProgramCacheKey()).toBe(key);
    // a tone change while off: the head follows it, the body stays off
    const ebony = { ...DEFAULT_APPEARANCE, skinHue: 20, skinSat: 0.33, skinLight: 0.16 };
    expect(dressing.setAppearance(ebony)).toBe(true);
    const tone = hexToLinear(skinColor(ebony));
    expect(face?.tint.value.toArray()).toEqual([...tone]);
    expect(face?.mix.value).toBe(1);
    expect(u?.mix.value).toBe(0);
    // a helm change and a retint that names no atlas (a late head file's adoption)
    // keep the last one
    dressing.setHelm(true);
    dressing.retint();
    expect(u?.mix.value).toBe(0);
    // back on its own suit: on again, at the tone picked meanwhile
    dressing.retint('suit');
    expect(u?.mix.value).toBe(1);
    expect(u?.tint.value.toArray()).toEqual([...tone]);
    expect(body.material).toBe(bodyMat);
    expect(bodyMat.customProgramCacheKey()).toBe(key);
  });

  it('wraps a body source re-derived for an under-armor atlas at strength 0 from the start', () => {
    const { model, dressing } = liveDressing();
    const body = model.getObjectByName('Character_Body') as THREE.Mesh;
    const suitMat = body.material as THREE.Material;
    // the host's atlas swap: a new source material on the body, then the retint
    const underArmor = mat('body_underarmor');
    body.material = underArmor;
    dressing.retint('underArmor');
    const wrapped = body.material as THREE.Material;
    expect(wrapped).not.toBe(underArmor);
    expect(wrapped).not.toBe(suitMat);
    expect(wocHeadTintOf(wrapped)?.surface).toBe('suit');
    expect(wocHeadTintOf(wrapped)?.mix.value).toBe(0);
    // one program for the body under either atlas: the swap links nothing
    expect(wrapped.customProgramCacheKey()).toBe(suitMat.customProgramCacheKey());
    // the chest comes off: the suit's own source again, its clone reused, at full strength
    body.material = suitMat;
    dressing.retint('suit');
    expect(body.material).toBe(suitMat);
    expect(wocHeadTintOf(suitMat)?.mix.value).toBe(1);
    // ...and the under-armor clone it left behind stays off through a colour change
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, skinHue: 20, skinSat: 0.33, skinLight: 0.16 });
    expect(wocHeadTintOf(wrapped)?.mix.value).toBe(0);
    expect(wocHeadTintOf(suitMat)?.mix.value).toBe(1);
  });

  it("recolours the body's skin even while the head still streams", () => {
    const model = baseModel();
    const dressing = new WocHeadDressing(host(model, true).h, 'a');
    dressing.retint();
    const body = model.getObjectByName('Character_Body') as THREE.Mesh;
    const u = wocHeadTintOf(body.material as THREE.Material);
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, skinHue: 0, skinSat: 1, skinLight: 0.5 });
    expect(dressing.isLive).toBe(false);
    expect(u?.tint.value.x).toBeCloseTo(1, 5);
    expect(u?.tint.value.y).toBeCloseTo(0, 5);
  });

  it('draws the worn beard, keeps it under a helm, and swaps it in place', () => {
    const { model, dressing } = liveDressing();
    // Type A opens bearded
    const boxed = `WocHead_A_beard_${DEFAULT_BEARD}`;
    expect(visible(model, boxed)).toBe(true);
    // a helm hides the hair, never the beard
    dressing.setHelm(true);
    expect(visible(model, boxed)).toBe(true);
    expect(visible(model, `WocHead_A_hair_${DEFAULT_HAIR}`)).toBe(false);
    dressing.setHelm(false);
    expect(dressing.setAppearance({ ...DEFAULT_APPEARANCE, headBeard: 'goatee' })).toBe(true);
    expect(visible(model, 'WocHead_A_beard_goatee')).toBe(true);
    // the beard it replaced is off the body
    expect(model.getObjectByName(boxed)).toBeUndefined();
    // clean shaven draws no beard at all, and hangs none
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headBeard: 'none' });
    expect([...hangedPieces(model).keys()].filter((name) => name.includes('_beard_'))).toEqual([]);
  });

  it('a hairstyle a helm hides stays hung: the helm coming off is a flag, never a hang or a gate', () => {
    const { model, dressing, forgotten, inFlight } = liveDressing(true);
    const hair = model.getObjectByName(`WocHead_A_hair_${DEFAULT_HAIR}`) as THREE.Mesh;
    dressing.setHelm(true);
    // hidden, still on the body (a portrait shows it bare-headed, and the helm comes off
    // in the middle of a fight)
    expect(hair.visible).toBe(false);
    expect(model.getObjectByName(`WocHead_A_hair_${DEFAULT_HAIR}`)).toBe(hair);
    expect(forgotten).toEqual([]);
    dressing.setHelm(false);
    expect(hair.visible).toBe(true);
    expect(inFlight()).toBe(0);
    // ...and so does a hairstyle HELD under a helm while the picked one streams
    dressing.setHelm(true);
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headHair: 'mohawk' });
    expect(model.getObjectByName(`WocHead_A_hair_${DEFAULT_HAIR}`)).toBe(hair);
    dressing.setHelm(false);
    expect(drawnHair(model)).toEqual([`WocHead_A_hair_${DEFAULT_HAIR}`]);
  });

  it('tints the beard with the HAIR colour, following every hair change in place', () => {
    const { model, dressing } = liveDressing();
    const beard = model.getObjectByName('WocHead_A_beard_boxed') as THREE.Mesh;
    const hair = model.getObjectByName(`WocHead_A_hair_${DEFAULT_HAIR}`) as THREE.Mesh;
    const beardMat = beard.material as THREE.Material;
    const u = wocHeadTintOf(beardMat);
    expect(u?.role).toBe('hair');
    // pure red hair, and brows told to be blue: the beard follows the hair
    dressing.setAppearance({
      ...DEFAULT_APPEARANCE,
      hairHue: 0,
      hairSat: 1,
      hairLight: 0.5,
      browHue: 240,
      browSat: 1,
      browLight: 0.5,
    });
    expect(u?.tint.value.x).toBeCloseTo(1, 5);
    expect(u?.tint.value.z).toBeCloseTo(0, 5);
    expect(u?.mix.value).toBe(1);
    // ...and the hair's own uniform agrees with it
    const hu = wocHeadTintOf(hair.material as THREE.Material);
    expect(hu?.tint.value.toArray()).toEqual(u?.tint.value.toArray());
    // a new hair colour is a uniform write: same material, same program key
    const key = beardMat.customProgramCacheKey();
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, hairHue: 120, hairSat: 1, hairLight: 0.5 });
    expect(beard.material).toBe(beardMat);
    expect(beardMat.customProgramCacheKey()).toBe(key);
    expect(u?.tint.value.x).toBeCloseTo(0, 5);
    expect(u?.tint.value.y).toBeCloseTo(1, 5);
  });

  it('drives the chin on every piece that carries it and the bald crown on the base', () => {
    const { model, dressing } = liveDressing();
    // the authored chin by default, on the head, lips, nose and beard alike
    for (const node of ['WocHead_A_base', 'WocHead_A_mouth_default', 'WocHead_A_beard_boxed']) {
      expect(influence(model, node, 'FS_Chin_Softness'), node).toBeCloseTo(0.65, 6);
    }
    const narrow = { ...DEFAULT_APPEARANCE.headShape, chinWidth: 1 };
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headShape: narrow });
    for (const node of ['WocHead_A_base', 'WocHead_A_nose_default', 'WocHead_A_beard_boxed']) {
      expect(influence(model, node, 'FS_Chin_Softness'), node).toBe(1);
    }
    // a piece hung later is posed with the face it joins, never at the pack's own influence
    dressing.setAppearance({
      ...DEFAULT_APPEARANCE,
      headShape: narrow,
      headNose: 'broad',
      headBeard: 'chops',
    });
    for (const node of ['WocHead_A_nose_broad', 'WocHead_A_beard_chops']) {
      expect(influence(model, node, 'FS_Chin_Softness'), node).toBe(1);
    }
    // a piece without the target is left alone (by name, never by index)
    expect(influence(model, `WocHead_A_hair_${DEFAULT_HAIR}`, 'FS_Chin_Softness')).toBeUndefined();
    expect(influence(model, 'WocHead_A_eyes_default_L', 'FS_Eyes_Size')).toBe(0);
    // styled: the fitted scalp and the worn style's tuck
    expect(influence(model, 'WocHead_A_base', 'FS_Bald_Crown')).toBe(0);
    expect(influence(model, 'WocHead_A_base', 'FS_Tuck_swept')).toBe(1);
    // bald: the shorter crown at full weight, every tuck off
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headHair: 'bald' });
    expect(influence(model, 'WocHead_A_base', 'FS_Bald_Crown')).toBe(1);
    expect(influence(model, 'WocHead_A_base', 'FS_Tuck_swept')).toBe(0);
    expect(influence(model, 'WocHead_A_base', 'FS_Tuck_long')).toBe(0);
    // and back
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headHair: 'long' });
    expect(influence(model, 'WocHead_A_base', 'FS_Bald_Crown')).toBe(0);
    expect(influence(model, 'WocHead_A_base', 'FS_Tuck_long')).toBe(1);
  });

  it('wears the bald crown under a hair-hiding helm too, and drops it when the helm comes off', () => {
    const { model, dressing } = liveDressing();
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headHair: 'long' });
    expect(influence(model, 'WocHead_A_base', 'FS_Bald_Crown')).toBe(0);
    // the helm hides the hair: the shorter scalp keeps a vertex out of a close hood
    dressing.setHelm(true);
    expect(influence(model, 'WocHead_A_base', 'FS_Bald_Crown')).toBe(1);
    // the look's own morphs are untouched by the helm (the style's tuck stays)
    expect(influence(model, 'WocHead_A_base', 'FS_Tuck_long')).toBe(1);
    // a look change under the helm keeps it raised
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headHair: 'topknot' });
    expect(influence(model, 'WocHead_A_base', 'FS_Bald_Crown')).toBe(1);
    dressing.setHelm(false);
    expect(influence(model, 'WocHead_A_base', 'FS_Bald_Crown')).toBe(0);
    // bald stays bald either way
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headHair: 'bald' });
    expect(influence(model, 'WocHead_A_base', 'FS_Bald_Crown')).toBe(1);
    dressing.setHelm(true);
    expect(influence(model, 'WocHead_A_base', 'FS_Bald_Crown')).toBe(1);
  });

  it('hides the new hair under a helm and restores it after', () => {
    const { model, dressing } = liveDressing();
    const hair = `WocHead_A_hair_${DEFAULT_HAIR}`;
    expect(visible(model, hair)).toBe(true);
    expect(dressing.setHelm(true)).toBe(true);
    expect(visible(model, hair)).toBe(false);
    expect(visible(model, 'WocHead_A_base')).toBe(true);
    expect(dressing.setHelm(false)).toBe(true);
    expect(visible(model, hair)).toBe(true);
  });

  it('shows exactly the baked pieces on a far-bake model', () => {
    installAll();
    const model = baseModel();
    hangWocHead(model, 'a');
    applyWocHeadBakeVisibility(
      model,
      new Set(['WocHead_A_base', 'WocHead_A_nose_broad', 'WocHead_A_hair_long']),
    );
    expect(visible(model, 'WocHead_A_base')).toBe(true);
    expect(visible(model, 'WocHead_A_nose_broad')).toBe(true);
    // a piece from another file of the library rides the same part set
    expect(visible(model, 'WocHead_A_hair_long')).toBe(true);
    expect(visible(model, 'WocHead_A_nose_default')).toBe(false);
    expect(visible(model, `WocHead_A_hair_${DEFAULT_HAIR}`)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The one-draw merged head (setMerged)
// ---------------------------------------------------------------------------

/** The textures the pieces of a mergeable library sample: one atlas for the core, the
 *  hairstyles' own and the beards' own. */
const MERGE_ATLAS = new THREE.Texture();
const MERGE_HAIR_TEX = new THREE.Texture();
const MERGE_BEARD_TEX = new THREE.Texture();

/** A piece as the shipped files carry it, so one merged material can draw it: `piece`
 *  plus its texture (the core atlas, the hairstyle's, the beard's; a piercing's gold has
 *  none), a roughness per role (slots are told apart by it), and on the base head the
 *  atlas's white cell. */
function atlasPiece(name: string, side: THREE.Side = THREE.FrontSide): THREE.Mesh {
  const mesh = piece(name);
  const material = mesh.material as THREE.MeshStandardMaterial;
  material.side = side;
  const role = material.name;
  if (role === 'hair_x') {
    material.map = MERGE_HAIR_TEX;
    material.roughness = 0.5;
  } else if (role === 'hair_beard_x') {
    material.map = MERGE_BEARD_TEX;
    material.roughness = 0.625;
  } else if (role !== 'metal_gold') {
    material.map = MERGE_ATLAS;
    material.roughness = role === 'brow_x' ? 0.875 : role === 'eye_x' ? 0.25 : 0.75;
  }
  if (name.endsWith('_base')) material.userData.wocHeadAtlas = { white: [0.5, 0.5] };
  return mesh;
}

type Library = typeof LIBRARY;
/** Type A's library as one merged material can draw it, every piece one sided (a Type A
 *  head is). Minted per case, never shared between two: a merged program's witness is
 *  kept by the material it was wrapped from (woc_head_merge_proof_core.ts), so a case on
 *  another case's materials could find its gate already proven. */
const mergeLibrary = (): Library => splitHeadScenes('a', (name) => atlasPiece(name));
/** The same library with every piece two sided but the hairstyles. */
const twoSidedLibrary = (): Library =>
  splitHeadScenes('a', (name) =>
    atlasPiece(name, name.includes('_hair_') ? THREE.FrontSide : THREE.DoubleSide),
  );

/** Make files of a library resident (all of them unless told which). */
function installFrom(library: Library, urls: readonly string[] = [...library.keys()]): void {
  for (const url of urls) {
    const gltf = library.get(url);
    if (!gltf) throw new Error(`no fixture file ${url}`);
    setWocHeadFileForTest(url, gltf);
  }
}

interface WorldHostOptions {
  /** Reveals wait for `link` (the compile gate in flight) instead of settling at once. */
  gated?: boolean;
  /** The gate hands no readiness proof with its settle (a host that cannot prove a link). */
  unproven?: boolean;
  /** A work queue stands behind the host: scheduled units wait for `runQueued`. */
  queue?: boolean;
  /** Runs inside every adoption, after the dressing's retint pass (the effect the body
   *  wears lands on a mesh adopted now). */
  onAdopt?: (node: THREE.Object3D) => void;
}

/** The merged stand-in's mesh under a node a host adopted (null: a head file's wrapper). */
const standInOf = (node: THREE.Object3D): THREE.Mesh | null =>
  node.name === 'woc_head_merged' ? (node.children[0] as THREE.Mesh) : null;

/** The host a world view hands the dressing: what the suite's fake answers, plus what a
 *  merged head asks of it, every call recorded. */
function worldHost(model: THREE.Object3D, opts: WorldHostOptions = {}) {
  const reveals: {
    node: THREE.Object3D;
    live: (prepared: boolean, proof?: () => boolean) => void;
  }[] = [];
  /** Every node the host's gate was asked to reveal, in order. */
  const revealed: THREE.Object3D[] = [];
  const forgotten: THREE.Object3D[] = [];
  const queued: { work: () => void; label: string }[] = [];
  /** `drawn`: what rigDrawn answers; `asks`: how often it was asked; `adopts`: how many
   *  merged stand-ins were adopted; `context`: whether this host's GPU context still holds
   *  what its gates linked (what every proof it handed answers when asked again);
   *  `proofs`: how often one of them was asked. */
  const state = { drawn: true, asks: 0, relived: 0, adopts: 0, context: true, proofs: 0 };
  const h: WocHeadDressingHost = {
    model,
    adopt: (node, retint) => {
      if (standInOf(node)) state.adopts++;
      retint();
      opts.onAdopt?.(node);
    },
    forget: (node) => {
      forgotten.push(node);
    },
    reveal: (node, live) => {
      revealed.push(node);
      if (opts.gated) reveals.push({ node, live });
      else live(true);
    },
    relive: () => {
      state.relived++;
    },
    baseMaterial: (mesh) => mesh.material,
    rigDrawn: () => {
      state.asks++;
      return state.drawn;
    },
  };
  if (opts.queue) {
    h.schedule = (work, label) => {
      queued.push({ work, label });
    };
  }
  /** Settle every reveal in flight: the gate linked, or gave up (prepared false). As the
   *  renderer's gate does, it hands the proof it settled on, which can be asked again. */
  const link = (prepared = true): void => {
    const proof = (): boolean => {
      state.proofs++;
      return prepared && state.context;
    };
    for (const { live } of reveals.splice(0)) live(prepared, opts.unproven ? undefined : proof);
  };
  /** Give every queued unit its turn, and every unit one of them asks for in its turn (a
   *  new head is a band of its fold, then its mount). */
  const runQueued = (): void => {
    while (queued.length > 0) for (const { work } of queued.splice(0)) work();
  };
  return { h, link, reveals, revealed, forgotten, queued, runQueued, state };
}

const mergedMesh = (model: THREE.Object3D): THREE.Mesh | undefined =>
  model.getObjectByName('WocHead_A_merged') as THREE.Mesh | undefined;

/** Count every plan of a body's stand-in from here on: each one reads the base head's
 *  FILE material once (woc_head_merge.ts wocHeadMergeFold). The first mount of a head
 *  file reads it once more (the merged source is cloned off it), so a case takes its
 *  baseline after that. */
function planCounter(model: THREE.Object3D): () => number {
  let plans = 0;
  const base = model.getObjectByName('WocHead_A_base') as THREE.Mesh;
  Object.defineProperty(wocHeadFileMaterial(base) as THREE.Material, 'polygonOffset', {
    configurable: true,
    get: () => {
      plans++;
      return false;
    },
  });
  return () => plans;
}

/** How many merged stand-ins a host's gate was asked to reveal. */
const gatedStandIns = (revealed: readonly THREE.Object3D[]): number =>
  revealed.filter((node) => node.name === 'woc_head_merged').length;

/** The layer mask of each piece the head draws right now, by piece name. */
function drawnMasks(model: THREE.Object3D, dressing: WocHeadDressing): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of [...dressing.drawnNames].sort()) {
    out[name] = (model.getObjectByName(name) as THREE.Mesh).layers.mask;
  }
  return out;
}

/** The distinct layer masks among the drawn pieces: [0] when one mesh stands in for
 *  all of them, [1] when every piece draws by itself. */
const maskSet = (model: THREE.Object3D, dressing: WocHeadDressing): number[] =>
  [...new Set(Object.values(drawnMasks(model, dressing)))].sort();

/** The rows of the merged material's tables the default look leaves unused. */
const UNUSED_ROWS = WOC_HEAD_MERGE_MAX_SLOTS - 11;

/** The default look's pieces in the order a merge folds them (by name). */
const DEFAULT_PIECES = [
  'WocHead_A_base',
  'WocHead_A_beard_boxed',
  'WocHead_A_brows_relaxed_L',
  'WocHead_A_brows_relaxed_R',
  'WocHead_A_ears_default_L',
  'WocHead_A_ears_default_R',
  'WocHead_A_eyes_default_L',
  'WocHead_A_eyes_default_R',
  'WocHead_A_hair_swept',
  'WocHead_A_mouth_default',
  'WocHead_A_nose_default',
];

/** The default look with another chin: the same pieces, another face. */
const OTHER_FACE = {
  ...DEFAULT_APPEARANCE,
  headShape: { ...DEFAULT_APPEARANCE.headShape, chinWidth: 1 },
};

describe('WocHeadDressing: the one-draw merged head', () => {
  beforeEach(() => wocHeadMergeInternalsForTest.reset());
  afterEach(() => wocHeadMergeInternalsForTest.reset());

  interface BodyOptions extends WorldHostOptions {
    /** The library the body hangs (a second body of a case shares the first one's). */
    library?: Library;
    hang?: readonly string[];
  }

  /** A body live on the default look over a mergeable library (merging still off): born
   *  with its look's pieces, or with the files of `hang` hung whole in that order. */
  function mergeable(opts: BodyOptions = {}) {
    const library = opts.library ?? mergeLibrary();
    installFrom(library);
    const model = opts.hang ? baseModel() : bornModel();
    if (opts.hang) hangWocHead(model, 'a', opts.hang);
    const hh = worldHost(model, opts);
    const dressing = new WocHeadDressing(hh.h, 'a');
    dressing.retint();
    expect(dressing.poll()).toBe(true);
    return { model, dressing, library, ...hh };
  }

  /** ...and merged: asked for, mounted (by a poll, or by the unit it queued), its reveal
   *  settled. */
  function merged(opts: BodyOptions = {}) {
    const m = mergeable(opts);
    m.dressing.setMerged(true);
    m.dressing.poll();
    m.runQueued();
    m.link();
    expect(m.dressing.isMerged).toBe(true);
    return m;
  }

  it('draws piece by piece while merging is off', () => {
    const { model, dressing, revealed } = mergeable();
    expect([...dressing.drawnNames].sort()).toEqual(DEFAULT_PIECES);
    for (let i = 0; i < 3; i++) dressing.poll();
    expect(mergedMesh(model)).toBeUndefined();
    expect(dressing.isMerged).toBe(false);
    expect(maskSet(model, dressing)).toEqual([1]);
    // asked for, then called off before a poll could mount it
    dressing.setMerged(true);
    dressing.setMerged(false);
    dressing.poll();
    expect(mergedMesh(model)).toBeUndefined();
    expect(maskSet(model, dressing)).toEqual([1]);
    expect(revealed).toEqual([]);
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(0);
  });

  it('mounts nothing until the head is live AND a poll runs: never inside a pass', () => {
    const library = mergeLibrary();
    // the default look's hairstyle still streams: the head is not live
    installFrom(library, [CORE, beardUrl(DEFAULT_BEARD)]);
    const model = bornModel();
    const { h, link } = worldHost(model, { gated: true });
    const dressing = new WocHeadDressing(h, 'a');
    dressing.retint();
    dressing.setMerged(true);
    dressing.setAppearance(null);
    expect(dressing.isLive).toBe(false);
    dressing.poll();
    expect(mergedMesh(model)).toBeUndefined();
    // the hairstyle lands and hangs, its programs still linking: not live, not merged
    installFrom(library, [hairUrl(DEFAULT_HAIR)]);
    dressing.poll();
    expect(dressing.isLive).toBe(false);
    expect(mergedMesh(model)).toBeUndefined();
    // linked: the head goes live inside the reveal, and still nothing mounts there
    link();
    expect(dressing.isLive).toBe(true);
    expect(mergedMesh(model)).toBeUndefined();
    // ...nor inside any pass a host runs between two polls
    dressing.apply();
    dressing.retint();
    dressing.setHelm(true);
    dressing.setHelm(false);
    dressing.setAppearance(OTHER_FACE);
    dressing.effectsChanged();
    dressing.gateChanged();
    expect(mergedMesh(model)).toBeUndefined();
    expect(dressing.isMerged).toBe(false);
    expect(maskSet(model, dressing)).toEqual([1]);
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(0);

    // the poll mounts it, hidden behind the host's gate: the pieces still draw
    dressing.poll();
    const mesh = mergedMesh(model);
    expect(mesh).toBeDefined();
    expect(mesh?.parent?.name).toBe('woc_head_merged');
    expect(mesh?.parent?.parent).toBe(model.getObjectByName('head'));
    expect(mesh?.parent?.visible).toBe(false);
    expect(dressing.isMerged).toBe(false);
    expect(maskSet(model, dressing)).toEqual([1]);
    // its reveal settles: one mesh stands in for every drawn piece
    link();
    expect(dressing.isMerged).toBe(true);
    expect(mesh?.parent?.visible).toBe(true);
    expect(maskSet(model, dressing)).toEqual([0]);
    expect(Object.keys(drawnMasks(model, dressing))).toEqual(DEFAULT_PIECES);
    // one box of 24 vertices per drawn piece, folded once each
    expect(mesh?.geometry.getAttribute('position').count).toBe(DEFAULT_PIECES.length * 24);
    // what a piece IS stays the dressing's: still shown, still the far bake's part set
    for (const name of DEFAULT_PIECES) expect(visible(model, name), name).toBe(true);
    // ...and the stand-in folds everything this body carries: nothing else hangs on it
    expect([...(wocHeadRigOf(model)?.pieces.keys() ?? [])].sort()).toEqual(DEFAULT_PIECES);
    // settled: later polls mount nothing more
    dressing.poll();
    expect(
      model.getObjectByName('head')?.children.filter((c) => c.name === 'woc_head_merged'),
    ).toHaveLength(1);
  });

  it('retint wraps the merged material with the merged layer and writes one row per slot', () => {
    const { model, dressing } = merged();
    const mesh = mergedMesh(model) as THREE.Mesh;
    const material = mesh.material as THREE.MeshStandardMaterial;
    const u = wocHeadMergedTintOf(material);
    expect(u).not.toBeNull();
    // a per-visual clone on the core atlas, two sided, never a per-role layer
    expect(material.map).toBe(MERGE_ATLAS);
    expect(material.side).toBe(THREE.DoubleSide);
    expect(material.customProgramCacheKey()).toContain('woc_head_tint|merged|');
    expect(wocHeadTintOf(material)).toBeNull();
    // one row per slot, in the order the pieces fold (by name): the role code...
    expect(u?.ref.value.map((v) => v.w)).toEqual([
      ...[1, 3, 4, 4, 1, 1, 2, 2, 3, 1, 1],
      ...new Array<number>(UNUSED_ROWS).fill(0),
    ]);
    // ...the texture layer (the beard's, the hairstyle's, the atlas for the rest)...
    expect(u?.col.value.map((v) => v.w)).toEqual([
      ...[0, 2, 0, 0, 0, 0, 0, 0, 1, 0, 0],
      ...new Array<number>(UNUSED_ROWS).fill(0),
    ]);
    // ...and the surface its own piece draws with (the fixture's roughness per role)
    expect(u?.emi.value.map((v) => v.w)).toEqual([
      ...[0.75, 0.625, 0.875, 0.875, 0.75, 0.75, 0.25, 0.25, 0.5, 0.75, 0.75],
      ...new Array<number>(UNUSED_ROWS).fill(1),
    ]);
    // each tinted slot against its own measured reference
    const base = model.getObjectByName('WocHead_A_base') as THREE.Mesh;
    expect(u?.ref.value[0].toArray().slice(0, 3)).toEqual(base.userData.wocHeadTintRef);
    const hair = model.getObjectByName('WocHead_A_hair_swept') as THREE.Mesh;
    expect(u?.ref.value[8].toArray().slice(0, 3)).toEqual(hair.userData.wocHeadTintRef);
    expect(u?.hair.value).toBe(MERGE_HAIR_TEX);
    expect(u?.beard.value).toBe(MERGE_BEARD_TEX);
    expect(u?.scalp.value).toBeNull();
    // the look's colours, by role, at full strength
    const colors = dressing.look.colors;
    expect(u?.tints.value.map((v) => v.toArray())).toEqual(
      [colors.skin, colors.eye, colors.hair, colors.brow].map((c) => [...c]),
    );
    expect(u?.mix.value).toBe(1);

    // a second pass over the same materials re-wraps nothing
    dressing.retint();
    expect(mesh.material).toBe(material);
    expect(wocHeadMergedTintOf(mesh.material as THREE.Material)).toBe(u);
    expect(dressing.isMerged).toBe(true);
  });

  it("reads each slot's surface off the host's pre-effect record, or off the mesh in a fresh sweep", () => {
    const m = mergeable();
    // the host's record of what each piece draws with before any effect overlay
    const record = new Map<THREE.Object3D, THREE.Material>();
    m.h.baseMaterial = (mesh) => record.get(mesh) ?? mesh.material;
    const pieces = DEFAULT_PIECES.map((name) => m.model.getObjectByName(name) as THREE.Mesh);
    for (const mesh of pieces) {
      record.set(mesh, new THREE.MeshStandardMaterial({ roughness: 0.125 }));
      // ...and an effect overlay mounted on the mesh itself
      (mesh.material as THREE.MeshStandardMaterial).roughness = 0.9375;
    }
    m.dressing.setMerged(true);
    m.dressing.poll();
    expect(m.dressing.isMerged).toBe(true);
    const u = wocHeadMergedTintOf(mergedMesh(m.model)?.material as THREE.Material);
    const roughness = (): number[] => (u?.emi.value ?? []).slice(0, 11).map((v) => v.w);
    const all = (value: number): number[] => new Array<number>(11).fill(value);
    // mounted mid-effect: the plain surfaces, never the overlay's
    expect(roughness()).toEqual(all(0.125));
    // the record moves on (the host re-derived the pieces): the next pass follows it
    for (const mesh of pieces) {
      record.set(mesh, new THREE.MeshStandardMaterial({ roughness: 0.25 }));
    }
    m.dressing.retint();
    expect(roughness()).toEqual(all(0.25));
    // inside the host's full sweep its record is stale and every mesh wears its fresh
    // pre-effect material: that pass reads the meshes
    m.dressing.retint('suit', true);
    expect(roughness()).toEqual(all(0.9375));
    // the flag is that pass's alone: a stand-in mounted after it reads the record again
    // (under a helm the hairstyle is gone: ten slots)
    m.dressing.setHelm(true);
    m.dressing.poll();
    expect(m.dressing.isMerged).toBe(true);
    expect(roughness().slice(0, 10)).toEqual(new Array<number>(10).fill(0.25));
    m.dressing.setHelm(false);
    m.dressing.poll();
    expect(roughness()).toEqual(all(0.25));
    // ...and so does the next plain pass
    m.dressing.retint('suit', true);
    expect(roughness()).toEqual(all(0.9375));
    m.dressing.retint();
    expect(roughness()).toEqual(all(0.25));
    m.dressing.apply();
    expect(roughness()).toEqual(all(0.25));
    expect(m.dressing.isMerged).toBe(true);
    expect(wocHeadMergedTintOf(mergedMesh(m.model)?.material as THREE.Material)).toBe(u);
  });

  it('a colour-only change keeps it standing and reaches the merged uniforms', () => {
    const { model, dressing, forgotten } = merged();
    const mesh = mergedMesh(model) as THREE.Mesh;
    const u = wocHeadMergedTintOf(mesh.material as THREE.Material);
    const key = (mesh.material as THREE.Material).customProgramCacheKey();
    // pure red hair, blue brows
    expect(
      dressing.setAppearance({
        ...DEFAULT_APPEARANCE,
        hairHue: 0,
        hairSat: 1,
        hairLight: 0.5,
        browHue: 240,
        browSat: 1,
        browLight: 0.5,
      }),
    ).toBe(true);
    // the same mesh, the same material, the same program: a uniform write
    expect(mergedMesh(model)).toBe(mesh);
    expect(dressing.isMerged).toBe(true);
    expect(maskSet(model, dressing)).toEqual([0]);
    expect(forgotten).toEqual([]);
    expect(wocHeadMergedTintOf(mesh.material as THREE.Material)).toBe(u);
    expect((mesh.material as THREE.Material).customProgramCacheKey()).toBe(key);
    const [, , hair, brow] = u?.tints.value ?? [];
    expect(hair.x).toBeCloseTo(1, 5);
    expect(hair.y).toBeCloseTo(0, 5);
    expect(hair.z).toBeCloseTo(0, 5);
    expect(brow.x).toBeCloseTo(0, 5);
    expect(brow.z).toBeCloseTo(1, 5);
    // ...and the pieces underneath hold the same colour, for the frame they draw again
    const piece = model.getObjectByName('WocHead_A_hair_swept') as THREE.Mesh;
    expect(wocHeadTintOf(piece.material as THREE.Material)?.tint.value.toArray()).toEqual(
      hair.toArray(),
    );
  });

  it('a face change drops it at once, and a later poll merges the new face', () => {
    const { model, dressing, link, forgotten, revealed } = merged({ gated: true });
    const first = mergedMesh(model) as THREE.Mesh;
    expect(gatedStandIns(revealed)).toBe(1);
    expect(dressing.setAppearance(OTHER_FACE)).toBe(true);
    // in the same call: the stand-in is gone and every piece draws again
    expect(mergedMesh(model)).toBeUndefined();
    expect(first.parent?.parent).toBeNull();
    expect(forgotten).toHaveLength(1);
    expect(forgotten[0]).toBe(first.parent);
    expect(dressing.isMerged).toBe(false);
    expect(maskSet(model, dressing)).toEqual([1]);
    // the next frame's poll mounts the new face
    dressing.poll();
    const second = mergedMesh(model) as THREE.Mesh;
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(second.geometry).not.toBe(first.geometry);
    // the same per-visual material: a face is geometry, never a relink...
    expect(second.material).toBe(first.material);
    // ...so it stands the moment it mounts, with no gate of its own
    expect(gatedStandIns(revealed)).toBe(1);
    expect(dressing.isMerged).toBe(true);
    expect(maskSet(model, dressing)).toEqual([0]);
    link();
    expect(dressing.isMerged).toBe(true);
  });

  it('a helm drops it at once (the hair comes off), and a later poll merges what is left', () => {
    const { model, dressing } = merged();
    const first = mergedMesh(model) as THREE.Mesh;
    expect(dressing.setHelm(true)).toBe(true);
    expect(mergedMesh(model)).toBeUndefined();
    expect(dressing.isMerged).toBe(false);
    expect(maskSet(model, dressing)).toEqual([1]);
    // the hair is hidden by the dressing, and back on its own layers for when it shows
    const hair = model.getObjectByName('WocHead_A_hair_swept') as THREE.Mesh;
    expect(hair.visible).toBe(false);
    expect(hair.layers.mask).toBe(1);
    dressing.poll();
    const second = mergedMesh(model) as THREE.Mesh;
    expect(dressing.isMerged).toBe(true);
    expect(second.geometry.getAttribute('position').count).toBe((DEFAULT_PIECES.length - 1) * 24);
    expect(wocHeadMergedTintOf(second.material as THREE.Material)?.hair.value).toBeNull();
    expect(hair.layers.mask).toBe(1);
    // the helm comes off: dropped again, and the first head's buffer comes back unbuilt
    dressing.setHelm(false);
    expect(mergedMesh(model)).toBeUndefined();
    dressing.poll();
    expect(mergedMesh(model)?.geometry).toBe(first.geometry);
    expect(hair.layers.mask).toBe(0);
  });

  it('a piece swapped in place is another head: the old one drops, the new one merges', () => {
    const { model, dressing } = merged();
    const old = model.getObjectByName('WocHead_A_nose_default') as THREE.Mesh;
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headNose: 'broad' });
    expect(mergedMesh(model)).toBeUndefined();
    expect(maskSet(model, dressing)).toEqual([1]);
    // the nose it replaced left the body with its layers handed back, never stranded at 0
    expect(old.parent).toBeNull();
    expect(old.layers.mask).toBe(1);
    dressing.poll();
    expect(dressing.isMerged).toBe(true);
    expect(drawnMasks(model, dressing).WocHead_A_nose_broad).toBe(0);
    expect(maskSet(model, dressing)).toEqual([0]);
  });

  it('waits for a head that is whole and at rest: never while a file streams or links', () => {
    const library = mergeLibrary();
    installFrom(library, [CORE, hairUrl(DEFAULT_HAIR), beardUrl(DEFAULT_BEARD)]);
    const model = bornModel();
    const swept = model.getObjectByName(`WocHead_A_hair_${DEFAULT_HAIR}`) as THREE.Mesh;
    const { h, link } = worldHost(model, { gated: true });
    const dressing = new WocHeadDressing(h, 'a');
    dressing.retint();
    dressing.setAppearance(null);
    dressing.setMerged(true);
    dressing.poll();
    link();
    expect(dressing.isMerged).toBe(true);
    // a new hairstyle still on the wire, and a face change with it: the stand-in
    // drops, and the head (the old hair held) is not at rest
    dressing.setAppearance({ ...OTHER_FACE, headHair: 'mohawk' });
    expect(mergedMesh(model)).toBeUndefined();
    expect(drawnHair(model)).toEqual([`WocHead_A_hair_${DEFAULT_HAIR}`]);
    for (let i = 0; i < 3; i++) dressing.poll();
    expect(mergedMesh(model)).toBeUndefined();
    // the file lands and hangs, still linking: still not at rest
    installFrom(library, [hairUrl('mohawk')]);
    dressing.poll();
    dressing.poll();
    expect(mergedMesh(model)).toBeUndefined();
    expect(maskSet(model, dressing)).toEqual([1]);
    // revealed: the hair swaps, and the next poll merges the head as it now draws
    link();
    expect(drawnHair(model)).toEqual(['WocHead_A_hair_mohawk']);
    expect(mergedMesh(model)).toBeUndefined();
    dressing.poll();
    link();
    expect(dressing.isMerged).toBe(true);
    expect(drawnMasks(model, dressing).WocHead_A_hair_mohawk).toBe(0);
    expect(maskSet(model, dressing)).toEqual([0]);
    // the hairstyle it held left the body with its layers handed back
    expect(swept.parent).toBeNull();
    expect(swept.layers.mask).toBe(1);
  });

  it('a pick taken back before its piece links leaves at once: the head is at rest in what it draws', () => {
    const library = mergeLibrary();
    installFrom(library, [CORE, hairUrl(DEFAULT_HAIR), beardUrl(DEFAULT_BEARD), hairUrl('mohawk')]);
    const model = bornModel();
    const { h, link, forgotten } = worldHost(model, { gated: true });
    const dressing = new WocHeadDressing(h, 'a');
    dressing.retint();
    dressing.setAppearance(null);
    dressing.setMerged(true);
    dressing.poll();
    link();
    expect(dressing.isMerged).toBe(true);
    // a hairstyle is picked: its piece hangs and starts linking (the old hair held, so the
    // stand-in still matches what is drawn)...
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headHair: 'mohawk' });
    const mohawk = model.getObjectByName('WocHead_A_hair_mohawk');
    expect(mohawk).toBeDefined();
    expect(dressing.isMerged).toBe(true);
    // ...and no stand-in would be mounted for a head about to change
    expect(dressing.joining).toBe(true);
    // the pick is taken back, with another face, before it links
    dressing.setAppearance(OTHER_FACE);
    expect(mergedMesh(model)).toBeUndefined();
    // the piece nobody wants any more is off the body: nothing is on its way
    expect(mohawk?.parent).toBeNull();
    expect(forgotten).toContain(mohawk);
    expect(dressing.joining).toBe(false);
    // at rest in what it draws, so the very next poll merges it (the first stand-in's
    // program is still proven: no gate of its own)
    dressing.poll();
    expect(dressing.isMerged).toBe(true);
    expect(maskSet(model, dressing)).toEqual([0]);
    // the gate settling on the piece that left changes nothing
    link();
    expect(dressing.isMerged).toBe(true);
    expect(drawnHair(model)).toEqual([`WocHead_A_hair_${DEFAULT_HAIR}`]);
    expect(model.getObjectByName('WocHead_A_hair_mohawk')).toBeUndefined();
  });

  it('a head standing in bare is not merged until its hairstyle joins: one stand-in built, never two', () => {
    const library = mergeLibrary();
    installFrom(library, [CORE, beardUrl(DEFAULT_BEARD)]);
    const model = bornModel();
    const { h, link } = worldHost(model, { gated: true });
    const dressing = new WocHeadDressing(h, 'a');
    dressing.retint();
    dressing.setBareStandIn(true);
    dressing.setMerged(true);
    dressing.setAppearance(null);
    // live and drawn, bald: its hairstyle is on the wire
    expect(dressing.isLive).toBe(true);
    expect(drawnHair(model)).toEqual([]);
    for (let i = 0; i < 3; i++) dressing.poll();
    // the head is about to change, so nothing is built for what it draws meanwhile
    expect(mergedMesh(model)).toBeUndefined();
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(0);
    expect(maskSet(model, dressing)).toEqual([1]);
    // the file lands and hangs, still linking: still nothing
    installFrom(library, [hairUrl(DEFAULT_HAIR)]);
    dressing.poll();
    dressing.poll();
    expect(mergedMesh(model)).toBeUndefined();
    // the hairstyle joins, and the next poll merges the whole head
    link();
    expect(drawnHair(model)).toEqual([`WocHead_A_hair_${DEFAULT_HAIR}`]);
    dressing.poll();
    link();
    expect(dressing.isMerged).toBe(true);
    expect(Object.keys(drawnMasks(model, dressing))).toEqual(DEFAULT_PIECES);
    expect(maskSet(model, dressing)).toEqual([0]);
    // only the whole head was ever folded
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(1);
  });

  it('a hairstyle that failed leaves the bare head at rest: merged bald, then dropped and merged whole when a retry lands', () => {
    const library = mergeLibrary();
    installFrom(library, [CORE, beardUrl(DEFAULT_BEARD)]);
    failWocHeadFileForTest(hairUrl(DEFAULT_HAIR));
    const model = bornModel();
    const { h, link, forgotten } = worldHost(model, { gated: true });
    const dressing = new WocHeadDressing(h, 'a');
    dressing.retint();
    dressing.setBareStandIn(true);
    dressing.setMerged(true);
    dressing.setAppearance(null);
    expect(dressing.joining).toBe(false);
    // at rest in what it holds: the bald head is folded like any other
    dressing.poll();
    link();
    expect(dressing.isMerged).toBe(true);
    const bald = mergedMesh(model) as THREE.Mesh;
    expect(bald.geometry.getAttribute('position').count).toBe((DEFAULT_PIECES.length - 1) * 24);
    // a retry lands: its piece hangs behind the gate, the bald stand-in still what draws
    installFrom(library, [hairUrl(DEFAULT_HAIR)]);
    dressing.poll();
    expect(mergedMesh(model)).toBe(bald);
    expect(dressing.isMerged).toBe(true);
    // it joins: the stand-in drops in that step (the pieces draw, hair and all), through
    // the edge every change of the drawn head takes
    link();
    expect(mergedMesh(model)).toBeUndefined();
    expect(forgotten).toEqual([bald.parent]);
    expect(maskSet(model, dressing)).toEqual([1]);
    expect(drawnHair(model)).toEqual([`WocHead_A_hair_${DEFAULT_HAIR}`]);
    // ...and the next poll merges the whole head
    dressing.poll();
    link();
    expect(dressing.isMerged).toBe(true);
    expect(mergedMesh(model)?.geometry.getAttribute('position').count).toBe(
      DEFAULT_PIECES.length * 24,
    );
  });

  it.each([
    ['failed to load', (url: string): void => failWocHeadFileForTest(url)],
    [
      'cannot hang on this body',
      (url: string): void => {
        // its piece sits on a bone this body does not have
        const gltf = splitHeadScene(['WocHead_A_hair_mohawk'], (name) => atlasPiece(name));
        gltf.scene.children[0].name = 'tail';
        setWocHeadFileForTest(url, gltf);
      },
    ],
  ])('a pick whose file %s leaves the head at rest in what it holds: it merges', (_what, land) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const library = mergeLibrary();
    installFrom(library, [CORE, hairUrl(DEFAULT_HAIR), beardUrl(DEFAULT_BEARD)]);
    const model = bornModel();
    const { h } = worldHost(model);
    const dressing = new WocHeadDressing(h, 'a');
    dressing.retint();
    dressing.setAppearance(null);
    dressing.setMerged(true);
    dressing.poll();
    expect(dressing.isMerged).toBe(true);
    // a hairstyle pick with another face: the stand-in drops, and the pick still streams
    dressing.setAppearance({ ...OTHER_FACE, headHair: 'mohawk' });
    dressing.poll();
    dressing.poll();
    expect(mergedMesh(model)).toBeUndefined();
    // the file never will draw: the held hairstyle is what this head keeps, so it merges
    land(hairUrl('mohawk'));
    dressing.poll();
    dressing.poll();
    expect(dressing.isMerged).toBe(true);
    expect(drawnHair(model)).toEqual([`WocHead_A_hair_${DEFAULT_HAIR}`]);
    expect(maskSet(model, dressing)).toEqual([0]);
    vi.restoreAllMocks();
  });

  it('a translucent effect on the head sends it back to its pieces until it ends', () => {
    const { model, dressing } = merged();
    const first = mergedMesh(model) as THREE.Mesh;
    const base = model.getObjectByName('WocHead_A_base') as THREE.Mesh;
    const plans = planCounter(model);
    dressing.apply();
    expect(plans()).toBe(1);

    // an effect edge that leaves the head opaque (a buff glow, a tint) plans nothing
    dressing.effectsChanged();
    expect(plans()).toBe(1);
    expect(mergedMesh(model)).toBe(first);
    expect(dressing.isMerged).toBe(true);

    // the host mounts a ghost fade over the pieces, and says so
    (base.material as THREE.Material).transparent = true;
    dressing.effectsChanged();
    expect(mergedMesh(model)).toBeUndefined();
    expect(dressing.isMerged).toBe(false);
    expect(maskSet(model, dressing)).toEqual([1]);
    // while the effect lasts no poll merges it again, and no pass either
    for (let i = 0; i < 3; i++) dressing.poll();
    expect(mergedMesh(model)).toBeUndefined();
    dressing.apply();
    dressing.retint();
    dressing.poll();
    dressing.effectsChanged();
    expect(mergedMesh(model)).toBeUndefined();
    // ...and nothing was even planned: a head drawn through the effect has no stand-in
    expect(plans()).toBe(1);

    // the effect ends: planned once, nothing mounts inside the host's pass
    (base.material as THREE.Material).transparent = false;
    dressing.effectsChanged();
    expect(plans()).toBe(2);
    expect(mergedMesh(model)).toBeUndefined();
    // the next poll merges
    dressing.poll();
    expect(dressing.isMerged).toBe(true);
    expect(maskSet(model, dressing)).toEqual([0]);
    // the same face as before the effect: its buffer was kept
    expect(mergedMesh(model)?.geometry).toBe(first.geometry);
    // told again with nothing changed: the stand-in is left alone, unplanned
    const again = mergedMesh(model);
    dressing.effectsChanged();
    expect(plans()).toBe(2);
    expect(mergedMesh(model)).toBe(again);
    expect(dressing.isMerged).toBe(true);
  });

  it('a replaced compile gate re-plans a stand-in still linking, and leaves a standing one alone', () => {
    const m = mergeable({ gated: true });
    // nothing mounted, merging off or on: nothing to do
    m.dressing.gateChanged();
    m.dressing.setMerged(true);
    m.dressing.gateChanged();
    expect(mergedMesh(m.model)).toBeUndefined();
    expect(m.forgotten).toEqual([]);
    m.dressing.poll();
    const first = mergedMesh(m.model) as THREE.Mesh;
    expect(m.dressing.isMerged).toBe(false);

    // its reveal would settle on a gate that is gone: dropped, and planned again
    m.dressing.gateChanged();
    expect(mergedMesh(m.model)).toBeUndefined();
    expect(first.parent?.parent).toBeNull();
    expect(m.forgotten).toHaveLength(1);
    expect(m.forgotten[0]).toBe(first.parent);
    expect(maskSet(m.model, m.dressing)).toEqual([1]);
    m.dressing.poll();
    const second = mergedMesh(m.model) as THREE.Mesh;
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    // the same face: the buffer the first one built
    expect(second.geometry).toBe(first.geometry);
    // nothing linked yet, so it waits behind the new gate
    expect(gatedStandIns(m.revealed)).toBe(2);
    expect(m.dressing.isMerged).toBe(false);
    m.reveals[1].live(true);
    expect(m.dressing.isMerged).toBe(true);
    expect(maskSet(m.model, m.dressing)).toEqual([0]);
    // the old gate settling late changes nothing
    m.reveals[0].live(true);
    expect(mergedMesh(m.model)).toBe(second);
    expect(maskSet(m.model, m.dressing)).toEqual([0]);

    // a head already standing is linked: another gate change leaves it alone
    m.dressing.gateChanged();
    expect(mergedMesh(m.model)).toBe(second);
    expect(m.dressing.isMerged).toBe(true);
    expect(m.forgotten).toHaveLength(1);
  });

  it('dispose takes it down and restores the masks, and so does switching merging off', () => {
    const one = merged();
    const wrapper = mergedMesh(one.model)?.parent;
    // asked again for what is already on: nothing changes
    one.dressing.setMerged(true);
    expect(mergedMesh(one.model)?.parent).toBe(wrapper);
    expect(one.dressing.isMerged).toBe(true);
    one.dressing.dispose();
    expect(mergedMesh(one.model)).toBeUndefined();
    expect(wrapper?.parent).toBeNull();
    expect(one.forgotten).toHaveLength(1);
    expect(one.forgotten[0]).toBe(wrapper);
    expect(one.dressing.isMerged).toBe(false);
    expect(maskSet(one.model, one.dressing)).toEqual([1]);
    // gone for good: no pass and no poll brings it back
    one.dressing.apply();
    one.dressing.poll();
    expect(mergedMesh(one.model)).toBeUndefined();
    expect(one.forgotten).toHaveLength(1);

    const two = merged();
    two.dressing.setMerged(false);
    expect(mergedMesh(two.model)).toBeUndefined();
    expect(two.dressing.isMerged).toBe(false);
    expect(maskSet(two.model, two.dressing)).toEqual([1]);
    // off for good: a look change and a poll mount nothing
    two.dressing.setHelm(true);
    two.dressing.poll();
    expect(mergedMesh(two.model)).toBeUndefined();
    // and on again: the next poll merges
    two.dressing.setMerged(true);
    expect(mergedMesh(two.model)).toBeUndefined();
    two.dressing.poll();
    expect(two.dressing.isMerged).toBe(true);
  });

  it('a body nobody sees is not merged: the poll keeps asking until it is drawn', () => {
    const { model, dressing, state } = mergeable();
    // the far mesh draws this body, or nothing does
    state.drawn = false;
    dressing.setMerged(true);
    state.asks = 0;
    for (let i = 0; i < 3; i++) dressing.poll();
    // asked on every frame, never settled...
    expect(state.asks).toBe(3);
    // ...and nothing was mounted, or even built, for a head nobody would see
    expect(mergedMesh(model)).toBeUndefined();
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(0);
    expect(maskSet(model, dressing)).toEqual([1]);
    // drawn again: that frame's poll merges it
    state.drawn = true;
    dressing.poll();
    expect(dressing.isMerged).toBe(true);
    expect(maskSet(model, dressing)).toEqual([0]);
    // merged and at rest: the poll is free again
    state.asks = 0;
    dressing.poll();
    dressing.poll();
    expect(state.asks).toBe(0);
  });

  it('with a work queue behind the host, a poll queues ONE unit and the mount waits its turn', () => {
    expect(WOC_HEAD_MERGE_LABEL).toBe('woc-head-merge');
    expect(WOC_HEAD_MOUNT_LABEL).toBe('woc-head-mount');
    const one = mergeable({ queue: true });
    // asking for the merge only reconciles: the queue hears of it from the poll
    one.dressing.setMerged(true);
    expect(one.queued).toEqual([]);
    one.dressing.poll();
    // a head nobody built yet: a unit of the kind that builds
    expect(one.queued.map((unit) => unit.label)).toEqual(['woc-head-merge:a']);
    expect(mergedMesh(one.model)).toBeUndefined();
    expect(maskSet(one.model, one.dressing)).toEqual([1]);
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(0);
    // later frames, the unit still queued: never a second one
    one.dressing.poll();
    one.dressing.poll();
    expect(one.queued).toHaveLength(1);
    one.runQueued();
    expect(one.dressing.isMerged).toBe(true);
    expect(maskSet(one.model, one.dressing)).toEqual([0]);
    // merged and at rest: polls ask for nothing more
    one.dressing.poll();
    expect(one.queued).toEqual([]);

    // a second character in the same face: its geometry is built, so its unit is of
    // the kind that only mounts
    const two = mergeable({ queue: true, library: one.library });
    two.dressing.setMerged(true);
    two.dressing.poll();
    expect(two.queued.map((unit) => unit.label)).toEqual(['woc-head-mount:a']);
    two.runQueued();
    expect(two.dressing.isMerged).toBe(true);
    expect(mergedMesh(two.model)?.geometry).toBe(mergedMesh(one.model)?.geometry);
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(1);
  });

  it('a queued unit looks again when it runs: it mounts the head as it is by then', () => {
    const { model, dressing, queued, runQueued } = mergeable({ queue: true });
    dressing.setMerged(true);
    dressing.poll();
    expect(queued).toHaveLength(1);
    // the face moves before the unit's turn
    dressing.setAppearance(OTHER_FACE);
    dressing.poll();
    expect(queued).toHaveLength(1);
    runQueued();
    expect(dressing.isMerged).toBe(true);
    // only the face that draws was ever built
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(1);
    // ...and it IS that face: reconciling again finds nothing to change
    const mesh = mergedMesh(model);
    dressing.apply();
    expect(mergedMesh(model)).toBe(mesh);
    expect(dressing.isMerged).toBe(true);
    dressing.poll();
    expect(queued).toEqual([]);
  });

  it('a queued unit mounts nothing for a head no longer at rest, and the poll asks again later', () => {
    const library = mergeLibrary();
    installFrom(library, [CORE, hairUrl(DEFAULT_HAIR), beardUrl(DEFAULT_BEARD)]);
    const model = bornModel();
    const { h, queued, runQueued, state } = worldHost(model, { queue: true });
    const dressing = new WocHeadDressing(h, 'a');
    dressing.retint();
    dressing.setAppearance(null);
    dressing.setMerged(true);
    dressing.poll();
    expect(queued).toHaveLength(1);
    // a hairstyle starts streaming before the unit's turn: the old hair is held, and the
    // head is about to change
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headHair: 'mohawk' });
    runQueued();
    expect(mergedMesh(model)).toBeUndefined();
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(0);
    // while it streams no poll queues a mount
    dressing.poll();
    dressing.poll();
    expect(queued).toEqual([]);
    // the file lands: its hang is a unit of the queue too, and no mount is asked for yet
    installFrom(library, [hairUrl('mohawk')]);
    dressing.poll();
    expect(queued.map((unit) => unit.label)).toEqual(['woc-head-hang:a']);
    expect(drawnHair(model)).toEqual([`WocHead_A_hair_${DEFAULT_HAIR}`]);
    const relived = state.relived;
    runQueued();
    // hung and revealed (this host's gate settles at once): the host is told to re-dress
    expect(drawnHair(model)).toEqual(['WocHead_A_hair_mohawk']);
    expect(state.relived).toBeGreaterThan(relived);
    // at rest in the new hair: the next poll asks for the mount
    dressing.poll();
    expect(queued.map((unit) => unit.label)).toEqual(['woc-head-merge:a']);
    runQueued();
    expect(dressing.isMerged).toBe(true);
    expect(drawnMasks(model, dressing).WocHead_A_hair_mohawk).toBe(0);
  });

  it('a queued unit mounts nothing for a body no longer drawn, and the poll asks again when it is', () => {
    const { model, dressing, queued, runQueued, state } = mergeable({ queue: true });
    dressing.setMerged(true);
    dressing.poll();
    expect(queued).toHaveLength(1);
    // the body went to its far mesh before the unit's turn
    state.drawn = false;
    runQueued();
    expect(mergedMesh(model)).toBeUndefined();
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(0);
    // far away, no poll queues a mount
    dressing.poll();
    dressing.poll();
    expect(queued).toEqual([]);
    // near again: the head never settled, so the next poll asks
    state.drawn = true;
    dressing.poll();
    expect(queued).toHaveLength(1);
    runQueued();
    expect(dressing.isMerged).toBe(true);
  });

  it('a unit the queue dropped is not waited on for ever: a gate change lets the head ask again', () => {
    const m = mergeable({ queue: true });
    m.dressing.setMerged(true);
    m.dressing.poll();
    expect(m.queued.map((unit) => unit.label)).toEqual(['woc-head-merge:a']);
    // the queue never runs it (shut down with its renderer generation): one unit per
    // head at a time, so later polls queue nothing more
    const [dropped] = m.queued.splice(0);
    for (let i = 0; i < 3; i++) m.dressing.poll();
    expect(m.queued).toEqual([]);
    expect(mergedMesh(m.model)).toBeUndefined();
    // the body is handed to the next generation (its gate replaced): the head asks again
    m.dressing.gateChanged();
    expect(m.queued).toEqual([]);
    m.dressing.poll();
    expect(m.queued.map((unit) => unit.label)).toEqual(['woc-head-merge:a']);
    m.dressing.poll();
    expect(m.queued).toHaveLength(1);
    m.runQueued();
    expect(m.dressing.isMerged).toBe(true);
    expect(m.state.adopts).toBe(1);
    // should the old unit run after all, it finds nothing waiting: never a second mount
    dropped.work();
    expect(m.state.adopts).toBe(1);
    expect(
      m.model.getObjectByName('head')?.children.filter((c) => c.name === 'woc_head_merged'),
    ).toHaveLength(1);
    m.dressing.poll();
    expect(m.queued).toEqual([]);
  });

  it('a queued unit mounts nothing after dispose, or once merging was switched off', () => {
    const gone = mergeable({ queue: true });
    gone.dressing.setMerged(true);
    gone.dressing.poll();
    expect(gone.queued).toHaveLength(1);
    gone.dressing.dispose();
    gone.runQueued();
    expect(mergedMesh(gone.model)).toBeUndefined();
    expect(maskSet(gone.model, gone.dressing)).toEqual([1]);

    const off = mergeable({ queue: true });
    off.dressing.setMerged(true);
    off.dressing.poll();
    off.dressing.setMerged(false);
    off.runQueued();
    expect(mergedMesh(off.model)).toBeUndefined();
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(0);

    // switched off and on again while a unit waited: that unit belongs to the stand-in
    // that is gone and mounts nothing; one unit at a time, the next poll queues another
    const again = mergeable({ queue: true });
    again.dressing.setMerged(true);
    again.dressing.poll();
    again.dressing.setMerged(false);
    again.dressing.setMerged(true);
    again.dressing.poll();
    expect(again.queued).toHaveLength(1);
    again.runQueued();
    expect(mergedMesh(again.model)).toBeUndefined();
    again.dressing.poll();
    expect(again.queued).toHaveLength(1);
    again.runQueued();
    expect(again.dressing.isMerged).toBe(true);
    expect(
      again.model.getObjectByName('head')?.children.filter((c) => c.name === 'woc_head_merged'),
    ).toHaveLength(1);
  });

  it('only the first stand-in of a program waits behind the gate: the rest show at once', () => {
    const one = mergeable({ gated: true });
    one.dressing.setMerged(true);
    one.dressing.poll();
    expect(gatedStandIns(one.revealed)).toBe(1);
    expect(one.dressing.isMerged).toBe(false);
    // a second body in the same face mounts while the first still links: nothing is
    // proven yet, so it waits behind the gate too
    const two = mergeable({ gated: true, library: one.library });
    two.dressing.setMerged(true);
    two.dressing.poll();
    expect(gatedStandIns(two.revealed)).toBe(1);
    expect(two.dressing.isMerged).toBe(false);
    one.link();
    two.link();
    expect(one.dressing.isMerged).toBe(true);
    expect(two.dressing.isMerged).toBe(true);
    // a third: a head that took the gate still proves the program, so it stands the
    // moment it mounts
    const three = mergeable({ gated: true, library: one.library });
    three.dressing.setMerged(true);
    three.dressing.poll();
    expect(gatedStandIns(three.revealed)).toBe(0);
    expect(three.dressing.isMerged).toBe(true);
    expect(mergedMesh(three.model)?.parent?.visible).toBe(true);
    expect(maskSet(three.model, three.dressing)).toEqual([0]);
    // (each body wraps its own clone of the one tier material: one program between them)
    expect(mergedMesh(three.model)?.material).not.toBe(mergedMesh(one.model)?.material);
  });

  it('a body disposed while it is the witness lets go of it there and then: the next head takes the gate', () => {
    const one = mergeable({ gated: true });
    one.dressing.setMerged(true);
    one.dressing.poll();
    one.link();
    expect(one.dressing.isMerged).toBe(true);
    // it leaves. Its gate's proof would still answer yes here (this fake context holds
    // on to everything), so only letting go of the witness at dispose sends the next head
    // to the gate: guards a witness that kept its mesh, its buffers and the renderer
    // behind its proof alive until some later head happened to ask
    const asked = one.state.proofs;
    one.dressing.dispose();
    const two = mergeable({ gated: true, library: one.library });
    two.dressing.setMerged(true);
    two.dressing.poll();
    expect(one.state.proofs).toBe(asked);
    expect(gatedStandIns(two.revealed)).toBe(1);
    expect(two.dressing.isMerged).toBe(false);
    two.link();
    expect(two.dressing.isMerged).toBe(true);
    // ...and so does switching the merge off on the body that was the witness
    two.dressing.setMerged(false);
    const three = mergeable({ gated: true, library: one.library });
    three.dressing.setMerged(true);
    three.dressing.poll();
    expect(gatedStandIns(three.revealed)).toBe(1);
  });

  it("the skip is the gate's own proof, asked again at every mount, never a remembered bit", () => {
    const one = merged({ gated: true });
    // the newest proven reveal is the witness: its gate's proof is asked when a head mounts
    const asked = one.state.proofs;
    const two = mergeable({ gated: true, library: one.library });
    two.dressing.setMerged(true);
    two.dressing.poll();
    expect(one.state.proofs).toBe(asked + 1);
    expect(gatedStandIns(two.revealed)).toBe(0);
    expect(two.dressing.isMerged).toBe(true);

    // The context behind the witness no longer holds what its gate linked (restored after
    // a loss, or the renderer rebuilt, or every material of the program disposed and the
    // program released with the last): the proof answers no, and the next head of the very
    // same face takes the gate instead of linking on a live frame.
    one.state.context = false;
    const three = mergeable({ gated: true, library: one.library });
    three.dressing.setMerged(true);
    three.dressing.poll();
    expect(gatedStandIns(three.revealed)).toBe(1);
    expect(three.dressing.isMerged).toBe(false);
    expect(mergedMesh(three.model)?.parent?.visible).toBe(false);
    expect(maskSet(three.model, three.dressing)).toEqual([1]);
    // its own reveal proves the program again: it is the witness now
    three.link();
    expect(three.dressing.isMerged).toBe(true);
    const four = mergeable({ gated: true, library: one.library });
    four.dressing.setMerged(true);
    four.dressing.poll();
    expect(gatedStandIns(four.revealed)).toBe(0);
    expect(four.dressing.isMerged).toBe(true);
    // ...and the dead witness is never trusted again, even should its proof answer yes
    one.state.context = true;
    three.state.context = false;
    const five = mergeable({ gated: true, library: one.library });
    five.dressing.setMerged(true);
    five.dressing.poll();
    expect(gatedStandIns(five.revealed)).toBe(1);
    expect(five.dressing.isMerged).toBe(false);
  });

  it('the same body re-mounting after a restore takes the gate again too', () => {
    const { model, dressing, revealed, link, state } = merged({ gated: true });
    expect(gatedStandIns(revealed)).toBe(1);
    // another face: the same wrap, its program still proven, no gate
    dressing.setAppearance(OTHER_FACE);
    dressing.poll();
    expect(dressing.isMerged).toBe(true);
    expect(gatedStandIns(revealed)).toBe(1);
    // the context is restored: every program is gone, whatever this body remembers
    state.context = false;
    dressing.setAppearance(DEFAULT_APPEARANCE);
    dressing.poll();
    expect(gatedStandIns(revealed)).toBe(2);
    expect(dressing.isMerged).toBe(false);
    expect(maskSet(model, dressing)).toEqual([1]);
    state.context = true;
    link();
    expect(dressing.isMerged).toBe(true);
  });

  it('a gate that hands no proof leaves no witness: every head takes its own gate', () => {
    // a host that cannot prove a link (no parallel shader compile): its settle vouches
    // for the reveal, but there is nothing to ask again later
    const one = merged({ gated: true, unproven: true });
    expect(one.dressing.isMerged).toBe(true);
    const two = mergeable({ gated: true, unproven: true, library: one.library });
    two.dressing.setMerged(true);
    two.dressing.poll();
    expect(gatedStandIns(two.revealed)).toBe(1);
    expect(two.dressing.isMerged).toBe(false);
    two.link();
    expect(two.dressing.isMerged).toBe(true);
  });

  it('a witness wearing an effect proves nothing for now: the next head takes the gate', () => {
    const one = merged({ gated: true });
    const witness = mergedMesh(one.model) as THREE.Mesh;
    const plain = witness.material as THREE.Material;
    // the host mounts an effect over the witness (a buff glow: another material object)
    witness.material = cloneMaterialWithHooks(plain);
    const asked = one.state.proofs;
    const two = mergeable({ gated: true, library: one.library });
    two.dressing.setMerged(true);
    two.dressing.poll();
    expect(gatedStandIns(two.revealed)).toBe(1);
    // the proof is about the material the gate proved, so it was not even asked
    expect(one.state.proofs).toBe(asked);
    two.link();
    expect(two.dressing.isMerged).toBe(true);
  });

  it('a gate that gave up leaves the head in its pieces: planned once more, then left for good', () => {
    const one = mergeable({ gated: true });
    one.dressing.setMerged(true);
    one.dressing.poll();
    const wrapper = mergedMesh(one.model)?.parent;
    one.link(false);
    // its programs never linked: drawing it would link on a live frame
    expect(mergedMesh(one.model)).toBeUndefined();
    expect(wrapper?.parent).toBeNull();
    expect(wrapper?.visible).toBe(false);
    expect(one.dressing.isMerged).toBe(false);
    expect(maskSet(one.model, one.dressing)).toEqual([1]);
    // planned again in the same callback (a miss is usually an effect edge during the
    // link): the next poll mounts it once more, behind the gate again
    one.dressing.poll();
    expect(mergedMesh(one.model)).toBeDefined();
    expect(gatedStandIns(one.revealed)).toBe(2);
    expect(one.dressing.isMerged).toBe(false);
    one.link(false);
    // a second miss running: this face stays in its pieces on this body
    expect(mergedMesh(one.model)).toBeUndefined();
    one.dressing.poll();
    one.dressing.apply();
    one.dressing.retint();
    one.dressing.poll();
    expect(mergedMesh(one.model)).toBeUndefined();
    expect(gatedStandIns(one.revealed)).toBe(2);
    expect(one.state.adopts).toBe(2);
    expect(maskSet(one.model, one.dressing)).toEqual([1]);

    // nothing was proven: another body in the same face still waits behind its gate
    const two = mergeable({ gated: true, library: one.library });
    two.dressing.setMerged(true);
    two.dressing.poll();
    expect(gatedStandIns(two.revealed)).toBe(1);
    expect(two.dressing.isMerged).toBe(false);
    two.link();
    expect(two.dressing.isMerged).toBe(true);
  });

  it('a head whose first reveal missed stands on its second, and is then the witness of its program', () => {
    const one = mergeable({ gated: true });
    one.dressing.setMerged(true);
    one.dressing.poll();
    one.link(false);
    one.dressing.poll();
    one.link();
    expect(one.dressing.isMerged).toBe(true);
    expect(maskSet(one.model, one.dressing)).toEqual([0]);
    expect(gatedStandIns(one.revealed)).toBe(2);
    // the gate ran its course this time: the next body of the face takes no gate
    const two = mergeable({ gated: true, library: one.library });
    two.dressing.setMerged(true);
    two.dressing.poll();
    expect(gatedStandIns(two.revealed)).toBe(0);
    expect(two.dressing.isMerged).toBe(true);
  });

  it('a head taken down by an effect still linking is held: no pass plans it and no poll adopts it until the next effect edge', () => {
    // the body is about to turn translucent: the effect's swap is still linking, so the
    // pieces look opaque, but a mesh adopted now takes the effect's material at once
    let ghost = true;
    const m = mergeable({
      onAdopt: (node) => {
        const mesh = standInOf(node);
        if (mesh && ghost) mesh.material = new THREE.MeshStandardMaterial({ transparent: true });
      },
    });
    const plans = planCounter(m.model);
    m.dressing.setMerged(true);
    m.dressing.poll();
    // mounted, and taken straight down: one two sided mesh would blend its pieces wrong
    expect(m.state.adopts).toBe(1);
    expect(mergedMesh(m.model)).toBeUndefined();
    expect(m.forgotten).toHaveLength(1);
    expect(m.dressing.isMerged).toBe(false);
    expect(maskSet(m.model, m.dressing)).toEqual([1]);

    // held: while the effect has neither committed nor been called off, no pass a host
    // runs plans the head again (each of them reconciles it), and no poll mounts anything
    const held = plans();
    for (let i = 0; i < 3; i++) m.dressing.poll();
    m.dressing.apply();
    m.dressing.poll();
    m.dressing.setHelm(true);
    m.dressing.poll();
    m.dressing.setHelm(false);
    m.dressing.poll();
    m.dressing.retint();
    m.dressing.poll();
    expect(plans()).toBe(held);
    expect(m.state.adopts).toBe(1);
    expect(mergedMesh(m.model)).toBeUndefined();
    expect(maskSet(m.model, m.dressing)).toEqual([1]);

    // the effect is called off before it ever showed (the pieces never turned
    // transparent): the host's next effect edge ends the hold and plans the head, once
    ghost = false;
    m.dressing.effectsChanged();
    expect(plans()).toBe(held + 1);
    expect(mergedMesh(m.model)).toBeUndefined();
    m.dressing.poll();
    expect(m.state.adopts).toBe(2);
    expect(m.dressing.isMerged).toBe(true);
    expect(maskSet(m.model, m.dressing)).toEqual([0]);
    // the hold is over: an effect edge that changes nothing plans nothing
    m.dressing.effectsChanged();
    expect(plans()).toBe(held + 1);
    expect(m.dressing.isMerged).toBe(true);
  });

  it('the effect edge that ends a hold leaves the head in its pieces when the body turned translucent', () => {
    let ghost = true;
    const m = mergeable({
      onAdopt: (node) => {
        const mesh = standInOf(node);
        if (mesh && ghost) mesh.material = new THREE.MeshStandardMaterial({ transparent: true });
      },
    });
    const base = m.model.getObjectByName('WocHead_A_base') as THREE.Mesh;
    const plans = planCounter(m.model);
    m.dressing.setMerged(true);
    m.dressing.poll();
    expect(m.state.adopts).toBe(1);
    expect(mergedMesh(m.model)).toBeUndefined();
    const held = plans();
    // the swap commits: the pieces draw translucent, and the host says so
    (base.material as THREE.Material).transparent = true;
    m.dressing.effectsChanged();
    for (let i = 0; i < 3; i++) m.dressing.poll();
    m.dressing.apply();
    m.dressing.poll();
    // a head drawn through the effect has no stand-in: nothing planned, nothing adopted
    expect(plans()).toBe(held);
    expect(m.state.adopts).toBe(1);
    expect(mergedMesh(m.model)).toBeUndefined();
    expect(maskSet(m.model, m.dressing)).toEqual([1]);
    // the effect ends: planned by that edge (the hold went with the edge before it),
    // merged by the next poll
    ghost = false;
    (base.material as THREE.Material).transparent = false;
    m.dressing.effectsChanged();
    expect(plans()).toBe(held + 1);
    expect(mergedMesh(m.model)).toBeUndefined();
    m.dressing.poll();
    expect(m.state.adopts).toBe(2);
    expect(m.dressing.isMerged).toBe(true);
  });

  /** What the host can mount over the stand-in's plain wrap at an effect edge without a
   *  link on a live frame. */
  const NEEDS_NO_LINK: [string, (plain: THREE.Material) => THREE.Material][] = [
    // a clone that draws with the plain wrap's own program (a buff glow: uniforms only)
    ['a material of the very program the gate linked', (plain) => cloneMaterialWithHooks(plain)],
    // a blending overlay: the host links it before it mounts it
    [
      'a translucent overlay the host staged',
      (plain) => {
        const overlay = cloneMaterialWithHooks(plain);
        overlay.transparent = true;
        return overlay;
      },
    ],
    // the hit response: a program of its own, linked by the host's staging too
    [
      'the hit response the host staged',
      (plain) => createSurfaceResponseMaterial(plain, surfaceResponseUniforms()),
    ],
  ];

  it.each(NEEDS_NO_LINK)(
    'an unprepared settle is overruled when an effect edge swapped in %s',
    (_what, effect) => {
      const m = mergeable({ gated: true });
      m.dressing.setMerged(true);
      m.dressing.poll();
      const mesh = mergedMesh(m.model) as THREE.Mesh;
      const plain = mesh.material as THREE.Material;
      // an effect edge during the link: the host mounts another material on the stand-in
      const mounted = effect(plain);
      expect(mounted).not.toBe(plain);
      mesh.material = mounted;
      // the gate proves what the mesh wears WHEN IT SETTLES, so it reads as unprepared,
      // though drawing this material links nothing
      m.link(false);
      expect(m.dressing.isMerged).toBe(true);
      expect(mergedMesh(m.model)).toBe(mesh);
      expect(mesh.parent?.visible).toBe(true);
      expect(maskSet(m.model, m.dressing)).toEqual([0]);
      expect(m.state.adopts).toBe(1);
      // ...and an overruled miss proves nothing of the plain program: the next body of
      // the face, on the same tier material, still takes the gate
      const two = mergeable({ gated: true, library: m.library });
      two.dressing.setMerged(true);
      two.dressing.poll();
      expect(gatedStandIns(two.revealed)).toBe(1);
      expect(two.dressing.isMerged).toBe(false);
      two.link();
      expect(two.dressing.isMerged).toBe(true);
    },
  );

  it('a PREPARED settle after an effect edge swapped the material proves nothing of the plain program either', () => {
    const m = mergeable({ gated: true });
    m.dressing.setMerged(true);
    m.dressing.poll();
    const mesh = mergedMesh(m.model) as THREE.Mesh;
    // the same program, another material object: what the gate proved linked is what the
    // mesh wears when it settles, not the wrap its link started on
    mesh.material = cloneMaterialWithHooks(mesh.material as THREE.Material);
    m.link();
    expect(m.dressing.isMerged).toBe(true);
    expect(maskSet(m.model, m.dressing)).toEqual([0]);
    const two = mergeable({ gated: true, library: m.library });
    two.dressing.setMerged(true);
    two.dressing.poll();
    expect(gatedStandIns(two.revealed)).toBe(1);
    expect(two.dressing.isMerged).toBe(false);
    // a settle prepared on the very material it started with IS the proof
    two.link();
    expect(two.dressing.isMerged).toBe(true);
    const three = mergeable({ gated: true, library: m.library });
    three.dressing.setMerged(true);
    three.dressing.poll();
    expect(gatedStandIns(three.revealed)).toBe(0);
    expect(three.dressing.isMerged).toBe(true);
  });

  it("a head mounted under an effect's own program always takes the gate, and proves nothing of the plain one", () => {
    const strike = (node: THREE.Object3D): void => {
      const mesh = standInOf(node);
      if (!mesh) return;
      mesh.material = createSurfaceResponseMaterial(
        mesh.material as THREE.Material,
        surfaceResponseUniforms(),
      );
    };
    // the plain program, linked by a first body...
    const first = merged({ gated: true });
    // ...lets no struck head skip its gate: that one wears another program
    const struck = mergeable({ gated: true, library: first.library, onAdopt: strike });
    struck.dressing.setMerged(true);
    struck.dressing.poll();
    expect(gatedStandIns(struck.revealed)).toBe(1);
    expect(struck.dressing.isMerged).toBe(false);
    struck.link();
    expect(struck.dressing.isMerged).toBe(true);

    // on a face nobody linked: a struck head's gate proves the hit response's program,
    // so a plain head after it still takes a gate of its own
    const other = mergeable({ gated: true, onAdopt: strike });
    other.dressing.setMerged(true);
    other.dressing.poll();
    other.link();
    expect(other.dressing.isMerged).toBe(true);
    const plain = mergeable({ gated: true, library: other.library });
    plain.dressing.setMerged(true);
    plain.dressing.poll();
    expect(gatedStandIns(plain.revealed)).toBe(1);
    expect(plain.dressing.isMerged).toBe(false);
    plain.link();
    expect(plain.dressing.isMerged).toBe(true);
  });

  /** A body whose stand-in is adopted under an effect with a program nobody stages (it
   *  links behind the stand-in's own gate), until `seen.struck` is cleared. */
  function underAnEffect(library?: Library) {
    const seen: { plain: THREE.Material | null; struck: boolean } = { plain: null, struck: true };
    const m = mergeable({
      gated: true,
      library,
      onAdopt: (node) => {
        const mesh = standInOf(node);
        if (!mesh) return;
        seen.plain = mesh.material as THREE.Material;
        if (!seen.struck) return;
        const effect = cloneMaterialWithHooks(seen.plain);
        effect.customProgramCacheKey = () => 'an_effect_of_its_own';
        mesh.material = effect;
      },
    });
    m.dressing.setMerged(true);
    m.dressing.poll();
    return { ...m, seen };
  }

  it('an unprepared settle with the plain wrap back, its program never linked, leaves the head to try again', () => {
    const m = underAnEffect();
    expect(gatedStandIns(m.revealed)).toBe(1);
    const mesh = mergedMesh(m.model) as THREE.Mesh;
    // the effect ends while ITS program links: the plain wrap comes back, which no gate
    // has linked yet
    m.seen.struck = false;
    mesh.material = m.seen.plain as THREE.Material;
    m.link(false);
    expect(mergedMesh(m.model)).toBeUndefined();
    expect(m.dressing.isMerged).toBe(false);
    expect(maskSet(m.model, m.dressing)).toEqual([1]);
    // planned again in that callback: the next poll mounts it, on the plain program now
    m.dressing.poll();
    expect(m.state.adopts).toBe(2);
    expect(gatedStandIns(m.revealed)).toBe(2);
    expect(m.dressing.isMerged).toBe(false);
    m.link();
    expect(m.dressing.isMerged).toBe(true);
  });

  it('...and is overruled when a witness still proves the plain program', () => {
    // a first body took the gate on the plain program, and still stands on it
    const first = merged({ gated: true });
    const m = underAnEffect(first.library);
    // under another program it takes the gate, whatever is proven of the plain one
    expect(gatedStandIns(m.revealed)).toBe(1);
    expect(m.dressing.isMerged).toBe(false);
    const mesh = mergedMesh(m.model) as THREE.Mesh;
    m.seen.struck = false;
    mesh.material = m.seen.plain as THREE.Material;
    m.link(false);
    // the plain wrap draws with a program the witness proves: nothing to wait for
    expect(m.dressing.isMerged).toBe(true);
    expect(mergedMesh(m.model)).toBe(mesh);
    expect(m.state.adopts).toBe(1);
  });

  it('...but not once the witness of the plain program is gone: left in its pieces to try again', () => {
    const first = merged({ gated: true });
    const m = underAnEffect(first.library);
    const mesh = mergedMesh(m.model) as THREE.Mesh;
    // the context no longer holds what the first body linked
    first.state.context = false;
    m.seen.struck = false;
    mesh.material = m.seen.plain as THREE.Material;
    m.link(false);
    expect(mergedMesh(m.model)).toBeUndefined();
    expect(m.dressing.isMerged).toBe(false);
    expect(maskSet(m.model, m.dressing)).toEqual([1]);
  });

  it('two characters in one look share ONE merged buffer, whatever order their files hung in', () => {
    const one = merged();
    // the second body: its hairstyle and beard files hung before its core
    const two = merged({
      library: one.library,
      hang: [hairUrl(DEFAULT_HAIR), beardUrl(DEFAULT_BEARD), CORE],
    });
    const order = (model: THREE.Object3D): string[] => [
      ...(wocHeadRigOf(model)?.pieces.keys() ?? []),
    ];
    expect(order(two.model)[0]).toBe(`WocHead_A_hair_${DEFAULT_HAIR}`);
    expect(order(one.model)[0]).toBe('WocHead_A_base');
    const a = mergedMesh(one.model) as THREE.Mesh;
    const b = mergedMesh(two.model) as THREE.Mesh;
    expect(b).not.toBe(a);
    expect(b.geometry).toBe(a.geometry);
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(1);
    // each wears its OWN material and uniform rows: two looks' colours never mix
    expect(b.material).not.toBe(a.material);
    const ua = wocHeadMergedTintOf(a.material as THREE.Material);
    const ub = wocHeadMergedTintOf(b.material as THREE.Material);
    expect(ub).not.toBe(ua);
    two.dressing.setAppearance({ ...DEFAULT_APPEARANCE, hairHue: 0, hairSat: 1, hairLight: 0.5 });
    expect(ub?.tints.value[2].x).toBeCloseTo(1, 5);
    expect(ua?.tints.value[2].toArray()).toEqual([...one.dressing.look.colors.hair]);
    // still one program: the key is the layer's, whatever the colours
    expect((b.material as THREE.Material).customProgramCacheKey()).toBe(
      (a.material as THREE.Material).customProgramCacheKey(),
    );
    // one leaves: the other keeps the buffer
    one.dressing.dispose();
    expect(two.dressing.isMerged).toBe(true);
    expect(mergedMesh(two.model)?.geometry).toBe(a.geometry);
  });

  it('compiles the back-face drop only for a head with a one sided slot, one wrap per variant', () => {
    const one = merged();
    // a Type A head: every piece one sided
    const oneSided = mergedMesh(one.model)?.material as THREE.Material;
    expect(oneSided.defines?.WOC_HM_ONE_SIDED).toBe('');
    expect(wocHeadMergedTintOf(oneSided)?.oneSided).toBe(true);
    expect(
      wocHeadMergedTintOf(oneSided)
        ?.surf.value.slice(0, 11)
        .map((v) => v.y),
    ).toEqual(new Array<number>(11).fill(1));
    one.dressing.dispose();

    // every piece two sided but the hairstyle: the hair is the one sided slot
    const { model, dressing, revealed, link } = merged({
      gated: true,
      library: twoSidedLibrary(),
    });
    const withHair = mergedMesh(model)?.material as THREE.Material;
    expect(withHair.defines?.WOC_HM_ONE_SIDED).toBe('');
    expect(
      wocHeadMergedTintOf(withHair)
        ?.surf.value.slice(0, 11)
        .map((v) => v.y),
    ).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0]);
    expect(gatedStandIns(revealed)).toBe(1);
    // under a helm the hair is gone: an all two sided head, and no drop in its program
    dressing.setHelm(true);
    dressing.poll();
    const helmed = mergedMesh(model)?.material as THREE.Material;
    expect(helmed).not.toBe(withHair);
    expect(helmed.defines ?? {}).not.toHaveProperty('WOC_HM_ONE_SIDED');
    expect(wocHeadMergedTintOf(helmed)?.oneSided).toBe(false);
    expect(wocHeadMergedTintOf(helmed)?.surf.value.every((v) => v.y === 0)).toBe(true);
    // another program, so it waits behind a gate of its own
    expect(gatedStandIns(revealed)).toBe(2);
    expect(dressing.isMerged).toBe(false);
    link();
    expect(dressing.isMerged).toBe(true);
    // the helm comes off: the first variant's wrap is reused, never minted again, and
    // each variant's own reveal still proves its program
    dressing.setHelm(false);
    dressing.poll();
    expect(mergedMesh(model)?.material).toBe(withHair);
    expect(dressing.isMerged).toBe(true);
    dressing.setHelm(true);
    dressing.poll();
    expect(mergedMesh(model)?.material).toBe(helmed);
    expect(dressing.isMerged).toBe(true);
    expect(gatedStandIns(revealed)).toBe(2);
  });

  it("folds a hairstyle's scalp cap on its own texture layer", () => {
    // a hairstyle of two meshes on two textures (the cut, and the fitted cap under it)
    const capTex = new THREE.Texture();
    const library: Library = splitHeadScenes('a', (name) => {
      if (name !== 'WocHead_A_hair_quiff') return atlasPiece(name);
      const node = new THREE.Group();
      node.name = name;
      const strands = atlasPiece(name);
      strands.name = 'quiff_strands';
      const cap = atlasPiece(name);
      cap.name = 'quiff_cap';
      const capMaterial = cap.material as THREE.MeshStandardMaterial;
      capMaterial.name = 'hair_x_scalp';
      capMaterial.map = capTex;
      capMaterial.roughness = 0.375;
      node.add(strands, cap);
      return node;
    });
    const { model, dressing } = merged({ library });
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headHair: 'quiff' });
    expect(drawnHair(model)).toEqual(['WocHead_A_hair_quiff']);
    dressing.poll();
    expect(dressing.isMerged).toBe(true);
    const mesh = mergedMesh(model) as THREE.Mesh;
    const u = wocHeadMergedTintOf(mesh.material as THREE.Material);
    // twelve slots now: the cut on the hair layer, its cap on the scalp layer
    expect(u?.col.value.map((v) => v.w).slice(0, 12)).toEqual([0, 2, 0, 0, 0, 0, 0, 0, 1, 3, 0, 0]);
    expect(u?.ref.value.map((v) => v.w).slice(0, 12)).toEqual([1, 3, 4, 4, 1, 1, 2, 2, 3, 3, 1, 1]);
    expect(u?.emi.value[9].w).toBe(0.375);
    expect(u?.hair.value).toBe(MERGE_HAIR_TEX);
    expect(u?.scalp.value).toBe(capTex);
    expect(u?.beard.value).toBe(MERGE_BEARD_TEX);
    // both of its meshes stand down for the merged one
    const quiff = model.getObjectByName('WocHead_A_hair_quiff') as THREE.Object3D;
    expect(quiff.children.map((c) => c.layers.mask)).toEqual([0, 0]);
    expect(mesh.geometry.getAttribute('position').count).toBe(12 * 24);
    // back to a one-texture hairstyle: the scalp sampler lets go of the cap's texture
    dressing.setAppearance(DEFAULT_APPEARANCE);
    dressing.poll();
    expect(
      wocHeadMergedTintOf(mergedMesh(model)?.material as THREE.Material)?.scalp.value,
    ).toBeNull();
    expect(quiff.children.map((c) => c.layers.mask)).toEqual([1, 1]);
  });

  it('a gold piercing keeps drawing by itself beside the merged head', () => {
    const { model, dressing } = merged();
    // its material takes the worn metal layer by name, which the merged one does not carry
    dressing.setAppearance({ ...DEFAULT_APPEARANCE, headPiercing: 'lip' });
    dressing.poll();
    expect(dressing.isMerged).toBe(true);
    const masks = drawnMasks(model, dressing);
    expect(masks.WocHead_A_piercing_lip).toBe(1);
    expect(Object.entries(masks).filter(([, mask]) => mask !== 0)).toEqual([
      ['WocHead_A_piercing_lip', 1],
    ]);
    expect(mergedMesh(model)?.geometry.getAttribute('position').count).toBe(
      DEFAULT_PIECES.length * 24,
    );
  });

  it('a library with no atlas texture never merges: the head keeps its pieces', () => {
    // this suite's plain library: untextured pieces, no white cell on the base
    const { model, dressing } = liveDressing();
    dressing.setMerged(true);
    for (let i = 0; i < 3; i++) dressing.poll();
    expect(mergedMesh(model)).toBeUndefined();
    expect(dressing.isMerged).toBe(false);
    expect(maskSet(model, dressing)).toEqual([1]);
  });
});

describe('WocHeadDressing: a head file whose compile gate gave up', () => {
  it('is shown all the same (nothing stands in for it), and the head goes live on it', () => {
    install(CORE, beardUrl(DEFAULT_BEARD));
    const model = bornModel();
    const { h, link, state } = worldHost(model, { gated: true });
    const dressing = new WocHeadDressing(h, 'a');
    dressing.retint();
    dressing.setAppearance(null);
    install(hairUrl(DEFAULT_HAIR));
    dressing.poll();
    expect(dressing.isLive).toBe(false);
    expect(dressing.awaited).toBe(true);
    // the gate gave up before the hairstyle's programs linked
    link(false);
    expect(dressing.isLive).toBe(true);
    expect(dressing.awaited).toBe(false);
    expect(drawnHair(model)).toEqual([`WocHead_A_hair_${DEFAULT_HAIR}`]);
    expect(state.relived).toBe(1);
  });
});
