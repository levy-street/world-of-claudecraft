import { Sim } from './sim/sim';
import { Renderer } from './render/renderer';
import { Input } from './game/input';
import { Keybinds } from './game/keybinds';
import { Settings, GameSettings, SETTING_RANGES } from './game/settings';
import { MobileControls, PHONE_TOUCH_QUERY, isPhoneTouchDevice } from './game/mobile_controls';
import { Hud } from './ui/hud';
import { audio } from './game/audio';
import { music } from './game/music';
import { handlePickedEntity, hoverCursorKind } from './game/interactions';
import { clickMoveStep, manualMovementOverrides } from './game/click_move';
import { Api, ClientWorld, CharacterSummary } from './net/online';
import type { IWorld, LeaderboardEntry } from './world_api';
import { formatXp } from './ui/xp_bar';
import { assetsReady } from './render/assets/preload';
import { CharacterPreview } from './render/characters';
import { DT, INTERACT_RANGE, PlayerClass, dist2d } from './sim/types';
import { togglePasswordVisibility, syncInputAriaState, validateForm, handleKeyboardActivation, validateCharacterName } from './ui/auth_utils';
import { CLASSES, ABILITIES } from './sim/content/classes';
import { iconDataUrl } from './ui/icons';
import { hydrateIcons } from './ui/ui_icons';
import { getLanguage, setLanguage, t, SupportedLanguage } from './ui/i18n';


const WORLD_SEED = 20061; // fixed: World of Claudecraft is a persistent place

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T;
let pendingDeleteCharacter: CharacterSummary | null = null;

declare const __APP_VERSION__: string;
declare const __APP_BUILD_ID__: string;
declare const __APP_BUILD_DATE__: string;

function syncBuildInfo(): void {
  const el = document.getElementById('game-version');
  if (!el) return;
  el.textContent = `v${__APP_VERSION__} · build ${__APP_BUILD_ID__}`;
  el.title = `Built ${__APP_BUILD_DATE__}`;
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
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 320) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });
}

function syncPhoneTouchClass(): void {
  document.body.classList.toggle('mobile-touch', isPhoneTouchDevice());
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
window.visualViewport?.addEventListener('scroll', syncAppViewport);
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
    'Rotate your device to landscape before entering the world.',
    'Mobile performance may be degraded. Close extra tabs and lower Render Quality if the game feels slow.',
  ];
  if (mobilePlatform() === 'ios') {
    return {
      detail: standalone
        ? 'You are in home-screen fullscreen mode. Keep the device in landscape.'
        : 'For true fullscreen on iPhone or iPad, install this page to your Home Screen first.',
      steps: standalone
        ? base
        : [
          'In Safari, tap Share, then Add to Home Screen.',
          'Open World of Claudecraft from the new Home Screen icon.',
          ...base,
        ],
    };
  }
  if (mobilePlatform() === 'android') {
    return {
      detail: standalone
        ? 'You are in fullscreen app mode. Keep the device in landscape.'
        : 'For fullscreen on Android, install this page or add it to your Home screen first.',
      steps: standalone
        ? base
        : [
          'In Chrome, tap the menu, then Install app or Add to Home screen.',
          'Open World of Claudecraft from the new icon.',
          ...base,
        ],
    };
  }
  return {
    detail: standalone
      ? 'Keep your device in landscape fullscreen.'
      : 'Install or add this page to your Home screen for the best fullscreen mobile experience.',
    steps: base,
  };
}

function showMobilePreflightPrompt(): void {
  if (!isPhoneTouchDevice()) return;
  const prompt = document.getElementById('mobile-preflight') as HTMLElement | null;
  const detail = document.getElementById('mobile-preflight-detail') as HTMLElement | null;
  const steps = document.getElementById('mobile-preflight-steps') as HTMLOListElement | null;
  const continueBtn = document.getElementById('mobile-preflight-continue') as HTMLButtonElement | null;
  if (!prompt || !detail || !steps || !continueBtn) return;

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
  continueBtn.onclick = () => hideMobilePreflightPrompt();
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
  setLoadingStatus(`Loading world… ${done}/${total}`);
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
  requestPreferredFullscreen();
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
}

