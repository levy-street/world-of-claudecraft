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
// Provenance (qr-19-ref-armor-calibration-constant, 2026-09-01): 2861 is a
// PINNED constant, not a live measurement of the catalog. The committed
// max-armour kit pins at 4085 (tests/heroic_difficulty_floors.test.ts), and
// whether 2861 was ever the raw kit armour or a prot-mastery-folded reading is
// UNSETTLED, so it is not re-based here and rides the packet's R5 re-measure.
// The derivation named above folds the prot mastery in, and that RAISES armour,
// so it cannot produce 2861 from a raw max-armour kit that measured 2969.

import { describe, expect, it } from 'vitest';
import {
  NORMAL_DUNGEON_TUNING,
  type NormalDungeonTuning,
} from '../src/sim/content/dungeon_difficulty';
import { DUNGEON_DEFS } from '../src/sim/content/dungeons';
import { MOBS } from '../src/sim/data';
import { KORGATH_TUNING, KORZUL_TUNING } from '../src/sim/encounters/gravewyrm_sanctum/ids';
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

// The dungeon's spawn-list templates plus Velkhar's summoned add. The Ice Tomb
// rework (docs/design/dungeon-rework/gravewyrm_sanctum.md) adds the Broodsworn
// cultists, the ogres and the Glacier Splinters on the trash floor, the
// NON-elite Rime Whelps in the add band (they come in fours), and the Sledge
// Tusker in the 150 showpiece band.
const TRASH_IDS = [
  'sanctum_boneguard',
  'sanctum_drakonid',
  'broodsworn_thawcaller',
  'broodsworn_goadsmith',
  'broodsworn_pyre_tender',
  'ogre_sledge_hauler',
  'glacier_splinter',
] as const;
const ADD_IDS = ['raised_bonewalker', 'rime_whelp'] as const;
const SHOWPIECE_IDS = ['sledge_tusker'] as const;
const SHOWPIECE_FLOOR = 150;
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
    // Velkhar's Raised Bonewalkers climb out of his thaw pools (his encounter,
    // encounters/gravewyrm_sanctum/velkhar.ts, not a template summonAdds).
    spawnIds.add('raised_bonewalker');
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
      broodsworn_thawcaller: 3.8,
      broodsworn_goadsmith: 3.8,
      broodsworn_pyre_tender: 3.8,
      rime_whelp: 4,
      ogre_sledge_hauler: 3.4,
      glacier_splinter: 3.7,
      sledge_tusker: 4.8,
      korgath_the_bound: 9.5,
      grand_necromancer_velkhar: 6.6,
      korzul_the_gravewyrm: 8.5,
    });
    // The rework's kit mechanics are stated LANDED (factor 1), Korzul's whole
    // phase B kit included (encounters/gravewyrm_sanctum/korzul.ts): his
    // Inferno moved off the template, so its old 15x override is gone.
    expect(tuning.mechanicDamageMultiplierByMob).toEqual({
      sanctum_drakonid: 1,
      broodsworn_thawcaller: 1,
      broodsworn_goadsmith: 1,
      broodsworn_pyre_tender: 1,
      rime_whelp: 1,
      ogre_sledge_hauler: 1,
      glacier_splinter: 1,
      sledge_tusker: 1,
      korgath_the_bound: 1,
      grand_necromancer_velkhar: 1,
      korzul_the_gravewyrm: 1,
    });
    // The bosses' and the Tusker's pools from fight length x 150 party DPS.
    expect(tuning.healthMultiplierByMob).toEqual({
      sledge_tusker: 5.43,
      korgath_the_bound: 5.53,
      sanctum_shackle_hammer: 2,
      sanctum_shackle_tongs: 2,
      sanctum_shackle_anvil: 2,
      sanctum_shackle_bellows: 2,
      grand_necromancer_velkhar: 7.61,
      korzul_the_gravewyrm: 7.83,
    });
  });
});

