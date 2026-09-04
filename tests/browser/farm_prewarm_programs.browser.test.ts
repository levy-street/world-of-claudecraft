// The farm patch producer on a real WebGL driver (the browser half of
// tests/farm_patches_adapter.test.ts's prepared-producer suite; the
// ignivar_prewarm_programs pattern). renderer.info.programs.length grows when a
// draw links a program, so the CONTROL leg (no gate, no anchors: the pre-phase
// 18 module) proves the harness sees a plot's first draw link cold and its
// rebuild survive ONLY on the three patch's bounded retention FIFO
// (info.retainedPrograms, RETAINED_PROGRAM_LIMIT deep, eviction by churn), and
// the PREPARED leg proves the program anchors staged at construction plus the
// gated attach leave a plant, a stage advance, a wet-band flip and a feast
// linking ZERO programs at their first draw, with no farm program ever parked
// in that FIFO at all.
//
// The GLBs are not loaded here (the preload lane never opens), so every farm
// mesh is the primitive-box fallback wearing a gfx surfaceMat clone: the same
// mechanism the shipped GLB materials ride (cloneMaterialWithHooks keeps the
// program key, three releases a program with its last material, an anchor
// wearing the source keeps it), proved on the one material set a browser suite
// can build.
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildFarmPatchProps,
  type FarmCompileGate,
  FarmPatchVisuals,
  type FarmPlotSource,
} from '../../src/render/farm_patches';
import { FARM_PATCHES } from '../../src/sim/content/farm_patches';
import type { Entity } from '../../src/sim/types';
import type { FarmPlotView } from '../../src/world_api/farming';

const WIDTH = 320;
const HEIGHT = 240;
const HOUR = 60 * 60 * 1000;
const SEED = 1234;

let dispose: (() => void) | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
});

function makeRenderer(): { renderer: THREE.WebGLRenderer; canvas: HTMLCanvasElement } {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT, false);
  return { renderer, canvas };
}

function makeCamera(at: { x: number; y: number; z: number }): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 0.1, 400);
  camera.position.set(at.x + 6, at.y + 8, at.z + 10);
  camera.lookAt(at.x, at.y, at.z);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return camera;
}

function plot(over: Partial<FarmPlotView> = {}): FarmPlotView {
  return {
    bedId: 'bed_eastbrook_1',
    cropId: 'vale_wheat',
    plantedAtMs: 0,
    readyAtMs: HOUR,
    compost: false,
    watch: false,
    tonic: false,
    notified: false,
    status: 'growing',
    ...over,
  };
}

function world(rows: FarmPlotView[]) {
  const state = { rows, nowMs: 0, entities: new Map<number, Entity>() };
  const source: FarmPlotSource = {
    get myFarmPlots() {
      return state.rows;
    },
    farmNowMs: () => state.nowMs,
    entities: state.entities,
    cfg: { seed: SEED },
  };
  return { state, source };
}

function feast(id: number, at: { x: number; z: number }): Entity {
  return {
    id,
    kind: 'object',
    templateId: 'farm_feast',
    name: 'Mira',
    pos: { x: at.x, y: 0, z: at.z },
  } as Entity;
}

const programCount = (renderer: THREE.WebGLRenderer): number => renderer.info.programs?.length ?? 0;

type RetainingInfo = { retainedPrograms?: { id: number }[] };

