# Handoff: the five-class integration merge (v0.33.0 base)

Branch: `integration/v031-class-overhauls` at `db6999efe` (pushed, local == origin).
Worktree: `../wt-v031-classes`.

This document is the audit trail for the merge that brought PR #2742 (Warlock)
into the integration branch alongside the four class waves already there, plus
the repair work that followed. It is written to be verified, not trusted: every
claim below names the commit, file, or command that supports it.

## 1. What the branch contains

Six merge commits, in order, all `--no-ff` (never rebase or squash: the branch
preserves GitHub auto-close credit for the source PRs):

| Commit | Merged | Owner | Source PR |
|---|---|---|---|
| `cadc07ce41` | `origin/main` (v0.32.2, v0.32.3, v0.33.0 waves) | | |
| `49356f5ed3` | Hunter / Shaman / Priest v0.29 redesigns | @ryan-foo | #2218 |
| `a9fbcfdbee` | Paladin Devotion and Divine Ascension | @blaine1705 | #2428 |
| `301c8277dc` | Rogue Knifework, Thuggery, Skulduggery | @patrick261 | #2328 |
| `5e1f247994` | Druid Moongrove, Wildfang, Groveheart | @patrick261 | #2568 |
| `1b77173e99` | Warlock three-spec overhaul | @blaine1705 | #2742 |

The five branch-head shas each merge was taken from (these are the baseline
refs used for attribution in section 4):

```
9787b8aed4  #2218 hunter/shaman/priest   fix(priest): keep the Gloomtithe bank until Vespers consumes it
a75fa724f5  #2428 paladin                chore(assets): re-record the Eastbrook polish provenance
1210588e65  #2328 rogue                  merge: the updated #2218 head into feature/rogue-talent-update
a755dd13d6  #2568 druid                  merge: the updated rogue head into feature/druid-talent-update
8aa583b3b7  #2742 warlock                merge: origin/main into feature/warlock-overhaul-v033
```

Note the chain: rogue is built on the updated #2218 head, and druid on the
updated rogue head. Warlock and paladin are independent of that chain. This
matters for attribution: a failure present on `9787b8aed4` will also be present
on `1210588e65` and `a755dd13d6` without those branches having caused it.

Four commits of integration work follow the merges:

```
798526546  test: repair the counted pins and drive registry for the five-class wave
839a3b9f7  test(parity): re-mint goldens for the five-class wave on v0.33.0
0b81a0b39  test(migration): pin the composed revision-4 contract
ca9ac4152  i18n: non-Latin fills for the Warlock player surfaces (M16)
```

Then three repair commits, which are the subject of section 3:

```
1056a25a9  fix(merge): repair four silent clashes the five-class merge left behind
bb7483e3c  fix(merge): restore two more silently overwritten hunks
db6999efe  test(matrix): repoint two nythraxis source pins at the composed script
```

## 2. The composed save migration (`src/sim/talent_save_migration.ts`)

Two branches independently defined content revision 2 with incompatible
meanings: the #2218 class wave meant hunter/shaman/priest/rogue, the warlock
branch meant warlock. The integration branch was already at 3 (druid). The
runbook in `docs/integration-v031-class-overhauls.md` claimed a stepwise
migration model existed; it did not. `REDESIGNED_AT_CURRENT_REVISION` appeared
only in that document, never in source.

Composed to revision 4 with a PER-REVISION (not cumulative) redesign set and a
UNIVERSAL scrub:

```ts
export const CURRENT_CHARACTER_CONTENT_REVISION = 4;
const REDESIGNED_AT_CURRENT_REVISION: ReadonlySet<PlayerClass> = new Set([
  'hunter', 'shaman', 'priest', 'rogue', 'paladin', 'druid', 'warlock',
]);
```

