// @vitest-environment happy-dom
//
// The mobile-window-open body-class family fix (Phase 14, item A1): the
// harvest journal and the plant sheet must participate in the body-class
// mirror exactly like every sibling window. The P9b QA found the gap:
// opening either window never set body.mobile-window-open, so the mobile
// chrome (touch router, controls, layout applier) did not yield while they
// were open.
//
// The proof is layered like the woc_store_window_contract suite:
//  1. BEHAVIOR: each window's open/close drives the REAL body-class writer
//     (window_open_state.ts syncWindowOpenBodyClasses, the extracted body of
//     Hud.syncAnyWindowOpenState) over real DOM, and the class flips both
//     ways. The visibility read passed in is the computed-display arm of
//     Hud.isWindowVisible, the arm that governs these two inline-display
//     windows.
//  2. WIRING: hud.ts passes `onVisibilityChange: () => this.syncAnyWindowOpenState()`
//     inside BOTH farming windows' deps (the pinned sibling shape), so the
//     behavioral arm above is what the live composition actually runs.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FARM_CROPS } from '../src/sim/content/farm_crops';
import { FARM_PATCHES } from '../src/sim/content/farm_patches';
import type { FarmPlotView } from '../src/sim/professions/farm_projection';
import type { InvSlot } from '../src/sim/types';
import { PlantSheetWindow } from '../src/ui/hud/professions/farming_plant_sheet_window';
import { HarvestJournalWindow } from '../src/ui/hud/professions/harvest_journal_window';
import { PerfectingWindow } from '../src/ui/hud/professions/perfecting_window';
import { syncWindowOpenBodyClasses } from '../src/ui/window_open_state';
import type { IWorld } from '../src/world_api';
import { stripComments } from './helpers/strip_comments';

// happy-dom rewrites import.meta.url to an http scheme, so the repo root
// comes from the vitest cwd (the localization_fixes idiom).
const repoRoot = process.cwd();

const BED = 'bed_eastbrook_1';

// The computed-display visibility arm Hud.isWindowVisible applies to these
// two windows (they show/hide via inline display, never a body class).
const isVisible = (el: HTMLElement): boolean => getComputedStyle(el).display !== 'none';
const sync = (): void => syncWindowOpenBodyClasses(isVisible);

class JournalWorld {
  plots: FarmPlotView[] = [
    {
      bedId: BED,
      cropId: 'vale_wheat',
      plantedAtMs: 0,
      readyAtMs: 600_000,
      compost: false,
      watch: false,
      tonic: false,
      notified: false,
      status: 'growing',
    },
  ];
  get myFarmPlots(): readonly FarmPlotView[] {
    return [...this.plots];
  }
  get farmPatches() {
    return FARM_PATCHES;
  }
  get professionsState() {
    return { skills: [{ professionId: 'farming', skill: 40, maxSkill: 100 }] };
  }
  farmNowMs(): number {
    return 0;
  }
}

class SheetWorld {
  inventory: InvSlot[] = [
    { itemId: FARM_CROPS.vale_wheat.seedItemId, count: 3 },
    { itemId: 'garden_hoe', count: 1 },
  ];
  myFarmPlots: FarmPlotView[] = [];
  plantCrop = vi.fn();
  get professionsState() {
    return { skills: [{ professionId: 'farming', skill: 40, maxSkill: 100 }] };
  }
}

beforeEach(() => {
  // Both roots carry the index.html classes the scan keys on, plus an inert
  // sibling window so anyOpen really is a scan and not a single-node read.
  document.body.className = '';
  document.body.innerHTML =
    '<div id="harvest-journal-window" class="window panel" style="display: none"></div>' +
    '<div id="plant-sheet-window" class="window panel" style="display: none"></div>' +
    '<div id="deeds-window" class="window panel" style="display: none"></div>';
});

const journalWindow = (): HarvestJournalWindow =>
  new HarvestJournalWindow({
    root: () => document.getElementById('harvest-journal-window') as HTMLElement,
    world: () => new JournalWorld() as unknown as IWorld,
    closeOthers: () => {},
    captureFocus: () => null,
    restoreFocus: () => {},
    onVisibilityChange: sync,
  });

const sheetWindow = (): PlantSheetWindow =>
  new PlantSheetWindow({
    root: () => document.getElementById('plant-sheet-window') as HTMLElement,
    world: () => new SheetWorld() as unknown as IWorld,
    closeOthers: () => {},
    captureFocus: () => null,
    restoreFocus: () => {},
    onVisibilityChange: sync,
  });

