// @vitest-environment happy-dom
//
// Regression for issue #2569: the Performance Overlay settings window's gilded
// ::before ornament (components.css) is attached to #options-menu.perf-wide, the
// exact element the base `.window` rule (layout.css) also makes the scrolling
// box (`overflow-y: auto`). Before this fix, PerfOverlaySettingsPanel.render()
// appended the scrollable body (.perf-panel) and the footer directly as children
// of that same container, so the ornament scrolled away with the content instead
// of staying pinned to the window frame, and the bottom-corner ornament never
// lined up with the true bottom edge.
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
  it('wraps the panel body and footer in a single .perf-scroll child, leaving the title as the only other direct child', () => {
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
    expect(container.querySelector(':scope > .perf-footer')).toBeNull();

    // The body card grid and the footer buttons are the scroll wrapper's own
    // children, in the same relative order they rendered in before the fix.
    expect(scroll?.querySelector(':scope > .perf-panel')).not.toBeNull();
    expect(scroll?.querySelector(':scope > .perf-footer')).not.toBeNull();
    const scrollChildren = [...(scroll as Element).children].map((el) => el.className);
    expect(scrollChildren).toEqual(['perf-panel', 'perf-footer']);

    // Exactly two direct children of the container: the title, then the wrapper.
    expect([...container.children].map((el) => el.className)).toEqual([
      'panel-title',
      'perf-scroll',
    ]);
  });

  it('rebuilds the same wrapper shape on a rerender (control-driven re-render, e.g. a preset click)', () => {
    const container = document.createElement('div');
    const panel = new PerfOverlaySettingsPanel(makeHost());
    panel.render(container);
    panel.render(container);

    expect([...container.children].map((el) => el.className)).toEqual([
      'panel-title',
      'perf-scroll',
    ]);
    expect(container.querySelectorAll('.perf-scroll')).toHaveLength(1);
  });
});
