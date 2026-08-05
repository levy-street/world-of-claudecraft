import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import {
  createEastbrookCivicBeaconState,
  decorateEastbrookCivicBeaconMaterial,
  EASTBROOK_CIVIC_MASK_ATTRIBUTE,
  setEastbrookCivicMask,
  updateEastbrookCivicBeaconMotion,
} from '../src/render/eastbrook_civic_beacon';
import {
  EASTBROOK_TOWN_ASSET_URLS,
  EASTBROOK_TOWN_NEW_ASSET_URLS,
  eastbrookTownDrawStats,
  eastbrookTownInternalsForTest,
  eastbrookTownTriangleBudget,
} from '../src/render/eastbrook_town';
import { sharedUniforms } from '../src/render/gfx';
import { modulateEmissiveByVertexColor } from '../src/render/vertex_color_emissive';
import { EASTBROOK_LAYOUT } from '../src/sim/eastbrook_layout';

const VERTEX_SHADER = `
#include <common>
void main() {
  #include <beginnormal_vertex>
  #include <begin_vertex>
}
`;

const FRAGMENT_SHADER = `
#include <common>
void main() {
  #include <emissivemap_fragment>
}
`;

function compileMaterial(
  material: THREE.Material,
  template: { vertexShader: string; fragmentShader: string } = {
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
  },
) {
  const shader: {
    vertexShader: string;
    fragmentShader: string;
    uniforms: Record<string, { value: unknown }>;
  } = {
    vertexShader: template.vertexShader,
    fragmentShader: template.fragmentShader,
    uniforms: {},
  };
  material.onBeforeCompile(
    shader as THREE.WebGLProgramParametersWithUniforms,
    null as unknown as THREE.WebGLRenderer,
  );
  return shader;
}

function sourceAsset(withEmissive: boolean): THREE.Group {
  const source = new THREE.Group();
  source.add(new THREE.Mesh(new THREE.BoxGeometry(2, 3, 4), new THREE.MeshStandardMaterial()));
  if (withEmissive) {
    const emissive = new THREE.MeshStandardMaterial({ emissive: 0xffffff });
    emissive.name = 'TownEmissive';
    source.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), emissive));
  }
  return source;
}

function fixtureSources(): Map<string, THREE.Object3D> {
  return new Map(
    EASTBROOK_TOWN_ASSET_URLS.map((assetUrl) => [
      assetUrl,
      sourceAsset(EASTBROOK_TOWN_NEW_ASSET_URLS.includes(assetUrl)),
    ]),
  );
}

