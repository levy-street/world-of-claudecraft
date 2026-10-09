// The owner's playtest (2026-10-04): "Halberd Sweep: if I stay inside the
// red area it casts fast, if I step out it takes a long time to cast." A
// started mob cast bar (breathCone, bigCast, the rift death zones) only
// counted down on ticks that ended in melee contact, so stepping out of the
// telegraph froze the bar until the target walked back in. A bar that has
// STARTED now runs out on time whatever the range (mob/mob_cast_bars.ts);
// STARTING a new one stays melee-gated. Inside a dungeon that plants its area
// casts (DungeonDef.areaCastsPlant) the caster also stays on its spot for the
// whole bar instead of chasing.
import { describe, expect, it } from 'vitest';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { applyDungeonMobTuning } from '../src/sim/instances/difficulty';
import { claimedInstanceAt } from '../src/sim/instances/dungeons';
import { tickStartedMobCastBars } from '../src/sim/mob/mob_cast_bars';
import { BASTION_HALBERD_SWEEP } from '../src/sim/mob/trash_kit/bastion_cast_ids';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type SimEvent } from '../src/sim/types';

interface Bench {
  sim: Sim;
  me: Entity;
}

/** A quiet spot on the Sunken Bastion's tidal flats, clear of every pack. */
function bastionBench(): Bench {
  const sim = new Sim({ seed: 91, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.chat('/dev bastion enter normal', sim.player.id);
  const inst = claimedInstanceAt(sim.ctx, sim.player.pos);
  if (!inst) throw new Error('no bastion claim');
  const me = sim.player;
  me.maxHp = 1e6;
  me.hp = 1e6;
  const o = instanceOrigin(DUNGEONS.sunken_bastion.index, inst.slot);
  me.pos = sim.ctx.groundPos(o.x - 10, o.z - 200);
  me.prevPos = { ...me.pos };
  sim.rebucket(me);
  sim.drainEvents();
  return { sim, me };
}

function spawnEngaged(b: Bench, templateId: string, dx: number, dz: number): Entity {
  const t = MOBS[templateId];
  const mob = createMob(b.sim.ctx.nextId++, t, t.minLevel, {
    ...b.sim.ctx.groundPos(b.me.pos.x + dx, b.me.pos.z + dz),
  });
  const inst = claimedInstanceAt(b.sim.ctx, b.me.pos);
  if (inst) {
    applyDungeonMobTuning(mob, inst.dungeonId, inst.difficulty);
    inst.mobIds.push(mob.id);
  }
  b.sim.ctx.addEntity(mob);
  mob.inCombat = true;
  mob.aiState = 'attack';
  mob.aggroTargetId = b.me.id;
  mob.threat.set(b.me.id, 100);
  mob.facing = Math.atan2(b.me.pos.x - mob.pos.x, b.me.pos.z - mob.pos.z);
  return mob;
}

function placePlayer(b: Bench, x: number, z: number): void {
  b.me.pos = b.sim.ctx.groundPos(x, z);
  b.me.prevPos = { ...b.me.pos };
  b.sim.rebucket(b.me);
  b.me.hp = b.me.maxHp;
}

interface BarRun {
  /** Ticks from the tick the bar began to the tick it landed. */
  barTicks: number;
  /** Did the landing tick carry the cast's own effect event? */
  landedFx: boolean;
  /** Largest distance the caster stood from its starting spot during the bar. */
  maxDrift: number;
  /** Damage events from the cast that hit the player. */
  hits: number;
}

/**
 * Start `castId` on `mob` while the player stands in melee (the start stays
 * melee-gated), then either keep the player there or move them to `away`
 * (an offset from the CASTER, re-applied every tick so a chaser never closes)
 * and count the ticks until the bar lands.
 */
function runBar(
  b: Bench,
  mob: Entity,
  castId: string,
  castName: string,
  arm: () => void,
  away: { dx: number; dz: number } | null,
  isLandingFx: (ev: SimEvent) => boolean,
): BarRun {
  arm();
  for (let i = 0; i < 20 && mob.castingAbility !== castId; i++) {
    b.me.hp = b.me.maxHp;
    b.sim.tick();
  }
  expect(mob.castingAbility).toBe(castId);
  b.sim.drainEvents();
  const start = { ...mob.pos };
  let barTicks = 0;
  let landedFx = false;
  let maxDrift = 0;
  let hits = 0;
  while (mob.castingAbility === castId && barTicks < 400) {
    if (away) placePlayer(b, mob.pos.x + away.dx, mob.pos.z + away.dz);
    b.me.hp = b.me.maxHp;
    const evs = b.sim.tick();
    barTicks++;
    maxDrift = Math.max(maxDrift, Math.hypot(mob.pos.x - start.x, mob.pos.z - start.z));
    for (const ev of evs) {
      if (isLandingFx(ev)) landedFx = true;
      if (ev.type === 'damage' && ev.targetId === b.me.id && ev.ability === castName) hits++;
    }
  }
  return { barTicks, landedFx, maxDrift, hits };
}

describe('a started mob cast bar runs out on time whatever the range', () => {
  const sweep = MOBS.drowned_watchman.breathCone;
  if (!sweep) throw new Error('the Drowned Watchman has no Halberd Sweep');

  function watchmanRun(stepOut: boolean): BarRun {
    const b = bastionBench();
    // 3 yd east of the player, facing west at them: melee contact.
    const watchman = spawnEngaged(b, 'drowned_watchman', 3, 0);
    b.sim.tick();
    return runBar(
      b,
      watchman,
      BASTION_HALBERD_SWEEP,
      sweep?.name ?? '',
      () => {
        watchman.breathTimer = 0;
      },
      // 12 yd west of the caster: out of melee AND out of the 6 yd sweep.
      stepOut ? { dx: -12, dz: 0 } : null,
      (ev) => ev.type === 'spellfx' && ev.sourceId === watchman.id && ev.fx === 'fireCone',
    );
  }

  it('Halberd Sweep lands castTime after it began when the player steps out mid-bar', () => {
    const stay = watchmanRun(false);
    const out = watchmanRun(true);
    // The control: standing in it, the bar runs its authored cast time.
    expect(Math.abs(stay.barTicks * DT - sweep.castTime)).toBeLessThanOrEqual(DT + 1e-9);
    expect(stay.landedFx).toBe(true);
    expect(stay.hits).toBe(1);
    // Stepping out no longer stalls it: it lands on the very same tick.
    expect(out.barTicks).toBe(stay.barTicks);
    expect(out.landedFx).toBe(true);
    // ...and misses the one who left the drawn area.
    expect(out.hits).toBe(0);
  });

  it('the Watchman stays planted through the bar instead of chasing the one who left', () => {
    const out = watchmanRun(true);
    expect(out.maxDrift).toBeLessThan(0.01);
  });

  it('a bar that lands with nobody in melee does not start the next one out of melee', () => {
    const b = bastionBench();
    const watchman = spawnEngaged(b, 'drowned_watchman', 3, 0);
    b.sim.tick();
    runBar(
      b,
      watchman,
      BASTION_HALBERD_SWEEP,
      sweep.name,
      () => {
        watchman.breathTimer = 0;
      },
      { dx: -12, dz: 0 },
      () => false,
    );
    expect(watchman.castingAbility).toBeNull();
    // The cadence is due again at once, but the player stays out of reach:
    // a NEW bar still waits for melee contact.
    watchman.breathTimer = 0;
    for (let i = 0; i < 10; i++) {
      placePlayer(b, watchman.pos.x - 30, watchman.pos.z);
      b.sim.tick();
      expect(watchman.castingAbility).toBeNull();
    }
  });
});

describe('the same for a telegraphed hardcast (bigCast) in the open world', () => {
  const stormcall = MOBS.thunzharr_waking_peak.bigCast;
  if (!stormcall) throw new Error('Thunzharr has no Stormcall');

  function stormcallRun(stepOut: boolean): BarRun {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: false });
    const me = sim.player;
    me.maxHp = 1e7;
    me.hp = 1e7;
    const b: Bench = { sim, me };
    const boss = spawnEngaged(b, 'thunzharr_waking_peak', 4, 0);
    // Only the hardcast under test: every other periodic mechanic stays quiet.
    boss.pulseTimer = 999;
    boss.stompTimer = 999;
    boss.aoeSlowTimer = 999;
    boss.stoneskinTimer = 999;
    boss.loudYellTimer = 999;
    sim.tick();
    return runBar(
      b,
      boss,
      stormcall?.castId ?? '',
      stormcall?.name ?? '',
      () => {
        boss.bigCastTimer = 0;
      },
      // Far outside his reach and the 30 yd nova: he chases (open world, so
      // nothing plants him) but never reaches melee during the bar.
      stepOut ? { dx: -45, dz: 0 } : null,
      (ev) => ev.type === 'spellfx' && ev.sourceId === boss.id && ev.fx === 'nova',
    );
  }

  it('Stormcall lands castTime after it began, in melee or not', () => {
    const stay = stormcallRun(false);
    const out = stormcallRun(true);
    expect(Math.abs(stay.barTicks * DT - stormcall.castTime)).toBeLessThanOrEqual(DT + 1e-9);
    expect(out.barTicks).toBe(stay.barTicks);
    expect(out.landedFx).toBe(true);
    expect(stay.hits).toBe(1);
    expect(out.hits).toBe(0);
    // Not a planted cast: outside a planting dungeon he keeps chasing.
    expect(out.maxDrift).toBeGreaterThan(5);
  });
});

