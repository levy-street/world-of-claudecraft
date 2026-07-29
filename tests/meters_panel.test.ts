// @vitest-environment happy-dom
//
// Panel-level coverage for the meters window: the pooled bars, the pet-aware
// threat column, and the hover breakdown HTML the shared tooltip paints. The
// ranking math itself is covered by tests/meters_breakdown_view.test.ts and the
// tallying by tests/meters.test.ts; this file pins the wiring between them.

import { beforeEach, describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/sim/types';
import { Meters } from '../src/ui/meters';
import type { IWorld } from '../src/world_api';

const MARKUP = `
  <div id="meters-window">
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

// Hunter (pid 1) with a pet (pid 3), a priest party member (pid 2), and one mob
// carrying a live hate table.
function fakeWorld(): IWorld {
  const entities = new Map<number, any>();
  entities.set(1, {
    id: 1,
    kind: 'player',
    name: 'Hero',
    templateId: 'hunter',
    targetId: null,
    threat: new Map<number, number>(),
  });
  entities.set(2, {
    id: 2,
    kind: 'player',
    name: 'Pal',
    templateId: 'priest',
    threat: new Map<number, number>(),
  });
  entities.set(3, {
    id: 3,
    kind: 'mob',
    name: 'Wolf Pet',
    templateId: 'forest_wolf',
    ownerId: 1,
    dead: false,
    maxHp: 100,
    threat: new Map<number, number>(),
  });
  entities.set(51, {
    id: 51,
    kind: 'mob',
    name: 'Gorrak',
    templateId: 'gorrak',
    maxHp: 400,
    dead: false,
    aggroTargetId: 3,
    threat: new Map<number, number>([
      [1, 100],
      [3, 50],
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

const dmg = (
  sourceId: number,
  targetId: number,
  amount: number,
  ability: string | null,
): SimEvent =>
  ({
    type: 'damage',
    sourceId,
    targetId,
    amount,
    crit: false,
    school: 'physical',
    ability,
    kind: 'hit',
  }) as SimEvent;

/** Labels of the contributor SUBTOTAL rows only. */
function headRows(html: string): string[] {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  return [...doc.querySelectorAll('.mt-tip-head')].map(
    (el) => el.querySelector('.mt-tip-name')?.textContent ?? '',
  );
}

/** Labels of the ability rows nested under a subtotal. */
function nestedRows(html: string): string[] {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  return [...doc.querySelectorAll('.mt-tip-group .mt-tip-row')].map(
    (el) => el.querySelector('.mt-tip-name')?.textContent ?? '',
  );
}

/** [label, value] of every row in a breakdown tooltip's HTML. */
function tipRows(html: string): [string, string][] {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  return [...doc.querySelectorAll('.mt-tip-row')].map((el) => [
    el.querySelector('.mt-tip-name')?.textContent ?? '',
    el.querySelector('.mt-tip-val')?.textContent ?? '',
  ]);
}

function setup() {
  document.body.innerHTML = MARKUP;
  const tooltips = new Map<HTMLElement, () => string>();
  const world = fakeWorld();
  const meters = new Meters(world, {
    attachTooltip: (el, html) => tooltips.set(el, html),
  });
  const rowsEl = document.querySelector('.mt-rows') as HTMLElement;
  const visibleRows = () =>
    [...rowsEl.querySelectorAll<HTMLElement>('.mt-row')].filter(
      (el) => el.style.display !== 'none',
    );
  const tooltipFor = (el: HTMLElement) => (tooltips.get(el) as () => string)();
  return { meters, world, rowsEl, visibleRows, tooltipFor };
}

describe('meters panel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders one bar per member, with the pet folded into its owner', () => {
    const { meters, visibleRows } = setup();
    meters.onEvent(dmg(1, 51, 300, 'Aimed Shot'));
    meters.onEvent(dmg(3, 51, 200, 'Claw'));
    meters.onEvent(dmg(2, 51, 100, 'Smite'));
    meters.update();
    meters.render(true);

    const rows = visibleRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((el) => el.querySelector('.mt-label')?.textContent)).toEqual(['Hero', 'Pal']);
    // 300 own + 200 pet ranks the hunter above the priest's 100
    expect(rows[0].querySelector('.mt-num')?.textContent).toContain('500');
  });

  it('groups the hovered bar by contributor, with a subtotal per actor', () => {
    const { meters, visibleRows, tooltipFor } = setup();
    meters.onEvent(dmg(1, 51, 300, 'Aimed Shot'));
    meters.onEvent(dmg(3, 51, 200, 'Claw'));
    meters.update();
    meters.render(true);

    const html = tooltipFor(visibleRows()[0]);
    expect(html).toContain('<div class="tt-title">Hero</div>');
    // A subtotal per actor with its abilities under it, so a hunter can read the
    // pet's contribution instead of adding interleaved rows up by hand. Shares
    // are against the owner's folded total (300 + 200), so they sum to 100%.
    expect(tipRows(html)).toEqual([
      ['Hero', '300 (60%)'],
      ['Aimed Shot', '300 (60%)'],
      ['Wolf Pet', '200 (40%)'],
      ['Claw', '200 (40%)'],
    ]);
    // the subtotals are headings; the abilities are nested under them
    expect(headRows(html)).toEqual(['Hero', 'Wolf Pet']);
    expect(nestedRows(html)).toEqual(['Aimed Shot', 'Claw']);
    // a nested ability drops the pet prefix, since its heading already names it
    expect(html).not.toContain('Wolf Pet: Claw');
  });

  it('omits a pet that did nothing rather than showing it as a zero group', () => {
    const { meters, visibleRows, tooltipFor } = setup();
    meters.onEvent(dmg(1, 51, 300, 'Aimed Shot')); // the pet never acts
    meters.update();
    meters.render(true);

    const html = tooltipFor(visibleRows()[0]);
    expect(headRows(html)).toEqual(['Hero']);
    expect(html).not.toContain('Wolf Pet');
  });

  it('reuses the pooled bars across renders so a hovered row keeps its tooltip', () => {
    const { meters, rowsEl, visibleRows, tooltipFor } = setup();
    meters.onEvent(dmg(1, 51, 300, 'Aimed Shot'));
    meters.update();
    meters.render(true);
    const first = visibleRows()[0];

    meters.onEvent(dmg(1, 51, 100, 'Arcane Shot'));
    meters.update();
    meters.render(true);
    expect(visibleRows()[0]).toBe(first); // same node, so the tooltip stayed attached
    expect(rowsEl.querySelectorAll('.mt-row')).toHaveLength(1);
    // and the tooltip closure reads live state, not what it captured at attach time
    expect(tooltipFor(first)).toContain('Arcane Shot');
  });

  it('gives the pet its own threat bar and marks the pet the mob is on', () => {
    const { meters, visibleRows, tooltipFor } = setup();
    meters.onEvent(dmg(1, 51, 300, 'Aimed Shot'));
    meters.onEvent(dmg(3, 51, 200, 'Claw'));
    meters.onEvent(dmg(2, 51, 100, 'Smite'));
    meters.update();
    (document.querySelector('.mt-tab[data-tab="threat"]') as HTMLElement).click();

    const rows = visibleRows();
    // three hate-table entries, three bars, each the number the mob compares
    expect(rows.map((el) => el.querySelector('.mt-label')?.textContent)).toEqual([
      'Hero',
      'Wolf Pet',
      'Pal',
    ]);
    expect(rows.map((el) => el.querySelector('.mt-num')?.textContent)).toEqual(['100', '50', '40']);
    // the mob is chewing on the PET, so the PET's bar carries the marker
    expect(rows.map((el) => el.classList.contains('aggro'))).toEqual([false, true, false]);

    // the hover panel behind a pet bar is that pet's own damage, not the owner's
    expect(tipRows(tooltipFor(rows[1]))).toEqual([['Wolf Pet: Claw', '200 (100%)']]);
    expect(tipRows(tooltipFor(rows[0]))).toEqual([['Aimed Shot', '300 (100%)']]);
  });

  it('follows the live mob when the latched one dies, instead of freezing', () => {
    // The "it stops updating" report. Wolf A and Wolf B are the same size, so
    // the old strictly-greater latch never moved off A; once A died the tab
    // showed damage-dealt-to-a-corpse, which could never change again.
    const { meters, world, visibleRows } = setup();
    const entities = world.entities as Map<number, any>;
    const wolfB = {
      id: 52,
      kind: 'mob',
      name: 'Gorrak',
      templateId: 'gorrak',
      maxHp: 400,
      dead: false,
      aggroTargetId: 1,
      threat: new Map<number, number>([
        [1, 900],
        [2, 300],
      ]),
    };
    entities.set(52, wolfB);

    meters.onEvent(dmg(1, 51, 300, 'Aimed Shot'));
    meters.onEvent(dmg(2, 51, 100, 'Smite'));
    meters.update();
    (document.querySelector('.mt-tab[data-tab="threat"]') as HTMLElement).click();

    // the first mob dies mid-fight and the server stops sending its hate table
    const wolfA = entities.get(51);
    wolfA.dead = true;
    wolfA.threat.clear();
    meters.render(true);

    // the tab moved to the live mob and shows ITS hate, not frozen damage
    const rows = visibleRows();
    expect(rows.map((el) => el.querySelector('.mt-num')?.textContent)).toEqual(['900', '300']);
    expect(rows[0].classList.contains('aggro')).toBe(true);
  });

  it('says so when it has fallen back to damage, so bars never pose as hate', () => {
    const { meters, world, visibleRows } = setup();
    const entities = world.entities as Map<number, any>;
    meters.onEvent(dmg(1, 51, 300, 'Aimed Shot'));
    meters.update();
    (document.querySelector('.mt-tab[data-tab="threat"]') as HTMLElement).click();

    // nothing live is left: the only mob is dead and its table is gone
    const wolfA = entities.get(51);
    wolfA.dead = true;
    wolfA.threat.clear();
    meters.render(true);

    expect(visibleRows()).toHaveLength(1);
    const sub = document.querySelector('.mt-sub')?.textContent ?? '';
    expect(sub).toContain('showing damage');
    expect(sub).toContain('Gorrak');
  });

  it('tracks the mob the player targeted, even beside a bigger one', () => {
    const { meters, world, visibleRows } = setup();
    const entities = world.entities as Map<number, any>;
    entities.set(52, {
      id: 52,
      kind: 'mob',
      name: 'Gorrak',
      templateId: 'gorrak',
      maxHp: 9000, // bigger, so the size rule alone would pick this one
      dead: false,
      aggroTargetId: 2,
      threat: new Map<number, number>([[2, 700]]),
    });
    entities.get(1).targetId = 51;

    meters.onEvent(dmg(1, 51, 300, 'Aimed Shot'));
    meters.update();
    (document.querySelector('.mt-tab[data-tab="threat"]') as HTMLElement).click();

    // Gorrak-the-big is engaged too, but the meter follows the player's target:
    // these are wolf 51's hate values (Hero 100, pet 50), not the big one's 700
    expect(visibleRows().map((el) => el.querySelector('.mt-num')?.textContent)).toEqual([
      '100',
      '50',
    ]);
  });

  it('hides the pooled bars on an empty segment instead of discarding them', () => {
    const { meters, rowsEl, visibleRows } = setup();
    meters.onEvent(dmg(1, 51, 300, 'Aimed Shot'));
    meters.update();
    meters.render(true);
    expect(visibleRows()).toHaveLength(1);

    // switch to the healing tab: nothing was healed, so no bar has a value
    (document.querySelector('.mt-tab[data-tab="heal"]') as HTMLElement).click();
    expect(visibleRows()).toHaveLength(0);
    expect(rowsEl.querySelectorAll('.mt-row')).toHaveLength(1); // pooled, not deleted
  });

  it('keeps every bar keyboard reachable so the breakdown is not hover-only', () => {
    const { meters, visibleRows } = setup();
    meters.onEvent(dmg(1, 51, 300, 'Aimed Shot'));
    meters.update();
    meters.render(true);
    expect(visibleRows()[0].tabIndex).toBe(0);
  });
});
