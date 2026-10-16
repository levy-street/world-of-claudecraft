// Authoring tool for the choose-one leveling gear: every eligible quest offers a
// six-way choice (cloth caster, leather agility, leather strength, mail strength,
// mail caster, leather caster) of one armor slot, from the set of its level band.
//
// A quest that already rewards a blue (a dungeon boss or an elite, authored per
// reward archetype in QuestDef.itemRewards) offers blues instead: its authored
// piece joins the list (quests/quest_reward_choice.ts), and this tool adds a rare
// for every role whose specs that piece does not serve (a weapon, or an on-role
// piece in the spec's own armor weight carrying its main stat), named for the
// quest, at the quest's own rare item level. Those quests take no green band piece.
//
//   npx tsx scripts/quest_leveling_gear_gen.ts [--prompts <file.json>]
//
// Writes two declarative content tables (re-run after adding quests or changing
// a band, then review the diff):
//   src/sim/content/quest_leveling_gear.ts   the item records, stats baked
//   src/sim/content/quest_choice_rewards.ts  quest id -> its choices
// and, with --prompts, a JSON of per-item icon briefs for the art batch.
//
// Stats are never invented: an item's level is the one src/sim/item_level.ts
// derives from the quests that offer it (their hardest kill or collect source,
// or minLevel), its primary stats are that level's uncommon slot budget put on
// the stamina model (normalizeToStaminaModel), armor is the shipped chest line
// of the armor type times the slot weight, and sell value is the median of the
// shipped greens within a few item levels.

import { writeFileSync } from 'node:fs';
import { PROVING_SHORE_QUESTS } from '../src/sim/content/proving_shore';
import { QUEST_CHOICE_REWARDS } from '../src/sim/content/quest_choice_rewards';
import { QUEST_LEVELING_GEAR_ITEMS } from '../src/sim/content/quest_leveling_gear';
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
import { normalizeToStaminaModel, primaryStatBudget, SLOT_STAT_MULT } from '../src/sim/item_budget';
import {
  itemFromRaid,
  itemLevel,
  itemSourceLevel,
  resetItemLevelCache,
} from '../src/sim/item_level';
import {
  isOnRoleForSpec,
  QUEST_REWARD_SPEC_WEIGHTS,
  specStatWeights,
} from '../src/sim/quests/quest_reward_choice';
import type { CoreStats, EquipSlot, ItemDef, PlayerClass, QuestDef } from '../src/sim/types';
import { MAX_LEVEL } from '../src/sim/types';

// A re-run starts from the shipped catalog WITHOUT this tool's previous output
// (data.ts merges both tables), so ids, names, catalog medians and derived item
// levels never read the items being regenerated.
for (const id of Object.keys(QUEST_LEVELING_GEAR_ITEMS)) delete ITEMS[id];
for (const questId of Object.keys(QUEST_CHOICE_REWARDS)) {
  if (QUESTS[questId]) delete QUESTS[questId].choiceRewards;
}
resetItemLevelCache();

type Slot = Extract<
  EquipSlot,
  'helmet' | 'shoulder' | 'chest' | 'waist' | 'legs' | 'gloves' | 'feet'
>;
const SLOTS: readonly Slot[] = ['chest', 'legs', 'feet', 'helmet', 'gloves', 'shoulder', 'waist'];

