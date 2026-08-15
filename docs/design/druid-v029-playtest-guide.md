# Druid v0.29 playtest guide

Companion to `druid-v029-class-design.md`. Probe numbers come from
`scripts/druid_balance_probe.ts`: 123 seconds, level 20, fixed PBE gear, and an
eight-seed deterministic average. Moongrove wears an intellect caster set;
Wildfang and Groveheart wear their own fixed sets. The probe uses normal resource
regeneration and does not inject mana, energy, or rage. A pure-zero run at a seed
whose terrain breaks the fixed anchor's line of sight for the distance-18 caster
target is dropped as an anchor artifact, not balance signal.

IMPORTANT gear caveat for Balance. This fixed PBE loadout is a level-20 caster
PROXY: at this tier the item pool caps a druid's spell power near 105. Balance's
damage was re-seated onto spell-power coefficients (below), so it scales with
gear like a caster; on the endgame tree's real searched best-in-slot (spell power
near 150) it lands at the ~200 DPS anchor the Nythraxis cross-spec montecarlo
measures, and the coefficients are calibrated to that anchor. On this low-SP proxy
it therefore reads ~160, not 200. Real-BiS Balance parity is owned by that
montecarlo; the melee arms (Wildfang cat, agility) are not under-geared here, so
the two do not compare directly on the proxy.

## Probe result

The table records the measured best capstone for each 123-second, eight-seed
profile on the fixed PBE loadout (a low-SP proxy for Balance; see the caveat).

| Profile | Best capstone | Metric | Result (proxy) |
|---|---|---|---:|
| Moongrove, one target | Wild Apex | DPS | 160.8 |
| Moongrove, three targets | Wild Apex | DPS | 162.7 |
| Wildfang, Wolf | Quickening | DPS | 176.5 |
| Groveheart, three injured allies | Wild Apex | HPS | 20.7 |

The v0.29 Balance pass shifted Moongrove's power off flat base numbers onto
spell-power coefficients on its Moontide payoffs (Moonsurge and Sunwake) and the
Wildbolt filler, so a caster scales with gear like a caster. On the endgame
searched best-in-slot the montecarlo reads Balance at ~200 DPS (the coefficients
were calibrated down from an earlier over-scaling pass that read 258 there); the
proxy above reads ~160 because it caps at spell power 105. Un-geared, Balance now
sits inside the naked peer band (within 15% of the other naked specs) instead of
towering over it the way the old flat numbers did. The v0.29 cat re-band trimmed
Wolf (Redharvest, Flense, Rendclaw) so real-BiS Feral seats alongside Balance
(~200 to 210 on the montecarlo) rather than above it. Wolf pays no hybrid tax.
Groveheart heals from a dedicated intellect-leather fixture, uses a real
three-ally pressure profile with normal mana limits, and is not compared
against a fake damage rotation. On the 60-second owned-class HPS harness it
lands inside the peer healer envelope (91.3 HPS one ally, 42.4 HPS three
allies at the shared seed), clustering with the triage healers; the gap to
the AoE chain healers over long pressure windows is a flagged PBE question.

The attacking-live-mob profile (which equips the shared agility dev best-in-slot,
so it verifies the rotation fires, not the caster-gear DPS the matrix measures)
produced 3,232 Moonwing damage with 5 chosen payoffs, 5,044 Wolf damage with 10
payoffs, and 2,192 Bruin damage with three Marrowbreaks under Craven Roar upkeep.
Bruin took 139 incoming damage and built 5,741.4 threat during the 30-second
profile. This is the tank-behavior check, not a claim that Bruin should match a
damage arm.

The Bruin tank profile (`runDruidBruinTankProbe`, seed 42920) measured 22.0%
less incoming damage than Wolf posture over a 30-second passive window under
real mob swings (177 against 227), 182 threat per 100 damage from the bear
multiplier and the feral threat bonus, a 1,150 snap-threat full-bank
Marrowbreak, the full 3-second Menace forced-target window, and a 5-second
handoff under the classic 110% rule after shifting out.

