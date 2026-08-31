import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type PendingArenaWalls, pendingArenaWallsFor } from '../src/render/dungeon_arena_walls';
import {
  collectWallPropBindings,
  retireWallOcclusion,
  updateWallOcclusion,
  WALL_PROP_GROUP_PREFIX,
  WALL_PROP_SHOW_ALPHA,
  type WallHideable,
  type WallPropBinding,
} from '../src/render/dungeon_wall_occlusion';
import { occluderFadeMat, occluderFadeReady } from '../src/render/occluder_fade';
import { OCCLUDER_FADE_ALPHA } from '../src/render/occluder_fade_core';
import {
  installOccluderFadeGate,
  occluderFadeTwinCount,
  resetOccluderFadeGateForTest,
} from '../src/render/occluder_fade_gate';
import {
  occluderGhostTargetOf,
  occluderGhostVariantKey,
} from '../src/render/occluder_ghost_variant_key';
import { IGNIVAR_LAYOUT, SANCTUM_LAYOUT } from '../src/sim/dungeon_layout';

const DT = 1 / 60;

function hideable(backface?: WallHideable['backface']): WallHideable {
  const mat = new THREE.MeshStandardMaterial();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
  return {
    group: new THREE.Group(),
    mats: [occluderFadeMat(mat, mesh)],
    hidden: false,
    alpha: 1,
    // footprint spans x -5..5 at z -58, top 16 (approach entry shape)
    footprint: { x: 0, z: -58, hw: 5, hd: 1, topY: 16 },
    backface,
  };
}

describe('pendingArenaWallsFor backface planes', () => {
  it('gives every ignivar polygon wall an outward cull plane in world space', () => {
    const walls: PendingArenaWalls = pendingArenaWallsFor(IGNIVAR_LAYOUT, 1000, -2000, 'ignivar');
    expect(walls.all.length).toBeGreaterThan(0);
    const pole = IGNIVAR_LAYOUT.shellPole;
    if (!pole) throw new Error('ignivar layout lost its pole');
    for (const wall of walls.all) {
      expect(wall.backface).toBeDefined();
      const plane = wall.backface;
      if (!plane) continue;
      expect(plane.x).toBeCloseTo(wall.footprint.x, 6);
      expect(plane.z).toBeCloseTo(wall.footprint.z, 6);
      // outward: the world-space pole sits on the inner side
      const d = (1000 + pole.x - plane.x) * plane.nx + (-2000 + pole.z - plane.z) * plane.nz;
      expect(d).toBeLessThan(0);
    }
  });

  it('leaves every other variant on the sightline fade (no plane)', () => {
    const layout = { ...IGNIVAR_LAYOUT };
    const marsh = pendingArenaWallsFor(layout, 0, 0, 'delve_marsh');
    for (const wall of marsh.all) expect(wall.backface).toBeUndefined();
    // rectangular shells never carry one either
    const rect = pendingArenaWallsFor(SANCTUM_LAYOUT, 0, 0, 'ignivar');
    for (const wall of rect.all) expect(wall.backface).toBeUndefined();
  });
});

