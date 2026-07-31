// Thornhollow Fields: the ranked 5v5 capture-the-flag battleground (re-cut of
// Dubtribe11's PR #589 on the SimContext seam; the arena slice A2 is the
// structural template, Protect Yumi the band/module precedent).
//
// Battleground state stays on Sim and is reached through SimContext live views
// (`bgQueue`/`bgMatches`/`bgBusySlots`/`nextBgMatchId`). Sim keeps thin
// same-named delegates so foreign callers (the damage/death arms, hostility
// reads, leave/disconnect handling, bgInfoFor, the HUD command path, and tests)
// resolve on the facade.
//
// Determinism: the ACTIVE phase draws ZERO rng, shared or otherwise. Team
// assignment derives from queue order, wave-respawn clocks and rune recharges
// from tick math, and a claimed power rune flips its face deterministically.
// The mode's single draw is at match START (the power runes' seeded opening
// face in startBgMatch), pinned by the /dev bg one-draw test; the in-match
// zero-rng pin holds, so the phase's tick position can never fork the shared
// draw order mid-match.

import {
  BG_BASES,
  BG_GRAVEYARDS,
  BG_POWER_RUNES,
  BG_SPEED_RUNES,
  BG_TEAM_COLORS,
  BG_TEAM_NAMES,
  type BgTeam,
  keepInteriorBounds,
} from '../battleground_layout';
import { BG_SLOT_COUNT, battlegroundOrigin, DUNGEON_X_THRESHOLD } from '../data';
import { createGroundObject } from '../entity';
import { awardBattlegroundHonor, honorTeamIdentity } from '../pvp';
import type { ArenaReturnPools } from '../sim';
import type { SimContext } from '../sim_context';
import { releasePlayerSpirit } from '../spirit';
import { type Aura, DT, type Entity, type Vec3 } from '../types';
import { eloDelta, snapshotArenaReturnPools } from './arena';
import { formBgTeamParty, unwindBgAutoPartyFor, unwindBgTeamParties } from './battleground_party';

// --- Thornhollow Fields tuning consts (rating reuses the arena's exported eloDelta) ---
export const BG_BASE_RATING = 1500; // every character starts here on the ladder
export const BG_MIN_RATING = 100; // rating floor so a losing streak can't go absurd
export const BG_TEAM_SIZE = 5; // players per team: a full match is 5v5
// Queue floor: an under-leveled body on one side decides ranked matches, so
// every queued champion (and every member of a queued party) must be 20.
export const BG_MIN_LEVEL = 20;
const BG_COUNTDOWN = 8; // form-up gate at the keeps before the flags go live
export const BG_CAPS_TO_WIN = 5; // first team to this many captures wins.
// ^ Tuning knob number one post-launch: fall back to 3 if live cap pace runs
// slower than the modeled 2-3 minutes per capture on even teams.
// 12 min cap; resolves on score, ties draw. Scaled with the field: the stands
// are 236yd apart, so five captures on even teams model out inside the cap and
// the fifth capture, rather than the clock, decides most matches.
export const BG_MAX_DURATION = 720;
export const BG_END_HOLD = 15; // post-match hold: the frozen result screen
export const BG_WAVE_PERIOD = 10; // one respawn wave per team every 10s
export const BG_WAVE_OFFSET = 5; // the two team clocks run staggered half-cycles
// Carrier vulnerability (the WSG Focused Assault lineage): after holding an
// enemy flag continuously for BG_CARRIER_VULN_DELAY the carrier takes stacking
// extra damage, a stack every BG_CARRIER_VULN_INTERVAL, each
// BG_CARRIER_VULN_PER_STACK more damage taken, uncapped. Stacks clear the
// moment the flag leaves the carrier (capture, drop, or return). Anti-turtle:
// a hidden carrier gets softer the longer the hold.
// The delay is tuned to the field's real scale: the stands are 236yd apart,
// about 34s of clean running each way, so the anti-turtle clock starts biting
// after roughly two full flag-to-flag runs.
export const BG_CARRIER_VULN_DELAY = 75;
export const BG_CARRIER_VULN_INTERVAL = 15;
export const BG_CARRIER_VULN_PER_STACK = 0.1;
const BG_FLAG_RETURN_TIME = 20; // a dropped flag auto-returns home after this
// Reach for the flag action. The stand is paved ground, not a plinth: a runner
// walks right up to the pole, so the reach stays tight.
export const BG_PICKUP_RADIUS = 2.5;
const BG_CAPTURE_RADIUS = 4; // carry the enemy flag this close to your stand
const BG_RUNE_RADIUS = 2.5; // step this close to a speed rune to claim it
const BG_RUNE_COOLDOWN = 30; // a claimed rune recharges over this (owner: 22 felt too fast)
const BG_RUNE_SPEED = 1.4; // sprint multiplier the rune grants
const BG_RUNE_DURATION = 10; // seconds of haste per rune
// Power runes: a short, honest edge worth a detour, never a win condition
// (owner-tuned: noticeably better than 10, below cooldown-stacking range).
export const BG_POWER_RUNE_VALUE = 0.15; // +15% dealt / -15% taken
const BG_POWER_RUNE_DURATION = 10;

const CARRIER_VULN_AURA_ID = 'bg_carrier_vulnerability';
export const SPRINT_RUNE_AURA_ID = 'bg_sprint_rune';
export const BATTLE_RUNE_AURA_ID = 'bg_battle_rune';
export const WARD_RUNE_AURA_ID = 'bg_ward_rune';

export interface BgFlagState {
  team: BgTeam; // home team
  home: Vec3; // world-space stand position
  pos: Vec3; // current world position (follows the carrier while carried)
  state: 'home' | 'carried' | 'dropped';
  carrier: number | null; // pid carrying this (enemy) flag
  dropTimer: number; // counts a dropped flag down to its auto-return
  carrySeconds: number; // continuous hold time by the current carrier
  vulnStacks: number; // carrier-vulnerability stacks currently applied
  entityId: number; // the ground entity that renders the flag
}

export type BgRuneType = 'sprint' | 'damage' | 'defense';

export interface BgRuneState {
  type: BgRuneType;
  pos: Vec3; // world
  active: boolean;
  cooldown: number; // seconds until it recharges
  entityId: number; // -1 while spent (the rune mesh despawns on cooldown)
}

// A live battleground: two teams of pids, scores, the two flags, the speed
// runes, the wave-respawn clocks, and per-player return bookkeeping.
export interface BgMatch {
  id: number;
  slot: number;
  teams: [number[], number[]]; // pids, index = team
  scores: [number, number];
  flags: [BgFlagState, BgFlagState];
  runes: BgRuneState[];
  state: 'countdown' | 'active' | 'ended';
  timer: number; // countdown remaining, elapsed seconds while active, then the end hold
  winner: BgTeam | null; // set when the result resolves; null is a draw once ended
  waveIn: [number, number]; // seconds until each team's next respawn wave
  returns: Map<number, { x: number; z: number; facing: number }>;
  preMatchPools: Map<number, ArenaReturnPools>;
  pendingFlagPress: Set<number>; // deliberate presses, resolved next update
  honorTeamKeys: [string, string]; // snapshotted at start (rename-proof DR keys)
  // false for /dev bg force-starts (jgyy review): a dev-forced, possibly
  // asymmetric match must never move the real ladder, W/L, or honor.
  rated: boolean;
  // Per-player match tallies for the scoreboard (seeded to zeros at start;
  // a deserter's row drops with their team entry).
  stats: Map<number, { kills: number; deaths: number; captures: number }>;
  ratingAvg: [number, number]; // team average rating at start, for Elo
  // Per team: pids auto-added to the team party at start (never the surviving
  // base premade), unwound at match end or on desertion (battleground_party.ts).
  autoPartyPids: [number[], number[]];
  resultRecorded: boolean;
  fightersReleased: boolean; // releaseBgFighters ran (teardown is once-only)
  // per-tick memo of the viewer-identical match view (server hot-path rule:
  // build shared things once per tick, never per viewer)
  viewTick: number;
  viewShared: import('../../world_api').BgMatchInfo | null;
}

