# Nythraxis: every spec, its BiS build, its rotation, and what the numbers say

> **STALENESS (added 2026-08-09, review 3050):** every number below was
> measured at `94675f5a14`, roughly 230 `src/sim/` commits behind the branch
> head: BEFORE the executor nerf round (Destruction 259 to 208, Demonology
> 245 to 215, Shadow 233 to 214), the rogue base re-band, the Balance
> spell-power trim, and the v0.35/v0.36 release absorptions. Its 2.04x/4.94x
> spreads describe THAT tree, not the branch as it lands; the current-head
> gear-tier table and its spread live in the PR 3050 body, re-measured with
> the same harness (`tmp/mc/gear_tiers.ts` per class over the reconciled
> `builds_noLegendary_*.json`, 24 seeds). This document stays as the
> methodology record and the round-by-round narrative.

**Revision 3, 2026-08-06, measured at `integration/v031-class-overhauls` @ `94675f5a14`.**
Revision 2 (2026-08-04, measured at `5f35bbeb44`) was written but never committed; this
revision folds it in. Its numbers appear throughout as the comparison column and its raw
results are preserved in `tmp/mc_baseline_20260803/` (the July originals remain in
`tmp/mc_baseline_20260729/`). Every number here was re-measured from scratch on the current
tip: 24 combat seeds per spec per difficulty, gear AND talents chosen by measurement,
windows snapshotted from one 300 s run per seed. The full mechanical tables live in
`tmp/mc/report.md`; this document is the reading of them.

What landed on the branch between revision 2 and this study, in measurement order of
importance:

- **The whole v0.34.0 base refresh** (977 commits of content). Content adds shift the
  shared rng draw order, so every fixture was re-validated before any number was trusted:
  all 29 fixtures (19 DPS rotations, 6 healers, 4 tanks) still fire their buttons. No
  fixture rot this time.
- **`fbd9d06d6d`: Wicked Slash is normalized** (dagger 1.7, other one-hand 2.4) and the
  Thronebane energy runaway was tamed. This was aimed at the number one outlier of both
  prior studies and it landed hard; see the rogue section.
- **`ac5d34f7e4`: five new rogue daggers with on-hit procs.** They rank 4 to 6 in the
  weighted shortlist, inside the measured search's breadth, so the greedy gear search saw
  them; two of them win offhand slots in the zero-legendary world.
- **`19db0845cd` (rode in with the v0.34.0 catch-up): the warlock endgame sustain
  re-tune.** Cruel Pact's mana restore cut from 15% to 1.5% of maximum mana, Sentence's
  level-20 compression deepened from x0.8 to x0.55, Needle and Maledict Gaze re-banded
  down, soul_harvest cheapened 65 to 55.
- **`5b86b6d643`: shaman changes.** New level-20 Enhancement signature Elemental Trance
  (2 min cooldown, 15 s, 30% damage reduction, 20% of damage dealt returned as mana) and
  creature crit immunity for the Stonebound posture.
- **`27f5c30139`: the druid Balance re-seat** (Moontide payoffs and Wildbolt moved onto
  spell-power coefficients, flat base re-banded down) and the Feral cat trim. This commit
  was still sitting on the druid PR head when the study began; it was merged into
  integration as `ed55c470bc` (with the `druid_engines` parity golden re-minted as
  `94675f5a14`) so the study measures the tree as it will actually compose.

Methodology, carried from revision 2 plus three additions:

- **Build reconciliation, now on all three tiers.** The greedy search is seed-noisy, so
  every spec's revision-2 build was replayed under the current sim on the full 24-seed
  set and the better of {old build, fresh build} kept, per tier (decision window 60 s for
  full and epic-only, 300 s for the sustain tier). 19 of 57 builds kept the revision-2
  search: all three rogues, all three hunters, both mages and Enhancement on the full
  tier; the fresh searches there were 8 to 14% worse.
