import { describe, expect, it } from 'vitest';
import { attachAvatarFallback } from '../src/ui/avatar_fallback';

// The vitest env has no DOM (this repo models DOM wiring with a hand-rolled fake,
// see focus_manager.test.ts), so model the minimal HTMLImageElement surface the
// helper touches: style.display and an addEventListener('error') we fire on demand.
class FakeImg {
  private handlers: Array<() => void> = [];
  src = '';
  style = { display: '' };
  addEventListener(type: string, cb: () => void): void {
    if (type === 'error') this.handlers.push(cb);
  }
  fireError(): void {
    for (const cb of this.handlers) cb();
  }
}

const asImg = (f: FakeImg): HTMLImageElement => f as unknown as HTMLImageElement;
const CDN = 'https://cdn.discordapp.com/avatars/1/abc.png?size=64';
const BADGE = 'data:image/png;base64,BADGE';

describe('attachAvatarFallback', () => {
  it('leaves the image untouched until an error fires', () => {
    const img = new FakeImg();
    img.src = CDN;
    attachAvatarFallback(asImg(img));
    expect(img.src).toBe(CDN);
    expect(img.style.display).toBe('');
  });

  it('hides the image when the load fails and no handler is given', () => {
    const img = new FakeImg();
    img.src = CDN;
    attachAvatarFallback(asImg(img));
    img.fireError();
    expect(img.style.display).toBe('none');
  });

  it('runs the provided handler on error and does not hide the image itself', () => {
    const img = new FakeImg();
    img.src = CDN;
    let received: HTMLImageElement | null = null;
    attachAvatarFallback(asImg(img), (el) => {
      received = el;
      el.src = BADGE;
    });
    img.fireError();
    expect(received).toBe(asImg(img));
    expect(img.src).toBe(BADGE);
    expect(img.style.display).toBe('');
  });
});
