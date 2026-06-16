# Vision

## The one-liner

**World of Claudecraft is a classic-era MMORPG, rebuilt as a single deterministic simulation — playable as a real online game *and* runnable as a headless reinforcement-learning environment, from the exact same code.**

It is faithful to vanilla-WoW-era design (real formulas, real systems, the grind that mattered), but small enough that one team can host it, reason about it, and grow it deliberately.

## Why it exists — the dual mandate

This is not "a game with an AI bolt-on." The two products are the *same artifact* viewed two ways:

1. **A micro-MMO.** Accounts, persistent characters in Postgres, a live authoritative server, other players in the world with you. Also playable fully offline in the browser — the offline world behaves *identically* to the online one because it runs the same sim.
2. **An RL environment.** The same `src/sim/` runs headless as a Gym-compatible env (NDJSON wire protocol, deterministic episodes, byte-reproducible from a seed). A classic-MMO is a genuinely hard control problem — sparse rewards, long horizons, deep action spaces — and we have a clean, fast, fully-observable one.

Whatever we add to the game, we add to the research environment. That coupling is the moat.

## Design pillars

These are load-bearing. A feature that violates a pillar is wrong even if it's fun.

1. **One sim, three hosts.** `src/sim/` is the source of truth and runs unchanged in the browser (offline), the server (online), and headless (RL). Behavior must be identical everywhere. Game logic never leaks into `render/`, `ui/`, `game/`, or `net/`.
2. **Determinism is sacred.** Fixed 20 Hz tick (`DT = 1/20`). All randomness flows through `Rng` — never `Math.random`, `Date.now`, or `performance.now` in sim code. Same seed ⇒ same world, forever. This is what makes the RL env reproducible and the netcode debuggable.
3. **Vanilla fidelity over invention.** Rage curves, hit tables, armor DR, XP curves, the 5-second rule — we use the *real* classic-era formulas (see the fidelity checklist in `README.md`). When a design question comes up, "what did vanilla do?" is the first answer we reach for. We bias toward classic systems even when they're less convenient than a modern shortcut.
4. **The server is the authority; the client only renders.** Clients stream movement intent + commands at 20 Hz. The server runs the one shared sim and returns interest-scoped snapshots. All combat, loot, XP, quest credit, and economy resolve server-side. **This pillar is what makes the $WOC guardrail enforceable** (see below).
5. **Procedural everything.** Terrain, creatures, icons, UI, VFX, and the soundtrack are generated from code, not asset files. It keeps the dependency set tiny, the repo self-contained, and the aesthetic coherent. (Asset packs are being layered in for character art via the UE5-overhaul plan, but procedural remains the default and fallback.)

## North star — where we're going

The destination is **the full vanilla experience at our scale, reached deliberately, not rushed.** Concretely, over time:

- **Higher caps, more world — a deliberate ladder: 20 → 30 → 40 → 60.** Each rung is a full vanilla-faithful tier (new zones, ability ranks, gear, dungeons) with a measurement gate before the next. 30 proves the pipeline, 40 brings mounts + the first raid, 60 is the full endgame. The climb stays meaningful — we modernize the grind, never skip the journey. See [design-influences.md](./design-influences.md) for what we borrow (and reject) from vanilla Classic and Titan Reforged.
- **The full character fantasy.** Every equipment slot (today 4 of ~16), professions and crafting, mounts and flight paths, mail — the connective tissue that makes a world feel lived-in.
- **The vanilla identity.** A two-faction split and playable races with racial traits, world PvP and battlegrounds, raids. This is the big one, and it lands *after* the 40 push because it reshapes the new-player funnel.
- **A community that steers us.** A real feedback intake (today the Discord exists but nothing pipes into planning). The roadmap should be visibly shaped by players.

See [roadmap.md](./roadmap.md) for the sequencing and rationale.

## The $WOC token — guardrails

There is a $WOC token. **As of v0.7.0 it has zero integration in the repo.** When it is integrated, exactly **two** rules are non-negotiable. They are *structural* — they protect the engine and the authority model, not a particular monetization philosophy:

> ### Token guardrails (non-negotiable — structural)
> 1. **The sim never sees it.** `src/sim/` stays pure and deterministic. Token state lives *outside* the simulation, on the account/entitlement layer — so a player's wallet can never alter a tick's outcome **directly**, and the RL env runs identically whether a token exists or not. (Server-side game logic may *read* an entitlement to grant an effect — but the deterministic sim core never does.)
> 2. **Authority stays server-side.** Entitlements are granted and verified by the server, the same way bans and mutes are. The client never asserts "I own this."

**Deliberately NOT a guardrail:** whether the token confers *power, economic value, or only cosmetics* is an **open product decision**, not a fixed rule — it's the [crypto-vs-vibe strategic fork](./design-lens.md#the-strategic-fork-the-decision-that-colors-everything). Cosmetic-only is one valid answer (Fork B); P2E / risk-to-earn power loops are another (Fork A). Both are bounded *only* by the two structural guardrails above. The earlier "never power / cosmetic-only" stance is **not** a commitment — it's parked as an option until the fork is chosen.

Integration itself is **deferred** (see roadmap).

## Non-goals (what we are deliberately *not* building)

- **Breaking the sim or its determinism for monetization.** Whatever the token ends up doing, it stays *outside* the deterministic core and server-authoritative (the two [structural guardrails](#the-woc-token--guardrails)). That line does not move — power vs cosmetic is open; *this* isn't.
- **A modern-WoW feature sprint.** We move toward *classic* design, not retail conveniences (no LFR, no instant-max, no skip-the-journey shortcuts).
- **Cap 60 as a near-term sprint.** We bump to 40 and *measure* first. Breadth without a proven pipeline is how content projects die.
- **Splitting the sim for performance or convenience.** Large single-file modules are fine here; the "one sim" invariant outranks tidiness.
- **A dependency-heavy stack.** Tiny dependency set is a feature.

## Audience

- **Players** who want the classic-MMO grind — character building, group dungeons, an economy, a ladder — without a subscription or a 15-year-old client.
- **Self-hosters and tinkerers** who want a complete, readable MMO they can run and modify.
- **RL researchers and agent builders** who want a hard, fast, deterministic, fully-observable control problem with a real game underneath.

These three audiences are served by the *same build*. That's the whole idea.
