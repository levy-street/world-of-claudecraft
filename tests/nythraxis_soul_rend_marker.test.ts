import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { buildNythraxisGravePrewarmVisual } from '../src/render/nythraxis_grave_flame_visual';
import {
  buildNythraxisSoulRendMarker,
  NYTHRAXIS_SOUL_REND_FILL_NAME,
  NYTHRAXIS_SOUL_REND_MARKER_NAME,
  NYTHRAXIS_SOUL_REND_RING_NAME,
  NYTHRAXIS_SOUL_REND_SIGIL_BLADE_NAME,
  NYTHRAXIS_SOUL_REND_SIGIL_NAME,
  NYTHRAXIS_SOUL_REND_SIGIL_RING_NAME,
  NythraxisSoulRendMarkers,
} from '../src/render/nythraxis_soul_rend_marker';
import {
  NYTHRAXIS_SOUL_REND_ALONE_PALETTE,
  NYTHRAXIS_SOUL_REND_AURA_ID,
  NYTHRAXIS_SOUL_REND_MARKER_RADIUS,
  NYTHRAXIS_SOUL_REND_SIGIL_HEIGHT,
  NYTHRAXIS_SOUL_REND_STACKED_PALETTE,
  type NythraxisSoulRendEntityLike,
  nythraxisSoulRendMarkedInto,
  nythraxisSoulRendMarkOf,
  nythraxisSoulRendPalette,
  nythraxisSoulRendPartners,
  nythraxisSoulRendPulse,
} from '../src/render/nythraxis_soul_rend_marker_core';
import { NYTHRAXIS_SOUL_REND_STACK_RANGE } from '../src/sim/encounters/nythraxis';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

const readSource = (path: string): string =>
  codeWithoutLineComments(readFileSync(new URL(path, import.meta.url), 'utf8'));

function raider(
  id: number,
  x: number,
  z: number,
  marked: boolean,
  overrides: Partial<NythraxisSoulRendEntityLike> = {},
): NythraxisSoulRendEntityLike {
  return {
    id,
    dead: false,
    scale: 1,
    pos: { x, y: 0, z },
    auras: marked
      ? [
          { id: 'something_else', remaining: 3, duration: 5 },
          { id: NYTHRAXIS_SOUL_REND_AURA_ID, remaining: 6, duration: 8 },
        ]
      : [{ id: 'something_else', remaining: 3, duration: 5 }],
    ...overrides,
  };
}

function world(...entities: NythraxisSoulRendEntityLike[]): {
  entities: Map<number, NythraxisSoulRendEntityLike>;
} {
  return { entities: new Map(entities.map((entity) => [entity.id, entity])) };
}

type MarkerMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

function maxRadiusOf(mesh: THREE.Mesh): number {
  const positions = mesh.geometry.getAttribute('position');
  let maxRadius = 0;
  for (let index = 0; index < positions.count; index++) {
    maxRadius = Math.max(maxRadius, Math.hypot(positions.getX(index), positions.getZ(index)));
  }
  return maxRadius;
}

