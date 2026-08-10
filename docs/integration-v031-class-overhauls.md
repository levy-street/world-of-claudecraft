# Integration: the v0.31.0 class-overhaul wave

`integration/v031-class-overhauls` collects four class overhauls from three ongoing
contributor PRs into one PBE candidate, then lands as a single PR into
`release/v0.31.0`.

| PR | Owner | Scope | Head branch |
|---|---|---|---|
| #2218 | @ryan-foo | Hunter (Packlord, Coldsight, Fieldcraft), Shaman (Thundercall, Warspirit, Spiritmend), Priest (Doctrine, Benison, Vespers) | `ryan-foo:integration/v029-owned-classes` |
| #2428 | @blaine1705 | Paladin (Sunmender, Faithwarden, Dawnreaver), Devotion and Divine Ascension | `Blaine1705:feature/paladin-sun-cleric-overhaul` |
| #2328 | @patrick261 | Rogue (Knifework, Thuggery, Skulduggery) | `levy-street:feature/rogue-talent-update` |

All three are still receiving commits. Everything below is built to be run again.

## The two hard rules

1. **Never squash, anywhere in this chain.** Every PR keeps its own commits with their
   own authors, the integration branch merges heads with `--no-ff`, and the final landing
   into `release/v0.31.0` is a real merge commit. Because each PR's base is
   `release/v0.31.0` and each head commit becomes reachable from it, GitHub auto-closes
   #2218, #2428 and #2328 as Merged with full credit to their owners. A squash anywhere
   breaks that (it did on #2336, which then needed a manual tree-hash close-out).
2. **A fix that belongs to a class goes to that owner's branch, not here.** We have push
   access to all three. Only genuine cross-PR reconciliation is committed on this branch,
   prefixed `integration:`. Otherwise the integration branch quietly absorbs authorship
   that belongs to the contributors.

## Setup

Work in a worktree, never the main checkout. `rerere` is mandatory: the same conflicts
resolve many times as new commits land upstream.

```
git worktree add ../wt-v031-classes integration/v031-class-overhauls
cd ../wt-v031-classes
git config rerere.enabled true
git config rerere.autoupdate true
npm ci                      # a real install; symlinked node_modules breaks the Svelte admin tests
```

Backups of all three pre-integration heads (local refs plus range bundles plus PR
metadata) live in `../pr-backups/20260726/`. See its `MANIFEST.md` to restore a branch
after a force-push.

## Merge order

1. **#2218 first.** Largest surface, #2328 stacks on it, and its release catch-up is the
   long pole.
2. **#2428 second**, resolving against a stable union.
3. **#2328 last**, restacked onto this branch (it was authored on a stale #2218 snapshot).

## Resolution recipes, by file class

Do not hand-merge anything that a generator owns.

| Files | How to resolve |
|---|---|
| `src/ui/i18n.resolved.generated/*`, `translation_keys.generated.ts`, `pending.ts` | `npm run i18n:gen`. Regenerate before trusting `pending.ts`: a committed one reads zero while stale. |
| `src/ui/i18n.locales/*.ts` | Hand-authored overlays. Union both sides' keys by hand. |
| `src/guide/content.generated.ts` | `npm run wiki:content` |
| `tests/parity/golden/*.json` | Re-mint with `UPDATE_PARITY=1`, then review the re-mint AS A BEHAVIOR CHANGE. `fiesta`, `pet_ai`, `pet_commands`, `party_raid` and `c5_auto_attack` are shared scenarios; movement there is the cross-class leakage signal. |
| `AGENTS.md` | Take the release side; it tracks `CLAUDE.md`. |
| `src/sim/types.ts` unions (`AuraKind`, `AbilityEffect`) | Keep both sides, then grep for duplicate members. **TypeScript does not error on a duplicated union member**, so `tsc` will not catch this one. |
| Registries and dispatch (`sim.ts`, `sim_context.ts`, `combat/effect_dispatch.ts`, `combat/auras.ts`, `combat/talent_procs.ts`) | Additive on both sides. Keep both, preserve alphabetical or grouped order where the file has one. |

## Cross-class reconciliation, ranked by risk

No single PR can see any of these.

1. **The shared choice-row framework.** #2218 rewrites `src/sim/content/choice_rows_classic.ts`
   (+439/-552) while #2428 adds paladin rows into the same framework shared with warrior
   and mage. The most likely semantic (not textual) collision in the wave.
2. **Two save migrations composing.** #2218 ships one; #2428 ships
   `PALADIN_LEGACY_ABILITY_IDS`. Both rewrite persisted loadouts and action bars in
   JSONB. They must compose in either order, and a save written by one must survive the
   other.
3. **v0.31.0 surfaces the PRs predate.** `src/sim/content/dev_kit_roles.ts` (new, 110
   lines) needs rows for the new specs. `src/sim/combat/tank_crit_immunity.ts` (new)
   interacts with Faithwarden and the Stonebound off-tank profile.
4. **An id and key collision guard.** Global uniqueness of ability, aura, talent and icon
   ids across all classes. Clean at integration start (82 vs 60 new ids, 45 vs 35 new
   catalog keys, zero overlap) but it will not stay clean across weeks of parallel work.
5. **Default level-20 action bars** for every new spec, curated per PR, verified together.

## Balance: the numbers in the PR bodies are stale

Between v0.29.0 and v0.31.0 the release branch landed
`6af9cd4bc fix(balance): halve crit and haste rating strength (#2358)`, the
healers-vs-heroics wave (#2345), two Sanctum retunes (#2378, #2419), the fire mage ignite
fix (#2360) and talent scaling for ground AoE (#2396).

Every DPS figure in #2218 and #2328 was measured on pre-halving ratings and does not
survive the merge. #2428 was authored on v0.31.0, so its numbers hold.

Re-probe on the integrated tree, on ONE harness, and re-measure the peer reference on the
same tree: `scripts/owned_class_balance_probe.ts`, `scripts/rogue_dps_probe.ts`, the
paladin probes. Report absolute DPS at burst and 1, 2 and 5 minutes, never ratios. The
harness runs 20 to 25 percent above live. The rogue seed numbers (211, 214, 223 against a
fury reference of 147) need a real answer before PBE independently of the rating change.

## Gates

```
npm run i18n:gen && npm run wiki:content
UPDATE_PARITY=1 npx vitest run tests/parity     # then review the diff
npx tsc --noEmit
npm run gate                                     # PR tier; this branch is not release/**
npx @biomejs/biome check --write <changed files>  # never a whole-repo --write
```

## The refresh loop, for every round of upstream commits

```
git fetch origin 'refs/pull/2218/head:refs/remotes/pr/2218' --force   # and 2428, 2328
git merge --no-ff refs/remotes/pr/2218        # rerere replays prior resolutions
npm run i18n:gen && npm run wiki:content && UPDATE_PARITY=1 npx vitest run tests/parity
npx tsc --noEmit && npm run gate
```

Merge commit message format, so credit is legible in the log:

```
merge: PR #2218 Hunter/Shaman/Priest v0.29 redesigns (@ryan-foo) into integration/v031-class-overhauls
```

## Landing

1. Locale fill pass. The wave adds 80+ new English keys on top of everything already
   pending, and `release/v0.31.0` runs the release-tier i18n gate on push, which
   hard-fails on any pending row.
2. `/qa`, then the reviewers it names: `architecture-reviewer` (determinism, the
   `SimContext` seam), `cross-platform-sync` (new auras and effects must wire to
   `ClientWorld`), `migration-safety` (the two composed save migrations),
   `test-coverage-auditor`.
3. PBE deploy and an owner playtest round per class. New kits likely need boost-kit rows;
   a `BOOST_KIT_VERSION` bump re-kits the fleet.
4. One PR into `release/v0.31.0`, merged with a real merge commit, with a credits table
   naming each owner and PR.

## Progress log

### 2026-07-26: #2218 landed

`integration/v031-class-overhauls` = `release/v0.31.0` + runbook + **#2218 (@ryan-foo)**.

Backups of all three pre-integration heads: `../pr-backups/20260726/` (local refs, range
bundles, PR metadata, restore recipes).

Done on #2218:

- `release/v0.31.0` merged into `ryan-foo:integration/v029-owned-classes` (it was 173
  commits behind), base retargeted to `release/v0.31.0`, notification posted. Their two
  artwork commits, pushed mid-verification, were merged forward rather than force-pushed.
- 20 catch-up conflicts resolved, then merged here with `--no-ff`.
- **Combat probes anchored out of the rebuilt town** (`scripts/probe_anchor.ts`). This was
  the session's real find: the v0.31 Eastbrook rebuild walled the spawn in, so probes that
  place targets relative to the player were measuring sight-gated rotations. Beast Mastery
  read 43 DPS against its real 68 because the pet reach gate refused Pack Command. Any new
  combat fixture MUST use this anchor, never the raw spawn.
- Eastbrook capture provenance re-recorded (`rerecord_polish_provenance.mjs`). **#2428 and
  #2328 will trip the same pin**, because it hashes whole-file `renderer.ts` and every class
  overhaul touches it. Run the script, verify no other fingerprinted input moved, paste the
  two literals it prints.

Known red on the branch, all attributed by running the same files on `pr/2218` and on
`release/v0.31.0`:

| Tests | Cause | Owner |
|---|---|---|
| hunter_dps_balance (2), owned_class_balance_harness (1), hunter_talents (1) | bands set before the crit/haste halving (#2358) | @ryan-foo, retune |
| ability_tooltip_consistency (1), i18n_completeness (1) | pre-existing on their branch, pass on release | @ryan-foo |
| deploy_watchdog (2) | docker, red on release too | not ours |
| sfx_*, deeds_content, world_auth_scripts | flake under parallel load, pass in isolation | not ours |

## The save-migration rule, for every future class rework

This one cost a live-character bug in the v0.31 wave and will recur, because the trap only
springs when SEVERAL class reworks land together.

`src/sim/talent_save_migration.ts` repairs a saved character: it grants a free row repick and
scrubs ability ids off saved action bars. Revision 2 was written while the hunter redesign was
the only one in flight, so its guard read `cls !== 'hunter'`. Paladin (#2428) and rogue (#2328)
joined the same revision later and nobody widened it, so their saves advanced the revision
marker and were otherwise untouched. Live paladins kept `judgement` on the bar after the
ability stopped existing, and the docstring's promise to scrub the retired rogue grants
(Contingency, Wraith Strike, Shadecloak) was simply false.

Nothing downstream catches it: `talent_loadouts.repairBar` only checks that a slot is a
string, so a dead id survives every load.

The split now is:

- **Scrub runs for EVERY class, always.** A slot naming an ability the character cannot use is
  dead whoever owns it. This is the safety net, and it does not depend on anyone maintaining a
  list.
- **Repick and re-seed stay gated** to `REDESIGNED_AT_CURRENT_REVISION`, because refilling
  empty slots would disturb a bar an untouched player deliberately left gapped.

**When you rework a class:** bump `CURRENT_CHARACTER_CONTENT_REVISION` and rewrite
`REDESIGNED_AT_CURRENT_REVISION` to the classes redesigned at the NEW revision. It is
per-revision, not cumulative. If your rework joins a revision someone else opened, ADD YOUR
CLASS to the existing set rather than assuming the marker bump covers you.

Verify it the way it is verified now, by running a real save through rather than reading the
code: `tests/talent_save_migration_v026.test.ts` puts a retired id on a revision-1 bar per
class and asserts it is gone, and asserts an untouched class keeps its gaps.

### 2026-07-28: the full-branch main catch-up

`origin/main` (v0.31.0 final, the 225 release-final commits) pulled through the whole
chain, owner branches first, then re-merged here in runbook order:

- **#2218**: `origin/main` merged into `ryan-foo:integration/v029-owned-classes`
  (d6b4f881c) and pushed. Their new balance commits (raid-target tunes, restored
  v0.31 bands) came back with it. Known red left for the owner, posted on the PR:
  3 owned_class_balance_harness band checks (Fieldcraft 187.8 over the 1.2x
  Coldsight cap 182.6; Vespers 167.1 over the 1.15x Thundercall cap 165.3;
  Warspirit/Vespers boss ratio 1.103 vs 1.10), caused by main's final combat wave
  (shield block outcomes, parkour collision), 1 to 3 percent each.
- **#2428**: `origin/main` merged into `Blaine1705:feature/paladin-sun-cleric-overhaul`
  (66c883a52 + 2 reconciliation commits) and pushed. The block-contract collision
  resolved in the overhaul's favor: paladin blocking stands (warriorMeleeDefense,
  entity.ts eligibility), composed with main's block outcome kind; blocked swings
  now report kind block everywhere. Main's legacy Hallowed Wall armor fix
  (12393c4bb) is superseded by the redesigned holy_shield and its wire test was
  removed with the legacy kit.
- **#2328**: caught up by merging the UPDATED #2218 head (0a79ca399), NOT restacked:
  f2fb3e378 is already merged here, so a rewrite would break the auto-close credit
  chain. Only generated i18n conflicted.
- **Here**: main merged (bd0ebc19e), then all three updated heads re-merged --no-ff.
  Overlay locale conflicts resolved as entry-level unions (both fills survive,
  same-key collisions took main's release fill). The #2218 rewording of chain_heal
  and desperate_prayer invalidated 15 Latin-script fills; re-translated fresh
  (d8c850c70), pending=0 again. Eastbrook polish provenance re-recorded per tree
  (the pins differ per branch; each merge re-records on ITS merged tree). Parity
  re-mints stayed confined to owned-class and paladin scenarios; the shared
  leakage scenarios (fiesta, pet_ai, pet_commands, party_raid) did not move.

### 2026-07-28: full-suite state after the catch-up

12 reds at the start of the pass, 8 after reconciliation. The 4 fixed here: the
non-warrior parry test (block window zeroed, owner branch), the legacy
holy_shield_armor suite (removed as superseded, owner branch), the hud_update_drive
registry (both new per-frame calls registered, integration), the es_ES and fr_CA
no-op dialect rows (removed, integration), and the retribution Ascension pacing pin
(re-pinned 48.35 to 46.85, band intact, owner branch).

Known red on the branch, attributed:

| Tests | Cause | Owner |
|---|---|---|
| owned_class_balance_harness (3), owned_class_raid_balance_harness (1) | main's final combat wave moved Fieldcraft and Vespers 1 to 3 percent over their cross-spec bands | @ryan-foo, retune |
| paladin_veilbound_march (2) | main's parkour kernel shifted the march end position and pull geometry; mechanic guards intact, tests need re-anchoring | @blaine1705 |
| deploy_watchdog (2) | docker, red on release too | not ours |

### 2026-07-28: #2568 (druid) landed

`integration/v031-class-overhauls` now carries all FOUR class overhauls. #2568
(@patrick261) merged with 68 conflicts: the recurring sim-core hunk sites composed
druid engine hooks with the paladin block branch and rogue engine calls; the save
migration recomposed into a STEPWISE per-revision model (revision 2 wave set +
revision 3 druid with rows-wipe, universal scrub preserved: the druid rows kept
their ids while changing meaning, so the repick must wipe surviving picks); the
band-test widenings from the PR landed via a SILENT auto-merge (the file was not
in the conflict list; the earlier claim that the bands stayed unwidened was
wrong), and the review still asks for them to be re-authored; the hud_update_drive
registry deduped to the chrome-classified rows. Two fixes pushed to the owner
branch (a864196a3): the engine-bank stacks wire gap (stacks now always sent for
isPersistentEngineAura ids; decode cannot tell absent-because-1 from
absent-because-0) and the marrowbreak_guard matcher entry. Latin-script fill of
the 16 druid keys landed (pending=0). Full suite: 4 red, all known (2 docker
watchdog, 2 veilbound march geometry for @blaine1705); NOTE the four upstream
balance bands PASS again on the integrated tree, most likely via the druid
commit's applyTalentMods-on-transforms change, flagged in review for a
deliberate decision and pin.

### 2026-07-29: release/v0.31.0 post-ship catch-up (in-combat Spirit mp5)

The landing target moved: release/v0.31.0 gained two post-ship commits main does
not have (67937a9ac profiler harness fix, e343eae7d in-combat Spirit mana regen,
the mp5 community port). Merged here (9149058ea): the release's mp5-aware
difference-based innervate test rewrites composed with the druid re-theme's row
id (dru_r17_survival_of_the_fittest grants Lifesap now), caster goldens
re-minted, the manaRegenCombat key filled (pending=0). NEW KNOWN RED, ryan's
contract, mp5-caused: warspiritBoss/vespersBoss 1.182 vs the (widened) 1.15 cap,
and raid warspirit 176.0 vs the 173.7 cap (1.08x vespers). All four owner
branches went CONFLICTING against the base from these two commits; each gets the
same catch-up merge.

### Next: #2428 (paladin)

The merge was pre-flighted and aborted rather than rushed. 62 conflicts: 26 generated i18n
(regen), 1 parity golden (re-mint), 35 needing hands. Of 87 hunks in those 35 files,
`scripts/conflict_classify.py` puts **49 as pure additive** (both sides only add at the same
anchor, so a line union is behavior-preserving) and **38 as needing judgment**, concentrated
in `src/sim/combat/effect_dispatch.ts` (7), `casting_lifecycle.ts` (6),
`tests/talent_retained_semantics_v026.test.ts` (3), `server/snapshot_timer_wire.ts` (3) and
`src/render/characters/visual.ts` (1 of 7).

Run the classifier before resolving, and do not blind-union a grouped list: `src/ui/icons.ts`
is the trap, where ids sit under per-class comment headers and a naive union files paladin ids
under the hunter comment.
