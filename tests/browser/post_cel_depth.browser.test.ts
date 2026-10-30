import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CEL_SHADING_DEFAULTS } from '../../src/render/cel_shading_core';
import { OutputGradePass } from '../../src/render/post_output_grade';

const state = vi.hoisted(() => ({
  look: null as null | { ink: number; saturation: number; inkWidth: number },
  aoOff: true,
  gfx: { ao: true, aoFullRes: false, bloom: true, smaa: true, fxaa: true, msaaSamples: 0 },
}));
vi.mock('../../src/render/gfx', () => ({
  GFX: state.gfx,
  sharedUniforms: { uTime: { value: 0 } },
}));
// Both getters serve the case's look: this composer test pins the depth wiring of
// a BUILT ink arm (plain ink 0 against ink 0.85), so the arm is built in both
// renders. The real gate (no arm for the default ink 0 and saturation 1) is
// pinned in tests/cel_shading_core.test.ts (celInkArmActive, celInkSettings).
vi.mock('../../src/render/cel_shading', () => ({
  celShadingSettings: () => state.look,
  celInkSettings: () => state.look,
}));
// The palette lab look is on by default since the genshin overhaul
// (8bff2cec638), so importing post.ts boots its runtime chunk, whose graph
// needs more of gfx.ts than this mock serves: the import then rejects
// (an unhandled SyntaxError) while a case is rendering. The runtime only acts
// on a live world, so this composer test runs without it.
vi.mock('../../src/render/palette_lab/palette_lab_boot', () => ({}));
vi.mock('../../src/render/render_dev_flags', () => ({
  renderLayerDisabled: (name: string) => name === 'n8ao' && state.aoOff,
}));

describe('cel scene depth through the real composer', () => {
  it.each(['high', 'ultra', 'insane', 'medium', 'ao-setting-off', 'ao-on', 'stock'])(
    '%s keeps ink on the current scene through swaps, shed and resize',
    async (mode) => {
      const { buildComposer } = await import('../../src/render/post');
      const gradeOnly = mode === 'medium';
      state.gfx.ao = mode !== 'ao-setting-off';
      state.gfx.aoFullRes = mode === 'ultra' || mode === 'insane';
      state.aoOff = mode !== 'ao-on';
      const errors: string[] = [];
      const webgl = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
      webgl.debug.checkShaderErrors = true;
      webgl.debug.onShaderError = (gl, program) => errors.push(gl.getProgramInfoLog(program) ?? '');
      webgl.setPixelRatio(1);
      webgl.outputColorSpace = THREE.SRGBColorSpace;
      webgl.toneMapping = THREE.ACESFilmicToneMapping;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x888888);
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color: 0xcccccc }),
      );
      scene.add(box);
      const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 50);
      camera.position.z = 3;

      const render = async (ink: number): Promise<Uint8Array[]> => {
        state.look = mode === 'stock' ? null : { ...CEL_SHADING_DEFAULTS, ink, saturation: 1 };
        webgl.setSize(64, 64, false);
        camera.aspect = 1;
        camera.updateProjectionMatrix();
        const post = buildComposer(webgl, scene, camera, 64, 64, { gradeOnly });
        try {
          expect(Boolean(post.ao)).toBe(mode === 'ao-on');
          if (mode === 'stock' || mode === 'ao-on') {
            expect(post.composer.renderTarget1.depthTexture).toBeNull();
            expect(post.composer.renderTarget2.depthTexture).toBeNull();
          }
          // SMAA loads its two embedded lookup images asynchronously, and flags
          // the upload from the image's load EVENT, a task that can land after
          // decode() resolves on a busy main thread: wait for the flag itself
          // (three bumps `version`), or a first frame can draw with no lookups.
          for (const pass of post.composer.passes) {
            const smaa = pass as unknown as {
              _areaTexture?: THREE.Texture;
              _searchTexture?: THREE.Texture;
            };
            for (const texture of [smaa._areaTexture, smaa._searchTexture]) {
              if (!texture) continue;
              await (texture.image as HTMLImageElement).decode();
              await vi.waitFor(() => expect(texture.version).toBeGreaterThan(0));
            }
          }
          post.render();
          post.prewarmShed();
          webgl.setRenderTarget(null);
          const frames: Uint8Array[] = [];
          for (let frame = 0; frame < 6; frame++) {
            box.position.x = -0.5 + frame * 0.2;
            if (frame === 2) {
              webgl.setSize(80, 64, false);
              post.setSize(80, 64);
              camera.aspect = 80 / 64;
              camera.updateProjectionMatrix();
            }
            if (frame === 4) post.setShedLevel(0);
            post.updateScreenFx(1);
            const sceneDepth = post.composer.readBuffer.depthTexture;
            post.render();
            // Pixels prove ink draws; identity proves it samples THIS frame's
            // scene attachment, including when the FXAA shed twin takes over.
            if (mode !== 'stock' && mode !== 'ao-on') {
              expect(sceneDepth).not.toBeNull();
              for (const pass of post.composer.passes) {
                if (pass instanceof OutputGradePass && pass.enabled) {
                  expect(pass.uniforms.tCelDepth.value).toBe(sceneDepth);
                }
              }
            }
            const gl = webgl.getContext();
            const pixels = new Uint8Array(webgl.domElement.width * 64 * 4);
            gl.readPixels(0, 0, webgl.domElement.width, 64, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            expect(gl.getError()).toBe(gl.NO_ERROR);
            frames.push(pixels);
          }
          return frames;
        } finally {
          post.dispose();
        }
      };
      try {
        const plain = await render(0);
        const inked = await render(0.85);
        for (let frame = 0; frame < plain.length; frame++) {
          let darkened = 0;
          for (let i = 0; i < plain[frame].length; i += 4) {
            if (plain[frame][i] - inked[frame][i] > 25) darkened++;
          }
          if (mode === 'stock') expect(inked[frame]).toEqual(plain[frame]);
          else expect(darkened, `ink pixels in frame ${frame}`).toBeGreaterThan(40);
        }
        expect(errors).toEqual([]);
      } finally {
        box.geometry.dispose();
        box.material.dispose();
        webgl.dispose();
        webgl.forceContextLoss();
      }
    },
  );
});
