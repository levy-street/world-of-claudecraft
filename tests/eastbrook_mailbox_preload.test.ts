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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: mocks.loadGltf,
  loadTexture: mocks.loadTexture,
  releaseGltf: mocks.releaseGltf,
}));

vi.mock('../src/render/assets/preload', () => ({
  registerPreload: mocks.registerPreload,
  // Deferred lane: start the thunk immediately so these registration-order and
  // asset-set assertions observe the same promises the eager lane produced.
  registerDeferredPreload: (start: () => Promise<unknown>) => mocks.registerPreload(start()),
}));

function sourceScene(): THREE.Group {
  const scene = new THREE.Group();
  for (const [name, color, size, position] of [
    ['MailboxOpaque', 0x4c3829, [1.65, 2.9, 1.05], [0, 1.45, 0]],
    ['MailboxMetal', 0xa27320, [0.5, 0.3, 0.1], [0, 1.9, 0.52]],
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
    mesh.name = name;
    mesh.position.fromArray(position);
    scene.add(mesh);
  }
  const unreadSocket = new THREE.Object3D();
  unreadSocket.name = 'Socket_UnreadGlow';
  unreadSocket.position.set(0, 1.62, 0.478);
  scene.add(unreadSocket);
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

describe('Eastbrook mailbox tier-independent preload', () => {
  it.each([
    ['Low', '?gfx=low', THREE.MeshLambertMaterial],
    ['Ultra', '?gfx=ultra', THREE.MeshStandardMaterial],
  ] as const)(
    'preloads the shipping GLB and shared atlas on %s',
    async (_tier, search, MaterialType) => {
      vi.stubGlobal('window', { location: { search } });
      vi.stubGlobal('location', { search });
      const scene = sourceScene();
      const gltfLoad = deferred<{ scene: THREE.Group }>();
      mocks.loadGltf.mockReturnValue(gltfLoad.promise);
      const atlas = new THREE.Texture();
      const textureLoad = deferred<THREE.Texture>();
      mocks.loadTexture.mockReturnValue(textureLoad.promise);

      const module = await import('../src/render/mailbox');

      expect(mocks.loadGltf).toHaveBeenCalledTimes(1);
      expect(mocks.loadGltf).toHaveBeenCalledWith('/models/props/mailbox_pillar.glb');
      const atlasLoads = mocks.loadTexture.mock.calls
        .map(([url], index) => ({
          url,
          order: mocks.loadTexture.mock.invocationCallOrder[index],
        }))
        .filter(({ url }) => url === '/textures/eastbrook_surface_atlas.webp');
      expect(atlasLoads.map(({ url }) => url)).toEqual(['/textures/eastbrook_surface_atlas.webp']);
      const registrationOrders = new Set(mocks.registerPreload.mock.invocationCallOrder);
      expect(registrationOrders).toContain(mocks.loadGltf.mock.invocationCallOrder[0] + 1);
      expect(registrationOrders).toContain(atlasLoads[0].order + 1);
      let gateSettled = false;
      const gate = Promise.all(
        mocks.registerPreload.mock.calls.map(([registered]) => registered),
      ).then(() => {
        gateSettled = true;
      });
      await Promise.resolve();
      expect(gateSettled).toBe(false);
      gltfLoad.resolve({ scene });
      await Promise.resolve();
      expect(gateSettled).toBe(false);
      textureLoad.resolve(atlas);
      await gate;

      const first = module.buildMailboxPillar(101).group;
      const second = module.buildMailboxPillar(202).group;
      expect(first).not.toBe(second);
      expect(first.name).toBe('ravenpostMailbox');
      expect(first.userData).toMatchObject({
        assetUrl: '/models/props/mailbox_pillar.glb',
        source: 'procedural-glb',
        eastbrookSurfaceAtlas: {
          url: '/textures/eastbrook_surface_atlas.webp',
          textureUuid: atlas.uuid,
          materialBindings: 2,
        },
      });

      const firstBodies = meshesOf(first).filter((mesh) => mesh.name !== 'ravenpostUnreadGlow');
      const secondBodies = meshesOf(second).filter((mesh) => mesh.name !== 'ravenpostUnreadGlow');
      expect(firstBodies).toHaveLength(2);
      expect(secondBodies).toHaveLength(2);
      for (let index = 0; index < firstBodies.length; index++) {
        expect(firstBodies[index].material).toBeInstanceOf(MaterialType);
        expect(firstBodies[index].geometry).toBe(secondBodies[index].geometry);
        expect(firstBodies[index].material).toBe(secondBodies[index].material);
      }
      const firstGlow = first.userData.mailGlow as THREE.Mesh;
      const secondGlow = second.userData.mailGlow as THREE.Mesh;
      expect(firstGlow.name).toBe('ravenpostUnreadGlow');
      expect(firstGlow.parent?.name).toBe('Socket_UnreadGlow');
      expect(firstGlow.visible).toBe(false);
      expect(firstGlow.position.y).toBe(0);
      expect(firstGlow.userData.mailGlowBaseLocalY).toBe(0);
      expect(firstGlow.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(1.62, 6);
      firstGlow.position.y = firstGlow.userData.mailGlowBaseLocalY - 0.06;
      expect(firstGlow.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(1.56, 6);
      firstGlow.position.y = firstGlow.userData.mailGlowBaseLocalY + 0.06;
      expect(firstGlow.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(1.68, 6);
      expect(firstGlow.getWorldPosition(new THREE.Vector3()).y).toBeLessThan(2);
      firstGlow.position.y = firstGlow.userData.mailGlowBaseLocalY;
      expect(firstGlow).not.toBe(secondGlow);
      expect(firstGlow.geometry).toBe(secondGlow.geometry);
      expect(firstGlow.material).toBe(secondGlow.material);
      expect(mocks.releaseGltf).toHaveBeenCalledTimes(1);
      expect(mocks.releaseGltf).toHaveBeenCalledWith('/models/props/mailbox_pillar.glb');
    },
  );

  it('pins Renderer.createView to the shipping mailbox module without generic sparkle', () => {
    const source = readFileSync(path.join(__dirname, '../src/render/renderer.ts'), 'utf8');
    expect(source).toContain("import { buildMailboxPillar } from './mailbox';");
    const start = source.indexOf("e.templateId === 'mailbox'");
    const end = source.indexOf("e.templateId === 'noticeboard_eastbrook'", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const branch = source.slice(start, end);
    expect(branch).toContain('const built = buildMailboxPillar(e.id);');
    expect(branch).toContain('body = built.group;');
    expect(branch).toContain('height = built.height;');
    expect(branch).toContain('objectMesh = body!;');
    expect(branch).not.toContain('sparkleTexture');
    expect(branch).not.toContain('new THREE.Sprite');
  });

  it('bobs unread glow from its socket-local base instead of adding mailbox height twice', () => {
    const source = readFileSync(path.join(__dirname, '../src/render/renderer.ts'), 'utf8');
    const start = source.indexOf("if (vis && e.templateId === 'mailbox')");
    const end = source.indexOf('\n        continue;', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const branch = source.slice(start, end);
    const baseAt = branch.indexOf('const baseLocalY = glow.userData.mailGlowBaseLocalY as number;');
    const bobAt = branch.indexOf(
      'glow.position.y = baseLocalY + Math.sin(this.time * 2.4 + e.id) * 0.06;',
    );
    expect(baseAt).toBeGreaterThan(-1);
    expect(bobAt).toBeGreaterThan(baseAt);
    expect(branch).not.toContain('1.62 + Math.sin');
  });
});
