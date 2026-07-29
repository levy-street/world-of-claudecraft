// Gravewyrm Sanctum NORMAL retune: the v0.29 economy floors (200 trash / 420
// bosses / 150 adds) made normal Sanctum unclearable for its actual audience,
// freshly-capped groups. v0.30 keeps the DOUBLED health (the anti-solo
// economy lever is clear time) and re-floors damage for the fresh group
// instead; the 2026-07-26 pressure pass then raised the floors again after a
// fresh THREE-player group cleared the first calibration without pressure
// (its bench had priced the floors so a worst-case autopilot healer barely
// survived). Boss mechanics scale by the same per-mob factor unless
// mechanicDamageMultiplierByMob overrides one (Korzul's avoidable Grave
// Inferno prices off the tank-swing line). Heroic reads the same base
// templates on its OWN calibration (tests/heroic_difficulty_floors.test.ts),
// so this file also pins the heroic transform literals: a base-template edit
// cannot slip through either difficulty unnoticed.
//
// Reference warrior (the "fully geared" mitigation ceiling): level-20 prot
// warrior in the max-armor kit (full heroic plate + shield, prot mastery),
// 2861 armor / 2762 hp, in Defensive Stance (takes 10% less). Derivation:
// max-armor pick per equip slot over ITEMS via canEquipItemInSlot at
// requiredLevel <= 20, folded through characterDerivedStats with the prot
// mastery (armorPct 0.10, staPct 0.40, armorFromStrPct 0.70).

import { describe, expect, it } from 'vitest';
import {
  NORMAL_DUNGEON_TUNING,
  type NormalDungeonTuning,
} from '../src/sim/content/dungeon_difficulty';
import { DUNGEON_DEFS } from '../src/sim/content/dungeons';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  applyDungeonMobTuning,
  mobTemplateForDungeonDifficulty,
} from '../src/sim/instances/difficulty';
import { armorReduction } from '../src/sim/types';

const SANCTUM = 'gravewyrm_sanctum';
const REF_ARMOR = 2861; // max-armor BiS prot warrior, level 20 (see header)
const DEFENSIVE_STANCE_TAKEN = 0.9; // dealDamage: Defensive Stance takes 10% less
// v0.30 pressure pass (2026-07-26): normal Sanctum serves freshly-capped
// groups in quest greens/blues (1371-1752 hp / 1439-2361 armor across the
// three committed tanks). The first v0.30 floors (90/200/50) let a fresh
// 3-man clear without pressure, so Korgath and Korzul rise to MEET Velkhar,
// the existing peak fight (Korgath 301 / Korzul 280 on the 200 boss floor,
// ~29-31% of a fresh tank pool per average swing; Velkhar is UNCHANGED at
// the 200 line, ~21%, because he swings at 2.0s and layers his bonewalker
// waves on top) and trash rises to 100 (lands 103+). Boss dtps on a fresh
// tank runs ~179-193, pressed above a fresh healer's sustain so the tank
// loses ground without cooldowns; tanks are crit-immune since v0.29.1 so no
// swing spikes past the 1.25x roll cap. Korzul's melee multiplier sits below
// Korgath's because he also carries the gate-guaranteed inferno channel on
// top of his 30% enrage. The summoned bonewalkers stay
// at 50 (three spawn at once: wave pressure, not extra bosses), and the
// DOUBLED health stays. Solo note: a best-in-slot self-healing tank still
// out-heals these floors, so clear TIME is what keeps solo farming
// unprofitable.
const TRASH_FLOOR = 100;
const BOSS_FLOOR = 200;
const ADD_FLOOR = 50;

// The dungeon's five spawn-list templates plus Velkhar's summoned add.
const TRASH_IDS = ['sanctum_boneguard', 'sanctum_drakonid'] as const;
const ADD_IDS = ['raised_bonewalker'] as const;
const BOSS_IDS = [
  'korgath_the_bound',
  'grand_necromancer_velkhar',
  'korzul_the_gravewyrm',
] as const;

