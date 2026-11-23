// The trash engine's demonstration kit: one record carrying every engine key
// no shipped dungeon uses yet (G6's line-of-sight nova, G5's walker), so the
// pieces can be playtested and captured before another dungeon's trash adopts
// them. Never on a template: only `/dev trashkit demo` (dev/trash_engine_dev.ts)
// lends it to a mob, through Entity.devTrashKit, and the suites do the same.
// The renderer reads the same record to draw the demo nova's ring and the
// walker orb, exactly as it reads a template's kit.
//
// Numbers sit in the Sanctum's band (a level-20 dungeon, the 950 health cloth
// reference): the nova 140 to 160 (about 16 percent), the walker's empower 25
// percent more damage for 10 s.

import type { Aura, TrashKitDef } from '../../types';

/** The demo nova's cast id (kickable) and its every-third unstoppable twin. */
export const TRASH_DEMO_NOVA = 'trash_demo_nova';
export const TRASH_DEMO_NOVA_UNSTOPPABLE = 'trash_demo_nova_unstoppable';
/** The demo walker's launch cast id and its orb's object template. */
export const TRASH_DEMO_WALKER = 'trash_demo_walker';
export const TRASH_DEMO_WALKER_ORB = 'trash_demo_walker_orb';
/** The aura a demo walker leaves on the ally it reaches (or the player who
 *  took it). */
export const TRASH_DEMO_EMPOWERED = 'trash_demo_empowered';

export const TRASH_ENGINE_DEMO_KIT: TrashKitDef = {
  nova: {
    castId: TRASH_DEMO_NOVA,
    name: 'Test Nova',
    castTime: 2.5,
    every: 12,
    first: 3,
    school: 'frost',
    radius: 20,
    min: 140,
    max: 160,
    silence: 2,
    unstoppableEvery: 3,
    unstoppableCastId: TRASH_DEMO_NOVA_UNSTOPPABLE,
  },
  walker: {
    castId: TRASH_DEMO_WALKER,
    name: 'Test Orb',
    objectTemplate: TRASH_DEMO_WALKER_ORB,
    launch: 'cast',
    castTime: 1.5,
    every: 14,
    first: 6,
    school: 'fire',
    speed: 4,
    interceptRadius: 1.6,
    reachRadius: 1.5,
    maxSeconds: 12,
    empower: { auraId: TRASH_DEMO_EMPOWERED, name: 'Test Orb', damagePct: 0.25, seconds: 10 },
    intercept: { min: 40, max: 50, grantsEmpower: true },
  },
};

/** The demo casts a player interrupt can lock out (only the kickable nova). */
export const TRASH_DEMO_CAST_SCHOOLS: Readonly<Record<string, { school: Aura['school'] }>> = {
  [TRASH_DEMO_NOVA]: { school: 'frost' },
};
