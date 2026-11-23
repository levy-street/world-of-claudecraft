// The lazy FORM rig slots one entity view owns (polymorph sheep, the druid
// shapes, the Lich form), named once so the renderer's per-frame passes walk
// them as a list instead of repeating one line per slot per pass. Adding a
// form rig is a new entry here plus its view field, never another copy of the
// shadow / far-LOD / proxy-shadow / dispose lines in renderer.ts.
//
// The mount is deliberately NOT a form slot: it is drawn UNDER the base body
// rather than instead of it, and its lifecycle is owned by mount_visuals.ts.
//
// Three-free and allocation-free (RENDER_PURE_CORES, tests/architecture.test.ts):
// the rig surface is structural, so a Vitest drives it with stubs. Every helper
// is a plain indexed loop, safe for the per-entity per-frame path.
export const FORM_VISUAL_SLOTS = [
  'sheepVisual',
  'bearVisual',
  'catVisual',
  'travelVisual',
  'metamorphVisual',
  'sporemenderVisual',
] as const;

export type FormVisualSlot = (typeof FORM_VISUAL_SLOTS)[number];

/** The rig surface the per-frame passes touch. */
export interface FormSlotRig {
  root: { visible: boolean };
  setShadow(on: boolean): void;
  setFar(on: boolean): void;
  setProxyShadow(on: boolean): void;
  dispose(): void;
}

export type FormVisualSlots<R> = { [K in FormVisualSlot]: R | null };

/** Articulated shadow on or off for every built form rig. */
export function setFormRigsShadow<R extends FormSlotRig>(v: FormVisualSlots<R>, on: boolean): void {
  for (let i = 0; i < FORM_VISUAL_SLOTS.length; i++) v[FORM_VISUAL_SLOTS[i]]?.setShadow(on);
}

/** Only the ACTIVE form rig may show its static far mesh. */
export function setFormRigsFar<R extends FormSlotRig>(
  v: FormVisualSlots<R>,
  active: unknown,
  isFar: boolean,
): void {
  for (let i = 0; i < FORM_VISUAL_SLOTS.length; i++) {
    const rig = v[FORM_VISUAL_SLOTS[i]];
    rig?.setFar(isFar && active === rig);
  }
}

/** Only the ACTIVE form rig may carry the static proxy shadow. */
export function setFormRigsProxyShadow<R extends FormSlotRig>(
  v: FormVisualSlots<R>,
  active: unknown,
  formProxy: boolean,
): void {
  for (let i = 0; i < FORM_VISUAL_SLOTS.length; i++) {
    const rig = v[FORM_VISUAL_SLOTS[i]];
    rig?.setProxyShadow(formProxy && active === rig);
  }
}

/** The form rig currently drawn, or null when the base body shows. */
export function visibleFormRig<R extends FormSlotRig>(v: FormVisualSlots<R>): R | null {
  for (let i = 0; i < FORM_VISUAL_SLOTS.length; i++) {
    const rig = v[FORM_VISUAL_SLOTS[i]];
    if (rig?.root.visible) return rig;
  }
  return null;
}

/** Release every built form rig's per-instance bindings. */
export function disposeFormRigs<R extends FormSlotRig>(v: FormVisualSlots<R>): void {
  for (let i = 0; i < FORM_VISUAL_SLOTS.length; i++) v[FORM_VISUAL_SLOTS[i]]?.dispose();
}
