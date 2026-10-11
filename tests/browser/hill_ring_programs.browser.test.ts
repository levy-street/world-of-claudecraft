// The King of the Hill circle on a real WebGL driver (the browser half of
// tests/hill_ring_twin.test.ts; the farm_prewarm_programs pattern).
// renderer.info.programs.length grows when a draw links a program. The ring
// has TWO programs: both meshes are transparent and DoubleSide, so three
// draws each in a back pass and a front pass, keys differing by the flipSided
// bit. The CONTROL leg (no gate) proves the harness sees the live ring's
// first draw link both cold and only park them in the retention FIFO once the
// hill ends; the PREPARED legs prove that once the twin the first sighting
// hands to the gate has compiled under the tier's target (the canvas on a
// direct tier; on a composer tier a tiny throwaway target like the renderer's
// compile arm uses, while the scene pass draws into a full-size HalfFloat
// one), the live ring's first draw links ZERO programs while it really draws,
// a later hill at a new spot links zero again, and the twin's programs stay
// live, never parked, after the hill ends.
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { HillRingVisuals } from '../../src/render/hill_ring';
import type { HillInfo } from '../../src/world_api/world_pvp';

const WIDTH = 320;
const HEIGHT = 240;

let dispose: (() => void) | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
});

function hill(over: Partial<HillInfo> = {}): HillInfo {
  return {
    zoneId: 'z',
    x: 0,
    z: 0,
    radius: 50,
    phase: 'warning',
    minutesLeft: 15,
    standing: 'counted',
    inZone: true,
    inside: false,
    holder: 'none',
    holderCount: 0,
    yourCount: 0,
    challenger: 'none',
    challengerCount: 0,
    contest: 0,
    ...over,
  };
}

function setup() {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const target = new THREE.WebGLRenderTarget(WIDTH, HEIGHT, { type: THREE.HalfFloatType });
  const compileTarget = new THREE.WebGLRenderTarget(8, 8);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x88aacc, 20, 400);
  scene.add(new THREE.AmbientLight(0xffffff, 1));
  scene.add(new THREE.DirectionalLight(0xffffff, 1));
  const camera = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 0.1, 1000);
  camera.position.set(0, 90, 90);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  dispose = () => {
    target.dispose();
    compileTarget.dispose();
    renderer.dispose();
    canvas.remove();
  };
  return { renderer, target, compileTarget, scene, camera };
}

// The three patch's bounded retention FIFO: a released program parks here,
// still linked, until churn evicts it; a program the twin holds never parks.
const retainedIds = (renderer: THREE.WebGLRenderer): number[] =>
  ((renderer.info as { retainedPrograms?: { id: number }[] }).retainedPrograms ?? []).map(
    (p) => p.id,
  );

const programIds = (renderer: THREE.WebGLRenderer): number[] =>
  (renderer.info.programs ?? []).map((p) => (p as { id: number }).id);

describe('hill ring programs on a real WebGL driver', () => {
  it('control: without a gate the live ring links its two programs at its first draw', () => {
    const { renderer, scene, camera } = setup();
    const visuals = new HillRingVisuals(scene, undefined, () => 0);
    renderer.render(scene, camera);
    const baseline = programIds(renderer);
    visuals.sync(hill());
    visuals.update(0.05);
    renderer.render(scene, camera);
    const ringPrograms = programIds(renderer).filter((id) => !baseline.includes(id));
    expect(ringPrograms).toHaveLength(2);
    // The hill ends: with nothing else holding them, the programs only park in
    // the FIFO, one eviction away from the next hill linking them cold.
    visuals.sync(null);
    renderer.render(scene, camera);
    for (const id of ringPrograms) expect(retainedIds(renderer)).toContain(id);
  });

  it.each([
    ['direct tier (canvas)', false],
    ['composer tier (render target)', true],
  ])(
    '%s: after the twin compiles, every ring of the session links nothing',
    async (_tier, offscreen) => {
      const { renderer, target, compileTarget, scene, camera } = setup();
      const bound = offscreen ? target : null;
      const compileBound = offscreen ? compileTarget : null;
      const draw = () => {
        renderer.setRenderTarget(bound);
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);
        return renderer.info.render.triangles;
      };
      const ringInScene = () => scene.getObjectByName('hill-ring')?.parent === scene;
      const compiled: Promise<unknown>[] = [];
      const gate = (root: THREE.Object3D) => {
        renderer.setRenderTarget(compileBound);
        const linked = renderer.compileAsync(root, camera, scene);
        renderer.setRenderTarget(null);
        compiled.push(linked);
        return linked;
      };
      const visuals = new HillRingVisuals(scene, gate, () => 0);
      expect(draw()).toBe(0);
      const beforeHill = programIds(renderer);

      // The announcement frame builds the live ring and hands the twin to the
      // gate; the draw here waits for the twin, as a player not yet facing the
      // spot does.
      visuals.sync(hill());
      expect(compiled).toHaveLength(1);
      await Promise.all(compiled);
      const afterTwin = programIds(renderer);
      expect(afterTwin.length).toBeGreaterThan(beforeHill.length);

      visuals.update(0.05);
      expect(ringInScene()).toBe(true);
      expect(draw()).toBeGreaterThan(0);
      expect(programIds(renderer)).toEqual(afterTwin);

      visuals.sync(hill({ phase: 'active', holder: 'you', challenger: 'other' }));
      visuals.update(0.3);
      expect(draw()).toBeGreaterThan(0);
      expect(programIds(renderer)).toEqual(afterTwin);

      visuals.sync(null);
      expect(draw()).toBe(0);
      const twinPrograms = afterTwin.filter((id) => !beforeHill.includes(id));
      expect(twinPrograms).toHaveLength(2);
      for (const id of twinPrograms) {
        expect(programIds(renderer)).toContain(id);
        expect(retainedIds(renderer)).not.toContain(id);
      }

      visuals.sync(hill({ x: 20, z: -10 }));
      visuals.update(0.05);
      expect(ringInScene()).toBe(true);
      expect(draw()).toBeGreaterThan(0);
      expect(compiled).toHaveLength(1);
      expect(programIds(renderer)).toEqual(afterTwin);
    },
  );
});
