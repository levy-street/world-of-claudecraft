// Versioned persistence projection for shared Rift events. Runtime instance slots
// are intentionally not saved: after a process restart no party remains inside,
// while still-open overworld events can safely be reconstructed and raced anew.

import { ZONES, zoneAt } from '../data';
import type { SimContext } from '../sim_context';
import type { RiftTier } from '../types';
import { RIFT_PORTAL_RETRY_DELAY, RIFT_TIER_INFO, restoreNaturalRiftPortal } from './portals';
import { generateRiftPlan } from './rift_gen';
import type {
  RiftAssetPipelineState,
  RiftEvent,
  RiftUpgradeManifest,
  RiftUpgradeStatus,
} from './types';
import { riftUpgradeHash, validateRiftUpgrade } from './upgrade';

const MAX_SAVED_EVENTS = 64;
const TIERS = new Set<RiftTier>(['C', 'B', 'A', 'S']);

export interface RiftWorldStateV1 {
  version: 1;
  savedAtMs: number;
  spawnCount: number;
  nextPortalAtMs: number;
  events: RiftWorldSavedEvent[];
}

export interface RiftWorldSavedEvent {
  eventId: string;
  ordinal: number;
  status: RiftEvent['status'];
  tier: RiftTier;
  zoneId: string;
  zoneName: string;
  riftName: string;
  seed: number;
  baseLevel: number;
  openedAtMs: number;
  expiresAtMs: number;
  position: { x: number; z: number };
  contentId: string;
  contentHash: string;
  upgradeStatus: RiftUpgradeStatus;
  upgrade: RiftUpgradeManifest | null;
  assetPipeline?: RiftAssetPipelineState;
  firstClear: null | {
    partyKey: string;
    memberNames: string[];
    duration: number;
    clearedAtMs: number;
  };
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function serializeRiftWorldState(ctx: SimContext, nowMs: number): RiftWorldStateV1 {
  return {
    version: 1,
    savedAtMs: nowMs,
    spawnCount: ctx.riftPortalSpawnCount,
    nextPortalAtMs: nowMs + Math.max(0, ctx.riftPortalNextAt - ctx.time) * 1000,
    events: ctx.riftEvents.slice(-MAX_SAVED_EVENTS).map((event) => ({
      eventId: event.eventId,
      ordinal: event.ordinal,
      status: event.status,
      tier: event.tier,
      zoneId: event.zoneId,
      zoneName: event.zoneName,
      riftName: event.riftName,
      seed: event.seed,
      baseLevel: event.baseLevel,
      openedAtMs: nowMs - Math.max(0, ctx.time - event.openedAt) * 1000,
      expiresAtMs: nowMs + (event.expiresAt - ctx.time) * 1000,
      position: { ...event.position },
      contentId: event.contentId,
      contentHash: event.contentHash,
      upgradeStatus: event.upgradeStatus,
      upgrade: event.upgrade,
      assetPipeline: event.assetPipeline,
      firstClear: event.firstClear
        ? {
            partyKey: event.firstClear.partyKey,
            memberNames: [...event.firstClear.memberNames],
            duration: event.firstClear.duration,
            clearedAtMs: nowMs - Math.max(0, ctx.time - event.firstClear.clearedAt) * 1000,
          }
        : null,
    })),
  };
}

function validSavedEvent(input: unknown): input is RiftWorldSavedEvent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const event = input as Partial<RiftWorldSavedEvent>;
  if (typeof event.eventId !== 'string' || !/^rift-[a-z0-9-]{3,80}$/i.test(event.eventId)) {
    return false;
  }
  if (!Number.isInteger(event.ordinal) || finite(event.ordinal, -1) < 0) return false;
  if (!event.tier || !TIERS.has(event.tier)) return false;
  if (!['open', 'active', 'cleared', 'collapsed'].includes(event.status ?? '')) return false;
  if (!['heuristic', 'pending', 'ready', 'fallback'].includes(event.upgradeStatus ?? '')) {
    return false;
  }
  if (
    typeof event.zoneId !== 'string' ||
    typeof event.zoneName !== 'string' ||
    typeof event.riftName !== 'string' ||
    !event.zoneId ||
    !event.zoneName ||
    !event.riftName
  ) {
    return false;
  }
  if (!event.position || !Number.isFinite(event.position.x) || !Number.isFinite(event.position.z)) {
    return false;
  }
  const zone = ZONES.find((candidate) => candidate.id === event.zoneId);
  if (!zone?.riftPortalEligible || zoneAt(event.position.x, event.position.z).id !== zone.id) {
    return false;
  }
  return Number.isFinite(event.seed) && Number.isFinite(event.baseLevel);
}

/** Load defensively from JSONB. Returns the number of reconstructed open portals.
 * Always tolerant: malformed or unsupported input reads as an empty save (the
 * strict mode existed only for the retired COMMUNITY_TEST_RIFTS boot path). */
