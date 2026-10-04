// Fire and Fly's Replay (src/sim/fire_and_fly_replay.ts): the ended seat's trial again in
// place, from one fresh world rng draw keyed by the host's salt, the arena, the tower, the
// return point and the prior mount kept, and the run's world quest context decided again
// under the current day's rules. Refused silently on a live run, off the roof, for a
// cannon seat, or when the day leaves the character no run to play.
import { describe, expect, it } from 'vitest';
import { dispatchVehicleCommand } from '../server/vehicle_command_wire';
import { FIRE_AND_FLY_DUNGEON_ID } from '../src/sim/content/fire_and_fly_arena';
import { TURRET_SCENARIO_INTRODUCTION } from '../src/sim/content/fire_and_fly_scenarios';
import { DEFAULT_MOUNT } from '../src/sim/content/mounts';
import { NORTH_WATCH_CANNON } from '../src/sim/content/vehicle_stations';
import {
  FIRE_AND_FLY_NPC_DEF,
  FIRE_AND_FLY_NPC_ID,
  FIRE_AND_FLY_QUEST_ID,
  WORLD_QUEST_FIRE_AND_FLY,
} from '../src/sim/content/world_quest_fire_and_fly';
import { WORLD_QUESTS } from '../src/sim/content/world_quests';
import { dungeonAt } from '../src/sim/data';
import { createCannonEncounter } from '../src/sim/minigames/cannon_encounter';
import { turretRunKey, turretSessionSeed } from '../src/sim/minigames/turret_defense_rng';
import { turretResult } from '../src/sim/minigames/turret_result';
import { mountItemId, summonMountItem } from '../src/sim/mounts';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { PrivateSalt, SimEvent, TurretSession } from '../src/sim/types';
import { ALWAYS_ACTIVE_WORLD_QUEST_IDS } from '../src/sim/world_quest_rotation';
import { WORLD_SEED } from '../src/sim/world_seed';

const DAY = '2026-09-06';
const NEXT_DAY = '2026-09-07';
const SALT: PrivateSalt = [0x0badf00d, 0x5eed5a17];
const ORIGIN = { x: 0, z: 0 };

function atTheGate(salt?: PrivateSalt): { sim: Sim; meta: PlayerMeta } {
  const sim = new Sim({
    seed: WORLD_SEED,
    playerClass: 'warrior',
    devCommands: true,
    ...(salt ? { privateSalt: salt } : {}),
  });
  sim.resetDay = DAY;
  sim.setPlayerLevel(WORLD_QUEST_FIRE_AND_FLY.minLevel);
  sim.player.pos = sim.groundPos(FIRE_AND_FLY_NPC_DEF.pos.x - 2, FIRE_AND_FLY_NPC_DEF.pos.z);
  sim.player.prevPos = { ...sim.player.pos };
  sim.tick();
  sim.drainEvents();
  return { sim, meta: sim.meta(sim.playerId) as PlayerMeta };
}

function seat(meta: PlayerMeta): TurretSession {
  if (meta.vehicle?.kind !== 'turret') throw new Error('expected a turret seat');
  return meta.vehicle;
}

/** Ends the seated run as `phase`, with the result the engine would record. */
function forceEnd(meta: PlayerMeta, phase: 'won' | 'lost', integrity = 20): void {
  const defense = seat(meta).defense;
  defense.integrity = phase === 'won' ? integrity : 0;
  defense.phase = phase;
  defense.result = turretResult(defense.plan, {
    phase,
    integrity: defense.integrity,
    stats: { kills: 10, barrelKills: 0, bowled: 0, shockwaves: 0, frags: 0, resupplies: 0 },
  });
}

function replay(sim: Sim, pid = sim.playerId): boolean {
  return sim.useVehicleAction('turret_replay', ORIGIN, pid);
}

function arenaKeyOf(sim: Sim) {
  return sim.ctx.instances.find(
    (inst) => inst.dungeonId === FIRE_AND_FLY_DUNGEON_ID && inst.partyKey !== null,
  );
}

