import { Sim } from './sim/sim';
import { Renderer } from './render/renderer';
import { Input } from './game/input';
import { Keybinds } from './game/keybinds';
import { Settings, GameSettings, SETTING_RANGES, normalizeClickMoveButton } from './game/settings';
import { MobileControls, PHONE_TOUCH_QUERY, isPhoneTouchDevice } from './game/mobile_controls';
import { Hud } from './ui/hud';
import { audio } from './game/audio';
import { music } from './game/music';
import { handlePickedEntity, hoverCursorKind } from './game/interactions';
import { clickMoveShouldCancel, clickMoveStep, stepAngleToward } from './game/click_move';
import { Api, ClientWorld, CharacterSummary, type ReleaseEntry } from './net/online';
import type { IWorld, LeaderboardEntry } from './world_api';
import { formatXp } from './ui/xp_bar';
import { armoryProfileHtml } from './ui/armory';
import { assetsReady } from './render/assets/preload';
import { CharacterPreview } from './render/characters';
import { skinCount } from './render/characters/manifest';
import { DT, INTERACT_RANGE, PlayerClass, dist2d } from './sim/types';
import { togglePasswordVisibility, syncInputAriaState, validateForm, handleKeyboardActivation, validateCharacterName } from './ui/auth_utils';
import { CLASSES, ABILITIES } from './sim/content/classes';
import { iconDataUrl } from './ui/icons';
import { formatDateTime, formatNumber, getLanguage, isSupportedLanguage, languageTag, setLanguage, t, type SupportedLanguage, type TranslationKey } from './ui/i18n';
import { tServer } from './ui/server_i18n';
import { tEntity } from './ui/entity_i18n';
import { hydrateIcons } from './ui/ui_icons';
import { createPerfMonitor } from './game/perf';
import { updateFollowCameraYaw, wrapAngle } from './game/camera_follow';


const WORLD_SEED = 20061; // fixed: World of ClaudeCraft is a persistent place
const CLICK_MOVE_TURN_RATE = 4.2; // rad/sec; responsive turning while the camera stays decoupled from click spam
const HOMEPAGE_MUSIC_MUTED_KEY = 'woc_homepage_music_muted';
const HOMEPAGE_MUSIC_VOLUME = 0.225;

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T;
let pendingDeleteCharacter: CharacterSummary | null = null;
let homepageTrailer: HTMLVideoElement | null = null;
let homepageMusic: HTMLAudioElement | null = null;
let homepageMusicStarted = false;
let homepageMusicMuted = readHomepageMusicMuted();
let removeHomepageMusicGestureListeners: (() => void) | null = null;

const SITE_URL = 'https://worldofclaudecraft.com/';

const RESOURCE_KEYS = {
  mana: 'classDetails.resources.mana',
  energy: 'classDetails.resources.energy',
  rage: 'classDetails.resources.rage',
} satisfies Record<string, TranslationKey>;

function classDisplayName(className: PlayerClass): string {
  return tEntity({ kind: 'class', id: className, field: 'name' });
}

function classDisplayDescription(className: PlayerClass): string {
  return tEntity({ kind: 'class', id: className, field: 'description' });
}

function formatClassDetailNumber(value: number): string {
  return formatNumber(value, { maximumFractionDigits: 1 });
}

function classDetailAmountRange(min: number, max: number): string {
  if (min === max) return formatClassDetailNumber(min);
  return t('abilityUi.tooltip.damageRange', {
    min: formatClassDetailNumber(min),
    max: formatClassDetailNumber(max),
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return char;
    }
  });
}

function technicalErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function readHomepageMusicMuted(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(HOMEPAGE_MUSIC_MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

function saveHomepageMusicMuted(muted: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HOMEPAGE_MUSIC_MUTED_KEY, muted ? '1' : '0');
  } catch {
    // Private browsing or storage failures should not block the control.
  }
}

function userFacingApiError(err: unknown): string {
  const text = technicalErrorMessage(err);
  const suspended = text.match(/^This account is suspended until (.+)\.$/);
  if (suspended) return t('errors.api.accountSuspended', { date: suspended[1] });

  const normalized = text.toLowerCase();
  if (normalized.startsWith('too many attempts')) return t('errors.api.tooManyAttempts');
  if (normalized === 'username must be 3-24 chars (letters, digits, _)') return t('errors.api.usernameShape');
  if (normalized === 'username is not allowed') return t('errors.api.usernameNotAllowed');
  if (normalized === 'password must be at least 6 chars') return t('errors.api.passwordMin');
  if (normalized === 'username already taken') return t('errors.api.usernameTaken');
  if (normalized === 'invalid username or password') return t('errors.api.invalidCredentials');
  if (normalized === 'invalid character name (2-16 letters)') return t('errors.api.invalidCharacterName');
  if (normalized === 'character name is not allowed') return t('errors.api.characterNameNotAllowed');
  if (normalized === 'invalid class') return t('errors.api.invalidClass');
  if (normalized === 'character limit reached') return t('errors.api.characterLimit');
  if (normalized === 'that name is taken') return t('errors.api.nameTaken');
  if (normalized === 'character not found' || normalized === 'no such character' || normalized === 'not found') return t('errors.api.characterNotFound');
  if (normalized === 'character is currently online') return t('errors.api.characterOnline');
  if (normalized === 'type the character name to confirm deletion') return t('errors.api.deleteConfirm');
  if (normalized === 'not authenticated' || normalized === 'authentication required') return t('errors.api.notAuthenticated');
  if (normalized === 'this account has been banned.') return t('errors.api.accountBanned');
  if (normalized === 'character already in world') return t('errors.api.alreadyInWorld');
  if (normalized === 'this character must be renamed before entering the world.') return t('errors.api.renameBeforeEntering');
  // Cloudflare Turnstile rejection on login/register (server/main.ts passesTurnstile).
  if (normalized === 'verification failed, please try again') return t('errors.api.verificationFailed');
  // WebSocket disconnect reasons surfaced through the fatal overlay (net/online.ts).
  if (normalized === 'connection to the server was lost.') return t('loading.connectionLost');
  if (normalized === 'rejected by server') return t('loading.connectionRejected');
  // NOTE: protocol/transport diagnostics ('bad auth message', 'authentication timed out',
  // etc.) are intentionally NOT translated — they are developer/diagnostic errors and must
  // stay English so browser logs and support reports match the server source.
  // Moderation kicks and the login brute-force throttle (server/admin.ts, server/main.ts).
  if (normalized === 'this account is suspended.') return tServer('moderation.suspended');
  if (normalized === 'a moderator requires one of your characters to be renamed.') return tServer('moderation.forceRename');
  if (normalized.startsWith('too many failed attempts')) return tServer('moderation.tooManyFailed');
  // Transport/runtime failures are diagnostic code errors. Preserve their
  // English source text so browser logs and support reports match exactly.
  return text;
}

// --- Cloudflare Turnstile (bot gate on the login/register form) ---------------
// The site key is injected at build time; when it is empty (local/offline dev or
// a build without the env var) the widget never renders and the token is '', so
// the server — which also skips verification without its secret — lets requests
// through unchanged. The api.js <script> is in index.html.
const TURNSTILE_SITEKEY = String(import.meta.env.VITE_TURNSTILE_SITEKEY ?? '');

interface TurnstileApi {
  render: (el: string | HTMLElement, opts: { sitekey: string }) => string;
  getResponse: (widgetId?: string) => string | undefined;
  reset: (widgetId?: string) => void;
}
let turnstileWidgetId: string | undefined;

function turnstileApi(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile;
}

// Render the widget once, retrying until the async api.js script is ready. Safe to
// call repeatedly (idempotent) and a no-op when no site key is configured.
function ensureTurnstile(): void {
  if (!TURNSTILE_SITEKEY || turnstileWidgetId !== undefined) return;
  const ts = turnstileApi();
  const el = document.getElementById('cf-turnstile-container');
  if (!ts || !el) {
    window.setTimeout(ensureTurnstile, 200);
    return;
  }
  turnstileWidgetId = ts.render(el, { sitekey: TURNSTILE_SITEKEY });
}

// The current single-use token, or '' when verification is not configured / not
// yet solved. Tokens are consumed server-side, so reset after each attempt.
function turnstileToken(): string {
  const ts = turnstileApi();
  if (!TURNSTILE_SITEKEY || !ts || turnstileWidgetId === undefined) return '';
  return ts.getResponse(turnstileWidgetId) ?? '';
}

function resetTurnstile(): void {
  const ts = turnstileApi();
  if (ts && turnstileWidgetId !== undefined) ts.reset(turnstileWidgetId);
}

function localizedSiteUrl(lang: SupportedLanguage): string {
  if (lang === 'en') return SITE_URL;
  const url = new URL(SITE_URL);
  url.searchParams.set('lang', lang);
  return url.toString();
}

declare const __APP_VERSION__: string;
declare const __APP_BUILD_ID__: string;
declare const __APP_BUILD_DATE__: string;

function formatFooterVersion(version: string): string {
  return version.replace(/\.0$/, '');
}

function syncBuildInfo(): void {
  const el = document.getElementById('game-version');
  if (!el) return;
  el.textContent = `v${formatFooterVersion(__APP_VERSION__)} · build ${__APP_BUILD_ID__}`;
  el.title = t('meta.builtOn', { date: __APP_BUILD_DATE__ });
}

function syncAppViewport(): void {
  const useStableGameViewport = document.body.classList.contains('game-active') && isPhoneTouchDevice();
  const width = Math.max(1, Math.round(useStableGameViewport ? window.innerWidth : (window.visualViewport?.width ?? window.innerWidth)));
  const height = Math.max(1, Math.round(useStableGameViewport ? window.innerHeight : (window.visualViewport?.height ?? window.innerHeight)));
  document.documentElement.style.setProperty('--app-vw', `${width}px`);
  document.documentElement.style.setProperty('--app-vh', `${height}px`);
}

function preventMobileZoom(): void {
  let lastTouchEnd = 0;
  const prevent = (e: Event) => e.preventDefault();
  document.addEventListener('gesturestart', prevent, { passive: false });
  document.addEventListener('gesturechange', prevent, { passive: false });
  document.addEventListener('gestureend', prevent, { passive: false });
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 320) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });
}

function syncPhoneTouchClass(): void {
  document.body.classList.toggle('mobile-touch', isPhoneTouchDevice());
  syncCommunityMenuMode();
}

function syncCommunityMenuMode(): void {
  const communityMenu = document.getElementById('community-menu') as HTMLDetailsElement | null;
  if (!communityMenu) return;
  communityMenu.open = !isPhoneTouchDevice();
}

syncAppViewport();
syncBuildInfo();
preventMobileZoom();
syncPhoneTouchClass();
window.matchMedia(PHONE_TOUCH_QUERY).addEventListener?.('change', syncPhoneTouchClass);
window.addEventListener('resize', syncAppViewport);
window.addEventListener('orientationchange', () => {
  syncAppViewport();
  window.setTimeout(syncAppViewport, 250);
  window.setTimeout(syncAppViewport, 800);
});
window.visualViewport?.addEventListener('resize', syncAppViewport);
document.addEventListener('fullscreenchange', syncAppViewport);

function requestMobileFullscreenLandscape(): void {
  if (!isPhoneTouchDevice()) return;
  const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
  try {
    const request = root.requestFullscreen?.bind(root) ?? root.webkitRequestFullscreen?.bind(root);
    const result = request?.();
    if (result && typeof (result as Promise<void>).catch === 'function') void (result as Promise<void>).catch(() => {});
  } catch { /* browser declined fullscreen */ }
  try {
    const orientation = screen.orientation as ScreenOrientation & { lock?: (orientation: string) => Promise<void> };
    void orientation.lock?.('landscape').catch(() => {});
  } catch { /* browser declined orientation lock */ }
}

