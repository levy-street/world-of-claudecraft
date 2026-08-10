# Item Art Consistency, 2026-08-09

Status: accepted

This directory is the durable provenance record for the
`item-art-consistency-2026-08-09` replacement batch. The batch repainted 274 live item icons
under item-icon contract `woc-item-icon-v1` without rewriting the records of the art they
superseded.

## Scope

| Previous live source | Paintings |
| --- | ---: |
| Licensed CraftPix source-pack icons used as subject-identity references | 255 |
| Project-owned mount renders used as subject-identity references | 9 |
| Earlier project-generated paintings repainted for readability and consistency | 10 |
| Total replacements | 274 |

The replacement paintings are project-generated World of ClaudeCraft art. Reference use does not
transfer or reclassify authorship. The CraftPix inputs retain their historical premium-license
lineage, the mount models retain their existing project and model-pipeline credits, and the ten
earlier generated paintings retain their original accepted-art records.

## Evidence

- `accepted-art.json` is the current shipping manifest. It pins every replacement hash and byte
  count, the current batch, its generation report, and the explicit old owner, hash, byte count,
  and replacement reason.
- `supersession-audit.json` is the byte-identical 272-item pre-task ownership and shipping audit
  made from the fixed baseline commit recorded inside that file. `accepted-art.json` carries two
  explicit audit addenda for `starfall_shard` and `hollow_vigil_staff`, which the final global
  review added to the batch.
- The nine `chunk-*-generation-report.json` files are byte-identical copies of the reviewed
  machine reports for A, B, C, D, E, F-main, F-tail, G, and H. Together they enumerate every
  accepted prompt, ordered reference role, original result, normalized master, shipping encode,
  retry, rejection, and QA decision for the batch.
- `final-item-art-audit-verdict.json` is the byte-identical final whole-catalog verdict. It records
  the successful visual and machine review of all 817 shipping item paintings across 208 review
  sheets, including the exact 274-file replacement scope, Heroic resolver accounting, resolved
  retries, 22-pixel color review, renderer-contract fingerprint, shipping-catalog digest, sheet-set
  digest, and zero visual watch or rejection results.
- The [screenshot evidence manifest](../../screenshots/item-art-consistency-2026-08-09/manifest.json)
  pins the exact 28 before/after PNGs across desktop and mobile-landscape Bags, Bank, merchant,
  Equipment, Tooltip, Mail, and item action-slot consumers, including every file's SHA-256, byte
  count, and native dimensions.

From the repository root, rebuild the ignored machine catalog and all eight review modes with:

```sh
node scripts/item_art_audit.mjs
```

For a fresh-checkout guard that validates all 817 live files, mapping ownership, Heroic aliases,
machine constraints, and the exact 208-sheet plan without writing the ignored catalog or sheets,
run `node scripts/item_art_audit.mjs --verify-only`.

After a human has reviewed every generated sheet, refresh the tracked verdict's reproducible
evidence with `node scripts/item_art_audit.mjs --refresh-verdict`. That guarded form refuses to
carry the existing visual pass across changed shipping bytes, preserves the manual verdict, and
writes the same refreshed verdict to the ignored audit workspace.

The ignored high-resolution generation workspace remains under
`tmp/imagegen/item-art-consistency/`. It is useful working evidence but is not required at runtime.
The 448,700-byte machine catalog and review sheets remain there rather than duplicating hundreds
of megabytes into Git. The tracked final verdict pins the catalog hash and byte count, every sheet
hash and byte count, and the aggregate shipping and sheet-set digests needed to audit that
workspace.

## Historical supersession

The following historical manifests remain byte-for-byte unchanged:

- `docs/achievements/missing-painted-icons-accepted-art.json`
- `docs/achievements/placeholder-art-completion-2026-08-09/accepted-art.json`

Their accepted hashes describe what those earlier programs shipped at the time. Tests resolve a
historical item to current bytes only when `accepted-art.json` contains a matching supersession
record whose previous hash and byte count agree with that immutable historical record. The new
hash must then agree with both the current item file and this batch's generation report.

Current provenance ownership lives only in `public/ui/items/mapping.json`. Each of these 274 IDs
was removed from its prior current owner and appears exactly once in the
`item-art-consistency-2026-08-09` generated batch.
