# v0.36 release art audit: Reliquary deeds

Status: accepted

This document and its sibling JSON records preserve the durable lineage for the nine Reliquary
deed crests discovered by the release-wide art audit after the 2026-08-09 placeholder completion
wave. The crests close the remaining live `DEED_ART_PENDING` entries without rewriting any
historical accepted-art manifest.

## Records

- `reliquary-deed-art.generation.json` preserves every exact built-in image-generation prompt,
  ordered repository reference, reference role and hash, original generated-output path, and
  retry decision.
- `reliquary-deed-art.processing.json` preserves the raw, chroma-keyed, normalized 512px source, and
  shipping WebP hashes, byte counts, dimensions, alpha geometry, deterministic processing
  settings, and accepted small-size review evidence.
- `reliquary-deed-art.accepted.json` is the current shipping acceptance manifest. It pins every
  new runtime file to its exact byte count, SHA-256 hash, 128px transparent-subject contract,
  bounds, and visible-pixel count.

The high-resolution generated outputs and normalized intake sources remain in the ignored
workspace under `tmp/imagegen/release-art-audit-v036/deeds/`. Absolute paths under
`/Users/fernando/.codex/generated_images/` are generation-time evidence only, never runtime
dependencies. Shipping assets live under `public/ui/deeds/` and are served through the generated
`DEED_IMAGE_IDS` registry.

## Processing and review

Each accepted output used the image-generation skill's flat-magenta workflow. The installed
chroma helper removed the generated `#ff00ff` exterior with a soft matte and despill. The visible
alpha bounds were cropped at threshold 8, fitted inside 430px, and centered on a transparent
512px canvas. `scripts/convert_deed_icons_webp.mjs` then validated the source geometry and encoded
the complete canvas to 128px WebP.

The complete set was reviewed together at normalized source size, 128px shipping size, 40px UI
size, and 24px grayscale. The accepted sheets, their hashes, and the visual checklist are pinned
in `reliquary-deed-art.processing.json`. Focused tests verify the manifest structure, exact
bytes, alpha geometry, live registry reachability, empty art-debt ledger, provenance
completeness, and guide freshness.
