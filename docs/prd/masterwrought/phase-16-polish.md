# Phase 16: Polish and content surfaces

### Starter Prompt
```
This is Phase 16 of the Masterwrought feature: polish and content surfaces.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: yes (sweep): fan the icon, guide, and admin
batches out as a Workflow.

Goal: everything around the system shines: the orange visual identity, icons for every
new item, guide/wiki coverage, admin market metrics, and the PR screenshot set.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean; then SYNC RELEASE: git fetch origin, merge the newest origin/release/**
  into feature/masterwrought, run the release-merge-audit skill on the merge.
- Memory scan: MEMORY.md entries on the guide freshness gate, admin Pick-no-spread, M16
  wordy fills, screenshot traps, cached-read busts.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
- docs/prd/masterwrought/state.md (the ledger: the FULL new-item list from phases 04 to
  13), docs/prd/masterwrought/progress.md
- docs/design/graphics-settings-fairness.md + the src/ui/CLAUDE.md fairness exemplars,
  src/render/CLAUDE.md (the new-visual-system recipe, RENDER_PURE_CORES),
  src/game/ui_effects_profile.ts (the static preset seam)
- the icon-system row convention, src/guide/CLAUDE.md (guide.* prose keys, wiki regen,
  spoiler rules), src/admin/CLAUDE.md (the Svelte dashboard, admin i18n), server/CLAUDE.md
  "Hot paths" (cached reads), tests/guide.test.ts freshness gate, the pr-screenshots
  skill.
Return: the render module recipe for an item-quality visual, the icon row shape, the
guide key + regen loop, where admin market metrics live and their i18n pattern.

STEP 2 - EXECUTE (ultracode Workflow; request the fan-out explicitly):
Arm 1 (orange visual identity): a new src/render/<thing>.ts module the renderer calls
(never a method bank on renderer.ts) for the legendary crafted treatment (glow or
particle); graphics-settings-fairness compliant: COSMETIC ONLY, sheddable by preset,
never encoding information a player acts on; tier knobs read the static preset via
ui_effects_profile, never the FPS governor; the fairness tests stay the contract.
Arm 2 (icons): icon-system rows for EVERY new item in the packet ledger (materials,
intermediates, patterns, apex pieces, consumables, the Deed of Making); enumerate the
ledger against the icon table so none is missed.
Arm 3 (guide/wiki): guide content + guide.* prose keys for the whole system (patterns
and the three recipe channels, materials, the cap, Perfecting, the orange); npm run
wiki:content; the freshness gate green; spoiler-safe per src/guide/CLAUDE.md.
Arm 4 (admin): market metrics for cores, patterns, and essence on the admin dashboard
(operators are users: full admin i18n); any new server read follows the cached-read
hot-path seams, and any new stored series has a retention story.
Arm 5 (i18n fills + screenshots): M16 non-Latin fills for every wordy new English key in
the same change; before/after screenshots (desktop + mobile) committed under
docs/screenshots for the PR body per the pr-screenshots skill.

INVARIANTS IN PLAY: graphics settings stay gameplay-neutral (cosmetic only; the fairness
tests are the contract); module-first for the render treatment; every admin and guide
string localized; no generated-file hand-edits (regen via the owning build step only);
ids frozen; classic-era presentation.

Out of scope: any balance or content number (phase 15 sealed them); new gameplay
surfaces; HUD window work (phase 14 owned it).

STEP 3 - VALIDATION + REVIEW (matrix in state.md):
npx tsc --noEmit; npx vitest run tests/guide.test.ts tests/architecture.test.ts (the
RENDER_PURE_CORES registration if a pure core landed) tests/localization_fixes.test.ts
plus the graphics-settings fairness tests; npm run wiki:content then confirm freshness;
npm run ci:changed; the screenshot scripts. Review Dispatch Matrix
(implementation-plan.md): frontend-seam-reviewer (render/ui), privacy-security-review
(src/admin/ touched, plus any new server read), database-performance-reviewer if the
metrics add SQL call sites. COVERAGE prompts; apply ALL findings.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers):
- feat(render): orange visual identity module
- feat(ui): icons for the masterwrought item set
- feat(guide): wiki coverage for the masterwrought system
- feat(admin): market metrics for cores, patterns, and essence
- docs(screenshots): polish before and after captures

STEP 5 - ACCEPTANCE:
- [ ] Orange treatment cosmetic-only; fairness tests green; render module-first
- [ ] Every ledger item has an icon row (enumerated, not sampled)
- [ ] Guide regenerated, freshness gate green, prose keys added, spoiler-safe
- [ ] Admin metrics localized; hot-path and retention seams respected
- [ ] M16 fills done; screenshots committed (desktop + mobile) and referenced
- [ ] All listed suites green; ci:changed clean

STEP 6 - DOCS: progress.md Phase 16 row; state.md ledger (render module, icon rows,
guide keys, admin surfaces, fills); memory note if anything surprised you.

STEP 7 - REPORT: phase status, files, validation results, reviewer verdicts, screenshot
paths, handoff line for Phase 16 QA.

STOPPING RULES: stop and ask if the orange treatment cannot be made preset-sheddable
without leaking actionable information, or if an admin metric needs a new unbounded
table (a retention story comes first, not after).
```

