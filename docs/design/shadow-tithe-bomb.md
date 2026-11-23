# Shadow Priest: Tithe Bomb

Core mechanics and the dedicated giant-bomb world effect are implemented. Tithe Bomb
and Void Rupture have painted icons with procedural fallback identities.
This implementation includes the Vampiric Touch dependency from PR #4402 on the latest
OSSBrain v0.45.0 release base.

## Charging and lifetime

Eligible Gloomtithe generation contributes before the ordinary five-stack cap: Mindfracture
on a target with your Dirge, and Dirge ticks on your Effigy. Twenty cumulative charges
prepare one manual bomb, even while ordinary Gloomtithe is already at five. Spending on
Vampiric Touch or Call Tithefiend adds no progress and is optional for bomb preparation.
Expiry, other damage and healing never contribute. The meter caps at twenty and further
generation while prepared is discarded. It survives combat exit and extended idle time.
Death clears partial progress and readiness. It is session state: a resumed connection retains it, but a
fresh character load does not. Specialization changes clear it even while dead.

Each real raid boss pull clears partial and prepared progress for that raid, including
members outside the arena and priests who have not attacked. It cancels an in-flight bomb.
Wipes rearm the next reset. Independent instance copies and unrelated groups are excluded;
five-player dungeon bosses preserve progress. Varkhul's rejected threat-only forging pulls
preserve it until actual approach or damage starts his encounter.

## First tuning pass

Learned at level twenty, Shadow only. Free, three-second cast, thirty-yard target range,
no independent cooldown. Deals Shadow damage within eight yards of the target, with the
existing shared critical roll, hostile/LOS filtering, and five-target soft cap. Completing
the accepted cast consumes readiness even if resisted. Cancellation, interruption and
failed completion preserve it. Boss and splash openers are denied in raids.

Base damage is 270: three times Vampiric Touch's unempowered full-duration base damage
(five ticks of eighteen). This is initial custom-spell tuning, not a final balance verdict.
The shared classic AoE Spell Power coefficient and Shadow specialization multiplier apply;
at level twenty, the current no-crit damage is 338 at zero Spell Power and 374 at 100.

## Display name screening

Working display name: **Tithe Bomb**; stable mechanic ID: `spirit_bomb`.
On 2026-10-10, exact-phrase search for `"Tithe Bomb"` and the token query `"Tithe" "Bomb"`
scoped to Warcraft Wiki, Guild Wars 2 Wiki, RuneScape Wiki, Diablo Wiki and UESP found no
matching spell identity. The tokens are ordinary English rather than coined terms.
Additional exact-phrase searches covered FFXIV (ConsoleGamesWiki and Gamer Escape),
ESO (UESP Online and ESO Hub), and Path of Exile (PoE Wiki and Fandom); none returned
the paired name. FFXIV's individual word matches are fish and quest labels, not this spell.
Search indexing is the available evidence; RuneScape and Fandom block direct crawler access.
The conceptual reference name Spirit Bomb already appears in Blizzard's card catalog:
https://hearthstone.blizzard.com/en-us/cards/48113-spirit-bomb/ . The working display name
avoids adopting that existing spell name; the user can refine the name during the visual pass.

## Verification

Worktree: `.worktrees/shadow-spirit-bomb`, branch `feature/shadow-spirit-bomb`, based on
`origin/ossbrain-release/v0.45.0` at `7bb614dae6`. All changes are uncommitted and unstaged.

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed; lockfile unchanged. |
| `npx vitest run tests/spirit_bomb.test.ts` | 44 passed. |
| `npx vitest run tests/spirit_bomb_raid.test.ts --maxWorkers=1` | 11 passed after final fixes. |
| `node node_modules/vitest/vitest.mjs run tests/parity -t 'nythraxis\|ignivar\|varkhul\|priest_codex' --maxWorkers=2` | 15 passed, including non-update comparisons against the refreshed goldens. |
| `npm run i18n:gen` and `npm run wiki:content` | Passed; generated outputs included. |
| `npm run ci:changed` with the release base | Passed, but sees zero committed changes. Explicit changed-file Biome CI additionally checked 47 files: no errors, 19 warnings. |
| `npx tsc --noEmit` and `npm run check:types` | Passed; app, Svelte admin and bot types checked. |
| `npm run security:gate` | Passed: 11,162 files, zero high findings after contextual triage. |
| `npx turbo run check:types build:env build:server build:bot` | All build tasks passed; types then passed separately after correcting the raid test's damage-call arguments. |
| `npx turbo run build:bundle` | Passed, including backdrop survival and hashed media emission. |
| `npx turbo run sfx:check` | Passed; eight existing preserved-loudness advisories, no changed audio files. |
| `npm run test:browser` | 610 passed, one unrelated Weekly Vault scale-layout failure. |
| `npm run test:browser -- tests/browser/weekly_vault_scale_layout.browser.test.ts` on pristine release | Reproduces the same failure: bottom 293.046875 exceeds 292.546875. |
| Scoped architecture, monolith, localization, wire, guide, icon, aura-tooltip and priest-presentation guards | 471 passed, six intentionally skipped, one guide/index freshness failure. Generated guide bytes match the current sim; its index comparison requires staging. |
| `npm run gate` | Stops at i18n/index freshness because new generated translations are unstaged. No staging was authorized; the guard remains intact. Remaining checks were run separately. |
| `npm test -- --maxWorkers=4 --reporter=dot` with `WOC_SKIP_PRETEST=1` | Stopped after more than two hours without a final suite result. The partial log contains failures that were not fully classified; this is not a passing full-suite run. The suite and its workers have been terminated. |
| `git diff --check` | Passed; no staged changes. |

