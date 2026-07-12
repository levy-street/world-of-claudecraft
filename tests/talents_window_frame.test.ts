// @vitest-environment jsdom
//
// Behavioral guards for the talents window's tiered-choices layout on the AAA
// frame (the pure tier / point-economy decisions are unit-tested in
// talents_view.test.ts; the source-level token/dash pins live in
// talents_window.test.ts). These render the real DOM through the shared
// window-frame builder and assert: the frame chrome is stamped on an INNER mount
// (the shared #talents-window root stays pristine so its clamp/resize/mobile-inset
// rules keep matching), the CHOICES / SPECIALIZATION rail is the frame's own
// tab-rail, the titlebar pairs "Talents" with the class name, the status strip +
// tier rows + staged-edit build panels all render in the body, and the sacred
// staged-edit semantics survive: apply commits through deps.saveLoadout,
// revert-on-close discards the staged buffer without committing, and a loadout
// switch re-seeds the stage. The titlebar is a Hud drag handle (never the close),
// and the close routes through the frame to close().

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cloneAllocation,
  emptyAllocation,
  type SavedLoadout,
  type TalentAllocation,
  talentsFor,
} from '../src/sim/content/talents';
import type { PlayerClass } from '../src/sim/types';
import { TalentsWindow, type TalentsWindowDeps } from '../src/ui/talents_window';
import { isWindowDragHandle } from '../src/ui/window_drag_handle';

// Talent node/choice icons resolve procedural icons through a 2D canvas, which
// jsdom lacks; stub the icon module so the cards can paint without a real canvas.
vi.mock('../src/ui/talent_icons', () => ({
  talentNodeIconDataUrl: () => 'data:image/png;base64,stub',
  talentChoiceIconDataUrl: () => 'data:image/png;base64,stub',
}));

interface DepOverrides {
  cls?: PlayerClass;
  total?: number;
  activeLoadout?: number;
  loadouts?: SavedLoadout[];
  saveLoadout?: TalentsWindowDeps['saveLoadout'];
  switchLoadout?: TalentsWindowDeps['switchLoadout'];
  applyLoadoutBar?: TalentsWindowDeps['applyLoadoutBar'];
  captureDropdown?: (onChange: (v: string) => void) => void;
}

function talentsEl(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'talents-window';
  el.className = 'window panel';
  document.body.appendChild(el);
  return el;
}

function makeDeps(
  el: HTMLElement,
  stageRef: { current: TalentAllocation | null },
  o: DepOverrides = {},
): TalentsWindowDeps {
  return {
    // PainterHostPresentation (only attachTooltip is exercised by this window).
    itemIcon: () => '',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: () => {},
    root: () => el,
    hideTooltip: () => {},
    captureFocus: () => null,
    restoreFocus: () => {},
    getStage: () => stageRef.current,
    setStage: (s) => {
      stageRef.current = s;
    },
    playerClass: () => o.cls ?? 'warrior',
    totalPoints: () => o.total ?? 11,
    currentAllocation: () => emptyAllocation(),
    activeLoadout: () => o.activeLoadout ?? -1,
    loadouts: () => o.loadouts ?? [],
    currentBar: () => [],
    saveLoadout: o.saveLoadout ?? (() => {}),
    switchLoadout: o.switchLoadout ?? (() => {}),
    deleteLoadout: () => {},
    applyLoadoutBar: o.applyLoadoutBar ?? (() => {}),
    buildDropdown: (_options, _current, onChange) => {
      o.captureDropdown?.(onChange);
      const d = document.createElement('div');
      d.className = 'tal-loadslot-dd';
      return d;
    },
    inputDialog: () => {},
    confirmDialog: () => {},
    showError: () => {},
  };
}

function openWindow(
  el: HTMLElement,
  o: DepOverrides = {},
): {
  win: TalentsWindow;
  stageRef: { current: TalentAllocation | null };
} {
  const stageRef: { current: TalentAllocation | null } = { current: null };
  const win = new TalentsWindow(makeDeps(el, stageRef, o));
  win.open();
  return { win, stageRef };
}