function sanctumTuning(): NormalDungeonTuning {
  const tuning = NORMAL_DUNGEON_TUNING[SANCTUM];
  expect(tuning).toBeTruthy();
  return tuning;
}

// The minimum non-avoided, non-crit melee hit the reference warrior takes from
// this mob at the given level, replicating the sim's rounding chain:
// mobSwing rounds after the armor step, dealDamage rounds after the stance cut.
function minSwingOnReferenceWarrior(mobId: string, level: number): number {
  const template = mobTemplateForDungeonDifficulty(MOBS[mobId], SANCTUM, 'normal');
  const mob = createMob(1, template, level, { x: 0, y: 0, z: 0 });
  const afterArmor = Math.round(mob.weapon.min * (1 - armorReduction(REF_ARMOR, level)));
  return Math.round(afterArmor * DEFENSIVE_STANCE_TAKEN);
}

function normalMaxHp(mobId: string, level: number): number {
  const template = mobTemplateForDungeonDifficulty(MOBS[mobId], SANCTUM, 'normal');
  return createMob(1, template, level, { x: 0, y: 0, z: 0 }).maxHp;
}

describe('normal Gravewyrm Sanctum tuning data', () => {
  it('covers every mob the sanctum spawns, including boss-summoned adds', () => {
    const tuning = sanctumTuning();
    const spawnIds = new Set<string>();
    for (const spawn of DUNGEON_DEFS[SANCTUM].spawns) {
      spawnIds.add(spawn.mobId);
      const summoned = MOBS[spawn.mobId]?.summonAdds?.mobId;
      if (summoned) spawnIds.add(summoned);
    }
    expect([...spawnIds].sort()).toEqual(Object.keys(tuning.damageMultiplierByMob).sort());
    // The mechanic override map may only re-price mobs the melee map covers.
    for (const id of Object.keys(tuning.mechanicDamageMultiplierByMob ?? {})) {
      expect(tuning.damageMultiplierByMob, `${id} missing a melee factor`).toHaveProperty(id);
    }
  });

  it('pins the retune multipliers to exact literals', () => {
    const tuning = sanctumTuning();
    expect(tuning.healthMultiplier).toBe(2.0);
    expect(tuning.damageMultiplierByMob).toEqual({
      sanctum_boneguard: 3.8,
      sanctum_drakonid: 3.7,
      raised_bonewalker: 3.75,
      korgath_the_bound: 9.5,
      grand_necromancer_velkhar: 6.6,
      korzul_the_gravewyrm: 8.5,
    });
    // Korzul's avoidable Grave Inferno prices off the tank-swing line: 15x
    // makes standing all four pulses (raw 1050-1350) lethal to a ~1000hp
    // fresh melee pool while his melee stays on the boss calibration above.
    expect(tuning.mechanicDamageMultiplierByMob).toEqual({
      korzul_the_gravewyrm: 15,
    });
  });
});

describe('normal Gravewyrm Sanctum health', () => {
  it('doubles every mob health at its spawn levels (pre-retune values in comments)', () => {
    expect(normalMaxHp('sanctum_boneguard', 19)).toBe(2199); // was 1099
    expect(normalMaxHp('sanctum_drakonid', 19)).toBe(2300); // was 1150
    expect(normalMaxHp('sanctum_drakonid', 20)).toBe(2410); // was 1205
    expect(normalMaxHp('raised_bonewalker', 18)).toBe(594); // was 297
    expect(normalMaxHp('korgath_the_bound', 20)).toBe(4342); // was 2171
    expect(normalMaxHp('grand_necromancer_velkhar', 20)).toBe(3942); // was 1971
    expect(normalMaxHp('korzul_the_gravewyrm', 20)).toBe(6127); // was 3064
  });
});