### Farming arm (amended 2026-08-20)

Phase 11b absorbed `feature/farming-plan` into this packet: one branch, one PR, five
gathering professions and ten crafts shipping as one system. The prompt above is not
retracted and not rewritten. This section is part of it. Read it after STEP 0 and fold
every item into the matching step.

**Do NOT redo these. Cite farming's shipped evidence instead.** The farming wiki page and
its `guide.*` prose keys with the `tests/guide.test.ts` freshness gate green; the
full-journey screenshot set (plant, growth stages, harvest, Harvest Journal, feast) in
both desktop and mobile under `docs/screenshots/`; the D17 IP-safe naming audit across
every player-visible farming string; `docs/design/farming-asset-manifest.json`, placed
outside the packet deliberately so it survives teardown; and farming's graphics-fairness
row, "timers and ready notices are actionable and never shed", which is a concrete
instance of the graphics-neutrality invariant this phase's Arm 1 already serves. Cite that
row rather than re-deriving it.

**STEP 0 additions.**
- DECISION 8 (storefront achievement mapping for the packet's new deeds) IS SETTLED
  (2026-08-20, rows 11k-D-K3 and ip-16-SURFACES a): NO STOREFRONT ENTRY, for EVERY deed this
  packet adds. Not the three title-bearing ones, not any of them. `ACHIEVEMENT_MAP` gains no
  row, the `tests/epic_achievement_map.test.ts` pins STAY at 84 against `MAX_EPIC_ACHIEVEMENTS`
  100, `server/steam/` and `server/epic/` stay untouched, and `privacy-security-review` is not
  triggered. This phase WRITES THE RECORD, once, at packet level, covering the 13 absorbed
  farming deeds plus 11e-D-E's, 11i-DEED's and `prog_field_to_feast`. WHY it is a written
  record and not a silence: the exhaustive coverage arm is scoped to `col_reliquary_*`, so an
  unmapped deed goes green on its own and only the record catches it. Still DERIVE the new-deed
  count off the final DEED_ORDER for the record, never off a remembered figure.
- DECISION 1 (GATE 1) IS SETTLED as FIX (rows 11b-D-1 and state-GATE-7), so the three recipes
  and both deeds stay in the icon, guide and wiki ledger this phase enumerates. There is no CUT
  branch. What this phase confirms is the CODE: that 11e landed the eight seed rows at
  `farmer_hollis` and `farmer_verbena`, read out of the merged `vendorItems` arrays.
- Memory scan gains: the merged pending art allowlist and the item-art ownership rules.

**STEP 1 additions (Explore agent).**
- The MERGED icon table and the MERGED pending allowlist in `src/ui/icons.ts`, plus the
  merged `DEED_ART_PENDING` list.
- `server/steam/achievement_map.ts`, `server/epic/achievement_map.ts`, and
  `tests/epic_achievement_map.test.ts`.
- `bot/logic.ts` (the activity-card kind union) and `headless/CLAUDE.md`.
- The merged admin market-metric surfaces and the market listability of farming's produce,
  seeds, and compost.
Return additionally: the exact pending-allowlist contents, the achievement-map pin shape,
the activity-card union members, and where the RL action space enumerates commands.

**STEP 2 additions, still owed after the merge.**
- Arm 3 owes ONE wiki regen ON THE MERGED TREE. Neither branch's committed regen is valid
  post-merge and the freshness gate binds merged content.
- Arm 3 owes CROSS-PROFESSION GUIDE COHERENCE, which is new work neither packet did: the
  two pages were written blind to each other, and a reader currently meets "Well Fed"
  meaning two different ladders. The merged guide needs ONE well-fed explanation and ONE
  professions framing (five gathering professions plus ten crafts as one system).
- Arm 2 owes icons under a RESOLVED doctrine conflict. Masterwrought's doctrine enumerates
  every ledger item; farming's parks ids in `ITEM_ART_PENDING` because committed item art
  demands the maintainer's master SHA. DO NOT CARRY A LITERAL COUNT INTO THIS PHASE: the
  list was 44 ids on farming's tip (including `harvest_feast`), 11e alone took it to 56,
  and every 11-block phase after that appends its own. COUNT THE MERGED LIST when this
  phase runs and reconcile it against the per-phase ledgers. THE PARK-OR-SHIP QUESTION IS
  SETTLED (2026-08-20, rows state-GATE-5 and ip-16-ICON): they PARK. Masterwrought's items
  park against the merged table and the merged pending allowlist exactly like farming's 44,
  said explicitly in this phase's record; this packet ships no committed WebP art, every new
  id carries a pending row with exactly ONE mapping.json owner, and the merged icon test keeps
  farming's art-subject split shape with re-derived literals. Masterwrought's asserted-empty
  pending set is RETIRED, and its retirement is recorded here. Farming also left a pending
  rationale-comment sweep in that file ("no faucet until go-live" for compost) which 11e's
  seed faucet has made stale; fix the comment in this phase. The promotion deed joins the
  merged `DEED_ART_PENDING` list alongside farming's eight rows and the commissioned
  `prog_farming_100` crest brief.
- The naming registry owes ONE merged pass, and its answer is SETTLED (2026-08-20, row
  state-OPEN-WELLFED): the item DISSOLVED at 11c. After the unification there is exactly ONE
  Well Fed (one aura id, one mechanic, one ladder), so NEITHER mechanic is renamed. This phase
  AMENDS the registry row to say that the generic-with-caveat caveat from ruling (9) is
  RETIRED by the 11c unification, with the date and the reason. No rename branch exists.
- ONE REAL RENAME, SETTLED 2026-08-20 (state.md row 114, ip-NAME-BORDERLINE): re-cut the
  `Enchant <Slot> - <Stat>` naming scheme. It is verbatim WoW formula trade dress
  ("Enchant Gloves - Agility", "Enchant Ring - Strength") on ENCHANTING content this packet
  already rewrites, so it is in scope by subject as well as by risk. The distinctive
  suffixes were already originalized (Runed Sigil, Runed Weave); only the SCHEME is re-cut.
  Display names only: every enchant id is FROZEN and never changes (masterwrought R15). The
  new scheme is web-verified at authoring per R15 and recorded in the naming registry.
  Same-change obligations: the English catalog rows, M16 non-Latin fills for any wordy new
  value, the sim and server matchers if any enchant name is matched by text, wiki regen, and
  every test carrying an enchant display-name literal (sweep for them; do not assume the
  count). Note it touches the apex enchant line 11h and Phase 10 authored, so re-read those
  ledgers before choosing the scheme.
  SCOPED HARD, and this is the maintainer's explicit boundary: this phase renames NOTHING
  ELSE from that list. The zone families (The Amberfall, The Frostveil Reach, The Nightbloom,
  Galecrest, Voidscar) and the timing-parallel coins (Brutok, Brother Halven, Aetherwell,
  Gravelight, Summon Emberkin) are WORLD IDENTITY, not professions, and stay exactly as
  shipped. Touching one is a stopping-rule violation, not initiative.

**STEP 2 additions: the four surfaces no research lane covered.** Each lands here as an
explicit RECORD, never as a deferral. The packet's contract is in-or-CUT.
- STOREFRONT ACHIEVEMENTS. `tests/epic_achievement_map.test.ts` pins `ACHIEVEMENT_MAP` at
  exactly 84, pins the portal soft cap `MAX_EPIC_ACHIEVEMENTS` at 100, and asserts the
  Steam table is byte-equivalent to the Epic one. Neither branch touched `server/steam/`
  or `server/epic/`. The absorb itself adds 13 deeds (six masterwrought plus seven
  farming, the total 11d re-derived), and 11e and Phase 13 each appended after that, so
  DERIVE the packet's new-deed count off the final DEED_ORDER for the record. Headroom was
  never the question: 16 slots against a count in the mid-teens means it would have fit, and
  decision 8 CUT it anyway.
  Nothing goes red automatically because the exhaustive coverage test is scoped to
  `col_reliquary_*` deeds and neither packet adds one, which is exactly why this would be
  missed. So: MAP NOTHING. Both tables stay byte-equivalent because neither is touched, the 84
  pin does not move, and this phase writes ONE packet-level NON-mapping record naming every
  deed the packet adds and the reason (the launch storefront set is CURATED, not a catalog
  mirror, and these are cosmetic profession deeds). Per 11k-D-K3 that record is the deliverable;
  a mapping is not.
- THE DISCORD ACTIVITY FEED. `bot/logic.ts` carries a CLOSED activity-card kind union
  that already has `masterwork` but has no farming member, so farming's `golden_harvest`
  announcement and the Harvestmaster title have no card. SETTLED (ip-16-SURFACES b): ADD, and
  cap it at TWO cards, one for the Harvestmaster title and one for `golden_harvest`. No third
  card and no per-placement noise, because a feast placed in a capital every few minutes is
  exactly the channel spam that gets a feed muted. That is the union member, two card
  renderers, the bot's own tests, and an entry in `bot/CLAUDE.md` (NEW WORK N10; no other phase
  touches `bot/`). Phase 13 hands this phase the merged broadcast set so the card does not
  double-announce.
