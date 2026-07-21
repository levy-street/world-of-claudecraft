# Delve System — Consolidated Handoff

**Single source of truth for delve status + remaining work.** Supersedes and
replaces the old `DELVE_CONTINUE_HANDOFF.md`, `DELVE_IMPLEMENTATION_HANDOFF.md`,
and `PLAYTEST_OFFLINE.md` (all deleted). Companion docs that remain:

- `docs/prd/delves.md` — canonical PRD (death / pet / daily rules are definitive).
- `docs/prd/DELVE_REBUILD_V0.8.md` — full plan to re-port delves onto upstream v0.8.0.
- `docs/prd/DELVE_LOCKPICK_MINIGAME.md` — "Tumbler's Path" engineering plan.

**Consolidation complete (2026-06-20):** Fernando combined both delve branches
(`feature/delves` + `feature/delves-v2`) onto `release/v0.10.0`, plus the v0.10.0
content pack, into a single branch: **`feature/delves-v0.10.0`** (head of PR #650 →
`release/v0.10.0`). That branch is now the **working base** — all new delve work
continues directly on it. The old two-branch porting guide (and §8 below) is kept
only as historical reference for *what was merged*; you do **not** need to re-port
anything.

Verified green on the consolidated branch (2026-06-20): `tsc --noEmit` clean,
`npm test` 2085 passing / 9 skipped (232 files), `npm run build` ok, and delve +
lockpick i18n is filled in all locales (0 pending delve rows) — the strings now live
in `i18n.en.ts` (`delveUi.*` / `lockpick*`) + every locale overlay, not the old
English-via-matcher shim.

Last updated: **2026-06-20**.

---

## 0. Status at a glance

| | |
|---|---|
| **`tsc --noEmit`** | ✅ green on `feature/delves-v0.10.0` (2026-06-20) |
| **Tests** | ✅ full suite green — 2085 passing / 9 skipped (232 files) |
| **Build** | ✅ `npm run build` ok |
| **Feature code** | ✅ functionally complete (engine, Collapsed Reliquary slice, companion, board UI, lockpick M0–M2 + partial M3) |
| **Brother Halven relocation** | ✅ code-complete & internally consistent — needs **in-world visual verification only** (§2) |
| **Big open blocker** | 🔵 Firefox black-screen — **deprioritized per operator** (Chromium renders correctly); revisit only if it recurs (§3.1) |
| **i18n** | ✅ delve + lockpick filled in all locales (0 pending delve rows) — was deferred, now done (§3.2) |
| **Next-phase roadmap** | 📋 §7 — entrance/Halven model, dungeon visuals+optimization, refactor, Delve Points + shop, Treasure Room, Bountiful Coffer, loot scaling |

---

## 1. What's done

- **Delve engine** in `src/sim/` — `DelveRun` lifecycle, `enterDelve`/`leaveDelve`/
  `advanceDelveModule`, module picker, objectives, death rules (1st = module entry
  @50% HP, 2nd = fail/eject), pet stow-restore, daily limits, marks.
- **Collapsed Reliquary vertical slice** — Brother Halven (board NPC), Acolyte
  Tessa (companion), Deacon Varric (finale boss), 4 modules, Normal/Heroic tiers,
  affixes, interactables (pressure plates, locked door).
- **Render** — KayKit interiors per module, delve-specific mob visuals
  (`render/characters/manifest.ts`), camera/ambience routing for the delve band.
- **Lockpick minigame** ("Tumbler's Path") — M0 pure core (`src/sim/lockpick.ts`,
  `lockpick_tiers.ts`, gen/step tests), M1 server-authoritative session, M2
  `IWorld.lockpick` seam in both worlds. **M3 client panel built but English-only.**
- **Two real latent-bug fixes** (independent of delves): asset-load promise cache
  now evicts on reject (`render/assets/loader.ts` + `render/dungeon.ts`) so a single
  transient GLB failure no longer poisons the whole session into a permanent black
  void. Regression harness: `scripts/delve_assetfail.mjs`.

---

## 2. Brother Halven relocation — the in-progress task (now code-complete)

