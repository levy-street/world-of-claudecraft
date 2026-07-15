// Boss-summoned add spawning (Sim.spawnBossAdds): adds anchor where they
// ERUPT, aggro the boss's victim with a seeded leash anchor, and (on heroic)
// swing at the tuning table's softer addDamageMultiplier instead of the
// dungeon-wide damageMultiplier.
//
// Regression: adds used to inherit the BOSS's original spawnPos as their leash
// home, so a boss kited past the leash radius hatched adds that were instantly
// past their own leash: the first engaged tick flipped them to evade with a
// wiped hate table and they never swung at anyone (reported on Grand
// Necromancer Velkhar, Korzul's sanctum, and Thunzharr's stormlings).

import { describe, expect, it } from 'vitest';
import { HEROIC_DUNGEON_TUNING } from '../src/sim/content/dungeon_difficulty';
import { MOBS } from '../src/sim/data';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

function makeSim(seed = 99): AnySim {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true }) as AnySim;
}

function teleport(sim: AnySim, e: AnyEntity, x: number, z: number): void {
  e.pos = { x, y: e.pos.y, z };
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

function claimedSanctum(sim: AnySim, difficulty: string): any {
  return (sim.instances as any[]).find(
    (i) =>
      i.dungeonId === 'gravewyrm_sanctum' && i.difficulty === difficulty && i.partyKey !== null,
  );
}

function velkharIn(sim: AnySim, inst: any): AnyEntity {
  const boss = inst.mobIds
    .map((id: number) => sim.entities.get(id))
    .find((e: AnyEntity | undefined) => e?.templateId === 'grand_necromancer_velkhar');
  if (!boss) throw new Error('missing Velkhar in the sanctum');
  return boss as AnyEntity;
}

function bonewalkerAdds(sim: AnySim): AnyEntity[] {
  return [...sim.entities.values()].filter(
    (e: AnyEntity) => e.templateId === 'raised_bonewalker' && !e.dead,
  ) as AnyEntity[];
}

// Engage Velkhar with the player standing next to him, then drop him below the
// first summon threshold (0.66) and tick once so updateBossMechanics fires the
// wave. dealDamage seeds threat/aggro and refreshes the boss's own leashAnchor
// to his current (possibly kited) position, exactly like a live hit.
function fireFirstWave(sim: AnySim, boss: AnyEntity, pid: number): AnyEntity[] {
  const p = sim.entities.get(pid) as AnyEntity;
  teleport(sim, p, boss.pos.x + 6, boss.pos.z);
  p.maxHp = p.hp = 1_000_000;
  sim.dealDamage(p, boss, 10, false, 'physical', 'Chip', 'hit', true);
  boss.hp = Math.floor(boss.maxHp * 0.6);
  sim.tick();
  return bonewalkerAdds(sim);
}

describe('boss adds anchor where they erupt', () => {
  it('adds hatched from a KITED boss engage instead of leashing home instantly', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Kiter');
    enterDungeon(sim.ctx, 'gravewyrm_sanctum', pid);
    const inst = claimedSanctum(sim, 'normal');
    const boss = velkharIn(sim, inst);

    // Kite Velkhar from his dais (z 114) to the sanctum entrance, ~94yd from
    // his spawn: past even the dungeon leash radius (70).
    const kited = { x: boss.spawnPos.x, z: boss.spawnPos.z - 94 };
    teleport(sim, boss, kited.x, kited.z);
    const adds = fireFirstWave(sim, boss, pid);
    expect(adds).toHaveLength(3);

    for (const add of adds) {
      // Anchored beside the kited boss, NOT at his original spawn on the dais.
      expect(Math.hypot(add.spawnPos.x - kited.x, add.spawnPos.z - kited.z)).toBeLessThan(5);
      expect(add.leashAnchor).not.toBeNull();
    }
    // They stay on the fight: still engaged on the player with live threat
    // after a second of ticks (the old bug evaded them all on the first one).
    for (let t = 0; t < 20; t++) sim.tick();
    for (const add of bonewalkerAdds(sim)) {
      expect(add.aiState === 'chase' || add.aiState === 'attack').toBe(true);
      expect(add.aggroTargetId).toBe(pid);
      expect(add.threat.size).toBeGreaterThan(0);
    }
  });

  it('adds hatched at the boss home behave as before: engaged on the victim', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Tank');
    enterDungeon(sim.ctx, 'gravewyrm_sanctum', pid);
    const boss = velkharIn(sim, claimedSanctum(sim, 'normal'));
    const adds = fireFirstWave(sim, boss, pid);
    expect(adds).toHaveLength(3);
    for (const add of adds) {
      expect(add.aggroTargetId).toBe(pid);
      expect(add.inCombat).toBe(true);
      expect(add.aiState === 'chase' || add.aiState === 'attack').toBe(true);
    }
  });
});

describe('heroic boss adds swing at addDamageMultiplier', () => {
  it("Velkhar's heroic bonewalkers use the softer add multiplier, the boss the full one", () => {
    const sim = makeSim(123);
    const pid = sim.addPlayer('warrior', 'Hero');
    sim.setDungeonDifficulty('heroic', pid);
    enterDungeon(sim.ctx, 'gravewyrm_sanctum', pid);
    const boss = velkharIn(sim, claimedSanctum(sim, 'heroic'));
    const adds = fireFirstWave(sim, boss, pid);
    expect(adds).toHaveLength(3);

    // Recompute the expected weapon from the RAW template and the tuning
    // record, mirroring createMob's formulas (bonewalkers are not elite).
    const tuning = HEROIC_DUNGEON_TUNING.gravewyrm_sanctum;
    const tmpl = MOBS.raised_bonewalker;
    const addDmg =
      tmpl.dmgBase * tuning.addDamageMultiplier +
      tmpl.dmgPerLevel * tuning.addDamageMultiplier * (tuning.level - 1);
    for (const add of adds) {
      expect(add.level).toBe(tuning.level);
      expect(add.weapon.min).toBe(Math.round(addDmg * 0.8));
      expect(add.weapon.max).toBe(Math.round(addDmg * 1.25));
      // Fire-time mechanic scaling rides the add multiplier too.
      expect(add.mechanicDamageMult).toBe(tuning.addDamageMultiplier);
    }
    // The summoner himself keeps the dungeon-wide multiplier.
    expect(boss.mechanicDamageMult).toBe(tuning.damageMultiplier);
    expect(tuning.addDamageMultiplier).toBeLessThan(tuning.damageMultiplier);
  });

  it('normal-difficulty adds are untouched by the heroic add multiplier', () => {
    const sim = makeSim(321);
    const pid = sim.addPlayer('warrior', 'Normie');
    enterDungeon(sim.ctx, 'gravewyrm_sanctum', pid);
    const boss = velkharIn(sim, claimedSanctum(sim, 'normal'));
    const adds = fireFirstWave(sim, boss, pid);
    expect(adds).toHaveLength(3);
    for (const add of adds) {
      expect(add.level).toBe(MOBS.raised_bonewalker.minLevel);
      expect(add.mechanicDamageMult).toBeUndefined();
    }
  });
});
