// World PvP (the /pvp flag): the system half, behind the SimContext seam.
//
// A player raises the flag with /pvp (or the World PvP tab of the PvP window)
// and becomes attackable by, and able to attack, every other flagged player
// who is not in their party or raid (a shared guild is no shield), anywhere
// the ground allows it. The ground has three answers (world_pvp_zones.ts): a
// sanctuary switches the world off for everyone in it, a free-for-all zone
// makes everyone standing in it fair game with no flag at all, and everywhere
// else is contested: the mutual-flag rule. In a free-for-all zone the first
// hit on an unflagged player MARKS the attacker (raises their flag), so an
// aggressor always ends up carrying the stake; whoever hits a flagged player,
// the victim included, is never marked for it.
//
// Lowering the flag takes WORLD_PVP_DISARM_SECONDS, and the drop waits for
// combat to end. A kill moves a gold stake (world_pvp_rules.ts worldPvpStake)
// from a FLAGGED victim's purse (an unflagged player killed in a free-for-all
// zone loses nothing) and pays a share of the honor pool to everyone who
// worked for it: the killing blow, everyone who damaged the victim inside the
// assist window, and every healer who kept one of those damagers standing.
// Healing, shielding or buffing a flagged player who is in a world fight
// raises the caster's own flag first (the classic rule), so nobody can carry a
// fight from behind a flag they do not wear. The books that remember who hit,
// healed and killed whom live on the Sim as ONE live view (`ctx.worldPvpBooks`),
// never inside this module: the modules hold functions, the Sim holds state
// (src/sim/CLAUDE.md).
//
// Authority and persistence: `PlayerMeta.worldPvp` is the truth (persisted in
// the character blob, absent until the character first raises the flag so an
// unflagged save stays byte-identical); `Entity.pvpFlag` is the display mirror
// that rides the entity wire, written ONLY here, the away.ts precedent. The
// per-pair diminishing returns are a session book keyed by the two characters'
// rename-proof identities with a WORLD_PVP_DR_WINDOW_SECONDS window from the
// first kill: a relog cannot reset them (the identity survives it), a realm
// restart does (owner tuning: an hour's window, not a calendar day).
//
// Host-agnostic: no DOM, no rng, no wall clock. The disarm clock, the assist
// window and the DR window run on `ctx.time` (tick math), so the offline Sim,
// the server, and the headless env resolve every flag and every kill
// identically.

import { formatMoney } from '../format_money';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { grantHonor } from './honor';
import { updatePvpVitality } from './vitality';
import {
  WORLD_PVP_ASSIST_WINDOW,
  WORLD_PVP_DISARM_SECONDS,
  WORLD_PVP_DR_WINDOW_SECONDS,
  WORLD_PVP_KILL_HONOR,
  WORLD_PVP_MIN_LEVEL,
  type WorldPvpZonePolicy,
  worldPvpGroupEarns,
  worldPvpHitMarksAttacker,
  worldPvpPairExempt,
  worldPvpPairHostile,
  worldPvpPairMultiplier,
  worldPvpSplit,
  worldPvpStake,
  worldPvpVictimIsGrey,
} from './world_pvp_rules';
import { worldPvpZonePolicyAt } from './world_pvp_zones';

/** The authoritative per-character flag state (PlayerMeta.worldPvp). */
export interface WorldPvpMetaState {
  /** Attackable by, and able to attack, other flagged players right now. Stays
   *  true through the whole disarm countdown. */
  flagged: boolean;
  /** Sim time the flag drops after /pvp off, or null while armed for good (or
   *  not flagged at all). */
  disarmAt: number | null;
  /** Career world kills this character was paid for (every contributor counts,
   *  the classic honorable-kill tally) and career deaths to other players in
   *  the open world. */
  kills: number;
  deaths: number;
  /** Sim time of the last accepted raise/lower/cancel: the toggle cooldown
   *  (WORLD_PVP_TOGGLE_COOLDOWN) reads it. Session-only, never persisted. */
  changedAt?: number;
}

/** The persisted shape (CharacterState.worldPvp). The countdown is stored as
 *  the REMAINING seconds, re-anchored to the loading sim's clock, because sim
 *  time restarts at zero on every boot (the node-readiness precedent). */
export interface WorldPvpSavedState {
  flagged: boolean;
  disarmRemaining?: number;
  kills?: number;
  deaths?: number;
}

/** One contributor's kills of one victim inside the current DR window. */
export interface WorldPvpPairKills {
  count: number;
  /** Sim time of the first kill in this window; the window closes
   *  WORLD_PVP_DR_WINDOW_SECONDS after it. */
  since: number;
}

