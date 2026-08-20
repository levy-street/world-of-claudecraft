// Interaction behavior for the development-only Ignivar lore objects. The content
// module owns identity and quest data; this leaf owns only what an interaction says
// and the one progression gate on Ignivar's core. The generic quest-object path still
// owns objective credit, party sharing, readiness, and the per-object ledger.

import { IGNIVAR_HERALD_CORE_OBJECT_ID, IGNIVAR_RECORD_IDS } from './content/ignivar_raid_lore';
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
  [IGNIVAR_HERALD_CORE_OBJECT_ID]:
    "Ignivar's shattered core turns in your hand. Its final plates align into a key bearing Varkhul's maker's mark.",
} as const;

export const IGNIVAR_CORE_SHIELDED_TEXT =
  "Ignivar's core is still shielded by the herald's living flame.";

export interface IgnivarLoreInteractionResult {
  handled: boolean;
  allowQuestCredit: boolean;
}

function livingIgnivarSharesClaim(ctx: SimContext, obj: Entity): boolean {
  const claimId = ctx.instanceClaimIdAt(obj.pos);
  if (claimId === null) return false;
  for (const entity of ctx.entities.values()) {
    if (
      entity.templateId === IGNIVAR_BOSS_ID &&
      !entity.dead &&
      ctx.instanceClaimIdAt(entity.pos) === claimId
    ) {
      return true;
    }
  }
  return false;
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

  if (objectId === IGNIVAR_HERALD_CORE_OBJECT_ID && livingIgnivarSharesClaim(ctx, obj)) {
    ctx.error(meta.entityId, IGNIVAR_CORE_SHIELDED_TEXT);
    return { handled: true, allowQuestCredit: false };
  }

  ctx.emit({
    type: 'log',
    text: IGNIVAR_LORE_TEXT_BY_OBJECT_ID[objectId],
    color: '#f6c66b',
    pid: meta.entityId,
  });
  return { handled: true, allowQuestCredit: true };
}
