// The parse recorder: a passive per-tick observer at the server's event drain.
// Segmenters open fights BEFORE events route and close them AFTER (via
// PendingClose intents), so a fight always receives its own first and last
// tick of events: an arena killing blow lands in the same drained batch as the
// 'over' transition, and a boss kill lands in the same batch as the death.
// Dungeon/raid fights are additionally EVENT-opened: the first player-vs-
// instance-mob damage with no claiming fight asks the dungeon segmenter to
// open one mid-routing. One O(events) pass; everything not touching an open
// fight drops on the first Map lookup. A budget breaker disables capture
// rather than ever degrading the tick loop.
import type { SimEvent } from '../../src/sim/types';
import { ArenaSegmenter } from './arena';
import { BattlegroundSegmenter } from './battleground';
import { BossCastSynthesizer } from './boss_casts';
import type { EventEnrichment, FightParticipant, Surface } from './contract';
import type { OpenFight, PendingClose } from './fights';
import type { ParseFlags } from './flags';
import { DungeonSegmenter } from './instances';
import { RiftSegmenter } from './rifts';
import type { RecorderSim, RecordSink, SegmenterHost } from './types';

/** A single observe() pass above this cost is a budget strike. */
const BUDGET_HARD_MS = 5;
/** Consecutive strikes that trip the breaker and disable capture. */
const BUDGET_STRIKES_TO_DISABLE = 3;
/** Defensive bound on tracked hostile npcs per fight. */
const MAX_TRACKED_MOBS_PER_FIGHT = 256;

const PVE_SURFACES: ReadonlySet<Surface> = new Set(['raid', 'dungeon', 'rift']);

export interface ParseRecorderOptions {
  flags: ParseFlags;
  sim: RecorderSim;
  sink: RecordSink;
  counters: SegmenterHost['counters'];
  resolveParticipant: (pid: number) => FightParticipant | null;
  /** Boss detection by mob template; production wires the MOBS boss flag. */
  isBossTemplate?: (templateId: string) => boolean;
  /** Injectable for deterministic golden tests. */
  idFactory?: () => string;
  /** Injectable monotonic ms clock; defaults to performance.now. */
  clock?: () => number;
}

export class ParseRecorder {
  private readonly arena = new ArenaSegmenter();
  private readonly battleground = new BattlegroundSegmenter();
  private readonly dungeons = new DungeonSegmenter();
  private readonly rifts = new RiftSegmenter();
  private readonly bossCasts = new BossCastSynthesizer();
  private readonly fightsByEntity = new Map<number, OpenFight>();
  private readonly fightsByMob = new Map<number, OpenFight>();
  private readonly openFights = new Set<OpenFight>();
  private readonly host: SegmenterHost;
  private readonly clock: () => number;
  private disabled = false;
  private strikes = 0;
  private seq = 0;

  constructor(private readonly opts: ParseRecorderOptions) {
    this.clock = opts.clock ?? (() => performance.now());
    const idFactory =
      opts.idFactory ?? ((): string => `f-${Date.now().toString(36)}-${(this.seq++).toString(36)}`);
    this.host = {
      sim: opts.sim,
      sink: opts.sink,
      counters: opts.counters,
      resolveParticipant: opts.resolveParticipant,
      nextFightId: idFactory,
      surfaceEnabled: (surface: Surface) => opts.flags.surfaces.has(surface),
      isBossTemplate: opts.isBossTemplate ?? (() => false),
    };
  }

  get isDisabled(): boolean {
    return this.disabled;
  }

  /** Called once per sim tick, strictly read-only over events and sim state. */
  observe(events: readonly SimEvent[]): void {
    if (!this.opts.flags.enabled || this.disabled) return;
    const t0 = this.clock();
    const tick = this.opts.sim.tickCount;
    const opened: OpenFight[] = [];
    const closing: PendingClose[] = [];

    this.arena.observe(this.host, tick, opened, closing);
    this.battleground.observe(this.host, tick, opened, closing);
    this.dungeons.observe(this.host, tick, opened, closing);
    this.rifts.observe(this.host, tick, opened, closing);
    for (const fight of opened) this.indexFight(fight);

    if (events.length > 0) this.routeEvents(events, tick, closing);
    this.bossCasts.observe(this.host, tick, this.openFights);

    for (const { fight, outcome } of closing) {
      if (!this.openFights.has(fight)) continue;
      fight.close(tick, outcome);
      this.deindexFight(fight);
    }
    this.opts.counters.fightsOpen = this.openFights.size;

    const ms = this.clock() - t0;
    this.opts.counters.observeMsLast = ms;
    if (ms > this.opts.counters.observeMsMax) this.opts.counters.observeMsMax = ms;
    if (ms > BUDGET_HARD_MS) {
      this.strikes++;
      if (this.strikes >= BUDGET_STRIKES_TO_DISABLE) this.tripBreaker(tick);
    } else {
      this.strikes = 0;
    }
  }

