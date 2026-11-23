import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { groundImageFor } from '../src/render/assets/ground_textures';
import { acquireTexture } from '../src/render/assets/loader';
import { PlacedAssetsView } from '../src/render/placed_assets';
import { collectPrewarmTextures } from '../src/render/texture_prewarm';
import { applyWallFinishes } from '../src/render/wall_finishes';
import { MODEL_PATH } from '../src/sim/map_doc';

vi.mock('../src/render/assets/ground_textures', () => ({ groundImageFor: vi.fn() }));
vi.mock('../src/render/assets/loader', async (original) => ({
  ...(await original<typeof import('../src/render/assets/loader')>()),
  acquireTexture: vi.fn(),
}));

function wall(): THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> {
  return new THREE.Mesh(
    new THREE.BoxGeometry(4, 3, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x777777 }),
  );
}

function compile(material: THREE.Material): THREE.WebGLProgramParametersWithUniforms {
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  } as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

afterEach(() => vi.clearAllMocks());

describe('wall face finishes', () => {
  it.each(['x', 'z'] as const)(
    'keeps %s-face finishes after real placement tint edits and restores the source on clear',
    async (wallAxis) => {
      const view = new PlacedAssetsView([], 1);
      view.addPlacement(0, {
        path: MODEL_PATH,
        x: 0,
        z: 0,
        rotY: 0,
        scale: 1,
        tint: 0xdddddd,
        building: { id: 'castle', level: 0, kind: 'wall', wallAxis },
        meshes: [{ verts: [0, 0, 0, 4, 0, 0, 0, 3, 0], tris: [0, 1, 2] }],
      });
      const mesh = view.group.children.find(
        (child) => (child as THREE.Mesh).geometry?.getAttribute('position')?.count === 3,
      ) as THREE.Mesh;
      const base = mesh.material as THREE.Material;
      expect(compile(base).vertexShader).toContain('vTriPos');
      view.updatePlacement(0, { wallFinishes: { front: { color: 0x123456 } } });
      await vi.waitFor(() =>
        expect((mesh.material as THREE.Material).customProgramCacheKey()).toContain(
          'wall-finishes',
        ),
      );
      const first = mesh.material;
      view.updatePlacement(0, { tint: 0xabcdef, glow: 0x654321 });
      await vi.waitFor(() => {
        expect(mesh.material).not.toBe(first);
        expect((mesh.material as THREE.Material).customProgramCacheKey()).toContain(
          'wall-finishes',
        );
      });
      const shader = compile(mesh.material as THREE.Material);
      expect(shader.uniforms.uWallFinishTint.value.getHex()).toBe(0xabcdef);
      expect(shader.uniforms.uWallFinishFrontColor.value.getHex()).toBe(0x123456);
      expect(shader.uniforms.uWallFinishAxis.value.toArray()).toEqual(
        wallAxis === 'x' ? [1, 0, 0] : [0, 0, 1],
      );
      view.updatePlacement(0, { wallFinishes: null });
      expect(mesh.material).toBe(base);
      expect(base.customProgramCacheKey()).not.toContain('wall-finishes');
      expect(compile(base).vertexShader).toContain('vTriPos');
      view.dispose();
    },
  );

  it.each(['x', 'z'] as const)(
    'classifies broad %s faces while preserving narrow ends and horizontal caps',
    async (axis) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(axis === 'x' ? 0.3 : 4, 3, axis === 'x' ? 4 : 0.3),
        new THREE.MeshStandardMaterial(),
      );
      const view = applyWallFinishes(
        mesh,
        { front: { color: 0xff0000 }, back: { color: 0x0000ff } },
        undefined,
        undefined,
        axis,
      );
      await view.ready;
      const shader = compile(mesh.material);
      const facing = shader.uniforms.uWallFinishAxis.value as THREE.Vector3;
      expect(facing.toArray()).toEqual(axis === 'x' ? [1, 0, 0] : [0, 0, 1]);
      // Pin the actual fragment block handed to Three, not a TypeScript
      // reimplementation of its predicate. Axis dominance, front/back signs,
      // side enablement and the absence of an end-cap paint arm are all part
      // of this contract. Whitespace and explanatory comments are immaterial.
      const fragment = shader.fragmentShader;
      const start = fragment.indexOf('vec3 wallFinishNormal =');
      const end = fragment.indexOf('#include <alphamap_fragment>', start);
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);
      expect(fragment.split('vec3 wallFinishNormal =')).toHaveLength(2);
      const normalize = (source: string): string =>
        source
          .replace(/\/\/[^\n]*/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      expect(normalize(fragment.slice(start, end))).toBe(
        normalize(`
        vec3 wallFinishNormal = normalize(vWallFinishLocalNormal);
        float wallFinishFacing = dot(wallFinishNormal, uWallFinishAxis);
        float wallFinishEnd = dot(wallFinishNormal, uWallFinishAxis.zyx);
        if (abs(wallFinishFacing) > max(abs(wallFinishEnd), abs(wallFinishNormal.y))) {
          if (wallFinishFacing > 0.0 && uWallFinishEnabled.x > 0.5) {
            vec3 finishColor = uWallFinishFrontColor;
            if (uWallFinishTextured.x > 0.5) finishColor *= wocWallFinishSample(uWallFinishFrontMap, uWallFinishTile.x);
            diffuseColor.rgb = finishColor * uWallFinishTint;
          } else if (wallFinishFacing < 0.0 && uWallFinishEnabled.y > 0.5) {
            vec3 finishColor = uWallFinishBackColor;
            if (uWallFinishTextured.y > 0.5) finishColor *= wocWallFinishSample(uWallFinishBackMap, uWallFinishTile.y);
            diffuseColor.rgb = finishColor * uWallFinishTint;
          }
        }
      `),
      );
      view.dispose();
    },
  );

  it('keeps the live wall untouched until its finish programs and textures are prepared', async () => {
    const mesh = wall();
    const before = mesh.material;
    const dispose = vi.spyOn(before, 'dispose');
    let finishPreparation!: () => void;
    let prepared: THREE.Object3D | undefined;
    const view = applyWallFinishes(
      mesh,
      { front: { color: 0xff0000 }, back: { color: 0x0000ff } },
      async (root) => {
        prepared = root;
        await new Promise<void>((resolve) => {
          finishPreparation = resolve;
        });
      },
    );
    await vi.waitFor(() => expect(prepared).toBeDefined());
    expect(mesh.material).toBe(before);
    finishPreparation();
    await view.ready;
    expect(mesh.material).not.toBe(before);
    const shader = compile(mesh.material);
    expect(shader.uniforms.uWallFinishFrontColor.value.getHex()).toBe(0xff0000);
    expect(shader.uniforms.uWallFinishBackColor.value.getHex()).toBe(0x0000ff);
    expect(shader.fragmentShader).toContain('max(abs(wallFinishEnd), abs(wallFinishNormal.y))');
    expect(shader.fragmentShader).toContain('#include <color_fragment>');
    expect(shader.vertexShader).toContain('modelMatrix * vec4(transformed, 1.0)');
    const owned = vi.spyOn(mesh.material, 'dispose');
    view.dispose();
    expect(mesh.material).toBe(before);
    expect(owned).toHaveBeenCalledOnce();
    expect(dispose).not.toHaveBeenCalled();
  });

  it('uses child-to-placement inverse-transpose normals, independent of placement yaw and scale', async () => {
    const root = new THREE.Group();
    root.rotation.y = 1.2;
    root.scale.set(3, 5, 2);
    root.position.set(20, 30, 40);
    const mesh = wall();
    mesh.rotation.y = Math.PI / 2;
    mesh.scale.set(2, 3, 4);
    root.add(mesh);
    const view = applyWallFinishes(root, { front: { color: 1 } });
    await view.ready;
    const shader = compile(mesh.material);
    const matrix = shader.uniforms.uWallFinishLocalNormal.value as THREE.Matrix3;
    const localSide = new THREE.Vector3(-1, 0, 0).applyMatrix3(matrix).normalize();
    expect(localSide.z).toBeCloseTo(1);
    expect(localSide.x).toBeCloseTo(0);
    view.dispose();
  });

  it('prepares both texture uniforms, shares imported texture wrappers, and disposes on the last release', async () => {
    const bitmap = { width: 16, height: 16, close: vi.fn() };
    vi.mocked(groundImageFor).mockResolvedValue(bitmap as unknown as ImageBitmap);
    const builtin = new THREE.Texture({ width: 16, height: 16 });
    const release = vi.fn();
    vi.mocked(acquireTexture).mockReturnValue({ texture: Promise.resolve(builtin), release });
    const a = wall();
    const b = wall();
    const finishes = {
      front: { texture: `custom:${'c'.repeat(64)}`, tileSize: 2 },
      back: { texture: 'Rock051', tileSize: 8 },
    };
    const av = applyWallFinishes(a, finishes);
    const bv = applyWallFinishes(b, finishes);
    await Promise.all([av.ready, bv.ready]);
    const textures = new Set<THREE.Texture>();
    collectPrewarmTextures(a, textures);
    expect(textures.size).toBe(2);
    expect(textures.has(builtin)).toBe(true);
    const imported = [...textures].find((texture) => texture !== builtin);
    if (!imported) throw new Error('Expected an imported finish texture');
    expect(imported.wrapS).toBe(THREE.RepeatWrapping);
    const dispose = vi.spyOn(imported, 'dispose');
    expect(compile(b.material).uniforms.uWallFinishFrontMap.value).toBe(imported);
    av.dispose();
    expect(dispose).not.toHaveBeenCalled();
    bv.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    expect(bitmap.close).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(2);
  });

  it.each([
    { failure: 'missing', fallback: undefined },
    { failure: 'reject', fallback: undefined },
    { failure: 'missing', fallback: 0 },
    { failure: 'reject', fallback: 0 },
  ] as const)(
    'preserves authored front for $failure art unless color fallback is $fallback',
    async ({ failure, fallback }) => {
      vi.mocked(groundImageFor).mockResolvedValue(null);
      const backTexture = new THREE.Texture({ width: 16, height: 16 });
      vi.mocked(acquireTexture).mockImplementation((path) => ({
        texture: path.includes('Rock051')
          ? Promise.reject(new Error('texture unavailable'))
          : Promise.resolve(backTexture),
        release: vi.fn(),
      }));
      const mesh = wall();
      const originalColor = mesh.material.color.getHex();
      const view = applyWallFinishes(mesh, {
        front: {
          texture: failure === 'missing' ? `custom:${'d'.repeat(64)}` : 'Rock051',
          color: fallback,
        },
        back: { texture: 'Rock052' },
      });
      await view.ready;
      const shader = compile(mesh.material);
      expect(shader.uniforms.uWallFinishEnabled.value.toArray()).toEqual([
        fallback === undefined ? 0 : 1,
        1,
      ]);
      expect(shader.uniforms.uWallFinishTextured.value.toArray()).toEqual([0, 1]);
      expect(shader.uniforms.uWallFinishBackMap.value).toBe(backTexture);
      expect(mesh.material.color.getHex()).toBe(originalColor);
      if (fallback !== undefined)
        expect(shader.uniforms.uWallFinishFrontColor.value.getHex()).toBe(fallback);
      view.dispose();
    },
  );

  it('does not install cancelled finishes or free a material while its preparation is pending', async () => {
    const mesh = wall();
    const before = mesh.material;
    let settle!: () => void;
    let stagedMat: THREE.Material | undefined;
    const view = applyWallFinishes(mesh, { front: { color: 0x123456 } }, async (root) => {
      stagedMat = (root.children[0] as THREE.Mesh).material as THREE.Material;
      await new Promise<void>((resolve) => {
        settle = resolve;
      });
    });
    await vi.waitFor(() => expect(stagedMat).toBeDefined());
    if (!stagedMat) throw new Error('Expected a staged finish material');
    const dispose = vi.spyOn(stagedMat, 'dispose');
    view.dispose();
    expect(dispose).not.toHaveBeenCalled();
    settle();
    await view.ready;
    expect(mesh.material).toBe(before);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('preserves procedural hooks and shares one finish program across colors and sides', async () => {
    const a = wall();
    a.material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        '// authored projection',
      );
    };
    a.material.customProgramCacheKey = () => 'existing-projection';
    const b = new THREE.Mesh(a.geometry, a.material);
    const av = applyWallFinishes(a, { front: { color: 0xff0000 } });
    const bv = applyWallFinishes(b, { back: { color: 0x00ff00 } });
    await Promise.all([av.ready, bv.ready]);
    expect(a.material.customProgramCacheKey()).toBe(b.material.customProgramCacheKey());
    const shader = compile(a.material);
    expect(shader.fragmentShader).toContain('// authored projection');
    expect(shader.fragmentShader).toContain('diffuseColor.rgb = finishColor * uWallFinishTint');
    av.dispose();
    bv.dispose();
  });
});
