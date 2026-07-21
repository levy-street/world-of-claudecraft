# Phase 23 (impl): AAA conformance pass

Starter prompt for a fresh Claude Code session. Paste the fenced block below
verbatim. It is self-contained; it points at the canonical packet docs by path
rather than restating them. Do not read `src/ui/hud.ts` directly (it is huge and
already modularized into `src/ui/hud/<window>.ts`); load context through the
Explore agent described in STEP 1.

### Starter Prompt

```
This is Phase 23 of the HUD Visual + UX + Accessibility feature: AAA conformance pass.

Model: Opus 4.8, max effort, 1m-context variant where the file load demands it. Harness: Claude Code.
ULTRACODE: this phase is batch-heavy (a contrast/target/focus audit fans across every
instrumented surface and every theme x text-scale combination, then applies many small
token and CSS fixes). Add `ultracode` so you orchestrate the audit-then-fix work as a
Workflow with parallel per-surface agents, not as one long serial pass.

GOAL: audit the already-shipped HUD against the WCAG 2.2 AAA criteria worth pursuing
(led by 1.4.6 Contrast Enhanced 7:1 / 4.5:1) and apply the feasible fixes via token
contrast bumps and focus/target tweaks, resolving every aesthetic-vs-legibility conflict
in favor of legibility and documenting each criterion deliberately left unmet and why.

================================================================================
STEP 0 - PRE-FLIGHT (do all of this before writing any code)
================================================================================
1. Git hygiene (SHARED WORKTREE). Run `git status`. If it is dirty with files you do not
   own, STOP and ask the user; concurrent sessions share this tree. Never `git add -A`;
   stage only this card's explicit paths.
2. CROSS-PACKET CHECKPOINT (from state.md "Cross-packet dependency"). This phase requires
   that the passes it audits have ALREADY landed: the token system (Phase 1), persistent
   chrome (Phase 7), the per-window passes (Phases 9-18), and Themes + text-scale
   (Phase 21). Confirm in progress.md that Phases 1, 7, 9-18, and 21 are `complete`, and
   that the refactor's HudContext + tokens are stable. If any prerequisite is not landed,
   STOP and surface (an AAA audit against half-instrumented surfaces produces a false
   gap list). This phase adds NO new surfaces; it tightens existing ones.
3. MEMORY SCAN. Read /Users/fernando/.claude/projects/-Users-fernando-Documents-world-of-claudecraft/memory/MEMORY.md
   and the notes it indexes for: hud, i18n, shared-worktree-commit-care,
   never-push-to-fork, no-em-dashes-or-emojis, live-site-and-test-creds. Honor all of
   them (push branches/PRs to origin levy-street, never the FernandoX7 fork; no em dashes
   or emojis anywhere; live site worldofclaudecraft.com with test creds fernando/turbo564
   and the window.__game debug hook for the live walkthrough).
4. BRANCH. Create the phase branch off the current integration base:
   `git checkout -b feature/phase-23-aaa-conformance-pass`. One card, one branch, one PR.

================================================================================
STEP 1 - LOAD CONTEXT (do NOT read planning docs or hud.ts in the main loop)
================================================================================
Spawn ONE Explore agent. Tell it to read and return a tight written summary (no raw
file dumps) of:
- docs/hud-ux-and-accessibility/state.md (locked decisions 2 and 7; invariants 2, 3, 5;
  the validation matrix rows for "Visual/token change" and "A11y change"; the
  review-dispatch matrix; the ledger of tokens/utilities already created; OPEN item on
  the muted-on-dark default pair).
- docs/hud-ux-and-accessibility/research-brief.md SECTION 2 (the WCAG 2.2 criteria table
  with thresholds, especially the AAA rows: 1.4.6 Contrast Enhanced 7:1 / 4.5:1 large,
  2.3.3 Animation from Interactions, and from Section 4 the AAA-adjacent 2.4.12 Focus
  Not Obscured Enhanced; note 2.5.8 Target Size is AA at 24x24 and the repo already
  mandates larger, and 2.5.5 Target Size Enhanced 44px is the AAA target for primary
  touch controls) and SECTION 5 (the token taxonomy: primitives are the only place raw
  hex lives, semantics carry intent, themes swap semantics via data-theme; the
  --quality-* migration; the cached readToken() helper; the APCA advisory note; the
  named OPEN contrast pair --color-text-muted #998d6a on --color-bg-surface #08080d).
- docs/hud-ux-and-accessibility/progress.md (the Phase 23 deliverable + acceptance
  checklist, and confirmation that prerequisite phases are complete).
- This phase's starter prompt (this file).
- The SPECIFIC source files, summarized individually (do NOT open hud.ts):
  * the token block(s) from Phase 1 and Phase 21 (the formalized primitive/semantic
    custom properties and the high-contrast + Okabe-Ito colorblind theme token sets;
    re-grep for the symbols, do not trust line numbers): grep the repo for the token
    file the ledger names (e.g. `src/ui/hud/tokens.css` or the formalized :root block),
    for `--quality-` , for `data-theme`, and for `--text-scale`.
  * the cached token reader: grep for `readToken` (its definition and call sites that
    feed the canvas icon/bar/slot painters).
  * the instrumented surfaces from Phases 7 and 9-18: the per-window modules under
    `src/ui/hud/` and the persistent chrome (frames, action bar, cast bar, auras,
    minimap host, FCT host). Have the agent enumerate which modules exist and where each
    sets color/contrast-bearing classes, focus rings, and target-size classes.
  * the focus-ring and target-size utilities: grep for `:focus-visible`, for the focus
    ring token (e.g. `--focus-ring` / `--color-focus`), and for the target-size token(s)
    from Phase 5 (e.g. `--target-min` / the hit-area helpers).
  * the a11y test scaffolding: `tests/a11y/` and any `tests/tokens.test.ts`,
    `tests/hud_harness.test.ts`, `tests/hud_perf_budget.test.ts`,
    `tests/localization_fixes.test.ts`, `playwright.config.ts`, `tests/visual/`.
Anchors drift: instruct the agent to re-grep every named symbol and report the CURRENT
location, never a line number from a doc.

================================================================================
STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
================================================================================
Run as a Workflow under ultracode. Two agents, A then B (B consumes A's gap list).
Give each agent ONLY the Explore summary from STEP 1 (not the raw docs).

AGENT A - Automated AAA audit (produces a prioritized gap list; makes NO code changes).
  Deliverables:
  - Run an automated AAA sweep: axe-core configured with the AAA ruleset/tags
    (`runOnly` the wcag2aaa / wcag22aaa tag set in @axe-core/playwright), plus a
    programmatic contrast-ratio computation over the resolved token pairs (compute the
    WCAG contrast ratio for every semantic text-on-surface and non-text pair, including
    the OPEN suspect --color-text-muted on --color-bg-surface). Cite the criteria and
    thresholds from research-brief.md Section 2 (1.4.6 7:1 body / 4.5:1 large; non-text
    3:1 is AA but report headroom; 2.5.5 44px enhanced target for primary touch).
  - Sweep ACROSS every shipped surface and ACROSS every theme (default, high-contrast,
    colorblind) at text-scale 1.0 and the max supported scale, since AAA must hold per
    theme. Use the harness/Playwright fixtures from Phases 1/21.
  - Output a single prioritized gap list, each row: criterion (e.g. 1.4.6), surface +
    element, measured value vs threshold, theme(s) affected, fix class (token contrast
    bump / focus-ring tweak / target-size bump / motion toggle), and an
    impact+effort priority. Flag any gap whose only fix would require a wholesale change
    to the locked dark-fantasy direction (STOPPING RULE below).

AGENT B - Apply fixes by impact (consumes A's gap list).
  Deliverables:
  - Apply the feasible fixes highest-impact first. Prefer the token layer: bump SEMANTIC
    contrast values (never touch primitives in a way that breaks other consumers; add a
    new primitive ramp step if needed) so every theme inherits the fix. For per-element
    legibility-vs-aesthetic conflicts, legibility WINS case by case (locked decision 2 /
    invariant 2): thicken the text outline/stroke token, raise text/border luminance,
    flatten a gold gradient to a higher-contrast solid where it gates legibility, widen
    a focus ring, or enlarge a hit area. Keep the look intact wherever a per-element bump
    achieves 7:1; do not restyle wholesale.
  - For any AAA criterion deliberately NOT met, record it inline in code-adjacent docs
    and in the state.md ledger with the specific reason (e.g. "1.4.6 on the FCT crit
    glyph: not met; FCT is short-lived non-body overlay text, 1.4.3 AA satisfied,
    raising to 7:1 would require abandoning the rarity hue coding; deferred as advisory
    per research-brief Section 2 which treats 1.4.6 as advisory").
  - Every NEW or changed user-visible string introduced by a fix (a new tooltip,
    an option hint, any aria-label or announcement) is a t() key added to en first
    (src/ui/i18n.en.ts); do NOT edit the locale overlays (invariant 2). Most fixes are
    token/CSS only and add no strings; if a fix adds zero strings, say so explicitly.
  - Add/extend tests: contrast-ratio assertions in tests/tokens.test.ts (or a new
    tests/a11y/contrast_aaa.test.ts) that assert the bumped pairs now meet 7:1 / 4.5:1
    per theme, and axe AAA assertions for the surfaces fixed. Keep the canvas hot path
    reading cached tokens via readToken() (invariant 5); no per-frame getComputedStyle,
    no per-frame allocations.

================================================================================
INVARIANTS THIS PHASE MUST KEEP (cited from state.md; only those in play)
================================================================================
- Invariant 2 (t()-only render sink) AND locked decision 2 (AAA legibility wins where it
  conflicts with the aesthetic, decided case by case): any new visible string is a t()
  key in en; resolve every aesthetic-vs-legibility tension toward legibility per element.
- Invariant 5 (per-frame budget): token reads on the canvas hot path go through the
  cached readToken(); never call getComputedStyle per frame; add no per-frame
  allocations; the hot-write skip rate stays above ~0.8 (tests/hud_perf_budget.test.ts).
  Contrast fixes live in tokens/CSS, not in the per-frame loop.
- Invariant 3 (DOM id/class contract): the ~214 structural ids index.html/CSS depend on
  stay stable. Bump contrast/target/focus through TOKENS and classes; never rename a
  structural id to land a fix.
- This packet DELIBERATELY changes visuals (locked decision 7): re-baseline the Playwright
  snapshots, but ONLY after reviewing the visual diff and confirming each pixel change is
  an intended legibility/contrast bump. An unreviewed --update-snapshots is not allowed.

================================================================================
OUT OF SCOPE (do not do these here)
================================================================================
- No new features (no Edit Mode, no new windows, no new Reader-Mode channels, no new
  themes). This phase tightens what already shipped.
- Anything already conformant at WCAG 2.2 AA. Do not re-litigate AA-passing surfaces;
  only push toward AAA where the audit shows feasible headroom.
- No IWorld / sim / server changes (client-only). If an AAA fix seems to need an IWorld
  member, STOP and surface (invariant 1).
- No primitive-palette rewrite or wholesale theme redesign. Targeted semantic bumps only.

================================================================================
STEP 3 - VALIDATION + MULTI-AGENT REVIEW
================================================================================
Run the state.md validation matrix rows for BOTH "Visual/token change" and "A11y change":
  - `npx tsc --noEmit`
  - `npx vitest run tests/tokens.test.ts tests/hud_harness.test.ts tests/hud_perf_budget.test.ts`
    (and the new/extended contrast test, e.g. tests/a11y/contrast_aaa.test.ts)
  - `npx vitest run tests/a11y/*.test.ts` (the axe-core assertions, configured for the
    AAA tagset on the fixed surfaces) AND `npx playwright test tests/a11y`
  - `npx vitest run tests/localization_fixes.test.ts` (any new label is a t() key)
  - The mobile screenshot script at a phone viewport (target-size/focus changes must hold
    on touch).
  - DELIBERATE VISUAL RE-BASELINE: `npx playwright test`, INSPECT the visual diff, confirm
    every changed pixel is an intended contrast/legibility/focus/target bump, THEN
    `npx playwright test --update-snapshots`. Never update snapshots before reviewing.
  - axe AAA ASSERTIONS: confirm the surfaces in the gap list now pass the AAA contrast
    rules (or are explicitly excluded with the documented reason); re-run Agent A's
    contrast computation to prove the bumped pairs cross 7:1 / 4.5:1 in every theme.

PLAYWRIGHT MCP LIVE-GAME WALKTHROUGH (always-on for this packet, per state.md):
Drive worldofclaudecraft.com (or local `npm run dev` + `npm run server`) via Playwright
MCP, logging in with the test creds / window.__game hook:
  - Switch locale to a non-English locale and confirm NO English leak from any string a
    fix touched (new tooltips/hints route through t()).
  - Toggle each theme (default, high-contrast, colorblind) and the text-scale control;
    visually confirm the bumped pairs read clearly and the dark-fantasy look survives.
  - Toggle Reader Mode where a fix touched an announced surface (confirm no regression).
  - Keyboard-only navigation across the fixed surfaces; confirm every focus ring is
    visible and the bumped focus indicator survives the dark backdrop (>=3:1).

REVIEW-DISPATCH (state.md matrix; spawn ONLY agents whose surface the diff touches):
  - This is a CLIENT-ONLY token/CSS/test diff, so the expected dispatch is `qa-checklist`
    ONLY, plus the always-on axe + visual verification above.
  - Spawn `privacy-security-review` ONLY if the diff somehow touches server/, src/admin/,
    src/net/, a CI/secret file, or toggles ALLOW_DEV_COMMANDS (it should not).
  - Spawn `migration-safety` ONLY if a DB/JSONB path is touched (it should not here).
  - Spawn `cross-platform-sync` ONLY if src/world_api.ts / src/sim / src/net / server
    wire/matchers are touched (they should not; if they are, STOP and surface).
  - For Opus 4.8: also have a FRESH subagent review the diff for correctness,
    a11y-spec/threshold conformance (did the bumped pairs actually cross 7:1 in EVERY
    theme), and requirement gaps (is each unmet AAA criterion documented with a reason).
  Prompt every review/QA agent for COVERAGE, not filtering: report every issue found, do
  not pre-judge severity. If an agent's output is truncated, resume it with:
  "Continue exactly where you left off; do not restart; emit only the remaining findings."
  Do not commit while any BLOCKING finding is open.

================================================================================
STEP 4 - COMMIT CADENCE (2 to 5 commits; explicit paths only, never git add -A)
================================================================================
Stage only this card's files by explicit path. Suggested headlines:
  1. `a11y(ui): bump semantic contrast tokens to AAA 7:1 where feasible` (the token files
     touched, e.g. src/ui/hud/tokens.css / the theme token sets from Phase 21).
  2. `a11y(ui): widen focus ring and primary touch targets toward AAA enhanced` (the
     focus-ring + target-size token/class changes).
  3. `test(ui): assert AAA contrast per theme and axe AAA on fixed surfaces`
     (tests/tokens.test.ts or tests/a11y/contrast_aaa.test.ts, axe assertions).
  4. `style(ui): re-baseline Playwright snapshots for reviewed AAA contrast bumps`
     (tests/visual/ updated snapshots, only after the reviewed diff).
  5. `docs(a11y): record AAA conformance results and deliberately-unmet criteria`
     (progress.md, state.md ledger, memory note).
Collapse to fewer commits if the change is small; keep paths explicit on every one.

================================================================================
STEP 5 - ACCEPTANCE CRITERIA (mirrors progress.md Phase 23)
================================================================================
[ ] AAA criteria audited (1.4.6 enhanced contrast 7:1 / 4.5:1 led; 2.4.12 focus
    enhanced, 2.5.5 44px enhanced target, 2.3.3 animation considered), per theme and at
    max text-scale, with a prioritized gap list produced.
[ ] Feasible fixes applied via SEMANTIC token contrast bumps and focus/target tweaks;
    every aesthetic-vs-legibility conflict resolved in favor of legibility, per element.
[ ] axe + the contrast-ratio audit clean to the committed level; every fixed pair proven
    to cross 7:1 / 4.5:1 in EVERY theme.
[ ] Each AAA criterion deliberately NOT met is documented with its specific reason
    (in the state.md ledger and code-adjacent notes).
[ ] No new features; nothing already at AA re-litigated; client-only (no IWorld/sim/
    server change).
[ ] Invariants 2, 3, 5 held; new strings (if any) are t() keys; visuals re-baselined
    with a reviewed diff; tsc + i18n guard + harness + perf skip-rate (>0.8) green.

================================================================================
STEP 6 - DOC UPDATES + MEMORY
================================================================================
- progress.md: set Phase 23 status to complete (dates), tick the Phase 23 acceptance
  boxes, and add a Notes entry summarizing which AAA criteria were met, which were
  deliberately deferred and why.
- state.md: update the ledger (any new contrast primitive ramp steps, the bumped semantic
  token values per theme, any new test file like tests/a11y/contrast_aaa.test.ts), and
  resolve the OPEN item about the --color-text-muted #998d6a on #08080d pair with the
  measured result and the fix applied.
- Memory: append a note under the hud / i18n-adjacent topics recording the AAA pass
  outcome (which criteria are now enforced by a contrast test, which are advisory and
  why), so the next phase does not re-audit them.

================================================================================
STEP 7 - FINAL RESPONSE FORMAT
================================================================================
Report, concisely:
  - STATUS: complete / blocked, one line.
  - FILES TOUCHED: absolute paths, grouped (token files, focus/target files, tests,
    visual snapshots, docs).
  - VALIDATION RESULTS: tsc, vitest (harness/perf/tokens/contrast), axe AAA pass/fail per
    surface, i18n guard, the perf skip-rate number, and the reviewed visual re-baseline
    (what changed and that you reviewed it).
  - REVIEW VERDICTS: the qa-checklist verdict and the fresh-subagent diff-review verdict
    (any BLOCKING must be resolved before this point).
  - DEFERRALS: each AAA criterion left unmet, with the one-line reason.
  - HANDOFF: one line to the Phase 24 QA session (what to re-verify, e.g. "re-run the
    AAA contrast audit per theme and the live walkthrough; confirm no AA regression").

================================================================================
STOPPING RULES (stop and surface to the user; do not push through)
================================================================================
- STOP if meeting an AAA criterion would require ABANDONING the locked dark-fantasy
  direction wholesale. A per-element legibility bump (thicker outline, higher-luminance
  text/border, a flattened gradient on one element, a wider focus ring, a bigger hit
  area) is fine and expected; a wholesale look change (e.g. dropping the gold/parchment
  language across the board to hit 7:1 everywhere) is a USER decision, not yours.
- STOP if a prerequisite phase (1, 7, 9-18, 21) is not `complete` (STEP 0.2): the audit
  would be against half-instrumented surfaces.
- STOP if any fix appears to need an IWorld / sim / server change (invariant 1): this
  phase is client-only.
- STOP if the git worktree is dirty with files you do not own (shared worktree).
```
