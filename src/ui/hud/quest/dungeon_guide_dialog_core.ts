// Pure decisions for a dungeon lore guide's gossip dialog (src/sim/dungeon_guide):
// which line greets the player and whether the two answer rows ("Come with
// us" / "We go alone") show. Read off the guide's mirrored `guideState`, so the
// offline and online dialogs agree. DOM-free; the quest dialog controller
// renders and wires it.

import { dungeonGuideForNpc, dungeonGuideKey } from '../../../sim/content/dungeon_guides';
import type { DungeonGuideState, Entity } from '../../../sim/types';

export interface GuideDialogView {
  /** Catalog key of the greeting line. */
  textKey: string;
  /** The answer rows show while the offer stands (refused or not yet answered). */
  rows: null | { joinKey: string; declineKey: string };
  /** The state the view was built from (the controller's staleness signature). */
  state: DungeonGuideState;
}

/** The dialog of `npc` if it plays a dungeon guide, else null. A state not yet
 *  mirrored reads as the open offer (the guide's first tick sets it). */
export function guideDialogView(
  npc: Pick<Entity, 'id' | 'templateId' | 'guideState'>,
): GuideDialogView | null {
  const guide = dungeonGuideForNpc(npc.templateId);
  if (!guide) return null;
  const state = npc.guideState ?? 'open';
  const key = (k: string) => dungeonGuideKey(guide, k);
  if (state === 'singing') return { textKey: key(guide.dialog.singing), rows: null, state };
  if (state === 'joined') return { textKey: key(guide.dialog.joined), rows: null, state };
  // The greeting variant follows the guide's entity id: one per run, the same
  // on every host and every member's screen.
  const greet = guide.dialog.greet[Math.abs(npc.id) % guide.dialog.greet.length];
  const open = state === 'open' || state === 'declined';
  return {
    textKey: key(greet),
    rows: open
      ? { joinKey: key(guide.dialog.rowJoin), declineKey: key(guide.dialog.rowDecline) }
      : null,
    state,
  };
}
