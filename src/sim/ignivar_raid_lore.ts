// Narrative behavior for the development-only Ignivar raid. Optional records remain
// readable through the generic object path, while combat revelations ride the real
// mob-death path and the existing interest-scoped log event.

import { IGNIVAR_RECORD_IDS } from './content/ignivar_raid_lore';
import {
  IGNIVAR_CINDER_ARTIFICER_ID,
  IGNIVAR_CRUCIBLE_WARDEN_ID,
  IGNIVAR_EMBER_SENTINEL_ID,
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_RAID_ARENA_ID,
  IGNIVAR_SECOND_WING_ID,
  VARKHUL_BOSS_ID,
} from './ignivar_raid_ids';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { type Entity, IGNIVAR_BOSS_ID } from './types';

export const IGNIVAR_LORE_TEXT_BY_OBJECT_ID = {
  [IGNIVAR_RECORD_IDS.firstTempering]:
    'Tempering Record I: "Water remembers shape. Fire commands it to endure."',
  [IGNIVAR_RECORD_IDS.livingMetal]:
    'Tempering Record II: "The spring rejects every shell. Begin again with a living core."',
  [IGNIVAR_RECORD_IDS.heraldKey]:
    'Tempering Record III: "Ignivar endures. The herald shall carry my seal and guard the path below."',
} as const;

export const IGNIVAR_RAID_NARRATIVE_TEXT_BY_TEMPLATE = {
  [IGNIVAR_EMBER_SENTINEL_ID]:
    'Maelin\'s projection crackles: "The first shells held the flame, but nothing lived within them."',
  [IGNIVAR_CRUCIBLE_WARDEN_ID]:
    'Maelin\'s projection crackles: "Varkhul forced the Last Spring into the metal. The water became its blood."',
  [IGNIVAR_CINDER_ARTIFICER_ID]:
    'Maelin\'s projection crackles: "Ignivar was the first design to endure. He is not merely a herald. He is the key."',
  [IGNIVAR_BOSS_ID]:
    "Ignivar's core fractures. Its plates turn toward the Inner Crucible, and the sealed gate answers.",
  [VARKHUL_BOSS_ID]:
    'The Grand Forge gutters out. For the first time in an age, the Last Spring is silent and free.',
} as const;

export interface IgnivarLoreInteractionResult {
  handled: boolean;
  allowQuestCredit: boolean;
}

export function interactIgnivarRaidLore(
  ctx: SimContext,
  obj: Entity,
  meta: PlayerMeta,
): IgnivarLoreInteractionResult {
  const objectId = obj.objectItemId as keyof typeof IGNIVAR_LORE_TEXT_BY_OBJECT_ID | null;
  if (!objectId || !(objectId in IGNIVAR_LORE_TEXT_BY_OBJECT_ID)) {
    return { handled: false, allowQuestCredit: true };
  }

  ctx.emit({
    type: 'log',
    text: IGNIVAR_LORE_TEXT_BY_OBJECT_ID[objectId],
    color: '#f6c66b',
    pid: meta.entityId,
  });
  return { handled: true, allowQuestCredit: true };
}

const APPROACH_NARRATIVE_TEMPLATE_IDS: readonly string[] = [
  IGNIVAR_EMBER_SENTINEL_ID,
  IGNIVAR_CRUCIBLE_WARDEN_ID,
  IGNIVAR_CINDER_ARTIFICER_ID,
];

export function emitIgnivarRaidNarrativeOnDeath(ctx: SimContext, mob: Entity): void {
  const text =
    IGNIVAR_RAID_NARRATIVE_TEXT_BY_TEMPLATE[
      mob.templateId as keyof typeof IGNIVAR_RAID_NARRATIVE_TEXT_BY_TEMPLATE
    ];
  if (!text) return;
  const instance = ctx.instances.find(
    (candidate) => candidate.partyKey !== null && candidate.mobIds.includes(mob.id),
  );
  if (!instance) return;

  if (APPROACH_NARRATIVE_TEMPLATE_IDS.includes(mob.templateId)) {
    if (instance.dungeonId !== IGNIVAR_FORGE_APPROACH_ID) return;
    const sameTemplateLives = instance.mobIds.some((id) => {
      const candidate = ctx.entities.get(id);
      return candidate?.templateId === mob.templateId && !candidate.dead;
    });
    if (sameTemplateLives) return;
  } else if (
    (mob.templateId === IGNIVAR_BOSS_ID && instance.dungeonId !== IGNIVAR_RAID_ARENA_ID) ||
    (mob.templateId === VARKHUL_BOSS_ID && instance.dungeonId !== IGNIVAR_SECOND_WING_ID)
  ) {
    return;
  }

  ctx.emit({
    type: 'log',
    text,
    color: '#f6c66b',
    entityId: mob.id,
  });
}
