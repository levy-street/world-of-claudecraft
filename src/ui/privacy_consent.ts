import '../styles/privacy-consent.css';
import {
  createPrivacyConsentRecord,
  effectivePrivacyChoices,
  parsePrivacyConsentCookie,
  type PrivacyChoices,
  type PrivacyConsentRecord,
  type PrivacyRegionResponse,
  serializePrivacyConsentCookie,
} from '../privacy_consent_core';
import { t } from './i18n';

type PrivacyCategory = keyof PrivacyChoices;

export const PRIVACY_REGION_URL = '/api/privacy/region';
export const GOOGLE_ANALYTICS_ID = 'G-BR5Z7GT7C2';
export const GOOGLE_ANALYTICS_SCRIPT_ID = 'woc-google-analytics';
export const META_PIXEL_ID = '1692101265042180';
export const META_PIXEL_SCRIPT_ID = 'woc-meta-pixel';

const GOOGLE_ANALYTICS_URL = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ANALYTICS_ID}`;
const META_PIXEL_URL = 'https://connect.facebook.net/en_US/fbevents.js';
const PRIVACY_CHANGE_EVENT = 'woc:privacychange';
const SITE_PRESENCE_STORAGE_KEY = 'woc_site_visitor_id';
const PERF_SESSION_STORAGE_KEY = 'woc_perf_session_id';
const OPTIONAL_CATEGORIES: readonly PrivacyCategory[] = [
  'analytics',
  'marketing',
  'x',
  'twitch',
];

declare global {
  interface Navigator {
    globalPrivacyControl?: boolean;
  }

  interface Window {
    dataLayer?: unknown[][];
    gtag?: (...args: unknown[]) => void;
    fbq?: MetaPixelFunction;
    _fbq?: MetaPixelFunction;
  }
}

interface MetaPixelFunction {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  loaded?: boolean;
  push?: MetaPixelFunction;
  queue: unknown[][];
  version?: string;
}

export interface PrivacyConsentController {
  readonly ready: Promise<void>;
  allowed(category: PrivacyCategory): boolean;
  choices(): PrivacyChoices;
  onChange(listener: (choices: PrivacyChoices) => void): () => void;
  openPreferences(): void;
  requestCategory(category: PrivacyCategory): boolean;
}

export interface PrivacyConsentOptions {
  enabled?: boolean;
  fetchRegion?: () => Promise<PrivacyRegionResponse>;
}

interface ConsentUi {
  banner: HTMLElement;
  dialog: HTMLDialogElement;
  inputs: Record<PrivacyCategory, HTMLInputElement>;
  openDialog(opener?: HTMLElement | null): void;
}

function choicesCopy(choices: PrivacyChoices): PrivacyChoices {
  return { ...choices };
}

function allOptional(value: boolean, gpc: boolean): PrivacyChoices {
  return {
    analytics: value && !gpc,
    marketing: value && !gpc,
    x: value,
    twitch: value,
  };
}

export function privacyChoicesRequireReload(
  previous: PrivacyChoices,
  next: PrivacyChoices,
): boolean {
  return OPTIONAL_CATEGORIES.some((category) => previous[category] && !next[category]);
}

export function isLocalPrivacyHost(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname.toLowerCase());
}

function cookieNames(): string[] {
  return document.cookie
    .split(';')
    .map((part) => part.split('=', 1)[0]?.trim() ?? '')
    .filter(Boolean);
}

function expireCookie(name: string): void {
  const hostname = window.location.hostname.replace(/^www\./, '');
  const domains = [
    '',
    window.location.hostname,
    `.${window.location.hostname}`,
    hostname,
    `.${hostname}`,
  ];
  for (const domain of new Set(domains)) {
    const domainPart = domain ? `; Domain=${domain}` : '';
    document.cookie = `${encodeURIComponent(name)}=; Path=/; Max-Age=0; SameSite=Lax${domainPart}`;
  }
}

export function clearWithdrawnPrivacyState(
  previous: PrivacyChoices,
  next: PrivacyChoices,
): void {
  if (previous.analytics && !next.analytics) {
    for (const name of cookieNames()) {
      if (name === '_ga' || name.startsWith('_ga_')) expireCookie(name);
    }
    try {
      localStorage.removeItem(SITE_PRESENCE_STORAGE_KEY);
      sessionStorage.removeItem(PERF_SESSION_STORAGE_KEY);
    } catch {
      // Storage can be blocked while cookie preferences remain usable.
    }
    (window as unknown as Record<string, unknown>)[`ga-disable-${GOOGLE_ANALYTICS_ID}`] = true;
  }
  if (previous.marketing && !next.marketing) {
    expireCookie('_fbp');
    expireCookie('_fbc');
  }
}

function isPrivacyRegionResponse(value: unknown): value is PrivacyRegionResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PrivacyRegionResponse>;
  return (
    (candidate.regime === 'opt-in' ||
      candidate.regime === 'opt-out' ||
      candidate.regime === 'notice') &&
    (candidate.source === 'edge' || candidate.source === 'fallback') &&
    typeof candidate.gpc === 'boolean'
  );
}

async function fetchPrivacyRegion(): Promise<PrivacyRegionResponse> {
  try {
    const response = await fetch(PRIVACY_REGION_URL, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Privacy region request failed: ${response.status}`);
    const value: unknown = await response.json();
    if (!isPrivacyRegionResponse(value)) throw new Error('Invalid privacy region response');
    return value;
  } catch {
    return { regime: 'opt-in', source: 'fallback', gpc: false };
  }
}