- THE RL HOST. `git diff` over `headless/` and `python/` returns nothing on either branch,
  so a whole gathering profession, five wire commands, and an eight-member facet are
  unreachable from the RL action space, and growth resolves against `ctx.lockoutNowMs()`,
  which makes any episode that plants non-replayable. The repo's first architectural claim
  is one sim, three hosts. RECORD THE SCOPE LINE IN `headless/CLAUDE.md` as an explicit
  CUT with its reason (farming is not in the action space for this packet, and why), so
  host three has a written answer instead of a silence.
- ADMIN MARKET METRICS. Arm 4 covers cores, patterns, and essence. Farming's produce,
  seeds, and compost are market-listable and browse under the material filter. SETTLED
  (ip-16-SURFACES d, decided 2026-08-20 in the reconcile pass): WIDEN the metric set to cover
  produce, seeds and compost. Scoping the copy was the cheaper answer and it is refused, for
  one reason: masterwrought R21 is demand-side design, and the market metrics are the ONLY
  instrument that shows whether the world actually eats what the crafts make. A dashboard that
  measures the crafting half and not the gathering half leaves the packet's own central claim
  unmeasurable on the surface built to measure it. Shipping metrics for half a professions
  economy is worse than shipping none. Every string goes through `t()` either way, because
  operators are users, and the widening is recorded with which surfaces moved (NEW WORK N12).
