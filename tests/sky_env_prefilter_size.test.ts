import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// One cubeUV height per session. PMREMGenerator sizes its prefiltered target
// from the SOURCE width (_fromTexture: _setSize(image.width / 4) for an
// equirect), and envMapCubeUVHeight is a program-cache-key input three
// re-reads with no material.needsUpdate anywhere, so two differently sized env
// sources make a biome crossing relink every lit material in the scene: the
// relink storm that costs measured 1.1 to 1.4 s on the far-bake PR. The PMREM
// itself needs a GL context, so the invariant is pinned one level up, on the
// widths envTexture is willing to hand ensureEnvironmentBiome, plus a source
// pin that it still derives its target from exactly that texture.
const ENV_WIDTH = 512;
const DOME_WIDTH = 2048;

const loadTexture = vi.fn(async () => new THREE.Texture());
const releaseKtx2Texture = vi.fn((_url: string, _opts?: { repeat?: boolean }) => undefined);
const releaseTexture = vi.fn();

function compressed(width: number): THREE.CompressedTexture {
  return new THREE.CompressedTexture([], width, width / 2);
}

// The dome and the env arm settle independently: resolve the dome at `width`,
// hang the 512 arm, which is also what an eviction under memory pressure
// leaves behind.
const loadKtx2Texture = vi.fn(async (_url: string, _opts?: { repeat?: boolean; large?: boolean }) =>
  compressed(DOME_WIDTH),
);
function strandTheEnvArm(domeWidth: number): void {
  loadKtx2Texture.mockImplementation((url) =>
    url.includes('_512.ktx2')
      ? new Promise<THREE.CompressedTexture>(() => {})
      : Promise.resolve(compressed(domeWidth)),
  );
}

describe('the env PMREM source width', () => {
  beforeEach(() => {
    vi.resetModules();
    loadKtx2Texture.mockClear();
    loadKtx2Texture.mockImplementation(async () => compressed(DOME_WIDTH));
    loadTexture.mockClear();
    releaseKtx2Texture.mockClear();
    releaseTexture.mockClear();
    vi.doMock('../src/render/gfx', () => ({ GFX: { standardMaterials: true } }));
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn(),
      loadKtx2Texture,
      loadTexture,
      releaseGltf: vi.fn(),
      releaseKtx2Texture,
      releaseTexture,
    }));
    vi.doMock('../src/render/textures', () => ({
      cloudTexture: vi.fn(() => new THREE.Texture()),
      skyTexture: vi.fn(() => new THREE.Texture()),
    }));
  });

  it('prefilters NOTHING from a dome wider than the env source', async () => {
    const sky = await import('../src/render/sky');
    const biomes = sky.skyBiomesAt(0, 0);
    strandTheEnvArm(DOME_WIDTH);

    void sky.ensureSkyBiomeAssets(biomes);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const view = sky.buildSky(false, new THREE.Vector3(90, 140, 50));

    for (const biome of biomes) {
      // The dome itself IS resident: the null comes from its width, not from a
      // biome that never landed. Null skips this biome's prefilter and leaves
      // the previous IBL lighting the scene, rather than minting a prefilter
      // at a second cubeUV height and relinking every lit material on the
      // crossing (and caching the wrong-size one for the session).
      expect(view.domeTexture(biome)).not.toBeNull();
      expect(view.envTexture(biome)).toBeNull();
    }
  });

  it('hands back the dome ITSELF when it is already no wider than the env source', async () => {
    const sky = await import('../src/render/sky');
    strandTheEnvArm(ENV_WIDTH);

    void sky.ensureSkyBiomeAssets(['vale', 'marsh']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const view = sky.buildSky(false, new THREE.Vector3(90, 140, 50), 0, 40);

    // Same width, so the prefilter reads the dome blocks at exactly the one
    // session width and no crossing can change the cubeUV height.
    const source = view.envTexture('marsh');
    expect(source).toBe(view.domeTexture('marsh'));
    expect(((source as THREE.Texture).image as { width: number }).width).toBe(ENV_WIDTH);
  });

  it('takes the shipped 512 arm over the dome once it lands', async () => {
    const sky = await import('../src/render/sky');
    loadKtx2Texture.mockImplementation(async (url: string) =>
      compressed(url.includes('_512.ktx2') ? ENV_WIDTH : DOME_WIDTH),
    );

    await sky.ensureSkyBiomeAssets(['vale', 'marsh']);
    const view = sky.buildSky(false, new THREE.Vector3(90, 140, 50), 0, 40);

    const source = view.envTexture('marsh');
    expect(source).not.toBeNull();
    expect(source).not.toBe(view.domeTexture('marsh'));
    expect(((source as THREE.Texture).image as { width: number }).width).toBe(ENV_WIDTH);
  });

  it('still prefilters exactly the texture envTexture hands it', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const start = source.indexOf('private ensureEnvironmentBiome(');
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf('\n  }', start));
    expect(body).toContain('const source = this.skyView.envTexture(biome);');
    expect(body).toContain('this.pmremGenerator.fromEquirectangular(source)');
  });

  it('sizes the zero-env fromScene fallback like a 512-wide equirect', () => {
    // fromScene defaults to size 256 (cubeUV height 1024) while a 512-wide
    // equirect prefilters at 128 (height 512): a session that boots on the
    // fallback and later gets a real prefilter would relink every lit material.
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const calls = source.split('this.pmremGenerator.fromScene(').length - 1;
    expect(calls).toBe(1);
    expect(source).toContain(
      'this.pmremGenerator.fromScene(envScene, 0.04, 0.1, 1100, { size: 128 })',
    );
  });
});
