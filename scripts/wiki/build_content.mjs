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
import * as esbuild from 'esbuild';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outFile = path.join(root, 'src', 'guide', 'content.generated.ts');

const entrySource = `
  export { CLASSES, ABILITIES } from './src/sim/content/classes.ts';
  export { TALENTS } from './src/sim/content/talents.ts';
  export { ALL_CLASSES } from './src/sim/types.ts';
  export { ZONES, DUNGEONS, MOBS } from './src/sim/data.ts';
  export { WARLOCK_PET_MOBS } from './src/sim/content/warlock_pets.ts';
  export { ZONE1_MOBS } from './src/sim/content/zone1.ts';
  export { ZONE2_MOBS } from './src/sim/content/zone2.ts';
  export { ZONE3_MOBS } from './src/sim/content/zone3.ts';
  export { VISUALS, visualKeyFor } from './src/render/characters/manifest.ts';
`;

const built = await esbuild.build({
  stdin: { contents: entrySource, resolveDir: root, sourcefile: 'wiki-content-entry.ts', loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
const dataUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`;
const {
  CLASSES, ABILITIES, TALENTS, ALL_CLASSES, ZONES, DUNGEONS, MOBS, WARLOCK_PET_MOBS,
  ZONE1_MOBS, ZONE2_MOBS, ZONE3_MOBS, VISUALS, visualKeyFor,
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
  const specs = specDefs.map((s) => ({ id: s.id, name: s.name, role: s.role, signature: s.signature }));
  const roles = ROLE_ORDER.filter((r) => specs.some((s) => s.role === r));
  const kit = def.abilities ?? [];
  // The class preview uses the same model + white tint the in-game character creator does.
  const vk = playerVisualKey(id);
  const tint = tintFor(vk, 0xffffff);
  return {
    id,
    color: hex(def.color),
    resource: def.resourceType,
    roles,
    specs,
    signatureAbilities: kit.slice(0, SIGNATURE_COUNT).map(abilityRef),
    abilities: kit.map(abilityRef),
    model: modelKeyFor(vk),
    ...(tint != null ? { tint: hex(tint) } : {}),
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

// Warlock demons, in summon order. Names only; role flavor is authored guide copy.
const warlockPets = Object.values(WARLOCK_PET_MOBS).map((p) => {
  const vk = mobVisualKey(p.id);
  const tint = tintFor(vk, p.color ?? 0xffffff);
  return { id: p.id, name: p.name, model: modelKeyFor(vk), ...(tint != null ? { tint: hex(tint) } : {}) };
});

// Bestiary: OVERWORLD creatures only, grouped by family. Excludes elite/boss (dungeon
// and raid encounters) and warlock pet summons, so nothing here spoils instanced content.
const FAMILY_ORDER = ['beast', 'spider', 'murloc', 'kobold', 'humanoid', 'troll', 'ogre', 'undead', 'elemental', 'dragonkin'];
const famMap = {};
for (const [id, m] of Object.entries({ ...ZONE1_MOBS, ...ZONE2_MOBS, ...ZONE3_MOBS })) {
  if (m.elite || m.boss) continue;
  if (id.startsWith('warlock_')) continue; // summoned pets, not wild creatures
  if (/vision/i.test(id) || /^Vision\b/.test(m.name)) continue; // cinematic apparitions, not creatures
  const vk = mobVisualKey(id);
  const tint = tintFor(vk, m.color ?? 0xffffff);
  (famMap[m.family] ??= new Map()).set(m.name, {
    name: m.name, min: m.minLevel, max: m.maxLevel, rare: !!m.rare,
    templateId: id, model: modelKeyFor(vk), ...(tint != null ? { tint: hex(tint) } : {}),
  });
}
const families = FAMILY_ORDER
  .filter((f) => famMap[f])
  .map((f) => ({
    family: f,
    creatures: [...famMap[f].values()].sort((a, b) => a.min - b.min || a.name.localeCompare(b.name)),
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
}

export interface GuideDungeon {
  id: string;
  isRaid: boolean;
  suggestedPlayers: number;
  min: number | null;
  max: number | null;
  name?: string;
}

export interface GuideWarlockPet { id: string; name: string; model: string; tint?: string; }

export interface GuideCreature { name: string; min: number; max: number; rare: boolean; templateId: string; model: string; tint?: string; }
export interface GuideFamily { family: string; creatures: GuideCreature[]; }
`;

writeFileSync(outFile, [
  header,
  `\nexport const GUIDE_CLASSES: GuideClassInfo[] = ${JSON.stringify(classes, null, 2)};\n`,
  `\nexport const GUIDE_ZONES: GuideZoneInfo[] = ${JSON.stringify(zones, null, 2)};\n`,
  `\nexport const GUIDE_DUNGEONS: GuideDungeon[] = ${JSON.stringify(dungeons, null, 2)};\n`,
  `\nexport const GUIDE_WARLOCK_PETS: GuideWarlockPet[] = ${JSON.stringify(warlockPets, null, 2)};\n`,
  `\nexport const GUIDE_FAMILIES: GuideFamily[] = ${JSON.stringify(families, null, 2)};\n`,
  `\nexport const GUIDE_MODELS: Record<string, GuideModelSpec> = ${JSON.stringify(MODELS, null, 2)};\n`,
].join(''));
// eslint-disable-next-line no-console
console.log(`generated src/guide/content.generated.ts (${classes.length} classes, ${zones.length} zones, ${dungeons.length} dungeons, ${warlockPets.length} warlock pets, ${families.length} families, ${Object.keys(MODELS).length} models)`);
