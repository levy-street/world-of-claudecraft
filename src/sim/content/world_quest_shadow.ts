import type { NpcDef, WorldQuestDef } from '../types';
import type { ShadowCone } from '../world_quest_shadow_patrol';

export const SHADOW_QUEST_ID = 'wq_eastbrook_shadow';
export const SHADOW_NPC_ID = 2_146_900_040;
// The courier post sits on the open meadow of Brightwood Glade, the pocket the
// Wolf Run, Old Greyjaw's prowl, the Copper Dig and the Fallen Chapel undead all
// leave alone (every quest point clears each camp disc, its wander margin and the
// mob's aggro radius by 14 yd or more). It used to sit inside the Vale Bandit
// camp disc (centre 80,15 r28.5), so roaming bandits walked onto the guard posts
// and every pull broke the cloak. Every position below is the old layout
// translated rigidly by (-11, +126); the patrol geometry (and its pinned rear
// openings) is unchanged.
export const SHADOW_SITE = { x: 54, z: 146, radius: 34 };
/** Where a caught player (and the dev arm) lands: behind the scout, outside every ring. */
export const SHADOW_SAFE_SPOT = { x: 31, z: 138 };
export const SHADOW_NPC_DEF: NpcDef = {
  id: 'shadow_cloak_scout',
  name: 'Scout Valerie',
  title: 'Covert Operations',
  pos: { x: 35, z: 138 },
  facing: 1.2,
  color: 0x637591,
  questIds: [],
  dynamic: true,
  greeting:
    'Borrow my duskweave cloak. Slip in behind each dispatch carrier and lift his orders. Stay out of the lantern beams: a lantern guard sees straight through the enchantment, and a carrier feels you if you brush against him.',
};
/** Every lantern cone is the same wide beam: a bright, readable wedge, not a sliver. */
export const SHADOW_LANTERN_CONE: ShadowCone = { radius: 10, halfAngle: 0.85 };

/** A wide carrier circle fills suspicion this slowly: long enough to lift the
 *  dispatch (a one-second steal) and step back out, not long enough to loiter. */
export const SHADOW_WIDE_CIRCLE_FILL_SECONDS = 4.5;

