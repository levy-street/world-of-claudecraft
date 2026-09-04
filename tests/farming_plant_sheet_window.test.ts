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
import type { FarmEvent } from '../src/ui/hud/professions/farm_event_feedback';
import { PlantSheetWindow } from '../src/ui/hud/professions/farming_plant_sheet_window';
import { bindPointerBlur, POINTER_FOCUS_PARK_SELECTOR } from '../src/ui/pointer_blur';
import type { IWorld } from '../src/world_api';
import { stripComments } from './helpers/strip_comments';

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

  it('farmPlanted answers clear the busy state: foreign bed re-arms, same bed closes', () => {
    // Production deliberately clears the send arm on ANY farmPlanted (the
    // answer arrived; an unmatched one must not leave the Plant control dead
    // forever). The busy affordance follows the same rule: a foreign bed's
    // plant clears aria-busy and leaves the sheet open; the same bed's plant
    // closes the window, whose close path also resets the attribute.
    const win = makeWindow();
    win.open(BED);
    root.querySelector<HTMLElement>('[data-plant]')?.click();
    expect(world.plantCrop).toHaveBeenCalledTimes(1);
    expect(root.getAttribute('aria-busy')).toBe('true');
    win.notifyFarmEvent(planted('bed_eastbrook_2'));
    expect(root.getAttribute('aria-busy')).toBe('false');
    expect(root.style.display).toBe('flex');
    root.querySelector<HTMLElement>('[data-plant]')?.click();
    expect(root.getAttribute('aria-busy')).toBe('true');
    win.notifyFarmEvent(planted(BED));
    expect(root.style.display).toBe('none');
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
    expect(root.querySelector('.prof-empty')?.textContent).toBe(
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
    expect(root.querySelector('.prof-empty')).not.toBeNull();
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

  it('the seed radios are ONE roving tab stop: arrows move the pick and focus, Home/End jump', () => {
    // APG roving tabindex over the radiogroup: only the checked seed is in the
    // Tab order, arrows move the pick and the focus together (the repaint
    // carries focus by the seed's key), Home/End jump, the ends wrap, and a
    // key the roving core does not own falls through untouched.
    world.inventory.push({ itemId: CARROT.seedItemId, count: 2 });
    makeWindow().open(BED);
    const seeds = (): HTMLButtonElement[] => [
      ...root.querySelectorAll<HTMLButtonElement>('[data-seed-crop]'),
    ];
    const key = (el: HTMLElement, k: string): boolean =>
      el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    const picked = (): Array<string | null> => seeds().map((el) => el.getAttribute('aria-checked'));
    const tabs = (): Array<string | null> => seeds().map((el) => el.getAttribute('tabindex'));
    expect(seeds().length).toBe(2);
    expect(picked()).toEqual(['true', 'false']);
    expect(tabs()).toEqual(['0', '-1']);
    seeds()[0].focus();
    expect(key(seeds()[0], 'ArrowDown')).toBe(false);
    expect(picked()).toEqual(['false', 'true']);
    expect(tabs()).toEqual(['-1', '0']);
    expect(document.activeElement).toBe(seeds()[1]);
    // Wrap past the end, then Home / End.
    key(seeds()[1], 'ArrowRight');
    expect(picked()).toEqual(['true', 'false']);
    expect(document.activeElement).toBe(seeds()[0]);
    key(seeds()[0], 'End');
    expect(picked()).toEqual(['false', 'true']);
    expect(document.activeElement).toBe(seeds()[1]);
    key(seeds()[1], 'Home');
    expect(picked()).toEqual(['true', 'false']);
    expect(document.activeElement).toBe(seeds()[0]);
    // Unowned key: no preventDefault, no repaint, the pick stands.
    const before = seeds()[0];
    expect(key(before, 'Tab')).toBe(true);
    expect(seeds()[0]).toBe(before);
    // Nothing here sends: the pick is view state until Plant is activated.
    expect(world.plantCrop).not.toHaveBeenCalled();
  });

  it('a focus key that is not a legal CSS selector cannot break the repaint', () => {
    // This sheet keys its controls `seed:<cropId>` and `knob:<knobId>`,
    // content ids spliced verbatim, and `data-focus-key` is ONE FLAT namespace
    // shared with every other window, so the key read back here can be any
    // member of it. A key holding a double quote closes an attribute
    // selector's own string early, so the interpolating spelling this window
    // used to run, `root.querySelector('[data-focus-key="' + key + '"]')`,
    // raises a SyntaxError from inside paint(). It escapes into whatever drove
    // the repaint: the re-open below never reaches the rest of open(), and an
    // arrow-key seed pick would lose the radiogroup mid-roving.
    const win = makeWindow();
    win.open(BED);
    const keyed = document.createElement('button');
    keyed.type = 'button';
    keyed.dataset.focusKey = 'seed:vale"wheat';
    root.appendChild(keyed);
    keyed.focus();
    expect(document.activeElement).toBe(keyed);

    // A re-press at the same bed is the sheet's own repaint path (open() with
    // the window already up on this bed refreshes in place).
    expect(() => win.open(BED)).not.toThrow();
    // The repaint really ran: the planted node is gone with the old subtree
    // and the seed rows are back, so the case is not passing by never
    // reaching the restore.
    expect(root.contains(keyed)).toBe(false);
    expect(root.querySelectorAll('[data-seed-crop]').length).toBeGreaterThan(0);
    // The key resolves to nothing in the rebuilt tree, so the ladder degrades
    // to its Close rung rather than stranding the player on <body> with the
    // dialog still up.
    expect(document.activeElement).toBe(root.querySelector('[data-close]'));
  });

  it('flips a knob toggle in place through aria-pressed', () => {
    makeWindow().open(BED);
    const compost = root.querySelector<HTMLElement>('[data-knob="compost"]');
    // The class is load-bearing beyond styling: the forced-colors underline
    // cue selects .ps-knob[aria-pressed="true"], so the markup must carry it
    // or the source-contract CSS pin below guards a selector nothing wears.
    expect(compost?.classList.contains('ps-knob')).toBe(true);
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

  it('a bedId-free deny (the husk-trade family) does NOT re-arm the control', () => {
    // The race this closes: a husk trade or a feast refusal landing while a
    // plant is in flight carries no bedId, so accepting it as the answer let
    // a second click leave before the real deny arrived. Every deny that CAN
    // answer a plant carries the bed it was asked about
    // (tests/farm_deny_bed_correlation.test.ts pins that in the sim), so an
    // unlabelled deny is provably somebody else's and is ignored here.
    const win = makeWindow();
    win.open(BED);
    root.querySelector<HTMLElement>('[data-plant]')?.click();
    win.notifyFarmEvent({ type: 'farmDenied', pid: 1, reason: 'no_husks' } as FarmEvent);
    root.querySelector<HTMLElement>('[data-plant]')?.click();
    expect(world.plantCrop).toHaveBeenCalledTimes(1);
    // The sheet is not stuck either: its own bed's deny still re-arms it.
    win.notifyFarmEvent(denied(BED));
    root.querySelector<HTMLElement>('[data-plant]')?.click();
    expect(world.plantCrop).toHaveBeenCalledTimes(2);
  });

  it('a bedId-free deny does not repaint the sheet either', () => {
    // The repaint half of the same rule: an unrelated deny changed nothing
    // about this bed, so rebuilding the subtree (and with it the focus carry)
    // is work the player never asked for.
    const win = makeWindow();
    win.open(BED);
    root.querySelector('#plant-sheet-title')?.setAttribute('data-qa-sentinel', '1');
    win.notifyFarmEvent({ type: 'farmDenied', pid: 1, reason: 'no_farmer' } as FarmEvent);
    expect(root.querySelector('#plant-sheet-title')?.getAttribute('data-qa-sentinel')).toBe('1');
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

describe('plant sheet window: the pointer-only focus drop the v0.40.0 sync added', () => {
  // The sheet root joined CHROME_GUARDED_PANELS at the Phase 11d QA sync of
  // release tip 35a6481825: the release extracted hud.ts's inline key-guard
  // loop into src/ui/chrome_focus_wiring.ts, and taking that extraction gave
  // this window the pointer-only focus drop it never had before. The wiring's
  // own suite proves the mechanism over a hand-rolled fake root; this proves it
  // over the sheet's REAL markup: the park target, the keyboard carve-out, and
  // that a repaint over a parked root sends nothing. The ladder's own refusal to
  // treat a parked root as a focused control is NOT this arm's coverage (a Phase
  // 11d QA mutation confirmed it survives here); that mechanism is pinned in
  // tests/focus_restore.test.ts, where the same mutation reds two arms.
  it('parks a mouse click on the root, leaves a keyboard click focused, and repaints clean', () => {
    const win = makeWindow();
    win.open(BED);
    bindPointerBlur(root);
    const seed = root.querySelector<HTMLElement>('[data-seed-crop]');
    if (!seed) throw new Error('no seed control to click');
    const seedCrop = seed.getAttribute('data-seed-crop');

    // A MOUSE click (detail 1): focus parks on the dialog root, not the button
    // and not the body, so the window's Tab trap stays armed.
    seed.focus();
    seed.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(document.activeElement).toBe(root);
    expect(root.matches(POINTER_FOCUS_PARK_SELECTOR)).toBe(true);

    // A KEYBOARD click (detail 0) is untouched: the control keeps focus.
    const knob = root.querySelector<HTMLElement>('[data-knob="compost"]');
    if (!knob) throw new Error('no knob control to click');
    knob.focus();
    knob.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(document.activeElement).toBe(knob);

    // The repaint over a parked root restores nothing and plants nothing: the
    // pick the mouse click made survives, and no send was issued by either.
    win.relocalize();
    expect(root.querySelector(`[data-seed-crop="${seedCrop}"]`)?.getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(world.plantCrop).not.toHaveBeenCalled();
  });
});

describe('plant sheet window: the root div ships in BOTH entries', () => {
  // The painter resolves #plant-sheet-window; a dropped div in either entry
  // is a runtime throw for every bed press there (the crafting_launcher
  // idiom: read the real entry HTML, never a fixture).
  it.each(['index.html', 'play.html'])('%s carries id="plant-sheet-window"', (entry) => {
    // Comments stripped FIRST (the entry_window_parity idiom): the raw count is
    // comment-gameable, so a commented-out div kept this green while the root was
    // gone, which is the opposite of what the line below claimed. Found by the
    // Phase 11d QA pin audit, on the twin of this pin.
    const html = readFileSync(join(repoRoot, entry), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    // Exactly once: a duplicate id would make querySelector's pick arbitrary,
    // and zero is a TypeError at HUD construction rather than one dead window,
    // because the root is a CHROME_GUARDED_PANELS entry wireChromeFocus resolves.
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

describe('plant sheet window (source contract)', () => {
  // Same family contract as the harvest journal's source pin: the sheet's
  // components rule is flex-column (#plant-sheet-window flex-direction:
  // column; .ps-body flex: 1 1 auto), so every show-site writes 'flex' and
  // every read-guard tests the value it writes (the #bags precedent in
  // tests/client_shell.test.ts). The behavioral display pin above also reds
  // on a whole-window flip; this source pin's added value is a SECOND
  // show-site or a read-guard shape no behavioral case drives, plus the CSS
  // half below. Comments are stripped so prose about 'block' can neither
  // satisfy nor trip a needle.
  const sheetSrc = stripComments(
    readFileSync(join(repoRoot, 'src/ui/hud/professions/farming_plant_sheet_window.ts'), 'utf8'),
  );

  it('opens and closes with inline flex, with no block write or block-shaped guard', () => {
    expect(sheetSrc).toContain("root.style.display = 'flex';");
    expect(sheetSrc).toContain("root.style.display = 'none';");
    expect(sheetSrc).toContain("return this.deps.root().style.display === 'flex';");
    expect(sheetSrc).not.toContain("style.display = 'block'");
    expect(sheetSrc).not.toContain("=== 'block'");
    expect(sheetSrc).not.toContain("!== 'block'");
  });

  it('keeps the flex-column components rule the inline flex engages', () => {
    const componentsCss = readFileSync(join(repoRoot, 'src/styles/components.css'), 'utf8');
    expect(componentsCss).toMatch(/#plant-sheet-window \{[^}]*flex-direction: column;/s);
  });

  it('keeps the forced-colors non-color cue for the picked seed and armed knob', () => {
    // The picked/armed state is gold-hue-only in normal mode, so the
    // forced-colors block in base.css must carry a redundant non-color cue
    // for both selectors (the #tf-name.hostile idiom). Extract the block by
    // BALANCED BRACES, not by slicing to the next media query, so a rule
    // parked after the block's closing brace cannot satisfy the pin
    // (tests/quest_marker_styles.test.ts is the precedent), and walk the
    // COMMENT-STRIPPED sheet (the shared strip idiom, same as sheetSrc
    // above): a CSS comment carrying a brace inside the forced-colors block
    // would desync the raw depth count and truncate or overrun the extracted
    // block (the F6 brace-walk remark, Phase 11 QA; quest_marker_styles
    // already strips, this walk was the remaining raw reader).
    const baseCss = stripComments(readFileSync(join(repoRoot, 'src/styles/base.css'), 'utf8'));
    const marker = '@media (forced-colors: active)';
    const start = baseCss.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const open = baseCss.indexOf('{', start);
    let depth = 1;
    let end = open + 1;
    while (end < baseCss.length && depth > 0) {
      if (baseCss[end] === '{') depth++;
      else if (baseCss[end] === '}') depth--;
      end++;
    }
    const forcedBlock = baseCss.slice(start, end);
    expect(forcedBlock).toMatch(
      /\.ps-seed\[aria-checked="true"\],\s*\.ps-knob\[aria-pressed="true"\]\s*\{[^}]*text-decoration:\s*underline;/s,
    );
  });
});
