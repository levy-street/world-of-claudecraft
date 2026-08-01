# Plan: Companion Home P0

Status: **implementation**  
Scope: out-of-game companion **Home** only - claim/spin status, play balances, roster strip.  
Repo: `world-of-claudecraft` (must be same-origin for bearer session APIs).

## 1. Goal

Ship a first companion surface players can open on phone or desktop without loading
the full game client:

1. **Daily spin / claim status** - see eligibility, streak-ish score, whether today's
   spin is claimed; spin if available.
2. **Play balances** - Claudium soft currency from `/api/claudium/balance`.
3. **Roster strip** - character list from `/api/characters` with name, class, level,
   online badge.
4. **Auth** - restore `woc_session` or email/password login via existing `Api`.

No combat, no full inventory, no deeds board (P1), no push (v2).

## 2. Why here (not wallet repo)

Companion needs the **game account token**, not only a wallet. Daily spin and
characters are game REST routes. Building outside the game would reimplement auth
and fight CORS. Wallet repo stays custody; companion lives next to `play.html`.

## 3. APIs used (existing, no new server)

| Need | Endpoint | Client |
| --- | --- | --- |
| Session restore | localStorage `woc_session` | `Api.restoreSession` |
| Login | `POST /api/login` | `Api.login` |
| Roster | `GET /api/characters` | `Api.characters` |
| Daily status | `GET /api/daily-rewards` | `Api.dailyRewards` |
| Spin | `POST /api/daily-rewards/spin` | `Api.spinDailyReward` |
| Claudium | `GET /api/claudium/balance` | `EconomySdk.balance` |

## 4. Architecture

```
companion.html
  → src/companion/main.ts
       → app.ts (auth gate + shell)
            → home_model.ts (pure: status → view model)
            → home_render.ts (DOM)
            → Api + EconomySdk
```

Pure `home_model.ts` is unit-tested without network. Render is thin.

## 5. Edge cases

| Case | Behavior |
| --- | --- |
| Not logged in | Login form; no fake roster |
| Spin already claimed | Show points + disabled claim + reset time |
| Not eligible (no wallet / under min) | Show eligibility reason; no silent spin |
| Claudium unavailable | Show "-" not zero |
| Empty roster | CTA to open /play to create character |
| Spin failure | Surface server error string |
| Token expired | Clear session, return to login |

## 6. Risks

| Risk | Mitigation |
| --- | --- |
| i18n gate | Catalog keys under `companion.*` + i18n:gen |
| Daily rewards feature flag off | Empty/unavailable state from API |
| Multi-realm characters | List for current realm only (Api.characters); note in UI |

## 7. Exit criteria

- `companion.html` loads at `/companion`
- Unit tests for home model
- Manual: login → see roster + daily + Claudium → spin when eligible
- Pre-push floor green
