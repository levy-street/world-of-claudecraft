// First mechanic onset of the Ignivar visuals on a real WebGL driver: the
// browser half of the interior encounter prewarm staging in
// tests/interior_encounter_prewarm_pass.test.ts. The mechanic visuals are
// built lazily during per-frame encounter sync, AFTER the view compile-gate
// enumeration, so without the staged prewarm their first onset links programs
// inside a live frame. Observable directly here: renderer.info.programs.length
// grows when a draw links a program, so the control leg (no prewarm compiled)
// proves the harness sees the onset links, and the prewarmed leg proves the
// staged groups cover the exact programs the live reveal asks for, the unique
// Forge Judgment charred-ground shader and fire-beam shells included.
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { syncIgnivarBrandTelegraph } from '../../src/render/ignivar_brand_telegraph';
import {
  buildIgnivarBrandCircle,
  buildIgnivarEncounterPrewarmVisual,
  buildIgnivarFrontalTelegraph,
  buildIgnivarRotatingRaysTelegraph,
  buildIgnivarSkyfireTelegraph,
} from '../../src/render/ignivar_encounter';
import {
  type IgnivarForgeChainVisualEntity,
  syncIgnivarForgeChainVisual,
} from '../../src/render/ignivar_forge_chains';
import {
  buildIgnivarForgeJudgmentPrewarmVisual,
  buildIgnivarForgeJudgmentVisual,
  syncIgnivarForgeJudgmentVisual,
} from '../../src/render/ignivar_forge_judgment';
import {
  buildIgnivarForgeWaveVisual,
  syncIgnivarForgeWaveVisual,
} from '../../src/render/ignivar_forge_wave';
import { syncIgnivarFrontalTelegraph } from '../../src/render/ignivar_frontal_telegraph';
import {
  buildIgnivarRotatingRaysPrewarmVisual,
  syncIgnivarRotatingRaysTelegraph,
} from '../../src/render/ignivar_rotating_rays';
import { IGNIVAR_FORGE_CHAINS_AURA_ID } from '../../src/sim/ignivar_forge_chains';

type ProgramDiagnostics = { diagnostics?: { runnable?: boolean } };

const WIDTH = 320;
const HEIGHT = 240;

let dispose: (() => void) | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
});

function makeRenderer(): { renderer: THREE.WebGLRenderer; canvas: HTMLCanvasElement } {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  return { renderer, canvas };
}

function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 0.1, 400);
  camera.position.set(0, 26, 42);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return camera;
}

function countLitPixels(renderer: THREE.WebGLRenderer): number {
  const gl = renderer.getContext();
  const rgba = new Uint8Array(WIDTH * HEIGHT * 4);
  gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  expect(gl.getError()).toBe(gl.NO_ERROR);
  let lit = 0;
  for (let index = 0; index < WIDTH * HEIGHT; index++) {
    if (rgba[index * 4] + rgba[index * 4 + 1] + rgba[index * 4 + 2] > 20) lit++;
  }
  return lit;
}

/**
 * Attaches the mechanic visuals the way the lazy per-frame encounter sync
 * does (built hidden on the entity group, revealed only at onset), then
 * drives every first onset through the REAL sync functions. The chain rides
 * its production build-on-first-aura path inside syncIgnivarForgeChainVisual.
 */
function attachLazyMechanicVisuals(scene: THREE.Scene) {
  const frontal = buildIgnivarFrontalTelegraph();
  const skyfire = buildIgnivarSkyfireTelegraph();
  const rays = buildIgnivarRotatingRaysTelegraph();
  const wave = buildIgnivarForgeWaveVisual();
  const judgment = buildIgnivarForgeJudgmentVisual();
  const brand = buildIgnivarBrandCircle();
  brand.position.set(10, 0, 10);
  const chainOwner = new THREE.Group();
  chainOwner.position.set(-10, 0, 10);
  const chainPartner = new THREE.Group();
  chainPartner.position.set(-4, 0, 10);
  scene.add(frontal, skyfire, rays, wave, judgment, brand, chainOwner, chainPartner);
  const revealAtOnset = (): void => {
    syncIgnivarFrontalTelegraph(frontal, true, 0.5, 1, 0);
    skyfire.visible = true;
    syncIgnivarRotatingRaysTelegraph(rays, 'active', 1, 1);
    syncIgnivarForgeWaveVisual(wave, 'active', 0.5, 3, 1);
    syncIgnivarForgeJudgmentVisual(judgment, 'active', 0, 0, 1, 1, true);
    syncIgnivarBrandTelegraph(brand, true, 2, 1, 1, 0);
    const chained: IgnivarForgeChainVisualEntity = {
      id: 1,
      kind: 'player',
      auras: [{ id: IGNIVAR_FORGE_CHAINS_AURA_ID, value2: 2, remaining: 10, duration: 12 }],
    };
    syncIgnivarForgeChainVisual(chainOwner, chained, new Map([[2, { group: chainPartner }]]), 0);
  };
  return revealAtOnset;
}

describe('Ignivar mechanic visual prewarm on a real WebGL driver', () => {
  it('control: without the prewarm, first onset links programs inside the reveal frame', () => {
    const { renderer, canvas } = makeRenderer();
    dispose = () => {
      renderer.dispose();
      canvas.remove();
    };
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    const camera = makeCamera();
    const revealAtOnset = attachLazyMechanicVisuals(scene);

    // The pre-onset state: everything attached hidden, nothing linked yet.
    renderer.render(scene, camera);
    const baseline = renderer.info.programs?.length ?? 0;

    // First onset: the reveal frame itself pays every cold program link.
    revealAtOnset();
    renderer.render(scene, camera);
    expect(renderer.info.programs?.length ?? 0).toBeGreaterThan(baseline);
    expect(countLitPixels(renderer)).toBeGreaterThan(0);
  });

  it('prewarmed: Judgment, the telegraphs, and the chains link zero new programs at onset', () => {
    const { renderer, canvas } = makeRenderer();
    dispose = () => {
      renderer.dispose();
      canvas.remove();
    };
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    const camera = makeCamera();

    // The staged groups, hidden exactly the way the interior encounter prewarm
    // pass holds them, compiled the way compileEncounterPrewarmGroup links
    // them (compile traverses hidden objects too).
    const staged = new THREE.Group();
    staged.name = 'interior-encounter-prewarm';
    staged.visible = false;
    staged.add(
      buildIgnivarEncounterPrewarmVisual(),
      buildIgnivarRotatingRaysPrewarmVisual(),
      buildIgnivarForgeJudgmentPrewarmVisual(),
    );
    scene.add(staged);
    renderer.compile(scene, camera);
    const programs = renderer.info.programs as ProgramDiagnostics[] | null;
    const prewarmed = programs?.length ?? 0;
    expect(prewarmed).toBeGreaterThan(0);
    expect(programs?.filter((program) => program.diagnostics?.runnable === false)).toHaveLength(0);

    // A frame with the staged groups still hidden draws and links nothing new.
    renderer.render(scene, camera);
    expect(renderer.info.programs?.length ?? 0).toBe(prewarmed);

    // The live visuals arrive later, built by the same lazy sync paths as the
    // control leg, and their first onset frame links ZERO new programs: the
    // staged builds already linked every program this reveal draw asks for.
    const revealAtOnset = attachLazyMechanicVisuals(scene);
    revealAtOnset();
    renderer.render(scene, camera);
    expect(renderer.info.programs?.length ?? 0).toBe(prewarmed);
    expect(countLitPixels(renderer)).toBeGreaterThan(0);
  });
});