afterEach(() => {
  document.body.classList.remove('mobile-touch');
  document.body.innerHTML = '';
});

describe('TalentsWindow: frame adoption', () => {
  it('stamps the window-frame chrome on an INNER mount with titlebar, tab rail, body, close, and NO footer', () => {
    const el = talentsEl();
    openWindow(el);
    expect(el.classList.contains('window-frame')).toBe(false);
    expect(el.hasAttribute('role')).toBe(false);
    const frame = el.querySelector<HTMLElement>(':scope > .window-frame');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('role')).toBe('dialog');
    expect(frame?.getAttribute('aria-labelledby')).toBe('talents-window-title');
    expect(frame?.querySelector('.window-titlebar')).not.toBeNull();
    expect(frame?.querySelector('.window-body')).not.toBeNull();
    expect(frame?.querySelector('[data-window-close]')).not.toBeNull();
    // The CHOICES / SPECIALIZATION rail is the frame's own tab-rail grammar.
    const tabs = frame?.querySelectorAll('.tab-rail [data-window-tab]') ?? [];
    expect(tabs.length).toBe(2);
    expect(tabs[0].textContent).toContain('Choices');
    expect(tabs[1].textContent).toContain('Specialization');
    // The staged-edit build panels stay in the body, so the frame has no footer.
    expect(frame?.querySelector('.window-footer')).toBeNull();
  });

  it('titles the frame "Talents" and pairs the class name in the titlebar', () => {
    const el = talentsEl();
    openWindow(el);
    expect(el.querySelector('.window-title')?.textContent).toBe('Talents');
    const sub = el.querySelector('.window-titlebar .tal-class-sub');
    expect(sub?.textContent).toBe('Warrior');
  });

  it('keeps the shared root a pristine .window.panel (no builder class / role / aria)', () => {
    const el = talentsEl();
    openWindow(el);
    expect(el.className).toBe('window panel');
    expect(el.hasAttribute('role')).toBe(false);
    expect(el.hasAttribute('aria-labelledby')).toBe(false);
  });

  it('reuses the frame on a re-render instead of rebuilding it cold', () => {
    const el = talentsEl();
    const { win } = openWindow(el);
    const firstBody = el.querySelector('.window-body');
    win.render();
    expect(el.querySelector('.window-body')).toBe(firstBody);
    expect(el.querySelectorAll('.window-titlebar').length).toBe(1);
  });
});

