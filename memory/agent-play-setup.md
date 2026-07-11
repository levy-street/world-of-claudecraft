---
name: agent-play-setup
description: How to drive WoC characters with agents — live realm URL, multibox facts, the driver scripts
metadata:
  type: project
---

User (ryze) wants to play World of Claudecraft with agents. Built two headless WS-client drivers:
- `scripts/hunter_agent.mjs` — single hunter autonomous grinder (login→/ws→snapshot loop→cmds).
- `scripts/multibox.mjs` — config-driven coordinated party of up to 5 (leader pulls, others follow+assist, healers heal). Auto-creates missing chars if spec has `class`. Example: `scripts/multibox.config.example.json`.

Key facts (verified in code, June 2026):
- Live realm: **https://worldofclaudecraft.com**, realm "Claudemoon", single same-origin realm (`/api/realms` url `''`). `.org` is just the marketing landing page, NOT the game server.
- Auth: REST `POST /api/login {username,password}` → token; `GET /api/characters` (Bearer); WS `/ws` first msg `{t:'auth',token,character:<id>}` → `hello`/`snap`/`events`.
- **Single-account multibox works**: WS auth (`server/main.ts:464-495`) has no per-account/token session cap; `game.join` (`game.ts:454`) only rejects if that *character* is already in world. One account holds up to 10 chars. So 5-box from one login is fine — each char must be logged out of the browser first.
- Move input `mi` uses compact keys: f/b/tl/tr/sl/sr/j; `facing` = absolute world angle `atan2(dx,dz)`. Hostile mob = ent `k:'mob' && !dead && h`.
- Live realm is shared (~50 real players) + leaderboard + moderation — botting there is likely bannable. Safe alternative: self-host (`npm run db:up` + `npm run server`, point SERVER_URL at localhost:8787, `ALLOW_DEV_COMMANDS=1` to fast-level). User chose to run on live anyway, risk accepted.
- `scripts/crypt_raid.mjs` is the proven 5-bot template these were adapted from. See [[../CLAUDE.md]] for repo architecture.
