// @vitest-environment happy-dom
// The movable Tooltip frame's seat resolver (src/ui/unit_tooltip_seat.ts) and
// the stylesheet half of its back-compat promise: the anchor's stock CSS spot
// must equal the fixed corner constants, or an unmoved seat would shift every
// player's hover card on upgrade. happy-dom does no layout, so each test stubs
// the one rect the resolver reads.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HUD_FRAME_SPECS, UNIT_TOOLTIP_ANCHOR_ELEMENT_ID } from '../src/ui/interface_unlock_core';
import { FRAME_USER_HIDDEN_CLASS } from '../src/ui/movable_frame';
import { MOB_TOOLTIP_MARGIN_BOTTOM, MOB_TOOLTIP_MARGIN_RIGHT } from '../src/ui/tooltip_clamp_core';
import { resolveUnitTooltipSeat } from '../src/ui/unit_tooltip_seat';

function mount(id: string, rect: { left: number; top: number; width: number; height: number }) {
  const el = document.createElement('div');
  el.id = id;
  el.getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.replaceChildren();
  document.body.className = '';
});

describe('resolveUnitTooltipSeat', () => {
  it('seats a desktop card on the anchor rect', () => {
    mount(UNIT_TOOLTIP_ANCHOR_ELEMENT_ID, { left: 100, top: 80, width: 220, height: 72 });
    const seat = resolveUnitTooltipSeat(document);
    expect(seat.hidden).toBe(false);
    expect(seat.minimap).toBeNull();
    expect(seat.readAnchor?.()).toMatchObject({ left: 100, top: 80, right: 320, bottom: 152 });
  });

  it('hides the card when the player unticked the Tooltip frame', () => {
    const el = mount(UNIT_TOOLTIP_ANCHOR_ELEMENT_ID, { left: 0, top: 0, width: 0, height: 0 });
    el.classList.add(FRAME_USER_HIDDEN_CLASS);
    expect(resolveUnitTooltipSeat(document)).toEqual({
      hidden: true,
      minimap: null,
      readAnchor: null,
    });
  });

  it('falls back to the fixed corner for a missing or unlaid-out anchor', () => {
    expect(resolveUnitTooltipSeat(document)).toEqual({
      hidden: false,
      minimap: null,
      readAnchor: null,
    });
    mount(UNIT_TOOLTIP_ANCHOR_ELEMENT_ID, { left: 0, top: 0, width: 0, height: 0 });
    expect(resolveUnitTooltipSeat(document).readAnchor?.()).toBeNull();
  });

  it('keeps the touch minimap slot and ignores the seat, even a desktop hide', () => {
    document.body.classList.add('mobile-touch');
    mount('minimap-wrap', { left: 1100, top: 24, width: 150, height: 150 });
    const el = mount(UNIT_TOOLTIP_ANCHOR_ELEMENT_ID, {
      left: 100,
      top: 80,
      width: 220,
      height: 72,
    });
    el.classList.add(FRAME_USER_HIDDEN_CLASS);
    const seat = resolveUnitTooltipSeat(document);
    expect(seat.hidden).toBe(false);
    expect(seat.readAnchor).toBeNull();
    expect(seat.minimap).toMatchObject({ left: 1100, top: 24 });
  });
});

describe('the anchor ships in both entries at the fixed corner', () => {
  const css = readFileSync(join(import.meta.dirname, '..', 'src', 'styles', 'hud.css'), 'utf8');
  const block = (selector: string): string => {
    const start = css.indexOf(`  ${selector} {`);
    expect(start, `${selector} rule`).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf('}', start));
  };

  it('parks the stock seat on the MOB_TOOLTIP_MARGIN_* corner, invisible but measurable', () => {
    const rule = block('#unit-tooltip-anchor');
    expect(rule).toContain(`right: ${MOB_TOOLTIP_MARGIN_RIGHT}px;`);
    expect(rule).toContain(`bottom: ${MOB_TOOLTIP_MARGIN_BOTTOM}px;`);
    expect(rule).toContain('position: absolute;');
    // visibility keeps a real box for the resolver to measure; display:none
    // would zero it and silently drop every card back to the fixed corner.
    expect(rule).toContain('visibility: hidden;');
    expect(rule).not.toContain('display: none');
    expect(rule).toContain('pointer-events: none;');
  });

  it('sizes the placeholder exactly as the frame row clamps a hidden seat', () => {
    const row = HUD_FRAME_SPECS.find((s) => s.id === 'unitTooltip');
    const rule = block('#unit-tooltip-anchor');
    expect(rule).toContain(`width: ${row?.fallbackSize.w}px;`);
    expect(rule).toContain(`height: ${row?.fallbackSize.h}px;`);
  });

  it('hands the placeholder back to the pointer while the interface is unlocked', () => {
    const rule = block('body.interface-unlocked #unit-tooltip-anchor.tf-unlocked');
    expect(rule).toContain('visibility: visible;');
    expect(rule).toContain('pointer-events: auto;');
    // Above the button rail (z-index 19) it overlaps at the stock seat.
    expect(rule).toContain('z-index: 20;');
  });

  it('gives the seat the governed frames corner move button, focus ring included', () => {
    // Without these the button would render as an unstyled in-flow control.
    expect(css).toContain('#unit-tooltip-anchor .tf-move-btn,');
    expect(css).toContain('#unit-tooltip-anchor .tf-move-btn:focus-visible,');
  });

  it('mounts the anchor as a #ui child beside #tooltip in index.html and play.html', () => {
    for (const entry of ['index.html', 'play.html']) {
      const html = readFileSync(join(import.meta.dirname, '..', entry), 'utf8');
      const tooltipAt = html.indexOf('<div id="tooltip" class="panel"></div>');
      const anchorAt = html.indexOf(
        `<div id="${UNIT_TOOLTIP_ANCHOR_ELEMENT_ID}" class="panel"></div>`,
      );
      expect(tooltipAt, entry).toBeGreaterThan(-1);
      expect(anchorAt, entry).toBeGreaterThan(tooltipAt);
    }
  });
});
