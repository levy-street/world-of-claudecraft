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
const ASSET_BYTES = 94_276;
const ASSET_SHA256 = '4316868bb3b5f060870049dccae68670d47c70f75c72d643c41a0d2eb17179ef';
const SOURCE_FINGERPRINT = 'dfd5aa1e92619b97b4979851abfd51efbc70790cd70594b560f2752e79369809';
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

  it('pins the shipped painted model: bytes, sheets, structure, sockets and bounds', async () => {
    // The shipped file is the hand-built painted mailbox now
    // (scripts/assets/eastbrook_houses/props.py mailbox, written over this path by
    // build_props.py on quarter-size maps and shipped by optimise.mjs). The procedural
    // pipeline pinned above made the model it replaced and is kept as its record: do not
    // run its optimizer spec over this file.
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
      ['stone', 'image/ktx2', [256, 256]],
      ['trim', 'image/ktx2', [256, 256]],
      ['slate', 'image/ktx2', [256, 256]],
      ['timber', 'image/ktx2', [256, 256]],
    ]);
    expect(root.listAnimations()).toHaveLength(0);
    expect(root.listSkins()).toHaveLength(0);
    expect(root.listCameras()).toHaveLength(0);
    expect(root.listScenes()).toHaveLength(1);
    expect(root.listNodes()).toHaveLength(3);

    // one model named for its file, and beside it the two anchors the game reads
    const scene = root.listScenes()[0];
    expect(scene.listChildren().map((node) => node.getName())).toEqual([
      'mailbox_pillar',
      'Socket_MailSlot',
      'Socket_UnreadGlow',
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
      if (!position) throw new Error('the mailbox lost its positions');
      triangles += (primitive.getIndices()?.getCount() ?? position.getCount()) / 3;
    }
    expect(triangles).toBe(564);

    const materials = new Map(
      root.listMaterials().map((material) => [material.getName(), material] as const),
    );
    expect([...materials.keys()].sort()).toEqual(['eh_slate', 'eh_stone', 'eh_timber', 'eh_trim']);
    expect(primitives.map((primitive) => primitive.getMaterial()?.getName()).sort()).toEqual(
      [...materials.keys()].sort(),
    );
    for (const material of materials.values()) {
      expect(material.getMetallicFactor()).toBe(0);
      expect(material.getRoughnessFactor()).toBe(0.92);
      expect(material.getBaseColorTexture()).not.toBeNull();
      expect(material.getMetallicRoughnessTexture()).toBeNull();
      expect(material.getAlphaMode()).toBe('OPAQUE');
    }

    // floor-seated and centred, inside the box the release mailbox filled
    const bounds = getBounds(scene);
    expect(bounds.min[0]).toBeCloseTo(-0.825, 3);
    expect(bounds.min[1]).toBeCloseTo(0, 3);
    expect(bounds.min[2]).toBeCloseTo(-0.4198, 3);
    expect(bounds.max[0]).toBeCloseTo(0.825, 3);
    expect(bounds.max[1]).toBeCloseTo(2.2434, 3);
    expect(bounds.max[2]).toBeCloseTo(0.4198, 3);
    expect(bounds.max[1]).toBeLessThanOrEqual(2.9);
    expect(bounds.max[2]).toBeLessThanOrEqual(0.525);

    // the mail slot and the unread glow: bare anchors on the front, inside the model
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
      { name: 'Socket_MailSlot', translation: [0, 1.3075, 0.3097], children: 0, mesh: null },
      { name: 'Socket_UnreadGlow', translation: [0, 1.3075, 0.3441], children: 0, mesh: null },
    ]);
  });
});

describe('Ravenpost mailbox renderer adapter', () => {
  it('drops the immutable loader source after preparing shared resources', () => {
    const source = readFileSync(path.join(REPO_ROOT, 'src/render/mailbox.ts'), 'utf8');
    expect(source).toMatch(/import \{[^}]*\breleaseGltf\b[^}]*\} from '\.\/assets\/loader';/);
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
