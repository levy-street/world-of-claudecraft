// Treasure maps and vaults (world quests, Stage 3). The engine behind
// src/sim/content/treasure_maps.ts:
//
//   - reading a map (the `treasureMap` item-use arm) marks a dig site and fixes
//     the vault's Rift seed; the map stays in the bags until the dig;
//   - using it again on the X spends it and opens a private vault portal, an
//     event-less Rift portal (src/sim/rift/) stamped with its owner, so only
//     the owner and their party may enter and the run pays no Rift ladder;
//   - the vault applies fixed solo or five-player tuning based on rarity
//     and, when the boss falls, pays every entrant the rarity's table;
//   - a read map can be redrawn one rarity finer with Cartographer's Ink, which
//     the faction quartermasters sell for their currency.
//
// State lives on PlayerMeta (treasureMap) behind the world-quest save.
// Legacy guest counters remain readable. Every roll draws from ctx.rng in a fixed order.

import {
  CARTOGRAPHERS_INK_ITEM_ID,
  HOARD_SUGGESTED_PLAYERS,
  isTreasureMapRarity,
  nextTreasureMapRarity,
  TREASURE_DIG_RADIUS,
  TREASURE_MAP_DROP_WEIGHTS,
  TREASURE_MAP_ITEM_IDS,
  TREASURE_MAP_RARITIES,
  TREASURE_MAP_RIFT_TIER,
  TREASURE_MAP_UPGRADE_INKS,
  TREASURE_SITES,
  TREASURE_SITES_BY_ID,
  type TreasureMapProgress,
  type TreasureMapRarity,
  vaultDamageFactor,
  vaultHealthFactor,
} from './content/treasure_maps';
import { zoneAt } from './data';
import { createGroundObject } from './entity';
import { mountOwned } from './mounts';
import { hoardOwnerPid, mayRecoverHoardCorpse } from './rift/hoard_party';
import { grantHoardReward } from './rift/hoard_reward_grant';
import { rollHoardReward } from './rift/hoard_reward_roll';
import { RIFT_RANK_BASE_LEVEL, type RiftRankTuning } from './rift/ranks';
import { generateRiftPlan } from './rift/rift_gen';
import type { RiftInstance } from './rift/types';
import {
  HOARD_ENTRANCE_TEMPLATE_ID,
  isVaultZoneId,
  makeVaultSeed,
  OPEN_HOARD_RARITIES,
  type VaultSizeTier,
} from './rift/vault_seed';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { findHoardEntrancePosition } from './treasure_vault_placement';
import type { Entity } from './types';
import {
  completeVaultAttempt,
  expireVaultAttempt,
  VAULT_LIFETIME_MS,
  vaultDeadline,
} from './vault_lifecycle';
import { waterLevelAt } from './world';

export const VAULT_MOUNT_KEY = 'lanternback_troll';

/** One consumed map that has not yet been completed. The id is stable across
 * reconnects and restarts; the sequence never goes backwards in a character
 * save, so a later map cannot reuse a completed attempt's reward claim. */
export interface VaultAttempt extends TreasureMapProgress {
  id: string;
  expiresAtMs?: number;
  bossKilledAtMs?: number;
}
// ---------------------------------------------------------------------------
// Save boundary

export function sanitizeTreasureMap(raw: unknown): TreasureMapProgress | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (!isTreasureMapRarity(obj.rarity)) return null;
  if (typeof obj.siteId !== 'string' || !TREASURE_SITES_BY_ID[obj.siteId]) return null;
  const seed = typeof obj.seed === 'number' && Number.isFinite(obj.seed) ? obj.seed >>> 0 : 0;
  return { rarity: obj.rarity, siteId: obj.siteId, seed };
}

