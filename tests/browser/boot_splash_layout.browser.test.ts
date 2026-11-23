// The boot splash on a phone, before any game stylesheet: the unstyled media hidden under
// it (the 1536px video poster, the 978px logos) must not widen the page, or a phone browser
// widens its layout viewport, zooms out, and centers the splash off screen. Real layout
// only: the frame carries each entry's actual inline <style> and nothing else.
import { afterEach, describe, expect, it } from 'vitest';
import indexHtml from '../../index.html?raw';
import playHtml from '../../play.html?raw';

const PHONE_WIDTH = 412;
const PHONE_HEIGHT = 915;

function inlineSplashCss(html: string): string {
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1];
  if (!css) throw new Error('entry has no inline <style>');
  return css;
}

async function bootFrame(css: string, bodyClass: string): Promise<Document> {
  const frame = document.createElement('iframe');
  frame.style.cssText = `width:${PHONE_WIDTH}px;height:${PHONE_HEIGHT}px;border:0;display:block`;
  frame.srcdoc = `<!doctype html><html><head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>${css}</style></head>
    <body class="${bodyClass}">
      <div id="boot-splash" aria-hidden="true">
        <img class="boot-splash-logo" width="978" height="654" alt="" />
        <div class="boot-splash-bar"></div>
      </div>
      <img id="intro-logo" width="978" height="654" alt="" />
      <main id="start-screen">
        <video id="bg-home" width="1536" height="864"></video>
        <img id="title-logo" width="978" height="654" alt="" />
      </main>
    </body></html>`;
  const loaded = new Promise<void>((resolve) =>
    frame.addEventListener('load', () => resolve(), { once: true }),
  );
  document.body.append(frame);
  await loaded;
  return frame.contentDocument as Document;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('boot splash layout on a phone-width viewport', () => {
  it('the fixture reproduces the overflow once the boot class is gone', async () => {
    const doc = await bootFrame(inlineSplashCss(indexHtml), '');
    expect(doc.scrollingElement?.scrollWidth).toBeGreaterThan(PHONE_WIDTH);
  });

  for (const [entry, html] of [
    ['index.html', indexHtml],
    ['play.html', playHtml],
  ] as const) {
    it(`${entry}: hidden boot content never widens the page and the logo stays centered`, async () => {
      const doc = await bootFrame(inlineSplashCss(html), 'boot-pending');
      expect(doc.scrollingElement?.scrollWidth).toBe(PHONE_WIDTH);
      const splash = doc.getElementById('boot-splash')?.getBoundingClientRect();
      expect(splash?.left).toBe(0);
      expect(splash?.width).toBe(PHONE_WIDTH);
      const logo = doc.querySelector('.boot-splash-logo')?.getBoundingClientRect();
      expect(logo?.width).toBeGreaterThan(0);
      expect(logo?.right).toBeLessThanOrEqual(PHONE_WIDTH);
      expect(Math.abs((logo?.left ?? 0) + (logo?.width ?? 0) / 2 - PHONE_WIDTH / 2)).toBeLessThan(
        1,
      );
    });
  }
});
