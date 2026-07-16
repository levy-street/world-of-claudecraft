# Enchanting: disenchant to materials, apply enchants per slot

Status: proposed (v1). Owner: TBD. Base branch: `release/v0.26.0`.

## 1. Summary

Make the Enchanting profession playable. Break down gear you do not need into
arcane materials (disenchant), then spend those materials to apply a permanent
stat enchant to a piece of gear (one enchant per slot). The whole loop is:

`disenchant an equippable item -> arcane materials -> apply an enchant to a slot`

The sim ENGINE and DATA for this already exist and are unit tested; they are
simply not reachable by a player. This PRD is almost entirely a WIRING spec: add
the wire commands, the `IWorld` seam, the server dispatch, and the UI that turn
the existing `disenchantItem` / `applyEnchant` sim methods into in-game actions,
plus one small content addition (a material sink for the top-tier yield).

## 2. Motivation

- The enchanting loop is fully built behind the seam but has ZERO player entry
  point: no wire command, no `IWorld` facet method, no `dispatchMessage` case, no
  UI. It is dead engine code today (see Section 4).
- Enchanting is the natural stat-gain sink for the gear a leveling/endgame player
  replaces. Without it, replaced gear is only vendor gold, and the two arcane
  materials that already ship (`arcane_dust`, `arcane_essence`) have no way to be
  produced or consumed in game.
- Sibling profession loops (gathering, crafting) are already wired to the UI;
  enchanting is the one that got its engine but not its buttons.

## 3. Player-facing flow (v1)

1. Disenchant: the player right-clicks an eligible item (an equippable weapon or
   armor piece, at least common quality) in a bag and picks "Disenchant". The item
   is consumed and the player receives arcane materials scaled to the item's
   rarity and tier, plus a small Enchanting skill gain. A toast reports the yield.
