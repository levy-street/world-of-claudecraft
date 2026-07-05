# 00 — QA brief template (paired with every implementation session)

Each rename session `S` is followed by a QA session that runs as a SEPARATE agent. Paste this
template, replace `{S}` (the slice ID: G0/G1/V1/V2/C1/C2/W1/W2/T1/Z1) and `{TITLE}`, and pull the
session-specific checks from the impl brief's "QA HANDOFF" section. (If you prefer one file per QA
session, copy this to `{S}-qa.md` and fill it in.)

---

```
This is QA for SESSION {S}: Verify "{TITLE}".
Model: Opus 4.8, xhigh effort. Harness: Claude Code. Branch: feature/ip-pivot (or the track
branch this slice ran on — confirm with git branch --show-current).
READ FIRST: README.md and 00-SHARED-CONVENTIONS.md and the LOCKED NAME-MAP.md in this folder, and
the impl brief {S}. Do not re-derive the two English source layers, the regen sequence, the six
gates, or the prime directive — they live there.

ULTRACODE: if the impl brief was flagged ULTRACODE (G1/C1/C2), run this QA as an adversarial-verify
workflow (each id-freeze and behavior-unchanged claim independently refuted by a skeptic agent
before it counts).

GOAL: Prove the {S} change was a CLEAN DISPLAY RENAME with every id FROZEN (the ONE exception: the
C1/C2 coined-id sweep) and every existing tests/parity golden BYTE-IDENTICAL. The prime directive
is RENAME DISPLAY, FREEZE IDS: the slice changed player-visible name strings and nothing else — no
sim state, no save format, no wire field, no RL action slot. Your job is to prove it, by showing
the gates stay green and the NAME-MAP was applied verbatim.

STEP 0 — PRE-FLIGHT
- git status clean (the impl session should be committed). If dirty, ask.
- npm ci if node_modules is missing (worktrees shift; confirm with git worktree list).
- Confirm branch is feature/ip-pivot or the track branch, forked off release/v0.18.0.

STEP 1 — LOAD CONTEXT (never read classes.ts / talents_classic.ts / sim.ts whole)
Spawn ONE Explore agent to summarize: the impl brief {S} (what was promised + its QA HANDOFF
items), the git diff for this session, and the exact ids/names touched. Return: the deliverable
list, every changed file, every NAME-MAP row this slice was supposed to apply, whether BOTH English
copies match (sim record .name vs i18n.catalog English) for abilities/items, which generated
artifacts were regenerated (i18n.resolved.generated/*, i18n.resolved.sha256, guide/content.generated.ts),
and — for C1/C2 only — every id key the coined-id sweep changed and every call site that keys off it.

STEP 2 — AUDIT (spawn parallel review agents; prompt each for COVERAGE not filtering)

Gate agent (the core check — the gates are the "set in stone" layer):
- Parity goldens UNCHANGED: `npx vitest run tests/parity` green with EVERY existing golden
  byte-identical. A modified existing golden = behavior or id drift = FAIL. (C1/C2 EXCEPTION ONLY:
  a golden may change by EXACTLY the renamed coined-id token; diff the golden and confirm nothing
  moved but that token. Any other delta FAILS.)
- i18n resolved-equivalence: `npx vitest run tests/i18n_resolved_equivalence.test.ts` green,
  confirming `npm run i18n:hash -- --write` was re-run after the English edit. The duplicated
  ability/item English (sim record vs catalog) must be byte-identical or resolution diverges.
- IP scanner: `npx vitest run tests/ip_scrub.test.ts` green for THIS slice's denylist entries
  (the worklist rows {S} owns in 02-WORKING-MEMORY). The slice must never ADD a flagged name, and
  must never loosen or `.skip` the scanner to pass.
- Guide freshness: `npx vitest run tests/guide.test.ts` green (confirms `npm run wiki:content`
  ran and content.generated.ts is fresh).
- tsc conformance: `npx tsc --noEmit` green (first-class for C1/C2, the only thing proving the
  renamed ids stay typed across every call site).

Rename-correctness agent (the NAME-MAP is the contract):
- Every NAME-MAP row for this slice applied VERBATIM: no off-map name, no name skipped, no name
  invented. Cross the diff against the map row-by-row.
- Ids FROZEN: grep the diff for any id-key change; ANY id change outside the C1/C2 coined-id allow
  (family murloc/kobold, the 7 warlock pet ids) is a FAIL — that would be a save/wire migration.
- Abilities/items: the sim `.name` and the catalog English are BYTE-IDENTICAL (both copies edited).
- Talents (V2): each talent name EQUALS its paired ability's NEW name or carries an explicit
  per-locale title override; `npx vitest run tests/talents.test.ts` green.
- Descriptions/prose: any WoW name embedded in a description or quest string was reworded too
  (the scanner reads description fields; a renamed ability whose tooltip still says the old name
  reds ip_scrub).

S3 agent (W2 and C1 only):
- Every moved player-facing emit literal (W2 mob mechanic/aura `name`; C1 quest prose) updated its
  `src/ui/sim_i18n.ts` matcher (AURA_NAME_KEY / EXACT / RULE) in the SAME commit as the literal edit.
- `npx vitest run tests/localization_fixes.test.ts` (the S3 guard) green.

Targeted reviewers (spawn ONLY if the diff touches their surface):
- cross-platform-sync — C1/C2: the coined-id sweep must land the SAME renamed token in every place
  the id lives (src/sim/types.ts MobFamily, sim.ts, render/characters/manifest.ts, content family:
  fields, entity_i18n.ts / entity lists). A half-swept id (renamed in content but not in the render
  manifest, or vice versa) is a FAIL.
- migration-safety — C2 ONLY, and only if a warlock pet id is persisted in CharacterState
  (server/db.ts JSONB): if it is, the id must NOT be renamed (keep id, display-only). Confirm the
  impl brief's persistence check was done before any pet id changed.
- architecture — C1: the coined-id sweep edits src/sim/types.ts + src/sim/sim.ts; confirm they stay
  sim-pure (`npx vitest run tests/architecture.test.ts` green).

STEP 3 — FIX: apply BLOCKING + SHOULD-FIX. Re-run the validation subset from 00-SHARED-CONVENTIONS.md
that your change touched (parity + i18n_resolved_equivalence + ip_scrub + guide + tsc always; add
talents for V2; add localization_fixes for W2/C1; add architecture for C1). If a fix re-edits an
English name, re-run `i18n:gen` + `i18n:hash -- --write` + `wiki:content` before committing. Commit
fixes separately, explicit paths, green-only (never a half-renamed catalog or an un-regenerated
artifact).

STEP 4 — VERDICT: PASS / PASS-WITH-FOLLOWUPS / FAIL, with counts of issues found and fixed,
deferred items, the scanner-worklist entries this slice cleared (to tick in 02-WORKING-MEMORY),
any generated-artifact touch to log there, and a one-line handoff to the next session (for V1->V2,
confirm the applied ability names the map pairs the talents to).

STOPPING RULE: stop and surface to the operator if a gate cannot be made green without (a) changing
an existing tests/parity golden any way OTHER than a C1/C2 coined-id token swap, (b) editing a
src/ui/i18n.locales/<lang>.ts overlay, or (c) inventing a name not on the LOCKED NAME-MAP. Any of
the three means it was NOT a clean display rename — an id drifted, behavior moved, or the contract
was broken.
```
