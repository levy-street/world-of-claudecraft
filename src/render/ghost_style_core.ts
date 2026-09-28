// Which translucent look a character wears this frame, if any.
//
// Every ethereal read is the spirit VEIL (characters/ghost_veil.ts): one
// shared unlit program family linked at boot, drawn with the user's palette
// (characters/spirit_veil_palette_core.ts). A released spirit, the Pale
// Keeper and the quest visions wear the released-spirit palette, Ghost Wolf
// and the Veilbound March their own. Stealth wears one of two palettes by its
// source: the rogue's Duskveil and Smokefade, or any other (the druid cat's
// Stalk, the mage's Greater Invisibility). A dead stealther is a spirit
// first, and a stealthed Ghost Wolf stays a wolf. Three-free so a Vitest pins
// the table.
//
// Who sees a stealther at all is the server's call (server/game.ts
// canObserveEntity never sends one to a hostile viewer), so this only styles
// what the viewer already receives.

import type { Aura, Entity } from '../sim/types';
import type { SpiritVeilPalette } from './characters/spirit_veil_palette_core';
import { shouldRenderStealthGhost } from './stealth';

export type CharacterGhostLook = SpiritVeilPalette;

/** The aura ids of the rogue's stealth (Duskveil, Smokefade). */
export const ROGUE_STEALTH_AURA_IDS: ReadonlySet<string> = new Set(['stealth', 'vanish']);

/** The stealth palette for the stealth aura(s) a body carries. */
export function stealthVeilPalette(auras: readonly Pick<Aura, 'id' | 'kind'>[]): SpiritVeilPalette {
  for (const aura of auras) {
    if (aura.kind === 'stealth' && ROGUE_STEALTH_AURA_IDS.has(aura.id)) return 'stealth-rogue';
  }
  return 'stealth-other';
}

export function characterGhostLook(
  viewerId: number,
  e: Entity,
  ghostWolf: boolean,
  veilbound: 'march' | 'mark' | 'none',
): CharacterGhostLook | null {
  if (e.ghost) return 'spirit';
  if (shouldRenderStealthGhost(viewerId, e) && !ghostWolf) return stealthVeilPalette(e.auras);
  if (ghostWolf) return 'wolf';
  if (veilbound === 'march') return 'march';
  if (e.templateId.startsWith('vision_') || e.templateId === 'spirit_healer') return 'spirit';
  return null;
}