Merge readiness: **NOT READY** until the canonical gate completes and outstanding full-suite
failures are classified. The core spell is implemented and its 55 focused mechanic tests,
15 parity comparisons, types, builds and security checks pass. The known browser failure
also reproduces on the pristine release. Validation of the complete repository remains
incomplete; it must not be inferred from the focused results.

Read-only sim, coverage, frontend/content and cross-platform reviews closed their findings.
The bank's priest trace adds no RNG drift beyond PR #4402. Four boss golden updates add
only the sampled per-attempt marker and resulting state hashes; every event digest, RNG
count/digest and other sampled state value remains unchanged. The marker stays sampled
because it affects gameplay.

## Giant sphere presentation

The cast grows a dark sphere to 6.4 yards in diameter above the priest. Animated violet
filaments, an irregular corona and converging motes build its silhouette. Completion
launches it toward the captured target position, followed by a pressure ring, expanding
void shell, sparks, pooled light, shadow impact audio and the existing bounded camera shake.
The 0.24-second visual flight is presentation only: damage and the authoritative eight-yard
footprint still resolve immediately on cast completion. Interrupted casts disappear without
an explosion. Reduced motion freezes decorative rotation and suppresses camera shake;
the Spell Effects preference also cancels an in-flight player effect.

`SpiritBombs` lives in `src/render/ability_vfx/spirit_bomb.ts`, composed by the existing
`AbilityVfxFx` engine. Four slots share geometry and are built before play; the three shader
programs join the existing ENGINE preparation and readiness gate. Low quality reduces
decorative motes from 160 to 48 without changing the sphere or radius. Every used attribute
prefix is uploaded explicitly. Disposal finishes releasing other resources even when a
listener throws. No extra post-processing, textures, contexts or simulation state are added.

Visual QA (2026-10-11):

- `node node_modules/vitest/vitest.mjs run tests/spirit_bomb_visual.test.ts tests/spirit_bomb_vfx_routing.test.ts tests/ability_vfx_frame_cost.test.ts tests/ability_vfx_idle_visibility.test.ts tests/ability_vfx_fx_sleep.test.ts tests/ability_vfx_cast_gate.test.ts tests/spell_effects_switch.test.ts tests/cast_vfx_engine_family.test.ts tests/floor_vfx_layer.test.ts tests/ruinbolt_vfx.test.ts tests/architecture.test.ts --maxWorkers=2`: 327 passed. After adding the quality/prefix regression, `node node_modules/vitest/vitest.mjs run tests/spirit_bomb_visual.test.ts --maxWorkers=1` passed all 11 cases; final types also passed after narrowing its attribute type.
- `npm run test:browser -- tests/browser/spirit_bomb_visual.browser.test.ts`: both desktop
  and small-screen WebGL tests passed, including three linked programs and visible violet
  charge/impact without bloom.
- `npx tsc --noEmit`, `npx turbo run build:bundle`, and explicit Biome CI on the 13 visual
  source/test files passed. Biome reported 11 existing warnings, zero errors.
- `npm run ci:changed` passed but sees no committed changes; the explicit file list above
  covers the unstaged visual work.
- `npm run security:gate`: passed, zero high findings after contextual triage.
- `npm run gate` was attempted again and stopped at the unchanged i18n/index freshness
  blocker described above. No full-suite pass or merge readiness is claimed.
