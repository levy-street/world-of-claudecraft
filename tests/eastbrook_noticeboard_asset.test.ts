import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getBounds, NodeIO, Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EASTBROOK_NOTICEBOARD_SOURCE_FILES,
  eastbrookNoticeboardSourceFingerprint,
} from '../scripts/assets/eastbrook_noticeboard/source_fingerprint.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { gfxInternalsForTest } from '../src/render/gfx';
import {
  buildEastbrookNoticeboard,
  buildNoticeboardFromSource,
  noticeboardPreloadInternalsForTest,
} from '../src/render/noticeboard';
import { isSharedGeometry, isSharedMaterial } from '../src/render/shared_resource';

const REPO_ROOT = path.join(__dirname, '..');
const ASSET_PATH = path.join(REPO_ROOT, 'public/models/props/eastbrook_noticeboard.glb');
const ASSET_BYTES = 58_024;
const ASSET_SHA256 = '9972881bd536754290f0541d2381928fae65643d53f54bc2cd60b43f193c6153';
const SOURCE_FINGERPRINT = '2f7e95846e303d87f96d6918dca1fd29a5b0b40a3266b0604ed366701201afc8';
let restoreGfx: (() => void) | null = null;

function setStandardMaterials(value: boolean): void {
  restoreGfx?.();
  restoreGfx = gfxInternalsForTest.overrideSettings({ standardMaterials: value });
}

function coloredBox(
  size: readonly [number, number, number],
  colorHex: number,
): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(...size);
  geometry.deleteAttribute('uv');
  const color = new THREE.Color(colorHex);
  const colors = new Float32Array(geometry.getAttribute('position').count * 3);
  for (let index = 0; index < colors.length; index += 3) {
    colors[index] = color.r;
    colors[index + 1] = color.g;
    colors[index + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function sourceModel(): THREE.Group {
  const source = new THREE.Group();
  const surfaceMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.84,
    metalness: 0,
    vertexColors: true,
  });
  surfaceMaterial.name = 'EastbrookNoticeboardSurface';
  const surface = new THREE.Mesh(coloredBox([2.4, 2.6, 0.6], 0x33251c), surfaceMaterial);
  surface.position.y = 1.3;
  source.add(surface);

  const hardwareMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.48,
    metalness: 0.62,
    vertexColors: true,
  });
  hardwareMaterial.name = 'EastbrookNoticeboardHardware';
  const hardware = new THREE.Mesh(coloredBox([0.3, 0.3, 0.1], 0xb48335), hardwareMaterial);
  hardware.position.set(0, 1.5, 0.1);
  source.add(hardware);

  for (const [name, y, z] of [
    ['Socket_Interaction', 1.3, 0.31],
    ['Socket_Notices', 1.51, 0.15],
  ] as const) {
    const socket = new THREE.Object3D();
    socket.name = name;
    socket.position.set(0, y, z);
    source.add(socket);
  }
  return source;
}

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  return meshes;
}

function meshMaterialName(mesh: THREE.Mesh): string {
  return Array.isArray(mesh.material) ? '' : mesh.material.name;
}

afterEach(() => {
  restoreGfx?.();
  restoreGfx = null;
});

