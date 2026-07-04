// The Gravemarch scripted bots: offline PRACTICE squads (the fiesta_bots.ts
// precedent) and online queue BACKFILL after a long wait. Like fiesta_bots
// these functions take the `Sim` directly (type-only import, no runtime
// cycle) because they reach surfaces the SimContext seam does not expose
// (addPlayer / removePlayer / setPlayerLevel / castAbility / startAutoAttack);
// the deterministic match logic stays in ./battleground behind the seam.
//
// Bot state (`bgBotPids`) stays a Sim field (the E1 "state stays on Sim"
// pattern). Driven from Sim.updateBattlegrounds each tick, never from
// main.ts. DETERMINISM: the driver decision logic itself draws NO randomness
// (tick-staggered heuristics only). The abilities the bots cast resolve
// through the normal combat pipeline and roll on the shared stream like any
// cast, deterministically; with no bots active this module touches nothing.

import { bgLaneWaypoints, bgSpawns } from '../battleground_layout';
import { battlegroundOrigin, CLASSES, DUNGEON_X_THRESHOLD } from '../data';
import type { PlayerMeta, Sim } from '../sim';
import {
  angleTo,
  dist2d,
  type Entity,
  emptyMoveInput,
  MELEE_RANGE,
  type PlayerClass,
} from '../types';
import * as bgMod from './battleground';

// One bot per class: practice fields a full, varied roster. Coliseum-flavored
// names for the offline practice squad; online backfill bots wear the
// unmistakably bot-ish Revenant theme instead.
const BG_PRACTICE_KIT: { cls: PlayerClass; name: string }[] = [
  { cls: 'warrior', name: 'Sergeant Varn' },
  { cls: 'priest', name: 'Warden Oke' },
  { cls: 'mage', name: 'Pale Sister Maren' },
  { cls: 'rogue', name: 'Knellringer Puck' },
  { cls: 'paladin', name: 'Bannerman Hult' },
  { cls: 'hunter', name: 'Deadeye Corse' },
  { cls: 'warlock', name: 'Gravequeen Issa' },
  { cls: 'shaman', name: 'Ashspeaker Rille' },
  { cls: 'druid', name: 'Oathbroken Kel' },
];

const BACKFILL_CLASSES: PlayerClass[] = [
  'warrior',
  'priest',
  'mage',
  'rogue',
  'paladin',
  'hunter',
  'warlock',
  'shaman',
  'druid',
];

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

const BOT_RETREAT_HP_FRAC = 0.3; // fall back and heal below this
const BOT_ENGAGE_SCAN = 25; // yd a bot looks for enemy players
const BOT_MOB_SCAN = 15; // yd a bot looks for enemy minions/structures
const BOT_CAST_STAGGER = 24; // ticks between ability attempts, offset by pid

export function bgPracticeActive(sim: Sim): boolean {
  return sim.bgBotPids.some((pid) => sim.entities.has(pid));
}

function spawnBgBot(sim: Sim, cls: PlayerClass, name: string, near?: Entity): number {
  const pid = sim.addPlayer(cls, name);
  const meta = sim.players.get(pid);
  if (meta) meta.isBgBot = true;
  // Meet the queue floor; the match standardizes everyone to level 20 anyway.
  sim.setPlayerLevel(bgMod.BG_MIN_LEVEL, pid);
  const e = sim.entities.get(pid);
  if (e && near) {
    const i = sim.bgBotPids.length;
    const ang = (i / 10) * Math.PI * 2;
    e.pos = sim.groundPos(near.pos.x + Math.sin(ang) * 4, near.pos.z + Math.cos(ang) * 4);
    e.prevPos = { ...e.pos };
    sim.rebucket(e);
  }
  sim.bgBotPids.push(pid);
  return pid;
}

// Offline practice (the IWorld bgPracticeStart affordance): queue yourself,
// then spawn and queue nine scripted sparring partners so the very next
// matchmaking pass seats a full 5v5. The backfill wait never applies.
export function startBgPractice(sim: Sim): boolean {
  const me = sim.entities.get(sim.primaryId);
  const meMeta = sim.players.get(sim.primaryId);
  if (!me || !meMeta) return false;
  if (bgPracticeActive(sim)) return false; // one squad at a time
  if (sim.bgMatches.has(sim.primaryId)) return false;
  if (me.pos.x > DUNGEON_X_THRESHOLD) return false; // must start from the overworld
  if (!bgMod.isBgQueued(sim.ctx, sim.primaryId)) {
    bgMod.bgQueueJoin(sim.ctx, sim.primaryId);
    if (!bgMod.isBgQueued(sim.ctx, sim.primaryId)) return false; // a guard refused (level, lockout...)
  }
  for (const kit of BG_PRACTICE_KIT) {
    const pid = spawnBgBot(sim, kit.cls, kit.name, me);
    bgMod.bgQueueJoin(sim.ctx, pid);
  }
  return true;
}

