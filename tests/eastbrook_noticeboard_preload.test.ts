import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadGltf: vi.fn(),
  loadTexture: vi.fn(),
  releaseGltf: vi.fn(),
  registerPreload: vi.fn(),
}));

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: mocks.loadGltf,
  loadTexture: mocks.loadTexture,
  releaseGltf: mocks.releaseGltf,
}));

vi.mock('../src/render/assets/preload', () => ({
  registerPreload: mocks.registerPreload,
}));

function sourceScene(): THREE.Group {
  const scene = new THREE.Group();
  for (const [name, color, size] of [
    ['EastbrookNoticeboardSurface', 0x33251c, [2.4, 2.6, 0.6]],
    ['EastbrookNoticeboardHardware', 0xb48335, [0.3, 0.3, 0.1]],
  ] as const) {
    const geometry = new THREE.BoxGeometry(...size);
    const tint = new THREE.Color(color);
    const colors = new Float32Array(geometry.getAttribute('position').count * 3);
    for (let index = 0; index < colors.length; index += 3) {
      colors[index] = tint.r;
      colors[index + 1] = tint.g;
      colors[index + 2] = tint.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.MeshStandardMaterial({ vertexColors: true });
    material.name = name;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = name.endsWith('Surface') ? 1.3 : 1.5;
    scene.add(mesh);
  }
  return scene;
}

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  return meshes;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});

describe('Eastbrook noticeboard tier-independent preload', () => {
  it.each([
    ['Low', '?gfx=low', THREE.MeshLambertMaterial],
    ['Ultra', '?gfx=ultra', THREE.MeshStandardMaterial],
  ] as const)(
    'preloads the exact GLB and shared atlas on %s',
    async (_tier, search, MaterialType) => {
      vi.stubGlobal('window', { location: { search } });
      vi.stubGlobal('location', { search });
      mocks.loadGltf.mockResolvedValue({ scene: sourceScene() });
      const atlas = new THREE.Texture();
      mocks.loadTexture.mockResolvedValue(atlas);

      const module = await import('../src/render/noticeboard');

      expect(mocks.loadGltf).toHaveBeenCalledTimes(1);
      expect(mocks.loadGltf).toHaveBeenCalledWith('/models/props/eastbrook_noticeboard.glb');
      expect(mocks.loadTexture).toHaveBeenCalledTimes(1);
      expect(mocks.loadTexture).toHaveBeenCalledWith('/textures/eastbrook_surface_atlas.webp');
      expect(mocks.registerPreload).toHaveBeenCalledTimes(2);
      await Promise.all(mocks.registerPreload.mock.calls.map(([registered]) => registered));

      const first = module.buildEastbrookNoticeboard().group;
      const second = module.buildEastbrookNoticeboard().group;
      expect(first).not.toBe(second);
      expect(first.name).toBe('eastbrookNoticeboard');
      expect(first.userData).toMatchObject({
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
      const firstMeshes = meshesOf(first);
      const secondMeshes = meshesOf(second);
      expect(firstMeshes).toHaveLength(2);
      expect(secondMeshes).toHaveLength(2);
      for (let index = 0; index < firstMeshes.length; index++) {
        expect(firstMeshes[index].material).toBeInstanceOf(MaterialType);
        expect(firstMeshes[index].geometry).toBe(secondMeshes[index].geometry);
        expect(firstMeshes[index].material).toBe(secondMeshes[index].material);
      }
      expect(mocks.releaseGltf).toHaveBeenCalledTimes(1);
      expect(mocks.releaseGltf).toHaveBeenCalledWith('/models/props/eastbrook_noticeboard.glb');
    },
  );

  it('pins Renderer.createView to the dedicated tier-independent body without generic sparkle', () => {
    const source = readFileSync(path.join(__dirname, '../src/render/renderer.ts'), 'utf8');
    expect(source).toContain("import { buildEastbrookNoticeboard } from './noticeboard';");
    const start = source.indexOf("e.templateId === 'noticeboard_eastbrook'");
    const end = source.indexOf("e.templateId?.startsWith('delve_')", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const branch = source.slice(start, end);
    expect(branch).toContain('const built = buildEastbrookNoticeboard();');
    expect(branch).toContain('body = built.group;');
    expect(branch).toContain('height = built.height;');
    expect(branch).toContain('objectMesh = body!;');
    expect(branch).not.toContain('sparkleTexture');
    expect(branch).not.toContain('new THREE.Sprite');
  });
});
