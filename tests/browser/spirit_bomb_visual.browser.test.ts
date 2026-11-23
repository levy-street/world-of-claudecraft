import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { SpiritBombs } from '../../src/render/ability_vfx/spirit_bomb';
import { createVfxAnchor } from '../../src/render/vfx_anchor';

type ProgramDiagnostics = { diagnostics?: { runnable?: boolean } };
let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function pixels(renderer: THREE.WebGLRenderer, width: number, height: number) {
  const gl = renderer.getContext();
  const rgba = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  expect(gl.getError()).toBe(gl.NO_ERROR);
  let lit = 0;
  let violet = 0;
  let peak = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const [red, green, blue] = [rgba[i], rgba[i + 1], rgba[i + 2]];
    if (red + green + blue > 40) lit++;
    if (blue > 60 && blue > green * 1.5 && red > green * 1.2) violet++;
    peak = Math.max(peak, blue);
  }
  return { lit, violet, peak };
}

describe('Tithe Bomb on a real WebGL driver', () => {
  it.each([
    { label: 'desktop', width: 320, height: 240 },
    { label: 'mobile', width: 144, height: 192 },
  ])(
    'links and renders the giant orb and impact without bloom at $label resolution',
    ({ width, height }) => {
      const canvas = document.createElement('canvas');
      document.body.appendChild(canvas);
      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        preserveDrawingBuffer: true,
      });
      renderer.setPixelRatio(1);
      renderer.setSize(width, height, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NoToneMapping;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x020104);
      const bombs = new SpiritBombs(
        scene,
        createVfxAnchor((id, out) => {
          Object.assign(out, { x: id === 1 ? -3 : 3, y: 0, z: 0, height: 1.8 });
          return true;
        }),
        () => 0,
      );
      cleanup = () => {
        bombs.dispose();
        renderer.dispose();
        canvas.remove();
      };
      const heightSpan = 9;
      const aspect = width / height;
      const camera = new THREE.OrthographicCamera(
        -heightSpan * aspect,
        heightSpan * aspect,
        heightSpan,
        -heightSpan,
        0.1,
        100,
      );
      camera.position.set(14, 12, 18);
      camera.lookAt(0, 3, 0);
      camera.updateProjectionMatrix();
      bombs.hold(1, 1, 1);
      bombs.update(0.6, 1);
      renderer.compile(scene, camera);
      renderer.render(scene, camera);
      expect(renderer.info.render.calls).toBeLessThanOrEqual(4);
      expect(renderer.info.render.triangles).toBeLessThanOrEqual(6_000);
      const charge = pixels(renderer, width, height);
      expect(charge.lit).toBeGreaterThan(width * height * 0.01);
      expect(charge.violet).toBeGreaterThan(width * height * 0.005);
      expect(charge.peak).toBeGreaterThan(120);
      expect(bombs.release(1, 2)).toBe(true);
      bombs.update(0.24 + 0.25, 2);
      renderer.render(scene, camera);
      expect(renderer.info.render.calls).toBeLessThanOrEqual(4);
      expect(renderer.info.render.triangles).toBeLessThanOrEqual(6_000);
      const impact = pixels(renderer, width, height);
      expect(impact.lit).toBeGreaterThan(width * height * 0.01);
      expect(impact.violet).toBeGreaterThan(width * height * 0.005);
      const programs = renderer.info.programs as ProgramDiagnostics[] | null;
      expect(programs).toHaveLength(3);
      expect(programs?.filter((program) => program.diagnostics?.runnable === false)).toHaveLength(
        0,
      );
      bombs.update(2, 3);
      renderer.render(scene, camera);
      expect(renderer.info.render.calls).toBe(0);
      expect(pixels(renderer, width, height).lit).toBe(0);
    },
  );
});
