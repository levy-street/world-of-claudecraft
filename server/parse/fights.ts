// One open fight: participant identity, wire-record emission, and the
// recorder-side rollup totals that fight_close carries. Mutable accumulators
// are deliberate here (the ChatLogger precedent): this is bounded internal
// hot-path state, never shared, and the emitted records are fresh objects.
import type {
  ArenaFrame,
  EventEnrichment,
  FightOutcome,
  FightParticipant,
  GroupType,
  ParticipantTotals,
  RiftFrame,
  Segment,
  Surface,
} from './contract';
import type { ParseCounters } from './counters';
import type { RecordSink } from './types';

/** Raw event lines per fight; past this, rollups continue and lines stop. */
export const MAX_RAW_EVENTS_PER_FIGHT = 200_000;
const TICK_MS = 50;

interface ParticipantAccum {
  info: FightParticipant;
  damage: number;
  taken: number;
  healing: number;
  overheal: number;
  absorbed: number;
  deaths: number;
  interrupts: number;
  dispels: number;
  activeTicks: number;
  lastActiveTick: number;
}

/**
 * A close decision made during segmenter observation. The recorder applies it
 * AFTER routing the current tick's events, so a fight's final blows (which
 * share the drained batch with the state transition) are never dropped.
 */
export interface PendingClose {
  fight: OpenFight;
  outcome: FightOutcome;
}

export interface FightOpenOptions {
  fightId: string;
  surface: Surface;
  key: string;
  difficulty: string | null;
  segment: Segment;
  groupType: GroupType;
  startedTick: number;
  arena?: ArenaFrame;
  rift?: RiftFrame;
  participants: FightParticipant[];
}

export class OpenFight {
  readonly fightId: string;
  readonly surface: Surface;
  readonly segment: Segment;
  readonly startedTick: number;
  /** Hostile npc ids seen fighting the participants (for boss-cast tracking). */
  readonly mobIds = new Set<number>();
  /** Display names for tracked non-participant actors, shipped on close so
   * the dashboard labels mob entity ids. Bounded by the mobIds tracking cap:
   * names are only noted for ids admitted into mobIds. */
  private readonly actorNames = new Map<number, string>();
  /** The encounter's boss entity, for kill/reset classification; null = trash. */
  primaryBossId: number | null = null;
  /** Tick of the last event routed here; drives trash-segment quiet closes. */
  lastRoutedTick: number;
  truncated = false;

  private readonly byCharacter = new Map<number, ParticipantAccum>();
  private readonly byEntity = new Map<number, number>();
  private eventCount = 0;

  constructor(
    opts: FightOpenOptions,
    private readonly sink: RecordSink,
    private readonly counters: ParseCounters,
  ) {
    this.fightId = opts.fightId;
    this.surface = opts.surface;
    this.segment = opts.segment;
    this.startedTick = opts.startedTick;
    this.lastRoutedTick = opts.startedTick;
    for (const p of opts.participants) this.track(p);
    this.sink.enqueue({
      t: 'fight_open',
      fightId: opts.fightId,
      surface: opts.surface,
      key: opts.key,
      difficulty: opts.difficulty,
      segment: opts.segment,
      groupType: opts.groupType,
      startedTick: opts.startedTick,
      ...(opts.arena !== undefined ? { arena: opts.arena } : {}),
      ...(opts.rift !== undefined ? { rift: opts.rift } : {}),
      participants: opts.participants,
    });
    this.counters.recordsEmitted++;
  }

  participantEntityIds(): IterableIterator<number> {
    return this.byEntity.keys();
  }

  hasEntity(entityId: number): boolean {
    return this.byEntity.has(entityId);
  }

  addLateJoin(tick: number, participant: FightParticipant): void {
    if (this.byCharacter.has(participant.characterId)) {
      // Mid-fight relog: the same character returns under a NEW entity id
      // (pids are per-login). Re-point the entity index at the surviving
      // accumulator so hasEntity/totals keep working; dedupe only the join
      // RECORD, never the index, or every later event re-resolves the
      // participant on the tick path and the post-relog rollup goes missing.
      this.byEntity.set(participant.entityId, participant.characterId);
      return;
    }
    this.track(participant);
    this.sink.enqueue({ t: 'join', fightId: this.fightId, tick, participant });
    this.counters.recordsEmitted++;
  }

