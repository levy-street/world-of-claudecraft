import { describe, expect, it, vi } from 'vitest';
import { dispatchWorldQuestWire } from '../server/quest_command_wire';
import { applyQuestSelfWire, type QuestSelfMirrors } from '../src/net/quest_snapshot_wire';
import { FIRE_AND_FLY_DUNGEON_ID } from '../src/sim/content/fire_and_fly_arena';
import {
  TURRET_DEFAULT_SCENARIO,
  TURRET_SCENARIO_INTRODUCTION,
  TURRET_SCENARIOS,
} from '../src/sim/content/fire_and_fly_scenarios';
import {
  FIRE_AND_FLY_NPC_DEF,
  FIRE_AND_FLY_NPC_ID,
  FIRE_AND_FLY_QUEST_ID,
  WORLD_QUEST_FIRE_AND_FLY,
} from '../src/sim/content/world_quest_fire_and_fly';
import { GLIDER_NPC_DEF } from '../src/sim/content/world_quest_glider';
import { NPCS, WORLD_QUESTS_BY_ID } from '../src/sim/data';
import { positionAt } from '../src/sim/minigames/thrown_body';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { TurretDefenseView } from '../src/sim/turret_defense_session';
import type { Entity, SimEvent, TurretSession } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { startFireAndFly } from '../src/sim/world_quest_fire_and_fly';
import { isReplayableWorldQuest } from '../src/sim/world_quest_practice';
import { worldQuestProgressForWire } from '../src/sim/world_quest_trace_wire';
import { completeWorldQuestTurret } from '../src/sim/world_quests';
import { WORLD_SEED } from '../src/sim/world_seed';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { localizeSimText } from '../src/ui/sim_i18n';
import {
  fireAndFlyInstructionLines,
  fireAndFlyTrialChoices,
} from '../src/ui/world_quest_fire_and_fly_view';
import { worldQuestInstructorDialog } from '../src/ui/world_quest_instructor_view';
import { worldQuestInstructorAnchor } from '../src/ui/world_quest_marker_anchor';
import { worldQuestDisplayName, worldQuestObjectiveLabel } from '../src/ui/world_quest_view';
import type { IWorldVehicles } from '../src/world_api/vehicles';
import { bareClient } from './helpers/bare_client';

const DEED = 'exp_gunners_oath';
const RUN_BOUND = 20 * 60 * 8;
// Full scripted runs through the whole world tick: generous under a loaded parallel run.
const RUN_TIMEOUT_MS = 120_000;
const ground = { ground: (x: number, z: number) => groundHeight(x, z, WORLD_SEED) };

interface Gate {
  sim: Sim;
  meta: PlayerMeta;
  player: Entity;
}

function standBesideAlder(sim: Sim): void {
  sim.player.pos = sim.groundPos(FIRE_AND_FLY_NPC_DEF.pos.x - 2, FIRE_AND_FLY_NPC_DEF.pos.z);
  sim.player.prevPos = { ...sim.player.pos };
  sim.player.facing = 0.75;
}

/** A level 20 warrior two yards from Master Gunner Alder, today's row minted. */
function atTheGate(): Gate {
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands: true });
  sim.resetDay = '2026-09-06';
  sim.setPlayerLevel(WORLD_QUEST_FIRE_AND_FLY.minLevel);
  standBesideAlder(sim);
  sim.tick();
  sim.drainEvents();
  return { sim, meta: sim.meta(sim.playerId)!, player: sim.player };
}

function turretSeat(meta: PlayerMeta): TurretSession {
  if (meta.vehicle?.kind !== 'turret') throw new Error('expected a turret seat');
  return meta.vehicle;
}

