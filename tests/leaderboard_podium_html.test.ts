// @vitest-environment happy-dom
//
// The podium markup (src/ui/leaderboard_podium_html.ts): nothing to stand on
// paints nothing, the list is a labelled list in place order 1, 2, 3 with no
// inline style (the disc art is the stylesheet's), the label is escaped, and the
// unclaimed and viewer states land as their classes.
import { describe, expect, it } from 'vitest';
import { type PodiumSlotHtml, podiumHtml } from '../src/ui/leaderboard_podium_html';

function slot(over: Partial<PodiumSlotHtml> & Pick<PodiumSlotHtml, 'place'>): PodiumSlotHtml {
  return {
    rankText: String(over.place),
    filled: true,
    me: false,
    nameHtml: `Hero${over.place}`,
    metricHtml: '100',
    detailHtml: 'detail',
    ...over,
  };
}

function parse(html: string): HTMLOListElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.querySelector('ol') as HTMLOListElement;
}

describe('podiumHtml', () => {
  it('returns an empty string when there is nothing to stand on the podium', () => {
    expect(podiumHtml([], 'Top three')).toBe('');
  });

  it('emits a labelled list in place order with no inline style', () => {
    const html = podiumHtml([slot({ place: 1 }), slot({ place: 2 }), slot({ place: 3 })], 'Top');
    const ol = parse(html);
    expect(ol.getAttribute('role')).toBe('list');
    expect(ol.getAttribute('aria-label')).toBe('Top');
    expect(Array.from(ol.children).map((li) => li.getAttribute('data-podium-place'))).toEqual([
      '1',
      '2',
      '3',
    ]);
    expect(html).not.toContain('style=');
    expect(ol.querySelectorAll('.lbp-slot-medal[aria-hidden="true"]')).toHaveLength(3);
  });

  it('escapes the list label', () => {
    const html = podiumHtml([slot({ place: 1 })], '"><img src=x onerror=alert(1)>');
    const ol = parse(html);
    expect(ol.getAttribute('aria-label')).toBe('"><img src=x onerror=alert(1)>');
    expect(ol.querySelector('img')).toBeNull();
  });

  it('marks unclaimed places and the viewer, and omits empty metric and detail spans', () => {
    const ol = parse(
      podiumHtml(
        [
          slot({ place: 1, me: true }),
          slot({ place: 2, filled: false, metricHtml: '', detailHtml: '' }),
        ],
        'Top',
      ),
    );
    const [first, second] = Array.from(ol.children);
    expect(first.className).toBe('lbp-slot lbp-slot-1 lbp-mine');
    expect(second.className).toBe('lbp-slot lbp-slot-2 lbp-slot-empty');
    expect(second.querySelector('.lbp-slot-metric')).toBeNull();
    expect(second.querySelector('.lbp-slot-detail')).toBeNull();
    expect(first.querySelector('.lbp-plinth-rank')?.textContent).toBe('1');
  });
});
