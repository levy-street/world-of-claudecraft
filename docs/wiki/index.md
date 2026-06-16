# World of Claudecraft — Dev Wiki

The single source of truth for **where the game is**, **where it's going**, and **why**.
A **public development roadmap** for the dev team and contributors (not a player-facing
manual). It lives in `docs/wiki/*.md` in the repo — edit it by PR — and renders at
`worldofclaudecraft.com/dev`.

> Snapshot: **v0.7.0** · level cap **20** · 9 classes · 3 zones · ~73 quests · 4 dungeons
> Last reviewed: **2026-06-16**

## Pages

| Page | What it answers |
|---|---|
| [vision.md](./vision.md) | What this project *is*, the design pillars, the north star, and the hard guardrails (incl. the $WOC token stance). Read this first. |
| [current-state.md](./current-state.md) | Grounded inventory of every system — FULL / PARTIAL / ABSENT — straight from the code, plus the gap analysis that maps to the questions the dev team keeps asking. |
| [design-influences.md](./design-influences.md) | What we draw from (vanilla Classic's most-loved fundamentals + China's Titan Reforged retention loops) and what we deliberately reject. The "why" behind the roadmap. |
| [design-lens.md](./design-lens.md) | How we decide *what* to build: the announce/meme/gate/offense-defense gut-checks, the pillar veto, and the **crypto-vs-vibe strategic fork**. Run features through this before they become specs. |
| [roadmap.md](./roadmap.md) | The prioritized plan, spined on the **20 → 30 → 40 → 60** cap ladder: Now → Retention loops → Next → Cap rungs → Identity Expansion. What ships in what order, and why. |
| [system-designs/index.md](./system-designs/index.md) | The **backlog of scoped, pluckable specs** (the TODO hub). Pick a tier, balance the numbers, build it. [Professions](./system-designs/professions.md) is the worked example. |

## The four steering decisions this cycle (2026-06-16)

These were decided deliberately and shape everything downstream. If you want to change one, change it *here* and ripple it through the pages.

1. **Level cap: climb a deliberate ladder — 20 → 30 → 40 → 60.** Not a sprint. Each rung is a full vanilla-faithful tier (zones, ranks, gear, dungeons) with a measurement gate before the next: **30** is the cheap pipeline proof, **40** is the real test (and brings mounts + the first raid), **60** is the full endgame prize. The journey stays sacred — we never make leveling skippable. See [roadmap.md](./roadmap.md#high-level-goal-the-progression-ladder-20--30--40--60).
2. **$WOC token: two structural guardrails, and power-vs-cosmetic left open.** The only non-negotiables are *the sim never sees it* and *authority stays server-side*. Whether the token confers power (P2E) or only cosmetics is an **open product decision** — the [strategic fork](./design-lens.md#the-strategic-fork-the-decision-that-colors-everything), not a fixed rule. See [vision.md](./vision.md#the-woc-token-guardrails).
3. **Factions + races: yes, over time.** We commit to the full vanilla identity — a two-faction split and playable races with racial traits — but it lands *after* the 40 push because it reshapes character creation, starting zones, and world PvP.
4. **"Vanilla over time" is the directional bias.** When in doubt, move toward classic-era fidelity (real formulas, real systems) rather than inventing mechanics. Depth and breadth both matter; sequence them deliberately.

## How to keep this wiki honest

- **current-state.md is derived from code.** When you ship a system, update its row. A wiki that lies is worse than no wiki.
- **roadmap.md is derived from decisions.** When priorities shift, move the item and note why — don't silently delete.
- **vision.md changes rarely.** It's the constitution. Pillars and guardrails should be stable; if one bends, that's a big deal and worth a paragraph.
- **system-designs/ is the work queue.** Ideas that pass the [Design Lens](./design-lens.md) become scoped, pluckable specs. A contributor (or Claude) picks a tier, balances the open numbers, and builds it — then updates current-state. That's the loop: idea → lens → spec → pluck → ship.
- Cross-link liberally. Each page assumes you might land on it cold.

## Related existing docs (not duplicated here)

| Doc | Scope |
|---|---|
| `README.md` | Host/develop/play guide + the classic-fidelity checklist (formulas, per-class ranks). |
| `docs/design/master-spec.md` | The full L6–20 content spec (zones 2–3, quests, dungeons, XP math). |
| `docs/design/spell-ranks.md` | Every ability rank L1–20 for all 9 classes. |
| `docs/design/ue5-overhaul-plan.md` · `graphics-plan.md` | Renderer / asset direction. |
| `docs/prd/` | Per-feature PRDs (talents, max-level overflow — both now shipped). |
| `CLAUDE.md` (root + per-dir) | Architecture invariants and conventions. **The "one sim, three hosts" rule governs every roadmap item.** |
