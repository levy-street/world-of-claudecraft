# Professions combo and attunement implementation plan

## Goal

Make combo crafting, crafting identity, and attunement one reachable, server-authoritative
player loop in offline and online play. This plan targets `release/v0.27.0` and the issue
chain around GitHub issues 2033, 1292, 1293, 1295, and 1302.

The larger professions integration epic, issue 1866, remains open for unrelated work such
as gathering controls, tools, item identity, economy transfers, and advanced profession
actions. Jack of All Trades mechanics in issue 1296 also remain separate because their
ceilings, perks, and switching costs still have open product decisions.

## Implementation status

Phases 1 through 4 of this plan are implemented and delivered together as PR 2039
(branch `codex/profession-quest-objectives`, based on `release/v0.27.0`). The pull
request is the authoritative record of the change set, its review state, and its
validation results; this document does not restate them.

- Phase 1: authoritative `craft` and `gather` objective arms on `QuestObjective`
  (`src/sim/types.ts`), credited through `src/sim/quests/quest_credit.ts`, with the
  onboarding quest-item workaround removed.
- Phase 2: exact-pair attunement, escalating returns, and hobby switching reachable
  through validated repeatable quests, all gated by the one shared exact-pair combo
  rule, `comboEligibility` (`src/sim/professions/combo_eligibility.ts`), consumed by
  the authoritative crafting resolver.
- Phase 3: the atomic `cprof` self-snapshot delta (`server/game.ts`, mirrored by
  `ClientWorld`) carrying craft skills and crafting identity as one value, with the
  shared combo result driving online crafting presentation and action gating.
- Phase 4: the profession identity card, guidance, dormant-knowledge presentation, and
  pre-acceptance attunement consequences.

The persisted archetype record is extended additively with the explicit hobby craft and
the `attunedPairs` pair history (`src/sim/professions/archetype.ts`); save normalization,
persistence round trips, and the online combo-craft loop are covered by tests that ship
in the same change.

## Pre-change baseline

This section records the behavior this plan started from, kept as historical context.
PR 2039 changed all of it; none of these statements describe the code at head.

- `src/sim/professions/crafting.ts` authoritatively resolved crafting, but its combo check
  accepted any player whose two craft ceilings met the recipe tier. It did not require the
  active adjacent pair to match the recipe.
- `src/ui/crafting_view.ts` had a separate raw-skill combo calculation. The two calculations
  could disagree.
- `server/game.ts` did not snapshot craft skills or crafting identity. Consequently,
  `ClientWorld` kept its zero-skill and null-archetype placeholders for the whole session.
- `src/sim/professions/archetype.ts` persisted the active/title craft, paired major, switch
  count, and amends progress. It derived the hobby and had no history of previously held
  archetype pairs.
- The acceptance and make-amends quests in `src/sim/content/zone1.ts` were retired
  placeholders and had no completion effects.
- `QuestObjective` supported only kill, collect, and interact. The profession onboarding
  quest used a gathering-specific quest-item grant instead of a real gather objective.
- The crafting window showed reagents but not the combo pair and tier requirement.

## Desired behavior

- An archetype is an adjacent pair of major crafts. One major carries the displayed title.
- A persisted hobby is one of the two crafts opposite that pair and remains capped at rare.
- Previously held pairs are persisted so first-time lore attunement and return
  make-amends flows are distinguishable.
- Combo recipes require the exact active pair, ignoring pair order, plus the required tier
  in both majors. Unattuned, Jack, hobby, and wrong-pair skill never unlock a combo.
- Crafting and gathering can advance authored quest objectives through successful
  authoritative actions.
- Attunement transitions happen only as validated quest completion effects.
- The server snapshots craft skills and the complete crafting identity atomically.
- The crafting UI and authoritative sim consume one shared combo eligibility result and
  explain the requirement inline, in the tooltip, and in the accessible name.

## Architectural decisions

### Crafting identity

