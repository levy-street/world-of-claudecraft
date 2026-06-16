# Roadmap

The prioritized plan. Derived from the [steering decisions](./index.md#the-four-steering-decisions-this-cycle-2026-06-16), the [gap analysis](./current-state.md#gap-analysis--answering-the-questions-the-team-keeps-asking), and the [design influences](./design-influences.md) (vanilla Classic + Titan Reforged). When priorities shift, move the item and note why — don't silently delete.

> **Two companion docs make this actionable:** the [Design Lens](./design-lens.md) decides *what* earns a slot here (and frames the **crypto-vs-vibe [strategic fork](./design-lens.md#the-strategic-fork-the-decision-that-colors-everything)** that colors the whole plan); the [System Designs backlog](./system-designs/index.md) turns each item into a scoped, pluckable spec. This page is the *sequence*; those are the *what* and the *how*.

---

## High-level goal: the progression ladder (20 → 30 → 40 → 60)

The spine of the whole roadmap. We raise the cap in **deliberate rungs**, proving the content pipeline at each step before committing to the next. Each rung is a full vanilla-faithful tier (zones, ability ranks, gear, dungeons) — **the journey stays sacred; we never make leveling skippable** (see [design-influences](./design-influences.md#part-3--what-we-adopt-adapt-and-reject)).

| Rung | Cap | Headline reward | What it delivers | Proves |
|---|---|---|---|---|
| **Today** | **20** | — | 3 zones, ~73 quests, 4 dungeons, 9 classes, talents. | The combat/sim core is solid. |
| **Rung 1** | **→ 30** | New zone + dungeon | 1 new zone (L20–30), ability ranks to 30, a gear tier, 1 new 5-player dungeon, extended XP curve. | The content pipeline **scales cheaply**. The smallest honest proof. |
| **Rung 2** | **→ 40** | 🐎 **Mounts** | 1–2 new zones (L30–40), ranks to 40, gear tier, 1–2 dungeons, **mounts unlock at 40** (vanilla-authentic), first **10-player raid**. | The pipeline holds at scale + endgame instancing works. |
| **Rung 3** | **→ 60** | The full vanilla endgame | Multiple zones (L40–60), ranks to 60, epic gear tiers, dungeon keys/attunements, **world bosses, 40-man raids, reputation/attunement chains**. | We can run a *complete* classic endgame at our scale. |

**Decision gates between rungs:** after each rung we measure (how long did it take to author? retention? did determinism + RL parity hold?) and only then green-light the next. 30 is a fast proof; 40 is the real test; 60 is the prize. **Mounts at 40 and raids at 40+ are the deliberate "long reward" hooks** vanilla taught us players remember.

---

## How we prioritize

Five tie-breakers, applied in order:

1. **Fidelity-per-effort.** Closing a vanilla gap players feel constantly beats a deep system few touch.
2. **Unblocks-later-work.** Foundations first (item slots before set bonuses; capital city before flight network; pipeline before cap rungs).
3. **Doesn't fight the pillars.** Respects "one sim, three hosts," determinism, server authority, and *earned-not-bought* — or it doesn't ship.
4. **Provable.** Ship it, measure it, learn before betting bigger.
5. **Journey-first.** Retention loops are welcome; skipping the climb is not.

**Shape of the plan:** cheap-and-felt breadth first → the cosmetic/world-event retention loops (Titan-inspired) → climb the cap ladder rung by rung → the identity expansion (factions/races) lands with the 60 era.

---

## NOW — depth at current scale (target: v0.8)

*Fill the vanilla gaps that need no cap raise. Fast fidelity wins; foundations for the ladder.*

| # | Item | Why now | Scope / risk |
|---|---|---|---|
| 1 | **[Equipment Slots 2.0](./system-designs/equipment-slots.md) (→ 8)** | Highest fidelity-per-effort gap — gear is half the game and we expose a quarter. This is the first tier of an epic (4→8→12→17); 2.0 adds the armor core (head/shoulder/hands/waist). Unblocks sets, trinkets, the upgrade loop. | **Low.** Extend `EquipSlot` + `recalcPlayerStats`, author items, paperdoll frames. Later tiers (3.0 NEXT, 4.0 LATER) carry the harder rules. |
| 2 | **Community feedback intake** | Discord exists but nothing pipes into planning; a roadmap players can *see* shape is a north-star promise. | **Low.** Triage labels + recurring digest into this wiki; optional in-client `/feedback`. |
| 3 | **Mail system** | Async gold/item delivery is the economy's missing half; the AH already implies it. | **Low–Medium.** Mirrors AH collection patterns in `world_state`. |
| 4 | **Need / greed / pass loot UI** | Group content exists; the loot *ceremony* that makes it social does not. | **Low.** Roll session + UI; server-authoritative via `Rng`. |
| 5 | **$WOC cosmetic foundation (off-chain entitlements)** | Activates the token *safely* and early — the account entitlement layer must exist **before** anyone wires it into the sim. | **Medium.** Account entitlement store + cosmetic application. **Sim untouched** ([guardrails](./vision.md#the-woc-token-guardrails)). |

---

## RETENTION SYSTEMS — Titan-inspired, journey-safe (target: v0.8–v0.9)

*The "always-on growth" loops Chinese players love. As specced here they're **cosmetic/QoL** (the de-risked, Fork-B-friendly version); if Fork A is chosen they can extend into earned power. See [design-influences](./design-influences.md#-adopt-fits-our-pillars-cleanly).*

| # | Item | Why | Scope / risk |
|---|---|---|---|
| 6 | **Account-wide cosmetic/prestige track ("Renown")** | The single most-loved Titan idea, de-risked: a bar that always ticks up across your whole roster — rewarding **titles, cosmetics, conveniences**, not stats. Extends our existing lifetime-XP/prestige/milestones. Natural home for $WOC cosmetics. | **Medium.** Account-layer track, reward catalog, UI. **Cosmetic by design** (no stats in this version). |
| 7 | **Dynamic world events** | Spontaneous open-world spawns granting account XP + cosmetics + (modest, earned) gear; revives zones, drives group play, seeds world bosses later. | **Medium.** Deterministic event scheduler (via `Rng`/tick, no wall-clock), event content, rewards. |
| 8 | **Earned dual-currency upgrade loop** | A PvE currency + a PvP currency feeding a **gear upgrade ladder** so every playstyle progresses and gear stays relevant. Pairs with full slots (#1) + professions (#10). **Power earned in-game only.** | **Medium–High.** Two currencies, upgrade mechanic, sinks/sources balance. |

---

## NEXT — the connective tissue (target: v0.9)

*Systems that make the world feel lived-in and give the economy a supply side. Each de-risks the cap rungs.*

| # | Item | Why next | Scope / risk |
|---|---|---|---|
| 9 | **Mounts + flight paths + a capital hub** | Travel is the most-felt QoL gap as the world grows; **mounts are the cap-40 reward** (provision them now); a capital anchors social life. | **Medium–High.** Mount = movement-speed state (sim); flight network (waypoints); city zone + service NPCs. |
| 10 | **Professions & crafting** | An entire vanilla pillar absent, and the economy's missing supply side (gather → recipe → crafted gear → AH). Pairs with full slots (#1) + upgrade loop (#8). | **High.** Gathering nodes (deterministic), recipes, skill-ups, crafted items, UI. Largest single system. |
| 11 | **Reputation factions (PvE)** | A stepping-stone to full factions: quartermasters, rep grinds, rep-gated gear — *without* the Alliance/Horde split yet. Long-term goals beyond level. | **Medium.** Rep tracks + UI + gated vendors; reuses quest/vendor infra. |
| 12 | **RL env parity catch-up** | Env exposes 2 of 9 classes; every system above widened the obs/action space. Keep the third host honest. | **Medium.** Expand obs/action coverage, more classes, determinism regression. |

---

## THE CAP RUNGS — climb the ladder (v1.0 → beyond)

*Execute the 20 → 30 → 40 → 60 ladder above. Each rung is content-heavy but mechanically modest; gate on measurement between rungs.*

| # | Item | Rung | Scope / risk |
|---|---|---|---|
| 13 | **Cap → 30** | Rung 1 | New zone (L20–30), ranks to 30, gear tier, 1 dungeon, XP curve. The cheap proof. **High (content).** |
| 14 | **Cap → 40 + mounts + first 10-player raid** | Rung 2 | 1–2 zones (L30–40), ranks to 40, gear tier, 1–2 dungeons, mounts at 40, raid instancing beyond party-of-5. **High.** |
| 15 | **Cap → 60 + endgame** | Rung 3 | Multiple zones (L40–60), ranks to 60, epic tiers, attunements/keys, **world bosses, 40-man raids, reputation/attunement chains**. The prize. **Very High.** |

---

## LATER — the Identity Expansion (the 60 era)

*The biggest bet, sequenced with/after the 60 rung because it reshapes the new-player funnel and only pays off on a proven, populated base.*

| # | Item | Why later | Scope / risk |
|---|---|---|---|
| 16 | **Factions: Alliance vs Horde** | Core vanilla identity; touches char creation, starting zones, world PvP, social — needs a stable base first. | **Very High.** |
| 17 | **Playable races + racial traits** | The headline of character customization; race-specific starts finally make "starting zones?" a plural answer. | **Very High.** |
| 18 | **Battlegrounds** | Structured PvP endgame; only meaningful once factions exist to fight over. | **High.** Gated on #16. |
| 19 | **Set bonuses, trinkets & itemization depth** | With all slots (#1) + crafting (#10) + upgrade loop (#8) in place, deepen the gear chase. | **Medium.** |

---

## Tuning & polish (ongoing, low-pressure)

The core 1–20 progression is sound; these are known, non-blocking refinements. Good "dev outlet" work between bigger sprints. Tracked as [System Designs](./system-designs/index.md) backlog rows.

| Item | Note |
|---|---|
| **XP curve smoothing (post-L9)** | The curve spikes after level 9 — re-tune that stretch. Everything 1–9 and the overall 1–20 shape is fine. |
| **Quest gap fill** | A few sparse stretches could use a handful more quests. Minor — not pressing. |
| **Performance benchmarks** | Optimization is already good enough; the value is **codifying budgets** (sim steps/s, tick time, snapshot bytes, client FPS, bundle size) and regression-gating them. A clean outlet for devs who want to optimize — and **mandatory if [Fork A](./design-lens.md#fork-a--crypto-forward)** is chosen (`npm run bench`, `scripts/perf_tour.mjs`, `asset_budget.mjs` are the seeds). |
| **QoL nitpicks** | Various small papercuts; batch them. Nothing glaring. |

## Always-on (every milestone, not a phase)

- **Determinism & "one sim, three hosts" are inviolable.** RNG through `Rng`, no wall-clock, sim logic stays in `src/sim/`.
- **Journey-first.** No feature makes leveling skippable or trivial. We modernize the *grind*, not the *climb*.
- **Token stays structural.** Whatever $WOC does, it never enters the deterministic sim and is granted/verified server-side (the two [token guardrails](./vision.md#the-woc-token--guardrails)). Power-vs-cosmetic is an open [fork](./design-lens.md#the-strategic-fork-the-decision-that-colors-everything) decision, not a rule.
- **i18n discipline.** Every player-visible string is a `t()` key in all 12 locales the moment it ships.
- **RL parity is a feature.** A system that changes obs/action ships with its env update.
- **The wiki stays true.** Ship a system → update [current-state.md](./current-state.md). Shift a priority → update this page.

## One-screen summary

```
LADDER          20 ─→ 30 ─→ 40 (mounts + 1st raid) ─→ 60 (raids, world bosses, attunements)

NOW (v0.8)      Item slots ·· Feedback intake ·· Mail ·· Loot rolls ·· $WOC cosmetic plumbing
RETENTION       Account cosmetic track (Renown) ·· Dynamic world events ·· Earned upgrade currencies
NEXT (v0.9)     Mounts + flight + capital ·· Professions/crafting ·· Rep factions (PvE) ·· RL parity
CAP RUNGS       →30 (proof) ·· →40 (mounts, 10-man raid) ·· →60 (full endgame)
LATER (60 era)  Alliance/Horde ·· Races + racials ·· Battlegrounds ·· Set bonuses
```

> **The throughline:** keep vanilla's journey, borrow Titan Reforged's always-on growth and earned upgrade loops, climb the cap ladder rung by rung — always vanilla-faithful, always one deterministic, server-authoritative sim. (Whether $WOC adds power or just cosmetics is the open [fork](./design-lens.md#the-strategic-fork-the-decision-that-colors-everything).)
