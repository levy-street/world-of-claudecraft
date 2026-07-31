// Natural (world-spawned) Rift portals and their C/B/A/S rank system.
//
// A portal is the discoverable overworld entrance to one shared RiftEvent. Each
// group entering it receives an independent RiftInstance, while every instance
// points back to the same event and races for its single first-clear claim.
//
// Determinism: scheduling and portal placement use streams derived only from the
// realm seed and spawn ordinal. They never consume ctx.rng, so enabling Rifts
// cannot perturb combat, loot, or any other pre-existing simulation stream.

import { isBlocked } from '../colliders';
import { STRIP_MAX_X, STRIP_MIN_X, WORLD_MAX_X, WORLD_MIN_X, ZONES, zoneAt } from '../data';
import { createGroundObject } from '../entity';
import { Rng } from '../rng';
import type { SimContext } from '../sim_context';
import { RIFT_TIER_COLORS, type RiftTier, type ZoneDef } from '../types';
import { groundHeight, WATER_LEVEL } from '../world';
import { RIFT_RANK_BASE_LEVEL } from './ranks';
import { generateRiftPlan } from './rift_gen';
import type { RiftEvent } from './types';
import {
  buildHeuristicRiftUpgrade,
  buildRiftDungeonDraft,
  installRiftUpgrade,
} from './upgrader_draft';

export const RIFT_MIN_LEVEL = 20;

export const RIFT_PORTAL_FIRST_AT = 120;
export const RIFT_PORTAL_INTERVAL_MIN = 2 * 60 * 60;
export const RIFT_PORTAL_INTERVAL_MAX = 4 * 60 * 60;
/** Compatibility/telemetry value: the mean of the deterministic random window. */
export const RIFT_PORTAL_INTERVAL = (RIFT_PORTAL_INTERVAL_MIN + RIFT_PORTAL_INTERVAL_MAX) / 2;
export const RIFT_PORTAL_LIFETIME = 60 * 60;
export const RIFT_PORTAL_MAX_OPEN = 3;
export const COMMUNITY_RIFT_PORTAL_TARGET = 8;
export const COMMUNITY_RIFT_PORTAL_LIFETIME = 6 * 60 * 60;
export const COMMUNITY_RIFT_PORTAL_REFILL_DELAY = 60;
const RIFT_EVENT_HISTORY_LIMIT = 64;

/** Rank tuning. Rifts pay NO Heroic Marks at any rank (maintainer decision:
 * marks stay a heroic dungeon/raid currency; the rift prize is the clear-time
 * gear ladder, rings, essence, mounts, and coin). baseLevel comes from the
 * canonical rank map in ./ranks.ts, which every difficulty consumer inverts
 * back into the rank. */
export const RIFT_TIER_INFO: Record<RiftTier, { baseLevel: number; color: number }> = {
  C: { baseLevel: RIFT_RANK_BASE_LEVEL.C, color: RIFT_TIER_COLORS.C },
  B: { baseLevel: RIFT_RANK_BASE_LEVEL.B, color: RIFT_TIER_COLORS.B },
  A: { baseLevel: RIFT_RANK_BASE_LEVEL.A, color: RIFT_TIER_COLORS.A },
  S: { baseLevel: RIFT_RANK_BASE_LEVEL.S, color: RIFT_TIER_COLORS.S },
};

const TIERS: readonly RiftTier[] = ['C', 'B', 'A', 'S'];

/** Select a rank from content-authored relative weights. The roll is expected in
 * [0,1), but clamping keeps callers and persisted old values harmless. */
export function riftTierForZone(zone: ZoneDef, roll: number): RiftTier {
  const weights = zone.riftTierWeights;
  let total = 0;
  for (const tier of TIERS) total += Math.max(0, weights?.[tier] ?? 0);
  if (total <= 0) return 'C';
  let cursor = Math.max(0, Math.min(0.999999999, roll)) * total;
  for (const tier of TIERS) {
    cursor -= Math.max(0, weights?.[tier] ?? 0);
    if (cursor < 0) return tier;
  }
  return 'S';
}

/** One currently visible overworld portal. The longer-lived history and race
 * result live in RiftEvent; this record disappears when the entrance closes. */
