# Gear stamina baseline: the remeasure and the carve-versus-top-up review (2026-09-10)

Owner ask (Reuben, 10 Sep 2026): resume the stamina reallocation that was parked on
6 Sep until professions landed, and review the specific idea of trimming the damage
stats on DPS gear to make room for a baseline stamina, accepting that it may move
class balance. This document is the remeasure the parked plan called for, against
`release/v0.43.0` at `b276778485`, with landed profession gear in the catalog.

Sections 1 to 7 are the measurement and the option review, written before anything
was adopted; section 8 records the implementation that followed the owner's decision
the same day. The study tooling is untracked under `tmp_stamina_study/` in the
`wt-loot-budget-v042` worktree (branch `feature/gear-stamina-baseline`); section 7 has
the reproduction.

## 1. What the shipped model does with stamina today

The item-level model (`src/sim/item_level.ts`, primitives in `src/sim/item_budget.ts`)
gives every combat-gear item an expected primary-stat budget from its item level,
quality and slot. Stamina is one of the five budgeted primaries alongside Strength,
Agility, Intellect and Spirit, so every stamina point on an item costs one offensive or
regen point. `normalizePrimaryStats` scales a stat line onto the budget while keeping
the ratio the author typed, and the item-level tests pin `primaryStatSum(item) ==
expectedStatBudget(item)` for the heroic five-player set, the raid pieces, the rift
rares and epics, and the showcase trios.

The consequence is that an item's stamina is whatever its author typed, and the
authoring is split by era rather than by rule:

- Physical gear was authored with a two-to-one or better primary-to-stamina line. The
  median physical item spends 40 percent of its budget on stamina; the mode is 30 to
  39 percent; 3 of 238 physical epics carry none.
- The caster raid tier sets (Pyroclast, Frostquench, Gravebrand, Hexthread, Ruincaller,
  Vesperash, Moonscorch, Stormkindled) and the healer tier sets (Benison, Chronoweave,
  Dawnforged, Emberscreed, Grovespring, Springmender), plus the Nythraxis and Ignivar
  caster epics, were authored Intellect plus Spirit with no stamina at all.
- The crucible caster and healer collections, the Stormcaller and Soulflame pieces and
  the PvP Cinderweave, Stormbound and Thornhide sets DO carry stamina, at roughly 30
  percent of budget. So a caster's health today depends on which tier they happen to
  wear, not on the tier's level.

Inventory against the release head (`tmp_stamina_study/inventory.ts`):

| Bucket | Count |
|---|---|
| Eligible combat-gear definitions (`isItemLevelEligible`) | 832 |
| With a derived tier | 734 |
| Without a derived tier (priced at their own stat sum below) | 98 |
| Exactly on budget | 575 |
| Off budget (authoring drift, reported here, not corrected) | 159 |
| Zero stamina | 308 |
| Zero stamina and epic | 152 |
| Caster epics with zero stamina | 146 of 214 |
| Physical epics with zero stamina | 3 of 238 |

The 6 Sep counts (741 eligible, 289 zero-stamina) were taken against v0.41.4; the
catalog has grown by 91 eligible items since, the profession collections among them,
and the crucible caster collections are the ones that DO carry stamina.

## 2. The three options measured

One rule, applied to every eligible item: a baseline allowance equal to a fixed share of
the item's expected budget, `allowance = round(share * expectedStatBudget(item))`. An
item already at or above its allowance is untouched. For an item under it, three ways
to get there were modelled (`tmp_stamina_study/model.ts`):

- **Carve, proportional** (`carve_prop`): raise stamina to the allowance and shrink the
  rest of the line proportionally, so the item's primary-stat total does not move. This
  is the owner's proposal.
- **Carve, Spirit first** (`carve_spirit`): the same total-neutral carve, but the
  stamina deficit is paid from Spirit before anything else. Casters trade regen before
  nukes; physical items behave exactly like the proportional carve.
- **Top-up** (`topup`): raise stamina to the allowance and leave the rest of the line
  alone, so the total rises. Included as the control that isolates the health effect
  from the offense cost.

Both carves hold each item's CURRENT total constant rather than normalising to budget,
so the 159 off-budget items are neither fixed nor worsened by the stamina rule; that
drift is a separate cleanup. The one side effect: an under-budget item is carved against
its budget-derived allowance and so gives up slightly more than its share (Kingsbane's
Last Oath, a legendary far under its 1.9x legendary budget, goes from 15/15/14 to
11/11/22).

