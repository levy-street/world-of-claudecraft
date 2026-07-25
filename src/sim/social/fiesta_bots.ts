// Session A3: 2v2 Fiesta OFFLINE/DEV practice-vs-bots harness, MOVED verbatim out
// of the Sim monolith. Spawns three AI-driven player bots, queues them with the
// local player, and steers them each tick so a full Fiesta bout plays out solo.
//
// OFFLINE ONLY. The online server never calls these (matches there are made of
// real players); the offline loop drives them from main.ts. Split out from the
// deterministic match logic (fiesta.ts) precisely BECAUSE this harness reaches
// deep into Sim internals the host-portable seam does not expose (casting,
// auto-attack, movement, player add/remove, level-set). Rather than pollute the
// shared SimContext with a dozen offline-only callbacks, these functions take the
// `Sim` directly (type-only import, so no runtime cycle); for arena queue/return
// helpers they route through the already-extracted arena module (./arena). The bot
// state (`fiestaBotPids`) stays a Sim field (the E1 "state stays on Sim" pattern),
// so the existing tests' `(sim as any).fiestaBotPids` reads resolve unchanged.
//
// Deterministic: all bot randomness flows through the SHARED `sim.rng`
// (driveFiestaBot's augment pick), never `Math.random`; the match's own augment /
// power-up draws use the per-match stream in fiesta.ts. Import-isolated (no DOM /
// Three, rng-only) so tests/architecture.test.ts still passes.

import { rangedAutoProfile } from '../combat/form_swing';
import { arenaOrigin, CLASSES, DUNGEON_X_THRESHOLD } from '../data';
import type { PlayerMeta, Sim } from '../sim';
import {
  angleTo,
  dist2d,
  type Entity,
  emptyMoveInput,
  MELEE_RANGE,
  normAngle,
  type PlayerClass,
  steadyAngleTo,
} from '../types';
import * as arenaMod from './arena';
import { FIESTA_RING_CX, FIESTA_RING_CZ } from './fiesta';

export function fiestaPracticeActive(sim: Sim): boolean {
  return sim.fiestaBotPids.some((pid) => sim.entities.has(pid));
}

// Toggle target: start a practice set (spawn + queue bots + queue you), or
// tear it down if one is already running. Returns true when a set is active
// afterward.
export function startFiestaPractice(sim: Sim): boolean {
  const me = sim.entities.get(sim.primaryId);
  const meMeta = sim.players.get(sim.primaryId);
  if (!me || !meMeta) return false;
  if (fiestaPracticeActive(sim)) {
    stopFiestaPractice(sim);
    return false;
  }
  if (me.pos.x > DUNGEON_X_THRESHOLD) return false; // must queue from the overworld

  sim.fiestaBotPids = [];
  const kit: { cls: PlayerClass; name: string }[] = [
    { cls: 'paladin', name: 'Sir Botsworth' },
    { cls: 'mage', name: 'Botzo the Arcane' },
    { cls: 'rogue', name: 'Sneakbot' },
  ];
  for (let i = 0; i < kit.length; i++) {
    const pid = sim.addPlayer(kit[i].cls, kit[i].name);
    const botMeta = sim.players.get(pid);
    if (botMeta) botMeta.isFiestaBot = true;
    const e = sim.entities.get(pid);
    if (e) {
      const ang = (i / kit.length) * Math.PI * 2;
      e.pos = sim.groundPos(me.pos.x + Math.sin(ang) * 4, me.pos.z + Math.cos(ang) * 4);
      e.prevPos = { ...e.pos };
      sim.rebucket(e);
      if (me.level > 1) sim.setPlayerLevel(me.level, pid); // a fair fight
    }
    sim.fiestaBotPids.push(pid);
  }
  fiestaPracticeRequeue(sim, true);
  return true;
}

export function stopFiestaPractice(sim: Sim): void {
  for (const pid of sim.fiestaBotPids) {
    arenaMod.arenaQueueLeave(sim.ctx, pid);
    const match = sim.arenaMatches.get(pid);
    if (match) arenaMod.returnFromArena(sim.ctx, match);
    if (sim.entities.has(pid)) sim.removePlayer(pid);
  }
  sim.fiestaBotPids = [];
  sim.fiestaBotSteer.clear();
}

// Keep idle practice participants in the queue so bouts flow back-to-back.
// `includeMe` also (re)queues the local player — used on the explicit Start
// click; the per-tick driver only tops up the bots so you can step away.
function fiestaPracticeRequeue(sim: Sim, includeMe: boolean): void {
  const ids = includeMe ? [sim.primaryId, ...sim.fiestaBotPids] : [...sim.fiestaBotPids];
  for (const pid of ids) {
    const e = sim.entities.get(pid);
    if (!e || e.dead) continue;
    if (sim.arenaMatches.has(pid) || arenaMod.isArenaQueued(sim.ctx, pid)) continue;
    if (e.pos.x > DUNGEON_X_THRESHOLD) continue;
    arenaMod.arenaQueueJoin(sim.ctx, pid, 'fiesta');
  }
}

