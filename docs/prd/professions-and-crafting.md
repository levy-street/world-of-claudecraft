# PRD — Professions & Crafting Framework

| | |
|---|---|
| **Status** | Draft / Proposed |
| **Owner** | TBD |
| **Created** | 2026-06-15 |
| **Source demand** | Internal roadmap: tradeskills are the next major content pillar after talents (v0.6). Fishing already has a cast-model stub in the sim. |
| **Related systems** | Items/loot (`src/sim/content/items.ts`, `src/sim/data.ts`), loot resolution (`src/sim/sim.ts` `rollLoot`), cast model (`src/sim/sim.ts` fishing path), persistence (`src/sim/sim.ts` `CharacterState`, `server/db.ts`), NPCs/trainers (`src/sim/types.ts` `NpcDef`, `talkToNpc`), command layer (`src/world_api.ts`, `server/game.ts`), HUD (`src/ui/hud.ts`), i18n (`src/ui/i18n.ts`) |
| **Companion docs** | `docs/prd/talents-and-specializations.md` (the subsystem-pattern precedent this feature follows) |
| **Scale** | Framework milestone delivered as **three PRs** (see §20). **PR 1 — this submission —** builds the bones of the profession system (skills, recipes, crafting, trainers, economy) and proves them end to end with cloth + First Aid. PR 2 (gathering) still adds one engine piece — the gather-cast path in `interact()` (specified here, not built in PR 1) — then is mostly content; PR 3 (production professions) is pure content on PR 1's craft rails. |

---

## 1. Summary

Build a general **profession framework** so WoW-Classic-style tradeskills can be added as data going forward, and prove it end to end with three concrete deliverables:

1. **Cloth drops** — humanoid mobs drop stackable cloth, the first crafting material, via a family-gated injection in `rollLoot`.
2. **First Aid** — a universal **secondary skill** every character can learn from a trainer: channel a bandage (reusing the fishing cast model), heal over time, and skill up on success.
3. **Crafting UI + engine** — a general recipe/craft system (consume reagents, channel a craft cast, produce an output, roll a skill-up) and the **professions window** that drives it.

The point is the **framework**, not just First Aid. We generalize from day one: a per-character `professionSkills` map (not a one-off `firstAidSkill`), a data-as-code `PROFESSIONS` + `RecipeDef` registry, a general cast-driven gather/craft action, and a general trainer interaction. First Aid is simply the first profession that rides these rails; cloth is the first material; bandages are the first recipes.

The engine already has clean hook points: items stack by default, `LootSlot.count` already loops, fishing is a working cast-with-cancel model, world nodes already respawn, and `CharacterState` is a JSONB blob that takes new optional fields with no migration. The dominant work is **(a)** wiring the general framework cleanly across all six layers (sim, persistence, IWorld, server, UI, i18n) and **(b)** getting the cast/cancel/skill-up loop right so future professions are pure content.

---

## 2. Background & motivation

### 2.1 Why now
Talents shipped in v0.6. Tradeskills are the next depth pillar: they give non-combat progression, a reason to gather and trade on the World Market (merged in v0.4), and a sink for mob drops that are currently vendor junk. Fishing already has a cast-model stub (`FISHING_CAST_ID`), which signals the intent was always there.

### 2.2 Why a framework first
We were asked to "wire up everything for people to make professions later." A one-off First Aid skill (`meta.firstAidSkill: number`) would ship faster but would have to be torn out and re-generalized the moment we add tailoring. Building the general `professionSkills` map, recipe registry, and cast-driven action **once** means every later profession is data plus a trainer NPC, not new engine code.

### 2.3 Classic fidelity (the invariant)
WoW Classic gating math is the reference. Professions cap at a skill level (Classic 1–300; we scale to our level-20 cap, see Open Questions). Recipe difficulty uses the orange/yellow/green coloring that controls skill-up chance. Gathering is a breakable cast bar, not an instant pickup. First Aid is a **secondary** skill: it does not consume a primary-profession slot and everyone can learn it.

---

## 3. How it works in WoW (the parts we adopt)

### 3.1 Skill levels, caps & skill-ups
- Each profession has a **skill level** raised by performing the action. **In our game the maximum skill is 100** (derived from level cap 20 × 5). In vanilla the cap is 300.
- **Difficulty color** drives skill-ups, relative to your current skill: **orange** (always grants a skill-up on a successful action), **yellow** (high chance, not guaranteed), **green** (low chance), **grey** (no skill-up). This is the core progression loop and stops players grinding trivial actions forever.
- Recipes/actions are gated by a **required skill**: you cannot make a Heavy Linen Bandage until First Aid reaches its threshold.

### 3.1a Tier training (Apprentice → Journeyman)
Raising your skill past a tier cap requires **learning the next tier from a trainer** (vanilla-style rank gating):

| Tier | Skill cap | Requirement to train | Vanilla analog |
|---|---|---|---|
| **Apprentice** | **50** | learnable from the start (character level 1) | Apprentice caps at 75 |
| **Journeyman** | **100** | **requires skill 40 AND character level 5** | Journeyman caps at 150, requires skill 50 |

The **character-level gate** (Journeyman needs level 5, not just skill 40) stops a player power-leveling a skill to cap at level 1; the skill ceiling rises roughly in step with the character. Per-tier gates live on `ProfessionTier` (`requiresSkill` + `requiresLevel`), so future tiers (or AA tiers) set their own.

