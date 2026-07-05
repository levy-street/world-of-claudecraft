import { zoneAt } from '../sim/data';
import type { SimEvent } from '../sim/types';
import type { IWorld } from '../world_api';
import type { GlitchBehaviorEventBody } from './glitch';

type MetadataValue = string | number | boolean | null;
type Metadata = Record<string, MetadataValue>;

export interface GlitchBehaviorEventInput {
  stepKey: string;
  actionKey: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
}

export type GlitchBehaviorEventSender = (event: GlitchBehaviorEventBody) => Promise<unknown>;

export interface GlitchBehaviorTrackerOptions {
  sendEvent: GlitchBehaviorEventSender;
  build: string;
  now?: () => number;
}

const KEY_MAX = 100;
const METADATA_STRING_MAX = 160;
const POSITION_BUCKET_SIZE = 25;
const WORLD_OBSERVE_MS = 2000;
const UI_SURFACE_THROTTLE_MS = 30_000;
const XP_THROTTLE_MS = 15_000;
const LOW_HEALTH_THROTTLE_MS = 60_000;

export class GlitchBehaviorTracker {
  private readonly sendEvent: GlitchBehaviorEventSender;
  private readonly build: string;
  private readonly now: () => number;
  private readonly once = new Set<string>();
  private readonly uiLast = new Map<string, number>();
  private lastWorldObserve = Number.NEGATIVE_INFINITY;
  private lastZoneId: string | null = null;
  private lastLevel: number | null = null;
  private lastXpAt = Number.NEGATIVE_INFINITY;
  private lastLowHealthAt = Number.NEGATIVE_INFINITY;

  constructor(opts: GlitchBehaviorTrackerOptions) {
    this.sendEvent = opts.sendEvent;
    this.build = opts.build;
    this.now = opts.now ?? (() => performance.now());
  }

  track(stepKey: string, actionKey: string, metadata: Metadata = {}): void {
    const event = behaviorEventBody({
      stepKey,
      actionKey,
      metadata: this.withBuild(metadata),
      timestamp: new Date().toISOString(),
    });
    void this.sendEvent(event).catch(() => {
      // Behavioral events must never block or crash play. The next signal retries.
    });
  }

  trackOnce(id: string, stepKey: string, actionKey: string, metadata: Metadata = {}): void {
    if (this.once.has(id)) return;
    this.once.add(id);
    this.track(stepKey, actionKey, metadata);
  }

  observeWorld(world: IWorld, now = this.now()): void {
    if (now - this.lastWorldObserve < WORLD_OBSERVE_MS) return;
    this.lastWorldObserve = now;

    const snapshot = worldMetadata(world);
    const zoneId = String(snapshot.zone_id);
    if (zoneId && zoneId !== this.lastZoneId) {
      this.lastZoneId = zoneId;
      this.track(`zone_${zoneId}`, 'enter', snapshot);
    }

    const level = Number(snapshot.level);
    if (Number.isFinite(level) && level !== this.lastLevel) {
      this.lastLevel = level;
      this.track(levelStepKey(level), 'reach', snapshot);
    }

    const hpPct = Number(snapshot.hp_pct);
    if (
      Number.isFinite(hpPct) &&
      hpPct > 0 &&
      hpPct <= 25 &&
      now - this.lastLowHealthAt >= LOW_HEALTH_THROTTLE_MS
    ) {
      this.lastLowHealthAt = now;
      this.track('combat', 'low_health', snapshot);
    }
  }

  trackFirstInput(kind: string, world: IWorld): void {
    this.trackOnce('first_input', 'input', 'first_intent', {
      ...worldMetadata(world),
      input_kind: normalizeKey(kind),
    });
  }

  trackUiSurface(surface: string, method: string, world: IWorld): void {
    const key = `${surface}:${method}`;
    const now = this.now();
    if ((this.uiLast.get(key) ?? Number.NEGATIVE_INFINITY) + UI_SURFACE_THROTTLE_MS > now) return;
    this.uiLast.set(key, now);
    this.track(`ui_${normalizeKey(surface)}`, 'open', {
      ...worldMetadata(world),
      input_method: normalizeKey(method),
    });
  }

  trackChat(actionKey: string, metadata: Metadata, world: IWorld): void {
    this.track('chat', actionKey, { ...worldMetadata(world), ...metadata });
  }

