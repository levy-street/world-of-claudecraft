// Profession Schools (rank-gated crafting institutions, first implementation:
// the Enchanters School): membership/join gate, sworn allegiance, the
// schoolRankIndexFor cap math, the submitSchoolTask deny ladder and happy
// path, the SimEvent it emits on every outcome, and the persistence round
// trip. See src/sim/professions/schools.ts and
// src/sim/content/profession_schools.ts.
import { describe, expect, it } from 'vitest';
import {
  ENCHANTERS_SCHOOL_ID,
  ENCHANTERS_SCHOOL_RANKS,
  SCHOOL_TASKS,
  schoolById,
  schoolTaskById,
} from '../src/sim/content/profession_schools';
import { STATIONS } from '../src/sim/content/professions';
import {
  loadProfessionSchoolState,
  professionSchoolSaveFragment,
  professionSchoolsView,
  schoolRankIndexFor,
} from '../src/sim/professions/schools';
import { stationsOfType } from '../src/sim/professions/stations';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

const STATION_POS = stationsOfType(STATIONS, 'toolworks')[0].pos;
// Far outside every station circle (the professions_training.test.ts idiom).
const FIELD_POS = { x: 0, z: 150 };

const DAILY_TASK_ID = 'school_task_enchanters_daily_dust';
const WEEKLY_TASK_ID = 'school_task_enchanters_weekly_group';

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function metaOf(sim: Sim, pid: number) {
  return (sim as any).players.get(pid);
}

function placeAt(sim: Sim, pid: number, pos: { x: number; z: number }) {
  const entity = (sim as any).entities.get(pid);
  entity.pos.x = pos.x;
  entity.pos.z = pos.z;
  entity.prevPos = { ...entity.pos };
}

function placeAtSchool(sim: Sim, pid: number) {
  placeAt(sim, pid, STATION_POS);
}

function join(sim: Sim, pid: number) {
  placeAtSchool(sim, pid);
  metaOf(sim, pid).craftSkills.enchanting = 25;
  sim.joinProfessionSchool(ENCHANTERS_SCHOOL_ID, pid);
}

function schoolTaskResultsOf(
  events: SimEvent[],
): Extract<SimEvent, { type: 'schoolTaskResult' }>[] {
  return events.filter((ev) => ev.type === 'schoolTaskResult') as Extract<
    SimEvent,
    { type: 'schoolTaskResult' }
  >[];
}

describe('content/profession_schools.ts catalog', () => {
  it('ships the Enchanters School with a live station and referential integrity', () => {
    const school = schoolById(ENCHANTERS_SCHOOL_ID)!;
    expect(school).toBeTruthy();
    expect(school.professionId).toBe('enchanting');
    expect(stationsOfType(STATIONS, school.stationType).length).toBeGreaterThan(0);
    for (const taskId of school.taskIds) {
      expect(schoolTaskById(taskId), taskId).toBeTruthy();
    }
    for (const task of SCHOOL_TASKS) {
      expect(task.schoolId).toBe(ENCHANTERS_SCHOOL_ID);
      expect(task.requiredCount).toBeGreaterThan(0);
      expect(task.points).toBeGreaterThan(0);
      expect(task.cooldownSeconds).toBeGreaterThan(0);
    }
  });

  it('ranks are ascending by pointsRequired and only the top ranks are swornOnly', () => {
    const points = ENCHANTERS_SCHOOL_RANKS.map((r) => r.pointsRequired);
    expect(points).toEqual([...points].sort((a, b) => a - b));
    expect(ENCHANTERS_SCHOOL_RANKS[0].swornOnly).toBeUndefined();
    expect(ENCHANTERS_SCHOOL_RANKS.some((r) => r.swornOnly)).toBe(true);
  });
});

