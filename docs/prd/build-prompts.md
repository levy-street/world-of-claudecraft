# Build Prompts (for Claude Code goal commands)

Two self-contained prompts that drive the **end-to-end implementation** of each feature directly from its PRD. The PRDs already contain all the detail (requirements, data model, hook points with `file:line`, phasing, tests, acceptance criteria) — these prompts just execute against them.

## How to use

- **Recommended:** `/gsd:new-milestone` (or `/gsd:plan-phase` per phase) with the prompt pasted in — it runs the discuss → plan → execute → verify loop, one PRD phase at a time.
- **Direct:** `/gsd:do "<paste prompt>"` or paste as a normal Claude Code message.
- The prompts tell the agent to **read the PRD first** and treat it as the source of truth; if code reality and the PRD disagree, re-verify against code and note the deviation.

Shared rules (both prompts):
- **Read the PRD in full before writing any code.** It is the spec. Implement to its Functional Requirements and Acceptance Criteria.
- **Build phase-by-phase** in the PRD's order. Do not skip ahead. After each phase: build passes, tests pass, then continue.
- **Re-verify every `file:line` anchor against the current tree** before editing — the repo moves fast (v0.4 shifted many line numbers). Trust the PRD's *intent*, re-find the exact location.
- **Server-authoritative:** all game logic lives in the `Sim`; the client only displays. Never trust client-sent effects.
- **i18n:** every new UI string goes through `t()` in `src/ui/i18n.ts` — no hardcoded display text.
- **Tests:** add the tests named in the PRD's Testing Strategy. Follow existing patterns (`tests/snapshots.test.ts`, `tests/sim.test.ts`, etc.). `npm run build && npm test` must pass before a phase is "done."
- **Git hygiene:** work on a feature branch, atomic commits per logical chunk, do not commit to `main`. Open a PR only when asked.
- **Stay in scope:** build exactly what the PRD specifies — respect its Non-goals. Flag anything genuinely blocking instead of inventing scope.

---

## PROMPT 1 — Build: Max-Level XP Overflow & Post-Cap Progression

```
GOAL: Implement the "Max-Level XP Overflow & Post-Cap Progression" feature end to end, exactly as specified in docs/prd/max-level-xp-overflow.md. The PRD is the source of truth — read it fully before coding.

SETUP:
- Read docs/prd/max-level-xp-overflow.md completely (all functional requirements, data model, UI/UX, performance, phasing, testing, acceptance criteria).
- Re-verify the "Current state in the codebase" anchors against the live tree (line numbers may have moved). Confirm the three cap-gates the PRD calls out before changing them: the solo early-return in grantXp, the party-member XP gate, and the at-cap discard.
- Create a feature branch.

BUILD (follow the PRD's Phasing section in order; build + test green between phases):

Phase 1 — Overflow counter:
- Add the lifetimeXp field to CharacterState (JSONB blob — no DB migration); serialize and deserialize it.
- Update ALL cap-gates so XP still accrues to lifetimeXp at cap (solo grantXp early-return, the party-member gate, and the discard — route remainder to lifetimeXp instead of zeroing). Keep mobXpValue level-diff scaling intact (anti-farm).
- Surface "Total XP" on the character sheet and in the XP-bar hover (strings via i18n).

Phase 2 — Virtual levels:
- Add virtualLevel(lifetimeXp) next to xpForLevel in types.ts, extending the curve past MAX_LEVEL with a cached threshold table; below cap virtualLevel == level.
- Make the XP bar fill toward the next virtual level past cap, with distinct (prestige/gold) styling and the PRD's label format. Fire a cosmetic banner + sound on virtual level-up (reuse the levelup toast path).
- Add the showOverflowXp settings toggle.

Phase 3 — Leaderboard + cosmetics:
- Add the GET /api/leaderboard endpoint (realm-scoped, indexed, server-side cached with periodic refresh — follow the chat-censor cache pattern).
- Add a leaderboard panel (model on the quest-log two-column window), highlight the viewer's own rank, bound to a key/button. All strings via i18n.
- Implement cosmetic milestone rewards (titles/borders), persisted in unlockedMilestones, surfaced on the character sheet, with an unlock banner.

Phase 4 (only if the PRD/owner includes it) — Prestige:
- Add the prestige command (IWorld -> cmd() -> server switch -> Sim), reset only the level bar (not lifetimeXp), increment prestigeRank, show rank in UI + leaderboard, with the confirmation dialog from the PRD.

CONSTRAINTS:
- Cosmetic-only post-cap (no power creep at the level-20 cap).
- lifetimeXp and virtualLevel computed server-side in the authoritative Sim; client displays derived values only.
- No additions to the combat hot path; leaderboard never computed per-request under load.

TESTING (per the PRD's Testing Strategy):
- Add tests/xp.test.ts: at-cap XP routes to lifetimeXp (not gold/zero) for both solo and party paths, mid-level carry still works, virtual-level boundaries, level-diff scaling still gates trivial mobs, prestige resets bar but not lifetimeXp.
- Snapshot the XP-bar label states (pre-cap / at-cap / post-cap).
- Verify the online (ClientWorld) path, not just offline.
- Manual: ALLOW_DEV_COMMANDS=1, setPlayerLevel to 20, kill mobs, confirm lifetimeXp grows + virtual level increments + persists across logout; hit /api/leaderboard.

DONE = all Acceptance Criteria in the PRD are met, npm run build && npm test pass. Summarize what shipped per phase and anything deferred.
```