export interface NaturalRiftPortal {
  id: number;
  eventId: string;
  tier: RiftTier;
  zoneId: string;
  zoneName: string;
  riftName: string;
  seed: number;
  baseLevel: number;
  openedAt: number;
  expiresAt: number;
  position: { x: number; z: number };
}

interface RiftPortalSpawnOptions {
  readonly excludedZoneIds?: ReadonlySet<string>;
  readonly lifetime?: number;
}

function announce(ctx: SimContext, text: string, color: string): void {
  ctx.emit({ type: 'log', text, color });
}

function scheduleRng(ctx: SimContext, ordinal: number): Rng {
  return new Rng((ctx.cfg.seed ^ Math.imul(ordinal + 1, 0x85ebca6b) ^ 0x51f15e5d) >>> 0);
}

function portalRng(ctx: SimContext, ordinal: number): Rng {
  return new Rng((ctx.cfg.seed ^ Math.imul(ordinal + 1, 0x9e3779b9) ^ 0xa341316c) >>> 0);
}

export function riftPortalDelay(ctx: SimContext, ordinal: number): number {
  return scheduleRng(ctx, ordinal).range(RIFT_PORTAL_INTERVAL_MIN, RIFT_PORTAL_INTERVAL_MAX);
}

function contentHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function eventForPortal(ctx: SimContext, portal: NaturalRiftPortal): RiftEvent | null {
  return ctx.riftEvents.find((event) => event.eventId === portal.eventId) ?? null;
}

function trimEventHistory(ctx: SimContext): void {
  const completed = ctx.riftEvents.filter(
    (event) => event.status === 'cleared' || event.status === 'collapsed',
  );
  const excess = completed.length - RIFT_EVENT_HISTORY_LIMIT;
  if (excess <= 0) return;
  const remove = new Set(completed.slice(0, excess).map((event) => event.eventId));
  for (let i = ctx.riftEvents.length - 1; i >= 0; i--) {
    if (remove.has(ctx.riftEvents[i].eventId)) ctx.riftEvents.splice(i, 1);
  }
}

/** Recreate the runtime entity/registry side of a persisted open event. Event
 * validation and deadline conversion belong to persistence.ts. */
export function restoreNaturalRiftPortal(ctx: SimContext, event: RiftEvent): number {
  const entity = createGroundObject(
    ctx.nextId++,
    '',
    event.riftName,
    ctx.groundPos(event.position.x, event.position.z),
  );
  entity.templateId = 'rift_portal';
  entity.objectItemId = null;
  entity.lootable = true;
  entity.riftSeed = event.seed;
  entity.riftBaseLevel = event.baseLevel;
  entity.riftTier = event.tier;
  entity.riftEventId = event.eventId;
  ctx.addEntity(entity);
  event.portalId = entity.id;
  ctx.naturalRiftPortals.push({
    id: entity.id,
    eventId: event.eventId,
    tier: event.tier,
    zoneId: event.zoneId,
    zoneName: event.zoneName,
    riftName: event.riftName,
    seed: event.seed,
    baseLevel: event.baseLevel,
    openedAt: event.openedAt,
    expiresAt: event.expiresAt,
    position: { ...event.position },
  });
  return entity.id;
}

/** Spawn one deterministic event. False means no eligible/valid position was
 * available; the scheduler leaves the ordinal pending and retries later. */
