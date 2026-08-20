// @vitest-environment happy-dom
//
// DOM behavioral guard for the plant sheet window (the bed verbs): the Plant
// control sends IWorldFarming.plantCrop EXACTLY once per activation with the
// CHOSEN knobs and the sheet stays open (the sim's farmPlanted / farmDenied
// events are the feedback, the husk-trade contract); a deny re-arms it, a
// farmPlanted for THIS bed closes with the trap's own focus restore.
//
// The copy assertions deliberately pin LITERAL English rather than comparing
// one t() call against another: a self-comparison would pass with the key
// wrong (tests/harvest_journal_window.test.ts, the same doctrine).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FARM_COMPOST_ITEM_ID,
  FARM_CROPS,
  farmCropSkillThreshold,
} from '../src/sim/content/farm_crops';
import type { FarmPlotView } from '../src/sim/professions/farm_projection';
import { wieldRequirementForTier } from '../src/sim/professions/wield_gate';
import type { InvSlot } from '../src/sim/types';
import type { FarmEvent } from '../src/ui/farm_event_feedback';
import { PlantSheetWindow } from '../src/ui/farming_plant_sheet_window';
import type { IWorld } from '../src/world_api';

// happy-dom rewrites import.meta.url to an http scheme, so the repo root
// comes from the vitest cwd (the localization_fixes idiom).
const repoRoot = process.cwd();

const WHEAT = FARM_CROPS.vale_wheat;
const CARROT = FARM_CROPS.brook_carrot;
const RICE = FARM_CROPS.marsh_rice;
const BED = 'bed_eastbrook_1';
const TIER2_SKILL = Math.max(farmCropSkillThreshold(2), wieldRequirementForTier(2));

class StubWorld {
  inventory: InvSlot[] = [
    { itemId: WHEAT.seedItemId, count: 3 },
    { itemId: 'garden_hoe', count: 1 },
    { itemId: FARM_COMPOST_ITEM_ID, count: 1 },
  ];
  myFarmPlots: FarmPlotView[] = [];
  farmingSkill = TIER2_SKILL;
  plantCrop = vi.fn();
  get professionsState() {
    return { skills: [{ professionId: 'farming', skill: this.farmingSkill, maxSkill: 100 }] };
  }
}

let root: HTMLElement;
let world: StubWorld;
let restoredTo: HTMLElement | null | undefined;
let closeOthersSpy: ReturnType<typeof vi.fn<() => void>>;

const makeWindow = (captureFocus: () => HTMLElement | null = () => null): PlantSheetWindow =>
  new PlantSheetWindow({
    root: () => root,
    world: () => world as unknown as IWorld,
    closeOthers: closeOthersSpy,
    captureFocus,
    restoreFocus: (target) => {
      restoredTo = target;
    },
  });

const planted = (bedId: string): FarmEvent =>
  ({ type: 'farmPlanted', pid: 1, bedId, cropId: WHEAT.id }) as FarmEvent;

const denied = (bedId: string): FarmEvent =>
  ({ type: 'farmDenied', pid: 1, reason: 'no_seed', bedId }) as FarmEvent;

beforeEach(() => {
  document.body.innerHTML = '<div id="plant-sheet-window"></div>';
  root = document.getElementById('plant-sheet-window') as HTMLElement;
  world = new StubWorld();
  restoredTo = undefined;
  closeOthersSpy = vi.fn<() => void>();
});

