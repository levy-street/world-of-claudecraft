# Headless protocol: `gathering_goal` (Intentional Gathering PR4)

Frozen contract for the optional headless `{cmd:'gathering_goal', verb:...}`
NDJSON request family. Companion to
`docs/prd/intentional-gathering/goal-projection-contract.md` (the sim-side
one-goal contract) and `docs/prd/intentional-gathering/headless-gathering-contract.md`
(the PR3 corpse-gathering family this one sits beside, never merges with).

## Scope

A SEPARATE, closed request union from `{cmd:'gathering', verb:...}`
(`headless/gathering_protocol.ts`, unchanged). This family carries the
one-goal tracking surface only: reading the current goal projection, tracking
a recipe or a live accepted commission, and clearing the goal. It never
advances sim time or the episode step (no `sim.tick()`, no `stepCount`
mutation): only the existing `step`/noop path does that. It never buys,
grants, or reserves materials, a station, or gold, and it never creates,
accepts, or otherwise touches commission-order authority itself: tracking a
commission only records the identity of an order the player already, really,
accepted through the ordinary commission verbs.

## Discovery

The `info` reply carries a `gathering_goal` field:

```json
{ "version": 1, "verbs": ["inspect", "track_recipe", "track_commission", "clear"] }
```

`null`/absent on a server bundle built before this family existed (mirrors the
sibling `gathering` field).

## Requests

Every request is a strict, exact-key plain record; an unknown/extra key,
non-plain-object body, or a bad field type/range is `invalid_request` at parse
time, before the request ever reaches the sim.

- `{"cmd":"gathering_goal","verb":"inspect"}`
- `{"cmd":"gathering_goal","verb":"track_recipe","recipeId":string,"count":number}`
  - `recipeId`: the canonical bounded recipe-id shape (`^[a-zA-Z0-9_-]{1,128}$`),
    the same bound `src/sim/professions/gathering_goal_persist.ts` enforces on
    load.
  - `count`: a safe integer in `1..CRAFT_BATCH_MAX` (currently 50), the exact
    range `gathering_goal_persist.ts`'s exported `validGatheringGoalCount`
    checks.
- `{"cmd":"gathering_goal","verb":"track_commission","orderId":number}`
  - `orderId`: a positive safe integer, the exact range
    `gathering_goal_persist.ts`'s exported `validGatheringGoalOrderId` checks.
- `{"cmd":"gathering_goal","verb":"clear"}`

## Replies

```
{"ok":false,"reason":"invalid_request"}                          // malformed request, checked BEFORE reset
{"ok":false,"reason":"reset_required"}                            // well-formed request, no sim yet
{"ok":true,"verb":"inspect","goal":GatheringGoalView|null}
{"ok":true,"verb":"track_recipe","goal":GatheringGoalView|null}
{"ok":false,"verb":"track_recipe","goal":GatheringGoalView|null,"reason":"tracking_refused"}
{"ok":true,"verb":"track_commission","goal":GatheringGoalView|null}
{"ok":false,"verb":"track_commission","goal":GatheringGoalView|null,"reason":"tracking_refused"}
{"ok":true,"verb":"clear","goal":GatheringGoalView|null}
```

`GatheringGoalView` is the shared DTO at
`src/sim/professions/gathering_goal_types.ts`. `inspect` and `clear` are
always `ok:true`: neither can be refused by the sim (a read and an
unconditional clear). A `track_recipe`/`track_commission` refusal is a REAL
outcome, never `ok:true` on a refused sim action: an unknown recipe, a
commission this player never accepted, or one accepted by someone else all
refuse `tracking_refused`, and the returned `goal` is whatever
`gatheringGoal` reads immediately after the attempt (the prior goal, unchanged,
on a refusal). Re-tracking the exact same recipe/count or the same accepted
order is a valid, unchanged success, never a refusal.

Tracking never touches harvest preference: the preference shortcut (set via
the sibling `gathering` family's `set_preference` verb) is the sole write to
that state, and a goal change never implies or requires a preference change.

## Wire and Python mirrors

TS side: `headless/gathering_goal_protocol.ts` (parsing, capability) +
`headless/gathering_goal_commands.ts` (dispatch against a narrow
`Pick<Sim, 'gatheringGoal' | 'trackGatheringRecipe' | 'trackGatheringCommission'
| 'clearGatheringGoal'>` host); `headless/env_server.ts` only wires the `info`
field and the one-line `case 'gathering_goal'` dispatch. Python side:
`python/wow_env.py`'s `inspect_gathering_goal()` / `track_gathering_recipe(recipe_id,
count)` / `track_gathering_commission(order_id)` / `clear_gathering_goal()`, each
sending the exact camelCase request and returning the full reply verbatim
(refusal reason included), with no argument coercion. Tests:
`tests/headless_gathering_goal.test.ts` (parse + dispatch, against a real
`Sim`), `tests/headless_gathering_goal_transport.test.ts` (real subprocess
NDJSON wire smoke test), `python/test_gathering_goal_protocol.py` (mocked
subprocess).

## Runtime authority

The Sim methods return a boolean admission result. The dispatcher also checks the
post-command goal identity before reporting tracking success. All hosts use the
same goal actions and projection; this protocol adds no separate commission authority.