**Scope (owner, 10 Sep): every item in the game of uncommon quality and above,** not
the raid tier. The rule as modelled already reaches that far: it runs over every
combat-gear definition with a slot, and only whites and greys fall out because their
stat budget is zero. At one third the rewritten set is 59 uncommon, 64 rare, 189 epic
and 5 legendary items (plus 2 hybrids); the leveling tiers show the same split as the
cap, with 44 of 59 uncommon caster items and 47 of 59 rare ones carrying no stamina
while physical greens and blues sit at 33 to 38 percent.

One consequence of a global rule is rounding at the small budgets the leveling greens
carry. `round(budget / 3)` gives 1 Stamina on a budget of 2 (an effective 50 percent)
and 1 on a budget of 4 (25 percent); the effective share settles inside 29 to 40
percent from budget 5 upward. About 100 items sit at budgets of 4 or less. The
implementation should decide whether those take the rounded value (simplest, and the
swing is one point) or a floor with a minimum of 1 from budget 3 upward.

Two shares were measured. One third matches the physical raid sets' two-to-one line
(69 primary to 34 stamina on Emberfury) and the crucible caster collections (8 of 25 on
the chest). 0.40 is the physical median.

| Share | Items under allowance | Caster (unc/rare/epic/leg) | Physical (unc/rare/epic/leg) | Stamina added | Int removed (prop) | Spirit removed (prop) | Spirit removed (Spirit-first) |
|---|---|---|---|---|---|---|---|
| 1/3 | 319 of 832 | 43 / 48 / 174 / 3 | 16 / 16 / 15 / 2 | 1,284 | 723 | 478 | 1,192 |
| 0.40 | 454 of 832 | 45 / 48 / 198 / 3 | 24 / 30 / 101 / 3 | 1,768 | 923 | 580 | 1,382 |

At one third the physical side is 49 items, mostly stamina-free necks and rings and a
handful of weapons and belts sitting just under the line; at 0.40 it reaches 158
physical items including most of the physical raid sets, because their authored line is
exactly one third.

The rewritten records live in 14 content files: `ignivar_loot.ts` (96), `zone3.ts`
(49), `items.ts` (35), `heroic_loot.ts` (20), `zone2.ts` (19), `profession_items.ts`
(16), `pvp_honor.ts`, `temple.ts`, `delves/items.ts`, `rift/items.ts`,
`heroic_vendor.ts`, `wildheart.ts`, `drakelands.ts`, plus 29 generated heroic
variants that re-derive from their base item and 15 crucible collection pieces that
the collection generator builds rather than declaring as literals.

## 3. Health outcome: all 27 specs at level 20

Kit: the strongest observed parse loadout per spec (`parseBisGearFor`, the same source
`/dev bis` uses), with the August crucible study's parse-modal talent rows for the 19
DPS specs and no rows for tanks and healers. Measured with the real `Sim`
(`tmp_stamina_study/hp.ts`). Health and Spell Power are the post-equip values; regen
is the in-combat Spirit regen per 2 s tick (`manaRegenPer2s`, the 30 percent
Meditation share).

