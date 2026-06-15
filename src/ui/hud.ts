import { formatMoney, ResolvedAbility } from '../sim/sim';
import type { FriendInfo, IWorld, MarketInfo } from '../world_api';
import { Renderer } from '../render/renderer';
import {
  ABILITIES, CLASSES, DUNGEON_LIST, DUNGEON_X_THRESHOLD, ITEMS, MOBS, NPCS, PROPS, QUESTS,
  WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_X, WORLD_MIN_Z, ZONES, dungeonAt, questRewardItem, zoneAt,
  zoneWelcomeText,
} from '../sim/data';
import type { ZoneDef } from '../sim/data';
import type { InvSlot } from '../sim/types';
import {
  AbilityEffect, CONSUME_DURATION, Entity, FISHING_CAST_ID, FISHING_CAST_NAME, GCD, ItemDef, SimEvent,
  dist2d, xpForLevel, MAX_LEVEL, MELEE_RANGE, MILESTONES, virtualLevel, canPrestige, xpUntilNextPrestige,
} from '../sim/types';
import type { LeaderboardEntry } from '../world_api';
import { xpBarView, formatXp } from './xp_bar';
import { t } from './i18n';
import { terrainHeight, WATER_LEVEL, roadDistance, generateDecorations } from '../sim/world';
import type { Decoration } from '../sim/world';
import { Meters } from './meters';
import { audio } from '../game/audio';
import { music } from '../game/music';
import { iconDataUrl, iconCanvas, QUALITY_COLOR, raidMarkerDataUrl, RAID_MARKER_NAMES } from './icons';
import { svgIcon } from './ui_icons';
import { Keybinds, BIND_ACTIONS, BIND_CATEGORIES, isReservedCode, keyLabel } from '../game/keybinds';
import { Settings, GameSettings, BoolSettingKey, NumericSettingKey, SETTING_RANGES } from '../game/settings';
import { chatPlayerContextActions } from './player_context_menu';
import {
  talentsFor, computeTalentModifiers, validateAllocation, dormantNodes, pointsSpent,
  exportBuild, importBuild, cloneAllocation, talentPointsAtLevel, FIRST_TALENT_LEVEL,
  type TalentAllocation, type TalentNode, type SpecDef, type Role, type TalentEffect,
} from '../sim/content/talents';
import {
  clearHotbarSlot, encodeHotbarAction, HOTBAR_ACTION_MIME, HotbarAction, parseHotbarAction, parseHotbarActions,
  placeAbilityOnSlot, placeItemOnSlot, swapHotbarSlots, syncHotbarActions,
} from './hotbar';

// hooks main wires after Input exists (the options menu drives input, audio,
// graphics, and logout, all of which live outside the HUD)
export interface OptionsHooks {
  logout(): void;
  captureKey(cb: (code: string | null) => void): void;
  settings: Settings;
  onSettingChange(key: keyof GameSettings, value: GameSettings[keyof GameSettings]): void;
}

export interface ReportHooks {
  submit(targetPid: number, reason: string, details: string): Promise<void>;
  submitByName?(targetName: string, reason: string, details: string): Promise<void>;
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T;
const esc = (value: unknown): string => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');
const castDisplayName = (id: string): string => id === FISHING_CAST_ID ? FISHING_CAST_NAME : ABILITIES[id]?.name ?? id;

// Classic class colors (CLASSES[cls].color is a 0xRRGGBB number) as a CSS
// string, used to color-code party members on the minimap and in the frames.
const classCss = (cls: string): string =>
  '#' + ((CLASSES as Record<string, { color: number }>)[cls]?.color ?? 0x5fa8ff).toString(16).padStart(6, '0');

// Talent icons derive from a node's effect — an ability-linked node shows that
// ability's painted icon; a stat/global node shows a themed crest — so they
// match the spellbook art and the 8 unwritten class trees inherit consistent
// icons automatically, with no hand-set glyphs to keep in sync.
const TALENT_STAT_CREST: Record<string, string> = {
  armorPct: 'talent_armor', armor: 'talent_armor',
  crit: 'talent_crit', spellPower: 'talent_crit',
  dodge: 'talent_dodge',
  ap: 'talent_ap', apPct: 'talent_ap',
  maxHpPct: 'talent_health', sta: 'talent_health',
  haste: 'talent_haste',
};
function talentEffectIcon(effect: TalentEffect | undefined, kind: string): string {
  const ab = effect?.grant?.ability ?? effect?.ability?.[0]?.ability;
  if (ab && ABILITIES[ab]) return iconDataUrl('ability', ab);
  const stat = effect?.stats ? Object.keys(effect.stats)[0] : undefined;
  if (stat) return iconDataUrl('crest', TALENT_STAT_CREST[stat] ?? 'talent_generic');
  if (effect?.global) return iconDataUrl('crest', effect.global.threatPct ? 'talent_armor' : 'talent_crit');
  return iconDataUrl('crest', kind === 'choice' ? 'talent_choice' : 'talent_generic');
}

// Party frames dim and the minimap pins members to the rim once they pass
// this range (yards) — just inside the server's ~120 yd interest scope.
const PARTY_RANGE_YD = 100;

// yards past a zone boundary before the crossing banner/welcome commits
const ZONE_BANNER_DEADBAND = 5;
const IGNORED_CHAT_NAMES_KEY = 'woc_ignored_chat_names';

// world map: terrain is pre-rendered for the whole zone at this resolution
// (cached per zone) and a sub-rect is blitted for the current zoom.
const MAP_BG_RES = 480;
const MAP_MAX_ZOOM = 6;
const MAP_DETAIL_ZOOM = 2.2; // at/above this zoom, overlay buildings + vegetation

export class Hud {
  private static readonly BAR_ABILITY_SLOTS = 11; // bar slots 1..11; slot 0 is the fixed Attack toggle
  private abilityButtons: { btn: HTMLButtonElement; label: HTMLSpanElement; countEl: HTMLSpanElement; keybindEl: HTMLSpanElement; cdOverlay: HTMLDivElement; cdText: HTMLDivElement; lastIcon: string }[] = [];
  private hotbarActions: HotbarAction[] = []; // index = barSlot-1
  private loadedSlotMapFromStorage = false;
  private knownAbilityIdsAtLastSlotSync: Set<string> | null = null;
  private dragAction: { action: Exclude<HotbarAction, null>; sourceIndex: number | null } | null = null;
  private optionsHooks: OptionsHooks | null = null;
  private reportHooks: ReportHooks | null = null;
  private optionsView: 'main' | 'keybinds' | 'graphics' | 'audio' = 'main';
  private capturingKey: { action: string; index: number } | null = null; // binding awaiting a key
  private keybindNote = '';
  private chatLogEl = $('#chatlog');
  private combatLogEl = $('#combatlog');
  private errorEl = $('#error-msg');
  private bannerEl = $('#banner');
  private tooltipEl = $('#tooltip');
  private errorTimer: number | undefined;
  private bannerTimer: number | undefined;
  private minimapCtx: CanvasRenderingContext2D;
  private minimapBg: HTMLCanvasElement;
  private mapBg: HTMLCanvasElement | null = null;
  private openLootMobId: number | null = null;
  private openVendorNpcId: number | null = null;
  private openGossipNpcId: number | null = null;
  private selectedQuestLogId: string | null = null;
  private lastPortraitTarget = -999;
  // trading: locally staged offer, pushed to the server on change
  private stagedTrade: { items: InvSlot[]; copper: number } = { items: [], copper: 0 };
  private tradeWasOpen = false;
  private lastTradeSig = '';
  private lastPartySig = '';
  private lastArenaSig = '';
  private lastArenaStatusSig = '';
  private arenaMatchSeen = false; // closes the queue panel once a bout starts
  // World Market (the Merchant's auction house)
  private marketOpen = false;
  private marketTab: 'browse' | 'sell' | 'collect' = 'browse';
  private marketSellItem: string | null = null; // bag item staged for listing
  private lastMarketSig = '';
  // all-time ladder, fetched best-effort from the server (online only)
  private arenaAllTime: { name: string; class: string; level: number; rating: number; wins: number; losses: number }[] | null = null;
  private arenaLbFetchedAt = 0;
  private lastCombatEventAt = 0;
  private lastZoneId = '';
  private mapZoneId = ''; // zone the cached map-window canvas was rendered for
  private mapZoom = 1; // world-map zoom: 1 = whole zone, up to MAP_MAX_ZOOM
  private mapCenter: { x: number; z: number } | null = null; // pan target; null = follow player
  private mapDrag: { px: number; py: number; cx: number; cz: number } | null = null;
  private mapView: { spanX: number; spanZ: number; minX: number; maxX: number; minZ: number; maxZ: number } | null = null;
  private mapDecorations: Decoration[] | null = null; // cached trees/rocks (whole world)
  private ignoredChatNames = new Set<string>();
  private socialTab: 'friends' | 'guild' | 'ignore' = 'friends';
  // split signatures: structural changes (tab, guild membership) rebuild the
  // whole panel; content-only changes (a friend's presence) refresh just the
  // list, so an open typeahead / half-typed name survives a snapshot
  private lastSocialStruct = '';
  private lastSocialContent = '';
  private socialNotice: { text: string; error: boolean } | null = null;
  private socialSuggestTimer: number | undefined;
  // current typeahead state: which input, its results, and the keyboard-
  // highlighted row (-1 = none), so Enter/Arrow keys can pick a suggestion
  private socialSuggest: { field: string; items: { name: string; cls: string; level: number }[]; index: number } = { field: '', items: [], index: -1 };

  private meters: Meters;
  // Talents: a local staged allocation the user edits before committing (Apply).
  private talentStage: TalentAllocation | null = null;
  private talentTab: 'class' | 'spec' = 'class';

