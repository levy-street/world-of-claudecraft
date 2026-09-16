# Nythraxis v0.42.2: the Bone Spike recolour

Captured on 11 September 2026 with the `nythraxis-bone-spike` target in
`scripts/pr_shot_targets.mjs` (added by the same PR).

| Capture | Source |
| --- | --- |
| Before | `release/v0.42.2` render files (`src/render/characters/manifest.ts`, `assets.ts`) swapped in over the branch |
| After | PR head (ember-orange tint, full strength, plus the tinted self-illumination lift) |

Both legs use the same live offline Heroic practice raid, the LOWEST graphics
preset (the standing capture rule) and the same camera. Desktop is 1600x900.
Mobile emulates an 844x390 touch viewport at 2x resolution.

The target pulls the practice raid with an invulnerable bot holding aggro, lines
the other bots up 14 yd in front of the dais, pokes one real Bone Spike cast
(`/dev nyx spike`, three victims on Heroic), then freezes the tick so the
spikes and the impaled poses survive to the shot. The spikes are the real cast's
entities at the victims' feet, not staged readouts.

What the images show: before, the authored bone-and-flagstone spike reads as
the boss (a bone golem) and as the bone props on the floor; after, the three
spikes are red-orange, the one hue nothing else in the hall uses. The lowest
preset is the Lambert tier, so these frames show the tint alone; on the standard
tiers the same spikes also glow (the tinted lift), which these images do not
measure. They do not measure balance, the cooldown, or the Soulfire retirement.

To select this target with the shared screenshot runner, run a local dev server
and prepare a diff that names the spike GLB (or any Bone Spike source path):

```sh
printf 'diff --git a/public/models/props/nythraxis_bone_spike.glb b/public/models/props/nythraxis_bone_spike.glb\n--- a/public/models/props/nythraxis_bone_spike.glb\n+++ b/public/models/props/nythraxis_bone_spike.glb\n' > /tmp/spike.diff
GAME_URL=http://localhost:5173 DIFF_FILE=/tmp/spike.diff SHOTS_DIR=/tmp/spike-shots node scripts/pr_screenshots.mjs
```

# Second batch: ward spikes and the sigil beside the boss

`before-sigil-side-ward-*.png` / `after-sigil-side-ward-*.png`, captured the
same day with the `nythraxis-sigil-side` target (added by the second PR).

| Capture | Source |
| --- | --- |
| Before | The branch worktree detached at the first PR's head `48468cee18` (its own dev server), with the second PR's target script copied over so the same rig drives both legs |
| After | Second PR head |

Same live offline Normal practice raid, lowest preset, same camera. The rig
pulls the raid with a bot holding aggro, pokes one Bone Spike wave and one
Binding Sigil, freezes the tick, and has the tester target a spike so the target
frame shows its pool.

What the images show: before, the target frame reads `1000 / 1000` (the spike's
health pool) and the sigil sits wherever its hash spot fell (here far back near
the wall to the raid's right); after, the target frame reads `4 / 4` (the ward's
hit count on Normal) and the sigil flares on the flanking platform 30 yd to the
raid's right of the spawn (world -x, which is the screen's right looking up the
hall), the crypt's raised dais reused on both sides of the throne. The images do
not measure the click capsule (a picking radius, not a drawn thing), the hit rule
itself, or the Gravefire retirement (an absence).

```sh
printf 'diff --git a/src/sim/nythraxis_binding_sigil.ts b/src/sim/nythraxis_binding_sigil.ts\n--- a/src/sim/nythraxis_binding_sigil.ts\n+++ b/src/sim/nythraxis_binding_sigil.ts\n' > /tmp/sigil.diff
GAME_URL=http://localhost:5173 DIFF_FILE=/tmp/sigil.diff SHOTS_DIR=/tmp/sigil-shots node scripts/pr_screenshots.mjs
```
