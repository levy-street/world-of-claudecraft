# v0.36 skill icon shipping normalization

This directory is the immutable supersession record for the skill paintings named by
`accepted-art.json`. Those paintings were already approved and wired, but their shipping
WebPs retained master-scale dimensions that did not match the declared runtime contract.

## Processing ruling

No painting was regenerated, cropped, reframed, recolored, or compositionally edited. Each
captured WebP was decoded to a lossless PNG and passed through
`scripts/convert_skill_icons_webp.mjs`, the canonical `npm run assets:skills` path. The
converter centered the square input at the runtime size, normalized it to sRGB, and encoded
the shipping WebP with its checked-in quality and byte-budget settings.

## Provenance and ownership

The per-class `mapping.json` entry remains the sole owner of each painting's source,
authorship, and license. This record does not reclassify owner-provided, licensed, or
project-generated art. It records only the mechanical shipping transform, the former
shipping hash and dimensions, and the accepted replacement hash. Historical records were
not rewritten. A complete literal-hash scan at the captured release commit found no earlier
tracked hash pins that required a supersession link beyond this new record.

## Review and verification

The committed [128px comparison] shows the former shipping art on the left and normalized
shipping art on the right. The committed [compact comparison] uses the same left/right layout
at 40px and 28px. Ignored QA evidence under
`tmp/release-art-audit-v036/skill-normalization/` retains the captured sources, converted
outputs, per-icon measurements, and lossless comparison sheets. Review confirmed unchanged
subject identity, framing, palette, border treatment, and small-size readability.

[128px comparison]: ../../screenshots/release-v036-skill-normalization-2026-08-10/skill-icons-before-after-128.webp
[compact comparison]: ../../screenshots/release-v036-skill-normalization-2026-08-10/skill-icons-before-after-compact.webp

Run `node scripts/icon_asset_audit.mjs` against `accepted-art.json` for exact hash,
dimension, byte-budget, opacity, duplicate, and contact-sheet checks.
`tests/skill_icons.test.ts` independently enforces the registered catalog-wide shipping
contract and the supersession pins in this record.
