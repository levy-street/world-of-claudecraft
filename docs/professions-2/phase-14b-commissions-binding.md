# Phase 14b: Commissions and the Maker's Bond

Crafted goods gain a way to be made FOR someone. An opt-in commission craft binds to its
recipient on FIRST trade: the crafter hands the piece over face to face, the trade gate stamps
`boundTo`, and from then on the same gate that blocks def-level soulbound items refuses to pass
it on; a master NPC unbinds for gold. This resolves the enforcement semantics #1298 left open
(the full commission ORDER workflow, open/accept/deliver, stays layered on top later) and gives
the bind-on-trade primitive Phase 13 lands (first applied to the typed disenchant reagents) its
second consumer. It is its own slice because it is a small, sharply bounded trade-gate and
service change over surfaces that all exist: `boundTo` already persists and rides trade
payloads, mail and the market already refuse instanced items (so first delivery is
face-to-face by construction), and the masters already run gold-sink services. Approved by the
2026-07-20 timing and economy amendments (state.md is the authority); tracked as issue #2207,
which links #1298.

The three flagged maintainer decisions are RESOLVED by the second 2026-07-20 block (mastery
and provenance; the OPEN items rows carry the rationale): the Maker's Bond binds to the
CHARACTER; opt-in item classes are equipment only (weapon, armor, held_offhand); the unbind
fee is tier-scaled on the training-fee family (2500 / 10000 / 40000 copper by quality tier,
clamp-to-last). STEP 0's gate is satisfied; implement exactly these.

## Context pointers

- `docs/professions-2/state.md`: the 2026-07-20 timing and economy amendments block (the
  authority), the OPEN items rows RESOLVING this phase's three maintainer decisions, and the
  locked economy pillars (crafted below the raid floor; NPCs only sink gold).
- `docs/professions-2/progress.md`: the Phase 14b status row and checklist.
- `docs/professions-2/phase-13-enchanting.md`: the bind-on-trade PRIMITIVE this phase extends
  (landed there against the typed disenchant reagents; never re-implement it).
- `src/sim/types.ts`: `ItemInstancePayload.boundTo` (persists in saves via the inventory
  clone path, pinned by tests/bank.test.ts and tests/item_instance.test.ts; rides trade
  payloads intact, pinned in tests/trade.test.ts; NOTHING enforces it before Phase 13).
- `src/sim/social/trade.ts`: `tradeSetOffer` (the def-level gate that silently drops quest and
  soulbound slots; instance-aware counting via ctx.countItem) and the two-phase
  `tradeConfirm` (removeOffer both sides then grantOffer both sides, the Phase 3 QA fix).
