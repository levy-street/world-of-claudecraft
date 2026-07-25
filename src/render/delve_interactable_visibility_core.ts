/** Whether a delve interactable should remain visible independently of range culling.
 * Stateful `delve_*` and `rift_*` props stay in the entity set after use so their
 * consumed visual variant remains readable. The Source Cave's room furniture
 * (`source_cave_*`: the centre button, the reward chest and its sealed variant)
 * follows the same rule, and the dungeon door/exit portals stay visible while
 * non-lootable too: the cave's encounter seals its exit by dropping lootable, and a
 * vanished portal read as a bug (it carries the ACCESS DENIED plate instead).
 * Props that should disappear must be
 * removed by the sim, not hidden by changing only their generic lootable flag. */
export function delveInteractableVisible(templateId: string | null, lootable: boolean): boolean {
  return (
    lootable ||
    templateId?.startsWith('delve_') === true ||
    templateId?.startsWith('rift_') === true ||
    templateId?.startsWith('source_cave_') === true ||
    templateId === 'dungeon_door' ||
    templateId === 'dungeon_exit'
  );
}
