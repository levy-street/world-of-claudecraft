// Boss bark broadcast: deliver a mob's yell line as 'yell'-channel chat to every
// player within YELL_RANGE, one per-player event copy (pid-routed), mirroring the
// Nythraxis encounter's emitNythraxisYell. The lines themselves live on
// MobTemplate.yells / MobTemplate.bigCast.yell (data-as-code, zone content files)
// and ship as sim-emitted English under the variable-routed-chat precedent (see
// the S3 note about boss yells in tests/localization_fixes.test.ts).
//
// src/sim-pure leaf: no DOM/render/ui imports, no rng, no clock; reads entities
// and emits through the SimContext seam only.

import type { SimContext } from '../sim_context';
import { dist2d, type Entity, YELL_RANGE } from '../types';

export function emitMobYell(ctx: SimContext, mob: Entity, text: string): void {
  const event = {
    type: 'chat' as const,
    fromPid: mob.id,
    from: mob.name,
    text,
    channel: 'yell' as const,
    entityId: mob.id,
  };
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (!p || dist2d(p.pos, mob.pos) > YELL_RANGE) continue;
    ctx.emit({ ...event, pid: meta.entityId });
  }
}