| Spec | Base HP | Carve 1/3 HP | Carve 0.40 HP | Base SP | SP after prop carve 1/3 | Regen base | Regen after prop carve | Regen after Spirit carve |
|---|---|---|---|---|---|---|---|---|
| mage/fire | 638 | 988 | 1,068 | 108 | 98 | 14 | 12 | 10 |
| mage/frost | 718 | 1,048 | 1,138 | 114 | 104 | 14 | 12 | 10 |
| mage/arcane (healer) | 638 | 1,058 | 1,138 | 113 | 101 | 15 | 13 | 11 |
| warlock/affliction | 730 | 1,070 | 1,160 | 116 | 106 | 14 | 12 | 11 |
| warlock/demonology | 760 | 1,210 | 1,290 | 111 | 100 | 15 | 13 | 10 |
| warlock/destruction | 790 | 1,130 | 1,210 | 113 | 102 | 14 | 12 | 10 |
| priest/shadow | 797 | 1,087 | 1,197 | 129 | 120 | 18 | 16 | 15 |
| priest/discipline | 731 | 1,152 | 1,250 | 105 | 93 | 17 | 15 | 13 |
| priest/holy | 797 | 1,187 | 1,307 | 134 | 123 | 19 | 17 | 15 |
| shaman/elemental | 1,023 | 1,393 | 1,453 | 104 | 93 | 14 | 12 | 10 |
| shaman/restoration | 1,023 | 1,393 | 1,453 | 103 | 92 | 14 | 12 | 10 |
| druid/balance | 882 | 1,352 | 1,442 | 92 | 78 | 15 | 13 | 11 |
| druid/restoration | 842 | 1,272 | 1,362 | 102 | 89 | 15 | 13 | 11 |
| paladin/holy | 1,008 | 1,428 | 1,498 | 88 | 75 | 12 | 10 | 8 |
| rogue/assassination | 1,150 | 1,190 | 1,250 | 6 | 6 | 4 | 4 | 4 |
| rogue/combat | 1,230 | 1,360 | 1,450 | 6 | 6 | 4 | 4 | 4 |
| rogue/subtlety | 1,140 | 1,180 | 1,250 | 6 | 6 | 4 | 4 | 4 |
| hunter/marksmanship | 1,415 | 1,415 | 1,435 | 16 | 16 | 6 | 6 | 6 |
| hunter/survival | 1,455 | 1,455 | 1,465 | 23 | 23 | 6 | 6 | 6 |
| hunter/beast_mastery | 1,582 | 1,669 | 1,744 | 16 | 16 | 6 | 6 | 6 |
| warrior/arms | 1,722 | 1,722 | 1,722 | 5 | 5 | 3 | 3 | 3 |
| paladin/retribution | 1,738 | 1,738 | 1,738 | 16 | 16 | 6 | 6 | 6 |
| shaman/enhancement | 1,773 | 1,773 | 1,773 | 29 | 29 | 8 | 8 | 8 |
| warrior/fury | 1,872 | 1,872 | 1,872 | 5 | 5 | 3 | 3 | 3 |
| druid/feral (tank) | 1,852 | 1,892 | 1,902 | 33 | 32 | 9 | 9 | 9 |
| paladin/protection | 2,388 | 2,498 | 2,558 | 16 | 16 | 6 | 6 | 6 |
| warrior/prot | 2,452 | 2,562 | 2,632 | 5 | 5 | 3 | 3 | 3 |

The top-up option produces the same health column as the carve at the same share (the
stamina added is identical); it differs only in leaving Spell Power, Attack Power and
regen at their base values.

The carve does cost some physical specs Attack Power, because their kits hold the
stamina-free necks and rings and a few under-line weapons. Warriors, retribution,
enhancement, marksmanship and survival lose nothing at one third.

| Spec | Base AP | AP after carve 1/3 | AP after carve 0.40 |
|---|---|---|---|
| rogue/combat | 384 | 368 | 358 |
| rogue/assassination | 433 | 427 | 418 |
| rogue/subtlety | 284 | 280 | 273 |
| hunter/beast_mastery (ranged AP) | 459 | 451 | 441 |
| hunter/marksmanship (ranged AP) | 431 | 431 | 427 |
| hunter/survival (ranged AP) | 567 | 567 | 562 |
| warrior/prot | 333 | 325 | 321 |
| paladin/protection | 335 | 327 | 323 |

Reading the health column:

- At one third every caster gains 330 to 470 HP. Cloth DPS lands at 990 to 1,210,
  priests at 1,090 to 1,190, mail and leather casters at 1,270 to 1,430.
- That closes the caster-to-rogue gap: a fire mage moves from 55 percent of an
  assassination rogue to 83 percent (85 percent at 0.40).
- It does not close the caster-to-warrior gap: fire mage to arms warrior goes from 37
  percent to 57 percent (62 percent at 0.40). The rest of that gap is class base
  stats, not gear: cloth classes gain 1 Stamina per level against the warrior's 2 and
  12 base HP per level against 18, so an ungeared mage is 418 HP at 20 against 812.
  The class-side lever the parked plan mentioned (+1 Stamina per level for the cloth
  classes) is worth +190 HP at level 20 on top of any gear change, and is a separate
  decision.
- Rogues, hunters and the two tanks pick up 40 to 130 HP from the stamina-free necks,
  rings and weapons; pure warriors and retribution move by zero.

### 3b. Leveling tiers: uncommon and rare gear at levels 8 to 20

A character at each level wearing the best class-legal uncommon or rare piece per
slot whose source level is at or below their own (no epics), scored with the /dev kit
role weights, no talent rows. Share one third (`tmp_stamina_study/leveling.ts`).
The Spirit-first carve costs zero Spell Power at every level for every caster here,
so only the proportional carve's Spell Power is shown.

