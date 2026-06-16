# Design Influences

What we draw from — and deliberately *reject* — when deciding where World of Claudecraft goes. Two sources: **vanilla WoW Classic** (the genre's high-water mark, and our fidelity north star) and **Titan Reforged / Chrono** (China's 2025 first-party server, for its modern retention loops). Everything here is filtered through our [pillars](./vision.md#design-pillars) and the [$WOC guardrails](./vision.md#the-woc-token-guardrails).

> **The one-sentence stance:** *keep vanilla's journey, borrow Titan Reforged's retention loops — and whatever the token does (cosmetic or power, per the [fork](./design-lens.md#the-strategic-fork-the-decision-that-colors-everything)), keep it out of the deterministic sim and server-authoritative.*

---

## Part 1 — Vanilla WoW Classic: the most-loved fundamentals

Why Classic endured. For each: do we already honor it, should we preserve it, or should we add it.

| Loved fundamental | Why players love it | Our status |
|---|---|---|
| **The leveling journey IS the game** | Slow, earned, every level meaningful; a new rank/ability from the trainer is a real reward — not a chore to skip. | ✅ Have (1–20, real XP curve). **Preserve as we raise the cap** — never trivialize the climb. |
| **A dangerous, un-streamlined world** | Elite mobs, group quests in the open world, corpse runs, eat/drink downtime. Danger makes the world feel *real*. | ✅ Have (living AI, corpse runs, downtime). **Preserve.** |
| **Talent builds & character identity** | Deep trees, meaningful choices, theorycrafting; your build is *you*. | ✅ Have (27 specs, ~400 nodes, loadouts). |
| **Social fabric & server identity** | You *needed* people; reputations formed; no cross-realm anonymity. The community was the content. | 🟡 Partial (guilds/parties/friends, realm-scoped). **Protect against anonymizing "convenience."** |
| **Dungeons as destinations** | Long, run-based, attunements/keys, class quests, dungeon sets; getting there is part of it. | ✅ Have (4 five-player dungeons). **Add depth: keys/attunements, dungeon sets.** |
| **The gear chase & itemization** | Gear is rare and exciting; the "ding" blue drop; pre-raid BiS; world drops. | 🟡 Partial. **Biggest gap — only 4 of ~16 slots; no sets.** |
| **Professions deeply integrated** | Gathering, crafting, recipes, profession economy — a second progression system. | ❌ Absent. **High-value add.** |
| **Reputation grinds & attunements** | Long-term goals beyond level (rep bars, quartermasters, raid keys). | ❌ Absent. **Add — pairs with factions.** |
| **World bosses & world PvP** | Emergent open-world conflict and spectacle (Kazzak-style). | ❌ Absent. **Add — see world events below.** |
| **Player-driven economy & AH** | Server-specific markets, real supply/demand. | ✅ Have (World Market, trading). **Professions give it a supply side.** |
| **Class fantasy & class quests** | Hunter pet taming, Warlock mount, Paladin charger — power that's *earned through story*. | 🟡 Partial (kits exist; no class quests). |
| **Mounts at 40 / the long reward** | No instant gratification; the 40 mount is a milestone you *remember*. | ❌ Absent. **Tie to the cap-40 milestone (see roadmap).** |
| **40-man raids as the social apex** | The endgame is *cooperative spectacle* with your guild. | ❌ Absent (party cap 5). **The cap-60 era.** |

**What this tells us:** our combat/sim core is already deeply faithful; our gaps are the *world systems* that turn a good combat game into a *world* — itemization breadth, professions, reputation, mounts, world bosses, raids, and more levels to grow into.

---

## Part 2 — Titan Reforged / Chrono (China, 2025): modern retention loops

### What it is
A **China-exclusive, first-party** Blizzard + NetEase server (early access Nov 14, live Nov 18, 2025). A "raid rush" fusing **Vanilla + TBC + WotLK** rescaled to level 80. The **Chrono** variant ("时光/time") is the accelerated, weekly-rotating-raid flavor — the "timeforged" idea. The name echoes retail's old **Titanforged** loot (gear rolling *higher* than base), reworked here into a deliberate, *earned* upgrade ladder.

> ⚠️ It is a **first-party product**, not a private server. We draw **design** inspiration, not anything else.

### The features Chinese players love most (ranked)

1. **The Titan System — account-wide, permanent power progression.** *The* headline. A power track on your **account**, not one character; everything you do feeds it. Kills the most-hated pain point: *"grinding to 60 on three characters."*
2. **Dual earned currencies for all playstyles.** **Titan Fragments** (PvE: quests/dungeons/gathering/professions) + **Titan's Embers** (PvP + raids) → spend on **gear upgrades** and powerful items. Solo, social, PvP all earn.
3. **Upgradeable gear & legendaries.** Loot — including famous legendaries — **upgrades to stay relevant** across phases. Nothing instantly obsolete.
4. **Dynamic world events + dynamic world-boss loot.** Events spawn across the map for **Titan XP, cosmetics, gear** — reviving old zones and creating spontaneous group play.
5. **Alt-friendly / catch-up by design.** Daily objectives + account-wide power keep alts and returners relevant without regrinding.
6. **Reworked professions + lowered reputation barriers.** Professions impactful; rep grinds less punishing.
7. **Endgame-first raid rush.** Fast leveling, then weekly **Fated-style** raid rotation at a single 25-player difficulty + tier-set redesigns.

### Why it resonates (the cultural pattern)
The through-line is **respect for player time + always-on numeric growth**. Chinese MMO audiences are multi-alt and efficiency-minded; **account-wide growth (账号养成)** is a beloved 国服 staple. Daily objectives + a power bar that always ticks up = the long-term loop they expect — modernizing the *grind* without touching combat identity, and marketed explicitly as **no pay-to-win**.

---

## Part 3 — What we adopt, adapt, and reject

### ✅ Adopt (fits our pillars cleanly)
- **An account-wide progression track — but COSMETIC/QoL, not power.** We already have lifetime-XP, prestige, and milestones; extend them into an account "Renown"-style track of titles, cosmetics, and conveniences. This is also the natural home for **$WOC cosmetic entitlements**.
- **Dynamic world events that reward cosmetics + account XP.** Reuses zones, drives social play, fits "procedural everything," and rewards in exactly the lane the token guardrail allows.
- **A dual-currency, earned upgrade loop** (a PvE currency + a PvP currency) feeding a **gear upgrade ladder** — so every playstyle progresses, and gear stays relevant. **Power is earned in-game, never bought.**
- **Alt-friendly catch-up + daily/world objectives.** Cheap to honor; respects player time; deepens retention.

### 🔁 Adapt (good idea, our flavor)
- **Account power → account *cosmetic/prestige*.** We take the *always-on growth* feeling but keep raw stats earned per-character, on the journey.
- **Raid rotation → our endgame, our scale.** Weekly featured content is great; we apply it to *our* 5/10-player content at *our* caps, not a 3-expansion rush.

### 🔴 Reject (collides with our identity)
- **The "raid rush" / skip-the-journey premise.** Titan Reforged is endgame-first; **we are journey-first vanilla.** We borrow its loops, not its skip. The climb stays sacred.
- **Account-wide *raw power* — by default.** A roster-wide power bar collides with vanilla fidelity, so the **default (Fork B)** keeps account-wide rewards cosmetic/QoL. Under **Fork A** it's on the table — bounded only by the two structural guardrails (sim-external, server-authoritative), not by a no-power rule.
- **Anything that anonymizes the social layer** for convenience (cross-realm everything, instant teleport-to-content). The community *is* the content.

---

## The synthesized design principles

1. **Preserve the journey; modernize the grind.** Add catch-up, dailies, and upgrade loops — but never make leveling skippable or trivial.
2. **Token stays structural; power-source is a choice.** The hard rule is only that $WOC never enters the deterministic sim and is server-authoritative. Whether power is earned-only (Fork B, the default) or partly token-driven (Fork A) is the open [fork](./design-lens.md#the-strategic-fork-the-decision-that-colors-everything).
3. **Reward every playstyle.** Dual currencies + world events mean solo, social, and PvP players all progress.
4. **Always-on growth, the right way.** Give players a bar that always ticks up — make it a *cosmetic/prestige* bar, not a stat bar.
5. **Protect the social fabric.** Server identity and real grouping over anonymizing convenience.

**Sources:** [Massively OP](https://massivelyop.com/2025/09/24/world-of-warcraft-china-preps-exclusive-titan-reforged-servers-confirms-new-classic-content-coming-globally/) · [Wowhead — release/upgrades](https://www.wowhead.com/wotlk/news/chinas-titan-reforged-server-releases-november-18th-tier-set-redesign-379090) · [Wowhead — currencies/professions/world-boss loot](https://www.wowhead.com/wotlk/news/titan-reforged-server-preview-new-currencies-profession-changes-and-dynamic-379175) · [Warcraft Wiki — Chrono](https://warcraft.wiki.gg/wiki/Titan_Reforged_-_Chrono) · [SSEGold explainer](https://www.ssegold.com/wow-classic-titan-reforged-china-server-explained) · [LagoFast guide](https://www.lagofast.com/en/blog/wow-titan-forged-servers-guide/)
