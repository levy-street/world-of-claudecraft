import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The line-count RATCHET for the repo's known monolith files. Module-first is the
// doctrine (root CLAUDE.md, Modularity): new logic lands as its own sibling module
// behind an existing seam, and the coordinator files below must never GROW. Between
// v0.30.0 and v0.36.0 every sanctioned coordinator grew anyway and several new
// monoliths formed, so the doctrine gets a deterministic gate: each named file has a
// ceiling a little above its size when this gate landed. Exceeding the ceiling fails
// the suite.
//
// How to respond to a failure here:
// - The fix is EXTRACTION, not raising the ceiling: move the new logic into a sibling
//   module behind the file's seam (listed per row below; recipe in the
//   extract-and-test skill, .claude/skills/extract-and-test/) and import it.
// - After a real extraction shrinks a file, LOWER its ceiling to the new size plus a
//   small margin in the same change; the ratchet only works if it tightens.
// - Raising a ceiling is a maintainer decision: do it only when a change genuinely
//   cannot land behind a seam, keep the raise small, and justify it in the PR body.
// - A missing file usually means it was split or renamed: update or remove its row in
//   the same change so the gate tracks the real tree.
//
// Data-as-code is exempt by design (src/sim/content/, the i18n catalogs and matcher
// DICTs, generated artifacts): those tables are correctly large. This gate names only
// LOGIC files.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

interface MonolithRow {
  file: string;
  ceiling: number;
  seam: string;
}