The old gate early-returned for untouched classes, which skipped the scrub.
It now runs `migrateLoadouts` for EVERY class, always: only the free-repick
decision is class-gated. This matters because dead ability ids survive a bar:
`repairBar` in `talent_loadouts.ts` only checks `typeof slot === 'string'`.
Verified stranded ids (paladin only, not four classes as an earlier audit of
mine claimed): `judgement`, `divine_shield`, `holy_wrath`, `cleansing_verdict`,
`aura_surge`.

**Open product decision, flagged not resolved.** The warlock branch's own
contract PRESERVED talent rows across the migration. I overrode it to WIPE
rows, matching the druid precedent, because `wlk_r8_voidfeast` and
`wlk_r8_curse_of_exhaustion` reuse existing ids with changed meanings. That is
a decision about live characters and it is inherited from me, not from the
branch owner. See section 6.

## 3. Eight silent clashes found and repaired

"Silent clash" here means: git merged cleanly, no conflict marker was left, and
`tsc --noEmit` passed, yet one branch's hunk was overwritten by another's. All
eight are behavioral regressions against at least one branch head.

Commit `1056a25a9` (four clashes plus one pre-existing bug):

1. **`src/ui/hud/action_bar/action_bar_view.ts`, `slot.empowered` assigned
   twice.** The warlock block (`reflectionReady || hasEmpoweringAura ||
   afflictionPossessionEmpowers`) landed textually after the
   paladin/shaman/druid block and overwrote it, discarding Tidecall,
   Dawn's Wrath, Solar Reprisal, Radiant Resonance and Ascension empowerment.
   Now one composed union.
2. **Same file, `slot.ariaLabel` assigned twice**, so the Ascension spender
   aria-label was overwritten by the plain slot label. The `ariaKey` ternary is
   now evaluated once, before the single write.
3. **Same file, `destructionProcGlowActive` dropped from the `procGlow`
   union.** The import survived; the call did not. Desolation never lit a Ruin
   spender.
4. **Same file, `payableCost` lost the shaman Flow State discount.** The
   warlock side computed `nextCastCheapMultiplierFromAuras` only; the shaman
   side computed `flowStateDiscountedCost` only. Composed in the sim's own fold
   order (empower-cheap multiplier first, then the shaman shaping), matching
   `casting_lifecycle.ts` around line 859. A discounted slot was dimming as
   unaffordable.
5. **`src/sim/combat/damage.ts`, the generic absorb-soak loop lost its
   `!resolvedHpLoss` guard.** The paladin Debt of Light block landed above it
   and took the guard with it. The Ruinous Brand echo passes an amount that is
   ALREADY an exact landed-HP-loss copy, so it was soaked a second time and
   dealt zero. Verified by diffing every `resolvedHpLoss` occurrence against
   `8aa583b3b7`: the guard set is now identical plus one comment.
6. **`src/sim/combat/effect_dispatch.ts`, the `aoeDamage` arm lost
   `hasAuthoredMeteorImpact`.** Pyre Colossus emitted the generic nova on top
   of its own authored `meteorFall`, two impacts for one instant cast.
7. **`src/sim/content/classes.ts` `scaleEffect`, the `dot` arm scales only
   `total`.** Not strictly a merge clash: this is pre-existing on the druid
   branch, but it is a regression against main's behavior because the retuned
   Bloodrift derives its tick value from `baseTotal + perComboTotal x points`
   and IGNORES `total`. Every damage modifier was inert on it. Both terms now
   scale. `baseDuration`/`perComboDuration` are deliberately NOT scaled: they
   are seconds, not damage.
8. **Duskfire (`shadowburn`) moved from `requiresTargetHpBelow` to
   `executeThreshold`.** The warlock branch's gate used `>=` (strictly below
   20%); main's shared gate uses `>` (at or below). Rather than widen main's
   gate for warrior Execute too, Duskfire now declares the strict field that
   already existed for exactly this case. `ability_requirement_keys.ts` now
   reads BOTH fields, because reading only one silently hid the requirement in
   the UI for every strict-threshold ability.

Commit `bb7483e3c` (two more, found by a different method, see section 5):

