// Pure plan for the Drowned Sergeant's Loose on My Mark (bastion_order_fx.ts;
// sim: ../../sim/mob/trash_kit/bastion_order.ts): the garrison taking aim.
//
//  - While the shout's bar runs, a red crosshair hangs over the marked
//    player's head (the cast's own target id names them), closing in and
//    pulsing faster as the bar runs out: the "you" of the mechanic.
//  - A dashed red aiming line runs from every arbalest that can answer the
//    shout to the mark, brightening as the bar fills: the "from where" (the
//    lines show which crenel to put between you and them).
//  - When the shout lands, each arbalest's bolt flies at the mark; one the
//    sim stopped on a wall (BASTION_MARKED_BOLT_BLOCKED) is drawn to the
//    first spot along its line the sim's own sight test calls blocked.
//
// Pack ids never reach the client, so the aimers are the living arbalests
// within the shout's reach of the SERGEANT (the order's own `shooterRange`,
// read from the template) that also stand within that reach of the mark,
// the sim's own landing condition. Every number is read back from the
// sergeant's template.
//
// Presentation only. Three-free, DOM-free, deterministic.

import { MOBS } from '../../sim/data';
import { sightReach } from '../trash_engine_fx/trash_engine_fx_core';

export const SERGEANT = 'drowned_sergeant';
export const MARK_SHOOTER =
  MOBS[SERGEANT]?.trashKit?.bastion?.order?.shooters ?? 'fogbound_arbalest';

/** The shout's reach, yards: the sergeant's own call and each bolt's flight. */
export function orderReach(): number {
  return MOBS[SERGEANT]?.trashKit?.bastion?.order?.shooterRange ?? 30;
}

/** Pools: a sergeant shouting at a time per pull (two towers at most), and
 *  every aiming line and bolt they can put up at once. */
export const ORDER_FX_SLOTS = { reticles: 2, lines: 8, bolts: 8 } as const;

/** Where the crosshair hangs over the mark (yards over its feet), and where a
 *  bolt or line meets them (the chest). */
export const RETICLE_HEIGHT = 3.6;
export const MARK_CHEST = 1.25;
/** The crosshair's drawn size (yards across) at the start and at lock-on. */
export const RETICLE_OPEN = 2.6;
export const RETICLE_LOCKED = 1.5;
/** A marked bolt flies a touch slower than a Rusted Bolt so all of them read. */
export const MARKED_BOLT_SPEED = 44;
/** The longest red tracer a marked bolt drags (yards). */
export const MARKED_TRAIL = 6;
/** Seconds between brine puffs a bolt sheds in flight. */
export const SPRAY_INTERVAL = 0.03;
/** A blocked bolt sticks this far short of the wall face. */
export const WALL_STANDOFF = 0.35;
/** Bisection steps of the blocked bolt's stop point (radius / 2^steps). */
export const BOLT_BISECT = 7;

export interface AimBody {
  id: number;
  templateId: string;
  kind: string;
  dead: boolean;
  pos: { x: number; z: number };
}

/** The bar's fill, 0 when it opens and 1 when it lands. */
export function orderFill(castRemaining: number, castTotal: number): number {
  if (castTotal <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - castRemaining / castTotal));
}

/** The arbalests aiming at `mark` for `sergeant`, id order, capped. */
export function orderAimers(
  sergeant: { pos: { x: number; z: number } },
  mark: { pos: { x: number; z: number } },
  bodies: Iterable<AimBody>,
  reach = orderReach(),
  cap: number = ORDER_FX_SLOTS.lines,
): number[] {
  const out: number[] = [];
  const r2 = reach * reach;
  for (const b of bodies) {
    if (b.kind !== 'mob' || b.dead || b.templateId !== MARK_SHOOTER) continue;
    const sx = b.pos.x - sergeant.pos.x;
    const sz = b.pos.z - sergeant.pos.z;
    if (sx * sx + sz * sz > r2) continue;
    const mx = b.pos.x - mark.pos.x;
    const mz = b.pos.z - mark.pos.z;
    if (mx * mx + mz * mz > r2) continue;
    out.push(b.id);
  }
  out.sort((a, b) => a - b);
  return out.length > cap ? out.slice(0, cap) : out;
}

/** The crosshair's pulse rate (cycles a second): a slow throb when the bar
 *  opens, a frantic one as it lands. */
export function reticleRate(fill: number): number {
  const f = Math.max(0, Math.min(1, fill));
  return 1.6 + 6.4 * f * f;
}

export interface ReticleLook {
  /** Yards across. */
  size: number;
  /** 0..1 opacity of the strokes. */
  alpha: number;
  /** How far the four ticks have closed on the centre, 0..1. */
  close: number;
  /** Radians the outer ring has turned. */
  spin: number;
}

/** The crosshair at pulse `phase` (cycles) and bar fill `fill`. */
export function reticleLook(phase: number, fill: number): ReticleLook {
  const f = Math.max(0, Math.min(1, fill));
  const beat = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
  const size = RETICLE_OPEN + (RETICLE_LOCKED - RETICLE_OPEN) * f;
  return {
    size: size * (1 + 0.12 * beat),
    alpha: Math.min(1, 0.6 + 0.3 * f + 0.25 * beat),
    close: f,
    spin: phase * 0.6,
  };
}

export interface AimLineLook {
  alpha: number;
  /** Yards a second the dashes run toward the mark. */
  flow: number;
  /** The ribbon's width, yards. */
  width: number;
}

/** An aiming line's look at bar fill `fill`: faint and slow when the shout
 *  opens, hot and racing as it lands. */
export function aimLineLook(fill: number): AimLineLook {
  const f = Math.max(0, Math.min(1, fill));
  return { alpha: 0.35 + 0.6 * f, flow: 4 + 14 * f, width: 0.07 + 0.08 * f };
}

/**
 * Where a marked bolt ends: at the mark's chest, or (blocked) at the first
 * spot along the line the sight probe calls blocked, bisected and stood off
 * the wall face. `clearAt(d)` asks "is the line from the shooter clear d
 * yards out toward the mark?". When the probe finds the whole line clear
 * (the sim tested body to body and disagreed by a hair), the bolt stops
 * short of the mark at 85 percent of the way, still never in their chest.
 */
export function markedBoltEnd(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  blocked: boolean,
  clearAt: (d: number) => boolean,
  steps: number = BOLT_BISECT,
): { x: number; y: number; z: number; t: number } {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz);
  if (!blocked || dist < 1e-6) return { x: to.x, y: to.y, z: to.z, t: 1 };
  let reach = sightReach(clearAt, dist, steps);
  if (reach >= dist - 1e-6) reach = dist * 0.85;
  const t = Math.max(0, (reach - WALL_STANDOFF) / dist);
  return {
    x: from.x + dx * t,
    y: from.y + (to.y - from.y) * t,
    z: from.z + dz * t,
    t,
  };
}

/** The bolt's red tracer length `traveled` yards into its flight. */
export function markedTrailLength(traveled: number): number {
  return Math.max(0, Math.min(traveled, MARKED_TRAIL));
}