// ---------------------------------------------------------------------------
// Shared game wiring (used by both offline sim and online world)
// ---------------------------------------------------------------------------

async function startGame(world: IWorld, offlineSim: Sim | null, online: ClientWorld | null): Promise<void> {
  // Model/texture/HDRI fetches were kicked off at module import; the renderer
  // builds its scene synchronously, so everything must be resolved first.
  // The loading screen covers the gap — not a silent black screen.
  enterLoadingState('Loading world…');
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
    fatalOverlay(`Asset loading failed: try reloading. ${err instanceof Error ? err.message : err}`);
    return;
  }
  setLoadingStatus('Entering the world…');
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
  try {
    renderer = new Renderer(world, canvas, nameplates);
    hud = new Hud(world, renderer, keybinds);
    hydrateIcons(); // swap [data-icon] placeholders (micro-menu, mobile bar, meters) for inline SVG

  } catch (err) {
    // e.g. WebGL context creation failure: surface it instead of leaving the
    // loading screen up forever
    fatalOverlay(`Could not start the renderer: try reloading. ${err instanceof Error ? err.message : err}`);
    return;
  }

  const chatInput = $('#chat-input') as unknown as HTMLInputElement;
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
    // slot 0 (key 1) is Attack for every class — auto-attack without needing
    // right-click; keys and clicks share the Hud's remappable slot layout
    onAbility: (slot) => hud.castSlot(slot),
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
    onClickPick: (x, y, button) => handlePick(x, y, button),
    canUseGameKeys: () => !hud.isModalOpen() && chatInput.style.display !== 'block',
  }, keybinds);
  input.camYaw = world.player.facing;

  const mobileControls = new MobileControls(input, {
    onAttackNearest: () => attackNearest(),
    onTarget: () => world.tabTarget(),
    onInteract: () => interactKey(),
    onChat: () => openChat(),
    onMenu: () => {
      if (!hud.closeAll()) hud.toggleOptionsMenu();
    },
    onSocial: () => hud.toggleSocial(),
    onArena: () => hud.toggleArena(),
    onQuestLog: () => hud.toggleQuestLog(),
    onSpellbook: () => hud.toggleSpellbook(),
    onTalents: () => hud.toggleTalents(),
    onMeters: () => hud.toggleMeters(),
    onMap: () => hud.toggleMap(),
  });
  mobileControls.start();

  // apply a setting to its live subsystem (also used to apply all on startup)
  function applySetting(key: keyof GameSettings, value: number | boolean): void {
    if (key === 'mouseCamera') {
      const v = settings.set('mouseCamera', !!value);
      input.setMouseCameraEnabled(v);
      return;
    }
    const v = settings.set(key as keyof typeof SETTING_RANGES, value as number);
    switch (key) {
      case 'cameraSpeed': input.setCameraSpeed(v); break;
      case 'sfxVolume': audio.setVolume(v); break;
      case 'musicVolume': music.setVolume(v); break;
      case 'brightness': renderer.setBrightness(v); break;
      case 'renderScale': renderer.setRenderScale(v); break;
      case 'fullscreen': v >= 0.5 ? requestPreferredFullscreen() : exitBrowserFullscreen(); break;
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
    hud.showError('Nothing to interact with.');
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
    if (best === null) { hud.showError('No enemy nearby.'); return; }
    world.targetEntity(best);
    world.startAutoAttack();
  }

  function handlePick(x: number, y: number, button: number): void {
    const id = renderer.pick(x, y);
    const clickToMove = settings.get('clickToMove') > 0 && !world.player.dead;
    if (id === null) {
      if (button === 0) {
        world.targetEntity(null);
        // left-click on open ground walks there, if the option is enabled (#95)
        if (clickToMove) {
          const g = renderer.groundPoint(x, y, world.player.pos.y);
          if (g) { input.clickMoveTarget = g; input.clickMoveStop = 0.5; }
        }
      }
      return;
    }
    // left-click on an entity: approach it (walk into melee range) when
    // click-to-move is on, in addition to the normal target/interact handling
    if (clickToMove && button === 0) {
      const e = world.entities.get(id);
      if (e && e.id !== world.player.id) { input.clickMoveTarget = { x: e.pos.x, z: e.pos.z }; input.clickMoveStop = 3.5; }
    }
    handlePickedEntity(world, hud, id, button, x, y);
  }

  let last = performance.now();
  let acc = 0;

  // Camera follow state: keyboard turning advances facing in 20Hz sim steps,
  // so the camera tracks the player's render-interpolated facing per frame
  // (same curve the character model follows) instead of the raw tick deltas —
  // that's what killed the turn stutter. While running, the orbit offset
  // eases back to zero so the camera settles in behind the character.
  let lastInterpFacing: number | null = null;
  const CAM_SETTLE_RATE = 3; // 1/s exponential ease

  function wrapAngle(d: number): number {
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  }

  function updateCamera(frameDt: number, interpFacing: number): void {
    if (input.isMouseCameraMode()) return;
    if (!input.isMouselookActive()) {
      // follow turns 1:1 (keeps any manual orbit offset constant)
      if (lastInterpFacing !== null) input.camYaw += wrapAngle(interpFacing - lastInterpFacing);
      // settle behind the character while moving, unless the player is
      // actively holding an orbit drag
      const mi = input.readMoveInput();
      if ((mi.forward || mi.strafeLeft || mi.strafeRight) && !input.leftDown) {
        input.camYaw += wrapAngle(interpFacing - input.camYaw) * (1 - Math.exp(-frameDt * CAM_SETTLE_RATE));
      }
    }
    lastInterpFacing = interpFacing; // track through mouselook too — no snap on release
  }

  // Resolve this step's movement input, folding in click-to-move (#95). Returns
  // the move flags plus an optional forced facing (mouselook angle, or the
  // bearing toward a click-to-move destination). Any manual movement, an open
  // modal, mouselook, or the option being switched off cancels click-to-move.
  function resolveMove(mouselook: boolean, playerPos: { x: number; z: number }):
    { mi: ReturnType<typeof input.readMoveInput>; facing: number | null } {
    const mi = input.readMoveInput();
    let facing: number | null = mouselook ? input.camYaw : null;
    if (input.clickMoveTarget) {
      if (mouselook || input.suspendMovement || settings.get('clickToMove') <= 0 || manualMovementOverrides(mi)) {
        input.clickMoveTarget = null;
      } else {
        const step = clickMoveStep(playerPos, input.clickMoveTarget, input.clickMoveStop);
        if (step.arrived) {
          input.clickMoveTarget = null;
        } else {
          mi.forward = true;
          facing = step.facing;
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

    // freeze movement while the game menu is up so WASD doesn't walk the
    // character behind it (other windows stay non-modal, as before)
    input.suspendMovement = hud.isModalOpen();
    input.updateTouchLook(frameDt);
    updateHoverCursor();

    const mouselook = input.isMouselookActive() && !world.player.dead;
    const controllerFacing = input.controllerFacingOverride();
    const renderFacing = renderFacingOverride();
    const movementFacing = !world.player.dead ? (renderFacing ?? controllerFacing) : null;

    if (offlineSim) {
      acc += frameDt;
      while (acc >= DT) {
        const { mi, facing } = resolveMove(mouselook, offlineSim.player.pos);
        Object.assign(offlineSim.moveInput, mi);
        const stepFacing = movementFacing ?? facing;
        if (stepFacing !== null) offlineSim.player.facing = stepFacing;
        const events = offlineSim.tick();
        hud.handleEvents(events);
        acc -= DT;
      }
      const pp = offlineSim.player;
      updateCamera(frameDt, pp.prevFacing + wrapAngle(pp.facing - pp.prevFacing) * (acc / DT));
      renderer.camYaw = input.camYaw;
      renderer.camPitch = input.camPitch;
      renderer.camDist = input.camDist;
      renderer.sync(acc / DT, frameDt, movementFacing);
      hud.update();
      return;
    }

    // online: inputs stream on a timer inside ClientWorld; here we mirror state
    const net = online!;
    const resolved = resolveMove(mouselook, world.player.pos);
    const netFacing = movementFacing ?? resolved.facing;
    Object.assign(net.moveInput, resolved.mi);
    net.setMouselookFacing(netFacing);
    net.pendingFacingDelta = 0; // superseded by the interpolated follow below
    hud.handleEvents(net.drainEvents());
    if (net.consumeInventoryChanged()) hud.onInventoryChanged();
    const alpha = net.lastSnapAt > 0
      ? Math.min(1.25, (performance.now() - net.lastSnapAt) / Math.max(20, net.snapInterval))
      : 1;
    const pe = world.player;
    // facing interp capped at 1 — extrapolating angles past the snapshot oscillates
    updateCamera(frameDt, pe.prevFacing + wrapAngle(pe.facing - pe.prevFacing) * Math.min(1, alpha));
    renderer.camYaw = input.camYaw;
    renderer.camPitch = input.camPitch;
    renderer.camDist = input.camDist;
    renderer.sync(alpha, frameDt, movementFacing);
    hud.update();
  }
  requestAnimationFrame(frame);
  // cut to the game only once the first frame is actually on screen
  requestAnimationFrame(() => requestAnimationFrame(() => hideLoadingScreen()));

  const controller = {
    move(moveInput: unknown, facing?: unknown) {
      if (arguments.length > 1) input.setControllerMoveInput(moveInput, facing);
      else input.setControllerMoveInput(moveInput);
    },
    face(facing: unknown) { input.setControllerFacing(facing); },
    stop() { input.clearControllerMoveInput(); },
  };
  (window as any).__game = { sim: world, world, renderer, input, hud, online, controller };
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

async function startOffline(playerClass: PlayerClass, name: string): Promise<void> {
  if (!(await prepareWorldEntry())) return;
  enterLoadingState('Loading world…');
  const sim = new Sim({ seed: WORLD_SEED, playerClass, playerName: name });
  void startGame(sim, sim, null);
}

// ---------------------------------------------------------------------------
// Online flow: login -> character select -> world
// ---------------------------------------------------------------------------

const api = new Api();

let activeTransitionTimeout: number | null = null;
let activeTransitionCleanup: (() => void) | null = null;
let characterPreview: CharacterPreview | null = null;

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
  const views = ['#hero-view', '#highscores-view', '#wiki-view', '#news-view', '#download-view'];
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
    '#download-view': 'nav-btn-download'
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

  const statsPanel = $('#project-stats-panel');
  if (statsPanel) {
    const shouldHideStats = el === '#charselect-panel' || el === '#offline-select';
    statsPanel.toggleAttribute('hidden', shouldHideStats);
  }

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

// WoW population bands, derived from the realm's current online count (WoW's
// own labels are relative to peak; current count is a fair local stand-in).
function realmPopulation(online: boolean, players: number): { label: string; cls: string } {
  if (!online) return { label: 'Offline', cls: 'offline' };
  if (players >= 80) return { label: 'Full', cls: 'full' };
  if (players >= 40) return { label: 'High', cls: 'high' };
  if (players >= 15) return { label: 'Medium', cls: 'med' };
  return { label: 'Low', cls: 'low' };
}

// After login WoW drops you onto a Realm List screen (then character select for
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
    if (d.realms.length === 0) { listEl.innerHTML = '<div class="realm-loading">No realms available.</div>'; return; }
    // recommend the lowest-population online realm (WoW nudges new players there)
    listEl.innerHTML = d.realms.map((r) => {
      const chars = d.characters[r.name] ?? 0;
      const charTag = chars > 0 ? `<span class="rn-chars">${chars} character${chars === 1 ? '' : 's'}</span>` : '';
      return `<div class="realm-row" data-name="${r.name}" data-url="${r.url}">
        <div><div class="realm-name">${r.name}${charTag}<span class="rn-rec" data-rec hidden>Recommended</span></div>
          <div class="realm-sub" data-sub>Checking status…</div></div>
        <div class="realm-type">${r.type}</div>
        <div class="realm-pop offline" data-pop>-</div>
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
      popEl.textContent = pop.label;
      popEl.className = `realm-pop ${pop.cls}`;
      (row.querySelector('[data-sub]') as HTMLElement).textContent = st.online ? `${st.players} online now` : 'Realm is down';
      row.classList.toggle('offline', !st.online);
      if (st.online && st.players < bestPlayers) { bestPlayers = st.players; bestName = r.name; }
    })).then(() => {
      const recRow = bestName ? listEl.querySelector(`.realm-row[data-name="${CSS.escape(bestName)}"]`) : null;
      recRow?.querySelector('[data-rec]')?.removeAttribute('hidden');
    });
  };
  if (dir) render(dir);
  else { listEl.innerHTML = '<div class="realm-loading">Loading realms…</div>'; void api.realms().then(render); }
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
  const input = $('#delete-character-confirm') as HTMLInputElement;
  const confirmBtn = $('#btn-confirm-delete-character') as HTMLButtonElement;
  nameEl.textContent = character.name;
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
  listEl.innerHTML = '<li class="char-list-message">Loading…</li>';
  try {
    const chars = await api.characters();
    if (api.realm) $('#charselect-realm').textContent = `Realm: ${api.realm}`;
    listEl.innerHTML = '';
    if (chars.length === 0) {
      listEl.innerHTML = '<li class="char-list-message">No characters yet (create one below).</li>';
    }
    for (const c of chars) {
      const row = document.createElement('li');
      row.className = 'char-row' + (c.online ? ' online' : '') + (c.forceRename ? ' rename-required' : '');
      row.setAttribute('tabindex', '0');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      row.dataset.class = c.class;
      row.innerHTML = `<span class="char-name">${c.name}</span>
        <span class="char-sub">Level ${c.level} ${c.class[0].toUpperCase()}${c.class.slice(1)}${c.online ? ' (in world)' : c.forceRename ? ' (rename required)' : ''}</span>
        ${c.forceRename
          ? `<input class="rename-input" placeholder="New character name" maxlength="16" /><span class="char-actions"><button class="btn btn-danger delete-char-btn" ${c.online ? 'disabled' : ''}>Delete</button><button class="btn rename-btn">Rename</button></span>`
          : `<span class="char-actions"><button class="btn btn-danger delete-char-btn" ${c.online ? 'disabled' : ''}>Delete</button><button class="btn enter-world-btn" ${c.online ? 'disabled' : ''}>Enter World</button></span>`}`;

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
          } catch (err: any) {
            $('#charselect-error').textContent = err.message;
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
  } catch (err: any) {
    listEl.innerHTML = `<li class="char-list-message char-list-error">${err.message}</li>`;
  }
}

function fatalOverlay(message: string): void {
  hideLoadingScreen(); // its art would bleed through the translucent backdrop
  if (document.getElementById('disconnect-overlay')) return; // first reason wins
  const el = document.createElement('div');
  el.id = 'disconnect-overlay';
  el.className = 'fatal-overlay';
  el.innerHTML = `<div>${message}</div>`;
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.textContent = 'Return to Login';
  btn.addEventListener('click', () => location.reload());
  el.appendChild(btn);
  document.body.appendChild(el);
}

async function enterWorld(c: CharacterSummary, button?: HTMLButtonElement): Promise<void> {
  try {
    if (button) {
      button.disabled = true;
      button.textContent = 'Entering...';
    }
    if (!(await prepareWorldEntry())) return;
    audio.init();
    music.init();
    enterLoadingState('Connecting to realm…');
  } finally {
    if (!hasBegunWorldEntry && button) {
      button.disabled = false;
      button.textContent = 'Enter World';
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
      fatalOverlay('Could not enter world (timeout). Is the game server running?');
    }
  }, 50);
  // a rejected join must stop the poll too, or its timeout overlay would
  // mask the real reason (e.g. "character already in world")
  world.onDisconnect = (reason) => {
    clearInterval(poll);
    fatalOverlay(reason);
  };
}

interface ClassDetails {
  role: string;
  roleType: 'tank' | 'dps' | 'ranged' | 'healer' | 'hybrid';
  armor: string;
  weapons: string;
  lore: string;
}

const CLASS_DETAILS: Record<PlayerClass, ClassDetails> = {
  warrior: {
    role: 'Tank / Melee DPS',
    roleType: 'hybrid',
    armor: 'Chainmail, Leather, Cloth',
    weapons: 'Swords, Maces, Axes',
    lore: 'Warriors are battle-hardened melee fighters who generate Rage as they deal or take damage. They excel at absorbing hits as tanks or crushing foes with heavy weapons.'
  },
  paladin: {
    role: 'Healer / Tank / Melee DPS',
    roleType: 'hybrid',
    armor: 'Chainmail, Leather, Cloth',
    weapons: 'Swords, Maces',
    lore: 'Paladins are holy crusaders who support allies with blessings, heal wounds with Holy Light, and protect the weak, wearing heavy armor to withstand physical attacks.'
  },
  hunter: {
    role: 'Ranged DPS',
    roleType: 'ranged',
    armor: 'Leather, Cloth',
    weapons: 'Axes, Swords',
    lore: 'Masters of the wilderness, Hunters track and defeat enemies from afar using bows or guns. They use traps to control the battlefield.'
  },
  rogue: {
    role: 'Melee DPS',
    roleType: 'dps',
    armor: 'Leather, Cloth',
    weapons: 'Daggers, Swords',
    lore: 'Rogues are stealthy assassins who rely on Energy and Combo Points to execute devastating backstabs and finishing moves. They strike from the shadows.'
  },
  priest: {
    role: 'Healer / Ranged DPS',
    roleType: 'healer',
    armor: 'Cloth',
    weapons: 'Staves',
    lore: 'Devoted healers who call upon the Holy Light to mend their allies and shield them from harm, while also using Shadow magic to drain the life of enemies.'
  },
  shaman: {
    role: 'Healer / Melee or Ranged DPS',
    roleType: 'hybrid',
    armor: 'Chainmail, Leather, Cloth',
    weapons: 'Maces, Axes',
    lore: 'Spiritual guides who command the elements, Shaman imbue their weapons with elemental power, shock enemies with lightning, and heal allies.'
  },
  mage: {
    role: 'Ranged DPS',
    roleType: 'ranged',
    armor: 'Cloth',
    weapons: 'Staves',
    lore: 'Arcane spellcasters who manipulate Fire, Frost, and Arcane energy to destroy their enemies. They can conjure water to restore mana and freeze foes.'
  },
  warlock: {
    role: 'Ranged DPS',
    roleType: 'ranged',
    armor: 'Cloth',
    weapons: 'Staves',
    lore: 'Dark spellcasters who summon demons, inflict curses and damage-over-time spells, and drain the life force from their enemies to sustain themselves.'
  },
  druid: {
    role: 'Tank / Healer / Melee or Ranged DPS',
    roleType: 'hybrid',
    armor: 'Leather, Cloth',
    weapons: 'Staves',
    lore: 'Shapeshifters who harness the power of nature. Druids can heal wounds, entangle foes, and transform into a mighty Bear to tank or other forms.'
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

  if (existingContent && existingName === classDef.name) {
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

  const statsList = [
    { name: 'Strength', key: 'str' },
    { name: 'Agility', key: 'agi' },
    { name: 'Stamina', key: 'sta' },
    { name: 'Intellect', key: 'int' },
    { name: 'Spirit', key: 'spi' }
  ];

  const statBarsHtml = statsList.map(s => {
    const val = classDef.baseStats[s.key as keyof typeof classDef.baseStats];
    const pct = Math.min(100, Math.round((val / 25) * 100));
    return `
      <div class="details-stat-bar-row">
        <span class="details-stat-label">${s.name}</span>
        <div class="details-stat-bar-track" aria-label="${s.name}: ${val} out of 25">
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
        dmgText = primaryEffect.min === primaryEffect.max ? `${primaryEffect.min}` : `${primaryEffect.min} to ${primaryEffect.max}`;
      } else if (primaryEffect.type === 'weaponDamage' || primaryEffect.type === 'weaponStrike') {
        dmgText = `${primaryEffect.bonus}`;
      } else if (primaryEffect.type === 'finisherDamage') {
        dmgText = `${primaryEffect.base} plus ${primaryEffect.perCombo} per combo point`;
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
          dmgText = `${secondaryEffect.total}`;
        } else if (secondaryEffect.type === 'absorb') {
          dmgText = `${secondaryEffect.amount}`;
        } else if (secondaryEffect.type === 'imbue') {
          dmgText = `${secondaryEffect.bonus}`;
        }
      }
    }
    const resolvedDesc = a.description.replace('$d', dmgText);

    return `
      <li class="details-spell-item">
        <img class="details-spell-icon-img" src="${iconUrl}" alt="${a.name}" width="32" height="32" />
        <div class="details-spell-text">
          <strong>${a.name}</strong>
          ${resolvedDesc}
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
            <h3 class="class-details-name">${classDef.name}</h3>
            <span class="class-details-role role-${details.roleType}">${details.role}</span>
          </div>
        </div>
        <p class="class-details-lore">${details.lore}</p>
        <div class="class-details-grid">
          <div class="class-details-stats-col">
            <h4 class="details-section-title">Starting Stats</h4>
            ${statBarsHtml}
          </div>
          <div class="class-details-gear-col">
            <h4 class="details-section-title">Equipment</h4>
            <div class="details-gear-row"><strong>Resource:</strong> <span class="badge badge-resource resource-${classDef.resourceType}">${classDef.resourceType}</span></div>
            <div class="details-gear-row"><strong>Armor:</strong> <span class="badge">${details.armor}</span></div>
            <div class="details-gear-row"><strong>Weapons:</strong> <span class="badge">${details.weapons}</span></div>
          </div>
          <div class="details-spells-section">
            <h4 class="details-section-title">Signature Abilities</h4>
            <ul class="details-spells-list">
              ${spellsHtml}
            </ul>
          </div>
        </div>
      </div>
    `;
    
    // Announce update to screen readers
    panel.setAttribute('aria-label', `${classDef.name} Class Details: Role is ${details.role}. starting stats are Strength ${classDef.baseStats.str}, Agility ${classDef.baseStats.agi}, Stamina ${classDef.baseStats.sta}, Intellect ${classDef.baseStats.int}, Spirit ${classDef.baseStats.spi}.`);

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

function translatePage(): void {
  const lang = getLanguage();
  document.documentElement.lang = lang;

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) {
      el.textContent = t(key as any);
    }
  });

  document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria');
    if (key) {
      el.setAttribute('aria-label', t(key as any));
    }
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) {
      el.setAttribute('placeholder', t(key as any));
    }
  });
}

