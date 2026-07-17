# Periodic scaling: dynamic DoT/HoT valuation

Status: living. Records a deliberate design decision made on the dynamic DoT/HoT
change (PR #1722) so it is not re-litigated per review.

## The decision

DoTs and HoTs are valued DYNAMICALLY, per tick, not snapshotted at cast time:

- **Live power.** Each tick recomputes its amount from the caster's CURRENT
  Spell/Attack/Ranged Power. A power buff instantly lifts every active DoT and
  the damage falls back the moment the buff fades, no recast needed. If the
  caster is dead or gone, the tick freezes at the cast-time value.
- **Hasted cadence.** Haste raises the tick RATE (duration is fixed), so a
  hasted DoT or HoT lands more ticks in the same window. A haste-less or mob
  source keeps the base cadence.
- **Player-gated tick crit.** Each tick rolls crit off the caster's live crit
  chance, but only a PLAYER source's periodic can crit. Mob dot affixes (venom,
  soulrot, bleed, frostbite, smolder, cinder, arcaneRot, stackPoison) stay
  non-critting, so the change lands as a talent-balance change, not a PvE
  difficulty bump. The roll is still drawn unconditionally per tick (a mob
  source rolls chance(0)), so the shared rng draw order never forks on source
  kind and determinism holds across hosts.

## Why deviate from the classic snapshot model

This is a deliberate deviation from the classic-era snapshot model (where a DoT
locks in the caster's stats at cast time). Snapshot-only DoT trees cannot keep
pace with direct-damage specs as gear scales: a direct-damage spec re-prices
every cast off current stats, while a snapshot DoT spec only benefits from new
gear or procs on the recast boundary and gets no value from haste on already
running periodics. Dynamic valuation keeps DoT and HoT builds on the same
scaling curve as direct damage without inventing new balance numbers.

## Known limitation: tooltips

Ability tooltips currently show the cast-time snapshot baseline, not the live
per-tick value. This is a known limitation and a follow-up; the sim math is the
source of truth.

## Where it lives

The pure, host-agnostic tick math is `src/sim/combat/periodic_tick.ts`
(tick amount, hasted interval, player-gated crit chance and multiplier),
consumed by the aura tick loop in `src/sim/combat/auras.ts`. Unit coverage:
`tests/periodic_tick.test.ts` (the pure module) and `tests/dynamic_dots.test.ts`
(end-to-end sim behavior). Parity goldens that tick a periodic aura encode the
dynamic behavior; see `tests/parity/`.
