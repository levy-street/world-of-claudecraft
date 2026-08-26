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
    ceiling: 18488,
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
    // Merging release/v0.41.0 into the mounts branch: the merged file measures
    // 13349. Pinned to the exact merged count, keeping the zero-slack posture.
    ceiling: 13349,
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
    ceiling: 12538,
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
    ceiling: 11566,
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
    ceiling: 10645,
    seam: 'a sibling server module; see the hot-path seams in server/CLAUDE.md',
  },
  {
    file: 'src/net/online.ts',
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
    ceiling: 5855,
    seam: 'a src/net sibling module (the refactor/net-online split is the template)',
  },
  {
    file: 'src/game/music.ts',
    // Re-pinned for the Proving Shore dawn-cue merge, then again when the
    // final render replaced the composed themes with a supplied stream-only
    // track; exact merged count.
    ceiling: 5064,
    seam: 'a src/game sibling module (the refactor/game-music split is the template)',
  },
  {
    file: 'src/sim/world.ts',
    // Re-pinned to the eastbrook-plus-tutorial integration merge output:
    // both parents' additions combine, so keep the exact merged count.
    // Re-pinned again for the v0.40.0 sync merge (the release arm's
    // gardenwalk pass rides in beside the tutorial island). Exact count,
    // zero slack.
    ceiling: 5347,
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
    // Re-pinned to the eastbrook-plus-tutorial integration merge output:
    // both parents' additions combine, so keep the exact merged count.
    ceiling: 4121,
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
    ceiling: 2621,
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
