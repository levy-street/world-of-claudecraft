# Current State — Implementation Inventory

**Snapshot: v0.7.0 · 2026-06-16.** Derived from the code (`src/sim/`, `server/`, `src/net/`, `src/ui/`, `headless/`), not from memory. When you ship something, update its row here.

**Legend:** ✅ **FULL** — implemented and playable · 🟡 **PARTIAL** — exists but narrow or placeholder · ❌ **ABSENT** — not built.

---

## At a glance

| | |
|---|---|
| Version | **0.7.0** |
| Level cap | **20** (`MAX_LEVEL`); post-cap prestige to virtual 200 |
| Classes | **9** (all vanilla classes) |
| Specs | **27** (3 talent specs per class) |
| Abilities | **~138** (multi-rank, real vanilla scaling) |
| Zones | **3** open-world (linear north strip) + 1 portal side-zone |
| Quests | **~73** |
| Dungeons | **4** (5-player); **0** raids |
| Items | **74**; **4** equip slots of ~16 |
| Languages | **12** (UI, sim text, server, admin) |
| Hosts | Offline browser · Online server · Headless RL — all from one sim |

---

## Character systems

| System | Status | Detail |
|---|---|---|
| Classes | ✅ FULL | 9 classes (`src/sim/content/classes.ts`): Warrior, Paladin, Hunter, Rogue, Priest, Shaman, Mage, Warlock, Druid. Per-class base stats, growth curves, HP/mana scaling, resource type, starting gear, ability kit. |
| Talents & specs | ✅ FULL | 9 class trees + 27 spec trees, ~400 nodes (`talents.ts`, `talents_warrior.ts`, `talents_classic.ts`). 1 point/level from L10 = **11 points at cap**. Passive/active/choice nodes, signature ability + mastery passive per spec. Build strings (base64 import/export), **10 saved loadouts** per character, server-validated. |
| Abilities | ✅ FULL | ~138 abilities with 2–3 ranks each, scaling to L20. Schools, cooldowns, cast times, CC, DoT/HoT — all talent-modifiable. |
| Resources | ✅ FULL | Rage, Mana, Energy — real vanilla generation/cost. |
| Primary stats | ✅ FULL | STR / AGI / STA / INT / SPI / Armor, with vanilla derived-stat rules (`recalcPlayerStats` in `entity.ts`). |
| Equipment slots | 🟡 PARTIAL | **Only 4 slots:** `mainhand`, `chest`, `legs`, `feet` (`EquipSlot` in `types.ts`). Missing the other ~12 vanilla slots (head, shoulder, neck, back, wrist, hands, waist, rings ×2, trinkets ×2, ranged/offhand). |
| Items | ✅ FULL (narrow) | 74 items, 4 quality tiers (poor→rare), weapon/armor/consumable/quest/junk. **No item sets / set bonuses. No enchanting. No epics tier-wise (rare is the top).** |
| Character customization | 🟡 PARTIAL | Class + name + numeric `skin` index (0–7) + talent spec. **No races, no gender, no granular appearance (face/hair/color sliders).** |
| Races | ❌ ABSENT | No race concept anywhere. All classes available to everyone. |

## World & progression

