import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mountStorePromoCard,
  nextStorePromoIndex,
  STORE_PROMO_RETIRE_GUARD_MS,
  STORE_PROMO_ROTATE_MS,
  type StorePromoSlide,
  shouldShowStorePromo,
  storePromoLabels,
  storePromoReservedHeight,
  storePromoSlides,
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

const armoryLabels = {
  open: 'WOC Store',
  close: 'Close WOC Store',
  season: 'Season 1',
  title: 'The Armory',
  cta: 'WOC Store',
};
const referralLabels = {
  open: 'Refer a Friend',
  close: 'Close Refer a Friend promotion',
  season: 'Adventure together',
  title: 'Refer a Friend',
  cta: 'Invite friends',
};

const asHtml = (element: FakeElement): HTMLElement => element as unknown as HTMLElement;

function fixture() {
  const document = new FakeDocument();
  const host = document.createElement('div');
  const returnTarget = document.createElement('button');
  return { document, host, returnTarget };
}

function armorySlide(onOpen: () => void = vi.fn()): StorePromoSlide {
  return {
    id: 'armory',
    image: '/ui/store/season-01-armory-promo.webp',
    labels: armoryLabels,
    onOpen,
  };
}

function referralSlide(onOpen: () => void = vi.fn()): StorePromoSlide {
  return { id: 'referral', image: '/ui/store/referral-promo.webp', labels: referralLabels, onOpen };
}

function activeSlide(host: FakeElement): FakeElement | null {
  return host.querySelector('.is-active');
}