- **A paired-weapon A/B for Assassination.** Single-slot greedy swaps cannot see a
  dagger-pair optimum, so seven hand-built pairs were measured against the reconciled
  champion on the full seed set. The champion (heroic Thronebane plus Mistcaller's Fang)
  stood; every pure dagger pair was 14 to 17% behind.
- **Elemental Trance in both Enhancement fixtures**, gated at 80% mana (A/B over never /
  0.4 / 0.6 / 0.8 / on-cooldown: the 0.8 floor wins 120 s and 300 s and ties 60 s;
  casting at full mana wastes the return, waiting longer delays the later trances).

DPS is absolute, out of the real `src/sim` core, single target, standing still. No
encounter mechanics, no raid buffs, no consumables: the ceiling and the ordering, not a
live parse. GCD idle percent is not a rotation-quality score for proc and energy specs.

---

# The table at a glance (normal, full BiS)

| Spec | 15s | 60s | 300s | Execute | Heroic 60s | rev2 60s | change |
|---|---:|---:|---:|---:|---:|---:|---:|
| Destruction (Ruination) | 285 | **288** | 197 | 317 | 282 | 283 | +2% |
| Fury (Bloodrush) | 331 | **275** | 266 | 296 | 239 | 251 | +10% |
| Demonology (Pactbound) | 283 | **261** | 172 | 308 | 231 | 261 | 0% |
| Balance (Moongrove) | 227 | **258** | 265 | 250 | 246 | 269 | -4% |
| Affliction (Hexcraft) | 319 | **238** | 231 | 257 | 231 | 278 | **-14%** |
| Retribution (Dawnreaver) | 341 | **228** | 213 | 279 | 220 | 229 | -1% |
| Enhancement (Warspirit) | 256 | **224** | 206 | 233 | 209 | 231 | -3% |
| Feral cat (Wildfang) | 235 | **209** | 200 | 217 | 192 | 233 | **-10%** |
| Subtlety (Skulduggery) | 222 | **205** | 205 | 203 | 182 | 198 | +3% |
| Arms (Battlecraft) | 240 | **203** | 192 | 209 | 183 | 200 | +2% |
| Frost (Cryomancy) | 188 | **200** | 169 | 197 | 196 | 203 | -2% |
| Beast Mastery (Packlord) | 252 | **199** | 85 | 204 | 176 | 196 | +2% |
| Combat (Thuggery) | 218 | **194** | 191 | 206 | 175 | 203 | -5% |
| Fire (Pyromancy) | 290 | **191** | 108 | 310 | 187 | 189 | +1% |
| Assassination (Knifework) | 194 | **179** | 173 | 172 | 164 | 307 | **-42%** |
| Shadow (Vespers) | 176 | **178** | 181 | 179 | 174 | 173 | +2% |
| Survival (Fieldcraft) | 155 | **153** | 84 | 157 | 139 | 151 | +1% |
| Elemental (Thundercall) | 175 | **150** | 139 | 160 | 150 | 147 | +2% |
| Marksmanship (Coldsight) | 156 | **139** | 54 | 146 | 126 | 138 | +1% |

**Spread at 60 s: 2.07x** (288 to 139, median 203), against 2.23x in revision 2 and 2.37x
in revision 1. The table keeps tightening toward the repo's declared plus or minus 15%
intent, and for the first time the movement came from the top coming down (Assassination)
rather than the bottom being raised. At 300 s the spread is still 4.94x (266 to 54): the
long fight remains the game's real balance problem. The zero-legendary control spread is
2.19x at 60 s.

Everything outside the three targeted classes (rogue, warlock, druid) moved a few percent
at most. Fury's +10% is the one exception: its fresh gear search found a genuinely better
basin (the reconciliation confirmed it against the old build on the full seed set), not a
sim change.

# The two-minute window (the fairest single number)

60 s flatters burst and 300 s is dominated by who has gone OOM; 120 s is where burst has
faded but only the true mana cliffs have hit. Sorted by 120 s, with each spec's
sustain-objective build beside it (past two minutes that is the build a mana spec would
actually bring):

| Spec | 60s | 120s | 300s | sustain 120s | best 120s | OOM |
|---|---:|---:|---:|---:|---:|---:|
| Fury (Bloodrush) | 275 | **263** | 266 | 279 | 279 | - |
| Balance (Moongrove) | 258 | **260** | 265 | 266 | 266 | - |
| Destruction (Ruination) | 288 | **253** | 197 | 247 | 253 | 210s |
| Affliction (Hexcraft) | 238 | **229** | 231 | 217 | 229 | - |
| Enhancement (Warspirit) | 224 | **218** | 206 | 217 | 218 | 114s |
| Demonology (Pactbound) | 261 | **218** | 172 | 230 | 230 | 210s |
| Retribution (Dawnreaver) | 228 | **212** | 213 | 213 | 213 | - |
| Feral cat (Wildfang) | 209 | **204** | 200 | 197 | 204 | - |
| Frost (Cryomancy) | 200 | **202** | 169 | 214 | 214 | 171s |
| Subtlety (Skulduggery) | 205 | **202** | 205 | 218 | 218 | - |
| Arms (Battlecraft) | 203 | **195** | 192 | 206 | 206 | - |
| Combat (Thuggery) | 194 | **189** | 191 | 193 | 193 | - |
| Fire (Pyromancy) | 191 | **189** | 108 | 189 | 189 | 115s |
| Beast Mastery (Packlord) | 199 | **186** | 85 | 189 | 189 | - |
| Shadow (Vespers) | 178 | **178** | 181 | 176 | 178 | - |
| Assassination (Knifework) | 179 | **172** | 173 | 166 | 172 | - |
| Elemental (Thundercall) | 150 | **147** | 139 | 155 | 155 | - |
| Survival (Fieldcraft) | 153 | **143** | 84 | 151 | 151 | - |
| Marksmanship (Coldsight) | 139 | **129** | 54 | 133 | 133 | - |

Three readings:

1. **The warlock lead is a 60-second phenomenon.** At two minutes the podium inverts to
   Fury (279 sustain-built) and Balance (260, never dry); Destruction has already slid
   35 DPS off its 60 s number and Demonology 43. Judge the class at 60 s and it looks
   like the problem; judge it at 120 s and it is one strong spec plus two burst kits
   paying for their opener.
2. **The spread at 120 s is 2.04x** (263 to 129, median 202), the tightest of any
   window: the roster is closest to the plus or minus 15% intent exactly where fights
   actually live.
3. The bottom three are the same kit-problem specs at every window (Marksmanship,
   Survival, Elemental), which is why the suggested order of work targets kits, not
   levels, below the median.

(This study snapshots 15/30/60/120/300 s; a 180 s column would need a re-run with the
window added and is the natural next refinement if two minutes still feels short.)

---

# The rogue re-band, measured

`fbd9d06d6d` normalized Wicked Slash and tamed the Thronebane energy runaway, aimed
exactly at revision 2's number one outlier. It landed:

- **Assassination fell 307 to 179 at 60 s, first place to fifteenth.** The old build
  fired Wicked Slash off a 2.8-speed legendary two roll bands above every dagger; the
  normalized strike now contributes 16% of the spec's damage (it was the majority), and
  the tamed energy engine leaves the rotation idle 61% of its GCDs. Auto attack is now
  60% of Assassination's damage.
- **The dagger pool finally exists.** In the zero-legendary world the new daggers win
  slots on all three specs (Mistcaller's Fang mainhand everywhere; Rimefang or heroic
  Duskwhisper offhand), and Combat's full-BiS search picked heroic Duskwhisper over an
  offhand Thronebane. The paired-dagger A/B confirms the design intent is close but not
  closed: heroic Thronebane mainhand plus a dagger offhand still beats every pure dagger
  pair by 14 to 17%, entirely through white damage.
- **Thronebane itself is STILL offhand-legal** (`hand` unset, unchanged through three
  studies) and still farmable in normal and heroic variants. What changed is the size of
  the distortion: the zero-legendary control now prices it at +29% for Assassination
  (was +71%), +47% Combat, +39% Subtlety, +34% Fury, +30% Enhancement. It is no longer
  an ability amplifier, but it is still the single largest gear distortion in the game,
  and the fix is still one line plus a weapon re-band.
- The three rogue specs now sit 179 to 205 with Subtlety on top: the class went from
  owning first place to being the tightest class cluster in the table. Whether 179 (below
  the 203 median, 61% idle) is the intended seat for the assassination fantasy is an
  owner call; the energy engine, not the weapon, is now the binding constraint (40%
  starved at 60 s).

# The warlock sustain re-tune, measured

`19db0845cd` was Blaine's answer to the composed tree running 26% over the sustain bands.
It cut levels, not loops:

- **Affliction 278 to 238 at 60 s (-14%)**, second place to fifth. The Cruel Pact mana
  nerf (15% to 1.5%) sounds existential and is not: the cast still pays 20 Condemnation,
  and the spec's costs are low enough that it still NEVER runs dry (0% starved, flat 231
  at 300 s, the third best five-minute number in the game). The opener also survived:
  319 at 15 s is still the best in the class. What the nerf actually removed is the
  headroom; Sentence at x0.55 compression plus the Needle re-band pulled the whole curve
  down evenly.
