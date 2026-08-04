// Shared while-dead refusal for command families that must not run for a
// dead player (released ghost included). Call sites fall into two shapes:
//
// 1. Sim wrappers that emit a result event unconditionally after the
//    resolver (craft/train/salvage/disenchant/enchant-apply/unbind): the
//    gate sits on the wrapper ABOVE the resolver so a refusal emits NO
//    result event at all.
// 2. Modules that own their own entry (tool-effect slot/recharge, mobile-
//    station placement, the rift forge trio): the gate lives inside the
//    module so every entry path (wire command, /dev cheat, direct call)
//    shares it. Mobile-station and tool-effect emit no wrapper-side result
//    event; the rift forge owns its emits and skips them on this arm.
//
// The shared error line is the single player-facing surface, which keeps
// every family's wire reason enum untouched and cannot double-print against
// the family's own denial rendering. The literal already has a matcher row
// (error.cantWhileDead in src/ui/sim_i18n.ts), so both hosts localize it.
import type { SimContext } from './sim_context';

/** True when the command must be refused because the acting player is dead
 *  (released ghost included); emits the family's shared error line. False
 *  for an alive player AND for an unresolvable pid (the caller's own
 *  resolve keeps handling that arm the way it always did). */
export function refusedWhileDead(ctx: SimContext, pid?: number): boolean {
  const r = ctx.resolve(pid);
  if (!r || !r.e.dead) return false;
  ctx.error(r.meta.entityId, "You can't do that while dead.");
  return true;
}
