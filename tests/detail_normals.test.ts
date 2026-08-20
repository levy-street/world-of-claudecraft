import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';
import { tsFilesUnder } from './helpers/ts_files_under';

// The shared stone detail normal has TWO arms: null until its deferred preload
// lands, a texture afterwards. Consumers that put it in a material SLOT form a
// program cache key with it, so a material built on the early arm links a
// variant the prewarm never warmed and the first live draw pays for it. The
// preload therefore has to be resolved before the first such consumer builds,
// and the arm has to be one texture for the session.
const loadKtx2Texture = vi.fn(async () => new THREE.Texture());
const registerDeferredPreload = vi.fn((_thunk: () => Promise<unknown>) => undefined);

describe('the shared stone detail normal', () => {
  beforeEach(() => {
    vi.resetModules();
    loadKtx2Texture.mockClear();
    registerDeferredPreload.mockClear();
    vi.doMock('../src/render/assets/loader', () => ({ loadKtx2Texture }));
    vi.doMock('../src/render/assets/preload', () => ({ registerDeferredPreload }));
    vi.doMock('../src/render/gfx', () => ({ GFX: { standardMaterials: true } }));
  });

  it('registers its preload and resolves to ONE texture, however often it is asked', async () => {
    const detail = await import('../src/render/detail_normals');

    // Registered in the DEFERRED lane, which startGame awaits (assetsReady)
    // before any world content builds.
    expect(registerDeferredPreload).toHaveBeenCalledTimes(1);
    expect(detail.stoneDetailNormal()).toBeNull();

    await detail.prepareStoneDetailProfileAssets({ standardMaterials: true } as never);
    const first = detail.stoneDetailNormal();
    expect(first).not.toBeNull();
    expect(loadKtx2Texture).toHaveBeenCalledTimes(1);

    // A second prepare is a no-op: a second clone would be a second normalMap
    // uuid, which is a second surfaceMat cache entry and a second program.
    await detail.prepareStoneDetailProfileAssets({ standardMaterials: true } as never);
    expect(detail.stoneDetailNormal()).toBe(first);
    expect(loadKtx2Texture).toHaveBeenCalledTimes(1);
  });

  it('loads nothing on the Lambert tier, where no material reads it', async () => {
    const detail = await import('../src/render/detail_normals');

    await detail.prepareStoneDetailProfileAssets({ standardMaterials: false } as never);

    expect(loadKtx2Texture).not.toHaveBeenCalled();
    expect(detail.stoneDetailNormal()).toBeNull();
  });
});

// Every consumer, and what it does with the texture. A `material-slot` consumer
// forms a program key with it, so it must ALSO register the prepare in its own
// deferred preload: nothing else pins that its materials are built after the
// arm settles. A `uniform` consumer swaps it into a live uniform and gates it
// with an amount, which changes no program key and can adopt it any frame.
const STONE_DETAIL_CONSUMERS: Record<string, 'material-slot' | 'uniform'> = {
  'delve_props.ts': 'material-slot',
  'far_terrain.ts': 'uniform',
};

describe('stoneDetailNormal consumers', () => {
  const root = new URL('../src/render/', import.meta.url);
  const files = tsFilesUnder(fileURLToPath(root));

  it('scans the whole render tree', () => {
    // Vacuity floor: the walk is recursive over a deep root, so a real count
    // pins it directly (tests/CLAUDE.md).
    expect(files.length).toBeGreaterThan(300);
  });

  it('registers every consumer, and preloads the ones that form a program key', () => {
    const found = new Map<string, string>();
    for (const { file, full } of files) {
      if (file === 'detail_normals.ts') continue;
      // Full-line // comments go first: both the consumer scan and the
      // preload pin below are single lines of code the tree explains in prose
      // right beside them, so a raw read would credit the prose.
      const source = codeWithoutLineComments(readFileSync(full, 'utf8'));
      if (source.includes('stoneDetailNormal(')) found.set(file, source);
    }

    expect([...found.keys()].sort()).toEqual(Object.keys(STONE_DETAIL_CONSUMERS).sort());
    for (const [file, source] of found) {
      if (STONE_DETAIL_CONSUMERS[file] !== 'material-slot') continue;
      expect(source, `${file} keys a material on the detail normal`).toContain(
        'registerDeferredPreload(() => prepareStoneDetailProfileAssets(GFX))',
      );
    }
  });
});
