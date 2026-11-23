import { N8AOPass } from 'n8ao';
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { describe, expect, it } from 'vitest';
import { StaticOpaqueN8AOPass } from '../../src/render/post_n8ao';

describe('N8AO passthrough pixels against the original white-AO compositor', () => {
  it.each([false, true])(
    'preserves color, alpha and live scene depth with halfRes=%s',
    (halfRes) => {
      const renderer = new THREE.WebGLRenderer({ alpha: true, preserveDrawingBuffer: true });
      renderer.setSize(80, 64, false);
      renderer.setClearColor(0x25486a, 0.375);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      const errors: string[] = [];
      renderer.debug.onShaderError = (gl, program) =>
        errors.push(gl.getProgramInfoLog(program) ?? '');
      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0x8799ba, 1, 8);
      const camera = new THREE.PerspectiveCamera(50, 80 / 64, 0.1, 50);
      camera.position.z = 3;
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color: 0xe29a48, transparent: true, opacity: 0.65 }),
      );
      scene.add(box);
      const pass = new StaticOpaqueN8AOPass(scene, camera, 80, 64);
      pass.configuration.halfRes = halfRes;
      const output = new THREE.WebGLRenderTarget(80, 64);
      const depthOutput = new THREE.WebGLRenderTarget(80, 64);
      const depthMaterial = new THREE.ShaderMaterial({
        uniforms: { sceneDepth: { value: pass.sceneTarget.depthTexture } },
        vertexShader:
          'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
        fragmentShader: `uniform sampler2D sceneDepth; varying vec2 vUv;
        #include <packing>
        void main() { gl_FragColor = packDepthToRGBA(texture2D(sceneDepth, vUv).r); }`,
      });
      const depthQuad = new FullScreenQuad(depthMaterial);
      const readDepth = (): Uint8Array => {
        const previous = renderer.getRenderTarget();
        depthMaterial.uniforms.sceneDepth.value = pass.sceneTarget.depthTexture;
        renderer.setRenderTarget(depthOutput);
        depthQuad.render(renderer);
        const pixels = new Uint8Array(depthOutput.width * depthOutput.height * 4);
        renderer.readRenderTargetPixels(
          depthOutput,
          0,
          0,
          depthOutput.width,
          depthOutput.height,
          pixels,
        );
        renderer.setRenderTarget(previous);
        return pixels;
      };
      const read = (screen: boolean): Uint8Array => {
        const pixels = new Uint8Array(output.width * output.height * 4);
        if (screen) {
          const gl = renderer.getContext();
          gl.readPixels(0, 0, output.width, output.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        } else renderer.readRenderTargetPixels(output, 0, 0, output.width, output.height, pixels);
        return pixels;
      };
      const clearAo = (): void => {
        const color = renderer.getClearColor(new THREE.Color());
        const alpha = renderer.getClearAlpha();
        renderer.setRenderTarget(pass.occlusionTarget);
        renderer.setClearColor(0xffffff, 1);
        renderer.clear();
        renderer.setClearColor(color, alpha);
      };
      try {
        // Warm the normal scene and all AO programs before entering the shed.
        pass.render(renderer, output, output, 0, false);
        pass.occlusionPassthrough = true;
        clearAo();
        for (let frame = 0; frame < 4; frame++) {
          if (frame === 2) {
            renderer.setSize(96, 72, false);
            output.setSize(96, 72);
            depthOutput.setSize(96, 72);
            pass.setSize(96, 72);
            camera.aspect = 96 / 72;
            camera.updateProjectionMatrix();
            clearAo();
          }
          box.position.x = -0.4 + frame * 0.2;
          box.rotation.y = frame * 0.3;
          camera.position.y = frame * 0.1;
          pass.configuration.gammaCorrection = frame % 2 === 0;
          pass.renderToScreen = frame >= 2;
          const depth = pass.sceneTarget.depthTexture;
          N8AOPass.prototype.render.call(pass, renderer, output, output, 0, false);
          const reference = read(pass.renderToScreen);
          const referenceDepth = readDepth();
          const programs = renderer.info.programs?.length;
          const beauty = new Uint16Array(output.width * output.height * 4);
          renderer.readRenderTargetPixels(
            pass.sceneTarget,
            0,
            0,
            output.width,
            output.height,
            beauty,
          );
          pass.render(renderer, output, output, 0, false);
          const actual = read(pass.renderToScreen);
          // The old HALFRES path sums white AO times bilateral weights, then
          // divides by their sum. GPU floating-point contraction can move its
          // mathematically-one result across one final RGBA8 rounding boundary.
          // Alpha and the entire full-resolution image remain byte-identical.
          for (let i = 0; i < actual.length; i++) {
            expect(Math.abs(actual[i] - reference[i])).toBeLessThanOrEqual(
              halfRes && i % 4 !== 3 ? 1 : 0,
            );
          }
          const actualBeauty = new Uint16Array(beauty.length);
          renderer.readRenderTargetPixels(
            pass.sceneTarget,
            0,
            0,
            output.width,
            output.height,
            actualBeauty,
          );
          expect(actualBeauty).toEqual(beauty);
          expect(readDepth()).toEqual(referenceDepth);
          expect(referenceDepth.some((value) => value !== referenceDepth[0])).toBe(true);
          expect(pass.sceneTarget.depthTexture).toBe(depth);
          expect(renderer.info.programs?.length).toBe(programs);
          expect(reference.some((value, i) => i % 4 === 3 && value > 0 && value < 255)).toBe(true);
          expect(renderer.getContext().getError()).toBe(renderer.getContext().NO_ERROR);
        }
        pass.occlusionPassthrough = false;
        pass.renderToScreen = false;
        pass.render(renderer, output, output, 0, false);
        expect(errors).toEqual([]);
      } finally {
        pass.dispose();
        output.dispose();
        depthOutput.dispose();
        depthQuad.dispose();
        depthMaterial.dispose();
        box.geometry.dispose();
        box.material.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
      }
    },
  );
});