function mobilePlatform(): 'ios' | 'android' | 'other' {
  const ua = navigator.userAgent;
  const platform = navigator.platform;
  if (/iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

function isStandaloneDisplay(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function mobilePreflightCopy(): { detail: string; steps: string[] } {
  const standalone = isStandaloneDisplay();
  const base = [
    t('mobilePreflight.baseLandscape'),
    t('mobilePreflight.basePerformance'),
  ];
  if (mobilePlatform() === 'ios') {
    return {
      detail: standalone
        ? t('mobilePreflight.iosStandaloneDetail')
        : t('mobilePreflight.iosInstallDetail'),
      steps: standalone
        ? base
        : [
          t('mobilePreflight.iosShareStep'),
          t('mobilePreflight.iosOpenStep'),
          ...base,
        ],
    };
  }
  if (mobilePlatform() === 'android') {
    return {
      detail: standalone
        ? t('mobilePreflight.androidStandaloneDetail')
        : t('mobilePreflight.androidInstallDetail'),
      steps: standalone
        ? base
        : [
          t('mobilePreflight.androidInstallStep'),
          t('mobilePreflight.androidOpenStep'),
          ...base,
        ],
    };
  }
  return {
    detail: standalone
      ? t('mobilePreflight.otherStandaloneDetail')
      : t('mobilePreflight.otherInstallDetail'),
    steps: base,
  };
}

let mobilePreflightPromptPromise: Promise<void> | null = null;

function showMobilePreflightPrompt(): Promise<void> {
  if (!isPhoneTouchDevice()) return Promise.resolve();
  if (mobilePreflightPromptPromise) return mobilePreflightPromptPromise;
  const prompt = document.getElementById('mobile-preflight') as HTMLElement | null;
  const detail = document.getElementById('mobile-preflight-detail') as HTMLElement | null;
  const steps = document.getElementById('mobile-preflight-steps') as HTMLOListElement | null;
  const continueBtn = document.getElementById('mobile-preflight-continue') as HTMLButtonElement | null;
  if (!prompt || !detail || !steps || !continueBtn) return Promise.resolve();

  const copy = mobilePreflightCopy();
  detail.textContent = copy.detail;
  steps.replaceChildren(...copy.steps.map((text) => {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  }));

  document.body.classList.add('mobile-preflight-open', 'mobile-touch');
  prompt.style.display = 'flex';
  prompt.classList.add('visible');
  mobilePreflightPromptPromise = new Promise((resolve) => {
    continueBtn.onclick = () => {
      requestMobileFullscreenLandscape();
      syncAppViewport();
      window.setTimeout(syncAppViewport, 250);
      window.setTimeout(syncAppViewport, 800);
      hideMobilePreflightPrompt();
      mobilePreflightPromptPromise = null;
      resolve();
    };
  });
  return mobilePreflightPromptPromise;
}

function hideMobilePreflightPrompt(): void {
  const prompt = document.getElementById('mobile-preflight') as HTMLElement | null;
  prompt?.classList.remove('visible');
  if (prompt) prompt.style.display = '';
  document.body.classList.remove('mobile-preflight-open');
}

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

function currentFullscreenElement(): Element | null {
  const doc = document as FullscreenDocument;
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

function requestBrowserFullscreen(): void {
  if (currentFullscreenElement()) return;
  const root = document.documentElement as FullscreenElement;
  const request = root.requestFullscreen?.bind(root) ?? root.webkitRequestFullscreen?.bind(root);
  if (!request) return;
  try {
    const result = request();
    if (result instanceof Promise) void result.catch(() => {});
  } catch {
    // Browsers can reject fullscreen outside a direct user gesture.
  }
}

function exitBrowserFullscreen(): void {
  if (!currentFullscreenElement()) return;
  const doc = document as FullscreenDocument;
  try {
    const result = document.exitFullscreen?.() ?? doc.webkitExitFullscreen?.();
    if (result instanceof Promise) void result.catch(() => {});
  } catch {
    // Fullscreen exit can also reject while the document is changing state.
  }
}

function requestPreferredFullscreen(): void {
  if (isPhoneTouchDevice()) {
    requestMobileFullscreenLandscape();
    return;
  }
  if (new Settings().get('fullscreen') >= 0.5) requestBrowserFullscreen();
}

// ---------------------------------------------------------------------------
// Loading screen (shown from "enter world" until the first frame renders)
// ---------------------------------------------------------------------------

const LOADING_FADE_MS = 350; // keep in sync with the #loading-screen CSS transition

let loadingHideTimer: number | null = null;

function showLoadingScreen(statusText: string): void {
  const el = $('#loading-screen');
  if (loadingHideTimer !== null) {
    window.clearTimeout(loadingHideTimer);
    loadingHideTimer = null;
  }
  el.classList.remove('fade');
  el.classList.add('visible');
  setLoadingStatus(statusText);
}

function setLoadingStatus(text: string): void {
  $('#ls-status').textContent = text;
}

function setLoadingProgress(done: number, total: number): void {
  $('#ls-fill').style.width = total > 0 ? `${Math.round((done / total) * 100)}%` : '0%';
  setLoadingStatus(t('loading.worldProgress', { done, total }));
}

function hideLoadingScreen(): void {
  const el = $('#loading-screen');
  if (!el.classList.contains('visible')) return;
  el.classList.add('fade');
  loadingHideTimer = window.setTimeout(() => {
    el.classList.remove('visible', 'fade');
    loadingHideTimer = null;
  }, LOADING_FADE_MS);
}

// Resolve only after the browser has actually painted. The scene build
// (new Renderer/new Hud) runs fully synchronously and blocks the main thread,
// so without a real paint first the loading screen never shows on warm loads
// (cached assets ⇒ assetsReady resolves on a microtask) and entry looks frozen.
// Two rAFs guarantee a paint happened between them — same idiom used to cut to
// the game on the first rendered frame below.
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

// The loading screen blocks pointer input but a covered button keeps keyboard
// focus, so Enter/Space could re-fire it mid-entry. One entry per page load;
// every failure path recovers via fatalOverlay's reload.
let hasBegunWorldEntry = false;

function beginWorldEntry(): boolean {
  if (hasBegunWorldEntry) return false;
  hasBegunWorldEntry = true;
  return true;
}

function enterLoadingState(statusText: string): void {
  hideMobilePreflightPrompt();
  showLoadingScreen(statusText);
  $('#start-screen').style.display = 'none';
  // The homepage is hidden once we enter the world — stop decoding the trailer.
  if (homepageTrailer) homepageTrailer.pause();
}

async function prepareWorldEntry(): Promise<boolean> {
  if (hasBegunWorldEntry) return false;
  if (isPhoneTouchDevice()) {
    await showMobilePreflightPrompt();
  } else {
    requestPreferredFullscreen();
  }
  syncAppViewport();
  window.setTimeout(syncAppViewport, 250);
  window.setTimeout(syncAppViewport, 800);
  return beginWorldEntry();
}

function mountGameUi(): void {
  if (document.getElementById('ui')) return;
  const template = document.getElementById('game-ui-template') as HTMLTemplateElement | null;
  const startScreen = document.getElementById('start-screen');
  if (!template || !startScreen) throw new Error('Game UI shell is missing.');
  document.body.insertBefore(template.content.cloneNode(true), startScreen);
  translatePage();
  syncCommunityMenuMode();
}

// ---------------------------------------------------------------------------
// Shared game wiring (used by both offline sim and online world)
// ---------------------------------------------------------------------------

async function startGame(world: IWorld, offlineSim: Sim | null, online: ClientWorld | null): Promise<void> {
  // Model/texture/HDRI fetches were kicked off at module import; the renderer
  // builds its scene synchronously, so everything must be resolved first.
  // The loading screen covers the gap - not a silent black screen.
  enterLoadingState(t('loading.world'));
  document.body.classList.add('game-active');
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  // Paint the loading screen before anything can block — assetsReady may resolve
  // immediately when assets are already cached, and the scene build is synchronous.
  await nextPaint();
  try {
    await assetsReady((done, total) => setLoadingProgress(done, total));
  } catch (err) {
    fatalOverlay(t('loading.assetsFailed', { error: technicalErrorMessage(err) }));
    return;
  }
  setLoadingStatus(t('loading.enteringWorld'));
  // Let the final status + full progress bar paint before the synchronous
  // Renderer/Hud build freezes the main thread for a beat.
  await nextPaint();
  mountGameUi();

  const canvas = $('#game-canvas') as unknown as HTMLCanvasElement;
  const nameplates = $('#nameplates') as HTMLDivElement;

  const keybinds = new Keybinds();
  const settings = new Settings();
  let renderer!: Renderer;
  let hud!: Hud;
  const perf = createPerfMonitor(null);
  try {
    renderer = new Renderer(world, canvas, nameplates);
    perf.setRenderer(renderer);
    hud = new Hud(world, renderer, keybinds);
    perf.setHud(hud);
    hydrateIcons(); // swap [data-icon] placeholders (micro-menu, mobile bar, meters) for inline SVG
  } catch (err) {
    // e.g. WebGL context creation failure: surface it instead of leaving the
    // loading screen up forever
    fatalOverlay(t('loading.rendererFailed', { error: technicalErrorMessage(err) }));
    return;
  }

  const chatInput = $('#chat-input') as unknown as HTMLInputElement;
  const clickMoveMarker = $('#click-move-marker') as HTMLDivElement;
  const recoverFromMobileKeyboard = (): void => {
    document.body.classList.remove('mobile-chat-open');
    syncAppViewport();
    window.scrollTo(0, 0);
    window.setTimeout(() => { syncAppViewport(); window.scrollTo(0, 0); }, 120);
    window.setTimeout(() => { syncAppViewport(); window.scrollTo(0, 0); }, 450);
  };
  const closeChat = (): void => {
    chatInput.value = '';
    chatInput.style.display = 'none';
    chatInput.blur();
    recoverFromMobileKeyboard();
  };
  function openChat(): void {
    chatInput.style.display = 'block';
    chatInput.focus();
  }
  chatInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const text = chatInput.value.trim();
      if (text) world.chat(text);
      closeChat();
    } else if (e.key === 'Escape') {
      closeChat();
    }
  });
  chatInput.addEventListener('blur', () => {
    if (chatInput.style.display === 'none') recoverFromMobileKeyboard();
  });

  const input = new Input(canvas, {
    onTab: () => world.tabTarget(),
    onTargetFriendly: () => world.targetNearestFriendly(),
    onCycleFriendly: () => world.friendlyTabTarget(),
    // slot 0 (key 1) is Attack for every class — auto-attack without needing
    // right-click; keys and clicks share the Hud's remappable slot layout
    onAbility: (slot) => hud.castSlot(slot),
    onInputIntent: (kind) => perf.markInputIntent(kind),
    onUiKey: (key) => {
      switch (key) {
        case 'interact': interactKey(); break;
        case 'bags': hud.toggleBags(); break;
        case 'char': hud.toggleChar(); break;
        case 'spellbook': hud.toggleSpellbook(); break;
        case 'questlog': hud.toggleQuestLog(); break;
        case 'map': hud.toggleMap(); break;
        case 'nameplates': renderer.showNameplates = !renderer.showNameplates; break;
        case 'talents': hud.toggleTalents(); break;
        case 'meters': hud.toggleMeters(); break;
        case 'social': hud.toggleSocial(); break;
        case 'arena': hud.toggleArena(); break;
        case 'leaderboard': hud.toggleLeaderboard(); break;
        case 'chat': openChat(); break;
        case 'escape':
          // close the topmost panel; if nothing was open, open the game menu
          if (!hud.closeAll()) hud.toggleOptionsMenu();
          break;
      }
    },
    onEmoteWheel: (open) => hud.setEmoteWheelOpen(open),
    onClickPick: (x, y, button) => handlePick(x, y, button),
    canUseGameKeys: () => !hud.isModalOpen() && chatInput.style.display !== 'block',
  }, keybinds);
  input.camYaw = world.player.facing;

  const mobileControls = new MobileControls(input, {
    onAttackNearest: () => attackNearest(),
    onJump: () => input.triggerTouchJump(),
    onTarget: () => world.tabTarget(),
    onInteract: () => interactKey(),
    onAutorun: () => input.toggleAutorun(),
    onChat: () => openChat(),
    onMenu: () => hud.toggleOptionsMenu(),
    onSocial: () => hud.toggleSocial(),
    onEmotes: () => hud.toggleEmoteWheel(),
    onArena: () => hud.toggleArena(),
    onQuestLog: () => hud.toggleQuestLog(),
    onCharacter: () => hud.toggleChar(),
    onBags: () => hud.toggleBags(),
    onSpellbook: () => hud.toggleSpellbook(),
    onTalents: () => hud.toggleTalents(),
    onMap: () => hud.toggleMap(),
    onLeaderboard: () => hud.toggleLeaderboard(),
    onNameplates: () => (renderer.showNameplates = !renderer.showNameplates),
    onMusic: () => {
      music.setEnabled(!music.enabled);
      return music.enabled;
    },
  });
  mobileControls.start();
  // reflect the current music state on the touch toggle (it may already be off
  // from a prior session, persisted in localStorage)
  document.getElementById('mobile-music')?.classList.toggle('mm-muted', !music.enabled);

  // apply a setting to its live subsystem (also used to apply all on startup)
  function syncClickMoveInput(): void {
    input.setClickMoveMouseButton(settings.get('clickToMove') > 0
      ? normalizeClickMoveButton(settings.get('clickToMoveButton'))
      : null);
  }

  function applySetting(key: keyof GameSettings, value: number | boolean): void {
    if (key === 'mouseCamera') {
      const v = settings.set('mouseCamera', !!value);
      input.setMouseCameraEnabled(v);
      return;
    }
    if (key === 'leftHandedTouch') {
      const v = settings.set('leftHandedTouch', !!value);
      document.body.classList.toggle('mobile-left-handed', v);
      return;
    }
    if (key === 'filterProfanity') {
      settings.set('filterProfanity', !!value);
      return;
    }
    const v = settings.set(key as keyof typeof SETTING_RANGES, value as number);
    switch (key) {
      case 'cameraSpeed': input.setCameraSpeed(v); break;
      case 'touchLookSpeed': input.setTouchLookSpeed(v); break;
      case 'sfxVolume': audio.setVolume(v); break;
      case 'musicVolume': music.setVolume(v); break;
      case 'brightness': renderer.setBrightness(v); break;
      case 'renderScale': renderer.setRenderScale(v); break;
      case 'fullscreen': v >= 0.5 ? requestPreferredFullscreen() : exitBrowserFullscreen(); break;
      case 'clickToMove': if (v < 0.5) input.clearClickMove(); syncClickMoveInput(); break;
      case 'clickToMoveButton': syncClickMoveInput(); break;
      case 'touchOpacity': document.documentElement.style.setProperty('--touch-opacity', String(v)); break;
    }
  }
  // apply persisted settings to the freshly-built subsystems
  const saved = settings.all();
  for (const k of Object.keys(saved) as (keyof GameSettings)[]) applySetting(k, saved[k]);

  // the options menu drives logout + key-capture + settings, all of which need
  // refs that only exist now (input/renderer) or are page-level (reload)
  hud.attachOptions({
    logout: () => location.reload(),
    captureKey: (cb) => input.captureNextKey(cb),
    settings,
    onSettingChange: (key, value) => applySetting(key, value),
  });
  if (online) {
    hud.attachReporting({
      submit: (targetPid, reason, details) => api.reportPlayer(online.characterId, targetPid, reason, details),
      submitByName: (targetName, reason, details) => api.reportPlayerByName(online.characterId, targetName, reason, details),
    });
  }

  function interactKey(): void {
    const p = world.player;
    let bestCorpse: number | null = null, bestCorpseD = INTERACT_RANGE;
    let bestObj: number | null = null, bestObjD = INTERACT_RANGE;
    let bestNpc: number | null = null, bestNpcD = INTERACT_RANGE + 1;
    for (const e of world.entities.values()) {
      const d = dist2d(p.pos, e.pos);
      if (e.kind === 'mob' && e.lootable && d < bestCorpseD) { bestCorpse = e.id; bestCorpseD = d; }
      if (e.kind === 'object' && e.lootable && d < bestObjD) { bestObj = e.id; bestObjD = d; }
      if (e.kind === 'npc' && d < bestNpcD) { bestNpc = e.id; bestNpcD = d; }
    }
    if (bestCorpse !== null) { world.lootCorpse(bestCorpse); return; }
    if (bestObj !== null) {
      const obj = world.entities.get(bestObj)!;
      if (obj.templateId === 'dungeon_door' && obj.dungeonId) { world.enterDungeon(obj.dungeonId); return; }
      if (obj.templateId === 'dungeon_exit') { world.leaveDungeon(); return; }
      world.pickUpObject(bestObj);
      return;
    }
    if (bestNpc !== null) { hud.openQuestDialog(bestNpc); return; }
    hud.showError(t('errors.nothingInteract'));
  }

  function attackNearest(): void {
    const p = world.player;
    let best: number | null = null;
    let bestD = 40;
    for (const e of world.entities.values()) {
      if (e.kind !== 'mob' || e.dead || !e.hostile) continue;
      const d = dist2d(p.pos, e.pos);
      if (d < bestD) { best = e.id; bestD = d; }
    }
    if (best === null) { hud.showError(t('errors.noEnemyNearby')); return; }
    world.targetEntity(best);
    world.startAutoAttack();
  }

  function handlePick(x: number, y: number, button: number): void {
    const id = renderer.pick(x, y);
    const clickToMove = settings.get('clickToMove') > 0 && !world.player.dead;
    const clickToMoveButton = normalizeClickMoveButton(settings.get('clickToMoveButton'));
    const isClickMoveButton = clickToMove && button === clickToMoveButton;
    if (id === null) {
      if (button === 0) {
        world.targetEntity(null);
      }
      if (isClickMoveButton) {
        const g = renderer.groundPoint(x, y, world.player.pos.y);
        if (g) input.setClickMoveTarget(g, 0.5);
      }
      return;
    }
    // The configured click-to-move mouse button approaches entities while the
    // regular click handler still performs target/interact behavior.
    if (isClickMoveButton) {
      const e = world.entities.get(id);
      if (e && e.id !== world.player.id) input.setClickMoveTarget({ x: e.pos.x, z: e.pos.z }, 3.5, e.id);
    }
    handlePickedEntity(world, hud, id, button, x, y);
  }

  let lastClickMoveMarkerPulse = -1;
  let clickMoveMarkerHideAt = 0;
  function updateClickMoveMarker(nowMs = performance.now()): void {
    const pulseChanged = lastClickMoveMarkerPulse !== input.clickMovePulse;
    if (pulseChanged) {
      lastClickMoveMarkerPulse = input.clickMovePulse;
      clickMoveMarkerHideAt = nowMs + 300;
    }
    const target = input.clickMoveTarget ?? input.clickMovePulseTarget;
    const show = !!target && settings.get('clickToMove') > 0 && !world.player.dead
      && (!!input.clickMoveTarget || nowMs < clickMoveMarkerHideAt);
    if (!show) {
      clickMoveMarker.classList.remove('active', 'entity', 'pulse');
      return;
    }
    const screen = renderer.worldToScreen(target.x, world.player.pos.y + 0.05, target.z);
    const offscreen = screen.behind
      || screen.x < -80 || screen.x > window.innerWidth + 80
      || screen.y < -80 || screen.y > window.innerHeight + 80;
    if (offscreen) {
      clickMoveMarker.classList.remove('active', 'pulse');
      return;
    }
    clickMoveMarker.style.transform = `translate(${screen.x.toFixed(0)}px, ${screen.y.toFixed(0)}px) translate(-50%, -50%)`;
    clickMoveMarker.classList.toggle('entity', input.clickMoveEntityId !== null);
    clickMoveMarker.classList.add('active');
    if (pulseChanged || clickMoveMarker.dataset.pulse !== String(input.clickMovePulse)) {
      clickMoveMarker.dataset.pulse = String(input.clickMovePulse);
      clickMoveMarker.classList.remove('pulse');
      void clickMoveMarker.offsetWidth;
      clickMoveMarker.classList.add('pulse');
    }
  }

  let last = performance.now();
  let acc = 0;

  // Camera follow state: keyboard turning advances facing in 20Hz sim steps,
  // so the camera tracks the player's render-interpolated facing per frame
  // (same curve the character model follows) instead of the raw tick deltas -
  // that's what killed the turn stutter. While running, the orbit offset
  // eases back to zero so the camera settles in behind the character.
  let lastInterpFacing: number | null = null;
  function updateCamera(frameDt: number, interpFacing: number): void {
    const mi = input.readMoveInput();
    const clickMoving = !!input.clickMoveTarget && !input.suspendMovement && !world.player.dead;
    const next = updateFollowCameraYaw({
      camYaw: input.camYaw,
      interpFacing,
      frameDt,
      lastInterpFacing,
      mouselook: input.isMouselookActive(),
      moving: mi.forward || mi.strafeLeft || mi.strafeRight || clickMoving,
      clickMoving,
      orbiting: input.leftDown && input.isCameraDragActive(),
    });
    input.camYaw = next.camYaw;
    lastInterpFacing = next.lastInterpFacing; // track through mouselook too — no snap on release
  }

  // Resolve this step's movement input, folding in click-to-move (#95). Returns
  // the move flags plus an optional forced facing (mouselook angle, or the
  // bearing toward a click-to-move destination). Any manual movement, an open
  // modal, mouselook, death, or the option being switched off cancels click-to-move.
  function resolveMove(mouselook: boolean, playerPos: { x: number; z: number }, playerFacing: number):
    { mi: ReturnType<typeof input.readMoveInput>; facing: number | null } {
    const mi = input.readMoveInput();
    let facing: number | null = mouselook ? input.camYaw : null;
    if (input.clickMoveTarget) {
      if (clickMoveShouldCancel(mi, {
        mouselook,
        movementSuspended: input.suspendMovement,
        playerDead: world.player.dead,
        enabled: settings.get('clickToMove') > 0,
      })) {
        input.clearClickMove();
      } else {
        if (input.clickMoveEntityId !== null) {
          const e = world.entities.get(input.clickMoveEntityId);
          if (!e || e.dead || e.id === world.player.id) {
            input.clearClickMove();
            return { mi, facing };
          }
          input.clickMoveTarget = { x: e.pos.x, z: e.pos.z };
        }
        const step = clickMoveStep(playerPos, input.clickMoveTarget, input.clickMoveStop);
        if (step.arrived) {
          input.clearClickMove();
        } else {
          mi.forward = true;
          const fromFacing = input.clickMoveFacing ?? playerFacing;
          const smoothFacing = stepAngleToward(fromFacing, step.facing, CLICK_MOVE_TURN_RATE * DT);
          input.clickMoveFacing = smoothFacing;
          facing = smoothFacing;
        }
      }
    }
    return { mi, facing };
  }

  function partyMemberIds(): Set<number> {
    const ids = new Set<number>();
    for (const m of world.partyInfo?.members ?? []) {
      if (m.pid !== world.playerId) ids.add(m.pid);
    }
    return ids;
  }

  function updateHoverCursor(): void {
    if (!input.hoverActive || input.isDragging() || hud.isModalOpen()) {
      input.setHoverCursor('default');
      return;
    }
    const id = renderer.pick(input.hoverX, input.hoverY);
    const entity = id !== null ? world.entities.get(id) : undefined;
    input.setHoverCursor(hoverCursorKind(entity, world.playerId, partyMemberIds()));
  }

  function cameraMoveActive(): boolean {
    if (!input.isMouseCameraMode()) return false;
    const mi = input.readMoveInput();
    return !!(mi.forward || mi.back || mi.strafeLeft || mi.strafeRight) && !world.player.dead;
  }

  function renderFacingOverride(): number | null {
    if (input.isMouseCameraMode()) {
      return cameraMoveActive() ? input.camYaw : null;
    }
    return input.isMouselookActive() && !world.player.dead ? input.camYaw : null;
  }

  function frame(now: number): void {
    requestAnimationFrame(frame);
    let frameDt = (now - last) / 1000;
    last = now;
    if (frameDt > 0.25) frameDt = 0.25;
    perf.frame(frameDt);

    // freeze movement while the game menu is up so WASD doesn't walk the
    // character behind it (other windows stay non-modal, as before)
    input.suspendMovement = hud.isModalOpen();
    input.updateTouchLook(frameDt);
    updateHoverCursor();
    perf.markInputFrame(performance.now());

    const mouselook = input.isMouselookActive() && !world.player.dead;
    const controllerFacing = input.controllerFacingOverride();
    const renderFacing = renderFacingOverride();
    const movementFacing = !world.player.dead ? (renderFacing ?? controllerFacing) : null;

    if (offlineSim) {
      acc += frameDt;
      while (acc >= DT) {
        const { mi, facing } = resolveMove(mouselook, offlineSim.player.pos, offlineSim.player.facing);
        Object.assign(offlineSim.moveInput, mi);
        const stepFacing = movementFacing ?? facing;
        if (stepFacing !== null) offlineSim.player.facing = stepFacing;
        perf.markInputSent(performance.now());
        const events = perf.time('sim', () => offlineSim.tick());
        perf.time('events', () => hud.handleEvents(events));
        acc -= DT;
      }
      const pp = offlineSim.player;
      updateCamera(frameDt, pp.prevFacing + wrapAngle(pp.facing - pp.prevFacing) * (acc / DT));
      renderer.camYaw = input.camYaw;
      renderer.camPitch = input.camPitch;
      renderer.camDist = input.camDist;
      perf.setNetwork(null);
      perf.time('renderer', () => renderer.sync(acc / DT, frameDt, movementFacing));
      updateClickMoveMarker();
      perf.markInputVisible(performance.now());
      perf.time('hud', () => hud.update());
      perf.tick(now);
      return;
    }

    // online: inputs stream on a timer inside ClientWorld; here we mirror state
    const net = online!;
    const resolved = resolveMove(mouselook, world.player.pos, world.player.facing);
    const netFacing = movementFacing ?? resolved.facing;
    Object.assign(net.moveInput, resolved.mi);
    net.setMouselookFacing(netFacing);
    if (net.flushInput()) perf.markInputSent(performance.now());
    for (const sample of net.consumeInputEchoSamples()) perf.markInputEcho(sample);
    net.pendingFacingDelta = 0; // superseded by the interpolated follow below
    perf.time('events', () => hud.handleEvents(net.drainEvents()));
    if (net.consumeProfanityChanged()) hud.setProfanityWords(net.profanityWords);
    if (net.consumeInventoryChanged()) hud.onInventoryChanged();
    const alpha = net.lastSnapAt > 0
      ? Math.min(1.25, (performance.now() - net.lastSnapAt) / Math.max(20, net.snapInterval))
      : 1;
    perf.setNetwork({
      connected: net.connected,
      snapInterval: Math.round(net.snapInterval),
      lastSnapAge: net.lastSnapAt > 0 ? Math.round(performance.now() - net.lastSnapAt) : -1,
      alpha: Math.round(alpha * 100) / 100,
    });
    const pe = world.player;
    // facing interp capped at 1 - extrapolating angles past the snapshot oscillates
    updateCamera(frameDt, pe.prevFacing + wrapAngle(pe.facing - pe.prevFacing) * Math.min(1, alpha));
    renderer.camYaw = input.camYaw;
    renderer.camPitch = input.camPitch;
    renderer.camDist = input.camDist;
    perf.time('renderer', () => renderer.sync(alpha, frameDt, movementFacing));
    updateClickMoveMarker();
    perf.markInputVisible(performance.now());
    perf.time('hud', () => hud.update());
    perf.tick(now);
  }
  requestAnimationFrame(frame);
  // cut to the game only once the first frame is actually on screen
  requestAnimationFrame(() => requestAnimationFrame(() => hideLoadingScreen()));
  // Now in-game: fade the home-page theme out (it kept playing through loading).
  fadeOutHomepageMusic();

  const controller = {
    move(moveInput: unknown, facing?: unknown) {
      if (arguments.length > 1) input.setControllerMoveInput(moveInput, facing);
      else input.setControllerMoveInput(moveInput);
    },
    face(facing: unknown) { input.setControllerFacing(facing); },
    stop() { input.clearControllerMoveInput(); },
  };
  (window as any).__game = { sim: world, world, renderer, input, hud, online, controller, perf };
}

// ---------------------------------------------------------------------------
// Offline flow
// ---------------------------------------------------------------------------

// Offline names go straight into innerHTML paths (quest $N text, char window
// title), so enforce the server's character-name rule client-side too:
// strip anything outside [A-Za-z' -], then require /^[A-Za-z][A-Za-z' -]{1,15}$/.
function sanitizeOfflineName(raw: string): string {
  const stripped = raw.replace(/[^A-Za-z' -]/g, '').replace(/^[^A-Za-z]+/, '').slice(0, 16);
  return /^[A-Za-z][A-Za-z' -]{1,15}$/.test(stripped) ? stripped : 'Adventurer';
}

async function startOffline(playerClass: PlayerClass, name: string, skin = 0): Promise<void> {
  if (!(await prepareWorldEntry())) return;
  enterLoadingState(t('loading.world'));
  const sim = new Sim({ seed: WORLD_SEED, playerClass, playerName: name });
  sim.setPlayerSkin(sim.playerId, skin);
  void startGame(sim, sim, null);
}

// ---------------------------------------------------------------------------
// Online flow: login -> character select -> world
// ---------------------------------------------------------------------------

const api = new Api();

let activeTransitionTimeout: number | null = null;
let activeTransitionCleanup: (() => void) | null = null;
let characterPreview: CharacterPreview | null = null;
let offlineSkin = 0; // chosen appearance skin for the offline quick-start character
let onlineSkin = 0; // chosen appearance skin for new online characters

/** Fill a skin-picker row with one swatch per available skin for the class. */
function renderSkinPicker(rowId: string, cls: PlayerClass, current: number, onPick: (i: number) => void): void {
  const row = $(rowId) as HTMLElement | null;
  if (!row) return;
  row.innerHTML = '';
  const count = skinCount(`player_${cls}`);
  if (count <= 1) return; // only the default exists — nothing to pick
  for (let i = 0; i < count; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'skin-swatch' + (i === current ? ' sel' : '');
    b.dataset.skin = String(i);
    b.textContent = String(i + 1);
    b.setAttribute('role', 'listitem');
    b.setAttribute('aria-label', `Skin ${i + 1}`);
    b.addEventListener('click', () => {
      row.querySelectorAll('.skin-swatch').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      onPick(i);
    });
    row.appendChild(b);
  }
}

function selectedSkin(rowId: string, fallback: number): number {
  const selected = document.querySelector(`${rowId} .skin-swatch.sel`) as HTMLElement | null;
  const raw = selected?.dataset.skin;
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Reset to the default skin and (re)render the offline picker for a class. */
function refreshOfflineSkins(cls: PlayerClass): void {
  offlineSkin = 0;
  characterPreview?.setSkin(0);
  renderSkinPicker('#offline-skin-row', cls, 0, (i) => {
    offlineSkin = i;
    characterPreview?.setSkin(i);
  });
}

/** Reset to the default skin and (re)render the online creation picker for a class. */
function refreshOnlineSkins(cls: PlayerClass): void {
  onlineSkin = 0;
  characterPreview?.setSkin(0);
  renderSkinPicker('#online-skin-row', cls, 0, (i) => {
    onlineSkin = i;
    characterPreview?.setSkin(i);
  });
}

function updatePreviewContainer(panelId: string): void {
  if (!characterPreview) return;
  const containerId = panelId === '#charselect-panel' ? '#online-preview-container' : '#offline-preview-container';
  const container = $(containerId);
  if (container) {
    characterPreview.setContainer(container);
    
    const selSelector = panelId === '#charselect-panel' 
      ? '#charselect-panel .mini-class.sel' 
      : '#offline-select .mini-class.sel';
    const selEl = document.querySelector(selSelector) as HTMLElement | null;
    if (selEl) {
      const cls = selEl.dataset.class as PlayerClass;
      characterPreview.setClass(cls);
      if (panelId === '#charselect-panel') refreshOnlineSkins(cls);
      else refreshOfflineSkins(cls);
    }
  }
}

const currentlyRenderedClass: Record<string, PlayerClass | null> = {
  'offline-class-details': null,
  'online-class-details': null
};
const revertTimeouts: Record<string, number | null> = {
  'offline-class-details': null,
  'online-class-details': null
};
const hoverTimeouts: Record<string, number | null> = {
  'offline-class-details': null,
  'online-class-details': null
};

function switchMainView(targetId: string): void {
  const views = ['#hero-view', '#highscores-view', '#wiki-view', '#news-view', '#download-view', '#armory-view'];
  const currentViewId = views.find(id => {
    const el = $(id);
    return el && !el.hasAttribute('hidden');
  });

  if (currentViewId === targetId) return;

  const navMap: Record<string, string> = {
    '#hero-view': 'nav-btn-play',
    '#highscores-view': 'nav-btn-highscores',
    '#wiki-view': 'nav-btn-wiki',
    '#news-view': 'nav-btn-news',
    '#download-view': 'nav-btn-download',
    '#armory-view': 'nav-btn-armory'
  };

  const activeNavId = navMap[targetId];
  document.querySelectorAll('.nav-link').forEach((link) => {
    const isActive = link.id === activeNavId;
    link.classList.toggle('active', isActive);
    link.setAttribute('aria-selected', isActive ? 'true' : 'false');
    link.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });

  const fromView = currentViewId ? $(currentViewId) : null;
  const toView = $(targetId);

  if (!toView) return;

  const isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const performSwitch = () => {
    views.forEach(id => {
      const el = $(id);
      if (el) {
        const isTarget = id === targetId;
        el.toggleAttribute('hidden', !isTarget);
        el.setAttribute('aria-hidden', isTarget ? 'false' : 'true');
      }
    });

    // The cinematic trailer is for the Play page only; other views hide + pause it.
    const onPlayPage = targetId === '#hero-view';
    const backdrop = document.getElementById('start-screen-backdrop');
    if (backdrop) backdrop.classList.toggle('trailer-off', !onPlayPage);
    if (homepageTrailer) {
      if (onPlayPage) {
        if (!document.hidden && !document.body.classList.contains('game-active')) {
          void homepageTrailer.play().catch(() => {});
        }
      } else {
        homepageTrailer.pause();
      }
    }

    if (targetId === '#hero-view') {
      const activePlayPanel = ['#charselect-panel', '#offline-select'].find(id => {
        const el = $(id);
        return el && !el.hasAttribute('hidden');
      });
      if (activePlayPanel) {
        updatePreviewContainer(activePlayPanel);
      }
    }
  };

  if (isReducedMotion || !fromView) {
    performSwitch();
    return;
  }

  // Visual cross-fade and slide
  fromView.style.opacity = '0';
  fromView.style.transform = 'translateY(-8px)';

  const handleTransitionEnd = () => {
    performSwitch();
    
    toView.style.opacity = '0';
    toView.style.transform = 'translateY(8px)';
    
    void toView.offsetHeight; // force reflow
    
    toView.style.opacity = '1';
    toView.style.transform = 'translateY(0)';
  };

  window.setTimeout(handleTransitionEnd, 150);
}

function show(el: string): void {
  // Ensure the main view is switched to hero-view so play sub-panels are visible
  switchMainView('#hero-view');

  // Mount the Turnstile widget the first time the login/register form appears.
  if (el === '#login-panel') ensureTurnstile();

  const logoImg = $('#title-logo');
  if (logoImg) {
    const shouldHideLogo = el === '#charselect-panel' || el === '#offline-select';
    logoImg.toggleAttribute('hidden', shouldHideLogo);
  }

  if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) {
    document.activeElement.blur();
  }

  // Reset currently rendered classes to force re-render/animation when opening a panel
  currentlyRenderedClass['offline-class-details'] = null;
  currentlyRenderedClass['online-class-details'] = null;
  if (revertTimeouts['offline-class-details'] !== null) {
    window.clearTimeout(revertTimeouts['offline-class-details']);
    revertTimeouts['offline-class-details'] = null;
  }
  if (revertTimeouts['online-class-details'] !== null) {
    window.clearTimeout(revertTimeouts['online-class-details']);
    revertTimeouts['online-class-details'] = null;
  }
  if (hoverTimeouts['offline-class-details'] !== null) {
    window.clearTimeout(hoverTimeouts['offline-class-details']);
    hoverTimeouts['offline-class-details'] = null;
  }
  if (hoverTimeouts['online-class-details'] !== null) {
    window.clearTimeout(hoverTimeouts['online-class-details']);
    hoverTimeouts['online-class-details'] = null;
  }

  const panels = ['#mode-select', '#login-panel', '#realm-panel', '#charselect-panel', '#offline-select'];
  document.body.dataset.startPanel = el.slice(1);

  // Find currently visible panel
  const currentActiveId = panels.find(id => !$(id).hasAttribute('hidden'));

  if (!currentActiveId || currentActiveId === el) {
    // Show instantly on initial load or same panel
    for (const id of panels) {
      $(id).toggleAttribute('hidden', id !== el);
    }
    if (el === '#charselect-panel' || el === '#offline-select') {
      updatePreviewContainer(el);
    }
    return;
  }

  // Clear active transition
  if (activeTransitionTimeout !== null) {
    window.clearTimeout(activeTransitionTimeout);
    activeTransitionTimeout = null;
  }
  if (activeTransitionCleanup) {
    activeTransitionCleanup();
    activeTransitionCleanup = null;
  }

  const fromPanel = $(currentActiveId);
  const toPanel = $(el);

  const isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (isReducedMotion) {
    fromPanel.toggleAttribute('hidden', true);
    toPanel.toggleAttribute('hidden', false);
    if (el === '#charselect-panel' || el === '#offline-select') {
      updatePreviewContainer(el);
    }
    return;
  }

  // Fade out using CSS classes
  fromPanel.classList.add('panel-transition', 'panel-fade-out');

  const cleanupFrom = () => {
    fromPanel.toggleAttribute('hidden', true);
    fromPanel.classList.remove('panel-transition', 'panel-fade-out');
  };

  activeTransitionCleanup = cleanupFrom;

  activeTransitionTimeout = window.setTimeout(() => {
    cleanupFrom();
    activeTransitionCleanup = null;
    activeTransitionTimeout = null;

    // Set initial state for fade-in
    toPanel.classList.add('panel-transition', 'panel-fade-in-start');
    toPanel.toggleAttribute('hidden', false);
    if (el === '#charselect-panel' || el === '#offline-select') {
      updatePreviewContainer(el);
    }

    // Force layout reflow
    void toPanel.offsetHeight;

    // Trigger fade-in
    toPanel.classList.remove('panel-fade-in-start');
    toPanel.classList.add('panel-fade-in');

    const cleanupTo = () => {
      toPanel.classList.remove('panel-transition', 'panel-fade-in');
    };

    activeTransitionCleanup = cleanupTo;

    activeTransitionTimeout = window.setTimeout(() => {
      cleanupTo();
      activeTransitionCleanup = null;
      activeTransitionTimeout = null;
    }, 150);

  }, 150);
}

function loginError(text: string): void {
  const el = $('#login-error');
  el.textContent = text;
}

const LAST_REALM_KEY = 'woc_last_realm';

// Classic-MMO population bands, derived from the realm's current online count
// (the classic MMO's own labels are relative to peak; current count is a fair
// local stand-in).
function realmPopulation(online: boolean, players: number): { labelKey: TranslationKey; cls: string } {
  if (!online) return { labelKey: 'realm.offline', cls: 'offline' };
  if (players >= 80) return { labelKey: 'realm.full', cls: 'full' };
  if (players >= 40) return { labelKey: 'realm.high', cls: 'high' };
  if (players >= 15) return { labelKey: 'realm.medium', cls: 'med' };
  return { labelKey: 'realm.low', cls: 'low' };
}

// After login the classic MMO drops you onto a Realm List screen (then character select for
// the chosen realm). We remember the last realm and jump straight to its
// characters, with a "Change Realm" button back to this list.
async function enterRealmFlow(): Promise<void> {
  const dir = await api.realms();
  $('#realm-list-user').textContent = api.username ? `${api.username}` : '';
  const remembered = localStorage.getItem(LAST_REALM_KEY);
  const auto = dir.realms.find((r) => r.name === remembered);
  if (auto) { selectRealm(auto); return; }
  showRealmList(dir);
}

function showRealmList(dir?: import('./net/online').RealmDirectory): void {
  show('#realm-panel');
  const listEl = $('#realm-list');
  const render = (d: import('./net/online').RealmDirectory) => {
    if (d.realms.length === 0) {
      listEl.innerHTML = `<div class="realm-loading">${escapeHtml(t('realm.noRealms'))}</div>`;
      return;
    }
    // recommend the lowest-population online realm (classic MMOs nudge new players there)
    const realmTypeKeys = { 'Normal': 'realmTypes.normal', 'PvP': 'realmTypes.pvp', 'RP': 'realmTypes.rp', 'RP-PvP': 'realmTypes.rpPvp' } as const;
    listEl.innerHTML = d.realms.map((r) => {
      const chars = d.characters[r.name] ?? 0;
      const charTag = chars > 0
        ? `<span class="rn-chars">${escapeHtml(t(chars === 1 ? 'realm.characterCountOne' : 'realm.characterCountOther', { count: chars }))}</span>`
        : '';
      const typeKey = realmTypeKeys[r.type as keyof typeof realmTypeKeys];
      const typeLabel = typeKey ? t(typeKey) : r.type;
      return `<div class="realm-row" data-name="${escapeHtml(r.name)}" data-url="${escapeHtml(r.url)}">
        <div><div class="realm-name">${escapeHtml(r.name)}${charTag}<span class="rn-rec" data-rec hidden>${escapeHtml(t('realm.recommended'))}</span></div>
          <div class="realm-sub" data-sub>${escapeHtml(t('realm.checkingStatus'))}</div></div>
        <div class="realm-meta">
          <div class="realm-type">${escapeHtml(typeLabel)}</div>
          <div class="realm-pop offline" data-pop>-</div>
        </div>
      </div>`;
    }).join('');
    listEl.querySelectorAll('.realm-row').forEach((row) => row.addEventListener('click', () => {
      const name = (row as HTMLElement).dataset.name!;
      const entry = d.realms.find((r) => r.name === name);
      if (entry) selectRealm(entry);
    }));
    // live status per realm
    let bestPlayers = Infinity, bestName = '';
    void Promise.all(d.realms.map(async (r) => {
      const st = await api.realmStatus(r.url || '');
      const row = listEl.querySelector(`.realm-row[data-name="${CSS.escape(r.name)}"]`) as HTMLElement | null;
      if (!row) return;
      const pop = realmPopulation(st.online, st.players);
      const popEl = row.querySelector('[data-pop]') as HTMLElement;
      popEl.textContent = t(pop.labelKey);
      popEl.className = `realm-pop ${pop.cls}`;
      (row.querySelector('[data-sub]') as HTMLElement).textContent = st.online
        ? t('realm.onlineNow', { count: st.players })
        : t('realm.down');
      row.classList.toggle('offline', !st.online);
      if (st.online && st.players < bestPlayers) { bestPlayers = st.players; bestName = r.name; }
    })).then(() => {
      const recRow = bestName ? listEl.querySelector(`.realm-row[data-name="${CSS.escape(bestName)}"]`) : null;
      recRow?.querySelector('[data-rec]')?.removeAttribute('hidden');
    });
  };
  if (dir) render(dir);
  else {
    listEl.innerHTML = `<div class="realm-loading">${escapeHtml(t('realm.loading'))}</div>`;
    void api.realms().then(render);
  }
}

function selectRealm(entry: import('./net/online').RealmEntry): void {
  api.setRealm(entry.url);
  api.realm = entry.name;
  localStorage.setItem(LAST_REALM_KEY, entry.name);
  show('#charselect-panel');
  void refreshCharacters();
}

function setDeleteCharacterError(message: string): void {
  $('#delete-character-error').textContent = message;
}

function closeDeleteCharacterDialog(): void {
  pendingDeleteCharacter = null;
  const modal = $('#delete-character-modal');
  const input = $('#delete-character-confirm') as HTMLInputElement;
  const confirmBtn = $('#btn-confirm-delete-character') as HTMLButtonElement;
  modal.setAttribute('hidden', '');
  input.value = '';
  confirmBtn.disabled = true;
  setDeleteCharacterError('');
}

function normalizeDeleteConfirmation(name: string): string {
  return name.trim().toLowerCase();
}

function openDeleteCharacterDialog(character: CharacterSummary): void {
  pendingDeleteCharacter = character;
  const modal = $('#delete-character-modal');
  const nameEl = $('#delete-character-name');
  const bodyEl = $('#delete-character-body');
  const input = $('#delete-character-confirm') as HTMLInputElement;
  const confirmBtn = $('#btn-confirm-delete-character') as HTMLButtonElement;
  nameEl.textContent = character.name;
  bodyEl.textContent = t('deleteCharacter.body', { name: character.name });
  input.value = '';
  confirmBtn.disabled = true;
  setDeleteCharacterError('');
  modal.removeAttribute('hidden');
  input.focus();
}

async function refreshCharacters(): Promise<void> {
  const panel = $('#charselect-panel');
  panel.dataset.mobileTab = 'characters';
  document.querySelectorAll<HTMLButtonElement>('#charselect-panel .mobile-char-tab').forEach((btn) => {
    const on = btn.dataset.charTab === 'characters';
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', String(on));
  });
  const listEl = $('#char-list');
  listEl.innerHTML = `<li class="char-list-message">${escapeHtml(t('character.loading'))}</li>`;
  try {
    const chars = await api.characters();
    if (api.realm) $('#charselect-realm').textContent = t('realm.selectedRealm', { name: api.realm });
    listEl.innerHTML = '';
    if (chars.length === 0) {
      listEl.innerHTML = `<li class="char-list-message">${escapeHtml(t('character.noneYet'))}</li>`;
    }
    for (const c of chars) {
      const row = document.createElement('li');
      row.className = 'char-row' + (c.online ? ' online' : '') + (c.forceRename ? ' rename-required' : '');
      row.setAttribute('tabindex', '0');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      row.dataset.class = c.class;
      const className = classDisplayName(c.class);
      const statusText = c.online ? ` (${t('character.inWorld')})` : c.forceRename ? ` (${t('character.renameRequired')})` : '';
      row.innerHTML = `<span class="char-name">${escapeHtml(c.name)}</span>
        <span class="char-sub">${escapeHtml(t('character.levelClass', { level: c.level, className }))}${escapeHtml(statusText)}</span>
        ${c.forceRename
          ? `<input class="rename-input" placeholder="${escapeHtml(t('character.newNamePlaceholder'))}" maxlength="16" /><span class="char-actions"><button class="btn btn-danger delete-char-btn" ${c.online ? 'disabled' : ''}>${escapeHtml(t('character.delete'))}</button><button class="btn rename-btn">${escapeHtml(t('character.rename'))}</button></span>`
          : `<span class="char-actions"><button class="btn btn-danger delete-char-btn" ${c.online ? 'disabled' : ''}>${escapeHtml(t('character.delete'))}</button><button class="btn enter-world-btn" ${c.online ? 'disabled' : ''}>${escapeHtml(t('auth.enterWorld'))}</button></span>`}`;

      row.querySelector('.delete-char-btn')!.addEventListener('click', (e) => {
        e.stopPropagation();
        openDeleteCharacterDialog(c);
      });

      if (c.forceRename) {
        const input = row.querySelector('.rename-input') as HTMLInputElement;
        row.querySelector('.rename-btn')!.addEventListener('click', async (e) => {
          e.stopPropagation();
          $('#charselect-error').textContent = '';
          try {
            await api.renameCharacter(c.id, input.value.trim());
            await refreshCharacters();
          } catch (err) {
            $('#charselect-error').textContent = userFacingApiError(err);
          }
        });
      } else {
        row.querySelector('.enter-world-btn')!.addEventListener('click', (e) => {
          e.stopPropagation();
          void enterWorld(c, e.currentTarget as HTMLButtonElement);
        });
      }

      const selectRow = () => {
        // Deselect other characters
        document.querySelectorAll('#char-list .char-row').forEach((r) => {
          r.classList.remove('sel');
          r.setAttribute('aria-selected', 'false');
        });
        
        // Deselect class creator chips
        document.querySelectorAll('#charselect-panel .mini-class').forEach((x) => {
          x.classList.remove('sel');
          x.setAttribute('aria-pressed', 'false');
        });
        
        row.classList.add('sel');
        row.setAttribute('aria-selected', 'true');
        renderClassDetails('online-class-details', c.class);
        characterPreview?.setSkin(c.skin ?? 0);
        const skinRow = $('#online-skin-row') as HTMLElement | null;
        if (skinRow) skinRow.innerHTML = '';
      };

      row.addEventListener('click', selectRow);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectRow();
        }
      });

      listEl.appendChild(row);
    }

    // Select first character by default if present
    const firstRow = listEl.querySelector('.char-row') as HTMLElement | null;
    if (firstRow) {
      firstRow.click();
    }
  } catch (err) {
    listEl.innerHTML = `<li class="char-list-message char-list-error">${escapeHtml(userFacingApiError(err))}</li>`;
  }
}

function fatalOverlay(message: string): void {
  hideLoadingScreen(); // its art would bleed through the translucent backdrop
  if (document.getElementById('disconnect-overlay')) return; // first reason wins
  const el = document.createElement('div');
  el.id = 'disconnect-overlay';
  el.className = 'fatal-overlay';
  const messageEl = document.createElement('div');
  messageEl.textContent = message;
  el.appendChild(messageEl);
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.textContent = t('errors.returnToLogin');
  btn.addEventListener('click', () => location.reload());
  el.appendChild(btn);
  document.body.appendChild(el);
}

async function enterWorld(c: CharacterSummary, button?: HTMLButtonElement): Promise<void> {
  try {
    if (button) {
      button.disabled = true;
      button.textContent = t('loading.enteringWorld');
    }
    if (!(await prepareWorldEntry())) return;
    audio.init();
    music.init();
    enterLoadingState(t('loading.connectingRealm'));
  } finally {
    if (!hasBegunWorldEntry && button) {
      button.disabled = false;
      button.textContent = t('auth.enterWorld');
    }
  }
  const world = new ClientWorld(api.token!, c.id, c.class, api.base);
  // wait for hello + first snapshot so the world starts populated
  const waitStart = Date.now();
  const poll = setInterval(() => {
    if (world.connected && world.entities.has(world.playerId)) {
      clearInterval(poll);
      void startGame(world, null, world);
    } else if (Date.now() - waitStart > 10000) {
      clearInterval(poll);
      world.close();
      fatalOverlay(t('loading.enterTimeout'));
    }
  }, 50);
  // a rejected join must stop the poll too, or its timeout overlay would
  // mask the real reason (e.g. "character already in world")
  world.onDisconnect = (reason) => {
    clearInterval(poll);
    fatalOverlay(userFacingApiError(reason));
  };
}

interface ClassDetails {
  roleKey: TranslationKey;
  roleType: 'tank' | 'dps' | 'ranged' | 'healer' | 'hybrid';
  armorKey: TranslationKey;
  weaponsKey: TranslationKey;
  loreKey: TranslationKey;
}

const CLASS_DETAILS: Record<PlayerClass, ClassDetails> = {
  warrior: {
    roleKey: 'classDetails.roles.warrior',
    roleType: 'hybrid',
    armorKey: 'classDetails.armor.chainLeatherCloth',
    weaponsKey: 'classDetails.weapons.swordsMacesAxes',
    loreKey: 'classDetails.lore.warrior',
  },
  paladin: {
    roleKey: 'classDetails.roles.paladin',
    roleType: 'hybrid',
    armorKey: 'classDetails.armor.chainLeatherCloth',
    weaponsKey: 'classDetails.weapons.swordsMaces',
    loreKey: 'classDetails.lore.paladin',
  },
  hunter: {
    roleKey: 'classDetails.roles.hunter',
    roleType: 'ranged',
    armorKey: 'classDetails.armor.leatherCloth',
    weaponsKey: 'classDetails.weapons.axesSwords',
    loreKey: 'classDetails.lore.hunter',
  },
  rogue: {
    roleKey: 'classDetails.roles.rogue',
    roleType: 'dps',
    armorKey: 'classDetails.armor.leatherCloth',
    weaponsKey: 'classDetails.weapons.daggersSwords',
    loreKey: 'classDetails.lore.rogue',
  },
  priest: {
    roleKey: 'classDetails.roles.priest',
    roleType: 'healer',
    armorKey: 'classDetails.armor.cloth',
    weaponsKey: 'classDetails.weapons.staves',
    loreKey: 'classDetails.lore.priest',
  },
  shaman: {
    roleKey: 'classDetails.roles.shaman',
    roleType: 'hybrid',
    armorKey: 'classDetails.armor.chainLeatherCloth',
    weaponsKey: 'classDetails.weapons.macesAxes',
    loreKey: 'classDetails.lore.shaman',
  },
  mage: {
    roleKey: 'classDetails.roles.mage',
    roleType: 'ranged',
    armorKey: 'classDetails.armor.cloth',
    weaponsKey: 'classDetails.weapons.staves',
    loreKey: 'classDetails.lore.mage',
  },
  warlock: {
    roleKey: 'classDetails.roles.warlock',
    roleType: 'ranged',
    armorKey: 'classDetails.armor.cloth',
    weaponsKey: 'classDetails.weapons.staves',
    loreKey: 'classDetails.lore.warlock',
  },
  druid: {
    roleKey: 'classDetails.roles.druid',
    roleType: 'hybrid',
    armorKey: 'classDetails.armor.leatherCloth',
    weaponsKey: 'classDetails.weapons.staves',
    loreKey: 'classDetails.lore.druid',
  }
};

const SIGNATURE_ABILITIES: Record<PlayerClass, string[]> = {
  warrior: ['charge', 'heroic_strike', 'rend'],
  paladin: ['holy_light', 'judgement', 'seal_of_righteousness'],
  hunter: ['serpent_sting', 'aimed_shot', 'aspect_of_the_hawk'],
  rogue: ['sinister_strike', 'eviscerate', 'evasion'],
  priest: ['smite', 'power_word_shield', 'shadow_word_pain'],
  shaman: ['lightning_bolt', 'rockbiter_weapon', 'ghost_wolf'],
  mage: ['fireball', 'frostbolt', 'polymorph'],
  warlock: ['shadow_bolt', 'corruption', 'life_tap'],
  druid: ['wrath', 'bear_form', 'rejuvenation']
};

const activeClassDetailsTimeouts: Record<string, number | null> = {};

function renderClassDetails(panelId: string, className: PlayerClass): void {
  const panel = document.getElementById(panelId);
  if (!panel) return;

  // Redundant render check
  if (currentlyRenderedClass[panelId] === className) return;
  currentlyRenderedClass[panelId] = className;

  if (characterPreview) {
    characterPreview.setClass(className);
  }

  // Clear any active transitions for this panel to prevent stacked out-of-order renders
  if (activeClassDetailsTimeouts[panelId] !== undefined && activeClassDetailsTimeouts[panelId] !== null) {
    window.clearTimeout(activeClassDetailsTimeouts[panelId]);
    activeClassDetailsTimeouts[panelId] = null;
  }

  const classDef = CLASSES[className];
  const details = CLASS_DETAILS[className];
  if (!classDef || !details) return;

  const existingContent = panel.querySelector('.class-details-content');
  const existingName = panel.querySelector('.class-details-name')?.textContent;
  const classLabel = classDisplayName(className);
  const roleLabel = t(details.roleKey);
  const armorLabel = t(details.armorKey);
  const weaponsLabel = t(details.weaponsKey);
  const resourceKey = RESOURCE_KEYS[classDef.resourceType] ?? 'classDetails.resources.mana';
  const resourceLabel = t(resourceKey);

  if (existingContent && existingName === classLabel) {
    if (activeClassDetailsTimeouts[panelId] !== undefined && activeClassDetailsTimeouts[panelId] !== null) {
      window.clearTimeout(activeClassDetailsTimeouts[panelId]);
      activeClassDetailsTimeouts[panelId] = null;
    }
    const contentWrapper = existingContent as HTMLElement;
    const isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (isReducedMotion) {
      contentWrapper.classList.remove('fade-out');
      const fills = contentWrapper.querySelectorAll('.details-stat-bar-fill') as NodeListOf<HTMLElement>;
      fills.forEach(fill => {
        fill.style.width = fill.getAttribute('data-target-width') || '0%';
      });
    } else {
      void contentWrapper.offsetHeight;
      contentWrapper.classList.remove('fade-out');
      const fills = contentWrapper.querySelectorAll('.details-stat-bar-fill') as NodeListOf<HTMLElement>;
      fills.forEach(fill => {
        fill.style.width = fill.getAttribute('data-target-width') || '0%';
      });
    }
    return;
  }

  const classColorHex = '#' + classDef.color.toString(16).padStart(6, '0');
  
  // Bind class color as a custom property for clean styling
  panel.style.setProperty('--class-color', classColorHex);

  const statsList: { nameKey: TranslationKey; key: keyof typeof classDef.baseStats }[] = [
    { nameKey: 'classDetails.labels.strength', key: 'str' },
    { nameKey: 'classDetails.labels.agility', key: 'agi' },
    { nameKey: 'classDetails.labels.stamina', key: 'sta' },
    { nameKey: 'classDetails.labels.intellect', key: 'int' },
    { nameKey: 'classDetails.labels.spirit', key: 'spi' },
  ];

  const statBarsHtml = statsList.map(s => {
    const statLabel = t(s.nameKey);
    const val = classDef.baseStats[s.key];
    const pct = Math.min(100, Math.round((val / 25) * 100));
    return `
      <div class="details-stat-bar-row">
        <span class="details-stat-label">${escapeHtml(statLabel)}</span>
        <div class="details-stat-bar-track" aria-label="${escapeHtml(t('classDetails.statBarAria', { stat: statLabel, value: val }))}">
          <div class="details-stat-bar-fill" style="width: 0%;" data-target-width="${pct}%"></div>
        </div>
        <span class="details-stat-val">${val}</span>
      </div>
    `;
  }).join('');

  const spells = SIGNATURE_ABILITIES[className];
  const spellsHtml = spells.map(spellId => {
    const a = ABILITIES[spellId];
    if (!a) return '';
    const iconUrl = iconDataUrl('ability', spellId, 32);
    
    // Format ability description dynamically by resolving rank 1 placeholders
    let dmgText = '';
    const primaryEffect = a.effects.find(eff => 
      eff.type === 'directDamage' || 
      eff.type === 'heal' || 
      eff.type === 'weaponDamage' || 
      eff.type === 'weaponStrike' || 
      eff.type === 'aoeDamage' || 
      eff.type === 'aoeRoot' ||
      eff.type === 'finisherDamage' ||
      eff.type === 'drainTick'
    );
    if (primaryEffect) {
      if (primaryEffect.type === 'directDamage' || primaryEffect.type === 'heal' || primaryEffect.type === 'aoeDamage' || primaryEffect.type === 'aoeRoot' || primaryEffect.type === 'drainTick') {
        dmgText = classDetailAmountRange(primaryEffect.min, primaryEffect.max);
      } else if (primaryEffect.type === 'weaponDamage' || primaryEffect.type === 'weaponStrike') {
        dmgText = formatClassDetailNumber(primaryEffect.bonus);
      } else if (primaryEffect.type === 'finisherDamage') {
        dmgText = t('abilityUi.tooltip.finisherDamage', {
          base: formatClassDetailNumber(primaryEffect.base),
          perCombo: formatClassDetailNumber(primaryEffect.perCombo),
        });
      }
    } else {
      const secondaryEffect = a.effects.find(eff => 
        eff.type === 'dot' || 
        eff.type === 'hot' || 
        eff.type === 'absorb' || 
        eff.type === 'imbue'
      );
      if (secondaryEffect) {
        if (secondaryEffect.type === 'dot' || secondaryEffect.type === 'hot') {
          dmgText = formatClassDetailNumber(secondaryEffect.total);
        } else if (secondaryEffect.type === 'absorb') {
          dmgText = formatClassDetailNumber(secondaryEffect.amount);
        } else if (secondaryEffect.type === 'imbue') {
          dmgText = formatClassDetailNumber(secondaryEffect.bonus);
        }
      }
    }
    const abilityName = tEntity({ kind: 'ability', id: a.id, field: 'name' });
    const resolvedDesc = tEntity({ kind: 'ability', id: a.id, field: 'description', values: { damage: dmgText } });

    return `
      <li class="details-spell-item">
        <img class="details-spell-icon-img" src="${escapeHtml(iconUrl)}" alt="${escapeHtml(abilityName)}" width="32" height="32" />
        <div class="details-spell-text">
          <strong>${escapeHtml(abilityName)}</strong>
          ${escapeHtml(resolvedDesc)}
        </div>
      </li>
    `;
  }).join('');

  // Ensure the panel itself is visible
  panel.classList.add('visible');

  const performUpdate = () => {
    panel.innerHTML = `
      <div class="class-details-content fade-out">
        <div class="class-details-header">
          <div class="class-details-header-text">
            <h3 class="class-details-name">${escapeHtml(classLabel)}</h3>
            <span class="class-details-role role-${details.roleType}">${escapeHtml(roleLabel)}</span>
          </div>
        </div>
        <p class="class-details-lore">${escapeHtml(classDisplayDescription(className))}</p>
        <div class="class-details-grid">
          <div class="class-details-stats-col">
            <h4 class="details-section-title">${escapeHtml(t('classDetails.sections.startingStats'))}</h4>
            ${statBarsHtml}
          </div>
          <div class="class-details-gear-col">
            <h4 class="details-section-title">${escapeHtml(t('classDetails.sections.equipment'))}</h4>
            <div class="details-gear-row"><strong>${escapeHtml(t('classDetails.labels.resource'))}:</strong> <span class="badge badge-resource resource-${classDef.resourceType}">${escapeHtml(resourceLabel)}</span></div>
            <div class="details-gear-row"><strong>${escapeHtml(t('classDetails.labels.armor'))}:</strong> <span class="badge">${escapeHtml(armorLabel)}</span></div>
            <div class="details-gear-row"><strong>${escapeHtml(t('classDetails.labels.weapons'))}:</strong> <span class="badge">${escapeHtml(weaponsLabel)}</span></div>
          </div>
          <div class="details-spells-section">
            <h4 class="details-section-title">${escapeHtml(t('classDetails.sections.signatureAbilities'))}</h4>
            <ul class="details-spells-list">
              ${spellsHtml}
            </ul>
          </div>
        </div>
      </div>
    `;
    
    // Announce update to screen readers
    panel.setAttribute('aria-label', t('classDetails.aria', {
      className: classLabel,
      role: roleLabel,
      str: classDef.baseStats.str,
      agi: classDef.baseStats.agi,
      sta: classDef.baseStats.sta,
      int: classDef.baseStats.int,
      spi: classDef.baseStats.spi,
    }));

    const contentWrapper = panel.querySelector('.class-details-content') as HTMLElement | null;
    if (contentWrapper) {
      const isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (isReducedMotion) {
        contentWrapper.classList.remove('fade-out');
        const fills = contentWrapper.querySelectorAll('.details-stat-bar-fill') as NodeListOf<HTMLElement>;
        fills.forEach(fill => {
          fill.style.width = fill.getAttribute('data-target-width') || '0%';
        });
      } else {
        // Force layout reflow
        void contentWrapper.offsetHeight;

        contentWrapper.classList.remove('fade-out');

        // Animate stat bars by forcing a reflow and then setting target width
        const fills = contentWrapper.querySelectorAll('.details-stat-bar-fill') as NodeListOf<HTMLElement>;
        fills.forEach(fill => {
          // Force reflow for each fill to register the initial 0% width
          void fill.offsetHeight;
          fill.style.width = fill.getAttribute('data-target-width') || '0%';
        });
      }
    }
  };

  const isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (isReducedMotion) {
    performUpdate();
  } else if (existingContent) {
    existingContent.classList.add('fade-out');
    activeClassDetailsTimeouts[panelId] = window.setTimeout(() => {
      performUpdate();
      activeClassDetailsTimeouts[panelId] = null;
    }, 150);
  } else {
    performUpdate();
  }
}

const STATS_CACHE_KEY = 'woc_cached_stats';
const STATS_CACHE_TTL_MS = 30000; // 30 seconds

function readTranslationKey(value: string | null): TranslationKey | null {
  return value ? value as TranslationKey : null;
}

function updateSeoMetadata(lang: SupportedLanguage): void {
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const canonicalHref = localizedSiteUrl(lang);
  if (canonical) canonical.href = canonicalHref;

  const ogUrl = document.querySelector<HTMLMetaElement>('meta[property="og:url"]');
  if (ogUrl) ogUrl.content = canonicalHref;

  const jsonLd = document.getElementById('structured-data') as HTMLScriptElement | null;
  if (jsonLd) {
    jsonLd.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'VideoGame',
      name: 'World of ClaudeCraft',
      genre: t('seo.genre'),
      playMode: t('seo.playMode'),
      applicationCategory: t('seo.applicationCategory'),
      operatingSystem: t('seo.operatingSystem'),
      url: canonicalHref,
      image: 'https://worldofclaudecraft.com/woc_logo_square.webp',
      description: t('seo.description'),
      inLanguage: languageTag(lang),
    }, null, 2);
  }
}

