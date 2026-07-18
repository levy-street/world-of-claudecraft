// Character visual system — rigged glTF replacements for the old procedural
// rigs. Asset fetches start at module import (see assets.ts) and register
// with the preload gate, so createCharacterVisual is synchronous by the time
// the Renderer constructs views.
import type { Entity, PlayerClass } from '../../sim/types';
import { logAssetMissOnce } from './asset_miss_log';
import { mechHeldWeaponOverride, visualKeyFor } from './manifest';
import { CharacterVisual } from './visual';

export { CharacterPreview } from './preview';
export type { PreviewAppearance } from './preview_appearance';
export type { AnimState } from './visual';
export { CharacterVisual, setWeaponVfxViewportHeight } from './visual';

/** Build the visual for an entity (or an explicit shapeshift/polymorph form key).
 *  Returns null when the visual's assets are unavailable (a missed preload, a
 *  lazy fetch that has not landed): callers skip that entity's view for the
 *  frame and the entity stays a future candidate. A synchronous throw here
 *  would stall the per-frame render path forever (issue #2079, the v0.27.0
 *  training dummy freeze). */
export function createCharacterVisual(
  e: Entity,
  formKey?: 'form_sheep' | 'form_bear' | 'form_cat' | 'form_travel',
): CharacterVisual | null {
  // forms (sheep/bear/cat/travel) are their own models — skins and held weapons
  // only apply to the base body
  const key = formKey ?? visualKeyFor(e);
  // The class-agnostic Combat Mech adopts the wearer's independent mainhand and
  // offhand layout. e.templateId is the player's class on every host, so this
  // matches offline and online.
  const weaponOverride =
    !formKey && key === 'player_mech' && e.kind === 'player'
      ? mechHeldWeaponOverride(e.templateId as PlayerClass)
      : null;
  try {
    return new CharacterVisual(
      key,
      e.color,
      formKey ? 0 : (e.skin ?? 0),
      formKey ? null : e.mainhandItemId,
      weaponOverride,
      formKey ? null : e.offhandItemId,
    );
  } catch (err) {
    // key the dedupe on visual key PLUS message: two models failing with an
    // identical generic error must both get their first log line
    const detail = err instanceof Error ? err.message : String(err);
    logAssetMissOnce(
      `${key}:${detail}`,
      `character visual unavailable, skipping view (${key}):`,
      err,
    );
    return null;
  }
}
