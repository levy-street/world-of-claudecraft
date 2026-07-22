# Phase 12d: Provenance and the harvest loop

Three community-confirmed pain points in the corpse-to-bag pipeline, fixed as one coherent
phase. First, signed items confuse and punish: a gathered rare-roll item renders "Crafted by
{name}" (one makersMark key serves every signer source), shows no marker in the bag grid, and
never stacks, not with plain copies and not even with copies signed by the SAME player (no
payload-equality compare exists anywhere), so high-proficiency gathering eats bag slots fast.
Second, looting fights harvesting: the interact key takes gold and kill loot only, harvesting
needs a per-corpse right-click and picker, players report the town focus not visibly working,
a looted corpse becoming unharvestable, and harvested-but-unlooted corpses lingering. Third,
the mailbox is a free infinite warehouse (30c posts three stacks, letters with attachments
never expire), strictly better than the bank expansion ladder it hollows out.

Approved by the 2026-07-20 mastery and provenance amendments (state.md is the authority).
Tracked as issue #2236. Runs after Phase 12c and before Phase 13 (disenchanting mints a second
instanced-item family, so the stacking and marker work must precede it). Two companion BUG
fixes land with or ahead of this phase and are verified by it: #2139 (the corpse focus-harvest
bag overflow: `fitsAll` counts stack top-up room while `addItemInstance` needs a fresh slot;
the node-side twin was fixed in `harvestNode`, the reference policy) and the force-rename
instance-signer sweep (`server/characters.ts` re-keys the market and mailbox on rename but
never rewrites `ItemInstancePayload.signer` strings in character state: a moderation leak
that also breaks the self-signed reagent discount and Battlefield Experience attribution).

## Context pointers

- `docs/professions-2/state.md`: the mastery and provenance amendments block (the authority)
  and the Tuning targets mail-expiry row.
- `docs/professions-2/progress.md`: phase status and the phase-start commit record.
- `src/sim/bags.ts`: `stackSizeOf` (`UNSTACKED_KINDS`, `DEFAULT_STACK`), `addStacked` and
  `countFit` (the #1165 never-merge-into-an-instanced-slot rule this phase relaxes for
  byte-equal payloads), `canAddItem` / `fitsAll`.
- `src/sim/sim.ts`: `Sim.addItemInstance` (always pushes a fresh count-1 slot today; the
  third merge point) and `removeEnchantableItem` / the end-backward `removeItem` consumption
  order every counted-stack change must keep correct.
- `src/sim/bank.ts`: `moveBetweenContainers` (the instanced one-indivisible-unit arm; the
  fourth merge point, so same-signer stacks merge on DEPOSIT too).
- `src/sim/types.ts`: `ItemInstancePayload` (signer / charges / rolled / enchant / boundTo);
  payload equality must treat EVERY field, so an enchanted or bound copy never merges with a
  merely-signed one.
- `src/sim/social/trade.ts`: instanced-copy re-grant (payload preserved); counted instanced
  stacks must round-trip trade in both directions (extend the tests/trade.test.ts pins).
- `src/sim/professions/gathering.ts`: `harvestNode` (the signed-grant loop and the full-bag
  fallback to an UNSIGNED top-up, "the truncation contract wins over signing": the silent
  downgrade this phase makes visible) and `resolveHarvest` (`isSignableMaterialRarity`).
- `src/sim/interaction.ts`: corpse loot and harvest resolution, the claim-once rule
  (`harvestClaimedBy`), the focus picker, town focus (the tfocus wire key), and the corpse
  despawn/respawn lifecycle this phase decouples.