- **Demonology and Destruction still die on the same cliff, eleven seconds later.**
  OOM moved from 199 s to 210 s (the cheaper soul_harvest) and 195 s to 210 s
  respectively; Destruction's sustain build pushes its first dry cast to 257 s and holds
  213 at 300 s. But the shape is unchanged: 261 and 288 at 60 s become 172 and 197 at
  300 s, with 37% and 49% of ready GCDs starved. The re-tune moved the cliff, not the
  physics; a Ruin or Fragment mana rebate remains the open design item.
- **Destruction is the new number one at 60 s (288) and on heroic (282)**, because
  nothing in its kit rolls the heroic resist table (2% tax). The top of the table is now
  Destruction, Fury, Demonology: one warlock fewer than revision 2's podium sweep.
- **The gear-flat scaling risk is intact.** Naked Affliction still does 67% of its BiS
  output, naked Destruction 67%, naked Demonology 66%; Sentence takes no spell power and
  the Dominion servants still ignore owner stats entirely. A naked Affliction warlock
  (160 DPS) still out-damages a fresh-geared one of most other specs.

# The druid re-seat, measured

`27f5c30139` moved Balance onto spell-power coefficients and trimmed the cat. Both landed,
one with a caveat:

- **Feral cat 233 to 209 (-10%)**, exactly the intended trim, now seated 49 DPS below
  Balance rather than the intended 25 (because Balance in true BiS sits higher than the
  owner's anchor, next point).
- **Balance reads 258 at 60 s in searched BiS, not the 200 the commit seats it at.** The
  owner's anchor was measured on a fixed intellect loadout with the owned-probe build;
  the measured search finds the Berserk row plus the legendary Deathless Heartwood staff
  and lands 29% above the anchor. The zero-legendary control still reads 259, so the gap
  is the build search, not the legendary. The intended "200 anchor, inside the naked peer
  band" holds only for the fixed probe loadout; real BiS Balance is a top-four spec with
  the game's best sustain curve (265 at 300 s, never dry, 0% starved).
- **The gear-scaling repair worked.** Naked Balance is now 40% of its BiS (was 59% in
  revision 2, the highest naked number in the game); its damage finally lives on the
  gear axis like every other caster.

# Elemental Trance, measured (new this revision)

The new Enhancement signature was added to both fixtures with a measured 0.8 mana-floor
gate:

- **DPS: the 300 s cliff is fixed.** Enhancement held 206 at 300 s against revision 2's
  169 (+22%), holding 92% of its 60 s output over five minutes; first dry cast moved
  from 69 s to 114 s and starved GCDs fell from the high fifties to 29%. Three trances
  fit a 300 s fight; each returns roughly 660 mana at the spec's damage rate. The 60 s
  number is nearly unchanged (224 vs 231): the trance is a sustain lever, exactly as
  designed.
- **Tank: the heroic threat collapse is gone.** The Stonebound bench holds 207 TPS on
  heroic (was 124, a starvation collapse); the trance's mana return keeps the threat
  loop fed while the 30% damage reduction rides along.

# The gear-progression axis

All 19 DPS specs at four gear states, talent rows pinned to the BiS build: **naked**,
**floor** (naked plus the weakest legal melee weapon), **fresh 20** (greens and below),
**full BiS**. 60 s DPS, normal, 24 seeds, naked as percent of BiS:

| Spec | naked | fresh 20 | BiS | naked as % of BiS |
|---|---:|---:|---:|---:|
| Affliction | 160 | 164 | 238 | **67%** |
| Destruction | 194 | 213 | 288 | 67% |
| Demonology | 172 | 187 | 261 | 66% |
| Retribution | 138 | 166 | 228 | 61% |
| Beast Mastery | 114 | 123 | 199 | 57% |
| Marksmanship | 79 | 91 | 139 | 57% |
| Shadow | 98 | 106 | 178 | 55% |
| Elemental | 74 | 81 | 150 | 49% |
| Frost | 92 | 102 | 200 | 46% |
| Fire | 83 | 103 | 191 | 44% |
| Survival | 64 | 93 | 153 | 42% |
| Balance | 103 | 120 | 258 | 40% |
| Feral cat | 82 | 127 | 209 | 39% |
| Assassination | 66 | 83 | 179 | 37% |
| Subtlety | 60 | 79 | 205 | 29% |
| Combat | 56 | 80 | 194 | 29% |
| Enhancement | 59 | 94 | 224 | 26% |
| Fury | 34 | 89 | 275 | **12%** |
| Arms | 23 | 88 | 203 | **11%** |

The revision-2 shape holds: the warlock barely scales with gear, the warriors are the
mirror image (rage generation itself scales with weapon damage), and fresh-vs-naked is
nearly flat for casters while doubling melee output. The one mover is Balance, off the
top of the naked table and into the caster pack, per the re-seat above. The floor-weapon
column (a truer "nothing" than bare fists) changes no ordering: it is worth about 25
DPS to Enhancement and under 12 to everyone else.

# The zero-legendary control, in full

The same study with every legendary excluded (all six items: Thronebane and the
Deathless Heartwood staff with their heroic variants, Heart of the Rift, Voidsong
Dirk), gear and talents re-searched from scratch per spec. Normal, sorted by 60 s;
"legendary worth" is what the full pool adds back:

| Spec | 15s | 60s | 120s | 300s | Execute | Heroic 60s | OOM | full-BiS 60s | legendary worth |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Destruction (Ruination) | 286 | **290** | 251 | 185 | 320 | 263 | 190s | 288 | -1% |
| Balance (Moongrove) | 223 | **261** | 258 | 258 | 251 | 249 | - | 258 | -1% |
| Demonology (Pactbound) | 278 | **253** | 213 | 168 | 300 | 228 | 206s | 261 | +3% |
| Retribution (Dawnreaver) | 345 | **224** | 212 | 214 | 275 | 215 | - | 228 | +2% |
| Affliction (Hexcraft) | 318 | **215** | 225 | 215 | 256 | 215 | - | 238 | +11% |
| Feral cat (Wildfang) | 235 | **209** | 204 | 200 | 217 | 192 | - | 209 | +0% |
| Fury (Bloodrush) | 269 | **205** | 195 | 194 | 250 | 179 | - | 275 | +34% |
| Arms (Battlecraft) | 240 | **203** | 195 | 192 | 209 | 183 | - | 203 | +0% |
| Beast Mastery (Packlord) | 250 | **199** | 191 | 95 | 212 | 183 | - | 199 | -0% |
| Frost (Cryomancy) | 181 | **192** | 190 | 159 | 187 | 175 | 171s | 200 | +4% |
| Fire (Pyromancy) | 271 | **178** | 170 | 98 | 299 | 173 | 107s | 191 | +7% |
| Shadow (Vespers) | 174 | **175** | 177 | 179 | 176 | 173 | - | 178 | +2% |
| Enhancement (Warspirit) | 225 | **172** | 163 | 155 | 188 | 160 | 204s | 224 | +30% |
| Subtlety (Skulduggery) | 131 | **147** | 147 | 151 | 136 | 131 | - | 205 | +39% |
| Elemental (Thundercall) | 167 | **147** | 145 | 134 | 154 | 141 | 254s | 150 | +2% |
| Survival (Fieldcraft) | 152 | **146** | 138 | 81 | 150 | 132 | - | 153 | +5% |
| Assassination (Knifework) | 143 | **139** | 137 | 138 | 133 | 128 | - | 179 | +29% |
| Marksmanship (Coldsight) | 146 | **136** | 131 | 61 | 139 | 121 | - | 139 | +2% |
| Combat (Thuggery) | 143 | **132** | 132 | 132 | 139 | 121 | - | 194 | +47% |

Spread 2.19x at 60 s (290 to 132, median 192), tightening to 1.97x at 120 s, the
closest any view of the game gets to the plus or minus 15% intent. Four readings:

1. **The caster top does not move.** Destruction, Balance, and Demonology sit within
   noise of their full-BiS numbers; legendaries were never their story.
2. **The whole rogue class collapses to the bottom of the table.** Combat 132 (last),
   Assassination 139, Subtlety 147: without Thronebane the class's best spec is 45 DPS
   below the median. The new daggers win the weapon slots here and are not enough; the
   rogue baseline itself is under-tuned once the legendary is out of the picture.
3. **Fury drops 275 to 205 (second to seventh) and Enhancement 224 to 172**, the other
   two Thronebane clients.
4. The warlock OOM arrives slightly earlier epic-only (Destruction 190 s against
   210 s): less gear means less damage per mana spent, not more longevity.

---

# Healers

Same bench as the prior revisions (tank swing plus raid pulse, ~136 incoming DTPS
normal, ~242 heroic, 180 s, five to keep alive). Normal pressure:

| Healer | HPS | Absorb/s | Total/s | Overheal | Deaths | Dry at |
|---|---:|---:|---:|---:|---:|---:|
| Restoration shaman | 124 | 0 | **124** | 23% | **0.3** | never |
| Holy paladin | 117 | 6 | **122** | 41% | **0.3** | 172s |
| Restoration druid | 122 | 0 | **122** | 16% | 5.6 | 167s |
| Holy priest | 94 | 0 | **94** | 40% | 15.9 | 93s |
| Discipline priest | 51 | 36 | **87** | 17% | 18.4 | 81s |
| Arcane mage | 56 | 0 | **56** | 21% | 33.7 | 87s |

**The revision-2 restoration druid "regression" was never a sim bug, and the bisect it
asked for is unnecessary.** Replaying revision 2's druid build under the current sim
reproduces revision 2's numbers exactly (86 HPS, 22 deaths); this run's fresh support
search reads 122 HPS with 5.6 deaths on the same sim. The revision-2 support search had
left the healer on the Berserk DPS capstone where this run's takes Tranquility, plus four
gear-slot differences: greedy-search noise, not a repair regression. Two lessons ship
with this finding: restoration druid is actually the third healer that can hold a group
on normal, and support builds need the same build-reconciliation pass the DPS tiers get
(adopted into the method from this revision on).

Elsewhere the shape holds: restoration shaman and (since the solarReprisal repair) holy
paladin are effectively perfect on normal, both priests still run dry around 90 s
pointing at the priest pool, and Chronomancy slid further (68 to 56 total, worst-healer
seat, its loop remains the least trustworthy in the harness). Heroic remains uncoverable
by any single healer (best 159 against 242 incoming).

# Tanks

| Tank | Pool | Armor | DTPS n/h | Survival n/h | Threat/s n/h | DPS |
|---|---:|---:|---:|---:|---:|---:|
| Ironguard warrior | 2562 | 3094 | **98 / 165** | 26.5s / 15.6s | 164 / 156 | 60 |
| Faithwarden paladin | 2698 | 3436 | 126 / 238 | 21.5s / 11.4s | **704 / 693** | 153 |
| Stonebound shaman | 1833 | 3784 | 177 / 305 | 10.5s / 6.0s | 219 / 207 | **107** |
| Wildfang bear | 2256 | 4495 | 204 / 339 | 11.1s / 6.7s | 176 / 159 | 77 |

The order holds (Raised Guard keeps the warrior a class apart, the paladin trades intake
for 4x threat), but the Stonebound story changed twice:

- **The creature crit immunity works.** Stonebound's largest observed heroic hit is now
  1,322 against its 1,833 pool (72%): a hard hit, no longer the literal one-shot of
  revision 2 (1,958 against 1,933, 107%). Its normal intake dropped 197 to 177 DTPS.
- **The trance fixed its heroic threat.** 207 TPS on heroic against revision 2's
  starvation collapse to 124. Stonebound is now a genuine normal-mode fourth tank that
  degrades on heroic instead of failing outright; it also now out-threats the bear on
  both difficulties while keeping the highest tank DPS in the game.

---

# Cross-cutting findings

1. **The targeted fixes all landed, and none overshot except possibly Assassination.**
   Wicked Slash normalization (-42%, first to fifteenth), the warlock sustain re-tune
   (-14% Affliction with its economy intact), the Feral trim (-10%), the Balance
   re-seat (gear scaling repaired), Elemental Trance (+22% at 300 s, heroic tank threat
   fixed), Stonebound crit immunity (one-shot gone). Assassination at 179, below the
   median with 61% idle GCDs, is the one that may want a partial walk-back.
2. **Thronebane's `hand` field is still unset after three studies.** The normalization
   demoted it from ability amplifier to white-damage stat stick, but it is still worth
   +29 to +47% to five specs in the epic-only comparison and it still decides the top
   rogue. One line plus a re-band.
3. **The 300 s cliff is the game's dominant imbalance now** (spread 4.94x at 300 s vs
   2.07x at 60 s). Members: Marksmanship 54 (no focus lever exists on its tree),
   Beast Mastery 85, Survival 84, Fire 108, then the warlock pair at 172/197. The
   sustain-objective builds recover only 18 to 29 DPS for the hunters; kit changes, not
   tuning, remain the answer there.