function translatePage(): void {
  const lang = getLanguage();
  document.documentElement.lang = languageTag(lang);

  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = readTranslationKey(el.getAttribute('data-i18n'));
    if (key) {
      el.textContent = t(key);
    }
  });

  document.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => {
    const key = readTranslationKey(el.getAttribute('data-i18n-aria'));
    if (key) {
      el.setAttribute('aria-label', t(key));
    }
  });

  document.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach((el) => {
    const key = readTranslationKey(el.getAttribute('data-i18n-placeholder'));
    if (key) {
      el.setAttribute('placeholder', t(key));
    }
  });

  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const key = readTranslationKey(el.getAttribute('data-i18n-title'));
    if (key) {
      el.setAttribute('title', t(key));
    }
  });

  document.querySelectorAll<HTMLImageElement>('[data-i18n-alt]').forEach((el) => {
    const key = readTranslationKey(el.getAttribute('data-i18n-alt'));
    if (key) {
      el.alt = t(key);
    }
  });

  document.querySelectorAll<HTMLMetaElement>('[data-i18n-content]').forEach((el) => {
    const key = readTranslationKey(el.getAttribute('data-i18n-content'));
    if (key) {
      el.content = t(key);
    }
  });

  updateSeoMetadata(lang);
}

function refreshLocalizedDynamicShell(): void {
  const activePanel = document.body.dataset.startPanel;
  if (activePanel === 'realm-panel') {
    showRealmList();
    return;
  }
  if (activePanel === 'charselect-panel') {
    void refreshCharacters();
    return;
  }
  const offlineSelected = document.querySelector('#offline-select .mini-class.sel') as HTMLElement | null;
  if (activePanel === 'offline-select' && offlineSelected) {
    currentlyRenderedClass['offline-class-details'] = null;
    renderClassDetails('offline-class-details', offlineSelected.dataset.class as PlayerClass);
  }
  const onlineSelected = document.querySelector('#charselect-panel .mini-class.sel, #char-list .char-row.sel') as HTMLElement | null;
  if (onlineSelected) {
    currentlyRenderedClass['online-class-details'] = null;
    renderClassDetails('online-class-details', onlineSelected.dataset.class as PlayerClass);
  }
}

