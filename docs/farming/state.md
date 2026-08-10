# Farming: cross-phase state (the cheat sheet)

Read this file first in every phase session. It is the single authority for locked
decisions. If a phase file contradicts this file, this file wins and the phase file
gets swept in the same pass (amend the QA twin too, always).

Current phase: Phase 5 QA done 2026-08-09 (PASS-WITH-FOLLOWUPS); Phase 6
(economy hooks) is next. Packet authored 2026-08-07 off release/v0.36.0; the
branch has absorbed release/v0.36.0 through 6e1ead1fea (ninth absorb, opening
Phase 5 QA 2026-08-09: the gfx-perf GPU queue and entry-prewarm batches, PRs
3217 and 3219, render-only; release-merge-audit clean with an EMPTY
farming-footprint intersection, no new endpoints, no lockfile change; parity
and snapshots re-proven green on the merged HEAD, farming_session golden
byte-identical. Count-pin baselines unchanged from the eighth absorb:
command_schema 196/209, IWorld members 308 (79 data, 229 method), delta keys
84. The eighth absorb 5819c005a7 opened Phase 5: the gate-perf CI batch,
warrior Intervene and fear DR, the three r165 compileAsync patch with its
lockfile-driven asset seal re-mint, idle-mob distance culling with its own
parity scenario, the 16 static self-record scalars moved behind the delta
gate, and bg_respond. The seventh absorb 66c2340242 landed at Phase 4 QA;
the sixth 1478f9d2ba opened Phase 4. NOTE for any farming GLB
work (Phase 7 props, Phase 13 art): fingerprints must be minted against the
pnpm-lock.yaml the EIGHTH absorb brought, or the asset suites red.)
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
  keyed to an explicit set: `FARMING_ZONE_TIERS = eastbrook_vale (tier 1), mirefen_marsh
  (tier 2), thornpeak_heights (tier 3), evergarden (tier 4)`, plus its OWN placement
  guard suite cloning the physical-safety arms (dry land, no collider overlap, reachable
  stand spot, zone containment, spacing) for `FARM_PATCHES`. Hub anchors for patch
  sites and farmer NPCs: eastbrook_vale at Eastbrook, mirefen_marsh at Fenbridge,
  thornpeak_heights at Highwatch, and evergarden at the formal parterre grounds.
  CORRECTED IN PHASE 2 against shipped content: the Evergarden DOES have a named hub,
  Hedgewick at (320, 810) (EVERGARDEN_ZONE.hub, src/sim/content/evergarden.ts); the
  parterre is the POI 'the_statuary_walk' ("The Parterre Walk") at (360, 875). The
  parterre grounds remain the PATCH-SITE anchor (the beds sit on the parterre lawn),
  but every hub-reachability arm floods from the ZONE hub, Hedgewick, because that is
  what the cloned hubFloodStart reads. Phase files may use these hub names; this
  mapping is the anchor.
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
  (vale_wheat seed and produce plus the fine_vale_wheat twin, and withered_husks)
  with consumers explicitly deferred (husks to the Phase 4 convertHusks command,
  produce to the Phase 6 dishes); the rule is then enforced for the full crop set by
  the Phase 5 rollout arms and closed by Phase 6. [CLOSED by Phase 6: FARM_RECIPES
  landed the dishes and the tonic craft, the rollout closure arm derives recipe
  consumers from merged ALL_RECIPES, and the five-twin deferred literal is gone;
  see the Phase 6 items/recipes ledger entry.] [The original "and its grades row"
  clause here is AMENDED by deviation (o): fine twins ship as ordinary items with NO
  MATERIAL_GRADES row; that table is pinned as exactly the nine node yields, and the
  fine roll lives in farming's own harvest resolver.]
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
- D22: Delivery model, LOCAL-ONLY (standing user rule, 2026-08-07; this supersedes
  every push-and-open-a-PR line in the phase files, and state.md wins on
  contradiction): ALL farming work stays local until the user declares the feature
  done. No pushes, no PRs, for anything farming. The integration branch is the LOCAL
  `feature/farming-plan` in this worktree (it carries docs/farming/ and is based on
  release/v0.36.0). Every phase: fetch, then branch `fix/farming-phase-NN-<slug>` off
  LOCAL `feature/farming-plan` (never off a bare release tip, which lacks the packet);
  if a newer `release/**` tip exists than the branch has absorbed, merge it INTO the
  phase branch first (release-merge-audit for a nontrivial merge). A finished phase
  merges back into `feature/farming-plan` with --no-ff (the phase boundary stays
  readable) and deletes its branch. The would-be PR body becomes the phase report in
  the progress.md Notes block (including required flags and screenshot references);
  screenshots are still captured and committed under docs/screenshots. Every phase
  file carries a Live-surface note stating exactly what players can reach once the
  feature eventually ships (early sim phases stay dormant: no vendor seeds, no
  render, no UI entry until their enabling phases land). When the user green-lights
  going public, `feature/farming-plan` is pushed and delivered whole.
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

Verified at packet authoring; the branch has absorbed newer v0.36.0 tips since
(6ed4d7e12c as of 2026-08-08), so each phase start re-verifies the hook points
it is about to use.

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
`wieldUnmet`, `noNodeNearby`) plus the profession display name; and the TWO hand-written
guide prose keys in `src/ui/i18n.catalog/guide.ts` that hardcode the trade count,
`guide.professions.whatBody` ("four gathering trades") and
`guide.professions.gatherHubBody` ("Four gathering trades feed the ring ...", also
naming each trade), discovered in Phase 1: neither updates automatically, no test pins
them, and every locale overlay carries translations that go stale on reword (reword the
English count-free, ship the five non-Latin fills per M16, pin against a hardcoded
count, and ledger the stale Latin overlays for the release-time fill). Also discovered
in Phase 1: `src/ui/gather_tool_tooltip.ts` carries an EXHAUSTIVE
`Record<GatheringProfessionId, TranslationKey>` (`KIND_KEYS`, compile-forced, needs a
`hudChrome.gathering.toolTooltip.kind.farming` key) beside two Partial-typed neighbours
(`UNLOCKS_KEYS`, `USE_KEYS`) that miss silently; Phase 1 fills `KIND_KEYS` and
deliberately leaves the Partial pair empty for farming (no hoe item exists yet; the
crops/tools phase revisits them when the hoe lands). And
`src/ui/gather_node_tooltip_controller.ts` (lines 56-66) carries three-key
node-tooltip maps that never listed fishing: farming is fishing-shaped (own
FARM_PATCHES table, never a GatherNodeType), so the deliberate decision is that
farming, like fishing, NEVER gains a row there; if a later phase ever adds a farming
node type this entry is the reminder that the decision was made, not missed.

Latent sites the Phase 1 reviews mapped for LATER phases (each unreachable today,
each bites the phase that ships the named feature):
- The hoe phase: `tierRequired`/`requiresTool` hud_chrome families and the
  `UNLOCKS_KEYS`/`USE_KEYS` Partial maps in `src/ui/gather_tool_tooltip.ts` (call
  sites guard undefined, lines just drop); `useGatherToolItem` returns a SILENT false
  for farming (`NODE_TYPE_BY_PROFESSION` has no farming row, guard at
  `src/sim/professions/gathering.ts` tool-use path), so the noNodeNearby.farming
  denial line stays unreachable until the beds phase decides farming's tool-use path;
  and `slotToolEffectRefused` (`src/sim/professions/tools.ts`) statically REFUSES
  every farming pair (Phase 1 QA finding: without it the admin restore path accepted
  farming pairs it could never grant); the hoe phase LIFTS that refusal arm and its
  pins (tool_effect_tooltip and professions_admin_restore suites, plus the
  Phase-1-QA additions: the self-clearing no-farming-gatherTool tripwire in
  tests/tool_effect_tooltip.test.ts and the restoreSlotBodyError farming case in
  tests/admin/professions_restore.test.ts, both of which red the moment the first
  farming gatherTool lands) when the first farming gatherTool lands. The growth phase also deletes or inverts the structural
  ungainability pin in tests/professions_gathering.test.ts. The wiki page's tools and
  nodes sections length-guard (Phase 1 QA finding: an empty nodes array rendered
  "respawns for you 0 seconds"); the phase that ships farming tools or beds gets those
  sections back automatically, with the render test in tests/guide.test.ts flipping
  to demand them.
