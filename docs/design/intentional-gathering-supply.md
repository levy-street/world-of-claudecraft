# Intentional gathering supply evidence

The checked-in [Markdown report](gathering-supply-report/gathering-supply-report.md)
and [JSON report](gathering-supply-report/gathering-supply-report.json) compare
PR3872 with the intentional-gathering stack. They support retaining current
reward constants while making gathering an explicit action. They are bounded
regression evidence, not a drop-rate study or live-market estimate.

## Reproduce

Both checkouts need their source files and the existing project dependencies.

```sh
node scripts/gathering_supply_report.mjs \
  --repo /path/to/final-checkout \
  --baseline /path/to/pr3872-checkout \
  --out docs/design/gathering-supply-report
```

The baseline is PR3872 head `0f53c92ff738ebebb6add787a61caecdf7e8e884`.
The final checkout includes PR3906 through PR3910, including PR3909's goal tracker.
The JSON records each checked-out commit, dirty state, seed and harness version.
It records the measured code commit, not a later commit adding the report itself.
The local baseline's dirty state comes from planning documents; its source is
unchanged from that baseline commit.

The CLI bundles the same scenario runner against each checkout's own simulation
and nearby-interaction handler, runs a bounded Node subprocess, and writes both
reports. Temporary bundles are removed. No network, database or new dependencies
are needed. Omitting `--baseline` runs the final checkout alone.

## What the checked-in run shows

| Action | Baseline | Final |
|---|---|---|
| F on one lootable wolf, followed by two repeat presses | Ordinary loot plus 1 Rough Hide and 1 Wolf Fang | Ordinary loot, zero gathering materials |
| Explicit All harvest | 1 Rough Hide and 1 Wolf Fang | Same sampled grant, with a 1.5-second cast |
| Explicit hide preference | 2 Rough Hide | Same sampled grant, with a 1.5-second cast; no unwanted family |
| Full bags | Refused; 16 occupied slots remain 16 | Same refusal and slot count |
| Two party members, one corpse | One harvest payout | One harvest payout |
| Walk 15 units toward a corpse and harvest | 1.75 seconds | 3.25 seconds, including the 1.5-second cast |
| Mining / logging / herbalism travel and cast | 4.25 / 4.25 / 5 seconds | Same sampled timing and yield |
| Early recipe's gathered Wolf Fang requirement | 2 units reached | 2 units reached; one 1.5-second harvest cast |
| Late recipe's fine greens requirement, one bed | 2 fine greens after four crop cycles | Same sampled result |

The fixture includes one Rough Hide as ordinary loot. That drop is a separate
ledger from harvest-result events, so a material item id alone does not prove a
gathering grant. For the
ordinary-F scenario, the report's legacy `successfulHarvests` field counts
successful ordinary interactions. Repeat presses on the spent ordinary loot are
unsuccessful interactions; they are not failed gathering attempts.

The late crop example grants 25 normal and 2 fine greens across four sequential
cycles, plus the separately measured early Wolf Fang grant. Those four cycles
represent 42 **bed-hours** of passive growth in this one-bed fixture, with 8 seconds
of planting casts. Multiple beds, travel to the farm, obtaining tools/seeds, and
other recipe reagents are not modeled. This is not a whole-recipe completion time.

The finite premium sample records 31 plain units and 4 signed units. It observed
no specimen, which does not establish a zero specimen rate. Source hints separately
identify all existing specimen opportunities from the real component tables.

## Measurement boundaries

- Corpse fixtures use the real `forest_wolf` template, ordinary loot and harvest
  components. They are pre-created dead bodies; combat and respawn time are excluded.
- F runs each checkout's own `tryNearbyInteraction`, with real simulation commands
  behind its world adapter. It does not substitute `Sim.interact` for the client
  F-key dispatch. The adapter handles the two historical function signatures.
- Deliberate corpse grants come from actual `harvestResult` events, including
  plain/signed/specimen classification. Timed casts collect events returned by
  every `Sim.tick()`; they do not reread the drained event queue afterward.
- Ordinary and focused fixture characters have the default empty town-focus
  allocation. Existing town yield/tier bonuses still execute through the real grant
  code, but specialized town builds are not separately sampled here.
- Tools, seeds and the Field Kit are setup grants. Bag snapshots occur after tool
  setup. Full-bag fixtures use the real capacity and distinct equipment slots.
- Ambient mobs are removed. Only explicitly named travel scenarios use real movement;
  other scenarios place actors at their target. The report labels action samples
  separately from movement/cast timing.
- Mining, logging and herbalism each have a bounded action sample and a live
  movement/cast example. The sample count does not estimate a yield distribution.
- Farming uses the real plant/harvest commands and an injected clock advanced by
  the authored crop duration. Late farming first checks an underqualified character,
  then grants a tier-4 hoe and farming skill 100. Planting casts finish via real
  ticks; fine yield remains random. Denials include actual `farmDenied` reasons.
- Fishing runs real cast/bite/reel logic, advancing to the drawn bite deadline.
  An empty hook is a completed fishing action. These are action samples, not
  end-to-end fishing travel or wall-clock play measurements.
- Recipe rows show every required reagent and distinguish gathered counts from
  acquisition that was not simulated. Ordinary loot, purchases and crafted
  intermediates are not silently counted as supplied.
- The party case proves finite shared supply for one corpse. It does not measure
  combat pace, a large group clearing a camp, or a nearby batch-harvest feature.

## Validation and balance decision

`scripts/lib/gathering_supply_scenarios.ts` validates actual outcomes: F retains
ordinary looting while removing final-tree harvest grants, deliberate and live
harvests succeed, focused gathering excludes unwanted families, full bags grant
nothing, one corpse pays one party member, and each gathering family succeeds.
The recipe scenario must contain an actual farm grant; early corpse success alone
cannot pass it. A failed expectation is preserved in the report and makes the CLI
exit nonzero.

`tests/gathering_supply_measurement.test.ts` covers aggregation, reporting and
negative controls for those outcomes. The parent also runs the real CLI and inspects
its measurements; pure helper tests alone do not verify the fixtures.

No reward or recipe constants change in PR3910. The observed reduction comes from
removing accidental gathering and allowing players to target a material. These
samples provide no reason for a further yield reduction. Whole-game pacing,
specialized town builds, parallel farming, premium frequencies and live economic
effects remain follow-up measurements, rather than conclusions from this fixture.
