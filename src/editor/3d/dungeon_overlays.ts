// Floor-plan overlay for the editor's dungeon mode: one wireframe outline per
// draft entity, drawn just above the interior floor so rooms/doors/barriers/
// decor stay visible and clickable through the built geometry. Rebuilt whole
// on every draft change (a few hundred LineLoops; trivially cheap next to the
// interior itself) following the blockersGroup ownership pattern.
import * as THREE from 'three';
import type { DungeonDraft, DungeonEntityRef } from '../dungeon/dungeon_draft_core';
import { entityBounds } from '../dungeon/dungeon_draft_core';

const COLORS = {
  room: 0x4da6ff,
  door: 0x37e0c8,
  opening: 0xb06cf0,
  barrierMaze: 0xff9b3d,
  barrierPit: 0xff5470,
  decor: 0xffd100,
  dais: 0xff4444,
  selected: 0xffffff,
} as const;

const OVERLAY_Y = 0.22;
const SELECTED_Y = 0.3;

function rectLoop(
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  color: number,
  y: number,
): THREE.LineLoop {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(x0, y, z0),
    new THREE.Vector3(x1, y, z0),
    new THREE.Vector3(x1, y, z1),
    new THREE.Vector3(x0, y, z1),
  ]);
  return new THREE.LineLoop(
    geo,
    new THREE.LineBasicMaterial({ color, depthTest: false, fog: false }),
  );
}

function circleLoop(x: number, z: number, r: number, color: number, y: number): THREE.LineLoop {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    pts.push(new THREE.Vector3(x + Math.cos(a) * r, y, z + Math.sin(a) * r));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  return new THREE.LineLoop(
    geo,
    new THREE.LineBasicMaterial({ color, depthTest: false, fog: false }),
  );
}

function refsEqual(a: DungeonEntityRef | null, b: DungeonEntityRef): boolean {
  return !!a && a.kind === b.kind && a.index === b.index;
}

/** Build the full overlay group in instance-local coordinates; the caller
 *  positions it at the dungeon origin and swaps it on every draft change. */
export function buildDungeonOverlays(
  draft: DungeonDraft,
  selected: DungeonEntityRef | null,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'dungeon-editor-overlays';
  group.renderOrder = 999;
  const add = (
    ref: DungeonEntityRef,
    color: number,
    circle?: { x: number; z: number; r: number },
  ): void => {
    const isSelected = refsEqual(selected, ref);
    const y = isSelected ? SELECTED_Y : OVERLAY_Y;
    const c = isSelected ? COLORS.selected : color;
    const b = entityBounds(draft, ref);
    const line = circle
      ? circleLoop(circle.x, circle.z, circle.r, c, y)
      : rectLoop(b.x0, b.x1, b.z0, b.z1, c, y);
    line.renderOrder = 999;
    group.add(line);
  };
  draft.rooms.forEach((_, index) => {
    add({ kind: 'room', index }, COLORS.room);
  });
  draft.doors.forEach((_, index) => {
    add({ kind: 'door', index }, COLORS.door);
  });
  draft.visualOpenings.forEach((_, index) => {
    add({ kind: 'opening', index }, COLORS.opening);
  });
  draft.barriers.forEach((barrier, index) => {
    add(
      { kind: 'barrier', index },
      barrier.style === 'pit' ? COLORS.barrierPit : COLORS.barrierMaze,
    );
  });
  draft.decor.forEach((decor, index) => {
    const b = entityBounds(draft, { kind: 'decor', index });
    const r = Math.max(b.x1 - b.x0, b.z1 - b.z0) / 2;
    add({ kind: 'decor', index }, COLORS.decor, { x: decor.x, z: decor.z, r });
  });
  add({ kind: 'dais', index: 0 }, COLORS.dais, draft.dais);
  return group;
}

/** Dispose an overlay group built by buildDungeonOverlays (geometry and
 *  materials are bespoke per build, so both go). */
export function disposeDungeonOverlays(group: THREE.Group): void {
  group.traverse((obj) => {
    const line = obj as THREE.LineLoop;
    if (line.isLineLoop || (obj as THREE.Line).isLine) {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
  });
  group.parent?.remove(group);
}