> **Note (vanilla vs. ours):** In vanilla WoW each tier raises the cap in **increments of 75** (Apprentice 75 → Journeyman 150 → Expert 225 → Artisan 300) and the **next tier is gated at the previous cap minus ~25** (Journeyman requires 50 skill). We compress to a **100-skill ceiling in two tiers of 50**, and gate **Journeyman at skill 40** (the analog of vanilla's "requires 50"). The tier list above is the live design; the vanilla numbers are recorded only so the scaling intent is clear and a future cap raise can re-derive thresholds.

The "requires skill level 40" gate means a player must skill Apprentice up toward its 50 cap, then visit a trainer to learn Journeyman before they can climb to 100. Recipes gated above 50 (e.g. Heavy Linen Bandage) are therefore only usable once Journeyman is trained.

### 3.2 First Aid specifically
- Learned from a **First Aid trainer**, free, by anyone (secondary skill, no slot cost).
- Bandages are crafted from cloth, then **used by channeling** on a target (self or ally): a multi-second channel that heals over time and **breaks if the target takes damage or moves**.
- A **"Recently Bandaged"** debuff blocks re-bandaging the same target for ~60s (anti-spam).
- Skill rises on successful bandage crafting (and/or use), gated by the difficulty color.

### 3.3 Gathering (future professions, but framework supports now)
- Mining/herbalism nodes are world objects with a **required skill**; gathering is a **cast bar** (2–3s) that breaks on movement/damage; on completion you receive 1–N materials and roll a skill-up.

### 3.4 Crafting (general)
- A recipe consumes **reagents** (e.g. cloth), runs a **craft cast**, and produces an **output** item, then rolls a skill-up by difficulty color. Some crafts need proximity to a station (a cooking fire); most do not.

### 3.5 What we deliberately simplify (v1)
- No specialization sub-trades, no recipe discovery/drops, no profession-specific trade-skill quests, no enchanting "apply to item" flow. These are later content, the framework should not preclude them.

---

## 4. Current state in the codebase

> Anchors re-verified against `main` at v0.6 (2026-06-15). Line numbers drift, re-find the exact location before editing and trust the intent, not the number (house rule, see `docs/CLAUDE.md`).

| Concern | Location | Notes |
|---|---|---|
| Item data model | `src/sim/types.ts:85` (`ItemDef`), `kind` union at `:88` | `'weapon'|'armor'|'quest'|'junk'|'food'|'drink'|'tool'|'potion'`. **No `'reagent'`/`'material'` kind.** `ItemUse` has only `{ type: 'fishing' }`. |
| Item stacking | `src/sim/sim.ts` `addItem(itemId, count)` | all items stack by default, increments existing `InvSlot.count` or pushes new. No flag needed. |
| Loot entry shape | `src/sim/types.ts:121` (`LootEntry`/`LootSlot`) | `LootSlot` has `count`; `lootCorpse` already loops `for i<count` calling `addItem` per unit, so `count > 1` works today. `LootEntry` itself has no count, `rollLoot` pushes `count:1`. |
| Loot resolution | `src/sim/sim.ts` `rollLoot(mob, meta, eligible)` (~`:2819`) | three branches: rollGroup, questId, normal. **Cloth injection point: after the entry loop**, gate on `CLOTH_FAMILIES.includes(template.family)`, pick tier then roll drop-or-not then quantity/scrap. |
| Existing cloth item | `src/sim/content/items.ts:267` (`linen_scrap`) | `kind:'junk'`, already in several humanoid loot tables (mogger 100%, vale_bandit 50%, mudfin_murloc 20%, tunnel_rat 25%). Redesign into a stacking material. |
| **Cast model (the template)** | `src/sim/sim.ts` fishing path: `startFishing` (~`:3580`), `updateCasting` (~`:1521`), `FISHING_CAST_ID`/`FISHING_CAST_TIME` (`src/sim/types.ts:12`) | sets `castingAbility`, `castTotal`, `castRemaining`, `channeling=false`, emits `castStart`; completion dispatches by `castId`. **Reuse for bandage/craft/gather casts.** |
| Cast cancel | `src/sim/sim.ts` `cancelCast` on move (~`:952`), on damage during fishing cast (~`:2543`) | bandage channel and gather cast must cancel on the same triggers. |
| Aura HoT tick | `src/sim/sim.ts` `updateAuras` (`kind:'hot'`) | per-tick heal of `min(value, maxHp-hp)`; `tickInterval=2` mimics vanilla 2s ticks. **Template for the bandage HoT.** `breaksOnDamage` exists on `Aura` (`types.ts:54`). |
| World nodes (interactables) | `src/sim/types.ts:299` (`GroundObjectDef`), `pickUpObject` (~`:4007`), `interact()` dispatch (~`:4030`) | objects respawn after `OBJECT_RESPAWN` (~30s). Today single-item instant pickup. **Gather nodes extend this with a skill gate + cast + quantity.** |
| PlayerMeta (in-memory sheet) | `src/sim/sim.ts:226` | holds `inventory`, `equipment`, `xp`, `talents`, `loadouts`, etc. **Add `professionSkills`.** |
| CharacterState (persisted JSONB) | `src/sim/sim.ts:299` | optional fields backfill on load (talents pattern). **Add optional `professionSkills`, no migration.** |
| Serialize / reload | `src/sim/sim.ts` `serializeCharacter` (~`:635`), `addPlayer` reload (~`:569`) | talents fields show the additive-optional pattern exactly. |
| DB save | `server/db.ts` `saveCharacterState` (~`:322`) | single `UPDATE ... SET state=$3` on JSONB. No schema change. |
| NPC model | `src/sim/types.ts:248` (`NpcDef`), `talkToNpc` (sim) | `questIds[]`, `vendorItems?`, `market?`, `greeting`. **No trainer field.** `talkToNpc` only turns in / accepts quests, needs a trainer branch. |
| Gossip dialog | `src/ui/hud.ts` `renderGossip` (~`:1789`) | extensible `data-*` buttons (vendor, market). **Add a "Train" option.** |
| IWorld seam | `src/world_api.ts:157` | talents added ~12 methods/props here. **Add `professionSkills`, `learnProfession`, `craft`** (gather may route through existing `interact`). |
| ClientWorld | `src/net/online.ts` | mirrors `self` snapshot fields; commands via `cmd()`. **Mirror `professionSkills`, send `learnProfession`/`craft` commands.** |
| Server snapshot | `server/game.ts` self-snapshot (~`:1062`, `maybe('tal',...)`) | send `professionSkills` only on change (`maybe('skills', ...)`). |
| Server command dispatch | `server/game.ts` `switch(msg.cmd)` | add `case 'learnProfession'`, `case 'craft'`, validated server-side (range to trainer, owns reagents, meets skill). |
| HUD window pattern | `src/ui/hud.ts` talent panel (`toggleTalents`/`renderTalents`, ~`:2780`); mainmenu bar (`index.html:201`) | clone state locally, build `innerHTML`, wire listeners, `closeOtherWindows`. **Model the professions window on this.** |
| i18n | `src/ui/i18n.ts` | every locale `: typeof en`; add keys to `en` first, then all locales. **All profession strings via `t()`.** |
| Keybinds | `src/game/keybinds.ts` | char 'C', spellbook 'P', talents 'N'. **Add a key for professions (e.g. 'K').** |

**Gap:** no profession skills, no recipes, no crafting, no trainers, no skill-up loop. Cloth is vendor junk. Fishing has a cast-id constant but no skill or yield wired to a profession.

---

## 5. Goals & non-goals

### Goals
- A general per-character **`professionSkills: Record<string, number>`** persisted in `CharacterState` (JSONB, no migration).
- A data-as-code **`PROFESSIONS` registry + `RecipeDef`** schema in `src/sim/content/professions.ts`, validated at load.
- A general **cast-driven action** (craft / gather) reusing the fishing cast model, with cancel-on-move/damage and a completion handler.
- A general **skill-up loop** with orange/yellow/green difficulty coloring driving skill-up chance, gated by required skill.
- A general **trainer interaction**: `NpcDef.trains?`, a gossip "Train" option, a server-validated `learnProfession` command.
- **Deliverable 1 — Cloth drops:** humanoid family-gated, stackable material, feeds First Aid.
- **Deliverable 2 — First Aid:** universal secondary skill; learn from trainer; craft bandages from cloth; channel-to-heal HoT that breaks on damage/move; "Recently Bandaged" debuff; skill-ups.
- **Deliverable 3 — Crafting UI:** professions window (bound to a key) listing known professions, skill levels, known recipes with difficulty colors, and a craft button; skill-up FCT + sound.
- Server-authoritative throughout; client never grants skill, materials, or craft output.
- Performance: recipe/skill lookups are O(1) flat reads; no per-tick profession work.

### Non-goals (v1)
- No primary-profession slot limit enforcement yet (First Aid is secondary; slot rules land when primary professions do, see Open Questions).
- No specific primary professions shipped (mining/herbalism/tailoring/cooking) — the framework supports them, but only First Aid is authored here. Gathering-node mechanics are specified (§6.4, §16) but not built in PR 1; the gather-cast path lands with PR 2's first gathering profession (PR 1 stubs only the `gatherSkill` type field).
- No recipe discovery, recipe drops, or trainer recipe purchasing economy.
- No enchanting "apply to item", no profession quests, no specializations.
- No raising the level/skill cap design beyond mapping skill range to our cap.

---

## 6. Functional requirements

### 6.1 Profession skill state
- **FR-1.1** Add `professionSkills: Record<string, number>` to `PlayerMeta` (in-memory) and an optional mirror to `CharacterState` (persisted). Old saves load with `professionSkills` defaulting to `{}`.
- **FR-1.2** A profession is "known" when it has an entry in the map (value ≥ 1). Learning the profession (Apprentice) sets it to 1. **Skill range is `1..100`** (`PROFESSION_MAX = 100`, from level cap 20 × 5).
- **FR-1.3** Skill is granted only server-side via `skillUp()`; never accepted from the client.
- **FR-1.4 Tier caps.** A skill cannot rise past its **current learned tier's cap**: Apprentice caps at **50**, Journeyman at **100**. `skillUp()` clamps to the learned-tier cap, not `PROFESSION_MAX`, so a player stalls at 50 until they train Journeyman. Track the learned tier per profession (e.g. a parallel `professionTiers: Record<string, 'apprentice'|'journeyman'>`, or derive the cap from the highest tier the player has learned — decide in Phase 0).
- **FR-1.5 Tier gate.** Training **Journeyman requires skill level ≥ 40** in that profession (vanilla analog: requires 50). Constants: `APPRENTICE_CAP = 50`, `JOURNEYMAN_CAP = 100`, `JOURNEYMAN_REQ_SKILL = 40`.

### 6.2 Profession & recipe data model
- **FR-2.1** New `src/sim/content/professions.ts` (pure data, no engine imports, mirrors `talents.ts` discipline) exports a `PROFESSIONS` registry and `RecipeDef`/`ProfessionDef` types.
- **FR-2.2** Schema (illustrative):
  ```ts
  interface ProfessionDef {
    id: string;                 // 'first_aid', later 'tailoring' | 'mining' | ...
    name: string;
    kind: 'primary' | 'secondary';
    maxSkill: number;           // 100 for all v1 professions
    recipes: string[];          // recipe ids
    tiers: ProfessionTier[];    // ordered: apprentice, journeyman, ...
  }
  interface ProfessionTier {
    id: 'apprentice' | 'journeyman';  // extensible to expert/artisan if cap raises
    cap: number;                       // 50 (apprentice), 100 (journeyman)
    requiresSkill: number;             // 0 for apprentice, 40 for journeyman
  }
  interface RecipeDef {
    id: string;
    profId: string;
    name: string; icon: string;
    requiredSkill: number;      // min skill to craft (== the orange threshold)
    yellowAt: number; greenAt: number; greyAt: number;  // difficulty coloring (orange is implicit below yellowAt)
    reagents: { itemId: string; count: number }[];
    output: { itemId: string; count: number };
    castTime: number;           // seconds, cast-bar duration (smelt ~3s; some vanilla crafts ~10s)
    station?: string;           // e.g. 'forge' | 'cookfire'; omitted = craftable anywhere
    batch?: number;             // bulk variant (e.g. Mass Smelt = 5): multiplies reagents+output
                                // but still rolls only ONE skill-up — a throughput option, not a skill accelerator
  }
  ```
- **FR-2.3** Validated at load: recipe `profId` exists, reagents/outputs reference real `ITEMS`, `requiredSkill ≤ yellowAt ≤ greenAt ≤ greyAt`, no recipe gated above `maxSkill`.
- **FR-2.4** A recipe is craftable only when it is **both** in the character's `learnedRecipes` (taught by a trainer, see FR-10.2) **and** `professionSkills[profId] >= recipe.requiredSkill`. Skill alone does not unlock a recipe; the starter recipe is taught free on learning the profession.

### 6.3 Materials & cloth drops (Deliverable 1)
- **FR-3.1** Add an item `kind` for crafting materials (add `'reagent'` to the union; update any `kind`-gated checks in `useItem`/`autoEquip` — neither acts on the new kind).
- **FR-3.2** Redesign `linen_scrap` into a stacking material item (e.g. `linen_cloth`), keep a migration-safe alias if the old id is in live inventories.
- **FR-3.3** Cloth drops via a **family-gated injection in `rollLoot`** after the normal entry loop: if `CLOTH_FAMILIES.includes(template.family)` (humanoid/murloc/kobold), pick the level-band tier, then roll drop-or-not; on a hit push `{ itemId: cloth, count }`, on a miss roll the consolation scrap (FR-10.5). This adds a small fixed number of deterministic RNG draws per cloth-family kill (see FR-3.4) and avoids editing every mob template.
- **FR-3.4 Cloth tiers by mob level, with overlap.** Three cloth tiers drop banded by the **mob's level**, with intentional overlap bands so the transition is gradual (a mid-band mob can drop either neighbouring tier):
  | Cloth | Mob level band |
  |---|---|
  | `linen_cloth` | 1–8 |
  | `wool_cloth` | 7–15 |
  | `silk_cloth` | 14–20 |
  In an overlap band (levels 7–8 → linen **or** wool; levels 14–15 → wool **or** silk) the injection picks uniformly among the candidate tiers for that mob. Sequence per cloth-family kill: first one `rng.int` to **pick the tier** among candidates (skipped if only one), so cloth and its consolation scrap share a level band; then one `rng.chance` for **drop-or-not** (`CLOTH_DROP_CHANCE`, ~35%); then on a hit one `rng.int` for quantity, or on a miss one `rng.chance` for the scrap consolation (`SCRAP_DROP_CHANCE`, ~30%). A cloth-family mob still frequently drops no cloth at all.

### 6.4 General cast-driven action (craft / gather)
- **FR-4.1** Add a general craft cast: `craft(recipeId)` validates (known profession, meets `requiredSkill`, owns reagents, in range of `station` if any, not in combat-cancel state), then starts a cast (`castingAbility = 'craft:'+recipeId`, `castTotal/castRemaining = recipe.castTime`), emitting `castStart`. Reagents are reserved/consumed on **completion**, not on start.
- **FR-4.2** `updateCasting` dispatches craft-cast completion to `completeCraft`: re-validate reagents, consume them (× `batch` if set), `addItem(output × batch)`, then `rollSkillUp(profId, recipe)` **once** regardless of batch size (Mass Smelt yields 5 bars but a single skill-up roll).
- **FR-4.3** Craft cast cancels on movement and on damage, exactly like the fishing cast (reuse `cancelCast`); on cancel, no reagents are consumed.
- **FR-4.4** Gather framework (specified here, implemented in PR 2): a `GroundObjectDef` may carry `gatherSkill?: { profId; requiredSkill }` and a yield range. `interact()` on such a node starts a **gather cast** (cast-bar, classic-accurate) instead of instant `pickUpObject`; completion yields `rng.int(min,max)` items, rolls a skill-up, and starts the node's respawn timer. **PR 1 stubs only the `gatherSkill` type field** as a forward-compat marker; the `interact()` gather-cast path, `startGather`/`completeGather`, and node tests land with PR 2's first gathering profession, since PR 1 ships no gather nodes.

### 6.5 Skill-up loop
- **FR-5.1** `rollSkillUp(profId, recipe)` computes difficulty color from current skill vs the recipe's `orangeAt/yellowAt/greenAt`, then rolls skill-up chance by color (orange = 1.0 always, yellow ≈ 0.75 high, green ≈ 0.25 low, grey = 0 none). On success, increment `professionSkills[profId]` **clamped to the learned tier's cap** (50 Apprentice / 100 Journeyman, per FR-1.4), and emit a `skillUp` event. A player at their tier cap (e.g. 50, Journeyman not yet trained) gets no further skill-ups until they train the next tier.
- **FR-5.2** New `SimEvent` variant `{ type:'skillUp'; profId; newLevel }` drives FCT ("First Aid increased to 25") and a sound, mirroring the level-up toast path.
- **FR-5.3** Skill changes ride the snapshot as part of `professionSkills` (sent on change only).

### 6.6 First Aid (Deliverable 2)
- **FR-6.1** `ProfessionDef` `first_aid` (`kind:'secondary'`, `maxSkill:100`, tiers Apprentice/Journeyman), with bandage recipes consuming cloth, gated by `requiredSkill` and colored. Author at least one recipe **above 50** (e.g. Heavy Linen Bandage at `requiredSkill > 50`) so it is reachable only after training **Journeyman**, exercising the tier gate end to end.
- **FR-6.2** Bandages are items with `use: { type:'bandage'; recipeId? }`. `useItem` dispatches a bandage type to `startBandage(targetId)`: a channel (reuse fishing cast mechanics; `castingAbility='bandage'`) on self or a friendly target.
- **FR-6.3** On channel completion, apply an `Aura` `kind:'hot'` (`tickInterval=2`, per-tick `value`, total heal scaled by bandage tier). The HoT itself does **not** carry `breaksOnDamage`; the **channel** cancels if the target takes damage or either party moves (same triggers as fishing).
- **FR-6.4** Apply a **"Recently Bandaged"** debuff aura (new `AuraKind`, ~60s, no tick) to the target on completion; `startBandage` refuses if the target already has it.
- **FR-6.5** First Aid skill rises on successful bandage **craft** (the general craft loop); bandage **use** does not grant skill (matches classic). 

### 6.7 Trainers
- **FR-7.1** Add `trains?: string` (a `profId`) to `NpcDef`. Trainer NPCs may also carry `questIds`/`vendorItems` (coexisting like vendors do).
- **FR-7.2** `renderGossip` shows a "Train" option when `def.trains` is set; clicking sends `learnProfession`.
- **FR-7.3** `learnProfession(profId, tier)` is server-validated: player in range of an NPC whose `trains === profId`; for **Apprentice**, profession not already known → sets `professionSkills[profId] = 1` and learned-tier = apprentice; for **Journeyman**, profession known, journeyman not yet learned, and `professionSkills[profId] >= JOURNEYMAN_REQ_SKILL` (40) → raises the learned-tier cap to 100. Reject with a reason event otherwise (e.g. "Requires First Aid 40"). Emits an event on success. Place First Aid trainers (offering both tiers) in the hub towns.

### 6.8 UI (Deliverable 3)

> **UI direction — DECISION (2026-06-15).** Two approaches were considered:
> **(A) Modern tabbed window** — one professions window opened by a key, a tab per profession.
> **(B) Vanilla: profession-as-ability + a read-only Skills pane** — learning a profession grants a spellbook ability that opens *that profession's* craft window, and a separate `K` Skills pane lists all skills with level bars.
> **We chose (B).** Rationale: it is literally how vanilla works (Tailoring/Blacksmithing/Alchemy/Cooking/First Aid are all spellbook abilities that open their trade window), it matches the project's classic-fidelity bar, and it reuses existing machinery (`abilitiesKnownAt`, the spellbook, the action-bar slot system, the cast UI) instead of adding a bespoke tabbed panel. The craft window is one reusable component scoped by `professionId`. `K` is the vanilla Skills tab.

- **FR-8.1 Profession in the spellbook + Skills pane.** Each learned profession surfaces two ways: a **Professions section in the spellbook** (rendered from `professionSkills`; clicking a craftable profession opens its craft window) and the **`K` Skills pane** (read-only overview, Open button on craftable professions). Using a profession **opens its craft window** (it does not "cast"). Pure-gather skills with no craft (e.g. Fishing) list read-only (gather is in-world). *Future option:* grant a real draggable **profession ability** via the learned-abilities path (`abilitiesKnownAt`/`refreshKnownAbilities`) so First Aid can sit on the action bar and open the window from a hotkey, as in vanilla; PR 1 ships the spellbook-section + Skills-pane approach, which is simpler and reuses no ability-slot machinery.
- **FR-8.2 Craft window** (one reusable component, parameterized by `professionId`): lists the profession's **available** recipes (skill ≥ requiredSkill) with **difficulty-color** swatches (orange/yellow/green/grey), reagent requirements with have/need counts from inventory, and a **Craft** button (disabled when reagents are short). For Mining it also offers **Smelt** and **Mass Smelt**.
- **FR-8.3** Craft button calls `world.craft(recipeId)`; the channel shows via the existing cast-bar UI.
- **FR-8.4 `K` — Skills pane** (read-only overview; vanilla Skills tab). Lists every known skill **grouped by category**: **"Professions"** (`kind:'primary'`) and **"Secondary Skills"** (`kind:'secondary'`, e.g. First Aid). Each row is a **progress bar measured against the current tier cap**, i.e. `skill / tierCap(prof, learnedTier)` — so **50/50 Apprentice reads full**, and after training Journeyman the same skill reads **50/100 (half)**. Each row shows `current/cap` text and an **Open** button that opens that profession's craft window. Bound to `K` (vanilla's skills key; also used as the all-skills overview).
- **FR-8.5** `skillUp` events surface as FCT + sound; `professionLearned` shows a banner/log; recipe and skill tooltips via `attachTooltip()`.
- **FR-8.6** Trainer dialog: the gossip window shows a **Train** option when the NPC has `trains`, offering the next learnable tier (Apprentice, then Journeyman once skill ≥ 40); clicking sends `learnProfession`.
- **FR-8.7** **i18n:** every string (window titles, profession + recipe names/descriptions, category labels "Professions"/"Secondary Skills", difficulty labels, buttons, errors, skill-up + learned messages) registered in `en` first then every locale; rendered via `t()`.

