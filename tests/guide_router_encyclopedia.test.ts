// @vitest-environment happy-dom
// The Guide router must leave links to the static encyclopedia (also under /wiki) to the
// browser, and keep routing its own pages in-app.
import { afterEach, describe, expect, it } from 'vitest';
import { GuideRouter } from '../src/guide/router';
import { ENCYCLOPEDIA_HOME } from '../src/guide/routes';

function clickLink(href: string): boolean {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = 'link';
  document.body.append(a);
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  a.dispatchEvent(event);
  a.remove();
  return event.defaultPrevented;
}

describe('Guide router and the encyclopedia', () => {
  const routed: string[] = [];
  const router = new GuideRouter((path) => routed.push(path));
  router.start();
  // start() reports the page it opened on; only clicks matter here.
  routed.length = 0;
  afterEach(() => {
    routed.length = 0;
  });

  it('lets encyclopedia links load as real pages', () => {
    expect(clickLink(ENCYCLOPEDIA_HOME)).toBe(false);
    expect(clickLink('/wiki/item/iron-sword')).toBe(false);
    expect(routed).toEqual([]);
  });

  it('still routes Guide pages in-app', () => {
    expect(clickLink('/wiki/classes/warrior')).toBe(true);
    expect(routed).toEqual(['/wiki/classes/warrior']);
  });
});
