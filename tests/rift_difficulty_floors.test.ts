// Rift rank difficulty floors (recalibration onto the v0.30 dungeon ladder,
// 2026-07-26). The sibling of tests/heroic_difficulty_floors.test.ts: same
// reference warrior, same "the floor is the contract" model, applied to the
// four rift ranks instead of the dungeon difficulties.
//
// Reference warrior (the maximum-mitigation ceiling, identical to the heroic
// floors test and tests/gravewyrm_normal_tuning.test.ts): a level-20 prot
// warrior in the max-armor kit (full heroic plate + shield, prot mastery),
// 2861 armor, in Defensive Stance (takes 10% less). Against a level-22 rift mob
// the armor step passes ~44.2% and the stance cut leaves ~39.8%; at S rank
// (level 23) ~45.2% and ~40.6%.
//
// The ladder these floors encode, decided 2026-07-26:
//   C  a NORMAL dungeon, on normal Gravewyrm Sanctum's own line
//   B  the heroic five-man line, 1.0x
//   A  1.2x heroic
//   S  1.33x heroic
// Multipliers are the OUTPUT of those targets (solved at the weakest template
// of each mob class), never the input. If the dungeon ladder moves again, THIS
// file should go red before rifts drift for three days again.

import { describe, expect, it } from 'vitest';
import { RIFT_BOSS_IDS, RIFT_TRASH_IDS } from '../src/sim/content/rift/mobs';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  RIFT_HEROIC_MIN_MOVE_SPEED,
  RIFT_HEROIC_TUNING,
  RIFT_NORMAL_TUNING,
  RIFT_RANK_BASE_LEVEL,
  type RiftRankTuning,
  type RiftSpawnRole,
  riftFloorLevel,
  riftHeroicTuningFor,
  riftRankTemplate,
  riftRankTuningFor,
} from '../src/sim/rift/ranks';
import {
  generateRiftFloor,
  isSetPieceRift,
  isSetPieceSeed,
  riftFloorCount,
} from '../src/sim/rift/rift_gen';
import { buildHeuristicRiftUpgrade, buildRiftDungeonDraft } from '../src/sim/rift/upgrader_draft';
import type { RiftTier } from '../src/sim/types';
import { armorReduction } from '../src/sim/types';

const REF_ARMOR = 2861;
const DEFENSIVE_STANCE_TAKEN = 0.9;

// The authored citadel miniboss. C-only content (the 2-floor set piece never
// opens at B/A/S), deliberately lighter than a final boss: it is the
// mid-encounter gate that opens the pit, not the climax.
const MINIBOSS_ID = 'rift_boss_ritualist';
const FINAL_BOSS_IDS = RIFT_BOSS_IDS.filter((id) => id !== MINIBOSS_ID);
// Every mob a rift boss can summon (MobTemplate.summonAdds.mobId). These are
// NON-elite, so they carry no 1.5x elite swing multiplier and need a larger
// multiplier than trash to reach a much SMALLER floor.
const SUMMONED_ADD_IDS = [
  ...new Set(
    RIFT_BOSS_IDS.map((id) => MOBS[id].summonAdds?.mobId).filter((id) => id !== undefined),
  ),
];

// Per-rank targets. `level` is the level the rank fields at its cap, which is
// where the multipliers were solved: C ramps 20 -> 22 across its first floors
// (see the ramp test below), B and A hold 22, S is flat 23.
interface RankFloors {
  tier: RiftTier;
  level: number;
  trashSwing: number;
  bossSwing: number;
  addSwing: number;
  bossHp: number;
  trashHp: number;
}

const RANKS: readonly RankFloors[] = [
  // C: normal Gravewyrm Sanctum's measured line. Trash 100 (Sanctum's
  // sanctum_boneguard lands 103), final boss 280 (Korzul normal lands 280),
  // summoned adds 50 (Sanctum's raised_bonewalker lands 50), final boss pool
  // 6,100 (Korzul normal is 6,127), trash pool 2,199 (boneguard's own).
  {
    tier: 'C',
    level: 22,
    trashSwing: 100,
    bossSwing: 280,
    addSwing: 50,
    bossHp: 6100,
    trashHp: 2199,
  },
  // B: the heroic five-man line 1.0x. 500 is the heroic spawn-list floor, 708
  // is heroic Korzul, 150 is the v0.30 40%-nerfed summoned-add floor, 4,108 is
  // the lightest heroic five-man trash pool (crypt_shambler).
  {
    tier: 'B',
    level: 22,
    trashSwing: 500,
    bossSwing: 708,
    addSwing: 150,
    bossHp: 20000,
    trashHp: 4108,
  },
  // A: 1.2x the heroic line on damage, 2x B's boss pool.
  {
    tier: 'A',
    level: 22,
    trashSwing: 600,
    bossSwing: 850,
    addSwing: 180,
    bossHp: 40000,
    trashHp: 5000,
  },
  // S: 1.33x the heroic line on damage, 3x B's boss pool, at the flat level 23.
  {
    tier: 'S',
    level: 23,
    trashSwing: 665,
    bossSwing: 942,
    addSwing: 200,
    bossHp: 60000,
    trashHp: 5800,
  },
];

