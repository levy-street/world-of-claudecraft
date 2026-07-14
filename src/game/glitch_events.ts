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

export interface GlitchTalkInteractionInput {
  kind: 'open' | 'option';
  npcId: string;
  npcEntityId?: number;
  optionKey?: string;
  questId?: string;
  questState?: string;
  questCount?: number;
  hasVendor?: boolean;
  hasMarket?: boolean;
  source?: string;
}

export interface GlitchMerchantInteractionInput {
  kind: 'open' | 'option';
  merchantType: 'vendor' | 'market';
  vendorId?: string;
  vendorEntityId?: number;
  optionKey?: string;
  itemId?: string;
  stockCount?: number;
  buybackCount?: number;
  proceeds?: number;
  source?: string;
}

const KEY_MAX = 100;
const METADATA_STRING_MAX = 160;
const POSITION_BUCKET_SIZE = 25;
const WORLD_OBSERVE_MS = 2000;
const UI_SURFACE_THROTTLE_MS = 30_000;
const XP_THROTTLE_MS = 15_000;
const LOW_HEALTH_THROTTLE_MS = 60_000;
const CHAT_RECEIVE_THROTTLE_MS = 10_000;
const BARK_THROTTLE_MS = 15_000;

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
  private lastInCombat: boolean | null = null;
  private lastBarkAt = Number.NEGATIVE_INFINITY;
  private readonly lastChatReceiveAt = new Map<string, number>();

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

    const inCombat = Boolean(snapshot.in_combat);
    if (this.lastInCombat === null) {
      this.lastInCombat = inCombat;
    } else if (inCombat !== this.lastInCombat) {
      this.lastInCombat = inCombat;
      this.track('combat', inCombat ? 'engage' : 'disengage', snapshot);
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

  trackEmote(emoteId: string, world: IWorld): void {
    this.track('emote', 'perform', { ...worldMetadata(world), emote_id: normalizeKey(emoteId) });
  }

  trackTalkInteraction(input: GlitchTalkInteractionInput, world: IWorld): void {
    for (const event of talkBehaviorEventInputs(input)) {
      this.track(event.stepKey, event.actionKey, {
        ...worldMetadata(world),
        ...sanitizeMetadata(event.metadata ?? {}),
      });
    }
  }

  trackMerchantInteraction(input: GlitchMerchantInteractionInput, world: IWorld): void {
    for (const event of merchantBehaviorEventInputs(input)) {
      this.track(event.stepKey, event.actionKey, {
        ...worldMetadata(world),
        ...sanitizeMetadata(event.metadata ?? {}),
      });
    }
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
        if (event.stepKey === 'chat' && event.actionKey === 'receive') {
          const channel = String(event.metadata?.channel ?? 'say');
          const last = this.lastChatReceiveAt.get(channel) ?? Number.NEGATIVE_INFINITY;
          if (now - last < CHAT_RECEIVE_THROTTLE_MS) continue;
          this.lastChatReceiveAt.set(channel, now);
        }
        if (event.stepKey === 'companion_dialogue' && event.actionKey === 'bark') {
          if (now - this.lastBarkAt < BARK_THROTTLE_MS) continue;
          this.lastBarkAt = now;
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
      return [];
    case 'chat':
      return chatBehaviorEventInputs(ev, world);
    case 'companionBark':
      return [
        {
          stepKey: 'companion_dialogue',
          actionKey: 'bark',
          metadata: { bark_id: ev.barkId, companion_id: ev.companionId },
        },
      ];
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
    case 'deedUnlocked':
      return [
        {
          stepKey: 'deeds',
          actionKey: 'unlock',
          metadata: { deed_id: ev.deedId, retro: ev.retro === true },
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
      return questLifecycleEventInputs(ev.questId, 'accept');
    case 'questProgress':
      return questLifecycleEventInputs(ev.questId, 'progress');
    case 'questReady':
      return questLifecycleEventInputs(ev.questId, 'ready');
    case 'questDone':
      return questLifecycleEventInputs(ev.questId, 'complete');
    case 'castStart':
      return [
        {
          stepKey: 'combat',
          actionKey: ev.entityId === world.player.id ? 'ability_start' : 'nearby_cast_start',
          metadata: { ability_id: ev.ability, cast_time: safeNumber(ev.time) },
        },
      ];
    case 'death':
      return deathBehaviorEventInputs(ev, world);
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
        {
          stepKey: merchantOutcomeStepKey(ev.action),
          actionKey: 'complete',
          metadata: { item_id: ev.itemId ?? null, merchant_type: 'vendor' },
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
    case 'delveObjectiveComplete':
      return [
        {
          stepKey: 'delve',
          actionKey: 'objective_complete',
          metadata: { delve_id: ev.delveId, tier_id: ev.tierId },
        },
      ];
    case 'craftResult':
      return [
        {
          stepKey: 'crafting',
          actionKey: ev.ok ? 'craft_success' : 'craft_fail',
          metadata: {
            recipe_id: ev.recipeId,
            item_id: ev.itemId ?? null,
            count: ev.count ?? null,
            quality: ev.quality ?? null,
            reason: ev.reason ?? null,
          },
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
  return [];
}

export function deathBehaviorEventInputs(
  ev: Extract<SimEvent, { type: 'death' }>,
  world: IWorld,
): GlitchBehaviorEventInput[] {
  // The local player died: record what dealt the killing blow (kind + class/template,
  // never a player name).
  if (ev.entityId === world.player.id) {
    return [
      { stepKey: 'death', actionKey: 'player_dead', metadata: killerMetadata(ev.killerId, world) },
    ];
  }
  // Only the local player's own kills are behavior; nearby mobs dying to each other
  // or to other players are not this player's signal.
  if (ev.killerId !== world.player.id) return [];
  const victim = world.entities?.get(ev.entityId) ?? null;
  if (victim?.kind === 'player') {
    return [
      {
        stepKey: 'combat_pvp',
        actionKey: 'killing_blow',
        metadata: { victim_class: victim.templateId, victim_level: victim.level },
      },
    ];
  }
  return [
    {
      stepKey: 'combat',
      actionKey: 'enemy_slain',
      metadata: victim
        ? { victim_kind: victim.kind, mob_template: victim.templateId, victim_level: victim.level }
        : { victim_kind: 'unknown' },
    },
  ];
}

export function chatBehaviorEventInputs(
  ev: Extract<SimEvent, { type: 'chat' }>,
  world: IWorld,
): GlitchBehaviorEventInput[] {
  // The player's own outgoing messages are tracked at the send site (trackChat).
  // Here we only record messages the player receives, by channel, never any text
  // or sender identity.
  if (ev.fromPid === world.player.id) return [];
  return [{ stepKey: 'chat', actionKey: 'receive', metadata: { channel: ev.channel ?? 'say' } }];
}

function killerMetadata(killerId: number, world: IWorld): Metadata {
  const killer = world.entities?.get(killerId) ?? null;
  if (!killer) return {};
  return { killer_kind: killer.kind, killer_template: killer.templateId };
}

export function questLifecycleEventInputs(
  questId: string,
  stage: 'detail' | 'accept' | 'progress' | 'ready' | 'complete',
  metadata: Record<string, unknown> = {},
): GlitchBehaviorEventInput[] {
  const baseMetadata = { quest_id: questId, quest_stage: stage, ...metadata };
  const actionKey = stage === 'detail' ? 'view_detail' : stage;
  return [
    { stepKey: 'quest', actionKey, metadata: baseMetadata },
    {
      stepKey: questStageStepKey(questId, stage),
      actionKey: 'reach',
      metadata: baseMetadata,
    },
  ];
}

export function talkBehaviorEventInputs(
  input: GlitchTalkInteractionInput,
): GlitchBehaviorEventInput[] {
  const metadata = {
    npc_id: input.npcId,
    npc_entity_id: input.npcEntityId,
    option_key: input.optionKey,
    quest_id: input.questId,
    quest_state: input.questState,
    quest_count: input.questCount,
    has_vendor: input.hasVendor,
    has_market: input.hasMarket,
    source: input.source,
  };
  if (input.kind === 'open') {
    return [{ stepKey: 'talk_open', actionKey: 'open', metadata }];
  }

  const optionKey = normalizeKey(input.optionKey ?? 'unknown');
  const events: GlitchBehaviorEventInput[] = [
    { stepKey: 'talk_option', actionKey: `select_${optionKey}`, metadata },
  ];
  if (
    input.questId &&
    (optionKey === 'quest_offer_detail' ||
      optionKey === 'quest_turnin_detail' ||
      optionKey === 'quest_discuss')
  ) {
    events.push(...questLifecycleEventInputs(input.questId, 'detail', metadata));
  }
  return events;
}

export function merchantBehaviorEventInputs(
  input: GlitchMerchantInteractionInput,
): GlitchBehaviorEventInput[] {
  const metadata = {
    merchant_type: input.merchantType,
    vendor_id: input.vendorId,
    vendor_entity_id: input.vendorEntityId,
    option_key: input.optionKey,
    item_id: input.itemId,
    stock_count: input.stockCount,
    buyback_count: input.buybackCount,
    proceeds: input.proceeds,
    source: input.source,
  };
  if (input.kind === 'open') {
    return [{ stepKey: 'merchant_open', actionKey: input.merchantType, metadata }];
  }

  const optionKey = normalizeKey(input.optionKey ?? 'unknown');
  const events: GlitchBehaviorEventInput[] = [
    { stepKey: 'merchant_option', actionKey: optionKey, metadata },
  ];
  if (optionKey === 'buy' || optionKey === 'sell_junk' || optionKey === 'buyback') {
    events.push({
      stepKey: merchantOutcomeStepKey(optionKey === 'sell_junk' ? 'sell' : optionKey),
      actionKey: 'attempt',
      metadata,
    });
  }
  return events;
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

export function questStageStepKey(questId: string, stage: string): string {
  return `quest_${normalizeKey(questId)}_${normalizeKey(stage)}`;
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

function merchantOutcomeStepKey(action: string): string {
  const normalized = normalizeKey(action);
  if (normalized === 'sell_junk') return 'merchant_sell';
  return `merchant_${normalized}`;
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
