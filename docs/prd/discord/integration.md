# Discord Integration

A two-way bridge between World of ClaudeCraft and the official Discord server.
Players link their Discord to their game account, earn an authored reward
currency (points -> status tiers -> swag), flex their top character in Discord,
and see live Discord presence + voice in the game HUD.

## Goals
- **Login + link with Discord** (OAuth2) from the login screen and in-game.
- **Verify membership** of the official guild; reward members and boosters.
- **Reward economy**: server-authoritative points, a sticky status ladder, and
  idempotent swag claims (titles, an in-game cosmetic, real-world swag).
- **2-way flex**: show a linked user's highest character + rank in Discord
  (`/flex`, status-tier roles); show Discord presence + the voice room in the game.
- **POP**: an embedded Discord server widget in a HUD panel, a nameplate/inspect
  status badge, a side-rail button with a claimable-swag dot, auto-invite nudge.

## Architecture (follows the wallet precedent)
Discord is external account/network state, so it reuses the existing seams rather
than inventing new ones:

| Concern | Where | Mirrors |
|---|---|---|
| OAuth client flow (login/link) | `server/discord.ts` (+ `discord_oauth.ts` pure helpers) | `wallet.ts` / `wallet_link.ts` |
| Link + reward persistence | `server/discord_db.ts` (`DISCORD_SCHEMA` + SQL) | `oauth_db.ts`, `wallet_links` |
| Reward ladder (pure, shared) | `src/sim/discord_tier.ts` | `src/sim/holder_tier.ts` |
| In-game self state (link/points/tier/presence/voice/swag) | `src/ui/discord_status.ts` fed by `main.ts` over REST | `src/ui/wallet_balance.ts` (NOT IWorld) |
| Nameplate/inspect flex on other players | per-entity identity wire field `dt` | `holderTier` / `ht` |
| HUD widget | `src/ui/discord_widget.ts` (+ pure `discord_widget_view.ts`) | `vendor_window.ts` / `vendor_view.ts` |
| Bot (Discord side) | `bot/` (Gateway over `ws`, REST via `fetch`) | — (new process, like the server) |

`src/sim/` stays Discord-agnostic and deterministic: it only ever holds the status
tier as inert cosmetic data it never reads (same contract as `holderTier`).

## Reward economy (the one divergence from wallet)
Unlike the chain-sourced `$WOC` balance, WE own the points balance, so it is
stored and audited:
- `reward_points(account_id PK, points, lifetime_points)` — `points` is spendable,
  `lifetime_points` is monotonic and drives the status tier (status never drops on
  a spend).
- `reward_ledger(id, account_id, delta, reason, dedupe_key)` — append-only audit; a
  partial UNIQUE on `(account_id, dedupe_key)` makes one-time / once-per-day grants
  exactly-once.
- `swag_claims(account_id, swag_id UNIQUE per account)` — idempotent claims; the
  points deduction is guarded by `points >= cost` in the same transaction.

Grants: link (+250), guild member (+250), booster (+1000), daily active (+50, bot).
Status ladder (lifetime points): Initiate 0, Squire 100, Footman 500, Knight 2k,
Champion 5k, Warlord 15k, Legend 50k, Mythic 150k (`src/sim/discord_tier.ts`).

## Endpoints
Player REST (`server/main.ts` -> `server/discord.ts`):
- `POST /api/auth/discord/start?mode=login|link` -> `{ url }` (authorize URL). `link`
  requires a full session; `login` is unauthenticated and may provision an account.
- `GET /api/auth/discord/callback?code&state` -> HTML bounce page. Exempt from the
  web-login Origin guard (it is a discord.com redirect with no Origin). Login mints
  a normal session token; link writes the 1:1 `discord_links` row (409 on conflict).
- `GET /api/discord` -> link status + points/tier + claimed swag + invite/widget URL
  + live presence (`bearerReadAccount`).
- `DELETE /api/discord` -> unlink (`bearerActiveAccount`).
- `POST /api/discord/swag/claim {swagId}` -> server re-checks link/tier/points,
  claims idempotently, applies a cosmetic grant live for cosmetic swag.

Bot internal REST (`server/internal.ts`, gated by `DISCORD_BOT_SECRET`):
- `GET /internal/discord/flex|roles?discord_user_id=` (read top character / tier).
- `POST /internal/discord/presence` (online count + voice room members -> HUD).
- `POST /internal/discord/grant` (activity rewards; server validates + clamps).
- `POST /internal/discord/member` (guild membership sync + member reward).

## Security decisions
- **PKCE S256** + a single-use server-stored `state` row (CSRF); the verifier never
  round-trips through the browser. State consumed atomically (`DELETE ... RETURNING`).
- **No account takeover**: a Discord identity is never auto-linked to an existing
  account by email/username (Discord email is unverified to us). Login either finds
  the account that already owns the Discord id or provisions a fresh one.
- **Moderation gate** on the login path (locked accounts refused), exactly like
  `/api/login`.
- **1:1 link** with a UNIQUE `discord_user_id` + a 23505-catch TOCTOU guard (409).
- **Dedicated rate-limit bucket** (`discordRateLimited`) so a flood can't burn the
  login budget.
- **Server-authoritative rewards**: the client never decides points/claims; the bot
  pushes activity that the server validates and clamps. Swag claims are exactly-once.
- **Secrets** are server-side env only; `DISCORD_BOT_SECRET` gates the bot channel.

## Provisioned (Discord-first) accounts
`createAccount` requires a password hash, so a Discord-first signup gets a random
unguessable hash (password-unusable until set in the portal) and a username derived
from the Discord display name (sanitized, profanity-checked, suffixed on collision).

## In-game voice
The lightest real integration (the tiny-dependency-set rule rules out an in-app
WebRTC/SFU stack): the HUD embeds Discord's server-widget iframe
(`https://discord.com/widget?id=<guild>&theme=dark`, requires the guild's widget
enabled) for live presence + voice rooms, plus a "Join voice" deep link. The bot
also pushes voice-room membership so the widget shows it even without the iframe.

## Ops
- Env: see `.env.example` (Discord section). Feature is OFF until
  `DISCORD_CLIENT_ID/SECRET` are set.
- Run the bot: `npm run bot` (separate process; needs the privileged GUILD_MEMBERS +
  GUILD_PRESENCES intents). Create `WoC <Tier>` roles in the guild to enable
  status-tier role sync.
- Schema is additive idempotent DDL applied at boot (no migrations); see
  `server/discord_db.ts` `DISCORD_SCHEMA`.

## Out of scope / follow-ups
- Live "speaking" indicators (needs a voice-gateway connection).
- Equippable account-wide titles in-world (titles are recorded claims today; the
  in-world flex is the nameplate/inspect status badge + the cosmetic chroma).
- Game -> Discord level-up / boss-kill announcements (a future game->bot hook).
- Cross-realm "highest character" (today the flex is realm-scoped, like the profile).