// Ceilings set 2026-08-10 at roughly current size + 200 lines of headroom.
const MONOLITHS: MonolithRow[] = [
  {
    // The Exchange window, ratcheted at its exact size with ZERO headroom the
    // moment it became the largest unpinned UI module (2201 -> 2623 lines
    // across the polish pass: markup, copy and six small private helpers, none
    // of it added to a coordinator). It is its own module, so the prime
    // directive was never broken, but nothing stopped it growing either. The
    // next line added here fails, and the fix is a sibling module behind the
    // window's own seam (a pure view-core plus this thin consumer, the
    // unit_portrait recipe), never a raise.
    // Re-pinned DOWN from 2623 in the same change that set it: the status
    // chrome (spinner, loading line, error line, the exact end time a countdown
    // cell carries) moved to src/ui/woc_market_chrome.ts, which is the seam
    // named below. The ratchet only works if it tightens after an extraction.
    // Down 2621 -> 2618 when the browse control row followed the chrome out
    // (the 15 sign-off round: sort leads the row), paying for the price
    // cells' token-equivalence tooltips with room to spare.
    // Down 2618 -> 2614 when the recent-sales list and the empty-sell caption
    // followed (wocSalesHistoryHtml / wocSellEmptyHtml), paying for the
    // resolved bond disclosures and the select-scroll command.
    // Down 2614 -> 2612 at the Exchange UX round: the banners, the foot, the
    // bid disclosures well and the buy-now face followed the chrome out
    // (wocMarketBannersHtml / wocMarketFootHtml / wocBidDisclosuresHtml /
    // wocBuyNowHtml), paying for the collapsed Bid terms toggle and the
    // banner's connect shortcut. This also cleared the 36 lines the file had
    // drifted over its own ceiling before this round.
    // Down 2612 -> 2438 at the second Exchange UX round: the whole My
    // Activities tab moved verbatim to src/ui/woc_market_activity_html.ts and
    // the quote face to the chrome (wocQuoteFaceHtml), paying for the Browse
    // filters, the seller click-through pane, and the hot-path review's
    // poll-skip and click-dedupe guards, with room to spare.
    // Up 2438 -> 2487 at the third round (a maintainer-requested feature
    // pair): the category/subcategory filter axes and the seller pane's
    // profile line, whose markup all landed in the chrome builders; the
    // window carries only state, handler arms and passthroughs. Exact
    // count, zero headroom; the sell-tab combobox block is the next
    // standing extraction candidate.
    file: 'src/ui/woc_market_window.ts',
    ceiling: 2487,
    seam: 'a pure view-core module beside it (src/ui/woc_market_view.ts) that this window renders from',
  },
  {
    // Deliberately ZERO headroom (the woc marketplace baseline ratchet): the
    // next line added here fails, and the fix is extraction behind the seam,
    // never a raise. A raise stays a maintainer decision, per the header.
    // Re-pinned down from 19338 after the error-text matcher moved out to
    // src/ui/error_text_i18n_core.ts, then from 19190 after the craft-deny
    // message table moved to src/ui/crafting_deny_core.ts (the v0.37.0 sync
    // merge had pushed the file over), keeping the zero-headroom posture.
    // Re-pinned from 19177 after the v0.38.0 sync merge: the release's map
    // overhaul extracted marker interaction out of the coordinator, so the
    // merged file landed SMALLER and the ratchet follows it down.
    file: 'src/ui/hud.ts',
    // Re-pinned to the exact merged count after reconciling the OSSBrain
    // v0.40 batch with the current release branch. The merged file is smaller
    // than both parent pins, so the ratchet follows it down with zero slack.
    ceiling: 18694,
    seam: 'pure view core + thin painter on PainterHost (src/ui/CLAUDE.md)',
  },
  {
    file: 'src/render/renderer.ts',
    // Lowered after extracting the fire-light adopter, the budget pass, the
    // stranded-light reparent and the registry prune into
    // src/render/fire_light_registry.ts (the ratchet's own rule: an extraction
    // lowers the ceiling, never raises it).
    // Lowered again after extracting the secondary-context preview warming
    // policy into src/render/preview_prewarm_lane.ts. Earlier steps down: the
    // per-status manifest rollup to summarizePrewarmManifest
    // (prewarm_compile_lifecycle.ts, beside the interface it fills) and the
    // resume-lane bookkeeping to prewarm_resume_ledger_core.ts.
    // Raised for the desktop-client-update packet (thin-consumer wiring to the
    // extracted modules: frame_present, dpr_watch, static_matrix, shadow cadence
    // hookup), then lowered by that branch's rig_visibility_freeze.ts extraction.
    // Merging release/v0.38.0 again: upstream lowered its own pin twice more
    // (zone_prewarm_templates_core.ts, the buildFormVisual fold), and the merged
    // file lands between the two pins, so the ceiling is the exact merged count
    // per the ratchet's rule: any further growth reds again.
    // Lowered again after extracting the delve interior build-cache scheduling
    // (the position-keyed rebuild/retire decision plus the async build loop)
    // into src/render/delve_interior_tracker.ts.
    // Extracted the shadow-depth material factory into
    // src/render/prewarm_depth_material.ts so the self-spirit prewarm could add
    // Renderer.warmSelfSpirit + the per-frame observe without growing the file.
    // Merging the delve tracker and prewarm work plus the release-owned
    // weapon-skin identity repair leaves renderer.ts at the exact count below;
    // any further growth reds again.
    // Raised +38 for the vfx.mount-programs manifest entry (#2571: mounts had
    // ZERO prewarm coverage, so the first sighting of any mount could freeze a
    // live frame, worse on hardware without KHR_parallel_shader_compile where
    // the runtime fallback gate is a no-op). The rig-building logic itself was
    // extracted to src/render/mount_prewarm.ts; this was the coordinator's
    // unavoidable thin-wiring cost (the manifest entry, its group bookkeeping,
    // and cleanup/hide registration).
    // Raised a further +34 (13792 -> 13826) in review response: the group-
    // staging/scene-bookkeeping logic that first cut left inline here (and
    // that inline copy is what hid the bug, an `Object3D.add` reparent that
    // silently detached every staged rig from its group) moved into
    // mount_prewarm.ts's stageMountPrewarmVisual too, but run() also grew
    // real synchronous-desktop-path work plus an honest progress() (the
    // entry's run() was previously a no-op that still reported 'completed'),
    // and resumeUnits now links the shadow-depth program half it was missing.
    // What remains is the manifest entry itself, the shared
    // mountPrewarmGroup/mountPrewarmWarmed variables, and cleanup/hide
    // registration: exactly the seam this ratchet exists to bound, not grow
    // unchecked.
    // Merging PR #3447 onto the corrected PR #3446 v0.39 wrapper leaves the
    // renderer below this bound; any further growth reds again.
    // Lowered again by the castle branch's interior_light_rig.ts extraction;
    // after merging main the merged file lands below both prior pins, so the
    // ceiling is the exact merged count.
    // Merging approved PRs #3425 and #3447 into the moved-base v0.39 wrapper
    // keeps the delve tracker and mount prewarm extractions while preserving
    // the wrapper's later renderer wiring, so the ceiling is the exact
    // resolved count.
    // PR #3468 changes the shadow-depth prewarm material contract, but this
    // wrapper's combined renderer remains at the same resolved count.
    // Lowered again on the integration branch, which combines three extractions
    // out of the renderer: the shadow-depth prewarm material factory
    // (src/render/prewarm_depth_material.ts, PR #3468), the character-visual
    // pool take/store halves (src/render/characters/pooled_visual_lifecycle.ts,
    // PR #3473) and the material texture-slot walk
    // (src/render/material_texture_slots.ts, the streamed-decor reveal gate).
    // The merged file lands below all three branches' own pins, so the ceiling
    // is the exact merged count per the ratchet's rule: any growth reds again.
    // Lowered again by the foliage reveal-gate wiring, which paid for its four
    // lines by extracting the millisecond rollup into
    // src/render/frame_ms_stats_core.ts (net -15).
    // Lowered again by the GPU-preparation admission wiring, which paid for its
    // lines by extracting the perfStats return-type literal and the renderer's
    // frame/phase stat shapes into src/render/renderer_perf_stats.ts, so the
    // report's contract is nameable instead of inline (net -32).
    // The compile-gate stand-in wiring paid for itself in place: the form/base
    // visibility fan-out moved to src/render/entity_gate_stand_in_core.ts, which
    // covers the lines the shapeshift and base-swap stand-ins added (net 0).
    // Lowered again by the piecewise reveal-gate wiring, which paid for its
    // soft-deadline binding by extracting the shared reveal compile host
    // (link, shadow arm, touch tail, learned soft deadline) into
    // src/render/reveal_compile_host.ts (net -15).
    // Lowered again by the prewarm slot generalization: the landmark and
    // weather manifest entries became createPrewarmGroupSlot bindings and the
    // impact-site prewarm clone moved to its own subsystem module,
    // buildImpactSitePrewarmGroup in src/render/impact_site.ts (net -2).
    // Lowered again by the GPU-preparation pacing fixes: three dead type
    // imports went, and moving the budget's frame boundary into the sync
    // prologue traded a five-line rationale in the governor for the one that
    // now sits beside the queue's own noteFrame (net -3).
    // Lowered again by the live-program telemetry, which paid for its arm by
    // extracting the renderer's info.programs readouts into
    // src/render/live_program_watch.ts; the per-draw bracket lives in
    // frame_present.ts, where the draw is (net -5).
    // Lowered again when the watch moved onto the injected present host: the
    // host's placeholder fields went with it (net -1 with the zero-env
    // prefilter size comment).
    // Lowered again by the production-named coverage fixes, which paid their
    // wiring by moving the empty phase-ms fixtures into
    // renderer_frame_telemetry_core.ts and canvasDataUrlAsync into
    // canvas_data_url.ts (net -26); the post-effect prewarm lane was then
    // removed after the bench (its entry never ran inside the boot budget and
    // resumed live), keeping the extraction (net -24).
    // The touch tail's readiness threading (the gate result down to
    // src/render/linked_program_readiness.ts) paid for itself in place: the
    // single-use compilePriorityFor wrapper folded into the one gate that
    // called it, the core it delegated to being its whole body (net 0).
    // Lowered again by the build-ledger instrumentation, which paid for its
    // producers (timed view and zone feature builds, the arrival mark, the
    // hitch sample's two new fields) by moving the zone prepare report and its
    // stat shapes into src/render/zone_prepare_stats.ts and the hitch scratch
    // factory into scene_census_core.ts (net -1).
    // Lowered again by the composed-look pieces hold (the live candidate path
    // consults characters/look_pieces.ts), which paid for its wiring by moving
    // the zero foliage readout into renderer_frame_telemetry_core.ts beside
    // the other zero fixtures and the created-view type sampler into
    // view_candidate_pool_core.ts (net -16).
    // Lowered again by the gc hitch cause, whose heap read (heap_sample.ts)
    // paid for its import and sample line by folding the key-light follow
    // beside it onto its single statement (net -1).
    // Lowered again by the deferred-decal stand-in (the live candidate path
    // builds the body without its face decals and attaches them on the
    // pieces' arrival), which paid for its wiring by moving the mobile
    // opening render scale into dynamic_resolution_core.ts (net -1).
    // Lowered again by the compile gate's piece cut (one queue unit per
    // material group of the target, compile_gate_pieces.ts): the enumeration
    // and the per-piece work live in that module, and the gate's rationale
    // comment was rewritten to the design that ships (net -10).
    // Lowered again by the hitch sample alignment (hitch_frame_align_core.ts:
    // the start-of-sync reading and the aligned end-of-sync sample), which
    // paid for its wiring by extracting the perfStats last-frame deep copy
    // into src/render/renderer_frame_stats_snapshot.ts (net -21).
    // Lowered again by the compile gate's variant settle
    // (program_variant_settle.ts, the third piece arm both gates bind), which
    // paid for its wiring by moving the open-air fog predicate beside the
    // FogSceneState it classifies (interior_light_rig.ts isOpenAirFogState),
    // landing with the shadow arm's every-mesh twin swap in the same change
    // (net -3).
    // Lowered again when the world gates' touch tail moved behind
    // linked_program_touch_lane.ts runWorldGateTouchLane (no walk mark, the
    // unproven walk recorded as a touch-unproven event) (net -2).
    // The upstream/main merge landed upstream's own growth (the mount-program
    // prewarm entry, the delve tracker extraction) on top of this branch's
    // extractions, so the pin is the exact merged count, still lower than
    // upstream main's own (13744), and any growth reds again.
    // RAISED 13546 -> 13548 (+2) by the streamed-prewarm branch. A raise, not a
    // lowering, and stated as one: the branch extracts the compile SUBMIT LOOP
    // with its deadline rule and never-drop contract
    // (runPrewarmCompileSubmission, src/render/prewarm_compile_submission_core.ts,
    // beside the per-unit submit that module already owned) and the weapon-skin
    // resume unit PLAN (weaponVfxPrewarmUnits, src/render/weapon_vfx_prewarm.ts,
    // beside the stage whose failure boundary shares its unit ids), and those
    // two extractions still do not quite cover what it adds.
    //
    // The history matters because it is the failure mode this ratchet exists to
    // catch. An earlier revision of this branch reported a NET REDUCTION while
    // deleting 41 lines of load-bearing comments, 11 blank lines and folding
    // three `let` declarations into one comma statement: the extractions were
    // real but the number was bought with formatting. Every comment is restored,
    // the blank lines are back, the declarations are separate again, and the
    // count below is what the extractions alone earn. Maintainer decision, and
    // deliberately a visible +2 rather than an invisible -9.
    // Re-pinned 13548 -> 13551 when the rift long-session perf branch merged
    // this base: both parents grew the file independently (upstream's interior
    // resource registry wiring, this branch's object-view material disposal,
    // sparkle tags and the rift build-key cooldown, all thin consumers of
    // extracted modules). Exact merged count, zero slack: any further growth
    // reds again.
    // Raised +8 in the same branch's review round: the rift build-failure
    // cooldown swapped its untracked setTimeout (a handle that outlives
    // teardown and can fire into a recycled renderer) for a timestamp gate.
    // The gate logic lives in src/render/build_retry_gate.ts; this is the
    // coordinator's thin-wiring cost (import, field + rationale comment, the
    // wrapped attempt condition). Exact count, zero slack.
    // Meanwhile on the release base: re-pinned 13548 -> 13563 (+15) when the
    // fast-loading-screen-variety branch merged release/v0.40.0 (thin-consumer
    // wiring to the onCharacterAssetReady seam; substance in
    // src/render/characters/assets.ts and visual.ts), then 13563 -> 13573
    // (+10) for its review-fix round (the nearby-view floor on the shared
    // prewarm budget, decision in src/render/prewarm_policy.ts, and the
    // weapon-skin early-out predicate in characters/assets.ts).
    // Re-pinned to the exact count of the merged file: the base's 13573 plus
    // this branch's +11 across its two arms above. Exact merged count, zero
    // slack: any further growth reds again.
    // Entry-detail admission moved the settle step ahead of compile/texture
    // collection while deleting the old reveal-time arm: exact count, no slack.
    // Lowered by extracting the initial-scene texture collection and shared
    // admission cursor into initial_scene_texture_admission.ts.
    // Lowered again by extracting the compile-root collection, near-first
    // ordering and program-content dedupe into initial_scene_compile_units.ts.
    // The release's rift lifecycle wiring brings the combined renderer to this
    // exact count after formatting, with zero slack.
    // Review hardening restores the measured residency rationale at its live
    // call site and adds only thin wiring for rebuild reveal-gate installation,
    // entry-barrier cleanup and observed display pacing; the policy and timer
    // ownership remain in sibling modules. Exact count, zero slack.
    // Merging release/v0.40.0 into the mounts branch: the cart's own renderer
    // additions live in mount_presentation.ts and the vehicle modules, so the
    // merged file lands between the two parent pins. Pinned to the exact merged
    // count, the zero-slack rule both parents already follow.
    ceiling: 13561,
    seam: 'a new src/render/<thing>.ts module the renderer calls (src/render/CLAUDE.md)',
  },
  {
    // Zero headroom, ratcheted down from 12660 after the broker custody pair
    // moved to src/sim/broker_custody.ts and the offline daily-rewards readout
    // to src/sim/daily_rewards_stub.ts (which also took sim.ts off the $WOC
    // firewall allowlist in tests/architecture.test.ts). Re-pinned to the
    // merged size after the v0.38.0 sync merge landed the release's civic
    // service placements in the sim; still under the release's own 12660.
    // Re-pinned again to the exact merged size after the v0.39.0 sync merge
    // (release-side growth only; the branch's own delegates are unchanged).
    // Re-pinned 12508 -> 12527 at the third v0.39.0 sync merge (release tip
    // b650d9d7d2): release-side growth only again (the practice dummies'
    // vitals, the quest-gated aggro/taunt gate, the worn mech-chroma
    // reconcile, the clearAurasFromSource predicate); the branch's delegates
    // are unchanged and the merged file stays under the release's own 12660
    // row. Exact merged count.
    // Re-pinned 12527 -> 12531 at the fourth v0.39.0 sync merge (release tip
    // ea9377db8e): release-side growth only (the druid auto-unshift strip at
    // cast commit and the aggro/taunt boolean gates); the branch's delegates
    // are unchanged. Exact merged count, still under the release's own 12660.
    // Re-pinned 12531 -> 12560 at the third v0.40.0 sync merge (release tip
    // b39b16022e): release-side growth only (the bot-meta welcome-mail gate
    // from issue #3560, the inert instance-corpse skip in the mob update
    // loop, and the delve-band guard on combat sight checks); the branch's
    // delegates are unchanged. Exact merged count, still under the release's
    // own 12660.
    // Re-pinned 12560 -> 12570 for the fear wall guard: the steering unit
    // lives in src/sim/combat/fear_steering.ts; the residual here is the
    // import plus the player-only redirect delegation in updateFearMovement.
    // Exact merged count against release/v0.40.0 (tip eb20752e9e), still
    // far under the pre-marketplace 12660 row.
    file: 'src/sim/sim.ts',
    ceiling: 12570,
    seam: 'a sim system module behind SimContext (src/sim/CLAUDE.md)',
  },
  {
    // Lowered to the exact size after the Claudium checkout error ladder
    // moved into src/ui/wallet_bridge_reason_text.ts (the ratchet only works
    // if it tightens with every real extraction).
    // Re-pinned 11486 -> 11493 at the third v0.39.0 sync merge (release tip
    // b650d9d7d2): release-side growth only (its own row went to 11490); the
    // branch's main.ts lines are unchanged. Exact merged count, zero headroom.
    file: 'src/main.ts',
    // Re-pinned to the exact merged count after reconciling the OSSBrain
    // v0.40 batch with the current release branch. This preserves the branch
    // wiring and the release-side More-tray launcher without adding slack.
    ceiling: 11497,
    seam: 'a src/game/ or src/ui/ sibling module; main.ts is a firewall, not a home',
  },
  {
    // Held at the exact pre-existing size: the character-save FIFO, the
    // save-fixups, and the depth-warn extractions (serial_writer.ts,
    // character_save_fixups.ts) paid line for line for the marketplace
    // escrow-persist host seam (enqueueCharacterWrite,
    // serializeCharacterForPersist, escrowSessionLost, the guild-book flush
    // pair). Zero headroom on purpose, the standing posture here.
    // Re-pinned 10818 -> 10807 at the third v0.39.0 sync merge (release tip
    // b650d9d7d2): the release moved the mech-chroma reconcile out to
    // server/mech_chroma_reconcile.ts, so the merged file landed SMALLER and
    // the ratchet follows it down (exact merged count, zero headroom).
    // Re-pinned 10807 -> 10813 at the fourth v0.39.0 sync merge (release tip
    // ea9377db8e): release-side growth only (the druid parked-mana sm field
    // in the self-snapshot build plus its wireParkedMana import); the
    // branch's own surface is unchanged (exact merged count, zero headroom).
    file: 'server/game.ts',
    // Re-pinned to the exact merged count after reconciling the OSSBrain
    // v0.40 batch with the current release branch. This conflict resolution
    // did not alter server/game.ts beyond the merged parents.
    ceiling: 10837,
    seam: 'a sibling server module; see the hot-path seams in server/CLAUDE.md',
  },
  {
    file: 'src/net/online.ts',
    ceiling: 5950,
    seam: 'a src/net sibling module (the refactor/net-online split is the template)',
  },
  {
    file: 'src/game/music.ts',
    ceiling: 5470,
    seam: 'a src/game sibling module (the refactor/game-music split is the template)',
  },
  {
    file: 'src/sim/world.ts',
    ceiling: 5450,
    seam: 'zone/terrain data as content records; logic as sim sibling modules',
  },
  {
    file: 'server/db.ts',
    ceiling: 4980,
    seam: 'a domain <domain>_db.ts module with its own *_SCHEMA (server/CLAUDE.md)',
  },
  {
    // Entered the ratchet with the hot-path-scale work, alongside the
    // drift-warn extraction (woc_market_drift_warn.ts) that paid for the
    // sweep segment plan; the read caches, price cache, and watchdog are
    // already sibling modules. The qa gate caught the review rounds growing
    // the file past the first snapshot, and the local-ledger arithmetic
    // (woc_market_local_ledgers.ts) moved out to pay for it; the qa
    // session's fix round then paid its own growth with the step-up flow
    // (woc_market_stepup_flow.ts). The retention round then folded the
    // cascade arm's prior-winner fetch into the store and re-pinned at the
    // shrunken count. The figure is the current count, zero headroom; the
    // delivery arms are the next standing candidate.
    // The delivery arms LANDED as the candidate (the escrow write-path
    // rider): the batch driver, both residue converges, the book-once
    // custody rail, the hand-off with its grant ledger, and the return
    // flight moved to server/woc_market_delivery.ts behind a WocDeliveryCtx
    // slice, paying for the rider's drain rung and re-pinning DOWN at the
    // exact count (4484 to 3984). The FIFO close then added the
    // persistGrantSerialized member and its contract doc to the
    // WocMarketCustody interface the coordinator owns (4000), and the
    // rider's review round added the remaining declaration-and-rung
    // surface no sibling can absorb: the escrowSaturated dep with its two
    // pre-burn rungs (a gate refusal must not consume a signed step-up
    // challenge), the recorders' typed contended arms, and the busyParks
    // scope field the delivery budget reads. Exactly 4037, still net 447
    // DOWN across the rider; the ledgers stay on the service (live state)
    // and the bond payout walk is the next standing candidate.
    file: 'server/woc_market.ts',
    // Down 4037 -> 4036 at the rider QA: the delivery-arms extraction left
    // listingReturnCustodyRef imported here with its only use gone to
    // woc_market_delivery.ts. The ratchet's own rule, an extraction lowers
    // the ceiling, applies to the dead line the extraction forgot too.
    // Down 4036 -> 4032 at the Exchange UX round: the pass budgets and
    // deadlines moved to woc_market_budgets.ts (the sibling pattern), which
    // also cleared the 6 lines the file had drifted over this ceiling.
    // Down 4032 -> 3989 at the second round: the stuck-custody monitor
    // vocabulary moved to woc_market_monitor_types.ts (a leaf types module),
    // paying for the seller-history read.
    ceiling: 3989,
    seam: 'a woc_market_<thing>.ts sibling behind WocMarketDeps (the drift-warn split is the template)',
  },
  {
    file: 'src/render/foliage.ts',
    ceiling: 4147,
    seam: 'a new src/render/<thing>.ts module (src/render/CLAUDE.md)',
  },
  {
    file: 'src/render/nameplate_canvas.ts',
    ceiling: 852,
    seam: 'the pure src/render/nameplate_heraldry_core.ts geometry module',
  },
  {
    file: 'src/sim/colliders.ts',
    // Lowered from 2660 after the cell-index math moved out to
    // collider_cells.ts (the ratchet rule: extraction lowers the ceiling).
    ceiling: 2630,
    seam: 'per-zone collider data beside the zone content; shared logic stays here',
  },
  {
    // Newly tracked. It was already larger than several budgeted files and had
    // no row at all, so it was drifting unwatched: this branch's interior
    // resource-lifecycle work grew it from 2807 to the count below even after
    // extracting src/render/interior_resource_lifecycle.ts. Pinned at the exact
    // current count per the ratchet's rule; any further growth reds, and the
    // fix is extraction behind the seam named here.
    file: 'src/render/dungeon.ts',
    ceiling: 2882,
    seam: 'a new src/render/<thing>.ts module (src/render/CLAUDE.md)',
  },
];