The previous session was moving the NPC that opens the delve board from the chapel
door to a dedicated **Reliquary Hill** site. This is **done and internally
consistent across every reference** — it compiles and the relevant tests pass:

| Piece | File | Value |
|---|---|---|
| NPC spawn | `src/sim/content/delves/index.ts` | `pos: { x: -5, z: -52 }`, `facing: Math.PI` |
| Delve door | `src/sim/content/delves/collapsed_reliquary.ts:107` | `doorPos: { x: -5, z: -52 }` |
| Login-eject / leave / fail return | `src/sim/sim.ts:722, 7760, 7921` | uses `delve.doorPos` dynamically (z−4 = −56) |
| Map label | `src/sim/content/zone1.ts` | `{ x: -5, z: -52, label: 'Reliquary Hill' }` |
| Dressing | `src/sim/content/zone1.ts` | ruin ring `{-5,-60}`, graveyard `{4,-56}` |
| World marker prop | `src/sim/content/zone1.ts` + `src/render/props.ts` | `delveMarkers: [{ -5,-52, 'The Collapsed Reliquary' }]` → carved-stone name slab |
| Board open hook | `interactions.ts`, `main.ts` | keyed on `templateId === 'brother_halven'` (position-independent) |

**Remaining: visual playtest verification only** (no code expected):
1. Offline → walk/`/dev tp -5 -52` → confirm Halven **spawns and is interactable**
   at Reliquary Hill (board opens).
2. Confirm the **carved delve-marker slab renders** correctly at `-5,-52` (props.ts
   grime-streak fix from §5 applied).
3. Confirm `-5,-52` ground is **walkable/not water** and the ruin ring / graveyard
   dressing reads well; that `leaveDelve` drops the player back at `-5,-56` cleanly.
4. Update any screenshots/notes that still cite the **old** `-10,-8` coords.

---

## 3. Remaining issues (prioritized)

### 3.1 — Firefox black-screen — DEPRIORITIZED (operator, 2026-06-20)

> **Status (2026-06-20):** Operator decision — **not treated as a real blocker.**
> Chromium (the primary target) renders the delve path correctly. Do not gate delve
> development on this. The decision gate below was never run; revisit only if the
> symptom actually recurs in a supported browser. Original notes kept for reference:

Symptom: in **Firefox**, walking module 0's east wall + orbiting the camera goes
full black, nameplates pile at screen center — **with no asset-load errors** in the
console (only a harmless `/api/project-stats` 502 from running dev without a
server). Offline puppeteer (Chromium) shows the render path is **correct**. That
pattern points at a **Firefox/GPU/shader bug in the shared `DungeonInteriors`
path**, not delve architecture. ~6 camera/clamp attempts did **not** fix it.

**Next action = the hard gate in `DELVE_REBUILD_V0.8.md §1` (~15 min):** on a clean
v0.8.0 worktree, load a normal **overworld dungeon in Firefox**.
- **Black** → shared renderer/Firefox issue; rebuilding delves won't help. Capture
  `about:support` (GPU/ANGLE/driver), try Chrome, toggle HW accel. Fix the renderer
  or change browser/GPU.
- **Renders fine** → the 108-commits-newer renderer resolves it; the v0.8.0 rebuild
  (`DELVE_REBUILD_V0.8.md`) is worth doing — port sim-core-outward, **drop the
  camera churn**, carry the §5 asset fixes.

Record the gate result at the top of `DELVE_REBUILD_V0.8.md` before deciding.

### 3.2 — i18n (delve + lockpick) — RESOLVED (2026-06-20)

> **Status (2026-06-20):** Done in Fernando's consolidation. Delve + lockpick UI
> strings are now real `t()` keys in `i18n.en.ts` (`delveUi.*` / `lockpick*`) and
> filled in every locale overlay (verified: `i18n.status.json` shows **0 pending**
> delve/lockpick rows; `de_DE` carries 136 delve/lockpick entries). The old
> "English-via-matcher" shim described below was replaced. The S3 guard
> (`tests/localization_fixes.test.ts`) passes. Historical state kept for reference:

The CLAUDE.md invariant requires every player-visible string to be a real `t()`
translation in **all 14 locales** (`Object.keys(translations)`). Current state:
- Delve UI strings resolve **English-via-matcher** (`src/ui/delve_i18n.ts`), not
  real translations.
- Lockpick **M3 panel is English-only**.
- Mob debuff names are English literals with **no aura-name matcher entries**:
  `'Funeral Chime'` (aoePulse), and the two added this session — `'Ledger Rot'`
  (corrode), `'Grave Hex'` (mortalStrike). These follow the existing zone2/dungeons
  convention (`'Acid Spit'`, `'Mortal Strike'`) and don't trip any test, but they
  are still untranslated.

Why tests stay green today: the **S3 guard** (`tests/localization_fixes.test.ts`)
only scans `src/sim/sim.ts` emit sites, and the one deferred lockpick chest-loot
error is explicitly allowlisted (`ALLOW` in that test). A full delve+lockpick i18n
pass (keys in `en` first, then real translations in every locale, + `sim_i18n.ts`
matchers for any new sim-emitted English) is a **tracked follow-up before merge to
main**. See the i18n checklist that was in the old impl handoff — the `delveUi.*`
namespace inventory is reproduced in `delves.md` / `DELVE_LOCKPICK_MINIGAME.md §6`.

### 3.3 — P1: Lockpick minigame — remaining milestones

Per `DELVE_LOCKPICK_MINIGAME.md §9`: M0–M2 done. **M3 remaining** — final panel
art/juice, **all 14-locale strings**, a11y (keyboard nav, `prefers-reduced-motion`,
non-color cues for gates/seat), telemetry, tuning. Stretch: spectators, noise
meter. Art (locked-chest closed/open) via Meshy — `§10`. Treat lockpick polish as
**gated on the delve render being stable** (§3.1), since the chest lives on the
reliquary finale dais.

### 3.4 — P2: Open playtest findings (from prior offline runs)

- **Collision/floor z-misalignment** in modules — player/mob feet vs. floor plane.
- **Pressure-plate mesh** not yet drawn (mechanic works; visual missing).
- Design note: **cracked-grave object = Deacon Varric's Raise-Dead interrupt** —
  ensure it's wired/telegraphed in the finale.

### 3.5 — P2: Commit strategy + untracked-file triage

Everything is **uncommitted**. ~20 untracked files would be **lost if not
committed** — notably `src/sim/lockpick.ts`, `src/sim/content/delves/lockpick_tiers.ts`,
`src/ui/lockpick_panel.ts`, `src/ui/delve_map.ts`, `src/render/delve_chest.ts`, the
`tests/lockpick_*` + `tests/delve_chest`/`delve_map` suites, `scripts/lockpick_*` +
`delve_assetfail.mjs`, `public/models/dungeon/treasure_chest_open.glb`, and the
`DELVE_REBUILD_V0.8.md` / `DELVE_LOCKPICK_MINIGAME.md` docs.
- Decide: curate into feature commits on `feature/delves` **or** carry forward into
  the `feature/delves-v2` rebuild (§3.1).
- Triage untracked infra: `postgres/` and `docs/previews/` — commit or `.gitignore`?
- `.gitignore` already adds `scripts/generate_treasure_chest.mjs` (embeds a Meshy
  API key — **keep ignored**) and `.cursor/`. Note its sibling
  `scripts/assets/optimize_treasure_chest.mjs` is **not** ignored (no key) and is OK
  to commit.

---

## 4. Verification commands

```powershell
npx tsc --noEmit
npx vitest run tests/delves.test.ts tests/delve_render.test.ts tests/delve_colliders.test.ts `
  tests/delve_companion.test.ts tests/localization_fixes.test.ts `
  tests/lockpick_gen.test.ts tests/lockpick_step.test.ts tests/lockpick_command.test.ts
npm test
npm run build
node scripts/delve_assetfail.mjs   # asset-resilience regression (needs npm run dev)
```

