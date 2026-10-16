# September 23 character integration

> This page is the record of the FIRST integration (the 23 September export) and is kept as
> written. The branch moved on before it was committed: the whole-character GLBs described
> below were replaced by split files under `public/models/chars/players/woc/` (a base and an
> animation library per body, one armor file per class, body and tier, and the modular head
> files, pinned by `scripts/assets/woc_character/export_split.json`), the fixed faces by the
> head builder, and the work was moved onto `release/v0.45.0`. Sizes, file names and scope
> limits below describe that first state. The current design is in
> `src/render/characters/CLAUDE.md`; the crowd-cost evidence is in [crowd](crowd/README.md).

The recovered character draft is integrated in `codex/character-pack-september-23`, based on `release/v0.44.0` at `56525e0343`. The original staged draft in the main checkout is preserved. The local preview runs at http://127.0.0.1:5173.

The current 18 class/body GLBs and 32 underarmor textures come byte-for-byte from the maintainer's `WOC_Game_Ready_2026-09-23/public` refined-arm export. The 13:28 follow-up replaces the earlier long-arm models; see [refined-arm verification](refined-arms/README.md). `scripts/assets/woc_character/export_20260923.json` records their SHA-256 hashes and shared arm-interface revision. The existing experimental jump-start/landing worktree is excluded: all WOC bodies use `Jump` and return directly to idle or running at touchdown.

Integration fixes cover independent armor slots after mesh merging, equipment-sensitive far geometry and shadows, atlas retention while switching weapons, both swimming weapon holders, female previews/portraits, and authored Paladin Final Edict FX. WOC headshots measure posed visible character parts. Late preview atlases are prepared on that preview's GPU context before becoming visible.

## Captures

Before images show the recovered draft's earlier characters, not the release branch's KayKit roster. After images in this original table show the earlier long-arm September 23 export; the refined-arm follow-up has separate captures. Both use ordinary in-game armor, sword and shield. The front camera is intentionally close for visual comparison. Different capture times and quality tiers change lighting.

| View | Before | After |
|---|---|---|
| Desktop male | [Before](before-desktop-warrior.png) | [After](after-desktop-warrior.png) |
| Desktop female | [Before](before-desktop-female-warrior.png) | [After](after-desktop-female-warrior.png) |
| Mobile landscape | [Before](before-mobile-landscape-warrior.png) | [After](after-mobile-landscape-warrior.png) |
| Mobile portrait rotation guard | [Before](before-mobile-warrior.png) | [After](after-mobile-warrior.png) |

Fresh Vite pages loaded all nine classes in both body types, then recorded airborne physics and the clip sequence `Idle`, `Jump`, `Run`. No page exceptions or failed model/texture requests were observed. The final server was restarted and its served source checked, because file watching under the hidden worktree path had retained an earlier transform.

## Scope limits

- The supplied high-quality character GLBs total 217.8 MB and are eagerly preloaded. Browser mobile emulation passed; physical-phone cold startup and memory were not measured.
- These authored bodies use fixed faces and colors. Existing KayKit appearance sliders and chroma indexes do not alter them.
- World and turntable armor/helmet changes work. HUD headshots show the stock class/gender kit; individual equipment and hidden-helmet choices are not part of their cache identity.
- A failed asynchronous preview GPU preparation keeps the prior prepared atlas until an equipment change or rebuild.

## Verification

This table records the state of the tree when the draft was first integrated (uncommitted at the time: the one red was the index freshness check, which compares against staged files). The pull request description carries the gate results of the committed change.

Commands below ran from this worktree. Turborepo commands used the repository-pinned pnpm 10.34.5 via `npx --yes --package=pnpm@10.34.5 -c '...'`; the global pnpm was a different major version.