/** The Sim-owned session books, exposed on SimContext as a live view. The two
 *  recency maps are pruned on every write and cleared on every death, and the
 *  once-a-minute sweep (`updateWorldPvp`) drops any row whose subject has left
 *  the world or whose last stamp aged out of the window, so a player who was
 *  hit and then logged out without dying never leaves a row behind. Bounded by
 *  the players trading blows in the last window, never by realm age. */
export interface WorldPvpBooks {
  /** victim pid -> attacker pid -> sim time of the last enemy hit. */
  recentDamage: Map<number, Map<number, number>>;
  /** ally pid -> healer pid -> sim time of the last heal, shield or buff. */
  recentSupport: Map<number, Map<number, number>>;
  /** Victims whose death already paid, so a re-entrant handleDeath on a corpse
   *  can never pay the kill twice. A pid leaves the set the moment the player
   *  is seen alive again (their next hit taken) and on the sweep. */
  paidDeaths: Set<number>;
  /** "contributor identity>victim identity" -> the DR window. Rows whose
   *  window closed are dropped by the sweep; bounded by the distinct pairs
   *  that traded a paid kill in the last hour. */
  killsByPair: Map<string, WorldPvpPairKills>;
  /** pid -> the zone policy the player stood in at the last zone pass, so the
   *  enter/leave notices fire once per crossing. Rows of players who left the
   *  world are dropped. */
  zoneOf: Map<number, WorldPvpZonePolicy>;
  /** The earliest pending disarm (sim time), Infinity when nobody is switching
   *  off: the per-tick pass is skipped entirely until then, so a realm with no
   *  countdown running pays one comparison per tick, not a roster walk. */
  nextDisarmAt: number;
  /** Ticks of the last zone pass and the last sweep: both run on the dueness
   *  form (`tickCount - last >= interval`, the sweep's shape), never on a
   *  modulo of the tick count, so a pass can never be skipped by a host that
   *  does not visit every tick. Negative infinity runs the zone pass on the
   *  first tick, so a player is told about their ground at once. */
  zonePassTick: number;
  sweptAtTick: number;
}

export function newWorldPvpBooks(): WorldPvpBooks {
  return {
    recentDamage: new Map(),
    recentSupport: new Map(),
    paidDeaths: new Set(),
    killsByPair: new Map(),
    zoneOf: new Map(),
    nextDisarmAt: Number.POSITIVE_INFINITY,
    zonePassTick: Number.NEGATIVE_INFINITY,
    sweptAtTick: 0,
  };
}

const SWEEP_TICKS = 20 * 60;
/** The zone pass runs twice a second: a crossing notice half a second late is
 *  invisible, and the hostility arm itself never reads this pass (it resolves
 *  the ground live), so nothing about who may hit whom waits on it. */
const ZONE_PASS_TICKS = 10;
/** Seconds between accepted flag changes: a client cannot flap the flag at
 *  wire rate and burn the world loop on notices. */
export const WORLD_PVP_TOGGLE_COOLDOWN = 2;
const NOTICE_COLOR = '#ffd100';
const DEFEATED_COLOR = '#ff5555';

/** The notice lines the client matcher re-localizes (src/ui/sim_i18n.ts). */
export const WORLD_PVP_MARKED_LINE = 'World PvP enabled: you attacked an unflagged player.';
export const WORLD_PVP_AIDED_LINE = 'World PvP enabled: you aided a flagged player in combat.';
export const WORLD_PVP_FFA_ENTER_LINE =
  'You have entered a free-for-all PvP zone: anyone here can attack you.';
export const WORLD_PVP_FFA_LEAVE_LINE = 'You have left the free-for-all PvP zone.';
export const WORLD_PVP_SANCTUARY_LINE = 'This is a sanctuary: World PvP is off here.';
/** The refusal a heal, shield or buff meets when its target is a player the
 *  open world has made an enemy (combat/casting_lifecycle.ts): once the aid
 *  rule has flagged a helper, that helper and the stranger they were keeping
 *  up are two flagged strangers, and the only way to keep aiding them is the
 *  exemption, a party. Said out loud rather than self-cast in silence. */
export const WORLD_PVP_AID_REFUSED_LINE =
  'You cannot aid a World PvP enemy: invite them to your party first.';

export function isWorldPvpFlagged(meta: PlayerMeta): boolean {
  return meta.worldPvp?.flagged === true;
}

/** Seconds until the flag drops, or null when it is not switching off. Never
 *  negative: a deferred drop (still in combat) reads as 0. */
export function worldPvpDisarmRemaining(meta: PlayerMeta, now: number): number | null {
  const state = meta.worldPvp;
  if (!state || !state.flagged || state.disarmAt === null) return null;
  return Math.max(0, state.disarmAt - now);
}

