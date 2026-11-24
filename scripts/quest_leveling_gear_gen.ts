// Authoring tool for the choose-one leveling gear: every eligible quest offers a
// six-way choice (cloth caster, leather agility, leather strength, mail strength,
// mail caster, leather caster) of one armor slot, from the set of its level band.
//
// A quest that rates blues offers blues instead (rewardQuality in
// quest_leveling_gear_rules.ts): every elite or boss quest (a kill objective on a
// mob flagged elite, boss or worldBoss), and every quest that already rewards a
// blue (a dungeon boss or an elite, authored per reward archetype in
// QuestDef.itemRewards). An authored piece joins the list
// (quests/quest_reward_choice.ts), and the quest's rares cover every role whose
// specs that piece does not serve (a weapon, or an on-role piece in the spec's own
// armor weight carrying its main stat). Those quests take no green band piece.
//
//   npx tsx scripts/quest_leveling_gear_gen.ts            add-only (the default)
//   npx tsx scripts/quest_leveling_gear_gen.ts --reroll [--prompts <file.json>]
//
// ADD-ONLY (default, scripts/quest_leveling_gear_add.ts): every quest that already
// has a row keeps it byte for byte, and every item record stays as it is. Only an
// eligible quest with no row gets one, drawn from the items this tool already owns
// (a green band slot, or an existing rare set at or above the quest's level), and
// it is spliced into content/quest_choice_rewards.ts at its sorted position. Run it
// after adding quests, then review the diff.
//
// --reroll regenerates everything from scratch and rewrites both tables:
//   src/sim/content/quest_leveling_gear.ts   the item records, stats baked
//   src/sim/content/quest_choice_rewards.ts  quest id -> its choices
// and, with --prompts, a JSON of per-item icon briefs for the art batch. It
// REBALANCES SHIPPED QUESTS: the slot rotation runs along the whole level-sorted
// quest list per band, so one quest added or re-levelled shifts the slot of every
// later quest in its band, and each item's level and its armor and sell medians
// are re-derived from the current catalog, which moves stats whenever that catalog
// has grown. It also drops every hand edit made since the last reroll. Use it only
// for a deliberate rebalance.
//
// Stats are never invented: an item's level is the one src/sim/item_level.ts
// derives from the quests that offer it (their hardest kill or collect source,
// or minLevel), its primary stats are that level's uncommon slot budget put on
// the stamina model (normalizeToStaminaModel), armor is the shipped chest line
// of the armor type times the slot weight, and sell value is the median of the
// shipped greens within a few item levels.

import { readFileSync, writeFileSync } from 'node:fs';
import { QUEST_CHOICE_REWARDS } from '../src/sim/content/quest_choice_rewards';
import { QUEST_LEVELING_GEAR_ITEMS } from '../src/sim/content/quest_leveling_gear';
import { ITEMS, QUESTS } from '../src/sim/data';
import { normalizeToStaminaModel, primaryStatBudget, SLOT_STAT_MULT } from '../src/sim/item_budget';
import { itemLevel, resetItemLevelCache } from '../src/sim/item_level';
import type { CoreStats, ItemDef } from '../src/sim/types';
import { MAX_LEVEL } from '../src/sim/types';
import {
  pickRareSet,
  planAddOnly,
  type RareSetCandidate,
  spliceChoiceEntries,
} from './quest_leveling_gear_add';
import {
  authoredBlues,
  BANDS,
  type Band,
  BLUE_THEMES,
  bandFor,
  eligibleQuests,
  isArmorSlot,
  itemId,
  itemName,
  missingRoles,
  REUSED_RARE_CHOICES,
  ROLES,
  type Role,
  rewardQuality,
  SLOTS,
  type Slot,
  sourceLevel,
} from './quest_leveling_gear_rules';

const CHOICES_PATH = 'src/sim/content/quest_choice_rewards.ts';
const GEAR_PATH = 'src/sim/content/quest_leveling_gear.ts';

if (process.argv.includes('--reroll')) rerollAll();
else addOnly();