9. **`src/sim/combat/casting_lifecycle.ts`, the cooldown gate lost
   `!solarReprisalBypassesCooldown(p, ability.id)`.** The import survived. The
   clause was displaced when the warlock branch's Forbidden Reflection and
   Ossuary Mark bypasses landed in the same condition. Protection Paladin could
   not cast Sunward Disc or Hammer of Grace through a running cooldown at all,
   so the proc was never consumed either.
10. **`src/ui/hud.ts` `ownPet()` lost the sim's own petOf rule.** The warlock
    branch routed it through `primaryOwnedPet` -> `isPrimaryOwnedPetEntity`
    precisely so the Destruction Pyre Colossus would not take over the pet
    frame from the controlled demon. The merge kept only #2218's
    `isControllableOwnedPet`. **Note this one is partly my own earlier error:**
    the merged version had also acquired a blanket `!isNecromancyUndead(e)`
    exclusion that NO branch head carries, which additionally hid the permanent
    graveguard that `tests/pet_bar_core.test.ts` pins as a real pet. Now
    composes the two attributable predicates and drops the invented third.

## 4. Attribution of the remaining 31 red files

Full suite on `db6999efe`: **31 files failed, 2024 passed, 7 skipped (2062);
50 tests failed, 25645 passed, 54 skipped.** Down from 37 files / 69 tests
before the repairs.

Method: check out `origin/main` and each of the five branch-head shas in the
same worktree, run the failing subset against each, diff the results. The
scripts and every captured run are preserved OUTSIDE both repos at
`~/Documents/code/world-of-claudecraft/integration-audit-v031/`
(`baseline.sh`, `baseline2.sh`, `baselines/`, `baselines2/`, `full2.txt` =
the full-suite run on `db6999efe`). Prefer re-deriving over reusing these.

**`origin/main` is clean on every file in the subset (15/15 and 5/5 passed).**
So nothing here is inherited from main.

| Owner | Branch head | Files already red on that head |
|---|---|---|
| @ryan-foo #2218 | `9787b8aed4` | aura_overlay_config, aura_overlay_controller, dev_kit, hunter_dps_balance, owned_class_balance_harness, owned_class_raid_balance_harness, priest_talent_mechanics, rogue_engines, shaman_spiritmend |
| @blaine1705 #2428 | `a75fa724f5` | ability_vfx_core, character_clipmaps, character_far_mesh_skin, ip_scrub ("Holy Shield"), nythraxis_matrix (timeout), paladin_combat_vfx_routing, paladin_devotion_balance, paladin_veilbound_march |
| @blaine1705 #2742 | `8aa583b3b7` | ability_icons, ability_tooltip_consistency, ability_vfx_core, asset_pipeline, deeds_content, defer_launcher_preloads, fireball_travel_visual, glb_texture_compression, ip_scrub ("Ruin", "Drain Life"), nythraxis_matrix, sfx, target_portrait_view, vfx, warlock_pet_vfx |
| @patrick261 #2568 | `a755dd13d6` | druid_balance_probe (plus the whole #2218 set, inherited via the chain) |
| @patrick261 #2328 | `1210588e65` | the #2218 set only, nothing branch-specific |
| environment | | malware_scan (the known `.venv` noise, see the `test-suite-env-pollution` note) |

Two specific cross-checks worth repeating:

- `ip_scrub` fails with DIFFERENT findings per branch: paladin contributes
  "Holy Shield" (1 occurrence), warlock contributes "Ruin" (1) and "Drain Life"
  (3). The integration branch shows the warlock set (4), i.e. the union
  behaviour is as expected and no new denylisted name was introduced by the
  merge.
- `ability_vfx_core` fails on both paladin and warlock heads with disjoint id
  sets. The integration failure lists all nine
  (`judgement`, `cleansing_verdict`, `holy_wrath`, `divine_shield`,
  `aura_surge`, `summon_succubus`, `summon_felhunter`, `summon_felguard`,
  `summon_doomguard`): each branch retired abilities from `classes.ts` without
  removing the corresponding `ABILITY_VFX_SPECS` row, and the union is simply
  both lists.