  constructor(private sim: IWorld, private renderer: Renderer, private keybinds: Keybinds) {
    this.ignoredChatNames = this.loadIgnoredChatNames();
    this.meters = new Meters(sim);
    this.bindLogTabs();
    this.loadSlotMap();
    this.buildActionBar();
    this.refreshKeybindLabels();
    this.buildXpTicks();
    $('#pf-name').textContent = sim.player.name;
    this.drawPortrait($('#pf-portrait') as unknown as HTMLCanvasElement, `class_${sim.cfg.playerClass}`);
    const mm = $('#minimap') as unknown as HTMLCanvasElement;
    this.minimapCtx = mm.getContext('2d')!;
    this.minimapBg = this.renderTerrainCanvas(140, { minX: WORLD_MIN_X, maxX: WORLD_MAX_X, minZ: WORLD_MIN_Z, maxZ: WORLD_MAX_Z });
    mm.style.cursor = 'pointer';
    mm.title = 'Open world map';
    mm.addEventListener('click', () => this.toggleMap());
    $('#release-btn').addEventListener('click', () => { this.sim.releaseSpirit(); });
    // classic WoW: the player interaction menu opens from the target portrait
    $('#target-frame').addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      const tid = this.sim.player.targetId;
      const t = tid !== null ? this.sim.entities.get(tid) : null;
      if (t && t.kind === 'player' && t.id !== this.sim.playerId) {
        this.openContextMenu(t.id, t.name, (ev as MouseEvent).clientX, (ev as MouseEvent).clientY);
      } else if (t && t.kind === 'mob' && !t.dead && t.hostile && t.ownerId === null && this.sim.partyInfo) {
        // classic WoW: right-click an enemy's unit frame to set a raid marker.
        // Mirror Sim.setMarker's markable criteria (live wild hostile mob) so the
        // menu never appears for a pet/non-hostile mob where it would be a no-op.
        this.openMarkerMenu(t.id, t.name, (ev as MouseEvent).clientX, (ev as MouseEvent).clientY);
      }
    });
    $('#mm-char').addEventListener('click', () => this.toggleChar());
    $('#mm-spell').addEventListener('click', () => this.toggleSpellbook());
    $('#mm-talents')?.addEventListener('click', () => this.toggleTalents());
    $('#mm-quest').addEventListener('click', () => this.toggleQuestLog());
    $('#mm-map').addEventListener('click', () => this.toggleMap());
    $('#map-close').addEventListener('click', () => { $('#map-window').style.display = 'none'; });
    const mapCanvas = $('#map-canvas') as unknown as HTMLCanvasElement;
    mapCanvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      this.zoomMap((ev as WheelEvent).deltaY < 0 ? 1.2 : 1 / 1.2);
    }, { passive: false });
    $('#map-zoom-in')?.addEventListener('click', () => this.zoomMap(1.4));
    $('#map-zoom-out')?.addEventListener('click', () => this.zoomMap(1 / 1.4));
    // drag to pan (only meaningful while zoomed in; at zoom 1 the whole zone fits)
    mapCanvas.addEventListener('pointerdown', (ev) => {
      if (!this.mapView || this.mapZoom <= 1) return;
      const base = this.mapCenter ?? { x: this.sim.player.pos.x, z: this.sim.player.pos.z };
      this.mapCenter = { ...base };
      this.mapDrag = { px: ev.clientX, py: ev.clientY, cx: base.x, cz: base.z };
      mapCanvas.setPointerCapture(ev.pointerId);
      mapCanvas.style.cursor = 'grabbing';
    });
    mapCanvas.addEventListener('pointermove', (ev) => {
      if (!this.mapDrag || !this.mapView) return;
      const rect = mapCanvas.getBoundingClientRect();
      // "grab the paper" pan: the world point under the cursor stays under it.
      // toMap draws +X to the left and +Z up (mx = (maxX-x)/span, my = (maxZ-z)/
      // span), so a cursor delta of (dx, dy) px shifts the centre by (+dx, +dy)
      // world units on each axis.
      const wppx = this.mapView.spanX / rect.width;
      const wppy = this.mapView.spanZ / rect.height;
      this.mapCenter = {
        x: this.mapDrag.cx + (ev.clientX - this.mapDrag.px) * wppx,
        z: this.mapDrag.cz + (ev.clientY - this.mapDrag.py) * wppy,
      };
      this.updateMapWindow();
    });
    const endDrag = () => { this.mapDrag = null; mapCanvas.style.cursor = ''; };
    mapCanvas.addEventListener('pointerup', endDrag);
    mapCanvas.addEventListener('pointercancel', endDrag);
    $('#mm-bag').addEventListener('click', () => this.toggleBags());
    $('#mm-social').addEventListener('click', () => this.toggleSocial());
    $('#mm-options')?.addEventListener('click', () => this.toggleOptionsMenu());
    $('#mm-arena').addEventListener('click', () => this.toggleArena());
    $('#mm-leaderboard').addEventListener('click', () => this.toggleLeaderboard());
    const musicBtn = $('#mm-music');
    const styleMusicBtn = () => {
      // keep the note clearly readable when off (a plain tan, not gold) — the
      // slash, not dimming, signals "muted"
      musicBtn.style.color = music.enabled ? 'var(--gold)' : '#cdbd8e';
      musicBtn.classList.toggle('mm-muted', !music.enabled);
    };
    styleMusicBtn();
    musicBtn.addEventListener('click', () => {
      music.setEnabled(!music.enabled);
      styleMusicBtn();
    });
    const startZone = zoneAt(sim.player.pos.z);
    this.lastZoneId = startZone.id;
    this.showBanner(startZone.name);
    this.log(`Welcome to ${startZone.name}!`, '#ffd100');
    this.logZoneWelcome(startZone);
  }

  private bindLogTabs(): void {
    const tabs = document.querySelectorAll<HTMLButtonElement>('.chat-tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const which = tab.dataset.logTab;
        tabs.forEach((t) => t.classList.toggle('active', t === tab));
        $('#chatlog').classList.toggle('active', which === 'chat');
        $('#combatlog').classList.toggle('active', which === 'combat');
      });
    });
  }

  // -------------------------------------------------------------------------
  // Portraits, icons, tooltips, money
  // -------------------------------------------------------------------------

  // Portrait = the procedural crest for a class (`class_<id>`), mob family
  // (`family_<id>`) or status (`status_npc`), painted by icons.ts and blitted in.
  private drawPortrait(canvas: HTMLCanvasElement, crestId: string): void {
    const ctx = canvas.getContext('2d')!;
    const s = canvas.width;
    ctx.clearRect(0, 0, s, s);
    ctx.drawImage(iconCanvas('crest', crestId, s), 0, 0, s, s);
  }

  private itemIcon(item: ItemDef): string {
    const q = item.quality ?? 'common';
    return `<img class="item-icon q-${q}" src="${iconDataUrl('item', item.id)}" alt="" draggable="false">`;
  }

  moneyHtml(copper: number): string {
    const g = Math.floor(copper / 10000);
    const s = Math.floor((copper % 10000) / 100);
    const c = copper % 100;
    let html = '';
    if (g > 0) html += `${g}<span class="coin g"></span>`;
    if (s > 0 || g > 0) html += `${s}<span class="coin s"></span>`;
    html += `${c}<span class="coin c"></span>`;
    return html;
  }

  attachTooltip(el: HTMLElement, html: () => string): void {
    let touchTimer: number | undefined;
    const mobile = () => document.body.classList.contains('mobile-touch');
    const clearTouchTimer = () => {
      if (touchTimer !== undefined) window.clearTimeout(touchTimer);
      touchTimer = undefined;
    };
    const showAt = (x: number, y: number) => {
      this.tooltipEl.innerHTML = html();
      this.tooltipEl.style.display = 'block';
      const tw = this.tooltipEl.offsetWidth, th = this.tooltipEl.offsetHeight;
      this.tooltipEl.style.left = `${Math.min(window.innerWidth - tw - 8, x + 14)}px`;
      this.tooltipEl.style.top = `${Math.max(8, y - th - 10)}px`;
    };
    el.addEventListener('mouseenter', () => {
      if (mobile()) return;
      this.tooltipEl.innerHTML = html();
      this.tooltipEl.style.display = 'block';
    });
    el.addEventListener('mousemove', (e) => {
      if (mobile()) return;
      const tw = this.tooltipEl.offsetWidth, th = this.tooltipEl.offsetHeight;
      this.tooltipEl.style.left = `${Math.min(window.innerWidth - tw - 8, e.clientX + 14)}px`;
      this.tooltipEl.style.top = `${Math.max(8, e.clientY - th - 10)}px`;
    });
    el.addEventListener('mouseleave', () => { clearTouchTimer(); this.tooltipEl.style.display = 'none'; });
    el.addEventListener('pointerdown', (e) => {
      if (!mobile() || e.pointerType === 'mouse') return;
      clearTouchTimer();
      const x = e.clientX, y = e.clientY;
      touchTimer = window.setTimeout(() => showAt(x, y), 950);
    });
    el.addEventListener('pointerup', clearTouchTimer);
    el.addEventListener('pointercancel', clearTouchTimer);
  }

  hideTooltip(): void {
    this.tooltipEl.style.display = 'none';
  }

  private itemTooltip(item: ItemDef): string {
    const qColor = QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff';
    let html = `<div class="tt-title" style="color:${qColor}">${item.name}</div>`;
    if (item.slot) {
      const slotNames: Record<string, string> = { mainhand: 'Main Hand', chest: 'Chest', legs: 'Legs', feet: 'Feet' };
      html += `<div class="tt-sub">${slotNames[item.slot]}</div>`;
    }
    if (item.weapon) {
      const dps = ((item.weapon.min + item.weapon.max) / 2 / item.weapon.speed).toFixed(1);
      html += `<div class="tt-stat">${item.weapon.min} - ${item.weapon.max} Damage&nbsp;&nbsp;Speed ${item.weapon.speed.toFixed(1)}</div>`;
      html += `<div class="tt-stat">(${dps} damage per second)</div>`;
      if (item.weapon.dagger) html += `<div class="tt-sub">Dagger</div>`;
    }
    if (item.stats) {
      for (const [k, v] of Object.entries(item.stats)) {
        if (k === 'armor') html += `<div class="tt-stat">${v} Armor</div>`;
        else html += `<div class="tt-green">+${v} ${k[0].toUpperCase()}${k.slice(1)}</div>`;
      }
    }
    if (item.foodHp) html += `<div class="tt-desc">Use: Restores ${item.foodHp} health over 18 sec. Must remain seated while eating.</div>`;
    if (item.drinkMana) html += `<div class="tt-desc">Use: Restores ${item.drinkMana} mana over 18 sec. Must remain seated while drinking.</div>`;
    if (item.use?.type === 'fishing') html += `<div class="tt-desc">Use: Fish in nearby waters.</div>`;
    if (item.potionHp) html += `<div class="tt-desc">Use: Instantly restores ${item.potionHp} health. Usable in combat. 1 min cooldown.</div>`;
    if (item.potionMana) html += `<div class="tt-desc">Use: Instantly restores ${item.potionMana} mana. Usable in combat. 1 min cooldown.</div>`;
    if (item.kind === 'quest') html += `<div class="tt-desc">Quest Item</div>`;
    if (item.requiredClass) html += `<div class="tt-sub">Classes: ${item.requiredClass.map((c) => CLASSES[c].name).join(', ')}</div>`;
    if (item.sellValue > 0) html += `<div class="tt-sub">Sell price: ${formatMoney(item.sellValue)}</div>`;
    return html;
  }

  private abilityTooltip(res: ResolvedAbility): string {
    const a = res.def;
    const resName = this.sim.player.resourceType === 'rage' ? 'Rage' : this.sim.player.resourceType === 'energy' ? 'Energy' : 'Mana';
    let dmgText = '';
    const primaryEffect = res.effects.find(eff => 
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
      if (primaryEffect.type === 'directDamage' || primaryEffect.type === 'aoeDamage' || primaryEffect.type === 'aoeRoot' || primaryEffect.type === 'drainTick') {
        dmgText = primaryEffect.min === primaryEffect.max ? `${primaryEffect.min}` : `${primaryEffect.min} to ${primaryEffect.max}`;
      } else if (primaryEffect.type === 'weaponDamage' || primaryEffect.type === 'weaponStrike') {
        dmgText = `${primaryEffect.bonus}`;
      } else if (primaryEffect.type === 'finisherDamage') {
        dmgText = `${primaryEffect.base} plus ${primaryEffect.perCombo} per combo point`;
      }
    } else {
      const secondaryEffect = res.effects.find(eff => 
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
    let html = `<div class="tt-title">${a.name}</div>`;
    html += `<div class="tt-sub">Rank ${res.rank}</div>`;
    const costLine: string[] = [];
    if (res.cost > 0) costLine.push(`${res.cost} ${resName}`);
    if (a.range > 0) costLine.push(`${a.minRange ? a.minRange + '-' : ''}${a.range} yd range`);
    if (costLine.length) html += `<div class="tt-stat">${costLine.join(' &nbsp; ')}</div>`;
    const castLine: string[] = [];
    castLine.push(a.channel ? `Channeled (${a.channel.duration} sec)` : res.castTime > 0 ? `${res.castTime} sec cast` : 'Instant');
    if (a.cooldown > 0) castLine.push(`${a.cooldown} sec cooldown`);
    html += `<div class="tt-stat">${castLine.join(' &nbsp; ')}</div>`;
    html += `<div class="tt-desc">${a.description.replace('$d', dmgText)}</div>`;
    return html;
  }

  // -------------------------------------------------------------------------
  // Action bar
  // -------------------------------------------------------------------------

  // The hotbar layout is a client-side remap over learned abilities and item
  // shortcuts. Abilities are keyed by id (known is class-ordered and shifts on
  // level-up, so indices would not survive). Persisted per class+character.
  private slotMapKey(): string {
    return `woc_hotbar_${this.sim.cfg.playerClass}_${this.sim.player.name}`;
  }

  private isHotbarItemId(itemId: string): boolean {
    const item = ITEMS[itemId];
    return item?.kind === 'food' || item?.kind === 'drink' || item?.kind === 'potion' || item?.use?.type === 'fishing';
  }

  private loadSlotMap(): void {
    let arr: unknown = null;
    try { arr = JSON.parse(localStorage.getItem(this.slotMapKey()) ?? 'null'); } catch { /* corrupt */ }
    this.loadedSlotMapFromStorage = Array.isArray(arr);
    this.hotbarActions = parseHotbarActions(
      arr,
      Hud.BAR_ABILITY_SLOTS,
      (id) => !!ABILITIES[id],
      (id) => this.isHotbarItemId(id),
    );
  }

  private saveSlotMap(): void {
    try { localStorage.setItem(this.slotMapKey(), JSON.stringify(this.hotbarActions)); } catch { /* storage unavailable */ }
  }

  // Drop unlearned ability ids; place newly learned abilities in the first
  // empty slot. Item shortcuts stay assigned even when their count reaches 0.
  private syncSlotMap(): void {
    const knownAbilityIds = this.sim.known.map((k) => k.def.id);
    const autoPlaceAbilityIds = new Set<string>();
    if (this.knownAbilityIdsAtLastSlotSync === null) {
      if (!this.loadedSlotMapFromStorage) {
        for (const id of knownAbilityIds) autoPlaceAbilityIds.add(id);
      }
    } else {
      for (const id of knownAbilityIds) {
        if (!this.knownAbilityIdsAtLastSlotSync.has(id)) autoPlaceAbilityIds.add(id);
      }
    }
    const synced = syncHotbarActions(this.hotbarActions, knownAbilityIds, autoPlaceAbilityIds);
    this.hotbarActions = synced.actions;
    if (synced.changed) this.saveSlotMap();
    this.knownAbilityIdsAtLastSlotSync = new Set(knownAbilityIds);
  }

  private actionForSlot(barSlot: number): HotbarAction { // barSlot 1..11
    return this.hotbarActions[barSlot - 1] ?? null;
  }

  abilityForSlot(barSlot: number): ResolvedAbility | null { // barSlot 1..11
    const action = this.actionForSlot(barSlot);
    return action?.type === 'ability'
      ? this.sim.known.find((k) => k.def.id === action.id) ?? null
      : null;
  }

  private itemForSlot(barSlot: number): ItemDef | null {
    const action = this.actionForSlot(barSlot);
    return action?.type === 'item' ? ITEMS[action.id] ?? null : null;
  }

  private inventoryCount(itemId: string): number {
    return this.sim.inventory.reduce((total, slot) => total + (slot.itemId === itemId ? slot.count : 0), 0);
  }

  // Shared entry point for hotbar clicks and the 1..0-= keybinds.
  castSlot(barSlot: number): void {
    if (barSlot === 0) {
      if (this.sim.player.autoAttack) this.sim.stopAutoAttack();
      else this.sim.startAutoAttack();
      return;
    }
    const action = this.actionForSlot(barSlot);
    if (action?.type === 'ability') {
      // cast by ability id: the server validates against its own known list,
      // so the client-side slot remap never desyncs slot semantics
      if (this.abilityForSlot(barSlot)) this.sim.castAbility(action.id);
    } else if (action?.type === 'item' && this.isHotbarItemId(action.id)) {
      if (this.tradeOpen) return;
      this.sim.useItem(action.id);
      if ($('#bags').style.display === 'block') this.renderBags();
    }
  }

  private writeDraggedAction(dt: DataTransfer | null, action: Exclude<HotbarAction, null>): void {
    if (!dt) return;
    dt.setData(HOTBAR_ACTION_MIME, encodeHotbarAction(action));
    dt.setData('text/plain', action.id);
  }

  private readDraggedAction(dt: DataTransfer | null): Exclude<HotbarAction, null> | null {
    if (!dt) return null;
    const raw = dt.getData(HOTBAR_ACTION_MIME);
    if (!raw) return null;
    let parsed: unknown = null;
    try { parsed = JSON.parse(raw); } catch { return null; }
    return parseHotbarAction(parsed, (id) => this.sim.known.some((k) => k.def.id === id), (id) => this.isHotbarItemId(id));
  }

  private buildActionBar(): void {
    const bar = $('#actionbar');
    for (let i = 0; i < 12; i++) {
      const btn = document.createElement('button');
      btn.className = 'action-btn empty';
      const label = document.createElement('span');
      label.className = 'icon-label';
      const countEl = document.createElement('span');
      countEl.className = 'item-count';
      const kb = document.createElement('span');
      kb.className = 'keybind';
      kb.textContent = this.keybinds.primaryLabel(`slot${i}`); // rebindable; refreshKeybindLabels keeps it current
      const cdOverlay = document.createElement('div');
      cdOverlay.className = 'cd-overlay';
      const cdText = document.createElement('div');
      cdText.className = 'cdtext';
      btn.append(label, countEl, kb, cdOverlay, cdText);
      const slot = i;
      // slot 0 is Attack for every class (auto-attack toggle — players
      // without right-click need a way in); the kit fills slots 1+
      btn.addEventListener('click', () => {
        audio.click();
        this.castSlot(slot);
      });
      this.attachTooltip(btn, () => {
        if (slot === 0) {
          return '<div class="tt-title">Attack</div><div class="tt-sub">Toggle auto-attack on your target.<br>Right-clicking an enemy also attacks.</div>';
        }
        const known = this.abilityForSlot(slot);
        if (known) return this.abilityTooltip(known) + '<div class="tt-sub">Shift-right-click or Shift-Delete to clear</div>';
        const item = this.itemForSlot(slot);
        if (item) {
          const count = this.inventoryCount(item.id);
          return this.itemTooltip(item)
            + (count > 0 ? `<div class="tt-sub">In bags: ${count}</div>` : '<div class="tt-sub">None in bags</div>')
            + '<div class="tt-sub">Shift-right-click or Shift-Delete to clear</div>';
        }
        return '<div class="tt-sub">Empty slot<br>Shift-right-click or Shift-Delete to clear</div>';
      });
      if (slot >= 1) {
        // drag an action onto another slot to place or swap it;
        // slot 0 (Attack) stays fixed
        btn.draggable = true;
        const clearSlot = () => {
          this.hotbarActions = clearHotbarSlot(this.hotbarActions, slot - 1);
          this.saveSlotMap();
          btn.classList.add('empty');
          btn.classList.remove('drop-target', 'oor', 'queued', 'unusable');
          this.hideTooltip();
        };
        btn.addEventListener('contextmenu', (e) => {
          if (!e.shiftKey) return;
          e.preventDefault();
          clearSlot();
        });
        btn.addEventListener('keydown', (e) => {
          if (!e.shiftKey || (e.key !== 'Delete' && e.key !== 'Backspace')) return;
          e.preventDefault();
          e.stopPropagation();
          clearSlot();
        });
        btn.addEventListener('dragstart', (e) => {
          const action = this.actionForSlot(slot);
          if (!action) { e.preventDefault(); return; }
          this.dragAction = { action, sourceIndex: slot - 1 };
          this.writeDraggedAction(e.dataTransfer, action);
          e.dataTransfer!.effectAllowed = 'move';
          this.hideTooltip();
        });
        btn.addEventListener('dragover', (e) => {
          const dragged = this.dragAction?.action ?? this.readDraggedAction(e.dataTransfer);
          if (!dragged) return;
          if (this.dragAction?.sourceIndex === slot - 1) return;
          e.preventDefault(); // required to permit the drop
          e.dataTransfer!.dropEffect = this.dragAction?.sourceIndex === null && dragged.type === 'item' ? 'copy' : 'move';
          btn.classList.add('drop-target');
        });
        btn.addEventListener('dragleave', () => btn.classList.remove('drop-target'));
        btn.addEventListener('drop', (e) => {
          e.preventDefault();
          btn.classList.remove('drop-target');
          const dragged = this.dragAction ?? { action: this.readDraggedAction(e.dataTransfer), sourceIndex: null };
          this.dragAction = null;
          const action = dragged.action;
          if (!action) return;
          if (dragged.sourceIndex !== null) this.hotbarActions = swapHotbarSlots(this.hotbarActions, dragged.sourceIndex, slot - 1);
          else if (action.type === 'ability' && this.sim.known.some((k) => k.def.id === action.id)) {
            this.hotbarActions = placeAbilityOnSlot(this.hotbarActions, action.id, slot - 1);
          } else if (action.type === 'item' && this.isHotbarItemId(action.id)) {
            this.hotbarActions = placeItemOnSlot(this.hotbarActions, action.id, slot - 1);
          }
          this.saveSlotMap();
        });
        btn.addEventListener('dragend', () => {
          this.dragAction = null;
          this.clearActionDropTargets();
        });
        // right-click clears the slot so a full bar can make room for new spells
        btn.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          if (this.hotbarActions[slot - 1] === null) return;
          this.hotbarActions = clearHotbarSlot(this.hotbarActions, slot - 1);
          this.saveSlotMap();
          this.hideTooltip();
        });
      }
      bar.appendChild(btn);
      this.abilityButtons.push({ btn, label, countEl, keybindEl: kb, cdOverlay, cdText, lastIcon: '' });
    }
  }

  private clearActionDropTargets(): void {
    document.querySelectorAll('#actionbar .drop-target').forEach((el) => el.classList.remove('drop-target'));
  }

  // Repaint the keycap on every action button from the current bindings.
  private refreshKeybindLabels(): void {
    for (let i = 0; i < this.abilityButtons.length; i++) {
      this.abilityButtons[i].keybindEl.textContent = this.keybinds.primaryLabel(`slot${i}`);
    }
  }

  private buildXpTicks(): void {
    const ticks = $('#xpbar .ticks');
    for (let i = 0; i < 20; i++) ticks.appendChild(document.createElement('i'));
  }

  // -------------------------------------------------------------------------
  // Frame update
  // -------------------------------------------------------------------------

  update(): void {
    const sim = this.sim;
    const p = sim.player;
    this.meters.update();
    this.syncSlotMap(); // picks up newly learned abilities mid-session

    // talent buttons glow while the player has unspent points (and a tree exists)
    const tp = sim.talentPoints();
    const talGlow = talentsFor(sim.cfg.playerClass) !== null && tp.spent < tp.total;
    document.getElementById('mm-talents')?.classList.toggle('has-points', talGlow);
    document.getElementById('mobile-talents')?.classList.toggle('has-points', talGlow);

    // player frame
    $('#pf-level').textContent = String(p.level);
    ($('#pf-hp') as HTMLElement).style.transform = `scaleX(${p.hp / Math.max(1, p.maxHp)})`;
    $('#pf-hp-text').textContent = `${p.hp} / ${p.maxHp}`;
    const resFrac = p.resource / Math.max(1, p.maxResource);
    ($('#pf-res') as HTMLElement).style.transform = `scaleX(${resFrac})`;
    $('#pf-res-text').textContent = `${Math.round(p.resource)} / ${p.maxResource}`;
    $('#pf-resource').className = 'bar ' + (p.resourceType === 'rage' ? 'rage' : p.resourceType === 'energy' ? 'energy' : 'mana');

    // buff bar (player buffs + debuffs)
    this.renderAuras($('#buff-bar'), p, 'all');

    // target frame
    const target = p.targetId !== null ? sim.entities.get(p.targetId) : null;
    const tf = $('#target-frame');
    if (target && target.kind !== 'object') {
      tf.style.display = 'flex';
      tf.classList.toggle('elite', !!MOBS[target.templateId]?.elite);
      $('#tf-elite-tag').textContent = MOBS[target.templateId]?.boss ? 'BOSS' : 'ELITE';
      $('#tf-name').textContent = target.name;
      $('#tf-level').textContent = MOBS[target.templateId]?.boss ? '☠' : String(target.level);
      ($('#tf-hp') as HTMLElement).style.transform = `scaleX(${target.hp / Math.max(1, target.maxHp)})`;
      $('#tf-hp-text').textContent = target.dead ? 'Dead' : `${target.hp} / ${target.maxHp}`;
      ($('#tf-name') as HTMLElement).style.color = target.hostile ? 'var(--color-hostile)' : 'var(--color-friendly)';
      if (this.lastPortraitTarget !== target.id) {
        this.lastPortraitTarget = target.id;
        const crestId = target.kind === 'npc'
          ? 'status_npc'
          : `family_${MOBS[target.templateId]?.family ?? 'humanoid'}`;
        this.drawPortrait($('#tf-portrait') as unknown as HTMLCanvasElement, crestId);
      }
      this.renderAuras($('#tf-debuffs'), target, 'debuffs');
      // combo points
      const comboRow = $('#combo-row');
      if (p.resourceType === 'energy') {
        comboRow.style.display = 'flex';
        if (comboRow.children.length !== 5) {
          comboRow.innerHTML = '';
          for (let i = 0; i < 5; i++) {
            const pip = document.createElement('div');
            pip.className = 'combo-pip';
            comboRow.appendChild(pip);
          }
        }
        const points = p.comboTargetId === target.id ? p.comboPoints : 0;
        [...comboRow.children].forEach((pip, i) => pip.classList.toggle('on', i < points));
      } else {
        comboRow.style.display = 'none';
      }
    } else {
      tf.style.display = 'none';
      this.lastPortraitTarget = -999;
    }

    // cast bar
    const cb = $('#castbar');
    if (p.castingAbility) {
      cb.style.display = 'block';
      cb.classList.toggle('channel', p.channeling);
      const frac = p.channeling
        ? p.castRemaining / Math.max(0.01, p.castTotal)
        : 1 - p.castRemaining / Math.max(0.01, p.castTotal);
      (cb.querySelector('.fill') as HTMLElement).style.width = `${(frac * 100).toFixed(1)}%`;
      (cb.querySelector('.label') as HTMLElement).textContent = castDisplayName(p.castingAbility);
    } else if (p.eating || p.drinking) {
      cb.style.display = 'block';
      cb.classList.add('channel');
      const c = p.eating && p.drinking
        ? (p.eating.remaining >= p.drinking.remaining ? p.eating : p.drinking)
        : (p.eating ?? p.drinking)!;
      (cb.querySelector('.fill') as HTMLElement).style.width = `${((c.remaining / CONSUME_DURATION) * 100).toFixed(1)}%`;
      (cb.querySelector('.label') as HTMLElement).textContent =
        p.eating && p.drinking ? 'Eating & Drinking…' : p.eating ? 'Eating…' : 'Drinking…';
    } else {
      cb.style.display = 'none';
      cb.classList.remove('channel');
      (cb.querySelector('.fill') as HTMLElement).style.width = '0%';
      (cb.querySelector('.label') as HTMLElement).textContent = '';
    }

    // action bar
    const tgtDist = target && !target.dead ? dist2d(p.pos, target.pos) : null;
    const actionbar = $('#actionbar');
    actionbar.classList.toggle('many-spells', this.hotbarActions.filter((action) => action !== null).length > 10);
    for (let i = 0; i < this.abilityButtons.length; i++) {
      const ab = this.abilityButtons[i];
      if (i === 0) {
        // Attack button: glows while auto-attacking, red-edged out of range
        ab.btn.classList.remove('empty', 'unusable');
        if (ab.lastIcon !== '__attack') {
          ab.lastIcon = '__attack';
          ab.label.style.backgroundImage = `url(${iconDataUrl('ability', 'attack')})`;
        }
        ab.countEl.textContent = '';
        ab.cdOverlay.style.height = '0%';
        ab.cdText.textContent = '';
        ab.btn.classList.toggle('queued', !!p.autoAttack);
        ab.btn.classList.toggle('oor', tgtDist !== null && tgtDist > MELEE_RANGE);
        continue;
      }
      const action = this.actionForSlot(i);
      const known = this.abilityForSlot(i);
      const item = this.itemForSlot(i);
      if (!known && !item) {
        ab.btn.classList.add('empty');
        ab.btn.classList.remove('unusable', 'oor', 'queued');
        if (ab.lastIcon !== '') {
          ab.lastIcon = '';
          ab.label.style.backgroundImage = '';
        }
        ab.countEl.textContent = '';
        ab.cdOverlay.style.height = '0%';
        ab.cdText.textContent = '';
        continue;
      }
      ab.btn.classList.remove('empty');
      if (item && action?.type === 'item') {
        const iconKey = `item:${item.id}`;
        if (ab.lastIcon !== iconKey) {
          ab.lastIcon = iconKey;
          ab.label.style.backgroundImage = `url(${iconDataUrl('item', item.id)})`;
        }
        const count = this.inventoryCount(item.id);
        ab.countEl.textContent = String(count);
        ab.cdOverlay.style.height = '0%';
        ab.cdText.textContent = '';
        ab.btn.classList.toggle('unusable', count <= 0 || p.dead);
        ab.btn.classList.remove('oor', 'queued');
        continue;
      }
      const a = known!.def;
      // set the painted icon once per slot change, not every frame
      const iconKey = `ability:${a.id}`;
      if (ab.lastIcon !== iconKey) {
        ab.lastIcon = iconKey;
        ab.label.style.backgroundImage = `url(${iconDataUrl('ability', a.id)})`;
      }
      ab.countEl.textContent = '';
      const cd = p.cooldowns.get(a.id) ?? 0;
      const gcdActive = !a.offGcd && p.gcdRemaining > 0;
      const shown = Math.max(cd, gcdActive ? p.gcdRemaining : 0);
      const denom = cd > 0 ? a.cooldown : GCD;
      ab.cdOverlay.style.height = shown > 0 ? `${Math.min(100, (shown / Math.max(0.01, denom)) * 100)}%` : '0%';
      ab.cdText.textContent = cd > 1 ? Math.ceil(cd).toString() : '';
      ab.btn.classList.toggle('unusable', p.resource < known!.cost);
      const oor = a.requiresTarget && tgtDist !== null && tgtDist > (a.range > 0 ? a.range : MELEE_RANGE);
      ab.btn.classList.toggle('oor', !!oor);
      ab.btn.classList.toggle('queued', p.queuedOnSwing === a.id);
    }

    // xp bar — pre-cap shows the level bar; post-cap fills toward the next
    // virtual level (Max-Level XP Overflow), with distinct prestige/gold styling.
    const showOverflow = (this.optionsHooks?.settings.get('showOverflowXp') ?? 1) >= 0.5;
    const bar = xpBarView({ level: p.level, xp: sim.xp, lifetimeXp: sim.lifetimeXp, showOverflow });
    ($('#xpbar .fill') as HTMLElement).style.width = `${(bar.fillFrac * 100).toFixed(1)}%`;
    $('#xpbar .label').textContent = bar.label;
    $('#xpbar').classList.toggle('overflow', bar.postCap);

    $('#death-overlay').style.display = p.dead ? 'flex' : 'none';

    // zone transitions: banner + welcome hint when crossing into a new band.
    // A ~5yd dead-band past the boundary stops a player straddling the border
    // from re-triggering the banner/log (and the map canvas regen) every step.
    const inDungeon = p.pos.x > DUNGEON_X_THRESHOLD;
    const currentZone = zoneAt(p.pos.z);
    if (!inDungeon && currentZone.id !== this.lastZoneId) {
      const lastZone = ZONES.find((z) => z.id === this.lastZoneId);
      const pastDeadBand = !lastZone
        || p.pos.z < lastZone.zMin - ZONE_BANNER_DEADBAND
        || p.pos.z >= lastZone.zMax + ZONE_BANNER_DEADBAND;
      if (pastDeadBand) {
        if (this.lastZoneId !== '') {
          this.showBanner(currentZone.name);
          this.log(`Entering ${currentZone.name}.`, '#ffd100');
          this.logZoneWelcome(currentZone);
        }
        this.lastZoneId = currentZone.id;
      }
    }

    // soundtrack: pick the zone theme and layer in combat percussion.
    // Combat = a mob is on us, or we traded blows in the last few seconds
    // (the wire protocol doesn't ship the inCombat flag).
    let aggroed = false;
    for (const e of sim.entities.values()) {
      if (e.kind === 'mob' && !e.dead && e.aggroTargetId === sim.playerId) { aggroed = true; break; }
    }
    const inCombat = aggroed || performance.now() - this.lastCombatEventAt < 5000;
    const hub = currentZone.hub;
    const zone = inDungeon ? 'dungeon'
      : Math.hypot(p.pos.x - hub.x, p.pos.z - hub.z) < hub.radius + 10 ? 'town' : currentZone.biome;
    music.update(zone, inCombat);

    this.updateQuestTracker();
    this.updatePartyFrames();
    this.updateTradeWindow();
    this.updateArenaStatus();
    // when a bout begins, get the queue panel out of the way for the fight
    const inArenaMatch = !!this.sim.arenaInfo?.match;
    if (inArenaMatch && !this.arenaMatchSeen && $('#arena-window').style.display === 'block') {
      $('#arena-window').style.display = 'none';
    }
    this.arenaMatchSeen = inArenaMatch;
    this.updateMinimap();
    if ($('#map-window').style.display === 'block') this.updateMapWindow();
    if ($('#social-window').classList.contains('open')) {
      const struct = this.socialStructSig();
      if (struct !== this.lastSocialStruct) {
        this.lastSocialStruct = struct;
        this.lastSocialContent = JSON.stringify(this.sim.socialInfo);
        this.renderSocial();
      } else {
        const content = JSON.stringify(this.sim.socialInfo);
        if (content !== this.lastSocialContent) { this.lastSocialContent = content; this.refreshSocialList(); }
      }
    }
    if ($('#arena-window').style.display === 'block') this.renderArenaWindow();
    if (this.openLootMobId !== null) {
      const mob = sim.entities.get(this.openLootMobId);
      if (!mob || !mob.lootable || dist2d(p.pos, mob.pos) > 7) this.closeLoot();
    }
    if (this.openVendorNpcId !== null) {
      const npc = sim.entities.get(this.openVendorNpcId);
      if (!npc || dist2d(p.pos, npc.pos) > 8) this.closeVendor();
    }
    if (this.marketOpen) {
      if (!this.nearbyMarketNpc()) this.closeMarket();
      else this.refreshMarket();
    }
  }

  private renderAuras(el: HTMLElement, e: Entity, mode: 'all' | 'debuffs'): void {
    // cheap diff: rebuild only when the aura set changes
    const sig = e.auras.map((a) => a.id + Math.ceil(a.remaining)).join('|');
    if ((el as any).__sig === sig) return;
    (el as any).__sig = sig;
    el.innerHTML = '';
    for (const a of e.auras) {
      const isDebuff = ['dot', 'slow', 'root', 'stun', 'incapacitate', 'polymorph', 'attackspeed'].includes(a.kind);
      if (mode === 'debuffs' && !isDebuff) continue;
      const d = document.createElement('div');
      d.className = 'buff' + (isDebuff ? ' debuff' : '');
      d.style.backgroundImage = `url(${iconDataUrl('aura', ABILITIES[a.id] ? a.id : `aura_${a.kind}`)})`;
      const dur = document.createElement('div');
      dur.className = 'dur';
      dur.textContent = a.remaining < 99 ? `${Math.ceil(a.remaining)}s` : '';
      d.appendChild(dur);
      this.attachTooltip(d, () => `<div class="tt-title">${a.name}</div><div class="tt-sub">${Math.ceil(a.remaining)} seconds remaining</div>`);
      el.appendChild(d);
    }
  }

  private updateQuestTracker(): void {
    const el = $('#quest-tracker');
    let html = this.sim.questLog.size > 0 ? '<div class="qt-header">Quests</div>' : '';
    for (const qp of this.sim.questLog.values()) {
      const quest = QUESTS[qp.questId];
      html += `<div class="qt-title">${quest.name}${qp.state === 'ready' ? ' <span style="color:#7fdc4f">(Complete)</span>' : ''}</div>`;
      quest.objectives.forEach((obj, i) => {
        const done = qp.counts[i] >= obj.count;
        html += `<div class="qt-obj${done ? ' done' : ''}">- ${obj.label}: ${qp.counts[i]}/${obj.count}</div>`;
      });
    }
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  // -------------------------------------------------------------------------
  // Minimap & world map
  // -------------------------------------------------------------------------

  // Render a region of the heightfield to a canvas; width W px, height
  // derived from the region's aspect so a yard is square on screen.
  private renderTerrainCanvas(W: number, region: { minX: number; maxX: number; minZ: number; maxZ: number }): HTMLCanvasElement {
    const spanX = region.maxX - region.minX;
    const spanZ = region.maxZ - region.minZ;
    const H = Math.round(W * spanZ / spanX);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(W, H);
    const seed = this.sim.cfg.seed;
    let prevH = 0; // height of the left-neighbour pixel, for free hillshade
    for (let iy = 0; iy < H; iy++) {
      for (let ix = 0; ix < W; ix++) {
        // +Z up, +X LEFT: facing 0 is +Z ("north") and turning right
        // decreases facing, so the world's east is -X — drawing +X to the
        // right mirrored the whole map east-west
        const x = region.maxX - (ix / W) * spanX;
        const z = region.maxZ - (iy / H) * spanZ;
        const h = terrainHeight(x, z, seed);
        const biome = zoneAt(z).biome;
        let r = 58, g = 105, b = 48;
        if (biome === 'marsh') { r = 64; g = 86; b = 48; }
        else if (biome === 'peaks') { r = 92; g = 100; b = 82; }
        if (h < WATER_LEVEL) { r = 38; g = 84; b = 138; }
        else if (h > 26) { r = 168; g = 172; b = 178; } // ridge / peak rock+snow
        else if (h > 11) { r = 112; g = 110; b = 102; }
        else if (h > 6) { r = 88; g = 102; b = 62; }
        let nearHub = false;
        for (const zn of ZONES) {
          if (Math.hypot(x - zn.hub.x, z - zn.hub.z) < 14) { nearHub = true; break; }
        }
        if (nearHub) { r = 125; g = 100; b = 66; }
        else if (h >= WATER_LEVEL && roadDistance(x, z) < 2.4) { r = 138; g = 111; b = 71; }
        // hillshade: relief from the west→east slope, reusing the already-computed
        // left-neighbour height so it costs no extra terrainHeight() calls
        const left = ix === 0 ? h : prevH;
        prevH = h;
        if (h >= WATER_LEVEL) {
          const shade = Math.max(0.74, Math.min(1.28, 1 + (h - left) * 0.16));
          r = Math.min(255, r * shade); g = Math.min(255, g * shade); b = Math.min(255, b * shade);
        }
        const k = (iy * W + ix) * 4;
        img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  private updateMinimap(): void {
    const ctx = this.minimapCtx;
    const S = 162;
    const p = this.sim.player;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    const pxPerYard = 1.7;
    const bg = this.minimapBg;
    const bgPxPerYard = bg.width / (WORLD_MAX_X - WORLD_MIN_X);
    const sw = S / (pxPerYard / bgPxPerYard);
    const sx = (WORLD_MAX_X - p.pos.x) * bgPxPerYard - sw / 2; // bg is +X-left
    const sy = (WORLD_MAX_Z - p.pos.z) * bgPxPerYard - sw / 2;
    ctx.drawImage(bg, sx, sy, sw, sw, 0, 0, S, S);

    // friend/guild lookup for colouring nearby allies (party markers are drawn
    // separately below, so skip party members here to avoid double dots)
    const social = this.sim.socialInfo;
    const friendNames = social ? new Set(social.friends.filter((f) => f.online).map((f) => f.name)) : null;
    const guildNames = social?.guild ? new Set(social.guild.members.map((m) => m.name)) : null;
    const partyPids = this.sim.partyInfo ? new Set(this.sim.partyInfo.members.map((m) => m.pid)) : null;

    for (const e of this.sim.entities.values()) {
      if (e.id === p.id) continue;
      const dx = -(e.pos.x - p.pos.x) * pxPerYard; // +X is map-left
      const dz = -(e.pos.z - p.pos.z) * pxPerYard;
      const mx = S / 2 + dx, my = S / 2 + dz;
      if ((mx - S / 2) ** 2 + (my - S / 2) ** 2 > (S / 2 - 7) ** 2) continue;
      if (e.kind === 'player' && !(partyPids && partyPids.has(e.id))) {
        const isFriend = friendNames?.has(e.name) ?? false;
        const isGuild = !isFriend && (guildNames?.has(e.name) ?? false);
        if (isFriend || isGuild) {
          ctx.fillStyle = isFriend ? '#4ade80' : '#60a5fa';
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(mx, my, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      } else if (e.kind === 'npc') {
        const hasAvail = e.questIds.some((q) => QUESTS[q].giverNpcId === e.templateId && this.sim.questState(q) === 'available');
        const hasReady = e.questIds.some((q) => QUESTS[q].turnInNpcId === e.templateId && this.sim.questState(q) === 'ready');
        ctx.fillStyle = '#ffd100';
        ctx.font = 'bold 11px Georgia';
        ctx.fillText(hasReady ? '?' : hasAvail ? '!' : '•', mx - 2, my + 3);
      } else if (e.kind === 'object' && (e.templateId === 'dungeon_door' || e.templateId === 'dungeon_exit')) {
        ctx.fillStyle = '#c084ff';
        ctx.beginPath();
        ctx.arc(mx, my, 3.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (e.kind === 'object' && e.lootable) {
        ctx.fillStyle = '#ffe97a';
        ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
      } else if (e.kind === 'mob' && !e.dead) {
        ctx.fillStyle = e.aggroTargetId === p.id ? '#ff8800' : '#e74c3c';
        ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
      } else if (e.kind === 'mob' && e.lootable) {
        ctx.fillStyle = '#ffd100';
        ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
      }
    }
    // Party members: class-colored markers. On-map allies are discs that
    // scale up the closer they are (proximity scaling); allies past the rim
    // are pinned to the edge as arrows pointing the way to regroup.
    const party = this.sim.partyInfo;
    if (party) {
      const R = S / 2 - 7;
      for (const m of party.members) {
        if (m.pid === p.id) continue;
        const dx = -(m.x - p.pos.x) * pxPerYard; // +X is map-left
        const dz = -(m.z - p.pos.z) * pxPerYard;
        const dist = Math.hypot(dx, dz);
        const offMap = dist > R;
        const ang = Math.atan2(dz, dx);
        const color = m.dead ? '#9a9a9a' : classCss(m.cls);
        ctx.save();
        if (offMap) {
          // edge-anchored arrow pointing outward toward the off-screen ally
          ctx.translate(S / 2 + Math.cos(ang) * R, S / 2 + Math.sin(ang) * R);
          ctx.rotate(ang);
          ctx.fillStyle = color;
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(6, 0); ctx.lineTo(-4, 4.5); ctx.lineTo(-4, -4.5);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else {
          // proximity scaling: ~6px adjacent down to ~3px near the rim
          const r = 6 - (dist / R) * 3;
          ctx.translate(S / 2 + dx, S / 2 + dz);
          ctx.fillStyle = color;
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          if (!m.dead) { // bright inner pip so members pop against terrain
            ctx.fillStyle = '#ffffffcc';
            ctx.beginPath();
            ctx.arc(0, 0, Math.max(1, r * 0.35), 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }
    }
    ctx.translate(S / 2, S / 2);
    ctx.rotate(-p.facing); // canvas rotates clockwise; facing increases turning left
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(4.5, 5.5); ctx.lineTo(-4.5, 5.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  toggleMeters(): void {
    this.meters.toggle();
  }

  // -------------------------------------------------------------------------
  // The Ashen Coliseum — 1v1 arena panel + in-match banner
  // -------------------------------------------------------------------------

  toggleArena(): void {
    const el = $('#arena-window');
    if (el.style.display === 'block') { el.style.display = 'none'; return; }
    this.closeOtherWindows('#arena-window');
    el.style.display = 'block';
    this.lastArenaSig = '';
    this.fetchArenaLeaderboard();
    this.renderArenaWindow();
  }

  // Best-effort all-time ladder pull. Throttled; silently no-ops offline (no
  // server) so the panel still shows the live online ladder either way.
  private fetchArenaLeaderboard(): void {
    const now = performance.now();
    if (now - this.arenaLbFetchedAt < 15000) return;
    this.arenaLbFetchedAt = now;
    fetch('/api/arena/leaderboard')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.leaders)) { this.arenaAllTime = d.leaders; this.lastArenaSig = ''; }
      })
      .catch(() => { /* offline or no server — live ladder only */ });
  }

  private renderArenaWindow(): void {
    const el = $('#arena-window');
    const a = this.sim.arenaInfo;
    if (!a) {
      // offline / not yet synced: arena is an online ranked feature
      el.innerHTML = `<div class="panel-title"><span>The Ashen Coliseum</span><span class="x-btn" data-close>${svgIcon('close')}</span></div>`
        + `<div class="arena-note">The Ashen Coliseum is a ranked 1v1 arena for the live world. Play online to enter the queue and climb the ladder.</div>`;
      el.querySelector('[data-close]')?.addEventListener('click', () => { el.style.display = 'none'; });
      return;
    }
    const inMatch = a.match !== null;
    const myPid = this.sim.playerId;
    const ladder = a.ladder.map((r, i) => {
      const me = r.pid === myPid;
      const cls = CLASSES[r.cls]?.name ?? r.cls;
      return `<div class="ladder-row${me ? ' me' : ''}"><span class="rank">${i + 1}</span>`
        + `<span class="lr-name" title="${esc(r.name)} — ${esc(cls)}">${esc(r.name)}</span>`
        + `<span class="lr-rating">${r.rating}</span>`
        + `<span class="lr-wl">${r.wins}-${r.losses}</span></div>`;
    }).join('') || `<div class="ladder-empty">No challengers ranked yet — be the first.</div>`;

    let action: string;
    if (inMatch) {
      action = `<div class="arena-queue-status">${svgIcon('arena')} Match in progress vs ${esc(a.match!.oppName)}.</div>`;
    } else if (a.queued) {
      action = `<button class="btn leave" data-act="leave">Leave Queue</button>`
        + `<div class="arena-queue-status">Searching for an opponent… (${a.queueSize} in queue)</div>`;
    } else {
      action = `<button class="btn" data-act="queue">Enter the Queue</button>`
        + `<div class="arena-note">You will be matched with the nearest-rated challenger online, then teleported to the sands. Win to climb; first to yield (1 health) loses. You return exactly where you queued.</div>`;
    }

    this.fetchArenaLeaderboard();
    const allTime = (this.arenaAllTime ?? []).map((r, i) => {
      const me = r.name === this.sim.player.name;
      const cls = CLASSES[r.class as keyof typeof CLASSES]?.name ?? r.class;
      return `<div class="ladder-row${me ? ' me' : ''}"><span class="rank">${i + 1}</span>`
        + `<span class="lr-name" title="${esc(r.name)} — Lv ${r.level} ${esc(cls)}">${esc(r.name)}</span>`
        + `<span class="lr-rating">${r.rating}</span>`
        + `<span class="lr-wl">${r.wins}-${r.losses}</span></div>`;
    }).join('');
    const allTimeSection = this.arenaAllTime && this.arenaAllTime.length > 0
      ? `<div class="arena-sub">Ladder — All-Time</div>${allTime}`
      : '';

    const sig = JSON.stringify([a.rating, a.wins, a.losses, a.queued, a.queueSize, inMatch, a.ladder, this.arenaAllTime]);
    if (sig === this.lastArenaSig) return; // nothing changed; skip the DOM churn (and re-bind)
    this.lastArenaSig = sig;

    el.innerHTML = `<div class="panel-title"><span>The Ashen Coliseum <span style="color:#998d6a;font-size:11px">1v1 Ranked</span></span><span class="x-btn" data-close>${svgIcon('close')}</span></div>`
      + `<div class="arena-rank"><span class="rating">${a.rating}</span>`
      + `<span class="wl">Rating &middot; <b>${a.wins}</b> wins / <i>${a.losses}</i> losses</span></div>`
      + action
      + `<div class="arena-sub">Ladder — Online</div>`
      + ladder
      + allTimeSection;

    el.querySelector('[data-close]')?.addEventListener('click', () => { el.style.display = 'none'; });
    el.querySelector('[data-act="queue"]')?.addEventListener('click', () => { this.sim.arenaQueueJoin(); audio.click(); });
    el.querySelector('[data-act="leave"]')?.addEventListener('click', () => { this.sim.arenaQueueLeave(); audio.click(); });
  }

  // The pinned in-match banner: opponent name + countdown / live match timer.
  private updateArenaStatus(): void {
    const el = $('#arena-status');
    const a = this.sim.arenaInfo;
    const m = a?.match ?? null;
    if (!m) {
      if (el.style.display !== 'none') el.style.display = 'none';
      this.lastArenaStatusSig = '';
      return;
    }
    const label = m.state === 'countdown' ? 'Steel yourself…'
      : m.state === 'over' ? `Returning to the world… ${m.returnIn ?? 0}`
      : 'Fight to the yield!';
    const sig = `${m.oppName}|${m.state}|${m.state === 'over' ? (m.returnIn ?? 0) : ''}`;
    if (sig !== this.lastArenaStatusSig) {
      this.lastArenaStatusSig = sig;
      const cls = CLASSES[m.oppClass]?.name ?? m.oppClass;
      el.innerHTML = `<div class="as-vs">${svgIcon('arena')} VS <span class="opp">${esc(m.oppName)}</span> <span style="color:#b6ad8c;font-size:11px">Lv ${m.oppLevel} ${esc(cls)}</span></div>`
        + `<div class="as-timer">${label}</div>`;
      el.style.display = 'block';
    }
  }

  toggleMap(): void {
    const el = $('#map-window');
    if (el.style.display === 'block') { el.style.display = 'none'; return; }
    this.closeOtherWindows('#map-window');
    this.mapZoom = 1; // always open at the full-zone view, following the player
    this.mapCenter = null;
    el.style.display = 'block';
    this.updateMapWindow();
  }

  // scroll-wheel / button zoom for the world map (clamped to [1, MAP_MAX_ZOOM])
  private zoomMap(factor: number): void {
    const prev = this.mapZoom;
    this.mapZoom = Math.max(1, Math.min(MAP_MAX_ZOOM, this.mapZoom * factor));
    // zooming back to 1 resumes following the player; a fresh zoom-in from the
    // follow view anchors the pan at the player so dragging starts from there
    if (this.mapZoom === 1) this.mapCenter = null;
    else if (prev === 1 && !this.mapCenter) this.mapCenter = { x: this.sim.player.pos.x, z: this.sim.player.pos.z };
    if ($('#map-window').style.display === 'block') this.updateMapWindow();
  }

  // The map window shows the zone band the player is standing in (each band
  // is a square); POIs and dungeon portals come from the zone/dungeon data.
  private updateMapWindow(): void {
    const canvas = $('#map-canvas') as unknown as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const S = canvas.width;
    const p = this.sim.player;
    // inside an instance, show the zone the dungeon's door is in (dungeonAt
    // owns the instance x-band layout); outdoors, follow the committed zone
    // so border-straddling can't thrash the 280px canvas regen below
    const dungeon = dungeonAt(p.pos.x);
    const zone: ZoneDef = dungeon
      ? zoneAt(dungeon.doorPos.z)
      : ZONES.find((z) => z.id === this.lastZoneId) ?? zoneAt(p.pos.z);
    const full = { minX: WORLD_MIN_X, maxX: WORLD_MAX_X, minZ: zone.zMin, maxZ: zone.zMax };
    if (!this.mapBg || this.mapZoneId !== zone.id) {
      this.mapBg = this.renderTerrainCanvas(MAP_BG_RES, full); // whole zone, cached & detailed
      this.mapZoneId = zone.id;
    }
    // zoomed view: a sub-rectangle of the zone, centred on the player and
    // clamped to the zone bounds (zoom 1 = the whole zone).
    const fullSpanX = full.maxX - full.minX;
    const fullSpanZ = full.maxZ - full.minZ;
    const spanX = fullSpanX / this.mapZoom;
    const spanZ = fullSpanZ / this.mapZoom;
    // centre on the pan target if the user dragged, else follow the player
    const baseX = this.mapCenter ? this.mapCenter.x : p.pos.x;
    const baseZ = this.mapCenter ? this.mapCenter.z : p.pos.z;
    const cx = Math.max(full.minX + spanX / 2, Math.min(full.maxX - spanX / 2, baseX));
    const cz = Math.max(full.minZ + spanZ / 2, Math.min(full.maxZ - spanZ / 2, baseZ));
    const region = { minX: cx - spanX / 2, maxX: cx + spanX / 2, minZ: cz - spanZ / 2, maxZ: cz + spanZ / 2 };
    this.mapView = { spanX, spanZ, minX: full.minX, maxX: full.maxX, minZ: full.minZ, maxZ: full.maxZ };
    if (!this.mapDrag) canvas.style.cursor = this.mapZoom > 1 ? 'grab' : 'default';
    // blit the matching sub-rect of the cached terrain (note: +X is map-left)
    const bg = this.mapBg;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      bg,
      ((full.maxX - region.maxX) / fullSpanX) * bg.width,
      ((full.maxZ - region.maxZ) / fullSpanZ) * bg.height,
      (spanX / fullSpanX) * bg.width,
      (spanZ / fullSpanZ) * bg.height,
      0, 0, S, S,
    );
    const toMap = (x: number, z: number) => ({
      mx: ((region.maxX - x) / spanX) * S, // +X is map-left (east = -X)
      my: ((region.maxZ - z) / spanZ) * S,
    });
    // zoomed in far enough → overlay buildings + vegetation (under the labels)
    if (this.mapZoom >= MAP_DETAIL_ZOOM) this.drawMapDetail(ctx, region, toMap);
    // zone title
    ctx.font = 'bold 16px Georgia';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.fillStyle = '#ffe9a0';
    ctx.strokeText(zone.name, S / 2, 20);
    ctx.fillText(zone.name, S / 2, 20);
    // labels
    ctx.font = 'bold 13px Georgia';
    const label = (x: number, z: number, text: string) => {
      const { mx, my } = toMap(x, z);
      ctx.strokeText(text, mx, my);
      ctx.fillText(text, mx, my);
    };
    for (const poi of zone.pois) label(poi.x, poi.z, poi.label);
    // dungeon entrance portals in this zone
    for (const dungeon of DUNGEON_LIST) {
      if (dungeon.doorPos.z < zone.zMin || dungeon.doorPos.z >= zone.zMax) continue;
      const { mx, my } = toMap(dungeon.doorPos.x, dungeon.doorPos.z);
      ctx.fillStyle = '#c084ff';
      ctx.beginPath();
      ctx.arc(mx, my, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e0c0ff';
      ctx.font = 'bold 12px Georgia';
      ctx.strokeText(dungeon.name, mx, my - 9);
      ctx.fillText(dungeon.name, mx, my - 9);
      ctx.font = 'bold 13px Georgia';
      ctx.fillStyle = '#ffe9a0';
    }
    // npcs
    for (const e of this.sim.entities.values()) {
      if (e.kind !== 'npc') continue;
      if (e.pos.z < zone.zMin || e.pos.z >= zone.zMax) continue;
      const { mx, my } = toMap(e.pos.x, e.pos.z);
      const hasAvail = e.questIds.some((q) => QUESTS[q].giverNpcId === e.templateId && this.sim.questState(q) === 'available');
      const hasReady = e.questIds.some((q) => QUESTS[q].turnInNpcId === e.templateId && this.sim.questState(q) === 'ready');
      if (hasAvail || hasReady) {
        ctx.fillStyle = '#ffd100';
        ctx.font = 'bold 15px Georgia';
        ctx.strokeText(hasReady ? '?' : '!', mx, my);
        ctx.fillText(hasReady ? '?' : '!', mx, my);
      }
    }
    // player
    if (p.pos.z >= zone.zMin && p.pos.z < zone.zMax && p.pos.x <= WORLD_MAX_X) {
      const { mx, my } = toMap(p.pos.x, p.pos.z);
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(-p.facing); // matches the flipped map (see toMap)
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(-5, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    // friends (green) and guild members (blue), plotted anywhere in this zone
    // from the live positions the server streams for online allies. socialInfo
    // is null offline, so this is online-only.
    const social = this.sim.socialInfo;
    if (social) {
      ctx.lineWidth = 3;
      ctx.font = 'bold 11px Georgia';
      ctx.textAlign = 'center';
      const selfName = p.name;
      const drawn = new Set<number>();
      const plotAlly = (m: FriendInfo, color: string) => {
        if (!m.online || m.x === undefined || m.z === undefined || m.name === selfName || drawn.has(m.id)) return;
        if (m.z < zone.zMin || m.z >= zone.zMax || m.x > WORLD_MAX_X) return;
        drawn.add(m.id);
        const { mx, my } = toMap(m.x, m.z);
        ctx.fillStyle = color;
        ctx.strokeStyle = '#000';
        ctx.beginPath();
        ctx.arc(mx, my, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.strokeText(m.name, mx, my - 8);
        ctx.fillText(m.name, mx, my - 8);
      };
      for (const f of social.friends) plotAlly(f, '#4ade80'); // friends green (win ties)
      if (social.guild) for (const m of social.guild.members) plotAlly(m, '#60a5fa');
    }
  }

  // Buildings + vegetation overlay for the zoomed-in map, drawn from the same
  // shared world data the renderer uses (PROPS + generateDecorations), so it
  // matches the actual world. Only invoked at/above MAP_DETAIL_ZOOM.
  private drawMapDetail(
    ctx: CanvasRenderingContext2D,
    region: { minX: number; maxX: number; minZ: number; maxZ: number },
    toMap: (x: number, z: number) => { mx: number; my: number },
  ): void {
    const inView = (x: number, z: number) =>
      x >= region.minX - 6 && x <= region.maxX + 6 && z >= region.minZ - 6 && z <= region.maxZ + 6;
    // px per world unit (use the X axis; footprints stay roughly to scale)
    const ppu = ((toMap(region.minX + 1, region.minZ).mx - toMap(region.minX, region.minZ).mx) ** 2) ** 0.5;

    // vegetation: pine/oak/rock scattered across the world (cached once)
    if (!this.mapDecorations) this.mapDecorations = generateDecorations(this.sim.cfg.seed);
    for (const d of this.mapDecorations) {
      if (!inView(d.x, d.z)) continue;
      const { mx, my } = toMap(d.x, d.z);
      if (d.kind === 'rock') {
        ctx.fillStyle = '#8c8b86';
        ctx.beginPath(); ctx.arc(mx, my, Math.max(1.2, ppu * 0.5), 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = d.kind === 'tree' ? '#2f6b34' : '#4f8c3a'; // pine darker, oak lighter
        const r = Math.max(1.6, ppu * 0.8);
        ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();
      }
    }

    // buildings: rotated footprints (house/inn brown, chapel stone)
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#1a140a';
    for (const b of PROPS.buildings) {
      if (!inView(b.x, b.z)) continue;
      const c = Math.cos(b.rot), s = Math.sin(b.rot);
      const corner = (dx: number, dz: number) => toMap(b.x + dx * c - dz * s, b.z + dx * s + dz * c);
      const p0 = corner(-b.w / 2, -b.d / 2), p1 = corner(b.w / 2, -b.d / 2);
      const p2 = corner(b.w / 2, b.d / 2), p3 = corner(-b.w / 2, b.d / 2);
      ctx.fillStyle = b.kind === 'chapel' ? '#9b9080' : b.kind === 'inn' ? '#8a6233' : '#7a5630';
      ctx.beginPath();
      ctx.moveTo(p0.mx, p0.my); ctx.lineTo(p1.mx, p1.my); ctx.lineTo(p2.mx, p2.my); ctx.lineTo(p3.mx, p3.my);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }

    // smaller props as dots
    const dot = (x: number, z: number, color: string, r = Math.max(1.8, ppu * 0.7)) => {
      if (!inView(x, z)) return;
      const { mx, my } = toMap(x, z);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();
    };
    for (const w of PROPS.wells) dot(w.x, w.z, '#5a7fa8');
    for (const st of PROPS.stalls) dot(st.x, st.z, '#b07a3a');
    for (const tn of PROPS.tents) dot(tn.x, tn.z, '#9a8a5a');
    for (const m of PROPS.mines) dot(m.x, m.z, '#6a5a4a');
    for (const g of PROPS.graveyards) dot(g.x, g.z, '#8a929c');
    for (const [x, z] of PROPS.mudHuts) dot(x, z, '#7a6a4a');
    for (const [x, z] of PROPS.campfires) dot(x, z, '#ff9a3c', Math.max(1.4, ppu * 0.5));
  }

  // -------------------------------------------------------------------------
  // Events -> log, FCT, audio, banners
  // -------------------------------------------------------------------------

  handleEvents(events: SimEvent[]): void {
    const sim = this.sim;
    for (const ev of events) {
      // visual effects (swings, projectiles, glows) — for everyone nearby,
      // not just events involving this player
      this.renderer.handleEvent(ev);
      this.meters.onEvent(ev);
      switch (ev.type) {
        case 'damage': {
          const src = sim.entities.get(ev.sourceId);
          const tgt = sim.entities.get(ev.targetId);
          if (!tgt) break;
          const isPlayerSource = ev.sourceId === sim.playerId;
          const isPlayerTarget = ev.targetId === sim.playerId;
          if (isPlayerSource || isPlayerTarget) this.lastCombatEventAt = performance.now();
          if (ev.kind === 'miss' || ev.kind === 'dodge') {
            this.fct(tgt, ev.kind === 'miss' ? 'Miss' : 'Dodge', isPlayerTarget ? '#bbb' : '#fff', false);
            if (isPlayerSource) {
              this.combatLog(`Your ${ev.ability ?? 'attack'} ${ev.kind === 'miss' ? 'misses' : 'is dodged by'} ${tgt.name}.`, '#ccc');
              audio.meleeMiss();
            }
            break;
          }
          if (isPlayerSource && !isPlayerTarget) {
            const color = ev.ability ? '#ffe97a' : '#fff';
            this.fct(tgt, `${ev.amount}${ev.crit ? '!' : ''}`, color, ev.crit);
            this.combatLog(`Your ${ev.ability ?? 'attack'} hits ${tgt.name} for ${ev.amount}${ev.crit ? ' (Critical)' : ''}.`, ev.ability ? '#ffe97a' : '#eee');
            if (ev.school === 'fire') audio.fire();
            else if (ev.school === 'frost') audio.frost();
            else if (ev.school === 'arcane') audio.arcane();
            else audio.meleeHit(ev.crit);
          } else if (isPlayerTarget) {
            this.fct(tgt, `-${ev.amount}`, '#ff5544', ev.crit);
            this.combatLog(`${src?.name ?? 'Something'} hits you for ${ev.amount}${ev.crit ? ' (Critical)' : ''}.`, '#ff8877');
            audio.hitTaken();
          }
          break;
        }
        case 'heal': {
          if (ev.targetId === sim.playerId && ev.amount > 0) {
            this.fct(sim.player, `+${ev.amount}`, '#3ce63c', false);
          }
          break;
        }
        case 'death': {
          const e = sim.entities.get(ev.entityId);
          if (e && ev.entityId !== sim.playerId) this.combatLog(`${e.name} dies.`, '#aaa');
          break;
        }
        case 'xp': {
          this.fct(sim.player, `+${ev.amount} XP`, '#b974ff', false);
          this.log(`You gain ${ev.amount} experience.`, '#a980d8');
          break;
        }
        case 'levelup': {
          this.showBanner(`Level ${ev.level}!`);
          this.log(`You have reached level ${ev.level}!`, '#ffd100');
          audio.levelUp();
          // First talent point (and spec) unlock — nudge the player to the panel.
          if (ev.level === FIRST_TALENT_LEVEL && talentsFor(this.sim.cfg.playerClass)) {
            this.showBanner(t('game.talents.unlockBanner'));
            this.log(t('game.talents.unlockHint'), '#ffd100');
          }
          break;
        }
        case 'virtualLevelUp': {
          // cosmetic post-cap "level up" — reuses the levelup banner + sound
          this.showBanner(`${t('game.progression.virtualLevelUp')} ${ev.level}!`);
          this.log(`${t('game.progression.virtualLevelUp')} ${ev.level}!`, '#ffd100');
          audio.levelUp();
          break;
        }
        case 'milestoneUnlocked': {
          const name = this.milestoneName(ev.milestoneId);
          this.showBanner(`${t('game.milestone.unlocked')}: ${name}`);
          this.log(`${t('game.milestone.unlocked')}: ${name}`, '#ffd100');
          audio.levelUp();
          break;
        }
        case 'learnAbility': break; // logged by sim
        case 'comboPoint': break;
        case 'loot': {
          this.log(ev.text, '#7fdc4f');
          if (ev.text.includes('loot') || ev.text.includes('Sold') || ev.text.includes('Bought back')) audio.coin();
          else audio.lootItem();
          if ($('#bags').style.display === 'block') this.renderBags();
          break;
        }
        case 'vendor': {
          if ($('#bags').style.display === 'block') this.renderBags();
          if (this.openVendorNpcId !== null) this.renderVendor();
          break;
        }
        case 'error': this.showError(ev.text); break;
        case 'questAccepted':
          audio.questAccept();
          this.refreshGossip();
          break;
        case 'questProgress': this.log(ev.text, '#dcd29f'); break;
        case 'questReady': {
          const q = QUESTS[ev.questId];
          this.showBanner(`${q.name} (Complete)`);
          audio.questDone();
          break;
        }
        case 'questDone':
          audio.questDone();
          this.refreshGossip();
          break;
        case 'chat': {
          if (this.isChatIgnored(ev.from)) break;
          switch (ev.channel) {
            case 'party': this.chatLogFrom(ev.from, ev.text, '#7fd4ff', '[Party] ', ': '); break;
            case 'yell': this.chatLogFrom(ev.from, ev.text, '#ff5040', '', ' yells: '); break;
            case 'whisper':
              if (ev.to) this.chatLogFrom(ev.to, ev.text, '#ff80ff', 'To ', ': ');
              else { this.chatLogFrom(ev.from, ev.text, '#ff80ff', '', ' whispers: '); audio.whisper(); }
              break;
            case 'general': this.chatLogFrom(ev.from, ev.text, '#ffc864', '[General] ', ': '); break;
            case 'guild': this.chatLogFrom(ev.from, ev.text, '#40d264', '[Guild] ', ': '); break;
            case 'officer': this.chatLogFrom(ev.from, ev.text, '#4ce0c0', '[Officer] ', ': '); break;
            case 'emote': this.chatLogFrom(ev.from, ev.text, '#ff8040', '', ' '); break;
            default: this.chatLogFrom(ev.from, ev.text, '#f0ead8', '', ' says: '); break;
          }
          if ((ev.channel === 'say' || ev.channel === 'yell' || ev.channel === 'emote') && ev.entityId !== undefined) {
            const bubble = ev.channel === 'emote' ? `${ev.from} ${ev.text}` : ev.text;
            this.renderer.showChatBubble(ev.entityId, bubble, ev.channel === 'yell');
          }
          break;
        }
        case 'tradeDone':
          if ($('#bags').style.display === 'block') this.renderBags();
          audio.coin();
          break;
        case 'heal2': {
          const tgt = sim.entities.get(ev.targetId);
          if (tgt && ev.amount > 0) {
            this.fct(tgt, `+${ev.amount}${ev.crit ? '!' : ''}`, '#3ce63c', ev.crit);
            if (ev.sourceId === sim.playerId) {
              this.combatLog(`Your ${ev.ability} heals ${ev.targetId === sim.playerId ? 'you' : tgt.name} for ${ev.amount}${ev.crit ? ' (Critical)' : ''}.`, '#7fdc4f');
            }
          }
          break;
        }
        case 'partyInvite':
          audio.questAccept();
          this.showPrompt(`<b>${ev.fromName}</b> invites you to join their party.`, 'Join Party',
            () => this.sim.partyAccept(), () => this.sim.partyDecline());
          break;
        case 'guildInvite':
          audio.questAccept();
          this.showPrompt(`<b>${ev.fromName}</b> invites you to join <span class="gold">&lt;${ev.guildName}&gt;</span>.`, 'Join Guild',
            () => this.sim.guildAccept(), () => this.sim.guildDecline());
          break;
        case 'tradeRequest':
          audio.click();
          this.showPrompt(`<b>${ev.fromName}</b> wants to trade with you.`, 'Open Trade',
            () => this.sim.tradeAccept(), () => { /* let it expire */ });
          break;
        case 'duelRequest':
          audio.duelChallenge();
          this.showPrompt(`<b>${ev.fromName}</b> has challenged you to a duel!`, 'Accept Duel',
            () => this.sim.duelAccept(), () => this.sim.duelDecline());
          break;
        case 'duelCountdown':
          this.showBanner(`Duel begins in ${ev.seconds}…`);
          audio.duelCountdownTick();
          break;
        case 'duelStart':
          audio.duelStart();
          break;
        case 'duelEnd':
          this.showBanner(`${ev.winnerName} has defeated ${ev.loserName} in a duel!`);
          this.combatLog(`${ev.winnerName} has defeated ${ev.loserName} in a duel.`, '#fa6');
          audio.duelEnd();
          break;
        case 'arenaQueued':
          this.log(`Queued for the Ashen Coliseum (position ${ev.position}).`, '#ffa040');
          break;
        case 'arenaUnqueued':
          this.log('You leave the Ashen Coliseum queue.', '#ffa040');
          break;
        case 'arenaFound': {
          const cls = CLASSES[ev.oppClass]?.name ?? ev.oppClass;
          this.showBanner(`Opponent found: ${ev.oppName}`);
          this.log(`The Coliseum pairs you against ${ev.oppName}, level ${ev.oppLevel} ${cls}.`, '#ffa040');
          audio.duelChallenge();
          break;
        }
        case 'arenaCountdown':
          this.showBanner(`The bout begins in ${ev.seconds}…`);
          audio.duelCountdownTick();
          break;
        case 'arenaStart':
          this.showBanner('Fight!');
          audio.duelStart();
          break;
        case 'arenaEnd': {
          const delta = ev.ratingAfter - ev.ratingBefore;
          const sign = delta >= 0 ? '+' : '';
          if (ev.draw) {
            this.showBanner(`Arena draw vs ${ev.oppName} (${sign}${delta} rating)`);
            this.combatLog(`Arena bout vs ${ev.oppName} ended in a draw. Rating ${ev.ratingAfter} (${sign}${delta}).`, '#fa6');
          } else if (ev.won) {
            this.showBanner(`Victory vs ${ev.oppName}!  Rating ${ev.ratingAfter} (${sign}${delta})`);
            this.combatLog(`You defeated ${ev.oppName} in the Ashen Coliseum. Rating ${ev.ratingAfter} (${sign}${delta}).`, '#7fdc4f');
            audio.duelEnd();
          } else {
            this.showBanner(`Defeated by ${ev.oppName}.  Rating ${ev.ratingAfter} (${sign}${delta})`);
            this.combatLog(`${ev.oppName} bested you in the Ashen Coliseum. Rating ${ev.ratingAfter} (${sign}${delta}).`, '#ff7a6a');
            audio.death();
          }
          break;
        }
        case 'log': this.log(ev.text, ev.color ?? '#ccc'); break;
        case 'playerDeath': {
          this.log('You have died.', '#ff4444');
          audio.death();
          break;
        }
        case 'respawn': this.log('You feel rested and whole again.', '#7fdc4f'); break;
        case 'castStart': {
          const a = ABILITIES[ev.ability];
          if (a?.school === 'fire') audio.castStart();
          else if (a?.school === 'frost') audio.castStart();
          else audio.castStart();
          break;
        }
        case 'castStop': break;
        case 'aura': {
          const tgt = sim.entities.get(ev.targetId);
          if (ev.name === 'Polymorph' && ev.gained) audio.sheep();
          if (ev.targetId === sim.playerId) {
            this.combatLog(ev.gained ? `You gain ${ev.name}.` : `${ev.name} fades from you.`, '#d8a0d8');
          } else if (tgt && ev.gained) {
            this.combatLog(`${tgt.name} is afflicted by ${ev.name}.`, '#d8a0d8');
          }
          break;
        }
      }
    }
  }

  log(text: string, color = '#ccc'): void {
    this.appendLog(this.chatLogEl, text, color);
  }

  private logZoneWelcome(zone: ZoneDef): void {
    const text = zoneWelcomeText(zone, (questId) => this.sim.questState(questId));
    if (text) this.log(text, '#ffd100');
  }

  private chatLogFrom(name: string, text: string, color: string, prefix: string, separator: string): void {
    const wasNearBottom = this.chatLogEl.scrollHeight - this.chatLogEl.scrollTop - this.chatLogEl.clientHeight < 24;
    const div = document.createElement('div');
    div.style.color = color;
    if (prefix) div.append(document.createTextNode(prefix));
    const sender = document.createElement('span');
    sender.className = 'chat-player-name';
    sender.textContent = name;
    sender.title = `Right-click ${name}`;
    sender.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      this.openChatPlayerContextMenu(name, ev.clientX, ev.clientY);
    });
    div.append(sender, document.createTextNode(`${separator}${text}`));
    this.chatLogEl.appendChild(div);
    while (this.chatLogEl.children.length > 200) this.chatLogEl.removeChild(this.chatLogEl.firstChild!);
    if (wasNearBottom) this.chatLogEl.scrollTop = this.chatLogEl.scrollHeight;
  }

  private combatLog(text: string, color = '#ccc'): void {
    this.appendLog(this.combatLogEl, text, color);
  }

  private appendLog(el: HTMLElement, text: string, color: string): void {
    const wasNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    const div = document.createElement('div');
    div.textContent = text;
    div.style.color = color;
    el.appendChild(div);
    while (el.children.length > 200) el.removeChild(el.firstChild!);
    if (wasNearBottom) el.scrollTop = el.scrollHeight;
  }

  private fct(target: Entity, text: string, color: string, crit: boolean): void {
    const v = this.renderer.worldToScreen(target.pos.x, target.pos.y + 2.2 * target.scale, target.pos.z);
    if (v.behind) return;
    const el = document.createElement('div');
    el.className = 'fct' + (crit ? ' crit' : '');
    el.style.color = color;
    el.style.left = `${v.x + (Math.random() * 30 - 15)}px`;
    el.style.top = `${v.y}px`;
    el.textContent = text;
    document.getElementById('ui')!.appendChild(el);
    setTimeout(() => el.remove(), 1250);
  }

  showError(text: string): void {
    this.errorEl.textContent = text;
    this.errorEl.style.opacity = '1';
    clearTimeout(this.errorTimer);
    this.errorTimer = window.setTimeout(() => { this.errorEl.style.opacity = '0'; }, 1600);
    audio.error();
  }

  showBanner(text: string): void {
    this.bannerEl.textContent = text;
    this.bannerEl.style.opacity = '1';
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => { this.bannerEl.style.opacity = '0'; }, 2600);
  }

  // -------------------------------------------------------------------------
  // Quest dialog (gossip)
  // -------------------------------------------------------------------------

  openQuestDialog(npcId: number): void {
    const npc = this.sim.entities.get(npcId);
    if (!npc || npc.kind !== 'npc') return;
    this.closeOtherWindows('#quest-dialog');
    this.renderGossip(npc);
  }

  private renderGossip(npc: Entity): void {
    this.openGossipNpcId = npc.id;
    const el = $('#quest-dialog');
    const def = NPCS[npc.templateId];
    // accepted-but-unfinished quests are tracked in the quest log; the NPC
    // only offers new quests (at the giver) and turn-ins (at the turn-in NPC)
    const interesting = npc.questIds.filter((q) => {
      const st = this.sim.questState(q);
      return (st === 'available' && QUESTS[q].giverNpcId === npc.templateId)
        || (st === 'ready' && QUESTS[q].turnInNpcId === npc.templateId);
    });
    let html = `<div class="panel-title"><span>${npc.name}<span style="color:#998d6a;font-size:11px"> &lt;${def?.title ?? ''}&gt;</span></span><span class="x-btn" data-close>${svgIcon('close')}</span></div>`;
    html += `<div class="qd-text">"${(def?.greeting ?? 'Greetings.').replace('$C', CLASSES[this.sim.cfg.playerClass].name.toLowerCase())}"</div>`;
    if (interesting.length > 0) {
      for (const qid of interesting) {
        const st = this.sim.questState(qid);
        const icon = st === 'ready' ? '<span class="gold">?</span> ' : '<span class="gold">!</span> ';
        html += `<div class="qd-list-item" data-quest="${qid}">${icon}${QUESTS[qid].name}</div>`;
      }
    }
    if (npc.vendorItems.length > 0) {
      html += `<div class="qd-list-item" data-vendor="1"><span style="color:#9fdc7f">$</span> Let me browse your goods.</div>`;
    }
    if (def?.market) {
      html += `<div class="qd-list-item" data-market="1"><span style="color:#ffd24a">${svgIcon('market')}</span> Show me the World Market.</div>`;
    }
    el.innerHTML = html;
    el.querySelectorAll('[data-quest]').forEach((item) => {
      item.addEventListener('click', () => this.renderQuestDetail(npc, (item as HTMLElement).dataset.quest!));
    });
    el.querySelector('[data-vendor]')?.addEventListener('click', () => {
      this.closeQuestDialog();
      this.openVendor(npc.id);
    });
    el.querySelector('[data-market]')?.addEventListener('click', () => {
      this.closeQuestDialog();
      this.openMarket();
    });
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeQuestDialog());
    el.style.display = 'block';
  }

  private renderQuestDetail(npc: Entity, questId: string): void {
    const el = $('#quest-dialog');
    const quest = QUESTS[questId];
    const state = this.sim.questState(questId);
    const text = (state === 'ready' ? quest.completionText : quest.text).replace(/\$N/g, this.sim.player.name);
    let html = `<div class="panel-title"><span>${quest.name}${quest.suggestedPlayers ? ` <span style="color:#f96;font-size:11px">(Suggested players: ${quest.suggestedPlayers})</span>` : ''}</span><span class="x-btn" data-close>${svgIcon('close')}</span></div>`;
    html += `<div class="qd-text">${text}</div>`;
    if (state !== 'ready') {
      const qp = this.sim.questLog.get(questId);
      html += `<div class="qd-sub">Objectives</div>`;
      html += quest.objectives.map((o, i) => `<div class="qd-obj">&bull; ${o.label}: ${qp ? Math.min(qp.counts[i], o.count) : 0}/${o.count}</div>`).join('');
    }
    html += `<div class="qd-sub">Rewards</div>`;
    html += `<div class="qd-obj">${quest.xpReward} experience &nbsp; ${this.moneyHtml(quest.copperReward)}</div>`;
    const rewardItem = questRewardItem(quest, this.sim.cfg.playerClass);
    if (rewardItem) {
      const item = ITEMS[rewardItem];
      html += `<div class="qd-reward-row" data-reward>${this.itemIcon(item)}<span style="color:${QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff'};font-size:12px">${item.name}</span></div>`;
    }
    el.innerHTML = html;
    const rewardRow = el.querySelector('[data-reward]') as HTMLElement | null;
    if (rewardRow && rewardItem) this.attachTooltip(rewardRow, () => this.itemTooltip(ITEMS[rewardItem]));

    if (state === 'available') {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = 'Accept';
      btn.addEventListener('click', () => { this.sim.acceptQuest(questId); this.renderGossip(npc); });
      el.appendChild(btn);
    } else if (state === 'ready') {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = 'Complete Quest';
      btn.addEventListener('click', () => { this.sim.turnInQuest(questId); this.renderGossip(npc); });
      el.appendChild(btn);
    }
    const back = document.createElement('button');
    back.className = 'btn';
    back.textContent = 'Back';
    back.addEventListener('click', () => this.renderGossip(npc));
    el.appendChild(back);
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeQuestDialog());
    el.style.display = 'block';
  }

  closeQuestDialog(): void {
    $('#quest-dialog').style.display = 'none';
    this.openGossipNpcId = null;
    this.hideTooltip();
  }

  // Re-render the open gossip dialog after quest state changes so completed
  // quests can never be accepted again from a stale dialog.
  private refreshGossip(): void {
    if (this.openGossipNpcId === null || $('#quest-dialog').style.display !== 'block') return;
    const npc = this.sim.entities.get(this.openGossipNpcId);
    if (npc) this.renderGossip(npc);
    else this.closeQuestDialog();
  }

  // -------------------------------------------------------------------------
  // Loot window
  // -------------------------------------------------------------------------

  openLoot(mobId: number, screenX: number, screenY: number): void {
    const mob = this.sim.entities.get(mobId);
    if (!mob?.loot) return;
    const visibleItems = mob.loot.items.filter((s) => !s.personalFor || s.personalFor.includes(this.sim.playerId));
    if (mob.loot.copper <= 0 && visibleItems.length === 0) return;
    this.closeOtherWindows('#loot-window');
    this.openLootMobId = mobId;
    const el = $('#loot-window');
    let html = `<div class="panel-title"><span>${mob.name}</span><span class="x-btn" data-close>${svgIcon('close')}</span></div>`;
    if (mob.loot.copper > 0) {
      html += `<div class="loot-item"><img class="item-icon q-common" src="${iconDataUrl('item', 'coin_gold')}" alt="" draggable="false"><span>${this.moneyHtml(mob.loot.copper)}</span></div>`;
    }
    for (const s of visibleItems) {
      const item = ITEMS[s.itemId];
      html += `<div class="loot-item" data-item="${s.itemId}">${this.itemIcon(item)}<span style="font-size:12px">${item.name}${s.count > 1 ? ' x' + s.count : ''}</span></div>`;
    }
    el.innerHTML = html;
    el.querySelectorAll('[data-item]').forEach((row) => {
      const itemId = (row as HTMLElement).dataset.item!;
      this.attachTooltip(row as HTMLElement, () => this.itemTooltip(ITEMS[itemId]));
    });
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = 'Take All';
    btn.addEventListener('click', () => { this.sim.lootCorpse(mobId); this.closeLoot(); });
    el.appendChild(btn);
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeLoot());
    el.style.left = `${Math.min(window.innerWidth - 260, Math.max(10, screenX - 115))}px`;
    el.style.top = `${Math.min(window.innerHeight - 280, Math.max(10, screenY - 30))}px`;
    el.style.transform = 'none'; // loot pops at the cursor, not the centred slot
    el.style.display = 'block';
  }

  closeLoot(): void {
    $('#loot-window').style.display = 'none';
    this.openLootMobId = null;
    this.hideTooltip();
  }

  // -------------------------------------------------------------------------
  // Vendor
  // -------------------------------------------------------------------------

  openVendor(npcId: number): void {
    this.closeOtherWindows(['#vendor-window', '#bags']);
    this.openVendorNpcId = npcId;
    document.body.classList.add('vendor-open');
    this.renderVendor();
    this.renderBags();
    $('#bags').style.display = 'block';
  }

  private renderVendor(): void {
    if (this.openVendorNpcId === null) return;
    const npc = this.sim.entities.get(this.openVendorNpcId);
    if (!npc) return;
    const el = $('#vendor-window');
    // the rebuild replaces the hovered row (its mouseleave never fires) and
    // collapses the scrolled list — drop the tooltip and restore the scroll
    this.hideTooltip();
    const scrollTop = el.scrollTop;
    let html = `<div class="panel-title"><span>${npc.name} — Goods</span><span class="x-btn" data-close>${svgIcon('close')}</span></div>`;
    el.innerHTML = html;
    for (const itemId of npc.vendorItems) {
      const item = ITEMS[itemId];
      if (!item?.buyValue) continue;
      const row = document.createElement('div');
      row.className = 'vendor-item';
      row.innerHTML = `${this.itemIcon(item)}<span class="vi-name">${item.name}</span><span class="vi-price">${this.moneyHtml(item.buyValue)}</span>`;
      row.addEventListener('click', () => {
        this.sim.buyItem(npc.id, itemId);
        if ($('#bags').style.display === 'block') this.renderBags();
        this.renderVendor();
      });
      this.attachTooltip(row, () => this.itemTooltip(item) + '<div class="tt-sub">Click to buy</div>');
      el.appendChild(row);
    }
    const buybackTitle = document.createElement('div');
    buybackTitle.className = 'vendor-section-title';
    buybackTitle.textContent = 'Buyback';
    el.appendChild(buybackTitle);
    const buyback = this.sim.vendorBuyback.filter((s) => ITEMS[s.itemId] && s.count > 0);
    if (buyback.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'vendor-empty';
      empty.textContent = 'No items';
      el.appendChild(empty);
    }
    for (const s of buyback) {
      const item = ITEMS[s.itemId]!;
      const row = document.createElement('div');
      row.className = 'vendor-item';
      row.innerHTML = `${this.itemIcon(item)}<span class="vi-name">${item.name}${s.count > 1 ? ` x${s.count}` : ''}</span><span class="vi-price">${this.moneyHtml(item.sellValue)}</span>`;
      row.addEventListener('click', () => {
        this.sim.buyBackItem(s.itemId);
      });
      this.attachTooltip(row, () => this.itemTooltip(item) + '<div class="tt-sub">Click to buy back</div>');
      el.appendChild(row);
    }
    const hint = document.createElement('div');
    hint.className = 'vendor-hint';
    hint.textContent = 'Click an item in your bags to sell it while this window is open.';
    el.appendChild(hint);
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeVendor());
    el.style.display = 'block';
    el.scrollTop = scrollTop;
  }

  closeVendor(): void {
    $('#vendor-window').style.display = 'none';
    this.openVendorNpcId = null;
    document.body.classList.remove('vendor-open'); // bags (if still open) re-centres
    this.hideTooltip();
    if ($('#bags').style.display === 'block') this.renderBags();
  }

  get vendorOpen(): boolean {
    return this.openVendorNpcId !== null;
  }

  // -------------------------------------------------------------------------
  // The World Market — the Merchant's auction house
  // -------------------------------------------------------------------------

  openMarket(): void {
    this.closeOtherWindows('#market-window');
    this.marketOpen = true;
    this.marketTab = 'browse';
    this.marketSellItem = null;
    this.lastMarketSig = '';
    this.renderMarket();
    $('#market-window').style.display = 'flex';
    // bags ride alongside so you can click items straight onto the Sell tab
    this.renderBags();
    $('#bags').style.display = 'block';
    audio.bagOpen();
  }

  closeMarket(): void {
    if (!this.marketOpen) return;
    this.marketOpen = false;
    this.marketSellItem = null;
    $('#market-window').style.display = 'none';
    this.hideTooltip();
    if ($('#bags').style.display === 'block') this.renderBags();
  }

  get marketWindowOpen(): boolean {
    return this.marketOpen;
  }

  private nearbyMarketNpc(): Entity | null {
    const p = this.sim.player;
    for (const e of this.sim.entities.values()) {
      if (e.kind === 'npc' && NPCS[e.templateId]?.market && dist2d(p.pos, e.pos) <= 8) return e;
    }
    return null;
  }

  private bagCount(itemId: string): number {
    return this.sim.inventory.filter((s) => s.itemId === itemId).reduce((n, s) => n + s.count, 0);
  }

  private renderMarket(): void {
    const el = $('#market-window');
    this.hideTooltip();
    const info = this.sim.marketInfo;
    const collectN = info ? (info.collectionCopper > 0 ? 1 : 0) + info.collectionItems.length : 0;
    const tab = (id: typeof this.marketTab, label: string, pip = '') =>
      `<div class="mkt-tab${this.marketTab === id ? ' sel' : ''}" data-tab="${id}">${label}${pip}</div>`;
    el.innerHTML =
      `<div class="panel-title"><span>The World Market <span style="color:#998d6a;font-size:11px">— the Merchant's exchange</span></span><span class="x-btn" data-close>${svgIcon('close')}</span></div>`
      + `<div class="mkt-tabs">`
      + tab('browse', 'Browse')
      + tab('sell', 'Sell')
      + tab('collect', 'Collect', collectN > 0 ? ` <span class="pip">(${collectN})</span>` : '')
      + `</div>`
      + `<div id="market-body"></div>`;
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeMarket());
    el.querySelectorAll('[data-tab]').forEach((t) => {
      t.addEventListener('click', () => {
        const next = (t as HTMLElement).dataset.tab as typeof this.marketTab;
        if (next === this.marketTab) return;
        this.marketTab = next;
        this.lastMarketSig = '';
        audio.click();
        this.renderMarket();
      });
    });
    this.renderMarketContent(info);
  }

  // Per-frame: refresh the live lists (Browse/Collect) when they change. The
  // Sell tab holds typed inputs, so it is only rebuilt on explicit actions.
  private refreshMarket(): void {
    if (!this.marketOpen || this.marketTab === 'sell') return;
    const info = this.sim.marketInfo;
    const collectN = info ? (info.collectionCopper > 0 ? 1 : 0) + info.collectionItems.length : 0;
    const sig = JSON.stringify([this.marketTab, info?.listings, info?.collectionCopper, info?.collectionItems]);
    if (sig === this.lastMarketSig) return;
    this.lastMarketSig = sig;
    const collectTab = $('#market-window').querySelector('[data-tab="collect"]');
    if (collectTab) collectTab.innerHTML = `Collect${collectN > 0 ? ` <span class="pip">(${collectN})</span>` : ''}`;
    this.renderMarketContent(info);
  }

  private renderMarketContent(info: MarketInfo | null): void {
    const body = document.getElementById('market-body');
    if (!body) return;
    if (!info) { body.innerHTML = `<div class="mkt-empty">Step up to the Merchant to deal.</div>`; return; }
    if (this.marketTab === 'browse') this.renderMarketBrowse(body, info);
    else if (this.marketTab === 'sell') this.renderMarketSell(body, info);
    else this.renderMarketCollect(body, info);
  }

  private renderMarketBrowse(body: HTMLElement, info: MarketInfo): void {
    if (info.listings.length === 0) {
      body.innerHTML = `<div class="mkt-empty">The market is quiet. Be the first — list something on the Sell tab.</div>`;
      return;
    }
    body.innerHTML = `<div class="mkt-note">Goods listed by adventurers across the realm. Click Buy to purchase a stack outright.</div>`;
    for (const l of info.listings) {
      const item = ITEMS[l.itemId];
      if (!item) continue;
      const qColor = QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff';
      const row = document.createElement('div');
      row.className = 'mkt-row';
      const each = l.count > 1 ? `<br><span class="seller">${formatMoney(Math.ceil(l.price / l.count))} each</span>` : '';
      row.innerHTML =
        `${this.itemIcon(item)}`
        + `<span class="mkt-name"><span class="nm" style="color:${qColor}">${item.name}${l.count > 1 ? ' <span style="color:#ccc">x' + l.count + '</span>' : ''}</span>`
        + `<span class="seller${l.house ? ' house' : ''}">${l.house ? "Merchant's stock" : esc(l.sellerName)}</span></span>`
        + `<span class="mkt-price">${this.moneyHtml(l.price)}${each}</span>`;
      const btn = document.createElement('button');
      btn.className = 'mkt-btn' + (l.mine ? ' cancel' : '');
      btn.textContent = l.mine ? 'Reclaim' : 'Buy';
      btn.addEventListener('click', () => {
        if (l.mine) this.sim.marketCancel(l.id);
        else this.sim.marketBuy(l.id);
        audio.click();
      });
      row.appendChild(btn);
      this.attachTooltip(row, () => this.itemTooltip(item));
      body.appendChild(row);
    }
  }

  private renderMarketSell(body: HTMLElement, info: MarketInfo): void {
    body.innerHTML = `<div class="mkt-note">List goods from your bags. The Merchant takes a ${info.cutPct}% cut when an item sells. You are using ${info.myListingCount}/${info.maxListings} listing slots.</div>`;
    const item = this.marketSellItem ? ITEMS[this.marketSellItem] : null;
    const have = this.marketSellItem ? this.bagCount(this.marketSellItem) : 0;
    const pick = document.createElement('div');
    if (!item || have <= 0) {
      pick.className = 'mkt-sell-pick empty';
      pick.textContent = 'Click an item in your bags to choose what to sell.';
      body.appendChild(pick);
      return;
    }
    const qColor = QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff';
    pick.className = 'mkt-sell-pick';
    pick.innerHTML = `${this.itemIcon(item)}<span class="ps-name" style="color:${qColor}">${item.name}</span>`;
    body.appendChild(pick);

    const form = document.createElement('div');
    form.className = 'mkt-price-form';
    const qtyRow = have > 1
      ? `<div class="mkt-price-row"><label>Quantity</label><input class="coininput" id="mkt-qty" type="number" min="1" max="${have}" value="1"> <span class="mkt-coin-tag">of ${have}</span></div>`
      : '';
    // a gentle starting ask: a few times vendor value, never below 1c
    const suggested = Math.max(1, item.buyValue ?? Math.max(1, item.sellValue) * 4);
    const g = Math.floor(suggested / 10000), s = Math.floor((suggested % 10000) / 100), c = suggested % 100;
    form.innerHTML = qtyRow
      + `<div class="mkt-price-row"><label>Price each</label>`
      + `<input class="coininput" id="mkt-g" type="number" min="0" value="${g}"><span class="mkt-coin-tag">g</span>`
      + `<input class="coininput" id="mkt-s" type="number" min="0" max="99" value="${s}"><span class="mkt-coin-tag">s</span>`
      + `<input class="coininput" id="mkt-c" type="number" min="0" max="99" value="${c}"><span class="mkt-coin-tag">c</span></div>`;
    body.appendChild(form);

    const listBtn = document.createElement('button');
    listBtn.className = 'mkt-list-btn';
    listBtn.textContent = 'List on the World Market';
    listBtn.addEventListener('click', () => {
      const qty = have > 1 ? Math.max(1, Math.min(have, parseInt(($('#mkt-qty') as HTMLInputElement)?.value || '1', 10) || 1)) : 1;
      const gg = Math.max(0, parseInt(($('#mkt-g') as HTMLInputElement)?.value || '0', 10) || 0);
      const ss = Math.max(0, parseInt(($('#mkt-s') as HTMLInputElement)?.value || '0', 10) || 0);
      const cc = Math.max(0, parseInt(($('#mkt-c') as HTMLInputElement)?.value || '0', 10) || 0);
      const each = gg * 10000 + ss * 100 + cc;
      if (each < 1) { this.showError('Name a price of at least 1 copper.'); return; }
      this.sim.marketList(this.marketSellItem!, qty, each * qty);
      this.marketSellItem = null;
      audio.coin();
      this.renderMarket(); // the next snapshot echoes the new bags + listings
    });
    body.appendChild(listBtn);
  }

  private renderMarketCollect(body: HTMLElement, info: MarketInfo): void {
    if (info.collectionCopper <= 0 && info.collectionItems.length === 0) {
      body.innerHTML = `<div class="mkt-empty">Nothing waiting. Sale proceeds and expired listings collect here.</div>`;
      return;
    }
    body.innerHTML = `<div class="mkt-note">Earnings and returned goods the Merchant is holding for you.</div>`;
    if (info.collectionCopper > 0) {
      const row = document.createElement('div');
      row.className = 'mkt-collect';
      row.innerHTML = `<span>Sale proceeds</span><span class="mkt-price">${this.moneyHtml(info.collectionCopper)}</span>`;
      body.appendChild(row);
    }
    for (const s of info.collectionItems) {
      const item = ITEMS[s.itemId];
      if (!item) continue;
      const qColor = QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff';
      const row = document.createElement('div');
      row.className = 'mkt-collect';
      row.innerHTML = `<span style="display:flex;gap:8px;align-items:center">${this.itemIcon(item)}<span style="color:${qColor}">${item.name}${s.count > 1 ? ' x' + s.count : ''}</span></span>`;
      this.attachTooltip(row, () => this.itemTooltip(item));
      body.appendChild(row);
    }
    const btn = document.createElement('button');
    btn.className = 'mkt-list-btn';
    btn.textContent = 'Collect All';
    btn.addEventListener('click', () => { this.sim.marketCollect(); audio.coin(); });
    body.appendChild(btn);
  }

  // -------------------------------------------------------------------------
  // Bags
  // -------------------------------------------------------------------------

  toggleBags(): void {
    const el = $('#bags');
    if (el.style.display === 'block') { el.style.display = 'none'; this.hideTooltip(); audio.bagClose(); return; }
    this.closeOtherWindows('#bags');
    this.renderBags();
    el.style.display = 'block';
    audio.bagOpen();
  }

  // Called when an authoritative inventory delta lands (online snapshots
  // carry inventory separately from the event frames that normally redraw).
  onInventoryChanged(): void {
    if ($('#bags').style.display === 'block') this.renderBags();
    if (this.openVendorNpcId !== null) this.renderVendor();
    this.renderCharIfOpen();
  }

  private renderCharIfOpen(): void {
    if ($('#char-window').style.display === 'block') this.renderChar();
  }

  renderBags(): void {
    const el = $('#bags');
    const sim = this.sim;
    el.innerHTML = `<div class="panel-title"><span>Bags</span><span class="x-btn" data-close>${svgIcon('close')}</span></div>`;
    const grid = document.createElement('div');
    grid.className = 'bag-grid';
    if (sim.inventory.length === 0) {
      grid.innerHTML = `<div style="font-size:12px;color:#887c5c;padding:6px">Your bags are empty.</div>`;
    }
    for (const s of [...sim.inventory]) {
      const item = ITEMS[s.itemId];
      if (!item) continue;
      const row = document.createElement('div');
      row.className = 'bag-item';
      const qColor = QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff';
      row.innerHTML = `${this.itemIcon(item)}<span style="color:${qColor}">${item.name}</span><span class="bi-count">${s.count > 1 ? 'x' + s.count : ''}</span>`;
      row.addEventListener('click', (ev) => {
        if (this.tradeOpen) {
          this.addItemToTrade(s.itemId);
        } else if (this.marketOpen && this.marketTab === 'sell') {
          if (item.kind === 'quest') { this.showError('The Merchant will not broker quest items.'); return; }
          this.marketSellItem = s.itemId;
          this.renderMarket();
        } else if (this.vendorOpen) {
          this.sellBagItem(s, ev);
        } else if (item.kind === 'quest') {
          this.showDiscardItemPrompt(s.itemId, Math.max(1, Math.floor(s.count)));
        } else {
          this.sim.useItem(s.itemId);
          this.renderBags();
          this.renderCharIfOpen();
        }
      });
      row.addEventListener('contextmenu', (ev) => {
        if (!this.vendorOpen || (!ev.ctrlKey && !ev.metaKey)) return;
        ev.preventDefault();
        this.sellBagItem(s, ev);
      });
      if (!this.tradeOpen && !this.vendorOpen && this.isHotbarItemId(s.itemId)) {
        row.draggable = true;
        row.addEventListener('dragstart', (e) => {
          const action = { type: 'item' as const, id: s.itemId };
          this.dragAction = { action, sourceIndex: null };
          this.writeDraggedAction(e.dataTransfer, action);
          e.dataTransfer!.effectAllowed = 'copy';
          this.hideTooltip();
        });
        row.addEventListener('dragend', () => {
          this.dragAction = null;
          this.clearActionDropTargets();
        });
      }
      this.attachTooltip(row, () => {
        let extra = '';
        if (this.tradeOpen) extra = '<div class="tt-sub">Click to offer in trade</div>';
        else if (this.marketOpen && this.marketTab === 'sell') extra = item.kind === 'quest' ? '<div class="tt-sub">Cannot be sold on the market</div>' : '<div class="tt-sub">Click to put on the market</div>';
        else if (this.vendorOpen) extra = item.kind === 'quest' ? '<div class="tt-sub">Cannot be sold to merchants</div>' : '<div class="tt-sub">Click to sell</div>';
        else if (item.kind === 'quest') extra = '<div class="tt-sub">Click to destroy</div>';
        else if (item.kind === 'weapon' || item.kind === 'armor') extra = '<div class="tt-sub">Click to equip</div>';
        else if (item.kind === 'food' || item.kind === 'drink') extra = '<div class="tt-sub">Click to consume</div>';
        else if (item.kind === 'potion') extra = '<div class="tt-sub">Click to use — instant, usable in combat</div>';
        else if (item.use) extra = '<div class="tt-sub">Click to use</div>';
        return this.itemTooltip(item) + extra;
      });
      grid.appendChild(row);
    }
    el.appendChild(grid);
    const money = document.createElement('div');
    money.className = 'money';
    money.innerHTML = this.moneyHtml(sim.copper);
    el.appendChild(money);
    el.querySelector('[data-close]')?.addEventListener('click', () => { el.style.display = 'none'; this.hideTooltip(); });
  }

  private sellBagItem(slot: InvSlot, ev: MouseEvent): void {
    const count = Math.max(1, Math.floor(slot.count));
    if (ev.ctrlKey || ev.metaKey) {
      this.sim.sellItem(slot.itemId, count);
    } else if (ev.shiftKey && count > 1) {
      this.showSellQuantityPrompt(slot.itemId, count);
    } else {
      this.sim.sellItem(slot.itemId);
    }
  }

  private showDiscardItemPrompt(itemId: string, maxCount: number): void {
    document.querySelectorAll('.discard-item-prompt').forEach((el) => el.remove());
    const item = ITEMS[itemId];
    const stack = $('#prompt-stack');
    const prompt = document.createElement('div');
    prompt.className = 'prompt panel discard-item-prompt';
    prompt.innerHTML = `<div class="prompt-text">Destroy ${esc(item?.name ?? itemId)}</div>`;
    let input: HTMLInputElement | null = null;
    if (maxCount > 1) {
      input = document.createElement('input');
      input.className = 'prompt-number';
      input.type = 'number';
      input.min = '1';
      input.max = String(maxCount);
      input.step = '1';
      input.value = '1';
      prompt.appendChild(input);
    }
    const confirm = document.createElement('button');
    confirm.className = 'btn';
    confirm.textContent = 'Destroy';
    const cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.textContent = 'Cancel';
    const close = () => prompt.remove();
    const submit = () => {
      const count = input ? Math.max(1, Math.min(maxCount, Math.floor(Number(input.value) || 0))) : 1;
      this.sim.discardItem(itemId, count);
      close();
      this.hideTooltip();
      this.renderBags();
    };
    confirm.addEventListener('click', submit);
    cancel.addEventListener('click', close);
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
        else if (e.key === 'Escape') close();
      });
    }
    prompt.append(confirm, cancel);
    stack.appendChild(prompt);
    if (input) window.setTimeout(() => { input.focus(); input.select(); }, 0);
  }

  private showSellQuantityPrompt(itemId: string, maxCount: number): void {
    document.querySelectorAll('.sell-quantity-prompt').forEach((el) => el.remove());
    const item = ITEMS[itemId];
    const stack = $('#prompt-stack');
    const prompt = document.createElement('div');
    prompt.className = 'prompt panel sell-quantity-prompt';
    prompt.innerHTML = `<div class="prompt-text">Sell ${esc(item?.name ?? itemId)}</div>`;
    const input = document.createElement('input');
    input.className = 'prompt-number';
    input.type = 'number';
    input.min = '1';
    input.max = String(maxCount);
    input.step = '1';
    input.value = '1';
    const confirm = document.createElement('button');
    confirm.className = 'btn';
    confirm.textContent = 'Sell';
    const cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.textContent = 'Cancel';
    const close = () => prompt.remove();
    const submit = () => {
      const count = Math.max(1, Math.min(maxCount, Math.floor(Number(input.value) || 0)));
      this.sim.sellItem(itemId, count);
      close();
    };
    confirm.addEventListener('click', submit);
    cancel.addEventListener('click', close);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      else if (e.key === 'Escape') close();
    });
    prompt.append(input, confirm, cancel);
    stack.appendChild(prompt);
    window.setTimeout(() => { input.focus(); input.select(); }, 0);
  }

  // -------------------------------------------------------------------------
  // Character window
  // -------------------------------------------------------------------------

  toggleChar(): void {
    const el = $('#char-window');
    if (el.style.display === 'block') { el.style.display = 'none'; this.hideTooltip(); return; }
    this.closeOtherWindows('#char-window');
    this.renderChar();
    el.style.display = 'block';
  }

  renderChar(): void {
    const el = $('#char-window');
    const sim = this.sim;
    const p = sim.player;
    const cls = CLASSES[sim.cfg.playerClass];
    let html = `<div class="panel-title"><span>${p.name} <span style="color:#998d6a;font-size:11px">Level ${p.level} ${cls.name}</span></span><span class="x-btn" data-close>${svgIcon('close')}</span></div>`;
    html += `<div class="paperdoll"><div class="equip-col" id="equip-col"></div></div>`;
    const wpn = sim.equipment.mainhand ? ITEMS[sim.equipment.mainhand] : null;
    const dps = wpn?.weapon ? ((wpn.weapon.min + wpn.weapon.max) / 2 + (p.attackPower / 14) * wpn.weapon.speed) / wpn.weapon.speed : 0;
    html += `<div class="char-stats">
      <span>Strength: <b>${p.stats.str}</b></span><span>Armor: <b>${p.stats.armor}</b></span>
      <span>Agility: <b>${p.stats.agi}</b></span><span>Attack Power: <b>${p.attackPower}</b></span>
      <span>Stamina: <b>${p.stats.sta}</b></span><span>Damage/sec: <b>${dps.toFixed(1)}</b></span>
      <span>Intellect: <b>${p.stats.int}</b></span><span>Crit Chance: <b>${(p.critChance * 100).toFixed(1)}%</b></span>
      <span>Spirit: <b>${p.stats.spi}</b></span><span>Dodge: <b>${(p.dodgeChance * 100).toFixed(1)}%</b></span>
    </div>`;
    html += this.talentSummaryHtml();
    html += this.progressionHtml(p.level);
    el.innerHTML = html;
    el.querySelector('[data-act="prestige"]')?.addEventListener('click', () => this.openPrestigeDialog());
    const col = el.querySelector('#equip-col')!;
    const slots: { key: 'mainhand' | 'chest' | 'legs' | 'feet'; name: string }[] = [
      { key: 'mainhand', name: 'Main Hand' },
      { key: 'chest', name: 'Chest' },
      { key: 'legs', name: 'Legs' },
      { key: 'feet', name: 'Feet' },
    ];
    for (const slot of slots) {
      const itemId = sim.equipment[slot.key];
      const item = itemId ? ITEMS[itemId] : null;
      const row = document.createElement('div');
      row.className = 'equip-slot';
      const qColor = !item ? '#666' : QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff';
      row.innerHTML = `${item ? this.itemIcon(item) : `<img class="item-icon" style="border-color:#444" src="${iconDataUrl('item', 'slot_empty')}" alt="" draggable="false">`}
        <div><div class="slot-name">${slot.name}</div><div class="slot-item" style="color:${qColor}">${item ? item.name : 'Empty'}</div></div>`;
      if (item) this.attachTooltip(row, () => this.itemTooltip(item));
      col.appendChild(row);
    }
    el.querySelector('[data-close]')?.addEventListener('click', () => { el.style.display = 'none'; this.hideTooltip(); });
  }

  // -------------------------------------------------------------------------
  // Post-cap progression (Max-Level XP Overflow): character-sheet block,
  // milestone badges, prestige dialog, and the lifetime-XP leaderboard panel.
  // -------------------------------------------------------------------------

  private milestoneName(id: string): string {
    switch (id) {
      case 'veteran': return t('game.milestone.veteran');
      case 'champion': return t('game.milestone.champion');
      case 'paragon': return t('game.milestone.paragon');
      case 'mythic': return t('game.milestone.mythic');
      case 'eternal': return t('game.milestone.eternal');
      default: return id;
    }
  }

  // Character-sheet summary of the current specialization, role, and Mastery
  // (FR-8.6). Reuses the progression-block styling.
  private talentSummaryHtml(): string {
    const ct = talentsFor(this.sim.cfg.playerClass);
    if (!ct) return '';
    const sp = ct.specs.find((s) => s.id === this.sim.talentSpec);
    const specName = sp ? esc(sp.name) : t('game.talents.noSpec');
    let html = `<div class="char-progression"><div class="cp-title">${t('game.talents.specTab')}</div>`;
    html += `<div class="char-stats cp-stats"><span>${t('game.talents.specTab')}: <b>${specName}</b></span>`;
    if (sp) html += `<span>${t('game.talents.role')}: <b>${this.roleLabel(sp.role)}</b></span>`;
    html += `</div>`;
    if (sp) html += `<div class="cp-milestones"><span class="cp-ms-label">${t('game.talents.mastery')}:</span> <b style="color:var(--gold)">${esc(sp.mastery.name)}</b> <span class="cp-none">${esc(sp.mastery.description)}</span></div>`;
    return html + `</div>`;
  }

  // The "Progression" group on the character sheet: total XP, virtual level,
  // prestige rank (when prestiged), unlocked milestone badges, and — at the cap
  // — the opt-in Prestige button.
  private progressionHtml(level: number): string {
    const sim = this.sim;
    const vlevel = virtualLevel(sim.lifetimeXp);
    const unlocked = new Set(sim.unlockedMilestones);
    const badges = MILESTONES.filter((m) => unlocked.has(m.id))
      .map((m) => `<span class="ms-badge ms-${m.kind}">${this.milestoneName(m.id)}</span>`)
      .join('');
    let html = `<div class="cp-title">${t('game.progression.heading')}</div>`;
    html += `<div class="char-stats cp-stats">
      <span>${t('game.progression.totalXp')}: <b>${formatXp(sim.lifetimeXp)}</b></span>
      <span>${t('game.progression.virtualLevel')}: <b>${vlevel}</b></span>`;
    if (sim.prestigeRank > 0) html += `<span>${t('game.progression.prestigeRank')}: <b>★ ${sim.prestigeRank}</b></span>`;
    html += `</div>`;
    html += `<div class="cp-milestones"><span class="cp-ms-label">${t('game.progression.milestones')}:</span> ${badges || `<span class="cp-none">${t('game.progression.none')}</span>`}</div>`;
    if (level >= MAX_LEVEL) {
      // The button reflects the server's authoritative prestige gate (post-cap
      // XP earned). It's disabled — and the requirement shown — until eligible;
      // the server re-checks regardless, so a forged click does nothing.
      const ready = canPrestige(level, sim.lifetimeXp, sim.prestigeRank);
      html += `<div class="cp-actions"><button class="btn" data-act="prestige"${ready ? '' : ' disabled'}>${t('game.prestige.action')}${sim.prestigeRank > 0 ? ` (★ ${sim.prestigeRank})` : ''}</button>`;
      if (!ready) html += `<span class="cp-hint">${formatXp(xpUntilNextPrestige(sim.lifetimeXp, sim.prestigeRank))} ${t('game.prestige.needXp')}</span>`;
      html += `</div>`;
    }
    return `<div class="char-progression">${html}</div>`;
  }

  private openPrestigeDialog(): void {
    const p = this.sim.player;
    // Mirror the server's gate; the server enforces it authoritatively anyway.
    if (!canPrestige(p.level, this.sim.lifetimeXp, this.sim.prestigeRank)) {
      this.showError(p.level < MAX_LEVEL
        ? t('game.prestige.needCap')
        : `${formatXp(xpUntilNextPrestige(this.sim.lifetimeXp, this.sim.prestigeRank))} ${t('game.prestige.needXp')}`);
      return;
    }
    this.confirmDialog(
      t('game.prestige.title'),
      t('game.prestige.body'),
      t('game.prestige.confirm'),
      t('game.prestige.cancel'),
      () => { this.sim.prestige(); audio.click(); },
    );
  }

  // Minimal modal confirm dialog (reuses the .window/.panel chrome). Used by the
  // prestige flow; built on demand and removed on dismiss.
  private confirmDialog(title: string, body: string, okText: string, cancelText: string, onOk: () => void): void {
    document.getElementById('confirm-dialog')?.remove();
    const el = document.createElement('div');
    el.id = 'confirm-dialog';
    el.className = 'window panel';
    el.style.display = 'block';
    el.innerHTML = `<div class="panel-title"><span>${title}</span><span class="x-btn" data-cancel>${svgIcon('close')}</span></div>`
      + `<div class="cd-body">${body}</div>`
      + `<div class="cd-actions"><button class="btn" data-cancel>${cancelText}</button><button class="btn cd-ok" data-ok>${okText}</button></div>`;
    document.body.appendChild(el);
    const close = () => el.remove();
    el.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => { audio.click(); close(); }));
    el.querySelector('[data-ok]')?.addEventListener('click', () => { close(); onOk(); });
  }

  // In-app text-input modal (reuses the confirm-dialog chrome) — replaces native
  // window.prompt for build name / import / export. `readOnly` + `copy` powers
  // the export view (selectable string + Copy button).
  private inputDialog(opts: {
    title: string; label?: string; value?: string; placeholder?: string;
    multiline?: boolean; readOnly?: boolean; copy?: boolean;
    selectText?: boolean;
    okText?: string; cancelText?: string; onOk?: (value: string) => void;
  }): void {
    document.getElementById('confirm-dialog')?.remove();
    const el = document.createElement('div');
    el.id = 'confirm-dialog';
    el.className = 'window panel';
    el.style.display = 'block';
    const field = opts.multiline
      ? `<textarea class="cd-input" rows="3" ${opts.readOnly ? 'readonly' : ''} placeholder="${esc(opts.placeholder ?? '')}">${esc(opts.value ?? '')}</textarea>`
      : `<input class="cd-input" type="text" ${opts.readOnly ? 'readonly' : ''} placeholder="${esc(opts.placeholder ?? '')}" value="${esc(opts.value ?? '')}">`;
    el.innerHTML = `<div class="panel-title"><span>${esc(opts.title)}</span><span class="x-btn" data-cancel>${svgIcon('close')}</span></div>`
      + (opts.label ? `<div class="cd-body">${esc(opts.label)}</div>` : '')
      + `<div class="cd-field">${field}</div>`
      + `<div class="cd-actions"><button class="btn" data-cancel>${esc(opts.cancelText ?? t('game.talents.cancel'))}</button>`
      + (opts.copy ? `<button class="btn" data-copy>${t('game.talents.copy')}</button>` : '')
      + (opts.onOk ? `<button class="btn cd-ok" data-ok>${esc(opts.okText ?? t('game.talents.save'))}</button>` : '')
      + `</div>`;
    document.body.appendChild(el);
    const input = el.querySelector('.cd-input') as HTMLInputElement | HTMLTextAreaElement;
    const close = () => el.remove();
    const submit = () => { const v = input?.value ?? ''; close(); opts.onOk?.(v); };
    el.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => { audio.click(); close(); }));
    el.querySelector('[data-ok]')?.addEventListener('click', submit);
    el.querySelector('[data-copy]')?.addEventListener('click', () => {
      input.select();
      navigator.clipboard?.writeText(input.value).catch(() => { /* clipboard blocked; manual select still works */ });
      this.showError(t('game.talents.exportCopied'));
    });
    if (!opts.multiline) input?.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); submit(); } });
    input?.focus();
    if (opts.readOnly || opts.selectText) input?.select?.();
  }

  // Generic in-app dropdown (replaces native <select>). The selected value lives
  // in root.dataset.value; pass onChange to react live. Closes on click-away.
  private buildDropdown(options: { value: string; label: string }[], current: string, onChange?: (value: string) => void, placeholder?: string): HTMLElement {
    const root = document.createElement('div');
    root.className = 'ui-dd';
    root.dataset.value = current;
    const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? placeholder ?? '';
    root.innerHTML = `<button type="button" class="btn ui-dd-btn"><span class="ui-dd-label">${esc(labelOf(current))}</span><span class="ui-dd-caret">▾</span></button>`
      + `<div class="ui-dd-menu" hidden>${options.map((o) => `<div class="ui-dd-item${o.value === current ? ' sel' : ''}" data-val="${esc(o.value)}">${esc(o.label)}</div>`).join('')}</div>`;
    const menu = root.querySelector('.ui-dd-menu') as HTMLElement;
    const labelEl = root.querySelector('.ui-dd-label') as HTMLElement;
    root.querySelector('.ui-dd-btn')!.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menu.hasAttribute('hidden')) {
        menu.removeAttribute('hidden');
        setTimeout(() => document.addEventListener('click', () => menu.setAttribute('hidden', ''), { once: true }), 0);
      } else menu.setAttribute('hidden', '');
    });
    root.querySelectorAll('.ui-dd-item').forEach((item) => item.addEventListener('click', () => {
      const v = item.getAttribute('data-val') ?? '';
      root.dataset.value = v;
      labelEl.textContent = labelOf(v);
      root.querySelectorAll('.ui-dd-item').forEach((x) => x.classList.toggle('sel', x === item));
      menu.setAttribute('hidden', '');
      onChange?.(v);
    }));
    return root;
  }

  // WoW-style choice-node picker: clicking an octagon node opens a flyout of its
  // options; selecting one assigns it (spending a point if needed). Anchored to
  // the node, closes on click-away.
  private openChoicePopup(anchor: HTMLElement, node: TalentNode, stage: TalentAllocation): void {
    document.getElementById('tal-choice-pop')?.remove();
    const cls = this.sim.cfg.playerClass;
    const total = this.sim.talentPoints().total;
    const ranks = stage.ranks[node.id] ?? 0;
    const pop = document.createElement('div');
    pop.id = 'tal-choice-pop';
    pop.className = 'tal-choice-pop';
    pop.setAttribute('role', 'menu');
    pop.setAttribute('aria-label', node.name);
    pop.innerHTML = (node.choices ?? []).map((o) => {
      const sel = stage.choices[node.id] === o.id;
      return `<div class="tal-choice-opt${sel ? ' sel' : ''}" role="menuitemradio" tabindex="0" aria-checked="${sel}" data-opt="${esc(o.id)}"><span class="tco-icon" style="background-image:url(${talentEffectIcon(o.effect, 'passive')})"></span>`
        + `<span class="tco-text"><b>${esc(o.name)}</b><span>${esc(o.description)}</span></span></div>`;
    }).join('');
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const preferredLeft = r.left + r.width / 2 - pop.offsetWidth / 2;
    const left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, preferredLeft));
    const top = Math.max(8, Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + 12));
    const caretLeft = Math.max(14, Math.min(pop.offsetWidth - 14, r.left + r.width / 2 - left));
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    pop.style.setProperty('--tal-choice-caret-left', `${caretLeft}px`);
    const choose = (optEl: Element) => {
      const optId = optEl.getAttribute('data-opt') ?? '';
      if (ranks === 0) {
        const cand = cloneAllocation(stage);
        cand.ranks[node.id] = 1; cand.choices[node.id] = optId;
        if (!validateAllocation(cls, cand, total).ok) { pop.remove(); return; } // can't afford / gated
        stage.ranks[node.id] = 1;
      }
      stage.choices[node.id] = optId;
      pop.remove();
      this.renderTalents();
    };
    pop.querySelectorAll('.tal-choice-opt').forEach((optEl) => {
      optEl.addEventListener('click', (e) => {
        e.stopPropagation();
        choose(optEl);
      });
      optEl.addEventListener('keydown', (e) => {
        const ke = e as KeyboardEvent;
        if (ke.key === 'Escape') { ke.preventDefault(); pop.remove(); anchor.focus(); return; }
        this.keyboardActivate(ke, () => choose(optEl));
      });
    });
    const firstOpt = (pop.querySelector('.tal-choice-opt.sel') ?? pop.querySelector('.tal-choice-opt')) as HTMLElement | null;
    firstOpt?.focus();
    setTimeout(() => document.addEventListener('click', () => pop.remove(), { once: true }), 0);
  }

  toggleLeaderboard(): void {
    const el = $('#leaderboard-window');
    if (el.style.display === 'block') { el.style.display = 'none'; this.hideTooltip(); return; }
    this.closeOtherWindows('#leaderboard-window');
    el.style.display = 'block';
    void this.renderLeaderboard();
  }

  async renderLeaderboard(): Promise<void> {
    const el = $('#leaderboard-window');
    const myName = this.sim.player.name;
    el.innerHTML = `<div class="panel-title"><span>${t('game.leaderboard.title')} <span style="color:#998d6a;font-size:11px">${t('game.leaderboard.subtitle')}${this.sim.realm ? ` &middot; ${this.sim.realm}` : ''}</span></span><span class="x-btn" data-close>${svgIcon('close')}</span></div>`
      + `<div class="lb-body"><div class="lb-loading">${t('game.leaderboard.loading')}</div></div>`;
    el.querySelector('[data-close]')?.addEventListener('click', () => { el.style.display = 'none'; });

    let rows: LeaderboardEntry[] = [];
    try { rows = await this.sim.leaderboard(); } catch { rows = []; }
    // panel may have been closed while the fetch was in flight
    if (el.style.display !== 'block') return;
    const body = el.querySelector('.lb-body')!;
    if (rows.length === 0) {
      body.innerHTML = `<div class="lb-empty">${t('game.leaderboard.empty')}</div>`;
      return;
    }
    const header = `<div class="lb-row lb-head"><span class="lb-rank">${t('game.leaderboard.rank')}</span><span class="lb-name">${t('game.leaderboard.name')}</span><span class="lb-lvl">${t('game.leaderboard.level')}</span><span class="lb-vlvl">${t('game.leaderboard.vlevel')}</span><span class="lb-xp">${t('game.leaderboard.lifetimeXp')}</span></div>`;
    const rowHtml = (r: LeaderboardEntry, mine: boolean): string => {
      const cls = CLASSES[r.cls];
      const star = r.prestigeRank > 0 ? `<span class="lb-prestige" title="${t('game.prestige.rank')} ${r.prestigeRank}">★${r.prestigeRank}</span> ` : '';
      const title = cls ? ` title="${cls.name}"` : '';
      return `<div class="lb-row${mine ? ' lb-mine' : ''}"><span class="lb-rank">${r.rank}</span>`
        + `<span class="lb-name"${title}>${star}${r.name}${mine ? ` <span class="lb-you">(${t('game.leaderboard.you')})</span>` : ''}</span>`
        + `<span class="lb-lvl">${r.level}</span><span class="lb-vlvl">${r.virtualLevel}</span><span class="lb-xp">${formatXp(r.lifetimeXp)}</span></div>`;
    };
    const mineIndex = rows.findIndex((r) => r.name === myName);
    let html = header + rows.map((r) => rowHtml(r, r.name === myName)).join('');
    // sticky "your standing" row when the viewer is outside the visible list
    if (mineIndex === -1) {
      html += `<div class="lb-sticky"><div class="lb-row lb-mine"><span class="lb-rank">—</span><span class="lb-name">${myName} <span class="lb-you">(${t('game.leaderboard.you')})</span></span><span class="lb-lvl">${this.sim.player.level}</span><span class="lb-vlvl">${virtualLevel(this.sim.lifetimeXp)}</span><span class="lb-xp">${formatXp(this.sim.lifetimeXp)}</span></div></div>`;
    }
    body.innerHTML = html;
  }

  // -------------------------------------------------------------------------
  // Spellbook
  // -------------------------------------------------------------------------

  toggleSpellbook(): void {
    const el = $('#spellbook');
    if (el.style.display === 'block') { el.style.display = 'none'; this.hideTooltip(); return; }
    this.closeOtherWindows('#spellbook');
    this.renderSpellbook();
    el.style.display = 'block';
  }

  renderSpellbook(): void {
    const el = $('#spellbook');
    const sim = this.sim;
    el.innerHTML = `<div class="panel-title"><span>Spellbook</span><span class="x-btn" data-close>${svgIcon('close')}</span></div>`;
    const cls = CLASSES[sim.cfg.playerClass];
    for (const abilityId of cls.abilities) {
      const def = ABILITIES[abilityId];
      const known = sim.known.find((k) => k.def.id === abilityId) ?? null;
      const row = document.createElement('div');
      row.className = 'spell-row';
      const locked = !known;
      row.innerHTML = `<div class="spell-icon" style="background-image:url(${iconDataUrl('ability', abilityId)});${locked ? 'filter:grayscale(1) brightness(0.5)' : ''}"></div>
        <div><div class="spell-name" style="${locked ? 'color:#777' : ''}">${def.name}${known && known.rank > 1 ? ` <span style="color:#998d6a;font-size:11px">Rank ${known.rank}</span>` : ''}</div>
        <div class="spell-sub">${locked ? `Trainable at level ${def.learnLevel}` : describeCost(known!, sim)}</div></div>`;
      if (known) {
        row.draggable = true;
        row.addEventListener('dragstart', (e) => {
          const action = { type: 'ability' as const, id: known.def.id };
          this.dragAction = { action, sourceIndex: null };
          this.writeDraggedAction(e.dataTransfer, action);
          e.dataTransfer!.effectAllowed = 'move';
          this.hideTooltip();
        });
        row.addEventListener('dragend', () => {
          this.dragAction = null;
          this.clearActionDropTargets();
        });
        this.attachTooltip(row, () => this.abilityTooltip(known));
      } else this.attachTooltip(row, () => `<div class="tt-title" style="color:#999">${def.name}</div><div class="tt-sub">You will learn this at level ${def.learnLevel}.</div>`);
      el.appendChild(row);
    }
    el.querySelector('[data-close]')?.addEventListener('click', () => { el.style.display = 'none'; this.hideTooltip(); });
  }

  // -------------------------------------------------------------------------
  // Talents & Specializations panel (bound to 'N'). Staged-edit model: the user
  // edits a local copy (talentStage), then Apply commits the whole build via the
  // server-authoritative IWorld.applyTalents (which re-validates). Class/Spec
  // tabs, shape-coded nodes (square=active, circle=passive, octagon=choice),
  // prereq arrows, dormant (red) dependents, loadouts, and import/export.
  // -------------------------------------------------------------------------

  toggleTalents(): void {
    const el = $('#talents-window');
    if (el.style.display === 'block') { el.style.display = 'none'; this.hideTooltip(); this.talentStage = null; return; }
    this.closeOtherWindows('#talents-window');
    this.talentStage = cloneAllocation(this.sim.talents);
    this.renderTalents();
    el.style.display = 'block';
  }

  private roleLabel(role: Role): string {
    return role === 'tank' ? t('game.talents.roleTank') : role === 'healer' ? t('game.talents.roleHealer') : t('game.talents.roleDps');
  }

  private keyboardActivate(e: KeyboardEvent, action: () => void): void {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    action();
  }

  // Structural equality of two allocations (ignores key order / zero ranks), so
  // the Apply button only lights up on a real change.
  private allocsEqual(a: TalentAllocation, b: TalentAllocation): boolean {
    if ((a.spec ?? null) !== (b.spec ?? null)) return false;
    const ak = Object.keys(a.ranks).filter((k) => a.ranks[k] > 0).sort();
    const bk = Object.keys(b.ranks).filter((k) => b.ranks[k] > 0).sort();
    if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i] || a.ranks[k] !== b.ranks[k])) return false;
    for (const k of ak) if ((a.choices[k] ?? null) !== (b.choices[k] ?? null)) return false;
    return true;
  }

  renderTalents(): void {
    const el = $('#talents-window');
    if (el.style.display !== 'block' && this.talentStage === null) return;
    const cls = this.sim.cfg.playerClass;
    const ct = talentsFor(cls);
    const close = `<span class="x-btn" data-close>${svgIcon('close')}</span>`;
    if (!ct) {
      el.innerHTML = `<div class="panel-title"><span>${t('game.talents.title')} <span style="color:#998d6a;font-size:11px">${esc(CLASSES[cls].name)}</span></span>${close}</div>`
        + `<div class="tal-empty tal-coming-soon" data-talents-coming-soon>`
        + `<b>${t('game.talents.comingSoonTitle')}</b>`
        + `<span>${t('game.talents.comingSoonBody')}</span>`
        + `</div>`;
      el.querySelector('[data-close]')?.addEventListener('click', () => { el.style.display = 'none'; this.hideTooltip(); });
      return;
    }
    const stage = this.talentStage ?? (this.talentStage = cloneAllocation(this.sim.talents));
    const total = this.sim.talentPoints().total;
    const spent = pointsSpent(stage);
    const treeSpent = (tree: 'class' | 'spec') => ct.nodes
      .filter((n) => n.tree === tree && (tree === 'class' || n.specId === stage.spec))
      .reduce((a, n) => a + (stage.ranks[n.id] ?? 0), 0);

    el.innerHTML =
      `<div class="panel-title"><span>${t('game.talents.title')} <span style="color:#998d6a;font-size:11px">${esc(CLASSES[cls].name)}</span></span>${close}</div>`
      + `<div class="tal-head"><span>${t('game.talents.available')}: <b>${Math.max(0, total - spent)}</b> / ${total}</span><span>${t('game.talents.spent')}: <b>${spent}</b></span></div>`
      + `<div class="tal-help">${esc(t('game.talents.pointSource').replace('{first}', String(FIRST_TALENT_LEVEL)).replace('{cap}', String(MAX_LEVEL)))}</div>`
      + `<div class="tal-tabs" role="tablist" aria-label="${esc(t('game.talents.title'))}">`
      + `<div class="tal-tab${this.talentTab === 'class' ? ' active' : ''}" role="tab" tabindex="${this.talentTab === 'class' ? '0' : '-1'}" aria-selected="${this.talentTab === 'class'}" aria-controls="tal-body" data-tab="class"><span class="tal-tab-label">${t('game.talents.classTab')}</span><span class="tt-pts">${treeSpent('class')}</span></div>`
      + `<div class="tal-tab${this.talentTab === 'spec' ? ' active' : ''}" role="tab" tabindex="${this.talentTab === 'spec' ? '0' : '-1'}" aria-selected="${this.talentTab === 'spec'}" aria-controls="tal-body" data-tab="spec"><span class="tal-tab-label">${t('game.talents.specTab')}</span><span class="tt-pts">${treeSpent('spec')}</span></div>`
      + `</div><div id="tal-body" role="tabpanel"></div>`
      + this.talentFooterHtml(stage, total, spent);

    const switchTab = (tab: HTMLElement) => {
      this.talentTab = tab.dataset.tab as 'class' | 'spec';
      this.renderTalents();
    };
    el.querySelectorAll('.tal-tab').forEach((tab) => {
      tab.addEventListener('click', () => switchTab(tab as HTMLElement));
      tab.addEventListener('keydown', (e) => this.keyboardActivate(e as KeyboardEvent, () => switchTab(tab as HTMLElement)));
    });
    el.querySelector('[data-close]')?.addEventListener('click', () => { el.style.display = 'none'; this.hideTooltip(); this.talentStage = null; });

    const body = el.querySelector('#tal-body') as HTMLElement;
    if (this.talentTab === 'class') {
      const tree = document.createElement('div'); tree.className = 'tal-tree'; body.appendChild(tree);
      this.renderTalentTree(tree, ct, stage, 'class', undefined);
    } else {
      this.renderSpecTab(body, ct, stage);
    }
    this.wireTalentFooter(el, stage, total);
  }

  private renderSpecTab(body: HTMLElement, ct: NonNullable<ReturnType<typeof talentsFor>>, stage: TalentAllocation): void {
    const picker = document.createElement('div'); picker.className = 'tal-specs';
    picker.setAttribute('role', 'radiogroup');
    picker.setAttribute('aria-label', t('game.talents.specTab'));
    for (const sp of ct.specs) {
      const card = document.createElement('div');
      const selected = stage.spec === sp.id;
      card.className = 'tal-spec' + (selected ? ' sel' : '');
      card.setAttribute('role', 'radio');
      card.setAttribute('tabindex', selected || !stage.spec ? '0' : '-1');
      card.setAttribute('aria-checked', String(selected));
      card.setAttribute('aria-label', `${sp.name}, ${this.roleLabel(sp.role)}`);
      card.innerHTML = `<div class="ts-icon" style="background-image:url(${iconDataUrl('ability', sp.signature)})"></div><div class="ts-name">${esc(sp.name)}</div><div class="ts-role">${this.roleLabel(sp.role)}</div>`;
      this.attachTooltip(card, () => `<div class="tt-title">${esc(sp.name)}</div><div class="tt-sub">${esc(sp.description)}</div>`
        + `<div class="tt-sub" style="color:#ffd100">${t('game.talents.signature')}: ${esc(ABILITIES[sp.signature]?.name ?? sp.signature)}</div>`
        + `<div class="tt-sub">${t('game.talents.mastery')}: ${esc(sp.mastery.name)} — ${esc(sp.mastery.description)}</div>`);
      card.addEventListener('click', () => this.stageSetSpec(stage, sp.id));
      card.addEventListener('keydown', (e) => this.keyboardActivate(e as KeyboardEvent, () => this.stageSetSpec(stage, sp.id)));
      picker.appendChild(card);
    }
    body.appendChild(picker);
    const sp = ct.specs.find((s) => s.id === stage.spec);
    if (!sp) { const e = document.createElement('div'); e.className = 'tal-empty'; e.textContent = t('game.talents.chooseSpec'); body.appendChild(e); return; }
    const m = document.createElement('div'); m.className = 'tal-mastery';
    m.innerHTML = `<b>${t('game.talents.mastery')}: ${esc(sp.mastery.name)}</b> — ${esc(sp.mastery.description)}`;
    body.appendChild(m);
    const tree = document.createElement('div'); tree.className = 'tal-tree'; body.appendChild(tree);
    this.renderTalentTree(tree, ct, stage, 'spec', sp.id);
  }

  private stageSetSpec(stage: TalentAllocation, specId: string): void {
    if (stage.spec === specId) return;
    stage.spec = specId;
    const ct = talentsFor(this.sim.cfg.playerClass);
    for (const id of Object.keys(stage.ranks)) {
      const n = ct?.nodes.find((x) => x.id === id);
      if (n?.tree === 'spec' && n.specId !== specId) { delete stage.ranks[id]; delete stage.choices[id]; }
    }
    this.renderTalents();
  }

  private renderTalentTree(host: HTMLElement, ct: NonNullable<ReturnType<typeof talentsFor>>, stage: TalentAllocation, tree: 'class' | 'spec', specId: string | undefined): void {
    const cls = this.sim.cfg.playerClass;
    const nodes = ct.nodes.filter((n) => n.tree === tree && (tree === 'class' || n.specId === specId));
    if (nodes.length === 0) { host.innerHTML = `<div class="tal-empty">${t('game.talents.pickSpecFirst')}</div>`; return; }
    const cols = Math.max(...nodes.map((n) => n.col)) + 1;
    const rows = Math.max(...nodes.map((n) => n.row)) + 1;
    const CW = 86, CH = 70, NS = 46, TOP = 6;
    const W = cols * CW, H = rows * CH + TOP;
    host.style.width = `${W}px`; host.style.height = `${H}px`;
    const cx = (n: TalentNode) => n.col * CW + CW / 2;
    const cy = (n: TalentNode) => n.row * CH + TOP + NS / 2;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const dormant = dormantNodes(cls, stage);
    const total = this.sim.talentPoints().total;

    let svg = `<svg class="tal-arrows" width="${W}" height="${H}">`;
    for (const n of nodes) for (const req of n.requires ?? []) {
      const r = byId.get(req); if (!r) continue;
      const filled = (stage.ranks[req] ?? 0) > 0;
      svg += `<line x1="${cx(r)}" y1="${cy(r) + NS / 2}" x2="${cx(n)}" y2="${cy(n) - NS / 2}" stroke="${filled ? '#f5c843' : '#5a4a22'}" stroke-width="2"/>`;
    }
    host.insertAdjacentHTML('beforeend', svg + `</svg>`);

    for (const n of nodes) {
      const ranks = stage.ranks[n.id] ?? 0;
      const isDormant = dormant.has(n.id);
      const cand = cloneAllocation(stage);
      cand.ranks[n.id] = ranks + 1;
      if (n.kind === 'choice' && !cand.choices[n.id]) cand.choices[n.id] = n.choices![0].id;
      const canAdd = ranks < n.maxRank && validateAllocation(cls, cand, total).ok;
      const shape = n.kind === 'active' ? 'square' : n.kind === 'choice' ? 'octagon' : 'circle';
      const state = isDormant ? 'dormant' : ranks >= n.maxRank ? 'maxed' : ranks > 0 ? 'filled' : canAdd ? 'avail' : 'locked';
      const chosen = n.kind === 'choice' ? n.choices!.find((c) => c.id === stage.choices[n.id]) : undefined;
      const div = document.createElement('div');
      div.className = `tal-node ${shape} ${state}`;
      div.setAttribute('role', 'button');
      div.setAttribute('tabindex', '0');
      div.setAttribute('aria-pressed', String(ranks > 0));
      if (!canAdd && ranks <= 0) div.setAttribute('aria-disabled', 'true');
      const chosenLabel = chosen ? `, ${chosen.name}` : '';
      div.setAttribute('aria-label', `${n.name}${chosenLabel}, ${t('game.talents.rank')} ${ranks}/${n.maxRank}`);
      div.style.left = `${n.col * CW + (CW - NS) / 2}px`;
      div.style.top = `${n.row * CH + TOP}px`;
      const icon = document.createElement('span');
      icon.className = 'tal-icon';
      icon.style.backgroundImage = `url(${chosen ? talentEffectIcon(chosen.effect, 'choice') : talentEffectIcon(n.effect, n.kind)})`;
      div.appendChild(icon);
      if (ranks > 0 || n.maxRank > 1) {
        const badge = document.createElement('span'); badge.className = 'tal-rank'; badge.textContent = `${ranks}/${n.maxRank}`;
        div.appendChild(badge);
      }
      this.attachTooltip(div, () => this.talentTooltip(n, stage, isDormant));
      div.addEventListener('click', () => {
        // octagon choice nodes open a WoW-style option flyout; others add a rank
        if (n.kind === 'choice') this.openChoicePopup(div, n, stage);
        else this.talentNodeClick(stage, n);
      });
      div.addEventListener('keydown', (e) => {
        const ke = e as KeyboardEvent;
        if (ke.key === 'Backspace' || ke.key === 'Delete') {
          ke.preventDefault();
          this.talentNodeRemove(stage, n);
          return;
        }
        this.keyboardActivate(ke, () => {
          if (n.kind === 'choice') this.openChoicePopup(div, n, stage);
          else this.talentNodeClick(stage, n);
        });
      });
      div.addEventListener('contextmenu', (e) => { e.preventDefault(); this.talentNodeRemove(stage, n); });
      host.appendChild(div);
    }
  }

  private talentNodeClick(stage: TalentAllocation, n: TalentNode): void {
    const cls = this.sim.cfg.playerClass;
    const total = this.sim.talentPoints().total;
    const ranks = stage.ranks[n.id] ?? 0;
    if (ranks >= n.maxRank) return;
    const cand = cloneAllocation(stage); cand.ranks[n.id] = ranks + 1;
    if (!validateAllocation(cls, cand, total).ok) return;
    stage.ranks[n.id] = ranks + 1;
    this.renderTalents();
  }

  private talentNodeRemove(stage: TalentAllocation, n: TalentNode): void {
    const ranks = stage.ranks[n.id] ?? 0;
    if (ranks <= 0) return;
    if (ranks - 1 <= 0) { delete stage.ranks[n.id]; delete stage.choices[n.id]; }
    else stage.ranks[n.id] = ranks - 1;
    this.renderTalents();
  }

  private talentTooltip(n: TalentNode, stage: TalentAllocation, isDormant: boolean): string {
    const ranks = stage.ranks[n.id] ?? 0;
    let html = `<div class="tt-title">${esc(n.name)}</div><div class="tt-sub">${esc(n.description)}</div>`;
    if (n.kind === 'choice') {
      for (const o of n.choices!) {
        const sel = stage.choices[n.id] === o.id;
        html += `<div class="tt-sub" style="color:${sel ? '#ffd100' : '#aaa'}"><img class="tt-opt-icon" src="${talentEffectIcon(o.effect, 'passive')}" alt=""> ${esc(o.name)} — ${esc(o.description)}</div>`;
      }
      html += `<div class="tt-sub" style="color:#8aa">${t('game.talents.cycleHint')}</div>`;
    } else {
      html += `<div class="tt-sub">${t('game.talents.rank')} ${ranks}/${n.maxRank}</div>`;
    }
    const ct = talentsFor(this.sim.cfg.playerClass);
    if (n.requires?.length) {
      const names = n.requires.map((r) => ct?.nodes.find((x) => x.id === r)?.name ?? r).join(', ');
      html += `<div class="tt-sub" style="color:#caa">${t('game.talents.requires')}: ${esc(names)}</div>`;
    }
    if (n.pointsGate) html += `<div class="tt-sub" style="color:#caa">${n.pointsGate} ${t('game.talents.pointsGate')}</div>`;
    if (isDormant) html += `<div class="tt-sub" style="color:#e0635a">${t('game.talents.dormant')}</div>`;
    html += `<div class="tt-sub" style="color:#8aa">${t('game.talents.editHint')}</div>`;
    return html;
  }

  private talentFooterHtml(stage: TalentAllocation, total: number, spent: number): string {
    const cls = this.sim.cfg.playerClass;
    const valid = validateAllocation(cls, stage, total).ok;
    return `<div class="tal-foot">`
      + `<section class="tal-build-card tal-build-current" aria-label="${esc(t('game.talents.currentBuild'))}">`
      + `<div class="tal-build-head"><span>${t('game.talents.currentBuild')}</span><span class="tal-loadslot"></span></div>`
      + `<div class="tal-build-actions">`
      + `<button class="btn tal-primary" data-act="save"${valid ? '' : ' disabled'}>${t('game.talents.saveBuild')}</button>`
      + `<button class="btn tal-secondary" data-act="export">${t('game.talents.export')}</button>`
      + `<button class="btn tal-secondary" data-act="del"${this.sim.activeLoadout >= 0 ? '' : ' disabled'}>${t('game.talents.deleteBuild')}</button>`
      + `<button class="btn tal-secondary" data-act="clear"${spent > 0 ? '' : ' disabled'}>${t('game.talents.clear')}</button>`
      + `</div>`
      + `<div class="tal-build-help">${t('game.talents.currentBuildHint')}</div>`
      + `</section>`
      + `<section class="tal-build-card tal-build-create" aria-label="${esc(t('game.talents.createBuild'))}">`
      + `<div class="tal-build-head"><span>${t('game.talents.createBuild')}</span></div>`
      + `<div class="tal-build-actions">`
      + `<button class="btn tal-primary" data-act="new"${valid ? '' : ' disabled'}>${t('game.talents.newBuild')}</button>`
      + `<button class="btn tal-secondary" data-act="import">${t('game.talents.import')}</button>`
      + `</div>`
      + `<div class="tal-build-help">${t('game.talents.createBuildHint')}</div>`
      + `</section>`
      + `</div>`;
  }

  private wireTalentFooter(el: HTMLElement, stage: TalentAllocation, total: number): void {
    const cls = this.sim.cfg.playerClass;
    el.querySelector('[data-act="clear"]')?.addEventListener('click', () => {
      stage.ranks = {}; stage.choices = {};
      this.renderTalents();
    });
    const saveStagedBuild = (name: string): void => {
      const n = name.trim();
      if (!n) return;
      this.sim.saveLoadout(n, this.hotbarActions.map((a) => (a && a.type === 'ability' ? a.id : null)), cloneAllocation(stage));
      this.talentStage = cloneAllocation(stage);
      this.renderTalents();
    };
    const promptNewBuild = (): void => {
      this.inputDialog({
        title: t('game.talents.saveBuildAs'), label: t('game.talents.namePrompt'),
        value: `Build ${this.sim.loadouts.length + 1}`, okText: t('game.talents.save'),
        selectText: true,
        onOk: saveStagedBuild,
      });
    };
    el.querySelector('[data-act="save"]')?.addEventListener('click', () => {
      if (!validateAllocation(cls, stage, total).ok) {
        this.showError(t('game.talents.buildInvalid'));
        return;
      }
      const active = this.sim.activeLoadout >= 0 ? this.sim.loadouts[this.sim.activeLoadout] : null;
      if (active) saveStagedBuild(active.name);
      else promptNewBuild();
    });
    el.querySelector('[data-act="new"]')?.addEventListener('click', () => {
      if (!validateAllocation(cls, stage, total).ok) {
        this.showError(t('game.talents.buildInvalid'));
        return;
      }
      promptNewBuild();
    });
    // in-app loadout dropdown (shared component, no native <select>)
    const slot = el.querySelector('.tal-loadslot');
    if (slot) {
      const opts = this.sim.loadouts.length
        ? this.sim.loadouts.map((l, i) => ({ value: String(i), label: l.name }))
        : [{ value: '-1', label: t('game.talents.noBuilds') }];
      const current = this.sim.activeLoadout >= 0 ? String(this.sim.activeLoadout) : (this.sim.loadouts.length ? '' : '-1');
      slot.replaceWith(this.buildDropdown(opts, current, (v) => {
        const i = parseInt(v, 10);
        const lo = this.sim.loadouts[i];
        if (!lo) return;
        this.sim.switchLoadout(i);
        this.applyLoadoutBar(lo.bar);
        this.talentStage = cloneAllocation(lo.alloc);
        this.renderTalents();
      }, t('game.talents.loadouts')));
    }
    el.querySelector('[data-act="del"]')?.addEventListener('click', () => {
      if (this.sim.activeLoadout < 0) { this.showError(t('game.talents.selectBuildFirst')); return; }
      const active = this.sim.loadouts[this.sim.activeLoadout];
      if (!active) { this.showError(t('game.talents.selectBuildFirst')); return; }
      const body = esc(t('game.talents.deleteBuildBody').replace('{name}', active.name));
      this.confirmDialog(t('game.talents.deleteBuildTitle'), body, t('game.talents.deleteBuildConfirm'), t('game.talents.cancel'), () => {
        this.sim.deleteLoadout(this.sim.activeLoadout);
        this.renderTalents();
      });
    });
    el.querySelector('[data-act="export"]')?.addEventListener('click', () => {
      const active = this.sim.activeLoadout >= 0 ? this.sim.loadouts[this.sim.activeLoadout] : null;
      this.inputDialog({
        title: t('game.talents.export'), label: t('game.talents.exportTitle'),
        value: exportBuild(cls, active?.alloc ?? stage), multiline: true, readOnly: true,
        copy: true, cancelText: t('game.talents.close'),
      });
    });
    el.querySelector('[data-act="import"]')?.addEventListener('click', () => {
      this.inputDialog({
        title: t('game.talents.import'), label: t('game.talents.importPrompt'),
        placeholder: 'eyJ2Ijox…', multiline: true, okText: t('game.talents.import'),
        onOk: (str) => {
          const res = importBuild(str.trim());
          if (!res.ok || res.cls !== cls) { this.showError(t('game.talents.invalidBuild')); return; }
          this.talentStage = res.alloc;
          this.renderTalents();
        },
      });
    });
  }

  // Restore a saved loadout's action bar into the per-class slot map (reuses the
  // existing hotbar persistence; only places ids that resolve to real abilities).
  private applyLoadoutBar(bar: (string | null)[]): void {
    this.hotbarActions = Array.from({ length: Hud.BAR_ABILITY_SLOTS }, (_, i) => {
      const v = bar[i];
      return typeof v === 'string' && ABILITIES[v] ? { type: 'ability' as const, id: v } : null;
    });
    this.saveSlotMap();
  }

  // -------------------------------------------------------------------------
  // Quest log window
  // -------------------------------------------------------------------------

  toggleQuestLog(): void {
    const el = $('#quest-log-window');
    if (el.style.display === 'block') { el.style.display = 'none'; this.hideTooltip(); return; }
    this.closeOtherWindows('#quest-log-window');
    this.renderQuestLog();
    el.style.display = 'block';
  }

  renderQuestLog(): void {
    const el = $('#quest-log-window');
    const sim = this.sim;
    el.innerHTML = `<div class="panel-title"><span>Quest Log <span style="color:#998d6a;font-size:11px">${sim.questLog.size} active &middot; ${sim.questsDone.size} completed</span></span><span class="x-btn" data-close>${svgIcon('close')}</span></div>`;
    const cols = document.createElement('div');
    cols.className = 'ql-cols';
    const list = document.createElement('div');
    list.className = 'ql-list';
    const detail = document.createElement('div');
    detail.className = 'ql-detail';
    cols.append(list, detail);
    el.appendChild(cols);

    const quests = [...sim.questLog.values()];
    if (quests.length === 0) {
      list.innerHTML = '<div style="color:#887c5c;font-size:12px;padding:4px">No active quests.</div>';
      detail.innerHTML = '<div class="qd-text">Seek out townsfolk marked with <span class="gold">!</span> to find work.</div>';
    }
    if (!this.selectedQuestLogId || !sim.questLog.has(this.selectedQuestLogId)) {
      this.selectedQuestLogId = quests[0]?.questId ?? null;
    }
    for (const qp of quests) {
      const quest = QUESTS[qp.questId];
      const item = document.createElement('div');
      item.className = 'ql-item' + (qp.questId === this.selectedQuestLogId ? ' sel' : '');
      item.textContent = `${quest.name}${qp.state === 'ready' ? ' ✓' : ''}`;
      item.addEventListener('click', () => { this.selectedQuestLogId = qp.questId; this.renderQuestLog(); });
      list.appendChild(item);
    }
    if (this.selectedQuestLogId) {
      const qp = sim.questLog.get(this.selectedQuestLogId)!;
      const quest = QUESTS[this.selectedQuestLogId];
      let html = `<div class="qd-sub" style="font-size:15px">${quest.name}${quest.suggestedPlayers ? ` <span style="color:#f96;font-size:11px">(Suggested players: ${quest.suggestedPlayers})</span>` : ''}</div>`;
      html += quest.objectives.map((o, i) => `<div class="qd-obj" style="color:${qp.counts[i] >= o.count ? '#7fdc4f' : '#cfc6a8'}">&bull; ${o.label}: ${qp.counts[i]}/${o.count}</div>`).join('');
      html += `<div class="qd-text" style="margin-top:8px">${quest.text.replace(/\$N/g, sim.player.name)}</div>`;
      html += `<div class="qd-sub">Rewards</div><div class="qd-obj">${quest.xpReward} experience &nbsp; ${this.moneyHtml(quest.copperReward)}</div>`;
      const logReward = questRewardItem(quest, this.sim.cfg.playerClass);
      if (logReward) {
        const ri = ITEMS[logReward];
        html += `<div class="qd-obj" style="color:${QUALITY_COLOR[ri.quality ?? 'common'] ?? '#fff'}">&bull; ${ri.name}</div>`;
      }
      const giver = NPCS[quest.turnInNpcId];
      html += `<div class="qd-obj" style="margin-top:6px;color:#998d6a">Return to ${giver?.name ?? '?'}</div>`;
      detail.innerHTML = html;
      const abandon = document.createElement('button');
      abandon.className = 'btn';
      abandon.textContent = 'Abandon Quest';
      abandon.addEventListener('click', () => { sim.abandonQuest(this.selectedQuestLogId!); this.renderQuestLog(); });
      detail.appendChild(abandon);
    }
    el.querySelector('[data-close]')?.addEventListener('click', () => { el.style.display = 'none'; });
  }

  // -------------------------------------------------------------------------
  // Party frames
  // -------------------------------------------------------------------------

  private updatePartyFrames(): void {
    const el = $('#party-frames');
    const target = this.sim.player.targetId !== null ? this.sim.entities.get(this.sim.player.targetId) : null;
    el.classList.toggle('below-target', !!target && target.kind !== 'object');
    const info = this.sim.partyInfo;
    if (!info) {
      if (el.innerHTML !== '') el.innerHTML = '';
      this.lastPartySig = '';
      return;
    }
    const p = this.sim.player;
    const others = info.members.map((m) => ({
      ...m,
      oor: !m.dead && Math.hypot(m.x - p.pos.x, m.z - p.pos.z) > PARTY_RANGE_YD,
    })).filter((m) => m.pid !== this.sim.playerId);
    // include combat/range state so the frames rebuild when a badge changes
    const sig = others.map((m) => `${m.pid}:${m.hp}/${m.mhp}:${m.res}:${m.dead}:${m.inCombat}:${m.oor ? 1 : 0}:${m.level}`).join('|') + `L${info.leader}`;
    if (sig === this.lastPartySig) return;
    this.lastPartySig = sig;
    el.innerHTML = '';
    for (const m of others) {
      const frame = document.createElement('div');
      frame.className = 'party-frame panel'
        + (m.dead ? ' dead' : m.inCombat ? ' combat' : '')
        + (m.oor ? ' oor' : '');
      frame.style.setProperty('--cls', classCss(m.cls));
      const resClass = m.rtype === 'rage' ? 'rage' : m.rtype === 'energy' ? 'energy' : 'mana';
      const badge = m.dead ? `<span class="pf-badge dead" title="Dead">${svgIcon('skull')}</span>`
        : m.inCombat ? `<span class="pf-badge combat" title="In combat">${svgIcon('arena')}</span>` : '';
      const range = m.oor ? '<span class="pf-badge oor" title="Out of range">⤢</span>' : '';
      const crest = m.cls ? `<img class="pfm-crest" src="${iconDataUrl('crest', `class_${m.cls}`, 20)}" alt="">` : '';
      frame.innerHTML = `
        <div class="pfm-name"><span class="pfm-id">${crest}${esc(m.name)}</span><span class="pfm-meta">${badge}${range}<span class="lead">${info.leader === m.pid ? '★' : ''}${m.level}</span></span></div>
        <div class="bar hp"><div class="bar-fill" style="transform:scaleX(${(m.hp / Math.max(1, m.mhp)).toFixed(3)})"></div></div>
        <div class="bar ${resClass}"><div class="bar-fill" style="transform:scaleX(${(m.res / Math.max(1, m.mres)).toFixed(3)})"></div></div>`;
      frame.addEventListener('click', () => this.sim.targetEntity(m.pid));
      frame.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        this.openContextMenu(m.pid, m.name, ev.clientX, ev.clientY);
      });
      el.appendChild(frame);
    }
    const leave = document.createElement('button');
    leave.className = 'btn';
    leave.id = 'party-leave';
    leave.textContent = 'Leave Party';
    leave.addEventListener('click', () => this.sim.partyLeave());
    el.appendChild(leave);
  }

  // -------------------------------------------------------------------------
  // Context menu on players
  // -------------------------------------------------------------------------

  openContextMenu(pid: number, name: string, x: number, y: number): void {
    const el = $('#ctx-menu');
    const party = this.sim.partyInfo;
    const isLeader = party?.leader === this.sim.playerId;
    const isMember = !!party?.members.some((m) => m.pid === pid);
    // online play exposes persistent friends/ignore/guild; offline falls back
    // to the client-only chat ignore stored in localStorage
    const online = this.sim.socialInfo !== null;
    const social = this.sim.socialInfo;
    const isFriend = !!social?.friends.some((f) => f.name === name);
    const inGuildWithInvite = !!social?.guild && social.guild.rank !== 'member';
    const alreadyGuilded = !!social?.guild?.members.some((m) => m.name === name);
    const ignored = online
      ? !!social?.blocks.some((b) => b.name === name)
      : this.isChatIgnored(name);
    let html = `<div class="ctx-title">${esc(name)}</div>`;
    if (!isMember) html += `<div class="ctx-item" data-act="invite">Invite to Party</div>`;
    html += `<div class="ctx-item" data-act="trade">Trade</div>`;
    html += `<div class="ctx-item" data-act="duel">Challenge to a Duel</div>`;
    if (online) html += `<div class="ctx-item" data-act="${isFriend ? 'unfriend' : 'friend'}">${isFriend ? 'Remove Friend' : 'Add Friend'}</div>`;
    if (inGuildWithInvite && !alreadyGuilded) html += `<div class="ctx-item" data-act="ginvite">Invite to Guild</div>`;
    html += `<div class="ctx-item" data-act="ignore">${ignored ? 'Unignore' : 'Ignore'}${online ? '' : ' Chat'}</div>`;
    if (this.reportHooks && pid !== this.sim.playerId) html += `<div class="ctx-item" data-act="report">Report Player</div>`;
    if (isLeader && isMember && pid !== this.sim.playerId) html += `<div class="ctx-item" data-act="kick">Remove from Party</div>`;
    html += `<div class="ctx-item" data-act="close">Cancel</div>`;
    el.innerHTML = html;
    el.style.left = `${Math.min(window.innerWidth - 170, x)}px`;
    el.style.top = `${Math.min(window.innerHeight - 240, y)}px`;
    el.style.display = 'block';
    el.querySelectorAll('.ctx-item').forEach((item) => {
      item.addEventListener('click', () => {
        const act = (item as HTMLElement).dataset.act;
        el.style.display = 'none';
        if (act === 'invite') this.sim.partyInvite(pid);
        else if (act === 'trade') this.sim.tradeRequest(pid);
        else if (act === 'duel') this.sim.duelRequest(pid);
        else if (act === 'friend') this.sim.friendAdd(name);
        else if (act === 'unfriend') this.sim.friendRemove(name);
        else if (act === 'ginvite') this.sim.guildInvite(name);
        else if (act === 'ignore') {
          if (online) { ignored ? this.sim.blockRemove(name) : this.sim.blockAdd(name); }
          else this.toggleChatIgnore(name);
        } else if (act === 'report') this.openReportWindow({ pid, name });
        else if (act === 'kick') this.sim.partyKick(pid);
      });
    });
  }

  // Raid/target marker picker for an enemy, opened from its target unit frame.
  // Party-only (markers are a coordination feature); shows the 8 symbols with a
  // check on the one currently on this mob, plus Clear and Cancel.
  openMarkerMenu(entityId: number, name: string, x: number, y: number): void {
    if (!this.sim.partyInfo) return;
    const el = $('#ctx-menu');
    const current = this.sim.markerFor(entityId);
    let html = `<div class="ctx-title">${esc(name)}</div>`;
    for (let i = 0; i < RAID_MARKER_NAMES.length; i++) {
      const check = current === i ? ' ✓' : '';
      html += `<div class="ctx-item" data-act="m${i}"><span class="ctx-mark" style="background-image:url(${raidMarkerDataUrl(i)})"></span>${RAID_MARKER_NAMES[i]}${check}</div>`;
    }
    html += `<div class="ctx-item" data-act="clear">Clear Marker</div>`;
    html += `<div class="ctx-item" data-act="close">Cancel</div>`;
    el.innerHTML = html;
    el.style.left = `${Math.min(window.innerWidth - 170, x)}px`;
    el.style.top = `${Math.min(window.innerHeight - 340, y)}px`;
    el.style.display = 'block';
    el.querySelectorAll('.ctx-item').forEach((item) => {
      item.addEventListener('click', () => {
        const act = (item as HTMLElement).dataset.act;
        el.style.display = 'none';
        if (act === 'clear') this.sim.clearMarker(entityId);
        else if (act && act.startsWith('m')) this.sim.setMarker(entityId, Number(act.slice(1)));
      });
    });
  }

  private openChatPlayerContextMenu(name: string, x: number, y: number): void {
    const el = $('#ctx-menu');
    const online = this.sim.socialInfo !== null;
    const social = this.sim.socialInfo;
    const isFriend = !!social?.friends.some((f) => f.name === name);
    const canGuildInvite = !!social?.guild && social.guild.rank !== 'member';
    const alreadyGuilded = !!social?.guild?.members.some((m) => m.name === name);
    const ignored = online
      ? !!social?.blocks.some((b) => b.name === name)
      : this.isChatIgnored(name);
    const actions = chatPlayerContextActions({
      playerName: name,
      selfName: this.sim.player.name,
      online,
      isFriend,
      ignored,
      canGuildInvite,
      alreadyGuilded,
      canReport: !!this.reportHooks?.submitByName,
    });
    el.innerHTML = `<div class="ctx-title">${esc(name)}</div>`
      + actions.map((a) => `<div class="ctx-item" data-act="${a.id}">${esc(a.label)}</div>`).join('');
    el.style.left = `${Math.min(window.innerWidth - 170, x)}px`;
    el.style.top = `${Math.min(window.innerHeight - 240, y)}px`;
    el.style.display = 'block';
    el.querySelectorAll('.ctx-item').forEach((item) => {
      item.addEventListener('click', () => {
        const act = (item as HTMLElement).dataset.act;
        el.style.display = 'none';
        const livePid = this.playerPidByName(name);
        if (act === 'whisper') this.startWhisper(name);
        else if (act === 'invite') {
          if (livePid !== null) this.sim.partyInvite(livePid);
          else this.showError('That player is not nearby.');
        } else if (act === 'friend') this.sim.friendAdd(name);
        else if (act === 'unfriend') this.sim.friendRemove(name);
        else if (act === 'ginvite') this.sim.guildInvite(name);
        else if (act === 'ignore') {
          if (online) { ignored ? this.sim.blockRemove(name) : this.sim.blockAdd(name); }
          else this.toggleChatIgnore(name);
        } else if (act === 'report') this.openReportWindow({ name });
      });
    });
  }

  private playerPidByName(name: string): number | null {
    const wanted = name.toLowerCase();
    for (const e of this.sim.entities.values()) {
      if (e.kind === 'player' && e.name.toLowerCase() === wanted) return e.id;
    }
    return null;
  }

  private openReportWindow(target: { pid?: number; name: string }): void {
    if (!this.reportHooks) return;
    this.closeOtherWindows('#report-window');
    const { pid, name } = target;
    const el = $('#report-window');
    el.innerHTML = `
      <div class="panel-title"><span>Report ${esc(name)}</span><span class="x-btn" data-close>${svgIcon('close')}</span></div>
      <label class="report-label">Reason</label>
      <div id="report-reason-slot"></div>
      <label class="report-label">Details</label>
      <textarea id="report-details" maxlength="1000" placeholder="What happened?"></textarea>
      <div class="report-error" id="report-error"></div>
      <div class="report-actions">
        <button class="btn" id="report-submit">Submit Report</button>
        <button class="btn" data-close>Cancel</button>
      </div>`;
    el.style.display = 'block'; // centred by the shared .window rule
    const reasonDD = this.buildDropdown([
      { value: 'harassment', label: 'Harassment / abuse' },
      { value: 'spam', label: 'Spam' },
      { value: 'cheating', label: 'Cheating / exploit' },
      { value: 'offensive_name_or_chat', label: 'Offensive name or chat' },
      { value: 'other', label: 'Other' },
    ], 'harassment');
    el.querySelector('#report-reason-slot')?.replaceWith(reasonDD);
    el.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', () => { el.style.display = 'none'; }));
    const submit = $('#report-submit') as HTMLButtonElement;
    submit.addEventListener('click', () => {
      const reason = reasonDD.dataset.value ?? 'other';
      const details = ($('#report-details') as HTMLTextAreaElement).value;
      submit.disabled = true;
      const request = pid !== undefined
        ? this.reportHooks!.submit(pid, reason, details)
        : this.reportHooks!.submitByName?.(name, reason, details);
      if (!request) {
        $('#report-error').textContent = 'Could not submit report.';
        return;
      }
      request
        .then(() => {
          el.style.display = 'none';
          this.log(`Report submitted for ${name}.`, '#ffd100');
        })
        .catch((err: unknown) => {
          submit.disabled = false;
          $('#report-error').textContent = err instanceof Error ? err.message : 'Could not submit report.';
        });
    });
  }

  private chatIgnoreKey(name: string): string {
    return name.trim().toLowerCase();
  }

  private isChatIgnored(name: string): boolean {
    return this.ignoredChatNames.has(this.chatIgnoreKey(name));
  }

  private loadIgnoredChatNames(): Set<string> {
    try {
      const raw = localStorage.getItem(IGNORED_CHAT_NAMES_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? parsed.filter((name): name is string => typeof name === 'string') : []);
    } catch {
      return new Set();
    }
  }

  private saveIgnoredChatNames(): void {
    localStorage.setItem(IGNORED_CHAT_NAMES_KEY, JSON.stringify([...this.ignoredChatNames]));
  }

  private toggleChatIgnore(name: string): void {
    const key = this.chatIgnoreKey(name);
    if (!key) return;
    if (this.ignoredChatNames.has(key)) {
      this.ignoredChatNames.delete(key);
      this.log(`No longer ignoring ${name}.`, '#aaf');
    } else {
      this.ignoredChatNames.add(key);
      this.log(`Ignoring chat from ${name}.`, '#aaf');
    }
    this.saveIgnoredChatNames();
  }

  closeContextMenu(): void {
    $('#ctx-menu').style.display = 'none';
  }

  // -------------------------------------------------------------------------
  // Social panel: friends / guild / ignore (online play)
  // -------------------------------------------------------------------------

  toggleSocial(): void {
    const el = $('#social-window');
    if (el.classList.contains('open')) { el.classList.remove('open'); return; }
    this.closeOtherWindows('#social-window');
    el.classList.add('open');
    this.socialNotice = null;
    this.lastSocialStruct = this.socialStructSig();
    this.lastSocialContent = JSON.stringify(this.sim.socialInfo);
    this.renderSocial();
  }

  // structural identity of the panel: which tab, online or not, and the guild
  // membership/rank (which changes the footer). Content within a tab — a
  // friend's zone, the roster — doesn't count, so it can refresh in place.
  private socialStructSig(): string {
    const g = this.sim.socialInfo?.guild;
    return `${this.socialTab}|${this.sim.socialInfo !== null}|${g?.id ?? 0}|${g?.rank ?? ''}`;
  }

  // Full rebuild: title, tabs, body, notice, and the tab's footer (with its
  // typeahead). Used on open, tab switch, and guild-membership changes.
  private renderSocial(): void {
    const el = $('#social-window');
    if (!el.classList.contains('open')) return;
    const tab = this.socialTab;
    const online = this.sim.socialInfo !== null;
    const realmTag = online && this.sim.realm ? ` <span class="soc-realm-tag">— ${esc(this.sim.realm)}</span>` : '';
    el.innerHTML = `<div class="panel-title"><span>Social${realmTag}</span><span class="x-btn" data-close>${svgIcon('close')}</span></div>`
      + `<div class="soc-tabs">`
      + `<div class="soc-tab ${tab === 'friends' ? 'on' : ''}" data-tab="friends">Friends</div>`
      + `<div class="soc-tab ${tab === 'guild' ? 'on' : ''}" data-tab="guild">Guild</div>`
      + `<div class="soc-tab ${tab === 'ignore' ? 'on' : ''}" data-tab="ignore">Ignore</div>`
      + `</div>`
      + `<div class="soc-body"></div>`
      + `<div class="soc-notice"></div>`
      + (online ? this.socialFooter() : '');
    this.wireSocialChrome(el);
    this.refreshSocialList();
    this.renderSocialNotice();
  }

  // Lighter refresh: just the list inside the current tab, leaving the footer
  // (and any half-typed name / open suggestions) untouched.
  private refreshSocialList(): void {
    const body = $('#social-window').querySelector('.soc-body') as HTMLElement | null;
    if (!body) return;
    const online = this.sim.socialInfo !== null;
    body.innerHTML = !online
      ? `<div class="soc-empty">Friends, guilds, and ignore lists are available in online play.</div>`
      : this.socialTab === 'friends' ? this.friendsHtml()
        : this.socialTab === 'guild' ? this.guildHtml()
          : this.ignoreHtml();
    this.wireSocialRows(body);
  }

  private friendsHtml(): string {
    const friends = this.sim.socialInfo?.friends ?? [];
    if (friends.length === 0) return `<div class="soc-empty">No friends yet. Search for someone by name below.</div>`;
    return friends.map((f) => {
      const dot = f.online ? (f.status ?? 'online') : 'off';
      const meta = f.online
        ? `<span class="zone">${esc(f.zone ?? '')}</span><br>${statusLabel(f.status)}`
        : 'Offline';
      const name = f.online
        ? `<span class="soc-name soc-link" data-whisper="${esc(f.name)}" title="Whisper ${esc(f.name)}">${esc(f.name)}</span>`
        : `<span class="soc-name">${esc(f.name)}</span>`;
      const whisper = f.online ? `<span class="soc-x" data-whisper="${esc(f.name)}" title="Whisper ${esc(f.name)}">${svgIcon('whisper')}</span>` : '';
      const tip = esc(dotTitle(f.online, f.status, f.zone));
      return `<div class="soc-row">`
        + `<span class="soc-dot ${dot === 'off' ? '' : dot}" title="${tip}"></span>`
        + `<span class="soc-id">${name}<span class="soc-sub">Lvl ${f.level} ${cap(f.cls)}</span></span>`
        + `<span class="soc-meta" title="${tip}">${meta}</span>`
        + `<span class="soc-actions">${whisper}<span class="soc-x" data-act="unfriend" data-name="${esc(f.name)}" title="Remove ${esc(f.name)} from friends">${svgIcon('close')}</span></span>`
        + `</div>`;
    }).join('');
  }

  private ignoreHtml(): string {
    const blocks = this.sim.socialInfo?.blocks ?? [];
    if (blocks.length === 0) return `<div class="soc-empty">Your ignore list is empty.</div>`;
    return blocks.map((b) => `<div class="soc-row">`
      + `<span class="soc-name">${esc(b.name)}</span>`
      + `<span class="soc-actions" style="margin-left:auto"><span class="soc-x" data-act="unblock" data-name="${esc(b.name)}" title="Stop ignoring ${esc(b.name)}">${svgIcon('close')}</span></span>`
      + `</div>`).join('');
  }

  private guildHtml(): string {
    const guild = this.sim.socialInfo?.guild ?? null;
    if (!guild) return `<div class="soc-empty">You are not in a guild. Found one below, or get invited by an existing guild.</div>`;
    const me = guild.rank;
    const head = `<div class="soc-guild-head">&lt;${esc(guild.name)}&gt; <span class="gm">— you are ${rankLabel(me)} &middot; ${guild.members.length} member${guild.members.length === 1 ? '' : 's'}</span></div>`;
    const rows = guild.members.map((m) => {
      const dot = m.online ? (m.status ?? 'online') : 'off';
      const meta = m.online
        ? `<span class="zone">${esc(m.zone ?? '')}</span><br>${statusLabel(m.status)}`
        : 'Offline';
      const self = m.name === this.sim.player.name;
      const nameInner = `${esc(m.name)}<span class="rank">${rankLabel(m.rank)}</span>`;
      const name = m.online && !self
        ? `<span class="soc-name soc-link" data-whisper="${esc(m.name)}" title="Whisper ${esc(m.name)}">${nameInner}</span>`
        : `<span class="soc-name">${nameInner}</span>`;
      let actions = m.online && !self ? `<span class="soc-x" data-whisper="${esc(m.name)}" title="Whisper ${esc(m.name)}">${svgIcon('whisper')}</span>` : '';
      if (!self && me === 'leader') actions += `<span class="soc-x" data-act="gtransfer" data-name="${esc(m.name)}" title="Make ${esc(m.name)} Guild Master">${svgIcon('crown')}</span>`;
      if (!self && me === 'leader' && m.rank === 'member') actions += `<span class="soc-x" data-act="promote" data-name="${esc(m.name)}" title="Promote ${esc(m.name)} to officer">▲</span>`;
      if (!self && me === 'leader' && m.rank === 'officer') actions += `<span class="soc-x" data-act="demote" data-name="${esc(m.name)}" title="Demote ${esc(m.name)} to member">▼</span>`;
      // leaders may remove members + officers; officers may remove only members
      const canKick = !self && ((me === 'leader' && m.rank !== 'leader') || (me === 'officer' && m.rank === 'member'));
      if (canKick) actions += `<span class="soc-x" data-act="gkick" data-name="${esc(m.name)}" title="Remove ${esc(m.name)} from guild">${svgIcon('close')}</span>`;
      const tip = esc(dotTitle(m.online, m.status, m.zone));
      return `<div class="soc-row">`
        + `<span class="soc-dot ${dot === 'off' ? '' : dot}" title="${tip}"></span>`
        + `<span class="soc-id">${name}<span class="soc-sub">Lvl ${m.level} ${cap(m.cls)}</span></span>`
        + `<span class="soc-meta" title="${tip}">${meta}</span>`
        + (actions ? `<span class="soc-actions">${actions}</span>` : '')
        + `</div>`;
    }).join('');
    return head + rows;
  }

  // The add/action row changes with the tab (and guild membership). Inputs
  // tagged data-suggest get the username typeahead.
  private socialFooter(): string {
    if (this.socialTab === 'friends') return this.addRow('friend', 'friend-add', 'Search to add a friend…', 'Add', 16, true);
    if (this.socialTab === 'ignore') return this.addRow('ignore', 'block-add', 'Search to ignore…', 'Ignore', 16, true);
    const guild = this.sim.socialInfo?.guild ?? null;
    if (!guild) return this.addRow('gname', 'guild-create', 'Name your new guild', 'Found', 24, false);
    let foot = '';
    if (guild.rank !== 'member') foot += this.addRow('ginvite', 'guild-invite', 'Search to invite…', 'Invite', 16, true);
    // WoW: a Guild Master with other members can't just leave — they disband
    // (or hand over leadership via the crown action). Everyone else can leave.
    foot += guild.rank === 'leader' && guild.members.length > 1
      ? `<div class="soc-add soc-leave"><button class="btn" data-act="guild-disband">Disband Guild</button></div>`
      : `<div class="soc-add soc-leave"><button class="btn" data-act="guild-leave">Leave Guild</button></div>`;
    return foot;
  }

  private addRow(field: string, act: string, placeholder: string, label: string, maxlen: number, suggest: boolean): string {
    return `<div class="soc-add">`
      + (suggest ? `<div class="soc-suggest" data-for="${field}"></div>` : '')
      + `<input maxlength="${maxlen}" placeholder="${placeholder}" data-field="${field}"${suggest ? ' data-suggest="1"' : ''} autocomplete="off" spellcheck="false"/>`
      + `<button class="btn" data-act="${act}">${label}</button></div>`;
  }

  // Wire the parts that survive a content refresh: close, tabs, footer + search.
  private wireSocialChrome(el: HTMLElement): void {
    el.querySelector('[data-close]')?.addEventListener('click', () => this.toggleSocial());
    el.querySelectorAll('.soc-tab').forEach((t) => t.addEventListener('click', () => {
      this.socialTab = (t as HTMLElement).dataset.tab as 'friends' | 'guild' | 'ignore';
      this.socialNotice = null;
      this.lastSocialStruct = this.socialStructSig();
      this.renderSocial();
    }));
    const field = (sel: string): string => (el.querySelector(`input[data-field="${sel}"]`) as HTMLInputElement | null)?.value.trim() ?? '';
    const submit = (act: string | undefined): void => {
      if (act === 'friend-add') void this.socialResolveAndAct('friend', field('friend'));
      else if (act === 'block-add') void this.socialResolveAndAct('ignore', field('ignore'));
      else if (act === 'guild-invite') void this.socialResolveAndAct('ginvite', field('ginvite'));
      else if (act === 'guild-create') { const n = field('gname'); if (n) { this.sim.guildCreate(n); this.clearSocialInput('gname'); } }
      else if (act === 'guild-leave') this.sim.guildLeave();
      else if (act === 'guild-disband') this.showPrompt('Disband your guild? This cannot be undone.', 'Disband', () => this.sim.guildDisband(), () => { /* keep */ });
    };
    el.querySelectorAll('.soc-add .btn').forEach((b) => b.addEventListener('click', () => submit((b as HTMLElement).dataset.act)));
    // Enter-to-submit only for plain inputs (the guild name). Search inputs get
    // richer keyboard handling — arrows + Enter to pick a suggestion — below.
    el.querySelectorAll('.soc-add input:not([data-suggest])').forEach((inp) => inp.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key !== 'Enter') return;
      submit((inp.parentElement?.querySelector('.btn') as HTMLElement | null)?.dataset.act);
    }));
    this.wireSuggest(el);
  }

  // Wire per-row actions (re-run on every list refresh).
  private wireSocialRows(scope: HTMLElement): void {
    scope.querySelectorAll('.soc-x').forEach((x) => x.addEventListener('click', () => {
      const act = (x as HTMLElement).dataset.act;
      const name = (x as HTMLElement).dataset.name ?? '';
      if (act === 'unfriend') this.sim.friendRemove(name);
      else if (act === 'unblock') this.sim.blockRemove(name);
      else if (act === 'gkick') this.sim.guildKick(name);
      else if (act === 'promote') this.sim.guildPromote(name);
      else if (act === 'demote') this.sim.guildDemote(name);
      else if (act === 'gtransfer') this.showPrompt(`Make <b>${esc(name)}</b> the Guild Master? You will step down to Officer.`, 'Promote', () => this.sim.guildTransfer(name), () => { /* keep */ });
    }));
    scope.querySelectorAll('[data-whisper]').forEach((w) => w.addEventListener('click', () => {
      this.startWhisper((w as HTMLElement).dataset.whisper ?? '');
    }));
  }

  private suggestKind(field: string): 'friend' | 'ignore' | 'ginvite' {
    return field === 'friend' ? 'friend' : field === 'ignore' ? 'ignore' : 'ginvite';
  }

  // Username typeahead: debounced search against same-realm characters, with
  // arrow-key navigation and Enter to pick the highlighted name.
  private wireSuggest(el: HTMLElement): void {
    el.querySelectorAll('input[data-suggest]').forEach((node) => {
      const input = node as HTMLInputElement;
      const field = input.dataset.field ?? '';
      input.addEventListener('input', () => {
        const q = input.value.trim();
        window.clearTimeout(this.socialSuggestTimer);
        if (!q) { this.renderSuggest(field, []); return; }
        this.socialSuggestTimer = window.setTimeout(async () => {
          const results = await this.sim.searchCharacters(q);
          this.renderSuggest(field, results.filter((r) => r.name !== this.sim.player.name).slice(0, 8));
        }, 160);
      });
      input.addEventListener('keydown', (e) => {
        const ke = e as KeyboardEvent;
        const open = this.socialSuggest.field === field && this.socialSuggest.items.length > 0;
        if (ke.key === 'ArrowDown' && open) { ke.preventDefault(); this.moveSuggest(field, 1); }
        else if (ke.key === 'ArrowUp' && open) { ke.preventDefault(); this.moveSuggest(field, -1); }
        else if (ke.key === 'Escape' && open) { ke.preventDefault(); this.renderSuggest(field, []); }
        else if (ke.key === 'Enter') {
          ke.preventDefault();
          const picked = open && this.socialSuggest.index >= 0 ? this.socialSuggest.items[this.socialSuggest.index].name : input.value;
          void this.socialResolveAndAct(this.suggestKind(field), picked);
        }
      });
      // let a suggestion's mousedown fire before blur clears the list
      input.addEventListener('blur', () => window.setTimeout(() => this.renderSuggest(field, []), 150));
    });
  }

  private renderSuggest(field: string, results: { name: string; cls: string; level: number }[]): void {
    const box = $('#social-window').querySelector(`.soc-suggest[data-for="${field}"]`) as HTMLElement | null;
    if (!box) return;
    this.socialSuggest = { field, items: results, index: -1 };
    if (results.length === 0) { box.style.display = 'none'; box.innerHTML = ''; return; }
    const kind = this.suggestKind(field);
    box.innerHTML = results.map((r, i) =>
      `<div class="soc-sugg-item" data-i="${i}" data-name="${esc(r.name)}"><span class="soc-name">${esc(r.name)}</span><span class="soc-meta">Lvl ${r.level} ${cap(r.cls)}</span></div>`).join('');
    box.style.display = 'block';
    box.querySelectorAll('.soc-sugg-item').forEach((it) => {
      it.addEventListener('mousedown', (e) => {
        e.preventDefault();
        void this.socialResolveAndAct(kind, (it as HTMLElement).dataset.name ?? '');
      });
      it.addEventListener('mousemove', () => { this.socialSuggest.index = Number((it as HTMLElement).dataset.i); this.highlightSuggest(field); });
    });
  }

  private moveSuggest(field: string, delta: number): void {
    const n = this.socialSuggest.items.length;
    if (n === 0) return;
    // start at the top when nothing is highlighted yet, then wrap
    this.socialSuggest.index = this.socialSuggest.index < 0
      ? (delta > 0 ? 0 : n - 1)
      : (this.socialSuggest.index + delta + n) % n;
    this.highlightSuggest(field);
  }

  private highlightSuggest(field: string): void {
    const box = $('#social-window').querySelector(`.soc-suggest[data-for="${field}"]`) as HTMLElement | null;
    if (!box) return;
    box.querySelectorAll('.soc-sugg-item').forEach((it) => {
      const on = Number((it as HTMLElement).dataset.i) === this.socialSuggest.index;
      it.classList.toggle('active', on);
      if (on) (it as HTMLElement).scrollIntoView({ block: 'nearest' });
    });
  }

  // Authoritative existence check (realm-scoped) before acting, so we can give
  // clear inline "no such player" feedback instead of a silent failure.
  private async socialResolveAndAct(kind: 'friend' | 'ignore' | 'ginvite', rawName: string): Promise<void> {
    const name = rawName.trim();
    if (!name) return;
    const results = await this.sim.searchCharacters(name);
    const exact = results.find((r) => r.name.toLowerCase() === name.toLowerCase());
    if (!exact) {
      this.setSocialNotice(`No player named “${name}” on ${this.sim.realm || 'this realm'}.`, true);
      return;
    }
    if (exact.name === this.sim.player.name) { this.setSocialNotice('That is you!', true); return; }
    if (kind === 'friend') { this.sim.friendAdd(exact.name); this.setSocialNotice(`Added ${exact.name} to your friends.`, false); this.clearSocialInput('friend'); }
    else if (kind === 'ignore') { this.sim.blockAdd(exact.name); this.setSocialNotice(`Now ignoring ${exact.name}.`, false); this.clearSocialInput('ignore'); }
    else { this.sim.guildInvite(exact.name); this.setSocialNotice(`Invited ${exact.name} to your guild.`, false); this.clearSocialInput('ginvite'); }
    this.renderSuggest(kind, []);
  }

  private clearSocialInput(field: string): void {
    const inp = $('#social-window').querySelector(`input[data-field="${field}"]`) as HTMLInputElement | null;
    if (inp) inp.value = '';
  }

  private setSocialNotice(text: string, error: boolean): void {
    this.socialNotice = { text, error };
    this.renderSocialNotice();
  }

  private renderSocialNotice(): void {
    const box = $('#social-window').querySelector('.soc-notice') as HTMLElement | null;
    if (!box) return;
    if (!this.socialNotice) { box.style.display = 'none'; box.textContent = ''; return; }
    box.textContent = this.socialNotice.text;
    box.className = 'soc-notice' + (this.socialNotice.error ? ' err' : ' ok');
    box.style.display = 'block';
  }

  // Open the chat bar pre-filled with a whisper to this player (WoW-style DM).
  private startWhisper(name: string): void {
    if (!name || name === this.sim.player.name) return;
    const input = $('#chat-input') as unknown as HTMLInputElement;
    input.value = `/w ${name} `;
    input.style.display = 'block';
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  // -------------------------------------------------------------------------
  // Prompts (party invite / trade request / duel challenge)
  // -------------------------------------------------------------------------

  private showPrompt(text: string, acceptLabel: string, onAccept: () => void, onDecline: () => void): void {
    const stack = $('#prompt-stack');
    const prompt = document.createElement('div');
    prompt.className = 'prompt panel';
    prompt.innerHTML = `<div class="prompt-text">${text}</div>`;
    const accept = document.createElement('button');
    accept.className = 'btn';
    accept.textContent = acceptLabel;
    const decline = document.createElement('button');
    decline.className = 'btn';
    decline.textContent = 'Decline';
    accept.addEventListener('click', () => { prompt.remove(); onAccept(); });
    decline.addEventListener('click', () => { prompt.remove(); onDecline(); });
    prompt.append(accept, decline);
    stack.appendChild(prompt);
    window.setTimeout(() => { if (prompt.isConnected) { prompt.remove(); onDecline(); } }, 28000);
  }

  // -------------------------------------------------------------------------
  // Trade window
  // -------------------------------------------------------------------------

  get tradeOpen(): boolean {
    return this.sim.tradeInfo !== null;
  }

  addItemToTrade(itemId: string): void {
    if (!this.tradeOpen || this.stagedTrade.items.length >= 6) return;
    const existing = this.stagedTrade.items.find((s) => s.itemId === itemId);
    const have = this.sim.inventory.find((s) => s.itemId === itemId)?.count ?? 0;
    if (existing) {
      if (existing.count < have) existing.count++;
    } else {
      this.stagedTrade.items.push({ itemId, count: 1 });
    }
    this.pushTradeOffer();
  }

  private pushTradeOffer(): void {
    this.sim.tradeSetOffer(this.stagedTrade.items, this.stagedTrade.copper);
  }

  private updateTradeWindow(): void {
    const el = $('#trade-window');
    const info = this.sim.tradeInfo;
    if (!info) {
      if (this.tradeWasOpen) {
        el.style.display = 'none';
        this.tradeWasOpen = false;
        this.stagedTrade = { items: [], copper: 0 };
        this.lastTradeSig = '';
        if ($('#bags').style.display === 'block') this.renderBags();
      }
      return;
    }
    if (!this.tradeWasOpen) {
      this.tradeWasOpen = true;
      this.stagedTrade = { items: [], copper: 0 };
      this.renderBags();
      $('#bags').style.display = 'block';
    }
    const sig = JSON.stringify([info.myOffer, info.theirOffer, info.myAccepted, info.theirAccepted, this.stagedTrade]);
    if (sig === this.lastTradeSig) return;
    this.lastTradeSig = sig;

    const itemRow = (s: InvSlot, mine: boolean) => {
      const item = ITEMS[s.itemId];
      return `<div class="trade-item${mine ? ' mine' : ''}" data-item="${mine ? s.itemId : ''}">${this.itemIcon(item)}<span>${item?.name ?? s.itemId}${s.count > 1 ? ' x' + s.count : ''}</span></div>`;
    };
    el.innerHTML = `
      <div class="panel-title"><span>Trade with ${esc(info.otherName)}</span><span class="x-btn" data-close>${svgIcon('close')}</span></div>
      <div class="trade-cols">
        <div class="trade-col ${info.myAccepted ? 'accepted' : ''}">
          <h4>Your offer</h4>
          <div class="trade-items">${info.myOffer.items.map((s) => itemRow(s, true)).join('') || '<div style="color:#665c40;font-size:11px;padding:4px">Click items in your bags to add them</div>'}</div>
          <div class="trade-money">Money: <input id="trade-copper" type="number" min="0" value="${this.stagedTrade.copper}" /> copper</div>
        </div>
        <div class="trade-col ${info.theirAccepted ? 'accepted' : ''}">
          <h4>${esc(info.otherName)}'s offer</h4>
          <div class="trade-items">${info.theirOffer.items.map((s) => itemRow(s, false)).join('') || '<div style="color:#665c40;font-size:11px;padding:4px">Nothing offered yet</div>'}</div>
          <div class="trade-money">Money: <span class="gold">${formatMoney(info.theirOffer.copper)}</span></div>
        </div>
      </div>
      <div class="trade-hint">Click an offered item to remove it. Both sides must press Accept Trade.</div>`;
    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'btn';
    acceptBtn.textContent = info.myAccepted ? 'Waiting…' : 'Accept Trade';
    acceptBtn.disabled = info.myAccepted;
    acceptBtn.addEventListener('click', () => this.sim.tradeConfirm());
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => this.sim.tradeCancel());
    el.append(acceptBtn, cancelBtn);
    el.querySelector('[data-close]')?.addEventListener('click', () => this.sim.tradeCancel());
    el.querySelectorAll('.trade-item.mine').forEach((row) => {
      row.addEventListener('click', () => {
        const itemId = (row as HTMLElement).dataset.item!;
        const idx = this.stagedTrade.items.findIndex((s) => s.itemId === itemId);
        if (idx >= 0) {
          this.stagedTrade.items[idx].count--;
          if (this.stagedTrade.items[idx].count <= 0) this.stagedTrade.items.splice(idx, 1);
          this.pushTradeOffer();
        }
      });
    });
    const copperInput = el.querySelector('#trade-copper') as HTMLInputElement;
    copperInput?.addEventListener('change', () => {
      this.stagedTrade.copper = Math.max(0, Math.floor(Number(copperInput.value) || 0));
      this.pushTradeOffer();
    });
    el.style.display = 'block';
  }

  // -------------------------------------------------------------------------
  // Options menu (Esc) + hotkey rebinding
  // -------------------------------------------------------------------------

  attachOptions(hooks: OptionsHooks): void {
    this.optionsHooks = hooks;
  }

  attachReporting(hooks: ReportHooks): void {
    this.reportHooks = hooks;
  }

  get optionsOpen(): boolean {
    return $('#options-menu').style.display === 'block';
  }

  // True while a menu that should pause character movement is up.
  isModalOpen(): boolean {
    return this.optionsOpen;
  }

  toggleOptionsMenu(): void {
    if (this.optionsOpen) { this.closeOptions(); return; }
    this.closeOtherWindows('#options-menu');
    this.optionsView = 'main';
    this.capturingKey = null;
    this.keybindNote = '';
    this.renderOptions();
    $('#options-menu').style.display = 'block';
    music.pauseForMenu();
    audio.click();
  }

  closeOptions(): void {
    $('#options-menu').style.display = 'none';
    this.capturingKey = null;
    this.hideTooltip();
    music.resumeFromMenu();
  }

  private renderOptions(): void {
    if (this.optionsView === 'keybinds') { this.renderKeybinds(); return; }
    if (this.optionsView === 'graphics') { this.renderGraphics(); return; }
    if (this.optionsView === 'audio') { this.renderAudio(); return; }
    const el = $('#options-menu');
    el.innerHTML = `<div class="panel-title"><span>Game Menu</span><span class="x-btn" data-close>${svgIcon('close')}</span></div>`;
    const list = document.createElement('div');
    list.className = 'opt-list';
    const add = (text: string, onClick: () => void) => {
      const b = document.createElement('button');
      b.className = 'btn opt-btn';
      b.textContent = text;
      b.addEventListener('click', () => { audio.click(); onClick(); });
      list.appendChild(b);
    };
    const goto = (view: 'keybinds' | 'graphics' | 'audio') => { this.optionsView = view; this.keybindNote = ''; this.renderOptions(); };
    add('Key Bindings', () => goto('keybinds'));
    add('Graphics', () => goto('graphics'));
    add('Audio', () => goto('audio'));
    add('Logout', () => this.optionsHooks?.logout());
    add('Return to Game', () => this.closeOptions());
    el.appendChild(list);
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeOptions());
  }

  // A labelled slider bound to a numeric setting; live-applies via the hook.
  private settingSlider(parent: HTMLElement, label: string, key: NumericSettingKey): void {
    const hooks = this.optionsHooks;
    if (!hooks) return;
    const r = SETTING_RANGES[key];
    const row = document.createElement('div');
    row.className = 'set-row';
    const name = document.createElement('span');
    name.className = 'set-name';
    name.textContent = label;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'set-slider';
    slider.min = String(r.min);
    slider.max = String(r.max);
    slider.step = '0.05';
    slider.value = String(hooks.settings.get(key));
    const val = document.createElement('span');
    val.className = 'set-val';
    const pct = () => `${Math.round(hooks.settings.get(key) * 100)}%`;
    val.textContent = pct();
    slider.addEventListener('input', () => {
      hooks.onSettingChange(key, Number(slider.value));
      val.textContent = pct();
    });
    row.append(name, slider, val);
    parent.appendChild(row);
  }

  private settingToggle(parent: HTMLElement, label: string, key: 'fullscreen' | 'showOverflowXp'): void {
    const hooks = this.optionsHooks;
    if (!hooks) return;
    const row = document.createElement('div');
    row.className = 'set-row';
    const name = document.createElement('span');
    name.className = 'set-name';
    name.textContent = label;
    const toggle = document.createElement('button');
    toggle.className = 'btn set-toggle';
    const sync = () => {
      const on = hooks.settings.get(key) >= 0.5;
      toggle.textContent = on ? 'On' : 'Off';
      toggle.classList.toggle('off', !on);
      toggle.setAttribute('aria-pressed', String(on));
    };
    sync();
    toggle.addEventListener('click', () => {
      audio.click();
      const next = hooks.settings.get(key) >= 0.5 ? 0 : 1;
      hooks.onSettingChange(key, next);
      sync();
    });
    row.append(name, toggle);
    parent.appendChild(row);
  }

  private settingsViewShell(title: string): HTMLElement {
    const el = $('#options-menu');
    el.innerHTML = `<div class="panel-title"><span>${title}</span><span class="x-btn" data-close>${svgIcon('close')}</span></div>`;
    const body = document.createElement('div');
    body.className = 'set-rows';
    el.appendChild(body);
    return body;
  }

  private settingsViewFooter(): void {
    const el = $('#options-menu');
    const reset = document.createElement('button');
    reset.className = 'btn';
    reset.textContent = 'Reset to Defaults';
    reset.addEventListener('click', () => {
      audio.click();
      this.optionsHooks?.settings.reset();
      // re-apply every setting to its subsystem, then redraw the view
      const all = this.optionsHooks?.settings.all();
      if (all) for (const k of Object.keys(all) as (keyof GameSettings)[]) this.optionsHooks?.onSettingChange(k, all[k]);
      this.renderOptions();
    });
    const back = document.createElement('button');
    back.className = 'btn';
    back.textContent = 'Back';
    back.addEventListener('click', () => { audio.click(); this.optionsView = 'main'; this.renderOptions(); });
    el.append(reset, back);
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeOptions());
  }

  private renderGraphics(): void {
    const body = this.settingsViewShell('Graphics');
    this.settingSlider(body, 'Camera Speed', 'cameraSpeed');
    this.settingSlider(body, 'Brightness', 'brightness');
    this.settingSlider(body, 'Render Quality', 'renderScale');
    this.settingToggle(body, 'Fullscreen', 'fullscreen');
    this.settingToggle(body, t('game.settings.showOverflowXp'), 'showOverflowXp');
    const note = document.createElement('div');
    note.className = 'set-note';
    note.textContent = 'Lower Camera Speed for a calmer mouselook. Render Quality below 100% boosts FPS on weaker machines. Show Overflow XP keeps the XP bar filling past the level cap.';
    $('#options-menu').appendChild(note);
    this.settingsViewFooter();
  }

  private renderAudio(): void {
    const body = this.settingsViewShell('Audio');
    this.settingSlider(body, 'Sound Effects', 'sfxVolume');
    this.settingSlider(body, 'Music Volume', 'musicVolume');
    const row = document.createElement('div');
    row.className = 'set-row';
    const name = document.createElement('span');
    name.className = 'set-name';
    name.textContent = 'Music';
    const toggle = document.createElement('button');
    toggle.className = 'btn set-toggle';
    const sync = () => { toggle.textContent = music.enabled ? 'On' : 'Off'; toggle.classList.toggle('off', !music.enabled); };
    sync();
    toggle.addEventListener('click', () => { audio.click(); music.setEnabled(!music.enabled); sync(); });
    row.append(name, toggle);
    body.appendChild(row);
    this.settingsViewFooter();
  }

  // Display name for an action row. Action-bar slots show the shortcut that
  // currently occupies them (slot 0 is always Attack); everything else uses
  // its registry label.
  private actionDisplayName(actionId: string, fallback: string): string {
    if (!actionId.startsWith('slot')) return fallback;
    const slot = Number(actionId.slice(4));
    if (slot === 0) return 'Attack';
    const known = this.abilityForSlot(slot);
    if (known) return known.def.name;
    const item = this.itemForSlot(slot);
    return item ? item.name : fallback;
  }

  // Toggle row styled for the Key Bindings panel. Handles the bool Mouse Camera
  // setting and the numeric (0/1) Click to Move setting, which both live here
  // alongside the rebindable keys.
  private settingToggleKeybind(parent: HTMLElement, label: string, key: BoolSettingKey | 'clickToMove'): void {
    const hooks = this.optionsHooks;
    if (!hooks) return;
    const isOn = () => (key === 'clickToMove' ? hooks.settings.get(key) >= 0.5 : hooks.settings.get(key));
    const row = document.createElement('div');
    row.className = 'kb-row kb-toggle-row';
    const name = document.createElement('span');
    name.className = 'kb-name';
    name.textContent = label;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn kb-key kb-toggle';
    const sync = () => {
      const on = isOn();
      toggle.textContent = on ? 'On' : 'Off';
      toggle.classList.toggle('off', !on);
      toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    };
    sync();
    toggle.addEventListener('click', () => {
      audio.click();
      const next = !isOn();
      if (key === 'clickToMove') hooks.onSettingChange(key, next ? 1 : 0);
      else hooks.onSettingChange(key, hooks.settings.set(key, next));
      sync();
    });
    row.append(name, toggle);
    parent.appendChild(row);
  }

  private renderKeybinds(): void {
    const el = $('#options-menu');
    el.innerHTML = `<div class="panel-title"><span>Key Bindings</span><span class="x-btn" data-close>${svgIcon('close')}</span></div>`;
    this.settingToggleKeybind(el, 'Mouse Camera', 'mouseCamera');
    this.settingToggleKeybind(el, 'Click to Move', 'clickToMove');
    const note = document.createElement('div');
    note.className = 'kb-note';
    note.textContent = this.keybindNote
      || 'Mouse Camera off: A/D turns, drag to orbit (classic). On: camera-relative WASD, A/D strafes. Click to Move: left-click the ground or an enemy to walk there. Click a key cell to rebind; Esc cancels.';
    el.appendChild(note);
    const rows = document.createElement('div');
    rows.className = 'kb-rows';
    for (const category of BIND_CATEGORIES) {
      const header = document.createElement('div');
      header.className = 'kb-cat';
      header.textContent = category;
      rows.appendChild(header);
      for (const action of BIND_ACTIONS.filter((a) => a.category === category)) {
        const row = document.createElement('div');
        row.className = 'kb-row';
        const name = document.createElement('span');
        name.className = 'kb-name';
        name.textContent = this.actionDisplayName(action.id, action.label);
        row.appendChild(name);
        for (let index = 0; index < 2; index++) {
          const capturing = this.capturingKey?.action === action.id && this.capturingKey?.index === index;
          const key = document.createElement('button');
          key.className = 'btn kb-key' + (capturing ? ' capturing' : '');
          key.textContent = capturing ? '…' : (this.keybinds.labelAt(action.id, index) || '—');
          key.title = index === 0 ? 'Primary' : 'Alternate';
          key.addEventListener('click', () => this.beginCapture(action.id, index, action.label));
          row.appendChild(key);
        }
        rows.appendChild(row);
      }
    }
    el.appendChild(rows);
    const reset = document.createElement('button');
    reset.className = 'btn';
    reset.textContent = 'Reset to Defaults';
    reset.addEventListener('click', () => {
      audio.click();
      this.keybinds.reset();
      this.capturingKey = null;
      this.keybindNote = 'Bindings reset to defaults.';
      this.refreshKeybindLabels();
      this.renderKeybinds();
    });
    const back = document.createElement('button');
    back.className = 'btn';
    back.textContent = 'Back';
    back.addEventListener('click', () => { audio.click(); this.optionsView = 'main'; this.capturingKey = null; this.renderOptions(); });
    el.append(reset, back);
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeOptions());
  }

  private beginCapture(actionId: string, index: number, fallbackLabel: string): void {
    if (!this.optionsHooks) return;
    const name = this.actionDisplayName(actionId, fallbackLabel);
    this.capturingKey = { action: actionId, index };
    this.keybindNote = `Press a key for "${name}"…`;
    this.renderKeybinds();
    this.optionsHooks.captureKey((code) => {
      this.capturingKey = null;
      if (code === null) {
        this.keybindNote = 'Rebinding cancelled.';
      } else if (isReservedCode(code)) {
        this.keybindNote = `${keyLabel(code)} is reserved and can't be bound.`;
      } else if (this.keybinds.bind(actionId, index, code)) {
        this.keybindNote = `Bound "${name}" to ${keyLabel(code)}.`;
        this.refreshKeybindLabels();
      }
      // re-render only if the menu is still open (player may have closed it)
      if (this.optionsOpen) this.renderKeybinds();
    });
  }

  // -------------------------------------------------------------------------

  // The mutually-exclusive modal windows. They all share one centred position
  // (see the `.window` rule), so only one may be visible at a time — the vendor
  // is the lone pairing (it opens bags alongside, laid out side-by-side).
  private static readonly MODAL_IDS = ['#quest-dialog', '#loot-window', '#vendor-window', '#bags', '#char-window', '#spellbook', '#talents-window', '#quest-log-window', '#map-window', '#report-window', '#arena-window', '#leaderboard-window'];

  // Opening any window closes the others first, so panels never stack. `keep`
  // is the window (or windows, e.g. vendor+bags) being opened.
  private closeOtherWindows(keep?: string | string[]): void {
    const keepSet = new Set(Array.isArray(keep) ? keep : keep ? [keep] : []);
    for (const id of Hud.MODAL_IDS) {
      if (keepSet.has(id)) continue;
      const el = document.querySelector<HTMLElement>(id);
      if (el && el.style.display !== 'none' && el.style.display !== '') el.style.display = 'none';
    }
    if (!keepSet.has('#talents-window')) this.talentStage = null;
    if (!keepSet.has('#loot-window')) this.openLootMobId = null;
    if (!keepSet.has('#vendor-window')) {
      this.openVendorNpcId = null;
      document.body.classList.remove('vendor-open');
    }
    const social = document.querySelector<HTMLElement>('#social-window');
    if (!keepSet.has('#social-window') && social?.classList.contains('open')) social.classList.remove('open');
    if (!keepSet.has('#options-menu') && this.optionsOpen) this.closeOptions();
    if (!keepSet.has('#market-window') && this.marketOpen) this.closeMarket();
    this.closeContextMenu();
    this.hideTooltip();
  }

  // Closes the topmost UI. Returns true if something was closed.
  closeAll(): boolean {
    let closed = false;
    this.closeContextMenu();
    if (this.optionsOpen) { this.closeOptions(); return true; }
    const socialEl = $('#social-window');
    if (socialEl.classList.contains('open')) { socialEl.classList.remove('open'); closed = true; }
    if (this.tradeOpen) {
      this.sim.tradeCancel();
      closed = true;
    }
    if (this.marketOpen) { this.closeMarket(); closed = true; }
    const confirmEl = document.getElementById('confirm-dialog');
    if (confirmEl) { confirmEl.remove(); closed = true; }
    for (const id of Hud.MODAL_IDS) {
      const el = $(id);
      if (el.style.display === 'block') {
        el.style.display = 'none';
        closed = true;
      }
    }
    if (closed) {
      this.openLootMobId = null;
      this.openVendorNpcId = null;
      this.hideTooltip();
    }
    return closed;
  }
}

