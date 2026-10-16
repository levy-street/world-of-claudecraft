// Placed copies of the authored towns' own models drawn in the town's look
// (src/render/town_styled_placed_assets.ts). Pinned here:
//  - while a town's atlas has not loaded, the hook declines (null), so the
//    plain GLB draws instead of a template that caches an atlas-less look;
//  - once it has, every template carries its OWN material instances: placed
//    batching patches whatever material it is handed (the placed fade), and
//    that must never be the shared surfaceMat entry the town's own batches
//    still draw with, so two templates never share a material;
//  - the geometry is the town's extraction: base on y = 0, centred on x/z.
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

const atlases = vi.hoisted(() => ({
  eastbrook: undefined as unknown,
  fenbridge: undefined as unknown,
}));

vi.mock('../src/render/eastbrook_surface_atlas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/eastbrook_surface_atlas')>()),
  eastbrookSurfaceAtlasTexture: () => atlases.eastbrook,
}));
vi.mock('../src/render/fenbridge_surface_atlas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/fenbridge_surface_atlas')>()),
  fenbridgeSurfaceAtlasTexture: () => atlases.fenbridge,
}));

const { townStyledPlacedTemplate } = await import('../src/render/town_styled_placed_assets');

const STALL = '/models/props/eastbrook_market_stall.glb';
const CISTERN = '/models/props/fenbridge_mirelight_cistern.glb';

/** A vertex-coloured stand-in for a town GLB: an opaque body off-centre and
 *  above the ground, plus an emissive pane, the two material classes the
 *  town extraction splits on. */
function source(opaqueName: string, emissiveName: string): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.BoxGeometry(2, 3, 1).translate(5, 2.5, -4);
  body.setAttribute(
    'color',
    new THREE.Float32BufferAttribute(
      new Array(body.getAttribute('position').count * 3).fill(0.6),
      3,
    ),
  );
  const opaque = new THREE.MeshStandardMaterial({ vertexColors: true });
  opaque.name = opaqueName;
  group.add(new THREE.Mesh(body, opaque));
  const emissive = new THREE.MeshStandardMaterial({ color: 0xffb45a, emissive: 0xff7a20 });
  emissive.name = emissiveName;
  group.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.1).translate(5, 2, -3.4), emissive));
  return group;
}

function materialsOf(root: THREE.Object3D): THREE.Material[] {
  const out: THREE.Material[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) out.push(...(Array.isArray(mesh.material) ? mesh.material : [mesh.material]));
  });
  return out;
}

describe('town-styled placed templates', () => {
  it('decline until the town atlas has loaded, and ignore every other model', () => {
    atlases.eastbrook = undefined;
    atlases.fenbridge = undefined;
    expect(townStyledPlacedTemplate(STALL, source('TownOpaque', 'TownEmissive'))).toBeNull();
    expect(
      townStyledPlacedTemplate(CISTERN, source('FenbridgeOpaque', 'FenbridgeEmissive')),
    ).toBeNull();
    atlases.eastbrook = new THREE.Texture();
    expect(townStyledPlacedTemplate('/models/props/fence.glb', new THREE.Group())).toBeNull();
  });

  for (const [label, path, names, key] of [
    ['Eastbrook', STALL, ['TownOpaque', 'TownEmissive'], 'eastbrook'],
    ['Fenbridge', CISTERN, ['FenbridgeOpaque', 'FenbridgeEmissive'], 'fenbridge'],
  ] as const) {
    it(`give every ${label} template its own materials, never the town's shared entry`, () => {
      atlases[key] = new THREE.Texture();
      const first = townStyledPlacedTemplate(path, source(names[0], names[1]));
      const second = townStyledPlacedTemplate(path, source(names[0], names[1]));
      if (!first || !second) throw new Error(`${label} template declined with its atlas loaded`);
      const a = materialsOf(first);
      const b = materialsOf(second);
      // opaque + emissive, each a fresh clone per template
      expect(a).toHaveLength(2);
      expect(b).toHaveLength(2);
      for (const material of a) expect(b).not.toContain(material);
      // the town's extraction: base on the ground, centred on its own anchor
      const box = new THREE.Box3().setFromObject(first);
      expect(box.min.y).toBeCloseTo(0, 6);
      expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 6);
      expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 6);
    });
  }
});
