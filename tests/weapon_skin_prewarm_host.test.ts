// @vitest-environment happy-dom
// The `vfx.weapon-skins` boot entry warms one never-disposed host per catalog
// skin, and a host is only worth its compile if it links the program the LIVE
// weapon draws. The live side here is the real game chain, not a fixture: each
// shipped skin GLB is parsed by three's GLTFLoader (only the image decode is
// stubbed, Node has no codec) and worn by a real CharacterVisual through
// setWeapon, setWeaponSkin and setWeaponStowed, so applyMaterials
// (buildTintedClone per tier), the hook-preserving isolation clone and
// createWeaponVfx all run as in the world. The fixture this replaced (a
// Standard, FrontSide material with no normal map) could not see that Low
// draws a Lambert, that every skin carries normal and occlusion maps, or that
// some skins are double-sided, so it passed while the host warmed a key no
// live weapon asked for.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const loaderState = vi.hoisted(() => ({
  parse: null as null | ((url: string) => Promise<unknown>),
}));

vi.mock('../src/render/assets/loader', async () => {
  const three = await import('three');
  // Every non-weapon GLB is a bare rig carrying the bones the attach paths
  // resolve: both handslots and the sheathe bone.
  const rig = () => {
    const scene = new three.Group();
    const body = new three.Mesh(new three.BoxGeometry(1, 2, 1), new three.MeshStandardMaterial());
    body.name = 'body';
    scene.add(body);
    for (const name of ['chest', 'handslotr', 'handslotl']) {
      const bone = new three.Object3D();
      bone.name = name;
      scene.add(bone);
    }
    return { scene, animations: [new three.AnimationClip('Idle', 1, [])] };
  };
  return {
    loadGltf: vi.fn((url: string) =>
      loaderState.parse && /^models\/weapons\//.test(url)
        ? loaderState.parse(url)
        : Promise.resolve(rig()),
    ),
    loadHdr: vi.fn(() => new Promise(() => undefined)),
    loadTexture: vi.fn(() => Promise.resolve(new three.Texture())),
    loadKtx2Texture: vi.fn(() => Promise.resolve(new three.Texture())),
    releaseGltf: vi.fn(),
  };
});

vi.mock('../src/render/assets/preload', () => ({
  registerPreload: vi.fn(),
  registerDeferredPreload: vi.fn((start: () => unknown) => start()),
}));

import { neutralizeGltfTransmission } from '../src/render/assets/transmission_neutralize';
import {
  charactersReady,
  ensureCharacterUrl,
  onCharacterAssetReady,
  resetCharacterProfileCaches,
} from '../src/render/characters/assets';
import { weaponSkinModelUrl } from '../src/render/characters/manifest';
import { CharacterVisual } from '../src/render/characters/visual';
import {
  addRimGlow,
  GFX,
  type GfxSettings,
  type GfxTier,
  gfxInternalsForTest,
  resolveGfxProfile,
} from '../src/render/gfx';
import { materialProgramSignature, prewarmProgramContentKeys } from '../src/render/prewarm_policy';
import {
  buildWeaponVfxPrewarmSkinGroup,
  clearWeaponVfxTextureCacheForTest,
  createWeaponVfx,
  disposeWeaponEmissiveCache,
  disposeWeaponVfxPrewarmSkinGroup,
  WEAPON_VFX,
  WEAPON_VFX_DOUBLE_SIDED_SKINS,
  WEAPON_VFX_UNTEXTURED_PARTS,
} from '../src/render/weapon_vfx';
import {
  createWeaponVfxPrewarmSkinStage,
  weaponVfxPrewarmUnits,
} from '../src/render/weapon_vfx_prewarm';
import {
  prepareSurfaceDetailProfileAssets,
  resetSurfaceDetailProfileCaches,
} from '../src/render/worn_stone';
import { WEAPON_TYPE_BY_ITEM } from '../src/sim/content/weapon_skin_rules';
import { WEAPON_SKINS } from '../src/sim/content/weapon_skins';

/** An iPhone session forced to ultra, resolved the way the client resolves
 *  one: the platform alone turns the iOS memory profile on. */
