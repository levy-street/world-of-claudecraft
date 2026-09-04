import type { Sim } from '../src/sim/sim';

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

/** Route the world-quest-only command family outside the server monolith. */
export function dispatchWorldQuestWire(sim: Sim, msg: QuestWireMessage, pid: number): void {
  switch (msg.cmd) {
    case 'world_quest_puzzle_rotate':
      rotateWorldQuestPuzzleWire(sim, msg, pid);
      break;
    case 'world_quest_match3_swap':
      swapWorldQuestMatch3Wire(sim, msg, pid);
      break;
    case 'world_quest_match3_reset':
      resetWorldQuestMatch3Wire(sim, msg, pid);
  }
}