describe('TalentsWindow: status strip + tier rows (CHOICES tab)', () => {
  it('shows the choices count and the unchosen-spec placeholder in the status strip', () => {
    const el = talentsEl();
    openWindow(el);
    const strip = el.querySelector<HTMLElement>('.window-body .tal-status');
    expect(strip).not.toBeNull();
    expect(strip?.querySelector('.tal-status-choices')?.textContent).toContain('Choices');
    expect(strip?.querySelector('.tal-status-choices')?.textContent).toContain('0');
    expect(strip?.querySelector('.tal-status-choices')?.textContent).toContain('11');
    expect(strip?.querySelector('.tal-status-spec')?.textContent).toContain(
      'Choose a Specialization',
    );
  });

  it('renders the class tree as unlock-level tier rows of talent cards', () => {
    const el = talentsEl();
    openWindow(el);
    const ct = talentsFor('warrior')!;
    const classNodes = ct.nodes.filter((n) => n.tree === 'class');
    const rowCount = new Set(classNodes.map((n) => n.row)).size;
    const tiers = el.querySelectorAll('#tal-body .tal-tiers .tal-tier');
    expect(tiers.length).toBe(rowCount);
    expect(el.querySelectorAll('#tal-body .tal-card').length).toBe(classNodes.length);
    // The left rail carries the tier's unlock level; the first tier is the
    // first talent level (10) and levels never decrease down the rows.
    const levels = Array.from(tiers).map((tier) =>
      Number(tier.querySelector('.tal-tier-num')?.textContent),
    );
    expect(levels[0]).toBe(10);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    // Cards keep their column identity on the 3-column grid.
    for (const card of Array.from(el.querySelectorAll<HTMLElement>('#tal-body .tal-card'))) {
      expect(card.className).toMatch(/tal-col-[0-2]/);
    }
    // The build panels render under the tiers.
    const body = el.querySelector<HTMLElement>('.window-body') as HTMLElement;
    expect(body.querySelector('.tal-foot')).not.toBeNull();
    expect(body.querySelector('[data-act="save"]')).not.toBeNull();
  });

  it('keeps every card inside its own tier band (one horizontal row per tier)', () => {
    const el = talentsEl();
    openWindow(el);
    const ct = talentsFor('warrior')!;
    const classRows = [...new Set(ct.nodes.filter((n) => n.tree === 'class').map((n) => n.row))]
      .sort((a, b) => a - b)
      .map(String);
    // Each tier section stamps its content row, in ascending row order.
    const tiers = Array.from(el.querySelectorAll<HTMLElement>('#tal-body .tal-tier'));
    expect(tiers.map((tier) => tier.dataset.tierRow)).toEqual(classRows);
    for (const tier of tiers) {
      // Every card carries its tier's row stamp and lives inside THAT tier's
      // cards grid, whose stylesheet contract places all of them on grid row 1
      // (the tal-col-N class carries the column; the grid-row pin is
      // source-guarded in talents_window.test.ts), so the cards of one tier
      // always render as a single horizontal band beside the level rail.
      for (const card of Array.from(tier.querySelectorAll<HTMLElement>('.tal-card'))) {
        expect(card.dataset.tierRow).toBe(tier.dataset.tierRow);
        expect(card.parentElement?.classList.contains('tal-tier-cards')).toBe(true);
        expect(card.closest('.tal-tier')).toBe(tier);
      }
      // The rail is the tier's only other cell.
      expect(tier.querySelector(':scope > .tal-tier-rail')).not.toBeNull();
    }
    // Cards never leak between tiers: the per-tier counts partition the card set.
    const allCards = el.querySelectorAll('#tal-body .tal-card').length;
    const perTier = tiers.reduce((a, tier) => a + tier.querySelectorAll('.tal-card').length, 0);
    expect(perTier).toBe(allCards);
  });

  it('level-locks the deep tiers when the point budget cannot open them', () => {
    const el = talentsEl();
    openWindow(el, { total: 1 }); // one point: only the free tier is reachable
    const tiers = Array.from(el.querySelectorAll<HTMLElement>('#tal-body .tal-tier'));
    expect(tiers[0].classList.contains('level-locked')).toBe(false);
    const last = tiers[tiers.length - 1];
    expect(last.classList.contains('level-locked')).toBe(true);
    // The locked rail carries the lock affordance; its cards are gate-locked.
    expect(last.querySelector('.tal-tier-rail .tal-tier-lock')).not.toBeNull();
    expect(last.querySelectorAll('.tal-card.locked').length).toBeGreaterThan(0);
  });

  it('updates the tab pip and the strip count when a point is staged', () => {
    const el = talentsEl();
    openWindow(el);
    const node = el.querySelector<HTMLElement>('#tal-body .tal-card.avail:not(.octagon)');
    expect(node).not.toBeNull();
    (node as HTMLElement).click();
    const pip = el.querySelector('[data-window-tab="choices"] .tt-pts');
    expect(pip?.textContent).toBe('1');
    expect(el.querySelector('.tal-status-choices')?.textContent).toContain('1');
  });
});

