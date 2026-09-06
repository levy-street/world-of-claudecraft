import { describe, expect, it, vi } from 'vitest';
import { corpseLootAvailability } from '../src/game/corpse_loot_availability';
import { handleGatherNodeInteract } from '../src/game/gather_node_interact';
import { tryNearbyInteraction } from '../src/game/nearby_interaction';
import { LOOT_FFA_DELAY } from '../src/sim/loot/loot_ffa';
import type { Entity } from '../src/sim/types';

// A corpse you have no right to loot must not capture the interact press. The
// old availability predicate answered "does loot EXIST", not "may I take it",
// so a stranger's unlooted kill captured every interact press into a denied
// lootCorpse ("You don't have permission to loot that") for the full
// LOOT_FFA_DELAY owner-lock. These suites pin the rights-aware predicate: the
// generic press sends NO loot command while the owner-lock holds, and the
// corpse comes back once the lock lapses (mirrored online via the ffa wire
// key, tests/snapshots.test.ts).
//
// Intentional gathering: the generic press is ordinary loot ONLY. It never
// falls through to the node under the corpse and never sends the corpse
// harvest half; the node is still gathered through its EXPLICIT entry point
// (handleGatherNodeInteract, the node click), which these suites drive beside
// the same body to prove the body never blocks it.

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
    // The press now falls through past the corpse to the bed arm, which
    // reads these; inert here.
    farmPatches: [],
    myFarmPlots: [],
  } as unknown as Parameters<typeof tryNearbyInteraction>[0] &
    Parameters<typeof handleGatherNodeInteract>[0];
  const hud = {
    openMailbox: () => {},
    openQuestDialog: () => {},
    openDelveBoard: () => {},
    showError: vi.fn(),
  } as unknown as Parameters<typeof tryNearbyInteraction>[1] & {
    showError: ReturnType<typeof vi.fn>;
  };
  // The generic press (F / interact key).
  const press = () => tryNearbyInteraction(world, hud, 'escortAway', 'nothing');
  // The explicit node action (a click on the node beside the body).
  const gatherNode = () =>
    handleGatherNodeInteract(world, hud, world.player.pos, NODE.id, NODE.pos, 'far', 'notReady');
  return { world, hud, press, gatherNode, lootCorpse, harvestCorpse, harvestNode };
}

// Loot only the STRANGER may take: tapped by them, owner-lock still counting.
const strangerLoot = () => ({
  copper: 12,
  items: [{ itemId: 'wolf_fang', count: 1 }],
});

// The generic press beside a rights-less corpse: no loot, no harvest of any
// kind, only the nothing line (never the loot denial toast).
function expectPressSendsNothing(r: ReturnType<typeof rig>) {
  expect(r.press()).toBe(false);
  expect(r.lootCorpse).not.toHaveBeenCalled();
  expect(r.harvestCorpse).not.toHaveBeenCalled();
  expect(r.harvestNode).not.toHaveBeenCalled();
  expect(r.hud.showError).toHaveBeenCalledTimes(1);
  expect(r.hud.showError).toHaveBeenCalledWith('nothing');
}

describe('the reported bug: a rights-less corpse must not capture the press', () => {
  it('a fresh stranger-tapped corpse with plain loot gets no denied lootCorpse, and the node still gathers explicitly', () => {
    const r = rig(
      corpse({
        // harvestClaimedBy set: nothing harvestable either, a pure loot corpse.
        harvestClaimedBy: STRANGER,
        tappedById: STRANGER,
        lootFfaTimer: LOOT_FFA_DELAY,
        loot: strangerLoot(),
      }),
    );

    expectPressSendsNothing(r);

    expect(r.gatherNode()).toBe(true);
    expect(r.harvestNode).toHaveBeenCalledWith(NODE.id);
    expect(r.lootCorpse).not.toHaveBeenCalled();
    expect(r.harvestCorpse).not.toHaveBeenCalled();
  });

  it('a copper-only stranger corpse also sends no loot on the press', () => {
    const r = rig(
      corpse({
        harvestClaimedBy: STRANGER,
        tappedById: STRANGER,
        lootFfaTimer: LOOT_FFA_DELAY,
        loot: { copper: 30, items: [] },
      }),
    );

    expectPressSendsNothing(r);

    expect(r.gatherNode()).toBe(true);
    expect(r.harvestNode).toHaveBeenCalledWith(NODE.id);
  });
});

