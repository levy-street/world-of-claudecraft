import { describe, expect, it } from 'vitest';
import { corpseLootAvailability } from '../src/game/corpse_loot_availability';
import { MOBS } from '../src/sim/data';
import type { Entity } from '../src/sim/types';

function corpse(overrides: Partial<Entity>): Entity {
  return {
    id: 2,
    kind: 'mob',
    templateId: 'test',
    loot: null,
    harvestClaimedBy: null,
    ...overrides,
  } as Entity;
}

describe('corpseLootAvailability', () => {
  it('excludes personal loot assigned only to another player', () => {
    const result = corpseLootAvailability(
      corpse({
        loot: { copper: 0, items: [{ itemId: 'wolf_fang', count: 1, personalFor: [9] }] },
      }),
      1,
    );

    expect(result.visibleItems).toEqual([]);
    expect(result.hasLoot).toBe(false);
    expect(result.canOpen).toBe(false);
  });

  it('includes personal loot assigned to the local player', () => {
    const result = corpseLootAvailability(
      corpse({
        loot: { copper: 0, items: [{ itemId: 'wolf_fang', count: 1, personalFor: [1] }] },
      }),
      1,
    );

    expect(result.visibleItems).toHaveLength(1);
    expect(result.hasLoot).toBe(true);
    expect(result.canOpen).toBe(true);
  });

  it('keeps a depleted skinnable corpse open for harvesting', () => {
    const result = corpseLootAvailability(
      corpse({ templateId: 'forest_wolf', loot: null, harvestClaimedBy: null }),
      1,
    );

    expect(result.hasLoot).toBe(false);
    expect(result.harvestable).toBe(true);
    expect(result.canOpen).toBe(true);
  });

  it('closes a depleted corpse whose every component family is unmapped (#2513)', () => {
    // fen_troll carries claw and tusk and HARVEST_COMPONENT_ITEMS maps neither,
    // so the sim refuses a harvest there. This arm used to answer on the tag
    // COUNT and reported the corpse harvestable, which kept the popup open on
    // an empty body with an enabled Harvest button whose every submit the server
    // refused. It now reads the sim's own isHarvestableCorpse.
    expect(MOBS.fen_troll.componentTags).toEqual(['claw', 'tusk']);
    const depleted = corpseLootAvailability(
      corpse({ templateId: 'fen_troll', loot: null, harvestClaimedBy: null }),
      1,
    );
    expect(depleted.hasLoot).toBe(false);
    expect(depleted.harvestable).toBe(false);
    expect(depleted.canOpen).toBe(false);
    // The corpse is NOT orphaned while it still holds loot: fen_troll drops
    // copper at 100%, so the popup still opens for the coin, only without the
    // picker section. Suppressing the dead affordance must not cost the player
    // the live one.
    const withCoin = corpseLootAvailability(
      corpse({ templateId: 'fen_troll', loot: { copper: 50, items: [] }, harvestClaimedBy: null }),
      1,
    );
    expect(withCoin.harvestable).toBe(false);
    expect(withCoin.hasLoot).toBe(true);
    expect(withCoin.canOpen).toBe(true);
    expect(withCoin.visibleCopper).toBe(50);
    // The discriminator on the identical fixture: a template carrying the same
    // unmapped families beside a mapped one stays harvestable, so this is the
    // yield table talking and not a fen_troll special case.
    expect(MOBS.wild_boar.componentTags).toEqual(['hide', 'tusk', 'meat']);
    const boar = corpseLootAvailability(
      corpse({ templateId: 'wild_boar', loot: null, harvestClaimedBy: null }),
      1,
    );
    expect(boar.harvestable).toBe(true);
    expect(boar.canOpen).toBe(true);
  });

  it('refuses a corpse the viewing player claimed themselves', () => {
    // A claim means CONSUMED, for everyone including the claimer: the sim's
    // authority (resolveCorpseHarvest) denies any non-null claim, and the claim
    // is only ever written after a successful harvest. Re-offering the corpse
    // to its own claimer would advertise an action the server refuses; a future
    // "claimer may reopen" change must consciously flip this pin.
    const result = corpseLootAvailability(
      corpse({ templateId: 'forest_wolf', loot: null, harvestClaimedBy: 1 }),
      1,
    );

    expect(result.harvestable).toBe(false);
    expect(result.canOpen).toBe(false);
  });

  it('refuses a corpse claimed by another player', () => {
    const result = corpseLootAvailability(
      corpse({ templateId: 'forest_wolf', loot: null, harvestClaimedBy: 9 }),
      1,
    );

    expect(result.harvestable).toBe(false);
    expect(result.canOpen).toBe(false);
  });

  it('keeps a claimed corpse openable when the viewer still has personal loot in it', () => {
    const result = corpseLootAvailability(
      corpse({
        templateId: 'forest_wolf',
        loot: { copper: 0, items: [{ itemId: 'wolf_fang', count: 1, personalFor: [1] }] },
        harvestClaimedBy: 9,
      }),
      1,
    );

    expect(result.harvestable).toBe(false);
    expect(result.hasLoot).toBe(true);
    expect(result.canOpen).toBe(true);
  });

  it('does not infer harvest availability when the host cannot mirror claim state', () => {
    const result = corpseLootAvailability(
      corpse({ templateId: 'forest_wolf', loot: null, harvestClaimedBy: null }),
      1,
      false,
    );

    expect(result.harvestable).toBe(false);
    expect(result.canOpen).toBe(false);
  });
});