| Spec | L8 HP base to carve | L12 | L16 | L20 fresh (no epics) | SP at 20, base to prop carve |
|---|---|---|---|---|---|
| mage/fire | 204 to 274 | 302 to 392 | 450 to 600 | 708 to 888 | 68 to 61 |
| priest/shadow | 185 to 255 | 279 to 369 | 423 to 573 | 677 to 857 | 60 to 54 |
| warlock/destruction | 276 to 346 | 374 to 464 | 522 to 672 | 780 to 960 | 66 to 60 |
| druid/balance | 316 to 386 | 428 to 528 | 640 to 820 | 932 to 1,112 | 58 to 52 |
| rogue/combat | 340 to 340 | 470 to 480 | 750 to 750 | 980 to 990 | AP 244 to 242 |
| hunter/marksmanship | 415 to 415 | 575 to 585 | 915 to 915 | 1,185 to 1,185 | RAP 268 to 268 |
| warrior/arms | 506 to 516 | 738 to 748 | 1,070 to 1,070 | 1,322 to 1,332 | AP 218 to 216 |

The rule behaves the same way while leveling as at the cap: casters gain 70 HP at
level 8 rising to 180 at a fresh 20, physical specs move by 0 to 10, and a fire mage
holds 80 to 90 percent of a combat rogue's health from level 8 onward instead of 60
to 72 percent. The proportional carve's Spell Power cost is 1 to 7 points (3 to 10
percent) at these levels; the Spirit-first carve costs none, and leveling fights are
too short for the Spirit regen loss to bind.

## 4. DPS outcome: the 19 DPS specs on the heroic dummy

Same kits and talents as section 3, on the study harness's heroic dummy (level 22, 1.2x
armor, 180 s, boss-only single target, health held full), 8 seeds per arm, share one
third. Top-up leaves offense untouched so it was not run; its DPS is the baseline
column. Baselines are internal to this study (this bench, these parse kits, the v0.42.0
class tuning) and are not comparable with the August ceiling study's numbers.

| Spec | Base DPS | sd | Proportional carve | Delta | Spirit-first carve | Delta | HP base to carve | SP base to prop | Spirit base to Spirit-first |
|---|---|---|---|---|---|---|---|---|---|
| shaman/elemental | 141.5 | 8.3 | 120.5 | -21.0 (-14.9%) | 133.5 | -8.0 (-5.7%) | 1,023 to 1,393 | 104 to 93 | 113 to 76 |
| mage/frost | 149.9 | 8.0 | 133.0 | -16.9 (-11.3%) | 141.4 | -8.5 (-5.7%) | 718 to 1,048 | 114 to 104 | 113 to 80 |
| mage/fire | 122.2 | 6.3 | 109.6 | -12.6 (-10.3%) | 118.9 | -3.3 (-2.7%) | 638 to 988 | 108 to 98 | 115 to 80 |
| warlock/demonology | 175.5 | 4.3 | 164.3 | -11.2 (-6.4%) | 169.5 | -6.0 (-3.4%) | 760 to 1,210 | 111 to 100 | 120 to 79 |
| druid/balance | 181.1 | 5.5 | 171.7 | -9.4 (-5.2%) | 181.1 | 0.0 | 882 to 1,352 | 92 to 78 | 128 to 81 |
| warlock/destruction | 181.9 | 4.6 | 174.3 | -7.6 (-4.2%) | 179.1 | -2.8 (-1.6%) | 790 to 1,130 | 113 to 102 | 113 to 79 |
| priest/shadow | 180.5 | 4.7 | 173.2 | -7.3 (-4.0%) | 180.5 | 0.0 | 797 to 1,087 | 129 to 120 | 150 to 121 |
| warlock/affliction | 178.2 | 5.2 | 174.4 | -3.8 (-2.1%) | 178.2 | 0.0 | 730 to 1,070 | 116 to 106 | 115 to 81 |
| rogue/combat | 196.2 | 7.6 | 193.2 | -3.0 (-1.6%) | 193.2 | -3.0 (-1.6%) | 1,230 to 1,360 | n/a | n/a |
| hunter/beast_mastery | 170.1 | 6.5 | 169.1 | -1.0 (-0.6%) | 169.1 | -1.0 (-0.6%) | 1,582 to 1,669 | n/a | n/a |
| rogue/assassination | 178.4 | 6.2 | 177.3 | -1.1 (-0.6%) | 177.3 | -1.1 (-0.6%) | 1,150 to 1,190 | n/a | n/a |
| rogue/subtlety | 134.0 | 5.3 | 134.1 | 0.0 | 134.1 | 0.0 | 1,140 to 1,180 | n/a | n/a |
| druid/feral | 126.1 | 5.6 | 126.1 | 0.0 | 126.1 | 0.0 | 1,852 to 1,892 | n/a | n/a |
| hunter/marksmanship | 165.4 | 4.9 | 165.4 | 0.0 | 165.4 | 0.0 | 1,415 to 1,415 | n/a | n/a |
| hunter/survival | 180.8 | 4.8 | 180.8 | 0.0 | 180.8 | 0.0 | 1,455 to 1,455 | n/a | n/a |
| paladin/retribution | 185.8 | 10.4 | 185.8 | 0.0 | 185.8 | 0.0 | 1,738 to 1,738 | n/a | n/a |
| shaman/enhancement | 149.1 | 4.2 | 149.1 | 0.0 | 149.1 | 0.0 | 1,773 to 1,773 | n/a | n/a |
| warrior/arms | 132.6 | 9.0 | 132.6 | 0.0 | 132.6 | 0.0 | 1,722 to 1,722 | n/a | n/a |
| warrior/fury | 166.8 | 5.0 | 166.8 | 0.0 | 166.8 | 0.0 | 1,872 to 1,872 | n/a | n/a |

