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
import {
  resetShaderWarmForTest,
  shaderWarmDecide,
  shaderWarmSnapshot,
} from '../src/render/shader_warm_client';
import type { ShaderWarmWorkerMessage } from '../src/render/shader_warm_protocol';

afterEach(() => {
  resetShaderWarmAuditForTest();
  resetShaderWarmForTest();
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

  it('drains the battleground copies the teardown catches standing', () => {
    // Each copy owns a field's terrain, its paint array texture, the placement
    // instances, the decals and its share of the point-light budget; the map
    // outlives nothing, so the terminal teardown is what releases whatever the
    // session had not already resolved.
    const played = { dispose: vi.fn() };
    const prebuilt = { dispose: vi.fn() };
    const bgViews = new Map([
      [0, prebuilt],
      [1, played],
    ]);

    disposeRendererPrewarmAndGroundFx({ prewarmDepthMaterials: new Map(), bgViews }, (cleanup) =>
      cleanup(),
    );

    expect(prebuilt.dispose).toHaveBeenCalledOnce();
    expect(played.dispose).toHaveBeenCalledOnce();
    expect(bgViews.size).toBe(0);
  });

  it('drains every battleground copy when one of them fails to release', () => {
    // The map is drained at teardown whatever one copy does: a throw inside
    // one field's release must not strand the next one's terrain, textures
    // and point lights for the life of the page.
    const failing = {
      dispose: vi.fn(() => {
        throw new Error('field');
      }),
    };
    const played = { dispose: vi.fn() };
    const bgViews = new Map([
      [0, failing],
      [1, played],
    ]);
    const errors: unknown[] = [];
    const bestEffort = (cleanup: () => void): void => {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    };

    disposeRendererPrewarmAndGroundFx({ prewarmDepthMaterials: new Map(), bgViews }, bestEffort);

    expect(failing.dispose).toHaveBeenCalledOnce();
    expect(played.dispose).toHaveBeenCalledOnce();
    expect(bgViews.size).toBe(0);
    expect(errors).toHaveLength(1);
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

  it('lets the shader warm worker go with the renderer whose contract it mirrors', () => {
    // The worker's context contract (attributes, extension set) was THIS
    // renderer's; kept alive across a rebuild it would warm keys the new
    // context never asks for. Read through the client's own readout: a
    // lifecycle that forgets the release leaves it ready, not idle.
    const posted: Record<string, unknown>[] = [];
    let terminations = 0;
    const worker = {
      posted,
      postMessage(message: unknown) {
        posted.push(message as Record<string, unknown>);
      },
      terminate() {
        terminations++;
      },
      onmessage: null as ((event: MessageEvent<ShaderWarmWorkerMessage>) => void) | null,
      onerror: null as ((event: unknown) => void) | null,
    };
    resetShaderWarmForTest({
      search: '?shaderwarm=reveal',
      mobile: false,
      spawn: () => worker,
      schedule: () => () => {},
    });
    shaderWarmDecide({ getContextAttributes: () => ({}), getExtension: () => null }, 0, false);
    const ready: ShaderWarmWorkerMessage = {
      kind: 'ready',
      ok: true,
      reason: null,
      extensions: [],
      adapter: 'test',
    };
    worker.onmessage?.({ data: ready } as MessageEvent<ShaderWarmWorkerMessage>);
    expect(shaderWarmSnapshot().worker).toBe('ready');

    const errors: unknown[] = [];
    disposeRendererPrewarmAndGroundFx({ prewarmDepthMaterials: new Map() }, (cleanup) => {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    });

    expect(errors).toEqual([]);
    expect(shaderWarmSnapshot().worker).toBe('idle');
    // Terminated without a word: a dispose message could not run before the
    // terminate that follows it, and the browser reclaims the worker's
    // context with the worker itself.
    expect(posted.map((message) => message.kind)).toEqual(['init']);
    expect(terminations).toBe(1);
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
