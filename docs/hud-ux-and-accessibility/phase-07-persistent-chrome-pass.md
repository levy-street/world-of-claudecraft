# Phase 7 starter prompt: Persistent chrome visual + a11y pass

Paste the fenced block below into a fresh Claude Code session. It is self-contained.
Do not paste anything above the fence.

### Starter Prompt

```
This is Phase 7 of the HUD Visual + UX + Accessibility feature: Persistent chrome visual + a11y pass.

Model: Opus 4.8, max effort, 1m-context variant where the file load demands it. Harness: Claude Code.
ULTRACODE: this phase is batch-heavy (six persistent surfaces: player/target/party frames, action bar, cast bar, auras, minimap, floating combat text, each needing a visual restyle plus ARIA plus reduced-motion). Add ultracode so you orchestrate the three agents (A visual, B action-bar/meters, C canvas-text-equivalents) via a Workflow, fanning out the independent surfaces in parallel.

Goal: restyle the persistent chrome (player/target/party frames, action bar, cast bar, auras, minimap, floating combat text) to the dark-fantasy aesthetic via Phase 1 tokens, give the action bar a roving tabindex with t() slot labels and meter/progressbar ARIA on the bars, and give the canvas surfaces (minimap, FCT) a DOM/live-region text equivalent, all while meeting contrast and target size (AAA where feasible), honoring reduced-motion, and preserving the per-frame budget.

================================================================
STEP 0 - PRE-FLIGHT (do this before anything else; STOP on any failure)
================================================================
1. Git state. Run `git status`. This is a SHARED worktree, so other sessions may
   have unrelated dirty files. If the tree is dirty with files that are NOT yours,
   STOP and ASK the user how to proceed; do not stash or revert another session's
   work. Only continue once you are sure the working tree is clean of foreign edits.
2. CROSS-PACKET CHECKPOINT (the ui-architecture-hud-modularization refactor).
   Per docs/hud-ux-and-accessibility/state.md "Cross-packet dependency", Phase 7
   needs: (a) the persistent chrome still living in hud.ts after the refactor (the
   chrome is the part that intentionally stays in the monolith), AND (b) the
   refactor's HudContext seam present (refactor Phase 11), AND (c) Phase 1 tokens
   landed, AND (d) the Phase 3 a11y foundation landed (roving-tabindex utility,
   announcer singleton, input-mode gate on HudContext). Confirm each by grepping
   for the actual symbols (re-grep, do not trust line numbers): the HudContext
   service bag, the Phase 3 a11y utilities under src/ui/hud/a11y/ (roving_tabindex,
   announcer, input_mode), and the Phase 1 token block plus the cached readToken()
   helper and --quality-* tokens. If ANY of these is missing, STOP and surface
   exactly which checkpoint is unmet; do not start Phase 7 on an unmet checkpoint.
3. Memory scan. Read the user memory index and the relevant notes:
   /Users/fernando/.claude/projects/-Users-fernando-Documents-world-of-claudecraft/memory/MEMORY.md
   and the notes for: hud, i18n, shared-worktree, never-push-to-fork,
   no-em-dashes-or-emojis, live-site-and-test-creds. Honor all of them this phase.
4. Branch. Create and switch to the phase branch:
   `git switch -c feature/phase-07-persistent-chrome-pass`
   One card, one branch, one PR. Push to origin (levy-street), never the fork.

================================================================
STEP 1 - LOAD CONTEXT (do NOT read the planning docs or src/ui/hud.ts in the main loop)
================================================================
hud.ts is ~6,280 lines; reading it directly will blow the budget. Spawn ONE Explore
agent and have it return a single tight summary. Tell it explicitly:

"Summarize for a Phase 7 implementer. Read and condense:
 - docs/hud-ux-and-accessibility/state.md (locked decisions, the non-negotiable
   invariants by number, the validation matrix, the review-dispatch matrix, the
   key file paths, the ledger).
 - docs/hud-ux-and-accessibility/research-brief.md, ONLY sections 3 (ARIA widget
   specs: items 6 grid, 8 live regions, 9 meter, 10 progressbar) and 4 (real-time
   SR + focus model: the announcer architecture, throttling/coalescing, the
   roving-tabindex action-bar/toolbar pattern, the canvas-DOM-equivalent decision,
   the per-frame note that ARIA writes happen on state change only).
 - docs/hud-ux-and-accessibility/progress.md, the Phase 7 deliverables + acceptance
   block only.
 - This Phase 7 starter prompt (the file you are pasted from).
 - These SPECIFIC source regions, located by re-grepping the named anchors (report
   the symbols + nearby structure, NOT raw 6k-line dumps):
     * src/ui/hud.ts: the persistent-chrome regions. Re-grep for: the player frame,
       the target frame, the party/group frames, the action bar slot render + the
       drag-and-drop slot reassignment, the cast bar, the buff/debuff aura render,
       the minimap render, and the floating combat text (FCT) render. Report where
       each lives, how each currently reads color (literal vs token), and where the
       per-frame hot-write path and the hot-write dedup cache are.
     * The Phase 3 a11y utilities (src/ui/hud/a11y/): the roving_tabindex util's
       API, the announcer singleton's API (channels: status/alert/log; how Reader
       Mode gates it), and the input-mode gate (game vs ui) on HudContext.
     * The Phase 1 tokens: the primitive/semantic token block, the cached
       readToken() helper signature, and the --quality-* tokens.
     * src/ui/i18n.en.ts and the t() helper (how a key is added to en, and the
       formatNumber/formatMoney/formatDateTime helpers for value-text).
 Return: per-surface where-and-how notes, the exact a11y util/announcer/readToken
 APIs, the hot-write path location and the skip-rate test, and the exact ARIA spec
 (role/state/value) Phase 7 owes each surface. Re-grep every anchor; do not trust
 line numbers from any doc."

Do not read hud.ts yourself. Work from the Explore summary plus targeted greps for
exact edit anchors only when an agent is about to edit.

================================================================
STEP 2 - CHOOSE ORCHESTRATION + EXECUTE (fan out three agents in parallel)
================================================================
Give each agent ONLY the Explore summary (not the raw docs, not raw hud.ts). Request
fan-out explicitly. The three surfaces are mostly disjoint, but A and B both touch
the action bar and bars; if they will edit overlapping regions of hud.ts in parallel,
use `isolation: "worktree"` and merge, or serialize A then B on the shared region.

Agent A - VISUAL RESTYLE via tokens + reduced-motion on FCT.
  Deliverables:
  - Restyle player/target/party frames, action bar, cast bar, and buff/debuff auras
    to the premium dark-fantasy aesthetic (dark slate, restrained gold trim,
    parchment accents, crest flourishes) using ONLY the Phase 1 semantic tokens and
    component tokens; no raw hex/px literals introduced. Where the canvas painter
    needs a numeric color, read it through the cached readToken() helper (NEVER
    getComputedStyle on the per-frame path).
  - Generalize the existing trim/bevel treatment into the frame/aura chrome via the
    token-driven border + inset box-shadow + gradient approach (research-brief
    section 5), so high-contrast/colorblind themes recolor for free later.
  - Reduced-motion on FCT: gate the FCT scroll/scale/shake animation behind the
    reduced-motion flag so the per-frame FCT work is actually SKIPPED (not merely
    hidden) when reduced motion is on. Same gate on any cast-bar flourish.
  - Keep cast-bar fill vs track, aura type-coding borders, and minimap blips at
    >=3:1 non-text contrast (research-brief 1.4.11).

Agent B - ACTION BAR roving tabindex + t() slot labels + bar ARIA.
  Deliverables:
  - Make the action bar a roving-tabindex toolbar using the Phase 3 roving_tabindex
    util: role="toolbar" with a t() aria-label and orientation; exactly one slot has
    tabindex=0, Tab moves into/out of the whole bar as one stop, arrows move between
    slots, Home/End jump (research-brief section 4, toolbar pattern). CRITICAL
    collision rule: the bar's roving DOM focusability is live ONLY in UI input mode;
    in game mode the bar is presentational and 1-0 go straight to the sim. Wire this
    through the Phase 3 input-mode gate; never swallow hotkeys during normal play.
  - Each slot gets a composed t() aria-label = keybind + ability name + state
    ("Fireball, 1, ready" / "Fireball, 1, 3 seconds"), updated via the hot-write
    dedup cache (re-setAttribute only on actual value change). Add the keys to
    src/ui/i18n.en.ts only.
  - Meter/progressbar ARIA on the bars (research-brief section 3 items 9 and 10):
    role="meter" with aria-valuenow/min/max and aria-valuetext for HP and the
    resource bar (mana/rage/energy) and the XP bar (use meter for XP per the brief's
    lean); role="progressbar" with aria-valuenow (determinate only) for the cast
    bar. aria-valuetext routes numbers through formatNumber/formatMoney/Intl, never
    string concat ("4,820 / 6,000 health"). PER-FRAME: do NOT write valuenow/
    valuetext every frame; update at a coarse cadence (a few Hz / on threshold
    crossings) while the canvas bar animates smoothly. Meters are not focusable.

Agent C - CANVAS SURFACE TEXT EQUIVALENTS (minimap + FCT).
  Deliverables:
  - Minimap: a hidden DOM list (visually-hidden, focusable/navigable) of the
    minimap pins/blips (the parallel sub-DOM the brief mandates for canvas surfaces,
    section 3 cross-cutting + section 4). Each pin entry is a t()-labeled item; the
    list updates on state change only, never per frame.
  - FCT: a polite live-region announcement hook for salient floating-combat-text
    events, routed through the Phase 3 announcer's status channel and GATED BY
    READER MODE (off by default). This phase only adds the FCT announcer HOOK;
    full Reader-Mode combat wiring is Phase 19 and is out of scope here.
  - HARD CONSTRAINT: when Reader Mode is OFF, the canvas text-equivalent must cost
    NOTHING on the per-frame path (no per-frame DOM writes, no per-frame allocation,
    no getComputedStyle). The hidden list rebuilds only on state change; the FCT
    announcer is dormant unless Reader Mode is on.

After fan-out: reconcile the three diffs, run tsc, and have a fresh subagent review
the merged diff for correctness, ARIA-spec conformance, and per-frame-budget safety
(see STEP 3) before you proceed.

================================================================
INVARIANTS THIS PHASE MUST KEEP (cited by number from state.md "Non-negotiable invariants")
================================================================
- Invariant 5 (per-frame budget). The per-frame core stays imperative under rAF;
  ADD NO per-frame allocations. Canvas token reads go through the CACHED readToken()
  (never getComputedStyle per frame). The hot-write skip rate stays above ~0.8
  (tests/hud_perf_budget.test.ts). The canvas text-equivalent (Agent C) costs
  nothing when Reader Mode is off. ARIA valuenow/valuetext/label writes happen on
  STATE CHANGE only, through the dedup cache (extend it to aria attributes).
- Invariant 6 (a11y does not regress gameplay). The input-mode gate must never
  swallow movement/hotkeys during normal play; the action bar's roving focus is
  live only in UI mode. No focus trap on this always-on chrome.
- Invariant 2 (t()-only render sink). EVERY new aria-label, aria-valuetext, slot
  label, minimap-pin label, and FCT announcement is a t() key added to en first
  (src/ui/i18n.en.ts). Do NOT edit the locale overlays; the maintainer batch-fills
  at release. Numbers/money/percents via formatNumber/formatMoney/formatDateTime/
  Intl, never concat. The i18n guard (tests/localization_fixes.test.ts) stays green.
- Invariant 3 (DOM id/class contract). The ~214 structural ids index.html/CSS
  depend on stay stable. Visual changes go through tokens/classes, NOT by renaming
  structural ids.
- Deliberate visual change (locked decision 7 / invariant note): this packet
  INTENTIONALLY changes visuals. Re-baseline Playwright snapshots only after
  reviewing the diff; an unreviewed --update-snapshots is not allowed.

================================================================
OUT OF SCOPE (do not do these here)
================================================================
- The windows (Spellbook, Bags, Character, Talents, QuestLog, Social, Trade, Market,
  Arena, Options). Those are the per-window passes, Phases 9-18.
- Wiring Reader Mode combat announcements end to end. Phase 19 builds on the FCT
  announcer hook you add here; you add only the hook (dormant unless Reader Mode on).
- Themes, text-scale UI, Edit Mode, soft-target/earcon assists (later phases).
- Any IWorld / sim / server change. None is expected; if one seems needed, STOP and
  surface (state.md: no new IWorld member expected this packet).

================================================================
STEP 3 - VALIDATION + MULTI-AGENT REVIEW (run the state.md matrix for this change type)
================================================================
This is a visual + a11y change, so run BOTH rows of the validation matrix:

A. Types + unit + perf + i18n:
   - `npx tsc --noEmit`
   - `npx vitest run tests/hud_harness.test.ts tests/hud_perf_budget.test.ts`
     (the perf file is the skip-rate gate; confirm skip rate stays > 0.8).
   - `npx vitest run tests/localization_fixes.test.ts` (new labels are t() keys).
B. A11y assertions (axe-core):
   - `npx vitest run tests/a11y/*.test.ts` and/or `npx playwright test tests/a11y`.
   - Assert: action bar exposes role="toolbar" + roving tabindex; HP/resource/XP
     bars expose role="meter" with valuenow/valuetext; cast bar exposes
     role="progressbar"; the minimap hidden list and FCT region exist; axe reports
     no new violations on the chrome.
C. Playwright MCP live-game walkthrough (use live-site/test creds + window.__game
   debug hook per the live-site memory note; or `npm run dev` + `npm run server`):
   - Switch locale to a non-English locale and confirm NO English leak in any new
     chrome label/announcement (every visible new string resolves via t()).
   - Toggle reduced-motion and confirm FCT/cast-flourish motion stops AND the
     per-frame FCT work is skipped (not just hidden).
   - Keyboard-only nav: Tab reaches the action bar as ONE stop, arrows move between
     slots, Home/End jump, Tab exits; visible :focus-visible ring on the focused
     slot; confirm in game mode 1-0 still cast and WASD still moves (no swallow).
   - Toggle Reader Mode on and confirm the FCT announcer fires politely; toggle it
     off and confirm zero per-frame cost (no DOM churn) on the canvas equivalents.
   - (Themes/text-scale UI do not exist yet; just confirm tokens render correctly.)
D. Mobile: run the phone-viewport screenshot script and eyeball the restyled chrome.
E. Deliberate visual re-baseline: run `npx playwright test`, REVIEW the visual diff
   image-by-image (the chrome SHOULD change; confirm only intended pixels moved),
   then `npx playwright test --update-snapshots`. Never update snapshots unreviewed.

Multi-agent review dispatch (state.md review-dispatch matrix). Spawn ONLY the agents
whose surface this diff touches. This is a client-only change (src/ui/hud.ts,
src/ui/hud/a11y, src/ui/i18n.en.ts, tests, CSS/tokens), so:
   - SPAWN: `qa-checklist` (every phase).
   - Do NOT spawn migration-safety (no characters.state / *_db path; no Edit Mode
     server sync here).
   - Do NOT spawn privacy-security-review (no server/admin/net, no SQL/auth/secret,
     no ALLOW_DEV_COMMANDS, no Math.random/Date.now/performance.now in sim).
   - Do NOT spawn cross-platform-sync (no IWorld/sim/SimEvent/wire change; if you
     find you need one, STOP and surface).
Prompt every review agent for COVERAGE, not filtering: "report every issue you find
across the whole diff; do not down-select to a top few." If an agent truncates,
resume it with: "Continue from where you stopped; do not repeat what you already
reported; cover the remaining files." Do not commit while any BLOCKING item is open.

For Opus 4.8: before declaring done, a FRESH subagent reviews your merged diff for
correctness, ARIA-spec conformance (roles/states/values match research-brief
section 3), per-frame-budget safety (no new allocations, cached token reads, skip
rate > 0.8, Reader-Mode-off costs nothing), and requirement gaps (not style).

================================================================
STEP 4 - COMMIT CADENCE (explicit paths only; NEVER `git add -A`)
================================================================
Stage only this card's files by explicit path (shared worktree). Suggested headlines
(Conventional Commits with a scope):
  1. style(ui): restyle persistent chrome (frames, action bar, cast bar, auras) via dark-fantasy tokens
  2. a11y(ui): action bar roving tabindex + t() slot labels (keybind + ability + state)
  3. a11y(ui): meter/progressbar ARIA on HP/resource/cast/XP bars (coarse-cadence, dedup-cached)
  4. a11y(ui): hidden minimap pin list + Reader-Mode-gated FCT announcer hook
  5. docs(hud-ux): Phase 7 progress + state ledger; test(ui): chrome a11y + visual baselines
(Combine where natural; keep each commit to its explicit file paths.)

================================================================
STEP 5 - ACCEPTANCE CRITERIA (mirror progress.md Phase 7; all must be checked)
================================================================
[ ] Unit/target/party frames, action bar, cast bar, auras restyled to the aesthetic via tokens.
[ ] Action bar uses roving tabindex with t() slot labels (keybind + ability name).
[ ] Canvas surfaces (minimap, FCT) get a hidden DOM/live-region text equivalent.
[ ] Contrast/target-size to AAA where feasible; reduced-motion honored on FCT.
[ ] Per-frame budget preserved (cached token reads); skip rate > 0.8; visuals re-baselined with reviewed diff.
[ ] Bar ARIA: HP/resource/XP = meter, cast = progressbar; value-text via formatters; coarse-cadence updates.
[ ] Action-bar roving focus is live only in UI mode; game mode keeps 1-0 / WASD intact.
[ ] FCT announcer hook is dormant (zero per-frame cost) when Reader Mode is off.

================================================================
STEP 6 - DOC UPDATES + MEMORY
================================================================
- progress.md: set Phase 7 status, fill the deliverable/acceptance checkboxes, add a
  Notes entry (what shipped, any deferral, the chosen ARIA cadence and queue cap).
- state.md ledger: under "Created by this packet", add the Phase 7 row (new chrome
  component tokens used, the action-bar toolbar wiring, the minimap hidden-list
  helper, the FCT announcer hook, new test files). Update "Current phase". Resolve or
  carry the relevant OPEN items (XP-bar role chosen as meter; minimap/FCT canvas
  text-equivalent settled; ARIA meter cadence chosen).
- Memory: add a hud note recording the Phase 7 decisions (XP=meter, cast=progressbar,
  FCT announcer hook gated by Reader Mode, action-bar roving live only in UI mode)
  so later phases (19 especially) build on the hook rather than re-deriving it.

================================================================
STEP 7 - FINAL RESPONSE FORMAT
================================================================
Report, in this order:
  - Status: complete / blocked, and on which branch.
  - Files touched (absolute paths).
  - Validation results: tsc; harness + perf skip-rate (the number); i18n guard;
    axe results; the Playwright MCP walkthrough findings (locale leak none/which,
    keyboard nav, reduced-motion skip confirmed, Reader-Mode-off zero-cost confirmed);
    the visual re-baseline (which snapshots changed and that the diff was reviewed).
  - Review verdicts: qa-checklist verdict and the fresh-subagent diff-review verdict
    (BLOCKING items, if any, and how resolved).
  - Deferrals: anything pushed to a later phase (e.g. full Reader-Mode FCT wiring -> Phase 19).
  - One-line handoff to QA (Phase 8).

================================================================
STOPPING RULES (stop and surface; do not push through)
================================================================
- STOP if a restyle adds per-frame allocations or drops the perf skip rate below 0.8.
- STOP if a canvas text-equivalent would cost per-frame work when Reader Mode is off.
- STOP at pre-flight if any cross-packet checkpoint is unmet (chrome not in hud.ts,
  HudContext/Phase 3 utils/Phase 1 tokens missing).
- STOP if the change seems to need a new IWorld member, a sim/server edit, or a
  structural id rename; surface instead.
- STOP if the working tree is dirty with another session's files (shared worktree).
- STOP if axe reports a new violation you cannot resolve, or the i18n guard fails on
  a non-en edit you did not intend.
```
