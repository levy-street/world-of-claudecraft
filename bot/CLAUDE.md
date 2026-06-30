# bot/ — World of ClaudeCraft Discord bot

A standalone Node process (separate from the game server) that bridges the
official Discord server and the game two ways:

- **In Discord:** `/flex` (your top character + rank), `/whoami` (link status +
  reward points), `/link` (connect instructions); status-tier roles synced from
  in-game reward points; a welcome message + member reward on join.
- **Into the game:** who is online + in the featured voice room is pushed to the
  server, which surfaces it in the HUD Discord widget.

Built like the server: `npm run bot` (esbuild bundle -> `dist-bot/bot.cjs`, then run).
Zero new dependencies — Gateway over the existing `ws`, REST via built-in `fetch`.

## Files
| File | Role |
|---|---|
| `logic.ts` | **Pure, IO-free**: Gateway intents/opcodes + heartbeat/identify/resume payloads, slash-command defs + routing, status-tier role-name mapping + `computeRoleSync` diff, `/flex` embed + `/whoami` `/link` `welcome` message builders, voice-member shaping. Unit-tested in `tests/discord_bot.test.ts`. |
| `gateway.ts` | ws Gateway (v10) client: HELLO/heartbeat/ACK, IDENTIFY, RESUME on reconnect, DISPATCH forwarding. IO shell; protocol logic is in `logic.ts`. |
| `discord_api.ts` | Thin Discord REST client (bot-token authed): gateway URL, slash-command registration, interaction responses, guild roles + member role edits, post message. |
| `server_client.ts` | Calls the game server's secret-gated `/internal/discord/*` endpoints (flex/roles/presence/grant/member) with `x-woc-discord-secret`. |
| `config.ts` | Env -> `BotConfig` (throws on missing required). |
| `main.ts` | Wiring: register commands, resolve tier roles, seed guild state from `GUILD_CREATE`, route events, debounce presence pushes, periodic role sync. |

## Invariants
- **The game server is the authority for rewards.** The bot never computes points
  or status; it reads them (`/internal/discord/roles`, `/flex`) and pushes activity
  grants the server validates. Discord (gateway/REST) state lives only here.
- **Pure/IO split** (like `wallet_link.ts` vs `wallet.ts`): protocol/diff/embed
  logic in `logic.ts` (tested), ws/fetch IO in the shells. Don't inline opcode or
  role-diff logic into `gateway.ts`/`main.ts`.
- **Secrets are env only** (`DISCORD_BOT_TOKEN`, `DISCORD_BOT_SECRET`, ...); never
  commit them. `DISCORD_BOT_SECRET` must match the server's.
- **Privileged intents:** `GUILD_MEMBERS` + `GUILD_PRESENCES` must be enabled for the
  application in the Discord developer portal, or IDENTIFY is rejected (close 4014).

## Status-tier roles
Create roles named `WoC <Tier>` (e.g. `WoC Champion`) in the guild for each rung you
want synced; the bot resolves them by name and assigns the one matching a member's
in-game lifetime points (`src/sim/discord_tier.ts`), removing the others. Missing
roles are skipped.

## Env (see .env.example)
`DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `DISCORD_BOT_SECRET`,
`GAME_SERVER_URL` (default `http://127.0.0.1:8787`), `PUBLIC_GAME_URL`,
`DISCORD_VOICE_CHANNEL_ID` (featured voice room), `DISCORD_WELCOME_CHANNEL_ID`.

## Limits / notes
- Guild state is seeded from `GUILD_CREATE`; very large guilds may not send all
  members up front (request-guild-members opcode is not implemented). Fine for
  small/medium servers.
- "Speaking" indicators are not live (that needs a voice-gateway connection); the
  voice list shows membership + self-mute.
