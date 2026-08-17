import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

// Grave Inferno: Korzul's Baron-Geddon-style channel, replacing his old
// Necrotic Shockwave aoePulse (570-798 unmitigated on every melee each 8s
// with zero counterplay). Every `every` seconds he roots in place, stops
// meleeing, and channels for 8s, pulsing fire at 2/4/6/8s with ESCALATING
// damage (pulse k = base roll x k x mechanic multiplier, unmitigated):
// melee who move at the channel start eat the small first pulse or nothing;
// anyone who stands the full channel takes the stacked total and deserved
// it. Uninterruptible by construction (Korzul is ccImmune on both
// difficulties); each pulse emits a nova spellfx so the ring reads visually.

const SEED = 24601;

type TickEvent = ReturnType<Sim['tick']>[number];

function setup(mult: number) {
  const sim = new Sim({
    seed: SEED,
    playerClass: 'warrior',
    noPlayer: true,
    world: EMPTY_TEST_WORLD,
  });
  const tankPid = sim.addPlayer('warrior', 'Tank');
  sim.setPlayerLevel(20, tankPid);
  const tank = sim.entities.get(tankPid)!;
  tank.maxHp = 1e7;
  tank.hp = 1e7;
  const tmpl = MOBS.korzul_the_gravewyrm;
  const boss = createMob(sim.nextId++, tmpl, 22, {
    x: tank.pos.x + 2,
    y: tank.pos.y,
    z: tank.pos.z,
  });
  boss.hostile = true;
  boss.mechanicDamageMult = mult; // stand in for the instance stamp
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(boss);
  boss.inCombat = true;
  boss.aiState = 'attack';
  boss.aggroTargetId = tankPid;
  boss.threat.set(tankPid, 1e9);
  return { sim, tankPid, tank, boss };
}

function run(sim: Sim, seconds: number, keepAlive: Entity[]): { at: number; event: TickEvent }[] {
  const rows: { at: number; event: TickEvent }[] = [];
  for (let i = 0; i < seconds * 20; i++) {
    for (const e of keepAlive) e.hp = e.maxHp;
    const at = (sim as unknown as { time: number }).time;
    for (const event of sim.tick()) rows.push({ at, event });
  }
  return rows;
}

function infernoHits(rows: { at: number; event: TickEvent }[], bossId: number) {
  return rows.filter(
    (r) =>
      r.event.type === 'damage' &&
      r.event.sourceId === bossId &&
      r.event.ability === 'Grave Inferno' &&
      r.event.kind === 'hit',
  ) as { at: number; event: Extract<TickEvent, { type: 'damage' }> }[];
}

describe('Grave Inferno (Korzul channel)', () => {
  it('is authored on the template, replacing the aoePulse', () => {
    const t = MOBS.korzul_the_gravewyrm;
    expect(t.aoePulse).toBeUndefined();
    expect(t.infernoChannel).toEqual({
      every: 30,
      duration: 8,
      pulses: 4,
      min: 7,
      max: 9,
      radius: 14,
      name: 'Grave Inferno',
      school: 'fire',
      // 2026-07-26: one 50% hp gate, so the channel fires at least once per
      // kill on both difficulties even when the group out-paces the 30s
      // cadence; it sits above the 30% enrage so the burn phase never stacks
      // on enraged melee.
      atHpPct: [0.5],
    });
  });

  it('channels on cadence: stationary, no melee, four escalating pulses, then resumes', () => {
    const { sim, boss, tank } = setup(19);
    const rows = run(sim, 45, [tank]);
    const hits = infernoHits(rows, boss.id);
    expect(hits).toHaveLength(4); // one full channel fits in 45s (starts at 30s)

    // Pulses land ~2s apart inside the channel window.
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i].at - hits[i - 1].at).toBeGreaterThan(1.7);
      expect(hits[i].at - hits[i - 1].at).toBeLessThan(2.3);
    }
    // Escalation: pulse k lands in [min*k*mult, max*k*mult], strictly rising.
    hits.forEach((h, i) => {
      const k = i + 1;
      expect(h.event.amount).toBeGreaterThanOrEqual(7 * k * 19);
      expect(h.event.amount).toBeLessThanOrEqual(9 * k * 19);
    });

    // No melee lands DURING the channel; swings resume after it ends.
    const channelStart = hits[0].at - 2;
    const channelEnd = hits[3].at;
    const swings = rows.filter(
      (r) =>
        r.event.type === 'damage' &&
        r.event.sourceId === boss.id &&
        r.event.ability === null &&
        r.event.kind === 'hit',
    );
    expect(swings.some((s) => s.at > channelStart && s.at < channelEnd)).toBe(false);
    expect(swings.some((s) => s.at > channelEnd + 0.5)).toBe(true);

    // The channel start AND each pulse flash a terrain ring at the TRUE
    // radius (spellfxAt carries x/z/radius, so the rendered edge is the
    // gameplay edge): 1 telegraph + 4 pulses = 5 rings per channel.
    const rings = rows.filter(
      (r) => r.event.type === 'spellfxAt' && r.event.fx === 'nova' && r.event.school === 'fire',
    ) as { at: number; event: Extract<TickEvent, { type: 'spellfxAt' }> }[];
    expect(rings.length).toBeGreaterThanOrEqual(5);
    for (const ring of rings) {
      expect(ring.event.radius).toBe(14);
      expect(ring.event.x).toBeCloseTo(boss.pos.x, 5);
      expect(ring.event.z).toBeCloseTo(boss.pos.z, 5);
    }
  });

  it('the 14yd boundary is exact: 13.5yd eats every pulse, 14.5yd none; damage ignores armor', () => {
    const { sim, boss, tank } = setup(19);
    const farPid = sim.addPlayer('warrior', 'Far');
    sim.setPlayerLevel(20, farPid);
    const far = sim.entities.get(farPid)!;
    far.maxHp = 1e7;
    far.hp = 1e7;
    far.pos = { x: boss.pos.x + 14.5, y: boss.pos.y, z: boss.pos.z };
    far.prevPos = { ...far.pos };
    const nakedPid = sim.addPlayer('priest', 'Naked');
    sim.setPlayerLevel(20, nakedPid);
    const naked = sim.entities.get(nakedPid)!;
    naked.maxHp = 1e7;
    naked.hp = 1e7;
    naked.pos = { x: boss.pos.x - 13.5, y: boss.pos.y, z: boss.pos.z };
    naked.prevPos = { ...naked.pos };

    const rows = run(sim, 40, [tank, far, naked]);
    const hits = infernoHits(rows, boss.id);
    const farHits = hits.filter((h) => h.event.targetId === far.id);
    const nakedHits = hits.filter((h) => h.event.targetId === naked.id);
    const tankHits = hits.filter((h) => h.event.targetId === tank.id);
    expect(farHits).toHaveLength(0);
    expect(nakedHits.length).toBeGreaterThan(0);
    expect(tankHits.length).toBe(nakedHits.length);
    // Unmitigated: the armored tank and the cloth priest take the SAME pulse.
    for (let i = 0; i < tankHits.length; i++) {
      expect(tankHits[i].event.amount).toBe(nakedHits[i].event.amount);
    }
  });
});