function addScript(id: string, src: string): HTMLScriptElement {
  const existing = document.getElementById(id) as HTMLScriptElement | null;
  if (existing) return existing;
  const script = document.createElement('script');
  script.id = id;
  script.async = true;
  script.src = src;
  document.head.append(script);
  return script;
}

export function loadGoogleAnalytics(): void {
  if (isLocalPrivacyHost(window.location.hostname)) return;
  if (document.getElementById(GOOGLE_ANALYTICS_SCRIPT_ID)) return;
  window.dataLayer ??= [];
  window.gtag ??= (...args: unknown[]) => {
    window.dataLayer?.push(args);
  };
  window.gtag('js', new Date());
  window.gtag('config', GOOGLE_ANALYTICS_ID, { anonymize_ip: true });
  addScript(GOOGLE_ANALYTICS_SCRIPT_ID, GOOGLE_ANALYTICS_URL);
}

function makeMetaPixelStub(): MetaPixelFunction {
  const stub = ((...args: unknown[]) => {
    if (stub.callMethod) stub.callMethod(...args);
    else stub.queue.push(args);
  }) as MetaPixelFunction;
  stub.queue = [];
  stub.loaded = true;
  stub.version = '2.0';
  stub.push = stub;
  return stub;
}

export function loadMetaPixel(): void {
  if (isLocalPrivacyHost(window.location.hostname)) return;
  if (document.getElementById(META_PIXEL_SCRIPT_ID)) return;
  const pixel = window.fbq ?? makeMetaPixelStub();
  window.fbq = pixel;
  window._fbq ??= pixel;
  pixel('init', META_PIXEL_ID);
  pixel('track', 'PageView');
  addScript(META_PIXEL_SCRIPT_ID, META_PIXEL_URL);
}

function applyOptionalServices(choices: PrivacyChoices): void {
  if (choices.analytics) loadGoogleAnalytics();
  if (choices.marketing) loadMetaPixel();
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  return element;
}

function text(element: HTMLElement, value: string): HTMLElement {
  element.textContent = value;
  return element;
}

function privacyKey(key: string): Parameters<typeof t>[0] {
  return `hudChrome.privacyConsent.${key}` as Parameters<typeof t>[0];
}

function createChoiceRow(
  category: PrivacyCategory | 'necessary',
  input: HTMLInputElement,
): HTMLElement {
  const row = el('label', 'privacy-choice');
  const copy = el('span', 'privacy-choice__copy');
  const title = el('strong');
  const body = el('span');
  title.dataset.privacyText = `${category}Title`;
  body.dataset.privacyText = `${category}Body`;
  copy.append(title, body);
  const control = el('span', 'privacy-choice__control');
  input.className = 'privacy-choice__input';
  input.type = 'checkbox';
  input.dataset.privacyCategory = category;
  const track = el('span', 'privacy-choice__track');
  track.setAttribute('aria-hidden', 'true');
  const state = el('span', 'privacy-choice__state');
  if (category === 'necessary') state.dataset.privacyText = 'alwaysOn';
  control.append(input, track, state);
  row.append(copy, control);
  return row;
}