Offline playtest: `npm run dev` only (no server) → **Play Offline** → `/dev level 7`
→ `/dev tp -5 -52` → interact Brother Halven → board → **Enter**. Console hooks live
on `window.__game` (`.sim`, `.world`, `.hud.openDelveBoard(id)`); leave a run with
`__game.sim.leaveDelve()`.

---

## 5. Changes made this session (transparency)

Fixed the 6 `tsc` errors the Brother-move batch introduced; tree is green:

- **`src/render/props.ts`** — the new delve-marker grime-streak code called
  `hash2(x, y)` with 2 args; `hash2` from `sim/rng` takes `(x, y, seed)`. Added a
  fixed seed (`0x6d61726b`) to all 4 calls (keeps it deterministic).
- **`src/sim/content/delves/mobs.ts`** — `corrode`/`mortalStrike` were missing the
  required `name`. Added `name: 'Ledger Rot'` and `name: 'Grave Hex'` (English
  literals, matching the existing `'Funeral Chime'` / zone2 / dungeons convention —
  see §3.2 for the i18n follow-up).
- **Also corrected a latent sign bug** in the same line: Ledger Wraith corrode was
  `armor: -6`. `effectiveArmor()` subtracts `value × stacks`, so a **negative** value
  *raised* the victim's armor (the opposite of corrosion). Changed to `armor: 6`,
  matching zone2's positive convention.

---

## 6. Coordinate / spatial cheat sheet

```
x ≤ 600        overworld
600–2799       dungeons (instanceOrigin 0–3 at 900/1500/2100/2700)
≥ 4000         arena (ARENA_X = 4200, ARENA_X_MIN = 4000)
≥ 4800         delves (DELVE_X_MIN); per-slot footprint. Delve side walls are at
               instance-local |x| = 25 (delve_layout WALL_X, wider than the crypt
               kit's 23); collider outer face at |x| = 26 → world-x 4774 (slot 0).
               west-edge classification guard: DELVE_BAND_X_MIN = 4773 (covers the
               full footprint incl. the west wall face, 1u margin past 4774)
               (relocated from 3600 in v0.10.0: the arena moved to x=4200)

Brother Halven / Reliquary Hill door: world (-5, -52); leave/eject return z = -56
delveOrigin(0,0) → x = 4800, z = -1250; module span 80, gap 20 (4 modules)
```

Key files: `src/sim/sim.ts` (delve lifecycle), `src/sim/data.ts`
(`delveOrigin`/`delveSlotAt`/`isDelvePos`), `src/sim/delve_layout.ts`,
`src/render/renderer.ts` (camera/ambience), `src/render/delve_interiors.ts`,
`src/ui/hud.ts` (board/tracker), `src/sim/lockpick.ts` (+ `src/ui/lockpick_panel.ts`).

---

## 7. Next-phase roadmap — visuals, economy & rewards (operator request, 2026-06-18)

> **Next agent: this section is your brief.** It is intentionally forward-looking
> work, not yet built. Numbers in §7.6–§7.7 are the operator's baseline — implement
> them as stated; only the bullets marked **CONFIRM** are open. Promote the
> finalized design into `delves.md` (the PRD) as you build each piece.

### 7.1 — Delve entrance + Brother Halven model (P1 visual)

**Problem (see operator screenshot):** the site at Reliquary Hill `(-5,-52)` reads
as an ordinary **graveyard** — the carved name-slab marker is too small/subtle and
there is no entrance the player can spot from a distance.

**A. Build a big, noticeable "dungeon door."**
- Use existing assets: `public/models/dungeon/arch.glb` + `wall_gated.glb` (gated
  archway) or `wall_arched.glb`. Place a **large arched stone doorway/portal** at
  the marker so it reads from far away: oversized scale, a **dark void / torch-lit
  opening**, optional fog plume, banners, rubble, broken pillars framing it.
- Today only a small slab is drawn — the `delveMarkers` loop in
  [`src/render/props.ts`](../../src/render/props.ts). Add a **`delveEntrances`**
  prop kind (or extend `delveMarkers`) that places the doorway GLB and reuses the
  name slab as its **lintel/sign**. New field on `ZonePropsDef`
  ([`src/sim/types.ts:383`](../../src/sim/types.ts)).