### 6.9 Persistence & networking
- **FR-9.1** `professionSkills` (and the learned-tier state from FR-1.4, e.g. `professionTiers`) added to `CharacterState` (JSONB, no migration); serialized in `serializeCharacter`, reloaded in `addPlayer` with `{}` fallback. Old saves load with no professions known.
- **FR-9.2** New commands `learnProfession`, `craft` through `IWorld` → `cmd()` → `server/game.ts` switch → `Sim`. Gather routes through existing `interact`.
- **FR-9.3** Server sends `professionSkills`/`professionTiers`/`learnedRecipes` in the self-snapshot only when they change (`maybe('skills'|'profTiers'|'recipes', ...)`); `ClientWorld` mirrors them and re-renders the windows.

### 6.10 Learning costs & trainer-taught recipes
- **FR-10.1 Tier costs.** Learning a tier costs copper at the trainer, flat by kind. **Apprentice (the entry cost) stays cheap; Journeyman ramps hard:** secondary **50c / 1500c**, primary **150c / 4500c**. Rejected if the player can't afford it. (Distinct from talent respec, which is free — these are one-time, non-escalating sinks. Constants: `TIER_COST` in `professions.ts`. Calibrated against the live economy — median quest ~600c, vendor gear ~1500c.)
- **FR-10.2 Recipes are learned from a trainer**, not auto-unlocked by skill. A recipe must be in the character's `learnedRecipes` to craft it, even once the skill requirement is met. State: `learnedRecipes: Set<string>` on `PlayerMeta` / `string[]` on `CharacterState` (JSONB).
- **FR-10.3 Recipe cost** scales with the **square** of `requiredSkill` (start cheap, get expensive fast), the same across same-kind professions: `round(requiredSkill² × 0.3)` (secondary) / `× 0.6` (primary), min 5c. So a skill-25 recipe ≈ 188c (~2s) but a skill-80 ≈ 1920c (~19s). `learnRecipe(recipeId)` validates near-trainer + profession-known + skill-met + not-already-known + affordable, then deducts copper. The **starter recipe (skill ≤ 1) is auto-learned free** when the profession is learned, so it is usable immediately. Constant: `RECIPE_COST_K`.
- **FR-10.4 Trainer UI.** The gossip "Train" option opens a training view (in the gossip window) listing the next learnable tier and every recipe the player's skill now allows but hasn't learned, each with its copper cost and a Learn action. The craft window shows only **learned** recipes. A skill-up re-renders the trainer view so newly-eligible recipes appear.
- **FR-10.5 Cloth scrap consolation.** A cloth-band mob (humanoid/murloc/kobold) that fails its cloth roll has a chance (`SCRAP_DROP_CHANCE`) to drop the **scrap junk for its tier** instead (`linen_scrap`/`wool_scrap`/`silk_scrap`) — folded into the same `rollLoot` injection, replacing the old scattered per-mob `linen_scrap` entries.