function createConsentUi(
  region: PrivacyRegionResponse,
  getChoices: () => PrivacyChoices,
  acceptAll: () => void,
  rejectAll: () => void,
  save: (choices: PrivacyChoices) => void,
): ConsentUi {
  const root = el('div', 'privacy-consent-root');
  root.id = 'privacy-consent-root';

  const banner = el('section', 'privacy-banner');
  banner.setAttribute('role', 'region');
  banner.setAttribute('aria-labelledby', 'privacy-banner-title');
  const bannerOrnament = el('span', 'privacy-banner__ornament');
  bannerOrnament.setAttribute('aria-hidden', 'true');
  const bannerCopy = el('div', 'privacy-banner__copy');
  const bannerTitle = el('h2');
  bannerTitle.id = 'privacy-banner-title';
  bannerTitle.dataset.privacyText = 'bannerTitle';
  const bannerBody = el('p');
  bannerBody.dataset.privacyText = region.regime === 'opt-out' ? 'bannerOptOut' : 'bannerOptIn';
  const gpcNote = el('p', 'privacy-banner__gpc');
  gpcNote.dataset.privacyText = 'bannerGpc';
  gpcNote.hidden = !region.gpc;
  const policyLink = el('a', 'privacy-policy-link');
  policyLink.href = '/cookies';
  policyLink.dataset.privacyText = 'cookiePolicy';
  bannerCopy.append(bannerTitle, bannerBody, gpcNote, policyLink);

  const bannerActions = el('div', 'privacy-banner__actions');
  const accept = el('button', 'privacy-button privacy-button--decision');
  accept.type = 'button';
  accept.dataset.privacyText = 'acceptAll';
  const reject = el('button', 'privacy-button privacy-button--decision');
  reject.type = 'button';
  reject.dataset.privacyText = 'rejectAll';
  const customize = el('button', 'privacy-button privacy-button--secondary');
  customize.type = 'button';
  customize.dataset.privacyText = 'customize';
  customize.setAttribute('aria-haspopup', 'dialog');
  bannerActions.append(accept, reject, customize);
  banner.append(bannerOrnament, bannerCopy, bannerActions);

  const dialog = el('dialog', 'privacy-dialog');
  dialog.id = 'privacy-preferences';
  dialog.setAttribute('aria-labelledby', 'privacy-dialog-title');
  const dialogFrame = el('div', 'privacy-dialog__frame');
  const dialogHeader = el('header', 'privacy-dialog__header');
  const dialogTitle = el('h2');
  dialogTitle.id = 'privacy-dialog-title';
  dialogTitle.dataset.privacyText = 'dialogTitle';
  const closeButton = el('button', 'privacy-dialog__close');
  closeButton.type = 'button';
  closeButton.dataset.privacyTextAria = 'close';
  closeButton.textContent = '\u00d7';
  dialogHeader.append(dialogTitle, closeButton);
  const dialogIntro = el('p', 'privacy-dialog__intro');
  dialogIntro.dataset.privacyText = 'dialogIntro';
  const dialogGpc = el('p', 'privacy-dialog__gpc');
  dialogGpc.dataset.privacyText = 'bannerGpc';
  dialogGpc.hidden = !region.gpc;

  const necessaryInput = el('input');
  necessaryInput.checked = true;
  necessaryInput.disabled = true;
  const inputs = {
    analytics: el('input'),
    marketing: el('input'),
    x: el('input'),
    twitch: el('input'),
  } satisfies Record<PrivacyCategory, HTMLInputElement>;
  if (region.gpc) {
    inputs.analytics.disabled = true;
    inputs.marketing.disabled = true;
  }
  const choicesList = el('div', 'privacy-dialog__choices');
  choicesList.append(
    createChoiceRow('necessary', necessaryInput),
    createChoiceRow('analytics', inputs.analytics),
    createChoiceRow('marketing', inputs.marketing),
    createChoiceRow('x', inputs.x),
    createChoiceRow('twitch', inputs.twitch),
  );

  const dialogFooter = el('footer', 'privacy-dialog__footer');
  const dialogPolicy = el('a', 'privacy-policy-link');
  dialogPolicy.href = '/cookies';
  dialogPolicy.dataset.privacyText = 'cookiePolicy';
  const saveButton = el('button', 'privacy-button privacy-button--save');
  saveButton.type = 'button';
  saveButton.dataset.privacyText = 'save';
  dialogFooter.append(dialogPolicy, saveButton);
  dialogFrame.append(dialogHeader, dialogIntro, dialogGpc, choicesList, dialogFooter);
  dialog.append(dialogFrame);
  root.append(banner, dialog);
  document.body.append(root);

  let opener: HTMLElement | null = null;
  const syncInputs = (): void => {
    const current = getChoices();
    for (const category of OPTIONAL_CATEGORIES) inputs[category].checked = current[category];
  };
  const openDialog = (nextOpener?: HTMLElement | null): void => {
    opener =
      nextOpener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    syncInputs();
    if (!dialog.open) dialog.showModal();
    closeButton.focus();
  };
  const closeDialog = (): void => {
    if (dialog.open) dialog.close();
    opener?.focus();
  };

  customize.addEventListener('click', () => openDialog(customize));
  closeButton.addEventListener('click', closeDialog);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeDialog();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog();
  });
  accept.addEventListener('click', acceptAll);
  reject.addEventListener('click', rejectAll);
  saveButton.addEventListener('click', () => {
    const next: PrivacyChoices = {
      analytics: !region.gpc && inputs.analytics.checked,
      marketing: !region.gpc && inputs.marketing.checked,
      x: inputs.x.checked,
      twitch: inputs.twitch.checked,
    };
    save(next);
    closeDialog();
  });

  document.addEventListener('click', (event) => {
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-privacy-choices]')
        : null;
    if (!target) return;
    event.preventDefault();
    openDialog(target);
  });

  const refreshText = (): void => {
    root.querySelectorAll<HTMLElement>('[data-privacy-text]').forEach((element) => {
      const key = element.dataset.privacyText;
      if (key) text(element, t(privacyKey(key)));
    });
    root.querySelectorAll<HTMLElement>('[data-privacy-text-aria]').forEach((element) => {
      const key = element.dataset.privacyTextAria;
      if (key) element.setAttribute('aria-label', t(privacyKey(key)));
    });
  };
  refreshText();
  document.addEventListener('woc:languagechange', refreshText);

  return { banner, dialog, inputs, openDialog };
}

