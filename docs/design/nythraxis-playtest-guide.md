# Nythraxis redo: solo playtest guide

How one person tests the whole fight. Everything here is dev-gated
(`/dev` commands need `npm run dev` for the offline client, or a local server
started with `ALLOW_DEV_COMMANDS=1`; never in production).

Adds: none. The owner's 2026-09-04 playtest call switched off Raise Fallen's guard
waves and the heroic court (`NYTHRAXIS_ADDS_ENABLED` in `src/sim/types.ts`); the Bone
Spikes remain, as the impale mechanic rather than adds.

## Two checks

1. **Headless, every mechanic fires.** One command, both difficulties, about
   a minute:

   ```
   npx vitest run tests/nythraxis_full_fight_smoke.test.ts
   ```

   It builds the practice raid, pulls him, walks his health down at a real
   pace, answers the mechanics the way a raid would (shatters spikes, drags
   him onto every other sigil, channels the wards once), and fails if any
   callout, damage ability, aura, phase, or add never showed up.

2. **In game, see it.** The practice raid plus the mechanic pokes below.

## In-game recipe

1. `npm run dev`, load the offline client, level up: `/dev level 20`, gear:
   `/dev bis prot` (or your kit of choice).
2. `/dev nythraxisraid normal` (or `heroic`). You zone into the arena with nine
   anchored, invulnerable bots spread across the hall. They are targets for
   every mechanic that skips the aggro holder (Bone Spike, Soul Rend,
   Gravefire) and for Bone Storm's charges. They never die and never move.
3. `/dev god` so you survive a landed Deathless Rage and an Unbound sigil.
4. Walk up and hit him. Everything runs on its real cadence from here.

### Forcing a mechanic

`/dev nyx <mechanic>` sets that mechanic's timer to the next tick. The
encounter's own rules still apply: a sigil waits out the 6 s major gap, a Rage
waits out a live sigil and live Soul Rend marks, a storm waits out any other
major.

| Command | What you should see |
|---|---|
| `/dev nyx curse` | Dread Curse hits you (you must be in melee reach); at 2 stacks the swap callout |
| `/dev nyx spike` | Two bots (three on heroic) impaled with a spike through them; kill the spikes |
| `/dev nyx eruption` | Warning rings under bots, the burst, then green Grave Flame (never fades on heroic) |
| `/dev nyx sigil` | A blue ring 10 to 24 yd out; drag him onto it inside 15 s (12 s) for Bound, or let it lapse for Unbound |
| `/dev nyx phase2` | Health to 69%: the stomp, Brother Aldric's entrance, the wardstones light |
| `/dev nyx gravefire` | A violet line runs from his feet at a bot (phase 2 and 3 only) |
| `/dev nyx rend` | Three bots (six) marked; red Soulfire pools where they stood (permanent on heroic) |
| `/dev nyx rage` | Deathless Rage cast; then `/dev nyx wards` makes three bots complete the wardstones (interrupt + stun), or wait and eat the 82% (115%) |
| `/dev nyx phase3` | Health to 29%: The King's Wrath once no major is in flight |
| `/dev nyx storm` | Bone Storm: he ignores threat, whirls, charges four bots, slams, spikes mid-storm, then comes back to you |
| `/dev nyx enrage 10` | The Crown Endures in 10 s: the yells, then the enrage buff and its ramp |

`/dev hp <1-100>` with him targeted sets his health directly. `/dev raid reset`
clears your raid lockout. `/dev nythraxisraid heroic` on an existing practice
raid re-forms it at the other difficulty.

### What to look for

- The impaled pose reads as one body skewered on the spike; freeing stands the
  player back up.
- Warning rings, flame patches, the Gravefire strip, and the sigil ring are
  identical on every graphics preset (actionable geometry never sheds).
- The sigil never lands within 6 yd of a wardstone, and on normal never in
  live fire.
- Bone Storm's charges around the pillars: this is the piece most likely to
  need tuning.
- The heroic floor: with permanent fire, watch how much of the hall is burning
  by phase 3 and whether the caps (24 flame patches, 12 pools) feel right.

Balance numbers are placeholders from the plan
(`docs/prd/nythraxis-mechanics-redo.md`, section 5) until this playtest.
