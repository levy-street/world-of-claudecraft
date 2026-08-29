import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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
  // Round 5: kit fixtures carry a window-assembly component INSIDE the first
  // mesh's geometry, merged into the shell the way the single-mesh hexb GLBs
  // model their windows: a frame box at mid-height on the +z face PLUS a
  // recessed pane box sharing one exact corner vertex (max corner
  // (0.8, 1.5, 2.0)), so the pane detector (kit_window_panes_core.ts) finds
  // exactly one window per kit building and emits the pane box's back face
  // as its recessed glass plane. The opaque merge keeps the extra triangles
  // off the TownEmissive mesh, so the civic mask counts below stay authored.
  const shell = withEmissive
    ? mergeGeometries(
        [
          new THREE.BoxGeometry(2, 3, 4),
          new THREE.BoxGeometry(0.4, 0.6, 0.08).translate(0.6, 1.2, 1.96),
          new THREE.BoxGeometry(0.2, 0.3, 0.02).translate(0.7, 1.35, 1.99),
        ],
        false,
      )
    : new THREE.BoxGeometry(2, 3, 4);
  if (!shell) throw new Error('failed to merge the kit fixture shell');
  source.add(new THREE.Mesh(shell, new THREE.MeshStandardMaterial()));
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
      expect(shader.fragmentShader).toContain('totalEmissiveRadiance *= vColor.rgb;');
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
    // Re-staged 2026-08 for the KTX2 kit-building path (buildKitBuilding in
    // src/render/eastbrook_town.ts,
    // docs/design/eastbrook-revamp/site-plan.md): the five hexb kit buildings
    // render raw GLB clones with no eastbrookBuildingEmissive mesh, so the
    // material-independence pin runs against the chapel, the one building
    // still on the template pipeline, and additionally checks no kit clone
    // material was reused for the micro batch.
    // Round 6b (owner) re-shelled the chapel onto the KayKit church, so the
    // town has NO template-pipeline building left. The pin keeps running
    // against the chapel by id: buildKitBuilding names its window-pane mesh
    // eastbrookBuildingEmissive:<id>, exactly as the template path named its
    // emissive mesh, so the same lookup resolves and the same comparison
    // holds. The traverse below is unchanged and still proves the micro
    // batch's material is reused by no mesh anywhere in the town.
    const chapel = EASTBROOK_LAYOUT.buildings.find((building) => building.kind === 'chapel');
    if (!chapel) throw new Error('missing chapel building');
    const buildingMaterial = (
      view.group.getObjectByName(`eastbrookBuildingEmissive:${chapel.id}`) as THREE.Mesh
    ).material;
    expect(micro.material).not.toBe(buildingMaterial);
    view.group.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || child === micro) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      expect(materials.includes(micro.material as THREE.Material)).toBe(false);
    });
    expect((micro.material as THREE.Material).userData.eastbrookCivicBeacon).toEqual({
      maskAttribute: EASTBROOK_CIVIC_MASK_ATTRIBUTE,
      programCacheKey: 'eastbrook-civic-beacon-v1',
    });
    // Draw stats re-pinned 2026-08: harbor-move layout v3 retired the ring
    // wall (d19aa33f76, docs/design/eastbrook-revamp/site-plan.md), removing
    // the 4 wall color draws and 2 wall shadow draws; then the KTX2
    // kit-building path (buildKitBuilding in src/render/eastbrook_town.ts,
    // same site plan) put five raw-clone kit buildings in whose every mesh
    // casts shadows, so under round 4 (nine buildings, kit windows derived
    // from the fixtures' window-assembly components) the two-mesh fixtures
    // give colorDraws 28 and shadowDraws 18. Both counts moved again when the
    // town gained the harbour quarter's three coastal buildings: ten kit lots
    // now, so colorDraws 34 (20 clone materials + 10 window panes + the chapel
    // opaque and emissive pair + the 2 micro batches) and shadowDraws 22 (the
    // 20 clones + the chapel opaque + the micro opaque batch).
    // Round 6b re-shelled the chapel onto a kit asset, so it renders as an
    // eleventh kit lot instead of a template pair: colorDraws 35 (22 clone
    // materials + 11 window panes + the 2 micro batches) and shadowDraws 23
    // (the 22 clones + the micro opaque batch).
    expect(eastbrookTownDrawStats(view.group)).toMatchObject({ colorDraws: 35, shadowDraws: 23 });

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
    // Re-pinned 2026-08 with the harbor move's wall retirement (d19aa33f76,
    // docs/design/eastbrook-revamp/site-plan.md) and the KTX2 kit-building
    // path (buildKitBuilding in src/render/eastbrook_town.ts): the kit
    // clones cast shadows from every mesh, so under round 4 the two-mesh
    // fixtures give shadowDraws 18 and colorDraws 28 (the window panes,
    // derived from the fixtures' window-assembly components, never cast).
    // Re-pinned again once the town gained the harbour quarter's three coastal
    // buildings: ten kit lots give shadowDraws 22 and colorDraws 34, and the
    // window panes still never cast. Round 6b re-shelled the chapel onto the
    // KayKit church, making it an eleventh kit lot: shadowDraws 23 and
    // colorDraws 35, and the panes still never cast.
    expect(eastbrookTownDrawStats(view.group)).toMatchObject({ colorDraws: 35, shadowDraws: 23 });
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

  // Committed budget re-minted 2026-08: 26 wall-wing instances (5,356
  // triangles) left the layout with the Eastbrook harbor move (d19aa33f76,
  // docs/design/eastbrook-revamp/site-plan.md): 23,474 asset triangles plus
  // the 72-triangle foundation allowance.
  // Round 6 (owner): the rise house left the chapel green, so the town draws one
  // fewer kit shell and the budget RATCHETS DOWN with it (24,793 to 23,770), the
  // same discipline the monolith ceilings use: a real reduction lowers the pin in
  // the change that earned it, so the number keeps meaning what it says.
  // The same round's harbour quarter then moved it the other way: three coastal
  // buildings add 5,529 asset triangles (the first hexb_market lot the town has
  // ever seated at 3,125, one hexb_home_b at 1,393, one hexb_home_a at 1,011)
  // plus 36 triangles of foundation allowance, so 23,770 becomes 29,335. The
  // quarter was composed to fit: the inland fourth lot came back out rather than
  // the 30,000 target being relaxed, so meetsTarget below still asserts true.
  // Round 6b (owner) re-shelled the chapel onto the KayKit church: the bespoke
  // eastbrook_chapel.glb (4,120) leaves the town's asset set and hex_church.glb
  // (1,601) takes its one instance, so the budget RATCHETS DOWN again by 2,519,
  // 29,335 to 26,816, with the building count and the 132-triangle skirt
  // allowance unchanged. meetsTarget stays true with more headroom, not less.
  it('preserves the committed 26,816 runtime triangle budget without another draw', async () => {
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
      maximumRuntimeTriangles: 26_816,
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
