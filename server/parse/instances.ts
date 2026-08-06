// Dungeon and raid segmentation over InstanceSlot claims. Fights here are
// EVENT-opened: the first player-vs-instance-mob damage opens a boss fight
// (boss-flagged template) or a trash segment; per-tick observation only closes
// them (boss death, boss reset/wipe, trash quiet, slot vacancy). One active
// fight per slot at a time; a boss pull during trash closes the trash segment.
import type { FightParticipant, Surface } from './contract';
import { OpenFight, type PendingClose } from './fights';
import type { InstanceSlotView, SegmenterHost } from './types';

/** Trash segments close after this many quiet ticks (5s, aligned with the
 * in-game damage meter's ENCOUNTER_END_SECONDS in src/ui/meters.ts). */
const TRASH_QUIET_TICKS = 100;
/** Instance ids whose fights are raids, not dungeons. */
const RAID_DUNGEON_IDS: ReadonlySet<string> = new Set(['nythraxis_boss_arena']);

interface SlotState {
  slotKey: string;
  view: InstanceSlotView;
  activeFight: OpenFight | null;
  /** Mob ids this state registered in mobToSlot. Tracked HERE because the
   * slot view is the LIVE sim object: freeInstance reassigns its mobIds to []
   * in the same call that nulls partyKey, so release() must never derive the
   * unregister set from the view or every run leaks its roster forever. */
  registeredMobIds: Set<number>;
}

export class DungeonSegmenter {
  private readonly slots = new Map<string, SlotState>();
  private readonly mobToSlot = new Map<number, SlotState>();

  observe(host: SegmenterHost, tick: number, _opened: OpenFight[], closing: PendingClose[]): void {
    if (!host.surfaceEnabled('dungeon') && !host.surfaceEnabled('raid')) return;
    const seen = new Set<string>();
    for (const view of host.sim.instances) {
      const slotKey = `${view.dungeonId}#${view.slot}`;
      seen.add(slotKey);
      const state = this.slots.get(slotKey);
      if (view.partyKey !== null && state === undefined) {
        this.claim(slotKey, view);
      } else if (view.partyKey === null && state !== undefined) {
        this.release(state, closing);
      } else if (state !== undefined) {
        state.view = view;
        this.maintain(host, tick, state, closing);
      }
    }
    for (const [slotKey, state] of this.slots) {
      if (!seen.has(slotKey)) this.release(state, closing);
    }
  }

  /**
   * Called by the recorder for a combat event no open fight claims. Opens (or
   * returns) the slot's active fight when either side is an instance mob.
   * candidateIds are already pet-resolved to owners where possible.
   */
  onUnroutedCombat(
    host: SegmenterHost,
    tick: number,
    aId: number,
    bId: number,
    closing: PendingClose[],
  ): OpenFight | null {
    const state = this.mobToSlot.get(aId) ?? this.mobToSlot.get(bId);
    if (state === undefined) return null;
    const surface: Surface = RAID_DUNGEON_IDS.has(state.view.dungeonId) ? 'raid' : 'dungeon';
    if (!host.surfaceEnabled(surface)) return null;
    const mobId = this.mobToSlot.has(aId) ? aId : bId;
    const otherId = mobId === aId ? bId : aId;
    const mob = host.sim.entities.get(mobId);
    if (mob === undefined) return null;
    const isBoss = host.isBossTemplate(mob.templateId);

    if (state.activeFight !== null) {
      if (isBoss && state.activeFight.segment === 'trash') {
        // Boss pull during trash: the trash segment ends now, the boss fight
        // starts now; both receive this batch's events correctly because
        // closes apply after routing.
        closing.push({ fight: state.activeFight, outcome: 'clear' });
        state.activeFight = null;
      } else {
        return state.activeFight;
      }
    }

    const participants = this.seedParticipants(host, mob.threat, otherId);
    if (participants.length === 0) return null;
    const fight = new OpenFight(
      {
        fightId: host.nextFightId(),
        surface,
        key: state.view.dungeonId,
        difficulty: state.view.difficulty,
        segment: isBoss ? 'boss' : 'trash',
        groupType: surface === 'raid' ? 'raid' : 'party',
        startedTick: tick,
        participants,
      },
      host.sink,
      host.counters,
    );
    if (isBoss) fight.primaryBossId = mobId;
    fight.mobIds.add(mobId);
    state.activeFight = fight;
    return fight;
  }

  private claim(slotKey: string, view: InstanceSlotView): void {
    const state: SlotState = {
      slotKey,
      view,
      activeFight: null,
      registeredMobIds: new Set(view.mobIds),
    };
    this.slots.set(slotKey, state);
    for (const mobId of state.registeredMobIds) this.mobToSlot.set(mobId, state);
  }

  private release(state: SlotState, closing: PendingClose[]): void {
    if (state.activeFight !== null) {
      closing.push({
        fight: state.activeFight,
        outcome: state.activeFight.segment === 'boss' ? 'reset' : 'abandon',
      });
      state.activeFight = null;
    }
    for (const mobId of state.registeredMobIds) {
      if (this.mobToSlot.get(mobId) === state) this.mobToSlot.delete(mobId);
    }
    state.registeredMobIds.clear();
    this.slots.delete(state.slotKey);
  }

  private maintain(
    host: SegmenterHost,
    tick: number,
    state: SlotState,
    closing: PendingClose[],
  ): void {
    if (state.view.mobIds.length > state.registeredMobIds.size) {
      for (const mobId of state.view.mobIds) {
        this.mobToSlot.set(mobId, state);
        state.registeredMobIds.add(mobId);
      }
    }
    const fight = state.activeFight;
    if (fight === null) return;
    if (fight.segment === 'boss') {
      const boss =
        fight.primaryBossId === null ? undefined : host.sim.entities.get(fight.primaryBossId);
      if (boss === undefined || boss.dead === true) {
        closing.push({ fight, outcome: 'kill' });
        state.activeFight = null;
        return;
      }
      // A leash/evade reset looks identical to a wipe at the event layer, so
      // classify by participant state: anyone still alive means reset.
      if (boss.inCombat === false && boss.hp !== undefined && boss.hp >= (boss.maxHp ?? 0)) {
        closing.push({ fight, outcome: this.anyParticipantAlive(host, fight) ? 'reset' : 'wipe' });
        state.activeFight = null;
      }
      return;
    }
    if (tick - fight.lastRoutedTick > TRASH_QUIET_TICKS) {
      closing.push({ fight, outcome: 'clear' });
      state.activeFight = null;
    }
  }

  private anyParticipantAlive(host: SegmenterHost, fight: OpenFight): boolean {
    for (const entityId of fight.participantEntityIds()) {
      const entity = host.sim.entities.get(entityId);
      if (entity !== undefined && entity.dead !== true) return true;
    }
    return false;
  }

  /** Seed from the mob's threat table (players only) plus the triggering id. */
  private seedParticipants(
    host: SegmenterHost,
    threat: ReadonlyMap<number, number> | undefined,
    triggerId: number,
  ): FightParticipant[] {
    const ids = new Set<number>();
    ids.add(triggerId);
    if (threat !== undefined) {
      for (const id of threat.keys()) ids.add(id);
    }
    const participants: FightParticipant[] = [];
    for (const id of ids) {
      const p = host.resolveParticipant(id);
      if (p !== null) participants.push(p);
    }
    return participants;
  }
}
