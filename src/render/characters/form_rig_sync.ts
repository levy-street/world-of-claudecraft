// The lazy form rigs the renderer's entity loop builds (renderer.ts
// buildFormVisual owns the build, the compile gate and the encounter
// prewarm): which slot the requested form needs, built the first time it is
// asked for, and the shared polymorph slot kept on the right animal. A
// Polymorph wears the sheep and a Toad Hex the toad (characterFormAssetKey);
// a slot still holding the other one is disposed and rebuilt behind the same
// gate, so the body stands in while the new rig links.
//
// Three-free: it reads only a rig's asset key and calls its dispose.

import {
  type CharacterFormKey,
  type CharacterFormVisual,
  polymorphRigStale,
} from './form_visual_selection_core';

export type FormRigSlot =
  | 'sheepVisual'
  | 'bearVisual'
  | 'catVisual'
  | 'travelVisual'
  | 'metamorphVisual';

/** What the sync needs of a built rig. */
export interface FormRig {
  readonly assetKey: string;
  dispose(): void;
}

export type FormRigSlots = { [K in FormRigSlot]: FormRig | null };

/** The renderer's build of one form rig into its slot. */
export type FormRigBuild<E, V> = (
  e: E,
  v: V,
  formKey: CharacterFormKey,
  slot: FormRigSlot,
  gateCompile: boolean,
) => void;

interface FormRigSpec {
  key: CharacterFormKey;
  slot: FormRigSlot;
  /** Metamorphosis is the one form that does not gate: it grows out of the
   *  body it replaces. */
  gate: boolean;
}

const FORM_RIGS: Readonly<Partial<Record<CharacterFormVisual, FormRigSpec>>> = {
  sheep: { key: 'form_sheep', slot: 'sheepVisual', gate: true },
  bear: { key: 'form_bear', slot: 'bearVisual', gate: true },
  cat: { key: 'form_cat', slot: 'catVisual', gate: true },
  travel: { key: 'form_travel', slot: 'travelVisual', gate: true },
  metamorph: { key: 'form_metamorph', slot: 'metamorphVisual', gate: false },
};

/** Build the requested form's rig when its slot is empty, rebuilding a
 *  polymorph slot that holds the wrong animal. Base and the fireball (no
 *  rig of its own) build nothing. */
export function syncFormRig<
  E extends { auras: readonly { kind: string; id?: string }[] },
  V extends FormRigSlots,
>(e: E, v: V, requested: CharacterFormVisual, build: FormRigBuild<E, V>): void {
  const spec = FORM_RIGS[requested];
  if (!spec) return;
  const slots: FormRigSlots = v;
  const rig = slots[spec.slot];
  if (rig && spec.slot === 'sheepVisual' && polymorphRigStale(rig.assetKey, e.auras)) {
    rig.dispose();
    slots[spec.slot] = null;
  }
  if (!slots[spec.slot]) build(e, v, spec.key, spec.slot, spec.gate);
}
