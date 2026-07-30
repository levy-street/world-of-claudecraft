import { describe, expect, it } from 'vitest';
import { updatePlayerAutoAttack } from '../src/sim/combat/auto_attack';
import { Sim } from '../src/sim/sim';
import {
  dist2d,
  MAX_LEVEL,
  STANCE_MASTERY_BATTLE_CRIT_DMG,
  STANCE_MASTERY_BERSERKER_HASTE,
  STANCE_MASTERY_GUARDED_CUT,
  STANCE_MASTERY_GUARDED_HP_PCT,
} from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

function warriorAtCap(seed = 2601): Sim {
  const sim = new Sim({ seed, playerClass: 'warrior' });
  sim.setPlayerLevel(MAX_LEVEL);
  return sim;
}

function nearestMob(sim: Sim) {
  return [...sim.entities.values()]
    .filter((entity) => entity.kind === 'mob' && !entity.dead)
    .sort((a, b) => dist2d(a.pos, sim.player.pos) - dist2d(b.pos, sim.player.pos))[0]!;
}

function standOff(sim: Sim, mob: ReturnType<typeof nearestMob>, distance: number): void {
  const player = sim.player;
  player.pos.x = mob.pos.x - distance;
  player.pos.z = mob.pos.z;
  player.pos.y = terrainHeight(player.pos.x, player.pos.z, sim.cfg.seed);
  player.prevPos = { ...player.pos };
  player.facing = Math.atan2(mob.pos.x - player.pos.x, mob.pos.z - player.pos.z);
}

function selectCombatMastery(sim: Sim): void {
  expect(sim.selectTalentRow(14, 'war_row_blood_offering')).toBe(true);
}

describe('v0.26 Combat Mastery', () => {
  it('amplifies named ability criticals in Battle Stance, but not autos or non-crits', () => {
    const sim = warriorAtCap();
    expect(sim.setSpec('arms')).toBe(true);
    selectCombatMastery(sim);
    const player = sim.player;
    const mob = nearestMob(sim);
    mob.hp = 1_000_000;
    mob.maxHp = 1_000_000;

    const hit = (crit: boolean, ability: string | null) => {
      const hpBefore = mob.hp;
      sim.dealDamage(player, mob, 1_000, crit, 'physical', ability, 'hit');
      return hpBefore - mob.hp;
    };

    expect(hit(true, 'Maiming Strike')).toBe(
      Math.round(1_000 * (1 + STANCE_MASTERY_BATTLE_CRIT_DMG)),
    );
    expect(hit(true, null)).toBe(1_000);
    expect(hit(false, 'Maiming Strike')).toBe(1_000);
  });

  it('is inert in Battle Stance without the selected row', () => {
    const sim = warriorAtCap();
    expect(sim.setSpec('arms')).toBe(true);
    const player = sim.player;
    const mob = nearestMob(sim);
    mob.hp = 1_000_000;
    mob.maxHp = 1_000_000;
    const hpBefore = mob.hp;
    sim.dealDamage(player, mob, 1_000, true, 'physical', 'Maiming Strike', 'hit');
    expect(hpBefore - mob.hp).toBe(1_000);
  });

  it('rearms only auto-attack timers five percent faster in Berserker Stance', () => {
    const timer = (withMastery: boolean) => {
      const sim = warriorAtCap();
      expect(sim.setSpec('fury')).toBe(true);
      if (withMastery) selectCombatMastery(sim);
      sim.tick();
      const player = sim.player;
      const mob = nearestMob(sim);
      mob.hp = 1_000_000;
      mob.maxHp = 1_000_000;
      standOff(sim, mob, 2);
      sim.targetEntity(mob.id);
      player.autoAttack = true;
      player.swingTimer = 0;
      updatePlayerAutoAttack(
        (sim as unknown as { ctx: never }).ctx,
        player,
        (sim as any).players.get(player.id),
      );
      return player.swingTimer;
    };

    expect(timer(true) * (1 + STANCE_MASTERY_BERSERKER_HASTE)).toBeCloseTo(timer(false), 5);
  });

  it('cuts a post-mitigation heavy hit in Guarded Stance before absorbs', () => {
    const sim = warriorAtCap();
    expect(sim.setSpec('prot')).toBe(true);
    selectCombatMastery(sim);
    sim.castAbility('defensive_stance');
    const player = sim.player;
    const mob = nearestMob(sim);

    const hit = (raw: number) => {
      player.hp = player.maxHp;
      const hpBefore = player.hp;
      sim.dealDamage(mob, player, raw, false, 'physical', null, 'hit');
      return hpBefore - player.hp;
    };
    const heavy = Math.ceil(player.maxHp * 0.3);
    const light = Math.ceil(player.maxHp * 0.1);
    expect(hit(heavy)).toBe(Math.round(Math.round(heavy * 0.9) * (1 - STANCE_MASTERY_GUARDED_CUT)));
    expect(hit(light)).toBe(Math.round(light * 0.9));
  });

  it('evaluates the Guarded threshold before applying the mastery cut', () => {
    const sim = warriorAtCap();
    expect(sim.setSpec('prot')).toBe(true);
    selectCombatMastery(sim);
    sim.castAbility('defensive_stance');
    const player = sim.player;
    const mob = nearestMob(sim);
    player.hp = player.maxHp;
    const raw = Math.ceil((player.maxHp * STANCE_MASTERY_GUARDED_HP_PCT) / 0.9) + 2;
    const hpBefore = player.hp;
    sim.dealDamage(mob, player, raw, false, 'physical', null, 'hit');
    const landed = hpBefore - player.hp;
    expect(landed).toBe(Math.round(Math.round(raw * 0.9) * (1 - STANCE_MASTERY_GUARDED_CUT)));
    expect(landed).toBeLessThan(player.maxHp * STANCE_MASTERY_GUARDED_HP_PCT);
  });
});