// Called once per tick from the offline loop (before tick()): keeps the bots
// queued between bouts and steers any that are mid-fight.
export function updateFiestaBots(sim: Sim): void {
  if (sim.fiestaBotPids.length === 0) return;
  // drop any bot that no longer exists (shouldn't happen offline, but be safe)
  sim.fiestaBotPids = sim.fiestaBotPids.filter((pid) => sim.entities.has(pid));
  fiestaPracticeRequeue(sim, false);
  for (const pid of sim.fiestaBotPids) driveFiestaBot(sim, pid);
}

// Straight-at-target steering wedges on the coliseum's cover: a bot that
// re-aims at a target behind a pillar or approach screen every tick converges
// to a zero-progress equilibrium against the obstacle. Track per-bot progress
// and, when a forward-moving bot stops making any, detour perpendicular for a
// beat. Fixed-length alternating detours can limit-cycle over a gap (each leg
// retraces the last), so consecutive failed attempts alternate sides with
// ESCALATING leg lengths; the growing sweep clears any cover pocket in the
// pit, and a sustained stretch of free pursuit resets the escalation. Pure
// position/tick bookkeeping, no rng. The state lives on `Sim` as
// `fiestaBotSteer` (the E1 "state stays on Sim" pattern, like fiestaBotPids):
// session-only, never serialized, and invisible to the parity harness (which
// samples PlayerMeta/Entity only).
export interface BotSteer {
  x: number;
  z: number;
  stuck: number;
  free: number;
  detour: number;
  attempts: number;
  sign: 1 | -1;
}
export function freshBotSteer(): BotSteer {
  // NaN start position: the first sample reads as progress, never as a wedge.
  return { x: Number.NaN, z: Number.NaN, stuck: 0, free: 0, detour: 0, attempts: 0, sign: 1 };
}
export const BOT_STUCK_EPSILON = 0.05; // yd/tick; an unblocked bot covers ~0.3
export const BOT_STUCK_TICKS = 10; // half a second of no progress means wedged
export const BOT_DETOUR_TICKS = 20; // base sideways leg: one second
export const BOT_DETOUR_MAX_LEGS = 6; // escalation cap (a 6s leg out-walks any cover run)
export const BOT_FREE_TICKS = 20; // a second of unblocked pursuit resets escalation

// Advance one tick of stuck-recovery steering and return the heading to move
// along: the goal heading while progress is being made, a perpendicular
// detour heading while rounding cover. The heading is always derived from
// goalAngle (never from accumulated facing, which would compound the bend).
// A leg that itself stops making progress (wedged on a wall) aborts early
// instead of riding out and then escalating. `maxDetourTicks` lets a caller
// with a more urgent goal (escaping the hazard ring) cap any in-flight leg.
// Pure state-machine core, exported for direct unit tests.
export function advanceBotSteer(
  st: BotSteer,
  x: number,
  z: number,
  goalAngle: number,
  maxDetourTicks = Number.POSITIVE_INFINITY,
): number {
  const moved = Math.hypot(x - st.x, z - st.z);
  st.x = x;
  st.z = z;
  const wedged = moved < BOT_STUCK_EPSILON; // NaN compares false: first sample is progress
  if (st.detour > maxDetourTicks) st.detour = maxDetourTicks;
  if (st.detour > 0) {
    if (wedged) {
      st.stuck++;
      if (st.stuck >= BOT_STUCK_TICKS) {
        st.detour = 0;
        st.stuck = 0;
        return goalAngle;
      }
    } else {
      st.stuck = 0;
    }
    st.detour--;
    return normAngle(goalAngle + st.sign * (Math.PI / 2));
  }
  if (wedged) {
    st.free = 0;
    st.stuck++;
    if (st.stuck >= BOT_STUCK_TICKS) {
      st.stuck = 0;
      st.attempts = Math.min(st.attempts + 1, BOT_DETOUR_MAX_LEGS);
      st.detour = Math.min(BOT_DETOUR_TICKS * st.attempts, maxDetourTicks);
      st.sign = st.sign === 1 ? -1 : 1;
      return normAngle(goalAngle + st.sign * (Math.PI / 2));
    }
    return goalAngle;
  }
  st.stuck = 0;
  st.free++;
  if (st.free >= BOT_FREE_TICKS) st.attempts = 0;
  return goalAngle;
}