describe('the rift death-zone bar runs out on time out of melee too', () => {
  const zone = MOBS.rift_boss_ember.deathZoneCast;
  if (!zone) throw new Error('rift_boss_ember has no deathZoneCast');

  it('a started death-zone bar lands castTime later with the boss chasing, and starts nothing', () => {
    const sim = new Sim({ seed: 3, playerClass: 'warrior', autoEquip: false });
    const me = sim.player;
    const boss = createMob(sim.ctx.nextId++, MOBS.rift_boss_ember, 30, {
      ...sim.ctx.groundPos(me.pos.x + 30, me.pos.z),
    });
    sim.ctx.addEntity(boss);
    boss.inCombat = true;
    boss.aiState = 'chase';
    boss.aggroTargetId = me.id;
    boss.castingAbility = zone.castId;
    boss.castTotal = zone.castTime;
    boss.castRemaining = zone.castTime;
    const events: SimEvent[] = [];
    let calls = 0;
    while (boss.castingAbility === zone.castId && calls < 400) {
      tickStartedMobCastBars(sim.ctx, boss);
      events.push(...sim.drainEvents());
      calls++;
    }
    expect(Math.abs(calls * DT - zone.castTime)).toBeLessThanOrEqual(DT + 1e-9);
    expect(boss.castRemaining).toBe(0);
    expect(events.some((e) => e.type === 'log' && e.text === zone.detonateText)).toBe(true);
    // The out-of-melee path only ever lands a started bar: idle, it starts none.
    boss.deathZoneCastTimer = 0;
    for (let i = 0; i < 40; i++) tickStartedMobCastBars(sim.ctx, boss);
    expect(boss.castingAbility).toBeNull();
  });

  it('a mob that is not in the chase or attack state keeps its bar frozen, as before', () => {
    const sim = new Sim({ seed: 3, playerClass: 'warrior', autoEquip: false });
    const boss = createMob(sim.ctx.nextId++, MOBS.rift_boss_ember, 30, {
      ...sim.ctx.groundPos(sim.player.pos.x + 30, sim.player.pos.z),
    });
    sim.ctx.addEntity(boss);
    boss.aiState = 'flee';
    boss.castingAbility = zone.castId;
    boss.castTotal = zone.castTime;
    boss.castRemaining = zone.castTime;
    for (let i = 0; i < 100; i++) tickStartedMobCastBars(sim.ctx, boss);
    expect(boss.castRemaining).toBe(zone.castTime);
  });
});
