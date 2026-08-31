// Client-side battleground flag routing (src/game/bg_flag_interact.ts).
//
// The bug this covers: the general Interact key unconditionally routed to
// bgFlagAction whenever a Thornhollow Fields match was active, on the
// assumption the field held no other interactable. A Warlock's Soulwell can
// be summoned anywhere, including right next to a flag stand, and every
// press near it (or anywhere else in the field, including at the player's
// OWN flag) was swallowed by a doomed flag grab: "There is no flag within
// reach." bgFlagGrabbableNearby is the fix's pure core: it decides whether an
// enemy flag is actually reachable, so the Interact key can fall through to
// the ordinary nearby-interaction scan otherwise.
import { describe, expect, it } from 'vitest';
import { bgFlagGrabbableNearby, shouldRouteInteractToBgFlag } from '../src/game/bg_flag_interact';
import { BG_PICKUP_RADIUS, BG_TEAM_COLORS } from '../src/sim/battleground_layout';
import type { Entity } from '../src/sim/types';
import type { BgMatchInfo } from '../src/world_api/battleground';

function flagEntity(team: 0 | 1, x: number, z: number, overrides: Partial<Entity> = {}): Entity {
  return {
    id: team === 0 ? 100 : 101,
    kind: 'object',
    templateId: 'bg_flag',
    name: 'Flag',
    pos: { x, y: 0, z },
    color: BG_TEAM_COLORS[team],
    dead: false,
    ghost: false,
    lootable: false,
    loot: null,
    harvestClaimedBy: null,
    dungeonId: null,
    hostile: false,
    ...overrides,
  } as Entity;
}

function soulwell(x: number, z: number): Entity {
  return {
    id: 200,
    kind: 'object',
    templateId: 'soulwell',
    objectItemId: 'soulwell',
    name: 'Soulwell',
    pos: { x, y: 0, z },
    color: 0xffffff,
    dead: false,
    ghost: false,
    lootable: false,
    loot: null,
    harvestClaimedBy: null,
    dungeonId: null,
    hostile: false,
  } as Entity;
}

function entities(...list: Entity[]): Map<number, Entity> {
  return new Map(list.map((e) => [e.id, e]));
}

// myTeam 0 (Crimson): the enemy flag is team 1 (Azure).
function match(overrides: Partial<BgMatchInfo> = {}): Pick<BgMatchInfo, 'myTeam' | 'flags'> {
  return {
    myTeam: 0,
    flags: [
      { state: 'home', carrierPid: null, carrierName: null, carrierTeam: null },
      { state: 'home', carrierPid: null, carrierName: null, carrierTeam: null },
    ],
    ...overrides,
  };
}

