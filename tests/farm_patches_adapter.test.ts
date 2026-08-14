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
import { afterEach, describe, expect, it } from 'vitest';
import { attachBiomeHaze } from '../src/render/biome_haze_field';
import {
  buildFarmPatchProps,
  type FarmBedSeat,
  FarmPatchVisuals,
  type FarmPlotSource,
  farmPatchesPreloadInternalsForTest,
} from '../src/render/farm_patches';
import {
  FARM_ACCENT_MESH_NAME,
  FARM_SOIL_SOCKET_NAME,
  farmStageModelUrl,
  resolveFarmPlotVisual,
} from '../src/render/farm_patches_core';
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

  it('a FOREIGN farm event does not arm the forced read (the dirty flag sits below the guard)', () => {
    // The emitter arm above proves the flourish is suppressed; this proves the
    // THROTTLE is too: hoisting `this.dirty = true` above the pid guard would
    // let strangers' events defeat the read cadence while every committed
    // emitter assertion stayed green.
    const scene = new THREE.Scene();
    const { seats } = buildFarmPatchProps(SEED, FARM_PATCHES);
    const visuals = new FarmPatchVisuals(scene, seats, recordingVfx().sink);
    const { state, source } = fakeWorld([plot()]);
    visuals.sync(source, READ_DT);
    expect(state.reads).toBe(1);
    visuals.onFarmEvent(ev({ type: 'farmPlanted', pid: VIEWER_PID + 1 }), VIEWER_PID);
    visuals.sync(source, 1 / 60);
    expect(state.reads, 'a foreign event must not force a read').toBe(1);
  });
});

describe('event-forced read vs the online message order', () => {
  // Online the farm event and the fplot rows arrive as TWO ws messages in a
  // fixed order (events first), so a render frame can land between them: the
  // forced read then sees the PRE-change rows. The flag must survive that
  // stale read and clear only when the change actually shows up, bounded at
  // one full interval so a change that never arrives cannot pin the read to
  // every frame forever.
  it('stays armed across a stale read and applies the change the moment it lands', () => {
    const scene = new THREE.Scene();
    const { seats } = buildFarmPatchProps(SEED, FARM_PATCHES);
    const visuals = new FarmPatchVisuals(scene, seats, recordingVfx().sink);
    const { state, source } = fakeWorld([plot()]);

    visuals.sync(source, READ_DT);
    expect(state.reads).toBe(1);
    expect(scene.children.length).toBe(1);

    // The harvest event frame arrives; the fplot rows have NOT yet.
    visuals.onFarmEvent(
      { type: 'farmHarvested', pid: VIEWER_PID, bedId: 'bed_eastbrook_1' } as unknown as SimEvent,
      VIEWER_PID,
    );
    visuals.sync(source, 1 / 60);
    expect(state.reads, 'the event must force a read even into stale rows').toBe(2);
    expect(scene.children.length, 'stale rows: the crop rightly still stands').toBe(1);

    // Still armed: the next frame reads again rather than waiting out the
    // throttle, and the change applies the instant the rows carry it.
    state.rows = [];
    visuals.sync(source, 1 / 60);
    expect(state.reads, 'the armed read must survive a stale read').toBe(3);
    expect(scene.children.length, 'the harvested bed goes bare on the row frame').toBe(0);

    // Observed: disarmed, the cadence takes back over.
    visuals.sync(source, 1 / 60);
    expect(state.reads, 'a mid-interval frame after the change must not read').toBe(3);
  });

  it('bounds the armed read at one interval when the change never arrives', () => {
    const scene = new THREE.Scene();
    const { seats } = buildFarmPatchProps(SEED, FARM_PATCHES);
    const visuals = new FarmPatchVisuals(scene, seats, recordingVfx().sink);
    const { state, source } = fakeWorld([plot()]);

    visuals.sync(source, READ_DT);
    expect(state.reads).toBe(1);
    // An event whose row change never lands (the rows never move).
    visuals.onFarmEvent(
      { type: 'farmWithered', pid: VIEWER_PID, bedId: 'bed_eastbrook_1' } as unknown as SimEvent,
      VIEWER_PID,
    );
    // 1/32 is binary-exact, so sixteen frames accumulate to exactly the 0.5s
    // interval with no float hair: every armed frame reads, and the sixteenth
    // read is the one that gives up the arming.
    for (let i = 0; i < 16; i++) visuals.sync(source, 1 / 32);
    expect(state.reads, 'armed frames read every frame up to the bound').toBe(17);
    visuals.sync(source, 1 / 32);
    expect(state.reads, 'past the bound the cadence is back in charge').toBe(17);
  });
});

