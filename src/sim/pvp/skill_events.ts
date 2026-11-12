// Hourly skill events: the SYSTEM behind the SimContext seam (owner brief,
// 2026-11-12). One event an hour, on the hour, in the fixed rotation of
// skill_event_rules.ts, on one of the fixed arenas (content/skill_event_sites.ts):
//
//   warning  SKILL_EVENT_WARNING_SECONDS before the start: the realm is told
//            where, the map marks the arena, and a player near it is offered
//            the join prompt (joining raises the World PvP flag);
//   running  from the start until the rule set names a winner or the hard
//            cap; a flagged player who steps into the arena joins on entry;
//   ended    the winner earns SKILL_EVENT_WIN_HONOR and every other
//            participant SKILL_EVENT_PARTICIPATION_HONOR; each player killing
//            blow inside the event already paid SKILL_EVENT_KILL_HONOR, with no
//            diminishing returns.
//
// The session state is ONE live view (Sim.skillEventState, ctx.skillEventState),
// never persisted: a restart simply waits for the next hour. The arena draw
// comes from a PRIVATE rng derived from the seed and the hour (the hill's
// precedent), so the world stream never moves. The rule sets of the five events
// plug in through `skillEventRules`; until one is registered for a kind, that
// kind runs on the shared baseline below (first to the kill target wins).

import type { SkillEventBolt, SkillEventMark } from '../../world_api/world_pvp';
import { SKILL_EVENT_SITES, type SkillEventSite } from '../content/skill_event_sites';
import { ZONES } from '../data';
import { Rng } from '../rng';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { grantHonor } from './honor';
import {
  BANKSHOT_BOLT_SPEED,
  BANKSHOT_RULES,
  type BankshotBook,
  bankshotStonesAt,
} from './skill_event_bankshot';
import {
  COMMON_HAND_RULES,
  type CommonHandBook,
  commonHandHealPoints,
  commonHandHitPoints,
  commonHandInfo,
  commonHandShieldPoints,
} from './skill_event_common_hand';
import { FOOTPRINTS_RULES, type FootprintsBook } from './skill_event_footprints';
import {
  keepsakeEligible,
  kitFor,
  SKILL_EVENT_VERBS,
  type SkillEventKitState,
} from './skill_event_kit';
import { RIPOSTE_RULES } from './skill_event_riposte';
import {
  insideSkillEventCircle,
  nextSkillEventStart,
  SKILL_EVENT_HEART_GRACE_SECONDS,
  SKILL_EVENT_HEART_KINDS,
  SKILL_EVENT_HEARTS,
  SKILL_EVENT_KILL_HONOR,
  SKILL_EVENT_MAX_SECONDS,
  SKILL_EVENT_MIN_PRESENCE_SECONDS,
  SKILL_EVENT_RADIUS,
  SKILL_EVENT_WARNING_SECONDS,
  type SkillEventKind,
  skillEventKindFor,
  skillEventMinutesUntil,
  skillEventResultHonor,
  skillEventSitesAvoiding,
  withinSkillEventPrompt,
} from './skill_event_rules';
import { TONGUES_RULES } from './skill_event_tongues';
import { isWorldPvpFlagged, setWorldPvpFlag } from './world_pvp';

export type SkillEventPhase = 'warning' | 'running';

export interface ActiveSkillEvent {
  ordinal: number;
  kind: SkillEventKind;
  siteId: string;
  zoneId: string;
  x: number;
  z: number;
  phase: SkillEventPhase;
  startsAt: number;
  endsAt: number;
  /** Everyone who joined, by pid, in join order. */
  participants: number[];
  /** Seconds each participant has spent inside the running arena. */
  presence: Map<number, number>;
  /** Hearts left, by pid, in a heart event once it runs (SKILL_EVENT_HEART_KINDS). */
  hearts: Map<number, number>;
  /** When each fighter last lost a heart (the SKILL_EVENT_HEART_GRACE_SECONDS window). */
  heartLostAt: Map<number, number>;
  /** Hearts each fighter has taken from others (the last-standing win needs one). */
  heartsTaken: Map<number, number>;
  /** Each fighter's kit: the keepsake and the event verbs' state (skill_event_kit.ts). */
  kits: Map<number, SkillEventKitState>;
  /** Set by a rule module for the length of a kit verb's own hit: only that
   *  hit takes a heart (auto-attacks, the keepsake and every other damage
   *  between fighters is ignored, so the kit alone decides the fight). */
  verbHitFrom: number | null;
  /** Player killing blows landed inside the event, by pid. */
  kills: Map<number, number>;
  /** Set by the rule set the moment the event is won. */
  winner: number | null;
  /** Footprints in Ash: the marks on the ash (skill_event_footprints.ts). */
  footprints?: FootprintsBook;
  /** Bankshot: the stones and the bolts in flight (skill_event_bankshot.ts). */
  bankshot?: BankshotBook;
  /** The Common Hand: the hand in play, casts and returns (skill_event_common_hand.ts). */
  commonHand?: CommonHandBook;
}

