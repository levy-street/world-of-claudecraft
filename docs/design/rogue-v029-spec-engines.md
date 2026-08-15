# Rogue v0.29 spec engines: build toward something

Status: landed on `feature/rogue-talent-update` (owner-approved direction
2026-07-22, feel pass and two-beat pass from owner playtests 2026-07-23).
This is the rogue equivalent of the v0.28 class
direction review (`class-directions-v028.pdf`: Hunter/Shaman/Priest): each
specialization gets a readable baseline ENGINE beneath the Talents 2.0 rows
shipped in `docs/design/rogue-v029-class-design.md`. Identity first, tuning
second; final coefficients belong to the probe and PBE.

## Shared backbone

Energy and combo points stay exactly as they are. Each engine changes what a
full five-point finisher BECOMES. All engine state is visible aura stacks on
the player (the authoritative owner, per the hunter Ferocity rationale), draws
no rng, fits the existing compact bar via transform-in-place
(`AbilityDef.actionReplacement`, ported from the PR #2218 infrastructure), and
is cleared on respec, spec change, loadout change, and death.

## Knifework: the prepared kill

Every builder strike (Craven Thrust, or the Wicked Slash fallback) banks one
visible **Venom Ritual** stage (1 to 6, 30 sec) and refunds 15 energy, so the
most expensive builder in the class plays fast. At stage 6 the Dirt Nap
button transforms into **Venomrend**: a full finisher that detonates every
bleed on the target for its remaining damage, then reopens the wound itself
(120 over 20 sec) and refunds 20 energy. Casting it consumes all six stages
(the existing `requiresAuraKind` + `requiresAuraStacks` consumption
machinery). Six stages against a five-thrust combo cycle is deliberate: the
finisher alternates Dirt Nap (five stages banked), then Venomrend (armed on
the next thrust), the two-beat rhythm from the owner playtest. Venomrend is
self-sustaining: the wound it reopens is what the next rend detonates, so
there is no separate bleed upkeep in the loop. **Venom Dart** (owner
playtest round two: the loop wanted a fourth button, and the wound kept
losing the race to the rend cadence) is a ranged poison flick on an 8 sec
cooldown that awards a combo point, banks a ritual stage with the uniform
refund, and extends the wound by 6 sec (cap 20): tending the wound is a
button, not a race.

- Loop: poison up, Craven Thrust to 5 with Venom Dart woven on cooldown,
  Dirt Nap; build to 5 again, Venomrend detonation; repeat.
- Decision: Killer's Calm timing on the rend beat, dart timing against the
  wound clock, and not overcapping energy against the refunds.
- Presentation: 0 to 6 aura pips; the action button swaps icon and name at 6.

## Thuggery: press the advantage

A full-combo Dirt Nap opens the fixed 8 sec **Redline** window, and inside
it BOTH buttons transform (the owner verdict that forced this shape: passive
echoes and refunds read as NOTHING on screen, a combo chain of real buttons
does not). Wicked Slash becomes **Haymaker**: a heavier hit that awards 2
combo points and deepens the run by one pip (max 4). Dirt Nap becomes
**Lights Out**: the cash-out, hitting 25% harder per pip, refunding 25
energy, and ENDING the window when it lands. A window that expires before
the Knockout forfeits it entirely, so the clock is the tension. This is the
Midnight Trickster grammar (finishers set up an empowered Coup de Grace)
adapted to the transform-in-place infrastructure.

- Loop: slash to 5, pool, Dirt Nap opens, chain Haymakers, Knockout,
  rebuild.
- Decision: cash out early and safe, or squeeze one more Haymaker against
  the clock; Mirrored Blades and Flurry of Knives belong inside the window.
- Presentation: one timed aura whose pips climb per Haymaker; two visible
  button transforms bracket the window.

## Skulduggery: the shadow bank

True Duskveil openers (Lurker's Strike, Throat Wire, Gut Punch) bank one
**Gloam** stage each; every second Red Ribbon banks one more (deterministic
counter, never rng). No transformed button (the owner cut it in review): at
3 stages the openers simply UNLOCK in the open, and the next one thrown is
the detonation, FREE of energy cost (owner playtest round two: pooling
before it was dead air). The bank empties, the **Shadow Veil** rises around the
strike for 6 sec (openers usable in the open, 10% more damage, the Dusk
Economy discount), and one **Veiled Edge** doubles the first Lurker's Strike
of the veil, including a detonating one: the haymaker and the window opening
are the same press. Both the armed bank and the veil waive the stealth AND
behind requirements: solo, a fighting mob faces its attacker constantly, and
without the waivers the detonator could never land (owner playtest, pinned
in tests/rogue_engines.test.ts). A true-stealth opener banks instead of
detonating, and openers inside the veil never bank (the anti-snowball guard:
a self-seeding bank compounded to a measured 217 DPS).

- Loop: open from stealth, build the bank mid-fight, pool, then detonate it
  with the doubled strike and spend the window.
- Decision: burn the bank now or hold it armed, and the pooling discipline
  before the detonation.
- Presentation: 0 to 3 aura pips; the openers light up on the bar at 3; the
  veil and its one-charge edge are visible self auras.

## Engine ownership and cleanup contract

- Engines are spec-gated: state only builds and payoffs only resolve while
  the matching spec is selected.
- Respec, spec change, and loadout switch clear all engine auras, counters,
  and transformed buttons at the same recompute choke point that already
  cleans talent proc payoffs.
- The base ability id stays on the hotbar and in saved loadouts; the
  transform is resolve-time only (one choke point: `Sim.resolvedAbility`).

## Rows re-anchor

The shipped six rows stay; the capstones now have an engine to talk to:
Second Shadow echoes Venomrend like any Dirt Nap, Kill Chain's 5 combo
points feed Redline chains while questing, Grave Brand rides the same openers
that bank Gloam. No row grants a second engine (class-design stacking rule).

## Balance target (the rogue buff): MEASURED 2026-07-23

With the engines, feel pass, two-beat pass, and combo-chain pass landed and
`/dev bis` gear, the 123 sec eight-seed probes (`scripts/rogue_dps_probe.ts`)
land at Knifework 210.6 (Venom Dividend + Second Shadow), Thuggery 213.5
(Ceaseless Cuts + Second Shadow), and Skulduggery 222.8 (Dusk Economy +
Grave Brand) sustained DPS (measured on the merged integration branch:
rebasing onto the owned-classes work lifted the dagger specs a few points
because upstream gave Mistcaller's Fang its missing dagger flag, a better
legal BiS pick; every Thuggery row matched pre-rebase to the decimal): a distinct optimal row-14 economy per spec, a
distinct capstone for Skulduggery (opener-heavy veil play keeps the brand
near-permanent), and a 5.5% cross-spec spread (inside the 10 to 15% rule).
Round-two tuning: Venom Dart ships at 30 to 40 (48 to 62 probed knife to
209 on the back of its energy economy, the stage-plus-refund is most of its
value); the free detonator pushed Skulduggery from 197 to 224, pulled back
by trimming Grave Brand from 15% to 12% (trimming Dusk Economy instead
collapsed its margin over Venom Dividend and nearly flipped the sub build,
so the row values stay). The fury probe peer reference on the same machine is 147.2: rogue
leads the measured band per the owner's explicit buff directive; trimming
back toward cross-class parity is a PBE knob (values, never shapes). Tuning
history: Haymaker ships at 130% weapon damage plus 10 (probed at 150 and
140 on the way down); Lights Out ships at 45 plus 35 per combo point
with the 25% per pip multiplier and a 25 energy recovery (the recovery is
what brings window cadence to roughly one per half minute, three windows a
fight probed as too rare a payoff); Dusk Economy probed at 0.55 (215 once
the probe pooled energy into the veil like the guide says, the old greedy
rotation had been under-measuring the veil), 0.4 (169), and ships at 0.5;
the Veiled Edge ships at double (1.0); Venomrend ships at 100 plus 55 per
combo point with a 20 energy refund, sized for landing every other full
finisher; the ritual stage refund ships at 15. Three-seed averages shuffled
the thin knifework row margin, so the probe averages eight seeds and pools
before payoffs.

## Delivery

1. Port `actionReplacement` (done; read-only from PR #2218, that PR
   untouched).
2. Engines behind the SimContext seam (`src/sim/combat/rogue_engines.ts`),
   fail-first tests per stage, transform, consumption, cleanup, and spec
   gating; new ability defs (`venomrend`, `veilstrike`) with full i18n.
3. HUD reads the same resolve choke point so the button visually transforms.
4. Probe extension to BiS gear, then the tuning pass to the band.
5. Parity golden regen where rogue bots change behavior (accounted).