**Claim to verify: the integration branch introduces zero red files of its
own.** Every one of the 31 is either present on a named branch head or is the
env-only malware_scan. If fable finds a 32nd, or finds one of these 31 passing
on its own branch head, that falsifies the claim and is exactly what I want
caught.

## 5. Method note: how clashes 9 and 10 were found

Test failures had run out. Both remaining clashes were found by scanning the
merged monoliths for **imported-but-never-called symbols**, which is the
signature of this failure mode: the import list unions cleanly (it is a sorted
list of distinct lines) while the call site, being one expression, does not.

Script at `integration-audit-v031/orphan.mjs` (path as in section 4). Run over
`casting_lifecycle.ts`, `effect_dispatch.ts`, `damage.ts`, `sim.ts`,
`renderer.ts`, `hud.ts`, `action_bar_view.ts`, `characters/visual.ts` it
reported exactly four candidates: three false positives in `renderer.ts`
(`isAtSowfield`, `crowdLodScaleSq`, `midAnimCadence`, all present on main and
every branch, the scanner's import-block heuristic mis-slices that file) and
`primaryOwnedPet` in `hud.ts`, which was the real find. The
`solarReprisalBypassesCooldown` case was then found by the same reasoning
applied by hand to the paladin surface.

**Recommend this as a standing post-merge check.** It costs seconds and it
catches the exact class of defect that `tsc` and the test suite both miss.

## 6. Open decisions, NOT resolved by me

### 6a. Cross-branch conflict: in-flight projectiles on a spec change

Two branches shipped opposite rules, each with a passing test:

- `tests/hunter_lifecycle.test.ts` (#2218, `cancelPendingProjectilesFrom` in
  `src/sim/progression/talents.ts`): projectiles from the old spec are
  CANCELLED. The test asserts `target.hp` is unchanged after 100 ticks.
- `tests/affliction.test.ts` (#2742): an in-flight Needle of Fate LANDS after
  leaving the spec. The test asserts `target.hp` decreased, while Affliction
  state (eye, fate threads, doom) is not rebuilt.

These are structurally identical situations with mutually exclusive
expectations. `cancelPendingProjectilesFrom` is present on `9787b8aed4`,
`1210588e65` and `a755dd13d6`; absent on `origin/main`, `a75fa724f5` and
`8aa583b3b7`.

I kept the #2218 rule (three of five branches carry it, and "an old-spec
projectile resolving under new-spec modifiers" is the stronger safety
argument), so `affliction.test.ts` is one of the 50 failing tests. **This needs
an owner decision between @ryan-foo and @blaine1705, not a merge resolution.**

### 6b. Warlock migration contract: preserve rows vs wipe rows

See section 2. I chose wipe. The branch owner chose preserve. This affects live
characters and should be confirmed rather than inherited.

## 7. Tests I rewrote, and why

Four test files pinned content that the overhauls retired. I rewrote them onto
the shipped contract rather than deleting them, but they are other
contributors' tests and deserve a second opinion.

- **`tests/rupture_rip_tooltip.test.ts`** pinned PR #2447's model where both
  bleeds carried a flat `perCombo` term. The rogue and druid overhauls replaced
  it: Bleed Out buys more ticks at a fixed value, Bloodrift buys bigger ticks
  over a fixed window. Rewritten to pin that `$d` renders the full five-point
  spend (96 and 156) and that the data still carries the scaling terms.
- **`tests/combat_effect_dispatch.test.ts`**, four tests, same cause. The
  dispatch-level promise is unchanged and still pinned: a finisher's payload
  rewards the points it consumes, and a damage modifier scales the WHOLE
  payload. The modifier test now checks Bloodrift at BOTH a one-point spend
  (baseTotal-dominated) and a five-point spend (perComboTotal-dominated), so a
  fix to only one term still fails it.
- **`tests/aura_overlay_view.test.ts`**, three tests, referenced talent option
  ids from five classes' PRE-overhaul rows (`hun_r20_rapid_killing`,
  `pal_r11_divine_wisdom`, `sha_r5_concussion`, and others) that no longer
  exist. Rewritten against the current trees. Note the assertions now include
  genuinely empty results for hunter, shaman and paladin, whose rewritten rows
  carry no proc-with-aura option at all: that is asserted rather than skipped,
  so a future overhaul that adds one must update this test.
