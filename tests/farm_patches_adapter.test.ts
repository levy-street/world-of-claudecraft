// The farm patch ADAPTER (the three.js half): that the static beds seat every
// bed, that the throttled per-viewer sync really is fieldwise and allocation
// free, that the sway rides ON TOP of the terrain tilt, and that each farm
// event reaches the right emitter for the right viewer.
//
// Runs headless with no WebGL: three.js builds a scene graph perfectly well
// without a context, and the module's preload block is window-gated, so every
// GLB here resolves through the primitive-box fallback. That is deliberate
// coverage, not a shortcut: the fallback is the path the game itself takes on
// the frames before the assets land.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildFarmPatchProps,
  type FarmBedSeat,
  FarmPatchVisuals,
  type FarmPlotSource,
} from '../src/render/farm_patches';
import { FARM_PATCHES } from '../src/sim/content/farm_patches';
import type { SimEvent } from '../src/sim/types';
import type { FarmPlotView } from '../src/world_api/farming';

const HOUR = 60 * 60 * 1000;
const SEED = 1234;
const VIEWER_PID = 1;
// One full sync interval (FARM_SYNC_INTERVAL_S), so a sync call really reads.
const READ_DT = 0.5;

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

/**
 * A world stub that COUNTS reads of myFarmPlots, which is how the throttle
 * arms below prove the read was skipped rather than merely that nothing was
 * rebuilt (the offline getter projects and sorts on every access, so the read
 * itself is the cost being avoided).
 */
function fakeWorld(rows: readonly FarmPlotView[], nowMs = 0) {
  const state = { rows, nowMs, reads: 0 };
  const source: FarmPlotSource = {
    get myFarmPlots() {
      state.reads++;
      return state.rows;
    },
    farmNowMs: () => state.nowMs,
  };
  return { state, source };
}

/** Records which emitter each event reached, so the arms are distinguishable. */
function recordingVfx() {
  const calls: string[] = [];
  return {
    calls,
    sink: {
      burst: () => calls.push('burst'),
      groundPuff: () => calls.push('puff'),
    },
  };
}

describe('farm patch static props', () => {
  it('seats EVERY bed in the live table, once', () => {
    const { group, seats } = buildFarmPatchProps(SEED, FARM_PATCHES);
    const bedIds = FARM_PATCHES.flatMap((p) => p.beds.map((b) => b.id));
    expect(seats.size).toBe(bedIds.length);
    for (const id of bedIds) expect(seats.has(id), `no seat for ${id}`).toBe(true);
    expect(group.children.length).toBeGreaterThan(0);
  });

  it('seats each bed at its own authored (x, z) on finite ground', () => {
    const { seats } = buildFarmPatchProps(SEED, FARM_PATCHES);
    for (const patch of FARM_PATCHES) {
      for (const bed of patch.beds) {
        const seat = seats.get(bed.id);
        expect(seat).toBeDefined();
        if (!seat) continue;
        expect(seat.x).toBe(bed.x);
        expect(seat.z).toBe(bed.z);
        expect(Number.isFinite(seat.y), `${bed.id} has no ground height`).toBe(true);
        expect(seat.patchId).toBe(patch.id);
      }
    }
  });

  it('builds nothing at all for a world with no patches', () => {
    const { group, seats } = buildFarmPatchProps(SEED, []);
    expect(seats.size).toBe(0);
    expect(group.children.length).toBe(0);
  });
});