**B. Give Brother Halven a distinct, dark, "dirty" KayKit model.**
- He currently has **no `NPC_KEYS` entry**, so he renders as the generic
  `npc_villager` ([`render/characters/manifest.ts:565`](../../src/render/characters/manifest.ts)).
  Make him a different, characterful model — not a townsfolk reskin.
- **Asset source:** all in-repo characters are **KayKit "Adventurers"** (Kay
  Lousberg, CC0 — see CREDITS.md): `barbarian / druid / knight / mage / paladin /
  ranger / rogue / rogue_hooded`. The repo already vendors **EXTRA-tier** chars
  (e.g. `druid.glb`), so additional EXTRA-tier characters can be added the same way.
- **Operator reference image** (goggled dwarf w/ backpack) = the KayKit Adventurers
  **EXTRA-tier "Engineer"** character. Two routes, operator's pick:
  1. **Distinct model (matches the reference vibe):** drop the KayKit
     **Engineer** GLB into `public/models/chars/players/engineer.glb` (same pack
     as the existing `druid.glb`), add a `npc_reliquary_keeper` entry to `VISUALS`,
     map `NPC_KEYS['brother_halven'] = 'npc_reliquary_keeper'`, and **credit it in
     CREDITS.md**. Save the operator's screenshot to `docs/previews/` as
     `brother_halven_reference.jpg` for the dev.
  2. **Zero-new-asset dark route (fastest, fits "dark/scary"):** reuse the in-repo
     hooded silhouette — `NPC_KEYS['brother_halven'] = 'mob_dark_caster'` (the
     dark-robed caster already used by `gravecaller_cultist`) **or** a new visual
     off `rogue_hooded.glb`.
- **Either route, make him dirty/dark:** set the chosen visual `tint: 'entity'` and
  change `BROTHER_HALVEN.color` from `0xd4c5a0` (light tan) to a very dark
  charcoal/brown (e.g. `0x2b2620`) in
  [`src/sim/content/delves/index.ts:15`](../../src/sim/content/delves/index.ts).
- **Recommendation:** ship route 2 now for the dark mood; pursue route 1 (Engineer)
  if the operator wants the exact reference character. KayKit Adventurers is
  attribution-free but **still add a CREDITS.md line** to match repo convention.

### 7.2 — Delve interior visual + optimization pass (P1)

Grounded in [`src/render/dungeon.ts`](../../src/render/dungeon.ts) and
`src/render/CLAUDE.md`. Goal: better-looking **and** cheaper.

**Beauty**
- **Atmosphere:** localized fog + torch light-shafts; per-module color grading
  (cold ossuary → warm finale); dust motes via the pooled `vfx.ts` particle cloud.
- **Lighting:** a small budget of **flickering torch point-lights** (pooled, nearest-N
  only) with emissive flame quads; a focal spotlight on the finale dais.
- **Dressing:** moss/grime decals, cobwebs, scattered bones/rubble, broken pillars,
  candle clusters — reliquary theme; vary floor/wall textures so modules don't repeat.
- **Readability:** guarantee the clear-color/fog **never crush to black** when the
  camera nears a wall (this is also the §3.1 Firefox symptom — fix together).

**Optimization**
- **Instancing/merge audit:** every repeated piece (floor tiles, walls, pillars,
  torches) must go through `InstancedMesh` / merged batches per *(material × z-band)*;
  hunt for stragglers that allocate a mesh per piece.
- **Materials:** route everything through `surfaceMat()` so shader programs dedupe;
  no `new MeshStandardMaterial` per object.
- **Per-module show/hide:** we prebuild **all** modules; switch to showing only the
  current + adjacent module (AABB toggle) to cut draw calls; honor the `*_RANGE_SQ`
  distance culls.
- **Canvas textures:** the marker code allocates a `CanvasTexture` per marker — fine
  for a few; **cache/share** if entrances multiply.
- **Teardown:** `releaseGltf` interior assets on `leaveDelve` (pairs with the
  evict-on-reject cache fix already landed in `loader.ts`/`dungeon.ts`).