const tuningFor = (tier: RiftTier): RiftRankTuning => riftRankTuningFor(RIFT_RANK_BASE_LEVEL[tier]);

// The minimum non-avoided, non-crit hit on the reference warrior, replicating
// the sim's rounding chain (mobSwing rounds after armor, dealDamage after the
// stance cut). Identical to the heroic floors test's minSwing, over the rift
// transform instead of the dungeon one.
function minSwing(mobId: string, tier: RiftTier, role: RiftSpawnRole, level: number): number {
  const template = riftRankTemplate(MOBS[mobId], tuningFor(tier), role);
  const mob = createMob(1, template, level, { x: 0, y: 0, z: 0 });
  const afterArmor = Math.round(mob.weapon.min * (1 - armorReduction(REF_ARMOR, level)));
  return Math.round(afterArmor * DEFENSIVE_STANCE_TAKEN);
}

function maxHpAt(mobId: string, tier: RiftTier, role: RiftSpawnRole, level: number): number {
  const template = riftRankTemplate(MOBS[mobId], tuningFor(tier), role);
  return createMob(1, template, level, { x: 0, y: 0, z: 0 }).maxHp;
}

describe('rift rank damage floors', () => {
  it('every spawn-list trash template clears its rank swing floor', () => {
    for (const rank of RANKS) {
      for (const mobId of RIFT_TRASH_IDS) {
        expect(
          minSwing(mobId, rank.tier, 'trash', rank.level),
          `${rank.tier}/${mobId}`,
        ).toBeGreaterThanOrEqual(rank.trashSwing);
      }
    }
  });

  it('every final boss clears its rank swing floor', () => {
    for (const rank of RANKS) {
      for (const mobId of FINAL_BOSS_IDS) {
        expect(
          minSwing(mobId, rank.tier, 'boss', rank.level),
          `${rank.tier}/${mobId}`,
        ).toBeGreaterThanOrEqual(rank.bossSwing);
      }
    }
  });

  it('every summoned add clears the add floor and stays UNDER the trash line', () => {
    for (const rank of RANKS) {
      for (const mobId of SUMMONED_ADD_IDS) {
        const swing = minSwing(mobId, rank.tier, 'add', rank.level);
        expect(swing, `${rank.tier}/${mobId}`).toBeGreaterThanOrEqual(rank.addSwing);
        // Wave pressure, not extra bosses: an add must never hit like trash.
        expect(swing, `${rank.tier}/${mobId} above the trash line`).toBeLessThan(rank.trashSwing);
      }
    }
  });

  it('the citadel miniboss out-hits C trash but stays under a C final boss', () => {
    const miniboss = minSwing(MINIBOSS_ID, 'C', 'boss', 22);
    expect(miniboss, 'miniboss out-hits the C trash line').toBeGreaterThan(RANKS[0].trashSwing * 2);
    for (const mobId of FINAL_BOSS_IDS) {
      expect(miniboss, `${mobId} out-hits the miniboss`).toBeLessThan(
        minSwing(mobId, 'C', 'boss', 22),
      );
    }
  });
});

