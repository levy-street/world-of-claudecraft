// Natural (world-spawned) Rift portals and their C/B/A/S rank system.
//
// A portal is the discoverable overworld entrance to one shared RiftEvent. Each
// group entering it receives an independent RiftInstance, while every instance
// points back to the same event and races for its single first-clear claim.
//
// Population policy: every eligible zone runs its own hourly respawn boundary
// (RIFT_PORTAL_ZONE_CYCLE), anchored on that zone's previous opening. At a
// boundary the zone opens a new rift UNLESS its current one is still open, in
// which case the boundary is skipped and the zone is re-judged at the next
// one. A first-cleared (sealed) zone stays empty until the first boundary at
// or after the seal and is never instantly refarmed, while an uncleared portal
// collapses at RIFT_PORTAL_LIFETIME (an exact multiple of the cycle), which
// lands on a boundary, so its replacement is due immediately.
//
// Determinism: portal placement uses streams derived only from the realm seed
// and spawn ordinal. They never consume ctx.rng, so enabling Rifts cannot
// perturb combat, loot, or any other pre-existing simulation stream.

import { isBlocked } from '../colliders';
import { STRIP_MAX_X, STRIP_MIN_X, WORLD_MAX_X, WORLD_MIN_X, ZONES, zoneAt } from '../data';
import { createGroundObject } from '../entity';
import { Rng } from '../rng';
import type { SimContext } from '../sim_context';
import { RIFT_TIER_COLORS, type RiftTier, type ZoneDef } from '../types';
import { groundHeight, terrainSteepnessAt, WATER_LEVEL } from '../world';
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
export const RIFT_PORTAL_LIFETIME = 2 * 60 * 60;
/** Each eligible zone gets its own hourly respawn boundary, anchored on the
 * zone's own last opening (NOT tied to RIFT_PORTAL_LIFETIME: a portal can
 * outlive one boundary and still be judged against the next). The lifetime
 * must stay an exact multiple of this cycle so an uncleared portal's collapse
 * lands exactly on a boundary and its replacement is due immediately. */
export const RIFT_PORTAL_ZONE_CYCLE = 60 * 60;
/** Backoff after a deterministic placement failure before rescanning zones. */
export const RIFT_PORTAL_RETRY_DELAY = 60;
/** Completed events retained for history AND per-zone cadence derivation
 * (riftZoneNextOpenAt). Must stay comfortably above the eligible-zone count or
 * a sealed zone's newest event could be trimmed and instantly refarm. */
export const RIFT_EVENT_HISTORY_LIMIT = 64;

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
  /** Force the target zone (the per-zone scheduler); omitted picks by rng. */
  readonly zoneId?: string;
  readonly lifetime?: number;
}

function announce(ctx: SimContext, text: string, color: string): void {
  ctx.emit({ type: 'log', text, color });
}

function portalRng(ctx: SimContext, ordinal: number): Rng {
  return new Rng((ctx.cfg.seed ^ Math.imul(ordinal + 1, 0x9e3779b9) ^ 0xa341316c) >>> 0);
}

export function eligibleRiftZones(): ZoneDef[] {
  return ZONES.filter((zone) => zone.riftPortalEligible && zone.riftTierWeights !== undefined);
}

/** First hourly boundary at or after a rift's close, counted from that rift's
 * own opening. Pure and rng-free: a zone's schedule is a deterministic
 * function of its own event history, never a random draw. `closedAt` equal to
 * a boundary (a rift that runs its full lifetime to collapse) yields that same
 * boundary, i.e. the replacement is due immediately, not one cycle later. */
export function riftZoneBoundaryAfterClose(
  openedAt: number,
  closedAt: number,
  cycle: number = RIFT_PORTAL_ZONE_CYCLE,
): number {
  const elapsed = Math.max(0, closedAt - openedAt);
  // Minus epsilon: sim time accumulates in DT-sized double additions, so an
  // expiry stored as openedAt + LIFETIME can read back a hair PAST the exact
  // boundary (elapsed / cycle = 2.0000000000000004). Without the guard that
  // rounds a collapse up a whole extra cycle and the zone sits empty an
  // extra hour instead of replacing immediately.
  return openedAt + Math.ceil(elapsed / cycle - 1e-9) * cycle;
}

