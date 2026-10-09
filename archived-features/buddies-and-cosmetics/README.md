# Archived buddies and buddy cosmetics

This folder preserves the removed buddy content and alternate-look feature for
later integration. It is outside `public`, `src` and `tests`, so its assets and
source snapshots do not ship or execute. Only Horse, Crystal Lich and Forgemaw
remain in the live buddy catalog. Character outfits, appearances, combat pets
and other cosmetic systems are outside this removal.

## Contents

- `assets/`: the retired models and icon copies, under their original relative
  paths. `asset-inventory.json` records every path, byte size, SHA-256 and whether
  it was moved or copied. Dedicated retired buddy GLBs were moved out of the
  shipped public tree. Shared creature models and historical inventory icons
  were copied; their live copies are still needed by other mobs or old items.
- `retired-buddies.json`: every retired buddy key, including Sapling and Penny.
- `before-this-removal/`: exact source, test, tooling and documentation snapshots
  from immediately before this request. This was the four-buddy roster with
  Sapling and working alternate looks. Text files have an extra `.txt` extension
  to keep them out of compilation, test discovery and script execution.
- `restore-before-this-removal.patch`: reverses this request's text changes,
  including removed modules and tests. It does not reverse the earlier pruning
  to four buddies. It must be applied together with the moved assets.
- `original-full-roster/`: original definitions and integration context from
  commit `f181fb79f78d07b3c0fa3057a0d77cb33c60a9a1`, before the earlier buddy
  pruning. Use these snapshots to restore any of the other retired buddies.
  These are reference files, not a drop-in overlay for a future codebase.
- `reference/`: original asset credits and item-icon provenance mapping.

## Restore Sapling and the alternate-look feature

Work on a separate branch/worktree and preserve current edits first. From the
repository root, check the patch without changing files:

```powershell
git apply --check archived-features/buddies-and-cosmetics/restore-before-this-removal.patch
```

If the check passes, apply the patch with `git apply` using the same path. If it
fails, the surrounding code has changed: compare the snapshots and merge the
feature into the current seams rather than overwriting whole files.

Copy assets marked `moved` in `asset-inventory.json` back from `assets/<path>` to
`<path>`. Do not overwrite shared assets marked `copied-shared-model` or inventory
icons marked `copied-for-legacy-inventories` without comparing their hashes.
Regenerate media, wiki and localization artifacts with the owning scripts, then
run the buddy/collections/wire/save tests, types and the repository QA gate.

## Restore other retired buddies

Start with the original full-roster catalog and templates, then the render
manifest mappings (heights, clips and tint policies), acquisition tables and
inventory definitions. Restore the selected buddy's model at its original path.
The source snapshots include source tables, sim/UI/wire integration and tests
for context; integrate relevant records rather than replacing unrelated code.
Shared models remain active in the game and also have an archive copy. Sapling
uses its own authored atlas and distinct Run clip; retain those manifest facts
when restoring it. Historical item IDs and localization keys remain defined in
the live tree for old inventories and translations.

## Character saves and queued grants

This is a **code and asset archive, not a character-data backup**. The active
loader drops retired buddy ownership, pending rewards and last selection, plus
all old buddy cosmetic unlocks/equipped looks. A later save persists that reduced
collection. Restoring the source cannot reconstruct those discarded unlocks;
keep an original character save separately if that matters for restoration.

The existing server queue drain also consumes queued retired buddy/cosmetic
grants on login and rejects them without applying them. A cosmetic-only queue
can disappear without a character save. Restoring source/assets does not recover
those queue records. No database schema or query was changed by this removal.

Old whistle/charm inventory entries remain readable and cannot unlock retired
content or be consumed through its removed actions. Protocol `buddy_cosmetic`
remains a no-op for older clients; new clients have no cosmetic command or state.

Acquisition and local test commands for the retained buddies are documented in
`docs/design/buddy-acquisition.md` at the repository root.

## Recovered original PR history

`recovered-pr-3737/` preserves The Mummy and the late Buddy bag source changes
from PoorInfz's original PR #3737. These remain inactive; all original commits
are also retained in this branch's Git ancestry. See that folder for provenance.
