# Live combat animation check

> Record of an earlier state of this branch (see the note at the top of
> [the parent page](../README.md)): file names, counts and `tmp/` driver paths below
> describe that state, not the shipped tree.

`node tmp/combat_live_matrix.mjs` opened a fresh offline game after the final
Vite restart and exercised the production renderer on all nine classes and both
body fits. Every melee action advanced in real GPU frames with positive mixer
weight. Hunter selected `1H_Chop` for melee and `Ranged_Shoot` for a ranged ability;
no page errors occurred. [The matrix](live-matrix.json) retains exact clip names,
times and weights.

[Hunter melee frame](hunter-melee.png) and [Hunter ranged frame](hunter-ranged.png)
were inspected. The same equipped weapon remains visible in both, as requested;
weapon display changes are deferred. These frames verify live playback through
renderer dispatch. Real simulation range selection, primary ability events and
secondary damage filtering are covered by the regression tests in the parent
[QA report](../README.md); these captures do not claim a complete manual combat
playthrough of every ability or specialization.
