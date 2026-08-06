import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getBounds, NodeIO, Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EASTBROOK_MAILBOX_SOURCE_FILES,
  eastbrookMailboxSourceFingerprint,
} from '../scripts/assets/eastbrook_mailbox/source_fingerprint.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { GFX, gfxInternalsForTest } from '../src/render/gfx';
import {
  buildMailboxFromSource,
  buildMailboxPillar,
  mailboxPreloadInternalsForTest,
} from '../src/render/mailbox';
import { isSharedGeometry, isSharedMaterial } from '../src/render/shared_resource';

const REPO_ROOT = path.join(__dirname, '..');
const ASSET_PATH = path.join(REPO_ROOT, 'public/models/props/mailbox_pillar.glb');
const ASSET_BYTES = 32_884;
const ASSET_SHA256 = '599f931cebcee4652e2fff788947cc34bedacad7a5bf8a168f04e44f1bfcdc95';
const SOURCE_FINGERPRINT = '2d63ac194e8e21ac618c5cb6405e2e4aef2c19a0f63a8a29d92489275e53cba6';
let restoreGfx: (() => void) | null = null;

function setStandardMaterials(value: boolean): void {
  restoreGfx?.();
  restoreGfx = gfxInternalsForTest.overrideSettings({ standardMaterials: value });
}

