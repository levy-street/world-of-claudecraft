// Fire and Fly's recruitment and missions through the instructor
// (src/sim/fire_and_fly_recruitment.ts, src/sim/world_quest_fire_and_fly.ts): the
// trials open in order, the last one recruits for good and opens the missions, a
// locked pick is refused with its line, a dev seat bypasses the locks and never
// counts, the state rides the world quest save and the owner's self wire, the day's
// one reward goes to the first win of any trial or mission, and a mission's score
// feeds its lifetime board and the Gunner's Mastery.
import { describe, expect, it } from 'vitest';
import { QuestWorldWireState } from '../src/net/quest_world_wire_state';
import { TURRET_MISSIONS } from '../src/sim/content/fire_and_fly_missions';
import {
  FIRE_AND_FLY_SCENARIOS,
  TURRET_SCENARIO_HARD,
  TURRET_SCENARIO_INTRODUCTION,
  TURRET_SCENARIO_STANDARD,
  TURRET_SCENARIOS,
} from '../src/sim/content/fire_and_fly_scenarios';
import {
  FIRE_AND_FLY_NPC_DEF,
  FIRE_AND_FLY_NPC_ID,
  FIRE_AND_FLY_QUEST_ID,
  WORLD_QUEST_FIRE_AND_FLY,
} from '../src/sim/content/world_quest_fire_and_fly';
import { fireAndFlyMastery } from '../src/sim/fire_and_fly_personal_records';
import {
  type FireAndFlyRecruitment,
  fireAndFlyNextTrialId,
  fireAndFlyScenarioUnlocked,
  freshFireAndFlyRecruitment,
  recordFireAndFlyRecruitmentWin,
  sanitizeFireAndFlyRecruitment,
  savedFireAndFlyRecruitment,
} from '../src/sim/fire_and_fly_recruitment';
import {
  FIRE_AND_FLY_MASTERY_BOARD_ID,
  FIRE_AND_FLY_SCOREBOARD_MISSIONS,
} from '../src/sim/fire_and_fly_scoreboards';
import { turretResult } from '../src/sim/minigames/turret_result';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { SimEvent, TurretSession } from '../src/sim/types';
import { restoreWorldQuestState, savedWorldQuestState } from '../src/sim/world_quest_state';
import { WORLD_SEED } from '../src/sim/world_seed';
import { localizeSimText } from '../src/ui/sim_i18n';
import type { IWorldQuests } from '../src/world_api/quests';

const DAY = '2026-09-06';
const LOCKED = 'Master Gunner Alder has not cleared you for that yet.';
const [INTRO, STANDARD, HARD] = TURRET_SCENARIOS.map((s) => s.id);
const PACK = TURRET_MISSIONS[0].id;
const GIANTS = TURRET_MISSIONS[1].id;

function atTheGate(): { sim: Sim; meta: PlayerMeta } {
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands: true });
  sim.resetDay = DAY;
  sim.setPlayerLevel(WORLD_QUEST_FIRE_AND_FLY.minLevel);
  sim.player.pos = sim.groundPos(FIRE_AND_FLY_NPC_DEF.pos.x - 2, FIRE_AND_FLY_NPC_DEF.pos.z);
  sim.player.prevPos = { ...sim.player.pos };
  sim.tick();
  sim.drainEvents();
  return { sim, meta: sim.meta(sim.playerId)! };
}

function seated(meta: PlayerMeta): TurretSession | null {
  return meta.vehicle?.kind === 'turret' ? meta.vehicle : null;
}

/** Ends the seated run as won with the given tower share kept, then ticks it home. */
function winSeat(sim: Sim, meta: PlayerMeta, share = 1, kills = 20): SimEvent[] {
  const defense = seated(meta)!.defense;
  const integrity = Math.round(defense.plan.integrity * share);
  defense.integrity = integrity;
  defense.phase = 'won';
  defense.result = turretResult(defense.plan, {
    phase: 'won',
    integrity,
    stats: { kills, barrelKills: 0, bowled: 0 },
  });
  const events = [...sim.tick(), ...sim.tick()];
  sim.leaveVehicle();
  return events;
}

function pick(sim: Sim, scenarioId: string): SimEvent[] {
  sim.startWorldQuestActivity(FIRE_AND_FLY_QUEST_ID, { courseId: scenarioId });
  return sim.drainEvents();
}

