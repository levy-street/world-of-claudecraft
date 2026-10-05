// @vitest-environment happy-dom
// The merged head through the REAL CharacterVisual, with only asset IO stubbed. The rig
// and the dressing are pinned against a mock host elsewhere (woc_head_merge.test.ts,
// woc_head_dressing.test.ts); this suite pins the other half of that seam, the calls the
// visual itself makes (the opt-in, the frame poll, rigDrawn, schedule, adopt, the compile
// gate, effectsChanged, dispose), which nothing else would notice going missing: a world
// body's head mounts as ONE unit of the work queue the renderer installs AFTER the visual
// is built, links hidden behind the gate, stands in for its pieces, goes back to them
// under a translucent effect, and wears the hit response like any other mesh. A head
// whose program an earlier one took the gate for stands with no gate of its own, but
// only on that gate's own proof, asked again in the context as it is now.
import * as THREE from 'three';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: vi.fn((url: string) => {
    if (url.includes('/armor/')) return Promise.resolve(armorSource());
    if (url.includes('head_type_')) return Promise.resolve(headFile(url));
    return Promise.resolve(baseSource());
  }),
  loadHdr: vi.fn(() => new Promise(() => undefined)),
  loadTexture: vi.fn((url: string) =>
    Promise.resolve(Object.assign(new THREE.Texture(), { name: url })),
  ),
  loadKtx2Texture: vi.fn((url: string) =>
    Promise.resolve(Object.assign(new THREE.Texture(), { name: url })),
  ),
  releaseGltf: vi.fn(),
}));

import { charactersReady, visualAssetsResident } from '../src/render/characters/assets';
import { VISUALS } from '../src/render/characters/manifest';
import { DEFAULT_APPEARANCE } from '../src/render/characters/modular';
import { SURFACE_RESPONSE_PROGRAM } from '../src/render/characters/surface_response';
import { CharacterVisual } from '../src/render/characters/visual';
import { wocArmorPackUrl } from '../src/render/characters/woc_armor_core';
import { currentWocArmorTier } from '../src/render/characters/woc_armor_dressing';
import { ensureWocArmorPack, wocArmorPackResident } from '../src/render/characters/woc_armor_packs';
import type { WocCharacterManifest } from '../src/render/characters/woc_character_manifest';
import { wocHeadAllUrls, wocHeadVisibleNodes } from '../src/render/characters/woc_head_catalog';
import { wocHeadMergeInternalsForTest } from '../src/render/characters/woc_head_merge';
import {
  ensureWocHeadFile,
  setWocHeadFileForTest,
  wocHeadFilesResident,
} from '../src/render/characters/woc_head_packs';
import { wocHeadMergedTintOf } from '../src/render/characters/woc_head_tint';
import { splitHeadScene, wocHeadNodesByFile } from './helpers/woc_head_split_fixture';

const KEY = 'player_paladin';
/** A standing idle frame (armory_preview.ts IDLE_STATE). */
const IDLE = {
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
  submerged: false,
} as never;
/** The stand-in's wrapper and mesh (woc_head_merge.ts). */
const WRAPPER = 'woc_head_merged';
const MERGED = 'WocHead_A_merged';
/** The node the visual links an effect's programs on, behind the gate. */
const SCRATCH = 'character_effect_compile_scratch';
const manifest: WocCharacterManifest = {
  schemaVersion: 1,
  rigId: 'fixture',
  fit: 'male',
  baseNodes: ['Character_Body'],
  appearance: {},
  defaultAppearance: {},
  armorSlots: { head: { label: 'Head' }, chest: { label: 'Chest' } },
  items: {
    original_helm: { label: 'Helm', slot: 'head', set: 'fixture', nodes: ['Helm'] },
    original_chest: { label: 'Chest', slot: 'chest', set: 'fixture', nodes: ['Chest'] },
  },
  defaultEquipment: { head: 'original_helm', chest: 'original_chest' },
  animationNames: ['Idle'],
};
/** The default look with another chin: the same pieces, another face. */
const OTHER_FACE = {
  ...DEFAULT_APPEARANCE,
  headShape: { ...DEFAULT_APPEARANCE.headShape, chinWidth: 1 },
};