describe('TalentsWindow: SPECIALIZATION tab', () => {
  it('switches to the spec radiogroup through the frame tab and back', () => {
    const el = talentsEl();
    openWindow(el);
    const specTab = el.querySelector<HTMLButtonElement>('[data-window-tab="spec"]');
    expect(specTab).not.toBeNull();
    specTab?.click();
    expect(specTab?.getAttribute('aria-selected')).toBe('true');
    // The body IS the tabpanel: its id follows the active tab's panel.
    const body = el.querySelector<HTMLElement>('.window-body') as HTMLElement;
    expect(body.id).toBe('talents-window-panel-spec');
    const radios = el.querySelectorAll('#tal-body .tal-specs [role="radio"]');
    expect(radios.length).toBe(talentsFor('warrior')!.specs.length);
    // No spec chosen yet: the empty-state prompt shows instead of a tier list.
    expect(el.querySelector('#tal-body .tal-tiers')).toBeNull();
    expect(el.querySelector('#tal-body .tal-empty')).not.toBeNull();
    // Back to CHOICES.
    el.querySelector<HTMLButtonElement>('[data-window-tab="choices"]')?.click();
    expect(el.querySelector('#tal-body .tal-tiers')).not.toBeNull();
  });

  it('choosing a spec paints its tier rows and names it in the status strip', () => {
    const el = talentsEl();
    openWindow(el);
    el.querySelector<HTMLButtonElement>('[data-window-tab="spec"]')?.click();
    const radio = el.querySelector<HTMLElement>('#tal-body .tal-spec');
    expect(radio).not.toBeNull();
    radio?.click();
    // The spec tree now renders as tier rows, and the strip names the spec.
    expect(el.querySelectorAll('#tal-body .tal-tiers .tal-tier').length).toBeGreaterThan(0);
    const specName = talentsFor('warrior')!.specs[0].name;
    expect(el.querySelector('.tal-status-spec')?.textContent).toContain(specName);
  });
});

describe('TalentsWindow: move / resize / fit parity', () => {
  it('makes the frame titlebar a Hud drag handle, but never the close button', () => {
    const el = talentsEl();
    openWindow(el);
    const titlebar = el.querySelector<HTMLElement>('.window-titlebar') as HTMLElement;
    const closeBtn = el.querySelector<HTMLElement>('[data-window-close]') as HTMLElement;
    expect(isWindowDragHandle(titlebar, el)).toBe(true);
    expect(isWindowDragHandle(closeBtn, el)).toBe(false);
  });

  it('refuses the titlebar drag on the touch HUD, and recognizes it again without it', () => {
    const el = talentsEl();
    openWindow(el);
    const titlebar = el.querySelector<HTMLElement>('.window-titlebar') as HTMLElement;
    document.body.classList.add('mobile-touch');
    expect(isWindowDragHandle(titlebar, el)).toBe(false);
    document.body.classList.remove('mobile-touch');
    expect(isWindowDragHandle(titlebar, el)).toBe(true);
  });
});

