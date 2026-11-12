// /dev heart <boss> death: replay a Smith's Heart guardian's death scene on
// its living body (ALLOW_DEV_COMMANDS only, reached through smith_heart_dev.ts
// like every /dev heart verb). Presentation only: a spellfx cue on the boss
// that the renderer plays and claims (src/render/smith_heart_fx/); no kill,
// no pull, no loot, no state on the boss.
//
//   /dev heart council death [guardian|singer]
//                         both members (the Singer a breath after the
//                         Guardian, so the encounter's end beat follows
//                         her), or one (render/smith_heart_fx/
//                         council_death_core.ts)
//   /dev heart heat death  the Guardian of the Heat (render/smith_heart_fx/
//                         heat_death_core.ts)

import { COUNCIL_DEV_CUES, councilRoleOf } from '../encounters/smith_heart/council_ids';
import { HEAT_DEV_CUES } from '../encounters/smith_heart/heat_ids';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

/** Emit a death replay cue on `boss` (a living body only). */
function cue(ctx: SimContext, boss: Entity, ability: string): void {
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'arcane',
    fx: 'nova',
    ability,
  });
}

/** `/dev heart council death [guardian|singer]` over the run's two members
 *  (null when the run holds no council). */
export function councilDeathReplayForDev(
  ctx: SimContext,
  members: readonly (Entity | null)[],
  which: string | undefined,
): string {
  let n = 0;
  for (const m of members) {
    if (!m || m.dead) continue;
    const role = councilRoleOf(m.templateId);
    if (!role) continue;
    if (which && which !== role) continue;
    cue(ctx, m, COUNCIL_DEV_CUES.deathReplay);
    n++;
  }
  if (n === 0) return 'No living council member to play a death on (/dev heart council reset).';
  return n === 2
    ? 'The Hammer Council plays its deaths (presentation only: both still stand).'
    : `The ${which === 'singer' ? 'Seam Singer' : 'Guardian of the Hammer'} plays its death (presentation only: it still stands).`;
}

/** `/dev heart heat death` on the run's guardian. */
export function heatDeathReplayForDev(ctx: SimContext, boss: Entity | null): string {
  if (!boss || boss.dead)
    return 'No living Guardian of the Heat to play a death on (/dev heart reset).';
  cue(ctx, boss, HEAT_DEV_CUES.deathReplay);
  return 'The Guardian of the Heat plays its death (presentation only: it still burns).';
}
