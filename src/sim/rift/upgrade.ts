// Validation and application of data-only Dungeon Upgrader artifacts. This is
// shared by the authoritative sim and renderer, so upgraded content remains
// deterministic without transmitting generated geometry.

import { RIFT_MOBS, RIFT_TRASH_IDS } from '../content/rift/mobs';
import { RIFT_MONSTER_BY_ID, riftMonsterCompatible } from '../content/rift/monster_index';
import { RIFT_THEMES } from '../content/rift/themes';
import { Rng } from '../rng';
import { buildStyle, mixSeed } from './style';
import type {
  RiftAssetRequest,
  RiftEncounterPacing,
  RiftFloorPlan,
  RiftFloorUpgrade,
  RiftUpgradeManifest,
} from './types';

const MAX_TITLE = 96;
const MAX_PROSE = 600;
const MAX_LORE_LINES = 8;
const MAX_DETAILS = 6;
const MAX_ASSET_REQUESTS = 2;
const PACING = new Set<RiftEncounterPacing>(['breather', 'pressure', 'climax']);
const EVENTS = new Set<RiftFloorUpgrade['specialEvent']>([
  'none',
  'ambush',
  'ritual',
  'hazard',
  'treasure',
]);
const ASSET_KINDS = new Set<RiftAssetRequest['kind']>(['boss_model', 'prop_model', 'texture']);
const THEME_IDS = new Set([...RIFT_THEMES.map((theme) => theme.id), 'infernal_citadel']);

export interface RiftUpgradeValidation {
  ok: boolean;
  value: RiftUpgradeManifest | null;
  errors: string[];
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  let cleaned = '';
  for (const character of value) {
    const code = character.charCodeAt(0);
    cleaned += code < 32 || code === 127 ? ' ' : character;
  }
  cleaned = cleaned.trim();
  return cleaned.length > 0 && cleaned.length <= max ? cleaned : null;
}

function stringList(value: unknown, maxItems: number, maxLength: number): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const out: string[] = [];
  for (const candidate of value) {
    const cleaned = text(candidate, maxLength);
    if (cleaned === null) return null;
    out.push(cleaned);
  }
  return out;
}

/** Strictly sanitize untrusted model/service output. Unknown keys are ignored,
 * but every consumed field is rebuilt into a fresh bounded object. */
