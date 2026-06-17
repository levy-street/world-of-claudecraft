import type { ResolvedAbility } from '../sim/sim';
import { OVERHEAD_EMOTES, isOverheadEmoteId, type FriendInfo, type IWorld, type LeaderboardEntry, type MarketInfo, type OverheadEmoteId } from '../world_api';
import { Renderer } from '../render/renderer';
import { CharacterPreview } from '../render/characters';
import { skinCount } from '../render/characters/manifest';
import { emoteIconUrl } from './emote_icons';
import {
  ABILITIES, CLASSES, DUNGEON_LIST, DUNGEON_X_THRESHOLD, ITEMS, MOBS, NPCS, PROPS, QUESTS,
  WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_X, WORLD_MIN_Z, ZONES, dungeonAt, questRewardItem, zoneAt,
  zoneWelcomeText,
} from '../sim/data';
import type { ZoneDef } from '../sim/data';
import type { AbilityDef, EquipSlot, InvSlot, PetMode, PlayerClass, ResourceType, Stats } from '../sim/types';
import {
  AbilityEffect, CONSUME_DURATION, Entity, FISHING_CAST_ID, GCD, ItemDef, SimEvent,
  dist2d, xpForLevel, MAX_LEVEL, MELEE_RANGE, MILESTONES, virtualLevel, canPrestige, xpUntilNextPrestige,
} from '../sim/types';
import { xpBarView, formatXp } from './xp_bar';
import { terrainHeight, WATER_LEVEL, roadDistance, generateDecorations } from '../sim/world';
import type { Decoration } from '../sim/world';
import { Meters } from './meters';
import { audio } from '../game/audio';
import { music, musicZoneForLocation } from '../game/music';
import { iconDataUrl, iconCanvas, QUALITY_COLOR, raidMarkerDataUrl, RAID_MARKER_NAMES } from './icons';
import { svgIcon } from './ui_icons';
import { Keybinds, BIND_ACTIONS, BIND_CATEGORIES, isReservedCode, keyLabel } from '../game/keybinds';
import { Settings, GameSettings, BoolSettingKey, NumericSettingKey, SETTING_RANGES, clickMoveButtonLabel, normalizeClickMoveButton } from '../game/settings';
import { isPhoneTouchDevice } from '../game/mobile_controls';
import { chatPlayerContextActions } from './player_context_menu';
import { TouchPeekGuard, TOOLTIP_PEEK_MS } from './touch_peek';
import { maskProfanity } from './profanity';
import { formatMoney as formatLocalizedMoney, formatNumber, moneyParts, t, type TranslationKey } from './i18n';
import { tEntity } from './entity_i18n';
import { localizeServerText, localizeZone } from './server_i18n';
import { localizeSimText, localizeSimAuraName } from './sim_i18n';
import { tTalent, localizeTalentTitle } from './talent_i18n';
import {
  talentsFor, computeTalentModifiers, validateAllocation, dormantNodes, pointsSpent,
  exportBuild, importBuild, cloneAllocation, talentPointsAtLevel, FIRST_TALENT_LEVEL,
  type TalentAllocation, type TalentNode, type SpecDef, type Role,
} from '../sim/content/talents';
import { talentChoiceIconDataUrl, talentNodeIconDataUrl } from './talent_icons';
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
const castDisplayName = (id: string): string => {
  if (id === FISHING_CAST_ID) return t('abilityUi.cast.fishing');
  if (id === 'demon_heal') return t('abilityUi.cast.demonHeal');
  const ability = ABILITIES[id];
  return ability ? abilityDisplayName(ability) : id;
};

const FAMILY_GLYPH: Record<string, string> = {
  beast: '🐾', humanoid: '🗡️', murloc: '🐟', spider: '🕷️', kobold: '⛏️', undead: '💀',
  troll: '🦴', ogre: '👊', elemental: '🌀', dragonkin: '🐉',
};
const CLASS_GLYPH: Record<string, string> = {
  warrior: '⚔️', paladin: '🔨', hunter: '🏹', rogue: '🗡️', priest: '✝️',
  shaman: '🌩️', mage: '🔮', warlock: '🕯️', druid: '🐻',
};
const RESOURCE_LABEL_KEYS: Record<ResourceType, TranslationKey> = {
  mana: 'abilityUi.resources.mana',
  rage: 'abilityUi.resources.rage',
  energy: 'abilityUi.resources.energy',
};
const RAID_MARKER_LABEL_KEYS = [
  'hud.markers.names.star',
  'hud.markers.names.circle',
  'hud.markers.names.diamond',
  'hud.markers.names.triangle',
  'hud.markers.names.moon',
  'hud.markers.names.square',
  'hud.markers.names.cross',
  'hud.markers.names.skull',
] as const satisfies readonly TranslationKey[];
const FORM_LABEL_KEYS: Record<'bear' | 'cat', TranslationKey> = {
  bear: 'abilityUi.forms.bear',
  cat: 'abilityUi.forms.cat',
};
const PET_MODE_LABEL_KEYS: Record<PetMode, TranslationKey> = {
  passive: 'hud.pet.passive',
  defensive: 'hud.pet.defensive',
  aggressive: 'hud.pet.aggressive',
};
const PET_MODE_DESC_KEYS: Record<PetMode, TranslationKey> = {
  passive: 'hud.pet.passiveDesc',
  defensive: 'hud.pet.defensiveDesc',
  aggressive: 'hud.pet.aggressiveDesc',
};
type ItemQuality = NonNullable<ItemDef['quality']>;
const ITEM_SLOT_LABEL_KEYS: Record<EquipSlot, TranslationKey> = {
  mainhand: 'itemUi.slots.mainhand',
  chest: 'itemUi.slots.chest',
  legs: 'itemUi.slots.legs',
  feet: 'itemUi.slots.feet',
};
const ITEM_QUALITY_LABEL_KEYS: Record<ItemQuality, TranslationKey> = {
  poor: 'itemUi.quality.poor',
  common: 'itemUi.quality.common',
  uncommon: 'itemUi.quality.uncommon',
  rare: 'itemUi.quality.rare',
  epic: 'itemUi.quality.epic',
};
const ITEM_KIND_LABEL_KEYS: Record<ItemDef['kind'], TranslationKey> = {
  weapon: 'itemUi.kind.weapon',
  armor: 'itemUi.kind.armor',
  quest: 'itemUi.kind.quest',
  junk: 'itemUi.kind.junk',
  food: 'itemUi.kind.food',
  drink: 'itemUi.kind.drink',
  tool: 'itemUi.kind.tool',
  potion: 'itemUi.kind.potion',
};
const ITEM_STAT_LABEL_KEYS: Partial<Record<keyof Stats, TranslationKey>> = {
  armor: 'itemUi.stats.armor',
  str: 'itemUi.stats.str',
  agi: 'itemUi.stats.agi',
  sta: 'itemUi.stats.sta',
  int: 'itemUi.stats.int',
  spi: 'itemUi.stats.spi',
};

// Classic class colors (CLASSES[cls].color is a 0xRRGGBB number) as a CSS
// string, used to color-code party members on the minimap and in the frames.
const classCss = (cls: string): string =>
  '#' + ((CLASSES as Record<string, { color: number }>)[cls]?.color ?? 0x5fa8ff).toString(16).padStart(6, '0');

// Party frames dim and the minimap pins members to the rim once they pass
// this range (yards) — just inside the server's ~120 yd interest scope.
const PARTY_RANGE_YD = 100;
const EMOTE_WHEEL_LIMIT = 8;
const DEFAULT_EMOTE_WHEEL: OverheadEmoteId[] = ['wave', 'laugh', 'question', 'cheer', 'dance', 'point', 'flex', 'cry'];