describe('schoolRankIndexFor: the unsworn cap', () => {
  const school = schoolById(ENCHANTERS_SCHOOL_ID)!;
  const topSwornOnlyIndex = school.ranks.findIndex((r) => r.swornOnly);
  const topUnsworn = topSwornOnlyIndex - 1;

  it('an unsworn member caps at the highest non-swornOnly rank however many points they hold', () => {
    const hugePoints = school.ranks[school.ranks.length - 1].pointsRequired + 10_000;
    expect(schoolRankIndexFor(school, hugePoints, false)).toBe(topUnsworn);
  });

  it('a sworn member reaches the true top rank at the same point total', () => {
    const hugePoints = school.ranks[school.ranks.length - 1].pointsRequired + 10_000;
    expect(schoolRankIndexFor(school, hugePoints, true)).toBe(school.ranks.length - 1);
  });

  it('resolves the exact rank at each threshold, sworn or not', () => {
    for (let i = 0; i <= topUnsworn; i++) {
      expect(schoolRankIndexFor(school, school.ranks[i].pointsRequired, false)).toBe(i);
    }
  });

  it('zero points is always Initiate (index 0)', () => {
    expect(schoolRankIndexFor(school, 0, false)).toBe(0);
    expect(schoolRankIndexFor(school, 0, true)).toBe(0);
  });
});

describe('joinProfessionSchool', () => {
  it('joins as a member (0 points) once proficiency and proximity are both met', () => {
    const sim = makeSim();
    const pid = sim.primaryId;
    join(sim, pid);
    const view = sim.professionSchools;
    expect(view.memberships).toHaveLength(1);
    expect(view.memberships[0]).toMatchObject({
      schoolId: ENCHANTERS_SCHOOL_ID,
      points: 0,
      rankId: 'initiate',
      sworn: false,
    });
  });

  it('refuses below the flat craft-skill threshold (silent no-op)', () => {
    const sim = makeSim();
    const pid = sim.primaryId;
    placeAtSchool(sim, pid);
    metaOf(sim, pid).craftSkills.enchanting = 24;
    sim.joinProfessionSchool(ENCHANTERS_SCHOOL_ID, pid);
    expect(sim.professionSchools.memberships).toHaveLength(0);
  });

  it('refuses out of range of the schoolmaster station (silent no-op)', () => {
    const sim = makeSim();
    const pid = sim.primaryId;
    placeAt(sim, pid, FIELD_POS);
    metaOf(sim, pid).craftSkills.enchanting = 999;
    sim.joinProfessionSchool(ENCHANTERS_SCHOOL_ID, pid);
    expect(sim.professionSchools.memberships).toHaveLength(0);
  });

  it('re-joining an already-held school is a no-op that never resets points', () => {
    const sim = makeSim();
    const pid = sim.primaryId;
    join(sim, pid);
    metaOf(sim, pid).professionSchool.memberships[ENCHANTERS_SCHOOL_ID] = 400;
    sim.joinProfessionSchool(ENCHANTERS_SCHOOL_ID, pid);
    expect(sim.professionSchools.memberships[0].points).toBe(400);
  });
});

describe('swearSchoolAllegiance', () => {
  it('requires standing membership (silent no-op otherwise)', () => {
    const sim = makeSim();
    const pid = sim.primaryId;
    placeAtSchool(sim, pid);
    sim.swearSchoolAllegiance(ENCHANTERS_SCHOOL_ID, pid);
    expect(sim.professionSchools.memberships).toHaveLength(0);
  });

  it('once joined and in range, marks the member sworn and unlocks swornOnly ranks', () => {
    const sim = makeSim();
    const pid = sim.primaryId;
    join(sim, pid);
    const meta = metaOf(sim, pid);
    meta.professionSchool.memberships[ENCHANTERS_SCHOOL_ID] = 10_000;
    sim.swearSchoolAllegiance(ENCHANTERS_SCHOOL_ID, pid);
    const view = sim.professionSchools.memberships[0];
    expect(view.sworn).toBe(true);
    expect(view.rankId).toBe(ENCHANTERS_SCHOOL_RANKS[ENCHANTERS_SCHOOL_RANKS.length - 1].id);
  });

  it('refuses out of range even for an existing member (silent no-op)', () => {
    const sim = makeSim();
    const pid = sim.primaryId;
    join(sim, pid);
    placeAt(sim, pid, FIELD_POS);
    sim.swearSchoolAllegiance(ENCHANTERS_SCHOOL_ID, pid);
    expect(sim.professionSchools.memberships[0].sworn).toBe(false);
  });
});

