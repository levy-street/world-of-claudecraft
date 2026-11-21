// Raid target icons on units, HUD side: the pure marking rule the menus read
// (src/ui/raid_target_icons_core.ts, which defers to the sim's own
// src/sim/social/raid_target_marks.ts), the "Mark Target" hotkeys and their
// keybind section, and the targeting arm that turns a press into a command.

import { describe, expect, it, vi } from 'vitest';
import { BIND_ACTIONS } from '../src/game/keybinds';
import { dispatchTargetingAction, targetMarkerHotkey } from '../src/game/targeting_actions';
import { canSetRaidTargets, raidTargetMarkable } from '../src/sim/social/raid_target_marks';
import type { Entity } from '../src/sim/types';
import {
  BIND_CATEGORY_LABEL_KEYS,
  bindActionDisplayName,
} from '../src/ui/keybind_action_names_core';
import {
  offersRaidTargetIcon,
  raidTargetMarking,
  TARGET_MARKER_ACTIONS,
  TARGET_MARKER_CLEAR_ACTION,
  targetMarkerActionSymbol,
  targetMarkerHotkeyCommand,
} from '../src/ui/raid_target_icons_core';
import type { PartyInfo, PartyMemberInfo } from '../src/world_api';

const ME = 1;
const MATE = 2;
const OUTSIDER = 9;
const SQUARE = 5;
const SKULL = 7;

function member(pid: number): PartyMemberInfo {
  return { pid, name: `P${pid}`, cls: 'warrior', group: 1 } as PartyMemberInfo;
}
function info(leader: number, raid: boolean): PartyInfo {
  return { leader, raid, members: [member(ME), member(MATE)] } as unknown as PartyInfo;
}
function unit(partial: Partial<Entity>): Entity {
  return { id: 50, kind: 'mob', dead: false, ownerId: null, hostile: true, ...partial } as Entity;
}

describe('raid target marking rule (sim + HUD read one rule)', () => {
  it('needs a group; a party lets anyone mark, a raid only its leader', () => {
    expect(canSetRaidTargets(null, ME)).toBe(false);
    expect(canSetRaidTargets({ leader: MATE, raid: false }, ME)).toBe(true);
    expect(canSetRaidTargets({ leader: MATE, raid: true }, ME)).toBe(false);
    expect(canSetRaidTargets({ leader: ME, raid: true }, ME)).toBe(true);
    expect(raidTargetMarking(null, ME)).toBeNull();
    expect(raidTargetMarking(info(MATE, true), ME)?.canMark).toBe(false);
  });

  it('marks wild mobs, group players and their pets; never NPCs, corpses or outsiders', () => {
    const inGroup = (pid: number) => pid === ME || pid === MATE;
    expect(raidTargetMarkable(unit({}), inGroup)).toBe(true);
    expect(raidTargetMarkable(unit({ hostile: false }), inGroup)).toBe(true);
    expect(raidTargetMarkable(unit({ kind: 'player', id: MATE }), inGroup)).toBe(true);
    expect(raidTargetMarkable(unit({ kind: 'player', id: MATE, dead: true }), inGroup)).toBe(true);
    expect(raidTargetMarkable(unit({ ownerId: MATE }), inGroup)).toBe(true);
    expect(raidTargetMarkable(unit({ kind: 'player', id: OUTSIDER }), inGroup)).toBe(false);
    expect(raidTargetMarkable(unit({ ownerId: OUTSIDER }), inGroup)).toBe(false);
    expect(raidTargetMarkable(unit({ dead: true }), inGroup)).toBe(false);
    expect(raidTargetMarkable(unit({ kind: 'npc' }), inGroup)).toBe(false);
    expect(raidTargetMarkable(unit({ kind: 'object' }), inGroup)).toBe(false);
  });

  it('offers the rows only with marking rights', () => {
    const ally = unit({ kind: 'player', id: MATE });
    expect(offersRaidTargetIcon(ally, raidTargetMarking(info(MATE, false), ME))).toBe(true);
    expect(offersRaidTargetIcon(ally, raidTargetMarking(info(MATE, true), ME))).toBe(false);
    expect(offersRaidTargetIcon(ally, raidTargetMarking(info(ME, true), ME))).toBe(true);
    expect(offersRaidTargetIcon(ally, null)).toBe(false);
  });
});

