import { Sim } from './sim/sim';
import { Renderer } from './render/renderer';
import { Input } from './game/input';
import { InputActivityMeter, installInputActivityTracking } from './game/input_activity';
import { Keybinds } from './game/keybinds';
import { Settings, GameSettings, SETTING_RANGES, normalizeClickMoveButton } from './game/settings';
import { MobileControls, PHONE_TOUCH_QUERY, isPhoneTouchDevice, useTouchInterface, setInterfaceMode, interfaceModeFromSetting } from './game/mobile_controls';
import { readBrowserEnv, cssEffectsTier, browserBodyClasses, BROWSER_BODY_CLASSES } from './game/browser_env';
import { GFX } from './render/gfx';
import { GamepadManager } from './game/gamepad';
import { GamepadBindings } from './game/gamepad_bindings';
import { shouldUseStaticBackdrop } from './game/landing_backdrop';
import { navigatorSaveData } from './render/sky';
import { Hud } from './ui/hud';
import { PerfOverlay } from './ui/perf_overlay';
import { PerfOverlayConfigStore, type PerfOverlayConfig } from './ui/perf_overlay_config';
import { FrameMeter, buildPerfOverlayView } from './ui/perf_overlay_model';
import { createMetricsSampler } from './ui/perf_metrics_sampler';
import { audio } from './game/audio';
import { music } from './game/music';
import { voice } from './game/voice';
import { sfx } from './game/sfx';
import { activePvpOpponentIds, handlePickedEntity, hoverCursorKind, isAttackableEntity } from './game/interactions';
import { clickMoveShouldWalk, clickMoveStep, distance2d, latencyAdjustedStopDistance, resolveClickMoveAction, stepAngleToward } from './game/click_move';
import { Api, isAuthError, ClientWorld, CharacterSummary, NATIVE_APP, type ReleaseEntry } from './net/online';
import { createNativeAttestationProof } from './net/native_attestation';
import { setWalletDisplayAvailable, setWocBalance, setWalletUiEnabled, resolveWocBalanceUpdate } from './ui/wallet_balance';
import {
  accountPortalModel, validatePasswordChange, validateEmailShape, deactivateConfirmReady,
} from './ui/account_portal';
import { absolutePublishedCardUrl, setCardUploader, setReferralProvider, setStandingProvider } from './ui/player_card_share';
// The wallet module is loaded lazily via dynamic import() in the wallet
// controller below, so it stays out of the main entry chunk and only loads when
// the feature is enabled + used.
import type { WalletOption } from './net/wallet';
import type { IWorld, LeaderboardEntry } from './world_api';
import { findPlayerPath, resolvePlayerDestination } from './sim/pathfind';
import { pathCrossesFence } from './sim/colliders';
import { formatXp } from './ui/xp_bar';
import { assembleBugReportMeta } from './ui/bug_report';
import { zoneBiomeAt } from './sim/world';
import { assetsReady } from './render/assets/preload';
import { CharacterPreview } from './render/characters';
import { skinCount } from './render/characters/manifest';
import { DT, INTERACT_RANGE, MELEE_RANGE, PlayerClass, RUN_SPEED, dist2d } from './sim/types';
import { togglePasswordVisibility, syncInputAriaState, validateForm, handleKeyboardActivation, validateCharacterName } from './ui/auth_utils';
import { CLASSES, ABILITIES } from './sim/content/classes';
import { CLASS_DETAILS, SIGNATURE_ABILITIES } from './ui/class_details_data';
import { iconDataUrl } from './ui/icons';
import { ensureLocaleLoaded, formatDateTime, formatNumber, getLanguage, isLocaleResident, isSupportedLanguage, languageTag, setLanguage, t, tPlural, type SupportedLanguage, type TranslationKey } from './ui/i18n';
import { tServer } from './ui/server_i18n';
import { tEntity } from './ui/entity_i18n';
import { hydrateIcons } from './ui/ui_icons';
import { portraitChipHtml, hydratePortraits } from './ui/portrait_chip';
import { playerPortraitDataUrl } from './render/characters/portrait';
import { createPerfMonitor } from './game/perf';
import { getClientSeed } from './game/client_seed';
import { startPerfReporter } from './game/perf_reporter';
import { cameraFollowShouldSettle, updateFollowCameraYaw, wrapAngle } from './game/camera_follow';


const WORLD_SEED = 20061; // fixed: World of ClaudeCraft is a persistent place
const CLICK_MOVE_TURN_RATE = 4.2; // rad/sec; responsive turning while the camera stays decoupled from click spam
const CLICK_MOVE_WAYPOINT_STOP = 0.8; // yards; intermediate A* corners should roll through, not stutter-stop
const CLICK_MOVE_REROUTE_DISTANCE = 4; // yards; live entity targets can move this far before we recompute the path
const CLICK_MOVE_FENCE_JUMP_LOOKAHEAD = 2; // yards ahead; auto-jump when a click-move path is about to cross a fence
const CLICK_MOVE_STUCK_MS = 1100; // ms of no forward progress before we reroute around (then give up)
const CLICK_MOVE_PROGRESS_EPSILON = 1.5; // yards of travel that counts as progress (a walking player clears this fast; a player hopping in place at a fence never does)
const CLICK_MOVE_LATENCY_STOP_CAP_MS = 240; // avoid overshooting hosted click-move targets while preserving offline precision
const CLICK_MOVE_LATENCY_STOP_MAX_EXTRA = 1.6; // yards; cap high-latency stop padding so clicks do not end obviously short
const CLICK_MOVE_LATENCY_WAYPOINT_MAX_EXTRA = 0.8; // yards; helps online A* corners roll through despite input echo delay
const ONLINE_SELF_RENDER_ALPHA_LEAD = 0.65; // fraction of a snapshot interval to reduce local-player visual delay online
const ATTACK_MOVE_MELEE_STOP = 3.5; // yards; how close an attack-move approach stops from its target (inside melee)
const ATTACK_MOVE_ACQUIRE_RANGE = 12; // yards; an attack-move toward open ground auto-targets a hostile this near
// Aura kinds that stop the player from moving (mirrors the sim's isRooted/isStunned):
// while one of these is up, click-to-move can't make progress, so the destination
// marker shows a "held" state instead of looking like a stuck game.
const IMMOBILE_AURA_KINDS = new Set(['stun', 'root', 'incapacitate', 'polymorph']);
const IMMOBILE_NOTE_THROTTLE_MS = 1200; // min gap between "Can't move!" floats while held
const HOMEPAGE_MUSIC_MUTED_KEY = 'woc_homepage_music_muted';
const HOMEPAGE_MUSIC_VOLUME = 0.225;

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T;
document.body.classList.toggle('native-app', NATIVE_APP);
if (NATIVE_APP) document.body.classList.add('mobile-touch');
let pendingDeleteCharacter: CharacterSummary | null = null;
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
  if (normalized === 'character rename is not permitted') return t('errors.api.renameNotPermitted');
  if (normalized === 'type the character name to confirm deletion') return t('errors.api.deleteConfirm');
  if (normalized === 'not authenticated' || normalized === 'authentication required') return t('errors.api.notAuthenticated');
  if (normalized === 'this account has been banned.') return t('errors.api.accountBanned');
  if (normalized === 'character already in world') return t('errors.api.alreadyInWorld');
  if (normalized === 'character taken over') return t('errors.api.takenOver');
  if (normalized === 'this character must be renamed before entering the world.') return t('errors.api.renameBeforeEntering');
  if (normalized === 'logins are only allowed from the game client') return t('errors.api.webLoginOnly');
  // Account portal REST errors (server/main.ts /api/account/*). English-source,
  // re-localized here onto the English-only hudChrome.account.* keys.
  if (normalized === 'current password is incorrect') return t('hudChrome.account.errCurrentPassword');
  if (normalized === 'enter a valid email address') return t('hudChrome.account.errEmailInvalid');
  if (normalized === 'username does not match') return t('hudChrome.account.errUsernameMatch');
  if (normalized === 'password is incorrect') return t('hudChrome.account.errPasswordIncorrect');
  if (normalized === 'log out all characters before deactivating') return t('hudChrome.account.errCharactersOnline');
  if (normalized === 'this account has been deactivated.') return t('hudChrome.account.deactivatedLocked');
  if (normalized === 'password must be at most 128 chars') return t('hudChrome.account.errPasswordLong');
  // The account row vanished mid-session (404 from /api/account/*); treat as a
  // dropped session rather than rendering raw English in the form.
  if (normalized === 'account not found') return t('errors.api.notAuthenticated');
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
  const useStableGameViewport = document.body.classList.contains('game-active') && useTouchInterface();
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
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('button, a, input, textarea, select, [role="button"], [role="option"], [tabindex]')) {
      lastTouchEnd = Date.now();
      return;
    }
    const now = Date.now();
    if (now - lastTouchEnd <= 320) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });
}

function syncPhoneTouchClass(): void {
  document.body.classList.toggle('mobile-touch', NATIVE_APP || useTouchInterface());
  syncCommunityMenuMode();
}

function syncCommunityMenuMode(): void {
  const communityMenu = document.getElementById('community-menu') as HTMLDetailsElement | null;
  if (!communityMenu) return;
  communityMenu.open = !(NATIVE_APP || useTouchInterface());
}

// Honor a persisted Interface Mode override before the first layout paint, so a
// tablet+keyboard player who chose Desktop never flashes the touch UI on load.
setInterfaceMode(interfaceModeFromSetting(new Settings().get('interfaceMode')));
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
  // Deliberately the device FACT (isPhoneTouchDevice), not the Interface Mode
  // override: orientation-lock + fullscreen only make sense on real phone
  // hardware, so a desktop forced to Touch correctly skips them.
  if (NATIVE_APP || !isPhoneTouchDevice()) return;
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
  // Deliberately the device FACT (isPhoneTouchDevice), not the Interface Mode
  // override: the "install to home screen" preflight is phone-hardware-only, so a
  // desktop forced to Touch correctly skips it.
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

