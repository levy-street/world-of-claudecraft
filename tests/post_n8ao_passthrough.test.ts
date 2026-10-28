import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { StaticOpaqueN8AOPass } from '../src/render/post_n8ao';
import {
  type N8AOPassthroughState,
  renderN8aoPassthrough,
} from '../src/render/post_n8ao_passthrough';

describe('N8AO white-occlusion passthrough', () => {
  function fixture() {
    const pass = new StaticOpaqueN8AOPass(new THREE.Scene(), new THREE.PerspectiveCamera(), 80, 64);
    const state = pass as unknown as N8AOPassthroughState;
    const output = new THREE.WebGLRenderTarget(80, 64);
    const renderer = {
      autoClear: true,
      xr: { enabled: true },
      setRenderTarget: vi.fn(),
      render: vi.fn(),
    } as unknown as THREE.WebGLRenderer;
    pass.occlusionPassthrough = true;
    return { pass, state, output, renderer };
  }

  it('draws current beauty and its existing compositor with only two target binds', () => {
    const { pass, state, output, renderer } = fixture();
    const depth = pass.sceneTarget.depthTexture;
    const material = state.effectCompositerQuad.material;
    const version = material.version;
    try {
      pass.render(renderer, output, output, 0, false);
      expect(renderer.setRenderTarget).toHaveBeenCalledTimes(2);
      expect(renderer.setRenderTarget).toHaveBeenNthCalledWith(1, pass.sceneTarget);
      expect(renderer.setRenderTarget).toHaveBeenNthCalledWith(2, output);
      expect(renderer.render).toHaveBeenCalledTimes(2);
      expect(renderer.render).toHaveBeenNthCalledWith(1, state.scene, state.camera);
      expect(material.uniforms.sceneDiffuse.value).toBe(pass.sceneTarget.texture);
      expect(material.uniforms.occlusionPassthrough.value).toBe(false);
      expect(pass.sceneTarget.depthTexture).toBe(depth);
      expect(material.version).toBe(version);
      expect(renderer.autoClear).toBe(true);
      expect(renderer.xr.enabled).toBe(true);
    } finally {
      pass.dispose();
      output.dispose();
    }
  });

  it('honors external beauty and renderToScreen without allocating or rebuilding', () => {
    const { pass, state, output, renderer } = fixture();
    state.configuration.autoRenderBeauty = false;
    state.renderToScreen = true;
    try {
      pass.render(renderer, output, output, 0, false);
      expect(renderer.setRenderTarget).toHaveBeenCalledExactlyOnceWith(null);
      expect(renderer.render).toHaveBeenCalledTimes(1);
    } finally {
      pass.dispose();
      output.dispose();
    }
  });

  it('restores XR, clear state and the compositor branch when a draw throws', () => {
    const { pass, state, output, renderer } = fixture();
    vi.mocked(renderer.render)
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error('context lost');
      });
    try {
      expect(() => pass.render(renderer, output, output, 0, false)).toThrow('context lost');
      expect(renderer.xr.enabled).toBe(true);
      expect(renderer.autoClear).toBe(true);
      expect(state.effectCompositerQuad.material.uniforms.occlusionPassthrough.value).toBe(false);
    } finally {
      pass.dispose();
      output.dispose();
    }
  });

  it.each(['debug', 'split', 'tones', 'transparency'])(
    'retains the original display path for %s',
    (mode) => {
      const { pass, state, output, renderer } = fixture();
      if (mode === 'debug') state.debugMode = true;
      if (mode === 'split') state.configuration.renderMode = 3;
      if (mode === 'tones') state.configuration.aoTones = 1.5;
      // Avoid invoking n8ao's allocation-bearing configuration setter in this decision test.
      const config = { ...state.configuration, transparencyAware: mode === 'transparency' };
      try {
        expect(renderN8aoPassthrough({ ...state, configuration: config }, renderer, output)).toBe(
          false,
        );
        expect(renderer.render).not.toHaveBeenCalled();
      } finally {
        pass.dispose();
        output.dispose();
      }
    },
  );
});