// Fill both teams' empty seats with Revenant bots once a human unit has
// waited out the backfill timer, then start the (always unrated) match.
function tryBgBackfill(sim: Sim): void {
  if (sim.bgQueue.length === 0) return;
  const humanWaited = sim.bgQueue.some(
    (u) =>
      sim.time - u.queuedAt >= bgMod.BG_BOT_BACKFILL_WAIT &&
      u.pids.some((pid) => sim.players.get(pid)?.isBgBot !== true),
  );
  if (!humanWaited) return;
  if (bgMod.freeBgSlot(sim.ctx) === null) return;
  const teamA: number[] = [];
  const teamB: number[] = [];
  const seated: bgMod.BgQueueUnit[] = [];
  for (const unit of sim.bgQueue) {
    const target =
      teamA.length <= teamB.length && teamA.length + unit.pids.length <= bgMod.BG_TEAM_SIZE
        ? teamA
        : teamB.length + unit.pids.length <= bgMod.BG_TEAM_SIZE
          ? teamB
          : teamA.length + unit.pids.length <= bgMod.BG_TEAM_SIZE
            ? teamA
            : null;
    if (!target) continue;
    target.push(...unit.pids);
    seated.push(unit);
  }
  if (seated.length === 0) return;
  const botPids: number[] = [];
  let seat = 0;
  for (const team of [teamA, teamB]) {
    while (team.length < bgMod.BG_TEAM_SIZE) {
      const cls = BACKFILL_CLASSES[seat % BACKFILL_CLASSES.length];
      const pid = spawnBgBot(sim, cls, `Revenant ${ROMAN[seat % ROMAN.length]}`);
      botPids.push(pid);
      team.push(pid);
      seat++;
    }
  }
  bgMod.removeBgQueueUnits(sim.ctx, seated);
  if (!bgMod.startBgMatch(sim.ctx, teamA, teamB, { rated: false, botPids })) {
    // Seat claim failed: requeue the humans, discard the fresh bots.
    for (const unit of [...seated].reverse()) {
      if (unit.pids.every((id) => sim.entities.has(id) && !sim.bgMatches.has(id))) {
        sim.bgQueue.unshift(unit);
      }
    }
    for (const pid of botPids) sim.removePlayer(pid);
    sim.bgBotPids = sim.bgBotPids.filter((pid) => !botPids.includes(pid));
  }
}

// Called once per tick from Sim.updateBattlegrounds (before the module's
// matchmaker, so a backfill assembled here starts the same tick). Does
// nothing when no bots exist and no queue is waiting.
export function updateBgBots(sim: Sim): void {
  if (sim.bgQueue.length > 0) tryBgBackfill(sim);
  if (sim.bgBotPids.length === 0) return;
  sim.bgBotPids = sim.bgBotPids.filter((pid) => sim.entities.has(pid));
  // Bots are match-scoped: once their match is gone (returned home) or their
  // practice queue lost its human, remove them from the world.
  const humanQueued = sim.bgQueue.some((u) =>
    u.pids.some((pid) => sim.players.get(pid)?.isBgBot !== true),
  );
  for (const pid of [...sim.bgBotPids]) {
    const inMatch = sim.bgMatches.has(pid);
    const queued = bgMod.isBgQueued(sim.ctx, pid);
    if (inMatch) continue;
    if (queued && humanQueued) continue;
    if (queued) bgMod.bgDequeue(sim.ctx, pid);
    sim.removePlayer(pid);
    sim.bgBotPids = sim.bgBotPids.filter((p) => p !== pid);
  }
  for (const pid of sim.bgBotPids) driveBgBot(sim, pid);
}