function ensureState(meta: PlayerMeta): WorldPvpMetaState {
  if (!meta.worldPvp) meta.worldPvp = { flagged: false, disarmAt: null, kills: 0, deaths: 0 };
  return meta.worldPvp;
}

function playerOf(ctx: SimContext, pid: number): { e: Entity; meta: PlayerMeta } | null {
  const e = ctx.entities.get(pid);
  const meta = ctx.players.get(pid);
  return e && e.kind === 'player' && meta ? { e, meta } : null;
}

function notice(ctx: SimContext, pid: number, text: string, color = NOTICE_COLOR): void {
  ctx.emit({ type: 'log', text, color, pid });
}

/** The disarm delay in whole minutes, for the notice line. */
export const WORLD_PVP_DISARM_MINUTES = Math.round(WORLD_PVP_DISARM_SECONDS / 60);

function raiseFlag(ctx: SimContext, e: Entity, meta: PlayerMeta, text: string): void {
  const state = ensureState(meta);
  state.flagged = true;
  state.disarmAt = null;
  state.changedAt = ctx.time;
  e.pvpFlag = true;
  notice(ctx, e.id, text);
}

/** The gates every AUTOMATIC raise (marking an aggressor, flagging a helper)
 *  shares with the explicit one: a jailed, under-level or already-flagged
 *  player is left as they are, and so is everyone on a realm whose kill switch
 *  is set. Returns the meta to raise on, or null to leave the flag alone. */
function autoRaiseTarget(ctx: SimContext, e: Entity): PlayerMeta | null {
  if (e.pvpFlag || e.jailed || e.level < WORLD_PVP_MIN_LEVEL || ctx.worldPvpDisabled) return null;
  return ctx.players.get(e.id) ?? null;
}

/**
 * Raise or lower the flag. Raising it during the disarm countdown cancels the
 * countdown (the flag never dropped, so nothing re-announces the enable).
 * Lowering it starts the countdown; the actual drop is updateWorldPvp's.
 * Returns true when the request changed something; every refusal and every
 * no-op tells the player why through the error channel.
 */
export function setWorldPvpFlag(ctx: SimContext, pid: number, enabled: boolean): boolean {
  const r = playerOf(ctx, pid);
  if (!r) return false;
  const current = r.meta.worldPvp;
  if (
    current?.changedAt !== undefined &&
    ctx.time - current.changedAt < WORLD_PVP_TOGGLE_COOLDOWN
  ) {
    ctx.error(pid, 'World PvP: wait a moment before switching again.');
    return false;
  }
  if (enabled) {
    if (current?.flagged && current.disarmAt === null) {
      ctx.error(pid, 'World PvP is already enabled.');
      return false;
    }
    if (ctx.worldPvpDisabled) {
      ctx.error(pid, 'World PvP is disabled on this realm.');
      return false;
    }
    if (r.e.level < WORLD_PVP_MIN_LEVEL) {
      ctx.error(pid, `You must be at least level ${WORLD_PVP_MIN_LEVEL} to enable World PvP.`);
      return false;
    }
    if (current?.flagged) {
      // Mid-countdown: keep the flag, drop the clock.
      current.disarmAt = null;
      current.changedAt = ctx.time;
      notice(ctx, pid, 'World PvP stays enabled.');
      return true;
    }
    raiseFlag(ctx, r.e, r.meta, 'World PvP enabled: other flagged players can attack you.');
    return true;
  }
  if (!current?.flagged) {
    ctx.error(pid, 'World PvP is already disabled.');
    return false;
  }
  if (current.disarmAt !== null) {
    ctx.error(pid, 'World PvP is already switching off.');
    return false;
  }
  current.disarmAt = ctx.time + WORLD_PVP_DISARM_SECONDS;
  current.changedAt = ctx.time;
  const books = ctx.worldPvpBooks;
  books.nextDisarmAt = Math.min(books.nextDisarmAt, current.disarmAt);
  notice(ctx, pid, `World PvP will be disabled in ${WORLD_PVP_DISARM_MINUTES} minutes.`);
  return true;
}

/** The bare /pvp: off when armed, on otherwise (an ongoing countdown counts as
 *  "wants it off", so /pvp during one turns it back on, the classic toggle). */
export function toggleWorldPvpFlag(ctx: SimContext, pid: number): boolean {
  const meta = ctx.players.get(pid);
  const armed = meta?.worldPvp?.flagged === true && meta.worldPvp.disarmAt === null;
  return setWorldPvpFlag(ctx, pid, !armed);
}

/** Drop the rows the sweep no longer needs: a subject who left the world, a
 *  roster whose every stamp aged out, a paid death whose victim stands again,
 *  a DR window that closed, a zone row for a player who logged out. */