- Frontend/GPU review found exception-safe disposal missing; a failing regression reproduced
  it and the fix passed. Final re-review had no remaining blocking or should-fix findings.
  Actual hardware frame pacing and cold-driver link timing are unmeasured. Encounter-hazard
  overlap and reduced-motion gameplay screenshots remain manual verification items; their
  floor-layer policy and reduced-motion lifecycle are covered by the focused tests.

The screenshots below show a real accepted offline Shadow Priest cast at the lowest preset.
The simulation was frozen near the end of charging and the effect frozen during impact to
capture those short phases. The regular simulation and production event routing performed
the launch between them. Small-screen captures use a 960 by 540 landscape viewport; they
are viewport evidence, not physical-phone performance measurements.

- [Before, desktop](../screenshots/tithe-bomb/before-desktop.png)
- [Charge, desktop](../screenshots/tithe-bomb/after-desktop-charge.png)
- [Impact, desktop](../screenshots/tithe-bomb/after-desktop-impact.png)
- [Before, small screen](../screenshots/tithe-bomb/before-mobile-landscape.png)
- [Charge, small screen](../screenshots/tithe-bomb/after-mobile-landscape-charge.png)
- [Flight, small screen](../screenshots/tithe-bomb/after-mobile-landscape-flight.png)
- [Impact, small screen](../screenshots/tithe-bomb/after-mobile-landscape-impact.png)

## Generation redesign, 2026-10-11

The user approved twenty generated Gloomtithe instead of thirty spent. The charging rules
at the top of this document describe the current implementation. Earlier screenshots show
the previous thirty-charge tuning; the world effect itself is unchanged. Twenty is an
initial playtest threshold, not a measured final dungeon cadence.

Verification for this incremental change:

- `node node_modules/vitest/vitest.mjs run tests/spirit_bomb.test.ts tests/spirit_bomb_raid.test.ts tests/priest_vespers.test.ts tests/priest_vampiric_touch.test.ts tests/aura_tooltip.test.ts tests/architecture.test.ts tests/localization_fixes.test.ts --maxWorkers=2 --reporter=dot`: 277 passed, 3 skipped. The real Mindfracture case waits for projectile arrival before asserting generation.
- `UPDATE_PARITY=1 node node_modules/vitest/vitest.mjs run tests/parity/parity_g.test.ts -t priest_codex --maxWorkers=1 --reporter=dot`: two passed. Only the priest golden was deliberately refreshed after observing the expected mismatch. All RNG fingerprints are unchanged; state/event changes reflect the earlier generation aura.
- `node node_modules/vitest/vitest.mjs run tests/parity/parity_g.test.ts -t 'priest_codex.*matches' --maxWorkers=1 --reporter=dot`: one passed against the refreshed golden.
- `npm run i18n:gen`, `npm run wiki:content`, `npx tsc --noEmit`, and `npx turbo run build:bundle`: passed.
- `node node_modules/@biomejs/biome/bin/biome ci src/sim/combat/priest/spirit_bomb.ts src/sim/combat/priest/spirit_bomb_cast.ts src/sim/combat/priest/vespers.ts src/sim/combat/priest/vampiric_touch.ts src/sim/content/priest.ts src/ui/i18n.catalog/abilities.ts tests/aura_tooltip.test.ts tests/spirit_bomb.test.ts tests/spirit_bomb_raid.test.ts`: zero errors, 18 warnings.
- `GATE_SELECT_BASE=origin/ossbrain-release/v0.45.0 npm run ci:changed`: passed against this worktree's actual base. The default selected `origin/release/v0.45.0` and included unrelated branch drift; the explicit nine-file check above covers this unstaged increment.
- `npm run security:gate`: passed, 11167 files, zero high findings after priors.
- Read-only simulation architecture review found no actionable generation, spending, cap, lifecycle, or determinism regression.
- `npm run gate`: still blocked at i18n freshness because the generated files are unstaged. No staging was authorized. Merge readiness remains **NOT READY**; local implementation and focused checks are complete.

## Shadow talent choices and resource HUD, 2026-10-11

The two new spells now participate in existing talent choices:

