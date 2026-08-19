# PvP crowd-control diminishing returns

Owner module: `src/sim/stun_dr.ts` (the category classifier, the ladder
constants, and the two resolvers `crowdControlDurationAfterDr` /
`diminishedCrowdControlDuration`). Every PLAYER-sourced crowd-control
application funnels through `diminishedCrowdControlDuration`; the effect arms
in `src/sim/combat/effect_dispatch.ts` are the consumers. Pinned by
`tests/stun_dr.test.ts`, the duel-path tests in `tests/pvp_safety.test.ts`,
and `tests/warfare_set_bonuses.test.ts` (the item-set reduction layer).

## The rule

Diminishing returns apply only when a hostile player CCs another player.
The hostile-pair set is whatever `isHostileTo` reports, which today means
duels, ranked arena, Thornhollow battlegrounds, Fiesta, Yumi, Vale Cup, and
the jail brawl; there is no open-world PvP mode. PvE is untouched in both
directions: a player stunning a mob always lands the full authored duration,
and boss immunity is the separate `ccImmune` template flag. PET-sourced
crowd control is also exempt on purpose (the funnel gates on the SOURCE
being a player): this keeps the WARFARE 4-piece wording, "crowd control
cast on you by hostile players", exactly true (see `docs/design/warfare.md`).

The reset constants are per family (`PVP_STUN_DR_RESET`, `PVP_ROOT_DR_RESET`,
both 18 seconds today; polymorph and fear run 60 second windows).

Within one category, successive applications on the same target walk the
classic ladder: 100 percent, 50 percent, 25 percent, then immune (the fourth
application applies nothing). The window is `PVP_STUN_DR_RESET` (18 seconds)
measured from the most recent landed application; each landed application
refreshes it, a resisted cast does not advance or refresh anything, an
immune-stage attempt neither advances nor refreshes, and once the window
lapses the ladder starts fresh. The stamp is taken when the effect is
APPLIED, not when it fades: a 4 second stun's ladder is already 14 seconds
into its window when the stun ends. Polymorph and fear ride their own
schedules (staged absolute durations and duration-scaled multipliers; see
the constants in `stun_dr.ts`).

## Stun categories

Stuns are split into independent buckets, classified by
`stunDrCategory(abilityId)`:

- `openerStun`: the from-Duskveil openers, Gut Punch (`cheap_shot`) and
  Pounce.
- `controlledStun`: deliberate on-demand stuns behind real cooldowns: Low
  Blow (`kidney_shot`), Sundering Gavel (`hammer_of_justice`), Bash, Charge,
  Bear Charge, Faultline, Sun God's Verdict, Storm Bolt, Deadfrost
  (`deep_freeze`), Abyssal Rift.
- `randomStun`: the safe default for anything unregistered (proc-style
  stuns). The Vale Cup Shoulder stays here DELIBERATELY: repeated tumbles
  on one ball carrier ladder out (1.2, 0.6, 0.3, immune) by authored intent
  (the sport-abilities comment in `src/sim/content/vale_cup.ts` predates
  this system going live and asked for exactly that), and it must never
  share a bucket with real combat stuns.

The split is load-bearing: an opener never diminishes the follow-up
controlled stun, so the sanctioned rogue flow (full Gut Punch into full Low
Blow) survives. Only repeated same-bucket stuns shrink and then go immune.
A NEW stun ability must be added to the right set in `stun_dr.ts` in the same
change; an unregistered id still diminishes (in `randomStun`) but will not
share a bucket with the abilities it should.

## Why this shape (the WoW reference)

The reference game ran this exact system for two decades, and our shape maps
onto its history deliberately:

- The 100/50/25/immune ladder is verbatim from the original system (WoW
  patch 1.4.0) and held unchanged from vanilla through The War Within.
- The category split mirrors the WotLK 3.1 structure: a dedicated Cheap
  Shot plus Pounce opener pair, a broad controlled-stun category, and a
  random proc-stun category. Vanilla arranged the buckets differently
  (Kidney Shot alone in its own category, Cheap Shot with the controlled
  stuns) but delivered the same gameplay property in the opposite
  direction: in every pre-Cataclysm era the opener and the follow-up
  finisher stun did NOT share a bucket. Cataclysm merged them and killed
  the double-full-stun opener; we deliberately keep the classic-era feel.
- The reset window uses the Warlords semantics (a fixed 18 seconds from the
  most recent application, refreshed per application) rather than the
  classic rule (15 to 20 seconds after the effect ENDS, randomized on the
  server heartbeat). The fixed window is deterministic, which matters here:
  the classic randomized reset would put an rng draw on every CC
  application and shift the shared draw order.
- One deliberate divergence: WoW applies stun DR in PvE too (stuns are the
  one category that diminishes against mobs). We keep PvE undiminished on
  purpose: repeated stuns on trash are a core part of how melee kits feel
  in dungeons here, boss immunity is already handled by `ccImmune`, and
  applying a ladder to mobs would shift PvE balance and every parity golden
  for no stated problem.

## History

The first ship of the ladder exempted player stuns entirely (the reasoning:
short flat durations behind real cooldowns). Live PvP disproved the premise:
Gut Punch has no cooldown and the Cheap Trick talent row removes its
Duskveil requirement, so a rogue could hold a player in an unbounded stun
chain (Gut Punch every 6 seconds of energy, Low Blow and Dirt Toss plugging
the gaps). The 2026-08 PvP feedback round surfaced it, and the exemption was
removed: stuns now walk the same ladder as roots and lockouts. For the
record, the reference game never shipped a permanent no-stealth Cheap Shot
in any era; the closest analogs were time-boxed windows behind cooldowns
(Shadow Dance: 6 seconds on a 1 minute cooldown; Subterfuge: 3 seconds
after stealth breaks). Whether Cheap Trick itself should be reworked is a
separate balance decision from this system.
