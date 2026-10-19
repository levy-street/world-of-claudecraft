// @vitest-environment happy-dom
//
// The inspect window's Item history door on a worn tracked copy
// (docs/design/item-tracking.md): the row of a slot whose worn payload carries
// a provenance record becomes focusable (the Context Menu key door), opens the
// shared history prompt on right-click with the PUBLIC lines (another
// player's copy reads publicProvenanceView), and grows a visible button
// beneath it on touch layouts only (the bank cell rule). An untracked slot
// gets none of this. Driven against the real InspectWindow painter (the
// inspect_window.test.ts harness).

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/portrait_chip', () => ({
  hydratePortraits: () => undefined,
  portraitChipHtml: () => '',
}));

import type { ItemProvenance, PlayerClass } from '../src/sim/types';
import { type InspectEntity, InspectWindow } from '../src/ui/inspect_window';
import { closeItemHistoryDialog } from '../src/ui/item_history_dialog';

const GUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const RECORD: ItemProvenance = {
  at: Date.UTC(2026, 8, 30),
  by: 'Alice',
  byId: 11,
  source: 'quest:the_long_road',
  owners: [{ at: Date.UTC(2026, 9, 1), by: 'Bob', byId: 22 }],
  transfers: 1,
};

const STUB_DATA_URL = 'data:image/png;base64,c3R1Yg==';
function fakeCtx(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} };
  return new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, prop) => {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
      if (prop in t) return t[prop];
      return () => {};
    },
    set: (t, prop, value) => {
      t[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

let win: InspectWindow | null = null;

function openWith(e: InspectEntity, selfWorn?: InspectEntity['equippedInstances']): HTMLElement {
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = realCreate(tag);
    if (tag === 'canvas') {
      (el as HTMLCanvasElement).getContext = (() => fakeCtx()) as never;
      (el as HTMLCanvasElement).toDataURL = () => STUB_DATA_URL;
    }
    return el;
  });
  const stack = realCreate('div');
  stack.id = 'prompt-stack';
  document.body.appendChild(stack);
  const root = realCreate('div');
  root.id = 'inspect-window';
  root.className = 'window panel ui-window';
  document.body.appendChild(root);
  win = new InspectWindow({
    root: () => root,
    closeOthers: vi.fn(),
    hideTooltip: vi.fn(),
    captureFocus: () => null,
    restoreFocus: vi.fn(),
    slotName: (slot) => slot,
    showDevBadges: () => false,
    mountPreview: vi.fn(),
    itemIcon: () => `<img class="item-icon" src="${STUB_DATA_URL}" alt="">`,
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: () => {},
  });
  win.openInspect(e, 1_700_000_000_000, null, selfWorn);
  return root;
}

function peer(): InspectEntity {
  return {
    templateId: 'warrior' as PlayerClass,
    name: 'Bob',
    level: 60,
    equippedItems: { mainhand: 'duskforged_warblade', chest: 'eastbrook_ritual_vestments' },
    // The offline Sim mirror holds the FULL payload (guid, ids); the online
    // mirror holds the public record. The window must show public lines for both.
    equippedInstances: { mainhand: { guid: GUID, provenance: RECORD } },
  };
}

function slotRow(root: HTMLElement, itemName: string): HTMLElement {
  const row = [...root.querySelectorAll<HTMLElement>('.equip-slot')].find((r) =>
    r.textContent?.includes(itemName),
  );
  if (!row) throw new Error(`no slot row for ${itemName}`);
  return row;
}

afterEach(() => {
  closeItemHistoryDialog(false);
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  document.body.className = '';
  win = null;
});

describe('inspect window: Item history on a worn tracked copy', () => {
  it('makes only the tracked row focusable and opens the public lines on right-click', () => {
    const root = openWith(peer());
    const tracked = slotRow(root, 'Duskforged Warblade');
    const plain = slotRow(root, 'Ritual Vestments');
    expect(tracked.tabIndex).toBe(0);
    expect(plain.hasAttribute('tabindex')).toBe(false);

    const onPlain = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    plain.dispatchEvent(onPlain);
    expect(onPlain.defaultPrevented).toBe(false);
    expect(document.getElementById('item-history-dialog')).toBeNull();

    const onTracked = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    tracked.dispatchEvent(onTracked);
    expect(onTracked.defaultPrevented).toBe(true);
    const dialog = document.getElementById('item-history-dialog');
    expect(dialog?.textContent).toContain('Duskforged Warblade: history');
    expect(dialog?.textContent).toContain('Quest reward to Alice on ');
    expect(dialog?.textContent).toContain('Passed to Bob on ');
    expect(dialog?.innerHTML).not.toContain(GUID);
    // Desktop: no visible button squeezed into the paperdoll column.
    expect(root.querySelector('.item-history-action')).toBeNull();
  });

  it('opens the history from the keyboard with Enter on the focusable row', () => {
    const root = openWith(peer());
    const tracked = slotRow(root, 'Duskforged Warblade');
    const plain = slotRow(root, 'Ritual Vestments');
    expect(tracked.getAttribute('role')).toBe('button');
    expect(tracked.getAttribute('aria-label')).toBe('Item history for Duskforged Warblade');
    expect(plain.hasAttribute('role')).toBe(false);
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    tracked.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    const dialog = document.getElementById('item-history-dialog');
    expect(dialog?.textContent).toContain('Duskforged Warblade: history');
    expect(dialog?.innerHTML).not.toContain(GUID);
  });

  it('adds the visible button beneath the tracked row on a touch layout', () => {
    document.body.classList.add('mobile-touch');
    const root = openWith(peer());
    const buttons = root.querySelectorAll<HTMLButtonElement>('.item-history-action');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].parentElement?.contains(slotRow(root, 'Duskforged Warblade'))).toBe(true);
    // The paperdoll-slot modifier centers the button under its row instead of
    // letting a bare wrapper push it to the column's left edge.
    expect(buttons[0].parentElement?.classList.contains('material-source-item-slot')).toBe(true);
    buttons[0].click();
    expect(document.getElementById('item-history-dialog')?.textContent).toContain(
      'Quest reward to Alice on ',
    );
  });

  it('offers nothing when no worn copy is tracked, and closes with the window', () => {
    const bare = openWith({ ...peer(), equippedInstances: {} });
    expect(bare.querySelectorAll('.equip-slot[tabindex]')).toHaveLength(0);
    document.body.innerHTML = '';
    vi.restoreAllMocks();

    const root = openWith(peer());
    slotRow(root, 'Duskforged Warblade').dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    expect(document.getElementById('item-history-dialog')).not.toBeNull();
    root.style.display = 'block';
    win?.close();
    expect(document.getElementById('item-history-dialog')).toBeNull();
  });

  it('reads the viewer own worn record on a self-inspect', () => {
    const self = { ...peer(), equippedInstances: {} };
    const root = openWith(self, { mainhand: { guid: GUID, provenance: RECORD } });
    expect(slotRow(root, 'Duskforged Warblade').tabIndex).toBe(0);
  });
});
