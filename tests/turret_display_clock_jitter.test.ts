import { describe, expect, it } from 'vitest';
import { emitTurretSelfKeys } from '../server/turret_self_wire';
import { QuestWorldWireState } from '../src/net/quest_world_wire_state';
import {
  TURRET_TICK_LATE_MAX,
  TURRET_TICK_LEAD_MAX,
  TurretDisplayClock,
} from '../src/render/turret_monster_pose_core';
import { BUILTIN_WORLD } from '../src/sim/data';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { DT, type SimEvent, type WorldContent } from '../src/sim/types';

const EMPTY_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
const FPS = 60;
const SECONDS = 40;
const WARMUP_SECONDS = 5;

class WireClient extends QuestWorldWireState {
  route(event: SimEvent): void {
    this.applyQuestWorldEvent(JSON.parse(JSON.stringify(event)) as SimEvent);
  }
}

interface Delivery {
  at: number;
  events: SimEvent[];
  self: Record<string, unknown>;
  time: number;
  tick: number;
}

interface JitterStats {
  frames: number;
  stallFrames: number;
  longestStallMs: number;
  jumpFrames: number;
  largestJumpTicks: number;
  maxLeadTicks: number;
}

/**
 * A seated server player's snapshots delivered to an online mirror over a link with a
 * seeded one-way delay of `delayMs` plus or minus `jitterMs` (in order, like a socket),
 * sampled by a display clock at 60 fps.
 */
function runLink(delayMs: number, jitterMs: number, clock: TurretDisplayClock): JitterStats {
  const sim = new Sim({
    seed: 11,
    playerClass: 'warrior',
    devCommands: true,
    noPlayer: true,
    world: EMPTY_WORLD,
  });
  const pid = sim.addPlayer('warrior', 'Gunner', { characterId: 7 });
  sim.drainEvents();
  sim.chat('/dev turret', pid);
  const client = new WireClient();
  const sent: Record<string, string> = {};
  const rng = new Rng(0x5eed + jitterMs);
  const queue: Delivery[] = [];
  let lastArrival = 0;
  let serverTicks = 0;
  const expected = 1 / (FPS * DT);
  const stats: JitterStats = {
    frames: 0,
    stallFrames: 0,
    longestStallMs: 0,
    jumpFrames: 0,
    largestJumpTicks: 0,
    maxLeadTicks: 0,
  };
  let prior = Number.NaN;
  let streak = 0;
  for (let frame = 0; frame < FPS * SECONDS; frame++) {
    const time = frame / FPS;
    while (serverTicks * DT <= time) {
      const events = sim.tick().filter((e) => e.pid === pid);
      serverTicks++;
      let extra = '';
      emitTurretSelfKeys(
        (key, serialized) => {
          if (sent[key] === serialized) return;
          sent[key] = serialized;
          extra += `,"${key}":${serialized}`;
        },
        sim.meta(pid)!,
        sim.tickCount,
      );
      const delay = (delayMs + rng.range(-jitterMs, jitterMs)) / 1000;
      lastArrival = Math.max(lastArrival, serverTicks * DT + delay);
      queue.push({
        at: lastArrival,
        events,
        self: JSON.parse(`{${extra.slice(1)}}`),
        time: sim.time,
        tick: sim.tickCount,
      });
    }
    while (queue.length && queue[0].at <= time) {
      const d = queue.shift()!;
      for (const event of d.events) client.route(event);
      client.applyQuestSelfSnapshot(d.self, d.time, d.tick);
    }
    const c = client.turretClock;
    if (c === null) continue;
    const display = clock.sample(c, time);
    if (time >= WARMUP_SECONDS && Number.isFinite(prior)) {
      const advance = display - prior;
      stats.frames++;
      stats.maxLeadTicks = Math.max(stats.maxLeadTicks, display - c);
      if (advance < 0.5 * expected) {
        stats.stallFrames++;
        streak++;
        stats.longestStallMs = Math.max(stats.longestStallMs, (streak * 1000) / FPS);
      } else streak = 0;
      if (advance > 2 * expected) {
        stats.jumpFrames++;
        stats.largestJumpTicks = Math.max(stats.largestJumpTicks, advance - expected);
      }
    }
    prior = display;
  }
  return stats;
}

describe('Fire and Fly display clock under a jittery link', () => {
  // Measured on this harness: a frame that moves the walking monsters less than half a
  // frame's worth is a stall, more than two frames' worth a jump (a march segment moves
  // them in proportion to the display tick). The fixed cap stalled whenever a snapshot
  // came a quarter tick later than the earliest ones; the learned late lead covers the
  // link's jitter, and the jumps left are the earliest-arrival phase catching up.
  it.each([
    [60, 30, { stallFrames: 344, jumpFrames: 200 }, { jumpFrames: 2 }],
    [150, 30, { stallFrames: 177, jumpFrames: 177 }, { jumpFrames: 0 }],
    [150, 75, { stallFrames: 1162, jumpFrames: 401 }, { jumpFrames: 3 }],
  ])(
    'never stalls the walkers at %i ms plus or minus %i ms',
    (delayMs, jitterMs, fixed, learned) => {
      const before = runLink(delayMs, jitterMs, new TurretDisplayClock(0));
      expect(before.frames).toBe(FPS * (SECONDS - WARMUP_SECONDS));
      expect(before.stallFrames).toBe(fixed.stallFrames);
      expect(before.jumpFrames).toBe(fixed.jumpFrames);
      expect(before.maxLeadTicks).toBe(TURRET_TICK_LEAD_MAX);

      const after = runLink(delayMs, jitterMs, new TurretDisplayClock());
      expect(after.stallFrames).toBe(0);
      expect(after.jumpFrames).toBe(learned.jumpFrames);
      expect(after.largestJumpTicks).toBeLessThan(0.65);
      expect(after.maxLeadTicks).toBeLessThanOrEqual(TURRET_TICK_LEAD_MAX + TURRET_TICK_LATE_MAX);
    },
  );

  it('keeps the lead it learned within a tick of what the jitter needs', () => {
    const tight = runLink(60, 30, new TurretDisplayClock());
    const wide = runLink(150, 75, new TurretDisplayClock());
    expect(tight.maxLeadTicks).toBeLessThan(2.1);
    expect(wide.maxLeadTicks).toBeGreaterThan(tight.maxLeadTicks + 1);
  });
});
