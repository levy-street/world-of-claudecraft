import { describe, expect, it } from 'vitest';
import { weaponScaledDamageRange } from '../src/sim/combat/weapon_scaled_damage';
import { ABILITIES, ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { activateDivineAscension, grantDevotion, MAX_DEVOTION } from '../src/sim/paladin_devotion';
import { type ResolvedAbility, Sim } from '../src/sim/sim';
import { resolveTalentHitMult } from '../src/sim/talent_hit_mult';
import type { Entity, WeaponInfo } from '../src/sim/types';
import { abilityScalingOf } from '../src/ui/ability_damage';
import {
  abilityDisplayDescription,
  abilityEffectText,
  abilityScalesWithWeapon,
} from '../src/ui/ability_description';

const FORGEBREAKER: WeaponInfo = { min: 77, max: 115, speed: 3.6 };
const GREEN: WeaponInfo = { min: 30, max: 46, speed: 3.4 };

function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('Missing required test value');
  return value;
}

function setup(weapon: WeaponInfo, attackPower: number, armor = 0) {
  const sim = new Sim({ seed: 40551, playerClass: 'paladin', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(sim.setSpec('retribution')).toBe(true);
  sim.player.weapon = { ...weapon };
  sim.player.attackPower = attackPower;
  sim.player.spellPower = 0;
  sim.player.resource = sim.player.maxResource;
  // Midpoint roll, no crit: isolates the roll range from the hit table.
  sim.rng.next = () => 0.5;
  sim.rng.chance = () => false;
  const target = createMob(40552, MOBS.forest_wolf, 20, {
    ...sim.player.pos,
    z: sim.player.pos.z + 2,
  });
  target.maxHp = target.hp = 1_000_000;
  target.stats.armor = armor;
  target.hostile = true;
  target.swingTimer = 999;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(target);
  return { sim, target };
}

function hammer(sim: Sim): ResolvedAbility {
  return required(sim.resolvedAbility('hammer_of_wrath'));
}

function hammerHit(weapon: WeaponInfo, attackPower: number, armor = 0): number {
  const { sim, target } = setup(weapon, attackPower, armor);
  const before = target.hp;
  sim.ctx.runEffects(sim.player, required(sim.ctx.players.get(sim.player.id)), target, hammer(sim));
  return before - target.hp;
}

describe('weaponScaledDamageRange', () => {
  it('adds weaponMult x (weapon roll + AP / 14 x real speed) to the authored range', () => {
    // 400 AP at 3.6 speed is 102.857 per swing on top of the 77 to 115 roll.
    const range = weaponScaledDamageRange(10, 20, FORGEBREAKER, 400, 0.5);
    expect(range.min).toBeCloseTo(10 + 0.5 * (77 + (400 / 14) * 3.6), 10);
    expect(range.max).toBeCloseTo(20 + 0.5 * (115 + (400 / 14) * 3.6), 10);
  });

  it('is the authored range when the weapon share is zero', () => {
    expect(weaponScaledDamageRange(150, 180, FORGEBREAKER, 400, 0)).toEqual({
      min: 150,
      max: 180,
    });
  });
});

describe('Tolling Hammer weapon scaling', () => {
  it('authors no flat range and 0.72 of the weapon hit', () => {
    expect(ABILITIES.hammer_of_wrath.effects).toEqual([
      { type: 'directDamage', min: 0, max: 0, weaponMult: 0.72 },
    ]);
  });

  it('holds the Forgebreaker raid hit within 3% of the retired flat 150 to 180', () => {
    // 537 AP is the average the endgame Forgebreaker kit measured on the heroic
    // boss dummy (Zealfire 5pc, perfected Crucible Striker waist and feet).
    expect(ITEMS.varkhul_forgebreaker?.weapon).toMatchObject(FORGEBREAKER);
    const range = weaponScaledDamageRange(0, 0, FORGEBREAKER, 537, 0.72);
    const average = (range.min + range.max) / 2;
    expect(Math.abs(average - 165) / 165).toBeLessThan(0.03);
  });

  it('bakes the talent damage multiplier into the weapon share like a weapon strike', () => {
    const { sim } = setup(FORGEBREAKER, 400);
    const res = hammer(sim);
    const meta = required(sim.players.get(sim.playerId));
    const talent = resolveTalentHitMult(res.def, sim.ctx.playerMods(meta)).dmgMult;
    expect(talent).toBeGreaterThan(1);
    expect(res.effects).toEqual([
      { type: 'directDamage', min: 0, max: 0, weaponMult: expect.closeTo(0.72 * talent, 10) },
    ]);
  });

  it('grows with the weapon roll and with Attack Power by the exact weapon share', () => {
    const { sim } = setup(FORGEBREAKER, 400);
    const res = hammer(sim);
    const effect = res.effects[0];
    if (effect.type !== 'directDamage') throw new Error('Tolling Hammer lost its direct hit');
    const weaponMult = required(effect.weaponMult);
    const factor = required(res.outputScaling?.primaryDamage);
    expect(factor).toBe(1.75);
    const share = (weapon: WeaponInfo, ap: number) =>
      weaponMult * ((weapon.min + weapon.max) / 2 + (ap / 14) * weapon.speed) * factor;

    const raid = hammerHit(FORGEBREAKER, 400);
    const leveling = hammerHit(GREEN, 400);
    const moreAp = hammerHit(FORGEBREAKER, 540);
    expect(raid).toBe(Math.round(share(FORGEBREAKER, 400)));
    expect(leveling).toBe(Math.round(share(GREEN, 400)));
    expect(moreAp).toBe(Math.round(share(FORGEBREAKER, 540)));
    expect(raid).toBeGreaterThan(leveling);
    expect(moreAp).toBeGreaterThan(raid);
  });

  it('stays a Holy hit: target armor does not reduce it', () => {
    expect(hammerHit(FORGEBREAKER, 400, 3000)).toBe(hammerHit(FORGEBREAKER, 400, 0));
  });

  it('takes one roll draw plus the crit roll, the same draws as the flat hit', () => {
    const { sim, target } = setup(FORGEBREAKER, 400);
    const draws: number[] = [];
    sim.rng.next = () => {
      draws.push(0.5);
      return 0.5;
    };
    sim.rng.chance = (chance) => sim.rng.next() < chance;
    sim.ctx.runEffects(
      sim.player,
      required(sim.ctx.players.get(sim.player.id)),
      target,
      hammer(sim),
    );
    expect(draws).toHaveLength(2);
  });

  it('lets Ascension raise the weapon share by 30%', () => {
    const { sim } = setup(FORGEBREAKER, 400);
    const plain = hammer(sim).effects[0];
    grantDevotion(sim.player, MAX_DEVOTION);
    expect(activateDivineAscension(sim.player)).toBe(true);
    const ascended = hammer(sim).effects[0];
    if (plain.type !== 'directDamage' || ascended.type !== 'directDamage') {
      throw new Error('Tolling Hammer lost its direct hit');
    }
    expect(required(ascended.weaponMult)).toBeCloseTo(required(plain.weaponMult) * 1.3, 10);
  });
});

describe('Tolling Hammer tooltip', () => {
  function tooltip(weapon: WeaponInfo, attackPower: number) {
    const { sim } = setup(weapon, attackPower);
    const res = hammer(sim);
    const scaling = abilityScalingOf(sim.player);
    return {
      damage: abilityEffectText(res, scaling),
      text: abilityDisplayDescription(res, abilityEffectText(res, scaling), scaling),
    };
  }

  it('shows a live range that moves with the equipped weapon', () => {
    const raid = tooltip(FORGEBREAKER, 400);
    const leveling = tooltip(GREEN, 400);
    expect(raid.damage).not.toBe(leveling.damage);
    expect(raid.text).toContain(raid.damage);
    expect(raid.text).not.toMatch(/\{\w+\}|\$d/);
  });

  it('names weapon damage, Attack Power, and Spell Power as the scaling stats', () => {
    const { text } = tooltip(FORGEBREAKER, 400);
    expect(text).toContain(
      'Damage increases with your weapon damage, Attack Power, and Spell Power.',
    );
  });

  it('adds the scaling line only to weapon-scaled spells', () => {
    const { sim } = setup(FORGEBREAKER, 400);
    expect(abilityScalesWithWeapon(hammer(sim))).toBe(true);
    for (const id of ['final_edict', 'dawnfall', 'hammer_of_grace']) {
      expect(abilityScalesWithWeapon(required(sim.resolvedAbility(id)))).toBe(false);
    }
  });

  it('keeps every weapon-scaled direct hit a spell, so the Spell Power claim holds', () => {
    const weaponScaled = Object.values(ABILITIES).filter((def) =>
      def?.effects.some((effect) => effect.type === 'directDamage' && effect.weaponMult),
    );
    expect(weaponScaled.map((def) => def?.id)).toEqual(['hammer_of_wrath']);
    for (const def of weaponScaled) expect(def?.school).not.toBe('physical');
  });
});
