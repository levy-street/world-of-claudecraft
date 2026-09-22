// The night (src/sim/mob/slumber.ts + src/sim/day_night.ts): a world boss who sleeps.
//
// What is worth pinning is the contract a screenshot cannot show. Night has to come from
// the HOST clock and nowhere else (a clockless world must never have a night, or every
// test and the RL env would inherit a sleeping boss), a fight running at dusk has to be
// fought to its end, a sleeper has to be genuinely unattackable rather than merely
// posed, and the scheduler has to bring a slain sleeper back at the next DAWN rather than
// on the hourly interval. Godmode stays banned here like the sibling suites.
import { beforeEach, describe, expect, it } from 'vitest';
import { wireEntity } from '../server/game';
import { BUILTIN_WORLD, MOBS, zoneAt } from '../src/sim/data';
import {
  crossedDawn,
  cyclePhase,
  DAWN_PHASE,
  DAY_NIGHT_CYCLE_MS,
  DUSK_PHASE,
  isDaylightPhase,
  phaseToCycleMs,
} from '../src/sim/day_night';
import { respawnMob } from '../src/sim/mob/lifecycle';
import { SLUMBER_AURA_ID, tickSlumber } from '../src/sim/mob/slumber';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { DT, dist2d, type Entity, type SimEvent, type WorldContent } from '../src/sim/types';
import { WORLD_BOSSES } from '../src/sim/world_boss';

const BALGATH = 'balgath_cyclops';

// Him, a player and the terrain: the continent's other mobs are noise here.
const SLUMBER_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

/** A host clock the test turns by hand: phase in [0,1), 0.5 noon, 0 midnight. */
function clockAt(phase: number): { now: () => number; set: (phase: number) => void } {
  let ms = phaseToCycleMs(phase);
  return { now: () => ms, set: (p) => (ms = phaseToCycleMs(p)) };
}

function lair(): { x: number; z: number } {
  const row = WORLD_BOSSES.find((b) => b.templateId === BALGATH);
  if (!row) throw new Error('balgath_cyclops is not in WORLD_BOSSES');
  return row.pos;
}

describe('the day/night leaf', () => {
  it('is the renderer clock, moved: forty-five minutes, epoch-anchored', () => {
    expect(DAY_NIGHT_CYCLE_MS).toBe(45 * 60 * 1000);
    expect(cyclePhase(0)).toBe(0);
    expect(cyclePhase(DAY_NIGHT_CYCLE_MS / 2)).toBeCloseTo(0.5, 9);
    expect(cyclePhase(-1)).toBeGreaterThan(0.99);
  });

  it('calls the sun up from sunrise to sunset, inclusive at dawn and exclusive at dusk', () => {
    expect(DAWN_PHASE).toBe(0.25);
    expect(DUSK_PHASE).toBe(0.75);
    expect(isDaylightPhase(DAWN_PHASE)).toBe(true);
    expect(isDaylightPhase(0.5)).toBe(true);
    expect(isDaylightPhase(DUSK_PHASE - 1e-6)).toBe(true);
    expect(isDaylightPhase(DUSK_PHASE)).toBe(false);
    expect(isDaylightPhase(0)).toBe(false);
    expect(isDaylightPhase(1.5)).toBe(true); // wraps
  });

  it('round-trips a phase through a synthesized clock', () => {
    for (const p of [0, 0.1, 0.25, 0.5, 0.75, 0.999]) {
      expect(cyclePhase(phaseToCycleMs(p))).toBeCloseTo(p, 5);
    }
  });

  it('spots the sunrise edge exactly once, wrap included', () => {
    expect(crossedDawn(0.2, 0.3)).toBe(true);
    expect(crossedDawn(0.24, 0.25)).toBe(true); // lands ON dawn
    expect(crossedDawn(0.25, 0.26)).toBe(false); // already past it
    expect(crossedDawn(0.3, 0.4)).toBe(false);
    expect(crossedDawn(0.9, 0.3)).toBe(true); // through midnight
    expect(crossedDawn(0.9, 0.1)).toBe(false); // through midnight, not yet dawn
    expect(crossedDawn(0.2, 0.2)).toBe(false);
  });
});