describe('normal Gravewyrm Sanctum health', () => {
  it('doubles every mob health at its spawn levels (pre-retune values in comments)', () => {
    expect(normalMaxHp('sanctum_boneguard', 19)).toBe(2199); // was 1099
    expect(normalMaxHp('sanctum_drakonid', 19)).toBe(2300); // was 1150
    expect(normalMaxHp('sanctum_drakonid', 20)).toBe(2410); // was 1205
    expect(normalMaxHp('raised_bonewalker', 18)).toBe(594); // was 297
    // The Ice Tomb rework sizes the bosses and the Tusker on their own (target
    // fight length x 150 party DPS): about 12,000, 15,000, 24,000 and 9,000.
    expect(normalMaxHp('korgath_the_bound', 20)).toBe(12007); // was 4342
    expect(normalMaxHp('grand_necromancer_velkhar', 20)).toBe(15000); // was 3942
    expect(normalMaxHp('korzul_the_gravewyrm', 20)).toBe(23988); // was 6127
    expect(normalMaxHp('sledge_tusker', 20)).toBe(8992);
    // The new trash doubles like the shipped trash.
    expect(normalMaxHp('broodsworn_thawcaller', 20)).toBe(2093);
    expect(normalMaxHp('rime_whelp', 18)).toBe(522);
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

  it('every Sledge Tusker swing lands in the 150 showpiece band', () => {
    for (const id of SHOWPIECE_IDS) {
      const { minLevel, maxLevel } = MOBS[id];
      for (let level = minLevel; level <= maxLevel; level++) {
        const swing = minSwingOnReferenceWarrior(id, level);
        expect(swing, `${id} at level ${level}`).toBeGreaterThanOrEqual(SHOWPIECE_FLOOR);
        expect(swing, `${id} at level ${level} below the bosses`).toBeLessThan(BOSS_FLOOR + 20);
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
    // Korzul's landed kit runs at factor 1 while his melee template
    // transform stays at 8.5x.
    const korzul = createMob(1, MOBS.korzul_the_gravewyrm, 20, { x: 0, y: 0, z: 0 });
    applyDungeonMobTuning(korzul, SANCTUM, 'normal');
    expect(korzul.mechanicDamageMult).toBe(1);
  });

  it('states Grave Inferno and Korgath kit LANDED in their encounters', () => {
    const tuning = sanctumTuning();
    // Korzul's aoePulse is GONE (2026-07), and his Grave Inferno moved off the
    // template into the encounter (phase B), so the plate under him can cut it.
    expect(MOBS.korzul_the_gravewyrm.aoePulse).toBeUndefined();
    expect(MOBS.korzul_the_gravewyrm.infernoChannel).toBeUndefined();
    // The FOURTH (largest) Inferno pulse on normal, landed (factor 1).
    expect(tuning.mechanicDamageMultiplierByMob?.korzul_the_gravewyrm).toBe(1);
    expect(KORZUL_TUNING.infernoMin * KORZUL_TUNING.infernoPulses).toBe(280);
    expect(KORZUL_TUNING.infernoMax * KORZUL_TUNING.infernoPulses).toBe(360);
    // Korgath's Shuddering Stomp moved off the template into his encounter
    // (KORGATH_TUNING, telegraphed with a bar): 190 to 285 LANDED at factor 1.
    expect(MOBS.korgath_the_bound.stomp).toBeUndefined();
    expect(tuning.mechanicDamageMultiplierByMob?.korgath_the_bound).toBe(1);
    expect([KORGATH_TUNING.stompMin, KORGATH_TUNING.stompMax]).toEqual([190, 285]);
  });

  it('leaves untuned normal dungeons untouched', () => {
    const template = MOBS.sanctum_boneguard;
    // The Hollow Crypt gained a normal row for its wing bosses; the Last Keep
    // stays untuned.
    expect(mobTemplateForDungeonDifficulty(template, 'the_last_keep', 'normal')).toBe(template);
    const mob = createMob(1, template, 19, { x: 0, y: 0, z: 0 });
    applyDungeonMobTuning(mob, 'the_last_keep', 'normal');
    expect(mob.mechanicDamageMult).toBeUndefined();
  });
});

describe('heroic Gravewyrm Sanctum transform stays on its own calibration', () => {
  // Deliberate heroic literals: base template x heroic tuning (health 4.0,
  // trash damage 5.1 since the heroic pack budget, bosses 19 via
  // damageMultiplierByMob, adds 8.55, armor 1.2, level 22; see
  // tests/heroic_difficulty_floors.test.ts for the budget). If a base
  // template is edited instead of a tuning table, these redden.
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
      dmgBase: 61.2,
      dmgPerLevel: 13.77,
      hpBase: 256,
      hpPerLevel: 92,
      armorPerLevel: 26.4,
    },
    sanctum_drakonid: {
      dmgBase: 66.3,
      dmgPerLevel: 14.28,
      hpBase: 272,
      hpPerLevel: 96,
      armorPerLevel: 31.2,
    },
    // The Ice Tomb rework gives the bosses their own heroic pools (target
    // fight length x 230 heroic party DPS).
    korgath_the_bound: {
      dmgBase: 266,
      dmgPerLevel: 55.1,
      hpBase: 2046.2,
      hpPerLevel: 283.32,
      armorPerLevel: 36,
    },
    grand_necromancer_velkhar: {
      dmgBase: 247,
      dmgPerLevel: 53.2,
      hpBase: 2490.9,
      hpPerLevel: 357.39,
      armorPerLevel: 24,
    },
    korzul_the_gravewyrm: {
      dmgBase: 285,
      dmgPerLevel: 57,
      hpBase: 4704,
      hpPerLevel: 537.6,
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
    // Korzul's landed kit at the five-man heroic boss factor (2.5): the
    // quench-water lands 150 a second.
    const boss = createMob(1, MOBS.korzul_the_gravewyrm, 22, { x: 0, y: 0, z: 0 });
    applyDungeonMobTuning(boss, SANCTUM, 'heroic');
    expect(boss.mechanicDamageMult).toBe(2.5);
  });
});
