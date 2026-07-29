// Procedural-draft projection plus the deterministic local Dungeon Upgrader.
// The local artifact is immediately playable and doubles as the fallback when
// an optional server-side AI service is disabled, slow, invalid, or over budget.

import { queryRiftMonsters, RIFT_MONSTER_BY_ID } from '../content/rift/monster_index';
import { RIFT_THEMES } from '../content/rift/themes';
import type { SimContext } from '../sim_context';
import { generateRiftFloor, generateRiftPlan, isSetPieceRift } from './rift_gen';
import type { RiftEvent, RiftUpgradeManifest } from './types';
import { riftUpgradeHash, validateRiftUpgrade } from './upgrade';

export interface RiftDungeonDraftFloor {
  floorIndex: number;
  name: string;
  themeId: string;
  themeName: string;
  isBoss: boolean;
  puzzle: string;
  hazards: number;
  rollers: number;
  monsterIds: string[];
}

export interface RiftDungeonDraft {
  seed: number;
  baseLevel: number;
  name: string;
  floorCount: number;
  authored: boolean;
  floors: RiftDungeonDraftFloor[];
  monsterIndex: Array<{
    id: string;
    name: string;
    family: string;
    role: string;
    rarity: string;
    themes: readonly string[];
    abilities: readonly string[];
    lore: string;
  }>;
}

function themeIdForName(name: string): string {
  return RIFT_THEMES.find((theme) => theme.name === name)?.id ?? 'infernal_citadel';
}

export function buildRiftDungeonDraft(seed: number, baseLevel: number): RiftDungeonDraft {
  const plan = generateRiftPlan(seed, baseLevel);
  const floors: RiftDungeonDraftFloor[] = [];
  const relevantMonsterIds = new Set<string>();
  for (let floorIndex = 0; floorIndex < plan.floorCount; floorIndex++) {
    const floor = generateRiftFloor(seed, baseLevel, floorIndex);
    const themeId = themeIdForName(floor.themeName);
    const monsterIds = [...new Set(floor.spawns.map((spawn) => spawn.templateId))];
    for (const id of monsterIds) relevantMonsterIds.add(id);
    for (const monster of queryRiftMonsters({ themeId })) relevantMonsterIds.add(monster.id);
    floors.push({
      floorIndex,
      name: floor.name,
      themeId,
      themeName: floor.themeName,
      isBoss: floor.isBoss,
      puzzle: floor.puzzle.kind,
      hazards: floor.hazards.length,
      rollers: floor.rollers.length,
      monsterIds,
    });
  }
  return {
    seed: seed >>> 0,
    baseLevel: Math.round(baseLevel),
    name: plan.name,
    floorCount: plan.floorCount,
    authored: isSetPieceRift(seed, baseLevel),
    floors,
    monsterIndex: [...relevantMonsterIds]
      .map((id) => RIFT_MONSTER_BY_ID[id])
      .filter((entry): entry is NonNullable<typeof entry> => !!entry)
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        family: entry.family,
        role: entry.role,
        rarity: entry.rarity,
        themes: entry.themes,
        abilities: entry.abilities,
        lore: entry.lore,
      })),
  };
}

function floorSpecialEvent(
  floor: RiftDungeonDraftFloor,
): RiftUpgradeManifest['floors'][number]['specialEvent'] {
  if (floor.isBoss) return 'ritual';
  if (floor.puzzle !== 'none') return 'ritual';
  if (floor.hazards > 0 || floor.rollers > 0) return 'hazard';
  return floor.floorIndex % 3 === 0 ? 'treasure' : 'ambush';
}

/** A coherent deterministic artifact built from the generated draft. It never
 * invents mechanics or templates, so it is the safe baseline and AI fallback. */
