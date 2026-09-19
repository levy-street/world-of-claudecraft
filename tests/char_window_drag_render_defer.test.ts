// @vitest-environment happy-dom

// Unequip-drag render-tear defect (the same hazard bags_window.ts already guards
// against for bag-item drags, see tests/bags_window_drag_render_defer.test.ts): a
// native HTML5 drag started by dragging an equipped item off the paperdoll to
// unequip it loses its dragend when the row it started on is destroyed mid-drag by
// a full sheet rebuild. Hud.refreshCharSheetIfChanged repaints an OPEN character
// sheet within 500 ms of a loot, deed, or mount gain (routine, not rare), and
// browsers never fire dragend on a source node that has left the document, so the
// HUD's drag-to-unequip slot (cleared only from dragend) is then stuck for the
// rest of the session: a later drop reads the stale drag instead of the live one.
//
// The fix mirrors bags_window.ts: render() defers its rebuild while this window's
// own unequipDragActive flag is set, and the dragged row's own dragend flushes the
// deferred rebuild once the drag concludes.

import { describe, expect, it, vi } from 'vitest';
import { CharWindow, type CharWindowDeps } from '../src/ui/char_window';
import { ItemDragState } from '../src/ui/item_drag_state';

function harness() {
  let canvasContext: unknown;
  canvasContext = new Proxy({}, { get: () => () => canvasContext, set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasContext as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,stub');

  const root = document.createElement('div');
  document.body.appendChild(root);
  const state = {
    equipment: { ring1: 'warhewn_signet' } as Record<string, string>,
    honor: 0,
  };
  let unequipDragSlot: string | null = null;
  const deps: CharWindowDeps = {
    root: () => root,
    world: () =>
      ({
        cfg: { playerClass: 'warrior' },
        player: { name: 'Aurelia', level: 60, skin: 0 },
        equipment: state.equipment,
        honor: state.honor,
        archetypeTitle: null,
        hobbyCraft: null,
        selectedMount: () => null,
        ownedMounts: () => [],
        selectMount: () => {},
        professionsState: { skills: [] },
      }) as never,
    closeOthers: vi.fn(),
    hideTooltip: vi.fn(),
    captureFocus: () => null,
    restoreFocus: vi.fn(),
    slotName: (slot) => slot,
    statCellHtml: () => '',
    statTooltipHtml: () => '',
    talentSummaryHtml: () => '',
    progressionHtml: () => '',
    unequip: vi.fn(),
    beginUnequipDrag: (slot) => {
      unequipDragSlot = slot;
    },
    endUnequipDrag: () => {
      unequipDragSlot = null;
    },
    renderPreview: vi.fn(),
    renderSkinPicker: vi.fn(),
    openPlayerCard: vi.fn(),
    openPrestige: vi.fn(),
    openDeeds: vi.fn(),
    openCosmetics: vi.fn(),
    openReliquary: vi.fn(),
    dragState: new ItemDragState(),
    renderBags: vi.fn(),
    showError: vi.fn(),
    helmSlotAvailable: () => true,
    helmHidden: () => false,
    toggleHelm: vi.fn(),
    playtimeVisible: () => true,
    togglePlaytimeVisible: vi.fn(),
    itemIcon: () => 'data:image/png;base64,stub',
    moneyHtml: () => '',
    wornItemTooltip: () => '',
    attachTooltip: vi.fn(),
  };
  const win = new CharWindow(deps);
  return {
    win,
    root,
    unequipDragSlot: () => unequipDragSlot,
    grantHonor: (n: number) => {
      state.honor = n;
    },
    ringRow: () => root.querySelector<HTMLElement>('#equip-slot-ring1'),
  };
}

describe('CharWindow.render defers a rebuild that would tear out a live unequip drag', () => {
  it('does not rebuild the paperdoll while an equipped row is mid-drag', () => {
    const h = harness();
    h.win.render();
    const leftColBefore = h.root.querySelector('#equip-col-left');
    const row = h.ringRow();
    expect(row).not.toBeNull();

    // The player has the ring picked up (dragstart already ran beginUnequipDrag).
    row?.dispatchEvent(new Event('dragstart'));
    expect(h.unequipDragSlot()).toBe('ring1');

    // Honor changing lands mid-drag: the common case (a loot, a deed, a mount
    // gain repaints an open sheet within 500ms). Un-guarded, render() would
    // innerHTML-wipe the paperdoll and destroy the dragged row before it can
    // fire dragend.
    h.grantHonor(50);
    h.win.render();

    // Deferred: the SAME column node, the SAME row, still connected.
    expect(h.root.querySelector('#equip-col-left')).toBe(leftColBefore);
    expect(h.ringRow()).toBe(row);
    expect(row?.isConnected).toBe(true);
  });

  it("flushes the deferred rebuild once the dragged row's own dragend fires", () => {
    const h = harness();
    h.win.render();
    const row = h.ringRow();
    row?.dispatchEvent(new Event('dragstart'));

    h.grantHonor(50);
    h.win.render(); // deferred; the row survives

    const leftColBefore = h.root.querySelector('#equip-col-left');

    // The row survived (nothing destroyed it out from under the drag), so the
    // browser fires its dragend normally.
    row?.dispatchEvent(new Event('dragend'));

    // The ordinary dragend cleanup ran (the drag state is no longer stuck)...
    expect(h.unequipDragSlot()).toBeNull();
    // ...and the deferred rebuild caught up: a fresh paperdoll column.
    expect(h.root.querySelector('#equip-col-left')).not.toBe(leftColBefore);
  });

  it('renders normally with no drag in flight (no regression to the common path)', () => {
    const h = harness();
    h.win.render();
    const leftColBefore = h.root.querySelector('#equip-col-left');
    h.grantHonor(50);
    h.win.render();
    expect(h.root.querySelector('#equip-col-left')).not.toBe(leftColBefore);
  });
});
