import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  mountStorePromoCard,
  shouldShowStorePromo,
  storePromoReservedHeight,
} from '../src/ui/store_promo_card';

type FakeListener = (event: { preventDefault(): void; stopPropagation(): void }) => void;

class FakeDocument {
  activeElement: FakeElement | null = null;

  createElement(tag: string): FakeElement {
    return new FakeElement(tag, this);
  }
}

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly attrs = new Map<string, string>();
  readonly listeners = new Map<string, FakeListener[]>();
  parentElement: FakeElement | null = null;
  className = '';
  textContent = '';
  title = '';
  type = '';
  src = '';
  alt = '';
  draggable = true;
  decoding = '';

  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDocument,
  ) {}

  append(...children: FakeElement[]): void {
    for (const child of children) this.appendChild(child);
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  addEventListener(type: string, listener: FakeListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string): void {
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  focus(): void {
    this.ownerDocument.activeElement = this;
  }

  querySelector(selector: string): FakeElement | null {
    const className = selector.startsWith('.') ? selector.slice(1) : null;
    const tagName = className ? null : selector.toLowerCase();
    const visit = (root: FakeElement): FakeElement | null => {
      for (const child of root.children) {
        if (
          (className && child.className.split(/\s+/).includes(className)) ||
          (tagName && child.tagName.toLowerCase() === tagName)
        )
          return child;
        const nested = visit(child);
        if (nested) return nested;
      }
      return null;
    };
    return visit(this);
  }
}

const labels = {
  open: 'WOC Store',
  close: 'Close WOC Store',
  season: 'Season 1',
  title: 'The Armory',
  cta: 'WOC Store',
};

const asHtml = (element: FakeElement): HTMLElement => element as unknown as HTMLElement;

function fixture() {
  const document = new FakeDocument();
  const host = document.createElement('div');
  const returnTarget = document.createElement('button');
  return { document, host, returnTarget };
}

describe('store promo card', () => {
  it('ships the supplied artwork as a WebP asset', () => {
    const asset = readFileSync(join(process.cwd(), 'public/ui/store/season-01-armory-promo.webp'));
    expect(asset.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(asset.subarray(8, 12).toString('ascii')).toBe('WEBP');
  });

  it('is limited to the desktop web interface with independent platform guards', () => {
    expect(shouldShowStorePromo({ nativeApp: false, desktopApp: false, mobileTouch: false })).toBe(
      true,
    );
    expect(shouldShowStorePromo({ nativeApp: true, desktopApp: false, mobileTouch: false })).toBe(
      false,
    );
    expect(shouldShowStorePromo({ nativeApp: false, desktopApp: true, mobileTouch: false })).toBe(
      false,
    );
    expect(shouldShowStorePromo({ nativeApp: false, desktopApp: false, mobileTouch: true })).toBe(
      false,
    );
  });

  it('reserves proportional visual space above chat, including the scaled gap', () => {
    expect(storePromoReservedHeight(1000)).toBe(600);
    expect(storePromoReservedHeight(500, 1.25)).toBe(307.5);
  });

  it('opens the Store, preserves a permanent focus target, and then dismisses itself', () => {
    const { document, host, returnTarget } = fixture();
    const calls: string[] = [];
    const onOpenStore = vi.fn(() => {
      calls.push('open');
      expect(document.activeElement).toBe(returnTarget);
    });
    mountStorePromoCard(asHtml(host), {
      labels,
      returnFocusTo: () => asHtml(returnTarget),
      onOpenStore,
      onDismiss: () => calls.push('dismiss'),
    });

    const open = host.querySelector('.store-promo-card-open');
    expect(open?.getAttribute('aria-label')).toBe('WOC Store');
    expect(open?.querySelector('.store-promo-card-copy')).not.toBeNull();
    expect(open?.querySelector('.store-promo-card-cta')?.textContent).toBe('WOC Store');
    expect(open?.querySelector('img')?.src).toBe('/ui/store/season-01-armory-promo.webp');

    open?.dispatch('click');

    expect(onOpenStore).toHaveBeenCalledOnce();
    expect(calls).toEqual(['open', 'dismiss']);
    expect(host.querySelector('.store-promo-card')).toBeNull();
  });

  it('dismisses from the close button without opening the Store', () => {
    const { document, host, returnTarget } = fixture();
    const onOpenStore = vi.fn();
    mountStorePromoCard(asHtml(host), {
      labels,
      returnFocusTo: () => asHtml(returnTarget),
      onOpenStore,
    });

    const close = host.querySelector('.store-promo-card-close');
    expect(close?.getAttribute('aria-label')).toBe('Close WOC Store');
    close?.dispatch('click');

    expect(onOpenStore).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(returnTarget);
    expect(host.querySelector('.store-promo-card')).toBeNull();
  });

  it('refreshes all visible and accessible labels after a language change', () => {
    const { host, returnTarget } = fixture();
    const controller = mountStorePromoCard(asHtml(host), {
      labels,
      returnFocusTo: () => asHtml(returnTarget),
      onOpenStore: vi.fn(),
    });

    controller.relocalize({
      open: 'Tienda WOC',
      close: 'Cerrar Tienda WOC',
      season: 'Temporada 1',
      title: 'La Armería',
      cta: 'Tienda WOC',
    });

    expect(host.querySelector('.store-promo-card-open')?.getAttribute('aria-label')).toBe(
      'Tienda WOC',
    );
    expect(host.querySelector('.store-promo-card-close')?.getAttribute('aria-label')).toBe(
      'Cerrar Tienda WOC',
    );
    expect(host.querySelector('.store-promo-card-season')?.textContent).toBe('Temporada 1');
    expect(host.querySelector('.store-promo-card-title')?.textContent).toBe('La Armería');
    expect(host.querySelector('.store-promo-card-cta')?.textContent).toBe('Tienda WOC');
  });

  it('uses a comfortably sized close target on the promo card', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/hud.css'), 'utf8');
    const rule = css.match(/\.store-promo-card-close\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('width: 34px');
    expect(rule).toContain('height: 34px');
  });
});