const IOS_ULTRA = resolveGfxProfile(
  {
    deviceMemory: 8,
    hardwareConcurrency: 6,
    maxTouchPoints: 5,
    coarsePointer: true,
    narrowViewport: true,
    gpuRenderer: 'Apple GPU',
    nativeApp: false,
    tightMemory: false,
    platform: 'ios',
    softwareRendering: false,
  },
  {
    graphicsPreset: 4,
    terrainDetail: 1,
    foliageDensity: 1,
    surfaceDetail: 1,
    effectsQuality: 1,
    shadowQuality: 1,
    antiAliasing: 1,
    bloomQuality: 1,
    ambientOcclusion: 1,
    viewDistance: 1,
    waterQuality: 1,
    characterDetail: 1,
    dynamicLights: 1,
    particleEffects: 1,
    ghostFade: 1,
  },
  '?gfx=ultra',
).settings;

/** Every preset, plus the knobs that move a key input off its preset: the
 *  constrained-memory profile, the surface-detail dial turned off, and the iOS
 *  memory profile. The last column says whether the ring wears the worn layer. */
const PROFILES: readonly [string, GfxTier, Partial<GfxSettings>, boolean][] = [
  ['low', 'low', {}, false],
  ['medium', 'medium', {}, false],
  ['high', 'high', {}, true],
  ['ultra', 'ultra', {}, true],
  ['insane', 'insane', {}, true],
  ['ultra, constrained memory', 'ultra', { constrainedMemory: true }, true],
  ['ultra, surface detail off', 'ultra', { surfaceDetail: false, surfaceDetailTaps: 0 }, false],
  ['ultra, iOS memory profile', 'ultra', IOS_ULTRA, false],
];

/** The worn metal layer's key head, as worn_stone.ts spells it with the family
 *  textures resident: ready, no parallax, no cell mask, metalness, no AO, and
 *  the object-space projection. */
const WORN_METAL_KEY_HEAD = 'surface-detail|on|-|-|met|-|o|';

/** The skin id that displays a VFX model (WEAPON_VFX is keyed by model). */
function skinIdFor(model: string): string | null {
  return Object.entries(WEAPON_SKINS).find(([, def]) => def.model === model)?.[0] ?? null;
}

/** The VFX models a worn skin can put in a hand. */
const WORN_KEYS = Object.keys(WEAPON_VFX).filter((key) => skinIdFor(key) !== null);

/** A mainhand item of the skin's type, so mainhandShowsWeaponSkin dresses it
 *  (a bow or crossbow skin dresses any swap slot). */
function mainhandFor(skinId: string): string {
  const type = WEAPON_SKINS[skinId].weaponType;
  const wanted = type === 'bow' || type === 'crossbow' ? 'sword' : type;
  const item = Object.entries(WEAPON_TYPE_BY_ITEM).find(([, t]) => t === wanted)?.[0];
  if (!item) throw new Error(`no item of type ${wanted}`);
  return item;
}

function stubContext() {
  const gradient = { addColorStop: () => {} };
  return {
    fillStyle: '',
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    fillRect: () => {},
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    drawImage: () => {},
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4).fill(200),
      width: w,
      height: h,
    }),
    putImageData: () => {},
  };
}

/** A drawable 4x4 stand-in for a decoded GLB image, so deriveEmissive takes
 *  the textured arm it takes on a real skin map. */
function stubImageTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 4;
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  return texture;
}

const glbBytes = new Map<string, Buffer>();

function shippedGlb(url: string): Buffer {
  let bytes = glbBytes.get(url);
  if (!bytes) {
    bytes = readFileSync(`public/${url}`);
    glbBytes.set(url, bytes);
  }
  return bytes;
}

async function parseShippedGlb(url: string): Promise<unknown> {
  const file = shippedGlb(url);
  const loader = new GLTFLoader();
  loader.register((parser) => {
    parser.loadTextureImage = () => Promise.resolve(stubImageTexture());
    return { name: 'test_stub_image_decode' };
  });
  const gltf = await loader.parseAsync(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
    '',
  );
  neutralizeGltfTransmission(gltf);
  return gltf;
}

interface GlbMaterialJson {
  name?: string;
  doubleSided?: boolean;
  alphaMode?: string;
  normalTexture?: unknown;
  occlusionTexture?: unknown;
  emissiveTexture?: unknown;
  extensions?: Record<string, unknown>;
  pbrMetallicRoughness?: { baseColorTexture?: unknown; metallicRoughnessTexture?: unknown };
}

interface GlbJson {
  materials?: GlbMaterialJson[];
  meshes?: { primitives: { attributes: Record<string, number> }[] }[];
  images?: { mimeType?: string; uri?: string }[];
  extensionsUsed?: string[];
}

function glbJson(url: string): GlbJson {
  const bytes = shippedGlb(url);
  const length = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'));
}

