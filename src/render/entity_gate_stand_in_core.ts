/**
 * The stand-in invariant for the live compile gates: NEVER LEAVE AN ENTITY
 * WITH NO REPRESENTATION.
 *
 * Every gate in the renderer hides something a driver is still linking, so the
 * reveal draw cannot stall the frame. That is only fair while something else
 * still tells the player the entity is there: a gate that hides the last thing
 * drawn takes actionable information away for an unbounded window (the link is
 * not cancellable and the gate timeout is diagnostic only). The far-bake gate
 * is the reference shape, `far_lod_reveal_core.ts`: the articulated rig keeps
 * drawing until the baked mesh links.
 *
 * This module holds the two halves that keep the rule enforceable: the named
 * stand-in per gate call site (ENTITY_GATE_STAND_INS, which the stand-in test
 * checks against the real sources, so a new gate reds until it names one), and
 * the two predicates the renderer and the nameplate painter drive it with.
 *
 * Three/DOM/i18n-free (RENDER_PURE_CORES, tests/architecture.test.ts): the rig
 * surfaces below are structural, so a plain Vitest drives them with stubs.
 */

import type { CharacterFormVisibility } from './characters/form_visual_selection_core';

/** A rig whose whole body the per-frame loop switches on or off. */
export interface ActivatableRig {
  setActive(on: boolean): void;
}

/** A rig root the painter can ask whether it is currently drawn. */
export interface DrawableRig {
  root: { visible: boolean };
}

/** The six character rigs one entity view can own. */
export interface CharacterFormRigSlots {
  visual: ActivatableRig | null;
  sheepVisual: ActivatableRig | null;
  bearVisual: ActivatableRig | null;
  catVisual: ActivatableRig | null;
  travelVisual: ActivatableRig | null;
  metamorphVisual: ActivatableRig | null;
}

/** The same six, plus the one bespoke body that replaces all of them. */
export interface EntityRigSlots {
  visual: DrawableRig | null;
  sheepVisual: DrawableRig | null;
  bearVisual: DrawableRig | null;
  catVisual: DrawableRig | null;
  travelVisual: DrawableRig | null;
  metamorphVisual: DrawableRig | null;
  /** the Mage fireball travel form: a bespoke visual that takes every rig out
   *  of the frame, so its presence IS the body for that window */
  fireballTravelVisual: unknown;
}

/**
 * Push the resolved form visibility onto one view's rigs. The base body is the
 * stand-in for every gated FORM: `characterFormReadyMask` holds the resolved
 * form at 'base' until the form rig links, so no extra pending check belongs
 * here. `baseGated` is the one case where the base body itself is hidden, a
 * base-rig replacement still linking, and there the OUTGOING rig stands in
 * (renderer `updateBaseVisual` keeps it attached until the gate settles).
 */
export function applyCharacterFormVisibility(
  rigs: CharacterFormRigSlots,
  visibility: CharacterFormVisibility,
  baseGated: boolean,
): void {
  rigs.visual?.setActive(visibility.base && !baseGated);
  rigs.sheepVisual?.setActive(visibility.sheep);
  rigs.bearVisual?.setActive(visibility.bear);
  rigs.catVisual?.setActive(visibility.cat);
  rigs.travelVisual?.setActive(visibility.travel);
  rigs.metamorphVisual?.setActive(visibility.metamorph);
}

/** Is any body of this entity actually drawn right now? */
export function anyCharacterRigDrawing(rigs: EntityRigSlots): boolean {
  if (rigs.fireballTravelVisual) return true;
  return !!(
    rigs.visual?.root.visible ||
    rigs.sheepVisual?.root.visible ||
    rigs.bearVisual?.root.visible ||
    rigs.catVisual?.root.visible ||
    rigs.travelVisual?.root.visible ||
    rigs.metamorphVisual?.root.visible
  );
}

/**
 * The entity has NO in-world body this frame, so its nameplate is forced on as
 * the stand-in of last resort even when the player has toggled plates off, and
 * out past the nameplate range and the plateless-object rule. An object view
 * (no rigs) only qualifies through the arrival gate, which hides its group the
 * same way. Positional booleans, not an options object: the
 * nameplate painter calls this per entity per pass and stays allocation-free.
 *
 * `viewCompilePending` is the arrival gate (gateViewOnCompile) hiding the whole
 * group; `hasCharacterRigs` is whether this view owns rigs at all (object and
 * ground-loot views do not); `anyRigDrawing` is anyCharacterRigDrawing above.
 */
export function entityHasNoBody(
  viewCompilePending: boolean,
  hasCharacterRigs: boolean,
  anyRigDrawing: boolean,
): boolean {
  return viewCompilePending || (hasCharacterRigs && !anyRigDrawing);
}

