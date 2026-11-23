# CC Studio snapshot, 2026-09-10: the released v0.42.0 merged in

This snapshot carries the full upstream v0.42.0 release (the tag, not the
September 2 candidate) merged into the Studio and Deepglass build, plus the
Tidehold Castle B rounds (solid boolean-cut walls, baked spires and shingle
roofs, wall walks, three storeys, the L stair, baked AO and PBR floors) and
SPACEY's republished Deepglass map (1,239 placements, painted ground).

What to know when testing:

- Type check: 131 errors versus 149 before the merge, no file with a new error.
- Test suite: 283 red of 62,887 versus 449 before; the one red that is new is
  an upstream dungeon seed sweep that exceeds its own 60 second timeout (sim
  cost measured identical on both trees).
- Studio, the overworld and the arena boot clean; the render A/B against the
  pre-merge build pins at 60 fps in all three with matching frame times.
- Upstream's knockback clearance fix is ported into the fork's shove; the
  gamepad dispatches the Deepball ball marker; boost and ball marker rows
  localize; the crowd roar residue is gone.
- The Tidehold reagent stall still sells silverleaf and goldleaf; upstream's
  new gathering rules are scoped to skip it in tests.
- Em dashes in the Scorching Wastes, Tidehold and Deepglass NPC lines became
  commas for upstream's wiki seed rule; Studio UI text is untouched.
- This repo formats with biome. Never run prettier here.

Full decision log and the perf table: docs/studio/history/MERGE-v0.42-STATUS.md, Part 2.
