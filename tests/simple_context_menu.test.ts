// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { openSimpleMenu, type SimpleMenuDeps } from '../src/ui/simple_context_menu';

function harness(mobile = false) {
  document.body.innerHTML = '<div id="ctx-menu" style="display:none"></div>';
  const root = document.getElementById('ctx-menu') as HTMLElement;
  const placed: {
    x: number;
    y: number;
    reserveRight: number;
    reserveBottom: number;
    minLeft: number | undefined;
    minTop: number | undefined;
  }[] = [];
  let clamped = 0;
  let bound: ((act: string) => void) | null = null;
  const deps: SimpleMenuDeps = {
    root: () => root,
    place: (_el, x, y, reserveRight, reserveBottom, minLeft, minTop) =>
      placed.push({ x, y, reserveRight, reserveBottom, minLeft, minTop }),
    keepOnScreen: () => {
      clamped++;
    },
    bindActions: (onActivate) => {
      bound = onActivate;
    },
    isMobileLayout: () => mobile,
  };
  return { root, placed, deps, clamped: () => clamped, activate: (act: string) => bound?.(act) };
}

describe('shared simple context menu', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('paints one row per item, keyed by its act, and shows the shared box', () => {
    const h = harness();
    openSimpleMenu(
      [
        { act: 'separate', label: 'Separate Threat' },
        { act: 'regroup', label: 'Regroup Healing' },
      ],
      100,
      200,
      () => {},
      h.deps,
    );
    const rows = [...h.root.querySelectorAll<HTMLElement>('.ctx-item')];
    expect(rows.map((r) => r.dataset.act)).toEqual(['separate', 'regroup']);
    expect(rows.map((r) => r.textContent)).toEqual(['Separate Threat', 'Regroup Healing']);
    expect(h.root.style.display).toBe('block');
  });

  it('seats and clamps through the injected helpers at the click point', () => {
    const h = harness();
    openSimpleMenu([{ act: 'a', label: 'A' }], 640, 480, () => {}, h.deps);
    expect(h.placed).toHaveLength(1);
    expect(h.placed[0].x).toBe(640);
    expect(h.placed[0].y).toBe(480);
    expect(h.clamped()).toBe(1);
  });

  it('pins the seated box off the viewport edges, like the other HUD menus', () => {
    // Hud.placePopupAt grew minLeft/minTop, and the chat context menu passes
    // 0 / 8. Forwarding the same values is what keeps this menu's promise that
    // it clamps exactly like the menus Hud opens; leaving them undefined would
    // let it sit flush against the top edge when every sibling menu does not.
    const h = harness();
    openSimpleMenu([{ act: 'a', label: 'A' }], 12, 0, () => {}, h.deps);
    expect(h.placed[0].minLeft).toBe(0);
    expect(h.placed[0].minTop).toBe(8);
  });

  it('reserves more height per row on a touch layout, where rows are taller', () => {
    const desktop = harness(false);
    openSimpleMenu([{ act: 'a', label: 'A' }], 0, 0, () => {}, desktop.deps);
    const mobile = harness(true);
    openSimpleMenu([{ act: 'a', label: 'A' }], 0, 0, () => {}, mobile.deps);
    expect(mobile.placed[0].reserveBottom).toBeGreaterThan(desktop.placed[0].reserveBottom);
  });

  it('scales the reserved height with the row count, so a long menu still seats', () => {
    const one = harness();
    openSimpleMenu([{ act: 'a', label: 'A' }], 0, 0, () => {}, one.deps);
    const three = harness();
    openSimpleMenu(
      [
        { act: 'a', label: 'A' },
        { act: 'b', label: 'B' },
        { act: 'c', label: 'C' },
      ],
      0,
      0,
      () => {},
      three.deps,
    );
    expect(three.placed[0].reserveBottom).toBeGreaterThan(one.placed[0].reserveBottom);
  });

  it('routes an activated row back to the caller by act', () => {
    const h = harness();
    const picked: string[] = [];
    openSimpleMenu([{ act: 'regroup', label: 'Regroup' }], 0, 0, (act) => picked.push(act), h.deps);
    h.activate('regroup');
    expect(picked).toEqual(['regroup']);
  });

  it('opens nothing at all for an empty item list', () => {
    const h = harness();
    openSimpleMenu([], 10, 10, () => {}, h.deps);
    expect(h.root.style.display).toBe('none');
    expect(h.root.innerHTML).toBe('');
    expect(h.placed).toHaveLength(0);
  });

  it('escapes label and act text rather than injecting it as markup', () => {
    const h = harness();
    openSimpleMenu(
      [{ act: 'x"><img src=x>', label: '<img src=x onerror=alert(1)>' }],
      0,
      0,
      () => {},
      h.deps,
    );
    expect(h.root.querySelector('img')).toBeNull();
    expect(h.root.querySelectorAll('.ctx-item')).toHaveLength(1);
    expect(h.root.querySelector('.ctx-item')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});