describe('normal Gravewyrm Sanctum melee floors vs the reference warrior', () => {
  it('every summoned bonewalker swing lands for at least the 50 add floor', () => {
    for (const id of ADD_IDS) {
      const { minLevel, maxLevel } = MOBS[id];
      for (let level = minLevel; level <= maxLevel; level++) {
        const swing = minSwingOnReferenceWarrior(id, level);
        expect(swing, `${id} at level ${level}`).toBeGreaterThanOrEqual(ADD_FLOOR);
        expect(swing, `${id} at level ${level} above trash`).toBeLessThan(TRASH_FLOOR + 100);
      }
    }
  });

  it('every trash swing lands for at least 100 at every spawnable level', () => {
    for (const id of TRASH_IDS) {
      const { minLevel, maxLevel } = MOBS[id];
      for (let level = minLevel; level <= maxLevel; level++) {
        expect(
          minSwingOnReferenceWarrior(id, level),
          `${id} at level ${level}`,
        ).toBeGreaterThanOrEqual(TRASH_FLOOR);
      }
    }
  });

  it('every boss swing lands for at least 200 at every spawnable level', () => {
    for (const id of BOSS_IDS) {
      const { minLevel, maxLevel } = MOBS[id];
      for (let level = minLevel; level <= maxLevel; level++) {
        expect(
          minSwingOnReferenceWarrior(id, level),
          `${id} at level ${level}`,
        ).toBeGreaterThanOrEqual(BOSS_FLOOR);
      }
    }
  });
});

describe('normal Gravewyrm Sanctum mechanic scaling', () => {
  it('spawned normal mobs carry the per-mob mechanic multiplier, override first', () => {
    const tuning = sanctumTuning();
    for (const id of [...TRASH_IDS, ...BOSS_IDS]) {
      const mob = createMob(1, MOBS[id], MOBS[id].minLevel, { x: 0, y: 0, z: 0 });
      applyDungeonMobTuning(mob, SANCTUM, 'normal');
      const expected =
        tuning.mechanicDamageMultiplierByMob?.[id] ?? tuning.damageMultiplierByMob[id];
      expect(mob.mechanicDamageMult, id).toBe(expected);
    }
    // The one live override, asserted concretely: Korzul's entity mechanics
    // run at 15x while his melee template transform stays at 8.5x.
    const korzul = createMob(1, MOBS.korzul_the_gravewyrm, 20, { x: 0, y: 0, z: 0 });
    applyDungeonMobTuning(korzul, SANCTUM, 'normal');
    expect(korzul.mechanicDamageMult).toBe(15);
  });

  it('scales Grave Inferno by the mechanic override and Korgath stomp by his melee factor', () => {
    const tuning = sanctumTuning();
    // Korzul's aoePulse is GONE (2026-07): Grave Inferno replaced it, a
    // stationary 8s channel with four escalating avoidable pulses.
    expect(MOBS.korzul_the_gravewyrm.aoePulse).toBeUndefined();
    const inferno = MOBS.korzul_the_gravewyrm.infernoChannel;
    const korgathStomp = MOBS.korgath_the_bound.stomp;
    expect(inferno).toBeTruthy();
    expect(korgathStomp?.min).toBeTruthy();
    if (!inferno || korgathStomp?.min === undefined || korgathStomp.max === undefined) return;
    // Raw (unmitigated) mechanic damage after the per-mob multiplier: the
    // FOURTH (largest) inferno pulse on normal, and the stomp band.
    const mult = tuning.mechanicDamageMultiplierByMob?.korzul_the_gravewyrm;
    expect(mult).toBe(15);
    if (mult === undefined) return;
    expect(inferno.min * inferno.pulses * mult).toBe(420);
    expect(inferno.max * inferno.pulses * mult).toBe(540);
    expect(korgathStomp.min * tuning.damageMultiplierByMob.korgath_the_bound).toBe(190);
    expect(korgathStomp.max * tuning.damageMultiplierByMob.korgath_the_bound).toBe(285);
  });

  it('leaves untuned normal dungeons untouched', () => {
    const template = MOBS.sanctum_boneguard;
    expect(mobTemplateForDungeonDifficulty(template, 'hollow_crypt', 'normal')).toBe(template);
    const mob = createMob(1, template, 19, { x: 0, y: 0, z: 0 });
    applyDungeonMobTuning(mob, 'hollow_crypt', 'normal');
    expect(mob.mechanicDamageMult).toBeUndefined();
  });
});