| Talent | Shadow behavior |
| --- | --- |
| Living Covenant | Landed Mindfracture on your Effigy extends your primary Dirge and Vampiric Touch by one second, up to three seconds per application. It preserves tick timing. Existing secondary Dirge extensions retain their six-second ceiling and keep the secondary Effigy synchronized. |
| Twin Covenant | Keeps the second Effigy. Each Effigy's ordinary Dirge ticks generate Gloomtithe and bomb progress. It does not add a global Vampiric Touch generation multiplier. |
| Second Verse | Every fifth natural Vampiric Touch tick while the target is your Effigy repeats one full pulse, including its actual-damage healing. Refreshing your still-active VT preserves the count; missing, expired, or another priest's VT starts at zero. Holy and Discipline retain their existing repeat behavior. |
| Incarnate Spirit | Tithe Bomb leaves an eight-yard region at the explosion position for six seconds, with three noncritical pulses totaling 20% of the unmitigated, noncritical burst budget. The region stays fixed; enemies can leave it. It replaces the old Shadow pet rider. |
| Choir of Deliverance | For Shadow, instant and usable in Gloamveil Form. For fifteen seconds, 20% of enemy HP removed by your Shadow damage becomes one shared healing budget for nearby injured group members, restricted to your raid subgroup. Its 128 mana cost and 180-second cooldown remain. Holy and Discipline keep their channel. |
| Measured Faith | Vampiric Touch counts toward the three accepted mana-spell casts and can receive the next-cast 50% discount. The free bomb does not advance that counter. |

The lingering bomb region is removed on source death, departure, respec, zone change,
instance claim change or raid-pull reset. It cannot start an unpulled raid boss.
Copied echo damage does not produce another Choir conversion. Absorbs and overkill
do not create healing. Tooltips describe these specialization differences in all shipped
talent locales; the Shadow Choir description replaces the healer-channel description.

The initial HUD (superseded by the medallion revision below) showed two resources below the player frame: five Gloomtithe pips
with the spendable count, and a violet orb/bar showing bomb progress from zero to twenty.
Readiness has an explicit text label as well as color. Spending Gloomtithe does not empty
the bomb meter. Only Shadow sees it, starting at each resource's learn level. It reads
owned replicated auras, reuses its view state, caches unchanged formatted labels and
writes through the existing painter facet. Mobile stacks the meters and lifts the attached
player frame to keep them inside the screen. Each tooltip target compensates for the
supported frame/UI scale factors to retain a forty-pixel minimum height.

Controlled, finite-mana level-twenty rotations compare all three final-row talents with
identical gear, seed and priority. The acceptance cases require Second Verse to win on
one sustained target, Twin Covenant on two, and Incarnate Spirit on a stationary pack
or a short pack with a carried bomb. Leaving the lingering region favors Second Verse
over Incarnate Spirit. These are reproducible encounter examples, not optimized parses
or a final DPS balance verdict.

An integration test exposed an import-initialization cycle: Dirge refresh could calculate
its maximum duration from a partially initialized combat module and set both Dirge and
Effigy timers to `NaN`. The existing six-second budget now lives in the dependency-free
`priest_shadow_tuning.ts` leaf, with its legacy export preserved. Natural ticking, real
refreshes, equal-seed replay and encounter-choice tests cover the affected behavior.

Visual evidence uses the production HUD factory and CSS in an isolated Chromium frame.
At 960 by 540, including UI scale 0.75 and player-frame scale 0.7, the two tooltip targets
remain approximately forty pixels tall, counts remain visible and the meter stays inside
the viewport. This is component layout evidence, not physical-phone performance or a
completed full-game screenshot. Full-game automated capture attempts timed out at boot.
The earlier `partial-desktop.png` came from a stale development module and is not current
HUD evidence.

- [Partial charge, desktop component](../screenshots/shadow-priest-charges/widget-partial-desktop.png)
- [Ready, desktop component](../screenshots/shadow-priest-charges/widget-ready-desktop.png)
- [Ready, mobile component](../screenshots/shadow-priest-charges/widget-ready-mobile.png)
- [Ready, minimum supported scales](../screenshots/shadow-priest-charges/widget-ready-mobile-smallest.png)
- [Measured bounds](../screenshots/shadow-priest-charges/widget-capture.json)

Incremental validation:

