// Warfare Season 2 ("Vanguard") engine payloads for the warrior, paladin, hunter, rogue and priest sets:
// one 2-piece and one 4-piece tier per spec, keyed by the set id of
// content/vanguard_item_sets.ts (whose text is the tooltip source).
// Design and PvE ceilings: docs/design/warfare-season-2.md.
//
// Every 2-piece bends a mobility, control or defensive button; every 4-piece
// fires a follow-up off that button. Most tiers are GENERIC rows (ability
// mods and procs the resolver folds with no class-module change). The few
// that are BESPOKE carry their numbers under `tuning` and are read by the
// named class-module call site, gated on wearsSetBonus
// (combat/set_bonus_wearer.ts). castNth procs draw no rng (no chance field),
// and no bespoke bend adds an rng draw, so wearers and non-wearers keep their
// rng streams.
//
// Data-as-code: every tuning number is a named constant below, pinned against
// the tooltip text by tests/vanguard_set_bonus_a.test.ts. `src/sim`-pure.

import type { SetEngineBonusTier } from './ignivar_set_bonuses';

// ---- Warrior ----
/** Arms 2pc: seconds each Maiming Strike takes off Onrush's remaining cooldown. */
export const VANGUARD_ARMS_2PC_ONRUSH_REFUND_SEC = 1;
/** Arms 4pc: Onrush's Maiming Strike empower, one Redhand stack (Redhand's own 0.2). */
export const VANGUARD_ARMS_4PC_EMPOWER_PCT = 0.2;
/** Arms 4pc: the empower's lifetime, Redhand's own 15 sec. */
export const VANGUARD_ARMS_4PC_EMPOWER_DURATION_SEC = 15;
/** Fury 2pc: Vaulting Charge cooldown cut in seconds (30 to 22). */
export const VANGUARD_FURY_2PC_LEAP_COOLDOWN_CUT_SEC = 8;
/** Fury 4pc: the Enrage duration a Vaulting Charge landing grants (the base Enrage 4). */
export const VANGUARD_FURY_4PC_ENRAGE_DURATION_SEC = 4;
/** Protection 2pc: Faultline cooldown cut in seconds (30 to 25). */
export const VANGUARD_PROT_2PC_FAULTLINE_COOLDOWN_CUT_SEC = 5;
/** Protection 4pc: the damage reduction Faultline grants (buff_dr: 0.1 is 10 percent less taken). */
export const VANGUARD_PROT_4PC_FAULTLINE_DR_PCT = 0.1;
/** Protection 4pc: the Faultline damage reduction's duration in seconds. */
export const VANGUARD_PROT_4PC_FAULTLINE_DR_DURATION_SEC = 6;

// ---- Paladin ----
/** Holy 2pc: Life Covenant cooldown cut in seconds (90 to 60). */
export const VANGUARD_HOLY_PALADIN_2PC_COVENANT_COOLDOWN_CUT_SEC = 30;
/** Holy 4pc: the Life Covenant shield, a fraction of the ally's max health. */
export const VANGUARD_HOLY_PALADIN_4PC_SHIELD_PCT_MAX = 0.08;
/** Holy 4pc: the shield's duration in seconds. */
export const VANGUARD_HOLY_PALADIN_4PC_SHIELD_DURATION_SEC = 6;
/** Protection 2pc: Oath Chain cooldown cut in seconds (18 to 16). */
export const VANGUARD_PROT_PALADIN_2PC_OATH_CHAIN_COOLDOWN_CUT_SEC = 2;
/** Protection 4pc: the cast-time multiplier on enemies Oath Chain pulls (tongues: 1.3 is 30 percent slower). */
export const VANGUARD_PROT_PALADIN_4PC_CAST_SLOW_MULT = 1.3;
/** Protection 4pc: the cast slow's duration in seconds. */
export const VANGUARD_PROT_PALADIN_4PC_CAST_SLOW_DURATION_SEC = 4;
/** Retribution 2pc: Valkyr's Calling cooldown cut in seconds (60 to 45). */
export const VANGUARD_RET_2PC_VALKYR_COOLDOWN_CUT_SEC = 15;
/** Retribution 4pc: the empowered Final Edict's damage bonus. */
export const VANGUARD_RET_4PC_EDICT_DAMAGE_PCT = 0.15;
/** Retribution 4pc: how long the empower waits for a Final Edict, in seconds. */
export const VANGUARD_RET_4PC_EDICT_WINDOW_SEC = 6;