describe('Soul Rend marker core', () => {
  it('reads the encounter mark, never a corpse or another aura', () => {
    expect(nythraxisSoulRendMarkOf(raider(1, 0, 0, true))?.remaining).toBe(6);
    expect(nythraxisSoulRendMarkOf(raider(1, 0, 0, false))).toBeNull();
    expect(nythraxisSoulRendMarkOf(raider(1, 0, 0, true, { dead: true }))).toBeNull();
    // The aura id is the one the driver applies.
    expect(readSource('../src/sim/encounters/nythraxis.ts')).toContain(
      `id: '${NYTHRAXIS_SOUL_REND_AURA_ID}'`,
    );
  });

  it('collects the marked in roster order and counts partners inside the stack range', () => {
    const a = raider(1, 0, 0, true);
    const b = raider(2, 3, 0, true);
    const c = raider(3, 40, 0, true);
    const d = raider(4, 1, 0, false);
    const marked = nythraxisSoulRendMarkedInto([], [a, d, b, c]);
    expect(marked.map((entity) => entity.id)).toEqual([1, 2, 3]);
    expect(nythraxisSoulRendPartners(marked, 0)).toBe(1);
    expect(nythraxisSoulRendPartners(marked, 1)).toBe(1);
    expect(nythraxisSoulRendPartners(marked, 2)).toBe(0);
    // The ring IS the stack range: exactly on the edge still counts.
    const edge = raider(5, NYTHRAXIS_SOUL_REND_STACK_RANGE, 0, true);
    expect(nythraxisSoulRendPartners([a, edge], 0)).toBe(1);
    const beyond = raider(6, NYTHRAXIS_SOUL_REND_STACK_RANGE + 0.01, 0, true);
    expect(nythraxisSoulRendPartners([a, beyond], 0)).toBe(0);
    expect(NYTHRAXIS_SOUL_REND_MARKER_RADIUS).toBe(NYTHRAXIS_SOUL_REND_STACK_RANGE);
  });

  it('colours an unstacked mark red and a stacked one green, and pulses faster as the fuse runs', () => {
    expect(nythraxisSoulRendPalette(0)).toBe(NYTHRAXIS_SOUL_REND_ALONE_PALETTE);
    expect(nythraxisSoulRendPalette(2)).toBe(NYTHRAXIS_SOUL_REND_STACKED_PALETTE);
    const alone = new THREE.Color(NYTHRAXIS_SOUL_REND_ALONE_PALETTE.ring);
    const stacked = new THREE.Color(NYTHRAXIS_SOUL_REND_STACKED_PALETTE.ring);
    expect(alone.r).toBeGreaterThan(alone.g);
    expect(stacked.g).toBeGreaterThan(stacked.r);
    // A full-fuse pulse completes fewer cycles per second than a last-second pulse.
    const crossings = (remaining: number): number => {
      let count = 0;
      let last = nythraxisSoulRendPulse(0, remaining, 8, false);
      for (let t = 0.005; t <= 2; t += 0.005) {
        const next = nythraxisSoulRendPulse(t, remaining, 8, false);
        if (last < 0.5 !== next < 0.5) count++;
        last = next;
      }
      return count;
    };
    expect(crossings(0.5)).toBeGreaterThan(crossings(8));
    expect(nythraxisSoulRendPulse(1.23, 4, 8, true)).toBe(0.5);
    for (let t = 0; t < 3; t += 0.1) {
      const pulse = nythraxisSoulRendPulse(t, 2, 8, false);
      expect(pulse).toBeGreaterThanOrEqual(0);
      expect(pulse).toBeLessThanOrEqual(1);
    }
  });
});