### 7.3 — Refactor & optimize (explicit next-agent directive)

Before piling on the §7.4–§7.7 features, **refactor and optimize** the delve code:
the delve sim logic is a large append to `sim.ts` (+547 lines) and the render path
grew organically. Tighten module boundaries, kill dead/duplicated code, and land the
§7.2 optimizations so the new economy/reward systems build on a clean base. Keep
`tsc` green and the test suites passing at every step.

### 7.4 — Delve currency (Marks) + Delve Shop

- **DECIDED: "Delve Points" ARE the existing delve `marks`.** Do not add a second
  currency — reuse the `marks` meta already on `PlayerMeta` (server-authoritative,
  persisted in `characters.state` JSONB, never an inventory item). Earn **1 mark
  (Normal) / 2 marks (Heroic)** per clear (§7.7). Use "Marks" as the user-facing
  name in UI/i18n (keep `marks` as the code identifier).
- **Delve Shop:** a vendor that spends **Marks** on gear / cosmetics / consumables,
  **discovered later in progression** (default gate: unlocks after the player's
  first delve clear; final location TBD by the next agent — near Halven or a
  dedicated hub). Surface balance + a purchase command through `IWorld` (both `Sim`
  and `ClientWorld`); all strings through `t()` in every locale.

### 7.5 — Treasure Room + Heavy Trunks (personal loot)

- **Every delve ends in a Treasure Room** (after the finale boss) containing **Heavy
  Trunks** that grant **personal loot** — gear **tuned to the looter's class and
  level**. Personal/instanced rolls (each party member gets their own; no ninja).
- Builds on the in-progress chest work: [`src/render/delve_chest.ts`](../../src/render/delve_chest.ts),
  `public/models/dungeon/treasure_chest_open.glb`, and `rollDelveChestLoot` (per
  `DELVE_LOCKPICK_MINIGAME.md` §2.1) — extend the loot tables to be class/level-tuned.

### 7.6 — Bountiful Delves + Bountiful Coffer (the ultra-rare path)

- A run can roll **Bountiful**, which adds a bonus **Bountiful Coffer** at the end
  containing **higher item-level gear**.
- **Roll chance (ultra-rare):** **Heroic = 5%**, **Normal = 2%**. Use `this.rng`
  (deterministic), rolled at run start.
- **DECIDED — gating REQUIRES "Hard Premium Cache" completion to OPEN.** The
  Bountiful Coffer **requires a Hard-tier + Premium-ante lockpick solve to open**
  (`DELVE_LOCKPICK_MINIGAME.md` ante/tier system) — not merely to roll. The roll
  decides whether a (locked) purple coffer appears; opening it is gated on the
  hard-premium solve.
- **DECIDED — UI must force Hard when the prize is purple; no easier options.**
  When the coffer is **purple** (Bountiful / ultra-rare), the lockpick ante selector
  must present **only the Hard (Premium) path** — do **not** offer the lower
  difficulty/ante options. A normal (gold) chest still shows the usual ante choices;
  a purple chest shows Hard-Premium only (plus the diegetic "this seal yields only
  to a master's hand" messaging). Enforce server-side too (reject non-hard-premium
  engage on a purple coffer), not just in the UI.
- **UI — super-rare = PURPLE, not yellow.** The Bountiful Coffer must use a
  **purple** tint/glow/UI accent (epic), *not* the usual gold/yellow chest, to
  signal ultra-rare. Touch `render/delve_chest.ts` + the chest UI in
  `lockpick_panel.ts` / `hud.ts`. Keep the normal Treasure-Room trunks (§7.5) gold.

### 7.7 — Loot item-level scaling

Looted chest gear scales on **two axes**:
1. **Bountiful or not.**
2. **Tier Level of the delve completed.** (Collapsed Reliquary = **Tier 1**.)

- **Marks per clear:** **1 (Normal), 2 (Heroic)** (§7.4).
- **Item-level caps:**
  - **Non-Bountiful delves cap at Tier 3.**
  - **Bountiful delves cap at Tier 8.**
