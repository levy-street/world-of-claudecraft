// @vitest-environment jsdom
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
  entities.set(1, { id: 1, kind: 'player', name: 'Hero', templateId: 'hunter' });
  entities.set(2, { id: 2, kind: 'player', name: 'Pal', templateId: 'priest' });
  entities.set(3, { id: 3, kind: 'mob', name: 'Wolf Pet', templateId: 'forest_wolf', ownerId: 1 });
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

  it('breaks the hovered bar down per ability and names the pet that acted', () => {
    const { meters, visibleRows, tooltipFor } = setup();
    meters.onEvent(dmg(1, 51, 300, 'Aimed Shot'));
    meters.onEvent(dmg(3, 51, 200, 'Claw'));
    meters.update();
    meters.render(true);

    const html = tooltipFor(visibleRows()[0]);
    expect(html).toContain('<div class="tt-title">Hero</div>');
    // the pet's damage is its own row, labeled with the pet, and the shares are
    // taken against the OWNER's folded total (300 + 200)
    expect(tipRows(html)).toEqual([
      ['Aimed Shot', '300 (60%)'],
      ['Wolf Pet: Claw', '200 (40%)'],
    ]);
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

  it('adds a pet threat to its owner column and marks the owner when the pet holds aggro', () => {
    const { meters, visibleRows, tooltipFor } = setup();
    meters.onEvent(dmg(1, 51, 300, 'Aimed Shot'));
    meters.onEvent(dmg(2, 51, 100, 'Smite'));
    meters.update();
    (document.querySelector('.mt-tab[data-tab="threat"]') as HTMLElement).click();

    const rows = visibleRows();
    expect(rows.map((el) => el.querySelector('.mt-label')?.textContent)).toEqual(['Hero', 'Pal']);
    // 100 own hate + the pet's 50, not the bare 100
    expect(rows[0].querySelector('.mt-num')?.textContent).toBe('150');
    expect(rows[1].querySelector('.mt-num')?.textContent).toBe('40');
    // the mob is chewing on the PET, which no longer has a row of its own
    expect(rows[0].classList.contains('aggro')).toBe(true);
    expect(rows[1].classList.contains('aggro')).toBe(false);

    // the hover panel splits that column back into its contributors: the member
    // and one row per pet, NOT the per-ability split the damage tab shows
    const html = tooltipFor(rows[0]);
    expect(tipRows(html)).toEqual([
      ['Hero', '100 (67%)'],
      ['Wolf Pet', '50 (33%)'],
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
