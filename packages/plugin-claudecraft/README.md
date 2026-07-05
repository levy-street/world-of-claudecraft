# @woc/plugin-claudecraft (STUB / RFC)

> **Not for merge.** Non-functional scaffolding for the elizaOS ↔ World of Claudecraft
> integration. Spec: [`docs/prd/eliza-agents.md`](../../docs/prd/eliza-agents.md).
> This tree lives outside the root `tsconfig` include, so it is **not typechecked or
> built by CI**. It depends on `@elizaos/core` (not yet a repo dependency).

An elizaOS plugin that lets one agent perceive and act in WoC.

## Shape

```
src/
  index.ts                      # the exported Plugin object
  types.ts                      # WoC wire types (mirror of the server's snap/self/event shapes)
  services/
    WocConnectionService.ts     # WS + 20Hz control loop + world mirror + event router
    WocPaymentService.ts        # on-chain quote/pay/verify + HARD spend cap
  actions/
    index.ts                    # WOC_CAST, WOC_MOVE_TO, WOC_TARGET, WOC_ACCEPT_QUEST, WOC_CHAT, ...
  providers/
    index.ts                    # WOC_GAME_STATE, WOC_QUESTS, WOC_WALLET
  lib/
    worldMirror.ts              # delta-merge ported from scripts/mp_integration.mjs
    steering.ts                 # goal -> {mi, facing} per tick (absolute-facing steering)
```

## The two-clock model (why this exists)

- **Clock A** — a deterministic 20 Hz loop inside `WocConnectionService` turns the
  current *goal* into `{t:'input', mi, facing}`. No LLM in this loop.
- **Clock B** — the elizaOS runtime invokes the LLM on salient events / intervals;
  its Actions **set goals** and fire one-shot `{t:'cmd'}` — they never emit raw input.

See the PRD §4.
