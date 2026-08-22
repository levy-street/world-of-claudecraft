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
// - WHEN A RELEASE SYNC PUSHES A ZERO-SLACK ROW OVER, which is a different case and
//   the one this branch will meet most often (added 2026-08-21 by the Phase 11d QA
//   fix-round review). Seven of the eleven rows sit at zero slack, and a long-lived
//   feature branch keeps merging release/**, so a routine upstream change can grow a
//   file this branch does not own and land red on the sync. Do NOT extract upstream's
//   code to buy the lines back, and do not raise the ceiling silently: re-pin at the
//   exact merged count with a comment naming the sync, the release tip, and the
//   parent pins, exactly as the hud.ts row does for its two syncs. That keeps the
//   ratchet honest (the pin still equals the file) while recording that the growth
//   was inherited rather than authored. If the growth is large enough that the merged
//   file is materially worse, that is a maintainer conversation, not a quiet re-pin.
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
    file: 'src/ui/hud.ts',
    // Lowered from 19600 at the Phase 07 review round (craft-denial key
    // ternary out to craft_denial_line_view), then from 19500 at the Phase 07
    // QA release sync: the v0.37.0 chat-quota wiring pushed the merged union
    // 3 lines over, so the display-name resolver family moved out to
    // entity_display_core (the ratchet: extract, then lower).
    // Upstream meanwhile extracted the ability description prose (the
    // placeholder values, the over-time string and the talent-conditional
    // field choice) into src/ui/ability_description.ts and re-pinned its own
    // row at the exact count through the desktop-client-update, castle, and
    // moved-base v0.39 wrapper merges (ending at its own zero-slack 19387).
    // Re-pinned for the merge of release/v0.40.0 into this branch: both
    // parents' deletions land together (the release's extractions plus the
    // branch SUNDER_ARMOR_PCT_PER_STACK import the release's extraction
    // orphaned), so the merged file shrank below both prior pins (19337).
    // Re-pinned again when release/v0.40.0 moved (the controller cross-hotbar
    // and cast-fallback work): upstream raised its own row to a zero-slack
    // 19490 for thin-consumer wiring to the extracted src/ui/hud/cross_hotbar/
    // domain (a maintainer decision recorded on that side), while the branch's
    // entity_display_core extraction still holds, so the merged union lands
    // between the two parent pins. Exact merged count per this row's
    // zero-slack rule: any further growth reds again.
    // LOWERED at the farming absorb (masterwrought Phase 11d, decision 4 as
    // amended 2026-08-20): both packets' independent extractions STACK, so
    // the merged file lands under all three parent pins (ours 19445,
    // farming 19186 measured against its own smaller file, and the
    // release's 19487, itself lowered by the makeReliquaryTrackerInput
    // extraction this branch absorbed at the Phase 11d sync). No raise, so
    // the Phase 14 payback target of 19445-or-lower (ruling 11d-U6-PAYBACK)
    // is already met at this pin; Phase 14 may not grow the file back, and
    // the professions-module migration counts for nothing toward any future
    // target (a file move relocates zero lines). Exact merged count, zero
    // slack: any further growth reds again.
    // LOWERED again 19248 -> 19235 at the Phase 11d QA release sync (release
    // tip 35a6481825, prior synced tip f50b30de29): the stale-focus Space fix
    // (PR #3506) extracted the tracker drops and the panel key-guard loop into
    // src/ui/chrome_focus_wiring.ts, lowering the release's own row 19487 ->
    // 19476, and this branch takes the same extraction. The merged fall is 13,
    // two lines deeper than the release's own 11, because the branch's guarded
    // panel list carried two roots the release never had (#harvest-journal-window
    // and #plant-sheet-window, from the Phase 11b farming absorb); they moved
    // into CHROME_GUARDED_PANELS with the rest rather than being dropped. No
    // raise. Exact merged count, zero slack: any further growth reds again.
    ceiling: 19235,
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
    // RECORDED RAISE at the farming absorb (masterwrought Phase 11d,
    // decision 4 as amended 2026-08-20): the merge of
    // origin/feature/farming-plan composes farming's 30 lines of
    // farm-visual wiring (its own deviation (an) raise, confirmed thin
    // wiring at the correct seam by the 11b frontend reviewer) into ours'
    // smaller file, a two-packet union where neither side's extractions
    // cover the other side's additions. Both parent pins for the record:
    // ours 13546, farming 13774 (base 13744), so this is +30 against ours
    // and a FALL of 198 against farming's own row; 13546 + (13774 - 13744)
    // composes to the exact merged count. Payback: Phase 16 (the packet's
    // polish phase), scoped to the merge-attributable growth only.
    //
    // The release side of that same history, kept because it is the reason
    // this row moves again below. Upstream RAISED 13546 -> 13548 (+2) on the
    // streamed-prewarm branch, and stated it as a raise: it extracts the
    // compile SUBMIT LOOP with its deadline rule and never-drop contract
    // (runPrewarmCompileSubmission, src/render/prewarm_compile_submission_core.ts,
    // beside the per-unit submit that module already owned) and the weapon-skin
    // resume unit PLAN (weaponVfxPrewarmUnits, src/render/weapon_vfx_prewarm.ts,
    // beside the stage whose failure boundary shares its unit ids), and those
    // two extractions still do not quite cover what it adds. That history
    // matters because it is the failure mode this ratchet exists to catch: an
    // earlier revision of that branch reported a NET REDUCTION while deleting
    // 41 lines of load-bearing comments, 11 blank lines and folding three `let`
    // declarations into one comma statement. Every comment was restored before
    // it landed, so upstream's +2 is what its extractions alone earn.
    //
    // RE-PINNED 13576 -> 13578 at the Phase 11e QA release sync (release tip
    // fd705304ee, PR #3531's shader-memory probes; prior synced release parent
    // 2df374a074), under the MONOLITHS header rule for a release sync that
    // pushes a zero-slack row over. BOTH parent pins for the record: ours
    // 13576 against a 13576 file, the release 13548 against a 13548 file, and
    // the base 13546 both descend from. The union composes exactly, which is
    // why this is a re-pin and not a judgement call: 13546 + 30 (ours, the
    // farm-visual wiring) + 2 (theirs, the submit-loop residue) = 13578, and
    // the merged file measures 13578. INHERITED growth, not authored here: the
    // branch added nothing to renderer.ts in this sync. Per that rule upstream's
    // code is NOT extracted to buy the two lines back and the ceiling is NOT
    // raised for headroom.
    //
    // UPSTREAM'S OWN HISTORY over the same span, kept because this row's value
    // is the record of who grew it and why, and the merge must not drop either
    // parent's half. The release re-pinned 13548 -> 13563 (+15) when the
    // fast-loading-screen-variety branch merged release/v0.40.0 (its rebase
    // onto the release had already paid this row's zero-slack pin once, at
    // 13561 over the pre-streamed-prewarm base): thin-consumer wiring to
    // extracted seams, the onCharacterAssetReady subscription plus its handler,
    // which only enqueues a re-apply for views whose weapon skin GLB just
    // landed, with the substance in src/render/characters/assets.ts (the ready
    // registry) and src/render/characters/visual.ts (refreshWeaponSkin). Then
    // 13563 -> 13573 (+10) for that branch's review-fix round: the nearby-view
    // floor on the shared prewarm budget (the decision lives in
    // src/render/prewarm_policy.ts portalPrewarmViewBudget and
    // nearbyPrewarmViewBudget; the renderer carries the two call sites and the
    // rationale comment) and the weapon-skin early-out in onCharacterAssetReady
    // (the predicate lives in src/render/characters/assets.ts).
    //
    // RE-PINNED AGAIN 13578 -> 13603 at the Phase 11f release sync (release tip
    // 098372138a, PR #3232's fast loading screens; prior synced release parent
    // fd705304ee), the FIFTH sync and the fourth consecutive one to touch this
    // file. BOTH parent pins for the record: ours 13578 against a 13578 file,
    // the release 13573 against a 13573 file, and the base 13548 both descend
    // from. The union composes exactly, so this is a re-pin and not a
    // judgement call: 13548 + 30 (ours) + 25 (theirs) = 13603, and the merged
    // file measures 13603. PREDICTED at 13603 before the merge ran and observed
    // at 13603. INHERITED growth on both sides: the branch added nothing to
    // renderer.ts in this sync either. Upstream's code is NOT extracted to buy
    // the lines back and the ceiling is NOT raised for headroom. Exact merged
    // count, zero slack: any further growth reds again.
    //
    // RE-PINNED AGAIN 13603 -> 13614 at the Phase 11g QA release sync (release
    // tip 3e49dc11b3, PR #3566's rift long-session perf work; prior synced
    // release parent 098372138a), the SIXTH sync and the fifth consecutive one
    // to touch this file. BOTH parent pins for the record: ours 13603 against a
    // 13603 file, the release 13584 against a 13584 file, and the base 13573
    // both descend from. The union composes exactly, so this is a re-pin and
    // not a judgement call: 13573 + 30 (ours) + 11 (theirs) = 13614, and the
    // merged file measures 13614. INHERITED growth on both sides again: Phase
    // 11g is a content-table phase and added nothing to renderer.ts. Upstream's
    // code is NOT extracted to buy the lines back and the ceiling is NOT raised
    // for headroom. Exact merged count, zero slack: any further growth reds
    // again.
    //
    // UPSTREAM'S OWN HISTORY over this span, kept so the merge drops neither
    // parent's half. The release re-pinned 13548 -> 13551 when its rift
    // long-session perf branch merged this base (both parents grew the file
    // independently: the base's interior resource registry wiring, that
    // branch's object-view material disposal, sparkle tags and rift build-key
    // cooldown, all thin consumers of extracted modules), then +8 in its own
    // review round when the rift build-failure cooldown swapped an untracked
    // setTimeout (a handle that outlives teardown and can fire into a recycled
    // renderer) for a timestamp gate, the gate logic living in
    // src/render/build_retry_gate.ts and the renderer keeping only the
    // coordinator's thin wiring. It then re-pinned to the exact count of its
    // own merged file at 13584.
    ceiling: 13614,
    seam: 'a new src/render/<thing>.ts module the renderer calls (src/render/CLAUDE.md)',
  },
  {
    file: 'src/sim/sim.ts',
    // Re-pinned at the farming absorb (masterwrought Phase 11d, the
    // 11b-qa-B8 second-arm row): the pin previously sat 309 lines above the
    // file with no comment, un-banked slack. The merged file FALLS under
    // ours' pin because both packets extracted independently: farming's own
    // row comment (verbatim at 8cd964d599) records its three extractions,
    // the M5 boss support kit to src/sim/mob/boss_mechanics.ts, the retired
    // mobMeleeRange / mobCombatProfile delegates, and countItem thinned
    // over the shared countRawInSlots walk, landing its file at 12229 under
    // its 12232 pin (all live at the absorbed tip: the delegate pair stayed
    // retired), while this branch's pin stood at 12650. The merged count
    // composes as base 12518 plus ours' +111 minus farming's -289, plus the
    // one comment line the 11c QA trued. ALL THREE parent pins for the record
    // (hud.ts sets the precedent of naming its third): ours 12650, farming
    // 12232, and the release 12660 against a 12518 file at both f50b30de29 and
    // 35a6481825. 12341 lands under all three. Exact merged count, zero slack:
    // any further growth reds again.
    //
    // RE-PINNED 12341 -> 12370 at the Phase 11g QA release sync (release tip
    // 3e49dc11b3). This row did not CONFLICT, which is exactly why it needed
    // measuring rather than reading: the release grew src/sim/sim.ts by 29
    // lines (the rift long-session work, whose substance lives in
    // src/sim/collider_cells.ts and src/sim/mob/locomotion.ts) while never
    // touching this row, because its own ceiling still sat at 12660 over a
    // 12518 file. Ours had ratcheted the ceiling down to the extracted file's
    // exact 12341, so the merged file lands 29 over a pin neither parent's
    // diff mentions. BOTH parent pins for the record: ours 12341 against a
    // 12341 file, the release 12660 against a 12547 file, base 12518. The
    // union composes exactly: 12341 + 29 (theirs) = 12370, and the merged file
    // measures 12370. INHERITED growth: Phase 11g is a content-table phase and
    // added nothing to sim.ts. Upstream's code is NOT extracted to buy the
    // lines back and the ceiling is NOT raised for headroom. Exact merged
    // count, zero slack: any further growth reds again.
    ceiling: 12370,
    seam: 'a sim system module behind SimContext (src/sim/CLAUDE.md)',
  },
  {
    file: 'src/main.ts',
    // Pinned at the exact merged count. This branch's extractions (the blocking
    // arrival chain into src/game/arrival_warmup.ts, the world-entry settle
    // cover joining it) net against the base's pad-selection extraction plus
    // controller-config growth (src/game/pad_target_pick.ts, ceiling 11552),
    // landing below both parents' pins. Any further growth reds again.
    // Re-pinned at the farming absorb (masterwrought Phase 11d, decision 4
    // as amended): the merged file FALLS under both parent pins (ours
    // 11516, farming 11460), composing exactly as base 11490 plus ours'
    // +26 minus farming's -36.
    //
    // UPSTREAM'S OWN HISTORY over the same span, kept so the merge drops
    // neither parent's half of the record. The release re-pinned 11516 ->
    // 11522 (+6) for the fast-loading-screen-variety rebase onto
    // release/v0.40.0: net-extractive there, MOVING the eager mob-body stream,
    // far-vista settle and background preload lane out of the entry path into
    // src/game/post_entry_warmups_core.ts and the backdrop rotation into
    // src/ui/loading_backdrop.ts, leaving main.ts the call wiring for both
    // (the controller construction and the runPostEntryWarmups options
    // object), which is the firewall's job. Then 11522 -> 11534 (+12) for that
    // branch's review-fix round: the mob-body stream kick moved from the
    // post-fade callback to the first-paint checkpoint
    // (kickCharacterPreloadStream, the seam stays in
    // src/game/post_entry_warmups_core.ts), costing the call wiring plus the
    // placement rationale where the reader needs it.
    //
    // RE-PINNED 11480 -> 11498 at the Phase 11f release sync (release tip
    // 098372138a, prior synced release parent fd705304ee). BOTH parent pins for
    // the record: ours 11480 against an 11480 file, the release 11534 against
    // an 11534 file, and the base 11516 both descend from. The union composes
    // exactly: 11516 - 36 (ours, the arrival-chain extractions) + 18 (theirs,
    // the loading-screen wiring) = 11498, and the merged file measures 11498.
    // PREDICTED at 11498 before the merge ran and observed at 11498. The
    // release's own 11534 is NOT taken: it sits 36 lines above the merged file
    // and would hand this row free slack it never earned, which is exactly the
    // silent-raise the ratchet exists to prevent. INHERITED growth, so
    // upstream's code is NOT extracted to buy the lines back. Exact merged
    // count, zero slack: any further growth reds again.
    ceiling: 11498,
    seam: 'a src/game/ or src/ui/ sibling module; main.ts is a firewall, not a home',
  },
  {
    file: 'server/game.ts',
    // LOWERED 10890 -> 10761 at the Phase 11d QA, banking un-banked slack the
    // way the same packet already treated sim.ts (whose row called a pin
    // sitting above its file "with no comment" a defect, not a licence). The
    // merged file composes exactly: base 10894 - 32 (ours) - 101 (farming) =
    // 10761. Ours' pin was 10890 against a 10862 file, so 28 lines of slack
    // pre-dated the merge and the merge added 101 more; left alone, the two
    // server monoliths a crafting and farming packet is most likely to grow
    // could take 129 more lines with the ratchet green. Parent pins for the
    // record: ours 10890, farming and release 10900. Exact merged count, zero
    // slack: any further growth reds again, and the fix is extraction.
    ceiling: 10761,
    seam: 'a sibling server module; see the hot-path seams in server/CLAUDE.md',
  },
  {
    file: 'src/net/online.ts',
    // RECORDED RAISE at the farming absorb (masterwrought Phase 11d, the
    // fifth-monolith case under ruling 11d-U6-FIFTH): BOTH parents grew the
    // online mirror under one shared 5950 pin (ours +47 for the
    // masterwrought client surface, farming +65 for its farm facet mirror),
    // and the union composes exactly as base 5855 + 47 + 65. Both parent
    // pins for the record: ours 5950, farming 5950. The raise is scoped to
    // this merge-attributable growth, never to growth a phase authors.
    // Payback: Phase 16 (the packet's polish phase). Exact merged count,
    // zero slack: any further growth reds again.
    ceiling: 5967,
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
    // LOWERED 4980 -> 4865 at the Phase 11d QA, the sibling case to server/game.ts
    // above. This row GREW at the absorb rather than falling (4835 to 4865, all of
    // it farming's) and grew straight into pre-existing slack with no row comment,
    // which is the shape that makes a ratchet stop ratcheting. The merged file is
    // theirs' exactly (ours never touched it). Parent pins for the record: ours
    // 4980, farming 4980. Exact merged count, zero slack: any further growth reds
    // again, and the fix is a domain module, not a raise.
    ceiling: 4865,
    seam: 'a domain <domain>_db.ts module with its own *_SCHEMA (server/CLAUDE.md)',
  },
  {
    file: 'src/render/foliage.ts',
    ceiling: 4147,
    seam: 'a new src/render/<thing>.ts module (src/render/CLAUDE.md)',
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
