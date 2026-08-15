// Pure-core coverage for the gossip dialog's Crafting shortcut target
// (src/ui/hud/quest/master_craft_core.ts): which craft tab a station
// master's Crafting option opens. Master ids are the literal content ids
// (content/professions.ts STATIONS), never derived from the map under test.
import { describe, expect, it } from 'vitest';
import { STATIONS } from '../src/sim/data';
import { masterCraftTarget } from '../src/ui/hud/quest/master_craft_core';

const FORGE_MASTER = 'forgemistress_darva';
const KITCHENS_MASTER = 'cook_marlow';

describe('masterCraftTarget', () => {
  it('resolves a single-craft master to its one craft', () => {
    expect(masterCraftTarget(KITCHENS_MASTER, STATIONS, {})).toBe('cooking');
    expect(masterCraftTarget('alchemist_verane', STATIONS, {})).toBe('alchemy');
    expect(masterCraftTarget('tanner_hesk', STATIONS, {})).toBe('leatherworking');
  });

  it('a fresh viewer at the two-craft forge lands on weaponcrafting (declaration order)', () => {
    expect(masterCraftTarget(FORGE_MASTER, STATIONS, {})).toBe('weaponcrafting');
  });

  it('the forge prefers the viewer stronger craft, in both directions', () => {
    expect(
      masterCraftTarget(FORGE_MASTER, STATIONS, { weaponcrafting: 5, armorcrafting: 40 }),
    ).toBe('armorcrafting');
    expect(
      masterCraftTarget(FORGE_MASTER, STATIONS, { weaponcrafting: 40, armorcrafting: 5 }),
    ).toBe('weaponcrafting');
  });

  it('an exact skill tie falls back to declaration order', () => {
    expect(
      masterCraftTarget(FORGE_MASTER, STATIONS, { weaponcrafting: 25, armorcrafting: 25 }),
    ).toBe('weaponcrafting');
  });

  it('skill in a craft the station does not serve never steers the pick', () => {
    expect(masterCraftTarget(KITCHENS_MASTER, STATIONS, { alchemy: 300 })).toBe('cooking');
  });

  it('a non-master NPC and an empty station registry both resolve to null', () => {
    expect(masterCraftTarget('smith_haldren', STATIONS, {})).toBeNull();
    expect(masterCraftTarget(FORGE_MASTER, [], {})).toBeNull();
  });
});