const errors = (events: readonly SimEvent[]) =>
  events.flatMap((e) => (e.type === 'error' ? [e.text] : []));

describe('the recruitment rules', () => {
  it('opens the trials one by one and the missions only once recruited', () => {
    const state = freshFireAndFlyRecruitment();
    const open = () =>
      [...TURRET_SCENARIOS, ...TURRET_MISSIONS].filter((s) =>
        fireAndFlyScenarioUnlocked(state, s.id),
      ).length;
    expect(open()).toBe(1);
    expect(fireAndFlyNextTrialId(state)).toBe(INTRO);
    expect(recordFireAndFlyRecruitmentWin(state, INTRO)).toBe(true);
    expect(open()).toBe(2);
    expect(fireAndFlyNextTrialId(state)).toBe(STANDARD);
    // An earlier trial again, or a mission, moves nothing.
    expect(recordFireAndFlyRecruitmentWin(state, INTRO)).toBe(false);
    expect(recordFireAndFlyRecruitmentWin(state, PACK)).toBe(false);
    expect(recordFireAndFlyRecruitmentWin(state, STANDARD)).toBe(true);
    expect(fireAndFlyScenarioUnlocked(state, HARD)).toBe(true);
    expect(fireAndFlyScenarioUnlocked(state, PACK)).toBe(false);
    expect(recordFireAndFlyRecruitmentWin(state, HARD)).toBe(true);
    expect(state).toEqual({ trialsWon: 3, recruited: true });
    expect(open()).toBe(TURRET_SCENARIOS.length + TURRET_MISSIONS.length);
    expect(fireAndFlyNextTrialId(state)).toBeNull();
    expect(fireAndFlyScenarioUnlocked(state, 'fire_and_fly_nightmare')).toBe(false);
  });

  it('keeps the recruitment for good, whatever the trial count says', () => {
    const state: FireAndFlyRecruitment = { trialsWon: 0, recruited: true };
    for (const s of [...TURRET_SCENARIOS, ...TURRET_MISSIONS])
      expect(fireAndFlyScenarioUnlocked(state, s.id), s.id).toBe(true);
  });

  it('sanitizes a saved or wired record, a malformed one unlocking nothing', () => {
    expect(sanitizeFireAndFlyRecruitment(undefined)).toEqual(freshFireAndFlyRecruitment());
    expect(sanitizeFireAndFlyRecruitment({ trialsWon: 1 })).toEqual({
      trialsWon: 1,
      recruited: false,
    });
    for (const trialsWon of [-1, 1.5, 4, '2', Number.NaN])
      expect(sanitizeFireAndFlyRecruitment({ trialsWon }).trialsWon).toBe(0);
    expect(sanitizeFireAndFlyRecruitment({ trialsWon: 0, recruited: 'yes' }).recruited).toBe(false);
    expect(sanitizeFireAndFlyRecruitment({ trialsWon: 3 })).toEqual({
      trialsWon: 3,
      recruited: true,
    });
    expect(savedFireAndFlyRecruitment(freshFireAndFlyRecruitment())).toBeUndefined();
    expect(savedFireAndFlyRecruitment({ trialsWon: 2, recruited: false })).toEqual({
      trialsWon: 2,
      recruited: false,
    });
  });
});