function scores(events: readonly SimEvent[]) {
  return events.filter((e) => e.type === 'worldQuestScore');
}

function questDone(events: readonly SimEvent[]): number {
  return events.filter((e) => e.type === 'worldQuestDone' && e.questId === FIRE_AND_FLY_QUEST_ID)
    .length;
}

describe('Replay starts the ended trial again in place', () => {
  it('keeps the arena, the tower, the return point and the mount; a new run and seat identity', () => {
    const { sim, meta } = atTheGate();
    meta.ridingTrained = true;
    sim.addItem(mountItemId(DEFAULT_MOUNT) as string, 1);
    expect(summonMountItem(sim.ctx, sim.playerId, DEFAULT_MOUNT)).toBe(true);
    for (let i = 0; i < 40 && sim.player.mountKey === ''; i++) sim.tick();
    expect(sim.player.mountKey).toBe(DEFAULT_MOUNT);
    sim.chat('/dev turret introduction');
    const before = seat(meta);
    const arena = arenaKeyOf(sim);
    const roof = { ...sim.player.pos };
    for (let i = 0; i < 30; i++) sim.tick();
    forceEnd(meta, 'lost');
    before.nextFeedbackSeq = 9;
    before.feedback.push({ seq: 8, tick: sim.tickCount, event: { type: 'waveCleared', wave: 0 } });
    const rev = meta.wireRev;
    const draws: number[] = [];
    sim.ctx.rng.setObserver((value) => draws.push(value));

    expect(replay(sim)).toBe(true);

    sim.ctx.rng.setObserver(null);
    expect(draws).toHaveLength(1);
    const draw = draws[0];
    const after = seat(meta);
    expect(after).not.toBe(before);
    expect(after.defense).not.toBe(before.defense);
    expect(after.defense.plan).toBe(before.defense.plan);
    expect(after.defense.plan.scenarioId).toBe(TURRET_SCENARIO_INTRODUCTION.id);
    expect(after.defense.seed).toBe(turretSessionSeed(draw));
    expect(after.defense.seed).not.toBe(before.defense.seed);
    expect(after.defense.startTick).toBe(sim.tickCount);
    expect(after.defense.phase).toBe('intro');
    expect(after.defense.integrity).toBe(after.defense.plan.integrity);
    expect(after.defense.monsters).toEqual([]);
    expect(after.feedback).toEqual([]);
    expect(after.nextFeedbackSeq).toBe(1);
    expect(after.origin).toEqual(before.origin);
    expect(after.returnTo).toEqual(before.returnTo);
    expect(after.priorMountKey).toBe(DEFAULT_MOUNT);
    expect(after.worldQuest).toBeUndefined();
    expect(meta.wireRev).toBeGreaterThan(rev);
    expect(arenaKeyOf(sim)).toBe(arena);
    expect(sim.player.pos).toEqual(roof);
    expect(dungeonAt(sim.player.pos.x)?.id).toBe(FIRE_AND_FLY_DUNGEON_ID);

    // The replayed run plays on, and leaving still goes home, remounted.
    for (let i = 0; i < 5; i++) sim.tick();
    expect(seat(meta)).toBe(after);
    sim.leaveVehicle();
    expect(sim.player.pos).toEqual({
      x: before.returnTo.x,
      y: before.returnTo.y,
      z: before.returnTo.z,
    });
    expect(sim.player.mountKey).toBe(DEFAULT_MOUNT);
  });

  it('replays a won run too, and keys the new run with the host salt', () => {
    const { sim, meta } = atTheGate(SALT);
    sim.chat('/dev turret');
    forceEnd(meta, 'won');
    expect(replay(sim)).toBe(true);
    const defense = seat(meta).defense;
    expect(defense.runKey).toEqual(turretRunKey(SALT, defense.seed));
  });
});