describe('store promo card', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(['season-01-armory-promo.webp', 'membership-promo.webp', 'referral-promo.webp'])(
    'ships %s as a WebP asset',
    (file) => {
      const asset = readFileSync(join(process.cwd(), 'public/ui/store', file));
      expect(asset.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(asset.subarray(8, 12).toString('ascii')).toBe('WEBP');
    },
  );

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

  it('keeps the required outward focus ring outside the card clip', () => {
    const hudCss = readFileSync(join(process.cwd(), 'src/styles/hud.css'), 'utf8');
    const card = /\.store-promo-card \{([^}]*)\}/.exec(hudCss)?.[1] ?? '';
    const open = /\.store-promo-card-open \{([^}]*)\}/.exec(hudCss)?.[1] ?? '';
    const focus = /\.store-promo-card-open:focus-visible \{([^}]*)\}/.exec(hudCss)?.[1] ?? '';
    expect(card).toContain('overflow: visible;');
    expect(open).toContain('overflow: hidden;');
    expect(focus).toContain('outline: 2px solid var(--color-border-focus);');
    expect(focus).toContain('outline-offset: 2px;');
  });

  it('skips retired and unavailable slides when picking the next one, wrapping', () => {
    const on = { available: () => true };
    const off = { available: () => false };
    expect(nextStorePromoIndex([on, on, on], [true, true, true], -1)).toBe(0);
    expect(nextStorePromoIndex([on, off, on], [true, true, true], 0)).toBe(2);
    expect(nextStorePromoIndex([on, on, on], [true, false, true], 2)).toBe(0);
    expect(nextStorePromoIndex([on, off, on], [false, true, true], 2)).toBe(2);
    expect(nextStorePromoIndex([on, off], [false, true], 0)).toBe(-1);
  });

  it('opens the Store, preserves a permanent focus target, and then dismisses itself', () => {
    const { document, host, returnTarget } = fixture();
    const calls: string[] = [];
    const onOpenStore = vi.fn(() => {
      calls.push('open');
      expect(document.activeElement).toBe(returnTarget);
    });
    mountStorePromoCard(asHtml(host), {
      slides: [armorySlide(onOpenStore)],
      returnFocusTo: () => asHtml(returnTarget),
      onDismiss: () => calls.push('dismiss'),
    });

    const open = host.querySelector('.store-promo-card-open');
    expect(host.querySelector('.store-promo-card')?.className).toContain('ui-panel');
    expect(open?.getAttribute('aria-label')).toBe('WOC Store');
    expect(open?.querySelector('.store-promo-card-copy')?.className).toContain('ui-outline');
    expect(open?.querySelector('.store-promo-card-cta')?.className).toContain('ui-chip');
    expect(open?.querySelector('.store-promo-card-cta')?.textContent).toBe('WOC Store');
    expect(open?.querySelector('img')?.src).toBe('/ui/store/season-01-armory-promo.webp');
    // A lone advert has nothing to page between.
    expect(open?.querySelector('.store-promo-card-dots')).toBeNull();

    open?.dispatch('click');

    expect(onOpenStore).toHaveBeenCalledOnce();
    expect(calls).toEqual(['open', 'dismiss']);
    expect(host.querySelector('.store-promo-card')).toBeNull();
  });

  it('dismisses from the close button without opening the Store', () => {
    const { document, host, returnTarget } = fixture();
    const onOpenStore = vi.fn();
    mountStorePromoCard(asHtml(host), {
      slides: [armorySlide(onOpenStore)],
      returnFocusTo: () => asHtml(returnTarget),
    });

    const close = host.querySelector('.store-promo-card-close');
    expect(close?.className).toContain('ui-x-btn');
    expect(close?.getAttribute('aria-label')).toBe('Close WOC Store');
    close?.dispatch('click');

    expect(onOpenStore).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(returnTarget);
    expect(host.querySelector('.store-promo-card')).toBeNull();
  });

  it('rotates between adverts on a timer and holds still while hovered', () => {
    vi.useFakeTimers();
    const { host, returnTarget } = fixture();
    mountStorePromoCard(asHtml(host), {
      slides: [armorySlide(), referralSlide()],
      returnFocusTo: () => asHtml(returnTarget),
    });
    const card = host.querySelector('.store-promo-card');
    const open = host.querySelector('.store-promo-card-open');
    expect(activeSlide(host)?.querySelector('img')?.src).toBe(
      '/ui/store/season-01-armory-promo.webp',
    );

    vi.advanceTimersByTime(STORE_PROMO_ROTATE_MS);
    expect(activeSlide(host)?.querySelector('img')?.src).toBe('/ui/store/referral-promo.webp');
    expect(open?.getAttribute('aria-label')).toBe('Refer a Friend');
    expect(host.querySelector('.store-promo-card-close')?.getAttribute('aria-label')).toBe(
      'Close Refer a Friend promotion',
    );

    card?.dispatch('mouseenter');
    vi.advanceTimersByTime(STORE_PROMO_ROTATE_MS * 3);
    expect(activeSlide(host)?.querySelector('img')?.src).toBe('/ui/store/referral-promo.webp');

    card?.dispatch('mouseleave');
    vi.advanceTimersByTime(STORE_PROMO_ROTATE_MS);
    expect(activeSlide(host)?.querySelector('img')?.src).toBe(
      '/ui/store/season-01-armory-promo.webp',
    );
  });

  it('retires only the advert it closes or opens, removing the card after the last', () => {
    vi.useFakeTimers();
    const { host, returnTarget } = fixture();
    const onReferral = vi.fn();
    const onDismiss = vi.fn();
    mountStorePromoCard(asHtml(host), {
      slides: [armorySlide(), referralSlide(onReferral)],
      returnFocusTo: () => asHtml(returnTarget),
      onDismiss,
    });

    host.querySelector('.store-promo-card-close')?.dispatch('click');
    expect(host.querySelector('.store-promo-card')).not.toBeNull();
    expect(activeSlide(host)?.querySelector('img')?.src).toBe('/ui/store/referral-promo.webp');
    expect(onDismiss).not.toHaveBeenCalled();

    vi.advanceTimersByTime(STORE_PROMO_RETIRE_GUARD_MS);
    host.querySelector('.store-promo-card-open')?.dispatch('click');
    expect(onReferral).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(host.querySelector('.store-promo-card')).toBeNull();
  });

  it('stays still while either the pointer or keyboard focus remains on the card', () => {
    vi.useFakeTimers();
    const { host, returnTarget } = fixture();
    mountStorePromoCard(asHtml(host), {
      slides: [armorySlide(), referralSlide()],
      returnFocusTo: () => asHtml(returnTarget),
      reducedMotion: () => false,
    });
    const card = host.querySelector('.store-promo-card');
    const armory = '/ui/store/season-01-armory-promo.webp';

    card?.dispatch('focusin');
    card?.dispatch('mouseenter');
    card?.dispatch('mouseleave');
    vi.advanceTimersByTime(STORE_PROMO_ROTATE_MS * 2);
    expect(activeSlide(host)?.querySelector('img')?.src).toBe(armory);

    card?.dispatch('mouseenter');
    card?.dispatch('focusout');
    vi.advanceTimersByTime(STORE_PROMO_ROTATE_MS * 2);
    expect(activeSlide(host)?.querySelector('img')?.src).toBe(armory);

    card?.dispatch('mouseleave');
    vi.advanceTimersByTime(STORE_PROMO_ROTATE_MS);
    expect(activeSlide(host)?.querySelector('img')?.src).toBe('/ui/store/referral-promo.webp');
  });

  it('keeps focus on close while adverts remain, then returns it to the chest', () => {
    vi.useFakeTimers();
    const { document, host, returnTarget } = fixture();
    mountStorePromoCard(asHtml(host), {
      slides: [armorySlide(), referralSlide()],
      returnFocusTo: () => asHtml(returnTarget),
    });
    const close = host.querySelector('.store-promo-card-close');

    close?.dispatch('click');
    expect(document.activeElement).toBe(close);
    expect(close?.getAttribute('aria-label')).toBe('Close Refer a Friend promotion');

    vi.advanceTimersByTime(STORE_PROMO_RETIRE_GUARD_MS);
    close?.dispatch('click');
    expect(document.activeElement).toBe(returnTarget);
    expect(host.querySelector('.store-promo-card')).toBeNull();
  });

  it('ignores a second click that lands inside the retire guard', () => {
    vi.useFakeTimers();
    const { host, returnTarget } = fixture();
    const onDismiss = vi.fn();
    mountStorePromoCard(asHtml(host), {
      slides: [armorySlide(), referralSlide()],
      returnFocusTo: () => asHtml(returnTarget),
      onDismiss,
    });
    const close = host.querySelector('.store-promo-card-close');

    close?.dispatch('click');
    close?.dispatch('click');
    expect(onDismiss).not.toHaveBeenCalled();
    expect(activeSlide(host)?.querySelector('img')?.src).toBe('/ui/store/referral-promo.webp');
  });

  it('does not rotate on its own under reduced motion', () => {
    vi.useFakeTimers();
    const { host, returnTarget } = fixture();
    mountStorePromoCard(asHtml(host), {
      slides: [armorySlide(), referralSlide()],
      returnFocusTo: () => asHtml(returnTarget),
      reducedMotion: () => true,
    });

    vi.advanceTimersByTime(STORE_PROMO_ROTATE_MS * 3);
    expect(activeSlide(host)?.querySelector('img')?.src).toBe(
      '/ui/store/season-01-armory-promo.webp',
    );
  });

  it('drops the last advert once it stops being available', () => {
    vi.useFakeTimers();
    const { host, returnTarget } = fixture();
    let member = false;
    const onDismiss = vi.fn();
    mountStorePromoCard(asHtml(host), {
      slides: [
        referralSlide(),
        {
          id: 'membership',
          image: '/ui/store/membership-promo.webp',
          labels: armoryLabels,
          onOpen: vi.fn(),
          available: () => !member,
        },
      ],
      returnFocusTo: () => asHtml(returnTarget),
      reducedMotion: () => true,
      onDismiss,
    });

    // Close Refer a Friend, leaving membership as the only advert.
    host.querySelector('.store-promo-card-close')?.dispatch('click');
    expect(activeSlide(host)?.querySelector('img')?.src).toBe('/ui/store/membership-promo.webp');
    member = true;
    vi.advanceTimersByTime(STORE_PROMO_ROTATE_MS);
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(host.querySelector('.store-promo-card')).toBeNull();
  });

  it('marks the dot of an advert that is not available as retired', () => {
    const { host, returnTarget } = fixture();
    mountStorePromoCard(asHtml(host), {
      slides: [
        armorySlide(),
        {
          id: 'membership',
          image: '/ui/store/membership-promo.webp',
          labels: armoryLabels,
          onOpen: vi.fn(),
          available: () => false,
        },
      ],
      returnFocusTo: () => asHtml(returnTarget),
    });
    const dots = host.querySelector('.store-promo-card-dots')?.children ?? [];
    expect(dots.map((dot) => dot.className)).toEqual([
      'store-promo-card-dot is-active',
      'store-promo-card-dot is-retired',
    ]);
  });

  it('stops rotating once dismissed', () => {
    vi.useFakeTimers();
    const { host, returnTarget } = fixture();
    const onDismiss = vi.fn();
    const controller = mountStorePromoCard(asHtml(host), {
      slides: [armorySlide(), referralSlide()],
      returnFocusTo: () => asHtml(returnTarget),
      onDismiss,
    });

    controller.dismiss();
    controller.dismiss();
    expect(vi.getTimerCount()).toBe(0);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('wires every advert to its Hud destination and relocalizes with live copy', () => {
    const hud = readFileSync(join(process.cwd(), 'src/ui/hud.ts'), 'utf8');
    expect(hud).toContain('openStore: () => this.openWocStore(),');
    expect(hud).toContain('openReferralCards: () => this.referralCards.open(),');
    expect(hud).toContain('membershipActive: () => this.sim.player?.membershipActive === true,');
    expect(hud).toContain('this.storePromoCard?.relocalize(storePromoLabels());');
  });

  it('never shows an advert whose availability check fails', () => {
    vi.useFakeTimers();
    const { host, returnTarget } = fixture();
    let member = true;
    mountStorePromoCard(asHtml(host), {
      slides: [
        armorySlide(),
        {
          id: 'membership',
          image: '/ui/store/membership-promo.webp',
          labels: armoryLabels,
          onOpen: vi.fn(),
          available: () => !member,
        },
        referralSlide(),
      ],
      returnFocusTo: () => asHtml(returnTarget),
    });

    vi.advanceTimersByTime(STORE_PROMO_ROTATE_MS);
    expect(activeSlide(host)?.querySelector('img')?.src).toBe('/ui/store/referral-promo.webp');
    member = false;
    vi.advanceTimersByTime(STORE_PROMO_ROTATE_MS * 2);
    expect(activeSlide(host)?.querySelector('img')?.src).toBe('/ui/store/membership-promo.webp');
  });

  it('refreshes all visible and accessible labels after a language change', () => {
    const { host, returnTarget } = fixture();
    const controller = mountStorePromoCard(asHtml(host), {
      slides: [armorySlide()],
      returnFocusTo: () => asHtml(returnTarget),
    });

    controller.relocalize({
      armory: {
        open: 'Tienda WOC',
        close: 'Cerrar Tienda WOC',
        season: 'Temporada 1',
        title: 'La Armería',
        cta: 'Tienda WOC',
      },
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

  it('resolves English copy for every advert in the rotation', () => {
    const labels = storePromoLabels();
    expect(labels.armory.title).toBe('The Armory');
    expect(labels.membership).toMatchObject({ title: 'Membership', cta: 'Join now' });
    expect(labels.referral).toMatchObject({ title: 'Refer a Friend', cta: 'Invite friends' });
  });

  it('routes each advert to its destination and hides membership from members', () => {
    let member = false;
    const deps = {
      openStore: vi.fn(),
      openReferralCards: vi.fn(),
      membershipActive: () => member,
    };
    const slides = storePromoSlides(deps);
    expect(slides.map((slide) => slide.id)).toEqual(['armory', 'membership', 'referral']);
    expect(slides.map((slide) => slide.image)).toEqual([
      '/ui/store/season-01-armory-promo.webp',
      '/ui/store/membership-promo.webp',
      '/ui/store/referral-promo.webp',
    ]);
    slides[1].onOpen();
    slides[2].onOpen();
    expect(deps.openStore).toHaveBeenCalledOnce();
    expect(deps.openReferralCards).toHaveBeenCalledOnce();
    expect(slides[1].available?.()).toBe(true);
    member = true;
    expect(slides[1].available?.()).toBe(false);
  });

  it('uses a comfortably sized close target on the promo card', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/hud.css'), 'utf8');
    const rule = css.match(/\.store-promo-card-close\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('width: 34px');
    expect(rule).toContain('height: 34px');
  });
});
