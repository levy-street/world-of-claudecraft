# IP Pivot Refactor — session briefs

Goal: strip every player-visible Blizzard / World of Warcraft IP name out of the game
(spell/ability names, talent + spec names, Blizzard-original creatures, a few item and
mob-mechanic names) and replace it with original vocabulary, **without changing any game
mechanic, save format, wire protocol, or RL action space.** This is a rename job, driven
by a legal IP-risk plan (Levy Street Group, `~/Downloads/World_of_ClaudeCraft_IP_Pivot_Plan.pdf`).
It follows the exact playbook of the completed sim (`refactor/sim`) and world-api
(`refactor/world-api`) refactors: one self-contained slice per session, a gate that pins the
contract before any work, green-only commits, parallel tracks merged by a single integrator.

Branch: `feature/ip-pivot` (forked off `release/v0.19.0`). Each file here is one self-contained
agent session you can paste into a fresh Fable 5 / Opus 4.8 xhigh session.

## What is different from the sim / world-api refactors (read this first)
Those refactors MOVED behavior between files and proved it with a golden trace / parity gate.
This one moves **no behavior at all** — it rewrites display strings. The prime directive is
therefore not "move not rewrite," it is:

> **RENAME DISPLAY, FREEZE IDS.** Change the player-visible `name` string; never change the
> code `id`. The gates prove the sim did not move an inch.

