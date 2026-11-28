// Forge-Fury, the Smith's Heart's hard enrage (hard_enrage_ids.ts holds the
// rules and every number; docs/design/raid/smith_heart.md section 7, "The hard
// enrage"). One module the five coordinators call once a tick of their fight
// (`stepHardEnrage`), with its state on their fight state (`enrage`, born at
// the pull with `freshHardEnrage`, gone with a wipe's reset), and
// `clearHardEnrage` on every body at a reset or the kill.
//
// Deterministic: no pick and no rng (every burn is a fixed share of health).
// What the client reads: the two auras on the boss (the countdown, the fury)
// and the room's two lines; no wire or IWorld change.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity } from '../../types';
import { auraOf, dropAura, putMarker } from './fight_kit';
import {
  HARD_ENRAGE_AURAS as A,
  HARD_ENRAGE_CUES,
  HARD_ENRAGE_LOGS,
  HARD_ENRAGE_NAMES,
  HARD_ENRAGE_TUNING as T,
} from './hard_enrage_ids';

export interface HardEnrageState {
  /** Seconds of fight since the pull. */
  elapsed: number;
  /** The warning has been given. */
  warned: boolean;
  /** The fury is unleashed. */
  fury: boolean;
  /** Burns landed so far. */
  pulses: number;
  /** Seconds to the next burn. */
  pulseClock: number;
}

/** The state at the pull. */
export function freshHardEnrage(): HardEnrageState {
  return { elapsed: 0, warned: false, fury: false, pulses: 0, pulseClock: 0 };
}

/** A fight state's hard enrage, born on its first tick (the pull). */
export function hardEnrageOf(st: { enrage?: HardEnrageState }): HardEnrageState {
  if (!st.enrage) st.enrage = freshHardEnrage();
  return st.enrage;
}

export interface HardEnrageScope {
  ctx: SimContext;
  inst: InstanceSlot;
  /** The boss's bodies (the Hammer Council's two; one elsewhere). */
  bodies: readonly (Entity | null | undefined)[];
  /** Everyone in the fight (the burn's victims, the lines' readers). */
  players: readonly Entity[];
}

const living = (e: Entity | null | undefined): e is Entity => !!e && !e.dead && e.hp > 0;

/** Can the boss be harmed this tick? (Any living body that is not immune.) */
function harmable(bodies: readonly Entity[]): boolean {
  return bodies.some((b) => !b.damageImmune);
}

function tell(s: HardEnrageScope, text: string): void {
  for (const p of s.players)
    s.ctx.emit({ type: 'log', text, color: '#ff6a3a', telegraph: true, pid: p.id });
}

/** One burn of the fury on everyone in the fight. */
function burn(s: HardEnrageScope, st: HardEnrageState, source: Entity): void {
  st.pulses += 1;
  const lethal = st.pulses >= T.killPulse;
  for (const p of s.players) {
    if (p.dead || p.ghost) continue;
    // A real game master (or the profiler's invulnerable stand-in) is spared,
    // as the raid's other wipes spare them.
    if (p.gm || (p.profilerInvulnerable && s.ctx.devCommands)) continue;
    s.ctx.emit({
      type: 'spellfx',
      sourceId: source.id,
      targetId: p.id,
      school: 'fire',
      fx: 'beam',
      ability: HARD_ENRAGE_CUES.pulse,
    });
    const amount = lethal ? p.hp + p.maxHp * 10 : Math.round(p.maxHp * T.pulseShare * st.pulses);
    s.ctx.dealDamage(source, p, amount, false, 'fire', HARD_ENRAGE_NAMES.fury, 'hit', true);
    // The damage path caps a huge hit: a death of its own follows it.
    if (lethal && !p.dead) s.ctx.handleDeath(p, source, HARD_ENRAGE_NAMES.fury);
  }
}

/**
 * One tick of the fight's hard enrage. `seconds` is the boss's timer for the
 * fight's tier (null: none, Normal; nothing happens and nothing is shown).
 * Returns true on the tick the fury is unleashed.
 */
export function stepHardEnrage(
  s: HardEnrageScope,
  st: HardEnrageState,
  seconds: number | null,
): boolean {
  if (seconds === null) return false;
  const bodies = s.bodies.filter(living);
  if (bodies.length === 0) return false;
  st.elapsed += DT;
  const left = seconds - st.elapsed;
  if (!st.warned && left <= T.warnLead + 1e-9) {
    st.warned = true;
    for (const b of bodies)
      putMarker(b, A.gathering, HARD_ENRAGE_NAMES.gathering, Math.max(0, left), b.id, {
        value: seconds,
        school: 'fire',
      });
    tell(s, HARD_ENRAGE_LOGS.warn);
  }
  if (!st.fury) {
    // The fury waits for a boss the raid can strike (never in its downtime).
    if (left > 1e-9 || !harmable(bodies)) return false;
    st.fury = true;
    st.pulseClock = 0;
    for (const b of bodies) {
      dropAura(b, A.gathering);
      putMarker(b, A.fury, HARD_ENRAGE_NAMES.fury, 0, b.id, {
        value: seconds,
        permanent: true,
        school: 'fire',
      });
    }
    tell(s, HARD_ENRAGE_LOGS.fury);
  }
  // A body that fell or was raised keeps its fury on show.
  for (const b of bodies)
    if (!auraOf(b, A.fury))
      putMarker(b, A.fury, HARD_ENRAGE_NAMES.fury, 0, b.id, {
        value: seconds,
        permanent: true,
        school: 'fire',
      });
  const unleashed = st.pulses === 0 && st.pulseClock === 0;
  st.pulseClock -= DT;
  if (st.pulseClock <= 1e-9) {
    st.pulseClock += T.pulseEvery;
    burn(s, st, bodies[0]);
  }
  return unleashed;
}

/** Both auras off a body (a reset, the kill). */
export function clearHardEnrage(e: Entity | null | undefined): void {
  if (!e) return;
  dropAura(e, A.gathering);
  dropAura(e, A.fury);
}