describe('submitSchoolTask', () => {
  it('denies not_a_member with the event carrying the school id', () => {
    const sim = makeSim();
    const pid = sim.primaryId;
    placeAtSchool(sim, pid);
    sim.submitSchoolTask(DAILY_TASK_ID, pid);
    const results = schoolTaskResultsOf(sim.drainEvents());
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      ok: false,
      schoolId: ENCHANTERS_SCHOOL_ID,
      taskId: DAILY_TASK_ID,
      reason: 'not_a_member',
    });
  });

  it('denies unknown_task for a malformed id, schoolId empty', () => {
    const sim = makeSim();
    const pid = sim.primaryId;
    join(sim, pid);
    sim.submitSchoolTask('nonexistent_task_id', pid);
    const results = schoolTaskResultsOf(sim.drainEvents());
    expect(results[0]).toMatchObject({ ok: false, schoolId: '', reason: 'unknown_task' });
  });

  it('denies out_of_range when the member has walked away from the station', () => {
    const sim = makeSim();
    const pid = sim.primaryId;
    join(sim, pid);
    placeAt(sim, pid, FIELD_POS);
    sim.submitSchoolTask(DAILY_TASK_ID, pid);
    const results = schoolTaskResultsOf(sim.drainEvents());
    expect(results[0]).toMatchObject({ ok: false, reason: 'out_of_range' });
  });

  it('denies insufficient_materials with nothing consumed', () => {
    const sim = makeSim();
    const pid = sim.primaryId;
    join(sim, pid);
    sim.submitSchoolTask(DAILY_TASK_ID, pid);
    const results = schoolTaskResultsOf(sim.drainEvents());
    expect(results[0]).toMatchObject({ ok: false, reason: 'insufficient_materials' });
    expect(sim.professionSchools.memberships[0].points).toBe(0);
  });

  it('denies party_required on the weekly_group task while solo', () => {
    const sim = makeSim();
    const pid = sim.primaryId;
    join(sim, pid);
    const task = schoolTaskById(WEEKLY_TASK_ID)!;
    sim.addItem(task.requiredItemId, task.requiredCount, pid);
    sim.submitSchoolTask(WEEKLY_TASK_ID, pid);
    const results = schoolTaskResultsOf(sim.drainEvents());
    expect(results[0]).toMatchObject({ ok: false, reason: 'party_required' });
  });

  it('succeeds: consumes the exact materials, awards points, and starts the cooldown', () => {
    const sim = makeSim();
    const pid = sim.primaryId;
    join(sim, pid);
    const task = schoolTaskById(DAILY_TASK_ID)!;
    sim.addItem(task.requiredItemId, task.requiredCount + 3, pid);
    sim.submitSchoolTask(DAILY_TASK_ID, pid);
    const results = schoolTaskResultsOf(sim.drainEvents());
    expect(results[0]).toMatchObject({
      ok: true,
      schoolId: ENCHANTERS_SCHOOL_ID,
      taskId: DAILY_TASK_ID,
      pointsAwarded: task.points,
    });
    expect(sim.professionSchools.memberships[0].points).toBe(task.points);
    expect(sim.countItem(task.requiredItemId, pid)).toBe(3);
    const taskView = sim.professionSchools.tasks.find((t) => t.taskId === DAILY_TASK_ID)!;
    expect(taskView.readySeconds).toBeGreaterThan(0);
  });

  it('denies on_cooldown on an immediate re-submit, spending materials only once', () => {
    const sim = makeSim();
    const pid = sim.primaryId;
    join(sim, pid);
    const task = schoolTaskById(DAILY_TASK_ID)!;
    sim.addItem(task.requiredItemId, task.requiredCount * 2, pid);
    sim.submitSchoolTask(DAILY_TASK_ID, pid);
    sim.drainEvents();
    sim.submitSchoolTask(DAILY_TASK_ID, pid);
    const results = schoolTaskResultsOf(sim.drainEvents());
    expect(results[0]).toMatchObject({ ok: false, reason: 'on_cooldown' });
    expect(sim.countItem(task.requiredItemId, pid)).toBe(task.requiredCount);
  });

  it('succeeds on the weekly_group task once partied at the required size', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const leaderPid = sim.addPlayer('warrior', 'Leader');
    const memberPid = sim.addPlayer('mage', 'Member');
    join(sim, leaderPid);
    sim.partyInvite(memberPid, leaderPid);
    sim.partyAccept(memberPid);
    const task = schoolTaskById(WEEKLY_TASK_ID)!;
    sim.addItem(task.requiredItemId, task.requiredCount, leaderPid);
    sim.submitSchoolTask(WEEKLY_TASK_ID, leaderPid);
    const results = schoolTaskResultsOf(sim.drainEvents());
    expect(results[0]).toMatchObject({
      ok: true,
      taskId: WEEKLY_TASK_ID,
      pointsAwarded: task.points,
    });
  });
});