describe('the instructor enforces the recruitment', () => {
  it('refuses a locked trial or mission with its line, seating nothing', () => {
    const { sim, meta } = atTheGate();
    for (const id of [STANDARD, HARD, PACK]) {
      expect(errors(pick(sim, id))).toEqual([LOCKED]);
      expect(seated(meta)).toBeNull();
    }
    expect(localizeSimText(LOCKED)).toBe(LOCKED);
  });

  it('seats the next trial on the plain talk, and walks the whole recruitment', () => {
    const { sim, meta } = atTheGate();
    const world: IWorldQuests = sim;
    const rev = meta.wireRev;
    for (const [i, scenario] of TURRET_SCENARIOS.entries()) {
      sim.talkToNpc(FIRE_AND_FLY_NPC_ID);
      expect(seated(meta)?.defense.plan.scenarioId).toBe(scenario.id);
      winSeat(sim, meta);
      expect(world.fireAndFlyRecruitment.trialsWon).toBe(i + 1);
    }
    expect(world.fireAndFlyRecruitment).toEqual({ trialsWon: 3, recruited: true });
    expect(meta.wireRev).toBeGreaterThan(rev);
    // Recruited: the plain talk seats the default trial, and every mission opens.
    sim.talkToNpc(FIRE_AND_FLY_NPC_ID);
    expect(seated(meta)?.defense.plan.scenarioId).toBe(TURRET_SCENARIO_STANDARD.id);
    sim.leaveVehicle();
    for (const mission of TURRET_MISSIONS) {
      expect(errors(pick(sim, mission.id))).toEqual([]);
      expect(seated(meta)?.defense.plan.scenarioId).toBe(mission.id);
      sim.leaveVehicle();
    }
  });

  it('counts a practice win too, and never a loss', () => {
    const { sim, meta } = atTheGate();
    pick(sim, INTRO);
    const defense = seated(meta)!.defense;
    defense.phase = 'lost';
    defense.integrity = 0;
    defense.result = turretResult(defense.plan, {
      phase: 'lost',
      integrity: 0,
      stats: { kills: 1, barrelKills: 0, bowled: 0 },
    });
    sim.tick();
    sim.leaveVehicle();
    expect(meta.fireAndFlyRecruitment.trialsWon).toBe(0);
    pick(sim, INTRO);
    winSeat(sim, meta);
    expect(meta.worldQuestLog.get(FIRE_AND_FLY_QUEST_ID)?.state).toBe('completed');
    pick(sim, STANDARD);
    expect(seated(meta)?.worldQuest?.practice).toBe(true);
    winSeat(sim, meta);
    expect(meta.fireAndFlyRecruitment.trialsWon).toBe(2);
  });

  it('lets a dev seat bypass the locks, and never counts it', () => {
    const { sim, meta } = atTheGate();
    for (const key of ['hard', 'pack', 'powder']) {
      sim.chat(`/dev turret ${key}`);
      expect(seated(meta)?.worldQuest).toBeUndefined();
      winSeat(sim, meta);
    }
    expect(meta.fireAndFlyRecruitment).toEqual(freshFireAndFlyRecruitment());
    expect(meta.fireAndFlyRecords).toEqual({});
  });
});

describe('the recruitment is kept', () => {
  it('rides the world quest save and restores; an old save unlocks nothing', () => {
    const { sim, meta } = atTheGate();
    expect(savedWorldQuestState(meta).worldQuests?.fireAndFlyRecruitment).toBeUndefined();
    pick(sim, INTRO);
    winSeat(sim, meta);
    const saved = savedWorldQuestState(meta).worldQuests;
    expect(saved?.fireAndFlyRecruitment).toEqual({ trialsWon: 1, recruited: false });
    const restored = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
    const target = restored.meta(restored.playerId)!;
    restoreWorldQuestState(target, JSON.parse(JSON.stringify(saved)));
    expect(target.fireAndFlyRecruitment).toEqual({ trialsWon: 1, recruited: false });
    const { fireAndFlyRecruitment: _dropped, ...old } = saved!;
    restoreWorldQuestState(target, JSON.parse(JSON.stringify(old)));
    expect(target.fireAndFlyRecruitment).toEqual(freshFireAndFlyRecruitment());
  });

  it("mirrors the owner's recruitment from the ffr self key, a malformed one locking", () => {
    const client = new QuestWorldWireState();
    expect(client.fireAndFlyRecruitment).toEqual(freshFireAndFlyRecruitment());
    client.applyQuestSelfSnapshot({ ffr: { trialsWon: 3, recruited: true } });
    expect(client.fireAndFlyRecruitment).toEqual({ trialsWon: 3, recruited: true });
    expect(Object.isFrozen(client.fireAndFlyRecruitment)).toBe(true);
    // An omitted key keeps the mirror.
    client.applyQuestSelfSnapshot({});
    expect(client.fireAndFlyRecruitment.recruited).toBe(true);
    client.applyQuestSelfSnapshot({ ffr: { trialsWon: 99 } });
    expect(client.fireAndFlyRecruitment).toEqual(freshFireAndFlyRecruitment());
    client.applyQuestSelfSnapshot({ ffr: { trialsWon: 2 } });
    client.resetQuestWorldWireState();
    expect(client.fireAndFlyRecruitment).toEqual(freshFireAndFlyRecruitment());
  });
});