describe('farm patch programs on a real WebGL driver', () => {
  it('control: without the gate and the anchors, the first plot links at its draw and a rebuild lives on the bounded retention FIFO alone', () => {
    const { renderer, canvas } = makeRenderer();
    dispose = () => {
      renderer.dispose();
      canvas.remove();
    };
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1));
    const beds = buildFarmPatchProps(SEED, FARM_PATCHES);
    scene.add(beds.group);
    const seat = beds.seats.get('bed_eastbrook_1');
    if (!seat) throw new Error('bed_eastbrook_1 has no seat');
    const camera = makeCamera(seat);
    const visuals = new FarmPatchVisuals(scene, beds.seats, { burst() {}, groundPuff() {} });
    const { state, source } = world([plot()]);

    renderer.render(scene, camera);
    const baseline = programCount(renderer);

    // The plant: a bare scene.add, so the first draw links the crop program.
    visuals.sync(source, 0.5);
    renderer.render(scene, camera);
    const afterPlant = programCount(renderer);
    expect(afterPlant).toBeGreaterThan(baseline);
    const retained = () => (renderer.info as RetainingInfo).retainedPrograms ?? [];
    expect(retained()).toHaveLength(0);

    // A stage advance disposes the only clone holding that program (the bed's
    // own instanced variant is a different program key), so three RELEASES it:
    // between the sync and the next draw the program sits parked in the
    // retention FIFO with no live use, one eviction (RETAINED_PROGRAM_LIMIT
    // releases of other programs: interest churn, a streamed town) away from
    // the next rebuild linking it cold. That parked window is exactly what
    // the anchors remove in the prepared leg.
    state.nowMs = HOUR / 2;
    visuals.sync(source, 0.5);
    const parked = retained();
    expect(parked.length).toBeGreaterThan(0);
    const parkedIds = new Set(parked.map((p) => p.id));
    renderer.render(scene, camera);
    // The rebuilt crop re-acquired the parked program (warm this time, only
    // because nothing evicted it in between): the FIFO empties again.
    expect(retained()).toHaveLength(0);
    const liveIds = new Set((renderer.info.programs ?? []).map((p) => (p as { id: number }).id));
    for (const id of parkedIds) expect(liveIds.has(id)).toBe(true);
  });

  it('prepared: the anchors and the gated attach leave a plant, a stage advance, a wet-band flip and a feast linking zero programs', async () => {
    const { renderer, canvas } = makeRenderer();
    dispose = () => {
      renderer.dispose();
      canvas.remove();
    };
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1));
    const beds = buildFarmPatchProps(SEED, FARM_PATCHES);
    scene.add(beds.group);
    const seat = beds.seats.get('bed_eastbrook_1');
    if (!seat) throw new Error('bed_eastbrook_1 has no seat');
    const camera = makeCamera(seat);
    // The host gate: three's own compile over the target against the live
    // scene (the renderer's compileGate colour arm, minus the queue).
    const gated: Promise<unknown>[] = [];
    const gate: FarmCompileGate = (target) => {
      const linked = renderer.compileAsync(target, camera, scene);
      gated.push(linked);
      return linked;
    };
    const visuals = new FarmPatchVisuals(scene, beds.seats, { burst() {}, groundPuff() {} }, gate);
    // The anchors' gate ran at construction: await it, then draw the (empty of
    // crops) scene once. Everything linked so far is preparation.
    expect(gated).toHaveLength(1);
    await Promise.all(gated);
    renderer.render(scene, camera);
    const prepared = programCount(renderer);
    expect(prepared).toBeGreaterThan(0);
    const programsAt = () =>
      new Set((renderer.info.programs ?? []).map((p) => (p as { id?: number }).id ?? p));
    const preparedSet = programsAt();

    const { state, source } = world([plot()]);
    const settle = async (): Promise<void> => {
      await Promise.all(gated);
      // the attach helper reveals on a microtask after the gate resolves
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    const expectNoNewPrograms = (step: string): void => {
      renderer.render(scene, camera);
      expect(programCount(renderer), `${step}: program count`).toBe(prepared);
      const now = programsAt();
      for (const id of now)
        expect(preparedSet.has(id), `${step}: new program ${String(id)}`).toBe(true);
    };

    // The plant.
    visuals.sync(source, 0.5);
    await settle();
    const crop = scene.children.find((c) => c.name === 'farmPlot:bed_eastbrook_1');
    expect(crop?.visible).toBe(true);
    expectNoNewPrograms('plant');
    // No farm program is ever parked in the retention FIFO: the anchors hold
    // a live use on every one of them through each rebuild below.
    const retained = () => (renderer.info as RetainingInfo).retainedPrograms ?? [];
    expect(retained()).toHaveLength(0);

    // The stage advance (the seedling replaces the sprout).
    state.nowMs = HOUR / 2;
    visuals.sync(source, 0.5);
    await settle();
    expectNoNewPrograms('stage advance');
    expect(
      retained(),
      'a farm program entered the retention FIFO despite the anchors',
    ).toHaveLength(0);

    // The wet-band flip (past 60 minutes since planting, still growing).
    state.rows = [plot({ plantedAtMs: -2 * HOUR, readyAtMs: 4 * HOUR })];
    state.nowMs = 0;
    visuals.sync(source, 0.5);
    await settle();
    expectNoNewPrograms('wet-band flip');

    // The feast table.
    state.entities.set(501, feast(501, { x: seat.x + 2, z: seat.z + 2 }));
    visuals.sync(source, 0.5);
    await settle();
    expect(scene.children.find((c) => c.name === 'farmFeast:501')?.visible).toBe(true);
    expectNoNewPrograms('feast');
  });
});
