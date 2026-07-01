# Off-Wheel Professions Design Spec

Issue: #1150
Status: exploratory design only

This spec defines a separate profession family for cosmetic, housing, and world-flavor crafts. It is intentionally outside the ten combat-craft wheel used by the core professions system. Nothing here should alter combat output, combat-craft adjacency, opposite-craft drains, combat archetype titles, or material gates.

## Goals

- Give players expressive, social, and housing-focused long-term pursuits that do not increase combat power.
- Keep non-combat crafts structurally separate from the combat profession wheel so the ten-craft ring remains stable and balanceable.
- Reuse existing game idioms where possible: vendors, unlock flags, cosmetic catalogs, placement permissions, account/character persistence, and spoiler-safe guide prose.
- Make each craft useful as a source of identity, decoration, or community trade without becoming required for raids, dungeons, arenas, or leveling.

## Non-Goals

- Do not add these crafts to `src/sim/professions/wheel.ts` or any future combat wheel/adjacency table.
- Do not add opposite-craft drains, conserved-mass budgeting, or combat archetype title derivation.
- Do not grant stats, damage, mitigation, healing throughput, resource efficiency, or encounter advantages.
- Do not create a second gearing treadmill or mandatory raid consumable loop.
- Do not implement production code as part of this exploratory issue.

## System Boundary

The off-wheel system should be a sibling to combat professions, not a branch of them.

Suggested future module boundary:

```text
src/sim/professions/
  wheel.ts                 # combat craft wheel only
  crafting.ts              # combat craft production only
  tools.ts                 # combat gathering/tool effects only
  off_wheel.ts             # non-combat craft progress and unlock reads

src/sim/content/
  professions.ts           # combat profession content
  off_wheel_professions.ts # non-combat craft content
```

If future implementation uses different filenames, preserve the boundary: off-wheel content may read shared item, cosmetic, housing, or achievement primitives, but combat wheel logic must not import off-wheel craft definitions to compute adjacency, drains, or archetypes.

## Craft Families

### Construction

Construction crafts create housing or guild-space objects. They are about place-making rather than character power.

| Craft | Primary Inputs | Outputs | Notes |
|---|---|---|---|
| Carpenter | wood, cloth, simple metal fittings | furniture, signs, shelves, practice dummies without combat rewards | Can share gathering inputs with Logging without altering the combat wheel. |
| Mason | stone, clay, ore byproducts | walls, floors, statues, fountains, memorial plaques | Good sink for stone-like materials that do not fit combat crafting. |

### Tending

Tending crafts are slow, ambient, and collection-oriented.

| Craft | Primary Inputs | Outputs | Notes |
|---|---|---|---|
| Shepherd | feed, wool, dyes | rugs, banners, pet-adjacent cosmetics | No combat pets or stat-bearing companions. |
| Beekeeping | flowers, hives, wax | candles, honey foods with flavor-only presentation, decorative hive props | Any edible output must avoid combat buffs. |
| Stargazing | observation logs, lenses, charts | star maps, constellation banners, night-sky housing effects | Uses time/place discovery, not kill loops. |

### Cosmetic Arts

Cosmetic crafts customize identity surfaces.

| Craft | Primary Inputs | Outputs | Notes |
|---|---|---|---|
| Tattooing | inks, rare pigments | character body markings, account-bound appearance options | Must respect existing cosmetic unlock safety and moderation needs. |
| Taxidermy | trophy tokens, wood, cloth | mounted creature displays | Trophy eligibility should come from achievements or rare drops, not raw power. |
| Heraldry | dyes, cloth, metals | tabards, banners, guild crests | Good guild/social feature, no stat-bearing set bonuses. |
| Instrument-making | wood, strings, metal fittings | playable or emote-triggered instruments | Audio spam controls and local mute settings are required before implementation. |
| Candlemaking | wax, herbs, dyes | decorative candles, ambience props | Lighting must respect render-budget constraints. |

## Progression Model

Off-wheel progression should be additive and monotonic.

- Each craft tracks its own rank or unlock points independently.
- Advancement never drains another off-wheel craft and never drains a combat craft.
- Recipes unlock through use, discovery, vendors, achievements, or reputation.
- Progress can be character-scoped for craft identity, while some unlocks may become account-wide cosmetics when the output is purely appearance-based.
- Catch-up can be generous because the system is not combat power.

Recommended rank bands:

| Band | Purpose |
|---|---|
| Apprentice | basic recipes from trainers and vendors |
| Journeyman | zone-themed recipes and simple customization |
| Artisan | rare cosmetic variants, guild/housing display pieces |
| Master | prestige appearances, signature props, achievement-linked patterns |

These bands are names for UX and content pacing, not combat rarity gates.

## Economy Rules

- Outputs may be tradable when they are decorations, instruments, or consumable cosmetic kits.
- Permanent character appearance unlocks should bind on use to prevent accidental loss.
- Housing or guild-space fixtures may be crafted into items, then placed by a player with permission.
- Vendor sell values should stay modest so off-wheel crafts cannot become a gold-printing loop.
- Inputs may overlap with gathering professions, but off-wheel demand must not make combat crafting unaffordable.

## Housing and Placement Rules

Future housing support should be permissioned and server-authoritative.

- Placement requires ownership or a granted role in the destination space.
- Props have collision and render-budget categories before they can be placed.
- Large or animated props need stricter caps than small static decorations.
- Removing a placed object returns it to an owner-controlled inventory or storage, unless an explicit destructive action is confirmed.
- Public/guild spaces should log placement and removal for moderation.

## UI and Guide Surface

The first production slice should keep UI small:

- trainer/vendor recipe lists
- craft progress rows
- recipe detail panel showing cosmetic/housing output
- placement inventory only once housing exists
- guide page section explaining that off-wheel crafts are cosmetic and separate from combat professions

Any player-visible UI strings must follow the normal i18n workflow at implementation time. This design doc itself is English-only reference prose under `docs/`.

## Integration Contracts

Future implementation should follow these contracts:

- Combat craft wheel: no import from off-wheel content for adjacency, drains, budget, archetypes, or combat material gates.
- Items: off-wheel outputs declare a cosmetic, housing, or flavor category and must not carry stat-bearing equipment effects unless those stats already exist independently on a normal item.
- Cosmetics: permanent appearance unlocks use existing account/character cosmetic safety patterns.
- Housing: placement is authority-checked server-side and never trusted from the client.
- Audio: instruments require rate limits, local mute, and proximity rules.
- Rendering: placed props must declare cost/collision behavior before entering a shared space.

## Acceptance Checklist for Future Implementation

- Off-wheel craft definitions live outside combat wheel content.
- Tests prove combat wheel craft order, adjacency, and opposite mappings are unchanged when off-wheel crafts are present.
- At least one craft can unlock or produce a cosmetic/housing output with no combat stat change.
- Persistence records progress/unlocks without corrupting existing character saves.
- UI clearly labels the system as cosmetic/housing/non-combat.

## Deferred Questions

- Should off-wheel progress be per-character, account-wide, or mixed by craft?
- Are player homes, guild halls, or public build plots the first placement target?
- Which outputs should be tradable after creation, and which should bind on use?
- Should rare trophy recipes require achievement flags, rare drops, or both?
- What moderation tools are required before public display props and custom heraldry ship?
