// Authoring tool for the choose-one leveling gear: every eligible quest offers a
// four-way choice (cloth caster, leather agility, mail strength, mail caster) of
// one armor slot, from the set of its level band.
//
//   npx tsx scripts/quest_leveling_gear_gen.ts [--prompts <file.json>]
//
// Writes two declarative content tables (re-run after adding quests or changing
// a band, then review the diff):
//   src/sim/content/quest_leveling_gear.ts   the item records, stats baked
//   src/sim/content/quest_choice_rewards.ts  quest id -> its four choices
// and, with --prompts, a JSON of per-item icon briefs for the art batch.
//
// Stats are never invented: an item's level is the one src/sim/item_level.ts
// derives from the quests that offer it (their hardest kill or collect source,
// or minLevel), its primary stats are that level's uncommon slot budget put on
// the stamina model (normalizeToStaminaModel), and armor and sell value are the
// shipped catalog's median per item level for the armor type and slot.

import { writeFileSync } from 'node:fs';
import { QUEST_CHOICE_REWARDS } from '../src/sim/content/quest_choice_rewards';
import { QUEST_LEVELING_GEAR_ITEMS } from '../src/sim/content/quest_leveling_gear';
import { CAMPS, DUNGEONS, ITEMS, MOBS, NPCS, QUEST_ORDER, QUESTS, zoneAt } from '../src/sim/data';
import { normalizeToStaminaModel, primaryStatBudget, SLOT_STAT_MULT } from '../src/sim/item_budget';
import {
  itemFromRaid,
  itemLevel,
  itemSourceLevel,
  resetItemLevelCache,
} from '../src/sim/item_level';
import type { CoreStats, EquipSlot, ItemDef, QuestDef } from '../src/sim/types';
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
    top: 3,
    theme: 'Saltbitten',
    region: 'the Proving Shore',
    palette: 'sea-bleached linen, driftwood toggles, salt-stained hide, tarnished brass',
  },
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

function eligible(q: QuestDef): boolean {
  if (q.retired || q.repeatable) return false;
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
// Assignment: band by level, slot by rotation within the band
// ---------------------------------------------------------------------------

const itemId = (band: Band, role: Role, slot: Slot) =>
  `${band.theme}_${role.nouns[slot]}`.toLowerCase().replace(/[^a-z]+/g, '_');
const itemName = (band: Band, role: Role, slot: Slot) => `${band.theme} ${role.nouns[slot]}`;

// Quests with a concrete source take the rotation first, so every slot of every
// band is offered by at least one quest item_level.ts can price (a talk or
// delivery quest has no level of its own); the unsourced quests continue it.
const sourced = quests.filter(({ q }) => sourceLevel(q) !== undefined);
const unsourced = quests.filter(({ q }) => sourceLevel(q) === undefined);
const assignment = new Map<string, string[]>();
const bandCursor = new Map<Band, number>();
for (const { q, level } of [...sourced, ...unsourced]) {
  const band = BANDS.find((b) => level <= b.top) ?? BANDS[BANDS.length - 1];
  const i = bandCursor.get(band) ?? 0;
  bandCursor.set(band, i + 1);
  const slot = SLOTS[i % SLOTS.length];
  assignment.set(
    q.id,
    ROLES.map((role) => itemId(band, role, slot)),
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
  armorType: string;
  slot: string;
  armorPerIlvl: number;
  sellPerSlot: number;
}
const peers: Peer[] = [];
for (const item of Object.values(ITEMS)) {
  if (item.kind !== 'armor' || !item.armorType || !item.slot || item.slot === 'offhand') continue;
  if (item.quality !== 'uncommon') continue;
  const ilvl = itemLevel(item);
  if (!ilvl) continue;
  peers.push({
    ilvl,
    armorType: item.armorType,
    slot: item.slot,
    armorPerIlvl: (item.stats?.armor ?? 0) / ilvl,
    sellPerSlot: item.sellValue / (SLOT_STAT_MULT[item.slot] ?? 1),
  });
}
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
const armorFor = (armorType: string, slot: Slot, ilvl: number) => {
  const sameSlot = peers.filter((p) => p.armorType === armorType && p.slot === slot);
  // Too few same-slot peers: read the chest line and apply the slot weight.
  const pool =
    sameSlot.length >= 3
      ? sameSlot
      : peers.filter((p) => p.armorType === armorType && p.slot === 'chest');
  const scale = sameSlot.length >= 3 ? 1 : (SLOT_STAT_MULT[slot] ?? 1);
  return Math.max(1, Math.round(localMedian(pool, ilvl, (p) => p.armorPerIlvl) * ilvl * scale));
};
const sellFor = (slot: Slot, ilvl: number) =>
  Math.max(
    5,
    Math.round(localMedian(peers, ilvl, (p) => p.sellPerSlot) * (SLOT_STAT_MULT[slot] ?? 1)),
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
  const budget = primaryStatBudget(ilvl, 'uncommon', b.slot);
  b.item.stats = {
    ...normalizeToStaminaModel(b.role.profile, budget),
    armor: armorFor(b.role.armorType, b.slot, ilvl),
  };
  b.item.sellValue = sellFor(b.slot, ilvl);
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

let items = `// Choose-one leveling gear: the four-way armor choice every leveling quest
// offers (content/quest_choice_rewards.ts). One set per level band and armor
// role (cloth caster, leather agility, mail strength, mail caster) in every
// armor slot.
//
// Generated by scripts/quest_leveling_gear_gen.ts: re-run it rather than editing
// a record by hand. Each item's level is the one src/sim/item_level.ts derives
// from the quests that offer it; its stats are that level's uncommon slot budget
// on the stamina model, and its armor and sell value the catalog median.

import type { ItemDef } from '../types';

export const QUEST_LEVELING_GEAR_ITEMS: Record<string, ItemDef> = {
`;
for (const b of built) {
  const ext = b.item as ItemDef & { _ilvl: number; _budget: number };
  items += `  // ${b.band.theme} (${b.band.region}): item level ${ext._ilvl}, ${b.slot} budget ${ext._budget}.\n`;
  items += `  ${b.id}: {\n    id: '${b.id}',\n    name: '${b.item.name}',\n    kind: 'armor',\n    armorType: '${b.role.armorType}',\n    slot: '${b.slot}',\n    quality: 'uncommon',\n    stats: ${statsLiteral(b.item.stats ?? {})},\n    sellValue: ${b.item.sellValue},\n  },\n`;
}
items += '};\n';
writeFileSync('src/sim/content/quest_leveling_gear.ts', items);

let choices = `// Choose-one leveling rewards: quest id -> the four pieces it offers (cloth
// caster, leather agility, mail strength, mail caster) of one armor slot from
// its level band's set (content/quest_leveling_gear.ts). Merged onto
// QuestDef.choiceRewards by data.ts; the player is offered what their class can
// wear (quests/quest_reward_choice.ts).
//
// Generated by scripts/quest_leveling_gear_gen.ts. Every quest a player can
// level through is listed (retired, repeatable and raid quests are not), and
// tests/quest_leveling_gear.test.ts fails on a new quest missing from it.

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
  `items without a sourced quest (priced at band top): ${unpriced.length} ${unpriced.join(' ')}`,
);