describe('bgFlagGrabbableNearby', () => {
  it('is true standing next to the enemy flag at its stand', () => {
    const enemyFlag = flagEntity(1, 10, 20);
    const playerPos = { x: 10, y: 0, z: 20 + BG_PICKUP_RADIUS - 0.1 };

    expect(bgFlagGrabbableNearby(match(), playerPos, entities(enemyFlag))).toBe(true);
  });

  it('is false well out past BG_PICKUP_RADIUS from the enemy flag', () => {
    const enemyFlag = flagEntity(1, 10, 20);
    const playerPos = { x: 10, y: 0, z: 20 + BG_PICKUP_RADIUS + 1 };

    expect(bgFlagGrabbableNearby(match(), playerPos, entities(enemyFlag))).toBe(false);
  });

  it('is false just past BG_PICKUP_RADIUS so ordinary interact fallback can run', () => {
    // The authoritative server action rejects this distance. The Interact key
    // must therefore fall through here, otherwise a Soulwell or other nearby
    // interactable can be swallowed by a doomed flag press.
    const enemyFlag = flagEntity(1, 10, 20);
    const playerPos = { x: 10, y: 0, z: 20 + BG_PICKUP_RADIUS + 0.3 };

    expect(bgFlagGrabbableNearby(match(), playerPos, entities(enemyFlag))).toBe(false);
  });

  it('is false standing next to your OWN flag: it is not the one bgFlagAction can grab', () => {
    // The reported bug: a Warlock's Soulwell built at the home base, right by
    // the team's own flag stand, was unreachable all match because interactKey
    // always tried (and failed) to grab this flag instead.
    const ownFlag = flagEntity(0, 10, -118);
    const playerPos = { x: 10, y: 0, z: -118 };

    expect(bgFlagGrabbableNearby(match(), playerPos, entities(ownFlag))).toBe(false);
  });

  it('is false while the enemy flag is already carried', () => {
    const enemyFlag = flagEntity(1, 10, 20);
    const playerPos = { x: 10, y: 0, z: 20 };
    const carriedMatch = match({
      flags: [
        { state: 'home', carrierPid: null, carrierName: null, carrierTeam: null },
        { state: 'carried', carrierPid: 9, carrierName: 'Rival', carrierTeam: 1 },
      ],
    });

    expect(bgFlagGrabbableNearby(carriedMatch, playerPos, entities(enemyFlag))).toBe(false);
  });

  it('is false with nothing flag-shaped nearby at all', () => {
    const well = soulwell(0, 0);
    const playerPos = { x: 0, y: 0, z: 0 };

    expect(bgFlagGrabbableNearby(match(), playerPos, entities(well))).toBe(false);
  });

  it('lets a Soulwell dropped at the flag stand stay reachable: not near enough to any grabbable flag', () => {
    // The exact reported scenario: a Soulwell placed at the (home) flag area.
    // Standing at the Soulwell means standing at the OWN flag, which never
    // counts, so the press must fall through to the ordinary interaction scan.
    const ownFlag = flagEntity(0, 10, -118);
    const well = soulwell(10.5, -118);
    const playerPos = { x: 10.5, y: 0, z: -118 };

    expect(bgFlagGrabbableNearby(match(), playerPos, entities(ownFlag, well))).toBe(false);
  });

  it('is true at the boundary distance (server check is inclusive)', () => {
    const enemyFlag = flagEntity(1, 0, 0);
    const playerPos = { x: BG_PICKUP_RADIUS, y: 0, z: 0 };

    expect(bgFlagGrabbableNearby(match(), playerPos, entities(enemyFlag))).toBe(true);
  });

  it('ignores an object entity with an unrecognized color (never a flag)', () => {
    const stray = flagEntity(1, 0, 0, { color: 0x123456 });

    expect(bgFlagGrabbableNearby(match(), { x: 0, y: 0, z: 0 }, entities(stray))).toBe(false);
  });

  it('is true for an enemy flag a teammate dropped mid-field', () => {
    // Core CTF interaction: a dropped (not home, not carried) enemy flag is
    // just as grabbable as one still on its stand.
    const droppedFlag = flagEntity(1, 40, 60);
    const droppedMatch = match({
      flags: [
        { state: 'home', carrierPid: null, carrierName: null, carrierTeam: null },
        { state: 'dropped', carrierPid: null, carrierName: null, carrierTeam: null },
      ],
    });

    expect(bgFlagGrabbableNearby(droppedMatch, { x: 40, y: 0, z: 60 }, entities(droppedFlag))).toBe(
      true,
    );
  });
});

// This is the exact function main.ts's interactKey calls: it folds in the
// match-state and death gates the original bug lacked any equivalent of at
// all (the unconditional short-circuit routed to bgFlagAction on ANY active
// match, for any caster, dead or not).
describe('shouldRouteInteractToBgFlag', () => {
  const alive = { pos: { x: 0, y: 0, z: 0 }, dead: false };

  it('is true next to a grabbable enemy flag in an active match', () => {
    const enemyFlag = flagEntity(1, 0, 0);

    expect(
      shouldRouteInteractToBgFlag(
        { match: { ...match(), state: 'active' } },
        alive,
        entities(enemyFlag),
      ),
    ).toBe(true);
  });

  it('is false outside a match: bgInfo.match is null', () => {
    expect(shouldRouteInteractToBgFlag(null, alive, entities())).toBe(false);
    expect(shouldRouteInteractToBgFlag({ match: null }, alive, entities())).toBe(false);
  });

  it('is false during countdown, even standing right at a would-be-grabbable flag', () => {
    const enemyFlag = flagEntity(1, 0, 0);

    expect(
      shouldRouteInteractToBgFlag(
        { match: { ...match(), state: 'countdown' } },
        alive,
        entities(enemyFlag),
      ),
    ).toBe(false);
  });

  it('is false in an active match with nothing flag-shaped in reach: the Interact key falls through', () => {
    const well = soulwell(0, 0);

    expect(
      shouldRouteInteractToBgFlag(
        { match: { ...match(), state: 'active' } },
        alive,
        entities(well),
      ),
    ).toBe(false);
  });

  it('is false for a dead/released-ghost player, even standing right at a grabbable enemy flag', () => {
    // bgFlagAction silently no-ops for a dead caster (r.e.dead), so routing
    // there anyway would swallow a ghost's press for nothing; it must fall
    // through instead (to the spirit healer, say).
    const enemyFlag = flagEntity(1, 0, 0);
    const dead = { pos: { x: 0, y: 0, z: 0 }, dead: true };

    expect(
      shouldRouteInteractToBgFlag(
        { match: { ...match(), state: 'active' } },
        dead,
        entities(enemyFlag),
      ),
    ).toBe(false);
  });
});
