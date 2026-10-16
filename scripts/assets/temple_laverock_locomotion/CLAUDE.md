# Laverock locomotion bank

This is offline authoring, not a renderer or simulation system. See README.md
for provenance and the rebuild command.

- The shipped body GLB remains the authority for the skeleton and visual bounds.
- The Python support files preserve Laverock's original IK, warp and clearance.
  Never substitute another character's skeleton or authored rest translations.
- New motion belongs in bake.py; export.mjs refuses a rest-transform mismatch.
- measure.mjs evaluates FK and skinned Idle normalization from shipping GLBs.
- Re-export after a fingerprinted source or lock change, then update the byte pin
  in tests/drowned_temple_cantor_locomotion_asset.test.ts and regenerate media.
- Keep the existing guide movement, follow and finale acceptance tests intact.