function addOnly(): void {
  if (process.argv.includes('--prompts')) {
    throw new Error('--prompts lists minted items; add-only mints none (use --reroll)');
  }
  const added = planAddOnly(QUEST_CHOICE_REWARDS);
  if (added.length === 0) {
    console.log('add-only: every eligible quest already has its row; nothing written');
    return;
  }
  writeFileSync(CHOICES_PATH, spliceChoiceEntries(readFileSync(CHOICES_PATH, 'utf8'), added));
  for (const a of added) {
    console.log(`  ${a.questId}: ${a.quality} ${a.from} [${a.ids.join(', ')}]`);
  }
  console.log(`add-only: ${added.length} rows added, every committed row and item untouched`);
}

function rerollAll(): void {
  // A re-run starts from the shipped catalog WITHOUT this tool's previous output
  // (data.ts merges both tables), so ids, names, catalog medians and derived item
  // levels never read the items being regenerated.
  for (const id of Object.keys(QUEST_LEVELING_GEAR_ITEMS)) delete ITEMS[id];
  for (const questId of Object.keys(QUEST_CHOICE_REWARDS)) {
    if (QUESTS[questId]) delete QUESTS[questId].choiceRewards;
  }
  resetItemLevelCache();

  const quests = eligibleQuests();

  // ---------------------------------------------------------------------------
  // Assignment: band by level, slot by rotation within the band
  // ---------------------------------------------------------------------------

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
    if (REUSED_RARE_CHOICES[q.id]) continue;
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
  const blueQuestIds = new Set(blueSpecs.map((b) => b.questId));
  for (const id of Object.keys(BLUE_THEMES)) {
    if (!blueQuestIds.has(id)) throw new Error(`BLUE_THEMES ${id} is not a blue quest any more`);
  }
  // Elite and boss quests that author no blue pay rares too (rewardQuality): a set
  // this run builds for a blue quest, picked below, never a green band piece.
  const eliteOnly = quests.filter(
    ({ q }) => !blueQuestIds.has(q.id) && !REUSED_RARE_CHOICES[q.id] && rewardQuality(q) === 'rare',
  );
  const eliteOnlyIds = new Set(eliteOnly.map(({ q }) => q.id));

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
    const band = bandFor(level);
    const i = bandCursor.get(band) ?? 0;
    bandCursor.set(band, i + 1);
    if (blueQuestIds.has(q.id) || eliteOnlyIds.has(q.id)) continue;
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
  for (const [questId, ids] of Object.entries(REUSED_RARE_CHOICES)) {
    assignment.set(questId, [...ids]);
  }
  const themeOrder = Object.keys(BLUE_THEMES);
  const offers = (ids: readonly string[]) =>
    [...assignment.values()].filter((row) => row.some((id) => ids.includes(id))).length;
  for (const { q } of eliteOnly) {
    const roles = missingRoles(q);
    const candidates: RareSetCandidate[] = blueSpecs
      .filter((b) => roles.every((r) => b.roles.includes(r)))
      .map((b) => ({
        ids: roles.map((role) => itemId(b.theme, role, b.slot)),
        level: sourceLevel(QUESTS[b.questId]) ?? 0,
        order: themeOrder.indexOf(b.questId) * SLOTS.length + SLOTS.indexOf(b.slot),
        from: `${b.theme.theme} ${b.slot}`,
      }));
    const pick = pickRareSet(candidates, sourceLevel(q), offers);
    if (!pick) throw new Error(`${q.id} is an elite or boss quest but no rare set fits its level`);
    assignment.set(q.id, pick.ids);
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
      if (item.kind !== 'armor' || !item.armorType || !item.slot || item.slot === 'offhand')
        continue;
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
  writeFileSync(GEAR_PATH, items);

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
  writeFileSync(CHOICES_PATH, choices);

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
    `blue quests ${blueSpecs.length} | rares ${blueSpecs.reduce((n, b) => n + b.roles.length, 0)} | elite quests on reused rares ${eliteOnly.length}`,
  );
  console.log(
    `items without a sourced quest (priced at band top): ${unpriced.length} ${unpriced.join(' ')}`,
  );
}
