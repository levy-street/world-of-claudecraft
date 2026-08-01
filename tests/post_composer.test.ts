import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { PostEffectComposer } from '../src/render/post_composer';

function rendererStub(pixelRatio = 1): THREE.WebGLRenderer {
  return {
    getPixelRatio: () => pixelRatio,
  } as unknown as THREE.WebGLRenderer;
}

describe('post effect composer', () => {
  it('aliases and disposes the spare target on single-buffer chains', () => {
    const target = new THREE.WebGLRenderTarget(1280, 720, {
      depthBuffer: false,
      samples: 0,
      type: THREE.HalfFloatType,
    });
    const spare = target.clone();
    const spareDispose = vi.spyOn(spare, 'dispose');
    vi.spyOn(target, 'clone').mockReturnValue(spare);
    const composer = new PostEffectComposer(rendererStub(), target, 1280, 720, true);

    expect(spareDispose).toHaveBeenCalledTimes(1);
    expect(composer.renderTarget1).toBe(target);
    expect(composer.renderTarget2).toBe(target);
    expect(composer.readBuffer).toBe(target);
    expect(composer.writeBuffer).toBe(target);

    const dispose = vi.spyOn(target, 'dispose');
    composer.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('resizes every live target and pass exactly once at the requested physical size', () => {
    const target = new THREE.WebGLRenderTarget(320, 180, {
      depthBuffer: false,
      samples: 0,
      type: THREE.HalfFloatType,
    });
    const composer = new PostEffectComposer(rendererStub(), target, 320, 180, true);
    const setSize = vi.fn();
    composer.addPass({
      isPass: true,
      enabled: true,
      needsSwap: false,
      clear: false,
      renderToScreen: false,
      setSize,
      render: vi.fn(),
      dispose: vi.fn(),
    });
    setSize.mockClear();
    const resizeTarget = vi.spyOn(target, 'setSize');

    composer.setSizeAndPixelRatio(640, 360, 2);

    expect(target.width).toBe(1280);
    expect(target.height).toBe(720);
    expect(resizeTarget).toHaveBeenCalledTimes(1);
    expect(resizeTarget).toHaveBeenCalledWith(1280, 720);
    expect(setSize).toHaveBeenCalledTimes(1);
    expect(setSize).toHaveBeenCalledWith(1280, 720);
  });

  it('floors fixed targets and applies a whole-pixel scene region without reallocating', () => {
    const target = new THREE.WebGLRenderTarget(320, 180, {
      depthBuffer: false,
      samples: 0,
      type: THREE.HalfFloatType,
    });
    const composer = new PostEffectComposer(rendererStub(), target, 320, 180, true);
    const resizeTarget = vi.spyOn(target, 'setSize');

    composer.setSizeAndPixelRatio(641, 361, 1.5);
    expect(resizeTarget).toHaveBeenLastCalledWith(961, 541);

    resizeTarget.mockClear();
    composer.setRenderRegion(640, 360);
    expect(target.viewport.toArray()).toEqual([0, 0, 640, 360]);
    expect(target.scissor.toArray()).toEqual([0, 0, 640, 360]);
    expect(target.scissorTest).toBe(true);
    expect(resizeTarget).not.toHaveBeenCalled();

    composer.setRenderRegion(961, 541);
    expect(target.scissorTest).toBe(false);
  });

  it('keeps independent ping-pong targets when a tail pass needs them', () => {
    const target = new THREE.WebGLRenderTarget(640, 360, {
      depthBuffer: false,
      samples: 0,
      type: THREE.HalfFloatType,
    });
    const composer = new PostEffectComposer(rendererStub(), target, 640, 360, false);

    expect(composer.renderTarget1).not.toBe(composer.renderTarget2);
    expect(composer.writeBuffer).not.toBe(composer.readBuffer);
  });
});
