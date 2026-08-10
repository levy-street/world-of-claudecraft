# Rogue v0.29 playtest guide: engines, builds, and rotations

Companion to `docs/design/rogue-v029-spec-engines.md` (the engine contracts)
and `docs/design/rogue-v029-class-design.md` (the talent rows). Numbers come
from `scripts/rogue_dps_probe.ts` (123 sec training dummy, level 20, /dev bis
gear, eight-seed average); the fury probe peer reference is 147.2.

Feel pass (owner playtest, 2026-07-23): engine stages now build at the cadence
of the button you press constantly, per the class-directions contract. Venom
Ritual stages come from builder strikes, Redline opens from any 4+ combo
finisher and runs 8 sec (16 cap), Gloam banks every second Red Ribbon, and
Cutthroat Tempo lasts 12 + 4 per combo point (32 sec at 5).

Two-beat pass (owner playtest, 2026-07-23 round two): the Venom Ritual arms
at 6 stages against a five-thrust combo cycle, so the Knifework finisher
alternates Dirt Nap, then Venomrend, instead of the transform being a
permanent state that made Dirt Nap obsolete.

Combo-chain pass, other specs (same session, owner verdict: passive echoes
and refunds read as NOTHING on screen): Redline is now a button chain. The
opening Dirt Nap transforms BOTH buttons for 8 sec: Wicked Slash becomes
Haymaker (2 combo points, each landing adds a pip) and Dirt Nap becomes
Lights Out, which hits 25% harder per pip and ends the window.

Detonation pass (owner review of this guide): the transformed stealth button
is gone. A full Gloam bank simply unlocks the Duskveil openers in the open,
and the next one thrown IS the detonation: the bank empties, the shadow
veil rises around the strike, and a detonating Lurker's Strike is the
doubled one.

Playtest round two (owner): the detonator is now FREE, so no pooling before
it; Grave Brand trims to 12%. Knifework gains its fourth rotational button,
Venom Dart: a ranged poison flick that awards a combo point, banks a ritual
stage (with the uniform 15 energy stage refund), and extends the Venomrend
wound by 6 sec (cap 20), so the wound never expires between detonations;
the wound itself now runs 20 sec.

## Getting set up (offline dev client)

1. `npm run dev`, open the client, Play Offline, create a rogue.
2. `/dev level 20`, pick a spec in `N`, pick the talents below.
3. `/dev bis` outfits best-in-slot epics (dagger mainhand for everyone except
   committed Thuggery). Re-run after switching spec.
4. `/dev spawn forest_wolf 5 20` for targets, `/dev god` while comparing.

## Probe results (best build per spec)

| Spec | Best rows (probe) | DPS |
|---|---|---|
| Knifework (assassination) | Venom Dividend + Second Shadow | 211 |
| Thuggery (combat) | Ceaseless Cuts + Second Shadow | 214 |
| Skulduggery (subtlety) | Dusk Economy + Grave Brand | 223 |

Distinct row-14 economy per spec AND a distinct capstone for Skulduggery
(its opener-heavy veil play keeps the brand rolling), a 5.5% cross-spec
spread, all three well above the fury 147 reference.

## Knifework

Build: Killer's Pace / Borrowed Breath / Marked Prey / Venom Dividend /
Flurry of Knives / Second Shadow. Festering Venom on weapons.

Loop: open from Duskveil with Gut Punch. Every Craven Thrust (or Wicked
Slash fallback) adds a Venom Ritual stage AND refunds 15 energy; Venom Dart
on cooldown does the same at range, plus it extends the Venomrend wound by
6 sec so the next detonation always has something to pop. At 6 stages the
Dirt Nap button becomes Venomrend. Keep Cutthroat Tempo up, build to 5,
press the finisher button as shown: it alternates on its own, Dirt Nap one
cycle, Venomrend the next. Killer's Calm right before the Venomrend beat:
it detonates every bleed, reopens the wound itself (120 over 20 sec, no
Bleed Out upkeep, ever), echoes through Second Shadow, and refunds 20
energy.

## Thuggery

Build: Killer's Pace / Ghostfoot Ward / Marked Prey / Ceaseless Cuts /
Flurry of Knives / Second Shadow.

Loop: Wicked Slash to 5 (every 3rd slash or Haymaker refunds 50 energy),
Cutthroat Tempo, then POOL to 70 energy and Dirt Nap: the window opens and
both buttons transform for 8 sec. Chain Haymakers (2 combo points each,
each landing adds a Redline pip, max 4), then cash out with Lights Out:
25% harder per pip, 25 energy back, and the window ends with it. The clock
is the tension: a window that expires forfeits the Knockout, so cash out at
4 pips or when the timer runs short, whichever comes first. Mirrored Blades
and Flurry inside the window; rebuild, pool, reopen.

## Skulduggery

Build: Shadeslip / Borrowed Breath / Cheap Trick / Dusk Economy /
Flurry of Knives / Grave Brand.

Loop: open from Duskveil with Gut Punch (banks a Gloam stage and applies the
brand), Red Ribbon to build (every 2nd cast banks a stage), Cutthroat Tempo,
Dirt Naps. At 3 Gloam stages your stealth-only openers LIGHT UP in the open,
and the next one is FREE: throw Lurker's Strike right in its face the moment
it lights. That press is the detonation: costs nothing, the bank empties,
the 6 sec shadow veil rises around the strike, and the strike itself hits
for double (the armed bank and the veil both waive the behind requirement).
Spend the window (everything 50% cheaper, +10% damage, openers still work in
the open): Gut Punch, Red Ribbon, Dirt Nap. Only true-stealth openers bank
Gloam; veil-window openers do not (anti-snowball guard), but every opener
refreshes the 12% Grave Brand.

## What to feel for

- Stages visibly climb every press or two; a payoff arrives every build
  cycle, not once a minute.
- Cutthroat Tempo upkeep is roughly one refresh per payoff, not a chore.
- The button transforms (Dirt Nap to Venomrend, and the Redline pair) read
  at a glance; Skulduggery has none, its signal is the openers lighting up.
- Each spec has a heartbeat, not a steady state: Knifework alternates dump
  and DETONATE, Thuggery opens a window, chains Haymakers, and cashes out
  one Knockout, Skulduggery banks toward one doubled strike from the
  shadows.