export interface SkillEventState {
  active: ActiveSkillEvent | null;
  /** The next event's hour and start, planned once and kept until it runs. */
  plan: { ordinal: number; startsAt: number } | null;
  /** Tick of the last once-a-second pass (the dueness form, as the hill's). */
  passTick: number;
}

export function newSkillEventState(): SkillEventState {
  return { active: null, plan: null, passTick: 0 };
}

/** What a kind adds to the shared baseline. Every hook is optional. */
export interface SkillEventRuleSet {
  /** Player killing blows that win the event (the baseline: 4). */
  killsToWin?: number;
  start?(ctx: SimContext, ev: ActiveSkillEvent): void;
  /** Once a second while running, after presence. */
  tick?(ctx: SimContext, ev: ActiveSkillEvent): void;
  end?(ctx: SimContext, ev: ActiveSkillEvent): void;
  /** Every tick while running, before the once-a-second pass: the timing of
   *  wind-ups and guard windows. */
  everyTick?(ctx: SimContext, ev: ActiveSkillEvent): void;
  /** A kit verb pressed by a fighter (already validated as this event's verb).
   *  True when it took effect. */
  action?(ctx: SimContext, ev: ActiveSkillEvent, pid: number, verb: string): boolean;
  /** The live fighting ground's radius when it is not the arena's (a closing
   *  field). */
  fieldRadius?(ev: ActiveSkillEvent, now: number): number;
  /** No damage between fighters at all (Rite of Tongues). */
  noDamage?: boolean;
  /** A fighter's tell, mirrored onto their entity every tick for every client. */
  stanceOf?(ctx: SimContext, ev: ActiveSkillEvent, pid: number): SkillEventStance | undefined;
  /** A scoring event's tally for one viewer. */
  scoreFor?(ev: ActiveSkillEvent, pid: number): { yours: number; best: number; toWin: number };
  /** A fighter died while the event runs (before the kill is counted). */
  onDeath?(ctx: SimContext, ev: ActiveSkillEvent, victim: Entity): void;
}

/** A fighter's visible tell: the stance, and how far its bar is filled. */
export interface SkillEventStance {
  stance: NonNullable<Entity['eventStance']>;
  fill?: number;
  /** The ability a `hand` stance is casting. */
  castId?: string;
}

/** The rule set of a kind, or undefined for the baseline. A function, not a
 *  table: the rule modules import the sim, which imports this module, so a table
 *  built at load time could capture a rule set that has not finished loading. */
export function skillEventRules(kind: SkillEventKind): SkillEventRuleSet | undefined {
  switch (kind) {
    case 'riposte':
      return RIPOSTE_RULES;
    case 'footprints':
      return FOOTPRINTS_RULES;
    case 'tongues':
      return TONGUES_RULES;
    case 'bankshot':
      return BANKSHOT_RULES;
    case 'common_hand':
      return COMMON_HAND_RULES;
    default:
      return undefined;
  }
}

const BASELINE_KILLS_TO_WIN = 4;
const PASS_TICKS = 20;
const SITE_SALT = 0x1f3d5b79;
const NOTICE_COLOR = '#ffd100';
const START_COLOR = '#ff7a4a';

/** The English names the realm lines carry; the client re-localizes them. */
export const SKILL_EVENT_NAMES: Record<SkillEventKind, string> = {
  riposte: 'Riposte',
  footprints: 'Footprints in Ash',
  tongues: 'Rite of Tongues',
  bankshot: 'Bankshot',
  common_hand: 'The Common Hand',
};

