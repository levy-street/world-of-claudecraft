import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { BakedImpactLayers } from '../src/render/ability_vfx/baked_impact_layers';
import { CONTACT_SHEETS, type ContactSheet } from '../src/render/ability_vfx/contact_assets';
import { ImpactFlipbooks } from '../src/render/ability_vfx/flipbooks';
import * as assets from '../src/render/ability_vfx/production_assets';

// The contact, smoke and dust sheets land with the Warrior kit's demand load
// and are uploaded by the kit recipe, one paced unit each. A sheet is stored
// as soon as it decodes, so a cast between its decode and its upload unit
// must not bind it: three.js would upload it inside that live frame (on an
// Intel HD 530, 25 to 28 ms for the smoke or dust WebP, 1 to 4 ms for a
// contact KTX2). These pins drive the real pools and read the sampler each
// draw would bind.

const contacts = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../src/render/ability_vfx/contact_assets', async (original) => ({
  ...(await original<typeof import('../src/render/ability_vfx/contact_assets')>()),
  contactTexture: (kind: string) => contacts.get(kind) ?? null,
}));
const procedural = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../src/render/ability_vfx/fx_textures', async () => {
  const three = await import('three');
  return {
    FLIPBOOK_GRID: 8,
    FLIPBOOK_STYLES: ['flame', 'shatter', 'electric', 'void', 'verdant', 'radiance'],
    flipbookSheet: (style: string) => {
      if (!procedural.has(style))
        procedural.set(style, new three.Texture({ width: 512, height: 512 }));
      return procedural.get(style);
    },
    builtFlipbookSheet: (style: string) => procedural.get(style) ?? null,
  };
});

type ImpactMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  contacts.clear();
  procedural.clear();
  vi.restoreAllMocks();
});

function flipbooks(ready?: (texture: THREE.Texture) => boolean) {
  const scene = new THREE.Scene();
  const pool = new ImpactFlipbooks(scene, ready);
  disposers.push(() => pool.dispose());
  for (const kind of CONTACT_SHEETS)
    contacts.set(kind, new THREE.Texture({ width: 1024, height: 1024 }));
  return { pool, meshes: scene.children as ImpactMesh[] };
}

function uploadedShatter(uploaded: Set<THREE.Texture>) {
  // What the boot warm-up leaves behind: the procedural sheet built and uploaded.
  const shatter = new THREE.Texture({ width: 512, height: 512 });
  procedural.set('shatter', shatter);
  uploaded.add(shatter);
  return shatter;
}

it.each(CONTACT_SHEETS)(
  'binds the uploaded procedural sheet for %s until the kit uploaded its own',
  (kind: ContactSheet) => {
    const uploaded = new Set<THREE.Texture>();
    const { pool, meshes } = flipbooks((texture) => uploaded.has(texture));
    const shatter = uploadedShatter(uploaded);
    const sheet = contacts.get(kind) as THREE.Texture;
    pool.spawn(0, 1, 0, 3, 0xc6dce9, 1.5, kind, 0.2);
    const cold = meshes[0].material.uniforms;
    expect(meshes[0].visible).toBe(true);
    expect(cold.uMap.value).toBe(shatter);
    // The procedural sheet has no baked gutter to inset.
    expect(cold.uInset.value).toBe(0);

    uploaded.add(sheet);
    pool.spawn(0, 1, 0, 3, 0xc6dce9, 1.5, kind, 0.2);
    const warm = meshes[1].material.uniforms;
    expect(warm.uMap.value).toBe(sheet);
    expect(warm.uInset.value).toBeCloseTo(4 / 1024);
  },
);