describe('the day reward and the mission scores', () => {
  function recruited() {
    const gate = atTheGate();
    gate.meta.fireAndFlyRecruitment = { trialsWon: 3, recruited: true };
    return gate;
  }
  const done = (events: readonly SimEvent[]) =>
    events.filter((e) => e.type === 'worldQuestDone' && e.questId === FIRE_AND_FLY_QUEST_ID).length;

  it('pays the first win of the day of a mission, then a trial is practice', () => {
    const { sim, meta } = recruited();
    pick(sim, PACK);
    expect(seated(meta)?.worldQuest?.practice).toBe(false);
    expect(done(winSeat(sim, meta))).toBe(1);
    pick(sim, TURRET_SCENARIO_HARD.id);
    expect(seated(meta)?.worldQuest?.practice).toBe(true);
    expect(done(winSeat(sim, meta))).toBe(0);
  });

  it('pays the first win of the day of a trial, then a mission is practice', () => {
    const { sim, meta } = recruited();
    pick(sim, TURRET_SCENARIO_INTRODUCTION.id);
    expect(done(winSeat(sim, meta))).toBe(1);
    pick(sim, GIANTS);
    expect(seated(meta)?.worldQuest?.practice).toBe(true);
    expect(done(winSeat(sim, meta))).toBe(0);
  });

  it("scores a mission on its lifetime board only and sums the character's Gunner's Mastery", () => {
    const { sim, meta } = recruited();
    pick(sim, PACK);
    const first = winSeat(sim, meta, 0.97);
    const scored = first.filter((e) => e.type === 'worldQuestScore');
    expect(scored).toEqual([
      expect.objectContaining({ board: 'fire_and_fly_pack_v1_lifetime', medal: 'gold' }),
    ]);
    expect(Object.keys(meta.fireAndFlyRecords)).toEqual(['fire_and_fly_pack_v1_lifetime']);
    const packPoints = meta.fireAndFlyRecords.fire_and_fly_pack_v1_lifetime.metric;
    expect(first.filter((e) => e.type === 'worldQuestMastery')).toEqual([
      {
        type: 'worldQuestMastery',
        pid: meta.entityId,
        board: FIRE_AND_FLY_MASTERY_BOARD_ID,
        stars: 3,
        points: packPoints,
        missions: 1,
      },
    ]);
    // A worse run of the same mission changes no best and no Mastery.
    pick(sim, PACK);
    const worse = winSeat(sim, meta, 0.7);
    expect(worse.filter((e) => e.type === 'worldQuestScore')).toHaveLength(1);
    expect(worse.filter((e) => e.type === 'worldQuestMastery')).toEqual([]);
    // A second mission adds to the sum; a trial never touches it.
    pick(sim, GIANTS);
    const second = winSeat(sim, meta, 0.6);
    const giants = meta.fireAndFlyRecords.fire_and_fly_giants_v1_lifetime;
    expect(giants.medal).toBe('silver');
    expect(second.filter((e) => e.type === 'worldQuestMastery')).toEqual([
      expect.objectContaining({ stars: 5, points: packPoints + giants.metric, missions: 2 }),
    ]);
    pick(sim, STANDARD);
    expect(winSeat(sim, meta).filter((e) => e.type === 'worldQuestMastery')).toEqual([]);
    expect(fireAndFlyMastery(meta.fireAndFlyRecords)).toEqual({
      stars: 5,
      points: packPoints + giants.metric,
      missions: 2,
    });
  });

  it('pins the Mastery board id to the missions and their versions it was cut for', () => {
    // A failure here means a mission was retuned, added or removed: raise
    // FIRE_AND_FLY_MASTERY_VERSION, then move both pins together.
    expect(FIRE_AND_FLY_MASTERY_BOARD_ID).toBe('fire_and_fly_mastery_v1_lifetime');
    expect(FIRE_AND_FLY_SCOREBOARD_MISSIONS.map((m) => `${m.key}_v${m.version}`)).toEqual([
      'pack_v1',
      'giants_v1',
      'deluge_v1',
      'brittle_v1',
      'powder_v1',
    ]);
    expect(FIRE_AND_FLY_SCOREBOARD_MISSIONS.map((m) => m.key)).toEqual(
      TURRET_MISSIONS.map((m) => m.boardKey),
    );
    expect(FIRE_AND_FLY_SCENARIOS.map((s) => s.boardKey)).not.toContain('mastery');
  });
});
