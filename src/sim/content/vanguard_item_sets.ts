// Warfare Season 2 ("Vanguard") set rows: one five-piece set per spec, the raid
// sets' 2/4 thresholds. Built once with the items (content/pvp_honor_season2.ts)
// from docs/design/warfare-season-2.md and maintained by hand since. The effect
// stays empty here, like the Ignivar raid sets: the engine payloads live in
// content/vanguard_set_bonuses.ts and reach the Sim through set_bonus_mods.ts.
// The text is the tooltip source.

import type { ItemSet } from '../types';

export const VANGUARD_ITEM_SETS: Record<string, ItemSet> = {
  vanguard_warrior_arms: {
    id: 'vanguard_warrior_arms',
    name: 'Bladewake Battlegear',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        text: "Maiming Strike reduces Onrush's remaining cooldown by 1 sec.",
      },
      {
        pieces: 4,
        effect: {},
        text: "Onrush also empowers your next Maiming Strike by 20 percent (one stack of Redhand's empower).",
      },
    ],
  },
  vanguard_warrior_fury: {
    id: 'vanguard_warrior_fury',
    name: 'Bloodmarch Ragegear',
    bonuses: [
      { pieces: 2, effect: {}, text: "Vaulting Charge's cooldown is reduced by 8 sec." },
      { pieces: 4, effect: {}, text: 'Landing Vaulting Charge Enrages you.' },
    ],
  },
  vanguard_warrior_prot: {
    id: 'vanguard_warrior_prot',
    name: 'Ironmarch Bulwark',
    bonuses: [
      { pieces: 2, effect: {}, text: "Faultline's cooldown is reduced by 5 sec." },
      {
        pieces: 4,
        effect: {},
        text: 'Faultline also reduces damage you take by 10 percent for 6 sec.',
      },
    ],
  },
  vanguard_paladin_holy: {
    id: 'vanguard_paladin_holy',
    name: 'Sunvigil Regalia',
    bonuses: [
      { pieces: 2, effect: {}, text: "Life Covenant's cooldown is reduced by 30 sec." },
      {
        pieces: 4,
        effect: {},
        text: 'Life Covenant also shields the ally for 8 percent of their maximum health for 6 sec.',
      },
    ],
  },
  vanguard_paladin_protection: {
    id: 'vanguard_paladin_protection',
    name: 'Shieldvow Bastion',
    bonuses: [
      { pieces: 2, effect: {}, text: "Oath Chain's cooldown is reduced by 2 sec." },
      {
        pieces: 4,
        effect: {},
        text: 'Enemies pulled by Oath Chain cast spells 30 percent slower for 4 sec, and Oath Chain grants you Solar Reprisal when it binds an enemy that can be pulled.',
      },
    ],
  },
  vanguard_paladin_retribution: {
    id: 'vanguard_paladin_retribution',
    name: 'Lightbrand Warplate',
    bonuses: [
      { pieces: 2, effect: {}, text: "Valkyr's Calling's cooldown is reduced by 15 sec." },
      {
        pieces: 4,
        effect: {},
        text: "Valkyr's Calling resets Final Edict's cooldown, and your next Final Edict within 6 sec of landing deals 15 percent more damage.",
      },
    ],
  },
  vanguard_hunter_beast_mastery: {
    id: 'vanguard_hunter_beast_mastery',
    name: 'Packwarden Harness',
    bonuses: [
      { pieces: 2, effect: {}, text: "Rattling Shot's cooldown is reduced by 4 sec." },
      {
        pieces: 4,
        effect: {},
        text: "Rattling Shot reduces Howling Rage's remaining cooldown by 1 sec.",
      },
    ],
  },
  vanguard_hunter_marksmanship: {
    id: 'vanguard_hunter_marksmanship',
    name: 'Farsight Harness',
    bonuses: [
      { pieces: 2, effect: {}, text: "Trailbreak's cooldown is reduced by 4 sec." },
      {
        pieces: 4,
        effect: {},
        text: 'Trailbreak makes your next Long Draw within 6 sec instant. Cannot occur more than once every 15 sec.',
      },
    ],
  },
  vanguard_hunter_survival: {
    id: 'vanguard_hunter_survival',
    name: 'Snaretooth Harness',
    bonuses: [
      { pieces: 2, effect: {}, text: "Bloodhook's cooldown is reduced by 3 sec." },
      { pieces: 4, effect: {}, text: 'Bloodhook grants 1 Hunting Momentum.' },
    ],
  },
  vanguard_rogue_assassination: {
    id: 'vanguard_rogue_assassination',
    name: 'Nightcut Leathers',
    bonuses: [
      { pieces: 2, effect: {}, text: 'Low Blow costs 10 less Energy.' },
      {
        pieces: 4,
        effect: {},
        text: 'Low Blow also makes your next attack within 6 sec a critical strike.',
      },
    ],
  },
  vanguard_rogue_combat: {
    id: 'vanguard_rogue_combat',
    name: 'Brawlmark Leathers',
    bonuses: [
      { pieces: 2, effect: {}, text: "Swift Heels' cooldown is reduced by 60 sec." },
      {
        pieces: 4,
        effect: {},
        text: 'While Swift Heels is active, Wicked Slash and Haymaker award 1 additional combo point.',
      },
    ],
  },
  vanguard_rogue_subtlety: {
    id: 'vanguard_rogue_subtlety',
    name: 'Shadewalk Leathers',
    bonuses: [
      { pieces: 2, effect: {}, text: "Smokefade's cooldown is reduced by 60 sec." },
      {
        pieces: 4,
        effect: {},
        text: 'Gut Punch awards 2 additional combo points when used from Smokefade.',
      },
    ],
  },
  vanguard_priest_discipline: {
    id: 'vanguard_priest_discipline',
    name: 'Veilpsalm Raiment',
    bonuses: [
      { pieces: 2, effect: {}, text: "Terror Canticle's cooldown is reduced by 3 sec." },
      {
        pieces: 4,
        effect: {},
        text: 'When your Psalm of Warding is fully consumed, the shielded ally gains 20 percent movement speed for 3 sec. Cannot occur more than once every 8 sec.',
      },
    ],
  },
  vanguard_priest_holy: {
    id: 'vanguard_priest_holy',
    name: 'Gracewing Raiment',
    bonuses: [
      { pieces: 2, effect: {}, text: "Veilstep's cooldown is reduced by 6 sec." },
      {
        pieces: 4,
        effect: {},
        text: 'Veilstep also shields you for 8 percent of your maximum health for 6 sec.',
      },
    ],
  },
  vanguard_priest_shadow: {
    id: 'vanguard_priest_shadow',
    name: 'Duskhymn Regalia',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        text: "Litany of Woe also slows the target's movement by 30 percent while you channel it.",
      },
      {
        pieces: 4,
        effect: {},
        text: 'Call Tithefiend also shields you for 10 percent of your maximum health for 8 sec.',
      },
    ],
  },
  vanguard_shaman_elemental: {
    id: 'vanguard_shaman_elemental',
    name: 'Tempestwrit Battlemail',
    bonuses: [
      { pieces: 2, effect: {}, text: "Unleash Weapon's cooldown is reduced by 3 sec." },
      {
        pieces: 4,
        effect: {},
        text: 'Unleash Weapon lets you cast while moving and increases your movement speed by 20 percent for 4 sec. Cannot occur more than once every 20 sec.',
      },
    ],
  },
  vanguard_shaman_enhancement: {
    id: 'vanguard_shaman_enhancement',
    name: 'Galeborn Warmail',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        text: "Ancestral Strike slows the target's movement speed by 30 percent for 4 sec.",
      },
      {
        pieces: 4,
        effect: {},
        text: 'Ancestral Strike reduces the remaining cooldown of Elemental Trance by 4 sec.',
      },
    ],
  },
  vanguard_shaman_restoration: {
    id: 'vanguard_shaman_restoration',
    name: 'Brineward Chainmail',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        text: 'Mending Waters casts 0.5 sec faster on an ally below 50 percent health.',
      },
      {
        pieces: 4,
        effect: {},
        text: 'Tidecall also shields its target for 5 percent of your maximum health for 6 sec.',
      },
    ],
  },
  vanguard_mage_arcane: {
    id: 'vanguard_mage_arcane',
    name: "Hourbinder's Vestments",
    bonuses: [
      { pieces: 2, effect: {}, text: "Temporal Barrier's cooldown is reduced by 2 sec." },
      {
        pieces: 4,
        effect: {},
        text: "Temporal Barrier also increases the shielded target's movement speed by 20 percent for 3 sec.",
      },
    ],
  },
  vanguard_mage_fire: {
    id: 'vanguard_mage_fire',
    name: 'Emberlash Regalia',
    bonuses: [
      { pieces: 2, effect: {}, text: 'Cinderfall recharges 3 sec faster.' },
      {
        pieces: 4,
        effect: {},
        text: 'Casting Cinderfall reduces the remaining cooldown of Blazing Barrier by 2 sec.',
      },
    ],
  },
  vanguard_mage_frost: {
    id: 'vanguard_mage_frost',
    name: 'Rimewarden Garb',
    bonuses: [
      { pieces: 2, effect: {}, text: "Icebind's cooldown is reduced by 2 sec." },
      {
        pieces: 4,
        effect: {},
        text: 'Casting Icebind reduces the remaining cooldown of Flitstep by 5 sec.',
      },
    ],
  },
  vanguard_warlock_affliction: {
    id: 'vanguard_warlock_affliction',
    name: 'Dreadquill Vestments',
    bonuses: [
      { pieces: 2, effect: {}, text: "Harrow's cast time is reduced by 0.3 sec." },
      {
        pieces: 4,
        effect: {},
        text: 'Consume heals you for 30 percent more and can be channeled while moving.',
      },
    ],
  },
  vanguard_warlock_demonology: {
    id: 'vanguard_warlock_demonology',
    name: 'Marrowbound Regalia',
    bonuses: [
      { pieces: 2, effect: {}, text: "Bone Armor's cooldown is reduced by 10 sec." },
      {
        pieces: 4,
        effect: {},
        text: 'Reaping Command reduces the remaining cooldown of Bone Armor by 2 sec.',
      },
    ],
  },
  vanguard_warlock_destruction: {
    id: 'vanguard_warlock_destruction',
    name: 'Slagcrown Vestments',
    bonuses: [
      { pieces: 2, effect: {}, text: "Cinderhide's cooldown is reduced by 30 sec." },
      {
        pieces: 4,
        effect: {},
        text: 'Every second Conflagrate makes your next Ruinbolt within 8 sec instant.',
      },
    ],
  },
  vanguard_druid_balance: {
    id: 'vanguard_druid_balance',
    name: 'Starwarden Raiment',
    bonuses: [
      { pieces: 2, effect: {}, text: "Gripping Roots' cast time is reduced by 0.5 sec." },
      {
        pieces: 4,
        effect: {},
        text: 'Casting Gripping Roots lets you cast while moving and increases your movement speed by 20 percent for 4 sec. Cannot occur more than once every 20 sec.',
      },
    ],
  },
  vanguard_druid_feral: {
    id: 'vanguard_druid_feral',
    name: 'Bloodmane Hide',
    bonuses: [
      { pieces: 2, effect: {}, text: "Bruin Rush's cooldown is reduced by 3 sec." },
      {
        pieces: 4,
        effect: {},
        text: 'Bruin Rush shields you for 6 percent of your maximum health for 6 sec.',
      },
    ],
  },
  vanguard_druid_restoration: {
    id: 'vanguard_druid_restoration',
    name: 'Thistlebloom Vestment',
    bonuses: [
      { pieces: 2, effect: {}, text: "Fleetmend's cooldown is reduced by 1 sec." },
      {
        pieces: 4,
        effect: {},
        text: 'Fleetmend also increases your movement speed by 30 percent for 3 sec.',
      },
    ],
  },
};