---

## 7. Architecture & integration

```
LEARN (trainer)                CRAFT (recipe)                       GATHER (node, framework only)
  learnProfession(profId)        craft(recipeId)                      interact() → node has gatherSkill
        │                              │                                     │
        ▼                              ▼                                     ▼
  validate range+unknown        validate skill+reagents+range          validate skill
        │                              │                                     │
        ▼                              ▼                                     ▼
  skills[profId]=1              start craft cast (fishing model)       start gather cast
                                       │                                     │
                                  cancel on move/damage ◄────────────────────┘
                                       │
                                       ▼
                                 completeCraft: consume reagents → addItem(output) → rollSkillUp
                                       │
                                       ▼
                              skillUp event + professionSkills (snapshot on change)
                                       │
                                       ▼
                          ClientWorld mirror → professions window + char sheet + FCT
```

**Key principles**
- **One cast model.** Fishing already implements cast + cancel-on-move + cancel-on-damage + dispatch-on-complete. Bandage channel, craft cast, and gather cast all reuse it; the only difference is the completion handler keyed off `castingAbility`.
- **Reagents consumed on completion, never on start** — a cancelled/interrupted cast must cost nothing.
- **Profession content is pure data.** Adding tailoring = a `ProfessionDef` + recipes + a trainer NPC + cloth/material items. No new engine code.
- **Server-authoritative.** Skill, materials, and outputs are computed in `Sim`; the client displays derived state and sends only `craft`/`learnProfession` intents.

---

## 8. Performance requirements
- **PR-1** No per-tick profession work. Skill-ups and crafts are discrete events; the cast tick already exists.
- **PR-2** Recipe/profession lookups are O(1) flat-map reads from the `PROFESSIONS` registry; difficulty color is arithmetic.
- **PR-3** `professionSkills` sent only on change (never every snapshot); it is a small string→int map.
- **PR-4** Cloth injection adds a small fixed number of deterministic RNG draws per cloth-family kill (2–3: tier pick when multi-candidate, drop roll, then quantity or scrap); **no change to the RNG sequence for non-cloth-family mobs** (verified by `tests/professions.test.ts`).

---