- **`tests/action_bar_painter.test.ts`**, one test, whose expected write
  sequence was spliced mid-run by the merge. Both branches batch every
  `toggleClass` before every `setAttr`; the merge interleaved
  `data-ascension-cost` between two class toggles. Expectation follows the
  painter.

Plus, in `db6999efe`, two `tests/nythraxis_matrix.test.ts` source-text pins
repointed: `ensureTalents` renamed `canonical` to `allocation` when it grew a
second plan shape, and the seed loop reads `runSeeds` now that Monte Carlo tank
mode draws its own 1..N sample. Behaviour intact, identifiers moved.

**These are source-text pins, which is a known weak spot in this repo** (see
the `post-pipeline-tests-are-source-text-pins` note). A pin that follows a
rename is only correct if the behaviour genuinely survived. I believe it did in
both cases, but this is the kind of claim worth an independent read.

## 8. Green gates

- `npx tsc --noEmit`: clean, exit 0.
- `npm run build`: exit 0, all five entries, 1369 hashed media assets emitted.
- Parity: 193 passing, goldens re-minted in `839a3b9f7` (21 files) because the
  five waves shift the shared rng draw order.
- Biome: changed files only, formatted via
  `npx @biomejs/biome check --write <file>`. Whole-repo biome is intentionally
  red in this repo and was not touched.

Not run: `npm run gate` end to end (it would re-run the same full suite that
section 4 already captures, plus the release-tier i18n gate, which this branch
is not yet subject to).

## 9. Verification brief for the reviewing pass

Ranked by what I would most want falsified:

1. **Re-derive the attribution table in section 4 independently.** This is the
   load-bearing claim of the whole handoff: that the integration branch
   introduces no red of its own. Check out each branch-head sha, run the
   failing subset, and diff. If any of the 31 passes on its own branch head,
   I have mis-attributed a real regression as inherited.
2. **Adversarially re-read the eight clash repairs in section 3**, especially
   the four `action_bar_view.ts` unions. I composed those by reading two
   versions of one expression and merging them by hand. A missing disjunct
   would be invisible: it produces a slot that silently fails to glow, with no
   test and no type error. Compare each union against BOTH parents
   (`1b77173e99^1` and `1b77173e99^2`) term by term.
3. **Check the `damage.ts` absorb guard for over-correction.** I added
   `!resolvedHpLoss` to the generic absorb loop. Confirm that every OTHER
   caller that passes `resolvedHpLoss: true` genuinely wants absorbs skipped,
   not just the Ruinous Brand echo. If some caller relied on the unguarded
   behaviour, I have broken it silently.
4. **Re-run the orphan-import scan** (section 5) across a wider file set than I
   did. I covered eight files. The merge touched far more. Any additional real
   find is a ninth clash.
5. **Second-opinion the four rewritten test files** in section 7. The question
   is not "do they pass" but "do they still pin the behaviour the original
   author cared about, or did I weaken them to fit the new content?"
6. **The `scaleEffect` dot fix**: confirm that scaling `baseTotal` and
   `perComboTotal` but NOT `baseDuration`/`perComboDuration` is right. My
   reasoning is that the duration fields are seconds and Bleed Out is specified
   to buy more ticks at an unchanged value, but a balance owner may disagree.
7. **Anything in section 6** is a decision, not a bug. Do not resolve it in
   code; surface it.

Deliberately not asked for: fixing the 31 attributed failures. Those belong to
their branch owners and fixing them here would take work out of the PRs where
it is reviewable.