function cookieRecord(): PrivacyConsentRecord | null {
  try {
    return parsePrivacyConsentCookie(document.cookie);
  } catch {
    return null;
  }
}

function saveCookie(choices: PrivacyChoices): void {
  const record = createPrivacyConsentRecord(choices);
  document.cookie = serializePrivacyConsentCookie(record, {
    secure: window.location.protocol === 'https:',
  });
}

function disabledController(): PrivacyConsentController {
  const choices = allOptional(false, false);
  return {
    ready: Promise.resolve(),
    allowed: () => false,
    choices: () => choicesCopy(choices),
    onChange: () => () => {},
    openPreferences: () => {},
    requestCategory: () => false,
  };
}

export function initPrivacyConsent(options: PrivacyConsentOptions = {}): PrivacyConsentController {
  if (options.enabled === false || typeof document === 'undefined') return disabledController();

  let current = allOptional(false, false);
  let region: PrivacyRegionResponse = { regime: 'opt-in', source: 'fallback', gpc: false };
  let ui: ConsentUi | null = null;
  const listeners = new Set<(choices: PrivacyChoices) => void>();

  const notify = (): void => {
    const snapshot = choicesCopy(current);
    applyOptionalServices(snapshot);
    window.dispatchEvent(new CustomEvent(PRIVACY_CHANGE_EVENT, { detail: snapshot }));
    for (const listener of listeners) listener(snapshot);
  };

  const persist = (next: PrivacyChoices): void => {
    const normalized = region.gpc
      ? { ...next, analytics: false, marketing: false }
      : choicesCopy(next);
    const reload = privacyChoicesRequireReload(current, normalized);
    clearWithdrawnPrivacyState(current, normalized);
    saveCookie(normalized);
    current = normalized;
    if (ui) ui.banner.hidden = true;
    if (reload) {
      window.location.reload();
      return;
    }
    notify();
  };

  const ready = (options.fetchRegion ?? fetchPrivacyRegion)().then((resolvedRegion) => {
    region = {
      ...resolvedRegion,
      gpc: resolvedRegion.gpc || navigator.globalPrivacyControl === true,
    };
    const stored = cookieRecord();
    current = effectivePrivacyChoices(stored, region);
    ui = createConsentUi(
      region,
      () => current,
      () => persist(allOptional(true, region.gpc)),
      () => persist(allOptional(false, region.gpc)),
      persist,
    );
    ui.banner.hidden = stored !== null || region.regime === 'notice';
    notify();

    const url = new URL(window.location.href);
    if (url.searchParams.get('privacy-settings') === '1') {
      url.searchParams.delete('privacy-settings');
      history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
      ui.openDialog();
    }
  });

  return {
    ready,
    allowed: (category) => current[category],
    choices: () => choicesCopy(current),
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    openPreferences: () => ui?.openDialog(),
    requestCategory(category) {
      if (current[category]) return true;
      if (region.gpc && (category === 'analytics' || category === 'marketing')) return false;
      persist({ ...current, [category]: true });
      return true;
    },
  };
}