- VERIFIED MECHANICS (2026-07-20 read-only pass at the 12b QA tip; STEP 1 re-confirms at
  the phase tip; symbols only per the anchor rule):
  - The interact key never harvests: `interactKey` routes through `tryNearbyInteraction`
    to `lootCorpse` only; harvest is reachable only through the loot window
    (`LootWindowController.openCorpse`), which opens on BOTH click buttons and renders
    Take All plus the component picker.
  - The lifecycle coupling is real: a FULL loot runs `pruneCorpseLoot`, which empties the
    corpse, flips `lootable` false, and clamps `corpseTimer` low, so the respawn gate in
    the mob locomotion tick (`respawnTimer` elapsed AND (`corpseTimer` elapsed OR not
    lootable)) fires fast, and BOTH harvest entry points close even when
    `harvestClaimedBy` is still null: loot destroys harvestability. A harvest-only corpse
    keeps `lootable` true, so respawn defers until `corpseTimer` runs out (bounded by
    CORPSE_DURATION and the template respawnSeconds): the lingering-corpse report is
    literally correct. A PARTIAL loot leaves the corpse lootable and harvestable.
  - `harvestCorpse` touches only `harvestClaimedBy`, never loot state or timers; a
    full-bags harvest denial returns WITHOUT consuming the claim.
  - Town focus is not broken, it is illegible: authoritative `townFocus` can only be set
    inside the town circle, is consumed passively inside `harvestCorpse`
    (`applyFocusTierBonus` shifts tier by floor(points / 5) capped at +2, so under 5
    points does nothing; `applyFocusBonus` adds 10 percent yield per point that rounding
    can eat at low tiers), and the picker opens with an EMPTY selection: town focus is
    neither a picker default nor an auto-selector today.
  - Combined-press hazards for Slice C: the two resolvers have independent claim state
    and DIFFERENT capacity gates (loot checks per slot via `canAddItem`; harvest reserves
    max-tier quantity up front via `fitsAll`), so ordering decides starvation; and the
    loot half's prune destroys the harvest target, so the harvest half must resolve
    BEFORE, or atomically with, the loot prune.
- `src/sim/mail/post_office.ts`: `MAIL_POSTAGE`, `MAIL_MAX_ATTACHMENTS`, and the
  expiresAt-Infinity-while-attachments-remain rule this phase replaces.
- `server/characters.ts`: `rekeyMarketSeller` / `rekeyMailOwner`, the rename hooks the signer
  sweep joins.
- `src/ui/item_instance_tooltip.ts` (`instanceMakersMarkLine`) and
  `src/ui/i18n.catalog/hud_chrome.ts` (`makersMark`): the one-key copy bug ("Crafted by" on
  gathered items) and where the Gathered by variant lands.
- `src/sim/professions/battlefield_xp.ts` and `crafting.ts`: the two live signer consumers
  (attribution compares `instance.signer` to the observer name; the self-signed discount
  counts own-signed instances); the rename sweep and any merge change must keep both correct.
- The wire: instanced slots ride the inv payload; a counted instanced stack changes the
  count-1 assumption, so tests/snapshots.test.ts and the trade/bank suites are in scope.

## Starter Prompt

