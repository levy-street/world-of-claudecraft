# Phase 12: The shared feast

The tier-4 showcase per D16: a placeable feast other players eat from, the communal
payoff at the top of the crop ladder. The feast is a REAL entity riding the normal entity
snapshot (the battleground-flag precedent), with server-owned charges, a per-player
consumed ledger, and tick-domain expiry, transient and never serialized.
docs/prd/masterwrought/farming/state.md is the authority; if this file contradicts it, state.md wins and
this file plus phase-12-qa.md get swept in the same pass.

Live-surface note (binding; AMENDED at phase start, 2026-08-19, deviation (ca)):
REAGENT-DORMANT-HONEST, the tier 3/4 dish pattern. The whole loop is live code-side
the moment this merges: placing a feast, eating from it once per player for the tier-4
well-fed buff, the charges, the expiry, and every deny arm are all reachable through the
real client and proven through tests and granted-item probes. But the recipe's tier-4
produce reagents have no faucet until the D11/(bo) seed-bootstrap ruling, so no player
can COOK the feast yet; the wiki-visibility ledger's (bo) addendum owns the third
advertised dormant row. This supersedes the original "LIVE, nothing dormant" wording:
state.md (ca) records the decision and the option-3 rationale (a reachable reagent mix
would have built the tier-4 showcase from tier 1/2 produce and permanently undercut the
tier-4 dishes once D11 opens the faucet).

### Starter Prompt (the session form; refreshed by the Phase 11 QA close, 2026-08-19)

