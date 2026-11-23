# Integration 45 icon backlog

Active objective: complete the icon work identified by the October 22 audit, including
reviewing every replacement candidate. Target branch: `feature/v045-integration`,
base `5167aabadeea7b21f0921e6d3973350072428b19`. Work is local on
`feature/v045-painted-icon-backlog`. On October 23, Reuben authorized committing,
pushing and opening a PR into integration 45. Merge and deployment remain separate.

[inventory.csv](inventory.csv) preserves all 466 audited entries, their original
classification, target paths, progress and evidence. A candidate is not considered
resolved merely because its old icon exists. Check authored identity and any Heroic
inheritance before deciding whether it needs its own painting or an inherited update.
Retired-token handling likewise needs an explicit evidence-backed disposition.

## Acceptance checklist

- [x] Resolve every inventory row: create missing art, repaint selected assets, or record a verified inheritance/retirement disposition.
- [x] Preserve each accepted original, 512px master, exact prompt, references, processing and shipping hashes.
- [x] Give each runtime file one current provenance owner and remove completed entries from pending/placeholder routing.
- [x] Review every painting at shipping and small UI sizes, grayscale and circular crop; verify representative desktop/mobile surfaces beyond inventory before final completion.
- [ ] Required selective gate must pass before merge. Combined catalog, scoped regressions, types, build, security and representative surfaces passed; see final verification.

## Current progress

All 135 Season 2 armor paintings are generated, integrated and verified in desktop
and mobile landscape inventories: nine classes, three complete five-piece sets per class.

Courier, Lunge, Takedown and Clockwork Shock Bomb now have individual paintings and
verified desktop/mobile action-bar captures. The ability-art pending list is empty.
The Horse Whistle now has an icon rendered from the shipped Tug model, verified in
desktop and mobile landscape inventory captures. Emberfall Phoenix is resolved as an intentional
[retired-token exception](retired-phoenix-disposition.md), retaining its procedural icon.

All five referral rewards now have their own paintings, verified in desktop/mobile
inventories. Temporary item aliases are empty.

All 96 map-loot replacements (eight families, four pieces and three tiers each)
are integrated and verified in desktop/mobile inventories. All 57 Deed crests are also integrated and verified in desktop/mobile
Book of Deeds cards. All 32 faction vendor replacements (10 Rift Watch, 12 Church and 10 Automaton), both Clue Hunt items, and all 18 faction rewards/toys are also integrated and verified in desktop/mobile inventories. The 60 Sunken Bastion, Drowned Temple, Wildheart Basin, Gravewyrm Sanctum and Hollow Crypt replacements are also integrated and verified in desktop/mobile inventories. The additional 55 Sunken Bastion, Drowned Temple and Hollow Crypt rare/Heroic replacements are also verified. Total: 465 integrated icons and one retired-token exception.

All 466 inventory rows now have a recorded disposition. Artwork and scoped verification are complete; the full selective gate remains outstanding. Publication checks cleared manifest freshness and corrected provenance JSON formatting. See [final verification](final-verification.md). The earlier audit found no ability
named `Buddy`; the live horse whistle was one confirmed companion-related gap.

## Resume and verify

Read the inventory and current Git status before continuing. Generation staging is
under `tmp/imagegen/`: Warrior uses `v045-icon-backlog`; other Season 2 classes use
`v045-<class>`. Skills use `v045-skills`; the horse render uses `v045-buddy`; referrals use
`v045-referral`. Map-loot staging starts with `v045-hoard-arcane`.
Each painted batch preserves exact prompts, originals, masters, review sheets and
local processing scripts. Do not rerun a completed `ship.mjs`: it rejects an already
registered batch. The horse recipe is described in its accepted-art record.

Accepted records live in the corresponding `docs/achievements/` batch directories.
The local Season 2 visual gallery is `tmp/icon-audit/progress.html` (135 paintings).
Screenshots are in `docs/screenshots/warfare-season2-<class>-icons/`,
`docs/screenshots/missing-skills-v045/` and `docs/screenshots/horse-whistle-v045/`.

