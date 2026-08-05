// Swim fatigue: the Veiled Hollow's open sea has no wall, so distance itself
// turns swimmers back. Past the fatigue line (inHollowOpenSea: no land lobe
// within reach) a warning fires, a short grace runs out, and the sea deals
// rising unavoidable damage until the player returns toward shore. Death
// out there releases to the realm graveyard like any other death.
//
// Runs per live player in the tick beside the door/portal triggers; draws no
// rng, so all three hosts stay identical.

import type { SimContext } from './sim_context';
import type { Entity } from './types';
import { inHollowOpenSea, waterLevel } from './world';

const GRACE_TICKS = 160; // 8s of warning first: real time to turn around
const PULSE_TICKS = 20; // then one pulse per second
const PULSE_PCT = 0.08; // rising: 8%, 16%, 24% ... of max hp
const REWARN_TICKS = 80; // the on-screen warning repeats every 4s out there

export const FATIGUE_WARNING = 'The open sea saps your strength. Swim back to shore!';

export function updateSwimFatigue(ctx: SimContext, p: Entity): void {
  if (p.kind !== 'player') return;
  // The ACTIVE waterline (custom maps override it); the built-in constant
  // here silently killed or disabled fatigue on any map with a moved sea.
  const swimmingOut = p.pos.y <= waterLevel() + 0.4 && inHollowOpenSea(p.pos.x, p.pos.z) && !p.dead;
  if (!swimmingOut) {
    p.fatigueTicks = 0;
    return;
  }
  p.fatigueTicks++;
  if (p.fatigueTicks === 1) {
    ctx.emit({ type: 'log', text: FATIGUE_WARNING, color: '#f96', pid: p.id });
  }
  // keep the danger on the SCREEN, not just in the chat log: an error toast
  // on entry and again every few seconds until the swimmer turns back (the
  // string is the registered one, so it localizes like the log line)
  if (p.fatigueTicks % REWARN_TICKS === 1) {
    ctx.emit({ type: 'error', text: FATIGUE_WARNING, pid: p.id });
  }
  const past = p.fatigueTicks - GRACE_TICKS;
  if (past > 0 && past % PULSE_TICKS === 0) {
    const pulses = past / PULSE_TICKS;
    const dmg = Math.max(5, Math.round(p.maxHp * PULSE_PCT * pulses));
    ctx.dealDamage(null, p, dmg, false, 'physical', 'Fatigue', 'hit', true);
  }
}
