# PR4 goal contract

The shared contract for recipe and accepted-commission gathering goals.

## Public behavior

One optional goal. Recipe quantity is a safe integer 1..CRAFT_BATCH_MAX (currently 50);
commission quantity is exactly 1. Tracking is explicit and replacing a goal never
changes harvest preference. The preference shortcut is the sole preference write.

IWorldProfessions:
- gatheringGoal: GatheringGoalView|null
- trackGatheringRecipe(recipeId,count)
- trackGatheringCommission(orderId)
- clearGatheringGoal()

Owner delta ggoal replaces the complete read model; explicit null clears it. Commands
track_gathering_recipe, track_gathering_commission and clear_gathering_goal use strict
payload validation and the authenticated pid. No new HEAVY_SELF or immediate save.

Shared DTO: src/sim/professions/gathering_goal_types.ts in the shared simulation.
Required bill is sequential. Row counters are allocations TOWARD the goal, not total
inventory: carried and stored physical units; reachable spendable carried/drawable vault;
missing uncovered owned shortfall; inaccessible owned units not currently usable.
Ready means materials available, not a guarantee of station/gold/output bag space.

## Safe commission identity

CommissionOrder and its numeric IDs are transient. Explicit Track requires the live
accepted order whose acceptedBy is this player, then captures that EXACT order object
in nonserialized PlayerMeta state and copies its authoritative recipe ID. Persist only
compact kind/orderId/recipeId/count. Every deserialization leaves binding absent and
shows unavailable; never resolve a saved numeric ID, match a name/recipe, or silently
convert to a recipe goal. A new explicit Track on a current order can replace it.
Grace reconnect preserves resident PlayerMeta and its binding; full load cannot reclaim
an old acceptance anyway. Terminal status explains delivered/cancelled/expired.
No host epoch, UUID generation, new SQL/schema or commission persistence.

## Reagent projection

Extract the existing private planCraftReagentDraw from crafting.ts into
craft_reagent_plan.ts with identical all-or-nothing answers for current consumers.
A distinct partial-plan path retains later shortages without double-spending shared
grades. Use canonical pricing, grade ordering, source selection and removal.
Projection in material_goal_projection.ts recomputes each of at most 50 hypothetical
crafts and never mutates inventory, storage, source composition, RNG or world state.
A locked self-signed unit can still supply the canonical held-signature discount while
remaining unavailable to spend. No one-shot discounted multiplication.

Owned bank/full vault and reachable vault are distinct. No physical unit can satisfy
two rows. A goal-only read or save must not add source-journal rows.

## Cache and cost

One derived projection cache per active character/goal. No work without a goal.
Apply the five-tick gate before scratch copies or expensive projection. Include goal,
inventory wireRev, raw bankWireRev, vaultWireRev/access, relevant skills/discounts/
archetype, player name, recipe-known/combo eligibility and daily usage/reset state.
Inspect the selected bound order directly in O(1); unrelated board changes do not
invalidate a full material projection. Clear/dispose cache on removal/replacement.

Track/read/shortcut add zero DB calls, checkouts, save jobs or journal rows. Existing
30-second autosave carries compact selection. Source hints derive/cache from existing
gathering_supply.ts, never per-row SQL. Fifty bounds craft iterations, not total stock
scan cost; measurements must state carried/bank/vault-key/source-bucket occupancy,
including legacy occupancy, and report time/allocation/wire/save bytes.

## Validation

Behavioral coverage lives in gathering_goal_runtime.test.ts,
gathering_goal_cache.test.ts, gathering_goal_persist.test.ts,
material_goal_projection.test.ts, gathering_goal_wire.test.ts, and
server/gathering_goal_commands.test.ts. The optional headless request contract is
documented in docs/protocols/gathering-goal.md.

Focused checks establish behavior; they do not establish production allocation,
latency, or storage-volume bounds. Full contribution Gate and inherited stack CI
cleanup are deferred for this draft publication.
