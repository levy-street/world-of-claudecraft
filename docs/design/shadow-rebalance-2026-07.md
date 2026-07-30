# 2026-07 Shadow Priest Rebalance: Cap Ranks and Dark Descant

Status: implemented on `fix/shadow-priest-rebalance`, wants owner sign-off and a
PBE look per the balance-change process.
Companion docs: `docs/design/spell-ranks.md` (the rank ladder amendments),
`docs/design/spell-balance-framework.md` (the measurement contract this cites).

## Problem

The Vespers (shadow) kit measured last-but-one of the five caster DPS specs in
sustained single-target DPS at the cap, and the spec's own damage kit lost to a
healer spamming Scouring Hymn (Smite, 39.0 analytic spamDPS on
`scripts/balance_report.mjs`, versus 34.4 measured for the full shadow
rotation). Two structural causes:

- Both shadow damage ladders flatlined before the cap. Dirge of Decay topped at
  rank 3 (level 16) and Litany of Woe never ranked past its learn level, while
  every peer caster filler ranks to 20.
- The filler (Litany of Woe, 41 percent of shadow output) was the one
  rotational button with no spec-baseline entry: Dirge and Mindfracture had
  baseline rows, the thing you press most did not.

There was also a feel gap: frost mage got the proc-loop treatment in its
overhaul (Ice Lance spender, owner pass 2026-07-14), while shadow's rotation
had no proc at all: dot, cooldown button, channel, repeat.

## Measurements

`scripts/caster_dps_probe.ts`: sustained single-target, 123 seconds, level 20,
auto-equipped gear, own buffs only, full choice-row picks, competent priority
rotation per spec. Damage summed from damage events. 123 seconds is retained
for comparability with `scripts/fury_dps_probe.ts` and is NOT the balance
framework's 180-second three-profile parity gate; treat these numbers as a
relative meter, not the framework report.

| Spec | Pre | Post |
|---|---|---|
| Shaman / Thundercall (elemental) | 43.9 | 43.9 |
| Warlock / Hexcraft (affliction) | 40.7 | 40.7 |
| Mage / Cryomancy (frost, rotation floor) | 37.3 | 37.3 |
| Priest / Vespers (shadow) | 34.4 | 42.2 |
| Druid / Moongrove (balance) | 27.1 | 27.1 |

Shadow lands second of five, 3.9 percent under the elemental top: inside the
10-to-15 percent band without taking the throne.

## Known residual gaps (out of scope here, recorded per the framework)

- The full caster spread is still open: elemental 43.9 against the frost
  ROTATION FLOOR of 37.3 is 17.7 percent. The frost number under-reads because
  the probe does not model its proc weaving (Ice Lance windows); a
  frost-rotation probe pass should re-measure before any frost buff.
- Druid balance (27.1) is far below the band and needs its own wave; nothing
  in this change touches it.

## The changes

1. **Dirge of Decay rank 4 at 20** (cost 72, dot 122 over 18 sec) and **Litany
   of Woe rank 2 at 20** (cost 58, drainTick 17): the healers-wave cap-rank
   recipe (~1.45x the prior top, cost ~1.3x so damage per mana improves).
   Sub-cap ranks pinned untouched.
2. **Litany of Woe joins the shadow spec baseline** (dmg +15 percent, cost -10
   percent), sized to match the help its peers' fillers already get (elemental
   Arc Bolt +18 percent, affliction fillers +6 percent global plus dot rows).
   The baseline table stays passive-only per its pinned contract.
3. **Dark Descant**, on the Gloamveil mastery: every 3rd Litany of Woe refunds
   3 seconds of Mindfracture cooldown and makes the next Mindfracture within 8
   seconds instant.

## Dark Descant derivation (why 3 / 3 / 8)

Mobile-first proc rules from `docs/prd/caster-proc-rotations.md` apply: no fast
weaving, the proc improves a button the player already presses, multi-second
windows.

- **Every 3rd Litany of Woe**: a full flay loop (3 sec channel plus GCD gaps)
  fires the proc roughly every 11 to 13 seconds against Mindfracture's 8
  second cooldown, so roughly every other Mindfracture is Descant-fed: present
  every rotation cycle, never a permanent state. n=3 is the repo's standard
  castNth cadence (Fault Line, Third Verse, Grave Rhythm all use it).
- **3 second refund**: at the moment the 3rd flay lands, the natural
  Mindfracture cooldown has roughly 2 seconds left in a static rotation; 3
  seconds clears that tail (the button is simply ready at your next idle GCD)
  without doubling Mindfracture throughput. Measured effect: Mindfracture
  share of output rises from 27 to about 30 percent within the +23 percent
  total, roughly plus one cast per 30 seconds.
- **8 second window**: exactly one Mindfracture cooldown, so an armed Descant
  never expires unused in a static rotation but does not bank across movement
  phases indefinitely.
- The instant arm is mobility value (cast while repositioning), worth little
  on a training dummy by design: Mindfracture's cast time already equals the
  GCD.

Determinism: `castNth` with no `chance` draws no rng, so the proc adds zero
draws and the parity gate's goldens are untouched (the suite is green with no
regeneration, which is the draw-neutrality proof for existing scenarios).

## What was deliberately not done

- No Effigy / Gloomtithe / Shadowfiend: that is the full Vespers redesign
  (`docs/design/priest-shadow-voodoo.md`), a PBE-lane feature, not a balance
  wave.
- No new buttons, resource bars, or row-option replacements: shipped rows are
  untouched; the existing shadow picks (Dirgebound Thought, Endless Dirge)
  simply become live once the dot is worth extending.
- No Smite nerf: the healer kit is the healers-wave's problem space; shadow
  was raised to it, per the buff-the-floor precedent.