export function validateRiftUpgrade(
  input: unknown,
  expectedFloorCount?: number,
): RiftUpgradeValidation {
  const errors: string[] = [];
  const root = record(input);
  if (!root) return { ok: false, value: null, errors: ['manifest must be an object'] };
  if (root.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  const title = text(root.title, MAX_TITLE);
  const synopsis = text(root.synopsis, MAX_PROSE);
  const lore = stringList(root.lore, MAX_LORE_LINES, MAX_PROSE);
  if (!title) errors.push('invalid title');
  if (!synopsis) errors.push('invalid synopsis');
  if (!lore) errors.push('invalid lore');

  const floorInputs = Array.isArray(root.floors) ? root.floors : [];
  if (expectedFloorCount !== undefined && floorInputs.length !== expectedFloorCount) {
    errors.push(`expected ${expectedFloorCount} floors`);
  }
  if (floorInputs.length < 1 || floorInputs.length > 8) errors.push('invalid floor count');
  const floors: RiftFloorUpgrade[] = [];
  for (let i = 0; i < floorInputs.length; i++) {
    const floor = record(floorInputs[i]);
    if (!floor || floor.floorIndex !== i) {
      errors.push(`floor ${i} has invalid index`);
      continue;
    }
    const themeId = text(floor.themeId, 40);
    const pacing = floor.pacing as RiftEncounterPacing;
    const specialEvent = floor.specialEvent as RiftFloorUpgrade['specialEvent'];
    const monsterIds = stringList(floor.monsterIds, 8, 80);
    const environmentalDetails = stringList(floor.environmentalDetails, MAX_DETAILS, 180);
    if (!themeId || !THEME_IDS.has(themeId)) errors.push(`floor ${i} has invalid theme`);
    if (!PACING.has(pacing)) errors.push(`floor ${i} has invalid pacing`);
    if (!EVENTS.has(specialEvent)) errors.push(`floor ${i} has invalid special event`);
    if (!monsterIds || monsterIds.length === 0) errors.push(`floor ${i} has no monsters`);
    if (
      monsterIds?.some(
        (id) =>
          !RIFT_MONSTER_BY_ID[id] ||
          RIFT_MONSTER_BY_ID[id].role === 'boss' ||
          (!!themeId && !riftMonsterCompatible(id, themeId)),
      )
    ) {
      errors.push(`floor ${i} contains an incompatible monster`);
    }
    if (!environmentalDetails) errors.push(`floor ${i} has invalid environment details`);
    if (
      themeId &&
      THEME_IDS.has(themeId) &&
      PACING.has(pacing) &&
      EVENTS.has(specialEvent) &&
      monsterIds &&
      monsterIds.length > 0 &&
      environmentalDetails
    ) {
      floors.push({
        floorIndex: i,
        themeId,
        pacing,
        monsterIds,
        specialEvent,
        environmentalDetails,
      });
    }
  }

  const bossInput = record(root.boss);
  const bossTemplateId = text(bossInput?.templateId, 80);
  const bossName = text(bossInput?.name, MAX_TITLE);
  const bossConcept = text(bossInput?.concept, MAX_PROSE);
  if (!bossTemplateId || !RIFT_MOBS[bossTemplateId]?.boss) errors.push('invalid boss template');
  const finalThemeId = floors[floors.length - 1]?.themeId;
  if (bossTemplateId && finalThemeId && !riftMonsterCompatible(bossTemplateId, finalThemeId)) {
    errors.push('boss is incompatible with final theme');
  }
  if (!bossName) errors.push('invalid boss name');
  if (!bossConcept) errors.push('invalid boss concept');

  const rewardsInput = record(root.rewards);
  const lootMultiplier = rewardsInput?.lootMultiplier;
  const craftingMaterialBias = rewardsInput?.craftingMaterialBias;
  if (typeof lootMultiplier !== 'number' || lootMultiplier < 0.5 || lootMultiplier > 2) {
    errors.push('invalid loot multiplier');
  }
  if (
    typeof craftingMaterialBias !== 'number' ||
    craftingMaterialBias < 0 ||
    craftingMaterialBias > 1
  ) {
    errors.push('invalid crafting material bias');
  }

  const requestsInput = Array.isArray(root.assetRequests) ? root.assetRequests : [];
  if (requestsInput.length > MAX_ASSET_REQUESTS) errors.push('too many asset requests');
  const assetRequests: RiftAssetRequest[] = [];
  for (const candidate of requestsInput.slice(0, MAX_ASSET_REQUESTS)) {
    const request = record(candidate);
    const requestId = text(request?.requestId, 64);
    const kind = request?.kind as RiftAssetRequest['kind'];
    const prompt = text(request?.prompt, 500);
    if (!requestId || !ASSET_KINDS.has(kind) || !prompt || typeof request?.required !== 'boolean') {
      errors.push('invalid asset request');
      continue;
    }
    assetRequests.push({ requestId, kind, prompt, required: request.required });
  }

  if (
    errors.length > 0 ||
    !title ||
    !synopsis ||
    !lore ||
    !bossTemplateId ||
    !bossName ||
    !bossConcept ||
    typeof lootMultiplier !== 'number' ||
    typeof craftingMaterialBias !== 'number'
  ) {
    return { ok: false, value: null, errors };
  }
  return {
    ok: true,
    errors: [],
    value: {
      schemaVersion: 1,
      title,
      synopsis,
      lore,
      floors,
      boss: { templateId: bossTemplateId, name: bossName, concept: bossConcept },
      rewards: {
        lootMultiplier,
        craftingMaterialBias,
      },
      assetRequests,
    },
  };
}

export function riftUpgradeHash(manifest: RiftUpgradeManifest): string {
  const json = JSON.stringify(manifest);
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Apply only bounded selections to a cloned floor. Layout and mechanics remain
 * generated by the battle-tested procedural system; the artifact improves its
 * thematic arc, roster, pacing, boss identity, and descriptive context. */
export function applyRiftUpgrade(
  floor: RiftFloorPlan,
  manifest: RiftUpgradeManifest | null | undefined,
): RiftFloorPlan {
  if (!manifest) return floor;
  const directive = manifest.floors[floor.floorIndex];
  if (!directive || floor.authored) {
    return floor.isBoss ? { ...floor, name: manifest.title } : floor;
  }
  const theme = RIFT_THEMES.find((candidate) => candidate.id === directive.themeId);
  if (!theme) return floor;
  // Only SPAWN-LIST templates may be substituted into a spawn list. Excluding
  // bosses is not enough: the shared summoned-add templates (rift_spawnling,
  // rift_bonewalker) are non-boss AND appear in the bone/void/citadel theme
  // rosters, so a manifest could seed them as trash. They are non-elite with
  // roughly half a trash template's base weapon damage, so on the trash
  // multiplier they land ~45% under the rank's trash floor
  // (tests/rift_difficulty_floors.test.ts), and they carry no loot table at
  // all, so a pack of them pays nothing. A manifest listing only adds leaves
  // the generated templates in place, which is the safe fallback. Manifests can
  // arrive from an optional server-side AI service, so this filter is a trust
  // boundary, not just a tidy-up.
  const spawnable = new Set<string>(RIFT_TRASH_IDS);
  const trash = directive.monsterIds.filter((id) => spawnable.has(id));
  let trashIndex = 0;
  let spawns = floor.spawns.map((spawn) => {
    if (spawn.boss) {
      return {
        ...spawn,
        templateId: manifest.boss.templateId,
        name: manifest.boss.name,
      };
    }
    if (spawn.miniboss || trash.length === 0) return { ...spawn };
    const templateId = trash[trashIndex++ % trash.length];
    return { ...spawn, templateId };
  });
  if (directive.pacing === 'breather' && !floor.isBoss) {
    let seen = 0;
    spawns = spawns.filter((spawn) => spawn.boss || spawn.miniboss || ++seen % 4 !== 0);
  }
  const style = buildStyle(new Rng(mixSeed(floor.seed, 0xa100 + floor.floorIndex * 97)), theme);
  return {
    ...floor,
    name: floor.isBoss
      ? manifest.title
      : `${manifest.title}: ${theme.name} Depth ${floor.floorIndex + 1}`,
    themeName: theme.name,
    style,
    spawns,
  };
}
