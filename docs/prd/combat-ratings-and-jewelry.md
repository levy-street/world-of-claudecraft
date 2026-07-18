# PRD: Hit Rating and Combat-Rating Itemization

Status: Implemented in PR #1860. The rating ladder, item assignments, capped
above-level curve, and ratings-off-primary-budget policy are locked for v1.

## 1. Problem

Two linked problems:

**(A) Heroic misses.** On Heroic content players miss roughly half of everything,
and no gear stat lets them fix it. Both Heroic delve tiers set `enemyLevelBonus: 3`
(`src/sim/content/delves/collapsed_reliquary.ts:130`,
`src/sim/content/delves/drowned_litany.ts:237`), spawning enemies at player +3. At
+3:

- Melee / ranged white hits (warrior, rogue, hunter): **44% miss**
  (`meleeMissChance`, `src/sim/types.ts:2800`, `5 + ABOVE_LEVEL_MISS_PCT[3]` where
  the table is `[0,2.5,14,39,80]`). Plus ~6.5% mob dodge, so ~half of white swings
  do nothing. Yellow attacks roll the same `swingMissChance`. Hunter Auto Shot has
  no dodge, so ~44% flat.
- Spellcasters (mage): **43% full resist** (`spellHitChance`, `src/sim/types.ts:2792`,
  `96 - 39 = 57%` hit).

Nothing on the player reduces this: `meleeSwing` only ever ADDS miss (the blind
debuff, `auto_attack.ts:248`), and spell resist is `1 - spellHitChance(levels)`
(`spell_resist.ts:13`). The Heroic +3 penalty is un-counterable by gear.

**(B) ilvl 31 does not feel different from ilvl 26/28.** The endgame ilvl ladder is
26 (dungeon epics, world-boss belts/gloves, marks jewelry) -> 28 (heroic dungeon
variants) -> 29 (Nythraxis raid) -> 31 (heroic boss set) -> 33 legendaries, with an
incoming 33/37 Heroic Nythraxis raid tier. But the primary-stat budget barely moves
across it, so a full-price ilvl-31 upgrade reads as "+2 stats" over an ilvl-26 piece.
Budget per slot (`primaryStatBudget`, `src/sim/item_budget.ts`):

| slot | ilvl 26 | ilvl 28 | ilvl 29 | ilvl 31 |
|---|---|---|---|---|
| chest / mainhand | 18 | 20 | 20 | 22 |
| helmet | 15 | 17 | 17 | 18 |
| gloves / waist | 13 | 14 | 14 | 15 |
| ring | 11 | 12 | 12 | 13 |

Chest goes 18 -> 22 across FIVE item levels. That is why the tier feels flat. No
endgame gear carries any combat rating today (crit/haste ratings exist but only set
bonuses populate them), so there is no second axis to make higher tiers feel like a
real step.

Both problems share one fix: put combat ratings on endgame gear, use HIT rating to
answer the Heroic penalty, and let the RATING (its size and count) be what
differentiates the ilvl tiers.

## 2. Current state (verified against origin/main)

- **Jewelry slots and items exist.** `EquipSlot` has `neck`/`ring1`/`ring2`
  (`src/sim/types.ts:308`); a `'ring'` item resolves via `resolveEquipSlot`
  (`equipment_rules.ts:45`); `JewelryItemDef` is class-neutral. The only jewelry
  source is `src/sim/content/heroic_vendor.ts`: 10 epic ilvl-26 pieces, primary
  stats only, bought with Heroic Marks.
- **crit and haste ratings already exist on items.** `BaseItemDef.critRating` /
  `hasteRating` (`types.ts:386`), summed per piece in `recalcPlayerStats`
  (`entity.ts:229`), converted via `CRIT_RATING_PER_PCT = HASTE_RATING_PER_PCT = 10`
  (`types.ts:40`; `critFractionFromRating`/`hasteFractionFromRating`). Also on
  `SetBonusEffect` (`types.ts:473`). **No individual item populates them; only set
  bonuses do.** So crit/haste on gear is a content-only change.
- **Hit rating does NOT exist** on any item, set, or entity, and nothing subtracts
  hit from the miss/resist formulas. Confirmed absent on origin/main and every
  incoming branch. This is the only new engine work, and there is no upstream
  collision.
