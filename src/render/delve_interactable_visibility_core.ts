/** Whether a delve interactable should remain visible independently of range culling.
 * Stateful `delve_*` and `rift_*` props stay in the entity set after use so their
 * consumed visual variant remains readable. Props that should disappear must be
 * removed by the sim, not hidden by changing only their generic lootable flag. */
export function delveInteractableVisible(templateId: string | null, lootable: boolean): boolean {
  return (
    lootable ||
    templateId?.startsWith('delve_') === true ||
    templateId?.startsWith('rift_') === true
  );
}
