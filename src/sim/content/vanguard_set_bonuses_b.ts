// Warfare Season 2 ("Vanguard") engine payloads for the shaman, mage, warlock and druid sets:
// one 2-piece and one 4-piece tier per spec, keyed by the set id of
// content/vanguard_item_sets.ts (whose text is the tooltip source).
// Design and PvE ceilings: docs/design/warfare-season-2.md.
//
// Most tiers are GENERIC rows (ability mods, procs) that accumulateTalentEffect
// applies with no class-module change. Five tiers are BESPOKE (the effect
// carries only the audited numbers under `tuning`; the call site gates on
// wearsSetBonus): Brineward 2pc and 4pc (combat/shaman_spiritmend.ts),
// Hourbinder's 4pc (combat/chronomancy.ts via the mage post-cast rider),
// Rimewarden 4pc (combat/frost_mage.ts) and Dreadquill 4pc's heal half
// (combat/affliction.ts). None of the bonuses carries the raid sets' spell
// pushback rider, and every added self-aura takes its own `auraId` so it can
// never replace the ability's own aura (applyAura replaces by id and source).
// `src/sim`-pure; no rng, no clock.

import type { SetEngineBonusTier } from './ignivar_set_bonuses';

// ---- Shaman ----
/** Tempestwrit 2pc: seconds cut from Unleash Weapon's cooldown (15 to 12). */
export const VANGUARD_ELEMENTAL_2PC_UNLEASH_COOLDOWN_CUT_SEC = 3;
/** Tempestwrit 4pc: movement speed multiplier after Unleash Weapon (+20 percent). */
export const VANGUARD_ELEMENTAL_4PC_SPEED_MULT = 1.2;
/** Tempestwrit 4pc: duration in seconds of both the speed and cast-while-moving auras. */
export const VANGUARD_ELEMENTAL_4PC_DURATION_SEC = 4;
/** Tempestwrit 4pc: internal cooldown in seconds. */
export const VANGUARD_ELEMENTAL_4PC_ICD_SEC = 20;
/** Tempestwrit 4pc aura ids: never the bare 'unleash_weapon' id, which the
 *  Lifespring Unleash guard absorb uses on a self-target. */
export const VANGUARD_ELEMENTAL_4PC_MOBILE_AURA_ID = 'set_vanguard_shaman_elemental_4pc_mobile';
export const VANGUARD_ELEMENTAL_4PC_SPEED_AURA_ID = 'set_vanguard_shaman_elemental_4pc_speed';
/** Galeborn 2pc: Ancestral Strike's slow multiplier (30 percent slower). */
export const VANGUARD_ENHANCEMENT_2PC_SLOW_MULT = 0.7;
/** Galeborn 2pc: slow duration in seconds. */
export const VANGUARD_ENHANCEMENT_2PC_SLOW_DURATION_SEC = 4;
/** Galeborn 4pc: seconds refunded from Elemental Trance per Ancestral Strike. */
export const VANGUARD_ENHANCEMENT_4PC_TRANCE_REFUND_SEC = 4;
/** Brineward 2pc: seconds cut from Mending Waters' cast on a low-health target. */
export const VANGUARD_RESTO_SHAMAN_2PC_CAST_CUT_SEC = 0.5;
/** Brineward 2pc: the target's health fraction the cut applies BELOW. */
export const VANGUARD_RESTO_SHAMAN_2PC_HEALTH_BELOW = 0.5;
/** Brineward 4pc: Tidecall's shield as a fraction of the SHAMAN's max health. */
export const VANGUARD_RESTO_SHAMAN_4PC_SHIELD_PCT_MAX = 0.05;
/** Brineward 4pc: shield duration in seconds. */
export const VANGUARD_RESTO_SHAMAN_4PC_SHIELD_DURATION_SEC = 6;

