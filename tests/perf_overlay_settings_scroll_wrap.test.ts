// @vitest-environment happy-dom
//
// Regression for issue #2569: the Performance Overlay settings window's gilded
// ::before ornament (components.css) is attached to #options-menu.perf-wide, the
// exact element the base `.window` rule (layout.css) also makes the scrolling
// box (`overflow-y: auto`). Before this fix, PerfOverlaySettingsPanel.render()
// appended the scrollable body (.perf-panel) directly as a child of that same
// container, so the ornament scrolled away with the content instead of staying
// pinned to the window frame, and the bottom-corner ornament never lined up with
// the true bottom edge. The footer moved OUT of the wrapper again in W25 (the
// window-shell finding: an action row must never scroll out of reach).
//
// This drives the real production module (not a mock of it): it asserts the DOM
// nesting the fix requires, so the scrolling content lives inside a dedicated
// `.perf-scroll` child and the ornament host itself never needs to scroll.
import { describe, expect, it } from 'vitest';
import { defaultPerfOverlayConfig } from '../src/ui/perf_overlay_config';
import { PerfOverlaySettingsPanel, type PerfSettingsHost } from '../src/ui/perf_overlay_settings';

function makeHost(): PerfSettingsHost {
  return {
    perf: {
      get: () => defaultPerfOverlayConfig(),
      patch: () => {},
      setMetric: () => {},
      reset: () => {},
      resetPosition: () => {},
      setPlacement: () => {},
    },
    getShowFps: () => true,
    setShowFps: () => {},
    click: () => {},
    onClose: () => {},
    onBack: () => {},
    closeIconHtml: '<svg data-icon="close"></svg>',
    backIconHtml: '<svg data-icon="prev"></svg>',
  };
}

describe('PerfOverlaySettingsPanel: scroll wrapper stays off the ornament host (issue 2569)', () => {
  it('wraps the panel body in a single .perf-scroll child and pins the footer beside it', () => {
    const container = document.createElement('div');
    const panel = new PerfOverlaySettingsPanel(makeHost());
    panel.render(container);

    // The title stays a direct child (it never scrolls; it is the sticky header).
    expect(container.querySelector(':scope > .panel-title')).not.toBeNull();

    // Everything that DOES need to scroll lives inside one dedicated wrapper,
    // never as a direct child of the ornament-bearing container itself.
    const scroll = container.querySelector(':scope > .perf-scroll');
    expect(
      scroll,
      '#options-menu.perf-wide must not directly parent the scrollable body/footer: ' +
        'wrap them in a .perf-scroll child so the ::before ornament never scrolls',
    ).not.toBeNull();
    expect(container.querySelector(':scope > .perf-panel')).toBeNull();

    // The card grid is the scroll wrapper's only child. Reset / Back MOVED OUT
    // of the wrapper (W25): an action row that scrolls is exactly the maintainer
    // finding the window shell fixes, and 2569 only ever needed the ORNAMENT
    // HOST to stop scrolling, which the wrapper still guarantees.
    expect(scroll?.querySelector(':scope > .perf-panel')).not.toBeNull();
    expect(scroll?.querySelector('.perf-footer')).toBeNull();
    expect([...(scroll as Element).children].map((el) => el.className)).toEqual(['perf-panel']);

    // Three direct children of the container: the title, the one scrollport, the
    // pinned foot, which is the shared shell shape (library.css).
    expect([...container.children].map((el) => el.className)).toEqual([
      'panel-title',
      'perf-scroll ui-win-body',
      'perf-footer ui-win-foot',
    ]);
  });

  it('rebuilds the same wrapper shape on a rerender (control-driven re-render, e.g. a preset click)', () => {
    const container = document.createElement('div');
    const panel = new PerfOverlaySettingsPanel(makeHost());
    panel.render(container);
    panel.render(container);

    expect([...container.children].map((el) => el.className)).toEqual([
      'panel-title',
      'perf-scroll ui-win-body',
      'perf-footer ui-win-foot',
    ]);
    expect(container.querySelectorAll('.perf-scroll')).toHaveLength(1);
    expect(container.querySelectorAll('.perf-footer')).toHaveLength(1);
  });
});
