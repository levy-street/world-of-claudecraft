import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { type GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  HIGHWATCH_MANOR_ASSET,
  VERTEX_COLOUR_SCALE,
} from '../scripts/assets/highwatch_manor/build.mjs';
import { buildPlacedTownBuilding } from '../src/render/eastbrook_placed_building';
import { activateGfxProfile, GFX, getActiveGfxProfile } from '../src/render/gfx';
import { applyVertexColourScale, vertexColourScaleOf } from '../src/render/vertex_colour_glb_parts';
import { HIGHWATCH_BUILDINGS_BY_ID } from '../src/sim/highwatch_layout';
import { stripComments } from './helpers/strip_comments';

// A painted, vertex-coloured GLB (the Highwatch manor, scripts/assets/highwatch_manor/) stores
// its painted faces' vertex colours under a headroom, so the baked light can lift the paint
// above its map, and names the linear factor that undoes it in each painted material's extras
// (`vertexColourScale`). The manor draws with its own materials (a placed town building,
// eastbrook_placed_building.ts; an authored map draws them as they are), so the loader applies
// the factor to those materials' colour once, as it parses the file
// (src/render/vertex_colour_glb_parts.ts applyVertexColourScale, src/render/assets/loader.ts).

const SCALE = 2.4876;
const originalProfile = getActiveGfxProfile();

afterEach(() => activateGfxProfile(originalProfile));

function material(name: string, scale?: unknown): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
  mat.name = name;
  if (scale !== undefined) mat.userData = { vertexColourScale: scale };
  return mat;
}

describe('the vertex colour scale of a painted GLB material', () => {
  it('reads the factor its extras name, and 1 for anything else', () => {
    expect(vertexColourScaleOf(material('ManorPlaster', SCALE))).toBe(SCALE);
    expect(vertexColourScaleOf(material('ManorMetal'))).toBe(1);
    for (const junk of [0, -2, Number.NaN, Number.POSITIVE_INFINITY, '2', null]) {
      expect(vertexColourScaleOf(material('X', junk)), String(junk)).toBe(1);
    }
  });

  it('scales each painted material once, however many meshes share it, and nothing else', () => {
    const scene = new THREE.Group();
    const painted = material('ManorPlaster', SCALE);
    const other = material('ManorSlate', SCALE);
    const plain = material('ManorMetal');
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    scene.add(new THREE.Mesh(geometry, painted));
    scene.add(new THREE.Mesh(geometry, painted));
    scene.add(new THREE.Mesh(geometry, [other, plain]));
    expect(applyVertexColourScale(scene)).toBe(2);
    expect(painted.color.toArray()).toEqual([SCALE, SCALE, SCALE]);
    expect(other.color.toArray()).toEqual([SCALE, SCALE, SCALE]);
    // an untextured material draws its vertex colours as they are
    expect(plain.color.toArray()).toEqual([1, 1, 1]);
    // never twice: a second pass (or a clone, which carries the mark) changes nothing
    expect(applyVertexColourScale(scene)).toBe(0);
    expect(painted.color.r).toBe(SCALE);
    const cloned = new THREE.Group().add(new THREE.Mesh(geometry, painted.clone()));
    expect(applyVertexColourScale(cloned)).toBe(0);
    expect(
      ((cloned.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).color.r,
    ).toBe(SCALE);
    // a factor scales the material's own colour (its glTF base colour factor), not a fixed one
    const tinted = material('Tinted', 2);
    tinted.color.setRGB(0.5, 0.25, 1);
    expect(applyVertexColourScale(new THREE.Group().add(new THREE.Mesh(geometry, tinted)))).toBe(1);
    expect(tinted.color.toArray()).toEqual([1, 0.5, 2]);
  });

  it('runs in the loader parse chain, before any consumer sees the scene', () => {
    // Comments stripped, so a commented-out call cannot satisfy the pin.
    const loader = stripComments(
      readFileSync(path.join(__dirname, '..', 'src/render/assets/loader.ts'), 'utf8'),
    );
    const polish = loader.indexOf('polishGltfTextures(gltf);');
    const scale = loader.indexOf('applyVertexColourScale(gltf.scene);');
    const classify = loader.indexOf('classifyGltfKtx2Textures(gltf, resolved);');
    expect(polish).toBeGreaterThan(-1);
    expect(scale).toBeGreaterThan(polish);
    expect(classify).toBeGreaterThan(scale);
  });
});

/**
 * A stand-in for three's KTX2 loader (Node has no transcoder): every painted map the manor
 * carries (KHR_texture_basisu) arrives as a small compressed texture.
 */
const stubKtx2Loader = {
  load(_url: string, onLoad: (texture: THREE.Texture) => void): void {
    const level = { data: new Uint8Array(8), width: 4, height: 4 };
    onLoad(new THREE.CompressedTexture([level], 4, 4, THREE.RGBA_S3TC_DXT1_Format));
  },
};

async function parseManor(): Promise<GLTF> {
  const bytes = readFileSync(path.join(__dirname, '..', HIGHWATCH_MANOR_ASSET.target));
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  // the loader reads an embedded image through `self.URL` (a browser global; Node has URL)
  const scope = globalThis as { self?: unknown };
  const hadSelf = 'self' in scope;
  if (!hadSelf) scope.self = globalThis;
  const loader = new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .setKTX2Loader(stubKtx2Loader as unknown as Parameters<GLTFLoader['setKTX2Loader']>[0]);
  try {
    return await new Promise<GLTF>((resolve, reject) => loader.parse(ab, '', resolve, reject));
  } finally {
    if (!hadSelf) delete scope.self;
  }
}

function materialsOf(root: THREE.Object3D): Map<string, THREE.MeshStandardMaterial> {
  const out = new Map<string, THREE.MeshStandardMaterial>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      out.set(m.name, m as THREE.MeshStandardMaterial);
    }
  });
  return out;
}

