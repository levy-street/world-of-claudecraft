// @vitest-environment happy-dom
// Real CharacterVisual dress/LOD/material paths, with only asset IO stubbed.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WocCharacterManifest } from '../src/render/characters/woc_character_manifest';
import { threeProgramKeys } from './helpers/three_program_keys';

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
const ATLAS = 'textures/skins/woc/test_underarmor.png';
const manifest: WocCharacterManifest = {
  schemaVersion: 1,
  rigId: 'fixture',
  fit: 'male',
  baseNodes: ['Character_Body'],
  appearance: {
    hair: {
      label: 'Hair',
      required: false,
      variants: { default: { label: 'Hair', nodes: ['Hair'] } },
    },
  },
  defaultAppearance: { hair: 'default' },
  armorSlots: { head: { label: 'Head' }, chest: { label: 'Chest' } },
  items: {
    original_helm: {
      label: 'Helm',
      slot: 'head',
      set: 'fixture',
      nodes: ['Helm'],
      hidesAppearance: ['hair'],
    },
    original_chest: { label: 'Chest', slot: 'chest', set: 'fixture', nodes: ['Chest'] },
  },
  defaultEquipment: { head: 'original_helm', chest: 'original_chest' },
  animationNames: ['Idle'],
  underArmorAtlas: { slot: 'chest', url: ATLAS },
};

// Intentionally shared by the base and the armor file: atlas eligibility must split the far
// draw groups, otherwise either the suit or the armor gets the other one's texture. The bodies
// here are CROWD characters, which draw the armor file itself (the medium file): the local
// player's high pack wears clones of a file's materials (woc_armor_top_levels.ts), so it would
// share nothing with the base and test nothing here.
const CROWD = { wocArmorDetail: 'crowd' } as const;
let shared: THREE.MeshStandardMaterial | null = null;
function sharedMaterial(): THREE.MeshStandardMaterial {
  if (!shared) {
    shared = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
    shared.map!.name = 'embedded';
  }
  return shared;
}

/** The streamed armor file (the split files: the kit is its own file): the helm and chest
 *  hang rigid on the file's copy of the rig bone, re-hung on the character's own by name. */
function armorSource() {
  const scene = new THREE.Group();
  const bone = new THREE.Bone();
  bone.name = 'root';
  scene.add(bone);
  for (const [name, x, y] of [
    ['Helm', 0, 4],
    ['Chest', 3, 0],
  ] as const) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), sharedMaterial());
    mesh.name = name;
    mesh.position.set(x, y, 0);
    bone.add(mesh);
  }
  return { scene, animations: [] };
}

function source() {
  const scene = new THREE.Group();
  const material = sharedMaterial();
  for (const [name, x, y] of [
    ['Character_Body', 0, 0],
    ['Hair', 0, 2],
  ] as const) {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const mesh =
      name === 'Character_Body'
        ? new THREE.SkinnedMesh(geometry, material)
        : new THREE.Mesh(geometry, material);
    if (mesh instanceof THREE.SkinnedMesh) {
      const count = geometry.getAttribute('position').count;
      geometry.setAttribute(
        'skinIndex',
        new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4),
      );
      const weights = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) weights[i * 4] = 1;
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
      const bone = new THREE.Bone();
      bone.name = 'root';
      mesh.add(bone);
      mesh.bind(new THREE.Skeleton([bone]));
    }
    mesh.name = name;
    mesh.position.set(x, y, 0);
    if (name === 'Hair') mesh.userData.shadowCaster = false;
    scene.add(mesh);
  }
  return { scene, animations: [new THREE.AnimationClip('Idle', 1, [])] };
}

async function harness() {
  vi.resetModules();
  shared = null;
  vi.doMock('../src/render/assets/loader', () => ({
    // This fixture body has no head library: its head files fail to load, which ends the
    // body's wait for its head (woc_head_stream_core.ts wocHeadAwaited), so it draws.
    loadGltf: vi.fn((url: string) =>
      url.includes('/head_type_')
        ? Promise.reject(new Error('the fixture ships no head file'))
        : Promise.resolve(url.includes('/armor/') ? armorSource() : source()),
    ),
    loadHdr: vi.fn(() => new Promise(() => undefined)),
    loadTexture: vi.fn((url: string) =>
      Promise.resolve(Object.assign(new THREE.Texture(), { name: url })),
    ),
    loadKtx2Texture: vi.fn((url: string) =>
      Promise.resolve(Object.assign(new THREE.Texture(), { name: url.replace(/\.ktx2$/, '.png') })),
    ),
    releaseGltf: vi.fn(),
  }));
  const { VISUALS } = await import('../src/render/characters/manifest');
  VISUALS[KEY] = {
    ...VISUALS[KEY],
    wocCharacter: manifest,
    clips: { idle: 'Idle', walk: 'Idle', run: 'Idle', attack: ['Idle'], death: 'Idle' },
  };
  const assets = await import('../src/render/characters/assets');
  await assets.charactersReady();
  // The WOC base, its library and the kit's armor file stream on demand: land them first.
  await vi.waitFor(() => expect(assets.visualAssetsResident(KEY)).toBe(true));
  const { currentWocArmorTier } = await import('../src/render/characters/woc_armor_dressing');
  const packs = await import('../src/render/characters/woc_armor_packs');
  const { wocArmorPackUrl } = await import('../src/render/characters/woc_armor_core');
  // the crowd's file (the world bodies here) and the full detail's pack (a preview), each born
  // whole
  for (const detail of ['crowd', 'full'] as const) {
    const kit = wocArmorPackUrl('male', 'fixture', currentWocArmorTier(detail));
    packs.ensureWocArmorPack(kit);
    await vi.waitFor(() => expect(packs.wocArmorPackResident(kit)).toBe(true));
  }
  const { CharacterVisual } = await import('../src/render/characters/visual');
  let now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  // every fetch of the head's look has failed before any body is built (the core, and the
  // default hairstyle and beard a look asks for): a head file still on the wire holds a
  // body's far bake back (woc_head_stream_core.ts wocHeadFileJoining), a failed one does not
  const heads = await import('../src/render/characters/woc_head_packs');
  const { wocHeadLookUrls } = await import('../src/render/characters/woc_head_catalog');
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  heads.ensureWocHeadForAppearance('male', null);
  await vi.waitFor(() =>
    expect(wocHeadLookUrls('a', null).map(heads.wocHeadFileState)).toEqual([
      'failed',
      'failed',
      'failed',
    ]),
  );
  return {
    CharacterVisual,
    nextFrame: (elapsed = 40) => {
      now += elapsed;
    },
  };
}