describe('heroic Gravewyrm Sanctum transform stays on its own calibration', () => {
  // Deliberate heroic literals: base template x heroic tuning (health 4.0,
  // trash damage 15.5, bosses 19 via damageMultiplierByMob, adds 8.55, armor
  // 1.2, level 22; see tests/heroic_difficulty_floors.test.ts for the
  // floors). If a base template is edited instead of a tuning table, these
  // redden.
  const HEROIC_PINS: Record<
    string,
    {
      dmgBase: number;
      dmgPerLevel: number;
      hpBase: number;
      hpPerLevel: number;
      armorPerLevel: number;
    }
  > = {
    sanctum_boneguard: {
      dmgBase: 186,
      dmgPerLevel: 41.85,
      hpBase: 256,
      hpPerLevel: 92,
      armorPerLevel: 26.4,
    },
    sanctum_drakonid: {
      dmgBase: 201.5,
      dmgPerLevel: 43.4,
      hpBase: 272,
      hpPerLevel: 96,
      armorPerLevel: 31.2,
    },
    korgath_the_bound: {
      dmgBase: 266,
      dmgPerLevel: 55.1,
      hpBase: 1040,
      hpPerLevel: 144,
      armorPerLevel: 36,
    },
    grand_necromancer_velkhar: {
      dmgBase: 247,
      dmgPerLevel: 53.2,
      hpBase: 920,
      hpPerLevel: 132,
      armorPerLevel: 24,
    },
    korzul_the_gravewyrm: {
      dmgBase: 285,
      dmgPerLevel: 57,
      hpBase: 1680,
      hpPerLevel: 192,
      armorPerLevel: 40.8,
    },
  };

  it('pins every heroic spawn-list transform to its calibration literals', () => {
    for (const [id, pins] of Object.entries(HEROIC_PINS)) {
      const heroic = mobTemplateForDungeonDifficulty(MOBS[id], SANCTUM, 'heroic');
      expect(heroic.minLevel, id).toBe(22);
      expect(heroic.maxLevel, id).toBe(22);
      expect(heroic.dmgBase, id).toBeCloseTo(pins.dmgBase, 10);
      expect(heroic.dmgPerLevel, id).toBeCloseTo(pins.dmgPerLevel, 10);
      expect(heroic.hpBase, id).toBeCloseTo(pins.hpBase, 10);
      expect(heroic.hpPerLevel, id).toBeCloseTo(pins.hpPerLevel, 10);
      expect(heroic.armorPerLevel, id).toBeCloseTo(pins.armorPerLevel, 10);
      expect(heroic.moveSpeed, id).toBe(8);
    }
  });

  it('pins the heroic summoned bonewalker to its calibration literals', () => {
    const add = mobTemplateForDungeonDifficulty(MOBS.raised_bonewalker, SANCTUM, 'heroic', {
      summonedAdd: true,
    });
    expect(add.dmgBase).toBeCloseTo(76.95, 10);
    expect(add.dmgPerLevel).toBeCloseTo(18.81, 10);
    expect(add.hpBase).toBeCloseTo(168, 10);
    expect(add.hpPerLevel).toBeCloseTo(60, 10);
    expect(add.armorPerLevel).toBeCloseTo(14.4, 10);
  });

  it('stamps the heroic boss mechanic multiplier from the per-mob override', () => {
    const boss = createMob(1, MOBS.korzul_the_gravewyrm, 22, { x: 0, y: 0, z: 0 });
    applyDungeonMobTuning(boss, SANCTUM, 'heroic');
    expect(boss.mechanicDamageMult).toBe(19);
  });
});
