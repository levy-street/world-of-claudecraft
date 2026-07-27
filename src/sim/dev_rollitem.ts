import {
  PROCEDURAL_LEGENDARY_POWER_IDS,
  PROCEDURAL_LEGENDARY_POWERS,
  proceduralLegendaryPowerCompatibleWithBase,
} from './content/procedural_legendary_powers';
import { PROCEDURAL_ITEM_BASES, PROCEDURAL_RARITIES } from './content/procedural_loot';
import { deriveProceduralItemSeed, generateProceduralItem, hash32Parts } from './loot/procedural';
import type { ItemDropContext, ProceduralRarity } from './procedural_item';
import type { SimContext } from './sim_context';

type ActiveRarity = Exclude<ProceduralRarity, 'mythic'>;

export interface DevRollItemRequest {
  baseId: string;
  rarity: string;
  itemLevel: number;
  seed?: number;
}

export type DevRollItemResult =
  | {
      ok: true;
      uid: string;
      baseId: string;
      rarity: ActiveRarity;
      itemLevel: number;
      seed: number;
    }
  | { ok: false; error: string };

function activeRarity(value: string): ActiveRarity | null {
  const normalized = value.toLowerCase();
  return Object.hasOwn(PROCEDURAL_RARITIES, normalized) ? (normalized as ActiveRarity) : null;
}

/**
 * Development-only exact-instance grant behind SimContext.devCommands.
 *
 * Invalid requests allocate no UID. When a seed is omitted, the current UID lease
 * position produces a deterministic seed without consuming the simulation RNG.
 */
export function grantDevRolledItem(
  ctx: SimContext,
  pid: number,
  request: DevRollItemRequest,
): DevRollItemResult {
  if (!ctx.devCommands) return { ok: false, error: 'Developer commands are disabled.' };
  if (!ctx.entities.has(pid)) return { ok: false, error: 'Unknown recipient.' };

  const base = PROCEDURAL_ITEM_BASES[request.baseId];
  if (!base) return { ok: false, error: `Unknown procedural base '${request.baseId}'.` };
  const rarity = activeRarity(request.rarity);
  if (!rarity)
    return {
      ok: false,
      error: `Unknown rarity '${request.rarity}'. Use common, magic, rare, epic, or legendary.`,
    };
  if (!Number.isInteger(request.itemLevel) || request.itemLevel < 1 || request.itemLevel > 40)
    return { ok: false, error: 'Item level must be an integer from 1 to 40.' };
  if (
    request.seed !== undefined &&
    (!Number.isInteger(request.seed) || request.seed < 1 || request.seed > 0xffffffff)
  )
    return { ok: false, error: 'Seed must be an integer from 1 to 4294967295.' };

  if (
    rarity === 'legendary' &&
    !PROCEDURAL_LEGENDARY_POWER_IDS.some((powerId) =>
      proceduralLegendaryPowerCompatibleWithBase(PROCEDURAL_LEGENDARY_POWERS[powerId], base),
    )
  ) {
    return {
      ok: false,
      error: `Procedural base '${base.id}' has no compatible legendary power.`,
    };
  }

  const uid = ctx.allocateProceduralItemUid();
  const sourceSequence = hash32Parts('dev-rollitem-source-v1', uid);
  const context: ItemDropContext = {
    source: 'dev',
    sourceEntityId: pid,
    sourceSpawnSequence: sourceSequence,
    lootSlotIndex: 0,
    recipientId: pid,
    sourceTemplateId: 'dev_rollitem',
    sourceTags: ['dev', 'rollitem'],
  };
  const seed =
    request.seed ??
    deriveProceduralItemSeed(hash32Parts('dev-rollitem-world-v1', ctx.cfg.seed), context);
  const drop = generateProceduralItem({
    seed,
    uid,
    context,
    basePoolId: 'initial_all',
    rarityTableId: 'initial_world',
    sourceItemLevel: request.itemLevel,
    forcedItemLevel: request.itemLevel,
    forcedBaseId: base.id,
    forcedRarity: rarity,
  });
  ctx.addItemInstance(drop.itemId, drop.instance, pid);
  return {
    ok: true,
    uid,
    baseId: drop.itemId,
    rarity,
    itemLevel: drop.instance.procedural.itemLevel,
    seed,
  };
}
