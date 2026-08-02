// The rift course RUNTIME: everything that happens once bodies are on the
// decks. The kernel (src/sim/course/) answers "what is where at clock t";
// this module walks the players every tick and makes the mechanics bite:
// crumble arming, geyser launches, ferry carries, conveyor drift, boost
// pads, hazard damage and shove, gem pickup, brazier checkpoints, collapse
// chases, crate fuses, and the rope integration.
//
// Region registry: the same shape as the collider registry in colliders.ts
// (setRiftRegion), keyed by the SAME per-Sim collision token plus the floor
// origin, so two same-seed Sims in one process stay isolated and the
// movement kernel's support hook can resolve a position to a course with no
// SimContext in hand. Registered by spawnRiftFloor beside the colliders,
// cleared with them.
//
// Determinism: zero rng in every branch. Damage amounts are fixed per
// hazard, cadenced on tickCount; everything else is registry writes and
// closed-form reads. Appending this phase to the tick tail cannot fork the
// shared draw order.

import {
  armCourseChase,
  armCourseCrumble,
  type CoursePlan,
  type CourseStand,
  collectCourseGem,
  courseCheckpointFor,
  courseClockNow,
  coursePadAt,
  courseSupportAt,
  deferCourseCrumbleRehang,
  dutyActive,
  ferryPos,
  hazardActive,
  hazardPos,
  lightCourseCheckpoint,
  resetCourseStateFor,
  stepCourseRopes,
  sweeperFrame,
} from '../course';
import {
  DUNGEON_FLOOR_Y,
  RIFT_REGION_HALF_X,
  RIFT_REGION_HALF_Z,
  riftInstanceOrigin,
} from '../data';
import type { SimContext } from '../sim_context';
import { DT, dist2d, type Entity } from '../types';
import { generateRiftFloor } from './rift_gen';

/** THE instance key for a course floor, everywhere: sim registries, wire
 *  event mirrors, and the renderer must all build it through this one
 *  function or they silently disagree. */
export function courseInstKey(ox: number, oz: number): string {
  return `${ox}:${oz}`;
}

interface CourseRegion {
  ox: number;
  oz: number;
  plan: CoursePlan;
  instKey: string;
}

const COURSE_REGIONS = new Map<number, CourseRegion[]>();

/** Publish a floor's course beside its colliders. Idempotent per origin. */
export function setRiftCourseRegion(token: number, ox: number, oz: number, plan: CoursePlan): void {
  let list = COURSE_REGIONS.get(token);
  if (!list) {
    list = [];
    COURSE_REGIONS.set(token, list);
  }
  const i = list.findIndex((r) => r.ox === ox && r.oz === oz);
  const region = { ox, oz, plan, instKey: courseInstKey(ox, oz) };
  if (i >= 0) list[i] = region;
  else list.push(region);
}

/** Clear a floor's course and its runtime state (crumble arms, checkpoints,
 *  gems, ropes): a freed slot must hand the next run a factory-new course. */
export function clearRiftCourseRegion(token: number, ox: number, oz: number): void {
  const list = COURSE_REGIONS.get(token);
  if (!list) return;
  const i = list.findIndex((r) => r.ox === ox && r.oz === oz);
  if (i >= 0) {
    resetCourseStateFor(list[i].instKey);
    list.splice(i, 1);
  }
}

/** The course region containing a world position, or null. */
export function riftCourseRegionAt(token: number, x: number, z: number): CourseRegion | null {
  const list = COURSE_REGIONS.get(token);
  if (!list) return null;
  for (const r of list) {
    if (Math.abs(x - r.ox) <= RIFT_REGION_HALF_X && Math.abs(z - r.oz) <= RIFT_REGION_HALF_Z) {
      return r;
    }
  }
  return null;
}

/**
 * The movement kernel's course-support hook: the highest solid deck top at a
 * world position within reach, in WORLD Y, or -Infinity. Bound into
 * PlayerMotionDeps by the live Sim; the online client binds nothing (rift
 * self-prediction is off) and the renderer never calls this (it reads plans
 * directly).
 */
