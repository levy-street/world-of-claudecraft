# Set bonuses: FINAL (post three adversarial rounds)

Canonical state of all 58 bonuses. Provenance: round-1 review of the
original drafts (docs/prd/ignivar-set-bonus-review.md), a main-loop
redesign, six per-class round-2 verifications, and two round-3 delta
verifications. Items marked [R3-PENDING] are v4 redesigns awaiting the
final targeted verification; everything else carries a CONFIRMED or
NIT-applied verdict. Caster and healer 2-pieces end with the pushback
rider "Damage taken no longer delays your spellcasting."; marked [rider].
"Same-change" lists are copy/test obligations; symbolic test pins
(expect(CONST)) survive wearer-scoped bends and are NOT re-pinned.

## Warrior

- Slagbreaker 2pc: "Redhand empowers your next Maiming Strike by 30
  percent per stack instead of 20." [buffPct 0.5 on overpower selfBuff;
  cap 2 untouched. Same-change: classes.ts:861 copy + stale overpower
  catalog entry + locales.]
- Slagbreaker 4pc: "Casting Redhand reduces Breachmaker's remaining
  cooldown by 3 sec." [castNth n:2 (parallel recharge sustains ~1 cast
  per 2.5s) + cooldownRefund; breachmaker outside Colossal Might's set.]
- Emberfury 2pc: "Your Enrage lasts 6 sec instead of 4." [durationFlat +2
  on both enrageChance effects via a one-line rewrite-list extension.
  Disclosed: Enrage carries +25 percent attack speed, a haste-to-swings
  rage-income coupling (autos only, damage.ts:1122-1129) watched in
  tuning. Same-change: "for 4 sec" copy x2 + locales.]
- Emberfury 4pc: "Bloodletting always Enrages you, and its healing rises
  to 8 percent of your maximum health." [selfHealPctMax 0.03 to 0.08;
  chance override is bespoke (no surface field; at chance 1 the roll is
  SKIPPED, so wearers legitimately shift the rng stream - disclosed for
  seeded suites). R3 corrections: with the 2pc this is EXACTLY 100
  percent Enrage uptime (6s buff on a 6s cooldown pressed on cooldown) -
  the declared set fantasy; furious_mending is a FLOOR (max(pct, 0.2)),
  so the 4pc is inert inside that 10s window, stated honestly.
  Same-change: "30 percent chance" copy x3 + "3 percent" copy + locales.]
- Forgewall 2pc: "Iron Resolve converts rage at 5 absorb per point
  instead of 4." [absorbSpentResource mult; one-line scaleEffect
  extension; no cross-class collateral. Same-change: "4 damage per rage"
  copy x2 + locales.]
- Forgewall 4pc: "Casting Shieldcrack reduces Iron Resolve's remaining
  cooldown by 2 sec." [2 not 3: Colossal Might compounding at 3 drove
  the effective cooldown under the 10s absorb, destroying the undrained
  remainder via same-id refresh.]

## Paladin

- Dawnforged 2pc [rider]: "Beacon of Light copies 55 percent of your
  direct heals." [BEACON_HEAL_FRACTION 0.5; TWO readers bend together
  (heal.ts:182 arithmetic + the aura value mirror). Same-change: copy +
  locales.]
- Dawnforged 4pc (final-round redesign): "Radiant Resonance's empowered
  Dawn's Embrace is instant." [The armed proc's spend choice widens to the instant
  heal-or-nuke button; replaces the second-beacon idea (round 3: not
  single-module, forbidden beacon-to-beacon transfer channel, singleton
  test pin + copy). Verify: the RR empower's ability scoping mechanism
  and that solar_invocation resolves both arms under it; no row overlap.]
- Oathpyre 2pc: "Vowkeeper Strike's chance to arm Solar Reprisal rises
  to 30 percent, and blocking an attack arms it 40 percent of the time."
  [Set-flag call-site bends (constants are test-pinned literals, pins
  are symbolic + literal: re-pin only the literal ones); no-ICD
  overwrite soft cap disclosed. Same-change: tooltip x2 + locales.]
- Oathpyre 4pc: "Consuming Solar Reprisal shields you for 6 percent of
  your maximum health for 10 sec." [R3 corrections applied: the consume
  set is THREE abilities (sunward_disc, hammer_of_grace, holy_light -
  Mending Light casts also consume, disclosed as a deliberate shield
  route); fixed aura id so the three consumers refresh ONE absorb;
  raised 4 to 6 percent (round 3: 4 was the weakest tank 4pc, cadence
  sits at the 10s duration); no paladin harness exists - band claims
  unmeasurable, flagged.]