export function spawnNaturalRiftPortal(
  ctx: SimContext,
  ordinal: number,
  options?: RiftPortalSpawnOptions,
): boolean {
  const eligible = ZONES.filter(
    (zone) =>
      zone.riftPortalEligible &&
      zone.riftTierWeights !== undefined &&
      !options?.excludedZoneIds?.has(zone.id),
  );
  if (eligible.length === 0) return false;

  const rng = portalRng(ctx, ordinal);
  const zone = eligible[rng.int(0, eligible.length - 1)];
  const tier = riftTierForZone(zone, rng.next());
  const info = RIFT_TIER_INFO[tier];
  const xMin = Math.max(WORLD_MIN_X, zone.xMin ?? STRIP_MIN_X) + 25;
  const xMax = Math.min(WORLD_MAX_X, zone.xMax ?? STRIP_MAX_X) - 25;
  const zMin = zone.zMin + 25;
  const zMax = zone.zMax - 25;
  if (xMin >= xMax || zMin >= zMax) return false;

  let position: { x: number; z: number } | null = null;
  for (let attempt = 0; attempt < 64; attempt++) {
    const x = rng.range(xMin, xMax);
    const z = rng.range(zMin, zMax);
    if (zoneAt(x, z).id !== zone.id) continue;
    if (Math.hypot(x - zone.hub.x, z - zone.hub.z) < zone.hub.radius + 30) continue;
    if (groundHeight(x, z, ctx.cfg.seed) < WATER_LEVEL + 0.5) continue;
    if (isBlocked(ctx.cfg.seed, x, z, 1.5)) continue;
    position = { x, z };
    break;
  }
  if (position === null) return false;

  const seed = rng.int(1, 1_000_000_000) >>> 0;
  const plan = generateRiftPlan(seed, info.baseLevel);
  const eventId = `rift-${ordinal + 1}-${seed.toString(36)}`;
  const contentId = `procedural-v1:${seed}:${info.baseLevel}`;
  const portalEntity = createGroundObject(
    ctx.nextId++,
    '',
    plan.name,
    ctx.groundPos(position.x, position.z),
  );
  portalEntity.templateId = 'rift_portal';
  portalEntity.objectItemId = null;
  portalEntity.lootable = true;
  portalEntity.riftSeed = seed;
  portalEntity.riftBaseLevel = info.baseLevel;
  portalEntity.riftTier = tier;
  portalEntity.riftEventId = eventId;
  ctx.addEntity(portalEntity);

  const portal: NaturalRiftPortal = {
    id: portalEntity.id,
    eventId,
    tier,
    zoneId: zone.id,
    zoneName: zone.name,
    riftName: plan.name,
    seed,
    baseLevel: info.baseLevel,
    openedAt: ctx.time,
    expiresAt: ctx.time + (options?.lifetime ?? RIFT_PORTAL_LIFETIME),
    position,
  };
  ctx.naturalRiftPortals.push(portal);
  ctx.riftEvents.push({
    eventId,
    ordinal,
    portalId: portal.id,
    status: 'open',
    tier,
    zoneId: zone.id,
    zoneName: zone.name,
    riftName: plan.name,
    seed,
    baseLevel: info.baseLevel,
    openedAt: portal.openedAt,
    expiresAt: portal.expiresAt,
    position: { ...position },
    contentId,
    contentHash: contentHash(`${contentId}:${plan.name}:${plan.floorCount}`),
    contentLocked: false,
    upgradeStatus: 'pending',
    upgrade: null,
    assetPipeline: { status: 'none', jobId: null, requestIds: [] },
    firstClear: null,
  });
  const heuristic = buildHeuristicRiftUpgrade(buildRiftDungeonDraft(seed, info.baseLevel));
  if (heuristic) installRiftUpgrade(ctx, eventId, heuristic, 'heuristic');
  trimEventHistory(ctx);
  announce(ctx, `A ${tier}-rank rift tears open in ${zone.name}!`, '#d9f');
  return true;
}

/** Remove a visible portal. A timed-out entrance becomes collapsed only when no
 * group is inside; active races may finish even after their entry closes. */