export function riftCourseSupportY(token: number, x: number, z: number, maxY: number): number {
  const region = riftCourseRegionAt(token, x, z);
  if (!region) return Number.NEGATIVE_INFINITY;
  const stand = courseSupportAt(
    region.plan,
    region.instKey,
    x - region.ox,
    z - region.oz,
    courseClockNow(),
    maxY - DUNGEON_FLOOR_Y,
  );
  return stand ? DUNGEON_FLOOR_Y + stand.top : Number.NEGATIVE_INFINITY;
}

/** Test/suite seam: drop every registered course region. */
export function resetRiftCourseRegions(): void {
  COURSE_REGIONS.clear();
}

// Feature tuning. GEYSER_LAUNCH_VY matches the Blackspan bellows (apex ~3.4),
// enough to clear a 1.4 to 1.9 rise with room to steer.
export const GEYSER_LAUNCH_VY = 10.5;
const HAZARD_BAND_Y = 2.4;
const GEM_REACH = 1.7;
const BRAZIER_REACH = 2.2;
const CRATE_TNT_REACH = 1.6;
const CRATE_NITRO_REACH = 1.4;
const CRATE_FUSE_SECONDS = 3;
const CRATE_BLAST_R = 3.2;
const BOOST_AURA_SECONDS = 4;
const BOOST_SPEED = 1.3;
const BOOST_JUMP = 1.25;

const scratchBodies: Array<{ x: number; z: number; y: number; vx: number; vz: number }> = [];

/**
 * The per-tick course phase. Runs in the rift end-of-tick block. Walks every
 * claimed course instance's members once; every branch below is rng-free.
 */
