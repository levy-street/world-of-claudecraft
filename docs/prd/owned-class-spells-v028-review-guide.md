# Hunter, Shaman, and Priest design review guide

**Target:** v0.29.0 PBE work after PR #2163

**Status:** Approved design companion and PBE review guide

**Gameplay approval:** Recorded for all three class slices

## Why this review exists

PR #2163 restores the immediate class power floor. This proposal is the next layer: distinct,
spec-owned rotations and Talents 2.0 choices for the three classes owned by Ryze. The aim is to make
each specialization feel deliberate without creating a large mobile action bar or one sweeping
gameplay PR.

The standalone Talents 2.0 class design lab (`prototypes/talents-v028/`) let reviewers switch
between all nine specializations, step through their proposed loops, inspect shared and exclusive
actions, and build one choice from each talent row. It was a design-phase artifact, removed from
the tree when the overhauls landed (review 3050); retrieve it from git history if needed. The
linked PRDs remain the source of truth.

## The nine identities

| Class | Specialization | Proposed identity |
| --- | --- | --- |
| Hunter | Packlord | Command the primary beast, build visible Ferocity, then unleash its clap and cleave. |
| Hunter | Coldsight | Create safe firing windows, hold ground for Long Draw, and move before pressure closes in. |
| Hunter | Fieldcraft | Enter melee with Bloodhook, layer bleeds, and use traps and explosives to control the hunt. |
| Shaman | Thundercall | Build Thunder through reliable casts, then spend it on a chosen elemental payoff. |
| Shaman | Warspirit | Cycle melee strikes into Galeheart procs, or adopt Stonebound as an explicit off-tank posture. |
| Shaman | Spiritmend | Grow visible Mending Currents on allies, enlarge them instantly, then consume them with Cascading Mend. |
| Priest | Doctrine | Deal damage to produce clean marked-ally healing while shields stabilize incoming pressure. |
| Priest | Benison | Deliver large group healing and place visible angelic protection over selected allies. |
| Priest | Vespers | Bind enemies through an Effigy, spread ritual pressure, and spend Gloomtithe on an autonomous spirit. |

## Decisions requested from reviewers

- Approve or revise each specialization's identity and baseline loop.
- Confirm which actions are class-wide and which must be specialization-exclusive.
- Check that the six row jobs create real choices: movement, defense, control, amplification, major
  power, and capstone.
- Flag talents that add an unnecessary button or depend on precise ground targeting.
- Confirm that Fieldcraft is sufficiently melee-led, Warspirit's off-tank posture is explicit, and
  Doctrine healing-through-damage stays readable.

Final coefficients, proc rates, animation work, and encounter-by-encounter balance are not approval
targets for this design review. Those belong to implementation tests and PBE tuning.

## Delivery sequence

1. **Design companion:** these PRDs and the standalone review prototype, with no gameplay changes.
2. **Shared specialization infrastructure:** action replacement, wrong-spec cleanup, persistence, and
   hotbar rules behind existing seams.
3. **Hunter slice:** Packlord, Coldsight, and Fieldcraft mechanics with fail-first tests.
4. **Shaman slice:** Thundercall, Warspirit, and Spiritmend mechanics with fail-first tests.
5. **Priest slice:** Doctrine, Benison, and Vespers mechanics with fail-first tests.
6. **PBE balance pass:** shared targets, coefficients, proc frequency, survivability, and encounter
   validation across all nine specializations.

Each gameplay slice stays current with `release/v0.29.0` and goes through its assigned PBE wave.
The implementation drafts share several infrastructure files, so their final changes are reconciled
once on a clean integration branch rather than merged independently.

## Source documents

- [Hunter class design](../design/hunter-v028-class-design.md)
- [Shaman class design](../design/shaman-v028-class-design.md)
- [Priest class design](../design/priest-v028-class-design.md)
- [Shadow ritual design](../design/priest-shadow-voodoo.md)
- [Implementation and test plan](owned-class-spells-v028-implementation.md)
