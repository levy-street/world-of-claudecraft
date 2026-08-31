import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildIgnivarRotatingRaysTelegraph,
  syncIgnivarRotatingRaysTelegraph,
} from '../../src/render/ignivar_rotating_rays';

type ProgramDiagnostics = { diagnostics?: { runnable?: boolean } };

let dispose: (() => void) | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
});

function readThermalPixels(
  renderer: THREE.WebGLRenderer,
  width: number,
  height: number,
): { lit: number; hot: number; peakRed: number; peakGreen: number } {
  const gl = renderer.getContext();
  const rgba = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  expect(gl.getError()).toBe(gl.NO_ERROR);
  let lit = 0;
  let hot = 0;
  let peakRed = 0;
  let peakGreen = 0;
  for (let index = 0; index < width * height; index++) {
    const red = rgba[index * 4];
    const green = rgba[index * 4 + 1];
    const blue = rgba[index * 4 + 2];
    if (red + green + blue > 20) lit++;
    if (red > 90 && green > 30 && red > green * 1.35 && green > blue * 1.4) hot++;
    peakRed = Math.max(peakRed, red);
    peakGreen = Math.max(peakGreen, green);
  }
  return { lit, hot, peakRed, peakGreen };
}

describe('Ignivar Revolving Inferno on a real WebGL driver', () => {
  it.each([
    { label: 'desktop', width: 320, height: 240 },
    { label: 'mobile', width: 144, height: 192 },
  ])('links and renders thermal fire at $label resolution', ({ width, height }) => {
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
    scene.background = new THREE.Color(0x050100);
    const rays = buildIgnivarRotatingRaysTelegraph();
    syncIgnivarRotatingRaysTelegraph(rays, 'active', 1, 1);
    scene.add(rays);

    const viewHeight = 38;
    const aspect = width / height;
    const camera = new THREE.OrthographicCamera(
      -viewHeight * aspect,
      viewHeight * aspect,
      viewHeight,
      -viewHeight,
      0.1,
      100,
    );
    camera.position.set(0, 60, 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();

    renderer.compile(scene, camera);
    const programs = renderer.info.programs as ProgramDiagnostics[] | null;
    expect(programs?.length).toBeGreaterThan(0);
    expect(programs?.filter((program) => program.diagnostics?.runnable === false)).toHaveLength(0);
    renderer.render(scene, camera);
    expect(renderer.info.render.calls).toBeLessThanOrEqual(36);
    expect(renderer.info.render.triangles).toBeLessThan(5_000);

    const pixels = readThermalPixels(renderer, width, height);
    expect(pixels.lit).toBeGreaterThan(width * height * 0.012);
    expect(pixels.hot).toBeGreaterThan(width * height * 0.001);
    expect(pixels.peakRed).toBeGreaterThan(120);
    expect(pixels.peakGreen).toBeGreaterThan(45);

    dispose = () => {
      rays.traverse((object) => {
        const renderable = object as THREE.Mesh;
        if ((renderable as THREE.InstancedMesh).isInstancedMesh) {
          (renderable as THREE.InstancedMesh).dispose();
        }
        renderable.geometry?.dispose();
        const materials = Array.isArray(renderable.material)
          ? renderable.material
          : renderable.material
            ? [renderable.material]
            : [];
        for (const material of materials) material.dispose();
      });
      renderer.dispose();
      canvas.remove();
    };
  });
});