  trackDisconnect(reason: string, world: IWorld | null): void {
    this.track('disconnect', 'lost', {
      ...(world ? worldMetadata(world) : {}),
      reason: disconnectReasonKey(reason),
    });
  }

  observeSimEvents(events: readonly SimEvent[], world: IWorld, now = this.now()): void {
    for (const ev of events) {
      const mapped = behaviorEventInputsFromSimEvent(ev, world);
      for (const event of mapped) {
        if (event.stepKey === 'progression' && event.actionKey === 'xp_gain') {
          if (now - this.lastXpAt < XP_THROTTLE_MS) continue;
          this.lastXpAt = now;
        }
        this.track(
          event.stepKey,
          event.actionKey,
          sanitizeMetadata({ ...worldMetadata(world), ...event.metadata }),
        );
      }
    }
  }

  private withBuild(metadata: Metadata): Metadata {
    return sanitizeMetadata({ build: this.build, ...metadata });
  }
}

export function behaviorEventBody(input: GlitchBehaviorEventInput): GlitchBehaviorEventBody {
  const body: GlitchBehaviorEventBody = {
    step_key: normalizeKey(input.stepKey),
    action_key: normalizeKey(input.actionKey),
  };
  const metadata = sanitizeMetadata(input.metadata ?? {});
  if (Object.keys(metadata).length > 0) body.metadata = metadata;
  if (input.timestamp) body.event_timestamp = input.timestamp;
  return body;
}

