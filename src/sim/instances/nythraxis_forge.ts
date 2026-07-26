import { bagCapacity, bagsFullError } from '../bags';
import { HEROIC_MARK_ITEM_ID } from '../content/dungeon_difficulty';
import {
  PROCEDURAL_LEGENDARY_POWERS,
  type ProceduralLegendaryPowerId,
  proceduralLegendaryPowerCompatibleWithBase,
} from '../content/procedural_legendary_powers';
import { proceduralBossLegendarySignatures } from '../content/procedural_legendary_sources';
import { PROCEDURAL_BASE_POOLS, PROCEDURAL_ITEM_BASES } from '../content/procedural_loot';
import {
  DEATHLESS_FRAGMENT_ITEM_ID,
  NYTHRAXIS_FORGE_COSTS,
  NYTHRAXIS_PROCEDURAL_RAID_PROFILES,
  NYTHRAXIS_RAID_BOSS_ID,
  NYTHRAXIS_RAID_DUNGEON_ID,
  nythraxisAuthoredForgeOffer,
} from '../content/procedural_raid_loot';
import { ITEMS } from '../data';
import { canEquipItem } from '../equipment_rules';
import { generateProceduralItem } from '../loot/procedural/generate';
import { hash32Parts } from '../loot/procedural/item_seed';
import { sanitizeItemInstancePayload } from '../procedural_item_validation';
import { assertProceduralUidAvailable } from '../procedural_persistence';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import {
  cloneItemInstancePayload,
  type Entity,
  type InvSlot,
  type ItemInstancePayload,
} from '../types';
import { heroicLockoutId, heroicRewardWindowToken } from './dungeons';
import { heroicVendorInRange } from './heroic_vendor';

export type NythraxisForgeOfferKind =
  | 'normal_procedural_epic'
  | 'heroic_procedural_epic'
  | 'raid_forged_signature'
  | 'heroic_authored_epic'
  | 'heroic_authored_legendary';

export interface NythraxisForgeOfferResolution {
  kind: NythraxisForgeOfferKind;
  itemId: string;
  baseId?: string;
  powerId?: ProceduralLegendaryPowerId;
  fragments: number;
  heroicMarks: number;
  heroic: boolean;
}

interface ExactBaggedProceduralItem {
  slot: InvSlot;
  itemId: string;
  payload: ItemInstancePayload;
}

const NYTHRAXIS_SIGNATURES = new Set(proceduralBossLegendarySignatures(NYTHRAXIS_RAID_BOSS_ID));

function proceduralOffer(
  kind: Extract<NythraxisForgeOfferKind, 'normal_procedural_epic' | 'heroic_procedural_epic'>,
  baseId: string,
): NythraxisForgeOfferResolution | null {
  if (!PROCEDURAL_BASE_POOLS.nythraxis_raid.baseIds.includes(baseId)) return null;
  const heroic = kind === 'heroic_procedural_epic';
  const cost = heroic
    ? NYTHRAXIS_FORGE_COSTS.heroicProceduralEpic
    : NYTHRAXIS_FORGE_COSTS.normalProceduralEpic;
  return { kind, itemId: baseId, baseId, ...cost, heroic };
}

function signatureOffer(powerId: string, baseId: string): NythraxisForgeOfferResolution | null {
  if (!NYTHRAXIS_SIGNATURES.has(powerId as ProceduralLegendaryPowerId)) return null;
  const power = PROCEDURAL_LEGENDARY_POWERS[powerId as ProceduralLegendaryPowerId];
  const base = PROCEDURAL_ITEM_BASES[baseId];
  if (!power || !base || !PROCEDURAL_BASE_POOLS.nythraxis_raid.baseIds.includes(baseId))
    return null;
  if (!proceduralLegendaryPowerCompatibleWithBase(power, base)) return null;
  return {
    kind: 'raid_forged_signature',
    itemId: baseId,
    baseId,
    powerId: power.id,
    ...NYTHRAXIS_FORGE_COSTS.raidForgedSignature,
    heroic: true,
  };
}