describe('Replay refusals are silent', () => {
  it('refuses a live run, drawing nothing and keeping the seat', () => {
    const { sim, meta } = atTheGate();
    sim.chat('/dev turret');
    const before = seat(meta);
    const draws: number[] = [];
    sim.ctx.rng.setObserver((value) => draws.push(value));
    for (const phase of ['intro', 'wave'] as const) {
      before.defense.phase = phase;
      expect(replay(sim)).toBe(false);
    }
    sim.ctx.rng.setObserver(null);
    expect(draws).toEqual([]);
    expect(seat(meta)).toBe(before);
  });

  it('refuses a player off the roof, dead, or with no seat, and never touches another seat', () => {
    const { sim, meta } = atTheGate();
    const other = sim.addPlayer('mage', 'Onlooker');
    sim.chat('/dev turret');
    forceEnd(meta, 'lost');
    const before = seat(meta);
    expect(replay(sim, other)).toBe(false);
    dispatchVehicleCommand(sim, other, {
      cmd: 'vehicle_action',
      action: 'turret_replay',
      x: 0,
      z: 0,
      pid: sim.playerId,
    });
    expect(seat(meta)).toBe(before);

    sim.player.pos = { ...sim.player.pos, x: sim.player.pos.x + 1 };
    expect(replay(sim)).toBe(false);
    sim.player.pos = { ...before.origin };
    sim.player.dead = true;
    expect(replay(sim)).toBe(false);
    sim.player.dead = false;
    expect(seat(meta)).toBe(before);
    expect(replay(sim)).toBe(true);
  });

  it('never replays a cannon seat', () => {
    const { sim, meta } = atTheGate();
    meta.vehicle = {
      kind: 'cannon',
      stationId: NORTH_WATCH_CANNON.id,
      cycle: meta.worldQuestCycle,
      origin: { ...sim.player.pos },
      encounter: createCannonEncounter(),
    };
    const cannon = meta.vehicle;
    expect(replay(sim)).toBe(false);
    expect(meta.vehicle).toBe(cannon);
  });
});