export function behaviorEventInputsFromSimEvent(
  ev: SimEvent,
  world: IWorld,
): GlitchBehaviorEventInput[] {
  switch (ev.type) {
    case 'damage':
    case 'heal':
    case 'heal2':
    case 'spellfx':
    case 'spellfxAt':
    case 'aura':
    case 'comboPoint':
    case 'castStop':
    case 'log':
    case 'chat':
    case 'companionBark':
      return [];
    case 'xp':
      return [
        {
          stepKey: 'progression',
          actionKey: 'xp_gain',
          metadata: { amount: safeNumber(ev.amount), rested: safeNumber(ev.rested ?? 0) },
        },
      ];
    case 'levelup':
      return [
        { stepKey: levelStepKey(ev.level), actionKey: 'reach', metadata: { level: ev.level } },
      ];
    case 'virtualLevelUp':
      return [
        {
          stepKey: 'post_cap_progression',
          actionKey: 'virtual_level_reach',
          metadata: { virtual_level: ev.level },
        },
      ];
    case 'milestoneUnlocked':
      return [
        {
          stepKey: 'post_cap_progression',
          actionKey: 'milestone_unlock',
          metadata: { milestone_id: ev.milestoneId },
        },
      ];
    case 'learnAbility':
      return [
        {
          stepKey: 'progression',
          actionKey: 'ability_learned',
          metadata: { ability_id: ev.abilityId, rank: ev.rank },
        },
      ];
    case 'loot':
      return [{ stepKey: 'loot', actionKey: 'received' }];
    case 'lootRoll':
    case 'masterLoot':
      return [
        {
          stepKey: 'loot_roll',
          actionKey: 'prompt',
          metadata: { item_id: ev.itemId, quality: ev.quality ?? null },
        },
      ];
    case 'error':
      return [
        {
          stepKey: 'game_error',
          actionKey: 'shown',
          metadata: { reason: ev.reason ?? 'unknown' },
        },
      ];
    case 'questAccepted':
      return [{ stepKey: 'quest', actionKey: 'accept', metadata: { quest_id: ev.questId } }];
    case 'questProgress':
      return [{ stepKey: 'quest', actionKey: 'progress', metadata: { quest_id: ev.questId } }];
    case 'questReady':
      return [{ stepKey: 'quest', actionKey: 'ready', metadata: { quest_id: ev.questId } }];
    case 'questDone':
      return [{ stepKey: 'quest', actionKey: 'complete', metadata: { quest_id: ev.questId } }];
    case 'castStart':
      return [
        {
          stepKey: 'combat',
          actionKey: ev.entityId === world.player.id ? 'ability_start' : 'nearby_cast_start',
          metadata: { ability_id: ev.ability, cast_time: safeNumber(ev.time) },
        },
      ];
    case 'death':
      return ev.entityId === world.player.id
        ? [{ stepKey: 'death', actionKey: 'player_dead' }]
        : [];
    case 'playerDeath':
      return [{ stepKey: 'death', actionKey: 'player_dead' }];
    case 'respawn':
      return [{ stepKey: 'death', actionKey: 'respawn' }];
    case 'vendor':
      return [
        {
          stepKey: 'economy_vendor',
          actionKey: ev.action,
          metadata: { item_id: ev.itemId ?? null },
        },
      ];
    case 'mailbox':
      return [{ stepKey: 'mailbox', actionKey: 'open' }];
    case 'mailArrived':
      return [{ stepKey: 'mailbox', actionKey: 'mail_arrived' }];
    case 'mailResult':
      return [{ stepKey: 'mailbox', actionKey: ev.code }];
    case 'calendarResult':
      return [{ stepKey: 'calendar', actionKey: ev.code }];
    case 'partyInvite':
      return [{ stepKey: 'social_party', actionKey: 'invite_received' }];
    case 'guildInvite':
      return [{ stepKey: 'social_guild', actionKey: 'invite_received' }];
    case 'tradeRequest':
      return [{ stepKey: 'social_trade', actionKey: 'request_received' }];
    case 'tradeDone':
      return [{ stepKey: 'social_trade', actionKey: 'complete' }];
    case 'duelRequest':
      return [{ stepKey: 'social_duel', actionKey: 'request_received' }];
    case 'duelCountdown':
      return [{ stepKey: 'social_duel', actionKey: 'countdown' }];
    case 'duelStart':
      return [{ stepKey: 'social_duel', actionKey: 'start' }];
    case 'duelEnd':
      return [{ stepKey: 'social_duel', actionKey: 'end' }];
    case 'arenaQueued':
      return [{ stepKey: 'arena', actionKey: 'queue', metadata: { format: ev.format } }];
    case 'arenaUnqueued':
      return [{ stepKey: 'arena', actionKey: 'unqueue' }];
    case 'arenaFound':
      return [{ stepKey: 'arena', actionKey: 'match_found', metadata: { format: ev.format } }];
    case 'arenaCountdown':
      return [{ stepKey: 'arena', actionKey: 'countdown' }];
    case 'arenaStart':
      return [{ stepKey: 'arena', actionKey: 'start' }];
    case 'arenaEnd':
      return [
        {
          stepKey: 'arena',
          actionKey: ev.draw ? 'draw' : ev.won ? 'win' : 'loss',
          metadata: {
            format: ev.format,
            rating_delta: safeNumber(ev.ratingAfter - ev.ratingBefore),
          },
        },
      ];
    case 'fiestaScore':
      return [{ stepKey: 'arena_fiesta', actionKey: 'score', metadata: { team: ev.team } }];
    case 'fiestaWave':
      return [
        {
          stepKey: 'arena_fiesta',
          actionKey: 'wave',
          metadata: { wave: ev.wave, total_waves: ev.totalWaves },
        },
      ];
    case 'fiestaWord':
      return [{ stepKey: 'arena_fiesta', actionKey: ev.flavor }];
    case 'fiestaDown':
      return [{ stepKey: 'arena_fiesta', actionKey: 'down' }];
    case 'augmentOffer':
      return [
        {
          stepKey: 'arena_fiesta',
          actionKey: 'augment_offer',
          metadata: { tier: ev.tier, wave: ev.wave },
        },
      ];
    case 'augmentChosen':
      return [
        {
          stepKey: 'arena_fiesta',
          actionKey: 'augment_chosen',
          metadata: { augment_id: ev.augmentId, mine: ev.mine },
        },
      ];
    case 'fiestaPowerup':
      return [
        {
          stepKey: 'arena_fiesta',
          actionKey: 'powerup',
          metadata: { powerup_id: ev.defId, mine: ev.entityId === world.player.id },
        },
      ];
    case 'delveEntered':
      return [
        {
          stepKey: 'delve',
          actionKey: 'enter',
          metadata: { delve_id: ev.delveId, tier_id: ev.tierId },
        },
      ];
    case 'delveComplete':
      return [
        {
          stepKey: 'delve',
          actionKey: 'complete',
          metadata: { delve_id: ev.delveId, tier_id: ev.tierId },
        },
      ];
    case 'delveFailed':
      return [
        {
          stepKey: 'delve',
          actionKey: 'fail',
          metadata: { delve_id: ev.delveId, tier_id: ev.tierId },
        },
      ];
    case 'delveLoreUnlock':
      return [{ stepKey: 'delve', actionKey: 'lore_unlock', metadata: { lore_id: ev.loreId } }];
    case 'lockpickOffer':
      return [
        {
          stepKey: 'lockpick',
          actionKey: 'offer',
          metadata: { bountiful: ev.bountiful },
        },
      ];
    case 'lockpickSession':
      return [
        {
          stepKey: 'lockpick',
          actionKey: 'start',
          metadata: {
            session_id: ev.sessionId,
            loot_tier: ev.lootTier,
            tries_total: ev.triesTotal,
          },
        },
      ];
    case 'lockpickStep':
      return [
        {
          stepKey: 'lockpick',
          actionKey: 'step',
          metadata: {
            session_id: ev.sessionId,
            result: String(ev.result),
            tries: ev.tries,
            tries_total: ev.triesTotal,
          },
        },
      ];
    case 'lockpickEnd':
      return [
        {
          stepKey: 'lockpick',
          actionKey: ev.outcome,
          metadata: { session_id: ev.sessionId, loot_tier: ev.lootTier ?? null },
        },
      ];
    case 'lockpickBonus':
      return [{ stepKey: 'lockpick', actionKey: 'bonus', metadata: { tier: ev.tier } }];
    case 'delveChestLoot':
      return [
        {
          stepKey: 'delve',
          actionKey: 'chest_loot',
          metadata: { chest_id: ev.chestId, item_count: ev.items.length },
        },
      ];
    case 'delveRitePulse':
      return [{ stepKey: 'delve_rite', actionKey: 'pulse', metadata: { shrine: ev.shrineKind } }];
    case 'delveRiteFeedback':
      return [
        {
          stepKey: 'delve_rite',
          actionKey: ev.correct ? 'correct' : 'incorrect',
          metadata: { shrine: ev.shrineKind },
        },
      ];
    case 'delveRiteChoosePrompt':
      return [{ stepKey: 'delve_rite', actionKey: 'choose_prompt' }];
    case 'skinEvent':
      return [
        {
          stepKey: 'cosmetic_skin_event',
          actionKey: 'offer',
          metadata: { rank: ev.rank, catalog: ev.catalog ?? null },
        },
      ];
  }
}

