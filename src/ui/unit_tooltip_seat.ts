// Where the mouseover unit tooltip (the mob and player hover card) sits this
// paint: the DOM-reading half of Hud.paintMobTooltipBottomRight, which stays a
// thin consumer. The placement math is pure (tooltip_clamp_core.ts); this only
// resolves the live state it needs, once per repaint (the hover card rebuilds
// on a key change, never per frame).
//
// - Touch: the card keeps its slot beside the minimap. Frame editing is
//   desktop-only, so the movable seat is ignored there, including a hide the
//   player set on desktop, which they could not undo from a phone.
// - Desktop: the card grows from the movable Tooltip frame's anchor
//   (interface_unlock_core.ts 'unitTooltip'). Its stock seat is the classic
//   bottom-right slot, so an unmoved anchor paints exactly where the card
//   always has. A player who unticked the Tooltip row in the frames menu gets
//   no card at all (a class check, no layout read).
// - The anchor's rect is handed back as a READER, not a value: tooltip_paint.ts
//   calls it after its own box measure, so the paint forces one layout, not two.
// - No anchor element (an entry without it) or an unlaid-out one: no seat,
//   and the paint path falls back to the fixed corner.
//
// Deliberately unregistered in tests/architecture.test.ts: it reaches no
// browser global, only the Document its caller injects (the tooltip_paint.ts
// shape), so the classification sweep's default bucket is the right one.

import { UNIT_TOOLTIP_ANCHOR_ELEMENT_ID } from './interface_unlock_core';
import { FRAME_USER_HIDDEN_CLASS } from './movable_frame';
import type { TooltipAnchorRect } from './tooltip_clamp_core';

export interface UnitTooltipSeat {
  /** The player hid the Tooltip frame: paint no hover card. */
  hidden: boolean;
  /** Touch tier only: the minimap's visual rect, the slot the card parks beside. */
  minimap: DOMRect | null;
  /** Desktop only: reads the movable anchor's visual rect the card grows from
   *  (null when the anchor is not laid out). Call it after the card's measure. */
  readAnchor: (() => TooltipAnchorRect | null) | null;
}

export function resolveUnitTooltipSeat(doc: Document): UnitTooltipSeat {
  if (doc.body.classList.contains('mobile-touch')) {
    const minimap = doc.getElementById('minimap-wrap')?.getBoundingClientRect() ?? null;
    return { hidden: false, minimap, readAnchor: null };
  }
  const el = doc.getElementById(UNIT_TOOLTIP_ANCHOR_ELEMENT_ID);
  if (!el) return { hidden: false, minimap: null, readAnchor: null };
  if (el.classList.contains(FRAME_USER_HIDDEN_CLASS)) {
    return { hidden: true, minimap: null, readAnchor: null };
  }
  const readAnchor = (): TooltipAnchorRect | null => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? rect : null;
  };
  return { hidden: false, minimap: null, readAnchor };
}
