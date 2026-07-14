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
  export { ALL_CLASSES } from './src/sim/types.ts';
  export { ZONES, DUNGEONS, MOBS, CAMPS, DELVE_LIST, NPCS } from './src/sim/data.ts';
  export { WARLOCK_PET_MOBS } from './src/sim/content/warlock_pets.ts';
  export { ZONE1_MOBS } from './src/sim/content/zone1.ts';
  export { ZONE2_MOBS } from './src/sim/content/zone2.ts';
  export { ZONE3_MOBS } from './src/sim/content/zone3.ts';
  export { TEMPLE_MOBS } from './src/sim/content/temple.ts';
  export { DELVE_COMPANIONS, DELVE_AFFIXES } from './src/sim/content/delves/index.ts';
  export { DEEDS, DEED_ORDER } from './src/sim/content/deeds.ts';
  export { DEED_IMAGE_IDS } from './src/ui/deed_image_ids.ts';
  export { VISUALS, visualKeyFor } from './src/render/characters/manifest.ts';
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
  CLASSES,
  ABILITIES,
  TALENTS,
  ALL_CLASSES,
  ZONES,
  DUNGEONS,
  MOBS,
  CAMPS,
  WARLOCK_PET_MOBS,
  ZONE1_MOBS,
  ZONE2_MOBS,
  ZONE3_MOBS,
  TEMPLE_MOBS,
  DELVE_LIST,
  NPCS,
  DELVE_COMPANIONS,
  DELVE_AFFIXES,
  DEEDS,
  DEED_ORDER,
  DEED_IMAGE_IDS,
  VISUALS,
  visualKeyFor,
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
const playerVisualKey = (id) => visualKeyFor({ kind: 'player', templateId: id });
const mobVisualKey = (id) => visualKeyFor({ kind: 'mob', templateId: id });

// How many early, spoiler-safe abilities lead the "signature kit". The full kit
// (allAbilities) follows so every class icon is showcased.
const SIGNATURE_COUNT = 6;

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
  const kit = def.abilities ?? [];
  // The class preview uses the same model + white tint the in-game character creator does.
  const vk = playerVisualKey(id);
  const tint = tintFor(vk, 0xffffff);
  const tintHex = tint != null ? hex(tint) : null;
  const model = modelKeyFor(vk);
  return {
    id,
    color: hex(def.color),
    resource: def.resourceType,
    roles,
    specs,
    signatureAbilities: kit.slice(0, SIGNATURE_COUNT).map(abilityRef),
    abilities: kit.map(abilityRef),
    model,
    ...(tintHex != null ? { tint: tintHex } : {}),
    ...(stillUrl(model, tintHex) ? { still: stillUrl(model, tintHex) } : {}),
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
  return {
    id: vk,
    model,
    ...(tintHex != null ? { tint: tintHex } : {}),
    ...(stillUrl(model, tintHex) ? { still: stillUrl(model, tintHex) } : {}),
  };
});

// Warlock demons, in summon order. Names only; role flavor is authored guide copy.
const warlockPets = Object.values(WARLOCK_PET_MOBS).map((p) => {
  const vk = mobVisualKey(p.id);
  const tint = tintFor(vk, p.color ?? 0xffffff);
  const tintHex = tint != null ? hex(tint) : null;
  const model = modelKeyFor(vk);
  return {
    id: p.id,
    name: p.name,
    model,
    ...(tintHex != null ? { tint: tintHex } : {}),
    ...(stillUrl(model, tintHex) ? { still: stillUrl(model, tintHex) } : {}),
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
];
// A creature only belongs in the public bestiary if it actually spawns in the open world,
// i.e. it appears in a camp spawn list (CAMPS merges every zone's camps plus the temple's).
// Encounter adds that only ever arrive via a boss `summonAdds` are not wild creatures, so
// they are excluded here even though they are not flagged elite/boss.
const campedMobIds = new Set(CAMPS.map((c) => c.mobId));
const publishedMobIds = new Set();
const famMap = {};
for (const [id, m] of Object.entries({
  ...ZONE1_MOBS,
  ...ZONE2_MOBS,
  ...ZONE3_MOBS,
  ...TEMPLE_MOBS,
})) {
  if (m.elite || m.boss) continue;
  if (id.startsWith('warlock_')) continue; // summoned pets, not wild creatures
  if (!campedMobIds.has(id)) continue; // summon-only encounter adds, never met in the open
  if (/vision/i.test(id) || /^Vision\b/.test(m.name)) continue; // cinematic apparitions, not creatures
  if (m.dummy) continue; // inert practice fixtures (the training dummy), not creatures
  const vk = mobVisualKey(id);
  const tint = tintFor(vk, m.color ?? 0xffffff);
  const tintHex = tint != null ? hex(tint) : null;
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
    ...(stillUrl(model, tintHex) ? { still: stillUrl(model, tintHex) } : {}),
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
const zoneIdForZ = (zv) => ZONES.find((z) => zv >= z.zMin && zv <= z.zMax)?.id ?? null;
const familiesByZone = {};
for (const c of CAMPS) {
  const m = MOBS[c.mobId];
  if (!m || !publishedMobIds.has(c.mobId)) continue; // only bestiary-published creatures
  const zid = zoneIdForZ(c.center.z);
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

const header = `// GENERATED by scripts/wiki/build_content.mjs from src/sim/content. Do not edit by hand.
// Regenerate with \`npm run wiki:content\`; tests/guide.test.ts checks it stays fresh.
// Spec names and ability names are the English sim source (proper nouns); all other
// Guide copy is localized via guide.* t() keys, and rich spec/mastery prose resolves
// live through src/ui/talent_i18n.ts. No balance numbers or instanced spoilers here.

export type GuideRole = 'tank' | 'healer' | 'dps';
export type GuideResource = 'rage' | 'mana' | 'energy';

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

export interface GuideWarlockPet { id: string; name: string; model: string; tint?: string; still?: string; }

// Druid shapeshift forms. Unnamed on purpose: the gallery labels them with guide.models.form*
// keys so the names localize like the rest of the picker chrome.
export interface GuideDruidForm { id: string; model: string; tint?: string; still?: string; }

export interface GuideCreature { name: string; min: number; max: number; rare: boolean; templateId: string; model: string; tint?: string; still?: string; }
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
    `\nexport const GUIDE_MODELS: Record<string, GuideModelSpec> = ${JSON.stringify(MODELS, null, 2)};\n`,
  ].join(''),
);
// eslint-disable-next-line no-console
console.log(
  `generated src/guide/content.generated.ts (${classes.length} classes, ${zones.length} zones, ${dungeons.length} dungeons, ${warlockPets.length} warlock pets, ${druidForms.length} druid forms, ${families.length} families, ${delves.length} delves, ${deeds.length} deeds, ${Object.keys(MODELS).length} models)`,
);