## 9. Gameplay & balance design
- **Difficulty coloring is the progression spine.** Tune `orangeAt/yellowAt/greenAt` so a recipe stays a useful skill-up source for a sensible band, then goes grey, pushing players to the next recipe.
- **Cloth economy.** Cloth drop rate × bandage cloth cost should make First Aid leveling feel steady, not grindy. Cloth doubles as a World Market commodity.
- **First Aid value.** Bandages are a non-combat self-heal with a channel + cooldown debuff, deliberately weaker than potions in combat but free between fights and class-agnostic.
- **Skill cap mapping.** Decide whether we keep the classic 1–300 numbers (familiar) or scale to our level-20 cap (see Open Questions); coloring thresholds follow that choice.

---

## 10. Phasing

| Phase | Scope | Risk | Est. |
|---|---|---|---|
| **0 — Data model + state** | `professionSkills` + learned-tier state on `PlayerMeta`/`CharacterState` (+serialize/reload); `professions.ts` registry + `RecipeDef`/`ProfessionDef`/`ProfessionTier` types + load validation; cap/tier constants (`PROFESSION_MAX=100`, `APPRENTICE_CAP=50`, `JOURNEYMAN_CAP=100`, `JOURNEYMAN_REQ_SKILL=40`); `'reagent'` item kind; `skillUp` SimEvent | Low | S–M |
| **1 — Cloth drops** | Redesign `linen_scrap`→stacking cloth (+alias); family-gated injection in `rollLoot`; tests for determinism + quantity | Low | S |
| **2 — Craft engine + skill-up** | General `craft()` cast (reuse fishing model), `completeCraft` (consume→produce), `rollSkillUp` with difficulty coloring; IWorld/`cmd`/server `case 'craft'` | Medium | M |
| **3 — First Aid content + bandage channel + tiers** | First Aid `ProfessionDef` (2 tiers) + bandage recipes incl. one above skill 50; bandage `ItemUse` + `startBandage` channel + HoT aura + "Recently Bandaged" debuff; trainers (`NpcDef.trains`, gossip option, `learnProfession(profId, tier)`); Journeyman gate at skill 40 + tier-cap clamp | Medium | M |
| **4 — Professions UI** | Window bound to a key; profession/skill/recipe rendering with difficulty colors + have/need reagents; Craft button; skill-up FCT + sound; i18n; char-sheet surfacing | Medium | M–L |
| **5 — Gather framework (PR 2)** | `GroundObjectDef.gatherSkill`, gather-cast path in `interact`, yield + skill-up + respawn; unit-tested with a fixture node. **PR 1 stubs only the `gatherSkill` type field**; the rest lands with PR 2's first gathering profession. | Low–Med | S–M |

**Recommendation:** Phases 0→4 are PR 1 and deliver the full vertical (cloth → craft a bandage → channel it → skill up → see it in the window). Phase 5 (the gather rails) moves to PR 2, where it ships alongside the first gathering profession that needs it.

---

## 11. Testing strategy

### 11.1 Unit (`tests/professions.test.ts`, extend `tests/fixes.test.ts`)
- Registry validation: recipes reference real items, color thresholds ordered, no recipe above `maxSkill`.
- Cloth drops: humanoid kill yields cloth in expected quantity band; **determinism** — same seed+inputs ⇒ identical drops; non-humanoid RNG sequence unchanged.
- Craft loop: meets-skill gate; reagents consumed only on completion; cancel (move/damage) consumes nothing; output added; skill-up chance by color (orange always, grey never).
- First Aid: learn from trainer sets skill 1; bandage channel applies HoT; HoT heals per tick; channel cancels on damage/move; "Recently Bandaged" blocks re-bandage; bandage **craft** grants skill, **use** does not.
- Tiers: skill clamps at 50 without Journeyman; learning Journeyman is rejected below skill 40 and accepted at ≥ 40; after Journeyman, skill climbs to 100; a recipe with `requiredSkill > 50` is unusable until Journeyman is learned.
- Persistence: `professionSkills` round-trips through `serializeCharacter`/`addPlayer`; old save without the field loads as `{}`.
- Gather framework (PR 2): node with `gatherSkill` starts a cast; completion yields items + skill-up + respawn; skill gate rejects under-skilled gather. (PR 1 verifies only that the cloth injection leaves the non-cloth-family RNG sequence unchanged.)

### 11.2 Multiplayer correctness (ClientWorld path)
- `learnProfession`/`craft` validated server-side; client-claimed skill/materials rejected.
- `professionSkills` mirrors to `ClientWorld` via snapshot; window reflects server state.

### 11.3 Local manual
1. `ALLOW_DEV_COMMANDS=1`; kill humanoids → cloth stacks in bag.
2. Talk to a First Aid trainer → learn → professions window shows First Aid 1.
3. Craft a bandage → cast bar → bandage in bag → skill-up FCT.
4. Channel the bandage on self → HoT heals → take damage → channel breaks; re-bandage blocked by debuff.
5. Log out/in → professions + skill persist.

### 11.4 Performance
- Crowd of crafting players: confirm no per-tick regression vs baseline; snapshots don't bloat (skills sent on change only).

---

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Over-fitting the framework to First Aid | Generalize state (`professionSkills` map), recipe schema, and cast action from day one; keep the `RecipeDef` station/batch fields and the `gatherSkill` type stub as forward-compat seams. PR 2 building the gather path on these seams is the real generality test. |
| Reagent dupe/loss on cancelled craft | Consume reagents only in `completeCraft`, never on start; unit-test cancel paths |
| Cloth drop breaks RNG determinism | Inject after the loop with a fixed two-call sequence gated on humanoid family; determinism test |
| Bandage channel exploits (heal while taking damage) | Cancel channel on damage/move like fishing; "Recently Bandaged" debuff; HoT applied only on completion |
| Client trust | All skill/material/output computed in `Sim`; commands carry intent only |
| `linen_scrap` id churn breaks live inventories | Keep an alias mapping old id → new cloth on load |
| Snapshot bloat | Send `professionSkills` on change only |

---

## 13. Decisions & open questions

### Resolved in PR 1 (the design choices made here)
- **Skill cap & tiers:** cap **100** (level 20 × 5); **Apprentice** (cap 50) → **Journeyman** (cap 100), Journeyman gated at skill **40 and character level 5**. Vanilla's 75-increment scheme recorded in §3.1a for a future cap raise. (§3.1, §3.1a, §6.1)
- **Cloth tiers:** three tiers banded by mob level with overlap — linen 1–8, wool 7–15, silk 14–20 — dropped by humanoid/murloc/kobold families via one `rollLoot` injection; a failed cloth roll drops the tier's **scrap** (`linen_/wool_/silk_scrap`) instead. (§6.3, §6.10)
- **Primary-profession cap:** **2 primaries; secondary skills unlimited**, enforced at the trainer. Implemented (synthetic-tested until a primary profession ships). (§6.1)
- **Skill-up trigger:** First Aid skills up on bandage **craft**, not on use (classic-side). (§6.5)
- **"Recently Bandaged" timing:** applied at **cast start**, so interrupting the channel can't dodge the cooldown. (§6.6)
- **Recipe access:** recipes are **learned from the trainer**, not auto-unlocked by skill; the starter recipe is taught free on learning the profession. (§6.10)
- **Learning costs:** tiers **50/1500** (secondary) and **150/4500** (primary); recipe cost **round(skill² × 0.3)** secondary / **× 0.6** primary (min 5c). Apprentice stays cheap; Journeyman and recipes ramp hard (post-entry costs tripled from an earlier pass). Calibrated against the live economy. (§6.10, FR-10.1)
- **UI direction:** a **spellbook Professions section** opens the craft window; **`K`** opens a read-only Skills pane (grouped Professions / Secondary Skills, bars vs current tier cap). Draggable action-bar ability deferred (FR-8.1). (§6.8)
- **Bandage use-level gates:** require character level **1/3/6/8/10/12** by tier. (§17.1a)

