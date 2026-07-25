// Pure view core for the spell-activation proc overlay (the WoW-style curved
// "proc arcs" beside the character, owner request 2026-07-11): maps the
// player's worn auras to the overlay state. Heating Up (the first fire crit)
// shows the soft arcs; Hot Streak (the armed free instant) burns them bright;
// spending or losing the proc hides them. No DOM, no i18n: the thin
// proc_overlay_painter turns this state into two toggled classes.

export type ProcOverlayState = 'none' | 'heating' | 'hot';

export function procOverlayState(auras: ReadonlyArray<{ id: string }>): ProcOverlayState {
  let heating = false;
  for (const a of auras) {
    if (a.id === 'hot_streak') return 'hot';
    if (a.id === 'heating_up') heating = true;
  }
  return heating ? 'heating' : 'none';
}

export function combustionOverlayActive(auras: ReadonlyArray<{ id: string }>): boolean {
  return auras.some((a) => a.id === 'combustion');
}

// Chronomancy (arcane spec) drives the SAME phoenix overlay from its Aether
// Surge charges instead of fire's two auras: one quarter of the bird lights per
// held charge (0-4), so the player reads the charge count from the bird instead
// of a buff. Aether Darts spends the charges (aura gone) -> 0 -> the bird fades.
// The charge count lives in the caster's `arcane_surge` aura value (1-4).
export function chronoOverlayCharges(auras: ReadonlyArray<{ id: string; value?: number }>): number {
  for (const a of auras) {
    if (a.id === 'arcane_surge') return Math.max(0, Math.min(4, Math.round(a.value ?? 0)));
  }
  return 0;
}

// Frost uses the phoenix as a five-part Icicle bank for Glacial Spike. The
// server omits an aura's `stacks` field when it equals one, so a present
// `icicles` aura with no mirrored count is deliberately read as the first
// stack. The view clamps defensive wire input without owning any gameplay.
export function frostOverlayCharges(auras: ReadonlyArray<{ id: string; stacks?: number }>): number {
  for (const aura of auras) {
    if (aura.id !== 'icicles') continue;
    return Math.max(0, Math.min(5, Math.round(aura.stacks ?? 1)));
  }
  return 0;
}