export function buildHeuristicRiftUpgrade(draft: RiftDungeonDraft): RiftUpgradeManifest | null {
  const finalFloor = draft.floors[draft.floors.length - 1];
  const finalBoss = finalFloor?.monsterIds
    .map((id) => RIFT_MONSTER_BY_ID[id])
    .find((entry) => entry?.role === 'boss');
  if (!finalFloor || !finalBoss) return null;
  const manifest: RiftUpgradeManifest = {
    schemaVersion: 1,
    title: draft.name,
    synopsis: `A ${draft.floorCount}-stage descent whose environments converge on ${finalBoss.name}.`,
    lore: [
      `The breach has drawn creatures from ${[...new Set(draft.floors.map((floor) => floor.themeName))].join(', ')} into one unstable domain.`,
      `${finalBoss.name} anchors the fracture and must fall before it can be sealed.`,
    ],
    floors: draft.floors.map((floor) => {
      const compatible = queryRiftMonsters({ themeId: floor.themeId, bosses: false }).map(
        (entry) => entry.id,
      );
      const existingTrash = floor.monsterIds.filter(
        (id) => RIFT_MONSTER_BY_ID[id]?.role !== 'boss',
      );
      return {
        floorIndex: floor.floorIndex,
        themeId: floor.themeId,
        pacing: floor.isBoss
          ? ('climax' as const)
          : floor.floorIndex === 0
            ? ('breather' as const)
            : ('pressure' as const),
        monsterIds: [...new Set([...existingTrash, ...compatible])].slice(0, 4),
        specialEvent: floorSpecialEvent(floor),
        environmentalDetails: [
          `${floor.themeName} architecture carries scars from the neighboring floor.`,
          floor.hazards > 0 || floor.rollers > 0
            ? 'Traversal hazards foreshadow the guardian ahead.'
            : 'A quieter approach gives the party room to read the next encounter.',
        ],
      };
    }),
    boss: {
      templateId: finalBoss.id,
      name: finalBoss.name,
      concept: `${finalBoss.lore} Its existing ${finalBoss.abilities.join(', ') || 'melee'} mechanics form the climax.`,
    },
    rewards: { lootMultiplier: 1, craftingMaterialBias: 0.25 },
    assetRequests: [
      {
        requestId: `boss-${draft.seed.toString(36)}`,
        kind: 'boss_model',
        prompt: `${finalBoss.name}, ${finalFloor.themeName} Rift guardian; preserve readable combat silhouette.`,
        required: false,
      },
    ],
  };
  return validateRiftUpgrade(manifest, draft.floorCount).value;
}

export function installRiftUpgrade(
  ctx: SimContext,
  eventId: string,
  input: unknown,
  source: 'ai' | 'heuristic',
): boolean {
  const event = ctx.riftEvents.find((candidate) => candidate.eventId === eventId);
  if (!event || event.contentLocked || event.status === 'cleared' || event.status === 'collapsed') {
    return false;
  }
  const floorCount = generateRiftPlan(event.seed, event.baseLevel).floorCount;
  const validation = validateRiftUpgrade(input, floorCount);
  if (!validation.value) return false;
  event.upgrade = validation.value;
  event.upgradeStatus = source === 'ai' ? 'ready' : 'heuristic';
  const hash = riftUpgradeHash(validation.value);
  event.contentId = `${source}-upgrade-v1:${event.seed}:${event.baseLevel}:${hash}`;
  event.contentHash = hash;
  event.riftName = validation.value.title;
  const portal = ctx.naturalRiftPortals.find((candidate) => candidate.eventId === eventId);
  if (portal) {
    portal.riftName = validation.value.title;
    const entity = ctx.entities.get(portal.id);
    if (entity) entity.name = validation.value.title;
  }
  return true;
}

export function markRiftUpgradePending(ctx: SimContext, eventId: string): boolean {
  const event = ctx.riftEvents.find((candidate) => candidate.eventId === eventId);
  if (!event || event.contentLocked || event.status !== 'open') return false;
  event.upgradeStatus = 'pending';
  return true;
}

export function markRiftUpgradeFallback(ctx: SimContext, eventId: string): void {
  const event = ctx.riftEvents.find((candidate) => candidate.eventId === eventId);
  if (event && !event.contentLocked && event.upgradeStatus === 'pending') {
    event.upgradeStatus = 'fallback';
  }
}

export function draftForRiftEvent(event: RiftEvent): RiftDungeonDraft {
  return buildRiftDungeonDraft(event.seed, event.baseLevel);
}
