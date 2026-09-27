// Real-browser regression for the desktop character sheet's stage-and-overlay
// paperdoll: every gear row must win the hit test over the 3D preview behind it.
// The left column sits BEFORE the model stage in the DOM, so it alone depends on
// the stage being its own stacking context; the right column and the weapons row
// follow the stage and pass either way, which is how a left-only break shipped.
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import '../../src/styles/index.css';
import { cleanup } from './_harness';

const SLOTS = {
  left: ['helmet', 'neck', 'shoulder', 'chest', 'gloves'],
  right: ['waist', 'legs', 'feet', 'ring1', 'ring2'],
  weapons: ['mainhand', 'offhand'],
} as const;

function slotRow(slot: string): string {
  return `<div class="equip-slot" id="equip-slot-${slot}" data-equip-slot="${slot}"><img class="item-icon ui-socket" alt=""><div><div class="slot-name"></div><div class="slot-item"></div></div><button type="button" class="equip-unequip-btn"></button></div>`;
}

function mountSheet(): HTMLElement {
  const ui = document.createElement('div');
  ui.id = 'ui';
  ui.innerHTML = `<div id="char-window" class="window panel ui-window" style="display:block">
    <div class="char-body"><section class="char-equipment-pane"><div class="paperdoll">
      <div class="equip-col" id="equip-col-left">${SLOTS.left.map(slotRow).join('')}</div>
      <div class="char-model-panel ui-card">
        <div id="char-model-preview" class="char-model-preview"><canvas style="width:100%;height:100%;display:block"></canvas></div>
        <div id="char-skin-row" class="skin-row char-skin-row"></div>
      </div>
      <div class="equip-col equip-col-right" id="equip-col-right">${SLOTS.right.map(slotRow).join('')}</div>
      <div class="equip-row-weapons" id="equip-row-weapons">${SLOTS.weapons.map(slotRow).join('')}</div>
    </div></section></div>
  </div>`;
  document.body.appendChild(ui);
  return ui;
}

afterEach(() => cleanup());

describe('desktop paperdoll: gear rows stay above the model stage', () => {
  it('hit-tests every socket and unequip chip to its own row, left column included', async () => {
    await page.viewport(1600, 900);
    const ui = mountSheet();
    const misses: string[] = [];
    for (const slot of [...SLOTS.left, ...SLOTS.right, ...SLOTS.weapons]) {
      const row = ui.querySelector<HTMLElement>(`#equip-slot-${slot}`);
      if (!row) throw new Error(`missing row ${slot}`);
      for (const sel of ['.item-icon', '.equip-unequip-btn']) {
        const el = row.querySelector<HTMLElement>(sel);
        if (!el) throw new Error(`missing ${sel} in ${slot}`);
        const b = el.getBoundingClientRect();
        expect(b.width, `${slot} ${sel} is laid out`).toBeGreaterThan(0);
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        if (!hit || !row.contains(hit)) misses.push(`${slot} ${sel} -> ${hit?.tagName ?? 'null'}`);
      }
    }
    expect(misses).toEqual([]);
  });
});
