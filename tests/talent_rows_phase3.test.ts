// Phase 3 of the choice-row warrior talents: every newly-lit option end to end
// in a real Sim. One describe per talent; helpers follow the sim-test idiom.

import { describe, expect, it } from 'vitest';
import { updateRegen } from '../src/sim/combat/auras';
import { updatePlayerAutoAttack } from '../src/sim/combat/auto_attack';
import { MOBS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import {
  dist2d,
  MAX_LEVEL,
  MELEE_CLASSES,
  RECKLESSNESS_RAGE_GEN,
  SECOND_WIND_THRESHOLD,
  STANCE_MASTERY_BATTLE_CRIT_DMG,
  STANCE_MASTERY_BERSERKER_HASTE,
  STANCE_MASTERY_GUARDED_CUT,
  STANCE_MASTERY_GUARDED_HP_PCT,
  STANCE_RAGE_GEN,
} from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

function warriorAtCap(seed = 7): Sim {
  const sim = new Sim({ seed, playerClass: 'warrior' });
  sim.setPlayerLevel(MAX_LEVEL);
  return sim;
}

function mobsNear(sim: Sim, n: number) {
  const out: any[] = [];
  const sorted = [...sim.entities.values()]
    .filter((e) => e.kind === 'mob' && !e.dead)
    .sort((a, b) => dist2d(a.pos, sim.player.pos) - dist2d(b.pos, sim.player.pos));
  for (let i = 0; i < n; i++) out.push(sorted[i]);
  return out;
}

function standOff(sim: Sim, mob: any, dist: number) {
  const p = sim.player;
  p.pos.x = mob.pos.x - dist;
  p.pos.z = mob.pos.z;
  p.pos.y = terrainHeight(p.pos.x, p.pos.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
}

function metaOf(sim: Sim) {
  return (sim as any).players.get(sim.player.id);
}

function killMob(sim: Sim, mob: any) {
  mob.hp = 1;
  (sim as any).dealDamage(sim.player, mob, 5, false, 'physical', null, 'hit', true);
  expect(mob.dead).toBe(true);
}

describe('Storm Bolt', () => {
  it('is granted by the pick and lands damage plus a stun', () => {
    const sim = warriorAtCap(41);
    expect(sim.pickRowTalent(2, 'war_row_storm_bolt')).toBe(true);
    expect(metaOf(sim).known.some((k: any) => k.def.id === 'storm_bolt')).toBe(true);
    const mob = mobsNear(sim, 1)[0];
    standOff(sim, mob, 15);
    sim.targetEntity(mob.id);
    sim.player.resource = 50;
    const hp0 = mob.hp;
    sim.castAbility('storm_bolt');
    for (let i = 0; i < 40 && !mob.auras.some((a: any) => a.kind === 'stun'); i++) sim.tick();
    expect(mob.auras.some((a: any) => a.kind === 'stun')).toBe(true);
    expect(mob.hp).toBeLessThan(hp0);
  });
});

describe('Combat Mastery (the reworked Blood Offering row pick)', () => {
  // Reworked twice (owner): Blood Toll empower -> Hardened Blood -> Combat
  // Mastery (2026-07-11): each stance gains an extra effect while the row pick
  // (same id, saved picks survive) is worn. One test per stance arm, plus the
  // no-pick negatives and the pre-cut threshold semantics of the Guarded arm.

  it('Battle Stance: ability criticals deal 15% more, plain auto crits never do', () => {
    const sim = warriorAtCap(42);
    expect(sim.setSpec('arms')).toBe(true);
    expect(sim.pickRowTalent(3, 'war_row_blood_offering')).toBe(true);
    const p = sim.player;
    expect(p.auras.some((a: any) => a.kind === 'battle_stance')).toBe(true);
    const mob = mobsNear(sim, 1)[0];
    mob.hp = 1_000_000;
    mob.maxHp = 1_000_000;
    const hit = (crit: boolean, ability: string | null) => {
      const hp0 = mob.hp;
      (sim as any).dealDamage(p, mob, 1000, crit, 'physical', ability, 'hit');
      return hp0 - mob.hp;
    };
    // The named-ability crit is amplified; a plain auto (null ability) crit and
    // a non-crit ability hit land untouched.
    expect(hit(true, 'Maiming Strike')).toBe(
      Math.round(1000 * (1 + STANCE_MASTERY_BATTLE_CRIT_DMG)),
    );
    expect(hit(true, null)).toBe(1000);
    expect(hit(false, 'Maiming Strike')).toBe(1000);
  });

  it('Battle Stance arm is inert without the pick', () => {
    const sim = warriorAtCap(42);
    expect(sim.setSpec('arms')).toBe(true);
    const p = sim.player;
    expect(p.auras.some((a: any) => a.kind === 'battle_stance')).toBe(true);
    const mob = mobsNear(sim, 1)[0];
    mob.hp = 1_000_000;
    mob.maxHp = 1_000_000;
    const hp0 = mob.hp;
    (sim as any).dealDamage(p, mob, 1000, true, 'physical', 'Maiming Strike', 'hit');
    expect(hp0 - mob.hp).toBe(1000);
  });

  it('Berserker Stance: auto-attack swing timers rearm 5% faster with the pick', () => {
    const timers = (pick: boolean) => {
      const sim = warriorAtCap(42);
      expect(sim.setSpec('fury')).toBe(true);
      if (pick) expect(sim.pickRowTalent(3, 'war_row_blood_offering')).toBe(true);
      sim.tick(); // the per-tick stance reconcile swaps Battle out for Berserker
      const p = sim.player;
      expect(p.auras.some((a: any) => a.kind === 'berserker_stance')).toBe(true);
      const mob = mobsNear(sim, 1)[0];
      mob.hp = 1_000_000;
      mob.maxHp = 1_000_000;
      standOff(sim, mob, 2);
      sim.targetEntity(mob.id);
      p.autoAttack = true;
      p.swingTimer = 0;
      updatePlayerAutoAttack((sim as any).ctx, p, metaOf(sim));
      expect(p.swingTimer).toBeGreaterThan(0);
      return p.swingTimer;
    };
    const withPick = timers(true);
    const withoutPick = timers(false);
    // Same seed and steps on both sims: the only difference is the pick, so the
    // rearm interval divides by exactly (1 + the Berserker haste).
    expect(withPick * (1 + STANCE_MASTERY_BERSERKER_HASTE)).toBeCloseTo(withoutPick, 5);
  });

  it('Guarded Stance: a heavy blow is blunted 15%, a light one never is', () => {
    const sim = warriorAtCap(42);
    expect(sim.setSpec('prot')).toBe(true);
    expect(sim.pickRowTalent(3, 'war_row_blood_offering')).toBe(true);
    const p = sim.player;
    sim.castAbility('defensive_stance');
    expect(p.auras.some((a: any) => a.kind === 'defensive_stance')).toBe(true);
    const mob = mobsNear(sim, 1)[0];
    const hit = (raw: number) => {
      p.hp = p.maxHp;
      const hp0 = p.hp;
      (sim as any).dealDamage(mob, p, raw, false, 'physical', null, 'hit');
      return hp0 - p.hp;
    };
    // Guarded Stance itself always cuts 10% first; the mastery blunts only the
    // hit that would still take >= 20% of max health after that.
    const heavy = Math.ceil(p.maxHp * 0.3);
    const light = Math.ceil(p.maxHp * 0.1);
    expect(hit(heavy)).toBe(Math.round(Math.round(heavy * 0.9) * (1 - STANCE_MASTERY_GUARDED_CUT)));
    expect(hit(light)).toBe(Math.round(light * 0.9));
  });

  it('Guarded threshold reads the PRE-cut damage: the blunted hit may land below 20%', () => {
    const sim = warriorAtCap(42);
    expect(sim.setSpec('prot')).toBe(true);
    expect(sim.pickRowTalent(3, 'war_row_blood_offering')).toBe(true);
    const p = sim.player;
    sim.castAbility('defensive_stance');
    const mob = mobsNear(sim, 1)[0];
    p.hp = p.maxHp;
    // Post-stance amount sits just over the 20% threshold; the 15% cut then
    // drops what actually lands BELOW 20% of max health, proving the threshold
    // was evaluated before this reduction, not after it.
    const raw = Math.ceil((p.maxHp * STANCE_MASTERY_GUARDED_HP_PCT) / 0.9) + 2;
    const hp0 = p.hp;
    (sim as any).dealDamage(mob, p, raw, false, 'physical', null, 'hit');
    const landed = hp0 - p.hp;
    expect(landed).toBe(Math.round(Math.round(raw * 0.9) * (1 - STANCE_MASTERY_GUARDED_CUT)));
    expect(landed).toBeLessThan(p.maxHp * STANCE_MASTERY_GUARDED_HP_PCT);
  });

  it('Guarded arm is inert without the pick and outside Guarded Stance', () => {
    // Without the pick: only the stance's own 10% cut applies.
    const noPick = warriorAtCap(42);
    expect(noPick.setSpec('prot')).toBe(true);
    noPick.castAbility('defensive_stance');
    const p1 = noPick.player;
    const mob1 = mobsNear(noPick, 1)[0];
    p1.hp = p1.maxHp;
    const heavy1 = Math.ceil(p1.maxHp * 0.3);
    const hp1 = p1.hp;
    (noPick as any).dealDamage(mob1, p1, heavy1, false, 'physical', null, 'hit');
    expect(hp1 - p1.hp).toBe(Math.round(heavy1 * 0.9));
    // With the pick but in Battle Stance: no stance cut, no mastery cut.
    const battle = warriorAtCap(42);
    expect(battle.setSpec('prot')).toBe(true);
    expect(battle.pickRowTalent(3, 'war_row_blood_offering')).toBe(true);
    const p2 = battle.player;
    expect(p2.auras.some((a: any) => a.kind === 'battle_stance')).toBe(true);
    const mob2 = mobsNear(battle, 1)[0];
    p2.hp = p2.maxHp;
    const heavy2 = Math.ceil(p2.maxHp * 0.3);
    const hp2 = p2.hp;
    (battle as any).dealDamage(mob2, p2, heavy2, false, 'physical', null, 'hit');
    expect(hp2 - p2.hp).toBe(heavy2);
  });
});

describe('Recklessness', () => {
  it('grants +20% crit and +50% rage generation for its duration', () => {
    const sim = warriorAtCap(43);
    sim.pickRowTalent(4, 'war_row_recklessness');
    const p = sim.player;
    const crit0 = p.critChance;
    sim.castAbility('recklessness');
    expect(p.auras.some((a: any) => a.kind === 'buff_reckless')).toBe(true);
    expect(p.critChance).toBeCloseTo(crit0 + 0.2);
    const mob = mobsNear(sim, 1)[0];
    standOff(sim, mob, 12);
    sim.targetEntity(mob.id);
    p.resource = 0;
    sim.castAbility('charge');
    // Recklessness (+50%) and Battle Stance (+10%) both mint rage additively.
    expect(p.resource).toBeCloseTo(9 * (1 + RECKLESSNESS_RAGE_GEN + STANCE_RAGE_GEN));
  });
});

describe('Bloodbath', () => {
  it('stacks +5% crit and damage per kill up to five stacks', () => {
    const sim = warriorAtCap(44);
    sim.pickRowTalent(4, 'war_row_bloodbath');
    const p = sim.player;
    const crit0 = p.critChance;
    const victims = mobsNear(sim, 3);
    killMob(sim, victims[0]);
    let aura = p.auras.find((a: any) => a.kind === 'bloodbath');
    expect(aura?.stacks).toBe(1);
    expect(aura?.value).toBeCloseTo(0.05);
    killMob(sim, victims[1]);
    killMob(sim, victims[2]);
    aura = p.auras.find((a: any) => a.kind === 'bloodbath');
    expect(aura?.stacks).toBe(3);
    expect(aura?.value).toBeCloseTo(0.15);
    expect(p.critChance).toBeCloseTo(crit0 + 0.15);
    // Damage-dealt amp: a 20 hit lands as 23 at three stacks.
    const dummy = mobsNear(sim, 1)[0];
    const hp0 = dummy.hp;
    (sim as any).dealDamage(p, dummy, 20, false, 'physical', null, 'hit', true);
    expect(hp0 - dummy.hp).toBe(Math.round(20 * 1.15));
  });
});

describe('Pursuit', () => {
  it('grants a +30% speed burst on a kill', () => {
    const sim = warriorAtCap(45);
    sim.pickRowTalent(0, 'war_row_pursuit');
    killMob(sim, mobsNear(sim, 1)[0]);
    const aura = sim.player.auras.find((a: any) => a.kind === 'buff_speed');
    expect(aura?.value).toBeCloseTo(1.3);
    expect((sim as any).moveSpeedMult(sim.player)).toBeCloseTo(1.3);
  });
});

describe('Second Wind', () => {
  it('regenerates 1.5%/sec below the threshold and nothing above it', () => {
    const sim = warriorAtCap(46);
    sim.pickRowTalent(1, 'war_row_second_wind');
    while ((sim as any).tickCount % 40 !== 0) sim.tick();
    const p = sim.player;
    const meta = metaOf(sim);
    p.inCombat = true;
    p.hp = Math.floor(p.maxHp * 0.3);
    const low = p.hp;
    // The regen arm runs on a 2s cadence, so one pass heals 2 * 1.5% = 3%.
    updateRegen((sim as any).ctx, p, meta);
    expect(p.hp).toBe(low + Math.round(p.maxHp * 0.03));
    p.hp = Math.floor(p.maxHp * (SECOND_WIND_THRESHOLD + 0.1));
    const high = p.hp;
    updateRegen((sim as any).ctx, p, meta);
    expect(p.hp).toBe(high);
  });
});

describe('Die by the Sword', () => {
  it('cuts damage taken a flat 30% at any health', () => {
    // Arms restructure 2026-07-08: Die by the Sword now takes a flat 30% off incoming
    // damage (DIE_BY_SWORD_CUT/LOW_CUT both 0.7) regardless of health, replacing the
    // old 10% cut that doubled below 30% health.
    const sim = warriorAtCap(47);
    sim.pickRowTalent(1, 'war_row_die_by_the_sword');
    const p = sim.player;
    const mob = mobsNear(sim, 1)[0];
    sim.castAbility('die_by_sword');
    expect(p.auras.some((a: any) => a.kind === 'die_by_sword')).toBe(true);
    p.hp = p.maxHp;
    const hp0 = p.hp;
    (sim as any).dealDamage(mob, p, 100, false, 'physical', null, 'hit', true);
    expect(hp0 - p.hp).toBe(70);
    // Below 30% health there is no longer any doubling: still a flat 30% cut.
    p.hp = Math.floor(p.maxHp * 0.2);
    const hp1 = p.hp;
    (sim as any).dealDamage(mob, p, 100, false, 'physical', null, 'hit', true);
    expect(hp1 - p.hp).toBe(70);
  });
});

describe('Piercing Howl', () => {
  it('slows every hostile within 15 yards by 50% for 8s', () => {
    const sim = warriorAtCap(48);
    sim.pickRowTalent(2, 'war_row_piercing_howl');
    const mob = mobsNear(sim, 1)[0];
    standOff(sim, mob, 10);
    sim.player.resource = 50;
    sim.castAbility('piercing_howl');
    const slow = mob.auras.find((a: any) => a.kind === 'slow');
    expect(slow?.value).toBe(0.5);
    expect(slow?.remaining).toBeCloseTo(8, 0);
  });
});

describe('Battle Rhythm', () => {
  it('empowers every third cast: +20% rage generation on it', () => {
    const sim = warriorAtCap(49);
    expect(sim.setSpec('prot')).toBe(true); // Direhowl (demoralizing_shout) is prot-gated base kit
    sim.pickRowTalent(3, 'war_row_battle_rhythm');
    const p = sim.player;
    const mob = mobsNear(sim, 1)[0];
    standOff(sim, mob, 12);
    sim.targetEntity(mob.id);
    p.resource = 60;
    sim.castAbility('battle_shout'); // cast 1
    for (let i = 0; i < 32; i++) sim.tick(); // clear the GCD
    sim.castAbility('demoralizing_shout'); // cast 2
    const before = p.resource;
    sim.castAbility('charge'); // cast 3: empowered (+20% Battle Rhythm on its 9 rage)
    // A prot warrior also stands in Battle Stance (+10% rage), so the mints stack
    // additively in rageGenAuraMult: 9 * (1 + 0.2 + 0.1).
    expect(p.resource).toBeCloseTo(Math.min(100, before + 9 * 1.3));
    // The damage half rides the same cast as a one-tick buff_dmg_done blink
    // (present right after the cast, gone on the next decay pass).
    expect(p.auras.some((a: any) => a.id === 'battle_rhythm' && a.kind === 'buff_dmg_done')).toBe(
      true,
    );
    sim.tick();
    expect(p.auras.some((a: any) => a.id === 'battle_rhythm')).toBe(false);
  });
});

describe('Colossal Might', () => {
  it('shaves offensive cooldowns as rage is spent', () => {
    const sim = warriorAtCap(50);
    expect(sim.setSpec('prot')).toBe(true); // Direhowl (demoralizing_shout) is prot-gated base kit
    sim.pickRowTalent(5, 'war_row_colossal_might');
    sim.pickRowTalent(4, 'war_row_recklessness');
    const p = sim.player;
    p.resource = 60;
    sim.castAbility('recklessness');
    expect(p.cooldowns.get('recklessness')).toBe(180);
    // Iron Bellow is free now, so spend a 10-rage shout instead (Direhowl).
    sim.castAbility('demoralizing_shout'); // 10 rage -> 1s shaved
    expect(p.cooldowns.get('recklessness')).toBeCloseTo(179);
  });
});

describe('Avatar', () => {
  it('breaks control on the caster and amps damage while transformed', () => {
    const sim = warriorAtCap(51);
    sim.pickRowTalent(4, 'war_row_avatar');
    const p = sim.player;
    p.auras.push({
      id: 'test_root',
      name: 'Test Root',
      kind: 'root',
      value: 0,
      remaining: 6,
      duration: 6,
      sourceId: p.id,
      school: 'physical',
    });
    sim.castAbility('avatar');
    expect(p.auras.some((a: any) => a.kind === 'root')).toBe(false);
    expect(p.auras.some((a: any) => a.kind === 'buff_avatar')).toBe(true);
    expect(p.scale).toBeCloseTo(1.15);
    const mob = mobsNear(sim, 1)[0];
    const hp0 = mob.hp;
    (sim as any).dealDamage(p, mob, 20, false, 'physical', null, 'hit', true);
    expect(hp0 - mob.hp).toBe(Math.round(20 * 1.2));
  });
});

describe('Sanguine Aura', () => {
  it('buffs the caster (a melee class) with ONE composite aura: speed and damage', () => {
    const sim = warriorAtCap(52);
    sim.pickRowTalent(5, 'war_row_sanguine_aura');
    const p = sim.player;
    sim.castAbility('sanguine_aura');
    // One aura carries both halves (a haste+damage pair rendered as two
    // same-named icons read as a missing effect in playtest).
    const auras = p.auras.filter((a: any) => a.kind === 'sanguine');
    expect(auras).toHaveLength(1);
    expect(auras[0].value).toBeCloseTo(1 / 1.1);
    expect(auras[0].value2).toBeCloseTo(0.1);
    expect(auras[0].remaining).toBeCloseTo(20, 0);
    // Both halves act: swings 10% faster, damage dealt +10%.
    expect((sim as any).swingIntervalMult(p)).toBeCloseTo(1 / 1.1);
    const mob = mobsNear(sim, 1)[0];
    const hp0 = mob.hp;
    (sim as any).dealDamage(p, mob, 20, false, 'physical', null, 'hit', true);
    expect(hp0 - mob.hp).toBe(Math.round(20 * 1.1));
    // The melee filter: warriors in, pure casters out (class-level v1).
    expect(MELEE_CLASSES.has('warrior')).toBe(true);
    expect(MELEE_CLASSES.has('mage')).toBe(false);
    expect(MELEE_CLASSES.has('priest')).toBe(false);
    expect(MELEE_CLASSES.has('warlock')).toBe(false);
  });
});

describe('Victory Rush', () => {
  it('a kill opens the 20s window; the strike heals 20% max and consumes it', () => {
    const sim = warriorAtCap(54);
    sim.pickRowTalent(1, 'war_row_victory_rush');
    expect(metaOf(sim).known.some((k: any) => k.def.id === 'victory_rush')).toBe(true);
    const p = sim.player;
    const first = mobsNear(sim, 1)[0];
    // The exact-heal assertion needs a target WITHOUT the innate spiked-hide
    // reflect (its bounce-back damage would offset the healed hp).
    const second = [...sim.entities.values()]
      .filter((e: any) => e.kind === 'mob' && !e.dead && e !== first && !MOBS[e.templateId]?.thorns)
      .sort(
        (a: any, b: any) => dist2d(a.pos, sim.player.pos) - dist2d(b.pos, sim.player.pos),
      )[0] as any;
    // Not usable before a kill (the gate errors, nothing happens).
    standOff(sim, first, 2);
    sim.targetEntity(first.id);
    const hpBefore = first.hp;
    sim.castAbility('victory_rush');
    expect(first.hp).toBe(hpBefore);
    // A credited kill opens the window as a normal buff.
    killMob(sim, first);
    const win = p.auras.find((a: any) => a.kind === 'victory_rush');
    expect(win?.remaining).toBeCloseTo(20, 0);
    // The strike lands, heals 20% of max health, and consumes the window.
    standOff(sim, second, 2);
    sim.targetEntity(second.id);
    p.gcdRemaining = 0;
    p.critChance = 0; // no heal crit: pin the exact 20%
    p.hp = Math.floor(p.maxHp * 0.5);
    const hp0 = p.hp;
    sim.castAbility('victory_rush');
    expect(p.hp).toBe(hp0 + Math.round(p.maxHp * 0.2));
    expect(p.auras.some((a: any) => a.kind === 'victory_rush')).toBe(false);
  });
});

describe('Double Charge', () => {
  it('stores two uses of Charge; the recharge refunds them one at a time', () => {
    const sim = warriorAtCap(55);
    sim.pickRowTalent(0, 'war_row_double_charge');
    const p = sim.player;
    const mob = mobsNear(sim, 1)[0];
    mob.hp = 1_000_000;
    mob.maxHp = 1_000_000;
    // First charge: spends a use and starts the recharge timer.
    standOff(sim, mob, 12);
    sim.targetEntity(mob.id);
    sim.castAbility('charge');
    expect(p.charges?.get('charge')?.spent).toBe(1);
    expect(p.cooldowns.get('charge')).toBe(15);
    // Second charge while the first still recharges: allowed, both spent.
    standOff(sim, mob, 12);
    p.chargeTargetId = null; // cut the first dash so the test stays positional
    sim.castAbility('charge');
    expect(p.charges?.get('charge')?.spent).toBe(2);
    // Third is blocked: every stored use is spent.
    standOff(sim, mob, 12);
    p.chargeTargetId = null;
    const cdBefore = p.cooldowns.get('charge');
    sim.castAbility('charge');
    expect(p.cooldowns.get('charge')).toBe(cdBefore); // nothing re-armed
    expect(p.charges?.get('charge')?.spent).toBe(2);
    // One full recharge refunds ONE use and re-arms for the second.
    for (let i = 0; i < 20 * 15 + 1; i++) sim.tick();
    expect(p.charges?.get('charge')?.spent).toBe(1);
    expect(p.cooldowns.has('charge')).toBe(true);
    // The second recharge clears the bookkeeping entirely.
    for (let i = 0; i < 20 * 15 + 1; i++) sim.tick();
    expect(p.charges?.get('charge')).toBeUndefined();
    expect(p.cooldowns.has('charge')).toBe(false);
  });

  it('baseline Charge (no talent) keeps the classic single cooldown', () => {
    const sim = warriorAtCap(55);
    const mob = mobsNear(sim, 1)[0];
    standOff(sim, mob, 12);
    sim.targetEntity(mob.id);
    sim.castAbility('charge');
    expect(sim.player.charges).toBeUndefined();
    expect(sim.player.cooldowns.get('charge')).toBe(15);
  });
});

describe('Bladestorm', () => {
  it('channels a self-centered storm that pulses damage around the caster', () => {
    const sim = warriorAtCap(56);
    sim.pickRowTalent(5, 'war_row_bladestorm');
    expect(metaOf(sim).known.some((k: any) => k.def.id === 'bladestorm')).toBe(true);
    const p = sim.player;
    const mob = mobsNear(sim, 1)[0];
    mob.hp = 1_000_000;
    mob.maxHp = 1_000_000;
    standOff(sim, mob, 4); // inside the 8yd storm
    p.resource = 50;
    const hp0 = mob.hp;
    sim.castAbility('bladestorm');
    expect(p.channeling).toBe(true);
    for (let i = 0; i < 20 * 5; i++) sim.tick();
    expect(p.channeling).toBe(false);
    // Four ticks of 16-22 (armor-mitigated) landed: well over one tick's worth.
    const dealt = hp0 - mob.hp;
    expect(dealt).toBeGreaterThan(30);
    expect(p.cooldowns.get('bladestorm')).toBeGreaterThan(0);
  });

  it('the channel ignores pushback: incoming hits never shorten the 4 seconds', () => {
    const sim = warriorAtCap(59);
    sim.pickRowTalent(5, 'war_row_bladestorm');
    const p = sim.player;
    const mob = mobsNear(sim, 1)[0];
    standOff(sim, mob, 4);
    p.resource = 50;
    sim.castAbility('bladestorm');
    expect(p.channeling).toBe(true);
    const remaining0 = p.castRemaining;
    // A landed enemy hit mid-channel: the channel pushback rule would shave
    // castTotal * 25%, but Bladestorm is uninterruptible (owner ruling: the
    // storm runs its full listed duration no matter what).
    (sim as any).dealDamage(mob, p, 30, false, 'physical', null, 'hit', true);
    expect(p.castRemaining).toBe(remaining0);
    expect(p.channeling).toBe(true);
  });
});

describe('Intimidating Shout + Lingering Dread', () => {
  it('the base shout fears nearby enemies and any damage breaks it', () => {
    const sim = warriorAtCap(57);
    const p = sim.player;
    const mob = mobsNear(sim, 1)[0];
    mob.hp = 1_000_000;
    mob.maxHp = 1_000_000;
    standOff(sim, mob, 4);
    p.resource = 50;
    sim.castAbility('intimidating_shout');
    const fear = mob.auras.find((a: any) => a.id === 'fear_incap');
    expect(fear).toBeTruthy();
    expect(fear.breaksOnDamage).toBe(true);
    expect(fear.breakThreshold).toBeUndefined();
    // Classic: ANY damage snaps the fear.
    (sim as any).dealDamage(p, mob, 5, false, 'physical', null, 'hit', true);
    expect(mob.auras.some((a: any) => a.id === 'fear_incap')).toBe(false);
  });

  it('Lingering Dread soaks 20% of max health in damage before the fear breaks', () => {
    const sim = warriorAtCap(58);
    sim.pickRowTalent(2, 'war_row_lingering_dread');
    const p = sim.player;
    const mob = mobsNear(sim, 1)[0];
    mob.hp = 1_000_000;
    mob.maxHp = 1_000_000;
    standOff(sim, mob, 4);
    p.resource = 50;
    sim.castAbility('intimidating_shout');
    const fear = mob.auras.find((a: any) => a.id === 'fear_incap');
    const threshold = Math.round(mob.maxHp * 0.2);
    expect(fear?.breakThreshold).toBe(threshold);
    // Damage below the threshold soaks; the fear holds.
    (sim as any).dealDamage(p, mob, 1000, false, 'physical', null, 'hit', true);
    expect(mob.auras.some((a: any) => a.id === 'fear_incap')).toBe(true);
    expect(fear?.breakThreshold).toBe(threshold - 1000);
    // Enough damage to cross the remaining threshold snaps it.
    (sim as any).dealDamage(p, mob, threshold, false, 'physical', null, 'hit', true);
    expect(mob.auras.some((a: any) => a.id === 'fear_incap')).toBe(false);
  });
});

describe('determinism with phase 3 talents', () => {
  it('same seed + same picks + same actions give an identical world', () => {
    const run = () => {
      const sim = warriorAtCap(53);
      sim.pickRowTalent(4, 'war_row_bloodbath');
      sim.pickRowTalent(0, 'war_row_pursuit');
      killMob(sim, mobsNear(sim, 1)[0]);
      for (let i = 0; i < 60; i++) sim.tick();
      const p = sim.player;
      return { hp: p.hp, resource: p.resource, crit: p.critChance, auras: p.auras.length };
    };
    expect(run()).toEqual(run());
  });
});
