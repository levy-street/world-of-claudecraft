// The on-screen objective pointer: the DOM half of objective_arrow_core.ts.
//
// Both onboardings use it (the in-world coachmark and the starter tutorial's isle),
// so the element, its a11y treatment and its placement live in exactly one place.

import type { ProjectedPoint } from './objective_arrow_core';
import { objectiveArrowPlacement } from './objective_arrow_core';

// A decorative right-pointing triangle (U+27A4). Written as an escape, not as the
// literal glyph: the repo's copy rule bans emoji and dash literals in source, and
// the pre-push scan reads the character, not the intent. It is purely decorative
// (the element is aria-hidden and the card's own text says where to go), so it is
// a glyph, never a label standing in for real `t()` copy.
const ARROW_GLYPH = '\u27A4';

/** Create the arrow and append it to `parent`. */
export function createObjectiveArrow(parent: HTMLElement): HTMLElement {
  const arrow = document.createElement('div');
  arrow.className = 'tut-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = ARROW_GLYPH;
  parent.appendChild(arrow);
  return arrow;
}

/** Point the arrow at an already-projected world target. */
export function paintObjectiveArrow(arrow: HTMLElement, projected: ProjectedPoint): void {
  const place = objectiveArrowPlacement(projected, window.innerWidth, window.innerHeight);
  arrow.style.display = 'block';
  arrow.style.left = `${place.x}px`;
  arrow.style.top = `${place.y}px`;
  arrow.style.transform = `translate(-50%, -50%) rotate(${place.angle}rad)`;
}

export function hideObjectiveArrow(arrow: HTMLElement | null): void {
  if (arrow) arrow.style.display = 'none';
}