describe('updateWallOcclusion, backface mode', () => {
  const plane = { x: 0, z: -58, nx: 0, nz: -1 };

  it('culls the wall outright when the camera is outside its plane', () => {
    const h = hideable(plane);
    // camera outside the south wall, player mid-room: the reproduced bug
    updateWallOcclusion([h], [], 0, 4, -70, 0, 2, -40, DT);
    expect(h.hidden).toBe(true);
    expect(h.alpha).toBe(0);
    expect(h.mats[0].mat.opacity).toBe(0);
    expect(h.mats[0].mat.transparent).toBe(true);
    expect(h.group.visible).toBe(false);
  });

  it('culls even when the sightline does not cross this segment (whole face, no peephole)', () => {
    const h = hideable({ x: 20, z: -58, nx: 0, nz: -1 });
    h.footprint = { x: 20, z: -58, hw: 3, hd: 1, topY: 16 };
    // eye and camera both at x 0: the ray never touches the x 20 segment,
    // but the camera is outside the face plane, so the segment culls anyway
    updateWallOcclusion([h], [], 0, 4, -70, 0, 2, -40, DT);
    expect(h.hidden).toBe(true);
    expect(h.alpha).toBe(0);
  });

  it('eases back to the authored state once the camera returns inside', () => {
    const h = hideable(plane);
    updateWallOcclusion([h], [], 0, 4, -70, 0, 2, -40, DT);
    expect(h.group.visible).toBe(false);
    updateWallOcclusion([h], [], 0, 4, -40, 0, 2, -20, DT);
    expect(h.hidden).toBe(false);
    expect(h.alpha).toBeGreaterThan(0);
    expect(h.alpha).toBeLessThan(1);
    expect(h.group.visible).toBe(true);
    for (let i = 0; i < 400; i++) updateWallOcclusion([h], [], 0, 4, -40, 0, 2, -20, DT);
    expect(h.alpha).toBe(1);
    expect(h.mats[0].mat.opacity).toBe(1);
    expect(h.mats[0].mat.transparent).toBe(false);
  });

  it('keeps the legacy sightline ghost for walls without a plane', () => {
    const h = hideable();
    updateWallOcclusion([h], [], 0, 4, -70, 0, 2, -40, DT);
    expect(h.hidden).toBe(true);
    expect(h.alpha).toBe(OCCLUDER_FADE_ALPHA);
    expect(h.mats[0].mat.opacity).toBeCloseTo(OCCLUDER_FADE_ALPHA, 6);
    // legacy mode never toggles visibility
    expect(h.group.visible).toBe(true);
  });
});