export function sanitizeVaultAttempt(raw: unknown, characterId?: number): VaultAttempt | null {
  const map = sanitizeTreasureMap(raw);
  if (!map || !raw || typeof raw !== 'object') return null;
  const id = (raw as Record<string, unknown>).id;
  if (typeof id !== 'string' || !/^(0|[1-9]\d*):[1-9]\d*$/.test(id)) return null;
  const [owner, sequence] = id.split(':').map(Number);
  if (
    !Number.isSafeInteger(owner) ||
    !Number.isSafeInteger(sequence) ||
    (characterId !== undefined && owner !== characterId)
  )
    return null;
  const { expiresAtMs, bossKilledAtMs } = raw as Record<string, unknown>;
  const timestamp = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  return {
    ...map,
    id,
    ...(timestamp(expiresAtMs) ? { expiresAtMs } : {}),
    ...(timestamp(bossKilledAtMs) ? { bossKilledAtMs } : {}),
  };
}

export function sanitizeVaultGuestPayouts(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

// ---------------------------------------------------------------------------
// The daily board's map

/** One rarity by TREASURE_MAP_DROP_WEIGHTS (a single rng draw). */
export function rollTreasureMapRarity(ctx: SimContext): TreasureMapRarity {
  const total = TREASURE_MAP_RARITIES.reduce((sum, r) => sum + TREASURE_MAP_DROP_WEIGHTS[r], 0);
  let roll = ctx.rng.range(0, total);
  for (const rarity of TREASURE_MAP_RARITIES) {
    roll -= TREASURE_MAP_DROP_WEIGHTS[rarity];
    if (roll < 0) return rarity;
  }
  return 'common';
}

/** A vault seed for this rarity (src/sim/rift/vault_seed.ts): the rarity is the
 *  room's size tier, so every host regenerates the same one-room vault from the
 *  seed alone. One rng draw. */
function pickVaultSeed(ctx: SimContext, rarity: TreasureMapRarity, zoneId: string): number {
  const tier = TREASURE_MAP_RARITIES.indexOf(rarity) as VaultSizeTier;
  if (!isVaultZoneId(zoneId))
    throw new Error(`Treasure site uses an unknown vault zone: ${zoneId}`);
  return makeVaultSeed(tier, ctx.rng.int(0, 0x007fffff), {
    open: (OPEN_HOARD_RARITIES as readonly string[]).includes(rarity),
    zoneId,
  });
}

// ---------------------------------------------------------------------------
// Reading and digging (the `treasureMap` item-use arm)

function atTreasureSite(player: Entity, map: TreasureMapProgress): boolean {
  const site = TREASURE_SITES_BY_ID[map.siteId];
  if (!site || zoneAt(player.pos.x, player.pos.z).id !== site.zoneId) return false;
  const dx = player.pos.x - site.x;
  const dz = player.pos.z - site.z;
  return dx * dx + dz * dz <= TREASURE_DIG_RADIUS * TREASURE_DIG_RADIUS;
}

/**
 * Using a treasure map. With no map read yet, reads this one: marks a site,
 * fixes the vault seed, keeps the item. With this rarity already read, off the
 * X it re-shows the map; on the X it spends the item and opens the vault.
 */
export function useTreasureMap(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
  rarity: TreasureMapRarity,
  consumeOneUnit: () => void,
): void {
  const pid = meta.entityId;
  expireVaultAttempt(meta, ctx.lockoutNowMs());
  const active = meta.treasureMap;
  if (meta.vaultAttempt) {
    ctx.error(pid, 'You are already following another treasure map.');
    return;
  }
  if (!active) {
    const site = TREASURE_SITES[ctx.rng.int(0, TREASURE_SITES.length - 1)];
    meta.treasureMap = { rarity, siteId: site.id, seed: pickVaultSeed(ctx, rarity, site.zoneId) };
    meta.wireRev++;
    ctx.emit({ type: 'treasureMapRead', rarity, siteId: site.id, fresh: true, pid });
    return;
  }
  if (active.rarity !== rarity) {
    ctx.error(pid, 'You are already following another treasure map.');
    return;
  }
  if (!atTreasureSite(player, active)) {
    ctx.emit({ type: 'treasureMapRead', rarity, siteId: active.siteId, fresh: false, pid });
    return;
  }
  const nextSeq = meta.vaultAttemptSeq + 1;
  if (!Number.isSafeInteger(nextSeq)) return;
  const attempt: VaultAttempt = {
    ...active,
    id: `${meta.characterId ?? 0}:${nextSeq}`,
    expiresAtMs: ctx.lockoutNowMs() + VAULT_LIFETIME_MS,
  };
  if (!spawnVaultPortal(ctx, player, pid, attempt, meta.characterId, ctx.cfg.vaultOpenNeedsSave)) {
    ctx.emit({ type: 'treasureMapRead', rarity, siteId: active.siteId, fresh: false, pid });
    return;
  }
  consumeOneUnit();
  meta.treasureMap = null;
  meta.vaultAttempt = attempt;
  meta.vaultAttemptSeq = nextSeq;
  meta.vaultAttemptDurable = !ctx.cfg.vaultOpenNeedsSave;
  meta.wireRev++;
  ctx.emit({ type: 'treasureVaultOpened', rarity, pid });
}

function spawnVaultPortal(
  ctx: SimContext,
  player: Entity,
  ownerPid: number,
  map: TreasureMapProgress,
  ownerCharacterId?: number,
  pendingSave = false,
): boolean {
  const position = findHoardEntrancePosition(player.pos, player.facing, ctx.groundPos, (x, z) =>
    waterLevelAt(x, z, ctx.cfg.seed),
  );
  if (!position) return false;
  const tier = TREASURE_MAP_RIFT_TIER[map.rarity];
  const baseLevel = RIFT_RANK_BASE_LEVEL[tier];
  const plan = generateRiftPlan(map.seed, baseLevel);
  const portal = createGroundObject(ctx.nextId++, '', plan.name, position);
  portal.templateId = HOARD_ENTRANCE_TEMPLATE_ID;
  portal.objectItemId = null;
  portal.lootable = true;
  portal.riftSeed = map.seed;
  portal.riftBaseLevel = baseLevel;
  portal.riftTier = tier;
  portal.vaultOwnerPid = ownerPid;
  if ('id' in map && typeof map.id === 'string') portal.vaultAttemptId = map.id;
  if (portal.vaultAttemptId && pendingSave) portal.vaultOpenPending = true;
  if (ownerCharacterId !== undefined) portal.vaultOwnerCharacterId = ownerCharacterId;
  const ownerMeta = ctx.players.get(ownerPid);
  if (ownerCharacterId !== undefined && ownerMeta) {
    portal.vaultOwnerRewardSnapshot = {
      characterId: ownerCharacterId,
      name: ownerMeta.name,
      cls: ownerMeta.cls,
      level: player.level,
      mountOwned: mountOwned(ownerMeta, VAULT_MOUNT_KEY),
      guestCapped: false,
      guestCycle: ownerMeta.worldQuestCycle,
    };
    // Retained as descriptive portal metadata; never grants entry authority.
    portal.vaultInitialPartyCharacterIds = (ctx.partyOf(ownerPid)?.members ?? [ownerPid])
      .map((memberPid) => ctx.players.get(memberPid)?.characterId)
      .filter((id): id is number => id !== undefined);
  }
  portal.vaultRarity = map.rarity;
  portal.vaultExpiresAt =
    'id' in map ? vaultDeadline(map as VaultAttempt) : ctx.lockoutNowMs() + VAULT_LIFETIME_MS;
  portal.facing = Math.atan2(player.pos.x - position.x, player.pos.z - position.z);
  ctx.addEntity(portal);
  ctx.emit({
    type: 'spellfxAt',
    x: portal.pos.x,
    z: portal.pos.z,
    school: 'physical',
    fx: 'hoardDig',
    sfxKey: 'hoard_entrance_open',
  });
  return true;
}

/** Unlock only the portal for the exact attempt whose consumed-map save landed. */
export function confirmVaultAttemptDurable(
  ctx: SimContext,
  pid: number,
  attemptId: string,
): boolean {
  const meta = ctx.players.get(pid);
  if (meta?.vaultAttempt?.id !== attemptId) return false;
  meta.vaultAttemptDurable = true;
  for (const portal of ctx.entities.values()) {
    if (portal.vaultAttemptId === attemptId) portal.vaultOpenPending = false;
  }
  return true;
}

/** A committed outcome ends retries, but keeps the owner lock until its deadline. */
export function finishVaultAttempt(
  ctx: SimContext,
  ownerCharacterId: number,
  attemptId: string,
  killedAtMs: number,
): number | null {
  const owner = [...ctx.players.values()].find((meta) => meta.characterId === ownerCharacterId);
  if (owner?.vaultAttempt?.id !== attemptId) return null;
  completeVaultAttempt(owner.vaultAttempt, killedAtMs);
  expireVaultAttempt(owner, ctx.lockoutNowMs());
  owner.vaultAttemptDurable = true;
  owner.wireRev++;
  return owner.entityId;
}

/** Once a second: expire owner locks and entrances at their absolute deadline.
 * Instance cleanup uses the same deadline; occupancy never extends it. */
export function updateVaultPortals(ctx: SimContext): void {
  if (ctx.tickCount % 20 !== 5) return;
  const now = ctx.lockoutNowMs();
  for (const meta of ctx.players.values()) expireVaultAttempt(meta, now);
  if (!ctx.riftPortalIds) return;
  for (const id of [...ctx.riftPortalIds]) {
    const portal = ctx.entities.get(id);
    if (!portal || portal.vaultExpiresAt === undefined || now < portal.vaultExpiresAt) continue;
    ctx.dropEntity(id);
  }
  for (const meta of ctx.players.values()) {
    const attempt = meta.vaultAttempt;
    const player = ctx.entities.get(meta.entityId);
    if (
      !attempt ||
      attempt.bossKilledAtMs !== undefined ||
      !meta.vaultAttemptDurable ||
      !player ||
      !atTreasureSite(player, attempt)
    )
      continue;
    if (
      ctx.riftInstances.some(
        (inst) =>
          inst.partyKey !== null &&
          inst.vault?.attemptId === attempt.id &&
          inst.outcome !== 'active',
      )
    )
      continue;
    if ([...ctx.riftPortalIds].some((id) => ctx.entities.get(id)?.vaultAttemptId === attempt.id))
      continue;
    spawnVaultPortal(ctx, player, meta.entityId, attempt, meta.characterId);
  }
}

// ---------------------------------------------------------------------------
// The Rift hooks (src/sim/rift/runs.ts)

/** Whether `pid` may walk through `portal`: always for an ordinary rift; for a
 *  vault, the owner's current party or a bound dead member recovering a corpse. */
export function mayEnterVaultPortal(ctx: SimContext, portal: Entity, pid: number): boolean {
  if (portal.vaultExpiresAt !== undefined && ctx.lockoutNowMs() >= portal.vaultExpiresAt)
    return false;
  if (portal.vaultOwnerPid === undefined) return true;
  if (mayRecoverHoardCorpse(ctx, portal, pid)) return true;
  const owner = hoardOwnerPid(ctx, portal.vaultOwnerPid, portal.vaultOwnerCharacterId);
  return (
    owner !== undefined && (owner === pid || ctx.partyOf(owner)?.members.includes(pid) === true)
  );
}

/** The vault record for a fresh run entered through `portal` (null for an
 *  ordinary rift). Difficulty uses the rarity's fixed suggested party size. */
export function vaultForPortal(ctx: SimContext, portal: Entity | null): RiftInstance['vault'] {
  if (portal?.vaultOwnerPid === undefined || !portal.vaultRarity) return null;
  const ownerPid =
    hoardOwnerPid(ctx, portal.vaultOwnerPid, portal.vaultOwnerCharacterId) ?? portal.vaultOwnerPid;
  const ownerCharacterId =
    portal.vaultOwnerCharacterId ?? ctx.players.get(portal.vaultOwnerPid)?.characterId;
  return {
    rarity: portal.vaultRarity,
    expiresAtMs: portal.vaultExpiresAt ?? ctx.lockoutNowMs() + VAULT_LIFETIME_MS,
    ...(portal.vaultAttemptId ? { attemptId: portal.vaultAttemptId } : {}),
    ownerPid,
    ...(ownerCharacterId === undefined
      ? {}
      : {
          ownerCharacterId,
          memberCharacterIds: new Map<number, number>(),
          ...(portal.vaultOwnerRewardSnapshot
            ? { entrantSnapshots: new Map([[ownerCharacterId, portal.vaultOwnerRewardSnapshot]]) }
            : {}),
        }),
    // Keep the existing run-record shape; this is an authored size, not attendance.
    headCount: HOARD_SUGGESTED_PLAYERS[portal.vaultRarity],
    level: ctx.entities.get(ownerPid)?.level ?? RIFT_RANK_BASE_LEVEL.C,
    ...(portal.devForceHoardGoblin ? { forceGoblin: true } : {}),
  };
}

/** The rank tuning adjusted for a vault's fixed rarity budget; unchanged for a rift. */
export function vaultScaledTuning(
  tuning: RiftRankTuning,
  vault: RiftInstance['vault'],
): RiftRankTuning {
  if (!vault) return tuning;
  const health = vaultHealthFactor(vault.rarity);
  const bossDamage = vaultDamageFactor(vault.rarity, 'boss');
  const addDamage = vaultDamageFactor(vault.rarity, 'add');
  return {
    ...tuning,
    healthMultiplier: tuning.healthMultiplier * health,
    bossHealthMultiplier: tuning.bossHealthMultiplier * health,
    damageMultiplier: tuning.damageMultiplier * addDamage,
    bossDamageMultiplier: tuning.bossDamageMultiplier * bossDamage,
    addDamageMultiplier: tuning.addDamageMultiplier * addDamage,
  };
}

/** The boss fell: pay every entrant the rarity's table, the gear off the fallen
 *  boss's own loot (`bossTemplateId`, content/hoard_loot.ts). */
export function payTreasureVault(
  ctx: SimContext,
  vault: NonNullable<RiftInstance['vault']>,
  participants: readonly number[],
  bossTemplateId: string | undefined,
): void {
  for (const pid of participants) {
    const meta = ctx.players.get(pid);
    const player = ctx.entities.get(pid);
    if (!meta || !player || meta.leaving) continue;
    const owner =
      pid === vault.ownerPid ||
      (vault.ownerCharacterId !== undefined && meta.characterId === vault.ownerCharacterId);
    const reward = rollHoardReward(ctx.rng, {
      rarity: vault.rarity,
      bossTemplateId,
      cls: meta.cls,
      level: player.level,
      owner,
      guestCapped: false,
      mountOwned: mountOwned(meta, VAULT_MOUNT_KEY),
    });
    grantHoardReward(ctx, pid, vault.rarity, reward);
  }
}

// ---------------------------------------------------------------------------
// Cartographer's Ink (the `cartographersInk` item-use arm): redraws the read
// map one rarity finer. The ink is bought from a faction quartermaster.

export function useCartographersInk(ctx: SimContext, meta: PlayerMeta): void {
  const pid = meta.entityId;
  const map = meta.treasureMap;
  if (!map) {
    ctx.error(pid, 'Read the treasure map you want to redraw first.');
    return;
  }
  const next = nextTreasureMapRarity(map.rarity);
  if (!next) {
    ctx.error(pid, 'This map cannot be improved any further.');
    return;
  }
  const inks = TREASURE_MAP_UPGRADE_INKS[map.rarity];
  if (ctx.countItem(CARTOGRAPHERS_INK_ITEM_ID, pid) < inks) {
    ctx.error(pid, `Redrawing this map takes ${inks} Cartographer's Ink.`);
    return;
  }
  if (ctx.countItem(TREASURE_MAP_ITEM_IDS[map.rarity], pid) < 1) {
    ctx.error(pid, 'You no longer hold that treasure map.');
    return;
  }
  ctx.removeItem(CARTOGRAPHERS_INK_ITEM_ID, inks, pid);
  ctx.removeItem(TREASURE_MAP_ITEM_IDS[map.rarity], 1, pid);
  ctx.addItem(TREASURE_MAP_ITEM_IDS[next], 1, pid);
  const site = TREASURE_SITES_BY_ID[map.siteId];
  meta.treasureMap = {
    rarity: next,
    siteId: map.siteId,
    seed: pickVaultSeed(ctx, next, site.zoneId),
  };
  meta.wireRev++;
  ctx.emit({ type: 'treasureMapUpgraded', rarity: next, inks, pid });
}