let restoreCanvas: (() => void) | null = null;

beforeAll(async () => {
  const proto = HTMLCanvasElement.prototype as unknown as { getContext: () => unknown };
  const original = proto.getContext;
  proto.getContext = () => stubContext();
  restoreCanvas = () => {
    proto.getContext = original;
  };
  loaderState.parse = parseShippedGlb;
  // A session on high and up enters the world with the worn family textures
  // resident (the boot lane prepares them before the Renderer is built), and
  // the worn key reads that residency. The import-time tier guess here
  // prepares none, so prepare them as that boot does.
  await prepareSurfaceDetailProfileAssets(gfxInternalsForTest.settingsFor('insane'));
  await charactersReady();
  const urls = WORN_KEYS.map((key) => weaponSkinModelUrl(skinIdFor(key)) as string);
  const arrived = new Set<string>();
  const stop = onCharacterAssetReady((url) => arrived.add(url));
  for (const url of urls) ensureCharacterUrl(url);
  await vi.waitFor(() => expect(arrived.size).toBe(urls.length), { timeout: 20_000 });
  stop();
});

afterAll(() => {
  restoreCanvas?.();
});

/** Every input three keys a mesh's program on that the scene does not own:
 *  the material signature, the mesh and geometry bits, the extra UV sets, and
 *  the per-slot UV channel and normal-map space, which the signature folds to
 *  presence. */
function drawKeys(root: THREE.Object3D, include: (mesh: THREE.Mesh) => boolean): Set<string> {
  const keys = new Set<string>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !include(mesh)) return;
    const geometry = mesh.geometry;
    const shape = {
      isSkinnedMesh: (mesh as THREE.SkinnedMesh).isSkinnedMesh === true,
      hasTangents: !!geometry.attributes.tangent,
      hasNormals: !!geometry.attributes.normal,
      vertexColorItemSize: geometry.attributes.color?.itemSize ?? 0,
    };
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const std = material as THREE.MeshStandardMaterial;
      const channels = (['map', 'normalMap', 'aoMap', 'emissiveMap'] as const)
        .map((slot) => `${slot}:${std[slot] ? std[slot].channel : '-'}`)
        .join(',');
      const extraUvs = (['uv1', 'uv2', 'uv3'] as const)
        .map((name) => `${name}:${geometry.attributes[name] ? 1 : 0}`)
        .join(',');
      const [key] = prewarmProgramContentKeys(shape, [materialProgramSignature(material)]);
      keys.add(
        `${key}|${channels}|${extraUvs}|nmt:${std.normalMap ? std.normalMapType : '-'}|rs:${mesh.receiveShadow}`,
      );
    }
  });
  return keys;
}

/** A short, stable name for a key in failure output (the full key carries the
 *  hook sources). */
function tag(key: string): string {
  return `${key.split('|')[0]}#${createHash('sha1').update(key).digest('hex').slice(0, 8)}`;
}

const isLiveSkinWeapon = (mesh: THREE.Mesh) => mesh.userData.weaponSkinIsolated === true;
const isHostSurface = (mesh: THREE.Mesh) =>
  mesh.name.startsWith('prewarm-skin-host:') && !mesh.userData.__vfx;

function onChestBone(mesh: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = mesh; node; node = node.parent) {
    if (node.name === 'chest') return true;
  }
  return false;
}

async function withTier(
  tier: GfxTier,
  run: () => void | Promise<void>,
  overrides: Partial<GfxSettings> = {},
): Promise<void> {
  const restore = gfxInternalsForTest.overrideSettings({
    ...gfxInternalsForTest.settingsFor(tier),
    ...overrides,
  });
  resetCharacterProfileCaches();
  resetSurfaceDetailProfileCaches();
  clearWeaponVfxTextureCacheForTest();
  disposeWeaponEmissiveCache();
  try {
    await run();
  } finally {
    restore();
  }
}

/** The host this lot replaced, built the way the release built it: a Standard
 *  material with only the one-pixel map, FrontSide, rim on the standard tiers. */
function releaseHostKeys(key: string): Set<string> {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, map: stubImageTexture() });
  if (GFX.standardMaterials) addRimGlow(material);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.1), material);
  const rig = createWeaponVfx(mesh, WEAPON_VFX[key], { grounded: false });
  const keys = drawKeys(mesh, (m) => !m.userData.__vfx);
  rig.dispose();
  return keys;
}