---

## PROMPT 2 — Build: Talents & Specializations

```
GOAL: Implement "Talents & Specializations" end to end per docs/prd/talents-and-specializations.md. Read the PRD fully before writing any code. Build a ONE-CLASS vertical slice first, then fan out.

SETUP: Read the PRD. Re-find the three hook points in the live tree (sim.ts/hud.ts moved in v0.4): passive stat pass (recalcPlayerStats), ability injection (abilitiesKnownAt/refreshKnownAbilities), ability modifier application (runEffects). Create a feature branch.

ARCHITECTURE: Precompute all talent effects into a FLAT modifier struct at allocation/respec/loadout-switch time. The combat hot path reads flat numbers only — never walk the tree.

BUILD (phase-by-phase; build + test green before advancing):

Phase 0 — Data model + ONE class tree:
TalentNode in src/sim/content/talents.ts (kind: passive|active|choice, ranks, requires, pointsGate, choices, effect, layout). Load-time validation (no cycles, valid prereqs, gate sanity).

Phase 1 — Passive talents:
Point economy, allocation/respec commands (IWorld→cmd→Sim), server-validated. Precompute statModifiers; apply in recalcPlayerStats. Persist in CharacterState JSONB. Free respec out of combat only.

Phase 2 — Talent UI:
Panel bound to 'N', Class/Spec tabs, shape-coded nodes, prereq arrows, staged edit + Apply + Clear. Tooltips via attachTooltip. All strings via i18n.

Phase 3 — Active talents + ability modifiers:
Granted abilities via abilitiesKnownAt/refreshKnownAbilities. Ability modifier tables read in runEffects. Choice nodes. Snapshot-lock damage numbers before/after each talent.

Phase 4 — Specs, loadouts, build strings:
Specialization sets role (tank/heal/dps), grants signature ability + Mastery. Named loadouts (talents + spec + bar); switch out of combat. base64 build strings, re-validated server-side on apply.

CONSTRAINTS: Server-authoritative — reject client-claimed state. No per-tick tree evaluation. No gold respec cost. Combat/arena lock on respec.

TESTING:
- Unit (tests/talents.test.ts): tree validation, allocation rules, dormant-dependent behavior, stat effects + clean revert on respec, build-string round-trip, version mismatch rejection.
- API: POST /talent/spend and /talent/respec reject invalid state server-side; loadout switch endpoint restores correct talents + spec + bar.
- Browser (ClientWorld path): open talent panel in-browser, spend points, Apply, respec, switch loadout — verify UI reflects server state. Use ALLOW_DEV_COMMANDS/setPlayerLevel for setup.
- DB: CharacterState JSONB persists talent allocation across logout/login. Confirm no migration needed.
- Perf: no per-tick regression vs baseline.

DONE = Acceptance Criteria met for ONE class, npm run build && npm test pass. List remaining classes needing trees.
```

---

## Notes for maintainers

- These prompts assume the two PRDs in this folder exist and are current. If a PRD changes, the prompt automatically picks up the change (it reads the PRD at run time).
- They deliberately build **phase-by-phase with green build+tests between phases** so a long milestone stays reviewable and revertible — ideal for the GSD execute/verify loop.
- For the talents milestone, run Phase 0→4 for ONE class via the prompt, ship/iterate, then re-invoke the prompt's "AFTER THE SLICE" step (or a trimmed copy) to author each remaining class tree.
- To build a future feature this way: write its PRD using the patterns here, then copy a prompt block and swap the GOAL + PRD path.
