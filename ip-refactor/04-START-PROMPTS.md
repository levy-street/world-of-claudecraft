# 04 - Start prompts (spine, four tracks, finale)

Paste-ready prompts to launch agent sessions. The spine here is NOT pre-committed: it is
G0 -> G1 run sequentially on `feature/ip-pivot` itself (the de-IP gate + verbatim-name
scanner, then the operator-locked NAME-MAP). Only AFTER the operator flips `NAME-MAP.md`
to LOCKED do the four parallel tracks fork. The finale (Z1) runs last, back on
`feature/ip-pivot`.

Read `README.md` (goal, the load-bearing "display-only" finding, the IP surface map, the
session index, the scope decisions, the prime directive) and `00-SHARED-CONVENTIONS.md`
(the two English source layers, the regen sequence, the four contracts + gates, the
standard loop, validation commands) before any session. Then read the LOCKED `NAME-MAP.md`
(the single old -> new contract every rename slice applies verbatim). This file does not
duplicate them.

## How to use
- **Run the spine first, sequentially, on `feature/ip-pivot`:** G0 -> G1, one session at a
  time, same prompt, swapping only the brief-path line. G0 pins the gate (the `ip_scrub`
  scanner, landed RED as the baseline worklist); G1 generates the full NAME-MAP and STOPS
  for operator sign-off.
- **Fork the four tracks ONLY after the operator flips `NAME-MAP.md` to LOCKED.** Until
  the STATUS line reads LOCKED and the `02-WORKING-MEMORY.md` lock-state boxes are both
  checked, NO V/C/W/T slice may start. Create the four worktrees off `feature/ip-pivot`,
  `npm ci` each, then run the four in parallel. Each worktree runs its track's sessions in
  the listed order, one at a time.
- For each session, paste that worktree's prompt and **change only the brief-path line**
  (the session identity). Everything else stays constant.
- The brief states its own mode, so the `If the brief is tagged ULTRACODE` line handles
  the adversarial-verify step automatically; you never track which is which. (C1 and C2 are
  ULTRACODE and auto-run the extra pass.)
- **Spine + finale run directly on `feature/ip-pivot`** (the integration branch): the agent
  commits green-only there, stops, and reports; YOU confirm green and push.
- **Track sessions stop at "report" on their track branch.** YOU do the merge to
  `feature/ip-pivot` (see "Integration" at the bottom). Track agents never merge.

---

### Spine - de-IP gate + NAME-MAP lock (sequential, on `feature/ip-pivot`)
Order: **G0 -> G1**
Briefs: `G0-deip-gates.md`, `G1-name-map.md`

```
You are executing a session of the IP Pivot refactor - Spine (sequential on feature/ip-pivot).
Working directory: /Users/reubenhorne/Documents/code/world-of-claudecraft/world-of-claudecraft  (branch feature/ip-pivot; deps installed)

SESSION BRIEF (the only line I change each session):
  /Users/reubenhorne/Documents/code/woc-refactor/ip-refactor/G0-deip-gates.md

Per its Step 0 (00-SHARED-CONVENTIONS.md): read 02-WORKING-MEMORY.md + 00-SHARED-CONVENTIONS.md + README.md first, check the Slice status board + the scanner-worklist / generated-artifact registries before appending to any of them, and mark this session in-progress there. Load context via ONE Explore agent (never read classes.ts/talents_classic.ts/sim.ts whole). Execute through the brief's Acceptance Criteria. Review with a COVERAGE reviewer on the diff (report every gap with severity + confidence, do NOT filter); if the brief is tagged ULTRACODE, additionally run it as an adversarial-verify workflow (every proposed name refuted by a skeptic for residual WoW AND other-franchise IP). Commit green-only by EXPLICIT paths (relevant gates + tsc --noEmit; G0 lands ip_scrub RED by design, so commit it as the documented baseline worklist, not a pass). Update 02-WORKING-MEMORY (status + scanner-worklist seed + any generated-artifact touch, append-only). Then STOP and report; this branch IS the integration branch, so do NOT push yourself; I confirm green and push. G1 SPECIFIC: after filling every Coverage-checklist row in NAME-MAP.md, STOP for operator sign-off on the NAME-MAP before any rename runs; do NOT flip STATUS to LOCKED yourself and do NOT start any V/C/W/T slice.
```

**Do not fork the tracks until the operator has flipped `NAME-MAP.md` STATUS to LOCKED and
checked both NAME-MAP lock-state boxes in `02-WORKING-MEMORY.md`.** The four track prompts
below apply the map verbatim; they are unsafe to run against a PROPOSED / DRAFT map.

---

### wt-ip-vocab - ability + talent display rename (parallel, after LOCK)
Order: **V1 -> V2**
Briefs: `V1-abilities.md`, `V2-talents.md`

