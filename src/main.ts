import { Sim } from './sim/sim';
import { Renderer } from './render/renderer';
import { Input } from './game/input';
import { Keybinds } from './game/keybinds';
import { Settings, GameSettings } from './game/settings';
import { Hud } from './ui/hud';
import { audio } from './game/audio';
import { music } from './game/music';
import { handlePickedEntity } from './game/interactions';
import { Api, ClientWorld, CharacterSummary } from './net/online';
import type { IWorld } from './world_api';
import { assetsReady } from './render/assets/preload';
import { CharacterPreview } from './render/characters';
import { DT, INTERACT_RANGE, PlayerClass, dist2d } from './sim/types';
import { togglePasswordVisibility, syncInputAriaState, validateForm, handleKeyboardActivation, validateCharacterName } from './ui/auth_utils';
import { CLASSES, ABILITIES } from './sim/content/classes';
import { iconDataUrl } from './ui/icons';


const WORLD_SEED = 20061; // fixed: World of Claudecraft is a persistent place

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T;

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

// The loading screen blocks pointer input but a covered button keeps keyboard
// focus, so Enter/Space could re-fire it mid-entry. One entry per page load;
// every failure path recovers via fatalOverlay's reload.
let hasBegunWorldEntry = false;

function beginWorldEntry(): boolean {
  if (hasBegunWorldEntry) return false;
  hasBegunWorldEntry = true;
  return true;
}

// ---------------------------------------------------------------------------
// Shared game wiring (used by both offline sim and online world)
// ---------------------------------------------------------------------------

