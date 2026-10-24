// A REAL CharacterVisual on a small WOC body, for the suites of the far LOD's queue and of
// the shadow stand-in (tests/woc_far_queue.test.ts, tests/woc_shadow_stand_in.test.ts):
// only asset IO is stubbed. The body is a skinned box whose size in vertices the case
// picks (a far bake is cut by vertex count), on a rig with a head bone and a hand slot, an
// idle clip that moves it off its rest pose, an armor file of a helm and a chest, and a
// held prop. It ships no head library: its head files fail to load, which ends the body's
// wait for its head (woc_head_stream_core.ts wocHeadAwaited), so it draws. The suites
// that need a head on the wire use tests/helpers/woc_visual_harness.ts instead.
//
// A consumer is a happy-dom suite, calls `wocFarFixture()` per case and
// `releaseWocFarFixture()` in its afterEach.
import * as THREE from 'three';
import { expect, vi } from 'vitest';
import type { WocCharacterManifest } from '../../src/render/characters/woc_character_manifest';

export const KEY = 'player_paladin';

/** A standing idle frame (armory_preview.ts IDLE_STATE). */
export const IDLE = {
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

/** Where the idle clip puts the root bone (its rest is the origin). */
export const IDLE_SHIFT = 0.75;
/** How far the idle clip lifts the head bone above its rest. */
export const IDLE_HEAD_LIFT = 0.25;
/** The rest height of the head bone, and of the body's top (a unit box on the origin). */
export const HEAD_BONE_Y = 0.5;

export const manifest: WocCharacterManifest = {
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

/** Vertices of a box cut `segments` times along each edge. */
export const boxVertices = (segments: number): number => 6 * (segments + 1) * (segments + 1);
/** Vertices of each armor part, and of the held prop. */
export const PART = boxVertices(1);

export interface WocFarFixtureOptions {
  /** Cuts along each edge of the body box (1: 24 vertices; 20: 2646, more than one band
   *  of a far bake). */
  segments?: number;
  /** The low tier: no dynamic shadow, so no stand-in. */
  lowTier?: boolean;
}

function baseSource(segments: number) {
  const scene = new THREE.Group();
  const root = new THREE.Bone();
  root.name = 'root';
  const head = new THREE.Bone();
  head.name = 'head';
  head.position.set(0, HEAD_BONE_Y, 0);
  const hand = new THREE.Bone();
  hand.name = 'handslotr';
  hand.position.set(0.5, 0, 0);
  root.add(head, hand);
  scene.add(root);
  const geometry = new THREE.BoxGeometry(1, 1, 1, segments, segments, segments);
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute(
    'skinIndex',
    new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4),
  );
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const body = new THREE.SkinnedMesh(
    geometry,
    new THREE.MeshStandardMaterial({ name: 'body', map: new THREE.Texture() }),
  );
  body.name = 'Character_Body';
  scene.add(body);
  scene.updateMatrixWorld(true);
  body.bind(new THREE.Skeleton([root, head, hand]));
  const idle = new THREE.AnimationClip('Idle', 1, [
    new THREE.VectorKeyframeTrack('root.position', [0, 1], [IDLE_SHIFT, 0, 0, IDLE_SHIFT, 0, 0]),
    new THREE.VectorKeyframeTrack(
      'head.position',
      [0, 1],
      [0, HEAD_BONE_Y + IDLE_HEAD_LIFT, 0, 0, HEAD_BONE_Y + IDLE_HEAD_LIFT, 0],
    ),
  ]);
  return { scene, animations: [idle] };
}

function armorSource() {
  const scene = new THREE.Group();
  const bone = new THREE.Bone();
  bone.name = 'root';
  scene.add(bone);
  const material = new THREE.MeshStandardMaterial({ name: 'armor', map: new THREE.Texture() });
  for (const [name, y] of [
    ['Helm', 1.2],
    ['Chest', 0.2],
  ] as const) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), material);
    mesh.name = name;
    mesh.position.y = y;
    bone.add(mesh);
  }
  return { scene, animations: [] };
}

function propSource() {
  const scene = new THREE.Group();
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 2, 0.1),
    new THREE.MeshStandardMaterial({ name: 'blade' }),
  );
  blade.name = 'Blade';
  scene.add(blade);
  return { scene, animations: [] };
}