function minutesPhrase(minutes: number): string {
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/** The realm and player lines the client matcher re-localizes (src/ui/sim_i18n.ts). */
export function skillEventWarningLine(name: string, zoneName: string, minutes: number): string {
  return `${name} begins in ${zoneName} in ${minutesPhrase(minutes)}.`;
}
export function skillEventStartLine(name: string, zoneName: string): string {
  return `${name} has begun in ${zoneName}.`;
}
export function skillEventWonLine(name: string, winnerName: string): string {
  return `${winnerName} has won ${name}.`;
}
export function skillEventEndedLine(name: string): string {
  return `${name} has ended with no winner.`;
}
export const SKILL_EVENT_JOINED_LINE = 'You have joined the event. Good luck.';
export const SKILL_EVENT_TOO_FAR_LINE = 'You are too far from the event to join it.';
export const SKILL_EVENT_NONE_LINE = 'There is no event to join right now.';
/** A kit button pressed when its verb cannot fire (a cooldown, silenced, no
 *  one in reach): the error toast says so instead of nothing happening. */
export const SKILL_EVENT_NOT_YET_LINE = "You can't do that yet.";

function zoneName(zoneId: string): string {
  return ZONES.find((zone) => zone.id === zoneId)?.name ?? zoneId;
}

function eventRng(ctx: SimContext, ordinal: number): Rng {
  return new Rng((ctx.cfg.seed ^ Math.imul(ordinal + 1, 0x2545f491) ^ SITE_SALT) >>> 0);
}

/** The arena hour `ordinal` uses: a private draw over the sites, never one in
 *  the zone of a hill that is announced or standing. */
export function pickSkillEventSite(
  ctx: SimContext,
  ordinal: number,
  sites: readonly SkillEventSite[] = SKILL_EVENT_SITES,
): SkillEventSite | null {
  const hillZone = ctx.hillState.active?.zoneId ?? null;
  const portals = ctx.naturalRiftPortals.map((portal) => portal.position);
  const pool = skillEventSitesAvoiding(sites, hillZone, portals);
  if (pool.length === 0) return null;
  return pool[eventRng(ctx, ordinal).int(0, pool.length - 1)];
}

function hostNowMs(ctx: SimContext): number | null {
  return ctx.cfg.dayNightNowMs ? ctx.cfg.dayNightNowMs() : null;
}

function announce(ctx: SimContext, text: string, color = NOTICE_COLOR): void {
  ctx.emit({ type: 'log', text, color });
}

function notice(ctx: SimContext, pid: number, text: string, color = NOTICE_COLOR): void {
  ctx.emit({ type: 'log', text, color, pid });
}

function livePlayer(ctx: SimContext, pid: number): { e: Entity; meta: PlayerMeta } | null {
  const meta = ctx.players.get(pid);
  const e = ctx.entities.get(pid);
  if (!meta || !e || e.kind !== 'player') return null;
  return { e, meta };
}

/** Open the event's warning: draw the arena and tell the realm. */
function openEvent(ctx: SimContext, ordinal: number, startsAt: number): ActiveSkillEvent | null {
  const site = pickSkillEventSite(ctx, ordinal);
  if (!site) return null;
  const ev: ActiveSkillEvent = {
    ordinal,
    kind: skillEventKindFor(ordinal),
    siteId: site.id,
    zoneId: site.zoneId,
    x: site.x,
    z: site.z,
    phase: 'warning',
    startsAt,
    endsAt: startsAt + SKILL_EVENT_MAX_SECONDS,
    participants: [],
    presence: new Map(),
    hearts: new Map(),
    heartLostAt: new Map(),
    heartsTaken: new Map(),
    kits: new Map(),
    verbHitFrom: null,
    kills: new Map(),
    winner: null,
  };
  announce(
    ctx,
    skillEventWarningLine(
      SKILL_EVENT_NAMES[ev.kind],
      zoneName(ev.zoneId),
      skillEventMinutesUntil(startsAt, ctx.time),
    ),
  );
  return ev;
}

/** Set a participant's hearts on the event book and on their entity (the wire
 *  carries the entity's copy every tick). */
export function setHearts(
  ctx: SimContext,
  ev: ActiveSkillEvent,
  pid: number,
  hearts: number,
): void {
  ev.hearts.set(pid, hearts);
  const e = ctx.entities.get(pid);
  if (e) e.eventHearts = hearts;
}

/** The event is over: everyone goes back to their health bar. */
function clearHearts(ctx: SimContext, ev: ActiveSkillEvent): void {
  // Every fighter: a no-heart event (Rite of Tongues) still leaves stance tells.
  for (const pid of new Set([...ev.hearts.keys(), ...ev.participants])) {
    const e = ctx.entities.get(pid);
    if (e) {
      delete e.eventHearts;
      delete e.eventStance;
      delete e.eventStanceFill;
      delete e.eventCastId;
      delete e.eventUnseen;
    }
  }
  ev.hearts.clear();
}

function addParticipant(ctx: SimContext, ev: ActiveSkillEvent, pid: number): void {
  if (ev.participants.includes(pid)) return;
  ev.participants.push(pid);
  // A player who joins a running heart event starts on full hearts.
  if (ev.phase === 'running' && SKILL_EVENT_HEART_KINDS.has(ev.kind)) {
    setHearts(ctx, ev, pid, SKILL_EVENT_HEARTS);
  }
  notice(ctx, pid, SKILL_EVENT_JOINED_LINE);
}

/** While running, a flagged player who walks into the arena joins on entry,
 *  and every living participant inside it banks a second of presence. */
function updatePresence(ctx: SimContext, ev: ActiveSkillEvent, seconds: number): void {
  for (const [pid, meta] of ctx.players) {
    const e = ctx.entities.get(pid);
    if (!e || e.hp <= 0 || e.dead) continue;
    if (!insideSkillEventCircle(ev, SKILL_EVENT_RADIUS, e.pos.x, e.pos.z)) continue;
    if (!ev.participants.includes(pid)) {
      if (!isWorldPvpFlagged(meta)) continue;
      addParticipant(ctx, ev, pid);
    }
    ev.presence.set(pid, (ev.presence.get(pid) ?? 0) + seconds);
  }
}

/** Paid at the end: the winner, and anyone who stood in the arena long enough. */
function earnsResult(ev: ActiveSkillEvent, pid: number): boolean {
  return pid === ev.winner || (ev.presence.get(pid) ?? 0) >= SKILL_EVENT_MIN_PRESENCE_SECONDS;
}

/** Close the event: pay everyone, tell the realm, clear it. */
export function finishSkillEvent(ctx: SimContext, ev: ActiveSkillEvent): void {
  skillEventRules(ev.kind)?.end?.(ctx, ev);
  const name = SKILL_EVENT_NAMES[ev.kind];
  for (const pid of ev.participants) {
    const meta = ctx.players.get(pid);
    if (!meta || !earnsResult(ev, pid)) continue;
    grantHonor(
      ctx,
      meta,
      skillEventResultHonor(pid, ev.winner),
      pid === ev.winner ? 'skill_event_win' : 'skill_event_complete',
    );
  }
  const winner = ev.winner === null ? null : ctx.players.get(ev.winner);
  announce(
    ctx,
    winner ? skillEventWonLine(name, winner.name) : skillEventEndedLine(name),
    START_COLOR,
  );
  clearHearts(ctx, ev);
  ctx.skillEventState.active = null;
}

function updateSchedule(ctx: SimContext): void {
  const state = ctx.skillEventState;
  if (state.active) return;
  if (!state.plan) state.plan = nextSkillEventStart(ctx.time, hostNowMs(ctx));
  const plan = state.plan;
  if (ctx.time < plan.startsAt - SKILL_EVENT_WARNING_SECONDS) return;
  state.plan = null;
  state.active = openEvent(ctx, plan.ordinal, plan.startsAt);
}

/** The once-a-second pass, from the Sim tick. */
export function updateSkillEvents(ctx: SimContext): void {
  const state = ctx.skillEventState;
  const live = state.active;
  if (live?.phase === 'running') {
    skillEventRules(live.kind)?.everyTick?.(ctx, live);
    syncStances(ctx, live);
  }
  if (ctx.tickCount - state.passTick < PASS_TICKS) return;
  state.passTick = ctx.tickCount;
  if (ctx.worldPvpDisabled) {
    if (state.active) clearHearts(ctx, state.active);
    state.active = null;
    return;
  }
  updateSchedule(ctx);
  const ev = state.active;
  if (!ev) return;
  const rules = skillEventRules(ev.kind);
  if (ev.phase === 'warning') {
    if (ctx.time < ev.startsAt) return;
    ev.phase = 'running';
    announce(
      ctx,
      skillEventStartLine(SKILL_EVENT_NAMES[ev.kind], zoneName(ev.zoneId)),
      START_COLOR,
    );
    if (SKILL_EVENT_HEART_KINDS.has(ev.kind)) {
      for (const pid of ev.participants) setHearts(ctx, ev, pid, SKILL_EVENT_HEARTS);
    }
    rules?.start?.(ctx, ev);
  }
  updatePresence(ctx, ev, PASS_TICKS / 20);
  rules?.tick?.(ctx, ev);
  if (ev.winner !== null || ctx.time >= ev.endsAt) finishSkillEvent(ctx, ev);
}

/** The join prompt's Accept (and /join for the event): raise the World PvP
 *  flag and enter. Refused, with the reason, when there is no event, the
 *  player is out of reach, or the flag cannot be raised (level, sanctuary). */
export function joinSkillEvent(ctx: SimContext, pid: number): boolean {
  const ev = ctx.skillEventState.active;
  if (!ev) {
    ctx.error(pid, SKILL_EVENT_NONE_LINE);
    return false;
  }
  const r = livePlayer(ctx, pid);
  if (!r) return false;
  if (ev.participants.includes(pid)) return false;
  if (!withinSkillEventPrompt(ev, r.e.pos.x, r.e.pos.z)) {
    ctx.error(pid, SKILL_EVENT_TOO_FAR_LINE);
    return false;
  }
  if (!isWorldPvpFlagged(r.meta) && !setWorldPvpFlag(ctx, pid, true)) return false;
  addParticipant(ctx, ev, pid);
  return true;
}

/** From the death path (combat/damage.ts, beside the World PvP credit): a
 *  participant's killing blow on another participant while the event runs
 *  pays SKILL_EVENT_KILL_HONOR with no diminishing returns, and counts toward
 *  the baseline win. */
export function skillEventOnPlayerDeath(
  ctx: SimContext,
  victim: Entity,
  killer: Entity | null,
): void {
  const ev = ctx.skillEventState.active;
  if (!ev || ev.phase !== 'running' || ev.winner !== null) return;
  if (victim.kind === 'player') skillEventRules(ev.kind)?.onDeath?.(ctx, ev, victim);
  if (!killer) return;
  // A pet's or guardian's killing blow is its owner's.
  const owner =
    killer.kind === 'mob' && killer.ownerId !== null ? ctx.entities.get(killer.ownerId) : killer;
  if (!owner || victim.kind !== 'player' || owner.kind !== 'player' || owner.id === victim.id) {
    return;
  }
  if (!ev.participants.includes(victim.id) || !ev.participants.includes(owner.id)) return;
  // Only a kill AT the event counts: both players within the prompt reach.
  if (!withinSkillEventPrompt(ev, victim.pos.x, victim.pos.z)) return;
  if (!withinSkillEventPrompt(ev, owner.pos.x, owner.pos.z)) return;
  killer = owner;
  const meta = ctx.players.get(killer.id);
  if (!meta) return;
  grantHonor(ctx, meta, SKILL_EVENT_KILL_HONOR, 'skill_event_kill');
  const kills = (ev.kills.get(killer.id) ?? 0) + 1;
  ev.kills.set(killer.id, kills);
  const target = skillEventRules(ev.kind)?.killsToWin ?? BASELINE_KILLS_TO_WIN;
  if (kills >= target) ev.winner = killer.id;
}

/** The IWorld readout for one viewer (world_api/world_pvp.ts SkillEventInfo). */
export function skillEventInfoFor(
  ctx: SimContext,
  pid: number,
): import('../../world_api').SkillEventInfo | null {
  const ev = ctx.skillEventState.active;
  if (!ev || pid < 0) return null; // pid -1: a host with no primary player
  const e = ctx.entities.get(pid);
  const meta = ctx.players.get(pid);
  const joined = ev.participants.includes(pid);
  const near = !!e && withinSkillEventPrompt(ev, e.pos.x, e.pos.z);
  return {
    kind: ev.kind,
    phase: ev.phase,
    zoneId: ev.zoneId,
    x: ev.x,
    z: ev.z,
    radius: SKILL_EVENT_RADIUS,
    fieldRadius:
      ev.phase === 'running'
        ? (skillEventRules(ev.kind)?.fieldRadius?.(ev, ctx.time) ?? SKILL_EVENT_RADIUS)
        : SKILL_EVENT_RADIUS,
    minutesLeft: skillEventMinutesUntil(ev.phase === 'warning' ? ev.startsAt : ev.endsAt, ctx.time),
    joined,
    // The join prompt: near the arena, not in it yet, and not already flagged
    // (a flagged player joins by stepping in, so they are never asked).
    canJoin: near && !joined && !!meta && !isWorldPvpFlagged(meta),
    participants: ev.participants.length,
    yourKills: ev.kills.get(pid) ?? 0,
    score: joined ? (skillEventRules(ev.kind)?.scoreFor?.(ev, pid) ?? null) : null,
    // Your hearts while you fight a heart event; null otherwise (the HUD then
    // shows the ordinary health bar).
    hearts: ev.hearts.get(pid) ?? null,
    maxHearts: SKILL_EVENT_HEARTS,
    kit: joined ? kitInfoFor(ctx, ev, pid) : null,
    stones: ev.bankshot ? bankshotStonesAt(ev, ev.bankshot.stones, ctx.time) : null,
    hand: ev.kind === 'common_hand' && ev.phase === 'running' ? commonHandInfo(ctx, ev) : null,
  };
}

/** A no-damage event (Rite of Tongues): nothing one fighter does hurts another
 *  while it runs (a pet's hit is its owner's). */
function skillEventBlocksDamage(ctx: SimContext, source: Entity | null, target: Entity): boolean {
  if (target.kind !== 'player' || !source) return false;
  const ev = ctx.skillEventState.active;
  if (!ev || ev.phase !== 'running' || !skillEventRules(ev.kind)?.noDamage) return false;
  const owner =
    source.kind === 'mob' && source.ownerId !== null ? ctx.entities.get(source.ownerId) : source;
  if (!owner || owner.kind !== 'player') return false;
  return ev.participants.includes(target.id) && ev.participants.includes(owner.id);
}

/** The hit rule of the heart events, from the top of dealDamage (before any
 *  amplifier, shield or health change): true when the hit was handled here
 *  and must not touch health. A fighter on hearts (`eventHearts` set) loses
 *  exactly one heart to a hit from another fighter on hearts (a pet's hit is
 *  its owner's), at most one per grace window; heals and shields never matter
 *  because health never moves. Anyone off hearts cannot hurt a fighter on
 *  them at all, so monsters and passers-by cannot decide the fight. The last
 *  heart is a kill: a lethal exact hit through the ordinary death path, so the
 *  killing blow, the honor and the corpse all behave as in any other death. */
export function skillEventTakeHeart(
  ctx: SimContext,
  source: Entity | null,
  target: Entity,
): boolean {
  if (skillEventBlocksDamage(ctx, source, target)) return true;
  if (target.eventHearts === undefined) return false;
  const ev = ctx.skillEventState.active;
  if (!ev || ev.phase !== 'running' || !ev.hearts.has(target.id)) {
    delete target.eventHearts; // stale: the fight is over for this entity
    return false;
  }
  const owner =
    source?.kind === 'mob' && source.ownerId !== null
      ? (ctx.entities.get(source.ownerId) ?? null)
      : source;
  if (!owner || owner.eventHearts === undefined) return true;
  if (!ev.hearts.has(owner.id) || owner.dead) return true;
  // Only a kit verb's hit counts, and only a kit verb can strike its own
  // owner (a Bankshot bolt coming back): nothing else ever self-damages here.
  if (ev.verbHitFrom !== owner.id) return true;
  const self = owner.id === target.id;
  const last = ev.heartLostAt.get(target.id);
  if (last !== undefined && ctx.time - last < SKILL_EVENT_HEART_GRACE_SECONDS) return true;
  ev.heartLostAt.set(target.id, ctx.time);
  // Hitting yourself costs the heart but never counts toward your win.
  if (!self) ev.heartsTaken.set(owner.id, (ev.heartsTaken.get(owner.id) ?? 0) + 1);
  const left = Math.max(0, (ev.hearts.get(target.id) ?? 0) - 1);
  setHearts(ctx, ev, target.id, left);
  ctx.emit({
    type: 'damage',
    sourceId: owner.id,
    targetId: target.id,
    amount: 1,
    crit: false,
    school: 'physical',
    ability: null,
    kind: 'hit',
  });
  if (left === 0) {
    // Off hearts first, so the lethal hit below is not caught here again.
    delete target.eventHearts;
    ctx.dealDamage(
      owner,
      target,
      target.hp + 1,
      false,
      'physical',
      null,
      'hit',
      true,
      undefined,
      true,
      false,
      true,
      null,
      false,
      undefined,
      true,
    );
  }
  return true;
}

/** Mirror each fighter's tell (a Riposte wind-up or guard, a Rite of Tongues
 *  chant or Sever) onto their entity, so every client sees it through the
 *  per-tick entity wire. */
function syncStances(ctx: SimContext, ev: ActiveSkillEvent): void {
  const stanceOf = skillEventRules(ev.kind)?.stanceOf;
  for (const pid of ev.participants) {
    const e = ctx.entities.get(pid);
    if (!e) continue;
    const tell = stanceOf?.(ctx, ev, pid);
    if (!tell) {
      delete e.eventStance;
      delete e.eventStanceFill;
      delete e.eventCastId;
      continue;
    }
    e.eventStance = tell.stance;
    if (tell.castId === undefined) delete e.eventCastId;
    else e.eventCastId = tell.castId;
    if (tell.fill === undefined) delete e.eventStanceFill;
    else e.eventStanceFill = Math.round(tell.fill * 100) / 100;
  }
}

/** A fighter pressed one of the event's kit verbs. */
export function skillEventAction(ctx: SimContext, pid: number, verb: string): boolean {
  const ev = ctx.skillEventState.active;
  if (!ev || ev.phase !== 'running' || !ev.participants.includes(pid)) return false;
  if (!SKILL_EVENT_VERBS[ev.kind].includes(verb)) return false;
  const done = skillEventRules(ev.kind)?.action?.(ctx, ev, pid, verb) ?? false;
  if (!done) ctx.error(pid, SKILL_EVENT_NOT_YET_LINE);
  return done;
}

/** Choose the one class ability a fighter keeps for the event (during the
 *  warning or while it runs). Refused for an unknown or ineligible ability. */
export function skillEventPickKeepsake(ctx: SimContext, pid: number, abilityId: string): boolean {
  const ev = ctx.skillEventState.active;
  if (!ev || !ev.participants.includes(pid)) return false;
  const meta = ctx.players.get(pid);
  const known = meta?.known.find((k) => k.def.id === abilityId);
  if (!known || !keepsakeEligible(known.def)) return false;
  kitFor(ev, pid).keepsake = abilityId;
  return true;
}

/** The cast lock: while an event runs, a fighter may cast only their keepsake. */
export function skillEventCastAllowed(ctx: SimContext, pid: number, abilityId: string): boolean {
  const ev = ctx.skillEventState.active;
  if (!ev || ev.phase !== 'running' || !ev.participants.includes(pid)) return true;
  return ev.kits.get(pid)?.keepsake === abilityId;
}

/** The viewer's kit for the readout: verbs with their wait, the keepsake, and
 *  the eligible abilities they know (the picker's choices). */
function kitInfoFor(
  ctx: SimContext,
  ev: ActiveSkillEvent,
  pid: number,
): import('../../world_api').SkillEventKitInfo {
  const kit = ev.kits.get(pid);
  const now = ctx.time;
  const verbs = SKILL_EVENT_VERBS[ev.kind].map((id) => ({
    id,
    readyIn: Math.max(0, Math.round(((kit?.readyAt.get(id) ?? 0) - now) * 10) / 10),
  }));
  const known = ctx.players.get(pid)?.known ?? [];
  const choices = known.filter((k) => keepsakeEligible(k.def)).map((k) => k.def.id);
  return { verbs, keepsake: kit?.keepsake ?? null, choices };
}

const NO_MARKS: readonly SkillEventMark[] = [];

/** The ash marks a viewer may read: only a fighter of a running Footprints in
 *  Ash sees them (IWorld.skillEventMarks; the server streams the same list). */
export function skillEventMarksFor(ctx: SimContext, pid: number): readonly SkillEventMark[] {
  const ev = ctx.skillEventState.active;
  if (!ev || ev.phase !== 'running' || !ev.footprints || !ev.hearts.has(pid)) return NO_MARKS;
  return ev.footprints.marks;
}

const NO_BOLTS: readonly SkillEventBolt[] = [];

/** The Bankshot bolts a viewer sees: everyone within the arena's prompt reach.
 *  `at` is the sim clock. One list per tick, shared by every viewer. */
export function skillEventBoltsFor(ctx: SimContext, pid: number): readonly SkillEventBolt[] {
  const ev = ctx.skillEventState.active;
  if (!ev || ev.phase !== 'running' || !ev.bankshot || ev.bankshot.bolts.length === 0) {
    return NO_BOLTS;
  }
  const e = ctx.entities.get(pid);
  if (!e || !withinSkillEventPrompt(ev, e.pos.x, e.pos.z)) return NO_BOLTS;
  let view = boltViews.get(ev.bankshot);
  if (!view || view.tick !== ctx.tickCount) {
    view = {
      tick: ctx.tickCount,
      bolts: ev.bankshot.bolts.map((b) => ({
        id: b.id,
        x: b.x,
        z: b.z,
        dx: b.dx,
        dz: b.dz,
        harmful: b.bounces > 0,
        at: ctx.time,
      })),
    };
    boltViews.set(ev.bankshot, view);
  }
  return view.bolts;
}
const boltViews = new WeakMap<object, { tick: number; bolts: SkillEventBolt[] }>();

/** The offline IWorld book: one object per sim, refreshed in place per read. */
const markBooks = new WeakMap<SimContext, import('../../world_api').SkillEventMarkBook>();

export function skillEventMarkBookFor(
  ctx: SimContext,
  pid: number,
): import('../../world_api').SkillEventMarkBook {
  let book = markBooks.get(ctx);
  if (!book) {
    book = { now: 0, marks: NO_MARKS, bolts: NO_BOLTS, boltSpeed: BANKSHOT_BOLT_SPEED };
    markBooks.set(ctx, book);
  }
  book.now = ctx.time;
  book.marks = skillEventMarksFor(ctx, pid);
  book.bolts = skillEventBoltsFor(ctx, pid);
  return book;
}

/** The Common Hand's equal-damage rule, from the top of dealDamage: the points
 *  a hit between two of its fighters removes (0 blocks it), or null when the
 *  rule does not apply (any other event, or a hit from outside the fight). */
export function skillEventHandHitPoints(
  ctx: SimContext,
  source: Entity | null,
  target: Entity,
  abilityId: string | null,
  direct: boolean,
): number | null {
  if (target.kind !== 'player' || !source) return null;
  const ev = ctx.skillEventState.active;
  if (!ev || ev.kind !== 'common_hand' || ev.phase !== 'running') return null;
  const owner =
    source.kind === 'mob' && source.ownerId !== null ? ctx.entities.get(source.ownerId) : source;
  if (!owner || owner.kind !== 'player' || owner.id === target.id) return null;
  if (!ev.participants.includes(target.id) || !ev.participants.includes(owner.id)) return null;
  return commonHandHitPoints(ev, target, abilityId, direct);
}

/** The Common Hand's equal-heal rule, from applyHeal: a dealt heal on one of
 *  its fighters restores a fixed share, or null when the rule does not apply. */
export function skillEventHandHealPoints(
  ctx: SimContext,
  target: Entity,
  abilityId: string,
): number | null {
  const ev = ctx.skillEventState.active;
  if (!ev || ev.kind !== 'common_hand' || ev.phase !== 'running') return null;
  if (!ev.participants.includes(target.id)) return null;
  return commonHandHealPoints(ev, target, abilityId);
}

/** The Common Hand's equal-shield rule, from the absorb effect: a dealt shield
 *  on one of its fighters holds a fixed share of their health, or null when
 *  the rule does not apply. */
export function skillEventHandShieldPoints(
  ctx: SimContext,
  target: Entity,
  abilityId: string,
): number | null {
  const ev = ctx.skillEventState.active;
  if (!ev || ev.kind !== 'common_hand' || ev.phase !== 'running') return null;
  if (!ev.participants.includes(target.id)) return null;
  return commonHandShieldPoints(ev, target, abilityId);
}
