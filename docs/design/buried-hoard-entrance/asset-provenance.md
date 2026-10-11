# Buried Hoard entrance asset

Original procedural stylized prop authored for this repository from the user brief on
2026-09-19. No image reference, external model, texture, generated concept, or paid API
was used. Image reference admission and reference-fidelity scoring are inapplicable;
this is original design, not a reference reconstruction.

The durable sculpt specification is `HOARD_ENTRANCE_CONTRACT` in
`scripts/assets/hoard_entrance/model.js`. The preselected budget is 4,500 target
triangles, 6,000 hard maximum, 96 KiB shipping bytes, five primitives and four materials.
The pit, fresh clumpy earth, roots, stones, plank hatch, metal straps, rivets, shovel
and descending ladder define its identity. Vertex colors carry painted tonal variation.
The dark opening is a shallow occluding cap; runtime terrain seating and the earth
skirt conceal its seam without modifying world terrain.

`HatchAssembly` preserves a local hinge for the reveal animation. The
`HoardRarityMetalwork` material is the runtime tint target. Four named sockets pin
interaction, opening, light and motes. Lighting and particles remain runtime effects.

The exporter follows the mailbox archetype: browser GLTFExporter, fingerprint stamping,
shared static optimization, meshopt compression, a second byte-identical optimization,
structural validation and raw/shipping multi-angle previews. There are no textures,
so KTX2 conversion has no asset input. Preview evidence is under
`tmp/hoard_entrance_preview`; in-game evidence is committed separately under
`docs/screenshots/buried-hoard-entrance`.
