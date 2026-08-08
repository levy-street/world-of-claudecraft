# Farming: cross-phase state (the cheat sheet)

Read this file first in every phase session. It is the single authority for locked
decisions. If a phase file contradicts this file, this file wins and the phase file
gets swept in the same pass (amend the QA twin too, always).

Current phase: none started. Packet authored 2026-08-07 off release/v0.36.0.
Working tree: ALL farming work happens in the persistent worktree
`~/Documents/woc-farming-plan`. Other sessions share the main checkout; never work there.

## Locked design decisions

The fun thesis, stated once: farming is the check-in skill. It converts logins into
progress, holds the player's state in the world, and NEVER punishes absence. Anti-chore
is load-bearing: no daily resets, no wither or decay, nothing rots, a late harvest costs
only opportunity. Two visits per crop cycle, ever. Any phase that adds a third required
visit or a punishment for lateness is violating the design, not tuning it.

- D1: Farming is the FIFTH gathering profession. `'farming'` appends LAST to the
  `GatheringProfessionId` union, `GATHERING_PROFESSIONS` (with `maxSkill: 100`), and
  `GATHERING_PROFESSION_IDS` (append-last preserves iteration order for every consumer,
  the fishing precedent). Skill tiers gate at 0/25/50/75 (the shared 25-point band math
  in `src/sim/professions/proficiency_bands.ts`). It is NOT an eleventh craft: never
  touch `CRAFT_RING`.
- D2: Fishing-shaped integration, NOT node-shaped. There is NO new `GatherNodeType` and
  nothing joins `GATHER_NODES`. Patches are their own content table `FARM_PATCHES`
  (planned: `src/sim/content/farm_patches.ts`) with their own pure-leaf zone side table
  (planned: `src/sim/professions/farming_zones.ts`, the `fishing_zones.ts` template:
  `Object.hasOwn` reader, explicit row per zone, derived not independent knobs).
  Rationale, verified: a new `GatherNodeType` is conscripted by
  `tests/professions_zone_rollout.test.ts` (R37) and `tests/gather_node_placement.test.ts`
  into every zone at exact pinned counts. Farming instead adds its OWN rollout arms
  keyed to an explicit set: `FARMING_ZONES = eastbrook_vale (tier 1), mirefen_marsh
  (tier 2), thornpeak_heights (tier 3), evergarden (tier 4)`, plus its OWN placement
  guard suite cloning the physical-safety arms (dry land, no collider overlap, reachable
  stand spot, zone containment, spacing) for `FARM_PATCHES`. Hub anchors for patch
  sites and farmer NPCs: eastbrook_vale at Eastbrook, mirefen_marsh at Fenbridge,
  thornpeak_heights at Highwatch, and evergarden at the formal parterre grounds (the
  Evergarden has no named hub; the parterre is the anchor). Phase files may use these
  hub names; this mapping is the anchor.
- D3: Growth is wall-clock and offline-friendly. Stage deadlines are epoch-ms values
  evaluated against `ctx.lockoutNowMs()` (the `raidLockouts` idiom, the ONE sanctioned
  wall-clock seam; server injects the realm clock, the offline browser host degrades to
  session-local growth, consistent with the documented offline-taster ruling). Plot
  state is per player: `PlayerMeta.farmPlots` (a `Map`, so an empty one canonicalizes
  cleanly in the parity sampler) persisted as an OPTIONAL `CharacterState` field with
  defaults, normalized on load. Patches are shared world fixtures; each player grows
  their own crops in them (the per-viewer node-readiness precedent). No world
  persistence, no housing, no land scarcity. The public plot projection (the facet
  read and the fplot wire key) exposes ONLY: bed id, crop id, planted-at, ready-at,
  the applied knob flags, the Phase 8 notified flag, and a server-derived status
  (growing, ready, withered; withered surfaces only at or after ready time). The
  pre-rolled outcomes and the yield seed never leave the server.