describe('the opt-in', () => {
  it('is declared by the world boss and by nobody else', () => {
    expect(MOBS[BALGATH]?.slumber).toBeDefined();
    const others = Object.entries(MOBS).filter(([id, m]) => id !== BALGATH && m.slumber);
    expect(others.map(([id]) => id)).toEqual([]);
  });

  it('gives him a bed he can find and a voice the zone hears', () => {
    const def = MOBS[BALGATH]?.slumber;
    if (!def) throw new Error('no slumber');
    expect(def.bedRadius).toBeGreaterThan(1);
    expect(def.wakeYell.length).toBeGreaterThan(0);
    expect(def.yellRange ?? 0).toBeGreaterThanOrEqual(100);
  });
});

describe('a clockless world has no night', () => {
  it('never puts him to bed and reports no phase', () => {
    const sim = new Sim({
      seed: 7,
      playerClass: 'warrior',
      autoEquip: true,
      world: SLUMBER_TEST_WORLD,
    });
    expect(sim.dayNightPhase()).toBeNull();
    const spawn = lair();
    const id = (
      sim as unknown as { spawnDevBoss(t: string, x: number, z: number): number }
    ).spawnDevBoss(BALGATH, spawn.x, spawn.z);
    const boss = sim.entities.get(id) as Entity;
    sim.player.pos.x = spawn.x + 200;
    sim.player.pos.z = spawn.z;
    sim.player.prevPos = { ...sim.player.pos };
    for (let i = 0; i < 40; i++) sim.tick();
    expect(boss.asleep).toBe(false);
    expect(boss.hostile).toBe(true);
    expect(boss.auras.some((a) => a.id === SLUMBER_AURA_ID)).toBe(false);
  });
});