describe('rift spawn lists only ever field spawn-list templates', () => {
  // The floors above are a contract over RIFT_TRASH_IDS, so they are only worth
  // anything if nothing ELSE can reach a spawn list. Two paths can put a
  // template there: the procedural generator, and the Dungeon Upgrader manifest
  // that every natural rift portal carries (applyRiftUpgrade substitutes each
  // floor's roster). The shared summoned-add templates sit in the bone, void
  // and citadel theme rosters, and as spawn-list trash they would land ~45%
  // under the rank floor AND pay no loot at all, so the substitution filter has
  // to hold. This walks the REAL generated floors, with the same heuristic
  // manifest the portals build, and re-asserts the floor over what actually
  // spawns rather than over the id list.
  const RANK_BASE_LEVELS = [20, 22, 25, 28];

  it('every spawn a generated rift can field is a spawn-list template', () => {
    const trashIds = new Set<string>(RIFT_TRASH_IDS);
    const bossIds = new Set<string>(RIFT_BOSS_IDS);
    const seen = new Set<string>();
    // How many manifests actually PROPOSED a summoned add. Without this the
    // test could pass simply because the sweep never hit a bone/void/citadel
    // floor, which would make the filter untested rather than proven.
    let manifestsProposingAnAdd = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (const baseLevel of RANK_BASE_LEVELS) {
        const upgrade = buildHeuristicRiftUpgrade(buildRiftDungeonDraft(seed, baseLevel));
        if (upgrade?.floors.some((f) => f.monsterIds.some((id) => SUMMONED_ADD_IDS.includes(id)))) {
          manifestsProposingAnAdd++;
        }
        for (let f = 0; f < riftFloorCount(seed, baseLevel); f++) {
          for (const spawn of generateRiftFloor(seed, baseLevel, f, upgrade).spawns) {
            seen.add(spawn.templateId);
            const eligible = spawn.boss || spawn.miniboss ? bossIds : trashIds;
            expect(
              eligible.has(spawn.templateId),
              `seed ${seed} base ${baseLevel} floor ${f}: ${spawn.templateId} is not spawn-list grade`,
            ).toBe(true);
          }
        }
      }
    }
    // Decisiveness: the sweep covered a real roster, manifests really did try to
    // seed summoned adds as trash (this is the bug the filter fixes, observed
    // live as two rift_bonewalker on an S-rank bone boss floor), and none of
    // them survived into a spawn list.
    expect(seen.size, 'the sweep covered a real roster').toBeGreaterThan(8);
    expect(
      manifestsProposingAnAdd,
      'no manifest proposed a summoned add, so the filter is untested here',
    ).toBeGreaterThan(0);
    for (const addId of SUMMONED_ADD_IDS) {
      expect(seen.has(addId), `${addId} reached a spawn list`).toBe(false);
    }
  });

  it('a manifest that names ONLY summoned adds leaves the generated roster alone', () => {
    // The fallback arm: filtering to nothing must not blank the floor.
    const seed = 7;
    const baseLevel = 22;
    const base = generateRiftFloor(seed, baseLevel, 0);
    const upgrade = buildHeuristicRiftUpgrade(buildRiftDungeonDraft(seed, baseLevel));
    expect(upgrade, 'the heuristic manifest builds').not.toBeNull();
    const adversarial = {
      ...upgrade!,
      floors: upgrade!.floors.map((f) => ({ ...f, monsterIds: [...SUMMONED_ADD_IDS] })),
    };
    const applied = generateRiftFloor(seed, baseLevel, 0, adversarial);
    // Pacing may still thin the pack (that is a separate, intended lever), but
    // the ROSTER must be untouched: every survivor is a template the generator
    // itself chose, and no add slipped in.
    const generated = new Set(base.spawns.map((s) => s.templateId));
    expect(applied.spawns.length, 'the floor is not blanked').toBeGreaterThan(0);
    for (const spawn of applied.spawns) {
      expect(generated.has(spawn.templateId), spawn.templateId).toBe(true);
      expect(SUMMONED_ADD_IDS).not.toContain(spawn.templateId);
    }
  });
});