```
You are executing a session of the IP Pivot refactor - Vocab track.
Working directory: /Users/reubenhorne/Documents/code/world-of-claudecraft/wt-ip-vocab  (branch track/ip-vocab off feature/ip-pivot; deps installed)

SESSION BRIEF (the only line I change each session):
  /Users/reubenhorne/Documents/code/woc-refactor/ip-refactor/V1-abilities.md

Per its Step 0 (00-SHARED-CONVENTIONS.md): read 02-WORKING-MEMORY.md + 00-SHARED-CONVENTIONS.md + README.md + the LOCKED NAME-MAP.md first, check the Slice status board + scanner-worklist + generated-artifact registries before appending, and mark this session in-progress. Confirm the gate is green BEFORE editing: run tests/parity (byte-identical baseline) and note this slice's current ip_scrub failures (your worklist). Load context via ONE Explore agent (never read classes.ts/talents_classic.ts whole); get the exact current ids, .name lines, and catalog-mirror lines for your domain. Apply the LOCKED NAME-MAP VERBATIM; never invent an off-map name (if a needed string is not on the map, STOP and append a request row to 02-WORKING-MEMORY for the operator). RENAME DISPLAY, FREEZE IDS: edit the display .name only, never the code id. For abilities edit BOTH the sim ABILITIES[id].name/.description (classes.ts) AND the classAbilityNamesEn catalog (i18n.catalog/abilities.ts), byte-identical; for talents keep each name equal to its paired ability's NEW name or an explicit title override. Regenerate artifacts: npm run i18n:gen, npm run i18n:hash -- --write, npm run wiki:content. Verify the subset your slice touches (tests/parity byte-identical; tests/i18n_resolved_equivalence; tests/ip_scrub entries you cleared now green; tests/guide; V2 also tests/talents; tsc --noEmit). Review with a COVERAGE reviewer on the diff (report every gap, do NOT filter); if the brief is tagged ULTRACODE, additionally run an adversarial-verify pass. Commit green-only by EXPLICIT paths (source rename + regen artifacts as ONE logical change; never a half-renamed catalog with the two English copies out of sync). Update 02-WORKING-MEMORY append-only (status -> done-on-track, tick the scanner-worklist entries you cleared, log the generated-artifact touch). Then STOP and report; do NOT merge to feature/ip-pivot; I handle integration.
```

---

### wt-ip-creatures - Blizzard-original creatures + coined-id sweeps (parallel, after LOCK)
Order: **C1 -> C2**
Briefs: `C1-creatures-core.md`, `C2-warlock-pets.md`

```
You are executing a session of the IP Pivot refactor - Creatures track.
Working directory: /Users/reubenhorne/Documents/code/world-of-claudecraft/wt-ip-creatures  (branch track/ip-creatures off feature/ip-pivot; deps installed)

SESSION BRIEF (the only line I change each session):
  /Users/reubenhorne/Documents/code/woc-refactor/ip-refactor/C1-creatures-core.md

Per its Step 0 (00-SHARED-CONVENTIONS.md): read 02-WORKING-MEMORY.md + 00-SHARED-CONVENTIONS.md + README.md + the LOCKED NAME-MAP.md first, check the Slice status board + scanner-worklist + generated-artifact registries before appending, and mark this session in-progress. Confirm the gate is green BEFORE editing: run tests/parity (byte-identical baseline) and note this slice's current ip_scrub failures (your worklist). Load context via ONE Explore agent (never read sim.ts/types.ts whole); get the exact current ids, .name lines, family: fields, manifest keys, and quest-prose call sites for your domain. Apply the LOCKED NAME-MAP VERBATIM; never invent an off-map name (if a needed string is not on the map, STOP and append a request row for the operator). THE ONE EXCEPTION applies here: the coined-id sweep renames the Blizzard-coined MobFamily ids (C1: murloc/kobold) and warlock demon-pet ids (C2) ATOMICALLY across every file that keys off them (types.ts, sim.ts, render/characters/manifest.ts, every content family: field; C2 first verifies the pet id is NOT persisted in CharacterState, else keep id + display-only). This is the ONLY place a parity golden may change, and ONLY by exactly the renamed token: diff the golden and confirm nothing else moved; if it shifts any other way you changed behavior, STOP. Every ability/talent/item id stays frozen. S3 co-location: any moved quest-prose emit literal updates its src/ui/sim_i18n.ts matcher in the SAME slice, then run tests/localization_fixes.test.ts. Keep src/sim/ pure (tests/architecture.test.ts). Regenerate artifacts: npm run i18n:gen, npm run i18n:hash -- --write, npm run wiki:content. Verify the subset your slice touches (tests/parity; tests/i18n_resolved_equivalence; tests/ip_scrub entries cleared; tests/guide; tests/localization_fixes; tests/architecture; tsc --noEmit). Review with a COVERAGE reviewer on the diff; the brief is tagged ULTRACODE, so ALSO run an adversarial-verify pass (each id-freeze / behavior-unchanged / no-off-map-name claim independently refuted by a skeptic, and the golden delta confirmed to be nothing but the renamed token). Commit green-only by EXPLICIT paths (keep the coined-id sweep atomic; source + regen artifacts as ONE logical change). Update 02-WORKING-MEMORY append-only (status -> done-on-track, tick the scanner-worklist entries you cleared, log the generated-artifact touch, log the coined-id sweep). Then STOP and report; do NOT merge to feature/ip-pivot; I handle integration.
```

