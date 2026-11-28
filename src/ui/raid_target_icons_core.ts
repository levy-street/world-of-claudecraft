// Raid target icons in the HUD, as pure decisions: whether this player may set
// them right now, which units the menu and the hotkeys offer them on, what a
// "Mark Target" hotkey press does, and the keybind action ids.
//
// Every rule is the sim's own (src/sim/social/raid_target_marks.ts), read over
// the IWorld party mirror, so the menu never offers a row the server would
// refuse: a group is required, a raid lets only its leader mark, and the
// markable units are live wild mobs, group players and their pets/buddies.
// The server re-checks every command; this only keeps the HUD honest.
//
// DOM-free and deterministic (UI_PURE_CORES in tests/architecture.test.ts).

import {
  canSetRaidTargets,
  RAID_TARGET_SYMBOL_COUNT,
  raidTargetMarkable,
} from '../sim/social/raid_target_marks';
import type { Entity } from '../sim/types';
import type { IWorld, PartyInfo } from '../world_api';

/** What the HUD knows about the viewer's marking rights for one decision. */
export interface RaidTargetMarking {
  /** The viewer may set and clear marks (in a group; a raid's leader). */
  readonly canMark: boolean;
  /** Group membership by pid (the viewer included). */
  inGroup(pid: number): boolean;
}

/** The viewer's marking context, or null outside a group. */
export function raidTargetMarking(
  info: Pick<PartyInfo, 'leader' | 'raid' | 'members'> | null,
  playerId: number,
): RaidTargetMarking | null {
  if (!info) return null;
  const members = info.members;
  return {
    canMark: canSetRaidTargets(info, playerId),
    inGroup: (pid) => members.some((m) => m.pid === pid),
  };
}

/** The unit fields the marking rule reads. */
export type RaidTargetUnit = Pick<Entity, 'id' | 'kind' | 'dead' | 'ownerId'>;

/** A player menu's unit by pid: the mirrored entity when there is one, else a
 *  bare player record, because ClientWorld mirrors only the ~120 yd interest
 *  bubble and a far group member (opened from the party frames) has no entity
 *  there while the server still accepts the mark. */
export function raidTargetPlayerUnit(
  pid: number,
  entity: RaidTargetUnit | undefined,
): RaidTargetUnit {
  return entity ?? { id: pid, kind: 'player', dead: false, ownerId: null };
}

/** Does the HUD offer the raid target icon rows (menu, hotkeys) on `target`? */
export function offersRaidTargetIcon(
  target: Pick<Entity, 'id' | 'kind' | 'dead' | 'ownerId'>,
  marking: RaidTargetMarking | null,
): boolean {
  return !!marking?.canMark && raidTargetMarkable(target, (pid) => marking.inGroup(pid));
}

/** offersRaidTargetIcon for the viewer of `world` (a missing unit: no). */
export function offersRaidTargetIconIn(
  world: Pick<IWorld, 'partyInfo' | 'playerId'>,
  target: RaidTargetUnit | undefined,
): boolean {
  return (
    !!target && offersRaidTargetIcon(target, raidTargetMarking(world.partyInfo, world.playerId))
  );
}

/** The keybind action ids: "Mark Target: <symbol>" for each of the eight
 *  symbols, then "Clear Target Marker". Unbound by default, as the classic
 *  client ships them. */
export const TARGET_MARKER_ACTIONS: readonly string[] = Array.from(
  { length: RAID_TARGET_SYMBOL_COUNT },
  (_, s) => `targetMarker${s + 1}`,
);
export const TARGET_MARKER_CLEAR_ACTION = 'targetMarkerClear';

/** The symbol a target-marker action names: 0..7 sets it, null clears, and
 *  undefined is not a target-marker action. */
export function targetMarkerActionSymbol(actionId: string): number | null | undefined {
  if (actionId === TARGET_MARKER_CLEAR_ACTION) return null;
  const m = /^targetMarker([1-8])$/.exec(actionId);
  return m ? Number(m[1]) - 1 : undefined;
}

/** What a target-marker hotkey press sends: set a symbol (the sim toggles it
 *  off when the target already wears it, as the classic client does), clear
 *  the target's mark, or nothing (no target, a unit that cannot carry a mark,
 *  or a clear on a target that has no mark). A press WITHOUT the right to mark
 *  (no group, a raid member who is not the leader) is still sent, so the
 *  sim's own localized refusal tells the player why nothing happened. */
export type TargetMarkerCommand =
  | { kind: 'set'; id: number; symbol: number }
  | { kind: 'clear'; id: number }
  | null;

export function targetMarkerHotkeyCommand(
  symbol: number | null,
  target: Pick<Entity, 'id' | 'kind' | 'dead' | 'ownerId'> | null | undefined,
  marking: RaidTargetMarking | null,
  currentMark: number | null,
): TargetMarkerCommand {
  if (!target) return null;
  if (marking?.canMark && !offersRaidTargetIcon(target, marking)) return null;
  if (symbol === null) return currentMark === null ? null : { kind: 'clear', id: target.id };
  return { kind: 'set', id: target.id, symbol };
}