function sweepBooks(ctx: SimContext, books: WorldPvpBooks): void {
  for (const book of [books.recentDamage, books.recentSupport]) {
    for (const [subject, roster] of book) {
      for (const [pid, at] of roster) {
        if (ctx.time - at > WORLD_PVP_ASSIST_WINDOW) roster.delete(pid);
      }
      if (roster.size === 0 || !ctx.entities.has(subject)) book.delete(subject);
    }
  }
  for (const pid of books.paidDeaths) {
    const e = ctx.entities.get(pid);
    if (!e || !e.dead) books.paidDeaths.delete(pid);
  }
  for (const [key, row] of books.killsByPair) {
    if (ctx.time - row.since >= WORLD_PVP_DR_WINDOW_SECONDS) books.killsByPair.delete(key);
  }
  for (const pid of books.zoneOf.keys()) {
    if (!ctx.players.has(pid)) books.zoneOf.delete(pid);
  }
}

/**
 * The zone pass: tell a player when the ground under them changes what world
 * PvP means. Entering a free-for-all zone always says so (a player who logs
 * in inside one is told on their first pass); leaving it says so; a FLAGGED
 * player entering a sanctuary is told the flag is idle there (an unflagged
 * level-one character walking around the starter zone hears nothing). Every
 * level hears the free-for-all notices: free-for-all ground makes anyone fair
 * game (world_pvp_rules.ts), so a low-level character most of all needs to
 * know they walked onto it. The policy is re-read from the ground each pass, so a teleport or a
 * tow across a zone line is noticed the same as a walk.
 */
function noticeZoneChanges(ctx: SimContext, books: WorldPvpBooks): void {
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e) continue;
    const now = worldPvpZonePolicyAt(e.pos.x, e.pos.z);
    const was = books.zoneOf.get(e.id);
    if (was === now) continue;
    books.zoneOf.set(e.id, now);
    if (now === 'ffa') notice(ctx, e.id, WORLD_PVP_FFA_ENTER_LINE, DEFEATED_COLOR);
    else if (was === 'ffa') notice(ctx, e.id, WORLD_PVP_FFA_LEAVE_LINE);
    else if (now === 'sanctuary' && e.pvpFlag) notice(ctx, e.id, WORLD_PVP_SANCTUARY_LINE);
  }
}

/**
 * Per-tick: drop every flag whose countdown has run out, unless its owner is
 * still in combat (a flag can never fall mid-fight and fizzle the blow already
 * on its way). The roster walk runs only once the earliest pending countdown
 * is due (`nextDisarmAt`); a deferred drop keeps it due every tick until the
 * fight ends. Draws no rng. Twice a second the zone pass runs (above), once a
 * minute the books are swept.
 */
export function updateWorldPvp(ctx: SimContext): void {
  const books = ctx.worldPvpBooks;
  if (ctx.time >= books.nextDisarmAt) {
    let next = Number.POSITIVE_INFINITY;
    for (const meta of ctx.players.values()) {
      const state = meta.worldPvp;
      if (!state || !state.flagged || state.disarmAt === null) continue;
      const e = ctx.entities.get(meta.entityId);
      // A countdown whose entity is not in the world this tick (mid-removal)
      // stays due, so it can never fall out of `nextDisarmAt` unpaid.
      if (!e || ctx.time < state.disarmAt) {
        next = Math.min(next, state.disarmAt);
        continue;
      }
      if (e.inCombat) {
        next = Math.min(next, ctx.time);
        continue;
      }
      state.flagged = false;
      state.disarmAt = null;
      e.pvpFlag = false;
      notice(ctx, meta.entityId, 'World PvP disabled.');
    }
    books.nextDisarmAt = next;
  }
  if (ctx.tickCount - books.zonePassTick >= ZONE_PASS_TICKS) {
    books.zonePassTick = ctx.tickCount;
    // WARFARE Vitality rides this pass but not the world switch: battlegrounds
    // and arenas grant it on a realm with world PvP turned off too.
    updatePvpVitality(ctx);
    if (!ctx.worldPvpDisabled) noticeZoneChanges(ctx, books);
  }
  if (ctx.tickCount - books.sweptAtTick >= SWEEP_TICKS) {
    books.sweptAtTick = ctx.tickCount;
    sweepBooks(ctx, books);
  }
}

/** A player mid-battleground or mid-arena is under that mode's rules, never
 *  the open world's, whatever their flag or their ground says. */
function inInstancedPvp(ctx: SimContext, pid: number): boolean {
  if (ctx.bgMatches.get(pid)?.state === 'active') return true;
  return ctx.arenaMatches.get(pid)?.state === 'active';
}