/** The WOC base: a skinned body on a two-bone rig, ending at the neck. */
function baseSource() {
  const scene = new THREE.Group();
  const root = new THREE.Bone();
  root.name = 'root';
  const head = new THREE.Bone();
  head.name = 'head';
  head.position.set(0, 2, 0);
  root.add(head);
  scene.add(root);
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

/** The kit's file (the body is dressed bare here: only the head is under test). */
function armorSource() {
  const scene = new THREE.Group();
  const bone = new THREE.Bone();
  bone.name = 'root';
  scene.add(bone);
  const material = new THREE.MeshStandardMaterial();
  for (const name of ['Helm', 'Chest']) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    mesh.name = name;
    bone.add(mesh);
  }
  return { scene, animations: [] };
}

/** The textures Type A's library samples: one atlas for the core, the hairstyles' own
 *  and the beards' own. */
const TEXTURES = {
  atlas: new THREE.Texture(),
  hair: new THREE.Texture(),
  beard: new THREE.Texture(),
};

/** One head piece as the split library ships it: a mesh on its own material, named with
 *  its tint role, a core piece on the ONE atlas, a hairstyle and a beard each on their
 *  own texture, a piercing's gold with none; the base head carries the atlas's white
 *  cell and the face controls. */
function headPiece(name: string): THREE.Mesh {
  const slot = /^WocHead_A_([a-z]+)/.exec(name)?.[1] ?? '';
  const role =
    slot === 'beard'
      ? 'hair_beard_x'
      : slot === 'hair'
        ? 'hair_x'
        : slot === 'brows'
          ? 'brow_x'
          : slot === 'eyes'
            ? 'eye_x'
            : slot === 'piercing'
              ? 'metal_gold'
              : 'skin_x';
  const map =
    slot === 'hair'
      ? TEXTURES.hair
      : slot === 'beard'
        ? TEXTURES.beard
        : slot === 'piercing'
          ? null
          : TEXTURES.atlas;
  const material = new THREE.MeshStandardMaterial({ name: role, map });
  const geometry = new THREE.BoxGeometry(0.05, 0.05, 0.05);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  if (name.endsWith('_base')) {
    material.userData.wocHeadAtlas = { white: [0.5, 0.5] };
    const targets = ['FS_Chin_Softness', 'FS_Bald_Crown'];
    geometry.morphAttributes.position = targets.map(() =>
      geometry.getAttribute('position').clone(),
    );
    mesh.morphTargetDictionary = Object.fromEntries(targets.map((t, i) => [t, i]));
    mesh.morphTargetInfluences = targets.map(() => 0);
  }
  return mesh;
}

const HEAD_FILES = wocHeadNodesByFile('a');
function headFile(url: string) {
  const nodes = HEAD_FILES.get(url);
  if (!nodes) throw new Error(`no head file ${url}`);
  return splitHeadScene(nodes, headPiece);
}

interface Gate {
  target: THREE.Object3D;
  settle: (ready?: () => boolean) => void;
}
interface Unit {
  work: () => unknown;
  label: string | undefined;
}

// One fixture body for the file: its base, its kit and every file of its head library are
// resident before any visual is built, as they are for a player who walks into view.
beforeAll(async () => {
  VISUALS[KEY] = {
    ...VISUALS[KEY],
    wocCharacter: manifest,
    clips: { idle: 'Idle', walk: 'Idle', run: 'Idle', attack: ['Idle'], death: 'Idle' },
  };
  await charactersReady();
  await vi.waitFor(() => expect(visualAssetsResident(KEY)).toBe(true));
  const kit = wocArmorPackUrl('male', 'fixture', currentWocArmorTier());
  ensureWocArmorPack(kit);
  await vi.waitFor(() => expect(wocArmorPackResident(kit)).toBe(true));
  const library = wocHeadAllUrls('a');
  for (const url of library) ensureWocHeadFile(url);
  await vi.waitFor(() => expect(wocHeadFilesResident(library)).toBe(true));
});

