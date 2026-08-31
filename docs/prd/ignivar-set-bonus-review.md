# Set bonus adversarial review: verdicts

## Status

The full adversarial verification of all 58 proposed tier-set bonuses
(docs/prd/ignivar-raid-loot.md, "The 29 tier sets"), run 2026-08-28 at
the maintainer's direction after two drafting errors surfaced. Nine
independent reviewers (one per class) decomposed every bonus into its
factual claims and tried to refute each against the live sim, the
choice rows, the reference rotations, and the render contracts, plus a
usefulness lens: a bonus is refused if a competent player would not
feel it in an ordinary fight.

Result: 7 of 58 survive as designed, roughly 17 need rewording, and the
rest need redesign. The bonus tables in the plan doc and the item
catalog are UNDER REDESIGN against this review; do not implement from
them until the rewrite lands.

## Verdict table

Severity: FINE (ship after the noted nit), REWORD (mechanic sound,
wording or numbers wrong), REDESIGN (premise, hook, or economy broken).

| Set, tier | Verdict | Core finding |
|---|---|---|
| Slagbreaker 2pc | REDESIGN | third Redhand charge is dead against the 2-stack empower cap (effect_dispatch) and revives the deliberately re-cut Double Charge burst pattern |
| Slagbreaker 4pc | REDESIGN | vs-dotted arm never reaches weaponStrike (silent no-op); the CDR arm duplicates and uncaps the Colossal Might capstone on the same ability |
| Emberfury 2pc | REWORD | base rage is 12; "while Enraged" has no expressible trigger; hands back the v0.27.1 Fury rage nerf |
| Emberfury 4pc | REDESIGN | "spending 80 rage" is vacuous (flat cost); half-redundant with the always-on cleaving_blows refund; no Enrage-extension primitive |
| Forgewall 2pc | FINE | Iron Resolve 4 to 5 absorb per rage; needs a one-line scaleEffect extension |
| Forgewall 4pc | REDESIGN | block is a 5 percent event (~0.075 rage per sec); Revenge is an uncapped frontal AoE with no target count; "made free" is invisible to the proc engine |
| Dawnforged 2pc | REDESIGN | factually true but a raid no-op: the 2-ally threshold is met on virtually every raid cast |
| Dawnforged 4pc | REDESIGN | Devotion generation is hard-blocked to zero during Ascension, so per-charge refunds pay 0 four times in five; the Radiant Resonance condition is consumed before the heal resolves |
| Oathpyre 2pc | REDESIGN | the "after a block" sequencing does not exist; honest shape is the two-constant bend (20 to 30 on strike, 25 to 40 on block) |
| Oathpyre 4pc | REWORD | bounce 2 to 3 is clean; the per-impact absorb REFRESHES instead of stacking and the extra impact silently grants +1 Devotion per cast |
| Zealfire 2pc | FINE | Dawn Rhythm paired reduction 2 to 3 sec; single exported constant |
| Zealfire 4pc | REDESIGN | display name is Verdict of the Sun God; a 2-charge Verdict breaks the hardcoded 3-wedge telegraph and its imminent pulse; the Devotion grant is dead during Ascension |
| Packlord 2pc | REDESIGN | pet crit is a hardcoded flat 5 percent (cannot scale with the set's own crit); the extra stack is capped away and dead during Howling Rage |
| Packlord 4pc | REDESIGN | frenzy-to-12 already ships under Howling Rage empowerment (its tooltip says so verbatim); the name is Howling Rage, not Bestial Wrath |
| Coldsight 2pc | REWORD | Cold Focus rewrites the amount absolutely (equals 30), so +5 evaporates inside the window; delivered value would be 25 outside, 30 inside |
| Coldsight 4pc | REDESIGN | names are Long Draw and Fevered Draw; targeted channels cannot gainResource (silent no-op); 30 focus is +50 percent of the class's entire passive income |
| Slagsnare 2pc | REWORD | numbers and hook are right; the wound condition is near-unconditional in rotation (dressing on a flat +5) |
| Slagsnare 4pc | REWORD | sound, but "spent at 3" excludes two of the three consume sites, the 45 percent is a follow-up hit not a multiplier, and the 10s limiter mismatches the 8s Momentum clock |
| Cinderfang 2pc | REDESIGN | the combo-point clause is a verified no-op (Venom Dart already awards one); the extension is worth under 1 percent |
| Cinderfang 4pc | REDESIGN | the wound has no stages; the sane reading (ritual restarts at 2) recreates the owner-playtested-away permanent-Venomrend failure mode |
| Smolderstrike 2pc | REDESIGN | the window already has 4 sec of slack; +2 sec removes the cash-out-early tension and adds no power |
| Smolderstrike 4pc | REWORD | the refund lands but ~20 sec per ~17-sec cycle roughly doubles Mirrored Blades uptime; the energy clause is imperceptible filler |
| Ashveil 2pc | REDESIGN | dead in the reference build (openers need stealth; in-veil banking is guard-blocked) and degenerate with the Cheap Trick row |
| Ashveil 4pc | REWORD | the second Veiled Edge is the best clause in the whole set (tests document the missing second press); "opened at 3 Gloam" is vacuous and 9 sec revives the measured 217-dps Dusk Economy exploit |
| Creed 2pc | REDESIGN | Twin Covenant's 0.7 is a separate literal branch, so the likeliest raid build sees a blank bonus; "your damage" overclaims (holy Smite and Scouring Mercy only) |
| Creed 4pc | REWORD | shieldConsumed trigger exists but has no icd and empowerNext cannot carry instant AND free in one proc; in practice the shield never lapses, so this reads as permanent |
| Benison 2pc | REWORD | real throughput gain, but it SPENDS the death-save earlier (converts a clutch save into an auto-fire trickle) and it is single-target |
| Benison 4pc | REWORD | the cost half is clean; there is no scoped per-ability haste primitive for "casts 30 percent faster" |
| Vesperash 2pc | REDESIGN | the Gloomtithe bank is DoT-saturated at 5 in ordinary play; the second stack lands in a Math.min |
| Vesperash 4pc | FINE | drop the vacuous "at 5" wording; the display name is Call Tithefiend; mana doubling must be a call-site multiplier (the constant is test-pinned) |
| Stormkindled 2pc | FINE | 2 to 3 Thunder on Pyrebrand unleash; fix the "gain 2 Thunder" line in the Unleash Weapon copy |
| Stormkindled 4pc | REWORD | duplicates Living Weapon (full-vent instant bolt) and half of Deep Reservoir; must share the aura id or state the stack; scope to Earthen Jolt only |
| Warspirit 2pc | FINE | cadence 3 steps is coherent with carry clamping; the payoff is +1 banked step, and Stormcast refresh-overwrite limits it; two tooltips go stale |
| Warspirit 4pc | REDESIGN | the echo half points at a hook with no target and no weapon damage in scope (and the consuming cast can be a heal); re-point at cadence completion |
| Stonehearth 2pc | REDESIGN | the premise is invented: Stonebound has no damage penalty (the 15 percent is damage-TAKEN reduction, a benefit) |
| Stonehearth 4pc | REDESIGN | no absorb accumulate-and-cap primitive exists; no duration stated; sits beside Living Weapon's 8 percent Stonebound absorb; at cadence speed it is a permanent +12 percent health stat |
| Springmender 2pc | REDESIGN | the 30-percent-of-max-HP pool cap silently eats the bigger deposit on most targets |
| Springmender 4pc | REWORD | the fourth hop heals 12.5 percent (falloff) but harvests at FULL pool value, so it is strong for the wrong stated reason; the 1.5 multiplier leaks to Unleash Weapon unless scoped |
| Chronoweave 2pc | REWORD | real and felt; must disambiguate individual vs Cascada group marks (a literal read is a 3.8x group buff) and bake at apply time with the value mirror |
| Chronoweave 4pc | REDESIGN | "at 4 charges" is the state the cost curve, harness, and HUD glow all train the player to avoid; plus a roll-order off-by-one |
| Pyroclast 2pc | REDESIGN | (the replacement died too) refill-all is a no-op for bank-for-Trance play and a probable 1.25x parity break for filler play; reverses a test-pinned designer rule |
| Pyroclast 4pc | REDESIGN | Hot Streak provenance does not survive projectile flight; Ignite folds into one shared bank so "its Ignite" does not exist |
| Frostquench 2pc | REWORD | sound and felt; state the cap and the Frozen Orb dead zone (orb saturates the bank for 8 sec per 45) |
| Frostquench 4pc | REDESIGN | 2 Fingers routinely overcap; the CDR targets a cooldown Brain Freeze already erases; clause 1's own root and Fingers suppress clause 2 |
| Hexthread 2pc | REDESIGN | (the replacement died too) the Gaze damage is +1 DPS; the Condemnation half is ICD-capped, boundary-fragile, and exactly zero for the ally-linked accomplice a raider runs |
| Hexthread 4pc | REWORD | the refund is ~+33 percent Sentence throughput (overtuned) and stacks with Hour of Judgment; both conditions are vacuous; 6-to-8 wording is ambiguous |
| Gravebrand 2pc | REDESIGN | Soul Fragments are pinned at cap all fight (income 0.55 per sec vs sinks 0.32 per sec); the grant pours onto the floor |
| Gravebrand 4pc | REDESIGN | both clauses push the capped pool further into overflow; the 1-cost silently deletes the Shadow Credit row payout (0.40 threshold to 0.20) |
| Ruincaller 2pc | FINE | real, but recharge is PARALLEL here, so a third charge is +50 percent Conflagrate throughput, not bank depth: retune the magnitude and fix "Holds 2 charges" in two sources plus locales |
| Ruincaller 4pc | REDESIGN | pays +0 percent in the reference rotation (fires at exactly 3), locks out Duskfire and Rain of Fire, silently doubles Shadow Credit, and worsens the 2pc's Desolation overcap |
| Moonscorch 2pc | REWORD | the extendDot maxBonus cap eats the entire +3 unless the cap moves too; as worded the bonus grants zero seconds |
| Moonscorch 4pc | REDESIGN | the mana is dwarfed 8-to-1 by the Highmoon Tithe row; "leaves 1 banked" is the Nature's Echo capstone verbatim, and setBank makes them non-stacking |
| Wildfang 2pc | FINE | flips Redharvest energy-negative to positive; print the rank-3 truth (30 to 45) |
| Wildfang 4pc | REDESIGN | the coherent reading double-bills already-cashed bleed damage (paid instantly AND over the next 18 sec) |
| Cinderbark 2pc | REDESIGN | dead on a single-target boss (identical to today) and degenerate on 3 adds (full bank per 20-rage cast) |
| Cinderbark 4pc | REDESIGN | both clauses live below 50 percent health, where a well-healed main tank tries never to be; below half the button also deals no damage and no threat |
| Grovespring 2pc | REDESIGN | actively reduces Verdance generation (kept HoTs mean no new plantings), fighting its own 4pc; the consumed HoT is order-dependent and may not be yours |
| Grovespring 4pc | REWORD | 60 to 75 percent is good; the Verdance clause is the Nature's Echo capstone again (and a no-op beside it); "counts as a new planting" on the replanted Wildbloom is the verifiable replacement |

## The author's checklist (distilled failure classes)

Every replacement bonus must clear all of these before it enters the
docs; each one killed at least one draft above.

1. **Hidden caps.** Check every stack, charge, duration-extension, and
   resource cap on the touched path (extendDot maxBonus, empower stack
   caps, FINGERS/ICICLE/fragment/Gloomtithe caps, the wound cap, the
   Mending pool cap, energy and rage caps).
2. **Saturated economies.** A generation bonus is dead if the pool is
   pinned at cap in the reference rotation. Read the probe scripts.
3. **Already shipped.** Grep the passives, the choice rows, and the
   capstones (choice_rows_classic.ts, warrior_rows.ts) for the same
   effect. Nature's Echo, Colossal Might, cleaving_blows, Living
   Weapon, Howling Rage, and Hour of Judgment each ate a draft.
4. **Vacuous conditions.** A threshold that always holds (80 doom,
   full Redline, flat costs) or never holds (4 Arcane Charges, a tank
   below half) is not a condition.
5. **Display names.** The id is not the name. Verify every name against
   the def (Verdict of the Sun God, Howling Rage, Long Draw, Fevered
   Draw, Call Tithefiend).
6. **Observable state.** The hook must be able to SEE the condition at
   the moment it fires (crit outcomes, empower provenance across
   projectile flight, consumed-proc state, "made free").
7. **Refresh vs stack.** applyAura replaces same-id auras; nothing
   accumulates unless written by hand.
8. **Telegraph contracts.** Render modules hardcode charge counts and
   wedge counts; a bonus that changes a count changes the client.
9. **Collateral systems.** Follow every constant to ALL its readers
   (Shadow Credit thresholds, shared multipliers, execute refunds,
   sibling spenders, the Dusk Economy tail).
10. **Perceptibility.** Resource dribbles under ~1 per sec and flat
    damage in the single digits are filler; cut them.
11. **Intra-set coherence.** The 2pc and 4pc must pull the same
    direction (Ruincaller and Grovespring fought themselves).
12. **Engine invariants and gates.** Respect the pinned rules
    (Devotion is zero during Ascension, the fire 1.25x parity ceiling,
    the Ignite 30 percent share ceiling, anti-snowball guards).
13. **Design tension is a feature.** A bonus that removes a decision
    (window slack, forced full-spend) is negative even when numerically
    positive.

## Surviving bonuses (ship with the noted nits)

Forgewall 2pc, Zealfire 2pc, Stormkindled 2pc, Warspirit 2pc,
Vesperash 4pc, Wildfang 2pc, Ruincaller 2pc (retuned).

## Structural prerequisites (all nine reviewers, independently)

- SetBonusEffect cannot express any of these bonuses: the SetBonusTier
  TalentEffect payload seam (plan doc, phase 4) is a prerequisite, and
  several bonuses additionally need named module hooks following the
  paladinSteadyHandsHotPct pattern.
- Sets are not spec-gated or form-gated by the resolver; the feral cat
  and bear sets share the spec id, so a gating decision is needed
  before the two feral sets can differ.

## Rewrite rounds 2 and 3 (2026-08-28): RESOLVED

The rewrite ran exactly as specified below and is COMPLETE. All 58
bonuses in the plan doc and catalog are now the verified final set.
Provenance: a main-loop redesign against this review's evidence, six
per-class adversarial verifications, two delta verifications over
post-verification changes, and a final targeted pass over the last
redesigns. Roughly 25 further kills and corrections happened across
those rounds. New failure classes discovered and now part of the
checklist's living practice:

14. Constants mirrored into aura VALUES read by dynamic HUD prints:
    bend per wearer by baking the value into the aura at grant time and
    make the combat read use the aura, never the constant (the Dawn's
    Wrath and Veiled Edge pattern).
15. Consume-before-damage ordering: resources consumed at cast commit
    are invisible to damage-time reads (Desolation).
16. Charge models delete cooldown entries: cooldownRefund is a hard
    no-op beside bonusCharges rows (Twin Covenant).
17. Probe-rotation zero-press: a bonus on a button the reference
    rotation never presses pays nothing measurable (Bonecrush, second
    veil strike; Scald and elemental Unleash accepted as disclosed
    probe gaps with same-change harness cases).
18. Derived-constant coupling: a proc rate can be a named input to an
    owner-derived cost (Aether Surge's 14); check def comments.
19. Additive accumulators: printed percents overstate delivered value
    beside large per-ability baselines; print the delivered number or
    size the modifier to deliver the printed one (Warspirit 0.48).
20. Symbolic vs literal test pins: wearer-scoped bends leave symbolic
    pins green; only literal string/value pins move, and copy edits for
    wearer-scoped bonuses must NOT touch base tooltips.

Two final-round redesigns (Dawnforged 4pc instant empowered Dawn's
Embrace; Cinderbark 2pc chance-banked Old Blood) reuse twice-verified
patterns and carry their verification notes in the catalog; every
other bonus has two to four independent hostile reads. The set
formerly named Chronoweave Vestments is now Aetherweave Vestments (the
old name collided with the arcane mastery).

## Process for the rewrite

Class by class: draft each replacement directly against this review's
cited evidence, run it through the checklist above, then have a FRESH
adversarial pass verify the replacement before it enters the docs (the
first two replacement bonuses both died on re-review; drafts are
guilty until re-verified).
