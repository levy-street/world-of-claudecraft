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
// GENERATED COURSES: the racing brain is SEGMENT-DRIVEN, not course-driven.
// Lord Hodric rebuilds his gauntlet every round, but always out of the same
// segment vocabulary (hodrics_course.ts), so the brain looks up the section
// under its feet and applies that segment's hand-tuned tactic to whatever
// obstacles the generator placed in it. Any seed, same competence.
//
// DETERMINISM: the racing brain (planHcBotStep) is a pure function of the
// course, time, position, and pid. Bot "skill" is a fixed hash of the pid
// (some challengers are reliably clumsy), and misjudgements pulse on a tick
// hash. NOTHING here draws from any rng stream: same seed, same race.

import { hodricsOrigin } from '../data';
import { type HcCourse, hcSectionAt } from '../hodrics_course';
import {
  HC_FIELD_SIZE,
  hcAxeHead,
  hcDrawspanX,
  hcFlailBob,
  hcLaneBoulders,
  hcPusherExt,
  hcRotorAngle,
} from '../hodrics_layout';
import type { Sim } from '../sim';
import { angleTo, emptyMoveInput, type PlayerClass, TICK_RATE } from '../types';
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
  // The human is queued alongside the bots (startHcPractice) but was never
  // released here: toggling off before matchmaking has run (zero ticks
  // elapsed) left the player stuck in ctx.hcQueue forever. A match, once
  // formed, still gets torn down below via the bots' shared HcMatch.
  hodricsMod.hcQueueLeave(sim.ctx, sim.primaryId);
  const myMatch = sim.hcMatches.get(sim.primaryId);
  if (myMatch) hodricsMod.returnFromHcMatch(sim.ctx, myMatch);
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
  // The eliminated idle in the gallery, politely applauding.
  if (racer.eliminatedRound > 0) {
    e.facing = Math.PI / 2;
    return;
  }
  if (match.state === 'countdown') {
    e.facing = 0; // eyes on the course
    return;
  }
  if (match.state !== 'active') return;
  if (!e.onGround) return; // airborne is ballistic; there is no air control
  const origin = hodricsOrigin(match.slot);
  const plan = planHcBotStep(
    match.course,
    e.pos.x - origin.x,
    e.pos.z - origin.z,
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
 * The racing brain: from the round's course, an instance-local position and
 * the course clock, pick the next steering target, or null to hold position.
 * Pure and rng-free (the only "personality" is the pid hash), so it is
 * unit-testable and identical on every host.
 */
export function planHcBotStep(
  course: HcCourse,
  lx: number,
  lz: number,
  t: number,
  pid: number,
  tick: number,
): HcBotPlan | null {
  const clumsy = botMisjudges(pid, tick);
  const span = hcSectionAt(course, lz);
  const inSpan = <T extends { z?: number; cz?: number; zCenter?: number }>(defs: readonly T[]) =>
    defs.filter((d) => {
      const z = d.z ?? d.cz ?? d.zCenter ?? 0;
      return z >= span.z0 - 0.5 && z <= span.z1 + 0.5;
    });

  if (span.id === 'start_yard' || span.id === 'landing') {
    // Funnel toward the next section's mouth.
    return { x: lx * 0.3, z: span.z1 + 1.5 };
  }

  if (span.id === 'hammer_bridge') {
    const flails = inSpan(course.flails).sort((a, b) => a.z - b.z);
    const next = flails.find((f) => f.z > lz - 0.5 && f.z - lz < 6.5);
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

  if (span.id === 'rotor_court') {
    // Serpentine line: enter the gate, pass each rotor on the side opposite
    // its hub offset, exit the far gate. The chain is monotone in z and the
    // target is always the first waypoint still AHEAD, so a knockback simply
    // re-enters the chain at the right stage and nothing ever deadlocks.
    const rotors = inSpan(course.rotors).sort((a, b) => a.cz - b.cz);
    const waypoints: HcBotPlan[] = [{ x: 0, z: span.z0 + 2 }];
    for (const r of rotors) {
      waypoints.push({ x: -Math.sign(r.cx || 1) * 9.5, z: r.cz });
    }
    waypoints.push({ x: 0, z: span.z1 - 2 }, { x: 0, z: span.z1 + 2 });
    let target: HcBotPlan = waypoints[waypoints.length - 1];
    for (const w of waypoints) {
      if (w.z >= lz + 1.2) {
        target = w;
        break;
      }
    }
    for (const r of rotors) {
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

  if (span.id === 'axe_walk') {
    const axes = inSpan(course.axes).sort((a, b) => a.z - b.z);
    const next = axes.find((a) => a.z > lz - 0.5 && a.z - lz < 8.5);
    if (!next) return { x: 0, z: lz + 8 };
    const arrival = t + Math.max(0, next.z - lz) / BOT_APPROACH;
    const head = hcAxeHead(next, arrival);
    if (!clumsy && Math.abs(head.x) < 2.4 && next.z - lz < 4) return null; // blade owns the walk
    return { x: 0, z: next.z + 2.5 };
  }

  if (span.id === 'drawspan') {
    const decks = inSpan(course.drawspans).sort((a, b) => a.zCenter - b.zCenter);
    if (decks.length === 0) return { x: 0, z: span.z1 + 2 };
    const first = decks[0];
    const lip = span.z0 - 0.6;
    if (lz < lip) {
      // Wait at the lip; step on when the first deck slides under the middle.
      const px = hcDrawspanX(first, t);
      if (Math.abs(px - lx) < 2.0 && Math.abs(px) < 2.6) return { x: px, z: span.z0 + 2 };
      return Math.abs(lx) > 0.8 ? { x: 0, z: lip - 0.8 } : null;
    }
    // Which deck (or seam) are we at?
    for (let i = 0; i < decks.length; i++) {
      const d = decks[i];
      const seam = d.zCenter + d.halfZ;
      if (lz < seam - 1.4) {
        // Riding deck i: creep to its north edge while being carried.
        return { x: lx, z: seam - 1.1 };
      }
      if (lz < seam + 0.9 && i + 1 < decks.length) {
        // At the seam: cross only while this deck and the next align.
        const px = hcDrawspanX(d, t);
        const pn = hcDrawspanX(decks[i + 1], t);
        if (Math.abs(pn - lx) < 2.4 && Math.abs(px - lx) < 2.6) {
          return { x: lx * 0.3, z: seam + 2.5 };
        }
        return null;
      }
    }
    // Past the last deck: roll off north onto the landing.
    return { x: lx * 0.5, z: span.z1 + 2 };
  }

  if (span.id === 'boulder_climb') {
    const lanes = inSpan(course.boulderLanes.map((l) => ({ ...l, z: (l.zTop + l.zEnd) / 2 })));
    if (lanes.length === 0) return { x: 0, z: span.z1 + 2 };
    let best = lanes[0];
    let bestScore = -Infinity;
    for (const lane of lanes) {
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

  if (span.id === 'piston_ledge') {
    const rams = inSpan(course.pushers).sort((a, b) => a.z - b.z);
    const next = rams.find((p) => p.z > lz - 0.8 && p.z - lz < 5.5);
    if (!next) return { x: 0, z: lz + 7 };
    const arrival = t + Math.max(0, next.z - lz) / BOT_APPROACH;
    const extNow = hcPusherExt(next, t);
    const extThen = hcPusherExt(next, arrival);
    if (!clumsy && (extThen > 0.3 || extNow > 0.55) && next.z - lz < 4.5) {
      // The ram owns the ledge when we would arrive: hold short of it.
      return next.z - lz > 3 ? { x: 0, z: lz + 0.8 } : null;
    }
    return { x: 0, z: next.z + 2.4 };
  }

  if (span.id === 'spinner_court') {
    const discs = inSpan(course.spinners).sort((a, b) => a.cz - b.cz);
    // Targets: each disc hub in order, then the exit tongue.
    const targets: HcBotPlan[] = discs.map((d) => ({ x: d.cx, z: d.cz }));
    targets.push({ x: 0, z: span.z1 - 1.5 }, { x: 0, z: span.z1 + 2 });
    let target: HcBotPlan = targets[targets.length - 1];
    for (const w of targets) {
      if (w.z >= lz + 1.6) {
        target = w;
        break;
      }
    }
    // Hop the rim gap: when near the current disc's far edge with the target
    // beyond it, jump so the seam cannot eat the step.
    for (const d of discs) {
      const rel = Math.hypot(lx - d.cx, lz - d.cz);
      if (rel <= d.r && rel > d.r - 1.6 && target.z > d.cz + d.r - 1) {
        return { ...target, jump: true };
      }
    }
    return target;
  }

  // Red Ascent and the keep: straight to the crown.
  return { x: 0, z: course.finishZ + 5 };
}
