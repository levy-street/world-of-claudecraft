---
name: image-to-glb
description: Turn a reference image into a shipping World of ClaudeCraft GLB using the img2threejs intake gates and this repo's deterministic export, optimize, fingerprint, and test pipeline. Use when asked to create, replace, or rebuild a world asset (prop, furniture, building, landmark, stall, service object) from a concept or reference image, to add a procedural GLB under public/models, or to re-export or re-pin an existing eastbrook-style asset.
user-invocable: true
---

# Image to shipping GLB

You are producing a stylized, game-ready, texture-free GLB from a reference image, the way
the banker chest, the Eastbrook Grand Armoury, the nine-building Eastbrook town kit, the
Ravenpost mailbox, and the noticeboard were produced. The deep runbook is
`docs/image-to-glb-asset-workflow.md`; this skill is the operating procedure. Read
`scripts/assets/CLAUDE.md` before touching the pipeline.

Scope check first: this path fits static, stylized world objects. Characters, deforming
meshes, and animation-heavy content need rigging and a different performance contract; say
so instead of forcing them through this pipeline.

## Tooling

The `img2threejs` skill (version pinned by the runbook) drives the intake and review gates.
Claude Code sessions install it at `~/.claude/skills/img2threejs`, Codex sessions at
`~/.codex/skills/img2threejs` (`git clone https://github.com/hoainho/img2threejs` into that
path). It is an authoring aid only, never a build dependency: the committed factory,
exporter, spec, tests, and optimized GLB stay the reproducible source of truth.

## The pipeline, in order

1. **Admit the reference.** Confirm rights and provenance before anything else. AI-generated
   references record their full lineage (prompt, inputs, output hash, accept/reject
   rationale) following `docs/design/eastbrook-vale-rebuild/imagegen-prompts.md` and
   `imagegen-provenance.md`; every shipped asset gets a `CREDITS.md` row. Run the
   img2threejs admission gates (`check_reference_admission.py`, pre-spec assessment, detail
   inventory) and keep transient intake artifacts under `tmp/`.
2. **Lock budgets before building.** Pick triangle target and hard ceiling, byte ceiling,
   primitive/material counts, and dimensions, and write them down. Exemplars: banker chest
   2,048 tri / 4 mats / 44 KB; noticeboard 1,184 tri / 2 mats / 25 KB; mailbox 1,640 tri /
   2 mats / 33 KB; town service building 2,300 to 4,400 tri / 2 mats / 40 to 68 KB; Grand
   Armoury (sole major landmark) 8,226 tri / 6 mats / 137 KB.
3. **Author the sculpt spec** through the img2threejs strict gates (`new_sculpt_spec.py`,
   `validate_sculpt_spec.py --strict-quality`). Name the identity-critical systems; map
   every inventoried detail to a component or material entry.
4. **Build a purpose-built procedural factory** (`scripts/assets/<asset>/model.js`):
   named semantic systems merged into 2 to 6 material buckets, vertex colors instead of
   embedded textures (the shared Eastbrook atlas adds mid-frequency grain at runtime),
   floor-seated at Y=0, centered on X/Z, +Z front, stable mesh names, `Socket_*` nodes and
   `userData.sculptRuntime` contract metadata. Treat generated scaffolds as candidates:
   the banker chest shipped only after the generic scaffold was replaced by a
   purpose-built factory. Reuse `scripts/assets/eastbrook_town/shared.js` helpers where
   they fit instead of copying them.
5. **Export and optimize deterministically.** Copy the exporter archetype
   (`export_<asset>.mjs` + `export_entry.js` + `source_fingerprint.mjs` + a
   `scripts/assets/specs/<asset>.json` spec with `keepExtras: true`). The exporter writes
   the raw GLB to `tmp/asset_src/`, stamps the source fingerprint, spawns
   `scripts/assets/build_assets.mjs` (resample, prune, dedup, meshopt) into
   `public/models/props/`, and verifies the full contract. Use `--no-preview` for
   fingerprint-only rebuilds and `--verify-staged` to prove staged bytes. Then refresh the
   media manifest: `node scripts/build_media_manifest.mjs generate`.
6. **Validate from multiple angles**, raw AND shipped: `npx gltf-transform inspect`,
   `npx gltf-transform validate`, `node scripts/asset_pipeline/pipeline.mjs preview --file
   <glb> --out tmp/<asset>_preview`. Compare beside the reference at the img2threejs 0.70
   per-critical-feature threshold; a global average never excuses a failed identity
   feature. Reject cardboard: silhouette must hold from front, side, three-quarter, and
   grazing views.
7. **Pin the contract in a test.** Parse the shipped GLB and pin bytes, sha256, triangles,
   primitives, materials, COLOR_0, zero textures/animations/skins, meshopt present, bounds
   floor-seated and centered, and live source-fingerprint equality (pattern:
   `tests/eastbrook_mailbox_asset.test.ts`, `tests/render_glb_replacement_assets.test.ts`).
8. **Integrate behind a render module** (`src/render/<asset>.ts`), never inline in
   `renderer.ts`: register the preload, clone only transforms from one template, convert
   materials through `surfaceMat` (Standard and Lambert tiers), respect click targets,
   terrain seating, collision footprints, and the entity shadow gate. Sim-side placement
   and collision go through the authored layout/content records, never renderer constants.
9. **Prove it in game and gate.** Capture matched desktop Ultra and mobile Low evidence
   with the committed capture helper, run the focused asset tests plus
   `npx tsc --noEmit`, then `npm run gate`, and report the exact asset byte/triangle delta
   (`node scripts/asset_budget.mjs --json` stays red on pre-existing aggregate overages;
   never claim it passed).

## The fingerprint contract (do not skip)

Every eastbrook-style asset stamps a sha256 source fingerprint over a pinned file list
(factory, entry, exporter, spec, `build_assets.mjs`, reference turnarounds, the shared
atlas, and `package-lock.json`). Tests recompute it live and compare against the GLB.
Consequences:

- Editing ANY fingerprinted file (including a lockfile-only dependency bump or a release
  merge that touches `package-lock.json`) requires re-exporting every affected asset
  family with `--no-preview`, regenerating the manifest, and re-pinning the sha256 and
  fingerprint literals in tests, design-doc tables, and the capture evidence JSONs (the
  polish integrity test cross-checks stored provenance against live values).
- Byte sizes stay stable across a fingerprint-only re-export; only hashes move. If sizes
  move, something else changed; stop and diff.
- Batch refactors to shared exporter code so all families re-export once, not per change.
