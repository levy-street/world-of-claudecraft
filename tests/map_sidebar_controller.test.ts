// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NPCS, QUESTS, zoneAt } from '../src/sim/data';
import type { QuestProgress } from '../src/sim/types';
import { MapSidebarController } from '../src/ui/map_sidebar_controller';
import { QuestTrackingState } from '../src/ui/quest_tracking_core';
import type { IWorld } from '../src/world_api';

/** An in-memory Storage stand-in, so the rail's tracking set never reaches (or
 *  leaks into) the shared per-character rows. */
function fakeStorage() {
  const rows = new Map<string, string>();
  return {
    rows,
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => {
      rows.set(key, value);
    },
  };
}

function makeHarness(alsoTracked: readonly string[] = []) {
  const root = document.createElement('aside');
  document.body.appendChild(root);
  const giver = NPCS[QUESTS.q_wolves.giverNpcId];
  const quest: QuestProgress = { questId: 'q_wolves', counts: [2], state: 'active' };
  const log = new Map<string, QuestProgress>([['q_wolves', quest]]);
  for (const questId of alsoTracked) {
    log.set(questId, { questId, counts: [0], state: 'active' });
  }
  const world = {
    cfg: { playerClass: 'warrior' },
    player: { name: 'Adventurer', pos: { x: giver.pos.x, y: 0, z: giver.pos.z } },
    questLog: log,
    questState: () => 'unavailable',
  } as unknown as IWorld;
  const click = vi.fn();
  const onRepaintMap = vi.fn();
  const onShowRoute = vi.fn();
  const storage = fakeStorage();
  const tracking = new QuestTrackingState(storage);
  const controller = new MapSidebarController({
    root: () => root,
    click,
    onRepaintMap,
    onShowRoute,
    tracking,
  });
  controller.update(world, zoneAt(giver.pos.x, giver.pos.z));
  return { root, controller, click, onRepaintMap, onShowRoute, world, tracking, storage };
}

