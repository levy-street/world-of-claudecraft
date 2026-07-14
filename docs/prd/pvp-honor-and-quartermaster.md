# PRD: PvP Honor, the Honor Quartermaster, and PvP Power

| | |
|---|---|
| **Status** | SHIPPED in #1817 (release/v0.25.0, merged 2026-07-13). Kept as the reference spec; see the as-shipped note below for where the implementation diverged. |
| **Owner** | design |
| **Created** | 2026-07-11 |
| **Design reference** | Classic-era honor currencies and battleground/arena reward loops (a deterministic PvP currency spent at a quartermaster on PvP-statted gear). PvP Power / mitigation is the classic "PvP stat" idea, renamed to original terms (see the naming note in section 5). |
| **Related systems** | Ranked arena (`src/sim/social/arena.ts`), the Fiesta 2v2 battleground (`src/sim/social/fiesta.ts`, `fiesta_bots.ts`), player-vs-player damage (`src/sim/combat/damage.ts`), the `delveMarks` currency precedent (`src/sim/sim.ts`, `src/sim/delves/runs.ts`), vendors (`NpcDef.vendorItems` + `sim.buyItem`, `src/sim/items.ts`), stats (`src/sim/entity.ts` `recalcPlayerStats`, `src/sim/types.ts` `Stats`/`ItemDef`), the item-budget gate (`src/sim/item_level.ts`, `tests/item_level`) |
| **Companion docs** | `docs/prd/frontier-pvp.md` (the factionless open-world PvP zone that builds ON this system and pays 2x honor on open-world kills), `docs/prd/badges.md` (deterministic-currency + vendor precedent) |

---