- **ilvl ladder** (source level + `QUALITY_ILVL_BONUS`/`RAID_ILVL_BONUS`):

  | Source | src lvl | +bump | ilvl |
  |---|---|---|---|
  | Dungeon / world-boss epics; marks jewelry | 20 | epic +6 | 26 |
  | Heroic dungeon variants (`heroic_variants.ts`, auto-gen) | 22 | +6 | 28 |
  | Nythraxis raid epics (helms/shoulders) | 20 | +6, raid +3 | 29 |
  | Five-player Heroic boss set (`heroic_loot.ts`, 24 epics) | 25 | +6 | **31** |
  | Heroic Nythraxis weapons (`heroic_loot.ts`, 3 epics) | 27 | +6 | **33** |
  | Nythraxis legendaries (2) | 20 | +10, raid +3 | 33 |
  | Heroic Nythraxis variants | 27 | +6 / +10 | **33 / 37** |

  The ilvl-31 set and the incoming 33/37 raid variants are pure primary-stat pieces
  today, with room to carry ratings.

- **Set bonuses** (`src/sim/content/item_sets.ts`): 3pc bonuses already grant
  `critRating: 20` (+2% crit) or `hasteRating: 150` (+15% haste). The two WEAK
  bonuses are the T2 4-piece bleeds, self-documented as barely beating their own 2pc:
  - `crownforged` (Strength T2) 4pc `set_bonesplinter`: bleed 8/tick/stack, max 3
    (`item_sets.ts:134`).
  - `nighttalon` (Agility T2) 4pc `set_ragged_gash`: bleed 6/tick/stack, max 3
    (`item_sets.ts:164`).

## 3. Goals

1. Add a **hit rating** primitive (the one missing stat) that reduces both
   melee/ranged miss and spell resist, so gear answers the Heroic +3 penalty.
2. **Itemize** hit/crit/haste across endgame gear with a deliberate per-piece
   assignment (Section 6), including the existing marks jewelry, the ilvl-31 heroic
   set, and the incoming ilvl-33/37 Heroic Nythraxis raid tier.
3. **Fix the flat tier feel**: make combat ratings the differentiator, gated so
   armor ratings effectively START at ilvl 31 and a SECOND rating appears at 33/37.
   Progression becomes 0 ratings -> 1 rating -> 2 ratings, a qualitative step, not
   just +2 stats (Section 5).
4. **Buff the weak 4-set bonuses** by adding hit rating to the two bleed 4pc, so a
   marginal bonus becomes Heroic-relevant (Section 7).

Enabling change (shipped in this PR): the above-level miss/resist curve is retuned to
a capped `[0, 2.5, 14, 21]` penalty table. The established +1/+2 leveling penalties
stay unchanged while the old +3 cliff is reduced, so melee miss tops out at ~26% and
spell resist at ~25% (was ~44%/~43%). This makes Hit meaningful without making it a
mandatory tax. The physical miss floor after Hit is 0.

Non-goals: changing the crit-suppression curve; changing normal difficulty; on-use
trinkets; per-level rating scaling (the cap is fixed).

## 4. The hit-rating primitive

One unified hit rating reduces BOTH physical miss and spell resist by the same
percent (they share `ABOVE_LEVEL_MISS_PCT`), so every class wants it, matching the
class-neutral jewelry model. This was the owner's locked choice over split
physical/spell hit.

Plumbing mirrors the crit/haste rating that already ships:

- Add `hitRating?: number` to `BaseItemDef` (`types.ts:386`, next to
  `critRating`/`hasteRating`) and to `SetBonusEffect` (`types.ts:473`).
- Add `HIT_RATING_PER_PCT = 10` and `hitFractionFromRating(r) = r / 1000` next to the
  existing constants (`types.ts:40`).
- Add entity fields `hitRating` and `hitBonus` (a fraction). In `recalcPlayerStats`,
  accumulate `bonusHitRating` in the gear loop exactly like `bonusCritRating`
  (`entity.ts:229`), then `e.hitRating = bonusHitRating + setEff.hitRating;
  e.hitBonus = hitFractionFromRating(e.hitRating);`.
- Subtract `hitBonus` at the roll sites (leave the pure level-only helpers unchanged
  so their tests hold):
  - Physical: in `swingMissChance` (already receives `attacker`):
    `max(0, baseMiss - attacker.hitBonus)`. Covers melee AND ranged.
  - Spell: pass the caster's `hitBonus` into `spell_resist.ts`:
    `max(0, (1 - spellHitChance(...)) - hitBonus)`.
- Hit does NOT reduce mob dodge (a separate roll), keeping the change contained.

Determinism: no new rng draws. Hit only shifts the threshold of existing rolls, so
the mulberry32 draw ORDER is unchanged and the parity gate holds.

