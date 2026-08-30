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
//   fix-round review). Most rows sit at zero slack, and a long-lived
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
    // message table moved to src/ui/hud/professions/crafting_deny_core.ts (the v0.37.0 sync
    // merge had pushed the file over), keeping the zero-headroom posture.
    // Re-pinned from 19177 after the v0.38.0 sync merge: the release's map
    // overhaul extracted marker interaction out of the coordinator, so the
    // merged file landed SMALLER and the ratchet follows it down.
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
    //
    // UPSTREAM'S OWN HALF of this span, kept so the merge drops neither parent's
    // record. The touch UI rework lowered the release's row five times by
    // extraction and twice more in its review round, ending at a zero-slack
    // 19031:
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
    //
    // RE-PINNED 19235 -> 18792 at the Phase 11i QA release sync (release tip
    // 14ab2e8630, prior synced release parent 50462dda83). BOTH parent pins for
    // the record: ours 19235 against a 19235 file, the release 19031 against a
    // 19031 file, and the base 19476 both descend from. The union composes
    // exactly: 19476 - 241 (ours) - 445 (theirs) = 18790, plus 2 for the one
    // conflict resolved by hand in hud.ts itself (the consumables block, where
    // the release's extracted buildMobileConsumableSeat is taken and this
    // branch's factual comment correction, elixirs AND scrolls, is carried onto
    // it, rewrapping one comment line into two and restoring the blank line
    // between methods). Measured at 18792. Both parents' extractions STACK, so
    // the merged file lands under both pins and the ratchet TIGHTENS rather than
    // inheriting slack: the release's own 19031 is NOT taken, since it sits 239
    // lines above the merged file. Exact merged count, zero slack: any further
    // growth reds again.
    // RE-PINNED at the Phase 11k QA release sync (the FOURTEENTH sync,
    // release/v0.40.0 b39b16022e to efb1220e85): the merged file lands
    // UNDER both parent pins (ours 18792, the release's 18694) because both
    // parents' extractions land together and the two deleted the same ability
    // tooltip helpers, so the ratchet follows it down. Exact merged count, zero
    // slack: any further growth reds again.
    // MEASURED AGAIN AT THE 11k QA FIX ROUND and lowered by three: the number
    // above was taken mid-resolution, and the conflict work then removed the
    // twin display-name import block and the merge's own unused
    // window_stack_state_core import. A row whose comment says zero slack and
    // whose pin sits above the file is the defect this packet's sim.ts row
    // already named, so it is re-measured rather than left green.
    //
    // UPSTREAM'S OWN HALF over the release/v0.41.0 span, kept so the merge drops
    // neither parent's record:
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
    // Re-pinned to the integration merge of the latest v0.40.0 (the touch UI
    // rework); exact merged count.
    // Re-pinned for the tutorial mobile-coach fixes that followed that merge
    // (SCOPED_POPUP_IDS + the greeting-close window-state resync); exact count.
    // Re-pinned to the exact merged count of the v0.40.0 sync merge that
    // brings in the OSSBrain v0.40 batch: the merged file lands below both
    // parent pins, so the ratchet follows it down. Exact count, zero slack.
    // Plus 1 for the board-note soft mask: the ONE line is the leaderboard
    // deps' maskPlayerText wiring onto the existing maskChat. Exact count.
    // Re-pinned for the signpost guild board window: the construction bag,
    // the openGuildBoard seam, the noticeboard-event arm, and the close and
    // relocalize wiring (the window itself lives in
    // src/ui/hud/guild_board/). Then down one at the controller-tutorial
    // merge. Exact count, zero slack.
    // RE-PINNED at the merge of release/v0.41.0 (tip ff2837da1f) into
    // feature/masterwrought (base 9a89e3483e). BOTH parent pins for the record: ours
    // 18480, the release 18488. Set to the exact merged count measured on the
    // merged working tree (wc -l < src/ui/hud.ts), neither parent's literal. Exact
    // merged count, zero slack: any further growth reds again.
    // LOWERED 18274 -> 18263 at Masterwrought phase 12 (2026-08-26): the
    // unbindResult arm's reason-to-key ternary chain moved into the total
    // UNBIND_DENY_KEY record in src/ui/hud/vendor/unbind_view.ts (the
    // unbind_perfecting deny joined the vocabulary there, never here). Exact
    // count, zero slack.
    // RE-PINNED at the merge of release/v0.41.0 (tip b02da096dd) into
    // feature/masterwrought. BOTH parent pins for the record: ours 18263, the
    // release 18488. The release side's wallet-card fan-out and refresh hook
    // (+2) land against its own comment shrink (-2), so the merged file
    // measures the same 18263 (wc -l < src/ui/hud.ts). Exact merged count,
    // zero slack.
    // Masterwrought phase 13 landed NET ZERO at 18263: the celebration text
    // moved out to craft_celebration_text_view.ts while the two legendary
    // event cases and their imports moved in.
    // LOWERED 18263 -> 18245 at the phase 13 review round: the item-comparison
    // card (itemCompareBlock plus its per-slot body) moved into the
    // item_compare_view.ts pure core so the compare card's worn-instance
    // threading is unit-testable, and Hud keeps a thin consumer; the round's
    // own additions (the log plainText opt-out, the celebration playCue
    // consumption, the compare-card wiring) land inside that extraction.
    // Exact count, zero slack.
    // LOWERED 18245 -> 18242 at the Masterwrought Phase 13 QA (2026-08-27):
    // the masterwork and tier-up toast lines' color moved into the
    // craft_celebration_text_view bundle (craftToastLogLines: the pure core
    // decides the color, the hud case cannot recolor a shared moment), and
    // the itemIcon dep widened in place. Exact count, zero slack.
    // LOWERED 18242 -> 18230 at Masterwrought phase 14 (2026-08-28): the
    // whole Hud.inputDialog body moved out to src/ui/input_dialog.ts (Hud
    // keeps a thin delegator lending the confirm-trap slot and the pending
    // no-choice cancel through a deps bag), which pays for the phase's own
    // wiring (the PerfectingWindow construction, its closeAll case,
    // relocalize arm, error-toast forward, open/togglePerfecting, and the
    // crafting deps' onOpenPerfecting line) plus the 7 lines the
    // hud/professions migration commit had landed over the pin. Exact count,
    // zero slack.
    // LOWERED 18230 -> 18220 in the same phase: the sunder completion cue's
    // log arm landed as predicates in the registered pure cores instead of
    // inline dispatch code (isSunderCompletionLog in
    // profession_event_lines_core.ts; the chat-bubble decision and the
    // Nythraxis vision line set moved verbatim to log_event_route.ts
    // chatBubbleKind), so the case 'log' body shrank while gaining the cue.
    // Exact count, zero slack.
    // LOWERED 18220 -> 18217 wiring the same phase's cap-visibility and
    // catalyst-readout arms: the masterwrought tooltip block collapsed onto
    // masterwrought_cap_view.ts masterwroughtTooltipLines (which also brings
    // the at-cap line), paying for the denial params thread
    // (craftDenyMessage's retryAfterSeconds pass-through). Exact count, zero
    // slack.
    // Release arm, carried for the record: raised to 19002 at the PR #3284
    // v0.41.0 sync merge (the interface-unlock live hooks: dimension-mode
    // mover wiring, the edit-preview painter closure, the player-frame bar
    // lock), after that PR's review-round extraction moved the frames-menu
    // toggle/select tables, the reset-key table, and the party-sample roster
    // builder to the pure core interface_unlock_menu_core.ts.
    // RE-PINNED at the merge of release/v0.41.0 (tip 8592df3866) into
    // feature/masterwrought (base cb10309ba6). BOTH parent pins for the
    // record: ours 18217, the release 19002. Set to the exact merged count
    // measured on the merged working tree (wc -l < src/ui/hud.ts), neither
    // parent's literal. Exact merged count, zero slack: any further growth
    // reds again.
    //
    // UPSTREAM'S OWN HALF over the remainder of the v0.41.0 span, kept so the
    // merge drops neither parent's record (the release row rode the
    // bank-storage branch; its full ledger lives in git on that arm):
    // Re-pinned at the fifth release/v0.41.0 sync (release tip ddc8988185,
    // the gamepad empower-hold batch). The release arm lowered its own pin
    // by 2 when the charge state and the XHB slot lookup moved to
    // src/ui/empower_hold_core.ts; the bank-storage arm stays its +3 store
    // and vault chrome. Exact count, zero slack.
    // Re-pinned at the sixth release/v0.41.0 sync, now on the PR 3676 arm: the
    // ground-aim branch had down-ratcheted its own row via the quickAimPoint
    // and reticle-sync-closure extractions (one under the empower-hold base),
    // and the release arm carries the bank-storage +3 above. Exact count,
    // zero slack.
    // RE-PINNED at the merge of release/v0.41.0 (tip e19d832b47) into
    // feature/masterwrought (base d3f8bae369). BOTH parent pins for the
    // record: ours 18731, the release 19002. The release arm nets zero lines
    // on this file over the span (its adds land against equal sheds), so the
    // merged file measures exactly ours' pin (wc -l < src/ui/hud.ts). Exact
    // merged count, zero slack: any further growth reds again.
    // THE RELEASE PARENT'S OWN HALF over the v0.41.0 span (tip 3e801dc925),
    // kept so the merge drops neither parent's record:
    // and the release arm carries the bank-storage +3 above. Measured on the
    // merged tree, never reconciled by arithmetic. Exact count, zero slack.
    // the Ignivar raid consolidation paid its callout/yell additions by moving the pure entity display-label resolver family to entity_display_labels.ts; exact count.
    // (Since the eighth-sync trim that module keeps only combatAbilityName and
    // parseSimMoney; the family's live homes are the branch's
    // entity_display_core.ts, entity_display_name.ts and
    // ability_tooltip_lines.ts, which won every consumer at the merge.)
    // Re-pinned to the exact count of the ignivar-raid-complete base merge
    // into the Phase B branch: the base's fork landed its own extractions
    // while this branch's healPower seam, sigil-shop progression views, and
    // biome import strip lowered the file; the merge lands both arms and the
    // ratchet pins the merged reality. Exact count, zero slack.
    // Plus 2 for the item-affix tooltip wiring: the import and one composed
    // call into item_affix_tooltip.ts (the Spell Power / Healing Power lines
    // themselves live in that sibling, gather_tool_tooltip pattern). Exact
    // count, zero slack; maintainer-review item.
    // RE-PINNED at the merge of release/v0.41.0 (tip 3e801dc925, the Ignivar
    // raid span, 294 commits) into feature/masterwrought (base e19d832b47).
    // BOTH parent pins for the record: ours 18731, the release 18863. Measured on
    // the merged tree, never reconciled by arithmetic. Exact merged count,
    // zero slack: any further growth reds again.
    ceiling: 18731,
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
    //
    // RE-PINNED AGAIN 13614 -> 13571 at the Phase 11h release sync (release tip
    // 50462dda83, PR #3582's entry-admission perf work; prior synced release
    // parent 3e49dc11b3), the SEVENTH sync and the sixth consecutive one to
    // touch this file. IT LOWERS, which is the first time this row has moved
    // DOWN at a sync, and the ratchet takes the lower number without argument.
    // BOTH parent pins for the record: ours 13614 against a 13614 file, the
    // release 13541 against a 13541 file, and the base 13584 both descend from.
    // The union composes exactly, so this is a re-pin and not a judgement call:
    // 13584 + 30 (ours) - 43 (theirs) = 13571, and the merged file measures
    // 13571. PREDICTED at 13571 before the merge ran and observed at 13571.
    // Phase 11h is a content-table phase and added nothing to renderer.ts.
    // Exact merged count, zero slack: any further growth reds again.
    //
    // UPSTREAM'S OWN HISTORY over this span, kept so the merge drops neither
    // parent's half, and it is why the number fell: entry-detail admission
    // moved the settle step ahead of compile and texture collection while
    // deleting the old reveal-time arm; the initial-scene texture collection
    // and shared admission cursor were extracted into
    // src/render/initial_scene_texture_admission.ts; the compile-root
    // collection, near-first ordering and program-content dedupe were extracted
    // into src/render/initial_scene_compile_units.ts; the release's rift
    // lifecycle wiring landed on top of that; and its review hardening restored
    // the measured residency rationale at its live call site and added only
    // thin wiring for rebuild reveal-gate installation, entry-barrier cleanup
    // and observed display pacing, with the policy and timer ownership left in
    // sibling modules. The release re-pinned to its own exact 13541.
    // LOWERED 13571 -> 13569 at the 11l QA's sixteenth sync
    // (release/v0.40.0 efb1220e85 -> 9a89e3483e, merge 7553c795): the
    // release's far-LOD repair (ec5e9e9afa, 13549 -> 13539, under the
    // release's own ceiling of 13541) had already
    // landed through the sync that merged efb1220e85 (57b1a09d43, the 11k
    // QA's), whose re-measure covered the hud/sim/main/game/online/db rows
    // but not this one, so the branch parent carried two lines of unbanked
    // slack under a zero-slack comment; the merge audit measured the merged
    // file at 13569 (base 13539 + 30 ours). Exact merged count, zero slack:
    // any further growth reds again.
    //
    // UPSTREAM'S OWN HALF over the release/v0.41.0 span, kept so the merge drops
    // neither parent's record:
    // Re-pinned to the integration merge of the latest v0.40.0 (the touch UI
    // rework); exact merged count.
    // RE-PINNED at the merge of release/v0.41.0 (tip ff2837da1f) into
    // feature/masterwrought (base 9a89e3483e). BOTH parent pins for the record: ours
    // 13569, the release 13329. Set to the exact merged count measured on the
    // merged working tree (wc -l < src/render/renderer.ts), neither parent's
    // literal. Exact
    // merged count, zero slack: any further growth reds again.
    // UPSTREAM'S OWN HALF over the remainder of the v0.41.0 span, kept so the
    // merge drops neither parent's record:
    // +1 for the entry horizon's scenery cull far at the live frame (one local
    // the four reveal-gated painters share); the prewarm frame inlines it.
    // Re-pinned at the v0.41.0 sync merge: the release arm's battleground
    // compile-gate wiring (net +1 after its comment rewording) lands beside
    // the branch's +1 above, so the merged file is 13331. Exact merged count,
    // zero headroom.
    // Re-pinned again after PR 3670 (bank storage) merged: its arm carried the
    // exact release-side count 13328 (it never touches renderer.ts), while
    // that branch's renderer edits still land the merged file at 13331.
    // Re-pinned at the PR 3676 sync after PR 3645 (entry fade gate) merged:
    // that arm's entry-horizon cull and the ground-aim reticle pass-through
    // both land in the merged file. Exact merged count, zero headroom.
    // RE-PINNED at the merge of release/v0.41.0 (tip e19d832b47) into
    // feature/masterwrought (base d3f8bae369). BOTH parent pins for the
    // record: ours 13357, the release 13333. Both arms grew the file over the
    // base and the union composes (ours +30, the release +6), so the merged
    // file measures 13363 (wc -l < src/render/renderer.ts). INHERITED growth
    // on the release arm (the entry-horizon cull and the compile gate). Exact
    // merged count, zero slack: any further growth reds again.
    // LOWERED at Phase 16 (2026-08-29): the farming absorb's recorded +30
    // raise is PAID (rulings 11d-D-4 and 11d-U6-FIFTH; target 13333 by the
    // moved-baseline arithmetic) by extracting the zone/archetype
    // prewarm-group builder family into src/render/zone_prewarm_groups.ts
    // (the mount_prewarm/great_tree_prewarm sibling shape). The file
    // measured 13116 at the extraction commit (wc -l < src/render/renderer.ts).
    // Adjusted in the same phase: Arm 1's orange-identity emit call and
    // cached predicate, plus the visualPoolKeyFor cross-pointer comment from
    // the review round (2026-08-29, +2), add the lines between 13116 and this
    // count. Exact count, zero slack: any further growth reds again; the paid
    // target 13333 stays cleared by exactly 200 lines.
    // THE RELEASE PARENT'S OWN HALF over the v0.41.0 span (tip 3e801dc925),
    // kept so the merge drops neither parent's record:
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
    // RE-PINNED at the merge of release/v0.41.0 (tip 3e801dc925, the Ignivar
    // raid span, 294 commits) into feature/masterwrought (base e19d832b47).
    // BOTH parent pins for the record: ours 13133, the release 13249. Measured on
    // the merged tree, never reconciled by arithmetic. Exact merged count,
    // zero slack: any further growth reds again.
    ceiling: 13049,
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
    // RE-PINNED at the Phase 11k QA release sync (the FOURTEENTH sync,
    // release/v0.40.0 b39b16022e to efb1220e85): RECORDED RAISE of exactly the
    // release's own growth. This row did not CONFLICT, which is why it was
    // measured rather than read (the ratchet rows that break without
    // conflicting). Base 12547, ours 12370 against a 12370 file, the release
    // 12565 against its own 12565 file: the union composes exactly as
    // 12370 + 18 (theirs) = 12388, and the merged file measures 12388. INHERITED
    // growth: Phase 11k authored nothing in sim.ts. Exact merged count, zero
    // slack.
    //
    // UPSTREAM'S OWN HALF over the release/v0.41.0 span, kept so the merge drops
    // neither parent's record:
    // Re-pinned to the eastbrook-plus-tutorial integration merge output:
    // both parents' additions combine, so keep the exact merged count.
    // Re-pinned for the local tutorial-tweaks merge (the staged first death and
    // the ability drill hook into the coordinator); exact merged count.
    // Re-pinned +14 for the guild pledge board: setPlayerPledge (the server's
    // nameplate stamp entry) and the four IWorld facet no-op stubs, the
    // sanctioned both-worlds implementation seam. Exact count.
    // Re-pinned to the exact merged count of the v0.40.0 sync merge (the
    // OSSBrain v0.40 batch on the release arm). Exact count, zero slack.
    // Plus 7 for the guildRoster IWorld stub (guilds are online-only, so the
    // offline arm resolves null; the sanctioned both-worlds seam). Exact
    // count, zero slack.
    // Plus 7 at the v0.39.3 main back-merge: the Double Honor port grew the
    // sim arm on main while the release pin sat at zero slack (the known
    // both-arms compound). Exact merged count, zero slack.
    // AT THE MERGE OF release/v0.41.0 (tip ff2837da1f) into feature/masterwrought
    // (base 9a89e3483e): BOTH parent pins for the record, ours 12388, the
    // release 12538. The release's value stood in as a placeholder while
    // src/sim/sim.ts was still mid-resolution, then the row was re-measured on
    // the fully resolved merged tree (wc -l < src/sim/sim.ts):
    // the merged file lands below both parent pins (the release retired the
    // Vale Cup arms this branch had kept), so the ratchet follows it down.
    // Exact merged count, zero slack.
    //
    // RE-PINNED 12361 -> 12326 at Masterwrought Phase 12 (the Perfecting
    // stage): the commission-order command emit bodies (the four verbs plus
    // their two private board lookups) moved to
    // src/sim/professions/commission_order_commands.ts, leaving four one-line
    // delegates; the phase's own additions here are the two thin Perfecting
    // delegates (perfectItem/perfectingInfo onto professions/perfecting.ts).
    // Extraction first, then the phase's lines, netting 35 UNDER the old
    // ceiling; the ceiling follows the file down. Exact count, zero slack.
    // RE-PINNED 12326 -> 12324 at Masterwrought phase 14 (the daily-gate
    // refusal countdown): the craftItem craftResult emit block moved into
    // professions/crafting.ts emitCraftResult (the fourth copy of that emit;
    // rule of three), paying for the host-fed dailyResetRemainingSec field,
    // its buildSimContext getter, and the import. Exact count, zero slack.
    //
    // UPSTREAM'S OWN HALF over the remainder of the v0.41.0 span, kept so the
    // merge drops neither parent's record:
    // Lowered after CharacterState and PetState moved to the type-only
    // character_state.ts leaf. Persistence callers keep the sim.ts re-export,
    // while the coordinator no longer owns the JSONB schema declaration.
    // LOWERED again at the PR #3670 review-fix round: the named-slot target
    // fold moved to item_copy_ref.ts, paying for the bankWireRev field and its
    // delegate plus the corrected vault-load comments. Exact count, zero slack.
    // Raised +3 at the third-round fixes for craftVaultDrawBlockedFor, the
    // cvault wire signature's gate-only probe: a one-line delegate to the
    // materials_vault module (which owns the logic), the same thin-consumer
    // shape as its craftVaultStockFor neighbor.
    // Plus 4 for the groundAimPlacementPreview IWorld member (the placement
    // reticle's true-landing preview; the sanctioned both-worlds seam, a
    // one-line delegate into combat/heroic_leap.ts). Exact count, zero slack.
    // RE-PINNED at the merge of release/v0.41.0 (tip e19d832b47) into
    // feature/masterwrought (base d3f8bae369). BOTH parent pins for the
    // record: ours 12324, the release 12359. The release's character_state
    // extraction lands on top of the packet's own extractions, so the merged
    // file falls BELOW both parent pins and the ratchet follows it down:
    // measured 12128 (wc -l < src/sim/sim.ts), never reconciled by
    // arithmetic. Exact merged count, zero slack: any further growth reds
    // again.
    // THE RELEASE PARENT'S OWN HALF over the v0.41.0 span (tip 3e801dc925),
    // kept so the merge drops neither parent's record:
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
    // RE-PINNED at the merge of release/v0.41.0 (tip 3e801dc925, the Ignivar
    // raid span, 294 commits) into feature/masterwrought (base e19d832b47).
    // BOTH parent pins for the record: ours 12128, the release 12465. Measured on
    // the merged tree, never reconciled by arithmetic. Exact merged count,
    // zero slack: any further growth reds again.
    // LOWERED 12043 -> 12040 at the eighth-sync audit round: the merge had
    // kept three import tokens whose only uses the two arms' refactors had
    // moved elsewhere (computeTalentModifiers superseded by the release's
    // computeCharacterModifiers seam, NYTHRAXIS_SPIRIT_MENDING_CAST_ID's
    // consumer extracted by the branch to mob/combat_profile.ts, and the
    // already-dead PersistedFarmPlot type import); the ceiling follows the
    // file down. Exact count, zero slack.
    ceiling: 12040,
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
    //
    // RE-PINNED 11498 -> 11500 at the Phase 11h release sync (release tip
    // 50462dda83, prior synced release parent 3e49dc11b3). THIS ROW DID NOT
    // CONFLICT IN src/main.ts ITSELF: the file auto-merged cleanly and only
    // this ceiling broke, which is the exact class the Phase 11g QA recorded
    // against src/sim/sim.ts and the reason a release sync MEASURES every
    // ceiling whose file the release touched rather than only the ones git
    // marked. A conflict marks disagreement about TEXT; the ratchet is about
    // SIZE. BOTH parent pins for the record: ours 11498 against an 11498 file,
    // the release 11536 against an 11536 file, and the base 11534 both descend
    // from. The union composes exactly: 11534 - 36 (ours, the arrival-chain
    // extractions, already banked) + 2 (theirs) = 11500, and the merged file
    // measures 11500. The release's own 11536 is NOT taken: it sits 36 lines
    // above the merged file and would hand this row free slack it never
    // earned. INHERITED growth, so upstream's code is NOT extracted to buy the
    // two lines back and the ceiling is NOT raised for headroom.
    //
    // UPSTREAM'S OWN HALF of this span, kept so the merge drops neither
    // parent's record: the bounded first-paint gate is now owned per startGame
    // invocation rather than by a mutable render-core singleton, its browser
    // timer living in the sibling adapter, so main pays only factory and arm
    // wiring. Exact merged count, zero slack: any further growth reds again.
    //
    // UPSTREAM'S OWN HALF of this span, kept so the merge drops neither parent's
    // record. The touch UI rework moved this row twice on its own arm, ending at
    // a zero-slack 11519:
    // Raised 11516 -> 11517 (+1) for the touch bar editor: the More tray's Edit
    // control routes through MobileControlCallbacks, whose bag is wired here and
    // nowhere else, so the ONE line is `onBarEditor: () => hud.toggleBarEditor()`.
    // Everything with substance (the grid model, the tap state machine, the
    // window) lives in src/ui/hud/action_bar/bar_editor/, and the same change
    // LOWERS hud.ts by 185. Maintainer decision, exact merged count: any further
    // growth reds again.
    // RESTORED and LOWERED 11517 -> 11499 by tap mode: raising a ceiling is a
    // maintainer decision, so that +1 is paid back with an extraction rather than
    // kept. main.ts carried a private escapeHtml duplicating src/ui/esc.ts, the
    // canonical escaper the repo already mandates for every interpolation, so the
    // copy is deleted and its 36 call sites use esc(). Exact count, zero slack.
    //
    // RE-PINNED 11500 -> 11483 at the Phase 11i QA release sync (release tip
    // 14ab2e8630, prior synced release parent 50462dda83). BOTH parent pins for
    // the record: ours 11500 against an 11500 file, the release 11519 against an
    // 11519 file, and the base 11536 both descend from. The union composes
    // exactly: 11536 - 36 (ours, the arrival-chain extractions, already banked)
    // - 17 (theirs, the escapeHtml to esc() extraction net of the bar editor's
    // +1) = 11483, and the merged file measures 11483. PREDICTED at 11483 from
    // the two deltas before the file was measured, observed at 11483. The
    // release's own 11519 is NOT taken: it sits 36 lines above the merged file
    // and would hand this row free slack it never earned. Exact merged count,
    // zero slack: any further growth reds again.
    // RE-PINNED at the Phase 11k QA release sync (the FOURTEENTH sync,
    // release/v0.40.0 b39b16022e to efb1220e85): the merged file FALLS under both
    // parent pins (ours 11483, the release 11497), composing exactly as base
    // 11519 - 36 (ours) - 22 (theirs) = 11461. Exact merged count, zero slack.
    //
    // UPSTREAM'S OWN HALF over the release/v0.41.0 span, kept so the merge drops
    // neither parent's record:
    // Re-pinned to the integration merge of the latest v0.40.0 (the touch UI
    // rework); exact merged count.
    // Re-pinned to the exact merged count of the v0.40.0 sync merge (the
    // OSSBrain v0.40 batch on the release arm). Exact count, zero slack.
    // Re-pinned to the exact merged count after the controller-tutorial
    // merge (its controller-setting dispatch extraction shrinks main.ts;
    // the ratchet follows the merged file down). Exact count, zero slack.
    // Re-pinned to the exact merged count of the v0.39.3 main back-merge
    // (the utc_day import consolidation shed one line).
    // RE-PINNED at the merge of release/v0.41.0 (tip ff2837da1f) into
    // feature/masterwrought (base 9a89e3483e). BOTH parent pins for the record: ours
    // 11461, the release 11566. Set to the exact merged count measured on the
    // merged working tree (wc -l < src/main.ts), neither parent's literal. Exact
    // merged count, zero slack: any further growth reds again.
    // RE-PINNED at the merge of release/v0.41.0 (tip b02da096dd) into
    // feature/masterwrought. BOTH parent pins for the record: ours 11530, the
    // release 11564. The release span's balance-refresh rework sheds comment
    // lines against its additions, so the merged file measures 11528
    // (wc -l < src/main.ts), under both parents; the ratchet follows it down.
    // Exact merged count, zero slack.
    // Release arm, carried for the record: down 11564 -> 11563 at the
    // desktop-signing round: the wallet-handoff availability probe and browser
    // authorizer moved to src/net/desktop_wallet_handoff.ts (thin hoisted
    // delegators remain), paying for the Exchange desktop-signer wiring at the
    // attach site.
    // RE-PINNED at the merge of release/v0.41.0 (tip cb10309ba6) into
    // feature/masterwrought (base b02da096dd). BOTH parent pins for the record:
    // ours 11528, the release 11563. The release span's one-line shed lands on
    // top of ours, so the merged file measures 11527 (wc -l < src/main.ts), under
    // both parents; the ratchet follows it down. Exact merged count, zero slack.
    // Release arm, carried for the record: raised to 11629 at the PR #3284
    // v0.41.0 sync merge (the applySetting arms for the interface-editor
    // settings: frame dimensions, aura direction vars, the player-frame bar
    // lock; folding them behind a src/game/ settings-application seam is
    // flagged follow-up work on the release side).
    // RE-PINNED at the merge of release/v0.41.0 (tip 8592df3866) into
    // feature/masterwrought (base cb10309ba6). BOTH parent pins for the
    // record: ours 11527, the release 11629. Set to the exact merged count
    // measured on the merged working tree (wc -l < src/main.ts), neither
    // parent's literal. Exact merged count, zero slack: any further growth
    // reds again.
    // UPSTREAM'S OWN HALF over the remainder of the v0.41.0 span, kept so the
    // merge drops neither parent's record:
    // Re-pinned across the v0.41.0 sync merges after the first-spawn intro's
    // seen-marker persistence moved out into src/game/spawn_intro_seen.ts
    // (the establishing-shot entry wait needed one line here, and the ratchet
    // pays for it by extraction).
    // The empower-hold sync merge lowered the release row by 1 (the pad cast
    // routing lives in src/game/pad_cast_routing.ts), and the PR 3676 sync's
    // reticle-sync closure extraction paid 2 more under the entry-fade row.
    // RE-PINNED at the merge of release/v0.41.0 (tip e19d832b47) into
    // feature/masterwrought (base d3f8bae369). BOTH parent pins for the
    // record: ours 11593, the release 11623. Both arms shed lines over the
    // base (ours -6, the release -6 via the extractions above), so the merged
    // file falls BELOW both parent pins and the ratchet follows it down:
    // measured 11587 (wc -l < src/main.ts). Exact merged count, zero slack:
    // any further growth reds again.
    // THE RELEASE PARENT'S OWN HALF over the v0.41.0 span (tip 3e801dc925),
    // kept so the merge drops neither parent's record:
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
    // RE-PINNED at the merge of release/v0.41.0 (tip 3e801dc925, the Ignivar
    // raid span, 294 commits) into feature/masterwrought (base e19d832b47).
    // BOTH parent pins for the record: ours 11587, the release 11551. Measured on
    // the merged tree, never reconciled by arithmetic. Exact merged count,
    // zero slack: any further growth reds again.
    ceiling: 11515,
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
    // RE-PINNED at the Phase 11k QA release sync (the FOURTEENTH sync,
    // release/v0.40.0 b39b16022e to efb1220e85): the merged file FALLS under both
    // parent pins (ours 10761, the release 10837), composing exactly as base
    // 10894 - 136 (ours) - 61 (theirs) = 10697. Exact merged count, zero slack.
    //
    // UPSTREAM'S OWN HALF over the release/v0.41.0 span, kept so the merge drops
    // neither parent's record:
    // Re-pinned 10900 -> 10909 for the Proving Shore branch: the +9 is the
    // tutorial_start dispatch case (a thin delegate onto sim.startTutorial,
    // where the real gates live) and the firstCharacter field on the join
    // meta plumb; the island's ferry and greeting logic itself lives in sim
    // modules. Exact merged count.
    // Re-pinned to the eastbrook-plus-tutorial integration merge output: the
    // combined tree lands below the branch ceilings, so keep the exact merged
    // count.
    // Re-pinned +43 for the guild pledge board: four dispatch cases (thin
    // validated delegates onto SocialService), the applyPledge transport arm,
    // and the join-time pledge stamp in sendSocialSnapshot; the service logic
    // itself lives in server/social.ts. Exact count.
    // Re-pinned to the exact merged count of the v0.40.0 sync merge (the
    // OSSBrain v0.40 batch on the release arm). Exact count, zero slack.
    // Raised +11 for the guild-signpost fill: the noticeboardGuilds provider
    // field and the one routeEvents call into server/noticeboard_guilds.ts
    // (thin-consumer wiring; the mapping and fill logic live in that
    // module). Exact count, zero slack. Plus 4 for the board-note hard-tier
    // screen: the SocialService construction wires ChatFilter.findHardHit
    // (the screening logic lives in chat_filter.ts and social.ts). Then
    // LOWERED to the exact count again when the signpost fill moved out of
    // routeEvents into the guild board window's live REST read (the
    // noticeboard_guilds event transform is deleted). Exact count, zero
    // slack.
    // AT THE MERGE OF release/v0.41.0 (tip ff2837da1f) into feature/masterwrought
    // (base 9a89e3483e): BOTH parent pins for the record, ours 10697, the
    // release 10645. The release's value stood in as a placeholder while
    // server/game.ts was still mid-resolution, then the row was re-measured on
    // the fully resolved merged tree (wc -l < server/game.ts):
    // below both parent pins (the Vale Cup dispatch arms left with the
    // release, the heavy-self sets live in server/heavy_self.ts), so the
    // ratchet follows the file down. Exact merged count, zero slack.
    // RE-PINNED 10509 -> 10501 at Masterwrought Phase 12 (the Perfecting
    // stage, 2026-08-26): the three pure self-snapshot social rows
    // (markersWire/tradeWire/duelWire, plain Sim readers) moved whole to
    // server/self_social_wire.ts (-31 incl. their comments, +1 import, +1
    // call-site note); the phase's own addition is the perfect_item dispatch
    // case (+22 incl. its validation comment). Extraction first, then the
    // phase's lines, netting 8 UNDER the old ceiling; the ceiling follows the
    // file down. Exact count, zero slack.
    // LOWERED 10501 -> 10492 in the phase 12 review round (2026-08-26): the
    // perfect_item ref parse (its slot/bag/item validation and the XOR drop)
    // moved into the pure core server/perfect_item_ref.ts, leaving the case a
    // one-line parse and a one-line dispatch. Exact count, zero slack.
    // LOWERED 10492 -> 10491 at Masterwrought Phase 13 (the orange promotion,
    // 2026-08-27): the masterwork activity-card emit body (dedupe claim,
    // opt-out read, R60 release) moved whole to server/craft_activity.ts,
    // parameterized by kind; the phase's own additions are the legendary
    // observer arm (a second thin call), the perfect_item name parse and
    // content screen, and the eqi `name` allowlist line. Extraction first,
    // then the phase's lines, netting 1 under the old ceiling; the ceiling
    // follows the file down. Exact count, zero slack.
    // LOWERED 10491 -> 10475 at the Masterwrought Phase 13 QA (2026-08-27):
    // the name-screen lane (server/msg_lanes.ts) costs the dispatch one line
    // (the classified lane is consumed instead of a hard-wired 'command'),
    // paid for by the two biome correctness findings the QA's cleanup lane
    // named (the unused bgOriginAt import and the never-called private
    // replaceLiveAccountCosmetics member). Extraction first, then the line;
    // the ceiling follows the file down. Exact count, zero slack.
    // LOWERED 10475 -> 10473 at the phase 13 QA second fix round: the two
    // name-screen refusal frames ride the existing sendChatNotice helper,
    // paying for the cleanPetName import and the shape-first pet_rename arm.
    // LOWERED 10473 -> 10465 at Masterwrought phase 14: the loop's calendar
    // feed block (utcDay/resetDay/eventLeadDay plus its rationale comment)
    // moved into server/sim_calendar_feed.ts, which also feeds the new
    // dailyResetRemainingSec countdown; the ceiling follows the file down.
    // UPSTREAM'S OWN HALF over the remainder of the v0.41.0 span, kept so the
    // merge drops neither parent's record:
    // LOWERED 10644 -> 10632 after the paid guild creation, bounded lazy-load,
    // guild mutation, ledger-prefix, and activity-log delivery coordinators
    // moved behind narrow sibling seams. Exact count, zero slack.
    // LOWERED again at the PR #3670 review-fix round: the interest-candidate
    // helpers moved to server/interest_candidates.ts and the sweep dueness
    // logic landed in storage_purchases.ts, paying for the ledger breach-hook
    // wiring and the event-relay filter. Exact count, zero slack.
    // RE-PINNED at the merge of release/v0.41.0 (tip e19d832b47) into
    // feature/masterwrought (base d3f8bae369). BOTH parent pins for the
    // record: ours 10465, the release 10617. The resolution keeps the
    // packet's heavy_self and interest_policy extractions (the release's five
    // new heavy-self members were relocated into server/heavy_self.ts, and
    // its inline interest helpers gave way to the packet's module), so the
    // merged file falls BELOW both parent pins and the ratchet follows it
    // down: measured 10462 (wc -l < server/game.ts). Exact merged count, zero
    // slack: any further growth reds again.
    // LOWERED at Phase 16 (2026-08-29): the activity-detection chain
    // (detectActivity's else-if body) moved to server/activity_detect.ts
    // behind a deps bag, which also pays for the golden_harvest arm the N10
    // Discord card added there. The file measures 10329
    // (wc -l < server/game.ts). Exact count, zero slack: any further growth
    // reds again.
    // THE RELEASE PARENT'S OWN HALF over the v0.41.0 span (tip 3e801dc925),
    // kept so the merge drops neither parent's record:
    // the raid consolidation moved the ground-telegraph snapshot unit, the forge-portal replay lifecycle, eventAnchor, and the door gate out; exact count.
    // Plus 1 for the Healing Power wire field: the ONE line is maybe('hpw')
    // beside maybe('sp') in the delta-guarded self record; no clean extraction
    // exists for a single serializer line. Exact count.
    // Plus 7 for the crucible_buy command arm: the dispatch case is the
    // heroic_buy shape exactly; validation lives sim-side. Exact count.
    // RE-PINNED at the merge of release/v0.41.0 (tip 3e801dc925, the Ignivar
    // raid span, 294 commits) into feature/masterwrought (base e19d832b47).
    // BOTH parent pins for the record: ours 10329, the release 10612. Measured on
    // the merged tree, never reconciled by arithmetic. Exact merged count,
    // zero slack: any further growth reds again.
    ceiling: 10298,
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
    // RE-PINNED at the Phase 11k QA release sync (the FOURTEENTH sync,
    // release/v0.40.0 b39b16022e to efb1220e85): RECORDED RAISE of exactly the
    // release's own growth, on a row that did not conflict. Base 5855, ours
    // 5967, the release 5877: the union composes exactly as 5967 + 22 (theirs)
    // = 5989, and the merged file measures 5989. Phase 11k authored nothing in
    // the online mirror. Payback stays Phase 16. Exact merged count, zero slack.
    //
    // UPSTREAM'S OWN HALF over the release/v0.41.0 span, kept so the merge drops
    // neither parent's record:
    // Re-pinned to the eastbrook-plus-tutorial integration merge output:
    // both parents' additions combine, so keep the exact merged count.
    // Re-pinned +29 for the guild pledge board: the four one-line command
    // senders, the entity pg/gt decode, and the social-frame pledge-field
    // normalization (wire mirror code that must live on ClientWorld). Exact
    // count.
    // Re-pinned to the exact merged count of the v0.40.0 sync merge: both
    // arms added wire-mirror code, so the merged file lands above either
    // parent pin. Exact count, zero slack.
    // Plus 18 for the guildRoster REST mirror (the signpost guild board's
    // roster drill-in; the cached read lives in server/guild_roster.ts),
    // then re-pinned when the mirror gained the trust-boundary row
    // validation and the 404-vs-transport-failure split, plus the roster
    // class field. Exact count, zero slack.
    // RE-PINNED at the merge of release/v0.41.0 (tip ff2837da1f) into
    // feature/masterwrought (base 9a89e3483e). BOTH parent pins for the record: ours
    // 5989, the release 5855. Set to the exact merged count measured on the
    // merged working tree (wc -l < src/net/online.ts), neither parent's literal. Exact
    // merged count, zero slack: any further growth reds again.
    // RE-PINNED 5967 -> 5926 at Masterwrought Phase 12 (the Perfecting stage,
    // 2026-08-26): the show-jumping race mirror (its shape, the `mntRace`
    // self-snapshot decode, and the four-event fold) moved whole to
    // src/net/mount_race_wire.ts (-73 incl. comments, +5 import and one-line
    // delegates); the phase's own additions are the two IWorldProfessions
    // members perfectItem/perfectingInfo (+27 incl. comments and the two type
    // imports). Extraction first, then the phase's lines, netting 41 UNDER the
    // old ceiling; the ceiling follows the file down. Exact count, zero slack.
    // Release arm, carried for the record: down 5855 -> 5817 at the
    // desktop-signing round: the handoff result validation moved to
    // src/net/desktop_wallet_handoff.ts (parseDesktopWalletHandoffStatus),
    // paying for the stepup action kind.
    // RE-PINNED at the merge of release/v0.41.0 (tip cb10309ba6) into
    // feature/masterwrought (base b02da096dd). BOTH parent pins for the record:
    // ours 5926, the release 5817. The release span's 38-line net shed lands on
    // top of ours (5926 - 38), so the merged file measures 5888
    // (wc -l < src/net/online.ts), neither parent's literal; the ratchet follows
    // it down. Exact merged count, zero slack.
    //
    // UPSTREAM'S OWN HALF over the remainder of the v0.41.0 span, kept so the
    // merge drops neither parent's record:
    // Re-derived at the PR #3670 review-fix round. Against the release/v0.41.0
    // base (5855) the bank-storage file is +66: the ClientWorld half of the
    // new bank/vault IWorld members, thin wiring by design. The review round
    // then LOWERED it from 5939 by folding the four self-key decode blocks
    // into the bank_snapshot_wire sibling.
    // Plus 5 for the groundAimPlacementPreview IWorld member (the placement
    // reticle's true-landing preview; the sanctioned both-worlds seam, a
    // one-line delegate into the shared sim gate). Exact merged count, zero
    // slack.
    // RE-PINNED at the merge of release/v0.41.0 (tip e19d832b47) into
    // feature/masterwrought (base d3f8bae369). BOTH parent pins for the
    // record: ours 5888, the release 5888 (the same literal over different
    // files). Both arms grew the mirror by 71 lines over the base 5817 (the
    // packet's masterwrought client surface; the release's bank/vault mirror
    // plus the ground-aim preview) and the union composes exactly: the merged
    // file measures 5959 (wc -l < src/net/online.ts). INHERITED growth on the
    // release arm; the known both-arms compound. Payback stays Phase 16.
    // Exact merged count, zero slack: any further growth reds again.
    // LOWERED at Phase 16 (2026-08-29): the absorb's recorded +17 raise is
    // PAID (target 5942 by the moved-baseline arithmetic) by folding the mst
    // and cprof self-key decodes into src/net/crafting_wire.ts (the
    // bank_snapshot_wire/mount_race_wire fold shape the row's own history
    // records). The file measures 5922 (wc -l < src/net/online.ts). Exact
    // count, zero slack: any further growth reds again.
    // THE RELEASE PARENT'S OWN HALF over the v0.41.0 span (tip 3e801dc925),
    // kept so the merge drops neither parent's record:
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
    // RE-PINNED at the merge of release/v0.41.0 (tip 3e801dc925, the Ignivar
    // raid span, 294 commits) into feature/masterwrought (base e19d832b47).
    // BOTH parent pins for the record: ours 5922, the release 5856. Measured on
    // the merged tree, never reconciled by arithmetic. Exact merged count,
    // zero slack: any further growth reds again.
    ceiling: 5890,
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
    // LOWERED 4980 -> 4865 at the Phase 11d QA, the sibling case to server/game.ts
    // above. This row GREW at the absorb rather than falling (4835 to 4865, all of
    // it farming's) and grew straight into pre-existing slack with no row comment,
    // which is the shape that makes a ratchet stop ratcheting. The merged file is
    // theirs' exactly (ours never touched it). Parent pins for the record: ours
    // 4980, farming 4980. Exact merged count, zero slack: any further growth reds
    // again, and the fix is a domain module, not a raise.
    // RE-PINNED at the Phase 11k QA release sync (the FOURTEENTH sync,
    // release/v0.40.0 b39b16022e to efb1220e85): RECORDED RAISE of exactly the
    // release's own growth, on a row that did not conflict. Base 4835, ours
    // 4865, the release 4853: the union composes exactly as 4865 + 18 (theirs)
    // = 4883, and the merged file measures 4883. Phase 11k authored nothing in
    // server/db.ts. Exact merged count, zero slack: the fix stays a domain
    // module, never a raise.
    // RE-PINNED at the merge of release/v0.41.0 (tip ff2837da1f) into
    // feature/masterwrought (base 9a89e3483e): RECORDED RAISE of exactly the
    // release's own growth, on a row that did not conflict (the ratchet rows
    // that break without conflicting). Base 4853, ours 4883 against a 4883
    // file, the release 4864 against its own 4864 file: the union composes
    // exactly as 4883 + 11 (theirs) = 4894, and the merged file measures 4894.
    // The merge authored nothing in server/db.ts. Exact merged count, zero
    // slack: the fix stays a domain module, never a raise.
    // LOWERED 4894 -> 4877 at the Masterwrought Phase 13 QA (2026-08-27): the
    // character UPDATE statement builder (the lease fence shapes plus the
    // size signal) moved whole to server/character_save_statement.ts, paying
    // for the lease-fenced offline writer saveOfflineCharacterState that the
    // clear-item-name strip now rides (the reconnect-window closure). Exact
    // merged count, zero slack.
    // UPSTREAM'S OWN HALF over the remainder of the v0.41.0 span, kept so the
    // merge drops neither parent's record:
    // Raised +29 at the third-round fixes. The substance went to siblings
    // (db_backend_cancel.ts owns the dedicated cancel side pool;
    // BANK_LEDGER_BATCH_RECEIPTS_VALIDATE_SQL lives with its schema in
    // bank_ledger_batch_db.ts; the readback SQL moved beside its builder in
    // bank_ledger_growth_budget.ts); what remains is coordinator wiring none
    // of those can own. Lowered -1 at the fourth-round fixes: the notice
    // filter moved to schema_notices.ts and the connection-budget arithmetic
    // to db_connection_budget.ts. Exact count, zero slack.
    // RE-PINNED at the merge of release/v0.41.0 (tip e19d832b47) into
    // feature/masterwrought (base d3f8bae369). BOTH parent pins for the
    // record: ours 4877, the release 4959. Both arms grew the file (the
    // release's transactional save family and vault ledger wiring; the
    // packet's fence-built statement and offline writer, which the resolution
    // routes every save site through while keeping the release's transactional
    // bodies), so the merged file measures 4999 (wc -l < server/db.ts).
    // INHERITED growth on the release arm. Exact merged count, zero slack:
    // the fix stays a domain module, never a raise.
    ceiling: 4999,
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
    ceiling: 3918,
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
    // The release's own row (the deed-border-cartouche packet) pinned 852
    // as deliberate headroom when the file was 842 and never re-pinned after
    // it grew to 851; taken to the exact merged count at the 11l QA's
    // sixteenth sync (release tip 9a89e3483e, merge 7553c795) under this
    // branch's per-row zero-slack posture. UPSTREAM-OWNED ROW: the next sync
    // that re-pins it conflicts here, and a release-side growth to exactly
    // 852 (green upstream) lands red on this branch; both are loud, never a
    // skip. Resolve by keeping OURS at the exact merged count, not theirs.
    //
    // UPSTREAM'S OWN HALF over the release/v0.41.0 span, kept so the merge drops
    // neither parent's record:
    // Re-pinned at the deed-cartouche base merge: the release arm's heraldry
    // (+70, one line under the old pin on its own tree) and this branch's
    // pledge nameplate line (+13) compound in the merged file. Exact count,
    // zero slack.
    // RE-PINNED at the merge of release/v0.41.0 (tip ff2837da1f) into
    // feature/masterwrought (base 9a89e3483e). BOTH parent pins for the record: ours
    // 851, the release 864. Set to the exact merged count measured on the
    // merged working tree (wc -l < src/render/nameplate_canvas.ts), neither
    // parent's literal. Exact
    // merged count, zero slack: any further growth reds again.
    // RE-PINNED at the merge of release/v0.41.0 (tip 3e801dc925, the Ignivar
    // raid span) into feature/masterwrought (base e19d832b47): this row did not
    // conflict, and that is exactly why it is measured (a conflict marks
    // disagreement about TEXT; this gate is about SIZE). BOTH parent pins for
    // the record: ours 864, the release 864. Measured on the merged tree,
    // never reconciled by arithmetic. Exact merged count, zero slack.
    ceiling: 863,
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
    // RE-PINNED at the merge of release/v0.41.0 (tip 3e801dc925, the Ignivar
    // raid span) into feature/masterwrought (base e19d832b47): this row did not
    // conflict, and that is exactly why it is measured (a conflict marks
    // disagreement about TEXT; this gate is about SIZE). BOTH parent pins for
    // the record: ours 2804, the release 2433. Measured on the merged tree,
    // never reconciled by arithmetic. Exact merged count, zero slack.
    ceiling: 2432,
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
    // RE-PINNED at the merge of release/v0.41.0 (tip e19d832b47) into
    // feature/masterwrought (base d3f8bae369). This row arrives WITH the
    // merge (the release minted it at 1928); the packet's phase 14 arm had
    // already grown the file by 13 (the wornItemCellParts worn-compare
    // wiring), authored before the row existed on this branch. Measured on
    // the merged tree: 1941 (wc -l < src/ui/bank_window.ts). Exact merged
    // count, zero slack: any further growth reds again.
    ceiling: 1941,
    seam: 'a pure view-core plus a thin painter sibling (src/ui/CLAUDE.md)',
  },
  {
    // ADDED by Masterwrought Phase 17 (the closing QA), on the frontend
    // reviewer's note and the daily_rewards_window precedent: the two largest
    // painters of the src/ui/hud/professions/ domain each grew about ten
    // percent across the packet's phases and neither had a row, and a file
    // with no row is exactly where unwatched growth accumulates. The domain's
    // logic went to siblings correctly (professions_view.ts and the family
    // view-cores carry the models); what stays is the flow and the DOM state
    // it owns. Pinned at the exact count, zero slack: the next professions
    // feature lands as a sibling module behind the domain barrel, never as
    // another method cluster here.
    file: 'src/ui/hud/professions/professions_window.ts',
    ceiling: 845,
    seam: 'a pure view-core plus a thin painter sibling (src/ui/hud/CLAUDE.md)',
  },
  {
    // ADDED with the row above, same phase, same reasoning, same seam. The
    // crafting window composes the family view-cores; growth belongs in a
    // sibling module behind src/ui/hud/professions/index.ts.
    file: 'src/ui/hud/professions/crafting_window.ts',
    ceiling: 774,
    seam: 'a pure view-core plus a thin painter sibling (src/ui/hud/CLAUDE.md)',
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