Three things the table shows that the stat sheet alone did not:

- The proportional carve is not a flat tax. Elemental, frost and fire lose 10 to 15
  percent because their parse kits are the zero-stamina raid sets and nearly all of
  their damage rides Spell Power; affliction and shadow lose 2 to 4 percent because
  more of their damage is base value and dot ticks. The physical side is within one
  standard deviation of zero everywhere; combat rogue's 1.6 percent is the AP from the
  stamina-free neck and rings.
- The Spirit-first carve costs nothing for the specs that never run dry (balance,
  shadow, affliction) and 3 to 6 percent for the ones that do over 180 s (elemental,
  frost, demonology). That loss is mana starvation, not a smaller nuke: Spirit on the
  raid sets was buying 30 percent-share combat regen and little else.
- Fire and frost sit at the bottom of this bench before any change (122 and 150
  against 165 to 196 for the physical DPS specs). A 10 percent proportional cut lands
  on the two specs least able to absorb it, which is the balance risk the owner named.

## 5. What the study says

**The carve is the right shape.** Trimming the offensive line to make room for stamina
is the only option that keeps the shipped budget model true: every item's total stays
equal to its budget, the `stat sum == budget` pins stand, `itemScore` stays comparable
across identities, and same-tier physical and caster pieces stay equal in total power.
Top-up gives the same health for no offense cost, but it makes a caster tier set
worth 35 more stat points than the physical set from the same boss, breaks those pins,
and is a caster buff dressed as a budget rule. The owner's instinct on 10 Sep matches
what the model wants.

**One third is the share.** It is what the physical raid sets and the crucible caster
collections already do, it touches 49 physical items against 158 at 0.40, and it costs
no Attack Power to the warriors, paladins, enhancement and the two ranged hunter
specs. 0.40 buys casters a further 80 HP for triple the physical churn.

**Pay from Spirit first on damage-caster gear.** The Spirit those sets carried was
doing little for a nuker (a 30 percent combat regen share). Converting it to stamina
gives the same health gain at 0 to 6 percent DPS instead of 2 to 15 percent, and the
6 percent falls on the mana-bound specs (elemental, frost, demonology) where it is
starvation, not a weaker spell. The proportional carve should be reserved for healer
gear (the healer tier sets and the crucible healer collections, both declared data),
where Spirit is the longevity stat and the cost belongs on Healing Power instead. Not
measured here: healer output under either carve; there is no healing bench, and the
holy paladin's 12 to 10 regen and 88 to 75 Spell Power under the proportional carve
are the numbers to test on PBE.

**The gear rule fixes the caster-to-rogue gap and the tier-to-tier inconsistency, not
the caster-to-warrior gap.** After the carve a fire mage sits at 83 percent of an
assassination rogue but 57 percent of an arms warrior; the rest is 1 versus 2 Stamina
per level and 12 versus 18 base HP per level, which is a class-table decision worth
+190 HP per point of Stamina per level at the cap. Decide it separately, after the gear
rule lands and PvP has been re-read; the 6 Sep 85 to 95 percent target was written
against physical DPS, not tanks or warriors.

**The carve is a caster damage nerf unless it is compensated, and the owner has said
that is the main issue.** Casters are already the lowest specs on this bench, so the
two problems (missing stamina, low damage) must be decoupled: the carve fixes the item
model, and the damage is put back through the per-spec seam the v0.42.0 rebalance
used (`src/sim/content/spec_baselines.ts` for shaman, warlock, druid and priest; the
mage spec mastery, since mage is deliberately absent from that table), sized so this
bench reads the same before and after. Under the Spirit-first carve the refund is
small (elemental and frost 6 percent, demonology 3.5, fire 2.8, destruction 1.6, the
rest zero) and is mana starvation, so it can be paid on the mana side (cost or regen)
where it only helps a spec that is running dry. Under the proportional carve it must be
damage, up to 17 percent for elemental, and any flat damage refund also lifts casters
in the sets that already carried stamina, since their Intellect was never cut.