describe("Replay's world quest context follows the current day's rules", () => {
  it('replays a lost paid run as a paid run, and a won one as practice', () => {
    const { sim, meta } = atTheGate();
    sim.talkToNpc(FIRE_AND_FLY_NPC_ID);
    const cycle = meta.worldQuestCycle;
    expect(seat(meta).worldQuest).toEqual({
      questId: FIRE_AND_FLY_QUEST_ID,
      cycle,
      practice: false,
    });
    forceEnd(meta, 'lost');
    sim.tick();
    expect(replay(sim)).toBe(true);
    expect(seat(meta).worldQuest).toEqual({
      questId: FIRE_AND_FLY_QUEST_ID,
      cycle,
      practice: false,
    });

    forceEnd(meta, 'won');
    expect(questDone(sim.tick())).toBe(1);
    expect(meta.worldQuestLog.get(FIRE_AND_FLY_QUEST_ID)?.state).toBe('completed');
    const copper = sim.copper;
    expect(replay(sim)).toBe(true);
    expect(seat(meta).worldQuest).toEqual({
      questId: FIRE_AND_FLY_QUEST_ID,
      cycle,
      practice: true,
    });
    forceEnd(meta, 'won');
    expect(questDone([...sim.tick(), ...sim.tick()])).toBe(0);
    expect(sim.copper).toBe(copper);
  });

  it('scores a replayed win once per run on the boards, a dev replay never', () => {
    const { sim, meta } = atTheGate();
    sim.talkToNpc(FIRE_AND_FLY_NPC_ID);
    forceEnd(meta, 'won');
    expect(scores([...sim.tick(), ...sim.tick()])).toHaveLength(1);
    for (let run = 0; run < 2; run++) {
      expect(replay(sim)).toBe(true);
      expect(seat(meta).worldQuest?.scored).toBeUndefined();
      forceEnd(meta, 'won');
      expect(scores([...sim.tick(), ...sim.tick(), ...sim.tick()])).toHaveLength(1);
    }

    sim.leaveVehicle();
    sim.chat('/dev turret');
    forceEnd(meta, 'won');
    sim.tick();
    expect(replay(sim)).toBe(true);
    forceEnd(meta, 'won');
    expect(scores([...sim.tick(), ...sim.tick()])).toHaveLength(0);
  });

  it("keeps an ended run on its roof over the rollover, and replays it for the new day's pay", () => {
    const { sim, meta } = atTheGate();
    sim.talkToNpc(FIRE_AND_FLY_NPC_ID);
    const seatedCycle = meta.worldQuestCycle;
    forceEnd(meta, 'won');
    expect(questDone(sim.tick())).toBe(1);
    const ended = seat(meta);

    sim.resetDay = NEXT_DAY;
    for (let i = 0; i < 3; i++) sim.tick();
    expect(meta.worldQuestCycle).not.toBe(seatedCycle);
    expect(seat(meta)).toBe(ended);
    expect(meta.worldQuestLog.has(FIRE_AND_FLY_QUEST_ID)).toBe(false);
    sim.drainEvents();

    expect(replay(sim)).toBe(true);
    const started = sim
      .drainEvents()
      .filter((e) => e.type === 'worldQuestStarted' && e.questId === FIRE_AND_FLY_QUEST_ID);
    expect(started).toHaveLength(1);
    expect(seat(meta).worldQuest).toEqual({
      questId: FIRE_AND_FLY_QUEST_ID,
      cycle: meta.worldQuestCycle,
      practice: false,
    });
    expect(meta.worldQuestLog.get(FIRE_AND_FLY_QUEST_ID)?.state).toBe('active');
    const copper = sim.copper;
    forceEnd(meta, 'won');
    expect(questDone(sim.tick())).toBe(1);
    expect(sim.copper).toBeGreaterThan(copper);
  });

  it('reads the new day on the replay itself, before the tick that would roll it over', () => {
    const { sim, meta } = atTheGate();
    sim.talkToNpc(FIRE_AND_FLY_NPC_ID);
    const seatedCycle = meta.worldQuestCycle;
    forceEnd(meta, 'lost');
    sim.tick();
    sim.resetDay = NEXT_DAY;
    expect(replay(sim)).toBe(true);
    expect(meta.worldQuestCycle).not.toBe(seatedCycle);
    expect(seat(meta).worldQuest?.cycle).toBe(meta.worldQuestCycle);
    expect(seat(meta).worldQuest?.practice).toBe(false);
  });

  it('refuses silently when the day has no run left to play, and Leave still goes home', () => {
    const { sim, meta } = atTheGate();
    sim.talkToNpc(FIRE_AND_FLY_NPC_ID);
    forceEnd(meta, 'lost');
    sim.tick();
    const replacement = WORLD_QUESTS.find(
      (quest) =>
        quest.zoneId === WORLD_QUEST_FIRE_AND_FLY.zoneId &&
        !ALWAYS_ACTIVE_WORLD_QUEST_IDS.includes(quest.id),
    );
    if (!replacement) throw new Error('expected a rotating quest beside Fire and Fly');
    meta.worldQuestReplacements = { [FIRE_AND_FLY_QUEST_ID]: replacement.id };
    const before = seat(meta);
    const draws: number[] = [];
    sim.ctx.rng.setObserver((value) => draws.push(value));

    expect(replay(sim)).toBe(false);

    sim.ctx.rng.setObserver(null);
    expect(draws).toEqual([]);
    expect(seat(meta)).toBe(before);
    sim.leaveVehicle();
    expect(meta.vehicle ?? null).toBeNull();
    expect(sim.player.pos).toEqual({
      x: before.returnTo.x,
      y: before.returnTo.y,
      z: before.returnTo.z,
    });
  });

  it('still ends a live run at the rollover', () => {
    const { sim, meta } = atTheGate();
    sim.talkToNpc(FIRE_AND_FLY_NPC_ID);
    for (let i = 0; i < 10; i++) sim.tick();
    sim.resetDay = NEXT_DAY;
    for (let i = 0; i < 3; i++) sim.tick();
    expect(meta.vehicle ?? null).toBeNull();
  });
});
