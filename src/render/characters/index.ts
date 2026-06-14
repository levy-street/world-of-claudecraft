// Character visual system — rigged glTF replacements for the old procedural
// rigs. Asset fetches start at module import (see assets.ts) and register
// with the preload gate, so createCharacterVisual is synchronous by the time
// the Renderer constructs views.
import type { Entity } from '../../sim/types';
import { CharacterVisual } from './visual';
import { visualKeyFor } from './manifest';

export { CharacterVisual } from './visual';
export type { AnimState } from './visual';
export { CharacterPreview } from './preview';

type FormVisualKey = 'form_sheep' | 'form_bear' | 'form_ghost_wolf';

/** Build the visual for an entity (or an explicit form key). */
export function createCharacterVisual(e: Entity, formKey?: FormVisualKey): CharacterVisual {
  return new CharacterVisual(formKey ?? visualKeyFor(e), e.color);
}