function nearestLive(
  defense: Pick<TurretDefenseView, 'cx' | 'cz' | 'monsters'>,
  tick: number,
): { x: number; z: number } | null {
  let best: { x: number; z: number } | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const m of defense.monsters) {
    if (m.hp <= 0) continue;
    const p = positionAt(m.seg, tick, ground);
    const d = Math.hypot(p.x - defense.cx, p.z - defense.cz);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** Ticks the seat to its end, firing at the monster nearest the tower when `aim`; returns every event. */
function playOut(sim: Sim, aim: boolean): SimEvent[] {
  const world: IWorldVehicles = sim;
  const events: SimEvent[] = [];
  const phase = () => world.turretSession?.defense.phase ?? 'gone';
  for (let i = 0; i < RUN_BOUND && phase() !== 'won' && phase() !== 'lost'; i++) {
    events.push(...sim.tick());
    const view = world.turretSession;
    if (!aim || !view || sim.tickCount < view.defense.readyTick) continue;
    const target = nearestLive(view.defense, sim.tickCount);
    if (target) world.useVehicleAction('turret_fire', target);
  }
  for (let i = 0; i < 3; i++) events.push(...sim.tick());
  return events;
}

function questDone(events: readonly SimEvent[]): number {
  return events.filter((e) => e.type === 'worldQuestDone' && e.questId === FIRE_AND_FLY_QUEST_ID)
    .length;
}

function deedUnlocks(events: readonly SimEvent[]): number {
  return events.filter((e) => e.type === 'deedUnlocked' && e.deedId === DEED).length;
}

function errors(events: readonly SimEvent[]): string[] {
  return events.flatMap((e) => (e.type === 'error' ? [e.text] : []));
}

/** Seats the Introduction through the dialog's pick and wins it with the scripted aimer. */
function winIntroduction(gate: Gate): SimEvent[] {
  gate.sim.startWorldQuestActivity(FIRE_AND_FLY_QUEST_ID, {
    courseId: TURRET_SCENARIO_INTRODUCTION.id,
  });
  expect(turretSeat(gate.meta).defense.plan.scenarioId).toBe(TURRET_SCENARIO_INTRODUCTION.id);
  const events = playOut(gate.sim, true);
  expect(turretSeat(gate.meta).defense.phase).toBe('won');
  return events;
}

describe('Fire and Fly world quest content', () => {
  it('stands Master Gunner Alder at the Evergarden gate, lazily spawned on his reserved id', () => {
    expect(NPCS[FIRE_AND_FLY_NPC_DEF.id]).toBe(FIRE_AND_FLY_NPC_DEF);
    expect(FIRE_AND_FLY_NPC_DEF.dynamic).toBe(true);
    expect(FIRE_AND_FLY_NPC_DEF.pos).toEqual({ x: 405, z: 713 });
    expect(WORLD_QUESTS_BY_ID[FIRE_AND_FLY_QUEST_ID]).toBe(WORLD_QUEST_FIRE_AND_FLY);
    expect(WORLD_QUEST_FIRE_AND_FLY.objective).toEqual({
      type: 'turret',
      instructorNpcId: FIRE_AND_FLY_NPC_DEF.id,
    });
    expect(isReplayableWorldQuest(WORLD_QUEST_FIRE_AND_FLY)).toBe(true);
    const { sim } = atTheGate();
    const alder = sim.entities.get(FIRE_AND_FLY_NPC_ID);
    expect(alder?.kind).toBe('npc');
    expect(alder?.templateId).toBe(FIRE_AND_FLY_NPC_DEF.id);
    expect(sim.worldQuestLog.get(FIRE_AND_FLY_QUEST_ID)?.state).toBe('active');
  });
});

describe('the instructor seats a trial', () => {
  it('seats the default scenario on a plain talk, for today and for pay, and returns the player beside him', () => {
    const { sim, meta, player } = atTheGate();
    player.mountKey = '';
    const stood = { ...player.pos };
    sim.talkToNpc(FIRE_AND_FLY_NPC_ID);
    const seat = turretSeat(meta);
    expect(seat.defense.plan.scenarioId).toBe(TURRET_DEFAULT_SCENARIO.id);
    expect(seat.worldQuest).toEqual({
      questId: FIRE_AND_FLY_QUEST_ID,
      cycle: meta.worldQuestCycle,
      practice: false,
    });
    expect(seat.returnTo).toEqual({ ...stood, facing: 0.75 });
    sim.leaveVehicle();
    expect(player.pos).toEqual(stood);
    expect(
      Math.hypot(
        player.pos.x - FIRE_AND_FLY_NPC_DEF.pos.x,
        player.pos.z - FIRE_AND_FLY_NPC_DEF.pos.z,
      ),
    ).toBeLessThan(5);
  });

  it.each(TURRET_SCENARIOS.map((scenario) => [scenario.id] as const))(
    'seats %s on the dialog pick',
    (id) => {
      const { sim, meta } = atTheGate();
      sim.startWorldQuestActivity(FIRE_AND_FLY_QUEST_ID, { courseId: id });
      expect(turretSeat(meta).defense.plan.scenarioId).toBe(id);
      expect(turretSeat(meta).worldQuest?.practice).toBe(false);
    },
  );

  it('sweeps the area for a pick only once the player stands at the instructor', () => {
    const { sim, meta } = atTheGate();
    meta.worldQuestLog.delete(FIRE_AND_FLY_QUEST_ID);
    sim.player.pos = sim.groundPos(FIRE_AND_FLY_NPC_DEF.pos.x - 12, FIRE_AND_FLY_NPC_DEF.pos.z);
    sim.startWorldQuestActivity(FIRE_AND_FLY_QUEST_ID, { courseId: TURRET_DEFAULT_SCENARIO.id });
    expect(meta.worldQuestLog.has(FIRE_AND_FLY_QUEST_ID)).toBe(false);
    expect(meta.vehicle ?? null).toBeNull();
    standBesideAlder(sim);
    sim.startWorldQuestActivity(FIRE_AND_FLY_QUEST_ID, { courseId: TURRET_DEFAULT_SCENARIO.id });
    expect(turretSeat(meta).worldQuest?.practice).toBe(false);
  });

  it('ignores a pick for another quest or an unknown scenario', () => {
    const { sim, meta } = atTheGate();
    sim.startWorldQuestActivity('wq_galecrest_slalom', { courseId: TURRET_DEFAULT_SCENARIO.id });
    sim.startWorldQuestActivity(FIRE_AND_FLY_QUEST_ID, { courseId: 'fire_and_fly_nightmare' });
    sim.startWorldQuestActivity(FIRE_AND_FLY_QUEST_ID, 'hard');
    expect(meta.vehicle ?? null).toBeNull();
  });

  it('keeps /dev turret a seat with no world quest behind it', () => {
    const { sim, meta } = atTheGate();
    sim.chat('/dev turret');
    expect(turretSeat(meta).worldQuest).toBeUndefined();
  });
});

describe('the credit', () => {
  it(
    'pays a won run once, grants the deed once, and keeps practice runs reward-free',
    () => {
      const gate = atTheGate();
      const { sim, meta } = gate;
      const copper = sim.copper;
      const xp = sim.lifetimeXp;
      const completed = meta.counters.questsCompleted;
      const first = winIntroduction(gate);
      expect(meta.worldQuestLog.get(FIRE_AND_FLY_QUEST_ID)?.state).toBe('completed');
      expect(questDone(first)).toBe(1);
      expect(deedUnlocks(first)).toBe(1);
      expect(meta.deedsEarned.has(DEED)).toBe(true);
      expect(sim.copper).toBeGreaterThan(copper);
      expect(sim.lifetimeXp).toBeGreaterThan(xp);
      expect(meta.counters.questsCompleted).toBe(completed + 1);
      const paid = { copper: sim.copper, xp: sim.lifetimeXp, factions: { ...meta.factions } };

      // The same won session read again pays nothing.
      completeWorldQuestTurret(sim.ctx, meta, turretSeat(meta));
      sim.leaveVehicle();

      // Back beside Alder: the next trial is practice, and its win pays nothing.
      sim.talkToNpc(FIRE_AND_FLY_NPC_ID);
      expect(turretSeat(meta).worldQuest?.practice).toBe(true);
      sim.leaveVehicle();
      const second = winIntroduction(gate);
      expect(turretSeat(meta).worldQuest?.practice).toBe(true);
      expect(questDone(second)).toBe(0);
      expect(deedUnlocks(second)).toBe(0);
      expect(sim.copper).toBe(paid.copper);
      expect(sim.lifetimeXp).toBe(paid.xp);
      expect(meta.factions).toEqual(paid.factions);
      expect(meta.counters.questsCompleted).toBe(completed + 1);
      expect(meta.worldQuestLog.get(FIRE_AND_FLY_QUEST_ID)?.state).toBe('completed');
    },
    RUN_TIMEOUT_MS,
  );

  it(
    'pays nothing for a lost run, and the row stays open',
    () => {
      const { sim, meta } = atTheGate();
      const copper = sim.copper;
      sim.talkToNpc(FIRE_AND_FLY_NPC_ID);
      turretSeat(meta).defense.integrity = 1;
      const events = playOut(sim, false);
      expect(turretSeat(meta).defense.phase).toBe('lost');
      expect(questDone(events)).toBe(0);
      expect(sim.copper).toBe(copper);
      expect(meta.deedsEarned.has(DEED)).toBe(false);
      expect(meta.worldQuestLog.get(FIRE_AND_FLY_QUEST_ID)?.state).toBe('active');
    },
    RUN_TIMEOUT_MS,
  );

  it('pays nothing when the seat ends mid-run, as a dropped connection ends it', () => {
    const { sim, meta } = atTheGate();
    const copper = sim.copper;
    sim.talkToNpc(FIRE_AND_FLY_NPC_ID);
    for (let i = 0; i < 200; i++) sim.tick();
    sim.leaveVehicle();
    for (let i = 0; i < 3; i++) sim.tick();
    expect(meta.vehicle ?? null).toBeNull();
    expect(sim.copper).toBe(copper);
    expect(meta.worldQuestLog.get(FIRE_AND_FLY_QUEST_ID)?.state).toBe('active');
  });

  it(
    'pays a /dev turret win nothing',
    () => {
      const { sim, meta } = atTheGate();
      const copper = sim.copper;
      sim.chat('/dev turret introduction');
      const events = playOut(sim, true);
      expect(turretSeat(meta).defense.phase).toBe('won');
      expect(questDone(events)).toBe(0);
      expect(sim.copper).toBe(copper);
      expect(meta.worldQuestLog.get(FIRE_AND_FLY_QUEST_ID)?.state).toBe('active');
    },
    RUN_TIMEOUT_MS,
  );

  it("ends a run at the day's rollover with no credit, as the glider's flight ends, and offers the new day's row", () => {
    const { sim, meta, player } = atTheGate();
    const copper = sim.copper;
    const stood = { ...player.pos };
    sim.talkToNpc(FIRE_AND_FLY_NPC_ID);
    const seatedCycle = meta.worldQuestCycle;
    for (let i = 0; i < 40; i++) sim.tick();
    sim.resetDay = '2026-09-07';
    for (let i = 0; i < 3; i++) sim.tick();
    expect(meta.worldQuestCycle).not.toBe(seatedCycle);
    expect(meta.vehicle ?? null).toBeNull();
    expect(player.pos).toEqual(stood);
    expect(sim.copper).toBe(copper);
    expect(meta.worldQuestLog.get(FIRE_AND_FLY_QUEST_ID)?.state).toBe('active');
  });

  it('pays a run won by any path on its next tick, once', () => {
    const { sim, meta } = atTheGate();
    const copper = sim.copper;
    sim.talkToNpc(FIRE_AND_FLY_NPC_ID);
    turretSeat(meta).defense.phase = 'won';
    const first = sim.tick();
    expect(questDone(first)).toBe(1);
    expect(deedUnlocks(first)).toBe(1);
    expect(sim.copper).toBeGreaterThan(copper);
    const paid = sim.copper;
    const later = [...sim.tick(), ...sim.tick()];
    expect(questDone(later)).toBe(0);
    expect(sim.copper).toBe(paid);
  });

  it('pays nothing for a win on the tick the day rolls over, then ends the seat', () => {
    const { sim, meta } = atTheGate();
    const copper = sim.copper;
    sim.talkToNpc(FIRE_AND_FLY_NPC_ID);
    turretSeat(meta).defense.phase = 'won';
    sim.resetDay = '2026-09-07';
    const events = sim.tick();
    expect(questDone(events)).toBe(0);
    expect(deedUnlocks(events)).toBe(0);
    expect(sim.copper).toBe(copper);
    sim.tick();
    expect(meta.vehicle ?? null).toBeNull();
    expect(meta.worldQuestLog.get(FIRE_AND_FLY_QUEST_ID)?.state).toBe('active');
  });

  it('never pays a won session seated on another day, or one seated for practice', () => {
    const { sim, meta } = atTheGate();
    sim.talkToNpc(FIRE_AND_FLY_NPC_ID);
    const seat = turretSeat(meta);
    seat.defense.phase = 'won';
    const copper = sim.copper;
    for (const run of [
      { questId: FIRE_AND_FLY_QUEST_ID, cycle: 'wq1_5', practice: false },
      { questId: FIRE_AND_FLY_QUEST_ID, cycle: meta.worldQuestCycle, practice: true },
      { questId: 'wq_galecrest_slalom', cycle: meta.worldQuestCycle, practice: false },
    ]) {
      completeWorldQuestTurret(sim.ctx, meta, { ...seat, worldQuest: run });
    }
    expect(sim.copper).toBe(copper);
    expect(meta.worldQuestLog.get(FIRE_AND_FLY_QUEST_ID)?.state).toBe('active');
    completeWorldQuestTurret(sim.ctx, meta, seat);
    expect(meta.worldQuestLog.get(FIRE_AND_FLY_QUEST_ID)?.state).toBe('completed');
  });
});

describe('the refusals', () => {
  const standard = TURRET_DEFAULT_SCENARIO.id;

  function refusal(arrange: (gate: Gate) => void): { key: string | null; lines: string[] } {
    const gate = atTheGate();
    arrange(gate);
    gate.sim.drainEvents();
    const key = startFireAndFly(gate.sim.ctx, gate.meta, gate.player, standard);
    expect(gate.meta.vehicle ?? null).toBeNull();
    return { key, lines: errors(gate.sim.drainEvents()) };
  }

  it.each([
    [
      'dead',
      (g: Gate) => {
        g.player.dead = true;
      },
      "You can't do that while dead.",
    ],
    [
      'combat',
      (g: Gate) => {
        g.player.inCombat = true;
      },
      "You can't do that while in combat.",
    ],
    [
      'range',
      (g: Gate) => {
        g.player.pos = g.sim.groundPos(FIRE_AND_FLY_NPC_DEF.pos.x - 12, FIRE_AND_FLY_NPC_DEF.pos.z);
      },
      'Too far away.',
    ],
    [
      'level',
      (g: Gate) => g.sim.setPlayerLevel(WORLD_QUEST_FIRE_AND_FLY.minLevel - 1),
      "You are not yet ready for the gunner's trials.",
    ],
    [
      'full',
      (g: Gate) => {
        for (const inst of g.sim.ctx.instances) {
          if (inst.dungeonId === FIRE_AND_FLY_DUNGEON_ID) inst.partyKey = `taken:${inst.slot}`;
        }
      },
      'Every Fire and Fly tower is manned. Try again in a moment.',
    ],
  ] as const)('refuses %s with its line', (key, arrange, line) => {
    const out = refusal(arrange);
    expect(out.key).toBe(key);
    expect(out.lines).toEqual([line]);
  });

  it('localizes its own two lines through the sim matcher (the shared ones are the S3 guard)', async () => {
    const own = [
      "You are not yet ready for the gunner's trials.",
      'Every Fire and Fly tower is manned. Try again in a moment.',
    ];
    for (const line of own) expect(localizeSimText(line)).not.toBeNull();
    try {
      for (const lang of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
        await ensureLocaleLoaded(lang);
        setLanguage(lang);
        for (const line of own) {
          const shown = localizeSimText(line);
          expect(shown, `${lang}: ${line}`).toBeTruthy();
          expect(shown, `${lang}: ${line}`).not.toBe(line);
        }
      }
    } finally {
      setLanguage('en');
    }
  });

  it('refuses silently without a row to play or practice, or an unknown scenario', () => {
    expect(refusal((g) => g.meta.worldQuestLog.delete(FIRE_AND_FLY_QUEST_ID))).toEqual({
      key: 'offer',
      lines: [],
    });
    const gate = atTheGate();
    expect(startFireAndFly(gate.sim.ctx, gate.meta, gate.player, 'nope')).toBe('scenario');
  });
});

describe('online', () => {
  it('carries the trial pick as a { courseId } start and the row to the client mirror', () => {
    const { sim, meta } = atTheGate();
    const client = bareClient(sim.playerId);
    const send = vi.fn();
    Object.assign(client, { cmd: send });
    client.startWorldQuestActivity(FIRE_AND_FLY_QUEST_ID, {
      courseId: TURRET_SCENARIO_INTRODUCTION.id,
    });
    expect(send).toHaveBeenCalledExactlyOnceWith({
      cmd: 'world_quest_start',
      quest: FIRE_AND_FLY_QUEST_ID,
      difficulty: { courseId: TURRET_SCENARIO_INTRODUCTION.id },
    });
    dispatchWorldQuestWire(sim, JSON.parse(JSON.stringify(send.mock.calls[0][0])), sim.playerId);
    expect(turretSeat(meta).defense.plan.scenarioId).toBe(TURRET_SCENARIO_INTRODUCTION.id);

    const mirror: QuestSelfMirrors = {
      questLog: new Map(),
      questsDone: new Set(),
      worldQuestCycle: '',
      worldQuestExpiresAtMs: 0,
      worldQuestLog: new Map(),
      weeklyQuest: null,
      weeklyQuestResetAtMs: 0,
    };
    const wire = JSON.parse(
      JSON.stringify({
        wqday: meta.worldQuestCycle,
        wqlog: [...meta.worldQuestLog.values()].map(worldQuestProgressForWire),
      }),
    );
    applyQuestSelfWire(mirror, wire);
    expect(mirror.worldQuestLog.get(FIRE_AND_FLY_QUEST_ID)).toEqual(
      meta.worldQuestLog.get(FIRE_AND_FLY_QUEST_ID),
    );
  });
});

describe('the instructor dialog, tracker and map', () => {
  function world(state: 'active' | 'completed', level = 20) {
    return {
      worldQuestLog: new Map([
        [FIRE_AND_FLY_QUEST_ID, { questId: FIRE_AND_FLY_QUEST_ID, count: 0, state }],
      ]),
      player: { id: 1, level, dead: false, pos: { x: 0, y: 0, z: 0 } } as Entity,
    };
  }
  const alder = { id: 9, kind: 'npc', templateId: FIRE_AND_FLY_NPC_DEF.id } as Entity;

  it('offers every trial by name, with its brief and wave count', () => {
    const view = worldQuestInstructorDialog(world('active'), alder);
    expect(view?.speakerName).toBe('Master Gunner Alder');
    expect(view?.speakerTitle).toBe('Gunnery Recruiter');
    expect(view?.questTitle).toBe("The Gunner's Trials");
    expect(view?.canStart).toBe(true);
    expect(view?.difficulties?.map((c) => c.difficulty)).toEqual(
      TURRET_SCENARIOS.map((s) => ({ courseId: s.id })),
    );
    expect(view?.difficulties?.map((c) => c.key)).toEqual(['introduction', 'standard', 'hard']);
    expect(view?.difficulties?.map((c) => c.label)).toEqual([
      "Recruit's Trial: a first watch for a new recruit (waves: 3)",
      'Standing Watch: the real watch on the walls (waves: 6)',
      "Veterans' Test: the siege the old hands are tested on (waves: 6)",
    ]);
  });

  it('turns every trial into practice after the paid win, and offers nothing under the level', () => {
    const view = worldQuestInstructorDialog(world('completed'), alder);
    expect(view?.canStart).toBe(true);
    expect(view?.hint).toBe(
      'Practice: play again without earning more coins, experience or reputation.',
    );
    expect(view?.difficulties?.map((c) => c.label)).toEqual(
      fireAndFlyTrialChoices(true).map((c) => c.label),
    );
    expect(view?.difficulties?.[0]?.label).toBe("Practice the Recruit's Trial (waves: 3)");
    const young = worldQuestInstructorDialog(world('active', 19), alder);
    expect(young?.canStart).toBe(false);
    expect(young?.difficulties).toBeUndefined();
  });

  it('names the quest and its instruction line', () => {
    expect(worldQuestDisplayName(FIRE_AND_FLY_QUEST_ID)).toBe("The Gunner's Trials");
    expect(worldQuestObjectiveLabel(FIRE_AND_FLY_QUEST_ID)).toBe(
      'Hold a tower of your own through every wave of one trial',
    );
    expect(fireAndFlyInstructionLines({ state: 'active' })).toEqual([
      'Speak to Master Gunner Alder to take a trial.',
    ]);
    expect(fireAndFlyInstructionLines({ state: 'completed' })).toEqual([
      'Trial passed! Speak to Master Gunner Alder to practice.',
    ]);
  });

  it('pins the map marker on the instructor, as for the glider', () => {
    expect(worldQuestInstructorAnchor(WORLD_QUEST_FIRE_AND_FLY)).toEqual(FIRE_AND_FLY_NPC_DEF.pos);
    expect(worldQuestInstructorAnchor(WORLD_QUESTS_BY_ID.wq_galecrest_slalom)).toEqual(
      GLIDER_NPC_DEF.pos,
    );
    expect(worldQuestInstructorAnchor(WORLD_QUESTS_BY_ID.wq_evergarden_wolves)).toBeNull();
  });
});
