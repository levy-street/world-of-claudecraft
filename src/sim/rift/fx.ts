import type { SimContext } from '../sim_context';

/** Play a themed impact VFX (and optionally a themed one-shot SFX) at a WORLD
 *  spot for an interactive rift moment (the ice-slide launch, a boulder shove,
 *  a rune flare, a lava burn, a gate grind, a portal opening). It reuses the
 *  already-wired `spellfxAt` world event, so it interest-scopes to everyone in
 *  the instance and renders on all three hosts with no new event/wire surface.
 *  It is render-only (draws no rng, touches no sim state), so it is
 *  determinism-safe. `sfxKey`, when given, replaces the client's generic
 *  nova/burst+school sound with a fixed manifest key (a custom recording);
 *  omit it to keep the generic sound. `pid`, when given, makes this a personal
 *  cue delivered only to that player (e.g. stepping through a portal). */
export function riftFx(
  ctx: SimContext,
  x: number,
  z: number,
  school: string,
  fx: 'burst' | 'nova' = 'burst',
  sfxKey?: string,
  pid?: number,
): void {
  ctx.emit({ type: 'spellfxAt', x, z, school, fx, sfxKey, pid });
}