describe('the weapon-skin prewarm host warms the program the live weapon draws', () => {
  it('pins which catalog specs a worn skin reaches', () => {
    // A spec no skin wears still gets a host (the catalog plan is per spec),
    // but the parity arm below can only dress the reachable ones.
    expect(Object.keys(WEAPON_VFX).filter((key) => skinIdFor(key) === null)).toEqual([
      'rude_awakening_sword',
    ]);
    expect(WORN_KEYS).toHaveLength(22);
  });

  it('reads the host shape table off every shipped skin GLB', () => {
    for (const key of Object.keys(WEAPON_VFX)) {
      const json = glbJson(`models/weapons/${key}.glb`);
      const materials = json.materials ?? [];
      // Decoded to RGBA like the one-pixel host map: a GPU-compressed normal
      // (KTX2, an RG format) would flip three's packedNormalMap bit live only.
      expect(json.extensionsUsed ?? [], key).not.toContain('KHR_texture_basisu');
      for (const image of json.images ?? []) {
        expect(['image/webp', 'image/png', 'image/jpeg'], key).toContain(image.mimeType);
      }
      // No tangents, vertex colours, skin weights or extra UV sets: the host
      // box carries none of them either.
      const primitives = (json.meshes ?? []).flatMap((mesh) => mesh.primitives);
      expect(primitives.length, key).toBeGreaterThan(0);
      for (const primitive of primitives) {
        for (const attribute of Object.keys(primitive.attributes)) {
          expect(['POSITION', 'NORMAL', 'TEXCOORD_0'], `${key}:${attribute}`).toContain(attribute);
        }
      }
      const textured = materials.filter((m) => m.pbrMetallicRoughness?.baseColorTexture);
      const untextured = materials.filter((m) => !m.pbrMetallicRoughness?.baseColorTexture);
      // The textured host carries exactly these slots, opaque, no extension.
      expect(textured, key).toHaveLength(1);
      const [main] = textured;
      expect(main.alphaMode ?? 'OPAQUE', key).toBe('OPAQUE');
      expect(!!main.pbrMetallicRoughness?.metallicRoughnessTexture, key).toBe(true);
      expect(!!main.normalTexture, key).toBe(true);
      expect(!!main.occlusionTexture, key).toBe(true);
      expect(!!main.emissiveTexture, key).toBe(false);
      expect(Object.keys(main.extensions ?? {}), key).toEqual([]);
      expect(WEAPON_VFX_DOUBLE_SIDED_SKINS.has(key), key).toBe(main.doubleSided === true);
      // An untextured part: single-sided, opaque, no texture slot at all.
      for (const part of untextured) {
        expect(part.doubleSided ?? false, `${key}:${part.name}`).toBe(false);
        expect(part.alphaMode ?? 'OPAQUE', `${key}:${part.name}`).toBe('OPAQUE');
        expect(
          [part.normalTexture, part.occlusionTexture, part.emissiveTexture].some(Boolean),
          `${key}:${part.name}`,
        ).toBe(false);
      }
      expect(WEAPON_VFX_UNTEXTURED_PARTS[key] ?? [], key).toEqual(untextured.map((m) => m.name));
    }
    expect([...WEAPON_VFX_DOUBLE_SIDED_SKINS].every((key) => key in WEAPON_VFX)).toBe(true);
    expect(Object.keys(WEAPON_VFX_UNTEXTURED_PARTS)).toEqual(['astravyr_fang_of_the_fallen_star']);
  });

  it.each(PROFILES)(
    'hosts every live skin weapon, drawn and sheathed, and nothing else, on %s',
    async (_label, tier, overrides, worn) => {
      await withTier(
        tier,
        () => {
          const misses: string[] = [];
          const liveUnion = new Set<string>();
          const hostUnion = new Set<string>();
          const releaseHits: string[] = [];
          const ringKeys = new Set<string>();
          for (const key of Object.keys(WEAPON_VFX)) {
            for (const hostKey of drawKeys(buildWeaponVfxPrewarmSkinGroup(key), isHostSurface)) {
              hostUnion.add(hostKey);
            }
          }
          for (const key of WORN_KEYS) {
            const skinId = skinIdFor(key) as string;
            const hostGroup = buildWeaponVfxPrewarmSkinGroup(key);
            const hostKeys = drawKeys(hostGroup, isHostSurface);
            // Every host material is labelled as the host, so a program label in
            // a capture tells it from the live weapon it stands in for.
            hostGroup.traverse((o) => {
              const mesh = o as THREE.Mesh;
              if (mesh.isMesh && isHostSurface(mesh)) {
                expect((mesh.material as THREE.Material).name, key).toMatch(
                  /^weapon-vfx-prewarm-host:/,
                );
              }
            });
            const released = releaseHostKeys(key);
            const visual = new CharacterVisual('player_warrior', 0xffffff, 0, mainhandFor(skinId));
            visual.setWeaponSkin(skinId);
            for (const stowed of [false, true, false, true]) {
              visual.setWeaponStowed(stowed);
              const meshes: THREE.Mesh[] = [];
              visual.root.traverse((o) => {
                if ((o as THREE.Mesh).isMesh && isLiveSkinWeapon(o as THREE.Mesh))
                  meshes.push(o as THREE.Mesh);
              });
              // The skin really is worn, and really moved between the poses.
              expect(meshes.length, `${key} stowed=${stowed}`).toBeGreaterThan(0);
              for (const mesh of meshes) {
                expect(onChestBone(mesh), key).toBe(stowed);
                // The ring is the one skin part without UVs.
                if (!mesh.geometry.attributes.uv) {
                  ringKeys.add((mesh.material as THREE.Material).customProgramCacheKey());
                }
              }
              for (const liveKey of drawKeys(visual.root, isLiveSkinWeapon)) {
                liveUnion.add(liveKey);
                // The skin's OWN host holds it, so the shape table is right per
                // skin, not merely somewhere in the catalog.
                if (!hostKeys.has(liveKey)) misses.push(`${key} stowed=${stowed}: ${tag(liveKey)}`);
                if (released.has(liveKey)) releaseHits.push(`${key}: ${tag(liveKey)}`);
              }
            }
            visual.dispose();
          }
          expect(misses).toEqual([]);
          // An absolute pin on the live ring, since the host and the live rig
          // share one worn helper and the parity above cannot see it vanish
          // from both at once.
          expect(ringKeys.size).toBe(1);
          const [ringKey] = ringKeys;
          if (worn) expect(ringKey.startsWith(WORN_METAL_KEY_HEAD), ringKey).toBe(true);
          else expect(ringKey).not.toContain('surface-detail|');
          // The release host never matched a live weapon on any tier, so the
          // comparison above is not trivially true.
          expect(releaseHits).toEqual([]);
          // No dead key: every program the entry warms is one a sighting asks
          // for. Textured single-sided, textured double-sided, and the ring.
          expect([...hostUnion].map(tag).sort()).toEqual([...liveUnion].map(tag).sort());
          expect(hostUnion.size).toBe(3);
        },
        overrides,
      );
    },
  );
});