| Command | Result |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run tests/priest_shadow_talent_updates.test.ts tests/priest_shadow_talent_choices.test.ts tests/priest_measured_faith_vampiric_touch.test.ts tests/shadow_charge_hud.test.ts --maxWorkers=1 --reporter=dot` | Final: 46 passed, including all five encounter comparisons, real VT pulses, delayed Dirge refresh, independent instance release, foreign ownership and Measured Faith's three-cast boundary. |
| `node node_modules/vitest/vitest.mjs run tests/priest_shadow_talent_updates.test.ts -t 'completed talented bomb' --maxWorkers=1 --reporter=dot` | One passed, 29 skipped; final literal pins for radius eight, interval two and three pulses. |
| `node node_modules/vitest/vitest.mjs run tests/priest_shadow_talent_updates.test.ts tests/priest_shadow_talent_tooltips.test.ts tests/priest_shadow_choir_presentation.test.ts tests/shadow_charge_hud.test.ts tests/architecture.test.ts tests/hud_perf_budget.test.ts tests/hud_update_drive.test.ts tests/styles_extraction.test.ts tests/css_raw_color_ratchet.test.ts tests/css_value_validity.test.ts --maxWorkers=1 --reporter=dot` | 432 passed, four skipped before the additional real-rotation regressions. Presentation, architecture, HUD cadence and CSS guards passed. |
| `node node_modules/vitest/vitest.mjs run tests/parity/parity_g.test.ts -t priest_codex --maxWorkers=1 --reporter=dot` | Final: two passed, 90 skipped, no new golden updates. This old trace protects baseline priest behavior; it does not exercise the new talents. |
| `npm run i18n:gen` and `npm run wiki:content` | Passed; regenerated outputs included. |
| `npm run check:types` | Final: passed for app, Svelte admin and bot; admin reported zero errors and warnings. |
| `npm run build:bundle` | Final: passed, 6,472 modules and 1,839 hashed media assets; backdrop survival passed. |
| `node node_modules/@biomejs/biome/bin/biome ci --colors=off --diagnostic-level=error --max-diagnostics=8 <all modified/untracked non-generated TS/CSS files>` | 88 files checked, zero errors after scoped import-order fixes. |
| `GATE_SELECT_BASE=origin/ossbrain-release/v0.45.0 npm run ci:changed` | Passed, but sees zero committed files. The explicit working-tree Biome command above covers the unstaged changes. |
| `npm run security:gate` | Passed: 11,183 files, 465 contextual flags, zero high findings after priors. |
| `node tmp/shadow_hud_isolated_capture.mjs` | Passed; production component bounds, visible counts and no browser errors recorded in the linked JSON. The script is a local ignored capture aid. |
| `GATE_SELECT_BASE=origin/ossbrain-release/v0.45.0 node scripts/gate_select.mjs` | Stops at i18n freshness: generated translations differ from staged/committed copies. No staging or commit was authorized. |
| `git diff --check` | Passed. |

Read-only simulation, frontend and coverage reviews closed their actionable findings.
The final natural-tick and encounter tests resolve the earlier simulation mismatch;
the balance table is not inferred from the green baseline parity trace. The HUD
coordinator shrinks by eleven lines and the simulation coordinator by one.

The local feature is implemented and the focused checks pass. Release readiness remains
**NOT READY** until the canonical gate completes and the previously recorded unresolved
full-suite results are classified. No full-suite pass, hardware performance result,
commit, push or publication is claimed. The refreshed development client is available
at `http://127.0.0.1:5193/` while its local process remains running.

## Medallion visual revision

The replacement uses an independent, movable and scalable frame mounted on the HUD
root. A violet liquid orb sits inside a metallic bezel, faceted crown and circular
progress ring. Five diamond gems below it show spendable Gloomtithe. Numeric counts
and the ready label remain legible without animation. Reduced motion and forced
colors remain supported. Desktop placement starts below the character; touch uses
its own persisted anchor. Interface editing and settings transfer include the frame.

Mobile height follows both meter children so the drag bounds contain the entire
component. A Chromium assertion reproduced the previous overflow and passes after
this fix at UI scale 0.75, with a forty-pixel Gloomtithe target.

Current evidence supersedes the earlier basic HUD screenshots:

- [Ready medallion detail](../screenshots/shadow-priest-medallion/medallion-ready.png)
- [Partial medallion detail](../screenshots/shadow-priest-medallion/medallion-partial.png)
- [Full game, desktop](../screenshots/shadow-priest-medallion/after-ready-desktop.png)
- [Full game, touch layout](../screenshots/shadow-priest-medallion/after-ready-mobile.png)
- [Component bounds](../screenshots/shadow-priest-medallion/component-bounds.json)
- [Game capture record](../screenshots/shadow-priest-medallion/production-capture.json)

Game captures use the development offline client, controlled resource fixtures and a
frozen simulation. They establish layout inside the rendered game, not live combat
balance or physical-phone performance. Both viewport captures recorded zero browser
errors. Read-only frontend review closed the mobile bounds finding.

Validation for this revision:

- `node node_modules/vitest/vitest.mjs run tests/shadow_charge_hud.test.ts tests/interface_unlock_core.test.ts tests/touch_frame_drag_core.test.ts tests/touch_frame_drag.test.ts tests/settings_transfer_core.test.ts tests/frame_menus.test.ts tests/css_value_validity.test.ts tests/css_token_resolution.test.ts tests/css_raw_color_ratchet.test.ts tests/hud_perf_budget.test.ts --maxWorkers=1 --reporter=dot`: 348 passed, four skipped.
- `node node_modules/vitest/vitest.mjs run tests/shadow_charge_hud.test.ts tests/css_value_validity.test.ts tests/css_token_resolution.test.ts tests/css_raw_color_ratchet.test.ts --maxWorkers=1 --reporter=dot`: 56 passed after the mobile bounds fix.
- `npm run check:ts`: passed.
- `npm run build:bundle`: passed, including backdrop survival.
- Explicit `biome ci` over this revision's HUD, registration, styles and tests: passed.
- `npm run security:gate`: passed, zero high findings after priors.
- `git diff --check`: passed.
- `GATE_SELECT_BASE=origin/ossbrain-release/v0.45.0 npm run ci:changed`: passed, zero committed files; explicit working-tree Biome validation above supplies coverage.
- `GATE_SELECT_BASE=origin/ossbrain-release/v0.45.0 node scripts/gate_select.mjs`: stopped at i18n freshness because generated outputs differ from the staged/committed copies. No staging was performed. The release-readiness limitation above remains.

## Void Rupture spender

Void Rupture is a base Shadow spell learned at level 16. It is instant, uses the
normal global cooldown, has no own cooldown or mana cost, and hits one enemy within
30 yards. It requires and consumes exactly three owned Gloomtithe charges at cast
commitment, including resisted casts. Failed target, range, line-of-sight and resource
admission leaves the bank unchanged. It neither requires Effigy nor generates charges
or bomb progress. Five gems can therefore fund Rupture followed by empowered Vampiric
Touch; the existing automatic two-gem, thirty-percent Touch upgrade is unchanged.

The provisional damage budget is 36 plus the shared instant Spell Power coefficient.
Per gem this is 12 base and one seventh Spell Power, below the complete Touch upgrade's
13.5 base and 0.15 Spell Power per gem. This establishes a starting tradeoff between
immediate damage and sustained efficiency, not a final PvP or optimized DPS verdict.

Required-aura admission and commitment now share a small combat helper. Existing
full-aura consumers retain their original consumeAuraKind path. The hotbar honors the
same owned-aura requirement; its new regression failed with a foreign five-stack bank
before the ownership filter was added.

The target effect is a bounded six-slot shader pool with inward violet filaments, a
bright irregular slit, a fragmented pressure pulse and fading smoke. One additional
program joins the existing cast preparation engine. Repeated casts allocate no new
geometry or materials. Under the highest spam degradation it retains generic hit
feedback; reduced motion removes moving ornament. The priest uses its shipped
Spellcast_Shoot release clip. Existing shadow impact audio and a distinctive procedural
fractured-eye icon complete the presentation.

Naming audit: exact-name searches found Void Rupture in unrelated settings, including
Runarcana and Voidscape. It is treated as shared generic fantasy vocabulary, not a coined
franchise term. Evidence: https://wiki.runarcana.org/en/magic/spells/void-rupture/index.html
and https://voidscape.gg/guides .

Visual acceptance includes real accepted offline casts with a controlled target and
charge fixture. The first screenshot exposed body occlusion of the central slit; the
billboard now projects toward the camera while retaining world depth testing. Capture
JSON distinguishes uncaught errors from unrelated local backend and asset-preload
console diagnostics. Screenshots freeze only presentation time after the real hit.

Final Void Rupture validation:

| Command | Result |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run tests/priest_void_rupture.test.ts tests/priest_vampiric_touch.test.ts tests/spirit_bomb.test.ts --maxWorkers=1 --reporter=dot` | 92 passed before two added integrated spender cases. |
| `node node_modules/vitest/vitest.mjs run tests/priest_void_rupture.test.ts tests/glacial_spike.test.ts --maxWorkers=1 --reporter=dot` | 24 passed, including both final integrated spender cases and legacy full-bank consumption. |
| `node node_modules/vitest/vitest.mjs run tests/void_rupture_presentation.test.ts tests/ability_icons.test.ts tests/action_bar_view.test.ts --maxWorkers=1 --reporter=dot` | Run as scoped invocations: 4, 5 and 86 passed respectively. |
| `node node_modules/vitest/vitest.mjs run tests/void_rupture_vfx.test.ts --maxWorkers=1 --reporter=dot` | Final 10 passed, including adaptive surface offset, large rigs, depth, gates, spam and lifecycle. Earlier combined engine-family/bomb routing checks also passed. |
| `node node_modules/vitest/vitest.mjs run tests/character_clipmaps.test.ts -t 'Void Rupture' --maxWorkers=1 --reporter=dot` | One passed, eleven unrelated filtered cases; shipped GLB clip binds actual priest bones. |
| `node node_modules/vitest/vitest.mjs run tests/architecture.test.ts tests/monolith_budget.test.ts tests/localization_fixes.test.ts tests/ability_tooltip_consistency.test.ts tests/ability_vfx_cast_requirements.test.ts tests/ability_vfx_frame_cost.test.ts --maxWorkers=1 --reporter=dot` | 203 passed, three skipped. |
| `npm run i18n:gen` and `npm run wiki:content` | Passed. New non-Latin fills remain pending under the contributor English-only workflow; M16 is a release/merge limitation. |
| `npm run check:types` | Passed for app, admin and bot. |
| `npm run build:bundle` | Passed, 6474 transformed modules; backdrop survival passed. |
| Explicit `biome ci` over the 21 touched increment files | Passed after final shader-file formatting. |
| `GATE_SELECT_BASE=origin/ossbrain-release/v0.45.0 npm run ci:changed` | Passed, zero committed files; explicit working-tree check above provides coverage. |
| `npm run security:gate` | Passed, 11188 files, zero high findings after priors. |
| `GATE_SELECT_BASE=origin/ossbrain-release/v0.45.0 node scripts/gate_select.mjs` | Stops at i18n freshness against staged/committed copies; no staging authorized or performed. |
| `node tmp/void_rupture_capture.mjs` | Passed: actual cast deals 63 on fixture gear, consumes 5 to 2 gems, bomb remains 5 to 5. Six bounded slots, one active. No uncaught exceptions or shader errors; local 502 and missing-asset fallback console diagnostics are recorded. |

- [Before, desktop](../screenshots/void-rupture/before-desktop.png)
- [Impact, desktop](../screenshots/void-rupture/after-desktop-impact.png)
- [Impact, mobile landscape](../screenshots/void-rupture/after-mobile-impact.png)
- [Compression phase](../screenshots/void-rupture/after-desktop-compression.png)
- [Residue phase](../screenshots/void-rupture/after-desktop-residue.png)
- [Reduced-motion shader appearance](../screenshots/void-rupture/after-desktop-reduced-motion.png)
- [Capture record](../screenshots/void-rupture/capture.json)

Simulation and frontend reviewers closed confirmed findings. Parent inspected desktop,
mobile and reduced-motion shader frames. These phase stills do not measure physical-phone
performance, repeated-cast program-count stability or live animation timing. Local feature
verification passes; publication verdict remains NOT READY for the outstanding canonical
freshness gate and translation requirements. No commit, push or publication was performed.

## Painted spender icons

Tithe Bomb and Void Rupture now have distinct painted 128x128 WebP icons, replacing
their pending-art status. Their procedural recipes remain fallback art. The bomb uses
an orbital sphere and Rupture a vertical fissure; the actual runtime resolver was
captured at 128, 48 and 32 CSS pixels on desktop and a narrow viewport.

- [Desktop comparison](../screenshots/shadow-spender-icons/before-after-desktop.png)
- [Mobile comparison](../screenshots/shadow-spender-icons/before-after-mobile.png)

Exact generation prompts and source/shipping hashes are in the priest mapping.json;
CREDITS.md identifies the project-generated assets. Shipping sizes are 6100 bytes for
the bomb and 5052 bytes for Rupture, both below the skill-icon cap. Ability learn levels
remain 20 and 16 respectively, Shadow only.

Validation: `npm run assets:skills` converted exactly the two new sources. The scoped
`node node_modules/vitest/vitest.mjs run tests/skill_icons.test.ts tests/ability_icons.test.ts tests/void_rupture_presentation.test.ts tests/release_v039_icon_art.test.ts tests/missing_painted_icons_wave.test.ts --maxWorkers=1 --reporter=dot`
initially passed 40 tests with one stale current painted-inventory pin; the corrected
`tests/release_v039_icon_art.test.ts` rerun passed all five cases. Historical sealed
inventory remains unchanged at 409; current painted inventory is 412. Scoped Biome,
`npm run check:ts`, `npm run build:bundle`, browser image decoding and `git diff --check`
passed. `GATE_SELECT_BASE=origin/ossbrain-release/v0.45.0 node scripts/gate_select.mjs`
again stopped at the existing i18n freshness boundary. No staging or publication.

## Stilled Mind and continuous Second Verse follow-up

Stilled Mind retains its next-spell free Mana and interrupt protection. For a Shadow
Priest with the talent selected it also grants an independent 60-second critical
reservation for Mindfracture or Void Rupture. Other spells can spend the original
perks without spending this reservation. A committed resisted cast consumes it;
failed admission and cancelled casts preserve it. Rupture still requires and spends
three owned Gloomtithe charges. The cooldown remains 90 seconds. Projectile effects
snapshot the reserved critical strike without mutating the shared ability or adding
an RNG draw; existing echo scaling follows actual damage as before.

Second Verse now preserves natural-tick progress across accepted refreshes of the
caster's still-active Vampiric Touch. Four pulses followed by a refresh means the next
eligible natural pulse triggers the repeat. Refresh itself triggers nothing, starts
the usual fresh tick timer, and retains optional two-charge, 30-percent empowerment.
Expired, missing, or another priest's DoT cannot supply progress. Rejected refreshes
preserve the existing DoT and charges. This supersedes the earlier reset-on-refresh
behavior. Both talent descriptions were updated in all 20 authored locale overrides.

Validation commands and outcomes:

- `node node_modules/vitest/vitest.mjs run tests/priest_stilled_mind_shadow.test.ts --maxWorkers=1 --reporter=dot`: 12 passed. Earlier combined run with `tests/priest_talent_mechanics.test.ts` and `tests/priest_void_rupture.test.ts`: 37 passed before the final two new cases.
- `node node_modules/vitest/vitest.mjs run tests/priest_shadow_talent_updates.test.ts tests/priest_vampiric_touch.test.ts --maxWorkers=1 --reporter=dot`: 64 passed; the carry regression failed before the implementation.
- `node node_modules/vitest/vitest.mjs run tests/priest_stilled_mind_presentation.test.ts tests/architecture.test.ts tests/aura_tooltip.test.ts tests/ability_icons.test.ts tests/priest_shadow_talent_choices.test.ts --maxWorkers=1 --reporter=dot`: 130 passed, one CRLF architecture failure. The locale override file was then normalized to LF.
- `node node_modules/vitest/vitest.mjs run tests/architecture.test.ts tests/localization_fixes.test.ts tests/priest_shadow_talent_tooltips.test.ts --maxWorkers=1 --reporter=dot`: final 179 passed, 3 existing skips.
- `npm run i18n:gen`, `npm run wiki:content`, `npm run check:ts`, `npm run build:bundle`, `npm run security:gate`, scoped Biome and `git diff --check`: passed. Security scan: 0 high findings after priors.
- `GATE_SELECT_BASE=origin/ossbrain-release/v0.45.0 node scripts/gate_select.mjs`: stopped at i18n freshness because regenerated artifacts differ from staged/committed versions. No staging was authorized or performed. Existing pending translations remain a release limitation; this is not a release-ready claim.

Independent simulation and tooltip reviewers found no blocking findings for this
increment. No database, layout or renderer changes were needed for this follow-up.

## Death reset correction

Death now clears both partial bomb progress and a prepared bomb. Between-pull
retention, the twenty-generation threshold and raid-pull reset remain unchanged.
The shared resurrection filter no longer retains the bomb aura, and Priest cleanup
has no death-preservation exception. English ability and HUD tooltips match this rule.

`node node_modules/vitest/vitest.mjs run tests/spirit_bomb.test.ts tests/spirit_bomb_raid.test.ts tests/priest_shadow_talent_updates.test.ts tests/resurrection.test.ts --maxWorkers=1 --reporter=dot`
passed all 117 tests. The partial/prepared death regression failed before the change.
Coverage includes idle retention, actual death at 17 and 20 progress, the shared
resurrection filter, and death mid-cast preventing damage. TypeScript, scoped Biome,
i18n and wiki generation passed. Independent coverage review found no blocking gap.

`node node_modules/vitest/vitest.mjs run tests/architecture.test.ts tests/localization_fixes.test.ts tests/shadow_charge_hud.test.ts --maxWorkers=1 --reporter=dot`
passed 173 tests with three existing skips. `npm run build:bundle` and
`npm run security:gate` passed. The selective gate with
`GATE_SELECT_BASE=origin/ossbrain-release/v0.45.0` again stopped at i18n freshness
against staged/committed copies. No staging, commit or publication was performed.