describe('persistence round trip', () => {
  it('save/load preserves membership, sworn school, and re-anchors the cooldown', () => {
    const sim = makeSim();
    const pid = sim.primaryId;
    join(sim, pid);
    const meta = metaOf(sim, pid);
    meta.professionSchool.memberships[ENCHANTERS_SCHOOL_ID] = 250;
    sim.swearSchoolAllegiance(ENCHANTERS_SCHOOL_ID, pid);
    meta.professionSchool.taskReadyAt[DAILY_TASK_ID] = sim.time + 42;

    const saved = professionSchoolSaveFragment(meta.professionSchool, sim.time);
    expect(saved.professionSchool?.memberships).toEqual({ [ENCHANTERS_SCHOOL_ID]: 250 });
    expect(saved.professionSchool?.swornSchoolId).toBe(ENCHANTERS_SCHOOL_ID);
    expect(saved.professionSchool?.schoolTaskCooldowns?.[DAILY_TASK_ID]).toBeCloseTo(42, 1);

    // Reload on a DIFFERENT clock (a fresh Sim's time starts back at 0, the
    // node_persist.ts scheme): the frozen 42-second remaining re-anchors onto
    // the new clock unchanged, never the stale absolute tick from the old sim.
    const reloaded = loadProfessionSchoolState(saved.professionSchool, 1000);
    expect(reloaded.memberships).toEqual({ [ENCHANTERS_SCHOOL_ID]: 250 });
    expect(reloaded.swornSchoolId).toBe(ENCHANTERS_SCHOOL_ID);
    expect(reloaded.taskReadyAt[DAILY_TASK_ID] - 1000).toBeCloseTo(42, 1);
  });

  it('drops a membership/allegiance the live catalog no longer resolves', () => {
    const reloaded = loadProfessionSchoolState(
      { memberships: { retired_school: 999 }, swornSchoolId: 'retired_school' },
      0,
    );
    expect(reloaded.memberships).toEqual({});
    expect(reloaded.swornSchoolId).toBeNull();
  });

  it('omits the fragment entirely for a character who never joined a school', () => {
    expect(professionSchoolSaveFragment(undefined, 0)).toEqual({});
  });
});

describe('professionSchoolsView: nextRankPoints', () => {
  it('names the next reachable rank, and null exactly at the unsworn/true cap', () => {
    const school = schoolById(ENCHANTERS_SCHOOL_ID)!;
    const view0 = professionSchoolsView({ [school.id]: 0 }, null, {}, 0);
    expect(view0.memberships[0].nextRankPoints).toBe(school.ranks[1].pointsRequired);

    const topSwornOnlyIndex = school.ranks.findIndex((r) => r.swornOnly);
    const capPoints = school.ranks[topSwornOnlyIndex - 1].pointsRequired;
    const viewCapped = professionSchoolsView({ [school.id]: capPoints }, null, {}, 0);
    expect(viewCapped.memberships[0].nextRankPoints).toBeNull();

    const viewSwornCapped = professionSchoolsView(
      { [school.id]: school.ranks[school.ranks.length - 1].pointsRequired },
      school.id,
      {},
      0,
    );
    expect(viewSwornCapped.memberships[0].nextRankPoints).toBeNull();
  });
});
