# PRD — Max-Level XP Overflow & Post-Cap Progression

| | |
|---|---|
| **Status** | Draft / Proposed |
| **Owner** | TBD |
| **Created** | 2026-06-14 |
| **Source demand** | Discord `#feature-requests` — starshadowx2 ("xp gained after max level still counted… like RuneScape level 99 → 200m xp"), endorsed by Zyzz Jobs. 💯-reacted; #2 most-loved remaining request. |
| **Related systems** | Leveling (`src/sim/sim.ts`, `src/sim/types.ts`), character persistence (`server/db.ts`), HUD XP bar (`src/ui/hud.ts`) |
| **Companion PRD** | `docs/prd/talents-and-specializations.md` |

---

## 1. Summary

Today, when a character hits the level cap (20) all further XP is discarded. This PRD adds **post-cap progression**: XP keeps counting forever into a 64-bit lifetime counter, drives a cosmetic **virtual level** (so the bar keeps "leveling up"), and feeds a **leaderboard + milestone cosmetic rewards**. The intent is **retention and bragging rights, not power** — at a level-20 cap, post-cap power gain would break balance, so this system is deliberately horizontal/cosmetic.

This is the **RuneScape model** (level cap stays, XP continues to a counter, virtual levels are cosmetic, the grind is leaderboard- and prestige-driven), with **the classic MMO's post-cap reward cadence** (Paragon-style milestone rewards, Honor-style uncapped prestige levels) layered on top.

---

## 2. Background & motivation

### 2.1 Player demand
The request appeared organically in `#feature-requests` and drew reactions. The ask is specifically the RuneScape pattern: *"sorta like how in Runescape there's level 99 but you can still go up to 200m xp."*

### 2.2 Why it matters
- The current behavior is actively bad: max-level players gain **nothing** from combat. `grantXp()` returns early at cap and any overflow is zeroed. There is no reason to keep playing a maxed character outside of new content.
- It is a **very high love-to-effort ratio** feature. The leveling system is small and self-contained; the foundation lands in well under a day.
- It establishes patterns (a new persisted progression field, a leaderboard endpoint) reused by other systems.

---

## 3. How it works in the reference games (full breakdown)

### 3.1 Classic-MMO XP & leveling (baseline)
- **XP earned from:** kills (scaled by mob level vs player level), quests (dominant source), exploration/discovery (one-time chunks), gathering.
- **Rested XP:** accumulates while logged out (faster in inns/cities), grants ×2 kill XP until drained, max ≈ 1.5 levels of stored bonus. Quests/exploration advance the rested marker but do not consume it.
- **XP-to-next curve:** a tuned (non-cleanly-exponential, modern classic MMOs even non-monotonic) curve, rounded to the nearest 100.
- **At cap:** XP gain **stops** and quest XP converts to gold. **Classic MMOs have no native XP overflow** — this is the key research finding. The "keep earning" feeling comes entirely from the post-cap systems below.

### 3.2 Classic-MMO post-cap systems (the reward-cadence reference)
- **Paragon levels:** after maxing a reputation, a bar refills every fixed chunk (+10,000) and dumps a reward cache (gold, currency, RNG cosmetics). Clean "infinite repeatable bar with milestone rewards" pattern.
- **Artifact Power (Legion) / Azerite (BfA):** literally a *second XP bar that never ends*, unlocking traits/levels, paced by a throttle knob (Artifact Knowledge multiplier / weekly auto-reduction) so the curve never balloons for returners.
- **Honor levels (PvP):** **uncapped, account-wide "prestige" levels** with cosmetic milestone rewards (e.g. a mount at Honor Level 500). The closest analog to uncapped prestige + cosmetics.
- **Renown (Shadowlands/DF):** time-gated reputation track with cosmetic milestones, framed account-wide for permanence.

### 3.3 RuneScape model (the literal request)
- **Cap = level 99 (13,034,431 XP)** per skill, but **XP continues to a 200,000,000 cap.** (Their 200M ceiling is an accident of 32-bit storage — *we use 64-bit and never need an artificial cap.*)
- **Virtual levels:** computed from continued XP (99 → 120 standard, → 150 elite, ≈126 at 200M). **Purely cosmetic, no gameplay effect.**
- **XP curve:** each level ≈ 10.4% more than the last (roughly doubles every 7 levels).
- **Recognition:** skill capes at 99, master capes at virtual 120, eight cosmetic 200M skill icons, and **public hiscores/leaderboards** — the entire endgame grind is leaderboard + cosmetic driven.

