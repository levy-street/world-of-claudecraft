import { describe, expect, it } from 'vitest';
import { nearestInteractableFeast } from '../src/game/feast_interact';
import { type Entity, INTERACT_RANGE } from '../src/sim/types';

// The pure feast resolver for the interact funnel's Phase 12 arm: the nearest
// kind:'object' entity carrying ANY placed-feast templateId, within the
// INCLUSIVE interact range (the farm_bed_interact comparator exactly), so the
// client never refuses a press the sim would accept (the sim's own deny is
// strictly `> INTERACT_RANGE`).
// The templateIds are asserted against LITERALS below (never re-imported from
// the sim constants): the feast entities the sim spawns carry these exact
// strings on the wire, so a constant-value drift must red here.
// EVERY TIER, not only the party rung (masterwrought Phase 11k widened the
// family and its QA found this file still driving one template): the resolver
// asks isFeastTemplateId, which is derived from the catalog, so an apex rung
// must open the same press.

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

  it('opens on an APEX rung too, not only the party feast', () => {
    // The literal templateIds the three apex feast defs carry
    // (content/profession_items.ts). Written out rather than derived, because
    // the claim under test is that the client resolver admits the wire strings
    // the sim really spawns; a derivation would move with the catalog and
    // could not see a wire-value drift.
    for (const templateId of ['stonepot_feast', 'warspice_feast', 'sageleaf_feast']) {
      const feast = entity({ id: 11, kind: 'object', templateId, pos: { x: 3, y: 0, z: 0 } });
      expect(nearestInteractableFeast(mapOf(feast), ORIGIN), templateId).toBe(11);
    }
    // And the negative that keeps it honest: a placed object of the same kind
    // that is NOT a feast opens nothing.
    const bed = entity({
      id: 12,
      kind: 'object',
      templateId: 'farm_bed',
      pos: { x: 1, y: 0, z: 0 },
    });
    expect(nearestInteractableFeast(mapOf(bed), ORIGIN), 'a farm bed is not a feast').toBeNull();
  });

  it('is INCLUSIVE at the exact interact range and excludes just beyond it', () => {
    // The sim refuses strictly beyond INTERACT_RANGE with the merged
    // not-found frame (farmDenied 'feast_expired', the Phase 18
    // existence-oracle guard; 'feast_range' is reserved and unemitted), so
    // the client boundary must be <=: a press at exactly the range is one the
    // sim accepts, and the client never pre-refuses it.
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