2. Apply an enchant: the player opens the Enchanting panel (a tab on the existing
   crafting window), sees the always-known enchant for each slot, and for a chosen
   target item + enchant, if they hold the item and the reagents, applies it. The
   reagents and the target item stack are consumed; a freshly enchanted copy of the
   item (carrying the enchant's stat bonus) is returned to the bag. A toast reports
   success, and the item tooltip now shows the enchant line.
3. Equipping the enchanted item grants the enchant's flat stat bonus on top of the
   base item, exactly like any other item stat.

Non-flow (v1 constraints): one enchant per item (re-enchanting overwrites the
previous one), enchants are always known (no recipe discovery), and only the
holder can enchant their own held items.

## 4. Current state (what already exists, do not rebuild)

Engine and data, all behind the `SimContext` seam and covered by
`tests/professions_enchanting.test.ts` and
`tests/professions_acquisition_salvage_sink.test.ts`:

- `src/sim/professions/enchanting.ts`
  - `disenchantItem(ctx, itemId, pid)` -> `resolveDisenchant`: eligibility is
    `isDisenchantable` (equippable weapon/armor, quality not `poor`), consumes one
    of the held item, grants `disenchantYield(def, rng)` of the rarity-mapped
    material (`DISENCHANT_MATERIAL_BY_QUALITY`: common/uncommon ->
    `arcane_dust`, rare -> `arcane_essence`, epic/legendary -> `arcane_shard`),
    and grants Enchanting skill. Yield count scales with rarity index + tier
    (`requiredLevel / 10`) + a single rng bonus unit.
  - `applyEnchant(ctx, itemId, enchantId, pid)` -> `resolveApplyEnchant`:
    validates the item exists, the enchant exists, `itemDef.slot === enchant.itemSlot`,
    the item is held, and the reagents are affordable; consumes the item + reagents;
    writes the enchant's `statBonus` onto the returned item instance's `rolled.stats`
    via `addItemInstance`; grants Enchanting skill.
- `src/sim/content/enchants.ts`: `EnchantDef` = `{ id, name, itemSlot, reagents,
  statBonus }`, and the `ENCHANTS` table with one always-known enchant for every
  equip slot (mainhand, helmet, neck, shoulder, chest, waist, legs, gloves, feet,
  ring; the weapon and gloves slots also have an int variant). Reagents draw from
  `arcane_dust` / `arcane_essence`.
- `src/sim/entity.ts` (`recalcPlayerStats`, around the `equipmentInstance?.[slot]?.rolled?.stats`
  read): an enchanted item's `rolled.stats` (str/agi/sta/int/spi/armor) already
  fold into the wearer's stats.
- `src/sim/sim.ts`: `Sim.disenchantItem` / `Sim.applyEnchant` methods exist, and
  `PlayerMeta.lastDisenchantResult` / `lastEnchantResult` fields already carry the
  most-recent outcome for a client to read (mirroring the salvage plumbing).
- Materials `arcane_dust` (common), `arcane_essence` (common; a crafting reagent),
  and `arcane_shard` (rare) exist in `src/sim/content/items.ts`.

Gap (the whole of this PRD): none of `disenchantItem` / `applyEnchant` is in
`COMMAND_NAMES` (`src/world_api.ts`), in any `IWorld` facet (`src/world_api/`),
in `server/game.ts` `dispatchMessage`, or in the UI. The sibling `salvageItem`
is in the same unwired state; wiring both together is reasonable but salvage is
out of scope for v1 unless it falls out for free.

## 5. Requirements (the wiring)

R1. Wire commands. Append two tokens to `COMMAND_NAMES` in `src/world_api.ts`
(append-only, never reorder): `disenchant` and `apply_enchant`. Tag them in
`COMMAND_FACETS`. Add the methods to the owning `IWorld` facet under
`src/world_api/` (the inventory/crafting facet): `disenchantItem(itemId)` and
`applyEnchant(itemId, enchantId)`, plus read access to the last-result fields
(`lastDisenchantResult`, `lastEnchantResult`). Implement in BOTH worlds: the
offline `Sim` methods already exist; add the thin `this.cmd({...})` senders and
the mirrored state in `ClientWorld` (`src/net/online.ts`). Update the
`IWORLD_MEMBERS` pin in `tests/world_api_parity.test.ts` and the command pins
(`tests/command_schema.test.ts`, `tests/command_facets.test.ts`) in the same change.

R2. Server dispatch. Add `case 'disenchant'` and `case 'apply_enchant'` to
`dispatchMessage` in `server/game.ts`, validating every field (item id is a
string, enchant id is a string) before calling the `sim.*` method. Surface the
outcome to the acting player: emit a `type:'log'` (success, with the material
name and count, or the applied enchant name) or `type:'error'` (the deny reasons:
`unknown_item`, `not_disenchantable`, `not_held`, `wrong_slot`,
`insufficient_materials`, `unknown_enchant`; `resolveDisenchant` and
`resolveApplyEnchant` both return `unknown_item` for an unrecognized item id)
English string, and register each new literal in
`src/ui/server_i18n.ts` in the same change (the S3 guard,
`tests/localization_fixes.test.ts`, enforces this). Alternatively surface the
`lastDisenchantResult` / `lastEnchantResult` self-snapshot fields and localize on
the client; pick one and keep it consistent with the salvage feedback path.

R3. UI: disenchant. Add a "Disenchant" entry to the bag item context menu, shown
only when `isDisenchantable(def)` is true for that item, that calls
`world.disenchantItem(itemId)`. This mirrors however "Salvage" is intended to be
offered (reuse the pattern). No new window.

R4. UI: apply enchant. Add an Enchanting tab/panel to the existing crafting window
(`src/ui/crafting_view.ts` / `crafting_window.ts`) or a small sibling panel that
lists, per slot, the always-known enchant with its reagent cost and stat bonus,
lets the player pick a held target item of the matching slot, shows have/need for
the reagents, and calls `world.applyEnchant(itemId, enchantId)` when affordable.
The pure decision core (which enchants are affordable/applicable for the current
bags) lands as a `*_view`/`*_core` module with its own Vitest, per the UI
module-first recipe.

R5. Enchant visibility. An enchanted item's tooltip shows an enchant line (the
enchant name and its stat bonus) so the player can see what an item carries and
tell enchanted from plain copies apart. Source the line from the item instance's
`rolled.stats` plus the enchant that produced it (store the `enchantId` on the
instance if the reverse lookup from stats is ambiguous; see Open questions).

R6. Content: a top-tier material sink. Add higher-tier enchants that consume
`arcane_shard` so the epic/legendary disenchant yield has a purpose (today no
enchant consumes shards, so shards are a dead-end). Scope: a second, stronger
enchant for a few high-impact slots (for example weapon, chest, legs) costing
shards and granting a larger `statBonus`. Keep magnitudes in line with the
existing flat-stat budget; do not invent new bonus categories (v1 enchants are
flat str/agi/sta/int/spi/armor only, the categories `recalcPlayerStats` reads).

Note (informational): PR #1950 already implements this requirement with its own
Greater-tier, shard-consuming enchants. If #1950 lands first, R6 is delivered and
this PRD's implementation should build on that list instead of adding a second
one; check the sequencing between the two changes at merge time.