describe('the night in a live world', () => {
  let sim: Sim;
  let boss: Entity;
  let ctx: SimContext;
  let clock: ReturnType<typeof clockAt>;
  let events: SimEvent[];

  const tick = (n = 1): void => {
    for (let i = 0; i < n; i++) events.push(...sim.tick());
  };
  const logs = (): string[] =>
    events.flatMap((e) => (e.type === 'log' ? [(e as { text: string }).text] : []));
  const yells = (): string[] =>
    events.flatMap((e) =>
      e.type === 'chat' && (e as { channel?: string }).channel === 'yell'
        ? [(e as { text: string }).text]
        : [],
    );

  beforeEach(() => {
    clock = clockAt(0.5); // noon
    sim = new Sim({
      seed: 7,
      playerClass: 'warrior',
      autoEquip: true,
      world: SLUMBER_TEST_WORLD,
      dayNightNowMs: clock.now,
    });
    sim.setPlayerLevel(20);
    const spawn = lair();
    const id = (
      sim as unknown as { spawnDevBoss(t: string, x: number, z: number): number }
    ).spawnDevBoss(BALGATH, spawn.x, spawn.z);
    const e = sim.entities.get(id);
    if (!e) throw new Error('no boss');
    boss = e;
    ctx = (sim as unknown as { ctx: SimContext }).ctx;
    // Outside his aggro (capped at 20 yards) but inside his 160-yard yell, so nothing
    // below is about his fists and everything he says is heard.
    sim.player.pos.x = spawn.x - 60;
    sim.player.pos.z = spawn.z;
    sim.player.prevPos = { ...sim.player.pos };
    events = [];
    tick();
  });

  it('reads the host clock through the seam', () => {
    expect(sim.dayNightPhase()).toBeCloseTo(0.5, 5);
    expect(ctx.dayNightPhase()).toBeCloseTo(0.5, 5);
    clock.set(0.1);
    expect(sim.dayNightPhase()).toBeCloseTo(0.1, 5);
  });

  it('stands awake and hostile through the day', () => {
    tick(20);
    expect(boss.asleep).toBe(false);
    expect(boss.hostile).toBe(true);
    expect(sim.isHostileTo(sim.player, boss)).toBe(true);
  });

  it('lies down at dusk when idle in bed: neutral, unattackable, healed, announced', () => {
    boss.hp = Math.floor(boss.maxHp * 0.6);
    clock.set(DUSK_PHASE);
    tick();
    expect(boss.asleep).toBe(true);
    expect(boss.hostile).toBe(false);
    expect(boss.inCombat).toBe(false);
    expect(boss.hp).toBe(boss.maxHp);
    // The aura is the frame's read of the state, and it names the mechanic.
    const aura = boss.auras.find((a) => a.id === SLUMBER_AURA_ID);
    expect(aura?.name).toBe(MOBS[BALGATH]?.slumber?.auraName);
    expect(aura?.kind).toBe('buff_dr');
    expect(aura?.value).toBe(0);
    // Neutral means the ONE attackability rule every attack path consults says no.
    expect(sim.isHostileTo(sim.player, boss)).toBe(false);
    // The realm is told, on the same anchorless channel as the spawn announcement.
    expect(logs()).toContain(`${boss.name} sleeps until dawn.`);
    expect(yells()).toContain(MOBS[BALGATH]?.slumber?.sleepYell);
    const sleepLog = events.find(
      (e) => e.type === 'log' && (e as { text: string }).text.endsWith('sleeps until dawn.'),
    ) as { pid?: number; entityId?: number } | undefined;
    expect(sleepLog?.pid).toBeUndefined();
    expect(sleepLog?.entityId).toBeUndefined();
  });

  it('holds the sleep every tick, aura included, until sunrise', () => {
    clock.set(0.8);
    tick();
    expect(boss.asleep).toBe(true);
    // Something strips his auras mid-night (a cleanse, a reset): the reconcile puts the
    // sleep back, because the aura is presentation of the state and never the state.
    boss.auras = [];
    boss.hostile = true;
    tick();
    expect(boss.auras.some((a) => a.id === SLUMBER_AURA_ID)).toBe(true);
    expect(boss.hostile).toBe(false);
    clock.set(0.95);
    tick(20);
    expect(boss.asleep).toBe(true);
    clock.set(0.2); // past midnight, before dawn
    tick(20);
    expect(boss.asleep).toBe(true);
  });

  it('stays whole all night and wakes with an empty hate table', () => {
    clock.set(0.8);
    tick();
    expect(boss.asleep).toBe(true);
    // Damage that never consulted hostility (a lingering tick), and threat seeded by a
    // source that never did either (a heal's awareness threat): neither survives the night.
    boss.hp -= 500;
    boss.threat.set(sim.player.id, 40);
    tick();
    expect(boss.hp).toBe(boss.maxHp);
    clock.set(DAWN_PHASE);
    tick();
    expect(boss.asleep).toBe(false);
    expect(boss.threat.size).toBe(0);
    expect(boss.aggroTargetId).toBeNull();
  });

  it('walks home first when dusk finds him away from his bed', () => {
    const spawn = lair();
    const far = { x: spawn.x - 40, z: spawn.z };
    boss.pos.x = far.x;
    boss.pos.z = far.z;
    boss.prevPos = { ...boss.pos };
    clock.set(DUSK_PHASE);
    tick();
    // Not in bed yet, so not asleep yet, but already on his way.
    expect(boss.asleep).toBe(false);
    const before = Math.hypot(boss.pos.x - spawn.x, boss.pos.z - spawn.z);
    tick(20);
    const after = Math.hypot(boss.pos.x - spawn.x, boss.pos.z - spawn.z);
    expect(after).toBeLessThan(before - 3);
    // At his walk speed 40 yards is well inside 15 seconds; then he lies down.
    tick(20 * 15);
    expect(boss.asleep).toBe(true);
    expect(Math.hypot(boss.pos.x - spawn.x, boss.pos.z - spawn.z)).toBeLessThanOrEqual(
      MOBS[BALGATH]?.slumber?.bedRadius ?? 0,
    );
  });

  it('finishes a fight that is running at dusk before it goes to bed', () => {
    // Pull him in daylight.
    sim.player.pos.x = boss.pos.x;
    sim.player.pos.z = boss.pos.z + 8;
    sim.player.prevPos = { ...sim.player.pos };
    (sim as unknown as { dealDamage(...a: unknown[]): number }).dealDamage(
      sim.player,
      boss,
      50,
      false,
      'physical',
      'probe',
      'hit',
      true,
    );
    tick(2);
    expect(boss.inCombat).toBe(true);
    // Night falls mid-pull: he keeps fighting.
    clock.set(0.8);
    tick(20 * 3);
    expect(boss.asleep).toBe(false);
    expect(boss.hostile).toBe(true);
    expect(boss.inCombat).toBe(true);
    // The pull ends (the raid wipes, or he evades home): NOW the night applies.
    (sim as unknown as { resetEvadingMob(m: Entity): void }).resetEvadingMob(boss);
    boss.pos.x = boss.spawnPos.x;
    boss.pos.z = boss.spawnPos.z;
    sim.player.pos.x = boss.pos.x - 60;
    sim.player.prevPos = { ...sim.player.pos };
    tick(2);
    expect(boss.asleep).toBe(true);
  });

  it('wakes at dawn with a yell and the realm-wide call, hostile again', () => {
    clock.set(0.8);
    tick();
    expect(boss.asleep).toBe(true);
    events = [];
    clock.set(DAWN_PHASE);
    tick();
    expect(boss.asleep).toBe(false);
    expect(boss.hostile).toBe(true);
    expect(boss.auras.some((a) => a.id === SLUMBER_AURA_ID)).toBe(false);
    expect(sim.isHostileTo(sim.player, boss)).toBe(true);
    expect(yells()).toContain(MOBS[BALGATH]?.slumber?.wakeYell);
    const zone = zoneAt(boss.pos.x, boss.pos.z).name;
    expect(logs()).toContain(`${boss.name} wakes over ${zone}!`);
  });

  it('stands still for the rise: the AI waits out riseSeconds before he moves or acts', () => {
    // The dawn wake is a 3.95 s one-shot on the renderer (Balgath_Wake levers him up out
    // of the mound). If the ordinary AI ran the same tick he woke, the first wander step or
    // the first aggro chase would slide the mound across the ground while the clip played:
    // the exact skate artifact the boss's clips were authored to remove. So the sim holds
    // him: hostile and attackable, but the AI waits for the body to stand up.
    const rise = MOBS[BALGATH]?.slumber?.riseSeconds ?? 0;
    expect(rise).toBeGreaterThan(0);
    clock.set(0.8);
    tick();
    expect(boss.asleep).toBe(true);
    const bed = { ...boss.pos };
    // A player standing in his face: an awake AI would have him chasing within a tick.
    sim.player.pos.x = bed.x - 8;
    sim.player.pos.z = bed.z;
    sim.player.prevPos = { ...sim.player.pos };
    clock.set(DAWN_PHASE);
    const ticks = Math.round(rise / DT);
    for (let i = 0; i < ticks; i++) {
      tick();
      expect(boss.asleep).toBe(false);
      expect(boss.hostile).toBe(true);
      expect(boss.aiState).toBe('idle');
      expect(dist2d(boss.pos, bed)).toBeLessThan(1e-6);
    }
    // The hold is over: the ordinary AI runs and finds the player in his aggro ring on its
    // very first tick (the idle scan has no cadence), so two ticks is all it takes.
    tick(2);
    expect(boss.aggroTargetId).toBe(sim.player.id);
    expect(['chase', 'attack']).toContain(boss.aiState);
  });

  it('carries an opener landed during the rise into the fight, from beyond the idle scan', () => {
    // The raid does not wait for him to finish standing up. Threat built during the hold
    // has to be what the AI acts on when the hold ends, from ANY range: the idle aggro
    // scan is capped at 20 yards, so a 30-yard opener that only seeded threat would leave
    // him standing there idle with a full hate table if the hold had stomped his state.
    clock.set(0.8);
    tick();
    expect(boss.asleep).toBe(true);
    sim.player.pos.x = boss.pos.x - 30;
    sim.player.pos.z = boss.pos.z;
    sim.player.prevPos = { ...sim.player.pos };
    clock.set(DAWN_PHASE);
    tick();
    expect(boss.asleep).toBe(false);
    expect(boss.slumberRise ?? 0).toBeGreaterThan(0);
    const bed = { ...boss.pos };
    ctx.dealDamage(sim.player, boss, 200, false, 'physical', null, 'hit');
    expect(boss.threat.get(sim.player.id) ?? 0).toBeGreaterThan(0);
    // Still held: hostile, hurt, not moving, for the rest of the rise.
    const rise = MOBS[BALGATH]?.slumber?.riseSeconds ?? 0;
    for (let i = 1; i < Math.round(rise / DT); i++) {
      tick();
      expect(dist2d(boss.pos, bed)).toBeLessThan(1e-6);
    }
    expect(boss.hp).toBeLessThan(boss.maxHp);
    // Hold over: he goes for the one who hit him.
    tick(2);
    expect(boss.aggroTargetId).toBe(sim.player.id);
    expect(['chase', 'attack']).toContain(boss.aiState);
    tick(20);
    expect(dist2d(boss.pos, bed)).toBeGreaterThan(1);
  });

  it('comes back awake and unheld from an in-place respawn, with no wake call', () => {
    // No slumbering template respawns in place today (the world boss is scheduler-owned,
    // respawnTimer Infinity), so this is the unit-level pin on the defensive arm: a respawn
    // that inherited the bed bits would either replay the realm-wide dawn call by day or
    // come back hostile but AI-frozen for the rest of a stale rise.
    boss.asleep = true;
    boss.slumberRise = 2;
    events = [];
    respawnMob(ctx, boss);
    expect(boss.asleep).toBe(false);
    expect(boss.slumberRise ?? 0).toBe(0);
    tick(3);
    expect(logs().some((l) => l.includes('wakes over'))).toBe(false);
    expect(boss.aiState).toBe('idle');
  });

  it('answers "rising" to the dispatcher for exactly the hold, then "awake"', () => {
    // The pure surface of the hold, off the live loop so the countdown is this test's.
    boss.slumberRise = 2 * DT;
    expect(tickSlumber(ctx, boss)).toBe('rising');
    expect(tickSlumber(ctx, boss)).toBe('rising');
    expect(tickSlumber(ctx, boss)).toBe('awake');
    expect(boss.slumberRise).toBe(0);
  });

  it('is the driver the dispatcher runs, and it answers what it did', () => {
    // The pure surface, for the dispatcher contract: awake by day, in bed at night.
    expect(tickSlumber(ctx, boss)).toBe('awake');
    clock.set(0.9);
    expect(tickSlumber(ctx, boss)).toBe('asleep');
    boss.pos.x += 30;
    boss.asleep = false;
    boss.hostile = true;
    expect(tickSlumber(ctx, boss)).toBe('homing');
  });

  it('mirrors the bed to clients as one bit, and the warpath phase beside it', () => {
    expect(wireEntity(boss).slp).toBeUndefined();
    clock.set(0.9);
    tick();
    expect(wireEntity(boss).slp).toBe(1);
    clock.set(0.5);
    tick();
    expect(wireEntity(boss).slp).toBeUndefined();
    // The phase aura's inputs ride too (they never did, so the online raid saw no tint).
    boss.warpathPhase = 'travel';
    boss.warpathUnharried = 4.25;
    const w = wireEntity(boss);
    expect(w.wp).toBe('travel');
    expect(w.wu).toBe(4.25);
    boss.warpathPhase = 'focus';
    expect(wireEntity(boss).wu).toBeUndefined();
  });
});

