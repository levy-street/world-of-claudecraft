# Phase 11: Well-fed food

Farm produce becomes buff food. Per D15, a new ItemDef.wellfed arm mirrors the elixir arm
exactly: inline aura mint, ctx.applyAura, a distinct wellfed_<kind> namespace so food
never clobbers elixirs, modest classic-era magnitudes. Four dishes, one per crop tier,
give the produce ladder a consumer at every rung. docs/farming/state.md is the authority;
if this file contradicts it, state.md wins and this file plus phase-11-qa.md get swept in
the same pass.

Live-surface note (binding): LIVE, additive. The buff dishes join cooking the moment this merges:
any player with produce can cook them, eat them, and carry a well-fed buff. The elixir
slots and every existing elixir behavior are untouched.

EXECUTED 2026-08-19 (decisions locked in-phase; state.md owns the letters):
(bx) timing = COMPLETION of the sit-restore, minted by src/sim/wellfed.ts at the
updateRegen slot-null site, interruption forfeits, food-only kind guard; (by) all four
dishes share aura name 'Well Fed' and kind buff_sta, one id wellfed_buff_sta,
last-eaten-wins namespace-wide; (bz) the tier-1 dish carries the pottage-precedent
vale_wheat binder (brook_carrot is the priced D9 vegetable), keeping every farm row
uncraftable from counter stock. Magnitudes proposed 3/600s 6/900s 9/900s 12/900s,
maintainer-flagged (capstone at the elixir ceiling; 24-stamina stacking read owed).
(bw) discharged with the position-searched golden-WIN beat and the paying-band tier-3
beat; ONE isolated classified re-record, md5 83c34781 to 25bd6b87, draws 16 to 110.
The full record: docs/farming/progress.md Phase 11 and the state.md ledgers.

### Starter Prompt (the session form; refreshed by the Phase 10 QA close, 2026-08-19)