```
This is Phase 12 of the Farming feature: The shared feast. Model:
Opus 4.8 or newer, xhigh effort (1m context variant where the file load
demands it). Harness: Claude Code. DELIVERY per D22 (standing):
LOCAL-ONLY. No pushes, no PRs. The phase lands as commits on
fix/farming-phase-12-shared-feast cut off LOCAL feature/farming-plan,
merges back --no-ff, and the branch is deleted. The gate log is the
arbiter.

Goal: a placeable feast other players eat from, the communal payoff at
the top of the farming ladder (D16): a REAL entity on the normal entity
snapshot (the battleground-flag precedent), server-owned charges, a
per-player consumed ledger, tick-domain expiry, transient and never
serialized. This phase ALSO DISCHARGES the recorded wellfed parity-beat
deferral (STEP 2, beat P).

STEP 0 - PRE-FLIGHT
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan.
  Prefix EVERY shell command with cd ~/Documents/woc-farming-plan &&
  export PATH=$HOME/.nvm/versions/node/v26.5.0/bin:$PATH (the Bash cwd
  resets between calls; the inherited shell has Node 24 and no pnpm).
- git status must be clean, on feature/farming-plan at or after
  deffe3a5d4 (the Phase 11 QA merge-hash record; the QA merged --no-ff
  as 0bb8468cd6 on 2026-08-19). Stop if it is not.
- Branch fix/farming-phase-12-shared-feast off LOCAL feature/farming-plan.
- Re-resolve the NEWEST release/** branch: git fetch origin --prune,
  then git branch -r --list 'origin/release/*' | sort -V, take the last
  row. The branch has absorbed release/v0.40.0 through e56707a675 (the
  twenty-first absorb, 2026-08-19). If a newer tip exists, absorb per
  D22 FIRST (release-merge-audit plus the state.md deviation (al)
  checklist; a minor-version jump or triple-digit intersection runs the
  06b shape as its OWN mid-phase; classify any farming_session movement
  before re-minting, expecting the (am) shape on static world content).
- RECONCILE THE LIVE-SURFACE COLLISION BEFORE WRITING CODE: the binding
  Live-surface note above says LIVE, nothing dormant, but state.md WINS
  and its OPEN (bo) says tier-4 produce (evergarden_greens) has NO seed
  faucet until the D11 ruling; the Phase 11 QA also ledgered that the
  wiki already advertises two reagent-dormant recipes. A produce-heavy
  tier-4 feast recipe is uncraftable today. Decide AT PHASE START,
  record the decision as a deviation, and sweep this file plus
  phase-12-qa.md in the same pass: (1) obtain the D11/(bo) ruling first
  (preferred; the four options are in the state.md OPEN list), (2) a
  reagent mix reachable today (note: routing through the tier-4 DISH as
  an ingredient is still (bo)-bound; check the whole chain), or
  (3) amend the Live-surface note to reagent-dormant-honest like the
  tier 3/4 dishes, accepting a dormant showcase and stating it in the
  wiki-visibility ledger. If none can be decided in scope, STOP and
  surface to the maintainer.
- BASELINES as of the Phase 11 QA merge (VERIFY by RUNNING the suites,
  never trust this prompt over them): farming_session golden md5
  25bd6b8774f913279c96dddb25f93403 at 110 draws / 1577 ticks; deeds
  280 / 3190 renown / 43 titles; IWorld 329 = 88 + 241, facets 34,
  commands 202/215, delta keys 87; FARM_RECIPES 13, NEVER_STOCKED 20;
  ITEM_ART_PENDING 43 (the audit CLI's pendingArtCount literal) with
  the v039 pending-hotbar literal 16. MONOLITH: hud.ts 19219/19220
  (ONE line of headroom: any new Hud line is extraction-first, and
  pin-check candidates FIRST: the S3 localize* matchers,
  reliquary_window.test.ts's regex slice, the farm_verb_reachability
  containment rows, the gather_event_i18n glue pins); renderer.ts
  13774/13774 EXACT ZERO, and ANY renderer.ts edit stales the THREE
  evidence-seal families (three sanctioned re-mints): the feast render
  surface therefore DEFAULTS to an arm inside an already-composed
  module (src/render/farm_patches.ts); a dedicated src/render/feast.ts
  needs renderer.ts wiring and so requires budgeting a renderer
  extraction PLUS the seal re-mints, a deliberate choice stated in
  progress.md. sim.ts 12657/12660 and main.ts 11454/11460 are
  near-zero: extraction-first everywhere.
- THE WELLFED MACHINERY THIS PHASE CONSUMES (read state.md
  (bx)/(by)/(bz) and the Phase 11 + Phase 11 QA progress records): the
  mint lives in src/sim/wellfed.ts (applyWellfedOnConsumeComplete),
  hooked from updateRegen in src/sim/combat/auras.ts, NOT in items.ts
  (deviation (bx); the phase file's old items.ts pointer is stale). The
  aura is id wellfed_buff_sta, name 'Well Fed', kind buff_sta, school
  nature, value 12 at tier 4, last-eaten-wins NAMESPACE-WIDE ((by)): a
  feast bite replacing a lesser dish buff is correct; a tier-1 dish
  eaten after the feast downgrades it, also correct. DECIDE AND
  DOCUMENT whether the feast bite rides a consume slot (the 18s
  sit-restore and its interruption-forfeit rules) or mints instantly at
  the interaction arm; either way the mint stays in the wellfed_<kind>
  namespace and draws ZERO rng.
- Scan Claude Code memory: MEMORY.md; farming-skill-program (the PHASE
  11 and PHASE 11 QA paragraphs are the freshest: the tick-phase
  parity-beat enrichment, the desktop eat verb is LEFT-click on the bag
  row, locale probes await ensureLocaleLoaded before setLanguage, the
  wellfed/elixir stat-map parity pin);
  sim-api-green-hides-missing-player-verb (BOTH new verbs, place and
  consume, ship their real CLIENT paths in this same phase, the (bn)
  lesson: play as a PLAYER, no window.__game for the verbs);
  renderer-edit-stales-evidence-seals; lockfile-moves-asset-seals;
  screenshot-dirs-need-ci-cone-rows + screenshots-on-low-graphics;
  event-forced-read-races-the-state-frame (feast events vs snapshot
  frames online); heavy-self-dirty-test-vacuity +
  heavy-self-arm-first-boundary-mail (placement consumes a bag item:
  check wireRev vs command-side heavy-self marking);
  parity-omit-defaults-zero-fields + golden-files-store-digests;
  mutation-checks-commit-first +
  mutation-verdicts-need-exit-code-plus-names +
  mutation-edits-need-landing-proof (the dirty-refusing runner);
  fanout-agent-delivery-traps + big-diff-reviewer-turn-budgets
  (report-first line, hard budgets, budget one nudge round);
  worktree-cwd-drift-misroutes-git; pkill-pattern-matches-own-shell
  (kill dev servers by port); no-claude-session-links.

STEP 1 - LOAD CONTEXT
Spawn one Explore agent (thorough; hard 45-tool-call budget;
report-first) to read and summarize: docs/prd/masterwrought/farming/state.md,
docs/prd/masterwrought/farming/progress.md (the Phase 11 and Phase 11 QA records
included), this file, and these sources: src/world_api/farming.ts (the
IWorldFarming facet as it stands), tests/world_api_parity.test.ts (the
pinned member lists and their three-snapshot anchor trap),
src/sim/interaction.ts (the interaction arm pattern),
src/sim/quests/interact_object_credit.ts (the creditedObjects
stable-content-key ledger idiom), src/sim/professions/farming.ts
(updateFarming and the tick append rule), the entity snapshot path
(locate the battleground-flag precedent by symbol across
src/net/online.ts and server/game.ts), src/sim/wellfed.ts plus the
updateRegen hook in src/sim/combat/auras.ts (the REAL wellfed arm), the
Phase 9b client interact funnel (src/game/farm_bed_interact.ts, the
main.ts interactKey site, nearby_interaction) and the bags use path
(the place verb's likely client seam), the cooking recipe content
module, scripts/assets/farm_props/export_farm_props.mjs,
src/render/farm_patches.ts, src/game/audio.ts plus
scripts/sfx/sfx_prompts.mjs (the cue recipe), tests/snapshots.test.ts,
tests/env_protocol.test.ts, tests/bandwidth.test.ts, and the CLAUDE.md
files: root, src/sim/CLAUDE.md, src/sim/professions/CLAUDE.md,
src/ui/CLAUDE.md, src/render/CLAUDE.md. The orchestrator never reads
planning docs or coordinator monoliths directly; the summary is the
only shared context. The summary must return, explicitly:
- The IWorldFarming member list and the command plumbing pattern in
  BOTH Sim and ClientWorld, plus where the parity test pins members.
- The battleground-flag precedent in full: how a sim-spawned entity
  enters the entity snapshot, which wire fields it rides, what
  applyWire needs, and what the renderer needs for a new entity kind.
- The interaction arm pattern and the stable-content-key ledger idiom,
  shaped for a per-player consumed ledger.
- The Phase 9b interact funnel shape and how a NEW interactable entity
  kind joins it (the consume verb's client path), plus the bag-use
  path for the place verb (desktop use is LEFT-click on the bag row).
- Where updateFarming sits in the tick and how the despawn and expiry
  check rides INSIDE that driver without reordering anything.
- How the feast grants the tier-4 wellfed buff using ONLY the Phase 11
  machinery (src/sim/wellfed.ts idiom; zero draws expected; the
  consume-slot vs instant-mint decision surface).
- The announce-and-route precedents: which existing test drives
  multiple online sessions, for the routing test.
- The farm_props exporter structure and the farm_patches.ts adapter
  pattern (footprint and pivot conventions for a swap-ready prop), the
  VFX seam, and the full SFX cue recipe.
- The cooking recipe module and the economy pins an expensive
  produce-heavy tier-4 recipe must satisfy, PLUS the whole-list
  invariant every FARM_RECIPES row keeps ((bz): at least one reagent no
  counter stocks and no vendor prices) and
  crafted_item_tooltip_coverage's effect-or-purpose demand.
- The parity scenario shapes: how professionsFarmingSession appends
  beats (the (bw) discharge as the template) and what a NEW scenario
  costs vs an append.
- Any progress.md Notes from earlier phases touching entities,
  snapshots, interaction, or the wellfed arm.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
The proven build shape (Phases 9 to 11): the orchestrator lands a
SHARED-SHAPE commit first (the types, the FeastState skeleton, the
IWorldFarming member with both-world stubs, the parity pin update) so
every lane compiles, then parallel implementer lanes in SEPARATE git
worktrees (all slices touch shared files), cherry-picked or folded at
integration. Fan-out reminders: spawn the lanes in one message; give
each ONLY the Explore summary plus its own bullets; never run a
teammate in plan mode.
- Lane A, the feast core (sim): a NEW module
  src/sim/professions/feast.ts owning FeastState (owner, charges
  remaining, tick-domain expiry, a per-player consumed ledger via the
  stable-content-key idiom). Placement and consumption draw ZERO rng;
  state that in the module. The interaction arm: consuming grants the
  tier-4 wellfed buff via the src/sim/wellfed.ts machinery, decrements
  a charge, once per player per feast. Despawn on zero charges or
  expiry via a check riding INSIDE the already-anchored updateFarming
  driver, never a second appended sweep. Every deny arm (no charges,
  already consumed, expired, out of range, anti-abuse) is a text-free
  id-carrying SimEvent. Decide the anti-abuse rule IN THIS PHASE (one
  active feast per player OR a placement cooldown); state and document
  it. Document the transient rationale (tick-domain expiry is not
  restart-safe, the mobile-station rationale). Tests: place, consume,
  once-per-player, charges, expiry, every deny arm both directions, a
  same-seed determinism pin.
- Lane B, the seam, the wire, and the CLIENT PATHS (world_api plus net
  plus server plus game): placeFeast on IWorldFarming (the facet file,
  never the barrel), implemented in BOTH Sim and ClientWorld in the
  same change, parity pin updated (anchor on a name unique to the
  target list: the three-snapshot trap). The feast spawns a REAL entity
  riding the normal entity snapshot; no new wire mechanism. BOTH verbs
  get real client paths in this phase: place through the bag-use verb
  (or a placement affordance; state the choice), consume through the
  interact funnel's new feast arm (the farm_bed_interact precedent:
  pure resolver module, main.ts stays thin). A multi-session online
  routing test per the announce-and-route precedents (placer places, a
  second session sees the entity and consumes, the charge decrement
  routes back; mind the event-vs-snapshot frame race). Snapshots suites
  stay green.
- Lane C, the item and the words (content plus i18n): the feast item as
  an expensive produce-heavy tier-4 cooking recipe honoring the (bz)
  whole-list invariant and the STEP 0 (bo) reconciliation; recipe
  economy green; no buyValue on the crafted output;
  crafted_item_tooltip_coverage satisfied (the item tooltip states
  placement AND the buff per docs/design/tooltip-writing.md; the
  write-game-tooltips rules); the placer's name in the feast title as a
  t() key in the "{name}'s Harvest Feast" shape (the name is a value,
  the text is the key); English rows in the matching
  src/ui/i18n.catalog/ module with the five non-Latin fills for every
  wordy new value (M16); S3 coverage for every new emit; ITEM_ART_PENDING
  and the audit-CLI literal re-pinned if the item ships procedural.
- Lane D, the look and the sound (render plus audio): the feast prop in
  scripts/assets/farm_props/export_farm_props.mjs (swap-ready: fixed
  footprint and pivot per D19); the render surface per the STEP 0
  renderer constraint (default: an arm inside src/render/farm_patches.ts,
  which is already composed; a dedicated src/render/feast.ts only with
  a budgeted renderer extraction plus the three seal re-mints, the
  choice stated in progress.md); placement VFX; a feast cue: UI_CUES
  key, facade method in src/game/audio.ts, the hud case (hud.ts has ONE
  line of headroom: extraction-first if the case costs a line), a
  prompt row in scripts/sfx/sfx_prompts.mjs, placeholder clip via
  npm run sfx:ui (--ffmpeg node_modules/ffmpeg-static/ffmpeg on this
  box), then npm run sfx:manifest and npm run sfx:check. Tests: the
  tests/game_audio.test.ts completeness arm.
- Beat P, the parity discharge (orchestrator-owned, AFTER the lanes
  land): the deferred wellfed parity beat, ENRICHED by the Phase 11 QA:
  the mint is the one genuinely new TICK-PHASE path (updateRegen
  completion), so the beat must ride a REAL consume completion through
  ticks (addItem, useItem, tick past the 18s, snapshot), which is
  draw-free: an append to professionsFarmingSession keeps every prior
  frame byte-identical, and a NEW feast scenario mints its own golden.
  Either way: ONE isolated, classified golden commit (the
  (z)/(bw)/(am) discipline), goldens judged by hash and field-diff
  only, and the feast scenario also covers place-consume-expire so the
  QA twin inherits a digest for the whole loop.

INVARIANTS THIS PHASE MUST KEEP
- Server authority: every charge decrement and ledger entry is server
  state; the client never decides any feast outcome; no wire command
  ingests a client-supplied ItemInstancePayload.
- Zero rng in placement and consumption, stated in the module; the
  tier-4 wellfed application owns no draw either (confirm against
  src/sim/wellfed.ts and state it).
- The wellfed namespace rules bind ((by)): one id wellfed_buff_sta,
  last-eaten-wins namespace-wide, no clobber of elixir_<kind> in either
  direction; pin the feast grant against both.
- Transient state is never serialized: no feast field enters
  CharacterState, any save blob, or any database write; the
  mobile-station rationale documented in the module.
- Every deny arm emits a text-free id-carrying SimEvent localized
  client-side; every player-visible string is an English t() key, with
  M16 fills for wordy values in the same change.
- The feast rides the normal entity snapshot; no new wire mechanism.
- Sim work stays inside the 20 Hz budget: the despawn and expiry check
  inside updateFarming does no per-tick allocation in its hot path.
- All randomness in src/sim/ goes through ctx.rng.
- Both new verbs are PLAYER-REACHABLE on every input family this phase
  ships for (the (bn) lesson); a verb no client calls is a stopping
  finding, not a deferral.
- renderer.ts never grows past 13774; hud.ts never past 19220 (both
  extraction-first).
- No em dashes, en dashes, or emojis anywhere; every new name is
  IP-safe per D17.

Out of scope (do NOT do in this phase)
- Wiki prose and the handoff manifest (Phase 13).
- Any second placeable object or a general placeable-object framework.
- Feast persistence of any kind (serialization, restart survival).
- Trading, mailing, or market-listing a PLACED feast (the item itself
  follows normal item rules).
- Re-tuning the well-fed magnitudes (the OPEN maintainer read; the
  feast grants the shipped tier-4 value).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run, in order, and record each result:
- npx tsc --noEmit
- npx vitest run over the new feast suite (working name
  tests/professions_feast.test.ts; record the real name in progress.md)
- npx vitest run tests/architecture.test.ts
  tests/localization_fixes.test.ts tests/world_api_parity.test.ts
  tests/snapshots.test.ts tests/env_protocol.test.ts
  tests/bandwidth.test.ts tests/game_audio.test.ts
  tests/crafted_item_tooltip_coverage.test.ts tests/farm_recipes.test.ts
  tests/recipe_economy.test.ts tests/professions_zone_rollout.test.ts
  tests/i18n_completeness.test.ts
- npx vitest run tests/parity: expect EXACTLY the beat-P movement (the
  isolated classified commit); any other golden movement is a defect,
  classify and surface, never regen.
- npm run ci:changed (fetch +refs/heads/main first; the changed set
  drifts with a stale origin/main)
- Screenshots: this IS a visual phase; capture before/after (desktop
  and LANDSCAPE 844x390 mobile) via the pr-screenshots skill on the LOW
  preset (standing rule), committed under docs/screenshots (a NEW
  subtree joins ci.yml's sparse-checkout cone rows AND the ci_workflow
  test literal, and the PNGs are git add -f TRACKED before the
  referenced-set scan counts them), referenced from progress.md (the
  D22 stand-in for the PR body).
Then check git diff --name-only against the phase-start commit and
dispatch ONLY the matching rows of the Review Dispatch Matrix in
docs/prd/masterwrought/farming/implementation-plan.md (expected for this diff:
architecture-reviewer, cross-platform-sync, privacy-security-review for
the interaction plus server surface, frontend-seam-reviewer,
content-obligations-reviewer for the recipe and item, and qa-checklist
LAST at phase completion). Every review agent gets the
report-via-SendMessage-to-main line FIRST, a hard 30-tool-call budget,
the coverage instruction ("report every issue including low-severity
and uncertain ones; ranking happens later"), and the resume line ("Stop
reading more files. Output the full report now based on what you have
already seen. No more tool calls. Format: BLOCKING / SHOULD-FIX /
NICE-TO-HAVE / VERDICT"); budget one nudge round for
idle-without-report. No commit while a BLOCKING stands. Mutation
batteries only AFTER committing, through a scratchpad runner that
refuses a dirty target, only while no reviewer reads the tree; every
verdict needs rc nonzero AND named failing tests AND the summary line.

STEP 4 - COMMIT CADENCE
Conventional Commits, each with a scope and a BODY, explicit paths
only, never git add -A, no session links or Claude attribution:
- the shared-shape commit (types, skeleton, seam stubs, parity pin)
- feat(sim): the feast module, interaction arm, the updateFarming
  despawn check, deny arms, and the anti-abuse rule (with the suite)
- feat(net): placeFeast in both worlds, entity snapshot carriage, the
  client paths for both verbs, the multi-session routing test
- feat(content): the feast recipe, item, tooltip, and the title key
  (with economy and S3 coverage)
- feat(render): the feast prop, the chosen render surface, placement
  VFX, and the feast cue chain
- test(parity): beat P, the isolated classified golden commit
- docs(farming): progress, state ledgers, and the screenshot references

STEP 5 - ACCEPTANCE CRITERIA
- [ ] The (bo)/Live-surface reconciliation is decided, documented as a
      deviation, and swept into this file and phase-12-qa.md.
- [ ] The feast item exists: an expensive produce-heavy tier-4 cooking
      recipe honoring the (bz) whole-list invariant; recipe economy
      green; no buyValue on the crafted output; the item tooltip states
      placement and the buff.
- [ ] placeFeast lands on IWorldFarming, implemented in BOTH Sim and
      ClientWorld, with the parity pin updated in the same change.
- [ ] The feast spawns a REAL entity riding the normal entity snapshot;
      no new wire mechanism anywhere in the diff.
- [ ] src/sim/professions/feast.ts owns FeastState (owner, charges,
      tick-domain expiry, per-player consumed ledger via the
      stable-content-key idiom); placement and consumption draw zero
      rng and the module says so.
- [ ] Consuming grants the tier-4 wellfed buff through the
      src/sim/wellfed.ts machinery (the consume-slot vs instant-mint
      decision stated), decrements a charge, once per player per feast;
      despawn on zero charges or expiry rides inside the anchored
      updateFarming driver, not a second sweep.
- [ ] Feast state is transient and never serialized; the rationale
      documented in the module.
- [ ] The anti-abuse rule is decided, stated, and documented.
- [ ] BOTH verbs are player-reachable through the real client (place
      via the bag-use path or a stated affordance, consume via the
      interact funnel), proven by playing, not by sim calls.
- [ ] The prop is in the exporter (swap-ready), the chosen render
      surface draws it without growing renderer.ts past 13774,
      placement VFX fire, and the feast cue chain is complete.
- [ ] The feast title is a t() key in the "{name}'s Harvest Feast"
      shape; every wordy new value carries its five non-Latin fills.
- [ ] Tests green: place, consume, once-per-player, charges, expiry,
      every deny arm, the multi-session routing test, the determinism
      pin, and the wellfed-vs-elixir isolation of the feast grant.
- [ ] Parity: beat P landed (the wellfed tick-phase beat riding a real
      consume completion), ONE isolated classified golden commit,
      nothing else moved.
- [ ] Screenshots (desktop and landscape mobile, LOW preset) committed
      under docs/screenshots with the cone rows, referenced from
      progress.md.
- [ ] Every STEP 3 validation row green; mutations all killed or
      diagnosed-and-fixed; gate_select PASS by its log markers.

STEP 6 - DOC UPDATES + MEMORY
Update docs/prd/masterwrought/farming/progress.md (the Phase 12 status row, the
acceptance list above copied with its check states, a Notes block
including the anti-abuse decision and the proposed charge count and
expiry as maintainer-flagged tuning: progress.md Notes are the D22
stand-in for the PR body) and the docs/prd/masterwrought/farming/state.md ledgers (the
new IWorld member, new SimEvents, new items and recipes, new i18n keys,
the anti-abuse rule and the (bo)/Live-surface reconciliation as
deviation entries refining D16). Any deviation decided in-phase gets
swept into this file AND docs/prd/masterwrought/farming/phase-12-qa.md in the same pass.
Record genuine surprises in the farming-skill-program memory topic.

STEP 7 - FINAL RESPONSE FORMAT
Report: phase status (complete or partial with reasons); files touched,
grouped by surface; validation results per command; review verdicts per
agent; deferrals with reasons; one line handing off to the Phase 12 QA
session (docs/prd/masterwrought/farming/phase-12-qa.md).

STOPPING RULES
- Stop if the (bo)/Live-surface collision cannot be reconciled within
  the phase's scope: surface the options to the maintainer.
- Stop if the entity route cannot carry the feast without a new wire
  mechanism: surface the design instead of inventing one.
- Stop if any path makes serialization unavoidable (a save, a
  snapshot-of-record, a restart survival requirement): the transient
  design is broken; surface it.
- Stop if either verb would ship without a real client path (the (bn)
  lesson): that is a scope gap, not a deferral.
- Stop if git status is dirty at STEP 0 or the newest release branch
  cannot be resolved.
- Stop while any review BLOCKING stands.

Close: gate via BROWSER_PATH=$HOME/.cache/ms-playwright/chromium-1228/
chrome-linux64/chrome GATE_MAX_WORKERS=8 node scripts/gate_select.mjs
on the frozen committed tree (NEVER edit while a gate runs); judge ONLY
the log markers ("[gate:select] FAIL at" / "[gate] FAIL" /
"[gate:select] PASS: all N steps green"; the exit code has lied).
EXPECT the full-suite fallback (about 15 minutes of vitest at 8
workers) and budget the druid_engines 20 s contention timeout as the
recorded environmental flake (prove it standalone if it fires, do not
chase it). Per D22: no push, no PR; merge --no-ff into LOCAL
feature/farming-plan, delete the branch and any agent worktrees, record
the merge hash in progress.md and the farming-skill-program memory
topic, and hand off to Phase 12 QA (docs/prd/masterwrought/farming/phase-12-qa.md).
```

