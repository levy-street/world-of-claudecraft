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
    ceiling: 19445,
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
    ceiling: 13546,
    seam: 'a new src/render/<thing>.ts module the renderer calls (src/render/CLAUDE.md)',
  },
  {
    file: 'src/sim/sim.ts',
    ceiling: 12650,
    seam: 'a sim system module behind SimContext (src/sim/CLAUDE.md)',
  },
  {
    file: 'src/main.ts',
    // Pinned at the exact merged count. This branch's extractions (the blocking
    // arrival chain into src/game/arrival_warmup.ts, the world-entry settle
    // cover joining it) net against the base's pad-selection extraction plus
    // controller-config growth (src/game/pad_target_pick.ts, ceiling 11552),
    // landing below both parents' pins. Any further growth reds again.
    ceiling: 11516,
    seam: 'a src/game/ or src/ui/ sibling module; main.ts is a firewall, not a home',
  },
  {
    file: 'server/game.ts',
    ceiling: 10890,
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
    file: 'src/render/foliage.ts',
    ceiling: 4147,
    seam: 'a new src/render/<thing>.ts module (src/render/CLAUDE.md)',
  },
  {
    file: 'src/sim/colliders.ts',
    ceiling: 2660,
    seam: 'per-zone collider data beside the zone content; shared logic stays here',
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
