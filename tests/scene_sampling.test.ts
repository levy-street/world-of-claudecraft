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