- `src/sim/mail/post_office.ts` (the PostOffice `mailSend` / `mailSendResolved` paths:
  attachments validate against countFungibleItem, so instances never mail) and
  `src/sim/market.ts` (`marketList`: same fungible-only rule; real instance carriage is the
  closed #1146's scope, re-homed to a named follow-up when picked up). These make first
  delivery face-to-face BY CONSTRUCTION; verify, do not rebuild.
- `src/sim/professions/training.ts`: `TRAINING_FEE_BY_TIER` and the `resolveTrain` deny-order
  shape, the master gold-sink service precedent the unbind service follows.
- `src/sim/professions/crafting.ts` and `masterwork.ts`: the craft resolver the commission
  opt-in joins; the maker's mark (signer) and masterwork markers the bond composes with.
- `server/game.ts`: command dispatch (the unbind command re-validates server-side).
- The armory/identity wire strips instance payloads including boundTo (server/game.ts, pinned
  in tests/snapshots.test.ts): keep that data-minimization intact.
- Local conventions: `src/sim/CLAUDE.md`, `src/sim/professions/CLAUDE.md`, `src/ui/CLAUDE.md`,
  `tests/CLAUDE.md`.

## Starter Prompt

```
This is Phase 14b of the Professions 2.0 feature: Commissions and the Maker's Bond.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: opt-in commission crafts that bind to the recipient on first trade, enforced in the
trade gate beside the def-level soulbound rule, with a master unbind service as a gold sink.

STEP 0 - PRE-FLIGHT:
- Sync with the LATEST release branch FIRST: git fetch origin "+refs/heads/release/*:refs/remotes/origin/release/*"; pick
  the newest by version sort (git branch -r --list "origin/release/*" | sort -V | tail -1). If this phase
  starts a fresh branch or worktree, base it on that branch; if the feature branch already exists, merge
  that release branch into it NOW, resolve conflicts, and run the release-merge-audit skill on the merge
  before proceeding. Never base work on main or an older release branch than the newest.
- Run git status; the checkout must be clean. Record the phase-start commit in
  docs/professions-2/progress.md Notes.
- Memory scan (MEMORY.md index): node25-breaks-jsdom-gate, combo-recipes-broken-online (the
  2033 stub trap), design-language-program, the professions packet entries.
- THE THREE MAINTAINER DECISIONS ARE RESOLVED (2026-07-20 mastery amendments; read the
  state.md OPEN items rows verbatim): character binding, equipment-only opt-in classes,
  the tier-scaled unbind fee ladder. Verify the rows still read RESOLVED; if any has been
  reopened, stop and ask; never decide them silently.
- Phase 13 must be LANDED (it owns the bind-on-trade primitive). Verify its trade-gate arm
  exists (grep the enforcement site it recorded in state.md); if absent, stop.

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly):
Spawn one Explore agent to read and summarize: docs/professions-2/state.md (the 2026-07-20
amendments block, the resolved decision rows, the Phase 13 surfaces entry),
docs/professions-2/progress.md, this phase file, src/sim/social/trade.ts (tradeSetOffer and
the two-phase tradeConfirm), the PostOffice mailSend/mailSendResolved paths in
src/sim/mail/post_office.ts and src/sim/market.ts
marketList (the fungible-only refusals), src/sim/types.ts ItemInstancePayload,
src/sim/professions/training.ts (the fee and deny-order precedent), the Phase 13 bind-on-trade
enforcement arm as landed, src/sim/professions/crafting.ts, server/game.ts dispatch, and the
CLAUDE.md files for sim, professions, ui, server, and tests. The summary must return: the
exact trade-gate shape and where the def-level soulbound check sits, the Phase 13 primitive's
symbols and pins, how boundTo persists and travels today, the master service dispatch
pattern, and the three resolved maintainer decisions verbatim.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE: sim agent first (opt-in + gate arm + unbind),
then ui and tests agents in parallel against the landed seam.

Agent sim deliverables:
- Commission opt-in at craft time: an explicit flag on the craft command (facet + wire; the
  crafting window sends it only when the player chose it) stamping the output instance with
  the commission marker (an additive ItemInstancePayload field or the Phase 13 shape,
  whichever the primitive established; never a parallel mechanism).
- Bind on first trade: when a commissioned, not-yet-bound instance transfers through
  tradeConfirm, stamp boundTo = the receiving character per the resolved binding-scope
  decision. The refusal arm for an ALREADY-bound instance rides the Phase 13 primitive in
  tradeSetOffer, beside the def-level soulbound drop, with a localized deny id (never a
  silent drop for this case: the player must learn WHY, unlike the legacy silent soulbound
  skip; if you make the soulbound skip loud too, that is a separate deliberate decision, do
  not bundle it).
- The bound holder can still equip, use, bank, and vendor the piece per the resolved
  decisions; only onward TRADE is refused (and mail/market were never possible for
  instances; verify with a pin, do not rebuild).
- Master unbind service: a command on the station masters (the resolveTrain shape: pure
  resolver, deny order, fee charged exactly once on success, server-validated, replay-safe),
  clearing boundTo for the resolved price. Gold sink only; no item mutation beyond the field
  clear; signer and masterwork markers survive unbind, pinned.
- Save/load: the new marker is additive JSONB with normalize-on-load defaults; old saves
  load clean; the rollback caveat (old code strips unknown instance fields on round trip)
  is recorded in state.md if it applies (the mailWelcomed class).

Agent ui deliverables:
- The commission opt-in control in the crafting window (off by default, per-craft, today's
  tokens; visible only for the opted-in item classes per the resolved decision).
- Tooltip lines: commissioned-unbound ("Commission piece: binds to the first recipient") and
  bound ("Bound to {name}") on the item-instance tooltip module
  (src/ui/item_instance_tooltip.ts composes with the seal and maker's mark lines).
- The unbind dialog at the master (vendor/train window family), showing the fee before
  confirm; deny toasts localized.
- Every player string is an English-only t() key; trade/unbind deny ids ship their render
  keys in the SAME change (text-free id events, the craftResult/trainResult precedent).

Agent tests deliverables:
- Gate arms: first trade stamps the right character; the second trade is refused with the
  deny id; a non-commission instance is untouched; unbind restores tradeability; re-binding
  on the next trade after unbind (per the resolved semantics); replay/duplicate safety on
  the unbind fee.
- Persistence: the marker and boundTo survive save/load and the trade payload round trip
  (extend tests/trade.test.ts and tests/item_instance.test.ts pins).
- The mail/market face-to-face construction pin: a commissioned instance cannot be mailed
  or listed (assert the EXISTING refusal covers it; if either path has a fungible-count
  hole for the new marker, that is a finding, not a new system).
- Both hosts: the live GameServer trade round trip with the bound refusal, and the
  ClientWorld mirror of whatever read the UI consumes (LIVE, the 2033 stub trap).
- A same-seed determinism pin if any new sim state affects the tick.

INVARIANTS THIS PHASE MUST KEEP:
- The locked pillars: crafted power below the raid floor (binding is a trade rule, never a
  stat change); masterwork stays the celebrated ceiling; NPCs only sink gold.
- Server authority: the stamp, the refusal, and the unbind resolve server-side; the client
  never decides.
- Determinism: no new rng; no wall-clock anywhere in sim logic.
- IWorld both worlds, parity-pinned, live.
- i18n: English-only keys; stable deny ids; the S3 guard green.
- Prime directive: nothing existing breaks. Non-commission trades are byte-identical; the
  standing wire invariant holds (no wire command ingests a client-supplied
  ItemInstancePayload; the stamp is minted server-side).

Out of scope (do NOT do in this phase):
- The commission ORDER workflow (open/accept/deliver/cancel UI and state; #1298 stays open
  for it).
- Recipient-tied required materials (needs order-time escrow, per #1298's notes).
- Market surfacing of boundTo and instance carriage (the closed #1146's scope; re-homes to a
  named follow-up when picked up, wave 2).
- Any binding of NON-commission output (opt-in only).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW:
- npx tsc --noEmit; npx vitest run tests/trade.test.ts tests/item_instance.test.ts
  tests/bank.test.ts tests/professions_crafting.test.ts tests/architecture.test.ts plus
  every new suite.
- net/wire row: npx vitest run tests/snapshots.test.ts tests/env_protocol.test.ts
  tests/bandwidth.test.ts tests/world_api_parity.test.ts.
- i18n row: npm run i18n:gen then npx vitest run tests/i18n_completeness.test.ts
  tests/localization_fixes.test.ts.
- ui/render row: the mobile guard trio plus a screenshot of the opt-in control and the
  bound tooltip (pr-screenshots skill) under docs/screenshots.
- npm run ci:changed; scoped biome on touched files.
Then spawn review agents per the Review Dispatch Matrix (expect cross-platform-sync,
architecture-reviewer, privacy-security-review for the trade/server surface,
frontend-seam-reviewer, and qa-checklist). COVERAGE, not filtering; resume truncated
agents.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, Conventional Commits):
- feat(professions): commission opt-in and the maker's bond stamp
- feat(professions): bind-on-first-trade enforcement and the master unbind service
- feat(ui): commission control, bound tooltips, unbind dialog
- test(sim): gate arms, persistence, and live-server coverage

STEP 5 - ACCEPTANCE CRITERIA (do not mark complete until all check):
- [ ] A crafter opts a craft into commission mode; the instance carries the marker in both
      hosts; non-opted crafts are byte-identical to today.
- [ ] The first successful trade stamps boundTo per the resolved binding scope; a second
      trade is refused with a localized deny id in both hosts.
- [ ] A commissioned instance cannot be mailed or market-listed (existing refusals pinned
      against the new marker).
- [ ] The master unbind service charges the resolved fee exactly once, replay-safe, and
      restores tradeability; signer and masterwork markers survive.
- [ ] The three maintainer decisions are implemented exactly as resolved in state.md and
      surfaced in the PR body.
- [ ] Save/load and trade payload round trips carry the new field; old saves load clean.
- [ ] All validation rows green; screenshots committed.

STEP 6 - DOC UPDATES + MEMORY: update progress.md (status row, checklist, phase-start
commit) and state.md (New surfaces: the marker field, the deny ids, the unbind command and
fee constant, the i18n namespaces; any rollback caveat). Record surprises to memory.

STEP 7 - FINAL RESPONSE FORMAT: phase status; files touched; validation results; review
verdicts; deferrals; one line for the Phase 14b QA handoff naming the phase-start commit.

STOPPING RULES:
- Stop if any of the three flagged maintainer decisions is unresolved in state.md; never
  default them.
- Stop if the Phase 13 primitive did not land or landed with a shape this phase cannot
  extend without redesign.
- Stop if enforcing the bond would require making the legacy silent soulbound drop loud as
  a side effect; surface that as its own decision.
```
