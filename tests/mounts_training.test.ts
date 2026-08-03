// Direct + facade tests for the riding lesson (src/sim/mounts_training.ts): the
// Mount/Dismount tutorial gating the first mount. Mounting the training steed no
// longer completes it; it advances the lesson to the 'ride' phase, and FINISHING
// A SHOW-JUMPING RACE while the lesson is live is what credits the quest. Drives
// the module through the Sim facade (mountTrainBegin / toggleMounted /
// mountTrainAbortFor / mountRaceStartFor), the same surface the server dispatch
// and the online client use. q_riding_lessons and stablemaster_marla are real
// content; this file drives them as-is.

import { describe, expect, it } from 'vitest';
import {
  MOUNT_RACE_COURSE,
  MOUNT_RACE_START_PLATFORM,
  STABLE_PADDOCK,
} from '../src/sim/content/mounts';
import { QUESTS } from '../src/sim/data';
import { MOUNT_RACE_COUNTDOWN_TICKS } from '../src/sim/mount_race';
import { MOUNT_TRAIN_FEE_COPPER } from '../src/sim/mounts_training';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const RIDING_LESSONS_QUEST_ID = 'q_riding_lessons';
const makeSim = (seed = 1) => new Sim({ seed, playerClass: 'warrior', autoEquip: true });

function marlaOf(sim: Sim) {
  const marla = [...sim.entities.values()].find(
    (e) => e.kind === 'npc' && e.templateId === 'stablemaster_marla',
  );
  expect(marla, 'stablemaster_marla must be a live NPC entity').toBeDefined();
  return marla!;
}

function teleport(sim: Sim, x: number, z: number): void {
  sim.player.pos.x = x;
  sim.player.pos.z = z;
  sim.player.pos.y = terrainHeight(x, z, sim.cfg.seed);
  sim.player.prevPos = { ...sim.player.pos };
}

function standAtMarla(sim: Sim): void {
  const marla = marlaOf(sim);
  teleport(sim, marla.pos.x, marla.pos.z);
}

function metaOf(sim: Sim) {
  return sim.players.get(sim.playerId)!;
}

/** Stand the player at the stablemaster, level 20, actively on the riding-lesson
 * quest, with ridingTrained set (the lesson now requires it: the skill is bought
 * before accepting the quest). Copper stays 0 unless funded. */
function setupAtMarla(sim: Sim, opts: { copper?: number } = {}): void {
  sim.setPlayerLevel(20);
  standAtMarla(sim);
  const meta = sim.players.get(sim.playerId)!;
  meta.ridingTrained = true;
  meta.questLog.set(RIDING_LESSONS_QUEST_ID, {
    questId: RIDING_LESSONS_QUEST_ID,
    counts: [0],
    state: 'active',
  });
  if (opts.copper !== undefined) meta.copper = opts.copper;
}

/** Begin a lesson: a session opens in the 'mount' phase (not yet on the steed). */
function beginLesson(sim: Sim): void {
  sim.mountTrainBegin();
  sim.tick();
}

/** Summon the training Valorsteed and run the channel to completion; the lesson
 * advances to the 'ride' phase (it no longer completes here). The lesson steed is
 * UNOWNED, so there is no reins item to click: this is the one path where the
 * Mount/Dismount keybind still summons. */
function mountSteed(sim: Sim): void {
  sim.toggleMounted();
  const meta = metaOf(sim);
  for (let i = 0; i < 100 && meta.mountTraining?.phase !== 'ride'; i++) sim.tick();
}

// --- compact race helpers (the show-jumping course credits the lesson) ---------
function rideThrough(
  sim: Sim,
  gate: { x: number; z: number; dir: number },
  jump: boolean,
): SimEvent[] {
  const e = sim.player;
  const meta = metaOf(sim);
  meta.moveInput.forward = false;
  meta.moveInput.jump = false;
  for (let i = 0; i < 40 && !e.onGround; i++) sim.tick();
  teleport(sim, gate.x - Math.sin(gate.dir) * 4, gate.z - Math.cos(gate.dir) * 4);
  e.facing = gate.dir;
  meta.moveInput.forward = true;
  meta.moveInput.jump = jump;
  const events: SimEvent[] = [];
  for (let i = 0; i < 60; i++) {
    events.push(...sim.tick());
    const along = (e.pos.x - gate.x) * Math.sin(gate.dir) + (e.pos.z - gate.z) * Math.cos(gate.dir);
    if (along > 3) break;
  }
  meta.moveInput.forward = false;
  meta.moveInput.jump = false;
  return events;
}

