# Voidbound tome source provenance

`voidbound_grimoire.svg` is retained because its exact path and bytes are an
input to the deterministic inscription-tome source fingerprint. The exporter,
model specification, fingerprint helper, lockfile, and source SVG together pin
`public/models/weapons/tome_voidbound.glb`.

The SVG was authored in-repo and has no third-party source. The superseded item
icon that once came from it has been replaced by the accepted painted WebP; the
other Phase 09 placeholder SVGs and their rasterizer were removed. Do not move
or edit this source without re-exporting, optimizing, reviewing, and re-pinning
all affected tome assets through `scripts/assets/inscription_tomes/`.
