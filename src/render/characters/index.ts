// Character visual system — rigged glTF replacements for the old procedural
// rigs. Asset fetches start at module import (see assets.ts) and register
// with the preload gate, so createCharacterVisual is synchronous by the time
// the Renderer constructs views.
import { type Entity, isMechWearer, type PlayerClass } from '../../sim/types';
import { logAssetMissOnce } from './asset_miss_log';
import { type AssembleOptions, modularHeadFor } from './assets';
import { composedLookPiecesFor, type LookPieceQueue, type LookPieces } from './look_pieces';
import {
  mechHeldWeaponOverride,
  modularVisualKey,
  VISUALS,
  type VisualDef,
  visualKeyFor,
} from './manifest';
import { MODULAR_WARRIOR_KEY, type ModularLook } from './modular';
import { npcModularKeyFor } from './npc_looks';
import { CharacterVisual } from './visual';

export { type AnimOverrideFacts, applyEntityAnimOverrides } from './anim_state_entity_core';
export type { AssembleOptions } from './assets';
export { type LookPiecesStats, lookPiecesStats } from './look_pieces';
export { npcLookFor } from './npc_looks';
export { CharacterPreview } from './preview';
export type { PreviewAppearance } from './preview_appearance';
export type { PreviewFramingName } from './preview_framing';
export type { AnimState, FarBakeGate } from './visual';
export { CharacterVisual, setWeaponVfxViewportHeight } from './visual';

// A composed (modular) body is opt-in per entity: the app installs a provider
// that maps an entity to its authored look, and anything it does not claim
// keeps the fixed class rig it has always used.
//
// EVERY player composes now, not just the local one: the look rides the `app`
// identity wire field (set at join from the character's own column), so the
// provider answers for peers from server truth. A character authored before the
// creator carries no look and keeps its class rig, which is what the provider
// returning null still means. The seam stays a seam because the RULE for what a
// given entity wears is app-level (see src/render/characters/player_look_core.ts),
// while this module only needs the answer.
let modularLookProvider: ((e: Entity) => ModularLook | null) | null = null;

/** Install (or clear, with null) the entity-to-look mapping. */
export function setModularLookProvider(fn: ((e: Entity) => ModularLook | null) | null): void {
  modularLookProvider = fn;
}

/** The look an entity composes with, or null if it keeps its fixed class rig.
 *  The same answer the visual factory uses, exposed so the UI can draw a
 *  PORTRAIT of the composed character instead of a generic class one. */
export function modularLookFor(e: Entity): ModularLook | null {
  return modularLookProvider?.(e) ?? null;
}

/** The composed-body visual key for an entity the look provider claimed: the
 *  class's own modular def (its clips, ability mapping and hand layout), with
 *  the warrior's as the fallback for a templateId without one. A claimed
 *  NON-player (a world NPC or an NPC-bodied quest actor) resolves its authored
 *  prop-set def instead: the class fallback would hand a villager the
 *  warrior's default sword and swing set. */
export function modularKeyFor(e: Entity): string {
  if (e.kind !== 'player') return npcModularKeyFor(e.templateId);
  const key = modularVisualKey(e.templateId as PlayerClass);
  return VISUALS[key] ? key : MODULAR_WARRIOR_KEY;
}

/** The composed body an entity's BASE visual will build from, resolved the
 *  same way createCharacterVisual resolves it (a mech wearer never composes;
 *  forms are separate lazy slots over this base), or null when the entity
 *  keeps a fixed rig. */
function composedLookOf(e: Entity): { def: VisualDef; look: ModularLook } | null {
  if (isMechWearer(e)) return null;
  const look = modularLookProvider?.(e) ?? null;
  if (!look) return null;
  return { def: VISUALS[modularKeyFor(e)], look };
}

/** The pieces of an entity's composed look on the queue (look_pieces.ts):
 *  null for an entity that keeps a fixed rig, otherwise its readiness with the
 *  missing pieces enqueued, the head resolved from the cached part set. */
export function composedLookPiecesOf(
  e: Entity,
  queue: LookPieceQueue,
  priority: number,
): LookPieces | null {
  const composed = composedLookOf(e);
  if (!composed) return null;
  const { def, look } = composed;
  return composedLookPiecesFor(def, look, modularHeadFor(def, look), queue, priority);
}

/** Build a rideable mount's visual: no skin, no held weapon, authored colours
 *  (mount defs carry no tint). The caller gates on mountAssetsReady() first:
 *  mount GLBs are lazyPreload and resolvedGltf throws when not yet fetched. */
export function createMountVisual(visualKey: string): CharacterVisual {
  return new CharacterVisual(visualKey, 0xffffff, 0, null, null);
}

/** Build the visual for an entity (or an explicit shapeshift/polymorph form key).
 *  Returns null when the visual's assets are unavailable (a missed preload, a
 *  lazy fetch that has not landed): callers skip that entity's view for the
 *  frame and the entity stays a future candidate. A synchronous throw here
 *  would stall the per-frame render path forever (issue #2079, the v0.27.0
 *  training dummy freeze). */
export function createCharacterVisual(
  e: Entity,
  formKey?: 'form_sheep' | 'form_bear' | 'form_cat' | 'form_travel' | 'form_metamorph',
  opts?: AssembleOptions,
): CharacterVisual | null {
  // Forms are their own models. Skins and held weapons
  // only apply to the base body
  // Shapeshift forms are their own model and never compose, and neither does a
  // Combat Mech wearer: the mech is a whole replacement body, so the cosmetic
  // must win over the authored look (composing over it hid a purchased skin).
  const look = formKey || isMechWearer(e) ? null : (modularLookProvider?.(e) ?? null);
  const key = formKey ?? (look ? modularKeyFor(e) : visualKeyFor(e));
  // The class-agnostic Combat Mech adopts the wearer's independent mainhand and
  // offhand layout. e.templateId is the player's class on every host, so this
  // matches offline and online.
  const weaponOverride =
    !formKey && key === 'player_mech' && e.kind === 'player'
      ? mechHeldWeaponOverride(e.templateId as PlayerClass)
      : null;
  try {
    // The world path, and the only one with a point-light budget: its weapon
    // light is born hidden and the budget decides when it shines. A rig built
    // directly (previews) keeps a light that lights immediately.
    const visual = new CharacterVisual(
      key,
      e.color,
      formKey ? 0 : (e.skin ?? 0),
      formKey ? null : e.mainhandItemId,
      weaponOverride,
      formKey ? null : e.offhandItemId,
      look,
      opts,
    );
    visual.budgetedWeaponLight = true;
    return visual;
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