// ---- Mage ----
/** Hourbinder's 2pc: seconds cut from Temporal Barrier's cooldown (12 to 10). */
export const VANGUARD_ARCANE_2PC_BARRIER_COOLDOWN_CUT_SEC = 2;
/** Hourbinder's 4pc: the shielded target's movement speed multiplier. */
export const VANGUARD_ARCANE_4PC_SPEED_MULT = 1.2;
/** Hourbinder's 4pc: speed buff duration in seconds. */
export const VANGUARD_ARCANE_4PC_SPEED_DURATION_SEC = 3;
/** Emberlash 2pc: seconds cut from each Cinderfall charge's recharge (30 to 27). */
export const VANGUARD_FIRE_2PC_CINDERFALL_RECHARGE_CUT_SEC = 3;
/** Emberlash 4pc: seconds refunded from Blazing Barrier per Cinderfall cast. */
export const VANGUARD_FIRE_4PC_BARRIER_REFUND_SEC = 2;
/** Rimewarden 2pc: seconds cut from Icebind's cooldown (22 to 20). */
export const VANGUARD_FROST_2PC_ICEBIND_COOLDOWN_CUT_SEC = 2;
/** Rimewarden 4pc: seconds refunded from Flitstep per Icebind cast. */
export const VANGUARD_FROST_4PC_FLITSTEP_REFUND_SEC = 5;

// ---- Warlock ----
/** Dreadquill 2pc: seconds cut from Harrow's cast (1.5 to 1.2). */
export const VANGUARD_AFFLICTION_2PC_HARROW_CAST_CUT_SEC = 0.3;
/** Harrow's authored cast time (castPct scales it additively). */
export const HARROW_CAST_SEC = 1.5;
/** Dreadquill 4pc: Consume's health transfer multiplier (+30 percent). */
export const VANGUARD_AFFLICTION_4PC_CONSUME_HEAL_MULT = 1.3;
/** Marrowbound 2pc: seconds cut from Bone Armor's cooldown (45 to 35). */
export const VANGUARD_DEMONOLOGY_2PC_BONE_ARMOR_COOLDOWN_CUT_SEC = 10;
/** Marrowbound 4pc: seconds refunded from Bone Armor per Reaping Command. */
export const VANGUARD_DEMONOLOGY_4PC_BONE_ARMOR_REFUND_SEC = 2;
/** Slagcrown 2pc: seconds cut from Cinderhide's cooldown (120 to 90). */
export const VANGUARD_DESTRUCTION_2PC_CINDERHIDE_COOLDOWN_CUT_SEC = 30;
/** Slagcrown 4pc: Conflagrate casts per instant Ruinbolt. */
export const VANGUARD_DESTRUCTION_4PC_CONFLAGRATES_PER_PROC = 2;
/** Slagcrown 4pc: seconds the instant Ruinbolt stays armed. */
export const VANGUARD_DESTRUCTION_4PC_WINDOW_SEC = 8;

// ---- Druid ----
/** Starwarden 2pc: seconds cut from Gripping Roots' cast. */
export const VANGUARD_BALANCE_2PC_ROOTS_CAST_CUT_SEC = 0.5;
/** Gripping Roots' authored cast time (castPct scales it additively beside
 *  the Moongrove baseline's -0.24, so the cut is 0.5 sec for everyone). */