describe('plant sheet window: paint', () => {
  it('renders the title, the sowable seed with its aria, and the Plant control', () => {
    makeWindow().open(BED);
    expect(root.querySelector('#plant-sheet-title')?.textContent).toBe('Plant a Crop');
    const seed = root.querySelector<HTMLElement>('[data-seed-crop]');
    expect(seed?.dataset.seedCrop).toBe(WHEAT.id);
    expect(seed?.getAttribute('aria-label')).toBe('Sow Vale Wheat Seed');
    expect(seed?.getAttribute('aria-checked')).toBe('true');
    expect(root.querySelector('[data-plant]')?.textContent).toBe('Plant');
  });

  it('exposes the seed rows as a radiogroup, the locked rows as a plain list (a11y batch)', () => {
    // Single-select semantics: picking one seed un-picks the rest, so the
    // rows are radios in a named group, never independent toggles. The li
    // wrappers are presentational so the radios are the group's owned
    // children, and the locked rows live OUTSIDE the group: they are not
    // options and must not dilute the radio count AT reports.
    world.inventory.push({ itemId: RICE.seedItemId, count: 1 }); // gated -> locked row
    makeWindow().open(BED);
    const group = root.querySelector<HTMLElement>('[role="radiogroup"]');
    expect(group).not.toBeNull();
    expect(group?.getAttribute('aria-labelledby')).toBe('plant-sheet-title');
    const radios = [...(group?.querySelectorAll('[role="radio"]') ?? [])];
    expect(radios.length).toBeGreaterThan(0);
    for (const radio of radios) {
      expect(radio.classList.contains('ps-seed')).toBe(true);
      expect(radio.getAttribute('aria-checked')).toMatch(/^(true|false)$/);
      expect((radio.parentElement as HTMLElement).getAttribute('role')).toBe('none');
    }
    // The locked row sits in its own plain list, with no radio inside.
    const locked = root.querySelector<HTMLElement>('.ps-locked');
    expect(locked).not.toBeNull();
    expect(locked?.closest('[role="radiogroup"]')).toBeNull();
    expect(locked?.closest('ul')?.getAttribute('role')).toBe('list');
  });

  it('reports aria-busy while a Plant send is in flight, and only then (a11y batch)', () => {
    const win = makeWindow();
    win.open(BED);
    expect(root.getAttribute('aria-busy')).toBe('false');
    root.querySelector<HTMLElement>('[data-plant]')?.click();
    expect(world.plantCrop).toHaveBeenCalledTimes(1);
    expect(root.getAttribute('aria-busy')).toBe('true');
    // The deny that answers it clears the affordance with the send arm.
    win.notifyFarmEvent(denied(BED));
    expect(root.getAttribute('aria-busy')).toBe('false');
    // The error-toast forward (dead/busy answer) clears it the same way.
    root.querySelector<HTMLElement>('[data-plant]')?.click();
    expect(root.getAttribute('aria-busy')).toBe('true');
    win.notifyErrorToast();
    expect(root.getAttribute('aria-busy')).toBe('false');
    // A close never strands the stale busy state for the next open.
    root.querySelector<HTMLElement>('[data-plant]')?.click();
    expect(root.getAttribute('aria-busy')).toBe('true');
    win.close();
    win.open(BED);
    expect(root.getAttribute('aria-busy')).toBe('false');
  });

  it('renders ONLY sowable seeds as pick rows; a gated one is a reasoned locked row', () => {
    world.inventory.push({ itemId: RICE.seedItemId, count: 1 });
    makeWindow().open(BED);
    const picks = [...root.querySelectorAll<HTMLElement>('[data-seed-crop]')];
    expect(picks.map((el) => el.dataset.seedCrop)).toEqual([WHEAT.id]);
    // The tier-1 hoe cannot work the tier-2 crop: the row says the real gate.
    expect(root.querySelector('.ps-locked .ps-reason')?.textContent).toBe(
      'Requires a tier 2 farming hoe',
    );
  });

  it('renders the empty state when no seed is held at all', () => {
    world.inventory = [{ itemId: 'garden_hoe', count: 1 }];
    makeWindow().open(BED);
    expect(root.querySelector('.ps-empty')?.textContent).toBe(
      'You have no seed you can sow at this bed.',
    );
    expect(root.querySelector('[data-plant]')).toBeNull();
  });

  it('names the knobs through the item catalog and the careWatch label', () => {
    makeWindow().open(BED);
    const names = [...root.querySelectorAll('.ps-knob-name')].map((el) => el.textContent);
    expect(names).toEqual(['Compost', "Farmer's Watch", 'Growth Tonic']);
  });

  it('disables an unaffordable knob and says why through the denied family line', () => {
    makeWindow().open(BED);
    const tonic = root.querySelector<HTMLButtonElement>('[data-knob="tonic"]');
    expect(tonic?.disabled).toBe(true);
    expect(tonic?.querySelector('.ps-knob-short')?.textContent).toBe('You have no growth tonic.');
    const compost = root.querySelector<HTMLButtonElement>('[data-knob="compost"]');
    expect(compost?.disabled).toBe(false);
  });

  it('clears the transient overlays once on a fresh open, never on a same-bed re-press', () => {
    const win = makeWindow();
    win.open(BED);
    expect(closeOthersSpy).toHaveBeenCalledTimes(1);
    win.open(BED);
    expect(closeOthersSpy).toHaveBeenCalledTimes(1);
  });

  it('marks the root as a labelled dialog on open (the markDialogRoot contract)', () => {
    makeWindow().open(BED);
    expect(root.getAttribute('role')).toBe('dialog');
    expect(root.getAttribute('aria-labelledby')).toBe('plant-sheet-title');
    expect(root.getAttribute('tabindex')).toBe('-1');
  });

  it('paints the locked rows WITH the empty line when every held seed is gated', () => {
    // All copies locked: no pick rows, so no Plant control, but the locked
    // list still explains each held seed; the empty line beneath is then the
    // honest summary (nothing sowable), not a contradiction.
    world.inventory = [
      { itemId: WHEAT.seedItemId, count: 2, instance: { locked: true } } as InvSlot,
      { itemId: 'garden_hoe', count: 1 },
    ];
    makeWindow().open(BED);
    expect(root.querySelectorAll('[data-seed-crop]')).toHaveLength(0);
    expect(root.querySelectorAll('.ps-locked')).toHaveLength(1);
    expect(root.querySelector('.ps-locked .ps-reason')?.textContent).toBe(
      'An item that would pay for that is locked.',
    );
    expect(root.querySelector('[data-plant]')).toBeNull();
    expect(root.querySelector('.ps-empty')).not.toBeNull();
  });

  it('locks every row by skill when professionsState has no farming row (the ?? 0 default)', () => {
    // A fresh character has no farming skill row at all; the window's read
    // must resolve to skill 0 and gate a tier-2 seed on the skill line.
    const rowless = {
      inventory: [{ itemId: RICE.seedItemId, count: 1 }] as readonly InvSlot[],
      myFarmPlots: [] as readonly FarmPlotView[],
      professionsState: { skills: [] },
      plantCrop: vi.fn(),
    };
    const win = new PlantSheetWindow({
      root: () => root,
      world: () => rowless as unknown as IWorld,
      closeOthers: () => {},
      captureFocus: () => null,
      restoreFocus: () => {},
    });
    win.open(BED);
    expect(root.querySelectorAll('[data-seed-crop]')).toHaveLength(0);
    expect(root.querySelectorAll('.ps-locked')).toHaveLength(1);
    expect(root.querySelector('.ps-locked .ps-reason')?.textContent).toBe(
      'Your Farming skill is too low for that crop.',
    );
  });

  it('refuses to open at a bed the caller already grows in (the canOpen guard)', () => {
    world.myFarmPlots = [
      {
        bedId: BED,
        cropId: WHEAT.id,
        plantedAtMs: 0,
        readyAtMs: 1000,
        compost: false,
        watch: false,
        tonic: false,
        notified: false,
        status: 'growing',
      },
    ];
    const win = makeWindow();
    win.open(BED);
    expect(win.isOpen).toBe(false);
    expect(root.innerHTML).toBe('');
  });
});

