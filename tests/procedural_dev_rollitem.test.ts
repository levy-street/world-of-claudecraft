import { describe, expect, it } from 'vitest';
import { PROCEDURAL_ITEM_BASES } from '../src/sim/content/procedural_loot';
import type { ProceduralRarity } from '../src/sim/procedural_item';
import { sanitizeProceduralItemInstance } from '../src/sim/procedural_item_validation';
import { Sim } from '../src/sim/sim';

const BASE_IDS = Object.keys(PROCEDURAL_ITEM_BASES);
const RARITIES = [
  'common',
  'magic',
  'rare',
  'epic',
  'legendary',
] as const satisfies readonly Exclude<ProceduralRarity, 'mythic'>[];

function devSim(seed = 619): Sim {
  return new Sim({
    seed,
    playerClass: 'warrior',
    autoEquip: false,
    devCommands: true,
  });
}

function proceduralItems(sim: Sim) {
  return sim.inventory.flatMap((slot) =>
    slot.instance?.procedural ? [slot.instance.procedural] : [],
  );
}

describe('/dev rollitem', () => {
  it('grants the exact requested base, rarity, item level, and seed', () => {
    const sim = devSim();
    sim.chat('/dev rollitem iron_broadsword rare 24 123456');

    const [item] = proceduralItems(sim);
    expect(item).toBeDefined();
    expect(item.baseId).toBe('iron_broadsword');
    expect(item.rarity).toBe('rare');
    expect(item.itemLevel).toBe(24);
    expect(item.seed).toBe(123456);
    expect(item.dropContext).toMatchObject({
      source: 'dev',
      sourceEntityId: sim.playerId,
      recipientId: sim.playerId,
      sourceTemplateId: 'dev_rollitem',
      sourceTags: ['dev', 'rollitem'],
    });
    expect(sanitizeProceduralItemInstance(item, item.baseId)).toEqual({ ok: true, value: item });
  });

  it('checks 150 deterministic base, rarity, and seed grants', () => {
    let scenarios = 0;
    for (const baseId of BASE_IDS) {
      for (const rarity of RARITIES) {
        for (let seed = 1; seed <= 5; seed++) {
          const first = devSim(90210);
          const second = devSim(90210);
          const command = `/dev rollitem ${baseId} ${rarity} 20 ${seed}`;
          first.chat(command);
          second.chat(command);
          const [a] = proceduralItems(first);
          const [b] = proceduralItems(second);

          expect(a, `${baseId}:${rarity}:${seed}`).toBeDefined();
          expect(b).toEqual(a);
          expect(a.baseId).toBe(baseId);
          expect(a.rarity).toBe(rarity);
          expect(a.itemLevel).toBe(20);
          expect(a.seed).toBe(seed);
          expect(sanitizeProceduralItemInstance(a, baseId).ok).toBe(true);
          if (rarity === 'legendary') {
            expect(a.legendaryPowerId).toBeTruthy();
            expect(a.powerRevision).toBe(1);
            expect(a.legendaryRolls).toBeDefined();
            expect(a.generatedName.legendaryNameId).toBe(a.legendaryPowerId);
          } else {
            expect(a.legendaryPowerId).toBeUndefined();
            expect(a.legendaryRolls).toBeUndefined();
          }
          scenarios++;
        }
      }
    }
    expect(scenarios).toBe(150);
  });

  it('does not consume the authoritative simulation RNG', () => {
    const sim = devSim();
    let draws = 0;
    sim.rng.setObserver(() => draws++);

    sim.chat('/dev rollitem gravecaller_ring legendary 20 99');

    expect(proceduralItems(sim)).toHaveLength(1);
    expect(draws).toBe(0);
  });

  it('uses the UID lease position for deterministic omitted seeds and unique items', () => {
    const run = () => {
      const sim = devSim(777);
      sim.chat('/dev rollitem gravecaller_ring rare 20');
      sim.chat('/dev rollitem gravecaller_ring rare 20');
      return proceduralItems(sim);
    };
    const first = run();
    const second = run();

    expect(second).toEqual(first);
    expect(first).toHaveLength(2);
    expect(first[0].uid).not.toBe(first[1].uid);
    expect(first[0].seed).not.toBe(first[1].seed);
  });

  it.each([
    '/dev rollitem missing rare 20 1',
    '/dev rollitem iron_broadsword mythic 20 1',
    '/dev rollitem iron_broadsword rare 0 1',
    '/dev rollitem iron_broadsword rare 41 1',
    '/dev rollitem iron_broadsword rare 20 0',
    '/dev rollitem iron_broadsword rare 20 4294967296',
    '/dev rollitem',
  ])('rejects invalid input without burning a UID: %s', (invalidCommand) => {
    const withInvalid = devSim(31337);
    withInvalid.chat(invalidCommand);
    withInvalid.chat('/dev rollitem iron_broadsword common 20 1');

    const control = devSim(31337);
    control.chat('/dev rollitem iron_broadsword common 20 1');

    expect(proceduralItems(withInvalid)).toEqual(proceduralItems(control));
  });

  it('is inert when developer commands are disabled', () => {
    const sim = new Sim({
      seed: 619,
      playerClass: 'warrior',
      autoEquip: false,
      devCommands: false,
    });
    sim.chat('/dev rollitem iron_broadsword legendary 20 1');
    expect(proceduralItems(sim)).toEqual([]);
  });
});