async function loadProjectStats(): Promise<void> {
  const realmEl = $('#stat-realm-name');
  const accountsEl = $('#stat-accounts-count');
  const playersEl = $('#stat-players-online');

  if (!realmEl || !accountsEl || !playersEl) return;

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
    realmEl.textContent = cached.realm;
    accountsEl.textContent = String(cached.accounts_created);
    playersEl.textContent = String(cached.players_online);
    return;
  }

  // 2. Fetch fresh stats
  try {
    const data = await api.projectStats();

    realmEl.textContent = data.realm;
    accountsEl.textContent = String(data.accounts_created);
    playersEl.textContent = String(data.players_online);

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
      realmEl.textContent = `${cached.realm} (Offline)`;
      accountsEl.textContent = String(cached.accounts_created);
      playersEl.textContent = String(cached.players_online);
    } else {
      realmEl.textContent = 'Offline';
      accountsEl.textContent = '-';
      playersEl.textContent = '-';
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
      + `<span class="hs-name"${cls ? ` title="${esc(cls.name)}"` : ''}>${star}${esc(r.name)}</span>`
      + `<span class="hs-realm">${esc(r.realm ?? '')}</span>`
      + `<span class="hs-lvl">${r.level}</span>`
      + `<span class="hs-vlvl">${r.virtualLevel}</span>`
      + `<span class="hs-xp">${formatXp(r.lifetimeXp)}</span></div>`;
  }).join('');
  host.innerHTML = head + body;
}

