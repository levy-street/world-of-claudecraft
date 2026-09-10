// @vitest-environment happy-dom
//
// The Hunting window repaints by rewriting the whole panel's innerHTML, so
// every click on a row destroys the list scroller and builds a new one. That
// is what threw the player back to the top of the catalog the moment they
// picked a companion from further down: the selection landed, the scroll did
// not survive the repaint.
//
// Drives the real painter through a real click, which is the only way to catch
// this — a source-text guard cannot tell a preserved offset from a lost one.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CollectionsWindow } from '../src/ui/collections/collections_window';
import type { CollectionsWindowDeps } from '../src/ui/collections/collections_window';

vi.mock('../src/game/audio', () => ({ audio: { click: () => {} } }));

const root = () => document.getElementById('collections-window') as HTMLElement;
const list = () => root().querySelector('.col-list') as HTMLElement;
const rowKeys = () =>
  [...root().querySelectorAll<HTMLElement>('[data-key]')].map((el) => el.dataset.key ?? '');

function makeWindow(): CollectionsWindow {
  const deps: CollectionsWindowDeps = {
    root,
    world: () => ({ marketInfo: null, marketSellPriceCheck: () => {} }) as never,
    closeOthers: () => {},
    captureFocus: () => null,
    restoreFocus: () => {},
    mountPreview: () => {},
    ownedBuddyKeys: () => new Set(),
    ownedMountKeys: () => new Set(),
    ownedItemIds: () => new Set(),
    buddyVisualKeys: () => ({}),
    mountVisualKeys: () => ({}),
    itemIcon: () => '',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: () => {},
  };
  return new CollectionsWindow(deps);
}

describe('Hunting window list scroll', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="collections-window"></div>';
  });

  it('keeps the catalog where the player left it when a companion is picked', () => {
    const win = makeWindow();
    win.toggle();
    const keys = rowKeys();
    // Something well down the list, so the bug's symptom (a jump to the top)
    // and the fix are distinguishable.
    const target = keys.at(-1) as string;
    expect(target).toBeTruthy();
    list().scrollTop = 420;

    (root().querySelector(`[data-key="${target}"]`) as HTMLElement).click();

    expect(root().querySelector('.col-row.active')?.getAttribute('data-key')).toBe(target);
    expect(list().scrollTop).toBe(420);
  });

  it('gives each tab its own place, so a tab switch never inherits another list position', () => {
    const win = makeWindow();
    win.toggle();
    list().scrollTop = 300;

    (root().querySelector('[data-tab="mounts"]') as HTMLElement).click();
    expect(list().scrollTop).toBe(0);

    list().scrollTop = 120;
    (root().querySelector('[data-tab="buddies"]') as HTMLElement).click();
    expect(list().scrollTop).toBe(300);

    (root().querySelector('[data-tab="mounts"]') as HTMLElement).click();
    expect(list().scrollTop).toBe(120);
  });
});