/** Two players mid-duel are under the duel's rules: a consensual duel fought
 *  on free-for-all ground must never mark either duelist or book its blows as
 *  world kills (the duel arm of isHostileTo already makes them hostile). */
function inActiveDuelTogether(ctx: SimContext, a: number, b: number): boolean {
  const duel = ctx.duels.get(a);
  if (!duel || duel.endedTick !== undefined || duel.state !== 'active') return false;
  return (duel.a === a && duel.b === b) || (duel.b === a && duel.a === b);
}

function inSameParty(ctx: SimContext, a: number, b: number): boolean {
  const party = ctx.partyOf(a);
  return party !== null && party.members.includes(b);
}

/**
 * The open-world hostility arm isHostileTo consults for two PLAYERS (the
 * coordinator resolves a pet to its owner first). Neither jailed (the jail has
 * its own brawl rule), neither in a live battleground or arena, not mid-duel
 * with each other, the realm's kill switch clear, and then the pure pair rule
 * over the two flags and the two zone policies (world_pvp_rules.ts
 * worldPvpPairHostile). Symmetric. Reads the ground live (rectangle scans
 * over the zone table) rather than the zone pass's cache, so a player who
 * just crossed a line, teleported or was towed is judged where they stand.
 * The early returns before the second scan are each implied by the pure
 * rule (an exempt pair, a sanctuary under the attacker, or two unflagged
 * players off free-for-all ground can never be hostile), so the common case
 * on a quiet realm, two unflagged strangers on contested ground, pays the
 * party lookup and one scan and never the second. Does not read `dead`: the
 * death hook uses it to credit contributors who fell before the blow landed,
 * and every attack path already refuses a dead attacker or target on its own.
 */
export function isWorldPvpHostile(ctx: SimContext, attacker: Entity, target: Entity): boolean {
  if (attacker.kind !== 'player' || target.kind !== 'player') return false;
  if (attacker.id === target.id || ctx.worldPvpDisabled) return false;
  if (attacker.jailed || target.jailed) return false;
  if (inInstancedPvp(ctx, attacker.id) || inInstancedPvp(ctx, target.id)) return false;
  if (inActiveDuelTogether(ctx, attacker.id, target.id)) return false;
  const sameParty = inSameParty(ctx, attacker.id, target.id);
  if (worldPvpPairExempt(attacker, target, sameParty)) return false;
  const zoneA = worldPvpZonePolicyAt(attacker.pos.x, attacker.pos.z);
  if (zoneA === 'sanctuary') return false;
  if (zoneA !== 'ffa' && !(attacker.pvpFlag && target.pvpFlag)) return false;
  const zoneB = worldPvpZonePolicyAt(target.pos.x, target.pos.z);
  return worldPvpPairHostile(attacker, target, sameParty, zoneA, zoneB);
}

function controllerOf(ctx: SimContext, source: Entity | null): Entity | null {
  if (!source) return null;
  if (source.kind === 'player') return source;
  if (source.kind === 'mob' && source.ownerId !== null) {
    const owner = ctx.entities.get(source.ownerId);
    return owner?.kind === 'player' ? owner : null;
  }
  return null;
}

function noteRecent(
  book: Map<number, Map<number, number>>,
  subject: number,
  actor: number,
  now: number,
): void {
  let roster = book.get(subject);
  if (!roster) {
    roster = new Map();
    book.set(subject, roster);
  }
  roster.set(actor, now);
  for (const [pid, at] of roster) {
    if (now - at > WORLD_PVP_ASSIST_WINDOW) roster.delete(pid);
  }
}

/** Is this player in a world fight right now: hit by an enemy inside the
 *  window, or the one doing the hitting? Bounded by the rosters of the
 *  players trading blows in the last window. */
function isEngagedInWorldPvp(ctx: SimContext, e: Entity): boolean {
  const books = ctx.worldPvpBooks;
  const fresh = (at: number) => ctx.time - at <= WORLD_PVP_ASSIST_WINDOW;
  const hits = books.recentDamage.get(e.id);
  if (hits) for (const at of hits.values()) if (fresh(at)) return true;
  for (const roster of books.recentDamage.values()) {
    const at = roster.get(e.id);
    if (at !== undefined && fresh(at)) return true;
  }
  return false;
}

/**
 * Damage hook (combat/damage.ts): a world-hostile hit on a player is
 * remembered so the kill it leads to can pay the people who worked for it.
 * A hit that needed no flag (both sides unflagged, so both in a free-for-all
 * zone) marks the attacker: the aggressor now carries the stake, and everyone
 * who hits back is hitting a flagged player and stays as they were
 * (world_pvp_rules.ts worldPvpHitMarksAttacker). Runs for every hit on a live
 * player; a hit the world arm did not allow (a duel, a battleground, a mob)
 * is booked nowhere.
 */