async function loadProjectStats(): Promise<void> {
  // Realm status now lives in the realm dropdown — both in the trigger sub-line
  // and inside the Online option — so update every instance by class.
  const playerEls = document.querySelectorAll<HTMLElement>('.js-stat-players');
  const accountEls = document.querySelectorAll<HTMLElement>('.js-stat-accounts');
  if (!playerEls.length || !accountEls.length) return;
  const setAll = (els: NodeListOf<HTMLElement>, text: string): void => {
    els.forEach((el) => { el.textContent = text; });
  };

  // 1. Try to read from localStorage first
  let cached: { realm: string; accounts_created: number; players_online: number; timestamp: number } | null = null;
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(STATS_CACHE_KEY);
    if (raw) {
      try {
        cached = JSON.parse(raw);
      } catch {}
    }
  }

  // If cache exists and is fresh (within TTL), use it and skip API request
  if (cached && (Date.now() - cached.timestamp < STATS_CACHE_TTL_MS)) {
    setAll(playerEls, String(cached.players_online));
    setAll(accountEls, String(cached.accounts_created));
    return;
  }

  // 2. Fetch fresh stats
  try {
    const data = await api.projectStats();

    setAll(playerEls, String(data.players_online));
    setAll(accountEls, String(data.accounts_created));

    // Save to cache with timestamp
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STATS_CACHE_KEY, JSON.stringify({
        ...data,
        timestamp: Date.now(),
      }));
    }
  } catch (err) {
    console.error('Failed to fetch project stats:', err);
    // If API fails, fall back to cached data (even if expired)
    if (cached) {
      setAll(playerEls, String(cached.players_online));
      setAll(accountEls, String(cached.accounts_created));
    } else {
      setAll(playerEls, '–');
      setAll(accountEls, '–');
    }
  }
}

