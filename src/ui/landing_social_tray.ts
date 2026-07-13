import { type TranslationKey, t } from './i18n';

export interface LandingSocialItem {
  readonly accent: string;
  readonly accessibleLabelKey: TranslationKey;
  readonly badgeKey?: TranslationKey;
  readonly iconPath: string;
  readonly iconVariant?: 'fill' | 'stroke';
  readonly id: string;
  readonly nameKey: TranslationKey;
  readonly url: string;
}

// This is the only list to edit when a community destination changes.
export const LANDING_SOCIALS: readonly Readonly<LandingSocialItem>[] = Object.freeze([
  Object.freeze({
    id: 'x',
    nameKey: 'landing.socialX',
    accessibleLabelKey: 'landing.xCta',
    url: 'https://x.com/WoClaudecraft',
    accent: '#111111',
    iconPath:
      'M18.24 2H21l-6.04 6.9L22 22h-5.51l-4.32-5.65L7.23 22H4.47l6.42-7.34L4.14 2h5.65l3.91 5.17L18.24 2Zm-.97 17.7h1.53L8.96 4.18H7.32L17.27 19.7Z',
  }),
  Object.freeze({
    id: 'discord',
    nameKey: 'landing.socialDiscord',
    accessibleLabelKey: 'a11y.discordCommunity',
    url: 'https://discord.com/invite/worldofclaudecraft',
    accent: '#5865f2',
    iconPath:
      'M20.32 4.37A19.8 19.8 0 0 0 15.36 2.8a13.66 13.66 0 0 0-.64 1.32 18.47 18.47 0 0 0-5.45 0 13.02 13.02 0 0 0-.65-1.32 19.73 19.73 0 0 0-4.96 1.58C.53 9.03-.32 13.56.1 18.02a19.9 19.9 0 0 0 6.08 3.08c.49-.67.93-1.38 1.3-2.13-.72-.27-1.41-.6-2.06-.98.17-.13.34-.26.5-.4a14.16 14.16 0 0 0 12.16 0c.16.14.33.27.5.4-.65.39-1.34.72-2.07.99.38.74.81 1.45 1.31 2.12a19.86 19.86 0 0 0 6.08-3.08c.5-5.17-.85-9.66-3.58-13.65ZM8.02 15.28c-1.18 0-2.15-1.08-2.15-2.41 0-1.33.95-2.42 2.15-2.42 1.2 0 2.17 1.1 2.15 2.42 0 1.33-.95 2.41-2.15 2.41Zm7.96 0c-1.18 0-2.15-1.08-2.15-2.41 0-1.33.95-2.42 2.15-2.42 1.2 0 2.17 1.1 2.15 2.42 0 1.33-.95 2.41-2.15 2.41Z',
  }),
  Object.freeze({
    id: 'twitch',
    nameKey: 'landing.socialTwitch',
    accessibleLabelKey: 'landing.twitchCategoryCta',
    url: 'https://www.twitch.tv/directory/category/world-of-claudecraft',
    accent: '#9146ff',
    iconPath:
      'M4 2h18v13l-5 5h-4l-3 3H7v-3H2V5l2-3Zm2 2L4 6v12h5v2l2-2h5l4-4V4H6Zm3 3h2v6H9V7Zm5 0h2v6h-2V7Z',
  }),
  Object.freeze({
    id: 'instagram',
    nameKey: 'landing.socialInstagram',
    accessibleLabelKey: 'landing.socialInstagram',
    url: 'https://www.instagram.com/woclaudecraft/',
    accent: '#c13584',
    iconVariant: 'stroke',
    iconPath:
      'M7.75 2.75h8.5a5 5 0 0 1 5 5v8.5a5 5 0 0 1-5 5h-8.5a5 5 0 0 1-5-5v-8.5a5 5 0 0 1 5-5ZM12 7.25a4.75 4.75 0 1 0 0 9.5 4.75 4.75 0 0 0 0-9.5ZM17.4 6.6h.01',
  }),
  Object.freeze({
    id: 'tiktok',
    nameKey: 'landing.socialTikTok',
    accessibleLabelKey: 'landing.socialTikTok',
    url: 'https://www.tiktok.com/@worldofclaudecraft',
    accent: '#fe2c55',
    iconPath:
      'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07Z',
  }),
  Object.freeze({
    id: 'youtube',
    nameKey: 'landing.socialYouTube',
    accessibleLabelKey: 'landing.socialYouTube',
    url: 'https://www.youtube.com/@WoClaudeCraft',
    accent: '#ff0033',
    iconPath:
      'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814ZM9.545 15.568V8.432L15.818 12l-6.273 3.568Z',
  }),
  Object.freeze({
    id: 'reddit',
    nameKey: 'landing.socialReddit',
    accessibleLabelKey: 'landing.socialReddit',
    url: 'https://www.reddit.com/r/WorldofClaudecraft',
    accent: '#ff4500',
    iconPath:
      'M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.097 24 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0Zm4.388 3.199a2 2 0 1 1-1.947 2.462c-1.147.162-2.032 1.15-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363a2.802 2.802 0 1 1 2.908 4.753C19.915 17.381 16.366 20 12.006 20c-4.361 0-7.905-2.617-7.998-5.87a2.802 2.802 0 1 1 2.915-4.755c1.275-.79 2.881-1.291 4.64-1.365V8c0-1.663 1.263-3.034 2.88-3.207a2 2 0 0 1 1.945-1.594ZM8.303 11.575c-.784 0-1.459.78-1.506 1.797-.047 1.016.64 1.429 1.426 1.429.786 0 1.371-.369 1.418-1.385.047-1.017-.553-1.841-1.338-1.841Zm7.406 0c-.786 0-1.385.824-1.338 1.841.047 1.017.634 1.385 1.418 1.385.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797Zm-3.703 4.013c-.974 0-1.907.048-2.77.135-.147.015-.241.168-.183.305a3.196 3.196 0 0 0 5.906 0c.057-.137-.037-.29-.184-.305a27.5 27.5 0 0 0-2.769-.135Z',
  }),
  Object.freeze({
    id: 'github',
    nameKey: 'landing.socialGitHub',
    accessibleLabelKey: 'a11y.githubProject',
    badgeKey: 'landing.statSource',
    url: 'https://github.com/levy-street/world-of-claudecraft',
    accent: '#6e5494',
    iconPath:
      'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12Z',
  }),
]);