- So reward item level climbs with the delve's tier, ceilinged by whether the run was
  Bountiful (Tier 3 vs Tier 8). "Tier" is a **delve-catalog dimension** — the
  Collapsed Reliquary is Tier 1; higher-tier delves (e.g. the Mirefen/Thornpeak
  bands sketched in `DELVE_LOCKPICK_MINIGAME.md`) come later.
- **To author (next agent):** the concrete tier→item-level curve between the caps.
  Follow the repo rule — derive it from the existing gear/XP progression tables, do
  **not** invent balance numbers (CLAUDE.md "real classic-era formulas"). Keep the
  endpoints fixed (Tier-1 entry ilvl → Tier-3 non-Bountiful ceiling → Tier-8
  Bountiful ceiling) and interpolate.

---

## 8. Combining the two branches — guide for Fernando

> **TL;DR:** `fork/feature/delves-v2` is the clean base (no camera churn). It's
> missing the Sim body + UI layers, which live in `fork/feature/delves`. Port
> those layers across (skipping the listed camera-churn commits), then rebase the
> whole thing onto `origin/release/v0.10.0`.

### 8.1 — Rebase onto v0.10.0 first

`fork/feature/delves-v2` is based on v0.9.0 (`63c7ca4d`). Before porting
additional layers, rebase it onto `origin/release/v0.10.0`. The files our
skeleton touched that also changed in v0.10.0 (108-commit content pack):

| File | v0.10.0 delta that intersects us |
|---|---|
| `src/sim/sim.ts` | +1065 lines of new mob abilities, rested XP, rare-elite logic. Our Sim class additions go **after** the existing `updateInstances()` region — check for merge conflicts there. |
| `src/sim/types.ts` | New `AuraKind` variants, new `MobTemplate` fields. Our `PlayerMeta` delve fields and `DelveRun`/`LockSession` types append cleanly; check for any new `Entity` fields that collide. |
| `src/world_api.ts` | v0.10.0 adds `restedXp: number` to `IWorld`. Our delve members are already in the file; just keep `restedXp` and add stubs to both `Sim` and `ClientWorld`. |
| `src/net/online.ts` | v0.10.0 adds `restedXp = 0` stub. Our `ClientWorld` delve stubs go in the same pass. |

Files **not changed** in v0.10.0 (apply cleanly): `src/sim/colliders.ts`,
`src/sim/dungeon_layout.ts`, `src/render/dungeon.ts`,
`src/render/assets/loader.ts`.

### 8.2 — Camera-churn commits to SKIP from `fork/feature/delves`

Do **not** cherry-pick these commits when porting from `fork/feature/delves`:

| Commit | Why to skip |
|---|---|
| `4d6b0471` | Camera clamp / chase-camera experiment |
| `7ef19368` | Delve camera/walkable-bounds alignment (broken approach) |
| `76499f2e` | Render: prebuild delve module interiors (camera-related side effect) |
| `a532674c` | Docs: delve continue handoff for render fix (references camera churn) |
| Camera-clamp parts of `5cdee1ca` | Only the `clampChaseCameraInModule` hunk; the rest of the commit is fine |
| Camera-clamp parts of `2a126df2` | Same — skip only the camera-clamp hunk |

In `src/render/renderer.ts`, **do not port** `clampChaseCameraInModule` or any
call to it. The correct camera behavior is the standard chase camera used by
dungeons — no per-module clamping needed.

### 8.3 — Remaining files to port from `fork/feature/delves`

These are present and working in `fork/feature/delves` but **absent** from
`fork/feature/delves-v2`:

**`src/sim/sim.ts` — Sim class body (the largest piece)**
Lines ~7575–9007 in `fork/feature/delves`. Methods to port:
- Constants block: `DELVE_PLATE_RADIUS`, `DELVE_INTERACT_RANGE`, `DELVE_BAD_AIR_INTERVAL`,
  `DELVE_RAISE_DEAD_CHANNEL`, `DELVE_COMPANION_HEAL_RANGE`, `DELVE_COMPANION_HEAL_INTERVAL`,
  `DELVE_COMPANION_FOLLOW`, `DELVE_EXIT_PORTAL_RADIUS`, `DELVE_MODULE_NAMES`