// Home-page global (cross-realm) lifetime-XP leaderboard. Server computes the
// virtual level + ranking; this only renders. Re-fetched each time the High
// Scores view is opened (the server caches, so this is cheap).
let highscoresLoading = false;
async function loadHighscores(): Promise<void> {
  const host = $('#hs-leaderboard');
  if (!host || highscoresLoading) return;
  highscoresLoading = true;
  host.innerHTML = `<div class="hs-loading">${t('game.leaderboard.loading')}</div>`;
  let rows: LeaderboardEntry[] = [];
  try {
    rows = await api.leaderboard('global', 100);
  } catch {
    host.innerHTML = `<div class="hs-error">${t('game.leaderboard.retry')}</div>`;
    highscoresLoading = false;
    return;
  }
  highscoresLoading = false;
  if (rows.length === 0) {
    host.innerHTML = `<div class="hs-empty">${t('game.leaderboard.empty')}</div>`;
    return;
  }
  const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const head = `<div class="hs-row hs-head">`
    + `<span class="hs-rank">${t('game.leaderboard.rank')}</span>`
    + `<span class="hs-name">${t('game.leaderboard.name')}</span>`
    + `<span class="hs-realm">${t('game.leaderboard.realmCol')}</span>`
    + `<span class="hs-lvl">${t('game.leaderboard.level')}</span>`
    + `<span class="hs-vlvl">${t('game.leaderboard.vlevel')}</span>`
    + `<span class="hs-xp">${t('game.leaderboard.lifetimeXp')}</span></div>`;
  const body = rows.map((r) => {
    const cls = CLASSES[r.cls];
    const star = r.prestigeRank > 0 ? `<span class="hs-prestige" title="${t('game.prestige.rank')} ${r.prestigeRank}">★${r.prestigeRank}</span>` : '';
    return `<div class="hs-row${r.rank <= 3 ? ' hs-top' : ''}">`
      + `<span class="hs-rank">${r.rank}</span>`
      + `<span class="hs-name"${cls ? ` title="${esc(classDisplayName(r.cls))}"` : ''}>${star}${esc(r.name)}</span>`
      + `<span class="hs-realm">${esc(r.realm ?? '')}</span>`
      + `<span class="hs-lvl">${r.level}</span>`
      + `<span class="hs-vlvl">${r.virtualLevel}</span>`
      + `<span class="hs-xp">${formatXp(r.lifetimeXp)}</span></div>`;
  }).join('');
  host.innerHTML = head + body;
  host.querySelectorAll('.hs-row:not(.hs-head)').forEach((row, i) => {
    const name = rows[i]?.name;
    if (!name) return;
    const el = row as HTMLElement;
    el.style.cursor = 'pointer';
    el.title = `View ${name}'s armory`;
    el.addEventListener('click', () => openArmory(name));
  });
}