## Phase 12 QA amendments (2026-08-19, swept per the deviation rule)

Two mechanism amendments landed in the QA round (full records: the state.md
Phase 12 QA block and the progress.md Phase 12 QA section):
- The lootable re-arm dodge is now respawnTimer = Infinity (the precedented
  never-re-arm sentinel), replacing the finite durationTicks + 20 spawn
  timer whose worst-case margin over the 1 Hz despawn was exactly one tick
  and whose "+ 20" was silently the sweep period. The 181s expiry arm rides
  the whole life at the worst-case sweep phase pinning lootable false.
- A feast placed inside a CLAIMED dungeon instance registers in the
  instance's objectIds, so freeInstance tears it down with the run and the
  sweep's inverse-cleanup leg reclaims the state and the one-active slot.
  Placement inside instances stays LEGAL (the raid-table flavor); before
  this, the entity outlived the run at the slot origin for the next party.
  The SAME rule covers delve runs (their own spatial system): the feast
  joins the placer's run.objectIds, torn down by freeDelveRun and the
  module advance (the abandoned-module drop is deliberate).
Render notes: the placement flourish registers standing tables silently on
the first pass after construction (no rebuild/login replay; scope-re-entry
ambiguity accepted), and shadow casting is budgeted at FEAST_SHADOW_CAP = 8
with presence never culled.
