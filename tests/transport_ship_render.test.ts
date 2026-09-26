import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MeshoptDecoder } from 'meshoptimizer';
import type * as THREE from 'three';
import { type GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setDitherFadeEnabledForTest } from '../src/render/occluder_dither_fade';
import { OCCLUDER_FADE_ALPHA } from '../src/render/occluder_fade_core';
import type { ShipWake } from '../src/render/ship_wake';
import { freezeStaticMatrices } from '../src/render/static_matrix';
import { buildScheduledShips } from '../src/render/transport_ferry_ships';
import {
  buildTransportShipView,
  isTransportShipKey,
  resetTransportShipCaches,
  type TransportShipView,
  transportShipInternalsForTest,
  transportShipPrewarmParts,
} from '../src/render/transport_ship';
import { TRANSPORT_SHIP_LOD_DISTANCES } from '../src/render/transport_ship_core';
import {
  EASTBROOK_NIGHTBLOOM_FERRY,
  TRANSPORT_ROUTES,
  TRANSPORT_SHIP_HULLS,
} from '../src/sim/content/transport_ships';
import {
  emptyTransportFerryView,
  type TransportPose,
  transportFerryViewAt,
  transportShipPoseAt,
  transportVoyageSeconds,
} from '../src/sim/transport_schedule';

// The moored transport ship view (src/render/transport_ship.ts) over the shipped
// Eastbrook ferry GLB: the static merge (a handful of draws per level), the live
// sails, masts and flags, the level-of-detail switch, the idle clip and its
// reduced-motion freeze, and the sail/mast fade when one stands between the eye
// and the chase camera.

const URL = '/models/props/eastbrook_ferry.glb';
const X = -125;
const Z = -54.8;
const BASE_Y = -4.3;
const internals = transportShipInternalsForTest;