function mesh(root: THREE.Object3D, name: string): THREE.Mesh {
  return root.getObjectByName(name) as THREE.Mesh;
}
function vertices(root: THREE.Object3D, name = 'character_far_mesh'): number {
  return mesh(root, name).geometry.getAttribute('position').count;
}
function mapNames(target: THREE.Mesh): string[] {
  const materials = Array.isArray(target.material) ? target.material : [target.material];
  return materials.map((m) => (m as THREE.MeshStandardMaterial).map?.name ?? 'none');
}

async function previewHarness() {
  await harness();
  const { CharacterPreview } = await import('../src/render/characters/preview');
  const { createPreviewOpenGate } = await import('../src/render/characters/preview_open_gate_core');
  const loader = await import('../src/render/assets/loader');
  let finishAtlas!: () => void;
  vi.mocked(loader.loadKtx2Texture).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishAtlas = () =>
          resolve(Object.assign(new THREE.CompressedTexture([], 1, 1), { name: ATLAS }));
      }),
  );
  const order: string[] = [];
  const compiles: {
    target: THREE.Object3D;
    scene: THREE.Scene | undefined;
    finish(): void;
    fail(err: Error): void;
  }[] = [];
  const programs = new Map<THREE.Material, object>();
  const renderer = {
    compileAsync: (target: THREE.Object3D, _camera: THREE.Camera, scene?: THREE.Scene) => {
      order.push('compile');
      return new Promise<void>((resolve, reject) =>
        compiles.push({ target, scene, finish: resolve, fail: reject }),
      );
    },
    initTexture: (texture: THREE.Texture) => order.push(`upload:${texture.name}`),
    properties: {
      get: (material: THREE.Material) => {
        let program = programs.get(material);
        if (!program) {
          program = {
            getUniforms: () => order.push('uniforms'),
            getAttributes: () => order.push('attributes'),
          };
          programs.set(material, program);
        }
        return { currentProgram: program, programs: new Map([['body', program]]) };
      },
    },
    render: () => order.push('render'),
    forceContextLoss: vi.fn(),
    dispose: vi.fn(),
  };
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  scene.add(group);
  const preview = Object.create(CharacterPreview.prototype) as InstanceType<
    typeof CharacterPreview
  >;
  Object.assign(preview, {
    destroyed: false,
    currentVisual: null,
    currentVisualSig: null,
    currentSkin: 0,
    currentWeaponSkinId: null,
    pendingLook: null,
    closeupCache: new Map(),
    openGate: createPreviewOpenGate(),
    characterGroup: group,
    scene,
    camera: new THREE.PerspectiveCamera(),
    renderer,
    renderActive: true,
    touchQueue: { run: async (work: () => void) => work() },
    yieldToMain: async () => {},
    canvas: { remove: vi.fn() },
  });
  preview.setVisualKey(KEY);
  /** One frame of the preview's own loop for its body (CharacterPreview.animate). */
  const frame = () =>
    (
      preview as unknown as { currentVisual: { update(dt: number, s: never, a: boolean): void } }
    ).currentVisual.update(1 / 60, IDLE, true);
  return {
    preview,
    renderer,
    order,
    compiles,
    scene,
    group,
    frame,
    finishAtlas: () => finishAtlas(),
  };
}

async function flushPreview(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('../src/render/assets/loader');
});