| Command/check | Result |
|---|---|
| `npm test -- --maxWorkers=4` | Initial evolving-tree run: 4,385 suites passed, 23 failed, 36 skipped; 65,167 tests passed and 50 failed. Every failed suite was revisited below. This is not claimed as a green final-tree full run. |
| `node_modules/.bin/vitest run <sweep-files> --maxWorkers=4 --reporter=default --reporter=json` | 186 character/changed/failure suites: 181 passed, 5 failed. The two retained KayKit fixture tests, measured shard inventory, and provenance pins were corrected; guide index freshness remains. |
| `node_modules/.bin/vitest run <recheck-files> --maxWorkers=4 --reporter=default --reporter=json` | Final recheck of all original failed suites plus the added provenance/leap guards: 24 suites passed, one guide freshness failure; 468 tests passed, one failed, one existing skip. Exact file lists are in [verification-files.json](verification-files.json). |
| New test files with the same Vitest options and `--maxWorkers=2` | 12 suites, 129 tests passed. Real recorded file durations were added through `scripts/ci_shard_weights_harvest.mjs --carry-local`; existing harvested weights were preserved. |
| `node_modules/.bin/vitest run tests/warrior_control_performance.test.ts tests/warrior_leap_performance.test.ts tests/eastbrook_polish_capture_contract.test.ts tests/eastbrook_polish_artifact_integrity.test.ts tests/ci_shard_partition.test.ts tests/ci_shard_weight_carry.test.ts --maxWorkers=2` | 6 suites, 97 tests passed. |
| `npm run test:browser -- --maxWorkers=2` | All 51 Chromium suites, 438 tests passed, including real captures for all 18 portraits and authored Paladin Final Edict. |
| `node_modules/.bin/turbo run check:types --ui=stream` | Passed client TypeScript, admin Svelte check, and bot TypeScript. |
| `node_modules/.bin/turbo run check:types build:env build:server build:bot build:bundle sfx:check --ui=stream` | Each task passed in the combined build run. That run initially failed a subsequently fixed test fixture type; the final typecheck above passed. |
| `node_modules/.bin/turbo run build:bundle --ui=stream` | Production client build passed; emitted 1,816 hashed media assets. |
| `npm run security:gate` | Passed: 9,644 files, 452 scanner flags, zero high findings after reviewed priors. |
| `npm run ci:changed`, explicit Biome check of all changed/untracked authored JS/TS/JSON, `git diff --check` | Passed. The branch-based `ci:changed` alone sees no committed diff; explicit working-tree Biome supplies that coverage. Existing warning-level lint findings remain. |
| `npm run i18n:gen`, `npm run wiki:content`, `node scripts/build_media_manifest.mjs generate`, `node scripts/build_sfx_manifest.mjs` | Generated outputs current. Repeating the guide, media and sound generators produced byte-identical files. Localization is unchanged from the release base. |
| `node scripts/build_mob_portrait_source_manifest.mjs --check` | Passed after rendering the three affected class-derived NPC portraits with a renderer receipt. |
| `node_modules/.bin/vitest run tests/scripts_windows_paths.test.ts --maxWorkers=2` | 3 tests passed after correcting the recovered composition script's file-URL conversion. |
| `npm run gate` | Stops at `manifest freshness`: current generated guide/media files differ from the index. No staging, commit, push or PR was performed. |

Read-only rendering, simulation and test-coverage reviewers were used. Their blocking findings were addressed and checked by the parent. The mobile/stock-portrait/fail-soft limitations above remain. The original main-checkout binary diff was hashed against the saved intake patch and is unchanged.

## Hood and combat follow-up

The helmet eye now receives desktop clicks: the preview canvas previously covered
it because its stacking context escaped the model panel. Real pointer tests and
live desktop/mobile landscape runs verified all nine classes and both body fits,
including Hunter, Rogue, Warlock, Mage and Priest. Every toggle updated the world,
the character sheet and hair visibility. See [hood evidence](hoods/README.md).

Hunter contact damage now selects a melee swing independently of the equipped
weapon. A real simulation regression verifies melee at 2 yards and ranged shots
at 20 yards. The renderer carries the attack kind and stable ability ID through
to the authored clip. Secondary wounds and procs no longer replay shooting or
swinging, while primary hits and avoided attacks still animate. Weapon display
changes are deferred at the user's request.

