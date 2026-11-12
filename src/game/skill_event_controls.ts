// Client-side routing for the hourly skill event bar (src/sim/pvp/skill_events.ts).
//
// While you fight a running skill event your normal action bar is locked: keys
// 1 to N press the event's kit verbs in bar order, and the key after them casts
// the one class ability you kept. Every press is a request; the sim checks the
// event, the verb, its timing and the keepsake.

import type { IWorld } from '../world_api';

export type SkillEventControlWorld = Pick<
  IWorld,
  'player' | 'skillEventInfo' | 'skillEventAction' | 'castAbility'
>;

/** The kit is live: you joined, the event runs, and it has kit verbs. */
export function skillEventControlsActive(world: Pick<IWorld, 'skillEventInfo'>): boolean {
  const info = world.skillEventInfo;
  return !!info && info.phase === 'running' && !!info.kit && info.kit.verbs.length > 0;
}

/** Slot `slot` (0-based) pressed: a kit verb, or the keepsake after them. */
export function skillEventChooseSlot(world: SkillEventControlWorld, slot: number): void {
  if (world.player.dead || !skillEventControlsActive(world)) return;
  const kit = world.skillEventInfo?.kit;
  if (!kit) return;
  const verb = kit.verbs[slot];
  if (verb) {
    world.skillEventAction(verb.id);
    return;
  }
  if (slot === kit.verbs.length && kit.keepsake) world.castAbility(kit.keepsake);
}