// ---- Hunter ----
/** Beast Mastery 2pc: Rattling Shot cooldown cut in seconds (12 to 8). */
export const VANGUARD_BM_2PC_RATTLING_COOLDOWN_CUT_SEC = 4;
/** Beast Mastery 4pc: seconds each Rattling Shot takes off Howling Rage's remaining cooldown. */
export const VANGUARD_BM_4PC_HOWLING_RAGE_REFUND_SEC = 1;
/** Marksmanship 2pc: Trailbreak cooldown cut in seconds (15 to 11). */
export const VANGUARD_MM_2PC_TRAILBREAK_COOLDOWN_CUT_SEC = 4;
/** Marksmanship 4pc: the instant Long Draw window in seconds. */
export const VANGUARD_MM_4PC_INSTANT_WINDOW_SEC = 6;
/** Marksmanship 4pc: the internal cooldown between instant Long Draw grants. */
export const VANGUARD_MM_4PC_ICD_SEC = 15;
/** Survival 2pc: Bloodhook cooldown cut in seconds (15 to 12). */
export const VANGUARD_SURVIVAL_2PC_BLOODHOOK_COOLDOWN_CUT_SEC = 3;
/** Survival 4pc: Hunting Momentum stacks a landed Bloodhook grants (cap 3 untouched). */
export const VANGUARD_SURVIVAL_4PC_MOMENTUM_STACKS = 1;

// ---- Rogue ----
/** Assassination 2pc: Energy cut off Low Blow's cost (25 to 15). */
export const VANGUARD_ASSASSINATION_2PC_LOW_BLOW_ENERGY_CUT = 10;
/** Low Blow's authored base Energy cost (content/classes.ts kidney_shot), pinned by the test. */
export const VANGUARD_ASSASSINATION_LOW_BLOW_BASE_ENERGY = 25;
/** Assassination 4pc: the sure-crit window after Low Blow, in seconds. */
export const VANGUARD_ASSASSINATION_4PC_CRIT_WINDOW_SEC = 6;
/** Combat 2pc: Swift Heels cooldown cut in seconds (300 to 240). */
export const VANGUARD_COMBAT_2PC_SWIFT_HEELS_COOLDOWN_CUT_SEC = 60;
/** Combat 4pc: extra combo points per Wicked Slash or Haymaker while Swift Heels runs. */
export const VANGUARD_COMBAT_4PC_BONUS_COMBO = 1;
/** Subtlety 2pc: Smokefade cooldown cut in seconds (300 to 240). */
export const VANGUARD_SUBTLETY_2PC_SMOKEFADE_COOLDOWN_CUT_SEC = 60;
/** Subtlety 4pc: extra combo points a Gut Punch from Smokefade awards. */
export const VANGUARD_SUBTLETY_4PC_BONUS_COMBO = 2;

