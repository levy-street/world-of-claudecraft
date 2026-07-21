// ---------------------------------------------------------------------------
// Warrior choice-row talent content (the Pandaria-style system in
// talent_rows.ts). Six tiers at levels 5/8/11/14/17/20, pick one of three.
// Pure data; English text is the content source, localized at the client.
//
// PHASING: all 18 options are LIVE. If a future option's mechanic is not built
// yet, give it `effect: {}`: it folds to nothing, the Choices tab renders it
// disabled with a "Coming soon" badge, and tests/talent_rows_sim.test.ts pins
// exactly which options are live so a marker cannot be forgotten silently.
// The design source of truth (numbers approved by the owner) is the bilingual
// calculator mockup + docs/design/warrior-talents-build-plan.md.
// ---------------------------------------------------------------------------

import type { RowTree } from './talent_rows';

export const WARRIOR_ROWS: RowTree = [
  {
    // Tier 1 (level 5): mobility.
    level: 5,
    options: [
      {
        id: 'war_row_double_charge',
        name: 'Double Charge',
        description: 'Your Charge stores 2 uses, so you can charge twice in a row.',
        // LIVE: the ability-charge system (casting_lifecycle + updateTimers)
        // keyed off the resolved bonusCharges.
        effect: { ability: [{ ability: 'charge', bonusCharges: 1 }] },
      },
      {
        id: 'war_row_pursuit',
        name: 'Pursuit',
        description: 'Each enemy you kill grants 30% movement speed for 6 sec.',
        // LIVE: the on-kill hook in combat/damage.ts handleDeath reads this global.
        effect: { global: { onKillSpeedPct: 0.3 } },
      },
      {
        id: 'war_row_crushing_charge',
        name: 'Crushing Charge',
        description: 'Your Charge also roots the target for 4 sec and slows it by 50% for 15 sec.',
        // LIVE: rides the existing addEffects path onto the base Charge.
        effect: {
          ability: [
            {
              ability: 'charge',
              addEffects: [
                { type: 'root', duration: 4 },
                { type: 'slow', mult: 0.5, duration: 15 },
              ],
            },
          ],
        },
      },
    ],
  },
  {
    // Tier 2 (level 8): survival.
    level: 8,
    options: [
      {
        id: 'war_row_second_wind',
        name: 'Second Wind',
        description: 'Below 35% health, you regenerate 1.5% of your health per second.',
        // LIVE: the in-combat regen arm in combat/auras.ts updateRegen reads this.
        // Nerfed 3% to 1.5%/sec after the owner's playtest ("muy broken").
        effect: { global: { secondWindPctPerSec: 0.015 } },
      },
      {
        id: 'war_row_die_by_the_sword',
        name: 'Die by the Sword',
        description:
          'Defensive cooldown: for 8 sec you take 30% less damage and dodge far more attacks.',
        // LIVE: grants the defensive cooldown; the cut lives in dealDamage.
        effect: { grant: { ability: 'die_by_sword' } },
      },
      {
        id: 'war_row_victory_rush',
        name: 'Victory Rush',
        description:
          'Grants Victory Rush: after killing an enemy, your next strike heals you for 20% of your maximum health.',
        // LIVE: grants the strike; the on-kill window aura is applied by
        // handleDeath and required + consumed by the cast.
        effect: { grant: { ability: 'victory_rush' } },
      },
    ],
  },
  {
    // Tier 3 (level 11): control.
    level: 11,
    options: [
      {
        id: 'war_row_piercing_howl',
        name: 'Piercing Howl',
        description: 'A shout that slows enemies within 15 yards by 50% for 8 sec.',
        // LIVE: grants the AoE-slow shout (the aoeSlow effect in effect_dispatch).
        effect: { grant: { ability: 'piercing_howl' } },
      },
      {
        id: 'war_row_storm_bolt',
        name: 'Storm Bolt',
        description: 'Hurl your weapon to stun a target.',
        // LIVE: grants the thrown stun (directDamage + stun, projectile).
        effect: { grant: { ability: 'storm_bolt' } },
      },
      {
        id: 'war_row_lingering_dread',
        name: 'Lingering Dread',
        description:
          'Enemies feared by your Intimidating Shout can endure 20% of their health in damage before the fear breaks.',
        // LIVE: arms the breakThreshold on the aoeFear apply (the threshold
        // arm in combat/damage.ts soaks damage before the classic snap).
        effect: { global: { fearBreakPct: 0.2 } },
      },
    ],
  },
  {
    // Tier 4 (level 14): resource.
    level: 14,
    options: [
      {
        id: 'war_row_anger_management',
        name: 'Anger Management',
        description: 'Your auto-attacks generate 10% more rage and your abilities 5% more.',
        // LIVE: the rage-generation globals folded by the shared engine.
        // v0.27.1 rage fix: trimmed from 25/15, which alone was a third of the
        // fury income overshoot. The row id stays stable so saved picks survive.
        effect: { global: { autoRagePct: 0.1, abilityRagePct: 0.05 } },
      },
      {
        // Final owner design (2026-07-11): each stance gains an extra effect, so
        // every spec reads its own line and stance-dancers get all three. The row
        // id stays stable so saved picks survive.
        id: 'war_row_blood_offering',
        name: 'Combat Mastery',
        description:
          'Your stances gain additional effects. Battle Stance: your ability criticals deal 15% more damage. Berserker Stance: your auto-attacks are 5% faster. Guarded Stance: a hit that would take at least 20% of your maximum health deals 15% less damage.',
        effect: { global: { stanceMastery: 1 } },
      },
      {
        id: 'war_row_battle_rhythm',
        name: 'Battle Rhythm',
        description: 'Every third ability you use generates 20% more rage.',
        // LIVE: flags the rolling counter in runEffects (every 3rd cast generates more rage).
        effect: { global: { battleRhythm: 1 } },
      },
    ],
  },
  {
    // Tier 5 (level 17): offensive cooldown.
    level: 17,
    options: [
      {
        id: 'war_row_recklessness',
        name: 'Recklessness',
        description:
          'Enrage: increase all your rage generation by 50% and gain 20% additional critical strike chance for 12 sec.',
        // LIVE: grants the enrage (one buff_reckless aura: +20% crit, +50% rage gen).
        effect: { grant: { ability: 'recklessness' } },
      },
      {
        id: 'war_row_avatar',
        name: 'Avatar',
        description:
          'Transform into a colossus for 20 sec, breaking all control on you and increasing your damage dealt by 20%.',
        // LIVE: grants the transform (breakControl + damage amp + colossus scale).
        effect: { grant: { ability: 'avatar' } },
      },
      {
        id: 'war_row_bloodbath',
        name: 'Bloodbath',
        description:
          'Each enemy you kill grants 5% critical strike and 5% damage dealt for 8 sec, stacking up to 25%.',
        // LIVE: the on-kill hook in handleDeath stacks the bloodbath aura from this.
        effect: { global: { bloodbathPct: 0.05 } },
      },
    ],
  },
  {
    // Tier 6 (level 20): capstone.
    level: 20,
    options: [
      {
        id: 'war_row_colossal_might',
        name: 'Colossal Might',
        description:
          'Each point of Rage you spend shaves 0.1 sec off the cooldown of your major offensive abilities, up to 10 sec every 30 sec.',
        // LIVE: spendAbilityCost shaves the big offensive cooldowns per rage
        // spent, capped per rolling window (v0.27.1; see
        // COLOSSAL_MIGHT_CAP_SECONDS in combat/casting_lifecycle.ts).
        effect: { global: { cdrPerRage: 0.1 } },
      },
      {
        id: 'war_row_bladestorm',
        name: 'Bladestorm',
        description:
          'Become a whirling storm of steel, striking all enemies within 8 yards every second for 4 sec.',
        // LIVE: grants the self-centered position channel (the storm follows
        // the caster tick by tick).
        effect: { grant: { ability: 'bladestorm' } },
      },
      {
        id: 'war_row_sanguine_aura',
        name: 'Sanguine Aura',
        description:
          'Imbue your weapon with the blood of your foes. You and your melee allies gain 10% attack speed and 10% damage for 20 sec.',
        // LIVE: grants the war-leader shout (partyMeleeBuff, MELEE_CLASSES filter).
        effect: { grant: { ability: 'sanguine_aura' } },
      },
    ],
  },
];
