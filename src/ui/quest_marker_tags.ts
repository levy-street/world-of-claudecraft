// The map tooltip's status tag for one quest-giver glyph row (phase 23):
// which parenthesized tag a hovered quest renders beside its title, keyed by
// the shared QuestMarkerKind. A pure mapping module so the Hud method that
// paints the tooltip stays a thin consumer and the kind-to-key table is
// Node-testable (the tag spans were untestable while inlined in hud.ts).

import type { MapQuestMarkerKind } from '../sim/quest_targets';

export interface QuestMarkerTooltipTag {
  /** The span's CSS class (the quest status color family in hud.css). */
  cls: 'quest-complete' | 'quest-repeat' | 'quest-cooldown';
  /** The questUi.log status key the tag renders through t(). */
  key: 'questUi.log.readyStatus' | 'questUi.log.repeatableStatus' | 'questUi.log.cooldownStatus';
}

/** The tag for a tooltip row, or null for the plain available offer (which
 *  has always rendered untagged). Exhaustive over MapQuestMarkerKind: adding
 *  a map-drawn kind without deciding its tag is a compile error. */
export function questMarkerTooltipTag(kind: MapQuestMarkerKind): QuestMarkerTooltipTag | null {
  switch (kind) {
    case 'ready':
      return { cls: 'quest-complete', key: 'questUi.log.readyStatus' };
    case 'repeat':
      return { cls: 'quest-repeat', key: 'questUi.log.repeatableStatus' };
    case 'cooldown':
      return { cls: 'quest-cooldown', key: 'questUi.log.cooldownStatus' };
    case 'available':
      return null;
  }
}