let armoryLoading = false;
function openArmory(name: string): void {
  switchMainView('#armory-view');
  const url = new URL(window.location.href);
  url.searchParams.set('armory', name);
  window.history.pushState({}, '', url.toString());
  void loadArmory(name);
}
async function loadArmory(name: string): Promise<void> {
  const host = $('#armory-content');
  if (!host || armoryLoading) return;
  const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const input = $('#armory-search-input') as HTMLInputElement | null;
  if (input) input.value = name;
  armoryLoading = true;
  host.innerHTML = `<div class="armory-loading">${t('armory.loading', { name: esc(name) })}</div>`;
  let profile = null;
  try { profile = await api.armory(name); } catch { profile = null; }
  armoryLoading = false;
  if (!profile) {
    host.innerHTML = `<div class="armory-empty">${t('armory.notFound', { name: esc(name) })}</div>`;
    return;
  }
  const shareUrl = `${location.origin}${location.pathname}?armory=${encodeURIComponent(profile.name)}`;
  host.innerHTML = armoryProfileHtml(profile)
    + `<div class="armory-share"><button id="armory-copy" class="armory-search-btn" type="button">${t('armory.copyLink')}</button>`
    + `<input class="armory-share-url" type="text" readonly value="${esc(shareUrl)}"></div>`;
  const copy = $('#armory-copy');
  if (copy) {
    copy.addEventListener('click', () => {
      try { void navigator.clipboard?.writeText(shareUrl); } catch { /* clipboard unavailable */ }
      copy.textContent = t('armory.copied');
      window.setTimeout(() => { copy.textContent = t('armory.copyLink'); }, 1500);
    });
  }
}

// Minimal, safe Markdown → HTML for GitHub release notes. The input is escaped
// FIRST, so every regex below operates on inert text; the only markup we emit is
// our own whitelisted tags. Deliberately tiny (no tables/images/blockquotes) —
// enough to make patch notes readable without pulling in a markdown dependency.
function renderReleaseBody(md: string): string {
  const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const inline = (s: string): string =>
    esc(s)
      // [text](url) — only http(s) links survive; anything else renders as text.
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, text, url) =>
        `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  const out: string[] = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  for (const line of md.replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = Math.min(3, heading[1].length); // collapse h1-h6 → h1-h3
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (bullet) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(bullet[1])}</li>`);
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join('');
}

// News & Updates: published GitHub releases, proxied + cached by the server.
// Re-fetched each time the view is opened (the server caches, so it is cheap).
let newsLoading = false;
async function loadNews(): Promise<void> {
  const host = $('#news-feed');
  if (!host || newsLoading) return;
  newsLoading = true;
  host.innerHTML = `<div class="news-loading">${t('news.loading')}</div>`;
  let releases: ReleaseEntry[] = [];
  try {
    releases = await api.releases(20);
  } catch {
    host.innerHTML = `<div class="news-error">${t('news.error')}</div>`;
    newsLoading = false;
    return;
  }
  newsLoading = false;
  if (releases.length === 0) {
    host.innerHTML = `<div class="news-empty">${t('news.empty')}</div>`;
    return;
  }
  const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  host.innerHTML = releases.map((r) => {
    const when = r.publishedAt
      ? `<span class="news-date">${formatDateTime(new Date(r.publishedAt), { dateStyle: 'medium' })}</span>`
      : '';
    const tag = r.tag ? `<span class="news-tag">${esc(r.tag)}</span>` : '';
    const badge = r.prerelease ? `<span class="news-badge">${t('news.prerelease')}</span>` : '';
    const title = esc(r.name || r.tag || '');
    const link = r.url
      ? `<div class="news-item-foot"><a class="news-link" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${t('news.viewOnGithub')}</a></div>`
      : '';
    return `<article class="news-item">`
      + `<div class="news-item-head">`
      + `<h3 class="news-item-title">${title}</h3>${tag}${badge}${when}</div>`
      + `<div class="news-body">${renderReleaseBody(r.body)}</div>${link}</article>`;
  }).join('');
}

let caCopyResetTimer: number | null = null;

// Click-to-copy for the $WOC contract address on the landing page. Falls back to
// a hidden-textarea copy when the async Clipboard API is unavailable (insecure
// context / older browsers); the copied state is only shown on a real success.
function wireContractAddressCopy(): void {
  const btn = document.getElementById('btn-copy-ca');
  const container = document.getElementById('token-ca');
  if (!btn || !container) return;

  const showCopied = () => {
    container.classList.add('is-copied');
    if (caCopyResetTimer !== null) window.clearTimeout(caCopyResetTimer);
    caCopyResetTimer = window.setTimeout(() => {
      container.classList.remove('is-copied');
      caCopyResetTimer = null;
    }, 1800);
  };

  const fallbackCopy = (text: string): boolean => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    document.body.removeChild(ta);
    return ok;
  };

  btn.addEventListener('click', () => {
    const ca = btn.getAttribute('data-ca');
    if (!ca) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(ca).then(showCopied).catch(() => {
        if (fallbackCopy(ca)) showCopied();
      });
    } else if (fallbackCopy(ca)) {
      showCopied();
    }
  });
}

function syncHomepageMusicToggle(): void {
  const btn = document.getElementById('homepage-music-toggle') as HTMLButtonElement | null;
  if (!btn) return;
  btn.classList.toggle('is-muted', homepageMusicMuted);
  btn.setAttribute('aria-pressed', String(!homepageMusicMuted));
}

function playHomepageMusic(): void {
  const el = homepageMusic;
  if (!el || homepageMusicMuted || homepageMusicStarted) return;
  void el.play().then(() => {
    homepageMusicStarted = true;
    removeHomepageMusicGestureListeners?.();
    removeHomepageMusicGestureListeners = null;
  }).catch(() => {
    // Autoplay still blocked: a later gesture will retry.
  });
}

function setHomepageMusicMuted(muted: boolean): void {
  homepageMusicMuted = muted;
  saveHomepageMusicMuted(muted);
  const el = homepageMusic;
  if (el) {
    el.muted = muted;
    if (muted) {
      el.pause();
      homepageMusicStarted = false;
    } else {
      playHomepageMusic();
    }
  }
  syncHomepageMusicToggle();
}

function wireHomepageMusicToggle(): void {
  const btn = document.getElementById('homepage-music-toggle') as HTMLButtonElement | null;
  if (!btn) return;
  syncHomepageMusicToggle();
  btn.addEventListener('click', () => {
    setHomepageMusicMuted(!homepageMusicMuted);
  });
}