- Zealfire 2pc: "Final Edict and Dawnfall cut each other's remaining
  cooldown by 3 sec instead of 2." [Fixpoint sizing verified in band.
  Same-change: two "2 sec" descriptions + locales; symbolic pin stays.]
- Zealfire 4pc (final-round CONFIRMED): "Hammer of Wrath cast under Dawn's Wrath
  strikes 40 percent harder, up from 20." [R3 impl: DAWNS_WRATH_DAMAGE_
  MULT has two readers (aura value written at grant; the Hammer bend at
  :86) - the fix bakes the wearer's mult into the aura value at grant
  and makes :86 read the aura, so the HUD's dynamic {pct} print stays
  honest for every wearer. Multiplicative with Ascension's 1.3 (1.82
  total) disclosed. Same-change: "20 percent more damage" copy + the
  description string pin (:68) + locales. Verify the aura-read refactor
  claim.]

## Hunter

- Packlord 2pc: "Pack Command's cooldown is reduced to 3 sec."
  [cooldownPct -0.25. R3 arithmetic (third correction): three casts span
  TWO cooldown intervals + the fixed 8s frenzy lockout, so the cycle is
  ~17.5s to ~15.5s = ~+13 percent Unleash cadence. Dead inside Howling
  Rage (12s per 90s), accepted.]
- Packlord 4pc: "Pack Command's chance to reset Stampede's cooldown
  rises to 30 percent." [+21.2 percent reset rate under the bad-luck
  cap, independently reproduced. Same-change: tooltip "20 percent ...
  after 5" + locales; the cap pin asserts base behavior, no re-pin.]
- Coldsight 2pc: "Measured Shot restores 5 additional Focus." [Named
  module hook AFTER the Cold Focus absolute rewrite (25/35; with
  Harrier 38/53 disclosed); no flat-resource key exists and addEffects
  would double-map. Same-change: classes.ts:7381 copy.]
- Coldsight 4pc (final-round CONFIRMED): "Long Draw critical strikes extend Cold
  Focus by 2 sec, up to 6 sec per window." [R3 honest numbers:
  in-window Long Draw is 1.4s (baseline castPct -0.2 THEN the 0.7
  window mult), ~8 casts per window, so ~2 crits = +4s = +33 percent
  typical extension (not 50); rapid_fire outranks aimed_shot in the
  probe (disclosed); the extension also extends the 2pc's in-window
  focus rewrite (intra-set compounding, disclosed). Crit plumbing is
  one argument at the shared block scope. Apex Instinct re-derivation
  stays same-change.]
- Slagsnare 2pc: "Gutting Strike generates 20 Focus." [Module-constant
  bend at the grantHunterFocus site; riders apply after (preResolved
  false). Same-change: "restores 15 Focus" copy + locales.]
- Slagsnare 4pc: "Woundrend that consumes 3 Hunting Momentum preserves
  them. Cannot occur more than once every 8 sec." [Scoped to the
  Woundrend consume site only; the 8s ICD MATCHES the Momentum window
  by construction (R3 wording fix; refresh sites are :197/:227, the
  :222 line is the wound); Re-entry payoffs stay at 3-stack value
  (disclosed); the build turns focus-hungry, fed by the 2pc.]

## Rogue

- Cinderfang 2pc: "Venom Ritual's energy refund rises to 20 per builder."
  [VENOM_STAGE_REFUND 15, readers :198/:224. R3 semantics: the refund is
  per qualifying BUILDER CAST (unconditional at the stage cap) and the
  Wicked Slash fallback is excluded by the anti-Thronebane guard
  (non-dagger builds feel nothing, disclosed); ~11 percent cost cut on
  the spec's most expensive builder - clears the dribble bar.]
- Cinderfang 4pc: "Venom Dart's cooldown is reduced to 4 sec."
  [cooldownFlat -4 (negative verified). R3 honesty: the dominant effect
  is the ENERGY economy (dart is net 10 vs Craven Thrust's net 45; a
  5-combo cycle drops ~18 percent energy = ~+20 percent finisher
  cadence, compounding with the 2pc - stated); ~a third of each wound
  extension overcaps at the 20s pin (disclosed); stages-per-cycle
  unchanged so the 6-vs-5 alternation is structurally intact.]
- Smolderstrike 2pc: "Haymaker hits 20 percent harder." [dmgPct 0.2 on
  body_blow; DELIVERED +17.2 percent (additive accumulator with the
  0.16 global, stated). Load-bearing impl fact: the transform re-bake
  at sim.ts:6074 is what makes ability mods reach a transformed
  weaponStrike at all.]
- Smolderstrike 4pc: "Lights Out refunds 6 sec of Mirrored Blades'
  remaining cooldown." [Unconditional; effective cooldown ~89s (R3
  arithmetic); refunds landing while off cooldown are dropped
  (talent_procs guard), disclosed.]
