import { t } from './i18n';
import { svgIcon } from './ui_icons';

export interface StorePromoCardLabels {
  open: string;
  close: string;
  season: string;
  title: string;
  cta: string;
}

/** One advert in the promo card's rotation (the Armory, membership, Refer a Friend). */
export interface StorePromoSlide {
  id: string;
  image: string;
  labels: StorePromoCardLabels;
  onOpen(): void;
  /** Re-read on every rotation step; a slide that is not available is skipped. */
  available?(): boolean;
}

export interface StorePromoCardController {
  dismiss(): void;
  relocalize(labels: Readonly<Record<string, StorePromoCardLabels>>): void;
}

export interface StorePromoCardDeps {
  slides: readonly StorePromoSlide[];
  returnFocusTo(): HTMLElement | null;
  onDismiss?(): void;
  /** Defaults to the prefers-reduced-motion media query. */
  reducedMotion?(): boolean;
}

export interface StorePromoVisibilityInput {
  nativeApp: boolean;
  desktopApp: boolean;
  mobileTouch: boolean;
}

export function shouldShowStorePromo(input: StorePromoVisibilityInput): boolean {
  return !input.nativeApp && !input.desktopApp && !input.mobileTouch;
}

const STORE_PROMO_ASPECT_HEIGHT = 590;
const STORE_PROMO_ASPECT_WIDTH = 1000;
export const STORE_PROMO_GAP_PX = 10;
/** How long each advert holds before the card rotates to the next one. */
export const STORE_PROMO_ROTATE_MS = 9000;
/** Clicks this soon after a retire are ignored, so a double click retires one advert. */
export const STORE_PROMO_RETIRE_GUARD_MS = 450;

/** Visual height reserved above chat for the proportional promo plus its CSS gap. */
export function storePromoReservedHeight(width: number, uiScale = 1): number {
  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const safeScale = Number.isFinite(uiScale) && uiScale > 0 ? uiScale : 1;
  return (
    (safeWidth * STORE_PROMO_ASPECT_HEIGHT) / STORE_PROMO_ASPECT_WIDTH +
    STORE_PROMO_GAP_PX * safeScale
  );
}

/**
 * The next slide index after `from` that is still in the rotation and available,
 * wrapping; `from` itself when it is the only candidate, -1 when none remain.
 */
export function nextStorePromoIndex(
  slides: readonly Pick<StorePromoSlide, 'available'>[],
  live: readonly boolean[],
  from: number,
): number {
  for (let step = 1; step <= slides.length; step++) {
    const index = (from + step) % slides.length;
    if (live[index] && (slides[index].available?.() ?? true)) return index;
  }
  return -1;
}

/** The current locale's copy for every advert, keyed by slide id. */
export function storePromoLabels(): Record<
  'armory' | 'membership' | 'referral',
  StorePromoCardLabels
> {
  return {
    armory: {
      open: t('hudChrome.wocStore.title'),
      close: t('hudChrome.wocStore.close'),
      season: t('hudChrome.wocStore.seasonOne'),
      title: t('hudChrome.wocStore.armoryTitle'),
      cta: t('hudChrome.wocStore.title'),
    },
    membership: {
      open: t('hudChrome.wocStore.membershipPromo.open'),
      close: t('hudChrome.wocStore.membershipPromo.close'),
      season: t('hudChrome.wocStore.membershipPromo.eyebrow'),
      title: t('hudChrome.wocStore.membershipPromo.title'),
      cta: t('hudChrome.wocStore.membershipPromo.cta'),
    },
    referral: {
      open: t('referralCards.title'),
      close: t('hudChrome.wocStore.referralPromo.close'),
      season: t('hudChrome.wocStore.referralPromo.eyebrow'),
      title: t('referralCards.title'),
      cta: t('hudChrome.wocStore.referralPromo.cta'),
    },
  };
}

export interface StorePromoSlideDeps {
  openStore(): void;
  openReferralCards(): void;
  membershipActive(): boolean;
}

/** The adverts the card rotates through, in order, with the current locale's copy. */
export function storePromoSlides(deps: StorePromoSlideDeps): StorePromoSlide[] {
  const labels = storePromoLabels();
  return [
    {
      id: 'armory',
      image: '/ui/store/season-01-armory-promo.webp',
      labels: labels.armory,
      onOpen: deps.openStore,
    },
    {
      // Membership is sold from the Store's subscription section, so this
      // advert opens the Store too; members have nothing left to buy.
      id: 'membership',
      image: '/ui/store/membership-promo.webp',
      labels: labels.membership,
      onOpen: deps.openStore,
      available: () => !deps.membershipActive(),
    },
    {
      id: 'referral',
      image: '/ui/store/referral-promo.webp',
      labels: labels.referral,
      onOpen: deps.openReferralCards,
    },
  ];
}

interface SlideView {
  slide: StorePromoSlide;
  layer: HTMLElement;
  season: HTMLElement;
  title: HTMLElement;
  cta: HTMLElement;
  dot: HTMLElement;
}

/**
 * Mount the desktop-web promotion directly above the movable chat frame. One
 * card rotates through its adverts; each close button retires only the advert
 * it shows, and the card removes itself once every advert is gone.
 */