function wireStartScreens(): void {
  // Initial page translation and stats load
  translatePage();
  void loadProjectStats();

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
      offlineError.textContent = 'Please enter a character name.';
      offlineNameInput.classList.add('user-invalid-fallback');
      offlineNameInput.setAttribute('aria-invalid', 'true');
      offlineNameInput.focus();
      return;
    }
    if (!validateCharacterName(rawName)) {
      offlineError.textContent = 'Name must be 2-16 characters, start with a letter, and contain only letters, spaces, hyphens, or apostrophes.';
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
    void startOffline(cls, name);
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
    }
  };

  onlineBtn.addEventListener('click', handleOnlineSelect);
  onlineBtn.addEventListener('keydown', (e) => handleKeyboardActivation(e as KeyboardEvent, handleOnlineSelect));
  
  offlineBtn.addEventListener('click', handleOfflineSelect);
  offlineBtn.addEventListener('keydown', (e) => handleKeyboardActivation(e as KeyboardEvent, handleOfflineSelect));

  btnStartOffline.addEventListener('click', () => {
    const selCard = document.querySelector('#offline-select .mini-class.sel') as HTMLElement | null;
    if (selCard) {
      handleOfflineStart(selCard.dataset.class as PlayerClass);
    } else {
      offlineError.textContent = 'Please select a class.';
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
    try {
      if (mode === 'login') await api.login(username, password);
      else await api.register(username, password);
      $('#charselect-user').textContent = api.username ?? '';
      await enterRealmFlow();
    } catch (err: any) {
      loginError(err.message);
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
      charselectError.textContent = 'Please enter a character name.';
      newCharNameInput.classList.add('user-invalid-fallback');
      newCharNameInput.setAttribute('aria-invalid', 'true');
      newCharNameInput.focus();
      return;
    }
    if (!validateCharacterName(name)) {
      charselectError.textContent = 'Name must be 2-16 characters, start with a letter, and contain only letters, spaces, hyphens, or apostrophes.';
      newCharNameInput.classList.add('user-invalid-fallback');
      newCharNameInput.setAttribute('aria-invalid', 'true');
      newCharNameInput.focus();
      return;
    }
    if (!clsEl) { charselectError.textContent = 'Pick a class.'; return; }

    newCharNameInput.classList.remove('user-invalid-fallback');
    newCharNameInput.removeAttribute('aria-invalid');

    try {
      await api.createCharacter(name, clsEl.dataset.class as PlayerClass);
      newCharNameInput.value = '';
      charselectError.textContent = '';
      await refreshCharacters();
    } catch (err: any) {
      charselectError.textContent = err.message;
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
    } catch (err: any) {
      setDeleteCharacterError(err.message);
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
  setupNavBtn(navBtnNews, '#news-view');
  setupNavBtn(navBtnDownload, '#download-view');
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
      const selected = langSelect.value as SupportedLanguage;
      setLanguage(selected);
      
      // Dynamically update the browser URL query parameter without page reload
      if (typeof window !== 'undefined' && window.history) {
        const url = new URL(window.location.href);
        url.searchParams.set('lang', selected);
        window.history.pushState({}, '', url.toString());
      }
      
      translatePage();
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

wireStartScreens();
