# PRD: Mythic+ Keystone Ladder and Forged Drops

Status: draft for design review. Numbers marked tunable are placeholders
sized against the live heroic economy.

Supersedes `docs/prd/heroic-mythic-dungeons.md` and `docs/prd/badges.md`
(both researched against release/v0.20.0 and merged before reconciliation
with the heroic systems that shipped in the meantime; see PR #1336 review).
Companion doc that still stands on its own:
`docs/prd/dungeon-mechanic-primitives.md`.

## 1. Summary

Two features, one dependency chain:

- **Mythic+:** an untimed, uncapped keystone ladder above the SHIPPED
  heroic difficulty. Each keystone level compounds enemy health and
  damage; affixes activate at fixed thresholds, reusing the delve affix
  content model. Rewards ride the EXISTING Heroic Mark economy and a
  daily-gated end-of-run chest. No new currency, no new vendor.
- **Forged drops:** heroic and mythic+ gear can drop upgraded. Valeforged
  raises an item by 2 item levels; Swiftforged rolls a 3 to 5% movement
  speed bonus. Forge data rides the professions item-instance payload
  (`ItemInstancePayload`); the enabling change is equipment carrying the
  instance payload.

## 2. What already shipped (the reality this doc builds on)

Verified on release/v0.23.0 at 354429a38:

- **Heroic difficulty is live** for all four 5-player dungeons and the
  raid arena: `HEROIC_DUNGEON_TUNING` in
  `src/sim/content/dungeon_difficulty.ts` (per-dungeon health, damage,
  and armor multipliers, level pinned to 20, TBC-calibrated), applied at
  spawn by `claimInstance` (`src/sim/instances/dungeons.ts`), with
  `DungeonDifficulty = 'normal' | 'heroic'` (`src/sim/types.ts:102`) on
  the instance slot and a per-difficulty door claim.
- **The marks economy is live:** `awardHeroicMarks`
  (`src/sim/instances/dungeons.ts:345`) drops Heroic Marks
  (`heroic_mark`, `src/sim/content/items.ts`) as personalFor slots on the
  heroic final-boss corpse, gated per dungeon per UTC day via
  `meta.heroicDaily` (at most 4 marks a day across the four dungeons,
  marksPerParticipant 3 for the raid), and locks each participant with
  `heroicLockoutId(dungeonId)` until the daily reset.
- **The vendor is live:** the Heroic Quartermaster
  (`src/sim/content/heroic_vendor.ts`) sells the game's only neck/ring
  jewelry for marks.
- **Heroic-only loot is live:** `src/sim/content/heroic_loot.ts` (epic
  table on heroic final bosses).
- **The instance payload is live** (#1165/#1174): `ItemInstancePayload`
  (`src/sim/types.ts:566`: `signer`, `charges`, `rolled` stats,
  `boundTo`), `cloneInvSlot` deep-clone discipline at save/load
  boundaries, and the market's block on listing instanced items. Bags
  carry instances; **equipment does not yet**.
- **The affix content model exists** in the delves:
  `src/sim/content/delves/affixes.ts` (declarative per-tier records).
- **Movement speed has one hook:** `moveSpeedMult`
  (`src/sim/player_motion.ts:53`), shared bit-for-bit by the live Sim and
  the client extrapolator (pinned by `tests/player_motion.test.ts`).
- **UTC-day gating has a convention** (`ctx.utcDay`, host-stamped, empty
  means never-reset: `heroicDaily`, `delveDaily`). There is **no UTC-week
  seam yet**; the chest's weekly rotation needs a host-injected week
  string modeled on `utcDay`.

What does NOT exist: any difficulty above heroic, keystone state, a
weekly seam, forge rules, or equipment-side instance payloads.

## 3. Goals

1. Give capped, geared players an uncapped ladder with a reason to
   re-run the same four dungeons at rising difficulty.
2. Zero new geometry, mobs, currencies, or vendors: scaling tables,
   affix records, and forge rules only. Mythic+ pays the SAME Heroic
   Marks into the SAME Quartermaster stock.
3. Untimed by design (the delve lockpick complaint): the failure state is
   wiping, and every reward lands on the kill or the clear, never behind
   a timer.
4. Forged drops add chase variance without moving best-in-slot: a
   Valeforged heroic piece approaches but does not pass its raid peer;
   Swiftforged is a new axis (speed) rather than more combat power.

### Non-goals

- No run timer, no depleting keystones, no key items in bags (v1 tracks
  the unlocked level per character per dungeon).
- No mythic+ raid; the raid keeps normal/heroic only.
- No forged drops outside heroic final bosses, heroic bonus loot, and
  mythic+ chests in v1 (no forged world-boss, delve, quest, or vendor
  gear).
- No second currency. If a future tier wants distinct tokens, that is a
  new PRD arguing against this one.
- No open-world difficulty scaling.

## 4. Functional requirements

### 4.1 Difficulty selection and instancing

- `DungeonDifficulty` extends to `'normal' | 'heroic' | 'mythic'`; the
  instance slot additionally carries `keystoneLevel: number` (0 for
  normal/heroic). The slot claim stays keyed by difficulty exactly as the
  shipped heroic claim is (`claimDifficultyForDungeon`).
- Mythic+ level N is selectable up to `bestCleared + 1` for that dungeon;
  a party may enter at `min(bestCleared across members) + 1`, so a friend
  can be pulled up one level but the ladder cannot be skipped.
- Difficulty and keystone level are fixed for the life of the instance
  (the shipped mid-run guard applies unchanged).
- `bestCleared` is per character per dungeon in `PlayerMeta` (JSONB
  additive, like `heroicDaily`).

### 4.2 Mythic+ scaling (data, not code)

- Starts at keystone level 2 (heroic is effectively level 1).
- Health and damage multiply by a compounding per-level factor on TOP of
  the dungeon's `HEROIC_DUNGEON_TUNING` record: start at 1.10 per level
  (tunable; 1.10 compounds to about 2.6x heroic at key 10). Armor does
  not compound (the heroic armor multiplier stands).
- The scaling record is a sibling of `HEROIC_DUNGEON_TUNING` in
  `src/sim/content/dungeon_difficulty.ts`; `applyHeroicMobTuning` grows a
  keystone-aware wrapper rather than a parallel path.
- Affixes activate at thresholds: one at key 4, a second at key 7, a
  third at key 10. Declarative records in the delve-affix style
  (`src/sim/content/delves/affixes.ts` is the template; mythic affixes
  are a sibling record set under `src/sim/content/`, for example:
  enemies enrage below 30% health, non-boss deaths pulse AoE, bosses
  summon adds at 50%).
- The active affix set rotates per UTC week, seeded through `Rng` from
  the week string so every host agrees and replays reproduce. This needs
  the new host-injected `utcWeek` (modeled exactly on `utcDay`; empty
  means the rotation never advances, same semantics as an empty day).
- **Untimed.** Wipes do not lower the unlocked level; the run can be
  re-pulled. Clearing level N sets `bestCleared = max(bestCleared, N)`.

### 4.3 Rewards: Heroic Marks and the chest

- **Marks, not badges.** A mythic+ final-boss kill awards Heroic Marks
  through the SAME `awardHeroicMarks` path and consumes the SAME
  per-dungeon `heroicDaily` slot as heroic: 2 marks (keys 2 to 4), 3
  (keys 5 to 9), 4 (key 10 and above). One paid kill per dungeon per UTC
  day across heroic and mythic+ combined; running both pays once, at the
  higher rate you cleared.
- The heroic daily lockout (`heroicLockoutId`) applies to mythic+
  instances of the same dungeon identically.
- **End-of-run chest:** personal loot per eligible contributor (the kill
  credit fan-out that already feeds `awardHeroicMarks` recipients).
  Grants one gear piece from the level-20 pool in a **rotating slot
  band**: the seeded weekly rotation (same `utcWeek` seed as affixes)
  cycles which slots the chest favors per dungeon, so repeat weeks
  target different slots.
- Chest quality scales with keystone level: rare at low keys, epic
  chance rising with level, capped below raid ubiquity (tunable table in
  the same content record).
- Paid chests: the first 2 mythic+ clears per character per UTC day,
  across dungeons (a `PlayerMeta` daily counter shaped like
  `delveDaily`). Further clears still pay marks (subject to 4.3's daily
  slot) and advance `bestCleared`, so ladder pushing is never pointless.
- Chest contents roll the forge table (4.4) at the run's keystone level.

### 4.4 Forged drops (Valeforged / Swiftforged)

Every gear item (kind weapon, or armor with a slot) dropped by a heroic
final boss, the heroic bonus table, or a mythic+ chest rolls once on the
forge table at drop time, through `Rng`, server-authoritatively:

| Tier | Effect | Heroic chance | Mythic+ chance (key N) | Cap |
|---|---|---|---|---|
| Valeforged | +2 item levels: every stat and armor value scales by the item-level budget curve (4.4.1) | 12% | 12% + 2% per key level | 40% |
| Swiftforged | `moveSpeedPct` rolled from 3, 4, or 5% (no stat bonus; speed is the whole prize) | 4% | 4% + 1% per key level | 15% |

#### 4.4.1 What "+2 item levels" computes to

Budgets are the empirical peer convention enforced by
`tests/item_level.test.ts` (the heroic vendor stock already leans on it:
ring budget 11, neck budget 12 at the epic bump). An item's implicit
level is the level of the content that drops it (20 for everything in
scope). Upgrading by 2 levels scales every stat and armor value by
`(L + 2) / L`, rounded to nearest, with a guard that the total non-armor
stat gain is at least 2 points. At L20 that is +10%. The scaled values
are frozen into the instance payload at drop time; later tuning never
mutates already-dropped items. The formula generalizes unchanged if
content above L20 ever exists.

#### 4.4.2 Roll and stacking rules

- Tiers are exclusive per drop; roll Swiftforged first, else Valeforged,
  else base. Fixed `Rng` draw order (determinism; a parity scenario pins
  it).
- The Swiftforged magnitude (3/4/5) is a second `Rng` draw, uniform at
  heroic; mythic+ weights shift toward 5 as the key level rises (weights
  in the forge content record).
- **Speed does not stack:** `moveSpeedMult` applies only the single
  highest equipped Swiftforged bonus (the classic minor-speed-enchant
  rule). Two Swiftforged pieces are a re-gear choice, not an additive
  win.
- Valeforged stat gains stack normally across slots (they are just
  stats).
- Forged drops are bind-on-pickup: the drop sets `instance.boundTo` to
  the looter, and the market's existing block on instanced items keeps
  them unlistable with zero new market code.
- Forge bonuses apply on top of the base `ItemDef` at stat-recalc time;
  content records are never mutated.

### 4.5 Data model: forge rides the item-instance payload

- `ItemInstancePayload` gains
  `forge?: { tier: 'valeforged' | 'swiftforged'; moveSpeedPct?: number }`.
  Valeforged bakes its scaled values into the existing `rolled.stats`
  (the professions semantics for rolled copies) and records the tier for
  display; Swiftforged carries only the rolled `moveSpeedPct`.
- Forged slots never stack (`count` 1), which instanced slots already
  guarantee; `cloneInvSlot` deep-clone discipline applies unchanged.
- **Equipment carries the instance (the enabling change):** a parallel
  map `equipmentInstance: Partial<Record<EquipSlot, ItemInstancePayload>>`
  beside `PlayerEquipment`, so every itemId code path (vendor, tooltips
  by id, wire) keeps working untouched; equip/unequip moves the payload
  with the item. This also future-proofs equipping signed or charged
  professions items.
- `recalcPlayerStats` (`src/sim/entity.ts`, the ONE derived-stats site)
  folds equipped `rolled.stats` over the base def; `moveSpeedMult` reads
  the single highest equipped `forge.moveSpeedPct`.
- Wire/persistence: instances serialize with equipment exactly as bag
  slots do today (JSONB additive; `cloneInvSlot` at both boundaries).

## 5. Phasing (each slice independently shippable)

1. **P1, equipment instances:** `equipmentInstance` map, equip/unequip
   payload movement, recalc fold, save/load round-trip, wire mirror in
   `ClientWorld`. No forge yet; pure enabling change with tests.
2. **P2, forge on heroic:** the forge content record, the drop-time roll
   on heroic final-boss and bonus loot, tooltip display, a parity
   scenario for the draw order, `moveSpeedMult` single-highest rule.
3. **P3, mythic ladder:** difficulty extension, keystone scaling record,
   `bestCleared`, entry gating, marks through `awardHeroicMarks` at the
   bracket rates.
4. **P4, affixes and the chest:** `utcWeek` seam, affix records and
   rotation, end-of-run chest with slot bands and the daily chest
   counter, forge rolls on chest contents.

Each phase lands with its guide/wiki regen where player-visible, the S3
i18n matcher entries for any new sim emits, and a `tests/parity` scenario
whenever new rng draw sites enter the stream.

## 6. Testing

- Unit: scaling math (compounding per level), bracket mark rates and the
  shared daily slot, `bestCleared` gating (entry at min+1), forge roll
  exclusivity and caps, the +2-item-level formula against the
  `tests/item_level.test.ts` budgets, single-highest Swiftforged.
- Parity: one scenario per new draw site (forge roll, chest roll, affix
  rotation seed).
- Round-trip: equipment instance payloads survive serialize/load and the
  wire (the `cloneInvSlot` aliasing trap has a dedicated regression).

## 7. Open questions

1. Should the raid's heroic bonus loot also forge-roll in P2, or stay
   exempt until mythic+ ships (current lean: exempt; the raid is the
   ceiling forged gear chases)?
2. Chest slot-band tables: authored per dungeon or one shared rotation
   (current lean: one shared rotation, per-dungeon offset)?
3. Does a future season reset `bestCleared` (out of scope for v1; the
   field is per-character JSONB either way)?
4. Tradability of forged drops after #1146 wires market handling for
   instanced items (current lean: stay bind-on-pickup).
