// Pure placement math for a custom dropdown menu that must stay inside a
// clipping ancestor (overflow: hidden), e.g. the World Market filters inside
// #market-window on mobile. The menu is CSS position: absolute against its
// trigger, so a fixed 236px-tall menu can render past the clip boundary with
// no way to scroll to the rest: the clip box's own scroll region does not
// grow to include an absolutely positioned descendant. Flip the menu above
// the trigger and/or shrink it to the actually available space instead.

export interface DropdownPlacementInput {
  triggerTop: number;
  triggerBottom: number;
  containerTop: number;
  containerBottom: number;
  preferredMaxHeight: number;
  gap: number;
  minHeight: number;
}

export interface DropdownPlacement {
  side: 'below' | 'above';
  maxHeight: number;
}

export function computeDropdownPlacement(input: DropdownPlacementInput): DropdownPlacement {
  const spaceBelow = input.containerBottom - input.triggerBottom - input.gap;
  const spaceAbove = input.triggerTop - input.containerTop - input.gap;
  const side = spaceAbove > spaceBelow ? 'above' : 'below';
  const space = side === 'below' ? spaceBelow : spaceAbove;
  const maxHeight = Math.max(input.minHeight, Math.min(input.preferredMaxHeight, space));
  return { side, maxHeight };
}

/** One vertical clip band, in viewport coordinates. */
export interface DropdownClipBand {
  top: number;
  bottom: number;
}

/**
 * The band a dropdown may actually occupy: the INTERSECTION of every clipping
 * ancestor between the trigger and the window root.
 *
 * The World Market's filter selects sit inside `.mkt-controls`, which scrolls
 * (`overflow-y: auto`) and therefore clips in its own right. Measuring only the
 * outer window let a flipped-up menu render above the controls column's top edge,
 * where the first option was invisible and unclickable even though the window had
 * room. Bands are taken in order and clamped, so an empty or inverted result still
 * returns a band (bottom pinned to top) rather than NaN.
 */
export function dropdownClipBounds(bands: readonly DropdownClipBand[]): DropdownClipBand {
  let top = Number.NEGATIVE_INFINITY;
  let bottom = Number.POSITIVE_INFINITY;
  for (const band of bands) {
    top = Math.max(top, band.top);
    bottom = Math.min(bottom, band.bottom);
  }
  return { top, bottom: Math.max(top, bottom) };
}
