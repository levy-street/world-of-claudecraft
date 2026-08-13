// Pure semantic classification for map/minimap world-object markers. Template ids
// are classified here before generic loot handling so navigation and reward objects
// cannot silently collapse into the same sparkle marker.

import type { RiftTier } from '../sim/types';

export type MapMarkerSemantic =
  | { kind: 'dungeon'; role: 'entrance' | 'exit' }
  | { kind: 'rift-entrance'; rank: RiftTier | null }
  | { kind: 'rift-descent' }
  | { kind: 'rift-return'; route: 'beacon' | 'egress'; rank: RiftTier | null }
  | { kind: 'rift-reward'; reward: 'treasure' | 'cache'; state: RiftRewardState }
  | RiftMechanicSemantic
  | { kind: 'delve-passage'; state: 'sealed' | 'open' }
  | { kind: 'delve-surface' }
  | {
      kind: 'delve-reward';
      reward: 'cache' | 'reliquary';
      state: DelveRewardState;
      bountiful: boolean;
    };

export type RiftRewardState = 'available' | 'locked' | 'opened' | 'jammed';
export type RiftMechanicSemantic =
  | { kind: 'rift-mechanic'; mechanic: 'pylon' | 'sequence-rune'; state: 'unlit' | 'lit' }
  | { kind: 'rift-mechanic'; mechanic: 'ice-goal' | 'boulder-pad'; state: 'target' }
  | { kind: 'rift-mechanic'; mechanic: 'boulder'; state: 'movable' | 'placed' }
  | { kind: 'rift-mechanic'; mechanic: 'gate'; state: 'sealed' | 'open' }
  | { kind: 'rift-mechanic'; mechanic: 'switch'; state: 'ready' | 'on' }
  | { kind: 'rift-mechanic'; mechanic: 'orb'; state: 'dormant' | 'active' }
  | { kind: 'rift-mechanic'; mechanic: 'roller'; state: 'hazard' };
export type DelveRewardState = 'locked' | 'ready' | 'active' | 'opened';
export type MapMarkerSemanticLayer = 'mechanic' | 'reward' | 'navigation';

export interface MapMarkerSemanticEntity {
  kind: string;
  templateId: string;
  riftTier?: RiftTier;
}

export interface MapMarkerSemanticContext {
  delveRun: {
    exitPortalOpen: boolean;
    bountiful: boolean;
    rite: { phase: 'choose' | 'playback' | 'input' | 'open' } | null;
  } | null;
}

function delveReliquaryState(context: MapMarkerSemanticContext): DelveRewardState {
  switch (context.delveRun?.rite?.phase) {
    case 'choose':
      return 'ready';
    case 'playback':
    case 'input':
      return 'active';
    case 'open':
      return 'opened';
    default:
      // A reliquary entity without its live rite mirror is not actionable. This
      // also gives older online payloads a truthful low-salience fallback.
      return 'locked';
  }
}

/** Classify one live entity. Non-objects and ordinary objects deliberately return
 * null so callers can continue through their existing NPC/mob/generic-loot paths. */
