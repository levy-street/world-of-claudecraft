# Devs Portal

The **Devs Portal** is a first-class surface of World of ClaudeCraft, reachable
from the **Devs** tab in the main nav. It turns a player's GitHub contributions
to this repo into in-game progression and **$WOC** rewards. It is **native to
this repo** — a React-in-Vite client (`src/devs/**`) backed by WOC-server
endpoints (`server/devs*.ts`) — not an embedded third-party app.

## What a player sees

1. **Hero** — their lead character (name / class / level / lifetime XP), pulled
   straight from the game database.
2. **Contributions** — merged PRs, reviews, commits, and issues on this repo,
   scored into contribution **points** and a **contributor level**.
3. **$WOC** — their linked wallet's balance and, when rewards are enabled, the
   amount of $WOC they can **claim** for their contributions.
4. **Leaderboard** — the top verified contributors by points.

## Architecture

```
Devs nav tab ─▶ #devs-view ─▶ React app (src/devs/**, code-split chunk)
                                   │  player session token (from the game Api client)
                                   ▼
                         WOC server  /api/devs/*   (server/devs_api.ts)
                                   │
                 ┌─────────────────┼───────────────────────┐
                 ▼                 ▼                         ▼
        GitHub search API   Solana JSON-RPC / SPL    Postgres (accounts,
        (contributions)     (balance + transfer)     characters, devs_*)
```

- **Client** (`src/devs/`): `DevsPortal.tsx` mounts into `#devs-portal-root` on
  first open (lazy `import('./devs/mount')`), calls `/api/devs/*` with the
  player's bearer token, and renders the cards. Styled to the WoW-classic theme
  in `styles.css`. React is scoped to `**/*.tsx` in `vite.config.ts` so the
  vanilla-TS game build is untouched.
- **Server** (`server/`): `devs_api.ts` (routes, account-scoped via the existing
  bearer auth), `devs.ts` (GitHub scoring + Solana balance/transfer), `devs_db.ts`
  (links, leaderboard cache, reward ledger).

## Data model (added to the existing schema)

- `accounts.github_username`, `accounts.github_verified`, `accounts.github_verify_code`
- `accounts.solana_address`
- `devs_contribution_score(account_id, github_username, points, level, prs_merged,
  claimed_base_units, last_claim_sig, last_claim_at, updated_at)` — leaderboard
  cache + the $WOC reward ledger.

## Endpoints (`/api/devs/*`, all bearer-authenticated)

| Route | Method | Purpose |
|---|---|---|
| `/profile` | GET | Character, contributions (if verified), $WOC balance, claimable rewards. |
| `/link-github/start` | POST | Claim a username; returns a one-time `woc-verify-…` code. |
| `/link-github/verify` | POST | Confirms the code is in the user's GitHub bio, then marks the link verified. |
| `/link-github/unlink` | POST | Clears the GitHub link + cached score. |
| `/link-wallet` | POST | Set (or clear, with empty body) the linked Solana address. |
| `/claim` | POST | Reserve-then-pay a $WOC transfer for accrued rewards (gated). |
| `/leaderboard` | GET | Top 25 verified contributors by points. |

### GitHub ownership

Linking is a two-step, secret-free challenge: `start` issues a one-time code, the
player adds it to their GitHub **bio**, `verify` reads the public profile via the
GitHub API and confirms the code. Only **verified** links earn points / board
spots, and a handle can be verified by exactly one account (first to prove wins).

### $WOC rewards (GATED — real money)

`claimable = contribution_points × WOC_REWARD_RATE_BASE_UNITS − already_claimed`.
A claim **reserves** (advances the claimed total in a short row-locked tx that
commits *before* any transfer) then **pays** a Token-2022 transfer from the
treasury to the linked wallet, then records the signature. A retried/concurrent
claim sees the advanced total and pays nothing — it can never double-pay; on
transfer failure the reservation is released. The whole feature is **inert**
unless both a treasury keypair and a positive rate are configured.

## Configuration (env, server-side)

| Var | Default | Purpose |
|---|---|---|
| `DEVS_GITHUB_REPO` | `levy-street/world-of-claudecraft` | Repo whose contributions count. |
| `GITHUB_TOKEN` | — | Lifts GitHub API rate limits (recommended; unauthenticated search is throttled). |
| `WOC_MINT` | `3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth` | $WOC mint (Token-2022, 6 decimals). |
| `SOLANA_RPC_URL` | mainnet-beta | RPC for balance reads + transfers. |
| `WOC_REWARD_RATE_BASE_UNITS` | `0` (off) | Base units of $WOC per contribution point. |
| `SOLANA_TREASURY_KEYPAIR` | — (off) | JSON byte-array keypair that funds reward claims. |

With the last two unset, balances and the leaderboard work but claiming is
disabled (the portal shows accrued rewards as "claims open once the treasury is
live"). The treasury is provisioned and funded by the project, not by this code.

## Local development

`npm run dev` (client) + `npm run server` (server) — the dev server proxies
`/api` → `:8787`. Open the client, register/log in, click **Devs**, link your
GitHub (and verify), link a wallet. Set `GITHUB_TOKEN` for accurate counts.