function wireStartScreens(): void {
  // Initial page translation and stats load
  translatePage();
  hydrateIcons();
  void loadProjectStats();
  wireContractAddressCopy();
  wireHomepageMusicToggle();

  // mode select
  const onlineBtn = $('#btn-online');
  const offlineBtn = $('#btn-offline');
  const btnStartOffline = $('#btn-start-offline') as HTMLButtonElement;
  const offlineNameInput = $('#char-name') as HTMLInputElement;
  const offlineError = $('#offline-error');
  
  const handleOnlineSelect = () => show('#login-panel');

  const handleOfflineStart = (cls: PlayerClass) => {
    const rawName = offlineNameInput.value.trim();
    if (!rawName) {
      offlineError.textContent = t('errors.characterNameRequired');
      offlineNameInput.classList.add('user-invalid-fallback');
      offlineNameInput.setAttribute('aria-invalid', 'true');
      offlineNameInput.focus();
      return;
    }
    if (!validateCharacterName(rawName)) {
      offlineError.textContent = t('errors.characterNameInvalid');
      offlineNameInput.classList.add('user-invalid-fallback');
      offlineNameInput.setAttribute('aria-invalid', 'true');
      offlineNameInput.focus();
      return;
    }

    offlineError.textContent = '';
    offlineNameInput.classList.remove('user-invalid-fallback');
    offlineNameInput.removeAttribute('aria-invalid');

    audio.init();
    music.init();
    const name = sanitizeOfflineName(rawName);
    void startOffline(cls, name, selectedSkin('#offline-skin-row', offlineSkin));
  };

  const handleOfflineSelect = () => {
    show('#offline-select');
    
    // Select warrior by default and render details
    const warriorCard = document.querySelector('#offline-select .mini-class[data-class="warrior"]') as HTMLElement | null;
    if (warriorCard) {
      document.querySelectorAll('#offline-select .mini-class').forEach((c) => {
        c.classList.remove('sel');
        c.setAttribute('aria-pressed', 'false');
      });
      warriorCard.classList.add('sel');
      warriorCard.setAttribute('aria-pressed', 'true');
      renderClassDetails('offline-class-details', 'warrior');
      btnStartOffline.removeAttribute('disabled');
      refreshOfflineSkins('warrior');
    }
  };

  onlineBtn.addEventListener('click', handleOnlineSelect);
  onlineBtn.addEventListener('keydown', (e) => handleKeyboardActivation(e as KeyboardEvent, handleOnlineSelect));
  
  offlineBtn.addEventListener('click', handleOfflineSelect);
  offlineBtn.addEventListener('keydown', (e) => handleKeyboardActivation(e as KeyboardEvent, handleOfflineSelect));

  // --- Play console: realm dropdown + single Play CTA -----------------------
  // The dropdown only chooses the destination (defaults to Online); the Play
  // button commits, routing to the same online/offline flows as the legacy cards.
  const serverSelect = $('#server-select');
  const serverTrigger = $('#server-select-trigger') as HTMLButtonElement;
  const serverMenu = $('#server-select-menu');
  const serverValue = $('#server-select-value');
  const serverSub = $('#server-select-sub');
  const serverTriggerDot = serverTrigger.querySelector('.server-dot') as HTMLElement | null;
  const btnPlay = $('#btn-play') as HTMLButtonElement;

  if (serverSelect && serverTrigger && serverMenu && btnPlay) {
    type ServerMode = 'online' | 'offline';
    const serverOptions = Array.from(serverMenu.querySelectorAll<HTMLElement>('.server-select-option'));
    const VALUE_KEY: Record<ServerMode, TranslationKey> = {
      online: 'mode.serverOnline',
      offline: 'mode.serverOffline',
    };
    // The trigger sub-line shows live realm stats for Online and a short blurb
    // for Offline; toggle the matching child by its data-mode.
    const subParts = Array.from(serverSub.querySelectorAll<HTMLElement>('[data-mode]'));
    let serverMode: ServerMode = 'online';

    const setActiveOption = (opt: HTMLElement | null): void => {
      serverOptions.forEach((o) => o.classList.toggle('is-active', o === opt));
    };
    const isMenuOpen = (): boolean => !serverMenu.hasAttribute('hidden');

    const applyServerMode = (mode: ServerMode): void => {
      serverMode = mode;
      serverSelect.dataset.mode = mode;
      // Update both the i18n key and the rendered text, so a later language
      // switch (translatePage) re-renders the *selected* mode correctly.
      serverValue.setAttribute('data-i18n', VALUE_KEY[mode]);
      serverValue.textContent = t(VALUE_KEY[mode]);
      subParts.forEach((part) => part.toggleAttribute('hidden', part.dataset.mode !== mode));
      if (serverTriggerDot) serverTriggerDot.dataset.mode = mode;
      serverOptions.forEach((opt) => {
        const selected = opt.dataset.mode === mode;
        opt.classList.toggle('is-selected', selected);
        opt.setAttribute('aria-selected', selected ? 'true' : 'false');
      });
    };

    const openServerMenu = (): void => {
      serverMenu.toggleAttribute('hidden', false);
      serverTrigger.setAttribute('aria-expanded', 'true');
      const selected = serverOptions.find((o) => o.dataset.mode === serverMode) ?? serverOptions[0];
      setActiveOption(selected ?? null);
      selected?.focus();
    };
    const closeServerMenu = (refocusTrigger = false): void => {
      if (!isMenuOpen()) return;
      serverMenu.toggleAttribute('hidden', true);
      serverTrigger.setAttribute('aria-expanded', 'false');
      serverOptions.forEach((o) => o.classList.remove('is-active'));
      if (refocusTrigger) serverTrigger.focus();
    };

    serverTrigger.addEventListener('click', () => {
      if (isMenuOpen()) closeServerMenu(true);
      else openServerMenu();
    });
    serverTrigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!isMenuOpen()) openServerMenu();
      } else if (e.key === 'Escape') {
        closeServerMenu();
      }
    });

    serverOptions.forEach((opt) => {
      opt.addEventListener('click', () => {
        applyServerMode(opt.dataset.mode as ServerMode);
        closeServerMenu(true);
      });
      opt.addEventListener('mousemove', () => setActiveOption(opt));
    });

    serverMenu.addEventListener('keydown', (e) => {
      const idx = serverOptions.findIndex((o) => o.classList.contains('is-active'));
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = serverOptions[Math.min(idx + 1, serverOptions.length - 1)] ?? serverOptions[0];
        setActiveOption(next); next?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = serverOptions[Math.max(idx - 1, 0)] ?? serverOptions[0];
        setActiveOption(prev); prev?.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        setActiveOption(serverOptions[0]); serverOptions[0]?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        const last = serverOptions[serverOptions.length - 1];
        setActiveOption(last); last?.focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const active = serverOptions[idx] ?? serverOptions[0];
        if (active) { applyServerMode(active.dataset.mode as ServerMode); closeServerMenu(true); }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeServerMenu(true);
      } else if (e.key === 'Tab') {
        closeServerMenu();
      }
    });

    // Dismiss on outside pointer/focus.
    document.addEventListener('pointerdown', (e) => {
      if (isMenuOpen() && !serverSelect.contains(e.target as Node)) closeServerMenu();
    });

    btnPlay.addEventListener('click', () => {
      if (serverMode === 'offline') handleOfflineSelect();
      else handleOnlineSelect();
    });

    applyServerMode('online');
  }

  btnStartOffline.addEventListener('click', () => {
    const selCard = document.querySelector('#offline-select .mini-class.sel') as HTMLElement | null;
    if (selCard) {
      handleOfflineStart(selCard.dataset.class as PlayerClass);
    } else {
      offlineError.textContent = t('errors.selectClass');
    }
  });

  // offline class chips
  document.querySelectorAll('#offline-select .mini-class').forEach((card) => {
    const handleClassSelect = () => {
      if (hoverTimeouts['offline-class-details'] !== null) {
        window.clearTimeout(hoverTimeouts['offline-class-details']);
        hoverTimeouts['offline-class-details'] = null;
      }
      if (revertTimeouts['offline-class-details'] !== null) {
        window.clearTimeout(revertTimeouts['offline-class-details']);
        revertTimeouts['offline-class-details'] = null;
      }
      document.querySelectorAll('#offline-select .mini-class').forEach((c) => {
        c.classList.remove('sel');
        c.setAttribute('aria-pressed', 'false');
      });
      card.classList.add('sel');
      card.setAttribute('aria-pressed', 'true');
      
      const cls = (card as HTMLElement).dataset.class as PlayerClass;
      renderClassDetails('offline-class-details', cls);
      btnStartOffline.removeAttribute('disabled');
      refreshOfflineSkins(cls);
    };
    card.addEventListener('click', handleClassSelect);
    card.addEventListener('keydown', (e) => handleKeyboardActivation(e as KeyboardEvent, handleClassSelect));
    
    // A11y focus updates details
    card.addEventListener('focus', () => {
      if (revertTimeouts['offline-class-details'] !== null) {
        window.clearTimeout(revertTimeouts['offline-class-details']);
        revertTimeouts['offline-class-details'] = null;
      }
      if (hoverTimeouts['offline-class-details'] !== null) {
        window.clearTimeout(hoverTimeouts['offline-class-details']);
        hoverTimeouts['offline-class-details'] = null;
      }
      const cls = (card as HTMLElement).dataset.class as PlayerClass;
      renderClassDetails('offline-class-details', cls);
    });

    // Hover updates details with 50ms debounce
    card.addEventListener('mouseenter', () => {
      if (revertTimeouts['offline-class-details'] !== null) {
        window.clearTimeout(revertTimeouts['offline-class-details']);
        revertTimeouts['offline-class-details'] = null;
      }
      if (hoverTimeouts['offline-class-details'] !== null) {
        window.clearTimeout(hoverTimeouts['offline-class-details']);
      }
      const cls = (card as HTMLElement).dataset.class as PlayerClass;
      hoverTimeouts['offline-class-details'] = window.setTimeout(() => {
        renderClassDetails('offline-class-details', cls);
        hoverTimeouts['offline-class-details'] = null;
      }, 50);
    });

    // Mouseleave reverts to currently selected class details with a 100ms debounce
    card.addEventListener('mouseleave', () => {
      if (hoverTimeouts['offline-class-details'] !== null) {
        window.clearTimeout(hoverTimeouts['offline-class-details']);
        hoverTimeouts['offline-class-details'] = null;
      }
      if (revertTimeouts['offline-class-details'] !== null) {
        window.clearTimeout(revertTimeouts['offline-class-details']);
      }
      revertTimeouts['offline-class-details'] = window.setTimeout(() => {
        const selCard = document.querySelector('#offline-select .mini-class.sel') as HTMLElement | null;
        if (selCard) {
          const cls = selCard.dataset.class as PlayerClass;
          renderClassDetails('offline-class-details', cls);
        }
        revertTimeouts['offline-class-details'] = null;
      }, 100);
    });

    // Blur reverts to currently selected class details with a 100ms debounce (matches mouseleave)
    card.addEventListener('blur', () => {
      if (hoverTimeouts['offline-class-details'] !== null) {
        window.clearTimeout(hoverTimeouts['offline-class-details']);
        hoverTimeouts['offline-class-details'] = null;
      }
      if (revertTimeouts['offline-class-details'] !== null) {
        window.clearTimeout(revertTimeouts['offline-class-details']);
      }
      revertTimeouts['offline-class-details'] = window.setTimeout(() => {
        const selCard = document.querySelector('#offline-select .mini-class.sel') as HTMLElement | null;
        if (selCard) {
          const cls = selCard.dataset.class as PlayerClass;
          renderClassDetails('offline-class-details', cls);
        }
        revertTimeouts['offline-class-details'] = null;
      }, 100);
    });
  });

  const offlineBackBtn = $('#btn-offline-back');
  const handleOfflineBack = () => {
    show('#mode-select');
    offlineError.textContent = '';
    offlineNameInput.value = '';
    offlineNameInput.classList.remove('user-invalid-fallback');
    offlineNameInput.removeAttribute('aria-invalid');
  };
  offlineBackBtn.addEventListener('click', handleOfflineBack);

  // login
  const doAuth = async (mode: 'login' | 'register') => {
    const username = ($('#login-user') as unknown as HTMLInputElement).value.trim();
    const password = ($('#login-pass') as unknown as HTMLInputElement).value;
    loginError('');
    const token = turnstileToken();
    if (TURNSTILE_SITEKEY && !token) {
      loginError(t('errors.api.verificationFailed'));
      return;
    }
    try {
      if (mode === 'login') await api.login(username, password, token);
      else await api.register(username, password, token);
    } catch (err) {
      // Auth itself failed (bad credentials, taken username, Turnstile reject…).
      // The token is single-use, so refresh the widget for the next attempt.
      loginError(userFacingApiError(err));
      resetTurnstile();
      return;
    }
    // Auth succeeded — a later realm-entry error is NOT a verification failure,
    // so don't reset the widget or let the user re-submit the (now duplicate) auth.
    try {
      $('#charselect-user').textContent = api.username ?? '';
      await enterRealmFlow();
    } catch (err) {
      loginError(userFacingApiError(err));
    }
  };

  const loginForm = $('#login-panel') as HTMLFormElement;
  const userInput = $('#login-user') as HTMLInputElement;
  const passInput = $('#login-pass') as HTMLInputElement;
  const togglePassBtn = $('#btn-toggle-password') as HTMLButtonElement;

  // Wire password visibility toggle
  togglePassBtn.addEventListener('click', () => {
    togglePasswordVisibility(passInput, togglePassBtn);
  });

  // Sync aria-invalid and error elements dynamically on interaction
  [userInput, passInput].forEach((input) => {
    input.addEventListener('blur', () => {
      const isValid = syncInputAriaState(input);
      input.classList.toggle('user-invalid-fallback', !isValid);
    });
    input.addEventListener('input', () => {
      // Clear general login error on typing
      loginError('');
      if (input.classList.contains('user-invalid-fallback') || input.hasAttribute('aria-invalid')) {
        const isValid = syncInputAriaState(input);
        input.classList.toggle('user-invalid-fallback', !isValid);
        
        // Update error display element
        const errorEl = $('#' + input.id + '-error');
        if (errorEl) {
          errorEl.style.display = isValid ? 'none' : 'block';
        }
      }
    });
  });

  // Prevent default submission and perform validation
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (validateForm(loginForm)) {
      void doAuth('login');
    }
  });

  // Custom keydown helper for compatibility with edge cases / legacy scripts
  passInput.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') {
      e.preventDefault();
      loginForm.requestSubmit();
    }
  });

  // Legacy clicks of Login/Register buttons
  $('#btn-login').addEventListener('click', (e) => {
    // Let the form submit handle it if it was clicked, but prevent default click just in case
  });

  $('#btn-register').addEventListener('click', (e) => {
    e.preventDefault();
    if (validateForm(loginForm)) {
      void doAuth('register');
    }
  });

  $('#btn-login-back').addEventListener('click', (e) => {
    e.preventDefault();
    // Clear validation state on back
    [userInput, passInput].forEach((input) => {
      input.classList.remove('user-invalid-fallback');
      input.removeAttribute('aria-invalid');
      const errEl = $('#' + input.id + '-error');
      if (errEl) errEl.style.display = 'none';
    });
    loginError('');
    show('#mode-select');
  });
  $('#btn-realm-back').addEventListener('click', () => show('#mode-select'));
  $('#btn-change-realm').addEventListener('click', () => showRealmList());
  document.querySelectorAll<HTMLButtonElement>('#charselect-panel .mobile-char-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const panel = $('#charselect-panel');
      const activeTab = tab.dataset.charTab === 'create' ? 'create' : 'characters';
      panel.dataset.mobileTab = activeTab;
      document.querySelectorAll<HTMLButtonElement>('#charselect-panel .mobile-char-tab').forEach((btn) => {
        const on = btn.dataset.charTab === activeTab;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', String(on));
      });
    });
  });

  // character creation
  document.querySelectorAll('#charselect-panel .mini-class').forEach((el) => {
    const handleMiniClassSelect = () => {
      if (hoverTimeouts['online-class-details'] !== null) {
        window.clearTimeout(hoverTimeouts['online-class-details']);
        hoverTimeouts['online-class-details'] = null;
      }
      if (revertTimeouts['online-class-details'] !== null) {
        window.clearTimeout(revertTimeouts['online-class-details']);
        revertTimeouts['online-class-details'] = null;
      }
      document.querySelectorAll('#charselect-panel .mini-class').forEach((x) => {
        x.classList.remove('sel');
        x.setAttribute('aria-pressed', 'false');
      });
      document.querySelectorAll('#char-list .char-row').forEach((r) => {
        r.classList.remove('sel');
        r.setAttribute('aria-selected', 'false');
      });
      el.classList.add('sel');
      el.setAttribute('aria-pressed', 'true');
      
      const cls = (el as HTMLElement).dataset.class as PlayerClass;
      renderClassDetails('online-class-details', cls);
      refreshOnlineSkins(cls);
    };
    el.addEventListener('click', handleMiniClassSelect);
    el.addEventListener('keydown', (e) => handleKeyboardActivation(e as KeyboardEvent, handleMiniClassSelect));
    
    // A11y focus updates details
    el.addEventListener('focus', () => {
      if (revertTimeouts['online-class-details'] !== null) {
        window.clearTimeout(revertTimeouts['online-class-details']);
        revertTimeouts['online-class-details'] = null;
      }
      if (hoverTimeouts['online-class-details'] !== null) {
        window.clearTimeout(hoverTimeouts['online-class-details']);
        hoverTimeouts['online-class-details'] = null;
      }
      document.querySelectorAll('#char-list .char-row').forEach((r) => {
        r.classList.remove('sel');
        r.setAttribute('aria-selected', 'false');
      });
      const cls = (el as HTMLElement).dataset.class as PlayerClass;
      renderClassDetails('online-class-details', cls);
    });

    // Hover updates details with 50ms debounce
    el.addEventListener('mouseenter', () => {
      if (revertTimeouts['online-class-details'] !== null) {
        window.clearTimeout(revertTimeouts['online-class-details']);
        revertTimeouts['online-class-details'] = null;
      }
      if (hoverTimeouts['online-class-details'] !== null) {
        window.clearTimeout(hoverTimeouts['online-class-details']);
      }
      const cls = (el as HTMLElement).dataset.class as PlayerClass;
      hoverTimeouts['online-class-details'] = window.setTimeout(() => {
        renderClassDetails('online-class-details', cls);
        hoverTimeouts['online-class-details'] = null;
      }, 50);
    });

    // Mouseleave reverts to currently selected class details with a 100ms debounce
    el.addEventListener('mouseleave', () => {
      if (hoverTimeouts['online-class-details'] !== null) {
        window.clearTimeout(hoverTimeouts['online-class-details']);
        hoverTimeouts['online-class-details'] = null;
      }
      if (revertTimeouts['online-class-details'] !== null) {
        window.clearTimeout(revertTimeouts['online-class-details']);
      }
      revertTimeouts['online-class-details'] = window.setTimeout(() => {
        const selEl = document.querySelector('#charselect-panel .mini-class.sel') as HTMLElement | null;
        if (selEl) {
          const cls = selEl.dataset.class as PlayerClass;
          renderClassDetails('online-class-details', cls);
        } else {
          const selChar = document.querySelector('#char-list .char-row.sel') as HTMLElement | null;
          if (selChar) {
            const cls = selChar.dataset.class as PlayerClass;
            renderClassDetails('online-class-details', cls);
          }
        }
        revertTimeouts['online-class-details'] = null;
      }, 100);
    });

    // Blur reverts to currently selected class details with a 100ms debounce (matches mouseleave)
    el.addEventListener('blur', () => {
      if (hoverTimeouts['online-class-details'] !== null) {
        window.clearTimeout(hoverTimeouts['online-class-details']);
        hoverTimeouts['online-class-details'] = null;
      }
      if (revertTimeouts['online-class-details'] !== null) {
        window.clearTimeout(revertTimeouts['online-class-details']);
      }
      revertTimeouts['online-class-details'] = window.setTimeout(() => {
        const selEl = document.querySelector('#charselect-panel .mini-class.sel') as HTMLElement | null;
        if (selEl) {
          const cls = selEl.dataset.class as PlayerClass;
          renderClassDetails('online-class-details', cls);
        } else {
          const selChar = document.querySelector('#char-list .char-row.sel') as HTMLElement | null;
          if (selChar) {
            const cls = selChar.dataset.class as PlayerClass;
            renderClassDetails('online-class-details', cls);
          }
        }
        revertTimeouts['online-class-details'] = null;
      }, 100);
    });
  });

  // Default select warrior in online character creator
  const defaultOnlineClass = document.querySelector('#charselect-panel .mini-class[data-class="warrior"]') as HTMLElement | null;
  if (defaultOnlineClass) {
    defaultOnlineClass.classList.add('sel');
    defaultOnlineClass.setAttribute('aria-pressed', 'true');
    renderClassDetails('online-class-details', 'warrior');
    refreshOnlineSkins('warrior');
  }
  const newCharNameInput = $('#new-char-name') as HTMLInputElement;
  const charselectError = $('#charselect-error');

  // Wire Enter key inside new-char-name to trigger character creation
  newCharNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('#btn-create-char').click();
    }
  });

  // Wire dynamic validation clearing on typing
  [offlineNameInput, newCharNameInput].forEach((input) => {
    const errorEl = input.id === 'char-name' ? offlineError : charselectError;
    input.addEventListener('input', () => {
      errorEl.textContent = '';
      if (input.classList.contains('user-invalid-fallback') || input.hasAttribute('aria-invalid')) {
        const val = input.value.trim();
        if (!val || validateCharacterName(val)) {
          input.classList.remove('user-invalid-fallback');
          input.removeAttribute('aria-invalid');
        }
      }
    });
  });

  $('#btn-create-char').addEventListener('click', async () => {
    const name = newCharNameInput.value.trim();
    const clsEl = document.querySelector('#charselect-panel .mini-class.sel') as HTMLElement | null;
    loginError('');
    charselectError.textContent = '';
    
    if (!name) {
      charselectError.textContent = t('errors.characterNameRequired');
      newCharNameInput.classList.add('user-invalid-fallback');
      newCharNameInput.setAttribute('aria-invalid', 'true');
      newCharNameInput.focus();
      return;
    }
    if (!validateCharacterName(name)) {
      charselectError.textContent = t('errors.characterNameInvalid');
      newCharNameInput.classList.add('user-invalid-fallback');
      newCharNameInput.setAttribute('aria-invalid', 'true');
      newCharNameInput.focus();
      return;
    }
    if (!clsEl) { charselectError.textContent = t('errors.pickClass'); return; }

    newCharNameInput.classList.remove('user-invalid-fallback');
    newCharNameInput.removeAttribute('aria-invalid');

    try {
      await api.createCharacter(name, clsEl.dataset.class as PlayerClass, selectedSkin('#online-skin-row', onlineSkin));
      newCharNameInput.value = '';
      charselectError.textContent = '';
      await refreshCharacters();
    } catch (err) {
      charselectError.textContent = userFacingApiError(err);
    }
  });
  $('#btn-charselect-back').addEventListener('click', () => show('#login-panel'));

  // Main Navigation View Switching
  const navBtnPlay = $('#nav-btn-play');
  const navBtnHighscores = $('#nav-btn-highscores');
  const navBtnWiki = $('#nav-btn-wiki');
  const navBtnNews = $('#nav-btn-news');
  const navBtnDownload = $('#nav-btn-download');
  const navBtnArmory = $('#nav-btn-armory');
  const navBtnLogin = $('#nav-btn-login');

  const deleteConfirmInput = $('#delete-character-confirm') as HTMLInputElement;
  const deleteConfirmBtn = $('#btn-confirm-delete-character') as HTMLButtonElement;
  const deleteCancelBtn = $('#btn-cancel-delete-character') as HTMLButtonElement;
  const deleteModal = $('#delete-character-modal');

  deleteConfirmInput.addEventListener('input', () => {
    setDeleteCharacterError('');
    deleteConfirmBtn.disabled = !pendingDeleteCharacter ||
      normalizeDeleteConfirmation(deleteConfirmInput.value) !== normalizeDeleteConfirmation(pendingDeleteCharacter.name);
  });
  deleteConfirmInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !deleteConfirmBtn.disabled) {
      e.preventDefault();
      deleteConfirmBtn.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeDeleteCharacterDialog();
    }
  });
  deleteCancelBtn.addEventListener('click', () => closeDeleteCharacterDialog());
  deleteModal.addEventListener('click', (e) => {
    if (e.target === deleteModal) closeDeleteCharacterDialog();
  });
  deleteConfirmBtn.addEventListener('click', async () => {
    if (!pendingDeleteCharacter) return;
    const target = pendingDeleteCharacter;
    deleteConfirmBtn.disabled = true;
    setDeleteCharacterError('');
    try {
      await api.deleteCharacter(target.id, deleteConfirmInput.value);
      closeDeleteCharacterDialog();
      await refreshCharacters();
    } catch (err) {
      setDeleteCharacterError(userFacingApiError(err));
      deleteConfirmBtn.disabled = normalizeDeleteConfirmation(deleteConfirmInput.value) !== normalizeDeleteConfirmation(target.name);
    }
  });

  const setupNavBtn = (btn: HTMLElement | null, targetViewId: string, customAction?: () => void) => {
    if (!btn) return;
    const action = () => {
      // Close mobile menu if open
      const header = $('.homepage-header');
      const toggleBtn = $('#mobile-menu-toggle');
      if (header && toggleBtn) {
        header.classList.remove('menu-open');
        toggleBtn.setAttribute('aria-expanded', 'false');
      }

      if (customAction) {
        customAction();
      } else {
        switchMainView(targetViewId);
      }
    };
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      action();
    });
    btn.addEventListener('keydown', (e) => {
      handleKeyboardActivation(e as KeyboardEvent, action);
    });
  };

  setupNavBtn(navBtnPlay, '#hero-view', () => {
    switchMainView('#hero-view');
    show('#mode-select');
  });

  setupNavBtn(navBtnHighscores, '#highscores-view', () => {
    switchMainView('#highscores-view');
    void loadHighscores();
  });
  setupNavBtn(navBtnWiki, '#wiki-view');
  setupNavBtn(navBtnNews, '#news-view', () => {
    switchMainView('#news-view');
    void loadNews();
  });
  setupNavBtn(navBtnDownload, '#download-view');
  setupNavBtn(navBtnArmory, '#armory-view');
  const armoryForm = $('#armory-search') as HTMLFormElement | null;
  if (armoryForm) {
    armoryForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#armory-search-input') as HTMLInputElement | null;
      const name = (input?.value ?? '').trim();
      if (name) openArmory(name);
    });
  }
  const armoryParam = new URLSearchParams(location.search).get('armory');
  if (armoryParam && armoryParam.trim()) {
    switchMainView('#armory-view');
    void loadArmory(armoryParam.trim());
  }
  setupNavBtn(navBtnLogin, '#hero-view', () => {
    show('#login-panel');
  });

  // Header Logo click listener to return to homepage
  const headerLogoBtn = $('#header-logo-btn');
  setupNavBtn(headerLogoBtn, '#hero-view', () => {
    switchMainView('#hero-view');
    show('#mode-select');
  });

  // Language selection dropdown setup
  const langSelect = $('#lang-select') as HTMLSelectElement | null;
  if (langSelect) {
    langSelect.value = getLanguage();
    langSelect.addEventListener('change', () => {
      const selected = langSelect.value;
      if (!isSupportedLanguage(selected)) return;
      setLanguage(selected);
      
      // Dynamically update the browser URL query parameter without page reload
      if (typeof window !== 'undefined' && window.history) {
        const url = new URL(window.location.href);
        url.searchParams.set('lang', selected);
        window.history.pushState({}, '', url.toString());
      }
      
      translatePage();
      refreshLocalizedDynamicShell();
      document.dispatchEvent(new CustomEvent('woc:languagechange', { detail: { language: selected } }));
    });
  }

  // Mobile menu toggle setup
  const mobileMenuToggle = $('#mobile-menu-toggle');
  const homepageHeader = $('.homepage-header');
  if (mobileMenuToggle && homepageHeader) {
    mobileMenuToggle.addEventListener('click', () => {
      const isOpen = homepageHeader.classList.toggle('menu-open');
      mobileMenuToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  }

  // Dynamically initialize background embers
  const initBackgroundEmbers = () => {
    if (isPhoneTouchDevice()) return;
    const backdrop = $('#start-screen-backdrop');
    if (!backdrop) return;
    
    const container = document.createElement('div');
    container.className = 'embers-container';
    backdrop.appendChild(container);
    
    for (let i = 0; i < 24; i++) {
      const ember = document.createElement('div');
      ember.className = 'ember';
      ember.style.left = `${Math.random() * 100}%`;
      ember.style.bottom = `${Math.random() * 20 - 10}%`;
      
      const size = Math.random() * 4 + 2;
      ember.style.width = `${size}px`;
      ember.style.height = `${size}px`;
      
      ember.style.setProperty('--drift', `${Math.random() * 120 - 60}px`);
      ember.style.setProperty('--ember-scale', `${Math.random() * 0.8 + 0.6}`);
      ember.style.setProperty('--ember-opacity', `${Math.random() * 0.4 + 0.5}`);
      
      ember.style.animationDelay = `${Math.random() * 10}s`;
      ember.style.animationDuration = `${Math.random() * 8 + 6}s`;
      
      container.appendChild(ember);
    }
  };

  initBackgroundEmbers();

  // Initialize 3D character preview once assets are ready
  assetsReady().then(() => {
    const activePanelId = ['#charselect-panel', '#offline-select'].find(id => !$(id).hasAttribute('hidden'));
    const containerId = activePanelId === '#offline-select' ? '#offline-preview-container' : '#online-preview-container';
    const container = $(containerId);
    const canvas = $('#char-preview-canvas') as HTMLCanvasElement | null;
    if (container && canvas) {
      characterPreview = new CharacterPreview(container, canvas);
      const selSelector = activePanelId === '#offline-select'
        ? '#offline-select .mini-class.sel'
        : '#charselect-panel .mini-class.sel';
      const selEl = document.querySelector(selSelector) as HTMLElement | null;
      const cls = selEl ? (selEl.dataset.class as PlayerClass) : 'warrior';
      characterPreview.setClass(cls);
    }
  });
}

// ---------------------------------------------------------------------------
// Homepage cinematic backdrop
// ---------------------------------------------------------------------------
function initHomepageTrailer(): void {
  const video = document.getElementById('bg-trailer') as HTMLVideoElement | null;
  const backdrop = document.getElementById('start-screen-backdrop');
  if (!video || !backdrop) return;
  homepageTrailer = video;

  const fade = backdrop.querySelector<HTMLElement>('.bg-trailer-fade');
  // Fade FROM black (first play + just after each loop wrap).
  const runFadeIn = (): void => {
    if (!fade) return;
    fade.classList.remove('is-fading', 'is-fading-out');
    void fade.offsetWidth; // force reflow so the animation replays
    fade.classList.add('is-fading');
  };
  // Dip TO black just before the clip ends, so the loop seam is hidden.
  const runFadeOut = (): void => {
    if (!fade) return;
    fade.classList.remove('is-fading');
    void fade.offsetWidth;
    fade.classList.add('is-fading-out');
  };

  // Reveal the backdrop layer so the (cheap) poster always provides atmosphere,
  // even when we choose not to play the clip.
  const reveal = (): void => backdrop.classList.add('trailer-ready');

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reducedData = window.matchMedia('(prefers-reduced-data: reduce)').matches;
  const conn = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
  const saveData = Boolean(conn && conn.saveData);

  if (reducedMotion || reducedData || saveData) {
    // Honour the user's preference: keep the static poster, don't fetch/play video.
    video.preload = 'none';
    if (fade) fade.classList.add('revealed'); // lift the black wipe without animating
    reveal();
    return;
  }

  video.addEventListener('playing', () => {
    backdrop.classList.add('trailer-ready', 'trailer-playing');
    runFadeIn();
  }, { once: true });

  // Hide the loop seam: dip to black ~0.35s before the end, then fade back in
  // right after the wrap. The `loop` attribute restarts playback seamlessly
  // (no 'ended' event), so watch the playhead instead.
  const FADE_LEAD = 0.35;
  let dipping = false;
  let lastTime = 0;
  const onPlayhead = (currentTime: number): void => {
    const duration = video.duration;
    if (duration > 0) {
      if (currentTime + 0.2 < lastTime) {
        // Wrapped back to the start — reveal from black.
        dipping = false;
        runFadeIn();
      } else if (!dipping && currentTime >= duration - FADE_LEAD) {
        dipping = true;
        runFadeOut();
      }
    }
    lastTime = currentTime;
  };

  const rvfc = (video as unknown as {
    requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => void;
  }).requestVideoFrameCallback;
  if (typeof rvfc === 'function') {
    const onFrame = (_now: number, meta: { mediaTime: number }): void => {
      onPlayhead(meta.mediaTime);
      rvfc.call(video, onFrame);
    };
    rvfc.call(video, onFrame);
  } else {
    video.addEventListener('timeupdate', () => onPlayhead(video.currentTime));
  }

  const tryPlay = (): void => {
    const p = video.play();
    if (p && typeof p.then === 'function') {
      // Muted inline autoplay is broadly allowed; if it's still blocked, the
      // poster stays as a graceful fallback.
      p.catch(() => reveal());
    }
  };
  if (video.readyState >= 2) tryPlay();
  else video.addEventListener('loadeddata', tryPlay, { once: true });

  // Don't burn cycles decoding while the tab is backgrounded or in-game.
  document.addEventListener('visibilitychange', () => {
    if (document.body.classList.contains('game-active')) return;
    if (document.hidden) video.pause();
    else void video.play().catch(() => {});
  });
}

// Looping home-page theme. Browsers block audio autoplay until a user gesture,
// so we try immediately and otherwise start on the first interaction. It keeps
// playing through the loading screen and fades out once the game is on screen.
function initHomepageMusic(): void {
  if (homepageMusic) return;
  const el = new Audio('/audio/main-theme.mp3');
  el.loop = true;
  el.muted = homepageMusicMuted;
  el.preload = 'auto';
  el.volume = HOMEPAGE_MUSIC_VOLUME;
  homepageMusic = el;

  const gestureEvents: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart'];
  removeHomepageMusicGestureListeners = (): void => {
    gestureEvents.forEach((ev) => window.removeEventListener(ev, onGesture));
  };
  const onGesture = (): void => playHomepageMusic();
  gestureEvents.forEach((ev) => window.addEventListener(ev, onGesture, { passive: true }));
  syncHomepageMusicToggle();
  playHomepageMusic();
}

function fadeOutHomepageMusic(durationMs = 1600): void {
  const el = homepageMusic;
  if (!el) return;
  homepageMusic = null; // stop further control + block restarts
  removeHomepageMusicGestureListeners?.();
  removeHomepageMusicGestureListeners = null;
  const startVol = el.volume;
  const steps = 32;
  let i = 0;
  const id = window.setInterval(() => {
    i += 1;
    el.volume = Math.max(0, startVol * (1 - i / steps));
    if (i >= steps) {
      window.clearInterval(id);
      el.pause();
      homepageMusicStarted = false;
    }
  }, durationMs / steps);
}

wireStartScreens();
initHomepageTrailer();
initHomepageMusic();
