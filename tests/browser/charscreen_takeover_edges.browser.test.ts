// The full-screen character screens (the offline creation panel, the online
// roster and the online create panel: every panel carrying `cs-wow`) take over
// the whole viewport on wide screens. The panel is `position: fixed; inset: 0`
// and paints the blur and the shade itself, so any margin on it shows as a strip
// of the landing backdrop with no blur along that edge.
//
// That shipped: the `#hero-view` subpanel rule (two ids, `margin-top: 10px`)
// outranked the takeover's own `margin: 0`, so the offline and roster panels
// began 10px below the top edge. Only the rendered cascade can show it, so this
// mounts each shipped panel inside its real ancestor chain from the entry markup,
// under the real style barrel, and measures the box.
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import indexHtml from '../../index.html?raw';
import playHtml from '../../play.html?raw';
import { cleanup } from './_harness';

const EPSILON = 0.5;
/** The takeover starts at 861px (the `min-width` on the cs-wow block in shell.css). */
const WIDE = [1280, 800] as const;
const NARROW = [800, 700] as const;

const PANELS = [
  ['index.html', 'offline-select', indexHtml],
  ['index.html', 'charselect-panel', indexHtml],
  ['index.html', 'charcreate-panel', indexHtml],
  ['play.html', 'charselect-panel', playHtml],
  ['play.html', 'charcreate-panel', playHtml],
] as const;

/** Mount one shipped panel, shown, inside a shallow copy of its real ancestors
 *  (`#start-screen > #homepage-views-container > #hero-view`), so every ancestor
 *  selector in the sheets matches exactly as it does in the entry. */
function mountPanel(html: string, id: string): HTMLElement {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const source = parsed.getElementById(id);
  if (!source) throw new Error(`#${id} is not in this entry`);
  const chain: Element[] = [];
  for (let el = source.parentElement; el && el !== parsed.body; el = el.parentElement) {
    chain.unshift(el);
  }
  let parent: HTMLElement = document.body;
  for (const ancestor of chain) {
    const copy = document.importNode(ancestor, false) as HTMLElement;
    parent.append(copy);
    parent = copy;
  }
  const panel = document.importNode(source, true) as HTMLElement;
  for (const script of panel.querySelectorAll('script')) script.remove();
  panel.removeAttribute('hidden');
  parent.append(panel);
  return panel;
}

function edges(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, right: r.right, bottom: r.bottom };
}

afterEach(async () => {
  cleanup();
  document.body.className = '';
  await page.viewport(WIDE[0], WIDE[1]);
});

describe.each(PANELS)('%s #%s full-screen takeover', (_entry, id, html) => {
  it('covers the viewport edge to edge on a desktop body', async () => {
    await page.viewport(WIDE[0], WIDE[1]);
    document.body.className = 'start-screen-open';
    const panel = mountPanel(html, id);
    expect(getComputedStyle(panel).position).toBe('fixed');
    const box = edges(panel);
    expect(box.top, `top edge gap of ${box.top}px`).toBeLessThanOrEqual(EPSILON);
    expect(box.left, `left edge gap of ${box.left}px`).toBeLessThanOrEqual(EPSILON);
    expect(window.innerWidth - box.right, 'right edge gap').toBeLessThanOrEqual(EPSILON);
    expect(window.innerHeight - box.bottom, 'bottom edge gap').toBeLessThanOrEqual(EPSILON);
  });
});

// The offline arm of the takeover carries no `body:not(.mobile-touch)` prefix, so
// a wide touch body gets the fixed panel too, and with it the same top-edge gap.
// Only the top edge is asserted: the touch blocks own this panel's height there.
describe('the offline panel takes over on a wide touch body too', () => {
  it('starts at the top edge', async () => {
    await page.viewport(WIDE[0], WIDE[1]);
    document.body.className = 'start-screen-open mobile-touch';
    const panel = mountPanel(indexHtml, 'offline-select');
    expect(getComputedStyle(panel).position).toBe('fixed');
    const box = edges(panel);
    expect(box.top, `top edge gap of ${box.top}px`).toBeLessThanOrEqual(EPSILON);
    expect(box.left, `left edge gap of ${box.left}px`).toBeLessThanOrEqual(EPSILON);
  });
});

describe('below the takeover width the card layout keeps its place in the hero flow', () => {
  it.each([
    ['index.html', 'offline-select', indexHtml],
    ['index.html', 'charselect-panel', indexHtml],
    ['play.html', 'charselect-panel', playHtml],
  ] as const)('%s #%s keeps the 10px hero gap', async (_entry, id, html) => {
    await page.viewport(NARROW[0], NARROW[1]);
    document.body.className = 'start-screen-open';
    const panel = mountPanel(html, id);
    const style = getComputedStyle(panel);
    expect(style.position).not.toBe('fixed');
    expect(style.marginTop).toBe('10px');
  });
});
