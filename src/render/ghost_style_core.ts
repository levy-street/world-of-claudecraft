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
// Who sees a stealther at all is the server's call (the Stealth Rework
// detection cone in server/entity_observation.ts), so this only styles what the
// viewer already receives. A stealthed ENEMY the viewer has spotted wears its
// own neutral palette whatever the stealth, and turns red only while it is the
// viewer's target; the stealther themself and their friends keep the
// stealth's own palette.

import type { Aura, Entity } from '../sim/types';
import { isPvpHostilePlayer, type PvpHostileWorld } from '../ui/pvp_hostile_core';
import type { SpiritVeilPalette } from './characters/spirit_veil_palette_core';
import { shouldRenderStealthGhost } from './stealth';
import { bastionShadeGhosted } from './sunken_bastion/bastion_shade_ghost_core';

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

/** How the viewer relates to a stealthed body: not an enemy, a spotted enemy,
 *  or a spotted enemy that is the viewer's current target. */
export type StealthEnemyView = 'none' | 'spotted' | 'targeted';

export function characterGhostLook(
  viewerId: number,
  e: Entity,
  ghostWolf: boolean,
  veilbound: 'march' | 'mark' | 'none',
  enemy: StealthEnemyView = 'none',
): CharacterGhostLook | null {
  if (e.ghost || bastionShadeGhosted(e)) return 'spirit';
  if (shouldRenderStealthGhost(viewerId, e) && !ghostWolf) {
    if (enemy === 'targeted') return 'stealth-enemy-target';
    if (enemy === 'spotted') return 'stealth-enemy';
    return stealthVeilPalette(e.auras);
  }
  if (ghostWolf) return 'wolf';
  if (veilbound === 'march') return 'march';
  if (e.templateId.startsWith('vision_') || e.templateId === 'spirit_healer') return 'spirit';
  return null;
}

export interface GhostLookWorld extends PvpHostileWorld {
  readonly player: { readonly targetId: number | null };
}

/** The renderer's per-body call: the look, with the enemy question asked only
 *  of a stealthed player (the one case it changes). */
export function ghostLookFor(
  world: GhostLookWorld,
  e: Entity,
  ghostWolf: boolean,
  veilbound: 'march' | 'mark' | 'none',
): CharacterGhostLook | null {
  let enemy: StealthEnemyView = 'none';
  if (shouldRenderStealthGhost(world.playerId, e) && isPvpHostilePlayer(world, e)) {
    enemy = world.player.targetId === e.id ? 'targeted' : 'spotted';
  }
  return characterGhostLook(world.playerId, e, ghostWolf, veilbound, enemy);
}