describe('WOC equipment follows the character into the far and shadow bands', () => {
  it("casts its key's stand-in in the shadow band and bakes nothing until the far crossing", async () => {
    // guards: the shadow plan baked a body's far silhouette the frame it asked for a
    // proxy, a whole far bake per character standing in the middle distance
    const { CharacterVisual } = await harness();
    const assets = await import('../src/render/characters/assets');
    const assembled = vi.spyOn(assets, 'assembleModel');
    const visual = new CharacterVisual(KEY, 0xffffff, 0, null, null, null, null, CROWD);
    const gates: (() => void)[] = [];
    visual.setFarBakeGate((_target, settle) => gates.push(settle));
    visual.setWocEquipment({}, false);
    assembled.mockClear();
    const standIn = mesh(visual.root, 'character_shadow_stand_in');
    expect(standIn.visible).toBe(false);
    // the plan asks for the proxy, frame after frame: no bake, no gate, no far mesh, and
    // the stand-in casts from the first of them
    for (let frame = 0; frame < 3; frame++) {
      visual.setProxyShadow(true);
      visual.update(0.016, IDLE, true);
    }
    expect(assembled).not.toHaveBeenCalled();
    expect(gates).toHaveLength(0);
    expect(visual.root.getObjectByName('character_far_mesh')).toBeUndefined();
    expect(standIn.visible).toBe(true);
    expect(standIn.castShadow).toBe(true);
    expect(visual.root.getObjectByName('character_model_wrap')?.visible).toBe(true);
    // the far crossing bakes the body's own silhouette; the stand-in casts while it links
    visual.setFar(true);
    expect(gates).toHaveLength(1);
    const proxy = mesh(visual.root, 'character_shadow_proxy');
    expect(vertices(visual.root, 'character_shadow_proxy')).toBe(24);
    expect(proxy.visible).toBe(false);
    expect(standIn.visible).toBe(true);
    // linked: the body's own takes over, and never both at once
    gates[0]();
    visual.setProxyShadow(true);
    expect(proxy.visible).toBe(true);
    expect(standIn.visible).toBe(false);
    // a re-dress takes the baked silhouette down: the stand-in casts again in that call
    visual.setWocEquipment({ helmet: 'some-helm' }, false);
    expect(visual.root.getObjectByName('character_shadow_proxy')).toBeUndefined();
    expect(standIn.visible).toBe(true);
    // the plan stops asking: nothing casts
    visual.setProxyShadow(false);
    expect(standIn.visible).toBe(false);
    visual.dispose();
  });

  it('bakes bare/equipped/hidden-helm silhouettes behind the compile gate and reuses matching geometry', async () => {
    const { CharacterVisual, nextFrame } = await harness();
    const visual = new CharacterVisual(KEY, 0xffffff, 0, null, null, null, null, CROWD);
    const gates: { target: THREE.Object3D; settle: () => void }[] = [];
    visual.setFarBakeGate((target, settle) => gates.push({ target, settle }));
    visual.setWocEquipment({}, false);
    visual.setFar(true);
    expect(gates).toHaveLength(1);
    const bare = mesh(visual.root, 'character_far_mesh');
    const near = visual.root.getObjectByName('character_model_wrap')!;
    expect(near.visible).toBe(true);
    expect(bare.visible).toBe(false);
    expect(vertices(visual.root)).toBe(48); // body + hair
    expect(vertices(visual.root, 'character_shadow_proxy')).toBe(24); // hair is not a caster
    gates[0].settle();
    expect(near.visible).toBe(true); // settle only flags; reveal is per-frame
    visual.setFar(true);
    expect(bare.visible).toBe(true);
    expect(near.visible).toBe(false);

    visual.setWocEquipment({ helmet: 'some-helm', chest: 'some-chest' }, false);
    expect(near.visible).toBe(true); // no stale kit while the bake is pending
    visual.setFar(true);
    expect(gates).toHaveLength(1); // real bake budget still in force
    nextFrame();
    visual.setFar(true);
    expect(gates).toHaveLength(2);
    expect(vertices(visual.root)).toBe(72); // body + helm + chest
    expect(vertices(visual.root, 'character_shadow_proxy')).toBe(72);
    const equippedGeo = mesh(visual.root, 'character_far_mesh').geometry;
    equippedGeo.computeBoundingBox();
    const helmetTop = equippedGeo.boundingBox!.max.y;

    // Supersede a pending mint. Its callback must never reveal a stale helm.
    visual.setWocEquipment({ helmet: 'some-helm', chest: 'some-chest' }, true);
    nextFrame();
    visual.setFar(true);
    const helmless = mesh(visual.root, 'character_far_mesh');
    gates[1].settle();
    visual.setFar(true);
    expect(helmless.visible).toBe(false);
    expect(near.visible).toBe(true);
    expect(vertices(visual.root)).toBe(72); // body + hair + chest
    expect(vertices(visual.root, 'character_shadow_proxy')).toBe(48);
    helmless.geometry.computeBoundingBox();
    expect(helmless.geometry.boundingBox!.max.y).toBeLessThan(helmetTop);
    gates[2].settle();
    visual.setFar(true);
    expect(helmless.visible).toBe(true);
    const count = gates.length;
    visual.setWocEquipment({ helmet: 'another-helm', chest: 'another-chest' }, true);
    visual.setFar(true);
    expect(mesh(visual.root, 'character_far_mesh')).toBe(helmless);
    expect(gates).toHaveLength(count); // different item ids, same selected parts

    const peer = new CharacterVisual(KEY, 0xffffff, 0, null, null, null, null, CROWD);
    peer.setWocEquipment({}, false);
    peer.setFar(true); // cached bake is free even inside another bake's window
    expect(mesh(peer.root, 'character_far_mesh').geometry).toBe(bare.geometry);
    const dispose = vi.spyOn(bare.geometry, 'dispose');
    visual.dispose();
    expect(dispose).not.toHaveBeenCalled();
    peer.dispose();
  });

  it('bakes a body with no head to fold exactly as before: a group per material, no slot attribute', async () => {
    const { CharacterVisual } = await harness();
    const visual = new CharacterVisual(KEY, 0xffffff, 0, null, null, null, null, CROWD);
    visual.setWocEquipment({ chest: 'some-chest' }, false);
    visual.setFar(true);
    const far = mesh(visual.root, 'character_far_mesh');
    // the merged head's per-vertex slot is added only where a head folds
    // (woc_far_bake.ts): this body's head files never landed
    expect(Object.keys(far.geometry.attributes).sort()).toEqual(['normal', 'position', 'uv']);
    const bake = (
      visual as unknown as {
        wocFarLease: { bake: { mats: unknown[]; isBody: boolean[]; tints: unknown[] } };
      }
    ).wocFarLease.bake;
    // one source material and one tint per group, and nothing riding behind them
    const groups = far.geometry.groups.length;
    expect(groups).toBe(2); // the body on its atlas flag, then its hair and chest together
    expect(bake.mats).toHaveLength(groups);
    expect(bake.isBody).toEqual([true, false]);
    expect(bake.tints).toHaveLength(groups);
    expect(bake.tints.some((tint) => tint !== null && 'slots' in (tint as object))).toBe(false);
    expect(Array.isArray(far.material) ? far.material.length : 1).toBe(groups);
    visual.dispose();
  });

  it('keeps underarmor only on the body in both LODs, including after weapon swap and stow', async () => {
    const { CharacterVisual } = await harness();
    const dressed = new CharacterVisual(KEY, 0xffffff, 0, null, null, null, null, CROWD);
    const bare = new CharacterVisual(KEY, 0xffffff, 0, null, null, null, null, CROWD);
    dressed.setWocEquipment({ chest: 'some-chest' }, false);
    bare.setWocEquipment({}, false);
    await vi.waitFor(() => expect(mapNames(mesh(dressed.root, 'Character_Body'))).toEqual([ATLAS]));
    dressed.setFar(true);
    expect(mapNames(mesh(dressed.root, 'character_far_mesh'))).toEqual([ATLAS, 'embedded']);
    expect(mapNames(mesh(dressed.root, 'Chest'))).toEqual(['embedded']);
    expect(mapNames(mesh(bare.root, 'Character_Body'))).toEqual(['embedded']);
    expect(mesh(dressed.root, 'Character_Body').material).not.toBe(
      mesh(bare.root, 'Character_Body').material,
    );
    dressed.setWeapon('test-sword');
    expect(mapNames(mesh(dressed.root, 'Character_Body'))).toEqual([ATLAS]);
    dressed.setWeaponStowed(true);
    expect(mapNames(mesh(dressed.root, 'Character_Body'))).toEqual([ATLAS]);
    dressed.setWocEquipment({}, false);
    expect(mapNames(mesh(dressed.root, 'Character_Body'))).toEqual(['embedded']);
    dressed.dispose();
    bare.dispose();
  });

  it('takes no skin tint on a body under its under-armor atlas, near and far, and takes it back with the suit', async () => {
    const { CharacterVisual, nextFrame } = await harness();
    const { wocHeadTintOf } = await import('../src/render/characters/woc_head_tint');
    const materials = (target: THREE.Mesh): THREE.Material[] =>
      Array.isArray(target.material) ? target.material : [target.material];
    /** The body's tint uniforms on a mesh (the far mesh draws it as one of its groups). */
    const bodyTint = (target: THREE.Mesh) =>
      materials(target)
        .map((m) => wocHeadTintOf(m))
        .find((u) => u?.surface === 'suit') ?? null;
    const dressed = new CharacterVisual(KEY, 0xffffff, 0, null, null, null, null, CROWD);
    const bare = new CharacterVisual(KEY, 0xffffff, 0, null, null, null, null, CROWD);
    dressed.setWocEquipment({ chest: 'some-chest' }, false);
    bare.setWocEquipment({}, false);
    const body = mesh(dressed.root, 'Character_Body');
    // until the atlas lands the body still draws its own suit: its skin paint is tinted
    expect(mapNames(body)).toEqual(['embedded']);
    expect(bodyTint(body)?.mix.value).toBe(1);
    await vi.waitFor(() => expect(mapNames(body)).toEqual([ATLAS]));
    // the under-armor atlas is cloth edge to edge: the body's layer is off, on the SAME
    // program as the suit's (the switch is the strength uniform, nothing relinks)
    const off = bodyTint(body);
    expect(off?.role).toBe('skin');
    expect(off?.mix.value).toBe(0);
    const bareBody = mesh(bare.root, 'Character_Body');
    expect(bodyTint(bareBody)?.mix.value).toBe(1);
    expect(materials(body)[0].customProgramCacheKey()).toBe(
      materials(bareBody)[0].customProgramCacheKey(),
    );
    // a weapon swap re-derives the whole rig's materials: the body keeps its layer, off
    dressed.setWeapon('test-sword');
    expect(mapNames(body)).toEqual([ATLAS]);
    expect(bodyTint(body)?.mix.value).toBe(0);
    bare.setWeapon('test-sword');
    expect(bodyTint(bareBody)?.mix.value).toBe(1);
    // the far LOD agrees, group by group (a bake each, a budget window apart)
    dressed.setFar(true);
    nextFrame();
    bare.setFar(true);
    const farDressed = mesh(dressed.root, 'character_far_mesh');
    const farBare = mesh(bare.root, 'character_far_mesh');
    expect(mapNames(farDressed)).toEqual([ATLAS, 'embedded']);
    expect(bodyTint(farDressed)?.mix.value).toBe(0);
    expect(bodyTint(farBare)?.mix.value).toBe(1);
    // a skin tone change is a uniform write that leaves the cloth alone, near and far
    const ebony = { skinHue: 20, skinSat: 0.33, skinLight: 0.16 };
    expect(dressed.setWocHeadLook(ebony)).toBe(true);
    expect(bare.setWocHeadLook(ebony)).toBe(true);
    expect(bodyTint(body)?.mix.value).toBe(0);
    expect(bodyTint(farDressed)?.mix.value).toBe(0);
    expect(bodyTint(bareBody)?.mix.value).toBe(1);
    expect(bodyTint(farBare)?.mix.value).toBe(1);
    expect(bodyTint(farBare)?.tint.value.toArray()).toEqual(
      bodyTint(bareBody)?.tint.value.toArray(),
    );
    // the chest comes off: the suit draws again and its skin paint takes the new tone
    dressed.setWocEquipment({}, false);
    expect(mapNames(body)).toEqual(['embedded']);
    expect(bodyTint(body)?.mix.value).toBe(1);
    expect(bodyTint(body)?.tint.value.toArray()).toEqual(bodyTint(bareBody)?.tint.value.toArray());
    nextFrame();
    dressed.setFar(true);
    expect(mapNames(mesh(dressed.root, 'character_far_mesh'))).not.toContain(ATLAS);
    expect(bodyTint(mesh(dressed.root, 'character_far_mesh'))?.mix.value).toBe(1);
    dressed.dispose();
    bare.dispose();
  });

  it('draws every far body under the under-armor atlas with ONE body material, whatever its skin tone', async () => {
    // guards: a material of its own per far body for a skin layer that draws nothing (the
    // body is cloth edge to edge under a chest), sorted between every two far heads
    const { CharacterVisual, nextFrame } = await harness();
    const { wocHeadTintOf } = await import('../src/render/characters/woc_head_tint');
    const farBody = (visual: { root: THREE.Object3D }): THREE.Material => {
      const far = mesh(visual.root, 'character_far_mesh');
      const found = (Array.isArray(far.material) ? far.material : [far.material]).find(
        (m) => wocHeadTintOf(m)?.surface === 'suit',
      );
      if (!found) throw new Error('no far body group');
      return found;
    };
    const build = (worn: Record<string, string>) => {
      const visual = new CharacterVisual(KEY, 0xffffff, 0, null, null, null, null, CROWD);
      visual.setWocEquipment(worn, false);
      return visual;
    };
    const armored = [build({ chest: 'some-chest' }), build({ chest: 'some-chest' })];
    const bare = [build({}), build({})];
    for (const visual of armored) {
      await vi.waitFor(() =>
        expect(mapNames(mesh(visual.root, 'Character_Body'))).toEqual([ATLAS]),
      );
    }
    // two skin tones in each pair
    const ebony = { skinHue: 20, skinSat: 0.33, skinLight: 0.16 };
    expect(armored[1].setWocHeadLook(ebony)).toBe(true);
    expect(bare[1].setWocHeadLook(ebony)).toBe(true);
    // a bake per kit, a budget window apart (the second of each pair mounts the cached one)
    armored[0].setFar(true);
    armored[1].setFar(true);
    nextFrame();
    bare[0].setFar(true);
    bare[1].setFar(true);
    // under the atlas: the very same material on both bodies, its layer off
    const shared = farBody(armored[0]);
    expect(farBody(armored[1])).toBe(shared);
    expect(wocHeadTintOf(shared)?.mix.value).toBe(0);
    expect(mapNames(mesh(armored[0].root, 'character_far_mesh'))).toEqual([ATLAS, 'embedded']);
    // on the suit the skin paint draws each body's own tone: a material each
    expect(farBody(bare[1])).not.toBe(farBody(bare[0]));
    expect(wocHeadTintOf(farBody(bare[0]))?.mix.value).toBe(1);
    expect(wocHeadTintOf(farBody(bare[1]))?.tint.value.toArray()).not.toEqual(
      wocHeadTintOf(farBody(bare[0]))?.tint.value.toArray(),
    );
    // a tone change on one armored body is still nobody's business under the atlas
    expect(armored[0].setWocHeadLook({ skinHue: 30, skinSat: 0.5, skinLight: 0.7 })).toBe(true);
    expect(farBody(armored[0])).toBe(shared);
    expect(wocHeadTintOf(shared)?.mix.value).toBe(0);
    // one of them leaves: the other keeps drawing the material, which is not freed
    const freed = vi.spyOn(shared, 'dispose');
    armored[0].dispose();
    expect(freed).not.toHaveBeenCalled();
    expect(farBody(armored[1])).toBe(shared);
    for (const visual of [armored[1], ...bare]) visual.dispose();
  });

  it('keeps the linked body atlas during load/compile and cancels superseded or disposed atlas swaps', async () => {
    const { CharacterVisual } = await harness();
    const visual = new CharacterVisual(KEY, 0xffffff, 0, null, null, null, null, CROWD);
    const body = mesh(visual.root, 'Character_Body');
    const gates: { target: THREE.Object3D; settle: () => void }[] = [];
    visual.setFarBakeGate((target, settle) => gates.push({ target, settle }));
    visual.setWocEquipment({ chest: 'some-chest' }, false);
    await vi.waitFor(() =>
      expect(gates.some(({ target }) => target.name === 'character_body_atlas_scratch')).toBe(true),
    );
    const pending = gates.find(({ target }) => target.name === 'character_body_atlas_scratch')!;
    expect(mapNames(body)).toEqual(['embedded']);
    const twin = pending.target.children[0] as THREE.SkinnedMesh;
    expect(twin.isSkinnedMesh).toBe(true);
    expect(twin.geometry).toBe(body.geometry);
    expect(twin.visible).toBe(false);
    expect(mapNames(twin)).toEqual([ATLAS]);
    visual.setWeapon('test-sword');
    expect(mapNames(body)).toEqual(['embedded']);
    pending.settle();
    visual.update(1 / 60, IDLE, true);
    expect(mapNames(body)).toEqual([ATLAS]);
    expect(pending.target.parent).toBeNull();
    visual.setWocEquipment({}, false);
    const removing = gates[gates.length - 1];
    visual.setWocEquipment({ chest: 'some-chest' }, false);
    // a settle of the swap the chest superseded commits nothing, on this frame or a later one
    removing.settle();
    visual.update(1 / 60, IDLE, true);
    expect(mapNames(body)).toEqual([ATLAS]);
    expect(removing.target.parent).toBeNull();
    visual.setWocEquipment({}, false);
    const disposed = gates[gates.length - 1];
    visual.dispose();
    disposed.settle();
    expect(disposed.target.parent).toBeNull();
  });

  // The swap behind a gate, step by step (woc_atlas_swap.ts): what the gate is asked to
  // link, when the swap is taken, and what a settle that could not vouch for it does.
  describe('the under-armor atlas swap behind the compile gate', () => {
    type Gate = {
      target: THREE.Object3D;
      settle: (ready?: () => boolean) => void;
      /** What the first twin wore at the moment the gate was asked (a gate may compile inside
       *  the ask itself, as the preview's does). */
      asked: THREE.Material | null;
    };
    const SCRATCH = 'character_body_atlas_scratch';
    const single = (m: THREE.Material | THREE.Material[]): THREE.Material =>
      Array.isArray(m) ? m[0] : m;

    /** A crowd body that put its chest on behind a gate: the atlas landed, its twin is asked.
     *  `refuse` makes the gate throw on the asks it returns true for (by ask count, from 1). */
    async function gatedSwap(refuse: (ask: number) => boolean = () => false) {
      const h = await harness();
      const visual = new h.CharacterVisual(KEY, 0xffffff, 0, null, null, null, null, CROWD);
      const body = mesh(visual.root, 'Character_Body');
      const gates: Gate[] = [];
      visual.setFarBakeGate((target, settle) => {
        const twin = target.children[0] as THREE.Mesh | undefined;
        gates.push({ target, settle, asked: twin?.material ? single(twin.material) : null });
        if (target.name === SCRATCH && refuse(asks().length)) throw new Error('lane shut down');
      });
      const asks = () => gates.filter(({ target }) => target.name === SCRATCH);
      visual.setWocEquipment({ chest: 'some-chest' }, false);
      await vi.waitFor(() => expect(asks()).toHaveLength(1));
      const frame = () => visual.update(1 / 60, IDLE, true);
      return { visual, body, asks, frame, nextFrame: h.nextFrame };
    }

    it('asks the gate for the program the live body draws: the twin wears its tint wrap', async () => {
      const h = await gatedSwap();
      // this module world's layer registry (the harness resets modules)
      const { wocHeadTintOf } = await import('../src/render/characters/woc_head_tint');
      const twin = h.asks()[0].target.children[0] as THREE.SkinnedMesh;
      const staged = single(twin.material);
      const live = single(h.body.material);
      // wrapped BEFORE the gate was asked: a gate that compiles inside the ask links this one
      expect(h.asks()[0].asked).toBe(staged);
      // the body's own layer (its skin paint keys on the suit atlas), as on the live mesh
      expect(wocHeadTintOf(live)?.surface).toBe('suit');
      expect(wocHeadTintOf(staged)?.surface).toBe('suit');
      expect(wocHeadTintOf(staged)?.role).toBe('skin');
      // three's own program key for the draw: the twin's is the live body's
      const liveKey = threeProgramKeys(live, h.body);
      expect(staged.customProgramCacheKey()).toBe(live.customProgramCacheKey());
      expect(threeProgramKeys(staged, twin)).toBe(liveKey);
      // ...and it is another material, on the new atlas, on the body's own mesh kind
      expect(staged).not.toBe(live);
      expect(mapNames(twin)).toEqual([ATLAS]);
      expect(twin.isSkinnedMesh).toBe(true);
      expect(twin.skeleton).toBe((h.body as THREE.SkinnedMesh).skeleton);
      // the swap mounts the very material the gate prepared: nothing left to link or upload
      h.asks()[0].settle();
      h.frame();
      expect(single(h.body.material)).toBe(staged);
      expect(threeProgramKeys(single(h.body.material), h.body)).toBe(liveKey);
      // under the under-armor atlas the layer is off, by its strength uniform alone
      expect(wocHeadTintOf(staged)?.mix.value).toBe(0);
      h.visual.dispose();
    });

    it('takes the swap on the next update, never inside the gate callback', async () => {
      const h = await gatedSwap();
      const [ask] = h.asks();
      ask.settle();
      // the settle only records: the body still draws its suit, the twin still holds its claims
      expect(mapNames(h.body)).toEqual(['embedded']);
      expect(ask.target.parent).not.toBeNull();
      h.frame();
      expect(mapNames(h.body)).toEqual([ATLAS]);
      expect(ask.target.parent).toBeNull();
      // one swap, one ask: a later frame has nothing more to take
      h.frame();
      expect(h.asks()).toHaveLength(1);
      expect(mapNames(h.body)).toEqual([ATLAS]);
      h.visual.dispose();
    });

    it('takes the swap on an off-screen body too, on its own per-frame path', async () => {
      const h = await gatedSwap();
      const [ask] = h.asks();
      ask.settle();
      expect(mapNames(h.body)).toEqual(['embedded']);
      // a body outside the frustum is advanced, never updated: its swap must not wait for
      // the frame it comes back into view (a crowd dressed behind the camera would all swap
      // on that one frame)
      h.visual.advanceOffscreen(1 / 60);
      expect(mapNames(h.body)).toEqual([ATLAS]);
      expect(ask.target.parent).toBeNull();
      h.visual.dispose();
    });

    it('keeps the current atlas on a settle that could not vouch, and asks again', async () => {
      const h = await gatedSwap();
      const [first] = h.asks();
      first.settle(() => false);
      h.frame();
      // not committed: the suit keeps drawing, and the same twin is asked a second time
      expect(mapNames(h.body)).toEqual(['embedded']);
      expect(h.asks()).toHaveLength(2);
      expect(h.asks()[1].target).toBe(first.target);
      expect(first.target.parent).not.toBeNull();
      // idle frames ask nothing more while that link is out
      h.frame();
      h.frame();
      expect(h.asks()).toHaveLength(2);
      // the second link is vouched for: the swap is taken
      h.asks()[1].settle(() => true);
      expect(mapNames(h.body)).toEqual(['embedded']);
      h.frame();
      expect(mapNames(h.body)).toEqual([ATLAS]);
      expect(first.target.parent).toBeNull();
      h.visual.dispose();
    });

    it('asks twice more at most, then takes the swap all the same', async () => {
      const h = await gatedSwap();
      for (const round of [0, 1]) {
        h.asks()[round].settle(() => false);
        h.frame();
        expect(mapNames(h.body), `after unprepared settle ${round + 1}`).toEqual(['embedded']);
        expect(h.asks()).toHaveLength(round + 2);
      }
      // a gate that keeps giving up must not keep a body in the wrong cloth for good
      h.asks()[2].settle(() => false);
      h.frame();
      expect(mapNames(h.body)).toEqual([ATLAS]);
      expect(h.asks()).toHaveLength(3);
      expect(h.asks()[0].target.parent).toBeNull();
      // the count is per swap: the next one starts with its two re-asks
      h.visual.setWocEquipment({}, false);
      await vi.waitFor(() => expect(h.asks()).toHaveLength(4));
      h.asks()[3].settle(() => false);
      h.frame();
      expect(mapNames(h.body)).toEqual([ATLAS]);
      expect(h.asks()).toHaveLength(5);
      h.visual.dispose();
    });

    it('forgets a settle the next request superseded: the new twin waits for its own answer', async () => {
      const h = await gatedSwap();
      const [first] = h.asks();
      // vouched for and recorded, not yet taken...
      first.settle();
      // ...when the chest comes off and goes back on before a frame: the first twin is
      // dropped, and the atlas (resident by now) is staged again at once
      h.visual.setWocEquipment({}, false);
      expect(first.target.parent).toBeNull();
      h.visual.setWocEquipment({ chest: 'some-chest' }, false);
      expect(h.asks()).toHaveLength(2);
      const second = h.asks()[1];
      expect(second.target).not.toBe(first.target);
      // the recorded answer was for the dropped twin: nothing is taken on its strength
      h.frame();
      expect(mapNames(h.body)).toEqual(['embedded']);
      expect(second.target.parent).not.toBeNull();
      second.settle();
      h.frame();
      expect(mapNames(h.body)).toEqual([ATLAS]);
      h.visual.dispose();
    });

    it('backs off like any refused gate when a repeated ask is refused', async () => {
      // the second ask (the first re-ask) throws: a lane shut down under a graphics rebuild
      const h = await gatedSwap((ask) => ask === 2);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const [first] = h.asks();
      first.settle(() => false);
      h.frame();
      expect(h.asks()).toHaveLength(2);
      // dropped, the current atlas still drawing, and nothing asked again on idle frames
      expect(first.target.parent).toBeNull();
      expect(mapNames(h.body)).toEqual(['embedded']);
      expect(warn).toHaveBeenCalled();
      h.frame();
      h.visual.setWocEquipment({ chest: 'some-chest' }, false);
      expect(h.asks()).toHaveLength(2);
      // past the backoff, the unchanged equipment sync stages it afresh, with its re-asks
      h.nextFrame(2000);
      h.visual.setWocEquipment({ chest: 'some-chest' }, false);
      expect(h.asks()).toHaveLength(3);
      expect(h.asks()[2].target).not.toBe(first.target);
      h.asks()[2].settle();
      h.frame();
      expect(mapNames(h.body)).toEqual([ATLAS]);
      h.visual.dispose();
    });

    it('hears only the ask that is out: a second settle of a repeated ask commits nothing', async () => {
      const h = await gatedSwap();
      const [first] = h.asks();
      first.settle(() => false);
      h.frame();
      expect(h.asks()).toHaveLength(2);
      // the first ask settling again, vouching this time, is not the answer to the second
      first.settle(() => true);
      h.frame();
      expect(mapNames(h.body)).toEqual(['embedded']);
      expect(h.asks()).toHaveLength(2);
      h.asks()[1].settle();
      h.frame();
      expect(mapNames(h.body)).toEqual([ATLAS]);
      h.visual.dispose();
    });
  });

  it('keeps live geometry claimed while bounded idle geometry is evicted', async () => {
    await harness();
    const { VISUALS } = await import('../src/render/characters/manifest');
    const { retainWocFarBake } = await import('../src/render/characters/woc_far_bake');
    const parts = new Set(['Character_Body', 'Hair']);
    const live = retainWocFarBake(KEY, parts)!;
    const peer = retainWocFarBake(KEY, parts)!;
    expect(peer.bake.geo).toBe(live.bake.geo);
    const liveDispose = vi.spyOn(live.bake.geo, 'dispose');
    const first = retainWocFarBake(KEY, new Set(['Character_Body']))!;
    const idleDispose = vi.spyOn(first.bake.geo, 'dispose');
    first.release();
    // Aliases use the same loaded GLB but distinct visual keys, as the real
    // class/gender keys do; no fake cache or disposal implementation involved.
    for (let i = 0; i < 36; i++) {
      const key = `woc-cache-fixture-${i}`;
      VISUALS[key] = { ...VISUALS[KEY] };
      const lease = retainWocFarBake(key, parts)!;
      lease.release();
    }
    expect(idleDispose).toHaveBeenCalledOnce();
    live.release();
    live.release(); // lease release is idempotent
    expect(liveDispose).not.toHaveBeenCalled();
    const reclaimed = retainWocFarBake(KEY, parts)!;
    expect(reclaimed.bake.geo).toBe(peer.bake.geo);
    reclaimed.release();
    peer.release();
  });

  it('lets an idle far bake go of its armor file, and drops it once that file is freed', async () => {
    await harness();
    const packs = await import('../src/render/characters/woc_armor_packs');
    const { currentWocArmorTier } = await import('../src/render/characters/woc_armor_dressing');
    const { wocArmorPackUrl } = await import('../src/render/characters/woc_armor_core');
    const { peekWocFarBake, retainWocFarBake } = await import(
      '../src/render/characters/woc_far_bake'
    );
    // a file of a tier this preset draws for nobody, so that it IS freed once idle (the tier a
    // crowd draws stays in memory on a desktop: woc_armor_core.ts wocArmorIdleEvictMs)
    const tier = currentWocArmorTier('crowd') === 'low' ? 'medium' : 'low';
    const url = wocArmorPackUrl('male', 'fixture', tier);
    packs.ensureWocArmorPack(url);
    await vi.waitFor(() => expect(packs.wocArmorPackResident(url)).toBe(true));
    const files = [{ set: 'fixture', url }];
    const parts = new Set(['Character_Body', 'Chest']);
    const lease = retainWocFarBake(KEY, parts, files);
    if (!lease) throw new Error('no bake');
    expect(packs.wocArmorPackRefs(url)).toBe(1); // live: its materials are that file's
    lease.release();
    expect(packs.wocArmorPackRefs(url)).toBe(0); // idle: pins nothing
    expect(peekWocFarBake(KEY, parts, files)).toBe(lease.bake); // reusable while resident
    const again = retainWocFarBake(KEY, parts, files);
    expect(again?.bake).toBe(lease.bake);
    expect(packs.wocArmorPackRefs(url)).toBe(1);
    again?.release();
    // past the idle window the pack is freed; the idle bake drew its materials, so it goes too
    packs.setWocArmorClockForTest(() => 1e12);
    packs.sweepWocArmorPacks();
    expect(packs.wocArmorPackResident(url)).toBe(false);
    expect(peekWocFarBake(KEY, parts, files)).toBeNull();
    packs.setWocArmorClockForTest(null);
  });

  it('dresses a body nobody dresses (a mob on a WOC body) on its first frame, far band too', async () => {
    const { CharacterVisual } = await harness();
    type Dressable = { wocFarParts: ReadonlySet<string> | null };
    const mob = new CharacterVisual(KEY, 0xffffff, 0, null, null, null, null, CROWD);
    // the assembly shows the default kit up close, but nothing has dressed the far band yet
    expect((mob as unknown as Dressable).wocFarParts).toBeNull();
    mob.update(0.016, IDLE, true);
    const far = (mob as unknown as Dressable).wocFarParts;
    expect(far?.has('Chest')).toBe(true);
    expect(mesh(mob.root, 'Chest').visible).toBe(true);
    mob.dispose();
    // a player is dressed by the renderer's worn-set diff first, and stays as dressed
    const player = new CharacterVisual(KEY, 0xffffff, 0, null, null, null, null, CROWD);
    player.setWocEquipment({}, false);
    player.update(0.016, IDLE, true);
    expect(mesh(player.root, 'Chest').visible).toBe(false);
    expect((player as unknown as Dressable).wocFarParts?.has('Chest')).toBe(false);
    player.dispose();
  });

  it('uses the default kit for roster previews and restores it after live equipment', async () => {
    const { CharacterVisual } = await harness();
    const visual = new CharacterVisual(KEY, 0xffffff, 0, null, null, null, null, CROWD);
    visual.setWocEquipment({}, false);
    expect(mesh(visual.root, 'Chest').visible).toBe(false);
    visual.setWocDefaultEquipment(true);
    expect(mesh(visual.root, 'Chest').visible).toBe(true);
    expect(mesh(visual.root, 'Helm').visible).toBe(false);
    expect(mesh(visual.root, 'Hair').visible).toBe(true);
    expect(visual.setWocDefaultEquipment(true)).toBe(false);
    visual.setWocDefaultEquipment(false);
    expect(mesh(visual.root, 'Helm').visible).toBe(true);
    expect(mesh(visual.root, 'Hair').visible).toBe(false);
    visual.setWocEquipment({}, false);
    expect(mesh(visual.root, 'Chest').visible).toBe(false);
    visual.dispose();
  });

  it('retries a rejected body atlas with backoff while repeated equipment preserves the current body', async () => {
    const { CharacterVisual, nextFrame } = await harness();
    const loader = await import('../src/render/assets/loader');
    const load = vi.mocked(loader.loadKtx2Texture);
    load.mockRejectedValueOnce(new Error('temporary atlas failure'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const visual = new CharacterVisual(KEY, 0xffffff, 0, null, null, null, null, CROWD);
    const equipped = { chest: 'some-chest' };
    visual.setWocEquipment(equipped, false);
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(mapNames(mesh(visual.root, 'Character_Body'))).toEqual(['embedded']);
    const calls = load.mock.calls.length;
    visual.setWocEquipment(equipped, false);
    expect(load).toHaveBeenCalledTimes(calls);
    nextFrame(2000);
    visual.setWocEquipment(equipped, false);
    await vi.waitFor(() => expect(mapNames(mesh(visual.root, 'Character_Body'))).toEqual([ATLAS]));
    expect(load).toHaveBeenCalledTimes(calls + 1);
    visual.dispose();
  });

  it('retries a rejected atlas compile gate without dropping the linked body material', async () => {
    const { CharacterVisual, nextFrame } = await harness();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const visual = new CharacterVisual(KEY, 0xffffff, 0, null, null, null, null, CROWD);
    const targets: THREE.Object3D[] = [];
    visual.setFarBakeGate((target, settle) => {
      targets.push(target);
      if (targets.length === 1) throw new Error('temporary compile rejection');
      settle();
    });
    const equipped = { chest: 'some-chest' };
    visual.setWocEquipment(equipped, false);
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(targets).toHaveLength(1);
    expect(targets[0].parent).toBeNull();
    expect(mapNames(mesh(visual.root, 'Character_Body'))).toEqual(['embedded']);
    visual.setWocEquipment(equipped, false);
    expect(targets).toHaveLength(1);
    nextFrame(2000);
    visual.setWocEquipment(equipped, false);
    expect(targets).toHaveLength(2);
    // settled inside the gate call itself: still nothing swaps before the per-frame path
    expect(mapNames(mesh(visual.root, 'Character_Body'))).toEqual(['embedded']);
    visual.update(1 / 60, IDLE, true);
    expect(targets[1].parent).toBeNull();
    expect(mapNames(mesh(visual.root, 'Character_Body'))).toEqual([ATLAS]);
    visual.dispose();
  });

  it('prepares a late preview atlas in its own lit context before committing to an open rig', async () => {
    const h = await previewHarness();
    const body = mesh(h.group, 'Character_Body');
    h.preview.setWocEquipment({ chest: 'some-chest' }, false);
    h.preview.armOpen();
    h.compiles[0].finish();
    await flushPreview();
    expect(h.order).toContain('render');
    expect(mapNames(body)).toEqual(['embedded']);
    h.order.length = 0;

    h.finishAtlas();
    await flushPreview();
    expect(mapNames(body)).toEqual(['embedded']);
    expect(h.compiles).toHaveLength(2);
    const pending = h.compiles[1];
    expect(pending.target.name).toBe('character_body_atlas_scratch');
    expect(pending.target.visible).toBe(false);
    expect(pending.scene).toBe(h.scene);
    expect(h.order).toEqual(['compile']);
    pending.finish();
    await flushPreview();
    expect(h.order).toEqual(['compile', `upload:${ATLAS}`, 'uniforms', 'attributes']);
    // warmed and settled: the swap itself is taken on the preview's next frame
    expect(mapNames(body)).toEqual(['embedded']);
    h.frame();
    expect(mapNames(body)).toEqual([ATLAS]);
    expect(pending.target.parent).toBeNull();
    h.preview.destroy();
  });

  // A warm the preview context REJECTS (preview_material_gate.ts): the atlas already
  // prepared keeps drawing, and the cold one is never committed merely because its compile
  // or upload failed. The gate reports the first failure (not ready), the swap asks once
  // more, and a twin whose warm fails again simply stays behind its stand-in.
  it('retries a preview atlas whose warm was rejected, and takes it once the retry warms', async () => {
    const h = await previewHarness();
    const body = mesh(h.group, 'Character_Body');
    h.preview.setWocEquipment({ chest: 'some-chest' }, false);
    h.finishAtlas();
    await flushPreview();
    expect(h.compiles).toHaveLength(1);
    const pending = h.compiles[0];
    expect(pending.target.name).toBe('character_body_atlas_scratch');
    pending.fail(new Error('context busy'));
    await flushPreview();
    // reported, never committed: nothing was uploaded and the body keeps its suit
    expect(h.order).toEqual(['compile']);
    expect(mapNames(body)).toEqual(['embedded']);
    h.frame();
    expect(mapNames(body)).toEqual(['embedded']);
    // the same hidden twin is warmed a second time
    expect(h.compiles).toHaveLength(2);
    expect(h.compiles[1].target).toBe(pending.target);
    expect(pending.target.parent).not.toBeNull();
    h.compiles[1].finish();
    await flushPreview();
    expect(h.order).toEqual(['compile', 'compile', `upload:${ATLAS}`, 'uniforms', 'attributes']);
    expect(mapNames(body)).toEqual(['embedded']);
    h.frame();
    expect(mapNames(body)).toEqual([ATLAS]);
    expect(pending.target.parent).toBeNull();
    h.preview.destroy();
  });

  it('never commits a cold preview atlas, however often its warm is rejected', async () => {
    const h = await previewHarness();
    const body = mesh(h.group, 'Character_Body');
    h.preview.setWocEquipment({ chest: 'some-chest' }, false);
    h.finishAtlas();
    await flushPreview();
    const pending = h.compiles[0];
    pending.fail(new Error('context busy'));
    await flushPreview();
    h.frame();
    expect(h.compiles).toHaveLength(2);
    h.compiles[1].fail(new Error('still busy'));
    await flushPreview();
    for (let i = 0; i < 6; i++) {
      h.frame();
      await flushPreview();
    }
    // the atlas that was prepared is still the one drawn, nothing cold was uploaded, and
    // the gate is not asked again for a twin it cannot warm
    expect(mapNames(body)).toEqual(['embedded']);
    expect(h.order).toEqual(['compile', 'compile']);
    expect(h.compiles).toHaveLength(2);
    // the twin waits, hidden, until the next pick supersedes it
    expect(pending.target.parent).not.toBeNull();
    expect(pending.target.visible).toBe(false);
    h.preview.setWocEquipment({}, false);
    expect(pending.target.parent).toBeNull();
    expect(mapNames(body)).toEqual(['embedded']);
    h.preview.destroy();
  });

  it.each(['equipment', 'rebuild', 'destroy'] as const)(
    'drops a delayed preview atlas compile after %s supersedes it',
    async (superseding) => {
      const h = await previewHarness();
      const oldBody = mesh(h.group, 'Character_Body');
      h.preview.setWocEquipment({ chest: 'some-chest' }, false);
      h.finishAtlas();
      await flushPreview();
      expect(h.compiles).toHaveLength(1);
      const pending = h.compiles[0];
      if (superseding === 'equipment') h.preview.setWocEquipment({}, false);
      else if (superseding === 'rebuild') h.preview.setVisualKey(KEY, 'test-sword');
      else h.preview.destroy();
      h.order.length = 0;
      pending.finish();
      await flushPreview();
      expect(h.order).toEqual([]);
      expect(mapNames(oldBody)).toEqual(['embedded']);
      expect(pending.target.parent).toBeNull();
      if (superseding !== 'destroy') h.preview.destroy();
    },
  );
});
