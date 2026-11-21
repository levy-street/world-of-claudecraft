// The keyboard and pad targeting actions main.ts routes (the Tab cycles, the
// friendly picks, Pet: Mark, the party target hotkeys, and the raid target
// icon hotkeys), split out of
// main.ts so it stays a firewall. dispatchTargetingAction is the pad's flat
// action arm; targetingInputCallbacks is the keyboard arm (the InputCallbacks
// slice input.ts fires). Both take injected IWorld-shaped bags, never the
// concrete worlds. Tests: tests/party_target_hotkeys_core.test.ts.

import { focusTargetAction } from '../ui/focus_targets_core';
import { worldMarkerActionSymbol } from '../ui/hud/world_markers/world_markers_core';
import { type PartyFrameSettingKey, readPartyFrameDisplayConfig } from '../ui/party_frames';
import { partyHotkeyTargetId } from '../ui/party_target_hotkeys_core';
import {
  raidTargetMarking,
  targetMarkerActionSymbol,
  targetMarkerHotkeyCommand,
} from '../ui/raid_target_icons_core';
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
  | 'entities'
  | 'markerFor'
  | 'setMarker'
  | 'clearMarker'
>;

/** The one Hud call targeting needs: Pet: Mark selects the pet the frame shows. */
export interface TargetingHud {
  targetOwnPet(): void;
  focusTarget?(slot: number, assign: boolean): void;
  /** A world-marker hotkey: 0..7 places that symbol, null clears every mark. */
  worldMarkerHotkey?(symbol: number | null): void;
}

/** The party frame display settings (sort mode, Show Self) the F-row reads so
 *  its order matches the painted rows; undefined before the options attach. */
export type PartyFrameSettingsReader =
  | { get(key: PartyFrameSettingKey): number | boolean | undefined }
  | undefined;

/** Select the unit a party target hotkey slot names (0 = self, 1..9 = the party
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

/** A raid target icon hotkey on the current target: 0..7 marks it with that
 *  symbol (again on a unit that already wears it takes it off, the sim's
 *  toggle), null clears its mark. raid_target_icons_core.ts decides what is
 *  sent; the server re-checks every rule. */
export function targetMarkerHotkey(world: TargetingWorld, symbol: number | null): void {
  const targetId = world.player.targetId ?? null;
  const target = targetId === null ? null : world.entities.get(targetId);
  const command = targetMarkerHotkeyCommand(
    symbol,
    target,
    raidTargetMarking(world.partyInfo, world.playerId),
    target ? world.markerFor(target.id) : null,
  );
  if (command?.kind === 'set') world.setMarker(command.id, command.symbol);
  else if (command?.kind === 'clear') world.clearMarker(command.id);
}

/** Route a bound targeting action id (a pad button carrying a keyboard action).
 *  Returns false for an id that is not a targeting action. */
export function dispatchTargetingAction(
  id: string,
  world: TargetingWorld,
  hud: TargetingHud,
  settings: PartyFrameSettingsReader,
): boolean {
  const focus = focusTargetAction(id);
  if (focus) {
    hud.focusTarget?.(focus.slot, focus.assign);
    return true;
  }
  const marker = worldMarkerActionSymbol(id);
  if (marker !== undefined) {
    hud.worldMarkerHotkey?.(marker);
    return true;
  }
  const targetMark = targetMarkerActionSymbol(id);
  if (targetMark !== undefined) {
    targetMarkerHotkey(world, targetMark);
    return true;
  }
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
  | 'onTab'
  | 'onTabPrev'
  | 'onTargetFriendly'
  | 'onCycleFriendly'
  | 'onTargetPet'
  | 'onTargetParty'
  | 'onFocusTarget'
  | 'onWorldMarker'
  | 'onTargetMarker'
> {
  return {
    onFocusTarget: (slot, assign) => hud.focusTarget?.(slot, assign),
    onWorldMarker: (symbol) => hud.worldMarkerHotkey?.(symbol),
    onTargetMarker: (symbol) => targetMarkerHotkey(world, symbol),
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