4. **The resource axis health check:** Balance, Affliction, Retribution, Shadow, and
   both war-resources (Arms, Fury) are healthy; Beast Mastery still caps its focus 57%
   of the fight (income thrown away); the energy rogues now all sit around 40% starved
   (the tamed Thronebane engine moved Combat and Subtlety from cap-starved to
   income-starved); Destruction (49%), Demonology (37%), Enhancement (29%) still starve
   on mana.
5. **The heroic step still taxes melee, not casters.** Elemental literally ties its
   normal number (its BiS is hit-capped and nature damage ignores armor); Destruction,
   Fire, Frost, Shadow, Affliction all lose 2 to 3%; the melee cluster loses 8 to 13%.
6. **Kill-time cost of comp** (7 DPS at these curves): the best seven burn normal
   Nythraxis in 31 s and heroic in 124 s; the worst seven need 50 s and 204 s. The
   best-seven set is warlock x3, Fury, Balance, Retribution, Enhancement.

# Suggested order of work

Reconciled against revision 2's list:

1. **Thronebane `hand` field** (rev-2 item 1, still open, third study running): the
   normalization made it cheaper to fix (the ability amplification is gone; what remains
   is a legal offhand legendary with a two-hander's weapon budget). `hand: 'mainhand'`
   plus the re-band, as originally specified. The zero-legendary control adds one
   warning: fix it alone and all three rogue specs land at the bottom of the table
   (132 to 147), so the fix should ship together with the rogue base look in item 2.
2. **Assassination's seat** (new): 179 at 60 s, 61% idle, 40% energy-starved, auto
   attack 60% of damage. If the intent was pack-level, it landed low; a modest energy
   income or Wicked Slash coefficient bump (1.7 to ~2.0 dagger) would lift it without
   re-opening the runaway.
3. **Warlock mana past 120 s** (rev-2 item 2, moved eleven seconds, not fixed):
   Demonology and Destruction still lose a third of their damage by 300 s. The re-tune
   proved the levels can be moved without touching the loops; the loop itself (a Ruin
   or Fragment mana rebate) is what is missing.
4. **Warlock gear scaling** (rev-2 item 3, unchanged): naked warlocks still do two
   thirds of their BiS output. Same suggested shape: a small spell-power rider on
   Sentence and the servants, base re-banded down.
5. **Restoration druid bisect** (rev-2 item 4): CLOSED, no sim change existed; it was
   support-search noise. Method fix adopted instead: support builds now go through
   build reconciliation like the DPS tiers.
6. **The standing kit items** (rev-2 item 5, unchanged): Marksmanship has no sustain
   lever, Survival and Beast Mastery focus regeneration does nothing, the priest mana
   pool, bear percentage mitigation, and now Chronomancy (56 total throughput, worst
   healer, loop least trusted; it needs an owner before it needs numbers).

# Confidence and known limits

Rotations engine-derived per spec; the reconciliation pass replayed every revision-2
build under the current sim so no spec's move is search noise, and the Assassination
paired-dagger A/B closed the one pair-synergy hole single-slot greedy search cannot see.
Known soft spots, carried forward deliberately: the inert dummy understates Affliction
in a real raid (the uncapped enemy-action Condemnation source and hex_of_violence both
read zero on a target that never acts); Elemental's heroic immunity is a hit-cap plus
armor-ignoring-school artifact of its BiS, not a kit property at all gear levels;
Destruction and Balance read marginally higher epic-only than full BiS (within greedy
noise, the reconciliation keeps whichever measured higher per tier); healer and tank
loops remain hand-authored; and support builds before this revision were un-reconciled
(the cause of revision 2's phantom druid regression).