/** From the 'ride' phase, ride to the arch and complete a full race. Returns
 * every event from the finishing pass (the mountTrainEnd rides it). */
function completeRace(sim: Sim): SimEvent[] {
  teleport(sim, MOUNT_RACE_START_PLATFORM.x, MOUNT_RACE_START_PLATFORM.z);
  sim.mountRaceStartFor(sim.playerId);
  sim.tick();
  for (let i = 0; i < MOUNT_RACE_COUNTDOWN_TICKS + 2; i++) sim.tick();
  for (const jump of MOUNT_RACE_COURSE.jumps) rideThrough(sim, jump, true);
  return rideThrough(sim, MOUNT_RACE_COURSE.arch, false);
}

describe('riding lesson, begin gates', () => {
  it('MOUNT_TRAIN_FEE_COPPER equals 1_000_000 as historical documentation of the retired fee', () => {
    // The constant is kept only for backward compat / historical reference.
    // Nothing charges it anymore; its value is pinned so search-references stay
    // meaningful but the lesson is free on every attempt.
    expect(MOUNT_TRAIN_FEE_COPPER).toBe(1_000_000);
  });

  it('refuses an underlevel player (no session started)', () => {
    const sim = makeSim();
    setupAtMarla(sim);
    sim.setPlayerLevel(19);
    sim.mountTrainBegin();
    const events = sim.tick();
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(metaOf(sim).mountTraining ?? null).toBeNull();
  });

  it('refuses when too far from the stablemaster', () => {
    const sim = makeSim();
    setupAtMarla(sim);
    teleport(sim, marlaOf(sim).pos.x + 30, marlaOf(sim).pos.z);
    sim.mountTrainBegin();
    const events = sim.tick();
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(metaOf(sim).mountTraining ?? null).toBeNull();
  });

  it('refuses when not actively on q_riding_lessons', () => {
    const sim = makeSim();
    sim.setPlayerLevel(20);
    standAtMarla(sim);
    metaOf(sim).ridingTrained = true;
    sim.mountTrainBegin();
    const events = sim.tick();
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(metaOf(sim).mountTraining ?? null).toBeNull();
  });

  it('lesson is free: a player with 0 copper can still begin the lesson', () => {
    // No copper gate on the lesson. The only purchase is the 80g riding skill
    // from Marla (learnRiding), which happens before accepting the quest.
    const sim = makeSim();
    setupAtMarla(sim); // copper stays 0
    sim.mountTrainBegin();
    const events = sim.tick();
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(metaOf(sim).copper).toBe(0);
    expect(metaOf(sim).mountTraining?.state).toBe('IN_PROGRESS');
    // mountTrainingFeePaid is not set by the lesson; the legacy constant is
    // only meaningful as the grandfather source on save load.
    expect(metaOf(sim).mountTrainingFeePaid ?? false).toBe(false);
  });

  it('refuses to begin while already in a saddle (no self-completing lesson)', () => {
    const sim = makeSim();
    setupAtMarla(sim);
    sim.addItem('reins_valorsteed', 1, sim.playerId);
    sim.useItem('reins_valorsteed');
    for (let i = 0; i < 80 && sim.player.mountKey === ''; i++) sim.tick();
    expect(sim.player.mountKey).toBe('valorsteed');
    standAtMarla(sim);
    const copperBefore = metaOf(sim).copper;
    sim.mountTrainBegin();
    const events = sim.tick();
    expect(events.some((e) => e.type === 'error' && e.text === 'Dismount first.')).toBe(true);
    expect(metaOf(sim).mountTraining ?? null).toBeNull();
    // Lesson is free: copper is never touched even on a gate rejection.
    expect(metaOf(sim).copper).toBe(copperBefore);
  });

  it('refuses a second session while one is already in progress', () => {
    const sim = makeSim();
    setupAtMarla(sim);
    beginLesson(sim);
    expect(metaOf(sim).mountTraining?.state).toBe('IN_PROGRESS');
    const copperAfterFirst = metaOf(sim).copper;
    sim.mountTrainBegin();
    const events = sim.tick();
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(metaOf(sim).copper).toBe(copperAfterFirst);
  });
});