describe('farm patch per-viewer visuals', () => {
  it('creates one group per planted bed and disposes it when the plot goes', () => {
    const scene = new THREE.Scene();
    const { seats } = buildFarmPatchProps(SEED, FARM_PATCHES);
    const visuals = new FarmPatchVisuals(scene, seats, recordingVfx().sink);
    const { state, source } = fakeWorld([plot()]);

    visuals.sync(source, READ_DT);
    expect(scene.children.length).toBe(1);

    // Harvested: the row leaves myFarmPlots and the crop must leave the scene.
    state.rows = [];
    state.nowMs = HOUR;
    visuals.sync(source, READ_DT);
    expect(scene.children.length).toBe(0);
  });

  it('does NOT rebuild while the key holds, and DOES when it moves', () => {
    const scene = new THREE.Scene();
    const { seats } = buildFarmPatchProps(SEED, FARM_PATCHES);
    const visuals = new FarmPatchVisuals(scene, seats, recordingVfx().sink);
    const { state, source } = fakeWorld([plot()]);

    visuals.sync(source, READ_DT);
    const first = scene.children[0];
    expect(state.reads).toBe(1);

    // A later nowMs inside the same stage and wet band, and a FRESH row object
    // with identical content: the Sim allocates new rows on every read, so
    // anything comparing by reference would rebuild here. Nothing may change.
    state.rows = [plot()];
    state.nowMs = 1;
    visuals.sync(source, READ_DT);
    expect(state.reads).toBe(2);
    expect(scene.children[0]).toBe(first);

    state.rows = [plot()];
    state.nowMs = 2;
    visuals.sync(source, READ_DT);
    expect(scene.children[0]).toBe(first);

    // A real stage change rebuilds, and leaves exactly one group behind.
    state.nowMs = (2 * HOUR) / 3;
    visuals.sync(source, READ_DT);
    expect(scene.children[0]).not.toBe(first);
    expect(scene.children.length).toBe(1);
  });

  it('throttles the plot-set READ, not merely the rebuild', () => {
    const scene = new THREE.Scene();
    const { seats } = buildFarmPatchProps(SEED, FARM_PATCHES);
    const visuals = new FarmPatchVisuals(scene, seats, recordingVfx().sink);
    const { state, source } = fakeWorld([plot()]);

    // The first frame always reads, so a freshly built world is never blank.
    visuals.sync(source, 0);
    expect(state.reads).toBe(1);

    // Twenty-nine frames at 60 fps is 0.483s, short of the interval: the
    // getter must not be touched on any of them.
    for (let i = 0; i < 29; i++) visuals.sync(source, 1 / 60);
    expect(state.reads, 'the getter was read inside the interval').toBe(1);

    // Two more frames carry the accumulator past 0.5s (thirty frames of 1/60
    // land a float hair SHORT of it, which is why this is not exactly 30).
    // The gate then opens exactly once: it resets on the read, so the second
    // frame must not read again.
    visuals.sync(source, 1 / 60);
    visuals.sync(source, 1 / 60);
    expect(state.reads).toBe(2);
  });

  it('a farm event forces the very next frame to read', () => {
    const scene = new THREE.Scene();
    const { seats } = buildFarmPatchProps(SEED, FARM_PATCHES);
    const visuals = new FarmPatchVisuals(scene, seats, recordingVfx().sink);
    const { state, source } = fakeWorld([plot()]);

    visuals.sync(source, READ_DT);
    expect(state.reads).toBe(1);
    // Mid-interval: without the event this frame would skip the read.
    visuals.sync(source, 1 / 60);
    expect(state.reads).toBe(1);

    visuals.onFarmEvent(
      { type: 'farmHarvested', pid: VIEWER_PID, bedId: 'bed_eastbrook_1' } as unknown as SimEvent,
      VIEWER_PID,
    );
    state.rows = [];
    visuals.sync(source, 1 / 60);
    expect(state.reads, 'a harvest must not wait out the throttle').toBe(2);
    expect(scene.children.length, 'the harvested bed must go bare at once').toBe(0);
  });

  it('ignores a plot on a bed this build does not know', () => {
    const scene = new THREE.Scene();
    const { seats } = buildFarmPatchProps(SEED, FARM_PATCHES);
    const visuals = new FarmPatchVisuals(scene, seats, recordingVfx().sink);
    visuals.sync(fakeWorld([plot({ bedId: 'bed_retired_9' })]).source, READ_DT);
    expect(scene.children.length).toBe(0);
  });

  it('holds a plot per bed, so two planted beds are two groups', () => {
    const scene = new THREE.Scene();
    const { seats } = buildFarmPatchProps(SEED, FARM_PATCHES);
    const visuals = new FarmPatchVisuals(scene, seats, recordingVfx().sink);
    const rows = [plot(), plot({ bedId: 'bed_eastbrook_2', cropId: 'brook_carrot' })];
    visuals.sync(fakeWorld(rows).source, READ_DT);
    expect(scene.children.length).toBe(2);
    visuals.dispose();
    expect(scene.children.length).toBe(0);
  });
});

