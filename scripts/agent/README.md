# Agentic policy spike — `ryzehunts`

> **Goal of this spike:** can an *agent that has a description of the game and
> access to the controls* drive a character (and stand up an RL policy) — given
> that we already have rule-based bots (`ryzetrio` / the `multibox` brains)
> playing today? **Yes.** This folder is the structure for it.

## TL;DR feasibility

We already have the three hard pieces; the agent is the glue:

1. **A control surface that works headless.** `multibox.mjs` logs a character in
   over the raw server wire protocol and exposes a clean per-bot API
   (`bot.cmd / bot.input / bot.self / bot.ents` + helpers). Rule-based brains
   already pilot real characters on the live realm with it. An agent gets the
   *same* surface — no new client needed.
2. **A deterministic RL environment.** `headless/env_server.ts` + `src/sim/obs.ts`
   (`ACTIONS`, `encodeObs`, reward config) + `python/wow_env.py` (Gymnasium) train
   a low-level policy in the exact same sim that runs live. Same seed ⇒ same world.
3. **A hot-reloadable decision seam.** `multibox_brain.mjs` is a pure
   `tick(ctx)` function, swapped live with no relog. That is *exactly* where a
   policy plugs in.

The only thing that does **not** work naively: an LLM cannot be the per-tick
controller (20 Hz live, 4 Hz in the RL env). So the design is **hierarchical** —
a slow LLM *planner* sets intent; a fast *executor* (rule-based now, learned RL
policy later) carries it out. See "Architecture".

## Why not "just let the LLM play"?

| Layer | Cadence | Who runs it | Why |
|---|---|---|---|
| **Reactive control** | 20 Hz (live) / 4 Hz (RL) | rule-based `tick()` **or** a trained RL policy | rotation, kiting, heal triage, dodging — far too fast for an LLM round-trip |
| **Tactical/strategic** | every ~5–15 s or on events | **the LLM agent** | "which camp, which target, retreat now, pop cooldowns, switch spec, party tactics" — judgement, not reflexes |
| **Meta / policy-setup** | offline, minutes | **the LLM agent** | shape rewards + curriculum, launch RL training, read results, iterate |

The LLM is the *strategist and the trainer*, not the twitch player. This is the
standard hierarchical-RL / LLM-planner pattern, and it maps 1:1 onto what we have.

## Architecture

```
                 ┌─────────────────────────────────────────────┐
   game_brief.md │  PLANNER (LLM, async, every planEverySec)    │
   (what the     │  prompt = game_brief + observe() summary +   │
    game is) ───▶│           intent schema + recent outcomes    │──┐
                 │  → emits a validated INTENT (macro-action)   │  │ writes
                 └─────────────────────────────────────────────┘  │ intent.live.json
                                                                   ▼
   live world ──▶ observe.mjs ──▶ compact JSON snapshot      intents.mjs (schema+apply)
   (bot.self/ents)                                                   │
                                                                     ▼
                 ┌─────────────────────────────────────────────┐
                 │  EXECUTOR — agent_brain.mjs  tick(ctx) 20 Hz │
                 │  reactive rules (reuse multibox_brain) +     │
                 │  apply the latest INTENT as overrides        │
                 └─────────────────────────────────────────────┘
                                   │ bot.cmd / bot.input
                                   ▼  (live realm: ryze2 / ryzehunts)

   ── meta loop (offline) ─────────────────────────────────────────────
   reward_policy.json ─▶ rl/train.mjs ─▶ python/wow_env.py ─▶ checkpoint
                          ▲                                      │
                          └──────── rl/evaluate.mjs ◀────────────┘
   The agent reads evaluate's report + the live journals and rewrites
   reward_policy.json / the intent prompt — closing the loop.
```

**Key idea:** the planner never touches `bot.cmd` directly and never runs on the
hot path. It writes an *intent* to a small JSON file; the executor reads the
latest intent each tick (cheap, mtime-cached) and turns it into targeting /
movement / tunable overrides. So a slow, occasionally-wrong, or briefly-stalled
LLM can never crash or freeze the 20 Hz loop — worst case the bot keeps following
the last intent (or pure reactive rules). Same fail-safe discipline as the
hot-reloaded brain: a bad plan degrades to the previous one.

## Two executors, one contract

The intent contract (`intents.mjs`) is deliberately executor-agnostic:

- **Now:** the executor is the rule-based brain. Intents map to its `TUNABLES`
  overrides + a target/stance/anchor channel. Ships immediately, safe on live.
- **Later:** the executor is a **learned RL policy** trained in `headless/`.
  `src/sim/obs.ts` already exposes `ACTIONS` (move/target/attack/ability_N/
  interact/eat) and `encodeObs`. The same intent ("hold camp at (x,z), engage
  ≤+1 level, retreat <40% hp") becomes the RL *task spec* (reward weights +
  spawn/curriculum) the agent hands to `rl/train.mjs`.

That is the spike's thesis: **the agent authors policies (rule-tunings and RL
reward/curricula), it doesn't hand-fly the character.**

## Files