| System | Status | Detail |
|---|---|---|
| Zones | ✅ FULL (small) | 3 zones (`zone1/2/3.ts`): **Eastbrook Vale** (L1–7), **Mirefen Marsh** (L6–13), **Thornpeak Heights** (L13–20). One continuous north strip. Plus **The Drowned Temple** portal side-zone (L15–18). Each has a hub, graveyard, POIs, roads, biome. |
| Leveling | ✅ FULL (to 20) | Levels 1–20, vanilla XP table, real group XP bonuses (1.166/1.3/1.43 for 3/4/5). Post-cap: lifetime-XP counter, prestige rank, milestones, leaderboard. **Known tuning note:** the XP curve spikes after ~level 9 — flagged for smoothing ([roadmap tuning](./roadmap.md#tuning--polish-ongoing-low-pressure)). The 1–9 and overall 1–20 shape is sound. |
| Towns / hubs | ✅ FULL (narrow) | 4 hub settlements with quest givers, vendors, innkeepers, a market NPC. **No capital cities. No flight masters, stable masters, or class trainers as distinct NPCs** (abilities auto-learn). |
| Quests | ✅ FULL | ~73 quests, kill/collect/hybrid, chained via `requiresQuest`, per-class rewards, group-recommended flags. **No escort/PvP/profession quest types; no daily/repeatable.** |
| Dungeons | ✅ FULL | 4 instanced 5-player dungeons (`dungeons.ts`, `temple.ts`): Hollow Crypt, Sunken Bastion, Gravewyrm Sanctum, Drowned Temple. Bosses with real mechanics (enrage, AoE, adds, War Stomp). |
| Raids | ❌ ABSENT | Party cap is 5; no raid instancing or difficulty. |
| Mobs / NPCs | ✅ FULL | ~95 mob templates, ~40 spawn camps, elites, rares, 5 bosses. Living AI: aggro, social pulls, leash/reset, frenzy, flee, self-heal, cleave, pack rage, debuffs. |
| Travel | 🟡 PARTIAL | Ground movement, swimming, graveyards + corpse runs. **No mounts, no flight paths, no fast travel, no taxi NPCs.** |
| Factions | ❌ ABSENT | No Alliance/Horde split, no reputation factions, no faction-gated content. All players are one cooperative team. |

## Multiplayer, social & moderation

| System | Status | Detail |
|---|---|---|
| Authoritative server | ✅ FULL | HTTP + WS (`server/`), 20 Hz loop, interest-scoped delta snapshots (~90–130 yd), distance-tiered update rates, 16 KiB frame cap. |
| Realms / sharding | ✅ FULL | Process-per-realm + shared Postgres; cross-realm picker UI; realm types (Normal/PvP/RP/RP-PvP). |
| Persistence | ✅ FULL | Postgres; full character state as JSONB; 30 s autosave + on-disconnect + graceful shutdown; world/market state in `world_state`. |
| Guilds | ✅ FULL | Create/disband, 100-member cap, leader/officer/member ranks, invites, guild + officer chat. |
| Parties | ✅ FULL | 5-player, leader invites, shared XP/loot/quest credit, party chat, raid-style target markers. |
| Friends / ignore | ✅ FULL | 50 each, presence tracking (zone/loc/status), mutual exclusion, chat filtering for ignores. |
| Chat | ✅ FULL | say/yell/whisper/guild/officer/party/general/LFG/world; rate-limited; hard-word enforcement; 90-day logs. |
| Auth / accounts | ✅ FULL | Scrypt, bearer tokens, per-IP + per-account throttle. |
| Admin / moderation | ✅ FULL | Admin dashboard (live stats, queue), ban/suspend/mute, strike ladder, player reports, forced rename, chat filter config. |
| Anti-cheat | 🟡 PARTIAL | Strong *implicit* protection (server authority, command validation) but no explicit movement/speed/teleport heuristics. |

## Economy & PvP

| System | Status | Detail |
|---|---|---|
| Currency | ✅ FULL (flat) | `copper` only — **no copper/silver/gold tiers** as separate denominations. |
| Vendors | ✅ FULL | Fixed stock, buy/sell, 16-item buyback queue, class-gated items. |
| Auction house | ✅ FULL | Server-authoritative "World Market": post/search/buy, expiry, seller collections, persisted across restarts. |
| Player trading | ✅ FULL | Live, in-person, atomic swap (items + gold), item-lock during negotiation. |
| Mail | ❌ ABSENT | No mailbox, no async item/gold delivery. |
| Duels | ✅ FULL | Consensual 1v1, countdown, no XP/durability loss. |
| Arena | ✅ FULL | Ranked 1v1, Elo/Glicko-style rating, matchmaking, decay, realm + global leaderboard. |
| Battlegrounds | ❌ ABSENT | No instanced group PvP. |
| World PvP | 🟡 PARTIAL | No faction hostility (no factions); duel/arena flagging + anti-grief only. |
| Professions / crafting | ❌ ABSENT | No gathering, recipes, or crafted gear. Loot + vendors are the only item sources. |
| LFG | 🟡 PARTIAL | LFG chat channel only — no matchmaking queue. |
| Loot rules | 🟡 PARTIAL | Group share + tap rights + quest-priority; **no need/greed/pass UI.** |

## RL environment & presentation

| System | Status | Detail |
|---|---|---|
| RL env | ✅ FULL | `headless/env_server.ts` + `python/wow_env.py`. Gym-compatible, NDJSON protocol, Discrete(23) action space, float32 obs, configurable reward, deterministic episodes, ~200k steps/s single-core. Currently exposes 2 classes (warrior, mage). |
| Renderer | ✅ FULL | Three.js, procedural geometry/VFX, quality tiers, character art via KayKit packs, 12 rigged creature families. |
| HUD / UI | ✅ FULL | Classic unit frames, action bar, cast/channel bar, spellbook, paperdoll, quest log, world map, minimap, vendor/loot/AH windows, tooltips, FCT, combat log. |
| Mobile / touch | ✅ FULL | Joystick, action buttons, haptics, left-handed, notch handling. |
| Localization | ✅ FULL | 12 languages across UI, sim text, server messages, admin. |
| Audio | ✅ FULL | Procedural WebAudio (no audio files). |

---

## Gap analysis — answering the questions the team keeps asking

The dev questions that prompted this cycle, answered against the code, with the GDD's committed direction:

| Question | Where we are | Committed direction (see [roadmap.md](./roadmap.md)) |
|---|---|---|
| **Starting zones?** | ✅ One starting zone (Eastbrook Vale, L1–7), shared by all 9 classes. | Stays single + shared **until factions/races land** — then race-specific starting experiences. Until then, improve the existing funnel. |
| **Levels 1–60?** | 🟡 Currently **1–20**. Pipeline (zones→ranks→gear→dungeons) is proven *at 20*. | **Raise to 40 next** as one milestone to prove the pipeline scales; decide on 60 from evidence. *Not* a near-term 60 sprint. |
| **Towns and hub cities?** | ✅ 4 functional hubs; ❌ no capital cities, ❌ no trainers/flight masters as NPCs. | Add a proper **capital/hub city** and real service NPCs (flight masters arrive with mounts/travel; trainers optional). |
| **Factions?** | ❌ None — one cooperative playerbase. | **Add Alliance/Horde + reputation factions over time.** Big identity shift; sequenced *after* the 40 push because it reshapes new-player flow and world PvP. |
| **Character customization?** | 🟡 Class + name + 8 skins + spec. ❌ No races/gender/appearance depth. | **Expand to races (with racials) + richer appearance.** Races are the headline of the Identity Expansion. |
| **Item slots?** | 🟡 **4 of ~16** (`mainhand`/`chest`/`legs`/`feet`). | **Fill out all slots** — highest-fidelity-per-effort win, lands early (Now/Next). Unblocks set bonuses, deeper itemization, trinkets. |

### The biggest gaps, ranked by "distance from vanilla feel"

1. **Item slots (4 → ~16)** — the single most-felt gap; gear is half the game and we expose a quarter of it.
2. **Professions / crafting** — an entire vanilla pillar is absent; also the economy's missing supply side.
3. **Factions + races** — the core identity that makes it feel like *this* genre, not just a generic RPG.
4. **Mounts / flight paths / mail** — the connective tissue of a lived-in world.
5. **Level breadth (20 → 40 → ?)** — more world to grow into.
6. **Raids + battlegrounds** — the endgame loops, once there's an endgame worth instancing.

### Cross-cutting concerns to watch

- **RL parity.** Every new system changes the observation/action space. The env currently exposes 2 of 9 classes; growth must keep the headless env honest or the "one sim, three hosts" pillar erodes.
- **Community feedback has no intake.** Discussion happens in Discord but nothing structured pipes into planning. This is a *process* gap, not a code gap — addressed as a Now item in the roadmap.
- **Determinism tax.** Every feature must route randomness through `Rng` and avoid wall-clock. Factions/professions/crafting all add RNG surfaces — budget for it.
