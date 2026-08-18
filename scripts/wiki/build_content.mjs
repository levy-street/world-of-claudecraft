// Generates src/guide/content.generated.ts from the sim source of truth (CLASSES +
// TALENTS + ZONES + DUNGEONS + the overworld bestiary), so the Guide's data never
// drifts from the game. Mirrors the esbuild-bundle pattern in
// scripts/export_loot_spreadsheet.mjs (never import raw .ts). Run via
// `npm run wiki:content`; the build runs it and the committed output is
// freshness-checked in tests/guide.test.ts. Deterministic: reads data, writes a file.
//
// SPOILER POLICY: this file carries only high-level, spoiler-safe facts (names, roles,
// level bands, signature kits, point-of-interest labels). It NEVER emits balance
// numbers, mechanic names, loot, the raid boss name, or per-encounter scripts. The
// rich localized prose (spec/mastery text) is resolved live at render time through
// src/ui/talent_i18n.ts, not baked here.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { assertFamiliesKnown } from './family_guard.mjs';
import { stillUrl } from './still_key.mjs';

const root = process.cwd();
const outFile = path.join(root, 'src', 'guide', 'content.generated.ts');

const entrySource = `
  export { CLASSES, ABILITIES } from './src/sim/content/classes.ts';
  export { TALENTS } from './src/sim/content/talents.ts';
  export { ALL_CLASSES, FISHING_SESSION_CAP_SEC } from './src/sim/types.ts';
  export { ZONES, DUNGEONS, MOBS, CAMPS, DELVE_LIST, NPCS, ITEMS, QUESTS, zoneAt } from './src/sim/data.ts';
  export { WARLOCK_PET_MOBS } from './src/sim/content/warlock_pets.ts';
  export { DELVE_COMPANIONS, DELVE_AFFIXES } from './src/sim/content/delves/index.ts';
  export { DELVE_SHOPS } from './src/sim/content/delves/shop.ts';
  export { DEEDS, DEED_ORDER } from './src/sim/content/deeds.ts';
  export { DEED_IMAGE_IDS } from './src/ui/deed_image_ids.ts';
  export { RELIQUARY_PAGES } from './src/sim/content/reliquary.ts';
  export { MOUNTS } from './src/sim/content/mounts.ts';
  export { WEAPON_SKINS } from './src/sim/content/weapon_skins.ts';
  export { armorySkinStrings } from './src/ui/i18n.catalog/armory.ts';
  export { guideStrings } from './src/ui/i18n.catalog/guide.ts';
  export { VISUALS, visualKeyFor } from './src/render/characters/manifest.ts';
  export {
    CRAFT_RING, STATIONS, STATION_TYPE_BY_CRAFT, STATION_RADIUS, PERK_THRESHOLDS,
    CRAFT_GOLD_SINK_COPPER_PER_BUDGET, CRAFT_CAST_DURATION_FIELD_SEC,
    CRAFT_CAST_DURATION_SKILL_25_SEC, CRAFT_CAST_DURATION_SKILL_50_SEC,
    CRAFT_CAST_DURATION_SKILL_75_SEC, CRAFT_CAST_DURATION_SKILL_100_OR_COMBO_SEC,
    ENCHANT_FAMILY_CAST_DURATION_SEC, TOOL_RECHARGE_CAST_DURATION_SEC,
    CRAFT_BATCH_MAX, GATHERING_PROFESSIONS, GATHERING_PROFESSION_IDS,
  } from './src/sim/content/professions.ts';
  export { ALL_RECIPES } from './src/sim/content/recipes.ts';
  export { ENCHANTS } from './src/sim/content/enchants.ts';
  export { GATHER_NODES } from './src/sim/content/gather_nodes.ts';
  export { FISHING_TABLES_BY_BAND, FISHING_RARE_ID } from './src/sim/content/items.ts';
  export {
    TIER_SKILL_STEP, tierForSkill, REDUCED_TIER_MULTIPLIER, MINIMAL_TIER_MULTIPLIER,
  } from './src/sim/professions/wheel.ts';
  export { WIELD_REQUIREMENT_BY_TIER } from './src/sim/professions/wield_gate.ts';
  export { TRAINING_FEE_BY_TIER, trainingFeeFor } from './src/sim/professions/training.ts';
  export {
    NODE_HARVEST_TABLE, NODE_MATERIAL_TABLE, GATHER_CAST_BASE_SEC, GATHER_CAST_FLOOR_SEC,
    GATHER_CAST_TOOL_TIER_REDUCTION_SEC, GATHER_CAST_BAND_REDUCTION_SEC,
    GATHER_GAIN_TIER_STEP, MATERIAL_RARITY_SHARE, MATERIAL_RARITY_MAX_PROFICIENCY,
    CORPSE_HARVEST_RARITY_BASELINE,
  } from './src/sim/professions/gathering.ts';
  export { PROFICIENCY_BAND_THRESHOLDS } from './src/sim/professions/proficiency_bands.ts';
  export {
    FISH_BITE_DELAY_MIN_SEC, FISH_BITE_DELAY_MAX_SEC, FISH_BITE_DELAY_ROD_REDUCTION_SEC,
    FISH_REEL_WINDOW_SEC, FISH_REEL_WINDOW_ROD_BONUS_SEC, FISHING_GAIN_SCHEDULE,
    FISHING_JUNK_GAIN_CUTOFF_PROFICIENCY,
  } from './src/sim/professions/fishing.ts';
  export {
    GATHER_RARE_EVENT_CHANCE, GATHER_RARE_EVENT_YIELD_MULT, gatherRareEventFlavor,
  } from './src/sim/professions/gather_events.ts';
  export {
    MASTERWORK_BASE_CHANCE, MASTERWORK_PER_TIER_ABOVE_CHANCE, MASTERWORK_SIGNED_CHANCE,
    MASTERWORK_SPECIALIZATION_CHANCE, MASTERWORK_CHANCE_CAP,
  } from './src/sim/professions/masterwork.ts';
  export { UNBIND_FEE_BY_QUALITY_TIER } from './src/sim/professions/commission.ts';
  export { WORK_ORDER_CADENCE_TICKS, WORK_ORDER_PAYOUT_FRACTION } from './src/sim/professions/cadence.ts';
  export { DISENCHANT_MATERIAL_BY_QUALITY } from './src/sim/professions/enchanting.ts';
  export {
    ARMOR_SECONDARY_BY_TYPE, TIMBER_WEAPON_TYPES,
  } from './src/sim/professions/disenchant_reagents.ts';
  export { SALVAGE_MATERIAL_BY_QUALITY } from './src/sim/professions/salvage.ts';
  export { MARKET_CUT, MARKET_LISTING_DEPOSIT_COPPER } from './src/sim/market.ts';
  export { ARCHETYPE_PAIR_TARGETS } from './src/sim/professions/archetype.ts';
`;

