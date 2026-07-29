# Healing vs Heroic Dungeons: Monte Carlo Analysis (v0.29.0)

Date: 2026-07-23. Harness: `scripts/healing_montecarlo.ts` (`npm run sim:healing`),
a healing-focused port of the PR #1040 / PR #1859 methodology. Every number
comes from the real deterministic `Sim` on current main, one fresh seeded world
per run, 12 seeds per cell. Raw data: `tmp/healing_mc/report.json`.

## What changed in v0.29.0

Commit `96a2e4e6bb` (PR #2315) retuned every heroic dungeon:

| Dungeon | Damage mult (old, new) | Factor | Health |
|---|---|---|---|
| Hollow Crypt | 5.1 to 20 | 3.92x | doubled |
| Sunken Bastion | 4.65 to 18 | 3.87x | doubled |
| Drowned Temple | 4.3 to 16.5 | 3.84x | doubled |
| Gravewyrm Sanctum | 4.05 to 15.5 (bosses 19) | 3.83x (bosses 4.69x) | doubled |
| Nythraxis raid | 2.0 to 8.75 | 4.38x | doubled |

Calibration target: every heroic swing lands at least 500 post-mitigation on the
max-mitigation reference prot warrior (raid boss 1200). Healing output was not
touched. Mob health doubling also doubles fight length, so mana burden doubled.

## Bench A: best-in-slot healer throughput (level 20, raid + heroic gear)

Single-target priority rotation into an always-wounded ally. Burst = mana topped
up every tick (the ceiling). Sustained = real mana over 240s (five second rule:
zero regen while chain-casting).

| Spec | Burst HPS | Sustained HPS | Time to OOM | Mana | Spell power |
|---|---|---|---|---|---|
| Holy priest | 190 | 81 | 66s | 2934 | 87 |
| Resto druid | 161 | 73 | 74s | 2813 | 86 |
| Disc priest (heals only, shields excluded) | 157 | 67 | 66s | 2934 | 87 |
| Resto shaman | 149 | 118 | 164s | 2838 | 87 |
| Holy paladin | 118 | 57 | 87s | 2430 | 75 |

## Bench B: heroic damage intake (immortal-probe BiS prot warrior, 3367 armor / 2452 HP, Defensive Stance)

| Encounter | DTPS p50 (p10, p90) | Max single hit | Avoidance | Pre-buff DTPS (derived) |
|---|---|---|---|---|
| Crypt trash, 3x Shambler | 488 (103, 639) | 1441 | 19% | ~124 |
| Morthen (Crypt boss) | 245 (226, 263) | 1752 | 21% | ~62 |
| Vael (Bastion boss) | 244 (222, 276) | 1627 | 22% | ~63 |
| Ysolei (Temple boss) | 272 (242, 280) | 1639 | 20% | ~71 |
| Sanctum trash, 3-pull | 668 (564, 731) | 1482 | 23% | ~175 |
| Korgath (Sanctum mid-boss) | 259 (219, 289) | 1864 | 21% | ~55 |
| Korzul (Sanctum boss) | 347 (307, 353) | 1997 | 15% | ~74 |
| Nythraxis heroic (melee only, no script) | 288 (92, 594) | 3430 | 20% | ~66 |

Pre-buff column scales the measurement by old/new damage multiplier (the
transform is linear). Boss enrage (30% HP: damage x1.5, speed x1.3) is NOT in
these numbers; the kill phase is worse than the p50s above.

## Bench C: tank + healer survival (real HP and mana, 6s of pre-HoTs, 240s cap)

Survival was 0% in every cell. Median tank death times:

| Encounter | Best single healer | Median death | Duo (priest + shaman) |
|---|---|---|---|
| Morthen | resto druid | 40s | 37s |
| Korzul | disc priest | 19s | 16s |
| Crypt trash 3-pull | disc/paladin | 5s (others 2.5s) | not run |

Two decisive observations:

1. Adding a second healer does NOT extend survival (Korzul 16s single vs 16s
   duo; measured tank HPS barely moved, 148-184 single vs 182 duo). With a
   2452 HP pool taking 600-2000 per swing, concurrent heals overheal-clamp:
   the fight is lost in spike windows, not on aggregate HPS.
2. Trash alpha-strike: three swing timers connect inside the healer's first
   cast (deaths at 2.5s with 2.5s casts). No healing number fixes an unCCed
   heroic 3-pull.

## The deficits, in one place

- Boss median DTPS is 245-347 vs a best-healer burst ceiling of 190: the best
  healer in the game covers 55-78% of a heroic boss on the best-mitigated
  tank; the median healer covers roughly half. Pre-buff the same bosses did
  55-75 DTPS: every healer covered them with 2-3x margin, even sustained.
- Sustained (mana-real) coverage is 23-48%. Kill windows: Morthen ~7.9k HP,
  Korzul ~13.1k HP, so realistic kills run 45-100s against a 66s full-tilt
  priest mana pool.
- Unhealed time-to-die on the best tank vs Korzul: ~7 seconds.
- Max single hits are 66-81% of the tank pool; a hit+crit inside one boss
  swing period (2.6s) exceeds the pool. This is why duo-healing changes
  nothing.

## What a healing buff can and cannot fix

A global healing multiplier k scales burst, sustained, and healing-per-mana
together (costs unchanged):

- k = 1.5: best healer matches Morthen/Vael/Korgath p50; Korzul still short;
  median healers still short everywhere.
- k = 1.75-2.0: all five healers cover the easier bosses at p50, best healers
  cover Korzul with margin; mana stops binding for 60-90s fights (duty-cycle
  drops below 100%, five-second-rule windows reopen).
- No k fixes: two-swing spike kills (pool-sized damage inside one cast time),
  trash alpha-strikes, or the healer-stacking overheal clamp. Those need one
  of: a bigger heroic-tank EHP floor (stamina on the heroic/raid tier so the
  pool clears ~2 average swings plus a pulse), a crit cap or variance squeeze
  on heroic mob swings, or accepting that heroic trash is a hard CC check.

## Recommended package (for discussion)

1. Global healPct-style buff of about +75% to +100% (or per-ability retune to
   the same envelope) to restore boss-healing viability.
2. Pair it with a spike-survivability lever, or heroic bosses stay coin-flip:
   preferred is raising tank-tier stamina so the reference pool reaches
   ~3500-4000 (max hit drops to ~50-57% of pool); alternative is capping mob
   melee crits vs players in heroic instances.
3. Leave trash as a CC check (its 500-per-swing floor was the explicit design
   goal of #2315), or shave only the trash multipliers if healing through a
   2-pull is intended gameplay.
4. Holy paladin needs targeted help beyond any global k: worst mana pool
   (2430), worst spell power (75), worst coverage (34-48% of boss p50).
5. Disc priest absorbs are invisible to HPS meters here (excluded from bench
   A); its shields DID buy the longest trash survival, so shield-value scaling
   should ride any heal buff (absorbPct already exists on its baseline).

## Bench D: Nythraxis raid, normal and heroic (real encounter path)

`scripts/healing_montecarlo_raid.ts` (`npx tsx`, 8 seeds, 300s cap) runs the
REAL encounter through attune + raid of 10 + difficulty claim + enterDungeon,
with mechanics played (Soul Rend stacking, Deathless ward channels, off-tank
add securing, priest-add focus). Comp: prot warrior MT, prot paladin OT,
N healers (priest/shaman/druid/paladin), fire mages filling to 10.

| Cell | Kill | Wipe | Boss HP at end (p10-p90) | Median wipe time | Tank DTPS | Healer HPS each |
|---|---|---|---|---|---|---|
| Normal, 2 healers | 12.5% | 87.5% | 1.1-17.1% | 98s | 192 | 98 |
| Normal, 3 healers | 0% | 100% | 7.1-35.7% | 158s | 199 | 75 |
| Heroic, 2 healers | 0% | 100% | 92-98% | 5.4s | 1191 | 42 |
| Heroic, 3 healers | 0% | 100% | 92-98% | 13.5s | 859 | 65 |
| Heroic, 4 healers | 0% | 100% | 93-98% | 5.4s | 1267 | 57 |

Normal: a genuine near-miss. First death is the MT at 52-123s in most seeds;
raids reach 1-18% boss HP before unravelling; healer mana starts breaking in
the longer 3-healer fights (6 OOM events). Note the 3-healer trap: swapping a
mage for a third healer LOWERS the kill chance at current healing numbers,
because the marginal healer adds less than the lost DPS costs in fight length.
(Normal Nythraxis boss damage also rose in v0.29.0: the #2315 normal floor of
600 per swing is ~5x the pre-buff normal swing.)

Heroic: not a healing problem at all. The MT dies at exactly 1.5 seconds in
every logged run, and the encounter script explains why: Gravebreaker's FIRST
cast fires at t=1.5s on the pull (`gravebreakerTimer: 1.5`,
encounters/nythraxis.ts:247), it is a full weapon-sized roll (weapon range +
AP/14 x speed), UNAVOIDABLE (dealt directly, no dodge/parry/block roll), 1x on
the current target and 1.5x on anyone else in the 11yd frontal arc. On heroic
that is ~1200-1900 post-mitigation stacking with the ~1200-1900 opening melee
swing against a 2452 pool: dead at 1.5s on all but perfect avoidance rolls.
Full raid buffs the sim comp did not run (Litany of Resolve +5% sta, stamina
elixir +12 sta, roughly +250 HP) turn "dead every pull" into "dead most
pulls"; they do not change the conclusion. Dread Curse (+10% vulnerability per
stack) and repeating Gravebreakers push sustained tank intake to 859-1267
DTPS. Healer count 2 vs 3 vs 4 changes nothing; phase 2 was never reached. No
healing multiplier fixes this; heroic Nythraxis needs its damage retuned (or
tank EHP roughly doubled) before healing tuning is even measurable there.

Reconciliation with live reports ("stuck in phase 1 with the adds"): those
reports match NORMAL difficulty, and the sim reproduces them. Normal survives
the opener (600-floor: swing + Gravebreaker is ~1200-1900 total against 2452),
then hits the phase-1 wall: phase 2 requires pushing the boss below 70%
(NYTHRAXIS_PHASE_TWO_HP = 0.7) of a doubled 120k pool while Raise Fallen
spawns two adds every 30s, and v0.29.0 raised normal-raid add damage to a
300-per-swing floor. The sim raid, WITH clean scripted off-tank add control,
still wiped 87.5% of runs; a group whose DPS stalls on adds never crosses 70%
at all, which is exactly the reported experience.

## Tier-by-tier recommendation summary

| Content | Deficit | What fixes it |
|---|---|---|
| Normal Nythraxis | small (wipes at 1-18% boss HP) | healing buff ~1.3-1.5x flips it |
| Heroic 5-man bosses | ~2x vs burst ceiling | healing buff ~1.75-2x PLUS spike lever |
| Heroic trash packs | 3-6x, alpha-strike | CC check by design; healing cannot address |
| Heroic Nythraxis | tank one-shot at 1.5s | damage retune or ~2x tank EHP first |

## Scenario: 1 healing per Intellect (int-to-SP 1:1 for heals)

Maintainer proposal: WoW-style healing scaling, each point of int worth 1
healing instead of 0.5. Implemented as a heal-side x2 on the spell power term
(3-line patch to `directHealBonus`, `hotTickBonus`, `absorbBonus` in
`src/sim/spell_scaling.ts`, reverted after the run; data preserved as
`tmp/healing_mc/report_int1to1.json` + `raid_report_int1to1.json`). Damage
spells untouched: implementing it by raising SPELL_POWER_PER_INT globally
would also buff DPS casters ~15-25%.

Effect on throughput (bench A, burst): priest 190 to 228 (+20%), disc 157 to
194 (+24%), druid 161 to 185 (+15%), shaman 149 to 185 (+24%), paladin 118 to
154 (+31%). Average about +23%; time-to-OOM unchanged, healing-per-mana +23%.
The gain is bounded because spell power is only 20-30% of heal output at
current gear; int scaling cannot deliver more than its share.

Outcome changes:
- Heroic 5-man bosses: survival still 0% in every cell. Morthen death times
  stretch a lot (priest 24s to 77s, druid 40s to 61s) but effective tank HPS
  (206) still trails even the easiest boss's 254 DTPS. Korzul barely moves.
  Trash unchanged (alpha-strike).
- Normal Nythraxis: clearly closer (3-healer comp goes 0% to 12.5% kills,
  boss-HP-at-wipe p50 22% to 7.5%) but not flipped; most seeds still wipe at
  1-20%.
- Heroic Nythraxis: unchanged, tank one-shot at 1.5s (no healing change can
  matter).

Verdict: 1:1 int is a good structural change (stat scaling stops being
vestigial, gear progression means something for healers) but it is about a
quarter of the needed correction. Composite that lands in the target envelope:
1:1 int (+23%) TIMES base heal values +40-50% is roughly 1.7-1.85x total,
which matches the deficit ladder for normal raid and heroic 5-man bosses,
leaving the spike lever (tank EHP or heroic crit cap) and the heroic-Nythraxis
retune as the remaining, non-healing work.

## Change implemented: Gravebreaker as a charged auto-attack

Maintainer direction: Gravebreaker should not be a free-standing instant cast;
it should be a charged auto-attack with splash damage. Implemented test-first
in this worktree (branch `analysis/healing-montecarlo`):

- The 12s cadence now only ARMS the boss (`gravebreakerCharged`); the next
  melee swing the boss LANDS releases it. The swing target takes only the
  normal swing (no separate Gravebreaker hit, no double-hit stacking), and
  everyone else in the 11yd 60 degree frontal arc takes 1.5x of the same
  swing roll, armor-mitigated per victim. The splash never crits (a critting
  swing doubles the primary hit only) and draws no extra rng.
- Avoidance is real counterplay: a dodged/parried/missed swing holds the
  charge for the next landed swing.
- The 1.5s opener is gone: the first charge completes at 12s.
- Files: `src/sim/encounters/nythraxis.ts` (arm + release),
  `src/sim/mob/mob_swing.ts` (on-swing hook beside the cleave affix),
  `src/sim/types.ts` (state field). Tests:
  `tests/nythraxis_gravebreaker_charged.test.ts` (new, red against the old
  design), six rewritten pins in `tests/nythraxis_raid_unit.test.ts`, parity
  scenario updated and `nythraxis_full_pull` golden re-minted
  (`UPDATE_PARITY=1`). Green: nythraxis suites (148), parity (183),
  architecture guard, `tsc`. Run the full gate before merging.

## The decision matrix (8 seeds per cell, 300s cap)

Nythraxis raid outcomes under the four combinations measured:

| Variant | Normal 2H | Normal 3H | Heroic (any healer count) |
|---|---|---|---|
| Live v0.29.0 (old Gravebreaker, 0.5 int) | 12.5% kills | 0% kills | MT dead at 1.5s, boss 92-98% |
| Old Gravebreaker + 1:1 int | 12.5% kills | 12.5% kills | MT dead at 1.5s, unchanged |
| Charged Gravebreaker (implemented) | 50% kills | 25% kills | wipe at 18-36s, boss 79-87%, tank DTPS 514-544 |
| Charged Gravebreaker + 1:1 int | 62.5% kills | 87.5% kills | wipe at 30-38s, tank DTPS 456-547 |

The charged Gravebreaker plus 1:1 int healing turns normal Nythraxis into a
working encounter (deaths per run drop to 1, most seeds kill). Heroic
Nythraxis remains out of reach on sustained pressure: ~500 tank DTPS against
a 2452 pool with 1200-floor swings and Dread Curse ramping. It needs either
its damage floor revisited (the 1200 target itself) or roughly double the
tank EHP before any healing number can carry it. The heroic FIVE-MAN
conclusions from bench C are unchanged by this section (their bosses use the
generic aoePulse, not Gravebreaker).

## Correction: the real tank pool is ~3.1-3.3k, and the benches now model it

Maintainer flagged that tanks reach ~3.3k HP; verified correct. The probe:
max-STAMINA gear pick (stamina first, armor tiebreak) lands exactly on the
floors-test reference warrior (2762 hp / 2861 armor base), plus Litany of
Resolve (+5% sta) and Elixir of the Bear (+12 sta) reaches 3072; enchant and
masterwork rolled stats (unmodeled) plausibly close the gap to ~3.3k. The
original bench tank (2452 hp / 3367 armor) came from armor-heavy stat weights
that traded 310 base HP away. The harness now uses the max-EHP pick and
applies both buff layers to every bench tank (`applyTankRaidBuffs`).

Re-measured on the corrected 3072-HP tank (charged Gravebreaker, live heal
scaling; old-tank artifacts preserved as `*_tank2452.json`):

- Intake rises ~8-10% (the max-EHP kit carries less armor): five-man bosses
  265-373 DTPS, trash ~700, Korzul max hit 2194 (71% of pool, was 81% of the
  small pool). Heroic Nythraxis max hit 3651 still EXCEEDS even a 3.3k pool:
  boss crits remain one-shot territory.
- Five-man survival is still 0% everywhere, but deaths come meaningfully
  later (Morthen single-priest median death 24s to 40s, trash alpha 2.5s to
  4.9s). With the pool corrected, the failure mode is now cleanly THROUGHPUT,
  not spikes: ~500+ landed every 2.4-2.6s against ~200-per-cast heals.
- Raid: normal 2-healer reaches 62.5% kills at live heal scaling (charged
  Gravebreaker); heroic still wipes 100% at 20-38s, tank DTPS 559-590.

Conclusion updates: (1) the tank-EHP "spike lever" from the recommendation
package largely already exists in the game via the stamina kit, Litany,
elixirs, and enchants; the sim simply was not using it. What remains of the
spike problem is boss CRITS (2x) in heroic instances, so a heroic mob
crit-cap is the one spike lever still worth taking. (2) The healing-output
deficit is unchanged in shape: parity against Morthen needs ~1.55x, against
Korzul ~2.06x, so the 1.7-1.85x package (base heals +40-50% plus 1:1 int)
stands. (3) A single heal is 6.5-8% of the corrected tank pool per cast,
against a classic-era reference of 15-25%: the maintainer's "pools outscaled
healing" framing, quantified.

## SHIPPED IN THE WORKTREE: the full rebalance wave (2026-07-23)

All three levers implemented test-first on `analysis/healing-montecarlo`
(18,641 tests green; only reds are the two known macOS-environmental
deploy_watchdog cases):

1. Tank crit immunity (`src/sim/combat/tank_crit_immunity.ts` + the one mob
   crit roll in `Sim.mobSwing`; roll still drawn for parity): prot warrior,
   protection paladin, feral druid IN Sloth Form. Pinned by
   the `tests/tank_crit_immunity_*_pair.test.ts` trio, warrior, paladin, and
   druid, over the shared `tests/tank_crit_immunity_util.ts` (immune spec at
   zero crits, control specs still critted).
2. Heal-side Spell Power doubled (`HEALING_SP_SCALE = 2` in spell_scaling.ts,
   direct heals + HoTs; absorbs deliberately excluded: the only
   coefficient-carrying shields are MAGE barriers, and the healer shield
   scales by rank instead).
3. Cap rank retune (`tests/heal_rank_caps.test.ts`, design doc appended):
   revalued L20 ranks + new L20 cap ranks, sub-cap ladders pinned untouched.
   holy_light cap cost landed at 117 to stay inside the peer mana-efficiency
   band (tests/spell_balance.test.ts).

Final matrix (12 seeds 5-man / 8 seeds raid, buffed 3072-HP tank):

- Healer burst HPS 188-277 (1.45-1.65x live), tank effective HPS 184-278.
- Max single hits on the tank collapsed: 5-man 1441-2194 to 795-1106, raid
  melee 3651 to 1915. Median DTPS unchanged (the immunity only cut the tail).
- NORMAL NYTHRAXIS FIXED: 2-healer comps kill it 100% of runs with a median
  of ZERO deaths (was 12.5% kills pre-wave).
- Heroic 5-man bosses: single-healer tank survival stretched to 72-143s vs
  Morthen-class bosses (kills take 45-90s with party DPS: viable), 26-58s vs
  Korzul (duo recommended). Fights are now MANA races, which is the classic
  shape: the tank dies when the healer runs dry, not to a dice roll.
- Heroic trash: unchanged alpha-strike CC check, by design.
- Heroic Nythraxis: still 100% wipe (boss at 75-81%, tank DTPS 506-561);
  needs its 1200-per-swing floor revisited as content tuning. Healer count
  now at least matters (4 healers hold to 64s vs 2 healers 35s).

Follow-ups: modernize chain_heal / healing_stream / tranquility descriptions
to $d and rank them; heroic Nythraxis floor retune; a +healing item stat for
future gear tiers (with HEALING_SP_SCALE, flat +spellPower on gear already
counts double for heals, so int/SP itemization is the interim lever).

## Heroic mechanics audit (2026-07-23): what the tank-DTPS benches did not price

Full sweep of all four heroic dungeons (every spawn-list mob, summon chains,
and the fire-path code for each mechanic). Armor profiles: tank 2861 /
mail 1500 / cloth 700; BiS non-tank pools run 557-1800.

1. SUMMONED-ADD MISSILES ARE SYSTEMIC (three bosses, not one). Vael: 2x
   drowned_thrall per wave at 32.5x (two waves). Ysolei: 2x moonspawn at
   30.5x. Velkhar: THREE raised_bonewalkers per wave at 29x, the worst case.
   All spawn seeded on the tank with `addThreat(add, victim, 1)`: ONE threat
   point, so the first heal or DPS hit peels them, and their normal swings
   one-shot cloth (971-1529) and crit mail for up to ~2400.
2. UNMITIGATED AOE PULSES: aoePulse/stomp damage has NO armor step (deal path
   in mob/locomotion.ts) and never crits: cloth and plate take the same hit,
   unavoidable within radius. Per fight: Morthen 240-360/10s r12, Vael
   288-432/10s r12, Ysolei 363-528/9s r13, Korzul 570-798/8s r14. Korzul's
   pulse is the hidden healing tax: every melee DPS eats 570-798 each 8s all
   fight (~75-100 unavoidable HPS per melee), and it can one-shot a
   cloth-pool bystander. The bench C tank-DTPS framing missed this entirely;
   Korzul's true group healing demand is far above the 346-405 tank line.
3. ANTI-HEAL ON BASTION TRASH: bastion_revenant Maiming Strike, 30% per
   swing, HALVES healing taken for 6s. Interacts head-on with the healing
   rebalance during Bastion trash pulls (trash is a CC check anyway; flag).
4. KORGATH STOMP: 380-570 unmitigated r10 every 12s PLUS a 1.5s stun on
   everyone hit including the TANK (who then sits through 756-1180 swings at
   2.8s). Korgath also swings the hardest of any five-man mob and enrages.
5. ENRAGE COVERAGE: Ysolei has enrage 1.4x below 30% (missed in the earlier
   per-boss verdicts); Korgath/Korzul 1.5x. Enrage multiplies SWINGS only,
   never pulse/stomp mechanics (verified in the fire paths).
6. Onrush charge (all heroic trash + summons): gap-close plus 0.5s stun, no
   damage. Working as intended anti-kite. Olen (Bastion trash boss) cleaves
   0.6x swing onto players near the tank: melee positioning check.

Verdict updates: Morthen remains the honest tank-and-spank entry boss and the
earlier viability table holds for him; Vael/Ysolei/Velkhar margins were
overstated (adds), Korgath's (stomp+enrage) and Korzul's (pulse tax on melee)
too. Recommended additions to the pending decision list: the summon threat
seed (1 -> ~500-1000), heroic-wide mob crit removal vs players, and an
explicit call on whether Korzul's unmitigated 570-798 melee pulse is the
intended ranged-favored fight or needs armor mitigation.

## SHIPPED IN THE WORKTREE: wave 2, the encounter mechanics pass (2026-07-24)

All maintainer-approved, test-first:

1. Summon threat seed 750 (was 1): adds default to the tank through normal
   healing; sustained DPS focus can still rip one (tests/summon_threat_seed).
2. Summoned-add floor 250 (was 500): Vael 16.25x, Ysolei 15.25x, Velkhar
   14.25x; heroic Nythraxis adds 3.75/3.75/8/6. Adds are wave pressure, not
   extra bosses (they were hitting 78-89% of their own boss). Trash stays 500.
3. Voss: moveSpeed 11 -> 8 (a 50% slow now drops him below player run speed);
   controllability contract pinned (CC-able, slow-able, taunt-immune).
4. Grave Inferno replaces Korzul's Necrotic Shockwave on BOTH difficulties: a
   generic `infernoChannel` mechanic (30s cadence, 8s stationary channel, no
   melee, four escalating unmitigated fire pulses at base 7-9 x pulse-index x
   mechanic mult, 14yd, nova fx per pulse). Heroic pulse 4: 532-684; normal:
   364-468. Uninterruptible (Korzul is ccImmune).
5. Tank parity: protection paladin staPct +0.35; Sloth Form armor 1.9x ->
   2.3x + feral staPct +0.25. All three tanks now within 88-108% of the
   warrior's EHP (tests/tank_parity; paladin was 76%, druid 66%).
6. Normal Gravewyrm fresh-group retune: trash 200, bosses 420, bonewalkers
   150 (mults 7.5/7.25/11.25/13.5/14/13), doubled health kept. On a fresh-20
   quest-blue tank (1433 armor / 1692 hp): trash swings 17-28% of pool
   (comfortable), boss swings 35-55% (dangerous, clearly healable, two max
   rolls back-to-back still threaten: a real fight for the target audience).
   The solo ceiling holds: a BiS warrior takes ~169 landed DTPS from Korzul
   against a ~140 hps self-heal ceiling, and trash sustains above it too.

Post-wave-2 matrix (12 seeds 5-man / 8 raid): Korzul joined his tier: median
single-healer tank survival 45-154s (was 16-48s), duo 93s; his bench DTPS
250 (was 347) since the Inferno is avoidable choreography instead of a
standing melee tax. All five heroic bosses now cluster: priest holds 85-93s,
shaman 86-154s, druid 74-77s, disc 64-72s, paladin 33-45s (kit pass still
pending). Heroic Nythraxis: raid deaths now come from boss mechanics rather
than add one-shots, 4-healer comps hold to 90s, still 100% wipe on the 1200
boss floor (the one remaining open decision). Normal raid: 87.5% kills both
comps. i18n release debt: the reworded bear_form description (+90% -> +130%).

## Caveats

- Rotations are single-target priority lists (the matrix harness's, plus HoT
  weaving); a perfect player might squeeze ~10% more. Chain Heal, Prayer of
  Healing, totems, and Tranquility are unused (single-target scenario).
- Bench B's immortal probe never triggers enrage or on-low-HP behavior, and
  the standalone Nythraxis spawn runs no encounter script (its row is melee
  only and understated).
- The bench tank (statScore pick: 3367 armor / 2452 HP) trades HP for armor vs
  the floors-test reference warrior (2861 armor / 2762 HP); net mitigation is
  comparable.
- No dungeon-finder party DPS was simulated in benches A-C; kill-window
  estimates there use party DPS of 135-195. Bench D measures real raid DPS
  (mage filler, ~120-150 each at BiS).
- Bench D raid play is scripted-simple: mage-only DPS, teleport positioning,
  no CC or interrupts beyond off-tank threat and priest-add focus. Better play
  moves the normal-raid margins, not the heroic one-shot math.
- Found while porting: `scripts/nythraxis_matrix.ts` on main still uses the
  pre-talents2 allocation shape ({spec, ranks, choices}); validateAllocation
  rejects it and every actor silently falls back to defaultBuild (wrong
  specs). Worth a separate fix.