describe('two hosts fed the same clock agree', () => {
  it('sleep, wake and the dawn respawn land on the same tick for the same clock', () => {
    // The clock is an INPUT, so determinism is per clock, not per wall time: two sims
    // built on one seed and handed the identical sequence of clock readings must agree
    // tick for tick through dusk, the night, the dawn wake, a kill and the dawn rise.
    const script = (i: number): number => {
      // Day, a night he sleeps through, the dawn he wakes at (and rises through), a kill
      // by day, a second night he is dead for, and the dawn that brings him back.
      if (i < 40) return 0.5;
      if (i < 200) return 0.9;
      if (i < 320) return DAWN_PHASE + 0.001;
      if (i < 440) return 0.9;
      if (i < 560) return DAWN_PHASE + 0.001;
      return 0.6;
    };
    const build = () => {
      let i = 0;
      const sim = new Sim({
        seed: 7,
        playerClass: 'warrior',
        autoEquip: true,
        noPlayer: true,
        world: SLUMBER_TEST_WORLD,
        worldBossAtBoot: true,
        dayNightNowMs: () => phaseToCycleMs(script(i)),
      });
      return {
        sim,
        step: () => {
          i++;
          return sim.tick();
        },
      };
    };
    const a = build();
    const b = build();
    const bossOf = (sim: Sim) => [...sim.entities.values()].find((e) => e.templateId === BALGATH);
    const trace: string[][] = [[], []];
    for (let t = 0; t < 580; t++) {
      for (const [k, host] of [a, b].entries()) {
        const events = host.step();
        const boss = bossOf(host.sim);
        if (t === 300) {
          // Kill him by day from outside the fight (only the schedule is under test).
          if (boss) {
            boss.hp = 0;
            boss.dead = true;
            boss.corpseTimer = 0;
          }
        }
        const rising = boss && (boss.slumberRise ?? 0) > 0 ? 'r' : '-';
        trace[k].push(
          `${t}:${boss ? `${boss.id}/${boss.asleep}/${boss.hostile}/${boss.hp}/${rising}` : 'none'}:${events
            .filter((e) => e.type === 'log' || e.type === 'chat')
            .map((e) => (e as { text: string }).text)
            .join('|')}`,
        );
      }
    }
    expect(trace[0]).toEqual(trace[1]);
    // And the trace actually visited every arm, so the equality proved something.
    const joined = trace[0].join('\n');
    expect(joined).toContain('sleeps until dawn.');
    expect(joined).toContain('wakes over');
    // Exactly two rises FOR HIM: the boot spawn and the dawn respawn after the kill (a
    // lone match would be satisfied by the boot line alone, proving nothing about the
    // schedule). Matched on his own name because worldBossAtBoot raises every slot, so a
    // bare /rises over/ also counts Thunzharr's boot line and would pass on two of his.
    const hisRises = joined.match(new RegExp(`${MOBS[BALGATH]?.name} rises over`, 'g'));
    expect(hisRises).toHaveLength(2);
    expect(joined).toMatch(/:\d+\/true\/false\//); // asleep and neutral
    expect(joined).toMatch(/\/false\/true\/\d+\/r:/); // awake, hostile, mid-rise
    expect(joined).toContain(':none:'); // dead and gone, waiting for sunrise
  });
});

describe('the scheduler keeps his hours', () => {
  const bossOf = (sim: Sim): Entity | undefined =>
    [...sim.entities.values()].find((e) => e.templateId === BALGATH);
  const balgathSlot = WORLD_BOSSES.findIndex((b) => b.templateId === BALGATH);

  const boot = (phase: number) => {
    const clock = clockAt(phase);
    const sim = new Sim({
      seed: 7,
      playerClass: 'warrior',
      autoEquip: true,
      noPlayer: true,
      world: SLUMBER_TEST_WORLD,
      worldBossAtBoot: true,
      dayNightNowMs: clock.now,
    });
    const events = sim.tick();
    return { sim, clock, events };
  };

  it('a realm booting after dark finds him already in bed, with no "rises" line', () => {
    const { sim, events } = boot(0.9);
    const boss = bossOf(sim);
    expect(boss).toBeDefined();
    expect(boss?.asleep).toBe(true);
    expect(boss?.hostile).toBe(false);
    const texts = events.flatMap((e) => (e.type === 'log' ? [(e as { text: string }).text] : []));
    expect(texts.some((t) => t.startsWith(`${boss?.name} rises over`))).toBe(false);
    // Thunzharr, who keeps no hours, still rises and still says so.
    expect(texts.some((t) => t.includes('rises over'))).toBe(true);
  });

  it('a realm booting by day gets him awake, announced like any world boss', () => {
    const { sim, events } = boot(0.5);
    const boss = bossOf(sim);
    expect(boss?.asleep).toBe(false);
    expect(boss?.hostile).toBe(true);
    const texts = events.flatMap((e) => (e.type === 'log' ? [(e as { text: string }).text] : []));
    expect(texts.some((t) => t.startsWith(`${boss?.name} rises over`))).toBe(true);
  });

  it('a kill puts him down until the next dawn, whatever the interval says', () => {
    const { sim, clock } = boot(0.5);
    const boss = bossOf(sim) as Entity;
    const internals = sim as unknown as {
      worldBossNextAt: number[];
      worldBossRiseAtDawn: boolean[];
      time: number;
    };
    // Kill him (an outside-the-fight kill is fine here: only the scheduler is under test).
    boss.hp = 0;
    boss.dead = true;
    boss.corpseTimer = 0;
    sim.tick();
    expect(bossOf(sim)).toBeUndefined();
    expect(internals.worldBossRiseAtDawn[balgathSlot]).toBe(true);
    // The hourly interval comes due: NOT enough for a sleeper.
    internals.worldBossNextAt[balgathSlot] = internals.time;
    sim.tick();
    expect(bossOf(sim)).toBeUndefined();
    // Dusk and the whole night pass: still nothing.
    clock.set(0.8);
    sim.tick();
    clock.set(0.1);
    sim.tick();
    expect(bossOf(sim)).toBeUndefined();
    // Sunrise: he rises, awake, and the flag clears so it fires once.
    clock.set(DAWN_PHASE + 0.001);
    const events = sim.tick();
    const risen = bossOf(sim);
    expect(risen).toBeDefined();
    expect(risen?.asleep).toBe(false);
    expect(internals.worldBossRiseAtDawn[balgathSlot]).toBe(false);
    const texts = events.flatMap((e) => (e.type === 'log' ? [(e as { text: string }).text] : []));
    expect(texts.some((t) => t.startsWith(`${risen?.name} rises over`))).toBe(true);
  });

  it('a clockless world keeps the interval cadence for him too', () => {
    const sim = new Sim({
      seed: 7,
      playerClass: 'warrior',
      autoEquip: true,
      noPlayer: true,
      world: SLUMBER_TEST_WORLD,
      worldBossAtBoot: true,
    });
    sim.tick();
    const boss = bossOf(sim) as Entity;
    const internals = sim as unknown as {
      worldBossNextAt: number[];
      worldBossRiseAtDawn: boolean[];
      time: number;
    };
    boss.hp = 0;
    boss.dead = true;
    boss.corpseTimer = 0;
    sim.tick();
    expect(internals.worldBossRiseAtDawn[balgathSlot]).toBe(false);
    internals.worldBossNextAt[balgathSlot] = internals.time;
    sim.tick();
    expect(bossOf(sim)).toBeDefined();
  });
});
