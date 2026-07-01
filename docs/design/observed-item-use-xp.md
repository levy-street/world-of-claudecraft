# Observed Item Use XP Design Spec

Issue: #1149
Status: exploratory design and test-only prototype

This spec describes a later-phase profession progress channel where a crafted item can grant a small amount of profession XP when its use is observed during adventuring. The channel is additive-only: it can grant progress to the item's source craft, but it must never reduce another craft, apply opposite-craft drains, or interact with the combat profession wheel's conserved-mass budget.

## Goals

- Let crafted items feel connected to the world after they leave the crafter's hands.
- Reward rare, meaningful item use without making common consumable spam the fastest profession leveling path.
- Preserve deterministic sim behavior by recording server-authoritative item-use facts and deriving XP from those facts.
- Keep this channel optional until the core gathering, crafting, tools, and monster harvesting slices are proven.

## Non-Goals

- Do not implement production profession XP from observed item use in this issue.
- Do not grant progress for common or uncommon item use.
- Do not remove skill from any craft for any observation event.
- Do not let client-side visibility, camera position, or UI-only combat text decide eligibility.
- Do not require item-use observation for normal profession progression.

## Observation Scope

Observation must be server-authoritative and encounter-scoped, not screen-scoped.

An event is observable when all of these are true:

- The item-use event is produced by trusted sim/server logic.
- The observer is in the same realm and encounter context as the actor using the item.
- The observer is within a bounded interest radius of the event when it resolves.
- The observer is alive, connected, and eligible to receive profession progress.
- The observer is not the only participant in a repeated self-use loop that has already hit the event cooldown.

Recommended first-pass scope:

| Scope | Rule | Reason |
|---|---|---|
| Solo self-use | eligible only for rare+ items, low base reward | keeps crafted item use meaningful without requiring group play |
| Party members | full observation weight inside the radius | party members are intentionally sharing encounter credit |
| Raid members | reduced observation weight inside the radius | prevents large groups from multiplying XP too aggressively |
| Nearby non-group players | very small or zero weight until abuse data is known | avoids crowded-hub farming |
| Offline crafters | no live observation reward; use item attribution instead | avoids hidden background progression |

The interest radius should be expressed in world units and owned by server/sim constants. A reasonable prototype value is 80 yards, matching the scale of combat-adjacent visibility without making zone-wide observation possible.

## Event Types

The first implementation should only consider events that already have clear item involvement.

| Event | Item Relationship | Notes |
|---|---|---|
| Potion drunk | consumed item instance | grants Alchemy progress only when the potion is rare tier or above |
| Killing blow landed | weapon or damaging crafted item used by the actor | grants progress to the craft that produced the item instance |
| Armor worn at kill | equipped crafted armor on a credited participant | grants a smaller support tick than the killing blow |
| Tool effect triggered | crafted tool effect attached to an item | only after tool-slot and durability systems exist |

Each event should produce at most one progress grant per item instance per cooldown window. The reward event should contain item identity and attribution facts, not localized item names.

## Per-Item Attribution

Observed-use XP depends on item-instance metadata. A future item instance should be able to answer:

- which craft produced it
- which recipe produced it
- which character originally crafted it
- which account originally crafted it, if account-safe
- which tier or rarity gate it belongs to
- whether the item has been improved, recharged, repaired, or re-crafted
- whether the item is still eligible for observed-use credit

Suggested metadata shape:

```ts
type CraftedItemAttribution = {
  craftId: string;
  recipeId: string;
  originalCrafterCharacterId: string;
  originalCrafterAccountId?: string;
  itemSerial: string;
  craftedAtTick: number;
  tier: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  improvementLineage?: string[];
};
```

If an item is improved later, the original crafter should benefit most when improving that same item again. The observed-use channel can support this by attaching a small item-bound affinity value to the item instance, then letting the original crafter spend or consume that affinity during a future improvement. That is separate from immediate skill XP and avoids progressing an offline crafter directly.

## Rare-Tier Gate

Common and uncommon items must not grant observed-use XP. Rare tier and above can grant small progress ticks.

Recommended gate:

| Tier | Eligible | Multiplier |
|---|---|---|
| common | no | 0 |
| uncommon | no | 0 |
| rare | yes | 1.0 |
| epic | yes | 1.5 |
| legendary | yes | 2.0 |

The gate prevents cheap potion spam or disposable gear churn from replacing normal gathering and crafting progress. The exact multipliers are tuning placeholders for a later balance issue, not committed production values.

## Additive-Only Invariant

Every observed-use reward must be represented as a non-negative delta for one source craft.

Implementation contracts:

- The reward function returns either no grant or a grant with `xpDelta > 0`.
- No reward path calls craft drain, opposite-craft drain, or wheel-budget redistribution helpers.
- The target craft is derived from item attribution, not from the observer's current wheel position.
- If attribution is missing, invalid, or below the rare gate, the event grants nothing.
- Caps and cooldowns may reduce a grant to zero, but never below zero.

Test-only prototypes should assert this invariant across all supported event types, all tiers, and all observer weights.

## Anti-Abuse Controls

The first production slice should include conservative controls:

- per-item cooldown for repeated observed-use credit
- per-actor cooldown for high-frequency consumable use
- per-observer soft cap per craft per day or session
- lower weights for raid-scale observation
- no credit from training dummies unless the item effect itself consumes a scarce rare+ item
- no credit from duels or arena pre-match staging unless PvP rewards are explicitly enabled

These controls should be data-driven enough to tune without changing the attribution model.

## Prototype Formula

A test-only prototype can model the intended behavior without shipping production code:

```text
if item tier is common or uncommon: grant 0
if attribution is missing: grant 0
base = event base XP * tier multiplier * observer weight
grant = max(0, floor(base after cooldown/cap reductions))
```

The prototype should prove that reductions can only clamp toward zero. They cannot invert the result into negative progress.

## Future Implementation Checklist

- Item instances persist craft attribution for rare+ crafted outputs.
- Server/sim emits trusted item-use observation events with actor, item, event type, encounter, and position facts.
- Observation eligibility is decided server-side using encounter context and interest radius.
- Reward calculation is deterministic and additive-only.
- Common and uncommon item events grant zero XP.
- Tests cover rare-tier gate, missing attribution, party/raid weighting, cooldown clamping, and the no-negative-delta invariant.

## Deferred Questions

- Should observed-use credit grant immediate profession XP, item-bound affinity, or both?
- Should the original crafter, current owner, and observer all be eligible for different reward types?
- What exact interest radius best matches encounter participation without encouraging clustering?
- Should raid weighting be flat, encounter-size-scaled, or role-aware?
- How should item improvement lineage split credit between original and later crafters?
