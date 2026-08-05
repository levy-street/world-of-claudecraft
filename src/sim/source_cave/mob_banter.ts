// Friendly-phase contributor banter: interacting with a friendly (pre-reboot)
// cave mob makes it answer one random line from the list below, as say-channel
// chat delivered to everyone in normal say range (the well_banter.ts sibling
// gate, but random instead of sequential, and spoken by the mob).
//
// Localization: the lines are stable sim-side payloads, variable-routed through
// the emit below (invisible to the S3 literal scan by design, like the well
// banter and the reboot yells); the UI matches each payload back to its
// worldContent.sourceCaveBanter* key in src/ui/source_cave_reboot_yell.ts's
// game-authored-line map, which the hud consults for every cave-mob chat line.
//
// Determinism: exactly ONE ctx.rng.int draw per accepted interaction, at the
// command site (the same pattern as submitLootRoll's need/greed roll). Cave
// mobs exist only inside a claimed instance, so the draw never occurs in a
// world without one.

import { SAY_RANGE } from '../sim';
import type { SimContext } from '../sim_context';
import { dist2d, type Entity } from '../types';
import { isSourceCaveMobEntity } from './runtime';

export const SOURCE_CAVE_MOB_BANTER_LINES = [
  'Please create an issue.',
  "Don't hesitate to create a pull request.",
  'I hate conflicts...',
  'Yes, of course you can contribute to this project!',
  "Sorry, but I'm focused right now.",
  'The next release will be awesome!',
  'Hmm? Try refreshing.',
] as const;

/** Is this a mob the friendly-phase banter applies to right now? */
export function isSourceCaveBanterTarget(mob: Entity): boolean {
  return isSourceCaveMobEntity(mob) && !mob.dead && !mob.hostile;
}

/**
 * A player interacts with a friendly contributor: answer one random banter
 * line as say-channel chat (bubble + chat log) to everyone in say range.
 */
export function sourceCaveMobBanter(ctx: SimContext, mob: Entity, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r || r.e.dead || !isSourceCaveBanterTarget(mob)) return;
  const line =
    SOURCE_CAVE_MOB_BANTER_LINES[ctx.rng.int(0, SOURCE_CAVE_MOB_BANTER_LINES.length - 1)];
  const event = {
    type: 'chat' as const,
    fromPid: mob.id,
    from: mob.name,
    text: line,
    channel: 'say' as const,
    entityId: mob.id,
  };
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (!p || dist2d(p.pos, mob.pos) > SAY_RANGE) continue;
    ctx.emit({ ...event, pid: meta.entityId });
  }
}