Use explicit Biome paths while work is uncommitted: `npm run ci:changed` previously
checked zero files. The publication gate retry passed manifest freshness, then found provenance JSON formatting errors. Those were corrected without changing parsed contents; scoped lint passed. The remaining full gate is outstanding. Focused checks are not merge readiness; see the final verification report for exact outcomes and limits.

## Latest verification

- Ten Rift Watch vendor paintings: file audit zero issues/duplicates/perceptual candidates; all ten desktop/mobile inventory URLs decoded and screenshots were reviewed. The faction accepted-art test and 25 item tests passed. Weapon registry tests required updates to the current batch count and Voidblade ownership after replacement; historical registry remains intact. All four weapon tests then passed (30 unique focused tests passed across the run and retries).
- Twelve Church vendor paintings: file audit zero issues/duplicates/perceptual candidates; all twelve desktop/mobile inventory URLs decoded and screenshots were reviewed. `npx vitest run tests/faction_painted_icons_v045.test.ts tests/item_icons.test.ts tests/weapon_icons.test.ts` passed all 31 tests. Current mace ownership moved to the Church painting batch; historical weapon records remain unchanged.
- Ten Automaton vendor paintings: file audit zero issues/duplicates/perceptual candidates; all ten desktop/mobile inventory URLs decoded and screenshots were reviewed. The same three focused test files passed all 32 tests. All 32 old faction vendor/ladder mapping entries have moved to their individual painting batches; empty old batch entries were removed while historical generators and records remain unchanged.
- Clue Scroll and Treasure Casket: file audit zero issues/duplicates/perceptual candidates, both URLs decoded and visually verified in desktop/mobile inventories. `npx vitest run tests/icon_backlog_v045_art.test.ts` passed all 10 tests.
- Eighteen faction rewards/toys: file audit zero issues/exact duplicates. One similar parchment pair was visually reviewed and retained with a recorded distinction (grey whetstone plan versus blue droplet/green herb recipe). All 18 URLs decoded in desktop/mobile inventories and both captures were reviewed. `npx vitest run tests/icon_backlog_v045_art.test.ts tests/item_icons.test.ts` passed all 36 tests. The decorative Clockwork Shock Bomb schematic needed one generation retry, recorded in its provenance.
- Post-faction/reward checkpoint: `node scripts/item_art_audit.mjs --verify-only` passed the full catalog checks. Biome passed the three modified item/faction/weapon tests. Independent visual/provenance review of all 32 faction vendor paintings found no actionable issues.

- Independent review of the final 14 Crypt/Wildheart/Gravewyrm crests found no actionable identity, small-size, alpha or provenance issues. All 28 earned-state URL records matched; representative landscape and unearned desktop captures agree.

- All 57 formerly missing Deeds now ship individual paintings: 346 live / 346 painted / zero pending. Gravewyrm asset audit found zero issues or duplicates; all five desktop/mobile URLs decoded and captures were reviewed. The open-chain painting was corrected for insufficient source coverage, with both source versions and exact edit prompt retained.
- Final Deed checkpoint: all ten accepted-batch tests passed; after correcting an accidental update to a historical five-crest assertion, all 13 catalog/geometry tests passed. `pnpm exec tsc --noEmit`, explicit Biome checks for the two Deed tests/generated registry, and `git diff --check` passed.
- Two unearned desktop Deed cards correctly use the new paintings in grayscale. Portrait URL decoding passed, but the existing Rotate to Landscape overlay obscures gameplay; those captures are not claimed as unobstructed portrait visual verification.

- Independent review of 17 adventure/Bastion/Temple crests found no actionable identity, small-size, alpha or provenance issues; all 34 runtime report entries matched. Earned landscape states were inspected; additional state evidence is recorded below.
- Crypt/Wildheart integration: 22 focused Deed tests passed after updating the obsolete last-pending-crest assertion. Both asset audits found zero issues, exact duplicates or perceptual candidates. All nine expected URLs decoded in desktop/mobile cards; captures were visually reviewed.