export function closeNaturalRiftPortal(
  ctx: SimContext,
  portalId: number,
  outcome: 'sealed' | 'collapsed',
): void {
  const index = ctx.naturalRiftPortals.findIndex((portal) => portal.id === portalId);
  if (index < 0) return;
  const coveredCommunityZonesBefore = ctx.cfg.communityRifts ? activeRiftZoneIds(ctx).size : 0;
  const portal = ctx.naturalRiftPortals[index];
  ctx.naturalRiftPortals.splice(index, 1);
  if (
    ctx.cfg.communityRifts &&
    coveredCommunityZonesBefore >= COMMUNITY_RIFT_PORTAL_TARGET &&
    activeRiftZoneIds(ctx).size < COMMUNITY_RIFT_PORTAL_TARGET
  ) {
    ctx.riftPortalNextAt = ctx.time + COMMUNITY_RIFT_PORTAL_REFILL_DELAY;
  }
  if (ctx.entities.has(portal.id)) ctx.dropEntity(portal.id);

  const event = eventForPortal(ctx, portal);
  if (event) {
    event.portalId = null;
    if (outcome === 'collapsed' && event.status !== 'cleared') {
      const hasLiveInstance = ctx.riftInstances.some(
        (instance) => instance.partyKey !== null && instance.eventId === event.eventId,
      );
      event.status = hasLiveInstance ? 'active' : 'collapsed';
    }
  }
  if (outcome === 'sealed') {
    announce(ctx, `The ${portal.tier}-rank rift in ${portal.zoneName} has been sealed.`, '#9f9');
  } else {
    announce(ctx, `The ${portal.tier}-rank rift in ${portal.zoneName} collapses.`, '#a9c');
  }
}

function activeRiftZoneIds(ctx: SimContext): Set<string> {
  return new Set(ctx.naturalRiftPortals.map((portal) => portal.zoneId));
}

function spawnCommunityRiftPortal(ctx: SimContext): boolean {
  const activeZoneIds = activeRiftZoneIds(ctx);
  const ordinal = ctx.riftPortalSpawnCount;
  if (
    !spawnNaturalRiftPortal(ctx, ordinal, {
      excludedZoneIds: activeZoneIds,
      lifetime: COMMUNITY_RIFT_PORTAL_LIFETIME,
    })
  ) {
    return false;
  }
  ctx.riftPortalSpawnCount += 1;
  return true;
}

/** Reconcile the public-test population immediately after persisted state loads.
 * Existing open portals are preserved and every new portal selects a region not
 * already active. Placement failure leaves the ordinal pending for the scheduler. */
export function populateCommunityRiftPortals(ctx: SimContext): number {
  let spawned = 0;
  while (activeRiftZoneIds(ctx).size < COMMUNITY_RIFT_PORTAL_TARGET) {
    if (!spawnCommunityRiftPortal(ctx)) break;
    spawned += 1;
  }
  ctx.riftPortalNextAt = ctx.time + COMMUNITY_RIFT_PORTAL_REFILL_DELAY;
  return spawned;
}

function updateCommunityRiftPortals(ctx: SimContext): void {
  for (let i = ctx.naturalRiftPortals.length - 1; i >= 0; i--) {
    const portal = ctx.naturalRiftPortals[i];
    if (ctx.time >= portal.expiresAt) closeNaturalRiftPortal(ctx, portal.id, 'collapsed');
  }

  if (activeRiftZoneIds(ctx).size >= COMMUNITY_RIFT_PORTAL_TARGET) return;
  if (ctx.time < ctx.riftPortalNextAt) return;
  spawnCommunityRiftPortal(ctx);
  ctx.riftPortalNextAt = ctx.time + COMMUNITY_RIFT_PORTAL_REFILL_DELAY;
}

/** Once-per-second scheduler. A full world cap postpones the due event instead of
 * consuming it, and every successful spawn samples the next 2-4 hour deadline. */
export function updateRiftPortals(ctx: SimContext): void {
  if (ctx.tickCount % 20 !== 10) return;
  if (ctx.cfg.communityRifts) {
    updateCommunityRiftPortals(ctx);
    return;
  }

  for (let i = ctx.naturalRiftPortals.length - 1; i >= 0; i--) {
    const portal = ctx.naturalRiftPortals[i];
    if (ctx.time >= portal.expiresAt) closeNaturalRiftPortal(ctx, portal.id, 'collapsed');
  }

  if (ctx.time < ctx.riftPortalNextAt) return;
  if (ctx.naturalRiftPortals.length >= RIFT_PORTAL_MAX_OPEN) return;
  const ordinal = ctx.riftPortalSpawnCount;
  if (!spawnNaturalRiftPortal(ctx, ordinal)) {
    ctx.riftPortalNextAt = ctx.time + 60;
    return;
  }
  ctx.riftPortalSpawnCount += 1;
  ctx.riftPortalNextAt = ctx.time + riftPortalDelay(ctx, ordinal);
}
