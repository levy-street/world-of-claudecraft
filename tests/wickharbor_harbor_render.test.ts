import path from 'node:path';
import type * as THREE from 'three';
import { SRGBColorSpace } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { activateGfxProfile, GFX, type GfxTier, getActiveGfxProfile } from '../src/render/gfx';
import {
  buildWickharborHarbor,
  wickharborHarborInternalsForTest,
  wickharborHarborPrewarmParts,
} from '../src/render/wickharbor_harbor';
import {
  buildWickharborWharf,
  wickharborWharfInternalsForTest,
} from '../src/render/wickharbor_wharf';
import { WICKHARBOR_HARBOR_FRAME } from '../src/sim/content/wickharbor_harbor';
import { WATER_LEVEL } from '../src/sim/world';
import { expectPaintedMeshes, parsePaintedGlb } from './helpers/painted_glb';

// Wickharbor's wooden harbor painter (src/render/wickharbor_harbor.ts) over the shipped GLB:
// the model placed on the waterline at the harbor frame's origin, what each graphics tier really
// draws (the walkable structure, solids and every lantern on all of them), and the prewarm parts
// the props warm-up links.

const internals = wickharborHarborInternalsForTest;
const GLB = path.join(__dirname, '..', 'public', internals.assetUrl.replace(/^\//, ''));
/** Triangles per part (tests/wickharbor_harbor_asset.test.ts pins the same). */
const LOW = 5148 + 5328 + 1572 + 2992 + 2752 + 1900;
const MEDIUM = LOW + 8080;
const HIGH = MEDIUM + 2748;

let gltf: GLTF;
let wharfGltf: GLTF;
const originalProfile = getActiveGfxProfile();

function withTier(tier: GfxTier): void {
  activateGfxProfile({ ...originalProfile, settings: { ...GFX, effectsTier: tier } });
  internals.setLoadedGltfForTest(gltf);
}

function triangles(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry;
    n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return n;
}

function glowing(root: THREE.Object3D): number {
  const glows = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m && (m.emissive?.getHex() ?? 0) !== 0) glows.add(m);
  });
  return glows.size;
}

beforeAll(async () => {
  // the painted maps are KTX2: Node gets stand-ins (helpers/painted_glb.ts)
  gltf = await parsePaintedGlb(GLB);
  wharfGltf = await parsePaintedGlb(
    path.join(
      __dirname,
      '..',
      'public',
      wickharborWharfInternalsForTest.assetUrl.replace(/^\//, ''),
    ),
  );
});

afterEach(() => {
  activateGfxProfile(originalProfile);
});

afterAll(() => {
  internals.setLoadedGltfForTest(null);
  wickharborWharfInternalsForTest.setLoadedGltfForTest(null);
});

describe('wickharbor harbor painter', () => {
  it('places the model on the waterline at the harbor frame origin', () => {
    withTier('high');
    const harbor = buildWickharborHarbor();
    const model = harbor.getObjectByName('wickharborHarborModel');
    if (!model) throw new Error('no model');
    expect(model.position.x).toBe(WICKHARBOR_HARBOR_FRAME.x);
    expect(model.position.y).toBe(WATER_LEVEL);
    expect(model.position.z).toBe(WICKHARBOR_HARBOR_FRAME.z);
    expect(model.userData.assetUrl).toBe(internals.assetUrl);
  });

  it('draws the structure, solids and lanterns on low, adds the trim on medium, the dressing from high', () => {
    for (const [tier, want] of [
      ['low', LOW],
      ['medium', MEDIUM],
      ['high', HIGH],
      ['ultra', HIGH],
      ['insane', HIGH],
    ] as const) {
      withTier(tier);
      const model = buildWickharborHarbor().getObjectByName('wickharborHarborModel');
      if (!model) throw new Error('no model');
      expect(triangles(model), tier).toBe(want);
      // the lanterns are landmarks: they glow on every tier
      expect(glowing(model), tier).toBe(1);
    }
  });

  it('hands the props prewarm every program it draws, on every tier and material family', () => {
    for (const tier of ['low', 'medium', 'high', 'ultra', 'insane'] as const) {
      for (const standardMaterials of [true, false]) {
        activateGfxProfile({
          ...originalProfile,
          settings: { ...GFX, effectsTier: tier, standardMaterials },
        });
        internals.setLoadedGltfForTest(gltf);
        const harbor = buildWickharborHarbor();
        const drawn = new Set<THREE.Material>();
        harbor.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) drawn.add(mesh.material as THREE.Material);
        });
        const warmed = new Set(wickharborHarborPrewarmParts().map((p) => p.material));
        const label = `${tier} ${standardMaterials ? 'standard' : 'lambert'}`;
        expect(drawn.size, label).toBeGreaterThan(0);
        for (const m of drawn) expect(warmed.has(m), label).toBe(true);
      }
    }
  });

  it("draws with the ferry wharf's very materials: one wood, batched together by the props merge", () => {
    for (const standardMaterials of [true, false]) {
      activateGfxProfile({
        ...originalProfile,
        settings: { ...GFX, effectsTier: 'high', standardMaterials },
      });
      internals.setLoadedGltfForTest(gltf);
      wickharborWharfInternalsForTest.setLoadedGltfForTest(wharfGltf);
      const materialsOf = (root: THREE.Object3D): Set<THREE.Material> => {
        const out = new Set<THREE.Material>();
        root.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) out.add(mesh.material as THREE.Material);
        });
        return out;
      };
      const harborView = buildWickharborHarbor();
      const wharfView = buildWickharborWharf();
      const harbor = materialsOf(harborView);
      const wharf = materialsOf(wharfView);
      expect(harbor.size).toBe(5);
      expect([...harbor].every((m) => wharf.has(m))).toBe(true);
      // painted, and still one material each: each file embeds its own copy of the same
      // three maps, and the two models draw the same three texture objects
      const maps = expectPaintedMeshes(harborView, SRGBColorSpace);
      expect(maps.size).toBe(3);
      expect([...expectPaintedMeshes(wharfView, SRGBColorSpace)].every((t) => maps.has(t))).toBe(
        true,
      );
    }
  });

  it('builds nothing (and warns) when the model was never preloaded', () => {
    internals.setLoadedGltfForTest(null);
    const warn = console.warn;
    const said: unknown[] = [];
    console.warn = (...args: unknown[]) => said.push(args[0]);
    try {
      expect(buildWickharborHarbor().children).toHaveLength(0);
    } finally {
      console.warn = warn;
    }
    expect(String(said[0])).toContain('wickharbor harbor skipped');
  });
});