describe('updateWallOcclusion, backface twin staging', () => {
  const plane = { x: 0, z: -58, nx: 0, nz: -1 };
  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  interface Compile {
    root: THREE.Object3D;
    imminent: boolean;
    resolve: () => void;
  }

  /** A reveal compile host whose links settle only when the test says so. */
  function fakeHost() {
    const compiles: Compile[] = [];
    const host = {
      compile: (root: object, imminent: boolean) =>
        new Promise<void>((resolve) => {
          compiles.push({ root: root as THREE.Object3D, imminent, resolve });
        }),
      schedule: () => () => undefined,
    };
    return { host, compiles };
  }

  /** A backface hideable shaped like emitArenaHideable's output: several
   *  module-kind materials on instanced meshes, each its own fade record. */
  function backfaceHideable(): WallHideable {
    const stone = new THREE.MeshStandardMaterial({ name: 'stone' });
    const banner = new THREE.MeshLambertMaterial({ name: 'banner' });
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    return {
      group: new THREE.Group(),
      mats: [
        occluderFadeMat(stone, new THREE.InstancedMesh(geometry, stone, 2)),
        occluderFadeMat(banner, new THREE.Mesh(geometry, banner)),
      ],
      hidden: false,
      alpha: 1,
      footprint: { x: 0, z: -58, hw: 5, hd: 1, topY: 16 },
      backface: plane,
    };
  }

  const keyOf = (mat: THREE.Material, mesh: THREE.Mesh): string =>
    occluderGhostVariantKey(occluderGhostTargetOf(mat, mesh));

  beforeEach(() => resetOccluderFadeGateForTest());
  afterEach(() => resetOccluderFadeGateForTest());

  it('stages a twin for EVERY backface record on the first advanced frame, camera still inside', () => {
    const { host, compiles } = fakeHost();
    installOccluderFadeGate(host);
    const h = backfaceHideable();
    // Camera and eye both inside the room: no hide, no re-show, and the
    // staging must fire anyway (a within-reach or on-hide trigger would be
    // too late for a wall the camera exits and re-enters in one orbit).
    updateWallOcclusion([h], [], 0, 4, -40, 0, 2, -20, DT);
    expect(h.hidden).toBe(false);
    expect(compiles).toHaveLength(h.mats.length);
    expect(occluderFadeTwinCount()).toBe(h.mats.length);
    // Exact coverage, not a lookalike set: the staged twins key the very
    // programs the flip will ask for, one per record in h.mats.
    const staged = new Set(
      compiles.map((c) =>
        keyOf((c.root as THREE.Mesh).material as THREE.Material, c.root as THREE.Mesh),
      ),
    );
    const flipped = new Set(
      h.mats.map((f) =>
        occluderGhostVariantKey({
          material: f.mat,
          geometry: f.geometry,
          instanced: f.instanced,
          instanceColor: f.instanceColor,
        }),
      ),
    );
    expect(staged).toEqual(flipped);
    // Once: later frames add nothing.
    updateWallOcclusion([h], [], 0, 4, -40, 0, 2, -20, DT);
    expect(compiles).toHaveLength(h.mats.length);
  });

  it('by the first re-show frame every twin program is already warm: no consult remains', async () => {
    const { host, compiles } = fakeHost();
    installOccluderFadeGate(host);
    const h = backfaceHideable();
    // Frame 1, camera inside: the staging fires and the links land.
    updateWallOcclusion([h], [], 0, 4, -40, 0, 2, -20, DT);
    for (const c of compiles) c.resolve();
    await flush();
    // Camera pushed outside: the wall culls outright, drawing nothing.
    updateWallOcclusion([h], [], 0, 4, -70, 0, 2, -40, DT);
    expect(h.group.visible).toBe(false);
    expect(compiles).toHaveLength(h.mats.length);
    // The camera returns inside: the FIRST re-show frame flips transparent
    // with the staged programs already linked, and asks the gate nothing new.
    updateWallOcclusion([h], [], 0, 4, -40, 0, 2, -20, DT);
    expect(h.group.visible).toBe(true);
    expect(h.alpha).toBeGreaterThan(0);
    for (const f of h.mats) expect(f.mat.transparent).toBe(true);
    expect(compiles).toHaveLength(h.mats.length);
    expect(occluderFadeReady(h.mats, 'prefetch')).toBe(true);
  });

  it('holds the re-show HIDDEN while a staged compile is still pending, then releases on the settle', async () => {
    const { host, compiles } = fakeHost();
    installOccluderFadeGate(host);
    const h = backfaceHideable();
    // Frame 1, camera inside: the staging fires, but the links stay PENDING
    // (a congested reveal lane can hold a link for seconds).
    updateWallOcclusion([h], [], 0, 4, -40, 0, 2, -20, DT);
    expect(compiles).toHaveLength(h.mats.length);
    // Outside: the wall culls outright, drawing nothing.
    updateWallOcclusion([h], [], 0, 4, -70, 0, 2, -40, DT);
    expect(h.group.visible).toBe(false);
    expect(h.alpha).toBe(0);
    // Back inside while the compiles are STILL pending: the re-show must
    // hold the wall hidden rather than draw a transparent twin whose
    // program has not linked (the synchronous-link race).
    updateWallOcclusion([h], [], 0, 4, -40, 0, 2, -20, DT);
    expect(h.hidden).toBe(false);
    expect(h.group.visible).toBe(false);
    expect(h.alpha).toBe(0);
    // The held edge frame escalates the pending prefetch keys to the
    // actionable floor, once per key.
    expect(compiles).toHaveLength(2 * h.mats.length);
    // ... and keeps holding across frames without asking again.
    updateWallOcclusion([h], [], 0, 4, -40, 0, 2, -20, DT);
    expect(h.group.visible).toBe(false);
    expect(h.alpha).toBe(0);
    expect(compiles).toHaveLength(2 * h.mats.length);
    // The links settle: the ease-back runs normally from the next frame.
    for (const c of compiles) c.resolve();
    await flush();
    updateWallOcclusion([h], [], 0, 4, -40, 0, 2, -20, DT);
    expect(h.group.visible).toBe(true);
    expect(h.alpha).toBeGreaterThan(0);
    for (const f of h.mats) expect(f.mat.transparent).toBe(true);
    for (let i = 0; i < 400 && h.alpha < 1; i++) {
      updateWallOcclusion([h], [], 0, 4, -40, 0, 2, -20, DT);
    }
    expect(h.alpha).toBe(1);
    expect(h.mats[0].mat.transparent).toBe(false);
  });

  it('reduced motion restores straight to the authored opaque state without waiting on the gate', () => {
    // The one-step reduced-motion re-show never draws the transparent twin
    // (alpha jumps 0 to 1, which restores the authored state), so a pending
    // link must not delay it.
    const { host, compiles } = fakeHost();
    installOccluderFadeGate(host);
    const h = backfaceHideable();
    updateWallOcclusion([h], [], 0, 4, -40, 0, 2, -20, DT, true);
    updateWallOcclusion([h], [], 0, 4, -70, 0, 2, -40, DT, true);
    expect(h.group.visible).toBe(false);
    // Links still pending; the reduced-motion re-show is immediate anyway.
    updateWallOcclusion([h], [], 0, 4, -40, 0, 2, -20, DT, true);
    expect(h.group.visible).toBe(true);
    expect(h.alpha).toBe(1);
    expect(h.mats[0].mat.transparent).toBe(false);
    expect(h.mats[0].mat.opacity).toBe(1);
    // No escalation either: nothing transparent was ever about to draw.
    expect(compiles).toHaveLength(h.mats.length);
  });

  it('the lazy link matches a face by owner root and shared cull plane, and only that face', () => {
    const owner = new THREE.Group();
    const own = (h: WallHideable): WallHideable => {
      owner.add(h.group);
      return h;
    };
    const south = own(backfaceHideable());
    const southSibling = own(backfaceHideable());
    // A second segment of the SAME face: on the face line, same normal.
    southSibling.backface = { x: 6, z: -58, nx: 0, nz: -1 };
    const north = own(backfaceHideable());
    north.backface = { x: 0, z: 58, nx: 0, nz: 1 };
    const sightline = own(backfaceHideable());
    sightline.backface = undefined;
    const offset = own(backfaceHideable());
    // Parallel but OFF the face line (a different wall course).
    offset.backface = { x: 0, z: -61, nx: 0, nz: -1 };
    // Same face plane, but a DIFFERENT interior's wall (another owner root):
    // the owner scope must exclude it however colinear it sits.
    const foreign = backfaceHideable();
    new THREE.Group().add(foreign.group);
    const b: WallPropBinding = {
      node: new THREE.Group(),
      plane: { ...plane },
      owner,
      alpha: 1,
    };
    const all = [south, southSibling, north, sightline, offset, foreign];
    updateWallOcclusion(all, [b], 0, 4, -40, 0, 2, -20, DT);
    expect(b.walls).toEqual([south, southSibling]);
    // A binding nothing matches links empty (proxy-clock fallback).
    const lone: WallPropBinding = {
      node: new THREE.Group(),
      plane: { x: 500, z: 500, nx: 1, nz: 0 },
      owner: new THREE.Group(),
      alpha: 1,
    };
    updateWallOcclusion(all, [lone], 0, 4, -40, 0, 2, -20, DT);
    expect(lone.walls).toEqual([]);
  });

  it('a bound prop stays hidden with its wall through a pending-compile hold, then restores wall-first', async () => {
    const { host, compiles } = fakeHost();
    installOccluderFadeGate(host);
    const owner = new THREE.Group();
    const h = backfaceHideable();
    owner.add(h.group);
    const b: WallPropBinding = {
      node: new THREE.Group(),
      plane: { ...plane },
      owner,
      alpha: 1,
    };
    // Frame 1 inside: the staging fires (links left PENDING) and the lazy
    // owner-plus-plane link binds the prop face to its wall.
    updateWallOcclusion([h], [b], 0, 4, -40, 0, 2, -20, DT);
    expect(b.walls).toEqual([h]);
    // Outside: wall and prop hide together.
    updateWallOcclusion([h], [b], 0, 4, -70, 0, 2, -40, DT);
    expect(h.group.visible).toBe(false);
    expect(b.node.visible).toBe(false);
    // Ten inside frames with the links still pending: the wall holds at
    // alpha 0 for readiness, and the prop must hold WITH it. Its own proxy
    // clock alone passes the 0.6 show threshold on the tenth frame
    // (1 - e^-1 = 0.632) and would float the beam in the open.
    for (let i = 0; i < 10; i++) {
      updateWallOcclusion([h], [b], 0, 4, -40, 0, 2, -20, DT);
      expect(h.group.visible).toBe(false);
      expect(b.node.visible, `held frame ${i}`).toBe(false);
    }
    expect(h.alpha).toBe(0);
    // The links settle: the wall re-shows FIRST (still mostly transparent),
    // the prop only once the wall itself recovers past the show threshold.
    for (const c of compiles) c.resolve();
    await flush();
    updateWallOcclusion([h], [b], 0, 4, -40, 0, 2, -20, DT);
    expect(h.group.visible).toBe(true);
    expect(h.alpha).toBeLessThan(WALL_PROP_SHOW_ALPHA);
    expect(b.node.visible).toBe(false);
    let propShownAtWallAlpha = -1;
    for (let i = 0; i < 400 && propShownAtWallAlpha < 0; i++) {
      updateWallOcclusion([h], [b], 0, 4, -40, 0, 2, -20, DT);
      if (b.node.visible) propShownAtWallAlpha = h.alpha;
    }
    expect(propShownAtWallAlpha).toBeGreaterThanOrEqual(WALL_PROP_SHOW_ALPHA);
    // ... and the ease still completes for both.
    for (let i = 0; i < 400 && h.alpha < 1; i++) {
      updateWallOcclusion([h], [b], 0, 4, -40, 0, 2, -20, DT);
    }
    expect(h.alpha).toBe(1);
    expect(b.node.visible).toBe(true);
  });

  it('a face re-covers only when its SLOWEST segment has: one settled segment cannot re-show the prop', async () => {
    const { host, compiles } = fakeHost();
    installOccluderFadeGate(host);
    const owner = new THREE.Group();
    // Two segments of ONE face whose programs settle independently: a
    // Standard and a Lambert material key two different twins, so one
    // segment's link can land while the other stays readiness-held.
    const wallOn = (x: number, mat: THREE.Material): WallHideable => {
      const group = new THREE.Group();
      owner.add(group);
      return {
        group,
        mats: [occluderFadeMat(mat, new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat))],
        hidden: false,
        alpha: 1,
        footprint: { x, z: -58, hw: 5, hd: 1, topY: 16 },
        backface: { x, z: -58, nx: 0, nz: -1 },
      };
    };
    const wallA = wallOn(0, new THREE.MeshStandardMaterial({ name: 'segA' }));
    const wallB = wallOn(6, new THREE.MeshLambertMaterial({ name: 'segB' }));
    const b: WallPropBinding = {
      node: new THREE.Group(),
      plane: { ...plane },
      owner,
      alpha: 1,
    };
    const frame = (camZ: number, eyeZ: number): void =>
      updateWallOcclusion([wallA, wallB], [b], 0, 4, camZ, 0, 2, eyeZ, DT);
    // Frame 1 inside: both segments stage (one twin each, A first) and the
    // lazy link binds the face to BOTH of them.
    frame(-40, -20);
    expect(b.walls).toEqual([wallA, wallB]);
    expect(compiles).toHaveLength(2);
    // Outside: everything hides.
    frame(-70, -40);
    expect(b.node.visible).toBe(false);
    // Only segment A's program settles; B stays readiness-held.
    compiles[0].resolve();
    await flush();
    // A eases past the show threshold while B holds at alpha 0: the face is
    // NOT re-covered (its slowest segment is still invisible), so the prop
    // must stay hidden however far A recovers. A maximum or first-segment
    // cover rule would re-show it the frame A passes 0.6.
    for (let i = 0; i < 400 && wallA.alpha < 1; i++) {
      frame(-40, -20);
      expect(wallB.alpha).toBe(0);
      expect(wallB.group.visible).toBe(false);
      expect(b.node.visible, `prop with A at ${wallA.alpha}`).toBe(false);
    }
    expect(wallA.alpha).toBe(1);
    // B settles (its request plus the held edge frames' escalation): the
    // prop re-shows only once B ITSELF recovers past the threshold.
    for (const c of compiles) c.resolve();
    await flush();
    let propShownAtBAlpha = -1;
    for (let i = 0; i < 400 && propShownAtBAlpha < 0; i++) {
      frame(-40, -20);
      if (b.node.visible) propShownAtBAlpha = wallB.alpha;
    }
    expect(propShownAtBAlpha).toBeGreaterThanOrEqual(WALL_PROP_SHOW_ALPHA);
    expect(wallA.alpha).toBe(1);
  });

  it('an unbound prop keeps the historical proxy-clock timing (no wall to key off)', () => {
    // The [] hideables shape the older prop tests use: no link, no hold.
    const b: WallPropBinding = {
      node: new THREE.Group(),
      plane: { ...plane },
      owner: new THREE.Group(),
      alpha: 1,
    };
    updateWallOcclusion([], [b], 0, 4, -70, 0, 2, -40, DT);
    expect(b.node.visible).toBe(false);
    let shownAt = -1;
    for (let i = 0; i < 400 && shownAt < 0; i++) {
      updateWallOcclusion([], [b], 0, 4, -40, 0, 2, -20, DT);
      if (b.node.visible) shownAt = b.alpha;
    }
    expect(shownAt).toBeGreaterThanOrEqual(WALL_PROP_SHOW_ALPHA);
    expect(shownAt).toBeLessThan(0.75);
  });

  it('the sightline arm keeps its reach latch: a far no-backface wall stages nothing', () => {
    const { host, compiles } = fakeHost();
    installOccluderFadeGate(host);
    const h = backfaceHideable();
    h.backface = undefined;
    // Anchor far beyond OCCLUDER_FADE_PREFETCH_YD of the camera.
    h.footprint = { x: 500, z: 500, hw: 5, hd: 1, topY: 16 };
    updateWallOcclusion([h], [], 0, 4, -40, 0, 2, -20, DT);
    expect(compiles).toHaveLength(0);
    expect(occluderFadeTwinCount()).toBe(0);
  });
});

