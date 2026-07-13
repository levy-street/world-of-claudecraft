# Combat balance simulator (Monte Carlo)

The adversarial layer of the balance framework (see `spell-balance-framework.md`
for the analytical and target-dummy layers). It answers the question the other
two cannot: **which specs and talents actually win fights**, with confidence
intervals, by running thousands of real fights on the real deterministic `Sim`.

```
npm run sim:balance                          # full 27-spec pass, defaults
npx tsx scripts/balance_sim.ts --trials 30   # tighter confidence intervals
npx tsx scripts/balance_sim.ts --specs arms_warrior,frost_mage --knockout
```

Outputs `balance_report.md` (the digest) and `balance_report.json` (every duel
record and the full matchup matrix) under `tmp/balance_sim/`.

## What it runs

- **PvP round robin**: every pair of specs fights repeated duels through the
  real duel system (`src/sim/social/duel.ts`), so the 1 hp guard, PvP crowd
  control diminishing returns, WARFARE gear multipliers, and the five second
  rule all apply because they are the same code.
- **PvE benchmarks**: every spec solo-kills reference mobs (an at-level normal
  and an elite) spawned from the live `MOBS` templates, which fight back
  through the real mob AI.
- **Talent knockout attribution** (`--knockout`): re-runs a spec's duels with
  one talent node removed at a time, same seeds and opponents, and reports the
  winrate each individual talent buys. This is the "which talent is broken"
  number.

## Methodology

- **Real code, no reimplementation.** Fighters are real players built through
  `Sim.addPlayer`, `setPlayerLevel`, `applyTalents`, and `equipItem`; fights
  advance through `Sim.tick()` and metrics come from the `SimEvent` stream.
- **Uniform inputs.** Talent builds are GENERATED per spec by `specBuild`
  (greedy validated fill, spec tree first) rather than hand-authored, gear is
  best-in-slot by per-archetype stat weights (`bestGearFor`), and one shared
  rotation policy drives every spec (`scripts/balance_sim/policy.ts`). Any
  policy bias applies to all specs equally: the RANKING is the signal, the
  absolute winrates are not.
- **Determinism.** One bout = one fresh `Sim` seeded from `mixSeed(baseSeed,
  coordinates)`. Same config, same report, byte for byte; variance comes only
  from sweeping seeds. No wall clock, no `Math.random`.
- **Controlled arena.** Bouts run in a minimal custom `WorldContent` (one zone,
  no camps or npcs) with a flattened terrain stamp, so ticks are cheap, no
  wandering mob interferes, and terrain is identical under every seed. The
  world global is swapped via `setActiveWorldContent` and restored after every
  bout (the Sim ctor invariant).
- **Statistics.** Winrates carry Wilson 95% intervals; draws count as half a
  win; the brokenness score is the mean of the PvP winrate z-score and the
  inverted PvE kill-time z-score. Verdict bands sit at 0.75 and 1.5 sigma.

## Reading the report

Start at the brokenness ranking, then confirm a flagged spec in the PvP
standings (is the Wilson LOW bound still above 50%?) and the matchup matrix
(dominant everywhere, or one polarized counter-matchup?). For a flagged spec,
run `--knockout` on it to find which talent carries it, and check the
"top damage sources" column for the ability doing the work.

## Known modeling limits

- The shared policy does not kite, juggle fear, or use stealth openers;
  movement is chase-or-hold. Specs whose real power is movement skill are
  underestimated.
- No consumables, trinkets, or profession items.
- Duels start at a fixed 10 yd gap with resources topped up (rage empty).

## Module map

Everything lives in `scripts/balance_sim/`: `spec_catalog.ts` (the 27 spec
entries: rotations, openers, interrupts, defensives), `builds.ts` (generated
talent builds, knockouts, gearing), `arena.ts` (the minimal world and fighter
factory), `policy.ts` (the shared per-tick driver), `bout.ts` (one duel or PvE
kill per fresh Sim), `stats.ts` (pure statistics), `experiment.ts` (the matrix
runner), `report.ts` (markdown rendering), with the CLI in
`scripts/balance_sim.ts`. Tests pair one-to-one: `tests/balance_sim_*.test.ts`
pin the catalog against the live content tables, the bout determinism, the
statistics, and the end-to-end experiment shape.

## Findings this tool has already produced

- A live crash in `updateAuras` (`src/sim/combat/auras.ts`): a DoT tick that
  fires the duel 1 hp guard bulk-clears the opponent's auras from the array the
  tick loop is iterating. Fixed with the regression test
  `tests/auras_reentrant_removal.test.ts`.
- Duel non-lethality can be violated: a projectile or committed swing already
  in flight when the duel ends can land on the same tick and kill the loser for
  real. The report counts these under "real deaths"; tracked as a follow-up
  (see the duel non-lethal cleanup pins in `tests/duel.test.ts`).
