// The Clue Scroll row of the NPC gossip menu: a pure lookup from the world's
// mirrored hunt (IWorldQuests.clueHunt, huntId plus step index, the `cluh` self
// key online) and the hunt content to the ONE row the dialog renders when the
// active step is a talk or a hand-over at THIS NPC.
//
// Why the row exists: the sim already resolves both step kinds first thing in
// talkToNpc (clue_scrolls.ts onNpcTalkedForClueHunt, identical on every host),
// but the client only ever SENDS that interact for service NPCs (banker, forge,
// emissary, keeper, chroniclers) or through an ordinary quest's discuss row.
// A clue step at a plain quest giver (Mother Sedge and the cooking salt) had no
// row, so nothing was sent and the hand-over silently never happened. This
// module decides the row; the controller renders it and sends the interact.
import { CLUE_HUNTS_BY_ID, type ClueHuntDef } from '../../../sim/content/clue_hunts';

export type ClueStepRow =
  | { readonly kind: 'talk' }
  | { readonly kind: 'deliver'; readonly itemId: string; readonly count: number };

export type MirroredClueHunt = Readonly<{ huntId: string; step: number }> | null | undefined;

/** The row for `npcTemplateId`, or null when the active step is not a talk or
 *  hand-over at that NPC (no hunt, another NPC, a landmark, emote or dig). */
export function clueStepRowFor(
  clueHunt: MirroredClueHunt,
  npcTemplateId: string,
  hunts: Readonly<Record<string, ClueHuntDef>> = CLUE_HUNTS_BY_ID,
): ClueStepRow | null {
  if (!clueHunt) return null;
  const step = hunts[clueHunt.huntId]?.steps[clueHunt.step];
  if (!step) return null;
  if (step.kind === 'npc') return step.npcId === npcTemplateId ? { kind: 'talk' } : null;
  if (step.kind === 'deliver' && step.npcId === npcTemplateId) {
    return { kind: 'deliver', itemId: step.itemId, count: step.count };
  }
  return null;
}

/** Staleness signature for the open dialog's refreshIfChanged watch: the row
 *  depends on live hunt state (a step can advance while the dialog is open). */
export function clueStepRowSig(row: ClueStepRow | null): string {
  if (!row) return '';
  return row.kind === 'talk' ? 'talk' : `deliver:${row.itemId}:${row.count}`;
}