async function loadGlb(): Promise<GLTF> {
  await MeshoptDecoder.ready;
  const bytes = readFileSync(path.join(__dirname, '..', 'public', URL.replace(/^\//, '')));
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return new Promise<GLTF>((resolve, reject) => loader.parse(ab, '', resolve, reject));
}

function build(): TransportShipView {
  const view = buildTransportShipView({ key: 'eastbrookFerry', x: X, z: Z, rot: 0, baseY: BASE_Y });
  if (!view) throw new Error('no view');
  return view;
}

function meshesUnder(o: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  o.traverse((n) => {
    if ((n as THREE.Mesh).isMesh) out.push(n as THREE.Mesh);
  });
  return out;
}

/** Update with the camera `d` yards east of the ship, looking at it. */
function updateAt(view: TransportShipView, d: number, dt = 0.05, reduced = false): void {
  view.update(X + d, BASE_Y + 10, Z, X, BASE_Y + 8, Z, 2000, dt, reduced);
}

beforeAll(async () => {
  internals.setLoadedGltfForTest(URL, await loadGlb());
});

afterAll(() => {
  internals.setLoadedGltfForTest(URL, null);
});

// The fade cases pin the blend arm (transparent at the ghost opacity); the dithered arm,
// the default below High since release/v0.44.0, is the shared occluder fade's own contract.
beforeEach(() => setDitherFadeEnabledForTest(false));
afterEach(() => setDitherFadeEnabledForTest(null));

describe('transport ship view', () => {
  it('knows exactly the ship keys the sim moors hulls for', () => {
    expect(Object.keys(internals.models).sort()).toEqual(Object.keys(TRANSPORT_SHIP_HULLS).sort());
    expect(isTransportShipKey('eastbrookFerry')).toBe(true);
    expect(isTransportShipKey('hexShipBlue')).toBe(false);
  });

  it('merges the static parts into one draw per material per level', () => {
    const view = build();
    for (const name of internals.lodNames) {
      const lod = view.group.getObjectByName(name);
      if (!lod) throw new Error(name);
      const merged = lod.children.filter((c) => (c as THREE.Mesh).isMesh);
      expect(merged.length, name).toBeGreaterThan(0);
      expect(merged.length, name).toBeLessThanOrEqual(5);
      const mats = new Set(merged.map((m) => (m as THREE.Mesh).material));
      expect(mats.size, name).toBe(merged.length);
    }
    // LOD0 in full: the merged hull plus the live sails, masts and flag segments
    const lod0 = view.group.getObjectByName('LOD0');
    if (!lod0) throw new Error('LOD0');
    expect(meshesUnder(lod0).length).toBeLessThanOrEqual(32);
    for (const name of [...internals.sailNames, ...internals.mastNames]) {
      const node = lod0.getObjectByName(name);
      expect(node, name).toBeDefined();
      expect(meshesUnder(node as THREE.Object3D).length, name).toBeGreaterThan(0);
    }
    // every drawn material is a vertex-coloured surface material
    for (const mesh of meshesUnder(view.group)) {
      const m = mesh.material as THREE.MeshStandardMaterial;
      expect(m.vertexColors, mesh.name).toBe(true);
      expect(mesh.geometry.getAttribute('color'), mesh.name).toBeDefined();
    }
  });

  it('casts shadows from the near levels only, never from glass or flags', () => {
    const view = build();
    const lod = (n: string) => view.group.getObjectByName(n) as THREE.Object3D;
    for (const m of [...meshesUnder(lod('LOD2')), ...meshesUnder(lod('LOD3'))]) {
      expect(m.castShadow).toBe(false);
    }
    for (const m of meshesUnder(lod('LOD0'))) {
      if (internals.isGlowMaterial(m.material as THREE.Material)) expect(m.castShadow).toBe(false);
    }
    const flags = lod('LOD0').getObjectByName('Flags') as THREE.Object3D;
    for (const m of meshesUnder(flags)) expect(m.castShadow).toBe(false);
    expect(meshesUnder(lod('LOD0')).some((m) => m.castShadow)).toBe(true);
  });

  it('switches level of detail with camera distance and hides past the fog', () => {
    const view = build();
    const visible = () =>
      internals.lodNames.map((n) => (view.group.getObjectByName(n) as THREE.Object3D).visible);
    updateAt(view, 20);
    expect(view.lod).toBe(0);
    expect(visible()).toEqual([true, false, false, false]);
    updateAt(view, TRANSPORT_SHIP_LOD_DISTANCES[0] + 5);
    expect(visible()).toEqual([false, true, false, false]);
    updateAt(view, TRANSPORT_SHIP_LOD_DISTANCES[2] + 5);
    expect(visible()).toEqual([false, false, false, true]);
    view.update(X + 900, 0, Z, X, 0, Z, 300, 0.05, false);
    expect(view.group.visible).toBe(false);
  });

  it('plays the idle clip up close and freezes it under reduced motion', () => {
    const view = build();
    const sail = view.group.getObjectByName('MainSail') as THREE.Object3D;
    const motion = view.group.getObjectByName('Ship_Motion') as THREE.Object3D;
    updateAt(view, 20, 0);
    const q0 = sail.quaternion.clone();
    const y0 = motion.position.y;
    updateAt(view, 20, 0.7);
    expect(sail.quaternion.angleTo(q0)).toBeGreaterThan(1e-4);
    expect(motion.position.y).not.toBeCloseTo(y0, 6);
    // the bob stays gentle
    expect(Math.abs(motion.position.y)).toBeLessThan(0.08);
    const q1 = sail.quaternion.clone();
    updateAt(view, 20, 0.7, true);
    expect(sail.quaternion.angleTo(q1)).toBeLessThan(1e-6);
    // far away the clip idles too
    updateAt(view, TRANSPORT_SHIP_LOD_DISTANCES[0] + 20, 0.7);
    expect(sail.quaternion.angleTo(q1)).toBeLessThan(1e-6);
  });

  it('keeps animating after the renderer freezes the props tree', () => {
    const view = build();
    freezeStaticMatrices(view.group);
    const motion = view.group.getObjectByName('Ship_Motion') as THREE.Object3D;
    const sail = view.group.getObjectByName('MainSail') as THREE.Object3D;
    expect(motion.matrixAutoUpdate).toBe(false);
    view.group.updateMatrixWorld(true);
    const before = sail.matrixWorld.clone();
    const motionBefore = motion.matrix.clone();
    updateAt(view, 20, 0.9);
    view.group.updateMatrixWorld();
    expect(motion.matrix.equals(motionBefore)).toBe(false);
    expect(sail.matrixWorld.equals(before)).toBe(false);
  });

  it('hands the props prewarm one twin per distinct program', () => {
    build();
    const parts = transportShipPrewarmParts();
    expect(parts.length).toBeGreaterThanOrEqual(5);
    const materials = new Set(parts.map((p) => p.material));
    const view = build();
    for (const mesh of meshesUnder(view.group)) {
      // every drawn material shares a program with a staged twin: the same
      // converted material, or a hook-preserving clone of one (fading nodes)
      const m = mesh.material as THREE.Material;
      const staged = [...materials].some(
        (t) =>
          t === m || (t.type === m.type && t.side === m.side && t.vertexColors === m.vertexColors),
      );
      expect(staged, mesh.name).toBe(true);
    }
  });

  it('rebuilds a fresh template after a graphics-profile reset', async () => {
    const lod0 = (v: TransportShipView) => v.group.getObjectByName('LOD0') as THREE.Object3D;
    const firstGeo = (meshesUnder(lod0(build()))[0] as THREE.Mesh).geometry;
    // a second view reuses the template's merged geometry
    expect((meshesUnder(lod0(build()))[0] as THREE.Mesh).geometry).toBe(firstGeo);
    resetTransportShipCaches();
    internals.setLoadedGltfForTest(URL, await loadGlb());
    expect((meshesUnder(lod0(build()))[0] as THREE.Mesh).geometry).not.toBe(firstGeo);
  });

  it('fades a sail standing between the eye and the camera, then restores it', () => {
    const view = build();
    const sail = view.group.getObjectByName('MizzenSail') as THREE.Object3D;
    const mat = meshesUnder(sail)[0].material as THREE.Material;
    const other = meshesUnder(view.group.getObjectByName('MainSail') as THREE.Object3D)[0]
      .material as THREE.Material;
    expect(mat).not.toBe(other); // each sail fades on its own clone
    // eye on the waist, camera aft and high, the mizzen course between them
    const eye = [X, BASE_Y + 5.3, Z - 1];
    const cam = [X, BASE_Y + 18, Z - 22];
    view.update(cam[0], cam[1], cam[2], eye[0], eye[1], eye[2], 2000, 0.05, false);
    expect(mat.transparent).toBe(true);
    expect(mat.opacity).toBeCloseTo(OCCLUDER_FADE_ALPHA, 6);
    expect(other.transparent).toBe(false);
    // the camera swings clear: the sail eases back to opaque
    for (let i = 0; i < 80; i++) updateAt(view, 20, 0.05);
    expect(mat.transparent).toBe(false);
    expect(mat.opacity).toBe(1);
  });

  it('fades the whole stern ensign when it flies across the view', () => {
    const view = build();
    const ensign = view.group.getObjectByName('Ensign_1') as THREE.Object3D;
    const mats = new Set(meshesUnder(ensign).map((m) => m.material as THREE.Material));
    expect(meshesUnder(ensign).length).toBe(3); // one chain, one clone for all its segments
    expect(mats.size).toBe(1);
    // eye on the quarterdeck, the camera pulled in behind the flagstaff at its height
    view.update(X, BASE_Y + 12, Z - 17, X, BASE_Y + 8.3, Z - 12, 2000, 0.05, false);
    for (const m of mats) expect(m.transparent).toBe(true);
  });

  it('fades a mast when the camera sits on its line', () => {
    const view = build();
    const mast = view.group.getObjectByName('MizzenMast') as THREE.Object3D;
    const mats = new Set(meshesUnder(mast).map((m) => m.material as THREE.Material));
    // camera right beside the mizzen, eye forward on the waist
    view.update(X - 0.4, BASE_Y + 8.4, Z - 11, X + 1, BASE_Y + 5.3, Z - 1.7, 2000, 0.05, false);
    for (const m of mats) expect(m.transparent).toBe(true);
    // a camera off to the side leaves it alone
    const view2 = build();
    const mast2 = view2.group.getObjectByName('MizzenMast') as THREE.Object3D;
    view2.update(X + 20, BASE_Y + 10, Z, X, BASE_Y + 8, Z, 2000, 0.05, false);
    for (const m of meshesUnder(mast2))
      expect((m.material as THREE.Material).transparent).toBe(false);
  });
});

describe('the scheduled ferry on screen (transport_ferry_ships.ts)', () => {
  const ROUTE = EASTBROOK_NIGHTBLOOM_FERRY;
  const view = emptyTransportFerryView(ROUTE);
  const source = { ferryView: () => view };
  function at(clock: number) {
    transportFerryViewAt(ROUTE, clock, BASE_Y, false, view);
  }

  it('poses the ship from the timetable, frozen props tree and all, the whole voyage long', () => {
    const adopted: TransportShipView[] = [];
    const wakes: (ShipWake | null)[] = [];
    const ships = buildScheduledShips(source, (v, w) => {
      adopted.push(v);
      wakes.push(w);
    });
    // one ship per route, each posed from the one shared clock
    expect(adopted).toHaveLength(TRANSPORT_ROUTES.length);
    expect(adopted).toHaveLength(2);
    const ship = adopted[0];
    const plank = ship.group.getObjectByName('Gangplank') as THREE.Object3D;
    ships.sync(0.05);
    expect(plank.visible).toBe(true);
    // the renderer freezes the whole props tree after build
    freezeStaticMatrices(ship.group);
    const want: TransportPose = { x: 0, z: 0, rot: 0 };
    // mid-departure: step the world clock at 20 Hz and let the drawn clock
    // settle onto the newest tick
    for (let c = 62; c <= 64; c += 0.05) {
      at(c);
      ships.sync(0.05);
    }
    ships.sync(0.05);
    transportShipPoseAt(ROUTE, view.clock, want);
    ship.group.updateMatrixWorld(true);
    const e = ship.group.matrixWorld.elements;
    expect(e[12]).toBeCloseTo(want.x, 3);
    expect(e[14]).toBeCloseTo(want.z, 3);
    expect(ship.group.rotation.y).toBeCloseTo(want.rot, 6);
    ship.update(want.x + 20, BASE_Y + 10, want.z, want.x, BASE_Y + 8, want.z, 2000, 0.05, false);
    expect(ship.group.visible).toBe(true);
    // under way the gangplank is stowed
    expect(plank.visible).toBe(false);
    // mid-voyage, far out at sea: still drawn (no hidden leg any more), and
    // the wake trails it once it has way on
    const mid = ROUTE.timings.docked + transportVoyageSeconds(ROUTE, 0) / 2;
    for (let c = mid; c <= mid + 1; c += 0.05) {
      at(c);
      ships.sync(0.05);
    }
    transportShipPoseAt(ROUTE, view.clock, want);
    ship.update(want.x + 20, BASE_Y + 10, want.z, want.x, BASE_Y + 8, want.z, 2000, 0.05, false);
    expect(ship.group.visible).toBe(true);
    expect(wakes[0]?.points.visible).toBe(true);
    // the second route's ship follows the same clock on its own timetable
    const other = TRANSPORT_ROUTES[1];
    transportShipPoseAt(other, view.clock, want);
    adopted[1].group.updateMatrixWorld(true);
    expect(adopted[1].group.matrixWorld.elements[12]).toBeCloseTo(want.x, 3);
    expect(adopted[1].group.matrixWorld.elements[14]).toBeCloseTo(want.z, 3);
    // docked at the Nightbloom: the plank is out again
    const wick = ROUTE.berths[1];
    at(ROUTE.timings.docked * 2 + transportVoyageSeconds(ROUTE, 0) - 10);
    ships.sync(0.05);
    ship.group.updateMatrixWorld(true);
    expect(ship.group.matrixWorld.elements[12]).toBeCloseTo(wick.x, 3);
    expect(ship.group.matrixWorld.elements[14]).toBeCloseTo(wick.z, 3);
    ship.update(wick.x + 20, BASE_Y + 10, wick.z, wick.x, BASE_Y + 8, wick.z, 2000, 0.05, false);
    expect(ship.group.visible).toBe(true);
    expect(plank.visible).toBe(true);
  });

  it('a ship out of sight leaves its wake undrawn, and it resumes in sight', () => {
    const adopted: TransportShipView[] = [];
    const wakes: (ShipWake | null)[] = [];
    const ships = buildScheduledShips(source, (v, w) => {
      adopted.push(v);
      wakes.push(w);
    });
    const want: TransportPose = { x: 0, z: 0, rot: 0 };
    const mid = ROUTE.timings.docked + transportVoyageSeconds(ROUTE, 0) / 2;
    const run = (camFar: boolean) => {
      for (let c = mid; c <= mid + 1; c += 0.05) {
        at(c);
        ships.sync(0.05);
        transportShipPoseAt(ROUTE, view.clock, want);
        const d = camFar ? 5000 : 20;
        adopted[0].update(
          want.x + d,
          BASE_Y + 10,
          want.z,
          want.x,
          BASE_Y + 8,
          want.z,
          400,
          0.05,
          false,
        );
      }
      ships.sync(0.05);
    };
    run(false);
    expect(adopted[0].group.visible).toBe(true);
    expect(wakes[0]?.points.visible).toBe(true);
    run(true);
    expect(adopted[0].group.visible).toBe(false);
    expect(wakes[0]?.points.visible).toBe(false);
    run(false);
    expect(wakes[0]?.points.visible).toBe(true);
  });

  it('a world with no ferry leaves the ship where it was built', () => {
    const adopted: TransportShipView[] = [];
    const ships = buildScheduledShips({ ferryView: () => null }, (v) => adopted.push(v));
    ships.sync(0.05);
    expect(adopted[0].group.position.x).toBeCloseTo(ROUTE.berths[0].x, 6);
  });
});