// ---- Priest ----
/** Discipline 2pc: Terror Canticle cooldown cut in seconds (30 to 27). */
export const VANGUARD_DISC_2PC_CANTICLE_COOLDOWN_CUT_SEC = 3;
/** Discipline 4pc: the shielded ally's movement multiplier (buff_speed: 1.2 is 20 percent faster). */
export const VANGUARD_DISC_4PC_SPEED_MULT = 1.2;
/** Discipline 4pc: the speed burst's duration in seconds. */
export const VANGUARD_DISC_4PC_SPEED_DURATION_SEC = 3;
/** Discipline 4pc: the internal cooldown between speed bursts. */
export const VANGUARD_DISC_4PC_ICD_SEC = 8;
/** Holy 2pc: Veilstep cooldown cut in seconds (18 to 12). */
export const VANGUARD_HOLY_PRIEST_2PC_VEILSTEP_COOLDOWN_CUT_SEC = 6;
/** Holy 4pc: the Veilstep self shield, a fraction of max health. */
export const VANGUARD_HOLY_PRIEST_4PC_SHIELD_PCT_MAX = 0.08;
/** Holy 4pc: the shield's duration in seconds. */
export const VANGUARD_HOLY_PRIEST_4PC_SHIELD_DURATION_SEC = 6;
/** Shadow 2pc: Litany of Woe's channel slow, the movement multiplier (30 percent slow). */
export const VANGUARD_SHADOW_2PC_SLOW_MULT = 0.7;
/** Shadow 4pc: the Call Tithefiend self shield, a fraction of max health. */
export const VANGUARD_SHADOW_4PC_SHIELD_PCT_MAX = 0.1;
/** Shadow 4pc: the shield's duration in seconds. */
export const VANGUARD_SHADOW_4PC_SHIELD_DURATION_SEC = 8;