export function worldMetadata(world: IWorld): Metadata {
  const player = world.player;
  const zone = zoneAt(player.pos.z);
  return sanitizeMetadata({
    class_key: player.templateId,
    level: player.level,
    zone_id: zone.id,
    biome: zone.biome,
    x_bucket: bucket(player.pos.x),
    z_bucket: bucket(player.pos.z),
    hp_pct: player.maxHp > 0 ? Math.round((player.hp / player.maxHp) * 100) : 0,
    in_combat: player.inCombat,
    dead: player.dead,
    ghost: player.ghost,
  });
}

export function levelStepKey(level: number): string {
  const safe = Math.max(1, Math.min(999, Math.floor(level)));
  return `level_${String(safe).padStart(2, '0')}`;
}

export function disconnectReasonKey(reason: string): string {
  const normalized = reason.trim().toLowerCase();
  if (normalized.includes('lost')) return 'connection_lost';
  if (normalized.includes('rejected')) return 'rejected';
  if (normalized.includes('already in world')) return 'already_in_world';
  if (normalized.includes('not authenticated')) return 'not_authenticated';
  if (normalized.includes('timeout')) return 'timeout';
  return 'unknown';
}

function sanitizeMetadata(input: Record<string, unknown>): Metadata {
  const out: Metadata = {};
  for (const [rawKey, value] of Object.entries(input)) {
    const key = normalizeKey(rawKey);
    if (!key) continue;
    if (typeof value === 'string') out[key] = value.slice(0, METADATA_STRING_MAX);
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = safeNumber(value);
    else if (typeof value === 'boolean') out[key] = value;
    else if (value === null) out[key] = null;
  }
  return out;
}

function normalizeKey(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, KEY_MAX);
  return cleaned || 'unknown';
}

function bucket(value: number): number {
  return Math.round(value / POSITION_BUCKET_SIZE) * POSITION_BUCKET_SIZE;
}

function safeNumber(value: number): number {
  return Math.round(value * 1000) / 1000;
}
