import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, DUNGEONS, instanceOrigin } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// Gravebreaker is a CHARGED AUTO-ATTACK, not a scripted cast: the 12s cadence
// charges the boss, the next LANDED melee swing releases it. The swing target
// takes only the normal swing (never a separate Gravebreaker hit), everyone
// else in the 11yd frontal arc takes the splash off the same swing roll at
// 1.5x, and avoidance (dodge/parry/miss) holds the charge for the next swing.
// The old design (a free-standing weapon-sized cast whose FIRST fire came at
// 1.5s on the pull, stacking with the opening swing) one-shot the best-geared
// tank on heroic before any heal could land.

// Every assertion runs inside the Nythraxis instance band: the boss, adds,
// and raid members are all spawned by enterRaid/enterDungeon from the global
// registries, never from the overworld camp/npc/groundObject placements
// (same reasoning as the NYTHRAXIS_TEST_WORLD fixture in
// nythraxis_raid_unit.test.ts, kept local here per the perf-batch no-shared-file rule).
const NYTHRAXIS_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

type TickEvent = ReturnType<Sim['tick']>[number];
type TimedEvent = { at: number; event: TickEvent };
type DamageEvent = Extract<TickEvent, { type: 'damage' }>;

function isDamage(event: TickEvent): event is DamageEvent {
  return event.type === 'damage';
}

function makeWorld(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true, world: NYTHRAXIS_TEST_WORLD });
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function formRaid(sim: Sim, leaderPid: number) {
  while ((sim.partyOf(leaderPid)?.members.length ?? 1) < 5) {
    const pid = sim.addPlayer('priest', `RaidFill${sim.players.size}`);
    sim.partyInvite(pid, leaderPid);
    sim.partyAccept(pid);
  }
  sim.convertPartyToRaid(leaderPid);
}

function enterRaid(sim: Sim, pid: number) {
  sim.players.get(pid)!.questsDone.add('q_nythraxis_bound_guardian');
  formRaid(sim, pid);
  sim.enterDungeon('nythraxis_boss_arena', pid);
  const p = sim.entities.get(pid)!;
  return instanceOrigin(DUNGEONS.nythraxis_boss_arena.index, sim.instanceSlotAt(p.pos)!);
}

function bossOf(sim: Sim): Entity {
  const found = [...sim.entities.values()].find(
    (e) => e.kind === 'mob' && e.templateId === 'nythraxis_scourge_of_thornpeak' && !e.dead,
  );
  expect(found).toBeTruthy();
  return found!;
}

function engage(boss: Entity, tank: Entity) {
  boss.inCombat = true;
  boss.aiState = 'attack';
  boss.aggroTargetId = tank.id;
  boss.threat.set(tank.id, 1000);
}

function collect(sim: Sim, seconds: number, watch?: (at: number) => void): TimedEvent[] {
  const rows: TimedEvent[] = [];
  for (let i = 0; i < seconds * 20; i++) {
    const at = (sim as unknown as { time: number }).time;
    for (const event of sim.tick()) rows.push({ at, event });
    watch?.(at);
  }
  return rows;
}

function gravebreakerHits(rows: TimedEvent[], bossId: number): TimedEvent[] {
  return rows.filter(
    (row) =>
      isDamage(row.event) &&
      row.event.sourceId === bossId &&
      row.event.ability === 'Gravebreaker' &&
      row.event.kind === 'hit',
  );
}

// Every tick on which a boss melee swing LANDED: the only ticks a charge can
// release on.
function landedSwingTimes(rows: TimedEvent[], bossId: number): number[] {
  return rows
    .filter(
      (row) =>
        isDamage(row.event) &&
        row.event.sourceId === bossId &&
        row.event.ability === null &&
        row.event.kind === 'hit',
    )
    .map((row) => row.at);
}

// Hand-initialized state that isolates Gravebreaker: intro done, every other
// mechanic parked far in the future.
function isolatedState(gravebreakerTimer: number): NonNullable<Entity['nythraxis']> {
  return {
    phase: 1,
    introSpoken: true,
    transitionStarted: false,
    transitionTimer: 0,
    transitionCues: [],
    transitionReleased: false,
    dialogueBusyUntil: 0,
    dialogueToken: 0,
    gravebreakerTimer,
    gravebreakerCasts: 0,
    gravebreakerCharged: false,
    raiseFallenTimer: 999,
    soulRendTimer: 999,
    soulRendMarks: [],
    soulRendLockout: 0,
    deathlessTimer: 999,
    deathlessCastRemaining: 0,
    deathlessStunRemaining: 0,
    wardChannels: [],
    finalStand: false,
    deathSpoken: false,
  };
}

