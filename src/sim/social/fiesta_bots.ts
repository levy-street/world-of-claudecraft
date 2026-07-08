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

import { arenaOrigin, CLASSES, DUNGEON_X_THRESHOLD } from '../data';
import type { PlayerMeta, Sim } from '../sim';
import {
  angleTo,
  dist2d,
  type Entity,
  emptyMoveInput,
  MELEE_RANGE,
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
  if (e.dead || !match?.fiesta || match.state !== 'active') return;

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
    e.facing = angleTo(e.pos, { x: cx, y: 0, z: cz });
    meta.moveInput.forward = true;
    return;
  }
  if (!target) return;

  e.facing = steadyAngleTo(e.pos, target.pos, e.facing);
  const engageRange = CLASSES[meta.cls].ranged ? 22 : MELEE_RANGE * 0.9;
  if (best > engageRange) meta.moveInput.forward = true;
  e.targetId = target.id;
  if (!e.autoAttack) sim.startAutoAttack(pid);
  // Fire an offensive ability now and then (staggered per bot by pid).
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
