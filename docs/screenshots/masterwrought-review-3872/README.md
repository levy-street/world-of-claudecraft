# Masterwrought review fixes

Before: PR #3872 at `9694bfc9d18a16a6c43f8f760533e976add9ac8e`.
After: the review fixes accompanying these images. Captured on 2026-09-04
with the same production UI/renderer fixtures through `scripts/pr_screenshots.mjs`.
Both clients seed graphics preset 1 before boot. Desktop is 1600×900; mobile
is landscape 844×390 at device scale 2.

| Scenario | Before | After |
| --- | --- | --- |
| Perfecting owner close, desktop | [Before](before-perfecting-dismissal-desktop.png) | [After](after-perfecting-dismissal-desktop.png) |
| Perfecting owner close, mobile | [Before](before-perfecting-dismissal-mobile.png) | [After](after-perfecting-dismissal-mobile.png) |
| Raised dungeon feast, desktop | [Before](before-feast-dungeon-floor-desktop.png) | [After](after-feast-dungeon-floor-desktop.png) |
| Raised dungeon feast, mobile | [Before](before-feast-dungeon-floor-mobile.png) | [After](after-feast-dungeon-floor-mobile.png) |

Perfecting stages an eligible Duskforged Warblade, opens its bind confirmation
with a real button click, then calls the owning window's production `close()`.
The baseline leaves one orphan confirmation visible; the fix leaves zero.
The owner is hidden and no longer inert in both cases.

The feast fixture places a Harvest Feast on Dawnhold's raised gallery rug,
clears hostile fixture entities, and uses matching player/camera coordinates.
The entity's authoritative height is 3. Before, the renderer places the table
at terrain height 47.57348822871841, outside the room; after, it places it at 3.
Both runs confirm the shipped GLB's 1,968 vertices, rather than the fallback box.
The table is partly behind the player in the after images but its food-covered
top is visible. The existing art needs no regeneration.

To reproduce, serve the unchanged baseline and the fixes in separate worktrees.
Use a diff containing `scripts/lib/pr_shot_masterwrought.mjs` to select the two
regression targets, then run the same command against each URL:

```sh
GAME_URL=http://127.0.0.1:5183 SHOTS_DIR=/tmp/masterwrought-after \
  DIFF_FILE=/tmp/masterwrought-shots.diff NAV_TIMEOUT_MS=120000 \
  node scripts/pr_screenshots.mjs
```

These are offline development captures. Missing local API requests report 502s,
and both revisions report unrelated character-preload warnings. Transient
celebration banners or world animation can differ between frames; the images
show the stated UI and placement behavior, not a pixel-perfect or GPU-budget
comparison. The feast model itself loaded in both revisions.