describe('plant sheet window: selection and knobs', () => {
  it('re-picking a seed row moves aria-checked and the knob picks survive the repaint', () => {
    world.inventory.push({ itemId: CARROT.seedItemId, count: 2 });
    makeWindow().open(BED);
    root.querySelector<HTMLElement>('[data-knob="compost"]')?.click();
    root.querySelector<HTMLElement>(`[data-seed-crop="${CARROT.id}"]`)?.click();
    const pressed = [...root.querySelectorAll<HTMLElement>('[data-seed-crop]')].map((el) => [
      el.dataset.seedCrop,
      el.getAttribute('aria-checked'),
    ]);
    expect(pressed).toEqual([
      [WHEAT.id, 'false'],
      [CARROT.id, 'true'],
    ]);
    expect(root.querySelector('[data-knob="compost"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('flips a knob toggle in place through aria-pressed', () => {
    makeWindow().open(BED);
    const compost = root.querySelector<HTMLElement>('[data-knob="compost"]');
    expect(compost?.getAttribute('aria-pressed')).toBe('false');
    compost?.click();
    expect(compost?.getAttribute('aria-pressed')).toBe('true');
    compost?.click();
    expect(compost?.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('plant sheet window: the Plant activation', () => {
  it('sends plantCrop once with the bed, the picked crop, and the CHOSEN knobs, staying open', () => {
    const win = makeWindow();
    win.open(BED);
    root.querySelector<HTMLElement>('[data-knob="compost"]')?.click();
    root.querySelector<HTMLElement>('[data-plant]')?.click();
    expect(world.plantCrop).toHaveBeenCalledTimes(1);
    expect(world.plantCrop).toHaveBeenCalledWith(BED, WHEAT.id, { compost: true });
    expect(win.isOpen).toBe(true);
  });

  it('does NOT double-send on a second click before any event answers', () => {
    const win = makeWindow();
    win.open(BED);
    root.querySelector<HTMLElement>('[data-plant]')?.click();
    root.querySelector<HTMLElement>('[data-plant]')?.click();
    expect(world.plantCrop).toHaveBeenCalledTimes(1);
    expect(win.isOpen).toBe(true);
  });

  it('a deny leaves the sheet open, sends nothing itself, and re-arms the control', () => {
    const win = makeWindow();
    win.open(BED);
    root.querySelector<HTMLElement>('[data-plant]')?.click();
    win.notifyFarmEvent(denied(BED));
    // The deny itself sent nothing and the sheet is still up.
    expect(world.plantCrop).toHaveBeenCalledTimes(1);
    expect(win.isOpen).toBe(true);
    // The deny repainted from the live bags, so the control is re-armed.
    root.querySelector<HTMLElement>('[data-plant]')?.click();
    expect(world.plantCrop).toHaveBeenCalledTimes(2);
  });

  it('closes on a farmPlanted for THIS bed with the focus-restore arm, not for another', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    const win = makeWindow(() => opener);
    win.open(BED);
    root.querySelector<HTMLElement>('[data-plant]')?.click();
    win.notifyFarmEvent(planted('bed_eastbrook_2'));
    expect(win.isOpen).toBe(true);
    win.notifyFarmEvent(planted(BED));
    expect(win.isOpen).toBe(false);
    expect(root.style.display).toBe('none');
    expect(restoredTo).toBe(opener);
  });

  it('closes from its own X button with the aria-labelled close control', () => {
    const win = makeWindow();
    win.open(BED);
    const close = root.querySelector<HTMLElement>('[data-close]');
    expect(close?.getAttribute('aria-label')).toBe('Close the plant sheet');
    close?.click();
    expect(win.isOpen).toBe(false);
  });
});

describe('plant sheet window: re-open, event filters, and staleness (the review arms)', () => {
  it('a re-press at the SAME bed keeps the picks and the in-flight send', () => {
    world.inventory.push({ itemId: CARROT.seedItemId, count: 2 });
    const win = makeWindow();
    win.open(BED);
    root.querySelector<HTMLElement>('[data-knob="compost"]')?.click();
    root.querySelector<HTMLElement>(`[data-seed-crop="${CARROT.id}"]`)?.click();
    root.querySelector<HTMLElement>('[data-plant]')?.click();
    expect(world.plantCrop).toHaveBeenCalledTimes(1);
    win.open(BED);
    // Picks survived the re-press...
    expect(
      root.querySelector(`[data-seed-crop="${CARROT.id}"]`)?.getAttribute('aria-checked'),
    ).toBe('true');
    expect(root.querySelector('[data-knob="compost"]')?.getAttribute('aria-pressed')).toBe('true');
    // ...and so did the send arm: the re-press is not a re-send license.
    root.querySelector<HTMLElement>('[data-plant]')?.click();
    expect(world.plantCrop).toHaveBeenCalledTimes(1);
  });

  it('opening a DIFFERENT bed resets the picks, so a knob never rides between beds', () => {
    const win = makeWindow();
    win.open(BED);
    root.querySelector<HTMLElement>('[data-knob="compost"]')?.click();
    win.open('bed_eastbrook_2');
    root.querySelector<HTMLElement>('[data-plant]')?.click();
    expect(world.plantCrop).toHaveBeenCalledTimes(1);
    expect(world.plantCrop).toHaveBeenCalledWith('bed_eastbrook_2', WHEAT.id, {});
  });

  it("a deny for someone ELSE's bed neither re-arms nor repaints this sheet", () => {
    const win = makeWindow();
    win.open(BED);
    root.querySelector<HTMLElement>('[data-plant]')?.click();
    win.notifyFarmEvent(denied('bed_eastbrook_2'));
    root.querySelector<HTMLElement>('[data-plant]')?.click();
    expect(world.plantCrop).toHaveBeenCalledTimes(1);
  });

  it('a bedId-free deny (the husk-trade family) re-arms the control', () => {
    const win = makeWindow();
    win.open(BED);
    root.querySelector<HTMLElement>('[data-plant]')?.click();
    win.notifyFarmEvent({ type: 'farmDenied', pid: 1, reason: 'no_husks' } as FarmEvent);
    root.querySelector<HTMLElement>('[data-plant]')?.click();
    expect(world.plantCrop).toHaveBeenCalledTimes(2);
  });

  it('an error toast re-arms the Plant control without repainting (the dead/busy heal)', () => {
    // The sim's dead and busy plantCrop gates answer through ctx.error, not
    // farmDenied; without the Hud's notifyErrorToast forward the control
    // stayed dead until a close. The re-arm must NOT repaint (an error
    // changes no bag state), which the sentinel attribute proves.
    const win = makeWindow();
    win.open(BED);
    root.querySelector<HTMLElement>('[data-plant]')?.click();
    expect(world.plantCrop).toHaveBeenCalledTimes(1);
    root.querySelector('#plant-sheet-title')?.setAttribute('data-qa-sentinel', '1');
    win.notifyErrorToast();
    expect(root.querySelector('#plant-sheet-title')?.getAttribute('data-qa-sentinel')).toBe('1');
    root.querySelector<HTMLElement>('[data-plant]')?.click();
    expect(world.plantCrop).toHaveBeenCalledTimes(2);
  });

  it('an error toast on a closed sheet is a no-op', () => {
    const win = makeWindow();
    win.notifyErrorToast();
    expect(root.innerHTML).toBe('');
    expect(win.isOpen).toBe(false);
  });

  it('a farmPlanted for ANOTHER bed clears the send arm without closing (no dead control)', () => {
    const win = makeWindow();
    win.open(BED);
    root.querySelector<HTMLElement>('[data-plant]')?.click();
    win.notifyFarmEvent(planted('bed_eastbrook_2'));
    expect(win.isOpen).toBe(true);
    root.querySelector<HTMLElement>('[data-plant]')?.click();
    expect(world.plantCrop).toHaveBeenCalledTimes(2);
  });

  it('a picked knob that stops being affordable un-picks itself before the next send', () => {
    const win = makeWindow();
    win.open(BED);
    root.querySelector<HTMLElement>('[data-knob="compost"]')?.click();
    root.querySelector<HTMLElement>('[data-plant]')?.click();
    expect(world.plantCrop).toHaveBeenCalledWith(BED, WHEAT.id, { compost: true });
    // The compost left the bags (a mail, a trade, another window)...
    world.inventory = world.inventory.filter((slot) => slot.itemId !== FARM_COMPOST_ITEM_ID);
    // ...and the deny-driven repaint un-picks the short knob.
    win.notifyFarmEvent(denied(BED));
    root.querySelector<HTMLElement>('[data-plant]')?.click();
    expect(world.plantCrop).toHaveBeenCalledTimes(2);
    expect(world.plantCrop).toHaveBeenLastCalledWith(BED, WHEAT.id, {});
  });

  it('a repaint over a bed that became MY plot closes the sheet (the null-model race)', () => {
    const win = makeWindow();
    win.open(BED);
    world.myFarmPlots = [
      {
        bedId: BED,
        cropId: WHEAT.id,
        plantedAtMs: 0,
        readyAtMs: 1000,
        compost: false,
        watch: false,
        tonic: false,
        notified: false,
        status: 'growing',
      },
    ];
    win.notifyFarmEvent(denied(BED));
    expect(win.isOpen).toBe(false);
  });

  it('relocalize repaints an open sheet and is a no-op on a closed one', () => {
    const win = makeWindow();
    win.relocalize();
    expect(root.innerHTML).toBe('');
    win.open(BED);
    root.querySelector<HTMLElement>('[data-knob="compost"]')?.click();
    win.relocalize();
    // The repaint rebuilt the subtree from live state; the pick survived.
    expect(root.querySelector('#plant-sheet-title')?.textContent).toBe('Plant a Crop');
    expect(root.querySelector('[data-knob="compost"]')?.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('plant sheet window: the root div ships in BOTH entries', () => {
  // The painter resolves #plant-sheet-window; a dropped div in either entry
  // is a runtime throw for every bed press there (the crafting_launcher
  // idiom: read the real entry HTML, never a fixture).
  it.each(['index.html', 'play.html'])('%s carries id="plant-sheet-window"', (entry) => {
    const html = readFileSync(join(repoRoot, entry), 'utf8');
    // Exactly once: a duplicate id would make querySelector's pick arbitrary
    // and a comment-only occurrence would leave the painter with no root.
    expect(html.split('id="plant-sheet-window"').length - 1).toBe(1);
  });
});

describe('plant sheet window: the mobile safe-area rule', () => {
  // A CSS-text pin (css_corpus and styles_extraction pass with or without
  // the inset terms, so nothing else reds if they are dropped): the touch
  // card's caps must clamp against the JS-synced app viewport (the
  // layout.css .window contract, never raw viewport units) and clear an
  // ASYMMETRIC notch by twice the larger inset on each axis.
  it('clamps both caps by --app-vw/--app-vh and both safe-area axes', () => {
    const css = readFileSync(join(repoRoot, 'src/styles/hud.mobile.css'), 'utf8');
    const anchor = 'body.mobile-touch #plant-sheet-window {';
    const at = css.indexOf(anchor);
    expect(at, 'the mobile plant sheet rule must exist').toBeGreaterThanOrEqual(0);
    expect(css.indexOf(anchor, at + 1), 'the rule must be unique').toBe(-1);
    const end = css.indexOf('\n  }', at);
    expect(end).toBeGreaterThan(at);
    const block = css.slice(at, end);
    expect(block).toContain('var(--app-vw');
    expect(block).toContain('var(--app-vh');
    for (const side of ['left', 'right', 'top', 'bottom']) {
      expect(block).toContain(`env(safe-area-inset-${side}`);
    }
  });
});

describe('plant sheet window: the ClientWorld mirror shape', () => {
  it('paints identically over a plain decoded bag behind a stable array identity', () => {
    const mirrorWorld = {
      inventory: [
        { itemId: WHEAT.seedItemId, count: 3 },
        { itemId: 'garden_hoe', count: 1 },
        { itemId: FARM_COMPOST_ITEM_ID, count: 1 },
      ] as readonly InvSlot[],
      myFarmPlots: [] as readonly FarmPlotView[],
      professionsState: {
        skills: [{ professionId: 'farming', skill: TIER2_SKILL, maxSkill: 100 }],
      },
      plantCrop: vi.fn(),
    };
    const win = new PlantSheetWindow({
      root: () => root,
      world: () => mirrorWorld as unknown as IWorld,
      closeOthers: () => {},
      captureFocus: () => null,
      restoreFocus: () => {},
    });
    win.open(BED);
    expect(root.querySelector('[data-seed-crop]')?.getAttribute('aria-label')).toBe(
      'Sow Vale Wheat Seed',
    );
    root.querySelector<HTMLElement>('[data-plant]')?.click();
    expect(mirrorWorld.plantCrop).toHaveBeenCalledWith(BED, WHEAT.id, {});
    win.close();
  });
});
