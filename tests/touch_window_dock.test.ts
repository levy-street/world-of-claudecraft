// @vitest-environment happy-dom
// A window docked into a touch split (bags beside the vendor, bank, market,
// character sheet or trade window) must dock no matter where a touch drag left
// it standalone. The drag leaves inline left/top/width/height on the window
// (its saved standalone spot), and inline style beats any un-flagged rule, so
// the dock geometry is !important. Dragging a docked window would overwrite
// that saved spot, so the dock rules carry a marker the drag handle refuses.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isWindowDragHandle } from '../src/ui/window_drag_handle';

const css = readFileSync(resolve(__dirname, '../src/styles/hud.mobile.css'), 'utf8');

const DOCK_STATE = /(trade-and-bags-open|char-bags-paired|vendor-open|bank-open|market-open)/;
const DOCKED_WINDOW =
  /#(bags|char-window|vendor-window|bank-window|market-window|trade-window)\s*$/;
const GEOMETRY = new Set(['left', 'right', 'top', 'bottom', 'width', 'height', 'transform']);

interface Rule {
  line: number;
  selector: string;
  decls: Array<[string, string]>;
}

/** Every rule that positions a docked window itself (not a descendant). */
function dockRules(): Rule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const out: Rule[] = [];
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].replace(/\s+/g, ' ').trim();
    const parts = selector.split(',').map((s) => s.trim());
    if (!parts.every((s) => DOCK_STATE.test(s) && DOCKED_WINDOW.test(s))) continue;
    const decls = [...m[2].matchAll(/([a-z-]+)\s*:\s*([^;]+);/g)].map(
      (d) => [d[1], d[2].trim()] as [string, string],
    );
    out.push({ line: src.slice(0, m.index).split('\n').length, selector, decls });
  }
  return out;
}

describe('touch dock geometry (hud.mobile.css)', () => {
  it('finds every dock rule (shared block plus each side, for all five splits)', () => {
    const selectors = dockRules().map((r) => r.selector);
    for (const state of [
      'trade-and-bags-open',
      'char-bags-paired',
      'vendor-open',
      'bank-open',
      'market-open',
    ]) {
      expect(selectors.some((s) => s.includes(state))).toBe(true);
    }
    expect(selectors.length).toBeGreaterThanOrEqual(13);
  });

  it('flags every geometry declaration on a docked window !important', () => {
    const unflagged = dockRules().flatMap((r) =>
      r.decls
        .filter(([prop, value]) => GEOMETRY.has(prop) && !value.includes('!important'))
        .map(([prop]) => `line ${r.line}: ${prop} in ${r.selector}`),
    );
    expect(unflagged).toEqual([]);
  });

  it('marks every shared dock block with --window-docked: 1', () => {
    const shared = dockRules().filter((r) => r.decls.some(([p]) => p === 'top'));
    expect(shared.length).toBe(4);
    for (const r of shared) {
      expect(r.decls).toContainEqual(['--window-docked', '1']);
    }
  });
});

describe('a docked window never starts a drag on touch', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.body.className = '';
  });

  function titledWindow(id: string, docked: boolean): HTMLElement {
    const win = document.createElement('div');
    win.id = id;
    win.className = 'window panel';
    win.innerHTML = '<div class="panel-title"><span>Bags</span></div>';
    if (docked) win.style.setProperty('--window-docked', '1');
    document.body.appendChild(win);
    return win;
  }

  const titleOf = (win: HTMLElement) => win.querySelector('.panel-title span') as HTMLElement;

  it('refuses the title of a docked window on the touch layout', () => {
    document.body.classList.add('mobile-touch');
    const win = titledWindow('bags', true);
    expect(isWindowDragHandle(titleOf(win), win)).toBe(false);
  });

  it('still drags the same window once it is standalone again', () => {
    document.body.classList.add('mobile-touch');
    const win = titledWindow('bags', false);
    expect(isWindowDragHandle(titleOf(win), win)).toBe(true);
  });

  it('ignores the marker on the desktop layout', () => {
    const win = titledWindow('bags', true);
    expect(isWindowDragHandle(titleOf(win), win)).toBe(true);
  });
});
