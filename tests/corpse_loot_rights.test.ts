import { describe, expect, it, vi } from 'vitest';
import { corpseLootAvailability } from '../src/game/corpse_loot_availability';
import { tryNearbyInteraction } from '../src/game/nearby_interaction';
import { LOOT_FFA_DELAY } from '../src/sim/loot/loot_ffa';
import type { Entity } from '../src/sim/types';

// A corpse you have no right to loot must not shadow the resource node under
// it. The interact picker gives corpses absolute priority, and the old
// availability predicate answered "does loot EXIST", not "may I take it", so a
// stranger's unlooted kill sitting on a gather node captured every interact
// press into a denied lootCorpse ("You don't have permission to loot that")
// for the full LOOT_FFA_DELAY owner-lock. These suites pin the rights-aware
// predicate: the press must fall through to the node while the owner-lock
// holds, and the corpse must come back once the lock lapses (mirrored online
// via the ffa wire key, tests/snapshots.test.ts).

const ME = 1;
const STRANGER = 9;

function corpse(overrides: Partial<Entity>): Entity {
  return {
    id: 2,
    kind: 'mob',
    // forest_wolf carries componentTags: harvestable when unclaimed.
    templateId: 'forest_wolf',
    dead: true,
    lootable: true,
    loot: null,
    tappedById: null,
    lootFfaTimer: Infinity,
    harvestClaimedBy: null,
    pos: { x: 1, y: 0, z: 0 },
    ...overrides,
  } as Entity;
}

function player(): Entity {
  return { id: ME, kind: 'player', dead: false, ghost: false, pos: { x: 0, y: 0, z: 0 } } as Entity;
}

const NODE = { id: 'copper_node_1', pos: { x: 2, y: 0, z: 0 }, type: 'ore', tier: 1 } as const;

function rig(e: Entity, partyInfo: { members: { pid: number }[] } | null = null) {
  const lootCorpse = vi.fn(() => true as const);
  const harvestCorpse = vi.fn();
  const harvestNode = vi.fn(() => true as const);
  const world = {
    player: player(),
    playerId: ME,
    partyInfo,
    entities: new Map([[e.id, e]]),
    questLog: new Map(),
    targetEntity: () => {},
    interact: () => {},
    lootCorpse,
    harvestCorpse,
    delveInteract: () => false as const,
    enterDungeon: () => false as const,
    leaveDungeon: () => false as const,
    pickUpObject: () => false as const,
    nodeHarvestableByMe: () => true,
    harvestNode,
  } as unknown as Parameters<typeof tryNearbyInteraction>[0];
  const hud = {
    openMailbox: () => {},
    openQuestDialog: () => {},
    openDelveBoard: () => {},
    showError: vi.fn(),
  } as unknown as Parameters<typeof tryNearbyInteraction>[1] & {
    showError: ReturnType<typeof vi.fn>;
  };
  const press = () =>
    tryNearbyInteraction(world, hud, [NODE], null, 'far', 'notReady', 'escortAway', 'nothing');
  return { world, hud, press, lootCorpse, harvestCorpse, harvestNode };
}

// Loot only the STRANGER may take: tapped by them, owner-lock still counting.
const strangerLoot = () => ({
  copper: 12,
  items: [{ itemId: 'wolf_fang', count: 1 }],
});

describe('the reported bug: a rights-less corpse must not shadow the node', () => {
  it('a fresh stranger-tapped corpse with plain loot yields the press to the node (no denied lootCorpse)', () => {
    const { press, lootCorpse, harvestCorpse, harvestNode, hud } = rig(
      corpse({
        // harvestClaimedBy set: nothing harvestable either, a pure loot corpse.
        harvestClaimedBy: STRANGER,
        tappedById: STRANGER,
        lootFfaTimer: LOOT_FFA_DELAY,
        loot: strangerLoot(),
      }),
    );

    expect(press()).toBe(true);
    expect(harvestNode).toHaveBeenCalledWith(NODE.id);
    expect(lootCorpse).not.toHaveBeenCalled();
    expect(harvestCorpse).not.toHaveBeenCalled();
    expect(hud.showError).not.toHaveBeenCalled();
  });

  it('a copper-only stranger corpse also yields to the node', () => {
    const { press, lootCorpse, harvestNode } = rig(
      corpse({
        harvestClaimedBy: STRANGER,
        tappedById: STRANGER,
        lootFfaTimer: LOOT_FFA_DELAY,
        loot: { copper: 30, items: [] },
      }),
    );

    expect(press()).toBe(true);
    expect(harvestNode).toHaveBeenCalledWith(NODE.id);
    expect(lootCorpse).not.toHaveBeenCalled();
  });
});