R7. Persistence and parity. Enchants already ride the equipment item instance
(JSONB, `equipmentInstance`), so a save round-trips an enchanted item unchanged;
confirm the disenchant/apply paths draw rng only where they already do
(`disenchantYield`'s single `rng.next()`), and add a `tests/parity` scenario only
if a new rng draw site is introduced (none is expected).

## 6. Enchant list (v1)

Slot coverage is already complete in `ENCHANTS` (one always-known enchant per
slot; weapon and gloves also have an int variant for casters). v1 keeps that list
and ADDS the R6 shard-tier enchants. No slot is missing. Confirm at build that
every `EquipSlot` has at least one applicable enchant (a small content test, see
Acceptance).

Reagent tiers, for reference (already in the data): dust-only for the cheap
slots, dust+essence for the big stamina pieces (chest, legs), and the new
shard-tier for the strong variants (see the R6 note: PR #1950 ships a
Greater-tier shard-consuming set; reconcile with it at merge time).

## 7. Acceptance criteria

- A player can right-click an eligible bag item and disenchant it; an ineligible
  item (poor quality, or a non-gear item) shows no Disenchant option, and a
  server-side attempt on one is denied. The correct material and a plausible count
  arrive in the bag, and a toast reports it.
- A player can open the Enchanting panel, pick a held item and its slot's enchant,
  and apply it when they hold the reagents; the reagents and the target are
  consumed and the enchanted item returns with the stat bonus. Equipping it raises
  the wearer's stats by exactly the enchant's `statBonus` (assert against
  `recalcPlayerStats`). Applying a second enchant replaces the first.
- Deny paths return the right reason and a localized message: not held, wrong
  slot, insufficient materials, ineligible for disenchant.
- `arcane_shard` is consumed by at least one enchant (no dead-end material).
- Every `EquipSlot` has an applicable enchant (content test).
- `world_api` parity, command-schema, and command-facet pins are green; the S3
  i18n guard is green with the new server strings registered; a save with an
  enchanted item round-trips; the parity gate is unchanged (no new rng draw).
- New player-visible strings (enchant names already exist in content; result
  toasts, the Enchanting panel labels, the Disenchant menu label) are English in
  the catalog with the M16 non-Latin fills where the value is wordy.

## 8. Non-goals (v1)

- Weapon-DAMAGE enchants (e.g. +N weapon damage or on-hit procs): damage rolls
  read the item DEFINITION's `weapon.min/max`, not per-instance data, so a damage
  enchant is a larger, separate change (already called out in `enchants.ts`).
- On-equip procs, on-hit effects, or any non-flat bonus category.
- Enchant learning / recipe discovery: v1 enchants are always known.
- Enchant removal / disenchanting an already-enchanted item back into materials
  beyond the normal yield.
- Wiring the generic `salvageItem` sink (separate, though it shares the UX).
- A dedicated Enchanting trainer NPC or profession-gating: v1 lets any player
  enchant (matching the current engine, which does not gate on a learned
  profession). Revisit if enchanting should require learning Enchanting.

## 9. Open questions

- Feedback channel: server-emitted localized toast vs client-read
  `lastDisenchantResult` / `lastEnchantResult` self field. Pick the one that
  matches the salvage feedback decision so the two stay consistent.
- Enchant identity on an instance: is storing only `rolled.stats` enough for the
  tooltip line, or should the instance also store the `enchantId` (cleaner reverse
  lookup, survives a future stats change)? Leaning toward storing `enchantId`.
- Should enchanting require learning the Enchanting profession first (a trainer +
  a known flag), or stay always-available as it is now? v1 assumes always-available
  to match the engine; flag for the owner.
- Salvage vs disenchant overlap: both break gear into materials. Keep both, or fold
  salvage into disenchant for gear (salvage staying for non-gear)? Out of v1 scope
  but worth deciding before shipping the context menu, so the two do not confuse.
- Open design consideration (reviewer suggestion, FernandoX7): should disenchanting
  be anchored to a dedicated alchemy/enchanting NPC building in the world (walk to
  the enchanter's hut to break gear down) rather than being available anywhere at
  the player's fingertips? Anchoring it to a place keeps the game open-world and
  gives the profession a home; keeping it in the bag menu is lower friction. This
  is an open question for the owner, not a decision; v1 as written assumes the
  bag context menu.

## 10. Hook points (stable anchors, re-find exact lines)

- Engine: `src/sim/professions/enchanting.ts` (`disenchantItem`, `applyEnchant`,
  `resolveDisenchant`, `resolveApplyEnchant`, `DISENCHANT_MATERIAL_BY_QUALITY`,
  `isDisenchantable`, `disenchantYield`).
- Content: `src/sim/content/enchants.ts` (`ENCHANTS`, `EnchantDef`).
- Stats fold: `src/sim/entity.ts` `recalcPlayerStats` (the
  `equipmentInstance?.[slot]?.rolled?.stats` block).
- Sim facade + result fields: `src/sim/sim.ts` (`disenchantItem`, `applyEnchant`,
  `lastDisenchantResult`, `lastEnchantResult`).
- Command table: `src/world_api.ts` (`COMMAND_NAMES`, `COMMAND_FACETS`).
- Online mirror: `src/net/online.ts`.
- Server dispatch: `server/game.ts` `dispatchMessage`.
- UI: `src/ui/crafting_view.ts` / `crafting_window.ts`, the bag item context menu,
  the item tooltip.
- Tests: `tests/professions_enchanting.test.ts`, `tests/world_api_parity.test.ts`,
  `tests/command_schema.test.ts`, `tests/command_facets.test.ts`,
  `tests/localization_fixes.test.ts`, plus a new enchant-content test.