export function worldPvpOnPlayerDamaged(ctx: SimContext, victim: Entity, source: Entity): void {
  const books = ctx.worldPvpBooks;
  // A live hit proves the victim stood up again since their last paid death.
  if (books.paidDeaths.size > 0) books.paidDeaths.delete(victim.id);
  const attacker = controllerOf(ctx, source);
  if (!attacker || !isWorldPvpHostile(ctx, attacker, victim)) return;
  noteRecent(books.recentDamage, victim.id, attacker.id, ctx.time);
  if (worldPvpHitMarksAttacker(attacker, victim)) {
    const meta = autoRaiseTarget(ctx, attacker);
    if (meta) raiseFlag(ctx, attacker, meta, WORLD_PVP_MARKED_LINE);
  }
}

/**
 * Damage hook for a player's PET (combat/damage.ts, the owned-mob arm beside
 * the player one): the hit is judged against the pet's OWNER, so opening on an
 * unflagged stranger's pet in a free-for-all zone marks the attacker exactly as
 * opening on the stranger would (the owner rule: attack someone who is not
 * marked and you are marked; the pet is that someone). Marking only: the
 * assist books key on the owner being hit, and a pet's death is no world kill.
 */
export function worldPvpOnOwnedPetDamaged(ctx: SimContext, pet: Entity, source: Entity): void {
  const owner = controllerOf(ctx, pet);
  const attacker = controllerOf(ctx, source);
  if (!owner || !attacker || attacker.id === owner.id) return;
  if (!isWorldPvpHostile(ctx, attacker, owner) || !worldPvpHitMarksAttacker(attacker, owner)) {
    return;
  }
  const meta = autoRaiseTarget(ctx, attacker);
  if (meta) raiseFlag(ctx, attacker, meta, WORLD_PVP_MARKED_LINE);
}

/**
 * Aid hook (combat/heal.ts for heals, combat/effect_dispatch.ts for absorbs
 * and target buffs): aid to a FLAGGED player is remembered so a kill that
 * player lands can pay the one who kept them standing. An UNFLAGGED caster
 * who aids a flagged player in a world fight raises their own flag first (the
 * classic rule, owner tuning: shields and buffs count "if they are marked for
 * PvP"): the fight then carries the same risk for the caster as for the
 * fighter, and nobody can sustain a killer from behind a flag they do not
 * wear. Aid to an unflagged player never marks anyone, so defending someone
 * who is not marked stays free, and neither does aid given or received inside
 * a sanctuary (no world PvP happens there at all, so a healer in the starter
 * town can never be dragged into a fight kited to its edge). Under
 * WORLD_PVP_MIN_LEVEL the raise is refused like every other, so the aid still
 * lands and earns nothing.
 */
export function worldPvpOnPlayerAided(ctx: SimContext, target: Entity, source: Entity): void {
  if (!target.pvpFlag) return;
  const helper = controllerOf(ctx, source);
  if (!helper || helper.id === target.id) return;
  if (
    worldPvpZonePolicyAt(helper.pos.x, helper.pos.z) === 'sanctuary' ||
    worldPvpZonePolicyAt(target.pos.x, target.pos.z) === 'sanctuary'
  )
    return;
  if (!helper.pvpFlag) {
    if (inInstancedPvp(ctx, target.id) || !isEngagedInWorldPvp(ctx, target)) return;
    const meta = autoRaiseTarget(ctx, helper);
    if (!meta) return;
    raiseFlag(ctx, helper, meta, WORLD_PVP_AIDED_LINE);
  }
  noteRecent(ctx.worldPvpBooks.recentSupport, target.id, helper.id, ctx.time);
}

/** The rename-proof identity the DR book keys a character by (the
 *  honorTeamIdentity convention: database character ids online, the stable
 *  character name offline). */
function identityOf(meta: PlayerMeta): string {
  return meta.characterId !== undefined
    ? `character:${meta.characterId}`
    : `name:${meta.name.trim().toLowerCase()}`;
}

function pairKey(contributor: PlayerMeta, victim: PlayerMeta): string {
  return `${identityOf(contributor)}>${identityOf(victim)}`;
}

/** Kills of this victim this contributor was already paid for inside the open
 *  DR window (0 once the window closed; the sweep drops the row later). */
export function worldPvpPairRepeats(
  ctx: SimContext,
  contributor: PlayerMeta,
  victim: PlayerMeta,
): number {
  const row = ctx.worldPvpBooks.killsByPair.get(pairKey(contributor, victim));
  if (!row || ctx.time - row.since >= WORLD_PVP_DR_WINDOW_SECONDS) return 0;
  return row.count;
}

