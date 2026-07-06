// Hodric's Castle practice + backfill bots. Two harnesses over one driver:
//
// - PRACTICE (offline): spawns a full field of court challengers around the
//   player and queues everyone, so a race starts immediately, the fiesta_bots
//   pattern. The offline loop owns start/stop via the IWorld practice hook.
// - BACKFILL (all hosts): once the oldest queued human has waited
//   HC_BOT_BACKFILL_WAIT, tops the queue up to a full field so a race always
//   starts. Fill bots are removed once their race returns.
//
// Driven INSIDE the sim tick (Sim.updateHodrics runs the match module first,
// THEN updateHcBots: a bot must decide on the post-physics truth of the tick,
// or a platform rider looks permanently airborne to its own brain), so bots
// behave identically offline, on the server, and headless. Like fiesta_bots
// this reaches Sim internals directly (addPlayer / removePlayer / entity
// steering), so it takes `Sim`, not the ctx seam.
//
// DETERMINISM: the racing brain (planHcBotStep) is a pure function of course
// time, position, and pid. Bot "skill" is a fixed hash of the pid (some
// challengers are reliably clumsy), and misjudgements pulse on a tick hash.
// NOTHING here draws from any rng stream: same seed, same race, every time.

import { hodricsOrigin } from '../data';
import {
  HC_AXES,
  HC_BOULDER_LANES,
  HC_DRAWSPANS,
  HC_FIELD_SIZE,
  HC_FLAILS,
  HC_ROTORS,
  hcAxeHead,
  hcDrawspanX,
  hcFlailBob,
  hcLaneBoulders,
  hcRotorAngle,
  hcSectionAt,
} from '../hodrics_layout';
import type { Sim } from '../sim';
import { angleTo, DT, emptyMoveInput, type PlayerClass, TICK_RATE } from '../types';
import * as hodricsMod from './hodrics';

// Lord Hodric's court challengers: the pool both harnesses draw names from.
const HC_BOT_NAMES: readonly string[] = [
  'Poddy the Page',
  'Sir Bumblewick',
  'Old Meg',
  'Tam of the Vale',
  'Brenna Quickstep',
  'Harl the Round',
  'Wat Thistledown',
  'Goodwife Ida',
  'Fenwick',
  'Marn the Lesser',
  'Dulcie Fairfoot',
  'Cobb',
];

const HC_BOT_CLASSES: readonly PlayerClass[] = [
  'warrior',
  'rogue',
  'mage',
  'paladin',
  'hunter',
  'priest',
  'shaman',
  'warlock',
  'druid',
];

// Fixed per-challenger clumsiness in 0..0.35: the fraction of gate decisions
// this bot misjudges. A pure pid hash, so a given challenger races with the
// same temperament every match on every host.
export function botClumsiness(pid: number): number {
  return ((((pid * 2654435761) >>> 9) & 255) / 255) * 0.35;
}

// Deterministic misjudgement pulse: true for roughly `clumsiness` of the
// ~0.8s decision windows. Tick-hashed, zero rng.
export function botMisjudges(pid: number, tick: number): boolean {
  const h = ((((pid * 40503 + (tick >> 4) * 2654435761) >>> 7) & 1023) / 1023) as number;
  return h < botClumsiness(pid);
}

function liveBotNames(sim: Sim): Set<string> {
  const used = new Set<string>();
  for (const pid of [...sim.hcPracticeBotPids, ...sim.hcFillBotPids]) {
    const meta = sim.players.get(pid);
    if (meta) used.add(meta.name);
  }
  return used;
}

function spawnHcBot(sim: Sim, near: { x: number; z: number }, index: number): number | null {
  const used = liveBotNames(sim);
  const name = HC_BOT_NAMES.find((n) => !used.has(n)) ?? `Challenger ${index + 1}`;
  const cls = HC_BOT_CLASSES[index % HC_BOT_CLASSES.length];
  const pid = sim.addPlayer(cls, name);
  const meta = sim.players.get(pid);
  const e = sim.entities.get(pid);
  if (!meta || !e) return null;
  meta.isHcBot = true;
  const ang = (index / HC_FIELD_SIZE) * Math.PI * 2;
  e.pos = sim.groundPos(near.x + Math.sin(ang) * 3.5, near.z + Math.cos(ang) * 3.5);
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
  return pid;
}

// ---------------------------------------------------------------------------
// Practice (offline)
// ---------------------------------------------------------------------------

export function hcPracticeActive(sim: Sim): boolean {
  return sim.hcPracticeBotPids.some((pid) => sim.entities.has(pid));
}