describe('TalentsWindow: staged-edit semantics (sacred)', () => {
  it('spends a point into the staged buffer when an available card is clicked, never the live build', () => {
    const el = talentsEl();
    const { stageRef } = openWindow(el);
    // An available (avail) non-choice card spends a rank directly on click; a
    // choice (octagon) card opens a flyout instead, so exclude it here.
    const node = el.querySelector<HTMLElement>('#tal-body .tal-card.avail:not(.octagon)');
    expect(node, 'expected at least one spendable card in the warrior class tree').not.toBeNull();
    (node as HTMLElement).click();
    // The click mutated the staged buffer in place (points now spent), NOT the
    // server-authoritative build (the commit path is save/switch/delete only).
    const spent = Object.keys(stageRef.current?.ranks ?? {}).length;
    expect(spent).toBeGreaterThan(0);
  });

  it('opens the option flyout for a choice (octagon) card and stages the pick', () => {
    const el = talentsEl();
    const { win, stageRef } = openWindow(el);
    const ct = talentsFor('warrior')!;
    // Stage enough gate-free points to satisfy the choice node's points gate,
    // then re-render so the octagon card reflects the staged budget.
    const stage = stageRef.current as TalentAllocation;
    for (const n of ct.nodes.filter((x) => x.tree === 'class' && !x.pointsGate && !x.requires)) {
      stage.ranks[n.id] = n.maxRank;
    }
    win.render();
    const choiceNode = ct.nodes.find((n) => n.tree === 'class' && n.kind === 'choice')!;
    const octagon = el.querySelector<HTMLElement>('#tal-body .tal-card.octagon');
    expect(octagon).not.toBeNull();
    octagon?.click();
    const pop = document.getElementById('tal-choice-pop');
    expect(pop).not.toBeNull();
    const opt = pop?.querySelector<HTMLElement>('.tal-choice-opt');
    opt?.click();
    expect(stageRef.current?.choices[choiceNode.id]).toBe(choiceNode.choices?.[0].id ?? 'missing');
  });

  it('APPLY: Save current commits the staged build through deps.saveLoadout', () => {
    const el = talentsEl();
    const saveLoadout = vi.fn();
    const loadouts: SavedLoadout[] = [{ name: 'PvP', alloc: emptyAllocation(), bar: [] }];
    openWindow(el, { saveLoadout, loadouts, activeLoadout: 0 });
    el.querySelector<HTMLButtonElement>('[data-act="save"]')?.click();
    // An active loadout saves in place under its own name (no prompt).
    expect(saveLoadout).toHaveBeenCalledTimes(1);
    expect(saveLoadout.mock.calls[0][0]).toBe('PvP');
  });

  it('RESET CHOICES: clears every staged point without committing', () => {
    const el = talentsEl();
    const saveLoadout = vi.fn();
    const { stageRef } = openWindow(el, { saveLoadout });
    const node = el.querySelector<HTMLElement>('#tal-body .tal-card.avail:not(.octagon)');
    (node as HTMLElement).click();
    expect(Object.keys(stageRef.current?.ranks ?? {}).length).toBeGreaterThan(0);
    const clear = el.querySelector<HTMLButtonElement>('[data-act="clear"]');
    expect(clear?.textContent).toBe('Reset choices');
    clear?.click();
    expect(stageRef.current?.ranks).toEqual({});
    expect(saveLoadout).not.toHaveBeenCalled();
  });

  it('REVERT: closing discards the staged buffer without committing to the live build', () => {
    const el = talentsEl();
    const saveLoadout = vi.fn();
    const { win, stageRef } = openWindow(el, { saveLoadout });
    expect(stageRef.current).not.toBeNull(); // seeded on open
    win.close();
    // The staged edits are dropped (buffer nulled), and nothing was committed.
    expect(stageRef.current).toBeNull();
    expect(saveLoadout).not.toHaveBeenCalled();
    expect(el.style.display).toBe('none');
  });

  it('LOADOUT SWITCH: selecting a saved build switches it and re-seeds the stage', () => {
    const el = talentsEl();
    const switchLoadout = vi.fn();
    const applyLoadoutBar = vi.fn();
    const alloc = cloneAllocation(emptyAllocation());
    const loadouts: SavedLoadout[] = [{ name: 'Fury', alloc, bar: ['a', 'b'] }];
    let onChange: ((v: string) => void) | null = null;
    const { stageRef } = openWindow(el, {
      switchLoadout,
      applyLoadoutBar,
      loadouts,
      activeLoadout: -1,
      captureDropdown: (cb) => {
        onChange = cb;
      },
    });
    expect(onChange).not.toBeNull();
    (onChange as unknown as (v: string) => void)('0');
    expect(switchLoadout).toHaveBeenCalledWith(0);
    expect(applyLoadoutBar).toHaveBeenCalledWith(['a', 'b']);
    // The stage is re-seeded from a CLONE of the switched-to build (not the same ref).
    expect(stageRef.current).not.toBe(alloc);
    expect(stageRef.current).toEqual(alloc);
  });
});

describe('TalentsWindow: close routing', () => {
  it('routes the frame close control through close(): hides the root and restores focus', () => {
    const el = talentsEl();
    const stageRef: { current: TalentAllocation | null } = { current: null };
    const restoreFocus = vi.fn();
    const deps = makeDeps(el, stageRef);
    deps.restoreFocus = restoreFocus;
    const win = new TalentsWindow(deps);
    win.open();
    el.querySelector<HTMLElement>('[data-window-close]')?.click();
    expect(el.style.display).toBe('none');
    expect(restoreFocus).toHaveBeenCalledTimes(1);
  });
});
