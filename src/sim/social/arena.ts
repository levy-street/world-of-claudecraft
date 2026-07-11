// Session A2: The Ashen Coliseum ranked Arena (1v1 + 2v2 queue, matchmaking, Elo,
// per-bout Entity resets), MOVED verbatim out of the Sim monolith behind the
// SimContext seam. Move-not-rewrite: statements, branch order, queue/iteration
// order, the matchmaking guard loops, the ~28-field fighter reset, and the
// player-facing emit literals are preserved EXACTLY (the parity gate's full-state
// trace + rng draw-order log proves it).
//
// Arena/duel state stays on Sim and is reached through SimContext live views
// (`arenaMatches` from E1; `arenaQueue1v1`/`arenaQueue2v2`/`arenaQueueFiesta`/
// `arenaBusySlots`/`nextArenaMatchId`/`duels`/`trades` added here, backing fields
// stay on Sim like E1's roster collections). Sim keeps thin same-named delegates so
// every foreign caller (dealDamage arena-death arm, isHostileTo/targeting hostility
// reads, leave/disconnect handling, the Fiesta region, arenaInfoFor/arenaLadder,
// the HUD command path, and tests) resolves unchanged.
//
// Fiesta is a sibling A-slice (A3) and STAYS on Sim for now: createFiestaState /
// fiestaStandardize / updateFiestaActive / fiestaRestoreChar / clearFiestaAugments
// are consumed here via SimContext callbacks (points-at Sim until A3 flips them).

