// The Demon Tower bestiary: eight wave demons plus the two bosses.
//
// These MUST be static entries in the merged MOBS table, because per-tick mob
// mechanics are read from MOBS[entity.templateId] (src/sim/mob/locomotion.ts).
// The tower's escalation comes from rift/tower_scaling.ts multiplying these
// baselines per floor, NEVER from spawning ad-hoc templates.
//
// The roster is ordered weakest to strongest (DEMON_TOWER_ROSTER in
// rift/tower_waves.ts slides a two-wide window up it as the raid climbs), so the
// stat lines below ascend in lockstep with that order and each tier adds one
// readable threat on top of the previous:
//
//   cinder whelp   fast, fragile, arrives in numbers
//   hellhound      pack rusher, bleeds on hit
//   pact reaver    cleaver, punishes stacking
//   brimstone zeal. brands its target so the rest of the wave hits harder
//   soulbinder     healer, must be focused or the wave never dies
//   iron defiler   armored wall, slows the clear
//   abyss knight   knockback + heavy hits, breaks formations
//   dread harbing. rot and fear, the summit's baseline threat
//
// Level band note (same rule as ../rift/mobs.ts): rift spawn levels come from
// rift/ranks.ts riftFloorLevel, so the bands here are metadata for
// item_level.buildSourceIndex and the deeds creditable-level analysis, not a
// spawn range. They match the rest of the rift content so the tower stays inside
// one itemisation envelope.
//
// Data-as-code: declarative tables only, no logic.

import type { LootEntry, MobTemplate } from '../../types';
import { RIFT_ESSENCE_ITEM_ID } from './items';

const MIN_LEVEL = 18;
const MAX_LEVEL = 23;

/** Wave-demon loot. The tower pays in Rift Essence rather than a per-demon rare:
 * a floor sends up to 14 at a time, so a rare roll per body would flood the
 * economy. The chase items ride the two bosses instead. */
const demonLoot = (copper: number): LootEntry[] => [
  { copper, chance: 1 },
  { itemId: RIFT_ESSENCE_ITEM_ID, chance: 0.04 },
];

