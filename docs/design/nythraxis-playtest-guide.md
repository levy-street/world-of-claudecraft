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
| `/dev nyx spike` | Two bots (three on heroic) impaled with a spike through them; hit the spikes. A spike is a ward (v0.42.2): 4 hits on normal, 6 on heroic, from anyone, each hit counting one whatever it deals, and its health bar reads as hits remaining. Cast it again inside 55 s: the same bots are never re-picked (the per-raider cooldown) |
| `/dev nyx eruption` | Purple warning rings under bots, the burst, then purple Grave Flame (12 s normal, 8 s heroic) |
| `/dev nyx sigil` | The sigil flares on one of the two platforms flanking the throne, 30 yd to the raid's left or right of where the boss spawned (alternating each cast, v0.42.2); drag him up onto it |
| `/dev nyx phase2` | Health to 69%: the stomp, Brother Aldric's entrance, the wardstones light |
| `/dev nyx rend` | Three bots (six) marked; the split hit lands when the marks expire and leaves NO fire (Soulfire retired in v0.42.2) |
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
- The heroic floor: Grave Flame burns out on its own (8 s, second playtest
  pass) instead of lasting until the transition; watch whether the floor
  still feels crowded by phase 3, and whether the cap (24 flame patches)
  still matters with a finite burn.
- Soulfire is gone (v0.42.2): a Soul Rend detonation must leave nothing on
  the floor on either difficulty. Any purple pool appearing where marks
  detonated is a regression.
- Bone Spikes are wards (v0.42.2): 4 hits on normal, 6 on heroic, from
  anyone. Watch the spike's health bar count hits, not damage, and check that
  a click anywhere near the spike targets the spike, not the impaled raider.
- Gravefire is gone (v0.42.2): no line ever runs from the boss and the Bone
  Slam leaves no line behind it. Any traveling fire line is a regression.
- The Binding Sigil lands on one of the two flanking platforms, 30 yd to the
  raid's left or right of where the boss spawned, switching sides every cast
  (v0.42.2): the tank should always know which way the drag goes. The
  platforms are real elevation (the crypt's raised dais reused), so bodies
  stand on the blocks and the sigil decal sits on top of them, never under.
- Bone Spikes read ember orange (v0.42.2), the one hue nothing else in the
  hall uses: against the bone-white boss, the grey flagstones, and the purple
  fire a spike should be findable at a glance from across the room, on the
  low graphics tier too (the tint applies on every tier; only the glow is
  standard-tier polish).
- Every offensive effect (warning rings, Grave Flame, Gravefire,
  Bone Storm/Bone Slam) should now read purple on both difficulties; the
  Binding Sigil stays blue and the Soul Rend floor ring/overhead mark stay
  red-alone, green-once-stacked.
- Raw white damage: Normal Nythraxis is tuned to hit for about 90% of Normal
  Ignivar, Herald of the Last Flame's own white swing; Heroic Nythraxis is
  tuned to about 90% of Heroic Varkhul, Forgefather of the Last Flame's white
  swing (the Crucible of the Last Spring's harder second boss), so Nythraxis
  stays the easier raid on each difficulty.

Balance numbers are placeholders from the plan
(`docs/prd/nythraxis-mechanics-redo.md`, section 5, and the tuning log in
section 14) until this playtest.
