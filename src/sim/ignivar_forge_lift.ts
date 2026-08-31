// The Forge-Lift: the raid family's first room, a sealed car between two
// portals (the keep facade's overworld door in, an exit gate out). The room
// NEVER moves; the descent is presentation (src/render/ignivar_lift_room.ts
// scrolls the shaft past the car's grilles). This module owns the sim half:
// for a fixed ride after the instance claim the exit gate stays a locked
// object (a sealed room needs no crossing clamp), then it swaps into an
// ordinary room-crossing 'dungeon_door' portal to the Halls through the
// SAME unlock the Sealed Herald Gate uses. One-way per claim; freeInstance
// tears the gate down so a fresh claim re-arms the ride. Draws NO rng.
import { DUNGEONS, instanceOrigin } from './data';
import {
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_LIFT_GATE_LOCKED_TEMPLATE,
  IGNIVAR_LIFT_ROOM_ID,
} from './ignivar_raid_ids';
import { unlockGateTo } from './ignivar_raid_progression';
import type { SimContext } from './sim_context';

/** How long the car "descends" after the instance claim before the exit
 *  gate opens. Checked at the 1 Hz instance sweep, so the portal lands
 *  within a second of this; late joiners (anyone entering after the ride)
 *  find it already open. */
export const IGNIVAR_LIFT_RIDE_SECONDS = 9;

/** Pure ride predicate: has this claim's lift finished its descent? */
export function ignivarLiftArrived(claimedAt: number | undefined, now: number): boolean {
  return claimedAt !== undefined && now - claimedAt >= IGNIVAR_LIFT_RIDE_SECONDS;
}

/** The 1 Hz arrival sweep (rides updateInstances beside the raid
 *  progression): once a lift claim's ride elapses, unlock its exit gate
 *  into the Halls (the herald-gate template swap: the renderer rebuilds
 *  the view into the standard portal, the walk-in trigger arms, both
 *  hosts mirror it through the wire), grind the shaft sound, and tell
 *  everyone aboard. */
export function updateIgnivarForgeLift(ctx: SimContext): void {
  for (const inst of ctx.instances) {
    if (inst.dungeonId !== IGNIVAR_LIFT_ROOM_ID || inst.partyKey === null) continue;
    if (!ignivarLiftArrived(inst.claimedAt, ctx.time)) continue;
    const gate = unlockGateTo(
      ctx,
      inst,
      IGNIVAR_FORGE_APPROACH_ID,
      IGNIVAR_LIFT_GATE_LOCKED_TEMPLATE,
    );
    if (!gate) continue; // already open (or torn down mid-sweep)
    // The rift gate's grind, reused verbatim: spellfxAt interest-scopes to
    // the instance and carries the recorded one-shot on every host.
    ctx.emit({
      type: 'spellfxAt',
      x: gate.pos.x,
      z: gate.pos.z,
      school: 'fire',
      fx: 'nova',
      sfxKey: 'rift_gate_grind',
    });
    const origin = instanceOrigin(DUNGEONS[IGNIVAR_LIFT_ROOM_ID].index, inst.slot);
    for (const member of ctx.players.values()) {
      const player = ctx.entities.get(member.entityId);
      if (!player) continue;
      if (Math.abs(player.pos.x - origin.x) > 120 || Math.abs(player.pos.z - origin.z) > 250)
        continue;
      ctx.emit({
        type: 'log',
        text: 'The forge-lift settles; its gate grinds open.',
        color: '#ffb066',
        pid: player.id,
      });
    }
  }
}
