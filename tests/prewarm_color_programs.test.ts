import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { compileColorVariants } from '../src/render/prewarm_color_programs';

describe('colour program prewarm', () => {
  it('restores the live target before an asynchronous link settles and warms both direct variants', async () => {
    const live = new THREE.WebGLRenderTarget(2, 2);
    const offscreen = new THREE.WebGLRenderTarget(8, 8);
    let current: THREE.WebGLRenderTarget | null = live;
    let resolve!: (root: THREE.Object3D) => void;
    const targets: (THREE.WebGLRenderTarget | null)[] = [];
    const renderer = {
      getRenderTarget: () => current,
      setRenderTarget: (value: THREE.WebGLRenderTarget | null) => {
        current = value;
      },
      compileAsync: vi.fn(() => {
        targets.push(current);
        return targets.length === 1
          ? new Promise<THREE.Object3D>((r) => {
              resolve = r;
            })
          : Promise.resolve(new THREE.Group());
      }),
    };
    const root = new THREE.Group();
    const task = compileColorVariants(
      renderer as unknown as THREE.WebGLRenderer,
      new THREE.PerspectiveCamera(),
      new THREE.Scene(),
      root,
      offscreen,
      false,
      true,
    );
    expect(current).toBe(live);
    resolve(root);
    await task;
    expect(targets).toEqual([null, offscreen]);
    expect(current).toBe(live);
    live.dispose();
    offscreen.dispose();
  });
  it('restores the live target if compilation throws', async () => {
    const live = new THREE.WebGLRenderTarget(2, 2);
    let current: THREE.WebGLRenderTarget | null = live;
    const renderer = {
      getRenderTarget: () => current,
      setRenderTarget: (value: THREE.WebGLRenderTarget | null) => {
        current = value;
      },
      compileAsync: () => {
        throw new Error('driver failed');
      },
    };
    await expect(
      compileColorVariants(
        renderer as unknown as THREE.WebGLRenderer,
        new THREE.PerspectiveCamera(),
        new THREE.Scene(),
        new THREE.Group(),
        null,
        false,
        false,
      ),
    ).rejects.toThrow('driver failed');
    expect(current).toBe(live);
    live.dispose();
  });
});