  /**
   * Append one raw event line, respecting the per-fight cap. The SimEvent is
   * held BY REFERENCE until the shipper marshals it (up to one flush interval
   * later); that is safe because nothing mutates a drained event after
   * routeEvents' serializeEventFragments invariant, and the recorder observes
   * before routeEvents. The one sanctioned mutation, routeEvents' chat-flair
   * stamp, touches only chat events, which are never routed into a fight. A
   * future in-place COMBAT event edit would corrupt shipped telemetry: copy
   * here if that invariant ever softens.
   */
  recordEvent(tick: number, ev: Record<string, unknown>, x?: EventEnrichment): void {
    if (this.eventCount >= MAX_RAW_EVENTS_PER_FIGHT) {
      if (!this.truncated) {
        this.truncated = true;
        this.counters.fightsTruncated++;
      }
      return;
    }
    this.eventCount++;
    this.lastRoutedTick = tick;
    this.sink.enqueue({
      t: 'ev',
      fightId: this.fightId,
      tick,
      ev,
      ...(x !== undefined ? { x } : {}),
    });
    this.counters.recordsEmitted++;
  }

  recordBossCast(
    tick: number,
    bossId: number,
    ability: string,
    action: 'start' | 'stop' | 'interrupted',
    castTotal?: number,
  ): void {
    this.sink.enqueue({
      t: 'bosscast',
      fightId: this.fightId,
      bossId,
      tick,
      ability,
      action,
      ...(castTotal !== undefined ? { castTotal } : {}),
    });
    this.counters.recordsEmitted++;
  }

  recordPhase(tick: number, bossId: number, phase: number): void {
    this.sink.enqueue({ t: 'mech', fightId: this.fightId, tick, kind: 'phase', bossId, phase });
    this.counters.recordsEmitted++;
  }

  recordObjective(tick: number, detail: string): void {
    this.sink.enqueue({ t: 'mech', fightId: this.fightId, tick, kind: 'objective', detail });
    this.counters.recordsEmitted++;
  }

  // Rollup accumulation. The recorder calls these for every routed event even
  // past the raw-line cap, so fight_close totals stay complete.

  noteDamage(
    tick: number,
    sourceEntityId: number,
    targetEntityId: number,
    amount: number,
    absorbed: number,
  ): void {
    const source = this.accumByEntity(sourceEntityId);
    if (source !== undefined) {
      source.damage += amount;
      this.markActive(source, tick);
    }
    const target = this.accumByEntity(targetEntityId);
    if (target !== undefined) {
      target.taken += amount;
      target.absorbed += absorbed;
    }
  }

  noteHeal(tick: number, sourceEntityId: number, amount: number, overheal: number): void {
    const source = this.accumByEntity(sourceEntityId);
    if (source === undefined) return;
    source.healing += amount;
    source.overheal += overheal;
    this.markActive(source, tick);
  }

  noteDeath(entityId: number): void {
    const accum = this.accumByEntity(entityId);
    if (accum !== undefined) accum.deaths++;
  }

  /** Credit a pet's action to its owning participant. */
  ownerCharacterId(ownerEntityId: number): number | undefined {
    return this.byEntity.get(ownerEntityId);
  }

  close(tick: number, outcome: FightOutcome): void {
    const perParticipant: Record<string, ParticipantTotals> = {};
    for (const [characterId, a] of this.byCharacter) {
      perParticipant[String(characterId)] = {
        damage: a.damage,
        taken: a.taken,
        healing: a.healing,
        overheal: a.overheal,
        absorbed: a.absorbed,
        deaths: a.deaths,
        interrupts: a.interrupts,
        dispels: a.dispels,
        activeMs: a.activeTicks * TICK_MS,
      };
    }
    this.sink.enqueue({
      t: 'fight_close',
      fightId: this.fightId,
      endedTick: tick,
      durationMs: Math.max(0, tick - this.startedTick) * TICK_MS,
      outcome,
      truncated: this.truncated,
      rollup: { perParticipant },
      ...(this.actorNames.size > 0
        ? { actors: [...this.actorNames].map(([id, name]) => ({ id, name })) }
        : {}),
    });
    this.counters.recordsEmitted++;
    this.counters.fightsClosed++;
  }

  /** Note a tracked non-participant actor's display name for the close roster. */
  noteActor(entityId: number, name: string): void {
    if (!this.actorNames.has(entityId)) this.actorNames.set(entityId, name);
  }

  private track(p: FightParticipant): void {
    this.byCharacter.set(p.characterId, {
      info: p,
      damage: 0,
      taken: 0,
      healing: 0,
      overheal: 0,
      absorbed: 0,
      deaths: 0,
      interrupts: 0,
      dispels: 0,
      activeTicks: 0,
      lastActiveTick: -1,
    });
    this.byEntity.set(p.entityId, p.characterId);
  }

  private accumByEntity(entityId: number): ParticipantAccum | undefined {
    const characterId = this.byEntity.get(entityId);
    return characterId === undefined ? undefined : this.byCharacter.get(characterId);
  }

  private markActive(accum: ParticipantAccum, tick: number): void {
    if (accum.lastActiveTick === tick) return;
    accum.lastActiveTick = tick;
    accum.activeTicks++;
  }
}