---

### wt-ip-world - items / sets / augments + mob mechanic names (parallel, after LOCK)
Order: **W1 -> W2**
Briefs: `W1-items.md`, `W2-mob-mechanic-names.md`

```
You are executing a session of the IP Pivot refactor - World track.
Working directory: /Users/reubenhorne/Documents/code/world-of-claudecraft/wt-ip-world  (branch track/ip-world off feature/ip-pivot; deps installed)

SESSION BRIEF (the only line I change each session):
  /Users/reubenhorne/Documents/code/woc-refactor/ip-refactor/W1-items.md

Per its Step 0 (00-SHARED-CONVENTIONS.md): read 02-WORKING-MEMORY.md + 00-SHARED-CONVENTIONS.md + README.md + the LOCKED NAME-MAP.md first, check the Slice status board + scanner-worklist + generated-artifact registries before appending, and mark this session in-progress. Confirm the gate is green BEFORE editing: run tests/parity (byte-identical baseline) and note this slice's current ip_scrub failures (your worklist). Load context via ONE Explore agent (never read items.ts/dungeons.ts whole); get the exact current ids, .name lines, catalog-mirror lines, and (W2) the inline mob-mechanic name literals + their sim_i18n.ts matcher entries. Apply the LOCKED NAME-MAP VERBATIM; never invent an off-map name (if a needed string is not on the map, STOP and append a request row for the operator). RENAME DISPLAY, FREEZE IDS: for items edit BOTH the sim ITEMS[id].name (items.ts, plus ZONE{2,3}_ITEMS/temple.ts as applicable) AND the itemNamesEn catalog (i18n.catalog/items.ts), byte-identical; item-set names live in item_sets.ts + the catalog. (Slimy Murloc Scale + Bristleback Maul are owned by C1, not W1.) W2 S3 co-location: edit the inline mechanic name AND its AURA_NAME_KEY matcher entry in src/ui/sim_i18n.ts in the SAME slice, then run tests/localization_fixes.test.ts. Regenerate artifacts: npm run i18n:gen, npm run i18n:hash -- --write, npm run wiki:content. Verify the subset your slice touches (tests/parity byte-identical; tests/i18n_resolved_equivalence; tests/ip_scrub entries cleared; tests/guide; W2 also tests/localization_fixes; tsc --noEmit). Review with a COVERAGE reviewer on the diff (report every gap, do NOT filter); if the brief is tagged ULTRACODE, additionally run an adversarial-verify pass. Commit green-only by EXPLICIT paths (source rename + regen artifacts as ONE logical change; never a half-renamed catalog). Update 02-WORKING-MEMORY append-only (status -> done-on-track, tick the scanner-worklist entries you cleared, log the generated-artifact touch). Then STOP and report; do NOT merge to feature/ip-pivot; I handle integration.
```

---

### wt-ip-text - de-brand comments / docs / README + realm copy (parallel, after LOCK)
Order: **T1** (single session)
Briefs: `T1-debrand-text.md`

```
You are executing a session of the IP Pivot refactor - Text track.
Working directory: /Users/reubenhorne/Documents/code/world-of-claudecraft/wt-ip-text  (branch track/ip-text off feature/ip-pivot; deps installed)

SESSION BRIEF (the only line I change each session):
  /Users/reubenhorne/Documents/code/woc-refactor/ip-refactor/T1-debrand-text.md

Per its Step 0 (00-SHARED-CONVENTIONS.md): read 02-WORKING-MEMORY.md + 00-SHARED-CONVENTIONS.md + README.md + the LOCKED NAME-MAP.md first, check the Slice status board + scanner-worklist + generated-artifact registries before appending, and mark this session in-progress. Confirm the gate is green BEFORE editing: run tests/parity (byte-identical baseline) and note this slice's current ip_scrub failures (your worklist). Load context via ONE Explore agent; get the exact current WoW/intent-to-copy references in README.md, code comments, realm.ts, and main.ts. Apply the LOCKED NAME-MAP VERBATIM for any player-visible copy (realm wording is optional/P2 per the scope decisions: swap the player-visible copy only, keep the RealmType id + server/realm.ts infra id frozen). Never invent an off-map player-visible name. De-brand comments/docs are dev-channel English (not t() keys), but do not introduce a new player-visible string without a NAME-MAP row. Regenerate artifacts only if you touched a player-visible name: npm run i18n:gen, npm run i18n:hash -- --write, npm run wiki:content. Verify the subset your slice touches (tests/parity byte-identical; tests/ip_scrub entries cleared; tests/i18n_resolved_equivalence + tests/guide if you regenerated; tsc --noEmit). Review with a COVERAGE reviewer on the diff (report every gap, do NOT filter); if the brief is tagged ULTRACODE, additionally run an adversarial-verify pass. Commit green-only by EXPLICIT paths. Update 02-WORKING-MEMORY append-only (status -> done-on-track, tick the scanner-worklist entries you cleared, log any generated-artifact touch). Then STOP and report; do NOT merge to feature/ip-pivot; I handle integration.
```