function steerState(sim: Sim, pid: number): BotSteer {
  let st = sim.fiestaBotSteer.get(pid);
  if (!st) {
    st = freshBotSteer();
    sim.fiestaBotSteer.set(pid, st);
  }
  return st;
}

function driveFiestaBot(sim: Sim, pid: number): void {
  const e = sim.entities.get(pid);
  const meta = sim.players.get(pid);
  if (!e || !meta) return;
  const match = sim.arenaMatches.get(pid);
  // Snap up any offered augment immediately (random, deterministic via rng).
  if (match?.fiesta) {
    const offer = match.fiesta.offers.get(pid);
    if (offer?.choices.length) sim.arenaAugmentPick(sim.rng.pick(offer.choices), pid);
  }
  meta.moveInput = emptyMoveInput();
  if (e.dead || !match?.fiesta || match.state !== 'active') {
    // Drop steering state whenever the bot is not actively fighting, so a
    // detour begun in one bout can never fire out of context in the next.
    sim.fiestaBotSteer.delete(pid);
    return;
  }

  const team = arenaMod.arenaTeamOf(sim.ctx, match, pid);
  const enemyPids = team === 'A' ? match.teamB : match.teamA;
  let target: Entity | null = null,
    best = Infinity;
  for (const id of enemyPids) {
    const en = sim.entities.get(id);
    if (!en || en.dead || arenaMod.arenaIsDown(match, id)) continue;
    const d = dist2d(e.pos, en.pos);
    if (d < best) {
      best = d;
      target = en;
    }
  }

  // Stay inside the closing ring above all else.
  const origin = arenaOrigin(match.slot);
  const cx = origin.x + FIESTA_RING_CX,
    cz = origin.z + FIESTA_RING_CZ;
  const distCenter = Math.hypot(e.pos.x - cx, e.pos.z - cz);
  if (distCenter > match.fiesta.ringRadius - 2.5) {
    meta.moveInput.forward = true;
    // Escaping the burning ring still needs cover recovery (a pillar between
    // bot and centre wedges it in the fire), but caps any in-flight chase
    // detour at one base leg: never ride out a long escalated sweep here.
    e.facing = advanceBotSteer(
      steerState(sim, pid),
      e.pos.x,
      e.pos.z,
      angleTo(e.pos, { x: cx, y: 0, z: cz }),
      BOT_DETOUR_TICKS,
    );
    return;
  }
  if (!target) return;

  e.facing = steadyAngleTo(e.pos, target.pos, e.facing);
  // Form-aware (rangedAutoProfile): bots never shapeshift today, but if one
  // ever does, a wandless form correctly collapses its standoff to melee.
  const engageRange = rangedAutoProfile(e, meta.cls) ? 22 : MELEE_RANGE * 0.9;
  // Close in when out of range, and ALSO when nominally in range but cover
  // blocks the shot: two bots parked on opposite faces of a pillar are within
  // melee reach yet no attack can land, so keep pushing (the detour steering
  // rounds the pillar) until the target is actually hittable.
  if (best > engageRange || !sim.ctx.hasLineOfSight(e, target)) {
    meta.moveInput.forward = true;
    // The steering goal is the raw target bearing, recomputed every tick:
    // never the (possibly already bent) facing, which would compound bends.
    e.facing = advanceBotSteer(steerState(sim, pid), e.pos.x, e.pos.z, angleTo(e.pos, target.pos));
  }
  e.targetId = target.id;
  if (!e.autoAttack) sim.startAutoAttack(pid);
  // Fire an offensive ability now and then (staggered per bot by pid). A press that
  // lands in the tail of an in-flight cast now queues instead of no-oping on "You are
  // busy." (#1360's single-slot spell queue applies to every castAbility caller,
  // bots included); this is intended, not an accidental behavior change, and it stays
  // deterministic since bot presses derive from tickCount/pid, not rng.
  if (sim.tickCount % 24 === pid % 24) {
    const ability = pickBotAbility(meta);
    if (ability) sim.castAbility(ability, pid);
  }
}

// The bot's go-to offensive ability: a known, enemy-targeted, damage-dealing
// spell/strike. castAbility no-ops if it's on cooldown or unaffordable.
function pickBotAbility(meta: PlayerMeta): string | null {
  for (const k of meta.known) {
    const def = k.def;
    if (def.targetType === 'friendly' || !def.requiresTarget) continue;
    const dealsDamage = def.effects.some(
      (ef) => ef.type === 'directDamage' || ef.type === 'weaponDamage' || ef.type === 'dot',
    );
    if (dealsDamage) return def.id;
  }
  return null;
}
