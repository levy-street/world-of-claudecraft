# Chaff overlap regression

These isolated browser captures use the actual `ScarecrowFx` and
`PaladinConsecrationVisuals` painters on flat ground, with a three-yard Chaff
patch overlapping a four-yard Consecration. They are painter comparisons,
not screenshots of a live encounter or a physical mobile device.

The before frames restore both Chaff meshes to their previous render order
of zero. The after frames use the encounter band, with the fill at 20 and
glow at 21. The camera, effects and elapsed time are identical within each
pair. Consecration's bright lines now sit beneath the purple hazard.

- [Desktop before](ci-chaff-overlap-desktop-before.png)
- [Desktop after](ci-chaff-overlap-desktop-after.png)
- [Mobile viewport before](ci-chaff-overlap-mobile-before.png)
- [Mobile viewport after](ci-chaff-overlap-mobile-after.png)

`tests/seasonal_floor_vfx.test.ts` pins the actual mesh ordering and neutral
ancestor groups, and checks the toy floor decoration band separately.
