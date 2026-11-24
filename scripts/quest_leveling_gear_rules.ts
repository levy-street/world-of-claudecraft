// The shared rules of the choose-one leveling gear generator
// (scripts/quest_leveling_gear_gen.ts): the level bands, the six armor roles, the
// blue quests' themes, which quests are eligible, and which quests rate rare
// (blue) choices. Side-effect free: everything reads the content tables at call
// time, so the generator's reroll mode can strip its own previous output from
// ITEMS and QUESTS first, and tests/quest_leveling_gear_gen.test.ts and
// tests/quest_leveling_gear.test.ts import the same rules the generator runs.

import { PROVING_SHORE_QUESTS } from '../src/sim/content/proving_shore';
import {
  CAMPS,
  DUNGEONS,
  ITEMS,
  MOBS,
  NPCS,
  QUEST_ORDER,
  QUESTS,
  questRewardItem,
  zoneAt,
} from '../src/sim/data';
import { canEquipItem, maxArmorTypeForClass } from '../src/sim/equipment_rules';
import { itemFromRaid, itemSourceLevel } from '../src/sim/item_level';
import {
  isOnRoleForSpec,
  QUEST_REWARD_SPEC_WEIGHTS,
  specStatWeights,
} from '../src/sim/quests/quest_reward_choice';
import type { CoreStats, EquipSlot, ItemDef, PlayerClass, QuestDef } from '../src/sim/types';
import { MAX_LEVEL } from '../src/sim/types';

export type Slot = Extract<
  EquipSlot,
  'helmet' | 'shoulder' | 'chest' | 'waist' | 'legs' | 'gloves' | 'feet'
>;
export const SLOTS: readonly Slot[] = [
  'chest',
  'legs',
  'feet',
  'helmet',
  'gloves',
  'shoulder',
  'waist',
];

export interface Band {
  top: number;
  theme: string;
  region: string;
  palette: string;
}
// Level bands by quest level (the top of each band is inclusive), named for the
// region most of their quests sit in.
export const BANDS: readonly Band[] = [
  {
    top: 5,
    theme: 'Brookwatch',
    region: 'Eastbrook Vale',
    palette: 'militia blue and cream, oiled oak, plain polished iron',
  },
  {
    top: 8,
    theme: 'Hedgerow',
    region: 'the Eastbrook hedges and the Mirefen edge',
    palette: 'hedge green, bramble brown, tanned hide, blackened iron',
  },
  {
    top: 12,
    theme: 'Bogwalker',
    region: 'Mirefen Marsh',
    palette: 'peat brown, moss green, woven reed, verdigris copper',
  },
  {
    top: 16,
    theme: 'Thornspire',
    region: 'Thornpeak Heights',
    palette: 'slate grey, thorn-forged iron, crimson thorn accents, mountain wool',
  },
  {
    top: 18,
    theme: 'Hollowveil',
    region: 'the Veiled Hollow and the Frostveil Reach',
    palette: 'misty violet, frost-white trim, pale silver, dusk blue',
  },
  {
    top: 19,
    theme: 'Trailwarden',
    region: 'the frontier trails',
    palette: 'travel-worn umber, bronze buckles, deep teal',
  },
  {
    top: MAX_LEVEL,
    theme: 'Highgale',
    region: 'the Galecrest and the outer reaches',
    palette: 'storm blue, gilded trim, wind-swept cloth, bright steel',
  },
];