const WAVE_DEMONS: Record<string, MobTemplate> = {
  tower_imp: {
    id: 'tower_imp',
    name: 'Cinder Whelp',
    minLevel: MIN_LEVEL,
    maxLevel: MAX_LEVEL,
    family: 'demon',
    hpBase: 30,
    hpPerLevel: 11,
    dmgBase: 7,
    dmgPerLevel: 1.8,
    attackSpeed: 1.6,
    armorPerLevel: 8,
    moveSpeed: 8,
    aggroRadius: 15,
    loot: demonLoot(70),
    scale: 0.8,
    color: 0xd94f2a,
  },
  tower_hellhound: {
    id: 'tower_hellhound',
    name: 'Hellhound',
    minLevel: MIN_LEVEL,
    maxLevel: MAX_LEVEL,
    family: 'demon',
    hpBase: 42,
    hpPerLevel: 15,
    dmgBase: 9,
    dmgPerLevel: 2.2,
    attackSpeed: 1.9,
    armorPerLevel: 12,
    moveSpeed: 8.6,
    aggroRadius: 16,
    loot: demonLoot(90),
    scale: 1.05,
    color: 0x8f2417,
    bleed: { chance: 0.3, perTick: 6, interval: 2, duration: 8, name: 'Rending Fangs' },
  },
  tower_pact_reaver: {
    id: 'tower_pact_reaver',
    name: 'Pact Reaver',
    minLevel: MIN_LEVEL,
    maxLevel: MAX_LEVEL,
    family: 'demon',
    elite: true,
    hpBase: 58,
    hpPerLevel: 21,
    dmgBase: 11,
    dmgPerLevel: 2.6,
    attackSpeed: 2.3,
    armorPerLevel: 18,
    moveSpeed: 7,
    aggroRadius: 14,
    loot: demonLoot(120),
    scale: 1.2,
    color: 0xb03a1e,
    // Punishes a stacked raid: spread or eat the sweep.
    cleave: { radius: 7, mult: 0.55, name: 'Reaving Sweep' },
  },
  tower_brimstone_zealot: {
    id: 'tower_brimstone_zealot',
    name: 'Brimstone Zealot',
    minLevel: MIN_LEVEL,
    maxLevel: MAX_LEVEL,
    family: 'demon',
    elite: true,
    hpBase: 52,
    hpPerLevel: 19,
    dmgBase: 12,
    dmgPerLevel: 2.9,
    attackSpeed: 2.6,
    armorPerLevel: 14,
    moveSpeed: 6.6,
    aggroRadius: 22,
    loot: demonLoot(130),
    scale: 1.1,
    color: 0xe0742a,
    // Marks its target so the rest of the wave hits harder: the first demon that
    // makes the raid care which one it is standing next to.
    expose: { chance: 0.25, dmgIncrease: 0.15, duration: 8, name: 'Brand of Ruin' },
    smolder: { chance: 0.22, perTick: 8, interval: 2, duration: 8, name: 'Cinderburn' },
  },
  tower_soulbinder: {
    id: 'tower_soulbinder',
    name: 'Soulbinder',
    minLevel: MIN_LEVEL,
    maxLevel: MAX_LEVEL,
    family: 'demon',
    elite: true,
    hpBase: 60,
    hpPerLevel: 22,
    dmgBase: 10,
    dmgPerLevel: 2.4,
    attackSpeed: 2.4,
    armorPerLevel: 16,
    moveSpeed: 7,
    aggroRadius: 18,
    loot: demonLoot(150),
    scale: 1.15,
    color: 0x7d2ad9,
    // The wave will not die until this one does: the first real target-priority
    // demand the tower makes of a raid.
    mendAlly: { healMin: 55, healMax: 85, radius: 18, every: 6, name: 'Bind Soul' },
  },
  tower_iron_defiler: {
    id: 'tower_iron_defiler',
    name: 'Iron Defiler',
    minLevel: MIN_LEVEL,
    maxLevel: MAX_LEVEL,
    family: 'demon',
    elite: true,
    hpBase: 96,
    hpPerLevel: 34,
    dmgBase: 13,
    dmgPerLevel: 3,
    attackSpeed: 3,
    armorPerLevel: 40,
    moveSpeed: 6.2,
    aggroRadius: 15,
    loot: demonLoot(180),
    scale: 1.45,
    color: 0x6b6f78,
    // A wall: heavily armored, and it hardens further mid-wave.
    stoneskin: { amount: 420, every: 14, duration: 6, name: 'Iron Rite' },
  },
  tower_abyss_knight: {
    id: 'tower_abyss_knight',
    name: 'Abyss Knight',
    minLevel: MIN_LEVEL,
    maxLevel: MAX_LEVEL,
    family: 'demon',
    elite: true,
    hpBase: 110,
    hpPerLevel: 38,
    dmgBase: 16,
    dmgPerLevel: 3.6,
    attackSpeed: 2.8,
    armorPerLevel: 30,
    moveSpeed: 7.2,
    aggroRadius: 17,
    loot: demonLoot(220),
    scale: 1.55,
    color: 0x3b2a6b,
    cleave: { radius: 8, mult: 0.6, name: 'Abyssal Arc' },
    // Breaks a formation apart right when the arena is at its tightest.
    knockback: { chance: 0.22, distance: 6, name: 'Void Shove' },
  },
  tower_dread_harbinger: {
    id: 'tower_dread_harbinger',
    name: 'Dread Harbinger',
    minLevel: MIN_LEVEL,
    maxLevel: MAX_LEVEL,
    family: 'demon',
    elite: true,
    hpBase: 124,
    hpPerLevel: 42,
    dmgBase: 18,
    dmgPerLevel: 4.1,
    attackSpeed: 2.7,
    armorPerLevel: 26,
    moveSpeed: 7,
    aggroRadius: 20,
    loot: demonLoot(260),
    scale: 1.6,
    color: 0x9b1f4d,
    soulrot: { chance: 0.3, perTick: 11, interval: 2, duration: 10, name: 'Withering Dread' },
    terrify: { every: 18, radius: 10, duration: 2, name: 'Toll of Dread' },
  },
};

