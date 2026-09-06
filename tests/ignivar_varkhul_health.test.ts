import { describe, expect, it } from 'vitest';

import {
  HEROIC_DUNGEON_TUNING,
  VARKHUL_HEROIC_ADD_HEALTH_RETUNE,
} from '../src/sim/content/dungeon_difficulty';
import { DUNGEON_MOBS } from '../src/sim/content/dungeons';
import { createMob } from '../src/sim/entity';
import {
  IGNIVAR_CINDER_ARTIFICER_ID,
  IGNIVAR_CRUCIBLE_WARDEN_ID,
  IGNIVAR_EMBER_SENTINEL_ID,
  IGNIVAR_MOLTEN_ASSEMBLY_ID,
  VARKHUL_BOSS_ID,
} from '../src/sim/ignivar_raid_ids';
import {
  applyDungeonMobTuning,
  mobTemplateForDungeonDifficulty,
} from '../src/sim/instances/difficulty';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { applyBroodBurn } from '../src/sim/mob/dragonkin_brood';
import { Sim } from '../src/sim/sim';
import { IGNIVAR_BOSS_ID } from '../src/sim/types';

function spawned(templateId: string, dungeonId: string, difficulty: 'normal' | 'heroic') {
  const base = DUNGEON_MOBS[templateId];
  const template = mobTemplateForDungeonDifficulty(base, dungeonId, difficulty);
  return createMob(1, template, template.maxLevel, { x: 0, y: 0, z: 0 });
}