describe('Eastbrook noticeboard shipping asset', () => {
  it('pins the deterministic source inventory and optimizer specification', () => {
    expect(EASTBROOK_NOTICEBOARD_SOURCE_FILES).toEqual([
      'docs/screenshots/eastbrook-vale-rebuild/polish/turnarounds/noticeboard.png',
      'public/textures/eastbrook_surface_atlas.webp',
      'scripts/assets/eastbrook_noticeboard/model.js',
      'scripts/assets/eastbrook_noticeboard/export_entry.js',
      'scripts/assets/eastbrook_noticeboard/export_eastbrook_noticeboard.mjs',
      'scripts/assets/eastbrook_noticeboard/source_fingerprint.mjs',
      'scripts/assets/specs/eastbrook_noticeboard.json',
      'scripts/assets/build_assets.mjs',
      'pnpm-lock.yaml',
    ]);
    expect(eastbrookNoticeboardSourceFingerprint(REPO_ROOT)).toBe(SOURCE_FINGERPRINT);
    expect(eastbrookNoticeboardSourceFingerprint(REPO_ROOT)).toBe(
      eastbrookNoticeboardSourceFingerprint(REPO_ROOT),
    );
    const modelSource = readFileSync(
      path.join(REPO_ROOT, 'scripts/assets/eastbrook_noticeboard/model.js'),
      'utf8',
    );
    expect(modelSource).toContain('function addEastbrookCrest(surface, hardware, stage)');
    expect(modelSource).toContain('makeShield(0.46, 0.5, 0.024)');
    expect(modelSource).toContain('makeSunburst(0.095, 0.043, 8, 0.009)');
    expect(modelSource).toContain("'original-eastbrook-shield-crest'");
    expect(
      JSON.parse(
        readFileSync(
          path.join(REPO_ROOT, 'scripts/assets/specs/eastbrook_noticeboard.json'),
          'utf8',
        ),
      ),
    ).toEqual({
      items: [
        {
          src: 'tmp/asset_src/eastbrook_noticeboard/eastbrook_noticeboard-final.glb',
          out: 'models/props/eastbrook_noticeboard.glb',
          type: 'static',
          keepExtras: true,
        },
      ],
    });
  });

  it('pins the shipped painted model: bytes, sheets, structure, sockets and bounds', async () => {
    // The shipped file is the hand-built painted notice board now
    // (scripts/assets/eastbrook_houses/props.py noticeboard, written over this path by
    // build_props.py on quarter-size maps and shipped by optimise.mjs). The procedural
    // pipeline pinned above made the model it replaced and is kept as its record: do not
    // run its optimizer spec over this file.
    await MeshoptDecoder.ready;
    const bytes = readFileSync(ASSET_PATH);
    expect(bytes.length).toBe(ASSET_BYTES);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(ASSET_SHA256);
    expect(bytes.length).toBeLessThanOrEqual(100 * 1024);
    expect(MEDIA_ASSETS['models/props/eastbrook_noticeboard.glb']).toBe(
      `/media/models/props/eastbrook_noticeboard.${ASSET_SHA256.slice(0, 12)}.glb`,
    );

    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const document = await io.readBinary(bytes);
    const root = document.getRoot();
    const shipping = ['EXT_meshopt_compression', 'KHR_mesh_quantization', 'KHR_texture_basisu'];
    expect(
      root
        .listExtensionsUsed()
        .map((extension) => extension.extensionName)
        .sort(),
    ).toEqual(shipping);
    expect(
      root
        .listExtensionsRequired()
        .map((extension) => extension.extensionName)
        .sort(),
    ).toEqual(shipping);
    // the kit's own painted sheets, each at a quarter of the props' usual size
    expect(
      root
        .listTextures()
        .map((texture) => [texture.getName(), texture.getMimeType(), texture.getSize()]),
    ).toEqual([
      ['trim', 'image/ktx2', [256, 256]],
      ['slate', 'image/ktx2', [256, 256]],
    ]);
    expect(root.listAnimations()).toHaveLength(0);
    expect(root.listSkins()).toHaveLength(0);
    expect(root.listCameras()).toHaveLength(0);
    expect(root.listScenes()).toHaveLength(1);
    expect(root.listNodes()).toHaveLength(3);

    // one model named for its file, and beside it the two anchors the game reads
    const scene = root.listScenes()[0];
    expect(scene.listChildren().map((node) => node.getName())).toEqual([
      'eastbrook_noticeboard',
      'Socket_Interaction',
      'Socket_Notices',
    ]);
    const modelRoot = scene.listChildren()[0];
    expect(modelRoot.getTranslation()).toEqual([0, 0, 0]);
    expect(modelRoot.getRotation()).toEqual([0, 0, 0, 1]);
    expect(modelRoot.getScale()).toEqual([1, 1, 1]);

    expect(root.listMeshes()).toHaveLength(1);
    const primitives = root.listMeshes()[0].listPrimitives();
    let triangles = 0;
    for (const primitive of primitives) {
      expect(primitive.getMode()).toBe(Primitive.Mode.TRIANGLES);
      expect(primitive.listSemantics().sort()).toEqual([
        'COLOR_0',
        'NORMAL',
        'POSITION',
        'TEXCOORD_0',
      ]);
      const position = primitive.getAttribute('POSITION');
      if (!position) throw new Error('the notice board lost its positions');
      triangles += (primitive.getIndices()?.getCount() ?? position.getCount()) / 3;
    }
    expect(triangles).toBe(566);

    const materials = new Map(
      root.listMaterials().map((material) => [material.getName(), material] as const),
    );
    expect([...materials.keys()].sort()).toEqual(['eh_slate', 'eh_trim']);
    for (const material of materials.values()) {
      expect(material.getMetallicFactor()).toBe(0);
      expect(material.getRoughnessFactor()).toBe(0.92);
      expect(material.getBaseColorTexture()).not.toBeNull();
      expect(material.getMetallicRoughnessTexture()).toBeNull();
      expect(material.getAlphaMode()).toBe('OPAQUE');
    }

    // floor-seated and centred, inside the box the release board filled
    const bounds = getBounds(scene);
    expect(bounds.min[0]).toBeCloseTo(-1.2, 3);
    expect(bounds.min[1]).toBeCloseTo(0, 3);
    expect(bounds.min[2]).toBeCloseTo(-0.2402, 3);
    expect(bounds.max[0]).toBeCloseTo(1.2, 3);
    expect(bounds.max[1]).toBeCloseTo(2.108, 3);
    expect(bounds.max[2]).toBeCloseTo(0.2402, 3);

    // where a reader stands and where the notices hang: bare anchors on the front
    const sockets = root
      .listNodes()
      .filter((node) => node.getName().startsWith('Socket_'))
      .map((node) => ({
        name: node.getName(),
        translation: node.getTranslation().map((value) => Math.round(value * 1e4) / 1e4),
        children: node.listChildren().length,
        mesh: node.getMesh(),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    expect(sockets).toEqual([
      { name: 'Socket_Interaction', translation: [0, 0.8921, 0.2127], children: 0, mesh: null },
      { name: 'Socket_Notices', translation: [0, 1.0362, 0.1029], children: 0, mesh: null },
    ]);
  });

  it('commits multi-angle construction, serialized, scale, collider, and comparison evidence', () => {
    const evidenceRoot = path.join(
      REPO_ROOT,
      'docs/screenshots/eastbrook-vale-rebuild/polish/assets/noticeboard',
    );
    for (const relativePath of [
      'stages-contact.png',
      'raw-contact.png',
      'optimized-contact.png',
      'optimized-lookdev-contact.png',
      'reference-vs-optimized-contact.png',
      'optimized/grazing.png',
      'optimized-lookdev/low.png',
      'optimized-lookdev/dusk.png',
      'optimized-lookdev/player-scale.png',
      'optimized-lookdev/collider-overlay.png',
    ]) {
      expect(existsSync(path.join(evidenceRoot, relativePath)), relativePath).toBe(true);
    }
  });
});

describe('Eastbrook noticeboard renderer adapter', () => {
  it('clones immutable GLB data, seats it, and binds shared atlas resources', () => {
    const atlas = new THREE.Texture();
    const source = sourceModel();
    const sourceMeshes = meshesOf(source);
    const built = buildNoticeboardFromSource(source, atlas);
    const builtMeshes = meshesOf(built);
    const bounds = new THREE.Box3().setFromObject(built);

    expect(built).not.toBe(source);
    expect(builtMeshes).toHaveLength(2);
    expect(sourceMeshes.every((mesh) => mesh.geometry.getAttribute('uv') === undefined)).toBe(true);
    expect(builtMeshes.every((mesh) => mesh.geometry.getAttribute('uv') !== undefined)).toBe(true);
    expect(builtMeshes.every((mesh) => isSharedGeometry(mesh.geometry))).toBe(true);
    expect(builtMeshes.every((mesh) => isSharedMaterial(mesh.material as THREE.Material))).toBe(
      true,
    );
    expect(bounds.min.x).toBeCloseTo(-1.2, 6);
    expect(bounds.min.y).toBeCloseTo(0, 6);
    expect(bounds.min.z).toBeCloseTo(-0.3, 6);
    expect(bounds.max.x).toBeCloseTo(1.2, 6);
    expect(bounds.max.y).toBeCloseTo(2.6, 6);
    expect(bounds.max.z).toBeCloseTo(0.3, 6);
    expect(
      builtMeshes.find((mesh) => meshMaterialName(mesh) === 'EastbrookNoticeboardSurface')
        ?.castShadow,
    ).toBe(true);
    expect(
      builtMeshes.find((mesh) => meshMaterialName(mesh) === 'EastbrookNoticeboardHardware')
        ?.castShadow,
    ).toBe(false);
    expect(built.userData).toMatchObject({
      assetUrl: '/models/props/eastbrook_noticeboard.glb',
      noticeboardAssetUrl: '/models/props/eastbrook_noticeboard.glb',
      source: 'procedural-glb',
      noticeboardFront: [0, 0, 1],
      noticeboardSockets: ['Socket_Interaction', 'Socket_Notices'],
      eastbrookSurfaceAtlas: {
        url: '/textures/eastbrook_surface_atlas.webp',
        textureUuid: atlas.uuid,
        materialBindings: 2,
      },
    });
  });

  it('retains vertex color and the shared atlas on the Lambert-compatible Low path', () => {
    setStandardMaterials(false);
    const atlas = new THREE.Texture();
    const built = buildNoticeboardFromSource(sourceModel(), atlas);
    for (const mesh of meshesOf(built)) {
      expect(mesh.material).toBeInstanceOf(THREE.MeshLambertMaterial);
      const material = mesh.material as THREE.MeshLambertMaterial;
      expect(material.map).toBe(atlas);
      expect(material.vertexColors).toBe(true);
      expect(material.flatShading).toBe(true);
    }
  });

  it('shares prepared resources across view clones without sharing transform state', () => {
    const first = buildEastbrookNoticeboard().group;
    const second = buildEastbrookNoticeboard().group;
    const firstMeshes = meshesOf(first);
    const secondMeshes = meshesOf(second);

    expect(first).not.toBe(second);
    expect(first.name).toBe('eastbrookNoticeboard');
    expect(first.userData.noticeboardAssetUrl).toBe('/models/props/eastbrook_noticeboard.glb');
    expect(firstMeshes.length).toBeGreaterThan(0);
    expect(firstMeshes).toHaveLength(secondMeshes.length);
    for (let index = 0; index < firstMeshes.length; index++) {
      expect(firstMeshes[index]).not.toBe(secondMeshes[index]);
      expect(firstMeshes[index].geometry).toBe(secondMeshes[index].geometry);
      expect(firstMeshes[index].material).toBe(secondMeshes[index].material);
    }
    first.position.x = 12;
    expect(second.position.x).toBe(0);
    const bounds = new THREE.Box3().setFromObject(second);
    expect(bounds.max.y - bounds.min.y).toBeCloseTo(
      noticeboardPreloadInternalsForTest.targetHeight,
      6,
    );
  });
});
