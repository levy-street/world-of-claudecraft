// Sprites that light in turn (a weapon-skin coreSprite's `seq`, src/render/weapon_vfx.ts): how
// lit one slot is at a given moment. The Heartmeld Staff's four gems take turns this way.
// Three/DOM-free and deterministic (a registered RENDER_PURE_CORE).

/** How lit slot `slot` of `of` sprites lighting in turn is at time `t` (0..1): a smooth lobe
 *  once a round (`hz` rounds a second), the slots evenly spaced through it. */
export function weaponVfxSeqLevel(t: number, slot: number, of: number, hz: number): number {
  const phase = (((t * hz - slot / of) % 1) + 1) % 1;
  const d = Math.min(phase, 1 - phase) * of; // distance in slots from this slot's moment
  return d >= 1 ? 0 : 0.5 + 0.5 * Math.cos(d * Math.PI);
}