- The beds phase: `TIER_REQUIRED_KEYS`, `REQUIRES_TOOL_KEYS`, `NODE_NAME_KEYS` in
  `src/ui/gather_node_tooltip_controller.ts` (hover surface must match the click
  toast); the `gatherDeniedLineKey` comment promise that the beds phase decides which
  surface patches emit.
- The tools phase: `toolEffectSlotsFor` sorts wire rows by professionId codepoint and
  'farming' sorts BEFORE 'fishing', so the first farming tool-effect row lands at the
  FRONT of the wire array (declared contract, but expect the shift).
- The growth phase (first phase where farming proficiency can exceed 0): the parity
  omit-defaults shield ends there (a nonzero farming key enters the state sample), so
  THAT phase re-runs the full golden regen Phase 1 proved unnecessary; it also raises
  GAINABLE_GATHERING_PROFESSIONS in tests/deeds_content.test.ts (the any-N cap guard
  is one-directional and nothing else reds when farming becomes gainable); SimEvent
  payloads must never carry a whole proficiency record (event digests hash with
  omitDefaults false, so a zero key WOULD move them); and the legacy `professions`
  dual-write rollback caveat becomes real (an older binary normalizes over four ids
  and persists the loss; documented in docs/design/professions-tuning-packet.md).
- Release-time i18n reconcile: the five non-Latin whatBody fills say "all eight
  crafts" where English says "seven of the eight" (pre-existing condensation,
  inherited); the Latin-script overlays keep stale "four trades" prose for
  whatBody/gatherHubBody and the count-bearing gatherDeeds rows.
- Pre-existing stale comments inherited, not fixed (outside the Phase 1 diff):
  `src/sim/types.ts` "over the three professions", `src/net/online.ts` gprof comments
  "(Mining/Logging/Herbalism, #1119)" twice, the `src/guide/pages/professions.ts`
  header ("the four gathering professions"), and `scripts/load_professions.mjs`
  GATHER_PROFS (a three-id literal that never gained fishing or farming; bench
  tooling only).

Data-driven sites that just work once the content row exists: `emptyGatheringProficiency`,
`normalizeGatheringProficiency`, `gatheringSkillsView`, the tools and wield-gate
walkers, `characterProfessionsSheet`, `buildGatheringProficiencyRows`, the professions
window gathering section (Phase 1 QA correction: an icon SITE only just-works if it
resolves through `professionIconUrl`, the art-or-procedural resolver;
`professionImageUrl` alone paints nothing for a pending-art id, which is how the char
sheet farming row shipped iconless until the QA round), the wiki generator (auto-adds the farming page; but see the
silent-miss list above: the guide summary prose does NOT update itself, and the
generated farming page takes the node-profession arm of
`src/guide/pages/professions_gathering.ts`, rendering node-harvest prose with empty
tool/node tables until a later phase gives farming its own arm), and the deeds
any-profession arm.
CONSEQUENCE to flag, not fix: farming automatically becomes a way to satisfy existing
any-profession-at-N deeds (accepted default). Phase 1 follow-on for the DEEDS PHASE
(must-do, discovered in Phase 1): the Master Gatherer trigger
(`src/sim/deeds.ts`, computed from `GATHERING_PROFESSION_IDS`) now counts farming, but
its desc in `src/sim/content/deeds.ts` (`prog_master_gatherer`) still reads "any three
of Mining, Logging, Herbalism, and Fishing" (its own comment records the same reword
when fishing joined), and three guide keys
(`guide.profPages.gatherDeeds.{mining,logging,herbalism}`) repeat the stale list. The
deeds phase rewords all four count-free in one deliberate pass WITH their non-Latin
fills (rewording them piecemeal in Phase 1 would stale reviewed overlay prose twice).

Wire: `gprof` carries the fifth key for free (wholesale-replace mirror). The
`tests/snapshots.test.ts` round-trip literal gains `farming: 0`. No new per-entity key;
plot state rides a NEW self delta key (working name `fplot`) registered in
`ALL_DELTA_KEYS` + `TERSE_TO_IWORLD` with round-trip pins.

Test pins that move (re-pin deliberately, never loosen):
`tests/professions_contracts.test.ts` (the exact-order skills array gains a fifth row),
`tests/profession_icons.test.ts` (demands a `gather_farming` procedural icon; Phase 1
found its E2/F checks also pin every recipe id as art-backed in production, committed
128px WebP plus a maintainer-held master SHA in `public/ui/professions/mapping.json`,
which procedural-only cannot satisfy: resolved by a deliberate PENDING_ART allowlist
amendment scoped to `gather_farming`, cleared by the phase-13 asset batch),
`tests/snapshots.test.ts` (literal above), `tests/deeds_content.test.ts` (totals),
`tests/professions_skill_caps.test.ts` and other suites with literal proficiency maps,
`tests/professions_blob_growth.test.ts` (worst-case save blob grows), the wiki
freshness gate (`tests/guide.test.ts`, regen via `npm run wiki:content`), and the full
parity golden set (D23).