function driveBgBot(sim: Sim, pid: number): void {
  const e = sim.entities.get(pid);
  const meta = sim.players.get(pid);
  if (!e || !meta) return;
  meta.moveInput = emptyMoveInput();
  const match = sim.bgMatches.get(pid);
  if (!match || match.state !== 'active' || e.dead) return;
  const team = bgMod.bgTeamOf(match, pid);
  if (!team) return;
  const origin = battlegroundOrigin(match.slot);

  // Wounded: fall back toward the warstone dais and patch up.
  if (e.hp / Math.max(1, e.maxHp) < BOT_RETREAT_HP_FRAC) {
    const home = bgSpawns(team)[2];
    e.facing = angleTo(e.pos, { x: origin.x + home.x, y: 0, z: origin.z + home.z });
    meta.moveInput.forward = true;
    e.autoAttack = false;
    if (sim.tickCount % BOT_CAST_STAGGER === pid % BOT_CAST_STAGGER) {
      const heal = pickBotHeal(meta);
      if (heal) {
        e.targetId = pid; // self
        sim.castAbility(heal, pid);
      }
    }
    return;
  }

  // Target: nearest enemy, preferring low-hp players, then minions, then
  // unshielded structures.
  let target: Entity | null = null;
  let bestScore = Infinity;
  const enemyPids = team === 'A' ? match.teamB : match.teamA;
  for (const oPid of enemyPids) {
    if (bgMod.isBgDown(match, oPid)) continue;
    const oe = sim.entities.get(oPid);
    if (!oe || oe.dead || oe.stealthed) continue;
    const d = dist2d(e.pos, oe.pos);
    if (d > BOT_ENGAGE_SCAN) continue;
    // low-hp targets score best; distance breaks ties
    const score = (oe.hp / Math.max(1, oe.maxHp)) * 100 + d;
    if (score < bestScore) {
      bestScore = score;
      target = oe;
    }
  }
  if (!target) {
    let bestD = BOT_MOB_SCAN;
    for (const m of match.minions) {
      if (m.team === team) continue;
      const me2 = sim.entities.get(m.entityId);
      if (!me2 || me2.dead) continue;
      const d = dist2d(e.pos, me2.pos);
      if (d < bestD) {
        bestD = d;
        target = me2;
      }
    }
    for (const s of match.structures) {
      if (!s.alive || s.def.team === team) continue;
      if (bgMod.bgStructureShielded(match.structures, s.def)) continue;
      const se = sim.entities.get(s.entityId);
      if (!se || se.dead) continue;
      const d = dist2d(e.pos, se.pos);
      if (d < bestD) {
        bestD = d;
        target = se;
      }
    }
  }

  if (target) {
    e.facing = angleTo(e.pos, target.pos);
    const engageRange = CLASSES[meta.cls].ranged ? 22 : MELEE_RANGE * 0.9;
    if (dist2d(e.pos, target.pos) > engageRange) meta.moveInput.forward = true;
    e.targetId = target.id;
    if (!e.autoAttack) sim.startAutoAttack(pid);
    if (sim.tickCount % BOT_CAST_STAGGER === pid % BOT_CAST_STAGGER) {
      const ability = pickBotAbility(sim, meta);
      if (ability) sim.castAbility(ability, pid);
    }
    return;
  }

  // Nothing to fight: march with the biggest allied minion column.
  const dest = biggestColumnFront(sim, match, team) ?? laneFallback(match, team, origin);
  if (dest) {
    e.facing = angleTo(e.pos, dest);
    if (dist2d(e.pos, dest) > 4) meta.moveInput.forward = true;
  }
}

// The front-most minion of the ally lane fielding the most live minions.
function biggestColumnFront(
  sim: Sim,
  match: bgMod.BgMatch,
  team: 'A' | 'B',
): { x: number; y: number; z: number } | null {
  const counts = { west: 0, east: 0 };
  for (const m of match.minions) {
    if (m.team !== team) continue;
    if (sim.entities.get(m.entityId)?.dead === false) counts[m.lane]++;
  }
  const lane = counts.west >= counts.east ? 'west' : 'east';
  if (counts[lane] === 0) return null;
  let front: Entity | null = null;
  let bestWp = -1;
  for (const m of match.minions) {
    if (m.team !== team || m.lane !== lane) continue;
    const e = sim.entities.get(m.entityId);
    if (!e || e.dead) continue;
    if (m.waypoint > bestWp) {
      bestWp = m.waypoint;
      front = e;
    }
  }
  return front ? { ...front.pos } : null;
}

function laneFallback(
  match: bgMod.BgMatch,
  team: 'A' | 'B',
  origin: { x: number; z: number },
): { x: number; y: number; z: number } {
  const mid = bgLaneWaypoints(team, 'west')[2]; // mid-lane bow
  return { x: origin.x + mid.x, y: 0, z: origin.z + mid.z };
}

// First 3 damaging, enemy-targeted known abilities; cycle by tick so a bot
// rotates 2-3 buttons off cooldown (castAbility no-ops when unaffordable).
function pickBotAbility(sim: Sim, meta: PlayerMeta): string | null {
  const options: string[] = [];
  for (const k of meta.known) {
    const def = k.def;
    if (def.targetType === 'friendly' || !def.requiresTarget) continue;
    const dealsDamage = def.effects.some(
      (ef) => ef.type === 'directDamage' || ef.type === 'weaponDamage' || ef.type === 'dot',
    );
    if (dealsDamage) options.push(def.id);
    if (options.length >= 3) break;
  }
  if (options.length === 0) return null;
  return options[Math.floor(sim.tickCount / BOT_CAST_STAGGER) % options.length];
}

function pickBotHeal(meta: PlayerMeta): string | null {
  for (const k of meta.known) {
    const def = k.def;
    if (def.targetType !== 'friendly') continue;
    const heals = def.effects.some((ef) => ef.type === 'heal' || ef.type === 'hot');
    if (heals) return def.id;
  }
  return null;
}
