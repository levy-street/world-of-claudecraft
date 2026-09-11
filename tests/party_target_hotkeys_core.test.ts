// The party target hotkeys (F1..F10 by default): F1 is always yourself, F2..F10
// follow the party frame rows top to bottom (src/ui/party_target_hotkeys_core.ts),
// and the keyboard + pad arms in src/game/targeting_actions.ts route the bound
// action ids to IWorld.targetEntity.
import { describe, expect, it, vi } from 'vitest';
import { PARTY_TARGET_HOTKEY_SLOTS, partyTargetActionSlot } from '../src/game/keybinds';
import {
  dispatchTargetingAction,
  targetingInputCallbacks,
  targetPartyHotkey,
} from '../src/game/targeting_actions';
import { DEFAULT_PARTY_FRAME_DISPLAY } from '../src/ui/party_frames';
import { partyHotkeyTargetId } from '../src/ui/party_target_hotkeys_core';
import type { PartyInfo, PartyMemberInfo } from '../src/world_api';

const ME = 1;
const AT = { x: 0, z: 0 };

const member = (pid: number, extra: Partial<PartyMemberInfo> = {}): PartyMemberInfo => ({
  pid,
  name: `Member${pid}`,
  cls: 'priest',
  level: 20,
  hp: 100,
  mhp: 100,
  res: 100,
  mres: 100,
  rtype: 'mana',
  x: 0,
  z: 0,
  dead: 0,
  inCombat: 0,
  group: 1,
  ...extra,
});

const party = (members: PartyMemberInfo[], raid = false): PartyInfo => ({
  leader: ME,
  raid,
  master: { enabled: false, looter: ME, threshold: 'rare' },
  members,
});

const settingsWith = (sort: number, showSelf = false) => ({
  get: (key: string) =>
    key === 'partyFrameSort' ? sort : key === 'partyFrameShowSelf' ? showSelf : undefined,
});

describe('partyTargetActionSlot', () => {
  it('names slot 0 for Target Self and 1..9 for the party member rows', () => {
    expect(partyTargetActionSlot('targetSelf')).toBe(0);
    expect(partyTargetActionSlot('targetParty1')).toBe(1);
    expect(partyTargetActionSlot('targetParty9')).toBe(9);
    expect(PARTY_TARGET_HOTKEY_SLOTS).toBe(9);
  });

  it('is null for every other action id, including out-of-row party numbers', () => {
    expect(partyTargetActionSlot('targetParty10')).toBeNull();
    expect(partyTargetActionSlot('targetParty0')).toBeNull();
    expect(partyTargetActionSlot('targetFriendly')).toBeNull();
    expect(partyTargetActionSlot('slot1')).toBeNull();
  });
});

describe('partyHotkeyTargetId', () => {
  it('always resolves slot 0 to the player, party or not', () => {
    expect(partyHotkeyTargetId(0, null, ME, AT)).toBe(ME);
    expect(partyHotkeyTargetId(0, party([member(ME), member(7)]), ME, AT)).toBe(ME);
  });

  it('walks the party frame rows top to bottom with the player row skipped', () => {
    // The server's member order puts the player in the middle: the F-row must
    // not hand a key to the player's own row (F1 already owns it).
    const info = party([member(4), member(ME), member(9), member(2), member(6)]);
    expect(partyHotkeyTargetId(1, info, ME, AT)).toBe(4);
    expect(partyHotkeyTargetId(2, info, ME, AT)).toBe(9);
    expect(partyHotkeyTargetId(3, info, ME, AT)).toBe(2);
    expect(partyHotkeyTargetId(4, info, ME, AT)).toBe(6);
  });

  it('skips the player row even when the Show Self option paints it', () => {
    const info = party([member(ME), member(4), member(9)]);
    const showSelf = { ...DEFAULT_PARTY_FRAME_DISPLAY, showSelf: true };
    expect(partyHotkeyTargetId(1, info, ME, AT, showSelf)).toBe(4);
    expect(partyHotkeyTargetId(2, info, ME, AT, showSelf)).toBe(9);
  });

  it('follows the persisted sort mode, so the key matches the painted row', () => {
    const info = party([
      member(ME),
      member(4, { name: 'Zed', role: 'dps' }),
      member(9, { name: 'Amy', role: 'healer' }),
      member(2, { name: 'Bob', role: 'tank' }),
    ]);
    // Role order (sort 1): tank, healer, dps.
    const byRole = { ...DEFAULT_PARTY_FRAME_DISPLAY, sort: 1 as const };
    expect([1, 2, 3].map((s) => partyHotkeyTargetId(s, info, ME, AT, byRole))).toEqual([2, 9, 4]);
    // Name order (sort 2).
    const byName = { ...DEFAULT_PARTY_FRAME_DISPLAY, sort: 2 as const };
    expect([1, 2, 3].map((s) => partyHotkeyTargetId(s, info, ME, AT, byName))).toEqual([9, 2, 4]);
  });

  it('reaches the ninth ally on the last key of a full raid', () => {
    const allies = [2, 3, 4, 5, 6, 7, 8, 9, 10].map((pid) => member(pid));
    const info = party([member(ME), ...allies], true);
    expect(partyHotkeyTargetId(9, info, ME, AT)).toBe(10);
    expect(partyHotkeyTargetId(1, info, ME, AT)).toBe(2);
  });

  it('orders a raid by group first, like the raid frames', () => {
    const info = party(
      [member(ME), member(4, { group: 2 }), member(9, { group: 1 }), member(2, { group: 2 })],
      true,
    );
    expect([1, 2, 3].map((s) => partyHotkeyTargetId(s, info, ME, AT))).toEqual([9, 4, 2]);
  });

  it('is null for an empty slot: no party, fewer allies than the key, or a bad slot', () => {
    expect(partyHotkeyTargetId(1, null, ME, AT)).toBeNull();
    const info = party([member(ME), member(4)]);
    expect(partyHotkeyTargetId(1, info, ME, AT)).toBe(4);
    expect(partyHotkeyTargetId(2, info, ME, AT)).toBeNull();
    expect(partyHotkeyTargetId(10, info, ME, AT)).toBeNull();
    expect(partyHotkeyTargetId(-1, info, ME, AT)).toBeNull();
    expect(partyHotkeyTargetId(1.5, info, ME, AT)).toBeNull();
  });

  it('still names an out-of-range or dead ally (the row stays on the frames)', () => {
    const info = party([member(ME), member(4, { x: 500, z: 500 }), member(9, { dead: 1 })]);
    expect(partyHotkeyTargetId(1, info, ME, AT)).toBe(4);
    expect(partyHotkeyTargetId(2, info, ME, AT)).toBe(9);
  });
});