export function updateRiftCourses(ctx: SimContext): void {
  const t = courseClockNow();
  const cadence = ctx.tickCount % 10 === 0;
  for (const inst of ctx.riftInstances) {
    if (inst.partyKey === null) continue;
    const floor = generateRiftFloor(inst.seed, inst.baseLevel, inst.floorIndex, inst.upgrade);
    const course = floor.course;
    if (!course) continue;
    const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
    const instKey = courseInstKey(origin.x, origin.z);
    scratchBodies.length = 0;

    for (const pid of inst.memberIds) {
      const p = ctx.entities.get(pid);
      if (!p || p.dead) continue;
      // In THIS floor's region box (a member idling at the overworld portal
      // or on another floor must not load the ropes or trip the features).
      if (
        Math.abs(p.pos.x - origin.x) > RIFT_REGION_HALF_X ||
        Math.abs(p.pos.z - origin.z) > RIFT_REGION_HALF_Z
      ) {
        continue;
      }
      const lx = p.pos.x - origin.x;
      const lz = p.pos.z - origin.z;
      const ly = p.pos.y - DUNGEON_FLOOR_Y;
      scratchBodies.push({ x: lx, z: lz, y: ly, vx: p.vx, vz: p.vz });

      // What the body stands on, exact at the feet.
      const stand: CourseStand | null = p.onGround
        ? courseSupportAt(course, instKey, lx, lz, t, ly + 0.1)
        : null;
      const standing = stand !== null && Math.abs(DUNGEON_FLOOR_Y + stand.top - p.pos.y) < 0.3;

      if (standing && stand) {
        const deck = stand.deck;
        if (deck.kind === 'crumble' && deck.crumble && stand.index >= 0) {
          if (armCourseCrumble(instKey, stand.index, ctx.time)) {
            ctx.emit({
              type: 'riftDeckState',
              ox: origin.x,
              oz: origin.z,
              deck: stand.index,
              at: ctx.time,
            });
          }
        } else if (deck.kind === 'geyser' && deck.window && dutyActive(deck.window, t)) {
          // The eruption throws the body. Purely clock-driven, so the client
          // renders the same jet from its own clock: no event needed.
          p.vy = GEYSER_LAUNCH_VY;
          p.onGround = false;
          p.jumping = true;
          p.fallStartY = p.pos.y;
        } else if (deck.kind === 'ferry' && deck.track) {
          // Carry the rider: the deck moved pos(t) - pos(t - DT) this tick.
          const now = ferryPos(deck.x, deck.z, deck.track, t);
          const was = ferryPos(deck.x, deck.z, deck.track, t - DT);
          p.pos.x += now.x - was.x;
          p.pos.z += now.z - was.z;
          p.prevPos.x += now.x - was.x;
          p.prevPos.z += now.z - was.z;
        }

        // Pads act on grounded bodies only.
        const pad = coursePadAt(course, lx, lz, ly);
        if (pad?.kind === 'conveyor') {
          const drift = (pad.strength ?? 2.4) * DT;
          p.pos.x += (pad.dirX ?? 0) * drift;
          p.pos.z += (pad.dirZ ?? 0) * drift;
        } else if (pad?.kind === 'boost') {
          ctx.applyAura(p, {
            id: 'rift_course_boost',
            name: 'Rift Surge',
            kind: 'buff_speed',
            remaining: BOOST_AURA_SECONDS,
            duration: BOOST_AURA_SECONDS,
            value: BOOST_SPEED,
            sourceId: p.id,
            school: 'arcane',
          });
          ctx.applyAura(p, {
            id: 'rift_course_boost_jump',
            name: 'Rift Surge',
            kind: 'buff_jump',
            remaining: BOOST_AURA_SECONDS,
            duration: BOOST_AURA_SECONDS,
            value: BOOST_JUMP,
            sourceId: p.id,
            school: 'arcane',
          });
        }

        // Chase triggers arm on their trigger deck.
        for (const chase of course.chases) {
          if (
            dist2d(p.pos, { x: origin.x + chase.triggerX, y: 0, z: origin.z + chase.triggerZ }) >
            chase.triggerR
          ) {
            continue;
          }
          if (Math.abs(ly - (course.decks[chase.deckIndices[0]]?.y ?? ly)) > 1.2) continue;
          if (
            armCourseChase(instKey, chase.deckIndices, chase.spacings, chase.waveSpeed, ctx.time)
          ) {
            for (let i = 0; i < chase.deckIndices.length; i++) {
              ctx.emit({
                type: 'riftDeckState',
                ox: origin.x,
                oz: origin.z,
                deck: chase.deckIndices[i],
                at: ctx.time + chase.spacings[i] / Math.max(0.5, chase.waveSpeed),
              });
            }
          }
        }
      }

      // A falling body under a gone crumble deck defers its re-hang, so the
      // deck never re-appears inside them mid-fall.
      if (!p.onGround) {
        for (let i = 0; i < course.decks.length; i++) {
          const d = course.decks[i];
          if (d.kind !== 'crumble' || !d.crumble) continue;
          if (Math.abs(lx - d.x) > d.hw + 0.6 || Math.abs(lz - d.z) > d.hd + 0.6) continue;
          if (ly < d.y - 0.3) deferCourseCrumbleRehang(d.crumble, instKey, i, ctx.time);
        }
      }

      // Gems and braziers: personal progress, within reach of the body.
      for (let g = 0; g < course.gems.length; g++) {
        const gem = course.gems[g];
        if (Math.abs(ly - gem.y) > 2) continue;
        if (Math.abs(lx - gem.x) > GEM_REACH || Math.abs(lz - gem.z) > GEM_REACH) continue;
        if (collectCourseGem(instKey, pid, g)) {
          ctx.emit({
            type: 'riftCourseMark',
            pid,
            ox: origin.x,
            oz: origin.z,
            kind: 'gem',
            index: g,
          });
          ctx.notice(pid, 'A rift gem hums in your grasp.');
        }
      }
      for (const b of course.braziers) {
        if (Math.abs(ly - b.y) > 2) continue;
        if (Math.abs(lx - b.x) > BRAZIER_REACH || Math.abs(lz - b.z) > BRAZIER_REACH) continue;
        if (lightCourseCheckpoint(instKey, pid, b.index)) {
          ctx.emit({
            type: 'riftCourseMark',
            pid,
            ox: origin.x,
            oz: origin.z,
            kind: 'brazier',
            index: b.index,
          });
          ctx.notice(pid, 'The waybrazier takes your flame.');
        }
      }

      // Hazards: damage on the half-second cadence, shove every contact tick.
      for (const h of course.hazards) {
        if (Math.abs(ly - h.y) > HAZARD_BAND_Y) continue;
        if (!hazardActive(h, t)) continue;
        if (h.kind === 'spikes' || h.kind === 'darts') {
          if (!cadence) continue;
          if (Math.abs(lx - h.x) > (h.hw ?? 1) || Math.abs(lz - h.z) > (h.hd ?? 1)) continue;
          ctx.dealDamage(
            null,
            p,
            h.damage,
            false,
            'physical',
            h.kind === 'spikes' ? 'Spike Bed' : 'Dart Battery',
            'hit',
            true,
          );
        } else if (h.kind === 'sweeper') {
          const frame = sweeperFrame(h, t, lx, lz);
          const r = h.r ?? 0.8;
          if (frame.along < -0.5 || frame.along > (h.len ?? 4) + 0.3) continue;
          if (Math.abs(frame.perp) > r + 0.55) continue;
          shove(p, frame.perp >= 0 ? 1 : -1, h, t);
          if (cadence) {
            ctx.dealDamage(null, p, h.damage, false, 'physical', 'Grinding Arm', 'hit', true);
          }
        } else {
          const pos = hazardPos(h, t);
          const r = h.r ?? 1.5;
          const dx = lx - pos.x;
          const dz = lz - pos.z;
          if (dx * dx + dz * dz > (r + 0.55) * (r + 0.55)) continue;
          shoveAlong(p, h, dx, dz);
          if (cadence) {
            ctx.dealDamage(
              null,
              p,
              h.damage,
              false,
              'physical',
              h.kind === 'blade' ? 'Sweeping Blade' : 'Rolling Mass',
              'hit',
              true,
            );
          }
        }
      }
    }

    // The ropes: one integration per instance per tick, loaded by everyone
    // inside the region this tick.
    if (course.ropes.length > 0) {
      stepCourseRopes(course.ropes, instKey, scratchBodies, DT);
    }
  }
}

