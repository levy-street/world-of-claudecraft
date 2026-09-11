# Class health table: uniform stamina per level and the cloth HP-per-level lift (2026-09-11)

Owner decision (Reuben, 11 Sep 2026), taken on the numbers in
`docs/design/gear-stamina-baseline-2026-09-10.md`: once gear health became a pure
function of item level (the stamina baseline model, PR 3993), the class table in
`src/sim/content/classes.ts` was the only class-dependent health lever left, and it was
still the inherited split it had always been: five classes at 2 Stamina per level, four
at 1, and HP per level from 11 (priest) to 18 (warrior). The owner chose the middle of
three options: every class at 2 Stamina per level, and HP per level lifted to 15 for the
cloth classes and the priest. Guard: `tests/class_health_table.test.ts`.

## The change

| Class | Stamina per level | HP per level | Naked at 20, before to after |
|---|---|---|---|
| mage | 1 to 2 | 12 to 15 | 418 to 665 |
| warlock | 1 to 2 | 12 to 15 | 430 to 677 |
| priest | 1 to 2 | 11 to 15 | 387 to 653 |
| rogue | 1 to 2 | 15 | 510 to 700 |
| warrior, paladin, hunter, shaman, druid | 2 | 18, 17, 15, 15, 13 | unchanged (822, 808, 725, 733, 662) |

Base health and base stats are untouched. A point of Stamina per level is 190 HP at
the cap; a point of HP per level is 19.

## Why this option

Three options were measured at raid best-in-slot (the item-table scorer over every
epic, mean item level 34 to 35, so the top of the current tier), against two anchors:
the owner's 6 September target of a comparably geared mage at 85 to 95 percent of
ordinary physical DPS, and the heroic Bone Spike at 1,000 damage.

| Option | Mage at raid BiS | Share of arms warrior | Share of MM hunter | Spike as share of pool |
|---|---|---|---|---|
| Table as shipped | 1,098 | 63% | 67% | 91% |
| 2 Stamina per level only | 1,288 | 74% | 78% | 78% |
| 2 per level plus cloth 15 HP per level (chosen) | 1,345 | 77% | 82% | 74% |
| 2 per level plus cloth at the warrior's 18 | about 1,400 | 80% | 85% | 71% |

The chosen row is where classic-era gearing put a raid mage against a DPS warrior
(about four fifths), keeps the plate classes on top through HP per level and armor
rather than through a stamina rule casters could not touch, and takes cloth out of the
range where any prior damage makes the heroic spike a kill. The last row was rejected
because at that point cloth fragility stops being a class identity at all.

## Measured outcome

Raid best-in-slot, level 20, after this change (`tmp_stamina_study/raid_bis_hp.ts`):

| Spec | HP | Share of arms warrior (1,752) |
|---|---|---|
| mage (all three) | 1,345 | 77% |
| priest shadow / holy / disc | 1,333 / 1,333 / 1,504 | 76 to 86% |
| warlock affl / destro / demo | 1,357 / 1,417 / 1,567 | 77 to 89% |
| rogue (all three) | 1,700 | 97% |
| druid balance | 1,352 | 77% |
| shaman elemental | 1,473 | 84% |
| hunter MM / BM | 1,645 / 1,777 | 94 to 101% |
| tanks: prot warrior / prot paladin / feral | 2,462 / 2,368 / 1,872 | unchanged |

The parse best-in-slot kits (`tmp_stamina_study/hp.ts`) move the same way: fire mage
988 to 1,235, shadow priest 1,087 to 1,363, destruction 1,130 to 1,377, combat rogue
1,360 to 1,570.

While leveling (best uncommon or rare gear at each level, `tmp_stamina_study/leveling.ts`)
the change lands cloth within a few percent of leather and mail, because gear stamina
is a smaller share of the pool there:

| Level | Fire mage | Combat rogue | MM hunter | Arms warrior |
|---|---|---|---|---|
| 8 | 365 | 410 | 415 | 516 |
| 12 | 535 | 590 | 585 | 748 |
| 16 | 795 | 900 | 915 | 1,070 |
| 20, no epics | 1,135 | 1,180 | 1,185 | 1,332 |

## PvP time-to-kill, the proxy

Heals and absorbs carry no PvP scaling in this game, so more health on cloth is a
straight time-to-kill change. Using the heroic dummy bench DPS from the gear study as
the burst proxy (combat rogue 207.6, fury 166.8, arms 132.6, no PvP mitigation applied):
a raid-geared mage survives a combat rogue for 5.3 seconds before this change and 6.5
after; a fury warrior 6.6 to 8.1; arms 8.3 to 10.1. Rogues gain the same 190 HP from
the stamina rule, so rogue-versus-rogue is unchanged. This is a proxy, not a measured
arena: the real check is the PBE duel round the gear PR already owes.

## What moves with it