describe('updateWallOcclusion, wall prop bindings', () => {
  const plane = { x: 0, z: -58, nx: 0, nz: -1 };

  function binding(): WallPropBinding {
    return { node: new THREE.Group(), plane, owner: new THREE.Group(), alpha: 1 };
  }

  it('hides mounted props on the frame their wall culls', () => {
    const b = binding();
    updateWallOcclusion([], [b], 0, 4, -70, 0, 2, -40, DT);
    expect(b.node.visible).toBe(false);
    expect(b.alpha).toBe(0);
  });

  it('re-shows props only once the returning wall mostly covers them', () => {
    const b = binding();
    updateWallOcclusion([], [b], 0, 4, -70, 0, 2, -40, DT);
    expect(b.node.visible).toBe(false);
    let shownAt = -1;
    for (let i = 0; i < 400 && shownAt < 0; i++) {
      updateWallOcclusion([], [b], 0, 4, -40, 0, 2, -20, DT);
      if (b.node.visible) shownAt = b.alpha;
    }
    expect(shownAt).toBeGreaterThanOrEqual(WALL_PROP_SHOW_ALPHA);
  });
});

describe('collectWallPropBindings', () => {
  it('lifts the dressing face groups into world-space bindings', () => {
    const dressing = new THREE.Group();
    const face = new THREE.Group();
    face.name = `${WALL_PROP_GROUP_PREFIX}3`;
    face.userData.wallPlane = { x: 5, z: -58, nx: 0, nz: -1 };
    dressing.add(face);
    const plain = new THREE.Group();
    plain.name = 'ignivarApproachAssemblyRails';
    dressing.add(plain);
    const owner = new THREE.Group();
    const bindings = collectWallPropBindings(dressing, 1000, -2000, owner);
    expect(bindings).toHaveLength(1);
    expect(bindings[0].node).toBe(face);
    expect(bindings[0].owner).toBe(owner);
    expect(bindings[0].plane).toEqual({ x: 1005, z: -2058, nx: 0, nz: -1 });
    expect(bindings[0].alpha).toBe(1);
  });
});

describe('retireWallOcclusion', () => {
  it('drops records owned by retired roots and keeps the rest', () => {
    const keep = hideable();
    const drop = hideable();
    const owner = new THREE.Group();
    const bindingKeep: WallPropBinding = {
      node: new THREE.Group(),
      plane: { x: 0, z: 0, nx: 0, nz: 1 },
      owner: new THREE.Group(),
      alpha: 1,
    };
    const bindingDrop: WallPropBinding = { ...bindingKeep, owner };
    const hideables = [keep, drop];
    const bindings = [bindingKeep, bindingDrop];
    retireWallOcclusion(hideables, bindings, new Set([drop.group, owner]));
    expect(hideables).toEqual([keep]);
    expect(bindings).toEqual([bindingKeep]);
  });
});