export function classifyMapObjectMarker(
  entity: MapMarkerSemanticEntity,
  context: MapMarkerSemanticContext,
): MapMarkerSemantic | null {
  if (entity.kind !== 'object') return null;
  const bountiful = context.delveRun?.bountiful ?? false;
  switch (entity.templateId) {
    case 'dungeon_door':
      return { kind: 'dungeon', role: 'entrance' };
    case 'dungeon_exit':
      return { kind: 'dungeon', role: 'exit' };
    case 'rift_portal':
      return { kind: 'rift-entrance', rank: entity.riftTier ?? null };
    case 'rift_descent':
      return { kind: 'rift-descent' };
    case 'rift_beacon':
      return { kind: 'rift-return', route: 'beacon', rank: null };
    case 'rift_exit':
      return { kind: 'rift-return', route: 'egress', rank: entity.riftTier ?? null };
    case 'rift_treasure':
      return { kind: 'rift-reward', reward: 'treasure', state: 'available' };
    case 'rift_treasure_open':
      return { kind: 'rift-reward', reward: 'treasure', state: 'opened' };
    case 'rift_locked_chest':
      return { kind: 'rift-reward', reward: 'cache', state: 'locked' };
    case 'rift_chest_open':
      return { kind: 'rift-reward', reward: 'cache', state: 'opened' };
    case 'rift_chest_jammed':
      return { kind: 'rift-reward', reward: 'cache', state: 'jammed' };
    case 'rift_pylon':
      return { kind: 'rift-mechanic', mechanic: 'pylon', state: 'unlit' };
    case 'rift_pylon_lit':
      return { kind: 'rift-mechanic', mechanic: 'pylon', state: 'lit' };
    case 'rift_ice_goal':
      return { kind: 'rift-mechanic', mechanic: 'ice-goal', state: 'target' };
    case 'rift_seq_rune':
      return { kind: 'rift-mechanic', mechanic: 'sequence-rune', state: 'unlit' };
    case 'rift_seq_rune_lit':
      return { kind: 'rift-mechanic', mechanic: 'sequence-rune', state: 'lit' };
    case 'rift_boulder':
      return { kind: 'rift-mechanic', mechanic: 'boulder', state: 'movable' };
    case 'rift_boulder_placed':
      return { kind: 'rift-mechanic', mechanic: 'boulder', state: 'placed' };
    case 'rift_boulder_pad':
      return { kind: 'rift-mechanic', mechanic: 'boulder-pad', state: 'target' };
    case 'rift_gate':
      return { kind: 'rift-mechanic', mechanic: 'gate', state: 'sealed' };
    case 'rift_gate_open':
      return { kind: 'rift-mechanic', mechanic: 'gate', state: 'open' };
    case 'rift_switch':
      return { kind: 'rift-mechanic', mechanic: 'switch', state: 'ready' };
    case 'rift_switch_on':
      return { kind: 'rift-mechanic', mechanic: 'switch', state: 'on' };
    case 'rift_infernal_orb':
      return { kind: 'rift-mechanic', mechanic: 'orb', state: 'dormant' };
    case 'rift_infernal_orb_active':
      return { kind: 'rift-mechanic', mechanic: 'orb', state: 'active' };
    case 'rift_roller':
      return { kind: 'rift-mechanic', mechanic: 'roller', state: 'hazard' };
    case 'delve_module_exit':
      return {
        kind: 'delve-passage',
        state: context.delveRun?.exitPortalOpen ? 'open' : 'sealed',
      };
    case 'delve_surface_exit':
      return { kind: 'delve-surface' };
    case 'delve_locked_chest':
      return { kind: 'delve-reward', reward: 'cache', state: 'locked', bountiful };
    case 'delve_reward_chest':
      return { kind: 'delve-reward', reward: 'cache', state: 'opened', bountiful };
    case 'delve_drowned_reliquary':
      return {
        kind: 'delve-reward',
        reward: 'reliquary',
        state: delveReliquaryState(context),
        bountiful,
      };
    case 'delve_drowned_reliquary_open':
      return { kind: 'delve-reward', reward: 'reliquary', state: 'opened', bountiful };
    default:
      return null;
  }
}

/** Layer classification stays exhaustive over MapMarkerSemantic, so adding a new
 * semantic requires an explicit draw-order decision. */
export function mapMarkerSemanticLayer(semantic: MapMarkerSemantic): MapMarkerSemanticLayer {
  switch (semantic.kind) {
    case 'rift-mechanic':
      return 'mechanic';
    case 'rift-reward':
    case 'delve-reward':
      return 'reward';
    case 'dungeon':
    case 'rift-entrance':
    case 'rift-descent':
    case 'rift-return':
    case 'delve-passage':
    case 'delve-surface':
      return 'navigation';
    default: {
      const exhaustive: never = semantic;
      return exhaustive;
    }
  }
}