const SVG_NS = 'http://www.w3.org/2000/svg';
const DESKTOP_QUERY =
  '(min-width: 1181px) and (min-height: 820px) and (hover: hover) and (pointer: fine)';
export const SOCIAL_SPEECH_REVEAL_DELAY_MS = 10_000;
const SPEECH_VISIBLE_CLASS = 'social-tray__speech--visible';
const SPEECH_DISMISSED_SESSION_KEY = 'woc:social-speech-dismissed:v1';
let speechDismissedInMemory = false;

function localizeText(element: HTMLElement, key: TranslationKey): void {
  element.dataset.i18n = key;
  element.textContent = t(key);
}

function localizeAria(element: HTMLElement, key: TranslationKey): void {
  element.dataset.i18nAria = key;
  element.setAttribute('aria-label', t(key));
}

function createIcon(item: LandingSocialItem): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const path = document.createElementNS(SVG_NS, 'path');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (item.iconVariant === 'stroke') {
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.8');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
  } else {
    path.setAttribute('fill', 'currentColor');
  }
  path.setAttribute('d', item.iconPath);
  svg.append(path);
  return svg;
}

function hasSessionSpeechDismissal(): boolean {
  if (speechDismissedInMemory) return true;
  try {
    return window.sessionStorage.getItem(SPEECH_DISMISSED_SESSION_KEY) === 'true';
  } catch {
    return false;
  }
}

function rememberSessionSpeechDismissal(): void {
  speechDismissedInMemory = true;
  try {
    window.sessionStorage.setItem(SPEECH_DISMISSED_SESSION_KEY, 'true');
  } catch {
    // Storage can be unavailable in privacy-restricted contexts. The in-memory
    // fallback still keeps the bubble closed for the current document.
  }
}

function createSocialItem(item: LandingSocialItem, index: number, drawer: boolean): HTMLLIElement {
  const listItem = document.createElement('li');
  const link = document.createElement('a');
  const accessibleName = document.createElement('span');
  const emblem = document.createElement('span');
  const label = document.createElement('span');
  const name = document.createElement('span');

  link.className = drawer ? 'social-tray__drawer-link' : 'social-tray__link';
  link.href = item.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.dataset.socialId = item.id;
  link.style.setProperty('--social-accent', item.accent);
  link.style.setProperty('--social-index', String(index));
  listItem.style.setProperty('--social-delay', `${140 + index * 42}ms`);

  accessibleName.className = 'social-tray__sr-only';
  localizeText(accessibleName, item.accessibleLabelKey);

  emblem.className = 'social-tray__emblem';
  emblem.setAttribute('aria-hidden', 'true');
  emblem.append(createIcon(item));

  label.className = 'social-tray__label';
  label.setAttribute('aria-hidden', 'true');
  localizeText(name, item.nameKey);
  label.append(name);

  if (item.badgeKey) {
    const badge = document.createElement('small');
    badge.className = 'social-tray__badge';
    localizeText(badge, item.badgeKey);
    label.append(badge);
  }

  link.append(accessibleName, emblem, label);
  listItem.append(link);
  return listItem;
}