describe('Mark Target hotkeys', () => {
  it('name eight set actions and one clear, unbound, in their own localized section', () => {
    expect(TARGET_MARKER_ACTIONS).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((n) => `targetMarker${n}`));
    expect(targetMarkerActionSymbol('targetMarker1')).toBe(0);
    expect(targetMarkerActionSymbol('targetMarker8')).toBe(SKULL);
    expect(targetMarkerActionSymbol(TARGET_MARKER_CLEAR_ACTION)).toBeNull();
    expect(targetMarkerActionSymbol('targetMarker9')).toBeUndefined();
    expect(targetMarkerActionSymbol('worldMarker1')).toBeUndefined();
    for (const id of [...TARGET_MARKER_ACTIONS, TARGET_MARKER_CLEAR_ACTION]) {
      const row = BIND_ACTIONS.find((a) => a.id === id);
      expect(row?.defaults, id).toEqual([]);
      expect(row?.kind).toBe('edge');
      expect(row?.category).toBe('Raid Target Icons');
    }
    expect(BIND_CATEGORY_LABEL_KEYS['Raid Target Icons']).toBe(
      'hudChrome.raidTargets.bindCategory',
    );
    expect(bindActionDisplayName('targetMarker8', undefined, () => null)).toBe(
      'Mark Target: Skull',
    );
    expect(bindActionDisplayName('targetMarker1', undefined, () => null)).toBe('Mark Target: Star');
    expect(bindActionDisplayName('targetMarkerClear', undefined, () => null)).toBe(
      'Clear Target Marker',
    );
  });

  it('turns a press into set / clear / nothing', () => {
    const party = raidTargetMarking(info(MATE, false), ME);
    const ally = unit({ kind: 'player', id: MATE });
    expect(targetMarkerHotkeyCommand(SQUARE, ally, party, null)).toEqual({
      kind: 'set',
      id: MATE,
      symbol: SQUARE,
    });
    // the same symbol again is still a set: the sim toggles it off
    expect(targetMarkerHotkeyCommand(SQUARE, ally, party, SQUARE)?.kind).toBe('set');
    expect(targetMarkerHotkeyCommand(null, ally, party, SQUARE)).toEqual({
      kind: 'clear',
      id: MATE,
    });
    expect(targetMarkerHotkeyCommand(null, ally, party, null)).toBeNull();
    expect(targetMarkerHotkeyCommand(SKULL, null, party, null)).toBeNull();
    expect(targetMarkerHotkeyCommand(SKULL, unit({ kind: 'npc' }), party, null)).toBeNull();
    // without rights the press still reaches the sim, whose refusal explains why
    const raidMember = raidTargetMarking(info(MATE, true), ME);
    expect(targetMarkerHotkeyCommand(SKULL, unit({}), raidMember, null)?.kind).toBe('set');
    expect(targetMarkerHotkeyCommand(SKULL, unit({}), null, null)?.kind).toBe('set');
  });

  it('the keyboard and pad arms send the command for the current target', () => {
    const target = unit({ kind: 'player', id: MATE });
    const world = {
      tabTarget: vi.fn(),
      tabTargetPrev: vi.fn(),
      targetNearestFriendly: vi.fn(),
      friendlyTabTarget: vi.fn(),
      targetEntity: vi.fn(),
      partyInfo: info(MATE, false),
      playerId: ME,
      player: { pos: { x: 0, z: 0 }, targetId: MATE } as never,
      entities: new Map([[MATE, target]]),
      markerFor: vi.fn(() => SQUARE),
      setMarker: vi.fn(),
      clearMarker: vi.fn(),
    };
    expect(dispatchTargetingAction('targetMarker6', world, { targetOwnPet() {} }, undefined)).toBe(
      true,
    );
    expect(world.setMarker).toHaveBeenCalledWith(MATE, SQUARE);
    targetMarkerHotkey(world, null);
    expect(world.clearMarker).toHaveBeenCalledWith(MATE);
  });
});
