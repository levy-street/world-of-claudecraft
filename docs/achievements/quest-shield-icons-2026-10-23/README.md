# Quest shield icon paintings

Original artwork for the three quest rewards in PR #4583. The local branch
`feature/quest-shield-icons` starts at PR head `602a01bcc80`.

| Item | Shipping asset | Bytes |
| --- | --- | --- |
| Lychgate Buckler | [WebP](../../../public/ui/items/lychgate_buckler.webp) | 2574 |
| Bastion Kite Shield | [WebP](../../../public/ui/items/bastion_kite_shield.webp) | 1740 |
| Barrowfield Tower Shield | [WebP](../../../public/ui/items/barrowfield_tower_shield.webp) | 2362 |

Generated with the OpenAI built-in image tool, separately for each item. Each
painting received one framing edit for safe padding. The [provenance record](accepted-art.json)
retains the exact generation and edit prompts, source and shipping hashes,
reference roles, processing, and review results. Original PNGs and 512px masters
remain in ignored `tmp/imagegen/quest-shields/`.

[Size review](../../screenshots/item-art-consistency-2026-08-09/quest-shield-icons-2026-10-23/size-review.png): rows are
buckler, kite, tower; columns are 512, 128, 40, 28, 22, 28 grayscale, 64 circular.
The three items now leave the art-pending ledger and resolve their own static URLs.
Quest rewards, stats, held models, and localization remain unchanged.

## In-game comparison

The original PR's reward screenshots provide the procedural-icon baseline.

| Quest | Before | Painted icon |
| --- | --- | --- |
| The Restless Dead | [Before](../../screenshots/quest-shields/after-eastbrook-desktop.png) | [After](../../screenshots/item-art-consistency-2026-08-09/quest-shield-icons-2026-10-23/in-game/01-quest-shield-rewards-eastbrook-desktop.png) |
| The Sunken Bastion | [Before](../../screenshots/quest-shields/after-mirefen-desktop.png) | [After](../../screenshots/item-art-consistency-2026-08-09/quest-shield-icons-2026-10-23/in-game/02-quest-shield-rewards-mirefen-desktop.png) |
| The Revenant Fields | [Before](../../screenshots/quest-shields/after-thornpeak-desktop.png) | [After](../../screenshots/item-art-consistency-2026-08-09/quest-shield-icons-2026-10-23/in-game/03-quest-shield-rewards-thornpeak-desktop.png) |
| The Restless Dead (mobile) | [Before](../../screenshots/quest-shields/after-eastbrook-mobile.png) | [After](../../screenshots/item-art-consistency-2026-08-09/quest-shield-icons-2026-10-23/in-game/04-quest-shield-rewards-eastbrook-mobile.png) |

## Validation

- `npm run assets:items`: three opaque 128x128 sRGB WebPs, all below 15 KiB.
- `node scripts/item_art_audit.mjs --verify-only`: pass; one current owner per
  painting, 1467 shipping images, 1485 covered definitions, 135 remaining pending items.
- `npx vitest run tests/quest_shields.test.ts tests/item_icons.test.ts tests/item_art_consistency.test.ts tests/item_art_audit_builder.test.ts tests/architecture.test.ts --maxWorkers=2`:
  quest, icon and architecture suites passed. Catalog tests initially failed on
  old inventory pins; their final rerun with `--maxWorkers=1` passed after those
  pins were updated from the verifier. All 165 tests pass across the two runs.
- `npx tsc --noEmit`: pass.
- Biome on changed TypeScript, script and provenance files: pass with two existing
  warnings (unused `datedIdSet` and a non-null assertion in the quest test).
- `git diff --check`: pass.
- Repository `scripts/pr_screenshots.mjs` against the local Vite client:
  all three quest reward icons verified on desktop, plus the buckler on mobile.
  All four requested captures were saved and visually inspected. The runner then
  exited 1 during page cleanup with `Target.closeTarget: No target with given id found`;
  the overall screenshot command is not claimed green.
- `node scripts/gate_select.mjs`: blocked before tests by the audio-tool preflight,
  `spawn Unknown system error -86`. Full gate and merge readiness are unverified.

This change supplies icon artwork and its integration only.
