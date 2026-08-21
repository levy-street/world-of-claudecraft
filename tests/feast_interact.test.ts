import { describe, expect, it } from 'vitest';
import { nearestInteractableFeast } from '../src/game/feast_interact';
import { type Entity, INTERACT_RANGE } from '../src/sim/types';

// The pure feast resolver for the interact funnel's Phase 12 arm: nearest
// kind:'object' farm_feast entity within the INCLUSIVE interact range (the
// farm_bed_interact comparator exactly), so the client never refuses a press
// the sim would accept (the sim's own deny is strictly `> INTERACT_RANGE`).
// The templateId is asserted against the LITERAL 'farm_feast' below (never
// re-imported from the sim constant): the feast entities the sim spawns carry
// this exact string on the wire, so a constant-value drift must red here.

function entity(overrides: Partial<Entity> & Pick<Entity, 'id' | 'kind'>): Entity {
  return {
    templateId: 'farm_feast',
    pos: { x: 0, y: 0, z: 0 },
    dead: false,
    lootable: false,
    ...overrides,
  } as Entity;
}

const ORIGIN = { x: 0, y: 0, z: 0 };

function mapOf(...list: Entity[]): ReadonlyMap<number, Entity> {
  return new Map(list.map((e) => [e.id, e]));
}

describe('nearestInteractableFeast', () => {
  it('finds a feast within reach', () => {
    const feast = entity({ id: 7, kind: 'object', pos: { x: 3, y: 0, z: 0 } });
    expect(nearestInteractableFeast(mapOf(feast), ORIGIN)).toBe(7);
  });

  it('is INCLUSIVE at the exact interact range and excludes just beyond it', () => {
    // The sim refuses strictly beyond INTERACT_RANGE (feast_range), so the
    // client boundary must be <=: a press at exactly the range is one the sim
    // accepts, and the client never pre-refuses it.
    const atBoundary = entity({ id: 1, kind: 'object', pos: { x: INTERACT_RANGE, y: 0, z: 0 } });
    expect(nearestInteractableFeast(mapOf(atBoundary), ORIGIN)).toBe(1);
    const beyond = entity({
      id: 2,
      kind: 'object',
      pos: { x: INTERACT_RANGE + 0.001, y: 0, z: 0 },
    });
    expect(nearestInteractableFeast(mapOf(beyond), ORIGIN)).toBeNull();
  });

  it('picks the nearer of two feasts regardless of iteration order', () => {
    const far = entity({ id: 1, kind: 'object', pos: { x: 3, y: 0, z: 0 } });
    const near = entity({ id: 2, kind: 'object', pos: { x: 1, y: 0, z: 0 } });
    expect(nearestInteractableFeast(mapOf(far, near), ORIGIN)).toBe(2);
    expect(nearestInteractableFeast(mapOf(near, far), ORIGIN)).toBe(2);
  });

  it('keeps the FIRST feast on an exact distance tie (strict < on best, bed-arm stability)', () => {
    const first = entity({ id: 5, kind: 'object', pos: { x: 2, y: 0, z: 0 } });
    const second = entity({ id: 6, kind: 'object', pos: { x: -2, y: 0, z: 0 } });
    expect(nearestInteractableFeast(mapOf(first, second), ORIGIN)).toBe(5);
  });

  it('ignores non-feast objects and non-object feast impostors underfoot', () => {
    // A nearer ground-loot object must never win the feast press, and a mob
    // that somehow carries the templateId is not a feast either: both gates
    // (kind AND templateId) are load-bearing.
    const groundLoot = entity({ id: 1, kind: 'object', templateId: 'ground_bread' });
    const mobImpostor = entity({ id: 2, kind: 'mob' });
    const feast = entity({ id: 3, kind: 'object', pos: { x: 4, y: 0, z: 0 } });
    expect(nearestInteractableFeast(mapOf(groundLoot, mobImpostor, feast), ORIGIN)).toBe(3);
    expect(nearestInteractableFeast(mapOf(groundLoot, mobImpostor), ORIGIN)).toBeNull();
  });

  it('returns null on an empty map', () => {
    expect(nearestInteractableFeast(new Map(), ORIGIN)).toBeNull();
  });
});
