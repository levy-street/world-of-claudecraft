# Handoff: merge #2428 (paladin) into integration/v031-class-overhauls

Written 2026-07-26. Read `docs/integration-v031-class-overhauls.md` (the runbook) first: it
owns the merge order, the per-file-class resolution recipes, the credit rules and the refresh
loop. This file is only what the NEXT task needs that the runbook does not already say.

## State

| Thing | Value |
|---|---|
| Integration branch | `integration/v031-class-overhauls` @ `3d005408a` (pushed) |
| Worktree | `../wt-v031-classes`, clean, `rerere` on, `npm ci` done |
| Contains | `release/v0.31.0` (`6cb671cba`) + runbook + #2218 merged `--no-ff` |
| #2218 catch-up branch | `catchup/pr-2218-v031` @ `86175d7ba`, already pushed to `ryan-foo:integration/v029-owned-classes` |
| #2428 head | `refs/remotes/pr/2428` @ `d4063ab35` |
| Rogue commit for #2328 | `f2fb3e378` (one commit, @patrick261) |
| Backups | `../pr-backups/20260726/` + `refs/backup/pr-{2218,2428,2328}-20260726` |

`refs/remotes/pr/2218` is STALE at `31a71ce5c`; the real head is the catch-up merge that was
pushed after it. **Re-fetch every PR head before doing anything**, because all three PRs are
live and #2218's author already pushed twice mid-session:

```
cd ../wt-v031-classes
git fetch origin 'refs/pull/2218/head:refs/remotes/pr/2218' \
  'refs/pull/2428/head:refs/remotes/pr/2428' 'refs/pull/2328/head:refs/remotes/pr/2328' --force
```

## The job

```
git merge --no-ff refs/remotes/pr/2428 \
  -m "merge: PR #2428 Paladin Devotion and Divine Ascension (@blaine1705) into integration/v031-class-overhauls"
```

As pre-flighted at `d4063ab35`: **62 conflicts** = 26 generated i18n (regenerate, never hand
merge), 1 parity golden (re-mint), 35 needing hands. Of 87 hunks in those 35 files,
`scripts/conflict_classify.py` classified **49 pure-additive** (both sides only add lines at
the same anchor, so a line union preserves behavior) and **38 needing judgment**:

```
python3 scripts/conflict_classify.py <conflicted files>
```

Judgment hunks by file, worst first:

| File | judgment / total hunks |
|---|---|
| `src/sim/combat/effect_dispatch.ts` | 7 / 12 |
| `src/sim/combat/casting_lifecycle.ts` | 6 / 8 |
| `server/snapshot_timer_wire.ts` | 3 / 3 |
| `tests/talent_retained_semantics_v026.test.ts` | 3 / 3 |
| `src/sim/combat/auras.ts` | 2 / 3 |
| `src/sim/combat/empower_next.ts` | 2 / 2 |
| `src/ui/hud/action_bar/action_bar_view.ts` | 2 / 5 |
| `tests/action_bar_view.test.ts` | 2 / 5 |
| `src/sim/types.ts` | 1 / 3 |
| `src/render/characters/visual.ts` | 1 / 7 |
| `src/sim/combat/heal.ts` | 1 / 2 |
| 1-hunk files | `CREDITS.md`, `src/ui/auras_painter.ts`, `src/ui/class_details_data.ts`, `src/ui/icons.ts`, `tests/combat_auto_attack.test.ts`, `tests/flametongue.test.ts`, `tests/spec_baselines.test.ts`, `tests/talent_buffpct_fixes.test.ts` |

Fully auto-unionable (0 judgment hunks): `src/render/character_effects.ts`,
`src/render/renderer.ts`, `src/sim/combat/damage.ts`, `src/sim/combat/thorns_charge.ts`,
`src/sim/content/classes.ts`, `src/sim/player_motion.ts`, `src/sim/projectile_travel.ts`,
`src/sim/sim_context.ts`, `src/sim/sim.ts`, `src/styles/tokens.css`, `src/ui/auras_view.ts`,
`tests/ability_tooltip_consistency.test.ts`, `tests/aura_effect.test.ts`,
`tests/character_effects.test.ts`, `tests/skill_icons.test.ts`,
`tests/talent_tooltip_accuracy.test.ts`.

### Traps, each one already paid for once

1. **Do not blind-union a grouped list.** `src/ui/icons.ts` is a flat array of ability ids under
   per-class comment headers. #2428 inserts 6 paladin ids where #2218 reworded the hunter
   header, so a naive union files paladin ids under the hunter comment. Behavior is fine,
   the file becomes a lie.
