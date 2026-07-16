# PRD — Talents & Specializations

| | |
|---|---|
| **Status** | Draft / Proposed |
| **Owner** | TBD |
| **Created** | 2026-06-14 |
| **Source demand** | Discord `#feature-requests` — fr0 ("this thing gonna have talent points / specs? come on claude can do it"), endorsed by Postman. 🔼8 upvotes — the single highest-reacted remaining request. |
| **Related systems** | Classes/abilities (`src/sim/content/classes.ts`), stat math (`src/sim/entity.ts`), combat resolution (`src/sim/sim.ts`), command layer (`src/world_api.ts`, `server/game.ts`), HUD (`src/ui/hud.ts`), persistence (`server/db.ts`) |
| **Companion PRD** | `docs/prd/max-level-xp-overflow.md` |
| **Scale** | Flagship milestone (not a single PR). Recommend a one-class vertical slice before fanning out content to all 9 classes. |

---

## 1. Summary

Add a classic-MMO-style **talent and specialization system**: as characters level they earn **talent points** to spend in a **talent tree**, customizing their class through passive modifiers, granted abilities, and choice nodes. A higher-level **specialization** sets the character's **role** (tank/healer/dps), grants signature abilities and a defining passive (Mastery analog), and selects which spec tree is available. The system supports **free respec, multiple saved loadouts, and import/export build strings** for community theorycrafting.

This PRD covers the full classic-MMO feature set end to end. The engine already has clean hook points (one central stat function, data-driven abilities, a learned-abilities resolver). The dominant cost is **(a) authoring balanced trees for 9 classes** and **(b) combat-correctness/balance risk** when talents modify abilities. A staged rollout mitigates both.

---

## 2. Background & motivation

### 2.1 Player demand
Talents drew **8 upvotes** — more than 4× any other unaddressed request — plus explicit endorsement. It is the community's #1 most-wanted remaining feature.