/** The sim-time a zone's rift actually closed, or null while it is still open
 * (portal standing, or a party still racing inside it past its collapse). A
 * sealed rift closes at its first-clear claim; a collapsed one at its expiry. */
function riftEventClosedAt(event: RiftEvent): number | null {
  if (event.status === 'cleared') return event.firstClear?.clearedAt ?? event.expiresAt;
  if (event.status === 'collapsed') return event.expiresAt;
  return null;
}

/** When `zoneId` may open its next portal: the first hourly boundary at or
 * after its previous rift CLOSED (riftZoneBoundaryAfterClose). Derived from
 * the event history alone, so a server restart preserves the cadence without
 * any new persisted state; a zone with no recorded event is due at the world's
 * first-spawn warmup, and a zone whose rift is still open is not due at all
 * (that boundary is skipped and the zone re-judged at the next one). */
export function riftZoneNextOpenAt(ctx: SimContext, zoneId: string): number {
  let last: RiftEvent | null = null;
  for (const event of ctx.riftEvents) {
    if (event.zoneId !== zoneId) continue;
    if (last === null || event.openedAt > last.openedAt) last = event;
  }
  if (last === null) return RIFT_PORTAL_FIRST_AT;
  const closedAt = riftEventClosedAt(last);
  if (closedAt === null) return Number.POSITIVE_INFINITY;
  return riftZoneBoundaryAfterClose(last.openedAt, closedAt);
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
  const eligible = eligibleRiftZones();
  if (eligible.length === 0) return false;

  const rng = portalRng(ctx, ordinal);
  const zone =
    options?.zoneId !== undefined
      ? (eligible.find((candidate) => candidate.id === options.zoneId) ?? null)
      : eligible[rng.int(0, eligible.length - 1)];
  if (zone === null) return false;
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
    // A portal must open on standable ground: the natural-relief crags make
    // cliffside rolls real, and a portal on one is unreachable or a fall.
    if (terrainSteepnessAt(x, z, ctx.cfg.seed) > 0.9) continue;
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
  const portal = ctx.naturalRiftPortals[index];
  ctx.naturalRiftPortals.splice(index, 1);
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

/** Once-per-second scheduler: each eligible zone is judged against its OWN
 * hourly boundary, gated on its previous rift having CLOSED
 * (riftZoneNextOpenAt). `riftPortalNextAt` survives only as the placement-failure
 * backoff gate (a failed ordinal re-rolls identical positions, so hammering it
 * every second is pointless; another zone's success advances the ordinal and
 * unwedges it). At most ONE portal spawns per pass: a spawn generates a full
 * rift plan plus its upgrade draft (~20 ms), so when many zones fall due in the
 * same second (fresh world, the shared hourly boundary, post-downtime restore)
 * the fill spreads over consecutive seconds instead of blowing the 50 ms tick
 * budget in one go. A failed zone does NOT consume the pass. */
export function updateRiftPortals(ctx: SimContext): void {
  if (ctx.tickCount % 20 !== 10) return;

  for (let i = ctx.naturalRiftPortals.length - 1; i >= 0; i--) {
    const portal = ctx.naturalRiftPortals[i];
    if (ctx.time >= portal.expiresAt) closeNaturalRiftPortal(ctx, portal.id, 'collapsed');
  }

  if (ctx.time < ctx.riftPortalNextAt) return;
  const openZoneIds = activeRiftZoneIds(ctx);
  for (const zone of eligibleRiftZones()) {
    if (openZoneIds.has(zone.id)) continue;
    if (ctx.time < riftZoneNextOpenAt(ctx, zone.id)) continue;
    if (!spawnNaturalRiftPortal(ctx, ctx.riftPortalSpawnCount, { zoneId: zone.id })) {
      ctx.riftPortalNextAt = ctx.time + RIFT_PORTAL_RETRY_DELAY;
      continue;
    }
    ctx.riftPortalSpawnCount += 1;
    return;
  }
}