beforeEach(() => {
  wocHeadMergeInternalsForTest.reset();
  // the library again, on materials of its own: a merged program's witness is kept by the
  // material it was wrapped from (woc_head_merge_proof_core.ts), so a case on another
  // case's materials could find its gate already proven
  for (const url of HEAD_FILES.keys()) setWocHeadFileForTest(url, headFile(url));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The pieces the default look draws, by name. */
const DEFAULT_PIECES = [...wocHeadVisibleNodes('a', {}, { helm: false })].sort();

/**
 * One world body: the real visual, built first, THEN handed its compile gate and work
 * queue (as the renderer does: createCharacterVisualWithRetry), opted in to merged draws
 * as createCharacterVisual does, dressed bare and given its look. The test settles the
 * gate and runs the queue by hand.
 */
function body(opts: { queue?: boolean } = {}) {
  const visual = new CharacterVisual(KEY, 0xffffff, 0);
  visual.setWocDrawMerge(true);
  const gates: Gate[] = [];
  const units: Unit[] = [];
  const gate = (target: THREE.Object3D, settle: Gate['settle']): void => {
    gates.push({ target, settle });
  };
  if (opts.queue === false) visual.setFarBakeGate(gate);
  else {
    visual.setFarBakeGate(gate, {
      run: (work: () => unknown, _priority?: number, label?: string) => {
        units.push({ work, label });
        return Promise.resolve(undefined as never);
      },
    });
  }
  visual.setWocEquipment({}, false);
  visual.setWocHeadLook(DEFAULT_APPEARANCE);
  const pieces = DEFAULT_PIECES.map((name) => visual.root.getObjectByName(name) as THREE.Mesh);
  /** Whether this body's GPU context still holds what its gates linked: what the proof a
   *  settle hands answers whenever it is asked again (the renderer hands
   *  compileTargetPrepared over its context's own settle record). */
  const context = { held: true };
  const proof = (): boolean => context.held;
  return {
    visual,
    gates,
    units,
    pieces,
    context,
    cache: wocHeadMergeInternalsForTest.cache,
    standIn: (): THREE.Mesh | undefined =>
      visual.root.getObjectByName(MERGED) as THREE.Mesh | undefined,
    /** Each default piece's layer mask: 1 when it draws by itself, 0 behind the stand-in. */
    masks: (): number[] => pieces.map((p) => p.layers.mask),
    frame: (): void => visual.update(0.05, IDLE, true),
    /** Run what the work queue holds, as its frame budget would, and what those units ask
     *  for in their turn (a new head is a band of its fold, then its mount). */
    work: (): void => {
      while (units.length > 0) for (const unit of units.splice(0)) unit.work();
    },
    /** The gate asks still open for a target of this name. */
    asked: (name: string): Gate[] => gates.filter((g) => g.target.name === name),
    /** Settle (and forget) every gate ask for a target of this name, handing the gate's
     *  proof as the renderer does (`null`: a gate with no proof to hand). */
    settle: (name: string, ready: (() => boolean) | null = proof): void => {
      for (let i = gates.length - 1; i >= 0; i--) {
        if (gates[i].target.name !== name) continue;
        const [asked] = gates.splice(i, 1);
        asked.settle(ready ?? undefined);
      }
    },
    /** Bring the head's stand-in all the way up. */
    stand(): void {
      this.frame();
      this.work();
      this.settle(WRAPPER);
    },
  };
}

const ALL = (mask: number): number[] => DEFAULT_PIECES.map(() => mask);
const headLabels = (units: readonly Unit[]): (string | undefined)[] =>
  units.map((u) => u.label).filter((label) => label?.startsWith('woc-head'));

describe('a WOC body drawing its head merged, through the real visual', () => {
  it('goes live on its look with every piece drawn, and mounts nothing in a pass', () => {
    const h = body();
    expect(DEFAULT_PIECES).toHaveLength(11);
    expect(h.visual.wocHeadLook).not.toBeNull();
    for (const piece of h.pieces) expect(piece.visible, piece.name).toBe(true);
    expect(h.masks()).toEqual(ALL(1));
    expect(h.standIn()).toBeUndefined();
    expect(headLabels(h.units)).toEqual([]);
    h.visual.dispose();
  });

  it('mounts as ONE unit of the queue installed after it was built, links hidden, then stands', () => {
    const h = body();
    h.frame();
    // the frame poll asks the renderer's queue: a head nobody built is the build kind
    expect(headLabels(h.units)).toEqual(['woc-head-merge:a']);
    h.frame();
    h.frame();
    expect(headLabels(h.units)).toEqual(['woc-head-merge:a']);
    expect(h.standIn()).toBeUndefined();
    expect(h.cache.size).toBe(0);

    // the unit mounts it hidden and asks the gate: the pieces still draw meanwhile
    h.work();
    const mesh = h.standIn() as THREE.Mesh;
    expect(mesh).toBeDefined();
    expect(h.asked(WRAPPER).map((g) => g.target)).toEqual([mesh.parent]);
    expect(h.masks()).toEqual(ALL(1));
    h.frame();
    expect(h.asked(WRAPPER)).toHaveLength(1);
    expect(headLabels(h.units)).toEqual([]);

    // linked: one mesh draws the head, on the head bone, with the merged layer
    h.settle(WRAPPER);
    expect(mesh.parent?.visible).toBe(true);
    expect(mesh.parent?.parent?.name).toBe('head');
    expect(h.masks()).toEqual(ALL(0));
    // the pieces stay shown (the source of truth): only their layers left the lists
    for (const piece of h.pieces) expect(piece.visible, piece.name).toBe(true);
    expect(mesh.geometry.getAttribute('position').count).toBe(DEFAULT_PIECES.length * 24);
    const u = wocHeadMergedTintOf(mesh.material as THREE.Material);
    expect(u).not.toBeNull();
    expect(u?.hair.value).toBe(TEXTURES.hair);
    expect(u?.beard.value).toBe(TEXTURES.beard);
    expect((mesh.material as THREE.MeshStandardMaterial).map).toBe(TEXTURES.atlas);
    // it casts for its pieces, as they did
    expect(mesh.castShadow).toBe(h.pieces[0].castShadow);
    // a steady frame asks for nothing more
    h.frame();
    h.frame();
    expect(headLabels(h.units)).toEqual([]);
    expect(h.asked(WRAPPER)).toEqual([]);
    expect(h.masks()).toEqual(ALL(0));

    // the visual's teardown takes it down: the shared buffer is given back, the pieces
    // are on their layer again
    expect([...h.cache.values()].map((e) => e.refs)).toEqual([1]);
    h.visual.dispose();
    expect([...h.cache.values()].map((e) => e.refs)).toEqual([0]);
    expect(h.masks()).toEqual(ALL(1));
    expect(mesh.parent?.parent).toBeNull();
  });

  it('with no queue behind it (a preview, a direct build) the frame poll mounts on the spot', () => {
    const h = body({ queue: false });
    h.frame();
    expect(h.units).toEqual([]);
    expect(h.standIn()).toBeDefined();
    expect(h.asked(WRAPPER)).toHaveLength(1);
    h.settle(WRAPPER);
    expect(h.masks()).toEqual(ALL(0));
    h.visual.dispose();
  });

  it('a second body in the same face only mounts: the buffer is shared and its program linked', () => {
    const one = body();
    one.stand();
    expect(one.masks()).toEqual(ALL(0));
    const two = body();
    two.frame();
    // already built: the kind that only mounts
    expect(headLabels(two.units)).toEqual(['woc-head-mount:a']);
    two.work();
    // the program the first body linked: no gate of its own, it stands at once
    expect(two.asked(WRAPPER)).toEqual([]);
    expect(two.masks()).toEqual(ALL(0));
    expect(two.standIn()?.geometry).toBe(one.standIn()?.geometry);
    expect(two.standIn()).not.toBe(one.standIn());
    expect([...one.cache.values()].map((e) => e.refs)).toEqual([2]);
    // each wears its own uniforms: two looks' colours never mix
    expect(wocHeadMergedTintOf(two.standIn()?.material as THREE.Material)).not.toBe(
      wocHeadMergedTintOf(one.standIn()?.material as THREE.Material),
    );
    one.visual.dispose();
    expect(two.masks()).toEqual(ALL(0));
    two.visual.dispose();
  });

  it("the skip stands on the first body's gate proof, asked in the context as it is NOW", () => {
    const one = body();
    one.stand();
    // the context behind that proof is restored after a loss (or its renderer rebuilt): the
    // program the first body linked is gone, whatever any script remembers
    one.context.held = false;
    const two = body();
    two.frame();
    two.work();
    // so the second body takes the gate: hidden until its own link is proven
    expect(two.asked(WRAPPER)).toHaveLength(1);
    expect(two.standIn()?.parent?.visible).toBe(false);
    expect(two.masks()).toEqual(ALL(1));
    two.settle(WRAPPER);
    expect(two.masks()).toEqual(ALL(0));
    // ...and is the witness from then on: a third stands at once
    const three = body();
    three.frame();
    three.work();
    expect(three.asked(WRAPPER)).toEqual([]);
    expect(three.masks()).toEqual(ALL(0));
    one.visual.dispose();
    two.visual.dispose();
    three.visual.dispose();
  });

  it('a gate with no proof to hand leaves nothing to skip on: every head takes its own', () => {
    // a host that cannot prove a link (no parallel shader compile): the settle vouches for
    // the reveal, and the next head is gated like the first
    const one = body();
    one.frame();
    one.work();
    one.settle(WRAPPER, null);
    expect(one.masks()).toEqual(ALL(0));
    const two = body();
    two.frame();
    two.work();
    expect(two.asked(WRAPPER)).toHaveLength(1);
    two.settle(WRAPPER, null);
    expect(two.masks()).toEqual(ALL(0));
    one.visual.dispose();
    two.visual.dispose();
  });

  it('goes back to its pieces inside the look pass that changes the face, and merges the new one', () => {
    const h = body();
    h.stand();
    const first = h.standIn() as THREE.Mesh;
    // no frame in between: the pieces draw at once
    expect(h.visual.setWocHeadLook(OTHER_FACE)).toBe(true);
    expect(h.standIn()).toBeUndefined();
    expect(h.masks()).toEqual(ALL(1));
    expect(first.parent?.parent).toBeNull();
    h.frame();
    expect(headLabels(h.units)).toEqual(['woc-head-merge:a']);
    h.work();
    // a face is geometry, never a relink: no second gate
    expect(h.asked(WRAPPER)).toEqual([]);
    expect(h.masks()).toEqual(ALL(0));
    expect(h.standIn()?.geometry).not.toBe(first.geometry);
    expect(h.cache.size).toBe(2);
    h.visual.dispose();
  });

  it('draws its pieces under a translucent effect, and stands again when it ends', () => {
    const h = body();
    h.stand();
    // the ghost run links behind the gate first: nothing changes until it is mounted
    h.visual.setGhost(true);
    expect(h.asked(SCRATCH)).toHaveLength(1);
    h.frame();
    expect(h.masks()).toEqual(ALL(0));
    h.settle(SCRATCH);
    h.frame();
    // mounted on that frame: the pieces draw it, each on its own sidedness
    expect((h.pieces[0].material as THREE.Material).transparent).toBe(true);
    expect(h.standIn()).toBeUndefined();
    expect(h.masks()).toEqual(ALL(1));
    for (let i = 0; i < 3; i++) h.frame();
    expect(h.standIn()).toBeUndefined();
    expect(headLabels(h.units)).toEqual([]);

    // it ends: planned by that edge, mounted by the next frame's unit, with no new link
    h.visual.setGhost(false);
    expect((h.pieces[0].material as THREE.Material).transparent).toBe(false);
    expect(h.standIn()).toBeUndefined();
    h.frame();
    expect(headLabels(h.units)).toEqual(['woc-head-mount:a']);
    h.work();
    expect(h.asked(WRAPPER)).toEqual([]);
    expect(h.masks()).toEqual(ALL(0));
    expect(h.cache.size).toBe(1);
    h.visual.dispose();
  });

  it('mounts nothing for a body nobody sees, and takes its turn when it shows', () => {
    const h = body();
    h.visual.setActive(false);
    h.frame();
    h.frame();
    expect(headLabels(h.units)).toEqual([]);
    h.visual.setActive(true);
    h.frame();
    expect(headLabels(h.units)).toEqual(['woc-head-merge:a']);
    // hidden again before the queue reaches it: the unit looks again and mounts nothing
    h.visual.setActive(false);
    h.work();
    expect(h.standIn()).toBeUndefined();
    expect(h.cache.size).toBe(0);
    h.visual.setActive(true);
    h.frame();
    h.work();
    h.settle(WRAPPER);
    expect(h.masks()).toEqual(ALL(0));
    h.visual.dispose();
  });

  it('a replaced compile gate plans a stand-in still linking again, and leaves a standing one alone', () => {
    const h = body();
    h.frame();
    h.work();
    const first = h.standIn();
    expect(h.asked(WRAPPER)).toHaveLength(1);
    // the body is handed to another renderer generation while it links: a new gate
    // (the queue rides along unchanged)
    const next: Gate[] = [];
    h.visual.setFarBakeGate((target, settle) => {
      next.push({ target, settle });
    });
    // the old gate's settle would never come: taken down, the pieces draw, planned again
    expect(h.standIn()).toBeUndefined();
    expect(h.masks()).toEqual(ALL(1));
    h.frame();
    // its geometry was built by the first try: the kind that only mounts
    expect(headLabels(h.units)).toEqual(['woc-head-mount:a']);
    h.work();
    const asked = next.filter((g) => g.target.name === WRAPPER);
    expect(asked).toHaveLength(1);
    expect(h.standIn()).not.toBe(first);
    expect(asked[0].target).toBe(h.standIn()?.parent);
    asked[0].settle();
    expect(h.masks()).toEqual(ALL(0));
    // the old gate settling late changes nothing
    h.settle(WRAPPER);
    expect(h.masks()).toEqual(ALL(0));

    // a head already standing is linked: another gate change leaves it alone
    const standing = h.standIn();
    h.visual.setFarBakeGate(() => undefined);
    expect(h.standIn()).toBe(standing);
    expect(h.masks()).toEqual(ALL(0));
    h.visual.dispose();
  });

  it('a unit the old queue never ran is not waited on for ever: handed a new gate and queue, the head asks again', () => {
    const h = body();
    h.frame();
    expect(headLabels(h.units)).toEqual(['woc-head-merge:a']);
    // the renderer generation goes and its queue with it: the unit never runs
    h.units.length = 0;
    h.frame();
    h.frame();
    expect(headLabels(h.units)).toEqual([]);
    expect(h.standIn()).toBeUndefined();
    // the body is handed to the next generation: its gate, and its queue
    const gates: Gate[] = [];
    const units: Unit[] = [];
    h.visual.setFarBakeGate(
      (target, settle) => {
        gates.push({ target, settle });
      },
      {
        run: (work: () => unknown, _priority?: number, label?: string) => {
          units.push({ work, label });
          return Promise.resolve(undefined as never);
        },
      },
    );
    h.frame();
    // asked again, of the queue it has NOW
    expect(headLabels(units)).toEqual(['woc-head-merge:a']);
    expect(headLabels(h.units)).toEqual([]);
    h.frame();
    expect(headLabels(units)).toHaveLength(1);
    for (const unit of units.splice(0)) unit.work();
    // folded: the mount is a unit of its own kind, on the same queue
    expect(headLabels(units)).toEqual(['woc-head-mount:a']);
    expect(gates).toEqual([]);
    for (const unit of units.splice(0)) unit.work();
    const asked = gates.filter((g) => g.target.name === WRAPPER);
    expect(asked).toHaveLength(1);
    asked[0].settle();
    expect(h.masks()).toEqual(ALL(0));
    h.visual.dispose();
  });

  it('reads its slot rows off the pre-effect materials when it mounts under an opaque effect', () => {
    const h = body();
    // a rune's tint: an opaque overlay, so the head still merges, and the pieces wear
    // tinted clones while it mounts
    h.visual.setRuneTint(0xff0000);
    h.settle(SCRATCH);
    h.frame();
    const plain = new THREE.Color(0xffffff);
    expect((h.pieces[0].material as THREE.MeshStandardMaterial).color.equals(plain)).toBe(false);
    h.stand();
    expect(h.masks()).toEqual(ALL(0));
    const mesh = h.standIn() as THREE.Mesh;
    const u = wocHeadMergedTintOf(mesh.material as THREE.Material);
    // each slot's colour OVER the merged material's own: one, for pieces that draw the
    // same plain surface. Read off the tinted clones it would be the rune's colour, and
    // the stand-in (which wears the rune's overlay itself) would be tinted twice
    expect(u?.col.value.slice(0, DEFAULT_PIECES.length).map((v) => [v.x, v.y, v.z])).toEqual(
      DEFAULT_PIECES.map(() => [1, 1, 1]),
    );
    // the stand-in draws the rune's tint as its pieces do
    expect((mesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(
      (h.pieces[0].material as THREE.MeshStandardMaterial).color.getHex(),
    );
    h.visual.setRuneTint(null);
    h.frame();
    expect(h.masks()).toEqual(ALL(0));
    expect((mesh.material as THREE.MeshStandardMaterial).color.equals(plain)).toBe(true);
    h.visual.dispose();
  });

  it('wears the hit response like any other mesh: a struck head still draws merged, and glows', () => {
    const h = body();
    h.stand();
    const mesh = h.standIn() as THREE.Mesh;
    const plain = mesh.material as THREE.Material;
    h.visual.respondToElement('fire', 1);
    // the response's program links behind the gate, then mounts on a frame
    h.settle(SCRATCH);
    h.frame();
    const struck = mesh.material as THREE.Material;
    expect(struck).not.toBe(plain);
    expect(struck.userData[SURFACE_RESPONSE_PROGRAM]).toBe(true);
    // an opaque effect: the stand-in keeps standing and draws it itself
    expect(h.standIn()).toBe(mesh);
    expect(h.masks()).toEqual(ALL(0));
    // the same slot rows and colours, under the response's own program
    expect(wocHeadMergedTintOf(struck)).toBe(wocHeadMergedTintOf(plain));
    // its emission reaches the merged head: the response finds the emissive map chunk
    // the merged layer keeps, and adds its glow after the slot's own
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    struck.onBeforeCompile(shader as never, {} as never);
    const glow = shader.fragmentShader.indexOf('totalEmissiveRadiance+=surfaceEmission;');
    const scaled = shader.fragmentShader.indexOf('totalEmissiveRadiance *= wocGlow;');
    expect(scaled).toBeGreaterThan(-1);
    expect(glow).toBeGreaterThan(scaled);
    expect(shader.uniforms.uWocHmRef).toBe(wocHeadMergedTintOf(plain)?.ref);
    h.visual.clearElementResponse();
    h.frame();
    expect(h.standIn()?.material).toBe(plain);
    expect(h.masks()).toEqual(ALL(0));
    h.visual.dispose();
  });
});
