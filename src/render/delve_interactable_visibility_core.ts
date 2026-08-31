/** Whether a delve interactable should remain visible independently of range culling.
 * Stateful `delve_*` and `rift_*` props stay in the entity set after use so their
 * consumed visual variant remains readable. Props that should disappear must be
 * removed by the sim, not hidden by changing only their generic lootable flag.
 *
 * `bg_*` (the Thornhollow Fields flag and rune props) rides the same rule for a
 * different reason: they are deliberately `lootable: false` for their whole
 * lifetime (bg_flag_interact.ts; they are claimed by their own proximity
 * mechanics, never the generic pickUpObject scan), and a carried flag's
 * position is actionable info that must stay visible on every tier
 * (battleground_props.ts). Without this arm, an always-non-lootable `bg_`
 * prop would read as invisible through this same `syncDelveInteractableVisibility`
 * gate, which every 'object'-kind entity view runs through, not just delves. */
export function delveInteractableVisible(templateId: string | null, lootable: boolean): boolean {
  return (
    lootable ||
    templateId?.startsWith('delve_') === true ||
    templateId?.startsWith('rift_') === true ||
    templateId?.startsWith('bg_') === true
  );
}