export const GRIPPING_ROOTS_CAST_SEC = 1.5;
/** Starwarden 4pc: movement speed multiplier after Gripping Roots (+20 percent). */
export const VANGUARD_BALANCE_4PC_SPEED_MULT = 1.2;
/** Starwarden 4pc: duration in seconds of both the speed and cast-while-moving auras. */
export const VANGUARD_BALANCE_4PC_DURATION_SEC = 4;
/** Starwarden 4pc: internal cooldown in seconds. */
export const VANGUARD_BALANCE_4PC_ICD_SEC = 20;
/** Starwarden 4pc aura ids (never Gripping Roots' own). */
export const VANGUARD_BALANCE_4PC_MOBILE_AURA_ID = 'set_vanguard_druid_balance_4pc_mobile';
export const VANGUARD_BALANCE_4PC_SPEED_AURA_ID = 'set_vanguard_druid_balance_4pc_speed';
/** Bloodmane 2pc: seconds cut from Bruin Rush's cooldown (15 to 12). */
export const VANGUARD_FERAL_2PC_RUSH_COOLDOWN_CUT_SEC = 3;
/** Bloodmane 4pc: Bruin Rush's self-shield as a fraction of max health. */
export const VANGUARD_FERAL_4PC_SHIELD_PCT_MAX = 0.06;
/** Bloodmane 4pc: shield duration in seconds. */
export const VANGUARD_FERAL_4PC_SHIELD_DURATION_SEC = 6;
/** Thistlebloom 2pc: seconds cut from Fleetmend's cooldown (8 to 7). */
export const VANGUARD_RESTO_DRUID_2PC_FLEETMEND_COOLDOWN_CUT_SEC = 1;
/** Thistlebloom 4pc: movement speed multiplier after Fleetmend. */
export const VANGUARD_RESTO_DRUID_4PC_SPEED_MULT = 1.3;
/** Thistlebloom 4pc: speed buff duration in seconds. */
export const VANGUARD_RESTO_DRUID_4PC_SPEED_DURATION_SEC = 3;

