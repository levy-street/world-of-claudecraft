// Pure decisions for the NPC gossip dialog's Clue Scroll row. A click on an NPC
// opens the gossip window client-side and never reaches the sim, so an npc or
// deliver clue step (src/sim/clue_scrolls.ts onNpcTalkedForClueHunt, fired from
// Sim.talkToNpc) could not be solved by clicking the NPC it names (playtest).
// The dialog shows a "Discuss" row for the hunt, the same family as the quest
// discussion rows; that row sends the talk, and the NPC answers with the step's
// authored reply (clues.<huntId>.reply.<step>). DOM-free; the controller
// renders and wires the row.

import { clueHuntById } from '../../../sim/clue_scrolls';
import type { InvSlot } from '../../../sim/types';

/** The talk the active hunt asks of this NPC. `ready` is false for a delivery
 *  the player cannot make yet (the sim refuses it with its own error). */
export interface ClueTalk {
  huntId: string;
  step: number;
  ready: boolean;
}

/** The active hunt's talk when its current step is a talk to (or a delivery
 *  for) the NPC `npcTemplateId`, else null. */
export function clueTalkFor(
  clueHunt: Readonly<{ huntId: string; step: number }> | null,
  npcTemplateId: string,
  inventory: readonly InvSlot[],
): ClueTalk | null {
  if (!clueHunt) return null;
  const step = clueHuntById(clueHunt.huntId)?.steps[clueHunt.step];
  if (!step || (step.kind !== 'npc' && step.kind !== 'deliver')) return null;
  if (step.npcId !== npcTemplateId) return null;
  const ready =
    step.kind === 'npc' ||
    inventory.reduce((sum, slot) => (slot.itemId === step.itemId ? sum + slot.count : sum), 0) >=
      step.count;
  return { huntId: clueHunt.huntId, step: clueHunt.step, ready };
}

/** The catalog key of the NPC's answer to a solved talk or delivery step. */
export function clueReplyKey(huntId: string, step: number): string {
  return `clues.${huntId}.reply.${step}`;
}