- Ashveil 2pc: "Lurker's Strike hits 25 percent harder." [dmgPct 0.25 on
  ambush; DELIVERED ~+20 percent (same accumulator as the baseline
  0.16 + global 0.08, stated); the in-veil double multiplies the scaled
  weapon component.]
- Ashveil 4pc (final-round CONFIRMED): "Your Veiled Edge strike hits for triple,
  up from double." [VEILED_EDGE_BONUS 1 to 2, value baked into the edge
  aura at arm time (wearer-known); consumeVeiledEdge already returns
  1 + edge.value so the read is dynamic. Replaces the second-edge idea
  (round 3: whole-aura splice cannot hold charges, the test premise
  inverts, singular HUD copy, the probe never presses a second strike
  and it costs full energy). Same-change: the "strikes for double"
  hudChrome string goes dynamic + the :407 threshold rises + locales.
  Verify the value-bake claim and the HUD string route.]

## Priest

- Creed 2pc [rider]: "Your Doctrine link converts 10 percent more of
  your Holy damage into healing." [Additive on both twin branches;
  snapshot-at-placement (old links keep old rate up to 30s) and the
  0.15 no-link fallback untouched, both disclosed. Same-change: three
  printed sources + the Twin Covenant metrics row + locales.]
- Creed 4pc: "When your Psalm of Warding is fully consumed, your next
  Scouring Hymn within 10 sec is instant. Cannot occur more than once
  every 15 sec." [shieldConsumed trigger at damage.ts:574-577; icd is
  NEW LOGIC there (castNth-shaped machinery does not cover it), scoped
  small.]
- Benison 2pc [rider]: "Seraphic Vigil's rescue heals for 270, up from
  180." [buffPct 0.5 reaches buffTarget value; heal_echo is in neither
  the integral nor scalable kind sets, so 270 exact and flat.
  Same-change: the printed "180" in the ability description + catalog +
  locales (R3 catch).]
- Benison 4pc (final-round CONFIRMED): "When Seraphic Vigil triggers, its ally is
  also mended for 15 percent of their maximum health over 10 sec."
  [Bespoke HoT at the vigil-trigger site in damage.ts (the
  priestOnVigilTriggered hook is talent-gated for Incarnate Spirit; the
  set arm hooks the same trigger point, not that function). Replaces
  the cooldown-reset idea (round 3: Twin Covenant's charge model
  deletes the cooldowns entry, making cooldownRefund a hard no-op).
  Verify: the trigger point, HoT application shape, no row overlap,
  Twin Covenant coexistence.]
- Vesperash 2pc [rider]: "Call Tithefiend's cooldown is reduced by 6
  sec." [Sink acceleration; the bank still saturates ~13s of every 24
  (honest); +25 percent full-strength fiend windows.]
- Vesperash 4pc: "Calling your Tithefiend resets Mindfracture's
  cooldown, and the fiend returns twice as much mana per hit."
  [Round-2 CONFIRMED; call-site multiplier (constant test-pinned).
  Same-change: "1 percent maximum Mana" copy + locales.]

## Shaman

- Stormkindled 2pc [rider]: "Unleash Weapon on Pyrebrand grants 3
  Thunder." [Constant bend; probe never presses Unleash (probe gap,
  gains a press); 3+ banked overcap partial waste disclosed.
  Same-change: "gain 2 Thunder" copy + locales.]
- Stormkindled 4pc: "Earthen Jolt's bonus per Thunder rises to 30
  percent." [Full vent 2.25x to 2.5x; multiplies with Primal Mastery
  (3.125x in-window, disclosed). Same-change: two "125 percent" totals
  + locales.]
- Warspirit 2pc: "Ancestral Strike advances your cadence 3 steps."
  [Round-2 CONFIRMED; steps widened + call-site; Exaltation clamp and
  Deep Reservoir currency-sharing disclosed. Same-change: two stale
  tooltips.]
- Warspirit 4pc (final-round CONFIRMED): "Ancestral Strike hits 30
  percent harder." [impl dmgPct 0.48 so the DELIVERED number is the
  printed 30 against the 0.6 additive baseline]
  [dmgPct 0.3 on stormstrike (additive with the baseline 0.6 -
  delivered increase stated at implementation). Replaces the echo-count
  and echo-damage ideas (round 2/3: both constants feed the same static
  HUD descriptor and printed copy). Verify: delivered arithmetic,
  printed stormstrike numbers, no row overlap.]