- `PlayerMeta` additional fields: `delveMarks`, `delveClears`, `companionUpgrades`,
  `delveLoreUnlocked`, `delveDaily`
- `CharacterState` optional delve fields
- `Sim` class: `delveRuns: DelveRun[] = []`, `private delvePetStash = new Map<number, PetState>()`
- Constructor: `delveRuns` initialization loop
- `addPlayer`: delve meta init and state restore from `charState`
- `serializeCharacter`: persist delve fields
- `tick()`: add `this.updateDelveRuns()` after `this.updateInstances()`
- `updateMob`: add `if (this.isDelveCompanionMob(mob)) { this.updateDelveCompanion(mob); return; }` before `updatePet`
- `releaseSpirit`: check delve run first, eject if in a run
- Movement: pass `delveModules` (4th arg from `this.delveRunForPlayer(pid)?.modules`) to all 3 `resolveMovement` calls
- All delve methods: `delveRunForPlayer`, `enterDelve`, `leaveDelve`, `claimDelveRun`,
  `spawnDelveModule`, `freeDelveRun`, `updateDelveRuns`, `advanceDelveModule`,
  `delveInteract`, `lockpickEngage`, `lockpickAction`, `lockpickTimeout`,
  `lockpickAbort`, `collectDelveChestLoot`, `companionUpgrade`, `delveMarksFor`,
  `isDelveCompanionMob`, `updateDelveCompanion`, IWorld method implementations for
  `enterDelve`/`leaveDelve`/`delveInteract`/`companionUpgrade`/`lockpickEngage`/
  `lockpickAction`/`lockpickAbort`/`lockpickTimeout`/`collectDelveChestLoot`,
  and getters `lockpickState`, `delveRun`, `companionState`, `delveMarks`,
  `companionUpgrades`, `delveDaily`

**`src/net/online.ts` — ClientWorld delve member stubs**
Add no-op / null stubs for all IWorld delve members (the client receives them via
server snapshot, not by computing them locally).

**`src/ui/hud.ts` — delve board, tier-select, run tracker, lockpick panel wiring**
~+188 lines in `fork/feature/delves`. Port the delve-board window, tier-select
modal, run-status tracker panel, and lockpick panel open/close hooks.

**`src/game/interactions.ts` — delveInteract wiring**
~+12 lines. The `interact()` handler needs to call `world.delveInteract(id)` for
objects inside the delve band.

**`index.html` + `src/main.ts` — entry wiring**
~+27 lines in index.html, ~+14 in main.ts. Lockpick panel and delve board are
registered as HUD windows here.

**`src/render/renderer.ts` — build interiors on delveEntered event**
Port the `onSimEvent('delveEntered', ...)` handler that calls
`buildDelveInteriors(run)`. **Do NOT port** `clampChaseCameraInModule` (§8.2).

**`src/render/props.ts` — delve marker grime using `hash2(x, y, seed)`**
The grime-streak code uses `hash2(x, y, 0x6d61726b)` — the 3-arg form with a
fixed seed. Already correct in `fork/feature/delves-v2`; just confirm it stayed
clean after the rebase.

**`server/game.ts` — server snapshot wire for `delveRun` / `companionState`**
The server snapshot serializer needs to include `delveRun` and `companionState`
in the per-player snapshot so `ClientWorld` can mirror them.

### 8.4 — Verification after the merge

```powershell
npx tsc --noEmit
npx vitest run tests/delves.test.ts tests/delve_colliders.test.ts \
  tests/delve_companion.test.ts tests/lockpick_gen.test.ts \
  tests/lockpick_step.test.ts tests/lockpick_command.test.ts \
  tests/localization_fixes.test.ts
npm test
npm run build
```

Then offline playtest: `npm run dev` → Play Offline → `/dev level 7` →
`/dev tp -5 -52` → interact Brother Halven → board → Enter. Confirm camera
does **not** go black (no `clampChaseCameraInModule` in the path).