// Two guard families: dispatch carriers (circle-only, the steal targets; you slip
// in behind them) and lantern guards (a small contact circle plus a forward cone
// that pierces the cloak). Two lantern sentries patrol, two lantern watchmen hold
// fixed posts facing the approach lanes. Two carriers keep a tight circle (a
// brush is survivable, standing on them is not); the other two wear a wide one
// with the slow fill above, a different rhythm of the same rule.
export const SHADOW_GUARDS: readonly {
  entityId: number;
  npc: NpcDef;
  sentry: boolean;
  detectionRadius: number;
  /** Seconds inside the contact circle before capture (default: SHADOW_CONTACT_FILL_SECONDS). */
  contactFillSeconds?: number;
  cone?: ShadowCone;
  patrol?: { x: number; z: number; period: number; pause: number };
}[] = [
  {
    entityId: 2146900041,
    sentry: false,
    detectionRadius: 1.2,
    npc: {
      id: 'shadow_guard_north',
      name: 'Dispatch Guard',
      title: 'Dispatch Carrier',
      greeting: 'These sealed orders are for the captain. Keep your distance.',
      pos: { x: 44, z: 144 },
      facing: 0,
      color: 0x875641,
      questIds: [],
      dynamic: true,
    },
  },
  {
    entityId: 2146900042,
    sentry: false,
    detectionRadius: 1.2,
    npc: {
      id: 'shadow_guard_south',
      name: 'Dispatch Guard',
      title: 'Dispatch Carrier',
      greeting: 'I have a dispatch to deliver. Move along.',
      pos: { x: 51, z: 158 },
      facing: 2,
      color: 0x875641,
      questIds: [],
      dynamic: true,
    },
  },
  {
    entityId: 2146900043,
    sentry: false,
    detectionRadius: 5.5,
    contactFillSeconds: SHADOW_WIDE_CIRCLE_FILL_SECONDS,
    npc: {
      id: 'shadow_guard_east',
      name: 'Dispatch Guard',
      title: 'Dispatch Carrier',
      greeting: 'No delays. The watch is waiting for these orders.',
      pos: { x: 62, z: 150 },
      facing: 1,
      color: 0x875641,
      questIds: [],
      dynamic: true,
    },
  },
  {
    entityId: 2146900044,
    sentry: false,
    detectionRadius: 5.5,
    contactFillSeconds: SHADOW_WIDE_CIRCLE_FILL_SECONDS,
    npc: {
      id: 'shadow_guard_west',
      name: 'Dispatch Guard',
      title: 'Dispatch Carrier',
      greeting: 'Official business. Keep the path clear.',
      pos: { x: 66, z: 136 },
      facing: 3,
      color: 0x875641,
      questIds: [],
      dynamic: true,
    },
  },
  {
    entityId: 2146900045,
    sentry: true,
    detectionRadius: 1.5,
    cone: SHADOW_LANTERN_CONE,
    patrol: { x: 67, z: 134, period: 12, pause: 3 },
    npc: {
      id: 'shadow_sentry_south',
      name: 'Lantern Sentry',
      title: 'True Sight',
      greeting: 'My lantern reveals more than shadows. Stay where I can see you.',
      pos: { x: 47, z: 160 },
      facing: 1.5,
      color: 0xd4a553,
      questIds: [],
      dynamic: true,
    },
  },
  {
    entityId: 2146900046,
    sentry: true,
    detectionRadius: 1.5,
    cone: SHADOW_LANTERN_CONE,
    patrol: { x: 68, z: 156, period: 14, pause: 3 },
    npc: {
      id: 'shadow_sentry_north',
      name: 'Lantern Sentry',
      title: 'True Sight',
      greeting: 'Nothing slips past the lantern watch.',
      pos: { x: 43, z: 142 },
      facing: 1.5,
      color: 0xd4a553,
      questIds: [],
      dynamic: true,
    },
  },
  {
    entityId: 2146900047,
    sentry: true,
    detectionRadius: 1.5,
    cone: SHADOW_LANTERN_CONE,
    // A short beat along the west lane; the beam sweeps with the walk.
    patrol: { x: 44, z: 160, period: 8, pause: 3 },
    npc: {
      id: 'shadow_watch_west',
      name: 'Lantern Watchman',
      title: 'True Sight',
      greeting: 'Hold there. The lantern sees what the eye misses.',
      pos: { x: 44, z: 152 },
      facing: 1.5708,
      color: 0xd4a553,
      questIds: [],
      dynamic: true,
    },
  },
  {
    entityId: 2146900048,
    sentry: true,
    detectionRadius: 1.5,
    cone: SHADOW_LANTERN_CONE,
    // A short beat along the east lane.
    patrol: { x: 71, z: 138, period: 8, pause: 3 },
    npc: {
      id: 'shadow_watch_east',
      name: 'Lantern Watchman',
      title: 'True Sight',
      greeting: 'Nobody crosses my light unseen.',
      pos: { x: 71, z: 146 },
      facing: -1.5708,
      color: 0xd4a553,
      questIds: [],
      dynamic: true,
    },
  },
];
export const WORLD_QUEST_SHADOW: WorldQuestDef = {
  id: SHADOW_QUEST_ID,
  zoneId: 'eastbrook_vale',
  minLevel: 5,
  area: SHADOW_SITE,
  objective: { type: 'shadow', instructorNpcId: SHADOW_NPC_DEF.id },
  count: 4,
};

export function isShadowNpc(templateId: string): boolean {
  return (
    templateId === SHADOW_NPC_DEF.id || SHADOW_GUARDS.some((guard) => guard.npc.id === templateId)
  );
}
