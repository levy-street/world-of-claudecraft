// The warpath's dev trace: a one-line "why" for every phase change a warpather makes.
//
// Testing Balgath's circuit by eye is guesswork: a march that ends early, a picket he
// skips, a pull he gives up all look alike from the ground. With dev commands on (the
// local playtest realm's ALLOW_DEV_COMMANDS, SimConfig.devCommands), every warpath phase
// change is narrated as a short system line to the players standing near him, so the
// tester can see which rule fired. Production never runs dev commands, so there it is a
// single boolean check and nothing else.
//
// Dev channel, deliberately English (root CLAUDE.md i18n: dev-channel text stays English),
// sent the same way the /dev command replies are (dev_commands.ts emitDevLog): a pid-scoped
// `log` event. Deterministic-safe: it only reads state and emits presentation events; it
// never writes sim state and never draws rng, so a dev realm and a production realm tick
// identically.

import type { SimContext } from '../sim_context';
import { dist2d, type Entity } from '../types';

/** Players within this of him hear the trace (the snapshot interest radius, about). */
export const WARPATH_DEV_TRACE_RANGE = 120;

/** The name the trace uses: "Balgath", not his whole title. */
function shortName(mob: Entity): string {
  const comma = mob.name.indexOf(',');
  return comma > 0 ? mob.name.slice(0, comma) : mob.name;
}

/**
 * Narrate one warpath decision to every player near him. `what` builds the short English
 * clause, and is only called with dev commands on, so production never even formats it.
 */
export function traceWarpath(ctx: SimContext, mob: Entity, what: () => string): void {
  if (!ctx.devCommands) return;
  const text = `[dev] ${shortName(mob)}: ${what()}`;
  for (const [pid, meta] of ctx.players) {
    const p = ctx.entities.get(meta.entityId);
    if (!p || dist2d(p.pos, mob.pos) > WARPATH_DEV_TRACE_RANGE) continue;
    ctx.emit({ type: 'log', text, pid });
  }
}