describe('deliberately preserved corpse-priority arms', () => {
  it("the presser's own tap still loots first", () => {
    const { press, lootCorpse, harvestCorpse, harvestNode } = rig(
      corpse({
        harvestClaimedBy: STRANGER,
        tappedById: ME,
        lootFfaTimer: LOOT_FFA_DELAY,
        loot: strangerLoot(),
      }),
    );

    expect(press()).toBe(true);
    expect(lootCorpse).toHaveBeenCalledWith(2);
    expect(harvestCorpse).not.toHaveBeenCalled();
    expect(harvestNode).not.toHaveBeenCalled();
  });

  it("a party member's tap still loots first (my party stands in for the tapper's)", () => {
    const { press, lootCorpse, harvestCorpse, harvestNode } = rig(
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
    expect(harvestCorpse).not.toHaveBeenCalled();
    expect(harvestNode).not.toHaveBeenCalled();
  });

  it('an FFA-lapsed stranger corpse is offered again (the documented deliberate-press take)', () => {
    const { press, lootCorpse, harvestCorpse, harvestNode } = rig(
      corpse({
        harvestClaimedBy: STRANGER,
        tappedById: STRANGER,
        lootFfaTimer: 0,
        loot: strangerLoot(),
      }),
    );

    expect(press()).toBe(true);
    expect(lootCorpse).toHaveBeenCalledWith(2);
    expect(harvestCorpse).not.toHaveBeenCalled();
    expect(harvestNode).not.toHaveBeenCalled();
  });

  it('a HARVESTABLE unclaimed stranger corpse is no press target: its harvest half is never sent', () => {
    // Before intentional gathering this corpse captured the press for its
    // harvest half alone. Harvest is an explicit action now, so the press
    // sends nothing at all, and the explicit node action beside it still works.
    const r = rig(
      corpse({
        harvestClaimedBy: null,
        tappedById: STRANGER,
        lootFfaTimer: LOOT_FFA_DELAY,
        loot: strangerLoot(),
      }),
    );

    expectPressSendsNothing(r);

    expect(r.gatherNode()).toBe(true);
    expect(r.harvestNode).toHaveBeenCalledWith(NODE.id);
    expect(r.harvestCorpse).not.toHaveBeenCalled();
  });

  it('a personal drop naming me keeps the corpse first even on a stranger tap', () => {
    const { press, lootCorpse, harvestCorpse, harvestNode } = rig(
      corpse({
        harvestClaimedBy: STRANGER,
        tappedById: STRANGER,
        lootFfaTimer: LOOT_FFA_DELAY,
        loot: { copper: 0, items: [{ itemId: 'wolf_fang', count: 1, personalFor: [ME] }] },
      }),
    );

    expect(press()).toBe(true);
    expect(lootCorpse).toHaveBeenCalledWith(2);
    expect(harvestCorpse).not.toHaveBeenCalled();
    expect(harvestNode).not.toHaveBeenCalled();
  });

  it('a party roster WITHOUT the tapper grants nothing (stranger party)', () => {
    const r = rig(
      corpse({
        harvestClaimedBy: STRANGER,
        tappedById: STRANGER,
        lootFfaTimer: LOOT_FFA_DELAY,
        loot: strangerLoot(),
      }),
      { members: [{ pid: ME }, { pid: 5 }] },
    );

    expectPressSendsNothing(r);
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