function fakeWorld(info: PartyInfo | null) {
  return {
    tabTarget: vi.fn(),
    tabTargetPrev: vi.fn(),
    targetNearestFriendly: vi.fn(),
    friendlyTabTarget: vi.fn(),
    targetEntity: vi.fn(),
    partyInfo: info,
    playerId: ME,
    player: { pos: { x: 0, z: 0 } } as never,
  };
}

describe('targetPartyHotkey', () => {
  it('targets the resolved unit and leaves the current target alone for an empty slot', () => {
    const world = fakeWorld(party([member(ME), member(4)]));
    expect(targetPartyHotkey(world, undefined, 0)).toBe(true);
    expect(world.targetEntity).toHaveBeenLastCalledWith(ME);
    expect(targetPartyHotkey(world, undefined, 1)).toBe(true);
    expect(world.targetEntity).toHaveBeenLastCalledWith(4);
    expect(targetPartyHotkey(world, undefined, 2)).toBe(false);
    expect(world.targetEntity).toHaveBeenCalledTimes(2);
  });

  it('reads the party frame sort setting so the key follows the painted order', () => {
    const world = fakeWorld(
      party([member(ME), member(4, { name: 'Zed' }), member(9, { name: 'Amy' })]),
    );
    targetPartyHotkey(world, settingsWith(2), 1);
    expect(world.targetEntity).toHaveBeenLastCalledWith(9);
    targetPartyHotkey(world, settingsWith(0), 1);
    expect(world.targetEntity).toHaveBeenLastCalledWith(4);
  });
});

describe('dispatchTargetingAction (the pad arm)', () => {
  it('routes every targeting action id and reports the rest as not its own', () => {
    const world = fakeWorld(party([member(ME), member(4)]));
    const hud = { targetOwnPet: vi.fn() };
    expect(dispatchTargetingAction('target', world, hud, undefined)).toBe(true);
    expect(world.tabTarget).toHaveBeenCalledTimes(1);
    expect(dispatchTargetingAction('targetPrev', world, hud, undefined)).toBe(true);
    expect(world.tabTargetPrev).toHaveBeenCalledTimes(1);
    expect(dispatchTargetingAction('targetFriendly', world, hud, undefined)).toBe(true);
    expect(world.targetNearestFriendly).toHaveBeenCalledTimes(1);
    expect(dispatchTargetingAction('targetFriendlyNext', world, hud, undefined)).toBe(true);
    expect(world.friendlyTabTarget).toHaveBeenCalledTimes(1);
    expect(dispatchTargetingAction('targetPet', world, hud, undefined)).toBe(true);
    expect(hud.targetOwnPet).toHaveBeenCalledTimes(1);
    expect(dispatchTargetingAction('targetSelf', world, hud, undefined)).toBe(true);
    expect(world.targetEntity).toHaveBeenLastCalledWith(ME);
    expect(dispatchTargetingAction('targetParty1', world, hud, undefined)).toBe(true);
    expect(world.targetEntity).toHaveBeenLastCalledWith(4);
    // An empty slot is still a targeting action (consumed, nothing retargeted).
    expect(dispatchTargetingAction('targetParty3', world, hud, undefined)).toBe(true);
    expect(world.targetEntity).toHaveBeenCalledTimes(2);
    expect(dispatchTargetingAction('bags', world, hud, undefined)).toBe(false);
    expect(dispatchTargetingAction('slot3', world, hud, undefined)).toBe(false);
  });
});

describe('targetingInputCallbacks (the keyboard arm)', () => {
  it('drives the same world calls as the pad arm', () => {
    const world = fakeWorld(party([member(ME), member(4), member(9)]));
    const hud = { targetOwnPet: vi.fn() };
    const cb = targetingInputCallbacks(world, hud, undefined);
    cb.onTab();
    cb.onTabPrev();
    cb.onTargetFriendly();
    cb.onCycleFriendly();
    cb.onTargetPet();
    expect(world.tabTarget).toHaveBeenCalledTimes(1);
    expect(world.tabTargetPrev).toHaveBeenCalledTimes(1);
    expect(world.targetNearestFriendly).toHaveBeenCalledTimes(1);
    expect(world.friendlyTabTarget).toHaveBeenCalledTimes(1);
    expect(hud.targetOwnPet).toHaveBeenCalledTimes(1);
    cb.onTargetParty(0);
    expect(world.targetEntity).toHaveBeenLastCalledWith(ME);
    cb.onTargetParty(2);
    expect(world.targetEntity).toHaveBeenLastCalledWith(9);
    cb.onTargetParty(4);
    expect(world.targetEntity).toHaveBeenCalledTimes(2);
  });
});
