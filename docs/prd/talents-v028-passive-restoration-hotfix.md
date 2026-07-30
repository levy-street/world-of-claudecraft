# v0.28.0 Specialization Power Restoration Hotfix

Status: HOTFIX

Target: `release/v0.28.0`

Release priority: land and release as soon as validation and maintainer review allow.

## Why this is a hotfix

Talents 2.0 kept specialization signatures and masteries, but removed a layer of passive power
from the pre-v0.27 talent builds. Players consequently experienced weaker damage, healing,
defense, cast speed, and resource efficiency even after selecting a specialization.

This change restores that missing power floor now. It is intentionally separate from the larger
class redesign work so developers have time to rebalance the nine classes, refine rotations, and
establish new class fantasies without leaving current characters materially weaker in the
meantime.

This is not the final v0.28 class balance pass. Class-owner changes and cross-class tuning follow
after this restoration is live.

## Scope

- Restore automatic passive packages for 21 specializations across seven classes.
- Apply the complete package as soon as a specialization is selected at level 5.
- Keep current specialization masteries and all six talent choice rows additive.
- Restore flat and percentage stats, global throughput, and ability-specific damage, healing,
  cost, cast-time, cooldown, and buff modifiers.
- Exclude Warrior and Mage entirely. The floor exists to close the gap for the classes weakened
  by the Talents 2.0 transition; Warrior and Mage are already the two strongest classes, so
  restoring their pre-v0.27 passives would widen the gap this hotfix is meant to close. Their
  masteries, signatures, and ability kits are untouched; only the restored baseline is withheld.
- Leave Mage Chronomancy unchanged because its current healer design has no equivalent
  pre-v0.27 healer baseline to restore (subsumed by the Mage exclusion above).
- Do not add talent cards, ranks, tabs, notifications, abilities, buttons, procs, or rotations.

The accepted hotfix tradeoff is stronger early leveling. The old level-20 reference modifiers
apply at full strength from specialization unlock instead of rebuilding the old point-by-point
leveling curve.

## Implementation boundary

The restoration is a spec-gated data table folded into the existing talent modifier resolution.
It does not edit shared spell definitions directly. This matters because abilities can be shared
between specializations: a Fire modifier must apply to Pyromancy without also changing Cryomancy
or Chronomancy.

The existing resolution path means percentage effects automatically scale with learned spell
ranks and equipment. Existing ability tooltips and character-sheet values show the resolved
result, so no separate player-facing restoration system is required.

The table remains separate from mastery and talent choice data. Future class-owner PRs can tune,
replace, or retire individual restoration values without changing saved talent allocations or
rewriting the Talents 2.0 interface.

## Known interactions

Fiesta standardization (`fiestaStandardize` in `src/sim/social/fiesta.ts`) rebuilds every
fighter to `defaultBuild`, which selects the first specialization. Restored classes therefore
enter a bout with their floor applied, and Warrior and Mage enter without one. This is
intentional and consistent with the exclusion: the floor lifts the classes that fell behind, so
withholding it from the two strongest classes is correct in the standardized mode as well, not a
fairness regression. No fiesta-specific override is added.

Stat identity: a spec's restored flat attribute matches the stat it actually scales with
(Intellect for casters and healers, Strength or ranged Attack Power for the martial specs). A
v0.28.x pass corrected the inherited attributes that did not (for example a healer that had
carried Strength, or caster specs that had carried the combat-inert Spirit), keeping the floor's
magnitude while pointing it at a stat the spec can use.

## Source of truth

The values come from the pre-v0.27 level-20 Nythraxis reference allocations at
`6155ad2079906402ce87e64c778b31cd88ef2875`, compared with the v0.28 release baseline at
`571ab021995165098ce691a89b227732bcbb8fae`.

Warrior and Mage are excluded wholesale (see Scope), so their historical modifiers are not
sourced at all. Among the restored classes, old granted abilities and proc effects are excluded,
as is any modifier that targets an ability not available to the affected current specialization;
redirecting those values to replacement abilities would be new class design, not restoration.
Wildfang uses the historical tank allocation and deducts the armor already folded into its
current mastery.

The complete machine-checked 21-spec matrix lives in `tests/spec_baselines.test.ts` beside the
implementation table in `src/sim/content/spec_baselines.ts`.

## Release criteria

1. The 21-spec baseline matrix fails against unmodified `release/v0.28.0`.
2. The same matrix passes with the hotfix.
3. Full restoration is identical at levels 5 and 20.
4. No baseline applies without a selected specialization.
5. Warrior and Mage receive no baseline at any level; Chronomancy remains unchanged.
6. No restoration package contains a grant or proc.
7. Focused talent, specialization, architecture, type, and parity checks pass or any intentional
   parity changes are reviewed and committed separately.

## Patch notes

### Specialization power restoration

Restored passive specialization power lost during the Talents 2.0 transition for 21
specializations.

- The restored bonuses apply automatically when you select a specialization.
- These bonuses are added on top of your specialization mastery and talent choices.
- Restored effects include stats and improvements to relevant spell damage, healing, resource
  costs, cast times, cooldowns, and defenses.
- The bonuses scale naturally with your learned spell ranks and equipment.
- No new abilities or action-bar buttons have been added, and no respec is required.
- The full package applies from specialization unlock, so early-level characters will be stronger
  than before this hotfix.
- Warrior and Mage do not receive a restored floor: they are already the strongest classes, and
  this pass is about lifting the classes that fell behind, not widening the lead.
- Chronomancy is unchanged because its healer kit has no former healer baseline to restore.

This hotfix establishes an immediate power floor for v0.28.0. Further class fantasy, rotation,
and cross-class balance updates will follow through class-owner changes and PBE feedback.