function countLines(absPath: string): number {
  const content = readFileSync(absPath, 'utf8');
  return (content.match(/\n/g) ?? []).length;
}

describe('monolith line-count ratchet', () => {
  it('every tracked monolith still exists (a split or rename must update its row)', () => {
    const missing = MONOLITHS.filter((row) => !existsSync(join(repoRoot, row.file))).map(
      (row) => row.file,
    );
    expect(
      missing,
      `Tracked monolith file(s) missing: ${missing.join(', ')}. If a file was split or ` +
        'renamed (good!), update or remove its row in tests/monolith_budget.test.ts in the ' +
        'same change.',
    ).toEqual([]);
  });

  for (const row of MONOLITHS) {
    it(`${row.file} stays at or under ${row.ceiling} lines`, () => {
      const absPath = join(repoRoot, row.file);
      if (!existsSync(absPath)) return; // reported by the existence check above
      const lines = countLines(absPath);
      expect(
        lines,
        `${row.file} is ${lines} lines, over its ${row.ceiling}-line ceiling. Do not add ` +
          `to this file: extract the new logic into ${row.seam}. See the ratchet policy in ` +
          'the header of tests/monolith_budget.test.ts and the extract-and-test skill. ' +
          'After extracting, lower this ceiling to the new size plus a small margin.',
      ).toBeLessThanOrEqual(row.ceiling);
    });
  }

  it('ceilings stay honest: no tracked file sits more than 400 lines under its ceiling', () => {
    // A ceiling far above the real size is a dead gate: after an extraction shrinks a
    // file, re-pin its ceiling downward. 400 gives room for organic drift between pins.
    const slack = MONOLITHS.filter((row) => {
      const absPath = join(repoRoot, row.file);
      if (!existsSync(absPath)) return false;
      return row.ceiling - countLines(absPath) > 400;
    }).map((row) => `${row.file} (ceiling ${row.ceiling})`);
    expect(
      slack,
      `Ceiling(s) far above the real file size: ${slack.join(', ')}. Lower them in ` +
        'tests/monolith_budget.test.ts so the ratchet keeps tension.',
    ).toEqual([]);
  });
});