// The themes of the blue quests' rares, one per quest (a quest that authors a blue
// and has no theme here stops the run). Named for the quest's boss or place but
// never echoing its authored piece, so the two cards read apart.
export const BLUE_THEMES: Readonly<Record<string, Band>> = {
  q_hollow: {
    top: 0,
    theme: 'Cryptbound',
    region: 'the Hollow Crypt, where Morthen raised the dead',
    palette: 'grave-dust grey, bone white, tarnished bronze, sickly green candle glow',
  },
  q_sexton: {
    top: 0,
    theme: 'Gravebell',
    region: 'the Hollow Crypt bell tower of Sexton Marrow',
    palette: 'bell bronze, funeral black, verdigris, pale bone',
  },
  q_olen: {
    top: 0,
    theme: 'Oathbroken',
    region: 'the Sunken Bastion of the fallen Knight-Commander Olen',
    palette: 'drowned steel, kelp green, tarnished silver, faded knightly blue',
  },
  q_mistcaller: {
    top: 0,
    theme: 'Seamist',
    region: 'the fog-bound halls of the Sunken Bastion',
    palette: 'sea-mist grey, pearl white, deep teal, wet silver',
  },
  q_drogmar: {
    top: 0,
    theme: 'Warmonger',
    region: "Warlord Drogmar's ogre war camp",
    palette: 'blood red war paint, rough iron, crude bone, scorched hide',
  },
  q_kazzix: {
    top: 0,
    theme: 'Sparkglass',
    region: 'the crystal lair of Kazzix the Shardlord',
    palette: 'electric violet crystal, storm grey, crackling blue light',
  },
  q_korgath: {
    top: 0,
    theme: 'Fetterbound',
    region: 'the Gravewyrm Sanctum, where Korgath was bound',
    palette: 'black iron fetters, ember orange runes, ash grey',
  },
  q_velkhar: {
    top: 0,
    theme: 'Shroudcaller',
    region: 'the necromancer halls of the Gravewyrm Sanctum',
    palette: 'necrotic purple, black velvet, bone ivory, ghostly green',
  },
  q_gravewyrm: {
    top: 0,
    theme: 'Wyrmshadow',
    region: 'the Gravewyrm Sanctum, lair of Korzul',
    palette: 'bleached dragon bone, dark scale green, gold-ringed spikes',
  },
  q_silence_the_choir: {
    top: 0,
    theme: 'Stillhymn',
    region: 'the Drowned Temple choir of Choirmother Selthe',
    palette: 'sunken marble, deep sea blue, pearl, faded gold leaf',
  },
  q_drowned_moon: {
    top: 0,
    theme: 'Pearlglow',
    region: 'the moonlit sanctum of the Drowned Temple',
    palette: 'moonlit silver, abyssal blue, luminous pale aqua, pearl',
  },
  q_seal_restored: {
    top: 0,
    theme: 'Sealkeeper',
    region: 'the restored warden seal',
    palette: 'warden green, gold runes, ancient stone grey',
  },
  q_dk_matriarch_of_the_maw: {
    top: 0,
    theme: 'Cinderbrood',
    region: 'the lair of the Maw Matriarch',
    palette: 'molten ember red, obsidian black, smouldering orange scales',
  },
  q_fv_frostmane_tyrant: {
    top: 0,
    theme: 'Hoarfrost',
    region: "the Rimemane Tyrant's frozen den",
    palette: 'glacier blue, white fur, hoarfrost silver',
  },
  q_af_the_meredark: {
    top: 0,
    theme: 'Blackmere',
    region: 'the black waters of the Meredark',
    palette: 'inky black water, bog green glow, tarnished pewter',
  },
  q_wf_croakers_hush: {
    top: 0,
    theme: 'Reedhush',
    region: "the Croaker's reed ponds",
    palette: 'reed green, lotus pink, pond-water blue',
  },
  q_nb_the_barrow_king: {
    top: 0,
    theme: 'Cairnking',
    region: 'the barrow of the Barrow King',
    palette: 'ancient gold, grave moss, cold blue spectral light',
  },
  q_ww_horn_of_the_huntsman: {
    top: 0,
    theme: 'Palehunt',
    region: 'the woods of the Pale Huntsman',
    palette: 'ghost pale white, antler bone, dark forest green',
  },
  q_pr_idol_guardian: {
    top: 0,
    theme: 'Jadeshrine',
    region: 'the shrine of the sunken idol',
    palette: 'jade green, sun-gold, carved temple stone',
  },
  q_eg_bull_of_the_court: {
    top: 0,
    theme: 'Gildhedge',
    region: 'the topiary Fountain Court',
    palette: 'clipped hedge green, marble white, fountain blue, gilt',
  },
  q_gc_the_wreck_warden: {
    top: 0,
    theme: 'Saltwrack',
    region: 'the shipwreck graveyard of the Wreck Warden',
    palette: 'barnacled driftwood, rusted anchor iron, sea-salt white',
  },
  q_fs_the_great_break: {
    top: 0,
    theme: 'Breakwater',
    region: 'the shattered coast of the Great Break',
    palette: 'storm-wet slate, sea-foam white, cracked stone',
  },
};

