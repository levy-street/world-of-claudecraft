# World API (#3) to Server Runtime (#4) hand-off

This note is the boundary between workstream #3 (the World API / protocol-boundary
refactor, branch `refactor/world-api`) and workstream #4 (the server runtime refactor).
It is written at the close of #3's finale slice (W11). #3 made the `CommandName` table
and the faceted `IWorld` real and pinned them with three boundary gates; #4 owns the
PHYSICAL `server/game.ts` restructure, now facet-aware.

W11 itself did NONE of the #4 work below. It confirmed the three gates green, removed
confirmed-dead scaffolding, wrote the docs, and wrote this note. The `server/game.ts`
dispatch switch and `selfWireJson` encoder are untouched by #3.

## What #3 delivered (the seam, now real)

- `IWorld` is split into 20 domain facet interfaces under `src/world_api/`, re-aggregated
  by `interface IWorld extends ...` in the `src/world_api.ts` barrel (empty body; the
  exported aggregate is byte-identical to the pre-split flat interface). The offline
  `Sim` (`src/sim/sim.ts`) satisfies it structurally; the online `ClientWorld`
  (`src/net/online.ts`) implements it.
- A shared, append-only wire-command vocabulary (`COMMAND_NAMES`, 106 tokens) plus the
  derived `CommandName` / `ClientCommand` types and the `DISPATCH_ONLY_COMMANDS` (7)
  allowlist, all in `src/world_api.ts`. Both `server/game.ts` and `src/net/online.ts`
  import this single table, so the send-subset-of-dispatch lockstep is a type-level
  `satisfies` check, not a regex scan.
- Four inline `Sim` bodies were extracted to facet-aligned modules behind `SimContext`
  (inventory/vendor, interaction, quests, the chat router); five cluster slices re-homed
  the already-thin delegates/accessors across the three client artifacts.

## What #4 INHERITS (read-only artifacts; consume, do not redefine)

| Artifact | Location | What it pins |
|---|---|---|
| `COMMAND_NAMES` (106) + `CommandName` + `ClientCommand` | `src/world_api.ts` | the canonical wire-command universe; append-only, never rename a token (the wire string IS the protocol) |
| `DISPATCH_ONLY_COMMANDS` (7) | `src/world_api.ts` | the server-only cases ClientWorld never sends: `dev_level`, `dev_teleport`, `dev_give`, `enter_crypt`, `leave_crypt`, `social_refresh`, `targetNearest` |
| `COMMAND_FACETS` (81 tagged) | `src/world_api.ts` | each wire command's owning facet (the discoverability map #4 reorders the switch by) |
| the 20 facet interfaces | `src/world_api/<facet>.ts` | the domain boundaries; aux types travel with their facet |
| `ALL_DELTA_KEYS` (25) + `TERSE_TO_IWORLD` | `tests/snapshots.test.ts` (W0a) | the `selfWireJson` (encode) to `applySnapshot` (decode) codec: the heavy self fields that ride only on change + their terse-key to IWorld-name mapping |
| `IWORLD_MEMBERS` (142; 36 data + 106 method) | `tests/world_api_parity.test.ts` (W0c) | every IWorld member present + same-kind on `Sim` + `ClientWorld`; aggregate == disjoint union of the 20 facets |

These five (the command table, the facet list, the delta-key registry, the member
contract, the dispatch-only allowlist) are the contract #4 builds on. They are pinned
append-only; a #4 change that drops or renames one reddens its gate by design.

## What #4 OWNS (the job #3 hands off)

The PHYSICAL `server/game.ts` restructure, made possible by the facet map above. As of
W11 the relevant landmarks are (line numbers current at hand-off, expect drift):

1. **Reorder the dispatch switch into facet sections.** `dispatchMessage` opens at
   `server/game.ts:1351`; the `switch (command)` is at `game.ts:1410` and carries the
   106 command cases. Group the cases by `COMMAND_FACETS` owner so the switch reads as a
   facet-by-facet table. (The separate chat sub-channel routing `switch` at
   `game.ts:2368` is NOT a command switch; leave it out of the command-set.)
2. **Extract per-facet command modules.** Lift each facet's case bodies into a module
   (the analog of the `src/sim` system-module split), keeping the field validation that
   `dispatchMessage` does before each `sim.*` call.
3. **Group / extract the `selfWireJson` encoder.** The encoder is `game.ts:2132`
   (the snapshot assembly that calls it is at `game.ts:2066`); it emits the 25
   `maybe(...)` delta keys pinned by `ALL_DELTA_KEYS`. Group its field writes by facet
   and/or extract a facet-aligned encoder, keeping every terse field name byte-identical
   to the `applySnapshot` decoder in `online.ts`.

## Invariants #4 must preserve (the gates enforce them)

- **Append-only `CommandName`.** Reordering the switch must not rename or drop a wire
  token. A new command lands in `COMMAND_NAMES` + `online.ts` + `game.ts` in one commit.
- **Wire co-location.** Any wire field/command change lands in `online.ts` AND `game.ts`
  in the same commit, field names byte-identical. Extracting the encoder must not split a
  field's encode/decode across modules in a way that drifts a name.
- **Delta-merge invariant.** The server omits unchanged heavy fields; `applySnapshot`
  keeps the prior mirror per field via `if (s.X !== undefined)`. Never default a missing
  field to empty. All 25 `ALL_DELTA_KEYS` stay covered.
- **Member parity.** `Sim` and `ClientWorld` each expose every IWorld member as the same
  kind; the aggregate member set equals the disjoint union of the 20 facets.

Run the three gates after any #4 step:
`npx vitest run tests/snapshots.test.ts tests/command_schema.test.ts tests/world_api_parity.test.ts`
plus `npx tsc --noEmit`.

## Out of scope (stays as-is unless #4 explicitly scopes it in)

The snapshot TRANSPORT machinery is not part of the switch/encoder restructure: the
20 Hz loop, interest-scoping, full/lite/keep diffing, `EntityWireCache`, the
`session.lastSent` delta bookkeeping, `resyncQuests` (`game.ts:2645`) / `resyncDelves`,
the session registry, persistence/autosave, admin, anti-bot, and the
`SocialService` / chat-policy service internals. The `friend_*` / `block_*` / `guild_*`
/ `chat` command NAMES are genuine IWorld methods (aligned by #3), but their server
handler bodies dispatch into #4 services; #3 did not refactor those internals.
