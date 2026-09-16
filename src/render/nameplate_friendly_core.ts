// Pure decision for the Toggle Friendly Nameplates keybind (Ctrl+V): does it hide
// this entity's overhead plate? DOM/Three/i18n-free (RENDER_PURE_CORES,
// tests/architecture.test.ts), so the rule is unit-tested without a WebGL
// context, the same contract nameplate_view.ts follows.
//
// It sits beside the plate plan rather than inside it because resolving a mob's
// reaction needs the entity map (a pet inherits its owner's, see reaction.ts)
// and nameplatePlanInto deliberately takes only the one entity. The painter
// calls this before it builds a plan, next to the quest gate, so a hidden plate
// leaves no pick anchor behind either.

import type { Entity } from '../sim/types';
import { isMobHostileToViewer } from './reaction';

/**
 * True when the friendly-nameplate toggle hides `e`'s overhead plate.
 *
 * Only LIVING FRIENDLY MOB plates answer to it: town NPCs, vendors, quest
 * givers and friendly pets. Hostile mobs are the Toggle Nameplates key's
 * business (that one hides every mob plate, this one only the friendly half),
 * players have their own two settings, objects carry no reaction, and a corpse
 * is left alone on purpose, since a lootable body's plate is the loot marker
 * that nameplate_view.ts already spares from the master toggle.
 *
 * On is the default and the shipped behavior, so that case returns before the
 * reaction resolve below: the per-entity owner lookup only ever runs for a
 * player who actually pressed the key. Pure: same inputs give the same answer,
 * no DOM/Three/i18n, no Math.random/Date.now/performance.now.
 */
export function isFriendlyNameplateHidden(
  e: Entity,
  entities: Map<number, Entity>,
  isPlayerHostile: (p: Entity) => boolean,
  showFriendlyNameplates: boolean,
): boolean {
  if (showFriendlyNameplates) return false;
  if (e.kind !== 'mob' || e.dead) return false;
  return !isMobHostileToViewer(e, entities, isPlayerHostile);
}