describe('the GLB-loaded adapter branch (synthetic scenes, no file IO)', () => {
  afterEach(() => farmPatchesPreloadInternalsForTest.clearLoaded());

  const IDENTITY_QUAT = new THREE.Quaternion();
  function flatSeat(): Map<string, FarmBedSeat> {
    return new Map([
      [
        'bed_eastbrook_1',
        {
          x: 0,
          y: 0,
          z: 0,
          quat: IDENTITY_QUAT,
          patchId: 'patch_eastbrook',
          zoneId: 'eastbrook_vale',
        },
      ],
    ]);
  }

  /** A synthetic bed: a 0..1 yd body with the soil socket authored at y 0.6. */
  function syntheticBed(): THREE.Group {
    const bed = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(3, 1, 2),
      new THREE.MeshStandardMaterial({ color: 0x8a6a4a }),
    );
    body.position.y = 0.5;
    bed.add(body);
    const socket = new THREE.Object3D();
    socket.name = FARM_SOIL_SOCKET_NAME;
    socket.position.y = 0.6;
    bed.add(socket);
    return bed;
  }

  /** A synthetic stage export: a white body mesh plus the named accent mesh,
   *  the two-material shape the tint chain exists for. */
  function syntheticStage(): {
    group: THREE.Group;
    bodyGeo: THREE.BufferGeometry;
    accentGeo: THREE.BufferGeometry;
    bodyMat: THREE.MeshStandardMaterial;
    accentMat: THREE.MeshStandardMaterial;
  } {
    const group = new THREE.Group();
    const bodyGeo = new THREE.BoxGeometry(0.4, 1, 0.4);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.5;
    group.add(body);
    const accentGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const accentMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const accent = new THREE.Mesh(accentGeo, accentMat);
    accent.name = FARM_ACCENT_MESH_NAME;
    accent.position.y = 1.1;
    group.add(accent);
    return { group, bodyGeo, accentGeo, bodyMat, accentMat };
  }

  function loadSyntheticFor(view: FarmPlotView, nowMs: number) {
    const visual = resolveFarmPlotVisual(view, nowMs);
    const stage = syntheticStage();
    farmPatchesPreloadInternalsForTest.setLoaded(
      farmStageModelUrl(visual.family, visual.stageMesh),
      stage.group,
    );
    return { visual, stage };
  }

  it('mounts the plot at the bed GLB soil socket, not the fallback lift', () => {
    // Socket authored at y 0.6 in a 1 yd bed, normalized to BED_HEIGHT 0.35:
    // the mount height is 0.6 x 0.35 = 0.21, nowhere near the 0.3 fallback.
    farmPatchesPreloadInternalsForTest.setLoaded(
      farmPatchesPreloadInternalsForTest.bedUrl,
      syntheticBed(),
    );
    const scene = new THREE.Scene();
    const visuals = new FarmPatchVisuals(scene, flatSeat(), recordingVfx().sink);
    visuals.sync(fakeWorld([plot()], 1).source, READ_DT);
    expect(scene.children.length).toBe(1);
    expect(scene.children[0].position.y).toBeCloseTo(0.21, 5);
  });

  it('tints the accent mesh to the crop accent and darkens the body by the wet band, in one build', () => {
    const view = plot();
    const nowMs = 1; // freshly planted: the deepest wet band
    const { visual, stage } = loadSyntheticFor(view, nowMs);
    expect(visual.wetBand, 'the fixture must sit in the deep wet band').toBe(2);

    const scene = new THREE.Scene();
    const visuals = new FarmPatchVisuals(scene, flatSeat(), recordingVfx().sink);
    visuals.sync(fakeWorld([view], nowMs).source, READ_DT);

    const meshes: THREE.Mesh[] = [];
    scene.children[0].traverse((o) => {
      if (o instanceof THREE.Mesh) meshes.push(o);
    });
    expect(meshes).toHaveLength(2);
    // The built meshes carry only the accent FLAG, not the source names, so
    // the parts identify by the shared geometry they keep.
    const accentMesh = meshes.find((m) => m.geometry === stage.accentGeo);
    const bodyMesh = meshes.find((m) => m.geometry === stage.bodyGeo);
    expect(accentMesh).toBeDefined();
    expect(bodyMesh).toBeDefined();
    if (!accentMesh || !bodyMesh) return;

    // The accent part carries the per-crop identity color, verbatim.
    const accentColor = (accentMesh.material as THREE.MeshStandardMaterial).color;
    expect(accentColor.getHex()).toBe(visual.accent);
    // The body part is the white source darkened by the band-2 damp factor
    // (0.72, the WET_SOIL_DARKEN literal), never the accent.
    const bodyColor = (bodyMesh.material as THREE.MeshStandardMaterial).color;
    expect(bodyColor.r).toBeCloseTo(0.72, 5);
    expect(bodyColor.getHex()).not.toBe(visual.accent);
    // Both are CLONES: the synthetic source materials stay untinted, so the
    // next plot of this stage starts from clean templates.
    expect(stage.accentMat.color.getHex()).toBe(0xffffff);
    expect(stage.bodyMat.color.getHex()).toBe(0xffffff);
  });

  it('never disposes shared GLB geometry when a plot goes', () => {
    const view = plot();
    const { stage } = loadSyntheticFor(view, 1);
    let disposed = 0;
    const realDispose = stage.bodyGeo.dispose.bind(stage.bodyGeo);
    stage.bodyGeo.dispose = () => {
      disposed++;
      realDispose();
    };
    const scene = new THREE.Scene();
    const visuals = new FarmPatchVisuals(scene, flatSeat(), recordingVfx().sink);
    const { state, source } = fakeWorld([view], 1);
    visuals.sync(source, READ_DT);
    expect(scene.children.length).toBe(1);
    state.rows = [];
    visuals.sync(source, READ_DT);
    expect(scene.children.length).toBe(0);
    expect(disposed, 'shared GLB geometry must outlive any one plot').toBe(0);
  });

  it('keeps the zone-haze hook and its program cache key on the per-plot clone', () => {
    // The real attach, on the synthetic stage material: a bare Material.clone()
    // copies the wocZoneHaze userData marker but silently DROPS onBeforeCompile
    // and the cache key, which is exactly the regression this arm pins out
    // (tintOne must go through cloneMaterialWithHooks).
    const view = plot();
    const { stage } = loadSyntheticFor(view, 1);
    attachBiomeHaze(stage.bodyMat);
    const sourceKey = stage.bodyMat.customProgramCacheKey();
    expect(sourceKey, 'the fixture hook must be live').toContain('woc-zone-haze');

    const scene = new THREE.Scene();
    const visuals = new FarmPatchVisuals(scene, flatSeat(), recordingVfx().sink);
    visuals.sync(fakeWorld([view], 1).source, READ_DT);
    const meshes: THREE.Mesh[] = [];
    scene.children[0].traverse((o) => {
      if (o instanceof THREE.Mesh) meshes.push(o);
    });
    const bodyMesh = meshes.find((m) => m.geometry === stage.bodyGeo);
    expect(bodyMesh).toBeDefined();
    if (!bodyMesh) return;
    const cloned = bodyMesh.material as THREE.MeshStandardMaterial;
    expect(cloned.customProgramCacheKey(), 'the clone must keep the haze program identity').toBe(
      sourceKey,
    );
    expect(
      cloned.onBeforeCompile,
      'the clone must carry a real hook, not the prototype default',
    ).not.toBe(new THREE.MeshStandardMaterial().onBeforeCompile);
  });
});