export interface Role {
  key: string;
  armorType: 'cloth' | 'leather' | 'mail';
  profile: Partial<CoreStats>;
  nouns: Record<Slot, string>;
  look: string;
}
export const ROLES: readonly Role[] = [
  {
    key: 'cloth',
    armorType: 'cloth',
    profile: { int: 3, spi: 1 },
    nouns: {
      helmet: 'Hood',
      shoulder: 'Mantle',
      chest: 'Robe',
      waist: 'Sash',
      legs: 'Leggings',
      gloves: 'Gloves',
      feet: 'Slippers',
    },
    look: 'woven cloth caster garment with stitched trim',
  },
  {
    key: 'leather',
    armorType: 'leather',
    profile: { agi: 3, sta: 1 },
    nouns: {
      helmet: 'Cap',
      shoulder: 'Shoulderpads',
      chest: 'Jerkin',
      waist: 'Belt',
      legs: 'Breeches',
      gloves: 'Grips',
      feet: 'Boots',
    },
    look: 'supple tooled leather with stitched seams and buckles',
  },
  {
    // Feral druids (cat AP is 2 per Strength) and rogues (Strength and Agility
    // both feed AP); measured: +30 Strength is +23 DPS for a level 20 cat,
    // +30 Agility nothing.
    key: 'leather_str',
    armorType: 'leather',
    profile: { str: 3, agi: 1, sta: 1 },
    nouns: {
      helmet: 'Headguard',
      shoulder: 'Shoulderguards',
      chest: 'Tunic',
      waist: 'Waistguard',
      legs: 'Legwraps',
      gloves: 'Handwraps',
      feet: 'Treads',
    },
    look: 'thick hardened leather with riveted studs and heavy stitching',
  },
  {
    key: 'mail_str',
    armorType: 'mail',
    profile: { str: 3, agi: 1, sta: 1 },
    nouns: {
      helmet: 'Helm',
      shoulder: 'Pauldrons',
      chest: 'Hauberk',
      waist: 'Girdle',
      legs: 'Legguards',
      gloves: 'Gauntlets',
      feet: 'Sabatons',
    },
    look: 'heavy riveted chain mail with leather backing and steel plates',
  },
  {
    key: 'mail_int',
    armorType: 'mail',
    profile: { int: 3, spi: 1 },
    nouns: {
      helmet: 'Coif',
      shoulder: 'Spaulders',
      chest: 'Chainmail',
      waist: 'Cord',
      legs: 'Chausses',
      gloves: 'Handguards',
      feet: 'Greaves',
    },
    look: 'fine light chain mail over a cloth lining, with a small engraved focus stone',
  },
  {
    // Balance and restoration druids: Intellect in the heaviest armor a druid
    // wears (mail is beyond them), the leather twin of the mail caster set.
    key: 'leather_int',
    armorType: 'leather',
    profile: { int: 3, spi: 1 },
    nouns: {
      helmet: 'Cowl',
      shoulder: 'Epaulets',
      chest: 'Vest',
      waist: 'Cinch',
      legs: 'Trousers',
      gloves: 'Mitts',
      feet: 'Moccasins',
    },
    look: 'soft supple leather with embroidered vine and leaf motifs and a small carved wooden charm',
  },
];

// ---------------------------------------------------------------------------
// Quest levels and eligibility
// ---------------------------------------------------------------------------

let raidMobCache: Set<string> | null = null;
function raidMobs(): Set<string> {
  if (raidMobCache) return raidMobCache;
  raidMobCache = new Set<string>();
  for (const dungeon of Object.values(DUNGEONS)) {
    if (dungeon.suggestedPlayers >= 10) for (const s of dungeon.spawns) raidMobCache.add(s.mobId);
  }
  return raidMobCache;
}

// The level item_level.ts prices this quest's rewards at, or undefined when the
// quest has no concrete source (a talk or delivery quest).
export function sourceLevel(q: QuestDef): number | undefined {
  let lvl: number | undefined;
  const consider = (l: number | undefined) => {
    if (l !== undefined && (lvl === undefined || l > lvl)) lvl = l;
  };
  for (const o of q.objectives) {
    if (o.type === 'kill') consider(MOBS[o.targetMobId]?.maxLevel);
    else if (o.type === 'collect') consider(itemSourceLevel(o.itemId));
  }
  consider(q.minLevel);
  return lvl;
}

