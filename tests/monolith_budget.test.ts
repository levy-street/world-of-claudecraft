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
    // Held at 2487 for the Solana wallet card (the Claudium card above the
    // Browse filters): the card's markup landed in the chrome builder, and
    // the window's gated wallet fan-out arm was paid for by moving the quote
    // countdown key's arithmetic to the view core (wocQuoteCountdownSig).
    // Exact count, zero headroom.
    file: 'src/ui/woc_market_window.ts',
    // Down 2487 -> 2475 at the desktop-signing round: the WocMarketHooks
    // contract moved to src/ui/woc_market_hooks.ts (wiring, window, and the
    // trade arm all consume it), paying for the signer-reference plumbing.
    ceiling: 2475,
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
    // Lowered after extracting the ability description prose (the placeholder
    // values, the over-time string and the talent-conditional field choice) into
    // src/ui/ability_description.ts (the ratchet's own rule: an extraction lowers
    // the ceiling, never raises it).
    // Raised 19420 -> 19432 (+12) for the desktop-client-update packet, a
    // maintainer decision prepared for PR review: the branch's additions are
    // thin-consumer wiring to extracted modules (presentation_gate,
    // instance_music) riding on top of upstream's near-zero-slack re-pins, so
    // no clean branch-owned extraction exists. Exact merged count: any
    // further growth reds again.
    // Re-pinned 19432 -> 19433: the release/v0.38.0 merge into this branch
    // grew hud.ts by one line at HEAD without updating the row, so the gate
    // arrived red. Same exact-count, zero-slack intent as above.
    // Raised 19433 -> 19442 (+9) for the login preview-prewarm trim: thin-consumer
    // wiring (a `looksModular` read plus three flag args to the pure
    // buildPostEntryPreviewPrewarmUnits) that has no clean branch-owned
    // extraction, landing on upstream's zero-slack re-pin. Maintainer decision,
    // exact merged count: any further growth reds again.
    // Re-pinned 19433 -> 19488 when the castle branch merged main: the castle
    // additions are thin-consumer wiring to extracted modules (the two
    // LastKeepMapPainter declarations and the two walk-in map branches on the
    // clearMapHitState pattern), riding on main's zero-slack pin. Exact merged
    // count: any further growth reds again.
    // Raised for the controller cross hotbar, on top of the moved-base v0.39
    // re-pin. The additions are thin-consumer wiring to an extracted domain
    // (src/ui/hud/cross_hotbar/): the overlay's construction, its per-frame paint,
    // and the one public seam the pad drives it through. Everything with substance
    // (the view, painter, resolvers, panel-hooks shape) lives in that domain, and
    // the earlier attempt to buy these lines by extracting UNRELATED pre-existing
    // helpers out of hud.ts was reverted: refactoring code a change does not own to
    // fit a budget inflates the diff and risks regressions elsewhere. A maintainer
    // decision, taken rather than paid for with someone else's code. The last
    // line is openSpellbook, which the pad needs so a confirm on an empty cell can
    // reach the ability list; the toggle beside it would have closed it instead.
    // castCrossHotbarAction is the other: it routes a pad press back through
    // castSlot so a cross-hotbar cast keeps the SAME semantics a key press has
    // (reticle, empower, sport, mouseover) instead of growing a second cast path,
    // with the Attack branch beside it: Attack is the fixed slot-0 toggle rather
    // than an ability, so it is the one action the seed cannot copy off the bar.
    // Raised for the cross-hotbar cast-fallback fix: the fallback grows an item
    // arm and a spoken refusal beside the ability one, and the shared item-use
    // seam castSlot and the pad now both call. Exact merged count, zero slack:
    // any further growth reds again.
    // Re-pinned across the third release/v0.40.0 sync into the bank-storage
    // branch. The release lowered this to 19476 by extracting the stale-focus
    // chrome wiring (PR #3506) into src/ui/chrome_focus_wiring.ts; the branch
    // side sat at 19512 with its Materials Vault HUD lines. Both land in the
    // merged tree, so the exact merged count is the honest zero-slack bound.
    // LOWERED 19498 -> 19496 by the Bank Storage phase 13 extraction. The
    // banker's Claudium rung purchase needed a second window wired to the
    // Claudium spend seam, and rather than copy the money-handling closure into
    // a second deps literal, the whole seam moved to
    // src/ui/claudium_purchase_bridge.ts and BOTH windows now spread it. The
    // ratchet's own rule: an extraction lowers the ceiling, never raises it, so
    // the two lines it bought are banked rather than spent.
    // LOWERED 19490 -> 19386 by the touch radial ring: buildMobileActionRing's
    // whole body (the markup lookup, the slot-element minting, the attack /
    // slot / page-toggle wiring and both view constructions) moved behind the
    // action_bar seam into hud/action_bar/mobile_action_ring_controller.ts, and
    // Hud kept only the page state, the callback bag and the per-frame paint.
    // The ratchet's own rule: an extraction lowers the ceiling in the same
    // change. Exact count, zero slack.
    // LOWERED 19386 -> 19263 by the touch consumables seat: buildMobileConsumableBar
    // and useConsumableSlot (the markup lookup, the slot-element minting, the
    // toggle/slot wiring, the tooltip binding and the view construction) moved
    // behind the action_bar seam into hud/action_bar/consumable_seat_controller.ts,
    // and Hud kept only the item-use callback and one per-frame paint. Same rule
    // as the ring above: an extraction lowers the ceiling in the same change.
    // Exact count, zero slack.
    // LOWERED 19263 -> 19078 by the touch bar editor: the mobile long-press
    // rearrange (the MobileHotbarDrag type, the field, clearMobileHotbarDrag,
    // bindMobileActionDrag, bindMobileRingDrag and the two point-to-slot hit
    // tests) is DELETED, and the overlay that replaces it lives in
    // hud/action_bar/bar_editor/. Hud kept only the window construction, its two
    // mutation callbacks and the public opener, so the file lands 185 lines
    // below its old pin even after the wiring. Exact count, zero slack.
    // LOWERED 19078 -> 19076 by the bar editor's Clear control: the desktop
    // slot's two shift-clear listeners moved behind action_bar_clear.ts's own
    // bindShiftClear, and the editor's three mutation callbacks now share ONE
    // tooltip hide inside the window, which pays for the new clearSlot callback
    // with two lines to spare. Exact count, zero slack.
    // LOWERED 19076 -> 19052 by the touch stance radial: renderStanceBar's whole
    // body (the row's markup, its per-button tooltip and click wiring, and the
    // signature latch) moved behind a new hud/stance seam, and Hud kept the
    // one-line frame call plus the callback bag the module is built with. The
    // ratchet's own rule: an extraction lowers the ceiling in the same change.
    // Exact count, zero slack.
    // Upstream lowered the SAME pin twice on its own arm: the Reliquary-tracker
    // input construction moved into makeReliquaryTrackerInput
    // (reliquary_tracker_view.ts), and the stale-focus Space fix (PR #3506)
    // moved the chrome focus wiring (the tracker drops plus the panel key-guard
    // loop) into src/ui/chrome_focus_wiring.ts, leaving hud.ts a one-line
    // consumer (wireChromeFocus($)). The pin below is the MERGED reality of both
    // arms of extraction. Exact count, zero slack: any further growth reds again.
    // LOWERED 19038 -> 19032 by the touch review fixes: the action-bar tooltip's
    // in-bags sub-line moved into hud/action_bar/item_bags_line_core.ts, which
    // the consumables row's restored item tooltip shares, and paid for its own
    // two callback lines with nine to spare. Exact count, zero slack.
    // LOWERED 19032 -> 19031: the bar editor's swapSlots/clearSlot callbacks now
    // share placeAbility's spellbook-refresh through one commitHotbarActions
    // helper, fixing a stale assign toggle when a bound spell is cleared or
    // swapped with the spellbook open behind the editor. Exact count, zero slack.
    // Re-pinned across the FOURTH release/v0.40.0 sync into the bank-storage
    // branch (the touch UI rework). Both arms extracted on their own base: the
    // release took hud.ts to 19031 across the radial ring, consumables seat, bar
    // editor, stance radial and the review fixes above; the branch sat at 19496
    // with its bank chrome. Both land in the merged tree, so the exact merged
    // count is the honest zero-slack bound, and it LOWERS the branch pin by 445.
    // LOWERED 19051 -> 19035 by Bank Storage phase 15. The store's open-window
    // refresh needs a line on the slow band and this file had zero slack, so it
    // is paid for by an extraction the same phase owns: the daily-rewards /
    // store launcher POLL (sequence guard, throttle stamp, fetch chain) moved
    // into src/ui/daily_rewards_launcher_core.ts beside the predicate it already
    // called, the ClaudiumLauncherBalance shape this file already composes. The
    // headroom the move bought is BANKED, not spent.
    // Re-pinned at the FIFTH release/v0.40.0 sync into the bank-storage branch
    // (the Exchange / marketplace release). Both arms moved on their own base:
    // the release took hud.ts to 18688 across the wallet-verify extraction and
    // the PR 3606 review deletions, while the branch sat at 19035 with its bank
    // and store chrome. Both land in the merged tree, so the exact MERGED count
    // is the honest zero-slack bound. Re-derived from the merged tree, never
    // taken from either side.
    // Re-pinned at the SIXTH release/v0.40.0 sync (release tip 9a89e3483e). The
    // release's own arm grew hud.ts 18688 -> 18694; this branch sat at 18692.
    // The merged count is exactly base plus BOTH arms' deltas, which is the
    // proof neither side's lines were dropped. Exact merged count, zero slack.
    // Re-pinned at the release/v0.41.0 sync into the bank-storage branch (the New
    // Eastbrook program, which retires the Vale Cup and demolishes the Sowfield).
    // The release arm DELETES more than this branch adds, so the merged count lands
    // below the branch pin and the ratchet follows it DOWN. Measured on the merged
    // tree, never reconciled by arithmetic. Exact count, zero slack.
    // Re-derived at the PR #3670 review-fix round. Against the release/v0.41.0
    // base (18488) this file is +3: the bank-storage feature's own store and
    // vault chrome wiring (the earlier notes about merged-tree arithmetic
    // described branch history that the squash rebased away). The review round
    // itself paid its Escape-rung addition by merging duplicate imports. The
    // raise is this PR's REQUEST, not a settled ruling: merging is what
    // ratifies it. Exact count, zero slack.
    // Re-pinned at the second release/v0.41.0 sync (release tip b02da096dd, the
    // Exchange balance + client-perf batch). The release arm added the wallet
    // card's onWalletChanged fan-out and the refreshWocBalance(force) hook and
    // paid both lines by trimming the Exchange-window comment, so its arm and
    // the merged tree both net zero against this row. Measured on the merged
    // tree, never reconciled by arithmetic. Exact count, zero slack.
    // Re-pinned at the fourth release/v0.41.0 sync (release tip 8592df3866).
    // The release arm carries two hud-heavy batches of its own: the PR #3284
    // interface-unlock merge (raised, then partially taken back by the
    // review-round extraction into the pure core interface_unlock_menu_core.ts;
    // what remains on coordinator state, the dimension-mode mover wiring, the
    // edit-preview painter closure and the player-frame bar lock, is the
    // live-hooks half) and the snap-grid / edit-cursor rework under PR #3714.
    // This branch's arm stays its +3 store and vault chrome. Measured on the
    // merged tree, never reconciled by arithmetic. Exact count, zero slack.
    // Re-pinned at the fifth release/v0.41.0 sync (release tip ddc8988185,
    // the gamepad empower-hold batch). The release arm lowered its own pin
    // by 2 when the charge state and the XHB slot lookup moved to
    // src/ui/empower_hold_core.ts; this branch's arm stays its +3 store and
    // vault chrome. Measured on the merged tree, never reconciled by
    // arithmetic. Exact count, zero slack.
    // Re-pinned at the sixth release/v0.41.0 sync, now on the PR 3676 arm: the
    // ground-aim branch had down-ratcheted its own row via the quickAimPoint
    // and reticle-sync-closure extractions (one under the empower-hold base),
    // and the release arm carries the bank-storage +3 above. Measured on the
    // merged tree, never reconciled by arithmetic. Exact count, zero slack.
    // the Ignivar raid consolidation paid its callout/yell additions by moving the pure entity display-label resolver family to entity_display_labels.ts; exact count.
    // Re-pinned to the exact count of the ignivar-raid-complete base merge
    // into the Phase B branch: the base's fork landed its own extractions
    // while this branch's healPower seam, sigil-shop progression views, and
    // biome import strip lowered the file; the merge lands both arms and the
    // ratchet pins the merged reality. Exact count, zero slack.
    // Plus 2 for the item-affix tooltip wiring: the import and one composed
    // call into item_affix_tooltip.ts (the Spell Power / Healing Power lines
    // themselves live in that sibling, gather_tool_tooltip pattern). Exact
    // count, zero slack; maintainer-review item.
    // Re-pinned to the exact merged count of the OSSBrain v0.41.0 base
    // merge: both parents had already ratcheted for their own work, so
    // the composite is the honest size. Exact count, zero slack.
    ceiling: 18905,
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
    // Re-pinned to the integration merge of the latest v0.40.0 (the touch UI
    // rework); exact merged count.
    // +1 for the entry horizon's scenery cull far at the live frame (one local
    // the four reveal-gated painters share); the prewarm frame inlines it.
    // Re-pinned at the v0.41.0 sync merge: the release arm's battleground
    // compile-gate wiring (net +1 after its comment rewording) lands beside
    // the branch's +1 above, so the merged file is 13331. Exact merged count,
    // zero headroom.
    // Re-pinned again after PR 3670 (bank storage) merged: its arm carried the
    // exact release-side count 13328 (it never touches renderer.ts), while this
    // branch's renderer edits still land the merged file at 13331. Measured on
    // the merged tree. Exact merged count, zero headroom.
    // Re-pinned at the PR 3676 sync after PR 3645 (entry fade gate) merged:
    // that arm's entry-horizon cull and this branch's ground-aim reticle
    // pass-through both land in the merged file. Measured on the merged tree,
    // never reconciled by arithmetic. Exact merged count, zero headroom.
    // the raid consolidation paid its additions by moving the fog scene chain (fog_scene_state.ts), the spellfxAt dispatch arms, the boss facing lock, and the raid anchor/rig syncs out; exact count.
    // Lowered 13265 -> 13243: the set-proc swirl table and both resolution
    // walks moved to src/render/set_proc_fx.ts (the Crucible engine-proc arm
    // landed there, not here); the ratchet follows the file down. Exact
    // count, zero slack.
    // Re-pinned at the PR 3685 base sync (release v0.41.0 through the raid
    // branch): both arms edited the renderer and the union lands at the count
    // below. Measured on the merged tree. Exact merged count, zero headroom.
    ceiling: 13249,
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
    // Lowered from 12660 by Bank Storage phase 11: the default-bank literal
    // and the SavedBankState write literal moved into src/sim/bank.ts
    // (emptyBankState / savedBankState), so the bank blob's shape is owned
    // by ONE module and a new BankState field lands there once, never per
    // sim.ts call site.
    // Re-pinned 12632 -> 12661 across the fourth release/v0.40.0 sync into the
    // bank-storage branch. Every one of the 29 lines is the RELEASE's: the rift
    // perf set (spent-corpse skipping, the collider-cell index) grew sim.ts from
    // 12518 to 12547 under the release's own 12660 ceiling, while this branch had
    // already banked its phase 11 extraction down to an exact zero-slack 12632.
    // The branch contributes no sim.ts line to the merge, so the honest bound is
    // the merged count. Extracting the release's rift lines to buy the room back
    // is the move this file's hud.ts row records as REVERTED: refactoring code a
    // change does not own inflates the diff and risks regressions elsewhere.
    // Exact merged count, zero slack: any further growth reds again.
    // LOWERED 12661 -> 12660 by Bank Storage phase 15: the IWorld getter for the
    // always-available ladder read is paid for by moving the host-stamped
    // bank-bonus write into src/sim/bank.ts (applyBankBonusStamp), the same
    // one-module-owns-the-blob rule the phase 11 note above records.
    // Re-pinned at the FIFTH release/v0.40.0 sync: the release's own arm went
    // DOWN to 12560 (the supported-sight and lethal-fall refactors), and its
    // deletions land on top of this branch's phase 11 and phase 15 extractions.
    // Exact merged count, re-derived from the merged tree, zero slack.
    // Re-pinned at the SIXTH release/v0.40.0 sync (release tip 9a89e3483e): the
    // release's arm went 12560 -> 12565 while this branch sat at 12673 with its
    // phase 11 and phase 15 extractions. Merged count is base plus both deltas.
    // LOWERED 12678 -> 12660 by Phase 16 QA. The spectate guard on the money
    // scope needs `spectating` as a real IWorld member, which costs this file a
    // field, so it is paid for by extracting RewardCounters and its zero value
    // into src/sim/reward_counters.ts (the one-module-owns-the-blob rule the
    // phase 11 note above records for the bank blob). The extraction frees 20
    // and the guard spends 2, so the ratchet keeps the other 18.
    // Exact merged count, re-derived from the merged tree, zero slack.
    // Re-pinned at the release/v0.41.0 sync into the bank-storage branch (the New
    // Eastbrook program, which retires the Vale Cup and demolishes the Sowfield).
    // The release arm DELETES more than this branch adds, so the merged count lands
    // below the branch pin and the ratchet follows it DOWN. Measured on the merged
    // tree, never reconciled by arithmetic. Exact count, zero slack.
    // Lowered after CharacterState and PetState moved to the type-only
    // character_state.ts leaf. Persistence callers keep the sim.ts re-export,
    // while the coordinator no longer owns the JSONB schema declaration.
    // LOWERED again at the PR #3670 review-fix round: the named-slot target
    // fold moved to item_copy_ref.ts, paying for the bankWireRev field and its
    // delegate plus the corrected vault-load comments. Exact count, zero slack.
    // Raised +3 at the third-round fixes for craftVaultDrawBlockedFor, the
    // cvault wire signature's gate-only probe: a one-line delegate to the
    // materials_vault module (which owns the logic), the same thin-consumer
    // shape as its craftVaultStockFor neighbor. The raise is this PR's
    // REQUEST, not a settled ruling: merging is what ratifies it. Exact
    // count, zero slack.
    // Plus 4 for the groundAimPlacementPreview IWorld member (the placement
    // reticle's true-landing preview; the sanctioned both-worlds seam, a
    // one-line delegate into combat/heroic_leap.ts). Exact count, zero slack.
    // Re-pinned at the sixth release/v0.41.0 sync: the release arm's own row
    // moved down across the bank-storage and entry-fade merges while this
    // branch keeps its +4 above. Measured on the merged tree, never
    // reconciled by arithmetic. Exact count, zero slack.
    // the raid consolidation moved the raid readout getter bodies (ignivar_raid_readouts.ts) plus the same-family ground-AoE and partyInfo projections out; exact count.
    // Re-pinned 12473 -> 12451 for the PR 3684 raid restoration: the authored
    // pack-aggro call paid for itself by moving the legacy same-template
    // social pull (and its per-family radius table) to mob/social_aggro.ts.
    // Plus 7 on top for the Crucible sigil shop: the import plus the thin
    // buyCrucibleVendorItem delegation to instances/crucible_vendor.ts (the
    // buyHeroicVendorItem shape exactly); the logic itself lives in the
    // instances module. Exact merged count, zero slack.
    // Plus 5 for the partyTradeMsRemaining IWorld facet delegate (the BoP
    // party trade window countdown): a one-line clock read against
    // lockoutNowMs; the window logic itself lives in loot/bop_trade_window.ts.
    // Thin facet wiring with no clean extraction. Exact count, zero slack.
    // Plus 2 for the Phase B set-bonus seam: the set_bonus_mods import and
    // the setPlayerLevel writer routing through computeCharacterModifiers
    // (the resolver itself is the extracted module). Exact count, zero slack.
    ceiling: 12465,
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
    // Re-pinned to the integration merge of the latest v0.40.0 (the touch UI
    // rework); exact merged count.
    // Re-pinned to the exact merged count of the v0.40.0 sync merge (the
    // OSSBrain v0.40 batch on the release arm). Exact count, zero slack.
    // Re-pinned to the exact merged count after the controller-tutorial
    // merge (its controller-setting dispatch extraction shrinks main.ts;
    // the ratchet follows the merged file down). Exact count, zero slack.
    // Re-pinned to the exact merged count of the v0.39.3 main back-merge
    // (the utc_day import consolidation shed one line).
    // Re-pinned across the v0.41.0 sync merges after the first-spawn intro's
    // seen-marker persistence moved out into src/game/spawn_intro_seen.ts
    // (the establishing-shot entry wait needed one line here, and the ratchet
    // pays for it by extraction).
    // Down 11564 -> 11563 at the desktop-signing round: the wallet-handoff
    // availability probe and browser authorizer moved to
    // src/net/desktop_wallet_handoff.ts (thin hoisted delegators remain),
    // paying for the Exchange desktop-signer wiring at the attach site.
    // Raised at the PR #3284 v0.41.0 sync merge: the applySetting arms for
    // the interface-editor settings (frame dimensions, aura direction vars,
    // the player-frame bar lock) predate this ratchet; folding them behind a
    // src/game/ settings-application seam is flagged follow-up work.
    // The branch's spawn_intro_seen extraction still pays for its own line at
    // the entry wait (3 under the release row), and the empower-hold sync
    // merge lowered the release row by 1 (the pad cast routing lives in
    // src/game/pad_cast_routing.ts), so the merged file lands at 11625.
    // Exact merged count, zero headroom.
    // Re-pinned at the PR 3676 sync: this branch's reticle-sync closure
    // extraction pays 2 more under the entry-fade row above. Measured on the
    // merged tree, never reconciled by arithmetic. Exact merged count, zero
    // headroom.
    // Re-pinned after the /daynight dev-command extraction to
    // src/game/daynight_dev_command.ts (net of the Ignivar placer dispatch).
    // Re-pinned to the exact merged count of the v0.41.0 base sync into the
    // raid branch: both arms extracted and added independently, so neither
    // parent pin fits the combined file; the merged count is the honest bound.
    ceiling: 11551,
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
    // Lowered from 10900 with the vault-wire extraction (server/vault_wire.ts
    // took the vault dispatch bodies, the cvault cadence rule, and the
    // craft-consume batch); bank-storage phase 06+ server code lands THERE,
    // never here. The ZERO margin is deliberate, a hard stop rather than the
    // usual small slack: any growth of this file, one line included, is a
    // conscious extraction-or-maintainer decision. Re-derived at the
    // release/v0.40.0 sync: the release side grew the file (item lock,
    // market sort dispatch, and friends), so the zero-margin pin moved to
    // the merged size (10944). Lowered again by Bank Storage phase 07: the
    // three inline personal-bank case bodies moved into server/bank_wire.ts,
    // paying for the six-label case group and the socket HEAVY_SELF entries
    // with seven lines to spare, and the phase 07 QA gate then deleted the
    // caller-less replaceLiveAccountCosmetics (its caller left with the
    // release's 1339b8f75d, and the dead member redded the changed-files
    // biome step). Lowered again by Bank Storage phase 09: the boot SimConfig
    // assembly moved to server/sim_boot_config.ts (where the STORAGE_PRICES
    // knob joins it), leaving only the perfLap closure at the call site. The
    // ratchet keeps every line of all three drops.
    // LOWERED 10896 -> 10895 by Bank Storage phase 15: the bank family's
    // self-block emission (both the proximity-gated `bank` and the new
    // always-available `bpsl`) moved behind one call into server/bank_wire.ts,
    // which already owns bankInfoForWire and the bank dispatch bodies. Same
    // move phase 07 made for the dispatch cases: new wire surface lands in the
    // sibling and this ceiling goes DOWN.
    // Re-pinned at the FIFTH release/v0.40.0 sync: the release's own arm went
    // DOWN to 10813 while this branch sat at 10895 with its bank wire. Both land
    // in the merged tree, so the exact merged count is the honest bound. The
    // ZERO margin above still holds: any growth is an extraction-or-maintainer
    // decision.
    // Re-pinned at the SIXTH release/v0.40.0 sync (release tip 9a89e3483e): the
    // release's arm grew 10813 -> 10833 (the suspicion-flag dataset and friends)
    // on top of this branch's 10814. Merged count is base plus both deltas. The
    // ZERO margin above still holds: any growth is extraction-or-maintainer.
    // Re-pinned at the release/v0.41.0 sync into the bank-storage branch (the New
    // Eastbrook program, which retires the Vale Cup and demolishes the Sowfield).
    // The release arm DELETES more than this branch adds, so the merged count lands
    // below the branch pin and the ratchet follows it DOWN. Measured on the merged
    // tree, never reconciled by arithmetic. Exact count, zero slack.
    // LOWERED 10644 -> 10632 after the paid guild creation, bounded lazy-load,
    // guild mutation, ledger-prefix, and activity-log delivery coordinators
    // moved behind narrow sibling seams. Exact count, zero slack.
    // LOWERED again at the PR #3670 review-fix round: the interest-candidate
    // helpers moved to server/interest_candidates.ts and the sweep dueness
    // logic landed in storage_purchases.ts, paying for the ledger breach-hook
    // wiring and the event-relay filter. Exact count, zero slack.
    // the raid consolidation moved the ground-telegraph snapshot unit, the forge-portal replay lifecycle, eventAnchor, and the door gate out; exact count.
    // Plus 1 for the Healing Power wire field: the ONE line is maybe('hpw')
    // beside maybe('sp') in the delta-guarded self record; no clean extraction
    // exists for a single serializer line. Exact count.
    // Plus 7 for the crucible_buy command arm: the dispatch case is the
    // heroic_buy shape exactly; validation lives sim-side. Exact count.
    // Re-pinned to the exact merged count of the OSSBrain v0.41.0 base
    // merge: both parents had already ratcheted for their own work, so
    // the composite is the honest size. Exact count, zero slack.
    ceiling: 10641,
    seam: 'a sibling server module; see the hot-path seams in server/CLAUDE.md',
  },
  {
    file: 'src/net/online.ts',
    // Re-pinned at the SIXTH release/v0.40.0 sync (release tip 9a89e3483e).
    // Neither arm crossed 5950 on its own (branch 5942, release 5877 over a
    // base of 5858); only the merge does, because both arms' growth stacks.
    // Every one of the 19 lines over the branch's own count is the RELEASE's
    // (the passwordless Set-a-Password flow and the first-connect join-reject
    // tolerance). The merged count is base plus both deltas exactly, which is
    // the proof no side's lines were dropped. Extracting release code this
    // change does not own is the move the hud.ts row above records as
    // REVERTED. Exact merged count, zero slack.
    // Re-pinned at the release/v0.41.0 sync into the bank-storage branch (the New
    // Eastbrook program, which retires the Vale Cup and demolishes the Sowfield).
    // The release arm DELETES more than this branch adds, so the merged count lands
    // below the branch pin and the ratchet follows it DOWN. Measured on the merged
    // tree, never reconciled by arithmetic. Exact count, zero slack.
    // Re-derived at the PR #3670 review-fix round. Against the release/v0.41.0
    // base (5855) this file is +66: the ClientWorld half of the new bank/vault
    // IWorld members, thin wiring by design (the earlier merged-tree notes
    // described rebased-away history). The review round then LOWERED it from
    // 5939 by folding the four self-key decode blocks into the
    // bank_snapshot_wire sibling. The raise is this PR's REQUEST, not a
    // settled ruling: merging is what ratifies it. Exact count, zero slack.
    // Re-pinned at the third release/v0.41.0 sync (release tip cb10309ba6, the
    // Exchange website desktop batch). The release arm LOWERED its own pin
    // 5855 -> 5817 at the desktop-signing round (the handoff result validation
    // moved to src/net/desktop_wallet_handoff.ts, paying for the stepup action
    // kind); this branch's +66 rides on top, so the merged count lands below
    // the branch pin and the ratchet follows it DOWN. Measured on the merged
    // tree, never reconciled by arithmetic. Exact count, zero slack.
    // Plus 5 for the groundAimPlacementPreview IWorld member (the placement
    // reticle's true-landing preview; the sanctioned both-worlds seam, a
    // one-line delegate into the shared sim gate). Exact merged count, zero
    // slack.
    // Re-pinned at the PR 3676 sixth v0.41.0 sync: the bank-storage arm's +66
    // and this branch's +5 above compose. Measured on the merged tree, never
    // reconciled by arithmetic. Exact count, zero slack.
    // the raid consolidation moved the ground-telegraph wire decoders (ground_telegraph_wire.ts) out; exact count.
    // Plus 2 for the Healing Power mirror: the blankEntity default and the
    // s.hpw ?? fallback beside the existing sp lines; thin wire wiring with no
    // clean extraction. Exact count.
    // Plus 3 for the buyCrucibleVendorItem command mirror (the
    // buyHeroicVendorItem shape exactly). Exact count, zero slack.
    // Plus 4 for the partyTradeMsRemaining IWorld facet delegate (the BoP
    // party trade window countdown vs Date.now(), riftEventMsRemaining's
    // clock). Thin facet wiring with no clean extraction. Exact count.
    // Plus 5 for the Phase B set-bonus mirror: the snapshot decode resolves
    // talent mods through computeCharacterModifiers with the equipment
    // mirror, so worn Crucible tiers read identically in both hosts. Thin
    // wiring to the extracted set_bonus_mods seam. Exact count.
    // Re-pinned to the exact merged count of the ignivar-raid-complete base
    // merge: the base's raid consolidation extracted decoders while this
    // branch added its mirrors; the merge lands both arms. Exact count.
    // Re-pinned again at the PR 3685 base sync: the release arm's Bank
    // Storage wiring and this branch's mirrors both grew the file; the
    // union lands at the count below. Exact merged count, zero headroom.
    // Re-pinned to the exact merged count of the OSSBrain v0.41.0 base
    // merge: both parents had already ratcheted for their own work, so
    // the composite is the honest size. Exact count, zero slack.
    ceiling: 5908,
    seam: 'a src/net sibling module (the refactor/net-online split is the template)',
  },
  {
    file: 'src/game/music.ts',
    // Re-pinned for the Proving Shore dawn-cue merge, then again when the
    // final render replaced the composed themes with a supplied stream-only
    // track; exact merged count.
    // the raid theme registrations were paid for by moving the Gravewyrm Sanctum composer to its sibling module; exact count.
    // Re-pinned 4943 -> 4935: the molten-assembly music row paid for itself by
    // moving the DUNGEON_MUSIC table to dungeon_music_zones.ts. Exact count.
    ceiling: 4935,
    seam: 'a src/game sibling module (the refactor/game-music split is the template)',
  },
  {
    file: 'src/sim/world.ts',
    // Re-pinned to the eastbrook-plus-tutorial integration merge output:
    // both parents' additions combine, so keep the exact merged count.
    // Re-pinned again for the v0.40.0 sync merge (the release arm's
    // gardenwalk pass rides in beside the tutorial island). Exact count,
    // zero slack.
    // the ember coast tables extracted to content/ember_coast.ts (the
    // vale_coast.ts pattern); the Forgefather's Isle cone rode the freed room.
    // The walkable-lift sum extracted to walk_lifts.ts (the Forgefather
    // stair ramps fold in there), then EMBER_LAVA_POOLS moved home to
    // ember_lava_layout.ts beside its flat-pool sibling (paying for the
    // fortress scatter screen); exact count.
    ceiling: 5275,
    seam: 'zone/terrain data as content records; logic as sim sibling modules',
  },
  {
    file: 'server/db.ts',
    // Re-pinned at the release/v0.41.0 sync into the bank-storage branch (the New
    // Eastbrook program, which retires the Vale Cup and demolishes the Sowfield).
    // The release arm DELETES more than this branch adds, so the merged count lands
    // below the branch pin and the ratchet follows it DOWN. Measured on the merged
    // tree, never reconciled by arithmetic. Exact count, zero slack.
    // Raised +29 at the third-round fixes. The substance went to siblings
    // (db_backend_cancel.ts owns the dedicated cancel side pool;
    // BANK_LEDGER_BATCH_RECEIPTS_VALIDATE_SQL lives with its schema in
    // bank_ledger_batch_db.ts; the readback SQL moved beside its builder in
    // bank_ledger_growth_budget.ts); what remains here is coordinator wiring
    // none of those can own: the readback issue-and-warn before COMMIT, the
    // post-listen VALIDATE call in the concurrent-index runner, and the
    // delete call-site handing the dedicated canceller. Lowered -1 at the
    // fourth-round fixes: the notice filter moved to schema_notices.ts (both
    // boot clients now attach the shared forwarder) and the connection-budget
    // arithmetic to db_connection_budget.ts, paying for the VALIDATE's
    // post-unlock restructure in place. Exact count, zero slack.
    // Re-pinned to the exact merged count of the OSSBrain v0.41.0 base
    // merge: both parents had already ratcheted for their own work, so
    // the composite is the honest size. Exact count, zero slack.
    ceiling: 5145,
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
    // Down 3989 -> 3929 at the desktop-signing round: the economy vocabulary
    // (quote legs, price/estimate readouts, WocMarketEconomy) moved to
    // woc_market_economy_types.ts (the monitor-types pattern), paying for the
    // desktopHandoff registrar dep and its four registration call sites.
    // Down 3929 -> 3924 on the release arm: the operator listing and p2p row
    // vocabulary moved to woc_market_ops.ts instead of growing this
    // coordinator.
    // Re-pinned at the third release/v0.41.0 sync into the bank-storage branch:
    // the merged file lands six lines under the release's own pin, so the
    // ratchet follows it down. Measured on the merged tree. Exact count.
    // Re-pinned at the fourth release/v0.41.0 sync (release tip 8592df3866,
    // the operator-listing batch above): the merged file again lands below
    // both parent pins and the ratchet follows it down. Measured on the
    // merged tree. Exact count.
    // Re-pinned to the exact merged count of the OSSBrain v0.41.0 base
    // merge: both parents had already ratcheted for their own work, so
    // the composite is the honest size. Exact count, zero slack.
    ceiling: 3945,
    seam: 'a woc_market_<thing>.ts sibling behind WocMarketDeps (the drift-warn split is the template)',
  },
  {
    file: 'src/render/foliage.ts',
    // Re-pinned to the eastbrook-plus-tutorial integration merge output:
    // both parents' additions combine, so keep the exact merged count.
    // Lowered after extracting the world trees' camera-occluder fade (the
    // hideable records, the trunk hit test, the gated instance/ghost swap)
    // into src/render/tree_hide_fade.ts.
    ceiling: 3996,
    seam: 'a new src/render/<thing>.ts module (src/render/CLAUDE.md)',
  },
  {
    file: 'src/render/nameplate_canvas.ts',
    // Re-pinned at the deed-cartouche base merge: the release arm's heraldry
    // (+70, one line under the old pin on its own tree) and this branch's
    // pledge nameplate line (+13) compound in the merged file. Exact count,
    // zero slack.
    ceiling: 864,
    seam: 'the pure src/render/nameplate_heraldry_core.ts geometry module',
  },
  {
    file: 'src/sim/colliders.ts',
    // Re-pinned to the integration merge of the latest v0.40.0 (the touch UI
    // rework); exact merged count.
    // Re-pinned after the interior-collider-set assembly extraction to
    // interior_collider_sets.ts (which appends the Ignivar authored prop
    // colliders). Exact count, zero slack.
    // the dungeon-door jamb block extracted to dungeon_door_jambs.ts; the
    // fortress collider hook rode the freed room
    ceiling: 2587,
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
    // Lowered after extracting the arena-wall camera-occluder fade (footprint
    // hit test plus the per-frame gated step) into src/render/arena_wall_fade.ts.
    // the raid consolidation moved the arena-wall occlusion core, the pending-wall builder, and the ignivar tile loaders out; exact count.
    // Re-pinned after the addTorchGlow extraction to torch_glow_decal.ts
    // (shared with the Ignivar dressing glow pools), net of the ignivar
    // pillar-swap gate; then again after the banner picking moved to
    // dungeon_banner_core.ts (paying for the ignivar banner suppression
    // gates and the torch-tuck fix). Exact count, zero slack.
    // Re-pinned 2715 -> 2463 for the lava-moat wiring: the floor/quad/wall kind
    // pickers moved to dungeon_tile_kind_core.ts (the banner-core pattern).
    // Re-pinned 2463 -> 2433 for the raid wall backface cull: the hideable-wall
    // update loop moved to dungeon_wall_occlusion.ts and the torch palette
    // table to dungeon_torch_colors.ts (re-counted after the raid-complete
    // floor-coverage merge). Exact count, zero slack.
    // The v0.41.0 sync absorbed release's arena_wall_fade.ts (the gated
    // sightline fade) into dungeon_wall_occlusion.ts, which now drives both
    // occlusion modes; the deleted module's pins moved with it
    // (tests/occluder_fade_gate.test.ts).
    // Re-pinned to the exact merged count of the v0.41.0 base sync into the
    // raid branch: both arms extracted and added independently, so neither
    // parent pin fits the combined file; the merged count is the honest bound.
    ceiling: 2433,
    seam: 'a new src/render/<thing>.ts module (src/render/CLAUDE.md)',
  },
  {
    // Newly tracked, on the QA gate's finding rather than on a size threshold.
    // Bank Storage phase 12 added the Strongbox Charters category here and grew
    // the file by about sixty percent in one change. The logic itself went to
    // siblings the right way (the fit gate lives in the DOM-free
    // src/ui/woc_store_view.ts, the idempotency-key lifecycle in the pure
    // src/ui/store_purchase_intent.ts), but the painter half, the purchase flow
    // and the copy mappers all landed in this coordinator, and the file had no
    // row, so it was drifting unwatched exactly like dungeon.ts above.
    //
    // Phase 12 QA TOOK that first extraction: the copy mappers (charterName,
    // charterGrantedText, charterRefusalText) and charterCardHtml moved to the
    // DOM-free src/ui/charter_card_view.ts, which needs none of this window's
    // private mutable state. The ceiling is LOWERED to the post-extraction
    // count, so the headroom the move bought is banked rather than spent. The
    // QA took the section markup with it (charterSectionHtml), so the whole
    // charter PRESENTATION half now lives behind the seam and the coordinator
    // keeps only the purchase flow and the state it owns. The next clean
    // extraction is the armory's twin (armoryCardHtml, armoryClassChipsHtml,
    // armorySectionHtml).
    file: 'src/ui/daily_rewards_window.ts',
    // LOWERED 1365 -> 1343 by Bank Storage phase 15, which took the extraction
    // named above: the armory's twin (armorySectionHtml, armoryCardHtml,
    // armoryClassChipsHtml) moved to the DOM-free src/ui/armory_card_view.ts,
    // beside charter_card_view.ts. The move bought forty-three lines and the
    // phase's own two review rounds SPENT twenty-one of them on the fixes those
    // rounds found (the background-paint focus exemption, the second call site
    // round two caught, and the comments for both), which is why the honest
    // number was 1343 rather than the 1322 the first pass measured. Spending the
    // room on the change that bought it is the point: it is what let two reviewed
    // fixes land at a file with zero slack, with no raise.
    //
    // LOWERED AGAIN 1343 -> 1331 by Phase 15 QA, which paid for four more fixes
    // with two more extractions rather than a raise: the focus decision and its
    // DOM ladder to src/ui/store_focus_policy.ts (the background exemption and
    // the degrade rule are unit-tested there now), and the charter fit memory
    // (the server's refusals plus the last painted ladder count, which
    // invalidate each other) to the pure src/ui/charter_fit_memory.ts.
    // (That comment's own next target, the spin/wheel overlay, SHIPPED in Bank
    // Storage phase 17; the current one is named at the end of this row.)
    // LOWERED 1331 -> 1329 at the fifth release/v0.40.0 sync. The release moved
    // the dollar formatting into src/ui/usd_text.ts and this file's three call
    // sites became one-liners, so the merged file is two lines smaller than the
    // branch pin. The ratchet only works if it tightens after an extraction,
    // including one the other arm owns: the slack is banked, never spent.
    //
    // LOWERED 1329 -> 1306 by Bank Storage phase 17, in two goes. The spin/wheel
    // overlay this comment names as the next target split into a pure core
    // (src/ui/daily_rewards_spin_view.ts) and a thin painter
    // (src/ui/daily_rewards_spin_controller.ts, named for the suffix the painter
    // gate sweeps, so the cold contract this code held inside the window came
    // with it), which paid for the store's error-body focus fix. Then the
    // phase's review round spent that room and more, so the rank panels
    // (leaderboard and payout history) followed to
    // src/ui/daily_rewards_ranks_view.ts rather than the ceiling going up: a
    // raise is a maintainer decision, and the fixes were paid for the way
    // everything else in the phase was.
    //
    // LOWERED AGAIN 1306 -> 1281 in the same phase's fix-round review, which found
    // the error-body reachability claim wrong and cost three lines to correct in
    // a file with none. The wallet LOCK card followed to
    // src/ui/daily_rewards_wallet_card_view.ts rather than the ceiling going up,
    // and its ban arm (which must render nothing, because a banned player is told
    // elsewhere and must not be invited to connect a wallet) got the arm it never
    // had. Three extractions in one phase is what a zero-slack file costs when
    // its review round is doing its job.
    //
    // The next clean extraction is the summary / tasks markup pair, the last of
    // the rewards tab still built inside the window.
    // LOWERED 1281 -> 1264 by the Store lifecycle extraction: ordered snapshot
    // ownership and prompt invalidation moved to store_surface_runtime.ts, and
    // the full guarded skin purchase flow moved to store_armory_purchase.ts.
    // The new Store-owned modal itself lives in store_decision_prompt.ts, while
    // the cold shell markup moved to daily_rewards_chrome_view.ts.
    ceiling: 1264,
    seam: 'a pure view-core plus a thin painter sibling (src/ui/CLAUDE.md)',
  },
  {
    // ADDED by Bank Storage phase 13, for the reason phase 12 QA added the
    // daily_rewards_window row above: this file had no row, and a file with no
    // row is exactly where unwatched growth accumulates. It carried the
    // Materials Vault tab, the socket row and the capacity meter across this
    // packet and then took the Claudium rung purchase, and "not in the ratchet"
    // is an argument from the gate, not from the module-first rule.
    //
    // The phase's own logic did go to siblings correctly (the pure model in
    // src/ui/bank_view.ts, the copy mappers and both pieces of markup in
    // src/ui/bank_rung_view.ts, the spend seam in
    // src/ui/claudium_purchase_bridge.ts, the intent ledger reused whole); what
    // stayed is the flow and the state it owns, which is the right side of the
    // line. Pinned at the exact count, zero slack: any further growth reds.
    //
    // (That target, the bonus-slots footer, SHIPPED in Bank Storage phase 17
    // alongside ruling 30's controller; the current one is named at the end of
    // this row.)
    file: 'src/ui/bank_window.ts',
    // LOWERED 2127 -> 2124 by Bank Storage phase 16. Making the rung ledger
    // DURABLE needed a line in a file with zero slack, and the wiring paid for
    // itself: the ledger factory moved behind src/ui/purchase_intent_durability.ts,
    // which owns the key minter too, so this file's five-line store_purchase_intent
    // import and its separate minter import collapse into two lines and the field
    // initializer stays one line for one line. The ratchet's own rule, an
    // extraction lowers the ceiling in the same change. Exact count, zero slack.
    //
    // LOWERED 2124 -> 1945 by Bank Storage phase 17, which took BOTH of this
    // row's named targets. The bonus-slots footer this comment names went to the
    // pure src/ui/bank_bonus_view.ts, and the rung purchase state machine
    // (ruling 30, deferred by three phases because moving a live money path
    // during a QA round ships a large unreviewed refactor behind small reviewed
    // ones) went to src/ui/bank_rung_purchase_core.ts. The window keeps what
    // needs the window: the modal confirm and its focus capture, the live-DOM
    // busy write, the live-region announcement, the repaint, and the two markup
    // builders that read purchase state at build time.
    //
    // The pin is the HONEST post-fix-round count, not the number the extractions
    // first measured: the phase's own review round spent part of what they
    // bought on the fixes it found, which is what the room was for, and pinning
    // the pre-fix number would have been a raise wearing a ratchet's clothes.
    //
    // LOWERED 1945 -> 1941 by Bank Storage phase 18, on the same terms. Making
    // the pane's scroll offset FOLLOW its scroller needed lines in a file with
    // zero slack, and the meter's copy paid for them: its accessible name and
    // its tooltip body are a pure function of the meter model and went to
    // src/ui/bank_meter_view.ts, while the window kept the element, the tab
    // stop, the custom properties and the tooltip ATTACH. Measured after the
    // review round rather than after the extraction, the phase 17 rule.
    //
    // The next clean extraction is the remaining bag-socket row
    // (buildSocketRow), whose cells are already a pure model in bank_view.ts.
    // LOWERED 1941 -> 1928 after the socket prompt's consent/echo state and
    // DOM feedback moved behind bank_socket_purchase_core/controller, with the
    // family live-region mechanics shared through bank_status_line.ts.
    ceiling: 1928,
    seam: 'a pure view-core plus a thin painter sibling (src/ui/CLAUDE.md)',
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