describe('riding lesson: mounting advances to ride; a finished race completes it', () => {
  it('begin emits a mount-phase session event and never deducts copper', () => {
    const sim = makeSim();
    setupAtMarla(sim, { copper: 12_345 });
    sim.mountTrainBegin();
    const events = sim.tick();
    const session = events.find((e) => e.type === 'mountTrainSession');
    expect(session).toBeDefined();
    expect(session && 'phase' in session && session.phase).toBe('mount');
    // Lesson is free: copper is unchanged.
    expect(metaOf(sim).copper).toBe(12_345);
    // mountTrainingFeePaid is not written by the lesson anymore.
    expect(metaOf(sim).mountTrainingFeePaid ?? false).toBe(false);
    expect(metaOf(sim).mountTraining?.state).toBe('IN_PROGRESS');
  });

  it('climbing onto the steed advances to the ride phase but does NOT complete the lesson', () => {
    const sim = makeSim();
    setupAtMarla(sim);
    beginLesson(sim);
    const before = { ...metaOf(sim) };
    mountSteed(sim);
    // Still mounted, still IN_PROGRESS, now in the ride phase; the objective is
    // NOT credited by mounting anymore.
    expect(sim.player.mountKey).toBe('valorsteed');
    expect(metaOf(sim).mountTraining?.state).toBe('IN_PROGRESS');
    expect(metaOf(sim).mountTraining?.phase).toBe('ride');
    void before;
    const qp = metaOf(sim).questLog.get(RIDING_LESSONS_QUEST_ID)!;
    expect(qp.counts[0]).toBe(0);
    expect(qp.state).toBe('active');
  });

  it('finishing a race during the lesson credits the objective once, force-dismounts, clears the session', () => {
    const sim = makeSim();
    setupAtMarla(sim);
    beginLesson(sim);
    mountSteed(sim);
    const events = completeRace(sim);
    expect(events.some((e) => e.type === 'mountRaceEnd' && e.outcome === 'finished')).toBe(true);
    expect(events.some((e) => e.type === 'mountTrainEnd' && e.outcome === 'success')).toBe(true);
    expect(events.find((e) => e.type === 'questProgress')).toMatchObject({
      questId: RIDING_LESSONS_QUEST_ID,
      objectiveIndex: 0,
      current: 1,
      required: 1,
      text: 'Tame the Valorsteed: 1/1',
    });
    // Marla takes the unowned steed back.
    expect(sim.player.mountKey).toBe('');
    expect(metaOf(sim).mountTraining ?? null).toBeNull();
    const qp = metaOf(sim).questLog.get(RIDING_LESSONS_QUEST_ID)!;
    expect(qp.counts[0]).toBe(1);
    expect(qp.state).toBe('ready');
    // The reward is granted by the turn-in, never here.
    expect(metaOf(sim).inventory.some((s) => s.itemId === 'reins_valorsteed')).toBe(false);
  }, 20000);

  it('turning the quest in at Marla after passing grants gold/XP (not reins; buy separately)', () => {
    const sim = makeSim();
    setupAtMarla(sim);
    beginLesson(sim);
    mountSteed(sim);
    completeRace(sim);
    standAtMarla(sim);
    const copperBefore = metaOf(sim).copper;
    sim.turnInQuest(RIDING_LESSONS_QUEST_ID);
    sim.tick();
    // The quest no longer awards reins_valorsteed; it awards 5000 copper + XP.
    expect(metaOf(sim).inventory.some((s) => s.itemId === 'reins_valorsteed')).toBe(false);
    expect(QUESTS[RIDING_LESSONS_QUEST_ID].itemRewards).toEqual({});
    expect(metaOf(sim).copper).toBeGreaterThan(copperBefore); // 5000 copper reward
  }, 20000);
});