describe('Nythraxis Gravebreaker as a charged auto-attack', () => {
  it('has no opener: nothing labeled Gravebreaker lands in the first 11.5s of a natural pull', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    tank.maxHp = 1e7;
    tank.hp = tank.maxHp;
    const boss = bossOf(sim);
    boss.moveSpeed = 0;
    teleport(sim, tankPid, boss.pos.x, boss.pos.z + 2);
    engage(boss, tank);

    const rows = collect(sim, 11.5);
    // The boss IS meleeing (the pull is live)...
    const swings = rows.filter(
      (row) => isDamage(row.event) && row.event.sourceId === boss.id && row.event.ability === null,
    );
    expect(swings.length).toBeGreaterThan(0);
    // ...but the old 1.5s Gravebreaker opener is gone: the first charge only
    // completes at 12s and must still wait for a swing to release it.
    expect(gravebreakerHits(rows, boss.id)).toHaveLength(0);
  });

  it('releases on a landed swing: splash on the front bystander only, same tick, 1.5x, charge consumed', () => {
    // No seed hunt: nothing below rides the tank's hit-table luck. The release
    // schedule is asserted against the ARM beat plus the swings this run
    // actually landed, so any seed satisfies it (verified over seeds 1 to 16
    // and 42 on both v0.34.0 merge parents and on the merge). This supersedes
    // the hunted seed this branch carried: a seed-independent assertion needs no
    // re-hunt when a content merge shifts the shared rng stream, which is
    // exactly what kept re-breaking it.
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    const bystanderPid = sim.addPlayer('warrior', 'Bystander');
    const bystander = sim.entities.get(bystanderPid)!;
    const behindPid = sim.addPlayer('warrior', 'Behind');
    const behind = sim.entities.get(behindPid)!;
    for (const p of [tank, bystander, behind]) {
      p.maxHp = 1e7;
      p.hp = p.maxHp;
    }
    const boss = bossOf(sim);
    boss.moveSpeed = 0;
    boss.nythraxis = isolatedState(3);
    // Boss holds still; tank in melee in front, bystander beside the tank
    // (inside the 11yd 60 degree arc), third player directly behind the boss.
    teleport(sim, tankPid, boss.pos.x, boss.pos.z + 2);
    teleport(sim, bystanderPid, boss.pos.x + 2, boss.pos.z + 4);
    teleport(sim, behindPid, boss.pos.x, boss.pos.z - 4);
    boss.facing = Math.atan2(tank.pos.x - boss.pos.x, tank.pos.z - boss.pos.z);
    boss.prevFacing = boss.facing;
    engage(boss, tank);

    // The 12s cadence only ARMS the charge; the release is a separate,
    // swing-quantized event. Record every arm (the tick the cadence timer
    // rewinds) so each release can be checked against its OWN charge instead of
    // against the previous release. Watching the timer rather than the charged
    // flag catches an arm even on a tick that also releases it.
    const armTimes: number[] = [];
    let prevTimer = Number.POSITIVE_INFINITY;
    const rows = collect(sim, 45, (at) => {
      const timer = boss.nythraxis!.gravebreakerTimer;
      if (timer > prevTimer) armTimes.push(at);
      prevTimer = timer;
    });
    const splashes = gravebreakerHits(rows, boss.id);
    expect(splashes.length).toBeGreaterThanOrEqual(2);

    // The splash only ever hits the bystander: never the swing target, never
    // the player behind the boss.
    for (const row of splashes) {
      expect((row.event as DamageEvent).targetId).toBe(bystander.id);
    }

    // Each release rides a landed melee swing: the same tick carries the
    // boss's plain (null-ability) hit on the tank, and the splash is 1.5x the
    // swing after the shared armor step (both targets are naked warriors), or
    // 0.75x when the carrying swing crit (mob crits double the primary hit
    // only; the splash never crits).
    for (const row of splashes) {
      const splash = row.event as DamageEvent;
      const carrier = rows.find(
        (r) =>
          r.at === row.at &&
          isDamage(r.event) &&
          r.event.sourceId === boss.id &&
          r.event.targetId === tank.id &&
          r.event.ability === null &&
          r.event.kind === 'hit',
      );
      expect(carrier, `no carrying swing at t=${row.at}`).toBeTruthy();
      const swing = carrier!.event as DamageEvent;
      expect(splash.crit).toBe(false);
      expect(splash.amount / swing.amount).toBeCloseTo(swing.crit ? 0.75 : 1.5, 1);
    }

    // Consumed on release, and quantized FORWARD ONLY. The cadence lives on the
    // ARM beat: a full 12s apart, every time.
    //
    // Wall-clock gaps BETWEEN RELEASES are deliberately not asserted, because
    // they are not the cadence. The timer keeps its own 12s beat while a charge
    // waits for a swing, so every avoided swing that delays release N shortens
    // the N to N+1 gap by one 2.65s swing interval. Measured over a 45s window
    // (arms at 3/15/27/39): release gaps 10.6/13.25/10.6 with nothing avoided,
    // 7.95 after one dodge inside a charged window, 5.3 after two. That spread
    // is not new and is not this branch's: sweeping seeds 1 to 16, the old >=9s
    // floor already failed on the pre-merge head (seeds 10, 11, 16), on the
    // release parent (seed 6) and on the merge (seeds 1, 11). It only ever
    // pinned the tank's dodge luck rather than the mechanic, and passed because
    // the hunted seed happened to avoid nothing while charged. The release
    // schedule is pinned exactly instead, against the arm beat.
    const fireTimes = [...new Set(splashes.map((row) => row.at))];
    expect(armTimes.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < armTimes.length; i++) {
      expect(armTimes[i] - armTimes[i - 1], 'arm cadence').toBeCloseTo(12, 5);
    }
    // One arm, one release, on the FIRST swing that lands at or after it: never
    // early (no free-standing cast), never two releases off one charge, never a
    // landed swing skipped while charged, and never an extra release the cadence
    // did not pay for. Independent of which swings the hit table avoided.
    const landed = landedSwingTimes(rows, boss.id);
    const expectedFires = armTimes
      .map((arm) => landed.find((at) => at >= arm))
      .filter((at): at is number => at !== undefined);
    expect(fireTimes).toEqual(expectedFires);
    // fireTimes dedups by tick, so the row count is what actually rules out two
    // releases off one charge: exactly one bystander is eligible, so one splash
    // ROW per release, not merely one tick per release.
    expect(splashes).toHaveLength(expectedFires.length);
    expect(origin).toBeTruthy();
  });

  it('avoidance holds the charge: a dodging tank delays the release to the next landed swing', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    const bystanderPid = sim.addPlayer('warrior', 'Bystander');
    const bystander = sim.entities.get(bystanderPid)!;
    for (const p of [tank, bystander]) {
      p.maxHp = 1e7;
      p.hp = p.maxHp;
    }
    const boss = bossOf(sim);
    boss.moveSpeed = 0;
    boss.nythraxis = isolatedState(2);
    teleport(sim, tankPid, boss.pos.x, boss.pos.z + 2);
    teleport(sim, bystanderPid, boss.pos.x + 2, boss.pos.z + 4);
    boss.facing = Math.atan2(tank.pos.x - boss.pos.x, tank.pos.z - boss.pos.z);
    boss.prevFacing = boss.facing;
    engage(boss, tank);

    // Charge completes at 2s, but the tank dodges everything: swings are
    // attempted and avoided, and the charge must hold.
    tank.dodgeChance = 1;
    const dodgeWindow = collect(sim, 8);
    const attempted = dodgeWindow.filter(
      (row) => isDamage(row.event) && row.event.sourceId === boss.id && row.event.kind === 'dodge',
    );
    expect(attempted.length).toBeGreaterThan(0);
    expect(gravebreakerHits(dodgeWindow, boss.id)).toHaveLength(0);

    // The moment swings land again, the held charge releases.
    tank.dodgeChance = 0;
    const landedWindow = collect(sim, 8);
    expect(gravebreakerHits(landedWindow, boss.id).length).toBeGreaterThanOrEqual(1);
  });
});