| File | Role |
|---|---|
| `game_brief.md` | The game description handed to the LLM (classes, abilities, mob families, zones, the action vocabulary, objectives). The agent's "manual". |
| `observe.mjs` | `summarize(bot, ctx)` → compact JSON world-state for the prompt (self, hostiles, party, cooldowns, zone, recent events). |
| `intents.mjs` | The **intent schema** (macro-action vocabulary) + `validateIntent()` + `applyIntent(bot, ctx, intent)` mapping intent → executor overrides. The contract. |
| `planner.mjs` | The LLM planner: build prompt, `callModel()` (Anthropic API, env-gated), parse+validate, write `intent.live.json`. Pure of game side effects. |
| `agent_brain.mjs` | Drop-in `tick(ctx)` for `multibox.mjs`: reactive rules (reuse `multibox_brain`) + apply latest intent + kick the planner async on cadence. |
| `rl/reward_policy.json` | The reward + curriculum spec the agent edits (mirrors `headless/env_server.ts` reward dict). |
| `rl/train.mjs` | Launches a training run against `python/wow_env.py` with a reward policy; records the checkpoint + metrics. |
| `rl/evaluate.mjs` | Scores a policy (RL eval + live-journal parse) into a report the agent reads to iterate. |
| `../multibox.ryzehunts.json` | The party config: `ryze2` / `ryzehunts` (hunter), `extends multibox.world.json`, executor = `agent_brain`. |

## Running the spike

```bash
# 1. live: agentic hunter on ryze2/ryzehunts (reactive + LLM intents)
ANTHROPIC_API_KEY=… AGENT_PLAN=1 node scripts/multibox.mjs scripts/multibox.ryzehunts.json
#    AGENT_PLAN unset → pure reactive (safe; no model calls). Set → planner runs.

# 2. watch the plans + journals
node scripts/multibox_dashboard.mjs        # http://localhost:8099
tail -f scripts/agent/intent.live.json     # the current LLM intent

# 3. mage RL track (no Anthropic; no python/torch needed for the baseline)
npm run build:env                                   # build the headless env once
node scripts/agent/rl/run_env.mjs scripts/agent/rl/reward_policy.mage.json   # dep-free baseline
node scripts/agent/rl/train.mjs   scripts/agent/rl/reward_policy.mage.json   # same, via orchestrator
node scripts/agent/rl/evaluate.mjs                  # score runs + live journals
#    real PPO (after: pip install gymnasium stable-baselines3 torch):
TRAIN_CMD="python3 python/train_agent.py scripts/agent/rl/reward_policy.mage.json" \
  node scripts/agent/rl/train.mjs scripts/agent/rl/reward_policy.mage.json
```

## Model providers (the planner is NOT locked to Anthropic)

The planner emits a tiny JSON intent every ~8s, so a cheap or local model is plenty.
It is OpenAI-compatible by default:

```bash
# DeepSeek (cheap, hosted)
AGENT_PLAN=1 AGENT_BASE_URL=https://api.deepseek.com/v1 AGENT_MODEL=deepseek-chat \
  AGENT_API_KEY=sk-… node scripts/multibox.mjs scripts/multibox.ryzehunts.local.json
# Local Ollama (free — no key)
AGENT_PLAN=1 AGENT_BASE_URL=http://localhost:11434/v1 AGENT_MODEL=qwen2.5 \
  node scripts/multibox.mjs scripts/multibox.ryzehunts.local.json
# OpenRouter (many models) → AGENT_BASE_URL=https://openrouter.ai/api/v1
# Anthropic (optional) → AGENT_PROVIDER=anthropic AGENT_API_KEY=… AGENT_MODEL=claude-…
```

## Open questions / risks (be honest)

- **LLM latency & cost.** A plan every 5–15 s is fine; per-tick is not. Mitigate
  with event-triggered replans (death/level/add-pull/low-mana) + a cheap local
  heuristic between plans. Cost is bounded by the cadence, not the tick rate.
- **Live-realm ToS.** `worldofclaudecraft.com` is shared + moderated; botting is
  plausibly bannable (see `[[agent-play-setup]]`). The spike defaults to the
  reactive executor with the planner **off** unless `AGENT_PLAN=1`. For RL
  training and aggressive iteration, self-host (`npm run db:up && npm run server`,
  `ALLOW_DEV_COMMANDS=1`) and point `server` at `localhost:8787`.
- **RL action space is class-limited today.** `env reset` accepts `warrior|mage`;
  hunter (ryzehunts) needs the obs/action wiring extended to the hunter kit before
  a *learned* hunter executor. The rule-based executor works for hunter now; RL is
  the follow-up. This is the main code gap, and it's contained to `src/sim/obs.ts`
  + the env reset.
- **Credit assignment for the agent's own edits.** `rl/evaluate.mjs` + the live
  `📊 PROGRESS` beats give the agent a measurable score to optimize its
  reward/intent changes against — otherwise the meta loop is vibes.

## Account

`ryze2` / `ryze12` → character **`ryzehunts`** (hunter, id 24785) on realm
Claudemoon. Single-account; the config is crew-ready (one account holds up to 10
chars, so a hunter pack under `ryze2` is a drop-in extension — add bots to the
party file). See `[[multibox-accounts]]` and `[[agent-play-setup]]`.