Aggregation note: `aggregateSetBonuses` (`item_sets.ts:310`) must sum `hitRating`
across met tiers alongside crit/haste; add the field to the resolver and its default.

## 5. Tier differentiation: the rating ladder (fixing problem B)

Ratings are OFF the primary-stat budget (like `spellPower`), governed by their own
per-ilvl allowance. The allowance climbs steeply and is gated so ratings are what
make each tier feel distinct. Two levers do the work:

1. **Size**: rating-per-piece jumps hard at ilvl 31.
2. **Count**: number of ratings per piece goes 0 -> 1 -> 2 up the ladder. Nothing
   below 33 has two ratings; that is a qualitative identity, not a bigger number.

Locked v1 allowance (primary rating per piece; 10 rating = 1%):

| Tier | Armor | Weapon / Jewelry | Ratings per piece |
|---|---|---|---|
| ilvl 26 dungeon/world-boss epics | 0 | 0 | none |
| ilvl 26 marks jewelry | - | 25 (2.5%) | 1 |
| ilvl 28 heroic dungeon variants | 0 | 0 | none |
| ilvl 29 Nythraxis raid epics | 20 (2.0%) | - | 1 |
| **ilvl 31 heroic boss set** | **40 (4.0%)** | **50 (5.0%)** | **1 (every piece)** |
| **ilvl 33 Heroic Nythraxis raid** | **55 (5.5%)** | **65 (6.5%)** + **20 (2.0%) 2nd** | **2** |
| **ilvl 37 Nythraxis legendary variant** | - | **70 (7.0%)** + **30 (3.0%) 2nd** | **2** |

What this produces:

- **26 -> 31 now reads as a real step.** An ilvl-26 dungeon chest (0 rating) vs an
  ilvl-31 chest (+2 primary AND +40 of a combat rating = +4% hit or crit or haste).
  The rating, not the two stat points, is the upgrade.
- **31 -> 33 is qualitatively new.** ilvl-33 raid pieces carry TWO ratings (a 5.5-6.5%
  primary plus a 2% secondary). No ilvl-31 or lower piece does. A raider immediately
  reads "dual-stat" as a tier above.
- **Total power stays sane.** With the retuned curve, Heroic (+3) melee miss starts at
  ~26% and spell resist at ~25% (not the old ~44%/~43%). A full ilvl-31 set (~11 slots)
  with ~40% hit pieces (~5 pieces at ~4-5%) yields ~22% hit, enough to close most of
  that gap: a hit-stacked kit drives Heroic melee miss toward 0 (the floor). Hit is
  therefore a strong, earned lever rather than a mandatory tax. The other ~60% of the
  set is crit/haste throughput.

Because the ilvl-28 heroic dungeon variants and ilvl-26 dungeon epics carry zero
rating, and the ilvl-33/37 raid variants inherit their base piece's rating and the
variant builder scales it up plus adds the secondary, the whole ladder is monotonic
and each rung is legible.

Budget policy: v1 keeps ratings fully off the primary budget
(free power that grows the tier gap on purpose, which is what fixes problem B),
governed only by this allowance and a new validation test. The alternative (ratings
consume some primary budget) would flatten the tiers again and is not recommended.

## 6. Itemization: which item gets which rating, and why

Assignment principle: **hit is the Heroic-defining stat, so it is over-represented**
(roughly half of each set), because every non-healer suffers the +3 miss. Crit and
haste fill the rest by archetype throughput. Healer-facing pieces get crit/haste,
never hit (heals are not resisted by level). Archetype groups are from
`heroic_loot.ts:33` (HEAVY = war/pala/shaman; HEAL_MAIL = pala/shaman heal; AGILE =
rogue/hunter; AGILE_WILD = rogue/hunter/druid; CASTER = mage/priest/warlock/druid).

### 6.1 ilvl-26 marks jewelry (the "rebalance the rings and amulets" pass)

Each of the 10 vendor pieces gains ONE rating at the jewelry allowance (25 = 2.5%),
chosen by its stat identity. Primary stat sums are unchanged (ratings are
off-budget), so the budget test still passes.

| Item | slot | stats | rating | why |
|---|---|---|---|---|
| seal_of_the_nine_oaths | ring | str/sta | hit | plate melee, needs hit most |
| oath_of_the_round_table | ring | sta/str | hit | tank/melee |
| swiftfang_talisman | neck | str/agi | hit | hybrid melee |
| medallion_of_endless_profit | neck | str/sta | crit | melee throughput |
| sutils_gambit | ring | agi/sta | crit | agi dps loves crit |
| yumis_keepsake_locket | neck | agi/sta | haste | agi dps, uptime |
| nielas_coldlight_band | ring | int/sta | hit | dps caster, resist |
| zense_meridian | neck | int/spi | crit | caster throughput |
| architects_cornerstone | ring | int/spi | haste | caster/healer uptime |
| zyzzs_deathless_signet | ring | spi/int | haste | healer-leaning |

