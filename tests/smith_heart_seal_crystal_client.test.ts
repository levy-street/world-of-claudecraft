// The heart seal crystal on the client's press path (docs/design/raid/smith_heart.md,
// "The heart seal"): the crystal is pressed from beside its plinth, well past the
// plain interact range of its centre, so the client's three readers of an object's
// reach (the interact key's scan, a click's range check and approach, the hover
// cursor) must agree with the sim's press gate (encounters/smith_heart/
// seal_crystal.ts SEAL_CRYSTAL_REACH, pinned against the sim by
// tests/smith_heart_seal_crystal.test.ts). Presentation of the press only: the sim
// stays authoritative.

import { describe, expect, it } from 'vitest';
import {
  hoverCursorKind,
  objectInteractionRange,
  shouldApproachPickedEntity,
} from '../src/game/interactions';
import { resolveNearbyInteractionCandidate } from '../src/game/nearby_interaction_core';
import { SMITH_HEART_SEAL_CRYSTAL_TEMPLATE } from '../src/sim/content/smith_heart';
import { SEAL_CRYSTAL } from '../src/sim/content/smith_heart_layout';
import { SEAL_CRYSTAL_REACH } from '../src/sim/encounters/smith_heart/seal_crystal';
import { type Entity, INTERACT_RANGE, type QuestProgress } from '../src/sim/types';

function entity(overrides: Partial<Entity> & Pick<Entity, 'id' | 'kind'>): Entity {
  return {
    templateId: 'test',
    name: 'Test target',
    pos: { x: 0, y: 0, z: 0 },
    dead: false,
    ghost: false,
    lootable: false,
    loot: null,
    harvestClaimedBy: null,
    dungeonId: null,
    ...overrides,
  } as Entity;
}

const crystal = (overrides: Partial<Entity> = {}): Entity =>
  entity({
    id: 40,
    kind: 'object',
    templateId: SMITH_HEART_SEAL_CRYSTAL_TEMPLATE,
    name: 'The Heart Seal Crystal',
    lootable: true,
    ...overrides,
  });

/** A world with the viewer `southOf` yards south of the crystal at the origin. */
function scan(southOf: number, targets: Entity[]) {
  const player = entity({
    id: 1,
    kind: 'player',
    name: 'Adventurer',
    pos: { x: 0, y: 0, z: -southOf },
  });
  return {
    playerId: player.id,
    player,
    entities: new Map<number, Entity>([
      [player.id, player],
      ...targets.map((t): [number, Entity] => [t.id, t]),
    ]),
    questLog: new Map<string, QuestProgress>(),
    farmPatches: [],
  };
}

describe("the crystal's reach on the client", () => {
  it("is the sim's press reach: the interact range from the plinth's edge", () => {
    expect(SEAL_CRYSTAL_REACH).toBe(INTERACT_RANGE + SEAL_CRYSTAL.r);
    expect(objectInteractionRange({ templateId: SMITH_HEART_SEAL_CRYSTAL_TEMPLATE })).toBe(
      SEAL_CRYSTAL_REACH,
    );
    // Every other object keeps the plain range.
    expect(objectInteractionRange({ templateId: 'supply_crate' })).toBe(INTERACT_RANGE);
  });

  it('a click from beside the plinth reaches it, one from across the dais walks closer', () => {
    const c = crystal();
    const beside = scan(SEAL_CRYSTAL.r + 0.5, [c]).player;
    const far = scan(SEAL_CRYSTAL_REACH + 1, [c]).player;
    expect(shouldApproachPickedEntity(beside, c, false)).toBe(false);
    expect(shouldApproachPickedEntity(far, c, false)).toBe(true);
  });

  it('shows the gauntlet while it is charged, and the plain arrow while it is dark', () => {
    expect(hoverCursorKind(crystal(), 1, new Set())).toBe('friendly');
    expect(hoverCursorKind(crystal({ lootable: false }), 1, new Set())).toBe('default');
  });
});

describe("the interact key's scan", () => {
  it('offers a charged crystal from the rim of its wall, nowhere past its reach', () => {
    const c = crystal();
    const rim = SEAL_CRYSTAL.r + 0.6;
    expect(resolveNearbyInteractionCandidate(scan(rim, [c]))).toMatchObject({
      kind: 'object',
      id: 40,
    });
    expect(resolveNearbyInteractionCandidate(scan(SEAL_CRYSTAL_REACH - 0.1, [c]))).toMatchObject({
      kind: 'object',
      id: 40,
    });
    expect(resolveNearbyInteractionCandidate(scan(SEAL_CRYSTAL_REACH + 0.1, [c]))).toBeNull();
  });

  it('offers nothing while it is dark (the sim keeps it unlootable until charged)', () => {
    expect(
      resolveNearbyInteractionCandidate(scan(SEAL_CRYSTAL.r + 0.6, [crystal({ lootable: false })])),
    ).toBeNull();
  });

  it('an ordinary object is still strictly inside the plain range, as it always was', () => {
    const crate = (z: number): Entity =>
      entity({
        id: 41,
        kind: 'object',
        templateId: 'supply_crate',
        lootable: true,
        pos: { x: 0, y: 0, z },
      });
    // The viewer stands at z = 0 here: the crate 4.9 yd away is offered, 5.0 and 5.5 are not.
    const at = (z: number) => {
      const w = scan(0, [crate(z)]);
      return resolveNearbyInteractionCandidate(w);
    };
    expect(at(4.9)).toMatchObject({ kind: 'object', id: 41 });
    expect(at(INTERACT_RANGE)).toBeNull();
    expect(at(INTERACT_RANGE + 0.5)).toBeNull();
  });

  it('the nearest object wins whatever its reach, in either map order', () => {
    const viewerZ = SEAL_CRYSTAL.r + 0.6;
    const crate = entity({
      id: 41,
      kind: 'object',
      templateId: 'supply_crate',
      lootable: true,
      // 2 yd in front of the viewer, who stands beside the plinth.
      pos: { x: 0, y: 0, z: -viewerZ + 2 },
    });
    // The crystal is 9 yd off and in reach, the crate 2 yd off: the crate is nearer
    // however the entities were mirrored in.
    expect(resolveNearbyInteractionCandidate(scan(viewerZ, [crystal(), crate]))).toMatchObject({
      kind: 'object',
      id: 41,
    });
    expect(resolveNearbyInteractionCandidate(scan(viewerZ, [crate, crystal()]))).toMatchObject({
      kind: 'object',
      id: 41,
    });
  });
});
