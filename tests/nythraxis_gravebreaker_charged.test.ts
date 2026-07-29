import { describe, expect, it } from 'vitest';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// Gravebreaker is a CHARGED AUTO-ATTACK, not a scripted cast: the 12s cadence
// charges the boss, the next LANDED melee swing releases it. The swing target
// takes only the normal swing (never a separate Gravebreaker hit), everyone
// else in the 11yd frontal arc takes the splash off the same swing roll at
// 1.5x, and avoidance (dodge/parry/miss) holds the charge for the next swing.
// The old design (a free-standing weapon-sized cast whose FIRST fire came at
// 1.5s on the pull, stacking with the opening swing) one-shot the best-geared
// tank on heroic before any heal could land.

type TickEvent = ReturnType<Sim['tick']>[number];
type TimedEvent = { at: number; event: TickEvent };
type DamageEvent = Extract<TickEvent, { type: 'damage' }>;

function isDamage(event: TickEvent): event is DamageEvent {
  return event.type === 'damage';
}

function makeWorld(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true });
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

function collect(sim: Sim, seconds: number): TimedEvent[] {
  const rows: TimedEvent[] = [];
  for (let i = 0; i < seconds * 20; i++) {
    const at = (sim as unknown as { time: number }).time;
    for (const event of sim.tick()) rows.push({ at, event });
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
    // Seed hunted (post-merge camp order) so no avoided swing delays a
    // release inside the 45s window: a held charge compresses the next
    // release gap below the >=9s cadence floor. Spares: 3, 5.
    const sim = makeWorld(1);
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

    const rows = collect(sim, 45);
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

    // Consumed on release: consecutive releases are a full cadence apart
    // (12s timer, quantized to the next landed swing), never back to back.
    const fireTimes = [...new Set(splashes.map((row) => row.at))];
    for (let i = 1; i < fireTimes.length; i++) {
      expect(fireTimes[i] - fireTimes[i - 1]).toBeGreaterThanOrEqual(9);
    }
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