function createCharacterStage(compact = false): HTMLDivElement {
  const stage = document.createElement('div');
  stage.className = compact
    ? 'social-tray__character-stage social-tray__character-stage--compact'
    : 'social-tray__character-stage';
  stage.setAttribute('aria-hidden', 'true');

  if (compact) {
    const character = document.createElement('img');

    character.className = 'social-tray__mobile-character';
    character.src = '/site/social-tray/character.webp';
    character.width = 256;
    character.height = 393;
    character.alt = '';
    character.decoding = 'async';

    stage.append(character);
    return stage;
  }

  const crown = document.createElement('img');
  const character = document.createElement('img');

  crown.className = 'social-tray__crown';
  crown.src = '/site/social-tray/ivory-crown.webp';
  crown.width = 360;
  crown.height = 215;
  crown.alt = '';
  crown.decoding = 'async';

  character.className = 'social-tray__character';
  character.src = '/site/social-tray/character.webp';
  character.width = 256;
  character.height = 393;
  character.alt = '';
  character.decoding = 'async';

  stage.append(crown, character);
  return stage;
}

function createDesktopRail(): {
  desktop: HTMLElement;
  speechCloseButton: HTMLButtonElement;
} {
  const aside = document.createElement('aside');
  const nav = document.createElement('nav');
  const speech = document.createElement('div');
  const title = document.createElement('h2');
  const speechCloseButton = document.createElement('button');
  const closeGlyph = document.createElement('span');
  const shell = document.createElement('div');
  const list = document.createElement('ul');
  const finial = document.createElement('span');

  aside.className = 'social-tray social-tray--desktop';
  aside.dataset.socialTrayDesktop = '';
  title.id = 'social-tray-title';
  title.className = 'social-tray__speech-copy';
  localizeText(title, 'landing.followSocials');
  nav.setAttribute('aria-labelledby', title.id);

  speech.className = 'social-tray__speech';
  speechCloseButton.className = 'social-tray__speech-close';
  speechCloseButton.type = 'button';
  speechCloseButton.hidden = true;
  speechCloseButton.setAttribute('aria-describedby', title.id);
  localizeAria(speechCloseButton, 'skinEvent.close');
  closeGlyph.className = 'social-tray__speech-close-glyph';
  closeGlyph.setAttribute('aria-hidden', 'true');
  closeGlyph.textContent = '×';
  speechCloseButton.append(closeGlyph);
  speech.append(title, speechCloseButton);

  shell.className = 'social-tray__shell';
  list.className = 'social-tray__list';
  for (const [index, item] of LANDING_SOCIALS.entries()) {
    list.append(createSocialItem(item, index, false));
  }

  finial.className = 'social-tray__finial';
  finial.setAttribute('aria-hidden', 'true');
  shell.append(list, finial);
  nav.append(speech, createCharacterStage(), shell);
  aside.append(nav);
  return { desktop: aside, speechCloseButton };
}

function createLauncher(dialogId: string): HTMLButtonElement {
  const launcher = document.createElement('button');
  const bench = document.createElement('img');
  const plaque = document.createElement('span');
  const copy = document.createElement('span');
  const cue = document.createElement('span');

  launcher.className = 'social-tray__launcher';
  launcher.type = 'button';
  launcher.setAttribute('aria-expanded', 'false');
  launcher.setAttribute('aria-haspopup', 'dialog');
  launcher.setAttribute('aria-controls', dialogId);
  localizeAria(launcher, 'landing.followSocials');

  bench.className = 'social-tray__launcher-bench';
  bench.src = '/site/social-tray/mobile-social-bench-v2.webp';
  bench.width = 720;
  bench.height = 175;
  bench.loading = 'lazy';
  bench.alt = '';
  bench.decoding = 'async';
  bench.setAttribute('aria-hidden', 'true');

  copy.className = 'social-tray__launcher-copy';
  localizeText(copy, 'landing.followSocials');
  cue.className = 'social-tray__launcher-cue';
  cue.setAttribute('aria-hidden', 'true');
  plaque.className = 'social-tray__launcher-plaque';
  plaque.setAttribute('aria-hidden', 'true');
  plaque.append(copy, cue);
  launcher.append(bench, createCharacterStage(true), plaque);
  return launcher;
}