async function loadRuntimeGlb(assetUrl: string): Promise<THREE.Group> {
  await MeshoptDecoder.ready;
  const bytes = readFileSync(path.join(__dirname, '..', 'public', assetUrl.replace(/^\//, '')));
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return await new Promise<THREE.Group>((resolve, reject) => {
    loader.parse(arrayBuffer, '', (gltf) => resolve(gltf.scene), reject);
  });
}

describe('Eastbrook civic beacon shader animation', () => {
  it('encodes the exact civic selection as a normalized Uint8 attribute', () => {
    const civic = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const other = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();

    expect(setEastbrookCivicMask(civic, true)).toBe(civic);
    expect(setEastbrookCivicMask(other, false)).toBe(other);

    for (const [geometry, selected] of [
      [civic, true],
      [other, false],
    ] as const) {
      const position = geometry.getAttribute('position');
      const mask = geometry.getAttribute(EASTBROOK_CIVIC_MASK_ATTRIBUTE);
      expect(mask.count).toBe(position.count);
      expect(mask.itemSize).toBe(1);
      expect(mask.normalized).toBe(true);
      expect(mask.array).toBeInstanceOf(Uint8Array);
      expect(new Set(mask.array)).toEqual(new Set([selected ? 255 : 0]));
      expect(mask.getX(0)).toBe(selected ? 1 : 0);
    }
  });

  it.each([
    ['Standard', new THREE.MeshStandardMaterial({ emissive: 0xffffff }), THREE.ShaderLib.physical],
    ['Lambert', new THREE.MeshLambertMaterial({ emissive: 0xffffff }), THREE.ShaderLib.lambert],
  ])(
    'patches the real %s vertex, normal, and emissive paths from the shared clock',
    (_name, source, template) => {
      const material = modulateEmissiveByVertexColor(source);
      const state = createEastbrookCivicBeaconState(-0.75, 2);
      decorateEastbrookCivicBeaconMaterial(material, state);
      const shader = compileMaterial(material, template);

      expect(shader.uniforms.uTime).toBe(sharedUniforms.uTime);
      expect(shader.uniforms.uEastbrookCivicReducedMotion).toBe(state.reducedMotion);
      expect(shader.uniforms.uEastbrookCivicPivot).toBe(state.pivot);
      expect(shader.vertexShader).toContain(`attribute float ${EASTBROOK_CIVIC_MASK_ATTRIBUTE};`);
      expect(shader.vertexShader).toContain('eastbrookCivicAngle = uTime * 0.28');
      expect(shader.vertexShader).toContain('sin(uTime * 0.85) * 0.04');
      expect(shader.vertexShader).toContain('objectNormal = mix(');
      expect(shader.vertexShader).toContain('transformed = mix(');
      expect(shader.fragmentShader).toContain('1.0 + sin(uTime * 1.3) * 0.08');
      expect(shader.fragmentShader).toContain('totalEmissiveRadiance *= vColor;');
      expect(shader.fragmentShader).toContain('totalEmissiveRadiance *= eastbrookCivicGlow;');
      expect(material.customProgramCacheKey()).toContain('eastbrook-civic-beacon-v1');
    },
  );

  it('turns all spatial motion off and holds a steady glow under reduced motion', () => {
    const state = createEastbrookCivicBeaconState(0, 0);
    expect(state.reducedMotion.value).toBe(0);
    expect(updateEastbrookCivicBeaconMotion(state, true)).toBe(state);
    expect(state.reducedMotion.value).toBe(1);

    const material = decorateEastbrookCivicBeaconMaterial(
      new THREE.MeshLambertMaterial({ emissive: 0xffffff }),
      state,
    );
    const shader = compileMaterial(material);
    expect(shader.vertexShader).toContain(
      'eastbrookCivicMotion = 1.0 - uEastbrookCivicReducedMotion',
    );
    expect(shader.fragmentShader).toMatch(
      /mix\(\s*1\.0,\s*eastbrookCivicPulse,\s*1\.0 - uEastbrookCivicReducedMotion\s*\)/,
    );

    updateEastbrookCivicBeaconMotion(state, false);
    expect(state.reducedMotion.value).toBe(0);
  });

  it('keeps REN-05 updates allocation-free with stable uniform identities and idempotent decoration', () => {
    const source = readFileSync(
      path.join(__dirname, '..', 'src/render/eastbrook_civic_beacon.ts'),
      'utf8',
    );
    const updateAt = source.indexOf('export function updateEastbrookCivicBeaconMotion(');
    const bodyAt = source.indexOf('{', updateAt);
    const bodyEnd = source.indexOf('\n}', bodyAt);
    expect(updateAt).toBeGreaterThan(-1);
    expect(bodyAt).toBeGreaterThan(updateAt);
    expect(bodyEnd).toBeGreaterThan(bodyAt);
    expect(source.slice(bodyAt + 1, bodyEnd).trim()).toBe(
      `state.reducedMotion.value = reducedMotion ? 1 : 0;
  return state;`,
    );

    const state = createEastbrookCivicBeaconState(-0.75, 2);
    const material = new THREE.MeshLambertMaterial({ emissive: 0xffffff });
    decorateEastbrookCivicBeaconMaterial(material, state);
    const shader = compileMaterial(material);
    const stateIdentity = state;
    const pivotUniformIdentity = state.pivot;
    const pivotValueIdentity = state.pivot.value;
    const reducedMotionUniformIdentity = state.reducedMotion;
    const compileIdentity = material.onBeforeCompile;
    const cacheKeyIdentity = material.customProgramCacheKey;

    for (const [reducedMotion, expectedValue] of [
      [true, 1],
      [true, 1],
      [false, 0],
      [false, 0],
    ] as const) {
      expect(updateEastbrookCivicBeaconMotion(state, reducedMotion)).toBe(stateIdentity);
      expect(state.pivot).toBe(pivotUniformIdentity);
      expect(state.pivot.value).toBe(pivotValueIdentity);
      expect(state.reducedMotion).toBe(reducedMotionUniformIdentity);
      expect(state.reducedMotion.value).toBe(expectedValue);
      expect(shader.uniforms.uEastbrookCivicPivot).toBe(pivotUniformIdentity);
      expect(shader.uniforms.uEastbrookCivicReducedMotion).toBe(reducedMotionUniformIdentity);
    }

    expect(decorateEastbrookCivicBeaconMaterial(material, state)).toBe(material);
    expect(material.onBeforeCompile).toBe(compileIdentity);
    expect(material.customProgramCacheKey).toBe(cacheKeyIdentity);
  });

  it('selects only the synthetic 36-vertex civic fixture after merge and keeps the material independent', () => {
    const view = eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
    const micro = view.group.getObjectByName('eastbrookTownMicroEmissiveBatch') as THREE.Mesh;
    const mask = micro.geometry.getAttribute(EASTBROOK_CIVIC_MASK_ATTRIBUTE);
    const bytes = mask.array as Uint8Array;
    const selectedCount = bytes.reduce((sum, value) => sum + (value === 255 ? 1 : 0), 0);
    // The merge preserves exact full-tuple indices instead of de-indexing, so
    // the box fixture contributes its 24 UNIQUE vertices (4 per face, since the
    // per-face normals differ) rather than the 36 it expands to when every
    // triangle carries its own copy. Same rendered geometry, fewer vertices.
    const civicTemplateVertexCount = 24;

    expect(mask.normalized).toBe(true);
    expect(mask.count).toBe(micro.geometry.getAttribute('position').count);
    expect(selectedCount).toBe(civicTemplateVertexCount);
    expect(bytes.length - selectedCount).toBeGreaterThan(0);
    const buildingMaterial = (
      view.group.getObjectByName(
        `eastbrookBuildingEmissive:${EASTBROOK_LAYOUT.buildings[0].id}`,
      ) as THREE.Mesh
    ).material;
    expect(micro.material).not.toBe(buildingMaterial);
    expect((micro.material as THREE.Material).userData.eastbrookCivicBeacon).toEqual({
      maskAttribute: EASTBROOK_CIVIC_MASK_ATTRIBUTE,
      programCacheKey: 'eastbrook-civic-beacon-v1',
    });
    expect(eastbrookTownDrawStats(view.group)).toMatchObject({ colorDraws: 18, shadowDraws: 9 });

    view.update(0, 5, 0, 0, 0, 0, 100, 1, true);
    const shader = compileMaterial(micro.material as THREE.Material);
    expect(shader.uniforms.uEastbrookCivicReducedMotion.value).toBe(1);
    view.update(0, 5, 0, 0, 0, 0, 100, 1, false);
    expect(shader.uniforms.uEastbrookCivicReducedMotion.value).toBe(0);
    expect(view.update.toString()).not.toMatch(/\bnew\s+/);
  });

  it('selects exactly the shipping TownEmissive eight triangles and leaves every other mask byte zero', async () => {
    const civicAsset = EASTBROOK_LAYOUT.civic.wellBeacon.assetId;
    const shippingCivic = await loadRuntimeGlb(civicAsset);
    const shippingEmissiveMeshes: THREE.Mesh[] = [];
    shippingCivic.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      if (materials.some((material) => material.name === 'TownEmissive')) {
        shippingEmissiveMeshes.push(child);
      }
    });
    expect(shippingEmissiveMeshes).toHaveLength(1);
    const shippingEmissive = shippingEmissiveMeshes[0];
    expect(shippingEmissive.geometry.getIndex()).toBeNull();
    expect(shippingEmissive.geometry.getAttribute('position').count).toBe(24);

    const sources = fixtureSources();
    sources.set(civicAsset, shippingCivic);
    const view = eastbrookTownInternalsForTest.buildFromSources(sources, () => 0, true);
    const micro = view.group.getObjectByName('eastbrookTownMicroEmissiveBatch') as THREE.Mesh;
    const mask = micro.geometry.getAttribute(EASTBROOK_CIVIC_MASK_ATTRIBUTE);
    const bytes = mask.array as Uint8Array;
    const selected = [...bytes].filter((value) => value === 255);
    const unselected = [...bytes].filter((value) => value === 0);

    expect(mask.normalized).toBe(true);
    expect(mask.count).toBe(micro.geometry.getAttribute('position').count);
    expect(new Set(bytes)).toEqual(new Set([0, 255]));
    expect(selected).toHaveLength(24);
    expect(unselected).toHaveLength(bytes.length - 24);
    expect(unselected.length).toBeGreaterThan(0);
  });

  it('meets REN-04 with shader state only: no lights, textures, clips, meshes, or extra draws', () => {
    const source = readFileSync(
      path.join(__dirname, '..', 'src/render/eastbrook_civic_beacon.ts'),
      'utf8',
    );
    expect(source).not.toMatch(
      /\b(?:AmbientLight|DirectionalLight|HemisphereLight|PointLight|RectAreaLight|SpotLight)\b/,
    );
    expect(source).not.toMatch(/\b(?:CanvasTexture|DataTexture|TextureLoader|Texture)\b/);
    expect(source).not.toMatch(/\b(?:AnimationClip|AnimationMixer|clipAction|animations)\b/);
    expect(source).not.toMatch(/\bnew\s+THREE\.(?:Mesh|InstancedMesh|Sprite|Points|Line)\b/);

    const state = createEastbrookCivicBeaconState(-0.75, 2);
    const material = new THREE.MeshLambertMaterial({ emissive: 0xffffff });
    expect(decorateEastbrookCivicBeaconMaterial(material, state)).toBe(material);
    expect(state).toEqual({
      pivot: { value: new THREE.Vector2(-0.75, 2) },
      reducedMotion: { value: 0 },
    });

    const view = eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
    const decoratedMeshes: string[] = [];
    view.group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      if (materials.some((candidate) => candidate.userData.eastbrookCivicBeacon)) {
        decoratedMeshes.push(child.name);
      }
    });
    expect(decoratedMeshes).toEqual(['eastbrookTownMicroEmissiveBatch']);
    expect(eastbrookTownDrawStats(view.group)).toMatchObject({ colorDraws: 18, shadowDraws: 9 });
  });

  it('does not instantiate the animation or any town geometry for a custom world', () => {
    const view = eastbrookTownInternalsForTest.buildFromSources(new Map(), () => 0, false);
    expect(view.group.children).toEqual([]);
    expect(view.group.getObjectByName('eastbrookTownMicroEmissiveBatch')).toBeUndefined();
    expect(eastbrookTownDrawStats(view.group)).toMatchObject({
      colorDraws: 0,
      shadowDraws: 0,
      triangles: 0,
    });
  });

  it('preserves the committed 29,110 runtime triangle budget without another draw', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const triangleCountByAsset: Record<string, number> = {};
    for (const assetUrl of EASTBROOK_TOWN_ASSET_URLS) {
      const bytes = readFileSync(path.join(__dirname, '..', 'public', assetUrl.replace(/^\//, '')));
      const document = await io.readBinary(bytes);
      let triangles = 0;
      for (const mesh of document.getRoot().listMeshes()) {
        for (const primitive of mesh.listPrimitives()) {
          const position = primitive.getAttribute('POSITION');
          if (!position) throw new Error(`${assetUrl} has no POSITION`);
          triangles += (primitive.getIndices()?.getCount() ?? position.getCount()) / 3;
        }
      }
      triangleCountByAsset[assetUrl] = triangles;
    }
    expect(eastbrookTownTriangleBudget(triangleCountByAsset)).toMatchObject({
      maximumRuntimeTriangles: 29_110,
      withinHardCeiling: true,
      meetsTarget: true,
    });
  });

  it('wires reduced motion through both renderer town-update paths after ticking shared time', () => {
    const source = readFileSync(path.join(__dirname, '..', 'src/render/renderer.ts'), 'utf8');
    const calls = [...source.matchAll(/this\.eastbrookTownView\.update\(([\s\S]*?)\n\s*\);/g)];
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call[1]).toContain('this.reducedMotion()');

    const prewarmClock = source.indexOf(
      'sharedUniforms.uTime.value = this.time;',
      source.indexOf('prewarmWorldFrame'),
    );
    const prewarmTown = source.indexOf('this.eastbrookTownView.update(', prewarmClock);
    const syncStart = source.indexOf('sync(');
    const syncClock = source.indexOf('sharedUniforms.uTime.value = this.time;', syncStart);
    const syncTown = source.indexOf('this.eastbrookTownView.update(', syncClock);
    expect(prewarmClock).toBeGreaterThan(-1);
    expect(prewarmTown).toBeGreaterThan(prewarmClock);
    expect(syncClock).toBeGreaterThan(-1);
    expect(syncTown).toBeGreaterThan(syncClock);
  });
});
