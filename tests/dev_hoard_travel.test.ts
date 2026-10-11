import { describe, expect, it } from 'vitest';
import { CAVE_THEMES } from '../src/sim/content/rift/cave_themes';
import { RIFT_THEMES } from '../src/sim/content/rift/themes';
import { DEV_HOARD_DESTINATIONS, devHoardDestination } from '../src/sim/dev/hoard_travel';
import { generateRiftFloor } from '../src/sim/rift/rift_gen';
import { vaultSeedOpen, vaultSeedTier, vaultSeedZone } from '../src/sim/rift/vault_seed';
import { Sim } from '../src/sim/sim';
import { EMPTY_TEST_WORLD } from './sim_shared';

function makeSim(devCommands = true) {
  return new Sim({ seed: 42, playerClass: 'warrior', devCommands, world: EMPTY_TEST_WORLD });
}

describe('direct legendary hoard travel', () => {
  it('resolves every boss and biome deterministically through the real generator', () => {
    const themes = [...RIFT_THEMES, ...CAVE_THEMES];
    for (const [i, d] of DEV_HOARD_DESTINATIONS.entries()) {
      const cave = 'cave' in d && d.cave;
      const result = devHoardDestination(d.boss)!;
      expect(devHoardDestination(String(i + 1))).toEqual(result);
      expect(devHoardDestination(d.alias)).toEqual(result);
      // A zone two destinations share resolves to the first of them.
      const first = DEV_HOARD_DESTINATIONS.find((other) => other.zone === d.zone)!;
      if (first === d) expect(devHoardDestination(d.zone)).toEqual(result);
      // A themed boss opens its legendary valley; a cave boss its rare cave.
      expect(vaultSeedTier(result.seed)).toBe(cave ? 1 : 3);
      expect(vaultSeedOpen(result.seed)).toBe(!cave);
      expect(vaultSeedZone(result.seed)).toBe(d.zone);
      expect(generateRiftFloor(result.seed, 23, 0).spawns.find((s) => s.boss)?.templateId).toBe(
        themes.find((theme) => theme.id === d.theme)!.boss,
      );
    }
    expect(devHoardDestination('unknown')).toBeNull();
  });

  it('keeps each boss to the maps that hold it: themed bosses epic up, cave bosses below', () => {
    const levels = { common: 20, rare: 22, epic: 25, legendary: 28 } as const;
    const sizes = { common: 0, rare: 1, epic: 2, legendary: 3 } as const;
    for (const rarity of ['epic', 'legendary'] as const) {
      const at = devHoardDestination('grask', rarity)!;
      expect(vaultSeedTier(at.seed)).toBe(sizes[rarity]);
      expect(at.rarity).toBe(rarity);
      expect(
        generateRiftFloor(at.seed, levels[rarity], 0).spawns.find((sp) => sp.boss)?.templateId,
      ).toBe('rift_boss_brute');
      expect(devHoardDestination('mushroom', rarity)).toBeNull();
    }
    for (const rarity of ['common', 'rare'] as const) {
      const at = devHoardDestination('mushroom', rarity)!;
      expect(vaultSeedTier(at.seed)).toBe(sizes[rarity]);
      expect(
        generateRiftFloor(at.seed, levels[rarity], 0).spawns.find((sp) => sp.boss)?.templateId,
      ).toBe('hoard_boss_mushroom');
      expect(devHoardDestination('grask', rarity)).toBeNull();
    }
    const sim = makeSim();
    sim.chat('/dev hoard grask epic');
    const room = sim.riftInstances.find((i) => i.partyKey !== null)!;
    expect(room.vault?.rarity).toBe('epic');
    expect(sim.entities.get(room.bossId!)?.templateId).toBe('rift_boss_brute');
    // A rarity that is not one refuses rather than silently opening a legendary,
    // and so does a boss asked for on maps that never hold it.
    sim.chat('/dev hoard grask nonsense');
    sim.chat('/dev hoard grask common');
    expect(sim.riftInstances.find((i) => i.partyKey !== null)).toBe(room);
  });

  it('enters real legendary instances and switches bosses without spending a map', () => {
    const sim = makeSim();
    sim.chat('/dev hoard frost');
    const first = sim.riftInstances.find((i) => i.partyKey !== null)!;
    expect(first.vault?.rarity).toBe('legendary');
    expect(sim.entities.get(first.bossId!)?.templateId).toBe('rift_boss_frost');
    expect(sim.player.level).toBe(20);
    sim.chat('/dev hoard tide');
    const second = sim.riftInstances.find((i) => i.seed === devHoardDestination('tide')!.seed)!;
    expect(sim.entities.get(second.bossId!)?.templateId).toBe('rift_boss_tide');
    expect(second.vault?.ownerPid).toBe(sim.player.id);
    expect([...sim.entities.values()].filter((e) => e.vaultOwnerPid !== undefined)).toHaveLength(0);
    sim.leaveRift();
    expect(sim.player.pos.x).toBe(second.returnPos.x);
    expect(sim.player.pos.z).toBe(second.returnPos.z);
  });

  it('listing and invalid destinations leave the world unchanged', () => {
    const sim = makeSim();
    const before = { ...sim.player.pos };
    sim.chat('/dev hoard list');
    sim.chat('/dev hoard invalid');
    expect(sim.player.pos).toEqual(before);
    expect(sim.riftInstances.every((i) => i.partyKey === null)).toBe(true);
  });

  it('retains the production dev gate', () => {
    const sim = makeSim(false);
    sim.chat('/dev hoard tide');
    expect(sim.player.level).toBe(1);
    expect(sim.riftInstances.every((i) => i.partyKey === null)).toBe(true);
  });

  it('does not allocate instances or teleport a dead player', () => {
    const sim = makeSim();
    sim.player.dead = true;
    const before = { ...sim.player.pos };
    sim.chat('/dev hoard frost');
    expect(sim.player.pos).toEqual(before);
    expect(sim.riftInstances.every((i) => i.partyKey === null)).toBe(true);
  });
});