### Open — for the owner / reviewers
1. **Economy goals & cost weight (the big one).** What role should professions play in the economy, and how expensive *should* learning be? PR 1's costs were tuned against the current numbers — median quest reward ~600c, vendor gear ~1500c, and **no repair/durability/death sinks exist** (the economy is income-rich, sink-poor) — landing full First Aid at ~7000c (~70s, ≈ a dozen quests, ~5–7% of a character's lifetime gold). But the *intended* weight is a design call we don't have a house answer for: should professions be a trivial convenience, a meaningful gold sink, or a major one? This directly drives `TIER_COST` / `RECIPE_COST_K`. **There is no economy design doc; this is genuinely open and we'd value the owner's direction.**
2. **Bandage heal values.** The six bandage heal totals (§17.1a) were derived from real data — average unequipped HP per class at each cloth band's level, then reduced ~⅓, and cross-checked against live healing spells — so they're *reasoned*, not arbitrary. But they're genuinely hard to lock without the owner's **current and long-term aims for player health and itemization**: how much HP a geared character is expected to have at each level now and as gear is added, and how strong out-of-combat healing should be relative to that. If HP pools or gear stats shift, these want a retune. Values live on each bandage item's `use.totalHeal` (pure tuning, no code change). **Open: what are the target HP curves and the intended power of bandages within them?**
3. **Drop-rate tuning.** Cloth drops at ~35% on cloth-family kills (scrap ~30% of the misses) — first-pass, wants playtest validation.
4. **Gather nodes are not in PR 1.** Cloth comes from mob drops only here; the gather-node framework lands with PR 2's gathering professions (see §19, §20).

(Part II / PRs 2–3 open questions — smelting, bag slots, station placement, node density — are in §21.)

---

## 14. Acceptance criteria
- A general `professionSkills` map persists per character with no DB migration and loads `{}` for old saves.
- A data-as-code `PROFESSIONS`/`RecipeDef` registry is validated at load; adding a profession requires no engine changes.
- Humanoid mobs drop stackable cloth deterministically; the RNG sequence for non-humanoids is unchanged.
- A general craft action consumes reagents only on completion, produces output, cancels cleanly on move/damage, and rolls skill-ups by orange/yellow/green difficulty.
- First Aid is learnable by any character from a trainer, bandages craft from cloth, the bandage channel heals over time and breaks on damage/move, and "Recently Bandaged" blocks spam.
- Skill caps at **100** (level 20 × 5); **Apprentice** caps skill at 50 and **Journeyman** (trainable only at skill ≥ 40) raises the cap to 100; `skillUp` clamps to the learned tier and a recipe above 50 is reachable only after Journeyman.
- The professions window renders known professions, skill levels, recipes with difficulty colors and have/need reagents, and crafts via a server-authoritative command; skill-ups show as FCT + sound.
- The gather framework (skill-gated cast, yield, skill-up, respawn) is **specified** for PR 2; PR 1 ships only the `gatherSkill` type stub on `GroundObjectDef` (no `interact()` gather path, no gather nodes).
- All profession logic is server-authoritative; new UI strings route through `t()` (`game.professions.*`); `npm run build && npm test` pass.

---

# Part II — Full profession roster (the one-shot build)

> §§1–14 specify the **framework** and its first proof (cloth, First Aid, crafting UI). Part II extends the **same rails** to the complete WoW-Classic profession tree. Nothing below adds new engine concepts: every primary profession is a `ProfessionDef` + recipes + materials + (for gatherers) world nodes + a trainer; every secondary skill is the same with `kind:'secondary'`. The two-tier cap model (Apprentice 50 / Journeyman 100, Journeyman gated at skill 40) applies uniformly.

## 15. The roster at a glance

| Profession | Kind | Source / gathering | Feeds | Nodes needed |
|---|---|---|---|---|
| **First Aid** | secondary | cloth (mob drops) | bandages (self-heal HoT) | — |
| **Cooking** | secondary | raw fish + raw meat | cooked food (well-fed buff) | — (optional cookfire station) |
| **Fishing** | secondary | fishable water | raw fish → Cooking | fishing pools (optional; open water works) |
| **Mining** | primary (gathering) | ore deposit nodes | ore → bars → Blacksmithing | **mine nodes** |
| **Herbalism** | primary (gathering) | herb nodes | herbs → Alchemy | **herb nodes** |
| **Skinning** | primary (gathering) | beast **corpses** | leather/hides → Leatherworking | — (skins corpses, no node) |
| **Blacksmithing** | primary (production) | bars (Mining) | metal armor + weapons | — (forge station, see §16.4) |
| **Leatherworking** | primary (production) | leather (Skinning) | leather/mail armor | — |
| **Tailoring** | primary (production) | cloth (mob drops) | cloth armor + bags | — |
| **Alchemy** | primary (production) | herbs (Herbalism) | potions + elixirs | — (optional alchemy bench) |

**Gathering → production pairings** mirror vanilla: Mining→Blacksmithing, Skinning→Leatherworking, Herbalism→Alchemy. **Tailoring** is the odd one out: its raw material (cloth) drops from humanoids rather than from a gathering profession, which is exactly why **cloth drops (Deliverable 1) is the foundation** and why First Aid + Tailoring can ship before any gathering node exists.

> **Primary slot rule:** vanilla limits a character to **2 primary professions**; secondary skills (First Aid, Cooking, Fishing) are unlimited. We build all professions as learnable content; the "pick 2 primary" cap is enforced at the **trainer** (`learnProfession` rejects a 3rd primary). See Open Question §13.2 — we **implement the cap** in this build (a `kind:'primary'` count check), since shipping all professions at once makes the limit meaningful immediately.

## 16. Primary professions

Each subsection lists the gathering mechanic (if any), the trainer, the material chain, and a representative recipe spread across the 1–100 range so the orange→yellow→green→grey loop and the Apprentice/Journeyman gate both get exercised. Exact numbers are tuning, not contract; the **shape** is the contract.

### 16.1 Mining (gathering) + smelting + ore nodes
- **Gathering (mining raw ore):** `interact()` on an **ore deposit node** (`GroundObjectDef` with `gatherSkill:{profId:'mining', requiredSkill}`) starts a **gather cast** (~2.5s, breaks on move/damage). On completion yields `rng.int(2,4)` **raw ore** + a skill-up roll, then the node enters its respawn timer (`OBJECT_RESPAWN`).
- **Smelting (raw ore → bars):** raw ore is **not** usable by Blacksmithing directly; it must be **smelted into bars at a forge**. Smelting is a Mining **craft** action and a skill-up source:
  - **Single smelt:** `1× raw ore → 1× bar`, **3s cast**, one skill-up roll. (Cast time is per-recipe; note some vanilla crafts run up to **10s** — `RecipeDef.castTime` carries this, smelt is a short one.)
  - **Mass Smelt:** `5× raw ore → 5× bars`, **6s cast**. A convenience/throughput option only — it rolls a **single** skill-up (same as one smelt, **not** five, and not a second cast), so it is strictly faster wall-clock but gives **less skill-up per ore**. Modeled as a distinct recipe flagged `batch: 5` (or a paired recipe id), gated to the same skill as the single smelt.
  - **Forge required:** both smelt recipes carry `station:'forge'`; the craft is rejected unless the player is within range of a **forge prop placed in the world** (see §19.4). Forges must be **added to the world** (hub towns + the zone-1 "Copper Dig" mine entrance at minimum).
- **Nodes to place:** seed copper deposits in the early zones; the zone-1 visual mine ("Copper Dig", `ZonePropsDef.mines`) gets a co-located gather node **and a forge**. Node positions live in the zone `*_OBJECTS` tables (data-as-code, same as quest objects).
- **Trainer:** Mining trainer in a hub town; offers Apprentice + Journeyman.
- **Material chain:** `copper_ore` (mined raw) → **smelt at forge** → `copper_bar` → Blacksmithing. (Later: `tin_ore` + `copper_bar` → `bronze_bar`.)

### 16.2 Herbalism (gathering) + herb nodes
- **Gathering:** identical pattern to mining — `interact()` on an **herb node** (`gatherSkill:{profId:'herbalism'}`) starts a gather cast, yields `rng.int(1,3)` herbs + skill-up, then respawns.
- **Nodes to place:** scatter peacebloom/silverleaf/earthroot nodes across early-zone biomes (use the zone `*_OBJECTS` tables; optionally bias placement by biome via `world.ts` later — v1 uses fixed positions).
- **Trainer:** Herbalism trainer; Apprentice + Journeyman.
- **Material chain:** `peacebloom`, `silverleaf`, `earthroot`, `mageroyal` (nodes) → Alchemy.