describe('map sidebar controller', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the complete atlas rail from the current world', () => {
    const test = makeHarness();
    expect(test.root.querySelectorAll('[data-map-filter]')).toHaveLength(5);
    expect(test.root.querySelector('[data-map-quest="q_wolves"]')).not.toBeNull();
    expect(test.root.querySelector('[data-map-route]')).not.toBeNull();
    expect(test.root.querySelectorAll('.map-atlas-legend > span')).toHaveLength(5);
    expect(test.root.textContent).toContain('Tracked quests');
    expect(test.root.textContent).toContain('Available nearby');
  });

  it('publishes filter changes and the selected quest route', () => {
    const test = makeHarness();
    test.root.querySelector<HTMLElement>('[data-map-filter="services"]')?.click();
    expect(test.onRepaintMap).toHaveBeenCalled();
    expect(test.controller.filterState()).toMatchObject({ services: false, quests: true });

    test.root.querySelector<HTMLElement>('[data-map-route]')?.click();
    expect(test.onShowRoute).toHaveBeenCalledWith(expect.objectContaining({ questId: 'q_wolves' }));
    expect(test.controller.shownRoute()).toMatchObject({ questId: 'q_wolves' });
    expect(test.root.querySelector('[data-map-route]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the toggled filter chip focused across the rail swap', () => {
    const test = makeHarness();
    const chip = test.root.querySelector<HTMLElement>('[data-map-filter="services"]');
    chip?.focus();
    expect(document.activeElement).toBe(chip);

    chip?.click();

    const repainted = test.root.querySelector<HTMLElement>('[data-map-filter="services"]');
    expect(repainted).not.toBe(chip);
    expect(document.activeElement).toBe(repainted);
    expect(repainted?.getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps the selected quest row focused across the rail swap', () => {
    const test = makeHarness(['q_boars']);
    const row = test.root.querySelector<HTMLElement>('[data-map-quest="q_boars"]');
    row?.focus();

    row?.click();

    const repainted = test.root.querySelector<HTMLElement>('[data-map-quest="q_boars"]');
    expect(repainted).not.toBe(row);
    expect(document.activeElement).toBe(repainted);
    expect(repainted?.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the Show Route button focused after it publishes a route', () => {
    const test = makeHarness();
    const route = test.root.querySelector<HTMLElement>('[data-map-route]');
    route?.focus();

    route?.click();

    const repainted = test.root.querySelector<HTMLElement>('[data-map-route]');
    expect(repainted).not.toBe(route);
    expect(document.activeElement).toBe(repainted);
  });

  it('leaves focus alone when it was never inside the rail', () => {
    const test = makeHarness();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    test.root.querySelector<HTMLElement>('[data-map-filter="services"]')?.click();

    expect(document.activeElement).toBe(outside);
  });

  it('untracks a quest for real: the row LEAVES the rail, the quest is not abandoned', () => {
    const test = makeHarness();
    const abandonQuest = vi.fn();
    Object.assign(test.world, { abandonQuest });
    expect(test.root.querySelector('[data-map-quest="q_wolves"]')).not.toBeNull();

    test.root.querySelector<HTMLElement>('[data-map-untrack]')?.click();
    test.controller.update(test.world, zoneAt(test.world.player.pos.x, test.world.player.pos.z));

    // The regression this covers: the control used to clear the local selection
    // only, leaving the same quest listed under "Tracked quests".
    expect(test.root.querySelector('[data-map-quest="q_wolves"]')).toBeNull();
    expect(test.root.textContent).toContain('No tracked quests');
    expect(test.tracking.isTracked('q_wolves')).toBe(false);
    expect(test.controller.shownRoute()).toBeNull();
    expect(test.onRepaintMap).toHaveBeenCalled();
    // Presentation only: the sim's quest log is untouched.
    expect(abandonQuest).not.toHaveBeenCalled();
    expect(test.world.questLog.has('q_wolves')).toBe(true);
    expect(test.root.querySelector('[data-map-untrack]')?.hasAttribute('disabled')).toBe(true);
  });

  it('persists the untracked quest per character and reloads it on the next session', () => {
    const test = makeHarness();
    test.root.querySelector<HTMLElement>('[data-map-untrack]')?.click();

    const reloaded = new QuestTrackingState(test.storage);
    reloaded.useCharacter('warrior', 'Adventurer');
    expect(reloaded.isTracked('q_wolves')).toBe(false);

    // Another character on the same browser starts fully tracked.
    const other = new QuestTrackingState(test.storage);
    other.useCharacter('mage', 'Someone');
    expect(other.isTracked('q_wolves')).toBe(true);
  });

  it('re-tracking (the quest log toggle) brings the row back to the rail', () => {
    const test = makeHarness();
    test.root.querySelector<HTMLElement>('[data-map-untrack]')?.click();
    expect(test.root.querySelector('[data-map-quest="q_wolves"]')).toBeNull();

    test.tracking.setTracked('q_wolves', true);
    test.controller.update(test.world, zoneAt(test.world.player.pos.x, test.world.player.pos.z));

    // The rail's repaint signature carries the tracking revision, so nothing else
    // has to move for the row to come back.
    expect(test.root.querySelector('[data-map-quest="q_wolves"]')).not.toBeNull();
  });
});

// The headerless map window has exactly ONE drag surface: the --window-pad band
// around its two panes (Hud.isWindowDragHandle returns true only for
// `target === win`). Both panes are absolutely positioned, and an absolutely
// positioned child resolves against the PADDING box, so an `inset: 0` pane
// covers that band and the window stops being draggable at all. jsdom has no
// layout, so this reads the shipped declarations instead of a computed rect.
describe('map window: the pad band stays the drag handle', () => {
  // join(__dirname, ...) rather than an import.meta URL: the DOM environment
  // rewrites import.meta.url to an http scheme (the bags-window precedent).
  const indexHtml = readFileSync(join(__dirname, '../index.html'), 'utf8');
  const componentsCss = readFileSync(join(__dirname, '../src/styles/components.css'), 'utf8');

  /** The body of the rule whose whole selector text is exactly `selector`. */
  function ruleBody(css: string, selector: string): string {
    const at = css.indexOf(`\n  ${selector} {`);
    expect(at, `components.css declares no rule for ${selector}`).toBeGreaterThan(-1);
    const open = css.indexOf('{', at);
    return css.slice(open + 1, css.indexOf('}', open));
  }

  function inset(selector: string): string {
    const body = ruleBody(componentsCss, selector);
    const match = body.match(/(?:^|[;{])\s*inset:([^;]*)/);
    expect(match, `${selector} declares no inset`).not.toBeNull();
    return (match?.[1] ?? '').replace(/\s+/g, ' ').trim();
  }

  it('mounts both panes as absolutely positioned direct children of #map-window', () => {
    document.body.innerHTML = '';
    const at = indexHtml.indexOf('<div id="map-window"');
    expect(at).toBeGreaterThan(-1);
    const host = document.createElement('div');
    host.innerHTML = indexHtml.slice(at, indexHtml.indexOf('<div id="arena-window"', at));
    document.body.appendChild(host);
    const win = document.getElementById('map-window');
    expect(win).not.toBeNull();
    expect(win?.querySelector(':scope > .map-atlas-sidebar')).not.toBeNull();
    expect(win?.querySelector(':scope > .map-atlas-stage')).not.toBeNull();
    for (const selector of ['.map-atlas-sidebar', '.map-atlas-stage']) {
      expect(ruleBody(componentsCss, selector)).toContain('position: absolute');
    }
  });

  it('insets the rail by the pad on the three edges it touches', () => {
    const value = inset('.map-atlas-sidebar');
    expect(value).toBe('var(--window-pad) auto var(--window-pad) var(--window-pad)');
    expect(value.startsWith('0')).toBe(false);
  });

  it('insets the stage by the pad, its left edge past the rail and the gutter', () => {
    const value = inset('.map-atlas-stage');
    // top / right / bottom are the bare pad; left clears the 300px rail + 12px gutter.
    expect(value).toBe(
      'var(--window-pad) var(--window-pad) var(--window-pad) calc(var(--window-pad) + 300px + 12px)',
    );
    expect(value).not.toContain(' 312px');
  });

  it('keeps the pad when the empty rail collapses and the stage takes the window', () => {
    const value = inset(
      'body:not(.mobile-touch) #map-window:has(> .map-atlas-sidebar:empty) .map-atlas-stage',
    );
    expect(value).toBe('var(--window-pad)');
    expect(value).not.toBe('0');
  });
});

describe('map sidebar controller: walking cadence', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  /** The offers list is the only part of the rail that moves with the player, so
   *  it needs live offers to be worth measuring (the default harness has none). */
  function walkingHarness() {
    const root = document.createElement('aside');
    document.body.appendChild(root);
    const giver = NPCS[QUESTS.q_wolves.giverNpcId];
    const world = {
      cfg: { playerClass: 'warrior' },
      player: { name: 'Adventurer', pos: { x: giver.pos.x, y: 0, z: giver.pos.z } },
      questLog: new Map<string, QuestProgress>([
        ['q_wolves', { questId: 'q_wolves', counts: [2], state: 'active' }],
      ]),
      questState: () => 'available',
    } as unknown as IWorld;
    const controller = new MapSidebarController({
      root: () => root,
      click: vi.fn(),
      onRepaintMap: vi.fn(),
      onShowRoute: vi.fn(),
      tracking: new QuestTrackingState(fakeStorage()),
    });
    const zone = zoneAt(giver.pos.x, giver.pos.z);
    const writes = { count: 0 };
    let descriptor: PropertyDescriptor | undefined;
    for (
      let proto = Object.getPrototypeOf(root);
      proto && !descriptor;
      proto = Object.getPrototypeOf(proto)
    ) {
      descriptor = Object.getOwnPropertyDescriptor(proto, 'innerHTML');
    }
    if (!descriptor?.set) throw new Error('no innerHTML accessor to count writes through');
    const innerHtml = descriptor;
    Object.defineProperty(root, 'innerHTML', {
      configurable: true,
      get: () => innerHtml.get?.call(root),
      set: (value: string) => {
        writes.count += 1;
        innerHtml.set?.call(root, value);
      },
    });
    const walk = (dx: number) => {
      world.player.pos.x = giver.pos.x + dx;
      controller.update(world, zone);
    };
    return { root, walk, writes };
  }

  it('repaints nothing while the player walks a few yards', () => {
    const test = walkingHarness();
    test.walk(0);
    expect(test.writes.count, 'the first update paints the rail').toBe(1);
    expect(test.root.querySelectorAll('.map-atlas-nearby-row').length).toBeGreaterThan(0);
    const painted = test.root.firstElementChild;

    test.walk(3);

    // A live distance moved every tick, so the rail used to rebuild its whole
    // subtree four times a second while the player walked.
    expect(test.writes.count).toBe(1);
    expect(test.root.firstElementChild).toBe(painted);
  });

  it('repaints once the offers list actually reads differently', () => {
    const test = walkingHarness();
    test.walk(0);
    const painted = test.root.firstElementChild;
    const before = test.root.querySelector('.map-atlas-nearby-row')?.textContent;

    test.walk(30);

    expect(test.writes.count).toBe(2);
    expect(test.root.firstElementChild).not.toBe(painted);
    expect(test.root.querySelector('.map-atlas-nearby-row')?.textContent).not.toBe(before);
  });
});