async function startGame(world: IWorld, offlineSim: Sim | null, online: ClientWorld | null): Promise<void> {
  // Model/texture/HDRI fetches were kicked off at module import; the renderer
  // builds its scene synchronously, so everything must be resolved first.
  // The loading screen covers the gap — not a silent black screen.
  showLoadingScreen('Loading world…');
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  $('#start-screen').style.display = 'none';
  try {
    await assetsReady((done, total) => setLoadingProgress(done, total));
  } catch (err) {
    fatalOverlay(`Asset loading failed: try reloading. ${err instanceof Error ? err.message : err}`);
    return;
  }
  setLoadingStatus('Entering the world…');

  const canvas = $('#game-canvas') as unknown as HTMLCanvasElement;
  const nameplates = $('#nameplates') as HTMLDivElement;

  const keybinds = new Keybinds();
  const settings = new Settings();
  let renderer!: Renderer;
  let hud!: Hud;
  try {
    renderer = new Renderer(world, canvas, nameplates);
    hud = new Hud(world, renderer, keybinds);
  } catch (err) {
    // e.g. WebGL context creation failure: surface it instead of leaving the
    // loading screen up forever
    fatalOverlay(`Could not start the renderer: try reloading. ${err instanceof Error ? err.message : err}`);
    return;
  }

  const chatInput = $('#chat-input') as unknown as HTMLInputElement;
  function openChat(): void {
    chatInput.style.display = 'block';
    chatInput.focus();
  }
  chatInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const text = chatInput.value.trim();
      if (text) world.chat(text);
      chatInput.value = '';
      chatInput.style.display = 'none';
      chatInput.blur();
    } else if (e.key === 'Escape') {
      chatInput.value = '';
      chatInput.style.display = 'none';
      chatInput.blur();
    }
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
        case 'meters': hud.toggleMeters(); break;
        case 'arena': hud.toggleArena(); break;
        case 'social': hud.toggleSocial(); break;
        case 'chat': openChat(); break;
        case 'escape':
          // close the topmost panel; if nothing was open, open the game menu
          if (!hud.closeAll()) hud.toggleOptionsMenu();
          break;
      }
    },
    onClickPick: (x, y, button) => handlePick(x, y, button),
  }, keybinds);
  input.camYaw = world.player.facing;

  // apply a setting to its live subsystem (also used to apply all on startup)
  function applySetting(key: keyof GameSettings, value: number): void {
    const v = settings.set(key, value);
    switch (key) {
      case 'cameraSpeed': input.setCameraSpeed(v); break;
      case 'sfxVolume': audio.setVolume(v); break;
      case 'musicVolume': music.setVolume(v); break;
      case 'brightness': renderer.setBrightness(v); break;
      case 'renderScale': renderer.setRenderScale(v); break;
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

  function handlePick(x: number, y: number, button: number): void {
    const id = renderer.pick(x, y);
    if (id === null) {
      if (button === 0) world.targetEntity(null);
      return;
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
    if (!input.rightDown) {
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

  function frame(now: number): void {
    requestAnimationFrame(frame);
    let frameDt = (now - last) / 1000;
    last = now;
    if (frameDt > 0.25) frameDt = 0.25;

    // freeze movement while the game menu is up so WASD doesn't walk the
    // character behind it (other windows stay non-modal, as before)
    input.suspendMovement = hud.isModalOpen();

    const mouselook = input.rightDown && !world.player.dead;

    if (offlineSim) {
      acc += frameDt;
      while (acc >= DT) {
        const mi = input.readMoveInput();
        Object.assign(offlineSim.moveInput, mi);
        if (mouselook) offlineSim.player.facing = input.camYaw;
        const events = offlineSim.tick();
        hud.handleEvents(events);
        acc -= DT;
      }
      const pp = offlineSim.player;
      updateCamera(frameDt, pp.prevFacing + wrapAngle(pp.facing - pp.prevFacing) * (acc / DT));
      renderer.camYaw = input.camYaw;
      renderer.camPitch = input.camPitch;
      renderer.camDist = input.camDist;
      renderer.sync(acc / DT, frameDt, mouselook ? input.camYaw : null);
      hud.update();
      return;
    }

    // online: inputs stream on a timer inside ClientWorld; here we mirror state
    const net = online!;
    Object.assign(net.moveInput, input.readMoveInput());
    net.setMouselookFacing(mouselook ? input.camYaw : null);
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
    renderer.sync(alpha, frameDt, mouselook ? input.camYaw : null);
    hud.update();
  }
  requestAnimationFrame(frame);
  // cut to the game only once the first frame is actually on screen
  requestAnimationFrame(() => requestAnimationFrame(() => hideLoadingScreen()));

  (window as any).__game = { sim: world, world, renderer, input, hud, online };
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

function startOffline(playerClass: PlayerClass, name: string): void {
  if (!beginWorldEntry()) return;
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

function show(el: string): void {
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
  const startScreen = $('#start-screen');

  // Automatically close controls drawer if navigating away from mode-select
  if (el !== '#mode-select') {
    const closeBtn = $('#btn-close-controls') as HTMLButtonElement | null;
    const controlsDrawer = $('#controls-drawer');
    if (controlsDrawer && !controlsDrawer.hasAttribute('hidden') && closeBtn) {
      closeBtn.click();
    }
  }

  // Find currently visible panel
  const currentActiveId = panels.find(id => !$(id).hasAttribute('hidden'));

  if (!currentActiveId || currentActiveId === el) {
    // Show instantly on initial load or same panel
    for (const id of panels) {
      $(id).toggleAttribute('hidden', id !== el);
    }
    $('#social-links')?.toggleAttribute('hidden', el !== '#mode-select');
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
    $('#social-links')?.toggleAttribute('hidden', el !== '#mode-select');
    if (el === '#charselect-panel' || el === '#offline-select') {
      updatePreviewContainer(el);
    }
    return;
  }

  const socialLinks = $('#social-links');

  // Fade out using CSS classes
  fromPanel.classList.add('panel-transition', 'panel-fade-out');

  if (el !== '#mode-select' && socialLinks && !socialLinks.hasAttribute('hidden')) {
    socialLinks.classList.add('social-links-fade-out');
  }

  const cleanupFrom = () => {
    fromPanel.toggleAttribute('hidden', true);
    fromPanel.classList.remove('panel-transition', 'panel-fade-out');
    if (socialLinks) {
      socialLinks.classList.remove('social-links-fade-out');
    }
  };

  activeTransitionCleanup = cleanupFrom;

  activeTransitionTimeout = window.setTimeout(() => {
    cleanupFrom();
    activeTransitionCleanup = null;
    activeTransitionTimeout = null;

    if (socialLinks) {
      socialLinks.toggleAttribute('hidden', el !== '#mode-select');
      if (el === '#mode-select') {
        socialLinks.classList.add('social-links-fade-out');
        void socialLinks.offsetHeight;
        socialLinks.classList.remove('social-links-fade-out');
      }
    }

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
        <div class="realm-pop offline" data-pop>—</div>
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

async function refreshCharacters(): Promise<void> {
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
          ? '<input class="rename-input" placeholder="New character name" maxlength="16" /><button class="btn rename-btn">Rename</button>'
          : `<button class="btn" ${c.online ? 'disabled' : ''}>Enter World</button>`}`;

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
        row.querySelector('button')!.addEventListener('click', (e) => {
          e.stopPropagation();
          enterWorld(c);
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

function enterWorld(c: CharacterSummary): void {
  if (!beginWorldEntry()) return;
  audio.init();
  music.init();
  showLoadingScreen('Connecting to realm…');
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

function wireStartScreens(): void {
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
    startOffline(cls, name);
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

  // Collapsible Controls Drawer toggle
  const controlsDrawer = $('#controls-drawer');
  const toggleControlsBtn = $('#btn-toggle-controls');
  const closeControlsBtn = $('#btn-close-controls');

  const toggleControls = (show: boolean) => {
    controlsDrawer.toggleAttribute('hidden', !show);
    toggleControlsBtn.setAttribute('aria-expanded', show ? 'true' : 'false');
    if (show) {
      closeControlsBtn.focus();
    } else {
      toggleControlsBtn.focus();
    }
  };

  toggleControlsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const isVisible = !controlsDrawer.hasAttribute('hidden');
    toggleControls(!isVisible);
  });

  closeControlsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    toggleControls(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !controlsDrawer.hasAttribute('hidden')) {
      toggleControls(false);
    }
  });

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
