export interface StorePromoCardLabels {
  open: string;
  close: string;
  season: string;
  title: string;
  cta: string;
}

export interface StorePromoCardController {
  dismiss(): void;
  relocalize(labels: StorePromoCardLabels): void;
}

export interface StorePromoCardDeps {
  labels: StorePromoCardLabels;
  returnFocusTo(): HTMLElement | null;
  onOpenStore(): void;
  onDismiss?(): void;
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

/** Visual height reserved above chat for the proportional promo plus its CSS gap. */
export function storePromoReservedHeight(width: number, uiScale = 1): number {
  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const safeScale = Number.isFinite(uiScale) && uiScale > 0 ? uiScale : 1;
  return (
    (safeWidth * STORE_PROMO_ASPECT_HEIGHT) / STORE_PROMO_ASPECT_WIDTH +
    STORE_PROMO_GAP_PX * safeScale
  );
}

/** Mount the desktop-web Armory promotion directly above the movable chat frame. */
export function mountStorePromoCard(
  host: HTMLElement,
  deps: StorePromoCardDeps,
): StorePromoCardController {
  const doc = host.ownerDocument;
  const card = doc.createElement('div');
  card.className = 'store-promo-card';

  const open = doc.createElement('button');
  open.type = 'button';
  open.className = 'store-promo-card-open';

  const image = doc.createElement('img');
  image.src = '/ui/store/season-01-armory-promo.webp';
  image.alt = '';
  image.draggable = false;
  image.decoding = 'async';

  const copy = doc.createElement('span');
  copy.className = 'store-promo-card-copy';
  const season = doc.createElement('span');
  season.className = 'store-promo-card-season';
  const title = doc.createElement('span');
  title.className = 'store-promo-card-title';
  copy.append(season, title);

  const cta = doc.createElement('span');
  cta.className = 'store-promo-card-cta';
  open.append(image, copy, cta);

  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'x-btn store-promo-card-close';
  close.textContent = '×';

  card.append(open, close);
  host.appendChild(card);

  let dismissed = false;
  const dismiss = (): void => {
    if (dismissed) return;
    dismissed = true;
    card.remove();
    deps.onDismiss?.();
  };
  const relocalize = (labels: StorePromoCardLabels): void => {
    open.title = labels.open;
    open.setAttribute('aria-label', labels.open);
    close.title = labels.close;
    close.setAttribute('aria-label', labels.close);
    season.textContent = labels.season;
    title.textContent = labels.title;
    cta.textContent = labels.cta;
  };

  relocalize(deps.labels);
  open.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    // Capture the permanent desktop chest as the Store's focus-return target;
    // the promo removes itself after opening and cannot safely be that target.
    deps.returnFocusTo()?.focus();
    try {
      deps.onOpenStore();
    } finally {
      dismiss();
    }
  });
  close.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    deps.returnFocusTo()?.focus();
    dismiss();
  });

  return { dismiss, relocalize };
}