export const VANGUARD_BONUSES_A: Record<string, readonly SetEngineBonusTier[]> = {
  // ---- Warrior ----
  vanguard_warrior_arms: [
    {
      pieces: 2,
      // Each Maiming Strike cast refunds Onrush cooldown. castNth n:1 draws no rng.
      effect: {
        proc: {
          id: 'set_vanguard_warrior_arms_2pc',
          name: 'Bladewake Momentum',
          trigger: { on: 'castNth', n: 1, abilities: ['mortal_strike'] },
          responses: [
            {
              kind: 'cooldownRefund',
              ability: 'charge',
              seconds: VANGUARD_ARMS_2PC_ONRUSH_REFUND_SEC,
            },
          ],
        },
        tuning: { onrushRefundSec: VANGUARD_ARMS_2PC_ONRUSH_REFUND_SEC },
      },
    },
    {
      pieces: 4,
      // Onrush adds one stack of Redhand's own empower (the exact overpower
      // selfBuff kind), so it shares the 2-stack cap and the Maiming Strike
      // consume in effect_dispatch.ts. Shown under Redhand's name.
      effect: {
        ability: [
          {
            ability: 'charge',
            addEffects: [
              {
                type: 'selfBuff',
                kind: 'overpower_charge',
                value: VANGUARD_ARMS_4PC_EMPOWER_PCT,
                duration: VANGUARD_ARMS_4PC_EMPOWER_DURATION_SEC,
                auraName: 'Redhand',
              },
            ],
          },
        ],
        tuning: {
          empowerPct: VANGUARD_ARMS_4PC_EMPOWER_PCT,
          empowerDurationSec: VANGUARD_ARMS_4PC_EMPOWER_DURATION_SEC,
        },
      },
    },
  ],
  vanguard_warrior_fury: [
    {
      pieces: 2,
      // Vaulting Charge 30 -> 22 sec on the resolved entry.
      effect: {
        ability: [
          { ability: 'heroic_leap', cooldownFlat: -VANGUARD_FURY_2PC_LEAP_COOLDOWN_CUT_SEC },
        ],
      },
    },
    {
      pieces: 4,
      // Bespoke: the Vaulting Charge landing (combat/heroic_leap.ts) applies
      // the one fury_enrage aura, so it refreshes rather than stacks with
      // Bloodletting and Red Harvest. Draws no rng.
      effect: { tuning: { enrageDurationSec: VANGUARD_FURY_4PC_ENRAGE_DURATION_SEC } },
    },
  ],
  vanguard_warrior_prot: [
    {
      pieces: 2,
      // Faultline 30 -> 25 sec on the resolved entry.
      effect: {
        ability: [
          { ability: 'faultline', cooldownFlat: -VANGUARD_PROT_2PC_FAULTLINE_COOLDOWN_CUT_SEC },
        ],
      },
    },
    {
      pieces: 4,
      // Faultline also grants a plain buff_dr self-buff (the shared additive
      // damage-reduction read in combat/damage.ts). Its only selfBuff, so the
      // aura keeps Faultline's bare id and name. No rng.
      effect: {
        ability: [
          {
            ability: 'faultline',
            addEffects: [
              {
                type: 'selfBuff',
                kind: 'buff_dr',
                value: VANGUARD_PROT_4PC_FAULTLINE_DR_PCT,
                duration: VANGUARD_PROT_4PC_FAULTLINE_DR_DURATION_SEC,
              },
            ],
          },
        ],
        tuning: {
          damageReductionPct: VANGUARD_PROT_4PC_FAULTLINE_DR_PCT,
          damageReductionDurationSec: VANGUARD_PROT_4PC_FAULTLINE_DR_DURATION_SEC,
        },
      },
    },
  ],
  // ---- Paladin ----
  vanguard_paladin_holy: [
    {
      pieces: 2,
      // Life Covenant 90 -> 60 sec on the resolved entry.
      effect: {
        ability: [
          {
            ability: 'life_covenant',
            cooldownFlat: -VANGUARD_HOLY_PALADIN_2PC_COVENANT_COOLDOWN_CUT_SEC,
          },
        ],
      },
    },
    {
      pieces: 4,
      // Life Covenant also shields the ally: no `target: 'self'`, so the
      // absorb lands on the triggering cast's target, sized off the ally's
      // max health. The name reuses the localized ability string.
      effect: {
        proc: {
          id: 'set_vanguard_paladin_holy_4pc',
          name: 'Life Covenant',
          trigger: { on: 'castNth', n: 1, abilities: ['life_covenant'] },
          responses: [
            {
              kind: 'absorb',
              amountPctMaxHp: VANGUARD_HOLY_PALADIN_4PC_SHIELD_PCT_MAX,
              duration: VANGUARD_HOLY_PALADIN_4PC_SHIELD_DURATION_SEC,
              name: 'Life Covenant',
            },
          ],
        },
        tuning: {
          shieldPctMaxHp: VANGUARD_HOLY_PALADIN_4PC_SHIELD_PCT_MAX,
          shieldDurationSec: VANGUARD_HOLY_PALADIN_4PC_SHIELD_DURATION_SEC,
        },
      },
    },
  ],
  vanguard_paladin_protection: [
    {
      pieces: 2,
      // Oath Chain 18 -> 16 sec on the resolved entry.
      effect: {
        ability: [
          {
            ability: 'oath_chain',
            cooldownFlat: -VANGUARD_PROT_PALADIN_2PC_OATH_CHAIN_COOLDOWN_CUT_SEC,
          },
        ],
      },
    },
    {
      pieces: 4,
      // Bespoke, both halves in combat/paladin_control.ts pullPaladinTargets:
      // every pullable enemy the chain binds gets a tongues aura (the Curse of
      // Tongues cast stretch tonguesMult reads at cast start), and the
      // roll-free grantSolarReprisal fires when the primary is pullable
      // (bosses are not pulled, so neither half lands on them). No interrupt:
      // the pull plus a kick was too strong in PvP. No rng draw is added.
      effect: {
        tuning: {
          castSlowMult: VANGUARD_PROT_PALADIN_4PC_CAST_SLOW_MULT,
          castSlowDurationSec: VANGUARD_PROT_PALADIN_4PC_CAST_SLOW_DURATION_SEC,
        },
      },
    },
  ],
  vanguard_paladin_retribution: [
    {
      pieces: 2,
      // Valkyr's Calling 60 -> 45 sec on the resolved entry.
      effect: {
        ability: [
          { ability: 'valkyrs_calling', cooldownFlat: -VANGUARD_RET_2PC_VALKYR_COOLDOWN_CUT_SEC },
        ],
      },
    },
    {
      pieces: 4,
      // The Final Edict reset is a castNth proc (the Vesperash 4pc shape).
      // The +15 percent is bespoke: combat/paladin_valkyrs_calling.ts grants
      // a one-shot marker at the landing, consumed by the next Final Edict
      // weapon strike in effect_dispatch.ts. Draws no rng.
      effect: {
        proc: {
          id: 'set_vanguard_paladin_retribution_4pc',
          name: 'Lightbrand Verdict',
          trigger: { on: 'castNth', n: 1, abilities: ['valkyrs_calling'] },
          responses: [{ kind: 'cooldownRefund', ability: 'final_edict', seconds: 'reset' }],
        },
        tuning: {
          edictDamagePct: VANGUARD_RET_4PC_EDICT_DAMAGE_PCT,
          edictWindowSec: VANGUARD_RET_4PC_EDICT_WINDOW_SEC,
        },
      },
    },
  ],
  // ---- Hunter ----
  vanguard_hunter_beast_mastery: [
    {
      pieces: 2,
      // Rattling Shot 12 -> 8 sec on the resolved entry.
      effect: {
        ability: [
          { ability: 'concussive_shot', cooldownFlat: -VANGUARD_BM_2PC_RATTLING_COOLDOWN_CUT_SEC },
        ],
      },
    },
    {
      pieces: 4,
      // Each Rattling Shot refunds Howling Rage cooldown. Kept at 1 sec: at 2
      // the cadence gain would approach the Packlord raid set.
      effect: {
        proc: {
          id: 'set_vanguard_hunter_beast_mastery_4pc',
          name: 'Packwarden Howl',
          trigger: { on: 'castNth', n: 1, abilities: ['concussive_shot'] },
          responses: [
            {
              kind: 'cooldownRefund',
              ability: 'bestial_wrath',
              seconds: VANGUARD_BM_4PC_HOWLING_RAGE_REFUND_SEC,
            },
          ],
        },
        tuning: { howlingRageRefundSec: VANGUARD_BM_4PC_HOWLING_RAGE_REFUND_SEC },
      },
    },
  ],
  vanguard_hunter_marksmanship: [
    {
      pieces: 2,
      // Trailbreak 15 -> 11 sec on the resolved entry.
      effect: {
        ability: [
          { ability: 'trailbreak', cooldownFlat: -VANGUARD_MM_2PC_TRAILBREAK_COOLDOWN_CUT_SEC },
        ],
      },
    },
    {
      pieces: 4,
      // Trailbreak makes the next Long Draw instant, once per 15 sec (the icd
      // is load-bearing for the PvE ceiling). The aura name reuses the
      // localized Long Draw string.
      effect: {
        proc: {
          id: 'set_vanguard_hunter_marksmanship_4pc',
          name: 'Long Draw',
          school: 'physical',
          trigger: {
            on: 'castNth',
            n: 1,
            abilities: ['trailbreak'],
            icd: VANGUARD_MM_4PC_ICD_SEC,
          },
          responses: [
            {
              kind: 'empowerNext',
              aura: 'next_cast_instant',
              abilities: ['aimed_shot'],
              duration: VANGUARD_MM_4PC_INSTANT_WINDOW_SEC,
            },
          ],
        },
        tuning: {
          instantWindowSec: VANGUARD_MM_4PC_INSTANT_WINDOW_SEC,
          icdSec: VANGUARD_MM_4PC_ICD_SEC,
        },
      },
    },
  ],
  vanguard_hunter_survival: [
    {
      pieces: 2,
      // Bloodhook 15 -> 12 sec on the resolved entry.
      effect: {
        ability: [
          { ability: 'bloodhook', cooldownFlat: -VANGUARD_SURVIVAL_2PC_BLOODHOOK_COOLDOWN_CUT_SEC },
        ],
      },
    },
    {
      pieces: 4,
      // Bespoke: a Bloodhook that arrives grants 1 Hunting Momentum through
      // the module's own setter (combat/hunter_fieldcraft.ts finishBloodhook),
      // the same 8 sec window and 3 stack cap Gutting Strike uses. No rng.
      effect: { tuning: { momentumStacks: VANGUARD_SURVIVAL_4PC_MOMENTUM_STACKS } },
    },
  ],
  // ---- Rogue ----
  vanguard_rogue_assassination: [
    {
      pieces: 2,
      // Low Blow 25 -> 15 Energy on the resolved entry. costPct is the only
      // cost primitive, so the flat cut is expressed against the base cost
      // (round(25 * 0.6) = 15). The stun keeps its 20 sec cooldown: a heavy
      // CC button never gets more frequent.
      effect: {
        ability: [
          {
            ability: 'kidney_shot',
            costPct:
              -VANGUARD_ASSASSINATION_2PC_LOW_BLOW_ENERGY_CUT /
              VANGUARD_ASSASSINATION_LOW_BLOW_BASE_ENERGY,
          },
        ],
        tuning: { energyCut: VANGUARD_ASSASSINATION_2PC_LOW_BLOW_ENERGY_CUT },
      },
    },
    {
      pieces: 4,
      // Low Blow adds Killer's Calm's exact row (next_attack_crit) with a
      // 6 sec window, so the live consume path pays it. Shown under Killer's
      // Calm's name.
      effect: {
        ability: [
          {
            ability: 'kidney_shot',
            addEffects: [
              {
                type: 'selfBuff',
                kind: 'next_attack_crit',
                value: 1,
                duration: VANGUARD_ASSASSINATION_4PC_CRIT_WINDOW_SEC,
                auraName: "Killer's Calm",
              },
            ],
          },
        ],
        tuning: { critWindowSec: VANGUARD_ASSASSINATION_4PC_CRIT_WINDOW_SEC },
      },
    },
  ],
  vanguard_rogue_combat: [
    {
      pieces: 2,
      // Swift Heels 300 -> 240 sec on the resolved entry.
      effect: {
        ability: [
          { ability: 'sprint', cooldownFlat: -VANGUARD_COMBAT_2PC_SWIFT_HEELS_COOLDOWN_CUT_SEC },
        ],
      },
    },
    {
      pieces: 4,
      // Bespoke: while the Swift Heels aura runs, a landed Wicked Slash or
      // Haymaker awards 1 more combo point (combat/rogue_engines.ts
      // rogueSetComboBonus, read at the award sites). No rng.
      effect: { tuning: { bonusCombo: VANGUARD_COMBAT_4PC_BONUS_COMBO } },
    },
  ],
  vanguard_rogue_subtlety: [
    {
      pieces: 2,
      // Smokefade 300 -> 240 sec on the resolved entry.
      effect: {
        ability: [
          { ability: 'vanish', cooldownFlat: -VANGUARD_SUBTLETY_2PC_SMOKEFADE_COOLDOWN_CUT_SEC },
        ],
      },
    },
    {
      pieces: 4,
      // Bespoke: a Gut Punch cast while the Smokefade stealth is up
      // (snapshotted before the cast breaks it) awards 2 more combo points
      // (combat/rogue_engines.ts rogueSetComboBonus); a plain Duskveil opener
      // does not. The drafted "Smokefade no longer slows" half is dropped:
      // the Skulduggery mastery False Face already lifts Smokefade to full
      // speed (content/talents_classic.ts), so it was a no-op for the spec.
      // No rng.
      effect: { tuning: { bonusCombo: VANGUARD_SUBTLETY_4PC_BONUS_COMBO } },
    },
  ],
  // ---- Priest ----
  vanguard_priest_discipline: [
    {
      pieces: 2,
      // Terror Canticle 30 -> 27 sec on the resolved entry.
      effect: {
        ability: [
          { ability: 'psychic_scream', cooldownFlat: -VANGUARD_DISC_2PC_CANTICLE_COOLDOWN_CUT_SEC },
        ],
      },
    },
    {
      pieces: 4,
      // A fully consumed Psalm of Warding speeds the SHIELDED ally, once per
      // 8 sec (the Emberscreed 4pc trigger and its icd). The aura response
      // targets the trigger subject (the shield's owner, not the priest). A
      // distinct proc id, so it fires beside Emberscreed's proc off the same
      // consume. The name reuses the localized ability string. No rng.
      effect: {
        proc: {
          id: 'set_vanguard_priest_discipline_4pc',
          name: 'Psalm of Warding',
          trigger: {
            on: 'shieldConsumed',
            ability: 'power_word_shield',
            icd: VANGUARD_DISC_4PC_ICD_SEC,
          },
          responses: [
            {
              kind: 'aura',
              auraKind: 'buff_speed',
              value: VANGUARD_DISC_4PC_SPEED_MULT,
              duration: VANGUARD_DISC_4PC_SPEED_DURATION_SEC,
              name: 'Psalm of Warding',
              target: 'subject',
            },
          ],
        },
        tuning: {
          speedMult: VANGUARD_DISC_4PC_SPEED_MULT,
          speedDurationSec: VANGUARD_DISC_4PC_SPEED_DURATION_SEC,
          icdSec: VANGUARD_DISC_4PC_ICD_SEC,
        },
      },
    },
  ],
  vanguard_priest_holy: [
    {
      pieces: 2,
      // Veilstep 18 -> 12 sec on the resolved entry.
      effect: {
        ability: [
          {
            ability: 'veilstep',
            cooldownFlat: -VANGUARD_HOLY_PRIEST_2PC_VEILSTEP_COOLDOWN_CUT_SEC,
          },
        ],
      },
    },
    {
      pieces: 4,
      // Veilstep shields the priest (target 'self': the cast's target may be
      // anyone). The name reuses the localized ability string.
      effect: {
        proc: {
          id: 'set_vanguard_priest_holy_4pc',
          name: 'Veilstep',
          school: 'shadow',
          trigger: { on: 'castNth', n: 1, abilities: ['veilstep'] },
          responses: [
            {
              kind: 'absorb',
              amountPctMaxHp: VANGUARD_HOLY_PRIEST_4PC_SHIELD_PCT_MAX,
              duration: VANGUARD_HOLY_PRIEST_4PC_SHIELD_DURATION_SEC,
              name: 'Veilstep',
              target: 'self',
            },
          ],
        },
        tuning: {
          shieldPctMaxHp: VANGUARD_HOLY_PRIEST_4PC_SHIELD_PCT_MAX,
          shieldDurationSec: VANGUARD_HOLY_PRIEST_4PC_SHIELD_DURATION_SEC,
        },
      },
    },
  ],
  vanguard_priest_shadow: [
    {
      pieces: 2,
      // Bespoke: the single-target channel path never applies non-tick rows,
      // so combat/priest/vespers.ts applies the slow at the Litany of Woe
      // channel start for the channel's length and strips it when the
      // channel is cancelled early. No rng.
      effect: { tuning: { slowMult: VANGUARD_SHADOW_2PC_SLOW_MULT } },
    },
    {
      pieces: 4,
      // Call Tithefiend shields the priest (target 'self'). The name reuses
      // the localized ability string.
      effect: {
        proc: {
          id: 'set_vanguard_priest_shadow_4pc',
          name: 'Call Tithefiend',
          school: 'shadow',
          trigger: { on: 'castNth', n: 1, abilities: ['summon_tithefiend'] },
          responses: [
            {
              kind: 'absorb',
              amountPctMaxHp: VANGUARD_SHADOW_4PC_SHIELD_PCT_MAX,
              duration: VANGUARD_SHADOW_4PC_SHIELD_DURATION_SEC,
              name: 'Call Tithefiend',
              target: 'self',
            },
          ],
        },
        tuning: {
          shieldPctMaxHp: VANGUARD_SHADOW_4PC_SHIELD_PCT_MAX,
          shieldDurationSec: VANGUARD_SHADOW_4PC_SHIELD_DURATION_SEC,
        },
      },
    },
  ],
};
