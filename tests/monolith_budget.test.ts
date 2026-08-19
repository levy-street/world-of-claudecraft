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
    // orphaned), so the merged file shrinks below both prior pins. Exact
    // merged count per this row's zero-slack rule: any further growth reds
    // again.
    ceiling: 19337,
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
    ceiling: 13744,
    seam: 'a new src/render/<thing>.ts module the renderer calls (src/render/CLAUDE.md)',
  },
  {
    file: 'src/sim/sim.ts',
    ceiling: 12650,
    seam: 'a sim system module behind SimContext (src/sim/CLAUDE.md)',
  },
  {
    file: 'src/main.ts',
    ceiling: 11490,
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
