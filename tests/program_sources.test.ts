// The dry compile's consumer (src/render/program_sources.ts): the sources a
// root would link, read under the colour and shadow arms' own state, deduped
// by cache key, and nothing at all without the three patch.

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { CompileArmHost } from '../src/render/compile_arms';
import {
  collectRootProgramSources,
  type DryProgramSource,
  dryCompileSupported,
} from '../src/render/program_sources';

function host(options: {
  offscreen?: boolean;
  shadowArm?: boolean;
  collect?: (
    scene: THREE.Object3D,
    camera: THREE.Camera,
    target: THREE.Scene,
  ) => DryProgramSource[];
}): {
  host: CompileArmHost;
  calls: string[];
  /** Every setRenderTarget the arms made: an untouched renderer and one that
   *  bound and restored share an END state, so only the log tells them apart. */
  targetLog: string[];
  liveTarget: THREE.WebGLRenderTarget;
  target: () => THREE.WebGLRenderTarget | null;
} {
  const calls: string[] = [];
  const targetLog: string[] = [];
  const liveTarget = { name: 'live' } as unknown as THREE.WebGLRenderTarget;
  let current: THREE.WebGLRenderTarget | null = liveTarget;
  const offscreenTarget = { name: 'offscreen' } as unknown as THREE.WebGLRenderTarget;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000000, 1, 2);
  const camera = new THREE.PerspectiveCamera();
  camera.name = 'world';
  const shadowCamera = new THREE.OrthographicCamera();
  shadowCamera.name = 'shadow';
  const webgl = {
    getRenderTarget: () => current,
    setRenderTarget: (target: THREE.WebGLRenderTarget | null) => {
      current = target;
      targetLog.push((target as { name?: string } | null)?.name ?? 'canvas');
    },
    compileAsync: vi.fn(),
    ...(options.collect
      ? {
          collectProgramSources: (
            root: THREE.Object3D,
            cam: THREE.Camera,
            target: THREE.Scene,
          ): DryProgramSource[] => {
            calls.push(
              `${cam.name}:${(current as { name?: string } | null)?.name ?? 'canvas'}:${target.fog ? 'fog' : 'nofog'}`,
            );
            return options.collect?.(root, cam, target) ?? [];
          },
        }
      : {}),
  };
  return {
    calls,
    targetLog,
    liveTarget,
    target: () => current,
    host: {
      webgl: () => webgl,
      camera: () => camera,
      scene: () => scene,
      shadowCamera: () => shadowCamera,
      offscreen: () => options.offscreen ?? false,
      offscreenTarget: () => offscreenTarget,
      depthMaterials: () => new Map(),
      shadowArm: () => options.shadowArm ?? true,
    },
  };
}

function source(cacheKey: string, name = 'MeshStandardMaterial'): DryProgramSource {
  return {
    cacheKey,
    name,
    vertexGlsl: `v:${cacheKey}`,
    fragmentGlsl: `f:${cacheKey}`,
    index0Attribute: 'position',
  };
}

function meshRoot(): THREE.Group {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial()));
  return root;
}

describe('dryCompileSupported', () => {
  it('is true only for a renderer carrying the patch method', () => {
    expect(dryCompileSupported({ collectProgramSources: () => [] })).toBe(true);
    expect(dryCompileSupported({})).toBe(false);
    expect(dryCompileSupported(null)).toBe(false);
  });
});

describe('collectRootProgramSources', () => {
  it('reports nothing without the patch, and writes neither the target nor a material', () => {
    const h = host({});
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
    root.add(mesh);
    const original = mesh.material;
    // An arm that ran and restored would leave the SAME end state, so the
    // writes themselves are what has to be zero: an unpatched renderer must
    // not pay a depth-twin swap or a framebuffer rebind for nothing.
    let materialWrites = 0;
    let held: THREE.Material | THREE.Material[] = original;
    Object.defineProperty(mesh, 'material', {
      configurable: true,
      get: () => held,
      set: (next: THREE.Material | THREE.Material[]) => {
        materialWrites++;
        held = next;
      },
    });
    expect(collectRootProgramSources(h.host, root)).toEqual([]);
    expect(h.calls).toEqual([]);
    expect(h.targetLog).toEqual([]);
    expect(materialWrites).toBe(0);
    expect(h.target()).toBe(h.liveTarget);
    expect(mesh.material).toBe(original);
  });

  it('reads under the colour arm then the shadow arm, in their own state', () => {
    const h = host({ offscreen: true, collect: (_root, camera) => [source(`${camera.name}`)] });
    const entries = collectRootProgramSources(h.host, meshRoot());
    expect(h.calls).toEqual(['world:offscreen:fog', 'shadow:offscreen:nofog']);
    expect(entries.map((entry) => entry.cacheKey)).toEqual(['world', 'shadow']);
  });

  it('covers the canvas variant, and the offscreen one on request, on a direct tier', () => {
    const h = host({ offscreen: false, shadowArm: false, collect: () => [] });
    collectRootProgramSources(h.host, meshRoot());
    expect(h.calls).toEqual(['world:canvas:fog']);
    h.calls.length = 0;
    collectRootProgramSources(h.host, meshRoot(), true);
    expect(h.calls).toEqual(['world:canvas:fog', 'world:offscreen:fog']);
  });

  it('dedupes by cache key across arms and maps the fields', () => {
    const h = host({
      collect: (_root, camera) => [
        source('shared'),
        source(`${camera.name}-own`, 'MeshDepthMaterial'),
      ],
    });
    const entries = collectRootProgramSources(h.host, meshRoot());
    expect(entries.map((entry) => entry.cacheKey)).toEqual(['shared', 'world-own', 'shadow-own']);
    expect(entries[0]).toEqual({
      cacheKey: 'shared',
      name: 'MeshStandardMaterial',
      vertex: 'v:shared',
      fragment: 'f:shared',
      index0Attribute: 'position',
    });
    expect(entries[2]?.name).toBe('MeshDepthMaterial');
  });
});