export function mountStorePromoCard(
  host: HTMLElement,
  deps: StorePromoCardDeps,
): StorePromoCardController {
  const doc = host.ownerDocument;
  const card = doc.createElement('div');
  card.className = 'store-promo-card ui-panel';

  const open = doc.createElement('button');
  open.type = 'button';
  open.className = 'store-promo-card-open';

  const dots = doc.createElement('span');
  dots.className = 'store-promo-card-dots';
  dots.setAttribute('aria-hidden', 'true');

  const views: SlideView[] = deps.slides.map((slide) => {
    const layer = doc.createElement('span');
    layer.className = 'store-promo-card-slide';

    const image = doc.createElement('img');
    image.src = slide.image;
    image.alt = '';
    image.draggable = false;
    image.decoding = 'async';

    const copy = doc.createElement('span');
    copy.className = 'store-promo-card-copy ui-outline';
    const season = doc.createElement('span');
    season.className = 'store-promo-card-season ui-cin';
    const title = doc.createElement('span');
    title.className = 'store-promo-card-title ui-cin';
    copy.append(season, title);

    const cta = doc.createElement('span');
    cta.className = 'store-promo-card-cta ui-chip ui-cin';
    layer.append(image, copy, cta);
    open.appendChild(layer);

    const dot = doc.createElement('span');
    dot.className = 'store-promo-card-dot';
    dots.appendChild(dot);
    return { slide, layer, season, title, cta, dot };
  });
  if (views.length > 1) open.appendChild(dots);

  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'x-btn store-promo-card-close ui-x-btn';
  close.innerHTML = svgIcon('close');

  card.append(open, close);
  host.appendChild(card);

  const live = views.map(() => true);
  let current = -1;
  let dismissed = false;
  // Pointer and keyboard focus pause independently: either one still on the card
  // keeps the advert still, so it never changes under a click or a screen reader.
  let hovered = false;
  let focused = false;
  let guardUntil = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  const reducedMotion =
    deps.reducedMotion ??
    (() =>
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

  const showable = (index: number): boolean =>
    live[index] && (views[index].slide.available?.() ?? true);
  const stopTimer = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const dismiss = (): void => {
    if (dismissed) return;
    dismissed = true;
    stopTimer();
    card.remove();
    deps.onDismiss?.();
  };
  const show = (index: number): void => {
    current = index;
    const labels = views[index].slide.labels;
    open.title = labels.open;
    open.setAttribute('aria-label', labels.open);
    close.title = labels.close;
    close.setAttribute('aria-label', labels.close);
    views.forEach((view, i) => {
      const active = i === index;
      view.layer.className = `store-promo-card-slide${active ? ' is-active' : ''}`;
      view.dot.className = `store-promo-card-dot${active ? ' is-active' : ''}${showable(i) ? '' : ' is-retired'}`;
    });
  };
  const advance = (): void => {
    const next = nextStorePromoIndex(
      views.map((view) => view.slide),
      live,
      current,
    );
    if (next < 0) dismiss();
    else show(next);
  };
  // Under reduced motion the card never rotates on its own; the tick still drops
  // an advert that stopped being available (membership bought elsewhere).
  const tick = (): void => {
    if (reducedMotion() && showable(current)) show(current);
    else advance();
  };
  const startTimer = (): void => {
    stopTimer();
    if (dismissed || hovered || focused) return;
    timer = setInterval(tick, STORE_PROMO_ROTATE_MS);
  };
  /** Take the shown advert out of the rotation, then move on or remove the card. */
  const retireCurrent = (): void => {
    live[current] = false;
    guardUntil = Date.now() + STORE_PROMO_RETIRE_GUARD_MS;
    advance();
    startTimer();
  };
  const ignoreClick = (): boolean => dismissed || current < 0 || Date.now() < guardUntil;
  const relocalize = (labels: Readonly<Record<string, StorePromoCardLabels>>): void => {
    for (const view of views) {
      const next = labels[view.slide.id];
      if (next) view.slide = { ...view.slide, labels: next };
      view.season.textContent = view.slide.labels.season;
      view.title.textContent = view.slide.labels.title;
      view.cta.textContent = view.slide.labels.cta;
    }
    if (current >= 0) show(current);
  };

  relocalize({});
  advance();
  startTimer();

  const setHovered = (value: boolean) => (): void => {
    hovered = value;
    startTimer();
  };
  const setFocused = (value: boolean) => (): void => {
    focused = value;
    startTimer();
  };
  card.addEventListener('mouseenter', setHovered(true));
  card.addEventListener('mouseleave', setHovered(false));
  card.addEventListener('focusin', setFocused(true));
  card.addEventListener('focusout', setFocused(false));

  open.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (ignoreClick()) return;
    // Capture the permanent desktop chest as the destination's focus-return
    // target; the advert retires after opening and cannot safely be that target.
    deps.returnFocusTo()?.focus();
    try {
      views[current].slide.onOpen();
    } finally {
      retireCurrent();
    }
  });
  close.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (ignoreClick()) return;
    retireCurrent();
    // While adverts remain, focus stays on this close button (it now names the
    // next advert); once the card is gone, it returns to the permanent chest.
    if (dismissed) deps.returnFocusTo()?.focus();
    else close.focus();
  });

  return { dismiss, relocalize };
}
