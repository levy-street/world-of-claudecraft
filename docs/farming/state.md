# Farming: cross-phase state (the cheat sheet)

Read this file first in every phase session. It is the single authority for locked
decisions. If a phase file contradicts this file, this file wins and the phase file
gets swept in the same pass (amend the QA twin too, always).

Current phase: Phase 1 done, QA passed 2026-08-08 (PASS-WITH-FOLLOWUPS); Phase 2
next. Packet authored 2026-08-07 off release/v0.36.0; the branch has absorbed
release/v0.36.0 through 6ed4d7e12c (second absorb 2026-08-08, release-merge-audit
clean, parity re-proven byte-identical on the merged HEAD).
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

- New IWorld members: Phase 2: farmPatches (data) and myFarmPlots (data) on the new
  IWorldFarming facet (src/world_api/farming.ts); parity pins moved 302 to 304
  members, 77 to 79 data, 32 to 33 facets. RE-RUN tests/world_api_parity.test.ts and
  tests/snapshots.test.ts after EVERY release absorb into this branch: identical
  count-pin bumps on both sides auto-merge to a wrong total with no textual conflict
  (the char-sheet playtime precedent).
- New SimEvents: (none yet; Phase 2 deliberately adds none, and NO plot state may
  ever ride an event payload: the parity omit-defaults shield does not cover event
  digests)
- New wire keys: Phase 2: fplot (the self delta mirroring myFarmPlots; tslot-shaped
  emit with the pre-serialized empty arm; registered in ALL_DELTA_KEYS and
  TERSE_TO_IWORLD, count pin 67 to 68). The projection NEVER carries
  PlotState.survivalRoll or yieldSeed; the negative leak pin in tests/snapshots.test.ts
  drives the real selfWireJson broadcast with an exhaustive nine-key set assertion.
- New i18n keys and matcher rows: Phase 1 added, all English-only catalog rows with
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
- New items/recipes/deeds: (none yet; Phase 1 deliberately adds none)
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
  patch-site anchor. (j) FARMING_ZONES is farming's OWN tier column, deliberately
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
  deferred to the growth phase, which owns the first timer surface. (m) Four code
  commits, not five: the parity regen was proven a byte-identical no-op again (the
  (b) precedent), so no goldens commit exists.
- Dev command surface: (Phase 3 records the exact /dev farm cheat names here at
  completion; Phases 7 and 8 depend on them for dev-created crops)
- Growth-phase (Phase 3) handoff from the Phase 2 review round, decide these ON
  PURPOSE rather than inherit them:
  - The anchor semantics family: the farm_persist nowMs > 0 guard means an offline
    load at sim.time 0 keeps saved anchors while a post-tick load re-anchors (two
    offline load paths disagree), and offline growth restarts inflated rather than
    continuing through logout; the reviewers' concrete direction is re-anchor to
    max(nowMs, 1) or an epoch-based offline clock, pinned by BOTH a fresh-Sim load
    and a post-tick load. The mirror hazard (an absurdly PAST anchor loading on a
    wall-clock host reads instantly ready) needs no code now: the scan pin in
    tests/professions_farming_state.test.ts holds the no-caller-outside-server
    premise, and a save editor can craft instant-ready with legit-looking values
    anyway, so an epoch floor buys no anti-tamper value.
  - The derived-duration wire field (RaidLockout msRemaining template) lands with
    the first timer UI; until then the clock-base contract comment in
    src/world_api/farming.ts is the only guard.
  - Absent/corrupt hidden slots: prefer DERIVING a replacement deterministically
    (bed id plus plantedAtMs) over re-rolling at harvest, so a dropped slot is not
    a reroll primitive.
  - Admin visibility: serializeCharacter snapshots (server/admin.ts character
    inspection) will expose filled survivalRoll/yieldSeed to operators; decide
    whether that is acceptable when the slots go live.
  - Deploy-order constraint (mixed fleet): an old server process autosaves the
    whole blob WITHOUT farmPlots, so this build must be fully rolled out before
    any build that can PLANT ships; a rollback past this phase after plants exist
    destroys plot state on the next autosave.
  - The per-tick fplot emit stringifies every planted player's rows at 20 Hz
    (tslot-consistent, bounded at 23 beds); revisit if rows grow.
  - Spectator sessions mirror the spectated player's plots into myFarmPlots (the
    whole self block does this); do not hang plant/harvest UI off it while
    spectating.
  - Stale beds-arrive-later comments to sweep when farming's guide content lands:
    scripts/wiki/build_content.mjs:773 and src/guide/pages/professions_gathering.ts
    header prose (release-side files, deliberately untouched this phase).

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
