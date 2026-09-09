import { describe, expect, it } from 'vitest';
import { paintMobTooltipBottomRight, paintTooltipAt } from '../src/ui/tooltip_paint';

// Minimal hand-rolled fake: models only the #tooltip element's contract this
// module touches (classList, style, innerHTML/replaceChildren, the measured
// box), the house pattern for a DOM-touching pure-ish helper (tests/CLAUDE.md).
function fakeTooltipEl(box: { w: number; h: number }) {
  const classes = new Set<string>();
  let replaced: Node | null = null;
  return {
    classList: {
      add: (...values: string[]) => {
        for (const value of values) classes.add(value);
      },
      remove: (...values: string[]) => {
        for (const value of values) classes.delete(value);
      },
      contains: (value: string) => classes.has(value),
    },
    innerHTML: '',
    replaceChildren: (...nodes: Node[]) => {
      replaced = nodes[0] ?? null;
    },
    get replacedChild() {
      return replaced;
    },
    style: { display: '', maxHeight: '', left: '', top: '' },
    get offsetWidth() {
      return box.w;
    },
    get offsetHeight() {
      return box.h;
    },
  };
}

const VIEW = { w: 1366, h: 768, scale: 1 };

describe('paintTooltipAt', () => {
  it('writes a string content, shows the box, and places it via the clamp core', () => {
    const el = fakeTooltipEl({ w: 200, h: 100 });
    const box = paintTooltipAt(el, '<b>hi</b>', 500, 400, VIEW);
    expect(el.innerHTML).toBe('<b>hi</b>');
    expect(el.style.display).toBe('block');
    expect(box).toEqual({ w: 200, h: 100 });
    // tooltipPlacementAt(500, 400, {w:200,h:100}, VIEW) => left 514, top 290
    // (pinned directly in tests/tooltip_clamp_core.test.ts).
    expect(el.style.left).toBe('514px');
    expect(el.style.top).toBe('290px');
  });

  it('mounts a prebuilt Node instead of setting innerHTML', () => {
    const el = fakeTooltipEl({ w: 50, h: 50 });
    const node = {} as Node;
    paintTooltipAt(el, node, 0, 0, VIEW);
    expect(el.replacedChild).toBe(node);
    expect(el.innerHTML).toBe('');
  });

  it('drops the mob-tooltip size modifier a leftover world-hover tooltip left behind', () => {
    const el = fakeTooltipEl({ w: 10, h: 10 });
    el.classList.add('mob-tooltip');
    paintTooltipAt(el, 'x', 0, 0, VIEW);
    expect(el.classList.contains('mob-tooltip')).toBe(false);
  });

  it('caps the height off the viewport before returning the measured box', () => {
    const el = fakeTooltipEl({ w: 10, h: 10 });
    paintTooltipAt(el, 'x', 0, 0, VIEW);
    expect(el.style.maxHeight).toBe(`${768 - 2 * 8}px`);
  });
});

describe('paintMobTooltipBottomRight', () => {
  it('adds the mob-tooltip modifier and parks in the desktop corner slot', () => {
    const el = fakeTooltipEl({ w: 260, h: 120 });
    paintMobTooltipBottomRight(el, '<div>mob</div>', VIEW, null);
    expect(el.classList.contains('mob-tooltip')).toBe(true);
    expect(el.innerHTML).toBe('<div>mob</div>');
    expect(el.style.display).toBe('block');
    // mobTooltipCornerPlacement(box, VIEW, null) => left 1050, top 588
    // (pinned directly in tests/tooltip_clamp_core.test.ts).
    expect(el.style.left).toBe('1050px');
    expect(el.style.top).toBe('588px');
  });

  it('routes to the minimap-adjacent slot on touch when a minimap rect is given', () => {
    const el = fakeTooltipEl({ w: 260, h: 120 });
    paintMobTooltipBottomRight(el, '<div>mob</div>', VIEW, { left: 1100, top: 24 });
    expect(el.style.left).toBe('832px');
    expect(el.style.top).toBe('24px');
  });

  it('caps the height off the viewport BEFORE the box is measured', () => {
    // Both paths share the ONE #tooltip element; a cap written after the
    // measure or never written lets a prior cursor tooltip's cap leak in.
    const el = fakeTooltipEl({ w: 260, h: 120 });
    paintMobTooltipBottomRight(el, 'x', VIEW, null);
    expect(el.style.maxHeight).toBe(`${768 - 2 * 8}px`);
  });
});
