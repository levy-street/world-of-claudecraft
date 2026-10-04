// Icon art for the Graveyard Shift's mode-local kit, borrowed from shipped
// abilities until the kit gets its own. The kit is never in ABILITIES, so
// icons.ts asks this table before it falls back to a procedural guess, and every
// surface that draws an ability icon (the action bar, the touch ring, the cross
// hotbar, the cast bar, the combat log) shows the same art. Pure data.

const KIT_ICON_IDS: Readonly<Record<string, string>> = {
  gshift_sextons_chain: 'oath_chain',
  gshift_shadow_pulse: 'psychic_scream',
  gshift_raise_fallen: 'raise_skeletal_warrior',
};

/** The ability id whose art an ability icon shows: the borrowed one for a kit id. */
export function graveyardShiftIconId(abilityId: string): string {
  return KIT_ICON_IDS[abilityId] ?? abilityId;
}
