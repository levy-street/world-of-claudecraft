import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { collectAbilityVfxCompileTargets } from '../src/render/ability_vfx/prewarm';
import { bindSceneSamples, OpaqueSceneCapture } from '../src/render/scene_sampling';

describe('opaque scene copy ownership', () => {
  it('copies a distinct current-frame pair, restores the source and exposes the active region', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 2, 0.2, 700);
    const source = new THREE.WebGLRenderTarget(800, 400, {
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(800, 400, THREE.UnsignedIntType),
    });
    source.viewport.set(0, 0, 600, 300);
    let current: THREE.WebGLRenderTarget | null = source;
    const renderer = {
      initRenderTarget: vi.fn(),
      getRenderTarget: () => current,
      copyTextureToTexture: vi.fn(),
      setRenderTarget: vi.fn(),
    };
    const capture = new OpaqueSceneCapture(
      renderer as unknown as THREE.WebGLRenderer,
      scene,
      800,
      400,
    );
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.ShaderMaterial());
    scene.add(mesh);
    const unbind = bindSceneSamples(scene, mesh);
    const sentinel = scene.getObjectByName('opaqueVfxCapture')!;
    const draw = () =>
      sentinel.onBeforeRender(
        renderer as unknown as THREE.WebGLRenderer,
        scene,
        camera,
        mesh.geometry,
        mesh.material,
        null as never,
      );
    draw();
    const u = mesh.material.uniforms;
    expect(renderer.copyTextureToTexture).toHaveBeenCalledTimes(2);
    expect(u.uOpaqueColor.value).not.toBe(source.texture);
    expect(u.uOpaqueDepth.value).not.toBe(source.depthTexture);
    expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(source);
    expect(u.uSceneReady.value).toBe(1);
    expect(u.uSceneExtent.value.toArray()).toEqual([1 / 800, 1 / 400, 0.75, 0.75]);
    expect(u.uSceneClip.value.toArray()).toEqual([0.2, 700]);
    expect(collectAbilityVfxCompileTargets(scene).some((t) => t.object === sentinel)).toBe(true);
    mesh.visible = false;
    draw();
    expect(u.uSceneReady.value).toBe(0);
    expect(renderer.copyTextureToTexture).toHaveBeenCalledTimes(2);
    mesh.visible = true;
    source.samples = 4;
    draw();
    expect(u.uSceneReady.value).toBe(0);
    current = null;
    draw();
    expect(u.uSceneReady.value).toBe(0);
    unbind();
    capture.dispose();
    capture.dispose();
    expect(u.uOpaqueColor.value).toBeNull();
    expect(scene.getObjectByName('opaqueVfxCapture')).toBeUndefined();
    source.dispose();
    mesh.geometry.dispose();
    mesh.material.dispose();
  });
});