export function resolveNythraxisForgeOffer(offerId: string): NythraxisForgeOfferResolution | null {
  const [family, first, second, extra] = offerId.split(':');
  if (extra !== undefined) return null;
  if (family === 'normal' && first && second === undefined)
    return proceduralOffer('normal_procedural_epic', first);
  if (family === 'heroic' && first && second === undefined)
    return proceduralOffer('heroic_procedural_epic', first);
  if (family === 'signature' && first && second) return signatureOffer(first, second);
  const authored = nythraxisAuthoredForgeOffer(offerId);
  if (!authored) return null;
  const kind =
    authored.quality === 'legendary' ? 'heroic_authored_legendary' : 'heroic_authored_epic';
  const cost =
    authored.quality === 'legendary'
      ? NYTHRAXIS_FORGE_COSTS.heroicAuthoredLegendary
      : NYTHRAXIS_FORGE_COSTS.heroicAuthoredEpic;
  return {
    kind,
    itemId: authored.itemId,
    ...cost,
    heroic: true,
  };
}

function currentHeroicClear(ctx: SimContext, meta: PlayerMeta): boolean {
  const lockId = heroicLockoutId(NYTHRAXIS_RAID_DUNGEON_ID);
  const now = ctx.lockoutNowMs();
  const until = meta.raidLockouts.get(lockId) ?? 0;
  if (until <= now) {
    meta.raidLockouts.delete(lockId);
    return false;
  }
  const rewardWindow = heroicRewardWindowToken(ctx.raidResetMs(now));
  return (
    meta.heroicDaily.date === rewardWindow && meta.heroicDaily.marked.has(NYTHRAXIS_RAID_DUNGEON_ID)
  );
}

function validateServiceAccess(ctx: SimContext, p: Entity, meta: PlayerMeta): boolean {
  if (p.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return false;
  }
  if (!heroicVendorInRange(ctx, p)) {
    ctx.error(meta.entityId, 'Too far away.');
    return false;
  }
  return true;
}

function canAfford(
  ctx: SimContext,
  meta: PlayerMeta,
  cost: Pick<NythraxisForgeOfferResolution, 'fragments' | 'heroicMarks'>,
): boolean {
  const fragments = ctx.countFungibleItem(DEATHLESS_FRAGMENT_ITEM_ID, meta.entityId);
  const marks = ctx.countFungibleItem(HEROIC_MARK_ITEM_ID, meta.entityId);
  if (fragments >= cost.fragments && marks >= cost.heroicMarks) return true;
  ctx.error(
    meta.entityId,
    `You need ${cost.fragments} Deathless Fragments and ${cost.heroicMarks} Heroic Marks.`,
  );
  return false;
}

function spend(
  ctx: SimContext,
  meta: PlayerMeta,
  cost: Pick<NythraxisForgeOfferResolution, 'fragments' | 'heroicMarks'>,
): void {
  if (cost.fragments > 0)
    ctx.removeFungibleItem(DEATHLESS_FRAGMENT_ITEM_ID, cost.fragments, meta.entityId);
  if (cost.heroicMarks > 0)
    ctx.removeFungibleItem(HEROIC_MARK_ITEM_ID, cost.heroicMarks, meta.entityId);
}

function removeFungibleFromScratch(scratch: InvSlot[], itemId: string, count: number): void {
  for (let index = scratch.length - 1; index >= 0 && count > 0; index--) {
    const slot = scratch[index];
    if (slot.itemId !== itemId || slot.instance) continue;
    const take = Math.min(slot.count, count);
    slot.count -= take;
    count -= take;
    if (slot.count <= 0) scratch.splice(index, 1);
  }
}

function forgeRewardFitsAfterSpend(meta: PlayerMeta, cost: NythraxisForgeOfferResolution): boolean {
  const scratch = meta.inventory.map((slot) => ({ ...slot }));
  removeFungibleFromScratch(scratch, DEATHLESS_FRAGMENT_ITEM_ID, cost.fragments);
  removeFungibleFromScratch(scratch, HEROIC_MARK_ITEM_ID, cost.heroicMarks);
  // Every forge output is one exact instanced equipment copy, so it needs a fresh slot.
  return scratch.length < bagCapacity(meta.bags);
}