describe('riding lesson, abandon paths', () => {
  it('the lesson is free on every attempt: copper never changes across begin and abandon', () => {
    // Old behavior: fee charged on first begin, free on retry. New behavior: always
    // free; copper is never touched by the lesson at all.
    const sim = makeSim();
    setupAtMarla(sim, { copper: 500 });
    beginLesson(sim);
    // Copper unchanged after begin.
    expect(metaOf(sim).copper).toBe(500);
    sim.mountTrainAbortFor(sim.playerId);
    sim.tick();
    expect(metaOf(sim).mountTraining ?? null).toBeNull();
    // Copper still unchanged after abandon.
    expect(metaOf(sim).copper).toBe(500);
    // A second attempt also succeeds and costs nothing.
    sim.mountTrainBegin();
    const events = sim.tick();
    expect(events.some((e) => e.type === 'mountTrainSession')).toBe(true);
    expect(metaOf(sim).mountTraining?.state).toBe('IN_PROGRESS');
    expect(metaOf(sim).copper).toBe(500);
  });

  it('lesson state persists across a relog correctly: ridingTrained true, no session, lesson free on retry', () => {
    // Old behavior: persisted mountTrainingFeePaid so the retry was free. New
    // behavior: the fee is gone; ridingTrained is what persists. Relog retains
    // ridingTrained and allows a fresh free lesson on reconnect.
    const sim = makeSim();
    setupAtMarla(sim, { copper: 777 });
    beginLesson(sim);
    expect(metaOf(sim).copper).toBe(777); // unchanged
    sim.mountTrainAbortFor(sim.playerId);
    sim.tick();

    const state = sim.serializeCharacter(sim.playerId);
    expect(state).not.toBeNull();
    // ridingTrained persists; mountTrainingFeePaid is no longer written by the lesson.
    expect(state?.ridingTrained).toBe(true);

    const restored = new Sim({
      seed: sim.cfg.seed,
      playerClass: 'warrior',
      autoEquip: true,
      noPlayer: true,
    });
    const restoredPid = restored.addPlayer('warrior', 'Rider', { state: state! });
    restored.tick();
    const restoredMeta = restored.players.get(restoredPid)!;
    expect(restoredMeta.ridingTrained).toBe(true);
    expect(restoredMeta.mountTraining ?? null).toBeNull();
    const copperBeforeRetry = restoredMeta.copper;

    // Re-add the quest (was not persisted by this test's state snapshot).
    restoredMeta.questLog.set(RIDING_LESSONS_QUEST_ID, {
      questId: RIDING_LESSONS_QUEST_ID,
      counts: [0],
      state: 'active',
    });
    // Stand at Marla in the restored sim.
    const marla = [...restored.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === 'stablemaster_marla',
    )!;
    const re = restored.entities.get(restoredPid)!;
    re.pos.x = marla.pos.x;
    re.pos.z = marla.pos.z;
    re.level = 20;

    restored.mountTrainBeginFor(restoredPid);
    const events = restored.tick();

    expect(events.some((e) => e.type === 'mountTrainSession')).toBe(true);
    expect(restoredMeta.mountTraining?.state).toBe('IN_PROGRESS');
    // Still free: copper unchanged after retry.
    expect(restoredMeta.copper).toBe(copperBeforeRetry);
  });

  it('straying beyond the paddock abandons the lesson', () => {
    const sim = makeSim();
    setupAtMarla(sim);
    beginLesson(sim);
    // Well outside the (enlarged) paddock rectangle.
    teleport(sim, STABLE_PADDOCK.x2 + 30, STABLE_PADDOCK.z1 - 30);
    const events = sim.tick();
    expect(events.some((e) => e.type === 'mountTrainEnd' && e.outcome === 'abandoned')).toBe(true);
    expect(
      events.some(
        (e) =>
          e.type === 'log' &&
          e.text === 'You leave the paddock and the lesson ends. Come back to Marla to try again.',
      ),
    ).toBe(true);
    expect(metaOf(sim).mountTraining ?? null).toBeNull();
  });

  it('dismounting during the ride phase abandons the lesson', () => {
    const sim = makeSim();
    setupAtMarla(sim);
    beginLesson(sim);
    mountSteed(sim);
    expect(metaOf(sim).mountTraining?.phase).toBe('ride');
    sim.toggleMounted(); // step off the steed
    const events: SimEvent[] = [];
    for (let i = 0; i < 40 && !events.some((e) => e.type === 'mountTrainEnd'); i++)
      events.push(...sim.tick());
    expect(events.some((e) => e.type === 'mountTrainEnd' && e.outcome === 'abandoned')).toBe(true);
    expect(metaOf(sim).mountTraining ?? null).toBeNull();
  });

  it('a mid-summon abandon clears the pending training summon (no steed applied later)', () => {
    const sim = makeSim();
    setupAtMarla(sim);
    beginLesson(sim);
    sim.toggleMounted();
    sim.tick();
    expect(sim.player.mountCastKey).toBe('valorsteed');
    sim.mountTrainAbortFor(sim.playerId);
    sim.tick();
    for (let i = 0; i < 60; i++) sim.tick();
    expect(sim.player.mountKey).toBe('');
    expect(metaOf(sim).mountTraining ?? null).toBeNull();
  });

  it('death ends the session', () => {
    const sim = makeSim();
    setupAtMarla(sim);
    beginLesson(sim);
    sim.player.hp = 0;
    sim.player.dead = true;
    const events = sim.tick();
    expect(events.some((e) => e.type === 'mountTrainEnd' && e.outcome === 'abandoned')).toBe(true);
    expect(metaOf(sim).mountTraining ?? null).toBeNull();
  });

  it('leaving mid-session abandons it (removePlayer teardown)', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true, noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Rider');
    const meta = sim.players.get(pid)!;
    const e = sim.entities.get(pid)!;
    const marla = marlaOf(sim);
    e.level = 20;
    e.pos.x = marla.pos.x;
    e.pos.z = marla.pos.z;
    e.prevPos = { ...e.pos };
    meta.ridingTrained = true;
    meta.questLog.set(RIDING_LESSONS_QUEST_ID, {
      questId: RIDING_LESSONS_QUEST_ID,
      counts: [0],
      state: 'active',
    });
    sim.mountTrainBeginFor(pid);
    sim.tick();
    expect(meta.mountTraining?.state).toBe('IN_PROGRESS');
    sim.removePlayer(pid);
    expect(meta.mountTraining ?? null).toBeNull();
  });
});

