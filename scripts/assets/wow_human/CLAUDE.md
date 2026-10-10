# WoW human animation import

Offline animation-only import. `download.py` verifies the Workshop archive hashes
before extracting model data. Never run addon Lua or import donor meshes into the
game. `decode.py` uses the pinned SourceIO revision; Blender supplies its Python
and numpy runtime. `retarget.mjs` owns bone mapping and coordinate conversion.
`build.mjs` writes meshless libraries over the existing WOC bind poses.

The source bind pose and animation frames differ by a quarter turn. Keep the
separate bind and animation coordinate conversions. Male and female bone ids
differ. Preserve target limb lengths, handslot transforms, and root position.

The Workshop packs have no combat or spellcasting library. Do not replace those
WOC clips or their measured contact times with unrelated source gestures.
Runtime mapping lives in `src/render/characters/woc_wow_animations.ts`.
Tests: `tests/woc_wow_animations.test.mjs` and the existing character clip and
entry-preload contracts. See README.md here for reproduction and provenance.
