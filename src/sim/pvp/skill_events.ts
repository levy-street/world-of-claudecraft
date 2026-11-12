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
// plug in through `SKILL_EVENT_RULES`; until one is registered for a kind, that
// kind runs on the shared baseline below (first to the kill target wins).

import { SKILL_EVENT_SITES, type SkillEventSite } from '../content/skill_event_sites';
import { ZONES } from '../data';
import { Rng } from '../rng';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { grantHonor } from './honor';
import {
  insideSkillEventCircle,
  nextSkillEventStart,
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
  /** Player killing blows landed inside the event, by pid. */
  kills: Map<number, number>;
  /** Set by the rule set the moment the event is won. */
  winner: number | null;
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
}

/** The rule sets by kind. A kind with no entry runs the baseline. */
export const SKILL_EVENT_RULES: Partial<Record<SkillEventKind, SkillEventRuleSet>> = {};

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
  for (const pid of ev.hearts.keys()) {
    const e = ctx.entities.get(pid);
    if (e) delete e.eventHearts;
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
  SKILL_EVENT_RULES[ev.kind]?.end?.(ctx, ev);
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
  const rules = SKILL_EVENT_RULES[ev.kind];
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
  if (!ev || ev.phase !== 'running' || ev.winner !== null || !killer) return;
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
  const target = SKILL_EVENT_RULES[ev.kind]?.killsToWin ?? BASELINE_KILLS_TO_WIN;
  if (kills >= target) ev.winner = killer.id;
}

/** The IWorld readout for one viewer (world_api/world_pvp.ts SkillEventInfo). */
export function skillEventInfoFor(
  ctx: SimContext,
  pid: number,
): import('../../world_api').SkillEventInfo | null {
  const ev = ctx.skillEventState.active;
  if (!ev) return null;
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
    minutesLeft: skillEventMinutesUntil(ev.phase === 'warning' ? ev.startsAt : ev.endsAt, ctx.time),
    joined,
    // The join prompt: near the arena, not in it yet, and not already flagged
    // (a flagged player joins by stepping in, so they are never asked).
    canJoin: near && !joined && !!meta && !isWorldPvpFlagged(meta),
    participants: ev.participants.length,
    yourKills: ev.kills.get(pid) ?? 0,
    // Your hearts while you fight a heart event; null otherwise (the HUD then
    // shows the ordinary health bar).
    hearts: ev.hearts.get(pid) ?? null,
    maxHearts: SKILL_EVENT_HEARTS,
  };
}