> **As shipped (#1817).** The implementation matches this spec with two naming and
> shape changes. The PvP Offense / PvP Defense stat pair shipped as **one
> player-facing stat named Warfare**: it increases damage dealt to players and
> reduces damage taken from players, with independent internal caps and no PvE
> effect (one gear line, one character-sheet row). The Honor Quartermaster shipped
> as **FURY in Eastbrook**, stocking 40 honor-priced item-level 28 epic PvP items
> covering every supported equipment slot, including neck and two rings. Honor
> sources, diminishing returns, daily arena tapering, soulbinding, persistence,
> and the IWorld surfaces shipped as specified. Read the stat sections below
> through that rename.

## 0. Why this doc exists (the split)

The Frontier PRD bundled a whole open-world PvP zone, a new currency, a
quartermaster, and a staked-money layer into one feature. That is too much to ship
at once, and most of it depends on one small foundation: **a PvP currency, a vendor
that spends it, and a reason gear matters in a fight.**

This doc is that foundation, carved out to ship **first and on its own**:

1. **Honor**, a soulbound PvP currency, earned from the PvP content that already
   exists: **winning ranked arena matches** and **getting kills in the Fiesta
   battleground**.
2. **The Honor Quartermaster**, a vendor that sells honor-priced PvP gear,
   consumables, and cosmetics.
3. **PvP Power**, the stat mechanic that makes that gear worth buying: gear carries
   **PvP Offense** (you hit enemy players harder) and **PvP Defense** (enemy players
   hit you softer), applied only in player-vs-player combat.

None of this needs the Frontier zone. When the zone lands
(`docs/prd/frontier-pvp.md`), it reuses this system verbatim and adds one rule:
**open-world kills pay 2x honor.** Everything here ships and is fun without it.

## 1. Goals and non-goals

### Goals
- A **deterministic, soulbound honor currency** on `CharacterState`, granted
  server-side in the sim, mirroring the `delveMarks` pattern exactly.
- Honor earned from **arena wins** and **Fiesta kills**, with anti-farm
  diminishing returns so win-trading and kill-trading pay out sub-linearly.
- An **Honor Quartermaster** NPC in a hub reachable without any new zone, selling a
  level-20 PvP gear set (honor-priced), PvP consumables, and cosmetics/titles.
- **PvP Power**: two gear stats (PvP Offense, PvP Defense) that shift only
  player-vs-player damage, so PvP gear is meaningfully better against players and
  neutral against mobs. Same numbers everywhere (offline, server, headless).
- Full invariant compliance: server-authoritative, sim-pure, `IWorld`-surfaced,
  i18n-keyed, and PvP gear that hits the exact `expectedStatBudget`.

### Non-goals
- The open-world PvP zone, resource gathering, cargo, and the $WOC stakes layer.
  Those live in `docs/prd/frontier-pvp.md` and depend on this doc, not the reverse.
- Ranked matchmaking or rating changes. Arena rating already exists; honor is a
  reward on top of it, not a new ladder.
- A new battleground. "Battleground" here means the **existing Fiesta** 2v2
  (`src/sim/social/fiesta.ts`); a larger BG is a future doc.
- Trading, mailing, or auctioning honor. Honor is permanently soulbound
  (section 3.3): it is an identity/progression asset, and keeping it illiquid is
  what lets the diminishing-returns rules be a balance knob instead of a
  wash-trading surface.
- Rescaling PvE. PvP Power does nothing to mob damage in either direction.

## 2. Current state (what this reuses, what is new)

| Concern | Exists today | Gap for this feature |
|---|---|---|
| Soulbound counter currency | `PlayerMeta.delveMarks`, JSONB `CharacterState.delveMarks?`, granted in `delves/runs.ts`, spent in the delve companion upgrade | New `honor` counter + `lifetimeHonor`, identical pattern (section 3) |
| Arena win record | `arena.ts` `endArenaMatch` -> `scoreTeam` emits `arenaEnd { won }`; `addArenaResult` bumps `meta.arenaWins` / `arena2v2Wins` | Grant honor in the same `addArenaResult` arm (section 4.1) |
| Fiesta kills | `fiesta.ts` `fiestaTakedown(killerPid, victim)` increments `f.kills` + `counters.kills`, emits `fiestaWord` | Grant honor per takedown with per-victim DR (section 4.2) |
| Vendor prices | `items.ts` `buyItem` reads `ItemDef.buyValue` (copper only); `NpcDef.vendorItems` lists stock | Add an optional `priceHonor` price field + the honor arm in `buyItem` (section 6) |
| Gear stats | `Stats { str, agi, sta, int, spi, armor }`; `ItemDef.stats?` summed in `recalcPlayerStats` | Add `pvpOffense` / `pvpDefense` to `Stats` and `pvpOffenseRating` / `pvpDefenseRating` to `ItemDef` (section 5) |
| PvP damage | `damage.ts` `dealDamage` has duel / Fiesta / arena branches on `ctx.isArenaCrossTeam` | Add a PvP-power multiplier on the player-vs-player path (section 5.3) |
| Player-facing balance | Character sheet shows primary/secondary stats; vendors show copper | Surface honor balance + PvP Offense/Defense via `IWorld`; honor-priced vendor (section 7) |

Everything new is a small, additive extension of an existing pattern. No new
subsystem, no new spatial band, no engine work.

## 3. Honor: the currency

### 3.1 Storage
- `PlayerMeta.honor: number` and `PlayerMeta.lifetimeHonor: number`, initialized to
  `0` in `createPlayer` exactly like `delveMarks`.
- Persisted as optional JSONB on `CharacterState` (`honor?: number`,
  `lifetimeHonor?: number`), serialized in `serializeCharacter`, restored in
  `addPlayer` with `?? 0`. Additive and back-compat: an old save loads as 0.
- `honor` is the spendable balance; `lifetimeHonor` only ever increments and backs
  cosmetic/title milestones (mirrors the `lifetimeXp` prestige pattern).

### 3.2 Granting (one entry point)
All honor grants route through a single sim helper,
`ctx.grantHonor(meta, amount, reason)`, which:
- adds to both `honor` and `lifetimeHonor`,
- emits a personal `honor` `SimEvent` (`{ type: 'honor', pid, amount, reason }`) so
  the client can float it and update the HUD, and
- is the only place honor is added, so DR/caps live in the callers and the audit
  surface is one function.

The client shows honor gains as floating combat text (like XP) and localizes the
`reason` through `sim_i18n.ts` (stable key + value, never English from the sim).

### 3.3 Soulbound, permanently
Honor never trades, mails, auctions, or converts to copper or any token, in any
mode. This is an invariant, not a default. Rationale: the moment honor is liquid,
every diminishing-returns rule below becomes wash-trading security instead of game
balance. (The Frontier PRD's token firewall depends on this too.)

## 4. Earning honor (Phase 1 sources)

Two sources, both from content that already exists. Amounts below are the starting
point for tuning; they live in a named constant block, not scattered literals.

### 4.1 Winning a ranked arena match (Ashen Coliseum)
- Hook: `arena.ts` `addArenaResult(meta, bracket, won, ...)` (called from
  `endArenaMatch` -> `scoreTeam`). Grant honor **only when `won === true`**.
- Base grant scales with bracket size (more players, more honor): a small table
  keyed by bracket (`1v1`, `2v2`, `3v3`/`5v5`).
- **Anti win-trading:** per-day, per-bracket **diminishing returns** on wins
  against the *same opposing team* (100% / 50% / 25% / 0), and a soft daily win
  count past which the per-win grant tapers. A loss pays a token amount (a few
  honor) so a fair loss is not zero, but far below a win, so throwing is never
  profitable. DR windows key off `ctx.utcDay`, never wall-clock.
- Rating is untouched. Honor rides on top of the existing Elo result.

### 4.2 Kills in the Fiesta battleground
- Hook: `fiesta.ts` `fiestaTakedown(ctx, match, killerPid, victim)`. Grant honor to
  the killer per takedown, plus a smaller split to recent damagers (assist), reusing
  the takedown's existing contributor knowledge.
- **Anti kill-trading:** per-victim diminishing returns **within a match** (a killer
  farming the same opponent's repeated respawns earns 100% / 50% / 25% / 0), and no
  honor for a takedown of a same-team entity (cannot happen cross-team anyway;
  defense in depth). A match **completion/win bonus** rewards playing the objective
  over farming the ring.
- Fiesta is unranked, so this is the low-friction honor faucet; arena is the
  higher-skill, higher-rate faucet. Together they give a player two ways in.

### 4.3 The open-world premium (forward reference, not in this doc's scope)
When the Frontier zone ships, open-world kills there pay **2x** the section-4.2 base
via the same `grantHonor` path with a zone multiplier. That is the zone's incentive
to leave the safety of instanced PvP; it is specified in `frontier-pvp.md` and
requires nothing here beyond `grantHonor` already existing.

## 5. PvP Power: the stat mechanic

The reason to spend honor on gear. Two ratings on gear, applied only when a player
damages an enemy player.

### 5.1 The two stats (and the naming note)
- **PvP Offense**: increases the damage you deal **to enemy players**.
- **PvP Defense**: reduces the damage you take **from enemy players**.

Together they are the character's "PvP Power". These are the mechanical names used
throughout; the gear-tooltip flavor (e.g. a themed word for the defensive stat) is a
naming pass for the owner, but it is **not** the classic-MMO word for the mitigation
stat (that term is avoided deliberately, per the repo's no-cloned-names rule; see
the ip-scrub note in the team memory). "PvP Offense" / "PvP Defense" are plain
descriptive labels, not proper nouns, and are safe to ship as-is.

### 5.2 Where the stats live
- Add `pvpOffense: number` and `pvpDefense: number` to `Stats`
  (`src/sim/types.ts`), initialized to `0` in `baseEntity` (`src/sim/entity.ts`).
- Add `pvpOffenseRating?: number` and `pvpDefenseRating?: number` to the item def
  (`BaseItemDef`), summed in `recalcPlayerStats` inside the existing gear loop
  (alongside `critRating` / `hasteRating`), then converted from a rating to an
  effective fraction by a named curve constant (`PVP_RATING_PER_PERCENT`), the same
  shape as the existing rating-to-percent conversions. Enchant/set/aura folding gets
  it for free by living in the same summed stat block.

### 5.3 Where the multiplier applies
In `dealDamage`, on the **player-vs-player** path only:
- Gate: `source` and `target` are both players, `source !== target`, and they are
  hostile to each other (`isHostileTo`) via an active duel, arena, Fiesta, or (later)
  the Frontier zone. Never on mob damage in either direction.
- Formula: `final = base * (1 + source.pvpOffense) * (1 - target.pvpDefense)`,
  each factor clamped by a cap constant (`PVP_OFFENSE_CAP`, `PVP_DEFENSE_CAP`) so
  full PvP gear is a meaningful edge, not a one-shot or an immunity. Caps are named
  constants with a `docs/design/` note, not invented inline.
- Order: fold the PvP factors as their own step in the existing damage pipeline
  (after the base/ability/crit resolution, before/independent of armor and school
  resists), so the interaction with armor DR is explicit and testable. The exact
  slot is called out in the handoff.
- Determinism: pure multiplication off already-summed stats, no rng, one code path.

### 5.4 Why it is gameplay-fair
PvP Power changes only player-vs-player numbers, so it never advantages a PvP-geared
player against mobs (no PvE power creep) and never disadvantages a PvE-geared player
in the world (they simply take/deal normal PvP damage). It is the classic answer to
"burst is too high in PvP": give players a PvP-only mitigation knob and a PvP-only
offense knob that they opt into via the honor vendor.

## 6. The Honor Quartermaster

- A single **Honor Quartermaster** NPC (no factions, no per-team mirroring), placed
  at a hub every player can reach: at/near the arena entrance so it is available the
  moment honor exists, independent of any new zone. (When the Frontier ships, a
  second Quartermaster stands at the zone's safe hub selling the same stock.)
- **Gear**: a level-20 PvP set per armor class, carrying `pvpOffenseRating` /
  `pvpDefenseRating` plus normal stats, priced 150 to 800 honor per slot. Stat-
  budgeted exactly like PvE epics (`tests/item_level` `expectedStatBudget` applies;
  compute the budget first). Positioned slightly below raid drops on raw power so
  raiding stays aspirational, but with the PvP stats that make it the best choice
  *for fighting players* (same positioning rule as Badges of Valor).
- **Consumables**: a PvP-flagged healing/utility item or two, priced in honor.
- **Cosmetics / titles**: tabard and cloak skins, and title unlocks at
  `lifetimeHonor` milestones (mirrors the lifetime-XP prestige unlocks).
- Vendor mechanics reuse `NpcDef.vendorItems` + `sim.buyItem`; add an optional
  `priceHonor` on the item def and an honor arm in `buyItem` (check `meta.honor`,
  deduct on purchase) beside the copper arm. Copper and honor prices can coexist on
  one item, or an item is honor-only.

## 7. Player-facing surfaces (IWorld first)

Extend `IWorld` (`src/world_api.ts`) before touching either world, implement in both
`Sim` and `ClientWorld`:
- Honor + lifetimeHonor balance on the self state (like copper/delveMarks).
- `pvpOffense` / `pvpDefense` on the derived stat surface the character sheet reads.
- A new `honor` `SimEvent` for gains (floated like XP; localized via `sim_i18n.ts`).
- Vendor window renders honor prices (reuse the merchant window with an honor price
  glyph; the vendor view already lists priced rows).
- Character sheet stat tooltips gain a PvP Offense / PvP Defense line (with a "vs
  players only" note), through the existing `stat_tooltip` core.

## 8. Invariant compliance checklist

- **Determinism**: honor grants, DR windows (`ctx.utcDay`), and the PvP multiplier
  are all pure sim math off summed stats and integer counters; no wall-clock, no
  rng. Seeded replays reproduce identical honor and identical PvP damage.
- **Sim purity**: everything above the render line is in `src/sim/`
  (`grantHonor` + the DR helpers as a small `src/sim/pvp/` module behind
  `SimContext`, not a method cluster on `sim.ts`); zero DOM/Three imports;
  `tests/architecture.test.ts` stays green.
- **Server authority**: honor grants, DR bookkeeping, purchases, and the PvP
  multiplier all resolve in the server's sim; the client renders.
- **Three hosts**: offline, server, and headless get the same honor and the same PvP
  damage. The RL env can train against PvP-power damage math for free.
- **i18n**: the sim emits stable keys + values (honor reasons, QM item names,
  purchase results) matched in `sim_i18n.ts`; new HUD-chrome labels (PvP
  Offense/Defense, honor balance) are English-catalog keys that hit the
  completeness gate (coordinate with the maintainer / stage per the release-tier
  workflow). New vendor item names need their locale coverage
  (`tests/localization_coverage`).
- **Content as data**: the QM NPC, its stock, PvP gear stats, honor prices, and the
  honor-amount / DR / cap constants are records + named constants in
  `src/sim/content/` and the `src/sim/pvp/` module, never magic numbers inline.
  Player-facing content feeds `/wiki` (`npm run wiki:content`).
- **Item budget**: level-20 QM gear hits the exact `expectedStatBudget`
  (`tests/item_level`); PvP ratings are secondary stats budgeted alongside
  crit/haste, not primary-stat inflation.

## 9. Implementation slices (executor-ready; hook points verified on v0.24.0)

Ship in this order; each slice is independently testable.

1. **Honor currency.** `PlayerMeta.honor` + `lifetimeHonor` (init in
   `createPlayer`); JSONB round-trip in `serializeCharacter` / `addPlayer`;
   `grantHonor` + the `honor` `SimEvent`; `IWorld` balance surface in both worlds.
   *Test:* grant + serialize + reload preserves honor; parity golden for the event.
2. **Earning: arena + Fiesta.** Grant in `arena.ts` `addArenaResult` (win only, per
   bracket, per-opponent daily DR) and `fiesta.ts` `fiestaTakedown` (per-victim
   in-match DR + completion bonus). *Test:* a seeded arena win and a seeded Fiesta
   kill sequence produce the exact expected honor incl. DR.
3. **PvP Power stats.** Add `pvpOffense` / `pvpDefense` to `Stats` + `baseEntity`;
   `pvpOffenseRating` / `pvpDefenseRating` on `ItemDef`; sum + rating-curve in
   `recalcPlayerStats`; character-sheet surface. *Test:* equipping a rated item
   raises the derived fractions by the curve.
4. **PvP damage multiplier.** The player-vs-player factor in `dealDamage`, gated on
   both-players-and-hostile, clamped by the caps, in its own pipeline step. *Test:*
   player-vs-player damage scales by offense/defense; player-vs-mob and mob-vs-player
   damage are byte-identical to today (regression pin).
5. **Honor Quartermaster + vendor honor price.** `priceHonor` on `ItemDef` + the
   honor arm in `buyItem`; the QM NPC + PvP gear set + consumables/cosmetics as
   content; honor-priced vendor window; honor-gain FCT + stat-tooltip lines.
   *Test:* buying with enough/too little honor; `tests/item_level` on every gear
   piece; i18n gates.

## 10. Open questions
1. Honor per arena win by bracket, and the daily DR/taper curve: starting values
   here are placeholders for a tuning pass (and a future economy check when the
   staked layer lands).
2. PvP Offense/Defense caps and the rating-per-percent curve: set with a
   `docs/design/` note; measure whether full PvP gear should be roughly a +X% / -Y%
   edge (lean: modest, so skill still decides fights).
3. Does the QM sell one PvP set, or a small progression (a cheap starter set + a
   pricier second tier)? Lean: one set in Phase 1, extend later.
4. Whether losing an arena match should pay any honor at all (lean: a token amount,
   never enough to make throwing profitable).
5. Gear-tooltip flavor name for PvP Defense (owner naming pass; must avoid the
   cloned classic-MMO term).
