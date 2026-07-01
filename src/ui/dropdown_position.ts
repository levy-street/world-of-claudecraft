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
