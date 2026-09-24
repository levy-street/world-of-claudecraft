import type { Sim } from '../src/sim/sim';
import { isWorldQuestDifficulty } from '../src/sim/world_quest_activity';

type QuestWireMessage = Record<string, unknown>;

export function acceptQuestWire(sim: Sim, msg: QuestWireMessage, pid: number): boolean {
  if (typeof msg.quest !== 'string') return false;
  sim.acceptQuest(msg.quest, typeof msg.selection === 'string' ? msg.selection : undefined, pid);
  return true;
}

export function abandonQuestWire(sim: Sim, msg: QuestWireMessage, pid: number): boolean {
  if (typeof msg.quest !== 'string') return false;
  sim.abandonQuest(msg.quest, pid);
  return true;
}

export function acceptLinkedQuestWire(sim: Sim, msg: QuestWireMessage, pid: number): boolean {
  if (typeof msg.quest !== 'string' || typeof msg.from !== 'number') return false;
  sim.acceptLinkedQuest(msg.quest, msg.from, pid);
  return true;
}

export function rotateWorldQuestPuzzleWire(sim: Sim, msg: QuestWireMessage, pid: number): void {
  if (typeof msg.quest === 'string' && Number.isSafeInteger(msg.tileIndex)) {
    sim.rotateWorldQuestPuzzleTile(msg.quest, Number(msg.tileIndex), pid);
  }
}

export function swapWorldQuestMatch3Wire(sim: Sim, msg: QuestWireMessage, pid: number): void {
  if (
    typeof msg.quest === 'string' &&
    Number.isSafeInteger(msg.fromIndex) &&
    Number.isSafeInteger(msg.toIndex)
  ) {
    sim.swapWorldQuestMatch3Tiles(msg.quest, Number(msg.fromIndex), Number(msg.toIndex), pid);
  }
}

export function resetWorldQuestMatch3Wire(sim: Sim, msg: QuestWireMessage, pid: number): void {
  if (typeof msg.quest === 'string') sim.resetWorldQuestMatch3(msg.quest, pid);
}

export function resetWorldQuestPuzzleWire(sim: Sim, msg: QuestWireMessage, pid: number): void {
  if (typeof msg.quest === 'string') sim.resetWorldQuestPuzzle(msg.quest, pid);
}

export function accuseWorldQuestSuspectWire(sim: Sim, msg: QuestWireMessage, pid: number): void {
  if (typeof msg.npcId === 'number' && Number.isSafeInteger(msg.npcId) && msg.npcId > 0)
    sim.accuseWorldQuestSuspect(msg.npcId, pid);
}

export function shadowWorldQuestWire(sim: Sim, msg: QuestWireMessage, pid: number): void {
  if (msg.action !== 'pickpocket' && msg.action !== 'leave') return;
  if (
    msg.targetId !== undefined &&
    (typeof msg.targetId !== 'number' || !Number.isSafeInteger(msg.targetId) || msg.targetId <= 0)
  )
    return;
  if (msg.action === 'pickpocket' && msg.targetId === undefined) return;
  sim.shadowWorldQuestAction(msg.action, msg.targetId as number | undefined, pid);
}

export function startWorldQuestActivityWire(sim: Sim, msg: QuestWireMessage, pid: number): void {
  if (typeof msg.quest !== 'string' || !isWorldQuestDifficulty(msg.difficulty)) return;
  sim.startWorldQuestActivity(msg.quest, msg.difficulty, pid);
}

/** The world-quest-only command family; game.ts routes every member here. */
const WORLD_QUEST_WIRE_COMMANDS = [
  'world_quest_glider_boost',
  'world_quest_puzzle_rotate',
  'world_quest_match3_swap',
  'world_quest_match3_reset',
  'world_quest_puzzle_reset',
  'world_quest_shadow',
  'world_quest_accuse',
  'world_quest_start',
  'world_quest_reroll',
  'clue_hunt_abandon',
] as const;
export type WorldQuestWireCommand = (typeof WORLD_QUEST_WIRE_COMMANDS)[number];
const WORLD_QUEST_WIRE_COMMAND_SET: ReadonlySet<unknown> = new Set(WORLD_QUEST_WIRE_COMMANDS);

/** Type predicate so the server's exhaustive command switch narrows past the family. */
export function isWorldQuestWireCommand(cmd: unknown): cmd is WorldQuestWireCommand {
  return WORLD_QUEST_WIRE_COMMAND_SET.has(cmd);
}

/** Route the world-quest-only command family outside the server monolith. */
export function dispatchWorldQuestWire(sim: Sim, msg: QuestWireMessage, pid: number): void {
  switch (msg.cmd) {
    case 'world_quest_start':
      startWorldQuestActivityWire(sim, msg, pid);
      break;
    case 'world_quest_reroll':
      sim.rerollWorldQuest(String((msg as unknown as { quest?: unknown }).quest ?? ''), pid);
      break;
    case 'world_quest_glider_boost':
      sim.boostWorldQuestGlider(pid);
      break;
    case 'world_quest_puzzle_rotate':
      rotateWorldQuestPuzzleWire(sim, msg, pid);
      break;
    case 'world_quest_match3_swap':
      swapWorldQuestMatch3Wire(sim, msg, pid);
      break;
    case 'world_quest_match3_reset':
      resetWorldQuestMatch3Wire(sim, msg, pid);
      break;
    case 'world_quest_puzzle_reset':
      resetWorldQuestPuzzleWire(sim, msg, pid);
      break;
    case 'world_quest_shadow':
      shadowWorldQuestWire(sim, msg, pid);
      break;
    case 'world_quest_accuse':
      accuseWorldQuestSuspectWire(sim, msg, pid);
      break;
    case 'clue_hunt_abandon':
      sim.abandonClueHunt(pid);
  }
}