const built = await esbuild.build({
  stdin: {
    contents: entrySource,
    resolveDir: root,
    sourcefile: 'wiki-content-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
const dataUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`;
const {
  zoneAt,
  CLASSES,
  ABILITIES,
  TALENTS,
  ALL_CLASSES,
  ZONES,
  DUNGEONS,
  MOBS,
  CAMPS,
  WARLOCK_PET_MOBS,
  DELVE_LIST,
  NPCS,
  DELVE_COMPANIONS,
  DELVE_AFFIXES,
  DELVE_SHOPS,
  DEEDS,
  DEED_ORDER,
  DEED_IMAGE_IDS,
  RELIQUARY_PAGES,
  MOUNTS,
  WEAPON_SKINS,
  armorySkinStrings,
  guideStrings,
  VISUALS,
  visualKeyFor,
  FISHING_SESSION_CAP_SEC,
  ITEMS,
  QUESTS,
  CRAFT_RING,
  STATIONS,
  STATION_TYPE_BY_CRAFT,
  STATION_RADIUS,
  PERK_THRESHOLDS,
  CRAFT_GOLD_SINK_COPPER_PER_BUDGET,
  CRAFT_CAST_DURATION_FIELD_SEC,
  CRAFT_CAST_DURATION_SKILL_25_SEC,
  CRAFT_CAST_DURATION_SKILL_50_SEC,
  CRAFT_CAST_DURATION_SKILL_75_SEC,
  CRAFT_CAST_DURATION_SKILL_100_OR_COMBO_SEC,
  ENCHANT_FAMILY_CAST_DURATION_SEC,
  TOOL_RECHARGE_CAST_DURATION_SEC,
  CRAFT_BATCH_MAX,
  GATHERING_PROFESSIONS,
  GATHERING_PROFESSION_IDS,
  ALL_RECIPES,
  ENCHANTS,
  GATHER_NODES,
  FISHING_TABLES_BY_BAND,
  FISHING_RARE_ID,
  TIER_SKILL_STEP,
  WIELD_REQUIREMENT_BY_TIER,
  tierForSkill,
  REDUCED_TIER_MULTIPLIER,
  MINIMAL_TIER_MULTIPLIER,
  TRAINING_FEE_BY_TIER,
  trainingFeeFor,
  NODE_HARVEST_TABLE,
  NODE_MATERIAL_TABLE,
  GATHER_CAST_BASE_SEC,
  GATHER_CAST_FLOOR_SEC,
  GATHER_CAST_TOOL_TIER_REDUCTION_SEC,
  GATHER_CAST_BAND_REDUCTION_SEC,
  GATHER_GAIN_TIER_STEP,
  MATERIAL_RARITY_SHARE,
  MATERIAL_RARITY_MAX_PROFICIENCY,
  CORPSE_HARVEST_RARITY_BASELINE,
  PROFICIENCY_BAND_THRESHOLDS,
  FISH_BITE_DELAY_MIN_SEC,
  FISH_BITE_DELAY_MAX_SEC,
  FISH_BITE_DELAY_ROD_REDUCTION_SEC,
  FISH_REEL_WINDOW_SEC,
  FISH_REEL_WINDOW_ROD_BONUS_SEC,
  FISHING_GAIN_SCHEDULE,
  FISHING_JUNK_GAIN_CUTOFF_PROFICIENCY,
  GATHER_RARE_EVENT_CHANCE,
  GATHER_RARE_EVENT_YIELD_MULT,
  gatherRareEventFlavor,
  MASTERWORK_BASE_CHANCE,
  MASTERWORK_PER_TIER_ABOVE_CHANCE,
  MASTERWORK_SIGNED_CHANCE,
  MASTERWORK_SPECIALIZATION_CHANCE,
  MASTERWORK_CHANCE_CAP,
  UNBIND_FEE_BY_QUALITY_TIER,
  WORK_ORDER_CADENCE_TICKS,
  WORK_ORDER_PAYOUT_FRACTION,
  DISENCHANT_MATERIAL_BY_QUALITY,
  ARMOR_SECONDARY_BY_TYPE,
  TIMBER_WEAPON_TYPES,
  SALVAGE_MATERIAL_BY_QUALITY,
  MARKET_CUT,
  MARKET_LISTING_DEPOSIT_COPPER,
  ARCHETYPE_PAIR_TARGETS,
} = await import(dataUrl);

const ROLE_ORDER = ['tank', 'healer', 'dps'];
const hex = (n) => `#${(n >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
const abilityRef = (aid) => ({ id: aid, name: ABILITIES[aid]?.name ?? aid });

// 3D model registry, mirrored from the renderer's VisualDef manifest so the Guide's
// interactive viewer (src/guide/viewer) can build the EXACT in-game model from one GLB
// on demand, without importing the renderer's bulk-preload asset pipeline. We bake only
// the structural fields the standalone viewer needs (GLB url, idle clip name, height,
// orientation, the KayKit accessory allowlist, weapon attachments, tint strength) and
// dedupe by visual key, since many creatures share one model. Per-entity color is carried
// on each class/creature/pet as `tint`, resolved here from the VisualDef tint mode.
const MODELS = {};
function modelKeyFor(visualKey) {
  const def = VISUALS[visualKey];
  if (!def) return null;
  if (!MODELS[visualKey]) {
    const spec = { url: def.url, idle: def.clips?.idle ?? null, height: def.height };
    if (def.yaw) spec.yaw = def.yaw;
    if (def.hover) spec.hover = def.hover;
    if (def.show) spec.show = def.show;
    if (def.attach) {
      spec.attach = def.attach.map((a) => {
        const o = { url: a.url, bone: a.bone };
        if (a.position) o.position = a.position;
        if (a.rotationY) o.rotationY = a.rotationY;
        if (a.gripRef) o.gripRef = a.gripRef;
        return o;
      });
    }
    if (def.weaponFix) spec.weaponFix = def.weaponFix;
    if (def.tint !== undefined) spec.tintStrength = def.tintStrength ?? 0.4;
    MODELS[visualKey] = spec;
  }
  return visualKey;
}
// The color the viewer should lerp materials toward, or null when the model is not
// tinted. 'entity' tint uses the entity's own color (white for a class preview, the mob
// template color for a creature); a fixed tint uses the manifest value.
function tintFor(visualKey, entityColor) {
  const def = VISUALS[visualKey];
  if (!def || def.tint === undefined) return null;
  return def.tint === 'entity' ? entityColor : def.tint;
}
// The manifest's tint strength for a tinted model, resolved with the same fallback
// modelKeyFor bakes onto MODELS[visualKey], so a figure's own record and its model spec
// never disagree. Baked onto the figure alongside tint/still and threaded into
// stillUrl/stillKey so a tintStrength-only manifest edit (no tint color change) mints a
// new still key: the old committed WebP orphans and the new one is missing until someone
// regenerates, which is the self-detection this module exists for (see still_key.mjs).
function tintStrengthFor(visualKey) {
  const def = VISUALS[visualKey];
  if (!def || def.tint === undefined) return undefined;
  return def.tintStrength ?? 0.4;
}
const playerVisualKey = (id) => visualKeyFor({ kind: 'player', templateId: id });
const mobVisualKey = (id) => visualKeyFor({ kind: 'mob', templateId: id });

const classes = ALL_CLASSES.map((id) => {
  const def = CLASSES[id];
  const specDefs = TALENTS[id]?.specs ?? [];
  // specs carry id + signature ability id so the page can resolve localized spec and
  // mastery prose live via talent_i18n; name/role stay for structure and tests.
  const specs = specDefs.map((s) => ({
    id: s.id,
    name: s.name,
    role: s.role,
    signature: s.signature,
  }));
  const roles = ROLE_ORDER.filter((r) => specs.some((s) => s.role === r));
  const kit = (def.abilities ?? []).filter((abilityId) => {
    const ability = ABILITIES[abilityId];
    return ability && ability.hiddenFromPlayer !== true;
  });
  // The class preview uses the same model + white tint the in-game character creator does.
  const vk = playerVisualKey(id);
  const tint = tintFor(vk, 0xffffff);
  const tintHex = tint != null ? hex(tint) : null;
  const tintStrength = tintStrengthFor(vk);
  const model = modelKeyFor(vk);
  return {
    id,
    color: hex(def.color),
    resource: def.resourceType,
    roles,
    specs,
    signatureAbilities: kit
      .filter((abilityId) => guideStrings.abilityHook[abilityId] !== undefined)
      .slice(0, 6)
      .map(abilityRef),
    abilities: kit.map(abilityRef),
    model,
    ...(tintHex != null ? { tint: tintHex } : {}),
    ...(tintStrength !== undefined ? { tintStrength } : {}),
    ...(stillUrl(model, tintHex, tintStrength)
      ? { still: stillUrl(model, tintHex, tintStrength) }
      : {}),
  };
});

// Zones, in world order (south to north). POI labels and the welcome line are
// spoiler-safe (no coordinates).
const zones = ZONES.map((z) => ({
  id: z.id,
  name: z.name,
  min: z.levelRange[0],
  max: z.levelRange[1],
  biome: z.biome,
  hub: z.hub?.name ?? '',
  pois: (z.pois ?? []).map((p) => p.label),
  welcome: z.welcome ?? '',
}));

// Dungeons + the raid. Only group content (suggestedPlayers >= 5) so the solo raid
// lead-in crypt is excluded. The level band is derived from each instance's own
// spawns, so it can never drift from the game. The raid's sim name contains the
// final boss name, so it is withheld here and the page renders its own unnamed copy.
const dungeonBand = (def) => {
  let min = Infinity;
  let max = -Infinity;
  for (const s of def.spawns ?? []) {
    const m = MOBS[s.mobId];
    if (!m) continue;
    if (m.minLevel < min) min = m.minLevel;
    if (m.maxLevel > max) max = m.maxLevel;
  }
  return min === Infinity ? { min: null, max: null } : { min, max };
};
const dungeons = Object.values(DUNGEONS)
  .filter((d) => (d.suggestedPlayers ?? 0) >= 5)
  .map((d) => {
    const isRaid = (d.suggestedPlayers ?? 0) >= 10;
    const band = dungeonBand(d);
    return {
      id: isRaid ? 'raid' : d.id,
      isRaid,
      suggestedPlayers: d.suggestedPlayers,
      min: band.min,
      max: band.max,
      ...(isRaid ? {} : { name: d.name }),
    };
  })
  .sort((a, b) => (a.min ?? 99) - (b.min ?? 99) || a.suggestedPlayers - b.suggestedPlayers);

// Druid shapeshift forms: player-worn models a reader meets constantly, shown as their own
// gallery group. Labels are guide.models.form* keys on the client, not baked names.
// form_sheep stays out: it is the polymorph victim model, not a druid form.
const DRUID_FORM_KEYS = ['form_bear', 'form_cat', 'form_travel'];
const druidForms = DRUID_FORM_KEYS.map((vk) => {
  const model = modelKeyFor(vk);
  if (!model) throw new Error(`druid form visual missing from the manifest: ${vk}`);
  const tint = tintFor(vk, 0xffffff);
  const tintHex = tint != null ? hex(tint) : null;
  const tintStrength = tintStrengthFor(vk);
  return {
    id: vk,
    model,
    ...(tintHex != null ? { tint: tintHex } : {}),
    ...(tintStrength !== undefined ? { tintStrength } : {}),
    ...(stillUrl(model, tintHex, tintStrength)
      ? { still: stillUrl(model, tintHex, tintStrength) }
      : {}),
  };
});

// Warlock demons, in summon order. Names only; role flavor is authored guide copy.
const warlockPets = Object.values(WARLOCK_PET_MOBS).map((p) => {
  const vk = mobVisualKey(p.id);
  const tint = tintFor(vk, p.color ?? 0xffffff);
  const tintHex = tint != null ? hex(tint) : null;
  const tintStrength = tintStrengthFor(vk);
  const model = modelKeyFor(vk);
  return {
    id: p.id,
    name: p.name,
    model,
    ...(tintHex != null ? { tint: tintHex } : {}),
    ...(tintStrength !== undefined ? { tintStrength } : {}),
    ...(stillUrl(model, tintHex, tintStrength)
      ? { still: stillUrl(model, tintHex, tintStrength) }
      : {}),
  };
});

// Bestiary: OVERWORLD creatures only, grouped by family. Excludes elite/boss (dungeon
// and raid encounters) and warlock pet summons, so nothing here spoils instanced content.
const FAMILY_ORDER = [
  'beast',
  'spider',
  'mudfin',
  'burrower',
  'humanoid',
  'troll',
  'ogre',
  'undead',
  'elemental',
  'dragonkin',
  'demon',
  'reptile',
];
// A creature only belongs in the public bestiary if it actually spawns in the open world,
// i.e. it appears in a camp spawn list (CAMPS merges every zone's camps plus the temple's).
// Encounter adds that only ever arrive via a boss `summonAdds` are not wild creatures, so
// they are excluded here even though they are not flagged elite/boss.
const campedMobIds = new Set(CAMPS.map((c) => c.mobId));
const publishedMobIds = new Set();
const famMap = {};
// Enumerate the MERGED mob table (every zone module, old world and new-world realms
// alike), not a hand-kept list of zone tables: the camp filter below already scopes
// the bestiary to open-world wild creatures, and a new zone module then publishes
// its residents without touching this generator.
for (const [id, m] of Object.entries(MOBS)) {
  if (m.elite || m.boss) continue;
  if (m.ambient) continue; // ambient decoration (stable horses), not a wild creature to fight
  if (id.startsWith('warlock_')) continue; // summoned pets, not wild creatures
  if (!campedMobIds.has(id)) continue; // summon-only encounter adds, never met in the open
  if (/vision/i.test(id) || /^Vision\b/.test(m.name)) continue; // cinematic apparitions, not creatures
  if (m.dummy) continue; // inert practice fixtures (the training dummy), not creatures
  const vk = mobVisualKey(id);
  const tint = tintFor(vk, m.color ?? 0xffffff);
  const tintHex = tint != null ? hex(tint) : null;
  const tintStrength = tintStrengthFor(vk);
  const model = modelKeyFor(vk);
  famMap[m.family] ??= new Map();
  famMap[m.family].set(m.name, {
    name: m.name,
    min: m.minLevel,
    max: m.maxLevel,
    rare: !!m.rare,
    templateId: id,
    model,
    ...(tintHex != null ? { tint: tintHex } : {}),
    ...(tintStrength !== undefined ? { tintStrength } : {}),
    ...(stillUrl(model, tintHex, tintStrength)
      ? { still: stillUrl(model, tintHex, tintStrength) }
      : {}),
  });
  publishedMobIds.add(id);
}
// A published creature whose family lacks an order slot would silently vanish from the
// bestiary (the freshness test faithfully reproduces a buggy generator), so fail loudly.
assertFamiliesKnown(famMap, FAMILY_ORDER);
const families = FAMILY_ORDER.filter((f) => famMap[f]).map((f) => ({
  family: f,
  creatures: [...famMap[f].values()].sort((a, b) => a.min - b.min || a.name.localeCompare(b.name)),
}));

// Which bestiary families actually live in each zone, from camp GEOGRAPHY (a camp's
// center z falls inside exactly one zone's z-band), never from level-band overlap: a
// creature whose levels straddle a zone border is not a resident of a zone it has no
// camp in. Drives the world page's "who you will meet" cross-links.
// Zones live on a 2D atlas grid (east columns share z-bands with west realms), so a
// camp resolves through the sim's own authoritative zoneAt (exclusive max edges,
// column ordering), never a re-derived rectangle scan.
const zoneIdForXZ = (xv, zv) => zoneAt(xv, zv)?.id ?? null;
const familiesByZone = {};
for (const c of CAMPS) {
  const m = MOBS[c.mobId];
  if (!m || !publishedMobIds.has(c.mobId)) continue; // only bestiary-published creatures
  const zid = zoneIdForXZ(c.center.x, c.center.z);
  if (!zid) continue;
  familiesByZone[zid] ??= new Set();
  familiesByZone[zid].add(m.family);
}
for (const z of zones) {
  z.families = FAMILY_ORDER.filter((f) => familiesByZone[z.id]?.has(f));
}

// Delves: a spoiler-safe overview of each delve, the small-group instanced descents.
// Only the high-level structural facts surface (display name, level floor, suggested
// party size, the keeper NPC who runs the board, the auto-companion, the difficulty
// tier labels, and the run-modifier affix display NAMES for the delve's theme). NEVER
// the affix counts, enemy-level bonuses, reward multipliers, lock-grid dimensions, or
// the Marks economy values: those are balance, not public reference.
// Derive every delve from the sim registry (like dungeons), not a hardcoded list, so a second
// delve theme reaches the wiki automatically and the freshness gate has something to catch. The
// keeper is resolved from the NPC registry by the delve's board NPC id, so a delve with a
// different host is documented correctly instead of silently dropping its keeper.
const npcById = new Map(Object.values(NPCS).map((n) => [n.id, n]));
const delves = DELVE_LIST.map((d) => {
  const keeper = npcById.get(d.boardNpcId) ?? null;
  const companion = DELVE_COMPANIONS[d.autoCompanionId];
  // Affix display names whose theme list includes this delve's theme, hazards only (a
  // blessing affix is a positive modifier, so it is not part of the "harder run" framing).
  const affixes = Object.values(DELVE_AFFIXES)
    .filter((a) => !a.blessing && (a.themes ?? []).includes(d.theme))
    .map((a) => a.name);
  return {
    id: d.id,
    name: d.name,
    theme: d.theme,
    minLevel: d.minLevel,
    suggestedPlayers: d.suggestedPlayers,
    ...(keeper ? { keeper: { name: keeper.name, title: keeper.title ?? '' } } : {}),
    ...(companion ? { companion: { name: companion.name, role: companion.role } } : {}),
    tiers: (d.tiers ?? []).map((t) => t.label),
    affixes,
  };
});

// The Book of Deeds catalog, spoiler-safe. Hidden deeds are filtered out STRUCTURALLY
// here (by the def's own `hidden` flag, not the category), so a secret deed never reaches
// the generated file and cannot leak through the wiki even if a page forgot to hide it.
// Only the fields a public reader needs are emitted: name, category, Renown, whether it is
// a Feat, and the cosmetic reward. The trigger is never emitted, and neither is the
// player-facing `desc`: deed descriptions name instanced bosses and per-encounter mechanics
// that the wiki withholds by policy (the same reason the raid boss and elite creatures stay
// out of the bestiary), so the criteria live only in the in-game Book of Deeds.
// The crest URL points at art the game client already ships publicly under /ui/deeds
// (the id doubles as the filename), and it is only ever computed AFTER the hidden filter,
// so no hidden deed's id can ride out through a crest path.
const deeds = DEED_ORDER.map((id) => DEEDS[id])
  .filter((d) => d && !d.hidden)
  .map((d) => ({
    id: d.id,
    name: d.name,
    category: d.category,
    renown: d.renown,
    feat: !!d.feat,
    ...(d.reward?.kind === 'title' ? { rewardTitle: d.reward.text } : {}),
    ...(d.reward?.kind === 'border' ? { rewardBorder: true } : {}),
    ...(DEED_IMAGE_IDS.has(d.id) ? { crest: `/ui/deeds/${d.id}.webp` } : {}),
  }));

// The Reliquary catalog, spoiler-safe: page names, shelf, and relic display
// names only. No clear counts, firstFind, ownership, or drop sources. Names
// bake English proper nouns from the sim (GUIDE_DEEDS pattern); no player
// progress can reach this table.
// Profession mark find labels mirror hudChrome.reliquary.markFind English
// (chrome, not sim content); keep in lockstep when those keys change.
const RELIQUARY_MARK_GUIDE_NAMES = {
  'masterwork:first': 'First Masterwork',
  'masterwork:weaponcrafting': 'Weaponcrafting Masterwork',
  'masterwork:armorcrafting': 'Armorcrafting Masterwork',
  'masterwork:tailoring': 'Tailoring Masterwork',
  'masterwork:leatherworking': 'Leatherworking Masterwork',
  'masterwork:engineering': 'Engineering Masterwork',
  'gather_event:pristine_vein': 'Pristine Vein',
  'gather_event:ancient_heartwood': 'Ancient Heartwood',
  'gather_event:moonlit_bloom': 'Moonlit Bloom',
  'gather_event:perfect_specimen': 'Perfect Specimen',
  // Rares of the Realm kill proofs (Phase 21). Rare display names are legal in
  // the generated file: the wiki spoiler scan bans only boss-flagged MOBS names
  // (tests/guide.test.ts), none of the 19 rares carries `boss`, and the public
  // bestiary policy withholds elites from the CREATURE list, not their names.
  'slain:old_greyjaw': 'Slain: Old Greyjaw',
  'slain:mogger': 'Slain: Mogger',
  'slain:grix_the_tunnelking': 'Slain: Grix the Tunnelking',
  'slain:captain_verlan': 'Slain: Captain Verlan',
  'slain:wraithbinder_maldrec': 'Slain: Wraithbinder Maldrec',
  'slain:mirejaw_the_ravenous': 'Slain: Mirejaw the Ravenous',
  'slain:sloomtooth_the_drowned': 'Slain: Sloomtooth the Drowned',
  'slain:sister_nhalia': 'Slain: Sister Nhalia',
  'slain:grubjaw': 'Slain: Grubjaw the Glutton',
  'slain:ironvein_foreman': 'Slain: Ironvein Foreman',
  'slain:brutok_skullsmasher': 'Slain: Brutok Skullsmasher',
  'slain:voskar_emberwing': 'Slain: Voskar the Emberwing',
  'slain:marrowlord_varkas': 'Slain: Marrowlord Varkas',
  'slain:old_cragmaw': 'Slain: Old Cragmaw',
  'slain:shardlord_kazzix': 'Slain: Shardlord Kazzix',
  'slain:gleamstag': 'Slain: The Gleamstag',
  'slain:old_marrowshell': 'Slain: Old Marrowshell',
  'slain:aurelhorn': 'Slain: Aurelhorn, First of the Herd',
  'slain:drakemaw_broodlord': 'Slain: Drakemaw Broodlord',
};

function reliquaryRelicName(relic) {
  if (relic.kind === 'item') {
    const def = ITEMS[relic.itemId];
    if (!def) throw new Error(`reliquary wiki emit: unknown item ${relic.itemId}`);
    return def.name;
  }
  if (relic.kind === 'mark') {
    // hasOwn, not a bare index: the sibling server table is a Map for the
    // same reason (an Object.prototype key like 'constructor' must fail the
    // build loudly, never emit a garbage name).
    const name = Object.hasOwn(RELIQUARY_MARK_GUIDE_NAMES, relic.markId)
      ? RELIQUARY_MARK_GUIDE_NAMES[relic.markId]
      : undefined;
    if (!name) throw new Error(`reliquary wiki emit: unknown mark ${relic.markId}`);
    return name;
  }
  if (relic.kind === 'mount') {
    const def = MOUNTS[relic.mountId];
    if (!def) throw new Error(`reliquary wiki emit: unknown mount ${relic.mountId}`);
    return def.name;
  }
  if (relic.kind === 'weapon_skin') {
    if (!WEAPON_SKINS[relic.skinId]) {
      throw new Error(`reliquary wiki emit: unknown weapon skin ${relic.skinId}`);
    }
    const copy = armorySkinStrings[relic.skinId];
    if (!copy?.name) {
      throw new Error(`reliquary wiki emit: missing English name for skin ${relic.skinId}`);
    }
    return copy.name;
  }
  if (relic.kind === 'title') {
    const def = DEEDS[relic.deedId];
    // Same structural hidden filter the deeds arm above applies, at the one other place a
    // deed's prose can reach the wiki: a hidden deed's title text IS the secret's reward,
    // so a title relic pointing at one fails the build instead of publishing it.
    if (def?.hidden) {
      throw new Error(`reliquary wiki emit: title relic ${relic.deedId} references a hidden deed`);
    }
    const reward = def?.reward;
    if (reward?.kind !== 'title') {
      throw new Error(`reliquary wiki emit: title relic ${relic.deedId} has no title reward`);
    }
    return reward.text;
  }
  throw new Error(`reliquary wiki emit: unknown relic kind`);
}

// Wiki page titles must not re-publish raid/world-boss proper names that the
// bestiary deliberately withholds (tests/guide.test.ts boss-name scan). In-game
// Reliquary keeps the full page name; the public wiki uses a safe label.
const RELIQUARY_WIKI_PAGE_NAME = {
  conquerors_thunzharr: 'The Waking Peak (World Boss)',
};

const reliquary = RELIQUARY_PAGES.map((page) => ({
  id: page.id,
  shelf: page.shelf,
  name: RELIQUARY_WIKI_PAGE_NAME[page.id] ?? page.name,
  // Rule 7 (docs/design/reliquary.md) reaches the wiki too: a page outside
  // completion must be LABELED, not indistinguishable from a winnable page,
  // or a reader chases retired items and mutually exclusive bands. Emitted
  // only when set so the common page shape stays lean.
  ...(page.excludeFromCompletion !== undefined
    ? { excludeFromCompletion: page.excludeFromCompletion }
    : {}),
  relics: page.relics.map((r) => ({
    kind: r.kind,
    name: reliquaryRelicName(r),
  })),
}));

// ---------------------------------------------------------------- professions
// Professions 2.0 (wiki arm). TRANSPARENCY POLICY:
// unlike the delve/bestiary sections above, the professions sections publish
// EXACT numbers (skill requirements, gain-state boundaries, band thresholds,
// caps, fees, rare-event odds, vendor prices). Every value below is derived
// from the sim source of truth, never authored here; tests/guide.test.ts holds
// the mirrored accuracy guards. Display names (items, recipes, NPCs) are baked
// English proper nouns, the GUIDE_DEEDS precedent; ids (craft ids, station
// types, armor types, stat keys) stay slugs the client localizes via t().

const itemName = (id) => {
  const def = ITEMS[id];
  if (!def) throw new Error(`professions emit references unknown item id: ${id}`);
  return def.name;
};
const itemQuality = (id) => ITEMS[id]?.quality ?? 'common';
const craftNameById = (id) => {
  const def = CRAFT_RING.find((c) => c.id === id);
  if (!def) throw new Error(`professions emit references unknown craft id: ${id}`);
  return def.name;
};
const zoneById = (zoneId) => ZONES.find((z) => z.id === zoneId);
const hubNameForZ = (zv) => {
  const z = ZONES.find((zz) => zv >= zz.zMin && zv <= zz.zMax);
  return z?.hub?.name ?? z?.name ?? '';
};
const pct = (fraction) => Math.round(fraction * 10000) / 100;

// The four-state Mastery Curve boundaries for one recipe: the player skill at
// which the gain drops to reduced (0.5), minimal (0.25), and none (0), derived
// from the same tier bucketing the sim uses (wheel.ts tierForSkill).
const gainBoundaries = (skillReq) => {
  const tier = tierForSkill(skillReq);
  return {
    reducedAt: (tier + 1) * TIER_SKILL_STEP,
    minimalAt: (tier + 2) * TIER_SKILL_STEP,
    zeroAt: (tier + 3) * TIER_SKILL_STEP,
  };
};

const profRecipeRow = (r) => ({
  id: r.id,
  name: itemName(r.resultItemId),
  skillReq: r.skillReq,
  tier: tierForSkill(r.skillReq),
  station: r.stationType ?? null,
  acquisition: r.acquisition?.includes('trainer') ? 'trainer' : 'known',
  feeCopper: r.acquisition?.includes('trainer') ? trainingFeeFor(r) : 0,
  materials: r.reagents.map((g) => ({ name: itemName(g.itemId), count: g.count })),
  output: {
    name: itemName(r.resultItemId),
    count: r.resultCount,
    quality: itemQuality(r.resultItemId),
  },
  // Craft IDS, not baked names: the client localizes them via hudChrome.craftName.*.
  combo: r.comboRequirement
    ? {
        crafts: [r.comboRequirement.craftA, r.comboRequirement.craftB],
        minTier: r.comboRequirement.minTier,
      }
    : null,
  gain: gainBoundaries(r.skillReq),
});

// The six typed stations with their resident masters, for the training and
// overview sections.
const profStations = STATIONS.map((s) => {
  const master = npcById.get(s.masterNpcId);
  const zone = zoneById(s.zoneId);
  return {
    id: s.id,
    type: s.type,
    hub: zone?.hub?.name ?? '',
    zone: zone?.name ?? '',
    ...(master ? { master: { name: master.name, title: master.title ?? '' } } : {}),
  };
});

// The full ten-craft ring for the overview: honest about the two content-empty
// crafts (they exist on the ring but ship zero recipes in wave one).
const craftHasContent = (id) =>
  id === 'enchanting'
    ? Object.keys(ENCHANTS).length > 0
    : ALL_RECIPES.some((r) => r.professionId === id);
const profRing = CRAFT_RING.map((c) => ({
  id: c.id,
  name: c.name,
  pole: c.pole,
  maxSkill: c.maxSkill,
  hasContent: craftHasContent(c.id),
}));

// The ten pair-named archetype identities, keyed by canonical pair id. Craft
// IDS only: the title WORDS are hudChrome.archetypePair.* i18n keys and the
// craft names hudChrome.craftName.* keys on the client. craftNameById guards
// that both ids are real ring crafts.
const profArchetypes = ARCHETYPE_PAIR_TARGETS.map((pairId) => {
  const [a, b] = pairId.split('+');
  craftNameById(a);
  craftNameById(b);
  return { pairId, crafts: [a, b] };
});

// One entry per earnable craft (has shipped content): its recipe table plus
// station, masters, and specialization facts. Enchanting is earnable with an
// empty recipe list; its enchant/disenchant content lives in
// GUIDE_PROF_ENCHANTING below.
const profCrafts = profRing
  .filter((c) => c.hasContent)
  .map((c) => {
    const stationType = STATION_TYPE_BY_CRAFT[c.id] ?? null;
    const perk = PERK_THRESHOLDS[c.id];
    return {
      id: c.id,
      name: c.name,
      pole: c.pole,
      maxSkill: c.maxSkill,
      station: stationType,
      masters: profStations
        .filter((s) => s.type === stationType && s.master)
        .map((s) => ({ name: s.master.name, title: s.master.title, hub: s.hub })),
      specialization: {
        at: perk.specializedSkillThreshold,
        materialDiscountPct: pct(perk.materialDiscountPct),
      },
      recipes: ALL_RECIPES.filter((r) => r.professionId === c.id).map(profRecipeRow),
    };
  });

// Gathering tool/rod ladders, straight off the gatherTool ItemDefs, with the
// live vendor stockists (an entry with no vendor is profession-crafted).
const toolVendors = (itemId) => {
  const out = [];
  for (const npc of Object.values(NPCS)) {
    if (npc.vendorItems?.includes(itemId))
      out.push({ name: npc.name, hub: hubNameForZ(npc.pos.z) });
  }
  return out;
};
// The craft ID (not name) whose recipe produces this tool; localized client-side.
const craftedByCraft = (itemId) => {
  const recipe = ALL_RECIPES.find((r) => r.resultItemId === itemId);
  return recipe ? recipe.professionId : null;
};
// The Delve Marks price, for a tool a delve counter stocks. Without this the
// Source column reads "Crafted (Engineering)" for the eight top tools while the
// prose directly above the table promises a Marks route, which is the table
// contradicting its own page.
const marksRowFor = (itemId) => {
  for (const entries of Object.values(DELVE_SHOPS)) {
    const row = entries.find((e) => e.itemId === itemId);
    if (row) return row;
  }
  return null;
};
const marksPriceFor = (itemId) => marksRowFor(itemId)?.marks ?? null;
// The delve counter's unlock gate for a Marks-priced tool row, flattened for
// the table cell: how many total clears, or a Heroic clear (shop.ts
// DelveShopGate). An 'available' row emits neither.
const marksGateFor = (itemId) => {
  const gate = marksRowFor(itemId)?.gate;
  if (gate === 'heroicClear') return { marksHeroicClear: true };
  const clears = typeof gate === 'string' ? /^clears:(\d+)$/.exec(gate) : null;
  return clears ? { marksClears: Number(clears[1]) } : {};
};
const toolRow = (itemId, tier, professionId) => {
  const def = ITEMS[itemId];
  const vendors = toolVendors(itemId);
  const craftedBy = craftedByCraft(itemId);
  // R22: land tools above tier 1 carry a wield requirement; rods are the
  // structural exemption and every rod row omits the field.
  const wieldReq = professionId === 'fishing' ? 0 : (WIELD_REQUIREMENT_BY_TIER[tier] ?? 0);
  return {
    name: def.name,
    tier,
    quality: def.quality ?? 'common',
    priceCopper: def.buyValue ?? null,
    vendors,
    ...(craftedBy ? { craftedBy } : {}),
    ...(marksPriceFor(itemId) !== null ? { priceMarks: marksPriceFor(itemId) } : {}),
    ...marksGateFor(itemId),
    ...(wieldReq > 0 ? { wieldProficiency: wieldReq } : {}),
  };
};
const toolLadderFor = (professionId) => {
  const rows = [];
  // The simple pole is the fishing ladder's tier-1 rung (use type 'fishing'
  // resolves to effective tier 1 and satisfies the #2343 implement gate,
  // professions/tools.ts).
  if (professionId === 'fishing') rows.push(toolRow('simple_fishing_pole', 1, professionId));
  for (const [id, def] of Object.entries(ITEMS)) {
    if (def.use?.type === 'gatherTool' && def.use.professionId === professionId) {
      rows.push(toolRow(id, def.use.tier, professionId));
    }
  }
  return rows.sort((a, b) => a.tier - b.tier);
};

// Node lists per zone: count, node tier (which IS the required tool tier;
// every tier requires its tool, tier 1 included, #2343), and the zone's
// material.
const nodeRowsFor = (professionId) => {
  const byKey = new Map();
  for (const node of GATHER_NODES) {
    if (NODE_HARVEST_TABLE[node.type].professionId !== professionId) continue;
    const key = `${node.zoneId}:${node.tier}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        zone: zoneById(node.zoneId)?.name ?? node.zoneId,
        tier: node.tier,
        toolTier: node.tier,
        count: 0,
        material: itemName(NODE_MATERIAL_TABLE[node.type][node.zoneId].itemId),
      });
    }
    byKey.get(key).count += 1;
  }
  return [...byKey.values()].sort((a, b) => a.zone.localeCompare(b.zone) || a.tier - b.tier);
};

const fishingBandTables = FISHING_TABLES_BY_BAND.map((byZone, band) => ({
  band,
  minProficiency: PROFICIENCY_BAND_THRESHOLDS[band],
  rodTierRequired: band + 1,
  zones: Object.entries(byZone).map(([zoneId, rows]) => ({
    zone: zoneById(zoneId)?.name ?? zoneId,
    rows: rows.map((r) => ({
      name: r.itemId ? itemName(r.itemId) : null,
      pct: r.weight,
      quality: r.itemId ? itemQuality(r.itemId) : null,
    })),
  })),
}));

const profGathering = GATHERING_PROFESSION_IDS.map((id) => {
  const def = GATHERING_PROFESSIONS[id];
  const base = {
    id,
    name: def.name,
    maxSkill: def.maxSkill,
    bands: [...PROFICIENCY_BAND_THRESHOLDS],
    tools: toolLadderFor(id),
  };
  if (id === 'fishing') {
    return {
      ...base,
      fishing: {
        biteMinSec: FISH_BITE_DELAY_MIN_SEC,
        biteMaxSec: FISH_BITE_DELAY_MAX_SEC,
        rodBiteReductionSec: FISH_BITE_DELAY_ROD_REDUCTION_SEC,
        reelWindowSec: FISH_REEL_WINDOW_SEC,
        reelRodBonusSec: FISH_REEL_WINDOW_ROD_BONUS_SEC,
        sessionCapSec: FISHING_SESSION_CAP_SEC,
        schedule: FISHING_GAIN_SCHEDULE.map((row) => ({
          below: row.belowProficiency,
          gain: row.gain,
        })),
        junkCutoff: FISHING_JUNK_GAIN_CUTOFF_PROFICIENCY,
        rareCatch: itemName(FISHING_RARE_ID),
        bandTables: fishingBandTables,
      },
    };
  }
  const nodeType = Object.keys(NODE_HARVEST_TABLE).find(
    (type) => NODE_HARVEST_TABLE[type].professionId === id,
  );
  return {
    ...base,
    nodes: nodeRowsFor(id),
    respawnSeconds: NODE_HARVEST_TABLE[nodeType].respawnSeconds,
  };
});

// The shared curve constants: the four-state Mastery Curve, gather cast
// timing, bands, rare-event odds, and the corpse specimen chance (the
// rare-or-better share of the corpse rarity roll at its fixed baseline).
const signedShare =
  MATERIAL_RARITY_SHARE.rare + MATERIAL_RARITY_SHARE.epic + MATERIAL_RARITY_SHARE.legendary;
const profCurve = {
  tierStep: TIER_SKILL_STEP,
  multipliers: {
    full: 1,
    reduced: REDUCED_TIER_MULTIPLIER,
    minimal: MINIMAL_TIER_MULTIPLIER,
    none: 0,
  },
  gatherTierStep: GATHER_GAIN_TIER_STEP,
  cast: {
    baseSec: GATHER_CAST_BASE_SEC,
    floorSec: GATHER_CAST_FLOOR_SEC,
    toolTierReductionSec: GATHER_CAST_TOOL_TIER_REDUCTION_SEC,
    bandReductionSec: GATHER_CAST_BAND_REDUCTION_SEC,
  },
  bands: [...PROFICIENCY_BAND_THRESHOLDS],
  rareEvent: {
    oneIn: Math.round(1 / GATHER_RARE_EVENT_CHANCE),
    yieldMult: GATHER_RARE_EVENT_YIELD_MULT,
    flavors: {
      ore: gatherRareEventFlavor('ore'),
      wood: gatherRareEventFlavor('wood'),
      herb: gatherRareEventFlavor('herb'),
    },
  },
  specimenChancePct: pct(
    (CORPSE_HARVEST_RARITY_BASELINE * signedShare) / MATERIAL_RARITY_MAX_PROFICIENCY,
  ),
};

// Enchanting: disenchant yields, the typed rare+ secondaries, the enchant
// table (base / Runed / Greater derived structurally from the reagents), and
// everyone-can salvage.
const typedSecondaryIds = new Set([
  ...Object.values(ARMOR_SECONDARY_BY_TYPE),
  'resonant_steel',
  'resonant_timber',
]);
const enchantTier = (e) =>
  e.reagents.some((g) => g.itemId === 'arcane_shard')
    ? 'greater'
    : e.reagents.some((g) => typedSecondaryIds.has(g.itemId))
      ? 'runed'
      : 'base';
const profEnchanting = {
  disenchantByQuality: Object.entries(DISENCHANT_MATERIAL_BY_QUALITY).map(([quality, m]) => ({
    quality,
    material: itemName(m),
  })),
  typedSecondaries: {
    armor: Object.entries(ARMOR_SECONDARY_BY_TYPE).map(([armorType, m]) => ({
      armorType,
      material: itemName(m),
    })),
    meleeWeapons: itemName('resonant_steel'),
    timberWeapons: {
      material: itemName('resonant_timber'),
      families: [...TIMBER_WEAPON_TYPES].sort(),
    },
    counts: { rare: 1, epicMin: 1, epicMax: 2 },
  },
  enchants: Object.values(ENCHANTS).map((e) => ({
    id: e.id,
    name: e.name,
    slot: e.itemSlot,
    tier: enchantTier(e),
    reagents: e.reagents.map((g) => ({ name: itemName(g.itemId), count: g.count })),
    bonus: Object.entries(e.statBonus).map(([stat, value]) => ({ stat, value })),
  })),
  salvageByQuality: Object.entries(SALVAGE_MATERIAL_BY_QUALITY).map(([quality, m]) => ({
    quality,
    material: itemName(m),
  })),
};

// Masterwork proc odds, in percent (the add-only proc on every craft).
const profMasterwork = {
  basePct: pct(MASTERWORK_BASE_CHANCE),
  perTierAbovePct: pct(MASTERWORK_PER_TIER_ABOVE_CHANCE),
  signedReagentPct: pct(MASTERWORK_SIGNED_CHANCE),
  specializedPct: pct(MASTERWORK_SPECIALIZATION_CHANCE),
  capPct: pct(MASTERWORK_CHANCE_CAP),
};

// Economy: fees, sinks, the shared action throttle, and the repeatable work
// orders (every collect quest on the shared work-order cadence).
const workOrders = Object.values(QUESTS)
  .filter(
    (q) =>
      q.repeatCadenceTicks === WORK_ORDER_CADENCE_TICKS &&
      (q.objectives ?? []).length > 0 &&
      q.objectives.every((o) => o.type === 'collect'),
  )
  .map((q) => {
    const npc = npcById.get(q.giverNpcId);
    const obj = q.objectives[0];
    return {
      id: q.id,
      name: q.name,
      master: npc?.name ?? '',
      hub: npc ? hubNameForZ(npc.pos.z) : '',
      material: itemName(obj.itemId),
      count: obj.count,
      coinCopper: q.copperReward ?? 0,
    };
  });
const profEconomy = {
  craftFeeCopperPerBudgetPoint: CRAFT_GOLD_SINK_COPPER_PER_BUDGET,
  // Craft Cast System: the exact cast-pace numbers the transparency policy
  // publishes (the retired actionThrottle block's successor).
  castPace: {
    fieldSec: CRAFT_CAST_DURATION_FIELD_SEC,
    skill25Sec: CRAFT_CAST_DURATION_SKILL_25_SEC,
    skill50Sec: CRAFT_CAST_DURATION_SKILL_50_SEC,
    skill75Sec: CRAFT_CAST_DURATION_SKILL_75_SEC,
    comboSec: CRAFT_CAST_DURATION_SKILL_100_OR_COMBO_SEC,
    enchantFamilySec: ENCHANT_FAMILY_CAST_DURATION_SEC,
    rechargeSec: TOOL_RECHARGE_CAST_DURATION_SEC,
    batchMax: CRAFT_BATCH_MAX,
  },
  marketCutPct: pct(MARKET_CUT),
  listingDepositCopper: MARKET_LISTING_DEPOSIT_COPPER,
  trainingFeeCopperByTier: [...TRAINING_FEE_BY_TIER],
  unbindFeeCopper: {
    uncommon: UNBIND_FEE_BY_QUALITY_TIER[0],
    rare: UNBIND_FEE_BY_QUALITY_TIER[1],
    epic: UNBIND_FEE_BY_QUALITY_TIER[2],
  },
  workOrders: {
    cadenceMinutes: WORK_ORDER_CADENCE_TICKS / 20 / 60,
    payoutPctOfVendorValue: pct(WORK_ORDER_PAYOUT_FRACTION),
    orders: workOrders,
  },
};

const profStationsOut = { radius: STATION_RADIUS, stations: profStations };

// Every professions detail sub-page id under /wiki/professions/<id>: the
// earnable crafts, the four gathering professions, and the two fixed pages.
// Drives the router dispatch, the sitemap, and the head canonicalization.
const profPages = [
  ...profCrafts.map((c) => c.id),
  ...profGathering.map((g) => g.id),
  'economy',
  'faq',
];

const header = `// GENERATED by scripts/wiki/build_content.mjs from src/sim/content. Do not edit by hand.
// Regenerate with \`npm run wiki:content\`; tests/guide.test.ts checks it stays fresh.
// Spec names and ability names are the English sim source (proper nouns); all other
// Guide copy is localized via guide.* t() keys, and rich spec/mastery prose resolves
// live through src/ui/talent_i18n.ts. No balance numbers or instanced spoilers here.

export type GuideRole = 'tank' | 'healer' | 'dps';
export type GuideResource = 'rage' | 'mana' | 'energy' | 'focus';

export interface GuideAbilityRef { id: string; name: string; }
export interface GuideClassSpec { id: string; name: string; role: GuideRole; signature: string; }

// Interactive 3D model data, mirrored from the renderer's VisualDef manifest. The Guide's
// standalone viewer builds the model from one GLB on demand; entities reference a model by
// visual key into GUIDE_MODELS and carry their own tint color.
export interface GuideModelAttach { url: string; bone: string; position?: [number, number, number]; rotationY?: number; gripRef?: string; }
export interface GuideModelWeaponFix { node: string; rotX?: number; rotY?: number; rotZ?: number; }
export interface GuideModelSpec {
  url: string;
  idle: string | null;
  height: number;
  yaw?: number;
  hover?: number;
  show?: string[];
  attach?: GuideModelAttach[];
  weaponFix?: GuideModelWeaponFix[];
  tintStrength?: number;
}

export interface GuideClassInfo {
  id: string;
  color: string;
  resource: GuideResource;
  roles: GuideRole[];
  specs: GuideClassSpec[];
  signatureAbilities: GuideAbilityRef[];
  abilities: GuideAbilityRef[];
  model: string;
  tint?: string;
  /** Manifest tint strength (0..1) for this figure's model, when tinted. Feeds the still's
   *  filename identity (still_key.mjs) alongside model/tint; the live viewer reads its own
   *  copy off GuideModelSpec.tintStrength, so this is not consumed for rendering. */
  tintStrength?: number;
  /** Pre-rendered transparent still (public/guide-stills/), the default poster. */
  still?: string;
}

export interface GuideZoneInfo {
  id: string;
  name: string;
  min: number;
  max: number;
  biome: string;
  hub: string;
  pois: string[];
  welcome: string;
  /** Bestiary families with at least one camp inside this zone, in family order. */
  families: string[];
}

export interface GuideDungeon {
  id: string;
  isRaid: boolean;
  suggestedPlayers: number;
  min: number | null;
  max: number | null;
  name?: string;
}

export interface GuideWarlockPet { id: string; name: string; model: string; tint?: string; tintStrength?: number; still?: string; }

// Druid shapeshift forms. Unnamed on purpose: the gallery labels them with guide.models.form*
// keys so the names localize like the rest of the picker chrome.
export interface GuideDruidForm { id: string; model: string; tint?: string; tintStrength?: number; still?: string; }

export interface GuideCreature { name: string; min: number; max: number; rare: boolean; templateId: string; model: string; tint?: string; tintStrength?: number; still?: string; }
export interface GuideFamily { family: string; creatures: GuideCreature[]; }

export interface GuideDelveKeeper { name: string; title: string; }
export interface GuideDelveCompanion { name: string; role: string; }
export interface GuideDelve {
  id: string;
  name: string;
  theme: string;
  minLevel: number;
  suggestedPlayers: number;
  keeper?: GuideDelveKeeper;
  companion?: GuideDelveCompanion;
  tiers: string[];
  affixes: string[];
}

// A single public deed. Names and reward title text are the English sim source (proper
// nouns), baked like creature and POI names. No criteria beyond this reaches the wiki: the
// trigger and the player-facing desc are deliberately omitted (see the generator note), and
// hidden deeds are filtered out entirely, so this list is safe to publish in full.
export interface GuideDeed {
  id: string;
  name: string;
  category: string;
  renown: number;
  feat: boolean;
  /** Cosmetic title text (English proper noun), when the deed grants one. */
  rewardTitle?: string;
  /** True when the deed grants a cosmetic nameplate border. */
  rewardBorder?: true;
  /** Painted crest URL under /ui/deeds, present only when committed art backs this deed. */
  crest?: string;
}

/** Spoiler-safe Reliquary page: names only, no personal progress or sources. */
export interface GuideReliquaryRelic {
  kind: 'item' | 'mark' | 'mount' | 'weapon_skin' | 'title';
  name: string;
}
export interface GuideReliquaryPage {
  id: string;
  shelf: 'conquerors' | 'professions' | 'horizons';
  name: string;
  /** Outside-completion reason (rule 7): present only on labeled pages. */
  excludeFromCompletion?: 'retired' | 'personal';
  relics: GuideReliquaryRelic[];
}

// ---------------------------------------------------------------- professions
// Professions 2.0 reference data (wiki arm). TRANSPARENCY POLICY:
// the professions sections publish EXACT numbers (skill
// requirements, gain boundaries, band thresholds, caps, fees, odds, vendor
// prices), all derived from the sim source; tests/guide.test.ts guards every
// row against the live defs. Display names are baked English proper nouns
// (the GUIDE_DEEDS precedent); ids/slugs localize client-side via t().

export interface GuideProfMaterial { name: string; count: number; }

export interface GuideProfRecipe {
  id: string;
  name: string;
  skillReq: number;
  tier: number;
  station: string | null;
  acquisition: 'trainer' | 'known';
  feeCopper: number;
  materials: GuideProfMaterial[];
  output: { name: string; count: number; quality: string };
  combo: { crafts: string[]; minTier: number } | null;
  /** Mastery Curve boundaries: skill where gain drops to 0.5 / 0.25 / 0. */
  gain: { reducedAt: number; minimalAt: number; zeroAt: number };
}

export interface GuideProfMaster { name: string; title: string; hub: string; }

export interface GuideProfCraft {
  id: string;
  name: string;
  pole: string;
  maxSkill: number;
  station: string | null;
  masters: GuideProfMaster[];
  specialization: { at: number; materialDiscountPct: number };
  recipes: GuideProfRecipe[];
}

export interface GuideProfRingCraft {
  id: string;
  name: string;
  pole: string;
  maxSkill: number;
  /** False for the wave-one content-empty crafts (zero recipes shipped). */
  hasContent: boolean;
}

export interface GuideProfArchetype { pairId: string; crafts: string[]; }

export interface GuideProfTool {
  name: string;
  tier: number;
  quality: string;
  /** Vendor buy price in copper, or null for profession-crafted tools. */
  priceCopper: number | null;
  vendors: { name: string; hub: string }[];
  craftedBy?: string;
  /** Delve Marks price, for a tool a delve counter stocks. Absent otherwise. */
  priceMarks?: number;
  /** Total delve clears the Marks row unlocks after (shop.ts 'clears:N').
   *  Consumed today by the tests/guide.test.ts gate pin only: the source
   *  cell keeps the count as an English literal until the deferred locale
   *  re-fill adds a {clears} token (R64, the packet review doc). */
  marksClears?: number;
  /** True when the Marks row unlocks after a Heroic clear. */
  marksHeroicClear?: boolean;
  /** R22 wield requirement (proficiency in the tool's own trade) for land
   *  tools above tier 1. Absent for tier 1 and for every fishing rod. */
  wieldProficiency?: number;
}

export interface GuideProfNodeRow {
  zone: string;
  tier: number;
  toolTier: number;
  count: number;
  material: string;
}

export interface GuideProfFishingRow { name: string | null; pct: number; quality: string | null; }

export interface GuideProfFishingBand {
  band: number;
  minProficiency: number;
  rodTierRequired: number;
  zones: { zone: string; rows: GuideProfFishingRow[] }[];
}

export interface GuideProfGathering {
  id: string;
  name: string;
  maxSkill: number;
  bands: number[];
  tools: GuideProfTool[];
  nodes?: GuideProfNodeRow[];
  respawnSeconds?: number;
  fishing?: {
    biteMinSec: number;
    biteMaxSec: number;
    rodBiteReductionSec: number;
    reelWindowSec: number;
    reelRodBonusSec: number;
    sessionCapSec: number;
    schedule: { below: number; gain: number }[];
    junkCutoff: number;
    rareCatch: string;
    bandTables: GuideProfFishingBand[];
  };
}

export interface GuideProfCurve {
  tierStep: number;
  multipliers: { full: number; reduced: number; minimal: number; none: number };
  gatherTierStep: number;
  cast: { baseSec: number; floorSec: number; toolTierReductionSec: number; bandReductionSec: number };
  bands: number[];
  rareEvent: { oneIn: number; yieldMult: number; flavors: { ore: string; wood: string; herb: string } };
  specimenChancePct: number;
}

export interface GuideProfEnchanting {
  disenchantByQuality: { quality: string; material: string }[];
  typedSecondaries: {
    armor: { armorType: string; material: string }[];
    meleeWeapons: string;
    timberWeapons: { material: string; families: string[] };
    counts: { rare: number; epicMin: number; epicMax: number };
  };
  enchants: {
    id: string;
    name: string;
    slot: string;
    tier: 'base' | 'runed' | 'greater';
    reagents: GuideProfMaterial[];
    bonus: { stat: string; value: number }[];
  }[];
  salvageByQuality: { quality: string; material: string }[];
}

export interface GuideProfMasterwork {
  basePct: number;
  perTierAbovePct: number;
  signedReagentPct: number;
  specializedPct: number;
  capPct: number;
}

export interface GuideProfWorkOrder {
  id: string;
  name: string;
  master: string;
  hub: string;
  material: string;
  count: number;
  coinCopper: number;
}

export interface GuideProfEconomy {
  craftFeeCopperPerBudgetPoint: number;
  castPace: {
    fieldSec: number;
    skill25Sec: number;
    skill50Sec: number;
    skill75Sec: number;
    comboSec: number;
    enchantFamilySec: number;
    rechargeSec: number;
    batchMax: number;
  };
  marketCutPct: number;
  listingDepositCopper: number;
  trainingFeeCopperByTier: number[];
  unbindFeeCopper: { uncommon: number; rare: number; epic: number };
  workOrders: { cadenceMinutes: number; payoutPctOfVendorValue: number; orders: GuideProfWorkOrder[] };
}

export interface GuideProfStation {
  id: string;
  type: string;
  hub: string;
  zone: string;
  master?: { name: string; title: string };
}

export interface GuideProfStations { radius: number; stations: GuideProfStation[]; }
`;

writeFileSync(
  outFile,
  [
    header,
    `\nexport const GUIDE_CLASSES: GuideClassInfo[] = ${JSON.stringify(classes, null, 2)};\n`,
    `\nexport const GUIDE_ZONES: GuideZoneInfo[] = ${JSON.stringify(zones, null, 2)};\n`,
    `\nexport const GUIDE_DUNGEONS: GuideDungeon[] = ${JSON.stringify(dungeons, null, 2)};\n`,
    `\nexport const GUIDE_WARLOCK_PETS: GuideWarlockPet[] = ${JSON.stringify(warlockPets, null, 2)};\n`,
    `\nexport const GUIDE_DRUID_FORMS: GuideDruidForm[] = ${JSON.stringify(druidForms, null, 2)};\n`,
    `\nexport const GUIDE_FAMILIES: GuideFamily[] = ${JSON.stringify(families, null, 2)};\n`,
    `\nexport const GUIDE_DELVES: GuideDelve[] = ${JSON.stringify(delves, null, 2)};\n`,
    `\nexport const GUIDE_DEEDS: GuideDeed[] = ${JSON.stringify(deeds, null, 2)};\n`,
    `\nexport const GUIDE_RELIQUARY: GuideReliquaryPage[] = ${JSON.stringify(reliquary, null, 2)};\n`,
    `\nexport const GUIDE_PROF_RING: GuideProfRingCraft[] = ${JSON.stringify(profRing, null, 2)};\n`,
    `\nexport const GUIDE_PROF_ARCHETYPES: GuideProfArchetype[] = ${JSON.stringify(profArchetypes, null, 2)};\n`,
    `\nexport const GUIDE_PROF_CRAFTS: GuideProfCraft[] = ${JSON.stringify(profCrafts, null, 2)};\n`,
    `\nexport const GUIDE_PROF_GATHERING: GuideProfGathering[] = ${JSON.stringify(profGathering, null, 2)};\n`,
    `\nexport const GUIDE_PROF_CURVE: GuideProfCurve = ${JSON.stringify(profCurve, null, 2)};\n`,
    `\nexport const GUIDE_PROF_ENCHANTING: GuideProfEnchanting = ${JSON.stringify(profEnchanting, null, 2)};\n`,
    `\nexport const GUIDE_PROF_MASTERWORK: GuideProfMasterwork = ${JSON.stringify(profMasterwork, null, 2)};\n`,
    `\nexport const GUIDE_PROF_ECONOMY: GuideProfEconomy = ${JSON.stringify(profEconomy, null, 2)};\n`,
    `\nexport const GUIDE_PROF_STATIONS: GuideProfStations = ${JSON.stringify(profStationsOut, null, 2)};\n`,
    `\nexport const GUIDE_PROF_PAGES: string[] = ${JSON.stringify(profPages, null, 2)};\n`,
    `\nexport const GUIDE_MODELS: Record<string, GuideModelSpec> = ${JSON.stringify(MODELS, null, 2)};\n`,
  ].join(''),
);
// eslint-disable-next-line no-console
console.log(
  `generated src/guide/content.generated.ts (${classes.length} classes, ${zones.length} zones, ${dungeons.length} dungeons, ${warlockPets.length} warlock pets, ${druidForms.length} druid forms, ${families.length} families, ${delves.length} delves, ${deeds.length} deeds, ${reliquary.length} reliquary pages, ${profCrafts.length} crafts, ${profGathering.length} gathering professions, ${Object.keys(MODELS).length} models)`,
);
