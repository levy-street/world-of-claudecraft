import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHROME_GUARDED_PANELS } from '../src/ui/chrome_focus_wiring';
import { stripComments } from './helpers/strip_comments';

// The pin that would have caught the Phase 9 (bn) gap: a farming verb the
// worlds and the wire all carry is still unreachable by an ordinary player
// until some CLIENT control calls it. The scan covers src/game and src/ui
// only: the definitions (src/net, src/world_api) and the sim never count as
// reachability. It fails toward MISSING (zero call sites is red) and lists
// what it found so a deletion names its survivors. One describe per verb;
// a new client-reachable farming verb lands with its own describe here.
//
// Hardened by the 9b QA: sources go through the shared stripComments helper
// before the needle scan, so a trailing "// TODO: restore .plantCrop(...)"
// comment can never keep a pin green after the real call is deleted (the
// original filter tested only the line's LEADING characters). A needle inside
// a STRING literal still counts (no stripper here tokenizes strings); no such
// string exists today and the deny lines never embed call syntax.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const SCAN_ROOTS = ['src/game', 'src/ui'] as const;

function clientCallSites(verb: string): string[] {
  const needle = `.${verb}(`;
  const found: string[] = [];
  for (const root of SCAN_ROOTS) {
    const dir = join(repoRoot, root);
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      const file = join(entry.parentPath, entry.name);
      if (stripComments(readFileSync(file, 'utf8')).includes(needle)) {
        found.push(relative(repoRoot, file));
      }
    }
  }
  return found.sort();
}

describe('harvestCrop client reachability', () => {
  it('has at least one call site under src/game or src/ui', () => {
    const sites = clientCallSites('harvestCrop');
    expect(
      sites.length,
      `expected a client call site of .harvestCrop( under ${SCAN_ROOTS.join(' or ')}; found: [${sites.join(', ')}]`,
    ).toBeGreaterThanOrEqual(1);
  });
});

describe('openPlantSheet client reachability', () => {
  it('has at least one call site under src/game or src/ui', () => {
    const sites = clientCallSites('openPlantSheet');
    expect(
      sites.length,
      `expected a client call site of .openPlantSheet( under ${SCAN_ROOTS.join(' or ')}; found: [${sites.join(', ')}]`,
    ).toBeGreaterThanOrEqual(1);
  });
});

describe('plantCrop client reachability', () => {
  it('has at least one call site under src/game or src/ui', () => {
    const sites = clientCallSites('plantCrop');
    expect(
      sites.length,
      `expected a client call site of .plantCrop( under ${SCAN_ROOTS.join(' or ')}; found: [${sites.join(', ')}]`,
    ).toBeGreaterThanOrEqual(1);
  });
});

describe('convertHusks client reachability', () => {
  // The fourth player-facing IWorldFarming verb: the husk-trade gossip row
  // (quest_dialog_controller) is its one client control today. Pinned so the
  // (bn) gap class cannot silently reopen on the husk trade either.
  it('has at least one call site under src/game or src/ui', () => {
    const sites = clientCallSites('convertHusks');
    expect(
      sites.length,
      `expected a client call site of .convertHusks( under ${SCAN_ROOTS.join(' or ')}; found: [${sites.join(', ')}]`,
    ).toBeGreaterThanOrEqual(1);
  });
});

describe('placeFeast client reachability', () => {
  // The Phase 12 place verb: the bag-row classification (bags_view
  // 'placeFeast') dispatched from bags_window is its one client control.
  it('has at least one call site under src/game or src/ui', () => {
    const sites = clientCallSites('placeFeast');
    expect(
      sites.length,
      `expected a client call site of .placeFeast( under ${SCAN_ROOTS.join(' or ')}; found: [${sites.join(', ')}]`,
    ).toBeGreaterThanOrEqual(1);
  });
});

describe('consumeFeast client reachability', () => {
  // The Phase 12 eat verb: the interact funnel's feast arm
  // (src/game/nearby_interaction.ts) is its one client control.
  it('has at least one call site under src/game or src/ui', () => {
    const sites = clientCallSites('consumeFeast');
    expect(
      sites.length,
      `expected a client call site of .consumeFeast( under ${SCAN_ROOTS.join(' or ')}; found: [${sites.join(', ')}]`,
    ).toBeGreaterThanOrEqual(1);
  });
});

