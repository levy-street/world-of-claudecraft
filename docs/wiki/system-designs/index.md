# System Designs

The backlog of **scoped, pluckable specs**. Each system design is a self-contained doc that passed the [Design Lens](../design-lens.md); a contributor or Claude can pick one *tier* (e.g. "Professions 1.0"), balance the open numbers, and build it — without re-deciding the why.

This page is the **TODO hub**: the table below is the queue. [Professions](./professions.md) is the worked example of a fully-scoped design; the rest are stubs waiting to be filled out to the same standard.

---

## How to use this

- **Picking up work?** Find a row with status **Scoped** or **Ready**, open it, choose a tier, and implement that tier. The spec tells you what to build, what to balance, where the hooks are, and how it's tested.
- **Proposing work?** Run it through the [four gut-checks](../design-lens.md#the-four-gut-checks). If it passes, add a row here and write the design to the [template](#the-template) below. Link it from [roadmap.md](../roadmap.md) if it affects sequencing.
- **Claude's job** on a plucked spec: fill the open balance numbers with vanilla-faithful values, keep determinism + server authority, write the tests, and update [current-state.md](../current-state.md) when it ships.

**Status legend:** 💡 **Idea** (one line) · 📐 **Scoped** (tiers + balance Qs written) · ✅ **Ready** (hooks + tests specified, pluck it) · 🚧 **In progress** · 🏁 **Shipped**.

**Fork tag:** which [strategic fork](../design-lens.md#the-strategic-fork-the-decision-that-colors-everything) it serves — `Both` / `Fork A` (crypto) / `Fork B` (vibe). `Fork A` items touching token-for-power are **blocked** until the fork is chosen.

**Roadmap phase** (the canonical set — matches [roadmap.md](../roadmap.md)):

| Phase | Meaning |
|---|---|
| **NOW** | Depth at current scale (v0.8). |
| **RETENTION** | Titan-inspired cosmetic/world-event loops (v0.8–0.9). |
| **NEXT** | Connective tissue: professions, mounts, rep factions (v0.9). |
| **CAP:→30 / →40 / →60** | The cap-ladder **rungs** (v1.0+). "Rung" means *only* these. |
| **LATER** | Identity expansion: factions, races, set bonuses (post-1.0). |
| **TUNING** | Ongoing low-pressure polish. |
| **ALWAYS-ON** | Every milestone (determinism, i18n, perf, RL parity). |

**Epics map per tier** — a multi-tier design lands across several phases (e.g. Equipment Slots 2.0 = NOW, 3.0 = NEXT, 4.0 = LATER), so its row lists the tier→phase mapping rather than one phase.

---

## The backlog

| System design | Status | Fork | One-line scope | Roadmap phase |
|---|---|---|---|---|
| **[Professions](./professions.md)** | 📐 Scoped | Both | Profession panel, auto-progressing skills; 1.0 = First Aid + Enchanting/Disenchant (no world nodes); 2.0 = Mining/Herbalism gathering nodes. | NEXT |
| **[Equipment slots](./equipment-slots.md)** | 📐 Scoped | Both | Fill the paperdoll in tiers: 4 → 8 → 12 → ~17 slots. Unblocks sets, trinkets, enchanting targets. | 1.0 🏁 · 2.0 NOW · 3.0 NEXT · 4.0 LATER |
| **Account cosmetic track ("Renown")** | 💡 Idea | Both | Always-on account bar rewarding titles/cosmetics/QoL — never stats. Home for $WOC cosmetics. | RETENTION |
| **Dynamic world events** | 💡 Idea | Both | Deterministic open-world spawns granting account XP + cosmetics; shares the node/spawn framework with Professions 2.0. | RETENTION |
| **Earned upgrade currencies** | 💡 Idea | Both | Dual PvE/PvP currency feeding a gear upgrade ladder; power earned in-game only. | RETENTION |
| **Mail system** | 💡 Idea | Both | Async gold/item delivery; the economy's missing half. | NOW |
| **Need/greed/pass loot** | 💡 Idea | Both | Loot roll session + UI; the social loot ceremony. | NOW |
| **Mounts + flight + capital** | 💡 Idea | Both | Mount speed state, flight network, a capital hub; mount is the cap-40 reward. | NEXT |
| **Reputation factions (PvE)** | 💡 Idea | Both | Rep tracks, quartermasters, gated gear — stepping stone to full factions. | NEXT |
| **Performance benchmarks** | 💡 Idea | Both (esp. Fork A) | Codify perf budgets (sim steps/s, tick time, snapshot bytes, client FPS, bundle size) and regression-gate them. A real dev outlet; mandatory if Fork A. | always-on |
| **XP curve smoothing (post-L9)** | 💡 Idea | Both | Re-tune the curve after level 9 — currently spikes. Core 1–20 progression is otherwise sound. | tuning |
| **Quest gap fill** | 💡 Idea | Both | Add a handful of quests in sparse stretches. Low priority — not pressing. | tuning |
| **$WOC cosmetic foundation** | 💡 Idea | Both | Off-chain account entitlement layer for cosmetics; sim untouched. | NOW |
| **P2E / risk-to-earn loops** | 💡 Idea | **Fork A — gated** | Wagered duels/arenas, stake-to-enter events, earn ladders. Allowed in principle (no "no-power" rule), but **gated on choosing Fork A**; must stay sim-external + server-authoritative. | gated on fork |

Counts are honest: only **Professions** is written to the template so far. The rest are placeholders — promoting one to 📐 Scoped means writing it out fully. That's the work this backlog exists to make easy.

---

## The template

Copy this when writing a new system design. The headers are the contract — a plucker should be able to build from them alone.

```markdown
# <System Name>

**Status:** 💡/📐/✅/🚧/🏁   **Fork:** Both / Fork A / Fork B   **Roadmap phase:** <NOW/RETENTION/NEXT/CAP:→30/LATER/TUNING> (per tier for epics)

## Summary
One paragraph: what it is, and how it fits our 1–20 micro-MMO (not retail-scale).

## Design-lens answers
- **Announce:** …
- **Meme:** …
- **Gate:** acquisition / reactivation / retention — which, and why.
- **Offense or defense:** … (and which pillar gap, if defense)

## Pillar fit
How it stays deterministic, sim-side, server-authoritative, earned-not-bought, journey-first.

## Scope tiers (the TODO sprints)
### <Name> 1.0  — <the pluckable sprint>
Concrete sub-features, each buildable. What's explicitly OUT of 1.0 and why.
### <Name> 2.0  — <the next tier>
What it adds, and what it depends on from 1.0.

## Open balance questions (for the implementer to fill)
Numbers/curves to tune, marked as proposed-not-final. This is the "Claude balances it" surface.

## Hook points
Where it lands in the codebase (file:area), from current-state knowledge.

## Acceptance criteria & tests
Determinism test, behavior tests, and the no-P2W / pillar invariants to assert.

## Dependencies
Other system designs it needs or unblocks.
```

See [Professions](./professions.md) for this template applied end-to-end.