// The Perfecting sibling (Masterwrought phase 14). It mints its own
// #perfecting-window root, so no fixture div is seeded for it; an empty world
// (no apex copies) paints the empty state, which is enough for the class arm.
class PerfectingWorld {
  equipment = {};
  equipmentInstances = {};
  inventory: InvSlot[] = [];
  craftingIdentity = { synced: true };
  perfectingInfo(): null {
    return null;
  }
}

const perfectingWindow = (): PerfectingWindow =>
  new PerfectingWindow({
    itemIcon: () => '',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: () => {},
    world: () => new PerfectingWorld() as unknown as IWorld,
    closeOthers: () => {},
    captureFocus: () => null,
    restoreFocus: () => {},
    onVisibilityChange: sync,
  });

describe('the mobile-window-open body class follows the farming windows', () => {
  it('the harvest journal sets the class on open and clears it on close', () => {
    const win = journalWindow();
    expect(document.body.classList.contains('mobile-window-open')).toBe(false);
    win.open();
    expect(document.body.classList.contains('mobile-window-open')).toBe(true);
    win.close();
    expect(document.body.classList.contains('mobile-window-open')).toBe(false);
  });

  it('the plant sheet sets the class on open and clears it on close', () => {
    const win = sheetWindow();
    expect(document.body.classList.contains('mobile-window-open')).toBe(false);
    win.open(BED);
    // The open really opened (canOpenPlantSheet allows a plotless bed), so
    // the class assertion below cannot pass vacuously on a refused open.
    expect((document.getElementById('plant-sheet-window') as HTMLElement).style.display).toBe(
      'flex',
    );
    expect(document.body.classList.contains('mobile-window-open')).toBe(true);
    win.close();
    expect(document.body.classList.contains('mobile-window-open')).toBe(false);
  });

  it('closing one farming window keeps the class while a sibling stays open', () => {
    // The dep must trigger the SCAN, not blind-toggle: with the deeds window
    // still visible, the journal's close leaves the class standing.
    (document.getElementById('deeds-window') as HTMLElement).style.display = 'block';
    const win = journalWindow();
    win.open();
    win.close();
    expect(document.body.classList.contains('mobile-window-open')).toBe(true);
  });

  it('hud wires both windows to syncAnyWindowOpenState (the pinned sibling shape)', () => {
    // Comments stripped (a commented-out dep line must not satisfy the pin)
    // and every anchor GUARDED: an unfound end anchor would widen the slice
    // to the rest of the file, where any OTHER window's dep line goes
    // vacuously green (the unguarded-indexOf trap).
    const hud = stripComments(readFileSync(join(repoRoot, 'src/ui/hud.ts'), 'utf8'));
    const depsSlice = (startAnchor: string, endAnchor: string): string => {
      const start = hud.indexOf(startAnchor);
      const end = hud.indexOf(endAnchor);
      expect(start, `anchor found: ${startAnchor}`).toBeGreaterThan(-1);
      expect(end, `end anchor past start: ${endAnchor}`).toBeGreaterThan(start);
      return hud.slice(start, end);
    };
    const journalDeps = depsSlice(
      'private readonly harvestJournalWindow = new HarvestJournalWindow({',
      'private readonly plantSheetWindow = new PlantSheetWindow({',
    );
    expect(journalDeps).toContain('onVisibilityChange: () => this.syncAnyWindowOpenState()');
    const sheetDeps = depsSlice(
      'private readonly plantSheetWindow = new PlantSheetWindow({',
      'private readonly perfectingWindow = new PerfectingWindow({',
    );
    expect(sheetDeps).toContain('onVisibilityChange: () => this.syncAnyWindowOpenState()');
    // The Perfecting window (Masterwrought phase 14) joins the family with
    // the exact sibling shape.
    const perfectingDeps = depsSlice(
      'private readonly perfectingWindow = new PerfectingWindow({',
      'private readonly reliquaryWindow = new ReliquaryWindow({',
    );
    expect(perfectingDeps).toContain('onVisibilityChange: () => this.syncAnyWindowOpenState()');
  });

  it('the perfecting window sets the class on open and clears it on close', () => {
    const win = perfectingWindow();
    expect(document.body.classList.contains('mobile-window-open')).toBe(false);
    win.open();
    // The open really opened (the window minted its own root and flipped it
    // to flex), so the class assertion below cannot pass vacuously.
    expect((document.getElementById('perfecting-window') as HTMLElement).style.display).toBe(
      'flex',
    );
    expect(document.body.classList.contains('mobile-window-open')).toBe(true);
    win.close();
    expect(document.body.classList.contains('mobile-window-open')).toBe(false);
  });
});