describe('rift rank health floors', () => {
  it('every final boss clears its rank health floor', () => {
    for (const rank of RANKS) {
      for (const mobId of FINAL_BOSS_IDS) {
        expect(
          maxHpAt(mobId, rank.tier, 'boss', rank.level),
          `${rank.tier}/${mobId}`,
        ).toBeGreaterThanOrEqual(rank.bossHp);
      }
    }
  });

  it('every trash template clears its rank health floor', () => {
    for (const rank of RANKS) {
      for (const mobId of RIFT_TRASH_IDS) {
        expect(
          maxHpAt(mobId, rank.tier, 'trash', rank.level),
          `${rank.tier}/${mobId}`,
        ).toBeGreaterThanOrEqual(rank.trashHp);
      }
    }
  });

  it('trash pools stay in the heroic five-man band, never on the boss curve', () => {
    // The whole reason health is split by mob class: at S the boss needs 13.34x
    // to reach 60,000 while trash must stay near the heroic trash band, or an
    // average 56-mob rift would carry ~868,000 hp of trash. Ceiling here is the
    // heaviest heroic five-man trash pool (drowned_templeguard, 6,219) plus the
    // 1.42x spread of the rift trash roster's own base line.
    for (const rank of RANKS) {
      for (const mobId of RIFT_TRASH_IDS) {
        expect(
          maxHpAt(mobId, rank.tier, 'trash', rank.level),
          `${rank.tier}/${mobId} is on the boss curve`,
        ).toBeLessThan(9000);
      }
    }
  });

  it('pins representative pools across the ladder', () => {
    // A final boss (the lightest, so it sits exactly on each floor) and the
    // lightest trash mob, at every rank.
    expect(maxHpAt('rift_boss_venom', 'C', 'boss', 22)).toBe(6112);
    expect(maxHpAt('rift_boss_venom', 'B', 'boss', 22)).toBe(20081);
    expect(maxHpAt('rift_boss_venom', 'A', 'boss', 22)).toBe(40031);
    expect(maxHpAt('rift_boss_venom', 'S', 'boss', 23)).toBe(60014);
    expect(maxHpAt('rift_pact_acolyte', 'C', 'trash', 22)).toBe(2214);
    expect(maxHpAt('rift_pact_acolyte', 'B', 'trash', 22)).toBe(4243);
    expect(maxHpAt('rift_pact_acolyte', 'A', 'trash', 22)).toBe(5073);
    expect(maxHpAt('rift_pact_acolyte', 'S', 'trash', 23)).toBe(5865);
  });
});

describe('rift rank ladder is monotonic', () => {
  it('each rank out-hits and out-lasts the one below it, in every mob class', () => {
    for (let i = 1; i < RANKS.length; i++) {
      const lo = RANKS[i - 1];
      const hi = RANKS[i];
      const label = `${lo.tier} -> ${hi.tier}`;
      for (const mobId of RIFT_TRASH_IDS) {
        expect(
          minSwing(mobId, hi.tier, 'trash', hi.level),
          `${label} trash swing ${mobId}`,
        ).toBeGreaterThan(minSwing(mobId, lo.tier, 'trash', lo.level));
        expect(
          maxHpAt(mobId, hi.tier, 'trash', hi.level),
          `${label} trash hp ${mobId}`,
        ).toBeGreaterThan(maxHpAt(mobId, lo.tier, 'trash', lo.level));
      }
      for (const mobId of FINAL_BOSS_IDS) {
        expect(
          minSwing(mobId, hi.tier, 'boss', hi.level),
          `${label} boss swing ${mobId}`,
        ).toBeGreaterThan(minSwing(mobId, lo.tier, 'boss', lo.level));
        expect(
          maxHpAt(mobId, hi.tier, 'boss', hi.level),
          `${label} boss hp ${mobId}`,
        ).toBeGreaterThan(maxHpAt(mobId, lo.tier, 'boss', lo.level));
      }
      for (const mobId of SUMMONED_ADD_IDS) {
        expect(
          minSwing(mobId, hi.tier, 'add', hi.level),
          `${label} add swing ${mobId}`,
        ).toBeGreaterThan(minSwing(mobId, lo.tier, 'add', lo.level));
      }
    }
  });

  it("C's first floors ramp onto the line rather than starting on it", () => {
    // C is the only rank whose mob level ramps (20 -> 21 -> 22, riftFloorLevel).
    // The floors above are solved at the level-22 cap; floor 0 lands ~13% under
    // it by design, which is the rank's on-ramp, not drift.
    expect(riftFloorLevel(RIFT_RANK_BASE_LEVEL.C, 0)).toBe(20);
    expect(riftFloorLevel(RIFT_RANK_BASE_LEVEL.C, 2)).toBe(22);
    const floorZero = RIFT_TRASH_IDS.map((id) => minSwing(id, 'C', 'trash', 20));
    expect(Math.min(...floorZero), 'floor 0 stays on the ramp').toBeGreaterThanOrEqual(85);
    expect(Math.min(...floorZero), 'floor 0 is under the level-22 line').toBeLessThan(100);
  });
});