describe('Soul Rend marker visual', () => {
  it('builds a ring at the exact stack range, a faint fill, and a sigil overhead', () => {
    const marker = buildNythraxisSoulRendMarker();
    expect(marker.name).toBe(NYTHRAXIS_SOUL_REND_MARKER_NAME);
    expect(marker.userData).toMatchObject({
      renderCategory: 'ui3d',
      actionable: true,
      radius: NYTHRAXIS_SOUL_REND_MARKER_RADIUS,
    });
    const ring = marker.getObjectByName(NYTHRAXIS_SOUL_REND_RING_NAME) as MarkerMesh;
    expect(maxRadiusOf(ring)).toBeCloseTo(NYTHRAXIS_SOUL_REND_MARKER_RADIUS, 5);
    expect(ring.material.color.getHex()).toBe(NYTHRAXIS_SOUL_REND_ALONE_PALETTE.ring);
    expect(ring.material.opacity).toBeGreaterThanOrEqual(0.75);
    const fill = marker.getObjectByName(NYTHRAXIS_SOUL_REND_FILL_NAME) as MarkerMesh;
    expect(maxRadiusOf(fill)).toBeLessThan(NYTHRAXIS_SOUL_REND_MARKER_RADIUS);
    expect(fill.material.opacity).toBeLessThan(0.3);
    const sigil = marker.getObjectByName(NYTHRAXIS_SOUL_REND_SIGIL_NAME) as THREE.Group;
    expect(sigil.position.y).toBeCloseTo(NYTHRAXIS_SOUL_REND_SIGIL_HEIGHT, 5);
    expect(sigil.getObjectByName(NYTHRAXIS_SOUL_REND_SIGIL_RING_NAME)).toBeDefined();
    expect(sigil.getObjectByName(NYTHRAXIS_SOUL_REND_SIGIL_BLADE_NAME)).toBeDefined();
    // Tier-independent: the module never reads the graphics preset.
    expect(readSource('../src/render/nythraxis_soul_rend_marker.ts')).not.toMatch(/from '\.\/gfx'/);
  });

  it('marks every marked raider, follows them, and recolours when a partner enters the ring', () => {
    const scene = new THREE.Scene();
    const markers = new NythraxisSoulRendMarkers(scene, () => 1.5);
    const a = raider(1, 0, 0, true);
    const b = raider(2, 20, 0, true, { scale: 1.4 });
    const c = raider(3, 10, 10, false);
    markers.syncWorld(world(a, b, c));
    expect(markers.count).toBe(2);
    const groups = scene.children.filter((child) => child.name === NYTHRAXIS_SOUL_REND_MARKER_NAME);
    expect(groups.map((group) => group.userData.entityId).sort()).toEqual([1, 2]);
    const markerA = groups.find((group) => group.userData.entityId === 1) as THREE.Group;
    const markerB = groups.find((group) => group.userData.entityId === 2) as THREE.Group;
    expect(markerA.position.toArray()).toEqual([0, 1.5, 0]);
    expect(markerB.position.toArray()).toEqual([20, 1.5, 0]);
    // The sigil rides the raider's height; the floor ring stays world-sized.
    const sigilB = markerB.getObjectByName(NYTHRAXIS_SOUL_REND_SIGIL_NAME) as THREE.Group;
    expect(sigilB.position.y).toBeCloseTo(NYTHRAXIS_SOUL_REND_SIGIL_HEIGHT * 1.4, 5);
    expect(markerB.scale.x).toBe(1);
    // Alone: red on both.
    const ringA = markerA.getObjectByName(NYTHRAXIS_SOUL_REND_RING_NAME) as MarkerMesh;
    expect(ringA.material.color.getHex()).toBe(NYTHRAXIS_SOUL_REND_ALONE_PALETTE.ring);
    expect(markerA.userData.stacked).toBe(false);

    // B walks into A's ring: both go green, and the markers moved with them.
    b.pos.x = 4;
    markers.syncWorld(world(a, b, c));
    expect(markerB.position.x).toBe(4);
    expect(
      scene.children.filter((child) => child.name === NYTHRAXIS_SOUL_REND_MARKER_NAME),
    ).toEqual(groups);
    expect(ringA.material.color.getHex()).toBe(NYTHRAXIS_SOUL_REND_STACKED_PALETTE.ring);
    const sigilRingB = markerB.getObjectByName(NYTHRAXIS_SOUL_REND_SIGIL_RING_NAME) as MarkerMesh;
    expect(sigilRingB.material.color.getHex()).toBe(NYTHRAXIS_SOUL_REND_STACKED_PALETTE.sigil);
    expect(markerA.userData).toMatchObject({ stacked: true, partners: 1 });

    // The mark detonates: both markers go the same sync, materials disposed.
    const disposes = [ringA, sigilRingB].map((mesh) => vi.spyOn(mesh.material, 'dispose'));
    markers.syncWorld(world(raider(1, 0, 0, false), raider(2, 4, 0, false), c));
    expect(markers.count).toBe(0);
    expect(scene.children).toHaveLength(0);
    for (const dispose of disposes) expect(dispose).toHaveBeenCalledOnce();
    // Shared geometry survives disposal: a new marker still has its ring.
    markers.syncWorld(world(raider(4, 0, 0, true)));
    expect(markers.count).toBe(1);
    expect(
      maxRadiusOf(scene.children[0].getObjectByName(NYTHRAXIS_SOUL_REND_RING_NAME) as THREE.Mesh),
    ).toBeCloseTo(NYTHRAXIS_SOUL_REND_MARKER_RADIUS, 5);
    markers.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('keeps the ring readable through the pulse and holds the sigil still under reduced motion', () => {
    const scene = new THREE.Scene();
    const markers = new NythraxisSoulRendMarkers(scene, () => 0);
    markers.syncWorld(world(raider(1, 0, 0, true)));
    const marker = scene.children[0] as THREE.Group;
    const ring = marker.getObjectByName(NYTHRAXIS_SOUL_REND_RING_NAME) as MarkerMesh;
    const sigil = marker.getObjectByName(NYTHRAXIS_SOUL_REND_SIGIL_NAME) as THREE.Group;
    const sigilRing = marker.getObjectByName(NYTHRAXIS_SOUL_REND_SIGIL_RING_NAME) as MarkerMesh;
    for (let step = 0; step < 30; step++) {
      markers.update(0.05);
      expect(ring.material.opacity).toBeGreaterThanOrEqual(0.75);
    }
    expect(sigilRing.rotation.z).not.toBe(0);
    markers.update(0.5, true);
    const heldY = sigil.position.y;
    const heldSpin = sigilRing.rotation.z;
    markers.update(0.5, true);
    expect(sigil.position.y).toBe(heldY);
    expect(sigilRing.rotation.z).toBe(heldSpin);
    markers.update(0.5, false);
    expect(sigilRing.rotation.z).not.toBe(heldSpin);
  });

  it('rides the shared mechanic facade and is staged at the crypt prewarm', () => {
    const facade = readSource('../src/render/nythraxis_mechanic_visuals.ts');
    expect(facade).toContain('this.soulRendMarkers.syncWorld(world)');
    expect(facade).toContain('this.soulRendMarkers.update(dt, reducedMotion)');
    expect(facade).toContain('this.soulRendMarkers.dispose()');
    const prewarm = buildNythraxisGravePrewarmVisual();
    expect(prewarm.getObjectByName(NYTHRAXIS_SOUL_REND_MARKER_NAME)).toBeDefined();
  });
});