### 6.2 ilvl-31 heroic boss set (the differentiator; every piece gets one rating)

Armor 40 (4.0%), weapons 50 (5.0%). Roughly half hit, rest crit/haste by archetype.

HEAVY (war/pala/shaman):
| piece | slot | rating |
|---|---|---|
| morthens_cryptforged_hauberk | chest | hit |
| cryptplate_helm | helmet | hit |
| tideworn_warboots | feet | hit |
| gravescale_girdle | waist | hit |
| mistforged_pauldrons | shoulder | crit |
| gravewyrm_claws | gloves | crit |
| gravewyrm_cleaver | mainhand | crit |

Result: the five-player HEAVY set is 4 hit + 3 crit, so a warrior fresh into Heroic
can claw back 16% miss before the separate item-level-33 raid weapon.

AGILE / AGILE_WILD (rogue/hunter/druid):
| piece | slot | rating |
|---|---|---|
| bonechill_striders | feet | hit |
| tidewoven_trousers | legs | hit |
| bonechill_cord | waist | hit |
| sanctum_prowlers_grips | gloves | hit |
| tideguard_faceguard | helmet | crit |
| tidebound_spaulders | shoulder | crit |
| mistcallers_fang | mainhand | crit |

Hunters (Auto Shot miss) and rogues both need hit; crit fills their throughput.

CASTER (mage/priest/warlock/druid):
| piece | slot | rating |
|---|---|---|
| shadowpulse_handwraps | gloves | hit |
| sash_of_the_sunken_court | waist | hit |
| lunar_choir_leggings | legs | hit |
| lunar_tide_greatstaff | mainhand | hit |
| shadowpulse_slippers | feet | crit |
| shroud_of_the_gravewyrm | chest | crit |
| sunken_court_mantle | shoulder | haste |

DPS casters (mage/warlock) get 4 hit pieces for the resist problem; healer casters
(priest/druid) value the crit/haste pieces and skip the hit ones.

HEAL_MAIL (pala/shaman heal): no hit (heals unaffected), all crit/haste.
| piece | slot | rating |
|---|---|---|
| choirmothers_casque | helmet | haste |
| wyrmchoir_handwraps | gloves | haste |
| choir_blessed_spaulders | shoulder | crit |

### 6.3 ilvl-29 Nythraxis raid set pieces (base for the raid variants)

The 8 raid helms/shoulders (`crownforged`/`nighttalon`/`soulflame`/`stormcallers`)
each gain ONE rating at 20 (2.0%): strength/agility pieces get hit, caster pieces get
hit, the shaman/paladin caster-mail (`stormcallers`) gets crit. This is deliberately
small (they are ilvl 29, below the ilvl-31 dungeon set) AND it is the seed the raid
variant builder scales up.

### 6.4 ilvl-33/37 Heroic Nythraxis raid (dual-rating tier)

The tier contains the three direct Heroic Nythraxis weapon drops plus variants
auto-generated by `buildHeroicVariants` from the ilvl-29 base set pieces and the two
legendaries. Every item level 33/37 Heroic raid piece carries two ratings.

Direct item-level-33 weapon assignments:

| piece | primary | secondary |
|---|---|---|
| scepter_of_the_deathless_court | haste 65 | crit 20 |
| deathless_greatblade | hit 65 | crit 20 |
| stormcallers_focus | haste 65 | crit 20 |

For generated variants, the builder:
1. Scales the base piece's primary rating (6.3) up to the 33/37 allowance
   (55/70 armor, 65/70 weapon).
2. ADDS a secondary rating of a DIFFERENT type (20 at ilvl 33, 30 at ilvl 37).
   Physical Hit pairs with crit; a physical non-Hit primary pairs with Hit. A
   spell-facing piece keeps Hit only when its authored base explicitly seeds Hit,
   marking it as caster-DPS gear, and pairs that Hit with haste. A spell-facing
   throughput seed, or a rating-less base such as Heartwood, remains throughput-only
   and pairs crit + haste. This distinguishes caster DPS from healer-facing gear
   without inferring that every Intellect item is a healing item.