function forgedContext(meta: PlayerMeta, offerId: string, heroic: boolean, uid: string) {
  return {
    source: 'raid' as const,
    sourceEntityId: meta.entityId,
    sourceSpawnSequence: hash32Parts('nythraxis-forge-source-v1', offerId, uid),
    lootSlotIndex: 0,
    recipientId: meta.entityId,
    sourceTemplateId: NYTHRAXIS_RAID_BOSS_ID,
    sourceTags: ['raid', 'boss', 'forge', heroic ? 'heroic' : 'normal'],
  };
}

function generatedForgePayload(
  ctx: SimContext,
  meta: PlayerMeta,
  offerId: string,
  offer: NythraxisForgeOfferResolution,
): ItemInstancePayload {
  const uid = ctx.allocateProceduralItemUid();
  const profile = offer.heroic
    ? NYTHRAXIS_PROCEDURAL_RAID_PROFILES.heroic
    : NYTHRAXIS_PROCEDURAL_RAID_PROFILES.normal;
  const legendary = offer.kind === 'raid_forged_signature';
  return {
    ...generateProceduralItem({
      seed: hash32Parts('nythraxis-forge-v1', ctx.cfg.seed, offerId, uid),
      uid,
      context: forgedContext(meta, offerId, offer.heroic, uid),
      basePoolId: 'nythraxis_raid',
      rarityTableId: profile.rarityTableId,
      sourceItemLevel: 22,
      forcedBaseId: offer.baseId,
      forcedRarity: legendary ? 'legendary' : 'epic',
      forcedItemLevel: legendary ? profile.itemLevels.legendary : profile.itemLevels.epic,
      personalLootClass: meta.cls,
      ...(offer.powerId && { forcedLegendaryPowerId: offer.powerId }),
      ...(legendary && {
        legendaryMagnitudeFloor: profile.legendaryMagnitudeFloor,
        raidForgedLegendary: true,
      }),
    }).instance,
    boundTo: meta.entityId,
  };
}

export function forgeNythraxisReward(ctx: SimContext, offerId: string, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  const offer = resolveNythraxisForgeOffer(offerId);
  if (!offer) {
    ctx.error(meta.entityId, 'That Deathless forge offer does not exist.');
    return;
  }
  const def = ITEMS[offer.itemId];
  const power = offer.powerId ? PROCEDURAL_LEGENDARY_POWERS[offer.powerId] : undefined;
  if (
    !def ||
    !canEquipItem(meta.cls, def) ||
    (power && 'requiredClass' in power && power.requiredClass !== meta.cls)
  ) {
    ctx.error(meta.entityId, 'Your class cannot use that reward.');
    return;
  }
  if (!validateServiceAccess(ctx, p, meta)) return;
  if (offer.heroic && !currentHeroicClear(ctx, meta)) {
    ctx.error(meta.entityId, 'Defeat Heroic Nythraxis in the current raid reset first.');
    return;
  }
  if (!canAfford(ctx, meta, offer)) return;
  if (!forgeRewardFitsAfterSpend(meta, offer)) {
    bagsFullError(ctx, meta.entityId);
    return;
  }

  const payload = offer.baseId
    ? generatedForgePayload(ctx, meta, offerId, offer)
    : ({ boundTo: meta.entityId } satisfies ItemInstancePayload);
  const validated = sanitizeItemInstancePayload(payload, offer.itemId);
  if (!validated.ok) throw new Error(`Nythraxis forge generated invalid item: ${validated.error}`);
  assertProceduralUidAvailable(
    {
      inventory: meta.inventory,
      bank: meta.bank.inventory,
      buyback: meta.vendorBuyback,
      equipmentInstance: meta.equipmentInstance,
    },
    validated.value,
  );
  spend(ctx, meta, offer);
  ctx.addItemInstance(offer.itemId, validated.value, meta.entityId);
  ctx.emit({ type: 'vendor', action: 'buy', itemId: offer.itemId, pid: meta.entityId });
}

function exactBaggedProceduralItem(
  meta: PlayerMeta,
  instanceUid: string,
): ExactBaggedProceduralItem | null {
  let found: ExactBaggedProceduralItem | null = null;
  for (let index = meta.inventory.length - 1; index >= 0; index--) {
    const slot = meta.inventory[index];
    if (slot.instance?.procedural?.uid !== instanceUid) continue;
    if (slot.count !== 1 || found) return null;
    found = { slot, itemId: slot.itemId, payload: slot.instance };
  }
  return found;
}

