# Nythraxis Soul Rend marker: the colour-free stacked channel

Captured on 7 September 2026 with the `nythraxis-hazards` target in
`scripts/pr_shot_targets.mjs`.

| Capture | Source |
| --- | --- |
| Before | PR head `1a971c5527` (the release sync) |
| After | The review-fix working tree on top of it |

Both legs use the same staged offline Heroic raid, LOW graphics preset and camera
as `docs/screenshots/nythraxis-playtest-tuning`. Desktop is 1600x900. Mobile
emulates an 844x390 touch viewport at 2x resolution. The `*-markers.png` pair is
the same desktop frame cropped to the three Soul Rend marks (x 500 to 1100,
y 240 to 400) and enlarged 2x, because the whole-frame shots hold the markers
at a size where the second ring is hard to read.

What changed: a stacked Soul Rend mark (the two green markers left of the boss)
now draws an inner concentric ring in addition to its green hue, so one ring
means move and two rings mean stay for a player who cannot separate red from
green. The solo mark (the red marker right of the boss) keeps its single ring.
Nothing else in the frame is part of this change; the purple hazards and the
blue sigil are the earlier playtest tuning.

The mobile legs came from the shared runner (`scripts/pr_screenshots.mjs`) with
a diff limited to `src/render/nythraxis_soul_rend_marker.ts`. The desktop legs
came from a scratch wrapper around the same shipping target and
`enterOfflineGame` helper that waits for `domcontentloaded` instead of network
idleness (the runner's desktop navigation times out against a local dev server
with no API behind it, the trap the earlier capture notes record). The wrapper
changed no game sources and was removed after capture.