### 2.2 Why it matters
- **Depth & identity.** Talents are the primary character-customization vector in the classic-MMO formula. The game currently has fixed, class-locked progression with no build choices.
- **Replayability & theorycrafting.** Build diversity + shareable build strings drive the kind of community engagement already happening in Discord.
- **Foundation for endgame.** Pairs naturally with arenas (PRs #117/#44), wagering, and the XP-overflow leaderboard to give max-level play meaning.

---

## 3. How it works in classic MMOs (full breakdown across all eras)

We cherry-pick from 20 years of iteration. The throughline: **make choices meaningful, make changing your mind cheap, make builds shareable.**

### 3.1 Classic trees (Vanilla–WotLK)
- **3 trees per class.** 1 talent point per level, **first point at level 10**, ~51 points at level 60 (grew to 71 by WotLK).
- **Tier gating:** deeper rows require cumulative points spent *in that tree* (~5 per tier). Some deep talents require a specific prerequisite talent (arrow links).
- **Ranks:** most talents are multi-rank passives (e.g. +2/4/6/8/10% crit); a few are single-rank active capstones.
- **Effects:** mostly passive % modifiers; a minority grant or modify abilities.
- **Respec:** at a class trainer, escalating gold (1g → +5g/reset → 50g cap, decaying −5g/month → 10g floor). **The #1 historical complaint:** cookie-cutter builds (math forced everyone into ~the same build) + punishing respec that discouraged experimentation.
- **Dual-spec (WotLK 3.1):** two saved specs, switchable; introduced for 1000g (later 100g).

### 3.2 Modern specialization (MoP+)
- **Pick a specialization at level 10** *before* talents. Most classes have **3 specs** (Druid 4, Demon Hunter 2).
- Spec sets **role** (tank/heal/melee dps/ranged dps), grants a **signature ability** + role package (learned automatically as you level), a unique **Mastery** passive, and **Armor Specialization** (which primary stat to favor).
- A separate "pick 1 of 3 per row, a new row every 15 levels" talent layer replaced point-spending.
- **Spec swapping became free, out of combat** (Legion 7.0.3 abolished paid dual-spec entirely — every spec always available).

### 3.3 Dragonflight / current trees (10.0+)
- **Two trees per character:** a shared **Class tree** + a per-spec **Spec tree** (31/30 split at level 70).
- **First class point at 10, first spec point at 11, then alternating** as you level.
- **Node shapes encode function:** **square = active ability**, **circle = passive**, **octagon = choice node** (pick 1 of N — the cheapest way to create real build identity). Some passives are multi-rank.
- **Gating:** cumulative-points-in-tree thresholds (e.g. row 5+ needs 8 spent, row 8+ needs 20) + connection prerequisites (must own a connected node above).
- **Staged editing + Apply:** arrange points, then commit. **Validation: must spend all available points before Apply enables.** A **Clear/Reset** button refunds the whole tree.
- **10.2 QoL:** refunding an upstream point makes dependents **dormant (red shader)**, not destroyed — so you can swap a few talents without rebuilding.
- **Respec:** **free, anywhere, no NPC, no cooldown** (restricted only in combat / active M+ key / rated PvP).
- **Loadouts:** save multiple named builds (up to ~10), each with its own action bars; swap freely out of combat.
- **Import/export:** builds serialize to a **base64 build string** ({spec id, tree checksum, node selections}) enabling one-click sharing — this single feature powers community theorycrafting.

### 3.4 What makes it feel good / pitfalls (design levers)
- **Feel-good:** meaningful gates with multiple viable paths; choice nodes; low respec friction; shareable builds; readable visual language (shapes + arrows); per-build action bars.
- **Pitfalls to avoid:** mandatory filler "+2% damage" nodes (illusion of choice → cookie-cutter); punishing respec; "rebuild the whole tree" when refunding one point; over-rigid all-or-nothing apply.

### 3.5 Simplified-from-scratch essentials
Point economy → nodes in 3 flavors (passive modifier / granted active / choice node) → prerequisites (connection + cumulative-points gate) → multi-rank used sparingly → staged edit + Apply/Clear with dormant (not destroyed) dependents → role via spec selection (signature abilities + Mastery analog) → loadouts → **free respec + import/export strings**.

---

## 4. Current state in the codebase

> **Re-verified against `fix/discord-bug-batch` (PR #131) on top of Release v0.4, 2026-06-14.** Since the first draft, v0.4 merged **arena (Ashen Coliseum), the World Market, i18n, and a `src/ui/hotbar.ts` module** (now `src/ui/hud/action_bar/hotbar.ts`). Three consequences for this PRD: (1) all new UI strings must go through i18n `t()`; (2) loadout action-bar swapping should reuse the pure hotbar helpers; (3) arena is now a real **respec-lock context** and a live **balance surface** for ability-modifying talents.

| Concern | Location | Notes |
|---|---|---|
| Class definitions | `src/sim/content/classes.ts:29` | `CLASSES`; 9 classes; `baseStats`, `statsPerLevel`, ordered `abilities: string[]`. **No spec/role concept.** `ClassDef` at `:9`. |
| Player class union | `src/sim/types.ts:13-18` | 9 classes |
| Ability data model | `src/sim/types.ts:182` (`AbilityDef`), `:173` (`AbilityRank`) | `effects[]`, multi-rank already supported |
| Ability content | `src/sim/content/classes.ts:184` | `ABILITIES` record |
| Learned abilities resolver | `src/sim/content/classes.ts:1329` | `abilitiesKnownAt(cls, level)` — **hook for granted abilities** |
| Refresh known on level-up | `src/sim/sim.ts:654` (def), called `:478`/`:692`/`:2236` | `refreshKnownAbilities()` |
| **Central stat math** | `src/sim/entity.ts:54` | `recalcPlayerStats()` — buff/aura pass; runs on level/equip/buff change. **Hook for passive talents.** `createPlayer()` at `:30`. |
| Ability cast / effect resolution | `src/sim/sim.ts` (`castAbility`, `runEffects`) | `runEffects()` is the **hook for ability-modifying talents** — re-locate exact lines in this tree (sim.ts grew ~795 lines in v0.4) |
| Command plumbing | `src/world_api.ts:139` (`IWorld`, `castAbility` `:153`) → `src/net/online.ts:315` (`cmd()`), `:543` (`castAbility`) → `server/game.ts:616-617` (`switch (msg.cmd)`, `case 'cast'` `:619`, `case 'turnin'` `:629`) | pattern to copy for `spendTalent`/`respec`/`setSpec` |
| Character state (persisted) | `src/sim/sim.ts:236` (`CharacterState`), `:178` (`PlayerMeta`) | JSONB blob — **no migration to add `talents`/`spec`/`loadouts`** |
| Serialize / deserialize | `src/sim/sim.ts:536` (`serializeCharacter`) / `:428` (`addPlayer`) | |
| DB schema / save / autosave | `server/db.ts:42` (`state JSONB`), `:315` (`saveCharacterState`), `server/game.ts:38, 382-384` | 30s autosave |
| UI panels (DOM) | `src/ui/hud.ts` — `attachTooltip()` `:217`, char sheet `toggleChar()`/`renderChar()` `:1907`/`:1910`, `buildActionBar()` `:428` | vanilla DOM; toggle/render pattern to model a Talent panel on |
| **Hotbar helpers (new)** | `src/ui/hud/action_bar/hotbar.ts` | pure, unit-tested `placeAbilityOnSlot()` / `clearSlot()`; **reuse for loadout action-bar swaps** |
| Action-bar slot persistence | `src/ui/hud.ts:346` (`slotMapKey`), saved at `:382` | per-class slot map in localStorage |
| i18n string helper (new) | `src/ui/i18n.ts:1886` | `t(key)` — **all talent UI strings must register here**, not hardcoded |
| Keybinds | `src/game/keybinds.ts` (`STORE_KEY` `:64`) | char 'C', spellbook 'P', etc. — add 'N' for talents |
| Settings pattern | `src/game/settings.ts:5` | for any talent-related toggles |
| Dev set-level | `src/sim/sim.ts:685` | `setPlayerLevel()` for testing |
| Snapshot test pattern | `tests/snapshots.test.ts` | lock combat numbers before/after ability-modifier talents |
| Arena (respec-lock + balance) | `tests/arena.test.ts`, `tests/pvp_safety.test.ts`; arena code across `src/main.ts`, `src/ui/hud.ts`, `src/world_api.ts`, `src/sim/` | merged in v0.4 — restrict respec during a match; regression-test talents in arena |

**Gap:** no talents, no specs, no roles, no respec, no loadouts. Classes are fixed-role with a linear ability list.

---

## 5. Goals & non-goals

### Goals
- Earn talent points by leveling and spend them in a class talent tree.
- Three node behaviors: passive modifier, granted active ability, choice node.
- Prerequisites (connection + cumulative-points gate) and optional multi-rank nodes.
- Specialization selection that sets role (tank/heal/dps), grants signature abilities + a Mastery-style passive, and gates the spec tree.
- Free respec, staged edit + Apply/Clear, dormant-not-destroyed dependents.
- Multiple saved loadouts with per-build action bars.
- Import/export build strings.
- Server-authoritative; no client-trust of talent effects.
- Performance: talent effects precomputed into flat modifiers — never evaluated per-swing.

### Non-goals
- No raising the level cap.
- No paid/gold respec (research is unanimous it's a mistake).
- No PvP-specific talent set (PvP talents) in v1.
- No Hero-talent / third sub-tree in v1.
- No automatic build recommendation engine (import strings cover sharing).

---

## 6. Functional requirements

### 6.1 Point economy
- **FR-1.1** Characters earn talent points on level-up. Default model: **1 point/level starting at a configured level** (e.g. 10), tunable. Decide class-tree vs spec-tree split (DF-style alternating) during design.
- **FR-1.2** Total available points and spent points are tracked per character (and per loadout).
- **FR-1.3** Points already earned are granted retroactively if the economy changes (migration-safe recompute from level).

### 6.2 Talent tree data model
- **FR-2.1** New `src/sim/content/talents.ts` defines, per class (and per spec where applicable), a tree of nodes.
- **FR-2.2** Node schema:
  ```ts
  interface TalentNode {
    id: string;
    tree: 'class' | 'spec';
    kind: 'passive' | 'active' | 'choice';
    maxRank: number;                 // 1 for single-rank
    requires?: string[];             // connection prerequisites (node ids)
    pointsGate?: number;             // cumulative points in this tree to unlock
    choices?: TalentChoiceOption[];  // for kind === 'choice'
    effect: TalentEffect;            // see 6.5
    icon: string; name: string; description: string;
    row: number; col: number;        // layout
  }
  ```
- **FR-2.3** Trees are pure data, validated at load (no cycles, valid prereqs, reachable nodes).

### 6.3 Specialization & roles
- **FR-3.1** Each class defines its specs (most 3; Druid 4; counts mirror the classic-MMO convention or be simplified — decide in design). Add a `specs` field to `ClassDef`.
- **FR-3.2** Choosing a spec (at a configured level, e.g. 10) sets **role** (tank/healer/melee-dps/ranged-dps), grants a **signature ability**, a **Mastery-style passive**, and selects the spec tree.
- **FR-3.3** Role affects nothing the engine can't already express (threat via the threat system from PR #36, healing targeting, etc.) — map roles onto existing mechanics.
- **FR-3.4** Switching spec is free, out of combat; each spec retains its own talents + action bars (via loadouts, 6.7).

### 6.4 Allocation, gating & respec
- **FR-4.1** Spend a point into a node via `spendTalent` (respecting maxRank, connection prereqs, points gate, available points).
- **FR-4.2** **Staged editing:** the UI stages changes locally; **Apply** commits the whole build in one command. Validation requires all available points spent before Apply enables (configurable; allow partial if we prefer lower friction).
- **FR-4.3** **Respec/Clear:** free, out of combat. Refund whole tree (Clear) or refund individual nodes; refunding an upstream node makes dependents **dormant**, not destroyed.
- **FR-4.4** Respec restricted in combat (and later: active arena match — integrate with PRs #117/#44).
- **FR-4.5** All allocation is validated server-side; invalid client requests are rejected with a reason event.

### 6.5 Talent effects (three behaviors)
- **FR-5.1 Passive modifiers:** flat or % changes to stats (str/agi/sta/int/spi/armor/AP/crit/dodge/hp/mana/etc.). Applied in `recalcPlayerStats()`.
- **FR-5.2 Granted abilities:** add an ability (or ability rank) to the known set. Applied via `abilitiesKnownAt()`/`refreshKnownAbilities()`.
- **FR-5.3 Ability modifiers:** change a specific ability's damage/healing/cost/cooldown/cast-time/added-effect. Applied in `runEffects()` reading **precomputed** per-ability modifier tables (see Performance).
- **FR-5.4 Choice nodes:** mutually exclusive options; selecting one applies its effect, deselecting reverts.
- **FR-5.5** Mastery-style passive (per spec) is a special always-on passive scaling a spec-defining mechanic.

### 6.6 Build strings (import/export)
- **FR-6.1** Serialize a build to a compact **base64 string** ({class, spec, node→rank selections, checksum}).
- **FR-6.2** Import validates the string against the current tree (version/checksum) and applies it as a staged build for review before Apply.
- **FR-6.3** Pure client utility; server still validates the resulting allocation.

### 6.7 Loadouts
- **FR-7.1** Save multiple named loadouts per character (target ~5–10), each = full talent allocation + spec + action-bar slot map.
- **FR-7.2** Switch loadout freely out of combat; switching also swaps the action bar: reuse the per-class slot-map storage in `src/ui/hud/action_bar/action_bar_controller.ts` and the pure `placeAbilityOnSlot()`/`clearSlot()` helpers in `src/ui/hud/action_bar/hotbar.ts` (its exported `loadoutKnownAbilityIds()` and `applyLoadoutBar()` now implement the bar swap).
- **FR-7.3** Loadouts persisted in `CharacterState`.

### 6.8 UI
- **FR-8.1** Talent panel (new window, model on spellbook/quest-log DOM pattern), bound to **'N'**.
- **FR-8.2** Renders Class tab + Spec tab, node grid with **shape-coded icons** (square/circle/octagon), **prerequisite arrows**, points-spent counters per tree, available-points indicator.
- **FR-8.3** Staged-edit affordances: click to add rank, right-click/Clear to refund, **Apply** + **Clear** buttons, dormant nodes shown with a red shader.
- **FR-8.4** Tooltips per node (effect, current/next rank, prereqs) via the existing `attachTooltip()` system.
- **FR-8.5** Loadout dropdown (save/rename/switch/delete) + Import/Export buttons (paste/copy build string).
- **FR-8.6** Character sheet surfaces current spec, role, and Mastery.
- **FR-8.7** **i18n (new constraint):** every talent/spec/loadout UI string (node names, descriptions, tab labels, buttons, tooltips, errors) must be registered in `src/ui/i18n.ts` and rendered via `t(key)` (`:1886`). No hardcoded display strings — the game shipped multilingual support in v0.4.

### 6.9 Persistence & networking
- **FR-9.1** Add `talents`, `spec`, `loadouts`, `activeLoadout` to `CharacterState` (JSONB; no migration).
- **FR-9.2** New commands `spendTalent`, `applyTalents`, `respec`, `setSpec`, `saveLoadout`, `switchLoadout` through `IWorld` → `cmd()` → `server/game.ts` switch → `Sim` methods.
- **FR-9.3** Server emits events on talent/spec/loadout changes; client updates panel + recomputes derived display.

---

## 7. Architecture & integration

```
Allocation (server-authoritative Sim)
  spendTalent/applyTalents/respec/setSpec
        │
        ▼
  Validate (prereqs, gates, points, combat-lock)
        │
        ▼
  PRECOMPUTE talent modifier struct on the player:
     • statModifiers      → consumed by recalcPlayerStats()   [entity.ts:54]
     • grantedAbilities   → consumed by abilitiesKnownAt()    [classes.ts:1329]
     • abilityModifiers   → consumed by runEffects()          [sim.ts — re-locate in current tree]
        │
        ▼
  recalcPlayerStats() + refreshKnownAbilities()  (already called on level/equip/buff)
        │
        ▼
  Snapshot/events → client → Talent panel + char sheet + action bar
```

**Key principle:** talents are resolved into a **flat precomputed struct at allocation/respec time**. The combat hot path (`runEffects`, melee swing, per-tick) only reads flat numbers — it never walks the talent tree.

---

## 8. Performance requirements

- **PR-1** **No per-swing/per-tick tree evaluation.** All talent effects precomputed into flat lookups on allocation/respec/loadout-switch.
- **PR-2** `recalcPlayerStats()` already runs only on level/equip/buff/respec — adding a talent pass there is free.
- **PR-3** `runEffects()` reads a precomputed per-ability modifier map (O(1) per cast), not a tree scan.
- **PR-4** Talent allocation/respec is infrequent and out-of-combat; its cost is irrelevant to frame time.
- **PR-5** Respect existing crowd-perf work (PR #24): talent display data sent per player must not bloat snapshots — send allocations only on change, not every snapshot.

---

## 9. Gameplay & balance design

- **Every node a real choice.** Avoid Vanilla-style filler passives; lean on **choice nodes** to create identity cheaply. A smaller, denser tree beats a sprawling one at our point budget.
- **Free respec** (research is unanimous). Restrict only in combat / active ranked match.
- **Role integrity:** specs must make tank/heal/dps meaningfully distinct using existing systems (threat from PR #36, healing, resource types).
- **Balance risk is concentrated in 6.5.3 (ability modifiers).** Treat Phase 3 as the high-risk phase with heavy regression/snapshot testing.
- **Tuning loop:** ship a one-class vertical slice publicly, gather data, then author remaining classes.

---

## 10. Phasing

| Phase | Scope | Risk | Est. |
|---|---|---|---|
| **0 — Design + content** | Point economy, node schema, **author trees** (start 1–2 classes as a vertical slice), spec/role definitions | Design-heavy | L (bulk of total effort) |
| **1 — Passive talents** | Data model, point economy, persistence, `spendTalent`/`respec`, `recalcPlayerStats` pass (passives only — no new abilities) | Low | M |
| **2 — Talent UI** | Tree panel: tabs, shape-coded nodes, arrows, staged edit + Apply/Clear, dormant nodes, tooltips, keybind 'N' | Medium | M–L |
| **3 — Active & ability-modifying talents** | Hook `abilitiesKnownAt` + `runEffects` via precomputed tables; choice nodes; Mastery passive | **High** | L |
| **4 — Specs, loadouts, build strings** | Role selection, multiple saved builds + action bars, base64 import/export | Medium | L |

**Recommendation:** Phases 1–2 for **one class** → public beta → iterate → fan out content (Phase 0 for remaining 8 classes) in parallel with Phases 3–4.

---

## 11. Testing strategy

### 11.1 Unit / snapshot (`tests/`)
- Tree validation: no cycles, valid prereqs, all nodes reachable, points-gate sanity (new `tests/talents.test.ts`).
- Allocation rules: maxRank, connection prereqs, points gate, available-point accounting, dormant-dependent behavior on refund.
- Passive effects: allocate → `recalcPlayerStats()` reflects the modifier; respec reverts cleanly.
- **Ability modifiers (Phase 3): snapshot tests** (`tests/snapshots.test.ts` pattern) lock damage/heal numbers before/after a talent.
- Build strings: round-trip export→import→identical allocation; reject malformed/version-mismatched strings.
- Loadouts: save/switch restores talents + spec + action bar.

### 11.2 Local manual testing
1. `ALLOW_DEV_COMMANDS=1`; `setPlayerLevel()` (`sim.ts:555`) to a level with points available.
2. **Phase 1:** spend into a +Str/+crit passive → open character sheet (`hud.ts:1408`) → confirm stats change; respec → confirm revert.
3. **Phase 3:** allocate an ability-modifying talent → cast → confirm damage/cost/cooldown change in the combat log.
4. Choice node: pick option A vs B → confirm only one applies.
5. Persistence: log out/in → allocations, spec, active loadout survive.
6. Build string: export, clear, import → identical build.
7. Loadout: save two builds, switch → talents + action bar swap.

### 11.3 Multiplayer correctness
- Verify all talent effects compute in the authoritative `Sim` and reach clients via snapshot/events (test the online `ClientWorld` path). Reject client-side talent claims.

### 11.4 Performance
- With dev tools, spawn a crowd of talented players and confirm no per-tick talent evaluation regresses frame time vs. baseline (compare against PR #24 crowd metrics).

---

## 12. Telemetry / metrics

- Track: spec distribution per class, most/least-picked nodes (detect filler/cookie-cutter), respec frequency, loadout adoption, build-string import counts.
- Balance signal: nodes picked ~always or ~never indicate tuning problems.

---

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Authoring balanced trees for 9 classes is huge | Vertical slice (1 class) first; templatize node patterns; telemetry-driven tuning |
| Ability-modifier talents break combat correctness | Precomputed modifier tables + snapshot tests; Phase 3 isolated and heavily tested |
| Per-tick perf regression | Flat precomputed modifiers; never scan tree in hot path |
| Cookie-cutter builds | Choice nodes; avoid filler passives; telemetry to spot convergence |
| Client trust / cheating | Server-authoritative validation of all allocations and effects |
| Snapshot bloat | Send allocations on change only, not every snapshot |
| Respec-in-arena exploits | Combat/match lock integrated with arena PRs |

---

## 14. Open questions

1. Tree topology: single class tree, or DF-style Class + Spec split? How many points and at what level cadence (given a level-20 cap)?
2. Spec counts per class — mirror the classic-MMO convention (3/4/2) or simplify to a uniform number?
3. Apply rule: require all points spent (DF-strict) or allow partial (lower friction)?
4. Mastery analog: per-spec scaling mechanic, or skip in v1?
5. Do roles need new engine support (e.g. healer threat, taunt) beyond the existing threat system?
6. Action-bar coupling: do loadouts fully own the action bar, or only suggest changes?

---

## 15. Acceptance criteria

- A leveling character earns talent points and spends them in a validated tree (prereqs, gates, ranks enforced server-side).
- Passive, granted-ability, and ability-modifying talents all function and are reflected in stats / known abilities / combat numbers.
- Choosing a spec sets role, grants signature ability + Mastery passive, and selects the spec tree.
- Respec is free out of combat, refunds correctly, and leaves dependents dormant (not destroyed) on partial refunds.
- Multiple loadouts save/switch (talents + spec + action bar); build strings round-trip and validate.
- The talent panel renders shape-coded nodes, arrows, staged edit + Apply/Clear, tooltips, and import/export.
- No measurable combat-tick perf regression; all effects server-authoritative.
- At least one class fully shipped end-to-end as the vertical slice before content fan-out.
