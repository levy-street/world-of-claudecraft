import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { generateProceduralItem } from '../src/sim/loot/procedural';
import { proceduralItemContentName } from '../src/sim/procedural_item_name';
import { Sim } from '../src/sim/sim';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

// The self-only readout reuses the 'error' channel, like /who and the other
// readout commands; grab the most recent one addressed to the player.
function lastReadout(sim: Sim, pid: number): string | undefined {
  const errs = sim.events.filter(
    (e): e is Extract<typeof e, { type: 'error' }> => e.type === 'error' && e.pid === pid,
  );
  return errs.length ? errs[errs.length - 1].text : undefined;
}

describe('/bags command', () => {
  it('reports empty bags with the purse', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Aleph');
    sim.players.get(pid)!.copper = 0;
    sim.players.get(pid)!.inventory.length = 0; // shed the starter rations

    expect(sim.chat('/bags', pid)).toBeNull();
    expect(lastReadout(sim, pid)).toBe('Your bags are empty. Purse: 0c.');
  });

  it('lists items sorted by quality with stack counts and the purse', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Aleph');
    sim.players.get(pid)!.copper = 12 * 10000 + 4 * 100 + 5; // 12g 4s 5c
    sim.players.get(pid)!.inventory.length = 0; // shed the starter rations

    // Added out of quality order to prove the readout sorts them. wolf_fang
    // is a crafting reagent (common), so the gray exemplar here is
    // mudfin_scale.
    sim.addItem('mudfin_scale', 5, pid); // poor
    sim.addItem('fen_reaver_glaive', 1, pid); // rare
    sim.addItem('minor_healing_potion', 3, pid); // common
    sim.addItem('redbrook_blade', 1, pid); // uncommon

    sim.chat('/bags', pid);
    expect(lastReadout(sim, pid)).toBe(
      'Bags (4): Fen Reaver Glaive, Redbrook Militia Blade, ' +
        'Minor Healing Potion x3, Slimy Mudfin Scale x5. Purse: 12g 4s 5c.',
    );
  });

  it('sorts a generated legendary by its real rarity and shows its generated name', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Aleph');
    const meta = sim.players.get(pid)!;
    meta.inventory.length = 0;
    sim.addItem('minor_healing_potion', 1, pid);
    const drop = generateProceduralItem({
      seed: 7711,
      uid: 'pi1:bags-command:7711',
      context: {
        source: 'dungeon',
        sourceEntityId: 77,
        sourceSpawnSequence: 11,
        lootSlotIndex: 0,
      },
      basePoolId: 'initial_dungeon_boss',
      rarityTableId: 'initial_dungeon_boss',
      sourceItemLevel: 20,
      forcedBaseId: 'iron_broadsword',
      forcedRarity: 'legendary',
    });
    sim.addItemInstance(drop.itemId, drop.instance, pid);

    sim.chat('/bags', pid);
    const generatedName = proceduralItemContentName(ITEMS[drop.itemId], drop.instance);
    expect(lastReadout(sim, pid)).toBe(
      `Bags (2): ${generatedName}, Minor Healing Potion. Purse: 0c.`,
    );
  });
  it('works through the /inv and /inventory aliases', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Aleph');
    sim.players.get(pid)!.copper = 0;
    sim.players.get(pid)!.inventory.length = 0; // shed the starter rations

    expect(sim.chat('/inv', pid)).toBeNull();
    expect(lastReadout(sim, pid)).toBe('Your bags are empty. Purse: 0c.');
    expect(sim.chat('/inventory', pid)).toBeNull();
    expect(lastReadout(sim, pid)).toBe('Your bags are empty. Purse: 0c.');
  });
});