function sourceModel(material: THREE.MeshStandardMaterial): THREE.Group {
  const geometry = new THREE.BoxGeometry(2, 4, 1);
  const color = new THREE.Color(0x4c3829);
  const colors = new Float32Array(geometry.getAttribute('position').count * 3);
  for (let index = 0; index < colors.length; index += 3) {
    colors[index] = color.r;
    colors[index + 1] = color.g;
    colors[index + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = 5;
  const group = new THREE.Group();
  group.add(mesh);
  const socket = new THREE.Object3D();
  socket.name = mailboxPreloadInternalsForTest.unreadSocketName;
  socket.position.set(0, 1.6, 0.48);
  group.add(socket);
  return group;
}

afterEach(() => {
  restoreGfx?.();
  restoreGfx = null;
});

describe('Eastbrook Ravenpost mailbox pipeline', () => {
  it('pins the deterministic source inventory and optimizer specification', () => {
    expect(EASTBROOK_MAILBOX_SOURCE_FILES).toEqual([
      'docs/screenshots/eastbrook-vale-rebuild/polish/turnarounds/ravenpost-mailbox.png',
      'public/textures/eastbrook_surface_atlas.webp',
      'scripts/assets/eastbrook_mailbox/model.js',
      'scripts/assets/eastbrook_mailbox/export_entry.js',
      'scripts/assets/eastbrook_mailbox/export_eastbrook_mailbox.mjs',
      'scripts/assets/eastbrook_mailbox/source_fingerprint.mjs',
      'scripts/assets/specs/eastbrook_mailbox.json',
      'scripts/assets/build_assets.mjs',
      'pnpm-lock.yaml',
    ]);
    expect(eastbrookMailboxSourceFingerprint(REPO_ROOT)).toBe(SOURCE_FINGERPRINT);
    expect(eastbrookMailboxSourceFingerprint(REPO_ROOT)).toBe(
      eastbrookMailboxSourceFingerprint(REPO_ROOT),
    );
    const spec = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'scripts/assets/specs/eastbrook_mailbox.json'), 'utf8'),
    );
    expect(spec).toEqual({
      items: [
        {
          src: 'tmp/asset_src/eastbrook_mailbox/eastbrook_mailbox-final.glb',
          out: 'models/props/mailbox_pillar.glb',
          type: 'static',
          keepExtras: true,
        },
      ],
    });
  });

  it('pins the optimized GLB structure, materials, sockets, bounds, and exact bytes', async () => {
    await MeshoptDecoder.ready;
    const bytes = readFileSync(ASSET_PATH);
    expect(bytes.length).toBe(ASSET_BYTES);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(ASSET_SHA256);
    expect(bytes.length).toBeLessThanOrEqual(100 * 1024);
    expect(MEDIA_ASSETS['models/props/mailbox_pillar.glb']).toBe(
      `/media/models/props/mailbox_pillar.${ASSET_SHA256.slice(0, 12)}.glb`,
    );

    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const document = await io.readBinary(bytes);
    const root = document.getRoot();
    expect(
      root
        .listExtensionsUsed()
        .map((extension) => extension.extensionName)
        .sort(),
    ).toEqual(['EXT_meshopt_compression', 'KHR_mesh_quantization']);
    expect(
      root
        .listExtensionsRequired()
        .map((extension) => extension.extensionName)
        .sort(),
    ).toEqual(['EXT_meshopt_compression', 'KHR_mesh_quantization']);
    expect(root.listTextures()).toHaveLength(0);
    expect(root.listAnimations()).toHaveLength(0);
    expect(root.listSkins()).toHaveLength(0);
    expect(root.listCameras()).toHaveLength(0);
    expect(root.listScenes()).toHaveLength(1);
    expect(root.listNodes()).toHaveLength(5);

    const scene = root.listScenes()[0];
    expect(scene.listChildren().map((node) => node.getName())).toEqual([
      'EastbrookRavenpostMailbox',
    ]);
    const modelRoot = scene.listChildren()[0];
    expect(modelRoot.getTranslation()).toEqual([0, 0, 0]);
    expect(modelRoot.getRotation()).toEqual([0, 0, 0, 1]);
    expect(modelRoot.getScale()).toEqual([1, 1, 1]);
    expect(modelRoot.getExtras()).toEqual({
      sculptRuntime: {
        schemaVersion: 1,
        assetId: 'eastbrook-ravenpost-mailbox',
        stage: 'final',
        coordinateFrame: { front: '+Z', up: '+Y', right: '+X', units: 'world-yards' },
        nativeBounds: { width: 1.65, height: 2.9, depth: 1.05 },
        serviceCues: ['raven-crest', 'gold-mail-slot', 'cobalt-rain-hood', 'stone-footing'],
        interaction: {
          mode: 'mailbox-service-prop',
          interactive: true,
          authority: 'ground-object-entity',
        },
        collider: { shippingCollisionMesh: false },
        destruction: { breakable: false, detachableParts: [] },
        sockets: {
          'mail-slot': {
            nodeName: 'Socket_MailSlot',
            position: [0, 1.9399999363997906, 0.4491666488183877],
            purpose: 'mail service interaction cue',
            interactive: true,
          },
          'unread-glow': {
            nodeName: 'Socket_UnreadGlow',
            position: [0, 1.619999946988864, 0.4783333143260752],
            purpose: 'per-viewer unread mail effect anchor',
            interactive: false,
          },
        },
      },
    });

    const meshContracts = root
      .listNodes()
      .filter((node) => node.getMesh() !== null)
      .map((node) => {
        const mesh = node.getMesh();
        if (!mesh) throw new Error(`${node.getName()} lost its mesh`);
        expect(mesh.listPrimitives()).toHaveLength(1);
        const primitive = mesh.listPrimitives()[0];
        expect(primitive.getMode()).toBe(Primitive.Mode.TRIANGLES);
        expect(primitive.listSemantics().sort()).toEqual(['COLOR_0', 'NORMAL', 'POSITION']);
        const position = primitive.getAttribute('POSITION');
        const normal = primitive.getAttribute('NORMAL');
        const color = primitive.getAttribute('COLOR_0');
        if (!position || !normal || !color) throw new Error(`${node.getName()} lost attributes`);
        expect(position.getNormalized()).toBe(true);
        expect(normal.getNormalized()).toBe(true);
        expect(color.getNormalized()).toBe(true);
        expect(position.getComponentType()).toBe(5122);
        expect(normal.getComponentType()).toBe(5120);
        expect(color.getComponentType()).toBe(5121);
        return [
          primitive.getMaterial()?.getName(),
          (primitive.getIndices()?.getCount() ?? position.getCount()) / 3,
        ] as const;
      })
      .sort(([left], [right]) => (left ?? '').localeCompare(right ?? ''));
    expect(meshContracts).toEqual([
      ['MailboxMetal', 304],
      ['MailboxOpaque', 1336],
    ]);
    expect(meshContracts.reduce((sum, entry) => sum + entry[1], 0)).toBe(1640);

    const materials = new Map(
      root.listMaterials().map((material) => [material.getName(), material] as const),
    );
    expect([...materials.keys()].sort()).toEqual(['MailboxMetal', 'MailboxOpaque']);
    expect(materials.get('MailboxOpaque')?.getMetallicFactor()).toBe(0.02);
    expect(materials.get('MailboxOpaque')?.getRoughnessFactor()).toBe(0.84);
    expect(materials.get('MailboxMetal')?.getMetallicFactor()).toBe(0.62);
    expect(materials.get('MailboxMetal')?.getRoughnessFactor()).toBe(0.42);
    for (const material of materials.values()) {
      expect(material.getBaseColorFactor()).toEqual([1, 1, 1, 1]);
      expect(material.getBaseColorTexture()).toBeNull();
      expect(material.getMetallicRoughnessTexture()).toBeNull();
    }

    const bounds = getBounds(scene);
    expect(bounds.min[0]).toBeCloseTo(-0.825, 3);
    expect(bounds.min[1]).toBeCloseTo(0, 3);
    expect(bounds.min[2]).toBeCloseTo(-0.525, 3);
    expect(bounds.max[0]).toBeCloseTo(0.825, 3);
    expect(bounds.max[1]).toBeCloseTo(2.9, 3);
    expect(bounds.max[2]).toBeCloseTo(0.525, 3);

    const sockets = root
      .listNodes()
      .filter((node) => node.getName().startsWith('Socket_'))
      .map((node) => ({
        name: node.getName(),
        translation: node.getTranslation(),
        children: node.listChildren().length,
        mesh: node.getMesh(),
        extras: node.getExtras(),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    expect(sockets).toEqual([
      {
        name: 'Socket_MailSlot',
        translation: [0, 1.9399999363997906, 0.4491666488183877],
        children: 0,
        mesh: null,
        extras: {
          sculptSocket: {
            id: 'mail-slot',
            purpose: 'mail service interaction cue',
            interactive: true,
          },
        },
      },
      {
        name: 'Socket_UnreadGlow',
        translation: [0, 1.619999946988864, 0.4783333143260752],
        children: 0,
        mesh: null,
        extras: {
          sculptSocket: {
            id: 'unread-glow',
            purpose: 'per-viewer unread mail effect anchor',
            interactive: false,
          },
        },
      },
    ]);
    expect(root.getExtras()).toEqual({ sourceFingerprint: SOURCE_FINGERPRINT });
    expect(root.getAsset().extras).toEqual({ sourceFingerprint: SOURCE_FINGERPRINT });
  });
});

describe('Ravenpost mailbox renderer adapter', () => {
  it('drops the immutable loader source after preparing shared resources', () => {
    const source = readFileSync(path.join(REPO_ROOT, 'src/render/mailbox.ts'), 'utf8');
    expect(source).toContain("import { loadGltf, releaseGltf } from './assets/loader';");
    expect(source).toContain(
      'preparedMailboxTemplate = buildMailboxFromSource(loadedMailboxGltf.scene, atlas);',
    );
    expect(source).toContain('loadedMailboxGltf = null;');
    expect(source).toContain('releaseGltf(MAILBOX_ASSET_URL);');
  });

  it('clones immutable GLB data, seats it at 2.9 yards, and binds shared atlas resources', () => {
    const atlas = new THREE.Texture();
    const sourceMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.84,
      metalness: 0.02,
    });
    sourceMaterial.name = 'MailboxOpaque';
    const source = sourceModel(sourceMaterial);
    const sourceMesh = source.getObjectByProperty('isMesh', true) as THREE.Mesh;
    const built = buildMailboxFromSource(source, atlas);
    const builtMesh = built.getObjectByProperty('isMesh', true) as THREE.Mesh;
    const bounds = new THREE.Box3().setFromObject(built);

    expect(built).not.toBe(source);
    expect(builtMesh).not.toBe(sourceMesh);
    expect(sourceMesh.geometry.getAttribute('uv')).toBeDefined();
    expect(sourceMesh.material).toBe(sourceMaterial);
    expect(source.scale.toArray()).toEqual([1, 1, 1]);
    expect(bounds.min.y).toBeCloseTo(0, 6);
    expect(bounds.max.y - bounds.min.y).toBeCloseTo(2.9, 6);
    expect(builtMesh.geometry.getAttribute('uv')).toBeDefined();
    expect(builtMesh.geometry).not.toBe(sourceMesh.geometry);
    expect(isSharedGeometry(builtMesh.geometry)).toBe(true);
    expect(isSharedMaterial(builtMesh.material as THREE.Material)).toBe(true);
    expect(builtMesh.castShadow).toBe(true);
    expect(builtMesh.receiveShadow).toBe(true);
    const material = builtMesh.material as THREE.MeshStandardMaterial;
    expect(material).toBeInstanceOf(
      GFX.standardMaterials ? THREE.MeshStandardMaterial : THREE.MeshLambertMaterial,
    );
    expect(material.map).toBe(atlas);
    expect(material.vertexColors).toBe(true);
    expect(built.userData).toMatchObject({
      assetUrl: '/models/props/mailbox_pillar.glb',
      source: 'procedural-glb',
      eastbrookSurfaceAtlas: {
        url: '/textures/eastbrook_surface_atlas.webp',
        textureUuid: atlas.uuid,
        materialBindings: 1,
      },
    });
  });

  it('keeps gold mail hardware out of the shadow pass', () => {
    const atlas = new THREE.Texture();
    const sourceMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.42,
      metalness: 0.62,
    });
    sourceMaterial.name = 'MailboxMetal';
    const built = buildMailboxFromSource(sourceModel(sourceMaterial), atlas);
    const mesh = built.getObjectByProperty('isMesh', true) as THREE.Mesh;

    expect(mesh.castShadow).toBe(false);
    expect(mesh.receiveShadow).toBe(true);
  });

  it('retains vertex color and the shared atlas on the Lambert-compatible Low path', () => {
    setStandardMaterials(false);
    const atlas = new THREE.Texture();
    const sourceMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.84,
      metalness: 0.02,
    });
    sourceMaterial.name = 'MailboxOpaqueLowFixture';
    const built = buildMailboxFromSource(sourceModel(sourceMaterial), atlas);
    const mesh = built.getObjectByProperty('isMesh', true) as THREE.Mesh;
    const material = mesh.material as THREE.MeshLambertMaterial;
    expect(material).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(material.map).toBe(atlas);
    expect(material.vertexColors).toBe(true);
    expect(material.flatShading).toBe(true);
  });

  it('shares prepared resources while keeping unread glow state per mailbox instance', () => {
    const first = buildMailboxPillar(1).group;
    const second = buildMailboxPillar(2).group;
    const firstBody = first.getObjectByProperty('isMesh', true) as THREE.Mesh;
    const secondBody = second.getObjectByProperty('isMesh', true) as THREE.Mesh;
    const firstGlow = first.userData.mailGlow as THREE.Mesh;
    const secondGlow = second.userData.mailGlow as THREE.Mesh;

    expect(first).not.toBe(second);
    expect(first.name).toBe('ravenpostMailbox');
    expect(first.userData.assetUrl).toBe('/models/props/mailbox_pillar.glb');
    expect(firstBody.geometry).toBe(secondBody.geometry);
    expect(firstBody.material).toBe(secondBody.material);
    expect(isSharedGeometry(firstBody.geometry)).toBe(true);
    expect(isSharedMaterial(firstBody.material as THREE.Material)).toBe(true);
    expect(firstGlow).not.toBe(secondGlow);
    expect(firstGlow.geometry).toBe(secondGlow.geometry);
    expect(firstGlow.material).toBe(secondGlow.material);
    expect(firstGlow.visible).toBe(false);
    expect(secondGlow.visible).toBe(false);
    expect(firstGlow.parent?.name).toBe('Socket_UnreadGlow');
    firstGlow.visible = true;
    expect(secondGlow.visible).toBe(false);
  });
});