const TOWER_BOSSES: Record<string, MobTemplate> = {
  // Floor 5. The gate: a raid that cannot handle him has no business climbing
  // higher, so he is the tower's honest difficulty check rather than its climax.
  tower_boss_gatekeeper: {
    id: 'tower_boss_gatekeeper',
    name: "Vaskar, the Gate's Warden",
    minLevel: MIN_LEVEL,
    maxLevel: MAX_LEVEL,
    family: 'demon',
    elite: true,
    boss: true,
    ccImmune: true,
    slowImmune: true,
    hpBase: 720,
    hpPerLevel: 62,
    dmgBase: 17,
    dmgPerLevel: 3.4,
    attackSpeed: 2.6,
    armorPerLevel: 30,
    moveSpeed: 7,
    aggroRadius: 20,
    loot: [
      { copper: 4200, chance: 1 },
      { itemId: 'pactbound_vestments', chance: 0.25 },
      { itemId: RIFT_ESSENCE_ITEM_ID, chance: 1 },
      { itemId: RIFT_ESSENCE_ITEM_ID, chance: 0.6 },
    ],
    scale: 2.7,
    color: 0xc2431a,
    stomp: { radius: 11, every: 12, duration: 1.4, min: 20, max: 30, name: 'Warden the Gate' },
    aoePulse: {
      min: 15,
      max: 24,
      radius: 12,
      every: 10,
      name: 'Chainfire',
      school: 'fire',
      fx: 'nova',
    },
    summonAdds: { mobId: 'tower_imp', count: 4, atHpPct: [0.65, 0.35] },
    knockback: { chance: 0.2, distance: 7, name: 'Gate Slam' },
    rankMechanics: ['stomp', 'aoePulse', 'summonAdds', 'knockback'],
    enrage: { belowHpPct: 0.3, dmgMult: 1.45, hasteMult: 1.25 },
    yells: {
      engage: 'The tower does not open for the likes of you.',
      enrage: 'THEN CLIMB OVER MY CORPSE!',
    },
  },
  // Floor 10. The summit, and the hardest single encounter in the game: a
  // telegraphed lethal zone on top of the full pressure kit, at 10.6x health.
  tower_boss_demon_lord: {
    id: 'tower_boss_demon_lord',
    name: 'Malgrath, the Tower Unbound',
    minLevel: MIN_LEVEL,
    maxLevel: MAX_LEVEL,
    family: 'demon',
    elite: true,
    boss: true,
    ccImmune: true,
    slowImmune: true,
    hpBase: 980,
    hpPerLevel: 84,
    dmgBase: 21,
    dmgPerLevel: 4,
    attackSpeed: 2.8,
    armorPerLevel: 36,
    moveSpeed: 7,
    aggroRadius: 22,
    loot: [
      { copper: 9000, chance: 1 },
      { itemId: 'pitlords_cleaver', chance: 0.45 },
      { itemId: 'pactbound_vestments', chance: 0.25 },
      { itemId: RIFT_ESSENCE_ITEM_ID, chance: 1 },
      { itemId: RIFT_ESSENCE_ITEM_ID, chance: 1 },
      { itemId: RIFT_ESSENCE_ITEM_ID, chance: 1 },
    ],
    scale: 3.3,
    color: 0xff2d6a,
    bigCast: {
      castId: 'tower_unmaking',
      name: 'The Unmaking',
      castTime: 3.2,
      every: 16,
      radius: 13,
      min: 34,
      max: 50,
      school: 'shadow',
      yell: 'THE TOWER ENDS WITH YOU.',
    },
    // The lethal telegraph: dodgeable by construction, unforgiving if ignored.
    deathZoneCast: {
      castId: 'tower_rift_collapse',
      name: 'Rift Collapse',
      castTime: 2.4,
      every: 14,
      radius: 9,
      school: 'shadow',
      yell: 'The floor beneath you forgets it was ever there.',
      detonateText: 'Rift Collapse detonates!',
    },
    stomp: { radius: 12, every: 12, duration: 1.6, min: 26, max: 38, name: 'Sunder the Spire' },
    summonAdds: { mobId: 'tower_imp', count: 5, atHpPct: [0.75, 0.5, 0.25] },
    aoePulse: {
      min: 20,
      max: 32,
      radius: 13,
      every: 9,
      name: 'Unbound Nova',
      school: 'shadow',
      fx: 'nova',
    },
    rankMechanics: ['bigCast', 'deathZoneCast', 'stomp', 'summonAdds'],
    enrage: { belowHpPct: 0.25, dmgMult: 1.6, hasteMult: 1.35 },
    yells: {
      engage: 'Ten floors of the faithful died where you stand.',
      enrage: 'I AM THE TOWER!',
    },
  },
};

export const TOWER_MOBS: Record<string, MobTemplate> = {
  ...WAVE_DEMONS,
  ...TOWER_BOSSES,
};

/** Every Demon Tower wave-demon template id, in roster order. */
export const TOWER_WAVE_MOB_IDS = Object.keys(WAVE_DEMONS);
/** The two Demon Tower boss template ids. */
export const TOWER_BOSS_IDS = Object.keys(TOWER_BOSSES);