describe('riding lesson, the training summon gate', () => {
  it('the Mount/Dismount toggle refuses to summon anything without a lesson (nothing owned)', () => {
    const sim = makeSim();
    sim.setPlayerLevel(20);
    sim.toggleMounted();
    const events = sim.tick();
    expect(events.some((e) => e.type === 'error')).toBe(true);
    for (let i = 0; i < 60; i++) sim.tick();
    expect(sim.player.mountKey).toBe('');
  });
});

describe('riding_training and the phase 21 count axis', () => {
  it('a hostile count on the riding-service row denies BEFORE the delegation, charging nothing', () => {
    // Sanitize sits above the teachesRiding delegate (Q20: hostile counts
    // deny on EVERY row): without this order a crafted {count: 0} frame
    // would silently complete the full 800000c purchase, laundering hostile
    // input into a charge no legitimate client sent.
    const sim = makeSim();
    sim.setPlayerLevel(20);
    const meta = metaOf(sim);
    meta.copper = 810_000;
    standAtMarla(sim);
    const marla = marlaOf(sim);
    for (const hostile of [0, Number.NaN]) {
      sim.buyItem(marla.id, 'riding_training', { count: hostile }, sim.playerId);
      const events = sim.tick();
      expect(
        events.some((e) => e.type === 'error' && e.text === 'That item is not for sale.'),
        `count ${hostile}`,
      ).toBe(true);
      expect(meta.ridingTrained ?? false, `count ${hostile}`).toBe(false);
      expect(meta.copper, `count ${hostile}`).toBe(810_000);
    }
  });

  it('a VALID count above 1 on the riding-service row still trains exactly once (force-1 by delegation)', () => {
    const sim = makeSim();
    sim.setPlayerLevel(20);
    const meta = metaOf(sim);
    meta.copper = 810_000;
    standAtMarla(sim);
    sim.buyItem(marlaOf(sim).id, 'riding_training', { count: 5 }, sim.playerId);
    sim.tick();
    expect(meta.ridingTrained).toBe(true);
    // One purchase, one 800000c debit: never five.
    expect(meta.copper).toBe(10_000);
  });
});