2. **`tsc` catches what git does not.** On the #2218 catch-up, `tests/talent_buffpct_fixes.test.ts`
   auto-merged with NO conflict into a broken state (one side added a `rowMods` helper the
   other side's copy predated). Always run `npx tsc --noEmit` after resolving, before tests.
3. **TypeScript does not error on a duplicated union member.** After unioning `AuraKind` /
   `AbilityEffect` additions in `src/sim/types.ts`, grep for duplicates by hand.
4. **The Eastbrook provenance pin will fire**, because it hashes whole-file
   `src/render/renderer.ts` and #2428 touches it. Do not re-shoot captures:
   ```
   node scripts/assets/eastbrook_grand_armoury/rerecord_polish_provenance.mjs --check   # verify
   node scripts/assets/eastbrook_grand_armoury/rerecord_polish_provenance.mjs           # record
   ```
   First confirm renderer.ts is the ONLY fingerprinted input that moved (the script's header
   has the exact `git diff --stat` command). If anything else moved, or the renderer delta
   touches town rendering, the captures are genuinely stale and must be re-shot instead. Paste
   the two literals the script prints into the two test files it names.
5. **New combat fixtures use `scripts/probe_anchor.ts`.** The v0.31 spawn is walled in and
   sight-gates ranged and pet abilities silently. If a paladin fixture places targets relative
   to the raw spawn, its numbers are fiction. Full explanation in the runbook.
6. **Format only the files you touched** (`npx @biomejs/biome check --write <file>`). A
   whole-repo write reformats a monolith and drags pre-existing em dashes onto added lines,
   which then fails the copy scan.

### Verify

```
npm run i18n:gen && npm run wiki:content
UPDATE_PARITY=1 npx vitest run tests/parity      # then REVIEW the re-mint as a behavior change
npx tsc --noEmit
npx vitest run --maxWorkers=4 --reporter=dot > /tmp/suite.log 2>&1; echo "exit=$?"
```

Never pipe the suite through `tail`: it masks the exit code (that happened here and hid 17
failures for a whole run). Redirect to a file and grep.

Parity expectation: on the #2218 catch-up, 48 of 58 goldens stayed byte-identical to
`release/v0.31.0`, with every non-owned class (`solo_mage`, `solo_rogue`, `solo_warrior`,
`warlock_pet`, `paladin_consecration`) untouched. After the paladin merge, `paladin_consecration`
SHOULD move and the other classes' scenarios should not. Anything else moving is cross-class
leakage and wants explaining before it is committed.

### Known-red baseline, so new breakage is distinguishable

These are already red on `3d005408a` and are NOT the paladin merge's fault:

| Tests | Cause | Owner |
|---|---|---|
| `hunter_dps_balance` (2), `owned_class_balance_harness` (1), `hunter_talents` (1) | bands predate the crit/haste halving (#2358) | @ryan-foo |
| `ability_tooltip_consistency` (1), `i18n_completeness` (1) | pre-existing on #2218, pass on release | @ryan-foo |
| `deploy_watchdog` (2) | docker, red on `release/v0.31.0` too | not ours |
| `sfx_studio`, `sfx_conform`, `sfx_gate_preflight`, `deeds_content`, `world_auth_scripts` | flake under parallel load, pass in isolation | not ours |

Attribute any new failure the same way it was done here, rather than guessing: run the failing
file on `refs/remotes/pr/2428` and on `origin/release/v0.31.0` before deciding whose it is.

## After the paladin merge

1. **#2328 (rogue).** Reset `feature/rogue-talent-update` (it is on origin) onto the integration
   branch, cherry-pick `f2fb3e378` (cherry-pick preserves @patrick261 as author), force-push,
   comment. Force-push to that branch is approved by the maintainer. Back it out with the
   recipe in `../pr-backups/20260726/MANIFEST.md` if needed.
2. **Cross-class reconciliation** (runbook has the ranked list): the shared choice-row
   framework, the two composed save migrations, `dev_kit_roles.ts` rows for the new specs, and
   an id/key uniqueness guard test.
3. Balance re-probe, PBE deploy, locale fill, `/qa`, then one PR into `release/v0.31.0`.

## Rules that are not negotiable

- **No squash anywhere.** Real merges plus each PR's base being `release/v0.31.0` is the only
  reason GitHub will auto-close #2218, #2428 and #2328 as Merged with author credit.
- **Never force-push over a contributor.** #2218's author pushed twice mid-session; both times
  the answer was to merge forward. The one approved force-push is the #2328 restack.
- **A fix belonging to a class goes to that owner's branch**, not onto this branch. We have push
  rights to all three. Only cross-PR reconciliation is committed here, prefixed `integration:`.
- **Do not change another author's tuning numbers.** The four red hunter balance pins are
  ryan-foo's call; they were reported with absolute DPS and left red on purpose.

## Open questions for the maintainer

1. Wait on @ryan-foo to retune the four hunter pins, or retune and hand them the diff?
2. Notify @blaine1705 and @patrick261 that the integration branch exists and #2218 lands first?
   Neither has been told, and patrick261's branch is about to be force-pushed.
3. File the walled-in spawn as its own issue against `release/v0.31.0`? A fresh character
   currently cannot land a 30-yard spell near the starting area. Arguably correct for a town,
   but it is live and nobody has decided.