Legendaries (`deathless_heartwood`, `kingsbane_last_oath`) keep their weapon procs
and gain the dual rating at the ilvl-37 allowance (e.g. Kingsbane: +hit primary,
+crit secondary; Heartwood: +haste primary, +crit secondary), so the capstone reads
as the strongest dual-rating pieces in the game.

### 6.5 Azazel (Molten Abyss) heroic loot (incoming, `feature/azazel-heroic-loot`)

Its 6 ilvl-31 heroic epics and 3 ilvl-25 abyss jewelry pieces follow the same rules:
ilvl-31 armor gets one rating at the 40/50 allowance by archetype (hit-led); the
ilvl-25 jewelry gets a smaller rating (~20) since it sits under the marks jewelry.
Same pattern, applied when that branch merges (it edits `heroic_loot.ts`, so expect a
small conflict with the rating additions there).

## 7. Buffing the weak 4-set bonuses (add hit rating)

The two bleed 4pc are marginal (Section 2). Keep the bleed, but ADD a hit-rating
grant to each 4pc effect so the bonus becomes worth chasing specifically for Heroic:

- `crownforged` (Strength T2) 4pc: keep `set_bonesplinter` bleed, add
  `hitRating: 60` (+6% hit) to the 4pc `SetBonusEffect`.
- `nighttalon` (Agility T2) 4pc: keep `set_ragged_gash` bleed, add `hitRating: 60`.

Now a strength or agility raider who completes the 4pc gets a real Heroic tool (6%
hit) layered on the flat bleed, turning the weakest bonuses into a reason to keep the
set together on Heroic. Because `SetBonusEffect.hitRating` and the entity fold are
added in Section 4, this is a one-line-per-set content change plus the resolver
summing `hitRating`.

The caster T2 4pc (`set_soulblaze`) does not gain Hit in v1. Its existing proc remains
unchanged; the v1 buff is deliberately limited to the two weak bleed bonuses.

## 8. Testing

- Sim test: hit rating reduces `swingMissChance` (melee + ranged) and spell resist by
  the converted percent and respects the floors. Set-bonus `hitRating` aggregates.
- `tests/item_level.test.ts`: primary-sum assertions stay green (ratings off-budget).
  `tests/combat_rating.test.ts` sweeps live `itemLevel(...)` values: every ilvl-31
  piece carries exactly one rating at its band, every Heroic ilvl-33/37 raid piece
  carries two, ilvl-26/28 armor carries none, and each vendor jewelry piece carries
  one. This is the guard that keeps the tier ladder intact as content grows.
- `tests/item_sets.test.ts`: the two 4pc bleeds now also grant `hitRating`; the three
  haste kits and other bonuses unchanged.
- New `tests/parity` scenario: a rating-geared player vs +3 enemies, asserting rng
  draw order is identical to the ungeared fight (thresholds move, draws do not);
  regenerate goldens.
- `tests/architecture.test.ts`: new sim code stays DOM/Three-free and rng-clean.
- Three-host parity: authoritative combat recomputes `hitRating`/`hitBonus` through
  `recalcPlayerStats`. The server mirrors informational `hitRating` as `hirat` so the
  online character sheet shows the same value; combat still resolves server-side.

## 9. Locked v1 decisions and future questions

Locked by the owner:
- Unified hit rating (not split physical/spell).
- Rebalance the existing 10 marks jewelry pieces to each carry a rating (6.1).
- Add hit rating to the weak bleed 4-set bonuses (7).
- Fix the flat ilvl-31 feel via the rating ladder (5).
- Keep ratings off the primary-stat budget.
- Lock the Section 5 allowances and Section 6 assignments.
- Keep ilvl-28 Heroic dungeon variants rating-free.
- Preserve the old +1/+2 level-gap penalties and cap the +3+ penalty at 21.
- Do not add Hit to the caster T2 4pc in v1.

Future: an expertise-style stat may later cut mob dodge. Hit does not do so in v1.

## 10. Implementation map

- Hit-rating engine primitive (`hitRating` on `BaseItemDef` + `SetBonusEffect`,
  `HIT_RATING_PER_PCT`, entity fold, `swingMissChance`/spell-resist subtraction,
  resolver sum). Sim + parity tests. No content.
- Rating allowance and complete live-item-level validation in `tests/combat_rating.test.ts`.
- Marks jewelry itemization, tooltip line, and localized Hit labels.
- ilvl-31 boss-set itemization and ilvl-29 raid seeds.
- Weak 4pc bleed Hit grants.
- Dual-rating Heroic Nythraxis weapons and generated ilvl-33/37 variants.
- Azazel loot ratings remain deferred until that content branch lands (6.5).