```
This is Phase 11 of the Farming feature: Well-fed food. Model: Opus 4.8 or
newer, xhigh effort (1m context variant where the file load demands it).
Harness: Claude Code. DELIVERY per D22 (standing): LOCAL-ONLY. No pushes, no
PRs. The phase lands as commits on fix/farming-phase-11-well-fed-food cut off
LOCAL feature/farming-plan, merges back --no-ff, and deletes its branch. The
gate log is the arbiter.

Goal: farm produce becomes buff food. Per D15, a new ItemDef.wellfed arm
mirrors the elixir arm exactly (inline aura mint, ctx.applyAura, the distinct
wellfed_<kind> namespace so food never clobbers elixirs, modest classic-era
magnitudes), and four BUFF dishes, one per crop tier, join the Phase 6 plain
dishes in FARM_RECIPES so the produce ladder has a buff consumer at every
rung. This phase ALSO discharges the (bw) parity debt the Phase 10 QA
ledgered (a hard gate, STEP 0 below). Phase 12's shared feast reuses this
machinery: build the arm, never a feast.

STEP 0 - PRE-FLIGHT
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan. Prefix
  EVERY shell command with cd ~/Documents/woc-farming-plan && export
  PATH=$HOME/.nvm/versions/node/v26.5.0/bin:$PATH (the Bash cwd resets
  between calls; the inherited shell has Node 24 and no pnpm).
- git status must be clean, on feature/farming-plan at or after 1b44e88fd4
  (the Phase 10 QA merge-hash record; the QA merged --no-ff as b296da117a on
  2026-08-19; verify HEAD descends from it). Stop if it is not.
- Branch fix/farming-phase-11-well-fed-food off LOCAL feature/farming-plan
  (D22: never off a bare release tip, which lacks the packet).
- Re-resolve the NEWEST release/** branch: git fetch origin --prune, then
  git branch -r --list 'origin/release/*' | sort -V, take the last row. The
  branch has absorbed release/v0.39.0 through ea9377db8e (the twentieth
  absorb, 2026-08-19). If a newer tip exists, merge it INTO the phase branch
  FIRST: the release-merge-audit skill plus the state.md deviation (al)
  absorb checklist (portrait manifest fingerprint-only re-mint via
  scripts/build_mob_portrait_source_manifest.mjs --write plus the
  accepted-art registry row; scripts/item_art_audit.mjs --verify-only; the
  ART-SUBJECT rule for any release seal over a live inventory pending-art
  items can join), re-run tests/world_api_parity.test.ts,
  tests/snapshots.test.ts, tests/command_schema.test.ts,
  tests/monolith_budget.test.ts, and tests/parity, and classify any
  farming_session golden movement before re-minting (expect the (am) shape
  on any absorb adding static world content). A minor-version jump or a
  triple-digit intersection runs the phase-06b-release-sync shape as its OWN
  mid-phase first. ABSORB TRAPS proven live: a pnpm-lock.yaml move fires the
  farm-props seal family; a patches/ move needs pnpm install; `git checkout
  --theirs <conflicted pin suite>` DISCARDS non-conflicting arms; release
  monolith ceilings can land BELOW your working count (heal by extraction,
  never a raise); the npc-looks roster demands an AUTHORED look for every
  NpcDef; the shard-weight floor heals by re-harvesting from a green
  FULL-MODE upstream run.
- BASELINES as of the Phase 10 QA merge (VERIFY by RUNNING the suites, never
  trust this prompt over them): deeds 280 / 3190 renown / 43 titles; harvest
  draws tier 1/2 EXACTLY 1 and tier 3/4 EXACTLY 2 (plant 2, denies 0);
  farming_session golden md5 83c3478142deabbffbf23912575873e9 at 16 draws
  (the (bw) re-record below moves it EXACTLY ONCE, deliberately); IWorld 329
  = 88 + 241, facets 34, commands 202/215, delta keys 87; DEED_IMAGE_IDS
  272, DEED_ART_PENDING 8. MONOLITH: hud.ts 19217/19220 (headroom 3: any
  new Hud line is extraction-first, and pin-check candidates FIRST: the S3
  localize* matchers, reliquary_window.test.ts's regex slice, the
  farm_verb_reachability containment rows, and the gatherRareEvent glue
  pins in tests/gather_event_i18n.test.ts may not move); renderer.ts
  13774/13774 EXACT ZERO (touch NOT AT ALL: the three evidence-seal
  re-mints); sim.ts and main.ts near-zero (run tests/monolith_budget.test.ts
  for the live rows; new sim logic lands as sibling modules behind the
  SimContext seam, never on the coordinators).
- (bo) BINDS THIS PHASE: tier 3/4 seeds still have NO faucet (D11 open), so
  tier 3/4 produce is unobtainable and the tier 3/4 buff dishes ship
  REAGENT-DORMANT, honestly: trainable and well-formed but uncookable until
  D11 (the Phase 6 deviations (ai)/(aj) precedent and its dormancy arms).
  Nothing may assume those seeds exist; the (bo) honesty arm in
  tests/deeds_content.test.ts must stay green (it now DERIVES the seed list
  from the crop catalog).
- (bw) IS A PHASE 11 HARD GATE (state.md, ledgered by the Phase 10 QA):
  extend the farming_session parity scenario with a seed-searched
  golden-WIN beat (the five-fold SIGNED grants, the crop-source fanout, and
  the gather_event:golden_harvest mark must reach a golden digest for the
  first time) AND re-seat the tier-3 seed-back beat in a PAYING band (the
  Phase 10 re-record left it in the zero band, degrading the scenario-level
  grant proof to 0 === 0). ONE deliberate, isolated, machine-classified
  UPDATE_PARITY=1 re-record (the (am) discipline); zero other goldens move.
- Record the phase-start commit (git rev-parse HEAD).
- Scan Claude Code memory: MEMORY.md; farming-skill-program (the PHASE 10
  and PHASE 10 QA paragraphs are the freshest record: the draw contract,
  the feedback-core lesson, the (bw) shape); golden-files-store-digests +
  parity-omit-defaults-zero-fields (the re-record discipline);
  vite-dev-module-singletons-probe (the live-client probe recipe);
  i18n-semantic-regressions-gate-trap (new keys English-only, M16 fills for
  wordy values, DISH NAMES INCLUDED: tests/i18n_completeness.test.ts reds
  on missing non-Latin item-name fills, the Phase 4 lesson);
  heavy-self-dirty-test-vacuity + heavy-self-arm-first-boundary-mail
  (eating touches bags: wireRev carries heavy-self, pin honestly);
  fanout-agent-delivery-traps (Workflow implementer lanes; custom-agentType
  reviewers on the Agent tool with the report-via-SendMessage-to-main line
  FIRST and a 25-call budget); mutation-checks-commit-first (the
  dirty-refusing runner); mutation-verdicts-need-exit-code-plus-names;
  mutation-edits-need-landing-proof (insertion mutants embed the old text:
  compare counts, not bare containment); one-probe-outranks-agreeing-agents;
  worktree-cwd-drift-misroutes-git; pkill-pattern-matches-own-shell (kill
  dev servers by port); lockfile-moves-asset-seals;
  big-diff-reviewer-turn-budgets; sim-api-green-hides-missing-player-verb
  (eating rides the EXISTING bag use verb: still verify the dish is edible
  and the buff visible as a PLAYER, no window.__game for the verb).
- READ docs/farming/state.md's head block, D15 / D17 / D22, deviations
  (ai)/(aj)/(ak) (the Phase 6 dish and recipe precedents: FARM_RECIPES is
  the home, LADDER_RECIPES is CLOSED and 3x3-pinned, never join it), (bw),
  and the OPEN list (the elixir budget ceilings and the tuning-constants
  rule: propose magnitudes, flag for the maintainer, never freeze);
  docs/farming/phase-11-well-fed-food.md whole; docs/farming/phase-11-qa.md;
  progress.md's Phase 6, Phase 10, and Phase 10 QA notes (the tier-3
  domination flag and the dish naming already shipped).

STEP 1 - LOAD CONTEXT
Spawn one Explore agent (thorough) to read and summarize: docs/farming/state.md,
docs/farming/progress.md, docs/farming/phase-11-well-fed-food.md, and these sources:
src/sim/items.ts (the useItem food arm with the p.eating / p.drinking sit-restore slots,
and the elixir arm: inline aura mint from ItemDef.elixir via ctx.applyAura with
elixir_<kind> ids), the module exporting the ItemDef type (locate by symbol), the auras
module ctx.applyAura reaches (locate by symbol), the cooking recipe content module
(locate it), src/ui/sim_i18n.ts (AURA_NAME_KEY), src/ui/auras_view.ts,
src/ui/auras_painter.ts, src/ui/elixir_tooltip_view.ts,
tests/professions_farming.test.ts, tests/recipe_economy.test.ts,
tests/localization_fixes.test.ts, and the CLAUDE.md files: root, src/sim/CLAUDE.md,
src/sim/professions/CLAUDE.md, src/ui/CLAUDE.md. The orchestrator never reads planning
docs or coordinator monoliths directly; the summary is your only context.
The summary must return, explicitly:
- The exact ItemDef.elixir field shape (aura name, kind, value, duration) and the elixir
  arm's application code path, so wellfed can mirror it field for field.
- The food path shape: where consume starts the sit-restore, where completion of the
  sit-restore is observable, and the candidate auras-module hooks for applying a buff at
  completion (the timing decision below needs these).
- The auras module's id semantics: overwrite rules within an id, duration ticking, and
  what happens to active auras across save and load (the transient behavior this phase
  must state and pin).
- How elixir_<kind> namespacing prevents the documented exclusivity-slot clobber, so
  wellfed_<kind> can copy the mechanism.
- The AURA_NAME_KEY row shape in src/ui/sim_i18n.ts, the buff display chain
  (auras_view plus auras_painter), and the tooltip seam beside elixir_tooltip_view.ts.
- The cooking recipe module, the produce item ids per tier, and where the documented
  elixir budget ceilings live (the magnitudes must sit at or below them).
- The names of the aura test suites to run in STEP 3 (list them exactly).
- The farming_session scenario shape (tests/parity/scenarios.ts
  professionsFarmingSession, seed-parameterized) and the coverage_c draw
  ledger, sized for the (bw) beats: where a golden-WIN beat and a
  paying-band tier-3 seed-back beat would slot, and the UPDATE_PARITY=1
  recipe.
- Any progress.md Notes from earlier phases touching produce, dishes, or auras.

STEP 2 - BUILD
Three implementer agents by vertical slice via Workflow (the shape that has
gone first-try in every recorded session). If two slices must touch one file,
the orchestrator lands the shared shape first as its own commit (the Phase 9
recipe: the ItemDef.wellfed type member is the obvious shared shape here);
generated artifacts (i18n regen, the golden) are ORCHESTRATOR-only re-mints
after the slices merge. Give each agent ONLY the Explore summary plus its own
bullets.
- Agent A, the wellfed arm (sim): an ItemDef.wellfed shape beside elixir
  (aura name, kind, value, duration), applied from the food path in
  src/sim/items.ts via ctx.applyAura with aura ids in the wellfed_<kind>
  namespace, never through effect_dispatch; ZERO new rng draws anywhere
  (state it in the module, pin it with a counted arm). Make the
  application-timing decision IN THIS PHASE: immediate on consume versus on
  completion of the sit-restore. The recommendation is completion (the
  sit-through-the-meal ritual); decide, state the choice and the
  auras-module hook chosen, and document it in the module and in
  progress.md Notes. Tests: application and timing, the namespace-isolation
  pin (a wellfed buff and an elixir_<kind> buff of the same kind coexist;
  neither overwrites the other), last-eaten-wins within the wellfed
  namespace, duration ticking, and the transient-across-save behavior
  stated and pinned (whatever the auras module does across save and load,
  state it and pin it).
- Agent B, the dishes (content): four BUFF dishes, one per crop tier, as
  cooking recipes in FARM_RECIPES (never LADDER_RECIPES, which is CLOSED
  and 3x3-pinned) consuming farm produce; names must not collide with the
  Phase 6 plain dishes and stay D17 IP-safe. Magnitudes at or below the
  documented elixir budget ceilings, classic-modest, flagged for the
  maintainer as tuning proposals (the state.md OPEN item). The tier 3/4
  pair ships reagent-dormant under (bo), stated at the rows. Same-change
  content obligations: committed WebP art or the ITEM_ART_PENDING
  self-clearing pattern for the four new item ids (plus the A4 distinctness
  check), M16 non-Latin fills for wordy dish names,
  crafted_item_tooltip_coverage effect text per
  docs/design/tooltip-writing.md (the write-game-tooltips doctrine), and
  the consumer-census pins re-pinned deliberately (recipes ARE visible to
  craftIdsForMaterialItem, so produce gaining recipe consumers moves them).
  Tests: recipe economy green (nothing vendors above its cheapest
  achievable inputs; crafted outputs carry no buyValue), each dish's
  wellfed field well-formed.
- Agent C, names and display (ui plus i18n): an AURA_NAME_KEY row in
  src/ui/sim_i18n.ts for every new aura name; tooltip lines beside the
  elixir tooltip view (src/ui/elixir_tooltip_view.ts is the template); the
  buff bar shows the wellfed aura through the existing auras_view plus
  auras_painter chain; English t() rows in the matching
  src/ui/i18n.catalog/ module. THE PHASE 10 QA LESSON binds: any new UI
  decision logic lands as a pure core with LEAF-path imports, never a
  domain barrel (the architecture purity guard matches import specifiers
  only, and the hud domain barrels re-export PAINTERS). Tests: S3
  (tests/localization_fixes.test.ts) and the i18n coverage arms.
After the slices merge, YOU discharge (bw): extend the farming_session
scenario with the golden-WIN beat and the paying-band seed-back beat, run
npx vitest run tests/parity to see exactly what moved, classify it (the two
new beats and nothing else), then UPDATE_PARITY=1 in an ISOLATED commit,
re-run green, and confirm no golden outside the farming scenario moved.

INVARIANTS THIS PHASE MUST KEEP
- Every dish's magnitude sits at or below the documented elixir budget ceilings; all
  crafted power stays below the raid floor.
- One knob one job: no food buff ever stacks with itself; within the wellfed namespace,
  last eaten always wins (stated and pinned).
- Every wellfed aura id lives in the wellfed_<kind> namespace; no food buff ever
  clobbers any elixir_<kind> buff, and no elixir ever clobbers any wellfed buff.
- No new effect machinery beyond the aura arm: application goes through ctx.applyAura
  from the food path, never through effect_dispatch.
- Every new aura name has an AURA_NAME_KEY row; every player-visible string added this
  phase is an English t() key in the matching src/ui/i18n.catalog/ module.
- Every existing elixir behavior is preserved unchanged.
- All randomness in src/sim/ goes through ctx.rng; this phase expects ZERO
  new draws anywhere (eat, cook, buff application; state that in the module
  and pin it); the harvest draw contract in professions/farming.ts is
  untouched.
- The (bw) re-record is deliberate, classified, isolated, and singular;
  nothing else moves.
- (bo) binds: the tier 3/4 dishes ship reagent-dormant honestly.
- No em dashes, en dashes, or emojis anywhere; every new name is IP-safe per D17.

Out of scope (do NOT do in this phase)
- The shared feast (Phase 12); the tier-4 feast buff application lands there.
- Any non-food buff source.
- Wiki prose and the asset manifest (Phase 13).
- Any change to the elixir arm, elixir ids, or elixir recipes.
- Any seed faucet or D11 decision.

STEP 3 - VALIDATION + REVIEW
Run, in order, and record each result:
- npx tsc --noEmit
- npx vitest run tests/professions_farming.test.ts tests/recipe_economy.test.ts
  tests/architecture.test.ts tests/localization_fixes.test.ts
  tests/i18n_completeness.test.ts (the Phase 4 lesson: dish names red here
  on missing non-Latin fills) plus the aura suites the Explore summary named
- npx vitest run tests/parity (green after the isolated (bw) re-record,
  nothing else moved)
- npm run ci:changed
Reviews: architecture-reviewer (sim moved: mandatory), cross-platform-sync
(the (bw) golden move plus the buff wire surface: mandatory),
content-obligations-reviewer (dishes are content: mandatory),
frontend-seam-reviewer (the tooltip and buff bar surface), then
qa-checklist LAST. Dispatch custom-agentType reviewers on the Agent tool
with the report-via-SendMessage-to-main line FIRST, a hard 25-tool-call
budget, the coverage instruction ("report every issue including
low-severity and uncertain ones; ranking happens later"), and the resume
line ("Stop reading more files. Output the full report now. Format:
BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT"); plain audit lanes may
ride a Workflow. Take every BLOCKING and SHOULD-FIX or ledger it with a
reason. Then mutation checks (after committing, through a scratchpad
runner that refuses a dirty target, only while no reviewer reads the
tree): at least eight fresh mutants, including the wellfed aura escaping
its namespace, last-eaten-wins inverted, an elixir clobbered by food (and
the reverse), a dish magnitude over its ceiling, the timing hook bypassed
(buff on consume when the decision said completion), a tier 3/4 seed
gaining a vendor faucet (the honesty arm's red direction), the (bw)
golden-WIN beat asserting nothing (vacuity probe), and an
armed-vs-unarmed non-vacuity probe on any new expansion-shaped read.
Every verdict needs rc nonzero AND named failing tests AND the summary
line; a survivor is a rig defect, dead code, or a real gap: diagnose
before adding a test. No commit while a BLOCKING stands.

STEP 4 - COMMIT CADENCE
2 to 6 Conventional Commits, each with a scope and a BODY, explicit paths only, never
git add -A, no session links or Claude attribution:
- feat(sim): the ItemDef.wellfed arm, the application-timing decision, namespace
  isolation and last-eaten-wins (with the sim tests)
- feat(content): four tier buff dishes consuming produce (with recipe economy coverage)
- feat(ui): AURA_NAME_KEY rows and wellfed tooltip lines (with i18n coverage)
- test(parity): the isolated (bw) re-record (the golden-WIN beat and the
  paying-band seed-back beat, classification stated in the body)
- docs(farming): progress, state ledgers ((bw) closed, new letters continue
  after it), the timing decision record

STEP 5 - ACCEPTANCE CRITERIA
- [ ] ItemDef.wellfed exists beside elixir (aura name, kind, value, duration), applied
      from the food path in src/sim/items.ts via ctx.applyAura with wellfed_<kind> ids,
      never through effect_dispatch.
      [AMENDED by the Phase 11 QA, 2026-08-19: the locked completion-timing
      decision (deviation (bx)) moved the application SITE to updateRegen
      (src/sim/combat/auras.ts) calling src/sim/wellfed.ts at the moment the
      consume timer runs out; src/sim/items.ts carries only a signpost
      comment. The criterion's intent (ctx.applyAura, wellfed_<kind> ids,
      never effect_dispatch) is met at that site; this bullet's wording
      predates the timing decision.]
- [ ] The application-timing decision is made, stated, and documented (recommended:
      completion of the sit-restore), including the auras-module hook chosen.
- [ ] The namespace-isolation pin is green: a wellfed buff and an elixir_<kind> buff of
      the same kind coexist and neither overwrites the other.
- [ ] Last-eaten-wins within the wellfed namespace is stated and pinned; no food buff
      stacks with itself.
- [ ] Every new aura name has an AURA_NAME_KEY row.
- [ ] Tooltip lines render beside the elixir tooltip view; the buff bar shows the
      wellfed aura with its remaining time.
- [ ] Four buff dishes, one per crop tier, consume produce; magnitudes at or below the
      documented elixir budget ceilings and flagged for the maintainer in the PR body.
- [ ] Tests green: application and timing, isolation, duration ticking, the
      transient-across-save pin, recipe economy, S3 and i18n coverage.
- [ ] (bw) discharged: the golden-WIN beat and the paying-band seed-back
      beat in the scenario, one isolated classified re-record, nothing else
      moved.
- [ ] The tier 3/4 dishes reagent-dormant honestly under (bo); the honesty
      arm green.
- [ ] Every STEP 3 validation row green; mutations all killed or
      diagnosed-and-fixed; gate_select PASS by its log markers.

STEP 6 - DOC UPDATES + MEMORY
Update docs/farming/progress.md (the Phase 11 status row, the acceptance list above
copied with its check states, a Notes block including the timing decision and the
proposed magnitudes) and the docs/farming/state.md ledgers (new items and recipes, new
i18n keys and AURA_NAME_KEY rows, the timing decision as a locked deviation entry if it
refines D15). Any deviation decided in-phase gets swept into
docs/farming/phase-11-well-fed-food.md AND docs/farming/phase-11-qa.md in the same pass.
Record genuine surprises in Claude Code memory.

STEP 7 - FINAL RESPONSE FORMAT
Report: phase status (complete or partial with reasons); files touched, grouped by
surface; validation results per command; review verdicts per agent; deferrals with
reasons; one line handing off to the Phase 11 QA session.

STOPPING RULES
- Stop if a dish cannot stay inside the documented budget ceilings without a maintainer
  call: propose the magnitudes in the progress notes and surface; never invent a higher
  ceiling.
- Stop if the auras module offers no clean completion hook and the timing decision would
  require new effect machinery: surface the design instead of building machinery.
- Stop if git status is dirty at STEP 0 or the newest release branch cannot be resolved.
- Stop before any monolith ceiling raise; before any new SimEvent type, IWorld member,
  command, or wire field; if tests/parity reds outside the farming scenario after the
  (bw) re-record (never regen other goldens to silence it).
- Stop while any review BLOCKING stands.

Close: gate via BROWSER_PATH=$HOME/.cache/ms-playwright/chromium-1228/
chrome-linux64/chrome GATE_MAX_WORKERS=8 node scripts/gate_select.mjs on the
frozen committed tree (NEVER edit while a gate runs); judge ONLY the log
markers ("[gate:select] FAIL at" / "[gate] FAIL" / "[gate:select] PASS: all
N steps green"; the exit code has lied). EXPECT the full-suite fallback (the
terrain fixture plus tests/helpers/bare_client.ts keep the planner's broad
arm live), about 15 minutes of vitest at 8 workers, and budget the
druid_engines 20 s contention timeout as the recorded environmental flake
(prove it standalone if it fires, do not chase it). Per D22: no push, no
PR; merge --no-ff into LOCAL feature/farming-plan, delete the branch and
any agent worktrees, record the merge hash in progress.md and the
farming-skill-program memory topic, and hand off to the Phase 11 QA
(docs/farming/phase-11-qa.md). Screenshots: the buff bar and tooltip are
visual surfaces; if the QA wants captures they ride the pr-screenshots
skill on the LOW preset, committed under docs/screenshots (the coned-subtree
rule applies to any NEW directory).
```