interface Band {
  top: number;
  theme: string;
  region: string;
  palette: string;
}
// Level bands by quest level (the top of each band is inclusive), named for the
// region most of their quests sit in.
const BANDS: readonly Band[] = [
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
const BLUE_THEMES: Readonly<Record<string, Band>> = {
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

interface Role {
  key: string;
  armorType: 'cloth' | 'leather' | 'mail';
  profile: Partial<CoreStats>;
  nouns: Record<Slot, string>;
  look: string;
}
const ROLES: readonly Role[] = [
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

const raidMobs = new Set<string>();
for (const dungeon of Object.values(DUNGEONS)) {
  if (dungeon.suggestedPlayers >= 10) for (const s of dungeon.spawns) raidMobs.add(s.mobId);
}

// The level item_level.ts prices this quest's rewards at, or undefined when the
// quest has no concrete source (a talk or delivery quest).
function sourceLevel(q: QuestDef): number | undefined {
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
  return q.objectives.some(
    (o) =>
      (o.type === 'kill' && raidMobs.has(o.targetMobId)) ||
      (o.type === 'collect' && itemFromRaid(o.itemId)),
  );
}

const zoneLevels = new Map<string, number[]>();
for (const camp of CAMPS) {
  const t = MOBS[camp.mobId];
  if (!t || t.dummy || t.ambient || t.xpMult === 0) continue;
  const z = zoneAt(camp.center.x, camp.center.z).id;
  const list = zoneLevels.get(z) ?? [];
  list.push(t.maxLevel);
  zoneLevels.set(z, list);
}
function zoneLevel(q: QuestDef): number {
  const npc = NPCS[q.giverNpcId] as { pos?: { x: number; z: number } } | undefined;
  const list = npc?.pos ? zoneLevels.get(zoneAt(npc.pos.x, npc.pos.z).id) : undefined;
  if (!list?.length) return 1;
  return [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
}

// The Proving Shore (tutorial island) keeps its own rewards: a reward choice there
// would complicate the tutorial (owner call, 2026-10-07).
function eligible(q: QuestDef): boolean {
  if (q.retired || q.repeatable) return false;
  if (PROVING_SHORE_QUESTS[q.id]) return false;
  if (touchesRaid(q)) return false;
  const lvl = sourceLevel(q);
  return lvl === undefined || lvl <= MAX_LEVEL;
}

const orderIndex = new Map(QUEST_ORDER.map((id, i) => [id, i]));
const quests = Object.values(QUESTS)
  .filter(eligible)
  .map((q) => ({ q, level: sourceLevel(q) ?? zoneLevel(q) }))
  .sort(
    (a, b) =>
      a.level - b.level ||
      (orderIndex.get(a.q.id) ?? 1e9) - (orderIndex.get(b.q.id) ?? 1e9) ||
      a.q.id.localeCompare(b.q.id),
  );

// ---------------------------------------------------------------------------
// Blue quests: the roles their authored blue leaves without one
// ---------------------------------------------------------------------------

const BLUE_QUALITIES = new Set<ItemDef['quality']>(['rare', 'epic', 'legendary']);
const isBlueGear = (item: ItemDef | undefined): item is ItemDef =>
  item?.slot !== undefined && BLUE_QUALITIES.has(item.quality);
const authoredBlues = (q: QuestDef): ItemDef[] =>
  [...new Set(Object.values(q.itemRewards))].map((id) => ITEMS[id as string]).filter(isBlueGear);

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
function missingRoles(q: QuestDef): Role[] {
  const missing = new Set<Role>();
  for (const cls of Object.keys(QUEST_REWARD_SPEC_WEIGHTS) as PlayerClass[]) {
    for (const spec of Object.keys(QUEST_REWARD_SPEC_WEIGHTS[cls])) {
      if (!servedByAuthored(q, cls, spec)) missing.add(roleForSpec(cls, spec));
    }
  }
  return ROLES.filter((r) => missing.has(r));
}

// ---------------------------------------------------------------------------
// Assignment: band by level, slot by rotation within the band
// ---------------------------------------------------------------------------

const itemId = (band: Band, role: Role, slot: Slot) =>
  `${band.theme}_${role.nouns[slot]}`.toLowerCase().replace(/[^a-z]+/g, '_');
const itemName = (band: Band, role: Role, slot: Slot) => `${band.theme} ${role.nouns[slot]}`;

// Blue quests offer their own rares: the slot of the authored armor piece, or (a
// weapon-only quest) the next slot of a rotation along the blue quests.
interface BlueSpec {
  questId: string;
  theme: Band;
  roles: Role[];
  slot: Slot;
}
const blueSpecs: BlueSpec[] = [];
let weaponCursor = 0;
for (const { q } of quests) {
  const authored = authoredBlues(q);
  if (authored.length === 0) continue;
  const theme = BLUE_THEMES[q.id];
  if (!theme) throw new Error(`${q.id} rewards a blue but has no BLUE_THEMES entry`);
  const armorSlot = authored
    .filter((i) => i.kind === 'armor')
    .map((i) => i.slot as string)
    .find(isArmorSlot);
  const slot = armorSlot ?? SLOTS[weaponCursor++ % SLOTS.length];
  const roles = missingRoles(q);
  if (roles.length === 0) throw new Error(`${q.id}: its authored blues already serve every spec`);
  blueSpecs.push({ questId: q.id, theme, roles, slot });
}
function isArmorSlot(slot: string): slot is Slot {
  return (SLOTS as readonly string[]).includes(slot);
}
const blueQuestIds = new Set(blueSpecs.map((b) => b.questId));
for (const id of Object.keys(BLUE_THEMES)) {
  if (!blueQuestIds.has(id)) throw new Error(`BLUE_THEMES ${id} is not a blue quest any more`);
}

// Quests with a concrete source take the rotation first, so every slot of every
// band is offered by at least one quest item_level.ts can price (a talk or
// delivery quest has no level of its own); the unsourced quests continue it. A
// blue quest keeps its turn in the rotation but takes no green, so adding or
// removing a blue never reshuffles the other quests' slots.
const sourced = quests.filter(({ q }) => sourceLevel(q) !== undefined);
const unsourced = quests.filter(({ q }) => sourceLevel(q) === undefined);
const assignment = new Map<string, string[]>();
const bandCursor = new Map<Band, number>();
for (const { q, level } of [...sourced, ...unsourced]) {
  const band = BANDS.find((b) => level <= b.top) ?? BANDS[BANDS.length - 1];
  const i = bandCursor.get(band) ?? 0;
  bandCursor.set(band, i + 1);
  if (blueQuestIds.has(q.id)) continue;
  const slot = SLOTS[i % SLOTS.length];
  assignment.set(
    q.id,
    ROLES.map((role) => itemId(band, role, slot)),
  );
}
for (const b of blueSpecs) {
  assignment.set(
    b.questId,
    b.roles.map((role) => itemId(b.theme, role, b.slot)),
  );
}

// ---------------------------------------------------------------------------
// Catalog medians: armor and sell value per item level, by armor type and slot
// ---------------------------------------------------------------------------

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}
interface Peer {
  ilvl: number;
  sellPerSlot: number;
}
// Shipped armor of one quality, the sell-value peers of the pieces built at it.
function peersOf(quality: ItemDef['quality']): Peer[] {
  const pool: Peer[] = [];
  for (const item of Object.values(ITEMS)) {
    if (item.kind !== 'armor' || !item.armorType || !item.slot || item.slot === 'offhand') continue;
    if (item.quality !== quality) continue;
    const ilvl = itemLevel(item);
    if (!ilvl) continue;
    pool.push({
      ilvl,
      sellPerSlot: item.sellValue / (SLOT_STAT_MULT[item.slot] ?? 1),
    });
  }
  return pool;
}
const peersByQuality = new Map<ItemDef['quality'], Peer[]>([
  ['uncommon', peersOf('uncommon')],
  ['rare', peersOf('rare')],
]);
// The median over the shipped peers nearest `ilvl` (within 2 item levels,
// widening by 2 until at least three qualify), so each band reads its own
// level's peers rather than one ratio stretched across the whole range.
function localMedian(pool: Peer[], ilvl: number, pick: (p: Peer) => number): number {
  const values = (radius: number) =>
    pool.filter((p) => Math.abs(p.ilvl - ilvl) <= radius && pick(p) > 0).map(pick);
  for (let radius = 2; radius <= MAX_LEVEL; radius += 2) {
    const near = values(radius);
    if (near.length >= 3) return medianOf(near);
  }
  const all = values(Number.POSITIVE_INFINITY);
  if (all.length === 0) throw new Error('no shipped peers to price against');
  return medianOf(all);
}
// Armor per item level, the content/hoard_loot.ts derivation over the leveling
// window: the median armor/item-level of every shipped CHEST of the armor type
// at item level 24 or below, any quality (10 to 15 pieces per type), times the
// slot weight items.ts documents for armor. The other slots have one to five
// shipped pieces each in that window, too few to keep mail above leather above
// cloth slot by slot.
const LEVELING_ARMOR_WINDOW = 24;
const chestArmorPerIlvl = new Map<string, number>();
for (const armorType of ['cloth', 'leather', 'mail']) {
  const ratios: number[] = [];
  for (const item of Object.values(ITEMS)) {
    if (item.kind !== 'armor' || item.armorType !== armorType || item.slot !== 'chest') continue;
    const ilvl = itemLevel(item);
    const armor = item.stats?.armor ?? 0;
    if (ilvl && ilvl <= LEVELING_ARMOR_WINDOW && armor > 0) ratios.push(armor / ilvl);
  }
  if (ratios.length < 5) throw new Error(`too few shipped ${armorType} chests to price armor`);
  chestArmorPerIlvl.set(armorType, medianOf(ratios));
}
const armorFor = (armorType: string, slot: Slot, ilvl: number) =>
  Math.max(
    1,
    Math.round((chestArmorPerIlvl.get(armorType) ?? 0) * (SLOT_STAT_MULT[slot] ?? 1) * ilvl),
  );
const sellFor = (quality: ItemDef['quality'], slot: Slot, ilvl: number) =>
  Math.max(
    5,
    Math.round(
      localMedian(peersByQuality.get(quality) ?? [], ilvl, (p) => p.sellPerSlot) *
        (SLOT_STAT_MULT[slot] ?? 1),
    ),
  );

// ---------------------------------------------------------------------------
// Items: provisional records, then the real item level, then baked stats
// ---------------------------------------------------------------------------

interface Built {
  id: string;
  band: Band;
  role: Role;
  slot: Slot;
  item: ItemDef;
}
const built: Built[] = [];
for (const band of BANDS) {
  for (const role of ROLES) {
    for (const slot of SLOTS) {
      const id = itemId(band, role, slot);
      if (ITEMS[id]) throw new Error(`item id ${id} already exists`);
      const item = {
        id,
        name: itemName(band, role, slot),
        kind: 'armor',
        armorType: role.armorType,
        slot,
        quality: 'uncommon',
        stats: {},
        sellValue: 0,
      } as ItemDef;
      built.push({ id, band, role, slot, item });
    }
  }
}
for (const b of blueSpecs) {
  for (const role of b.roles) {
    const id = itemId(b.theme, role, b.slot);
    if (ITEMS[id] || built.some((x) => x.id === id))
      throw new Error(`item id ${id} already exists`);
    const item = {
      id,
      name: itemName(b.theme, role, b.slot),
      kind: 'armor',
      armorType: role.armorType,
      slot: b.slot,
      quality: 'rare',
      stats: {},
      sellValue: 0,
    } as ItemDef;
    built.push({ id, band: b.theme, role, slot: b.slot, item });
  }
}
const names = new Set(Object.values(ITEMS).map((i) => i.name.toLowerCase()));
for (const b of built) {
  if (names.has(b.item.name.toLowerCase()))
    throw new Error(`item name ${b.item.name} already exists`);
}

// Register provisionally and offer them, so item_level derives the real levels.
for (const b of built) ITEMS[b.id] = b.item;
for (const [questId, ids] of assignment) QUESTS[questId].choiceRewards = ids;
resetItemLevelCache();

const unpriced: string[] = [];
for (const b of built) {
  const offered = [...assignment.values()].some((ids) => ids.includes(b.id));
  if (!offered) throw new Error(`${b.id} is offered by no quest`);
  let ilvl = itemLevel(b.item);
  if (ilvl === undefined) {
    unpriced.push(b.id);
    ilvl = b.band.top + 1;
  }
  const budget = primaryStatBudget(ilvl, b.item.quality, b.slot);
  b.item.stats = {
    ...normalizeToStaminaModel(b.role.profile, budget),
    armor: armorFor(b.role.armorType, b.slot, ilvl),
  };
  b.item.sellValue = sellFor(b.item.quality, b.slot, ilvl);
  (b.item as ItemDef & { _ilvl?: number; _budget?: number })._ilvl = ilvl;
  (b.item as ItemDef & { _ilvl?: number; _budget?: number })._budget = budget;
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

const statOrder = ['armor', 'str', 'agi', 'sta', 'int', 'spi'] as const;
const statsLiteral = (s: Partial<CoreStats>) =>
  `{ ${statOrder
    .filter((k) => (s[k] ?? 0) > 0)
    .map((k) => `${k}: ${s[k]}`)
    .join(', ')} }`;

let items = `// Choose-one leveling gear: the six-way armor choice every leveling quest
// offers (content/quest_choice_rewards.ts). One green set per level band and
// armor role (cloth caster, leather agility, leather strength, mail strength,
// mail caster, leather caster) in every armor slot, plus the rares a quest that
// already rewards a blue offers to the roles its authored piece does not serve.
//
// Generated by scripts/quest_leveling_gear_gen.ts: re-run it rather than editing
// a record by hand. Each item's level is the one src/sim/item_level.ts derives
// from the quests that offer it; its stats are that level's slot budget for its
// quality on the stamina model, and its armor and sell value the catalog median.

import type { ItemDef } from '../types';

export const QUEST_LEVELING_GEAR_ITEMS: Record<string, ItemDef> = {
`;
for (const b of built) {
  const ext = b.item as ItemDef & { _ilvl: number; _budget: number };
  items += `  // ${b.band.theme} (${b.band.region}): item level ${ext._ilvl}, ${b.slot} budget ${ext._budget}.\n`;
  items += `  ${b.id}: {\n    id: '${b.id}',\n    name: '${b.item.name}',\n    kind: 'armor',\n    armorType: '${b.role.armorType}',\n    slot: '${b.slot}',\n    quality: '${b.item.quality}',\n    stats: ${statsLiteral(b.item.stats ?? {})},\n    sellValue: ${b.item.sellValue},\n  },\n`;
}
items += '};\n';
writeFileSync('src/sim/content/quest_leveling_gear.ts', items);

let choices = `// Choose-one leveling rewards: quest id -> the six pieces it offers (cloth
// caster, leather agility, leather strength, mail strength, mail caster, leather
// caster) of one armor slot from its level band's set
// (content/quest_leveling_gear.ts), or, on a
// quest that rewards a blue, the rares for the roles that blue does not serve
// (the blue itself joins the list through the resolver). Merged onto
// QuestDef.choiceRewards by data.ts; the player is offered what their class can
// wear (quests/quest_reward_choice.ts).
//
// Generated by scripts/quest_leveling_gear_gen.ts. Every quest a player can
// level through is listed (tutorial island, retired, repeatable and raid quests
// are not), and tests/quest_leveling_gear.test.ts fails on a new quest missing
// from it.

export const QUEST_CHOICE_REWARDS: Readonly<Record<string, readonly string[]>> = {
`;
for (const [questId, ids] of [...assignment].sort((a, b) => a[0].localeCompare(b[0]))) {
  choices += `  ${/^[a-z_][a-z0-9_]*$/.test(questId) ? questId : `'${questId}'`}: [${ids.map((id) => `'${id}'`).join(', ')}],\n`;
}
choices += '};\n';
writeFileSync('src/sim/content/quest_choice_rewards.ts', choices);

const promptsIdx = process.argv.indexOf('--prompts');
if (promptsIdx > 0) {
  const briefs = built.map((b) => ({
    id: b.id,
    name: b.item.name,
    slot: b.slot,
    armorType: b.role.armorType,
    role: b.role.key,
    band: b.band.theme,
    region: b.band.region,
    palette: b.band.palette,
    look: b.role.look,
  }));
  writeFileSync(process.argv[promptsIdx + 1], `${JSON.stringify(briefs, null, 2)}\n`);
}

const perBand = BANDS.map((b) => `${b.theme}<=${b.top}:${bandCursor.get(b) ?? 0}`).join(' ');
console.log(`quests ${assignment.size} | items ${built.length} | quests per band ${perBand}`);
console.log(
  `blue quests ${blueSpecs.length} | rares ${blueSpecs.reduce((n, b) => n + b.roles.length, 0)}`,
);
console.log(
  `items without a sourced quest (priced at band top): ${unpriced.length} ${unpriced.join(' ')}`,
);