function describeCost(known: ResolvedAbility, sim: IWorld): string {
  const resName = sim.player.resourceType === 'rage' ? 'Rage' : sim.player.resourceType === 'energy' ? 'Energy' : 'Mana';
  const parts: string[] = [];
  if (known.cost > 0) parts.push(`${known.cost} ${resName}`);
  parts.push(known.def.channel ? 'Channeled' : known.castTime > 0 ? `${known.castTime}s cast` : 'Instant');
  if (known.def.cooldown > 0) parts.push(`${known.def.cooldown}s cooldown`);
  return parts.join(' · ');
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function statusLabel(status: string | undefined): string {
  switch (status) {
    case 'combat': return 'In Combat';
    case 'dungeon': return 'In Dungeon';
    case 'dead': return 'Dead';
    default: return 'Online';
  }
}

// Hover text spelling out what a status dot means, so the orange/grey circles
// aren't a mystery (#100).
function dotTitle(online: boolean, status: string | undefined, zone: string | undefined): string {
  if (!online) return 'Offline';
  const where = zone ? ` — ${zone}` : '';
  return `${statusLabel(status)}${where}`;
}

function rankLabel(rank: string): string {
  return rank === 'leader' ? 'Guild Master' : rank === 'officer' ? 'Officer' : 'Member';
}
