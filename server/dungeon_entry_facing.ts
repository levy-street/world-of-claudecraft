// Server-side fence for client heading packets already in flight when a
// dungeon entry resets the authoritative facing. Movement continues while the
// client waits to acknowledge the exact entry generation from its snapshot.

import { dungeonAt } from '../src/sim/data';
import type { MoveInputFrame } from '../src/sim/move_input';
import type { Entity, MoveInput } from '../src/sim/types';
import {
  DUNGEON_ENTRY_FACING_WIRE_VERSION,
  type DungeonEntryFacingWireVersion,
} from '../src/world_api';

export interface DungeonEntryFacingFence {
  enabled: boolean;
  entrySeq: number;
  requiredEntrySeq: number | null;
  requiredFacing: number | null;
}

export interface DungeonEntryFacingDecision {
  state: DungeonEntryFacingFence;
  facing: number | null;
  blockTurn: boolean;
}

export interface DungeonEntryInputDecision extends DungeonEntryFacingDecision {
  moveInput: MoveInput;
}

export type WireVersion = 0 | DungeonEntryFacingWireVersion;

export function createDungeonEntryFacingFence(
  entrySeq: number,
  enabled = true,
): DungeonEntryFacingFence {
  return { enabled, entrySeq, requiredEntrySeq: null, requiredFacing: null };
}

export function forEntity(
  entity: Entity | undefined,
  version: WireVersion | undefined,
): DungeonEntryFacingFence {
  return createDungeonEntryFacingFence(
    entity?.dungeonEntrySeq ?? 0,
    version === DUNGEON_ENTRY_FACING_WIRE_VERSION,
  );
}

export function forResume(
  current: DungeonEntryFacingFence,
  entity: Entity,
  version: WireVersion | undefined,
): DungeonEntryFacingFence {
  const enabled = version === DUNGEON_ENTRY_FACING_WIRE_VERSION;
  return enabled && current.enabled ? { ...current } : forEntity(entity, version);
}

export function filterDungeonEntryFacing(
  current: DungeonEntryFacingFence,
  insideDungeon: boolean,
  entrySeq: number,
  authoritativeFacing: number,
  inputFacing: number | null,
  inputEntryAck: number | null,
): DungeonEntryFacingDecision {
  if (!current.enabled) {
    return {
      state: createDungeonEntryFacingFence(entrySeq, false),
      facing: inputFacing,
      blockTurn: false,
    };
  }
  const enteredDungeon = insideDungeon && entrySeq !== current.entrySeq;
  const requiredEntrySeq = enteredDungeon
    ? entrySeq
    : insideDungeon
      ? current.requiredEntrySeq
      : null;
  const requiredFacing = enteredDungeon
    ? authoritativeFacing
    : insideDungeon
      ? current.requiredFacing
      : null;
  if (requiredEntrySeq === null || requiredFacing === null) {
    return {
      state: { ...current, entrySeq, requiredEntrySeq: null, requiredFacing: null },
      facing: inputFacing,
      blockTurn: false,
    };
  }
  // The exact generation proves the client observed the authoritative landing.
  // Accept it independently of the current camera heading so a dropped forced
  // packet cannot leave the fence armed after the player starts turning.
  const acknowledged = inputEntryAck === requiredEntrySeq;
  return {
    state: {
      ...current,
      entrySeq,
      requiredEntrySeq: acknowledged ? null : requiredEntrySeq,
      requiredFacing: acknowledged ? null : requiredFacing,
    },
    facing: acknowledged ? requiredFacing : null,
    // The acknowledgement packet was built before main.ts cleared turn state.
    blockTurn: true,
  };
}

function moveInputAfterDungeonEntryFence(input: MoveInput, blockTurn: boolean): MoveInput {
  return blockTurn ? { ...input, turnLeft: false, turnRight: false } : input;
}

function parseDungeonEntryFacingAck(raw: unknown): number | null {
  return Number.isSafeInteger(raw) && (raw as number) >= 0 ? (raw as number) : null;
}

export function decideDungeonEntryInput(
  current: DungeonEntryFacingFence,
  entity: Entity,
  frame: MoveInputFrame,
  rawEntryAck: unknown,
): DungeonEntryInputDecision {
  const decision = filterDungeonEntryFacing(
    current,
    dungeonAt(entity.pos.x) !== null,
    entity.dungeonEntrySeq ?? 0,
    entity.facing,
    frame.facing,
    parseDungeonEntryFacingAck(rawEntryAck),
  );
  return {
    ...decision,
    moveInput: moveInputAfterDungeonEntryFence(frame.moveInput, decision.blockTurn),
  };
}