- Five Bastion crests: 19 focused Deed tests passed; asset audit zero issues or duplicates. Desktop/mobile captures decoded all five expected URLs and were visually reviewed. A detached-frame capture attempt succeeded on retry with the warmed server.
- Five Temple crests are integrated; 20 focused Deed tests passed and the asset audit found zero issues or duplicates. All five expected URLs decoded in desktop/mobile cards after a preview-server restart; captures were visually reviewed.

- Seven adventure Deed crests: 18 focused Deed tests passed; file audit zero issues, duplicates or perceptual candidates. All seven expected URLs decoded in desktop/mobile cards; captures visually reviewed.
- Independent review of all fifteen exploration/faction crests found no actionable issues in identities, alpha, small-size distinction or provenance.

- Seven faction-standing Deed crests: 17 focused Deed tests passed; file audit zero issues/exact duplicates. The related Rift Watch Trusted/Champion perceptual pair was reviewed and retained with an explicit distinction record. All seven URLs decoded in desktop/mobile cards and captures were visually reviewed.
- Reviewed the 27 Heroic SVG candidates: each owns distinct non-weapon artwork and requires a separate painting. See [Heroic replacement review](heroic-replacement-review.md); no rows closed by this review.

- Eight exploration/world-quest Deed crests: 16 focused Deed tests passed; audit zero issues/duplicates. All eight expected URLs decoded in desktop/mobile cards and captures were visually reviewed. `pnpm exec tsc --noEmit`, explicit Biome checks for the two Deed tests/generated registry, and `git diff --check` passed.

- Six Crucible Deed crests: 15 focused Deed tests passed; audit zero issues/duplicates. Desktop/mobile captures decoded all six URLs, including the hidden Forgebreaker crest. Independent visual review of all eleven foundations/Crucible crests found no visual issues; its stale capture-status note has been corrected.

- First five Deed crests: `pnpm exec vitest run tests/deed_icons.test.ts tests/deed_backlog_v045_art.test.ts --maxWorkers=2 --reporter=dot`: 14 passed. Desktop/mobile reports decoded all five expected URLs; captures visually reviewed. Native alpha, framing and file audits passed.

- All map-loot batches: `pnpm exec vitest run tests/icon_backlog_v045_art.test.ts tests/item_icons.test.ts --maxWorkers=2 --reporter=dot`: 34 passed. Bone and Tide file audits found zero issues/exact duplicates; Tide's six related chalice/pendant tier pairs were visually reviewed and retained with an explicit disposition. All desktop/mobile reports decoded the expected twelve URLs per family. Tide mobile succeeded on a separate retry after its first browser frame detached.
- The old hoard SVG batch owns no current files and was removed from the current mapping after all 96 replacements. Its unchanged generator and Git history remain available; every accepted painting records its old owner and superseded byte hash.
- Broodmother: seven accepted-batch tests passed; file audit found zero issues/exact duplicates. One related vest-tier perceptual candidate has a reviewed disposition. Desktop/mobile captures decoded all twelve URLs after extending the local harness world-start allowance from 60 to 120 seconds; two earlier runs timed out before the HUD appeared.
- Checkpoint after Broodmother: `pnpm exec tsc --noEmit`, `node scripts/item_art_audit.mjs --verify-only`, `pnpm exec biome check tests/icon_backlog_v045_art.test.ts tests/release_v039_icon_art.test.ts`, and `git diff --check` passed.
- Map-loot checkpoint: `pnpm exec vitest run tests/icon_backlog_v045_art.test.ts`: six accepted-batch tests passed through Grask. Ember, Storm and Grask file audits found zero issues or exact duplicates. Storm's two related hauberk perceptual candidates have an explicit reviewed disposition; Ember and Grask had none.
- Independent visual/provenance review of Frost, Ember, Storm and Grask (48 paintings): no actionable findings. All eight desktop/mobile reports decoded the expected twelve URLs per family.
- Independent visual/provenance review of Venom, Bone and Tide (36 paintings): no actionable findings. All six desktop/mobile reports decoded the expected twelve URLs per family.
- Map loot: `pnpm exec vitest run tests/icon_backlog_v045_art.test.ts tests/item_icons.test.ts --maxWorkers=2 --reporter=dot`: 27 passed. After adding Hoarfrost, the three accepted-batch tests passed.
- Nyxaris and Hoarfrost asset audits: zero file issues or exact duplicates. Three Hoarfrost perceptual candidates are related shield tiers; reviewed and retained with explicit disposition. Desktop/mobile reports decoded all twelve paintings per family.
- Independent visual review of the five referral and twelve Nyxaris paintings: no substantive findings.