describe('the weapon-skin prewarm host covers a dual-wielded skin', () => {
  /** The dagger skins: a dagger offhand mirrors the skin onto the second hand. */
  const DAGGER_KEYS = WORN_KEYS.filter(
    (key) => WEAPON_SKINS[skinIdFor(key) as string].weaponType === 'dagger',
  );

  function onBone(mesh: THREE.Object3D, bone: string): boolean {
    for (let node: THREE.Object3D | null = mesh; node; node = node.parent) {
      if (node.name === bone) return true;
    }
    return false;
  }

  it.each(PROFILES)(
    'hosts both hands of every dagger skin on %s',
    async (_label, tier, overrides) => {
      expect(DAGGER_KEYS).toContain('astravyr_fang_of_the_fallen_star');
      await withTier(
        tier,
        () => {
          const misses: string[] = [];
          for (const key of DAGGER_KEYS) {
            const skinId = skinIdFor(key) as string;
            const hostKeys = drawKeys(buildWeaponVfxPrewarmSkinGroup(key), isHostSurface);
            const dagger = mainhandFor(skinId);
            const visual = new CharacterVisual('player_rogue', 0xffffff, 0, dagger, null, dagger);
            visual.setWeaponSkin(skinId);
            for (const stowed of [false, true]) {
              visual.setWeaponStowed(stowed);
              const meshes: THREE.Mesh[] = [];
              visual.root.traverse((o) => {
                if ((o as THREE.Mesh).isMesh && isLiveSkinWeapon(o as THREE.Mesh))
                  meshes.push(o as THREE.Mesh);
              });
              if (!stowed) {
                for (const hand of ['handslotr', 'handslotl']) {
                  expect(
                    meshes.some((mesh) => onBone(mesh, hand)),
                    `${key} ${hand}`,
                  ).toBe(true);
                }
              }
              for (const liveKey of drawKeys(visual.root, isLiveSkinWeapon)) {
                if (!hostKeys.has(liveKey)) misses.push(`${key} stowed=${stowed}: ${tag(liveKey)}`);
              }
            }
            visual.dispose();
          }
          expect(misses).toEqual([]);
        },
        overrides,
      );
    },
  );
});