Extend the persisted archetype record additively with:

- `hobbyCraft`, an explicit craft id rather than a derived read.
- `attunedPairs`, a deduplicated list of stable adjacent-pair ids.

Keep `activeArchetype` and `pairedMajor` for compatibility. Treat them together as the
current pair. Normalization validates adjacency, backfills an older save's current pair
into history, and derives the legacy hobby only when the explicit field is absent.

`switchCount` counts completed returns to a previously held pair. A first entry into a new
pair uses the lore path and does not increase the make-amends escalation counter.

### Quest transitions

Add optional quest metadata for repeatability and a discriminated completion effect. Store
the selected target and resolved objective counts on `QuestProgress` when the quest is
accepted. The server validates the selection on accept and again immediately before
turn-in, then applies the completion effect inside the authoritative turn-in transaction.

Do not expose acceptance or amends-credit helpers as direct client commands. The existing
quest accept command may carry a typed selection; turn-in uses the persisted selection so
a client cannot change the target after completing the objectives.

The make-amends objective count is resolved from content on acceptance using the existing
`5 + 3 * switchCount` curve. Snapshotting the resolved count makes an active quest stable
across later state changes and persistence round trips.

### Combo eligibility

Create one pure profession module that returns a structured result. For a combo recipe it:

1. Requires a non-null active and paired major.
2. Requires the unordered active pair to equal the recipe's unordered pair.
3. Requires `craftCeiling` for both majors to meet the recipe tier.

Both the authoritative crafting resolver and crafting view consume this result. The result
includes a stable failure classification and craft ids so presentation can explain the
specific unmet requirement without duplicating game rules.

### Online mirror

Add one versioned self-snapshot delta, `cprof`, containing craft skills and crafting
identity as a single value. Do not overload gathering's `prof` or `gprof` fields. A fresh
session always receives the complete value and subsequent snapshots diff-send it.

`ClientWorld` tracks whether `cprof` has ever arrived. Before it arrives, the UI treats
crafting identity as unknown and lets the server adjudicate a craft attempt rather than
interpreting placeholder zeroes as a permanent denial.

### Compatibility and security

- Persistence is additive JSONB, with no SQL schema or query change.
- Older character saves normalize to valid defaults without losing craft skills.
- Repeatable profession quests remain in `questsDone` as historical completion, while
  their quest-state rule permits reacceptance. Repeated completions do not repeatedly
  award daily quest-completion points.
- All skill gain, quest credit, selection validation, costs, and crafting outcomes remain
  server authoritative and deterministic.
- Player-visible text is added to the English source catalog only and rendered through
  the existing localization seams.

## Phase 1: craft and gather quest objectives

### Outcome

Quests can require a successful craft of a recipe or a successful gather of a material or
node type. Existing objective kinds remain unchanged. The profession onboarding quest uses
a genuine gather objective instead of a special quest-item grant.

### Production seams

- `src/sim/types.ts`: discriminated objective records.
- `src/sim/quests/quest_credit.ts`: shared credit and readiness logic.
- `src/sim/sim_context.ts` and `src/sim/sim.ts`: append and bind quest-credit callbacks.
- `src/sim/professions/crafting.ts`: credit only a successful craft.
- `src/sim/professions/gathering.ts`: credit only a granted harvest.
- `src/sim/quest_targets.ts`: resolve node-type objectives to map areas.
- `src/sim/content/zone1.ts`: convert `q_prof_intro` to a gather objective and remove its
  workaround dependency.
- Client localization projection for structured quest-progress data.

### Tests and validation

- Matching craft and gather actions advance exactly once and reach ready at the authored
  count.
- Nonmatching recipes, materials, and node types do not advance.
- Denied craft and harvest attempts do not advance.
- Existing kill, collect, and interact objectives retain their behavior.
- The profession intro can be completed by harvesting its authored ore nodes without a
  dedicated quest-item grant.