function resetMobileGameplayOverlays(): void {
  document.body.classList.remove('mobile-preflight-open', 'mobile-more-open', 'mobile-chat-open', 'mobile-chatlog-peek');
  document.getElementById('mobile-controls')?.classList.remove('expanded');
  document.getElementById('mobile-more')?.classList.remove('active');
  const preflight = document.getElementById('mobile-preflight') as HTMLElement | null;
  preflight?.classList.remove('visible');
  if (preflight) preflight.style.display = '';
  const more = document.getElementById('mobile-extra-controls') as HTMLElement | null;
  if (more) {
    more.style.left = '';
    more.style.top = '';
    more.style.right = '';
    more.style.bottom = '';
    more.style.transform = '';
    delete more.dataset.windowMoved;
  }
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
  if (NATIVE_APP) return;
  if (useTouchInterface()) {
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
}

async function prepareWorldEntry(): Promise<boolean> {
  if (hasBegunWorldEntry) return false;
  if (useTouchInterface()) {
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

async function startGame(world: IWorld, offlineSim: Sim | null, online: ClientWorld | null, keybindScope: string): Promise<void> {
  // Model/texture/HDRI fetches were kicked off at module import; the renderer
  // builds its scene synchronously, so everything must be resolved first.
  // The loading screen covers the gap - not a silent black screen.
  enterLoadingState(t('loading.world'));
  document.body.classList.add('game-active');
  // We've left the start screen for the world, so pause + release the landing
  // trailer: it's hidden now, and a decoding background video just wastes CPU/GPU
  // and battery during play.
  stopLandingTrailer();
  resetMobileGameplayOverlays();
  syncPhoneTouchClass();
  syncAppViewport();
  window.setTimeout(syncAppViewport, 250);
  window.setTimeout(syncAppViewport, 800);
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  // Paint the loading screen before anything can block — assetsReady may resolve
  // immediately when assets are already cached, and the scene build is synchronous.
  await nextPaint();
  // Lazy locale flip: fetch the active locale's chunk and make it resident before the HUD
  // renders (mountGameUi -> translatePage fans out hundreds of t() calls). It sits behind the
  // loading screen (already painted above), so a stored non-en visitor never sees an English
  // flash. This is now a REAL per-locale network request, so guard it: startGame is
  // void-invoked (see the call sites) with no .catch, and English is always resident, so a
  // failed fetch must fall back to English and keep booting rather than reject unhandled.
  try {
    await ensureLocaleLoaded(getLanguage());
  } catch {
    // Soft fallback: English is statically resident; boot in English (the picker can retry).
  }
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

  const keybinds = new Keybinds(keybindScope);
  const settings = new Settings();
  let renderer!: Renderer;
  let hud!: Hud;
  const perf = createPerfMonitor(null);
  try {
    renderer = new Renderer(world, canvas, nameplates);
    renderer.setAudioSink(sfx);
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

  // Offline only: expose the dev "2v2 Fiesta vs Bots" practice toggle to the HUD.
  if (offlineSim) hud.setFiestaPracticeHook(() => offlineSim.startFiestaPractice());

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
    // reflect the active chat-channel tab in the placeholder (e.g. "Message World")
    chatInput.placeholder = hud.activeChatPlaceholder();
    chatInput.style.display = 'block';
    chatInput.focus();
  }
  chatInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      // the active channel tab supplies the send prefix, so plain text goes to
      // that channel without the player retyping "/world" etc.
      const raw = chatInput.value;
      const text = hud.composeChatSend(raw);
      if (text) world.chat(text);
      // a typed "/join world"/"/leave lfg" opens or closes its channel tab too,
      // mirroring the "+" menu (without hijacking the active send channel)
      hud.syncChatTabsForInput(raw);
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
    onAttackMove: (x, y) => handleAttackMove(x, y),
    canUseGameKeys: () => !hud.isModalOpen() && chatInput.style.display !== 'block',
  }, keybinds);
  input.camYaw = world.player.facing;
  perf.setInputDebugProvider(() => ({
    ...input.debugState(),
    canUseGameKeys: !hud.isModalOpen() && chatInput.style.display !== 'block',
    modalOpen: hud.isModalOpen(),
    chatOpen: chatInput.style.display === 'block',
    gameInputReady,
  }));

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
    onRecenterCamera: () => input.recenterCameraBehind(world.player.facing),
  });
  mobileControls.start();
  // reflect the current music state on the touch toggle (it may already be off
  // from a prior session, persisted in localStorage)
  document.getElementById('mobile-music')?.classList.toggle('mm-muted', !music.enabled);

  // Gamepad: a separate remappable button profile drives the same dispatch the
  // keyboard/touch paths use. Edge-button actions route through this dispatcher;
  // movement/camera/jump are applied to Input directly by the manager.
  const gamepadBindings = new GamepadBindings();
  const canUseGameKeysNow = () => !hud.isModalOpen() && chatInput.style.display !== 'block';
  function dispatchGamepadAction(id: string): void {
    if (id === 'escape') { if (!hud.closeAll()) hud.toggleOptionsMenu(); return; }
    if (!canUseGameKeysNow()) return; // suppress play actions while a modal/chat is up
    if (id.startsWith('slot')) { hud.castSlot(Number(id.slice(4))); return; }
    switch (id) {
      case 'target': world.tabTarget(); break;
      case 'targetFriendly': world.targetNearestFriendly(); break;
      case 'targetFriendlyNext': world.friendlyTabTarget(); break;
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
    }
  }
  const gamepad = new GamepadManager(input, gamepadBindings, {
    onAction: (id) => dispatchGamepadAction(id),
    isPointerMode: () => hud.isWindowOpen(),
    getPlayerHealth: () => (world.player.dead ? 0 : world.player.hp),
  });
  // The startup apply-all loop (below) calls applySetting('gamepadEnabled', ...)
  // which starts/stops the manager and pushes the saved deadzone/speed/vibration.

  // Customizable performance overlay (master toggle: showFps, kept for back-compat
  // with the old FPS switch). The pure metrics + view core lives in
  // ui/perf_overlay_model; this owns the frame meter, the persisted appearance/
  // layout config (ui/perf_overlay_config, its own localStorage key), and the thin
  // DOM painter (ui/perf_overlay). Declared here (before applySetting + the startup
  // apply loop) so toggling showFps on boot doesn't hit a const's temporal dead zone.
  const perfOverlay = new PerfOverlay($('#perf-overlay') as HTMLDivElement);
  const perfConfig = new PerfOverlayConfigStore();
  const perfMeter = new FrameMeter();
  function toPerfViewCfg(c: PerfOverlayConfig): { metrics: typeof c.metrics; thresholds: boolean; graph: boolean } {
    return { metrics: c.metrics, thresholds: c.thresholds, graph: c.graph };
  }
  let perfViewCfg = toPerfViewCfg(perfConfig.get());
  function applyPerfOverlayConfig(): void {
    const c = perfConfig.get();
    perfOverlay.applyConfig(c);
    perfViewCfg = toPerfViewCfg(c);
  }
  // Settle a drag-to-move from the overlay: persist the dropped position, refresh
  // the overlay's live cfg (so reposition() does not snap it back on the next
  // render), and push the new X/Y into the open Performance panel's sliders.
  perfOverlay.onPositionChange = (x, y) => {
    perfConfig.patch({ posX: x, posY: y });
    applyPerfOverlayConfig();
    hud.onPerfOverlayMoved(x, y);
  };
  applyPerfOverlayConfig();

  // apply a setting to its live subsystem (also used to apply all on startup)
  function syncClickMoveInput(): void {
    input.setClickMoveMouseButton(settings.get('clickToMove') > 0
      ? normalizeClickMoveButton(settings.get('clickToMoveButton'))
      : null);
  }

  function syncAttackMoveInput(): void {
    input.setAttackMoveEnabled(settings.get('attackMove'));
  }

  // Engine/version/device are fixed for the session; the renderer's GPU tier is
  // resolved by now (initGfxTier ran during renderer construction). Re-stamp all
  // classes on every call so a manual Esc-menu override repaints cleanly.
  const browserEnv = readBrowserEnv();
  function applyBrowserEffects(override: number): void {
    const tier = cssEffectsTier({
      engine: browserEnv.engine,
      version: browserEnv.engineVersion,
      mobile: browserEnv.mobile,
      renderTier: GFX.tier,
      override,
    });
    const body = document.body.classList;
    body.remove(...BROWSER_BODY_CLASSES);
    body.add(...browserBodyClasses(browserEnv, tier));
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
    if (key === 'touchInvertLook') {
      input.setTouchInvertLook(settings.set('touchInvertLook', !!value));
      return;
    }
    if (key === 'filterProfanity') {
      settings.set('filterProfanity', !!value);
      return;
    }
    if (key === 'attackMove') {
      const v = settings.set('attackMove', !!value);
      if (!v) input.clearClickMove();
      syncAttackMoveInput();
      return;
    }
    // Interface & Comfort booleans: each toggles a body class (CSS does the rest)
    // or flips a live subsystem flag. No sim involvement — purely presentational.
    if (key === 'reduceMotion') {
      document.body.classList.toggle('reduce-motion', settings.set('reduceMotion', !!value));
      return;
    }
    if (key === 'highContrastText') {
      document.body.classList.toggle('high-contrast-text', settings.set('highContrastText', !!value));
      return;
    }
    if (key === 'frostedPanels') {
      document.body.classList.toggle('frosted-panels', settings.set('frostedPanels', !!value));
      return;
    }
    if (key === 'compactChat') {
      document.body.classList.toggle('compact-chat', settings.set('compactChat', !!value));
      return;
    }
    if (key === 'browserEffects') {
      applyBrowserEffects(settings.set('browserEffects', value as number));
      return;
    }
    if (key === 'showFps') {
      perfOverlay.setEnabled(settings.set('showFps', !!value));
      return;
    }
    if (key === 'showWalletOnCharacterScreen') {
      settings.set('showWalletOnCharacterScreen', !!value);
      syncWalletCharacterScreenVisibility();
      return;
    }
    if (key === 'showWalletOnPlayerCard') {
      settings.set('showWalletOnPlayerCard', !!value);
      return;
    }
    if (key === 'invertLookY') {
      input.setInvertLookY(settings.set('invertLookY', !!value));
      return;
    }
    if (key === 'gamepadEnabled') {
      const v = settings.set('gamepadEnabled', !!value);
      if (v) gamepad.start();
      else gamepad.stop();
      return;
    }
    if (key === 'gamepadInvertY') {
      gamepad.setInvertY(settings.set('gamepadInvertY', !!value));
      return;
    }
    if (key === 'voiceEnabled') {
      voice.setEnabled(settings.set('voiceEnabled', !!value));
      return;
    }
    if (key === 'footstepSfx') {
      sfx.setFootstepsEnabled(settings.set('footstepSfx', !!value));
      return;
    }
    if (key === 'landingHighContrast') {
      // Mirror of the start-screen toggle; keeps the persisted preference in sync
      // and re-applies the backdrop (the landing page is hidden in-game, but the
      // setting still takes effect next time the start screen is shown / reloaded).
      applyLandingBackdrop(settings.set('landingHighContrast', !!value));
      return;
    }
    const v = settings.set(key as keyof typeof SETTING_RANGES, value as number);
    switch (key) {
      case 'cameraSpeed': input.setCameraSpeed(v); break;
      case 'touchLookSpeed': input.setTouchLookSpeed(v); break;
      case 'sfxVolume': audio.setVolume(v); sfx.setVolume(v); break;
      case 'musicVolume': music.setVolume(v); break;
      case 'voiceVolume': voice.setVolume(v); break;
      case 'brightness': renderer.setBrightness(v); break;
      case 'cameraFov': renderer.setCameraFov(v); break;
      case 'renderScale': renderer.setRenderScale(v); break;
      case 'fullscreen': v >= 0.5 ? requestPreferredFullscreen() : exitBrowserFullscreen(); break;
      case 'clickToMove': if (v < 0.5) input.clearClickMove(); syncClickMoveInput(); break;
      case 'clickToMoveButton': syncClickMoveInput(); break;
      case 'touchOpacity': document.documentElement.style.setProperty('--touch-opacity', String(v)); break;
      case 'weather': renderer.setWeatherEnabled(v >= 0.5); break;
      case 'joystickScale':
        document.getElementById('mobile-controls')?.style.setProperty('--joy-scale', String(v));
        break;
      case 'actionButtonScale': document.getElementById('mobile-controls')?.style.setProperty('--btn-scale', String(v)); break;
      case 'joystickDeadzone': mobileControls.setMoveDeadzone(v); break;
      case 'interfaceMode':
        // Desktop/touch override: update the resolver, then re-apply the layout
        // (body class, stable viewport) and the on-screen controls live so the
        // switch takes effect without a reload.
        setInterfaceMode(interfaceModeFromSetting(v));
        syncPhoneTouchClass();
        syncAppViewport();
        mobileControls.refreshInterfaceMode();
        break;
      case 'gamepadStickDeadzone': gamepad.setDeadzone(v); break;
      case 'gamepadCameraSpeed': gamepad.setCameraSpeed(v); break;
      case 'gamepadVibration': gamepad.setVibration(v); break;
      // Interface & Comfort sliders: each drives one CSS custom property that
      // index.html consumes. Setting them on :root keeps the HUD authoritative.
      case 'tooltipScale': document.documentElement.style.setProperty('--tooltip-scale', String(v)); break;
      case 'chatFontScale': document.documentElement.style.setProperty('--chat-font-scale', String(v)); break;
      case 'chatOpacity': document.documentElement.style.setProperty('--chat-opacity', String(v)); break;
      case 'fctScale': document.documentElement.style.setProperty('--fct-scale', String(v)); break;
      case 'hudOpacity': document.documentElement.style.setProperty('--hud-opacity', String(v)); break;
      case 'uiScale': document.documentElement.style.setProperty('--ui-scale', String(v)); break;
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
    changeLanguage: (lang, onStatus) => changeLanguage(lang, onStatus),
    refreshWocBalance: () => refreshWocBalanceOnDemand(),
    perfOverlay: {
      get: () => perfConfig.get(),
      patch: (p) => { perfConfig.patch(p); applyPerfOverlayConfig(); },
      setMetric: (k, on) => { perfConfig.setMetric(k, on); applyPerfOverlayConfig(); },
      reset: () => { perfConfig.reset(); applyPerfOverlayConfig(); },
      resetPosition: () => { perfConfig.resetPosition(); applyPerfOverlayConfig(); },
      setPlacement: (on) => perfOverlay.setPlacementMode(on),
    },
    gamepad: gamepadBindings,
  });
  if (online) {
    hud.attachReporting({
      submit: (targetPid, reason, details) => api.reportPlayer(online.characterId, targetPid, reason, details),
      submitByName: (targetName, reason, details) => api.reportPlayerByName(online.characterId, targetName, reason, details),
    });
    hud.attachBugReporting({
      capture: () => renderer?.captureScreenshot() ?? null,
      collectMeta: () => assembleBugReportMeta({
        build: `${__APP_VERSION__} (${__APP_BUILD_ID__})`,
        userAgent: navigator.userAgent,
        viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
        zone: zoneBiomeAt(world.player.pos.z),
        level: world.player.level,
        // Entity has no `cls`; the player's class is its templateId (see Entity).
        className: world.player.templateId,
        cameraYaw: renderer?.camYaw ?? 0,
      }),
      submit: (payload) => api.submitBugReport({
        characterId: online.characterId,
        characterName: world.player.name,
        pos: { x: world.player.pos.x, y: world.player.pos.y, z: world.player.pos.z },
        description: payload.description,
        screenshot: payload.screenshot,
        meta: payload.meta,
      }),
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
    const activePvpOpponents = activePvpOpponentIds(world);
    let best: number | null = null;
    let bestD = 40;
    for (const e of world.entities.values()) {
      if (!isAttackableEntity(e, world.playerId, activePvpOpponents)) continue;
      const d = dist2d(p.pos, e.pos);
      if (d < bestD) { best = e.id; bestD = d; }
    }
    if (best === null) { hud.showError(t('errors.noEnemyNearby')); return; }
    world.targetEntity(best);
    world.startAutoAttack();
  }

  function clickMovePathTo(target: { x: number; z: number }): { x: number; z: number }[] {
    // ignoreFences: the player can hop fences, so route straight over them
    // instead of around — resolveMove fires the jump as we reach the rail.
    // swim: the player can swim, so let the route cross/enter water.
    return findPlayerPath(world.cfg.seed, world.player.pos, target, undefined, true, true);
  }

  function resolvedClickMoveTarget(target: { x: number; z: number }): { x: number; z: number } {
    // swim: keep a clicked water destination instead of snapping it to shore.
    return resolvePlayerDestination(world.cfg.seed, target, true);
  }

  function handlePick(x: number, y: number, button: number): void {
    const id = renderer.pick(x, y);
    // OSRS-style click feedback (its own toggle): a brief ground marker, gold for a
    // neutral click and red on a hostile. Both reference games only mark a real action,
    // so the marker stamps where a click actually does something: the click-to-move
    // destination (OSRS's yellow "walking here" X) and an entity you target or walk to
    // (OSRS's red interaction X). A plain ground click that only deselects gets nothing.
    const wantClickFeedback = settings.get('clickFeedback') && !world.player.dead;
    const clickToMove = settings.get('clickToMove') > 0 && !world.player.dead;
    const clickToMoveButton = normalizeClickMoveButton(settings.get('clickToMoveButton'));
    const isClickMoveButton = clickToMove && button === clickToMoveButton;
    if (id === null) {
      if (button === 0) {
        world.targetEntity(null);
      }
      // One ground raycast feeds both the move target and its marker, so the gold
      // marker appears only where the click actually sends you.
      if (isClickMoveButton) {
        const g = renderer.groundPoint(x, y, world.player.pos.y);
        if (g) {
          if (wantClickFeedback) renderer.spawnClickMarker(g.x, g.z, false);
          const target = resolvedClickMoveTarget(g);
          input.setClickMoveTarget(target, 0.5, null, clickMovePathTo(target));
        }
      }
      return;
    }
    const e = world.entities.get(id);
    if (e && e.id !== world.player.id) {
      // Mark the entity when you engage it: a left-click target, or the click-to-move
      // button that walks you to it, so both routes read the same (red on a hostile,
      // gold otherwise).
      if (wantClickFeedback && (button === 0 || isClickMoveButton)) {
        const hostile = isAttackableEntity(e, world.playerId, activePvpOpponentIds(world));
        renderer.spawnClickMarker(e.pos.x, e.pos.z, hostile);
      }
      // The configured click-to-move mouse button approaches the entity while the
      // regular click handler still performs target/interact behavior.
      if (isClickMoveButton) {
        const target = resolvedClickMoveTarget({ x: e.pos.x, z: e.pos.z });
        input.setClickMoveTarget(target, 3.5, e.id, clickMovePathTo(target));
      }
    }
    handlePickedEntity(world, hud, id, button, x, y);
  }

  // Attack Move (MOBA-style): the Attack Move key walks the player toward the
  // cursor and auto-attacks. If a hostile mob is under the cursor we chase + hit
  // it; otherwise we move to the ground point and pick up the nearest hostile met
  // along the way (see attackMoveTick). Reuses the click-to-move travel pipeline.
  function handleAttackMove(x: number, y: number): void {
    if (world.player.dead) return;
    const id = renderer.pick(x, y);
    if (id !== null) {
      const e = world.entities.get(id);
      if (e && isAttackableEntity(e, world.playerId, activePvpOpponentIds(world))) {
        world.targetEntity(id);
        const target = resolvedClickMoveTarget({ x: e.pos.x, z: e.pos.z });
        input.setClickMoveTarget(target, ATTACK_MOVE_MELEE_STOP, e.id, clickMovePathTo(target), true);
        return;
      }
    }
    const g = renderer.groundPoint(x, y, world.player.pos.y);
    if (g) {
      const target = resolvedClickMoveTarget(g);
      input.setClickMoveTarget(target, 0.5, null, clickMovePathTo(target), true);
    }
  }

  // Per-tick attack-move driving: acquire a hostile near a ground attack-move, and
  // start swinging once we're in melee of an attack-move target. Movement itself
  // is handled by the shared click-to-move path in resolveMove.
  let attackMoveEngagedId: number | null = null;
  function attackMoveTick(): void {
    if (!input.clickMoveAttack || world.player.dead) {
      attackMoveEngagedId = null;
      return;
    }
    // Ground attack-move: latch onto the nearest hostile within range, converting
    // it into a chase (entityId set → resolveMove reroutes toward it each tick).
    if (input.clickMoveEntityId === null) {
      const p = world.player;
      const activePvpOpponents = activePvpOpponentIds(world);
      let best: number | null = null;
      let bestD = ATTACK_MOVE_ACQUIRE_RANGE;
      for (const e of world.entities.values()) {
        if (!isAttackableEntity(e, world.playerId, activePvpOpponents)) continue;
        const d = dist2d(p.pos, e.pos);
        if (d < bestD) { best = e.id; bestD = d; }
      }
      if (best !== null) {
        const e = world.entities.get(best)!;
        world.targetEntity(best);
        const target = resolvedClickMoveTarget({ x: e.pos.x, z: e.pos.z });
        input.setClickMoveTarget(target, ATTACK_MOVE_MELEE_STOP, best, clickMovePathTo(target), true);
      }
    }
    // Chasing a target: once inside melee, start the auto-attack (once per target).
    const chaseId = input.clickMoveEntityId;
    if (chaseId !== null) {
      const e = world.entities.get(chaseId);
      if (e && isAttackableEntity(e, world.playerId, activePvpOpponentIds(world))
          && dist2d(world.player.pos, e.pos) <= MELEE_RANGE) {
        if (attackMoveEngagedId !== chaseId) {
          world.targetEntity(chaseId);
          world.startAutoAttack();
          attackMoveEngagedId = chaseId;
        }
      } else if (attackMoveEngagedId !== chaseId) {
        attackMoveEngagedId = null;
      }
    } else {
      attackMoveEngagedId = null;
    }
  }

  // The player can't move toward a click-to-move destination while rooted/stunned
  // — surface that on the marker so the freeze reads as crowd control, not a bug.
  function playerImmobilized(): boolean {
    return world.player.auras.some((a) => IMMOBILE_AURA_KINDS.has(a.kind));
  }

  // Pop a "Can't move!" note over the player when a movement command lands while
  // immobilized, so the freeze is legible. Throttled so it doesn't spam per tick.
  let lastImmobileNoteAt = -Infinity;
  function maybeShowImmobileNote(nowMs: number): void {
    if (world.player.dead || !playerImmobilized()) return;
    const mi = input.readMoveInput();
    const tryingToMove = !!input.clickMoveTarget
      || mi.forward || mi.back || mi.strafeLeft || mi.strafeRight || mi.turnLeft || mi.turnRight;
    if (!tryingToMove || nowMs - lastImmobileNoteAt < IMMOBILE_NOTE_THROTTLE_MS) return;
    lastImmobileNoteAt = nowMs;
    hud.showSelfNote(t('hud.combat.cannotMove'));
  }

  // Stuck-detection for click-to-move: a path can route over a fence the player
  // jumps, but some fences sit on banks too steep to climb. If the player stops
  // physically moving for a while (hopping in place at the fence), reroute around
  // the obstacle (fences as walls); if still stuck after that, give up instead of
  // hopping forever. We track actual displacement, not distance-to-goal, so a
  // legitimate long detour (e.g. around a building) isn't mistaken for stuck.
  let clickMoveStuckPulse = -1;
  let clickMoveAnchor = { x: 0, z: 0 };
  let clickMoveStuckSince = 0;
  let clickMoveReroutedAround = false;

  let lastClickMoveMarkerPulse = -1;
  let clickMoveMarkerHideAt = 0;
  function updateClickMoveMarker(nowMs = performance.now()): void {
    const pulseChanged = lastClickMoveMarkerPulse !== input.clickMovePulse;
    if (pulseChanged) {
      lastClickMoveMarkerPulse = input.clickMovePulse;
      clickMoveMarkerHideAt = nowMs + 300;
    }
    const target = input.clickMoveGoal ?? input.clickMovePulseTarget;
    const show = !!target && (settings.get('clickToMove') > 0 || settings.get('attackMove')) && !world.player.dead
      && (!!input.clickMoveTarget || nowMs < clickMoveMarkerHideAt);
    if (!show) {
      clickMoveMarker.classList.remove('active', 'entity', 'pulse', 'blocked');
      return;
    }
    const screen = renderer.worldToScreen(target.x, world.player.pos.y + 0.05, target.z);
    const offscreen = screen.behind
      || screen.x < -80 || screen.x > window.innerWidth + 80
      || screen.y < -80 || screen.y > window.innerHeight + 80;
    if (offscreen) {
      clickMoveMarker.classList.remove('active', 'pulse', 'blocked');
      return;
    }
    clickMoveMarker.style.transform = `translate(${screen.x.toFixed(0)}px, ${screen.y.toFixed(0)}px) translate(-50%, -50%)`;
    clickMoveMarker.classList.toggle('entity', input.clickMoveEntityId !== null);
    // Only meaningful for a live destination you're still trying to reach (not the
    // brief post-arrival fade), so gate on an active target.
    clickMoveMarker.classList.toggle('blocked', !!input.clickMoveTarget && playerImmobilized());
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
  let onlineInputEchoMs = 0;
  // Smoothed input-echo jitter (mean absolute deviation of RTT samples) for the
  // perf overlay's Jitter row.
  let onlineJitterMs = 0;
  let gameInputReady = false;

  // Camera follow state: keyboard turning advances facing in 20Hz sim steps,
  // so the camera tracks the player's render-interpolated facing per frame
  // (same curve the character model follows) instead of the raw tick deltas -
  // that's what killed the turn stutter. While running, the orbit offset
  // eases back to zero so the camera settles in behind the character.
  let lastInterpFacing: number | null = null;
  let wasClickMoving = false;
  function updateCamera(frameDt: number, interpFacing: number): void {
    const mi = input.readMoveInput();
    const clickMoving = !!input.clickMoveTarget && !input.suspendMovement && !world.player.dead;
    // When click-to-move ends, the player's facing snaps from the (camera-lagging)
    // travel bearing to camYaw in the same frame. lastInterpFacing still holds the
    // old travel bearing, so the rigid follow term would inject that whole stale
    // delta and ring out as a camera shake. Resync it on the falling edge so the
    // handoff stays smooth even in pure-follow (non-camera-driven) mode.
    if (wasClickMoving && !clickMoving) lastInterpFacing = interpFacing;
    wasClickMoving = clickMoving;
    const next = updateFollowCameraYaw({
      camYaw: input.camYaw,
      interpFacing,
      frameDt,
      lastInterpFacing,
      mouselook: input.isMouselookActive(),
      moving: cameraFollowShouldSettle(mi, clickMoving),
      clickMoving,
      cameraDriven: input.isMouseCameraMode() && cameraMoveActive(),
      orbiting: input.leftDown && input.isCameraDragActive(),
    });
    input.camYaw = next.camYaw;
    lastInterpFacing = next.lastInterpFacing; // track through mouselook too — no snap on release
  }

  // Resolve this step's movement input, folding in click-to-move (#95). Returns
  // the move flags plus an optional forced facing (mouselook angle, or the
  // bearing toward a click-to-move destination). Any manual movement, an open
  // modal, mouselook, death, or the option being switched off cancels click-to-move.
  function clickMoveStopForCurrentWaypoint(latencyMs: number): number {
    const cappedLatencyMs = Math.min(CLICK_MOVE_LATENCY_STOP_CAP_MS, Math.max(0, latencyMs));
    return latencyAdjustedStopDistance(
      input.isClickMoveFinalWaypoint() ? input.clickMoveStop : CLICK_MOVE_WAYPOINT_STOP,
      cappedLatencyMs,
      RUN_SPEED,
      input.isClickMoveFinalWaypoint() ? CLICK_MOVE_LATENCY_STOP_MAX_EXTRA : CLICK_MOVE_LATENCY_WAYPOINT_MAX_EXTRA,
    );
  }

  function resolveMove(mouselook: boolean, playerPos: { x: number; z: number }, playerFacing: number, latencyMs = 0):
    { mi: ReturnType<typeof input.readMoveInput>; facing: number | null } {
    attackMoveTick();
    const mi = input.readMoveInput();
    let facing: number | null = mouselook ? input.camYaw : null;
    if (input.clickMoveTarget) {
      const action = resolveClickMoveAction(mi, {
        mouselook,
        movementSuspended: input.suspendMovement,
        playerDead: world.player.dead,
        enabled: settings.get('clickToMove') > 0 || settings.get('attackMove'),
      });
      if (action === 'cancel') {
        input.clearClickMove();
      } else if (action === 'pause') {
        // Game menu is up: hold the destination and stand still; the run resumes
        // when the menu closes. mi is already all-false here (movement suspended).
        return { mi, facing };
      } else {
        if (input.clickMoveEntityId !== null) {
          const e = world.entities.get(input.clickMoveEntityId);
          if (!e || e.dead || e.id === world.player.id) {
            input.clearClickMove();
            return { mi, facing };
          }
          const target = resolvedClickMoveTarget({ x: e.pos.x, z: e.pos.z });
          if (!input.clickMoveGoal || distance2d(input.clickMoveGoal, target) > CLICK_MOVE_REROUTE_DISTANCE) {
            input.rerouteClickMoveTarget(target, clickMovePathTo(target));
          }
        }
        let waypoint = input.clickMoveTarget;
        if (!waypoint) return { mi, facing };
        let step = clickMoveStep(
          playerPos,
          waypoint,
          clickMoveStopForCurrentWaypoint(latencyMs),
        );
        while (step.arrived && input.advanceClickMoveWaypoint()) {
          waypoint = input.clickMoveTarget;
          if (!waypoint) break;
          step = clickMoveStep(
            playerPos,
            waypoint,
            clickMoveStopForCurrentWaypoint(latencyMs),
          );
        }
        if (step.arrived) {
          if (!input.advanceClickMoveWaypoint()) input.clearClickMove();
        } else {
          const fromFacing = input.clickMoveFacing ?? playerFacing;
          const smoothFacing = stepAngleToward(fromFacing, step.facing, CLICK_MOVE_TURN_RATE * DT);
          input.clickMoveFacing = smoothFacing;
          facing = smoothFacing;
          // Walk only when aimed at the destination; otherwise turn in place so
          // we don't orbit the target when the bearing swings faster than we
          // can turn at close range.
          mi.forward = clickMoveShouldWalk(smoothFacing, step.facing);
          // The path can route over fences (the player jumps them), so hop when
          // one is just ahead along our heading — the sim only jumps while
          // grounded, so setting this every frame near a fence is safe. Once we
          // give up on jumping and reroute around, stop auto-hopping.
          if (mi.forward && !clickMoveReroutedAround) {
            const ahead = {
              x: playerPos.x + Math.sin(smoothFacing) * CLICK_MOVE_FENCE_JUMP_LOOKAHEAD,
              z: playerPos.z + Math.cos(smoothFacing) * CLICK_MOVE_FENCE_JUMP_LOOKAHEAD,
            };
            if (pathCrossesFence(playerPos.x, playerPos.z, ahead.x, ahead.z)) mi.jump = true;
          }
        }
        // Track displacement so a fence we can't actually clear doesn't trap us
        // in an endless jump loop: if we stop moving, reroute around it, then give up.
        const goal = input.clickMoveGoal;
        if (goal && mi.forward && !playerImmobilized()) {
          const now = performance.now();
          if (input.clickMovePulse !== clickMoveStuckPulse) {
            clickMoveStuckPulse = input.clickMovePulse;
            clickMoveAnchor = { x: playerPos.x, z: playerPos.z };
            clickMoveStuckSince = now;
            clickMoveReroutedAround = false;
          }
          if (distance2d(playerPos, clickMoveAnchor) > CLICK_MOVE_PROGRESS_EPSILON) {
            clickMoveAnchor = { x: playerPos.x, z: playerPos.z };
            clickMoveStuckSince = now;
          } else if (now - clickMoveStuckSince > CLICK_MOVE_STUCK_MS) {
            if (!clickMoveReroutedAround) {
              clickMoveReroutedAround = true;
              clickMoveAnchor = { x: playerPos.x, z: playerPos.z };
              clickMoveStuckSince = now;
              input.rerouteClickMoveTarget(goal, findPlayerPath(world.cfg.seed, world.player.pos, goal, undefined, false, true));
            } else {
              input.clearClickMove();
            }
          }
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
    input.setHoverCursor(hoverCursorKind(entity, world.playerId, partyMemberIds(), activePvpOpponentIds(world)));
  }

  function renderFacingOverride(): number | null {
    if (input.isMouseCameraMode()) {
      return cameraMoveActive() ? input.camYaw : null;
    }
    return input.isMouselookActive() && !world.player.dead ? input.camYaw : null;
  }

  function cameraMoveActive(): boolean {
    if (!input.isMouseCameraMode()) return false;
    const mi = input.readMoveInput();
    return !!(mi.forward || mi.back || mi.strafeLeft || mi.strafeRight) && !world.player.dead;
  }

  // Feed the frame meter every frame (so stats stay warm even when hidden) and,
  // when the overlay is on, repaint at the meter's throttle (~4 Hz). Sample
  // assembly + the DOM paint only happen on a repaint tick, never per frame.
  function syncPerfOverlay(frameDt: number, nowMs: number): void {
    const repaint = perfMeter.step(frameDt, nowMs);
    if (!perfOverlay.isEnabled() || !repaint) return;
    perfOverlay.render(buildPerfOverlayView(sampleMetrics(), perfViewCfg));
  }

  // Gather the raw, nullable signals the overlay can surface. Renderer/browser
  // fields reflect the last rendered frame (fine at 4 Hz); network fields are
  // online-only and null offline; Chromium-only sources (heap, connection) report
  // null elsewhere so their rows simply hide. The pure assembly lives in
  // perf_metrics_sampler.ts; here we inject the live sources.
  // Input-activity meter for the overlay APM readout
  const inputMeter = new InputActivityMeter();
  installInputActivityTracking(inputMeter, window, () => performance.now());
  const APM_BEAT_MS = 10_000;
  window.setInterval(() => {
    world.reportTelemetry('apm', { count: inputMeter.drainCount(), periodMs: APM_BEAT_MS });
  }, APM_BEAT_MS);

  const sampleMetrics = createMetricsSampler({
    renderer,
    meter: perfMeter,
    getOnline: () => online,
    getEntityCount: () => world.entities.size,
    getEchoMs: () => onlineInputEchoMs,
    getJitterMs: () => onlineJitterMs,
    getApm: () => inputMeter.apm(performance.now()),
  });

  function frame(now: number): void {
    requestAnimationFrame(frame);
    let frameDt = (now - last) / 1000;
    last = now;
    if (frameDt > 0.25) frameDt = 0.25;
    perf.frame(frameDt);
    syncPerfOverlay(frameDt, now);

    // freeze movement while the game menu is up so WASD doesn't walk the
    // character behind it (other windows stay non-modal, as before)
    input.suspendMovement = !gameInputReady || hud.isModalOpen();
    perf.trace('input.updateTouchLook', () => input.updateTouchLook(frameDt), { frameDtMs: frameDt * 1000 });
    perf.trace('input.gamepad', () => gamepad.poll(frameDt), { frameDtMs: frameDt * 1000 });
    perf.trace('input.hoverCursor', () => updateHoverCursor(), { active: input.hoverActive });
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
        offlineSim.updateFiestaBots(); // dev: steer Fiesta practice bots (no-op unless active)
        perf.markInputSent(performance.now());
        const events = perf.time('sim', () => perf.trace('sim.tick', () => offlineSim.tick(), { mode: 'offline' }));
        perf.time('events', () => perf.trace('hud.handleEvents', () => hud.handleEvents(events), {
          mode: 'offline',
          events: events.length,
        }));
        acc -= DT;
      }
      const pp = offlineSim.player;
      perf.trace('camera.follow', () => updateCamera(frameDt, pp.prevFacing + wrapAngle(pp.facing - pp.prevFacing) * (acc / DT)), {
        mode: 'offline',
        frameDtMs: frameDt * 1000,
      });
      renderer.camYaw = input.camYaw;
      renderer.camPitch = input.camPitch;
      renderer.camDist = input.camDist;
      perf.setNetwork(null);
      perf.time('renderer', () => perf.trace('renderer.sync', () => renderer.sync(acc / DT, frameDt, movementFacing), {
        mode: 'offline',
        views: renderer.views.size,
        alpha: acc / DT,
      }));
      perf.trace('ui.clickMoveMarker', () => updateClickMoveMarker());
      perf.markInputVisible(performance.now());
      perf.time('hud', () => perf.trace('hud.update', () => hud.update(), { mode: 'offline' }));
      perf.tick(now);
      return;
    }

    // online: inputs stream on a timer inside ClientWorld; here we mirror state
    const net = online!;
    const resolved = resolveMove(mouselook, world.player.pos, world.player.facing, onlineInputEchoMs);
    const netFacing = movementFacing ?? resolved.facing;
    Object.assign(net.moveInput, resolved.mi);
    net.setMouselookFacing(netFacing);
    if (net.flushInput()) perf.markInputSent(performance.now());
    const echoSamples = net.consumeInputEchoSamples();
    for (const sample of echoSamples) {
      if (Number.isFinite(sample) && sample >= 0) {
        // Jitter is the mean absolute deviation against the PRIOR mean (measuring
        // it after the EMA update would bias it low).
        const prevMean = onlineInputEchoMs;
        onlineInputEchoMs = prevMean === 0 ? sample : prevMean + 0.2 * (sample - prevMean);
        const dev = prevMean === 0 ? 0 : Math.abs(sample - prevMean);
        onlineJitterMs = onlineJitterMs === 0 ? dev : onlineJitterMs + 0.2 * (dev - onlineJitterMs);
      }
      perf.markInputEcho(sample);
    }
    net.pendingFacingDelta = 0; // superseded by the interpolated follow below
    const drainedEvents = net.drainEvents();
    perf.time('events', () => perf.trace('hud.handleEvents', () => hud.handleEvents(drainedEvents), {
      mode: 'online',
      events: drainedEvents.length,
    }));
    if (net.consumeProfanityChanged()) {
      perf.trace('hud.setProfanityWords', () => hud.setProfanityWords(net.profanityWords), { words: net.profanityWords.length });
    }
    if (net.consumeInventoryChanged()) {
      perf.trace('hud.onInventoryChanged', () => hud.onInventoryChanged());
    }
    if (net.consumeCosmeticsChanged()) {
      perf.trace('hud.onCosmeticsChanged', () => hud.onCosmeticsChanged());
    }
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
    perf.trace('camera.follow', () => updateCamera(frameDt, pe.prevFacing + wrapAngle(pe.facing - pe.prevFacing) * Math.min(1, alpha)), {
      mode: 'online',
      alpha,
      frameDtMs: frameDt * 1000,
      lastSnapAge: net.lastSnapAt > 0 ? performance.now() - net.lastSnapAt : -1,
    });
    renderer.camYaw = input.camYaw;
    renderer.camPitch = input.camPitch;
    renderer.camDist = input.camDist;
    perf.time('renderer', () => perf.trace('renderer.sync', () => renderer.sync(alpha, frameDt, movementFacing, ONLINE_SELF_RENDER_ALPHA_LEAD), {
      mode: 'online',
      views: renderer.views.size,
      alpha,
      frameDtMs: frameDt * 1000,
    }));
    perf.trace('ui.clickMoveMarker', () => updateClickMoveMarker());
    maybeShowImmobileNote(now);
    perf.markInputVisible(performance.now());
    perf.time('hud', () => perf.trace('hud.update', () => hud.update(), { mode: 'online' }));
    perf.tick(now);
  }
  const controller = {
    move(moveInput: unknown, facing?: unknown) {
      if (arguments.length > 1) input.setControllerMoveInput(moveInput, facing);
      else input.setControllerMoveInput(moveInput);
    },
    face(facing: unknown) { input.setControllerFacing(facing); },
    stop() { input.clearControllerMoveInput(); },
  };
  input.suspendMovement = true;
  await nextPaint();
  try {
    await renderer.prewarmInitialScene();
  } catch (err) {
    console.warn('Renderer prewarm failed', err);
  }
  await nextPaint();
  last = performance.now();
  requestAnimationFrame(frame);
  // cut to the game only once the first frame is actually on screen
  requestAnimationFrame(() => requestAnimationFrame(() => {
    hideLoadingScreen();
    window.setTimeout(() => {
      gameInputReady = true;
      perf.reset();
      startPerfReporter({
        perf,
        settings,
        tokenProvider: () => api.token,
        characterIdProvider: () => online?.characterId ?? null,
      });
      (window as any).__game = { sim: world, world, renderer, input, hud, online, controller, perf, gamepad };
    }, LOADING_FADE_MS);
  }));
  // Now in-game: fade the home-page theme out (it kept playing through loading).
  fadeOutHomepageMusic();
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
  // Offline characters are not persisted (a fresh name is typed each session),
  // so the only stable handle is class + name. Keybinds scope to that pair.
  void startGame(sim, sim, null, `offline:${playerClass}:${name}`);
}

// ---------------------------------------------------------------------------
// Online flow: login -> character select -> world
// ---------------------------------------------------------------------------

const api = new Api();

// Referral capture: a visitor who arrives from a shared player card link
// (?ref=<slug>) carries the referrer's slug into registration. Read it once at
// load and sanitise it to the server's slug shape so a junk param is dropped.
const REFERRAL_SLUG = (() => {
  const raw = new URLSearchParams(location.search).get('ref') ?? '';
  const slug = raw.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(slug) ? slug : '';
})();

let activeTransitionTimeout: number | null = null;
let activeTransitionCleanup: (() => void) | null = null;
let characterPreview: CharacterPreview | null = null;
let authModeApply: ((mode: 'login' | 'register') => void) | null = null;
let offlineSkin = 0; // chosen appearance skin for the offline quick-start character
let onlineSkin = 0; // chosen appearance skin for new online characters

/** Fill a skin-picker row with one option per available skin, each showing an
 *  actual 2D portrait preview of the character in that chroma. */
function renderSkinPicker(rowId: string, cls: PlayerClass, current: number, onPick: (i: number) => void): void {
  const row = $(rowId) as HTMLElement | null;
  if (!row) return;
  row.innerHTML = '';
  const count = skinCount(`player_${cls}`);
  const picker = row.closest('.skin-picker') as HTMLElement | null;
  if (count <= 1) { // only the default exists — nothing to pick
    if (picker) picker.style.display = 'none';
    return;
  }
  if (picker) picker.style.display = '';
  row.style.setProperty('--class-color', '#' + CLASSES[cls].color.toString(16).padStart(6, '0'));
  for (let i = 0; i < count; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'skin-swatch skin-swatch-portrait' + (i === current ? ' sel' : '');
    b.dataset.skin = String(i);
    b.setAttribute('role', 'listitem');
    b.setAttribute('aria-label', t('auth.chromaOption', { n: i + 1 }));
    const url = playerPortraitDataUrl(cls, i);
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.className = 'skin-swatch-img';
      b.appendChild(img);
    } else {
      b.textContent = String(i + 1);
    }
    b.addEventListener('click', () => {
      row.querySelectorAll('.skin-swatch').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      onPick(i);
    });
    // Live-preview the chroma on the right avatar while hovering; revert on leave.
    b.addEventListener('mouseenter', () => characterPreview?.setSkin(i));
    b.addEventListener('mouseleave', () => {
      const sel = row.querySelector('.skin-swatch.sel') as HTMLElement | null;
      characterPreview?.setSkin(sel ? Number(sel.dataset.skin ?? 0) || 0 : current);
    });
    row.appendChild(b);
  }
}

/** Give each class button a small portrait preview of that class (run once
 *  character assets are ready so portraits render synchronously). */
function decorateClassChips(): void {
  document.querySelectorAll<HTMLElement>('#charcreate-panel .mini-class, #offline-select .mini-class').forEach((li) => {
    if (li.querySelector('.mini-class-portrait')) return;
    const cls = li.dataset.class as PlayerClass;
    const key = li.dataset.i18n;
    const label = document.createElement('span');
    label.className = 'mini-class-label';
    if (key) label.dataset.i18n = key;
    label.textContent = (li.textContent ?? '').trim();
    li.removeAttribute('data-i18n'); // moved onto the label so i18n won't wipe the portrait
    li.textContent = '';
    const img = document.createElement('img');
    img.className = 'mini-class-portrait';
    img.alt = '';
    const url = playerPortraitDataUrl(cls, 0);
    if (url) img.src = url;
    li.appendChild(img);
    li.appendChild(label);
    li.classList.add('has-portrait');
  });
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
  const containerId =
    panelId === '#charselect-panel' ? '#online-preview-container'
    : panelId === '#charcreate-panel' ? '#charcreate-preview-container'
    : '#offline-preview-container';
  const container = $(containerId);
  if (!container) return;
  characterPreview.setContainer(container);

  if (panelId === '#charselect-panel') {
    // The selected roster row drives the showcase (class + that character's chroma).
    const row = document.querySelector('#char-list .char-row.sel') as HTMLElement | null;
    const cls = (row?.dataset.class as PlayerClass) ?? 'warrior';
    characterPreview.setClass(cls);
    characterPreview.setSkin(Number(row?.dataset.skin ?? 0) || 0);
    syncPreviewAfterPanelLayout();
    return;
  }

  const selSelector = panelId === '#charcreate-panel'
    ? '#charcreate-panel .mini-class.sel'
    : '#offline-select .mini-class.sel';
  const selEl = document.querySelector(selSelector) as HTMLElement | null;
  if (selEl) {
    const cls = selEl.dataset.class as PlayerClass;
    characterPreview.setClass(cls);
    if (panelId === '#charcreate-panel') refreshOnlineSkins(cls);
    else refreshOfflineSkins(cls);
  }

  syncPreviewAfterPanelLayout();
}

function syncPreviewAfterPanelLayout(): void {
  characterPreview?.syncSize();
  requestAnimationFrame(() => {
    characterPreview?.syncSize();
    requestAnimationFrame(() => characterPreview?.syncSize());
  });
}

const currentlyRenderedClass: Record<string, PlayerClass | null> = {
  'offline-class-details': null,
  'charselect-class-details': null,
  'charcreate-class-details': null
};
const revertTimeouts: Record<string, number | null> = {
  'offline-class-details': null,
  'charselect-class-details': null,
  'charcreate-class-details': null
};
const hoverTimeouts: Record<string, number | null> = {
  'offline-class-details': null,
  'charselect-class-details': null,
  'charcreate-class-details': null
};

function switchMainView(targetId: string): void {
  const views = ['#hero-view', '#highscores-view', '#news-view', '#download-view', '#account-view'];
  const currentViewId = views.find(id => {
    const el = $(id);
    return el && !el.hasAttribute('hidden');
  });

  if (currentViewId === targetId) return;

  const navMap: Record<string, string> = {
    '#hero-view': 'nav-btn-play',
    '#highscores-view': 'nav-btn-highscores',
    '#news-view': 'nav-btn-news',
    '#download-view': 'nav-btn-download',
    '#account-view': 'nav-btn-account'
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

    // The key-art backdrop is for the Play page only; hide it on other views.
    const onPlayPage = targetId === '#hero-view';
    const backdrop = document.getElementById('start-screen-backdrop');
    if (backdrop) backdrop.classList.toggle('trailer-off', !onPlayPage);

    if (targetId === '#hero-view') {
      const activePlayPanel = ['#charselect-panel', '#charcreate-panel', '#offline-select'].find(id => {
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
  if (el === '#login-panel') { ensureTurnstile(); authModeApply?.('login'); }

  const logoImg = $('#title-logo');
  if (logoImg) {
    const shouldHideLogo = el === '#charselect-panel' || el === '#charcreate-panel' || el === '#offline-select';
    logoImg.toggleAttribute('hidden', shouldHideLogo);
  }

  if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) {
    document.activeElement.blur();
  }

  // Reset currently rendered classes to force re-render/animation when opening a panel
  for (const key of ['offline-class-details', 'charselect-class-details', 'charcreate-class-details']) {
    currentlyRenderedClass[key] = null;
    if (revertTimeouts[key] !== null && revertTimeouts[key] !== undefined) {
      window.clearTimeout(revertTimeouts[key]!);
      revertTimeouts[key] = null;
    }
    if (hoverTimeouts[key] !== null && hoverTimeouts[key] !== undefined) {
      window.clearTimeout(hoverTimeouts[key]!);
      hoverTimeouts[key] = null;
    }
  }

  const panels = ['#mode-select', '#login-panel', '#realm-panel', '#charselect-panel', '#charcreate-panel', '#offline-select'];
  document.body.dataset.startPanel = el.slice(1);

  // Find currently visible panel
  const currentActiveId = panels.find(id => !$(id).hasAttribute('hidden'));

  if (!currentActiveId || currentActiveId === el) {
    // Show instantly on initial load or same panel
    for (const id of panels) {
      $(id).toggleAttribute('hidden', id !== el);
    }
    if (el === '#charselect-panel' || el === '#charcreate-panel' || el === '#offline-select') {
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
    if (el === '#charselect-panel' || el === '#charcreate-panel' || el === '#offline-select') {
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
    if (el === '#charselect-panel' || el === '#charcreate-panel' || el === '#offline-select') {
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

// ── Home-page account portal ("Account" nav tab) ────────────────────────────
// The nav swaps Login/Register → Account once a session exists; the portal page
// is a thin consumer of the pure account_portal.ts model + the REST Api.
function loginNavItem(): HTMLElement | null {
  return ($('#nav-btn-login') as HTMLElement).closest('.nav-item') as HTMLElement | null;
}

const loggedInNavItems = ['#nav-item-account', '#nav-item-logout'];

function enterLoggedInChrome(): void {
  loggedInNavItems.forEach((sel) => { ($(sel) as HTMLElement).hidden = false; });
  const li = loginNavItem();
  if (li) li.hidden = true;
}

function enterLoggedOutChrome(): void {
  loggedInNavItems.forEach((sel) => { ($(sel) as HTMLElement).hidden = true; });
  const li = loginNavItem();
  if (li) li.hidden = false;
}

function logoutAccount(): void {
  const finish = () => {
    api.clearSession();
    location.reload();
  };
  if (!api.token) { finish(); return; }
  void api.logout().finally(finish);
}

function setAccountFieldMsg(sel: string, text: string, ok: boolean): void {
  const el = $(sel);
  el.textContent = text;
  el.classList.toggle('is-error', !ok && text !== '');
  el.classList.toggle('is-ok', ok && text !== '');
}

function paintAccountPortal(
  model: ReturnType<typeof accountPortalModel>,
  // When the account fetch failed transiently we re-render the shell but must
  // NOT clobber an already-populated email field: a blank value would otherwise
  // be submitted as a null email update on the next save.
  preserveEmailInput = false,
): void {
  ($('#account-logged-out') as HTMLElement).hidden = model.loggedIn;
  ($('#account-sections') as HTMLElement).hidden = !model.loggedIn;
  $('#account-username').textContent = model.header.username;
  const since = $('#account-member-since');
  since.textContent = model.header.memberSinceIso
    ? t('hudChrome.account.memberSince', { date: formatDateTime(new Date(model.header.memberSinceIso), { dateStyle: 'medium' }) })
    : '';
  $('#account-char-count').textContent = t('hudChrome.account.charactersCount', {
    count: formatNumber(model.header.characterCount),
  });
  if (!preserveEmailInput) ($('#account-email') as HTMLInputElement).value = model.email;
}

const loggedOutModel = () => accountPortalModel({ loggedIn: false, username: '', email: '', createdAt: '', characterCount: 0 });

function handleAccountSessionExpired(): void {
  api.clearSession();
  enterLoggedOutChrome();
  paintAccountPortal(loggedOutModel());
}

// Load the account portal from a (possibly restored) token. A 401/403 means the
// token is genuinely stale → clear the session. Any other failure (5xx from a
// restarting server, a captive-portal blip, being briefly offline) is transient:
// keep the token and stay optimistically logged in, since only the local copy
// would be lost. `setChrome` flips the nav into the logged-in state (boot path).
async function loadAccountPortal(setChrome: boolean): Promise<void> {
  if (!api.token) { paintAccountPortal(loggedOutModel()); return; }
  try {
    const acct = await api.getAccount();
    if (setChrome) enterLoggedInChrome();
    paintAccountPortal(accountPortalModel({
      loggedIn: true, username: acct.username, email: acct.email,
      createdAt: acct.createdAt, characterCount: acct.characterCount,
    }));
  } catch (err) {
    if (isAuthError(err)) { handleAccountSessionExpired(); return; }
    console.warn('account session check deferred (transient):', err);
    if (setChrome) enterLoggedInChrome();
    paintAccountPortal(accountPortalModel({
      loggedIn: true, username: api.username ?? '', email: '', createdAt: '', characterCount: 0,
    }), true);
  }
}

// Boot path: a restored token re-validates and sets the logged-in nav chrome.
const revalidateAccountSession = (): Promise<void> => loadAccountPortal(true);
// Navigating to the Account view: refresh the portal without touching the chrome.
const renderAccountPortal = (): Promise<void> => loadAccountPortal(false);

// `focusWallet` differentiates the Wallet card's CTA from "View Characters":
// both land on the realm/character picker, but Manage Wallet then scrolls to and
// focuses the wallet control once it renders.
let pendingWalletFocus = false;
function accountGoToCharacters(focusWallet = false): void {
  pendingWalletFocus = focusWallet;
  switchMainView('#hero-view');
  void enterRealmFlow().then(() => { if (pendingWalletFocus) tryFocusWalletButton(); });
}

function tryFocusWalletButton(attempt = 0): void {
  const btn = document.getElementById('btn-wallet');
  if (btn && btn.offsetParent !== null) {
    pendingWalletFocus = false;
    btn.scrollIntoView({ block: 'center' });
    btn.focus();
    return;
  }
  if (attempt < 20) window.setTimeout(() => tryFocusWalletButton(attempt + 1), 100);
  else pendingWalletFocus = false;
}

let accountPortalWired = false;
function setupAccountPortal(): void {
  if (accountPortalWired) return;
  accountPortalWired = true;

  ($('#account-password-form') as HTMLFormElement).addEventListener('submit', async (e) => {
    e.preventDefault();
    const current = ($('#account-current-pass') as HTMLInputElement).value;
    const next = ($('#account-new-pass') as HTMLInputElement).value;
    const confirm = ($('#account-confirm-pass') as HTMLInputElement).value;
    const err = validatePasswordChange(current, next, confirm);
    if (err) {
      const key = err === 'empty-current' ? 'errCurrentRequired'
        : err === 'too-short' ? 'errPasswordShort'
        : err === 'too-long' ? 'errPasswordLong'
        : err === 'confirm-mismatch' ? 'errPasswordConfirm'
        : 'errPasswordUnchanged';
      setAccountFieldMsg('#account-password-msg', t(`hudChrome.account.${key}` as TranslationKey), false);
      return;
    }
    try {
      await api.changePassword(current, next);
      setAccountFieldMsg('#account-password-msg', t('hudChrome.account.passwordChanged'), true);
      ($('#account-current-pass') as HTMLInputElement).value = '';
      ($('#account-new-pass') as HTMLInputElement).value = '';
      ($('#account-confirm-pass') as HTMLInputElement).value = '';
    } catch (e2) {
      setAccountFieldMsg('#account-password-msg', userFacingApiError(e2), false);
    }
  });

  ($('#account-email-form') as HTMLFormElement).addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = ($('#account-email') as HTMLInputElement).value;
    if (!validateEmailShape(email)) {
      setAccountFieldMsg('#account-email-msg', t('hudChrome.account.errEmailInvalid'), false);
      return;
    }
    try {
      const saved = await api.setEmail(email);
      ($('#account-email') as HTMLInputElement).value = saved;
      setAccountFieldMsg('#account-email-msg', t('hudChrome.account.emailSaved'), true);
    } catch (e2) {
      setAccountFieldMsg('#account-email-msg', userFacingApiError(e2), false);
    }
  });

  const deUser = $('#account-deactivate-user') as HTMLInputElement;
  const dePass = $('#account-deactivate-pass') as HTMLInputElement;
  const deBtn = $('#account-deactivate-btn') as HTMLButtonElement;
  const syncDeactivate = () => { deBtn.disabled = !deactivateConfirmReady(api.username ?? '', deUser.value, dePass.value); };
  deUser.addEventListener('input', syncDeactivate);
  dePass.addEventListener('input', syncDeactivate);
  ($('#account-deactivate-form') as HTMLFormElement).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.deactivateAccount(deUser.value, dePass.value);
      api.clearSession();
      setAccountFieldMsg('#account-deactivate-msg', t('hudChrome.account.deactivated'), true);
      window.setTimeout(() => location.reload(), 1200);
    } catch (e2) {
      setAccountFieldMsg('#account-deactivate-msg', userFacingApiError(e2), false);
    }
  });

  document.getElementById('account-manage-wallet')?.addEventListener('click', () => accountGoToCharacters(true));
  ($('#account-go-characters') as HTMLElement).addEventListener('click', () => accountGoToCharacters(false));
  ($('#account-logout') as HTMLElement).addEventListener('click', logoutAccount);
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
        ? `<span class="rn-chars">${escapeHtml(tPlural('hudChrome.plurals.characterCount', chars))}</span>`
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

// --- Inline realm switcher (dropdown on the character-select screen) ----------
const REALM_TYPE_KEYS = { 'Normal': 'realmTypes.normal', 'PvP': 'realmTypes.pvp', 'RP': 'realmTypes.rp', 'RP-PvP': 'realmTypes.rpPvp' } as const;
let realmDropdownOpen = false;

function closeRealmDropdown(): void {
  const menu = document.getElementById('cs-realm-menu');
  const btn = document.getElementById('btn-change-realm');
  menu?.setAttribute('hidden', '');
  btn?.setAttribute('aria-expanded', 'false');
  realmDropdownOpen = false;
}

function toggleRealmDropdown(): void {
  if (realmDropdownOpen) { closeRealmDropdown(); return; }
  const menu = $('#cs-realm-menu');
  const btn = $('#btn-change-realm');
  menu.removeAttribute('hidden');
  btn.setAttribute('aria-expanded', 'true');
  realmDropdownOpen = true;
  renderRealmDropdown();
}

function renderRealmDropdown(): void {
  const menu = $('#cs-realm-menu');
  menu.innerHTML = `<div class="realm-loading">${escapeHtml(t('realm.loading'))}</div>`;
  void api.realms().then((d) => {
    if (!realmDropdownOpen) return;
    if (d.realms.length === 0) {
      menu.innerHTML = `<div class="realm-loading">${escapeHtml(t('realm.noRealms'))}</div>`;
      return;
    }
    menu.innerHTML = d.realms.map((r) => {
      const sel = r.name === api.realm ? ' sel' : '';
      return `<div class="realm-row cs-realm-row${sel}" role="option" aria-selected="${r.name === api.realm}" data-name="${escapeHtml(r.name)}" data-url="${escapeHtml(r.url)}">
        <div class="realm-name">${escapeHtml(r.name)}</div>
        <div class="realm-pop offline" data-pop>-</div>
      </div>`;
    }).join('');
    menu.querySelectorAll('.realm-row').forEach((row) => row.addEventListener('click', () => {
      const name = (row as HTMLElement).dataset.name!;
      const entry = d.realms.find((r) => r.name === name);
      if (entry) selectRealmInline(entry);
    }));
    void Promise.all(d.realms.map(async (r) => {
      const st = await api.realmStatus(r.url || '');
      const row = menu.querySelector(`.realm-row[data-name="${CSS.escape(r.name)}"]`) as HTMLElement | null;
      if (!row) return;
      const pop = realmPopulation(st.online, st.players);
      const popEl = row.querySelector('[data-pop]') as HTMLElement;
      popEl.textContent = t(pop.labelKey);
      popEl.className = `realm-pop ${pop.cls}`;
      row.classList.toggle('offline', !st.online);
    }));
  });
}

function selectRealmInline(entry: import('./net/online').RealmEntry): void {
  closeRealmDropdown();
  if (entry.name === api.realm) return;
  api.setRealm(entry.url);
  api.realm = entry.name;
  localStorage.setItem(LAST_REALM_KEY, entry.name);
  $('#charselect-realm').textContent = entry.name;
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
  if (api.realm) $('#charselect-realm').textContent = api.realm;
  const listEl = $('#char-list');
  listEl.innerHTML = `<li class="char-list-message">${escapeHtml(t('character.loading'))}</li>`;
  try {
    const chars = await api.characters();
    if (api.realm) $('#charselect-realm').textContent = api.realm;
    listEl.innerHTML = '';
    if (chars.length === 0) {
      // No characters on this realm — drop straight into the create screen.
      listEl.innerHTML = `<li class="char-list-message">${escapeHtml(t('character.noneYet'))}</li>`;
      show('#charcreate-panel');
      return;
    }
    for (const c of chars) {
      const row = document.createElement('li');
      row.className = 'char-row' + (c.online ? ' online' : '') + (c.forceRename ? ' rename-required' : '');
      row.setAttribute('tabindex', '0');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      row.dataset.class = c.class;
      row.dataset.skin = String(c.skin ?? 0);
      const className = classDisplayName(c.class);
      // Online characters explain themselves on their own hint line (below the
      // class) instead of the terse "(in world)" suffix, so the reason for the
      // Take Over button is unmissable.
      const statusText = c.online ? '' : c.forceRename ? ` (${t('character.renameRequired')})` : '';
      const inWorldHint = c.online ? `<span class="char-inworld-hint">${escapeHtml(t('character.inWorldHint'))}</span>` : '';
      row.innerHTML = `${portraitChipHtml({ cls: c.class, skin: c.skin ?? 0, name: c.name, variant: 'sm' })}
        <div class="char-id">
          <span class="char-name">${escapeHtml(c.name)}</span>
          <span class="char-sub">${escapeHtml(t('character.levelClass', { level: c.level, className }))}${escapeHtml(statusText)}</span>
          ${inWorldHint}
        </div>
        ${c.forceRename
          ? `<input class="rename-input" placeholder="${escapeHtml(t('character.newNamePlaceholder'))}" maxlength="16" /><span class="char-actions"><button class="btn btn-danger delete-char-btn" ${c.online ? 'disabled' : ''}>${escapeHtml(t('character.delete'))}</button><button class="btn rename-btn">${escapeHtml(t('character.rename'))}</button></span>`
          : c.online
            ? `<span class="char-actions"><button class="btn btn-danger delete-char-btn" disabled title="${escapeHtml(t('character.inWorldHint'))}">${escapeHtml(t('character.delete'))}</button><button class="btn take-over-btn" title="${escapeHtml(t('character.takeOverConfirm'))}" aria-label="${escapeHtml(t('character.takeOverConfirm'))}">${escapeHtml(t('character.takeOver'))}</button></span>`
            : `<span class="char-actions"><button class="btn btn-danger delete-char-btn">${escapeHtml(t('character.delete'))}</button><button class="btn enter-world-btn">${escapeHtml(t('auth.enterWorld'))}</button></span>`}`;

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
      } else if (c.online) {
        row.querySelector('.take-over-btn')!.addEventListener('click', async (e) => {
          e.stopPropagation();
          const btn = e.currentTarget as HTMLButtonElement;
          // Taking over disconnects the other live session with no undo, so guard a
          // stray click (e.g. you are genuinely playing on another device) behind a
          // confirm. The prompt text is the existing t() key, keeping it localized.
          if (!window.confirm(t('character.takeOverConfirm'))) return;
          $('#charselect-error').textContent = '';
          btn.disabled = true;
          try {
            // Free the stale/other session, then enter on this character.
            // takeOverCharacter awaits the old session's leave() server-side, so
            // the slot is free by the time enterWorld connects. Pass btn so
            // enterWorld owns its loading/disabled state and restores it if entry
            // is aborted before it begins; surface any failure via the catch.
            await api.takeoverCharacter(c.id);
            await enterWorld({ ...c, online: false }, btn);
          } catch (err) {
            btn.disabled = false;
            $('#charselect-error').textContent = userFacingApiError(err);
            // Reflect any state change (e.g. a lost race) back into the list.
            void refreshCharacters();
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

        row.classList.add('sel');
        row.setAttribute('aria-selected', 'true');
        renderClassDetails('charselect-class-details', c.class);
        characterPreview?.setSkin(c.skin ?? 0);
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

    hydratePortraits(listEl);

    // Select first character by default if present, else show a default showcase.
    const firstRow = listEl.querySelector('.char-row') as HTMLElement | null;
    if (firstRow) {
      firstRow.click();
    } else {
      renderClassDetails('charselect-class-details', 'warrior');
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
    sfx.init();
    enterLoadingState(t('loading.connectingRealm'));
  } finally {
    if (!hasBegunWorldEntry && button) {
      button.disabled = false;
      button.textContent = t('auth.enterWorld');
    }
  }
  const world = new ClientWorld(api.token!, c.id, c.class, api.base, getClientSeed());
  // Wire shareable player cards for this online session: publishing uploads the
  // composited PNG to this realm and returns an absolute public page URL, and
  // the referral provider feeds the card footer. Both are cleared on disconnect.
  setCardUploader(async (png) => {
    const r = await api.uploadCard(c.id, png, getLanguage());
    return { url: absolutePublishedCardUrl(r.url, api.base, location.origin) };
  });
  setReferralProvider(() => api.referralStats());
  setStandingProvider(() => api.characterStanding(c.id));
  // One place to drop the session's card wiring, so the entry-timeout and the
  // disconnect paths can't drift (a lingering provider would hold a stale
  // character closure after we leave the world).
  const clearCardProviders = () => { setCardUploader(null); setReferralProvider(null); setStandingProvider(null); };
  // wait for hello + first snapshot so the world starts populated
  const waitStart = Date.now();
  const poll = setInterval(() => {
    if (world.connected && world.entities.has(world.playerId)) {
      clearInterval(poll);
      void startGame(world, null, world, `char:${c.id}`);
    } else if (Date.now() - waitStart > 10000) {
      clearInterval(poll);
      world.close();
      clearCardProviders();
      fatalOverlay(t('loading.enterTimeout'));
    }
  }, 50);
  // a rejected join must stop the poll too, or its timeout overlay would
  // mask the real reason (e.g. "character already in world")
  world.onDisconnect = (reason) => {
    clearInterval(poll);
    clearCardProviders();
    fatalOverlay(userFacingApiError(reason));
  };
}

// CLASS_DETAILS / SIGNATURE_ABILITIES live in a pure module so a Vitest guard
// can verify they never drift from the sim's class/ability definitions.

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
      alternateName: 'World of Claudecraft',
      genre: t('seo.genre'),
      playMode: t('seo.playMode'),
      applicationCategory: t('seo.applicationCategory'),
      operatingSystem: t('seo.operatingSystem'),
      url: canonicalHref,
      image: 'https://worldofclaudecraft.com/woc_logo_square.webp',
      description: t('seo.description'),
      inLanguage: languageTag(lang),
      sameAs: [
        'https://github.com/levy-street/world-of-claudecraft',
        'https://discord.gg/GjhnUsBtw',
      ],
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
  updateWalletButton();
  const activePanel = document.body.dataset.startPanel;
  if (activePanel === 'realm-panel') {
    showRealmList();
    return;
  }
  if (activePanel === 'charselect-panel') {
    void refreshCharacters();
    return;
  }
  if (activePanel === 'login-panel') {
    const m = (document.getElementById('login-panel') as HTMLElement | null)?.dataset.authMode;
    authModeApply?.(m === 'register' ? 'register' : 'login');
    return;
  }
  if (activePanel === 'charcreate-panel') {
    const sel = document.querySelector('#charcreate-panel .mini-class.sel') as HTMLElement | null;
    if (sel) {
      currentlyRenderedClass['charcreate-class-details'] = null;
      renderClassDetails('charcreate-class-details', sel.dataset.class as PlayerClass);
    }
    return;
  }
  const offlineSelected = document.querySelector('#offline-select .mini-class.sel') as HTMLElement | null;
  if (activePanel === 'offline-select' && offlineSelected) {
    currentlyRenderedClass['offline-class-details'] = null;
    renderClassDetails('offline-class-details', offlineSelected.dataset.class as PlayerClass);
  }
}

// Single source of truth for switching the active locale at runtime. Used by BOTH the
// homepage footer picker and the in-game Options > Interface picker (via OptionsHooks).
// Loads the locale chunk first (the async loader), then flips the language, re-localizes
// the static shell, and fans the change out to every live listener through
// `woc:languagechange` (the HUD relocalizes its dynamic UI on that event). onStatus, when
// given, receives a localized progress/error message for an aria-live status element.
// Returns true on success, false if the locale chunk failed to load (active locale kept).
async function changeLanguage(selected: SupportedLanguage, onStatus?: (msg: string) => void): Promise<boolean> {
  onStatus?.(t('settings.languageLoading'));
  try {
    await ensureLocaleLoaded(selected);
  } catch {
    // The locale chunk failed to load. Keep the already-resident locale and tell the user.
    onStatus?.(t('settings.languageLoadFailed'));
    return false;
  }
  onStatus?.('');
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
  return true;
}

async function loadProjectStats(): Promise<void> {
  // Realm status now lives in the realm dropdown — both in the trigger sub-line
  // and inside the Online option — so update every instance by class.
  const accountEls = document.querySelectorAll<HTMLElement>('.js-stat-accounts');
  if (!accountEls.length) return;
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
    setAll(accountEls, String(cached.accounts_created));
    return;
  }

  // 2. Fetch fresh stats
  try {
    const data = await api.projectStats();

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
      setAll(accountEls, String(cached.accounts_created));
    } else {
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
  const rankLabel = t('game.leaderboard.rank');
  const nameLabel = t('game.leaderboard.name');
  const realmLabel = t('game.leaderboard.realmCol');
  const levelLabel = t('game.leaderboard.level');
  const virtualLevelLabel = t('game.leaderboard.vlevel');
  const lifetimeXpLabel = t('game.leaderboard.lifetimeXp');
  const head = `<div class="hs-row hs-head">`
    + `<span class="hs-rank">${rankLabel}</span>`
    + `<span class="hs-name">${nameLabel}</span>`
    + `<span class="hs-realm">${realmLabel}</span>`
    + `<span class="hs-lvl">${levelLabel}</span>`
    + `<span class="hs-vlvl">${virtualLevelLabel}</span>`
    + `<span class="hs-xp">${lifetimeXpLabel}</span></div>`;
  const body = rows.map((r) => {
    const cls = CLASSES[r.cls];
    const star = r.prestigeRank > 0 ? `<span class="hs-prestige" title="${t('game.prestige.rank')} ${r.prestigeRank}">★${r.prestigeRank}</span>` : '';
    return `<div class="hs-row${r.rank <= 3 ? ' hs-top' : ''}">`
      + `<span class="hs-rank">${r.rank}</span>`
      + `<span class="hs-name"${cls ? ` title="${esc(classDisplayName(r.cls))}"` : ''}>${star}${esc(r.name)}</span>`
      + `<span class="hs-realm" data-label="${esc(realmLabel)}">${esc(r.realm ?? '')}</span>`
      + `<span class="hs-lvl" data-label="${esc(levelLabel)}">${r.level}</span>`
      + `<span class="hs-vlvl" data-label="${esc(virtualLevelLabel)}">${r.virtualLevel}</span>`
      + `<span class="hs-xp" data-label="${esc(lifetimeXpLabel)}">${formatXp(r.lifetimeXp)}</span></div>`;
  }).join('');
  host.innerHTML = head + body;
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
      + `<h3 class="news-item-title">${title}</h3><div class="news-item-meta">${tag}${badge}${when}</div></div>`
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

// ── Non-custodial Solana wallet linking ─────────────────────────────────────
// The character-select wallet row connects a Wallet Standard Solana wallet and,
// once the player is logged in, binds it to their account by signing a
// server-issued challenge. The account↔wallet link is the durable,
// server-verified artifact.
let linkedWalletPubkey: string | null = null;
let linkedWocBalance: number | null = null;
let connectedWocBalance: number | null = null;
let walletVerifyPending = false;
let walletVerifyInProgress = false;
let walletVerifyTimeout: number | null = null;
let walletVerifyModalUnsubscribe: (() => void) | null = null;
let walletFlowStatus: 'connect' | 'sign' | 'verify' | null = null;
let walletHiddenNoticeTimeout: number | null = null;

// Feature flag: Wallet Standard support needs no project id. Keep an escape
// hatch for deploys that want to hide the wallet UI entirely. Native app builds
// intentionally exclude wallet verification for now.
const WALLET_ENABLED = !NATIVE_APP && String(import.meta.env.VITE_WALLET_DISABLED ?? '').trim() !== '1';

function walletCharacterScreenVisible(): boolean {
  try {
    return new Settings().get('showWalletOnCharacterScreen');
  } catch {
    return true;
  }
}

function syncWalletCharacterScreenVisibility(): void {
  const walletRow = document.querySelector<HTMLElement>('.cs-wallet');
  if (!walletRow) return;
  walletRow.hidden = !walletCharacterScreenVisible();
}

function showWalletHiddenNotice(): void {
  const note = document.getElementById('wallet-hidden-note');
  if (!note) return;
  if (walletHiddenNoticeTimeout !== null) {
    window.clearTimeout(walletHiddenNoticeTimeout);
    walletHiddenNoticeTimeout = null;
  }
  note.textContent = t('wallet.hiddenNotice');
  note.hidden = false;
  walletHiddenNoticeTimeout = window.setTimeout(() => {
    note.hidden = true;
    note.textContent = '';
    walletHiddenNoticeTimeout = null;
  }, 8000);
}

function hideWalletCharacterScreenRow(): void {
  new Settings().set('showWalletOnCharacterScreen', false);
  syncWalletCharacterScreenVisibility();
  showWalletHiddenNotice();
}

// Lazily load the heavy wallet module the first time it's needed, then cache it.
let walletMod: typeof import('./net/wallet') | null = null;
function loadWallet(): Promise<typeof import('./net/wallet')> {
  return walletMod ? Promise.resolve(walletMod) : import('./net/wallet').then((m) => {
    walletMod = m;
    walletMod.setWalletPicker(showWalletPicker);
    return walletMod;
  });
}

const shortenAddress = (a: string): string => `${a.slice(0, 4)}…${a.slice(-4)}`;
const formatWoc = (n: number): string => formatNumber(n, { maximumFractionDigits: 2 });
const walletBalanceText = (n: number): string => t('wallet.balanceAmount', { amount: formatWoc(n) });
let walletPickerModal: HTMLDivElement | null = null;
let walletPickerResolve: ((id: string | null) => void) | null = null;
let walletPickerReturnFocus: HTMLElement | null = null;

function walletPickerFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
    .filter((el) => !el.hasAttribute('disabled') && !el.getAttribute('aria-hidden') && (el.offsetParent !== null || el === document.activeElement));
}

function closeWalletPicker(id: string | null): void {
  const modal = walletPickerModal;
  const resolve = walletPickerResolve;
  walletPickerModal = null;
  walletPickerResolve = null;
  if (modal) modal.remove();
  const returnFocus = walletPickerReturnFocus;
  walletPickerReturnFocus = null;
  if (returnFocus?.isConnected) returnFocus.focus();
  if (resolve) resolve(id);
}

function showWalletPicker(wallets: readonly WalletOption[], selectedId: string | null): Promise<string | null> {
  if (walletPickerResolve) closeWalletPicker(null);
  return new Promise((resolve) => {
    walletPickerResolve = resolve;
    walletPickerReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const back = document.createElement('div');
    back.className = 'modal-backdrop wallet-picker-backdrop';
    back.id = 'wallet-picker-modal';

    const panel = document.createElement('div');
    panel.className = 'panel wallet-picker-modal';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'wallet-picker-title');
    panel.setAttribute('aria-describedby', 'wallet-picker-help');

    const titleRow = document.createElement('div');
    titleRow.className = 'panel-title';
    const title = document.createElement('span');
    title.id = 'wallet-picker-title';
    title.textContent = t('wallet.connectTitle');
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'x-btn wallet-picker-close';
    closeBtn.setAttribute('aria-label', t('skinEvent.close'));
    closeBtn.textContent = '×';
    titleRow.append(title, closeBtn);

    const help = document.createElement('p');
    help.className = 'wallet-picker-help';
    help.id = 'wallet-picker-help';
    help.textContent = t('wallet.flowConnect');

    const list = document.createElement('div');
    list.className = 'wallet-picker-list';

    if (wallets.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'wallet-picker-empty';
      empty.textContent = t('wallet.helpDisconnected');
      list.appendChild(empty);
    } else {
      for (const option of wallets) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'wallet-picker-option';
        button.classList.toggle('selected', option.id === selectedId);
        button.setAttribute('aria-label', option.name);
        button.addEventListener('click', () => closeWalletPicker(option.id));

        const icon = document.createElement('img');
        icon.className = 'wallet-picker-icon';
        icon.src = option.icon;
        icon.alt = '';
        icon.decoding = 'async';

        const text = document.createElement('span');
        text.className = 'wallet-picker-name';
        text.textContent = option.name;

        button.append(icon, text);
        if (option.connected) {
          const badge = document.createElement('span');
          badge.className = 'wallet-picker-badge';
          badge.textContent = t('wallet.appConnected');
          button.appendChild(badge);
        }
        list.appendChild(button);
      }
    }

    panel.append(titleRow, help, list);
    back.appendChild(panel);
    document.body.appendChild(back);
    walletPickerModal = back;

    const close = () => closeWalletPicker(null);
    closeBtn.addEventListener('click', close);
    back.addEventListener('click', (e) => {
      if (e.target === back) close();
    });
    back.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = walletPickerFocusable(back);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });

    const initialFocus = back.querySelector<HTMLElement>('.wallet-picker-option.selected')
      ?? back.querySelector<HTMLElement>('.wallet-picker-option')
      ?? closeBtn;
    initialFocus.focus();
  });
}

function walletAddressLabel(address: string, linked: boolean, balance: number | null): string {
  const short = shortenAddress(address);
  if (balance !== null) {
    const balanceText = walletBalanceText(balance);
    return linked
      ? t('wallet.connectedLinkedWithBalance', { balance: balanceText, address: short })
      : t('wallet.connectedWithBalance', { balance: balanceText, address: short });
  }
  return linked
    ? t('wallet.connectedLinked', { address: short })
    : t('wallet.connected', { address: short });
}

function walletHelpText(address: string, linked: boolean, balance: number | null): string {
  const short = shortenAddress(address);
  if (linked) {
    return balance !== null
      ? t('wallet.helpLinkedWithBalance', { balance: walletBalanceText(balance), address: short })
      : t('wallet.helpLinked', { address: short });
  }
  if (!api.token) {
    return balance !== null
      ? t('wallet.helpLoginToLinkWithBalance', { balance: walletBalanceText(balance), address: short })
      : t('wallet.helpLoginToLink', { address: short });
  }
  return balance !== null
    ? t('wallet.helpReadyToLinkWithBalance', { balance: walletBalanceText(balance), address: short })
    : t('wallet.helpReadyToLink', { address: short });
}

function walletLinkedDisconnectedHelpText(address: string, balance: number | null): string {
  const short = shortenAddress(address);
  return balance !== null
    ? t('wallet.helpLinkedDisconnectedWithBalance', { balance: walletBalanceText(balance), address: short })
    : t('wallet.helpLinkedDisconnected', { address: short });
}

function setWalletStatus(text: string | null): void {
  const status = document.getElementById('wallet-status');
  if (!status) return;
  if (!text) {
    status.hidden = true;
    status.textContent = '';
    status.removeAttribute('title');
    status.removeAttribute('aria-label');
    return;
  }
  status.hidden = false;
  status.textContent = text;
  status.title = text;
  status.setAttribute('aria-label', text);
}

function walletFlowHelpText(): string {
  switch (walletFlowStatus) {
    case 'connect':
      return t('wallet.flowConnect');
    case 'sign':
      return t('wallet.flowSign');
    case 'verify':
      return t('wallet.flowVerify');
    default:
      return t('wallet.helpDisconnected');
  }
}

function setWalletHelp(text: string, state: 'default' | 'attention' | 'verified'): void {
  const help = document.getElementById('wallet-help');
  if (!help) return;
  help.textContent = text;
  help.classList.toggle('is-attention', state === 'attention');
  help.classList.toggle('is-verified', state === 'verified');
}

function setWalletFlowStatus(status: typeof walletFlowStatus): void {
  walletFlowStatus = status;
  updateWalletButton();
}

function updateWalletButton(): void {
  if (!WALLET_ENABLED) {
    setWocBalance(null, false);
    setWalletDisplayAvailable(false);
    return;
  }
  syncWalletCharacterScreenVisibility();
  // currentWallet is sync; before the module loads, treat as disconnected.
  const { address, isConnected } = walletMod ? walletMod.currentWallet() : { address: null, isConnected: false };
  const connected = isConnected && !!address;
  const linked = connected && linkedWalletPubkey === address;
  const verifiedBalance = linkedWalletPubkey
    ? (linkedWocBalance ?? (linked ? connectedWocBalance : null))
    : null;
  const previewBalance = connected && !linkedWalletPubkey ? connectedWocBalance : null;
  // Mirror the balance into the HUD store so the bag footer stays in sync. Only
  // a balance for the linked wallet may drive verified holder claims.
  setWocBalance(verifiedBalance ?? previewBalance, verifiedBalance !== null);
  setWalletDisplayAvailable(connected || linkedWalletPubkey !== null);
  const btn = document.getElementById('btn-wallet');
  const label = document.getElementById('wallet-label');
  if (!btn || !label) return;
  // Switch / Unlink are account-link actions; Disconnect is only meaningful for
  // the browser wallet-app session.
  const switchBtn = document.getElementById('btn-wallet-switch');
  const unlinkBtn = document.getElementById('btn-wallet-unlink');
  const signoutBtn = document.getElementById('btn-wallet-signout');
  if (switchBtn) switchBtn.hidden = !(api.token && linkedWalletPubkey);
  if (unlinkBtn) unlinkBtn.hidden = !(api.token && linkedWalletPubkey);
  if (signoutBtn) signoutBtn.hidden = !connected;
  btn.classList.remove('is-connected', 'is-linked', 'needs-link', 'connect-app');
  btn.classList.toggle('busy', walletFlowStatus !== null);
  if (walletFlowStatus) {
    label.textContent = t('wallet.verifying');
    btn.title = t('wallet.verifyingTitle');
    btn.setAttribute('aria-label', t('wallet.verifyingTitle'));
    setWalletStatus(null);
    setWalletHelp(walletFlowHelpText(), 'attention');
    return;
  }
  if (!connected) {
    if (api.token && linkedWalletPubkey) {
      btn.classList.add('connect-app');
      label.textContent = t('wallet.connectApp');
      btn.title = t('wallet.connectAppTitle');
      btn.setAttribute('aria-label', t('wallet.connectAppAria'));
      setWalletStatus(walletAddressLabel(linkedWalletPubkey, true, linkedWocBalance));
      setWalletHelp(walletLinkedDisconnectedHelpText(linkedWalletPubkey, linkedWocBalance), 'verified');
      return;
    }
    btn.classList.add('needs-link');
    label.textContent = t('wallet.verify');
    btn.title = t('wallet.verifyTitle');
    btn.setAttribute('aria-label', t('wallet.verifyAria'));
    setWalletStatus(null);
    setWalletHelp(t('wallet.helpDisconnected'), 'default');
    return;
  }
  // $WOC balance sits to the left of the address once it has loaded.
  if (linked) {
    btn.classList.add('is-linked');
    label.textContent = t('wallet.appConnected');
    btn.title = t('wallet.linkedTitle');
    btn.setAttribute('aria-label', t('wallet.linkedTitle'));
    setWalletStatus(walletAddressLabel(address, true, verifiedBalance));
    setWalletHelp(walletHelpText(address, true, verifiedBalance), 'verified');
  } else if (api.token) {
    btn.classList.add('needs-link');
    label.textContent = linkedWalletPubkey ? t('wallet.verifyNew') : t('wallet.verify');
    btn.title = t('wallet.verifyTitle');
    btn.setAttribute('aria-label', t('wallet.verifyAddressAria', { address: shortenAddress(address) }));
    setWalletStatus(null);
    setWalletHelp(walletHelpText(address, false, connectedWocBalance), 'attention');
  } else {
    btn.classList.add('is-connected');
    label.textContent = walletAddressLabel(address, false, connectedWocBalance);
    btn.title = t('wallet.connectedTitle');
    btn.setAttribute('aria-label', t('wallet.connectedTitle'));
    setWalletStatus(null);
    setWalletHelp(walletHelpText(address, false, connectedWocBalance), 'default');
  }
}

function clearWalletVerifyTimeout(): void {
  if (walletVerifyTimeout !== null) {
    window.clearTimeout(walletVerifyTimeout);
    walletVerifyTimeout = null;
  }
}

function clearWalletVerifyModalWatcher(): void {
  if (!walletVerifyModalUnsubscribe) return;
  walletVerifyModalUnsubscribe();
  walletVerifyModalUnsubscribe = null;
}

function cancelWalletVerifyPending(): void {
  walletVerifyPending = false;
  clearWalletVerifyTimeout();
  clearWalletVerifyModalWatcher();
  setWalletFlowStatus(null);
}

async function disconnectUnverifiedWallet(): Promise<void> {
  if (!walletMod) return;
  const { address } = walletMod.currentWallet();
  if (!address || address === linkedWalletPubkey) return;
  try {
    await walletMod.disconnectWallet();
  } catch (err) {
    console.error('[wallet] disconnect unverified wallet failed', err);
  } finally {
    connectedWocBalance = null;
    updateWalletButton();
  }
}

async function disconnectUnverifiedWalletIfIdle(): Promise<void> {
  if (walletVerifyPending || walletVerifyInProgress) return;
  await disconnectUnverifiedWallet();
}

// Read the connected wallet's $WOC balance and re-render. Ignores a stale
// response if the connected wallet changed while the RPC call was in flight.
// `fresh` bypasses the server's per-wallet cache (used when the player opens a
// surface that shows the balance, so an on-chain token change shows up); an
// initial (non-fresh) read clears the prior value first to show a loading state.
async function refreshWocBalance(address: string, fresh = false): Promise<void> {
  if (!fresh) {
    connectedWocBalance = null;
    updateWalletButton();
  }
  const wallet = await loadWallet();
  const balance = await wallet.fetchWocBalance(address, fresh);
  // Skip stale results (wallet switched mid-flight) and fresh-read transport blips
  // that would wipe a shown balance — see resolveWocBalanceUpdate.
  const { apply, setLinked } = resolveWocBalanceUpdate({
    address, fresh, balance,
    currentAddress: wallet.currentWallet().address,
    linkedAddress: linkedWalletPubkey,
  });
  if (!apply) return;
  connectedWocBalance = balance;
  if (setLinked) linkedWocBalance = balance;
  updateWalletButton();
}

// Re-fetch the connected/linked wallet's balance on demand (server cache
// bypassed) so surfaces that display it — the bag footer and the player card —
// reflect on-chain changes. No-op when the wallet feature is off or nothing is
// connected/linked. Prefers the account-LINKED wallet (whose balance the badge
// shows) over a merely-connected one, and a short throttle coalesces rapid
// bag/card toggles so they don't burn the per-IP fresh-read budget.
let lastOnDemandRefreshAddress: string | null = null;
let lastOnDemandRefreshAt = 0;
const ON_DEMAND_REFRESH_THROTTLE_MS = 5000;
function refreshWocBalanceOnDemand(): void {
  if (!WALLET_ENABLED) return;
  const address = linkedWalletPubkey ?? walletMod?.currentWallet().address ?? null;
  if (!address) return;
  const now = Date.now();
  if (address === lastOnDemandRefreshAddress && now - lastOnDemandRefreshAt < ON_DEMAND_REFRESH_THROTTLE_MS) return;
  lastOnDemandRefreshAddress = address;
  lastOnDemandRefreshAt = now;
  void refreshWocBalance(address, true);
}

function flashWalletError(message: string): void {
  const btn = document.getElementById('btn-wallet');
  const label = document.getElementById('wallet-label');
  if (!btn || !label) return;
  const previous = label.textContent;
  label.textContent = message;
  btn.title = message;
  btn.setAttribute('aria-label', message);
  window.setTimeout(() => {
    if (label.textContent === message) label.textContent = previous;
    updateWalletButton();
  }, 4000);
}

// Refreshed after login: ask the server which wallet (if any) this account has
// linked, so the button can show the verified ✓ state.
async function refreshWalletLinkStatus(): Promise<void> {
  if (!WALLET_ENABLED) {
    linkedWalletPubkey = null;
    linkedWocBalance = null;
    connectedWocBalance = null;
    updateWalletButton();
    return;
  }
  if (!api.token) {
    linkedWalletPubkey = null;
    linkedWocBalance = null;
    updateWalletButton();
    return;
  }
  try {
    const wallet = await api.linkedWallet();
    linkedWalletPubkey = wallet?.pubkey ?? null;
    linkedWocBalance = null;
  } catch (err) {
    console.error('[wallet] could not load link status', err);
    linkedWalletPubkey = null;
    linkedWocBalance = null;
  }
  updateWalletButton();
  const pubkey = linkedWalletPubkey;
  if (pubkey && WALLET_ENABLED) {
    try {
      const wallet = await loadWallet();
      const balance = await wallet.fetchWocBalance(pubkey);
      if (linkedWalletPubkey === pubkey) {
        linkedWocBalance = balance;
        updateWalletButton();
      }
    } catch (err) {
      console.error('[wallet] could not load linked balance', err);
    }
  }
  await disconnectUnverifiedWalletIfIdle();
}

// challenge → sign → link, with a verified mirror written server-side.
async function completeWalletVerifyFlow(address: string): Promise<void> {
  if (!api.token || walletVerifyInProgress) return;
  clearWalletVerifyTimeout();
  clearWalletVerifyModalWatcher();
  walletVerifyPending = false;
  walletVerifyInProgress = true;
  let verificationFailed = false;
  try {
    const wallet = await loadWallet();
    setWalletFlowStatus('sign');
    const { message, nonce } = await api.walletLinkChallenge(address);
    const signature = await wallet.signMessageBase58(message);
    setWalletFlowStatus('verify');
    const result = await api.linkWallet(address, signature, nonce);
    linkedWalletPubkey = result.pubkey;
    linkedWocBalance = connectedWocBalance;
    if (linkedWocBalance === null) linkedWocBalance = await wallet.fetchWocBalance(address);
    updateWalletButton();
  } catch (err: unknown) {
    console.error('[wallet] verification failed', err);
    verificationFailed = true;
    await disconnectUnverifiedWallet();
  } finally {
    walletVerifyPending = false;
    walletVerifyInProgress = false;
    setWalletFlowStatus(null);
    if (verificationFailed) flashWalletError(t('wallet.verifyFailed'));
  }
}

async function startWalletVerifyFlow(forcePicker = false): Promise<void> {
  if (!api.token || walletVerifyPending || walletVerifyInProgress) return;
  const wallet = await loadWallet();
  if (forcePicker) {
    await wallet.disconnectWallet();
    connectedWocBalance = null;
  }
  const current = wallet.currentWallet();
  if (current.address) {
    await completeWalletVerifyFlow(current.address);
    return;
  }
  walletVerifyPending = true;
  setWalletFlowStatus('connect');
  clearWalletVerifyTimeout();
  clearWalletVerifyModalWatcher();
  walletVerifyTimeout = window.setTimeout(() => {
    if (!walletVerifyPending) return;
    cancelWalletVerifyPending();
  }, 120_000);
  try {
    await wallet.openWalletModal();
    const connected = wallet.currentWallet();
    if (walletVerifyPending && connected.address) await completeWalletVerifyFlow(connected.address);
  } catch (err) {
    cancelWalletVerifyPending();
    if (wallet.isWalletSelectionCancelled(err)) return;
    console.error('[wallet] open modal failed', err);
    flashWalletError(t('wallet.verifyFailed'));
  }
}

async function onWalletButtonClick(): Promise<void> {
  const wallet = await loadWallet();
  const { address, isConnected } = wallet.currentWallet();
  if (linkedWalletPubkey && (!isConnected || linkedWalletPubkey === address)) {
    await wallet.openWalletModal(); // linked wallet → manage / reconnect
    return;
  }
  await startWalletVerifyFlow(false);
}

// Disconnect the browser wallet-app session. The account↔wallet link persists
// server-side, so reconnecting the same wallet re-shows the verified state.
async function signOutWallet(): Promise<void> {
  const wallet = await loadWallet();
  await wallet.disconnectWallet();
}

async function unlinkVerifiedWallet(): Promise<void> {
  if (!api.token || !linkedWalletPubkey) return;
  try {
    await api.unlinkWallet();
    linkedWalletPubkey = null;
    linkedWocBalance = null;
    await disconnectUnverifiedWallet();
    updateWalletButton();
  } catch (err) {
    console.error('[wallet] unlink failed', err);
    flashWalletError(t('wallet.unlinkFailed'));
  }
}

// Switch: disconnect, then reopen the picker to connect a different wallet.
async function switchWallet(): Promise<void> {
  await startWalletVerifyFlow(true);
}

function wireWallet(): void {
  setWalletUiEnabled(WALLET_ENABLED);
  // Feature-gate: when explicitly disabled, remove the wallet row entirely and
  // never download the wallet chunk.
  if (!WALLET_ENABLED) {
    document.querySelector('.cs-wallet')?.remove();
    document.querySelector('.cs-wallet-hidden-note')?.remove();
    document.querySelector('.account-wallet-card')?.remove();
    updateWalletButton();
    return;
  }
  syncWalletCharacterScreenVisibility();
  const btn = document.getElementById('btn-wallet');
  if (!btn) return;
  // These async actions are fire-and-forget from the click, so attach a .catch:
  // a wallet connect/disconnect rejection must surface, not vanish silently.
  const onErr = (what: string) => (e: unknown) => console.error(`[wallet] ${what} failed`, e);
  btn.addEventListener('click', () => { onWalletButtonClick().catch(onErr('action')); });
  document.getElementById('btn-wallet-switch')?.addEventListener('click', () => { switchWallet().catch(onErr('switch')); });
  document.getElementById('btn-wallet-unlink')?.addEventListener('click', () => { unlinkVerifiedWallet().catch(onErr('unlink')); });
  document.getElementById('btn-wallet-signout')?.addEventListener('click', () => { signOutWallet().catch(onErr('disconnect')); });
  document.getElementById('btn-wallet-hide')?.addEventListener('click', () => { hideWalletCharacterScreenRow(); });
  // Load the wallet chunk (separate async bundle), then subscribe to changes and
  // init so a persisted connection is reflected on the character screen.
  loadWallet().then((wallet) => {
    wallet.onWalletChange((state) => {
      if (state.address) void refreshWocBalance(state.address);
      else connectedWocBalance = null;
      if (state.address && walletVerifyPending) void completeWalletVerifyFlow(state.address);
      else if (state.address) void disconnectUnverifiedWalletIfIdle();
      updateWalletButton();
    });
    wallet.initWallet();
    updateWalletButton();
  }).catch((e) => console.error('[wallet] load failed', e));
  updateWalletButton();
}

// ---- Landing-page cinematic backdrop ------------------------------------
// Decides per-visit whether the start screen shows the looping trailer video or
// a static, dimmed, high-contrast poster — and crucially NEVER fetches the
// 5.7 MB mp4 in the static case (the <video> ships with no source/autoplay; we
// attach the source only when we choose the video path). Called at boot, when the
// footer toggle flips, and when the in-game mirror setting changes.
// Pause + tear down the start-screen trailer video (on enter-world). Releasing
// the source frees the decoded buffer so it isn't still churning behind the HUD.
function stopLandingTrailer(): void {
  const backdrop = document.getElementById('start-screen-backdrop');
  const video = document.getElementById('bg-home') as HTMLVideoElement | null;
  backdrop?.classList.remove('trailer-ready', 'trailer-playing');
  if (!video) return;
  video.pause();
  if (video.src) {
    video.removeAttribute('src');
    video.load();
  }
}

let landingTrailerWired = false;
function applyLandingBackdrop(highContrast: boolean): void {
  const backdrop = document.getElementById('start-screen-backdrop');
  const video = document.getElementById('bg-home') as HTMLVideoElement | null;
  if (!backdrop) return;

  const saveData = navigatorSaveData();
  // Reduced motion: honour BOTH the OS-level prefers-reduced-motion query and
  // the player's persisted in-app Reduce Motion toggle, so the drifting trailer
  // stays off for anyone who asked for less motion in either place.
  const reducedMotion = (typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    || new Settings().get('reduceMotion');
  const useStatic = shouldUseStaticBackdrop({
    phone: isPhoneTouchDevice(),
    saveData,
    reducedMotion,
    highContrast,
  });

  backdrop.classList.toggle('backdrop-static', useStatic);

  if (!video) return;
  if (useStatic) {
    // Keep the poster only; tear down any playing trailer and release the buffer.
    backdrop.classList.remove('trailer-ready', 'trailer-playing');
    if (video.src) {
      video.pause();
      video.removeAttribute('src');
      video.load(); // drop the decoded video so the poster shows + memory frees
    }
    return;
  }

  // Video path: attach the source lazily and play. Reveal classes flip on the
  // first painted frame so the poster cross-fades into live motion.
  const src = video.dataset.trailerSrc;
  if (src && !video.src) {
    video.src = src;
    if (!landingTrailerWired) {
      landingTrailerWired = true;
      video.addEventListener('playing', () => {
        backdrop.classList.add('trailer-ready', 'trailer-playing');
      });
    }
    video.load();
  }
  video.play().catch(() => { /* autoplay blocked: poster stays, no error surfaced */ });
}

function wireStartScreens(): void {
  // Initial page translation and stats load. Lazy locale flip: a stored non-en locale is now
  // a real chunk fetch, and the homepage IS the first paint (there is no loading screen to sit
  // behind), so we localize-then-reveal to prevent an English flash + text swap. The start
  // screen is held with visibility:hidden - which PRESERVES layout, so there is no layout
  // shift - ONLY when the boot locale is not already resident; English and any already-loaded
  // locale skip the gate entirely (no blank, no delay). The gate lifts on BOTH resolve and
  // reject (the English fallback still renders), so a failed locale fetch can never strand the
  // homepage hidden. The stored-locale modulepreload will shrink the non-en hold toward zero.
  const bootLang = getLanguage();
  const startScreen = document.getElementById('start-screen');
  const gated = !!startScreen && !isLocaleResident(bootLang);
  if (gated) startScreen!.style.visibility = 'hidden';
  const revealLocalized = () => {
    // Restore visibility even if translatePage() throws (e.g. a dev-build untracked-key
    // throw or any mid-translate DOM error), so a translation failure can never strand the
    // homepage permanently hidden - a worse failure than the English flash this gate prevents.
    try {
      translatePage();
    } finally {
      if (gated) startScreen!.style.visibility = '';
    }
  };
  void ensureLocaleLoaded(bootLang).then(revealLocalized, revealLocalized);
  hydrateIcons();
  void loadProjectStats();
  wireContractAddressCopy();
  wireHomepageMusicToggle();
  wireWallet();

  // mode select
  const onlineBtn = $('#btn-online');
  const offlineBtn = $('#btn-offline');
  const btnStartOffline = $('#btn-start-offline') as HTMLButtonElement;
  const offlineNameInput = $('#char-name') as HTMLInputElement;
  const offlineError = $('#offline-error');
  
  const goToLoggedInPlay = () => {
    void enterRealmFlow().catch((err) => {
      if (isAuthError(err)) {
        api.clearSession();
        enterLoggedOutChrome();
      } else {
        loginError(userFacingApiError(err));
      }
      show('#login-panel');
    });
  };

  const enterOnlinePlayFlow = () => {
    switchMainView('#hero-view');
    if (api.token) {
      goToLoggedInPlay();
      return;
    }
    show('#mode-select');
  };

  const handleOnlineSelect = () => {
    if (api.token) {
      goToLoggedInPlay();
      return;
    }
    show('#login-panel');
  };

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
    sfx.init();
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
    if (!NATIVE_APP && TURNSTILE_SITEKEY && !token) {
      loginError(t('errors.api.verificationFailed'));
      return;
    }
    try {
      const nativeAttestation = NATIVE_APP ? await createNativeAttestationProof(api.base, mode) : undefined;
      if (mode === 'login') await api.login(username, password, token, nativeAttestation);
      else await api.register(username, password, token, REFERRAL_SLUG, nativeAttestation);
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
      // Persist the session so a reload restores the logged-in "Account" tab,
      // and reveal that tab now.
      api.saveSession();
      enterLoggedInChrome();
      // bind-on-login: surface the account's linked wallet (and flip a
      // connected-but-unlinked button into a "Link" call-to-action).
      void refreshWalletLinkStatus();
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

  // Standard login / create-account UX: one form that switches between two modes
  // via a link. The mode drives the title, primary button, prompt, and submit.
  const setAuthMode = (mode: 'login' | 'register') => {
    loginForm.dataset.authMode = mode;
    const isLogin = mode === 'login';
    $('#auth-title').textContent = t(isLogin ? 'auth.enterRealm' : 'auth.createAccount');
    $('#btn-login').textContent = t(isLogin ? 'auth.logIn' : 'auth.createAccount');
    $('#auth-switch-prompt').textContent = t(isLogin ? 'auth.noAccountPrompt' : 'auth.haveAccountPrompt');
    $('#btn-auth-toggle').textContent = t(isLogin ? 'auth.createAccount' : 'auth.logIn');
    passInput.setAttribute('autocomplete', isLogin ? 'current-password' : 'new-password');
    loginError('');
  };
  authModeApply = setAuthMode;

  // Prevent default submission and perform validation
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (validateForm(loginForm)) {
      void doAuth(loginForm.dataset.authMode === 'register' ? 'register' : 'login');
    }
  });

  // Custom keydown helper for compatibility with edge cases / legacy scripts
  passInput.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') {
      e.preventDefault();
      loginForm.requestSubmit();
    }
  });

  // The link toggles between the login and create-account forms.
  $('#btn-auth-toggle').addEventListener('click', (e) => {
    e.preventDefault();
    setAuthMode(loginForm.dataset.authMode === 'register' ? 'login' : 'register');
    userInput.focus();
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
  // Change Realm is now an inline dropdown on the character-select screen.
  $('#btn-change-realm').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleRealmDropdown();
  });
  // New Character opens the dedicated create screen; create's Back returns here.
  $('#btn-new-character').addEventListener('click', () => show('#charcreate-panel'));
  $('#btn-charcreate-back').addEventListener('click', () => show('#charselect-panel'));
  // Close the realm dropdown on outside click or Escape.
  document.addEventListener('click', (e) => {
    if (!realmDropdownOpen) return;
    const sw = document.querySelector('.cs-realm-switch');
    if (sw && !sw.contains(e.target as Node)) closeRealmDropdown();
  });
  document.addEventListener('keydown', (e) => {
    if (realmDropdownOpen && e.key === 'Escape') closeRealmDropdown();
  });

  // character creation
  document.querySelectorAll('#charcreate-panel .mini-class').forEach((el) => {
    const handleMiniClassSelect = () => {
      if (hoverTimeouts['charcreate-class-details'] !== null) {
        window.clearTimeout(hoverTimeouts['charcreate-class-details']);
        hoverTimeouts['charcreate-class-details'] = null;
      }
      if (revertTimeouts['charcreate-class-details'] !== null) {
        window.clearTimeout(revertTimeouts['charcreate-class-details']);
        revertTimeouts['charcreate-class-details'] = null;
      }
      document.querySelectorAll('#charcreate-panel .mini-class').forEach((x) => {
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
      renderClassDetails('charcreate-class-details', cls);
      refreshOnlineSkins(cls);
    };
    el.addEventListener('click', handleMiniClassSelect);
    el.addEventListener('keydown', (e) => handleKeyboardActivation(e as KeyboardEvent, handleMiniClassSelect));
    
    // A11y focus updates details
    el.addEventListener('focus', () => {
      if (revertTimeouts['charcreate-class-details'] !== null) {
        window.clearTimeout(revertTimeouts['charcreate-class-details']);
        revertTimeouts['charcreate-class-details'] = null;
      }
      if (hoverTimeouts['charcreate-class-details'] !== null) {
        window.clearTimeout(hoverTimeouts['charcreate-class-details']);
        hoverTimeouts['charcreate-class-details'] = null;
      }
      document.querySelectorAll('#char-list .char-row').forEach((r) => {
        r.classList.remove('sel');
        r.setAttribute('aria-selected', 'false');
      });
      const cls = (el as HTMLElement).dataset.class as PlayerClass;
      renderClassDetails('charcreate-class-details', cls);
    });

    // Hover updates details with 50ms debounce
    el.addEventListener('mouseenter', () => {
      if (revertTimeouts['charcreate-class-details'] !== null) {
        window.clearTimeout(revertTimeouts['charcreate-class-details']);
        revertTimeouts['charcreate-class-details'] = null;
      }
      if (hoverTimeouts['charcreate-class-details'] !== null) {
        window.clearTimeout(hoverTimeouts['charcreate-class-details']);
      }
      const cls = (el as HTMLElement).dataset.class as PlayerClass;
      hoverTimeouts['charcreate-class-details'] = window.setTimeout(() => {
        renderClassDetails('charcreate-class-details', cls);
        hoverTimeouts['charcreate-class-details'] = null;
      }, 50);
    });

    // Mouseleave reverts to currently selected class details with a 100ms debounce
    el.addEventListener('mouseleave', () => {
      if (hoverTimeouts['charcreate-class-details'] !== null) {
        window.clearTimeout(hoverTimeouts['charcreate-class-details']);
        hoverTimeouts['charcreate-class-details'] = null;
      }
      if (revertTimeouts['charcreate-class-details'] !== null) {
        window.clearTimeout(revertTimeouts['charcreate-class-details']);
      }
      revertTimeouts['charcreate-class-details'] = window.setTimeout(() => {
        const selEl = document.querySelector('#charcreate-panel .mini-class.sel') as HTMLElement | null;
        if (selEl) {
          const cls = selEl.dataset.class as PlayerClass;
          renderClassDetails('charcreate-class-details', cls);
        } else {
          const selChar = document.querySelector('#char-list .char-row.sel') as HTMLElement | null;
          if (selChar) {
            const cls = selChar.dataset.class as PlayerClass;
            renderClassDetails('charcreate-class-details', cls);
          }
        }
        revertTimeouts['charcreate-class-details'] = null;
      }, 100);
    });

    // Blur reverts to currently selected class details with a 100ms debounce (matches mouseleave)
    el.addEventListener('blur', () => {
      if (hoverTimeouts['charcreate-class-details'] !== null) {
        window.clearTimeout(hoverTimeouts['charcreate-class-details']);
        hoverTimeouts['charcreate-class-details'] = null;
      }
      if (revertTimeouts['charcreate-class-details'] !== null) {
        window.clearTimeout(revertTimeouts['charcreate-class-details']);
      }
      revertTimeouts['charcreate-class-details'] = window.setTimeout(() => {
        const selEl = document.querySelector('#charcreate-panel .mini-class.sel') as HTMLElement | null;
        if (selEl) {
          const cls = selEl.dataset.class as PlayerClass;
          renderClassDetails('charcreate-class-details', cls);
        } else {
          const selChar = document.querySelector('#char-list .char-row.sel') as HTMLElement | null;
          if (selChar) {
            const cls = selChar.dataset.class as PlayerClass;
            renderClassDetails('charcreate-class-details', cls);
          }
        }
        revertTimeouts['charcreate-class-details'] = null;
      }, 100);
    });
  });

  // Default select warrior in online character creator
  const defaultOnlineClass = document.querySelector('#charcreate-panel .mini-class[data-class="warrior"]') as HTMLElement | null;
  if (defaultOnlineClass) {
    defaultOnlineClass.classList.add('sel');
    defaultOnlineClass.setAttribute('aria-pressed', 'true');
    renderClassDetails('charcreate-class-details', 'warrior');
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
    const clsEl = document.querySelector('#charcreate-panel .mini-class.sel') as HTMLElement | null;
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
      // Return to the roster and show the freshly-created character.
      show('#charselect-panel');
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
        const menu = document.getElementById('header-menu-container') as HTMLElement | null;
        if (menu) menu.style.display = '';
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

  setupNavBtn(navBtnPlay, '#hero-view', enterOnlinePlayFlow);

  setupNavBtn(navBtnHighscores, '#highscores-view', () => {
    switchMainView('#highscores-view');
    void loadHighscores();
  });
  // The wiki is the curated guide SPA at /wiki (its own page), so this nav item
  // navigates there rather than switching an in-page view.
  setupNavBtn(navBtnWiki, '', () => { window.location.href = '/wiki'; });
  setupNavBtn(navBtnNews, '#news-view', () => {
    switchMainView('#news-view');
    void loadNews();
  });
  setupNavBtn(navBtnDownload, '#download-view');
  setupNavBtn(navBtnLogin, '#hero-view', () => {
    show('#login-panel');
  });
  setupNavBtn($('#nav-btn-account'), '#account-view', () => {
    switchMainView('#account-view');
    void renderAccountPortal();
  });
  setupNavBtn($('#nav-btn-logout'), '#hero-view', logoutAccount);
  setupAccountPortal();
  // Restore a persisted session: show the Account tab immediately, then confirm
  // the stored token is still valid against the server (clearing it if not).
  if (api.restoreSession()) {
    enterLoggedInChrome();
    void revalidateAccountSession();
  } else {
    enterLoggedOutChrome();
  }

  // Header Logo click listener to return to homepage
  const headerLogoBtn = $('#header-logo-btn');
  setupNavBtn(headerLogoBtn, '#hero-view', () => {
    switchMainView('#hero-view');
    show('#mode-select');
  });

  // Language selection dropdown setup
  const langSelect = $('#lang-select') as HTMLSelectElement | null;
  const langStatus = $('#lang-select-status') as HTMLElement | null;
  if (langSelect) {
    langSelect.value = getLanguage();
    langSelect.addEventListener('change', () => {
      const selected = langSelect.value;
      if (!isSupportedLanguage(selected)) {
        // The static <option> set should never produce this, but the picker is the
        // user-facing seam: surface it via t() and revert to the active locale.
        if (langStatus) langStatus.textContent = t('settings.languageLoadUnavailable');
        langSelect.value = getLanguage();
        return;
      }
      // Async locale loader: load the locale chunk BEFORE switching. At this point the
      // module is still static-imported through the barrel, so the await resolves on a
      // microtask with no network and the transient "loading" status never paints; the
      // failure path is wired now so the lazy locale flip's real fetch needs no call-site change.
      void changeLanguage(selected, (msg) => { if (langStatus) langStatus.textContent = msg; })
        .then((ok) => { if (!ok) langSelect.value = getLanguage(); });
    });
  }

  // Mobile menu toggle setup
  const mobileMenuToggle = $('#mobile-menu-toggle');
  const homepageHeader = $('.homepage-header');
  if (mobileMenuToggle && homepageHeader) {
    const headerMenu = document.getElementById('header-menu-container') as HTMLElement | null;
    let lastNativeMenuToggleAt = 0;
    const setMobileMenuOpen = (open: boolean) => {
      homepageHeader.classList.toggle('menu-open', open);
      mobileMenuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (headerMenu) headerMenu.style.display = open ? 'flex' : '';
    };
    const toggleMobileMenu = () => setMobileMenuOpen(!homepageHeader.classList.contains('menu-open'));
    const handleNativeMenuToggle = (e: Event) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target?.closest('#mobile-menu-toggle')) return;
      const now = Date.now();
      if (now - lastNativeMenuToggleAt <= 250) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      lastNativeMenuToggleAt = now;
      e.preventDefault();
      e.stopPropagation();
      toggleMobileMenu();
    };
    document.addEventListener('pointerup', handleNativeMenuToggle, true);
    document.addEventListener('touchend', handleNativeMenuToggle, { capture: true, passive: false });
    mobileMenuToggle.addEventListener('click', () => {
      if (Date.now() - lastNativeMenuToggleAt <= 250) return;
      toggleMobileMenu();
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

  // Landing backdrop: read the persisted high-contrast preference and decide
  // trailer-vs-static (also forced static on phones / Save-Data / reduced-motion).
  // Uses a throwaway Settings read so it works before the game's settings object
  // exists; the footer toggle persists changes through the same store.
  const landingSettings = new Settings();
  const contrastToggle = document.getElementById('landing-contrast-toggle') as HTMLButtonElement | null;
  const syncContrastToggle = (on: boolean): void => {
    if (contrastToggle) contrastToggle.setAttribute('aria-pressed', String(on));
  };
  syncContrastToggle(landingSettings.get('landingHighContrast'));
  applyLandingBackdrop(landingSettings.get('landingHighContrast'));

  // Stamp the engine/device + CSS-effects classes on the landing screen too, so
  // the decorative #start-screen-backdrop work (portal rings' heavy blur, nebula,
  // embers, trailer) is toned down from the first paint on costly engines (mobile
  // WebKit above all). The renderer (and its GPU tier) does not exist yet, so we
  // pass the conservative 'high' render tier here: only known-bad engine/device
  // quirks tone the first paint down. startGame() re-stamps with the real GFX.tier
  // once in-world. Honors a persisted manual browserEffects override.
  {
    const landingEnv = readBrowserEnv();
    const landingTier = cssEffectsTier({
      engine: landingEnv.engine,
      version: landingEnv.engineVersion,
      mobile: landingEnv.mobile,
      renderTier: 'high',
      override: landingSettings.get('browserEffects') as number,
    });
    const body = document.body.classList;
    body.remove(...BROWSER_BODY_CLASSES);
    body.add(...browserBodyClasses(landingEnv, landingTier));
  }
  contrastToggle?.addEventListener('click', () => {
    const next = !landingSettings.get('landingHighContrast');
    landingSettings.set('landingHighContrast', next);
    syncContrastToggle(next);
    applyLandingBackdrop(next);
  });

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
        : '#charcreate-panel .mini-class.sel';
      const selEl = document.querySelector(selSelector) as HTMLElement | null;
      const cls = selEl ? (selEl.dataset.class as PlayerClass) : 'warrior';
      characterPreview.setClass(cls);
    }
    decorateClassChips();
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
initHomepageMusic();
