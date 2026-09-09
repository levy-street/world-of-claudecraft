import type { SimContext } from '../sim_context';
import { RIGHTEOUS_FURY_THREAT_MULT, threatModifier } from '../threat';
import type { Entity } from '../types';

// Threat modifier including the tank-role talent bonus (e.g. Protection's
// Vengeance Mastery). Reads the precomputed flat threatPct: no tree walk.
export function threatMod(ctx: SimContext, source: Entity, school: string): number {
  let m = threatModifier(source, school);
  if (source.kind === 'player') {
    const meta = ctx.players.get(source.id);
    if (meta) {
      m *= 1 + ctx.playerMods(meta).global.threatPct;
      const hasBurningOath = meta.known.some(
        (known) => known.def.id === 'righteous_fury' && known.def.passive === true,
      );
      if (hasBurningOath && school === 'holy') m *= RIGHTEOUS_FURY_THREAT_MULT;
    }
  }
  return m;
}