/** One live compile-gate call site and the representation that survives it. */
export interface EntityGateStandIn {
  /** the gate wrapper the call site invokes. `spiritCompileGate` is the one
   *  that is not a renderer wrapper: the puppet pool takes the host's gate
   *  through `setSpiritCompileGate` and consults it inside its own spawn. */
  gate: 'gateViewOnCompile' | 'gateSwapOnCompile' | 'gateSwapFlagOnCompile' | 'spiritCompileGate';
  /** repo-relative source file the call site lives in */
  file: string;
  /** exact call-site text, so the pin fails when the wiring moves or is dropped */
  callSite: string;
  /** what the entity is hidden behind for the gate window */
  hides: string;
  /** what the player still sees for that whole window */
  standIn: string;
}

/**
 * Every live gate call site, each with its stand-in. Adding a gate means adding
 * a row here AND a case to tests/entity_gate_stand_in.test.ts; the pin counts
 * the call sites in the real sources, so a new one reds until it is named.
 */
export const ENTITY_GATE_STAND_INS: readonly EntityGateStandIn[] = [
  {
    gate: 'gateViewOnCompile',
    file: 'src/render/renderer.ts',
    callSite: 'view.compileReady = this.gateViewOnCompile(',
    hides:
      'the arriving entity whole 3D group, for EVERY non-self view, objects included (for the Ignivar boss, once its rig exists, only that cosmetic rig hides: the group stays visible so the floor telegraphs keep drawing)',
    standIn:
      'the nameplate, forced on by entityHasNoBody: while the gate holds, the plate ignores both nameplate toggles, the 55 yd nameplate range and the plateless-object rule (nameplate_view.ts), so a gated ground-loot pile, chest or quest object is represented too, out to the view-create radius of about 80 yd. It stays hidden only where no body is being hidden from the player: a looted corpse, the deliberately label-less sealed crypt door and the Vale Cup ball',
  },
  {
    gate: 'gateSwapFlagOnCompile',
    file: 'src/render/renderer.ts',
    callSite: 'this.farBakeLane.enqueue((settled) => this.gateSwapFlagOnCompile(target, settled)',
    hides:
      'the freshly baked far mesh and its shadow proxy; the SAME injected gate also stages the transparent effect clones (visual.ts stageEffectSwap), which hide nothing at all, and reveals the face decals of a body built with them deferred (visual.ts attachDeferredDecals), which hide only themselves',
    standIn:
      'the articulated rig, held by farMeshShown (characters/far_lod_reveal_core.ts); for the effect-clone use, the body itself, still drawing its current opaque materials until the swap commits; for the deferred decals, the same body, drawn whole from the frame it entered range with only its stubble and makeup paint arriving late',
  },
  {
    gate: 'gateSwapFlagOnCompile',
    file: 'src/render/renderer.ts',
    callSite: 'this.gateSwapFlagOnCompile(built.root, () => {',
    hides: 'a lazily built shapeshift form rig',
    standIn: 'the base body, held by characterFormReadyMask until the rig links',
  },
  {
    gate: 'gateSwapFlagOnCompile',
    file: 'src/render/renderer.ts',
    callSite: 'this.gateSwapFlagOnCompile(next.root, () => {',
    hides: 'the replacement base rig after a race or mech swap',
    standIn: 'the outgoing base rig, kept attached until the gate settles',
  },
  {
    gate: 'gateSwapFlagOnCompile',
    file: 'src/render/renderer.ts',
    callSite: 'this.gateSwapFlagOnCompile(v.mountVisual.root, () => {',
    hides: 'a newly summoned mount',
    standIn: 'the rider, who keeps drawing on foot at seat lift 0',
  },
  {
    gate: 'gateSwapOnCompile',
    file: 'src/render/renderer.ts',
    callSite: 'if (changed) for (const node of changed) this.gateSwapOnCompile(node);',
    hides: 'only the swapped weapon, offhand or weapon-skin node',
    standIn: 'the whole character, which keeps animating and drawing',
  },
  {
    gate: 'spiritCompileGate',
    file: 'src/render/ability_vfx/spirits.ts',
    callSite: 'if (this.compileGate && !puppet.compiled) {',
    hides:
      'the spirit apparition of ONE cast, plus the entrance beat fx.ts spiritAt plays only on a successful spawn (its dust, its ring and its light pulse) and the creature call: the gate REFUSES the spawn rather than holding it, because a spirit that pops in late is worse than one that never came, and the puppet goes to the front of the warm-up queue for the next cast',
    standIn:
      "the rest of the ability's impact sequence, which sequencer.ts runs whatever spiritAt answers: the impact flash and shake, the archetype extras, the motifs and the authored linger. The apparition is one optional beat of a spectacle, never the entity a player acts on, and the refusals are counted as gpuPrep.gates.spiritSpawnsRefused",
  },
];