- D4: Determinism contract. ALL randomness draws at player-action moments through
  `ctx.rng`. At plant time the full growth script is pre-rolled (per-stage survival
  outcomes and the yield seed), the fishing hidden-bite-delay template scaled up. ZERO
  draws at timer expiry, in the tick sweep, or at login. Farming states its draw-count
  contract (N draws per plant, M per harvest, 0 on denial) and pins it, and ships a
  parity scenario that drives a real plant-grow-harvest session in the same phase as the
  growth engine (fishing's documented scenario gap is not inherited).
- D5: Pacing (tuning constants live in content, maintainer-adjustable): tier 1 crops
  30 to 60 min, tier 2 about 2 h, tier 3 about 4 h, tier 4 overnight. Growth continues
  while logged out.
- D6: Survival. Planting requires farming skill at or above the crop tier threshold.
  One full band above the threshold survival is 100 percent, always (out-leveling a crop
  permanently retires its risk). Inside the band, base survival ramps from roughly 85
  percent at the gate to 100 percent at the band top, scaling with skill. Compost adds
  10 points, farmer's watch adds 10 points, capped at 100. A failed crop yields withered
  husks (a real item with a real consumer, the wolf_fang rule): failure composts into
  the next attempt's insurance.
- D7: Yield, the harvest-lives model (OSRS reference, our own constants): a plot starts
  with a guaranteed floor of picks (base 3); each pick rolls a skill-scaled chance to
  not consume a life. Growth tonic (crafted by alchemy FROM HERBS, the cross-profession
  trade) adds a chance of bonus picks at harvest. One knob one job: compost is survival,
  farmer's watch is survival, tonic is yield, skill improves both.
- D8: Front-loaded only. Every choice (seed, compost, watch, tonic) happens at plant
  time. There is no mid-growth interaction of any kind, required or optional.
- D9: Farmer's watch is paid in kind: any farming produce of the patch's tier or
  below, consumed from bags as a plant-time knob (no NPC range gate: paying is
  front-loaded at the bed per D8; the farmer NPCs are the FLAVOR of the service and
  the vendors of its supplies). Bootstrap: brook_carrot doubles as the starter fee
  vegetable, vendor-stocked by farmer_jessica at Eastbrook with a buyValue at the
  four-times-sell convention (priced in Phase 5, stocked in Phase 9), so a day-one
  player can pay their first fee. Compost is likewise vendor-stocked (its buyValue is
  assigned when the item lands in Phase 4, stocked in Phase 9). The growth tonic is
  never vendor-stocked (alchemy-crafted, sellValue only). Watch fees are a produce
  sink supporting crop prices.
- D10: One tool, the hoe: a four-rung ladder of ordinary items with
  `use: { type: 'gatherTool', professionId: 'farming', tier }` riding
  `canGatherTier` and the frozen wield-gate thresholds for free. Recipes follow the
  `TOOL_RECIPES` pattern; the top rung is unpriced and craftable (the R23 arm). Hoes
  accept the three existing tool effects (unlike fishing rods; the policy gate in
  `slotToolEffectRefused` admits farming).
- D11: Crops, two per tier, eight total (ids locked, display names get a maintainer
  lore pass): tier 1 `vale_wheat`, `brook_carrot`; tier 2 `marsh_rice`, `bog_beet`;
  tier 3 `highland_barley`, `frost_gourd`; tier 4 `gilded_sunmelon`,
  `evergarden_greens`. Every crop ships seed + produce + `fine_` twin (the
  `MATERIAL_GRADES` requirement) + at least one consumer recipe in the same phase.
  Produce is `kind: 'junk'` (browses under the market's material filter), sellValue per
  the materials convention, market-listable by default. Seeds: tiers 1 and 2 are
  vendor-stocked WITH a positive `buyValue` (the dead-row trap: a vendor row without
  one renders then refuses); tiers 3 and 4 come from harvest seed-back rolls and the
  rare event, so high-tier seeds are market goods. Planting consumes the seed.
  Sanctioned same-phase-consumer exception: Phase 3 lands a minimal testable slice
  (vale_wheat seed and produce plus the fine_vale_wheat twin and its grades row, and
  withered_husks) with consumers explicitly deferred (husks to the Phase 4
  convertHusks command, produce to the Phase 6 dishes); the rule is then enforced for
  the full crop set by the Phase 5 rollout arms and closed by Phase 6.
- D12: The rare event is `golden_harvest`: a fourth flavor on the existing
  `gatherRareEvent` SimEvent shape, rolled at harvest (1/90, the shared constant),
  five-fold yield, always signed, zone-announced through `announceGatherRareEvent`'s
  path so the HUD case stays single.
- D13: Deeds (append-only, cosmetic, zero rng): first planting, a first-harvest
  chronicle per farming zone (`farm:<zone>` visit marks with an earnability table, the
  `ZONE_FISH` template), a golden-harvest deed, and a farming-100 title. The
  `tests/deeds_content.test.ts` totals (deed order length, total renown, title count)
  re-pin deliberately in the same change.
- D14: Ready notices. On login: a check inside `Sim.addPlayer` immediately after saved
  state restore (beside the `mailWelcomed` one-shot and the deeds retro block), obeying
  the same three rules: no rng, flag-or-state-derived only, personal-only text-free
  SimEvent. While online: a 1 Hz sweep (`ctx.tickCount % 20`, the guild_letter idiom).
  Both surface as an ambient-class banner via the banner queue plus a chat line. Never
  mail (an inbox is an obligation surface).
- D15: Well-fed buff food follows the elixir arm precedent exactly: minted inline from
  a new `ItemDef.wellfed` field, applied via `ctx.applyAura` from the food path in
  `src/sim/items.ts` (never through `effect_dispatch`), with aura ids in a DISTINCT
  namespace `wellfed_<kind>` so food never clobbers `elixir_<kind>` (the documented
  exclusivity-slot trap). Every new aura name gets an `AURA_NAME_KEY` row. Magnitudes
  are modest, classic-era, at or below the existing elixir budget ceilings; crafted
  power stays below the raid floor.
- D16: The shared feast (the tier-4 showcase): placed by a player, spawns a REAL entity
  so the normal entity snapshot carries it to everyone (the battleground flag precedent;
  the mobile-station `mst` scalar cannot carry a shared world object and has no render
  seam). Server-side state: charges remaining, a per-player consumed ledger (the
  `creditedObjects` stable-key idiom), tick-domain expiry. Transient, never serialized
  (the mobile-station rationale: tick-domain expiry is not restart-safe).
- D17: IP-safe naming is a standing rule: no coined terms from other games (no
  supercompost, no borrowed plant names), real plant words and original zone-flavored
  coinages only. The window is the Harvest Journal (Farmer's Almanac collides with real
  trademarked publications). Audit every new name at authoring time.
- D18: UI. The Harvest Journal is a proper HUD window: DOM-free pure view core in
  `UI_PURE_CORES` plus a thin painter on the `PainterHost` seam, composed by the HUD.
  It lists every plot, contents, growth stage, time remaining, and applied knobs; map
  and minimap pins mark the four patch sites. Countdown rendering copies the
  daily-rewards pattern (dedicated interval, data-attribute rebind, absolute times via
  `formatDateTime`, mm:ss via a t() token template, buff durations via
  `compactAuraDuration`). Ship the timer UI in-game: the OSRS lesson, non-negotiable.
- D19: Art. Wave 1 is procedural, swap-ready GLBs through the image-to-glb pipeline
  (fixed footprints and pivots so sourced models drop in later without code changes).
  The replacement handoff manifest lives at `docs/design/farming-asset-manifest.json`
  (in docs/design so it SURVIVES packet teardown). Growth stages render per crop
  family (grain, root/leaf, gourd) with shared early stages; the field is the progress
  UI (visible stage changes, wet-soil plant state, withered silhouettes).
- D20: The intro quest: farmer_jessica at Eastbrook (the user-required name) gives a
  two-step quest on the `q_prof_intro` template (accept, plant one vale wheat, return
  whenever to harvest), with a farming objective arm crediting the ACTION (the gather
  objective precedent: inventory cannot prove the deed). Her dialog states the magic
  sentence: it keeps growing while you are away, and it never spoils. No tutorial
  system beyond this.
- D21: Work orders: farming produce rows join the repeatable work-order rotation with
  the machine-enforced payout arithmetic (`copperReward` equals
  `floor(WORK_ORDER_PAYOUT_FRACTION * summed vendor sellValue)`, guarded by
  `tests/professions_work_orders.test.ts`; leave the arithmetic comment on every row).
- D22: Delivery model: the packet docs merge first as their own PR into the newest
  `release/**` branch; every phase then starts by re-resolving the NEWEST release
  branch (version sort), branches off it in THIS worktree, and merges release movement
  in with the release-merge-audit skill when long-lived. Each phase is its own PR.
  Every phase file carries a Live-surface note stating exactly what players can reach
  after that phase merges (early sim phases stay dormant: no vendor seeds, no render,
  no UI entry until their enabling phases land).
- D23: Parity goldens. Professions fields are sampled into every golden digest, so
  adding `farming: 0` to the default proficiency map regenerates ALL goldens in Phase 1
  (deliberate, `UPDATE_PARITY=1`, its own reviewed commit, the Phase 8 professions
  precedent). `PlayerMeta.farmPlots` is gameplay state: sampled, not excluded. Static
  farmer NPCs shift the world-ctor entity-id counter: same deliberate-regen recipe in
  the NPC phase. Never hand-edit a golden; a red trace means behavior changed.
- D24: Wave 2 parking lot (explicitly OUT of this packet): crop-adjacency buffs
  (approved, held), cultivated herbs for alchemy (approved WITH the displacement
  guardrail: complement wild herbalism, never a second faucet of the identical item),
  premium compost tiers.

## Non-negotiable constraints

- Determinism: all randomness via `ctx.rng`; no `Math.random`, `Date.now`, or
  `performance.now` in `src/sim/` (guarded by `tests/architecture.test.ts`). Wall clock
  only through `ctx.lockoutNowMs` / `ctx.raidResetMs`.
- The seam: extend the `IWorld` facet first (`src/world_api/professions.ts` or a new
  `src/world_api/farming.ts` facet file, never the barrel), implement in BOTH `Sim` and
  `ClientWorld` in the same change, update the pinned member lists in
  `tests/world_api_parity.test.ts`.
- Server authority: clients never decide outcomes; no wire command ever ingests a
  client-supplied `ItemInstancePayload`.
- i18n: every player-visible string is a `t()` key added in ENGLISH ONLY to the matching
  `src/ui/i18n.catalog/` module (never edit locale overlays; M16 wordy strings also need
  their five non-Latin fills in the same change). Sim/server player text is id-carrying
  SimEvents or matcher rules in the SAME change; the S3 guard
  (`tests/localization_fixes.test.ts`) enforces it. New aura names need `AURA_NAME_KEY`
  rows in `src/ui/sim_i18n.ts`.
- Module-first: every new behavior is its own module behind an existing seam
  (`SimContext` for sim systems, view core + painter for HUD, `src/render/<thing>.ts`
  for visuals). Never grow `sim.ts`, `hud.ts`, `renderer.ts`, or `main.ts`.
- No em dashes, en dashes, or emojis anywhere. IP-safe names only (D17).
- Shared-checkout care: commit with EXPLICIT paths, never `git add -A`. All farming
  work in `~/Documents/woc-farming-plan`.
- Never set `ALLOW_DEV_COMMANDS=1` outside dev. Never commit secrets.

## Tick and hook points (verified against release/v0.36.0)

- The per-tick driver `updateFarming(ctx)` APPENDS after `updateProfNudges(this.ctx)`
  and before `deedsMod.updateDeeds(this.ctx)` in `Sim.tick` (append, never reorder: the
  shared rng stream makes reordering fork every golden). It draws no rng (D4) and does
  no per-tick allocation in the hot path.
- Skill gains go through the shared `queueGatheringGrant` / `drainGatheringGrants`
  queue with a farming-owned gain schedule (the fishing pattern). The drain runs earlier
  in the tick than the profession block, so an end-of-tick grant lands next tick:
  expected, documented.
- The on-login check lives in `Sim.addPlayer` immediately after saved state restore,
  beside the `mailWelcomed` one-shot and the deeds retro block. Flag or state derived,
  no rng, personal events only.
- SimContext extensions (if any callback is needed) touch exactly FIVE sites plus the
  pinned `CALLBACK_KEYS` list in `tests/sim_context.test.ts` and every suite that
  hand-builds a fake host (`tests/world_boss.test.ts`, `tests/dungeons.test.ts`,
  `tests/entity_roster.test.ts`, `tests/heroic_vendor.test.ts`,
  `tests/nythraxis_raid_unit.test.ts`). A pure per-tick driver needs NO new callback
  (the `updateCommissionOrders` precedent).

## Blast-radius reference (verified; phase files cite this, do not re-derive)

Compile-forced by the fifth id: the `GATHERING_PROFESSIONS` record row; any object
literal typed `GatheringProficiency` (mostly test fixtures).

Silent-miss sites that MUST be swept by hand in Phase 1 (no compile error, wrong or
missing copy at runtime): `src/ui/gathering_profession_name.ts`
(`GATHERING_PROFESSION_NAME_KEYS`: an unlisted id renders NO row);
`src/ui/gathering_view.ts` `gatherDeniedLineKey` (falls through to the corpse line) and
`gatherToolNoNodeKey` (falls through to the mining line); the four per-profession key
families in `src/ui/i18n.catalog/hud_chrome.ts` (`toolTierUnmet`, `toolRequired`,
`wieldUnmet`, `noNodeNearby`) plus the profession display name.

Data-driven sites that just work once the content row exists: `emptyGatheringProficiency`,
`normalizeGatheringProficiency`, `gatheringSkillsView`, the tools and wield-gate
walkers, `characterProfessionsSheet`, `buildGatheringProficiencyRows`, the professions
window gathering section, the wiki generator (auto-adds the farming page; the summary
line naming four gathering professions updates), and the deeds any-profession arm.
CONSEQUENCE to flag, not fix: farming automatically becomes a way to satisfy existing
any-profession-at-N deeds (accepted default).

Wire: `gprof` carries the fifth key for free (wholesale-replace mirror). The
`tests/snapshots.test.ts` round-trip literal gains `farming: 0`. No new per-entity key;
plot state rides a NEW self delta key (working name `fplot`) registered in
`ALL_DELTA_KEYS` + `TERSE_TO_IWORLD` with round-trip pins.

Test pins that move (re-pin deliberately, never loosen):
`tests/professions_contracts.test.ts` (the exact-order skills array gains a fifth row),
`tests/profession_icons.test.ts` (demands a `gather_farming` procedural icon),
`tests/snapshots.test.ts` (literal above), `tests/deeds_content.test.ts` (totals),
`tests/professions_skill_caps.test.ts` and other suites with literal proficiency maps,
`tests/professions_blob_growth.test.ts` (worst-case save blob grows), the wiki
freshness gate (`tests/guide.test.ts`, regen via `npm run wiki:content`), and the full
parity golden set (D23).

R37 (`tests/professions_zone_rollout.test.ts`): farming adds its OWN arms against
`FARMING_ZONES` (patch coverage per farming zone, seed/produce/fine-twin integrity,
hoe rungs at each tier with the hub stocking rule, top rung unpriced and craftable,
chronicle deeds earnable). The existing node arms are untouched. The farming station
question does not arise (farming has no station).

## Seam reference (verified; the pattern to copy for each surface)

- Consumables: food/drink sit-restore is `p.eating` / `p.drinking` slots filled in the
  `useItem` food arm; the ONLY timed-buff consumable is the elixir arm (inline aura from
  `ItemDef.elixir`, `ctx.applyAura`, id `elixir_<kind>`). Well-fed copies that arm with
  the `wellfed_` namespace (D15). Buff display: `src/ui/auras_view.ts` +
  `auras_painter.ts`; tooltips beside `elixir_tooltip_view.ts`.
- Placeable feast: real entity + entity snapshot (D16); interaction arm in
  `src/sim/interaction.ts`; charge ledger via the stable-content-key idiom in
  `src/sim/quests/interact_object_credit.ts`.
- Quest: `q_prof_intro` in `src/sim/content/zone1.ts` is the intro template (including
  `requiredItems` re-granting the starter tool). A farming action objective needs a new
  objective arm crediting the action, not a `collect`. Bump `rev` if an existing
  quest's objective indices ever change meaning.
- Vendors: stock is `NpcDef.vendorItems` ids; a row without positive `buyValue` (or
  `priceHonor`) renders then refuses (the dead-row trap). Crafted outputs never get
  `buyValue`. Changing a `sellValue` after a work order references it breaks the
  payout guard: edit both together.
- Notifications: `Hud.showBanner(text, ..., bannerClass)` on the banner queue
  (celebrations FIFO, ambient replaces); the `gatherRareEvent` HUD case is the
  canonical text-free-event-to-localized-line-plus-personal-cue shape; one-shot flags
  flip BEFORE the emit (`mailWelcomed` idiom).
- SFX: new cue = `UI_CUES` key + facade method in `src/game/audio.ts` (widen the
  `UiCue` union for nested families) + the `hud.ts` case + a prompt row in
  `scripts/sfx/sfx_prompts.mjs` + `npm run sfx:ui` (deterministic placeholder) +
  `sfx:manifest` + `sfx:check`; the completeness guard in `tests/game_audio.test.ts`
  fails a key with no file. Placeholder rows are marked for the sound engineer.
- Countdowns: the daily-rewards window owns the live-countdown pattern (dedicated
  interval, `[data-...]` rebind, `formatDateTime` absolutes, t() token mm:ss). Copy it;
  never hand-build a clock string with a literal colon.

## Validation matrix (run what the change type demands)

- Any code change: `npx tsc --noEmit` (fast native TS7) and
  `npm run ci:changed` (biome on changed files only; fix with a SCOPED
  `npx @biomejs/biome check --write <file>`, never whole-tree).
- sim change: the affected `npx vitest run tests/professions_farming*.test.ts` plus
  `tests/architecture.test.ts` (purity) and `tests/sim_context.test.ts` (if the seam
  moved); same-seed determinism pins.
- Player text or emit changed: `npx vitest run tests/localization_fixes.test.ts` (S3).
- Wire/snapshot change: `npx vitest run tests/snapshots.test.ts
  tests/env_protocol.test.ts tests/bandwidth.test.ts`.
- Parity-adjacent change: `npx vitest run tests/parity` BEFORE touching goldens; regen
  only deliberately (`UPDATE_PARITY=1`) in an isolated commit.
- Content change: `tests/professions_zone_rollout.test.ts`,
  `tests/recipe_economy.test.ts`, `tests/professions_work_orders.test.ts`,
  `tests/deeds_content.test.ts`, `npm run wiki:content` freshness.
- UI change: the window's own suite + `tests/hud_perf_budget.test.ts` bucket +
  a mobile screenshot script against a phone viewport.
- Phase end: `node scripts/gate_select.mjs` (the fast pre-merge gate);
  `npm run gate` for the deep check. Known environmental red: the armory browser
  pixel test; grep the log for "[gate] FAIL", never trust a piped exit code, and PR CI
  is the arbiter.

## Key planned files (working names; a phase may refine with a note here)

- `src/sim/content/farm_patches.ts` (FARM_PATCHES, FarmPatchDef)
- `src/sim/content/farming_items.ts` or rows in existing item/content modules (seeds,
  produce, fine twins, compost, husks, tonic, hoes, dishes, feast)
- `src/sim/professions/farming.ts` (the driver: plant, harvest, growth script,
  survival/yield resolution, updateFarming, ready-check helpers)
- `src/sim/professions/farming_zones.ts` (FARMING_ZONES, the zone tier side table:
  the one home of the zone set; farm_patches.ts never redefines it)
- `src/world_api/farming.ts` (IWorldFarming facet: patch defs, my plots, commands)
- `src/ui/harvest_journal_view.ts` + `src/ui/harvest_journal_window.ts` (or the
  hud-domain directory form per `src/ui/hud/CLAUDE.md`)
- `src/render/farm_patches.ts` (beds + crop stage props adapter)
- `scripts/assets/build_farm_props.mjs` (procedural swap-ready GLBs)
- `docs/design/farming-asset-manifest.json` (the handoff list; survives teardown)
- `tests/professions_farming*.test.ts`, `tests/farm_patch_placement.test.ts`, a
  `farming_session` parity scenario

## Per-phase ledgers (append as phases complete)

- New IWorld members: (none yet)
- New SimEvents: (none yet)
- New wire keys: (none yet)
- New i18n keys and matcher rows: (none yet)
- New items/recipes/deeds: (none yet)
- Locked deviations from phase files: (none yet)
- Dev command surface: (Phase 3 records the exact /dev farm cheat names here at
  completion; Phases 7 and 8 depend on them for dev-created crops)

## OPEN items (maintainer decisions or later-phase calls, never guess)

- Crop display names: ids are locked (D11), English display names get a maintainer
  lore pass in the content phase PR.
- Exact tuning constants: growth durations per tier inside the D5 bands, the gain
  schedule, harvest-lives save-chance endpoints, well-fed magnitudes and durations,
  feast charge count and expiry. Phases propose concrete values in the PR body and
  flag them for the maintainer; the packet deliberately does not freeze them.
- Whether farming counting toward existing any-profession deeds is accepted (default
  yes; it is automatic via the data-driven arm; flag in the Phase 1 PR body).
- Seed-back roll rates for tier 3/4 seeds (economy-sensitive; propose in the content
  phase with the market in mind).
