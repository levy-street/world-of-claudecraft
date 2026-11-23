import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// index.html sets up the fbq queue, init and PageView at once, but loads Meta's library on
// the visitor's first interaction, so its script and third-party cookie stay off the
// first paint. This runs the snippet's own installer against a recording window/document.

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function installer(): (...args: unknown[]) => void {
  const match =
    /!\((\(f,b,e,v,n,t,s\)=> \{[\s\S]*?\})\)\(window,document,'script','https:\/\/connect\.facebook\.net\/en_US\/fbevents\.js'\);/.exec(
      html,
    );
  if (!match) throw new Error('Meta Pixel installer not found in index.html');
  return new Function(`return (${match[1]});`)() as (...args: unknown[]) => void;
}

function harness() {
  const listeners: { type: string; fn: () => void; opts: unknown }[] = [];
  const inserted: { src?: string; async?: boolean }[] = [];
  const win: Record<string, unknown> = {
    addEventListener: (type: string, fn: () => void, opts: unknown) =>
      listeners.push({ type, fn, opts }),
  };
  const doc = {
    createElement: () => ({}),
    getElementsByTagName: () => [
      { parentNode: { insertBefore: (el: { src?: string }) => inserted.push(el) } },
    ],
  };
  installer()(win, doc, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  return { win, listeners, inserted };
}

describe('Meta Pixel loading', () => {
  it('queues calls at once but inserts the library only on the first interaction', () => {
    const { win, listeners, inserted } = harness();
    expect(typeof win.fbq).toBe('function');
    (win.fbq as (...a: unknown[]) => void)('init', '1692101265042180');
    expect((win.fbq as { queue: unknown[] }).queue).toHaveLength(1);
    expect(inserted).toEqual([]);
    expect(listeners.map((l) => l.type)).toEqual(['pointerdown', 'keydown', 'touchstart']);
    for (const l of listeners) expect(l.opts).toEqual({ capture: true, once: true, passive: true });

    listeners[0].fn();
    expect(inserted).toEqual([
      { async: true, src: 'https://connect.facebook.net/en_US/fbevents.js' },
    ]);
    // A second kind of interaction does not load it again.
    listeners[1].fn();
    expect(inserted).toHaveLength(1);
  });

  it('keeps the init, PageView and no-script pixel', () => {
    expect(html).toContain("fbq('init', '1692101265042180');");
    expect(html).toContain("fbq('track', 'PageView');");
    expect(html).toContain(
      'https://www.facebook.com/tr?id=1692101265042180&ev=PageView&noscript=1',
    );
  });
});