### 3.4 Design synthesis for a level-20 cap
Because the cap is low, post-cap XP is **purely retention/flex**. Recommended stack:
1. **Lifetime XP counter (64-bit)** — foundation + leaderboard sort key.
2. **Virtual levels** computed from it — bar keeps "leveling," zero new content.
3. **Paragon-style milestone rewards** on a *flat* XP interval (rewards never dry up) — cosmetic only.
4. *(Optional)* **Prestige** — opt-in hard reset of the level-20 bar for a prestige rank/badge.

---

## 4. Current state in the codebase

> **Re-verified against `fix/discord-bug-batch` (PR #131) on top of Release v0.4, 2026-06-14.** Line numbers below reflect the post-v0.4 tree (sim.ts and hud.ts grew substantially). Since v0.4, **arena (Ashen Coliseum), the World Market, and i18n all merged** — relevant because (a) the leaderboard UI must route strings through i18n, and (b) post-cap activities now include arena/market.

| Concern | Location | Notes |
|---|---|---|
| XP discard at cap | `src/sim/sim.ts:2238` | `if (p.level >= MAX_LEVEL) meta.xp = 0;` — **the discard to replace** |
| Early return at cap (no XP granted) | `src/sim/sim.ts:2224` | `if (!p || p.level >= MAX_LEVEL) return;` — **must change** |
| Party-member XP gate at cap | `src/sim/sim.ts:2214` | `if (xpGain > 0 && mE.level < MAX_LEVEL) this.grantXp(...)` — **second cap-gate to update** |
| XP grant + level-up loop | `src/sim/sim.ts:2222-2238` | `grantXp()`; while-loop already carries overflow between levels |
| Quest XP grant | `src/sim/sim.ts:3131` | `this.grantXp(quest.xpReward, meta)` — also flows through the cap gate |
| XP table / cap / `xpForLevel()` | `src/sim/types.ts:562-569` | `XP_TABLE`, `MAX_LEVEL = 20` |
| Mob XP value + level-diff scaling | `src/sim/types.ts:582` | `mobXpValue()` — reduces XP for out-leveled mobs (anti-farm) |
| Character state (persisted) | `src/sim/sim.ts:236` | `interface CharacterState { level, xp, … }` |
| `PlayerMeta` (runtime) | `src/sim/sim.ts:178` | holds `xp`, would hold `lifetimeXp` at runtime |
| Serialize | `src/sim/sim.ts:536` | `serializeCharacter()` |
| Deserialize | `src/sim/sim.ts:428` | `addPlayer(cls, name, { state })` (level clamp at `:465`) |
| DB schema | `server/db.ts:36-45` | `state JSONB` (line 42) — **no migration needed for new fields** |
| DB save fn | `server/db.ts:315` | `saveCharacterState(characterId, level, state)` |
| Autosave | `server/game.ts:38, 382-384` | 30s interval (`AUTOSAVE_SECONDS`) |
| Command switch (for prestige cmd) | `server/game.ts:616-617` | `switch (msg.cmd)`; copy a `case` like `:619`/`:629` |
| XP bar render / update | `src/ui/hud.ts:513, 657-658` | ticks at `:513`; update + `MAX LEVEL` label at `:657-658` |
| XP / levelup toast events | `src/ui/hud.ts:1177-1182` | `case 'xp'` / `case 'levelup'` |
| Character sheet | `src/ui/hud.ts:1907-1910` | `toggleChar()` / `renderChar()` |
| i18n string helper | `src/ui/i18n.ts:1886` | `t(key)` — **all new UI strings must register here** |
| Settings | `src/game/settings.ts:5` | `GameSettings` (for optional `showOverflowXp` toggle) |
| Dev set-level helper | `src/sim/sim.ts:685` | `setPlayerLevel()` (gated by `ALLOW_DEV_COMMANDS`) |

**Gap:** no lifetime XP, no virtual levels, no leaderboard, no prestige, no milestone rewards. Combat at cap yields nothing (gated in **two** places — `:2224` solo and `:2214` party).

---

## 5. Goals & non-goals

### Goals
- Max-level characters earn and retain XP indefinitely.
- A cosmetic virtual level keeps the XP bar progressing past cap.
- A global leaderboard ranks players by lifetime XP.
- Cosmetic milestone rewards (titles/borders/icons) at fixed thresholds.
- Anti-farm: trivial low-level mobs cannot be farmed for cheap leaderboard rank.
- Zero power creep at a level-20 cap.

### Non-goals
- No stat/power rewards from post-cap XP (explicitly out of scope to protect balance).
- No raising the actual level cap (separate effort; see `feature/expansion-levels-1-20`).
- No rested-XP rework (can be a follow-up).
- No trading/selling of lifetime XP or prestige.

---

## 6. Functional requirements

### 6.1 Lifetime XP counter
- **FR-1.1** Add `lifetimeXp: number` to `CharacterState`, serialized/deserialized through the existing JSONB blob (no migration).
- **FR-1.2** Use a 64-bit-safe integer. JS `number` is safe to 2^53; document the invariant and add a guard/log if a single character ever approaches it (effectively never, but explicit).
- **FR-1.3** Every XP award (kill/quest/explore) adds to both the level bar (until cap) and `lifetimeXp` (always). After cap, only `lifetimeXp` grows.
- **FR-1.4** Update **all three** cap gates so XP still accrues to `lifetimeXp` at cap: the solo early-return (`sim.ts:2224`), the party-member gate (`sim.ts:2214`), and the discard (`sim.ts:2238` → route remainder to `lifetimeXp` instead of zeroing).
- **FR-1.5** Pre-cap, `lifetimeXp` is the running total of all XP ever earned (so the leaderboard is meaningful for leveling players too).

### 6.2 Virtual levels
- **FR-2.1** Add `virtualLevel(lifetimeXp): number` next to `xpForLevel()` in `types.ts`. Extend the curve past level 20 with a defined formula (e.g. continue the existing `XP_TABLE` slope, or a RuneScape-style ~10% step). Cache the threshold table.
- **FR-2.2** Below cap, virtual level == actual level. At/after cap, virtual level = 20 + extra levels computed from post-cap lifetime XP.
- **FR-2.3** Crossing a virtual level fires a cosmetic banner + sound (reuse the `levelup` toast path) reading e.g. "Virtual Level 27!".
- **FR-2.4** Virtual level has **no mechanical effect** (no stats, abilities, or gating).

### 6.3 XP bar & character sheet UI
- **FR-3.1** Post-cap, the XP bar shows virtual-level progress (fills toward next virtual level) instead of a static "MAX LEVEL".
- **FR-3.2** Post-cap bar is visually distinct (prestige/gold tint) to signal the threshold was crossed.
- **FR-3.3** Bar label post-cap: `Lv 20 (+7)  ·  1,284,500 total XP  ·  62% to next`.
- **FR-3.4** Character sheet (`hud.ts:1408`) shows `Total XP`, `Virtual Level`, and current prestige rank (if enabled).

### 6.4 Leaderboard
- **FR-4.1** Server endpoint `GET /api/leaderboard?metric=lifetimeXp&realm=<realm>&limit=100` returning ranked `{ rank, name, class, level, virtualLevel, lifetimeXp }`.
- **FR-4.2** Query is indexed and **cached server-side** with periodic refresh (follow the chat-censor caching pattern, PR #85). Never computed per request under load.
- **FR-4.3** Realm-scoped by default (consistent with realm isolation, PR #34), with an optional global view.
- **FR-4.4** Client leaderboard panel (model on quest-log two-column panel, `hud.ts:1482`), bound to a key and/or a button in the social panel.
- **FR-4.5** Highlight the viewing player's own rank even if outside the visible top-N.

### 6.5 Milestone cosmetic rewards
- **FR-5.1** Define milestone thresholds (in lifetime XP or virtual level) granting cosmetic rewards: titles, name-plate borders/colors, and/or character-sheet badges.
- **FR-5.2** Milestones are persisted (`unlockedMilestones: string[]` in `CharacterState`) and surfaced in the character sheet.
- **FR-5.3** Milestone unlock fires a celebratory banner.
- **FR-5.4** Rewards are strictly cosmetic.

### 6.6 (Optional / Phase 4) Prestige
- **FR-6.1** Opt-in "Prestige" action at cap: resets the level-20 XP *bar* to 0 (does not touch `lifetimeXp`), increments `prestigeRank`.
- **FR-6.2** Prestige rank shown as a star/number by the character name and in the leaderboard.
- **FR-6.3** Prestige is cosmetic-only; no power, no loss of abilities/talents/gear.
- **FR-6.4** Confirmation dialog explaining exactly what does/doesn't change.

### 6.7 Anti-farm & integrity
- **FR-7.1** Retain `mobXpValue()` level-diff scaling post-cap so out-leveled mobs grant trivial XP.
- **FR-7.2** Lifetime XP and virtual level are computed **server-side** (authoritative `Sim`); client display is derived only.
- **FR-7.3** Consider a per-source cap or diminishing returns for repeatable XP exploits (flag during design; depends on existing quest/kill economy).

---

## 7. Data model & schema changes

```ts
// src/sim/sim.ts — CharacterState (JSONB blob; no DB migration)
interface CharacterState {
  level: number;
  xp: number;                  // current level-bar XP
  lifetimeXp: number;          // NEW — monotonic, never reset
  prestigeRank?: number;       // NEW (Phase 4) — opt-in
  unlockedMilestones?: string[]; // NEW — cosmetic milestone ids
  // …existing fields…
}
```

- `characters.level` column stays as-is (used for listing). Virtual level is computed, not stored.
- No SQL migration: all new fields live in the existing `state JSONB`.
- Leaderboard may add a generated/denormalized column or a cached materialized view of `lifetimeXp` for query performance (decide in design; JSONB extraction with an index is acceptable at current scale).

---

## 8. API / command surface

- **Read:** `GET /api/leaderboard` (see FR-4.1). No new client→sim *command* needed for the counter (it's a passive consequence of existing XP grants).
- **Prestige (Phase 4):** new command `prestige` wired through `IWorld` (`src/world_api.ts:86`) → client `cmd()` (`src/net/online.ts:280`) → server switch (`server/game.ts:585`) → `Sim.prestige(pid)`. Follow the existing `castAbility`/`turnin` pattern exactly.
- **Events:** extend the existing `levelup`/`xp` event payloads (or add `virtualLevelUp`, `milestoneUnlocked`) emitted from `Sim` and handled in `hud.ts:937`.

---

## 9. UI / UX specification

- **XP bar (primary surface):** reuse existing element (`index.html:2018`, `hud.ts:564`). Pre-cap unchanged. Post-cap: gold/prestige fill, virtual-level label, hover tooltip shows total XP + rank.
- **Character sheet:** add a "Progression" row group: Total XP, Virtual Level, Prestige Rank, unlocked milestone badges.
- **Leaderboard panel:** two-column quest-log-style window; tabs for Realm/Global; sticky "your rank" row.
- **Banners/toasts:** virtual level-up and milestone unlock reuse `showBanner()` + `audio.levelUp()`.
- **Settings:** add `showOverflowXp` toggle to `GameSettings` (`src/game/settings.ts:5`) surfaced in the options menu for players who want the classic "MAX LEVEL" text.
- **i18n (new constraint):** all new UI strings (bar labels, leaderboard headers, milestone names, prestige dialog) must be registered in `src/ui/i18n.ts` and rendered via `t(key)` (`:1886`) — the game shipped multilingual support in v0.4. Do not hardcode display strings.
- **Accessibility/clarity:** the prestige confirmation must be unambiguous about what is and isn't reset.

---

## 10. Performance requirements

- **PR-1** Counter cost is one integer add per XP event — negligible.
- **PR-2** Virtual level is computed from a cached threshold table; O(log n) lookup or direct formula. Never recompute per frame.
- **PR-3** Leaderboard is the only sensitive path: cache server-side, refresh on an interval (e.g. 30–60s), serve from cache. Index the sort key.
- **PR-4** No additions to the combat hot path or per-tick simulation.

---

## 11. Gameplay & balance design

- **Cosmetic-only** at a level-20 cap. No stats, no power. This is the core balance guarantee.
- **Reward cadence:** prefer fixed-interval milestones (Paragon-style) over an asymptotic curve so rewards never fully dry up. Decide the interval vs. RuneScape-style ever-increasing curve during design (tradeoff: grind feel vs. long-tail).
- **Retention drivers (ranked):** leaderboard > cosmetic milestones/titles > prestige badges. Power gains intentionally excluded.
- **Account-wide framing (stretch):** an account-level lifetime XP total makes alt play feel permanent (classic-MMO Warband pattern).

---

## 12. Phasing

| Phase | Scope | Est. |
|---|---|---|
| **1 — Overflow counter** | `lifetimeXp` persisted; stop discarding/early-return; show Total XP in sheet + bar hover | XS (~0.5 day) |
| **2 — Virtual levels** | `virtualLevel()`, bar keeps filling, post-cap banner + sound, distinct bar styling, settings toggle | S (~1 day) |
| **3 — Leaderboard + cosmetics** | server endpoint + cache, leaderboard panel, milestone titles/borders | M (~2–3 days) |
| **4 — Prestige (optional)** | opt-in reset, prestige rank, confirmation UX | S–M |

---

## 13. Testing strategy

### 13.1 Unit / snapshot (`tests/`)
- New `tests/xp.test.ts`: mid-level carry (regression — already works), at-cap XP routes to `lifetimeXp` (not gold/zero), virtual-level boundaries, level-diff scaling still gates trivial mobs, prestige resets bar but not `lifetimeXp`.
- Snapshot the XP-bar label states (pre-cap, at-cap, post-cap).

### 13.2 Local manual testing
1. `ALLOW_DEV_COMMANDS=1`; use `setPlayerLevel()` (`sim.ts:555`) to jump to 20.
2. Kill mobs → confirm `lifetimeXp` grows and virtual level increments (today it's discarded — this is the headline regression check).
3. Log out/in → confirm persistence via `serializeCharacter` + autosave.
4. Hit `/api/leaderboard` → confirm ranking, realm scoping, and cache behavior.
5. Trigger a milestone → confirm banner + persisted unlock.
6. (Phase 4) Prestige → confirm bar resets, `lifetimeXp` and gear/talents untouched.

### 13.3 Multiplayer correctness
- Verify lifetime XP/virtual level compute in the authoritative `Sim` and reach the client only via snapshot/events (test the `ClientWorld` online path, not just offline).

---

## 14. Telemetry / metrics

- Track: % of max-level characters earning post-cap XP weekly, median post-cap virtual level, leaderboard page views, milestone unlock counts, prestige adoption.
- Success signal: increased session count/length for max-level characters after launch.

---

## 15. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Players expect power from post-cap XP | Clear cosmetic-only messaging; lean on leaderboard/cosmetics for motivation |
| XP farming for leaderboard | Retain level-diff scaling; consider per-source diminishing returns |
| Leaderboard query cost at scale | Server-side cache + indexed sort key |
| Curve feels like an endless grind | Fixed-interval milestone rewards so progress is always visible |
| Integer growth | 64-bit-safe handling; guard/log near 2^53 (practically unreachable) |

---

## 16. Open questions

1. Virtual-level curve: continue current `XP_TABLE` slope, or adopt RuneScape-style ~10%/level growth?
2. Milestone cadence: fixed interval vs. increasing — and what cosmetics exactly (titles, borders, nameplate icons)?
3. Is prestige in scope for v1, or a fast-follow?
4. Leaderboard scope: realm-only, global, and/or account-wide totals?
5. Should rested XP be reworked alongside this, or deferred?

---

## 17. Acceptance criteria

- A level-20 character killing mobs sees `lifetimeXp` and virtual level increase, persisted across logout.
- The XP bar visibly progresses past cap with distinct styling and accurate labels.
- `/api/leaderboard` returns correct, cached, realm-scoped rankings; the client panel renders them and highlights the viewer.
- At least one cosmetic milestone unlocks, persists, and is shown on the character sheet.
- No measurable change to combat-tick performance; no power gain at any virtual level.
- (If Phase 4 shipped) Prestige resets the bar only, increments rank, and is fully reversible in understanding via the confirmation dialog.
