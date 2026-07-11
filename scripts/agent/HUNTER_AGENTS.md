# Autonomous hunter agents (LLM planner + rule executor)

Run a hunter that levels itself on **your own local server** (no prod realm, no
multi-account detection), driven by an LLM **planner** of your choice: the **Codex
CLI** (your ChatGPT-login subscription) and/or **Cleo** (the Hermes agent on the
muse-infinite VPS). This is the "LLM + RL ensemble" shape: the LLM sets strategy,
a fast executor flies the character.

## Architecture (one seam)

```
                         every ~8-20s (off the hot path, fire-and-forget)
   world snapshot ───▶  PLANNER  ───▶  one validated INTENT  ──┐
   (observe.mjs)        codex | cleo   (intents.mjs clamps it)  │
                                                                ▼
   every tick (20Hz) ─▶  EXECUTOR (agent_brain.mjs → multibox_brain.mjs rules)
                          applies the intent as ctx.combat overrides + flies the
                          hunter: pull, shoot (Auto Shot / Arcane / Serpent Sting),
                          melee in the deadzone, kite, loot, rest, flee, quest.
```

- The LLM **never** hand-flies the character (impossible at 20Hz). It emits a small
  JSON intent (`mode`, `anchor`, `lvlCeil`, `fleeHp`, `restHp`, `pull`, optional
  `say`/`do`). `intents.mjs` validates and clamps every field, so a bad/hallucinated
  plan can only ever do something safe.
- The planner call is fire-and-forget: if it's slow (Codex is ~15-30s), errors, or is
  off (`AGENT_PLAN` unset), the hunter keeps following the last intent / pure reactive
  rules. It can never stall or crash the control loop.
- Swap-in point for RL later: the **executor** is the seam. Today it's the proven rule
  brain; a trained policy from the headless env (`python/wow_env.py`, `src/sim/obs.ts`)
  drops in at the same `tick(ctx)` without touching the planner.

## Setup (once)

```bash
npm run db:up        # local Postgres on :5433 (per .env)
npm run server       # builds + runs the authoritative server on :8787
```
Local login is plain username/password (Turnstile is auto-off locally), and the hunter
character is auto-created on first connect. `.env` already sets `ALLOW_DEV_COMMANDS=1`,
so you can `dev_level`/`dev_teleport` to test specific brackets.

## Run

```bash
# Codex CLI planner (ChatGPT-login subscription, no API key)
scripts/hunter_agents.sh codex

# Cleo (Hermes) planner via her OpenAI-compatible endpoint
CLEO_BASE_URL=http://muse-infinite:PORT/v1 CLEO_MODEL=<her-model-id> CLEO_API_KEY=<token> \
  scripts/hunter_agents.sh cleo

# both at once (two hunters, Codexia + Cleo, same server)
CLEO_BASE_URL=... CLEO_MODEL=... scripts/hunter_agents.sh both
```

The launcher registers the account, then `multibox.mjs` auto-creates the hunter and
connects. Watch progress in `logs/party.md` (kills/levels/loot) or the live dashboard
(`node scripts/multibox_dashboard.mjs`, default :8099).

## Provider env (planner.mjs)

| Var | Meaning |
|---|---|
| `AGENT_PROVIDER` | `codex` \| `openai` (Cleo / DeepSeek / Ollama / OpenAI) \| `anthropic` |
| `AGENT_PLAN` | `1` to enable the planner; unset = pure reactive rules |
| `AGENT_BASE_URL` / `AGENT_MODEL` / `AGENT_API_KEY` | OpenAI-compatible endpoint (Cleo) |
| `AGENT_RESPONSE_FORMAT` | `0` if the endpoint rejects `response_format:json_object` (Cleo default) |
| `AGENT_CODEX_BIN` / `AGENT_CODEX_MODEL` / `AGENT_CODEX_TIMEOUT_MS` | Codex CLI knobs |

## Tuning (config `combat` block)

`planEverySec` (planner cadence), `lvlCeil` (don't pull mobs above leader.lv+this),
`fleeHp`, `restHp`. Codex defaults to a 20s cadence (it's slow + each call spends
subscription usage); Cleo to 8s. The hunter rotation, pet handling, kiting, and
quest/grind ladder come from `multibox_brain.mjs` and `multibox.world.json`.

## Files

- `scripts/agent/planner.mjs` — the LLM policy (provider-agnostic; codex/openai/anthropic).
- `scripts/agent/agent_brain.mjs` — the executor (`tick(ctx)`); intent → overrides → rules.
- `scripts/agent/intents.mjs` — the intent contract + clamps (safety boundary).
- `scripts/agent/observe.mjs` / `converse.mjs` — snapshot + chat/social.
- `scripts/multibox.hunter.codex.json` / `.cleo.json` — the two local hunter configs.
- `scripts/hunter_agents.sh` — the launcher.