describe('the weapon-skin prewarm host outlives live skin churn', () => {
  it('is never disposed across the prewarm cleanup, skin changes, stow toggles and a teardown', async () => {
    await withTier('ultra', async () => {
      const scene = new THREE.Scene();
      const stage = createWeaponVfxPrewarmSkinStage(scene);
      const units = weaponVfxPrewarmUnits(stage, {
        prewarmTextures: () => {},
        compile: async () => {},
        publishGroup: () => {},
      });
      for (const unit of units) await unit.run();

      type HostResource = THREE.Material | THREE.BufferGeometry | THREE.Texture;
      const hostResourcesOf = (group: THREE.Group): Set<HostResource> => {
        const resources = new Set<HostResource>();
        group.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh || !isHostSurface(mesh)) return;
          resources.add(mesh.geometry);
          const material = mesh.material as THREE.MeshStandardMaterial;
          resources.add(material);
          for (const texture of [material.map, material.emissiveMap, material.normalMap]) {
            if (texture) resources.add(texture);
          }
        });
        return resources;
      };
      const listenForDisposal = (resources: Iterable<HostResource>, into: string[]): void => {
        for (const resource of resources) {
          resource.addEventListener('dispose', () => into.push(resource.uuid));
        }
      };

      // Positive control: the same listeners do hear a host surface go when
      // its owner really releases it, so the empty list below means something.
      const control = buildWeaponVfxPrewarmSkinGroup('astravyr_fang_of_the_fallen_star');
      const controlDisposals: string[] = [];
      listenForDisposal(hostResourcesOf(control), controlDisposals);
      disposeWeaponVfxPrewarmSkinGroup(control);
      // Both surfaces' geometry and material; the shared one-pixel map stays.
      expect(controlDisposals).toHaveLength(4);

      const hostResources = new Set<HostResource>();
      const hostKeysBefore = new Set<string>();
      for (const key of Object.keys(WEAPON_VFX)) {
        const group = stage.get(key) as THREE.Group;
        for (const hostKey of drawKeys(group, isHostSurface)) hostKeysBefore.add(hostKey);
        for (const resource of hostResourcesOf(group)) hostResources.add(resource);
      }
      const hostDisposals: string[] = [];
      listenForDisposal(hostResources, hostDisposals);
      const hosts = Object.keys(WEAPON_VFX).map((key) => stage.get(key) as THREE.Group);

      // The renderer's prewarm cleanup: the aggregate leaves the scene, the
      // skin groups stay alive.
      stage.dispose();
      expect(scene.children).toHaveLength(0);

      const watched = new Set<THREE.Material>();
      const liveDisposals: THREE.Material[] = [];
      const watchLive = (visual: CharacterVisual) =>
        visual.root.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh || !isLiveSkinWeapon(mesh)) return;
          const material = mesh.material as THREE.Material;
          if (watched.has(material)) return;
          watched.add(material);
          material.addEventListener('dispose', () => liveDisposals.push(material));
        });
      const visual = new CharacterVisual(
        'player_warrior',
        0xffffff,
        0,
        mainhandFor(skinIdFor('frostbite') as string),
      );
      visual.setWeaponSkin(skinIdFor('frostbite'));
      for (const stowed of [true, false, true, false]) {
        watchLive(visual);
        visual.setWeaponStowed(stowed);
      }
      watchLive(visual);
      visual.setWeaponSkin(skinIdFor('ashspark_shiv'));
      watchLive(visual);
      visual.setWeaponStowed(true);
      watchLive(visual);
      visual.setWeaponSkin(null);
      visual.dispose();

      // The live chain really churned: every swap drew a fresh exclusive
      // clone and disposed it exactly once.
      expect(watched.size).toBe(7);
      expect(liveDisposals).toHaveLength(7);
      expect(new Set(liveDisposals)).toEqual(watched);
      expect(hostDisposals).toEqual([]);
      const hostKeysAfter = new Set<string>();
      for (const group of hosts) {
        for (const hostKey of drawKeys(group, isHostSurface)) hostKeysAfter.add(hostKey);
      }
      expect([...hostKeysAfter].sort()).toEqual([...hostKeysBefore].sort());
      expect(hostKeysAfter.size).toBe(3);
    });
  });
});