function createDrawer(dialogId: string): {
  closeButton: HTMLButtonElement;
  dialog: HTMLDialogElement;
} {
  const dialog = document.createElement('dialog');
  const drawer = document.createElement('section');
  const header = document.createElement('header');
  const heading = document.createElement('h2');
  const closeButton = document.createElement('button');
  const list = document.createElement('ul');

  dialog.id = dialogId;
  dialog.className = 'social-tray__dialog';

  drawer.className = 'social-tray__drawer';
  heading.id = `${dialogId}-title`;
  heading.tabIndex = -1;
  localizeText(heading, 'landing.followSocials');
  dialog.setAttribute('aria-labelledby', heading.id);

  closeButton.className = 'social-tray__close';
  closeButton.type = 'button';
  localizeAria(closeButton, 'skinEvent.close');

  header.className = 'social-tray__drawer-header';
  header.append(heading, closeButton);

  list.className = 'social-tray__drawer-list';
  for (const [index, item] of LANDING_SOCIALS.entries()) {
    list.append(createSocialItem(item, index, true));
  }

  drawer.append(header, list);
  dialog.append(drawer);
  return { closeButton, dialog };
}

export function mountLandingSocialTray(root: HTMLElement): void {
  if (root.dataset.socialTrayMounted === 'true') return;
  root.dataset.socialTrayMounted = 'true';

  const dialogId = 'social-tray-dialog';
  const { desktop, speechCloseButton } = createDesktopRail();
  const launcher = createLauncher(dialogId);
  const { closeButton, dialog } = createDrawer(dialogId);
  const desktopQuery = window.matchMedia(DESKTOP_QUERY);
  let restoreLauncherFocus = true;
  let speechRevealTimer: number | undefined;
  let speechHasRevealed = false;
  let speechDismissed = hasSessionSpeechDismissal();

  const clearSpeechTimer = (): void => {
    if (speechRevealTimer !== undefined) {
      window.clearTimeout(speechRevealTimer);
      speechRevealTimer = undefined;
    }
  };

  const hideSpeech = (): void => {
    desktop.classList.remove(SPEECH_VISIBLE_CLASS);
    speechCloseButton.hidden = true;
  };

  const showSpeech = (): void => {
    if (!desktopQuery.matches || speechDismissed) return;
    speechCloseButton.hidden = false;
    desktop.classList.add(SPEECH_VISIBLE_CLASS);
  };

  const scheduleSpeech = (): void => {
    clearSpeechTimer();
    hideSpeech();
    if (!desktopQuery.matches || speechDismissed) return;
    if (speechHasRevealed) {
      showSpeech();
      return;
    }

    speechRevealTimer = window.setTimeout(() => {
      speechRevealTimer = undefined;
      if (!desktopQuery.matches || !root.isConnected) return;
      speechHasRevealed = true;
      showSpeech();
    }, SOCIAL_SPEECH_REVEAL_DELAY_MS);
  };

  const setOpenState = (open: boolean): void => {
    launcher.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('social-tray-open', open);
  };

  const closeDrawer = (restoreFocus = true): void => {
    if (!dialog.open) return;
    restoreLauncherFocus = restoreFocus;
    dialog.close();
  };

  launcher.addEventListener('click', () => {
    if (dialog.open) return;
    restoreLauncherFocus = true;
    setOpenState(true);
    dialog.showModal();
    closeButton.focus();
  });

  closeButton.addEventListener('click', () => closeDrawer());
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeDrawer();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDrawer();
  });
  dialog.addEventListener('close', () => {
    setOpenState(false);
    if (restoreLauncherFocus && !desktopQuery.matches) launcher.focus();
  });

  speechCloseButton.addEventListener('click', () => {
    const restoreFocus = document.activeElement === speechCloseButton;
    speechDismissed = true;
    rememberSessionSpeechDismissal();
    clearSpeechTimer();
    hideSpeech();
    if (restoreFocus) {
      queueMicrotask(() =>
        desktop
          .querySelector<HTMLAnchorElement>('.social-tray__link')
          ?.focus({ preventScroll: true }),
      );
    }
  });

  desktopQuery.addEventListener('change', (event) => {
    if (event.matches) {
      scheduleSpeech();
    } else {
      clearSpeechTimer();
      hideSpeech();
    }

    if (event.matches && dialog.open) {
      closeDrawer(false);
      queueMicrotask(() => desktop.querySelector<HTMLAnchorElement>('a')?.focus());
    }
  });

  const panelObserver = new MutationObserver(() => {
    if (document.body.dataset.startPanel === 'mode-select') return;
    closeDrawer(false);
  });
  panelObserver.observe(document.body, { attributeFilter: ['data-start-panel'] });

  root.replaceChildren(desktop, launcher, dialog);
  scheduleSpeech();
  window.addEventListener('pagehide', clearSpeechTimer, { once: true });
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('site-social-tray-root');
  if (root) mountLandingSocialTray(root);
}