function tunedLegendaryRolls(
  ctx: SimContext,
  meta: PlayerMeta,
  item: ExactBaggedProceduralItem,
  newUid: string,
): Record<string, number> {
  const procedural = item.payload.procedural!;
  const candidateRolls = ['a', 'b'].map(
    (candidate) =>
      generateProceduralItem({
        seed: hash32Parts('nythraxis-tune-v1', ctx.cfg.seed, procedural.uid, newUid, candidate),
        uid: newUid,
        context: procedural.dropContext!,
        basePoolId: 'nythraxis_raid',
        rarityTableId: procedural.raidForged
          ? NYTHRAXIS_PROCEDURAL_RAID_PROFILES.heroic.rarityTableId
          : NYTHRAXIS_PROCEDURAL_RAID_PROFILES.normal.rarityTableId,
        sourceItemLevel: procedural.itemLevel,
        forcedBaseId: procedural.baseId,
        forcedRarity: 'legendary',
        forcedItemLevel: procedural.itemLevel,
        forcedLegendaryPowerId: procedural.legendaryPowerId as ProceduralLegendaryPowerId,
        personalLootClass: meta.cls,
        ...(procedural.raidForged && {
          legendaryMagnitudeFloor:
            NYTHRAXIS_PROCEDURAL_RAID_PROFILES.heroic.legendaryMagnitudeFloor,
          raidForgedLegendary: true,
        }),
      }).instance.procedural.legendaryRolls!,
  );
  return Object.fromEntries(
    Object.entries(procedural.legendaryRolls!).map(([key, current]) => [
      key,
      Math.max(current, candidateRolls[0][key], candidateRolls[1][key]),
    ]),
  );
}

export function tuneNythraxisLegendary(ctx: SimContext, instanceUid: string, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  if (!validateServiceAccess(ctx, p, meta)) return;
  const selected = exactBaggedProceduralItem(meta, instanceUid);
  const procedural = selected?.payload.procedural;
  if (
    !selected ||
    !procedural ||
    procedural.rarity !== 'legendary' ||
    procedural.dropContext?.source !== 'raid' ||
    procedural.dropContext.sourceTemplateId !== NYTHRAXIS_RAID_BOSS_ID ||
    !procedural.legendaryPowerId ||
    !procedural.legendaryRolls
  ) {
    ctx.error(meta.entityId, 'That exact Nythraxis Legendary is no longer in your bags.');
    return;
  }
  const power =
    PROCEDURAL_LEGENDARY_POWERS[procedural.legendaryPowerId as ProceduralLegendaryPowerId];
  if (!power || ('requiredClass' in power && power.requiredClass !== meta.cls)) {
    ctx.error(meta.entityId, 'Your class cannot tune that Legendary power.');
    return;
  }
  const cost = NYTHRAXIS_FORGE_COSTS.legendaryPowerTune;
  if (!canAfford(ctx, meta, cost)) return;

  const newUid = ctx.allocateProceduralItemUid();
  const replacement = cloneItemInstancePayload(selected.payload);
  replacement.procedural = {
    ...procedural,
    uid: newUid,
    seed: hash32Parts('nythraxis-tune-result-v1', ctx.cfg.seed, procedural.uid, newUid),
    legendaryRolls: tunedLegendaryRolls(ctx, meta, selected, newUid),
    reforgeCount: Math.min(99, (procedural.reforgeCount ?? 0) + 1),
  };
  const validated = sanitizeItemInstancePayload(replacement, selected.itemId);
  if (!validated.ok) throw new Error(`Nythraxis tune generated invalid item: ${validated.error}`);
  assertProceduralUidAvailable(
    {
      inventory: meta.inventory,
      bank: meta.bank.inventory,
      buyback: meta.vendorBuyback,
      equipmentInstance: meta.equipmentInstance,
    },
    validated.value,
  );

  spend(ctx, meta, cost);
  selected.slot.instance = validated.value;
  ctx.onInventoryChangedForQuests(meta);
  ctx.emit({ type: 'vendor', action: 'buy', itemId: selected.itemId, pid: meta.entityId });
}