describe('idle sway', () => {
  // A deliberately steep seat: the normal the reviewer measured the bug on.
  const TILTED_NORMAL = new THREE.Vector3(0.3, 1, 0.25).normalize();
  const WORLD_UP = new THREE.Vector3(0, 1, 0);

  function tiltedSeats(): Map<string, FarmBedSeat> {
    const quat = new THREE.Quaternion().setFromUnitVectors(WORLD_UP, TILTED_NORMAL);
    return new Map([
      [
        'bed_eastbrook_1',
        { x: 0, y: 0, z: 0, quat, patchId: 'patch_eastbrook', zoneId: 'eastbrook_vale' },
      ],
    ]);
  }

  /** The group's own up vector, which is what the terrain tilt is FOR. */
  function upOf(obj: THREE.Object3D): THREE.Vector3 {
    return WORLD_UP.clone().applyQuaternion(obj.quaternion);
  }

  it('keeps the crop standing on the ground it grows in while it sways', () => {
    const scene = new THREE.Scene();
    const seats = tiltedSeats();
    const visuals = new FarmPatchVisuals(scene, seats, recordingVfx().sink);
    visuals.sync(fakeWorld([plot()]).source, READ_DT);
    const group = scene.children[0];

    const seatUp = TILTED_NORMAL.clone();
    // Seated: exactly the ground normal, before any sway has run.
    expect(upOf(group).angleTo(seatUp)).toBeLessThan(1e-6);

    // The sway may only ever lean the crop by its own small amplitude. Writing
    // group.rotation.z instead would rebuild the quaternion from Euler angles
    // and DISCARD the tilt, which on this normal is a 18.6 degree divergence:
    // far outside the tolerance below, so this arm catches that regression.
    const maxLean = 0.06; // the largest SWAY_AMPLITUDE plus a hair
    for (let i = 0; i < 40; i++) {
      visuals.update(0.1);
      const lean = upOf(group).angleTo(seatUp);
      expect(lean, `sway left the ground normal on frame ${i}`).toBeLessThanOrEqual(maxLean);
      // ...and the crop must still be tilted at all: never snapped upright.
      expect(upOf(group).angleTo(WORLD_UP)).toBeGreaterThan(0.1);
    }
  });

  it('actually moves a growing crop and leaves a withered one still', () => {
    const scene = new THREE.Scene();
    const visuals = new FarmPatchVisuals(scene, tiltedSeats(), recordingVfx().sink);
    const { state, source } = fakeWorld([plot()]);

    visuals.sync(source, READ_DT);
    const growing = scene.children[0];
    const before = growing.quaternion.clone();
    visuals.update(0.5);
    expect(growing.quaternion.angleTo(before)).toBeGreaterThan(1e-4);

    state.rows = [plot({ status: 'withered' })];
    state.nowMs = HOUR;
    visuals.sync(source, READ_DT);
    const dead = scene.children[0];
    const deadBefore = dead.quaternion.clone();
    visuals.update(0.5);
    expect(dead.quaternion.angleTo(deadBefore), 'dead stalks do not sway').toBe(0);
  });
});

describe('farm event flourishes', () => {
  const ev = (over: Record<string, unknown>): SimEvent =>
    ({
      pid: VIEWER_PID,
      bedId: 'bed_eastbrook_1',
      cropId: 'vale_wheat',
      ...over,
    }) as unknown as SimEvent;

  function harness() {
    const scene = new THREE.Scene();
    const { seats } = buildFarmPatchProps(SEED, FARM_PATCHES);
    const vfx = recordingVfx();
    return { visuals: new FarmPatchVisuals(scene, seats, vfx.sink), calls: vfx.calls };
  }

  it('turns soil then shows green on a plant', () => {
    const { visuals, calls } = harness();
    visuals.onFarmEvent(ev({ type: 'farmPlanted' }), VIEWER_PID);
    expect(calls).toEqual(['puff', 'burst']);
  });

  it('sparkles on a harvest', () => {
    const { visuals, calls } = harness();
    visuals.onFarmEvent(
      ev({ type: 'farmHarvested', itemId: 'vale_wheat_grain', count: 3 }),
      VIEWER_PID,
    );
    expect(calls).toEqual(['burst']);
  });

  it('puffs grey dust on a wither, with no sparkle', () => {
    const { visuals, calls } = harness();
    visuals.onFarmEvent(ev({ type: 'farmWithered', count: 1 }), VIEWER_PID);
    expect(calls).toEqual(['puff']);
  });

  it('emits NOTHING for a farm event belonging to another player', () => {
    // Routing already scopes these to their owner; this makes the invariant
    // local, so a future broadcast cannot puff soil on a stranger's bed.
    const { visuals, calls } = harness();
    visuals.onFarmEvent(ev({ type: 'farmPlanted', pid: VIEWER_PID + 1 }), VIEWER_PID);
    expect(calls).toEqual([]);
    visuals.onFarmEvent(ev({ type: 'farmHarvested', pid: 999 }), VIEWER_PID);
    expect(calls).toEqual([]);
    // ...and the viewer's own event on the same harness still fires, so the
    // guard is not simply swallowing everything.
    visuals.onFarmEvent(ev({ type: 'farmPlanted' }), VIEWER_PID);
    expect(calls).toEqual(['puff', 'burst']);
  });

  it('emits nothing for an unknown bed or a non-farm event', () => {
    const { visuals, calls } = harness();
    visuals.onFarmEvent(ev({ type: 'farmPlanted', bedId: 'bed_retired_9' }), VIEWER_PID);
    expect(calls).toEqual([]);
    visuals.onFarmEvent(ev({ type: 'levelUp' }), VIEWER_PID);
    expect(calls).toEqual([]);
  });
});