### 16.3 Skinning (gathering, corpse-based)
- **Mechanic (no node):** beasts already drop corpses. After a beast corpse exists, `interact()` on it (when Skinning is known and the corpse is **skinnable** and **not yet skinned**) starts a **skin cast** (~2s). On completion yields `rng.int(1,3)` leather + a skill-up, and marks the corpse `skinned`. Extends the existing corpse/loot interaction rather than adding a node type.
- **Skinnable flag:** mark beast-family mob templates `skinnable:true`; a skinned corpse sets a flag so it cannot be re-skinned; corpse despawn already exists.
- **Required skill scales with mob level** (vanilla: skinning a higher-level beast needs more skill) — a `skinReq` derived from mob level.
- **Trainer:** Skinning trainer; Apprentice + Journeyman.
- **Material chain:** `light_leather` (+ `ruined_hide` rare) → Leatherworking.

### 16.4 Blacksmithing (production)
- **Inputs:** **smelted bars** from Mining (`copper_bar`, later `bronze_bar` = copper+tin alloy) — **never raw ore**. A player must mine ore, smelt it at a forge, then smith the bars.
- **Station:** `forge` (and conceptually an anvil; we treat one `forge` station as both) — Blacksmithing recipes carry `station:'forge'` like smelting.
- **Outputs:** plate/mail armor pieces and simple weapons (dagger, axe) usable by appropriate classes. Recipes span 1–100 with the tier gate (heavier pieces require Journeyman).
- **Trainer:** Blacksmithing trainer; Apprentice + Journeyman.

### 16.5 Leatherworking (production)
- **Inputs:** leather from Skinning (`light_leather`), plus cloth as thread for some recipes.
- **Outputs:** leather + mail armor pieces, armor kits (a usable that adds armor to an item — **defer the "apply to item" flow**, ship the craftable items first).
- **Trainer:** Leatherworking trainer; Apprentice + Journeyman.

### 16.6 Tailoring (production)
- **Inputs:** cloth from mob drops (`linen_cloth`, later `wool_cloth`). **No gathering profession required** — this is why cloth drops are the keystone.
- **Outputs:** cloth armor pieces (caster gear), **bags** (a usable that grants extra inventory slots — see §18 note; if bag-slot expansion is out of scope for the inventory system, ship cloth armor + a vendorable bolt-of-cloth intermediate).
- **Trainer:** Tailoring trainer; Apprentice + Journeyman.

### 16.7 Alchemy (production)
- **Inputs:** herbs from Herbalism. Some recipes need an empty **vial/phial** (vendor-bought reagent).
- **Outputs:** potions (instant heal/mana, matching existing potion items) and **elixirs** (timed stat buffs — reuse the `Aura` buff path). **Station:** optional alchemy bench (or craftable anywhere in v1).
- **Trainer:** Alchemy trainer; Apprentice + Journeyman.

## 17. Secondary skills

All three are `kind:'secondary'`, learnable by everyone, do **not** consume a primary slot, and use the same two-tier cap model.

### 17.1 First Aid
Fully specified in §§6.6, 6.7 (Deliverable 2). Cloth → bandages → channel-to-heal HoT, then a 60s **Recently Bandaged** debuff blocks re-bandaging the same target.

### 17.1a First Aid tuning — HP reference & bandage heal values
Bandage heals are pegged to **average unequipped player HP at the level matching each cloth's mob band**, then **reduced ~1/3** so a bandage restores a solid chunk (~65% of an average bar, less for plate) rather than a full bar. Channel is the classic uniform **8s**; bandages stack to 20.

**Unequipped HP (base + stamina, `maxHp = baseHp + hpPerLevel·(L−1) + min(sta,20) + max(0,sta−20)·10`):**

| Level | Warrior | Paladin | Hunter | Shaman | Druid | Rogue | Warlock | Mage | Priest | avg |
|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 242 | 243 | 200 | 208 | 167 | 135 | 109 | 106 | 99 | ~167 |
| 8 | 356 | 354 | 305 | 313 | 266 | 210 | 166 | 154 | 135 | ~251 |
| 11 | 470 | 465 | 410 | 418 | 365 | 285 | 232 | 220 | 198 | ~340 |
| 14 | 584 | 576 | 515 | 523 | 464 | 360 | 298 | 286 | 261 | ~430 |
| 17 | 698 | 687 | 620 | 628 | 563 | 435 | 364 | 352 | 324 | ~519 |
| 20 | 812 | 798 | 725 | 733 | 662 | 510 | 430 | 418 | 387 | ~608 |

**Average normal-mob HP** climbs ~28 (lvl 1) → ~85 (lvl 5) → ~250 (lvl 10) → ~400 (lvl 15) → ~460 (lvl 19); elites/rares are ~2–3× higher and excluded.

**Bandage ladder (heal over 8s) and the heal-spell context at the band level:**

| Bandage | Cloth | req skill | req level (to use) | Heal | HPS | Single class heal @ band | ≈ heals' worth |
|---|---|---|---|---|---|---|---|
| Linen | linen | 1 | 1 | 105 | 13 | ~46 | 2.3× |
| Heavy Linen | linen ×2 | 25 | 3 | 175 | 22 | ~75 | 2.3× |
| Wool | wool | 50 | 6 | 240 | 30 | ~80 | 3.0× |
| Heavy Wool | wool ×2 | 60 | 8 | 305 | 38 | ~135 | 2.3× |
| Silk | silk | 70 | 10 | 385 | 48 | ~135 | 2.8× |
| Heavy Silk | silk ×2 | 80 | 12 | 480 | 60 | ~200 (Priest Heal R2 250) | 2.4× |

**Use-level requirements** (item `requiredLevel`, checked in `useItem`): a low-level character can't use a high-tier bandage even if they acquire one. Gated in-engine, surfaced on the item tooltip.

**Balance read:** a bandage ≈ 2–3 single heals' worth of HP over one 8s channel, no mana, out of combat, on a 60s per-target cooldown. A healer out-paces it on HPS (Priest Heal ≈ 80–100 HPS, combat-usable), so bandages stay the downtime/efficiency tool and never outclass live healing. Heal totals live on each bandage item's `use.totalHeal` in `items.ts` — pure tuning, no code change to retune.

### 17.2 Cooking
- **Inputs:** raw fish (Fishing) + raw meat (beast drops). **Output:** cooked food granting a short **"Well Fed"** buff (small stat/regen bump via an `Aura`) plus the existing food heal-over-time-while-sitting behavior.
- **Station:** a **cookfire** — either an existing campfire prop made interactable, or a cookfire the player can lay (defer the placeable-fire; v1 cooks near existing camp props by marking them `station:'cookfire'`).
- **Trainer:** Cooking trainer; Apprentice + Journeyman.
- **Note:** `raw_mirror_trout` and other raw food already exist; cooking turns raw → cooked via the general craft loop. This is the cleanest secondary to ship alongside Fishing.

### 17.3 Fishing (as a secondary skill)
- **Re-home the existing fishing cast** under the profession framework: `FISHING_CAST_ID` becomes a profession **gather cast**; completion yields a fish (weighted by zone/water) **and rolls a Fishing skill-up**, gated by the two-tier cap.
- **Mechanic:** cast into fishable water (existing `hasFishableWaterAhead`); **fishing pools** (higher-yield node entities on the water surface) are an optional enhancement — open water works for v1.
- **Trainer:** Fishing trainer; Apprentice + Journeyman.
- **Output:** raw fish → Cooking; some fish are quest/vendor items.

> **Other secondary-skill candidates (noted, not built):** **Enchanting** is secondary-like in feel but needs an "apply enchant to item" flow and a disenchant loop — deferred. **Riding/Lockpicking/Archaeology**-style skills are out of scope. Recording here so the registry's `kind:'secondary'` stays general enough to absorb them later.

## 18. Material & item catalog (v1)

New items added as data in `src/sim/content/items.ts` (kind `'reagent'` unless noted). This is the v1 set; tiers beyond the first are noted for forward-compat but only the first tier need ship.