  /** Final flush is the shipper's job; the recorder just closes open fights. */
  stop(): void {
    const tick = this.opts.sim.tickCount;
    for (const fight of this.openFights) {
      fight.close(tick, 'reset');
      this.bossCasts.release(fight);
    }
    this.openFights.clear();
    this.fightsByEntity.clear();
    this.fightsByMob.clear();
    this.opts.counters.fightsOpen = 0;
  }

  private indexFight(fight: OpenFight): void {
    this.openFights.add(fight);
    for (const entityId of fight.participantEntityIds()) {
      this.fightsByEntity.set(entityId, fight);
    }
    for (const mobId of fight.mobIds) this.fightsByMob.set(mobId, fight);
  }

  private deindexFight(fight: OpenFight): void {
    this.openFights.delete(fight);
    this.bossCasts.release(fight);
    for (const entityId of fight.participantEntityIds()) {
      if (this.fightsByEntity.get(entityId) === fight) this.fightsByEntity.delete(entityId);
    }
    for (const mobId of fight.mobIds) {
      if (this.fightsByMob.get(mobId) === fight) this.fightsByMob.delete(mobId);
    }
  }

  private tripBreaker(tick: number): void {
    this.disabled = true;
    this.opts.counters.captureDisabled = 1;
    console.error(
      `[parse] budget breaker tripped (${BUDGET_STRIKES_TO_DISABLE} ticks over ${BUDGET_HARD_MS}ms): capture disabled until restart`,
    );
    for (const fight of this.openFights) {
      fight.close(tick, 'reset');
      this.bossCasts.release(fight);
    }
    this.openFights.clear();
    this.fightsByEntity.clear();
    this.fightsByMob.clear();
  }

