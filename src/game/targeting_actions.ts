// The keyboard and pad targeting actions main.ts routes (the Tab cycles, the
// friendly picks, Pet: Mark, and the party target hotkeys), split out of
// main.ts so it stays a firewall. dispatchTargetingAction is the pad's flat
// action arm; targetingInputCallbacks is the keyboard arm (the InputCallbacks
// slice input.ts fires). Both take injected IWorld-shaped bags, never the
// concrete worlds. Tests: tests/party_target_hotkeys_core.test.ts.

import { type PartyFrameSettingKey, readPartyFrameDisplayConfig } from '../ui/party_frames';
import { partyHotkeyTargetId } from '../ui/party_target_hotkeys_core';
import type { IWorld } from '../world_api';
import type { InputCallbacks } from './input';
import { partyTargetActionSlot } from './keybinds';

export type TargetingWorld = Pick<
  IWorld,
  | 'tabTarget'
  | 'tabTargetPrev'
  | 'targetNearestFriendly'
  | 'friendlyTabTarget'
  | 'targetEntity'
  | 'partyInfo'
  | 'playerId'
  | 'player'
>;

/** The one Hud call targeting needs: Pet: Mark selects the pet the frame shows. */
export interface TargetingHud {
  targetOwnPet(): void;
}

/** The party frame display settings (sort mode, Show Self) the F-row reads so
 *  its order matches the painted rows; undefined before the options attach. */
export type PartyFrameSettingsReader =
  | { get(key: PartyFrameSettingKey): number | boolean | undefined }
  | undefined;

/** Select the unit a party target hotkey slot names (0 = self, 1..4 = the party
 *  frame rows). Returns false when the slot is empty, so nothing is retargeted
 *  and the current target stays. */
export function targetPartyHotkey(
  world: TargetingWorld,
  settings: PartyFrameSettingsReader,
  slot: number,
): boolean {
  const id = partyHotkeyTargetId(
    slot,
    world.partyInfo,
    world.playerId,
    world.player.pos,
    readPartyFrameDisplayConfig(settings),
  );
  if (id === null) return false;
  world.targetEntity(id);
  return true;
}

/** Route a bound targeting action id (a pad button carrying a keyboard action).
 *  Returns false for an id that is not a targeting action. */
export function dispatchTargetingAction(
  id: string,
  world: TargetingWorld,
  hud: TargetingHud,
  settings: PartyFrameSettingsReader,
): boolean {
  switch (id) {
    case 'target':
      world.tabTarget();
      return true;
    case 'targetPrev':
      world.tabTargetPrev();
      return true;
    case 'targetFriendly':
      world.targetNearestFriendly();
      return true;
    case 'targetFriendlyNext':
      world.friendlyTabTarget();
      return true;
    case 'targetPet':
      hud.targetOwnPet();
      return true;
  }
  const slot = partyTargetActionSlot(id);
  if (slot === null) return false;
  targetPartyHotkey(world, settings, slot);
  return true;
}

/** The targeting slice of the keyboard InputCallbacks, one implementation with
 *  the pad arm above. */
export function targetingInputCallbacks(
  world: TargetingWorld,
  hud: TargetingHud,
  settings: PartyFrameSettingsReader,
): Pick<
  InputCallbacks,
  'onTab' | 'onTabPrev' | 'onTargetFriendly' | 'onCycleFriendly' | 'onTargetPet' | 'onTargetParty'
> {
  return {
    onTab: () => world.tabTarget(),
    onTabPrev: () => world.tabTargetPrev(),
    onTargetFriendly: () => world.targetNearestFriendly(),
    onCycleFriendly: () => world.friendlyTabTarget(),
    onTargetPet: () => hud.targetOwnPet(),
    onTargetParty: (slot) => {
      targetPartyHotkey(world, settings, slot);
    },
  };
}
