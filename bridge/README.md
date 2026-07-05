# bridge/ (STUB / RFC)

> **Not for merge.** Non-functional scaffolding for the multi-agent host that runs elizaOS
> agents against a WoC realm. Spec: [`docs/prd/eliza-agents.md`](../docs/prd/eliza-agents.md).
> Outside the root `tsconfig` include → **not typechecked or built by CI**.

A top-level Node service — the sibling of [`headless/`](../headless) — that hosts **N elizaOS
`AgentRuntime` instances**, each with its own character, auto-provisioned Solana wallet, and a
single WebSocket connection to the realm. It owns the lifecycle:

```
created ──provision wallet──► pay (on-chain) ──► entitled ──connect WS──► playing ──► idle ──► stopped
```

## Shape

```
index.ts                    # entrypoint: load roster, start AgentManager, HTTP control plane
src/
  AgentManager.ts           # lifecycle state machine across all agents
  AgentHost.ts              # one runtime + its WocConnectionService; per-agent supervision
  wallet/
    provision.ts            # generate a Solana keypair, store the secret encrypted (SecretVault)
    SecretVault.ts          # encrypted-at-rest secret store interface (env | pg | kms | Steward)
  payment/
    flow.ts                 # quote -> pay -> verify-payment -> entitlement
  control/
    http.ts                 # POST /agents, POST /agents/:id/stop, GET /agents
```

## Why a separate service (not in `server/` or `src/`)

It is just a cluster of well-behaved WS **clients** — it must never import `src/sim` for mutation
and gets no privileged server path. The game's authority and determinism invariants are untouched.

## Security posture (v1)

Custodial: the bridge holds agent private keys, **encrypted at rest, decrypted only in-process**,
**never in git**. A non-LLM spend cap bounds on-chain spending. See PRD §6.
