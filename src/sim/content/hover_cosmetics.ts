// Hover cosmetics: back attachments (wings, jetpack) that make the wearer
// HOVER instead of walk. Purely cosmetic: movement speed, collision, jumping,
// swimming, and every combat number are untouched (the hover is a render-only
// lift + glide animation; see src/render/characters/visual.ts). The applied
// cosmetic rides the identity wire (terse `hov`) so every nearby player sees
// the wings and the hover.
//
// Models are Tripo-generated back attachments post-processed by
// scripts/build_hover_attachments.mjs (wings split into wing.l / wing.r nodes
// so the renderer can flap them procedurally) into
// public/models/cosmetics/<model>.glb.

export type HoverVfxKind = 'sparkle' | 'feather' | 'flame' | 'dragonfire';

export interface HoverCosmeticDef {
  /** Stable id: the wire value, the apply-command argument, and a future SKU. */
  id: string;
  name: string;
  /** GLB basename under public/models/cosmetics/. */
  model: string;
  /** Which ambient VFX rig rides the attachment (src/render/hover_vfx.ts). */
  vfx: HoverVfxKind;
  /** Wing halves flap (wing.l / wing.r nodes); a jetpack has none. */
  flaps: boolean;
}

export const HOVER_COSMETICS: Record<string, HoverCosmeticDef> = {
  butterfly_drift: {
    id: 'butterfly_drift',
    name: 'Butterfly Drift',
    model: 'hover_butterfly_wings',
    vfx: 'sparkle',
    flaps: true,
  },
  dawnfeather_wings: {
    id: 'dawnfeather_wings',
    name: 'Dawnfeather Wings',
    model: 'hover_angel_wings',
    vfx: 'feather',
    flaps: true,
  },
  tinkers_jetpack: {
    id: 'tinkers_jetpack',
    name: "Tinker's Jetpack",
    model: 'hover_jetpack',
    vfx: 'flame',
    flaps: false,
  },
  dreadwyrm_wings: {
    id: 'dreadwyrm_wings',
    name: 'Dreadwyrm Wings',
    model: 'hover_dragon_wings',
    vfx: 'dragonfire',
    flaps: true,
  },
};

export const HOVER_COSMETIC_LIST: readonly HoverCosmeticDef[] = Object.values(HOVER_COSMETICS);

export function isHoverCosmeticId(value: unknown): value is string {
  // Object.hasOwn, never `in`: this is the change_hover command's only gate,
  // and `in` walks the prototype chain (accepting '__proto__', 'constructor').
  return typeof value === 'string' && Object.hasOwn(HOVER_COSMETICS, value);
}