```
This is Phase 12d of the Professions 2.0 feature: Provenance and the harvest loop.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: identical-payload material stacking (bags and bank), honest provenance (Gathered by, a
bag-grid marker, the downgrade notice), one interact press that loots AND harvests with a
decoupled corpse lifecycle and a verified town focus, mail attachment expiry, and the two
companion bug fixes.

STEP 0 - PRE-FLIGHT:
- Sync with the LATEST release branch FIRST: git fetch origin "+refs/heads/release/*:refs/remotes/origin/release/*"; pick
  the newest by version sort (git branch -r --list "origin/release/*" | sort -V | tail -1). If this phase
  starts a fresh branch or worktree, base it on that branch; if the feature branch already exists, merge
  that release branch into it NOW, resolve conflicts, and run the release-merge-audit skill on the merge
  before proceeding. Never base work on main or an older release branch than the newest.
- Phase 12c must be LANDED (the reset and curve precede any inventory-shape change so the
  blob-diff rehearsal baseline stays clean); verify its surfaces entry in state.md.
- Run git status; the tree must be clean; stop if dirty with work you did not create.
- Memory scan (MEMORY.md index): node25-breaks-jsdom-gate, combo-recipes-broken-online (the
  #2033 stub trap), the professions packet entries.
- Record the phase-start commit in docs/professions-2/progress.md Notes.

STEP 1 - LOAD CONTEXT AND VERIFY THE LIFECYCLE (do NOT read planning docs directly): spawn
one Explore agent to read and summarize: docs/professions-2/state.md (the provenance
rulings), this phase file INCLUDING its VERIFIED MECHANICS block, src/sim/bags.ts,
src/sim/bank.ts, the addItemInstance and removeItem paths in src/sim/sim.ts,
src/sim/social/trade.ts, src/sim/interaction.ts and src/sim/professions/gathering.ts (the
corpse loot/harvest resolvers, claim-once, the focus picker and town focus end to end),
src/sim/mail/post_office.ts, server/characters.ts (the rename rekey hooks),
src/ui/item_instance_tooltip.ts, and the CLAUDE.md files for sim, professions, ui,
server, and tests. The summary MUST RE-CONFIRM the VERIFIED MECHANICS block against the
phase tip (the prune-on-full-loot arm, the respawn gate condition, the harvest-only
deferral, the town-focus consumption sites, the empty picker pre-selection, and the two
capacity-gate shapes); record any drift in the as-landed block BEFORE designing the
unified flow. The community claims are symptoms; the code is the truth.

STEP 2 - EXECUTE. Suggested slices: merge rule first (everything else composes with it),
then provenance UI, then the unified interact, then mail, with the two bug fixes as their
own commits (they may also land as standalone PRs ahead of the phase; verify rather than
re-fix if so).

Slice A, the identical-payload merge:
- Two slots merge iff same itemId AND byte-equal instance payloads (every
  ItemInstancePayload field participates; signer-only copies from the same gatherer merge,
  a signed copy never merges with a plain one, an enchanted or boundTo copy never merges
  with a merely-signed one) AND the stack cap holds. Equipment kinds (UNSTACKED_KINDS)
  stay one-per-slot regardless.
- All four merge points move together: countFit, addStacked, Sim.addItemInstance, and the
  moveBetweenContainers bank arm (deposits merge same-payload stacks too, the maintainer's
  explicit ask). The capacity pre-checks must model the merge identically or #2139-class
  overflow bugs return.
- The count-1-instanced-slot assumption dies here: audit EVERY consumer of instanced slots
  (trade offer/remove/grant, removeItem end-backward consumption, enchant consumption,
  bank moves, the wire inv encoding, save/load, vendor sell) for count handling. This is
  the phase's riskiest edge: budget tests accordingly (partial-stack trades, splitting,
  merging on both sides of a trade, wire round trips of counted instanced stacks).
Slice B, provenance:
- A "Gathered by {name}" i18n key beside makersMark; provenance resolved by item kind
  (gathered material kinds read Gathered by; crafted outputs keep Crafted by; NO new
  payload field, the eqi identity key and parity pins stay untouched).
- A bag-grid marker on instanced slots (a slot-corner glyph or border; information-add,
  preset-identical, works on mobile where the tooltip needs a long-press).
- The full-bag signed-yield downgrade (harvestNode's unsigned fallback) emits a text-free
  personal SimEvent rendered via a new hudChrome key ("the find was too big for your bags"
  wording is yours); extend the S3 scan list if a new sim module appears.
Slice C, the unified interact:
- One interact press on an eligible corpse loots AND harvests: kill loot resolves as
  today, then the harvest resolves using the player's focus selection with the town focus
  as the default (the right-click picker remains for per-corpse overrides). Server
  authoritative in both hosts; the claim-once rule and the hcb claim mirror are untouched.
- Composition rule: a harvest denial (tool tier, capacity) NEVER blocks the loot half, and
  vice versa; each half reports its own outcome; capacity pre-checks run per half.
- Ordering inside the unified press (from the verified hazards): the harvest half
  resolves BEFORE, or atomically with, the loot half's prune (loot-first destroys the
  harvest target); each half runs its own capacity gate (loot per-slot canAddItem,
  harvest up-front fitsAll) and reports its own outcome, and a harvest denial leaves the
  claim unconsumed exactly as today.
- Lifecycle decoupling against the verified state machine: an UNCLAIMED fully-looted
  corpse stays harvestable for a short grace window instead of closing both entry points
  (the pruneCorpseLoot lootable flip and timer clamp must stop hiding an unclaimed
  harvest); a harvest-only corpse no longer defers respawn for the full decay window
  (the respawn gate stops treating a still-lootable-but-harvested corpse as
  must-preserve once its loot is gone or claimed); neither half ever strands the corpse,
  and respawn is never hostage to manual cleanup. Pin the resulting machine in full.
- Town focus becomes legible: the picker opens with the active town focus PRE-SELECTED
  (today it opens empty), the unified press uses that selection, and the sub-5-point
  dead zone (tier shift is floor(points / 5)) plus the in-town-only setter get surfaced
  in the focus UI copy so the passive bonus reads as real.
Slice D, mail expiry:
- Letters with attachments get a 30-day expiry (ticks-derived, never wall clock in sim
  logic) with ONE return-to-sender cycle before deletion; system-authored mail (the Guild
  letters, the 12c reset notice, future work-order and tier mail) is exempt by
  construction (the authored-letter class, not an id list). Existing mailed stockpiles
  start their clock at the deploy, not retroactively expired.
- The expiry sweep rides the existing PostOffice update cadence; escrowed attachments
  return through the normal delivery path (a full mailbox holds the letter, never
  destroys it).
Companion fixes (own commits; verify-not-refix if the standalone PRs landed):
- #2139: the corpse focus-harvest capacity pre-gate models signed instances as fresh
  slots (the harvestNode policy is the reference).
- The rename signer sweep: a force-rename (and sanctioned rename) rewrites signer strings
  in the character's stored instances and live meta, beside rekeyMarketSeller and
  rekeyMailOwner; the self-signed discount and battlefield attribution follow the new
  name; old tooltips show the new name everywhere including eqi inspect.

INVARIANTS THIS PHASE MUST KEEP:
- Determinism: zero new Rng draws; the merge rule and lifecycle changes are pure
  bookkeeping; goldens stay byte-identical except any the as-landed block pre-briefs.
- Server authority: every merge, claim, grant, and expiry resolves server-side.
- IWorld both worlds: any new read or event lands on a facet, live in BOTH hosts,
  parity-pinned in the same change; the wire inv change round-trips counted instanced
  stacks.
- i18n: English-only keys; text-free stable-id events with matchers; the S3 scan list
  extended for any new sim module.
- Prime directive: nothing breaks. Plain-stack behavior, equipment slots, trade of
  non-instanced goods, and market/mail instance refusals are byte-identical; existing
  mailed attachments are never silently destroyed.

Out of scope (do NOT do in this phase):
- Market listing of instanced items (wave 2; the refusals stay).
- Any change to what GETS signed (the rarity and rare-event rules stand).
- Batch-loot or area-loot mechanics beyond the single-corpse unified press.
- Per-corpse quantity or specimen-rate tuning (the gland-to-pristine ratio report is a
  Phase 15 faucet-review row, recorded there).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW:
- npx tsc --noEmit; npx vitest run tests/architecture.test.ts.
- The inventory sweep: tests/bags.test.ts (or the bags suites found in STEP 1),
  tests/bank.test.ts, tests/item_instance.test.ts, tests/trade.test.ts,
  tests/snapshots.test.ts, tests/corpse_harvest_sim.test.ts,
  tests/gather_rare_events.test.ts, tests/interactions.test.ts plus every new suite.
- i18n rows: npm run i18n:gen then npx vitest run tests/i18n_completeness.test.ts
  tests/localization_fixes.test.ts.
- ui/render row: the mobile guard trio plus screenshots of the bag marker and the unified
  loot toast (pr-screenshots skill) under docs/screenshots.
- npm run ci:changed; scoped biome on touched files.
- Spawn review agents per the Review Dispatch Matrix (architecture-reviewer,
  cross-platform-sync for the wire change, privacy-security-review for the rename sweep,
  frontend-seam-reviewer for the marker, qa-checklist). COVERAGE, not filtering.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, Conventional Commits):
- feat(sim): identical-payload stacking across bags, bank, and trade
- feat(ui): gathered-by provenance, the instanced-slot marker, the downgrade notice
- feat(sim): one interact loots and harvests; the corpse lifecycle decoupled
- feat(sim): mail attachment expiry with the return cycle
- fix(sim): corpse focus-harvest capacity models signed instances (#2139)
- fix(server): rename sweeps instance signer strings

STEP 5 - ACCEPTANCE CRITERIA (do not mark complete until all check):
- [ ] Two same-signer gathered materials merge in bags and via bank deposit; a signed and
      a plain copy still do not; enchanted and bound copies never merge with
      merely-signed; equipment never stacks.
- [ ] Counted instanced stacks round-trip trade (both directions), bank moves, save/load,
      and the wire, payloads intact, both hosts.
- [ ] Gathered signed items read Gathered by; crafted keep Crafted by; instanced slots
      show the marker on desktop and mobile; the full-bag downgrade emits its notice.
- [ ] One interact press grants kill loot AND the focused harvest; a denial of either
      half never blocks the other; the picker still overrides per corpse; town focus is
      the visible default.
- [ ] The verified corpse lifecycle is recorded in the as-landed block and pinned: no
      loot-then-cannot-harvest, no harvest-then-stranded-corpse, respawn never hostage to
      manual cleanup.
- [ ] Mail attachments expire per the model; the return cycle works; system mail never
      expires; pre-existing mail starts its clock at deploy.
- [ ] #2139 fixed and pinned at the exact overflow seed class; the rename sweep fixed and
      pinned (market, mail, AND signer strings all follow a rename).
- [ ] Zero new Rng draws; goldens byte-identical outside any pre-briefed list.
- [ ] All validation rows green; screenshots committed.

STEP 6 - DOC UPDATES + MEMORY: update progress.md (status row, checklist, phase-start
commit) and state.md (New surfaces: the merge-rule symbols, the new keys and events, the
expiry constants, the verified lifecycle summary; any rollback caveat for counted
instanced stacks under old code, the mailWelcomed class). Record surprises to memory.

STEP 7 - FINAL RESPONSE FORMAT: phase status; files touched; validation results; review
verdicts; deferrals; one line for the Phase 12d QA handoff naming the phase-start commit.

AS-LANDED (2026-07-21, build session; authoritative over the older wording above):
- Merge rule: src/sim/item_instance_merge.ts (itemInstancePayloadsEqual,
  isMergeableInstancePayload, canStackInstancePayloads). One carve-out beyond the
  byte-equality spec: a payload carrying `charges` never merges (the one field with
  mutate-in-place per-unit semantics; no shipped stackable item carries charges, this is
  a forward guard). removeItem/removeEnchantableItem return one payload PER UNIT,
  deep-cloned while the source slot survives (the enchant-aliasing guard).
  sanitizeBankState now preserves counted instanced slots (was: force count=1).
  moveBetweenContainers still moves an instanced slot whole (partial instanced splits
  are unimplemented, wave 2); trade fitsAfterSwap models the receive side merge-aware
  from the giver's real slots, with the old conservative model as the fallback for
  stub harnesses. Vendor buyback still re-grants plain copies (pre-existing payload
  loss, documented at the site).
- Slice C landed with NO new wire command and NO new IWorld member: the unified press
  composes the two existing commands (harvest_corpse then loot_corpse, client-dispatched
  per the corpseLootAvailability predicate, order-preserved in the tick batch), and the
  town-focus default is server-derived via the components-OMITTED arm of harvestCorpse
  (explicit [] keeps the spread semantics; the IWorldInteraction doc was updated).
  Sim.interact()'s targeted-corpse arm was unified in a follow-up commit (the stage
  landed only the scan arm). Lifecycle: CORPSE_INTERACT_GRACE_SECONDS = 30 in
  loot_roll.ts; Arm 2 gained a pending-need-greed-roll guard (hasPendingLootRollForMob,
  now exported) so a harvest during a pending roll cannot clamp the corpse under the
  roll floor. The respawn gate formula is untouched. Pre-existing and out of scope: a
  tagged corpse whose death roll yields NO loot gets lootable=false at handleDeath and
  never opens for harvest (the Phase 3 note stands).
- Provenance: resolved by kind, `junk` = gathered (every signable gathered item is kind
  junk; no recipe output is; both sides pinned). Fish are kind `food` and are never
  signed today; if fishing ever signs a catch the split needs revisiting. The bank
  window is a bespoke painter (not the bag-item family), so the instanced marker is
  bags-only. gatherDowngrade SimEvent {pid, surface, lost:'mark'|'find'} with keys
  hudChrome.gathering.downgradeMark/downgradeFind; when one command loses both, the
  single deduped event reports `mark` (the plain-fallback loop runs first, pinned).
- Mail: MAIL_ATTACHMENT_EXPIRY_SECONDS = 30 days; MailMessage/MailSave gained
  `returned` (additive). The return is an in-place re-key onto the senderName bucket
  (the loadMail soulbound precedent), deliberately bypassing the send-time
  MAIL_MAX_PER_RECIPIENT gate so a full sender box holds the letter. The delete arm
  structurally requires `returned`. mailTake's emptied-clock condition generalized to a
  hadAttachments capture (behavior-identical for every pre-phase state). Deploy clock:
  loadMail assigns now+30d to player parcels persisted with the never sentinel.
- Companion fixes: the filed #2139 crossing case was ALREADY guarded by the Phase 10 QA
  grant-order fix (verify-not-refix outcome); the phase added the hunted-seed pin plus
  merge-aware signed-grant guards (bags.ts canGrantItemInstance) at both corpse arms,
  so a full bag with a byte-equal stack now keeps the signature instead of downgrading
  (harvestNode's guard was already merge-aware via stage 1's countFit). Rename sweep:
  src/sim/character_rename.ts rekeyInstanceSigner sweeps the renamed character's OWN
  blob (carried + bank + equipped); mail attachments and market escrow hold no
  instances by construction; foreign-held copies keep the stale name BY SCOPE (a
  flagged maintainer surface, not an oversight); the live-meta arm is structurally
  unreachable behind the offline gate and is documented at the call site.
- Parity: two deliberate golden regens, each its own commit with draws verified:
  professions_gather (same-signer materials now merge, draws/drawDigest/eventDigest
  byte-identical) and l1_loot_distribution (the grace arm defers the fully-looted
  tagged corpse's respawn, moving its wanderTimer draw past the trace window; every
  pre-existing frame byte-identical).
- Review round (7 reviewers, zero blocking): three should-fixes landed in-branch: the
  instanced marker gained its accessible-name arm (hudChrome.bags.itemAriaInstanced,
  the aria-hidden corner tab alone was sighted-only), the removeItem partial-take
  survivor-clone arm got its own pin beside the removeEnchantableItem sibling, and
  the rollback caveat was recorded in state.md (the migration reviewer caught it
  unrecorded). The full suite also caught five loot-distribution pins asserting the
  pre-12d fast collapse on emptied tagged corpses plus the retired-heroic mail
  round-trip (the deploy clock); all re-pinned with comments in
  test(sim): re-pin full-suite corpse and mail contracts.

QA post-inventory (2026-07-21, the Phase 12d QA pass, PASS zero blocking):
- Conservation held in every probe: real-Sim partial/counted trades both
  directions (incl. both sides offering the same payload in one confirm),
  removeItem/removeEnchantableItem per-unit clone-on-survival, bank
  deposit-merge/withdraw-split, vendor sell, save/load, the countFit cap
  edges, and the charges carve-out at every merge point.
- Landed in the QA pass: the shared instancedCountCap tamper ceiling on BOTH
  persisted load arms (the carried arm loaded tampered counts verbatim; the
  unknown-def mergeable arm is now dormant-uncapped on both), a REAL-Sim
  counted-stack trade pin (the stub-drift gap), the harvestCorpse-arm
  never-raise pin, press-level denial-decoupling pins on both interact
  arms, the mail deploy clock's absent-field arm, typed gathering toast key
  helpers, and the user-directed loot-window legibility fix (Take Loot,
  attachTooltip-idiom tooltips on both corpse buttons, the unified-press
  footer hint; new keys, five non-Latin fills each, retired keys stripped
  everywhere, before/after shots desktop and mobile).
- Verified live but deliberately unpinned-then-pinned classes are recorded in
  progress.md's QA row; deferrals with reasons: fitsAfterSwap's payload-blind
  scratch removal (capacity modeling only; wave 2 with partial splits), the
  rename-save no-nonce TOCTOU (self-state, tiny window), the unbounded
  harvest_corpse components length (server short-circuits it), the
  "maker-marked" accessible-name overclaim on per-copy stacks (maintainer
  copy call), and the unified-press hint on loot-only corpses (the approved
  wording is unqualified).
- The DESTRUCTIVE sanitizeBankState rollback caveat stays recorded in
  state.md; docs/release-notes/ has no v0.29.0 file yet, so propagation into
  player-facing notes is a release-cut item, not a QA item.
- The standing 12b Pin-cost appendix re-inventory (closed pin lists are
  re-inventoried after every later phase): zero rows moved by 12d. The
  gather_open_gate harvest-only-corpse flip is the unified-press canOpen
  contract (deliberate, re-pinned with its comment), and the
  gather_rare_events changes are additive #2139-family pins; both sit
  outside the appendix's bite/reel/cast families.

STOPPING RULES:
- Stop if payload-equality merging cannot be made safe for any consumer of instanced
  slots without redesigning that consumer; surface the consumer instead of forcing it.
- Stop if the verified lifecycle contradicts this phase file's premises in a way that
  changes the design (record the truth in the as-landed block and ask).
- Stop if mail expiry would destroy any item without the return cycle having run.
```