import { ARENA_SLOT_COUNT, arenaOrigin, DUNGEON_X_THRESHOLD } from '../data';
import {
  ARENA_SPAWN_A,
  ARENA_SPAWN_B,
  ARENA_SPAWNS_A_2v2,
  ARENA_SPAWNS_B_2v2,
} from '../dungeon_layout';
import { recalcPlayerStats } from '../entity';
import type { ArenaMatch, ArenaQueueUnit, PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import {
  type ArenaCombatant,
  type ArenaFormat,
  type ArenaStanding,
  DT,
  type Entity,
} from '../types';

// Ashen Coliseum 1v1 arena tuning consts (moved with the slice). FIESTA_COUNTDOWN
// is the only Fiesta const the ranked match-start path needs; the rest of the
// Fiesta tuning stays on Sim with createFiestaState (A3).
const ARENA_COUNTDOWN = 5; // gates pre-fight: heal up, no swings land yet
const ARENA_RETURN_DELAY = 5; // aftermath: hold on the sands before going home
const ARENA_MAX_DURATION = 150; // seconds; a stalling match resolves on hp%
export const ARENA_BASE_RATING = 1500; // every character starts here, unranked
const ARENA_MIN_RATING = 100; // a rating floor so a losing streak can't go absurd
const ARENA_K_FACTOR = 32; // Elo sensitivity per match
const FIESTA_COUNTDOWN = 5;

// Standard Elo. Returns the points the winner gains (and the loser loses) for
// an outright result; a draw moves each toward its expected score by half.
export function eloDelta(winnerRating: number, loserRating: number, score = 1): number {
  const expected = 1 / (1 + 10 ** ((loserRating - winnerRating) / 400));
  return Math.round(ARENA_K_FACTOR * (score - expected));
}

export function arenaQueueJoin(
  ctx: SimContext,
  pidOrFormat?: number | ArenaFormat,
  format: ArenaFormat = '1v1',
): void {
  let pid: number | undefined;
  let fmt: ArenaFormat = format;
  if (typeof pidOrFormat === 'string') {
    fmt = pidOrFormat;
    pid = undefined;
  } else {
    pid = pidOrFormat;
  }
  const r = ctx.resolve(pid);
  if (!r) return;
  const id = r.meta.entityId;
  if (isArenaQueued(ctx, id)) {
    const currentFmt = arenaQueuedFormat(ctx, id);
    if (currentFmt !== fmt) {
      ctx.error(
        id,
        `You are already in the ${currentFmt} queue. Leave it before queueing for ${fmt}.`,
      );
      return;
    }
    const position = arenaQueuePosition(ctx, id, fmt);
    ctx.emit({ type: 'arenaQueued', position, format: fmt, pid: id });
    return;
  }
  if (ctx.arenaMatches.has(id)) {
    ctx.error(id, 'You are already in an arena match.');
    return;
  }
  if (r.e.dead) {
    ctx.error(id, 'You cannot queue for the arena while dead.');
    return;
  }
  if (ctx.duels.has(id)) {
    ctx.error(id, 'You cannot queue while dueling.');
    return;
  }
  if (ctx.trades.has(id)) {
    ctx.error(id, 'Finish your trade before queueing.');
    return;
  }
  if (r.e.pos.x > DUNGEON_X_THRESHOLD) {
    ctx.error(id, 'You cannot queue from inside an instance.');
    return;
  }

  if (fmt === '1v1') {
    const party = ctx.partyOf(id);
    if (party && party.members.length > 1) {
      ctx.error(id, 'Leave your party before queueing for 1v1.');
      return;
    }
    ctx.arenaQueue1v1.push(id);
    ctx.emit({
      type: 'arenaQueued',
      position: ctx.arenaQueue1v1.length,
      format: '1v1',
      pid: id,
    });
    ctx.emit({
      type: 'log',
      text: 'You join the Ashen Coliseum queue. Stand by for a worthy opponent…',
      color: '#ffa040',
      pid: id,
    });
    return;
  }

  // Protect Yumi (3v3/5v5): premade units of ANY size 1..teamSize pool in
  // join order; only the leader queues a party, and a party larger than the
  // team size cannot queue. Same member guards as the 2v2/Fiesta path.
  if (fmt === 'yumi3' || fmt === 'yumi5') {
    const teamSize = fmt === 'yumi3' ? 3 : 5;
    const party = ctx.partyOf(id);
    let unitPids: number[];
    if (!party || party.members.length === 1) {
      unitPids = [id];
    } else if (party.members.length <= teamSize) {
      if (party.leader !== id) {
        ctx.error(id, 'Only the party leader may queue your team for Protect Yumi.');
        return;
      }
      unitPids = [...party.members];
    } else {
      ctx.error(
        id,
        fmt === 'yumi3'
          ? 'Protect Yumi 3v3 allows a party of up to three.'
          : 'Protect Yumi 5v5 allows a party of up to five.',
      );
      return;
    }
    for (const mPid of unitPids) {
      if (mPid === id) continue;
      const e = ctx.entities.get(mPid);
      const mMeta = ctx.players.get(mPid);
      if (!e || !mMeta) {
        ctx.error(id, 'A party member is unavailable.');
        return;
      }
      if (e.dead) {
        ctx.error(id, `${mMeta.name} cannot queue while dead.`);
        return;
      }
      if (ctx.arenaMatches.has(mPid)) {
        ctx.error(id, `${mMeta.name} is already in an arena match.`);
        return;
      }
      if (isArenaQueued(ctx, mPid)) {
        ctx.error(id, `${mMeta.name} is already in the arena queue.`);
        return;
      }
      if (ctx.duels.has(mPid)) {
        ctx.error(id, `${mMeta.name} cannot queue while dueling.`);
        return;
      }
      if (ctx.trades.has(mPid)) {
        ctx.error(id, `${mMeta.name} must finish trading before queueing.`);
        return;
      }
      if (e.pos.x > DUNGEON_X_THRESHOLD) {
        ctx.error(id, `${mMeta.name} cannot queue from inside an instance.`);
        return;
      }
    }
    const queue = fmt === 'yumi3' ? ctx.arenaQueueYumi3 : ctx.arenaQueueYumi5;
    const unit: ArenaQueueUnit = { pids: unitPids, rating: arenaTeamRating(ctx, unitPids, '2v2') };
    queue.push(unit);
    const position = queue.reduce((n, u) => n + u.pids.length, 0);
    for (const mPid of unitPids) {
      ctx.emit({ type: 'arenaQueued', position, format: fmt, pid: mPid });
      ctx.emit({
        type: 'log',
        text: 'You join the Protect Yumi queue. Guard your familiar…',
        color: '#7fd7ff',
        pid: mPid,
      });
    }
    return;
  }

  // 2v2 and Fiesta share the same team-formation + queueing path; only the
  // destination queue and the flavour text differ.
  const isFiesta = fmt === 'fiesta';
  const label = isFiesta ? 'Fiesta' : '2v2';
  const party = ctx.partyOf(id);
  let unitPids: number[];
  if (!party || party.members.length === 1) {
    unitPids = [id];
  } else if (party.members.length === 2) {
    if (party.leader !== id) {
      ctx.error(id, `Only the party leader may queue your team for ${label}.`);
      return;
    }
    unitPids = [...party.members];
  } else {
    ctx.error(id, `${label} premade requires a party of exactly two.`);
    return;
  }
  for (const mPid of unitPids) {
    if (mPid === id) continue;
    const e = ctx.entities.get(mPid);
    const mMeta = ctx.players.get(mPid);
    if (!e || !mMeta) {
      ctx.error(id, 'A party member is unavailable.');
      return;
    }
    if (e.dead) {
      ctx.error(id, `${mMeta.name} cannot queue while dead.`);
      return;
    }
    if (ctx.arenaMatches.has(mPid)) {
      ctx.error(id, `${mMeta.name} is already in an arena match.`);
      return;
    }
    if (isArenaQueued(ctx, mPid)) {
      ctx.error(id, `${mMeta.name} is already in the arena queue.`);
      return;
    }
    if (ctx.duels.has(mPid)) {
      ctx.error(id, `${mMeta.name} cannot queue while dueling.`);
      return;
    }
    if (ctx.trades.has(mPid)) {
      ctx.error(id, `${mMeta.name} must finish trading before queueing.`);
      return;
    }
    if (e.pos.x > DUNGEON_X_THRESHOLD) {
      ctx.error(id, `${mMeta.name} cannot queue from inside an instance.`);
      return;
    }
  }
  const queue = isFiesta ? ctx.arenaQueueFiesta : ctx.arenaQueue2v2;
  const unit: ArenaQueueUnit = { pids: unitPids, rating: arenaTeamRating(ctx, unitPids, '2v2') };
  queue.push(unit);
  const position = queue.reduce((n, u) => n + u.pids.length, 0);
  const joinText = isFiesta
    ? 'You join the 2v2 Fiesta queue. Get ready to PARTY…'
    : 'You join the Ashen Coliseum 2v2 queue. Stand by for opponents…';
  for (const mPid of unitPids) {
    ctx.emit({ type: 'arenaQueued', position, format: fmt, pid: mPid });
    ctx.emit({
      type: 'log',
      text: joinText,
      color: isFiesta ? '#ff3df0' : '#ffa040',
      pid: mPid,
    });
  }
}

export function arenaQueueLeave(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const id = r.meta.entityId;
  const fmt = arenaQueuedFormat(ctx, id);
  const teamQueue =
    fmt === '2v2'
      ? ctx.arenaQueue2v2
      : fmt === 'fiesta'
        ? ctx.arenaQueueFiesta
        : fmt === 'yumi3'
          ? ctx.arenaQueueYumi3
          : fmt === 'yumi5'
            ? ctx.arenaQueueYumi5
            : null;
  const unit = teamQueue ? teamQueue.find((u) => u.pids.includes(id)) : null;
  if (arenaDequeue(ctx, id)) {
    ctx.emit({ type: 'arenaUnqueued', pid: id });
    const leaveText =
      fmt === 'fiesta'
        ? 'You leave the 2v2 Fiesta queue.'
        : fmt === 'yumi3' || fmt === 'yumi5'
          ? 'You leave the Protect Yumi queue.'
          : fmt === '2v2'
            ? 'You leave the Ashen Coliseum 2v2 queue.'
            : 'You leave the Ashen Coliseum queue.';
    ctx.emit({ type: 'log', text: leaveText, color: '#ffa040', pid: id });
    if (unit) {
      const teamLeaveText =
        fmt === 'fiesta'
          ? 'Your team leaves the 2v2 Fiesta queue.'
          : fmt === 'yumi3' || fmt === 'yumi5'
            ? 'Your team leaves the Protect Yumi queue.'
            : 'Your team leaves the Ashen Coliseum 2v2 queue.';
      for (const mPid of unit.pids) {
        if (mPid === id) continue;
        ctx.emit({ type: 'arenaUnqueued', pid: mPid });
        ctx.emit({ type: 'log', text: teamLeaveText, color: '#ffa040', pid: mPid });
      }
    }
  }
}

export function isArenaQueued(ctx: SimContext, pid: number): boolean {
  return (
    ctx.arenaQueue1v1.includes(pid) ||
    ctx.arenaQueue2v2.some((u) => u.pids.includes(pid)) ||
    ctx.arenaQueueFiesta.some((u) => u.pids.includes(pid)) ||
    ctx.arenaQueueYumi3.some((u) => u.pids.includes(pid)) ||
    ctx.arenaQueueYumi5.some((u) => u.pids.includes(pid))
  );
}

export function arenaQueuedFormat(ctx: SimContext, pid: number): ArenaFormat | null {
  if (ctx.arenaQueue1v1.includes(pid)) return '1v1';
  if (ctx.arenaQueue2v2.some((u) => u.pids.includes(pid))) return '2v2';
  if (ctx.arenaQueueFiesta.some((u) => u.pids.includes(pid))) return 'fiesta';
  if (ctx.arenaQueueYumi3.some((u) => u.pids.includes(pid))) return 'yumi3';
  if (ctx.arenaQueueYumi5.some((u) => u.pids.includes(pid))) return 'yumi5';
  return null;
}

export function arenaQueuePosition(ctx: SimContext, pid: number, format: ArenaFormat): number {
  if (format === '1v1') return ctx.arenaQueue1v1.indexOf(pid) + 1;
  const queue =
    format === 'fiesta'
      ? ctx.arenaQueueFiesta
      : format === 'yumi3'
        ? ctx.arenaQueueYumi3
        : format === 'yumi5'
          ? ctx.arenaQueueYumi5
          : ctx.arenaQueue2v2;
  let pos = 0;
  for (const unit of queue) {
    if (unit.pids.includes(pid)) return pos + 1;
    pos += unit.pids.length;
  }
  return pos + 1;
}

export function arenaDequeue(ctx: SimContext, pid: number): boolean {
  const i1 = ctx.arenaQueue1v1.indexOf(pid);
  if (i1 >= 0) {
    ctx.arenaQueue1v1.splice(i1, 1);
    return true;
  }
  const ui = ctx.arenaQueue2v2.findIndex((u) => u.pids.includes(pid));
  if (ui >= 0) {
    ctx.arenaQueue2v2.splice(ui, 1);
    return true;
  }
  const fi = ctx.arenaQueueFiesta.findIndex((u) => u.pids.includes(pid));
  if (fi >= 0) {
    ctx.arenaQueueFiesta.splice(fi, 1);
    return true;
  }
  const y3 = ctx.arenaQueueYumi3.findIndex((u) => u.pids.includes(pid));
  if (y3 >= 0) {
    ctx.arenaQueueYumi3.splice(y3, 1);
    return true;
  }
  const y5 = ctx.arenaQueueYumi5.findIndex((u) => u.pids.includes(pid));
  if (y5 >= 0) {
    ctx.arenaQueueYumi5.splice(y5, 1);
    return true;
  }
  return false;
}

export function freeArenaSlot(ctx: SimContext): number | null {
  for (let i = 0; i < ARENA_SLOT_COUNT; i++) {
    if (!ctx.arenaBusySlots.has(i)) return i;
  }
  return null;
}

export function arenaTeamOf(ctx: SimContext, match: ArenaMatch, pid: number): 'A' | 'B' | null {
  if (match.teamA.includes(pid)) return 'A';
  if (match.teamB.includes(pid)) return 'B';
  return null;
}

export function arenaAllPids(match: ArenaMatch): number[] {
  return [...match.teamA, ...match.teamB];
}

export function arenaStanding(meta: PlayerMeta, format: ArenaFormat): ArenaStanding {
  return format === '2v2'
    ? { rating: meta.arena2v2Rating, wins: meta.arena2v2Wins, losses: meta.arena2v2Losses }
    : { rating: meta.arenaRating, wins: meta.arenaWins, losses: meta.arenaLosses };
}

export function arenaRatingForPid(ctx: SimContext, pid: number, format: ArenaFormat): number {
  const meta = ctx.players.get(pid);
  return meta ? arenaStanding(meta, format).rating : ARENA_BASE_RATING;
}

export function addArenaResult(
  meta: PlayerMeta,
  format: ArenaFormat,
  delta: number,
  won: boolean | null,
): { before: number; after: number } {
  const before = arenaStanding(meta, format).rating;
  const after = Math.max(ARENA_MIN_RATING, before + delta);
  if (format === '2v2') {
    meta.arena2v2Rating = after;
    if (won === true) meta.arena2v2Wins++;
    else if (won === false) meta.arena2v2Losses++;
  } else {
    meta.arenaRating = after;
    if (won === true) meta.arenaWins++;
    else if (won === false) meta.arenaLosses++;
  }
  return { before, after };
}

export function arenaTeamRating(ctx: SimContext, pids: number[], format: ArenaFormat): number {
  if (pids.length === 0) return ARENA_BASE_RATING;
  let sum = 0;
  for (const pid of pids) sum += arenaRatingForPid(ctx, pid, format);
  return sum / pids.length;
}

export function isArenaCrossTeam(
  ctx: SimContext,
  match: ArenaMatch,
  attackerPid: number,
  targetPid: number,
): boolean {
  const atkTeam = arenaTeamOf(ctx, match, attackerPid);
  const tgtTeam = arenaTeamOf(ctx, match, targetPid);
  if (!atkTeam || !tgtTeam || atkTeam === tgtTeam) return false;
  if (arenaIsDown(match, attackerPid)) return false;
  return !arenaIsDown(match, targetPid);
}

// "Down" = out of the fight right now. Ranked bouts eliminate permanently
// (`defeated`); Fiesta and Protect Yumi only bench you until your respawn
// timer elapses.
export function arenaIsDown(match: ArenaMatch, pid: number): boolean {
  if (match.fiesta) return match.fiesta.respawn.has(pid);
  if (match.yumi) return match.yumi.respawn.has(pid);
  return match.defeated.has(pid);
}

export function isArenaTeamWiped(match: ArenaMatch, team: 'A' | 'B'): boolean {
  const pids = team === 'A' ? match.teamA : match.teamB;
  return pids.every((pid) => match.defeated.has(pid));
}

export function arenaTeamHpFrac(ctx: SimContext, match: ArenaMatch, team: 'A' | 'B'): number {
  const pids = team === 'A' ? match.teamA : match.teamB;
  let sum = 0,
    count = 0;
  for (const pid of pids) {
    if (match.defeated.has(pid)) continue;
    const e = ctx.entities.get(pid);
    if (!e) continue;
    sum += e.hp / Math.max(1, e.maxHp);
    count++;
  }
  return count > 0 ? sum / count : 0;
}

export function arenaCombatants(ctx: SimContext, pids: number[]): ArenaCombatant[] {
  const out: ArenaCombatant[] = [];
  for (const pid of pids) {
    const meta = ctx.players.get(pid);
    const e = ctx.entities.get(pid);
    if (meta && e) out.push({ pid, name: meta.name, cls: meta.cls, level: e.level });
  }
  return out;
}

export function updateArena(ctx: SimContext): void {
  matchmakeArena1v1(ctx);
  matchmakeArena2v2(ctx);
  ctx.matchmakeYumi();
  const seen = new Set<ArenaMatch>();
  for (const match of ctx.arenaMatches.values()) {
    if (seen.has(match)) continue;
    seen.add(match);
    // Protect Yumi is lenient about disconnects: one missing member of a
    // 3v3/5v5 benches (updateYumiActive), and the match forfeits only when an
    // ENTIRE team is gone. Ranked/fiesta keep the strict any-member rule.
    const missingA = match.yumi
      ? match.teamA.every((pid) => !ctx.entities.get(pid))
      : match.teamA.some((pid) => !ctx.entities.get(pid));
    const missingB = match.yumi
      ? match.teamB.every((pid) => !ctx.entities.get(pid))
      : match.teamB.some((pid) => !ctx.entities.get(pid));
    if (missingA || missingB) {
      if (match.state === 'over') returnFromArena(ctx, match);
      else {
        let winner: 'A' | 'B' | null = null;
        if (missingA && !missingB) winner = 'B';
        else if (missingB && !missingA) winner = 'A';
        endArenaMatch(ctx, match, winner, 'forfeit');
      }
      continue;
    }
    if (match.state === 'over') {
      match.timer -= DT;
      if (match.timer <= 0) returnFromArena(ctx, match);
      continue;
    }
    const fighters = arenaAllPids(match)
      .map((pid) => ctx.entities.get(pid)!)
      .filter(Boolean);
    if (match.state === 'countdown') {
      const before = Math.ceil(match.timer);
      match.timer -= DT;
      const after = Math.ceil(match.timer);
      if (after < before && after > 0) {
        for (const mPid of arenaAllPids(match))
          ctx.emit({ type: 'arenaCountdown', seconds: after, pid: mPid });
      }
      if (match.timer <= 0) {
        match.state = 'active';
        match.timer = 0;
        for (const e of fighters) readyArenaFighter(ctx, e, { clearPrep: false });
        for (const mPid of arenaAllPids(match)) {
          ctx.emit({
            type: 'log',
            text: match.fiesta ? 'FIESTA — GO!' : 'Fight!',
            color: '#ff5a3c',
            pid: mPid,
          });
          ctx.emit({ type: 'arenaStart', pid: mPid });
        }
        if (match.fiesta) {
          for (const mPid of arenaAllPids(match)) {
            ctx.emit({
              type: 'fiestaScore',
              a: 0,
              b: 0,
              limit: match.fiesta.scoreLimit,
              team: arenaTeamOf(ctx, match, mPid)!,
              pid: mPid,
            });
          }
        }
      }
      continue;
    }
    match.timer += DT;
    if (match.fiesta) {
      ctx.updateFiestaActive(match);
      continue;
    }
    // Protect Yumi never hits the ranked stall-timeout below: sudden death in
    // updateYumiActive guarantees its own ending.
    if (match.yumi) {
      ctx.updateYumiActive(match);
      continue;
    }
    if (match.timer >= ARENA_MAX_DURATION) {
      const fa = arenaTeamHpFrac(ctx, match, 'A');
      const fb = arenaTeamHpFrac(ctx, match, 'B');
      const winner = Math.abs(fa - fb) < 0.02 ? null : fa > fb ? 'A' : 'B';
      endArenaMatch(ctx, match, winner, 'timeout');
    }
  }
}

export function matchmakeArena1v1(ctx: SimContext): void {
  let guard = ARENA_SLOT_COUNT + 1;
  while (guard-- > 0) {
    ctx.arenaQueue1v1 = ctx.arenaQueue1v1.filter((id) => {
      const e = ctx.entities.get(id);
      return !!e && !e.dead && !ctx.arenaMatches.has(id);
    });
    if (ctx.arenaQueue1v1.length < 2 || freeArenaSlot(ctx) === null) return;
    const aPid = ctx.arenaQueue1v1[0];
    const aRating = arenaRatingForPid(ctx, aPid, '1v1');
    let bPid = -1,
      bestGap = Infinity;
    for (let i = 1; i < ctx.arenaQueue1v1.length; i++) {
      const id = ctx.arenaQueue1v1[i];
      const gap = Math.abs(arenaRatingForPid(ctx, id, '1v1') - aRating);
      if (gap < bestGap) {
        bestGap = gap;
        bPid = id;
      }
    }
    if (bPid < 0) return;
    arenaDequeue(ctx, aPid);
    arenaDequeue(ctx, bPid);
    startArenaMatch(ctx, '1v1', [aPid], [bPid]);
  }
}

export function pruneTeamQueue(ctx: SimContext, fmt: '2v2' | 'fiesta'): void {
  const keep = (unit: ArenaQueueUnit) =>
    unit.pids.every((id) => {
      const e = ctx.entities.get(id);
      return !!e && !e.dead && !ctx.arenaMatches.has(id);
    });
  if (fmt === 'fiesta') ctx.arenaQueueFiesta = ctx.arenaQueueFiesta.filter(keep);
  else ctx.arenaQueue2v2 = ctx.arenaQueue2v2.filter(keep);
}

export function removeTeamQueueUnits(
  ctx: SimContext,
  units: ArenaQueueUnit[],
  fmt: '2v2' | 'fiesta',
): void {
  const queue = fmt === 'fiesta' ? ctx.arenaQueueFiesta : ctx.arenaQueue2v2;
  for (const unit of units) {
    const i = queue.indexOf(unit);
    if (i >= 0) queue.splice(i, 1);
  }
}

export function matchmakeArena2v2(ctx: SimContext): void {
  matchmakeTeamFormat(ctx, '2v2');
  matchmakeTeamFormat(ctx, 'fiesta');
}

// Shared 2v2 / Fiesta matchmaker: premades pair off first, then a premade is
// filled out against the two closest-rated solos, then four solos form two
// pairs. Identical for both formats — only the queue + spawned format differ.
export function matchmakeTeamFormat(ctx: SimContext, fmt: '2v2' | 'fiesta'): void {
  let guard = ARENA_SLOT_COUNT + 1;
  while (guard-- > 0) {
    pruneTeamQueue(ctx, fmt);
    if (freeArenaSlot(ctx) === null) return;
    const queue = fmt === 'fiesta' ? ctx.arenaQueueFiesta : ctx.arenaQueue2v2;

    const premades = queue.filter((u) => u.pids.length === 2);
    if (premades.length >= 2) {
      const anchor = premades[0];
      let best = premades[1],
        bestGap = Math.abs(premades[1].rating - anchor.rating);
      for (let i = 2; i < premades.length; i++) {
        const gap = Math.abs(premades[i].rating - anchor.rating);
        if (gap < bestGap) {
          bestGap = gap;
          best = premades[i];
        }
      }
      removeTeamQueueUnits(ctx, [anchor, best], fmt);
      startArenaMatch(ctx, fmt, anchor.pids, best.pids);
      continue;
    }

    if (premades.length >= 1) {
      const solos = queue.filter((u) => u.pids.length === 1);
      if (solos.length >= 2) {
        const premade = premades[0];
        const anchorSolo = solos[0];
        let partner = solos[1],
          bestGap = Math.abs(solos[1].rating - anchorSolo.rating);
        for (let i = 2; i < solos.length; i++) {
          const gap = Math.abs(solos[i].rating - anchorSolo.rating);
          if (gap < bestGap) {
            bestGap = gap;
            partner = solos[i];
          }
        }
        removeTeamQueueUnits(ctx, [premade, anchorSolo, partner], fmt);
        startArenaMatch(ctx, fmt, premade.pids, [anchorSolo.pids[0], partner.pids[0]]);
        continue;
      }
    }

    const solos = queue.filter((u) => u.pids.length === 1);
    if (solos.length >= 4) {
      const anchor = solos[0];
      let partner = solos[1],
        bestGap = Math.abs(solos[1].rating - anchor.rating);
      for (let i = 2; i < solos.length; i++) {
        const gap = Math.abs(solos[i].rating - anchor.rating);
        if (gap < bestGap) {
          bestGap = gap;
          partner = solos[i];
        }
      }
      const teamASet = new Set([anchor.pids[0], partner.pids[0]]);
      const rest = solos.filter((u) => !teamASet.has(u.pids[0]));
      if (rest.length >= 2) {
        removeTeamQueueUnits(ctx, [anchor, partner, rest[0], rest[1]], fmt);
        startArenaMatch(
          ctx,
          fmt,
          [anchor.pids[0], partner.pids[0]],
          [rest[0].pids[0], rest[1].pids[0]],
        );
        continue;
      }
    }
    return;
  }
}

export function startArenaMatch(
  ctx: SimContext,
  format: ArenaFormat,
  teamA: number[],
  teamB: number[],
): void {
  const slot = freeArenaSlot(ctx);
  const allPids = [...teamA, ...teamB];
  const entities = allPids.map((pid) => ctx.entities.get(pid));
  const metas = allPids.map((pid) => ctx.players.get(pid));
  if (slot === null || entities.some((e) => !e) || metas.some((m) => !m)) {
    if (format === '1v1') {
      for (const pid of allPids) {
        if (ctx.entities.get(pid) && !ctx.arenaMatches.has(pid)) ctx.arenaQueue1v1.unshift(pid);
      }
    } else {
      const requeue = format === 'fiesta' ? ctx.arenaQueueFiesta : ctx.arenaQueue2v2;
      const okA = teamA.every((pid) => ctx.entities.get(pid) && !ctx.arenaMatches.has(pid));
      const okB = teamB.every((pid) => ctx.entities.get(pid) && !ctx.arenaMatches.has(pid));
      if (okB) requeue.unshift({ pids: teamB, rating: arenaTeamRating(ctx, teamB, format) });
      if (okA) requeue.unshift({ pids: teamA, rating: arenaTeamRating(ctx, teamA, format) });
    }
    return;
  }
  ctx.arenaBusySlots.add(slot);
  const returns = new Map<number, { x: number; z: number; facing: number }>();
  for (let i = 0; i < allPids.length; i++) {
    const e = entities[i]!;
    returns.set(allPids[i], { x: e.pos.x, z: e.pos.z, facing: e.facing });
  }
  const isFiesta = format === 'fiesta';
  const countdown = isFiesta ? FIESTA_COUNTDOWN : ARENA_COUNTDOWN;
  const match: ArenaMatch = {
    id: ctx.nextArenaMatchId++,
    format,
    teamA,
    teamB,
    slot,
    state: 'countdown',
    timer: countdown,
    returns,
    ratingA: arenaTeamRating(ctx, teamA, format),
    ratingB: arenaTeamRating(ctx, teamB, format),
    defeated: new Set(),
    fiesta: isFiesta ? ctx.createFiestaState() : undefined,
  };
  for (const pid of allPids) ctx.arenaMatches.set(pid, match);
  const origin = arenaOrigin(slot);
  if (format === '1v1') {
    placeInArena(ctx, entities[0]!, origin, ARENA_SPAWN_A);
    placeInArena(ctx, entities[1]!, origin, ARENA_SPAWN_B);
  } else {
    placeTeamInArena(ctx, teamA, origin, ARENA_SPAWNS_A_2v2);
    placeTeamInArena(ctx, teamB, origin, ARENA_SPAWNS_B_2v2);
  }
  // Fiesta: everyone fights at a balanced level 20 — standardize before the
  // clean-slate reset so countdown stats/abilities already reflect it.
  if (isFiesta) {
    for (let i = 0; i < allPids.length; i++) {
      const m = metas[i];
      const e = entities[i];
      if (m && e) ctx.fiestaStandardize(m, e);
    }
  }
  for (const e of entities) resetForArena(ctx, e!);
  emitArenaFound(ctx, match);
  const stepText = isFiesta
    ? 'Welcome to the 2v2 FIESTA! Score takedowns, grab augments, survive the ring!'
    : 'You step onto the sands of the Ashen Coliseum.';
  for (const mPid of allPids) {
    ctx.emit({ type: 'arenaCountdown', seconds: countdown, pid: mPid });
    ctx.emit({
      type: 'log',
      text: stepText,
      color: isFiesta ? '#ff3df0' : '#ffa040',
      pid: mPid,
    });
  }
}

export function emitArenaFound(ctx: SimContext, match: ArenaMatch): void {
  for (const pid of arenaAllPids(match)) {
    const myTeam = arenaTeamOf(ctx, match, pid)!;
    const allyPids = (myTeam === 'A' ? match.teamA : match.teamB).filter((p) => p !== pid);
    const enemyPids = myTeam === 'A' ? match.teamB : match.teamA;
    const allies = arenaCombatants(ctx, allyPids);
    const enemies = arenaCombatants(ctx, enemyPids);
    const primary = enemies[0];
    if (!primary) continue;
    ctx.emit({
      type: 'arenaFound',
      format: match.format,
      oppName: enemies.map((e) => e.name).join(' & '),
      oppClass: primary.cls,
      oppLevel: primary.level,
      allies,
      enemies,
      pid,
    });
  }
}

export function placeInArena(
  ctx: SimContext,
  e: Entity,
  origin: { x: number; z: number },
  spawn: { x: number; z: number; facing: number },
): void {
  e.pos = ctx.groundPos(origin.x + spawn.x, origin.z + spawn.z);
  e.prevPos = { ...e.pos };
  e.facing = spawn.facing;
  e.prevFacing = spawn.facing;
  ctx.rebucket(e);
}

export function placeTeamInArena(
  ctx: SimContext,
  pids: number[],
  origin: { x: number; z: number },
  spawns: { x: number; z: number; facing: number }[],
): void {
  for (let i = 0; i < pids.length; i++) {
    const e = ctx.entities.get(pids[i]);
    if (e) placeInArena(ctx, e, origin, spawns[i] ?? spawns[spawns.length - 1]);
  }
}

// A clean slate so the bout is decided by play, not by what each fighter
// walked in carrying: full health/resource, cooldowns and combat reset.
export function resetForArena(ctx: SimContext, e: Entity): void {
  readyArenaFighter(ctx, e, { clearPrep: true });
}

export function readyArenaFighter(ctx: SimContext, e: Entity, opts: { clearPrep: boolean }): void {
  e.dead = false;
  if (opts.clearPrep) {
    // Arena is a clean competitive slate: unlike the overworld/delve death paths it
    // intentionally strips ALL auras (including The Keeper's Toll) so a PvE penalty
    // never carries into a normalized match.
    e.auras = [];
    e.cooldowns.clear();
    e.ccDr.clear();
  }
  const meta = ctx.players.get(e.id);
  if (meta)
    recalcPlayerStats(e, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
  e.hp = e.maxHp;
  e.resource = e.resourceType === 'mana' ? e.maxResource : e.resourceType === 'energy' ? 100 : 0;
  e.targetId = null;
  e.autoAttack = false;
  e.queuedOnSwing = null;
  delete e.queuedOnSwingFree;
  e.queuedCastAbility = null;
  e.queuedCastAim = null;
  e.castingAbility = null;
  e.castRemaining = 0;
  e.castTargetId = null;
  e.channeling = false;
  e.comboPoints = 0;
  e.comboUntil = -1;
  e.gcdRemaining = 0;
  e.swingTimer = 0;
  e.chargeTargetId = null;
  e.chargePath = [];
  e.followTargetId = null;
  e.combatTimer = 99;
  e.inCombat = false;
  e.sitting = false;
  e.eating = null;
  e.drinking = null;
}

// Decide a bout: score it (once), then either send survivors home now (a
// forfeit) or hold everyone on the sands for a brief aftermath before
// returning them. winnerTeam null = draw.
export function endArenaMatch(
  ctx: SimContext,
  match: ArenaMatch,
  winnerTeam: 'A' | 'B' | null,
  reason: 'defeat' | 'timeout' | 'forfeit',
): void {
  const ratingA0 = match.ratingA;
  const ratingB0 = match.ratingB;
  // Fiesta and Protect Yumi are unranked play: they never move the Elo ladder.
  const ranked = !match.fiesta && !match.yumi;
  let deltaA: number;
  if (!ranked) {
    deltaA = 0;
  } else if (winnerTeam === null) {
    deltaA = eloDelta(ratingA0, ratingB0, 0.5);
  } else if (winnerTeam === 'A') {
    deltaA = eloDelta(ratingA0, ratingB0, 1);
  } else {
    deltaA = -eloDelta(ratingB0, ratingA0, 1);
  }

  const scoreTeam = (team: 'A' | 'B', delta: number, won: boolean | null) => {
    const pids = team === 'A' ? match.teamA : match.teamB;
    const enemies = team === 'A' ? match.teamB : match.teamA;
    const enemyNames = enemies.map((pid) => ctx.players.get(pid)?.name ?? '?').join(' & ');
    for (const pid of pids) {
      const meta = ctx.players.get(pid);
      if (!meta) continue;
      // Fiesta is unranked party play — it never moves the ladder, so report
      // an unchanged rating; ranked bouts go through the per-bracket updater.
      let ratingBefore: number, ratingAfter: number;
      if (ranked) {
        ({ before: ratingBefore, after: ratingAfter } = addArenaResult(
          meta,
          match.format,
          delta,
          won,
        ));
      } else {
        ratingBefore = ratingAfter = arenaStanding(meta, match.format).rating;
      }
      ctx.emit({
        type: 'arenaEnd',
        pid,
        format: match.format,
        draw: winnerTeam === null,
        won: won === true,
        oppName: enemyNames,
        ratingBefore,
        ratingAfter,
        allies: arenaCombatants(
          ctx,
          pids.filter((p) => p !== pid),
        ),
        enemies: arenaCombatants(ctx, enemies),
      });
    }
  };

  const wonA = winnerTeam === null ? null : winnerTeam === 'A';
  const wonB = winnerTeam === null ? null : winnerTeam === 'B';
  scoreTeam('A', deltaA, wonA);
  scoreTeam('B', -deltaA, wonB);

  if (reason === 'forfeit') {
    returnFromArena(ctx, match);
    return;
  }

  const allPresent = arenaAllPids(match).every((pid) => ctx.entities.get(pid));
  if (!allPresent) {
    returnFromArena(ctx, match);
    return;
  }

  for (const pid of arenaAllPids(match)) {
    if (match.defeated.has(pid)) continue;
    const e = ctx.entities.get(pid);
    if (e) resetForArena(ctx, e);
  }
  match.state = 'over';
  match.timer = ARENA_RETURN_DELAY;
  const overText = match.fiesta
    ? 'FIESTA OVER! What a party. Returning to the world…'
    : 'The bout is decided. Returning to the world…';
  for (const mPid of arenaAllPids(match)) {
    ctx.emit({
      type: 'log',
      text: overText,
      color: match.fiesta ? '#ff3df0' : '#ffa040',
      pid: mPid,
    });
  }
}

// Teleport all fighters back to where they queued, fully cleansed, and
// release the instance slot.
export function returnFromArena(ctx: SimContext, match: ArenaMatch): void {
  for (const pid of arenaAllPids(match)) ctx.arenaMatches.delete(pid);
  // Slot numbers collide across pools (pit slot 2 vs maze slot 2), so a yumi
  // match MUST free the maze pool, never the pit's; it also drops its cats.
  if (match.yumi) {
    ctx.cleanupYumiMatch(match);
    ctx.yumiBusySlots.delete(match.slot);
  } else {
    ctx.arenaBusySlots.delete(match.slot);
  }
  for (const pid of arenaAllPids(match)) {
    const e = ctx.entities.get(pid);
    const ret = match.returns.get(pid);
    if (!e || !ret) continue;
    // Fiesta augments + the level-20 standardization are bout-only — undo both
    // before the player goes home so resetForArena recomputes their real stats.
    if (match.fiesta) {
      const meta = ctx.players.get(pid);
      if (meta) {
        ctx.fiestaRestoreChar(meta, e);
        ctx.clearFiestaAugments(meta, e);
      }
    }
    resetForArena(ctx, e);
    e.pos = ctx.groundPos(ret.x, ret.z);
    e.prevPos = { ...e.pos };
    e.facing = ret.facing;
    e.dead = false;
    ctx.rebucket(e);
    ctx.emit({ type: 'respawn', pid: e.id });
  }
}

export function arenaMatchFor(ctx: SimContext, pid: number): ArenaMatch | null {
  return ctx.arenaMatches.get(pid) ?? null;
}