describe('rift rank tuning data contract', () => {
  it('pins the C (normal-dungeon) tuning literals', () => {
    expect(RIFT_NORMAL_TUNING).toEqual({
      healthMultiplier: 2.4,
      damageMultiplier: 3.7,
      bossHealthMultiplier: 1.4,
      bossDamageMultiplier: 7.05,
      addDamageMultiplier: 3.4,
      armorMultiplier: 1,
      // C is a normal dungeon: no anti-kite floor, its mobs stay kiteable.
      minMoveSpeed: 0,
    });
  });

  it('pins the B/A/S (heroic) tuning literals', () => {
    expect(RIFT_HEROIC_TUNING).toEqual({
      B: {
        healthMultiplier: 4.6,
        damageMultiplier: 18.6,
        bossHealthMultiplier: 4.6,
        bossDamageMultiplier: 17.85,
        addDamageMultiplier: 10.3,
        armorMultiplier: 1.12,
        minMoveSpeed: RIFT_HEROIC_MIN_MOVE_SPEED,
      },
      A: {
        healthMultiplier: 5.5,
        damageMultiplier: 22.3,
        bossHealthMultiplier: 9.17,
        bossDamageMultiplier: 21.4,
        addDamageMultiplier: 12.3,
        armorMultiplier: 1.25,
        minMoveSpeed: RIFT_HEROIC_MIN_MOVE_SPEED,
      },
      S: {
        healthMultiplier: 6.1,
        damageMultiplier: 23.3,
        bossHealthMultiplier: 13.34,
        bossDamageMultiplier: 22.4,
        addDamageMultiplier: 12.85,
        armorMultiplier: 1.4,
        minMoveSpeed: RIFT_HEROIC_MIN_MOVE_SPEED,
      },
    });
  });

  it('C keeps a NULL heroic tuning, so the citadel still opens and C boulders still chip', () => {
    // The C-rank trap: riftHeroicTuningFor(baseLevel) === null is overloaded as
    // the "is C rank" predicate. It gates the 2-floor authored Infernal Citadel
    // (C-only content) and boulder lethality (one-shot at B/A/S only). Giving C
    // a heroic entry instead of its own RIFT_NORMAL_TUNING would close the
    // citadel forever and silently make C boulders lethal.
    expect(riftHeroicTuningFor(RIFT_RANK_BASE_LEVEL.C)).toBeNull();
    for (const tier of ['B', 'A', 'S'] as RiftTier[]) {
      expect(riftHeroicTuningFor(RIFT_RANK_BASE_LEVEL[tier]), tier).not.toBeNull();
    }
    // ...while the stat transform still has a tuning at C.
    expect(riftRankTuningFor(RIFT_RANK_BASE_LEVEL.C)).toBe(RIFT_NORMAL_TUNING);
    // And a set-piece seed really does still open the citadel at C, and only C.
    let seed = -1;
    for (let s = 1; s < 400 && seed < 0; s++) if (isSetPieceSeed(s)) seed = s;
    expect(seed, 'found a set-piece seed').toBeGreaterThan(0);
    expect(isSetPieceRift(seed, RIFT_RANK_BASE_LEVEL.C), 'the citadel opens at C').toBe(true);
    for (const tier of ['B', 'A', 'S'] as RiftTier[]) {
      expect(isSetPieceRift(seed, RIFT_RANK_BASE_LEVEL[tier]), tier).toBe(false);
    }
  });

  it('every rank keeps trash and boss on SEPARATE multipliers', () => {
    // The structural fix this recalibration made: one multiplier per rank
    // cannot serve two mob classes. A future edit that collapses them back
    // (making a boss ride the trash line) breaks the ladder silently, so pin
    // that the pairs differ wherever the targets demand it.
    expect(RIFT_NORMAL_TUNING.bossDamageMultiplier).toBeGreaterThan(
      RIFT_NORMAL_TUNING.damageMultiplier,
    );
    expect(RIFT_HEROIC_TUNING.A!.bossHealthMultiplier).toBeGreaterThan(
      RIFT_HEROIC_TUNING.A!.healthMultiplier,
    );
    expect(RIFT_HEROIC_TUNING.S!.bossHealthMultiplier).toBeGreaterThan(
      RIFT_HEROIC_TUNING.S!.healthMultiplier,
    );
    // And that summoned adds stay on their own softer damage line everywhere.
    for (const tier of ['C', 'B', 'A', 'S'] as RiftTier[]) {
      const t = tuningFor(tier);
      expect(t.addDamageMultiplier, `${tier} add line`).toBeLessThan(t.damageMultiplier);
    }
  });
});