describe('the shipped Highwatch manor, as the game loads it', () => {
  let gltf: GLTF;

  beforeAll(async () => {
    await MeshoptDecoder.ready;
    gltf = await parseManor();
    applyVertexColourScale(gltf.scene);
  });

  it('draws its painted materials at the paint level, the rest as they are', () => {
    const mats = materialsOf(gltf.scene);
    expect([...mats.keys()].sort()).toEqual([...HIGHWATCH_MANOR_ASSET.materials]);
    for (const [name, mat] of mats) {
      expect(mat.vertexColors, name).toBe(true);
      if (HIGHWATCH_MANOR_ASSET.painted.includes(name)) {
        expect(mat.map, name).not.toBeNull();
        expect(mat.color.toArray(), name).toEqual([
          VERTEX_COLOUR_SCALE,
          VERTEX_COLOUR_SCALE,
          VERTEX_COLOUR_SCALE,
        ]);
      } else {
        expect(mat.map, name).toBeNull();
        expect(mat.color.toArray(), name).toEqual([1, 1, 1]);
      }
    }
  });

  it('keeps the scale in the town view per-building clones, on every material tier', () => {
    const manor = HIGHWATCH_BUILDINGS_BY_ID.highwatch_manor;
    for (const standard of [true, false]) {
      activateGfxProfile({
        ...originalProfile,
        settings: { ...GFX, standardMaterials: standard },
      });
      const built = buildPlacedTownBuilding('highwatch', manor, gltf.scene, () => 0);
      const mats = materialsOf(built.group);
      for (const name of HIGHWATCH_MANOR_ASSET.painted) {
        const mat = mats.get(name);
        expect(mat?.map, `${name} ${standard}`).toBeTruthy();
        expect(mat?.color.r, `${name} ${standard}`).toBe(VERTEX_COLOUR_SCALE);
        // the loader's normal scale (y flipped for a mesh without tangents) on the standard tier
        if (standard) expect(mat?.normalScale.toArray(), name).toEqual([1, -1]);
      }
      expect(mats.get('ManorMetal')?.color.r, String(standard)).toBe(1);
      // the cached model itself was scaled once: a clone never scales it again
      expect(materialsOf(gltf.scene).get('ManorPlaster')?.color.r).toBe(VERTEX_COLOUR_SCALE);
    }
  });
});