- Referral: `pnpm exec vitest run tests/item_icons.test.ts tests/release_v039_icon_art.test.ts --maxWorkers=2 --reporter=dot`: 29 passed; one current-hotbar census assertion still expected borrowed referral art. Updated the live painted count from 133 to 137 and pending hotbar list to empty; the five release-art tests then passed. Historical totals remain unchanged.
- Referral asset audit: zero issues, duplicates or perceptual candidates. Desktop and mobile captures decoded all five authored files.

- Season 2: `pnpm exec vitest run tests/warfare_season2_icon_art.test.ts tests/item_icons.test.ts --maxWorkers=2 --reporter=dot`: 43 passed across two files.
- `pnpm exec tsc --noEmit`: passed after the skill integration.
- Skills: `pnpm exec vitest run tests/missing_skills_v045_art.test.ts tests/skill_icons.test.ts tests/ability_icons.test.ts tests/release_v039_icon_art.test.ts tests/missing_painted_icons_wave.test.ts --maxWorkers=2 --reporter=dot`: 38 passed; one current-census count needed updating from 408 to 412. After correction, `pnpm exec vitest run tests/release_v039_icon_art.test.ts --maxWorkers=2 --reporter=dot` passed all five tests. The sealed historical record remains 408.
- Horse: `pnpm exec vitest run tests/item_icons.test.ts tests/buddy_retirement.test.ts tests/warfare_season2_icon_art.test.ts --maxWorkers=2 --reporter=dot`: 46 passed; one provenance-license wording assertion failed. After adding the required project-asset classification without changing underlying model rights, `pnpm exec vitest run tests/item_icons.test.ts --maxWorkers=2 --reporter=dot` passed all 25 tests.
- `node scripts/item_art_audit.mjs --verify-only`: passed with 2,181 catalog records, 2,210 live entries, one pending entry, 47 review-sheet pages and 28 groups. The pending entry is the retired Phoenix token.
- `node scripts/icon_asset_audit.mjs <accepted-art.json> <output> --no-sheets`: zero issues, exact duplicates or perceptual candidates for Mage, Warlock, Druid, all four skills and the horse render.
- Earlier independent frontend reviews of Warrior, Paladin, Hunter, Rogue, Priest and Shaman found no substantive issues. Independent review of Mage, Warlock, Druid and all four skills also found no substantive findings.

Disk space was freed again to roughly 11 GB when the remainder goal resumed.
Generation resumed with the five referral rewards; all completed source art is preserved. Only this task owns the Vite server on port 5194; port 5173 belongs to
another running server and must not be stopped. Restart the task server after routing
changes before capturing to avoid stale module responses.

On October 22, Reuben instructed work to continue until disk space prevents saves. Preserve completed sources and do not pause generation merely at a low-space warning.

- Hollow Crypt: all 16 asset records passed the file/duplicate audit and desktop/mobile inventory checks. The combined focused run had one 20-second catalog-test timeout; rerunning the item test file alone passed all 25 tests. The other nine dungeon/weapon tests passed in the original run.