describe('opaque capture attachment residency', () => {
  function setup() {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 2, 0.2, 700);
    const source = new THREE.WebGLRenderTarget(800, 400, {
      depthTexture: new THREE.DepthTexture(800, 400, THREE.UnsignedIntType),
    });
    const renderer = {
      initRenderTarget: vi.fn(),
      getRenderTarget: () => source,
      copyTextureToTexture: vi.fn(),
      setRenderTarget: vi.fn(),
    };
    const capture = new OpaqueSceneCapture(
      renderer as unknown as THREE.WebGLRenderer,
      scene,
      800,
      400,
    );
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.ShaderMaterial());
    const group = new THREE.Group();
    group.add(mesh);
    scene.add(group);
    const draw = () =>
      scene
        .getObjectByName('opaqueVfxCapture')
        ?.onBeforeRender(
          renderer as unknown as THREE.WebGLRenderer,
          scene,
          camera,
          mesh.geometry,
          mesh.material,
          null as never,
        );
    const captureTarget = () =>
      renderer.initRenderTarget.mock.calls[0][0] as THREE.WebGLRenderTarget;
    const dispose = () => {
      capture.dispose();
      source.dispose();
      mesh.geometry.dispose();
      mesh.material.dispose();
    };
    return { scene, source, renderer, capture, mesh, group, draw, captureTarget, dispose };
  }

  it('allocates and initializes the attachment pair at construction, never inside a draw', () => {
    const f = setup();
    const unbind = bindSceneSamples(f.scene, f.mesh);
    try {
      // Construction, outside any frame, is the only allocation site: a first
      // eligible draw mid-fight must not pay an FBO plus texture allocation.
      expect(f.renderer.initRenderTarget).toHaveBeenCalledTimes(1);
      const target = f.captureTarget();
      expect([target.width, target.height]).toEqual([800, 400]);
      expect(target.texture).not.toBe(f.source.texture);
      expect(target.depthTexture).not.toBe(f.source.depthTexture);
      expect(f.mesh.material.uniforms.uOpaqueColor.value).toBe(target.texture);
      expect(f.mesh.material.uniforms.uOpaqueDepth.value).toBe(target.depthTexture);
      // Nothing is sampled until a draw proves the source matches.
      expect(f.mesh.material.uniforms.uSceneReady.value).toBe(0);

      f.draw();
      expect(f.renderer.initRenderTarget).toHaveBeenCalledTimes(1);
      expect(f.renderer.copyTextureToTexture).toHaveBeenCalledTimes(2);
      expect(f.mesh.material.uniforms.uSceneReady.value).toBe(1);
    } finally {
      unbind();
      f.dispose();
    }
  });

  it('copies nothing for a hidden, detached or mismatched source, and never reallocates', () => {
    const f = setup();
    const unbind = bindSceneSamples(f.scene, f.mesh);
    try {
      f.group.visible = false;
      f.draw();
      f.group.visible = true;
      f.group.removeFromParent();
      f.draw();
      f.scene.add(f.group);
      f.source.samples = 4;
      f.draw();
      expect(f.renderer.copyTextureToTexture).not.toHaveBeenCalled();
      expect(f.mesh.material.uniforms.uSceneReady.value).toBe(0);
      f.source.samples = 0;
      f.draw();
      expect(f.renderer.copyTextureToTexture).toHaveBeenCalledTimes(2);
      expect(f.mesh.material.uniforms.uSceneReady.value).toBe(1);
      // Every frame starts unsampled again; begin() is post.ts's per-frame reset.
      f.capture.begin();
      expect(f.mesh.material.uniforms.uSceneReady.value).toBe(0);
      expect(f.renderer.initRenderTarget).toHaveBeenCalledTimes(1);
    } finally {
      unbind();
      f.dispose();
    }
  });

  it('reallocates from the resize path, outside a draw, and guards the new extent', () => {
    const f = setup();
    const unbind = bindSceneSamples(f.scene, f.mesh);
    const target = f.captureTarget();
    try {
      f.capture.setSize(1600, 800);
      expect(f.renderer.initRenderTarget).toHaveBeenCalledTimes(2);
      expect([target.width, target.height]).toEqual([1600, 800]);
      // The source has not followed yet, so the extent guard refuses the copy.
      f.draw();
      expect(f.renderer.copyTextureToTexture).not.toHaveBeenCalled();
      expect(f.mesh.material.uniforms.uSceneReady.value).toBe(0);
      f.source.setSize(1600, 800);
      f.draw();
      expect(f.renderer.copyTextureToTexture).toHaveBeenCalledTimes(2);
      expect(f.mesh.material.uniforms.uSceneReady.value).toBe(1);
      // An unchanged extent is not a reallocation.
      f.capture.setSize(1600, 800);
      expect(f.renderer.initRenderTarget).toHaveBeenCalledTimes(2);
    } finally {
      unbind();
      f.dispose();
    }
  });

  it('restores the bound source and keeps sampling disabled when a copy fails', () => {
    const f = setup();
    const unbind = bindSceneSamples(f.scene, f.mesh);
    try {
      f.renderer.copyTextureToTexture.mockImplementationOnce(() => {
        throw new Error('capture copy');
      });
      expect(f.draw).toThrow('capture copy');
      expect(f.renderer.setRenderTarget).toHaveBeenLastCalledWith(f.source);
      expect(f.mesh.material.uniforms.uSceneReady.value).toBe(0);
      f.draw();
      expect(f.mesh.material.uniforms.uSceneReady.value).toBe(1);
    } finally {
      unbind();
      f.dispose();
    }
  });

  it('releases every piece once even when one release throws, and disposes idempotently', () => {
    const f = setup();
    const unbind = bindSceneSamples(f.scene, f.mesh);
    const target = f.captureTarget();
    const released = vi.spyOn(target, 'dispose');
    const sentinel = f.scene.getObjectByName('opaqueVfxCapture') as THREE.Mesh;
    vi.spyOn(sentinel.geometry, 'dispose').mockImplementation(() => {
      throw new Error('capture geometry release');
    });
    try {
      expect(() => f.capture.dispose()).toThrow(AggregateError);
      // The throwing release does not strand the rest of the teardown.
      expect(released).toHaveBeenCalledTimes(1);
      expect(f.scene.getObjectByName('opaqueVfxCapture')).toBeUndefined();
      expect(f.mesh.material.uniforms.uOpaqueColor.value).toBeNull();
      expect(f.mesh.material.uniforms.uOpaqueDepth.value).toBeNull();
      expect(f.mesh.material.uniforms.uSceneReady.value).toBe(0);
      expect(() => f.capture.dispose()).not.toThrow();
      expect(released).toHaveBeenCalledTimes(1);
      // A draw after disposal is inert, whatever still references the sentinel.
      sentinel.onBeforeRender(
        f.renderer as unknown as THREE.WebGLRenderer,
        f.scene,
        new THREE.PerspectiveCamera(),
        f.mesh.geometry,
        f.mesh.material,
        null as never,
      );
      expect(f.renderer.copyTextureToTexture).not.toHaveBeenCalled();
    } finally {
      unbind();
      f.source.dispose();
      f.mesh.geometry.dispose();
      f.mesh.material.dispose();
    }
  });
});

describe('scene sampling module boundaries', () => {
  it('stays a host-agnostic leaf with no graphics-tier import', () => {
    // The sun seed is a plain vector precisely so this module does not drag
    // gfx.ts (and the whole tier ladder) into every consumer's unit test;
    // renderer.ts owns the live value through sceneKeyLightUniform.
    const source = readFileSync(
      path.join(__dirname, '..', 'src', 'render', 'scene_sampling.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/from '\.\/gfx'/);
    expect(source).toContain('sceneKeyLightUniform');
  });
});
