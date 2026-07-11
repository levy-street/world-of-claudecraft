---
name: local-hunter-agents
description: The local LLM-planner hunter agent system (Codex CLI + Cleo/Hermes) on npm run server, after prod multibox got IP-detected
metadata:
  type: project
---

Around 2026-06-29 the prod realm flagged the user's multiboxing (same-IP multi-account detection) and is actively enforcing it, so live multiboxing is no longer viable. The user pivoted to **autonomous agents on a LOCAL server** (their own `npm run server`, fully sanctioned, no detection). I will NOT help evade the IP detection (proxies/VPN/IP rotation) to resume prod multiboxing.

**The system (built 2026-06-29):** a hierarchical LLM-planner + rule-executor ensemble that levels a HUNTER 1-20 on localhost:8787.
- **Planner** = `scripts/agent/planner.mjs` (provider-agnostic). Emits one validated JSON intent every ~8-20s, off the hot path (fire-and-forget; a slow/failed plan never stalls the loop). Providers: `codex` (shells `codex exec` with the ChatGPT-login subscription, NO API key, ~15-30s/call, via `callCodex` + `-o` last-message capture), `openai` (Cleo/DeepSeek/Ollama), `anthropic`. Env: `AGENT_PROVIDER`, `AGENT_PLAN=1`, `AGENT_BASE_URL/MODEL/API_KEY`, `AGENT_RESPONSE_FORMAT=0` (skip json_object mode).
- **Executor** = `scripts/agent/agent_brain.mjs` -> `multibox_brain.mjs` rules at 20Hz; intent -> ctx.combat overrides via `intents.mjs` (clamps every field = the safety boundary against a bad plan).
- **SOUL/persona**: `planner.mjs` prepends an optional soul to the system prompt via `AGENT_SOUL_FILE` (or `AGENT_SOUL` inline), mirroring `~/.hermes/SOUL.md`. The "SONZAI agent" = the Codex hunter wearing `scripts/agent/soul.sonzai.md` (Sonzai = 存在, "being": calm/present/deliberate; flavors reasoning + the in-game "say" voice; the intent schema still binds actions). User chose Codex-sub as the backend (NOT a local Ollama model) for the Sonzai agent.
- **Configs**: `scripts/multibox.hunter.codex.json` (character **Sonzai**, Codex + Sonzai soul), `scripts/multibox.hunter.cleo.json` (Cleo). Both: server localhost:8787, brainPath agent_brain, account auto-registered + hunter auto-created by multibox.mjs.
- **Launcher**: `scripts/hunter_agents.sh [codex|cleo|both]`. Full docs: `scripts/agent/HUNTER_AGENTS.md`.

**Status:** Codex path PROVEN live (Codexia spawned L1, the Codex planner produced contextual retreat intents, the executor grinded Forest Wolves to ~4k xp/h, and recovered on its own from a death). Local stack: `npm run db:up` (postgres :5433) + `npm run server` (:8787); Turnstile auto-off locally (no TURNSTILE_SECRET/REQUIRE_WEB_LOGIN/NODE_ENV=production), login is plain user/pass, ALLOW_DEV_COMMANDS=1, new chars spawn at L1.

**Cleo (Hermes)** = the user's agent on the muse-infinite VPS (also a gstack skill; surfaced via gstack /pair-agent as a generic HTTP agent). To wire her she must expose an OpenAI-compatible /chat/completions endpoint, then `CLEO_BASE_URL=.../v1 CLEO_MODEL=<id> CLEO_API_KEY=<token> scripts/hunter_agents.sh cleo`. PENDING: her endpoint URL/model/token (not in any local config).

**Future:** the EXECUTOR is the RL swap-in seam. A trained policy from the headless env (`python/wow_env.py`, `src/sim/obs.ts` ACTIONS/encodeObs; PPO trainer `python/train_agent.py` is unwritten; hunter needs pet obs/action wiring in obs.ts) drops in at the same tick(ctx) without touching the planner. Relates to [[gravewyrm-farm]] (the now-defunct prod multibox farm).