- Every persisted character's pool changes on next load (the class table is read live;
  nothing is stored), so the change is visible the moment it deploys. A stored absolute
  `hp` loads under the larger `maxHp`, so cloth characters come in below full on their
  first load after deploy: harmless, and the symptom to expect in that day's reports.
- Warlock and hunter pets inherit a quarter of the owner's health (`PET_OWNER_HP_SHARE`),
  so warlock pets gain about 60 HP.
- Parity goldens re-minted (player health in every trace with a cloth, priest or rogue
  character).
- The heroic difficulty floors, the practice dummy and the R5 envelope are calibrated
  on the prot warrior, which does not move.

## Live versus proposed, on real kits

Live is the release base before either PR (b276778485, the same probes run on a
sparse checkout of it); proposed is this branch (3993 plus 3995). The parse best-in-slot
kits are the strongest observed live loadouts, so they are the faithful comparison at the
cap; the leveling rows wear the best uncommon or rare piece per slot at each level.

| Spec | Naked at 20 | Parse best-in-slot at 20 | Leveling L8 | L12 | L16 | L20 blues |
|---|---|---|---|---|---|---|
| mage fire | 418 to 665 | 638 to 1,235 | 204 to 365 | 302 to 535 | 450 to 795 | 708 to 1,135 |
| mage frost | 418 to 665 | 718 to 1,295 | | | | |
| priest shadow | 387 to 653 | 797 to 1,363 | 185 to 353 | 279 to 523 | 423 to 783 | 677 to 1,123 |
| warlock destruction | 430 to 677 | 790 to 1,377 | 276 to 437 | 374 to 607 | 522 to 867 | 780 to 1,207 |
| warlock affliction / demonology | 430 to 677 | 730 to 1,317 / 760 to 1,477 | | | | |
| druid balance | 662 (same) | 882 to 1,352 | 316 to 386 | 428 to 528 | 640 to 820 | 932 to 1,112 |
| shaman elemental | 733 (same) | 1,023 to 1,393 | | | | |
| rogue combat | 510 to 700 | 1,230 to 1,570 | 340 to 410 | 470 to 590 | 750 to 900 | 980 to 1,180 |
| rogue assassination / subtlety | 510 to 700 | 1,150 to 1,400 / 1,140 to 1,390 | | | | |
| hunter marksmanship | 725 (same) | 1,415 (same) | 415 (same) | 575 to 585 | 915 (same) | 1,185 (same) |
| hunter beast mastery | 783 (same) | 1,582 to 1,669 | | | | |
| warrior arms | 822 (same) | 1,722 (same) | 506 to 516 | 738 to 748 | 1,070 (same) | 1,322 to 1,332 |
| warrior fury / paladin ret / shaman enh | same | 1,872 / 1,738 / 1,773 (same) | | | | |

Healers and tanks on the parse kits: holy paladin 1,008 to 1,428, discipline 731 to 1,440,
holy priest 797 to 1,453, restoration shaman 1,023 to 1,393, restoration druid 842 to
1,272, prot warrior 2,452 to 2,562, prot paladin 2,388 to 2,498, feral 1,852 to 1,892.

The live catalog's best-in-slot picker is not a usable live anchor: it ranked by a raw
five-stat sum and dressed every physical class in caster pieces (a live warrior "raid
best-in-slot" reads 1,312 against its real parse kit's 1,722), which is one of the things
3993 fixed. The proposed raid best-in-slot column in the section above stands on its own.

## Two things the larger pools exposed

- **The potion ladder is sized against the old priest pool.** The vendor healing potions
  (110 / 190 / 279) restored 72 to 90 percent of a naked priest at the three zone
  bracket tops; on the new pools (198 / 408 / 653) they restore 56 / 47 / 43 percent, and
  the crafted alchemy ladder (120 / 200 / 335) the same. This is the "fixed heals get
  relatively weaker" consequence the stamina audit named. Restoring the documented
  fractions means roughly 143 to 178, 294 to 367 and 470 to 588 on the vendor rungs, the
  crafted ladder alongside (its values are quoted in the guide prose in every locale)
  and the vendor-versus-crafted ordering law, so it is its own PR, issue 4000; this one
  pins the measured fractions so the ladder cannot drift further unnoticed. The mana
  ladder is out of that issue's scope: Intellect per level and base mana did not move,
  so the mana potion band still holds.
- **Sacrilegious March lingered a tick on pools not divisible by five.** The drain
  clamps health to a ceiling-rounded floor and then tested the fraction, so on a
  677-HP warlock the clamped value sat a hair above 20 percent and the march ended one
  second late with a zero-damage tick. It now compares in health units
  (`src/sim/combat/warlock_talents.ts`); the existing talent test covers the case.

## Still owed

The potion ladder re-size above. The PBE duel and Varkhul heroic checks the gear PR owes
cover this change as well; the drift cleanup and the identity-aware item score are
unchanged by it.
