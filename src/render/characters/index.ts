// Character visual system — rigged glTF replacements for the old procedural
// rigs. Asset fetches start at module import (see assets.ts) and register
// with the preload gate, so createCharacterVisual is synchronous by the time
// the Renderer constructs views.
import type { Entity } from '../../sim/types';
import { visualKeyFor } from './manifest';
import { CharacterVisual } from './visual';

export { CharacterPreview } from './preview';
export type { AnimState } from './visual';
export { CharacterVisual } from './visual';

/** Build the visual for an entity (or an explicit shapeshift/polymorph form key). */
export function createCharacterVisual(
  e: Entity,
  formKey?: 'form_sheep' | 'form_bear' | 'form_cat' | 'form_travel',
): CharacterVisual {
  // forms (sheep/bear/cat/travel) are their own models — skins and held weapons
  // only apply to the base body
  return new CharacterVisual(
    formKey ?? visualKeyFor(e),
    e.color,
    formKey ? 0 : (e.skin ?? 0),
    formKey ? null : e.mainhandItemId,
  );
}