/** Toggle a practice race: spawn and queue a full field, or tear it down. */
export function startHcPractice(sim: Sim): boolean {
  const me = sim.entities.get(sim.primaryId);
  if (!me) return false;
  if (hcPracticeActive(sim)) {
    stopHcPractice(sim);
    return false;
  }
  if (sim.hcMatches.has(sim.primaryId)) return false;
  if (me.pos.x > 600) return false; // queue from the overworld, like every queue
  sim.hcPracticeBotPids = [];
  for (let i = 0; i < HC_FIELD_SIZE - 1; i++) {
    const pid = spawnHcBot(sim, me.pos, i);
    if (pid !== null) sim.hcPracticeBotPids.push(pid);
  }
  hodricsMod.hcQueueJoin(sim.ctx, sim.primaryId);
  for (const pid of sim.hcPracticeBotPids) hodricsMod.hcQueueJoin(sim.ctx, pid);
  return true;
}

export function stopHcPractice(sim: Sim): void {
  for (const pid of sim.hcPracticeBotPids) {
    hodricsMod.hcQueueLeave(sim.ctx, pid);
    const match = sim.hcMatches.get(pid);
    if (match) hodricsMod.returnFromHcMatch(sim.ctx, match);
    if (sim.entities.has(pid)) sim.removePlayer(pid);
  }
  sim.hcPracticeBotPids = [];
}

// ---------------------------------------------------------------------------
// Backfill (all hosts)
// ---------------------------------------------------------------------------

function tryHcBackfill(sim: Sim): void {
  if (sim.hcQueue.length === 0 || sim.hcQueue.length >= HC_FIELD_SIZE) return;
  const humanUnit = sim.hcQueue.find((u) => sim.players.get(u.pid)?.isHcBot !== true);
  if (!humanUnit) return;
  if ((sim.tickCount - humanUnit.joinedAtTick) / TICK_RATE < hodricsMod.HC_BOT_BACKFILL_WAIT) {
    return;
  }
  if (hodricsMod.freeHcSlot(sim.ctx) === null) return;
  const anchor = sim.entities.get(humanUnit.pid);
  if (!anchor) return;
  const need = HC_FIELD_SIZE - sim.hcQueue.length;
  for (let i = 0; i < need; i++) {
    const pid = spawnHcBot(sim, anchor.pos, i);
    if (pid === null) continue;
    sim.hcFillBotPids.push(pid);
    hodricsMod.hcQueueJoin(sim.ctx, pid);
  }
}

// ---------------------------------------------------------------------------
// Per-tick driver
// ---------------------------------------------------------------------------

/** Called from Sim.updateHodrics() each tick, after the match module. */
export function updateHcBots(sim: Sim): void {
  if (sim.hcQueue.length > 0) tryHcBackfill(sim);
  if (sim.hcPracticeBotPids.length === 0 && sim.hcFillBotPids.length === 0) return;
  sim.hcPracticeBotPids = sim.hcPracticeBotPids.filter((pid) => sim.entities.has(pid));
  sim.hcFillBotPids = sim.hcFillBotPids.filter((pid) => {
    if (!sim.entities.has(pid)) return false;
    // A fill bot with no race left to run goes home to the void.
    if (!sim.hcMatches.has(pid) && !hodricsMod.hcIsQueued(sim.ctx, pid)) {
      sim.removePlayer(pid);
      return false;
    }
    return true;
  });
  for (const pid of sim.hcPracticeBotPids) driveHcBot(sim, pid);
  for (const pid of sim.hcFillBotPids) driveHcBot(sim, pid);
}

function driveHcBot(sim: Sim, pid: number): void {
  const e = sim.entities.get(pid);
  const meta = sim.players.get(pid);
  if (!e || !meta) return;
  meta.moveInput = emptyMoveInput();
  const match = sim.hcMatches.get(pid);
  if (!match) return;
  const racer = match.racers.get(pid);
  if (!racer || racer.finished || racer.left) return;
  if (match.state === 'countdown') {
    e.facing = 0; // eyes on the bridge
    return;
  }
  if (match.state !== 'active') return;
  if (!e.onGround) return; // airborne is ballistic; there is no air control
  const origin = hodricsOrigin(match.slot);
  const plan = planHcBotStep(
    e.pos.x - origin.x,
    e.pos.z - origin.z,
    e.pos.y,
    sim.time,
    pid,
    sim.tickCount,
  );
  if (!plan) return; // deliberate hold: waiting out an obstacle window
  e.facing = angleTo(e.pos, { x: origin.x + plan.x, y: e.pos.y, z: origin.z + plan.z });
  meta.moveInput.forward = true;
  if (plan.jump) meta.moveInput.jump = true;
}

export interface HcBotPlan {
  x: number; // instance-local steering target
  z: number;
  jump?: boolean;
}

// Approach speed used to predict obstacle poses at arrival: a touch under
// RUN_SPEED so predictions err on the cautious side.
const BOT_APPROACH = 6.5;

/**
 * The racing brain: from an instance-local position and the course clock,
 * pick the next steering target, or null to hold position. Pure and rng-free
 * (the only "personality" is the pid hash), so it is unit-testable and
 * identical on every host.
 */