- Stonehearth 2pc: "While Stonebound, Stormcast Mending Waters costs no
  mana and heals 25 percent more." [R3 corrections: the ability's real
  display name is Mending Waters; the saving is the 58 remaining after
  Stormcast's half-cost (honest); the Stormcast spend is a real choice
  against the instant Arc Bolt (the tension); consume-order impl note
  (zeroing cost early leaves the cheap aura alive); Elemental Trance
  dead-window and the no-rotation probe disclosed. Same-change: "cost
  50 percent less Mana" copy + locales.]
- Stonehearth 4pc: "While Stonebound, completing a cadence heals you
  for 3 percent of your maximum health." [Round-3 CONFIRMED; heal not
  absorb (distinct from Living Weapon's arm at a different site);
  Exaltation completion-rate spike disclosed; magnitude derivation
  (~1 percent max HP per sec at a ~3s completion rate) flagged as
  swing-rate dependent.]
- Springmender 2pc [rider]: "Tidecall's cooldown is reduced by 4 sec."
  [R3 honesty: Tidecall holds 2 PARALLEL-recharging charges, so this is
  +50 percent Tidecall throughput, stated; Deep Reservoir's Lifespring
  arm amplifies (disclosed, not duplication); pressed in the healer
  probe; no printed cd literals.]
- Springmender 4pc: "Cascading Mend reaches a fourth ally and harvests
  Mending Currents at 150 percent." [jumps bespoke bend (no primitive);
  1.5 scoped to the chain path (Unleash keeps 1.25); fourth-hop harvest
  at full pool value. Same-change: "2 allies"/"125 percent" copy +
  locales.]

## Mage

- Chronoweave 2pc [rider]: "Temporal Echo converts 50 percent of your
  single-target Arcane damage into healing." [Bake at placeTemporalEcho
  writing value + echoConvertRate + the echoRateFor fallback (three
  readers); classifier boundary safe at 0.5; echoHps<80 band re-signs.
  Same-change: dev playtest literal + comment.]
- Chronoweave 4pc (final-round CONFIRMED; set renamed Aetherweave
  Vestments, the old name collided with the arcane mastery): "Temporal Cascade's cooldown is reduced
  by 5 sec." [cd 17 to 12: more group-mark windows; touches no rate
  constants, no classifier, no wire (replaces both killed shapes: the
  Aether proc raise re-tuned a derived cost; the group-rate raise
  needed a wire change). Verify: cascade cd literal site, any printed
  cd, row overlap, probe reality.]
- Pyroclast 2pc [rider]: "Scald always critically strikes targets at or
  below 50 percent health." [Sole functional reader; the reference
  rotation never presses Scald AND both fire harnesses fight a 1e9-HP
  dummy, so an execute-phase harness case is a same-change obligation;
  magnitude honestly restated (a free instant Pyrelance ~every 4.5s +
  100 percent-crit Ignite feed across the bottom half) - the set
  centerpiece, tuning-flagged.]
- Pyroclast 4pc: "Your Fire spells' critical strikes outside Phoenix
  Trance reduce its remaining cooldown by 2 sec." [Honest trigger
  wording (builders only, outside-Trance, Meteor/Ignite pay nothing);
  ~+10 percent Trance frequency alone; the 2pc+4pc execute-phase
  compounding is unmeasurable today (same harness case); Ignite 0.3
  share ceiling re-sign added to the 1.25x obligation.]
- Frostquench 2pc [rider]: "Rimelance critical strikes bank a second
  Icicle, up to the maximum of 5." [Crit observed via the noteSpellHit
  seam (the cited bank site cannot see it); cap untouched and
  load-bearing (three hardcoded readers); Frozen Orb dead zone
  disclosed.]
- Frostquench 4pc: "Winterlash plants 3 Winter's Chill charges, up from
  2." [Dynamic HUD prints; Fingers-priority suppression, Glacial Spike
  GCD contention (one to two Lances realistic), and Rimelance
  displacement all disclosed as honest limits. Same-change: "next 2
  incoming" copy + locales.]

## Warlock

- Hexthread 2pc [rider]: "Needle of Fate grants 2 additional
  Condemnation." [Inline literal at affliction.ts:497 via eyeGeneration
  (x0.5 secondary eyes with ROUNDING: +1 pays zero there, +2 survives;
  x2 under Hour of Judgment, disclosed); income lift on the needle
  source only. Same-change: probe literal + "generates 7" copy +
  locales (fr/tr already drifted).]