/** Knockback perpendicular to a sweeper beam, on the body's side of it. */
function shove(
  p: Entity,
  sign: number,
  h: { period: number; phase: number; shove?: number },
  t: number,
): void {
  const a = 2 * Math.PI * (t / h.period + h.phase);
  const push = h.shove ?? 8;
  // The beam's perpendicular: rotate the beam direction a quarter turn.
  p.vx = Math.cos(a) * push * sign;
  p.vz = -Math.sin(a) * push * sign;
  if (p.onGround) {
    p.vy = 4.2;
    p.onGround = false;
    p.jumping = true;
    p.fallStartY = p.pos.y;
  }
}

/** Knockback away from a path hazard's centre. */
function shoveAlong(p: Entity, h: { shove?: number }, dx: number, dz: number): void {
  const d = Math.hypot(dx, dz) || 1;
  const push = h.shove ?? 8;
  p.vx = (dx / d) * push;
  p.vz = (dz / d) * push;
  if (p.onGround) {
    p.vy = 4.2;
    p.onGround = false;
    p.jumping = true;
    p.fallStartY = p.pos.y;
  }
}

/** Where a fresh arrival on this floor stands: the highest brazier this
 *  player lit, or the floor entry. Personal, forward-only. */
export function courseArrivalFor(
  plan: CoursePlan,
  instKey: string,
  pid: number,
): { x: number; z: number; y: number } | null {
  const lit = courseCheckpointFor(instKey, pid);
  if (lit === null) return null;
  const b = plan.braziers.find((br) => br.index === lit);
  return b ? { x: b.x, z: b.z, y: b.y } : null;
}
