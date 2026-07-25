---
name: woc-image-to-glb
description: "Turn a reference image into a shipping World of ClaudeCraft GLB through the img2threejs intake gates and the repo's deterministic export, optimize, fingerprint, and test pipeline. Use when asked to create, replace, rebuild, re-export, or re-pin a world asset (prop, furniture, building, landmark, stall, service object) from a concept or reference image."
---

# World of ClaudeCraft image-to-GLB

This is the Codex-side pointer for the shared asset pipeline. The canonical operating
procedure is the Claude skill at `.claude/skills/image-to-glb/SKILL.md`; the deep runbook
is `docs/image-to-glb-asset-workflow.md`. Follow those two documents exactly; do not
improvise an alternative pipeline.

Quick orientation:

1. Read `scripts/assets/CLAUDE.md`, then `.claude/skills/image-to-glb/SKILL.md` in full.
2. The `img2threejs` skill (installed at `~/.codex/skills/img2threejs`) drives reference
   admission, detail inventory, sculpt specs, and staged visual review. It is an authoring
   aid, never a build dependency.
3. The committed chain is: reference (with provenance and a `CREDITS.md` row) -> budgets ->
   sculpt spec -> purpose-built factory (`scripts/assets/<asset>/model.js`, vertex colors,
   material buckets, sockets) -> deterministic exporter -> `build_assets.mjs` optimizer ->
   `public/models/props/` -> media manifest -> parsed-GLB contract test -> render adapter
   module -> matched desktop/mobile in-game evidence -> `npm run gate`.
4. Respect the source-fingerprint contract: any change to a fingerprinted input (including
   `package-lock.json`) means re-exporting the affected asset families and re-pinning the
   sha256 and fingerprint literals in tests, docs, and capture evidence JSONs.
