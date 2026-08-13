import { describe, expect, it } from 'vitest';
import {
  classifyMapObjectMarker,
  type MapMarkerSemantic,
  type MapMarkerSemanticContext,
  mapMarkerSemanticLayer,
} from '../src/ui/map_marker_semantics_core';

const BASE_CONTEXT: MapMarkerSemanticContext = {
  delveRun: {
    exitPortalOpen: false,
    bountiful: false,
    rite: null,
  },
};

function object(templateId: string, riftTier?: 'C' | 'B' | 'A' | 'S') {
  return { kind: 'object', templateId, riftTier };
}

describe('classifyMapObjectMarker', () => {
  it.each<[string, MapMarkerSemantic]>([
    ['dungeon_door', { kind: 'dungeon', role: 'entrance' }],
    ['dungeon_exit', { kind: 'dungeon', role: 'exit' }],
    ['rift_portal', { kind: 'rift-entrance', rank: null }],
    ['rift_descent', { kind: 'rift-descent' }],
    ['rift_beacon', { kind: 'rift-return', route: 'beacon', rank: null }],
    ['rift_exit', { kind: 'rift-return', route: 'egress', rank: null }],
    ['rift_treasure', { kind: 'rift-reward', reward: 'treasure', state: 'available' }],
    ['rift_treasure_open', { kind: 'rift-reward', reward: 'treasure', state: 'opened' }],
    ['rift_locked_chest', { kind: 'rift-reward', reward: 'cache', state: 'locked' }],
    ['rift_chest_open', { kind: 'rift-reward', reward: 'cache', state: 'opened' }],
    ['rift_chest_jammed', { kind: 'rift-reward', reward: 'cache', state: 'jammed' }],
    ['rift_pylon', { kind: 'rift-mechanic', mechanic: 'pylon', state: 'unlit' }],
    ['rift_pylon_lit', { kind: 'rift-mechanic', mechanic: 'pylon', state: 'lit' }],
    ['rift_ice_goal', { kind: 'rift-mechanic', mechanic: 'ice-goal', state: 'target' }],
    ['rift_seq_rune', { kind: 'rift-mechanic', mechanic: 'sequence-rune', state: 'unlit' }],
    ['rift_seq_rune_lit', { kind: 'rift-mechanic', mechanic: 'sequence-rune', state: 'lit' }],
    ['rift_boulder', { kind: 'rift-mechanic', mechanic: 'boulder', state: 'movable' }],
    ['rift_boulder_placed', { kind: 'rift-mechanic', mechanic: 'boulder', state: 'placed' }],
    ['rift_boulder_pad', { kind: 'rift-mechanic', mechanic: 'boulder-pad', state: 'target' }],
    ['rift_gate', { kind: 'rift-mechanic', mechanic: 'gate', state: 'sealed' }],
    ['rift_gate_open', { kind: 'rift-mechanic', mechanic: 'gate', state: 'open' }],
    ['rift_switch', { kind: 'rift-mechanic', mechanic: 'switch', state: 'ready' }],
    ['rift_switch_on', { kind: 'rift-mechanic', mechanic: 'switch', state: 'on' }],
    ['rift_infernal_orb', { kind: 'rift-mechanic', mechanic: 'orb', state: 'dormant' }],
    ['rift_infernal_orb_active', { kind: 'rift-mechanic', mechanic: 'orb', state: 'active' }],
    ['rift_roller', { kind: 'rift-mechanic', mechanic: 'roller', state: 'hazard' }],
    ['delve_module_exit', { kind: 'delve-passage', state: 'sealed' }],
    ['delve_surface_exit', { kind: 'delve-surface' }],
    [
      'delve_locked_chest',
      { kind: 'delve-reward', reward: 'cache', state: 'locked', bountiful: false },
    ],
    [
      'delve_reward_chest',
      { kind: 'delve-reward', reward: 'cache', state: 'opened', bountiful: false },
    ],
    [
      'delve_drowned_reliquary',
      { kind: 'delve-reward', reward: 'reliquary', state: 'locked', bountiful: false },
    ],
    [
      'delve_drowned_reliquary_open',
      { kind: 'delve-reward', reward: 'reliquary', state: 'opened', bountiful: false },
    ],
  ])('classifies %s before generic loot handling', (templateId, expected) => {
    expect(classifyMapObjectMarker(object(templateId), BASE_CONTEXT)).toEqual(expected);
  });

  it('carries the authored rift rank only on ranked entrance and egress markers', () => {
    expect(classifyMapObjectMarker(object('rift_portal', 'S'), BASE_CONTEXT)).toEqual({
      kind: 'rift-entrance',
      rank: 'S',
    });
    expect(classifyMapObjectMarker(object('rift_exit', 'B'), BASE_CONTEXT)).toEqual({
      kind: 'rift-return',
      route: 'egress',
      rank: 'B',
    });
    expect(classifyMapObjectMarker(object('rift_beacon', 'A'), BASE_CONTEXT)).toEqual({
      kind: 'rift-return',
      route: 'beacon',
      rank: null,
    });
  });

  it('derives live delve passage, bountiful, and reliquary phases from the run mirror', () => {
    const context: MapMarkerSemanticContext = {
      delveRun: {
        exitPortalOpen: true,
        bountiful: true,
        rite: { phase: 'choose' },
      },
    };
    expect(classifyMapObjectMarker(object('delve_module_exit'), context)).toEqual({
      kind: 'delve-passage',
      state: 'open',
    });
    expect(classifyMapObjectMarker(object('delve_locked_chest'), context)).toEqual({
      kind: 'delve-reward',
      reward: 'cache',
      state: 'locked',
      bountiful: true,
    });
    expect(classifyMapObjectMarker(object('delve_drowned_reliquary'), context)).toEqual({
      kind: 'delve-reward',
      reward: 'reliquary',
      state: 'ready',
      bountiful: true,
    });

    for (const phase of ['playback', 'input'] as const) {
      context.delveRun!.rite = { phase };
      expect(classifyMapObjectMarker(object('delve_drowned_reliquary'), context)).toEqual({
        kind: 'delve-reward',
        reward: 'reliquary',
        state: 'active',
        bountiful: true,
      });
    }
    context.delveRun!.rite = { phase: 'open' };
    expect(classifyMapObjectMarker(object('delve_drowned_reliquary'), context)).toEqual({
      kind: 'delve-reward',
      reward: 'reliquary',
      state: 'opened',
      bountiful: true,
    });
  });

  it('never classifies a non-object even when its template id matches', () => {
    expect(
      classifyMapObjectMarker({ kind: 'mob', templateId: 'rift_locked_chest' }, BASE_CONTEXT),
    ).toBeNull();
    expect(classifyMapObjectMarker(object('not_a_marker'), BASE_CONTEXT)).toBeNull();
  });
});

describe('mapMarkerSemanticLayer', () => {
  it('separates reward markers from navigation markers exhaustively', () => {
    const semantics = [
      classifyMapObjectMarker(object('rift_treasure'), BASE_CONTEXT),
      classifyMapObjectMarker(object('delve_locked_chest'), BASE_CONTEXT),
      classifyMapObjectMarker(object('rift_pylon'), BASE_CONTEXT),
      classifyMapObjectMarker(object('dungeon_door'), BASE_CONTEXT),
      classifyMapObjectMarker(object('rift_descent'), BASE_CONTEXT),
      classifyMapObjectMarker(object('delve_surface_exit'), BASE_CONTEXT),
    ];
    expect(semantics.every(Boolean)).toBe(true);
    expect(semantics.map((semantic) => mapMarkerSemanticLayer(semantic!))).toEqual([
      'reward',
      'reward',
      'mechanic',
      'navigation',
      'navigation',
      'navigation',
    ]);
  });
});