export async function wocFarFixture(opts: WocFarFixtureOptions = {}) {
  vi.resetModules();
  const segments = opts.segments ?? 1;
  vi.doMock('../../src/render/assets/loader', () => ({
    loadGltf: vi.fn((url: string) => {
      if (url.includes('/head_type_')) return Promise.reject(new Error('no head library'));
      if (url.includes('/armor/')) return Promise.resolve(armorSource());
      if (url.includes('models/weapons/')) return Promise.resolve(propSource());
      return Promise.resolve(baseSource(segments));
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
  if (opts.lowTier) {
    const gfx = await import('../../src/render/gfx');
    gfx.activateGfxProfile({
      ...gfx.getActiveGfxProfile(),
      settings: gfx.gfxInternalsForTest.settingsFor('low', { search: '?gfx=low' }),
    });
  }
  const { VISUALS } = await import('../../src/render/characters/manifest');
  VISUALS[KEY] = {
    ...VISUALS[KEY],
    wocCharacter: manifest,
    clips: { idle: 'Idle', walk: 'Idle', run: 'Idle', attack: ['Idle'], death: 'Idle' },
    // one held prop on the hand slot, so a bake that kept props would show it
    attach: [{ url: 'models/weapons/sword_1handed.glb', bone: 'handslot.r' }],
    weaponSlots: undefined,
    offhandSlot: undefined,
  };
  const assets = await import('../../src/render/characters/assets');
  await assets.charactersReady();
  await vi.waitFor(() => expect(assets.visualAssetsResident(KEY)).toBe(true));
  const { currentWocArmorTier } = await import('../../src/render/characters/woc_armor_dressing');
  const armor = await import('../../src/render/characters/woc_armor_packs');
  const { wocArmorPackUrl } = await import('../../src/render/characters/woc_armor_core');
  const kitUrl = wocArmorPackUrl('male', 'fixture', currentWocArmorTier('crowd'));
  armor.ensureWocArmorPack(kitUrl);
  await vi.waitFor(() => expect(armor.wocArmorPackResident(kitUrl)).toBe(true));
  // the head core's fetch has failed before any body is built
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const heads = await import('../../src/render/characters/woc_head_packs');
  const { wocHeadAllUrls, wocHeadCoreUrl } = await import(
    '../../src/render/characters/woc_head_catalog'
  );
  heads.ensureWocHeadFile(wocHeadCoreUrl('a'));
  await vi.waitFor(() => expect(heads.wocHeadFileState(wocHeadCoreUrl('a'))).toBe('failed'));
  // ...and so has every other head file a body here could want: one still on the wire
  // would count as a piece joining its head (WocHeadDressing.joining), and a far ask
  // waits for those, where this fixture's bodies are meant to draw, and bake, headless
  for (const type of ['a', 'b'] as const) {
    for (const url of wocHeadAllUrls(type)) heads.failWocHeadFileForTest(url);
  }
  const { CharacterVisual } = await import('../../src/render/characters/visual');
  const farBake = await import('../../src/render/characters/woc_far_bake');
  let now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  /** A crowd body (the world's other characters draw the armor file itself). */
  const body = () => new CharacterVisual(KEY, 0xffffff, 0, null, null, null, null, CROWD);
  return {
    CharacterVisual,
    assets,
    armor,
    farBake,
    kitUrl,
    body,
    bodyVertices: boxVertices(segments),
    nextFrame: (elapsed = 40) => {
      now += elapsed;
    },
  };
}

/** The world's other characters: the crowd's armor detail (index.ts createCharacterVisual). */
export const CROWD = { wocArmorDetail: 'crowd' } as const;

export type WocFarFixture = Awaited<ReturnType<typeof wocFarFixture>>;
export type WocFarFixtureVisual = InstanceType<WocFarFixture['CharacterVisual']>;

/** One unit of work a body handed the renderer's queue. */
export interface HeldUnit {
  readonly run: () => void;
  readonly priority: number | undefined;
  readonly label: string | undefined;
}

/** The renderer's background work queue as a body sees it (background_gpu_queue.ts),
 *  holding every unit until the case runs it: what the real one's frame budget does. */
export function heldQueue() {
  const units: HeldUnit[] = [];
  /** Let whatever a finished unit asked for be asked (a far bake's next unit is enqueued
   *  from the completion of the one before). */
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    units,
    run<T>(work: () => T | Promise<T>, priority?: number, label?: string): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        units.push({
          run: () => {
            try {
              resolve(work() as T);
            } catch (err) {
              reject(err);
            }
          },
          priority,
          label,
        });
      });
    },
    settle,
    /** The labels waiting, in the order they were asked for. */
    labels: (): (string | undefined)[] => units.map((unit) => unit.label),
    /** Run the unit at the head of the queue, then let it ask for the next. */
    async runNext(): Promise<string | undefined> {
      const unit = units.shift();
      unit?.run();
      await settle();
      return unit?.label;
    },
    /** Run every unit, those the units themselves ask for included. Returns the labels in
     *  the order they ran. */
    async runAll(): Promise<(string | undefined)[]> {
      const ran: (string | undefined)[] = [];
      await settle();
      while (units.length > 0) {
        const unit = units.shift();
        unit?.run();
        ran.push(unit?.label);
        await settle();
      }
      return ran;
    },
  };
}

export type HeldQueue = ReturnType<typeof heldQueue>;

/** A consumer's afterEach: put the spied clock back and let go of the loader mock. */
export function releaseWocFarFixture(): void {
  vi.restoreAllMocks();
  vi.doUnmock('../../src/render/assets/loader');
}