function notePairKill(ctx: SimContext, contributor: PlayerMeta, victim: PlayerMeta): void {
  const books = ctx.worldPvpBooks;
  const key = pairKey(contributor, victim);
  const row = books.killsByPair.get(key);
  if (!row || ctx.time - row.since >= WORLD_PVP_DR_WINDOW_SECONDS) {
    books.killsByPair.set(key, { count: 1, since: ctx.time });
  } else {
    row.count++;
  }
}

interface Contributor {
  e: Entity;
  meta: PlayerMeta;
  mult: number;
}

/** What one paid contributor is told. Exported for the client matcher tests. */
export function worldPvpKillLine(victimName: string, copper: number, contributors: number): string {
  if (copper <= 0) return `You defeat ${victimName}.`;
  const money = formatMoney(copper);
  if (contributors <= 1) return `You defeat ${victimName} and take ${money} from their purse.`;
  return `You defeat ${victimName} and take ${money} from their purse (split ${contributors} ways).`;
}

/** What the victim is told: the blow alone, the blow and one other, or the blow
 *  and N others (three shapes, so the plural never reads "1 others"). */
export function worldPvpDefeatLine(
  killerName: string,
  copper: number,
  contributors: number,
): string {
  const others = contributors - 1;
  const who =
    others <= 0
      ? killerName
      : others === 1
        ? `${killerName} and 1 other`
        : `${killerName} and ${others} others`;
  const verb = contributors > 1 ? 'defeat' : 'defeats';
  if (copper <= 0) return `${who} ${verb} you.`;
  const take = contributors > 1 ? 'take' : 'takes';
  return `${who} ${verb} you and ${take} ${formatMoney(copper)} from your purse.`;
}

/**
 * Death hook (combat/damage.ts handleDeath, beside the battleground's): resolve
 * a player's death to another player in the open world. The assist rows are
 * read and cleared together and the victim joins `paidDeaths`, so one death
 * pays exactly one round even if the death hub is re-entered on the corpse.
 * Everything is integer copper and integer honor; only a FLAGGED victim stakes
 * gold and only a FLAGGED contributor takes it (an unflagged player who
 * opens on flagged strangers in a free-for-all zone earns the honor and
 * nothing else: gold changes hands only between two players who both carry
 * the stake), and the victim is charged exactly what was paid out, never the
 * full stake when a contributor was grey, fully decayed or unflagged. Cost is
 * bounded by the damagers inside the window times their healers inside the
 * window (a few dozen visits in the largest world brawl), once per world death.
 */
export function worldPvpOnPlayerDeath(
  ctx: SimContext,
  victim: Entity,
  killer: Entity | null,
): void {
  const books = ctx.worldPvpBooks;
  const helpers = books.recentDamage.get(victim.id);
  books.recentDamage.delete(victim.id);
  books.recentSupport.delete(victim.id);
  if (books.paidDeaths.has(victim.id)) return;
  const victimMeta = ctx.players.get(victim.id);
  if (!victimMeta) return;
  const killerPlayer = controllerOf(ctx, killer);
  if (!killerPlayer || !isWorldPvpHostile(ctx, killerPlayer, victim)) return;
  books.paidDeaths.add(victim.id);
  ensureState(victimMeta).deaths++;

  const contributors: Contributor[] = [];
  const seen = new Set<number>();
  const fresh = (at: number) => ctx.time - at <= WORLD_PVP_ASSIST_WINDOW;
  const consider = (pid: number) => {
    if (seen.has(pid)) return;
    seen.add(pid);
    const r = playerOf(ctx, pid);
    if (!r || !isWorldPvpHostile(ctx, r.e, victim)) return;
    if (!worldPvpGroupEarns(ctx.partyOf(pid))) return;
    if (worldPvpVictimIsGrey(r.e.level, victim.level)) return;
    const mult = worldPvpPairMultiplier(worldPvpPairRepeats(ctx, r.meta, victimMeta));
    if (mult <= 0) return;
    contributors.push({ e: r.e, meta: r.meta, mult });
  };
  consider(killerPlayer.id);
  if (helpers) {
    for (const [pid, at] of helpers) {
      if (!fresh(at)) continue;
      consider(pid);
      const support = books.recentSupport.get(pid);
      if (!support) continue;
      for (const [healerPid, healedAt] of support) if (fresh(healedAt)) consider(healerPid);
    }
  }

  const n = contributors.length;
  if (n === 0) {
    notice(ctx, victim.id, worldPvpDefeatLine(killerPlayer.name, 0, 1), DEFEATED_COLOR);
    return;
  }
  const gold = worldPvpSplit(victim.pvpFlag ? worldPvpStake(victimMeta.copper) : 0, n);
  const honor = worldPvpSplit(WORLD_PVP_KILL_HONOR, n);
  let taken = 0;
  for (const c of contributors) {
    const isKiller = c.e.id === killerPlayer.id;
    const goldShare = c.e.pvpFlag
      ? Math.floor((gold.share + (isKiller ? gold.killerBonus : 0)) * c.mult)
      : 0;
    const honorShare = Math.floor((honor.share + (isKiller ? honor.killerBonus : 0)) * c.mult);
    notePairKill(ctx, c.meta, victimMeta);
    ensureState(c.meta).kills++;
    c.meta.copper += goldShare;
    taken += goldShare;
    notice(ctx, c.e.id, worldPvpKillLine(victim.name, goldShare, n));
    grantHonor(ctx, c.meta, honorShare, isKiller ? 'world_kill' : 'world_assist');
  }
  victimMeta.copper = Math.max(0, victimMeta.copper - taken);
  notice(ctx, victim.id, worldPvpDefeatLine(killerPlayer.name, taken, n), DEFEATED_COLOR);
}