R37 (`tests/professions_zone_rollout.test.ts`): farming adds its OWN arms against
`FARMING_ZONE_TIERS` (patch coverage per farming zone, seed/produce/fine-twin integrity,
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
  pixel test; grep the log for "FAIL" (the selective gate prints "[gate:select] FAIL", the full gate "[gate] FAIL") plus the GATE EXIT marker, never trust a piped exit code, and PR CI
  is the arbiter.

## Key planned files (working names; a phase may refine with a note here)

- `src/sim/content/farm_patches.ts` (FARM_PATCHES, FarmPatchDef)
- REFINED (Phases 3 and 4): `src/sim/content/farming_items.ts` never existed;
  item defs live in `src/sim/content/items.ts` BASE_ITEMS and the id blocks
  (FARM_MATERIAL_ITEM_IDS, FARM_SUPPLY_ITEM_IDS) in
  `src/sim/content/farm_crops.ts` beside the crop catalog
- `src/sim/professions/farming.ts` (the driver: plant, harvest, growth script,
  survival/yield resolution, updateFarming, ready-check helpers)
- `src/sim/professions/farm_watch_fee.ts` (Phase 4: the D9 fee predicate,
  eligibility order, and payment planner; pure leaf with an injectable
  catalog since Phase 4 QA)
- `src/ui/farming_view.ts` (Phase 4: farming's own UI pure core in
  UI_PURE_CORES; the deny-line key and the grant-line selectors moved in)
- `src/sim/professions/farming_zones.ts` (FARMING_ZONE_TIERS, the zone tier side table:
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

- New IWorld members: Phase 2: farmPatches (data) and myFarmPlots (data) on the new
  IWorldFarming facet (src/world_api/farming.ts); parity pins moved 302 to 304
  members, 77 to 79 data, 32 to 33 facets. RE-RUN tests/world_api_parity.test.ts and
  tests/snapshots.test.ts after EVERY release absorb into this branch: identical
  count-pin bumps on both sides auto-merge to a wrong total with no textual conflict
  (the char-sheet playtime precedent).
  Phase 3: plantCrop(bedId, cropId) and harvestCrop(bedId) as method members on
  IWorldFarming (both worlds; wire tokens plant_crop / harvest_crop); parity pins
  moved 304 to 306 members, 225 to 227 methods (data 79 and facet count 33
  unchanged; the two extra 304 literals near the union pins moved with them).
  Phase 4: convertHusks() as a method member on IWorldFarming (both worlds; wire
  token convert_husks, no payload); parity pins moved 306 to 307 members, 227 to
  228 methods (data 79 and facet count 33 unchanged; the union-size pair moved
  with them). plantCrop's SIGNATURE widened to (bedId, cropId, knobs?:
  FarmPlantKnobs) with no member-count movement; FarmPlantKnobs lives in
  farm_projection.ts and re-exports through the facet and the barrel.
  command_schema counts moved 194/207 to 195/208 (send/dispatch).
- New SimEvents: Phase 4: farmHusksConverted { pid, husks, compost } (text-free,
  pid-scoped; owns both halves of the trade feedback, the compost grant riding
  its hub loot event silent + callerLogs). farmDenied's reason union grew four
  appended members: no_husks (convert_husks below one batch), then no_compost,
  no_fee_produce, no_tonic (the plant-time knob payments; each denies the whole
  plant with nothing consumed and zero draws). Phase 3: farmPlanted { pid, bedId, cropId }, farmHarvested
  { pid, bedId, cropId, itemId, count, fineItemId?, fineCount? } (an all-fine
  harvest collapses the fine grant INTO the base fields so count is always
  positive and the fine pair present means a genuinely mixed harvest),
  farmWithered { pid, bedId, cropId, count }, farmDenied { pid, reason, bedId?,
  cropId? } with reason 'bad_bed' | 'bad_crop' | 'range' | 'bed_taken' | 'skill'
  | 'no_seed' | 'not_ready' | 'no_plot'. All text-free and pid-scoped; NO plot
  state rides any payload (ids and counts only; the parity omit-defaults shield
  does not cover event digests, and the farming_session golden digests these).
- New wire keys: Phase 2: fplot (the self delta mirroring myFarmPlots; tslot-shaped
  emit with the pre-serialized empty arm; registered in ALL_DELTA_KEYS and
  TERSE_TO_IWORLD, count pin 67 to 68). The projection NEVER carries
  PlotState.survivalRoll or yieldSeed; the negative leak pin in tests/snapshots.test.ts
  drives the real selfWireJson broadcast with an exhaustive nine-key set assertion.
  Phase 3: no new wire keys; the fplot EMIT moved behind the heavy-self gate now
  that its non-empty arm is live (the "revisit if rows grow" trigger below,
  tripped and resolved in-phase): plant_crop and harvest_crop joined
  HEAVY_SELF_CMDS and farmPlanted joined HEAVY_SELF_EVENTS (kept deliberately
  redundant with honest comments: wireRev already covers the successful paths
  because both commands touch bags, but Phase 4's knob commands will mutate
  plots WITHOUT an inventory change and need the command-side marking).
  Phase 4: the plant_crop frame gained three OPTIONAL literal-true knob fields
  (compost, watch, tonic), sent only when true so a plain plant's frame stays
  byte-identical to the pre-knob wire; the dispatch guards each per field
  (present-but-not-boolean refuses the frame) and hands the sim a complete
  boolean record (absent and false are the same protocol statement). The
  exhaustive frame key-set pins in tests/farming_command_chain_online.test.ts
  moved WITH the guard, both directions. convert_husks joined HEAVY_SELF_CMDS
  (belt and braces per the ledgered comment: the trade touches bags both ways,
  so wireRev covers success); the Phase 3 warning about knob COMMANDS needing
  command-side marking was RETIRED BY DESIGN instead: the knobs are not
  commands, they ride plant_crop's payload, and every paid knob spends items.
- New i18n keys and matcher rows: Phase 6: eight item-name rows in the items
  catalog (the dishes; English plus the five non-Latin fills per M16) and ONE
  hudChrome key, materialHint.growthTonic (the crafted tonic's tooltip purpose
  line, wordy value with its five non-Latin fills). NO recipe-name keys exist
  anywhere: a recipe displays its result item's name (crafting_window renders
  itemDisplayName(row.result)), so the phase file's "recipe name rows" wording
  is satisfied by the item rows alone. No matcher rows (recipes emit no
  sim-side player text).
  Phase 4: six hudChrome.farming keys, each with
  five non-Latin fills (M16): denied.{no_husks, no_compost, no_fee_produce,
  no_tonic} plus husksConvertedLine/husksConvertedLineQty (the trade line names
  both sides: the husks spent and the compost gained). Two item-name rows in the
  items catalog (Compost, Growth Tonic), the English-appended treatment. No
  matcher rows (every new denial and result is a text-free SimEvent).
  Phase 1 added, all English-only catalog rows with
  five non-Latin overlay fills each (M16): hudChrome.gathering.farming,
  hudChrome.gathering.toolTierUnmet.farming, hudChrome.gathering.toolRequired.farming,
  hudChrome.gathering.wieldUnmet.farming, hudChrome.gathering.noNodeNearby.farming,
  hudChrome.gathering.toolTooltip.kind.farming, guide.profPages.gatherIntro.farming,
  guide.profPages.gatherDeeds.farming. Reworded with fresh non-Latin fills:
  guide.professions.whatBody, guide.professions.gatherHubBody,
  guide.profPages.gatherDeeds.{mining,logging,herbalism}. Reworded English with
  locale desc fills DROPPED per the deed_i18n release-refill protocol:
  prog_master_gatherer desc (18 locales). No matcher rows (nothing sim-side emits
  farming English).
  Phase 3 i18n: hudChrome.farming.* (15 keys: plantLine, harvestLine/Qty,
  harvestFineLine/Qty, witheredLine/Qty, denied.{eight reason leaves keyed
  VERBATIM off the farmDenied reason union by template literal, so a new reason
  is a tsc error until its leaf exists}), abilityUi.cast.farming, four item-name
  rows in the items catalog with full locale coverage, and the matcher row
  error.castingPlanting for the one sim-side English sentence 'You are
  planting.' (BASE_DICT locale fill deferred to release-time per the
  contributor contract). All wordy values carry the five non-Latin fills (M16).
- New items/recipes/deeds: Phase 6: FARM_RECIPES (src/sim/content/recipes.ts), the
  farm-economy hook list beside HOE_RECIPES/ROD_RECIPES, 9 trainer-taught rows
  joined into the content-side ALL_RECIPES spread: 8 cooking dishes (two per crop
  tier at rungs 0/25/50 with the 10/10, 16/15, 20/20 scaffolding; every
  foodHp/sellValue pair REUSES a shipped food-curve point, ceiling 980 reached
  never exceeded: vale_hearth_loaf 90/6, eastbrook_root_pottage 117/12,
  fenbridge_rice_bowl 243/25, fenbridge_beet_braise 432/40,
  highwatch_barley_bannock 552/60, highwatch_gourd_soup 552/75,
  evergarden_sunmelon_tart 980/150, evergarden_harvest_platter 980/150; kind food,
  foodHp only, NO buff machinery, no buyValue, quality matches the rung) plus
  recipe_growth_tonic (alchemy, silverleaf_herb x2 + glass_vial x1 at skillReq 0,
  output 6 under input 20). All values maintainer-flagged at their rows. Every
  row keeps one no-buyValue reagent, so none joins the counterfactual vendor-fed
  literal; the trainer-sum pin and professions_crafting recipeList pin gained the
  list; FARM_RECIPES length pinned twice (9 whole-list, 8 cooking-filtered).
  CONSUMER NOTES CLOSED: the five deferred fine twins each gained a dedicated
  dish slot (fine_brook_carrot in the pottage, fine_bog_beet in the braise,
  fine_frost_gourd in the gourd soup, fine_gilded_sunmelon in the tart,
  fine_evergarden_greens in the platter), all 8 base produce appear across the
  dish set, the rollout closure arm now derives recipe consumers from merged
  ALL_RECIPES (the old derivation could not see recipes and would have stayed
  green while lying), and the items.ts consumer-note comments name the live
  consumers. fine_marsh_rice and fine_highland_barley remain hoe-reagent-only
  by design of the 5-slot closure (see OPEN items). ITEM_ART_PENDING re-pinned
  31 to 39 (the 8 dishes ride as art debt with pairwise-distinct procedural
  recipes on the food radial, no pair separated by palette alone). growth_tonic
  joined MATERIAL_HINT_KEYS (the exact-set pin re-minted deliberately): a
  recipe output must render purpose text and its junk kind has no def-level
  use line. No new deeds (dishes are not conquerable content).
  Phase 4 also minted two more maintainer-flagged
  constant families the first write of this entry omitted (Phase 4 QA
  correction; both live at their definitions and in the progress.md notes):
  FARM_WATCH_FEE_BY_TIER = 2/3/4/6 produce for tiers 1 to 4
  (src/sim/professions/farm_watch_fee.ts, the produce-sink rate), and
  FARM_TONIC_BONUS_CHANCE = 0.5 with FARM_TONIC_BONUS_PICKS = 2
  (src/sim/professions/farming.ts, expected value one extra base-grade pick
  per tonic). Phase 4 items: compost (sellValue 2, buyValue 8 at
  the 4x convention, maintainer-flagged; vendor-stocked in Phase 9 per D9) and
  growth_tonic (sellValue 6, NO buyValue: never vendor-stocked, alchemy-crafted
  in Phase 6). Both are plain consumed-by-command items with no ItemDef.use
  (the def comment states the choice), kind junk quality common (sellAllJunk
  never vendors common), classified as MATERIALS via the new
  FARM_SUPPLY_ITEM_IDS block folded into FARM_MATERIAL_ITEM_IDS
  (content/farm_crops.ts): they are the tradeable input side of the farming
  loop exactly like seeds. MATERIAL_ITEM_IDS moved 59 to 61
  (material_taxonomy_bootstrap size pin re-minted); ITEM_ART_PENDING re-pinned
  as an exact SIX-id set with A4-pairwise-distinct procedural recipes (a damp
  sack and a green draught). Conversion: FARM_HUSKS_PER_COMPOST = 2
  (maintainer-flagged), so one failed crop's husks make exactly one compost.
  Phase 3 items: vale_wheat_seed (sellValue 1, no
  buyValue: seeds stay vendor-unobtainable until go-live), vale_wheat
  (sellValue 4), fine_vale_wheat (sellValue 8, buyValue 32, fine-material
  convention; deliberately NO MATERIAL_GRADES row, see deviation (o)),
  withered_husks (sellValue 1). All kind junk quality common, classified as
  materials via the derived FARM_MATERIAL_ITEM_IDS taxonomy source, sitting in
  the affinity census's self-clearing CONSUMER_DEFERRED_MATERIALS list until
  their consumers land (husks: Phase 4 convertHusks; produce: Phase 6 dishes).
  Icons ride ITEM_ART_PENDING re-pinned as an exact four-id set. No recipes, no
  deeds (deeds deferral verified sound against docs/design/deeds.md by the QA
  gate: a growth engine is none of the conquerable-content kinds).
