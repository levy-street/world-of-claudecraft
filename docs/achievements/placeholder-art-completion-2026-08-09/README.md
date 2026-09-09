# v0.36 placeholder art completion lineage

This directory is the tracked historical provenance record for the 2026-08-09
placeholder-art completion wave based on `release/v0.36.0`. It records the exact
image-generation prompts, ordered reference lists, accepted and rejected outputs,
master and shipping paths, hashes, byte counts, processing settings, retry decisions,
and visual-review evidence that existed in the ignored generation workspace.

The records currently cover:

- `deeds-a-generation-report.md`: 15 transparent deed medallions, including chroma-key,
  matte-restoration, normalization, shipping, and readability details.
- `deeds-b-generation-record.json`: 15 Chronicle and PvP-honor deed medallions, with exact
  prompts, generated sources, alpha geometry, hashes, and small-size review evidence.
- `weapons-a-generation-record.json`: the first 40 authored weapon paintings in sorted live-id
  order (indices 0-39).
- `weapons-b-generation-record.json`: the next 40 authored weapon paintings (indices 40-79).
- `weapons-c-generation-record.md`: 20 authored weapon paintings (indices 80-99).
- `weapons-d-generation-record.json`: the final 19 authored weapon paintings (indices 100-118),
  including the accepted Wildheart Tuskblade and Tunnelking's Spade refinements.
- `specialization-generation-record.md`: 21 generated dedicated specialization icons,
  the accepted Shaman restoration retry, and the lossless source-to-WebP provenance for
  the three existing Mage specialization paintings.
- `crest-generation-record.md`: 13 creature-family crests and four status crests.
- `item-cleanup-manifest.json`: Firebottle plus the Sharp Claw, Curved Tusk, and
  Pristine Claw replacements.
- `portrait-rerender-evidence.json`: 18 deterministic mob portraits corrected after their
  manifest models changed, including before/after hashes and exact renderer inputs.
- `mob-portrait-source-manifest.json`: a generated 230-portrait ledger binding every output
  to the shared live render job, model, attachment, tint, transitive renderer fingerprint,
  and renderer-issued acceptance receipt when an input or output changes.
- `portrait-manifest-bootstrap-review.md`: the one-time all-230 current-render comparison and
  visual adjudication that established the receipt-gated manifest baseline.
- `accepted-art.json`: the machine-checked acceptance manifest pinning every changed or reused
  shipping file in this completion wave to its runtime URL, byte count, and SHA-256 hash.

## Reference and ownership scope

The prompts and generated outputs are project-specific artifacts from this completion
wave. Every input reference listed in these records was supplied from a checked-in
repository path at generation time. Depending on the batch, those images served only
as frame, finish, palette, material, class-language, subject-semantic, small-size
readability, or explicit anti-reference guidance. The exact prompts retain those roles
and repeatedly direct the model not to copy an existing subject or composition.

A repository path does not by itself establish first-party authorship or ownership of
the referenced image. Some checked-in references may be licensed third-party material;
this record does not reclassify them or make an ownership claim. It documents their
limited generation-time reference role and preserves the original path spelling so the
lineage can be audited against the repository and its licensing records.

## Record fidelity

The nine image-generation batch records were copied byte for byte from
`tmp/imagegen/placeholder-art-completion/`; only their destination filenames changed. The
portrait record comes byte for byte from `tmp/portrait-rerender/evidence.json`.
The all-portrait source manifest is deterministically checked with
`node scripts/build_mob_portrait_source_manifest.mjs --check`. `--check` still hard-fails on
any change to a portrait row, a tracked renderer source file, the schema, or the portrait
count; it tolerates only a renderer-bundle-digest move with everything else proven
byte-identical (`isBundleOnlyDrift` in the script), since that bundle's import graph reaches
unrelated gameplay/render modules and moving on its own means no image byte changed. After a
real source or output change, the real renderer must run with `PORTRAIT_RECEIPT=<path>` and
that receipt must be passed to
`node scripts/build_mob_portrait_source_manifest.mjs --write --receipt <path>`.
The renderer and ledger share `scripts/lib/mob_portrait_jobs.mjs`; partial, stale, or
mismatched receipts are rejected, and a renderer-contract change requires every live row.
The 2026-09-09 Asmon release merge rendered all 248 live portraits, including
Asmon, the Royal Roachling, and the Tribute Beetle. The accepted release baseline
used Linux x64, Chrome 152.0.7977.82, and SwiftShader Subzero; this refresh used
macOS arm64, Chrome 152.0.7977.83, and SwiftShader LLVM 10.0.0. The real renderer
receipt was written to `tmp/roach-pr-portrait-receipt.json` and copied byte for byte
to `docs/screenshots/roach-king/portrait-remint/renderer-receipt.json`.
The guarded source-ledger write accepted that full receipt. The environment change
moved the output bytes of 148 existing portraits with unchanged per-row render
inputs. The before/after sheet and pixel statistics in that evidence directory
record the visual review: seven of the eighteen historical portrait pins changed,
with framing, subjects, and tints preserved. The water elemental's larger shading
difference has its own before/after pair. Both reviewers accepted these outputs;
the seven fixture hashes, seven supplemental-art pins, and enclosing source-ledger
hash now record the actual rendered bytes. Every source and image guard remains
in place.
Absolute paths into `/Users/fernando/.codex/generated_images/` and the worktree are
generation-time evidence, not runtime dependencies. High-resolution masters and review
sheets remain in the ignored workspace, while accepted shipping assets live under
`public/ui/` at the paths and hashes captured in each record. Release-baseline and final
desktop/mobile runtime comparisons, plus labeled before/after sheets for all 18 portrait
corrections, are tracked under
`docs/screenshots/placeholder-art-completion-2026-08-09/`.