- Hexthread 4pc: "Passing Sentence refunds 10 Condemnation." [Refund at
  the post-consume site, additive with Hour of Judgment's one-per-90s
  charge (near-moot overlap, stated); pair flagged as the tuning
  pass's first shave.]
- Gravebrand 2pc [rider]: "Reaping Command's cooldown is reduced by 2
  sec." [Honest claim: +33 percent Reaping Commands, cooldown-bound in
  the probe; the fragment bank stays pinned (not "breathes"); no
  cooldown leak (rider aura ids, pinned).]
- Gravebrand 4pc: "Reaping Command's unison strikes deal 25 percent
  more damage." [Round-3 CONFIRMED with the corrected cite: damage is
  reapingDamage with exactly one caller, so the multiplier scopes to
  command strikes and carries into the cleave; no printed numbers.]
- Ruincaller 2pc [rider]: "Conflagrate holds 3 charges." [Parallel
  recharge = up to +50 percent throughput, net reduced by Burning Pact
  self-burn and Desolation overcap (both disclosed). Same-change:
  "Holds 2 charges" copy x2 + two literal test pins + locales.]
- Ruincaller 4pc (final-round CONFIRMED): "Ruinbolt strikes 20 percent harder."
  [dmgPct 0.2 on chaos_bolt. Replaces the per-Desolation shape (round
  3: Desolation is consumed at cast-commit BEFORE damage computes, so
  the read pays N-1 and zero at one stack; plus reward-inversion).
  Verify: delivered arithmetic vs the 0.1 spellDmgPct baseline, printed
  Ruinbolt numbers, no row overlap.]

## Druid

- Moonscorch 2pc [rider]: "Moonseed may extend Lunar Tempest twice per
  application, to a maximum of 12 sec." [maxBonus 6 to 12 under the
  per-application extendedBy semantics; third press still dead
  (honest). Same-change: "up to 6 sec" copy x2 + locales.]
- Moonscorch 4pc: "Moonsurge and Sunwake strike 25 percent harder."
  [Round-3 CONFIRMED: dmgPct reaches both arms incl Sunwake's burn via
  the dot path; fork preserved (the free-Moonsurge idea died on
  Sunwake's true net -10); mild Moonsurge tilt noted.]
- Wildfang 2pc: "Redharvest restores 45 energy, up from 30." [Rank-3
  truth (22/33/45 by rank); flips the button energy-positive; no stale
  literal.]
- Wildfang 4pc: "Redharvest plants a fresh Flense on the target." [Not
  double-billing (cashed ticks were removed); the replant is aura-only
  (no combo, no landing bank - tooltip must not overclaim); Blooddrunk
  tick-banking makes the finisher self-sustaining for that row
  (prominent tuning flag).]
- Cinderbark 2pc (final-round redesign): "Sweeping Claws has a 30
  percent chance to bank an additional Old Blood." [A hold-versus-spend tension
  against the 4pc (bank sits 0-3); replaces the Sweeping Claws damage
  idea (round 3: authored base is 12-15 and the AP rider is unreachable
  by dmgPct - filler) and the Bonecrush idea (never pressed as
  Bonecrush). Verify: a bespoke DR read of old_blood stacks in bear
  form, no collision with bear DR sources, HUD implications.]
- Cinderbark 4pc: "Marrowbreak hits 30 percent harder, and its
  emergency guard no longer replaces the strike." [Round-3 CONFIRMED:
  the replacement lives at ONE site (the directDamage break); restoring
  the strike also restores its threat (flat 110 mult 2 - the swing
  stated); guard values and the 8s hardcode verified. Same-change: the
  "instead shields" copy + catalog + locales + the snap-threat probe
  pin.]
- Grovespring 2pc [rider]: "Swiftmend consumes only your own Wildbloom
  or Second Bloom and heals 25 percent more." [With the EXPLICIT
  fallback: prefers your own, falls back to any HoT when you have none
  (round 3: strict narrowing turned a paid cast into a silent no-heal);
  the +25 is a bespoke eff.heal bend (the generic mult reaches only the
  healPower rider).]
- Grovespring 4pc: "Overbloom harvests 75 percent of your remaining
  effects and banks 1 Verdance afterward." [Round-3 CONFIRMED:
  setBank(current+1) DIRECTLY (not addStage - which would silently pay
  Quickening's mana rider) placed after the Nature's Echo seed
  (additive beside it, not a clone); replant NOT routed through the
  planted hook (Seedspread self-arming avoided). Same-change: two
  60-percent copies + locales.]