describe('Ignivar and Varkhul raid health bands', () => {
  it('puts both Normal bosses at 120k and gives Heroic a real progression wall', () => {
    expect(DUNGEON_MOBS[IGNIVAR_BOSS_ID].hpBase).toBe(120_000 / 2.3);
    expect(DUNGEON_MOBS[VARKHUL_BOSS_ID].hpBase).toBe(120_000 / 2.3);
    expect(HEROIC_DUNGEON_TUNING.ignivar_raid_arena.healthMultiplier).toBe(1.75);
    expect(HEROIC_DUNGEON_TUNING.ignivar_inner_crucible.healthMultiplier).toBe(5 / 3);
    expect(spawned(IGNIVAR_BOSS_ID, 'ignivar_raid_arena', 'normal').maxHp).toBe(120_000);
    expect(spawned(IGNIVAR_BOSS_ID, 'ignivar_raid_arena', 'heroic').maxHp).toBe(210_000);
    expect(spawned(VARKHUL_BOSS_ID, 'ignivar_inner_crucible', 'normal').maxHp).toBe(120_000);
    expect(spawned(VARKHUL_BOSS_ID, 'ignivar_inner_crucible', 'heroic').maxHp).toBe(200_000);
  });

  it('scales Heroic automata after compensating for their level 20 to 22 jump', () => {
    // The Heroic pools are the per-role progression (+20% / +25% / +30% over
    // the level-22 transform, elite x2.3 included) times the 2026-09 adds-phase
    // retune. At 1x they were 3,312 / 4,011 / 6,488 and no live raid finished
    // the Master's Assembly; 0.7x is the "very difficult, not impossible" line.
    expect(VARKHUL_HEROIC_ADD_HEALTH_RETUNE).toBe(0.7);
    const rows = [
      [IGNIVAR_EMBER_SENTINEL_ID, 2_760, 2_318],
      [IGNIVAR_CRUCIBLE_WARDEN_ID, 3_208, 2_807],
      [IGNIVAR_CINDER_ARTIFICER_ID, 4_991, 4_542],
    ] as const;
    for (const [templateId, normalHp, heroicHp] of rows) {
      expect(spawned(templateId, 'ignivar_inner_crucible', 'normal').maxHp).toBe(normalHp);
      expect(spawned(templateId, 'ignivar_inner_crucible', 'heroic').maxHp).toBe(heroicHp);
    }
    // The whole intermission (16 Sentinels, 4 Wardens, 3 Artificers) must stay
    // a harder throughput check than Normal's 12 + 3 inside its 60 s cap.
    const heroicPool = 16 * 2_318 + 4 * 2_807 + 3 * 4_542;
    const normalPool = 9 * 2_760 + 3 * 3_208 + 3 * 4_991;
    expect(heroicPool / 70).toBeGreaterThan(normalPool / 60);
  });

  it('raises Heroic tank and add melee without multiplying support damage wildly', () => {
    const normalBoss = spawned(VARKHUL_BOSS_ID, 'ignivar_inner_crucible', 'normal');
    const heroicBoss = spawned(VARKHUL_BOSS_ID, 'ignivar_inner_crucible', 'heroic');
    const normalSentinel = spawned(IGNIVAR_EMBER_SENTINEL_ID, 'ignivar_inner_crucible', 'normal');
    const heroicSentinel = spawned(IGNIVAR_EMBER_SENTINEL_ID, 'ignivar_inner_crucible', 'heroic');
    const normalWarden = spawned(IGNIVAR_CRUCIBLE_WARDEN_ID, 'ignivar_inner_crucible', 'normal');
    const heroicWarden = spawned(IGNIVAR_CRUCIBLE_WARDEN_ID, 'ignivar_inner_crucible', 'heroic');
    expect(heroicBoss.weapon).toEqual({ min: 407, max: 637, speed: 2.6 });
    expect(normalBoss.weapon).toEqual({ min: 302, max: 472, speed: 2.6 });
    expect(heroicSentinel.weapon).toEqual({ min: 153, max: 239, speed: 2.4 });
    expect(normalSentinel.weapon).toEqual({ min: 122, max: 191, speed: 2.4 });
    expect(heroicWarden.weapon).toEqual({ min: 138, max: 216, speed: 2.8 });
    expect(normalWarden.weapon).toEqual({ min: 111, max: 173, speed: 2.8 });
  });

  it('raises the Heroic Sentinel sweep and burn by twenty-five percent', () => {
    const normal = spawned(IGNIVAR_EMBER_SENTINEL_ID, 'ignivar_inner_crucible', 'normal');
    const heroic = spawned(IGNIVAR_EMBER_SENTINEL_ID, 'ignivar_inner_crucible', 'heroic');
    applyDungeonMobTuning(normal, 'ignivar_inner_crucible', 'normal');
    applyDungeonMobTuning(heroic, 'ignivar_inner_crucible', 'heroic');
    expect(normal.mechanicDamageMult).toBeUndefined();
    expect(heroic.mechanicDamageMult).toBe(1.25);
    const burn = DUNGEON_MOBS[IGNIVAR_EMBER_SENTINEL_ID].arcCleave?.burn;
    if (!burn) throw new Error('Ember Sentinel burn missing');
    const normalSim = new Sim({ seed: 801, playerClass: 'warrior' });
    const heroicSim = new Sim({ seed: 802, playerClass: 'warrior' });

    applyBroodBurn(normalSim.ctx, normal, normalSim.player, burn);
    applyBroodBurn(heroicSim.ctx, heroic, heroicSim.player, burn);

    expect(normalSim.player.auras.find((aura) => aura.name === burn.name)?.value).toBe(7);
    expect(heroicSim.player.auras.find((aura) => aura.name === burn.name)?.value).toBe(9);
  });

  it('keeps the placement multiplier on top of Molten Assembly Heroic Warden tuning', () => {
    const sim = new Sim({ seed: 804, playerClass: 'warrior', devCommands: true });
    sim.setDungeonDifficulty('heroic');
    expect(enterDungeon(sim.ctx, IGNIVAR_MOLTEN_ASSEMBLY_ID, sim.player.id, true)).toBe(true);
    const claim = sim.instances.find(
      (instance) => instance.dungeonId === IGNIVAR_MOLTEN_ASSEMBLY_ID && instance.partyKey !== null,
    );
    if (!claim) throw new Error('Heroic Molten Assembly claim did not form');
    const mobs = claim.mobIds.flatMap((id) => {
      const mob = sim.entities.get(id);
      return mob ? [mob] : [];
    });
    const minibosses = mobs.filter((mob) => mob.dungeonSpawnMiniboss);
    expect(minibosses).toHaveLength(2);
    expect(minibosses.every((mob) => mob.level === 22 && mob.maxHp === 16_269)).toBe(true);
    expect(
      mobs
        .filter((mob) => mob.templateId === IGNIVAR_EMBER_SENTINEL_ID)
        .every((mob) => mob.level === 22 && mob.maxHp === 5_980),
    ).toBe(true);
  });
});
