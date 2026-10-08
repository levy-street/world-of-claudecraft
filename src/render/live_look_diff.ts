// The per-frame LOOK diffs of a live character view: the paperdoll helm eye,
// a redesigned authored look, and a WOC modular body's worn armor. Lifted out
// of the renderer's entity loop so the three rules sit together and a Vitest
// reads them directly; the renderer stays a thin consumer.
//
// Two of the rules RECOMPOSE (a composed KayKit body's helm and look are
// geometry, so the view's remembered visual key is nulled and the renderer's
// next-key diff reuses its whole base-visual replace path: click-target
// handoff, compile gating). The third is a visibility flip on the visual it
// already has (CharacterVisual.setWocEquipment), which is why it runs AFTER the
// base visual settles for the frame while the other two run before.
import type { Entity, EquipSlot, PlayerClass } from '../sim/types';
import { isMechWearer } from '../sim/types';
import { modularLookFor } from './characters';
import { wocBodyScaleOf } from './characters/modular';
import { modularLookChanged } from './characters/player_look_core';
import type { WocHeadAppearanceInput } from './characters/woc_head_look_core';
import { classBodyComposes } from './characters/woc_parts_core';

/** The slice of the renderer's EntityView these diffs read and write. */
export interface LiveLookView {
  visualKey: string | null;
  /** last-rendered paperdoll eye toggle, diffed to recompose the kit helm */
  helmHidden: boolean;
  /** last-composed authored look: a plain reference copy of e.modularAppearance,
   *  never normalized, so an unchanged reference short-circuits without a
   *  stringify next frame */
  modularAppearance: Record<string, unknown> | null | undefined;
}

/** The dressing half of a character visual (CharacterVisual.setWocEquipment,
 *  setWocHeadLook for the modular head, and setBodyScale for the body size). */
export interface WocDressable {
  setWocEquipment(
    equipped: Readonly<Partial<Record<EquipSlot, string>>> | null | undefined,
    helmHidden: boolean,
  ): boolean;
  setWocHeadLook?(app: WocHeadAppearanceInput): boolean;
  setBodyScale?(scale: number): boolean;
}

/**
 * The recompose diffs, run BEFORE the frame's base-visual update.
 *
 * Live helm toggle: the composed kit's head piece is part of the geometry,
 * not a texture, so flipping it means recomposing the body. Composed entities
 * only: a fixed class rig has no kit helm to take off, and a mech wearer keeps
 * the mech body (index.ts skips their look), so neither may force a pointless
 * dispose/rebuild.
 *
 * Live redesign: the server pushed a changed authored look onto this live
 * entity and the client mirror reassigned e.modularAppearance from a fresh
 * wire read. Cheap reference check first, exactly like every other diff in the
 * renderer's pass; the reference alone is not a verdict because the SAME mirror
 * also reassigns it on every unrelated identity record (an equip, a level-up),
 * so modularLookChanged does the real by-value comparison before anything is
 * nulled. modularLookFor reads the NEW state, which is null exactly when a
 * cleared look needs the body to fall back to the class rig, so a previously
 * composed body (a non-null prev reference) recomposes too. The reference is
 * copied every time this fires, changed or not, so the cheap check stays quiet
 * until the next real reassignment.
 */
export function diffComposedLook(e: Entity, v: LiveLookView): void {
  if (e.helmHidden !== v.helmHidden) {
    v.helmHidden = e.helmHidden;
    if (!isMechWearer(e) && modularLookFor(e)) v.visualKey = null;
  }
  if (e.modularAppearance !== v.modularAppearance) {
    if (modularLookChanged(v.modularAppearance, e.modularAppearance)) {
      const composedBefore = v.modularAppearance != null;
      // A WOC-bodied class composes nothing: only its BODY FILE follows the
      // appearance (the female pick, playerVisualKey), so only a body-type
      // change rebuilds it. Every other field it draws (the modular head's
      // picks, face controls and colours, and the body size) lands IN PLACE
      // through diffWornArmor's setWocHeadLook and setBodyScale, so a face or
      // size redesign never rebuilds it.
      const wocBody = e.kind === 'player' && !classBodyComposes(e.templateId as PlayerClass);
      const rebuild = wocBody
        ? bodyPickOf(v.modularAppearance) !== bodyPickOf(e.modularAppearance)
        : !!modularLookFor(e) || composedBefore;
      if (!isMechWearer(e) && rebuild) v.visualKey = null;
    }
    v.modularAppearance = e.modularAppearance;
  }
}

/** The body type a stored appearance picks (the WOC female body, or the male one). */
function bodyPickOf(app: Record<string, unknown> | null | undefined): 'female' | 'male' {
  return app?.gender === 'female' ? 'female' : 'male';
}

/** The dressing diff, run AFTER the base visual settled: a WOC modular body
 *  dresses itself from the worn set (the six armor slots and the paperdoll eye)
 *  with a visibility flip per part, never a rebuild; every other rig answers
 *  false at once. Returns whether the body changed. */
export function diffWornArmor(e: Entity, visual: WocDressable): boolean {
  // Only a player has a worn set to dress from. A mob on a WOC body (the
  // Nythraxis court's vision of Captain Aldren rides the warrior def) keeps
  // the assembly's default kit rather than reading its empty slots as bare.
  if (e.kind !== 'player') return false;
  const dressed = visual.setWocEquipment(e.equippedItems, e.helmHidden);
  // the modular head: a reference compare per frame, a flag/uniform flip on change
  const head = visual.setWocHeadLook?.(e.modularAppearance) ?? false;
  // the body size: one read and a compare per frame, a pose-wrap scale on change
  // (it runs before the renderer reads the frame's height for the nameplate)
  const size = visual.setBodyScale?.(wocBodyScaleOf(e.modularAppearance)) ?? false;
  return dressed || head || size;
}