- THE GATE-MODEL PARAGRAPH (qr-GATE-DOC, state.md row 133, added 2026-08-20 by the
  quality-review adoption pass). Add a short "how crafting gates" paragraph to
  `docs/design/professions.md`, citing `src/sim/professions/crafting.ts`: there is
  deliberately NO skillReq admission gate at craft time; the bands are real through the
  TEACHING gate (`teachTierMet`, both channels), the SKILL-GAIN curve (archetype ceilings
  and tier-distance multipliers) and the masterwork ceiling, so a low-skill crafter holding
  materials can always craft a known recipe for a friend. The review judged the design good
  and undocumented (it reads like a bug until traced); the paragraph is what stops a future
  contributor from "fixing" it. Any packet R-number in it reads "masterwrought R<n>" in
  full per the namespace rule.

**STEP 5 additions (acceptance).**
- [ ] The gate-model paragraph landed in docs/design/professions.md, citing crafting.ts,
      with no bare packet R-number (qr-GATE-DOC)
- [ ] One wiki regen on the merged tree; freshness gate green on merged content
- [ ] One well-fed explanation and one professions framing across both guide pages
- [ ] Icons enumerated against the MERGED table AND the merged pending allowlist, with the
      settled PARK statement written out (state-GATE-5, ip-16-ICON) and the stale compost
      rationale fixed
- [ ] Naming registry row for 'Well Fed' amended to retire the generic-with-caveat caveat,
      with the date and the 11c unification as the reason; no rename anywhere
- [ ] Storefront mapping: NONE, per decision 8 as settled (11k-D-K3), with the packet-level
      non-mapping record written, both tables untouched and byte-equivalent, and the 84 pin
      unmoved
- [ ] Discord activity feed: the farming kind-union member and EXACTLY TWO cards
      (Harvestmaster, `golden_harvest`) landed, with the bot's own tests and a `bot/CLAUDE.md`
      entry; no third card and no per-placement noise
- [ ] `headless/CLAUDE.md` carries the RL scope CUT with its reason, naming
      `ctx.lockoutNowMs()` as the structural cause and a virtual clock as the re-admission
      condition
- [ ] Admin market metrics WIDENED to cover produce, seeds and compost, every string through
      `t()`, with the moved surfaces recorded

**Stopping rule, added.** Stop and ask if committed item art is required for any
masterwrought id and no master SHA is available, since that is the exact condition
farming's pending allowlist exists to hold. The storefront soft cap can no longer be
reached, because decision 8 maps nothing; a diff that adds an `ACHIEVEMENT_MAP` row is a
finding against 11k-D-K3, not a cap question.