  private routeEvents(events: readonly SimEvent[], tick: number, closing: PendingClose[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'damage':
          this.routeDamage(ev, tick, closing);
          break;
        case 'heal2':
          if (ev.cueOnly !== true) this.routeHeal2(ev, tick);
          break;
        case 'heal': {
          const fight = this.fightsByEntity.get(ev.targetId);
          if (fight !== undefined) fight.recordEvent(tick, ev as Record<string, unknown>);
          break;
        }
        case 'aura':
          this.routeAura(ev, tick);
          break;
        case 'castStart':
        case 'castStop': {
          const fight = this.fightsByEntity.get(ev.entityId);
          if (fight !== undefined) fight.recordEvent(tick, ev as Record<string, unknown>);
          break;
        }
        case 'death':
          this.routeDeath(ev, tick);
          break;
        default:
          break;
      }
    }
  }

  /** A pet's owner entity id, or the id itself for everything else. */
  private ownerResolved(entityId: number): number {
    const ownerId = this.opts.sim.entities.get(entityId)?.ownerId;
    return ownerId !== undefined && ownerId !== null ? ownerId : entityId;
  }

  /** The fight an entity belongs to: participant, pet-of-participant, or
   * tracked hostile mob, in that order. */
  private fightFor(entityId: number): { fight: OpenFight; ownerId: number | null } | null {
    const direct = this.fightsByEntity.get(entityId);
    if (direct !== undefined) return { fight: direct, ownerId: null };
    const ownerId = this.opts.sim.entities.get(entityId)?.ownerId;
    if (ownerId !== undefined && ownerId !== null) {
      const viaOwner = this.fightsByEntity.get(ownerId);
      if (viaOwner !== undefined) return { fight: viaOwner, ownerId };
    }
    const viaMob = this.fightsByMob.get(entityId);
    if (viaMob !== undefined) return { fight: viaMob, ownerId: null };
    return null;
  }

  /** PvE fights accept players discovered mid-fight as late joins. */
  private ensureParticipant(fight: OpenFight, entityId: number, tick: number): void {
    if (!PVE_SURFACES.has(fight.surface)) return;
    const resolved = this.ownerResolved(entityId);
    if (fight.hasEntity(resolved)) return;
    const participant = this.host.resolveParticipant(resolved);
    if (participant === null) return;
    fight.addLateJoin(tick, participant);
    this.fightsByEntity.set(resolved, fight);
  }

  private routeDamage(
    ev: SimEvent & { type: 'damage' },
    tick: number,
    closing: PendingClose[],
  ): void {
    const bySource = this.fightFor(ev.sourceId);
    let match = bySource ?? this.fightFor(ev.targetId);
    let sourceOwnerId = bySource?.ownerId ?? null;
    if (match === null) {
      const opened = this.dungeons.onUnroutedCombat(
        this.host,
        tick,
        this.ownerResolved(ev.sourceId),
        this.ownerResolved(ev.targetId),
        closing,
      );
      if (opened === null) return;
      this.indexFight(opened);
      const sourceOwner = this.ownerResolved(ev.sourceId);
      sourceOwnerId =
        sourceOwner !== ev.sourceId && opened.hasEntity(sourceOwner) ? sourceOwner : null;
      match = { fight: opened, ownerId: sourceOwnerId };
    }
    let fight = match.fight;
    // A boss pull during an open trash segment routes here via the participant
    // index; escalate so the boss fight becomes its own segment.
    if (fight.segment === 'trash') {
      const src = this.opts.sim.entities.get(ev.sourceId);
      const tgt = this.opts.sim.entities.get(ev.targetId);
      const bossInvolved =
        (src !== undefined && this.host.isBossTemplate(src.templateId)) ||
        (tgt !== undefined && this.host.isBossTemplate(tgt.templateId));
      if (bossInvolved) {
        const escalated = this.dungeons.onUnroutedCombat(
          this.host,
          tick,
          this.ownerResolved(ev.sourceId),
          this.ownerResolved(ev.targetId),
          closing,
        );
        if (escalated !== null && escalated !== fight) {
          this.indexFight(escalated);
          fight = escalated;
        }
      }
    }
    this.ensureParticipant(fight, ev.sourceId, tick);
    this.ensureParticipant(fight, ev.targetId, tick);
    const enrichment: EventEnrichment | undefined =
      sourceOwnerId !== null ? { ownerId: sourceOwnerId } : undefined;
    fight.recordEvent(tick, ev as Record<string, unknown>, enrichment);
    const creditSource = sourceOwnerId ?? ev.sourceId;
    fight.noteDamage(tick, creditSource, ev.targetId, ev.amount, ev.absorbed ?? 0);
    this.trackMob(fight, ev.sourceId);
    this.trackMob(fight, ev.targetId);
  }

  private routeHeal2(ev: SimEvent & { type: 'heal2' }, tick: number): void {
    const bySource = this.fightFor(ev.sourceId);
    const match = bySource ?? this.fightFor(ev.targetId);
    if (match === null) return;
    const { fight } = match;
    this.ensureParticipant(fight, ev.sourceId, tick);
    this.ensureParticipant(fight, ev.targetId, tick);
    const sourceOwnerId = bySource?.ownerId ?? null;
    const enrichment: EventEnrichment | undefined =
      sourceOwnerId !== null ? { ownerId: sourceOwnerId } : undefined;
    fight.recordEvent(tick, ev as Record<string, unknown>, enrichment);
    const creditSource = sourceOwnerId ?? ev.sourceId;
    fight.noteHeal(tick, creditSource, ev.amount, ev.overheal ?? 0);
  }

  private routeAura(ev: SimEvent & { type: 'aura' }, tick: number): void {
    const fight = this.fightsByEntity.get(ev.targetId) ?? this.fightsByMob.get(ev.targetId);
    if (fight === undefined) return;
    let enrichment: EventEnrichment | undefined;
    if (ev.gained) {
      if (ev.sourceId !== undefined) {
        // Fidelity round 1 landed: the event itself carries attribution.
        enrichment = {
          auraSourceId: ev.sourceId,
          ...(ev.abilityId !== undefined ? { auraId: ev.abilityId } : {}),
          ...(ev.stacks !== undefined ? { auraStacks: ev.stacks } : {}),
        };
      } else {
        // Fallback state-join for un-widened emit sites: scan the live aura
        // array backwards by name. A fresh application or refresh always
        // appends to the end (applyAura splices then pushes), so the backward
        // scan finds the most recent same-named aura. Best-effort only: with
        // two same-named auras from different casters the older one is
        // unreachable by name alone.
        const auras = this.opts.sim.entities.get(ev.targetId)?.auras;
        if (auras !== undefined) {
          for (let i = auras.length - 1; i >= 0; i--) {
            const aura = auras[i];
            if (aura !== undefined && aura.name === ev.name) {
              enrichment = {
                auraSourceId: aura.sourceId,
                auraId: aura.id,
                ...(aura.stacks !== undefined ? { auraStacks: aura.stacks } : {}),
              };
              break;
            }
          }
        }
      }
    }
    fight.recordEvent(tick, ev as Record<string, unknown>, enrichment);
  }

  private routeDeath(ev: SimEvent & { type: 'death' }, tick: number): void {
    const match = this.fightFor(ev.entityId) ?? this.fightFor(ev.killerId);
    if (match === null) return;
    match.fight.recordEvent(tick, ev as Record<string, unknown>);
    match.fight.noteDeath(ev.entityId);
  }

  /** Remember hostile npcs engaged with the fight (boss-cast tracking input). */
  private trackMob(fight: OpenFight, entityId: number): void {
    if (fight.hasEntity(entityId) || fight.mobIds.has(entityId)) return;
    if (fight.mobIds.size >= MAX_TRACKED_MOBS_PER_FIGHT) return;
    const entity = this.opts.sim.entities.get(entityId);
    if (entity === undefined) return;
    if (entity.ownerId !== undefined && entity.ownerId !== null) return;
    // Players in a PvE fight late-join as participants; anything else with no
    // owner engaged here is a hostile npc.
    if (this.host.resolveParticipant(entityId) !== null) return;
    fight.mobIds.add(entityId);
    fight.noteActor(entityId, entity.name);
    this.fightsByMob.set(entityId, fight);
  }
}
