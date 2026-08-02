import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyRenderRegion, RegionRenderPass } from '../src/render/post_region_render_pass';

function sceneTarget(width = 1280, height = 720): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: true,
    samples: 0,
    type: THREE.HalfFloatType,
  });
}

/** Minimal stand-in for the members three's RenderPass touches. */
function rendererStub(onDraw: () => void): THREE.WebGLRenderer {
  return {
    autoClear: true,
    autoClearColor: true,
    autoClearDepth: true,
    autoClearStencil: true,
    setRenderTarget: () => {},
    clear: () => {},
    render: () => onDraw(),
  } as unknown as THREE.WebGLRenderer;
}

interface DrawSample {
  viewport: number[];
  scissor: number[];
  scissorTest: boolean;
}

function renderAndSample(
  pass: RegionRenderPass,
  target: THREE.WebGLRenderTarget,
  onDraw: () => void = () => {},
): DrawSample | null {
  let during: DrawSample | null = null;
  const renderer = rendererStub(() => {
    during = {
      viewport: target.viewport.toArray(),
      scissor: target.scissor.toArray(),
      scissorTest: target.scissorTest,
    };
    onDraw();
  });
  pass.render(renderer, sceneTarget(), target, 0, false);
  return during;
}

describe('applyRenderRegion', () => {
  it('clamps to whole pixels inside the target and arms the scissor', () => {
    const target = sceneTarget(961, 541);

    applyRenderRegion(target, { width: 816.7, height: 459.9 });

    expect(target.viewport.toArray()).toEqual([0, 0, 816, 459]);
    expect(target.scissor.toArray()).toEqual([0, 0, 816, 459]);
    expect(target.scissorTest).toBe(true);
  });

  it('restores the full extent and disarms the scissor when the region is null', () => {
    const target = sceneTarget(961, 541);
    applyRenderRegion(target, { width: 640, height: 360 });

    applyRenderRegion(target, null);

    expect(target.viewport.toArray()).toEqual([0, 0, 961, 541]);
    expect(target.scissor.toArray()).toEqual([0, 0, 961, 541]);
    expect(target.scissorTest).toBe(false);
  });

  it('never exceeds the target or collapses below one pixel', () => {
    const target = sceneTarget(640, 360);

    applyRenderRegion(target, { width: 9999, height: 9999 });
    expect(target.viewport.toArray()).toEqual([0, 0, 640, 360]);
    expect(target.scissorTest).toBe(false); // full coverage leaves no scissor armed

    applyRenderRegion(target, { width: 0, height: -12 });
    expect(target.viewport.toArray()).toEqual([0, 0, 1, 1]);
    expect(target.scissorTest).toBe(true);
  });
});

describe('RegionRenderPass', () => {
  it('clamps the scene target only while the scene draw is in flight', () => {
    const target = sceneTarget();
    const pass = new RegionRenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    pass.region = { width: 1088, height: 612 };

    const during = renderAndSample(pass, target);

    expect(during).toEqual({
      viewport: [0, 0, 1088, 612],
      scissor: [0, 0, 1088, 612],
      scissorTest: true,
    });
  });

  it('leaves no region behind for a later pass to inherit', () => {
    // The regression this pass exists for. Dynamic resolution shrinks the scene
    // draw and lets OutputGradePass expand it again, so every pass after the
    // scene MUST see a full-extent target. When the region survived the scene
    // draw (it used to live on the composer's ping-pong targets), the grade wrote
    // its expansion into the same sub-rect and the tail pass stretched the whole
    // target, never-written margin included, across the canvas.
    const target = sceneTarget();
    const pass = new RegionRenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    pass.region = { width: 1088, height: 612 };

    renderAndSample(pass, target);

    expect(target.viewport.toArray()).toEqual([0, 0, 1280, 720]);
    expect(target.scissor.toArray()).toEqual([0, 0, 1280, 720]);
    expect(target.scissorTest).toBe(false);
  });

  it('restores the full extent even when the scene draw throws', () => {
    const target = sceneTarget();
    const pass = new RegionRenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    pass.region = { width: 1088, height: 612 };

    expect(() =>
      renderAndSample(pass, target, () => {
        throw new Error('context lost mid-draw');
      }),
    ).toThrow('context lost mid-draw');

    expect(target.viewport.toArray()).toEqual([0, 0, 1280, 720]);
    expect(target.scissorTest).toBe(false);
  });

  it('draws at full extent with no scissor when no region is set', () => {
    const target = sceneTarget();
    const pass = new RegionRenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());

    const during = renderAndSample(pass, target);

    expect(during).toEqual({
      viewport: [0, 0, 1280, 720],
      scissor: [0, 0, 1280, 720],
      scissorTest: false,
    });
  });
});
