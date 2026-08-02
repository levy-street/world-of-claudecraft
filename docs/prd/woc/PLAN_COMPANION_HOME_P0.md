# Plan: Companion Home P0

Status: **implemented (Home P0 + P1 enrichments)**  
Scope: out-of-game companion **Home** - claim/spin, play balances, multi-realm roster,
Renown chip, daily payout history.  
Repo: `world-of-claudecraft` (must be same-origin for bearer session APIs).

## 1. Goal

Ship a first companion surface players can open on phone or desktop without loading
the full game client:

1. **Daily spin / claim status** - see eligibility, streak-ish score, whether today's
   spin is claimed; spin if available.
2. **Play balances** - Claudium soft currency from `/api/claudium/balance`.
3. **Roster strip** - multi-realm character list (fan-out via `Api.realms` + `setRealm`)
   with name, class, level, realm, online badge.
4. **Auth** - restore `woc_session` or email/password login via existing `Api`.
5. **Renown chip (P1)** - deeds leaderboard self rank / top percent.
6. **Daily history (P1)** - recent payout rows from `/api/daily-rewards/history`.

No combat, no full inventory, no push (v2).

## 2. Why here (not wallet repo)

Companion needs the **game account token**, not only a wallet. Daily spin and
characters are game REST routes. Building outside the game would reimplement auth
and fight CORS. Wallet repo stays custody; companion lives next to `play.html`.

## 3. APIs used (existing, no new server)

| Need | Endpoint | Client |
| --- | --- | --- |
| Session restore | localStorage `woc_session` | `Api.restoreSession` |
| Login | `POST /api/login` | `Api.login` |
| Realm directory | `GET /api/realms` | `Api.realms` |
| Roster (per realm) | `GET /api/characters` | `Api.characters` after `setRealm` |
| Daily status | `GET /api/daily-rewards` | `Api.dailyRewards` |
| Spin | `POST /api/daily-rewards/spin` | `Api.spinDailyReward` |
| Daily history | `GET /api/daily-rewards/history` | `Api.dailyRewardHistory` |
| Renown self | `GET /api/leaderboard?board=deeds` | `Api.deedsLeaderboard` |
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
| i18n gate | Catalog keys under `companion.*` in `src/ui/i18n.catalog/companion.ts` + i18n:gen |
| Daily rewards feature flag off | Empty/unavailable state from API |
| Multi-realm characters | Fan-out via `realmsToFetch` + per-realm `characters()`; skip unreachable realms |
| Deeds board offline | Soft empty page from `Api.deedsLeaderboard`; chip shows unavailable/unranked |

## 7. Exit criteria

- `companion.html` loads at `/companion`
- Unit tests for home model (spin, multi-realm merge, deeds, history)
- Manual: login → see multi-realm roster + daily + Claudium + Renown + history → spin when eligible
- Pre-push floor green
- i18n catalog includes `companion.*` (locale fills at release)