export function planHcBotStep(
  lx: number,
  lz: number,
  y: number,
  t: number,
  pid: number,
  tick: number,
): HcBotPlan | null {
  const clumsy = botMisjudges(pid, tick);
  const section = hcSectionAt(lz);

  if (section === 'start_yard') {
    // Funnel toward the bridge mouth.
    return { x: lx * 0.3, z: -80 };
  }

  if (section === 'flail_bridge') {
    const next = HC_FLAILS.find((f) => f.z > lz - 0.5 && f.z - lz < 6.5);
    if (!next) return { x: 0, z: lz + 8 };
    const arrival = t + Math.max(0, next.z - lz) / BOT_APPROACH;
    const bob = hcFlailBob(next, arrival);
    const hugX = -Math.sign(bob.x || 1) * 2.6;
    if (!clumsy && Math.abs(bob.x) < 2.1 && next.z - lz < 4.5) {
      // The bob will own the middle when we would arrive: hover short of it.
      return next.z - lz > 3.2 ? { x: hugX, z: lz + 1 } : null;
    }
    return { x: hugX, z: next.z + 2.5 };
  }

  if (section === 'log_court') {
    // Serpentine line through the plaza: in the gate, up the right corridor
    // (clear of rotor 1), cross the middle, down the left corridor (clear of
    // rotor 2), out the far gate. The chain is monotone in z and the target is
    // always the first waypoint still AHEAD, so a knockback simply re-enters
    // the chain at the right stage and nothing ever deadlocks on a waypoint.
    const WAYPOINTS = [
      { x: 0, z: -32 },
      { x: 10, z: -27 },
      { x: 10, z: -15 },
      { x: -9, z: -8 },
      { x: -9, z: 3 },
      { x: 0, z: 11 },
      { x: 0, z: 18 },
    ];
    let target: HcBotPlan = WAYPOINTS[WAYPOINTS.length - 1];
    for (const w of WAYPOINTS) {
      if (w.z >= lz + 1.2) {
        target = w;
        break;
      }
    }
    for (const r of HC_ROTORS) {
      const relX = lx - r.cx;
      const relZ = lz - r.cz;
      const d = Math.hypot(relX, relZ);
      if (d > r.r + 1.2 || d < 0.001) continue;
      // The log is a double arm: danger repeats every half turn. Time until
      // the beam sweeps our bearing, along its actual spin direction.
      const beam = hcRotorAngle(r, t);
      const bearing = Math.atan2(relZ, relX);
      const gap = (((bearing - beam) % Math.PI) + Math.PI) % Math.PI;
      const timeToSweep = (r.omega > 0 ? gap : Math.PI - gap) / Math.abs(r.omega);
      if (timeToSweep < 0.45 && !clumsy) {
        // Step outward, off the sweep circle.
        return { x: lx + (relX / d) * 3, z: lz + (relZ / d) * 3 };
      }
    }
    return target;
  }

  if (section === 'axe_walk') {
    const next = HC_AXES.find((a) => a.z > lz - 0.5 && a.z - lz < 8.5);
    if (!next) return { x: 0, z: lz + 8 };
    const arrival = t + Math.max(0, next.z - lz) / BOT_APPROACH;
    const head = hcAxeHead(next, arrival);
    if (!clumsy && Math.abs(head.x) < 2.4 && next.z - lz < 4) return null; // blade owns the walk
    return { x: 0, z: next.z + 2.5 };
  }

  if (section === 'drawspan') {
    const [a, b] = HC_DRAWSPANS;
    const pxA = hcDrawspanX(a, t);
    const pxB = hcDrawspanX(b, t);
    if (lz < 57.4) {
      // Wait at the lip; step on when platform A slides under the middle.
      if (Math.abs(pxA - lx) < 2.0 && Math.abs(pxA) < 2.6) return { x: pxA, z: 60 };
      return Math.abs(lx) > 0.8 ? { x: 0, z: 56.6 } : null;
    }
    if (lz < 66.6) {
      // Riding A: creep to the north edge while being carried.
      return { x: lx, z: 66.9 };
    }
    if (lz < 67.9) {
      // At the seam: cross only while the pair meets in the middle.
      if (Math.abs(pxB - lx) < 2.4 && Math.abs(pxA - lx) < 2.6) return { x: lx * 0.3, z: 70.5 };
      return null;
    }
    // Riding B: roll off north onto the far landing (always safe, they tile).
    return { x: lx * 0.5, z: 80 };
  }

  if (section === 'boulder_alley') {
    let best = HC_BOULDER_LANES[0];
    let bestScore = -Infinity;
    for (const lane of HC_BOULDER_LANES) {
      let gap = 60;
      for (const boulder of hcLaneBoulders(lane, t)) {
        if (boulder.z > lz - 1) gap = Math.min(gap, boulder.z - lz);
      }
      const score = gap - Math.abs(lane.x - lx) * 0.4;
      if (score > bestScore) {
        bestScore = score;
        best = lane;
      }
    }
    return { x: clumsy ? lx : best.x, z: lz + 6 };
  }

  // Red Ascent and the keep: straight to the crown.
  return { x: 0, z: 125 };
}