**What has to happen before a PR.** The max-health audit in section 6, a Varkhul
heroic remeasure (its absorbs scale on player max HP), and a decision on whether
elemental and frost's mana starvation under the Spirit-first carve is accepted or
compensated on the mana side. The class-balance work from PR 3917 is not undone by
either carve, but the fire and frost bench positions get worse, not better, under the
proportional one.

## 6. Implementation shape, if the carve is adopted

- **One rule, one home.** The allowance function (share of `expectedStatBudget`) belongs
  in `src/sim/item_budget.ts` beside `primaryStatBudget` and `normalizePrimaryStats`,
  with the share as a named constant. `content/heroic_variants.ts` already normalises
  generated variants through those primitives and picks the rule up for free.
- **Codemod the literals once, do not inject at data-eval time.** Data-as-code means
  the content file is the truth a contributor and the wiki read. A one-time script
  rewrites the 319 records (the `overrides_carve_prop_0.33.json` receipt is exactly
  that list, before and after) and the result is reviewed as a content diff. The 44
  heroic variants regenerate on their own.
- **A guard test, not a hope.** A sibling of the `stat sum == budget` pins in
  `tests/item_level.test.ts`: every eligible item with a derived tier carries at least
  its allowance. New content cannot regress it.
- **Same-change obligations** (the content-obligations reviewer's list applies): wiki
  regeneration (`npm run wiki:content`, freshness-gated by `tests/guide.test.ts`) because
  item stat lines are wiki content; parity goldens re-minted in their own reviewed
  commit (`UPDATE_PARITY=1 npx vitest run tests/parity`) because player health changes
  every combat trace; the `tests/nythraxis_matrix`, `tests/tank_parity` and
  `tests/dev_bis_gear` fixtures re-read; no i18n keys (stat lines are numbers), no
  tooltip prose (stats render from the item), no art.
- **The max-health audit the parked plan required.** More player health is not free:
  `VARKHUL_RED_HOT_METAL_DAMAGE_MAX_HP` and `VARKHUL_RED_HOT_METAL_HEAL_ABSORB_MAX_HP`
  (`src/sim/encounters/varkhul.ts`) scale absorbs on the target's max HP, so absolute
  healing demand rises with it; Cauterize heals `CAUTERIZE_HEAL_FRAC` of max HP;
  `PET_OWNER_HP_SHARE` (0.25) hands pets a quarter of the owner's health, so hunter and
  warlock pets inherit the gain; the percent-of-max-HP heals and shields under
  `src/sim/combat/` (auras, casting lifecycle, hunter shared, shaman talents, crafted
  collection effects, temporal hourglass, paladin talents, Spiritmend, affliction) all
  scale up with the pool. Fixed-value heals and consumables do not, so they get
  relatively weaker. Each should be re-read before the PR, and the Varkhul one
  re-measured.

## 7. Reproduction

Worktree `wt-loot-budget-v042`, branch `feature/gear-stamina-baseline` on
`release/v0.43.0` at `b276778485`, real pnpm install.

```
npx tsx tmp_stamina_study/inventory.ts            # inventory + share distribution
npx tsx tmp_stamina_study/changes.ts 0.3333       # item counts + overrides_*.json receipts
npx tsx tmp_stamina_study/hp.ts                   # 27-spec health table (data/hp_results.json)
./tmp_stamina_study/run_fleet.sh                  # 19-spec DPS fleet, 8 seeds, heroic dummy
npx tsx tmp_stamina_study/aggregate.ts 0.3333     # fold the fleet into one table
```

`harness.ts` is the August crucible study's Monte Carlo core (a copy of the shipped
band probes' rotations) with two additions: the result carries `maxHp` and a post-equip
`startStats` block so stat readouts are not taken at the end of a fight under proc
buffs. Seeds are the study ladder `71000 + i * 137`; the heroic dummy is level 22 at
1.2x armor for 180 s, boss-only single target. `model.ts` mutates the shared `ITEMS`
table for the duration of a probe run and restores it; the game code never does this.

## 8. Implementation record (2026-09-10, branch `feature/gear-stamina-baseline`)

Decision taken with the owner after sections 1 to 7: the top-up route, a uniform one
third baseline on every budgeted slot including weapons and held off-hands, rounded,
the premium constant at 1.0, the guard written first and repo-wide, the 149 remaining
drift items on an explicit allowlist, the class table untouched. The owner's constraint
that caster damage must not fall is met by construction: no Intellect, Strength or
Agility moves except on the 49 stamina-free physical necks, rings and weapons trimmed
onto their line (a loss inside noise on the bench).

**The model** (`src/sim/item_budget.ts`, "The stamina baseline model"): the budget
(`primaryStatBudget`) is the offense-and-resource line. A physical identity (Strength
or Agility) already holds its baseline inside the line, so its total is the budget; a
caster identity (Intellect or Spirit, no Strength or Agility) carries the baseline on
top, so its total is budget plus baseline. Stamina above the baseline is bought from
the line at `STAMINA_PREMIUM` points per point. `expectedStatBudget` now returns the
model total; `expectedLineBudget` returns the line; `checkStaminaModel` and
`normalizeToStaminaModel` serve the guard and the generators. Heroic variants, the
crucible collection pieces and the rift bands go through the model-aware normaliser,
so generated items conform by construction.

**The guard** (`tests/item_stamina_baseline.test.ts`): every eligible item meets its
floor (items with no derivable tier take a proxy from their own line); every tiered item
not on the drift allowlist sits exactly on its line and total; the allowlist may only
shrink (an entry that conforms fails the test). Run against the release catalog with the final
guard it reds on 298 floor failures and 286 line failures (the review's reproduction;
the draft guard's first run, before the WARFARE split and the allowlist trims, read 277
and 231).

**The content change** (`scripts/stamina_baseline_codemod.ts`, receipt in
`tmp_stamina_study/data/codemod_receipt.txt`): 306 literals in 20 content files.
Stamina rose to its baseline; caster items whose Intellect plus Spirit sat under the
line (the crucible-style caster tiers, Stormcaller, Soulflame, the badge jewelry, the
Deathless Heartwood) had the deficit filled with Spirit; the 49 physical pieces were
trimmed; allowlisted drift items got the floor only. Two hand edits: Kingsbane's Last
Oath and the Deathless Heartwood carry one Stamina above their own baseline so their
heroic variants, which copy the base at a tier the source index prices higher, meet
that tier's floor (both are on the drift list). The crucible caster profile became
`{ int: 17, spi: 8 }` and the healer profile `{ int: 14, spi: 11 }` (one Intellect
more on the healer waist from the ratio; the chest is exact).

**The dev best-in-slot scorer** (`src/sim/dev/bis_gear.ts`) had to become identity
aware: it ranked by a raw five-stat sum, and under the model that sum dressed every
class in caster gear. It now counts the class line plus stamina and armor. Three
reference kits moved as a result and their pins were re-measured with the cause named:
the balance druid probe (which had been wearing the Ashveil physical set and a
Strength ring by accident of the old sum; moongrove damage 3655 to 5956), the feral
and Bruin fixtures (caster jewelry to physical jewelry), and the friendly practice
dummy's reference tank body (1382 to 1822 HP, same cause plus the two trims).

**The max-health audit** (section 6, re-read on this branch): every percent-of-max
effect scales with the pool and keeps its relative strength (Cauterize, Second Wind,
the crafted collection absorbs and overheal caps, the Oathpyre and Stonehearth set
effects, the fear-break threshold, pet health at `PET_OWNER_HP_SHARE`). The one raid
demand effect is Varkhul: Red Hot Metal's damage and heal absorbs are a fraction of the
target's max HP, so on a caster they grow by the same third the pool did while healer
output does not; the absorb takes proportionally longer to clear on casters, offset by
the caster surviving the raw damage it was dying to. The 6 Sep Varkhul Monte Carlo
worktree no longer exists, so the heroic remeasure is owed on PBE, not here.

## 9. Review round (2026-09-10 to 11): what the reviewers found and what was decided

Three read-only reviewers (the QA checklist, the content-obligations reviewer and the
test-coverage auditor) ran over the first three commits. Their findings and the
resolutions, so the next reader does not rediscover them:

- **Seven more suites pinned the old stat lines** (trophy domination claims, the R5
  envelope probe, the retired heroic items, professions masterwork and crafting, the
  inscription catalog, the WARFARE gear tier). All re-pinned to the model with the
  cause named in each; none loosened.
- **The masterwork and Perfecting bonus generators were not on the model.** Both
  distributed the line delta over the item's live profile, which now carries stamina,
  so a crafted caster piece's bonus had silently become `sta 1, int 1, spi 0`. They now
  use `tierDeltaStats` (`src/sim/item_budget.ts`): the line delta over the offense
  identity plus, for a caster profile, the growth of the free baseline between the two
  lines (`int 1, spi 1, sta 1` on the level-9 vestments). Physical profiles keep the
  historical delta exactly. Already-persisted bakes (`rolled.stats` on copies crafted
  or Perfected before this lands) keep their old delta: they are grandfathered, one
  Stamina short of a fresh bake, and no migration is run. The masterwork acceptance
  bound ("a masterworked craft stays strictly below the raid floor") is now judged
  like for like, the raid line's model total against the masterwork's model total.
- **A heroic variant of an over-budget base lost one Intellect** (`heroic_moonshroud_robe`,
  base on the drift list). The variant generator recovered the base's line by inverting
  the model total, which only holds for on-model items. It now reads the realized line
  budget from the stats (Intellect plus Spirit plus the premium on any stamina above
  the baseline), so a variant never carries less of any stat than its base; the guard
  pins that for every `heroicOf` item.
- **The reference bodies that moved with the identity-aware picker** are all re-pinned
  with the cause named: the balance druid probe, the feral and Bruin fixtures, the
  friendly practice dummy (1,382 to 1,822 HP), the R5 envelope tank table (3,532 to
  3,642) and the heroic difficulty floors' max-armor prot kit (1,582 to 1,922). In every
  case the tank had been wearing caster jewelry a raw five-stat sum tied it with; it now
  wears its own. The difficulty floors and `REF_ARMOR` are not retuned, the same
  maintainer decision the previous re-pin recorded. The spec-less picker takes the line
  of the class's first-listed spec (talent-tree order), which is the pick the raw sum
  already landed on for paladins, shamans and druids; it is now stated in the scorer.
- **The retired v0.24.2 restoration defs** (`soulforged_warplate`, `soulrend_diadem`)
  stay on the model: a player still wearing one must not be the only caster without
  stamina. Their frozen identity is the id, name, kind, slot, armor type and armor
  value; the stat line follows the model like every other item.
- **The crucible caster and healer collections gain Spirit, not only stamina.** They
  were authored physical-style (Intellect plus stamina inside the line). On the caster
  line their stamina became free and the line was filled with Spirit: the caster chest
  goes from `int 17, sta 8` to `int 17, spi 8, sta 8`, stat-identical to the raid chest of
  the same level; the healer chest from `int 14, spi 7, sta 4` to `int 14, spi 11, sta 8`
  (the healer waist gains one Intellect from the profile ratio). That is a regen gain
  for crucible-geared casters and healers of eight Spirit on a chest; no Spell Power
  moves.
- **The drift allowlist is split.** The WARFARE honor tier is priced at a deliberate
  fraction of its slot budget and is exempt from the exact-line check permanently
  (`FRACTIONAL_BY_DESIGN`, built from `FURY_STOCK`); the remaining 103 drift items sit on
  `STAT_DRIFT_ALLOWLIST` under a ratchet that can only go down. The WARFARE budget
  test now bounds each piece's line by its fraction target, and the honor-versus-badge
  jewelry check keeps its tie (11 and 11 on rings, 12 and 12 on necks) pinned as
  literals; that tie is the maintainer decision the reviewers flagged, since the stamina
  floor brought the best honor jewelry exactly level with the worst badge piece.
- **Sixteen authoring comments** on the badge jewelry, the crafted apex pieces and the
  rift caster gear quoted the old "int plus sta equals budget" arithmetic; each now
  names the line and the free baseline separately.
- **Two constants are the model's own, not classic-era formulas:** the one-third share
  and the premium of one. The share is fitted to this catalog's physical convention
  (33 to 40 percent at every quality) and the crucible caster collections; the premium is
  a placeholder so tank stamina can be priced differently by changing one number. Both
  are maintainer-review items, recorded here rather than claimed as verified.
- **The full-suite gate found five more** (the selective gate falls back to the whole
  suite for a content change): the rogue DPS fixture had pinned the caster jewelry the
  raw-sum picker gave rogues by accident (it now wears Ignivar's Ember Choker and the
  Seal of the Forgewall; the three-seed bands held); the affliction five-minute mana
  corridor widened from 0.12 to 0.30 because the Deathless Heartwood, authored with its
  stamina inside its line, took its line back as Spirit (25 to 43) and the warlock kit's
  badge jewelry and Soulflame pieces gained Spirit the same way, so a quarter of the
  pool survives the window (no Spell Power moved; starvation still binds); the PBE boost
  tank tripwire now states its premise on the tank offense stat, since every item carries
  stamina; the professions blob ledger records the 249 bytes the model-aware bakes add;
  the Windows path scan only timed out under full-suite IO load.
- **Still owed after this PR:** the drift cleanup (the 103 allowlisted items and the
  PvP set's line, which is nine short of the caster line by design), the Varkhul heroic
  remeasure on PBE, and an identity-aware `itemScore` for the HUD's cross-identity
  comparisons (a caster piece now scores a third higher than the physical piece of the
  same tier in the raw score).