// Slice one uniquely-anchored block out of a comment-stripped source. Every
// anchor is asserted to occur EXACTLY once (a duplicated anchor would make
// the slice ambiguous and the containment claim silently weaker), and the
// terminator must exist after it, so a truncated slice can never pass by
// running to end-of-file (the span-runs-into-the-next-declaration trap).
function sliceOnce(stripped: string, anchor: string, terminator: string): string {
  const at = stripped.indexOf(anchor);
  expect(at, `anchor not found: ${anchor}`).toBeGreaterThanOrEqual(0);
  expect(stripped.indexOf(anchor, at + 1), `anchor not unique: ${anchor}`).toBe(-1);
  const end = stripped.indexOf(terminator, at);
  expect(end, `terminator "${terminator}" not found after anchor ${anchor}`).toBeGreaterThan(at);
  return stripped.slice(at, end + terminator.length);
}

describe('the Hud glue between the funnel and the sheet', () => {
  // The wirings a stubbed-hud suite can never see, each pinned INSIDE its own
  // uniquely-anchored block (text presence anywhere in hud.ts would survive a
  // relocation into dead code): the open route, the farm-event forward, the
  // close-all route (Escape and closeManagedWindow), the error-toast forward
  // (the sim's dead/busy gates answer via ctx.error, so gutting this arm
  // re-strands the Plant control), and the panel keydown guard row (without
  // it, Space/Enter on a focused sheet button also jumps or opens chat).
  const stripped = stripComments(readFileSync(join(repoRoot, 'src/ui/hud.ts'), 'utf8'));

  it('routes Hud.openPlantSheet to the window', () => {
    const block = sliceOnce(stripped, 'openPlantSheet(bedId: string): void {', '\n  }');
    expect(block).toContain('.plantSheetWindow.open(');
  });

  it('forwards the farm events to the window from the event switch', () => {
    const block = sliceOnce(stripped, "case 'farmReady':", 'break;');
    expect(block).toContain('.plantSheetWindow.notifyFarmEvent(');
  });

  it('routes the close-all case through the painter close', () => {
    const block = sliceOnce(stripped, "case 'plant-sheet-window':", 'break;');
    expect(block).toContain('.plantSheetWindow.close(');
  });

  it('forwards every error toast to the window (the dead/busy re-arm)', () => {
    const block = sliceOnce(stripped, "case 'error': {", 'break;');
    expect(block).toContain('.plantSheetWindow.notifyErrorToast(');
    // The Perfecting twin (phase 14): a refused attempt answers through
    // ctx.error and moves no mirror, so without this forward pendingSend
    // never clears and the action button silently swallows every later
    // click until the window is reopened.
    expect(block).toContain('.perfectingWindow.notifyErrorToast(');
  });

  // The guard list left hud.ts at the v0.40.0 sync of release tip 35a6481825
  // (PR #3506 extracted it into src/ui/chrome_focus_wiring.ts), so the claim
  // moves to the extracted seam rather than being deleted: hud.ts must still
  // call the wiring, and the sheet must still be one of the roots it guards.
  // Both halves are needed. Membership alone would survive hud.ts dropping the
  // call, and the call alone would survive the sheet falling out of the list.
  it('keeps the sheet in the panel keydown guard list', () => {
    // The call is matched by SHAPE, not by an exact string: `wireChromeFocus($);`
    // would rot on a rename of the local `$` helper or a biome reflow to a
    // multi-line call, neither of which is a behavior change. This file already
    // paid for that class once, when an upstream extraction deleted the source
    // anchor its previous version sliced on.
    expect(stripped).toMatch(/wireChromeFocus\s*\(/);
    expect(CHROME_GUARDED_PANELS).toContain('#plant-sheet-window');
  });
});

describe('the journey script stays layer-honest', () => {
  // scripts/farming_journey_e2e.mjs is the go-live acceptance: q_farm_intro
  // completes through CLIENT entry points only. window.__game is sanctioned
  // for staging (position, xp/copper reads, /dev farmgrow) and for NOTHING
  // else; a verb call through the debug surface is exactly the (bn) shortcut
  // the Phase 9 QA proved can hide an unreachable feature. The positive arms
  // keep this pin non-vacuous: an emptied or rewritten script that no longer
  // drives the real controls reds here, not just one that cheats.
  const script = stripComments(
    readFileSync(join(repoRoot, 'scripts/farming_journey_e2e.mjs'), 'utf8'),
  );

  it('never drives a farming or quest verb through window.__game', () => {
    for (const forbidden of [
      'sim.plantCrop',
      'sim.harvestCrop',
      'sim.convertHusks',
      'sim.placeFeast',
      'sim.consumeFeast',
      'sim.acceptQuest',
      'sim.turnInQuest',
    ]) {
      expect(script, `the journey script must not call ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('drives the real client controls', () => {
    expect(script).toContain('[data-plant]');
    expect(script).toContain('data-quest="q_farm_intro"');
    expect(script).toContain('mobile-interact');
    expect(script).toContain('KeyF');
  });
});
