// The compact "Party" chip: the ONE-TIME DOM builder for the mobile party-frames
// collapse header.
//
// This is the BUILDER half (the state half is party_collapse.ts; the per-frame /
// per-toggle painter side lives in party_frames_painter.ts). It runs once, when the
// party frames are first shown on mobile, so it freely uses the DOM creation
// primitives (createElement, className, the inline chevron SVG, the role / aria
// attributes) the per-frame painter must not touch.
//
// The chevron follows the repo's existing pattern (the #mobile-consumables-toggle
// chip): an inline .ui-icon SVG (the hand-authored `next` triangle from ui_icons.ts,
// no unicode arrow) that CSS rotates when the container gains .party-expanded. The
// chip is a real <button> that meets the 40px touch floor via hud.mobile.css, and
// its click toggles the collapse state through the supplied callback.

import { svgIcon } from './ui_icons';

/** The chip's id, so hud.mobile.css can target it and the E2E audit can measure it. */
export const PARTY_CHIP_ID = 'party-chip';
/** The label text span's class (the visible "Party" caption, written via t()). */
export const PARTY_CHIP_LABEL_CLASS = 'party-chip-label';

/** A built chip: the button element and its label span (the painter writes the
 *  localized caption into the span through the elided setText). */
export interface PartyChip {
  el: HTMLButtonElement;
  label: HTMLElement;
}

/**
 * Build the collapse chip once: a button carrying the chevron icon + a label span.
 * The caller (the painter) writes the localized caption and drives aria-expanded
 * through the elided writers; the click handler is attached here (once) and calls
 * onToggle. The accessible name comes from the visible label text, so it stays
 * localized without a per-frame aria write.
 */
export function createPartyChip(doc: Document, onToggle: () => void): PartyChip {
  const btn = doc.createElement('button');
  btn.id = PARTY_CHIP_ID;
  btn.className = 'party-chip';
  btn.type = 'button';
  // A disclosure control: aria-expanded reflects the collapse state (the painter
  // updates it through the elided setAttr on each toggle). Starts collapsed.
  btn.setAttribute('aria-expanded', 'false');
  // The chevron: the same inline .ui-icon SVG the consumables chip uses (the
  // hand-authored `next` triangle), decorative (aria-hidden), rotated by CSS when
  // the party frames expand. No unicode arrow (the repo pattern is CSS/SVG).
  btn.insertAdjacentHTML('afterbegin', svgIcon('next'));
  const label = doc.createElement('span');
  label.className = PARTY_CHIP_LABEL_CLASS;
  btn.appendChild(label);
  btn.addEventListener('click', onToggle);
  return { el: btn, label };
}