// Loot RIGHTS, not just loot existence: the arms mirror the sim's
// corpseLootRights + lootCorpse loop (src/sim/interaction.ts). ME = 1 views;
// STRANGER = 9 tapped. `harvestClaimedBy: 9` keeps the harvest arm closed so
// each case isolates the loot half; the harvest+loot split case is at the end.
describe('corpseLootAvailability loot rights matrix', () => {
  const ME = 1;
  const STRANGER = 9;
  const FRESH = 60; // owner-lock still counting
  const LAPSED = 0; // owner-lock lapsed: loot has gone FFA

  const tapped = (overrides: Partial<Entity>) =>
    corpse({ harvestClaimedBy: STRANGER, tappedById: STRANGER, lootFfaTimer: FRESH, ...overrides });
  const plainLoot = () => ({ copper: 0, items: [{ itemId: 'wolf_fang', count: 1 }] });

  it('my own tap opens', () => {
    const result = corpseLootAvailability(tapped({ tappedById: ME, loot: plainLoot() }), ME);
    expect(result.hasLoot).toBe(true);
    expect(result.canOpen).toBe(true);
    expect(result.visibleItems).toHaveLength(1);
  });

  it("the tapper being in my party opens (my roster stands in for the tapper's)", () => {
    const result = corpseLootAvailability(tapped({ loot: plainLoot() }), ME, true, [ME, STRANGER]);
    expect(result.hasLoot).toBe(true);
    expect(result.canOpen).toBe(true);
  });

  it('a fresh stranger tap is CLOSED: loot exists but I have no rights', () => {
    const result = corpseLootAvailability(tapped({ loot: plainLoot() }), ME);
    expect(result.hasLoot).toBe(false);
    expect(result.visibleItems).toEqual([]);
    expect(result.canOpen).toBe(false);
  });

  it('a stranger tap OPENS once the owner-lock lapses (FFA)', () => {
    const result = corpseLootAvailability(tapped({ lootFfaTimer: LAPSED, loot: plainLoot() }), ME);
    expect(result.hasLoot).toBe(true);
    expect(result.canOpen).toBe(true);
  });

  it('a personal slot naming me opens a fresh stranger tap (personal arm ignores the lock)', () => {
    const result = corpseLootAvailability(
      tapped({
        loot: { copper: 0, items: [{ itemId: 'wolf_fang', count: 1, personalFor: [ME] }] },
      }),
      ME,
    );
    expect(result.hasLoot).toBe(true);
    expect(result.canOpen).toBe(true);
    expect(result.visibleItems).toHaveLength(1);
  });

  it('an open-to-all slot opens a fresh stranger tap (passed-roll arm ignores the lock)', () => {
    const result = corpseLootAvailability(
      tapped({
        loot: { copper: 0, items: [{ itemId: 'wolf_fang', count: 1, openToAll: true }] },
      }),
      ME,
    );
    expect(result.hasLoot).toBe(true);
    expect(result.canOpen).toBe(true);
  });

  it('copper-only stranger corpse: closed fresh, open after the lapse, coin hidden while denied', () => {
    const fresh = corpseLootAvailability(tapped({ loot: { copper: 25, items: [] } }), ME);
    expect(fresh.hasLoot).toBe(false);
    expect(fresh.visibleCopper).toBe(0);
    expect(fresh.canOpen).toBe(false);

    const lapsed = corpseLootAvailability(
      tapped({ lootFfaTimer: LAPSED, loot: { copper: 25, items: [] } }),
      ME,
    );
    expect(lapsed.hasLoot).toBe(true);
    expect(lapsed.visibleCopper).toBe(25);
    expect(lapsed.canOpen).toBe(true);
  });

  it('harvestable stranger corpse with rights-less loot: harvest half open, loot half closed', () => {
    const result = corpseLootAvailability(
      tapped({ templateId: 'forest_wolf', harvestClaimedBy: null, loot: plainLoot() }),
      ME,
    );
    expect(result.harvestable).toBe(true);
    expect(result.hasLoot).toBe(false);
    expect(result.canOpen).toBe(true);
  });
});