// yards past a zone boundary before the crossing banner/welcome commits
const ZONE_BANNER_DEADBAND = 5;
const IGNORED_CHAT_NAMES_KEY = 'woc_ignored_chat_names';
const BIND_CATEGORY_LABEL_KEYS: Partial<Record<string, TranslationKey>> = {
  Movement: 'hud.keybinds.categories.movement',
  Targeting: 'hud.keybinds.categories.targeting',
  Interface: 'hud.keybinds.categories.interface',
  'Action Bar': 'hud.keybinds.categories.actionBar',
};
const BIND_ACTION_LABEL_KEYS: Partial<Record<string, TranslationKey>> = {
  forward: 'hud.keybinds.actions.forward',
  back: 'hud.keybinds.actions.back',
  turnLeft: 'hud.keybinds.actions.turnLeft',
  turnRight: 'hud.keybinds.actions.turnRight',
  strafeLeft: 'hud.keybinds.actions.strafeLeft',
  strafeRight: 'hud.keybinds.actions.strafeRight',
  jump: 'hud.keybinds.actions.jump',
  autorun: 'hud.keybinds.actions.autorun',
  target: 'hud.keybinds.actions.target',
  interact: 'hud.keybinds.actions.interact',
  char: 'hud.keybinds.actions.char',
  spellbook: 'hud.keybinds.actions.spellbook',
  questlog: 'hud.keybinds.actions.questlog',
  map: 'hud.keybinds.actions.map',
  bags: 'hud.keybinds.actions.bags',
  nameplates: 'hud.keybinds.actions.nameplates',
  meters: 'hud.keybinds.actions.meters',
  social: 'hud.keybinds.actions.social',
  arena: 'hud.keybinds.actions.arena',
  chat: 'hud.keybinds.actions.chat',
  // Reuse the existing window/feature names so these labels localize everywhere
  // without duplicating strings (these two ids were previously absent from the
  // map and fell back to the raw English BIND_ACTIONS labels).
  talents: 'game.talents.title',
  leaderboard: 'game.leaderboard.title',
};
const CHAT_TEMPLATE_KEYS = {
  party: 'hud.chat.templates.party',
  yell: 'hud.chat.templates.yell',
  whisper: 'hud.chat.templates.whisper',
  toWhisper: 'hud.chat.templates.toWhisper',
  general: 'hud.chat.templates.general',
  world: 'hud.chat.templates.world',
  lfg: 'hud.chat.templates.lfg',
  guild: 'hud.chat.templates.guild',
  officer: 'hud.chat.templates.officer',
  emote: 'hud.chat.templates.emote',
  roll: 'hud.chat.templates.roll',
  say: 'hud.chat.templates.say',
} satisfies Record<string, TranslationKey>;
type HotbarForm = 'normal' | 'bear' | 'cat' | 'stealth';

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
  private activeHotbarForm: HotbarForm = 'normal';
  private dragAction: { action: Exclude<HotbarAction, null>; sourceIndex: number | null } | null = null;
  private optionsHooks: OptionsHooks | null = null;
  private reportHooks: ReportHooks | null = null;
  // Soft swear terms from the server (online only), masked in chat when the
  // player's "Filter Profanity" setting is on. Fed by main.ts from ClientWorld.
  private profanityWords: string[] = [];
  private optionsView: 'main' | 'keybinds' | 'graphics' | 'audio' = 'main';
  private capturingKey: { action: string; index: number } | null = null; // binding awaiting a key
  private keybindNote = '';
  private emoteWheelOpen = false;
  private emoteWheelHover: OverheadEmoteId | 'edit' | null = null;
  private emoteWheelSlots: OverheadEmoteId[] = [];
  private emoteWheelEl: HTMLDivElement | null = null;
  private emoteWheelPinned = false;
  private chatLogEl = $('#chatlog');
  private combatLogEl = $('#combatlog');
  private errorEl = $('#error-msg');
  private bannerEl = $('#banner');
  private tooltipEl = $('#tooltip');
  // Distinguishes a touch long-press "peek" (inspect, no action) from a tap.
  private peekGuard = new TouchPeekGuard();
  private errorTimer: number | undefined;
  private bannerTimer: number | undefined;
  private pfLevelEl = $('#pf-level');
  private pfHpEl = $('#pf-hp');
  private pfHpTextEl = $('#pf-hp-text');
  private pfResEl = $('#pf-res');
  private pfResTextEl = $('#pf-res-text');
  private pfResourceEl = $('#pf-resource');
  private buffBarEl = $('#buff-bar');
  private targetFrameEl = $('#target-frame');
  private targetEliteTagEl = $('#tf-elite-tag');
  private targetNameEl = $('#tf-name');
  private targetLevelEl = $('#tf-level');
  private targetHpEl = $('#tf-hp');
  private targetHpTextEl = $('#tf-hp-text');
  private targetPortraitEl = $('#tf-portrait') as unknown as HTMLCanvasElement;
  private targetDebuffsEl = $('#tf-debuffs');
  private comboRowEl = $('#combo-row');
  private castbarEl = $('#castbar');
  private castbarFillEl = this.castbarEl.querySelector('.fill') as HTMLElement;
  private castbarLabelEl = this.castbarEl.querySelector('.label') as HTMLElement;
  private castbarTimerEl = this.castbarEl.querySelector('.timer') as HTMLElement;
  private actionbarEl = $('#actionbar');
  private xpFillEl = $('#xpbar .fill');
  private xpLabelEl = $('#xpbar .label');
  private deathOverlayEl = $('#death-overlay');
  private releaseSpiritBtnEl = $('#release-btn');
  private hotWriteCache = new Map<HTMLElement, string>();
  private hotDomWrites = 0;
  private hotDomSkippedWrites = 0;
  private minimapCtx: CanvasRenderingContext2D;
  private minimapBg: HTMLCanvasElement;
  private mapBg: HTMLCanvasElement | null = null;
  private openLootMobId: number | null = null;
  private openVendorNpcId: number | null = null;
  private openGossipNpcId: number | null = null;
  private openQuestDetailId: string | null = null;
  private selectedQuestLogId: string | null = null;
  private questDialogReturnFocus: HTMLElement | null = null;
  private questLogReturnFocus: HTMLElement | null = null;
  private lastPortraitTarget = -999;
  // trading: locally staged offer, pushed to the server on change
  private stagedTrade: { items: InvSlot[]; copper: number } = { items: [], copper: 0 };
  private tradeWasOpen = false;
  private lastTradeSig = '';
  private lastPartySig = '';
  private lastArenaSig = '';
  private lastArenaStatusSig = '';
  private arenaMatchSeen = false; // closes the queue panel once a bout starts
  private arenaBracket: import('../world_api').ArenaFormat = '1v1';
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
  private windowDrag: { el: HTMLElement; pointerId: number; offsetX: number; offsetY: number } | null = null;
  private windowObserver: MutationObserver | null = null;
  private windowZ = 50;
  private ignoredChatNames = new Set<string>();
  private socialTab: 'friends' | 'guild' | 'ignore' = 'friends';
  // split signatures: structural changes (tab, guild membership) rebuild the
  // whole panel; content-only changes (a friend's presence) refresh just the
  // list, so an open typeahead / half-typed name survives a snapshot
  private lastSocialStruct = '';
  private lastSocialContent = '';
  private socialNotice: { text: string; error: boolean } | null = null;
  private socialSuggestTimer: number | undefined;
  private lastHudFastAt = 0;
  private lastHudMediumAt = 0;
  private lastHudSlowAt = 0;
  private charPreview: CharacterPreview | null = null;
  private charPreviewCanvas: HTMLCanvasElement | null = null;
  // current typeahead state: which input, its results, and the keyboard-
  // highlighted row (-1 = none), so Enter/Arrow keys can pick a suggestion
  private socialSuggest: { field: string; items: { name: string; cls: string; level: number }[]; index: number } = { field: '', items: [], index: -1 };

  private meters: Meters;
  private lastPetBarSig = '';
  private pendingPetFeed = false;
  private petModeMenuOpen = false;
  // Talents: a local staged allocation the user edits before committing (Apply).
  private talentStage: TalentAllocation | null = null;
  private talentTab: 'class' | 'spec' = 'class';

  constructor(private sim: IWorld, private renderer: Renderer, private keybinds: Keybinds) {
    this.ignoredChatNames = this.loadIgnoredChatNames();
    this.meters = new Meters(sim);
    this.bindLogTabs();
    this.initWindowManagement();
    this.emoteWheelSlots = this.loadEmoteWheelSlots();
    this.loadSlotMap();
    this.buildActionBar();
    this.refreshKeybindLabels();
    this.buildXpTicks();
    document.addEventListener('woc:languagechange', () => this.refreshLocalizedDynamicUi());
    $('#pf-name').textContent = sim.player.name;
    this.drawPortrait($('#pf-portrait') as unknown as HTMLCanvasElement, `class_${sim.cfg.playerClass}`);
    const mm = $('#minimap') as unknown as HTMLCanvasElement;
    this.minimapCtx = mm.getContext('2d')!;
    this.minimapBg = this.renderTerrainCanvas(140, { minX: WORLD_MIN_X, maxX: WORLD_MAX_X, minZ: WORLD_MIN_Z, maxZ: WORLD_MAX_Z });
    mm.style.cursor = 'pointer';
    mm.title = t('controls.worldMap');
    mm.addEventListener('click', () => this.toggleMap());
    window.addEventListener('pointermove', (ev) => {
      if (this.emoteWheelOpen) this.updateEmoteWheelPointer(ev.clientX, ev.clientY);
    });
    window.addEventListener('mousemove', (ev) => {
      if (this.emoteWheelOpen) this.updateEmoteWheelPointer(ev.clientX, ev.clientY);
    });
    window.addEventListener('pointerdown', (ev) => {
      if (!this.emoteWheelOpen || !this.emoteWheelPinned) return;
      const target = ev.target as Node | null;
      if (target && (this.emoteWheelEl?.contains(target) || document.getElementById('mm-emote')?.contains(target) || document.getElementById('mobile-emote')?.contains(target))) return;
      this.hideEmoteWheel();
    });
    this.releaseSpiritBtnEl.addEventListener('click', () => {
      if (this.sim.arenaInfo?.match) return;
      this.sim.releaseSpirit();
    });
    document.addEventListener('pointerdown', (ev) => {
      const target = ev.target as Node | null;
      if (!target) return;
      const communityMenu = document.getElementById('community-menu') as HTMLDetailsElement | null;
      if (communityMenu?.open && !communityMenu.contains(target)) {
        communityMenu.open = false;
      }
      if (document.body.classList.contains('mobile-more-open')) {
        const more = document.getElementById('mobile-more');
        const extra = document.getElementById('mobile-extra-controls');
        if (!more?.contains(target) && !extra?.contains(target)) {
          document.body.classList.remove('mobile-more-open');
          document.getElementById('mobile-controls')?.classList.remove('expanded');
          more?.classList.remove('active');
        }
      }
    });
    document.getElementById('mobile-more-close')?.addEventListener('click', () => {
      document.body.classList.remove('mobile-more-open');
      document.getElementById('mobile-controls')?.classList.remove('expanded');
      document.getElementById('mobile-more')?.classList.remove('active');
    });
    // classic MMOs: the player interaction menu opens from the target portrait
    $('#target-frame').addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      const tid = this.sim.player.targetId;
      const t = tid !== null ? this.sim.entities.get(tid) : null;
      if (t && t.kind === 'player' && t.id !== this.sim.playerId) {
        this.openContextMenu(t.id, t.name, (ev as MouseEvent).clientX, (ev as MouseEvent).clientY);
      } else if (t && t.kind === 'mob' && t.ownerId === this.sim.playerId) {
        this.openPetMenu(t.id, t.name, t.dead, (ev as MouseEvent).clientX, (ev as MouseEvent).clientY);
      } else if (t && t.kind === 'mob' && !t.dead && t.hostile && t.ownerId === null && this.sim.partyInfo) {
        // classic MMOs: right-click an enemy's unit frame to set a raid marker.
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
    const emoteBtn = $('#mm-emote');
    emoteBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      this.toggleEmoteWheel();
    });
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
    const startZoneName = zoneDisplayName(startZone.id);
    this.lastZoneId = startZone.id;
    this.showBanner(startZoneName);
    this.log(t('hud.core.welcomeZone', { zone: startZoneName }), '#ffd100');
    this.logZoneWelcome(startZone);
    this.log('Tip: type /join world or /join lfg to chat with players across the realm.', '#7fd4ff');
  }

  private setText(el: HTMLElement, text: string): void {
    if (this.hotWriteCache.get(el) === text) { this.hotDomSkippedWrites++; return; }
    this.hotWriteCache.set(el, text);
    this.hotDomWrites++;
    el.textContent = text;
  }

  private setDisplay(el: HTMLElement, display: string): void {
    const key = `display:${display}`;
    if (this.hotWriteCache.get(el) === key) { this.hotDomSkippedWrites++; return; }
    this.hotWriteCache.set(el, key);
    this.hotDomWrites++;
    el.style.display = display;
  }

  private setTransform(el: HTMLElement, transform: string): void {
    const key = `transform:${transform}`;
    if (this.hotWriteCache.get(el) === key) { this.hotDomSkippedWrites++; return; }
    this.hotWriteCache.set(el, key);
    this.hotDomWrites++;
    el.style.transform = transform;
  }

  private setWidth(el: HTMLElement, width: string): void {
    const key = `width:${width}`;
    if (this.hotWriteCache.get(el) === key) { this.hotDomSkippedWrites++; return; }
    this.hotWriteCache.set(el, key);
    this.hotDomWrites++;
    el.style.width = width;
  }

  perfStats(): { hotDomWrites: number; hotDomSkippedWrites: number; hotDomSkipRate: number } {
    const total = this.hotDomWrites + this.hotDomSkippedWrites;
    return {
      hotDomWrites: this.hotDomWrites,
      hotDomSkippedWrites: this.hotDomSkippedWrites,
      hotDomSkipRate: total > 0 ? Math.round((this.hotDomSkippedWrites / total) * 1000) / 1000 : 0,
    };
  }

  private initWindowManagement(): void {
    const observeWindow = (el: HTMLElement) => {
      this.windowObserver?.observe(el, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    };
    this.windowObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          m.addedNodes.forEach((node) => {
            if (!(node instanceof HTMLElement)) return;
            if (node.matches('.window.panel')) observeWindow(node);
            node.querySelectorAll<HTMLElement>('.window.panel').forEach(observeWindow);
          });
          continue;
        }
        if (m.target instanceof HTMLElement && m.target.matches('.window.panel')) {
          this.syncWindowOpenState(m.target);
        }
      }
    });
    document.querySelectorAll<HTMLElement>('.window.panel').forEach(observeWindow);
    this.windowObserver.observe(document.body, { childList: true, subtree: true });
    this.syncAnyWindowOpenState();

    document.addEventListener('pointerdown', (ev) => {
      const target = ev.target as HTMLElement | null;
      const el = target?.closest?.('.window.panel') as HTMLElement | null;
      if (!el) return;
      this.bringWindowToFront(el);
      if (ev.button !== 0 || !target || !this.isWindowDragHandle(target, el)) return;
      ev.preventDefault();
      this.hideTooltip();
      const rect = el.getBoundingClientRect();
      this.setWindowPixelPosition(el, rect.left, rect.top, rect);
      this.windowDrag = { el, pointerId: ev.pointerId, offsetX: ev.clientX - rect.left, offsetY: ev.clientY - rect.top };
      el.classList.add('window-dragging');
      el.dataset.windowMoved = '1';
      try { target.setPointerCapture?.(ev.pointerId); } catch { /* synthetic/legacy pointer without active capture */ }
    });
    document.addEventListener('pointermove', (ev) => {
      const drag = this.windowDrag;
      if (!drag || drag.pointerId !== ev.pointerId) return;
      ev.preventDefault();
      const rect = drag.el.getBoundingClientRect();
      this.setWindowPixelPosition(drag.el, ev.clientX - drag.offsetX, ev.clientY - drag.offsetY, rect);
    });
    const endDrag = (ev: PointerEvent) => {
      const drag = this.windowDrag;
      if (!drag || drag.pointerId !== ev.pointerId) return;
      drag.el.classList.remove('window-dragging');
      this.windowDrag = null;
    };
    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);
    window.addEventListener('resize', () => {
      document.querySelectorAll<HTMLElement>('.window.panel').forEach((el) => {
        if (!this.isWindowVisible(el) || el.dataset.windowMoved !== '1') return;
        const rect = el.getBoundingClientRect();
        this.setWindowPixelPosition(el, rect.left, rect.top, rect);
      });
    });
  }

  private isWindowVisible(el: HTMLElement): boolean {
    if (el.id === 'social-window') return el.classList.contains('open');
    if (el.hidden || el.hasAttribute('hidden')) return false;
    return getComputedStyle(el).display !== 'none';
  }

  private syncWindowOpenState(el: HTMLElement): void {
    if (!this.isWindowVisible(el)) {
      delete el.dataset.windowOpen;
      this.syncAnyWindowOpenState();
      return;
    }
    if (el.dataset.windowOpen !== '1') {
      el.dataset.windowOpen = '1';
      this.placeNewWindow(el);
      this.bringWindowToFront(el);
    }
    this.syncAnyWindowOpenState();
  }

  private syncAnyWindowOpenState(): void {
    const anyOpen = [...document.querySelectorAll<HTMLElement>('.window.panel')]
      .filter((win) => win.id !== 'mobile-extra-controls')
      .some((win) => this.isWindowVisible(win));
    document.body.classList.toggle('mobile-window-open', anyOpen);
  }

  private placeNewWindow(el: HTMLElement): void {
    if (el.dataset.windowMoved === '1' || el.id === 'loot-window') return;
    if (document.body.classList.contains('vendor-open') && (el.id === 'vendor-window' || el.id === 'bags')) return;
    const openCount = [...document.querySelectorAll<HTMLElement>('.window.panel')]
      .filter((win) => win !== el && this.isWindowVisible(win)).length;
    if (openCount <= 0) return;
    const rect = el.getBoundingClientRect();
    const offset = ((openCount - 1) % 8 + 1) * 28;
    this.setWindowPixelPosition(el, rect.left + offset, rect.top + offset, rect);
  }

  private bringWindowToFront(el: HTMLElement): void {
    if (this.windowZ >= 89) this.normalizeWindowZ();
    el.style.zIndex = String(++this.windowZ);
  }

  private normalizeWindowZ(): void {
    const open = [...document.querySelectorAll<HTMLElement>('.window.panel')]
      .filter((el) => this.isWindowVisible(el))
      .sort((a, b) => this.windowZValue(a) - this.windowZValue(b));
    this.windowZ = 50;
    for (const el of open) el.style.zIndex = String(++this.windowZ);
  }

  private windowZValue(el: HTMLElement): number {
    const z = Number.parseInt(el.style.zIndex || getComputedStyle(el).zIndex || '', 10);
    return Number.isFinite(z) ? z : 0;
  }

  private isWindowDragHandle(target: HTMLElement, win: HTMLElement): boolean {
    if (target.closest('button, input, textarea, select, a, .x-btn, .ui-dd, [draggable="true"], #map-canvas, #map-zoom')) return false;
    const title = target.closest('.panel-title');
    if (title && win.contains(title)) return true;
    return win.id === 'map-window' && target === win;
  }

  private setWindowPixelPosition(el: HTMLElement, left: number, top: number, rect = el.getBoundingClientRect()): void {
    const margin = 8;
    const width = Math.min(rect.width, window.innerWidth - margin * 2);
    const height = Math.min(rect.height, window.innerHeight - margin * 2);
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    el.style.left = `${Math.max(margin, Math.min(maxLeft, left))}px`;
    el.style.top = `${Math.max(margin, Math.min(maxTop, top))}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.transform = 'none';
  }

  private topmostOpenWindow(): HTMLElement | null {
    return [...document.querySelectorAll<HTMLElement>('.window.panel')]
      .filter((el) => this.isWindowVisible(el))
      .sort((a, b) => this.windowZValue(b) - this.windowZValue(a))[0] ?? null;
  }

  private closeManagedWindow(el: HTMLElement): void {
    if (this.windowDrag?.el === el) this.windowDrag = null;
    delete el.dataset.windowOpen;
    switch (el.id) {
      case 'confirm-dialog': el.remove(); break;
      case 'options-menu': this.closeOptions(); break;
      case 'social-window': el.classList.remove('open'); this.hideTooltip(); break;
      case 'trade-window': this.sim.tradeCancel(); this.hideTooltip(); break;
      case 'market-window': this.closeMarket(); break;
      case 'vendor-window': this.closeVendor(); break;
      case 'loot-window': this.closeLoot(); break;
      case 'quest-dialog': this.closeQuestDialog(); break;
      case 'bags': el.style.display = 'none'; this.hideTooltip(); this.cancelPetFeed(); break;
      case 'talents-window': el.style.display = 'none'; this.talentStage = null; this.hideTooltip(); break;
      case 'emote-editor': this.closeEmoteEditor(); break;
      default: el.style.display = 'none'; this.hideTooltip(); break;
    }
    this.syncAnyWindowOpenState();
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
  // Emote wheel
  // -------------------------------------------------------------------------

  private emoteWheelKey(): string {
    return `woc_emote_wheel_${this.sim.cfg.playerClass}_${this.sim.player.name}`;
  }

  private emoteWheelVersionKey(): string {
    return `${this.emoteWheelKey()}_v2`;
  }

  private loadEmoteWheelSlots(): OverheadEmoteId[] {
    let raw: unknown = null;
    try { raw = JSON.parse(localStorage.getItem(this.emoteWheelKey()) ?? 'null'); } catch { /* corrupt */ }
    const ids = Array.isArray(raw) ? raw.filter(isOverheadEmoteId) : [];
    const deduped = ids.filter((id, i) => ids.indexOf(id) === i).slice(0, EMOTE_WHEEL_LIMIT);
    let migrated = false;
    try { migrated = localStorage.getItem(this.emoteWheelVersionKey()) === '1'; } catch { /* storage unavailable */ }
    if (deduped.length > 0 && !migrated && !deduped.includes('question')) {
      deduped.splice(2, 0, 'question');
      deduped.length = Math.min(deduped.length, EMOTE_WHEEL_LIMIT);
      try {
        localStorage.setItem(this.emoteWheelKey(), JSON.stringify(deduped));
        localStorage.setItem(this.emoteWheelVersionKey(), '1');
      } catch { /* storage unavailable */ }
    }
    return deduped.length > 0 ? deduped : [...DEFAULT_EMOTE_WHEEL];
  }

  private saveEmoteWheelSlots(): void {
    try {
      localStorage.setItem(this.emoteWheelKey(), JSON.stringify(this.emoteWheelSlots));
      localStorage.setItem(this.emoteWheelVersionKey(), '1');
    } catch { /* storage unavailable */ }
  }

  private emoteLabel(id: OverheadEmoteId): string {
    return OVERHEAD_EMOTES.find((e) => e.id === id)?.label ?? id;
  }

  private emoteWheelKeyLabel(): string {
    return this.keybinds.primaryLabel('emoteWheel') || 'X';
  }

  private emoteWheelDisplayLabel(id: OverheadEmoteId): string {
    return `${this.emoteLabel(id)} (${this.emoteWheelKeyLabel()})`;
  }

  /** Tap-to-toggle the pinned emote wheel — used by the menu-bar and on-screen
   *  touch Emote buttons (touch has no key to hold, so the wheel stays pinned
   *  until a slice or the outside is tapped). */
  toggleEmoteWheel(): void {
    if (this.emoteWheelOpen && this.emoteWheelPinned) {
      this.hideEmoteWheel();
      return;
    }
    this.showEmoteWheel(true);
  }

  setEmoteWheelOpen(open: boolean): void {
    if (open) {
      if (this.emoteWheelOpen) return;
      this.closeContextMenu();
      this.hideTooltip();
      this.showEmoteWheel(false);
      return;
    }
    if (!this.emoteWheelOpen) return;
    const picked = this.emoteWheelHover;
    this.hideEmoteWheel();
    if (picked === 'edit') this.openEmoteEditor();
    else if (picked) {
      this.sim.playEmote(picked);
      audio.click();
    }
  }

  private selectEmoteWheelChoice(choice: OverheadEmoteId | 'edit'): void {
    this.hideEmoteWheel();
    if (choice === 'edit') this.openEmoteEditor();
    else {
      this.sim.playEmote(choice);
      audio.click();
    }
  }

  private showEmoteWheel(pinned = false): void {
    let el = this.emoteWheelEl;
    if (!el) {
      el = document.createElement('div');
      el.id = 'emote-wheel';
      document.getElementById('ui')?.appendChild(el);
      this.emoteWheelEl = el;
    }
    const slots = this.emoteWheelSlots.filter(isOverheadEmoteId).slice(0, EMOTE_WHEEL_LIMIT);
    el.innerHTML = `<div class="emote-wheel-ring"></div><button class="emote-wheel-edit" data-edit>Edit</button>`;
    slots.forEach((id, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'emote-wheel-item';
      btn.dataset.emote = id;
      btn.title = this.emoteLabel(id);
      const icon = document.createElement('img');
      icon.className = 'emote-wheel-icon';
      icon.src = emoteIconUrl(id);
      icon.alt = '';
      const label = document.createElement('span');
      label.className = 'emote-wheel-label';
      label.textContent = this.emoteLabel(id);
      btn.append(icon, label);
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.selectEmoteWheelChoice(id);
      });
      const angle = -Math.PI / 2 + (i / Math.max(1, slots.length)) * Math.PI * 2;
      btn.style.left = `${50 + Math.cos(angle) * 39}%`;
      btn.style.top = `${50 + Math.sin(angle) * 39}%`;
      el.appendChild(btn);
    });
    el.querySelector<HTMLButtonElement>('.emote-wheel-edit')?.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.selectEmoteWheelChoice('edit');
    });
    this.emoteWheelOpen = true;
    this.emoteWheelPinned = pinned;
    this.emoteWheelHover = null;
    el.style.display = 'block';
  }

  private hideEmoteWheel(): void {
    this.emoteWheelOpen = false;
    this.emoteWheelPinned = false;
    this.emoteWheelHover = null;
    if (this.emoteWheelEl) this.emoteWheelEl.style.display = 'none';
  }

  private updateEmoteWheelPointer(x: number, y: number): void {
    const el = this.emoteWheelEl;
    if (!el || !this.emoteWheelOpen) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.hypot(dx, dy);
    let hover: OverheadEmoteId | 'edit' | null = null;
    if (dist <= 44) {
      hover = 'edit';
    } else if (dist >= 58 && dist <= rect.width * 0.58 && this.emoteWheelSlots.length > 0) {
      const angle = (Math.atan2(dy, dx) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
      const idx = Math.round(angle / (Math.PI * 2) * this.emoteWheelSlots.length) % this.emoteWheelSlots.length;
      hover = this.emoteWheelSlots[idx] ?? null;
    }
    this.emoteWheelHover = hover;
    el.querySelector('.emote-wheel-edit')?.classList.toggle('selected', hover === 'edit');
    el.querySelectorAll<HTMLElement>('.emote-wheel-item').forEach((item) => {
      item.classList.toggle('selected', item.dataset.emote === hover);
    });
  }

  private openEmoteEditor(): void {
    this.closeOtherWindows('#emote-editor');
    this.renderEmoteEditor();
    $('#emote-editor').style.display = 'block';
  }

  private closeEmoteEditor(): void {
    $('#emote-editor').style.display = 'none';
    this.hideTooltip();
  }

  private renderEmoteEditor(): void {
    const el = $('#emote-editor');
    el.innerHTML = `<div class="panel-title"><span>Emotes</span><span class="x-btn" data-close>${svgIcon('close')}</span></div>`;
    const count = document.createElement('div');
    count.className = 'emote-editor-count';
    const grid = document.createElement('div');
    grid.className = 'emote-editor-grid';
    const selected = new Set(this.emoteWheelSlots);
    const syncCount = () => { count.textContent = `${selected.size}/${EMOTE_WHEEL_LIMIT}`; };
    const syncButtons = () => {
      grid.querySelectorAll<HTMLButtonElement>('.emote-editor-item').forEach((b) => {
        const id = b.dataset.emote;
        const on = !!id && selected.has(id as OverheadEmoteId);
        b.classList.toggle('selected', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.disabled = !on && selected.size >= EMOTE_WHEEL_LIMIT;
      });
    };
    for (const def of OVERHEAD_EMOTES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'emote-editor-item';
      btn.dataset.emote = def.id;
      const icon = document.createElement('img');
      icon.className = 'emote-editor-icon';
      icon.src = emoteIconUrl(def.id);
      icon.alt = '';
      const label = document.createElement('span');
      label.textContent = def.label;
      btn.append(icon, label);
      btn.addEventListener('click', () => {
        audio.click();
        if (selected.has(def.id)) selected.delete(def.id);
        else if (selected.size < EMOTE_WHEEL_LIMIT) selected.add(def.id);
        this.emoteWheelSlots = OVERHEAD_EMOTES.map((e) => e.id).filter((id): id is OverheadEmoteId => selected.has(id));
        this.saveEmoteWheelSlots();
        syncCount();
        syncButtons();
      });
      grid.appendChild(btn);
    }
    syncCount();
    syncButtons();
    const footer = document.createElement('div');
    footer.className = 'emote-editor-footer';
    const done = document.createElement('button');
    done.className = 'btn';
    done.textContent = 'Done';
    done.addEventListener('click', () => this.closeEmoteEditor());
    footer.append(count, done);
    el.append(grid, footer);
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeEmoteEditor());
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
    const parts = moneyParts(copper);
    const coin = (value: number, cls: 'g' | 's' | 'c', unitKey: TranslationKey): string =>
      `<span class="coin-part"><span class="coin-amount">${esc(formatNumber(value, { maximumFractionDigits: 0 }))}</span><span class="coin ${cls}" aria-hidden="true"></span><span class="visually-hidden">${esc(t(unitKey))}</span></span>`;
    let html = '';
    if (parts.gold > 0) html += coin(parts.gold, 'g', 'itemUi.money.gold');
    if (parts.silver > 0 || parts.gold > 0) html += coin(parts.silver, 's', 'itemUi.money.silver');
    html += coin(parts.copper, 'c', 'itemUi.money.copper');
    return `<span class="money-inline" aria-label="${esc(formatLocalizedMoney(copper, 'long'))}">${html}</span>`;
  }

  attachTooltip(el: HTMLElement, html: () => string): void {
    let touchTimer: number | undefined;
    const mobile = () => document.body.classList.contains('mobile-touch');
    const clearTouchTimer = () => {
      if (touchTimer !== undefined) window.clearTimeout(touchTimer);
      touchTimer = undefined;
    };
    const showAt = (x: number, y: number, trigger: 'touch' | 'mouse' | 'focus') => {
      // Touch-only path: showing the tooltip means the held control is being
      // inspected, so the release click should peek, not fire its action.
      this.peekGuard.tooltipShown(trigger);
      this.tooltipEl.innerHTML = html();
      this.tooltipEl.style.display = 'block';
      const tw = this.tooltipEl.offsetWidth, th = this.tooltipEl.offsetHeight;
      this.tooltipEl.style.left = `${Math.max(8, Math.min(window.innerWidth - tw - 8, x + 14))}px`;
      this.tooltipEl.style.top = `${Math.max(8, y - th - 10)}px`;
    };
    const showNearElement = () => {
      const rect = el.getBoundingClientRect();
      showAt(rect.right, rect.top + rect.height / 2, 'focus');
    };
    el.addEventListener('mouseenter', () => {
      if (mobile()) return;
      const rect = el.getBoundingClientRect();
      showAt(rect.right, rect.top + rect.height / 2, 'mouse');
    });
    el.addEventListener('mousemove', (e) => {
      if (mobile()) return;
      const tw = this.tooltipEl.offsetWidth, th = this.tooltipEl.offsetHeight;
      this.tooltipEl.style.left = `${Math.min(window.innerWidth - tw - 8, e.clientX + 14)}px`;
      this.tooltipEl.style.top = `${Math.max(8, e.clientY - th - 10)}px`;
    });
    el.addEventListener('mouseleave', () => { clearTouchTimer(); this.tooltipEl.style.display = 'none'; });
    el.addEventListener('focusin', showNearElement);
    el.addEventListener('focusout', () => { clearTouchTimer(); this.tooltipEl.style.display = 'none'; });
    el.addEventListener('pointerdown', (e) => {
      if (!mobile() || e.pointerType === 'mouse') return;
      clearTouchTimer();
      // A fresh press: drop any stale peek and dismiss a lingering tooltip.
      this.peekGuard.press();
      this.tooltipEl.style.display = 'none';
      const x = e.clientX, y = e.clientY;
      touchTimer = window.setTimeout(() => showAt(x, y, 'touch'), TOOLTIP_PEEK_MS);
    });
    el.addEventListener('pointerup', clearTouchTimer);
    el.addEventListener('pointercancel', clearTouchTimer);
  }

  hideTooltip(): void {
    this.tooltipEl.style.display = 'none';
  }

  private itemTooltip(item: ItemDef): string {
    const qColor = QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff';
    let html = `<div class="tt-title" style="color:${qColor}">${esc(itemDisplayName(item))}</div>`;
    html += `<div class="tt-sub">${esc(t('itemUi.tooltip.qualityKind', {
      quality: itemQualityLabel(item.quality),
      kind: itemKindLabel(item.kind),
    }))}</div>`;
    if (item.slot) {
      html += `<div class="tt-sub">${esc(itemSlotName(item.slot))}</div>`;
    }
    if (item.weapon) {
      const dps = (item.weapon.min + item.weapon.max) / 2 / item.weapon.speed;
      html += `<div class="tt-stat">${esc(t('itemUi.tooltip.damageSpeed', {
        min: itemNumber(item.weapon.min),
        max: itemNumber(item.weapon.max),
        speed: itemNumber(item.weapon.speed, 1),
      }))}</div>`;
      html += `<div class="tt-stat">${esc(t('itemUi.tooltip.dps', { dps: itemNumber(dps, 1) }))}</div>`;
      if (item.weapon.dagger) html += `<div class="tt-sub">${esc(t('itemUi.tooltip.dagger'))}</div>`;
    }
    if (item.stats) {
      for (const [k, v] of Object.entries(item.stats)) {
        if (v === undefined) continue;
        if (k === 'armor') {
          html += `<div class="tt-stat">${esc(t('itemUi.tooltip.armorStat', { value: itemNumber(v) }))}</div>`;
        } else {
          html += `<div class="tt-green">${esc(t('itemUi.tooltip.stat', {
            value: itemNumber(v),
            stat: itemStatName(k),
          }))}</div>`;
        }
      }
    }
    if (item.foodHp) html += `<div class="tt-desc">${esc(t('itemUi.tooltip.useFood', { amount: itemNumber(item.foodHp), seconds: itemNumber(CONSUME_DURATION) }))}</div>`;
    if (item.drinkMana) html += `<div class="tt-desc">${esc(t('itemUi.tooltip.useDrink', { amount: itemNumber(item.drinkMana), seconds: itemNumber(CONSUME_DURATION) }))}</div>`;
    if (item.use?.type === 'fishing') html += `<div class="tt-desc">${esc(t('itemUi.tooltip.useFishing'))}</div>`;
    if (item.potionHp) html += `<div class="tt-desc">${esc(t('itemUi.tooltip.useHealingPotion', { amount: itemNumber(item.potionHp) }))}</div>`;
    if (item.potionMana) html += `<div class="tt-desc">${esc(t('itemUi.tooltip.useManaPotion', { amount: itemNumber(item.potionMana) }))}</div>`;
    if (item.kind === 'quest') html += `<div class="tt-desc">${esc(t('itemUi.tooltip.questItem'))}</div>`;
    if (item.requiredClass) {
      html += `<div class="tt-sub">${esc(t('itemUi.tooltip.classes', { classes: item.requiredClass.map(classDisplayName).join(', ') }))}</div>`;
    }
    if (item.sellValue > 0) html += `<div class="tt-sub">${esc(t('itemUi.tooltip.sellPrice', { money: formatLocalizedMoney(item.sellValue) }))}</div>`;
    return html;
  }

  private questNumber(value: number): string {
    return formatNumber(value, { maximumFractionDigits: 0 });
  }

  private questProgressText(label: string, current: number, total: number): string {
    return t('questUi.detail.objectiveProgress', {
      label,
      current: this.questNumber(current),
      total: this.questNumber(total),
    });
  }

  private questSuggestedPlayersHtml(count?: number): string {
    if (!count) return '';
    return ` <span class="quest-suggested">${esc(t('questUi.log.suggestedPlayers', { count: this.questNumber(count) }))}</span>`;
  }

  private canRestoreFocusTo(target: HTMLElement | null): target is HTMLElement {
    return Boolean(target?.isConnected && target.getClientRects().length > 0);
  }

  private currentFocusableElement(): HTMLElement | null {
    const active = document.activeElement;
    return active instanceof HTMLElement && active !== document.body && this.canRestoreFocusTo(active) ? active : null;
  }

  private restoreFocus(target: HTMLElement | null, fallback?: HTMLElement | null): void {
    const candidate = this.canRestoreFocusTo(target) ? target : this.canRestoreFocusTo(fallback ?? null) ? fallback! : null;
    if (!candidate) return;
    window.setTimeout(() => candidate.focus(), 0);
  }

  private focusFirstInteractive(root: HTMLElement, preferredSelector?: string): void {
    window.setTimeout(() => {
      const target = (preferredSelector ? root.querySelector<HTMLElement>(preferredSelector) : null)
        ?? root.querySelector<HTMLElement>('button:not([disabled]):not([data-close]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      (target ?? root).focus();
    }, 0);
  }

  private refreshLocalizedDynamicUi(): void {
    this.updateQuestTracker();
    const log = $('#quest-log-window');
    if (log.style.display === 'block') this.renderQuestLog();
    if ($('#bags').style.display === 'block') this.renderBags();
    if (this.openVendorNpcId !== null && $('#vendor-window').style.display === 'block') this.renderVendor();
    if (this.marketOpen) {
      this.lastMarketSig = '';
      this.renderMarket();
    }
    if ($('#char-window').style.display === 'block') this.renderChar();
    const dialog = $('#quest-dialog');
    if (dialog.style.display !== 'block' || this.openGossipNpcId === null) return;
    const npc = this.sim.entities.get(this.openGossipNpcId);
    if (!npc) {
      this.closeQuestDialog();
      return;
    }
    if (this.openQuestDetailId && QUESTS[this.openQuestDetailId]) {
      this.renderQuestDetail(npc, this.openQuestDetailId);
    } else {
      this.renderGossip(npc);
    }
  }

  private abilityTooltip(res: ResolvedAbility): string {
    const a = res.def;
    const damageText = abilityEffectText(res.effects);
    let html = `<div class="tt-title">${esc(abilityDisplayName(a))}</div>`;
    html += `<div class="tt-sub">${esc(t('abilityUi.tooltip.rank', { rank: formatAbilityNumber(res.rank) }))}</div>`;
    const costLine: string[] = [];
    if (res.cost > 0) {
      costLine.push(t('abilityUi.tooltip.cost', {
        cost: formatAbilityNumber(res.cost),
        resource: resourceDisplayName(this.sim.player.resourceType),
      }));
    }
    const rangeLine = abilityRangeLine(a);
    if (rangeLine) costLine.push(rangeLine);
    if (costLine.length) html += `<div class="tt-stat">${costLine.map(esc).join(' &nbsp; ')}</div>`;
    const castLine = [abilityCastLine(res)];
    if (a.cooldown > 0) castLine.push(t('abilityUi.tooltip.cooldownSeconds', { seconds: formatAbilityNumber(a.cooldown) }));
    html += `<div class="tt-stat">${castLine.map(esc).join(' &nbsp; ')}</div>`;
    html += `<div class="tt-desc">${esc(abilityDisplayDescription(a, damageText))}</div>`;
    const requirements = abilityRequirementLines(a);
    if (requirements.length) {
      html += requirements.map((line) => `<div class="tt-sub">${esc(line)}</div>`).join('');
    }
    return html;
  }

  // -------------------------------------------------------------------------
  // Action bar
  // -------------------------------------------------------------------------

  // The hotbar layout is a client-side remap over learned abilities and item
  // shortcuts. Abilities are keyed by id (known is class-ordered and shifts on
  // level-up, so indices would not survive). Persisted per class+character,
  // with separate form/stealth layouts because each state has a different kit.
  private slotMapKey(): string {
    const base = `woc_hotbar_${this.sim.cfg.playerClass}_${this.sim.player.name}`;
    return this.activeHotbarForm === 'normal' ? base : `${base}_${this.activeHotbarForm}`;
  }

  private playerHotbarForm(): HotbarForm {
    if (this.sim.cfg.playerClass === 'druid') {
      if (this.sim.player.auras.some((a) => a.kind === 'form_bear')) return 'bear';
      if (this.sim.player.auras.some((a) => a.kind === 'form_cat')) return 'cat';
    }
    if (this.sim.cfg.playerClass === 'rogue' && this.sim.player.auras.some((a) => a.kind === 'stealth')) return 'stealth';
    return 'normal';
  }

  private isHotbarItemId(itemId: string): boolean {
    const item = ITEMS[itemId];
    return item?.kind === 'food' || item?.kind === 'drink' || item?.kind === 'potion' || item?.use?.type === 'fishing';
  }

  private loadSlotMap(): void {
    let arr: unknown = null;
    let stored = false;
    try {
      const raw = localStorage.getItem(this.slotMapKey());
      stored = raw !== null;
      arr = JSON.parse(raw ?? 'null');
    } catch { /* corrupt */ }
    this.loadedSlotMapFromStorage = stored || this.activeHotbarForm !== 'normal';
    this.hotbarActions = parseHotbarActions(
      arr,
      Hud.BAR_ABILITY_SLOTS,
      (id) => !!ABILITIES[id],
      (id) => this.isHotbarItemId(id),
    );
    this.knownAbilityIdsAtLastSlotSync = null;
  }

  private saveSlotMap(): void {
    try { localStorage.setItem(this.slotMapKey(), JSON.stringify(this.hotbarActions)); } catch { /* storage unavailable */ }
  }

  private syncActiveHotbarForm(): void {
    const next = this.playerHotbarForm();
    if (next === this.activeHotbarForm) return;
    this.saveSlotMap();
    this.activeHotbarForm = next;
    this.dragAction = null;
    this.clearActionDropTargets();
    this.loadSlotMap();
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
      this.flashActionSlot(barSlot);
      return;
    }
    const action = this.actionForSlot(barSlot);
    if (action?.type === 'ability') {
      // cast by ability id: the server validates against its own known list,
      // so the client-side slot remap never desyncs slot semantics
      if (this.abilityForSlot(barSlot)) {
        this.sim.castAbility(action.id);
        this.flashActionSlot(barSlot);
      }
    } else if (action?.type === 'item' && this.isHotbarItemId(action.id)) {
      if (this.tradeOpen) return;
      this.sim.useItem(action.id);
      if ($('#bags').style.display !== 'none') this.renderBags();
      this.flashActionSlot(barSlot);
    }
  }

  private flashActionSlot(barSlot: number): void {
    const btn = this.abilityButtons[barSlot]?.btn;
    if (!btn) return;
    this.flashActionButton(btn);
  }

  private flashActionButton(btn: HTMLButtonElement): void {
    btn.classList.remove('used');
    void btn.offsetWidth;
    btn.classList.add('used');
    window.setTimeout(() => btn.classList.remove('used'), 180);
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
        // On touch, the click that ends a long-press peek inspects the slot
        // (tooltip already shown) instead of casting — release dismisses it.
        if (this.peekGuard.consume()) { this.hideTooltip(); btn.blur(); return; }
        audio.click();
        this.castSlot(slot);
        btn.blur();
      });
      btn.addEventListener('keydown', (e) => {
        if (e.key !== ' ' && e.key !== 'Spacebar') return;
        e.preventDefault();
        e.stopPropagation();
      });
      this.attachTooltip(btn, () => {
        if (slot === 0) {
          return `<div class="tt-title">${esc(t('abilityUi.actionBar.attackName'))}</div><div class="tt-sub">${esc(t('abilityUi.actionBar.attackTooltip'))}</div>`;
        }
        const known = this.abilityForSlot(slot);
        const clearHint = `<div class="tt-sub">${esc(t('abilityUi.actionBar.clearHint'))}</div>`;
        if (known) return this.abilityTooltip(known) + clearHint;
        const item = this.itemForSlot(slot);
        if (item) {
          const count = this.inventoryCount(item.id);
          return this.itemTooltip(item)
            + `<div class="tt-sub">${esc(count > 0
              ? t('abilityUi.actionBar.itemInBags', { count: formatNumber(count, { maximumFractionDigits: 0 }) })
              : t('abilityUi.actionBar.itemNoneInBags'))}</div>`
            + clearHint;
        }
        return `<div class="tt-sub">${esc(t('abilityUi.actionBar.emptySlot'))}<br>${esc(t('abilityUi.actionBar.clearHint'))}</div>`;
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
    const sideButtons: [selector: string, action: string, label: string][] = [
      ['#mm-char', 'char', 'Character'],
      ['#mm-spell', 'spellbook', 'Spellbook'],
      ['#mm-talents', 'talents', 'Talents'],
      ['#mm-quest', 'questlog', 'Quest Log'],
      ['#mm-map', 'map', 'Map'],
      ['#mm-bag', 'bags', 'Bags'],
      ['#mm-arena', 'arena', 'Arena'],
      ['#mm-leaderboard', 'leaderboard', 'Leaderboard'],
      ['#mm-emote', 'emoteWheel', 'Emotes'],
      ['#mm-social', 'social', 'Friends'],
    ];
    for (const [selector, action, label] of sideButtons) {
      const btn = document.querySelector<HTMLElement>(selector);
      if (!btn) continue;
      const key = this.keybinds.primaryLabel(action);
      const keyEl = btn.querySelector<HTMLElement>('.keybind');
      if (keyEl) keyEl.textContent = key.toLowerCase();
      btn.setAttribute('aria-label', key ? `${label} (${key})` : label);
    }
  }

  private buildXpTicks(): void {
    const ticks = $('#xpbar .ticks');
    for (let i = 0; i < 20; i++) ticks.appendChild(document.createElement('i'));
  }

  private ownPet(): Entity | null {
    for (const e of this.sim.entities.values()) {
      if (e.kind === 'mob' && e.ownerId === this.sim.playerId) return e;
    }
    return null;
  }

  private renderPetBar(): void {
    const bar = $('#petbar') as HTMLElement;
    const pet = this.ownPet();
    if (!pet || pet.dead) {
      bar.style.display = 'none';
      if (this.lastPetBarSig !== '') {
        bar.innerHTML = '';
        this.lastPetBarSig = '';
      }
      return;
    }
    const mode = pet.petMode ?? 'defensive';
    const cd = Math.ceil(Math.max(0, pet.petTauntTimer));
    const ownerClass = this.sim.cfg.playerClass;
    const sig = `${pet.id}:${ownerClass}:${mode}:${cd}:${this.pendingPetFeed ? 'feed' : ''}:${this.petModeMenuOpen ? 'modes' : ''}`;
    bar.style.display = 'flex';
    if (sig === this.lastPetBarSig) return;
    this.lastPetBarSig = sig;
    bar.innerHTML = '';
    const commands = document.createElement('div');
    commands.className = 'petbar-group';
    const stances = document.createElement('div');
    stances.className = 'petbar-group';
    bar.append(commands, stances);
    const petTooltip = (title: string, desc: string): string =>
      `<div class="tt-title">${esc(title)}</div><div class="tt-desc">${esc(desc)}</div>`;
    const petModeLabel = (m: PetMode): string => t(PET_MODE_LABEL_KEYS[m]);
    const addButton = (parent: HTMLElement, iconId: string, title: string, tooltip: string, onClick: () => void, opts: { active?: boolean; cooldownText?: string } = {}) => {
      const btn = document.createElement('button');
      btn.className = 'pet-btn';
      if (opts.active) btn.classList.add('active');
      if (opts.cooldownText) btn.classList.add('cooldown');
      btn.title = title;
      const icon = document.createElement('span');
      icon.className = 'icon-label';
      icon.style.backgroundImage = `url(${iconDataUrl('ability', iconId)})`;
      btn.appendChild(icon);
      if (opts.cooldownText) {
        const cdText = document.createElement('span');
        cdText.className = 'cdtext';
        cdText.textContent = opts.cooldownText;
        btn.appendChild(cdText);
      }
      btn.addEventListener('click', () => {
        if (opts.cooldownText) return;
        audio.click();
        onClick();
      });
      this.attachTooltip(btn, () => tooltip);
      parent.appendChild(btn);
    };
    addButton(commands, 'attack', t('hud.pet.attack'), petTooltip(t('hud.pet.petAttackTitle'), t('hud.pet.petAttackDesc')), () => this.sim.petAttack());
    addButton(commands, 'growl', t('hud.pet.taunt'), petTooltip(t('hud.pet.petTauntTitle'), t('hud.pet.petTauntDesc')), () => this.sim.petTaunt(), { cooldownText: cd > 0 ? `${cd}` : undefined });
    if (ownerClass === 'warlock') {
      addButton(commands, 'drain_life', t('hud.pet.healDemon'), petTooltip(t('hud.pet.healDemon'), t('hud.pet.healDemonDesc')), () => {
        this.sim.healPet();
      });
    } else {
      addButton(commands, 'rejuvenation', t('hud.pet.healPet'), petTooltip(t('hud.pet.healPet'), t('hud.pet.healPetDesc')), () => {
        // Toggle: a second click cancels the pending feed instead of trapping
        // the player in food-selection mode.
        if (this.pendingPetFeed) { this.cancelPetFeed(); return; }
        // With no edible food there is nothing to select, so entering feed mode
        // would strand the player on the bag screen — surface an error instead.
        if (!this.hasPetFood()) { this.showError(t('hud.pet.noPetFood')); return; }
        this.pendingPetFeed = true;
        this.lastPetBarSig = '';
        $('#bags').style.display = 'block';
        this.renderBags();
      }, { active: this.pendingPetFeed });
    }
    const modes: { mode: PetMode; labelKey: TranslationKey; descKey: TranslationKey }[] = [
      { mode: 'passive', labelKey: PET_MODE_LABEL_KEYS.passive, descKey: PET_MODE_DESC_KEYS.passive },
      { mode: 'defensive', labelKey: PET_MODE_LABEL_KEYS.defensive, descKey: PET_MODE_DESC_KEYS.defensive },
      { mode: 'aggressive', labelKey: PET_MODE_LABEL_KEYS.aggressive, descKey: PET_MODE_DESC_KEYS.aggressive },
    ];
    const modeIcons: Record<PetMode, string> = { passive: 'prowl', defensive: 'defensive_stance', aggressive: 'rapid_fire' };
    addButton(stances, modeIcons[mode], petModeLabel(mode), petTooltip(`${t('hud.pet.stanceTitle')}: ${petModeLabel(mode)}`, t('hud.pet.stanceDesc')), () => {
      this.petModeMenuOpen = !this.petModeMenuOpen;
      this.lastPetBarSig = '';
    }, { active: true });
    if (!this.petModeMenuOpen) return;
    for (const entry of modes) {
      addButton(stances, modeIcons[entry.mode], t(entry.labelKey), petTooltip(t(entry.labelKey), t(entry.descKey)), () => {
        this.sim.setPetMode(entry.mode);
        this.petModeMenuOpen = false;
        this.lastPetBarSig = '';
      }, { active: mode === entry.mode });
    }
  }

  // -------------------------------------------------------------------------
  // Frame update
  // -------------------------------------------------------------------------

  update(): void {
    const sim = this.sim;
    const p = sim.player;
    const now = performance.now();
    const fastHud = now - this.lastHudFastAt >= 100;
    if (fastHud) this.lastHudFastAt = now;
    const mediumHud = now - this.lastHudMediumAt >= 250;
    if (mediumHud) this.lastHudMediumAt = now;
    const slowHud = now - this.lastHudSlowAt >= 500;
    if (slowHud) this.lastHudSlowAt = now;

    this.meters.update();
    this.syncActiveHotbarForm();
    this.syncSlotMap(); // picks up newly learned abilities mid-session

    // talent buttons glow while the player has unspent points (and a tree exists)
    const tp = sim.talentPoints();
    const talGlow = talentsFor(sim.cfg.playerClass) !== null && tp.spent < tp.total;
    document.getElementById('mm-talents')?.classList.toggle('has-points', talGlow);
    document.getElementById('mobile-talents')?.classList.toggle('has-points', talGlow);

    // player frame
    this.setText(this.pfLevelEl, String(p.level));
    this.setTransform(this.pfHpEl, `scaleX(${p.hp / Math.max(1, p.maxHp)})`);
    this.setText(this.pfHpTextEl, `${p.hp} / ${p.maxHp}`);
    const resFrac = p.resource / Math.max(1, p.maxResource);
    this.setTransform(this.pfResEl, `scaleX(${resFrac})`);
    this.setText(this.pfResTextEl, `${Math.round(p.resource)} / ${p.maxResource}`);
    const resClass = 'bar ' + (p.resourceType === 'rage' ? 'rage' : p.resourceType === 'energy' ? 'energy' : 'mana');
    if (this.pfResourceEl.className !== resClass) this.pfResourceEl.className = resClass;

    // buff bar (player buffs + debuffs)
    this.renderAuras(this.buffBarEl, p, 'all');

    // target frame
    const target = p.targetId !== null ? sim.entities.get(p.targetId) : null;
    if (target && target.kind !== 'object') {
      this.setDisplay(this.targetFrameEl, 'flex');
      this.targetFrameEl.classList.toggle('elite', !!MOBS[target.templateId]?.elite);
      this.setText(this.targetEliteTagEl, MOBS[target.templateId]?.boss ? t('hud.core.boss') : t('hud.core.elite'));
      this.setText(this.targetNameEl, entityDisplayName(target));
      this.setText(this.targetLevelEl, MOBS[target.templateId]?.boss ? '☠' : String(target.level));
      this.setTransform(this.targetHpEl, `scaleX(${target.hp / Math.max(1, target.maxHp)})`);
      this.setText(this.targetHpTextEl, target.dead ? t('hud.core.dead') : `${target.hp} / ${target.maxHp}`);
      const targetNameColor = target.hostile ? 'var(--color-hostile)' : 'var(--color-friendly)';
      if (this.targetNameEl.style.color !== targetNameColor) this.targetNameEl.style.color = targetNameColor;
      if (this.lastPortraitTarget !== target.id) {
        this.lastPortraitTarget = target.id;
        const crestId = target.kind === 'npc'
          ? 'status_npc'
          : `family_${MOBS[target.templateId]?.family ?? 'humanoid'}`;
        this.drawPortrait(this.targetPortraitEl, crestId);
      }
      this.renderAuras(this.targetDebuffsEl, target, 'debuffs');
      // combo points
      if (p.resourceType === 'energy') {
        this.setDisplay(this.comboRowEl, 'flex');
        if (this.comboRowEl.children.length !== 5) {
          this.comboRowEl.innerHTML = '';
          for (let i = 0; i < 5; i++) {
            const pip = document.createElement('div');
            pip.className = 'combo-pip';
            this.comboRowEl.appendChild(pip);
          }
        }
        const points = p.comboTargetId === target.id ? p.comboPoints : 0;
        [...this.comboRowEl.children].forEach((pip, i) => pip.classList.toggle('on', i < points));
      } else {
        this.setDisplay(this.comboRowEl, 'none');
      }
    } else {
      this.setDisplay(this.targetFrameEl, 'none');
      this.lastPortraitTarget = -999;
    }

    // cast bar
    if (p.castingAbility) {
      this.setDisplay(this.castbarEl, 'block');
      this.castbarEl.classList.toggle('channel', p.channeling);
      const frac = p.channeling
        ? p.castRemaining / Math.max(0.01, p.castTotal)
        : 1 - p.castRemaining / Math.max(0.01, p.castTotal);
      this.setWidth(this.castbarFillEl, `${(frac * 100).toFixed(1)}%`);
      this.setText(this.castbarLabelEl, castDisplayName(p.castingAbility));
      this.setText(this.castbarTimerEl, formatNumber(Math.max(0, p.castRemaining), { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
    } else if (p.eating || p.drinking) {
      this.setDisplay(this.castbarEl, 'block');
      this.castbarEl.classList.add('channel');
      const c = p.eating && p.drinking
        ? (p.eating.remaining >= p.drinking.remaining ? p.eating : p.drinking)
        : (p.eating ?? p.drinking)!;
      this.setWidth(this.castbarFillEl, `${((c.remaining / CONSUME_DURATION) * 100).toFixed(1)}%`);
      this.setText(this.castbarLabelEl, p.eating && p.drinking ? t('hud.core.eatingDrinking') : p.eating ? t('hud.core.eating') : t('hud.core.drinking'));
      this.setText(this.castbarTimerEl, formatNumber(Math.max(0, c.remaining), { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
    } else {
      this.setDisplay(this.castbarEl, 'none');
      this.castbarEl.classList.remove('channel');
      this.setWidth(this.castbarFillEl, '0%');
      this.setText(this.castbarLabelEl, '');
      this.setText(this.castbarTimerEl, '');
    }

    // action bar
    this.renderPetBar();
    const tgtDist = target && !target.dead ? dist2d(p.pos, target.pos) : null;
    this.actionbarEl.classList.toggle('many-spells', this.hotbarActions.filter((action) => action !== null).length > 10);
    for (let i = 0; i < this.abilityButtons.length; i++) {
      const ab = this.abilityButtons[i];
      const slotLabel = formatAbilityNumber(i + 1);
      if (i === 0) {
        // Attack button: glows while auto-attacking, red-edged out of range
        ab.btn.classList.remove('empty', 'unusable');
        ab.btn.setAttribute('aria-label', t('abilityUi.actionBar.slotAria', {
          slot: slotLabel,
          ability: t('abilityUi.actionBar.attackName'),
        }));
        if (ab.lastIcon !== '__attack') {
          ab.lastIcon = '__attack';
          ab.label.style.backgroundImage = `url(${iconDataUrl('ability', 'attack')})`;
        }
        this.setText(ab.countEl, '');
        if (ab.cdOverlay.style.height !== '0%') ab.cdOverlay.style.height = '0%';
        this.setText(ab.cdText, '');
        ab.btn.classList.toggle('queued', !!p.autoAttack);
        ab.btn.classList.toggle('oor', tgtDist !== null && tgtDist > MELEE_RANGE);
        continue;
      }
      const action = this.actionForSlot(i);
      const known = this.abilityForSlot(i);
      const item = this.itemForSlot(i);
      if (!known && !item) {
        ab.btn.classList.add('empty');
        ab.btn.setAttribute('aria-label', t('abilityUi.actionBar.emptySlotAria', { slot: slotLabel }));
        ab.btn.classList.remove('unusable', 'oor', 'queued');
        if (ab.lastIcon !== '') {
          ab.lastIcon = '';
          ab.label.style.backgroundImage = '';
        }
        this.setText(ab.countEl, '');
        if (ab.cdOverlay.style.height !== '0%') ab.cdOverlay.style.height = '0%';
        this.setText(ab.cdText, '');
        continue;
      }
      ab.btn.classList.remove('empty');
      if (item && action?.type === 'item') {
        ab.btn.setAttribute('aria-label', t('abilityUi.actionBar.slotAria', {
          slot: slotLabel,
          ability: itemDisplayName(item),
        }));
        const iconKey = `item:${item.id}`;
        if (ab.lastIcon !== iconKey) {
          ab.lastIcon = iconKey;
          ab.label.style.backgroundImage = `url(${iconDataUrl('item', item.id)})`;
        }
        const count = this.inventoryCount(item.id);
        this.setText(ab.countEl, String(count));
        if (ab.cdOverlay.style.height !== '0%') ab.cdOverlay.style.height = '0%';
        this.setText(ab.cdText, '');
        ab.btn.classList.toggle('unusable', count <= 0 || p.dead);
        ab.btn.classList.remove('oor', 'queued');
        continue;
      }
      const a = known!.def;
      ab.btn.setAttribute('aria-label', t('abilityUi.actionBar.slotAria', {
        slot: slotLabel,
        ability: abilityDisplayName(a),
      }));
      // set the painted icon once per slot change, not every frame
      const iconKey = `ability:${a.id}`;
      if (ab.lastIcon !== iconKey) {
        ab.lastIcon = iconKey;
        ab.label.style.backgroundImage = `url(${iconDataUrl('ability', a.id)})`;
      }
      this.setText(ab.countEl, '');
      const cd = p.cooldowns.get(a.id) ?? 0;
      const gcdActive = !a.offGcd && p.gcdRemaining > 0;
      const shown = Math.max(cd, gcdActive ? p.gcdRemaining : 0);
      const denom = cd > 0 ? a.cooldown : GCD;
      const cdHeight = shown > 0 ? `${Math.min(100, (shown / Math.max(0.01, denom)) * 100)}%` : '0%';
      if (ab.cdOverlay.style.height !== cdHeight) ab.cdOverlay.style.height = cdHeight;
      this.setText(ab.cdText, cd > 1 ? Math.ceil(cd).toString() : '');
      ab.btn.classList.toggle('unusable', p.resource < known!.cost);
      const oor = a.requiresTarget && tgtDist !== null && tgtDist > (a.range > 0 ? a.range : MELEE_RANGE);
      ab.btn.classList.toggle('oor', !!oor);
      ab.btn.classList.toggle('queued', p.queuedOnSwing === a.id);
    }

    // xp bar — pre-cap shows the level bar; post-cap fills toward the next
    // virtual level (Max-Level XP Overflow), with distinct prestige/gold styling.
    const showOverflow = (this.optionsHooks?.settings.get('showOverflowXp') ?? 1) >= 0.5;
    const bar = xpBarView({ level: p.level, xp: sim.xp, lifetimeXp: sim.lifetimeXp, showOverflow });
    this.setWidth(this.xpFillEl, `${(bar.fillFrac * 100).toFixed(1)}%`);
    $('#xpbar').style.setProperty('--xp-fill', bar.fillFrac.toFixed(4));
    $('#player-frame').style.setProperty('--xp-fill', bar.fillFrac.toFixed(4));
    this.setText(this.xpLabelEl, bar.label);
    $('#xpbar').classList.toggle('overflow', bar.postCap);

    const deadInArena = p.dead && !!this.sim.arenaInfo?.match;
    this.setDisplay(this.deathOverlayEl, p.dead ? 'flex' : 'none');
    this.setDisplay(this.releaseSpiritBtnEl, deadInArena ? 'none' : '');

    const inDungeon = p.pos.x > DUNGEON_X_THRESHOLD;
    const currentZone = zoneAt(p.pos.z);
    if (mediumHud) {
      // zone transitions: banner + welcome hint when crossing into a new band.
      // A ~5yd dead-band past the boundary stops a player straddling the border
      // from re-triggering the banner/log (and the map canvas regen) every step.
      if (!inDungeon && currentZone.id !== this.lastZoneId) {
        const lastZone = ZONES.find((z) => z.id === this.lastZoneId);
        const pastDeadBand = !lastZone
          || p.pos.z < lastZone.zMin - ZONE_BANNER_DEADBAND
          || p.pos.z >= lastZone.zMax + ZONE_BANNER_DEADBAND;
        if (pastDeadBand) {
          if (this.lastZoneId !== '') {
            const currentZoneName = zoneDisplayName(currentZone.id);
            this.showBanner(currentZoneName);
            this.log(t('hud.core.enteringZone', { zone: currentZoneName }), '#ffd100');
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
      const inCombat = aggroed || now - this.lastCombatEventAt < 5000;
      const hub = currentZone.hub;
      const inHub = !inDungeon
        && Math.hypot(p.pos.x - hub.x, p.pos.z - hub.z) < hub.radius + 10;
      const dungeon = inDungeon ? dungeonAt(p.pos.x) : null;
      const zone = musicZoneForLocation(
        currentZone.id, currentZone.biome, inHub, inDungeon, dungeon?.id ?? null,
      );
      music.update(zone, inCombat);

      this.updateQuestTracker();
      this.updatePartyFrames();
      this.updateTradeWindow();
      this.updateArenaStatus();
      if ($('#map-window').style.display === 'block') this.updateMapWindow();
      if ($('#arena-window').style.display === 'block') this.renderArenaWindow();
      if (this.openLootMobId !== null) {
        const mob = sim.entities.get(this.openLootMobId);
        if (!mob || !mob.lootable || dist2d(p.pos, mob.pos) > 7) this.closeLoot();
      }
      if (this.openVendorNpcId !== null) {
        const npc = sim.entities.get(this.openVendorNpcId);
        if (!npc || dist2d(p.pos, npc.pos) > 8) this.closeVendor();
      }
    }

    // when a bout begins, get the queue panel out of the way for the fight
    const inArenaMatch = !!this.sim.arenaInfo?.match;
    if (inArenaMatch && !this.arenaMatchSeen && $('#arena-window').style.display === 'block') {
      $('#arena-window').style.display = 'none';
    }
    this.arenaMatchSeen = inArenaMatch;
    if (fastHud) this.updateMinimap();
    if (slowHud && $('#social-window').classList.contains('open')) {
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
    if (slowHud && this.marketOpen) {
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
      // A negative-value stat aura (e.g. a mob's Withering Wail sapping attack
      // power, or an Intellect-draining curse) is a debuff even though it reuses a buff_* kind.
      const isDebuff = ['dot', 'slow', 'root', 'stun', 'incapacitate', 'polymorph', 'attackspeed', 'debuff_ap'].includes(a.kind)
        || (a.kind.startsWith('buff_') && a.value < 0);
      if (mode === 'debuffs' && !isDebuff) continue;
      const d = document.createElement('div');
      d.className = 'buff' + (isDebuff ? ' debuff' : '');
      d.style.backgroundImage = `url(${iconDataUrl('aura', ABILITIES[a.id] ? a.id : `aura_${a.kind}`)})`;
      const dur = document.createElement('div');
      dur.className = 'dur';
      dur.textContent = a.remaining < 99 ? `${Math.ceil(a.remaining)}s` : '';
      d.appendChild(dur);
      const auraName = ABILITIES[a.id] ? abilityDisplayName(ABILITIES[a.id]) : auraDisplayNameFromSource(a.name);
      this.attachTooltip(d, () => `<div class="tt-title">${esc(auraName)}</div><div class="tt-sub">${esc(t('hud.core.secondsRemaining', { seconds: Math.ceil(a.remaining) }))}</div>`);
      el.appendChild(d);
    }
  }

  private updateQuestTracker(): void {
    const el = $('#quest-tracker');
    let html = this.sim.questLog.size > 0 ? `<div class="qt-header">${esc(t('questUi.tracker.title'))}</div>` : '';
    for (const qp of this.sim.questLog.values()) {
      const quest = QUESTS[qp.questId];
      html += `<div class="qt-title">${esc(questTitle(qp.questId))}${qp.state === 'ready' ? ` <span class="quest-complete">(${esc(t('questUi.tracker.complete'))})</span>` : ''}</div>`;
      quest.objectives.forEach((obj, i) => {
        const done = qp.counts[i] >= obj.count;
        html += `<div class="qt-obj${done ? ' done' : ''}">- ${esc(this.questProgressText(questObjectiveLabel(qp.questId, i), qp.counts[i], obj.count))}</div>`;
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
    $('#zone-label').textContent = zoneDisplayName(zoneAt(p.pos.z).id);
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
  // The Ashen Coliseum - 1v1 arena panel + in-match banner
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
      el.innerHTML = `<div class="panel-title"><span>${esc(t('hud.arena.title'))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('hud.arena.close'))}">${svgIcon('close')}</button></div>`
        + `<div class="arena-note">${esc(t('hud.arena.offlineNote'))}</div>`;
      el.querySelector('[data-close]')?.addEventListener('click', () => { el.style.display = 'none'; });
      return;
    }
    const inMatch = a.match !== null;
    const queuedFmt = a.queued ? a.format : null;
    const bracket = a.match?.format ?? queuedFmt ?? this.arenaBracket;
    if (queuedFmt || a.match) this.arenaBracket = bracket;
    const canSwitchBracket = !a.queued && !inMatch;
    const myPid = this.sim.playerId;
    const party = this.sim.partyInfo;
    const partySize = party?.members.length ?? 1;
    const isLeader = !party || party.leader === myPid;

    const ladder = a.ladder.map((r, i) => {
      const me = r.pid === myPid;
      const classId = r.cls as PlayerClass;
      const cls = CLASSES[classId] ? classDisplayName(classId) : r.cls;
      return `<div class="ladder-row${me ? ' me' : ''}"><span class="rank">${esc(formatNumber(i + 1, { maximumFractionDigits: 0 }))}</span>`
        + `<span class="lr-name" title="${esc(t('hud.arena.playerClassTitle', { name: r.name, className: cls }))}">${esc(r.name)}</span>`
        + `<span class="lr-rating">${esc(formatNumber(r.rating, { maximumFractionDigits: 0 }))}</span>`
        + `<span class="lr-wl">${esc(formatNumber(r.wins, { maximumFractionDigits: 0 }))}-${esc(formatNumber(r.losses, { maximumFractionDigits: 0 }))}</span></div>`;
    }).join('') || `<div class="ladder-empty">${esc(t('hud.arena.noChallengers'))}</div>`;

    const bracketBtn = (fmt: import('../world_api').ArenaFormat) => {
      const active = bracket === fmt;
      const locked = !canSwitchBracket && !active;
      return `<button class="arena-bracket${active ? ' active' : ''}${locked ? ' locked' : ''}" data-bracket="${fmt}" aria-pressed="${active ? 'true' : 'false'}"${locked ? ' disabled' : ''}>${esc(fmt)}</button>`;
    };
    const bracketTabs = `<div class="arena-brackets">${bracketBtn('1v1')}${bracketBtn('2v2')}</div>`;

    let partySection = '';
    if (bracket === '2v2' && !inMatch && !a.queued) {
      if (party && partySize === 2) {
        const rows = party.members.map((m) => {
          const cls = CLASSES[m.cls] ? classDisplayName(m.cls) : m.cls;
          const me = m.pid === myPid ? ' me' : '';
          return `<div class="arena-party-row${me}"><span class="apr-name">${esc(m.name)}</span>`
            + `<span class="apr-meta">${esc(t('hud.arena.levelClass', {
              level: formatNumber(m.level, { maximumFractionDigits: 0 }),
              className: cls,
            }))}</span></div>`;
        }).join('');
        partySection = `<div class="arena-party">${rows}</div>`;
      } else if (party && partySize > 2) {
        partySection = `<div class="arena-note arena-warn">${esc(t('hud.arena.queueNote'))}</div>`;
      }
    }

    let action: string;
    if (inMatch) {
      action = `<div class="arena-queue-status">${svgIcon('arena')} ${esc(t('hud.arena.matchInProgress', { name: a.match!.oppName }))}</div>`;
    } else if (a.queued) {
      action = `<button class="btn leave" data-act="leave">${esc(t('hud.arena.leaveQueue'))}</button>`
        + `<div class="arena-queue-status">${esc(t('hud.arena.searching', { count: formatNumber(a.queueSize, { maximumFractionDigits: 0 }) }))}</div>`;
    } else {
      let queueDisabled = false;
      if (bracket === '2v2' && party && partySize === 2 && !isLeader) {
        queueDisabled = true;
      } else if (bracket === '2v2' && party && partySize > 2) {
        queueDisabled = true;
      } else if (bracket === '1v1' && party && partySize > 1) {
        queueDisabled = true;
      }
      const btnCls = queueDisabled ? 'btn disabled' : 'btn';
      const queueLabel = t('hud.arena.enterQueue');
      action = `<button class="${btnCls}" data-act="queue"${queueDisabled ? ' disabled' : ''}>${esc(queueLabel)}</button>`
        + `<div class="arena-note">${esc(t('hud.arena.queueNote'))}</div>`;
    }

    this.fetchArenaLeaderboard();
    const allTime = (this.arenaAllTime ?? []).map((r, i) => {
      const me = r.name === this.sim.player.name;
      const classId = r.class as PlayerClass;
      const cls = CLASSES[classId] ? classDisplayName(classId) : r.class;
      return `<div class="ladder-row${me ? ' me' : ''}"><span class="rank">${esc(formatNumber(i + 1, { maximumFractionDigits: 0 }))}</span>`
        + `<span class="lr-name" title="${esc(t('hud.arena.playerLevelClassTitle', {
          name: r.name,
          level: formatNumber(r.level, { maximumFractionDigits: 0 }),
          className: cls,
        }))}">${esc(r.name)}</span>`
        + `<span class="lr-rating">${esc(formatNumber(r.rating, { maximumFractionDigits: 0 }))}</span>`
        + `<span class="lr-wl">${esc(formatNumber(r.wins, { maximumFractionDigits: 0 }))}-${esc(formatNumber(r.losses, { maximumFractionDigits: 0 }))}</span></div>`;
    }).join('');
    const allTimeSection = this.arenaAllTime && this.arenaAllTime.length > 0
      ? `<div class="arena-sub">${esc(t('hud.arena.ladderAllTime'))}</div>${allTime}`
      : '';

    const sig = JSON.stringify([a.rating, a.wins, a.losses, a.queued, a.queueSize, inMatch, a.ladder, this.arenaAllTime, bracket, party, canSwitchBracket]);
    if (sig === this.lastArenaSig) return;
    this.lastArenaSig = sig;

    el.innerHTML = `<div class="panel-title"><span>${esc(t('hud.arena.title'))} <span class="arena-bracket-tag">${esc(bracket)}</span></span><button type="button" class="x-btn" data-close aria-label="${esc(t('hud.arena.close'))}">${svgIcon('close')}</button></div>`
      + bracketTabs
      + `<div class="arena-rank"><span class="rating">${esc(formatNumber(a.rating, { maximumFractionDigits: 0 }))}</span>`
      + `<span class="wl">${esc(t('hud.arena.ratingSummary', {
        wins: formatNumber(a.wins, { maximumFractionDigits: 0 }),
        losses: formatNumber(a.losses, { maximumFractionDigits: 0 }),
      }))}</span></div>`
      + partySection
      + action
      + `<div class="arena-sub">${esc(t('hud.arena.ladderOnline'))}</div>`
      + ladder
      + allTimeSection;

    el.querySelector('[data-close]')?.addEventListener('click', () => { el.style.display = 'none'; });
    el.querySelectorAll('[data-bracket]:not([disabled])').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.arenaBracket = (btn as HTMLElement).dataset.bracket as import('../world_api').ArenaFormat;
        this.lastArenaSig = '';
        this.renderArenaWindow();
        audio.click();
      });
    });
    el.querySelector('[data-act="queue"]:not([disabled])')?.addEventListener('click', () => {
      this.sim.arenaQueueJoin(bracket);
      audio.click();
    });
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
    const label = m.state === 'countdown' ? t('hud.arena.statusCountdown')
      : m.state === 'over' ? t('hud.arena.statusReturning', { seconds: formatNumber(m.returnIn ?? 0, { maximumFractionDigits: 0 }) })
      : t('hud.arena.statusFight');
    let vsBlock: string;
    if (m.format === '2v2') {
      const allyNames = [esc(t('hud.core.you')), ...m.allies.map((c) => esc(c.name))].join(' - ');
      const enemyNames = m.enemies.map((c) => esc(c.name)).join(' - ');
      const vs = esc(t('hud.arena.vsLine', { name: '' }).trim());
      vsBlock = `<div class="as-teams">`
        + `<div class="as-team allies"><span class="as-names">${allyNames}</span></div>`
        + `<div class="as-mid">${vs}</div>`
        + `<div class="as-team enemies"><span class="as-names">${enemyNames}</span></div>`
        + `</div>`;
    } else {
      const cls = CLASSES[m.oppClass] ? classDisplayName(m.oppClass) : m.oppClass;
      vsBlock = `<div class="as-vs">${svgIcon('arena')} ${esc(t('hud.arena.vsLine', { name: m.oppName }))} <span style="color:#b6ad8c;font-size:11px">${esc(t('hud.arena.levelClass', {
        level: formatNumber(m.oppLevel, { maximumFractionDigits: 0 }),
        className: cls,
      }))}</span></div>`;
    }
    const sig = `${m.format}|${vsBlock}|${m.state}|${m.state === 'over' ? (m.returnIn ?? 0) : ''}`;
    if (sig !== this.lastArenaStatusSig) {
      this.lastArenaStatusSig = sig;
      el.innerHTML = `${vsBlock}<div class="as-timer">${esc(label)}</div>`;
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
    const zoneName = zoneDisplayName(zone.id);
    ctx.strokeText(zoneName, S / 2, 20);
    ctx.fillText(zoneName, S / 2, 20);
    // labels
    ctx.font = 'bold 13px Georgia';
    const label = (x: number, z: number, text: string) => {
      const { mx, my } = toMap(x, z);
      ctx.strokeText(text, mx, my);
      ctx.fillText(text, mx, my);
    };
    zone.pois.forEach((poi, poiIndex) => label(poi.x, poi.z, zonePoiLabel(zone.id, poiIndex)));
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
      const dungeonName = dungeonDisplayName(dungeon.id);
      ctx.strokeText(dungeonName, mx, my - 9);
      ctx.fillText(dungeonName, mx, my - 9);
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
            this.fct(tgt, ev.kind === 'miss' ? t('hud.combat.floatingMiss') : t('hud.combat.floatingDodge'), isPlayerTarget ? '#bbb' : '#fff', false);
            if (isPlayerSource) {
              this.combatLog(t(ev.kind === 'miss' ? 'hud.combat.miss' : 'hud.combat.dodged', {
                ability: combatAbilityName(ev.ability),
                target: entityDisplayName(tgt),
              }), '#ccc');
              audio.meleeMiss();
            }
            break;
          }
          if (isPlayerSource && !isPlayerTarget) {
            const color = ev.ability ? '#ffe97a' : '#fff';
            this.fct(tgt, `${ev.amount}${ev.crit ? '!' : ''}`, color, ev.crit);
            this.combatLog(t(ev.crit ? 'hud.combat.damageDoneCrit' : 'hud.combat.damageDone', {
              ability: combatAbilityName(ev.ability),
              target: entityDisplayName(tgt),
              amount: ev.amount,
            }), ev.ability ? '#ffe97a' : '#eee');
            if (ev.school === 'fire') audio.fire();
            else if (ev.school === 'frost') audio.frost();
            else if (ev.school === 'arcane') audio.arcane();
            else audio.meleeHit(ev.crit);
          } else if (isPlayerTarget) {
            this.fct(tgt, `-${ev.amount}`, '#ff5544', ev.crit);
            this.combatLog(t(ev.crit ? 'hud.combat.damageTakenCrit' : 'hud.combat.damageTaken', {
              source: src ? entityDisplayName(src) : '?',
              amount: ev.amount,
            }), '#ff8877');
            audio.hitTaken();
          }
          break;
        }
        case 'heal': {
          if (ev.amount > 0) {
            const healed = ev.targetId === sim.playerId ? sim.player : sim.entities.get(ev.targetId);
            if (healed) this.fct(healed, `+${ev.amount}`, '#3ce63c', false);
          }
          break;
        }
        case 'death': {
          const e = sim.entities.get(ev.entityId);
          if (e && ev.entityId !== sim.playerId) this.combatLog(t('hud.combat.death', { name: entityDisplayName(e) }), '#aaa');
          break;
        }
        case 'xp': {
          this.fct(sim.player, t('hud.core.xpFloat', { amount: ev.amount }), '#b974ff', false);
          this.log(t('hud.core.xpGain', { amount: ev.amount }), '#a980d8');
          break;
        }
        case 'levelup': {
          this.showBanner(t('hud.core.levelBanner', { level: ev.level }));
          this.log(t('hud.core.levelLog', { level: ev.level }), '#ffd100');
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
          this.log(this.localizeLootText(ev.text), '#7fdc4f');
          if (ev.text.includes('loot') || ev.text.includes('Sold') || ev.text.includes('Bought back')) audio.coin();
          else audio.lootItem();
          if ($('#bags').style.display !== 'none') this.renderBags();
          break;
        }
        case 'vendor': {
          if ($('#bags').style.display !== 'none') this.renderBags();
          if (this.openVendorNpcId !== null) this.renderVendor();
          break;
        }
        case 'error': this.showError(this.localizeErrorText(ev.text)); break;
        case 'questAccepted':
          audio.questAccept();
          this.refreshGossip();
          break;
        case 'questProgress': this.log(this.localizeQuestProgressText(ev.questId, ev.text), '#dcd29f'); break;
        case 'questReady': {
          this.showBanner(t('questUi.logs.ready', { name: questTitle(ev.questId), status: t('questUi.log.readyStatus') }));
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
            case 'party': this.chatLogFrom(ev.from, ev.text, '#7fd4ff', CHAT_TEMPLATE_KEYS.party); break;
            case 'yell': this.chatLogFrom(ev.from, ev.text, '#ff5040', CHAT_TEMPLATE_KEYS.yell); break;
            case 'whisper':
              if (ev.to) this.chatLogFrom(ev.to, ev.text, '#ff80ff', CHAT_TEMPLATE_KEYS.toWhisper);
              else { this.chatLogFrom(ev.from, ev.text, '#ff80ff', CHAT_TEMPLATE_KEYS.whisper); audio.whisper(); }
              break;
            case 'general': this.chatLogFrom(ev.from, ev.text, '#ffc864', CHAT_TEMPLATE_KEYS.general); break;
            case 'world': this.chatLogFrom(ev.from, ev.text, '#ff9d5c', CHAT_TEMPLATE_KEYS.world); break;
            case 'lfg': this.chatLogFrom(ev.from, ev.text, '#5cd6a0', CHAT_TEMPLATE_KEYS.lfg); break;
            case 'guild': this.chatLogFrom(ev.from, ev.text, '#40d264', CHAT_TEMPLATE_KEYS.guild); break;
            case 'officer': this.chatLogFrom(ev.from, ev.text, '#4ce0c0', CHAT_TEMPLATE_KEYS.officer); break;
            case 'emote': this.chatLogFrom(ev.from, ev.text, '#ff8040', CHAT_TEMPLATE_KEYS.emote); break;
            case 'roll': this.chatLogFrom(ev.from, ev.text, '#ffd100', CHAT_TEMPLATE_KEYS.roll); break;
            default: this.chatLogFrom(ev.from, ev.text, '#f0ead8', CHAT_TEMPLATE_KEYS.say); break;
          }
          if ((ev.channel === 'say' || ev.channel === 'yell' || ev.channel === 'emote') && ev.entityId !== undefined) {
            const masked = this.maskChat(ev.text);
            const bubble = ev.channel === 'emote' ? `${ev.from} ${masked}` : masked;
            this.renderer.showChatBubble(ev.entityId, bubble, ev.channel === 'yell');
          }
          break;
        }
        case 'tradeDone':
          if ($('#bags').style.display !== 'none') this.renderBags();
          audio.coin();
          break;
        case 'heal2': {
          const tgt = sim.entities.get(ev.targetId);
          if (tgt && ev.amount > 0) {
            this.fct(tgt, `+${ev.amount}${ev.crit ? '!' : ''}`, '#3ce63c', ev.crit);
            if (ev.sourceId === sim.playerId) {
              const selfTarget = ev.targetId === sim.playerId;
              this.combatLog(t(selfTarget
                ? (ev.crit ? 'hud.combat.healSelfCrit' : 'hud.combat.healSelf')
                : (ev.crit ? 'hud.combat.healOtherCrit' : 'hud.combat.healOther'), {
                ability: abilityDisplayNameFromSource(ev.ability),
                target: entityDisplayName(tgt),
                amount: ev.amount,
              }), '#7fdc4f');
            }
          }
          break;
        }
        case 'partyInvite':
          audio.questAccept();
          this.showPrompt(t('hud.prompts.partyInvite', { name: `<b>${esc(ev.fromName)}</b>` }), t('hud.prompts.joinParty'),
            () => this.sim.partyAccept(), () => this.sim.partyDecline());
          break;
        case 'guildInvite':
          audio.questAccept();
          this.showPrompt(t('hud.prompts.guildInvite', { name: `<b>${esc(ev.fromName)}</b>`, guild: `<span class="gold">&lt;${esc(ev.guildName)}&gt;</span>` }), t('hud.prompts.joinGuild'),
            () => this.sim.guildAccept(), () => this.sim.guildDecline());
          break;
        case 'tradeRequest':
          audio.click();
          this.showPrompt(t('hud.prompts.tradeRequest', { name: `<b>${esc(ev.fromName)}</b>` }), t('hud.prompts.openTrade'),
            () => this.sim.tradeAccept(), () => { /* let it expire */ });
          break;
        case 'duelRequest':
          audio.duelChallenge();
          this.showPrompt(t('hud.prompts.duelRequest', { name: `<b>${esc(ev.fromName)}</b>` }), t('hud.prompts.acceptDuel'),
            () => this.sim.duelAccept(), () => this.sim.duelDecline());
          break;
        case 'duelCountdown':
          this.showBanner(t('hud.system.duelCountdown', { seconds: ev.seconds }));
          audio.duelCountdownTick();
          break;
        case 'duelStart':
          audio.duelStart();
          break;
        case 'duelEnd':
          this.showBanner(t('hud.system.duelEndBanner', { winner: ev.winnerName, loser: ev.loserName }));
          this.combatLog(t('hud.system.duelEndLog', { winner: ev.winnerName, loser: ev.loserName }), '#fa6');
          audio.duelEnd();
          break;
        case 'arenaQueued':
          this.log(t('hud.system.arenaQueued', { position: formatNumber(ev.position, { maximumFractionDigits: 0 }) }), '#ffa040');
          break;
        case 'arenaUnqueued':
          this.log(t('hud.system.arenaUnqueued'), '#ffa040');
          break;
        case 'arenaFound': {
          const name = ev.enemies.length > 1 ? ev.enemies.map((e) => e.name).join(' & ') : ev.oppName;
          const cls = CLASSES[ev.oppClass] ? classDisplayName(ev.oppClass) : ev.oppClass;
          this.showBanner(t('hud.system.arenaFoundBanner', { name }));
          this.log(t('hud.system.arenaFoundLog', {
            name,
            level: formatNumber(ev.oppLevel, { maximumFractionDigits: 0 }),
            className: cls,
          }), '#ffa040');
          audio.duelChallenge();
          break;
        }
        case 'arenaCountdown':
          this.showBanner(t('hud.system.arenaCountdown', { seconds: formatNumber(ev.seconds, { maximumFractionDigits: 0 }) }));
          audio.duelCountdownTick();
          break;
        case 'arenaStart':
          this.showBanner(t('hud.system.arenaStart'));
          audio.duelStart();
          break;
        case 'arenaEnd': {
          const delta = ev.ratingAfter - ev.ratingBefore;
          const sign = delta >= 0 ? '+' : '';
          const ratingDelta = `${sign}${formatNumber(delta, { maximumFractionDigits: 0 })}`;
          const ratingAfter = formatNumber(ev.ratingAfter, { maximumFractionDigits: 0 });
          if (ev.draw) {
            this.showBanner(t('hud.system.arenaDrawBanner', { name: ev.oppName, delta: ratingDelta }));
            this.combatLog(t('hud.system.arenaDrawLog', { name: ev.oppName, rating: ratingAfter, delta: ratingDelta }), '#fa6');
          } else if (ev.won) {
            this.showBanner(t('hud.system.arenaVictoryBanner', { name: ev.oppName, rating: ratingAfter, delta: ratingDelta }));
            this.combatLog(t('hud.system.arenaVictoryLog', { name: ev.oppName, rating: ratingAfter, delta: ratingDelta }), '#7fdc4f');
            audio.duelEnd();
          } else {
            this.showBanner(t('hud.system.arenaDefeatBanner', { name: ev.oppName, rating: ratingAfter, delta: ratingDelta }));
            this.combatLog(t('hud.system.arenaDefeatLog', { name: ev.oppName, rating: ratingAfter, delta: ratingDelta }), '#ff7a6a');
            audio.death();
          }
          break;
        }
        case 'log': this.log(this.localizeSystemText(ev.text), ev.color ?? '#ccc'); break;
        case 'playerDeath': {
          this.log(t('hud.system.playerDeath'), '#ff4444');
          audio.death();
          break;
        }
        case 'respawn': this.log(t('hud.system.respawn'), '#7fdc4f'); break;
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
          const auraName = auraDisplayNameFromSource(ev.name);
          if (ev.name === 'Polymorph' && ev.gained) audio.sheep();
          if (ev.targetId === sim.playerId) {
            this.combatLog(t(ev.gained ? 'hud.combat.auraGain' : 'hud.combat.auraFade', { name: auraName }), '#d8a0d8');
          } else if (tgt && ev.gained) {
            this.combatLog(t('hud.combat.auraAfflicted', { target: entityDisplayName(tgt), name: auraName }), '#d8a0d8');
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
    if (zone.welcomeQuestId && this.sim.questState(zone.welcomeQuestId) !== 'available') return;
    this.log(zoneWelcome(zone.id), '#ffd100');
  }

  private chatLogFrom(name: string, text: string, color: string, templateKey: TranslationKey): void {
    const wasNearBottom = this.chatLogEl.scrollHeight - this.chatLogEl.scrollTop - this.chatLogEl.clientHeight < 24;
    const div = document.createElement('div');
    div.style.color = color;
    const sender = document.createElement('span');
    sender.className = 'chat-player-name';
    sender.textContent = name;
    sender.title = t('hud.chat.rightClickName', { name });
    sender.setAttribute('role', 'button');
    sender.setAttribute('aria-label', t('hud.chat.rightClickName', { name }));
    sender.tabIndex = 0;
    sender.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      this.openChatPlayerContextMenu(name, ev.clientX, ev.clientY);
    });
    sender.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      const rect = sender.getBoundingClientRect();
      this.openChatPlayerContextMenu(name, rect.left, rect.bottom);
    });
    const masked = this.maskChat(text);
    const nameToken = '__WOC_CHAT_NAME__';
    const messageToken = '__WOC_CHAT_MESSAGE__';
    const rendered = t(templateKey, { name: nameToken, message: messageToken });
    let senderAppended = false;
    let messageAppended = false;
    for (const part of rendered.split(/(__WOC_CHAT_NAME__|__WOC_CHAT_MESSAGE__)/)) {
      if (part === nameToken) {
        div.append(sender);
        senderAppended = true;
      } else if (part === messageToken) {
        div.append(document.createTextNode(masked));
        messageAppended = true;
      } else if (part) {
        div.append(document.createTextNode(part));
      }
    }
    if (!senderAppended || !messageAppended) {
      div.textContent = '';
      div.append(sender, document.createTextNode(`: ${masked}`));
    }
    this.chatLogEl.appendChild(div);
    while (this.chatLogEl.children.length > 200) this.chatLogEl.removeChild(this.chatLogEl.firstChild!);
    if (wasNearBottom) this.chatLogEl.scrollTop = this.chatLogEl.scrollHeight;
  }

  /** Replace the server-supplied soft word list (online play only). */
  setProfanityWords(words: string[]): void {
    this.profanityWords = words;
  }

  // Mask a chat body with **** when the player's profanity filter is on. The
  // filter defaults on; turning it off in Options shows the raw text the server
  // sent. Slurs are blocked server-side and never reach this path.
  private maskChat(text: string): string {
    if (this.profanityWords.length === 0) return text;
    if (!(this.optionsHooks?.settings.get('filterProfanity') ?? true)) return text;
    return maskProfanity(text, this.profanityWords);
  }

  private localizeErrorText(text: string): string {
    const exact: Record<string, TranslationKey> = {
      'You are stunned!': 'hud.errors.stunned',
      'You are silenced!': 'hud.errors.silenced',
      'You are busy.': 'hud.errors.busy',
      'That ability is not ready yet.': 'hud.errors.abilityNotReady',
      'Not enough rage!': 'hud.errors.notEnoughRage',
      'Not enough energy!': 'hud.errors.notEnoughEnergy',
      'Not enough mana!': 'hud.errors.notEnoughMana',
      'Not enough health.': 'hud.errors.notEnoughHealth',
      'Your target must dodge first.': 'hud.errors.targetMustDodge',
      'That ability requires combo points.': 'hud.errors.requiresCombo',
      "You can't do that while shapeshifted.": 'hud.errors.shapeshifted',
      'You must be stealthed.': 'hud.errors.stealthed',
      "You can't do that while in combat.": 'hud.errors.inCombat',
      'Out of range.': 'hud.errors.outOfRange',
      'You have no target.': 'hud.errors.noTarget',
      'Too close!': 'hud.errors.tooClose',
      'You must be facing your target.': 'hud.errors.facing',
      'You must wield a dagger.': 'hud.errors.dagger',
      'You must be behind your target.': 'hud.errors.behindTarget',
      'This creature cannot be polymorphed.': 'hud.errors.polymorph',
      'You have no active Seal.': 'hud.errors.noSeal',
      'You cannot taunt that.': 'hud.errors.cannotTaunt',
      'You have no pet.': 'hud.errors.noPet',
      'Invalid attack target.': 'hud.errors.invalidAttackTarget',
      'You are sending messages too quickly.': 'hud.errors.chatTooFast',
      'You are sending messages too quickly. Slow down.': 'hud.errors.chatSlowDown',
      'No one has whispered you recently.': 'hud.errors.noRecentWhisper',
      'You mutter to yourself. Nobody hears it.': 'hud.errors.whisperSelf',
      'You are not in a party.': 'hud.errors.notInParty',
      'Only the party leader may invite.': 'hud.errors.partyLeaderInvite',
      'Your party is full.': 'hud.errors.partyFull',
      'That party is full.': 'hud.errors.partyFull',
      'The invitation has expired.': 'hud.errors.invitationExpired',
      'Target is too far away.': 'hud.errors.targetTooFar',
      'A duel is already in progress.': 'hud.errors.duelInProgress',
      'The challenge has expired.': 'hud.errors.challengeExpired',
      'You are already in an arena match.': 'hud.errors.arenaAlreadyInMatch',
      'You cannot queue for the arena while dead.': 'hud.errors.arenaQueueDead',
      'You cannot queue while dueling.': 'hud.errors.arenaQueueDueling',
      'Finish your trade before queueing.': 'hud.errors.arenaQueueTrading',
      'You cannot queue from inside an instance.': 'hud.errors.arenaQueueInstance',
      'A trade is already in progress.': 'hud.errors.tradeInProgress',
      'Target is too far away to trade.': 'hud.errors.tradeTooFar',
      'The trade request has expired.': 'hud.errors.tradeExpired',
      'Trade failed: items or money no longer available.': 'hud.errors.tradeFailed',
      'That quest is not available.': 'questUi.errors.unavailable',
      'That quest is not in your log.': 'questUi.errors.notInLog',
      'That quest is not complete.': 'questUi.errors.incomplete',
      'That quest giver is not nearby.': 'questUi.errors.giverMissing',
      'That quest turn-in is not nearby.': 'questUi.errors.turnInMissing',
      'Too far away.': 'questUi.errors.tooFar',
      'That item is not sold here.': 'itemUi.errors.notSoldHere',
      'Not enough money.': 'itemUi.errors.notEnoughMoney',
      'You must bring your goods to the Merchant.': 'itemUi.errors.bringGoods',
      'The Merchant will not broker quest items.': 'itemUi.errors.noQuestItems',
      'You do not have that many to sell.': 'itemUi.errors.notEnoughToSell',
      'Name a price of at least 1 copper.': 'itemUi.errors.minPrice',
      'That price is beyond what the Merchant will broker.': 'itemUi.errors.priceTooHigh',
      'You are too far from the Merchant.': 'itemUi.errors.tooFar',
      'That listing is no longer available.': 'itemUi.errors.listingUnavailable',
      'You cannot afford that.': 'itemUi.errors.cannotAfford',
      'That is not your listing.': 'itemUi.errors.notYourListing',
      'You have nothing to collect.': 'itemUi.errors.nothingToCollect',
    };
    const key = exact[text];
    if (key) return t(key);

    let match = /^You must be in (Bear|Wolf) Form\.$/.exec(text);
    if (match) return t('hud.errors.requiresForm', { form: t(match[1] === 'Bear' ? 'hud.errors.bear' : 'hud.errors.cat') });
    match = /^That ability requires the target below (\d+)% health\.$/.exec(text);
    if (match) return t('hud.errors.targetHealthBelow', { percent: match[1] });
    match = /^Not enough (.+)!$/.exec(text);
    if (match) return t('hud.errors.notEnoughResource', { resource: match[1] });
    match = /^Several players match '(.+)'\. Use exact capitalization\.$/.exec(text);
    if (match) return t('hud.errors.whisperAmbiguous', { name: match[1] });
    match = /^There is no player named '(.+)' online\.$/.exec(text);
    if (match) return t('hud.errors.whisperMissing', { name: match[1] });
    // Lenient suffix match: the sim's command-help list (". Try /s /y /w /p /g, /me, …")
    // evolves over time; capture the command non-greedily and tolerate any "Try /…" tail
    // so this never silently falls through to raw English again.
    match = /^Unknown command: (.+?)\. Try \/.*$/.exec(text);
    if (match) return t('hud.errors.unknownCommand', { command: match[1] });
    match = /^Chat is on cooldown for (\d+)s\.$/.exec(text);
    if (match) return t('hud.errors.chatCooldown', { seconds: match[1] });
    match = /^Chat locked for (\d+)s because you are sending messages too quickly\.$/.exec(text);
    if (match) return t('hud.errors.chatLocked', { seconds: match[1] });
    match = /^(.+) is already in a party\.$/.exec(text);
    if (match) return t('hud.errors.alreadyInParty', { name: match[1] });
    match = /^(.+) already has a pending invitation\.$/.exec(text);
    if (match) return t('hud.errors.pendingInvite', { name: match[1] });
    match = /^You may keep at most (\d+) goods on the market at once\.$/.exec(text);
    if (match) return t('itemUi.errors.tooManyListings', { count: formatNumber(Number(match[1]), { maximumFractionDigits: 0 }) });
    match = /^That is your own listing (?:\u2014|-) cancel it to reclaim it\.$/.exec(text);
    if (match) return t('itemUi.errors.ownListing');
    match = /^All instances of (.+) are busy\. Try again soon\.$/.exec(text);
    if (match) return t('worldContent.dungeonInstanceBusy', { name: dungeonDisplayNameFromSource(match[1]) });
    const server = localizeServerText(text);
    if (server !== null) return server;
    // Sim-emitted log/error/loot text (src/sim) is English at the source; localize it
    // here, the same way server-sent text is handled above.
    const simLocalized = localizeSimText(text);
    if (simLocalized !== null) return simLocalized;
    return text;
  }

  private localizeSystemText(text: string): string {
    const exact: Record<string, TranslationKey> = {
      'You stand up.': 'hud.logs.standUp',
      'Your party has disbanded.': 'hud.logs.partyDisbanded',
      'The duel has begun!': 'hud.logs.duelBegun',
      'The duel has ended.': 'hud.logs.duelEnded',
      'You join the Ashen Coliseum queue. Stand by for a worthy opponent...': 'hud.logs.arenaJoin',
      'You join the Ashen Coliseum queue. Stand by for a worthy opponent…': 'hud.logs.arenaJoin',
      'You leave the Ashen Coliseum queue.': 'hud.logs.arenaLeave',
      'You step onto the sands of the Ashen Coliseum.': 'hud.logs.arenaSands',
      'Fight!': 'hud.system.arenaStart',
      'Trade window opened.': 'hud.logs.tradeOpened',
      'Trade complete.': 'hud.logs.tradeComplete',
      'Trade cancelled.': 'hud.logs.tradeCancelled',
    };
    const key = exact[text];
    if (key) return t(key);
    for (const dungeon of DUNGEON_LIST) {
      if (text === dungeon.enterText) return dungeonText(dungeon.id, 'enterText');
      if (text === dungeon.leaveText) return dungeonText(dungeon.id, 'leaveText');
    }

    let match = /^You have invited (.+) to your party\.$/.exec(text);
    if (match) return t('hud.logs.partyInviteSent', { name: match[1] });
    match = /^(.+) joins the party\.$/.exec(text);
    if (match) return t('hud.logs.partyJoin', { name: match[1] });
    match = /^(.+) declines your invitation\.$/.exec(text);
    if (match) return t('hud.logs.partyDecline', { name: match[1] });
    match = /^(.+) is now the party leader\.$/.exec(text);
    if (match) return t('hud.logs.partyLeader', { name: match[1] });
    match = /^You have challenged (.+) to a duel\.$/.exec(text);
    if (match) return t('hud.logs.duelChallengeSent', { name: match[1] });
    match = /^(.+) declines your challenge\.$/.exec(text);
    if (match) return t('hud.logs.duelDecline', { name: match[1] });
    match = /^You have requested to trade with (.+)\.$/.exec(text);
    if (match) return t('hud.logs.tradeRequestSent', { name: match[1] });
    match = /^(.+) has come online\.$/.exec(text);
    if (match) return t('hud.logs.friendOnline', { name: match[1] });
    match = /^(.+) has gone offline\.$/.exec(text);
    if (match) return t('hud.logs.friendOffline', { name: match[1] });
    match = /^Quest accepted: (.+)$/.exec(text);
    if (match) return t('questUi.logs.accepted', { name: questTitleFromSource(match[1]) });
    match = /^Quest abandoned: (.+)$/.exec(text);
    if (match) return t('questUi.logs.abandoned', { name: questTitleFromSource(match[1]) });
    match = /^Quest completed: (.+)$/.exec(text);
    if (match) return t('questUi.logs.completed', { name: questTitleFromSource(match[1]) });
    match = /^(.+) \(Complete\)$/.exec(text);
    if (match) return t('questUi.logs.ready', { name: questTitleFromSource(match[1]), status: t('questUi.log.readyStatus') });
    match = /^Your market listing of (.+) expired and waits at the Merchant\.$/.exec(text);
    if (match) return t('itemUi.logs.expiredListing', { item: itemDisplayNameFromSource(match[1]) });
    // The dungeon party-size warning is emitted as a 'log' event (sim.ts), so it must be
    // matched on this path, not in localizeLootText.
    match = /^(.+) is meant for a full party of (\d+)\. Tread carefully\.$/.exec(text);
    if (match) {
      return t('worldContent.dungeonPartyWarning', {
        name: dungeonDisplayNameFromSource(match[1]),
        count: formatNumber(Number(match[2]), { maximumFractionDigits: 0 }),
      });
    }
    // Server-sent friends/guild/who/world messages arrive as 'log' events; fall
    // back to the shared server-message localizer (same as localizeErrorText /
    // localizeLootText) so they are not displayed in raw English.
    const server = localizeServerText(text);
    if (server !== null) return server;
    // Sim-emitted log/error/loot text (src/sim) is English at the source; localize it
    // here, the same way server-sent text is handled above.
    const simLocalized = localizeSimText(text);
    if (simLocalized !== null) return simLocalized;
    return text;
  }

  private localizeQuestProgressText(questId: string, text: string): string {
    const quest = QUESTS[questId];
    const match = /^(.+): (\d+)\/(\d+)$/.exec(text);
    if (!quest || !match) return text;
    const objectiveIndex = quest.objectives.findIndex((objective) => objective.label === match[1]);
    const label = objectiveIndex >= 0 ? questObjectiveLabel(questId, objectiveIndex) : match[1];
    return t('questUi.logs.progress', {
      label,
      current: this.questNumber(Number(match[2])),
      total: this.questNumber(Number(match[3])),
    });
  }

  private localizeLootText(text: string): string {
    let match = /^You receive: (.+)\.$/.exec(text);
    if (match) return t('hud.logs.lootReceiveItem', { item: itemDisplayNameFromSource(match[1]) });
    match = /^You receive (.+)\.$/.exec(text);
    if (match) return t('hud.logs.lootReceiveMoney', { money: this.localizeSimMoney(match[1]) });
    match = /^You loot (.+)\.$/.exec(text);
    if (match) return t('hud.logs.lootMoney', { money: this.localizeSimMoney(match[1]) });
    match = /^Sold (.+) for (.+)\.$/.exec(text);
    if (match) return t('hud.logs.soldItem', { item: itemDisplayNameFromSource(match[1]), money: this.localizeSimMoney(match[2]) });
    match = /^Listed (.+?)( x\d+)? on the World Market for (.+)\.$/.exec(text);
    if (match) return t('itemUi.logs.listedItem', {
      item: itemStackDisplayName(match[1], match[2]),
      money: this.localizeSimMoney(match[3]),
    });
    match = /^(.+) bought your (.+) for (.+?) (?:\u2014|-) collect (.+) from the Merchant\.$/.exec(text);
    if (match) return t('itemUi.logs.sellerSold', {
      buyer: match[1],
      item: itemDisplayNameFromSource(match[2]),
      money: this.localizeSimMoney(match[3]),
      proceeds: this.localizeSimMoney(match[4]),
    });
    match = /^Bought back (.+) for (.+)\.$/.exec(text);
    if (match) return t('itemUi.logs.boughtBackItem', {
      item: itemDisplayNameFromSource(match[1]),
      money: this.localizeSimMoney(match[2]),
    });
    match = /^Bought (.+?)( x\d+)? for (.+)\.$/.exec(text);
    if (match) return t('itemUi.logs.boughtItem', {
      item: itemStackDisplayName(match[1], match[2]),
      money: this.localizeSimMoney(match[3]),
    });
    match = /^Reclaimed (.+?)( x\d+)? from the market\.$/.exec(text);
    if (match) return t('itemUi.logs.reclaimedItem', { item: itemStackDisplayName(match[1], match[2]) });
    match = /^You collect (.+) from the Merchant\.$/.exec(text);
    if (match) return t('itemUi.logs.collectedMoney', { money: this.localizeSimMoney(match[1]) });
    const server = localizeServerText(text);
    if (server !== null) return server;
    // Sim-emitted log/error/loot text (src/sim) is English at the source; localize it
    // here, the same way server-sent text is handled above.
    const simLocalized = localizeSimText(text);
    if (simLocalized !== null) return simLocalized;
    return text;
  }

  private localizeSimMoney(text: string): string {
    const copper = parseSimMoney(text);
    return copper === null ? text : formatLocalizedMoney(copper);
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
    this.errorEl.textContent = this.localizeErrorText(text);
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
    if ($('#quest-dialog').style.display !== 'block') this.questDialogReturnFocus = this.currentFocusableElement();
    this.closeOtherWindows('#quest-dialog');
    this.renderGossip(npc);
  }

  private renderGossip(npc: Entity): void {
    this.openGossipNpcId = npc.id;
    this.openQuestDetailId = null;
    const el = $('#quest-dialog');
    const def = NPCS[npc.templateId];
    // accepted-but-unfinished quests are tracked in the quest log; the NPC
    // only offers new quests (at the giver) and turn-ins (at the turn-in NPC)
    const interesting = npc.questIds.filter((q) => {
      const st = this.sim.questState(q);
      return (st === 'available' && QUESTS[q].giverNpcId === npc.templateId)
        || (st === 'ready' && QUESTS[q].turnInNpcId === npc.templateId);
    });
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    el.setAttribute('aria-labelledby', 'quest-dialog-title');
    el.setAttribute('tabindex', '-1');
    const npcName = npcDisplayName(npc.templateId);
    const npcTitle = def ? npcDisplayTitle(def.id) : '';
    let html = `<div class="panel-title"><span id="quest-dialog-title">${esc(npcName)}<span class="quest-muted"> &lt;${esc(npcTitle)}&gt;</span></span><button type="button" class="x-btn" data-close aria-label="${esc(t('questUi.dialog.close'))}">${svgIcon('close')}</button></div>`;
    html += `<div class="qd-text">"${esc(def ? npcGreeting(def.id, this.sim.cfg.playerClass, this.sim.player.name) : t('questUi.dialog.greetingFallback'))}"</div>`;
    if (interesting.length > 0) {
      for (const qid of interesting) {
        const st = this.sim.questState(qid);
        const icon = st === 'ready' ? '<span class="gold">?</span> ' : '<span class="gold">!</span> ';
        const title = questTitle(qid);
        const aria = st === 'ready'
          ? t('questUi.dialog.readyQuestAria', { name: title })
          : t('questUi.dialog.availableQuestAria', { name: title });
        html += `<button type="button" class="qd-list-item" data-quest="${esc(qid)}" aria-label="${esc(aria)}">${icon}${esc(title)}</button>`;
      }
    }
    if (npc.vendorItems.length > 0) {
      html += `<button type="button" class="qd-list-item" data-vendor="1" aria-label="${esc(t('questUi.dialog.browseGoodsAria', { name: npcName }))}"><span class="quest-complete">$</span> ${esc(t('questUi.dialog.browseGoods'))}</button>`;
    }
    if (def?.market) {
      html += `<button type="button" class="qd-list-item" data-market="1" aria-label="${esc(t('questUi.dialog.worldMarketAria'))}"><span class="gold">${svgIcon('market')}</span> ${esc(t('questUi.dialog.worldMarket'))}</button>`;
    }
    el.innerHTML = html;
    el.querySelectorAll('[data-quest]').forEach((item) => {
      item.addEventListener('click', () => this.renderQuestDetail(npc, (item as HTMLElement).dataset.quest!));
    });
    el.querySelector('[data-vendor]')?.addEventListener('click', () => {
      this.closeQuestDialog(false);
      this.openVendor(npc.id);
    });
    el.querySelector('[data-market]')?.addEventListener('click', () => {
      this.closeQuestDialog(false);
      this.openMarket();
    });
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeQuestDialog());
    el.style.display = 'block';
    this.focusFirstInteractive(el);
  }

  private renderQuestDetail(npc: Entity, questId: string): void {
    const el = $('#quest-dialog');
    const quest = QUESTS[questId];
    this.openQuestDetailId = questId;
    const state = this.sim.questState(questId);
    const text = questNarrative(questId, state === 'ready' ? 'completion' : 'text', this.sim.player.name);
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    el.setAttribute('aria-labelledby', 'quest-dialog-title');
    el.setAttribute('tabindex', '-1');
    let html = `<div class="panel-title"><span id="quest-dialog-title">${esc(questTitle(questId))}${this.questSuggestedPlayersHtml(quest.suggestedPlayers)}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('questUi.dialog.close'))}">${svgIcon('close')}</button></div>`;
    html += `<div class="qd-text">${esc(text)}</div>`;
    if (state !== 'ready') {
      const qp = this.sim.questLog.get(questId);
      html += `<div class="qd-sub">${esc(t('questUi.detail.objectives'))}</div>`;
      html += quest.objectives.map((o, i) => `<div class="qd-obj">${esc(this.questProgressText(questObjectiveLabel(questId, i), qp ? Math.min(qp.counts[i], o.count) : 0, o.count))}</div>`).join('');
    }
    html += `<div class="qd-sub">${esc(t('questUi.detail.rewards'))}</div>`;
    html += `<div class="qd-obj">${esc(t('questUi.detail.xpReward', { xp: this.questNumber(quest.xpReward) }))} &nbsp; ${this.moneyHtml(quest.copperReward)}</div>`;
    const rewardItem = questRewardItem(quest, this.sim.cfg.playerClass);
    if (rewardItem) {
      const item = ITEMS[rewardItem];
      html += `<div class="qd-reward-row" data-reward><span class="qd-reward-label">${esc(t('questUi.detail.itemReward'))}</span>${this.itemIcon(item)}<span class="qd-reward-name" style="color:${QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff'}">${esc(itemDisplayName(item))}</span></div>`;
    }
    el.innerHTML = html;
    const rewardRow = el.querySelector('[data-reward]') as HTMLElement | null;
    if (rewardRow && rewardItem) this.attachTooltip(rewardRow, () => this.itemTooltip(ITEMS[rewardItem]));

    if (state === 'available') {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.type = 'button';
      btn.textContent = t('questUi.dialog.accept');
      btn.addEventListener('click', () => { this.sim.acceptQuest(questId); this.renderGossip(npc); });
      el.appendChild(btn);
    } else if (state === 'ready') {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.type = 'button';
      btn.textContent = t('questUi.dialog.completeQuest');
      btn.addEventListener('click', () => { this.sim.turnInQuest(questId); this.renderGossip(npc); });
      el.appendChild(btn);
    }
    const back = document.createElement('button');
    back.className = 'btn';
    back.type = 'button';
    back.textContent = t('questUi.dialog.back');
    back.addEventListener('click', () => this.renderGossip(npc));
    el.appendChild(back);
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeQuestDialog());
    el.style.display = 'block';
    this.focusFirstInteractive(el);
  }

  closeQuestDialog(restoreFocus = true): void {
    $('#quest-dialog').style.display = 'none';
    this.openGossipNpcId = null;
    this.openQuestDetailId = null;
    this.hideTooltip();
    const target = this.questDialogReturnFocus;
    this.questDialogReturnFocus = null;
    if (restoreFocus) this.restoreFocus(target);
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
    let html = `<div class="panel-title"><span>${esc(entityDisplayName(mob))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('itemUi.loot.close'))}">${svgIcon('close')}</button></div>`;
    if (mob.loot.copper > 0) {
      html += `<div class="loot-item"><img class="item-icon q-common" src="${iconDataUrl('item', 'coin_gold')}" alt="" draggable="false"><span>${this.moneyHtml(mob.loot.copper)}</span></div>`;
    }
    for (const s of visibleItems) {
      const item = ITEMS[s.itemId];
      html += `<div class="loot-item" data-item="${s.itemId}">${this.itemIcon(item)}<span style="font-size:12px">${esc(itemDisplayName(item))}${s.count > 1 ? ' x' + s.count : ''}</span></div>`;
    }
    el.innerHTML = html;
    el.querySelectorAll('[data-item]').forEach((row) => {
      const itemId = (row as HTMLElement).dataset.item!;
      this.attachTooltip(row as HTMLElement, () => this.itemTooltip(ITEMS[itemId]));
    });
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = t('itemUi.loot.takeAll');
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
    $('#bags').style.display = 'flex';
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
    let html = `<div class="panel-title"><span>${esc(t('itemUi.vendor.goodsTitle', { name: entityDisplayName(npc) }))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('itemUi.vendor.close'))}">${svgIcon('close')}</button></div>`;
    el.innerHTML = html;
    for (const itemId of npc.vendorItems) {
      const item = ITEMS[itemId];
      if (!item?.buyValue) continue;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'vendor-item';
      const price = formatLocalizedMoney(item.buyValue);
      const itemName = itemDisplayName(item);
      row.setAttribute('aria-label', t('itemUi.vendor.buyAria', { item: itemName, price }));
      row.innerHTML = `${this.itemIcon(item)}<span class="vi-name">${esc(itemName)}</span><span class="vi-price">${this.moneyHtml(item.buyValue)}</span>`;
      row.addEventListener('click', () => {
        this.sim.buyItem(npc.id, itemId);
        if ($('#bags').style.display !== 'none') this.renderBags();
        this.renderVendor();
      });
      this.attachTooltip(row, () => this.itemTooltip(item) + `<div class="tt-sub">${esc(t('itemUi.tooltip.clickBuy'))}</div>`);
      el.appendChild(row);
    }
    const buybackTitle = document.createElement('div');
    buybackTitle.className = 'vendor-section-title';
    buybackTitle.textContent = t('itemUi.vendor.buybackTitle');
    el.appendChild(buybackTitle);
    const buyback = this.sim.vendorBuyback.filter((s) => ITEMS[s.itemId] && s.count > 0);
    if (buyback.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'vendor-empty';
      empty.textContent = t('itemUi.vendor.buybackEmpty');
      el.appendChild(empty);
    }
    for (const s of buyback) {
      const item = ITEMS[s.itemId]!;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'vendor-item';
      const price = formatLocalizedMoney(item.sellValue);
      const itemName = itemDisplayName(item);
      row.setAttribute('aria-label', t('itemUi.vendor.buybackAria', { item: itemName, price }));
      row.innerHTML = `${this.itemIcon(item)}<span class="vi-name">${esc(itemName)}${s.count > 1 ? ` x${s.count}` : ''}</span><span class="vi-price">${this.moneyHtml(item.sellValue)}</span>`;
      row.addEventListener('click', () => {
        this.sim.buyBackItem(s.itemId);
        if ($('#bags').style.display === 'block') this.renderBags();
        this.renderVendor();
      });
      this.attachTooltip(row, () => this.itemTooltip(item) + `<div class="tt-sub">${esc(t('itemUi.tooltip.clickBuyback'))}</div>`);
      el.appendChild(row);
    }
    const hint = document.createElement('div');
    hint.className = 'vendor-hint';
    hint.textContent = t('itemUi.vendor.hint');
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
    if ($('#bags').style.display !== 'none') this.renderBags();
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
    $('#bags').style.display = 'flex';
    audio.bagOpen();
  }

  closeMarket(): void {
    if (!this.marketOpen) return;
    this.marketOpen = false;
    this.marketSellItem = null;
    $('#market-window').style.display = 'none';
    this.hideTooltip();
    if ($('#bags').style.display !== 'none') this.renderBags();
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
    const tabLabel = (id: typeof this.marketTab): string => {
      if (id === 'browse') return t('itemUi.market.browse');
      if (id === 'sell') return t('itemUi.market.sell');
      return collectN > 0
        ? t('itemUi.market.collectWithCount', { count: formatNumber(collectN, { maximumFractionDigits: 0 }) })
        : t('itemUi.market.collect');
    };
    const tab = (id: typeof this.marketTab) =>
      `<button type="button" class="mkt-tab${this.marketTab === id ? ' sel' : ''}" data-tab="${id}" aria-pressed="${this.marketTab === id ? 'true' : 'false'}">${esc(tabLabel(id))}</button>`;
    el.innerHTML =
      `<div class="panel-title"><span>${esc(t('itemUi.market.title'))} <span class="panel-subtitle">${esc(t('itemUi.market.subtitle'))}</span></span><button type="button" class="x-btn" data-close aria-label="${esc(t('itemUi.market.close'))}">${svgIcon('close')}</button></div>`
      + `<div class="mkt-tabs">`
      + tab('browse')
      + tab('sell')
      + tab('collect')
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
    if (collectTab) {
      collectTab.textContent = collectN > 0
        ? t('itemUi.market.collectWithCount', { count: formatNumber(collectN, { maximumFractionDigits: 0 }) })
        : t('itemUi.market.collect');
    }
    this.renderMarketContent(info);
  }

  private renderMarketContent(info: MarketInfo | null): void {
    const body = document.getElementById('market-body');
    if (!body) return;
    if (!info) { body.innerHTML = `<div class="mkt-empty">${esc(t('itemUi.market.noMerchant'))}</div>`; return; }
    if (this.marketTab === 'browse') this.renderMarketBrowse(body, info);
    else if (this.marketTab === 'sell') this.renderMarketSell(body, info);
    else this.renderMarketCollect(body, info);
  }

  private renderMarketBrowse(body: HTMLElement, info: MarketInfo): void {
    if (info.listings.length === 0) {
      body.innerHTML = `<div class="mkt-empty">${esc(t('itemUi.market.emptyBrowse'))}</div>`;
      return;
    }
    body.innerHTML = `<div class="mkt-note">${esc(t('itemUi.market.browseNote'))}</div>`;
    for (const l of info.listings) {
      const item = ITEMS[l.itemId];
      if (!item) continue;
      const qColor = QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff';
      const row = document.createElement('div');
      row.className = 'mkt-row';
      const itemName = itemDisplayName(item);
      const each = l.count > 1 ? `<br><span class="seller">${esc(t('itemUi.market.each', { money: formatLocalizedMoney(Math.ceil(l.price / l.count)) }))}</span>` : '';
      const stack = l.count > 1 ? ` <span class="stack">${esc(t('itemUi.market.stackCount', { count: formatNumber(l.count, { maximumFractionDigits: 0 }) }))}</span>` : '';
      row.innerHTML =
        `${this.itemIcon(item)}`
        + `<span class="mkt-name"><span class="nm" style="color:${qColor}">${esc(itemName)}${stack}</span>`
        + `<span class="seller${l.house ? ' house' : ''}">${esc(l.house ? t('itemUi.market.merchantStock') : l.sellerName)}</span></span>`
        + `<span class="mkt-price">${this.moneyHtml(l.price)}${each}</span>`;
      const btn = document.createElement('button');
      btn.className = 'mkt-btn' + (l.mine ? ' cancel' : '');
      btn.textContent = l.mine ? t('itemUi.market.reclaim') : t('itemUi.market.buy');
      btn.setAttribute('aria-label', t(l.mine ? 'itemUi.market.reclaimAria' : 'itemUi.market.buyAria', {
        item: itemName,
        price: formatLocalizedMoney(l.price),
      }));
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
    body.innerHTML = `<div class="mkt-note">${esc(t('itemUi.market.sellNote', {
      cut: formatNumber(info.cutPct, { maximumFractionDigits: 0 }),
      used: formatNumber(info.myListingCount, { maximumFractionDigits: 0 }),
      max: formatNumber(info.maxListings, { maximumFractionDigits: 0 }),
    }))}</div>`;
    const item = this.marketSellItem ? ITEMS[this.marketSellItem] : null;
    const have = this.marketSellItem ? this.bagCount(this.marketSellItem) : 0;
    const pick = document.createElement('div');
    if (!item || have <= 0) {
      pick.className = 'mkt-sell-pick empty';
      pick.textContent = t('itemUi.market.sellPickEmpty');
      body.appendChild(pick);
      return;
    }
    const qColor = QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff';
    pick.className = 'mkt-sell-pick';
    pick.innerHTML = `${this.itemIcon(item)}<span class="ps-name" style="color:${qColor}">${esc(itemDisplayName(item))}</span>`;
    body.appendChild(pick);

    const form = document.createElement('div');
    form.className = 'mkt-price-form';
    const qtyRow = have > 1
      ? `<div class="mkt-price-row"><label for="mkt-qty">${esc(t('itemUi.market.quantity'))}</label><input class="coininput" id="mkt-qty" type="number" min="1" max="${have}" value="1"> <span class="mkt-coin-tag">${esc(t('itemUi.market.quantityOf', { count: formatNumber(have, { maximumFractionDigits: 0 }) }))}</span></div>`
      : '';
    // a gentle starting ask: a few times vendor value, never below 1c
    const suggested = Math.max(1, item.buyValue ?? Math.max(1, item.sellValue) * 4);
    const g = Math.floor(suggested / 10000), s = Math.floor((suggested % 10000) / 100), c = suggested % 100;
    form.innerHTML = qtyRow
      + `<div class="mkt-price-row"><label>${esc(t('itemUi.market.priceEach'))}</label>`
      + `<input class="coininput" id="mkt-g" type="number" min="0" value="${g}" aria-label="${esc(t('itemUi.money.gold'))}"><span class="mkt-coin-tag">${esc(t('itemUi.money.goldShort'))}</span>`
      + `<input class="coininput" id="mkt-s" type="number" min="0" max="99" value="${s}" aria-label="${esc(t('itemUi.money.silver'))}"><span class="mkt-coin-tag">${esc(t('itemUi.money.silverShort'))}</span>`
      + `<input class="coininput" id="mkt-c" type="number" min="0" max="99" value="${c}" aria-label="${esc(t('itemUi.money.copper'))}"><span class="mkt-coin-tag">${esc(t('itemUi.money.copperShort'))}</span></div>`;
    body.appendChild(form);

    const listBtn = document.createElement('button');
    listBtn.className = 'mkt-list-btn';
    listBtn.textContent = t('itemUi.market.listButton');
    listBtn.addEventListener('click', () => {
      const qty = have > 1 ? Math.max(1, Math.min(have, parseInt(($('#mkt-qty') as HTMLInputElement)?.value || '1', 10) || 1)) : 1;
      const gg = Math.max(0, parseInt(($('#mkt-g') as HTMLInputElement)?.value || '0', 10) || 0);
      const ss = Math.max(0, parseInt(($('#mkt-s') as HTMLInputElement)?.value || '0', 10) || 0);
      const cc = Math.max(0, parseInt(($('#mkt-c') as HTMLInputElement)?.value || '0', 10) || 0);
      const each = gg * 10000 + ss * 100 + cc;
      if (each < 1) { this.showError(t('itemUi.market.minPriceError')); return; }
      this.sim.marketList(this.marketSellItem!, qty, each * qty);
      this.marketSellItem = null;
      audio.coin();
      this.renderMarket(); // the next snapshot echoes the new bags + listings
    });
    body.appendChild(listBtn);
  }

  private renderMarketCollect(body: HTMLElement, info: MarketInfo): void {
    if (info.collectionCopper <= 0 && info.collectionItems.length === 0) {
      body.innerHTML = `<div class="mkt-empty">${esc(t('itemUi.market.collectEmpty'))}</div>`;
      return;
    }
    body.innerHTML = `<div class="mkt-note">${esc(t('itemUi.market.collectNote'))}</div>`;
    if (info.collectionCopper > 0) {
      const row = document.createElement('div');
      row.className = 'mkt-collect';
      row.innerHTML = `<span>${esc(t('itemUi.market.saleProceeds'))}</span><span class="mkt-price">${this.moneyHtml(info.collectionCopper)}</span>`;
      body.appendChild(row);
    }
    for (const s of info.collectionItems) {
      const item = ITEMS[s.itemId];
      if (!item) continue;
      const qColor = QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff';
      const row = document.createElement('div');
      row.className = 'mkt-collect';
      const stack = s.count > 1 ? ` ${t('itemUi.market.stackCount', { count: formatNumber(s.count, { maximumFractionDigits: 0 }) })}` : '';
      row.innerHTML = `<span style="display:flex;gap:8px;align-items:center">${this.itemIcon(item)}<span style="color:${qColor}">${esc(itemDisplayName(item))}${esc(stack)}</span></span>`;
      this.attachTooltip(row, () => this.itemTooltip(item));
      body.appendChild(row);
    }
    const btn = document.createElement('button');
    btn.className = 'mkt-list-btn';
    btn.textContent = t('itemUi.market.collectAll');
    btn.addEventListener('click', () => { this.sim.marketCollect(); audio.coin(); });
    body.appendChild(btn);
  }

  // -------------------------------------------------------------------------
  // Bags
  // -------------------------------------------------------------------------

  // True when the player has at least one edible food stack — mirrors the
  // food check in Sim.feedPet so the pet-feed flow never starts when it can't
  // possibly complete.
  private hasPetFood(): boolean {
    return this.sim.inventory.some((s) => {
      const item = ITEMS[s.itemId];
      return !!item && item.kind === 'food' && !!item.foodHp && s.count > 0;
    });
  }

  // Leave pet food-selection mode. Safe to call unconditionally; it only
  // redraws the pet bar when something actually changed.
  private cancelPetFeed(): void {
    if (!this.pendingPetFeed) return;
    this.pendingPetFeed = false;
    this.lastPetBarSig = '';
  }

  toggleBags(): void {
    const el = $('#bags');
    if (el.style.display !== 'none') { el.style.display = 'none'; this.hideTooltip(); audio.bagClose(); this.cancelPetFeed(); return; }
    this.closeOtherWindows('#bags');
    this.renderBags();
    el.style.display = 'flex';
    audio.bagOpen();
  }

  // Called when an authoritative inventory delta lands (online snapshots
  // carry inventory separately from the event frames that normally redraw).
  onInventoryChanged(): void {
    if ($('#bags').style.display !== 'none') this.renderBags();
    if (this.openVendorNpcId !== null) this.renderVendor();
    this.renderCharIfOpen();
  }

  private renderCharIfOpen(): void {
    if ($('#char-window').style.display === 'block') this.renderChar();
  }

  renderBags(): void {
    const el = $('#bags');
    const sim = this.sim;
    el.innerHTML = `<div class="panel-title"><span>${esc(t('itemUi.bags.title'))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('itemUi.bags.close'))}">${svgIcon('close')}</button></div>`;
    const grid = document.createElement('div');
    grid.className = 'bag-grid';
    if (sim.inventory.length === 0) {
      grid.innerHTML = `<div class="bag-empty">${esc(t('itemUi.bags.empty'))}</div>`;
    }
    for (const s of [...sim.inventory]) {
      const item = ITEMS[s.itemId];
      if (!item) continue;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'bag-item';
      const qColor = QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff';
      const itemName = itemDisplayName(item);
      row.setAttribute('aria-label', t('itemUi.bags.itemAria', {
        item: itemName,
        count: formatNumber(s.count, { maximumFractionDigits: 0 }),
      }));
      row.innerHTML = `${this.itemIcon(item)}<span style="color:${qColor}">${esc(itemName)}</span><span class="bi-count">${s.count > 1 ? esc(t('itemUi.bags.stackCount', { count: formatNumber(s.count, { maximumFractionDigits: 0 }) })) : ''}</span>`;
      row.addEventListener('click', (ev) => {
        if (this.tradeOpen) {
          this.addItemToTrade(s.itemId);
        } else if (this.marketOpen && this.marketTab === 'sell') {
          if (item.kind === 'quest') { this.showError(t('itemUi.errors.noQuestItems')); return; }
          this.marketSellItem = s.itemId;
          this.renderMarket();
        } else if (this.vendorOpen) {
          this.sellBagItem(s, ev);
        } else if (this.pendingPetFeed) {
          if (item.kind !== 'food') { this.showError(t('hud.pet.petEatsFoodOnly')); return; }
          this.sim.feedPet(s.itemId);
          this.pendingPetFeed = false;
          this.lastPetBarSig = '';
          this.renderBags();
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
        if (this.tradeOpen) extra = `<div class="tt-sub">${esc(t('itemUi.tooltip.clickTradeOffer'))}</div>`;
        else if (this.marketOpen && this.marketTab === 'sell') extra = item.kind === 'quest' ? `<div class="tt-sub">${esc(t('itemUi.tooltip.cannotMarket'))}</div>` : `<div class="tt-sub">${esc(t('itemUi.tooltip.clickMarketList'))}</div>`;
        else if (this.vendorOpen) extra = item.kind === 'quest' ? `<div class="tt-sub">${esc(t('itemUi.tooltip.cannotVendor'))}</div>` : `<div class="tt-sub">${esc(t('itemUi.tooltip.clickSell'))}</div>`;
        else if (item.kind === 'quest') extra = `<div class="tt-sub">${esc(t('itemUi.tooltip.clickDestroy'))}</div>`;
        else if (item.kind === 'weapon' || item.kind === 'armor') extra = `<div class="tt-sub">${esc(t('itemUi.tooltip.clickEquip'))}</div>`;
        else if (item.kind === 'food' || item.kind === 'drink') extra = `<div class="tt-sub">${esc(t('itemUi.tooltip.clickConsume'))}</div>`;
        else if (item.kind === 'potion') extra = `<div class="tt-sub">${esc(t('itemUi.tooltip.clickUseInstant'))}</div>`;
        else if (item.use) extra = `<div class="tt-sub">${esc(t('itemUi.tooltip.clickUse'))}</div>`;
        return this.itemTooltip(item) + extra;
      });
      grid.appendChild(row);
    }
    el.appendChild(grid);
    const money = document.createElement('div');
    money.className = 'money';
    money.innerHTML = this.moneyHtml(sim.copper);
    el.appendChild(money);
    el.querySelector('[data-close]')?.addEventListener('click', () => { el.style.display = 'none'; this.hideTooltip(); this.cancelPetFeed(); });
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
    const itemName = item ? itemDisplayName(item) : itemId;
    prompt.innerHTML = `<div class="prompt-text">${esc(t('itemUi.bags.destroyTitle', { item: itemName }))}</div>`;
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
    confirm.textContent = t('itemUi.bags.destroyConfirm');
    const cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.textContent = t('itemUi.bags.destroyCancel');
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
    const itemName = item ? itemDisplayName(item) : itemId;
    prompt.innerHTML = `<div class="prompt-text">${esc(t('itemUi.vendor.sellQuantityTitle', { item: itemName }))}</div>`;
    const input = document.createElement('input');
    input.className = 'prompt-number';
    input.type = 'number';
    input.setAttribute('aria-label', t('itemUi.vendor.sellQuantityInput'));
    input.min = '1';
    input.max = String(maxCount);
    input.step = '1';
    input.value = '1';
    const confirm = document.createElement('button');
    confirm.className = 'btn';
    confirm.textContent = t('itemUi.vendor.sellQuantityConfirm');
    const cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.textContent = t('itemUi.vendor.sellQuantityCancel');
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
    const className = classDisplayName(cls.id);
    let html = `<div class="panel-title"><span>${esc(p.name)} <span class="panel-subtitle">${esc(t('itemUi.equipment.levelClass', { level: formatNumber(p.level, { maximumFractionDigits: 0 }), className }))}</span></span><button type="button" class="x-btn" data-close aria-label="${esc(t('hud.options.returnToGame'))}">${svgIcon('close')}</button></div>`;
    html += `<div class="paperdoll">
      <div class="equip-col" id="equip-col"></div>
      <div class="char-model-panel">
        <div id="char-model-preview" class="char-model-preview"></div>
        <div id="char-skin-row" class="skin-row char-skin-row" role="list" aria-label="Chroma"></div>
      </div>
    </div>`;
    const wpn = sim.equipment.mainhand ? ITEMS[sim.equipment.mainhand] : null;
    const dps = wpn?.weapon ? ((wpn.weapon.min + wpn.weapon.max) / 2 + (p.attackPower / 14) * wpn.weapon.speed) / wpn.weapon.speed : 0;
    html += `<div class="char-stats">
      <span>${esc(t('itemUi.stats.str'))}: <b>${formatNumber(p.stats.str, { maximumFractionDigits: 0 })}</b></span><span>${esc(t('itemUi.stats.armor'))}: <b>${formatNumber(p.stats.armor, { maximumFractionDigits: 0 })}</b></span>
      <span>${esc(t('itemUi.stats.agi'))}: <b>${formatNumber(p.stats.agi, { maximumFractionDigits: 0 })}</b></span><span>${esc(t('itemUi.stats.attackPower'))}: <b>${formatNumber(p.attackPower, { maximumFractionDigits: 0 })}</b></span>
      <span>${esc(t('itemUi.stats.sta'))}: <b>${formatNumber(p.stats.sta, { maximumFractionDigits: 0 })}</b></span><span>${esc(t('itemUi.stats.dps'))}: <b>${formatNumber(dps, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</b></span>
      <span>${esc(t('itemUi.stats.int'))}: <b>${formatNumber(p.stats.int, { maximumFractionDigits: 0 })}</b></span><span>${esc(t('itemUi.stats.critChance'))}: <b>${formatNumber(p.critChance * 100, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</b></span>
      <span>${esc(t('itemUi.stats.spi'))}: <b>${formatNumber(p.stats.spi, { maximumFractionDigits: 0 })}</b></span><span>${esc(t('itemUi.stats.dodge'))}: <b>${formatNumber(p.dodgeChance * 100, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</b></span>
    </div>`;
    html += this.talentSummaryHtml();
    html += this.progressionHtml(p.level);
    el.innerHTML = html;
    el.querySelector('[data-act="prestige"]')?.addEventListener('click', () => this.openPrestigeDialog());
    const col = el.querySelector('#equip-col')!;
    const slots: { key: EquipSlot; name: string }[] = [
      { key: 'mainhand', name: itemSlotName('mainhand') },
      { key: 'chest', name: itemSlotName('chest') },
      { key: 'legs', name: itemSlotName('legs') },
      { key: 'feet', name: itemSlotName('feet') },
    ];
    for (const slot of slots) {
      const itemId = sim.equipment[slot.key];
      const item = itemId ? ITEMS[itemId] : null;
      const row = document.createElement('div');
      row.className = 'equip-slot';
      const qColor = !item ? '#666' : QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff';
      row.innerHTML = `${item ? this.itemIcon(item) : `<img class="item-icon" style="border-color:#444" src="${iconDataUrl('item', 'slot_empty')}" alt="" draggable="false">`}
        <div><div class="slot-name">${esc(slot.name)}</div><div class="slot-item" style="color:${qColor}">${item ? esc(itemDisplayName(item)) : esc(t('itemUi.equipment.empty'))}</div></div>`;
      if (item) this.attachTooltip(row, () => this.itemTooltip(item));
      col.appendChild(row);
    }
    this.renderCharPreview();
    this.renderCharSkinPicker();
    el.querySelector('[data-close]')?.addEventListener('click', () => { el.style.display = 'none'; this.hideTooltip(); });
  }

  private renderCharPreview(): void {
    const container = $('#char-model-preview') as HTMLElement | null;
    if (!container) return;
    if (!this.charPreviewCanvas) this.charPreviewCanvas = document.createElement('canvas');
    if (!this.charPreview) {
      container.appendChild(this.charPreviewCanvas);
      this.charPreview = new CharacterPreview(container, this.charPreviewCanvas);
    } else {
      this.charPreview.setContainer(container);
    }
    this.charPreview.setClass(this.sim.cfg.playerClass);
    this.charPreview.setSkin(this.sim.player.skin ?? 0);
  }

  private renderCharSkinPicker(): void {
    const row = $('#char-skin-row') as HTMLElement | null;
    if (!row) return;
    const cls = this.sim.cfg.playerClass;
    const count = skinCount(`player_${cls}`);
    row.innerHTML = '';
    row.style.setProperty('--class-color', classCss(cls));
    if (count <= 1) return;
    const current = Math.max(0, Math.min(count - 1, this.sim.player.skin ?? 0));
    for (let i = 0; i < count; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'skin-swatch' + (i === current ? ' sel' : '');
      b.textContent = String(i + 1);
      b.setAttribute('role', 'listitem');
      b.setAttribute('aria-label', `Chroma ${i + 1}`);
      b.addEventListener('click', () => {
        row.querySelectorAll('.skin-swatch').forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
        this.sim.changeSkin(i);
        this.charPreview?.setSkin(i);
      });
      row.appendChild(b);
    }
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
    const specName = sp ? esc(tTalent({ kind: 'talentSpec', spec: sp, field: 'name' })) : t('game.talents.noSpec');
    let html = `<div class="char-progression"><div class="cp-title">${t('game.talents.specTab')}</div>`;
    html += `<div class="char-stats cp-stats"><span>${t('game.talents.specTab')}: <b>${specName}</b></span>`;
    if (sp) html += `<span>${t('game.talents.role')}: <b>${this.roleLabel(sp.role)}</b></span>`;
    html += `</div>`;
    if (sp) html += `<div class="cp-milestones"><span class="cp-ms-label">${t('game.talents.mastery')}:</span> <b style="color:var(--gold)">${esc(tTalent({ kind: 'talentMastery', spec: sp, field: 'name' }))}</b> <span class="cp-none">${esc(tTalent({ kind: 'talentMastery', spec: sp, field: 'description' }))}</span></div>`;
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

  // classic-MMO-style choice-node picker: clicking an octagon node opens a flyout of its
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
    pop.setAttribute('aria-label', tTalent({ kind: 'talentNode', node, field: 'name' }));
    pop.innerHTML = (node.choices ?? []).map((o) => {
      const sel = stage.choices[node.id] === o.id;
      return `<div class="tal-choice-opt${sel ? ' sel' : ''}" role="menuitemradio" tabindex="0" aria-checked="${sel}" data-opt="${esc(o.id)}"><span class="tco-icon" style="background-image:url(${esc(talentChoiceIconDataUrl(o))})"></span>`
        + `<span class="tco-text"><b>${esc(tTalent({ kind: 'talentChoice', choice: o, field: 'name' }))}</b><span>${esc(tTalent({ kind: 'talentChoice', choice: o, field: 'description' }))}</span></span></div>`;
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
      const title = cls ? ` title="${esc(classDisplayName(r.cls))}"` : '';
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
    const cls = CLASSES[sim.cfg.playerClass];
    const className = classDisplayName(cls.id);
    el.setAttribute('aria-label', t('abilityUi.spellbook.title'));
    el.innerHTML = `<div class="panel-title"><span>${esc(t('abilityUi.spellbook.title'))} <span class="spellbook-class">${esc(t('abilityUi.spellbook.classSubtitle', { className }))}</span></span><button type="button" class="x-btn" data-close aria-label="${esc(t('abilityUi.spellbook.close'))}">${svgIcon('close')}</button></div>`;
    const list = document.createElement('div');
    list.className = 'spell-list';
    list.setAttribute('role', 'list');
    el.appendChild(list);
    let rendered = 0;
    for (const abilityId of cls.abilities) {
      const def = ABILITIES[abilityId];
      const known = sim.known.find((k) => k.def.id === abilityId) ?? null;
      const row = document.createElement('div');
      row.className = 'spell-row' + (known ? '' : ' locked');
      row.tabIndex = 0;
      row.setAttribute('role', 'listitem');
      const locked = !known;
      const summary = known ? describeAbilitySummary(known, sim.player.resourceType) : '';
      const name = abilityDisplayName(def);
      const learnLevel = formatAbilityNumber(def.learnLevel);
      row.setAttribute('aria-label', known
        ? t('abilityUi.spellbook.knownAbilityAria', { name, rank: formatAbilityNumber(known.rank), summary })
        : t('abilityUi.spellbook.unlearnedAbilityAria', { name, level: learnLevel }));
      row.innerHTML = `<div class="spell-icon" style="background-image:url(${iconDataUrl('ability', abilityId)})"></div>
        <div class="spell-text"><div class="spell-name">${esc(name)}${known && known.rank > 1 ? ` <span class="spell-rank">${esc(t('abilityUi.tooltip.rank', { rank: formatAbilityNumber(known.rank) }))}</span>` : ''}</div>
        <div class="spell-sub">${locked ? esc(t('abilityUi.spellbook.trainableAtLevel', { level: learnLevel })) : esc(summary)}</div></div>`;
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
      } else {
        this.attachTooltip(row, () => `<div class="tt-title">${esc(name)}</div><div class="tt-sub">${esc(t('abilityUi.spellbook.learnAtLevel', { level: learnLevel }))}</div>`);
      }
      list.appendChild(row);
      rendered++;
    }
    if (rendered === 0) {
      const empty = document.createElement('div');
      empty.className = 'spell-sub';
      empty.textContent = t('abilityUi.spellbook.empty');
      list.appendChild(empty);
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
      el.innerHTML = `<div class="panel-title"><span>${t('game.talents.title')} <span style="color:#998d6a;font-size:11px">${esc(classDisplayName(cls))}</span></span>${close}</div>`
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
      `<div class="panel-title"><span>${t('game.talents.title')} <span style="color:#998d6a;font-size:11px">${esc(classDisplayName(cls))}</span></span>${close}</div>`
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
      const specName = tTalent({ kind: 'talentSpec', spec: sp, field: 'name' });
      const specDescription = tTalent({ kind: 'talentSpec', spec: sp, field: 'description' });
      const masteryName = tTalent({ kind: 'talentMastery', spec: sp, field: 'name' });
      const masteryDescription = tTalent({ kind: 'talentMastery', spec: sp, field: 'description' });
      card.setAttribute('aria-label', `${specName}, ${this.roleLabel(sp.role)}`);
      card.innerHTML = `<div class="ts-icon">${esc(sp.icon)}</div><div class="ts-name">${esc(specName)}</div><div class="ts-role">${this.roleLabel(sp.role)}</div>`;
      this.attachTooltip(card, () => `<div class="tt-title">${esc(specName)}</div><div class="tt-sub">${esc(specDescription)}</div>`
        + `<div class="tt-sub" style="color:#ffd100">${t('game.talents.signature')}: ${esc(ABILITIES[sp.signature] ? abilityDisplayName(ABILITIES[sp.signature]) : sp.signature)}</div>`
        + `<div class="tt-sub">${t('game.talents.mastery')}: ${esc(masteryName)} — ${esc(masteryDescription)}</div>`);
      card.addEventListener('click', () => this.stageSetSpec(stage, sp.id));
      card.addEventListener('keydown', (e) => this.keyboardActivate(e as KeyboardEvent, () => this.stageSetSpec(stage, sp.id)));
      picker.appendChild(card);
    }
    body.appendChild(picker);
    const sp = ct.specs.find((s) => s.id === stage.spec);
    if (!sp) { const e = document.createElement('div'); e.className = 'tal-empty'; e.textContent = t('game.talents.chooseSpec'); body.appendChild(e); return; }
    const m = document.createElement('div'); m.className = 'tal-mastery';
    m.innerHTML = `<b>${t('game.talents.mastery')}: ${esc(tTalent({ kind: 'talentMastery', spec: sp, field: 'name' }))}</b> — ${esc(tTalent({ kind: 'talentMastery', spec: sp, field: 'description' }))}`;
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
      const nodeName = tTalent({ kind: 'talentNode', node: n, field: 'name' });
      const chosenLabel = chosen ? `, ${tTalent({ kind: 'talentChoice', choice: chosen, field: 'name' })}` : '';
      div.setAttribute('aria-label', `${nodeName}${chosenLabel}, ${t('game.talents.rank')} ${ranks}/${n.maxRank}`);
      div.style.left = `${n.col * CW + (CW - NS) / 2}px`;
      div.style.top = `${n.row * CH + TOP}px`;
      const icon = document.createElement('span');
      icon.className = 'tal-icon';
      icon.style.backgroundImage = `url(${chosen ? talentChoiceIconDataUrl(chosen) : talentNodeIconDataUrl(n)})`;
      div.appendChild(icon);
      if (ranks > 0 || n.maxRank > 1) {
        const badge = document.createElement('span'); badge.className = 'tal-rank'; badge.textContent = `${ranks}/${n.maxRank}`;
        div.appendChild(badge);
      }
      this.attachTooltip(div, () => this.talentTooltip(n, stage, isDormant));
      div.addEventListener('click', () => {
        // octagon choice nodes open a classic-MMO-style option flyout; others add a rank
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
    let html = `<div class="tt-title">${esc(tTalent({ kind: 'talentNode', node: n, field: 'name' }))}</div><div class="tt-sub">${esc(tTalent({ kind: 'talentNode', node: n, field: 'description' }))}</div>`;
    if (n.kind === 'choice') {
      for (const o of n.choices!) {
        const sel = stage.choices[n.id] === o.id;
        html += `<div class="tt-sub" style="color:${sel ? '#ffd100' : '#aaa'}"><span class="tt-opt-icon" style="background-image:url(${esc(talentChoiceIconDataUrl(o))})"></span> ${esc(tTalent({ kind: 'talentChoice', choice: o, field: 'name' }))} — ${esc(tTalent({ kind: 'talentChoice', choice: o, field: 'description' }))}</div>`;
      }
      html += `<div class="tt-sub" style="color:#8aa">${t('game.talents.cycleHint')}</div>`;
    } else {
      html += `<div class="tt-sub">${t('game.talents.rank')} ${ranks}/${n.maxRank}</div>`;
    }
    const ct = talentsFor(this.sim.cfg.playerClass);
    if (n.requires?.length) {
      const names = n.requires.map((r) => {
        const required = ct?.nodes.find((x) => x.id === r);
        return required ? tTalent({ kind: 'talentNode', node: required, field: 'name' }) : r;
      }).join(', ');
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
    if (el.style.display === 'block') { this.closeQuestLog(); return; }
    this.questLogReturnFocus = this.currentFocusableElement();
    this.closeOtherWindows('#quest-log-window');
    this.renderQuestLog();
    el.style.display = 'block';
  }

  private closeQuestLog(restoreFocus = true): void {
    $('#quest-log-window').style.display = 'none';
    this.hideTooltip();
    const target = this.questLogReturnFocus;
    this.questLogReturnFocus = null;
    if (restoreFocus) this.restoreFocus(target);
  }

  renderQuestLog(): void {
    const el = $('#quest-log-window');
    const sim = this.sim;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    el.setAttribute('aria-labelledby', 'quest-log-title');
    el.setAttribute('tabindex', '-1');
    el.innerHTML = `<div class="panel-title"><span id="quest-log-title">${esc(t('questUi.log.title'))} <span class="quest-muted">${esc(t('questUi.log.summary', {
      active: this.questNumber(sim.questLog.size),
      completed: this.questNumber(sim.questsDone.size),
    }))}</span></span><button type="button" class="x-btn" data-close aria-label="${esc(t('questUi.log.close'))}">${svgIcon('close')}</button></div>`;
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
      list.innerHTML = `<div class="ql-empty">${esc(t('questUi.log.emptyTitle'))}</div>`;
      detail.innerHTML = `<div class="qd-text">${esc(t('questUi.log.emptyHint'))}</div>`;
    }
    if (!this.selectedQuestLogId || !sim.questLog.has(this.selectedQuestLogId)) {
      this.selectedQuestLogId = quests[0]?.questId ?? null;
    }
    for (const qp of quests) {
      const quest = QUESTS[qp.questId];
      const item = document.createElement('button');
      const status = qp.state === 'ready' ? t('questUi.log.readyStatus') : t('questUi.log.activeStatus');
      const title = questTitle(qp.questId);
      item.type = 'button';
      item.className = 'ql-item' + (qp.questId === this.selectedQuestLogId ? ' sel' : '');
      item.setAttribute('aria-pressed', qp.questId === this.selectedQuestLogId ? 'true' : 'false');
      item.setAttribute('aria-label', t('questUi.log.selectedQuestAria', { name: title, status }));
      item.innerHTML = `${esc(title)}${qp.state === 'ready' ? ` <span class="quest-complete">(${esc(t('questUi.log.readyStatus'))})</span>` : ''}`;
      item.addEventListener('click', () => { this.selectedQuestLogId = qp.questId; this.renderQuestLog(); });
      list.appendChild(item);
    }
    if (this.selectedQuestLogId) {
      const qp = sim.questLog.get(this.selectedQuestLogId)!;
      const quest = QUESTS[this.selectedQuestLogId];
      let html = `<div class="qd-sub ql-detail-title">${esc(questTitle(this.selectedQuestLogId))}${this.questSuggestedPlayersHtml(quest.suggestedPlayers)}</div>`;
      html += quest.objectives.map((o, i) => `<div class="qd-obj${qp.counts[i] >= o.count ? ' done' : ''}">${esc(this.questProgressText(questObjectiveLabel(this.selectedQuestLogId!, i), qp.counts[i], o.count))}</div>`).join('');
      html += `<div class="qd-text ql-detail-text">${esc(questNarrative(this.selectedQuestLogId, 'text', sim.player.name))}</div>`;
      html += `<div class="qd-sub">${esc(t('questUi.detail.rewards'))}</div><div class="qd-obj">${esc(t('questUi.detail.xpReward', { xp: this.questNumber(quest.xpReward) }))} &nbsp; ${this.moneyHtml(quest.copperReward)}</div>`;
      const rewardItem = questRewardItem(quest, sim.cfg.playerClass);
      if (rewardItem) {
        const item = ITEMS[rewardItem];
        html += `<div class="qd-reward-row" data-reward><span class="qd-reward-label">${esc(t('questUi.detail.itemReward'))}</span>${this.itemIcon(item)}<span class="qd-reward-name" style="color:${QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff'}">${esc(itemDisplayName(item))}</span></div>`;
      }
      const giver = NPCS[quest.turnInNpcId];
      html += `<div class="qd-obj quest-return">${esc(t('questUi.log.returnTo', { name: giver ? npcDisplayName(giver.id) : '?' }))}</div>`;
      detail.innerHTML = html;
      const rewardRow = detail.querySelector('[data-reward]') as HTMLElement | null;
      if (rewardRow && rewardItem) this.attachTooltip(rewardRow, () => this.itemTooltip(ITEMS[rewardItem]));
      const abandon = document.createElement('button');
      abandon.className = 'btn';
      abandon.type = 'button';
      abandon.textContent = t('questUi.log.abandon');
      abandon.addEventListener('click', () => { sim.abandonQuest(this.selectedQuestLogId!); this.renderQuestLog(); });
      detail.appendChild(abandon);
    }
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeQuestLog());
    this.focusFirstInteractive(el);
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
      const badge = m.dead ? `<span class="pf-badge dead" title="${esc(t('hud.social.status.dead'))}">${svgIcon('skull')}</span>`
        : m.inCombat ? `<span class="pf-badge combat" title="${esc(t('hud.social.status.combat'))}">${svgIcon('arena')}</span>` : '';
      const range = m.oor ? `<span class="pf-badge oor" title="${esc(t('hud.errors.outOfRange'))}">⤢</span>` : '';
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
    leave.textContent = t('hud.social.leaveParty');
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
    if (!isMember) html += `<div class="ctx-item" data-act="invite">${esc(t('hud.chat.context.invite'))}</div>`;
    html += `<div class="ctx-item" data-act="trade">${esc(t('hud.chat.context.trade'))}</div>`;
    html += `<div class="ctx-item" data-act="duel">${esc(t('hud.chat.context.challengeDuel'))}</div>`;
    if (online) html += `<div class="ctx-item" data-act="${isFriend ? 'unfriend' : 'friend'}">${esc(t(isFriend ? 'hud.chat.context.removeFriend' : 'hud.chat.context.addFriend'))}</div>`;
    if (inGuildWithInvite && !alreadyGuilded) html += `<div class="ctx-item" data-act="ginvite">${esc(t('hud.chat.context.inviteGuild'))}</div>`;
    html += `<div class="ctx-item" data-act="ignore">${esc(t(ignored
      ? (online ? 'hud.chat.context.unignore' : 'hud.chat.context.unignoreChat')
      : (online ? 'hud.chat.context.ignore' : 'hud.chat.context.ignoreChat')))}</div>`;
    if (this.reportHooks && pid !== this.sim.playerId) html += `<div class="ctx-item" data-act="report">${esc(t('hud.chat.context.report'))}</div>`;
    if (isLeader && isMember && pid !== this.sim.playerId) html += `<div class="ctx-item" data-act="kick">${esc(t('hud.chat.context.removeParty'))}</div>`;
    html += `<div class="ctx-item" data-act="close">${esc(t('hud.chat.context.cancel'))}</div>`;
    el.innerHTML = html;
    el.style.left = `${Math.min(window.innerWidth - 170, x)}px`;
    el.style.top = `${Math.min(window.innerHeight - 240, y)}px`;
    el.style.display = 'block';
    this.bindContextMenuActions((act) => {
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
  }

  // Raid/target marker picker for an enemy, opened from its target unit frame.
  // Party-only (markers are a coordination feature); shows the 8 symbols with a
  // check on the one currently on this mob, plus localized clear and cancel actions.
  openMarkerMenu(entityId: number, name: string, x: number, y: number): void {
    if (!this.sim.partyInfo) return;
    const el = $('#ctx-menu');
    const current = this.sim.markerFor(entityId);
    let html = `<div class="ctx-title">${esc(name)}</div>`;
    for (let i = 0; i < RAID_MARKER_LABEL_KEYS.length; i++) {
      const markerName = raidMarkerDisplayName(i);
      const aria = current === i
        ? t('hud.markers.markerSelectedAria', { marker: markerName })
        : t('hud.markers.markerAria', { marker: markerName });
      const check = current === i ? ' ✓' : '';
      html += `<div class="ctx-item" role="button" tabindex="0" data-act="m${i}" aria-label="${esc(aria)}"><span class="ctx-mark" style="background-image:url(${raidMarkerDataUrl(i)})"></span>${esc(markerName)}${check}</div>`;
    }
    html += `<div class="ctx-item" role="button" tabindex="0" data-act="clear">${esc(t('hud.markers.clear'))}</div>`;
    html += `<div class="ctx-item" role="button" tabindex="0" data-act="close">${esc(t('hud.markers.cancel'))}</div>`;
    el.innerHTML = html;
    el.style.left = `${Math.min(window.innerWidth - 170, x)}px`;
    el.style.top = `${Math.min(window.innerHeight - 340, y)}px`;
    el.style.display = 'block';
    el.querySelectorAll('.ctx-item').forEach((item) => {
      const activate = () => {
        const act = (item as HTMLElement).dataset.act;
        el.style.display = 'none';
        if (act === 'clear') this.sim.clearMarker(entityId);
        else if (act && act.startsWith('m')) this.sim.setMarker(entityId, Number(act.slice(1)));
      };
      item.addEventListener('click', activate);
      item.addEventListener('keydown', (e) => {
        if (!(e instanceof KeyboardEvent) || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        activate();
      });
    });
  }

  openPetMenu(entityId: number, name: string, dead: boolean, x: number, y: number): void {
    const el = $('#ctx-menu');
    const isWarlock = this.sim.cfg.playerClass === 'warlock';
    let html = `<div class="ctx-title">${esc(name)}</div>`;
    html += `<div class="ctx-item" data-act="rename">${esc(t('hud.pet.rename'))}</div>`;
    if (dead) html += `<div class="ctx-item" data-act="revive">${esc(t('hud.pet.revive'))}</div>`;
    if (!isWarlock) html += `<div class="ctx-item" data-act="abandon">${esc(t('hud.pet.abandon'))}</div>`;
    html += `<div class="ctx-item" data-act="close">${esc(t('hud.pet.cancel'))}</div>`;
    el.innerHTML = html;
    el.style.left = `${Math.min(window.innerWidth - 170, x)}px`;
    el.style.top = `${Math.min(window.innerHeight - 240, y)}px`;
    el.style.display = 'block';
    el.querySelectorAll('.ctx-item').forEach((item) => {
      item.addEventListener('click', () => {
        const act = (item as HTMLElement).dataset.act;
        el.style.display = 'none';
        if (act === 'rename') {
          this.inputDialog({
            title: t('hud.pet.rename'),
            label: t('hud.pet.renameLabel'),
            value: name,
            placeholder: t('hud.pet.petNamePlaceholder'),
            okText: t('hud.pet.renameConfirm'),
            onOk: (value) => this.sim.renamePet(value),
          });
        } else if (act === 'revive') {
          this.sim.castAbility('revive_pet');
        } else if (act === 'abandon') {
          this.confirmDialog(
            t('hud.pet.abandon'),
            t('hud.pet.abandonBody', { name: esc(name) }),
            t('hud.pet.abandonConfirm'),
            t('hud.pet.cancel'),
            () => this.sim.abandonPet(),
          );
        }
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
    this.bindContextMenuActions((act) => {
      const livePid = this.playerPidByName(name);
      if (act === 'whisper') this.startWhisper(name);
      else if (act === 'invite') {
        if (livePid !== null) this.sim.partyInvite(livePid);
        else this.showError(t('hud.system.playerNotNearby'));
      } else if (act === 'friend') this.sim.friendAdd(name);
      else if (act === 'unfriend') this.sim.friendRemove(name);
      else if (act === 'ginvite') this.sim.guildInvite(name);
      else if (act === 'ignore') {
        if (online) { ignored ? this.sim.blockRemove(name) : this.sim.blockAdd(name); }
        else this.toggleChatIgnore(name);
      } else if (act === 'report') this.openReportWindow({ name });
    });
  }

  private bindContextMenuActions(onActivate: (act: string) => void): void {
    const el = $('#ctx-menu');
    el.querySelectorAll<HTMLElement>('.ctx-item').forEach((item) => {
      item.setAttribute('role', 'button');
      item.tabIndex = 0;
      const activate = () => {
        const act = item.dataset.act;
        if (!act) return;
        el.style.display = 'none';
        onActivate(act);
      };
      item.addEventListener('click', activate);
      item.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        ev.preventDefault();
        activate();
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
      <div class="panel-title"><span>${esc(t('hud.report.title', { name }))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('hud.report.cancel'))}" title="${esc(t('hud.report.cancel'))}">${svgIcon('close')}</button></div>
      <label class="report-label" for="report-reason">${esc(t('hud.report.reason'))}</label>
      <div id="report-reason-slot" aria-describedby="report-error"></div>
      <label class="report-label" for="report-details">${esc(t('hud.report.details'))}</label>
      <textarea id="report-details" maxlength="1000" placeholder="${esc(t('hud.report.detailsPlaceholder'))}" aria-describedby="report-error"></textarea>
      <div class="report-error" id="report-error" role="alert" aria-live="polite"></div>
      <div class="report-actions">
        <button class="btn" type="button" id="report-submit">${esc(t('hud.report.submit'))}</button>
        <button class="btn" type="button" data-close>${esc(t('hud.report.cancel'))}</button>
      </div>`;
    el.style.display = 'block'; // centred by the shared .window rule
    const reasonDD = this.buildDropdown([
      { value: 'harassment', label: t('hud.report.reasons.harassment') },
      { value: 'spam', label: t('hud.report.reasons.spam') },
      { value: 'cheating', label: t('hud.report.reasons.cheating') },
      { value: 'offensive_name_or_chat', label: t('hud.report.reasons.offensiveNameOrChat') },
      { value: 'other', label: t('hud.report.reasons.other') },
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
        submit.disabled = false;
        $('#report-error').textContent = t('hud.report.failed');
        return;
      }
      request
        .then(() => {
          el.style.display = 'none';
          this.log(t('hud.report.submitted', { name }), '#ffd100');
        })
        .catch((err: unknown) => {
          submit.disabled = false;
          $('#report-error').textContent = this.localizeReportError(err);
        });
    });
  }

  private localizeReportError(err: unknown): string {
    const text = err instanceof Error ? err.message : '';
    const keyByMessage: Record<string, TranslationKey> = {
      'choose a report reason': 'hud.report.chooseReason',
      'invalid report target': 'hud.report.invalidTarget',
      // Server (server/report_target.ts) emits these lowercase and without a
      // trailing period — keys MUST match those exact bytes or they fall through
      // to the generic hud.report.failed in every locale.
      'that player is no longer online': 'hud.report.targetOffline',
      'that player could not be found': 'hud.report.targetMissing',
      'cannot report yourself': 'hud.report.cannotReportSelf',
      'you have already reported this player recently': 'hud.report.alreadyReported',
      'reporting character not found': 'hud.report.reportingCharacterMissing',
      'could not submit report': 'hud.report.failed',
    };
    return keyByMessage[text] ? t(keyByMessage[text]) : t('hud.report.failed');
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
      this.log(t('hud.system.noLongerIgnoring', { name }), '#aaf');
    } else {
      this.ignoredChatNames.add(key);
      this.log(t('hud.system.ignoringChat', { name }), '#aaf');
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
    const realmTag = online && this.sim.realm ? ` <span class="soc-realm-tag">- ${esc(this.sim.realm)}</span>` : '';
    el.innerHTML = `<div class="panel-title"><span>${esc(t('hud.social.title'))}${realmTag}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('hud.options.returnToGame'))}">${svgIcon('close')}</button></div>`
      + `<div class="soc-tabs">`
      + `<button type="button" class="soc-tab ${tab === 'friends' ? 'on' : ''}" data-tab="friends" aria-pressed="${tab === 'friends' ? 'true' : 'false'}">${esc(t('hud.social.friendsTab'))}</button>`
      + `<button type="button" class="soc-tab ${tab === 'guild' ? 'on' : ''}" data-tab="guild" aria-pressed="${tab === 'guild' ? 'true' : 'false'}">${esc(t('hud.social.guildTab'))}</button>`
      + `<button type="button" class="soc-tab ${tab === 'ignore' ? 'on' : ''}" data-tab="ignore" aria-pressed="${tab === 'ignore' ? 'true' : 'false'}">${esc(t('hud.social.ignoreTab'))}</button>`
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
      ? `<div class="soc-empty">${esc(t('hud.social.offlineEmpty'))}</div>`
      : this.socialTab === 'friends' ? this.friendsHtml()
        : this.socialTab === 'guild' ? this.guildHtml()
          : this.ignoreHtml();
    this.wireSocialRows(body);
  }

  private friendsHtml(): string {
    const friends = this.sim.socialInfo?.friends ?? [];
    if (friends.length === 0) return `<div class="soc-empty">${esc(t('hud.social.friendsEmpty'))}</div>`;
    return friends.map((f) => {
      const dot = f.online ? (f.status ?? 'online') : 'off';
      const meta = f.online
        ? `<span class="zone">${esc(f.zone ? localizeZone(f.zone) : '')}</span><br>${esc(statusLabel(f.status))}`
        : esc(t('hud.social.status.offline'));
      const name = f.online
        ? `<button type="button" class="soc-name soc-link" data-whisper="${esc(f.name)}" title="${esc(t('hud.social.whisperTitle', { name: f.name }))}">${esc(f.name)}</button>`
        : `<span class="soc-name">${esc(f.name)}</span>`;
      const whisper = f.online ? `<button type="button" class="soc-x" data-whisper="${esc(f.name)}" title="${esc(t('hud.social.whisperTitle', { name: f.name }))}">${svgIcon('whisper')}</button>` : '';
      const tip = esc(dotTitle(f.online, f.status, f.zone));
      return `<div class="soc-row">`
        + `<span class="soc-dot ${dot === 'off' ? '' : dot}" title="${tip}"></span>`
        + `<span class="soc-id">${name}<span class="soc-sub">${esc(t('hud.social.levelClass', { level: formatNumber(f.level, { maximumFractionDigits: 0 }), className: playerClassDisplayName(f.cls) }))}</span></span>`
        + `<span class="soc-meta" title="${tip}">${meta}</span>`
        + `<span class="soc-actions">${whisper}<button type="button" class="soc-x" data-act="unfriend" data-name="${esc(f.name)}" title="${esc(t('hud.social.removeFriendTitle', { name: f.name }))}">${svgIcon('close')}</button></span>`
        + `</div>`;
    }).join('');
  }

  private ignoreHtml(): string {
    const blocks = this.sim.socialInfo?.blocks ?? [];
    if (blocks.length === 0) return `<div class="soc-empty">${esc(t('hud.social.ignoreEmpty'))}</div>`;
    return blocks.map((b) => `<div class="soc-row">`
      + `<span class="soc-name">${esc(b.name)}</span>`
      + `<span class="soc-actions" style="margin-left:auto"><button type="button" class="soc-x" data-act="unblock" data-name="${esc(b.name)}" title="${esc(t('hud.social.stopIgnoringTitle', { name: b.name }))}">${svgIcon('close')}</button></span>`
      + `</div>`).join('');
  }

  private guildHtml(): string {
    const guild = this.sim.socialInfo?.guild ?? null;
    if (!guild) return `<div class="soc-empty">${esc(t('hud.social.noGuild'))}</div>`;
    const me = guild.rank;
    const guildHeadKey = guild.members.length === 1 ? 'hud.social.guildHeadOne' : 'hud.social.guildHeadMany';
    const guildCount = formatNumber(guild.members.length, { maximumFractionDigits: 0 });
    const head = `<div class="soc-guild-head">&lt;${esc(guild.name)}&gt; <span class="gm">${esc(t(guildHeadKey, { rank: rankLabel(me), count: guildCount }))}</span></div>`;
    const rows = guild.members.map((m) => {
      const dot = m.online ? (m.status ?? 'online') : 'off';
      const meta = m.online
        ? `<span class="zone">${esc(m.zone ? localizeZone(m.zone) : '')}</span><br>${esc(statusLabel(m.status))}`
        : esc(t('hud.social.status.offline'));
      const self = m.name === this.sim.player.name;
      const nameInner = `${esc(m.name)}<span class="rank">${esc(rankLabel(m.rank))}</span>`;
      const name = m.online && !self
        ? `<button type="button" class="soc-name soc-link" data-whisper="${esc(m.name)}" title="${esc(t('hud.social.whisperTitle', { name: m.name }))}">${nameInner}</button>`
        : `<span class="soc-name">${nameInner}</span>`;
      let actions = m.online && !self ? `<button type="button" class="soc-x" data-whisper="${esc(m.name)}" title="${esc(t('hud.social.whisperTitle', { name: m.name }))}">${svgIcon('whisper')}</button>` : '';
      if (!self && me === 'leader') actions += `<button type="button" class="soc-x" data-act="gtransfer" data-name="${esc(m.name)}" title="${esc(t('hud.social.makeGuildMasterTitle', { name: m.name }))}">${svgIcon('crown')}</button>`;
      if (!self && me === 'leader' && m.rank === 'member') actions += `<button type="button" class="soc-x" data-act="promote" data-name="${esc(m.name)}" title="${esc(t('hud.social.promoteTitle', { name: m.name }))}">▲</button>`;
      if (!self && me === 'leader' && m.rank === 'officer') actions += `<button type="button" class="soc-x" data-act="demote" data-name="${esc(m.name)}" title="${esc(t('hud.social.demoteTitle', { name: m.name }))}">▼</button>`;
      // leaders may remove members + officers; officers may remove only members
      const canKick = !self && ((me === 'leader' && m.rank !== 'leader') || (me === 'officer' && m.rank === 'member'));
      if (canKick) actions += `<button type="button" class="soc-x" data-act="gkick" data-name="${esc(m.name)}" title="${esc(t('hud.social.removeGuildTitle', { name: m.name }))}">${svgIcon('close')}</button>`;
      const tip = esc(dotTitle(m.online, m.status, m.zone));
      return `<div class="soc-row">`
        + `<span class="soc-dot ${dot === 'off' ? '' : dot}" title="${tip}"></span>`
        + `<span class="soc-id">${name}<span class="soc-sub">${esc(t('hud.social.levelClass', { level: formatNumber(m.level, { maximumFractionDigits: 0 }), className: playerClassDisplayName(m.cls) }))}</span></span>`
        + `<span class="soc-meta" title="${tip}">${meta}</span>`
        + (actions ? `<span class="soc-actions">${actions}</span>` : '')
        + `</div>`;
    }).join('');
    return head + rows;
  }

  // The add/action row changes with the tab (and guild membership). Inputs
  // tagged data-suggest get the username typeahead.
  private socialFooter(): string {
    if (this.socialTab === 'friends') return this.addRow('friend', 'friend-add', t('hud.social.friendSearchPlaceholder'), t('hud.social.add'), 16, true);
    if (this.socialTab === 'ignore') return this.addRow('ignore', 'block-add', t('hud.social.ignoreSearchPlaceholder'), t('hud.social.ignoreAction'), 16, true);
    const guild = this.sim.socialInfo?.guild ?? null;
    if (!guild) return this.addRow('gname', 'guild-create', t('hud.social.guildNamePlaceholder'), t('hud.social.found'), 24, false);
    let foot = '';
    if (guild.rank !== 'member') foot += this.addRow('ginvite', 'guild-invite', t('hud.social.guildInvitePlaceholder'), t('hud.social.invite'), 16, true);
    // classic MMOs: a Guild Master with other members can't just leave — they disband
    // (or hand over leadership via the crown action). Everyone else can leave.
    foot += guild.rank === 'leader' && guild.members.length > 1
      ? `<div class="soc-add soc-leave"><button class="btn" data-act="guild-disband">${esc(t('hud.social.disbandGuild'))}</button></div>`
      : `<div class="soc-add soc-leave"><button class="btn" data-act="guild-leave">${esc(t('hud.social.leaveGuild'))}</button></div>`;
    return foot;
  }

  private addRow(field: string, act: string, placeholder: string, label: string, maxlen: number, suggest: boolean): string {
    return `<div class="soc-add">`
      + (suggest ? `<div class="soc-suggest" data-for="${field}" role="listbox"></div>` : '')
      + `<input maxlength="${maxlen}" aria-label="${esc(placeholder)}" placeholder="${esc(placeholder)}" data-field="${field}"${suggest ? ' data-suggest="1" aria-autocomplete="list"' : ''} autocomplete="off" spellcheck="false"/>`
      + `<button class="btn" data-act="${act}">${esc(label)}</button></div>`;
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
      else if (act === 'guild-leave') this.showPrompt(esc(t('hud.social.leavePrompt')), t('hud.social.leaveGuild'), () => this.sim.guildLeave(), () => {});
      else if (act === 'guild-disband') this.showPrompt(esc(t('hud.social.disbandPrompt')), t('hud.social.disbandConfirm'), () => this.sim.guildDisband(), () => { /* keep */ });
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
      else if (act === 'gtransfer') this.showPrompt(t('hud.social.transferPrompt', { name: `<b>${esc(name)}</b>` }), t('hud.social.transferConfirm'), () => this.sim.guildTransfer(name), () => { /* keep */ });
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
    box.innerHTML = results.map((r, i) => {
      const meta = t('hud.social.levelClass', {
        level: formatNumber(r.level, { maximumFractionDigits: 0 }),
        className: playerClassDisplayName(r.cls),
      });
      return `<button type="button" class="soc-sugg-item" data-i="${i}" data-name="${esc(r.name)}" role="option"><span class="soc-name">${esc(r.name)}</span><span class="soc-meta">${esc(meta)}</span></button>`;
    }).join('');
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
      this.setSocialNotice(t('hud.social.noPlayerNamed', { name, realm: this.sim.realm || t('hud.social.currentRealm') }), true);
      return;
    }
    if (exact.name === this.sim.player.name) { this.setSocialNotice(t('hud.social.selfNotice'), true); return; }
    if (kind === 'friend') { this.sim.friendAdd(exact.name); this.setSocialNotice(t('hud.social.friendAdded', { name: exact.name }), false); this.clearSocialInput('friend'); }
    else if (kind === 'ignore') { this.sim.blockAdd(exact.name); this.setSocialNotice(t('hud.social.nowIgnoring', { name: exact.name }), false); this.clearSocialInput('ignore'); }
    else { this.sim.guildInvite(exact.name); this.setSocialNotice(t('hud.social.guildInvited', { name: exact.name }), false); this.clearSocialInput('ginvite'); }
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

  // Open the chat bar pre-filled with a whisper to this player (classic-MMO-style DM).
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
    decline.textContent = t('hud.prompts.decline');
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
        if ($('#bags').style.display !== 'none') this.renderBags();
      }
      return;
    }
    if (!this.tradeWasOpen) {
      this.tradeWasOpen = true;
      this.stagedTrade = { items: [], copper: 0 };
      this.renderBags();
      $('#bags').style.display = 'flex';
    }
    const sig = JSON.stringify([info.myOffer, info.theirOffer, info.myAccepted, info.theirAccepted, this.stagedTrade]);
    if (sig === this.lastTradeSig) return;
    this.lastTradeSig = sig;

    const itemRow = (s: InvSlot, mine: boolean) => {
      const item = ITEMS[s.itemId];
      const label = `${item ? itemDisplayName(item) : s.itemId}${s.count > 1 ? ' x' + formatNumber(s.count, { maximumFractionDigits: 0 }) : ''}`;
      const inner = `${this.itemIcon(item)}<span>${esc(label)}</span>`;
      return mine
        ? `<button type="button" class="trade-item mine" data-item="${esc(s.itemId)}">${inner}</button>`
        : `<div class="trade-item">${inner}</div>`;
    };
    el.innerHTML = `
      <div class="panel-title"><span>${esc(t('hud.trade.title', { name: info.otherName }))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('hud.trade.cancel'))}">${svgIcon('close')}</button></div>
      <div class="trade-cols">
        <div class="trade-col ${info.myAccepted ? 'accepted' : ''}">
          <h4>${esc(t('hud.trade.yourOffer'))}</h4>
          <div class="trade-items">${info.myOffer.items.map((s) => itemRow(s, true)).join('') || `<div class="trade-empty">${esc(t('hud.trade.emptyMine'))}</div>`}</div>
          <label class="trade-money" for="trade-copper">${esc(t('hud.trade.money'))}: <input id="trade-copper" type="number" min="0" value="${this.stagedTrade.copper}" /> ${esc(t('hud.trade.copper'))}</label>
        </div>
        <div class="trade-col ${info.theirAccepted ? 'accepted' : ''}">
          <h4>${esc(t('hud.trade.theirOffer', { name: info.otherName }))}</h4>
          <div class="trade-items">${info.theirOffer.items.map((s) => itemRow(s, false)).join('') || `<div class="trade-empty">${esc(t('hud.trade.emptyTheirs'))}</div>`}</div>
          <div class="trade-money">${esc(t('hud.trade.money'))}: <span class="gold">${formatLocalizedMoney(info.theirOffer.copper)}</span></div>
        </div>
      </div>
      <div class="trade-hint">${esc(t('hud.trade.hint'))}</div>`;
    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'btn';
    acceptBtn.textContent = info.myAccepted ? t('hud.trade.waiting') : t('hud.trade.accept');
    acceptBtn.disabled = info.myAccepted;
    acceptBtn.addEventListener('click', () => this.sim.tradeConfirm());
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn';
    cancelBtn.textContent = t('hud.trade.cancel');
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
    return this.optionsOpen || this.emoteWheelOpen || $('#emote-editor').style.display === 'block';
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
    el.innerHTML = `<div class="panel-title"><span>${esc(t('hud.options.gameMenu'))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('hud.options.returnToGame'))}">${svgIcon('close')}</button></div>`;
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
    add(t('hud.options.keyBindings'), () => goto('keybinds'));
    add(t('hud.options.graphics'), () => goto('graphics'));
    add(t('hud.options.audio'), () => goto('audio'));
    add(t('hud.options.logout'), () => this.optionsHooks?.logout());
    add(t('hud.options.returnToGame'), () => this.closeOptions());
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
    slider.setAttribute('aria-label', label);
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
      toggle.textContent = on ? t('hud.options.on') : t('hud.options.off');
      toggle.classList.toggle('off', !on);
      toggle.setAttribute('aria-pressed', String(on));
      toggle.setAttribute('aria-label', label);
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

  private settingChoice(parent: HTMLElement, label: string, key: NumericSettingKey, options: { value: number; label: string }[], onChange?: () => void): void {
    const hooks = this.optionsHooks;
    if (!hooks) return;
    const row = document.createElement('div');
    row.className = 'set-row';
    const name = document.createElement('span');
    name.className = 'set-name';
    name.textContent = label;
    const wrap = document.createElement('div');
    wrap.className = 'set-choice';
    const sync = () => {
      const current = Math.round(hooks.settings.get(key));
      for (const btn of [...wrap.querySelectorAll<HTMLButtonElement>('button[data-value]')]) {
        const selected = Number(btn.dataset.value) === current;
        btn.classList.toggle('sel', selected);
        btn.setAttribute('aria-pressed', String(selected));
      }
    };
    for (const option of options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn set-choice-btn';
      btn.dataset.value = String(option.value);
      btn.textContent = option.label;
      btn.setAttribute('aria-label', option.label);
      btn.addEventListener('click', () => {
        audio.click();
        hooks.onSettingChange(key, option.value);
        sync();
        onChange?.();
      });
      wrap.appendChild(btn);
    }
    row.append(name, wrap);
    parent.appendChild(row);
    sync();
  }

  private settingsViewShell(title: string): HTMLElement {
    const el = $('#options-menu');
    el.innerHTML = `<div class="panel-title"><span>${esc(title)}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('hud.options.returnToGame'))}">${svgIcon('close')}</button></div>`;
    const body = document.createElement('div');
    body.className = 'set-rows';
    el.appendChild(body);
    return body;
  }

  private settingsViewFooter(): void {
    const el = $('#options-menu');
    const reset = document.createElement('button');
    reset.className = 'btn';
    reset.textContent = t('hud.options.resetToDefaults');
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
    back.textContent = t('hud.options.back');
    back.addEventListener('click', () => { audio.click(); this.optionsView = 'main'; this.renderOptions(); });
    el.append(reset, back);
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeOptions());
  }

  private renderGraphics(): void {
    const body = this.settingsViewShell(t('hud.options.graphics'));
    this.settingChoice(body, t('hud.options.graphicsQuality'), 'graphicsPreset', [
      { value: 0, label: t('hud.options.graphicsPresetAuto') },
      { value: 1, label: t('hud.options.graphicsPresetLow') },
      { value: 2, label: t('hud.options.graphicsPresetMedium') },
      { value: 3, label: t('hud.options.graphicsPresetHigh') },
      { value: 4, label: t('hud.options.graphicsPresetUltra') },
      { value: 5, label: t('hud.options.graphicsPresetAdvanced') },
    ], () => this.renderGraphics());
    if (Math.round(this.optionsHooks?.settings.get('graphicsPreset') ?? 0) === 5) {
      this.settingChoice(body, t('hud.options.terrainDetail'), 'terrainDetail', [
        { value: 0, label: t('hud.options.terrainLow') },
        { value: 1, label: t('hud.options.terrainHigh') },
      ]);
      this.settingChoice(body, t('hud.options.foliageDensity'), 'foliageDensity', [
        { value: 0, label: t('hud.options.terrainLow') },
        { value: 1, label: t('hud.options.terrainHigh') },
      ]);
      this.settingChoice(body, t('hud.options.effectsQuality'), 'effectsQuality', [
        { value: 0, label: t('hud.options.terrainLow') },
        { value: 1, label: t('hud.options.terrainHigh') },
      ]);
      this.settingChoice(body, t('hud.options.shadowQuality'), 'shadowQuality', [
        { value: 0, label: t('hud.options.terrainLow') },
        { value: 1, label: t('hud.options.terrainHigh') },
      ]);
    }
    this.settingSlider(body, t('hud.options.cameraSpeed'), 'cameraSpeed');
    // Camera Speed only scales mouselook; on touch the camera joystick has its
    // own rate, so phones get a dedicated sensitivity slider here.
    if (isPhoneTouchDevice()) this.settingSlider(body, t('hud.options.touchLookSpeed'), 'touchLookSpeed');
    this.settingSlider(body, t('hud.options.brightness'), 'brightness');
    this.settingSlider(body, t('hud.options.renderQuality'), 'renderScale');
    this.settingToggle(body, t('hud.options.fullscreen'), 'fullscreen');
    this.settingToggle(body, t('game.settings.showOverflowXp'), 'showOverflowXp');
    // Touch-only: lets phone players dim the on-screen joysticks + buttons.
    if (isPhoneTouchDevice()) this.settingSlider(body, t('hud.options.touchOpacity'), 'touchOpacity');
    const note = document.createElement('div');
    note.className = 'set-note';
    note.textContent = t('hud.options.graphicsNote');
    $('#options-menu').appendChild(note);
    const reloadNote = document.createElement('div');
    reloadNote.className = 'set-note';
    reloadNote.textContent = t('hud.options.graphicsReloadNote');
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.className = 'btn';
    reload.textContent = t('hud.options.reloadNow');
    reload.addEventListener('click', () => { audio.click(); location.reload(); });
    $('#options-menu').append(reloadNote, reload);
    this.settingsViewFooter();
  }

  private renderAudio(): void {
    const body = this.settingsViewShell(t('hud.options.audio'));
    this.settingSlider(body, t('hud.options.soundEffects'), 'sfxVolume');
    this.settingSlider(body, t('hud.options.musicVolume'), 'musicVolume');
    const row = document.createElement('div');
    row.className = 'set-row';
    const name = document.createElement('span');
    name.className = 'set-name';
    name.textContent = t('hud.options.music');
    const toggle = document.createElement('button');
    toggle.className = 'btn set-toggle';
    const sync = () => {
      toggle.textContent = music.enabled ? t('hud.options.on') : t('hud.options.off');
      toggle.classList.toggle('off', !music.enabled);
      toggle.setAttribute('aria-pressed', String(music.enabled));
      toggle.setAttribute('aria-label', t('hud.options.music'));
    };
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
    if (!actionId.startsWith('slot')) return BIND_ACTION_LABEL_KEYS[actionId] ? t(BIND_ACTION_LABEL_KEYS[actionId]) : fallback;
    const slot = Number(actionId.slice(4));
    if (slot === 0) return t('hud.keybinds.actions.attack');
    const known = this.abilityForSlot(slot);
    if (known) return abilityDisplayName(known.def);
    const item = this.itemForSlot(slot);
    return item ? itemDisplayName(item) : t('hud.keybinds.actions.actionBarSlot', { slot: slot + 1 });
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
      toggle.textContent = on ? t('hud.options.on') : t('hud.options.off');
      toggle.classList.toggle('off', !on);
      toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
      toggle.setAttribute('aria-label', label);
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

  private clickMoveMouseButtonRow(parent: HTMLElement): void {
    const hooks = this.optionsHooks;
    if (!hooks) return;
    const row = document.createElement('div');
    row.className = 'kb-row kb-toggle-row';
    const name = document.createElement('span');
    name.className = 'kb-name';
    name.textContent = t('hud.options.clickMoveButton');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn kb-key kb-toggle kb-mouse-toggle';
    const sync = () => {
      toggle.textContent = clickMoveButtonLabel(hooks.settings.get('clickToMoveButton'));
      toggle.setAttribute('aria-label', `${t('hud.options.clickMoveButton')}: ${toggle.textContent}`);
    };
    sync();
    toggle.addEventListener('click', () => {
      audio.click();
      const next = normalizeClickMoveButton(hooks.settings.get('clickToMoveButton')) === 0 ? 2 : 0;
      hooks.onSettingChange('clickToMoveButton', next);
      sync();
    });
    row.append(name, toggle);
    parent.appendChild(row);
  }

  private renderKeybinds(): void {
    const el = $('#options-menu');
    el.innerHTML = `<div class="panel-title"><span>${esc(t('hud.options.keyBindings'))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('hud.options.returnToGame'))}">${svgIcon('close')}</button></div>`;
    this.settingToggleKeybind(el, t('hud.options.mouseCamera'), 'mouseCamera');
    this.settingToggleKeybind(el, t('hud.options.clickToMove'), 'clickToMove');
    this.clickMoveMouseButtonRow(el);
    this.settingToggleKeybind(el, t('hud.options.leftHandedTouch'), 'leftHandedTouch');
    this.settingToggleKeybind(el, t('hud.options.filterProfanity'), 'filterProfanity');
    const note = document.createElement('div');
    note.className = 'kb-note';
    note.textContent = this.keybindNote || t('hud.options.keybindHelpMouseCamera');
    el.appendChild(note);
    const rows = document.createElement('div');
    rows.className = 'kb-rows';
    for (const category of BIND_CATEGORIES) {
      const header = document.createElement('div');
      header.className = 'kb-cat';
      header.textContent = BIND_CATEGORY_LABEL_KEYS[category] ? t(BIND_CATEGORY_LABEL_KEYS[category]) : category;
      rows.appendChild(header);
      for (const action of BIND_ACTIONS.filter((a) => a.category === category)) {
        const row = document.createElement('div');
        row.className = 'kb-row';
        const name = document.createElement('span');
        name.className = 'kb-name';
        const label = document.createElement('span');
        label.className = 'kb-label';
        label.textContent = this.actionDisplayName(action.id, action.label);
        const hint = document.createElement('span');
        hint.className = 'kb-inline-key';
        const primary = this.keybinds.labelAt(action.id, 0);
        hint.textContent = primary ? `(${primary})` : '';
        name.append(label, hint);
        row.appendChild(name);
        for (let index = 0; index < 2; index++) {
          const capturing = this.capturingKey?.action === action.id && this.capturingKey?.index === index;
          const key = document.createElement('button');
          key.className = 'btn kb-key' + (capturing ? ' capturing' : '');
          key.textContent = capturing ? '...' : (this.keybinds.labelAt(action.id, index) || t('hud.options.unbound'));
          key.title = index === 0 ? t('hud.options.primary') : t('hud.options.alternate');
          key.setAttribute('aria-label', `${this.actionDisplayName(action.id, action.label)} ${key.title}`);
          key.addEventListener('click', () => this.beginCapture(action.id, index, action.label));
          row.appendChild(key);
        }
        rows.appendChild(row);
      }
    }
    el.appendChild(rows);
    const reset = document.createElement('button');
    reset.className = 'btn';
    reset.textContent = t('hud.options.resetToDefaults');
    reset.addEventListener('click', () => {
      audio.click();
      this.keybinds.reset();
      this.capturingKey = null;
      this.keybindNote = t('hud.options.keybindReset');
      this.refreshKeybindLabels();
      this.renderKeybinds();
    });
    const back = document.createElement('button');
    back.className = 'btn';
    back.textContent = t('hud.options.back');
    back.addEventListener('click', () => { audio.click(); this.optionsView = 'main'; this.capturingKey = null; this.renderOptions(); });
    el.append(reset, back);
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeOptions());
  }

  private beginCapture(actionId: string, index: number, fallbackLabel: string): void {
    if (!this.optionsHooks) return;
    const name = this.actionDisplayName(actionId, fallbackLabel);
    this.capturingKey = { action: actionId, index };
    this.keybindNote = t('hud.options.keybindCapture', { action: name });
    this.renderKeybinds();
    this.optionsHooks.captureKey((code) => {
      this.capturingKey = null;
      if (code === null) {
        this.keybindNote = t('hud.options.keybindCancelled');
      } else if (this.keybinds.bind(actionId, index, code)) {
        this.keybindNote = t('hud.options.keybindBound', { action: name, key: keyLabel(code) });
        this.refreshKeybindLabels();
      } else if (isReservedCode(code)) {
        this.keybindNote = t('hud.options.keybindReserved', { key: keyLabel(code) });
      }
      // re-render only if the menu is still open (player may have closed it)
      if (this.optionsOpen) this.renderKeybinds();
    });
  }

  // -------------------------------------------------------------------------

  // Historical name retained for the existing call sites. Opening a window no
  // longer closes its siblings; it only clears transient overlays.
  private closeOtherWindows(_keep?: string | string[]): void {
    this.closeContextMenu();
    this.hideTooltip();
  }

  // Closes the topmost UI. Returns true if something was closed.
  closeAll(): boolean {
    const ctx = $('#ctx-menu');
    if (ctx.style.display !== 'none' && ctx.style.display !== '') { this.closeContextMenu(); return true; }
    if (this.emoteWheelOpen) { this.hideEmoteWheel(); return true; }
    const top = this.topmostOpenWindow();
    if (!top) return false;
    this.closeManagedWindow(top);
    return true;
  }
}

function describeAbilitySummary(known: ResolvedAbility, resourceType: ResourceType | null): string {
  const parts: string[] = [];
  if (known.cost > 0) {
    parts.push(t('abilityUi.tooltip.cost', {
      cost: formatAbilityNumber(known.cost),
      resource: resourceDisplayName(resourceType),
    }));
  }
  parts.push(abilityCastLine(known));
  if (known.def.cooldown > 0) {
    parts.push(t('abilityUi.tooltip.cooldownSeconds', { seconds: formatAbilityNumber(known.def.cooldown) }));
  }
  return parts.join(' · ');
}

function abilityDisplayName(def: AbilityDef): string {
  return tEntity({ kind: 'ability', id: def.id, field: 'name' });
}

function abilityDisplayDescription(def: AbilityDef, damageText: string): string {
  return tEntity({ kind: 'ability', id: def.id, field: 'description', values: { damage: damageText } });
}

function classDisplayName(cls: PlayerClass): string {
  return tEntity({ kind: 'class', id: cls, field: 'name' });
}

function itemDisplayName(item: ItemDef): string {
  return tEntity({ kind: 'item', id: item.id, field: 'name' });
}

function itemDisplayNameFromSource(name: string): string {
  const item = Object.values(ITEMS).find((candidate) => candidate.name === name);
  return item ? itemDisplayName(item) : name;
}

function itemStackDisplayName(item: string, stackSuffix?: string): string {
  const itemName = itemDisplayNameFromSource(item);
  if (!stackSuffix) return itemName;
  const count = Number(stackSuffix.trim().slice(1));
  return `${itemName} ${t('itemUi.bags.stackCount', { count: formatNumber(count, { maximumFractionDigits: 0 }) })}`;
}

function mobDisplayName(mobId: string): string {
  return tEntity({ kind: 'mob', id: mobId, field: 'name' });
}

function npcDisplayName(npcId: string): string {
  return tEntity({ kind: 'npc', id: npcId, field: 'name' });
}

function npcDisplayTitle(npcId: string): string {
  return tEntity({ kind: 'npc', id: npcId, field: 'title' });
}

function npcGreeting(npcId: string, playerClass: PlayerClass, playerName: string): string {
  const className = classDisplayName(playerClass);
  return tEntity({ kind: 'npc', id: npcId, field: 'greeting', values: { className, classNameLower: className.toLocaleLowerCase(), playerName } });
}

function questTitle(questId: string): string {
  return tEntity({ kind: 'quest', id: questId, field: 'title' });
}

function questNarrative(questId: string, field: 'text' | 'completion', playerName: string): string {
  return tEntity({ kind: 'quest', id: questId, field, values: { playerName } });
}

function questObjectiveLabel(questId: string, objectiveIndex: number): string {
  return tEntity({ kind: 'questObjective', questId, objectiveIndex, field: 'label' });
}

function questTitleFromSource(name: string): string {
  const quest = Object.values(QUESTS).find((candidate) => candidate.name === name);
  return quest ? questTitle(quest.id) : name;
}

function zoneDisplayName(zoneId: string): string {
  return tEntity({ kind: 'zone', id: zoneId, field: 'name' });
}

function zoneWelcome(zoneId: string): string {
  return tEntity({ kind: 'zone', id: zoneId, field: 'welcome' });
}

function zonePoiLabel(zoneId: string, poiIndex: number): string {
  return tEntity({ kind: 'zonePoi', zoneId, poiIndex, field: 'label' });
}

function dungeonDisplayName(dungeonId: string): string {
  return tEntity({ kind: 'dungeon', id: dungeonId, field: 'name' });
}

function dungeonText(dungeonId: string, field: 'enterText' | 'leaveText'): string {
  return tEntity({ kind: 'dungeon', id: dungeonId, field });
}

function dungeonDisplayNameFromSource(name: string): string {
  const dungeon = DUNGEON_LIST.find((candidate) => candidate.name === name);
  return dungeon ? dungeonDisplayName(dungeon.id) : name;
}

function entityDisplayName(entity: Entity): string {
  if (entity.kind === 'mob') return entity.ownerId !== null ? entity.name : mobDisplayName(entity.templateId);
  if (entity.kind === 'npc') return npcDisplayName(entity.templateId);
  return entity.name;
}

function abilityDisplayNameFromSource(name: string): string {
  const ability = Object.values(ABILITIES).find((candidate) => candidate.name === name);
  return ability ? abilityDisplayName(ability) : name;
}

// Localize an aura/buff name that surfaces by its raw English name (buff frame tooltip,
// combat-log gain/fade). Most auras are granted by an ability or talent and have a
// localized title already; a few are pure flavor (e.g. a hunter's "Tamed" pet buff) and
// live in sim_i18n. Falls back to the English name only if nothing matches.
function auraDisplayNameFromSource(name: string): string {
  const viaTitle = localizeTalentTitle(name);
  if (viaTitle !== name) return viaTitle;
  return localizeSimAuraName(name) ?? name;
}

function combatAbilityName(name: string | null): string {
  return name ? abilityDisplayNameFromSource(name) : t('hud.combat.attack');
}

function resourceDisplayName(resourceType: ResourceType | null): string {
  return t(RESOURCE_LABEL_KEYS[resourceType ?? 'mana']);
}

function itemSlotName(slot: EquipSlot): string {
  return t(ITEM_SLOT_LABEL_KEYS[slot]);
}

function itemQualityLabel(quality: ItemDef['quality']): string {
  return t(ITEM_QUALITY_LABEL_KEYS[quality ?? 'common']);
}

function itemKindLabel(kind: ItemDef['kind']): string {
  return t(ITEM_KIND_LABEL_KEYS[kind]);
}

function itemStatName(stat: string): string {
  const key = ITEM_STAT_LABEL_KEYS[stat as keyof Stats];
  return key ? t(key) : cap(stat);
}

function itemNumber(value: number, fractionDigits = 0): string {
  return formatNumber(value, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
}

function parseSimMoney(text: string): number | null {
  let copper = 0;
  let matched = false;
  for (const match of text.matchAll(/(\d+)\s*([gsc])/gi)) {
    matched = true;
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === 'g') copper += amount * 10000;
    else if (unit === 's') copper += amount * 100;
    else copper += amount;
  }
  return matched ? copper : null;
}

function formatAbilityNumber(value: number): string {
  return formatNumber(value, { maximumFractionDigits: 1 });
}

function abilityRangeLine(def: AbilityDef): string | null {
  if (def.range <= 0) return null;
  if (def.minRange !== undefined) {
    return t('abilityUi.tooltip.rangeWithMin', {
      min: formatAbilityNumber(def.minRange),
      max: formatAbilityNumber(def.range),
    });
  }
  return t('abilityUi.tooltip.range', { range: formatAbilityNumber(def.range) });
}

function abilityCastLine(known: ResolvedAbility): string {
  if (known.def.channel) {
    return t('abilityUi.tooltip.channeledSeconds', { seconds: formatAbilityNumber(known.def.channel.duration) });
  }
  if (known.castTime > 0) {
    return t('abilityUi.tooltip.castSeconds', { seconds: formatAbilityNumber(known.castTime) });
  }
  return t('abilityUi.tooltip.instant');
}

function abilityRequirementLines(def: AbilityDef): string[] {
  const lines: string[] = [];
  if (def.requiresForm) lines.push(t('abilityUi.tooltip.requiresForm', { form: t(FORM_LABEL_KEYS[def.requiresForm]) }));
  if (def.requiresStealth) lines.push(t('abilityUi.tooltip.requiresStealth'));
  if (def.spendsCombo) lines.push(t('abilityUi.tooltip.requiresCombo'));
  if (def.requiresDodgeProc) lines.push(t('abilityUi.tooltip.requiresDodge'));
  if (def.requiresOutOfCombat) lines.push(t('abilityUi.tooltip.requiresOutOfCombat'));
  if (def.requiresTargetHpBelow !== undefined) {
    lines.push(t('abilityUi.tooltip.requiresTargetHealthBelow', { percent: formatAbilityNumber(def.requiresTargetHpBelow * 100) }));
  }
  if (def.onNextSwing) lines.push(t('abilityUi.tooltip.onNextSwing'));
  if (def.offGcd) lines.push(t('abilityUi.tooltip.offGlobalCooldown'));
  if (def.targetType === 'friendly') lines.push(t('abilityUi.tooltip.friendlyTarget'));
  else if (def.requiresTarget) lines.push(t('abilityUi.tooltip.enemyTarget'));
  return lines;
}

function abilityEffectText(effects: AbilityEffect[]): string {
  const primary = effects.find((eff) =>
    eff.type === 'directDamage' ||
    eff.type === 'heal' ||
    eff.type === 'weaponDamage' ||
    eff.type === 'weaponStrike' ||
    eff.type === 'aoeDamage' ||
    eff.type === 'aoeRoot' ||
    eff.type === 'finisherDamage' ||
    eff.type === 'drainTick'
  );
  if (primary) {
    switch (primary.type) {
      case 'directDamage':
      case 'heal':
      case 'aoeDamage':
      case 'aoeRoot':
      case 'drainTick':
        return abilityAmountRange(primary.min, primary.max);
      case 'weaponDamage':
      case 'weaponStrike':
        return formatAbilityNumber(primary.bonus);
      case 'finisherDamage':
        return t('abilityUi.tooltip.finisherDamage', {
          base: formatAbilityNumber(primary.base),
          perCombo: formatAbilityNumber(primary.perCombo),
        });
    }
  }

  const secondary = effects.find((eff) =>
    eff.type === 'dot' ||
    eff.type === 'hot' ||
    eff.type === 'absorb' ||
    eff.type === 'imbue'
  );
  if (!secondary) return '';
  switch (secondary.type) {
    case 'dot':
    case 'hot':
      return formatAbilityNumber(secondary.total);
    case 'absorb':
      return formatAbilityNumber(secondary.amount);
    case 'imbue':
      return formatAbilityNumber(secondary.bonus);
    default:
      return '';
  }
}

function abilityAmountRange(min: number, max: number): string {
  if (min === max) return formatAbilityNumber(min);
  return t('abilityUi.tooltip.damageRange', {
    min: formatAbilityNumber(min),
    max: formatAbilityNumber(max),
  });
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function playerClassDisplayName(value: string): string {
  const cls = value as PlayerClass;
  return CLASSES[cls] ? classDisplayName(cls) : cap(value);
}

function raidMarkerDisplayName(index: number): string {
  return t(RAID_MARKER_LABEL_KEYS[index] ?? RAID_MARKER_LABEL_KEYS[0]);
}

function statusLabel(status: string | undefined): string {
  switch (status) {
    case 'combat': return t('hud.social.status.combat');
    case 'dungeon': return t('hud.social.status.dungeon');
    case 'dead': return t('hud.social.status.dead');
    default: return t('hud.social.status.online');
  }
}

// Hover text spelling out what a status dot means, so the orange/grey circles
// aren't a mystery (#100).
function dotTitle(online: boolean, status: string | undefined, zone: string | undefined): string {
  if (!online) return t('hud.social.status.offline');
  const label = statusLabel(status);
  return zone ? t('hud.social.statusWithZone', { status: label, zone: localizeZone(zone) }) : label;
}

function rankLabel(rank: string): string {
  return rank === 'leader'
    ? t('hud.social.ranks.leader')
    : rank === 'officer'
      ? t('hud.social.ranks.officer')
      : t('hud.social.ranks.member');
}
