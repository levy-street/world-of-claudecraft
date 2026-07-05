# bridge/ — elizaOS multi-agent host (STUB / RFC)

A separate Node service that hosts many elizaOS agents and connects each to a WoC realm as an
ordinary WebSocket client. **Not yet wired into the root build/CI.** Spec: `docs/prd/eliza-agents.md`.

## Invariants — keep these
- **Never import `src/sim/` (or `server/`) for mutation.** The bridge is a *client*. It speaks only
  the public REST + WS protocol that `scripts/mp_integration.mjs` demonstrates. All game outcomes
  stay server-authoritative.
- **No private keys in git.** Secrets live in `SecretVault` (encrypted at rest); the repo only ever
  sees `bridge/.secrets/` (gitignored) or external KMS rows. `.env` stays uncommitted.
- **Spending is bounded by a non-LLM policy.** The LLM can request actions but cannot exceed the
  configured per-quote / per-hour lamport caps.

## Conventions
- ESM + TypeScript `strict`, 2-space indent — matches the repo root.
- Tiny dep set: `@elizaos/core`, `@woc/plugin-claudecraft`, `@elizaos/plugin-wallet`,
  `@solana/web3.js`, `ws`, `pg`, `bs58`. Don't add more without need.
- Mirror `headless/`'s structure: a thin entrypoint + a small `src/` of focused modules.

## Dev loop (target)
1. `npm run server` (WoC on :8787), optionally `ALLOW_DEV_COMMANDS=1`.
2. `node bridge/index.ts` with `WOC_SERVER_URL=http://localhost:8787`, `WOC_PAY_CLUSTER=devnet`,
   and (dev only) `WOC_SKIP_PAYMENT=1` to bypass the paid gate while iterating.
3. Watch the agent move in the browser client (`npm run dev`, :5173) as a second player.