| Class | Animation audit and corrections |
| --- | --- |
| Hunter | Melee autos and Gutting Strike/Woundrend/Fettering Slash use melee clips. Bloodhook and re-entry gain melee mappings; Hushing/Startle/Rattling Shot, Splitshot and Shrapnel Charge gain shot mappings. Wildbond/Patch Up loop casting. Measured Shot releases once without replaying the draw. |
| Warrior | Checked one/two-hand and dual-wield strikes, guard, channels and silent buffs. Spin dispatch now preserves Cleave/Whirlwind/Bladestorm/Dawnfall identity. |
| Paladin | Checked strikes, Final Edict and interrupts. Mercy Lance's non-projectile completion now plays its cast release. |
| Rogue | Checked openers, strikes and finishers. Added Venom Dart, Leaden Venom and Bleed Out application gestures; ongoing bleeds and Second Shadow do not replay them. |
| Mage | Checked bolts, ground spells, crowd control and channels. Glacial Front/Dragon's Breath preserve cast gestures; wand launches play a cast release. |
| Priest | Checked spell releases, channel loops and timed-heal recovery. Shared wand-launch fix applies. |
| Shaman | Checked melee, weapon-style overrides, lightning spells and timed heals. Existing instant shock/totem/imbue presentation is retained. |
| Warlock | Physical hits gain a melee fallback; Needle of Fate gains its projectile cast release. Checked bolts, curses and Drain Life; shared wand-launch fix applies. |
| Druid | Gladesong now loops casting. Checked casts and Hurricane; Bloodrift application animates once and bleed ticks stay silent. Existing form-specific fallback is retained. |

Live frame checks also confirmed melee playback on all 18 models and distinct
Hunter melee/ranged poses; see [combat captures](combat/README.md).

The shared wand path also uses the cosmetic mech's shipped `Spellcast_Shoot`.
No simulation, equipment rules, or weapon assets were changed by this follow-up.
The audit covers common dispatch and the listed ability paths; it does not claim
manual combat coverage of every ability, specialization and shapeshift.

Final follow-up verification, after the last production edits:

| Command | Result |
| --- | --- |
| `node_modules/.bin/vitest run <combatFollowup files> --maxWorkers=3` | 30 suites, 558 tests passed. Exact file list is the `combatFollowup` array in [verification-files.json](verification-files.json). Includes range dispatch, all nine class melee fallbacks, channels, proc/tick negatives, cone/spin dispatch, architecture and refreshed provenance. |
| `npm run test:browser -- --maxWorkers=2` | All 54 Chromium suites, 474 tests passed. Includes real pointer hood controls, all 18 shipped models, Hunter melee skills on both fits, caster wand releases and channel motion. |
| `npx --yes --package=pnpm@10.34.5 -c 'node_modules/.bin/turbo run check:types build:bundle --ui=stream'` | Four tasks passed: client/admin/bot typechecks and production client bundle; 1,816 media assets emitted. |
| `npm run ci:changed` | Passed; no committed branch diff. Explicit `node_modules/.bin/biome check` of the 25 follow-up source/test files passed with nine warning-level findings, no errors. |
| `npm run security:gate` | Passed during follow-up QA: 9,647 files scanned, 452 reviewed flags, zero high findings. |
| `node scripts/build_mob_portrait_source_manifest.mjs --check` | Passed. |
| `node scripts/assets/eastbrook_grand_armoury/remint_polish_provenance.mjs` | Updated the renderer runtime seal and test pins after the final edit. Historical images and capture identity were retained; the two provenance suites passed in the final unit run. |
| `git diff --check` | Passed. |
| `npx --yes --package=pnpm@10.34.5 -c 'npm run gate'` | Still stops at manifest freshness because generated guide/media files differ from the unstaged index. No bypass or staging was performed. |

Read-only frontend and test-coverage reviews found no remaining actionable
findings in the frozen follow-up. The local Vite server was restarted and its
served source checked for the final dispatch. At that point the generated files
were still unstaged, so the gate stopped at manifest freshness; the pull request
description carries the gate results of the committed change.
