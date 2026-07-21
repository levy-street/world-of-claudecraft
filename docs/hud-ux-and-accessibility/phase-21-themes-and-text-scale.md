# Phase 21 starter prompt: Themes + text-scale + reduced-motion

Self-contained starter prompt for a fresh Claude Code session. Paste the fenced
block below verbatim into a new session and execute. It references the canonical
packet docs by path; it does not duplicate them.

### Starter Prompt

```
This is Phase 21 of the HUD Visual + UX + Accessibility feature: Themes + text-scale + reduced-motion.

Model: Opus 4.8, max effort, 1m-context variant where the file load demands it. Harness: Claude Code.
ULTRACODE: this phase is batch-heavy (three independent surfaces: theme token sets + canvas recolor, text-scale + reduced-motion sweep across many motion sites, Options UI). Add `ultracode` so you orchestrate the three agents via a Workflow and fan them out in parallel; if you are not in an ultracode-capable session, run them as sequential subagents and keep the build green between each.

GOAL: add a high-contrast theme and Okabe-Ito colorblind-safe palettes as semantic token sets swapped via `data-theme` on the HUD root (canvas icons recolor through tokens), a user text-scale control, full reduced-motion coverage, and surface theme / text-scale / Reader-Mode controls in the Options window.

================================================================
STEP 0 - PRE-FLIGHT (do this before anything else)
================================================================
1. Shared worktree: run `git status`. The tree is shared with concurrent sessions. If it is dirty with files that are not yours, STOP and ask the operator before touching anything. Do not `git stash` or revert another session's work.
2. CROSS-PACKET CHECKPOINT (per docs/hud-ux-and-accessibility/state.md, "Cross-packet dependency"). Phase 21 requires: (a) the tokens are stable (Phase 1 landed: a primitive/semantic token layer exists, `QUALITY_COLOR` is migrated to `--quality-*` tokens, the cached `readToken()` helper exists, and `--text-scale` scaffold is present), and (b) the Options window has been extracted into its own module under `src/ui/hud/` by the ui-architecture-hud-modularization refactor (refactor Phases 15-23). Confirm BOTH by re-grepping the symbols (see STEP 1), not by trusting line numbers. If either is not met, STOP and report which checkpoint is missing; do not stub the missing seam.
3. MEMORY SCAN. Read /Users/fernando/.claude/projects/-Users-fernando-Documents-world-of-claudecraft/memory/MEMORY.md and the notes it indexes that bear on this work: hud, i18n (i18n-resolved-baseline-and-assembly), shared-worktree-commit-care, never-push-to-fork, no-em-dashes-or-emojis, live-site-and-test-creds. Honor every one. Of note: English-only PRs are legal (add keys to `en`, do NOT edit the locale overlays); never push to the fork (push to origin/levy-street); no em dashes or emojis anywhere.
4. BRANCH. Create the phase branch off the current integration base: `feature/phase-21-themes-and-text-scale`. One card, one branch, one PR.

================================================================
STEP 1 - LOAD CONTEXT (do NOT read planning docs or src/ui/hud.ts in the main loop)
================================================================
Spawn ONE Explore agent. Do not read the large docs or the monolith yourself; the Explore agent reads and returns a tight summary. Instruct it to summarize, with exact current symbol locations (it must re-grep, never trust line numbers in the docs):

- docs/hud-ux-and-accessibility/state.md: locked decisions (esp. #1 dark-fantasy direction, #2 AAA-wins-on-conflict, #7 deliberate re-baseline), the invariants list, the validation matrix row for "Visual/token change" and "A11y change", the review-dispatch matrix, and the Phase 21 ledger line.
- docs/hud-ux-and-accessibility/research-brief.md SECTION 5 in full (token taxonomy and 2.5-tier model; theming by `data-theme` token swap; `prefers-contrast` / `forced-colors` wiring; the Okabe-Ito / Wong palette and its EXACT hex values: Orange #E69F00, Sky Blue #56B4E9, Bluish Green #009E73, Yellow #F0E442, Blue #0072B2, Vermillion #D55E00, Reddish Purple #CC79A7, Black #000000; the never-color-alone rule pairing rarity with border/text/shape; rem-based type with `--text-scale` and the calc pattern; the cached `readToken()` recolor note), plus the SECTION 2 rows for 1.4.4 Resize Text (200%), 1.4.10 Reflow (320 CSS px / 256 CSS px), 1.4.12 Text Spacing, and 2.3.3 Animation from Interactions (AAA, honor prefers-reduced-motion, gameplay-essential motion exempt).
- docs/hud-ux-and-accessibility/progress.md: the Phase 21 deliverable + acceptance checklist, and the Phase 18 (Options window) note that Options "hosts the theme/text-scale/Reader-Mode controls".
- This phase prompt (so the agent shares its constraints).
- The SPECIFIC source files, named individually (re-grep each named anchor, report the file:line it actually found):
  * The Phase 1 token surface: the formalized token block (re-grep for `--palette-`, `--color-bg-surface`, `--quality-`, `--text-scale`, and the `data-theme` selector if Phase 1 already opened one). Report whether it lives in `index.html` `:root`, a `src/ui/hud/tokens.css`, or wherever Phase 1 placed it; the ledger in state.md records the chosen home.
  * The cached `readToken()` helper (re-grep `readToken`) and where its cache is invalidated. We must invalidate that cache on theme change ONLY.
  * The canvas icon painter that tints by rarity (re-grep `QUALITY_COLOR` and `--quality-` reads in `src/ui/icons.ts`) so theme swaps recolor canvas icons through tokens, not literals.
  * The extracted Options window module under `src/ui/hud/` (re-grep for the Options window class/factory and its tab/section structure). Report its exact path and how it builds rows/controls.
  * Settings + localStorage: `src/game/settings.ts` (re-grep the settings schema, the get/set/persist functions, and how existing options are persisted to localStorage). Report the persisted-settings shape and how a new key is added.
  * Every existing reduced-motion site: re-grep `prefers-reduced-motion` across `src/`, `index.html` (the brief says it is honored in 6+ places); also re-grep for animation drivers that are NOT yet gated (FCT scroll/scale, window slide-in, cast flourish, button bounce, emote-wheel spin, shake). Return the full list of motion sites so agent B knows the coverage surface.

Give the Explore agent's returned summary (only that summary) to each implementation agent below. Do not have the implementation agents re-read the big docs.

================================================================
STEP 2 - CHOOSE ORCHESTRATION + EXECUTE (fan out three agents in parallel)
================================================================
Request fan-out explicitly. Each agent receives ONLY the Explore summary plus its task. Coordinate file ownership so the three do not collide: A owns the token sets + canvas recolor, B owns the text-scale wiring + reduced-motion gating, C owns the Options UI. If A and C must both touch the token home or the Options module, use `isolation: "worktree"` and merge, or sequence A then C.

AGENT A - High-contrast + Okabe-Ito colorblind semantic token sets + data-theme swap + canvas recolor.
Deliverables:
- Define `[data-theme="high-contrast"]` and the colorblind theme(s) (`[data-theme="colorblind"]`, or per-type if the design calls for protanopia/deuteranopia/tritanopia variants; default to a single Okabe-Ito-derived set unless the Explore summary shows Phase 1 already chose otherwise) on the HUD root as ALTERNATE SEMANTIC VALUES ONLY. Primitives stay fixed; only the Tier-2 semantic tokens (and the Tier-2.5 `--quality-*` set) are overridden per theme, so everything recolors for free.
- High-contrast theme: raise text/background and non-text contrast, flatten gold gradients to solid high-luminance fills, drop parchment noise, thicken the `--text-stroke`/`--text-outline` if those tokens exist. Aim well above AA; the AAA enhanced-contrast AUDIT itself is Phase 23, not here.
- Colorblind palette: use the EXACT Okabe-Ito hex from research-brief.md section 5. Remap the hostile/friendly pair off pure red/green (hostile -> vermillion #D55E00, friendly -> bluish-green #009E73 or sky-blue #56B4E9) and design the rarity ramp (`--quality-*`) to differ in BRIGHTNESS not just hue. Never rely on color alone (WCAG 1.4.1): keep the existing border/text label and add a shape/letter cue where rarity is the only signal (coordinate with whatever Phase 1/window passes already render).
- Wire OS prefs so the default adapts before opt-in: `@media (prefers-contrast: more)` and `@media (forced-colors: active)` (under forced-colors, drop decorative gradients and let system colors take over rather than fight it). The explicit Options theme picker (Agent C) overrides the OS default.
- Canvas recolor: the canvas icon painter must read rarity/state color through the cached `readToken()` helper so a `data-theme` swap recolors canvas icons. On theme change, invalidate the `readToken()` cache EXACTLY ONCE (not per frame). Never introduce a per-frame `getComputedStyle` on the canvas hot path.
- A theme-application function (set `data-theme` on the HUD root, invalidate the token cache once, repaint affected canvas surfaces) callable by Agent C's picker.

AGENT B - Text-scale control wiring + full reduced-motion coverage.
Deliverables:
- Wire a user text-scale multiplier to `--text-scale` (the Phase 1 scaffold). Type sizes are rem-based primitives multiplied by `--text-scale` (`calc(var(--size-*) * var(--text-scale))`) or via root font-size; never vw for type (fails WCAG 1.4.4). Set `--text-scale` ONCE on change, never per frame. The control range should reach ~200% for body text (1.4.4); in-combat overlay numbers (FCT, unit-frame numbers) may stay fixed-scale since they are not body text.
- REFLOW-SAFE: verify text-scale up to the max does not clip or overlap in the DOM windows; they must reflow / scroll, honoring 1.4.10 (320 CSS px / 256 CSS px) and 1.4.12 text-spacing (no fixed heights / overflow:hidden on text boxes). If a window cannot be made reflow-safe at max scale, see STOPPING RULES.
- FULL `prefers-reduced-motion` coverage PLUS an in-game reduced-motion toggle. Audit every motion site the Explore agent returned (window slide-in, FCT scroll/scale, button bounce, cast flourish, emote-wheel spin, shake, any transition driven by `--duration-*`). Each must be disabled or reduced when EITHER the OS pref OR the in-game toggle is on. Per the budget invariant, reduced motion must actually SKIP the per-frame FCT/shake work, not merely hide it. Gameplay-essential motion (the 3D world, combat itself) is exempt (2.3.3).
- The in-game reduced-motion state lives where the other a11y/theme settings live (HudContext / settings), read once and cached, surfaced by Agent C.

AGENT C - Options UI (theme picker + text-scale slider + Reader-Mode toggle).
Deliverables:
- In the extracted Options window module, add: a theme picker (default / high-contrast / colorblind, calling Agent A's theme-application function), a text-scale control (prefer native `<input type="range">` for free slider semantics, keyboard, and value-text; wire to Agent B's `--text-scale`), a Reader-Mode toggle (a switch; the Reader Mode infrastructure exists from Phase 19, this only surfaces the persisted toggle), and a reduced-motion toggle (Agent B's in-game flag).
- EVERY label, option name, `aria-label`, switch/slider name, and `aria-valuetext` is a `t()` key added to `en` only (`src/ui/i18n.en.ts`). Do NOT edit the locale overlays. Theme names ("High Contrast", "Colorblind", "Default"), the text-scale label, the percent value-text (route the number through `formatNumber`/`Intl`, never string concat), and the toggle labels are all `t()` keys.
- Persist theme, text-scale, Reader-Mode, and reduced-motion to Settings / localStorage via `src/game/settings.ts` (extend the existing schema and persist path; do not invent a parallel store). On load, apply the persisted theme and text-scale before first paint so there is no flash. The OS-pref default applies only when the user has not made an explicit choice.
- Slider / switch ARIA per research-brief.md section 3 (slider on the focusable thumb or native range; switch via `role="switch"`+`aria-checked` or a native checkbox with a `t()` label). Reflow-safe at 200% text (1.4.10/1.4.12).

================================================================
INVARIANTS THIS PHASE MUST KEEP (cited by number from state.md "Non-negotiable invariants")
================================================================
- Invariant 2 (t()-only render sink): EVERY new aria-label, switch/slider name, theme name, option label, value-text, and announcement is a `t()` key present for `en`; numbers/percents go through `formatNumber`/`Intl`, never concat. The i18n guard (`tests/localization_fixes.test.ts`) and `npx tsc --noEmit` must stay green. Add keys to `en` only.
- Invariant 5 (per-frame budget; cached token reads): token reads on the canvas hot path go through the cached `readToken()`; invalidate that cache ON THEME CHANGE ONLY, never per frame. No per-frame `getComputedStyle`. `--text-scale` and theme are set once on change. Reduced motion must SKIP per-frame motion work. The hot-write skip rate stays above ~0.8 (`tests/hud_perf_budget.test.ts`).
- Invariant 3 (DOM id/class contract): the ~214 structural ids stay stable. Theme and scale changes go through tokens/classes and a root `data-theme` attribute, not by renaming ids.
- Invariant 8 (no em dashes or emojis): none in any doc, comment, or player-facing string.
- DELIBERATE-VISUAL note (locked decision 7): this packet intentionally changes visuals. Re-baseline the Playwright snapshots, but ONLY after reviewing the visual diff. An unreviewed `--update-snapshots` is not allowed.

================================================================
OUT OF SCOPE (do not do these here)
================================================================
- The AAA enhanced-contrast audit and 1.4.6 7:1 conformance pass: that is Phase 23. High-contrast aims well above AA but the formal AAA audit is later.
- Per-window restyle / aesthetic polish: done in the chrome pass (Phase 7) and the per-window passes (Phases 9-18). This phase only adds the theme token SETS, the scale wiring, the motion gating, and the Options controls.
- Reader Mode internals (announcer wiring, coalescing, assists): built in Phase 19. Here you only surface the persisted Reader-Mode toggle in Options.
- Any new `IWorld` member, SimEvent, wire field, endpoint, or table. If one seems needed, STOP and surface (state.md says NONE is expected; this is client-only).

================================================================
STEP 3 - VALIDATION + MULTI-AGENT REVIEW
================================================================
Run the validation matrix rows for BOTH "Visual/token change" and "A11y change" from state.md. Concretely:
1. `npx tsc --noEmit`
2. `npx vitest run tests/hud_harness.test.ts tests/hud_perf_budget.test.ts` (harness + the perf skip-rate gate; confirm skip rate > 0.8).
3. `npx vitest run tests/localization_fixes.test.ts` (new labels are `t()` keys; the i18n guard stays green).
4. Token/theme unit test: extend or add a tokens test (re-grep `tests/tokens.test.ts` from Phase 1) asserting each theme resolves its semantic tokens and the `--quality-*` mapping stays intact per theme; assert the `readToken()` cache invalidates on theme change and not per frame.
5. axe-core a11y assertions for the new Options controls (`npx vitest run tests/a11y/*.test.ts` and/or `npx playwright test tests/a11y`): slider/switch have accessible names, value/state, and visible focus.
6. Playwright MCP live-game walkthrough (drive a real browser; `npm run dev`, and `npm run server` if the build needs it): open Options; switch each theme (default/high-contrast/colorblind) and confirm DOM AND canvas icons recolor; drag the text-scale slider to max and confirm windows reflow without clipping/overlap; toggle Reader Mode and reduced-motion and confirm motion stops; do a keyboard-only nav pass over the new controls with a visible focus ring; SWITCH LOCALE and confirm no English leak in any new label/value-text.
7. Mobile screenshot script at a phone viewport (confirm the theme picker and scaled text reflow on a phone).
8. DELIBERATE RE-BASELINE: run `npx playwright test`, then REVIEW the visual diff (themes and scaled text intentionally change pixels), and only after reviewing run `npx playwright test --update-snapshots`. Never blind-update.

REVIEW-DISPATCH (state.md matrix): spawn ONLY the agents whose surface the diff touches. This is a client-only change (`src/ui`, `src/game/settings.ts`, the token home, `tests`), so the dispatch is `qa-checklist` plus the always-on axe + Playwright walkthrough. Do NOT spawn `migration-safety` or `privacy-security-review` (no server/db/secret/sim change) and do NOT spawn `cross-platform-sync` (no `IWorld`/sim/wire change); if you discover you touched any of those surfaces, STOP and surface it. For Opus 4.8, also spawn a fresh subagent to review the diff for correctness, a11y-spec conformance (slider/switch ARIA, the never-color-alone rule, reflow), and requirement gaps (not style).
- Tell each review/QA agent: aim for COVERAGE, not filtering. Report every issue you find at the appropriate severity; do not pre-suppress findings you think are minor.
- If a review/QA agent truncates, resume it with: "Continue exactly where you left off; do not restart; emit only the remaining findings."
No commit until there are no BLOCKING findings.

================================================================
STEP 4 - COMMIT CADENCE (explicit paths only; never `git add -A`)
================================================================
Stage only this card's files by explicit path. Suggested commit headlines:
1. `feat(ui): add high-contrast and Okabe-Ito colorblind theme token sets with data-theme swap` (the token home + canvas recolor + readToken cache invalidation).
2. `a11y(ui): wire user text-scale to --text-scale and extend reduced-motion coverage` (scale control wiring + the reduced-motion gate sweep).
3. `feat(ui): surface theme, text-scale, Reader-Mode, and reduced-motion controls in Options` (Options UI + settings/localStorage persistence + new `en` t() keys).
4. `test(ui): theme-resolution, axe, and text-scale reflow coverage` (tokens/a11y/harness tests + reviewed Playwright re-baseline).
5. `docs(hud-ux): record Phase 21 themes, text-scale, and motion in progress + state ledger`.

================================================================
STEP 5 - ACCEPTANCE CRITERIA (mirror progress.md, Phase 21)
================================================================
[ ] High-contrast theme + Okabe-Ito colorblind palette(s) shipped as semantic token sets, swapped via `data-theme` on the HUD root; primitives unchanged.
[ ] Canvas icons recolor on theme swap through the cached `readToken()`; the cache invalidates on theme change ONLY (no per-frame getComputedStyle); perf skip rate > 0.8.
[ ] Theme picker + text-scale control + Reader-Mode toggle (and reduced-motion toggle) in Options, all labels/value-text are `t()` keys in `en`, persisted to Settings/localStorage and applied before first paint.
[ ] Text-scale reaches ~200% body text and is reflow-safe (1.4.4 / 1.4.10 / 1.4.12); no clipping or overlap.
[ ] `prefers-reduced-motion` AND the in-game reduced-motion toggle fully honored across all HUD motion sites (motion work is skipped, not just hidden); gameplay-essential motion exempt.
[ ] Colorblind palette never relies on color alone (rarity also carries border/text/shape; brightness-differentiated ramp).
[ ] axe assertions green; i18n guard + `tsc` green; visuals deliberately re-baselined with a reviewed diff; no English leak on locale switch.

================================================================
STEP 6 - DOC UPDATES + MEMORY
================================================================
- Update docs/hud-ux-and-accessibility/progress.md: set Phase 21 status to complete (dates), check off its deliverables, and add a Notes entry recording the chosen theme set (single colorblind set vs per-type), the text-scale range, and any reflow caveat.
- Update docs/hud-ux-and-accessibility/state.md: fill the Phase 21 ledger line with the new theme token sets, the `--text-scale` wiring, the `data-theme` values shipped, the new `t()` keys (theme names, scale label, toggle labels), and any gotcha (e.g. forced-colors handling, a window that needed reflow work).
- Memory: append a short note (under the i18n-resolved/hud topic, or a new hud-themes note) recording: the shipped `data-theme` values, where the theme token sets live, that the readToken cache invalidates on theme change only, and the persisted settings keys added. No secrets.

================================================================
STEP 7 - FINAL RESPONSE FORMAT
================================================================
Report, concisely:
- Status (complete / blocked) and the branch name.
- Files touched (absolute paths).
- Validation results: tsc, harness + perf skip rate, i18n guard, tokens/a11y tests, axe verdict, the Playwright walkthrough outcome (theme recolor / reflow / motion / keyboard / locale), and confirmation the visual re-baseline diff was reviewed before updating.
- Review verdicts (qa-checklist + the Opus self-review subagent): BLOCKING / non-blocking, with what was fixed.
- Deferrals (anything punted to Phase 22 QA or Phase 23 AAA).
- One-line handoff to the Phase 22 QA session.

================================================================
STOPPING RULES (stop and surface; do not work around)
================================================================
- STOP if the Phase 1 token system or the cached `readToken()` helper is not present, or the Options window has not been extracted into its own `src/ui/hud/` module (cross-packet checkpoint unmet). Report which is missing.
- STOP if a theme swap would force a per-frame `getComputedStyle` on the canvas hot path (invariant 5). Find a cache-invalidation-on-change design instead; if impossible, surface it.
- STOP if text-scale at the target maximum causes clipping or overlap in a window that cannot be made reflow-safe (1.4.10). Report the offending window rather than shipping a clipped layout.
- STOP if the work appears to require a new `IWorld` member / SimEvent / wire field / server table (it should not; this is client-only).
- STOP if the git tree is dirty with another session's files; ask the operator first.
```
