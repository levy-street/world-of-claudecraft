# PRD: Heroic Dungeon Itemization and the Endgame Loot Ladder

| | |
|---|---|
| **Status** | Draft. Follow-up to the shipped heroic system (PR #1575), closing the itemization and balance items that PR left open |
| **Owner** | design |
| **Created** | 2026-07-09 |
| **Scope** | Loot itemization only: the item levels and stat budgets of heroic dungeon rewards. Difficulty tuning is a secondary section (section 8). No new geometry, mobs, currencies, or vendors |
| **Related systems** | Item level and stat budget (`src/sim/item_level.ts`: `itemLevel`, `expectedStatBudget`, `RAID_ILVL_BONUS`, `isRaidMob`), heroic drop table (`src/sim/content/heroic_loot.ts`: `HEROIC_LOOT_SOURCE_LEVEL`, `HEROIC_BOSS_LOOT`), heroic vendor stock (`src/sim/content/heroic_vendor.ts`: `HEROIC_VENDOR_SOURCE_LEVEL`), difficulty tuning (`src/sim/content/dungeon_difficulty.ts`: `HEROIC_DUNGEON_TUNING`), budget tests (`tests/item_level.test.ts`) |
| **Companion docs** | `docs/prd/mythic-plus-and-forged.md` (builds on this heroic layer; its forge math assumes the ladder this PRD sets) |

Hook-point line numbers drift as the tree moves; trust the symbol, not the line.

---

## 1. Summary

The heroic dungeon system shipped in full (PR #1575, merged into `release/v0.23.0`
on 2026-07-07): a `DungeonDifficulty` the party leader selects, TBC-calibrated
health/damage/armor tuning, Heroic Mark participation drops with a daily income
gate, a heroic-only epic loot table, and the Heroic Quartermaster jewelry vendor.
The mechanism is well tested and was reviewed clean by the architecture and
test-coverage auditors.

The itemization defects in section 4 are still live on the current release branch
(`release/v0.24.0`): `HEROIC_LOOT_SOURCE_LEVEL` is still 25 and the heroic raid flag
is still hardcoded off, so every heroic epic reads item level 31. The one heroic
change since #1575, PR #1693 ("equalize heroic dungeon difficulty at level 22"),
retuned the combat multipliers in `dungeon_difficulty.ts` across the four dungeons; it
does not touch loot, and equalizing the fights while the reward ladder stays inverted
makes the mismatch sharper, not milder.

Two things it left open, by its own account. The itemization was never part of the
reviewed core (PR #1575's body: "No vendor or lockout in this pass"); the loot table
and vendor landed in a follow-up. And the last line of PR #1575's own test plan is an
unchecked box: "Balance pass on the heroic tuning multipliers (1.03 to 1.15 are
placeholders; only hollow_crypt's are literal-pinned by tests)."

This PRD closes the itemization half. It sets one coherent endgame loot ladder and
fixes two concrete defects in the shipped numbers. It does not touch the difficulty
mechanism, the marks economy, the vendor's existence, or the encounter scripts.

## 2. The ladder, in one line

```
normal 5-man (ilvl 26)  <  heroic 5-man (ilvl 28)  <  normal raid (ilvl 29)  <  heroic raid (ilvl 31)
```

Two rules generate the whole thing:

- **Heroic is worth +2 item levels over normal**, in both roles (5-man and raid).
- **The raid is worth +3 item levels over the 5-man**, in both difficulties. This is
  the existing `RAID_ILVL_BONUS`; the ladder just applies it inside the heroic tier
  too, exactly as it already applies inside the normal tier.

## 3. Current state in the codebase

Item level is `sourceLevel + qualityBonus + raidBonus`
(`src/sim/item_level.ts` `itemLevel`). Epic quality is +6; `RAID_ILVL_BONUS` is +3
and applies when the item's best source is a 10-player encounter (`isRaidMob`, which
reads the encounter's player count against `RAID_MIN_PLAYERS`). Stat budget is
`round(itemLevel * qualityStatMult * slotStatMult * STAT_PER_ILVL)` with
`STAT_PER_ILVL = 0.7`; `tests/item_level.test.ts` pins every drop's stat sum exactly.

Where the four rungs sit today:

| Source | Formula | Item level |
|---|---|---|
| Normal 5-man epic (e.g. Korzul's `deathlords_dread_visage`) | 20 + 6 | **26** |
| Normal raid epic (e.g. Nythraxis's `crownforged_dreadhelm`) | 20 + 6 + 3 | **29** |
| Heroic 5-man epic (all four dungeons) | `HEROIC_LOOT_SOURCE_LEVEL` 25 + 6 | **31** |
| Heroic raid epic (Nythraxis) | `HEROIC_LOOT_SOURCE_LEVEL` 25 + 6, raid flag forced off | **31** |

The heroic loot loop registers every heroic drop at source level 25 with `raid: false`
hardcoded, even for the raid boss (`src/sim/item_level.ts`, "Heroic boss drops"
comment: "Flat across the five bosses BY DESIGN (raid=false even for Nythraxis)").

## 4. The problem

**Defect 1: heroic 5-man loot outranks the normal raid.** A five-person heroic dungeon
drops ilvl 31 gear; the ten-person raid's normal mode drops ilvl 29. The more
accessible content gives the better reward. The raid costs more to run (ten players,
the `q_nythraxis_bound_guardian` attunement, a shared daily lockout) and pays less. A
geared group has no item-level reason to run the normal raid at all, so half of the
game's only raid becomes dead content.

**Defect 2: the heroic raid has no premium over the heroic 5-man.** Both are ilvl 31.
Inside the heroic tier, clearing the raid gets you nothing a heroic 5-man did not
already give. The raid's whole cost buys zero itemization edge. This is the clearer
mistake of the two: it is not a taste call, it is the raid bonus silently not applying
where it should.

## 5. The argument: why heroic 5-mans should NOT beat the normal raid

The tempting move is to say difficulty is the reward axis, so a brutal heroic 5-man
(this game runs 3.4x to 4.6x damage multipliers on heroic) should out-reward an easier
raid. Reject that here, for one structural reason: **there is exactly one raid.**

If five people in a heroic dungeon out-gear the normal raid, nobody forms the raid's
normal mode, and the single raid the game has loses half its content. Item level is the
only lever that pays back what a raid costs over a 5-man (double the players, an
attunement quest, a shared lockout). Spend it there. A game with a deep raid tier can
afford to let heroic 5-mans straddle an early raid, because the raid ladder continues
above it. This game's raid ladder is one rung tall, so the rung has to stay on top.

The difficulty-deserves-reward instinct is still right; it just gets paid a different
way. Heroic 5-mans are worth running because:

- their gear is a real **+2** upgrade over normal 5-man drops (ilvl 26 to 28), and lands
  right at the normal raid's shoulder, so a group that cannot field ten can still gear
  to near-raid power;
- they are the **only** source of neck and ring jewelry (the Heroic Quartermaster), a
  slot the raid does not fill;
- they pay Heroic Marks.

That is reward for difficulty without gutting the raid. The heroic raid then sits alone
at the top (ilvl 31), which is what a raid is for.

This also keeps the companion `mythic-plus-and-forged.md` PRD internally consistent: its
stated forge principle is that a Valeforged (+2 ilvl) heroic piece "approaches but does
not pass its raid peer." Under today's numbers a Valeforged heroic 5-man piece is ilvl
33, far above the ilvl 29 raid. Under this ladder it is ilvl 30, which approaches the
ilvl 31 heroic raid without passing it. The forge doc's own rule only holds if this
ladder is in place.

## 6. Functional requirements: the loot ladder

### 6.1 Heroic drops read source level 22, and the raid boss carries the raid flag

- **FR-1.** `HEROIC_LOOT_SOURCE_LEVEL` drops from `25` to `22`
  (`src/sim/content/heroic_loot.ts`). Heroic epic 5-man drops become ilvl 22 + 6 = **28**.
- **FR-2.** The heroic loot registration loop (`src/sim/item_level.ts`, "Heroic boss
  drops") stops hardcoding `raid: false`. It passes `isRaidMob(bossId)` per boss, keyed
  off `HEROIC_BOSS_LOOT`'s boss id. The Nythraxis arena is a 10-player encounter, so its
  heroic drops become ilvl 22 + 6 + 3 = **31**; the four 5-man bosses stay non-raid at
  **28**. Net effect: heroic raid item level is unchanged (still 31), heroic 5-man item
  level drops from 31 to 28.
- **FR-3.** No change to `RAID_ILVL_BONUS`, `QUALITY_ILVL_BONUS`, `STAT_PER_ILVL`, or the
  slot/quality multiplier tables. The ladder is expressed entirely through source level
  and the existing raid flag, so the normal tier (26 / 29) is untouched.

### 6.2 Re-itemize the four 5-man heroic sets to their new budget

Every 5-man heroic epic (the Morthen, Vael, Ysolei, and Korzul groups in
`HEROIC_BOSS_LOOT`) drops from ilvl 31 to 28, so its stat budget falls and its authored
stats must be re-pointed to the new exact budget. `tests/item_level.test.ts` enforces the
sum, so this is mandatory, not cosmetic. The Nythraxis heroic group stays at ilvl 31 and
is **not** re-pointed.

New primary-stat budgets (epic quality, `round(28 * slotMult * 0.7)`), with the current
ilvl-31 budget shown for the delta:

| Slot | Budget now (ilvl 31) | Budget new (ilvl 28) |
|---|---|---|
| mainhand | 22 | 20 |
| chest | 22 | 20 |
| legs | 20 | 18 |
| helmet | 18 | 17 |
| shoulder | 16 | 15 |
| waist | 15 | 14 |
| gloves | 15 | 14 |
| feet | 14 | 13 |

- **FR-4.** Re-point each 5-man heroic piece's primary stats to the new budget, keeping
  its existing stat identity (its str/agi/int/sta/spi ratio) and `requiredClass`
  archetype. The redistribution helper in `item_level.ts` already documents the
  largest-remainder rule the tests expect.
- **FR-5.** Reduce each 5-man heroic weapon's base damage (`weapon.min`/`weapon.max`)
  proportionally to the item-level drop (28/31, about a 10% cut), so weapon power tracks
  the ladder. The budget test only pins primary stats, not weapon DPS, so this is a
  judgment requirement, not a test-forced one: without it, a heroic 5-man weapon keeps
  raid-tier damage while its stat line drops, which reopens defect 1 through the back
  door. Keep `itemScore` (stats + armor + weapon DPS) monotonic along the ladder.
- **FR-6.** Armor values follow the existing convention for a level-20 epic of that armor
  type and slot. If armor is authored off character level (20) rather than item level, it
  does not change; confirm against how the normal 5-man epics are authored and match that,
  so heroic and normal 5-man pieces of the same slot/type carry consistent armor.

### 6.3 Heroic vendor jewelry joins the heroic 5-man band

- **FR-7.** `HEROIC_VENDOR_SOURCE_LEVEL` rises from `20` to `22`
  (`src/sim/item_level.ts`), so the Quartermaster's neck and ring epics read ilvl 22 + 6 =
  **28**, matching the heroic 5-man drops. Rationale: jewelry is bought with Heroic Marks,
  which only heroic content pays, so it is heroic-tier reward and belongs in the heroic
  5-man band, not the normal-5-man band (ilvl 26) it sits in today. New jewelry budgets:
  ring 12 (from 11), neck 13 (from 12). Re-point the vendor stock's stats to the new
  budgets. Mark **prices** do not change in this PRD (see non-goals).

## 7. Acceptance

- Normal tier unchanged: `itemLevel` of `deathlords_dread_visage` is 26 and
  `crownforged_dreadhelm` is 29.
- `itemLevel` of every drop in the four 5-man heroic groups is **28**; every drop in the
  Nythraxis heroic group is **31**.
- `itemLevel` of every Heroic Quartermaster piece is **28**.
- `expectedStatBudget` equals the realized `primaryStatSum` for every re-pointed item
  (the existing budget-exactness sweep in `tests/item_level.test.ts` stays green after its
  expected values are updated).
- `itemScore` is strictly increasing across the four ladder rungs for a like-for-like
  slot (e.g. a heroic 5-man chest scores below the normal raid chest, which scores below
  the heroic raid chest).
- Command: `npx vitest run tests/item_level.test.ts` and `npx vitest run tests/heroic_vendor.test.ts`.

## 8. Secondary: the tuning-multiplier balance pass (open, not resolved here)

PR #1575 shipped the difficulty multipliers in `HEROIC_DUNGEON_TUNING` and flagged them as
placeholders; only `hollow_crypt`'s are literal-pinned by tests. This PRD does not set new
combat numbers (the invariant is that balance follows the calibration target, not
invention). It records the open item and the method:

- The stated calibration target is the TBC-heroic experience against a geared level-20
  roster: a final boss chews a tank for ~18 to 28% of max HP per swing, trash melee takes
  ~30 to 55% of a clothie per hit, boss melee on cloth is near a two-shot
  (`dungeon_difficulty.ts` header comment). Validate the shipped `damageMultiplier` /
  `healthMultiplier` / `armorMultiplier` per dungeon against that target with a headless
  combat harness over the geared-20 reference kit, and pin whichever bands the pass
  confirms (today only `hollow_crypt` is pinned).
- Keep this out of the loot slices; itemization can ship and be validated independently
  of the combat-tuning pass.

## 9. Non-goals

- No change to the difficulty selection flow, instance lifecycle, marks drops, daily
  gate, lockout, or encounter scripts.
- No change to Heroic Mark **prices** at the vendor (a separate income-vs-cost tuning
  question).
- No new currency, vendor, affix, forge, or mythic tier (those are
  `mythic-plus-and-forged.md`).
- No re-itemization of the normal tier (5-man 26, raid 29 stay as authored).
- No new combat balance numbers (section 8 is scoped to validation, not invention).

## 10. Implementation slices

Dependency-ordered; each has a green-able acceptance command.

- **S1: ladder plumbing.** FR-1, FR-2, FR-3. Change `HEROIC_LOOT_SOURCE_LEVEL` to 22 and
  pass `isRaidMob(bossId)` in the heroic loot loop. Update the ilvl expectations in
  `tests/item_level.test.ts` (heroic sweep: 5-man drops 28, raid drops 31). This slice
  alone turns the budget sweep red on the 5-man pieces, which S2 fixes.
  Accept: `npx vitest run tests/item_level.test.ts` shows the four 5-man groups at ilvl 28
  and the Nythraxis group at ilvl 31 (budget assertions still red until S2).
- **S2: re-itemize the 5-man heroic sets.** FR-4, FR-5, FR-6. Re-point the Morthen / Vael
  / Ysolei / Korzul stat lines and weapon damage to the ilvl-28 budgets in the table above.
  Accept: `npx vitest run tests/item_level.test.ts` fully green.
- **S3: heroic vendor band.** FR-7. Raise `HEROIC_VENDOR_SOURCE_LEVEL` to 22 and re-point
  the jewelry stats (ring 12, neck 13).
  Accept: `npx vitest run tests/heroic_vendor.test.ts` and `tests/item_level.test.ts` green.
- **S4: gate.** `npm run gate` on the rebased branch (i18n freshness, changed-files biome,
  full Vitest, tsc, builds). No new player strings are introduced (item ids and names are
  unchanged; only numeric stats move), so no i18n work is expected; confirm the S3 i18n
  guard stays green.

## 11. Test impact and gotchas

- **The budget sweep is the load-bearing test.** `tests/item_level.test.ts` asserts exact
  ilvl (currently 31 for all heroic drops) and exact stat sums. Both the ilvl assertions
  and the per-item budget expectations move; update them in lockstep with the content.
- **G1: do not re-point the Nythraxis heroic group.** It stays at ilvl 31. Only the four
  5-man groups drop to 28. Passing the raid flag (FR-2) is what holds Nythraxis at 31 while
  the others fall; verify `isRaidMob('nythraxis_scourge_of_thornpeak')` returns true (it
  reads the arena's 10-player count) before assuming the flag lands.
- **G2: no rng, no draw-order risk.** Item levels and budgets are pure functions of the
  static content tables (`buildSourceIndex` is memoized, rng-free), so this change cannot
  move a parity golden. If any `tests/parity` digest churns, something unintended touched
  the sim; stop and investigate.
- **G3: stat identity, not just sum.** The budget test checks the sum; a reviewer should
  check that each re-pointed piece kept its intended ratio and class audience, so a
  strength plate piece does not accidentally become balanced spellcaster gear when
  redistributed.
- **G4: weapon DPS is unpinned.** FR-5 is not enforced by a test today. Consider adding a
  monotonicity assertion (heroic 5-man weapon `itemScore` below its normal-raid peer) so
  the ladder is guarded, not just documented.