export function loadRiftWorldState(ctx: SimContext, input: unknown, nowMs: number): number {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 0;
  const save = input as Partial<RiftWorldStateV1>;
  if (save.version !== 1 || !Array.isArray(save.events)) return 0;
  const savedEvents = save.events;

  for (const portal of [...ctx.naturalRiftPortals]) {
    if (ctx.entities.has(portal.id)) ctx.dropEntity(portal.id);
  }
  ctx.naturalRiftPortals.splice(0);
  ctx.riftEvents.splice(0);
  const seen = new Set<string>();
  for (const raw of savedEvents.slice(-MAX_SAVED_EVENTS)) {
    if (!validSavedEvent(raw) || seen.has(raw.eventId)) continue;
    seen.add(raw.eventId);
    const expectedFloorCount = generateRiftPlan(
      Math.max(1, Math.round(raw.seed)) >>> 0,
      RIFT_TIER_INFO[raw.tier].baseLevel,
    ).floorCount;
    const validatedUpgrade = raw.upgrade
      ? validateRiftUpgrade(raw.upgrade, expectedFloorCount).value
      : null;
    const expired = finite(raw.expiresAtMs) <= nowMs;
    let status = raw.status;
    if ((status === 'open' || status === 'active') && expired) status = 'collapsed';
    else if (status === 'active') status = 'open';
    const tier = raw.tier;
    const upgradeHash = validatedUpgrade ? riftUpgradeHash(validatedUpgrade) : null;
    const event: RiftEvent = {
      eventId: raw.eventId,
      ordinal: Math.max(0, Math.round(raw.ordinal)),
      portalId: null,
      status,
      tier,
      zoneId: raw.zoneId,
      zoneName: raw.zoneName.slice(0, 100),
      riftName: raw.riftName.slice(0, 120),
      seed: Math.max(1, Math.round(raw.seed)) >>> 0,
      baseLevel: RIFT_TIER_INFO[tier].baseLevel,
      openedAt: ctx.time - Math.max(0, nowMs - finite(raw.openedAtMs, nowMs)) / 1000,
      expiresAt: ctx.time + Math.max(0, finite(raw.expiresAtMs, nowMs) - nowMs) / 1000,
      position: { x: raw.position.x, z: raw.position.z },
      contentId:
        validatedUpgrade && upgradeHash
          ? `${raw.upgradeStatus === 'ready' ? 'ai' : 'heuristic'}-upgrade-v1:${raw.seed}:${RIFT_TIER_INFO[tier].baseLevel}:${upgradeHash}`
          : `procedural-v1:${raw.seed}:${RIFT_TIER_INFO[tier].baseLevel}`,
      contentHash:
        upgradeHash ?? String(raw.contentHash || raw.contentId || raw.seed).slice(0, 100),
      contentLocked: status === 'cleared',
      upgradeStatus: validatedUpgrade
        ? raw.upgradeStatus === 'pending'
          ? 'fallback'
          : raw.upgradeStatus
        : 'fallback',
      upgrade: validatedUpgrade,
      assetPipeline:
        raw.assetPipeline &&
        ['none', 'pending', 'queued', 'failed'].includes(raw.assetPipeline.status)
          ? {
              status: raw.assetPipeline.status === 'pending' ? 'failed' : raw.assetPipeline.status,
              jobId:
                typeof raw.assetPipeline.jobId === 'string'
                  ? raw.assetPipeline.jobId.slice(0, 128)
                  : null,
              requestIds: Array.isArray(raw.assetPipeline.requestIds)
                ? raw.assetPipeline.requestIds
                    .filter((id): id is string => typeof id === 'string')
                    .slice(0, 2)
                    .map((id) => id.slice(0, 64))
                : [],
            }
          : { status: 'none', jobId: null, requestIds: [] },
      firstClear:
        raw.firstClear && status === 'cleared'
          ? {
              partyKey: String(raw.firstClear.partyKey).slice(0, 100),
              memberIds: [],
              memberNames: Array.isArray(raw.firstClear.memberNames)
                ? raw.firstClear.memberNames
                    .filter((name): name is string => typeof name === 'string')
                    .slice(0, 5)
                    .map((name) => name.slice(0, 48))
                : [],
              duration: Math.max(0, finite(raw.firstClear.duration)),
              clearedAt:
                ctx.time - Math.max(0, nowMs - finite(raw.firstClear.clearedAtMs, nowMs)) / 1000,
            }
          : null,
    };
    ctx.riftEvents.push(event);
    if (event.status === 'open') restoreNaturalRiftPortal(ctx, event);
  }

  const maxOrdinal = ctx.riftEvents.reduce((max, event) => Math.max(max, event.ordinal + 1), 0);
  ctx.riftPortalSpawnCount = Math.max(maxOrdinal, Math.max(0, Math.round(finite(save.spawnCount))));
  // nextPortalAtMs predates the rotation policy, when it was the 2-4 h natural
  // spawn deadline; today it is only the placement-failure backoff. Clamp so
  // the first boot after the upgrade (or any oversized persisted value) can
  // never gate every zone's spawns for hours.
  const nextAtMs = finite(save.nextPortalAtMs, nowMs);
  ctx.riftPortalNextAt =
    ctx.time + Math.min(RIFT_PORTAL_RETRY_DELAY, Math.max(0, nextAtMs - nowMs) / 1000);
  return ctx.naturalRiftPortals.length;
}