/** The IWorld readout for the World PvP tab and the target/nameplate cores.
 *  The countdown is whole seconds: the self wire diffs the serialized readout,
 *  so an unrounded clock would re-send it every tick of a five-minute disarm.
 *  The zone is the ground under the player right now (it changes only on a
 *  crossing, so the delta elides it between crossings). */
export function worldPvpInfoFor(
  ctx: SimContext,
  pid: number,
): import('../../world_api').WorldPvpInfo | null {
  const r = playerOf(ctx, pid);
  if (!r) return null;
  const state = r.meta.worldPvp;
  const remaining = worldPvpDisarmRemaining(r.meta, ctx.time);
  return {
    flagged: state?.flagged === true,
    disarmRemaining: remaining === null ? null : Math.round(remaining),
    kills: state?.kills ?? 0,
    deaths: state?.deaths ?? 0,
    levelLocked: r.e.level < WORLD_PVP_MIN_LEVEL,
    zone: worldPvpZonePolicyAt(r.e.pos.x, r.e.pos.z),
    enabled: !ctx.worldPvpDisabled,
  };
}

/** The persisted form, or undefined for a character who never raised the
 *  flag and has no record (so their save stays byte-identical). */
export function savedWorldPvpState(meta: PlayerMeta, now: number): WorldPvpSavedState | undefined {
  const state = meta.worldPvp;
  if (!state) return undefined;
  if (!state.flagged && state.kills === 0 && state.deaths === 0) return undefined;
  const remaining = worldPvpDisarmRemaining(meta, now);
  return {
    flagged: state.flagged,
    ...(remaining !== null ? { disarmRemaining: remaining } : {}),
    ...(state.kills > 0 ? { kills: state.kills } : {}),
    ...(state.deaths > 0 ? { deaths: state.deaths } : {}),
  };
}

/** The CharacterState spread: `{ worldPvp }` when there is a record, else `{}`. */
export function savedWorldPvpFields(
  meta: PlayerMeta,
  now: number,
): { worldPvp?: WorldPvpSavedState } {
  const saved = savedWorldPvpState(meta, now);
  return saved ? { worldPvp: saved } : {};
}

function nonNegativeInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

/** Restore a saved record onto a freshly added player, re-anchoring a stored
 *  countdown to THIS sim's clock and mirroring the flag onto the entity. A
 *  malformed or absent record leaves the character unflagged, and so does a
 *  saved flag on a character who now sits under WORLD_PVP_MIN_LEVEL or on a
 *  realm whose kill switch is set (both gates hold on restore as on raise). */
export function loadWorldPvpState(
  ctx: SimContext,
  meta: PlayerMeta,
  e: Entity,
  saved: unknown,
): void {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
  const record = saved as Record<string, unknown>;
  const flagged =
    record.flagged === true && e.level >= WORLD_PVP_MIN_LEVEL && !ctx.worldPvpDisabled;
  const kills = nonNegativeInt(record.kills);
  const deaths = nonNegativeInt(record.deaths);
  if (!flagged && kills === 0 && deaths === 0) return;
  const remaining =
    flagged && typeof record.disarmRemaining === 'number' && Number.isFinite(record.disarmRemaining)
      ? Math.max(0, record.disarmRemaining)
      : null;
  const disarmAt = remaining === null ? null : ctx.time + remaining;
  meta.worldPvp = { flagged, disarmAt, kills, deaths };
  e.pvpFlag = flagged;
  if (disarmAt !== null) {
    const books = ctx.worldPvpBooks;
    books.nextDisarmAt = Math.min(books.nextDisarmAt, disarmAt);
  }
}