### Full capstone comparison

| Profile | Nature's Echo | Wild Apex | Quickening |
|---|---:|---:|---:|
| Moongrove, one target DPS (proxy) | 158.9 | 160.8 | 145.5 |
| Moongrove, three target DPS (proxy) | 157.7 | 162.7 | 150.0 |
| Wildfang, Wolf DPS | 175.5 | 170.9 | 176.5 |
| Groveheart, three ally HPS | 20.3 | 20.7 | 20.3 |

## Setup

1. Start offline play and create a Druid.
2. Use `/dev level 20`, choose a specialization, and repick the redesigned rows.
3. Use `/dev bis` after changing specialization.
4. Compare both a high-health training target and an attacking live mob.
5. Use `/dev god` when comparing tank or healing behavior.

## Moongrove

Enter Moonwing Form and keep Lunar Tempest active. Wildbolt fills Moontide
(Skyfall and Moonseed casts fill it too). At three pips BOTH buttons light
up: Moonseed shows Moonsurge (the damage slam) and Skyfall shows Sunwake
(the burn plus mana refund). Press ONE: either spends the whole bank and
both revert. Moonsurge fires even while Moonseed's own cooldown is running.
Use Moonseed on cooldown below full bank and never let Lunar Tempest fall.

The expected feel is one unchanging loop with a chosen payoff: damage when
your mana is healthy, Sunwake when it is not, and the pick should feel like
yours every cycle. Shifting out pauses everything; it must not erase or
continue building the bank.

## Wildfang

Wolf loop: keep Flense active (18 sec), build combo points with Rendclaw,
apply Bloodrift (24 sec), and press the Gorebite slot when Old Blood
transforms it into Redharvest. Combo points are optional on the press: the
detonation and energy refund always fire, and any points held only grow the
bite. The long bleeds mean one or two builders after Bloodrift still detonate
nearly full bleeds.

Bruin loop: keep Craven Roar up and maintain threat with Sweeping Claws and
Bonecrush. Old Blood is shared with Wolf, so a bank built before shifting
remains available. At three stages Bonecrush becomes Marrowbreak. Above half
health it must deal its burst and snap threat without an absorb. Below half
health it must deal no burst or snap threat and instead grant the absorb and
rage refund.

## Groveheart

Cast Wildbloom and Second Bloom deliberately across injured allies. Only casts
that plant a new owned HoT add Verdance; refreshing the same owned HoT must not.
Five plants transform Swiftmend into Overbloom. Let several owned HoTs retain
meaningful duration before spending: every affected ally should receive one
immediate harvest heal, the old HoTs should disappear, and a fresh Wildbloom
should appear on the selected target. With Seedspread, each harvested ally
receives the replant.

## What to verify

- A bank stage is visible and advances from the documented press only.
- Moonseed cannot cast or extend Lunar Tempest outside Moonwing.
- A full bank changes the existing action instead of adding a new bar action.
- Shifts preserve Moongrove and Old Blood; combat end clears only Old Blood.
- Same-spec row repicks and specialization changes clear engine state.
- Nature's Echo seeds one stage, Wild Apex strengthens the payoff, and
  Quickening restores the current form's resource.
- Wildfang can queue as tank or damage in Dungeon Finder.
- Swiftmend and Overbloom share one slot cooldown: after a harvest, the base
  button cannot immediately consume the fresh replant, and the running clock
  shows on the transformed button.
- At full Moontide BOTH payoff buttons arm at once; pressing either spends
  the bank and reverts both. Only one payoff per cycle is possible.
- Moonsurge fires through Moonseed's own recharge, and pressing it never
  arms Moonseed's cooldown.
- Redharvest fires at zero combo points (bank-only press) and scales up with
  any points held.
