// @vitest-environment jsdom

// Spellbook-drag render-tear defect (the same hazard bags_window.ts already
// guards against for bag-item drags, see tests/bags_window_drag_render_defer.test.ts):
// a native HTML5 drag started on the Attack row or an ability row loses its dragend
// when the row it started on is destroyed mid-drag by a full list rebuild.
// spellbook_window.tickOpen() runs on Hud.update()'s per-frame band and rebuilds via
// render() whenever ANY known ability's resolved cooldown moves (knownChanged), which
// is true on almost every tick some known ability is on cooldown. Browsers never fire
// dragend on a source node that has left the document, so Hud.dragAction (cleared only
// from dragend) is then stuck for the rest of the session: every later drop onto the
// action bar reads that stale drag instead of the live one and silently refuses.
//
// The fix mirrors bags_window.ts exactly: render() defers its rebuild while this
// window's own dragActive flag is set, and the dragged row's own dragend flushes the
// deferred rebuild once the drag concludes, so the row always survives long enough to
// fire its own dragend normally.

import { describe, expect, it, vi } from 'vitest';
import type { ResolvedAbility } from '../src/sim/sim';
import type { HotbarAction } from '../src/ui/hud/action_bar/hotbar';
import { SpellbookWindow, type SpellbookWindowDeps } from '../src/ui/spellbook_window';

// jsdom ships no 2D canvas, so the procedural ability-icon compositor cannot run here.
vi.mock('../src/ui/icons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/icons')>()),
  iconDataUrl: () => 'data:,',
}));

const CLASS_ID = 'warrior';

function resolved(abilityId: string, cooldown = 0): ResolvedAbility {
  return {
    def: { id: abilityId },
    rank: 1,
    cost: 10,
    castTime: 0,
    cooldown,
  } as unknown as ResolvedAbility;
}

function harness() {
  document.body.innerHTML = '<div id="spellbook" class="window panel"></div>';
  const root = document.getElementById('spellbook') as HTMLElement;
  const state = {
    known: [resolved('heroic_strike'), resolved('battle_shout')],
    bar: [null, null] as HotbarAction[],
    hasFree: true,
    attackOnBar: true,
  };
  let dragAction: { type: 'ability'; id: string } | null = null;
  const noop = (): void => {};
  const deps: SpellbookWindowDeps = {
    root: () => root,
    world: () =>
      ({
        cfg: { playerClass: CLASS_ID },
        known: state.known,
        player: { level: 60 },
        talentSpec: null,
      }) as never,
    closeOthers: noop,
    captureFocus: () => null,
    restoreFocus: noop,
    hideTooltip: noop,
    attachTooltip: noop,
    abilitySummary: () => 'summary',
    abilityTooltip: () => '<div></div>',
    barActions: () => state.bar,
    hasFreeSlot: () => state.hasFree,
    attackOnBar: () => state.attackOnBar,
    setAttackOnBar: (on) => {
      state.attackOnBar = on;
    },
    addToBar: () => false,
    removeFromBar: () => false,
    hasFormBars: () => false,
    resetFormBar: noop,
    setDragAction: (action) => {
      dragAction = action;
    },
    clearActionDropTargets: noop,
    openBarEditor: noop,
  };
  const win = new SpellbookWindow(deps);
  return {
    win,
    root,
    dragAction: () => dragAction,
    setCooldown: (abilityId: string, cooldown: number) => {
      const known = state.known.find((k) => k.def.id === abilityId);
      if (known) (known as { cooldown: number }).cooldown = cooldown;
    },
    row: (abilityId: string) =>
      root.querySelector<HTMLElement>(`.spell-row[data-ability-id="${abilityId}"]`),
    attackRow: () => {
      // The Attack row carries no data-ability-id; it is the first .spell-row.
      return root.querySelector<HTMLElement>('.spell-row');
    },
  };
}

describe('SpellbookWindow.render defers a rebuild that would tear out a live drag', () => {
  it('does not rebuild the list while an ability row is mid-drag', () => {
    const h = harness();
    h.win.toggle(); // opens, renders once
    const listBefore = h.root.querySelector('.spell-list');
    const rowBefore = h.row('heroic_strike');
    expect(rowBefore).not.toBeNull();

    // The player has heroic_strike picked up (dragstart already ran).
    rowBefore?.dispatchEvent(new Event('dragstart'));
    expect(h.dragAction()).toEqual({ type: 'ability', id: 'heroic_strike' });

    // A cooldown tick lands mid-drag: the common case (almost every tick some known
    // ability is cooling down). Un-guarded, render() would innerHTML-wipe the list
    // and destroy the dragged row before it can fire dragend.
    h.setCooldown('heroic_strike', 5);
    h.win.render();

    // Deferred: the SAME list node, the SAME row, still connected.
    expect(h.root.querySelector('.spell-list')).toBe(listBefore);
    expect(h.row('heroic_strike')).toBe(rowBefore);
    expect(rowBefore?.isConnected).toBe(true);
  });

  it("flushes the deferred rebuild once the dragged row's own dragend fires", () => {
    const h = harness();
    h.win.toggle();
    const row = h.row('heroic_strike');
    row?.dispatchEvent(new Event('dragstart'));

    h.setCooldown('heroic_strike', 5);
    h.win.render(); // deferred; the row survives

    const listBefore = h.root.querySelector('.spell-list');

    // The row survived (nothing destroyed it out from under the drag), so the
    // browser fires its dragend normally.
    row?.dispatchEvent(new Event('dragend'));

    // The ordinary dragend cleanup ran (the drag state is no longer stuck)...
    expect(h.dragAction()).toBeNull();
    // ...and the deferred rebuild caught up: a fresh list reflecting the new cooldown.
    expect(h.root.querySelector('.spell-list')).not.toBe(listBefore);
  });

  it('defers while the Attack row is mid-drag too (a separate drag/dragend pair)', () => {
    const h = harness();
    h.win.toggle();
    const attackRow = h.attackRow();
    const listBefore = h.root.querySelector('.spell-list');
    expect(attackRow?.className).toContain('spell-row');

    attackRow?.dispatchEvent(new Event('dragstart'));
    h.setCooldown('heroic_strike', 5);
    h.win.render();
    expect(h.root.querySelector('.spell-list')).toBe(listBefore);
    expect(attackRow?.isConnected).toBe(true);

    attackRow?.dispatchEvent(new Event('dragend'));
    expect(h.root.querySelector('.spell-list')).not.toBe(listBefore);
  });

  it('renders normally with no drag in flight (no regression to the common path)', () => {
    const h = harness();
    h.win.toggle();
    const listBefore = h.root.querySelector('.spell-list');
    h.setCooldown('heroic_strike', 5);
    h.win.render();
    expect(h.root.querySelector('.spell-list')).not.toBe(listBefore);
  });
});
