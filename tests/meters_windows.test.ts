// @vitest-environment happy-dom
//
// The detachable meter windows: popping Healing / Threat out of the tabbed
// damage window, docking them back, and each panel keeping its own segment
// paging and movable/resizable frame. The geometry math is covered by
// tests/meters_frame_core.test.ts and the bar model by
// tests/meters_rows_view.test.ts; this file pins the wiring between them.

import { beforeEach, describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/sim/types';
import { Meters } from '../src/ui/meters';
import type { IWorld } from '../src/world_api';

const detachedMarkup = (id: string) => `
  <div id="${id}" class="panel mt-panel">
    <div class="panel-title">
      <span class="mt-title-label"></span>
      <button type="button" class="mt-prev"></button>
      <button type="button" class="mt-next"></button>
      <button type="button" class="mt-close"></button>
    </div>
    <div class="mt-view"></div>
    <div class="mt-sub"></div>
    <div class="mt-hint"></div>
    <div class="mt-rows"></div>
  </div>`;

const MARKUP = `
  ${detachedMarkup('heal-window')}
  ${detachedMarkup('threat-window')}
  <div id="meters-window" class="panel mt-panel">
    <div class="panel-title">
      <span class="mt-tabs">
        <button type="button" class="mt-tab on" data-tab="dmg"></button>
        <button type="button" class="mt-tab" data-tab="heal"></button>
        <button type="button" class="mt-tab" data-tab="threat"></button>
      </span>
      <button type="button" class="mt-prev"></button>
      <button type="button" class="mt-next"></button>
      <button type="button" class="mt-close"></button>
    </div>
    <div class="mt-view"></div>
    <div class="mt-sub"></div>
    <div class="mt-hint"></div>
    <div class="mt-rows"></div>
  </div>`;

function fakeWorld(): IWorld {
  const entities = new Map<number, any>();
  entities.set(1, { id: 1, kind: 'player', name: 'Hero', templateId: 'warlock' });
  entities.set(2, { id: 2, kind: 'player', name: 'Pal', templateId: 'priest' });
  entities.set(51, {
    id: 51,
    kind: 'mob',
    name: 'Gorrak',
    templateId: 'gorrak',
    maxHp: 400,
    dead: false,
    aggroTargetId: 1,
    threat: new Map<number, number>([
      [1, 100],
      [2, 40],
    ]),
  });
  return {
    entities,
    player: entities.get(1),
    partyInfo: {
      leader: 1,
      raid: false,
      members: [{ pid: 2, name: 'Pal', cls: 'priest', group: 1 }],
    },
  } as unknown as IWorld;
}

const dmg = (sourceId: number, amount: number, ability: string | null): SimEvent =>
  ({
    type: 'damage',
    sourceId,
    targetId: 51,
    amount,
    crit: false,
    school: 'physical',
    ability,
    kind: 'hit',
  }) as SimEvent;

const heal = (sourceId: number, amount: number, ability: string): SimEvent =>
  ({ type: 'heal2', sourceId, targetId: 1, amount, crit: false, ability }) as SimEvent;

class FakeStorage {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function setup(storage: FakeStorage = new FakeStorage(), mobile = false) {
  document.body.innerHTML = MARKUP;
  const world = fakeWorld();
  // Captures whatever the tab right-click asks Hud to paint, plus the callback
  // that a row activation would fire.
  const menus: { items: { act: string; label: string }[]; select: (act: string) => void }[] = [];
  const meters = new Meters(world, {
    attachTooltip: () => {},
    uiScale: () => 1,
    isMobileLayout: () => mobile,
    storage,
    openMenu: (items, _x, _y, onSelect) => {
      menus.push({ items: [...items], select: onSelect });
    },
  });
  const el = (id: string) => document.getElementById(id) as HTMLElement;
  // A framed panel is a flex column, an unframed one a block; both are "open".
  const shown = (id: string) => el(id).style.display === 'block' || el(id).style.display === 'flex';
  const rows = (id: string) =>
    [...el(id).querySelectorAll<HTMLElement>('.mt-row')].filter(
      (row) => row.style.display !== 'none',
    );
  const rightClick = (tab: string) => {
    const button = el('meters-window').querySelector(`.mt-tab[data-tab="${tab}"]`) as HTMLElement;
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    button.dispatchEvent(ev);
    return ev;
  };
  return { meters, world, el, shown, rows, storage, menus, rightClick };
}

describe('detachable meter windows', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('starts with only the tabbed damage window, both detached meters closed', () => {
    const { meters, shown } = setup();
    meters.toggle();
    expect(shown('meters-window')).toBe(true);
    expect(shown('heal-window')).toBe(false);
    expect(shown('threat-window')).toBe(false);
    expect(meters.isDetached('heal')).toBe(false);
    expect(meters.isDetached('threat')).toBe(false);
  });

  it('separates a meter into its own window and hands the tabs back to damage', () => {
    const { meters, el, shown } = setup();
    meters.toggle();
    (el('meters-window').querySelector('.mt-tab[data-tab="threat"]') as HTMLElement).click();
    meters.popOut('threat');

    expect(shown('threat-window')).toBe(true);
    expect(meters.isDetached('threat')).toBe(true);
    // the main window does not keep showing the meter that just left it
    expect(
      el('meters-window').querySelector('.mt-tab[data-tab="dmg"]')?.classList.contains('on'),
    ).toBe(true);
    // and the damage window itself stays open
    expect(shown('meters-window')).toBe(true);
  });

  it('docks a detached window back and re-selects that meter in the tabs', () => {
    const { meters, el, shown } = setup();
    meters.toggle();
    meters.popOut('heal');
    expect(shown('heal-window')).toBe(true);

    (el('heal-window').querySelector('.mt-close') as HTMLElement).click();
    expect(shown('heal-window')).toBe(false);
    expect(meters.isDetached('heal')).toBe(false);
    expect(
      el('meters-window').querySelector('.mt-tab[data-tab="heal"]')?.classList.contains('on'),
    ).toBe(true);
  });

  it('renders each detached window against its own meter, from the one shared tally', () => {
    const { meters, el, rows } = setup();
    meters.toggle();
    meters.popOut('heal');
    meters.popOut('threat');
    meters.onEvent(dmg(1, 500, 'Shadow Bolt'));
    meters.onEvent(heal(2, 300, 'Flash Heal'));
    meters.update();
    meters.render(true);

    // damage window: the warlock only
    expect(rows('meters-window').map((r) => r.querySelector('.mt-label')?.textContent)).toEqual([
      'Hero',
    ]);
    // healing window: the priest only
    expect(rows('heal-window').map((r) => r.querySelector('.mt-label')?.textContent)).toEqual([
      'Pal',
    ]);
    // threat window: both, off the mob's live hate table (100 vs 40)
    expect(rows('threat-window').map((r) => r.querySelector('.mt-label')?.textContent)).toEqual([
      'Hero',
      'Pal',
    ]);
    expect(el('threat-window').querySelector('.mt-num')?.textContent).toBe('100');
  });

  it('gives every panel its own segment paging', () => {
    const { meters, el } = setup();
    meters.toggle();
    meters.popOut('threat');
    meters.onEvent(dmg(1, 500, 'Shadow Bolt'));
    meters.update();
    meters.render(true);

    const mainTitle = () => el('meters-window').querySelector('.mt-view')?.textContent ?? '';
    const threatTitle = () => el('threat-window').querySelector('.mt-view')?.textContent ?? '';
    const before = mainTitle();
    // page the detached window back one segment; the damage window must not follow
    (el('threat-window').querySelector('.mt-prev') as HTMLElement).click();
    expect(threatTitle()).not.toBe(before);
    expect(mainTitle()).toBe(before);
  });

  it('remembers which meters were popped out across a reload', () => {
    const storage = new FakeStorage();
    const first = setup(storage);
    first.meters.toggle();
    first.meters.popOut('threat');
    expect(storage.getItem('woc_meters_detached')).toBe('threat');

    // a fresh Meters over the same storage reopens the detached window
    const second = setup(storage);
    expect(second.shown('threat-window')).toBe(true);
    expect(second.shown('heal-window')).toBe(false);
  });

  it('restores a saved box and re-clamps it into the viewport', () => {
    const storage = new FakeStorage();
    // saved off the right edge of an 1024x768 jsdom viewport
    storage.setItem(
      'woc_meters_frame',
      JSON.stringify({ left: 5000, top: 5000, width: 300, height: 200 }),
    );
    const { el } = setup(storage);
    const panel = el('meters-window');
    expect(panel.classList.contains('mt-framed')).toBe(true);
    expect(panel.style.position).toBe('absolute');
    // clamped back on screen rather than restored verbatim
    expect(Number.parseFloat(panel.style.left)).toBeLessThan(window.innerWidth);
    expect(Number.parseFloat(panel.style.top)).toBeLessThan(window.innerHeight);
    expect(panel.style.width).toBe('300px');
    expect(panel.style.height).toBe('200px');
  });

  it('leaves an unmoved panel entirely to the stylesheet', () => {
    const { el } = setup();
    const panel = el('meters-window');
    // no saved box: nothing is written, so the stock anchored design is intact
    expect(panel.classList.contains('mt-framed')).toBe(false);
    expect(panel.style.position).toBe('');
    expect(panel.style.left).toBe('');
    expect(panel.style.width).toBe('');
  });

  it('gives every panel a resize grip and two move handles', () => {
    const { el } = setup();
    for (const id of ['meters-window', 'heal-window', 'threat-window']) {
      expect(el(id).querySelector('.panel-resize-grip')).not.toBeNull();
      // The title bar, plus the summary line under it: on the tabbed window the
      // title is packed with tabs and controls, leaving little bare strip.
      expect(el(id).querySelector('.panel-title')?.classList.contains('mt-move-handle')).toBe(true);
      expect(el(id).querySelector('.mt-view')?.classList.contains('mt-move-handle')).toBe(true);
    }
  });

  it('resets every panel back to its stylesheet anchor', () => {
    const storage = new FakeStorage();
    storage.setItem(
      'woc_meters_frame',
      JSON.stringify({ left: 100, top: 100, width: 300, height: 200 }),
    );
    const { meters, el } = setup(storage);
    expect(el('meters-window').classList.contains('mt-framed')).toBe(true);

    meters.resetFrames();
    const panel = el('meters-window');
    expect(panel.classList.contains('mt-framed')).toBe(false);
    expect(panel.style.left).toBe('');
    expect(panel.style.height).toBe('');
    expect(storage.getItem('woc_meters_frame')).toBeNull();
  });

  it('writes no geometry on a mobile layout, where the stylesheet owns placement', () => {
    const storage = new FakeStorage();
    storage.setItem(
      'woc_meters_frame',
      JSON.stringify({ left: 100, top: 100, width: 300, height: 200 }),
    );
    const { el } = setup(storage, true);
    const panel = el('meters-window');
    expect(panel.classList.contains('mt-framed')).toBe(false);
    expect(panel.style.left).toBe('');
  });

  it('opens as a plain block on a mobile layout, even with a saved box', () => {
    const storage = new FakeStorage();
    storage.setItem(
      'woc_meters_frame',
      JSON.stringify({ left: 100, top: 100, width: 300, height: 200 }),
    );
    const { meters, el } = setup(storage, true);
    meters.toggle();
    const panel = el('meters-window');
    // `mt-framed` is what supplies flex-direction: column, and apply() refuses to
    // write it on a mobile layout. Opening as 'flex' regardless would lay the
    // title, summary, hint and rows out in a ROW. Reachable rather than
    // theoretical: mobile-touch toggles at runtime from the touch-controls
    // setting, so a desktop player who moved a panel then turned touch controls
    // on lands here.
    expect(panel.classList.contains('mt-framed')).toBe(false);
    expect(panel.style.display).toBe('block');
  });

  it('opens as a flex column on a desktop layout with the same saved box', () => {
    const storage = new FakeStorage();
    storage.setItem(
      'woc_meters_frame',
      JSON.stringify({ left: 100, top: 100, width: 300, height: 200 }),
    );
    const { meters, el } = setup(storage);
    meters.toggle();
    const panel = el('meters-window');
    expect(panel.classList.contains('mt-framed')).toBe(true);
    expect(panel.style.display).toBe('flex');
  });

  it('closes the separated windows along with the tabbed one, and brings them back', () => {
    const { meters, shown, storage } = setup();
    meters.toggle();
    meters.popOut('threat');
    expect(shown('threat-window')).toBe(true);

    // the meters keybind clears the whole surface, not just the tabbed window
    meters.toggle();
    expect(shown('meters-window')).toBe(false);
    expect(shown('threat-window')).toBe(false);
    // closing is not docking: a reload must still come back to the player's layout
    expect(storage.getItem('woc_meters_detached')).toBe('threat');

    meters.toggle();
    expect(shown('meters-window')).toBe(true);
    expect(shown('threat-window')).toBe(true);
    // and only what was actually up comes back
    expect(shown('heal-window')).toBe(false);
  });

  it('does not resurrect a window the player docked before closing', () => {
    const { meters, shown } = setup();
    meters.toggle();
    meters.popOut('heal');
    meters.dock('heal');
    meters.toggle();
    meters.toggle();
    expect(shown('heal-window')).toBe(false);
  });

  it('advertises the move gesture on the handles only, never on the tab buttons', () => {
    const { el } = setup();
    const main = el('meters-window');
    const move = main.querySelector('.panel-title')?.getAttribute('title') ?? '';
    expect(move).not.toBe('');
    expect(main.querySelector('.mt-view')?.getAttribute('title')).toBe(move);
    // A container's title is inherited by every descendant carrying none of its
    // own, so each tab would otherwise advertise a drag that pressing it does
    // NOT perform (onMoveStart hands a press on a control back to that control).
    for (const tab of ['dmg', 'heal', 'threat']) {
      expect(main.querySelector(`.mt-tab[data-tab="${tab}"]`)?.getAttribute('title')).toBe('');
    }
    // The pager and close controls keep the tooltips they set for themselves.
    for (const control of ['.mt-prev', '.mt-next', '.mt-close']) {
      const title = main.querySelector(control)?.getAttribute('title') ?? '';
      expect(title).not.toBe('');
      expect(title).not.toBe(move);
    }
  });

  it('offers Separate when right-clicking a docked meter tab, and acts on it', () => {
    const { meters, menus, rightClick, shown } = setup();
    meters.toggle();

    const ev = rightClick('threat');
    expect(ev.defaultPrevented).toBe(true); // the browser menu is suppressed
    expect(menus).toHaveLength(1);
    expect(menus[0].items.map((i) => i.act)).toEqual(['separate']);
    expect(menus[0].items[0].label).toContain('Threat');

    menus[0].select('separate');
    expect(shown('threat-window')).toBe(true);
    expect(meters.isDetached('threat')).toBe(true);
  });

  it('offers Regroup on the same tab once that meter is separated, and docks it', () => {
    const { meters, menus, rightClick, shown } = setup();
    meters.toggle();
    meters.popOut('heal');

    rightClick('heal');
    expect(menus).toHaveLength(1);
    expect(menus[0].items.map((i) => i.act)).toEqual(['regroup']);
    expect(menus[0].items[0].label).toContain('Healing');

    menus[0].select('regroup');
    expect(shown('heal-window')).toBe(false);
    expect(meters.isDetached('heal')).toBe(false);
  });

  it('opens no menu on the damage tab and leaves that right-click alone', () => {
    const { meters, menus, rightClick } = setup();
    meters.toggle();
    const ev = rightClick('dmg');
    expect(menus).toHaveLength(0);
    // not preventDefault'd: damage has no action, so the event is not consumed
    expect(ev.defaultPrevented).toBe(false);
  });

  it('re-reads the live detached state on every right-click, never a stale menu', () => {
    const { meters, menus, rightClick } = setup();
    meters.toggle();
    rightClick('threat');
    expect(menus[0].items[0].act).toBe('separate');
    menus[0].select('separate');
    // same tab, now separated: the very next open must offer the opposite action
    rightClick('threat');
    expect(menus[1].items[0].act).toBe('regroup');
    menus[1].select('regroup');
    rightClick('threat');
    expect(menus[2].items[0].act).toBe('separate');
  });
});
