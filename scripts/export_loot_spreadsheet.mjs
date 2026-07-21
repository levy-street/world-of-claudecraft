import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';

const root = process.cwd();
const outDir = path.join(root, 'docs');

const entrySource = `
  export {
    ITEMS, MOBS, NPCS, QUESTS, GROUND_OBJECTS, REWARD_ARCHETYPE,
  } from './src/sim/data.ts';
  export { CLASSES } from './src/sim/content/classes.ts';
  export { ALL_CLASSES } from './src/sim/types.ts';
`;

const build = await esbuild.build({
  stdin: {
    contents: entrySource,
    resolveDir: root,
    sourcefile: 'loot-export-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});

const bundled = build.outputFiles[0].text;
const dataUrl = `data:text/javascript;base64,${Buffer.from(bundled).toString('base64')}`;
const { ALL_CLASSES, CLASSES, GROUND_OBJECTS, ITEMS, MOBS, NPCS, QUESTS, REWARD_ARCHETYPE } =
  await import(dataUrl);

const statKeys = ['str', 'agi', 'sta', 'int', 'spi', 'armor'];
const NEW_LOOT_ADDED = [
  {
    itemId: 'valeborn_spellblade',
    section: 'Open World Rare Spawn',
    subgroup: 'Eastbrook Vale rare chase table',
  },
  {
    itemId: 'bristleback_maul',
    section: 'Open World Rare Spawn',
    subgroup: 'Eastbrook Vale - Elder Bristleback',
  },
  {
    itemId: 'moggers_stomper_boots',
    section: 'Open World Rare Spawn',
    subgroup: 'Eastbrook Vale - Mogger',
  },
  {
    itemId: 'moggers_copper_cudgel',
    section: 'Open World Rare Spawn',
    subgroup: 'Eastbrook Vale rare chase table',
  },
  { itemId: 'moggers_shiv', section: 'Open World Rare Spawn', subgroup: 'Eastbrook Vale - Mogger' },
  {
    itemId: 'gorraks_cruel_chopper',
    section: 'Open World Existing Rare/Boss',
    subgroup: 'Eastbrook Vale - Gorrak',
  },
  {
    itemId: 'mirejaw_biteblade',
    section: 'Open World Rare Spawn',
    subgroup: 'Mirefen - Mirejaw the Ravenous',
  },
  {
    itemId: 'mirejaw_scale_vest',
    section: 'Open World Rare Spawn',
    subgroup: 'Mirefen - Mirejaw the Ravenous',
  },
  {
    itemId: 'fen_reaver_glaive',
    section: 'Open World Rare Spawn',
    subgroup: 'Mirefen rare chase table',
  },
  {
    itemId: 'mirejaw_oracle_staff',
    section: 'Open World Rare Spawn',
    subgroup: 'Mirefen - Mirejaw the Ravenous',
  },
  {
    itemId: 'nhalias_dirgeblade',
    section: 'Open World Rare Spawn',
    subgroup: 'Mirefen rare chase table',
  },
  {
    itemId: 'broodmother_silk_robe',
    section: 'Open World Existing Rare/Boss',
    subgroup: 'Mirefen - The Broodmother',
  },
  {
    itemId: 'nhalias_funeral_wraps',
    section: 'Open World Rare Spawn',
    subgroup: 'Mirefen - Sister Nhalia',
  },
  {
    itemId: 'voss_sanctified_mace',
    section: 'Open World Existing Rare/Boss',
    subgroup: 'Mirefen - Deacon Voss',
  },
  {
    itemId: 'ironvein_pickblade',
    section: 'Open World Rare Spawn',
    subgroup: 'Highwatch - Ironvein Foreman',
  },
  {
    itemId: 'ironvein_lantern_staff',
    section: 'Open World Rare Spawn',
    subgroup: 'Highwatch - Ironvein Foreman',
  },
  {
    itemId: 'drogmar_warboots',
    section: 'Open World Existing Rare/Boss',
    subgroup: 'Highwatch - Warlord Drogmar',
  },
  {
    itemId: 'marrowlord_boneboots',
    section: 'Open World Rare Spawn',
    subgroup: 'Highwatch - Marrowlord Varkas',
  },
  { itemId: 'cryptbone_greaves', section: 'Dungeon - Hollow Crypt', subgroup: 'Morthen' },
  { itemId: 'greyjaw_hide_boots', section: 'Dungeon - Hollow Crypt', subgroup: 'Morthen' },
  {
    itemId: 'hollowbone_hauberk',
    section: 'Open World Rare Spawn',
    subgroup: 'Eastbrook Vale - Elder Bristleback',
  },
  {
    itemId: 'cryptstalker_jerkin',
    section: 'Open World Rare Spawn',
    subgroup: 'Eastbrook Vale - Mogger',
  },
  {
    itemId: 'hollowbound_legguards',
    section: 'Open World Rare Spawn',
    subgroup: 'Eastbrook Vale - Elder Bristleback',
  },
  {
    itemId: 'tideguard_greaves',
    section: 'Dungeon - Sunken Bastion',
    subgroup: 'Olen rare armor table',
  },
  {
    itemId: 'tideguard_sabatons',
    section: 'Dungeon - Sunken Bastion',
    subgroup: 'Olen rare armor table',
  },
  {
    itemId: 'drowned_prayer_leggings',
    section: 'Dungeon - Sunken Bastion',
    subgroup: 'Vael rare armor table',
  },
  {
    itemId: 'drowned_prayer_sandals',
    section: 'Dungeon - Sunken Bastion',
    subgroup: 'Vael rare armor table',
  },
  {
    itemId: 'eelscale_leggings',
    section: 'Dungeon - Sunken Bastion',
    subgroup: 'Olen rare armor table',
  },
  {
    itemId: 'eelscale_treads',
    section: 'Dungeon - Sunken Bastion',
    subgroup: 'Vael rare armor table',
  },
  {
    itemId: 'staff_of_velkhar',
    section: 'Dungeon - Gravewyrm Sanctum',
    subgroup: 'Korgath caster rare table',
  },
  {
    itemId: 'shadowmeld_tunic',
    section: 'Dungeon - Gravewyrm Sanctum',
    subgroup: 'Korgath agility rare table',
  },
  {
    itemId: 'wyrmcult_grand_robe',
    section: 'Dungeon - Gravewyrm Sanctum',
    subgroup: 'Korgath caster rare table',
  },
  {
    itemId: 'gravewyrm_sabatons',
    section: 'Dungeon - Gravewyrm Sanctum',
    subgroup: 'Korgath strength rare table',
  },
  {
    itemId: 'wyrmcult_soulsteps',
    section: 'Dungeon - Gravewyrm Sanctum',
    subgroup: 'Korgath caster rare table',
  },
  {
    itemId: 'gravewyrm_stalkers_treads',
    section: 'Dungeon - Gravewyrm Sanctum',
    subgroup: 'Velkhar rare armor table',
  },
  {
    itemId: 'deathlord_warplate',
    section: 'Dungeon - Gravewyrm Sanctum',
    subgroup: 'Korzul epic armor table',
  },
  {
    itemId: 'necromancers_starshroud',
    section: 'Dungeon - Gravewyrm Sanctum',
    subgroup: 'Korzul epic armor table',
  },
  {
    itemId: 'wyrmshadow_harness',
    section: 'Dungeon - Gravewyrm Sanctum',
    subgroup: 'Korzul epic armor table',
  },
  {
    itemId: 'deathlord_legguards',
    section: 'Dungeon - Gravewyrm Sanctum',
    subgroup: 'Velkhar epic armor table',
  },
  {
    itemId: 'deathlord_sabatons',
    section: 'Open World Rare Spawn',
    subgroup: 'Highwatch - Ironvein Foreman',
  },
  {
    itemId: 'necromancers_soulsteps',
    section: 'Dungeon - Gravewyrm Sanctum',
    subgroup: 'Velkhar epic armor table',
  },
  {
    itemId: 'necromancers_legwraps',
    section: 'Open World Rare Spawn',
    subgroup: 'Highwatch - Marrowlord Varkas',
  },
  {
    itemId: 'wyrmshadow_treads',
    section: 'Dungeon - Gravewyrm Sanctum',
    subgroup: 'Korgath epic armor table',
  },
  {
    itemId: 'wyrmshadow_legguards',
    section: 'Dungeon - Gravewyrm Sanctum',
    subgroup: 'Velkhar epic armor table',
  },
];

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows) {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  return [
    headers.map(csvCell).join(','),
    ...rows.map((row) => headers.map((h) => csvCell(row[h])).join(',')),
    '',
  ].join('\n');
}

function percent(chance) {
  if (!Number.isFinite(chance)) return '';
  return `${Number((chance * 100).toFixed(2))}%`;
}

function money(copper) {
  if (!Number.isFinite(copper)) return '';
  const g = Math.floor(copper / 10000);
  const s = Math.floor((copper % 10000) / 100);
  const c = copper % 100;
  return `${g}g ${s}s ${c}c`;
}

function statsText(item) {
  return statKeys
    .filter((key) => item.stats?.[key])
    .map((key) => `${key}+${item.stats[key]}`)
    .join('; ');
}

function weaponText(item) {
  if (!item.weapon) return '';
  return `${item.weapon.min}-${item.weapon.max} dmg, ${item.weapon.speed}s${item.weapon.dagger ? ', dagger' : ''}`;
}

function classList(classes) {
  return classes?.length ? classes.join('; ') : '';
}

function questName(id) {
  return QUESTS[id]?.name ?? id;
}

function itemBase(item) {
  return {
    item_id: item.id,
    item_name: item.name,
    kind: item.kind,
    quality: item.quality ?? '',
    slot: item.slot ?? '',
    required_classes: classList(item.requiredClass),
    stats: statsText(item),
    str: item.stats?.str ?? '',
    agi: item.stats?.agi ?? '',
    sta: item.stats?.sta ?? '',
    int: item.stats?.int ?? '',
    spi: item.stats?.spi ?? '',
    armor: item.stats?.armor ?? '',
    weapon: weaponText(item),
    weapon_min: item.weapon?.min ?? '',
    weapon_max: item.weapon?.max ?? '',
    weapon_speed: item.weapon?.speed ?? '',
    dagger: item.weapon?.dagger ? 'yes' : '',
    food_hp: item.foodHp ?? '',
    drink_mana: item.drinkMana ?? '',
    sell_value_copper: item.sellValue,
    sell_value: money(item.sellValue),
    buy_value_copper: item.buyValue ?? '',
    buy_value: item.buyValue ? money(item.buyValue) : '',
    quest_id: item.questId ?? '',
    quest_name: item.questId ? questName(item.questId) : '',
  };
}

const sourceRows = [];

function addSource(itemId, source) {
  const item = ITEMS[itemId];
  if (!item) {
    sourceRows.push({
      item_id: itemId,
      item_name: '',
      kind: '',
      quality: '',
      slot: '',
      source_type: source.source_type,
      source_id: source.source_id,
      source_name: source.source_name,
      source_detail: source.source_detail ?? '',
      drop_rate: source.drop_rate ?? '',
      drop_rate_decimal: source.drop_rate_decimal ?? '',
      roll_group: source.roll_group ?? '',
      gated_by_quest_id: source.gated_by_quest_id ?? '',
      gated_by_quest_name: source.gated_by_quest_id ? questName(source.gated_by_quest_id) : '',
      classes: source.classes ?? '',
      notes: source.notes ?? 'WARNING: source references an unknown item id',
    });
    return;
  }
  sourceRows.push({
    item_id: item.id,
    item_name: item.name,
    kind: item.kind,
    quality: item.quality ?? '',
    slot: item.slot ?? '',
    source_type: source.source_type,
    source_id: source.source_id,
    source_name: source.source_name,
    source_detail: source.source_detail ?? '',
    drop_rate: source.drop_rate ?? '',
    drop_rate_decimal: source.drop_rate_decimal ?? '',
    roll_group: source.roll_group ?? '',
    gated_by_quest_id: source.gated_by_quest_id ?? '',
    gated_by_quest_name: source.gated_by_quest_id ? questName(source.gated_by_quest_id) : '',
    classes: source.classes ?? '',
    notes: source.notes ?? '',
  });
}

for (const mob of Object.values(MOBS)) {
  for (const entry of mob.loot ?? []) {
    if (!entry.itemId) continue;
    addSource(entry.itemId, {
      source_type: 'mob_drop',
      source_id: mob.id,
      source_name: mob.name,
      source_detail: `${mob.family}, level ${mob.minLevel}-${mob.maxLevel}${mob.boss ? ', boss' : ''}${mob.elite ? ', elite' : ''}${mob.rare ? ', rare' : ''}`,
      drop_rate: percent(entry.chance),
      drop_rate_decimal: entry.chance,
      roll_group: entry.rollGroup ?? '',
      gated_by_quest_id: entry.questId ?? '',
      notes: entry.rollGroup
        ? 'Exclusive roll group: at most one item from this group is selected by the listed weights.'
        : '',
    });
  }
}

for (const npc of Object.values(NPCS)) {
  for (const itemId of npc.vendorItems ?? []) {
    addSource(itemId, {
      source_type: 'vendor',
      source_id: npc.id,
      source_name: npc.name,
      source_detail: npc.title,
      notes: ITEMS[itemId]?.buyValue
        ? `Vendor price ${money(ITEMS[itemId].buyValue)}`
        : 'Vendor listing has no buyValue on item definition.',
    });
  }
}

for (const quest of Object.values(QUESTS)) {
  for (const obj of quest.objectives ?? []) {
    if (obj.type !== 'collect' || !obj.itemId) continue;
    addSource(obj.itemId, {
      source_type: 'quest_objective',
      source_id: quest.id,
      source_name: quest.name,
      source_detail: `${obj.label} x${obj.count}`,
      notes:
        'Required by quest objective; see mob_drop or ground_object rows for acquisition source.',
    });
  }

  for (const cls of ALL_CLASSES) {
    const rewardItem = quest.itemRewards?.[cls] ?? quest.itemRewards?.[REWARD_ARCHETYPE[cls]];
    if (!rewardItem) continue;
    addSource(rewardItem, {
      source_type: 'quest_reward',
      source_id: quest.id,
      source_name: quest.name,
      source_detail: `reward for ${cls}`,
      classes: cls,
    });
  }
}

for (const obj of GROUND_OBJECTS) {
  addSource(obj.itemId, {
    source_type: 'ground_object',
    source_id: obj.itemId,
    source_name: obj.name,
    source_detail: `${obj.positions.length} spawn position${obj.positions.length === 1 ? '' : 's'}`,
    drop_rate: '100%',
    drop_rate_decimal: 1,
  });
}

for (const [cls, def] of Object.entries(CLASSES)) {
  if (def.startWeapon) {
    addSource(def.startWeapon, {
      source_type: 'starting_equipment',
      source_id: cls,
      source_name: def.name,
      source_detail: 'start weapon',
      classes: cls,
    });
  }
  if (def.startChest) {
    addSource(def.startChest, {
      source_type: 'starting_equipment',
      source_id: cls,
      source_name: def.name,
      source_detail: 'start chest',
      classes: cls,
    });
  }
}

sourceRows.sort(
  (a, b) =>
    a.item_name.localeCompare(b.item_name) ||
    a.source_type.localeCompare(b.source_type) ||
    a.source_name.localeCompare(b.source_name),
);

const sourcesByItem = new Map();
for (const row of sourceRows) {
  if (!sourcesByItem.has(row.item_id)) sourcesByItem.set(row.item_id, []);
  sourcesByItem.get(row.item_id).push(row);
}

function summarize(itemId, type) {
  return (sourcesByItem.get(itemId) ?? [])
    .filter((row) => row.source_type === type)
    .map((row) => {
      const rate = row.drop_rate ? ` (${row.drop_rate})` : '';
      const detail = row.source_detail ? ` - ${row.source_detail}` : '';
      return `${row.source_name}${rate}${detail}`;
    })
    .join('; ');
}

const catalogRows = Object.values(ITEMS)
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((item) => ({
    ...itemBase(item),
    mob_drops: summarize(item.id, 'mob_drop'),
    vendors: summarize(item.id, 'vendor'),
    quest_rewards: summarize(item.id, 'quest_reward'),
    quest_objectives: summarize(item.id, 'quest_objective'),
    ground_objects: summarize(item.id, 'ground_object'),
    starting_equipment: summarize(item.id, 'starting_equipment'),
    source_count: sourcesByItem.get(item.id)?.length ?? 0,
  }));

const newLootRows = NEW_LOOT_ADDED.flatMap((meta) => {
  const item = ITEMS[meta.itemId];
  const rows = (sourcesByItem.get(meta.itemId) ?? []).filter(
    (row) =>
      row.source_type === 'mob_drop' && (!meta.sourceIds || meta.sourceIds.includes(row.source_id)),
  );
  const sources = rows.length ? rows : [{}];
  return sources.map((source) => ({
    section: meta.section,
    subgroup: source.source_name ?? meta.subgroup,
    ...itemBase(item),
    source_type: source.source_type ?? '',
    source_id: source.source_id ?? '',
    source_name: source.source_name ?? '',
    source_detail: source.source_detail ?? '',
    drop_rate: source.drop_rate ?? '',
    drop_rate_decimal: source.drop_rate_decimal ?? '',
    roll_group: source.roll_group ?? '',
    notes: source.notes ?? '',
  }));
});

mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'item_catalog.csv'), toCsv(catalogRows));
writeFileSync(path.join(outDir, 'item_sources.csv'), toCsv(sourceRows));
writeFileSync(path.join(outDir, 'new_loot_added.csv'), toCsv(newLootRows));

console.log(
  `Wrote ${path.relative(root, path.join(outDir, 'item_catalog.csv'))} (${catalogRows.length} items)`,
);
console.log(
  `Wrote ${path.relative(root, path.join(outDir, 'item_sources.csv'))} (${sourceRows.length} item source rows)`,
);
console.log(
  `Wrote ${path.relative(root, path.join(outDir, 'new_loot_added.csv'))} (${newLootRows.length} new loot rows)`,
);