| Category | Items (v1 first tier → later) | Source | Consumer |
|---|---|---|---|
| Cloth | `linen_cloth` (lvl 1–8) → `wool_cloth` (7–15) → `silk_cloth` (14–20); later `mageweave`/`runecloth` (20+, AA) | humanoid drops, level-banded | First Aid, Tailoring |
| Leather | `light_leather`, `ruined_hide` | Skinning corpses | Leatherworking |
| Ore / bars | `copper_ore`, `tin_ore` → `copper_bar`, `bronze_bar` | Mining nodes / smelting | Blacksmithing |
| Herbs | `peacebloom`, `silverleaf`, `earthroot`, `mageroyal` | Herb nodes | Alchemy |
| Fish (food, not reagent) | `raw_mirror_trout` (exists), `raw_bristle_whisker` | Fishing | Cooking |
| Meat (food/reagent) | `stringy_meat`, `chunk_of_boar_meat` | beast drops | Cooking |
| Crafted intermediates | `bolt_of_linen` (Tailoring), empty `crystal_vial` (vendor) | crafting / vendor | Tailoring / Alchemy |

**Bag note:** Tailoring bags require the inventory system to support extra slots. If the current fixed inventory has no slot-expansion hook, ship Tailoring's armor + bolt intermediates in v1 and file bag-slot expansion as a follow-up (do **not** silently drop bags — surface the limitation).

## 19. Gathering-node & corpse mechanics (engine additions)

These generalize §6.4's gather framework to cover all three gathering professions:

- **FR-19.1 Ore/herb nodes** are `GroundObjectDef` entries with `gatherSkill:{ profId, requiredSkill }` and a yield range `{ min, max }`. `interact()` routes a node with `gatherSkill` to `startGather` (cast bar) instead of instant `pickUpObject`; under-skilled players get a reason event ("Requires Mining 25"). Completion yields `rng.int(min,max)`, rolls a skill-up, and starts the respawn timer.
- **FR-19.2 Skinning** extends corpse interaction: beast templates carry `skinnable:true` and a level-derived `skinReq`. `interact()` on an un-skinned beast corpse (Skinning known, skill ≥ `skinReq`) starts `startSkin` (cast); completion yields leather, rolls a skill-up, marks the corpse `skinned`.
- **FR-19.3 Node render:** resource-node entities (kind `'object'`, templateId prefix `node_`) get a sparkle/glow in the renderer so they read as gatherable (extend `src/render/props.ts` or a small `nodes` helper). Skinnable corpses get a subtle skin-prompt affordance in the interact tooltip.
- **FR-19.4 Stations** (`forge`, `cookfire`, optional `alch_bench`) are world props flagged interactable; a craft whose recipe has a `station` validates the player is within range of a matching station prop, else a reason event. v1 may co-locate stations with existing camp/town props.

## 20. Rollout plan — three PRs

The roster ships as **three PRs**, each leaving `npm run build && npm test` green and independently reviewable and mergeable. **PR 1 is this submission.** PRs 2 and 3 are scoped below but **not yet built** — they depend on PR 1's framework merging first, and are then largely content authoring on its rails.

### PR 1 — Foundation: framework + cloth + First Aid + crafting & economy  ← **this PR**
Shipped and green (`npm run build && npm test`): `professionSkills` + `professionTiers` + `learnedRecipes` state + persistence; `professions.ts` registry (`RecipeDef`/`ProfessionDef`/`ProfessionTier`) + load validation + cost/tier constants; `'reagent'` item kind, `stackSize`, `requiredLevel`; `skillUp`/`professionLearned`/`recipeLearned` events; level-banded cloth drops + tiered scrap consolation in `rollLoot`; general `craft()` cast → `completeCraft` → `rollSkillUp` with difficulty coloring; First Aid content (2 tiers, six-bandage ladder) + bandage channel HoT + "Recently Bandaged" at cast start; trainers (`NpcDef.trains`, gossip "Train" view, `learnProfession(profId, tier)` + `learnRecipe(recipeId)` with primary-slot/Journeyman/level/cost gates); **trainer-taught recipes + learning costs** (§6.10); bandage tooltips; IWorld/`cmd`/server dispatch + delta snapshot; **UI per §6.8 (B)** — a spellbook Professions section opens the craft window, plus the `K` Skills pane (see FR-8.1). **Tests:** `tests/professions.test.ts` (registry, cloth banding/determinism, craft + skill-up loop, tiers, costs + recipe learning, First Aid bandage + debuff + interrupt, persistence, primary-slot cap) + snapshot/keybind coverage.

### PR 2 — Gathering + secondary skills (Mining, Herbalism, Skinning, Fishing, Cooking) + nodes
Generalize the gather framework (§19): ore/herb `GroundObjectDef` nodes + `startGather` cast + node render sparkle; corpse `startSkin` for Skinning (`skinnable`/`skinReq`); re-home Fishing under the framework (skill-up + tiers); Cooking (raw→cooked via the craft loop, `cookfire` station, "Well Fed" buff). Add gathering/secondary `ProfessionDef`s + trainers + node placements in zone `*_OBJECTS` + material items (ore/herbs/leather/meat). Smelting (Mining craft at a `forge`, incl. Mass Smelt). **Tests:** node gather gate + yield + respawn, skinning gate, fishing skill-up, cooking transform, station range.

### PR 3 — Production professions + content (Blacksmithing, Leatherworking, Tailoring, Alchemy)
Author the four production `ProfessionDef`s + recipe spreads across 1–100 with tier gates; their trainers; crafted output items (armor/weapons/potions/elixirs reusing existing equip + `Aura` buff paths); `forge`/`alch_bench` stations; bolt-of-cloth/vial intermediates. Full i18n pass for every new string. **Tests:** production recipe gating + output equip/use, station-required rejection, end-to-end chains (ore→bar→armor; herb→potion; cloth→bandage & cloth→armor; skin→leather→armor; fish→cook).

> **Why three PRs, not one:** each is independently shippable and reviewable — PR 1 stands alone and is playable (First Aid + cloth + crafting + economy), PR 2 adds the gather economy, PR 3 spends it. Splitting keeps each review tractable and the tree always green, and lets the owner approve the framework before the content fan-out. PRs 2–3 are intentionally deferred until PR 1 lands.

## 21. Open questions (Part II)

1. **Smelting model:** is smelting a Mining recipe at a forge (this plan), or instant on gather? (Plan: forge recipe — it is a skill-up source and matches vanilla.)
2. **Bag slots:** does the inventory system support slot expansion for Tailoring bags, or do we defer bags? (See §18 note — surface, don't drop.)
3. **Elixir/potion buffs:** reuse the existing `Aura` buff path for elixirs — confirm no new buff-stacking rules needed.
4. **Node density & respawn:** how many nodes per zone and what respawn interval keeps gathering paced without overcrowding the world? (Tuning; start sparse.)
5. **Cookfire/forge placement:** co-locate stations with existing town/camp props (v1), or add placeable cookfires later?
6. **Class/skill recipe restrictions:** do crafted weapons/armor respect class equip rules (yes — reuse existing equip gating), and do any recipes require a class? (v1: no class-locked recipes.)

## 22. Future — higher cloth tiers & Alternate Advancement (AA)

World of Claudecraft is settling on a **level-20 cap**, so the cloth tiers (linen/wool/silk) cover the full 1–20 humanoid range today and silk caps at level 20. A separate **Alternate Advancement (AA)** system is proposed for post-cap character growth (the spiritual successor to "what do you do at max level"): rather than raising the level cap, AA adds horizontal progression and, with it, **higher-level content and mobs above level 20**.

When AA lands and level-20+ humanoids exist, the cloth ladder extends upward — they should drop **higher cloth**, not silk:

- **Mageweave** then **Runecloth** (the vanilla post-silk tiers), or a single **Runecloth** tier if we want fewer steps.
- Implementation is purely additive: append band rows to `CLOTH_BANDS` in `src/sim/content/professions.ts` (e.g. `{ itemId:'mageweave', min:20, max:24 }`, `{ itemId:'runecloth', min:24, max:99 }`), add the items, and extend the First Aid / Tailoring recipe ladders. The overlap mechanic and the level-banded selection already handle the new bands with no engine change — silk's `max:20` is the only value to revisit (lower it so the new bands take over), and the top band should be open-ended so AA mobs never fall through.
- **Dependency:** this tier only ships **with** the AA proposal (it has no source mobs until then). Tracked here so the cloth system is built to absorb it. AA itself is out of scope for this PRD and needs its own design doc.