// A queued group: a whole party (or a solo) that matchmaking keeps together.
export interface BgQueueGroup {
  pids: number[];
}

export function bgGroupContaining(ctx: SimContext, pid: number): BgQueueGroup | null {
  return ctx.bgQueue.find((g) => g.pids.includes(pid)) ?? null;
}

export function bgQueueSize(ctx: SimContext): number {
  return ctx.bgQueue.reduce((s, g) => s + g.pids.length, 0);
}

export function bgTeamOf(match: BgMatch, pid: number): BgTeam {
  return match.teams[1].includes(pid) ? 1 : 0;
}

export function bgAllPids(match: BgMatch): number[] {
  return [...match.teams[0], ...match.teams[1]];
}

export function bgMatchFor(ctx: SimContext, pid: number): BgMatch | null {
  return ctx.bgMatches.get(pid) ?? null;
}

function bgEmitAll(ctx: SimContext, match: BgMatch, ev: (pid: number) => void): void {
  for (const mp of bgAllPids(match)) ev(mp);
}

export function bgQueueJoin(ctx: SimContext, pid?: number, opts?: { bypassLevel?: boolean }): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const id = r.meta.entityId;
  if (ctx.bgMatches.has(id)) {
    ctx.error(id, 'You are already in a battleground.');
    return;
  }
  if (r.e.dead) {
    ctx.error(id, 'You cannot queue for Thornhollow Fields while dead.');
    return;
  }
  if (ctx.arenaMatches.has(id)) {
    ctx.error(id, 'You cannot queue for Thornhollow Fields while in another match.');
    return;
  }
  if (!opts?.bypassLevel && r.e.level < BG_MIN_LEVEL) {
    ctx.error(id, `Thornhollow Fields requires level ${BG_MIN_LEVEL}.`);
    return;
  }
  if (r.e.pos.x > DUNGEON_X_THRESHOLD) {
    ctx.error(id, 'You cannot queue from inside an instance.');
    return;
  }
  const existing = bgGroupContaining(ctx, id);
  if (existing) {
    ctx.emit({ type: 'bgQueued', position: ctx.bgQueue.indexOf(existing) + 1, pid: id });
    return;
  }
  // Queue the whole party as one group (kept together by matchmaking); solo
  // players queue alone. Any eligible member can put the party in. An
  // over-size party is refused outright rather than silently truncated.
  const party = ctx.partyOf(id);
  if (party && party.members.length > BG_TEAM_SIZE) {
    ctx.error(id, 'Your party is too large for Thornhollow Fields. It queues parties of up to 5.');
    return;
  }
  const members = party ? [...party.members] : [id];
  for (const m of members) {
    if (ctx.bgMatches.has(m) || ctx.arenaMatches.has(m) || bgGroupContaining(ctx, m)) {
      ctx.error(id, 'A party member is already queued or in a match.');
      return;
    }
    const member = ctx.entities.get(m);
    if (!opts?.bypassLevel && member && member.level < BG_MIN_LEVEL) {
      ctx.error(
        id,
        `Every party member must be level ${BG_MIN_LEVEL} to queue for Thornhollow Fields.`,
      );
      return;
    }
  }
  ctx.bgQueue.push({ pids: [...members] });
  const position = ctx.bgQueue.length;
  for (const m of members) {
    ctx.emit({ type: 'bgQueued', position, pid: m });
    ctx.emit({
      type: 'log',
      text:
        party && members.length > 1
          ? `Your party of ${members.length} joins the Thornhollow Fields queue.`
          : `You join the Thornhollow Fields queue. Need ${BG_TEAM_SIZE * 2} champions to start a match.`,
      color: '#7fd4ff',
      pid: m,
    });
  }
}

export function bgQueueLeave(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const group = bgGroupContaining(ctx, r.meta.entityId);
  if (!group) return;
  ctx.bgQueue = ctx.bgQueue.filter((g) => g !== group);
  for (const m of group.pids) {
    ctx.emit({ type: 'bgUnqueued', pid: m });
    ctx.emit({
      type: 'log',
      text: 'You leave the Thornhollow Fields queue.',
      color: '#7fd4ff',
      pid: m,
    });
  }
}

/** Drop ONE pid out of the queue (disconnect path); their group stays queued. */
export function bgDequeue(ctx: SimContext, pid: number): boolean {
  const group = bgGroupContaining(ctx, pid);
  if (!group) return false;
  group.pids = group.pids.filter((p) => p !== pid);
  if (group.pids.length === 0) ctx.bgQueue = ctx.bgQueue.filter((g) => g !== group);
  return true;
}

function freeBgSlot(ctx: SimContext): number | null {
  for (let i = 0; i < BG_SLOT_COUNT; i++) if (!ctx.bgBusySlots.has(i)) return i;
  return null;
}

// The deliberate battleground action press. Validated eagerly for feedback,
// then queued and resolved inside the next update pass AFTER proximity
// auto-returns run, so an automatic return beats a same-tick pickup press
// (pinned by tests/battleground.test.ts).
export function bgFlagAction(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const id = r.meta.entityId;
  const match = ctx.bgMatches.get(id);
  if (!match || match.state !== 'active' || r.e.dead) return;
  const near = match.flags.some(
    (f) =>
      f.state !== 'carried' &&
      f.team !== bgTeamOf(match, id) &&
      dist2d(r.e.pos, f.pos) <= BG_PICKUP_RADIUS,
  );
  if (!near) {
    ctx.error(id, 'There is no flag within reach.');
    return;
  }
  match.pendingFlagPress.add(id);
}

