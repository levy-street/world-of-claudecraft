// @vitest-environment happy-dom

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clampChaseCameraToInterior,
  interiorCameraInternalsForTest,
  registerCameraInterior,
} from '../src/render/interior_camera';
import { cameraInterior } from '../src/render/interior_camera_core';
import { NameplatePainter } from '../src/render/nameplate_painter';
import type { NameplatePickCandidate } from '../src/render/nameplate_pick_core';
import type { EntityView } from '../src/render/renderer';
import type { Entity } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

// The production nameplate painter with a walk-in interior registered (interior_camera.ts):
// while the player stands inside, the plates of bodies outside draw only when the camera
// sees them through an opening onto the world (here a door in the back wall), never
// through a wall; bodies inside keep theirs; outdoors, a body inside keeps its plate only
// where the camera sees it through the door. A gated plate leaves no pick anchor behind.

const VIEWPORT = { width: 1280, height: 720 };
const VIEWER_ID = 1;

// a room x -10..10, z -10..10, y 0..5, its door out through the back (z -10) wall
const ROOM = cameraInterior(
  'room',
  [
    [-10, 10, 0, 5, -10, 10],
    [-2, 2, 0, 3.5, -11, -8],
  ],
  [{ box: 1, axis: 2, side: -1 }],
);

function entity(id: number, overrides: Partial<Entity> = {}): Entity {
  return {
    id,
    kind: 'mob',
    name: `Add ${id}`,
    templateId: 'cinder_artificer',
    pos: { x: 0, y: 0, z: 0 },
    scale: 1,
    level: 10,
    hp: 100,
    maxHp: 100,
    dead: false,
    lootable: false,
    hostile: true,
    ownerId: null,
    guild: '',
    auras: [],
    questIds: [],
    targetId: null,
    aggroTargetId: null,
    comboPoints: 0,
    comboTargetId: null,
    castingAbility: null,
    castTotal: 0,
    castRemaining: 0,
    channeling: false,
    ...overrides,
  } as unknown as Entity;
}

function fakeContext(): CanvasRenderingContext2D {
  const noop = vi.fn();
  return {
    setTransform: noop,
    scale: noop,
    translate: noop,
    clearRect: noop,
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    arc: noop,
    rect: noop,
    clip: noop,
    fill: noop,
    stroke: noop,
    drawImage: noop,
    fillText: noop,
    strokeText: noop,
    measureText: (text: string) => ({
      width: text.length * 7,
      actualBoundingBoxLeft: (text.length * 7) / 2,
      actualBoundingBoxRight: (text.length * 7) / 2,
      actualBoundingBoxAscent: 10,
      actualBoundingBoxDescent: 3,
    }),
  } as unknown as CanvasRenderingContext2D;
}

interface PainterAccess {
  anchorScratch: Array<NameplatePickCandidate>;
  anchorCount: number;
}

function plateIds(painter: NameplatePainter): number[] {
  const access = painter as unknown as PainterAccess;
  return access.anchorScratch
    .slice(0, access.anchorCount)
    .map((anchor) => anchor.id)
    .sort((a, b) => a - b);
}

function harness(bodies: Entity[], playerZ: number) {
  const player = entity(VIEWER_ID, { kind: 'player', hostile: false });
  player.pos = { x: 0, y: 0, z: playerZ } as Entity['pos'];
  const views = new Map<number, EntityView>();
  const entities = new Map<number, Entity>([[player.id, player]]);
  for (const b of bodies) {
    const group = new THREE.Group();
    group.position.set(b.pos.x, b.pos.y, b.pos.z);
    views.set(b.id, { group, height: 2, mountLift: 0 } as EntityView);
    entities.set(b.id, b);
  }
  const camera = new THREE.PerspectiveCamera(60, VIEWPORT.width / VIEWPORT.height, 0.1, 500);
  camera.position.set(0, 3, playerZ + 3);
  // the indoor clamp runs first each frame (renderer updateCamera), deciding indoors
  const look = new THREE.Vector3(0, 2, playerZ);
  clampChaseCameraToInterior(camera, look, new THREE.Vector3(0, 0, playerZ), 1 / 60, true);
  camera.lookAt(0, 1, -20);
  camera.updateMatrixWorld(true);
  const world = {
    player,
    entities,
    markerFor: () => null,
    questState: () => 'available',
  } as unknown as IWorld;
  return new NameplatePainter({
    views,
    camera,
    world,
    layer: document.createElement('div'),
    getViewport: () => VIEWPORT,
    getDevicePixelRatio: () => 1,
    showNameplates: () => true,
    showDevBadges: () => true,
    showOwnNameplate: () => false,
    showPlayerNameplates: () => true,
    nameplateDotScale: () => 0,
    isHostilePlayer: () => false,
  });
}

function mob(id: number, x: number, z: number): Entity {
  return entity(id, { pos: { x, y: 0, z } as Entity['pos'] });
}

describe('nameplates while the player is indoors', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeContext());
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,ok');
    interiorCameraInternalsForTest.reset();
    registerCameraInterior(ROOM);
  });
  afterEach(() => interiorCameraInternalsForTest.reset());

  it('keeps the plates inside and seen through the door, drops those behind the walls', () => {
    // 2 inside, 3 outside straight through the door, 4 outside behind the wall beside it
    const painter = harness([mob(2, 0, -4), mob(3, 0, -20), mob(4, 6, -20)], 5);
    painter.update(true);
    expect(plateIds(painter)).toEqual([2, 3]);
  });

  it('outside, keeps the plates outside and drops those the walls hide inside', () => {
    // the camera out in front of the room's closed front wall: the body inside is walled off
    const painter = harness([mob(2, 0, -4), mob(3, 0, -20), mob(4, 6, -20)], 30);
    painter.update(true);
    expect(plateIds(painter)).toEqual([3, 4]);
  });

  it('outside, keeps the plate of a body inside that the camera sees through the door', () => {
    // the camera out behind the room, looking in through its back door
    const painter = harness([mob(2, 0, -4), mob(3, 0, -20), mob(4, 6, -20)], -30);
    painter.update(true);
    expect(plateIds(painter)).toEqual([2, 3, 4]);
  });
});
