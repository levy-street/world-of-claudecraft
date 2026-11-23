// A link that straddles a WebGL context loss (src/render/context_generation.ts,
// consumed by the compile arms in src/render/compile_arms.ts): three's
// compileAsync still resolves across a loss and restore, with nothing linked
// on the restored context, and every gate awaiting it would record a proof
// the live context does not have. The arm links it again once the context is
// live, so "resolved" keeps meaning "linked on the context that is live now".
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  type CompileArmHost,
  linkColorPrograms,
  linkShadowPrograms,
} from '../src/render/compile_arms';
import {
  CONTEXT_LINK_MAX_RESUBMITS,
  disposeRendererContextGeneration,
  linkAcrossContextLoss,
  noteRendererContextLost,
  noteRendererContextRestored,
  rendererContextGeneration,
} from '../src/render/context_generation';

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function deferredLinks() {
  const pending: Array<() => void> = [];
  const compileAsync = vi.fn(
    (root: THREE.Object3D) =>
      new Promise<THREE.Object3D>((resolve) => {
        pending.push(() => resolve(root));
      }),
  );
  const renderer = {
    getRenderTarget: () => null,
    setRenderTarget: () => {},
    compileAsync,
  };
  const host: CompileArmHost = {
    webgl: () => renderer,
    camera: () => new THREE.PerspectiveCamera(),
    scene: () => new THREE.Scene(),
    shadowCamera: () => new THREE.OrthographicCamera(),
    offscreen: () => false,
    offscreenTarget: () => ({}) as THREE.WebGLRenderTarget,
    depthMaterials: () => new Map(),
    shadowArm: () => true,
  };
  return {
    renderer,
    host,
    compileAsync,
    settleAll: () => {
      for (const go of pending.splice(0)) go();
    },
  };
}

describe('a link across a context loss', () => {
  it('a colour link that resolved across the loss is linked again on the restored context', async () => {
    const { renderer, host, compileAsync, settleAll } = deferredLinks();
    const root = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    let done = false;
    const link = linkColorPrograms(host, root, false).then(() => {
      done = true;
    });
    expect(compileAsync).toHaveBeenCalledTimes(1);
    noteRendererContextLost(renderer);
    // KHR_parallel_shader_compile answers "complete" on a lost context.
    settleAll();
    await flush();
    // Not ready: nothing is resubmitted on the dead context, nothing resolves.
    expect(done).toBe(false);
    expect(compileAsync).toHaveBeenCalledTimes(1);
    noteRendererContextRestored(renderer);
    await flush();
    expect(compileAsync).toHaveBeenCalledTimes(2);
    expect(done).toBe(false);
    settleAll();
    await link;
    expect(done).toBe(true);
  });

  it('the shadow arm straddles the same way, and a link on a live context submits in the caller stack', async () => {
    const { renderer, host, compileAsync, settleAll } = deferredLinks();
    const root = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const link = linkShadowPrograms(host, root);
    // Synchronously: a queue unit is charged for compileAsync's prologue.
    expect(compileAsync).toHaveBeenCalledTimes(1);
    noteRendererContextLost(renderer);
    noteRendererContextRestored(renderer);
    settleAll();
    await flush();
    expect(compileAsync).toHaveBeenCalledTimes(2);
    settleAll();
    await link;
  });

  it('a link asked for while the context is lost waits for the restore before it submits', async () => {
    const renderer = {};
    const submit = vi.fn(async () => 'linked');
    noteRendererContextLost(renderer);
    const link = linkAcrossContextLoss(renderer, submit);
    await flush();
    expect(submit).not.toHaveBeenCalled();
    noteRendererContextRestored(renderer);
    await expect(link).resolves.toBe('linked');
    expect(submit).toHaveBeenCalledTimes(1);
    expect(rendererContextGeneration(renderer)).toBe(2);
  });

  it('a context that keeps dying under one link gives up after the bound, and a disposed renderer releases every waiter', async () => {
    const renderer = {};
    const submit = vi.fn(async () => {
      noteRendererContextLost(renderer);
      noteRendererContextRestored(renderer);
      return 'last';
    });
    expect(CONTEXT_LINK_MAX_RESUBMITS).toBe(3);
    await expect(linkAcrossContextLoss(renderer, submit)).resolves.toBe('last');
    expect(submit).toHaveBeenCalledTimes(1 + CONTEXT_LINK_MAX_RESUBMITS);

    const gone = {};
    noteRendererContextLost(gone);
    const waiting = linkAcrossContextLoss(gone, async () => 'late');
    disposeRendererContextGeneration(gone);
    await expect(waiting).resolves.toBe('late');
  });
});