- Locked deviations from phase files: Phase 1: (a) PENDING_ART_IDS allowlist in
  tests/profession_icons.test.ts (E2 demands art-backed production ids the packet
  did not anticipate; inverted assertions self-clear when the phase 13 art batch
  lands; maintainer sign-off owed at feature review); (b) NO parity golden commit
  (the predicted mechanical red never materializes: the sample drops inert zero
  keys before digesting; regen proven byte-identical; the growth phase inherits the
  first real regen); (c) six commits, not five (review round commit; no parity
  commit); (d) Master Gatherer roster prose pulled INTO Phase 1 from the deeds
  phase (fishing-precedent reword, all three reviewers concurring); (e) the
  GATHERING_PROFESSION_IDS comment was amended, not preserved verbatim (it names
  the appended professions); (f) delivery followed D22: no push, no PR, the
  phase branch merged --no-ff into feature/farming-plan and the would-be PR
  body lives in progress.md (the phase file letters this (d)); (g) the
  blast-radius list gained the sites discovered in flight: gather_tool_tooltip
  KIND_KEYS and its Partial neighbours, the gather_node_tooltip maps, the
  two-key guide count prose (the phase file letters this (e)). THIS ledger's
  lettering is canonical; the phase file's five-letter block differs and
  points here (harmonized in Phase 1 QA, 2026-08-08).
  Phase 2: (h) FARM_CROP_IDS pre-declares ONE crop id, 'wheat' (packet-locked via
  the intro quest): the load-side allowlist and the end-to-end round trip need a
  real id to prove a surviving row; the growth phase owns the catalog and nothing
  can plant this phase, so no live save can carry it. (i) The D2 Evergarden hub
  prose was FALSE against shipped content and is corrected in D2 above: Hedgewick
  is the zone hub and the reachability flood origin; the parterre stays the
  patch-site anchor. (j) FARMING_ZONE_TIERS is farming's OWN tier column, deliberately
  diverging from the shipped zone-progression ladder at evergarden (tier 4 showcase
  vs the named inversion's tier 1), so the fishing test's GATHER_NODES derivation
  CANNOT be copied: literal pins plus the one-ladder arm (FARM_PATCHES[].tier
  toBe the reader) guard it instead, and a fifth farming hub must update both in
  the same change. (k) The placement suite grew three arms beyond the phase file's
  list, each with a counter-example: camp-footprint clearance (the west-Eastbrook
  site passed every physical arm yet sat 8.1 yd inside the Sableweb camp), road
  clearance (5 yd, the world.ts screen), and bed-vs-gather-node clearance; the
  Phase 1 deferral of the node hover tooltip maps to "the beds phase" is RE-DEFERRED
  by the fishing precedent: farming has no GatherNodeType, so those maps stay
  farming-free permanently, and the gatherDeniedLineKey surface decision moves to
  the phase that ships plant/harvest commands. (l) The FarmPlotView clock-base
  question (host-clock absolutes: epoch ms online, sim-clock ms offline) is
  DOCUMENTED as a seam contract this phase (no render/ui consumer may subtract
  Date.now; rely on status), and the RaidLockout-style derived duration field is
  deferred to the growth phase, which owns the first timer surface. (m) No parity goldens
  commit: the regen was proven a byte-identical no-op again (the (b) precedent).
  The gate's full-suite fallback then caught a mirror pin the targeted runs
  cannot see: tests/professions_blob_growth.test.ts keeps its OWN copy of
  PROFESSIONS_BLOB_FIELDS and scrapes the roundtrip sweep's source, so adding a
  field to one list reds the other; the fix commit teaches the growth bound
  farmPlots (every bed planted at full width, about 193 bytes per bed) and
  re-mints the byte ceiling 10240 to 14336 and the floor 9280 to 13696 per that
  file's doctrine. ANY future phase touching PROFESSIONS_BLOB_FIELDS must edit
  BOTH suites in the same change.
  Phase 3: (n) the crop id shipped as vale_wheat, closing (h): D11 wins over the
  Phase 2 'wheat' placeholder, data-safe because nothing could plant; the three
  fixture literals and FARM_CROP_IDS (now derived from the FARM_CROPS catalog in
  the new src/sim/content/farm_crops.ts leaf) swept in the same change. (o) the
  fine twin ships as an ordinary item with NO MATERIAL_GRADES row: that table is
  pinned as exactly the nine NODE_MATERIAL_TABLE yields and its suite derives
  from live node content, so D11's "(the MATERIAL_GRADES requirement)" clause is
  unsatisfiable for a fishing-shaped profession; the fine roll lives in
  farming's own harvest resolver. (p) the hoe-tier and wield gates are DEFERRED
  to Phase 5, verified not assumed: farming registers no gatherTool,
  bestOwnedGatherToolTierOrNone returns NO_TOOL_OWNED, canGatherTier(0, 1)
  would refuse EVERY plant, and the R22 banner forbids the bare-hands-floored
  scan for access decisions; the phase file's gate list and acceptance text
  claiming the hoe gate are amended, and all three seam comments say deferred.
  (q) the plant cast resolves AT COMMAND TIME and the cast is pure flavor (the
  D4 command-body draw rule forces it; the completion-routing arm is
  return-only; damage cancelling the cast leaves the plant standing); no
  SimContext callback was added. (r) survival is evaluated against CURRENT
  farming skill at read time (out-leveling retroactively retires risk, monotone
  player-favorable; the locked PlotState shape has no room for plant-time
  skill); projectFarmPlots takes farmingSkill and a cropTierOf function
  reference to stay a pure leaf. (s) the farming_session golden was re-minted
  TWICE in-phase, both for cause: the addItem silent/callerLogs fix moved the
  event digest (the #2430 double-loot-line finding), and the write-side anchor
  floor changed the tick-0 plant's plantedAtMs from the sampler-dropped 0 (a
  recording of the destroy-on-load defect) to 1; zero pre-existing goldens
  moved at any point. (t) the phase ran EIGHT reviewer verdicts (six domain
  reviews, the QA gate, plus the full-suite gate fallback) and the census
  suites the fallback caught (material_taxonomy, bag_filter, item_icons,
  professions_silent_loot, localization_coverage, tick_perf_capture,
  material_profession_affinity, material_taxonomy_bootstrap) were absorbed
  in-phase: the taxonomy gained the derived FARM_MATERIAL_ITEM_IDS source, the
  affinity census gained the self-clearing CONSUMER_DEFERRED_MATERIALS list,
  and ITEM_ART_PENDING's size-0 pin became an exact-set pin.
  Phase 3 QA: (u) normalizeFarmPlots ADMITS a duration of exactly ZERO as a
  permanently-ready row (only a NEGATIVE duration drops): /dev farmgrow writes
  readyAtMs to the grow instant, so a plot grown in the same tick (offline) or
  millisecond (server) as its plant minted a duration-0 row the old
  duration <= 0 arm silently destroyed on the next load; "instantly ready AND
  loadable" is impossible under the strict arm, admitting zero concedes nothing
  to a blob editor (duration 1 was always equally instantly ready), and
  farmGrowthStage/the projection already read zero-length windows as ready.
  Migration-safety reviewed the rollback residual (an OLD loader still drops
  duration-0 rows) and ACCEPTED it dev-only with no DEPLOY.md note: no
  production minter exists until Phase 9. The farmgrow clock also floors at 1
  now (the write-side anchor rule's third statement), and the crop catalog
  pins every durationMs as a positive integer under FARM_MAX_GROW_MS, the
  guard the admission removed for mis-authored crops. (v) harvestCrop
  deliberately performs NO deliberate-action trio (no breakStealth, no
  standUp, no forceDismount), unlike plantCrop and every gather/fish cast:
  the harvest is the instant second visit of the two a cycle ever gets, a
  per-bed dismount or reveal would tax exactly the walk-the-row pattern the
  anti-chore thesis protects, and personal plots are uncontested so neither
  state buys anything against another player. Pinned ("keeps stealth, the
  seat and the mount" in tests/professions_farming.test.ts); flipping it is a
  one-trio change plus that pin.
  Phase 4: (w) the affinity census's CONSUMER_DEFERRED_MATERIALS list
  (tests/material_profession_affinity.test.ts) is REPLACED by a structural
  farming exemption derived from FARM_MATERIAL_ITEM_IDS, not shrunk by one id
  as the packet expected: the list's self-clearing arm keyed on RECIPE
  consumers (craftIdsForMaterialItem scans recipes and enchants only), so the
  command consumers that actually closed the loop (plant_crop for seeds and
  the watch fee, convert_husks for husks, the knobs for compost and the
  tonic) could never clear it mechanically, and compost/growth_tonic will
  NEVER gain a recipe consumer at all, which would have made their "deferred"
  entries a permanent lie. Every farming material is command-consumed by
  construction (holds for every crop the ladder phase adds), the consumption
  carries executed coverage in tests/professions_farming.test.ts, and the
  anti-abuse growth gate moved to the exact-set pin on FARM_MATERIAL_ITEM_IDS
  in tests/material_taxonomy.test.ts (smuggling an orphan into the exemption
  requires editing content, which that pin reds). A future recipe consumer
  (the Phase 6 dishes) needs no census edit: the id starts passing the census
  on its own terms. (x) the phase file's "compost adds 10 survival points ...
  caps at 100" is the shipped [0,1] probability scale times 100: the payload
  wires to the EXISTING FARM_SURVIVAL_COMPOST_BONUS / FARM_SURVIVAL_WATCH_BONUS
  constants (0.10 each, Math.min(1, ...)), never a second 0-100 scale; with
  the shipped constants no knob sum lands on exactly 1.0 except through the
  clamp or at the band top, and the boundary arms pin both. (y) the
  refusal-preserves-stealth/seat/mount arm re-armed at the TONIC gate (the new
  last gate in the stated order) so it keeps proving the trio sits below EVERY
  gate; the knob deny arms extended the precedence family (no_seed before
  no_compost before no_fee_produce before no_tonic) and added the
  check-then-pay atomicity proof (a passed compost gate spends nothing when
  the later tonic gate refuses).
  Phase 4 QA: (z) the parity-scenario knob coverage is DEFERRED to Phase 5:
  the farming_session golden stays untouched through this QA (the phase's
  own locked outcome, and the QA session's stopping rule forbids moving a
  pre-existing golden), so the knobbed plant, the toniced harvest, and
  convert_husks do not enter the cross-host draw-order digest yet; their
  draw contract is held by the single-host pins (the 8-combination count
  pin with identical (survivalRoll, yieldSeed) pairs, the live QA probes,
  and the same-seed determinism arm). Phase 5 (crop ladder) extends
  farming_session (or adds a farming_knobs scenario) with one knobbed
  plant, one toniced harvest on a winner seed, and one husk conversion,
  and re-records the golden deliberately in an isolated commit per D23;
  the handoff line in the Phase 5 gate list below is the tripwire.
  Phase 5: (z) CLOSED: farming_session gained the knobbed plant, the toniced
  harvest on a probed winner yieldSeed (the M8 lesson applied: winner probed,
  non-vacuity asserted in-arm), the husk conversion, and a tier-3 seed-back
  beat; golden re-recorded in its own isolated commit (md5
  29a11d98bda17f9c38bd8e9016df7fc7 to bf00c277b89e142446550f00c1035696), the
  coverage_c ledger re-pinned 4 to 9 draws. (aa) the R37 hub-stocking arm's
  landTools scan EXCLUDES farming exactly as it excludes fishing: the hub rule
  is about the rungs a zone's own NODES use and farming has no nodes (D2);
  garden_hoe stays vendor-PRICED (20) but dormant, and the farming ladder's
  own dormant-state arm pins the no-vendor truth positively until Phase 9
  flips stocking, the hub exclusion, and the dormant arm together (the go-live
  checklist line). The guide's priced-but-unstocked arm carries the same
  narrowing. (ab) the plant hoe gate (gate 12) rides
  canGatherTier(bestWieldableGatherToolTierOrNone(...), crop.tier) per the R22
  banner: the EFFECTIVE plant ladder is the frozen wield gates (tier 1/2/3/4
  hoes at farming 0/40/70/85) LAYERED OVER the crop skill thresholds
  (0/25/50/75, gate 7, which still fires first), exactly the land-profession
  shape; traversable because teaching ceilings run 50/75/100/100. The phase
  file's bare "riding canGatherTier" wording is superseded; deny reason
  'tool', ordered after the tonic gate, precedence pinned. (ac) the phase
  file's "a pin proves all three existing tool effects slot onto a hoe" was
  FALSE as written: the respawnSpeed kind arm refuses quickening_charm
  (display name Springback Charm) on EVERY profession and stays. The two live
  effects (gatherers_cache, artisans_eye) slot AND act at harvest rather than
  shipping mintable-but-inert (the fishing refusal's own doctrine): wired
  through applyToolEffectUse draw-free (quantity maps to flat bonus picks,
  quality to a maintainer-flagged fine-chance bump, auto-mode spends one
  charge per bonus-bearing harvest, prompt-mode skips whole since harvest_crop
  carries no confirm channel), pinned non-vacuously both directions. (ad) hoe
  recipes are their OWN HOE_RECIPES list per the rod precedent, never
  TOOL_RECIPES rows (that list's invariant consumes MATERIAL_GRADES fine
  grades and its length is pinned at 6): invariant, each rung consumes the
  fine twin of a crop one tier below plus the hoe one rung down
  (fine_vale_wheat/fine_marsh_rice/fine_highland_barley), rungs 2-4 are
  CRAFT-ONLY (the rod ladder's vendor arm is locked off by the
  rung-1-only-priced rule), engineering at the toolworks, pinned in
  tests/professions_hoe_recipes.test.ts. (ae) the tier 3/4 seed-back roll
  fires on BOTH outcomes (the withered consolation roll): one uniform
  contract clause per tier beats an outcome-forked draw count, and a died
  overnight crop returning a seed is anti-frustration, not economy (rates
  maintainer-flagged). In-phase: the blob byte model re-minted floor 13952 /
  ceiling 15360 (the doctrine's headroom rule; fixture now derives the widest
  crop id with a literal guard), and vale_wheat_seed gained buyValue 4 (the
  tier-1 seed row; the packet's Phase 3 pricing predated the seed-pricing
  table). (af) prompt-mode tool-effect slot mints are REFUSED for farming at
  resolveSlotToolEffect: harvest_crop carries no confirm channel (confirmed is
  hard false at the harvest apply site), so a prompt-mode farming slot could
  never fire, never spend, and never ratchet, a charm consumed into a dead
  slot; refusing at the mint closes the trap with no load-side arm needed (no
  farming slot predates the hoe phase). The harvest confirm channel, if ever
  wanted, is the Phase 7/8 farming-UI decision; pinned three ways (prompt
  farming refused, always farming mints, prompt mining mints). Review-round
  extras worth knowing at QA: the 'tool' deny toast names the required tier
  via hudChrome.gathering.tierRequired.farming through the farmDeniedToast
  pure core (the sinkless requiresTool.farming key was deleted with its
  fills); the reworded howToSlot line carries corrected fills in ALL 18
  overlays (a stale Latin fill is invisible to both gate tiers, the class to
  sweep on every reword); and the gather_tool_tooltip tripwire (the SECOND
  self-clearing farming tripwire, missed by the phase's own suite lists) is
  flipped with the no-Use-prefix exception pinned.
  Phase 5 QA: (ag) farmHarvested carries the last-charge signal
  effectDepleted (the gatherResult shape reused whole: only-when-true
  optional, spent-guarded durability read, the shared
  hudChrome.professions.toolEffectDepleted self-note in the hud arm). ONLY
  farmHarvested can carry it, because the withered return sits above the
  effect block, so a failed crop never applies, spends, or depletes (pinned
  by the withered crossed arm: charge and ceiling both untouched). Farming
  was otherwise the one profession whose live tool effects broke silently.
  The farming_session golden was untouched (no scenario beat arms an
  effect; md5 re-verified byte-identical). (ah) the professions window
  suppresses the R40 "Ask each use" toggle on the farming row through
  promptSlotRefused (src/sim/professions/tools.ts), the SAME predicate the
  mint's refusal arm reads, so the two surfaces cannot drift: before this,
  ticking the farming toggle emptied the row's slottable set (every prompt
  mint is refused) and erased the whole actions row, toggle included, until
  the window reopened. The Phase 7/8 change that lands a harvest confirm
  channel edits the predicate and the resolver arm together; the layout pin
  (farming buttons without toggle, mining control arm) moves with it.
  Phase 6: (ai) the growth tonic recipe is CRAFTABLE from wild herbs before
  go-live, against the phase file's blanket "every new recipe has at least one
  reagent unobtainable until go-live" note: D7 locks the tonic to herbs (the
  cross-profession trade), herbs are wild-gathered today, and the D-decision
  wins. The enforced dormancy pins are the vendor-goods-alone pair in
  tests/professions_zone_rollout.test.ts (every FARM_RECIPES row keeps one
  reagent no NPC stocks AND one with no buyValue; for the tonic both are
  silverleaf_herb), and the tonic's real pre-go-live dormancy is economic: its
  only sink is the plant-time knob and seeds have no faucet until Phase 9.
  Crafting it early is a strict gold loss (output 6 under input 20), so no
  exploit window opens. The dishes keep the stronger property (farm produce
  nobody can grow); the arm asserts unstocked-ness, never uncraftability.
  (aj) all nine FARM_RECIPES rows are TRAINABLE in the live game before
  go-live, deliberately: the binding Live-surface note wants the recipes
  visible in the crafting window while the farm is dormant, trainer
  acquisition is the only mechanism that puts a recipe there, and train_view
  walks ALL_RECIPES with no availability gate. The architecture review
  surfaced it as a rollout-policy call; ruled the garden_hoe
  priced-but-dormant precedent (deviation (aa)) extended to recipes, pinned
  through resolveTrain in tests/farm_recipes.test.ts (rung-0 rows resolve ok
  and FREE per the settled R8 fee curve's tier-0 point, the rung-50 platter
  resolves ok charging 10000) so a future availability gate cannot land
  silently. Maintainer flag rides the FARM_RECIPES header.
  (ak) the crafted-tooltip provenance partition (tests/item_instance_tooltip
  .test.ts, "every crafted recipe output resolves to a crafted-kind def")
  gained its ONE sanctioned exception: growth_tonic is a crafted output that
  stays kind junk by doctrine (the knob-consumed, Sell-Junk-vendorable
  choice). The exception cannot mis-word a tooltip because no signed instance
  of the tonic can exist: common quality sits below the rare signing floor
  and masterwork needs slot+stats the def lacks; BOTH facts are pinned
  beside the exception so it self-invalidates if either moves.
  (al) TWO release art-program suites (new in the tenth absorb) collide
  structurally with any feature branch that adds items or sim content, and
  were healed in-branch with the guards extended, never gutted; maintainer
  read owed on both: (1) scripts/item_art_audit.mjs demanded committed art
  for every live ItemDef; it now honors ITEM_ART_PENDING as declared
  procedural debt (policed both directions: a pending id must be a live def
  with NO shipping webp), expected liveItemCount is 831 + the pending size,
  and the fresh-checkout literals (catalog sha, renderer fingerprint,
  liveItemCount 870) are re-minted in tests/item_art_audit_builder.test.ts
  with a fixture arm pinning all three exemption directions. (2) the mob
  portrait manifest's rendererFingerprint hashes the stills esbuild bundle
  whose import graph reaches sim content (probed: items, profession_items,
  professions, recipes, types are all inputs), so ANY sim content commit
  stales it with zero pixel impact; the guard gained a fingerprint-only
  refresh path (every row byte-identical AND the row set unchanged writes
  receipt-free; any row drift still demands the rendered receipt, pinned in
  a new test arm), and the committed manifest was re-minted through the real
  CLI (3 lines: fingerprint + bundle digest). ABSORB CHECKLIST ADDITION:
  after every future release absorb (and any farming phase touching sim
  content), run node scripts/build_mob_portrait_source_manifest.mjs --write
  (fingerprint-only re-mint) and node scripts/item_art_audit.mjs
  --verify-only, and expect a one-field conflict in the portrait manifest
  whenever the release also re-minted it: resolve by re-running the CLI on
  the merged tree, never by hand-picking a side.
  Two review-round residuals ledgered, not fixed: the closure arm derives
  recipe consumers from the whole merged ALL_RECIPES, so an unrelated future
  recipe could keep a farming material green after its farm-side demand
  disappeared (the literal twin-to-dish map bounds the five that matter); and
  the phase is content-only at the file level but not the behavior level:
  craftIdsForMaterialItem and the taxonomy now map farm produce to cooking,
  whose consumers are all UI (hint lines, bag/bank filters), none tick-side
  or wire-side, so determinism is untouched.
- Dev command surface: Phase 3 registers /dev farmgrow [bedId] (alias
  /devfarmgrow [bedId]) in src/sim/dev_commands.ts behind ALLOW_DEV_COMMANDS:
  with a bed id it advances that plot, without one it advances ALL of the
  caller's plots; it sets readyAtMs to ctx.lockoutNowMs() only (plantedAtMs and
  the hidden slots untouched, so it is not a reroll primitive), leaves
  already-settled plots alone, counts only work actually done in its [dev]
  summary, and draws nothing (pinned). /dev gather farming N already works
  (Phase 1). The /dev GUI row (src/ui/dev_command_view.ts) is a Phase 7
  deferral. Phases 7 and 8 depend on these for dev-created crops.
- Growth-phase (Phase 3) handoff from the Phase 2 review round, decide these ON
  PURPOSE rather than inherit them. PHASE 3 RESOLUTION (2026-08-08), each item
  below marked here rather than rewritten in place: anchor semantics DONE in
  a8560344a2 (one-rule max(nowMs, 1) re-anchor pinned on BOTH load paths;
  non-finite clocks SKIP the re-anchor entirely per the migration review; the
  WRITE side floors its anchor at 1, the pair discovered in review); hidden-slot
  clamps DONE in a8560344a2 (survivalRoll [0,1), yieldSeed uint32, absent slots
  derive via FNV-1a over bedId:plantedAtMs, clamp-CHANGED slots feed the
  operator warn, the derivation comment states the accidental-loss guarantee
  honestly); plant-time bed-id validation DONE in a8560344a2 with the refusal
  pinned; the runtime size signal DONE in 5e0e9ab766 (CHARACTER_BLOB_WARN_BYTES
  131072 measured not guessed, warn-only, rate-limited, attempt-worded, at the
  characterUpdateStatement chokepoint all three save paths share; the
  disposable-PG TOAST/WAL measurement recipe was NOT run this phase, deferred
  to Phase 3 QA if the db reviewer demands it); the per-tick fplot emit
  RESOLVED in 5e0e9ab766 (moved behind the heavy-self gate, see the wire-keys
  ledger); the deploy-order constraint CARRIED into DEPLOY.md in the docs
  commit; the derived-duration msRemaining field STAYS DEFERRED to the first
  timer UI (Phase 8; this phase ships no UI, the clock-base contract comment
  remains the guard); admin visibility UNCHANGED (no farm section was added to
  the inspector; the field-pick rule stands for whoever adds one); the
  crop-table client-shipping check HOLDS (FARM_CROPS ships durationMs and tier,
  both derivable from public wire state; the pre-rolls stay the only secret);
  iteration order, read-identity asymmetry, and spectator notes all HELD
  (nothing regressed them; the parity scenario and suites pin the first two).
  - The anchor semantics family: the farm_persist nowMs > 0 guard means an offline
    load at sim.time 0 keeps saved anchors while a post-tick load re-anchors (two
    offline load paths disagree), and offline growth restarts inflated rather than
    continuing through logout; the reviewers' concrete direction is re-anchor to
    max(nowMs, 1) or an epoch-based offline clock, pinned by BOTH a fresh-Sim load
    and a post-tick load. The mirror hazard (an absurdly PAST anchor loading on a
    wall-clock host reads instantly ready) needs no code now: since Phase 2 QA the
    scan pin in tests/professions_farming_state.test.ts holds the CLOCK-BASE
    premise directly (every serializeCharacter caller lives in server/ AND injects
    lockoutNowMs; the three scratch-sim builders, creation / PBE boost / community
    templates, were fixed to pass () => Date.now() after passing the old
    directory-only scan on the sim-clock default), and a save editor can craft
    instant-ready with legit-looking values anyway, so an epoch floor buys no
    anti-tamper value.
  - The derived-duration wire field (RaidLockout msRemaining template) lands with
    the first timer UI; until then the clock-base contract comment in
    src/world_api/farming.ts is the only guard.
  - Absent/corrupt hidden slots: prefer DERIVING a replacement deterministically
    (bed id plus plantedAtMs) over re-rolling at harvest, so a dropped slot is not
    a reroll primitive. Since Phase 2 QA a dropped slot is visible to operators
    (countDroppedHiddenSlots feeds the load warn; the row count alone could not
    see a surviving row lose a slot).
  - HARD GATE from the privacy review: clamp survivalRoll into its real interval
    and yieldSeed to a bounded integer IN THE SAME CHANGE that gives the slots
    meaning; today they pass the load on a bare finite() check while every
    neighbouring field has an allowlist, a positivity check, a ceiling, or a
    coercion, which is fine only while their value domain does not exist.
  - Iteration order is now guaranteed: normalizeFarmPlots inserts in sorted bed
    order (Phase 2 QA), so per-tick iteration over meta.farmPlots can draw rng
    without the stream position depending on JSONB key order. Do not regress this
    with an unsorted bulk insert.
  - Read-identity asymmetry at the seam: Sim.farmPlotsFor allocates a fresh array
    per NON-EMPTY read (the empty arms return the shared frozen
    EMPTY_FARM_PLOT_VIEWS since Phase 2 QA) while ClientWorld.myFarmPlots keeps
    one array until the next fplot delta; the first UI consumer must not memoize
    by reference or === -diff rows across reads.
  - Admin visibility: serializeCharacter snapshots (server/admin.ts character
    inspection) will expose filled survivalRoll/yieldSeed to operators; decide
    whether that is acceptable when the slots go live. The R35 professions
    inspector shapes output through characterProfessionsSheet's explicit field
    picks and never touches state.farmPlots today; a farm section added there
    must field-pick the way the wire projection does, never dump the record.
  - The crop content table ships to the browser (src/net/online.ts imports
    farm_patches.ts): patch/bed geography and ids are safe, and published
    per-crop base rates would be too, but the moment a rate column lands in
    that table re-check what a client can compute (the per-plot pre-roll stays
    the only real secret).
  - Deploy-order constraint (mixed fleet): an old server process autosaves the
    whole blob WITHOUT farmPlots, so this build must be fully rolled out before
    any build that can PLANT ships; a rollback past this phase after plants exist
    destroys plot state on the next autosave. Carry this into DEPLOY.md in the
    phase that makes plots plantable; it lives only here until then.
  - The per-tick fplot emit stringifies every planted player's rows at 20 Hz
    (tslot-consistent, bounded at 23 beds); revisit if rows grow.
  - Stored-data growth at fleet scale (the database-performance row, recorded
    at Phase 2 QA; the reviewer corrected the first estimate's conflation):
    a fully planted character adds 4,451 bytes of JSONB to characters.state
    (23 beds at about 193.5 bytes; blob ceiling re-minted 14336). STORAGE is
    one-time: about 44.5 MB per 10k fully planted characters. WRITE volume
    scales with CONCURRENT ONLINE, not the table: the 30 s autosave sweep
    (AUTOSAVE_SECONDS, server/game.ts) writes only online sessions, so the
    worst case is about 4.45 MB per sweep at the R36 1,000-concurrent target
    (about 148 KB/s logical). Today's real number is ZERO: no writer exists.
    Postgres rewrites the whole TOAST value on any change, so once plants
    exist the delta rides every autosave of a planted character; pglz should
    compress the 23 near-identical rows well below the uncompressed figure
    (inferred, not measured).
  - TWO MORE HARD GATES from the database review, landing WITH the plant
    writer (Phase 3): (1) validate the bed id against FARM_BED_IDS at plant
    time and pin the refusal; the load-side allowlist is the ONLY 23-row
    bound and it cannot catch a live writer bug before the blob grows.
    (2) a runtime size signal on the serialized character state
    (JSON.stringify(cleanState).length already exists at
    server/db.ts saveCharacterState; guild-bank books have a measured skip
    bound and warn, the character blob has none). Sizing measurement recipe,
    DISPOSABLE local PG16 only: pg_column_size(state) with and without the
    13,948-byte worst-case blob for the compressed delta, then
    pg_current_wal_lsn() movement across about 100 repeated UPDATEs of each
    shape for per-save WAL amplification.
  - Spectator sessions mirror the spectated player's plots into myFarmPlots (the
    whole self block does this); do not hang plant/harvest UI off it while
    spectating.
  - Stale beds-arrive-later comments to sweep when farming's guide content lands:
    scripts/wiki/build_content.mjs:773 and src/guide/pages/professions_gathering.ts
    header prose (release-side files, deliberately untouched this phase), PLUS the
    two PLAYER-VISIBLE guide prose keys (Phase 3 QA addition, the qa-checklist
    catch): guide.profPages.gatherIntro.farming ("Its beds, seeds, and tools arrive
    in a later patch...") and guide.profPages.gatherDeeds.farming ("its beds are
    still to come") in src/ui/i18n.catalog/guide.ts, which otherwise keep telling
    players in every locale that farming has not shipped while they are planting.

- Phase 3 QA addenda (2026-08-08), carried for later phases:
  - The disposable-PG TOAST/WAL measurement is DEFERRED to Phase 9 (go-live) as a
    HARD gate there, by the database-performance reviewer's explicit ruling this
    QA: the phase's whole functional DB delta is the warn-only blob-size call at
    the characterUpdateStatement chokepoint, farming is dormant online (no seed
    faucet), and the blob ceiling suite already bounds the serialized size.
  - Blob byte model re-measured this QA: settled 13,994 bytes (about 196 per bed),
    342 under the 14336 ceiling; pins stand; the Phase 5 crop ladder re-measures.
  - Phase 9 hardening notes from the second review round, deliberate deferrals:
    (1) farmDenied echoes the raw length-unbounded bed/crop strings back to the
    actor (pid-scoped, ws maxPayload 16 KiB + rate limits bound it, the HUD
    renders only the reason enum; bound the string length at dispatch or drop the
    ids from the bad_bed arm if go-live load review wants the allocation closed).
    (2) plant_crop/harvest_crop mark HEAVY_SELF on receipt, so a spammed refusal
    buys a heavy self re-serialize whose fplot arm is O(authored beds); confirm
    the command rate limiter bounds refusal spam at go-live, or mark on success
    only (farmPlanted membership plus the wireRev bump already cover success).
  - Admin exposure VERIFIED clean this QA: both R35 inspector route arms shape
    the raw adminCharacterState snapshot through characterProfessionsSheetFromRow
    (explicit field picks, no farmPlots today), so the hidden slots never leave
    the server over HTTP; the field-pick rule stands for whoever adds a farm
    section. Work orders verified N/A: the commission modules carry zero
    gathering-profession references, so no farming order can mint before the
    phase that wires crops in deliberately.
  - EXECUTED in Phase 4 (commit 122dd3de56; this line predates it): the
    farming_view.ts extraction fired, moving farmDeniedLineKey plus FOUR farm
    grant-line selectors (farmHarvestLineKey, farmFineLineKey,
    farmWitheredLineKey, farmPlantedTokenId; the original count of three was
    an undercount), moves not re-exports, with the test blocks relocated to
    tests/farming_view.test.ts. See the Phase 4 entry in progress.md.
  - The command-level 'skill' deny emit is unreachable until a tier-2 crop ships;
    the Phase 5 crop ladder inherits driving it (one plant below a real
    threshold) deliberately.
  - farmGrowthStage now takes the structural minimum (plantedAtMs/readyAtMs pick)
    and documents the clock-base contract in its banner; the msRemaining wire
    field stays owed to Phase 8 (the first timer surface).

- Phase 4 QA addenda (2026-08-08), carried for later phases:
  - THE TONIC CONTRACT, ledgered here because the next session reads this
    file first (it previously lived only in the farming.ts banner and the
    progress.md notes): the tonic bonus roll is SEED-ANCHORED, one value
    from mulberry32((yieldSeed ^ 0x9e3779b9) >>> 0), never a read past the
    lives loop, so the tonic outcome is a plant-time constant and a
    skill-up can only add picks (the 200-seed monotonicity sweep pins it,
    and the review round measured about 5.8k win-to-loss flips per million
    adjacent skill steps under the loop-relative form). ANY future pre-roll
    expansion (Phase 5 crops, Phase 8 UI previews, new knobs) that anchors
    an auxiliary roll to a skill-varying loop position is a regression,
    not a cleanup.
  - The QA killed three surviving mutants by making their pins real: the
    two end-to-end tonic arms ran on a losing seed (41) and now run on the
    probed winner TONIC_WIN_SEED with non-vacuity guards; the fee-module
    ordering/exclusion/dedupe promises were unfalsifiable against the
    one-crop catalog and now drive an injectable synthetic ladder; the fee
    legs gained their own check-then-pay atomicity arm (the compost arm
    alone could not see a fee spent at its gate).
  - The seed/produce disjointness pin in tests/farm_watch_fee.test.ts
    walks the LIVE catalog: a Phase 5 crop whose seedItemId aliases any
    produce id reds there (the fee plan is made before payments run, so an
    aliased row would double-count one stack and under-collect silently).
  - Accepted as-is, deliberately: FARM_SUPPLY_ITEM_IDS stays exported with
    no external consumer yet (the Phase 9 farmer-NPC vendor stock is its
    intended reader); the growth_tonic icon shares the 'sparkle' overlay
    with the fine-grade family (glyph-semantics note for the Phase 13 art
    batch); the knob deny lines stay full English prose rather than
    spliced name tokens, with the rename-drift pin in
    tests/farming_view.test.ts as the tie; the roughly 120 pending Latin
    locale rows ride to the release-time fill as usual; no HUD affordance
    teaches the knobs or the husk trade until Phases 7 and 8 (the deny
    toasts are the fallback surface, per the phase's own deferral).
  - The four deliberate no-action calls from the phase notes were
    re-judged and ALL UPHELD (refusal-spam re-serialize, offline forged
    knob flags, the deviation (w) auto-exemption with the exact-set pin as
    its gate, the Materials chip classifying two dormant faucet-free
    items).

- Phase 5 QA addenda (2026-08-09), carried for later phases:
  - TWO REAL COVERAGE HOLES closed test-only: the R47 ratchet line in
    harvestCrop and the R42 spend predicate's FALSE branch were both
    deletable or invertible with every suite green. The false-branch pin
    uses the INVERTED probe (sweep for a seed where the armed expansion
    changes NOTHING, then demand the charge survives while the ratchet
    still latches); keep that idiom for any spend-only-when-it-mattered
    settle a later phase adds.
  - The ratchet's rarity read is the UNFILTERED ownership scan ON PURPOSE,
    confirmed against the node settle (gathering.ts) and the R30 recharge
    read: the latch only prices a slot UP, so an unwieldable carried hoe is
    the anti-gaming case, not a scan bug. Stated at the call site now; do
    not "fix" it to the wield-filtered scan.
  - EXCLUSION SETS NEED PINS, the M3 lesson: the R37 hub arm's farming skip
    survived being widened to mining (nothing red). The arm now collects
    hubSkipped/hubAsserted sets and pins both directions, and the
    delve-shop farming skip gained the inverted no-Marks-row-today
    tripwire. Any future census exclusion ships WITH its set pin.
  - The mint-side farming+prompt gate deliberately has NO load-side twin,
    the decision RECORDED here after three lanes converged: every
    confirmMode writer routes through resolveSlotToolEffect (the slot
    actions both call it; the admin restore body carries no confirmMode
    field), so no legal path mints a farming prompt row; a hand-edited
    offline blob row loads as a dead prompt slot (skip-whole, charge kept,
    mode chip visible), which is the fail-safe direction. Revisit ONLY if a
    new re-mint or import path lands.
  - Fine-twin buyValue doctrine, flagged for the maintainer with the other
    economy constants: ALL EIGHT fine twins price buyValue at 4x their own
    sell (the node fine-material convention fine_vale_wheat set in Phase
    3), while tier 3/4 seeds and non-carrot produce carry none under the
    no-vendor-faucet rationale. Both rules are individually stated; their
    intersection (a priced tier-4 fine twin above an unpriced tier-4 seed)
    is a doctrine question nothing enforces either way today because
    nothing stocks any of the 31 ids until Phase 9.
  - Screenshot drift, program-wide: Phases 2 through 4 shipped no captures
    (sim-only surfaces); Phase 5 QA added the bag-grid capture of the 31
    stand-in icons on the LOW preset under docs/screenshots/farming-phase-05
    (desktop; the mobile offline boot flow resisted the harness and the
    icons are viewport-identical assets, deferred). The obligation
    re-anchors hard at Phase 7 (the first world-visible surface) and every
    later visual phase.
  - Mutation battery: 4 of 5 mutants killed as shipped with named reds
    (gate-12 bare-hands swap, dropped charge spend, outcome-forked
    seed-back, dropped silent flag on the seed-back grant); the exclusion
    widen survived and its pin now kills it (re-proven). The commit-first
    rule was struck a FOURTH time this program: a re-probe's checkout
    revert wiped the uncommitted pin it was proving; the battery's fix
    landed in its own commit before any further probe.

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
- Phase 6 proposed values awaiting sign-off: the eight dish foodHp/sellValue
  assignments (each reuses a shipped curve point; flagged at their rows in
  profession_items.ts), the dish reagent counts, the tonic recipe (silverleaf x2 +
  glass_vial x1 at skillReq 0; rationale at the row: the tonic is a plant-time knob
  for every tier and is never vendor-stocked, so the accessible trainer rung is its
  only faucet), and whether fine_marsh_rice / fine_highland_barley should ALSO gain
  dish consumers: the Phase 5 deferred literal named exactly five twins, so the
  closure left those two hoe-reagent-only (documented honestly at their items.ts
  rows; adding dishes for them is a content decision, not a gap in the closure pin).