function dist2d(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function updateBattleground(ctx: SimContext): void {
  matchmakeBg(ctx);
  const seen = new Set<BgMatch>();
  for (const match of ctx.bgMatches.values()) {
    if (seen.has(match)) continue;
    seen.add(match);
    if (match.state === 'countdown') {
      tickCountdown(ctx, match);
      continue;
    }
    if (match.state === 'ended') {
      // The frozen result screen: no combat (the hostility arm requires
      // 'active'), no flags, no waves; just the hold running out.
      match.timer -= DT;
      if (match.timer <= 0) releaseBgFighters(ctx, match);
      continue;
    }
    match.timer += DT;
    // Graveyards before the wave: an auto-release landing on the wave tick
    // still catches that wave, and the raise position is post-ward.
    tickGraveyards(ctx, match);
    tickWaveRespawns(ctx, match);
    tickRunes(ctx, match);
    tickFlags(ctx, match);
    match.pendingFlagPress.clear();
    if (match.timer >= BG_MAX_DURATION && !match.resultRecorded) {
      // The match cap resolves on score; an equal score is a draw.
      const w: BgTeam | null =
        match.scores[0] === match.scores[1] ? null : match.scores[0] > match.scores[1] ? 0 : 1;
      enterBgEndHold(ctx, match, w, 'timeout');
    }
  }
}

function tickCountdown(ctx: SimContext, match: BgMatch): void {
  const origin = battlegroundOrigin(match.slot);
  // Hold the form-up: a player who slips out of their keep mouth before the
  // gates open is set back on their spawn ring.
  for (const team of [0, 1] as BgTeam[]) {
    const bounds = keepInteriorBounds(team);
    match.teams[team].forEach((pid, i) => {
      const e = ctx.entities.get(pid);
      if (!e) return;
      const lx = e.pos.x - origin.x;
      const lz = e.pos.z - origin.z;
      const inKeep =
        lx >= bounds.minX && lx <= bounds.maxX && lz >= bounds.minZ && lz <= bounds.maxZ;
      if (!inKeep) {
        placeInBg(ctx, match, pid, team, i);
        // The set-back needs a reason on screen, not just a teleport
        // (naturally rate-limited: walking back out takes seconds).
        ctx.error(pid, 'The gates open when the battle begins.');
      }
    });
  }
  const before = Math.ceil(match.timer);
  match.timer -= DT;
  const after = Math.ceil(match.timer);
  if (after < before && after > 0) {
    bgEmitAll(ctx, match, (pid) => ctx.emit({ type: 'bgCountdown', seconds: after, pid }));
  }
  if (match.timer <= 0) {
    match.state = 'active';
    match.timer = 0;
    match.waveIn = [BG_WAVE_PERIOD, BG_WAVE_OFFSET];
    for (const pid of bgAllPids(match)) {
      const e = ctx.entities.get(pid);
      if (e) {
        ctx.readyArenaFighter(e, { clearPrep: true });
        e.ghost = false;
        e.corpsePos = null;
        e.corpseInstanceId = null;
      }
      ctx.emit({
        type: 'log',
        text: 'The Thornhollow Fields battle begins: take their flag!',
        color: '#ff5a3c',
        pid,
      });
      ctx.emit({ type: 'bgStart', pid });
    }
  }
}

function matchmakeBg(ctx: SimContext): void {
  let guard = BG_SLOT_COUNT + 1;
  while (guard-- > 0) {
    // Drop members who went offline, died, entered a match, or walked into
    // instanced content while waiting; tell the survivors they fell out of
    // line instead of silently flipping their window back to idle.
    for (const g of ctx.bgQueue) {
      g.pids = g.pids.filter((p) => {
        const e = ctx.entities.get(p);
        if (e && !e.dead && !ctx.bgMatches.has(p) && e.pos.x <= DUNGEON_X_THRESHOLD) return true;
        if (e && !ctx.bgMatches.has(p)) {
          ctx.emit({ type: 'bgUnqueued', pid: p });
          ctx.emit({
            type: 'log',
            text: 'You leave the Thornhollow Fields queue.',
            color: '#7fd4ff',
            pid: p,
          });
        }
        return false;
      });
    }
    ctx.bgQueue = ctx.bgQueue.filter((g) => g.pids.length > 0);
    if (bgQueueSize(ctx) < BG_TEAM_SIZE * 2 || freeBgSlot(ctx) === null) return;
    // Greedily pack whole groups into two teams of five, balancing headcount.
    // Queue order is the only input: no rng, no rating banding (rated, not
    // matched; strict matchmaking is deferred).
    // Size-desc with a queue-order tiebreak: an explicit total order (the
    // repo rule), not a lean on engine sort stability.
    const groups = ctx.bgQueue
      .map((g, seq) => ({ g, seq }))
      .sort((a, b) => b.g.pids.length - a.g.pids.length || a.seq - b.seq)
      .map((x) => x.g);
    const teams: [number[], number[]] = [[], []];
    const used: BgQueueGroup[] = [];
    for (const g of groups) {
      const canA = teams[0].length + g.pids.length <= BG_TEAM_SIZE;
      const canB = teams[1].length + g.pids.length <= BG_TEAM_SIZE;
      let t = -1;
      if (canA && canB) t = teams[0].length <= teams[1].length ? 0 : 1;
      else if (canA) t = 0;
      else if (canB) t = 1;
      if (t < 0) continue;
      teams[t].push(...g.pids);
      used.push(g);
    }
    if (teams[0].length !== BG_TEAM_SIZE || teams[1].length !== BG_TEAM_SIZE) return;
    ctx.bgQueue = ctx.bgQueue.filter((g) => !used.includes(g));
    startBgMatch(ctx, teams[0], teams[1]);
  }
}

function bgTeamAvg(ctx: SimContext, pids: number[]): number {
  if (pids.length === 0) return BG_BASE_RATING;
  return (
    pids.reduce((s, p) => s + (ctx.players.get(p)?.bgRating ?? BG_BASE_RATING), 0) / pids.length
  );
}

export function startBgMatch(
  ctx: SimContext,
  teamA: number[],
  teamB: number[],
  opts?: { rated?: boolean },
): void {
  const slot = freeBgSlot(ctx);
  if (slot === null) {
    // Hand the seats back as two TEAM-SIZED groups: a single welded ten-group
    // could never be packed into 5v5 teams again by the matchmaker.
    ctx.bgQueue.unshift({ pids: [...teamB] });
    ctx.bgQueue.unshift({ pids: [...teamA] });
    return;
  }
  ctx.bgBusySlots.add(slot);
  const origin = battlegroundOrigin(slot);
  const returns = new Map<number, { x: number; z: number; facing: number }>();
  const preMatchPools = new Map<number, ArenaReturnPools>();
  for (const pid of [...teamA, ...teamB]) {
    const e = ctx.entities.get(pid);
    if (!e) continue;
    returns.set(pid, { x: e.pos.x, z: e.pos.z, facing: e.facing });
    preMatchPools.set(pid, snapshotArenaReturnPools(e));
  }
  const flags = ([0, 1] as BgTeam[]).map((team) => {
    const home = ctx.groundPos(origin.x + BG_BASES[team].flag.x, origin.z + BG_BASES[team].flag.z);
    return {
      team,
      home,
      pos: { ...home },
      state: 'home' as const,
      carrier: null,
      dropTimer: 0,
      carrySeconds: 0,
      vulnStacks: 0,
      entityId: -1,
    };
  }) as [BgFlagState, BgFlagState];
  // ONE seeded draw opens both power pads on the same face (mirror fairness);
  // each pad then alternates per its own claims, deterministically. This is
  // the mode's single rng draw, at match START: the active phase stays
  // draw-free (the zero-rng pin).
  const powerFace: BgRuneType = ctx.rng.int(0, 1) === 0 ? 'damage' : 'defense';
  const runes: BgRuneState[] = [
    ...BG_SPEED_RUNES.map((rp) => ({
      type: 'sprint' as BgRuneType,
      pos: ctx.groundPos(origin.x + rp.x, origin.z + rp.z),
      active: true,
      cooldown: 0,
      entityId: -1,
    })),
    ...BG_POWER_RUNES.map((rp) => ({
      type: powerFace,
      pos: ctx.groundPos(origin.x + rp.x, origin.z + rp.z),
      active: true,
      cooldown: 0,
      entityId: -1,
    })),
  ];
  const match: BgMatch = {
    id: ctx.nextBgMatchId++,
    slot,
    teams: [teamA, teamB],
    stats: new Map([...teamA, ...teamB].map((p) => [p, { kills: 0, deaths: 0, captures: 0 }])),
    scores: [0, 0],
    flags,
    runes,
    state: 'countdown',
    timer: BG_COUNTDOWN,
    winner: null,
    waveIn: [BG_WAVE_PERIOD, BG_WAVE_OFFSET],
    returns,
    preMatchPools,
    pendingFlagPress: new Set(),
    honorTeamKeys: [honorTeamIdentity(ctx, teamA), honorTeamIdentity(ctx, teamB)],
    rated: opts?.rated !== false,
    ratingAvg: [bgTeamAvg(ctx, teamA), bgTeamAvg(ctx, teamB)],
    autoPartyPids: [[], []],
    resultRecorded: false,
    fightersReleased: false,
    viewTick: -1,
    viewShared: null,
  };
  for (const pid of bgAllPids(match)) ctx.bgMatches.set(pid, match);
  for (const flag of flags) spawnFlagEntity(ctx, flag);
  for (const rune of runes) spawnRuneEntity(ctx, rune);
  for (const team of [0, 1] as BgTeam[]) {
    match.teams[team].forEach((pid, i) => {
      placeInBg(ctx, match, pid, team, i);
    });
  }
  // Weld each team into one party for the match (party chat + party frames);
  // only the auto-added links are remembered, so they can be unwound later.
  match.autoPartyPids = [formBgTeamParty(ctx, teamA), formBgTeamParty(ctx, teamB)];
  for (const team of [0, 1] as BgTeam[]) {
    for (const pid of match.teams[team]) {
      ctx.emit({ type: 'bgFound', team, pid });
      ctx.emit({ type: 'bgCountdown', seconds: BG_COUNTDOWN, pid });
      ctx.emit({
        type: 'log',
        text: `Thornhollow Fields: you fight for the ${BG_TEAM_NAMES[team]}. First to ${BG_CAPS_TO_WIN} captures wins.`,
        color: '#7fd4ff',
        pid,
      });
    }
  }
}

// Place a player at one of their keep's spawn points (round-robin by index),
// healed and reset for the fight.
function placeInBg(
  ctx: SimContext,
  match: BgMatch,
  pid: number,
  team: BgTeam,
  index: number,
): void {
  const e = ctx.entities.get(pid);
  if (!e) return;
  const origin = battlegroundOrigin(match.slot);
  const spawns = BG_BASES[team].spawns;
  const sp = spawns[index % spawns.length];
  e.pos = ctx.groundPos(origin.x + sp.x, origin.z + sp.z);
  e.prevPos = { ...e.pos };
  e.facing = team === 0 ? 0 : Math.PI; // face the field
  e.prevFacing = e.facing;
  ctx.rebucket(e);
  ctx.readyArenaFighter(e, { clearPrep: true });
  // readyArenaFighter revives but does NOT clear the spirit arm: a fighter
  // seated (or re-seated by the form-up hold) must never stay a ghost.
  e.ghost = false;
  e.corpsePos = null;
  e.corpseInstanceId = null;
}

function spawnFlagEntity(ctx: SimContext, flag: BgFlagState): void {
  const e = createGroundObject(ctx.nextId++, '', `${BG_TEAM_NAMES[flag.team]} Flag`, {
    ...flag.pos,
  });
  e.templateId = 'bg_flag';
  e.objectItemId = null;
  e.lootable = false;
  e.color = BG_TEAM_COLORS[flag.team];
  ctx.addEntity(e);
  flag.entityId = e.id;
}

export const RUNE_VISUALS: Record<BgRuneType, { name: string; color: number }> = {
  sprint: { name: 'Sprint Rune', color: 0xff9a3c }, // orange (owner call), not gold-white
  damage: { name: 'Battle Rune', color: 0xe0392e }, // red
  defense: { name: 'Ward Rune', color: 0x3ccfe8 }, // cyan
};

function spawnRuneEntity(ctx: SimContext, rune: BgRuneState): void {
  const visual = RUNE_VISUALS[rune.type];
  const e = createGroundObject(ctx.nextId++, '', visual.name, { ...rune.pos });
  e.templateId = 'bg_rune';
  e.objectItemId = null;
  e.lootable = false;
  e.color = visual.color;
  ctx.addEntity(e);
  rune.entityId = e.id;
}

// One team-wide respawn clock per side, period BG_WAVE_PERIOD, the two clocks
// offset by BG_WAVE_OFFSET (staggered half-cycles, never synchronized). The
// wave raises every RELEASED spirit waiting in the team graveyard, together,
// in place; a corpse that never released waits for a later wave (release is
// the classic rite, and auto-release makes sure nobody waits forever).
function tickWaveRespawns(ctx: SimContext, match: BgMatch): void {
  for (const team of [0, 1] as BgTeam[]) {
    match.waveIn[team] -= DT;
    if (match.waveIn[team] > 0) continue;
    match.waveIn[team] += BG_WAVE_PERIOD;
    match.teams[team].forEach((pid) => {
      const e = ctx.entities.get(pid);
      if (!e || !e.dead || !e.ghost) return;
      e.ghost = false;
      // Cooldowns persist through a battleground death (classic rules); only
      // the match start hands out the full clean slate.
      ctx.readyArenaFighter(e, { clearPrep: false });
      // Rise where the spirit stands (inside the plot), facing the field.
      e.prevPos = { ...e.pos };
      e.facing = team === 0 ? 0 : Math.PI;
      e.prevFacing = e.facing;
      ctx.emit({ type: 'respawn', pid });
    });
  }
}

// The graveyard ward: a released spirit is bound to its team plot until the
// wave raises it. The corpse itself is untouched: releasing is the PLAYER'S
// deliberate press (classic rules, no auto-release, no corpse timer), and the
// wave only ever raises released spirits.
function tickGraveyards(ctx: SimContext, match: BgMatch): void {
  const origin = battlegroundOrigin(match.slot);
  // The ward box is the plot inset past the fence rails (which sit ON the
  // plot edge and intrude 1yd) plus the body radius, so the clamp can never
  // park a spirit inside a rail or the keep walls.
  const WARD_INSET = 1.6;
  for (const team of [0, 1] as BgTeam[]) {
    const plot = BG_GRAVEYARDS[team];
    const minX = origin.x + plot.x - plot.hw + WARD_INSET;
    const maxX = origin.x + plot.x + plot.hw - WARD_INSET;
    const minZ = origin.z + plot.z - plot.hd + WARD_INSET;
    const maxZ = origin.z + plot.z + plot.hd - WARD_INSET;
    for (const pid of match.teams[team]) {
      const e = ctx.entities.get(pid);
      if (!e || !e.dead || !e.ghost) continue;
      const cx = Math.min(maxX, Math.max(minX, e.pos.x));
      const cz = Math.min(maxZ, Math.max(minZ, e.pos.z));
      if (cx !== e.pos.x || cz !== e.pos.z) {
        e.pos = ctx.groundPos(cx, cz);
        e.prevPos = { ...e.pos };
        ctx.rebucket(e);
      }
    }
  }
}

function tickRunes(ctx: SimContext, match: BgMatch): void {
  for (const rune of match.runes) {
    if (!rune.active) {
      rune.cooldown -= DT;
      if (rune.cooldown <= 0) {
        rune.active = true;
        spawnRuneEntity(ctx, rune);
      }
      continue;
    }
    // first live player to step on it claims the sprint (team roster order
    // within a tick: deterministic, no rng)
    for (const pid of bgAllPids(match)) {
      const e = ctx.entities.get(pid);
      if (!e || e.dead) continue;
      if (dist2d(e.pos, rune.pos) <= BG_RUNE_RADIUS) {
        if (rune.type === 'sprint') {
          ctx.applyAura(e, {
            id: SPRINT_RUNE_AURA_ID,
            name: 'Sprint',
            kind: 'buff_speed',
            value: BG_RUNE_SPEED,
            remaining: BG_RUNE_DURATION,
            duration: BG_RUNE_DURATION,
            sourceId: e.id,
            school: 'physical',
          });
          ctx.emit({ type: 'log', text: 'You seize a Sprint Rune!', color: '#ff9a3c', pid });
        } else if (rune.type === 'damage') {
          ctx.applyAura(e, {
            id: BATTLE_RUNE_AURA_ID,
            name: 'Battle Rune',
            kind: 'buff_dmg_done',
            value: BG_POWER_RUNE_VALUE,
            remaining: BG_POWER_RUNE_DURATION,
            duration: BG_POWER_RUNE_DURATION,
            sourceId: e.id,
            school: 'physical',
          });
          ctx.emit({ type: 'log', text: 'You seize a Battle Rune!', color: '#ff6a5a', pid });
        } else {
          ctx.applyAura(e, {
            id: WARD_RUNE_AURA_ID,
            name: 'Ward Rune',
            kind: 'shield_wall',
            value: BG_POWER_RUNE_VALUE,
            remaining: BG_POWER_RUNE_DURATION,
            duration: BG_POWER_RUNE_DURATION,
            sourceId: e.id,
            school: 'physical',
          });
          ctx.emit({ type: 'log', text: 'You seize a Ward Rune!', color: '#3ccfe8', pid });
        }
        rune.active = false;
        rune.cooldown = BG_RUNE_COOLDOWN;
        if (rune.entityId >= 0) {
          ctx.dropEntity(rune.entityId);
          rune.entityId = -1;
        }
        // A claimed power pad flips its face for the next spawn: variety
        // without a single draw in the active phase.
        if (rune.type !== 'sprint') rune.type = rune.type === 'damage' ? 'defense' : 'damage';
        break;
      }
    }
  }
}

function tickFlags(ctx: SimContext, match: BgMatch): void {
  // TWO PASSES, and the split is the point. A capture needs the runner's own
  // flag to be home, so if returns and capture checks shared one pass in flag
  // index order, whether a waiting runner scored on this tick or the next one
  // would depend on which team they were: team 0's flag is returned in
  // iteration 0 (before team 1's carried flag is checked), while team 1's is
  // returned in iteration 1 (after team 0's carried flag was already checked).
  // One tick is 50ms and changes no outcome, but a rated field must not be
  // asymmetric between the two sides at all, so every return lands first and
  // both teams' capture checks then read the same world.
  for (const flag of match.flags) {
    if (flag.state !== 'dropped') continue;
    for (const pid of match.teams[flag.team]) {
      const e = ctx.entities.get(pid);
      if (!e || e.dead) continue;
      if (dist2d(e.pos, flag.pos) <= BG_PICKUP_RADIUS) {
        returnFlag(ctx, match, flag, ctx.players.get(pid)?.name ?? '');
        break;
      }
    }
  }
  for (const flag of match.flags) {
    if (flag.state === 'carried') {
      tickCarriedFlag(ctx, match, flag);
      continue;
    }
    // The flag's own team already had its chance to return this flag in the
    // pass above, which is what keeps an automatic return beating a same-tick
    // pickup press (the pinned race rule): a returned flag is no longer
    // 'dropped' by the time the press below is read.
    //
    // The ENEMY team picks it up (from stand or ground) only via the
    // deliberate battleground action press; never by walk-over.
    let taken = false;
    for (const pid of bgAllPids(match)) {
      if (!match.pendingFlagPress.has(pid)) continue;
      const e = ctx.entities.get(pid);
      if (!e || e.dead) continue;
      const team = bgTeamOf(match, pid);
      if (team === flag.team) continue;
      if (dist2d(e.pos, flag.pos) > BG_PICKUP_RADIUS) continue;
      if (match.flags.some((f) => f.carrier === pid)) continue; // one flag per runner
      flag.state = 'carried';
      flag.carrier = pid;
      flag.carrySeconds = 0;
      bgBreakStealth(ctx, e); // and a revealing one: stealth never survives it
      // The flag is carried ON FOOT. A mounted runner is thrown out of the
      // saddle the moment they take it, and an in-flight summon is cancelled
      // with it (the casting-lifecycle pattern), so grabbing mid-summon cannot
      // land a player on a mount a second and a half later.
      ctx.forceDismount(e);
      e.mountCastRemaining = 0;
      e.mountCastKey = '';
      const byName = ctx.players.get(pid)?.name ?? '?';
      bgEmitAll(ctx, match, (mp) =>
        ctx.emit({
          type: 'bgFlag',
          action: 'taken',
          team: flag.team,
          byName,
          scoreCrimson: match.scores[0],
          scoreAzure: match.scores[1],
          pid: mp,
        }),
      );
      taken = true;
      break;
    }
    if (taken) continue;
    if (flag.state === 'dropped') {
      flag.dropTimer -= DT;
      if (flag.dropTimer <= 0) returnFlag(ctx, match, flag, '');
    }
  }
}

function tickCarriedFlag(ctx: SimContext, match: BgMatch, flag: BgFlagState): void {
  const carrier = flag.carrier !== null ? ctx.entities.get(flag.carrier) : null;
  if (!carrier || carrier.dead || ctx.bgMatches.get(flag.carrier ?? -1) !== match) {
    dropFlag(ctx, match, flag, carrier ?? null);
    return;
  }
  // The classic invisibility rule: flags and hiding never mix. A carrier who
  // turns invisible by ANY means (Stealth, Prowl, a vanish, Greater
  // Invisibility: everything rides the stealth aura kind) drops the flag on
  // the spot and stays hidden, flagless. The enemy team never chases an
  // entity their snapshots cannot see.
  if (carrier.stealthed) {
    dropFlag(ctx, match, flag, carrier);
    return;
  }
  flag.pos = { ...carrier.pos };
  syncFlagEntity(ctx, flag);
  // Carrier vulnerability (Focused Assault lineage; see the consts above).
  flag.carrySeconds += DT;
  const stacks =
    flag.carrySeconds >= BG_CARRIER_VULN_DELAY
      ? 1 + Math.floor((flag.carrySeconds - BG_CARRIER_VULN_DELAY) / BG_CARRIER_VULN_INTERVAL)
      : 0;
  if (stacks !== flag.vulnStacks) {
    flag.vulnStacks = stacks;
    const existing = carrier.auras.find((a) => a.id === CARRIER_VULN_AURA_ID);
    if (existing) {
      existing.value = stacks * BG_CARRIER_VULN_PER_STACK;
      existing.stacks = stacks;
    } else {
      ctx.applyAura(carrier, {
        id: CARRIER_VULN_AURA_ID,
        name: 'Carrier Fatigue',
        kind: 'vulnerability',
        value: stacks * BG_CARRIER_VULN_PER_STACK,
        stacks,
        remaining: BG_MAX_DURATION,
        duration: BG_MAX_DURATION,
        sourceId: carrier.id,
        school: 'shadow',
      });
    }
  }
  // Captured: carry the enemy flag home to your own stand. CLASSIC GATE: the
  // capture only resolves while your OWN flag sits at home. A carrier waiting
  // at the stand captures automatically the moment their flag is returned.
  const carrierTeam = bgTeamOf(match, flag.carrier ?? -1);
  const ownHome = match.flags[carrierTeam].home;
  if (
    dist2d(carrier.pos, ownHome) <= BG_CAPTURE_RADIUS &&
    match.flags[carrierTeam].state === 'home'
  ) {
    captureFlag(ctx, match, flag, carrierTeam);
  }
}

function clearCarrierVuln(ctx: SimContext, flag: BgFlagState): void {
  const carrier = flag.carrier !== null ? ctx.entities.get(flag.carrier) : null;
  flag.carrySeconds = 0;
  flag.vulnStacks = 0;
  if (!carrier) return;
  const idx = carrier.auras.findIndex((a) => a.id === CARRIER_VULN_AURA_ID);
  if (idx >= 0) {
    const [aura] = carrier.auras.splice(idx, 1);
    ctx.emit({ type: 'aura', targetId: carrier.id, name: aura.name, gained: false });
  }
}

function syncFlagEntity(ctx: SimContext, flag: BgFlagState): void {
  const e = ctx.entities.get(flag.entityId);
  if (!e) return;
  e.pos = { ...flag.pos };
  e.prevPos = { ...flag.pos };
  ctx.rebucket(e);
}

function captureFlag(
  ctx: SimContext,
  match: BgMatch,
  flag: BgFlagState,
  scoringTeam: BgTeam,
): void {
  const carrierPid = flag.carrier;
  const carrierName = carrierPid !== null ? (ctx.players.get(carrierPid)?.name ?? '?') : '?';
  match.scores[scoringTeam]++;
  if (carrierPid !== null) {
    const meta = ctx.players.get(carrierPid);
    if (meta) {
      meta.bgCaptures++;
      ctx.markDeedsDirty(carrierPid);
    }
    const stat = match.stats.get(carrierPid);
    if (stat) stat.captures++;
  }
  returnFlag(ctx, match, flag, '', true); // the captured flag resets home
  bgEmitAll(ctx, match, (mp) =>
    ctx.emit({
      type: 'bgFlag',
      action: 'captured',
      team: flag.team,
      byName: carrierName,
      scoreCrimson: match.scores[0],
      scoreAzure: match.scores[1],
      pid: mp,
    }),
  );
  if (match.scores[scoringTeam] >= BG_CAPS_TO_WIN) enterBgEndHold(ctx, match, scoringTeam, 'caps');
}

// Returns a flag to its stand. `silent` skips the event (capture emits its own).
function returnFlag(
  ctx: SimContext,
  match: BgMatch,
  flag: BgFlagState,
  byName: string,
  silent = false,
): void {
  clearCarrierVuln(ctx, flag);
  flag.state = 'home';
  flag.carrier = null;
  flag.dropTimer = 0;
  flag.pos = { ...flag.home };
  syncFlagEntity(ctx, flag);
  if (!silent) {
    bgEmitAll(ctx, match, (mp) =>
      ctx.emit({
        type: 'bgFlag',
        action: 'returned',
        team: flag.team,
        byName,
        scoreCrimson: match.scores[0],
        scoreAzure: match.scores[1],
        pid: mp,
      }),
    );
  }
}

/** Strip every stealth-kind aura (Stealth, Prowl, vanishes, invisibility all
 *  share the kind) and refresh the live cache, mirroring Sim.breakStealth:
 *  a flag grab is a deliberate, revealing act. */
function bgBreakStealth(ctx: SimContext, e: Entity): void {
  for (let i = e.auras.length - 1; i >= 0; i--) {
    if (e.auras[i].kind !== 'stealth') continue;
    const name = e.auras[i].name;
    e.auras.splice(i, 1);
    ctx.emit({ type: 'aura', targetId: e.id, name, gained: false });
  }
  e.stealthed = false; // keep the cache live without waiting for updateAuras
}

function dropFlag(ctx: SimContext, match: BgMatch, flag: BgFlagState, at: Entity | null): void {
  const carrierName = flag.carrier !== null ? (ctx.players.get(flag.carrier)?.name ?? '?') : '?';
  clearCarrierVuln(ctx, flag);
  flag.state = 'dropped';
  flag.carrier = null;
  flag.dropTimer = BG_FLAG_RETURN_TIME;
  if (at) flag.pos = { x: at.pos.x, y: at.pos.y, z: at.pos.z };
  syncFlagEntity(ctx, flag);
  bgEmitAll(ctx, match, (mp) =>
    ctx.emit({
      type: 'bgFlag',
      action: 'dropped',
      team: flag.team,
      byName: carrierName,
      scoreCrimson: match.scores[0],
      scoreAzure: match.scores[1],
      pid: mp,
    }),
  );
}

/** Death hook (combat/damage.ts): carrier death drops the flag in place, the
 *  tallies move, and every match member gets the kill-feed event. The corpse
 *  then waits for the player's own release (spirit.ts owns the rite). */
export function bgOnPlayerDeath(ctx: SimContext, e: Entity, killer: Entity | null): void {
  const match = ctx.bgMatches.get(e.id);
  if (!match || match.state !== 'active') return;
  for (const flag of match.flags) {
    if (flag.carrier === e.id) dropFlag(ctx, match, flag, e);
  }
  const victimStats = match.stats.get(e.id);
  if (victimStats) victimStats.deaths++;
  // Credit the kill to the enemy player behind the blow (a controlled pet
  // credits its owner); same-team and out-of-match sources never count.
  const creditEntity =
    killer?.kind === 'player'
      ? killer
      : killer?.ownerId != null
        ? ctx.entities.get(killer.ownerId)
        : null;
  const credited =
    creditEntity &&
    ctx.bgMatches.get(creditEntity.id) === match &&
    bgTeamOf(match, creditEntity.id) !== bgTeamOf(match, e.id)
      ? creditEntity
      : null;
  if (credited) {
    const killerStats = match.stats.get(credited.id);
    if (killerStats) killerStats.kills++;
  }
  // Kill feed: names + teams only (the client owns the localized line); an
  // uncredited death still feeds, with a null killer.
  const victimName = ctx.players.get(e.id)?.name ?? '';
  const killerName = credited ? (ctx.players.get(credited.id)?.name ?? '') : null;
  const killerTeam = credited ? bgTeamOf(match, credited.id) : null;
  const victimTeam = bgTeamOf(match, e.id);
  for (const pid of bgAllPids(match)) {
    ctx.emit({ type: 'bgKill', pid, killerName, victimName, killerTeam, victimTeam });
  }
}

/**
 * Is this player carrying an enemy flag right now? The one place the question
 * is answered, because more than the battleground asks it: the mount gate
 * refuses a saddle to a carrier, and a runner may only hold one flag.
 */
export function bgCarryingFlag(ctx: SimContext, pid: number): boolean {
  const match = ctx.bgMatches.get(pid);
  return match ? match.flags.some((f) => f.carrier === pid) : false;
}

/** Disconnect/leave/jail mid-match: the deserter takes the rating loss and a
 *  recorded L on the spot (a rated ladder must never reward pulling the plug
 *  while losing), drops any carried flag, and leaves the roster (the team
 *  fights on a player down); a fully vacated side forfeits. */
export function bgResolveDesertion(ctx: SimContext, pid: number): void {
  const match = ctx.bgMatches.get(pid);
  if (!match) return;
  for (const flag of match.flags) {
    if (flag.carrier === pid) dropFlag(ctx, match, flag, ctx.entities.get(pid) ?? null);
  }
  const team = bgTeamOf(match, pid);
  const deserter = ctx.players.get(pid);
  if (deserter && match.rated && !match.resultRecorded) {
    const other = team === 0 ? 1 : 0;
    // The loss delta at score 0 from the deserter's side; no honor (forfeit rule).
    const delta = eloDelta(match.ratingAvg[team], match.ratingAvg[other], 0);
    deserter.bgRating = Math.max(BG_MIN_RATING, deserter.bgRating + delta);
    deserter.bgLosses++;
    ctx.markDeedsDirty(pid);
  }
  // Restore the leaver's body the way endBgMatch would: revive, clear any
  // ghost/corpse state, and send them home to where they queued from. A
  // deserter must never be left dead (or a ghost) stranded inside the band,
  // where the bg rez refusals no longer apply once the match entry is gone.
  const leaver = ctx.entities.get(pid);
  if (leaver) {
    ctx.readyArenaFighter(leaver, { clearPrep: true });
    leaver.dead = false;
    leaver.ghost = false;
    leaver.corpsePos = null;
    leaver.corpseInstanceId = null;
    const ret = match.returns.get(pid);
    if (ret) {
      leaver.pos = ctx.groundPos(ret.x, ret.z);
      leaver.prevPos = { ...leaver.pos };
      leaver.facing = ret.facing;
    }
    ctx.rebucket(leaver);
  }
  match.teams[team] = match.teams[team].filter((p) => p !== pid);
  match.returns.delete(pid);
  match.preMatchPools.delete(pid);
  match.stats.delete(pid);
  match.pendingFlagPress.delete(pid);
  ctx.bgMatches.delete(pid);
  // A deserter auto-added to the team party leaves it too; a premade member
  // keeps their own group (they deserted the match, not their friends).
  unwindBgAutoPartyFor(ctx, match.autoPartyPids, pid);
  // A fully vacated side forfeits, but ONLY while the match is still being
  // played. During the 'ended' hold the result is already recorded and the
  // frozen scoreboard belongs to everyone still reading it: forfeiting there
  // would end that hold early and yank the screen away from them (the result
  // itself is safe either way, resolveBgResult no-ops on resultRecorded).
  if (match.state !== 'ended' && (match.teams[0].length === 0 || match.teams[1].length === 0)) {
    const winner: BgTeam | null =
      match.teams[0].length === 0 && match.teams[1].length === 0
        ? null
        : match.teams[0].length === 0
          ? 1
          : 0;
    endBgMatch(ctx, match, winner, 'forfeit');
  }
}

/** Dev/test only: resolve the caller's live match NOW on the current score
 *  (ties draw) through the normal end-hold flow, so the frozen result screen
 *  and the release are exercised exactly like a played-out finish. Returns
 *  false when the caller is not in an unresolved match. */
export function devEndBg(ctx: SimContext, pid: number): boolean {
  const match = ctx.bgMatches.get(pid);
  if (!match || match.resultRecorded) return false;
  const w: BgTeam | null =
    match.scores[0] === match.scores[1] ? null : match.scores[0] > match.scores[1] ? 0 : 1;
  enterBgEndHold(ctx, match, w, 'timeout');
  return true;
}

// The played-out ending: resolve the result on the spot, then hold everyone
// on a frozen result screen (state 'ended', combat off) for BG_END_HOLD
// before releaseBgFighters sends them home. Flags come home silently so no
// carry outlives the battle.
function enterBgEndHold(
  ctx: SimContext,
  match: BgMatch,
  winnerTeam: BgTeam | null,
  reason: 'caps' | 'timeout',
): void {
  if (match.resultRecorded) return;
  resolveBgResult(ctx, match, winnerTeam, reason);
  match.state = 'ended';
  match.timer = BG_END_HOLD;
  for (const flag of match.flags) returnFlag(ctx, match, flag, '', true);
}

// winnerTeam null = draw: Elo moves by the draw math (score 0.5) and no W/L
// is recorded. Honor pays on played-out results only, never on forfeit.
// Immediate variant (forfeits, teardown paths, tests): resolve AND release in
// one call; the played-out tick path goes through enterBgEndHold instead.
export function endBgMatch(
  ctx: SimContext,
  match: BgMatch,
  winnerTeam: BgTeam | null,
  reason: 'caps' | 'timeout' | 'forfeit',
): void {
  resolveBgResult(ctx, match, winnerTeam, reason);
  releaseBgFighters(ctx, match);
}

/** The RESULT half: ratings, W/L, honor, deeds, and the bgEnd events. Runs
 *  exactly once per match (resultRecorded); never touches bodies or slots. */
function resolveBgResult(
  ctx: SimContext,
  match: BgMatch,
  winnerTeam: BgTeam | null,
  reason: 'caps' | 'timeout' | 'forfeit',
): void {
  if (match.resultRecorded) return;
  match.resultRecorded = true;
  match.winner = winnerTeam;
  // Team Elo over team-average ratings, zero-sum by construction: one delta is
  // computed from the winner's perspective and applied with opposite signs
  // (the rating floor is the only, deliberate, exception).
  const score0 = winnerTeam === null ? 0.5 : winnerTeam === 0 ? 1 : 0;
  const delta0 = match.rated ? eloDelta(match.ratingAvg[0], match.ratingAvg[1], score0) : 0;
  for (const team of [0, 1] as BgTeam[]) {
    const delta = team === 0 ? delta0 : -delta0;
    const won = winnerTeam === team;
    const opponentKey = match.honorTeamKeys[team === 0 ? 1 : 0];
    for (const pid of match.teams[team]) {
      const meta = ctx.players.get(pid);
      if (!meta) continue;
      const before = meta.bgRating;
      meta.bgRating = Math.max(BG_MIN_RATING, before + delta);
      if (match.rated && winnerTeam !== null) {
        if (won) meta.bgWins++;
        else meta.bgLosses++;
      }
      if (match.rated && reason !== 'forfeit') {
        awardBattlegroundHonor(
          ctx,
          meta,
          opponentKey,
          winnerTeam === null ? 'draw' : won ? 'win' : 'loss',
        );
      }
      ctx.markDeedsDirty(pid);
      ctx.emit({
        type: 'bgEnd',
        pid,
        draw: winnerTeam === null,
        won,
        scoreCrimson: match.scores[0],
        scoreAzure: match.scores[1],
        ratingBefore: before,
        ratingAfter: meta.bgRating,
      });
    }
  }
}

/** The RELEASE half: field teardown and everyone home. Runs exactly once
 *  (fightersReleased), at the end of the hold or immediately on a forfeit. */
function releaseBgFighters(ctx: SimContext, match: BgMatch): void {
  if (match.fightersReleased) return;
  match.fightersReleased = true;
  for (const pid of bgAllPids(match)) ctx.bgMatches.delete(pid);
  ctx.bgBusySlots.delete(match.slot);
  // Unwind the match-formed party links FIRST, so the disband/leave notices
  // land before the fighters are teleported home (premades stay intact).
  unwindBgTeamParties(ctx, match.autoPartyPids);
  for (const flag of match.flags) {
    clearCarrierVuln(ctx, flag);
    if (flag.entityId >= 0 && ctx.entities.has(flag.entityId)) ctx.dropEntity(flag.entityId);
  }
  for (const rune of match.runes) {
    if (rune.entityId >= 0 && ctx.entities.has(rune.entityId)) ctx.dropEntity(rune.entityId);
  }
  for (const team of [0, 1] as BgTeam[]) {
    for (const pid of match.teams[team]) {
      const e = ctx.entities.get(pid);
      // Send the fighter home to where they queued from. The match is a
      // parenthesis, not a rest stop: HP, resource, cooldowns and CC DR are
      // handed back exactly as carried in (the arena issue #1600 rule).
      if (!e) continue;
      ctx.readyArenaFighter(e, { clearPrep: true });
      const pools = match.preMatchPools.get(pid);
      if (pools) {
        e.cooldowns = new Map(pools.cooldowns);
        e.abilityCharges =
          Object.keys(pools.abilityCharges).length > 0
            ? clonePools(pools.abilityCharges)
            : undefined;
        e.ccDr = new Map([...pools.ccDr].map(([k, v]) => [k, { ...v }]));
        e.hp = Math.max(1, Math.min(pools.hp, e.maxHp));
        e.resource = Math.max(0, Math.min(pools.resource, e.maxResource));
      }
      const ret = match.returns.get(pid);
      if (ret) {
        e.pos = ctx.groundPos(ret.x, ret.z);
        e.prevPos = { ...e.pos };
        e.facing = ret.facing;
      }
      e.dead = false;
      // A fighter who was a released spirit when the match ended must not
      // carry the ghost state home (ghost implies dead everywhere else, and
      // moveSpeedMult/serialize both read it).
      e.ghost = false;
      e.corpsePos = null;
      e.corpseInstanceId = null;
      ctx.rebucket(e);
      ctx.emit({ type: 'respawn', pid });
    }
  }
}

function clonePools(src: ArenaReturnPools['abilityCharges']): ArenaReturnPools['abilityCharges'] {
  const out: ArenaReturnPools['abilityCharges'] = {};
  for (const [id, state] of Object.entries(src)) out[id] = { ...state };
  return out;
}

// The per-viewer wire view. The viewer-identical match core is memoized per
// tick on the match (build-once; the per-viewer remainder is three scalars).
export function bgInfoFor(ctx: SimContext, pid: number): import('../../world_api').BgInfo | null {
  const meta = ctx.players.get(pid);
  if (!meta) return null;
  const match = ctx.bgMatches.get(pid);
  let matchInfo: import('../../world_api').BgMatchInfo | null = null;
  if (match) {
    const shared = sharedMatchView(ctx, match);
    const myTeam = bgTeamOf(match, pid);
    const e = ctx.entities.get(pid);
    matchInfo = {
      ...shared,
      myTeam,
      // The wave countdown is a GHOST's readout: a corpse shows nothing (the
      // release press is the player's own move, on their own time).
      respawnIn: e?.dead && e?.ghost ? Math.ceil(match.waveIn[myTeam]) : 0,
    };
  }
  const group = bgGroupContaining(ctx, pid);
  return {
    rating: meta.bgRating,
    wins: meta.bgWins,
    losses: meta.bgLosses,
    captures: meta.bgCaptures,
    queued: group !== null,
    queueSize: bgQueueSize(ctx),
    queuedParty: group?.pids.length ?? 1,
    match: matchInfo,
  };
}

function sharedMatchView(ctx: SimContext, match: BgMatch): import('../../world_api').BgMatchInfo {
  if (match.viewTick === ctx.tickCount && match.viewShared) return match.viewShared;
  const flags = match.flags.map((f) => ({
    state: f.state,
    carrierPid: f.carrier,
    carrierName: f.carrier !== null ? (ctx.players.get(f.carrier)?.name ?? null) : null,
    carrierTeam: f.carrier !== null ? bgTeamOf(match, f.carrier) : null,
  })) as [import('../../world_api').BgFlagInfo, import('../../world_api').BgFlagInfo];
  const players: import('../../world_api').BgPlayerInfo[] = [];
  for (const team of [0, 1] as BgTeam[]) {
    for (const mp of match.teams[team]) {
      const e = ctx.entities.get(mp);
      const m = ctx.players.get(mp);
      if (!e || !m) continue;
      const stat = match.stats.get(mp);
      players.push({
        pid: mp,
        name: m.name,
        cls: m.cls,
        team,
        carrying: match.flags.some((f) => f.carrier === mp),
        dead: e.dead,
        kills: stat?.kills ?? 0,
        deaths: stat?.deaths ?? 0,
        captures: stat?.captures ?? 0,
      });
    }
  }
  const shared: import('../../world_api').BgMatchInfo = {
    state: match.state,
    myTeam: 0, // per-viewer; overwritten in bgInfoFor
    capsToWin: BG_CAPS_TO_WIN,
    scores: [match.scores[0], match.scores[1]],
    flags,
    players,
    countdown: match.state === 'active' ? 0 : Math.max(0, Math.ceil(match.timer)),
    timeLeft:
      match.state === 'active'
        ? Math.max(0, Math.ceil(BG_MAX_DURATION - match.timer))
        : match.state === 'ended'
          ? 0
          : BG_MAX_DURATION,
    waveIn: [Math.ceil(match.waveIn[0]), Math.ceil(match.waveIn[1])],
    respawnIn: 0, // per-viewer; overwritten in bgInfoFor
    winner: match.state === 'ended' ? match.winner : null,
  };
  match.viewTick = ctx.tickCount;
  match.viewShared = shared;
  return shared;
}

// Dev/test only: force-start a battleground from whoever is queued, split into
// two teams even if there aren't a full ten. Server-gated behind
// ALLOW_DEV_COMMANDS so it never runs in production.
export function devStartBg(ctx: SimContext): void {
  const pids = ctx.bgQueue
    .flatMap((g) => g.pids)
    .filter((p) => ctx.entities.get(p) && !ctx.bgMatches.has(p));
  if (pids.length < 2) return;
  const take = pids.slice(0, BG_TEAM_SIZE * 2);
  const half = Math.ceil(take.length / 2);
  const teamA = take.slice(0, half);
  const teamB = take.slice(half);
  ctx.bgQueue = ctx.bgQueue
    .map((g) => ({ ...g, pids: g.pids.filter((p) => !take.includes(p)) }))
    .filter((g) => g.pids.length > 0);
  startBgMatch(ctx, teamA, teamB, { rated: false });
}