describe('deliberately preserved corpse-priority arms', () => {
  it("the presser's own tap still loots first", () => {
    const { press, lootCorpse, harvestNode } = rig(
      corpse({
        harvestClaimedBy: STRANGER,
        tappedById: ME,
        lootFfaTimer: LOOT_FFA_DELAY,
        loot: strangerLoot(),
      }),
    );

    expect(press()).toBe(true);
    expect(lootCorpse).toHaveBeenCalledWith(2);
    expect(harvestNode).not.toHaveBeenCalled();
  });

  it("a party member's tap still loots first (my party stands in for the tapper's)", () => {
    const { press, lootCorpse, harvestNode } = rig(
      corpse({
        harvestClaimedBy: STRANGER,
        tappedById: STRANGER,
        lootFfaTimer: LOOT_FFA_DELAY,
        loot: strangerLoot(),
      }),
      { members: [{ pid: ME }, { pid: STRANGER }] },
    );

    expect(press()).toBe(true);
    expect(lootCorpse).toHaveBeenCalledWith(2);
    expect(harvestNode).not.toHaveBeenCalled();
  });

  it('an FFA-lapsed stranger corpse is offered again (the documented deliberate-press take)', () => {
    const { press, lootCorpse, harvestNode } = rig(
      corpse({
        harvestClaimedBy: STRANGER,
        tappedById: STRANGER,
        lootFfaTimer: 0,
        loot: strangerLoot(),
      }),
    );

    expect(press()).toBe(true);
    expect(lootCorpse).toHaveBeenCalledWith(2);
    expect(harvestNode).not.toHaveBeenCalled();
  });

  it('a HARVESTABLE unclaimed stranger corpse still takes priority, harvest half only', () => {
    const { press, lootCorpse, harvestCorpse, harvestNode, hud } = rig(
      corpse({
        harvestClaimedBy: null,
        tappedById: STRANGER,
        lootFfaTimer: LOOT_FFA_DELAY,
        loot: strangerLoot(),
      }),
    );

    expect(press()).toBe(true);
    expect(harvestCorpse).toHaveBeenCalledWith(2);
    expect(lootCorpse).not.toHaveBeenCalled();
    expect(harvestNode).not.toHaveBeenCalled();
    expect(hud.showError).not.toHaveBeenCalled();
  });

  it('a personal drop naming me keeps the corpse first even on a stranger tap', () => {
    const { press, lootCorpse, harvestNode } = rig(
      corpse({
        harvestClaimedBy: STRANGER,
        tappedById: STRANGER,
        lootFfaTimer: LOOT_FFA_DELAY,
        loot: { copper: 0, items: [{ itemId: 'wolf_fang', count: 1, personalFor: [ME] }] },
      }),
    );

    expect(press()).toBe(true);
    expect(lootCorpse).toHaveBeenCalledWith(2);
    expect(harvestNode).not.toHaveBeenCalled();
  });

  it('a party roster WITHOUT the tapper grants nothing (stranger party)', () => {
    const { press, lootCorpse, harvestNode } = rig(
      corpse({
        harvestClaimedBy: STRANGER,
        tappedById: STRANGER,
        lootFfaTimer: LOOT_FFA_DELAY,
        loot: strangerLoot(),
      }),
      { members: [{ pid: ME }, { pid: 5 }] },
    );

    expect(press()).toBe(true);
    expect(harvestNode).toHaveBeenCalledWith(NODE.id);
    expect(lootCorpse).not.toHaveBeenCalled();
  });
});

describe('corpseLootAvailability partyMemberIds arm (direct)', () => {
  const freshStranger = () =>
    corpse({
      harvestClaimedBy: STRANGER,
      tappedById: STRANGER,
      lootFfaTimer: LOOT_FFA_DELAY,
      loot: strangerLoot(),
    });

  it('grants shared rights when the tapper is in the given party roster', () => {
    const withParty = corpseLootAvailability(freshStranger(), ME, true, [ME, STRANGER]);
    expect(withParty.hasLoot).toBe(true);
    expect(withParty.canOpen).toBe(true);
  });

  it('denies when the roster is absent or does not contain the tapper', () => {
    for (const roster of [null, [ME, 5]] as const) {
      const result = corpseLootAvailability(freshStranger(), ME, true, roster);
      expect(result.hasLoot, `roster ${JSON.stringify(roster)}`).toBe(false);
      expect(result.canOpen, `roster ${JSON.stringify(roster)}`).toBe(false);
    }
  });
});
