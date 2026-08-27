import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type CompileArmHost,
  linkColorPrograms,
  setCompileArmObserver,
} from '../src/render/compile_arms';
import type { DryProgramSource } from '../src/render/program_sources';
import { disposeRendererPrewarmAndGroundFx } from '../src/render/renderer_resource_lifecycle';
import {
  expectRootProgramSources,
  resetShaderWarmAuditForTest,
  shaderWarmAuditSnapshot,
} from '../src/render/shader_warm_audit';

afterEach(() => {
  resetShaderWarmAuditForTest();
  setCompileArmObserver(null);
});

/** A minimal arms host the shader warm audit can announce and link through. */
function auditArmHost(sources: DryProgramSource[]): CompileArmHost {
  let current: THREE.WebGLRenderTarget | null = null;
  const scene = new THREE.Scene();
  const webgl = {
    getRenderTarget: () => current,
    setRenderTarget: (target: THREE.WebGLRenderTarget | null) => {
      current = target;
    },
    compileAsync: () => Promise.resolve(scene),
    collectProgramSources: () => sources,
  };
  return {
    webgl: () => webgl,
    camera: () => new THREE.PerspectiveCamera(),
    scene: () => scene,
    shadowCamera: () => new THREE.OrthographicCamera(),
    offscreen: () => false,
    offscreenTarget: () => ({}) as THREE.WebGLRenderTarget,
    depthMaterials: () => new Map(),
    shadowArm: () => false,
  };
}

function auditRoot(name: string): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  group.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial()));
  return group;
}

describe('renderer resource lifecycle', () => {
  it('keeps every renderer-owned VFX owner independent at the lifecycle seam', () => {
    const depthMaterial = {
      dispose: vi.fn(() => {
        throw new Error('depth');
      }),
    };
    const mageGroundFx = {
      dispose: vi.fn(() => {
        throw new Error('mage');
      }),
    };
    const warlockMeteorFx = { dispose: vi.fn() };
    const abilityVfxFx = { dispose: vi.fn() };
    const vfx = { dispose: vi.fn() };
    const prewarmDepthMaterials = new Map([['depth', depthMaterial]]);
    const errors: unknown[] = [];
    const bestEffort = (cleanup: () => void): void => {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    };

    disposeRendererPrewarmAndGroundFx(
      { prewarmDepthMaterials, mageGroundFx, warlockMeteorFx, abilityVfxFx, vfx },
      bestEffort,
    );

    expect(depthMaterial.dispose).toHaveBeenCalledOnce();
    expect(mageGroundFx.dispose).toHaveBeenCalledOnce();
    expect(warlockMeteorFx.dispose).toHaveBeenCalledOnce();
    expect(abilityVfxFx.dispose).toHaveBeenCalledOnce();
    expect(vfx.dispose).toHaveBeenCalledOnce();
    expect(prewarmDepthMaterials.size).toBe(0);
    expect(errors).toHaveLength(2);
  });

  it('runs generic VFX cleanup even when a ground owner fails', () => {
    const mageGroundFx = {
      dispose: vi.fn(() => {
        throw new Error('mage');
      }),
    };
    const vfx = { dispose: vi.fn() };
    const abilityVfxFx = { dispose: vi.fn() };
    const errors: unknown[] = [];
    const bestEffort = (cleanup: () => void): void => {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    };

    disposeRendererPrewarmAndGroundFx(
      { prewarmDepthMaterials: new Map(), mageGroundFx, vfx, abilityVfxFx },
      bestEffort,
    );

    expect(mageGroundFx.dispose).toHaveBeenCalledOnce();
    expect(vfx.dispose).toHaveBeenCalledOnce();
    expect(abilityVfxFx.dispose).toHaveBeenCalledOnce();
    expect(errors).toHaveLength(1);
  });

  it('lets the shader warm audit go with the renderer it was listening to', async () => {
    // Observed through the audit's own readout rather than a spy: the audit
    // holds THIS renderer's compile arms and listens to its links, so a
    // lifecycle that forgets to release it would keep re-checking a dead
    // renderer and keep naming its roots.
    resetShaderWarmAuditForTest('?perf');
    const host = auditArmHost([
      {
        cacheKey: 'k',
        name: 'physical',
        vertexGlsl: 'v',
        fragmentGlsl: 'f',
        index0Attribute: 'position',
      },
    ]);
    const first = auditRoot('kit');
    const second = auditRoot('kit-two');
    expectRootProgramSources(host, first);
    expectRootProgramSources(host, second);
    await linkColorPrograms(host, first, false);
    expect(shaderWarmAuditSnapshot().linkedLabels).toEqual(['kit']);

    const errors: unknown[] = [];
    disposeRendererPrewarmAndGroundFx({ prewarmDepthMaterials: new Map() }, (cleanup) => {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    });
    expect(errors).toEqual([]);

    await linkColorPrograms(host, second, false);
    expect(shaderWarmAuditSnapshot().linkedLabels).toEqual(['kit']);
  });
});