describe('new-player path: buy riding at Marla, then complete the lesson', () => {
  it('full E2E: untrained -> buy riding_training -> quest -> lesson -> buy reins', () => {
    const sim = makeSim();
    sim.setPlayerLevel(20);
    // Exactly 810_000 copper: 800_000 for riding + 10_000 left over.
    const meta = metaOf(sim);
    meta.copper = 810_000;
    const marla = marlaOf(sim);

    // (a) Trying to accept the riding-lesson quest before buying riding fails
    //     even standing at Marla: the requiresRidingTrained gate refuses with
    //     the dedicated error and the quest never enters the log.
    standAtMarla(sim);
    sim.acceptQuest(RIDING_LESSONS_QUEST_ID, sim.playerId);
    const rejectEvents = sim.tick();
    expect(
      rejectEvents.some(
        (e) => e.type === 'error' && e.text === 'You must learn Riding before taking this lesson.',
      ),
    ).toBe(true);
    expect(meta.questLog.has(RIDING_LESSONS_QUEST_ID)).toBe(false);

    // (b) buyItem riding_training deducts exactly 800_000
    //     and grants ridingTrained; leaves exactly 10_000 copper.
    standAtMarla(sim);
    sim.buyItem(marla.id, 'riding_training', undefined, sim.playerId);
    sim.tick();
    expect(meta.ridingTrained).toBe(true);
    expect(meta.copper).toBe(10_000);

    // (c) Buying riding_training again is refused (already trained); no copper change.
    sim.buyItem(marla.id, 'riding_training', undefined, sim.playerId);
    const alreadyEvents = sim.tick();
    expect(alreadyEvents.some((e) => e.type === 'error')).toBe(true);
    expect(meta.copper).toBe(10_000);

    // (d) Accept q_riding_lessons now succeeds (ridingTrained, level 20, at Marla).
    sim.acceptQuest(RIDING_LESSONS_QUEST_ID, sim.playerId);
    sim.tick();
    expect(meta.questLog.get(RIDING_LESSONS_QUEST_ID)?.state).toBe('active');

    // (e) Begin the lesson: session opens, NO copper change (lesson is always free).
    sim.mountTrainBegin();
    const lessonEvents = sim.tick();
    expect(lessonEvents.some((e) => e.type === 'mountTrainSession' && e.phase === 'mount')).toBe(
      true,
    );
    expect(meta.copper).toBe(10_000); // unchanged

    // (f) reins_valorsteed costs 100_000 but we only have 10_000: need +90_000.
    meta.copper += 90_000; // now 100_000
    sim.buyItem(marla.id, 'reins_valorsteed', undefined, sim.playerId);
    sim.tick();
    expect(meta.copper).toBe(0);
    expect(meta.inventory.some((s) => s.itemId === 'reins_valorsteed')).toBe(true);

    // Reins are usable items now: USING the reward reins summons the horse, with
    // no select step and no keybind. Abort the lesson first so the training-steed
    // branch cannot be what mounts us.
    sim.mountTrainAbortFor(sim.playerId);
    sim.tick();
    sim.useItem('reins_valorsteed');
    for (let i = 0; i < 80 && sim.player.mountKey === ''; i++) sim.tick();
    expect(sim.player.mountKey).toBe('valorsteed');
  }, 20000);
});
