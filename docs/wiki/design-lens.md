# Design Lens

How we decide *what* to build and *how* to scope it. Run every feature, spike, or sprint through this before it becomes a [system design](./system-designs/index.md). Pairs with [design-influences.md](./design-influences.md) (what we borrow) and feeds [roadmap.md](./roadmap.md) (sequencing).

---

## The four gut-checks

Ask these *before* writing a spec. If a feature can't answer at least two with conviction, it's probably polish, not a sprint.

1. **How does this announce?** Is there a moment worth posting — a release note, a clip, a "professions are live" beat? Features that don't announce don't compound.
2. **How does this meme?** Is it screenshottable / clippable / quotable? "Disenchanted my BiS by accident," an enchant glow, a world-boss wipe. Memes are free distribution.
3. **How does this get more people through the gate?** Acquisition (new players), reactivation (returners), or retention (daily reason to log in)? Name which, honestly.
4. **Are we playing defense or offense?** Offense creates an advantage others don't have (a vanilla pillar competitors lack, a novel loop). Defense closes a gap players complain about. Both are valid — but know which, and don't dress up defense as offense.

Every system design records its answers to these four at the top. They're a forcing function, not paperwork.

## Pillar fit (the veto)

A feature that wins all four gut-checks still doesn't ship if it breaks a [pillar](./vision.md#design-pillars):

- **One sim, three hosts** — logic lives in `src/sim/`, runs identically offline/online/headless.
- **Determinism** — randomness through `Rng`, no wall-clock. Same seed ⇒ same world.
- **Server-authoritative** — the client renders; it never decides outcomes.
- **Token stays structural** — whatever $WOC does, it never enters the deterministic sim and is granted/verified server-side (the two [token guardrails](./vision.md#the-woc-token--guardrails)). *Whether* it confers power is a fork choice, not a veto.
- **Journey-first** — modernize the grind, never make the climb skippable.

---

## The strategic fork (the decision that colors everything)

We have two coherent directions. They aren't fully mutually exclusive, but they pull effort, design, and risk in different directions — so **pick a primary**. This is the single most important open decision; most roadmap arguments are really arguments about which fork we're on.

### Fork A — Crypto-forward

**Thesis:** the $WOC token is the headline; the game is the engine that gives it meaning.

- **Optimize for performance over content depth.** Keep the sim and netcode extremely fast and cheap to run; depth is secondary to a tight, reliable, high-throughput loop.
- **Add P2E + simple risk-to-earn loops.** Wagered duels/arenas, stake-to-enter events, seasonal earn ladders, sinks and faucets that make the economy the game.
- **Implications:** performance benchmarks become first-class (a real dev outlet — see the [Performance Benchmarks](./system-designs/index.md) system design); token integration moves *up* the roadmap; economy design dominates.
- **Still bounded by the two structural guardrails.** P2E is *allowed* — "no power" is not a rule (see [token guardrails](./vision.md#the-woc-token--guardrails)). But even P2E must stay **out of the deterministic sim** and **server-authoritative**: the wallet drives an *entitlement* the server reads, never a value the sim core touches. The RL env must still run identically with or without a token.
- **⚠️ Identity weight — decide, don't drift.** P2E/risk-to-earn carries real regulatory, perception, and player-trust weight, and it's hard to walk back. It's a legitimate choice, not a guardrail violation — but make it consciously.

### Fork B — Vibe-coded game

**Thesis:** the game is the headline; it wins by being uniquely *maintainable and extensible* by AI-assisted contributors.

- **Optimize for maintainability + extensibility.** Lean into the scaffolding that lets other people (and their agents) safely add content: clear [system-design specs](./system-designs/index.md), contribution ergonomics, strong tests, clean seams. (The model Fernando's been demonstrating — community-extensible, AI-built.)
- **Content depth via the system-design backlog.** Professions, factions, the cap ladder — shipped as pluckable specs that contributors fill out and balance.
- **Implications:** invest in the backlog quality, the contribution path, determinism/test guarantees, and docs. The project becomes a *platform* others build on; the token stays cosmetic-only and uncontroversial.
- **Risk:** slower raw economic monetization; depends on attracting contributors.

### How to use the fork

- Until it's decided, the roadmap is written **Fork-B-default** (vanilla-faithful, cosmetic-only token, extensibility-first) because it preserves optionality — you can always turn on Fork A later, but P2E is hard to walk back.
- Tag each system design with which fork it serves (`Both`, `Fork A`, `Fork B`). Anything tagged `Fork A` that touches token-for-power is **blocked** until the fork is explicitly chosen.

> **Open decision:** which fork is primary? This belongs to the project owner, not the spec. Everything token-for-power waits on it.

---

## From idea to shipped (the workflow)

```
idea ─▶ design-lens gut-check ─▶ system design doc (scoped tiers) ─▶ pluck a spec ─▶ implement ─▶ ship ─▶ update current-state
        (announce/meme/gate,        (status, lens answers,            (one tier =       (Claude or a
         offense/defense, fork)      pillar fit, 1.0/2.0,             one sprint)        contributor
                                     balance Qs, hook points,
                                     acceptance/tests)
```

The [System Designs backlog](./system-designs/index.md) is where ideas that pass the lens live as scoped, pluckable specs. A "TODO" section inside a system design is a unit of work someone can pick up, balance, and build — without re-litigating the why.
