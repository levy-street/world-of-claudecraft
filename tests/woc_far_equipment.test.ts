// @vitest-environment happy-dom
// Real CharacterVisual dress/LOD/material paths, with only asset IO stubbed.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WocCharacterManifest } from '../src/render/characters/woc_character_manifest';

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
  // the head core's fetch has failed before any body is built
  const heads = await import('../src/render/characters/woc_head_packs');
  const { wocHeadCoreUrl } = await import('../src/render/characters/woc_head_catalog');
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  heads.ensureWocHeadFile(wocHeadCoreUrl('a'));
  await vi.waitFor(() => expect(heads.wocHeadFileState(wocHeadCoreUrl('a'))).toBe('failed'));
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
  const compiles: { target: THREE.Object3D; scene: THREE.Scene | undefined; finish(): void }[] = [];
  const programs = new Map<THREE.Material, object>();
  const renderer = {
    compileAsync: (target: THREE.Object3D, _camera: THREE.Camera, scene?: THREE.Scene) => {
      order.push('compile');
      return new Promise<void>((resolve) => compiles.push({ target, scene, finish: resolve }));
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
  return { preview, renderer, order, compiles, scene, group, finishAtlas: () => finishAtlas() };
}

async function flushPreview(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('../src/render/assets/loader');
});

describe('WOC equipment follows the character into the far and shadow bands', () => {
  it('prepares the selected shadow silhouette before ever crossing into far LOD', async () => {
    const { CharacterVisual } = await harness();
    const visual = new CharacterVisual(KEY, 0xffffff, 0, null, null, null, null, CROWD);
    const gates: (() => void)[] = [];
    visual.setFarBakeGate((_target, settle) => gates.push(settle));
    visual.setWocEquipment({}, false);
    visual.setProxyShadow(true);
    expect(gates).toHaveLength(1);
    expect(vertices(visual.root, 'character_shadow_proxy')).toBe(24);
    expect(mesh(visual.root, 'character_shadow_proxy').visible).toBe(false);
    gates[0]();
    visual.setProxyShadow(true);
    expect(mesh(visual.root, 'character_shadow_proxy').visible).toBe(true);
    expect(mesh(visual.root, 'character_far_mesh').visible).toBe(false);
    expect(visual.root.getObjectByName('character_model_wrap')?.visible).toBe(true);
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
    expect(mapNames(body)).toEqual([ATLAS]);
    expect(pending.target.parent).toBeNull();
    visual.setWocEquipment({}, false);
    const removing = gates[gates.length - 1];
    visual.setWocEquipment({ chest: 'some-chest' }, false);
    removing.settle();
    expect(mapNames(body)).toEqual([ATLAS]);
    visual.setWocEquipment({}, false);
    const disposed = gates[gates.length - 1];
    visual.dispose();
    disposed.settle();
    expect(disposed.target.parent).toBeNull();
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
    // the full-detail pack: an assembled high pack is held and let go like a file
    const url = wocArmorPackUrl('male', 'fixture', currentWocArmorTier());
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
    expect(mapNames(body)).toEqual([ATLAS]);
    expect(pending.target.parent).toBeNull();
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