describe('Grave Inferno 50% hp gate', () => {
  it('arms the channel immediately at 50%, then the cadence reseeds from the gate', () => {
    const { sim, boss, tank } = setup(15);
    const before = run(sim, 5, [tank]);
    expect(infernoHits(before, boss.id)).toHaveLength(0); // cadence alone: first channel at 30s
    boss.hp = boss.maxHp * 0.49;
    const rows = run(sim, 42, [tank]);
    const hits = infernoHits(rows, boss.id);
    // The gate channel fires all four pulses right away (first pulse ~2s
    // after the gate is consumed on the next engaged melee tick), long
    // before the 30s cadence would have...
    const gateChannel = hits.filter((h) => h.at < 20);
    expect(gateChannel).toHaveLength(4);
    expect(hits[0].at).toBeGreaterThan(5);
    expect(hits[0].at).toBeLessThan(10);
    gateChannel.forEach((h, i) => {
      const k = i + 1;
      expect(h.event.amount).toBeGreaterThanOrEqual(7 * k * 15);
      expect(h.event.amount).toBeLessThanOrEqual(9 * k * 15);
    });
    // ...and the cadence reseeds from the gate arm (the countdown freezes
    // while a channel is live, so the follow-up lands ~38s later), rather
    // than a second gate-fired channel chaining instantly.
    expect(hits.length).toBeGreaterThan(4);
    expect(hits[4].at - hits[0].at).toBeGreaterThan(25);
  });

  it('a gate crossed during a live channel is served by it, never chained back-to-back', () => {
    const { sim, boss, tank } = setup(15);
    boss.infernoTimer = 0.1; // force a cadence channel on the first tick
    run(sim, 3, [tank]);
    boss.hp = boss.maxHp * 0.45; // cross the gate MID-channel
    const rows = run(sim, 22, [tank]);
    const hits = infernoHits(rows, boss.id);
    // Only the pulses of the one live channel: the mid-channel gate is
    // consumed by it instead of instantly re-arming a second 8s root.
    expect(hits.length).toBeLessThanOrEqual(4);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('the gate fires once: hp hovering across the line does not re-arm', () => {
    const { sim, boss, tank } = setup(15);
    boss.hp = boss.maxHp * 0.49;
    run(sim, 12, [tank]); // gate channel runs to completion
    boss.hp = boss.maxHp * 0.8; // "heal" back over the line...
    run(sim, 2, [tank]);
    boss.hp = boss.maxHp * 0.49; // ...and cross it again
    const rows = run(sim, 12, [tank]);
    expect(infernoHits(rows, boss.id)).toHaveLength(0); // consumed; only the cadence remains
  });
});