The load-bearing fact that makes this safe (established by an 8-agent audit of the v0.18.0
tree, saved in the maintainer's memory `ip-pivot-project`):

- Every class / ability / talent / mob / item carries a stable code **`id`** PLUS a display
  **`name`**. Player-visible text is resolved *by id* through the i18n indirection layer
  (`tEntity` in `src/ui/entity_i18n.ts`, `tTalent` in `src/ui/talent_i18n.ts`), never off the
  raw `.name`.
- Everything **persisted or transmitted keys off the id, never the display name**:
  `CharacterState` JSONB (`server/db.ts`) stores item ids, talent node ids, action-bar ability
  ids; the wire sends `{cmd:'cast', ability:<id>}` and mob `templateId`; talent build/export
  strings round-trip node ids; the RL action space is positional (`ability_1..N` slots in
  `src/sim/obs.ts`), name-agnostic.
- **Therefore a rename is display-only: edit the display string, leave the id frozen -> zero
  save / wire / RL migration.** Changing an id WOULD be a data migration and is NOT done here,
  with ONE deliberate, guarded exception (below).

Two consequences that shape every slice:
1. **Two English source layers, and which is authoritative differs by family.**
   - Mobs / NPCs / quests / zones / dungeons / delves: the SINGLE English source is the sim
     content record `.name`; `src/ui/world_entity_i18n.ts` re-derives the `en` slice from it.
     Edit ONLY the content record.
   - Abilities and items: the English is **duplicated** — in the sim record (`ABILITIES[id].name`
     in `classes.ts`, `ITEMS[id].name` in `items.ts`) AND in the i18n catalog
     (`src/ui/i18n.catalog/abilities.ts`, `.../items.ts`). Both copies must stay **byte-identical**;
     edit BOTH.
   - Talents: `src/ui/talent_i18n.ts` localizes the content `name`; a talent name must equal an
     ability name or carry an explicit per-locale title override (guarded).
   - Mob mechanic / aura names (e.g. a mob's on-hit `name:'Mortal Strike'`): the display string
     is matched by the `AURA_NAME_KEY` reverse map in `src/ui/sim_i18n.ts`; edit the inline
     `name` AND its matcher entry in the same slice (S3 guard).
2. **Every rename regenerates deterministic artifacts** (`npm run i18n:gen`, `npm run i18n:hash
   -- --write`, `npm run wiki:content`). These generated files are the ONLY thing two parallel
   slices can collide on, and the collision is resolved by **re-running the generators**, never a
   hand-merge (see `01-CONCURRENCY.md`).

## The one deliberate id change (the coined-id sweep)
The operator decision (locked below) is: **rename the Blizzard-COINED code ids, freeze all other
ids.** "Murloc," "Kobold" (as a `MobFamily`), and the warlock demon-pet ids (`voidwalker`,
`felhunter`, `felguard`, `doomguard`, ...) are Blizzard-coined tokens sitting in the public
open-source code. C1/C2 rename those ids atomically across the sim + render + content that key
off them. This is the ONLY place a parity golden may legitimately change, and only by the exact
token swap (the inspector verifies the golden delta is nothing but the renamed token). All
ability / talent / item ids stay frozen (renaming them would be a save-data + build-string
migration for no legal gain, since they are not player-visible).

## The gate (the "set in stone" layer) — built FIRST, in G0
The analog of the sim refactor's S0a and the world-api W0a/W0b/W0c. Two halves:
1. **Behavior-unchanged** (renames touch no sim state): the existing gates stay byte-identical.
   `tests/parity` goldens UNCHANGED; `tests/i18n_resolved_equivalence.test.ts` re-baselined via
   `i18n:hash --write`; `tests/guide.test.ts` fresh; `tests/localization_fixes.test.ts` (S3)
   green; `tests/architecture.test.ts` green; `npx tsc --noEmit` green.
2. **IP-gone** (the NEW artifact): a `tests/ip_scrub.test.ts` scanner that reads the resolved
   English tables + the sim content and FAILS if any name on a curated **verbatim-WoW denylist**
   (Heroic Strike, Frostbolt, Judgement, Mortal Strike, Voidwalker, Murloc, Bristleback, ...)
   appears in a player-visible field. G0 lands it RED (documenting today's violations as the
   baseline worklist); each track turns its slice's entries green; Z1 requires the whole scanner
   green with zero residual. This is the IP analog of the parity gate — it pins "these names are
   gone" so a later edit cannot silently reintroduce one.

## The contract every slice consumes — the NAME-MAP (built in G1)
`NAME-MAP.md` is the single, operator-approved source of truth for every old -> new string
(the analog of the world-api `CommandName` table). G1 generates the full proposed mapping and
**stops for operator sign-off**; no rename track runs until it is approved and frozen. Slices
apply it verbatim and never invent a name off-map. It is append-only once locked.

## Sizing — every slice fits well under 40% of the model window
The team rule is "<=40% context per session." No slice here exceeds ~30k tokens of working set;
the heaviest are V1 (abilities: `classes.ts` ~25k + the abilities catalog) and V2 (talents:
`talents_classic.ts` ~22k + `talent_i18n.ts`). The binding constraint is NOT context fit — it is
(a) applying the locked NAME-MAP exactly, and (b) the two-source byte-identical rule for
abilities/items. The one operational rule that keeps slices small: **section-scope reads; use ONE
Explore agent per slice** to fetch the exact current lines / ids / call sites for your domain
(never read `classes.ts` or `sim.ts` whole).

## Scope decisions (locked with the operator)
- **Classes and all mechanics stay identical.** The nine-class roster (Warrior, Mage, Rogue,
  Paladin, Hunter, Priest, Shaman, Warlock, Druid) is kept as-is. The lawyer flags the exact
  nine-class set as a residual "copied compilation" argument; the operator accepts that residual
  risk for now. Class DISPLAY names are OUT of scope this pass. Do not touch class ids or class
  `.name`.
- **The product name "World of ClaudeCraft" stays.** The brand rename (the lawyer's P0) is a
  separate business track, deferred by operator + counsel decision (easy to pivot later, and
  cleared with the lawyer). It is NOT in this refactor.
- **Ids frozen EXCEPT the coined-id sweep** (murloc/kobold `MobFamily` + warlock demon-pet ids;
  C1/C2). Every ability / talent / item id stays frozen.
- **"Realm" wording is optional and low-priority** (a common English word; lawyer rates it P2).
  T1 may swap the player-visible copy; the infra id (`RealmType`, `server/realm.ts`) stays.
- **HUD trade dress is out of scope.** The look-and-feel mirrors classic WoW but is fully
  procedural (no ripped assets, `CREDITS.md`); a visual redesign is a separate future track.
- **Creature GEOMETRY needs no redesign.** All creature models are generic external CC0/KayKit/
  Quaternius GLBs (murloc = a plain frog, kobold = a plain goblin). The "candle-headed kobold"
  and "fish-man murloc" exist only as FLAVOR TEXT, never as geometry. C1 scrubs the text; the
  models stay.
- **Patents: nothing to build.** None of the Blizzard Group-A patented mechanisms are on the
  build; this is a design-around policy note (see the plan PDF Section 4), not a slice.

## The IP surface (audited on v0.18.0, not estimated)
| Domain | Files | Count | Risk | Slice |
|---|---|---|---|---|
| Ability / spell names | `content/classes.ts` + `i18n.catalog/abilities.ts` | ~150 of 152 verbatim | copyright | V1 |
| Talent + spec/tree names | `content/talents_classic.ts` + `talent_i18n.ts` | ~330 of ~396; all 27 tree names | copyright | V2 |
| Blizzard-original creatures (murloc, kobold-candle, Bristleback, Drakonid, Mogger) | `types.ts`, `sim.ts`, `render/characters/manifest.ts`, `content/zone*.ts`, `dungeons.ts`, `temple.ts` | murloc family (7 mobs) + kobold flavor (5 mobs) + terms | blizzard-original / trade-dress | C1 |
| Warlock demon-pet roster | `content/warlock_pets.ts`, the `summonDemon` effect, `classes.ts` summon descriptions, `entity_i18n.ts` | 7-slot roster + ids | blizzard-original | C2 |
| Items / sets / augments | `content/items.ts`, `item_sets.ts`, `augments.ts`, `i18n.catalog/items.ts` | ~16 of 134 (Shadowmeld Tunic, Slimy Murloc Scale, Bristleback Maul, Lightwell, ...) | copyright | W1 |
| Mob mechanic / aura names | `content/dungeons.ts`, `zone2.ts`, `zone3.ts` + `sim_i18n.ts` matcher | ~4 verbatim (Mortal Strike, Devour Magic, Mind Blast, War Stomp) | copyright | W2 |
| De-brand text (comments, docs, README intent-to-copy, realm copy) | `README.md`, various comments, `realm.ts`, `main.ts` | ~3 files WoW refs + realm copy | narrative / cumulative | T1 |

**Confirmed clean (do not touch):** all zones, factions, quests, NPCs, and bosses are original
(Eastbrook Vale, Mirefen Marsh, Thornpeak Heights, Gravecallers, Wyrmcult, Nythraxis, Korzul the
Gravewyrm). The audit found ZERO verbatim WoW place / faction / quest / boss names.

## Session index (execution order: gate -> map -> tracks -> finale)
| # | ID | Title | Track | Mode | Working set | File |
|---|----|-------|-------|------|-------------|------|
| 1 | G0 | De-IP gate + verbatim-name scanner (`tests/ip_scrub.test.ts`), baseline RED | Spine | plain | ~14k | `G0-deip-gates.md` |
| 2 | G1 | Generate + operator-lock the full NAME-MAP | Spine | ULTRACODE | ~20k | `G1-name-map.md` |
| 3 | V1 | Ability / spell display rename (9 classes) | Vocab | plain (verify) | ~28k | `V1-abilities.md` |
| 4 | V2 | Talent + spec/tree display rename | Vocab | plain (verify) | ~26k | `V2-talents.md` |
| 5 | C1 | Blizzard-original creatures + coined family-id sweep | Creatures | ULTRACODE | ~22k | `C1-creatures-core.md` |
| 6 | C2 | Warlock demon-pet roster re-theme + pet-id sweep | Creatures | ULTRACODE | ~18k | `C2-warlock-pets.md` |
| 7 | W1 | Item / set / augment display rename | World | plain | ~16k | `W1-items.md` |
| 8 | W2 | Mob mechanic / aura name rename (+ S3 matcher) | World | plain (verify) | ~12k | `W2-mob-mechanic-names.md` |
| 9 | T1 | De-brand comments / docs / README + realm copy | Text | plain | ~10k | `T1-debrand-text.md` |
| 10 | Z1 | Integrate, regenerate artifacts, scanner-zero, release-locale-fill handoff, doc pass | Finale | plain | ~12k | `Z1-integrate-finale.md` |

Each implementation session has a paired QA session (`00-QA-TEMPLATE.md`).

## Track model (see `01-CONCURRENCY.md`)
- **Spine first, sequential, on `feature/ip-pivot`:** G0 -> G1. G0 pins the gate; G1 locks the
  NAME-MAP. No track forks until the NAME-MAP is operator-approved.
- **Then four tracks fork** (each its own worktree, internally sequential): **Vocab** (V1 -> V2),
  **Creatures** (C1 -> C2), **World** (W1 -> W2), **Text** (T1). They edit almost-disjoint SOURCE
  files (`classes.ts` vs `talents_classic.ts` vs `zone*/types/manifest` vs `items.ts` vs
  docs), so they parallelize; their ONLY shared conflict surface is the regenerated i18n / guide
  artifacts, reconciled by the integrator re-running the generators.
- **Finale Z1** runs last on `feature/ip-pivot` after all tracks merge back.

## Key cross-cutting dependencies
- **G1's NAME-MAP is THE contract.** Every rename slice applies it verbatim; it is append-only
  once the operator locks it. A slice that needs a name not on the map STOPS and asks (never
  invents one) so the map stays the single source.
- **V2 (talents) consumes V1's ability names** for the name-pairing constraint (a talent that
  mirrors an ability must use that ability's NEW name). Both read the frozen NAME-MAP, so they
  can still run in parallel — the map already encodes the paired names — but if V1 and V2 run
  sequentially, V2 confirms V1's applied names match the map.
- **The regenerated artifacts** (`src/ui/i18n.resolved.generated/*`, `src/ui/i18n.resolved.sha256`,
  `src/guide/content.generated.ts`) are deterministic from source: never hand-merge them; the
  integrator re-runs `i18n:gen` + `i18n:hash --write` + `wiki:content` after each merge.
- **The reword-staleness trap** (the single biggest gotcha): rewording an EXISTING English key
  does NOT flip its locale rows to `pending`, so all 20 non-English overlays keep rendering the
  OLD (WoW) name and both CI tiers still pass. This is a RELEASE-tier obligation, handed off in
  Z1: the maintainer reconciles by diffing `i18n.resolved.generated/en.ts` (merge-base vs HEAD)
  and re-filling every locale whose value did not also change. See `03-COMMIT-AND-VERIFY.md`.
- **S3 co-location:** any moved player-facing emit literal (W2 mob-mechanic names; C1 quest
  prose) updates its `src/ui/sim_i18n.ts` matcher in the SAME slice, then runs the S3 guard.

## The prime directive (in every brief)
**RENAME DISPLAY, FREEZE IDS.** Apply the locked NAME-MAP verbatim. For abilities/items edit BOTH
the sim `.name` and the catalog English byte-identical; for mobs/quests/zones edit only the sim
`.name`. Regenerate i18n + guide and commit the artifacts. Every existing `tests/parity` golden
stays byte-identical (a display rename changes no sim state) — the ONE exception is C1/C2's
coined-id sweep, where a golden may change by exactly the renamed token and nothing else. If a
golden shifts any other way, you changed behavior or an id: STOP.