it('skips a contact when neither its sheet nor the procedural one is uploaded here', () => {
  const uploaded = new Set<THREE.Texture>();
  const { pool, meshes } = flipbooks((texture) => uploaded.has(texture));
  // Never built on this page: the fallback must not paint and upload it live.
  pool.spawn(0, 1, 0, 3, 0xffffff, 1.5, 'contact_cut', 0.2);
  expect(procedural.has('shatter')).toBe(false);
  // Built but not uploaded by this renderer (a rebuilt one, before its warm-up).
  procedural.set('shatter', new THREE.Texture({ width: 512, height: 512 }));
  pool.spawn(0, 1, 0, 3, 0xffffff, 1.5, 'contact_pierce', 0.2);
  pool.spawn(0, 1, 0, 3, 0xffffff, 2, 'warrior_storm_flash', 0.2);
  expect(meshes.filter((mesh) => mesh.visible)).toHaveLength(0);
  expect(meshes.every((mesh) => mesh.material.uniforms.uMap.value === null)).toBe(true);
});

it('never binds the cut contact sheet to a Warrior flash before its upload', () => {
  const uploaded = new Set<THREE.Texture>();
  const { pool, meshes } = flipbooks((texture) => uploaded.has(texture));
  const shatter = uploadedShatter(uploaded);
  const cut = contacts.get('contact_cut') as THREE.Texture;
  pool.spawn(0, 1, 0, 3, 0xffffff, 2, 'warrior_steel_flash', 0.2);
  expect(meshes[0].visible).toBe(true);
  expect(meshes[0].material.uniforms.uMap.value).toBe(shatter);
  uploaded.add(cut);
  pool.spawn(0, 1, 0, 3, 0xffffff, 2, 'warrior_steel_flash', 0.2);
  expect(meshes[1].material.uniforms.uMap.value).toBe(cut);
});

it('draws no contact without a readiness host or before the kit decoded', () => {
  const { pool, meshes } = flipbooks();
  procedural.set('shatter', new THREE.Texture({ width: 512, height: 512 }));
  pool.spawn(0, 1, 0, 3, 0xffffff, 1.5, 'contact_crush', 0.2);
  pool.spawn(0, 1, 0, 3, 0xffffff, 1.5, 'warrior_blood_flash', 0.2);
  expect(meshes.filter((mesh) => mesh.visible)).toHaveLength(0);
  // A declined or not-yet-decoded kit keeps its previous presentation: no quad.
  const uploaded = new Set<THREE.Texture>();
  const ready = flipbooks((texture) => uploaded.has(texture));
  uploadedShatter(uploaded);
  contacts.clear();
  ready.pool.spawn(0, 1, 0, 3, 0xffffff, 1.5, 'contact_crush', 0.2);
  ready.pool.spawn(0, 1, 0, 3, 0xffffff, 1.5, 'warrior_blood_flash', 0.2);
  expect(ready.meshes.filter((mesh) => mesh.visible)).toHaveLength(0);
  // Ordinary school sheets never consult the kit or the readiness host.
  pool.spawn(0, 1, 0, 3, 0xffffff, 1.5, 'flame', 0.2);
  expect(meshes[0].material.uniforms.uMap.value).toBe(procedural.get('flame'));
});

it.each(['smoke', 'shout_dust'] as const)(
  'keeps the %s layer from drawing until the kit uploaded its sheet',
  (kind) => {
    const sheet = new THREE.Texture();
    vi.spyOn(assets, 'bakedTexture').mockImplementation((k) => (k === kind ? sheet : null));
    const uploaded = new Set<THREE.Texture>();
    const scene = new THREE.Scene();
    const pool = new BakedImpactLayers(scene, (texture) => uploaded.has(texture));
    const unprepared = new BakedImpactLayers(new THREE.Scene());
    disposers.push(
      () => pool.dispose(),
      () => unprepared.dispose(),
    );
    const spawn = (layers: BakedImpactLayers) =>
      layers.spawn(kind, 0, 1, 0, 3, 0xffffff, 0xffffff, 0.4, 0, 0, 0);
    const bound = () =>
      (scene.children as ImpactMesh[]).filter((mesh) => mesh.material.uniforms.uMap.value);
    expect(spawn(pool)).toBe(false);
    expect(spawn(unprepared)).toBe(false);
    expect(bound()).toHaveLength(0);
    uploaded.add(sheet);
    expect(spawn(pool)).toBe(true);
    expect(bound().map((mesh) => mesh.material.uniforms.uMap.value)).toEqual([sheet]);
  },
);