- Run focused quest/profession tests, progression content validation, architecture and
  localization guards, typecheck, then the full contribution gate before handoff.

### Exit criteria

Issue 1292's behavior is fully implemented and tested. No live attunement content or combo
eligibility behavior changes in this phase.

## Phase 2: live attunement and exact combo authority

### Outcome

First-time pair attunement, return make-amends, and hobby switching are reachable through
live quest content. Exact-pair combo enforcement activates in the same phase so no release
temporarily locks combos behind an unreachable state.

### Production seams

- Extend `ArchetypeState` normalization and persistence with explicit hobby and pair history.
- Add repeatable quest metadata, persisted selection, resolved counts, and completion
  effects in a small quest-effect module.
- Replace retired placeholder quests with authored lore, make-amends, and hobby quests.
- Add the pure shared combo eligibility module and consume it in authoritative crafting.

### Tests and validation

- First entry, return entry, invalid target, escalating cost, hobby flip, old-save
  normalization, and persistence round trips.
- Exact pair and tier succeeds. Unattuned, hobby, wrong pair, and low tier fail.
- No profession transition can be invoked by an unvalidated client command.

### Exit criteria

An offline player and the authoritative server Sim can reach a qualifying archetype through
normal quest play and craft its combo recipe.

## Phase 3: atomic online mirror and combo requirement UI

### Outcome

Online clients mirror authoritative craft skills and identity, use the shared combo result,
and can complete the combo craft loop without placeholder-state denial.

### Production seams

- Add `cprof` to `server/game.ts`, `ClientWorld`, snapshot registries, and value-level tests.
- Add a composite crafting-identity read to `IWorldProfessions` while retaining compatible
  scalar accessors.
- Project structured combo requirements from the pure crafting view and render localized
  inline, tooltip, and accessible text.

### Tests and validation

- Initial login, skill-up, attunement change, hobby change, reconnect, and persisted reload
  all update `ClientWorld` values.
- View and server agree across the eligibility matrix.
- A GameServer plus ClientWorld test covers quest state, snapshot, enabled action,
  `craft_item`, and output.

### Exit criteria

Issue 2033 is closed by an end-to-end online regression test, not only by structural wire
coverage.

## Phase 4: profession identity and legibility

### Outcome

Players can inspect skills, current majors, title, hobby, empowerment caps, and dormant
knowledge, and see the complete consequences before accepting an attunement quest.

### Production seams

- Add the profession identity card as a pure view core plus painter.
- Add nonblocking trend nudges, the first-tier tutorial, and attunement summary.
- Reuse the mirrored crafting identity and shared profession display-name keys.

### Tests and validation

- Pure view tests cover all identity states and summaries.
- Painter tests cover localized visible, tooltip, and accessible text.
- Verify desktop and mobile presentation and capture the required PR screenshots.

### Exit criteria

Issues 1295 and 1302 are satisfied without introducing another source of profession rules.

## Final acceptance matrix

| Character state | Combo result |
| --- | --- |
| Exact active pair, both tiers met | Allowed |
| Exact active pair, one tier below | Denied with tier explanation |
| Unattuned with high raw skills | Denied |
| Major plus hobby with high raw skills | Denied |
| Different active pair with retained high skills | Denied |
| Jack of All Trades | Denied |
| Ordinary non-combo recipe | Existing behavior unchanged |

## Risks and deferred decisions

- Jack of All Trades remains combo-ineligible, but its breadth ceiling, perks, and switching
  flow are deferred to issue 1296.
- Final quest prose, NPC placement, and economy tuning require product review during Phase 2.
- The initial hobby selection should be deterministic from the two opposite candidates. The
  recommended rule is higher retained craft skill with a stable ring-order tie break, followed
  by the lower-cost explicit hobby-switch quest.
- The entire issue 1866 epic must not be closed by this program. Its remaining acceptance
  criteria require separately scoped implementation and verification.
