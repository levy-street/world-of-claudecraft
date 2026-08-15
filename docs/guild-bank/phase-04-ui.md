# Phase 4: UI (the Guild tab in the bank window)

### Starter prompt
```
This is Phase 4 of the Guild Bank feature: UI.

Model: newest available Claude coding model, xhigh effort. Harness: Claude Code.
Worktree: /Users/seanghods/repos/world-of-claudecraft-guild-bank.

Goal: give the bank window a Personal / Guild tab switch; the Guild tab renders the
treasury, the pooled slots, deposit/withdraw/expansion actions, and exists only for
officers+ standing at a banker.

STEP 0 - PRE-FLIGHT: git status clean; memory scan; confirm Phase 3 QA passed.

STEP 1 - LOAD CONTEXT (via one Explore agent):
- docs/guild-bank/state.md + progress.md Phase 4
- The existing bank window family in src/ui/ (locate the personal bank window/view/
  painter modules and how they consume IWorldBank), src/ui/social_window.ts tab-row
  pattern, src/ui/unit_portrait.ts + unit_portrait_painter.ts (the pure-core reference)
- src/ui/CLAUDE.md and src/styles/CLAUDE.md (view-core recipe, UI_PURE_CORES, painter
  contracts, hud perf budget buckets, layer/token rules), src/ui/hud/CLAUDE.md
- src/ui/i18n.catalog/: the domain module holding the personal bank strings
- tests/architecture.test.ts (UI_PURE_CORES allowlist), tests/hud_perf_budget.test.ts
Return: the bank window family's exact module names and contracts, the tab idiom, where
bank i18n keys live, and which budget bucket the bank window sits in.

STEP 2 - EXECUTE: single agent or two (view core + window wiring) depending on the
family's shape; each slice writes its own tests:
Deliverables:
- A DOM-free view core (guild_bank_view or the family's naming), registered in
  UI_PURE_CORES, deriving the render model from GuildBankInfo (slot rows, capacity,
  treasury via the i18n formatMoney at the boundary, next expansion price and
  affordability, all action enablement).
- The Guild tab in the bank window family: renders ONLY when guildBankInfo is non-null
  (officer+ at a banker, online); hidden otherwise including offline and for members;
  actions call the IWorldGuildBank commands; follows the family's cold-window or painter
  contract per its existing bucket in tests/hud_perf_budget.test.ts.
- English i18n keys in the bank domain module (tab labels, treasury, deposit/withdraw
  prompts, expansion price/buy, refusal toasts for the sim errors not already covered by
  sim_i18n rows). Short labels; if any value is wordy, M16 applies (five non-Latin fills
  in the same change).
- Mobile: verify with a mobile screenshot script against a phone viewport (npm run dev);
  comfortable tap targets; no hover-only information.
- PR screenshots per the pr-screenshots skill (desktop + mobile, Personal and Guild tabs)
  committed under docs/screenshots.

INVARIANTS IN PLAY: view-core + thin consumer (no logic in the window shell), i18n
render-sink rules, graphics-settings fairness untouched, styles under the layer contract,
no em dashes/emojis (and no emoji stand-ins for labels).

Out of scope: member-visible variants, bank log window, any new server or sim behavior.

STEP 3 - VALIDATION + REVIEW:
- npx tsc --noEmit; npx vitest run the new view-core suite plus
  tests/architecture.test.ts tests/hud_perf_budget.test.ts
  tests/localization_fixes.test.ts; npm run ci:changed; a mobile screenshot script run.
- Dispatch: frontend-seam-reviewer, cross-platform-sync (facet consumption only).

STEP 4 - COMMIT CADENCE (explicit paths):
- feat(ui): add the guild tab to the bank window
- test(ui): cover the guild bank view core
- docs(screenshots): add guild bank before/after captures

STEP 5 - ACCEPTANCE:
- [ ] Officer at a banker sees both tabs; member sees only Personal; offline sees only
      Personal; walking away closes/empties the Guild tab state cleanly.
- [ ] Every action round-trips through the facet; refusals surface localized.
- [ ] View-core suite green in Node; architecture + budget guards green; screenshots
      committed and referenced.
- [ ] (Phase 3 QA carried-forward) NO new client command or server path mutates a guild
      book outside the existing five guild_bank_* tokens: every server-side book mutation
      MUST flow through runGuildBankOp (server/game.ts), whose before/after diff feeds
      BOTH the bank_ledger rows and the per-session unflushed-delta log that the
      fence-out revert (Sim.revertGuildBankDeltas) depends on. A mutation that bypasses
      the observer silently breaks the anti-dupe guarantee.
- [ ] (Phase 3 QA carried-forward) A pipe-refused (dormant) slot arrives with a
      publicInstanceView projection and is refused in both directions: the Guild tab
      must render it visibly distinct (unwithdrawable), because such a slot also blocks
      disband forever (the documented v1 limitation in state.md); do not hide it.
- [ ] (Phase 3 QA carried-forward) The disband/last-member-leave refusal line can fire
      transiently while an emptying op is still unflushed (fail-closed guard, self-heals
      within one autosave interval): surface the server line as-is, no special client
      error state.

STEP 6 - DOCS: update progress.md + state.md ledger (modules, keys, screenshots).

STEP 7 - FINAL RESPONSE: status, files, validation, review verdicts, handoff to Phase 4
QA (the packet-closing QA).

STOPPING RULES: stop and ask if the bank window family turns out to be painter-driven in
a way that forces per-frame guild bank writes (write-elision contract), rather than
improvising a new painter pattern.
```