---

### Finale (Z1) - integrate, scanner-zero, release-fill handoff, doc pass (on `feature/ip-pivot`, after all tracks merge back)
Order: **Z1** (single session)
Briefs: `Z1-integrate-finale.md`

```
You are executing a session of the IP Pivot refactor - Finale.
Working directory: /Users/reubenhorne/Documents/code/world-of-claudecraft/world-of-claudecraft  (branch feature/ip-pivot; deps installed; all four tracks already merged back)

SESSION BRIEF (the only line I change each session):
  /Users/reubenhorne/Documents/code/woc-refactor/ip-refactor/Z1-integrate-finale.md

Per its Step 0 (00-SHARED-CONVENTIONS.md): read 02-WORKING-MEMORY.md + 00-SHARED-CONVENTIONS.md + README.md + the LOCKED NAME-MAP.md first, and confirm the Slice status board shows every V/C/W/T slice merged and the scanner-worklist fully ticked. Re-run the generators on the integrated tree (npm run i18n:gen, npm run i18n:hash -- --write, npm run wiki:content) so the regenerated artifacts are deterministic from the merged source (never hand-merge them). Execute through the brief's Acceptance Criteria: confirm tests/ip_scrub.test.ts is FULLY GREEN with zero residual denylist entry in any player-visible field; every existing tests/parity golden byte-identical except the C1/C2 coined-id token deltas already logged; then write the maintainer the reword-staleness reconciliation note (diff i18n.resolved.generated/en.ts merge-base vs HEAD, list every locale whose value did not also change, hand off the release-tier locale re-fill) and do the doc pass. Review with a COVERAGE reviewer on the diff. Commit green-only by EXPLICIT paths (full pre-merge, mirror CI: npm test && npx tsc --noEmit && npm run build). Update 02-WORKING-MEMORY (mark the program done). Then STOP and report; this branch IS the integration branch, so do NOT push yourself; I confirm green and push.
```

---

## Integration (you run this after a track session lands green on its track branch)
```bash
REPO=/Users/reubenhorne/Documents/code/world-of-claudecraft/world-of-claudecraft
cd "$REPO"
git merge --no-ff track/ip-vocab          # the track whose session just landed
npm run i18n:gen && npm run i18n:hash -- --write && npm run wiki:content   # re-run generators on the INTEGRATED tree (never hand-merge artifacts)
npx tsc --noEmit
npx vitest run tests/parity tests/i18n_resolved_equivalence.test.ts tests/ip_scrub.test.ts tests/guide.test.ts
git add src/ui/i18n.resolved.generated src/ui/i18n.resolved.sha256 src/guide/content.generated.ts   # only if the re-run changed them
git commit -m "chore(i18n): regenerate resolved artifacts after track/ip-vocab merge"   # only if needed
git push                                   # publish feature/ip-pivot
# then flip that session to `merged` in 02-WORKING-MEMORY.md
```
Spine + finale run directly on `feature/ip-pivot`, so there is no merge for those: confirm
green (the line above without the `git merge`) and push.

Periodically pull integrated work back into a track to keep divergence small - from the
track worktree: `git merge feature/ip-pivot`, then re-run the generators (never hand-merge
`i18n.resolved.generated/*`, `i18n.resolved.sha256`, `content.generated.ts`). Conflict
rules: the LOCKED `NAME-MAP.md` is append-only (never rename a locked row); the generated
i18n / guide artifacts are the ONLY parallel conflict surface and are resolved by RE-RUNNING
the generators, never a hand-edit; every code `id` stays frozen (the C1/C2 coined-id sweep
is the one exception and lands atomically).

**Full integrator procedure + paste-ready integrator prompt: `05-INTEGRATION.md`** (run by
a single integrator, one branch at a time; track agents never merge). See `01-CONCURRENCY.md`
for the spine/track model and `03-COMMIT-AND-VERIFY.md` for the commit/verify cadence and the
reword-staleness release obligation.