export const VANGUARD_BONUSES_B: Record<string, readonly SetEngineBonusTier[]> = {
  // ---- Shaman ----
  vanguard_shaman_elemental: [
    {
      pieces: 2,
      // Unleash Weapon 15 -> 12 sec: a resolved cooldownFlat row. Unleash is
      // class-shared, so any shaman wearer gets it (the design doc's note 1).
      effect: {
        ability: [
          {
            ability: 'unleash_weapon',
            cooldownFlat: -VANGUARD_ELEMENTAL_2PC_UNLEASH_COOLDOWN_CUT_SEC,
          },
        ],
      },
    },
    {
      pieces: 4,
      // Unleash Weapon grants cast-while-moving (a processional_grace aura,
      // the kind combat/cast_move_gate.ts reads) and +20 percent movement
      // speed for 4 sec, at most once every 20 sec (castNth icd; draws no
      // rng). Each aura takes its own id so neither replaces the other nor
      // any of Unleash Weapon's own auras.
      effect: {
        proc: {
          id: 'set_vanguard_shaman_elemental_4pc',
          name: 'Unleash Weapon',
          school: 'nature',
          trigger: {
            on: 'castNth',
            n: 1,
            abilities: ['unleash_weapon'],
            icd: VANGUARD_ELEMENTAL_4PC_ICD_SEC,
          },
          responses: [
            {
              kind: 'aura',
              auraKind: 'processional_grace',
              value: 1,
              duration: VANGUARD_ELEMENTAL_4PC_DURATION_SEC,
              name: 'Unleash Weapon',
              auraId: VANGUARD_ELEMENTAL_4PC_MOBILE_AURA_ID,
            },
            {
              kind: 'aura',
              auraKind: 'buff_speed',
              value: VANGUARD_ELEMENTAL_4PC_SPEED_MULT,
              duration: VANGUARD_ELEMENTAL_4PC_DURATION_SEC,
              name: 'Unleash Weapon',
              auraId: VANGUARD_ELEMENTAL_4PC_SPEED_AURA_ID,
            },
          ],
        },
      },
    },
  ],
  vanguard_shaman_enhancement: [
    {
      pieces: 2,
      // Ancestral Strike slows its target by 30 percent for 4 sec (the
      // Hamstring weaponStrike + slow shape).
      effect: {
        ability: [
          {
            ability: 'stormstrike',
            addEffects: [
              {
                type: 'slow',
                mult: VANGUARD_ENHANCEMENT_2PC_SLOW_MULT,
                duration: VANGUARD_ENHANCEMENT_2PC_SLOW_DURATION_SEC,
              },
            ],
          },
        ],
      },
    },
    {
      pieces: 4,
      // Each Ancestral Strike cast shaves 4 sec off Elemental Trance's running
      // cooldown (castNth refund; draws no rng).
      effect: {
        proc: {
          id: 'set_vanguard_shaman_enhancement_4pc',
          name: 'Elemental Trance',
          school: 'nature',
          trigger: { on: 'castNth', n: 1, abilities: ['stormstrike'] },
          responses: [
            {
              kind: 'cooldownRefund',
              ability: 'elemental_trance',
              seconds: VANGUARD_ENHANCEMENT_4PC_TRANCE_REFUND_SEC,
            },
          ],
        },
      },
    },
  ],
  vanguard_shaman_restoration: [
    {
      pieces: 2,
      // Bespoke: Mending Waters casts 0.5 sec faster when its target (the
      // caster on a self-cast) is below 50 percent health at cast start
      // (brinewardMendingCastTime in combat/shaman_spiritmend.ts, called at
      // the cast-time resolve in casting_lifecycle.ts). Conditional on the
      // target, so it cannot be a resolved castPct row.
      effect: {
        tuning: {
          castCutSec: VANGUARD_RESTO_SHAMAN_2PC_CAST_CUT_SEC,
          healthBelow: VANGUARD_RESTO_SHAMAN_2PC_HEALTH_BELOW,
        },
      },
    },
    {
      pieces: 4,
      // Bespoke: Tidecall's heal also shields its target for 5 percent of the
      // SHAMAN's max health for 6 sec, at the one Tidecall heal site
      // (depositMendingCurrent in combat/shaman_spiritmend.ts). The generic
      // absorb response scales with the recipient, which would size the
      // shield off a tank's health in a raid, so the bend lives in the module.
      effect: {
        tuning: {
          shieldPctMaxHp: VANGUARD_RESTO_SHAMAN_4PC_SHIELD_PCT_MAX,
          shieldDurationSec: VANGUARD_RESTO_SHAMAN_4PC_SHIELD_DURATION_SEC,
        },
      },
    },
  ],
  // ---- Mage ----
  vanguard_mage_arcane: [
    {
      pieces: 2,
      // Temporal Barrier 12 -> 10 sec: a resolved cooldownFlat row.
      effect: {
        ability: [
          {
            ability: 'temporal_barrier',
            cooldownFlat: -VANGUARD_ARCANE_2PC_BARRIER_COOLDOWN_CUT_SEC,
          },
        ],
      },
    },
    {
      pieces: 4,
      // Bespoke: the shielded target gains +20 percent movement speed for
      // 3 sec (hourbinderBarrierHaste in combat/chronomancy.ts, called from
      // the mage post-cast rider). A buffTarget row cannot carry it: its
      // first aura takes the bare 'temporal_barrier' id and would REPLACE the
      // barrier's own absorb aura.
      effect: {
        tuning: {
          speedMult: VANGUARD_ARCANE_4PC_SPEED_MULT,
          speedDurationSec: VANGUARD_ARCANE_4PC_SPEED_DURATION_SEC,
        },
      },
    },
  ],
  vanguard_mage_fire: [
    {
      pieces: 2,
      // Cinderfall 30 -> 27 sec per charge: the resolved cooldown is each
      // charge's parallel recharge length (armAbilityCooldown's chargeState).
      effect: {
        ability: [
          {
            ability: 'fire_blast',
            cooldownFlat: -VANGUARD_FIRE_2PC_CINDERFALL_RECHARGE_CUT_SEC,
          },
        ],
      },
    },
    {
      pieces: 4,
      // Each Cinderfall cast shaves 2 sec off Blazing Barrier's running
      // cooldown (castNth refund; draws no rng).
      effect: {
        proc: {
          id: 'set_vanguard_mage_fire_4pc',
          name: 'Blazing Barrier',
          school: 'fire',
          trigger: { on: 'castNth', n: 1, abilities: ['fire_blast'] },
          responses: [
            {
              kind: 'cooldownRefund',
              ability: 'blazing_barrier',
              seconds: VANGUARD_FIRE_4PC_BARRIER_REFUND_SEC,
            },
          ],
        },
      },
    },
  ],
  vanguard_mage_frost: [
    {
      pieces: 2,
      // Icebind 22 -> 20 sec (also each Twin Nova charge's recharge).
      effect: {
        ability: [
          { ability: 'frost_nova', cooldownFlat: -VANGUARD_FROST_2PC_ICEBIND_COOLDOWN_CUT_SEC },
        ],
      },
    },
    {
      pieces: 4,
      // Bespoke: each Icebind cast shaves 5 sec off Flitstep
      // (frostMageAfterCast in combat/frost_mage.ts). The generic
      // cooldownRefund response only edits the plain cooldown map, so it is a
      // no-op for a Double Blink mage whose Flitstep runs on charges; the
      // module version shortens the soonest running charge timer instead.
      effect: { tuning: { flitstepRefundSec: VANGUARD_FROST_4PC_FLITSTEP_REFUND_SEC } },
    },
  ],
  // ---- Warlock ----
  vanguard_warlock_affliction: [
    {
      pieces: 2,
      // Harrow 1.5 -> 1.2 sec cast: castPct on the authored cast.
      effect: {
        ability: [
          {
            ability: 'fear',
            castPct: -VANGUARD_AFFLICTION_2PC_HARROW_CAST_CUT_SEC / HARROW_CAST_SEC,
          },
        ],
      },
    },
    {
      pieces: 4,
      // Consume (drain_life) can be channeled while moving: a resolved
      // castWhileMoving row, which cast_move_gate.ts reads off the resolved
      // ability at both the press and the move-to-cancel check. Its health
      // transfer is 30 percent larger: bespoke, at the channel's drainTick
      // site (afflictionConsumeHealMult in combat/affliction.ts). Draws no rng.
      effect: {
        ability: [{ ability: 'drain_life', castWhileMoving: true }],
        tuning: { consumeHealMult: VANGUARD_AFFLICTION_4PC_CONSUME_HEAL_MULT },
      },
    },
  ],
  vanguard_warlock_demonology: [
    {
      pieces: 2,
      // Bone Armor 45 -> 35 sec: a resolved cooldownFlat row.
      effect: {
        ability: [
          {
            ability: 'bone_armor',
            cooldownFlat: -VANGUARD_DEMONOLOGY_2PC_BONE_ARMOR_COOLDOWN_CUT_SEC,
          },
        ],
      },
    },
    {
      pieces: 4,
      // Each Reaping Command shaves 2 sec off Bone Armor's running cooldown.
      effect: {
        proc: {
          id: 'set_vanguard_warlock_demonology_4pc',
          name: 'Bone Armor',
          school: 'shadow',
          trigger: { on: 'castNth', n: 1, abilities: ['reaping_command'] },
          responses: [
            {
              kind: 'cooldownRefund',
              ability: 'bone_armor',
              seconds: VANGUARD_DEMONOLOGY_4PC_BONE_ARMOR_REFUND_SEC,
            },
          ],
        },
      },
    },
  ],
  vanguard_warlock_destruction: [
    {
      pieces: 2,
      // Cinderhide 120 -> 90 sec: a resolved cooldownFlat row.
      effect: {
        ability: [
          {
            ability: 'cinderhide',
            cooldownFlat: -VANGUARD_DESTRUCTION_2PC_CINDERHIDE_COOLDOWN_CUT_SEC,
          },
        ],
      },
    },
    {
      pieces: 4,
      // Every second Conflagrate arms an instant Ruinbolt for 8 sec. The
      // instant is consumed at cast start; the Ruinbolt then spends one
      // Desolation stack in applyAbility exactly as a hard cast would, so both
      // consume once and nothing is left armed.
      effect: {
        proc: {
          id: 'set_vanguard_warlock_destruction_4pc',
          name: 'Ruinbolt',
          school: 'fire',
          trigger: {
            on: 'castNth',
            n: VANGUARD_DESTRUCTION_4PC_CONFLAGRATES_PER_PROC,
            abilities: ['conflagrate'],
          },
          responses: [
            {
              kind: 'empowerNext',
              aura: 'next_cast_instant',
              abilities: ['chaos_bolt'],
              duration: VANGUARD_DESTRUCTION_4PC_WINDOW_SEC,
            },
          ],
        },
      },
    },
  ],
  // ---- Druid ----
  vanguard_druid_balance: [
    {
      pieces: 2,
      // Gripping Roots casts 0.5 sec faster (1.14 -> 0.64 sec for Moongrove
      // with its baseline -0.24; 1.5 -> 1.0 for the other specs).
      effect: {
        ability: [
          {
            ability: 'entangling_roots',
            castPct: -VANGUARD_BALANCE_2PC_ROOTS_CAST_CUT_SEC / GRIPPING_ROOTS_CAST_SEC,
          },
        ],
      },
    },
    {
      pieces: 4,
      // Casting Gripping Roots grants cast-while-moving and +20 percent
      // movement speed for 4 sec, at most once every 20 sec (the Tempestwrit
      // 4pc shape: castNth icd, two self-auras on their own ids).
      effect: {
        proc: {
          id: 'set_vanguard_druid_balance_4pc',
          name: 'Gripping Roots',
          school: 'nature',
          trigger: {
            on: 'castNth',
            n: 1,
            abilities: ['entangling_roots'],
            icd: VANGUARD_BALANCE_4PC_ICD_SEC,
          },
          responses: [
            {
              kind: 'aura',
              auraKind: 'processional_grace',
              value: 1,
              duration: VANGUARD_BALANCE_4PC_DURATION_SEC,
              name: 'Gripping Roots',
              auraId: VANGUARD_BALANCE_4PC_MOBILE_AURA_ID,
            },
            {
              kind: 'aura',
              auraKind: 'buff_speed',
              value: VANGUARD_BALANCE_4PC_SPEED_MULT,
              duration: VANGUARD_BALANCE_4PC_DURATION_SEC,
              name: 'Gripping Roots',
              auraId: VANGUARD_BALANCE_4PC_SPEED_AURA_ID,
            },
          ],
        },
      },
    },
  ],
  vanguard_druid_feral: [
    {
      pieces: 2,
      // Bruin Rush 15 -> 12 sec: a resolved cooldownFlat row.
      effect: {
        ability: [
          { ability: 'bear_charge', cooldownFlat: -VANGUARD_FERAL_2PC_RUSH_COOLDOWN_CUT_SEC },
        ],
      },
    },
    {
      pieces: 4,
      // Bruin Rush shields the druid for 6 percent of max health for 6 sec.
      // target 'self' is REQUIRED (the Rush is hostile).
      effect: {
        proc: {
          id: 'set_vanguard_druid_feral_4pc',
          name: 'Bruin Rush',
          school: 'physical',
          trigger: { on: 'castNth', n: 1, abilities: ['bear_charge'] },
          responses: [
            {
              kind: 'absorb',
              amountPctMaxHp: VANGUARD_FERAL_4PC_SHIELD_PCT_MAX,
              duration: VANGUARD_FERAL_4PC_SHIELD_DURATION_SEC,
              name: 'Bruin Rush',
              target: 'self',
            },
          ],
        },
      },
    },
  ],
  vanguard_druid_restoration: [
    {
      pieces: 2,
      // Fleetmend 8 -> 7 sec: a resolved cooldownFlat row.
      effect: {
        ability: [
          {
            ability: 'swiftmend',
            cooldownFlat: -VANGUARD_RESTO_DRUID_2PC_FLEETMEND_COOLDOWN_CUT_SEC,
          },
        ],
      },
    },
    {
      pieces: 4,
      // Fleetmend grants the DRUID +30 percent movement speed for 3 sec (a
      // selfBuff lands on the caster even when Fleetmend heals an ally).
      effect: {
        ability: [
          {
            ability: 'swiftmend',
            addEffects: [
              {
                type: 'selfBuff',
                kind: 'buff_speed',
                value: VANGUARD_RESTO_DRUID_4PC_SPEED_MULT,
                duration: VANGUARD_RESTO_DRUID_4PC_SPEED_DURATION_SEC,
                auraId: 'set_vanguard_druid_restoration_4pc',
                auraName: 'Fleetmend',
              },
            ],
          },
        ],
      },
    },
  ],
};