// A raid quest: a kill objective on a raid mob, or a collect objective whose item
// comes from a raid (item_level.ts would price its rewards with the raid bump).
function touchesRaid(q: QuestDef): boolean {
  const raid = raidMobs();
  return q.objectives.some(
    (o) =>
      (o.type === 'kill' && raid.has(o.targetMobId)) ||
      (o.type === 'collect' && itemFromRaid(o.itemId)),
  );
}

let zoneLevelCache: Map<string, number[]> | null = null;
function zoneLevel(q: QuestDef): number {
  if (!zoneLevelCache) {
    zoneLevelCache = new Map<string, number[]>();
    for (const camp of CAMPS) {
      const t = MOBS[camp.mobId];
      if (!t || t.dummy || t.ambient || t.xpMult === 0) continue;
      const z = zoneAt(camp.center.x, camp.center.z).id;
      const list = zoneLevelCache.get(z) ?? [];
      list.push(t.maxLevel);
      zoneLevelCache.set(z, list);
    }
  }
  const npc = NPCS[q.giverNpcId] as { pos?: { x: number; z: number } } | undefined;
  const list = npc?.pos ? zoneLevelCache.get(zoneAt(npc.pos.x, npc.pos.z).id) : undefined;
  if (!list?.length) return 1;
  return [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
}

// The Balgath world-boss encounter steps (the Mirefen muster, PR 4259): the
// summons, the pike drill and the Foreman's put-out eye pay out in the
// encounter's own spoils, not leveling gear (owner call, 2026-10-20).
export const WORLD_BOSS_ENCOUNTER_QUESTS: ReadonlySet<string> = new Set([
  'q_muster_summons',
  'q_muster_pike_drill',
  'q_socketwrights_due',
]);

// The Proving Shore (tutorial island) keeps its own rewards: a reward choice there
// would complicate the tutorial (owner call, 2026-10-07).
export function eligible(q: QuestDef): boolean {
  if (q.retired || q.repeatable) return false;
  if (PROVING_SHORE_QUESTS[q.id]) return false;
  if (WORLD_BOSS_ENCOUNTER_QUESTS.has(q.id)) return false;
  if (touchesRaid(q)) return false;
  const lvl = sourceLevel(q);
  return lvl === undefined || lvl <= MAX_LEVEL;
}

export interface LeveledQuest {
  q: QuestDef;
  level: number;
}
// Every eligible quest with its level, easiest first, then in the authored quest
// order, then by id: the order both modes assign in.
export function eligibleQuests(): LeveledQuest[] {
  const orderIndex = new Map(QUEST_ORDER.map((id, i) => [id, i]));
  return Object.values(QUESTS)
    .filter(eligible)
    .map((q) => ({ q, level: sourceLevel(q) ?? zoneLevel(q) }))
    .sort(
      (a, b) =>
        a.level - b.level ||
        (orderIndex.get(a.q.id) ?? 1e9) - (orderIndex.get(b.q.id) ?? 1e9) ||
        a.q.id.localeCompare(b.q.id),
    );
}

export const bandFor = (level: number): Band =>
  BANDS.find((b) => level <= b.top) ?? BANDS[BANDS.length - 1];

// ---------------------------------------------------------------------------
// Blue quests: elites, bosses, and the quests that already author a blue
// ---------------------------------------------------------------------------

const BLUE_QUALITIES = new Set<ItemDef['quality']>(['rare', 'epic', 'legendary']);
const isBlueGear = (item: ItemDef | undefined): item is ItemDef =>
  item?.slot !== undefined && BLUE_QUALITIES.has(item.quality);
export const authoredBlues = (q: QuestDef): ItemDef[] =>
  [...new Set(Object.values(q.itemRewards))].map((id) => ITEMS[id as string]).filter(isBlueGear);

// An elite or boss quest: a kill objective on a mob flagged elite, boss or world
// boss. The repo's rule is that such a quest pays blue (rare) gear.
export function isEliteOrBossQuest(q: QuestDef): boolean {
  return q.objectives.some((o) => {
    if (o.type !== 'kill') return false;
    const mob = MOBS[o.targetMobId];
    return !!(mob?.elite || mob?.boss || mob?.worldBoss);
  });
}

// The quality a quest's choices are generated at: rare for a quest that already
// authors a blue and for every elite or boss quest, uncommon (green) otherwise.
export function rewardQuality(q: QuestDef): 'rare' | 'uncommon' {
  return authoredBlues(q).length > 0 || isEliteOrBossQuest(q) ? 'rare' : 'uncommon';
}

type MainStat = 'str' | 'agi' | 'int';
function mainStatOf(cls: PlayerClass, spec: string): MainStat {
  const w = specStatWeights(cls, spec);
  return (['str', 'agi', 'int'] as const).reduce((a, b) => ((w[b] ?? 0) > (w[a] ?? 0) ? b : a));
}
const ARMOR_RANK = { cloth: 0, leather: 1, mail: 2 } as const;
// The role a spec levels in: the heaviest armor its class wears among the roles
// built on its main stat (a holy paladin is mail Intellect, a feral druid leather
// Strength), the same pairing the band sets' spec defaults land on.
function roleForSpec(cls: PlayerClass, spec: string): Role {
  const main = mainStatOf(cls, spec);
  const cap = ARMOR_RANK[maxArmorTypeForClass(cls) as keyof typeof ARMOR_RANK] ?? 0;
  const fits = ROLES.filter(
    (r) => (r.profile[main] ?? 0) >= 3 && ARMOR_RANK[r.armorType] <= cap,
  ).sort((a, b) => ARMOR_RANK[b.armorType] - ARMOR_RANK[a.armorType]);
  if (!fits[0]) throw new Error(`no role for ${cls} ${spec}`);
  return fits[0];
}
// A spec is served when its class's authored piece is a blue it can wear, uses
// only stats the spec wants, carries its main stat, and is a weapon or armor of
// the spec's own weight: a cloth Strength mantle does not serve a warrior, nor a
// cloth Intellect robe a balance druid.
function servedByAuthored(q: QuestDef, cls: PlayerClass, spec: string): boolean {
  const id = questRewardItem(q, cls);
  const item = id ? ITEMS[id] : undefined;
  if (!isBlueGear(item)) return false;
  const ownWeight = !item.armorType || item.armorType === roleForSpec(cls, spec).armorType;
  return (
    ownWeight &&
    canEquipItem(cls, item) &&
    isOnRoleForSpec(item, cls, spec) &&
    (item.stats?.[mainStatOf(cls, spec)] ?? 0) > 0
  );
}
// The roles a blue quest's rares must cover: every role whose specs its authored
// blue does not serve (all six on an elite quest that authors no blue).
export function missingRoles(q: QuestDef): Role[] {
  const missing = new Set<Role>();
  for (const cls of Object.keys(QUEST_REWARD_SPEC_WEIGHTS) as PlayerClass[]) {
    for (const spec of Object.keys(QUEST_REWARD_SPEC_WEIGHTS[cls])) {
      if (!servedByAuthored(q, cls, spec)) missing.add(roleForSpec(cls, spec));
    }
  }
  return ROLES.filter((r) => missing.has(r));
}

export const itemId = (band: Band, role: Role, slot: Slot) =>
  `${band.theme}_${role.nouns[slot]}`.toLowerCase().replace(/[^a-z]+/g, '_');
export const itemName = (band: Band, role: Role, slot: Slot) => `${band.theme} ${role.nouns[slot]}`;
export function isArmorSlot(slot: string): slot is Slot {
  return (SLOTS as readonly string[]).includes(slot);
}

// The release's rare tower shield joins this quest on the integration branch.
// Reuse the existing undead-themed level-23 set for all six armor roles. Its
// higher source remains authoritative, so this adds no items or stat changes.
export const REUSED_RARE_CHOICES: Readonly<Record<string, readonly string[]>> = {
  q_revenants: [
    'cairnking_mantle',
    'cairnking_shoulderpads',
    'cairnking_shoulderguards',
    'cairnking_pauldrons',
    'cairnking_spaulders',
    'cairnking_epaulets',
  ],
};
