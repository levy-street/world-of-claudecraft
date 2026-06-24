import { audio } from '../game/audio';
import { GAMEPAD_BUTTON_LABELS, GAMEPAD_NONE } from '../game/gamepad_map';
import {
  BIND_ACTIONS,
  BIND_CATEGORIES,
  isReservedCode,
  type Keybinds,
  keyLabel,
} from '../game/keybinds';
import { isNativeAppShell, useTouchInterface } from '../game/mobile_controls';
import { music, musicZoneForLocation, shouldResetMusicForDungeonEntry } from '../game/music';
import {
  type BoolSettingKey,
  type GameSettings,
  type NumericSettingKey,
  normalizeClickMoveButton,
  SETTING_RANGES,
  type Settings,
} from '../game/settings';
import { sfx } from '../game/sfx';
import { voice } from '../game/voice';
import { castBarState } from '../render/cast_bar';
import { CharacterPreview } from '../render/characters';
import { preloadMechAssets } from '../render/characters/assets';
import { skinCount } from '../render/characters/manifest';
import {
  onPortraitsReady,
  playerPortraitDataUrl,
  visualPortraitDataUrl,
} from '../render/characters/portrait';
import type { Renderer } from '../render/renderer';
import { type AugmentCategory, augmentCategory } from '../sim/content/augments';
import {
  EVENT_SKIN_TIERS,
  MECH_CHROMAS,
  SKIN_RANKS,
  type SkinTier,
  skinRankOrder,
} from '../sim/content/skins';
import {
  cloneAllocation,
  dormantNodes,
  exportBuild,
  FIRST_TALENT_LEVEL,
  importBuild,
  pointsSpent,
  type Role,
  type TalentAllocation,
  type TalentNode,
  talentsFor,
  validateAllocation,
} from '../sim/content/talents';
import type { ZoneDef } from '../sim/data';
import {
  ABILITIES,
  CLASSES,
  COMPANION_UPGRADE_COSTS,
  DELVE_AFFIXES,
  DELVE_LIST,
  DELVES,
  DUNGEON_LIST,
  DUNGEON_X_THRESHOLD,
  delveAt,
  dungeonAt,
  ITEMS,
  isDelvePos,
  MOBS,
  NPCS,
  PROPS,
  QUESTS,
  questRewardItem,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_X,
  WORLD_MIN_Z,
  ZONES,
  zoneAt,
} from '../sim/data';
import { DELVE_MODULE_LAYOUTS, type DelveModuleId } from '../sim/delve_layout';
import { armorTypeForItem, weaponArchetypeForItem } from '../sim/equipment_rules';
import { LEADERBOARD_PAGE_SIZE } from '../sim/leaderboard_page';
import type { Ante, PickAction } from '../sim/lockpick';
import { PICK_ACTIONS } from '../sim/lockpick';
import type { ResolvedAbility } from '../sim/sim';
import type {
  AbilityDef,
  EquipSlot,
  InvSlot,
  LootRollChoice,
  PetMode,
  PlayerClass,
  ResourceType,
  SkinRank,
  Stats,
} from '../sim/types';
import {
  type AbilityEffect,
  CONSUME_DURATION,
  canPrestige,
  dist2d,
  type Entity,
  FISHING_CAST_ID,
  GCD,
  type ItemDef,
  isQuestTurnInNpc,
  MAX_LEVEL,
  MELEE_RANGE,
  MILESTONES,
  type SimEvent,
  virtualLevel,
  xpUntilNextPrestige,
} from '../sim/types';
import type { Decoration } from '../sim/world';
import { generateDecorations } from '../sim/world';
import {
  type ArenaFormat,
  type DelveRunInfo,
  type FriendInfo,
  type IWorld,
  isOverheadEmoteId,
  type LeaderboardEntry,
  type LeaderboardPage,
  type MarketInfo,
  OVERHEAD_EMOTES,
  type OverheadEmoteId,
} from '../world_api';
import { absorbBarView } from './absorb_bar';
import {
  applyBagFilter,
  BAG_CATEGORIES,
  BAG_SORTS,
  type BagCategory,
  type BagFilterState,
  type BagSort,
  DEFAULT_BAG_FILTER,
  parseBagFilter,
  serializeBagFilter,
} from './bag_filter';
import {
  activeCharacterAppearancePreview,
  characterAppearanceOptions,
} from './character_appearance';
import {
  CHANNEL_LABEL_KEYS,
  CHAT_TAB_CHANNELS,
  type ChatTabChannel,
  type ChatTabId,
  channelNeedsJoin,
  composeChatLine,
  isChatTabChannel,
  parseChatTabs,
  serializeChatTabs,
} from './chat_channels';
import { type ChatClock, clampChatClock, formatChatTimestamp } from './chat_timestamp';
import { type ChatBoxGeometry, clampChatBox, parseChatBox, serializeChatBox } from './chat_window';
import { formatClockTime } from './clock';
import {
  shouldPlayCombatImpactForTarget,
  shouldPlayCritSfxForTarget,
  shouldPlayMobVoiceSfxForEntity,
} from './combat_sfx';
import { type CardinalId, compassView } from './compass';
import { formatMinimapCoords } from './coords';
import {
  delveAreaLabel,
  delveSchematicPlayer,
  delveSchematicStatic,
  playerDelveLocal,
  type SchematicPrimitive,
} from './delve_map';
import { dropdownKeyNav } from './dropdown_nav';
import { emoteIconUrl } from './emote_icons';
import { itemDisplayName, tEntity } from './entity_i18n';
import { esc } from './esc';
import {
  holderTierBadgeDataUrl,
  holderTierByIndex,
  holderTierDisplayName,
  holderTierForBalance,
} from './holder_tier';
import {
  buildDefaultFormBar,
  classHasFormBars,
  clearHotbarSlot,
  encodeHotbarAction,
  HOTBAR_ACTION_MIME,
  type HotbarAction,
  parseHotbarAction,
  parseHotbarActions,
  placeAbilityOnSlot,
  placeItemOnSlot,
  shouldSeedFormBar,
  swapHotbarSlots,
  syncHotbarActions,
} from './hotbar';
import {
  formatMoney as formatLocalizedMoney,
  formatNumber,
  getLanguage,
  isSupportedLanguage,
  moneyParts,
  type SupportedLanguage,
  supportedLanguages,
  type TranslationKey,
  t,
  tOptional,
  tPlural,
} from './i18n';
import { iconDataUrl, QUALITY_COLOR, raidMarkerDataUrl } from './icons';
import { itemStatDeltas } from './item_compare';
import { PICK_ACTION_HOTKEYS } from './lockpick_panel';
import { LockpickWindow } from './lockpick_window';
import { reconcileLootRolls as computeLootRollReconcile } from './loot_roll_reconcile';
import { lowHealthVignette } from './low_health';
import { lowResourceView } from './low_resource';
import { overworldDungeonPortals } from './map_dungeon_portals';
import { type MapRegion, mapCanvasHeight, paintTerrainRows } from './map_terrain';
import {
  filterMarketListings,
  MARKET_ARMOR_TYPE_FILTERS,
  MARKET_ITEM_TYPE_FILTERS,
  MARKET_PAGE_SIZE,
  MARKET_RARITY_FILTERS,
  MARKET_WEAPON_TYPE_FILTERS,
  type MarketItemTypeFilter,
  type MarketRarityFilter,
  type MarketSubtypeFilter,
  paginateMarketListings,
} from './market_filters';
import { Meters } from './meters';
import {
  clampMinimapZoom,
  isMaxMinimapZoom,
  isMinMinimapZoom,
  MINIMAP_ZOOM_DEFAULT,
  minimapZoomValue,
  nextMinimapZoom,
} from './minimap_zoom';
import { selectPartyFrameMembers } from './party_frames';
import {
  type PerfOverlayHooks,
  PerfOverlaySettingsPanel,
  type PerfSettingsHost,
} from './perf_overlay_settings';
import {
  CARD_POSES,
  cardCanvasToBlob,
  cardCanvasToUploadBlob,
  type PlayerCardData,
  type PlayerCardStat,
  renderPlayerCardCanvas,
} from './player_card';
import {
  type CharacterStanding,
  cardHostingAvailable,
  fetchReferralInfo,
  fetchStanding,
  type PublishedCard,
  publishCard,
} from './player_card_share';
import { chatPlayerContextActions } from './player_context_menu';
import { hydratePortraits, portraitChipHtml } from './portrait_chip';
import { maskProfanity } from './profanity';
import { encodeQuestLink, parseChatSegments } from './quest_link';
import { type QuestTrackerView, questTrackerView, type TrackedQuest } from './quest_tracker';
import { lockoutParts, lockoutShape } from './raid_lockout';
import { type RaidLockoutI18n, raidLockoutPanelHtml } from './raid_lockout_view';
import { restView } from './rest_indicator';
import { localizeServerText, localizeZone } from './server_i18n';
import { localizeSimAuraName, localizeSimText } from './sim_i18n';
import { buildStatTooltip, type StatId, type StatTooltipModel, weaponDps } from './stat_tooltip';
import { type StatTooltipI18n, statCellHtml, statTooltipHtml } from './stat_tooltip_view';
import { nearestSubzone } from './subzone';
import { localizeTalentTitle, tTalent } from './talent_i18n';
import { talentChoiceIconDataUrl, talentNodeIconDataUrl } from './talent_icons';
import {
  PRESET_ORDER,
  type PresetId,
  resolveTheme,
  THEME_KNOB_LABEL_KEY,
  THEME_KNOB_ORDER,
  type ThemeKnob,
  type ThemeState,
} from './theme';
import { TOOLTIP_PEEK_MS, TouchPeekGuard } from './touch_peek';
import { TutorialOverlay } from './tutorial';
import { svgIcon } from './ui_icons';
import { getUiScale } from './ui_scale';
import { crestIdForEntity } from './unit_portrait';
import { UnitPortraitPainter } from './unit_portrait_painter';
import { buildVendorView } from './vendor_view';
import { renderVendorWindow } from './vendor_window';
import { nextVoicedYell, type VoicedYellState, voicedYellGain } from './voice_events';
import {
  onWalletUiChange,
  verifiedWocBalance,
  walletDisplayAvailable,
  walletUiEnabled,
  wocBalance,
  wocBalanceVerified,
} from './wallet_balance';
import { formatXp, xpBarView } from './xp_bar';

// hooks main wires after Input exists (the options menu drives input, audio,
// graphics, and logout, all of which live outside the HUD). PerfOverlayHooks
// (the customizable performance overlay's config seam) lives in
// perf_overlay_settings.ts alongside the panel that consumes it.
export interface OptionsHooks {
  logout(): void;
  captureKey(cb: (code: string | null) => void): void;
  settings: Settings;
  onSettingChange(key: keyof GameSettings, value: GameSettings[keyof GameSettings]): void;
  // Switch the active locale at runtime (loads the locale chunk, relocalizes the page,
  // fans out woc:languagechange). onStatus receives localized progress/error text for an
  // aria-live element. Resolves false if the locale failed to load (active locale kept).
  changeLanguage(lang: SupportedLanguage, onStatus?: (msg: string) => void): Promise<boolean>;
  // Re-fetch the connected/linked wallet's $WOC balance (server cache-bypassed) so the
  // bag footer and player card reflect on-chain token changes. No-op when the wallet
  // feature is off or no wallet is connected/linked.
  refreshWocBalance(): void;
  perfOverlay: PerfOverlayHooks;
  // UI theming seam — main.ts owns the ThemeStore + live CSS-variable apply.
  theme: ThemeHooks;
  // Gamepad button-layout seam (the concrete GamepadBindings satisfies it
  // structurally), so the Controller options panel can read & rebind buttons
  // without the HUD importing the manager.
  gamepad: GamepadBindingsHooks;
}

export interface ThemeHooks {
  get(): ThemeState;
  setPreset(id: PresetId): void;
  setCustom(knob: ThemeKnob, value: string | null): void;
  resetCustom(): void;
}

// Read/rebind the gamepad's button→action layout from the options panel.
export interface GamepadBindingsHooks {
  entries(): { button: number; action: string }[];
  bind(button: number, action: string): void;
  reset(): void;
}

export interface ReportHooks {
  submit(targetPid: number, reason: string, details: string): Promise<void>;
  submitByName?(targetName: string, reason: string, details: string): Promise<void>;
}

export interface BugReportPayload {
  description: string;
  screenshot: string | null;
  meta: unknown;
}

export interface BugReportHooks {
  // Submit a captured bug report to the server. Resolves on success (screenshotStored
  // is false when the server dropped the screenshot), rejects with a server error
  // message the hud maps via localizeBugReportError.
  submit(payload: BugReportPayload): Promise<{ screenshotStored: boolean }>;
  // Grab a JPEG data URL of the current frame, or null if capture failed/unavailable.
  capture(): string | null;
  // Auto-collected context (build, userAgent, viewport, zone, level/class, camera).
  collectMeta(): unknown;
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T;
const trackMetaPixel = (eventName: string, data?: Record<string, unknown>): void => {
  const fbq = (window as Window & { fbq?: (...args: unknown[]) => void }).fbq;
  if (typeof fbq !== 'function') return;
  fbq('trackCustom', eventName, data ?? {});
};
// The HUD's i18n + number-formatting surface, handed to the pure stat-tooltip
// view so it can render localized breakdowns without importing the i18n runtime.
const STAT_VIEW_DEPS: StatTooltipI18n = {
  t: (key, params) => t(key as TranslationKey, params),
  fmt: (value, opts) => formatNumber(value, opts),
};
const castDisplayName = (id: string): string => {
  if (id === FISHING_CAST_ID) return t('abilityUi.cast.fishing');
  if (id === 'demon_heal') return t('abilityUi.cast.demonHeal');
  const ability = ABILITIES[id];
  return ability ? abilityDisplayName(ability) : id;
};

const _FAMILY_GLYPH: Record<string, string> = {
  beast: '🐾',
  humanoid: '🗡️',
  murloc: '🐟',
  spider: '🕷️',
  kobold: '⛏️',
  undead: '💀',
  troll: '🦴',
  ogre: '👊',
  elemental: '🌀',
  dragonkin: '🐉',
};
const _CLASS_GLYPH: Record<string, string> = {
  warrior: '⚔️',
  paladin: '🔨',
  hunter: '🏹',
  rogue: '🗡️',
  priest: '✝️',
  shaman: '🌩️',
  mage: '🔮',
  warlock: '🕯️',
  druid: '🐻',
};
// Language picker labels. Endonyms (each language's name in its own script) are NOT
// translated — they render identically in every locale, matching the homepage footer
// picker (index.html) and standard i18n practice. Keyed by SupportedLanguage; the picker
// iterates `supportedLanguages`, so a new locale appears once its label is added here.
const LANGUAGE_ENDONYMS: Record<SupportedLanguage, string> = {
  en: 'English (US)',
  es: 'Español (LatAm)',
  es_ES: 'Español (España)',
  fr_FR: 'Français (France)',
  fr_CA: 'Français (Canada)',
  en_CA: 'English (Canada)',
  it_IT: 'Italiano',
  de_DE: 'Deutsch',
  zh_CN: '简体中文',
  zh_TW: '繁體中文',
  ko_KR: '한국어',
  ja_JP: '日本語',
  pt_BR: 'Português (Brasil)',
  ru_RU: 'Русский',
};
const RESOURCE_LABEL_KEYS: Record<ResourceType, TranslationKey> = {
  mana: 'abilityUi.resources.mana',
  rage: 'abilityUi.resources.rage',
  energy: 'abilityUi.resources.energy',
};
const BAG_CATEGORY_LABEL_KEYS: Record<BagCategory, TranslationKey> = {
  all: 'hudChrome.bags.filterAll',
  weapon: 'hudChrome.bags.filterWeapon',
  armor: 'hudChrome.bags.filterArmor',
  consumable: 'hudChrome.bags.filterConsumable',
  material: 'hudChrome.bags.filterMaterial',
  quest: 'hudChrome.bags.filterQuest',
};
const BAG_SORT_LABEL_KEYS: Record<BagSort, TranslationKey> = {
  recent: 'hudChrome.bags.sortRecent',
  quality: 'hudChrome.bags.sortQuality',
  name: 'hudChrome.bags.sortName',
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
  helmet: 'itemUi.slots.helmet',
  shoulder: 'itemUi.slots.shoulder',
  chest: 'itemUi.slots.chest',
  waist: 'itemUi.slots.waist',
  legs: 'itemUi.slots.legs',
  gloves: 'itemUi.slots.gloves',
  feet: 'itemUi.slots.feet',
};
const ITEM_QUALITY_LABEL_KEYS: Record<ItemQuality, TranslationKey> = {
  poor: 'itemUi.quality.poor',
  common: 'itemUi.quality.common',
  uncommon: 'itemUi.quality.uncommon',
  rare: 'itemUi.quality.rare',
  epic: 'itemUi.quality.epic',
  legendary: 'itemUi.quality.legendary',
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
  elixir: 'itemUi.kind.elixir',
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
  `#${((CLASSES as Record<string, { color: number }>)[cls]?.color ?? 0x5fa8ff).toString(16).padStart(6, '0')}`;

const EMOTE_WHEEL_LIMIT = 8;
const DEFAULT_EMOTE_WHEEL: OverheadEmoteId[] = [
  'wave',
  'laugh',
  'question',
  'cheer',
  'dance',
  'point',
  'flex',
  'cry',
];

// yards past a zone boundary before the crossing banner/welcome commits
const ZONE_BANNER_DEADBAND = 5;
const IGNORED_CHAT_NAMES_KEY = 'woc_ignored_chat_names';
// WoW-style chat tabs: the ordered channel tabs the player has opened, and the
// tab that was active last session. The built-in `all`/`combat` views are
// implicit and never stored.
const CHAT_TABS_KEY = 'woc_chat_tabs';
const CHAT_ACTIVE_TAB_KEY = 'woc_chat_active_tab';
// Persisted chat-window geometry (drag position + resize size). Desktop only —
// the mobile layout owns its own placement and ignores this.
const CHAT_GEOMETRY_KEY = 'woc_chat_geometry';
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
  attackMove: 'hud.keybinds.actions.attackMove',
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
  // Combat/social target + emote-wheel actions. English-only chrome keys (the
  // `hud` catalog domain is tsc-locked to inline per-locale blocks).
  emoteWheel: 'hudChrome.keybinds.emoteWheel',
  targetFriendly: 'hudChrome.keybinds.targetFriendly',
  targetFriendlyNext: 'hudChrome.keybinds.targetFriendlyNext',
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

const DELVE_AFFIX_COLORS: Record<string, string> = {
  restless_graves: '#8b7355',
  bad_air: '#6a8a6a',
  candleblind: '#c9a227',
  old_mechanisms: '#7a8a9a',
  flooded_paths: '#4a7a9a',
  grave_tax: '#9a6a4a',
  unstable_roof: '#8a6a5a',
  cult_remnants: '#7a4a8a',
  chapel_candle: '#ffd100',
};
type MobileHotbarDrag = {
  pointerId: number;
  sourceIndex: number;
  startX: number;
  startY: number;
  active: boolean;
  timer: number;
  targetIndex: number | null;
};

// world map: terrain is pre-rendered for the whole zone at this resolution
// (cached per zone) and a sub-rect is blitted for the current zoom.
const MAP_BG_RES = 480;
const MAP_MAX_ZOOM = 6;
const MAP_DETAIL_ZOOM = 2.2; // at/above this zoom, overlay buildings + vegetation

// --- spatial sound-effect mapping (clips generated by scripts/gen_sfx.mjs;
// engine in src/game/sfx.ts) ------------------------------------------------
const SFX_MOB_FAMILIES = new Set([
  'beast',
  'spider',
  'murloc',
  'kobold',
  'humanoid',
  'undead',
  'troll',
  'ogre',
  'elemental',
  'dragonkin',
  'demon',
]);
const SFX_CAST_SCHOOLS = new Set(['fire', 'frost', 'arcane', 'shadow', 'holy', 'nature']);
// Combat/spell/creature SFX are trimmed this much under movement/ambience so the
// soundscape doesn't get fatiguing in a long fight. One knob for the whole layer.
const COMBAT_GAIN = 0.7;

/** Creature-voice family for a mob templateId (boar split from beast), or null. */
function mobVoiceFamily(templateId: string): string | null {
  if (templateId === 'wild_boar' || templateId === 'elder_bristleback') return 'boar';
  const fam = MOBS[templateId]?.family;
  return fam && SFX_MOB_FAMILIES.has(fam) ? fam : null;
}

/** Sustained cast-loop clip for an ability's school, or null (physical/unknown). */
function castKeyForAbility(ability: string): string | null {
  const school = ABILITIES[ability]?.school;
  return school && SFX_CAST_SCHOOLS.has(school) ? `cast_${school}` : null;
}

/** Physical-impact timbre by what's hit: bone (undead), metal (plate), leather
 *  (other players), flesh (creatures). */
function materialImpactKey(tgt: Entity): string {
  if (tgt.kind === 'player')
    return tgt.templateId === 'warrior' || tgt.templateId === 'paladin'
      ? 'impact_metal'
      : 'impact_leather';
  if (tgt.kind === 'mob')
    return MOBS[tgt.templateId]?.family === 'undead' ? 'impact_bone' : 'impact_flesh';
  return 'impact_flesh';
}

/** Melee/ranged swing clip by player class. */
function weaponSwingKey(cls: string): string {
  switch (cls) {
    case 'rogue':
    case 'warlock':
      return 'melee_swing_light';
    case 'hunter':
      return 'melee_bow';
    case 'paladin':
    case 'mage':
    case 'priest':
    case 'druid':
      return 'melee_swing_heavy';
    default:
      return 'melee_swing_blade'; // warrior, shaman
  }
}

// Stable voice-clip key for a spoken yell line. MUST match the generator slug in
// scripts/voices/extra_lines.mjs (yellKey) so encounter dialogue (e.g. the
// Nythraxis raid) plays the right clip from the live chat event text.
function yellVoiceKey(text: string): string {
  return `yell__${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)}`;
}

export class Hud {
  private static readonly BAR_ABILITY_SLOTS = 11; // bar slots 1..11; slot 0 is the fixed Attack toggle
  private static readonly PET_AUTOCAST_TOUCH_HOLD_MS = 2000;
  private static ddSeq = 0; // monotonic id source for buildDropdown listbox/option ARIA wiring
  private static readonly FORM_TOGGLE_IDS = new Set(['bear_form', 'cat_form', 'travel_form']); // shift toggles, castable in any form
  private abilityButtons: {
    btn: HTMLButtonElement;
    label: HTMLSpanElement;
    countEl: HTMLSpanElement;
    keybindEl: HTMLSpanElement;
    cdOverlay: HTMLDivElement;
    cdText: HTMLDivElement;
    lastIcon: string;
  }[] = [];
  private hotbarActions: HotbarAction[] = []; // index = barSlot-1
  private loadedSlotMapFromStorage = false;
  private knownAbilityIdsAtLastSlotSync: Set<string> | null = null;
  private activeHotbarForm: HotbarForm = 'normal';
  private dragAction: { action: Exclude<HotbarAction, null>; sourceIndex: number | null } | null =
    null;
  // Set while dragging an equipped piece out of the paperdoll onto the bags window.
  private dragUnequipSlot: EquipSlot | null = null;
  private mobileHotbarDrag: MobileHotbarDrag | null = null;
  private suppressNextActionClick = false;
  private optionsHooks: OptionsHooks | null = null;
  private reportHooks: ReportHooks | null = null;
  private bugReportHooks: BugReportHooks | null = null;
  // Soft swear terms from the server (online only), masked in chat when the
  // player's "Filter Profanity" setting is on. Fed by main.ts from ClientWorld.
  private profanityWords: string[] = [];
  private optionsView:
    | 'main'
    | 'keybinds'
    | 'graphics'
    | 'audio'
    | 'interface'
    | 'performance'
    | 'controller'
    | 'bugreport' = 'main';
  // The Options > Performance panel, lazily built and reused (it caches the live
  // position-slider handles so a drag-to-move can update them in place).
  private perfSettings: PerfOverlaySettingsPanel | null = null;
  private capturingKey: { action: string; index: number } | null = null; // binding awaiting a key
  private keybindNote = '';
  private emoteWheelOpen = false;
  private emoteWheelHover: OverheadEmoteId | 'edit' | null = null;
  private emoteWheelSlots: OverheadEmoteId[] = [];
  private emoteWheelEl: HTMLDivElement | null = null;
  private emoteWheelPinned = false;
  private chatLogEl = $('#chatlog');
  private lastVoicedYell: VoicedYellState | null = null;
  // Classic "Show Timestamps" interface option — off by default, persisted to
  // localStorage. New chat lines get a bracketed wall-clock prefix when on.
  private chatTimestamps = localStorage.getItem('chatTimestamps') === '1';
  private chatClock: ChatClock = clampChatClock(localStorage.getItem('chatClock'));
  private combatLogEl = $('#combatlog');
  // WoW-style chat tabs. `chatTabs` are the player-added channel tabs (the
  // built-in `all`/`combat` views are implicit); `activeChatTab` is the one
  // currently shown, and drives both the log filter and the send channel.
  private chatTabs: ChatTabChannel[] = [];
  private activeChatTab: ChatTabId = 'all';
  private errorEl = $('#error-msg');
  private bannerEl = $('#banner');
  private subzoneEl = $('#subzone-banner');
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
  private targetCastbarEl = $('#tf-castbar');
  private targetCastbarFillEl = this.targetCastbarEl.querySelector('.fill') as HTMLElement;
  private targetCastbarLabelEl = this.targetCastbarEl.querySelector('.label') as HTMLElement;
  private targetCastbarTimerEl = this.targetCastbarEl.querySelector('.timer') as HTMLElement;
  private actionbarEl = $('#actionbar');
  private xpFillEl = $('#xpbar .fill');
  private xpLabelEl = $('#xpbar .label');
  private deathOverlayEl = $('#death-overlay');
  private releaseSpiritBtnEl = $('#release-btn');
  private hotWriteCache = new Map<HTMLElement, string>();
  private hotDomWrites = 0;
  private hotDomSkippedWrites = 0;
  private subzoneTimer: number | undefined;
  private lastSubzone: string | null = null;
  private lastMusicDungeonId: string | null = null;
  private minimapCtx: CanvasRenderingContext2D;
  private minimapBg: HTMLCanvasElement;
  private clockEl: HTMLElement | null = null;
  private raidLockoutEl: HTMLElement | null = null;
  private raidLockoutLocked = false;
  private clock24 = false; // 24-hour vs 12-hour AM/PM display
  private lastClockText = ''; // avoid redundant DOM writes each frame
  private lastCoordsText = ''; // cache so we only touch the DOM when coords change
  // heading compass: a pool of rose-label spans built once, repositioned per frame
  private compassMarks = new Map<string, HTMLElement>();
  private compassHeadingEl: HTMLElement | null = null;
  private lastCompassHeading = '';
  // Minimap zoom: a multiplier on the minimap's base pixels-per-yard. Discrete
  // presets (see minimap_zoom.ts), persisted to localStorage. 1 = shipped look.
  private minimapZoom = MINIMAP_ZOOM_DEFAULT;
  private minimapZoomLabel: HTMLElement | null = null;
  // World-map terrain backgrounds, cached per zone. A background depends only on
  // (seed, zone bounds), both fixed for the session, so it is immutable and
  // cached forever; rendering one is ~200ms (230k terrainHeight/roadDistance
  // samples), which is why it must never run on the open path (see mapPrewarm).
  private mapBgCache = new Map<string, HTMLCanvasElement>();
  // In-flight idle prewarm of one zone's background, painted a few rows per
  // idle slice so it never blocks a frame. Committed to mapBgCache when done.
  private mapPrewarm: {
    zoneId: string;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    img: ImageData;
    W: number;
    H: number;
    row: number;
    region: MapRegion;
  } | null = null;
  private mapPrewarmHandle = 0;
  // Which scheduler produced mapPrewarmHandle. requestIdleCallback and setTimeout
  // hand out ids from separate pools, so the handle must be cancelled with the
  // matching canceller; a clearTimeout on an idle id (or vice versa) could cancel
  // an unrelated timer that happens to share the number.
  private mapPrewarmVia: 'idle' | 'timeout' | null = null;
  // Delve schematic caches: static background (floor/pillars/tombs/dais/exit)
  // keyed by module id, redrawn only when the module changes.
  private delveSchematicBg: HTMLCanvasElement | null = null;
  private delveSchematicBgModuleId: string = '';
  private delveMapBg: HTMLCanvasElement | null = null;
  private delveMapBgModuleId: string = '';
  private openLootMobId: number | null = null;
  private openLootChestId: number | null = null;
  private activeLootRolls = new Map<
    number,
    { event: Extract<SimEvent, { type: 'lootRoll' }>; receivedAt: number; durationMs: number }
  >();
  // rolls the player has answered or let expire locally; suppresses the
  // snapshot reconcile from re-showing them until the server drops the roll
  private dismissedLootRolls = new Set<number>();
  // shown rolls already observed in the open-roll mirror at least once, so their
  // later absence from the mirror means the server resolved them (retire), not
  // that the mirror simply has not caught up to a just-shown event yet.
  private confirmedLootRolls = new Set<number>();
  private openVendorNpcId: number | null = null;
  private openDelveBoardNpcId: number | null = null;
  private lastDelveTrackerSig = '';
  private selectedDelveTier: 'normal' | 'heroic' = 'normal';
  private delveBoardTab: 'delve' | 'shop' = 'delve';
  private delveBoardReturnFocus: HTMLElement | null = null;
  private lockpickOfferId: number | null = null;
  private lockpickCoffer = false;
  private lockpickReturnFocus: HTMLElement | null = null;
  private lockpickKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  // The board paints from the authoritative world.lockpickState (never a cached
  // copy), and owns the per-page countdown with a generation guard. hud.ts keeps
  // only offer routing, focus restore, and keybinds.
  private readonly lockpickWindow = new LockpickWindow({
    getState: () => this.sim.lockpickState,
    tierName: (tier) => this.lockpickTierName(tier),
    onEngage: (objectId, ante) => this.submitLockpickEngage(objectId, ante),
    onAction: (action) => this.submitLockpickAction(action),
    onAbort: () => this.submitLockpickAbort(),
    onClose: () => this.closeLockpick(),
  });
  private openGossipNpcId: number | null = null;
  private openQuestDetailId: string | null = null;
  private selectedQuestLogId: string | null = null;
  private pendingChatLinks = new Map<string, string>(); // display "[Name]" -> questId
  private questDialogReturnFocus: HTMLElement | null = null;
  private questDialogOpenedAtMs = 0;
  private questLogReturnFocus: HTMLElement | null = null;
  private lastPortraitTarget = -999;
  // swing timer: the period is captured from the reset edge (swingTimer jumping
  // up), so the bar tracks real swing speed including haste / ranged weapons.
  private swingPeriod = 0;
  private lastSwingTimer = 0;
  private lastLowResourceSig = '';
  // trading: locally staged offer, pushed to the server on change
  private stagedTrade: { items: InvSlot[]; copper: number } = { items: [], copper: 0 };
  private tradeWasOpen = false;
  private lastTradeSig = '';
  private lastPartySig = '';
  private lastArenaSig = '';
  private lastArenaStatusSig = '';
  private arenaMatchSeen = false; // closes the queue panel once a bout starts
  private arenaBracket: ArenaFormat = '1v1';
  // 2v2 Fiesta UI state (all transient)
  private fiestaScoreSeen = { a: -1, b: -1 }; // last rendered tally (for score-ping)
  private fiestaOfferKey = ''; // identity of the currently-shown augment offer
  private fiestaActiveSeen = false; // were we in a fiesta bout last frame
  private fiestaWasDown = false; // were we benched last frame (for the revive cue)
  // Offline only: dev toggle that spins up a 2v2 Fiesta vs bots. Wired by main.ts
  // (left null online, which hides the button).
  private fiestaPracticeHook: (() => void) | null = null;
  // World Market (the Merchant's auction house)
  private marketOpen = false;
  private marketTab: 'browse' | 'sell' | 'collect' = 'browse';
  private marketItemTypeFilter: MarketItemTypeFilter = 'all';
  private marketSubtypeFilter: MarketSubtypeFilter = 'all';
  private marketRarityFilter: MarketRarityFilter = 'all';
  private marketBrowsePage = 0;
  private leaderboardPage = 0;
  private marketSellItem: string | null = null; // bag item staged for listing
  private marketSearchQuery = ''; // active browse search term (sent to the server)
  private lastMarketSig = '';
  // Modular bag filtering: category chips + sort + live search, persisted across
  // sessions. Pure logic lives in bag_filter.ts; renderBags() is the thin consumer.
  private static readonly BAG_FILTER_KEY = 'woc_bag_filter';
  private bagFilter: BagFilterState = (() => {
    try {
      return parseBagFilter(localStorage.getItem(Hud.BAG_FILTER_KEY));
    } catch {
      return { ...DEFAULT_BAG_FILTER };
    }
  })();
  // all-time ladder, fetched best-effort from the server (online only)
  private arenaAllTime: Partial<
    Record<
      ArenaFormat,
      { name: string; class: string; level: number; rating: number; wins: number; losses: number }[]
    >
  > = {};
  private arenaLbFetchedAt: Partial<Record<ArenaFormat, number>> = {};
  private lastCombatEventAt = 0;
  // mob ids that have already vocalized their aggro alert (so the first strike
  // roars and subsequent strikes use the attack vocalization). Cleared on death
  // or when the entity leaves interest (reconcileSfx).
  private mobAggroed = new Set<number>();
  // entity ids with a sustained cast-loop SFX playing, so reconcileSfx can stop
  // loops for casters that left interest mid-channel (no castStop/death arrives).
  private castLoopIds = new Set<number>();
  private lastNythraxisCombatEventAt = 0;
  private lastResting = false;
  private lastZoneId = '';
  private mapZoom = 1; // world-map zoom: 1 = whole zone, up to MAP_MAX_ZOOM
  private mapCenter: { x: number; z: number } | null = null; // pan target; null = follow player
  private mapDrag: { px: number; py: number; cx: number; cz: number } | null = null;
  private mapView: {
    spanX: number;
    spanZ: number;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  } | null = null;
  private mapDecorations: Decoration[] | null = null; // cached trees/rocks (whole world)
  private windowDrag: {
    el: HTMLElement;
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null = null;
  // Movable/resizable chat box: current geometry (null = stock CSS default) plus
  // the in-progress pointer gesture, if any. See chat_window.ts for the math.
  private chatBox: ChatBoxGeometry | null = null;
  private chatBoxGesture:
    | { kind: 'move'; pointerId: number; grabX: number; grabY: number }
    | {
        kind: 'resize';
        pointerId: number;
        startX: number;
        startY: number;
        startW: number;
        startH: number;
      }
    | null = null;
  private windowObserver: MutationObserver | null = null;
  private windowZ = 50;
  private ignoredChatNames = new Set<string>();
  private socialTab: 'friends' | 'guild' | 'ignore' | 'raid' = 'friends';
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
  // Cosmetic skin-select event overlay (opened by the skinEvent cue). The shared
  // CharacterPreview above is borrowed for the rotatable 3D preview.
  private skinEventEl: HTMLElement | null = null;
  private skinEventRank: SkinRank | null = null;
  private skinEventTiers: readonly SkinTier[] = EVENT_SKIN_TIERS;
  private skinEventSelected = -1;
  private skinEventSelectedKey = '';
  private skinEventRevealTimer: number | null = null;
  private skinEventWheelAngle = 0;
  // 'class' = per-class event skins; 'mech' = the Combat Mech chroma catalog.
  private skinEventMode: 'class' | 'mech' = 'class';
  // Pending lazy-load of the mech GLB + chromas; the reveal waits on it.
  private mechAssetsPromise: Promise<void> | null = null;
  private cardModalEl: HTMLElement | null = null;
  private cardModalReturnFocus: HTMLElement | null = null;
  // Set while the player-card modal is open: re-composites the card with the
  // current pose so a $WOC balance change (the bag-footer path can't reach the
  // card's canvas) is reflected. Cleared when the modal closes.
  private recomposeOpenCard: (() => void) | null = null;
  // current typeahead state: which input, its results, and the keyboard-
  // highlighted row (-1 = none), so Enter/Arrow keys can pick a suggestion
  private socialSuggest: {
    field: string;
    items: { name: string; cls: string; level: number }[];
    index: number;
  } = { field: '', items: [], index: -1 };

  private meters: Meters;
  private tutorial = new TutorialOverlay();
  private lastPetBarSig = '';
  private pendingPetFeed = false;
  private petModeMenuOpen = false;
  // Talents: a local staged allocation the user edits before committing (Apply).
  private talentStage: TalentAllocation | null = null;
  private talentTab: 'class' | 'spec' = 'class';

  constructor(
    private sim: IWorld,
    private renderer: Renderer,
    private keybinds: Keybinds,
  ) {
    this.ignoredChatNames = this.loadIgnoredChatNames();
    this.meters = new Meters(sim);
    this.initChatTabs();
    this.initChatBoxGeometry();
    this.initWindowManagement();
    this.emoteWheelSlots = this.loadEmoteWheelSlots();
    this.loadSlotMap();
    this.buildActionBar();
    this.refreshKeybindLabels();
    this.buildXpTicks();
    document.addEventListener('woc:languagechange', () => this.refreshLocalizedDynamicUi());
    // re-render the bag footer (and re-composite an open player card) when the
    // connected wallet's $WOC balance changes
    onWalletUiChange(() => {
      if ($('#bags').style.display === 'block') this.renderBags();
      this.recomposeOpenCard?.();
    });
    $('#pf-name').textContent = sim.player.name;
    this.drawPlayerFramePortrait();
    // Character GLBs preload after the HUD mounts; once the real 3D portraits are
    // ready, upgrade the player frame and force the target frame to redraw.
    onPortraitsReady(() => {
      this.drawPlayerFramePortrait();
      this.lastPortraitTarget = -999;
    });
    const mm = $('#minimap') as unknown as HTMLCanvasElement;
    this.minimapCtx = mm.getContext('2d')!;
    this.minimapBg = this.renderTerrainCanvas(140, {
      minX: WORLD_MIN_X,
      maxX: WORLD_MAX_X,
      minZ: WORLD_MIN_Z,
      maxZ: WORLD_MAX_Z,
    });
    mm.style.cursor = 'var(--cursor-point)';
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
      if (
        target &&
        (this.emoteWheelEl?.contains(target) ||
          document.getElementById('mm-emote')?.contains(target) ||
          document.getElementById('mobile-emote')?.contains(target))
      )
        return;
      this.hideEmoteWheel();
    });
    this.initCompass();
    this.initMinimapZoom(mm);
    this.releaseSpiritBtnEl.addEventListener('click', () => {
      if (this.sim.arenaInfo?.match) return;
      this.sim.releaseSpirit();
    });
    document.addEventListener('pointerdown', (ev) => {
      const target = ev.target as Node | null;
      if (!target) return;
      const communityMenu = document.getElementById('community-menu') as HTMLDetailsElement | null;
      if (
        document.body.classList.contains('mobile-touch') &&
        communityMenu?.open &&
        !communityMenu.contains(target)
      ) {
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
    // classic-WoW minimap clock: real local time under the minimap; click it to
    // flip between 12-hour (AM/PM) and 24-hour display. Real-time clocks are a
    // UI-only concern, so `new Date()` here is fine (the sim-only time ban
    // doesn't apply — cf. meters.ts using performance.now()).
    this.clockEl = $('#minimap-clock');
    // raid-lockout badge on the minimap rim: a lock icon whose hover/tap panel
    // lists the player's raid lockouts (the unlock countdown). Always visible;
    // it lights up (.locked) while any raid is on cooldown. attachTooltip already
    // handles desktop hover, mobile tap, and keyboard focus uniformly.
    this.raidLockoutEl = document.getElementById('raid-lockout');
    if (this.raidLockoutEl) {
      this.raidLockoutEl.innerHTML = svgIcon('lock');
      this.raidLockoutEl.hidden = false;
      this.attachTooltip(this.raidLockoutEl, () => this.raidLockoutPanelView());
    }
    this.clock24 = (() => {
      try {
        return localStorage.getItem('clock24h') === '1';
      } catch {
        return false;
      }
    })();
    this.clockEl?.addEventListener('click', () => {
      this.clock24 = !this.clock24;
      try {
        localStorage.setItem('clock24h', this.clock24 ? '1' : '0');
      } catch {
        /* private mode */
      }
      this.lastClockText = ''; // force a redraw in the new format
      this.updateClock();
    });
    this.updateClock();
    // classic MMOs: the player interaction menu opens from the target portrait
    $('#target-frame').addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      const tid = this.sim.player.targetId;
      const t = tid !== null ? this.sim.entities.get(tid) : null;
      if (t && t.kind === 'player' && t.id !== this.sim.playerId) {
        this.openContextMenu(t.id, t.name, (ev as MouseEvent).clientX, (ev as MouseEvent).clientY);
      } else if (t && t.kind === 'mob' && t.ownerId === this.sim.playerId) {
        this.openPetMenu(
          t.id,
          t.name,
          t.dead,
          (ev as MouseEvent).clientX,
          (ev as MouseEvent).clientY,
        );
      } else if (
        t &&
        t.kind === 'mob' &&
        !t.dead &&
        t.hostile &&
        t.ownerId === null &&
        this.sim.partyInfo
      ) {
        // classic MMOs: right-click an enemy's unit frame to set a raid marker.
        // Mirror Sim.setMarker's markable criteria (live wild hostile mob) so the
        // menu never appears for a pet/non-hostile mob where it would be a no-op.
        this.openMarkerMenu(t.id, t.name, (ev as MouseEvent).clientX, (ev as MouseEvent).clientY);
      }
    });
    $('#player-frame').addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      this.openSelfContextMenu((ev as MouseEvent).clientX, (ev as MouseEvent).clientY);
    });
    $('#mm-char').addEventListener('click', () => this.toggleChar());
    $('#mm-spell').addEventListener('click', () => this.toggleSpellbook());
    $('#mm-talents')?.addEventListener('click', () => this.toggleTalents());
    $('#mm-quest').addEventListener('click', () => this.toggleQuestLog());
    // Collapse/expand the on-screen quest tracker by clicking its header. The
    // overlay is click-through (pointer-events:none) except the header button, so
    // delegate on the stable container (the header is rebuilt on each render).
    $('#quest-tracker').addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.qt-header')) this.toggleQuestTrackerCollapsed();
    });
    // Keyboard activation: handle Enter/Space here and stop the event before it
    // bubbles to the window-level game keybinds (Enter is bound to Open Chat,
    // Space is preventDefault'd for jump), which would otherwise hijack the
    // focused header button's native activation. The tracker is a non-modal
    // overlay, so canUseGameKeys() stays true and those binds fire while it has
    // focus; stopping propagation here keeps the toggle reachable by keyboard.
    $('#quest-tracker').addEventListener('keydown', (e) => {
      if (!(e.target as HTMLElement).closest('.qt-header')) return;
      if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        this.toggleQuestTrackerCollapsed();
      }
    });
    // The delve board and lockpick panel are non-modal .window.panel overlays, so
    // canUseGameKeys() stays true and the global jump (Space) / chat (Enter) binds
    // would otherwise hijack those keys on a focused panel button. Stop propagation
    // (but NOT the default, so the button's native activation still fires) when a
    // panel button has focus, mirroring the quest-tracker guard above.
    for (const panelId of ['#delve-board', '#lockpick-panel']) {
      $(panelId).addEventListener('keydown', (e) => {
        if ((e.target as HTMLElement).tagName !== 'BUTTON') return;
        if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') e.stopPropagation();
      });
    }
    $('#mm-map').addEventListener('click', () => this.toggleMap());
    $('#map-close').addEventListener('click', () => {
      $('#map-window').style.display = 'none';
    });
    const mapCanvas = $('#map-canvas') as unknown as HTMLCanvasElement;
    mapCanvas.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault();
        this.zoomMap((ev as WheelEvent).deltaY < 0 ? 1.2 : 1 / 1.2);
      },
      { passive: false },
    );
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
    const endDrag = () => {
      this.mapDrag = null;
      mapCanvas.style.cursor = '';
    };
    mapCanvas.addEventListener('pointerup', endDrag);
    mapCanvas.addEventListener('pointercancel', endDrag);
    $('#mm-bag').addEventListener('click', () => this.toggleBags());
    // Drop an equipped piece dragged out of the paperdoll onto the bags window.
    const bagsEl = $('#bags');
    bagsEl.addEventListener('dragover', (e) => {
      if (this.dragUnequipSlot === null) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';
      bagsEl.classList.add('drop-target');
    });
    bagsEl.addEventListener('dragleave', (e) => {
      if (e.target === bagsEl) bagsEl.classList.remove('drop-target');
    });
    bagsEl.addEventListener('drop', (e) => {
      if (this.dragUnequipSlot === null) return;
      e.preventDefault();
      const slot = this.dragUnequipSlot;
      this.dragUnequipSlot = null;
      bagsEl.classList.remove('drop-target');
      this.sim.unequipItem(slot);
      audio.click();
      this.hideTooltip();
      this.renderBags();
      this.renderCharIfOpen();
    });
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
    this.prewarmMapBg(startZone.id); // render the spawn-zone map bg during idle, not on first open
    this.showBanner(startZoneName);
    this.log(t('hud.core.welcomeZone', { zone: startZoneName }), '#ffd100');
    this.logZoneWelcome(startZone);
    this.log(t('hudChrome.tips.joinChannels'), '#7fd4ff');
  }

  private setText(el: HTMLElement, text: string): void {
    if (this.hotWriteCache.get(el) === text) {
      this.hotDomSkippedWrites++;
      return;
    }
    this.hotWriteCache.set(el, text);
    this.hotDomWrites++;
    el.textContent = text;
  }

  private setDisplay(el: HTMLElement, display: string): void {
    const key = `display:${display}`;
    if (this.hotWriteCache.get(el) === key) {
      this.hotDomSkippedWrites++;
      return;
    }
    this.hotWriteCache.set(el, key);
    this.hotDomWrites++;
    el.style.display = display;
  }

  private setTransform(el: HTMLElement, transform: string): void {
    const key = `transform:${transform}`;
    if (this.hotWriteCache.get(el) === key) {
      this.hotDomSkippedWrites++;
      return;
    }
    this.hotWriteCache.set(el, key);
    this.hotDomWrites++;
    el.style.transform = transform;
  }

  private setWidth(el: HTMLElement, width: string): void {
    const key = `width:${width}`;
    if (this.hotWriteCache.get(el) === key) {
      this.hotDomSkippedWrites++;
      return;
    }
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
      this.windowObserver?.observe(el, {
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden'],
      });
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
      this.windowDrag = {
        el,
        pointerId: ev.pointerId,
        offsetX: ev.clientX - rect.left,
        offsetY: ev.clientY - rect.top,
      };
      el.classList.add('window-dragging');
      el.dataset.windowMoved = '1';
      try {
        target.setPointerCapture?.(ev.pointerId);
      } catch {
        /* synthetic/legacy pointer without active capture */
      }
    });
    document.addEventListener('pointermove', (ev) => {
      const drag = this.windowDrag;
      if (!drag || drag.pointerId !== ev.pointerId) return;
      ev.preventDefault();
      const rect = drag.el.getBoundingClientRect();
      this.setWindowPixelPosition(
        drag.el,
        ev.clientX - drag.offsetX,
        ev.clientY - drag.offsetY,
        rect,
      );
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
    if (el.dataset.windowMoved === '1' || el.id === 'loot-window' || el.id === 'confirm-dialog')
      return;
    if (
      document.body.classList.contains('vendor-open') &&
      (el.id === 'vendor-window' || el.id === 'bags')
    )
      return;
    const openCount = [...document.querySelectorAll<HTMLElement>('.window.panel')].filter(
      (win) => win !== el && this.isWindowVisible(win),
    ).length;
    if (openCount <= 0) return;
    const rect = el.getBoundingClientRect();
    const offset = (((openCount - 1) % 8) + 1) * 28;
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
    if (
      target.closest(
        'button, input, textarea, select, a, .x-btn, .ui-dd, [draggable="true"], #map-canvas, #map-zoom',
      )
    )
      return false;
    const title = target.closest('.panel-title');
    if (title && win.contains(title)) return true;
    return win.id === 'map-window' && target === win;
  }

  private setWindowPixelPosition(
    el: HTMLElement,
    left: number,
    top: number,
    rect = el.getBoundingClientRect(),
  ): void {
    const margin = 8;
    // Callers pass coordinates in visual (zoomed) space: getBoundingClientRect()
    // and pointer clientX/clientY are post-zoom, but style.left/top are author
    // lengths the browser multiplies by #ui's `zoom`. Convert into author space
    // (divide by the live UI scale) so the window lands where the pointer is, and
    // clamp against the viewport expressed in that same author space. (Z=1 when
    // uiScale is at its default, so this is a no-op for most players.)
    const z = getUiScale();
    const vw = window.innerWidth / z;
    const vh = window.innerHeight / z;
    const aLeft = left / z;
    const aTop = top / z;
    const width = Math.min(rect.width / z, vw - margin * 2);
    const height = Math.min(rect.height / z, vh - margin * 2);
    const maxLeft = Math.max(margin, vw - width - margin);
    const maxTop = Math.max(margin, vh - height - margin);
    el.style.left = `${Math.max(margin, Math.min(maxLeft, aLeft))}px`;
    el.style.top = `${Math.max(margin, Math.min(maxTop, aTop))}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.transform = 'none';
  }

  // Place a cursor-anchored popup (context menus, the loot window) at a viewport
  // coordinate. x/y arrive in visual (zoomed / pointer-client) space; #ui is
  // scaled by `zoom`, so convert into author space (÷ scale) and clamp against
  // the viewport in that same space, keeping `reserveRight`/`reserveBottom`
  // author px clear so the popup never spills off-screen. minTop pins it below
  // the top edge. Z=1 (default uiScale) leaves the math identical to before.
  private placePopupAt(
    el: HTMLElement,
    x: number,
    y: number,
    reserveRight: number,
    reserveBottom: number,
    minLeft = 0,
    minTop = 0,
  ): void {
    const z = getUiScale();
    const maxLeft = window.innerWidth / z - reserveRight;
    const maxTop = window.innerHeight / z - reserveBottom;
    el.style.left = `${Math.max(minLeft, Math.min(maxLeft, x / z))}px`;
    el.style.top = `${Math.max(minTop, Math.min(maxTop, y / z))}px`;
  }

  private topmostOpenWindow(): HTMLElement | null {
    return (
      [...document.querySelectorAll<HTMLElement>('.window.panel')]
        .filter((el) => this.isWindowVisible(el))
        .sort((a, b) => this.windowZValue(b) - this.windowZValue(a))[0] ?? null
    );
  }

  private closeManagedWindow(el: HTMLElement): void {
    if (this.windowDrag?.el === el) this.windowDrag = null;
    delete el.dataset.windowOpen;
    switch (el.id) {
      case 'confirm-dialog':
        el.remove();
        break;
      case 'options-menu':
        this.closeOptions();
        break;
      case 'social-window':
        el.classList.remove('open');
        this.hideTooltip();
        break;
      case 'trade-window':
        this.sim.tradeCancel();
        this.hideTooltip();
        break;
      case 'market-window':
        this.closeMarket();
        break;
      case 'vendor-window':
        this.closeVendor();
        break;
      case 'loot-window':
        this.closeLoot();
        break;
      case 'quest-dialog':
        this.closeQuestDialog();
        break;
      case 'delve-board':
        this.closeDelveBoard();
        break;
      case 'bags':
        if (this.vendorOpen && document.body.classList.contains('mobile-touch')) this.closeVendor();
        else {
          el.style.display = 'none';
          this.hideTooltip();
          this.cancelPetFeed();
        }
        break;
      case 'talents-window':
        el.style.display = 'none';
        this.talentStage = null;
        this.hideTooltip();
        break;
      case 'emote-editor':
        this.closeEmoteEditor();
        break;
      default:
        el.style.display = 'none';
        this.hideTooltip();
        break;
    }
    this.syncAnyWindowOpenState();
  }

  // -------------------------------------------------------------------------
  // Chat tabs (WoW-style): the built-in "Chat" (all) and "Combat Log" views,
  // plus player-added per-channel tabs. The active tab drives BOTH the log
  // filter (which messages show) and the send channel (what plain text targets),
  // so a player can chat in World/LFG/Party/etc. without retyping the command.
  // -------------------------------------------------------------------------

  private initChatTabs(): void {
    let savedTabs: string | null = null;
    let savedActive: string | null = null;
    try {
      savedTabs = localStorage.getItem(CHAT_TABS_KEY);
      savedActive = localStorage.getItem(CHAT_ACTIVE_TAB_KEY);
    } catch {
      /* storage unavailable */
    }
    this.chatTabs = parseChatTabs(savedTabs);
    this.activeChatTab =
      savedActive === 'all' ||
      savedActive === 'combat' ||
      (isChatTabChannel(savedActive) && this.chatTabs.includes(savedActive))
        ? (savedActive as ChatTabId)
        : 'all';
    // re-join any opt-in global channels whose tabs were restored, so messages
    // typed there are delivered this session too
    for (const ch of this.chatTabs) if (channelNeedsJoin(ch)) this.sim.chat(`/join ${ch}`);
    this.renderChatTabs();
    this.selectChatTab(this.activeChatTab, false);
  }

  private persistChatTabs(): void {
    try {
      localStorage.setItem(CHAT_TABS_KEY, serializeChatTabs(this.chatTabs));
      localStorage.setItem(CHAT_ACTIVE_TAB_KEY, this.activeChatTab);
    } catch {
      /* storage unavailable */
    }
  }

  // -------------------------------------------------------------------------
  // Movable / resizable chat window (desktop only). The pure geometry math
  // (clamping, (de)serialization) lives in chat_window.ts; this section is just
  // the DOM wiring: a drag handle on the tab strip, a corner resize grip, and
  // localStorage persistence with a reset path back to the CSS default.
  // -------------------------------------------------------------------------

  private isMobileLayout(): boolean {
    return document.body.classList.contains('mobile-touch');
  }

  private initChatBoxGeometry(): void {
    const wrap = document.getElementById('chatlog-wrap');
    const tabs = document.getElementById('chatlog-tabs');
    const frame = document.getElementById('chatlog-frame');
    if (!wrap || !tabs || !frame) return;

    // Resize grip pinned to the frame's bottom-right corner.
    const grip = document.createElement('div');
    grip.className = 'chat-resize-grip';
    grip.title = t('hudChrome.chatWindow.resize');
    grip.setAttribute('aria-hidden', 'true');
    frame.appendChild(grip);

    tabs.style.touchAction = 'none';
    tabs.setAttribute('aria-label', t('hudChrome.chatWindow.move'));
    tabs.addEventListener('pointerdown', (ev) => this.onChatBoxMoveStart(ev, wrap, tabs));
    grip.addEventListener('pointerdown', (ev) => this.onChatBoxResizeStart(ev, wrap, frame));
    document.addEventListener('pointermove', (ev) => this.onChatBoxPointerMove(ev));
    const end = (ev: PointerEvent) => this.onChatBoxPointerEnd(ev);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
    // Re-clamp into view when the viewport changes (mirrors the .window.panel logic).
    window.addEventListener('resize', () => {
      if (this.chatBox) this.applyChatBoxGeometry();
    });

    let saved: string | null = null;
    try {
      saved = localStorage.getItem(CHAT_GEOMETRY_KEY);
    } catch {
      /* storage unavailable */
    }
    this.chatBox = parseChatBox(saved);
    if (this.chatBox) this.applyChatBoxGeometry();
  }

  // Seed this.chatBox from the live layout the first time a gesture starts, so a
  // box still on its CSS default converts cleanly to explicit px coordinates.
  private ensureChatBoxGeometry(wrap: HTMLElement, tabs: HTMLElement): void {
    if (this.chatBox) return;
    const wrapRect = wrap.getBoundingClientRect();
    const frameRect = document.getElementById('chatlog-frame')?.getBoundingClientRect();
    const chromeH = tabs.getBoundingClientRect().height;
    this.chatBox = {
      left: wrapRect.left,
      top: wrapRect.top,
      width: wrapRect.width,
      height: frameRect ? frameRect.height : Math.max(0, wrapRect.height - chromeH),
    };
  }

  private onChatBoxMoveStart(ev: PointerEvent, wrap: HTMLElement, tabs: HTMLElement): void {
    if (ev.button !== 0 || this.isMobileLayout()) return;
    const target = ev.target as HTMLElement | null;
    // Tab buttons (select / add / close) keep their own click behaviour; only the
    // empty strip area initiates a move.
    if (!target || target.closest('button')) return;
    ev.preventDefault();
    this.ensureChatBoxGeometry(wrap, tabs);
    const rect = wrap.getBoundingClientRect();
    this.chatBoxGesture = {
      kind: 'move',
      pointerId: ev.pointerId,
      grabX: ev.clientX - rect.left,
      grabY: ev.clientY - rect.top,
    };
    document.body.classList.add('chat-box-dragging');
    try {
      tabs.setPointerCapture?.(ev.pointerId);
    } catch {
      /* synthetic pointer */
    }
  }

  private onChatBoxResizeStart(ev: PointerEvent, wrap: HTMLElement, frame: HTMLElement): void {
    if (ev.button !== 0 || this.isMobileLayout()) return;
    ev.preventDefault();
    ev.stopPropagation();
    const tabs = document.getElementById('chatlog-tabs');
    if (tabs) this.ensureChatBoxGeometry(wrap, tabs);
    if (!this.chatBox) return;
    this.chatBoxGesture = {
      kind: 'resize',
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      startW: this.chatBox.width,
      startH: this.chatBox.height,
    };
    document.body.classList.add('chat-box-dragging');
    try {
      frame.setPointerCapture?.(ev.pointerId);
    } catch {
      /* synthetic pointer */
    }
  }

  private onChatBoxPointerMove(ev: PointerEvent): void {
    const g = this.chatBoxGesture;
    if (!g || g.pointerId !== ev.pointerId || !this.chatBox) return;
    ev.preventDefault();
    if (g.kind === 'move') {
      this.chatBox = { ...this.chatBox, left: ev.clientX - g.grabX, top: ev.clientY - g.grabY };
    } else {
      this.chatBox = {
        ...this.chatBox,
        width: g.startW + (ev.clientX - g.startX),
        height: g.startH + (ev.clientY - g.startY),
      };
    }
    this.applyChatBoxGeometry();
  }

  private onChatBoxPointerEnd(ev: PointerEvent): void {
    const g = this.chatBoxGesture;
    if (!g || g.pointerId !== ev.pointerId) return;
    this.chatBoxGesture = null;
    document.body.classList.remove('chat-box-dragging');
    this.persistChatBoxGeometry();
  }

  private applyChatBoxGeometry(): void {
    if (!this.chatBox || this.isMobileLayout()) return;
    const wrap = document.getElementById('chatlog-wrap');
    const tabs = document.getElementById('chatlog-tabs');
    const frame = document.getElementById('chatlog-frame');
    if (!wrap || !tabs || !frame) return;
    const chromeH = tabs.getBoundingClientRect().height || 22;
    const clamped = clampChatBox(
      this.chatBox,
      { w: window.innerWidth, h: window.innerHeight },
      chromeH,
    );
    this.chatBox = clamped;
    wrap.style.left = `${clamped.left}px`;
    wrap.style.top = `${clamped.top}px`;
    wrap.style.right = 'auto';
    wrap.style.bottom = 'auto';
    wrap.style.width = `${clamped.width}px`;
    frame.style.height = `${clamped.height}px`;
    // Keep the (separately positioned) chat input bar aligned above the box.
    const input = document.getElementById('chat-input');
    if (input) {
      input.style.left = `${clamped.left}px`;
      input.style.width = `${clamped.width}px`;
      input.style.bottom = `${Math.max(0, window.innerHeight - clamped.top + 4)}px`;
    }
  }

  private persistChatBoxGeometry(): void {
    if (!this.chatBox) return;
    try {
      localStorage.setItem(CHAT_GEOMETRY_KEY, serializeChatBox(this.chatBox));
    } catch {
      /* storage unavailable */
    }
  }

  // Public: snap the chat window back to its stock CSS position/size and forget
  // the saved geometry. Wired to the "Reset Chat Window" interface option.
  resetChatWindow(): void {
    this.chatBox = null;
    try {
      localStorage.removeItem(CHAT_GEOMETRY_KEY);
    } catch {
      /* storage unavailable */
    }
    const ids = ['chatlog-wrap', 'chatlog-frame', 'chat-input'];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      for (const prop of ['left', 'top', 'right', 'bottom', 'width', 'height'])
        el.style.removeProperty(prop);
    }
  }

  private renderChatTabs(): void {
    const bar = $('#chatlog-tabs');
    bar.innerHTML = '';
    bar.setAttribute('role', 'tablist');
    const makeTab = (id: ChatTabId, label: string): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chat-tab';
      btn.dataset.tab = id;
      btn.setAttribute('role', 'tab');
      btn.textContent = label;
      btn.addEventListener('click', () => this.selectChatTab(id, true));
      return btn;
    };
    bar.append(
      makeTab('all', t('hud.core.chatTab')),
      makeTab('combat', t('hud.core.combatLogTab')),
    );
    for (const ch of this.chatTabs) {
      const label = t(CHANNEL_LABEL_KEYS[ch]);
      const btn = makeTab(ch, label);
      btn.title = t('hud.core.chatChannels.close', { channel: label });
      // right-click / long-press a channel tab to close it (the + menu also toggles)
      btn.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        this.removeChatTab(ch);
      });
      bar.append(btn);
    }
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'chat-tab chat-tab-add';
    add.textContent = '+';
    add.setAttribute('aria-label', t('hud.core.chatChannels.add'));
    add.title = t('hud.core.chatChannels.add');
    add.addEventListener('click', () => {
      const r = add.getBoundingClientRect();
      this.openChatChannelMenu(r.left, r.bottom);
    });
    bar.append(add);
    this.updateActiveTabStyles();
  }

  private updateActiveTabStyles(): void {
    $('#chatlog-tabs')
      .querySelectorAll<HTMLButtonElement>('.chat-tab')
      .forEach((btn) => {
        if (btn.classList.contains('chat-tab-add')) return;
        const active = btn.dataset.tab === this.activeChatTab;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
        btn.tabIndex = active ? 0 : -1;
      });
  }

  private selectChatTab(tab: ChatTabId, persist = true): void {
    this.activeChatTab = tab;
    const showCombat = tab === 'combat';
    this.chatLogEl.classList.toggle('active', !showCombat);
    this.combatLogEl.classList.toggle('active', showCombat);
    if (!showCombat) this.applyChatFilter();
    this.updateActiveTabStyles();
    if (persist) this.persistChatTabs();
    this.syncChatPlaceholder();
  }

  // Add a channel tab if not already present. Does NOT switch the active send
  // channel — the player stays on their current tab (All/Say is the catch-all
  // home that shows every channel and sends Say), so opening a channel never
  // hijacks where typed text goes. `join` auto-joins opt-in global channels;
  // skip it when the caller already sent the /join (e.g. a typed command).
  // `select` focuses the new tab — reserved for a deliberate tab click.
  private addChatTab(
    channel: ChatTabChannel,
    opts: { join?: boolean; select?: boolean } = {},
  ): void {
    const { join = true, select = false } = opts;
    if (!this.chatTabs.includes(channel)) {
      this.chatTabs.push(channel);
      if (join && channelNeedsJoin(channel)) this.sim.chat(`/join ${channel}`);
      this.renderChatTabs();
      this.persistChatTabs();
    }
    if (select) this.selectChatTab(channel, true);
  }

  // Mirror a typed "/join|/leave <world|lfg>" into the tab bar so the command
  // line and the "+" menu stay in sync: /join opens the channel's tab and
  // /leave closes it. We never re-issue the command — main.ts already sent it,
  // and creating the tab leaves the active send channel untouched.
  syncChatTabsForInput(typed: string): void {
    const m = /^\/(join|leave)\b\s*(\S*)/i.exec(typed.trim());
    if (!m) return;
    const channel = m[2].toLowerCase();
    if (!isChatTabChannel(channel) || !channelNeedsJoin(channel)) return;
    if (m[1].toLowerCase() === 'join') this.addChatTab(channel, { join: false });
    else if (this.chatTabs.includes(channel)) this.removeChatTab(channel);
  }

  private removeChatTab(channel: ChatTabChannel): void {
    const i = this.chatTabs.indexOf(channel);
    if (i < 0) return;
    this.chatTabs.splice(i, 1);
    // closing a tab does not /leave the channel (you stay subscribed, as in WoW)
    if (this.activeChatTab === channel) this.activeChatTab = 'all';
    this.renderChatTabs();
    this.selectChatTab(this.activeChatTab, true);
  }

  // The "+" menu: a toggle list of every bindable channel. Open channels show a
  // check and toggle off; the rest add a tab. Reuses the shared #ctx-menu, so
  // it inherits its outside-click / Escape close behaviour.
  private openChatChannelMenu(x: number, y: number): void {
    const el = $('#ctx-menu');
    let html = `<div class="ctx-title">${esc(t('hud.core.chatChannels.addTitle'))}</div>`;
    for (const ch of CHAT_TAB_CHANNELS) {
      const open = this.chatTabs.includes(ch);
      html += `<div class="ctx-item" data-act="${ch}">${esc(t(CHANNEL_LABEL_KEYS[ch]))}${open ? ' ✓' : ''}</div>`;
    }
    html += `<div class="ctx-item" data-act="close">${esc(t('hud.chat.context.cancel'))}</div>`;
    el.innerHTML = html;
    this.placePopupAt(el, x, y, 170, 320, 0, 8);
    el.style.display = 'block';
    this.bindContextMenuActions((act) => {
      if (!isChatTabChannel(act)) return;
      if (this.chatTabs.includes(act)) this.removeChatTab(act);
      else this.addChatTab(act);
    });
  }

  // null when the all/combat views are active (no filter, no send prefix);
  // otherwise the channel the active tab is bound to.
  private chatFilterChannel(): ChatTabChannel | null {
    return this.activeChatTab === 'all' || this.activeChatTab === 'combat'
      ? null
      : this.activeChatTab;
  }

  private applyChatFilter(): void {
    const filter = this.chatFilterChannel();
    for (const child of Array.from(this.chatLogEl.children)) {
      const chan = (child as HTMLElement).dataset.chan;
      (child as HTMLElement).classList.toggle('chat-hidden', filter !== null && chan !== filter);
    }
    this.chatLogEl.scrollTop = this.chatLogEl.scrollHeight;
  }

  private hideIfFiltered(div: HTMLElement, chan: string): void {
    const filter = this.chatFilterChannel();
    if (filter !== null && chan !== filter) div.classList.add('chat-hidden');
  }

  private syncChatPlaceholder(): void {
    const input = document.getElementById('chat-input') as HTMLTextAreaElement | null;
    if (input) input.placeholder = this.activeChatPlaceholder();
  }

  // The line actually sent for what the player typed, honoring the active
  // channel tab. main.ts calls this on Enter so a channel tab works without
  // retyping the slash command; an explicit "/..." the player typed still wins.
  composeChatSend(typed: string): string {
    const withLinks = this.applyPendingQuestLinks(typed);
    const ch = this.chatFilterChannel();
    return ch ? composeChatLine(ch, withLinks) : withLinks.trim();
  }

  // Shift-click a quest-log entry: open the chat input and insert a readable
  // [Name] link. composeChatSend swaps it for the canonical [[q:id]] token on send.
  insertQuestChatLink(questId: string): void {
    const input = $('#chat-input') as unknown as HTMLInputElement;
    const display = `[${questTitle(questId)}]`;
    this.pendingChatLinks.set(display, questId);
    input.placeholder = this.activeChatPlaceholder();
    input.style.display = 'block';
    input.value =
      input.value && !input.value.endsWith(' ')
        ? `${input.value} ${display}`
        : `${input.value}${display}`;
    input.focus();
  }

  // Drop any shift-click-inserted links that were never sent (chat closed/cleared),
  // so a stale [Name] entry can't silently rewrite a later message.
  clearPendingQuestLinks(): void {
    this.pendingChatLinks.clear();
  }

  // Replace any inserted readable [Name] with its [[q:id]] token, then forget them.
  private applyPendingQuestLinks(typed: string): string {
    if (this.pendingChatLinks.size === 0) return typed;
    let out = typed;
    for (const [display, questId] of this.pendingChatLinks)
      out = out.split(display).join(encodeQuestLink(questId));
    this.pendingChatLinks.clear();
    return out;
  }

  // Intercept "/share": link the selected quest into party chat. Returns true when
  // handled (the caller then skips normal send). Not-in-a-party is left to the sim's
  // existing "You are not in a party." error from the /p path.
  maybeHandleQuestShareCommand(raw: string): boolean {
    if (!/^\/share(?:\s|$)/i.test(raw.trim())) return false;
    const id = this.selectedQuestLogId;
    if (!id || !this.sim.questLog.has(id)) {
      this.showError(t('hudChrome.questShare.noQuestSelected'));
      return true;
    }
    this.sim.chat(`/p ${encodeQuestLink(id)}`);
    return true;
  }

  // Placeholder for the chat input reflecting the active channel tab.
  activeChatPlaceholder(): string {
    const ch = this.chatFilterChannel();
    return ch
      ? t('hud.core.chatChannels.sendingTo', { channel: t(CHANNEL_LABEL_KEYS[ch]) })
      : t('hud.core.chatPlaceholder');
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
    try {
      raw = JSON.parse(localStorage.getItem(this.emoteWheelKey()) ?? 'null');
    } catch {
      /* corrupt */
    }
    const ids = Array.isArray(raw) ? raw.filter(isOverheadEmoteId) : [];
    const deduped = ids.filter((id, i) => ids.indexOf(id) === i).slice(0, EMOTE_WHEEL_LIMIT);
    let migrated = false;
    try {
      migrated = localStorage.getItem(this.emoteWheelVersionKey()) === '1';
    } catch {
      /* storage unavailable */
    }
    if (deduped.length > 0 && !migrated && !deduped.includes('question')) {
      deduped.splice(2, 0, 'question');
      deduped.length = Math.min(deduped.length, EMOTE_WHEEL_LIMIT);
      try {
        localStorage.setItem(this.emoteWheelKey(), JSON.stringify(deduped));
        localStorage.setItem(this.emoteWheelVersionKey(), '1');
      } catch {
        /* storage unavailable */
      }
    }
    return deduped.length > 0 ? deduped : [...DEFAULT_EMOTE_WHEEL];
  }

  private saveEmoteWheelSlots(): void {
    try {
      localStorage.setItem(this.emoteWheelKey(), JSON.stringify(this.emoteWheelSlots));
      localStorage.setItem(this.emoteWheelVersionKey(), '1');
    } catch {
      /* storage unavailable */
    }
  }

  private emoteLabel(id: OverheadEmoteId): string {
    return t(`hudChrome.emotes.${id}` as TranslationKey);
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
    el.innerHTML = `<div class="emote-wheel-ring"></div><button class="emote-wheel-edit" data-edit>${esc(t('hudChrome.emoteWheel.edit'))}</button>`;
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
      const idx =
        Math.round((angle / (Math.PI * 2)) * this.emoteWheelSlots.length) %
        this.emoteWheelSlots.length;
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
    el.innerHTML = `<div class="panel-title"><span>${esc(t('hudChrome.emoteEditor.title'))}</span><span class="x-btn" data-close>${svgIcon('close')}</span></div>`;
    const count = document.createElement('div');
    count.className = 'emote-editor-count';
    const grid = document.createElement('div');
    grid.className = 'emote-editor-grid';
    const selected = new Set(this.emoteWheelSlots);
    const syncCount = () => {
      count.textContent = `${selected.size}/${EMOTE_WHEEL_LIMIT}`;
    };
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
      label.textContent = this.emoteLabel(def.id);
      btn.append(icon, label);
      btn.addEventListener('click', () => {
        audio.click();
        if (selected.has(def.id)) selected.delete(def.id);
        else if (selected.size < EMOTE_WHEEL_LIMIT) selected.add(def.id);
        this.emoteWheelSlots = OVERHEAD_EMOTES.map((e) => e.id).filter(
          (id): id is OverheadEmoteId => selected.has(id),
        );
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
    done.textContent = t('hudChrome.emoteEditor.done');
    done.addEventListener('click', () => this.closeEmoteEditor());
    footer.append(count, done);
    el.append(grid, footer);
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeEmoteEditor());
  }

  // -------------------------------------------------------------------------
  // Portraits, icons, tooltips, money
  // -------------------------------------------------------------------------

  // Player- and target-frame circular portraits. The DPI-aware backing store +
  // crest overscan live in UnitPortraitPainter (unit_portrait_painter.ts); the
  // HUD just routes the framed unit (class headshot vs mob/NPC crest) to it.
  private readonly portraits = new UnitPortraitPainter();

  private drawPlayerFramePortrait(): void {
    this.portraits.drawClass(
      $('#pf-portrait') as unknown as HTMLCanvasElement,
      this.sim.cfg.playerClass,
      this.sim.player.skin ?? 0,
    );
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

  // The connected wallet's $WOC balance, shown left of the coins in the bag.
  // Unlinked balances are a local preview; verified balances belong to the
  // account-linked wallet and may drive public holder claims elsewhere.
  private wocBalanceHtml(): string {
    if (!walletUiEnabled()) return '';
    const bal = wocBalance();
    if (bal === null) return '';
    const amount = formatNumber(bal, { maximumFractionDigits: 2 });
    const balance = t('wallet.balanceAmount', { amount });
    const verified = wocBalanceVerified();
    const title = verified ? t('wallet.balanceTitle') : t('wallet.balancePreviewTitle');
    const aria = verified
      ? t('wallet.balanceAria', { balance })
      : t('wallet.balancePreviewAria', { balance });
    return `<span class="woc-balance ${verified ? 'is-verified' : 'is-preview'}" title="${esc(title)}" aria-label="${esc(aria)}"><span class="woc-coin" aria-hidden="true"></span>${esc(balance)}</span>`;
  }

  attachTooltip(el: HTMLElement, html: () => string): void {
    let touchTimer: number | undefined;
    const mobile = () => document.body.classList.contains('mobile-touch');
    const clearTouchTimer = () => {
      if (touchTimer !== undefined) window.clearTimeout(touchTimer);
      touchTimer = undefined;
    };
    const showAt = (x: number, y: number, trigger: 'touch' | 'mouse' | 'focus') => {
      if (this.mobileHotbarDrag?.active) return;
      // Touch-only path: showing the tooltip means the held control is being
      // inspected, so the release click should peek, not fire its action.
      this.peekGuard.tooltipShown(trigger);
      this.tooltipEl.innerHTML = html();
      this.tooltipEl.style.display = 'block';
      // offsetWidth/Height are author-space (zoom-immune) layout sizes, but x/y
      // arrive in visual (zoomed) space, so map x/y into author space (÷ scale)
      // before clamping against the author-space tooltip box + viewport.
      const z = getUiScale();
      const tw = this.tooltipEl.offsetWidth,
        th = this.tooltipEl.offsetHeight;
      this.tooltipEl.style.left = `${Math.max(8, Math.min(window.innerWidth / z - tw - 8, x / z + 14))}px`;
      this.tooltipEl.style.top = `${Math.max(8, y / z - th - 10)}px`;
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
      const z = getUiScale();
      const tw = this.tooltipEl.offsetWidth,
        th = this.tooltipEl.offsetHeight;
      this.tooltipEl.style.left = `${Math.min(window.innerWidth / z - tw - 8, e.clientX / z + 14)}px`;
      this.tooltipEl.style.top = `${Math.max(8, e.clientY / z - th - 10)}px`;
    });
    el.addEventListener('mouseleave', () => {
      clearTouchTimer();
      this.tooltipEl.style.display = 'none';
    });
    el.addEventListener('focusin', showNearElement);
    el.addEventListener('focusout', () => {
      clearTouchTimer();
      this.tooltipEl.style.display = 'none';
    });
    el.addEventListener('pointerdown', (e) => {
      if (!mobile() || e.pointerType === 'mouse') return;
      clearTouchTimer();
      // A fresh press: drop any stale peek and dismiss a lingering tooltip.
      this.peekGuard.press();
      this.tooltipEl.style.display = 'none';
      const x = e.clientX,
        y = e.clientY;
      touchTimer = window.setTimeout(() => showAt(x, y, 'touch'), TOOLTIP_PEEK_MS);
    });
    el.addEventListener('pointerup', clearTouchTimer);
    el.addEventListener('pointercancel', clearTouchTimer);
  }

  hideTooltip(): void {
    this.tooltipEl.style.display = 'none';
  }

  private itemTooltip(item: ItemDef, compare = true): string {
    const qColor = QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff';
    let html = `<div class="tt-title" style="color:${qColor}">${esc(itemDisplayName(item))}</div>`;
    html += `<div class="tt-sub">${esc(
      t('itemUi.tooltip.qualityKind', {
        quality: itemQualityLabel(item.quality),
        kind: itemKindLabel(item.kind),
      }),
    )}</div>`;
    if (item.slot) {
      html += `<div class="tt-sub">${esc(itemSlotName(item.slot))}</div>`;
    }
    if (item.weapon) {
      const dps = (item.weapon.min + item.weapon.max) / 2 / item.weapon.speed;
      html += `<div class="tt-stat">${esc(
        t('itemUi.tooltip.damageSpeed', {
          min: itemNumber(item.weapon.min),
          max: itemNumber(item.weapon.max),
          speed: itemNumber(item.weapon.speed, 1),
        }),
      )}</div>`;
      html += `<div class="tt-stat">${esc(t('itemUi.tooltip.dps', { dps: itemNumber(dps, 1) }))}</div>`;
      if (item.weapon.dagger)
        html += `<div class="tt-sub">${esc(t('itemUi.tooltip.dagger'))}</div>`;
    }
    if (item.stats) {
      for (const [k, v] of Object.entries(item.stats)) {
        if (v === undefined) continue;
        if (k === 'armor') {
          html += `<div class="tt-stat">${esc(t('itemUi.tooltip.armorStat', { value: itemNumber(v) }))}</div>`;
        } else {
          html += `<div class="tt-green">${esc(
            t('itemUi.tooltip.stat', {
              value: itemNumber(v),
              stat: itemStatName(k),
            }),
          )}</div>`;
        }
      }
    }
    if (item.foodHp)
      html += `<div class="tt-desc">${esc(t('itemUi.tooltip.useFood', { amount: itemNumber(item.foodHp), seconds: itemNumber(CONSUME_DURATION) }))}</div>`;
    if (item.drinkMana)
      html += `<div class="tt-desc">${esc(t('itemUi.tooltip.useDrink', { amount: itemNumber(item.drinkMana), seconds: itemNumber(CONSUME_DURATION) }))}</div>`;
    if (item.use?.type === 'fishing')
      html += `<div class="tt-desc">${esc(t('itemUi.tooltip.useFishing'))}</div>`;
    if (item.potionHp)
      html += `<div class="tt-desc">${esc(t('itemUi.tooltip.useHealingPotion', { amount: itemNumber(item.potionHp) }))}</div>`;
    if (item.potionMana)
      html += `<div class="tt-desc">${esc(t('itemUi.tooltip.useManaPotion', { amount: itemNumber(item.potionMana) }))}</div>`;
    if (item.kind === 'quest')
      html += `<div class="tt-desc">${esc(t('itemUi.tooltip.questItem'))}</div>`;
    if (item.requiredClass && !armorTypeForItem(item) && !weaponArchetypeForItem(item)) {
      html += `<div class="tt-sub">${esc(t('itemUi.tooltip.classes', { classes: item.requiredClass.map(classDisplayName).join(', ') }))}</div>`;
    }
    if (item.sellValue > 0)
      html += `<div class="tt-sub">${esc(t('itemUi.tooltip.sellPrice', { money: formatLocalizedMoney(item.sellValue) }))}</div>`;
    if (compare) html += this.itemCompareBlock(item);
    return html;
  }

  // Classic-WoW item comparison: when hovering an equippable item, append the
  // item currently worn in that slot plus the stat change you'd see if you
  // swapped to it (green = gain, red = loss). Reads IWorld.equipment, so it
  // works identically offline and online.
  private itemCompareBlock(item: ItemDef): string {
    if (!item.slot) return '';
    const equippedId = this.sim.equipment[item.slot];
    if (!equippedId || equippedId === item.id) return '';
    const equipped = ITEMS[equippedId];
    if (!equipped) return '';
    const deltas = itemStatDeltas(item, equipped)
      .map((d) => {
        const cls = d.delta > 0 ? 'tt-green' : 'tt-red';
        const sign = d.delta > 0 ? '+' : '−'; // proper minus sign
        const magnitude = formatNumber(Math.abs(d.delta), {
          minimumFractionDigits: d.decimals,
          maximumFractionDigits: d.decimals,
        });
        return `<div class="${cls}">${sign}${magnitude} ${esc(t(`itemUi.stats.${d.stat}` as TranslationKey))}</div>`;
      })
      .join('');
    let html = `<div class="tt-cmp"><div class="tt-cmp-head">${esc(t('itemUi.tooltip.currentlyEquipped'))}</div>`;
    html += `<div class="tt-cmp-body">${this.itemTooltip(equipped, false)}</div>`;
    if (deltas)
      html += `<div class="tt-cmp-head">${esc(t('itemUi.tooltip.ifYouEquip'))}</div>${deltas}`;
    html += `</div>`;
    return html;
  }

  // Build the pure stat-breakdown model for the currently-shown player, the bridge
  // from the live sim to the host-agnostic stat_tooltip core. The HTML + aria
  // rendering lives in the unit-tested stat_tooltip_view module; this only feeds
  // it the current numbers, so the visual tooltip and the screen-reader text read
  // identical, live values.
  private statModel(stat: StatId): StatTooltipModel {
    const sim = this.sim;
    const p = sim.player;
    const wpn = sim.equipment.mainhand ? ITEMS[sim.equipment.mainhand] : null;
    return buildStatTooltip(stat, {
      cls: sim.cfg.playerClass,
      stats: p.stats,
      level: p.level,
      attackPower: p.attackPower,
      critChance: p.critChance,
      dodgeChance: p.dodgeChance,
      dps: weaponDps(wpn?.weapon, p.attackPower),
    });
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
    return active instanceof HTMLElement &&
      active !== document.body &&
      this.canRestoreFocusTo(active)
      ? active
      : null;
  }

  private restoreFocus(target: HTMLElement | null, fallback?: HTMLElement | null): void {
    const candidate = this.canRestoreFocusTo(target)
      ? target
      : this.canRestoreFocusTo(fallback ?? null)
        ? fallback!
        : null;
    if (!candidate) return;
    window.setTimeout(() => candidate.focus(), 0);
  }

  private focusFirstInteractive(root: HTMLElement, preferredSelector?: string): void {
    window.setTimeout(() => {
      const target =
        (preferredSelector ? root.querySelector<HTMLElement>(preferredSelector) : null) ??
        root.querySelector<HTMLElement>(
          'button:not([disabled]):not([data-close]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
      (target ?? root).focus();
    }, 0);
  }

  private refreshLocalizedDynamicUi(): void {
    this.refreshKeybindLabels();
    this.updateQuestTracker();
    this.updateDelveTracker();
    const log = $('#quest-log-window');
    if (log.style.display === 'block') this.renderQuestLog();
    if ($('#bags').style.display === 'block') this.renderBags();
    if (this.openVendorNpcId !== null && $('#vendor-window').style.display === 'block')
      this.renderVendor();
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
      costLine.push(
        t('abilityUi.tooltip.cost', {
          cost: formatAbilityNumber(res.cost),
          resource: resourceDisplayName(this.sim.player.resourceType),
        }),
      );
    }
    const rangeLine = abilityRangeLine(a);
    if (rangeLine) costLine.push(rangeLine);
    if (costLine.length) html += `<div class="tt-stat">${costLine.map(esc).join(' &nbsp; ')}</div>`;
    const castLine = [abilityCastLine(res)];
    if (a.cooldown > 0)
      castLine.push(
        t('abilityUi.tooltip.cooldownSeconds', { seconds: formatAbilityNumber(a.cooldown) }),
      );
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
  private slotMapKey(form: HotbarForm = this.activeHotbarForm): string {
    const base = `woc_hotbar_${this.sim.cfg.playerClass}_${this.sim.player.name}`;
    return form === 'normal' ? base : `${base}_${form}`;
  }

  private playerHotbarForm(): HotbarForm {
    if (this.sim.cfg.playerClass === 'druid') {
      if (this.sim.player.auras.some((a) => a.kind === 'form_bear')) return 'bear';
      if (this.sim.player.auras.some((a) => a.kind === 'form_cat')) return 'cat';
    }
    if (
      this.sim.cfg.playerClass === 'rogue' &&
      this.sim.player.auras.some((a) => a.kind === 'stealth')
    )
      return 'stealth';
    return 'normal';
  }

  private isHotbarItemId(itemId: string): boolean {
    const item = ITEMS[itemId];
    return (
      item?.kind === 'food' ||
      item?.kind === 'drink' ||
      item?.kind === 'potion' ||
      item?.use?.type === 'fishing'
    );
  }

  // Whether an ability belongs on a given form's default bar. Bear/cat bars hold
  // only that form's kit (its `requiresForm` abilities) plus the shift toggles;
  // the caster ('normal') bar excludes form-only abilities so they no longer
  // auto-dump onto it. Rogue stealth has no `requiresForm` kit, so it keeps the
  // full caster set.
  private shouldAutoPlaceOnForm(id: string, form: HotbarForm): boolean {
    if (form === 'bear' || form === 'cat') {
      return ABILITIES[id]?.requiresForm === form || Hud.FORM_TOGGLE_IDS.has(id);
    }
    return !ABILITIES[id]?.requiresForm;
  }

  // The known abilities that make up a form's default bar, in class/learn order.
  private formKitAbilityIds(form: HotbarForm): string[] {
    return this.sim.known.map((k) => k.def.id).filter((id) => this.shouldAutoPlaceOnForm(id, form));
  }

  // True for the druid form bars that own a dedicated kit (bear/cat). Rogue
  // stealth is excluded: the sim does not lock the caster kit in stealth, so its
  // bar legitimately mirrors the normal layout.
  private isFormKitBar(form: HotbarForm = this.activeHotbarForm): boolean {
    return this.sim.cfg.playerClass === 'druid' && (form === 'bear' || form === 'cat');
  }

  // Gates form-bar-only UI (e.g. the spellbook "Reset bar" button) so it never
  // shows for single-bar classes. Delegates to the pure, unit-tested helper.
  private classHasFormBars(): boolean {
    return classHasFormBars(this.sim.cfg.playerClass);
  }

  // Per-form one-time marker so the migration of pre-existing form bars (empty or
  // a clone of the caster bar) runs at most once and never clobbers a layout the
  // player deliberately customized. Mirrors the emote-wheel version marker.
  private formBarSeededKey(form: HotbarForm = this.activeHotbarForm): string {
    return `${this.slotMapKey(form)}_seeded`;
  }

  private markFormBarSeeded(form: HotbarForm = this.activeHotbarForm): void {
    try {
      localStorage.setItem(this.formBarSeededKey(form), '1');
    } catch {
      /* storage unavailable */
    }
  }

  // Seed/migrate a druid bear/cat bar to its form kit. Returns true if it took
  // ownership of `hotbarActions`. Runs at most once per form (guarded by the
  // marker): on first encounter it seeds an empty bar or migrates a bar that is a
  // byte-identical clone of the caster bar, but leaves a customized bar untouched.
  private seedFormBarIfNeeded(parsed: HotbarAction[]): boolean {
    let alreadySeeded = false;
    try {
      alreadySeeded = localStorage.getItem(this.formBarSeededKey()) === '1';
    } catch {
      /* storage unavailable */
    }
    if (alreadySeeded) return false;

    let normalRaw: unknown = null;
    try {
      normalRaw = JSON.parse(localStorage.getItem(this.slotMapKey('normal')) ?? 'null');
    } catch {
      /* corrupt */
    }
    const normalActions = parseHotbarActions(
      normalRaw,
      Hud.BAR_ABILITY_SLOTS,
      (id) => !!ABILITIES[id],
      (id) => this.isHotbarItemId(id),
    );

    // Mark before deciding so a deliberately customized bar is left untouched and
    // this migration is never re-evaluated for the form.
    this.markFormBarSeeded();
    if (!shouldSeedFormBar(parsed, normalActions, false)) return false;

    this.hotbarActions = buildDefaultFormBar(
      this.formKitAbilityIds(this.activeHotbarForm),
      Hud.BAR_ABILITY_SLOTS,
    );
    this.loadedSlotMapFromStorage = true;
    this.knownAbilityIdsAtLastSlotSync = null;
    this.saveSlotMap();
    return true;
  }

  private loadSlotMap(): void {
    let arr: unknown = null;
    let stored = false;
    try {
      const raw = localStorage.getItem(this.slotMapKey());
      stored = raw !== null;
      arr = JSON.parse(raw ?? 'null');
    } catch {
      /* corrupt */
    }
    const parsed = parseHotbarActions(
      arr,
      Hud.BAR_ABILITY_SLOTS,
      (id) => !!ABILITIES[id],
      (id) => this.isHotbarItemId(id),
    );
    // Druid bear/cat bars auto-populate with that form's kit instead of cloning
    // the caster bar; existing characters are migrated once (see seedFormBarIfNeeded).
    if (this.isFormKitBar()) {
      if (this.seedFormBarIfNeeded(parsed)) return;
      this.loadedSlotMapFromStorage = stored;
      this.hotbarActions = parsed;
      this.knownAbilityIdsAtLastSlotSync = null;
      return;
    }
    const emptyFormMap =
      this.activeHotbarForm !== 'normal' && parsed.every((action) => action === null);
    if (emptyFormMap) {
      let fallback: unknown = null;
      try {
        fallback = JSON.parse(localStorage.getItem(this.slotMapKey('normal')) ?? 'null');
      } catch {
        /* corrupt */
      }
      const normalActions = parseHotbarActions(
        fallback,
        Hud.BAR_ABILITY_SLOTS,
        (id) => !!ABILITIES[id],
        (id) => this.isHotbarItemId(id),
      );
      if (normalActions.some((action) => action !== null)) {
        this.loadedSlotMapFromStorage = true;
        this.hotbarActions = normalActions;
        this.knownAbilityIdsAtLastSlotSync = null;
        return;
      }
    }
    this.loadedSlotMapFromStorage = stored;
    this.hotbarActions = parsed;
    this.knownAbilityIdsAtLastSlotSync = null;
  }

  private saveSlotMap(): void {
    try {
      localStorage.setItem(this.slotMapKey(), JSON.stringify(this.hotbarActions));
    } catch {
      /* storage unavailable */
    }
  }

  private firstEmptyHotbarIndex(): number {
    return this.hotbarActions.indexOf(null);
  }

  private hotbarIndexForAbility(abilityId: string): number {
    return this.hotbarActions.findIndex(
      (action) => action?.type === 'ability' && action.id === abilityId,
    );
  }

  private addAbilityToHotbar(abilityId: string): boolean {
    if (this.hotbarIndexForAbility(abilityId) !== -1) return false;
    const target = this.firstEmptyHotbarIndex();
    if (target === -1) return false;
    this.hotbarActions = placeAbilityOnSlot(this.hotbarActions, abilityId, target);
    this.saveSlotMap();
    return true;
  }

  private removeAbilityFromHotbar(abilityId: string): boolean {
    const target = this.hotbarIndexForAbility(abilityId);
    if (target === -1) return false;
    this.hotbarActions = clearHotbarSlot(this.hotbarActions, target);
    this.saveSlotMap();
    return true;
  }

  private refreshSpellbookHotbarControls(): void {
    document
      .querySelectorAll<HTMLButtonElement>('#spellbook .spell-hotbar-toggle')
      .forEach((btn) => {
        const id = btn.dataset.abilityId;
        if (!id) return;
        const onBar = this.hotbarIndexForAbility(id) !== -1;
        btn.textContent = onBar ? '-' : '+';
        btn.classList.toggle('remove', onBar);
        btn.setAttribute('aria-pressed', onBar ? 'true' : 'false');
        btn.disabled = !onBar && this.firstEmptyHotbarIndex() === -1;
      });
  }

  // Rebuild the active bar from its default kit (form bars get their form kit;
  // the caster/stealth bar gets the form-filtered known abilities). Item
  // shortcuts and manual arrangement are intentionally discarded — it's a reset.
  // The per-frame update() repaints the slot icons from hotbarActions, so we only
  // mutate state here (same as addAbilityToHotbar / drag-drop).
  private resetActiveFormBarToDefault(): void {
    this.hotbarActions = buildDefaultFormBar(
      this.formKitAbilityIds(this.activeHotbarForm),
      Hud.BAR_ABILITY_SLOTS,
    );
    this.knownAbilityIdsAtLastSlotSync = new Set(this.sim.known.map((k) => k.def.id));
    this.markFormBarSeeded();
    this.saveSlotMap();
    this.refreshSpellbookHotbarControls();
  }

  private formToggleAbilityId(): string | null {
    if (this.activeHotbarForm === 'bear') return 'bear_form';
    if (this.activeHotbarForm === 'cat') return 'cat_form';
    return null;
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
    // Only auto-place abilities that belong on the active form's bar, so newly
    // learned form abilities land on their form bar and not the caster bar.
    const consider = (id: string) => {
      if (this.shouldAutoPlaceOnForm(id, this.activeHotbarForm)) autoPlaceAbilityIds.add(id);
    };
    if (this.knownAbilityIdsAtLastSlotSync === null) {
      if (!this.loadedSlotMapFromStorage) {
        for (const id of knownAbilityIds) consider(id);
      }
    } else {
      for (const id of knownAbilityIds) {
        if (!this.knownAbilityIdsAtLastSlotSync.has(id)) consider(id);
      }
    }
    const formToggle = this.formToggleAbilityId();
    if (formToggle && knownAbilityIds.includes(formToggle)) autoPlaceAbilityIds.add(formToggle);
    const synced = syncHotbarActions(this.hotbarActions, knownAbilityIds, autoPlaceAbilityIds);
    this.hotbarActions = synced.actions;
    if (synced.changed) this.saveSlotMap();
    this.knownAbilityIdsAtLastSlotSync = new Set(knownAbilityIds);
  }

  private actionForSlot(barSlot: number): HotbarAction {
    // barSlot 1..11
    return this.hotbarActions[barSlot - 1] ?? null;
  }

  abilityForSlot(barSlot: number): ResolvedAbility | null {
    // barSlot 1..11
    const action = this.actionForSlot(barSlot);
    return action?.type === 'ability'
      ? (this.sim.known.find((k) => k.def.id === action.id) ?? null)
      : null;
  }

  private itemForSlot(barSlot: number): ItemDef | null {
    const action = this.actionForSlot(barSlot);
    return action?.type === 'item' ? (ITEMS[action.id] ?? null) : null;
  }

  private inventoryCount(itemId: string): number {
    return this.sim.inventory.reduce(
      (total, slot) => total + (slot.itemId === itemId ? slot.count : 0),
      0,
    );
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
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    return parseHotbarAction(
      parsed,
      (id) => this.sim.known.some((k) => k.def.id === id),
      (id) => this.isHotbarItemId(id),
    );
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
      btn.dataset.hotbarSlot = String(slot);
      // slot 0 is Attack for every class (auto-attack toggle — players
      // without right-click need a way in); the kit fills slots 1+
      btn.addEventListener('click', () => {
        if (this.suppressNextActionClick) {
          this.suppressNextActionClick = false;
          btn.blur();
          return;
        }
        // On touch, the click that ends a long-press peek inspects the slot
        // (tooltip already shown) instead of casting — release dismisses it.
        if (this.peekGuard.consume()) {
          this.hideTooltip();
          btn.blur();
          return;
        }
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
          return (
            this.itemTooltip(item) +
            `<div class="tt-sub">${esc(
              count > 0
                ? t('abilityUi.actionBar.itemInBags', {
                    count: formatNumber(count, { maximumFractionDigits: 0 }),
                  })
                : t('abilityUi.actionBar.itemNoneInBags'),
            )}</div>` +
            clearHint
          );
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
          if (!action) {
            e.preventDefault();
            return;
          }
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
          e.dataTransfer!.dropEffect =
            this.dragAction?.sourceIndex === null && dragged.type === 'item' ? 'copy' : 'move';
          btn.classList.add('drop-target');
        });
        btn.addEventListener('dragleave', () => btn.classList.remove('drop-target'));
        btn.addEventListener('drop', (e) => {
          e.preventDefault();
          btn.classList.remove('drop-target');
          const dragged = this.dragAction ?? {
            action: this.readDraggedAction(e.dataTransfer),
            sourceIndex: null,
          };
          this.dragAction = null;
          const action = dragged.action;
          if (!action) return;
          if (dragged.sourceIndex !== null)
            this.hotbarActions = swapHotbarSlots(this.hotbarActions, dragged.sourceIndex, slot - 1);
          else if (
            action.type === 'ability' &&
            this.sim.known.some((k) => k.def.id === action.id)
          ) {
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
        this.bindMobileActionDrag(btn, slot);
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
      this.abilityButtons.push({
        btn,
        label,
        countEl,
        keybindEl: kb,
        cdOverlay,
        cdText,
        lastIcon: '',
      });
    }
  }

  private clearActionDropTargets(): void {
    document.querySelectorAll('#actionbar .drop-target').forEach((el) => {
      el.classList.remove('drop-target');
    });
  }

  private actionButtonSlotFromPoint(x: number, y: number): number | null {
    const el = document
      .elementFromPoint(x, y)
      ?.closest?.('.action-btn') as HTMLButtonElement | null;
    const raw = el?.dataset.hotbarSlot;
    if (!raw) return null;
    const slot = Number(raw);
    return Number.isInteger(slot) && slot >= 1 ? slot : null;
  }

  private clearMobileHotbarDrag(): void {
    const drag = this.mobileHotbarDrag;
    if (drag) window.clearTimeout(drag.timer);
    this.mobileHotbarDrag = null;
    document.body.classList.remove('mobile-hotbar-dragging');
    document.querySelectorAll('#actionbar .mobile-drag-source').forEach((el) => {
      el.classList.remove('mobile-drag-source');
    });
    this.clearActionDropTargets();
  }

  private bindMobileActionDrag(btn: HTMLButtonElement, slot: number): void {
    btn.addEventListener('pointerdown', (e) => {
      if (!document.body.classList.contains('mobile-touch') || e.pointerType !== 'touch') return;
      if (this.actionForSlot(slot)?.type !== 'ability') return;
      this.clearMobileHotbarDrag();
      const sourceIndex = slot - 1;
      const drag: MobileHotbarDrag = {
        pointerId: e.pointerId,
        sourceIndex,
        startX: e.clientX,
        startY: e.clientY,
        active: false,
        targetIndex: null,
        timer: window.setTimeout(() => {
          const current = this.mobileHotbarDrag;
          if (!current || current.pointerId !== e.pointerId) return;
          current.active = true;
          current.targetIndex = sourceIndex;
          this.suppressNextActionClick = true;
          document.body.classList.add('mobile-hotbar-dragging');
          btn.classList.add('mobile-drag-source');
          btn.classList.add('drop-target');
          this.hideTooltip();
          try {
            btn.setPointerCapture?.(e.pointerId);
          } catch {
            /* pointer already released */
          }
        }, 320),
      };
      this.mobileHotbarDrag = drag;
    });

    btn.addEventListener('pointermove', (e) => {
      const drag = this.mobileHotbarDrag;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
      if (!drag.active && moved > 9) {
        this.clearMobileHotbarDrag();
        return;
      }
      if (!drag.active) return;
      e.preventDefault();
      const targetSlot = this.actionButtonSlotFromPoint(e.clientX, e.clientY);
      const targetIndex = targetSlot !== null ? targetSlot - 1 : null;
      drag.targetIndex = targetIndex;
      this.clearActionDropTargets();
      const targetBtn = targetSlot !== null ? this.abilityButtons[targetSlot]?.btn : null;
      if (targetBtn) targetBtn.classList.add('drop-target');
      this.abilityButtons[drag.sourceIndex + 1]?.btn.classList.add('mobile-drag-source');
    });

    const finish = (e: PointerEvent) => {
      const drag = this.mobileHotbarDrag;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const wasActive = drag.active;
      const targetIndex = drag.targetIndex;
      if (wasActive) {
        e.preventDefault();
        this.suppressNextActionClick = true;
        if (targetIndex !== null && targetIndex !== drag.sourceIndex) {
          this.hotbarActions = swapHotbarSlots(this.hotbarActions, drag.sourceIndex, targetIndex);
          this.saveSlotMap();
        }
      }
      this.clearMobileHotbarDrag();
    };
    btn.addEventListener('pointerup', finish);
    btn.addEventListener('pointercancel', finish);
  }

  // Repaint the keycap on every action button from the current bindings.
  private refreshKeybindLabels(): void {
    for (let i = 0; i < this.abilityButtons.length; i++) {
      this.abilityButtons[i].keybindEl.textContent = this.keybinds.primaryLabel(`slot${i}`);
    }
    const sideButtons: [selector: string, action: string, labelKey: TranslationKey][] = [
      ['#mm-char', 'char', 'hud.keybinds.actions.char'],
      ['#mm-spell', 'spellbook', 'abilityUi.spellbook.title'],
      ['#mm-talents', 'talents', 'game.talents.title'],
      ['#mm-quest', 'questlog', 'questUi.log.title'],
      ['#mm-map', 'map', 'hud.core.mobileMap'],
      ['#mm-bag', 'bags', 'itemUi.bags.title'],
      ['#mm-arena', 'arena', 'hud.core.mobileArena'],
      ['#mm-leaderboard', 'leaderboard', 'game.leaderboard.title'],
      ['#mm-emote', 'emoteWheel', 'hudChrome.emoteWheel.label'],
      ['#mm-social', 'social', 'hud.social.friendsTab'],
    ];
    for (const [selector, action, labelKey] of sideButtons) {
      const btn = document.querySelector<HTMLElement>(selector);
      if (!btn) continue;
      const key = this.keybinds.primaryLabel(action);
      const label = t(labelKey);
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
    const autoTaunt = pet.petAutoTaunt === true;
    const ownerClass = this.sim.cfg.playerClass;
    const sig = `${pet.id}:${ownerClass}:${mode}:${cd}:${autoTaunt ? 'auto' : 'manual'}:${this.pendingPetFeed ? 'feed' : ''}:${this.petModeMenuOpen ? 'modes' : ''}`;
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
    const addButton = (
      parent: HTMLElement,
      iconId: string,
      title: string,
      tooltip: string,
      onClick: () => void,
      opts: {
        active?: boolean;
        autocast?: boolean;
        cooldownText?: string;
        onContextMenu?: () => void;
        onTouchHold?: () => void;
      } = {},
    ) => {
      const btn = document.createElement('button');
      btn.className = 'pet-btn';
      if (opts.active) btn.classList.add('active');
      if (opts.autocast) btn.classList.add('autocast');
      if (opts.cooldownText) btn.classList.add('cooldown');
      btn.title = title;
      btn.setAttribute('aria-label', title);
      if (opts.active || opts.autocast) btn.setAttribute('aria-pressed', 'true');
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
      let suppressNextClick = false;
      let touchHoldTimer: number | undefined;
      let touchHoldPointerId: number | null = null;
      let touchHoldStartX = 0;
      let touchHoldStartY = 0;
      let touchHoldTriggered = false;
      let touchHoldCanceled = false;
      const clearTouchHoldTimer = () => {
        if (touchHoldTimer !== undefined) window.clearTimeout(touchHoldTimer);
        touchHoldTimer = undefined;
      };
      const runClickAction = () => {
        if (opts.cooldownText) return;
        audio.click();
        onClick();
      };
      btn.addEventListener('click', () => {
        if (suppressNextClick) {
          suppressNextClick = false;
          this.peekGuard.consume();
          this.hideTooltip();
          btn.blur();
          return;
        }
        if (this.peekGuard.consume()) {
          this.hideTooltip();
          btn.blur();
          return;
        }
        runClickAction();
      });
      if (opts.onContextMenu) {
        btn.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          if (document.body.classList.contains('mobile-touch')) return;
          audio.click();
          opts.onContextMenu?.();
        });
      }
      if (opts.onTouchHold) {
        btn.addEventListener('pointerdown', (event) => {
          if (!document.body.classList.contains('mobile-touch') || event.pointerType !== 'touch') {
            return;
          }
          event.preventDefault();
          clearTouchHoldTimer();
          suppressNextClick = false;
          touchHoldTriggered = false;
          touchHoldCanceled = false;
          touchHoldPointerId = event.pointerId;
          touchHoldStartX = event.clientX;
          touchHoldStartY = event.clientY;
          try {
            btn.setPointerCapture?.(event.pointerId);
          } catch {
            /* pointer already released */
          }
          touchHoldTimer = window.setTimeout(() => {
            if (touchHoldPointerId !== event.pointerId || touchHoldCanceled) return;
            touchHoldTriggered = true;
            suppressNextClick = true;
            audio.click();
            opts.onTouchHold?.();
            this.hideTooltip();
            this.peekGuard.consume();
            btn.blur();
          }, Hud.PET_AUTOCAST_TOUCH_HOLD_MS);
        });
        btn.addEventListener('pointermove', (event) => {
          if (touchHoldPointerId !== event.pointerId) return;
          const moved = Math.hypot(
            event.clientX - touchHoldStartX,
            event.clientY - touchHoldStartY,
          );
          if (moved > 9) {
            touchHoldCanceled = true;
            clearTouchHoldTimer();
          }
        });
        const finishTouchHold = (event: PointerEvent, canceled: boolean) => {
          if (touchHoldPointerId !== event.pointerId) return;
          event.preventDefault();
          const triggered = touchHoldTriggered;
          const movedAway = touchHoldCanceled || canceled;
          clearTouchHoldTimer();
          touchHoldPointerId = null;
          touchHoldTriggered = false;
          touchHoldCanceled = false;
          suppressNextClick = true;
          if (triggered || movedAway) {
            this.peekGuard.consume();
            return;
          }
          if (this.peekGuard.consume()) {
            this.hideTooltip();
            btn.blur();
            return;
          }
          runClickAction();
          btn.blur();
        };
        btn.addEventListener('pointerup', (event) => finishTouchHold(event, false));
        btn.addEventListener('pointercancel', (event) => finishTouchHold(event, true));
      }
      this.attachTooltip(btn, () => tooltip);
      parent.appendChild(btn);
    };
    addButton(
      commands,
      'attack',
      t('hud.pet.attack'),
      petTooltip(t('hud.pet.petAttackTitle'), t('hud.pet.petAttackDesc')),
      () => this.sim.petAttack(),
    );
    addButton(
      commands,
      'growl',
      t('hud.pet.taunt'),
      petTooltip(t('hud.pet.petTauntTitle'), t('hud.pet.petTauntDesc')),
      () => this.sim.petTaunt(),
      {
        autocast: autoTaunt,
        cooldownText: cd > 0 ? `${cd}` : undefined,
        onContextMenu: () => {
          this.sim.setPetAutoTaunt(!autoTaunt);
          this.lastPetBarSig = '';
        },
        onTouchHold: () => {
          this.sim.setPetAutoTaunt(!autoTaunt);
          this.lastPetBarSig = '';
        },
      },
    );
    if (ownerClass === 'warlock') {
      addButton(
        commands,
        'drain_life',
        t('hud.pet.healDemon'),
        petTooltip(t('hud.pet.healDemon'), t('hud.pet.healDemonDesc')),
        () => {
          this.sim.healPet();
        },
      );
    } else {
      addButton(
        commands,
        'rejuvenation',
        t('hud.pet.healPet'),
        petTooltip(t('hud.pet.healPet'), t('hud.pet.healPetDesc')),
        () => {
          // Toggle: a second click cancels the pending feed instead of trapping
          // the player in food-selection mode.
          if (this.pendingPetFeed) {
            this.cancelPetFeed();
            return;
          }
          // With no edible food there is nothing to select, so entering feed mode
          // would strand the player on the bag screen — surface an error instead.
          if (!this.hasPetFood()) {
            this.showError(t('hud.pet.noPetFood'));
            return;
          }
          this.pendingPetFeed = true;
          this.lastPetBarSig = '';
          $('#bags').style.display = 'block';
          this.renderBags();
        },
        { active: this.pendingPetFeed },
      );
    }
    const modes: { mode: PetMode; labelKey: TranslationKey; descKey: TranslationKey }[] = [
      {
        mode: 'passive',
        labelKey: PET_MODE_LABEL_KEYS.passive,
        descKey: PET_MODE_DESC_KEYS.passive,
      },
      {
        mode: 'defensive',
        labelKey: PET_MODE_LABEL_KEYS.defensive,
        descKey: PET_MODE_DESC_KEYS.defensive,
      },
      {
        mode: 'aggressive',
        labelKey: PET_MODE_LABEL_KEYS.aggressive,
        descKey: PET_MODE_DESC_KEYS.aggressive,
      },
    ];
    const modeIcons: Record<PetMode, string> = {
      passive: 'prowl',
      defensive: 'defensive_stance',
      aggressive: 'rapid_fire',
    };
    addButton(
      stances,
      modeIcons[mode],
      petModeLabel(mode),
      petTooltip(`${t('hud.pet.stanceTitle')}: ${petModeLabel(mode)}`, t('hud.pet.stanceDesc')),
      () => {
        this.petModeMenuOpen = !this.petModeMenuOpen;
        this.lastPetBarSig = '';
      },
      { active: true },
    );
    if (!this.petModeMenuOpen) return;
    for (const entry of modes) {
      addButton(
        stances,
        modeIcons[entry.mode],
        t(entry.labelKey),
        petTooltip(t(entry.labelKey), t(entry.descKey)),
        () => {
          this.sim.setPetMode(entry.mode);
          this.petModeMenuOpen = false;
          this.lastPetBarSig = '';
        },
        { active: mode === entry.mode },
      );
    }
  }

  // -------------------------------------------------------------------------
  // Frame update
  // -------------------------------------------------------------------------

  // Pulsing red screen edge that fades in as the player nears death. Driven
  // from the pure lowHealthVignette() curve; purely presentational (CSS vars on
  // a fixed overlay), works on every GFX tier since it's DOM, not a post pass.
  private updateLowHealthVignette(hp: number, maxHp: number): void {
    const el = document.getElementById('low-health-vignette');
    if (!el) return;
    const v = lowHealthVignette(hp, maxHp);
    if (!v.active) {
      el.classList.remove('active');
      return;
    }
    el.style.setProperty('--lhv-opacity', v.opacity.toFixed(3));
    el.style.setProperty('--lhv-pulse', `${v.pulseSeconds.toFixed(3)}s`);
    el.classList.add('active');
  }

  update(): void {
    const sim = this.sim;
    const p = sim.player;
    const now = performance.now();
    const fastHud = now - this.lastHudFastAt >= 100;
    if (fastHud) {
      this.lastHudFastAt = now;
      this.reconcileSfx();
    }
    const mediumHud = now - this.lastHudMediumAt >= 250;
    if (mediumHud) this.lastHudMediumAt = now;
    const slowHud = now - this.lastHudSlowAt >= 500;
    if (slowHud) this.lastHudSlowAt = now;

    this.meters.update();
    this.lockpickWindow.repaintIfChanged();
    this.tutorial.update(sim, this.renderer, this.keybinds);
    this.reconcileLootRolls();
    this.updateLootRollTimers(now);
    if (slowHud) this.updateRaidLockoutBadge();
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
    this.updateAbsorb('#pf-absorb', p);
    this.setText(this.pfHpTextEl, `${p.hp} / ${p.maxHp}`);
    this.updateLowHealthVignette(p.hp, p.maxHp);
    const resFrac = p.resource / Math.max(1, p.maxResource);
    this.setTransform(this.pfResEl, `scaleX(${resFrac})`);
    this.setText(this.pfResTextEl, `${Math.round(p.resource)} / ${p.maxResource}`);
    const resClass = `bar ${p.resourceType === 'rage' ? 'rage' : p.resourceType === 'energy' ? 'energy' : 'mana'}`;
    if (this.pfResourceEl.className !== resClass) this.pfResourceEl.className = resClass;
    this.updateLowResource(p);

    // buff bar (player buffs + debuffs)
    this.renderAuras(this.buffBarEl, p, 'all');

    // target frame
    const target = p.targetId !== null ? sim.entities.get(p.targetId) : null;
    if (target && target.kind !== 'object') {
      this.setDisplay(this.targetFrameEl, 'flex');
      this.targetFrameEl.classList.toggle('elite', !!MOBS[target.templateId]?.elite);
      this.setText(
        this.targetEliteTagEl,
        MOBS[target.templateId]?.boss ? t('hud.core.boss') : t('hud.core.elite'),
      );
      this.setText(this.targetNameEl, entityDisplayName(target));
      this.setText(this.targetLevelEl, MOBS[target.templateId]?.boss ? '☠' : String(target.level));
      this.setTransform(this.targetHpEl, `scaleX(${target.hp / Math.max(1, target.maxHp)})`);
      this.updateAbsorb('#tf-absorb', target.dead ? null : target);
      this.setText(
        this.targetHpTextEl,
        target.dead ? t('hud.core.dead') : `${target.hp} / ${target.maxHp}`,
      );
      const targetNameColor = target.hostile ? 'var(--color-hostile)' : 'var(--color-friendly)';
      if (this.targetNameEl.style.color !== targetNameColor)
        this.targetNameEl.style.color = targetNameColor;
      if (this.lastPortraitTarget !== target.id) {
        this.lastPortraitTarget = target.id;
        if (target.kind === 'player') {
          // Other players: their real 3D headshot, rendered locally from the
          // class (templateId) + skin in their synced identity fields.
          this.portraits.drawClass(
            this.targetPortraitEl,
            target.templateId as PlayerClass,
            target.skin ?? 0,
          );
        } else {
          this.portraits.drawCrest(
            this.targetPortraitEl,
            crestIdForEntity(target.kind, MOBS[target.templateId]?.family),
          );
        }
      }
      this.renderAuras(this.targetDebuffsEl, target, 'debuffs');
      // target/boss cast bar (e.g. Nythraxis' Deathless Rage) — shown under the
      // name + HP so the raid sees exactly when to channel the wardstones
      const tcb = castBarState(target);
      if (tcb.visible) {
        this.setDisplay(this.targetCastbarEl, 'block');
        this.targetCastbarEl.classList.toggle('channel', tcb.channel);
        this.setWidth(this.targetCastbarFillEl, `${(tcb.fill * 100).toFixed(1)}%`);
        this.setText(this.targetCastbarLabelEl, tcb.label);
        this.setText(
          this.targetCastbarTimerEl,
          formatNumber(Math.max(0, target.castRemaining), {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          }),
        );
      } else {
        this.setDisplay(this.targetCastbarEl, 'none');
      }
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
        [...this.comboRowEl.children].forEach((pip, i) => {
          pip.classList.toggle('on', i < points);
        });
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
      this.setText(
        this.castbarTimerEl,
        formatNumber(Math.max(0, p.castRemaining), {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }),
      );
    } else if (p.eating || p.drinking) {
      this.setDisplay(this.castbarEl, 'block');
      this.castbarEl.classList.add('channel');
      const c =
        p.eating && p.drinking
          ? p.eating.remaining >= p.drinking.remaining
            ? p.eating
            : p.drinking
          : (p.eating ?? p.drinking)!;
      this.setWidth(this.castbarFillEl, `${((c.remaining / CONSUME_DURATION) * 100).toFixed(1)}%`);
      this.setText(
        this.castbarLabelEl,
        p.eating && p.drinking
          ? t('hud.core.eatingDrinking')
          : p.eating
            ? t('hud.core.eating')
            : t('hud.core.drinking'),
      );
      this.setText(
        this.castbarTimerEl,
        formatNumber(Math.max(0, c.remaining), {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }),
      );
    } else {
      this.setDisplay(this.castbarEl, 'none');
      this.castbarEl.classList.remove('channel');
      this.setWidth(this.castbarFillEl, '0%');
      this.setText(this.castbarLabelEl, '');
      this.setText(this.castbarTimerEl, '');
    }

    // swing timer — fills between melee/ranged auto-attack swings. swingTimer
    // counts DOWN to 0 (ready); we recover the full interval from the reset
    // edge so the bar stays accurate under haste and for ranged weapons.
    const sw = $('#swingbar');
    if (p.autoAttack && target && !target.dead && target.kind !== 'object') {
      if (p.swingTimer > this.lastSwingTimer + 1e-4 || this.swingPeriod <= 0) {
        this.swingPeriod = Math.max(p.swingTimer, p.weapon.speed);
      }
      this.lastSwingTimer = p.swingTimer;
      const frac =
        this.swingPeriod > 0 ? Math.min(1, Math.max(0, 1 - p.swingTimer / this.swingPeriod)) : 1;
      sw.style.display = 'block';
      (sw.querySelector('.fill') as HTMLElement).style.width = `${(frac * 100).toFixed(1)}%`;
      sw.classList.toggle('ready', p.swingTimer <= 0);
      (sw.querySelector('.label') as HTMLElement).textContent =
        p.swingTimer <= 0
          ? t('hudChrome.swing.ready')
          : t('hudChrome.swing.seconds', {
              seconds: formatNumber(p.swingTimer, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              }),
            });
    } else {
      sw.style.display = 'none';
      this.lastSwingTimer = 0;
      this.swingPeriod = 0;
    }

    // action bar
    this.renderPetBar();
    const tgtDist = target && !target.dead ? dist2d(p.pos, target.pos) : null;
    this.actionbarEl.classList.toggle(
      'many-spells',
      this.hotbarActions.filter((action) => action !== null).length > 10,
    );
    if ($('#spellbook').style.display === 'block') this.refreshSpellbookHotbarControls();
    for (let i = 0; i < this.abilityButtons.length; i++) {
      const ab = this.abilityButtons[i];
      const slotLabel = formatAbilityNumber(i + 1);
      if (i === 0) {
        // Attack button: glows while auto-attacking, red-edged out of range
        ab.btn.classList.remove('empty', 'unusable');
        ab.btn.setAttribute(
          'aria-label',
          t('abilityUi.actionBar.slotAria', {
            slot: slotLabel,
            ability: t('abilityUi.actionBar.attackName'),
          }),
        );
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
        ab.btn.setAttribute(
          'aria-label',
          t('abilityUi.actionBar.emptySlotAria', { slot: slotLabel }),
        );
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
        ab.btn.setAttribute(
          'aria-label',
          t('abilityUi.actionBar.slotAria', {
            slot: slotLabel,
            ability: itemDisplayName(item),
          }),
        );
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
      if (!known) continue;
      const a = known.def;
      ab.btn.setAttribute(
        'aria-label',
        t('abilityUi.actionBar.slotAria', {
          slot: slotLabel,
          ability: abilityDisplayName(a),
        }),
      );
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
      const cdHeight =
        shown > 0 ? `${Math.min(100, (shown / Math.max(0.01, denom)) * 100)}%` : '0%';
      if (ab.cdOverlay.style.height !== cdHeight) ab.cdOverlay.style.height = cdHeight;
      this.setText(ab.cdText, cd > 1 ? Math.ceil(cd).toString() : '');
      ab.btn.classList.toggle('unusable', p.resource < known.cost);
      const oor =
        a.requiresTarget && tgtDist !== null && tgtDist > (a.range > 0 ? a.range : MELEE_RANGE);
      ab.btn.classList.toggle('oor', !!oor);
      ab.btn.classList.toggle('queued', p.queuedOnSwing === a.id);
    }

    // xp bar — pre-cap shows the level bar; post-cap fills toward the next
    // virtual level (Max-Level XP Overflow), with distinct prestige/gold styling.
    const showOverflow = (this.optionsHooks?.settings.get('showOverflowXp') ?? 1) >= 0.5;
    const bar = xpBarView({
      level: p.level,
      xp: sim.xp,
      lifetimeXp: sim.lifetimeXp,
      restedXp: sim.restedXp,
      showOverflow,
    });
    this.setWidth(this.xpFillEl, `${(bar.fillFrac * 100).toFixed(1)}%`);
    $('#xpbar').style.setProperty('--xp-fill', bar.fillFrac.toFixed(4));
    $('#player-frame').style.setProperty('--xp-fill', bar.fillFrac.toFixed(4));
    // Rested overlay sits ahead of the fill (classic inn-rested bonus preview).
    const restedEl = $('#xpbar .rested') as HTMLElement;
    restedEl.style.left = `${(bar.fillFrac * 100).toFixed(1)}%`;
    restedEl.style.width = `${(bar.restedFrac * 100).toFixed(1)}%`;
    this.setText(this.xpLabelEl, bar.label);
    $('#xpbar').classList.toggle('overflow', bar.postCap);
    $('#xpbar').classList.toggle('rested', bar.restedFrac > 0);

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
        const pastDeadBand =
          !lastZone ||
          p.pos.z < lastZone.zMin - ZONE_BANNER_DEADBAND ||
          p.pos.z >= lastZone.zMax + ZONE_BANNER_DEADBAND;
        if (pastDeadBand) {
          if (this.lastZoneId !== '') {
            const currentZoneName = zoneDisplayName(currentZone.id);
            this.showBanner(currentZoneName);
            this.log(t('hud.core.enteringZone', { zone: currentZoneName }), '#ffd100');
            this.logZoneWelcome(currentZone);
          }
          this.lastZoneId = currentZone.id;
          this.prewarmMapBg(currentZone.id); // get the new zone's map bg ready before the player opens it
        }
      }

      // subzone text: a smaller banner when you step into a named landmark
      // (classic "subzone" display). POIs are the same labels the minimap pins.
      const subzone = inDungeon
        ? null
        : nearestSubzone(p.pos.x, p.pos.z, currentZone.pois, this.lastSubzone);
      if (subzone !== this.lastSubzone) {
        this.lastSubzone = subzone;
        if (subzone) {
          const poiIndex = currentZone.pois.findIndex((q) => q.label === subzone);
          this.showSubzone(poiIndex >= 0 ? zonePoiLabel(currentZone.id, poiIndex) : subzone);
        }
      }

      // soundtrack: pick the zone theme and layer in combat percussion.
      // Combat = a mob is on us, or we traded blows in the last few seconds
      // (the wire protocol doesn't ship the inCombat flag).
      let aggroed = false;
      let _nythraxisAlive = false;
      let bossEngaged = false; // the Nythraxis raid boss is pulled -> its own track
      const dungeon = dungeonAt(p.pos.x);
      const inNythraxisArena = dungeon?.id === 'nythraxis_boss_arena';
      for (const e of sim.entities.values()) {
        if (e.kind !== 'mob' || e.dead) continue;
        if (e.aggroTargetId === sim.playerId) aggroed = true;
        if (e.templateId === 'nythraxis_scourge_of_thornpeak') {
          _nythraxisAlive = true;
          if (e.aggroTargetId !== null) bossEngaged = true;
        }
      }
      const inCombat = aggroed || now - this.lastCombatEventAt < 5000;
      const musicCombat = inCombat || inNythraxisArena;
      bossEngaged =
        bossEngaged || inNythraxisArena || now - this.lastNythraxisCombatEventAt < 10000;
      const hub = currentZone.hub;
      const inHub = !inDungeon && Math.hypot(p.pos.x - hub.x, p.pos.z - hub.z) < hub.radius + 10;
      // Delves sit past the dungeon x-threshold (so inDungeon is already true) but
      // dungeonAt() returns null for them, so feed the delve id as the instance id:
      // delves use the dungeon theme (dungeonMusicZoneForDungeon falls back to
      // dungeon_hollow_crypt) and get the same fresh-phrasing reset on entry that
      // real dungeons do, instead of relying on the accidental null fallback.
      const inDelveBand = isDelvePos(p.pos.x);
      const instanceId = inDelveBand
        ? (delveAt(p.pos.x)?.id ?? 'collapsed_reliquary')
        : (dungeon?.id ?? null);
      const zone = musicZoneForLocation(
        currentZone.id,
        currentZone.biome,
        inHub,
        inDungeon || inNythraxisArena,
        instanceId,
      );
      const musicDungeonId = inDungeon || inNythraxisArena ? instanceId : null;
      if (shouldResetMusicForDungeonEntry(this.lastMusicDungeonId, musicDungeonId)) {
        music.resetForDungeonEntry(musicDungeonId);
      }
      this.lastMusicDungeonId = musicDungeonId;
      music.update(zone, musicCombat);
      music.setBossCombat(bossEngaged);

      // classic combat indicator: crossed swords + red ring on the player portrait
      $('#player-frame').classList.toggle('combat', inCombat);
      // classic "resting" zZz on the player portrait while seated / recovering.
      // Reads the seated booleans IWorld exposes; works offline + online alike.
      const rest = restView({ sitting: !!p.sitting, eating: !!p.eating, drinking: !!p.drinking });
      if (rest.resting !== this.lastResting) {
        this.lastResting = rest.resting;
        const restEl = $('#pf-rest');
        restEl.classList.toggle('on', rest.resting);
        restEl.title = rest.labelKey ? t(rest.labelKey) : '';
      }

      this.updateQuestTracker();
      this.updateDelveTracker();
      this.updatePartyFrames();
      this.updateTradeWindow();
      this.updateArenaStatus();
      this.updateFiestaHud();
      if ($('#map-window').style.display === 'block') this.updateMapWindow();
      if ($('#arena-window').style.display === 'block') this.renderArenaWindow();
      if (this.openLootMobId !== null) {
        const mob = sim.entities.get(this.openLootMobId);
        if (!mob?.lootable || dist2d(p.pos, mob.pos) > 7) this.closeLoot();
      }
      if (this.openLootChestId !== null) {
        const chest = sim.entities.get(this.openLootChestId);
        if (!chest || dist2d(p.pos, chest.pos) > 7) this.closeLoot();
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
    if (fastHud) {
      this.updateMinimap();
      this.updateClock();
      this.updateMinimapCoords();
      this.updateCompass();
    }
    if (slowHud && $('#social-window').classList.contains('open')) {
      const struct = this.socialStructSig();
      if (struct !== this.lastSocialStruct) {
        this.lastSocialStruct = struct;
        this.lastSocialContent = JSON.stringify({
          social: this.sim.socialInfo,
          party: this.sim.partyInfo,
        });
        this.renderSocial();
      } else {
        const content = JSON.stringify({ social: this.sim.socialInfo, party: this.sim.partyInfo });
        if (content !== this.lastSocialContent) {
          this.lastSocialContent = content;
          this.refreshSocialList();
        }
      }
    }
    if (slowHud && this.marketOpen) {
      if (!this.nearbyMarketNpc()) this.closeMarket();
      else this.refreshMarket();
    }
  }

  // Overlay the absorb-shield segment on a unit-frame health bar. A null entity
  // (no target / dead) hides it.
  private updateAbsorb(sel: string, e: Entity | null): void {
    const el = $(sel) as HTMLElement;
    const v = e ? absorbBarView(e) : { fillFrac: 0, overshield: false, total: 0 };
    el.style.transform = `scaleX(${v.fillFrac})`;
    el.classList.toggle('overshield', v.overshield);
  }

  // Classic "low mana/energy" warning: pulse the player resource bar when power
  // runs low. Pure read of replicated state (resource/maxResource/type) so it
  // works offline and online alike. Touches the DOM only on state change.
  private updateLowResource(p: Entity): void {
    const v = lowResourceView({
      resource: p.resource,
      maxResource: p.maxResource,
      resourceType: p.resourceType,
    });
    const bar = $('#pf-resource') as HTMLElement;
    // The resource className is rebuilt every frame just above this call, so the
    // `.low` flag must be re-applied every frame too. Only the expensive style /
    // label writes are diffed against the cached signature.
    bar.classList.toggle('low', v.active);
    const sig = v.active ? `${v.opacity.toFixed(2)}|${v.pulseSeconds.toFixed(2)}|${v.label}` : '';
    if (sig === this.lastLowResourceSig) return;
    this.lastLowResourceSig = sig;
    const label = $('#pf-low-resource') as HTMLElement;
    if (v.active) {
      bar.style.setProperty('--lr-opacity', String(v.opacity));
      bar.style.setProperty('--lr-pulse', `${v.pulseSeconds}s`);
      label.textContent = v.label;
      label.style.display = 'block';
    } else {
      label.style.display = 'none';
    }
  }

  // Light the minimap raid-lockout badge while any raid is on cooldown (state
  // only flips on lock/unlock, so this runs on the slow HUD tick).
  private updateRaidLockoutBadge(): void {
    if (!this.raidLockoutEl) return;
    const locked = this.sim.raidLockouts().length > 0;
    if (locked === this.raidLockoutLocked) return;
    this.raidLockoutLocked = locked;
    this.raidLockoutEl.classList.toggle('locked', locked);
  }

  // Tooltip/panel HTML for the raid-lockout badge: localized title + a row per
  // still-locked raid (name + unlock countdown), or an "all ready" line.
  private raidLockoutPanelView(): string {
    const i18n: RaidLockoutI18n = {
      title: t('hudChrome.raidLockout.title'),
      allReady: t('hudChrome.raidLockout.allReady'),
      raidName: (id) => dungeonDisplayName(id),
      duration: (ms) => this.formatLockoutDuration(ms),
    };
    return raidLockoutPanelHtml(this.sim.raidLockouts(), i18n);
  }

  // Localized "Xd Yh" / "Xh Ym" / "Xm" / "<1m" for a remaining-ms span; the
  // digits run through formatNumber and the units reorder via the t() template.
  private formatLockoutDuration(ms: number): string {
    const { days, hours, minutes } = lockoutParts(ms);
    const n = (v: number) => formatNumber(v, { maximumFractionDigits: 0, useGrouping: false });
    switch (lockoutShape(ms)) {
      case 'daysHours':
        return t('hudChrome.raidLockout.daysHours', { d: n(days), h: n(hours) });
      case 'hoursMinutes':
        return t('hudChrome.raidLockout.hoursMinutes', { h: n(hours), m: n(minutes) });
      case 'minutes':
        return t('hudChrome.raidLockout.minutes', { m: n(minutes) });
      default:
        return t('hudChrome.raidLockout.lessThanMinute');
    }
  }

  private renderAuras(el: HTMLElement, e: Entity, mode: 'all' | 'debuffs'): void {
    // cheap diff: rebuild only when the aura set changes
    const sig = e.auras.map((a) => `${a.id}${Math.ceil(a.remaining)}x${a.stacks ?? 0}`).join('|');
    if ((el as any).__sig === sig) return;
    (el as any).__sig = sig;
    el.innerHTML = '';
    for (const a of e.auras) {
      // A negative-value stat aura (e.g. a mob's Withering Wail sapping attack
      // power, or an Intellect-draining curse) is a debuff even though it reuses a buff_* kind.
      const isDebuff =
        [
          'dot',
          'slow',
          'root',
          'stun',
          'incapacitate',
          'polymorph',
          'attackspeed',
          'debuff_ap',
          'sunder',
          'mortal_wound',
          'silence',
          'disarm',
          'blind',
          'expose',
          'spellvuln',
          'lockout',
          'vulnerability',
          'hex',
          'tongues',
          'cost_tax',
          'heal_absorb',
          'critvuln',
        ].includes(a.kind) ||
        (a.kind.startsWith('buff_') && a.value < 0);
      if (mode === 'debuffs' && !isDebuff) continue;
      const d = document.createElement('div');
      d.className = `buff${isDebuff ? ' debuff' : ''}`;
      d.style.backgroundImage = `url(${iconDataUrl('aura', ABILITIES[a.id] ? a.id : `aura_${a.kind}`)})`;
      const dur = document.createElement('div');
      dur.className = 'dur';
      dur.textContent = a.remaining < 99 ? `${Math.ceil(a.remaining)}s` : '';
      d.appendChild(dur);
      if (a.stacks && a.stacks > 1) {
        const st = document.createElement('div');
        st.className = 'stacks';
        st.textContent = formatNumber(a.stacks, { maximumFractionDigits: 0 });
        d.appendChild(st);
      }
      const auraName = ABILITIES[a.id]
        ? abilityDisplayName(ABILITIES[a.id])
        : auraDisplayNameFromSource(a.name);
      this.attachTooltip(
        d,
        () =>
          `<div class="tt-title">${esc(auraName)}</div><div class="tt-sub">${esc(tPlural('hudChrome.plurals.secondsRemaining', Math.ceil(a.remaining)))}</div>`,
      );
      el.appendChild(d);
    }
  }

  private updateQuestTracker(): void {
    const el = $('#quest-tracker');
    const settings = this.optionsHooks?.settings;
    let collapsed = (settings?.get('questTrackerCollapsed') ?? false) === true;
    const quests: TrackedQuest[] = [];
    for (const qp of this.sim.questLog.values()) {
      const quest = QUESTS[qp.questId];
      quests.push({
        id: qp.questId,
        title: questTitle(qp.questId),
        complete: qp.state === 'ready',
        objectives: quest.objectives.map((obj, i) => ({
          label: questObjectiveLabel(qp.questId, i),
          current: qp.counts[i],
          total: obj.count,
        })),
      });
    }
    // Only persist the collapse choice while at least one quest is tracked: when
    // the tracker empties (all quests turned in or abandoned) drop the flag, so a
    // freshly accepted quest reappears expanded with its objectives visible
    // rather than hidden behind a collapsed header. Self-limiting to a single
    // write: once cleared, later empty frames read false and skip.
    if (collapsed && quests.length === 0 && settings) {
      settings.set('questTrackerCollapsed', false);
      collapsed = false;
    }
    const html = this.questTrackerHtml(questTrackerView(quests, collapsed));
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  // Render the pure tracker view to the floating overlay's HTML. The header is a
  // <button> (pointer-events re-enabled in CSS over the otherwise click-through
  // overlay) that toggles the collapse; a delegated listener on #quest-tracker
  // (see the event-binding constructor) handles activation so it survives these
  // innerHTML rebuilds.
  private questTrackerHtml(view: QuestTrackerView): string {
    if (!view.visible) return '';
    const chevron = view.collapsed ? '▸' : '▾'; // U+25B8 right / U+25BE down triangle
    // The leading space keeps a separator in the button's accessible name
    // ("Quests (5)", not "Quests(5)"); the visual gap is the flex `gap`.
    const count = view.collapsed
      ? ` <span class="qt-count">${esc(t('hudChrome.questTracker.count', { count: this.questNumber(view.count) }))}</span>`
      : '';
    // State-aware hover hint: clicking collapses while expanded, expands while collapsed.
    const hint = esc(
      t(
        view.collapsed
          ? 'hudChrome.questTracker.expandHint'
          : 'hudChrome.questTracker.collapseHint',
      ),
    );
    // aria-controls points at the row list (kept in the DOM, empty when collapsed)
    // so assistive tech ties the toggle to the region it shows/hides.
    const html =
      `<button type="button" class="qt-header" aria-expanded="${!view.collapsed}" aria-controls="qt-list" title="${hint}">` +
      `<span class="qt-chevron" aria-hidden="true">${chevron}</span>` +
      `<span class="qt-h-label">${esc(t('questUi.tracker.title'))}</span>${count}</button>`;
    let rows = '';
    for (const q of view.quests) {
      rows += `<div class="qt-title">${esc(q.title)}${q.complete ? ` <span class="quest-complete">(${esc(t('questUi.tracker.complete'))})</span>` : ''}</div>`;
      for (const o of q.objectives) {
        rows += `<div class="qt-obj${o.done ? ' done' : ''}">- ${esc(this.questProgressText(o.label, o.current, o.total))}</div>`;
      }
    }
    return `${html}<div id="qt-list">${rows}</div>`;
  }

  /** Flip the persisted tracker-collapsed preference (the header click/keyboard
   *  activation), preserving keyboard focus across the innerHTML rebuild. */
  private toggleQuestTrackerCollapsed(): void {
    const settings = this.optionsHooks?.settings;
    if (!settings) return;
    const refocus =
      document.activeElement instanceof HTMLElement &&
      document.activeElement.classList.contains('qt-header');
    settings.set('questTrackerCollapsed', !settings.get('questTrackerCollapsed'));
    audio.click();
    this.updateQuestTracker();
    if (refocus) ($('#quest-tracker').querySelector('.qt-header') as HTMLElement | null)?.focus();
  }

  // -------------------------------------------------------------------------
  // Delve board & tracker
  // -------------------------------------------------------------------------

  openDelveBoard(npcId: number): void {
    const npc = this.sim.entities.get(npcId);
    if (npc?.kind !== 'npc') return;
    const delve = Object.values(DELVES).find((d) => d.boardNpcId === npc.templateId);
    if (!delve) return;
    if ($('#delve-board').style.display !== 'block')
      this.delveBoardReturnFocus = this.currentFocusableElement();
    this.openDelveBoardNpcId = npcId;
    this.selectedDelveTier = 'normal';
    this.delveBoardTab = 'delve';
    this.closeOtherWindows('#delve-board');
    $('#delve-board').style.display = 'block';
    this.renderDelveBoard(true);
  }

  private renderDelveBoard(focus = false): void {
    const el = $('#delve-board');
    const npcId = this.openDelveBoardNpcId;
    if (npcId === null) {
      el.style.display = 'none';
      return;
    }
    const npc = this.sim.entities.get(npcId);
    if (npc?.kind !== 'npc') {
      this.closeDelveBoard();
      return;
    }
    const delve = Object.values(DELVES).find((d) => d.boardNpcId === npc.templateId);
    if (!delve) {
      this.closeDelveBoard();
      return;
    }
    const delveName = delveDisplayName(delve.id);
    const canEnter = this.sim.player.level >= delve.minLevel;
    const tierNormal = t('delveUi.board.tier.normal');
    const tierHeroic = t('delveUi.board.tier.heroic');
    const marks = formatNumber(this.sim.delveMarks, { maximumFractionDigits: 0 });
    const tab = this.delveBoardTab;
    const tabBtn = (id: 'delve' | 'shop', label: string): string =>
      `<button type="button" class="delve-tab${tab === id ? ' active' : ''}" role="tab" aria-selected="${tab === id}" data-board-tab="${id}">${esc(label)}</button>`;
    let body: string;
    if (tab === 'shop') {
      body = this.delveShopBodyHtml(delve.id);
    } else {
      const tessaRank = this.sim.companionUpgrades.companion_tessa ?? 1;
      const tessaRankLabel = t('delveUi.board.companion.rank', {
        rank: formatNumber(tessaRank, { maximumFractionDigits: 0 }),
      });
      // Companion rank-up: max rank is the highest cost tier; the next rank's
      // Marks cost is shown on the button so the upgrade path is visible, and the
      // button only enables when the player can afford it (the buy is re-checked
      // sim-side regardless). Mirrors the Marks-shop affordability gating.
      const companionMaxRank = Math.max(...Object.keys(COMPANION_UPGRADE_COSTS).map(Number));
      const nextRank = tessaRank + 1;
      const nextCost = COMPANION_UPGRADE_COSTS[nextRank];
      const tessaName = t('delveUi.board.companion.tessa');
      let companionAction: string;
      if (tessaRank >= companionMaxRank || !nextCost) {
        companionAction = `<div class="delve-companion-max quest-muted">${esc(t('delveUi.board.companion.maxRank'))}</div>`;
      } else {
        const costMarks = formatNumber(nextCost.marks, { maximumFractionDigits: 0 });
        const nextRankLabel = formatNumber(nextRank, { maximumFractionDigits: 0 });
        const affordable = this.sim.delveMarks >= nextCost.marks;
        companionAction =
          `<button type="button" class="btn delve-companion-upgrade" data-companion-upgrade` +
          ` aria-label="${esc(t('delveUi.board.companion.upgradeAria', { name: tessaName, rank: nextRankLabel, marks: costMarks }))}"` +
          `${affordable ? '' : ' disabled'}>${esc(t('delveUi.board.companion.upgrade', { rank: nextRankLabel, marks: costMarks }))}</button>`;
      }
      const tierRow = ['normal', 'heroic']
        .map((tierId) => {
          const label = tierId === 'heroic' ? tierHeroic : tierNormal;
          const selected = this.selectedDelveTier === tierId ? ' selected' : '';
          return `<button type="button" class="delve-tier-btn${selected}" data-tier-pick="${esc(tierId)}" aria-pressed="${this.selectedDelveTier === tierId}">${esc(label)}</button>`;
        })
        .join('');
      body =
        `<div class="delve-board-greeting">${esc(t('delveUi.npc.halven.greeting', { playerName: this.sim.player.name }))}</div>` +
        `<div class="delve-tier-row">${tierRow}</div>` +
        `<div class="delve-companion-row"><div class="delve-companion-label">${esc(t('delveUi.board.companion.pick'))}</div>` +
        `<div class="delve-companion-name">${esc(tessaName)} <span class="quest-muted">(${esc(tessaRankLabel)})</span></div>` +
        `<div class="delve-companion-boon quest-muted">${esc(t('delveUi.board.companion.boon'))}</div>` +
        `${companionAction}</div>` +
        `<button type="button" class="btn delve-enter-btn" data-delve-enter aria-label="${esc(t('delveUi.board.enterAria', { delve: delveName, tier: this.selectedDelveTier === 'heroic' ? tierHeroic : tierNormal }))}"${canEnter ? '' : ' disabled'}>${esc(t('delveUi.board.enter'))}</button>`;
    }
    el.innerHTML =
      `<div class="panel-title"><span>${esc(t('delveUi.board.title'))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('questUi.dialog.close'))}">${svgIcon('close')}</button></div>` +
      `<div class="delve-board-name">${esc(delveName)}</div>` +
      `<div class="delve-board-meta">${esc(t('delveUi.board.marks', { count: marks }))}</div>` +
      `<div class="delve-board-req${canEnter ? '' : ' req-unmet'}">${esc(t('delveUi.board.minLevel', { level: formatNumber(delve.minLevel, { maximumFractionDigits: 0 }) }))}</div>` +
      `<div class="delve-tabs" role="tablist" aria-label="${esc(t('delveUi.board.title'))}">${tabBtn('delve', t('delveUi.board.tabDelve'))}${tabBtn('shop', t('delveUi.board.tabShop'))}</div>` +
      `<div class="delve-board-body" role="tabpanel">${body}</div>`;
    el.querySelectorAll('[data-board-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = (btn as HTMLElement).dataset.boardTab as 'delve' | 'shop';
        if (next === this.delveBoardTab) return;
        this.delveBoardTab = next;
        this.renderDelveBoard(true);
      });
    });
    if (tab === 'shop') {
      this.bindDelveShopHandlers(el, delve.id);
    } else {
      el.querySelectorAll('[data-tier-pick]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.selectedDelveTier = (btn as HTMLElement).dataset.tierPick as 'normal' | 'heroic';
          this.renderDelveBoard(true);
        });
      });
      el.querySelector('[data-companion-upgrade]')?.addEventListener('click', () => {
        this.sim.companionUpgrade('companion_tessa');
        this.renderDelveBoard(true);
      });
      el.querySelector('[data-delve-enter]')?.addEventListener('click', () => {
        const tierId = this.selectedDelveTier;
        this.sim.enterDelve(delve.id, tierId);
        // enterDelve queues delveEntered for the next sim tick; kick interior
        // prebuild now so the first rendered frame is not a fog void.
        this.renderer.handleEvent({ type: 'delveEntered', delveId: delve.id, tierId });
        this.closeDelveBoard();
      });
    }
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeDelveBoard());
    if (focus)
      this.focusFirstInteractive(el, tab === 'shop' ? '.delve-shop-buy' : '.delve-enter-btn');
  }

  // Brother Halven's Marks-vendor stock for the open delve. Offers + lock state
  // come resolved through IWorld (delveShopOffers); item display (name/quality/
  // icon/tooltip) is rendered locally like the silver vendor. The buy itself is
  // server-authoritative -- a locked or unaffordable offer is also re-checked sim-side.
  private delveShopBodyHtml(delveId: string): string {
    const rows = this.sim
      .delveShopOffers(delveId)
      .map((offer) => {
        const item = ITEMS[offer.itemId];
        if (!item) return '';
        const qColor = QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff';
        const name = itemDisplayName(item);
        const marksLabel = formatNumber(offer.marks, { maximumFractionDigits: 0 });
        const priceLabel = t('delveUi.shop.price', { marks: marksLabel });
        const affordable = this.sim.delveMarks >= offer.marks;
        let action: string;
        if (!offer.unlocked) {
          const req = offer.requiresHeroicClear
            ? t('delveUi.shop.reqHeroic')
            : t('delveUi.shop.reqClears', {
                count: formatNumber(offer.requiresClears, { maximumFractionDigits: 0 }),
              });
          action = `<span class="delve-shop-req">${esc(req)}</span>`;
        } else {
          const buyAria = t('delveUi.shop.buyAria', { item: name, marks: marksLabel });
          action = `<button type="button" class="delve-shop-buy" data-buy="${esc(offer.itemId)}" aria-label="${esc(buyAria)}"${affordable ? '' : ' disabled'}>${esc(t('delveUi.shop.buy'))}</button>`;
        }
        const priceCls = offer.unlocked && !affordable ? ' unaffordable' : '';
        return (
          `<div class="delve-shop-row${offer.unlocked ? '' : ' locked'}" role="listitem" data-shop-item="${esc(offer.itemId)}">` +
          `${this.itemIcon(item)}` +
          `<div class="delve-shop-info"><span class="delve-shop-name" style="color:${qColor}">${esc(name)}</span>` +
          `<span class="delve-shop-price${priceCls}">${esc(priceLabel)}</span></div>` +
          `${action}</div>`
        );
      })
      .join('');
    if (!rows) return `<div class="delve-shop-empty">${esc(t('delveUi.shop.empty'))}</div>`;
    return `<div class="delve-shop-list" role="list">${rows}</div>`;
  }

  private bindDelveShopHandlers(el: HTMLElement, delveId: string): void {
    el.querySelectorAll('[data-shop-item]').forEach((row) => {
      const item = ITEMS[(row as HTMLElement).dataset.shopItem ?? ''];
      if (item) this.attachTooltip(row as HTMLElement, () => this.itemTooltip(item));
    });
    el.querySelectorAll('[data-buy]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if ((btn as HTMLButtonElement).disabled) return;
        this.sim.delveBuyShopItem(delveId, (btn as HTMLElement).dataset.buy ?? '');
      });
    });
  }

  private closeDelveBoard(restoreFocus = true): void {
    $('#delve-board').style.display = 'none';
    this.openDelveBoardNpcId = null;
    this.hideTooltip();
    const target = this.delveBoardReturnFocus;
    this.delveBoardReturnFocus = null;
    if (restoreFocus) this.restoreFocus(target);
  }

  // ---------------------------------------------------------------------------
  // Lockpicking minigame ("Tumbler's Path"). The chest's first touch emits a
  // lockpickOffer (ante selector); engaging opens a live, server-authoritative
  // board driven entirely by lockpickSession/Step/End events. The HUD only ever
  // sees the fogged LockpickView, never the full lock. Player text renders through
  // the lockpickUi.* t() keys.
  // ---------------------------------------------------------------------------

  private openLockpickAnte(objectId: number, bountiful = false): void {
    const el = $('#lockpick-panel');
    if (el.style.display !== 'block') this.lockpickReturnFocus = this.currentFocusableElement();
    this.lockpickOfferId = objectId;
    this.lockpickCoffer = bountiful;
    el.style.display = 'block';
    this.bindLockpickKeys();
    this.lockpickWindow.renderAnte(objectId, bountiful);
    this.focusFirstInteractive(el, '.lp-ante-btn');
  }

  // The lockpick loot tier names are shared with the combat-log lines, so reuse
  // the sim.lockpick.tier* keys rather than minting parallel lockpickUi ones.
  private lockpickTierName(tier: 'premium' | 'medium' | 'low'): string {
    return t(
      tier === 'premium'
        ? 'sim.lockpick.tierPremium'
        : tier === 'medium'
          ? 'sim.lockpick.tierMedium'
          : 'sim.lockpick.tierLow',
    );
  }

  // A lockpickSession event means the authoritative board is live in
  // world.lockpickState; show the panel and let the window paint from it.
  private openLockpickBoard(): void {
    const el = $('#lockpick-panel');
    if (el.style.display !== 'block') this.lockpickReturnFocus = this.currentFocusableElement();
    this.lockpickOfferId = null;
    el.style.display = 'block';
    this.bindLockpickKeys();
    this.lockpickWindow.openBoard();
  }

  private endLockpick(
    outcome: 'success' | 'fail' | 'abandoned',
    tier?: 'premium' | 'medium' | 'low',
  ): void {
    const summary =
      outcome === 'success'
        ? tier
          ? t('lockpickUi.summary.success', { tier: this.lockpickTierName(tier) })
          : t('lockpickUi.summary.successGeneric')
        : outcome === 'fail'
          ? t('lockpickUi.summary.fail')
          : t('lockpickUi.summary.abandoned');
    if (outcome === 'success') this.showBanner(summary);
    this.log(summary, outcome === 'success' ? '#7fdc4f' : outcome === 'fail' ? '#ff7a6a' : '#ccc');
    this.closeLockpick();
  }

  private openDelveLoot(chestId: number, items: { itemId: string; count: number }[]): void {
    this.closeLockpick();
    if (items.length === 0) return;
    this.closeOtherWindows('#loot-window');
    this.openLootMobId = null;
    this.openLootChestId = chestId;
    const chest = this.sim.entities.get(chestId);
    const el = $('#loot-window');
    let html = `<div class="panel-title"><span>${esc(chest ? entityDisplayName(chest) : 'Chest')}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('itemUi.loot.close'))}">${svgIcon('close')}</button></div>`;
    for (const s of items) {
      const item = ITEMS[s.itemId];
      html += `<div class="loot-item" data-item="${s.itemId}">${this.itemIcon(item)}<span style="font-size:12px">${esc(itemDisplayName(item))}${s.count > 1 ? ` x${s.count}` : ''}</span></div>`;
    }
    el.innerHTML = html;
    el.querySelectorAll('[data-item]').forEach((row) => {
      const itemId = (row as HTMLElement).dataset.item!;
      this.attachTooltip(row as HTMLElement, () => this.itemTooltip(ITEMS[itemId]));
    });
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = t('itemUi.loot.takeAll');
    btn.addEventListener('click', () => {
      this.sim.collectDelveChestLoot(chestId);
      this.closeLoot();
    });
    el.appendChild(btn);
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeLoot());
    el.style.left = `${Math.max(10, (window.innerWidth - 230) / 2)}px`;
    el.style.top = `${Math.max(10, (window.innerHeight - 220) / 2)}px`;
    el.style.transform = 'none';
    el.style.display = 'block';
  }

  private bindLockpickKeys(): void {
    if (this.lockpickKeyHandler) return;
    const handler = (e: KeyboardEvent): void => {
      if ($('#lockpick-panel').style.display !== 'block') return;
      // A live board exists iff the authoritative session is non-null; otherwise
      // the panel is the ante selector and only Escape (close) applies.
      const live = this.sim.lockpickState;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (live) this.submitLockpickAbort();
        else this.closeLockpick();
        return;
      }
      if (!live) return;
      if (e.repeat) return;
      const key = e.key.toLowerCase();
      const idx = (PICK_ACTION_HOTKEYS as readonly string[]).indexOf(key);
      if (idx < 0) return;
      const action = PICK_ACTIONS[idx];
      if (!live.allowed.includes(action)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.submitLockpickAction(action);
    };
    this.lockpickKeyHandler = handler;
    window.addEventListener('keydown', handler, true); // capture: beats game input
  }

  /** Offline sim queues lockpick events until the 20 Hz tick; flush them now so
   * the step feedback toast, timer, and audio react immediately. The board
   * POSITION never depends on this (it always paints from world.lockpickState);
   * online has no drainEvents and reacts to the normal event stream instead. */
  flushLockpickEvents(): void {
    const drain = (this.sim as { drainEvents?: () => SimEvent[] }).drainEvents;
    if (!drain) return;
    const events = drain.call(this.sim);
    if (events.length > 0) this.handleEvents(events);
  }

  /** Engage through the HUD path (always flushes queued sim events). Dev consoles
   * should call this instead of sim.lockpickEngage directly. */
  submitLockpickEngage(objectId: number, ante: Ante): void {
    this.sim.lockpickEngage(objectId, ante);
    this.flushLockpickEvents();
  }

  submitLockpickAction(action: PickAction): void {
    this.sim.lockpickAction(action);
    this.flushLockpickEvents();
    // Safety net for any path that didn't emit a step event (e.g. a rejected
    // action): realign the board to the authoritative state.
    this.lockpickWindow.repaintIfChanged();
  }

  submitLockpickAbort(): void {
    this.lockpickWindow.stopTimer();
    this.sim.lockpickAbort();
    this.flushLockpickEvents();
  }

  private closeLockpick(restoreFocus = true): void {
    $('#lockpick-panel').style.display = 'none';
    this.lockpickOfferId = null;
    this.lockpickCoffer = false;
    this.lockpickWindow.close();
    this.hideTooltip();
    if (this.lockpickKeyHandler) {
      window.removeEventListener('keydown', this.lockpickKeyHandler, true);
      this.lockpickKeyHandler = null;
    }
    const target = this.lockpickReturnFocus;
    this.lockpickReturnFocus = null;
    if (restoreFocus) this.restoreFocus(target);
  }

  private delveObjectiveLine(run: DelveRunInfo): string {
    const isFinale = run.moduleIndex >= run.moduleCount - 1;
    if (!isFinale) return t('delveUi.objective.clear_room');
    if (run.objective.kind === 'kill_boss') {
      const bossId = DELVES[run.delveId]?.bosses[0] ?? 'deacon_varric';
      return t('delveUi.objective.kill_boss', { boss: mobDisplayName(bossId) });
    }
    return t(`delveUi.objective.${run.objective.kind}` as TranslationKey);
  }

  private delveAffixLabel(affixId: string): string {
    const affix = DELVE_AFFIXES[affixId];
    if (!affix) return affixId;
    if (affix.blessing) return t(`delveUi.blessing.${affixId}` as TranslationKey);
    return t(`delveUi.affix.${affixId}` as TranslationKey);
  }

  private updateDelveTracker(): void {
    const el = $('#delve-tracker');
    const run = this.sim.delveRun;
    if (!run) {
      this.lastDelveTrackerSig = '';
      if (el.innerHTML !== '') el.innerHTML = '';
      el.style.display = 'none';
      return;
    }
    const sig = JSON.stringify([
      run.delveId,
      run.tierId,
      run.moduleIndex,
      run.moduleCount,
      run.modules,
      run.objective,
      run.affixes,
      run.completed,
      run.exitPortalOpen,
      this.sim.delveMarks,
    ]);
    if (sig === this.lastDelveTrackerSig) return;
    this.lastDelveTrackerSig = sig;
    el.style.display = 'block';
    const delveName = delveDisplayName(run.delveId);
    const tierLabel =
      run.tierId === 'heroic' ? t('delveUi.board.tier.heroic') : t('delveUi.board.tier.normal');
    const modId = run.modules[run.moduleIndex];
    const modName = modId ? t(`delveUi.moduleName.${modId}` as TranslationKey) : '';
    const moduleLine = t('delveUi.tracker.module', {
      current: formatNumber(run.moduleIndex + 1, { maximumFractionDigits: 0 }),
      total: formatNumber(run.moduleCount, { maximumFractionDigits: 0 }),
    });
    const objectiveLine = this.delveObjectiveLine(run);
    const complete =
      run.objective.complete || run.completed
        ? ` <span class="quest-complete">(${esc(t('delveUi.tracker.complete'))})</span>`
        : '';
    let affixHtml = '';
    if (run.affixes.length > 0) {
      affixHtml = `<div class="dt-affix-row"><span class="dt-affix-label">${esc(t('delveUi.tracker.affix'))}</span>`;
      for (const affixId of run.affixes) {
        const color = DELVE_AFFIX_COLORS[affixId] ?? '#888';
        affixHtml += `<span class="dt-affix-icon" data-affix="${esc(affixId)}" style="background:${color}" role="img" tabindex="0" aria-label="${esc(this.delveAffixLabel(affixId))}"></span>`;
      }
      affixHtml += '</div>';
    }
    const marks = formatNumber(this.sim.delveMarks, { maximumFractionDigits: 0 });
    let exitHint = '';
    if (run.moduleIndex < run.moduleCount - 1) {
      if (run.exitPortalOpen) {
        exitHint = `<div class="dt-obj dt-hint">-> ${esc(t('delveUi.tracker.exitHintOpen'))}</div>`;
      } else {
        exitHint = `<div class="dt-obj dt-hint">${esc(t('delveUi.tracker.exitHintLocked'))}</div>`;
      }
    }
    el.innerHTML =
      `<div class="dt-header">${esc(t('delveUi.tracker.title'))}</div>` +
      `<div class="dt-title">${esc(delveName)} <span class="dt-tier">${esc(tierLabel)}</span>${complete}</div>` +
      `<div class="dt-obj">- ${esc(moduleLine)}${modName ? `: ${esc(modName)}` : ''}</div>` +
      `<div class="dt-obj${run.objective.complete ? ' done' : ''}">- ${esc(t('delveUi.tracker.objective'))}: ${esc(objectiveLine)}</div>` +
      exitHint +
      `<div class="dt-obj">- ${esc(t('delveUi.tracker.marks', { count: marks }))}</div>` +
      affixHtml;
    el.querySelectorAll('.dt-affix-icon').forEach((icon) => {
      const affixId = (icon as HTMLElement).dataset.affix!;
      this.attachTooltip(
        icon as HTMLElement,
        () => `<div class="tt-title">${esc(this.delveAffixLabel(affixId))}</div>`,
      );
    });
  }

  // -------------------------------------------------------------------------
  // Minimap & world map
  // -------------------------------------------------------------------------

  // Render a region of the heightfield to a canvas; width W px, height
  // derived from the region's aspect so a yard is square on screen.
  private renderTerrainCanvas(W: number, region: MapRegion): HTMLCanvasElement {
    const H = mapCanvasHeight(W, region);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(W, H);
    paintTerrainRows(img.data, W, H, region, this.sim.cfg.seed, 0, H);
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // The full-zone band used by the world map (and prewarm), keyed only on z.
  private mapZoneRegion(zone: ZoneDef): MapRegion {
    return { minX: WORLD_MIN_X, maxX: WORLD_MAX_X, minZ: zone.zMin, maxZ: zone.zMax };
  }

  // The cached terrain background for a zone, rendering it synchronously only if
  // a prewarm hasn't already produced it. The synchronous path is the fallback
  // for "opened the map the instant we entered a zone"; normally the idle
  // prewarm has it ready and this is a Map hit.
  private mapZoneBg(zone: ZoneDef): HTMLCanvasElement {
    const cached = this.mapBgCache.get(zone.id);
    if (cached) return cached;
    const bg = this.renderTerrainCanvas(MAP_BG_RES, this.mapZoneRegion(zone));
    this.mapBgCache.set(zone.id, bg);
    // a redundant in-flight prewarm for this same zone can be dropped now
    if (this.mapPrewarm?.zoneId === zone.id) this.cancelMapPrewarm();
    return bg;
  }

  // Kick off (or no-op) an idle, time-sliced render of a zone's map background
  // so opening the map never pays the ~200ms terrain cost on the click. Called
  // when the committed zone changes and once at startup for the spawn zone.
  private prewarmMapBg(zoneId: string): void {
    if (this.mapBgCache.has(zoneId)) return;
    if (this.mapPrewarm?.zoneId === zoneId) return; // already prewarming it
    const zone = ZONES.find((z) => z.id === zoneId);
    if (!zone) return;
    this.cancelMapPrewarm(); // drop any prewarm for a now-stale zone
    const region = this.mapZoneRegion(zone);
    const W = MAP_BG_RES;
    const H = mapCanvasHeight(W, region);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    this.mapPrewarm = {
      zoneId,
      canvas: c,
      ctx,
      img: ctx.createImageData(W, H),
      W,
      H,
      row: 0,
      region,
    };
    this.scheduleMapPrewarm();
  }

  private cancelMapPrewarm(): void {
    if (this.mapPrewarmHandle) {
      // Cancel only with the scheduler that produced this handle (see
      // mapPrewarmVia): the two id pools are separate per spec, so a cross
      // canceller could clear an unrelated timer sharing the number. When the
      // idle path lacks cancelIdleCallback there is nothing to call, but the
      // pumpMapPrewarm `if (!job) return` guard makes the stale callback a no-op.
      if (this.mapPrewarmVia === 'idle') {
        const cancel = (window as typeof window & { cancelIdleCallback?: (h: number) => void })
          .cancelIdleCallback;
        if (cancel) cancel(this.mapPrewarmHandle);
      } else {
        clearTimeout(this.mapPrewarmHandle);
      }
      this.mapPrewarmHandle = 0;
      this.mapPrewarmVia = null;
    }
    this.mapPrewarm = null;
  }

  private scheduleMapPrewarm(): void {
    const w = window as typeof window & {
      requestIdleCallback?: (
        cb: (d: { timeRemaining(): number }) => void,
        opts?: { timeout: number },
      ) => number;
    };
    if (w.requestIdleCallback) {
      this.mapPrewarmHandle = w.requestIdleCallback(this.pumpMapPrewarm, { timeout: 2000 });
      this.mapPrewarmVia = 'idle';
    } else {
      this.mapPrewarmHandle = window.setTimeout(() => this.pumpMapPrewarm(), 16);
      this.mapPrewarmVia = 'timeout';
    }
  }

  // Paint a budgeted slice of the in-flight prewarm, then reschedule until the
  // zone is fully rendered. Whole rows per slice keeps it byte-identical to a
  // one-shot render (the only per-row state, hillshade, resets each row).
  // With an idle deadline we paint as many slices as fit; without one (the
  // setTimeout fallback) we paint a single slice and let the reschedule pace it,
  // so the no-requestIdleCallback path stays sliced instead of rendering the
  // whole canvas in one ~200ms hitch.
  private pumpMapPrewarm = (deadline?: { timeRemaining(): number }): void => {
    const job = this.mapPrewarm;
    if (!job) return;
    const seed = this.sim.cfg.seed;
    const ROWS_PER_SLICE = 16; // ~6ms at MAP_BG_RES; one frame fits several
    do {
      const end = Math.min(job.H, job.row + ROWS_PER_SLICE);
      paintTerrainRows(job.img.data, job.W, job.H, job.region, seed, job.row, end);
      job.row = end;
    } while (job.row < job.H && deadline !== undefined && deadline.timeRemaining() > 3);
    if (job.row >= job.H) {
      job.ctx.putImageData(job.img, 0, 0);
      this.mapBgCache.set(job.zoneId, job.canvas);
      this.mapPrewarm = null;
      this.mapPrewarmHandle = 0;
      this.mapPrewarmVia = null;
      return;
    }
    this.scheduleMapPrewarm();
  };

  // Refresh the minimap clock to the current real local time. Cheap to call
  // every frame: the formatted string only changes once a minute, and we skip
  // the DOM write whenever it is unchanged.
  private updateClock(): void {
    if (!this.clockEl) return;
    const text = formatClockTime(new Date(), this.clock24);
    if (text !== this.lastClockText) {
      this.lastClockText = text;
      this.clockEl.textContent = text;
    }
  }

  // Classic-style coordinate readout pinned under the minimap. Reads only the
  // player position (already mirrored online), and diffs against the last text
  // so the DOM node is touched at most once per whole-yard step.
  private updateMinimapCoords(): void {
    const p = this.sim.player;
    const text = formatMinimapCoords(p.pos.x, p.pos.z);
    if (text === this.lastCoordsText) return;
    this.lastCoordsText = text;
    const el = $('#minimap-coords');
    if (el) el.textContent = text;
  }

  // Build the compass rose-label pool once. Each of the 8 points gets a span
  // that we later slide horizontally; positioning happens in updateCompass().
  private initCompass(): void {
    const track = $('#compass-track');
    if (!track) return;
    const ids: CardinalId[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    for (const id of ids) {
      const el = document.createElement('span');
      el.className = `compass-mark${id.length === 1 ? ' major' : ''}`;
      el.textContent = t(`hudChrome.compass.${id}`);
      track.appendChild(el);
      this.compassMarks.set(id, el);
    }
    this.compassHeadingEl = $('#compass-heading');
  }

  private updateCompass(): void {
    if (this.compassMarks.size === 0) return;
    const view = compassView(this.sim.player.facing);
    const visible = new Set<string>();
    for (const m of view.marks) {
      const el = this.compassMarks.get(m.label);
      if (!el) continue;
      visible.add(m.label);
      // offsetFrac -1..1 → 0..100% across the strip; fade marks near the edges
      el.style.left = `${(m.offsetFrac * 0.5 + 0.5) * 100}%`;
      el.style.opacity = `${Math.max(0.2, 1 - Math.abs(m.offsetFrac) * 0.85)}`;
      el.style.display = 'block';
    }
    for (const [label, el] of this.compassMarks) {
      if (!visible.has(label)) el.style.display = 'none';
    }
    if (this.compassHeadingEl && view.heading !== this.lastCompassHeading) {
      this.lastCompassHeading = view.heading;
      this.compassHeadingEl.textContent = t(`hudChrome.compass.${view.heading}`);
    }
  }

  // Build the minimap zoom control: load the persisted level, wire the +/-
  // buttons and a scroll-wheel handler over the minimap canvas. Pure DOM glue;
  // all stepping/clamping math lives in minimap_zoom.ts.
  private initMinimapZoom(mm: HTMLElement): void {
    const saved = Number(localStorage.getItem('minimapZoom'));
    this.minimapZoom = clampMinimapZoom(saved);
    this.minimapZoomLabel = $('#minimap-zoom-label');
    const inBtn = document.querySelector('#minimap-zoom-in');
    const outBtn = document.querySelector('#minimap-zoom-out');
    inBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setMinimapZoom(nextMinimapZoom(this.minimapZoom, +1));
    });
    outBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setMinimapZoom(nextMinimapZoom(this.minimapZoom, -1));
    });
    // scroll over the minimap to zoom (up = in), without scrolling the page
    mm.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.setMinimapZoom(
          nextMinimapZoom(this.minimapZoom, (e as WheelEvent).deltaY < 0 ? +1 : -1),
        );
      },
      { passive: false },
    );
    this.syncMinimapZoomUi();
  }

  private setMinimapZoom(z: number): void {
    const next = clampMinimapZoom(z);
    if (next === this.minimapZoom) return;
    this.minimapZoom = next;
    localStorage.setItem('minimapZoom', String(next));
    this.syncMinimapZoomUi();
  }

  // Reflect the current zoom in the readout and disable the +/- buttons at the
  // ends so the control communicates its own limits.
  private syncMinimapZoomUi(): void {
    if (this.minimapZoomLabel)
      this.minimapZoomLabel.textContent = `${formatNumber(minimapZoomValue(this.minimapZoom), { maximumFractionDigits: 1 })}×`;
    const inBtn = document.querySelector('#minimap-zoom-in') as HTMLButtonElement | null;
    const outBtn = document.querySelector('#minimap-zoom-out') as HTMLButtonElement | null;
    if (inBtn) inBtn.disabled = isMaxMinimapZoom(this.minimapZoom);
    if (outBtn) outBtn.disabled = isMinMinimapZoom(this.minimapZoom);
  }

  private updateMinimap(): void {
    const ctx = this.minimapCtx;
    const S = 162;
    const p = this.sim.player;
    const run = this.sim.delveRun;
    const inDelve = isDelvePos(p.pos.x);

    // Area label: delve module name or overworld zone name
    if (inDelve && run) {
      const modId = run.modules[run.moduleIndex];
      const delveName = delveDisplayName(run.delveId);
      const modName = modId ? t(`delveUi.moduleName.${modId}` as TranslationKey) : '';
      $('#zone-label').textContent = delveAreaLabel(delveName, modName);
    } else {
      $('#zone-label').textContent = zoneDisplayName(zoneAt(p.pos.z).id);
    }

    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;

    if (inDelve && run) {
      // Draw delve schematic instead of overworld terrain
      const modId = run.modules[run.moduleIndex];
      const layoutId = (modId ?? 'reliquary_sunken_ossuary') as DelveModuleId;
      const layout =
        DELVE_MODULE_LAYOUTS[layoutId] ?? DELVE_MODULE_LAYOUTS.reliquary_sunken_ossuary;
      const pad = 8;

      // Rebuild static background only when module changes
      if (!this.delveSchematicBg || this.delveSchematicBgModuleId !== layoutId) {
        const bgCanvas = document.createElement('canvas');
        bgCanvas.width = S;
        bgCanvas.height = S;
        const bgCtx = bgCanvas.getContext('2d')!;
        // Dark room fill behind everything
        bgCtx.fillStyle = '#0e0c0a';
        bgCtx.fillRect(0, 0, S, S);
        drawSchematicPrimitives(bgCtx, delveSchematicStatic(layout, S, pad));
        this.delveSchematicBg = bgCanvas;
        this.delveSchematicBgModuleId = layoutId;
      }
      ctx.drawImage(this.delveSchematicBg, 0, 0);

      // Entity overlay (mobs and party only -- no NPCs/loot inside delves for simplicity)
      const { localX: pLocalX, localZ: pLocalZ } = playerDelveLocal(p.pos.x, p.pos.z, run.origin);
      for (const e of this.sim.entities.values()) {
        if (e.id === p.id) continue;
        if (e.kind !== 'mob' || e.dead) continue;
        const elocalX = e.pos.x - run.origin.x;
        const elocalZ = e.pos.z - run.origin.z;
        // Map from module-local to the same toCanvas space (mirror X for map-left)
        const ex = pad + ((23 - elocalX) / 46) * (S - pad * 2);
        const ey = pad + ((elocalZ - layout.zMin) / (layout.zMax - layout.zMin)) * (S - pad * 2);
        if (ex < 0 || ex > S || ey < 0 || ey > S) continue;
        ctx.fillStyle = e.aggroTargetId === p.id ? '#ff8800' : '#e74c3c';
        ctx.fillRect(ex - 1.5, ey - 1.5, 3, 3);
      }

      // Party members in the delve
      const party = this.sim.partyInfo;
      if (party) {
        for (const m of party.members) {
          if (m.pid === p.id) continue;
          const mlx = m.x - run.origin.x;
          const mlz = m.z - run.origin.z;
          const mx = pad + ((23 - mlx) / 46) * (S - pad * 2);
          const my = pad + ((mlz - layout.zMin) / (layout.zMax - layout.zMin)) * (S - pad * 2);
          if (mx < 0 || mx > S || my < 0 || my > S) continue;
          const color = m.dead ? '#9a9a9a' : classCss(m.cls);
          ctx.fillStyle = color;
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(mx, my, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }

      // Player arrow (schematic uses absolute canvas position from delveSchematicPlayer)
      const arrow = delveSchematicPlayer(pLocalX, pLocalZ, p.facing, layout, S, pad);
      ctx.save();
      ctx.translate(arrow.cx, arrow.cy);
      ctx.rotate(arrow.angle);
      ctx.fillStyle = arrow.fill;
      ctx.strokeStyle = arrow.stroke;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -arrow.size);
      ctx.lineTo(arrow.size * 0.6, arrow.size * 0.8);
      ctx.lineTo(-arrow.size * 0.6, arrow.size * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      ctx.restore();
      return;
    }

    // 1.7 is the historical base scale; the zoom multiplier shrinks the world
    // radius shown so markers spread out as you zoom in (default 1 = unchanged).
    const pxPerYard = 1.7 * this.minimapZoom;
    const bg = this.minimapBg;
    const bgPxPerYard = bg.width / (WORLD_MAX_X - WORLD_MIN_X);
    const sw = S / (pxPerYard / bgPxPerYard);
    const sx = (WORLD_MAX_X - p.pos.x) * bgPxPerYard - sw / 2; // bg is +X-left
    const sy = (WORLD_MAX_Z - p.pos.z) * bgPxPerYard - sw / 2;
    ctx.drawImage(bg, sx, sy, sw, sw, 0, 0, S, S);

    // friend/guild lookup for colouring nearby allies (party markers are drawn
    // separately below, so skip party members here to avoid double dots)
    const social = this.sim.socialInfo;
    const friendNames = social
      ? new Set(social.friends.filter((f) => f.online).map((f) => f.name))
      : null;
    const guildNames = social?.guild ? new Set(social.guild.members.map((m) => m.name)) : null;
    const partyPids = this.sim.partyInfo
      ? new Set(this.sim.partyInfo.members.map((m) => m.pid))
      : null;

    for (const e of this.sim.entities.values()) {
      if (e.id === p.id) continue;
      const dx = -(e.pos.x - p.pos.x) * pxPerYard; // +X is map-left
      const dz = -(e.pos.z - p.pos.z) * pxPerYard;
      const mx = S / 2 + dx,
        my = S / 2 + dz;
      if ((mx - S / 2) ** 2 + (my - S / 2) ** 2 > (S / 2 - 7) ** 2) continue;
      if (e.kind === 'player' && !partyPids?.has(e.id)) {
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
        const hasAvail = e.questIds.some(
          (q) => QUESTS[q].giverNpcId === e.templateId && this.sim.questState(q) === 'available',
        );
        const hasReady = e.questIds.some(
          (q) => isQuestTurnInNpc(QUESTS[q], e.templateId) && this.sim.questState(q) === 'ready',
        );
        ctx.fillStyle = '#ffd100';
        ctx.font = 'bold 11px Georgia';
        ctx.fillText(hasReady ? '?' : hasAvail ? '!' : '•', mx - 2, my + 3);
      } else if (
        e.kind === 'object' &&
        (e.templateId === 'dungeon_door' || e.templateId === 'dungeon_exit')
      ) {
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
          ctx.moveTo(6, 0);
          ctx.lineTo(-4, 4.5);
          ctx.lineTo(-4, -4.5);
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
          if (!m.dead) {
            // bright inner pip so members pop against terrain
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
    ctx.moveTo(0, -7);
    ctx.lineTo(4.5, 5.5);
    ctx.lineTo(-4.5, 5.5);
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
    if (el.style.display === 'block') {
      el.style.display = 'none';
      return;
    }
    this.closeOtherWindows('#arena-window');
    el.style.display = 'block';
    this.lastArenaSig = '';
    this.fetchArenaLeaderboard(this.arenaBracket);
    this.renderArenaWindow();
  }

  // Best-effort all-time ladder pull. Throttled; silently no-ops offline (no
  // server) so the panel still shows the live online ladder either way.
  private fetchArenaLeaderboard(format: ArenaFormat): void {
    const now = performance.now();
    if (now - (this.arenaLbFetchedAt[format] ?? 0) < 15000) return;
    this.arenaLbFetchedAt[format] = now;
    fetch(`/api/arena/leaderboard?format=${encodeURIComponent(format)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.leaders)) {
          this.arenaAllTime[format] = d.leaders;
          this.lastArenaSig = '';
        }
      })
      .catch(() => {
        /* offline or no server — live ladder only */
      });
  }

  private renderArenaWindow(): void {
    const el = $('#arena-window');
    const a = this.sim.arenaInfo;
    if (!a) {
      // offline / not yet synced: arena is an online ranked feature
      el.innerHTML =
        `<div class="panel-title"><span>${esc(t('hud.arena.title'))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('hud.arena.close'))}">${svgIcon('close')}</button></div>` +
        `<div class="arena-note">${esc(t('hud.arena.offlineNote'))}</div>`;
      el.querySelector('[data-close]')?.addEventListener('click', () => {
        el.style.display = 'none';
      });
      return;
    }
    const inMatch = a.match !== null;
    const queuedFmt = a.queued ? a.format : null;
    const bracket = a.match?.format ?? queuedFmt ?? this.arenaBracket;
    if (queuedFmt || a.match) this.arenaBracket = bracket;
    const canSwitchBracket = !a.queued && !inMatch;
    const standing = a.standings[bracket];
    const ladderRows = a.ladders[bracket];
    const myPid = this.sim.playerId;
    const party = this.sim.partyInfo;
    const partySize = party?.members.length ?? 1;
    const isLeader = !party || party.leader === myPid;

    const ladder =
      ladderRows
        .map((r, i) => {
          const me = r.pid === myPid;
          const classId = r.cls as PlayerClass;
          const cls = CLASSES[classId] ? classDisplayName(classId) : r.cls;
          return (
            `<div class="ladder-row${me ? ' me' : ''}"><span class="rank">${esc(formatNumber(i + 1, { maximumFractionDigits: 0 }))}</span>` +
            `<span class="lr-name" title="${esc(t('hud.arena.playerClassTitle', { name: r.name, className: cls }))}">${esc(r.name)}</span>` +
            `<span class="lr-rating">${esc(formatNumber(r.rating, { maximumFractionDigits: 0 }))}</span>` +
            `<span class="lr-wl">${esc(formatNumber(r.wins, { maximumFractionDigits: 0 }))}-${esc(formatNumber(r.losses, { maximumFractionDigits: 0 }))}</span></div>`
          );
        })
        .join('') || `<div class="ladder-empty">${esc(t('hud.arena.noChallengers'))}</div>`;

    const bracketLabel = (fmt: ArenaFormat) => (fmt === 'fiesta' ? t('fiesta.bracket') : fmt);
    const bracketBtn = (fmt: ArenaFormat) => {
      const active = bracket === fmt;
      const locked = !canSwitchBracket && !active;
      const fiestaCls = fmt === 'fiesta' ? ' fiesta' : '';
      return `<button class="arena-bracket${fiestaCls}${active ? ' active' : ''}${locked ? ' locked' : ''}" data-bracket="${fmt}" aria-pressed="${active ? 'true' : 'false'}"${locked ? ' disabled' : ''}>${esc(bracketLabel(fmt))}</button>`;
    };
    const bracketTabs = `<div class="arena-brackets">${bracketBtn('1v1')}${bracketBtn('2v2')}${bracketBtn('fiesta')}</div>`;
    const isTeamBracket = bracket === '2v2' || bracket === 'fiesta';

    let partySection = '';
    if (isTeamBracket && !inMatch && !a.queued) {
      if (party && partySize === 2) {
        const rows = party.members
          .map((m) => {
            const cls = CLASSES[m.cls] ? classDisplayName(m.cls) : m.cls;
            const me = m.pid === myPid ? ' me' : '';
            return (
              `<div class="arena-party-row${me}"><span class="apr-name">${esc(m.name)}</span>` +
              `<span class="apr-meta">${esc(
                t('hud.arena.levelClass', {
                  level: formatNumber(m.level, { maximumFractionDigits: 0 }),
                  className: cls,
                }),
              )}</span></div>`
            );
          })
          .join('');
        partySection = `<div class="arena-party">${rows}</div>`;
      } else if (party && partySize > 2) {
        partySection = `<div class="arena-note arena-warn">${esc(t('hud.arena.queueNote'))}</div>`;
      }
    }

    let action: string;
    if (inMatch) {
      action = `<div class="arena-queue-status">${svgIcon('arena')} ${esc(t('hud.arena.matchInProgress', { name: a.match?.oppName ?? '' }))}</div>`;
    } else if (a.queued) {
      action =
        `<button class="btn leave" data-act="leave">${esc(t('hud.arena.leaveQueue'))}</button>` +
        `<div class="arena-queue-status">${esc(t('hud.arena.searching', { count: formatNumber(a.queueSize, { maximumFractionDigits: 0 }) }))}</div>`;
    } else {
      let queueDisabled = false;
      if (isTeamBracket && party && partySize === 2 && !isLeader) {
        queueDisabled = true;
      } else if (isTeamBracket && party && partySize > 2) {
        queueDisabled = true;
      } else if (bracket === '1v1' && party && partySize > 1) {
        queueDisabled = true;
      }
      const btnCls = queueDisabled ? 'btn disabled' : 'btn';
      const queueLabel = bracket === 'fiesta' ? t('fiesta.enterQueue') : t('hud.arena.enterQueue');
      action =
        `<button class="${btnCls}" data-act="queue"${queueDisabled ? ' disabled' : ''}>${esc(queueLabel)}</button>` +
        `<div class="arena-note">${esc(t('hud.arena.queueNote'))}</div>`;
    }

    // Offline dev affordance: practice Fiesta against bots (hidden online).
    let practiceSection = '';
    if (bracket === 'fiesta' && this.fiestaPracticeHook && !inMatch) {
      practiceSection =
        `<button class="btn fiesta-practice" data-act="practice">${esc(t('fiesta.practice'))}</button>` +
        `<div class="arena-note">${esc(t('fiesta.practiceNote'))}</div>`;
    }

    this.fetchArenaLeaderboard(bracket);
    const allTimeRows = this.arenaAllTime[bracket] ?? null;
    const allTime = (allTimeRows ?? [])
      .map((r, i) => {
        const me = r.name === this.sim.player.name;
        const classId = r.class as PlayerClass;
        const cls = CLASSES[classId] ? classDisplayName(classId) : r.class;
        return (
          `<div class="ladder-row${me ? ' me' : ''}"><span class="rank">${esc(formatNumber(i + 1, { maximumFractionDigits: 0 }))}</span>` +
          `<span class="lr-name" title="${esc(
            t('hud.arena.playerLevelClassTitle', {
              name: r.name,
              level: formatNumber(r.level, { maximumFractionDigits: 0 }),
              className: cls,
            }),
          )}">${esc(r.name)}</span>` +
          `<span class="lr-rating">${esc(formatNumber(r.rating, { maximumFractionDigits: 0 }))}</span>` +
          `<span class="lr-wl">${esc(formatNumber(r.wins, { maximumFractionDigits: 0 }))}-${esc(formatNumber(r.losses, { maximumFractionDigits: 0 }))}</span></div>`
        );
      })
      .join('');
    const allTimeSection =
      allTimeRows && allTimeRows.length > 0
        ? `<div class="arena-sub">${esc(t('hud.arena.ladderAllTime'))}</div>${allTime}`
        : '';

    const sig = JSON.stringify([
      standing,
      a.queued,
      a.queueSize,
      inMatch,
      ladderRows,
      allTimeRows,
      bracket,
      party,
      canSwitchBracket,
    ]);
    if (sig === this.lastArenaSig) return;
    this.lastArenaSig = sig;

    el.innerHTML =
      `<div class="panel-title"><span>${esc(t('hud.arena.title'))} <span class="arena-bracket-tag${bracket === 'fiesta' ? ' fiesta' : ''}">${esc(bracketLabel(bracket))}</span></span><button type="button" class="x-btn" data-close aria-label="${esc(t('hud.arena.close'))}">${svgIcon('close')}</button></div>` +
      bracketTabs +
      `<div class="arena-rank"><span class="rating">${esc(formatNumber(standing.rating, { maximumFractionDigits: 0 }))}</span>` +
      `<span class="wl">${esc(
        t('hud.arena.ratingSummary', {
          wins: formatNumber(standing.wins, { maximumFractionDigits: 0 }),
          losses: formatNumber(standing.losses, { maximumFractionDigits: 0 }),
        }),
      )}</span></div>` +
      partySection +
      action +
      practiceSection +
      `<div class="arena-sub">${esc(t('hud.arena.ladderOnline'))}</div>` +
      ladder +
      allTimeSection;

    el.querySelector('[data-close]')?.addEventListener('click', () => {
      el.style.display = 'none';
    });
    el.querySelectorAll('[data-bracket]:not([disabled])').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.arenaBracket = (btn as HTMLElement).dataset.bracket as ArenaFormat;
        this.lastArenaSig = '';
        this.renderArenaWindow();
        audio.click();
      });
    });
    el.querySelector('[data-act="queue"]:not([disabled])')?.addEventListener('click', () => {
      this.sim.arenaQueueJoin(bracket);
      audio.click();
    });
    el.querySelector('[data-act="leave"]')?.addEventListener('click', () => {
      this.sim.arenaQueueLeave();
      audio.click();
    });
    el.querySelector('[data-act="practice"]')?.addEventListener('click', () => {
      this.fiestaPracticeHook?.();
      this.lastArenaSig = '';
      audio.click();
    });
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
    const label =
      m.state === 'countdown'
        ? t('hud.arena.statusCountdown')
        : m.state === 'over'
          ? t('hud.arena.statusReturning', {
              seconds: formatNumber(m.returnIn ?? 0, { maximumFractionDigits: 0 }),
            })
          : t('hud.arena.statusFight');
    let vsBlock: string;
    if (m.format === '2v2') {
      const allyNames = [esc(t('hud.core.you')), ...m.allies.map((c) => esc(c.name))].join(' - ');
      const enemyNames = m.enemies.map((c) => esc(c.name)).join(' - ');
      const vs = esc(t('hud.arena.vsLine', { name: '' }).trim());
      vsBlock =
        `<div class="as-teams">` +
        `<div class="as-team allies"><span class="as-names">${allyNames}</span></div>` +
        `<div class="as-mid">${vs}</div>` +
        `<div class="as-team enemies"><span class="as-names">${enemyNames}</span></div>` +
        `</div>`;
    } else {
      const cls = CLASSES[m.oppClass] ? classDisplayName(m.oppClass) : m.oppClass;
      vsBlock = `<div class="as-vs">${svgIcon('arena')} ${esc(t('hud.arena.vsLine', { name: m.oppName }))} <span style="color:#b6ad8c;font-size:11px">${esc(
        t('hud.arena.levelClass', {
          level: formatNumber(m.oppLevel, { maximumFractionDigits: 0 }),
          className: cls,
        }),
      )}</span></div>`;
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
    if (el.style.display === 'block') {
      el.style.display = 'none';
      return;
    }
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
    else if (prev === 1 && !this.mapCenter)
      this.mapCenter = { x: this.sim.player.pos.x, z: this.sim.player.pos.z };
    if ($('#map-window').style.display === 'block') this.updateMapWindow();
  }

  // The map window shows the zone band the player is standing in (each band
  // is a square); POIs and dungeon portals come from the zone/dungeon data.
  private updateMapWindow(): void {
    const canvas = $('#map-canvas') as unknown as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const S = canvas.width;
    const p = this.sim.player;

    // --- Delve branch: render the module schematic instead of the overworld map
    const run = this.sim.delveRun;
    if (isDelvePos(p.pos.x) && run) {
      const modId = run.modules[run.moduleIndex];
      const layoutId = (modId ?? 'reliquary_sunken_ossuary') as DelveModuleId;
      const layout =
        DELVE_MODULE_LAYOUTS[layoutId] ?? DELVE_MODULE_LAYOUTS.reliquary_sunken_ossuary;
      const pad = Math.round(S * 0.06);

      // Rebuild static background only when module changes
      if (!this.delveMapBg || this.delveMapBgModuleId !== layoutId) {
        const bgCanvas = document.createElement('canvas');
        bgCanvas.width = S;
        bgCanvas.height = S;
        const bgCtx = bgCanvas.getContext('2d')!;
        bgCtx.fillStyle = '#0e0c0a';
        bgCtx.fillRect(0, 0, S, S);
        drawSchematicPrimitives(bgCtx, delveSchematicStatic(layout, S, pad));
        this.delveMapBg = bgCanvas;
        this.delveMapBgModuleId = layoutId;
      }

      ctx.clearRect(0, 0, S, S);
      ctx.drawImage(this.delveMapBg, 0, 0);

      // Map-local coordinate helper (mirrors local-to-canvas from delve_map.ts)
      const toDelveMap = (localX: number, localZ: number) => ({
        mx: pad + ((23 - localX) / 46) * (S - pad * 2),
        my: pad + ((localZ - layout.zMin) / (layout.zMax - layout.zMin)) * (S - pad * 2),
      });

      // Mob overlays
      for (const e of this.sim.entities.values()) {
        if (e.kind !== 'mob' || e.dead) continue;
        const { mx, my } = toDelveMap(e.pos.x - run.origin.x, e.pos.z - run.origin.z);
        if (mx < 0 || mx > S || my < 0 || my > S) continue;
        ctx.fillStyle = e.aggroTargetId === p.id ? '#ff8800' : '#e74c3c';
        ctx.fillRect(mx - 2, my - 2, 4, 4);
      }

      // Party members
      const party = this.sim.partyInfo;
      if (party) {
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        for (const m of party.members) {
          if (m.pid === p.id) continue;
          const { mx, my } = toDelveMap(m.x - run.origin.x, m.z - run.origin.z);
          if (mx < 0 || mx > S || my < 0 || my > S) continue;
          ctx.fillStyle = m.dead ? '#9a9a9a' : classCss(m.cls);
          ctx.beginPath();
          ctx.arc(mx, my, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }

      // Player arrow
      const { localX: pLocalX, localZ: pLocalZ } = playerDelveLocal(p.pos.x, p.pos.z, run.origin);
      const arrow = delveSchematicPlayer(pLocalX, pLocalZ, p.facing, layout, S, pad);
      ctx.save();
      ctx.translate(arrow.cx, arrow.cy);
      ctx.rotate(arrow.angle);
      ctx.fillStyle = arrow.fill;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -arrow.size);
      ctx.lineTo(arrow.size * 0.6, arrow.size * 0.8);
      ctx.lineTo(-arrow.size * 0.6, arrow.size * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Module title at top
      const delveName = delveDisplayName(run.delveId);
      const modName = modId ? t(`delveUi.moduleName.${modId}` as TranslationKey) : '';
      const areaLabel = delveAreaLabel(delveName, modName);
      ctx.font = 'bold 14px Georgia';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      ctx.fillStyle = '#ffe9a0';
      ctx.strokeText(areaLabel, S / 2, 6);
      ctx.fillText(areaLabel, S / 2, 6);
      ctx.textBaseline = 'alphabetic';
      return;
    }

    // inside an instance, show the zone the dungeon's door is in (dungeonAt
    // owns the instance x-band layout); outdoors, follow the committed zone
    // so border-straddling can't thrash the 280px canvas regen below
    const dungeon = dungeonAt(p.pos.x);
    const zone: ZoneDef = dungeon
      ? zoneAt(dungeon.doorPos.z)
      : (ZONES.find((z) => z.id === this.lastZoneId) ?? zoneAt(p.pos.z));
    const full = this.mapZoneRegion(zone);
    const mapBg = this.mapZoneBg(zone); // cached per zone; prewarmed during idle
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
    const region = {
      minX: cx - spanX / 2,
      maxX: cx + spanX / 2,
      minZ: cz - spanZ / 2,
      maxZ: cz + spanZ / 2,
    };
    this.mapView = {
      spanX,
      spanZ,
      minX: full.minX,
      maxX: full.maxX,
      minZ: full.minZ,
      maxZ: full.maxZ,
    };
    if (!this.mapDrag) canvas.style.cursor = this.mapZoom > 1 ? 'grab' : 'default';
    // blit the matching sub-rect of the cached terrain (note: +X is map-left)
    const bg = mapBg;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      bg,
      ((full.maxX - region.maxX) / fullSpanX) * bg.width,
      ((full.maxZ - region.maxZ) / fullSpanZ) * bg.height,
      (spanX / fullSpanX) * bg.width,
      (spanZ / fullSpanZ) * bg.height,
      0,
      0,
      S,
      S,
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
    zone.pois.forEach((poi, poiIndex) => {
      label(poi.x, poi.z, zonePoiLabel(zone.id, poiIndex));
    });
    // dungeon entrance portals in this zone (raids reached only through an
    // internal door share their parent's doorPos and carry no overworld portal,
    // so their label does not overlap the parent's, see overworldDungeonPortals)
    for (const portal of overworldDungeonPortals(DUNGEON_LIST, zone.zMin, zone.zMax)) {
      const { mx, my } = toMap(portal.x, portal.z);
      ctx.fillStyle = '#c084ff';
      ctx.beginPath();
      ctx.arc(mx, my, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e0c0ff';
      ctx.font = 'bold 12px Georgia';
      const dungeonName = dungeonDisplayName(portal.id);
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
      const hasAvail = e.questIds.some(
        (q) => QUESTS[q].giverNpcId === e.templateId && this.sim.questState(q) === 'available',
      );
      const hasReady = e.questIds.some(
        (q) => isQuestTurnInNpc(QUESTS[q], e.templateId) && this.sim.questState(q) === 'ready',
      );
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
      ctx.moveTo(0, -7);
      ctx.lineTo(5, 6);
      ctx.lineTo(-5, 6);
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
        if (
          !m.online ||
          m.x === undefined ||
          m.z === undefined ||
          m.name === selfName ||
          drawn.has(m.id)
        )
          return;
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
    const ppu =
      ((toMap(region.minX + 1, region.minZ).mx - toMap(region.minX, region.minZ).mx) ** 2) ** 0.5;

    // vegetation: pine/oak/rock scattered across the world (cached once)
    if (!this.mapDecorations) this.mapDecorations = generateDecorations(this.sim.cfg.seed);
    for (const d of this.mapDecorations) {
      if (!inView(d.x, d.z)) continue;
      const { mx, my } = toMap(d.x, d.z);
      if (d.kind === 'rock') {
        ctx.fillStyle = '#8c8b86';
        ctx.beginPath();
        ctx.arc(mx, my, Math.max(1.2, ppu * 0.5), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = d.kind === 'tree' ? '#2f6b34' : '#4f8c3a'; // pine darker, oak lighter
        const r = Math.max(1.6, ppu * 0.8);
        ctx.beginPath();
        ctx.arc(mx, my, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // buildings: rotated footprints (house/inn brown, chapel stone)
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#1a140a';
    for (const b of PROPS.buildings) {
      if (!inView(b.x, b.z)) continue;
      const c = Math.cos(b.rot),
        s = Math.sin(b.rot);
      const corner = (dx: number, dz: number) =>
        toMap(b.x + dx * c - dz * s, b.z + dx * s + dz * c);
      const p0 = corner(-b.w / 2, -b.d / 2),
        p1 = corner(b.w / 2, -b.d / 2);
      const p2 = corner(b.w / 2, b.d / 2),
        p3 = corner(-b.w / 2, b.d / 2);
      ctx.fillStyle = b.kind === 'chapel' ? '#9b9080' : b.kind === 'inn' ? '#8a6233' : '#7a5630';
      ctx.beginPath();
      ctx.moveTo(p0.mx, p0.my);
      ctx.lineTo(p1.mx, p1.my);
      ctx.lineTo(p2.mx, p2.my);
      ctx.lineTo(p3.mx, p3.my);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // smaller props as dots
    const dot = (x: number, z: number, color: string, r = Math.max(1.8, ppu * 0.7)) => {
      if (!inView(x, z)) return;
      const { mx, my } = toMap(x, z);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(mx, my, r, 0, Math.PI * 2);
      ctx.fill();
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

  // Prune spatial-audio state for entities that left interest without a clean
  // death/castStop (online interest churn, leash, despawn) — stops orphaned cast
  // loops and frees the aggro Set. Throttled (~10 Hz) from update().
  private reconcileSfx(): void {
    const sim = this.sim;
    if (this.mobAggroed.size) {
      for (const id of this.mobAggroed) if (!sim.entities.has(id)) this.mobAggroed.delete(id);
    }
    if (this.castLoopIds.size) {
      for (const id of this.castLoopIds) {
        const ent = sim.entities.get(id);
        if (!ent || ent.castingAbility === null) {
          sfx.unloop(`cast:${id}`, 0.2);
          this.castLoopIds.delete(id);
        }
      }
    }
  }

  // Spatial sound for a sim event — positioned at the relevant entity so nearby
  // players' and creatures' combat attenuates with distance and pans correctly.
  // Personal/UI sounds stay on the procedural audio.* path in handleEvents.
  // All combat/spell/creature SFX route through here so the whole layer can be
  // balanced with the single COMBAT_GAIN knob (kept under movement/ambience).
  private combat(
    key: string,
    x: number,
    y: number,
    z: number,
    gain: number,
    opts?: { rate?: number; cooldown?: number },
  ): void {
    sfx.playAt(key, x, y, z, {
      gain: gain * COMBAT_GAIN,
      rate: opts?.rate,
      cooldown: opts?.cooldown,
    });
  }

  private playEventSfx(ev: SimEvent): void {
    const sim = this.sim;
    switch (ev.type) {
      case 'damage': {
        const tgt = sim.entities.get(ev.targetId);
        if (!tgt) return;
        const tp = tgt.pos;
        if (ev.kind === 'miss' || ev.kind === 'dodge') {
          this.combat('combat_dodge', tp.x, tp.y, tp.z, 0.5);
          return;
        }
        if (ev.kind === 'parry') {
          this.combat('combat_parry', tp.x, tp.y, tp.z, 0.6);
          return;
        }
        const src = sim.entities.get(ev.sourceId);
        if (src) this.playAttackerSfx(src);
        // a struck mob vocalizes its aggro alert the first time it's engaged
        // (camp engage), whether you hit it or it hits you.
        if (tgt.kind === 'mob') this.ensureMobEngaged(tgt);
        const physical = !ev.school || ev.school === 'physical';
        if (shouldPlayCombatImpactForTarget(tgt)) {
          this.combat(
            physical ? materialImpactKey(tgt) : `impact_${ev.school}`,
            tp.x,
            tp.y,
            tp.z,
            0.75,
            { cooldown: 0.05 },
          );
        }
        if (ev.crit && shouldPlayCritSfxForTarget(tgt))
          this.combat('combat_crit', tp.x, tp.y, tp.z, 0.7);
        // pain vocalization only on a crit — never on ordinary hits.
        if (ev.crit && ev.targetId === sim.playerId) {
          this.combat('player_hurt', tp.x, tp.y, tp.z, 0.55, { cooldown: 0.3 });
        } else if (ev.crit && tgt.kind === 'mob' && shouldPlayCritSfxForTarget(tgt)) {
          const fam = mobVoiceFamily(tgt.templateId);
          if (fam && shouldPlayMobVoiceSfxForEntity(tgt))
            this.combat(`mob_${fam}_attack`, tp.x, tp.y, tp.z, 0.6, { rate: 1.25, cooldown: 0.1 });
        }
        return;
      }
      case 'castStart': {
        const ent = sim.entities.get(ev.entityId);
        const key = castKeyForAbility(ev.ability);
        if (ent && key) {
          sfx.loop(`cast:${ev.entityId}`, key, 0.45 * COMBAT_GAIN, ent.pos.x, ent.pos.y, ent.pos.z);
          this.castLoopIds.add(ev.entityId);
        }
        return;
      }
      case 'castStop':
        sfx.unloop(`cast:${ev.entityId}`, 0.2);
        this.castLoopIds.delete(ev.entityId);
        return;
      case 'spellfx': {
        if (ev.fx === 'projectile') {
          const s = sim.entities.get(ev.sourceId);
          if (s) this.combat(`proj_${ev.school}`, s.pos.x, s.pos.y, s.pos.z, 0.55);
        } else if (ev.fx === 'nova') {
          const e = sim.entities.get(ev.sourceId) ?? sim.entities.get(ev.targetId);
          if (e) this.combat('spell_nova', e.pos.x, e.pos.y, e.pos.z, 0.6);
        }
        return;
      }
      case 'heal':
      case 'heal2': {
        const tgt = sim.entities.get(ev.targetId);
        if (tgt)
          this.combat('heal_impact', tgt.pos.x, tgt.pos.y, tgt.pos.z, 0.45, { cooldown: 0.1 });
        return;
      }
      case 'aura': {
        if (ev.targetId !== sim.playerId) return; // only your own buffs/debuffs, else it's spammy
        const p = sim.player.pos;
        this.combat(ev.gained ? 'buff_apply' : 'debuff_apply', p.x, p.y, p.z, 0.4, {
          cooldown: 0.1,
        });
        return;
      }
      case 'death': {
        sfx.unloop(`cast:${ev.entityId}`, 0);
        this.castLoopIds.delete(ev.entityId);
        const ent = sim.entities.get(ev.entityId);
        if (!ent) return;
        const p = ent.pos;
        if (ent.kind === 'mob') {
          this.mobAggroed.delete(ev.entityId);
          const fam = mobVoiceFamily(ent.templateId);
          if (fam && shouldPlayMobVoiceSfxForEntity(ent))
            this.combat(`mob_${fam}_death`, p.x, p.y, p.z, 0.8);
        } else if (ent.kind === 'player' && ev.entityId !== sim.playerId) {
          this.combat('player_death', p.x, p.y, p.z, 0.7);
        }
        return;
      }
    }
  }

  // First contact with a mob (it hits you, or you hit it) plays its aggro alert
  // once — the "engage" sound. Returns true if this call fired it. Cleared on
  // death / when the mob leaves interest (reconcileSfx).
  private ensureMobEngaged(mob: Entity): boolean {
    if (this.mobAggroed.has(mob.id)) return false;
    this.mobAggroed.add(mob.id);
    const fam = mobVoiceFamily(mob.templateId);
    if (fam && shouldPlayMobVoiceSfxForEntity(mob))
      this.combat(`mob_${fam}_aggro`, mob.pos.x, mob.pos.y, mob.pos.z, 0.7);
    return true;
  }

  // Attacker side of a damage event: a creature roars on engage then grunts on
  // subsequent strikes; a player swings their weapon.
  private playAttackerSfx(src: Entity): void {
    if (src.kind === 'mob') {
      if (this.ensureMobEngaged(src)) return; // just fired the aggro alert
      const fam = mobVoiceFamily(src.templateId);
      if (fam && shouldPlayMobVoiceSfxForEntity(src))
        this.combat(`mob_${fam}_attack`, src.pos.x, src.pos.y, src.pos.z, 0.55, { cooldown: 0.25 });
    } else if (src.kind === 'player') {
      this.combat(weaponSwingKey(src.templateId), src.pos.x, src.pos.y, src.pos.z, 0.5, {
        cooldown: 0.08,
      });
    }
  }

  private isNythraxisEntity(id: number | null | undefined): boolean {
    if (id === null || id === undefined) return false;
    const e = this.sim.entities.get(id);
    return (
      e?.templateId === 'nythraxis_scourge_of_thornpeak' ||
      e?.templateId === 'nythraxis_skeleton_warrior'
    );
  }

  private isNythraxisEvent(ev: SimEvent): boolean {
    if ('sourceId' in ev && this.isNythraxisEntity(ev.sourceId)) return true;
    if ('targetId' in ev && this.isNythraxisEntity(ev.targetId)) return true;
    if ('entityId' in ev && this.isNythraxisEntity(ev.entityId)) return true;
    return false;
  }

  handleEvents(events: SimEvent[]): void {
    const sim = this.sim;
    for (const ev of events) {
      // visual effects (swings, projectiles, glows) — for everyone nearby,
      // not just events involving this player
      this.renderer.handleEvent(ev);
      this.playEventSfx(ev); // positional sound for nearby combat/creatures
      this.meters.onEvent(ev);
      if (this.isNythraxisEvent(ev)) this.lastNythraxisCombatEventAt = performance.now();
      switch (ev.type) {
        case 'damage': {
          const src = sim.entities.get(ev.sourceId);
          const tgt = sim.entities.get(ev.targetId);
          if (!tgt) break;
          const isPlayerSource = ev.sourceId === sim.playerId;
          const isPlayerTarget = ev.targetId === sim.playerId;
          if (isPlayerSource || isPlayerTarget) this.lastCombatEventAt = performance.now();
          if (ev.kind === 'miss' || ev.kind === 'dodge') {
            this.fct(
              tgt,
              ev.kind === 'miss' ? t('hud.combat.floatingMiss') : t('hud.combat.floatingDodge'),
              isPlayerTarget ? '#bbb' : '#fff',
              false,
            );
            // Fiesta: a dodge is a moment — pop a big exaggerated word for it.
            if (ev.kind === 'dodge' && (isPlayerSource || isPlayerTarget) && this.inFiesta()) {
              this.fiestaWordPop(t('fiesta.word.dodge'), '#7fd4ff', 1);
              this.renderer.addShake(0.15);
            }
            if (isPlayerSource) {
              this.combatLog(
                t(ev.kind === 'miss' ? 'hud.combat.miss' : 'hud.combat.dodged', {
                  ability: combatAbilityName(ev.ability),
                  target: entityDisplayName(tgt),
                }),
                '#ccc',
              );
            }
            break;
          }
          if (isPlayerSource && !isPlayerTarget) {
            const color = ev.ability ? '#ffe97a' : '#fff';
            this.fct(tgt, `${ev.amount}${ev.crit ? '!' : ''}`, color, ev.crit);
            this.combatLog(
              t(ev.crit ? 'hud.combat.damageDoneCrit' : 'hud.combat.damageDone', {
                ability: combatAbilityName(ev.ability),
                target: entityDisplayName(tgt),
                amount: ev.amount,
              }),
              ev.ability ? '#ffe97a' : '#eee',
            );
            // combat SFX (swing + material/school impact + crit) is spatial now —
            // see playEventSfx, which runs for every damage event above.
            // Fiesta: every blow you land kicks the camera (bigger on a crit).
            if (this.inFiesta()) this.renderer.addShake(ev.crit ? 0.3 : 0.12);
          } else if (isPlayerTarget) {
            this.fct(tgt, `-${ev.amount}`, '#ff5544', ev.crit);
            this.combatLog(
              t(ev.crit ? 'hud.combat.damageTakenCrit' : 'hud.combat.damageTaken', {
                source: src ? entityDisplayName(src) : '?',
                amount: ev.amount,
              }),
              '#ff8877',
            );
            // player-hit SFX is spatial now (see playEventSfx). Keep the Fiesta kick.
            if (this.inFiesta()) this.renderer.addShake(ev.crit ? 0.34 : 0.14);
          }
          break;
        }
        case 'heal': {
          if (ev.amount > 0) {
            const healed =
              ev.targetId === sim.playerId ? sim.player : sim.entities.get(ev.targetId);
            if (healed) this.fct(healed, `+${ev.amount}`, '#3ce63c', false);
          }
          break;
        }
        case 'death': {
          const e = sim.entities.get(ev.entityId);
          if (e && ev.entityId !== sim.playerId)
            this.combatLog(t('hud.combat.death', { name: entityDisplayName(e) }), '#aaa');
          break;
        }
        case 'xp': {
          this.fct(sim.player, t('hud.core.xpFloat', { amount: ev.amount }), '#b974ff', false);
          if (ev.rested && ev.rested > 0) {
            this.fct(
              sim.player,
              t('hud.core.xpFloatRested', { amount: ev.rested }),
              '#4a9eff',
              false,
            );
            this.log(
              t('hud.core.xpGainRested', { amount: ev.amount, rested: ev.rested }),
              '#a980d8',
            );
          } else {
            this.log(t('hud.core.xpGain', { amount: ev.amount }), '#a980d8');
          }
          break;
        }
        case 'levelup': {
          this.showBanner(t('hud.core.levelBanner', { level: ev.level }));
          this.log(t('hud.core.levelLog', { level: ev.level }), '#ffd100');
          audio.levelUp();
          if (ev.level === 5) trackMetaPixel('ReachedLevel5', { level: ev.level });
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
        case 'learnAbility':
          break; // logged by sim
        case 'comboPoint':
          break;
        case 'loot': {
          this.log(this.localizeLootText(ev.text), '#7fdc4f');
          if (/ wins .+ \(\d+\)$/.test(ev.text) || /^Everyone passed on .+\.$/.test(ev.text))
            this.closeLootRollsForItem(ev.text);
          if (
            ev.text.includes('loot') ||
            ev.text.includes('Sold') ||
            ev.text.includes('Bought back')
          )
            audio.coin();
          else audio.lootItem();
          if ($('#bags').style.display !== 'none') this.renderBags();
          break;
        }
        case 'lootRoll': {
          this.showLootRoll(ev);
          break;
        }
        case 'vendor': {
          if ($('#bags').style.display !== 'none') this.renderBags();
          if (this.openVendorNpcId !== null) this.renderVendor();
          // A delve Marks purchase rides the same 'vendor' event; refresh the shop
          // tab so the balance and per-offer affordability update after a buy.
          if (this.openDelveBoardNpcId !== null) this.renderDelveBoard();
          break;
        }
        case 'skinEvent':
          this.openSkinEvent(ev.rank, ev.catalog === 'mech' ? { mech: true } : undefined);
          break;
        case 'error':
          this.showError(this.localizeErrorText(ev.text));
          break;
        case 'questAccepted':
          audio.questAccept();
          this.refreshGossip();
          break;
        case 'questProgress':
          this.log(this.localizeQuestProgressText(ev.questId, ev.text), '#dcd29f');
          this.refreshGossip();
          break;
        case 'questReady': {
          this.showBanner(
            t('questUi.logs.ready', {
              name: questTitle(ev.questId),
              status: t('questUi.log.readyStatus'),
            }),
          );
          audio.questDone();
          this.refreshGossip();
          break;
        }
        case 'questDone':
          audio.questDone();
          this.refreshGossip();
          break;
        case 'chat': {
          if (this.isChatIgnored(ev.from)) break;
          switch (ev.channel) {
            case 'party':
              this.chatLogFrom(
                ev.from,
                ev.text,
                '#7fd4ff',
                CHAT_TEMPLATE_KEYS.party,
                'party',
                ev.fromPid,
              );
              break;
            case 'yell':
              this.chatLogFrom(
                ev.from,
                ev.text,
                '#ff5040',
                CHAT_TEMPLATE_KEYS.yell,
                'yell',
                ev.fromPid,
              );
              break;
            case 'whisper':
              if (ev.to)
                this.chatLogFrom(
                  ev.to,
                  ev.text,
                  '#ff80ff',
                  CHAT_TEMPLATE_KEYS.toWhisper,
                  'whisper',
                  ev.fromPid,
                );
              else {
                this.chatLogFrom(
                  ev.from,
                  ev.text,
                  '#ff80ff',
                  CHAT_TEMPLATE_KEYS.whisper,
                  'whisper',
                  ev.fromPid,
                );
                audio.whisper();
              }
              break;
            case 'general':
              this.chatLogFrom(
                ev.from,
                ev.text,
                '#ffc864',
                CHAT_TEMPLATE_KEYS.general,
                'general',
                ev.fromPid,
              );
              break;
            case 'world':
              this.chatLogFrom(
                ev.from,
                ev.text,
                '#ff9d5c',
                CHAT_TEMPLATE_KEYS.world,
                'world',
                ev.fromPid,
              );
              break;
            case 'lfg':
              this.chatLogFrom(
                ev.from,
                ev.text,
                '#5cd6a0',
                CHAT_TEMPLATE_KEYS.lfg,
                'lfg',
                ev.fromPid,
              );
              break;
            case 'guild':
              this.chatLogFrom(
                ev.from,
                ev.text,
                '#40d264',
                CHAT_TEMPLATE_KEYS.guild,
                'guild',
                ev.fromPid,
              );
              break;
            case 'officer':
              this.chatLogFrom(
                ev.from,
                ev.text,
                '#4ce0c0',
                CHAT_TEMPLATE_KEYS.officer,
                'officer',
                ev.fromPid,
              );
              break;
            case 'emote':
              this.chatLogFrom(
                ev.from,
                ev.text,
                '#ff8040',
                CHAT_TEMPLATE_KEYS.emote,
                'emote',
                ev.fromPid,
              );
              break;
            case 'roll':
              this.chatLogFrom(
                ev.from,
                ev.text,
                '#ffd100',
                CHAT_TEMPLATE_KEYS.roll,
                'roll',
                ev.fromPid,
              );
              break;
            default:
              this.chatLogFrom(
                ev.from,
                ev.text,
                '#f0ead8',
                CHAT_TEMPLATE_KEYS.say,
                'say',
                ev.fromPid,
              );
              break;
          }
          if (
            (ev.channel === 'say' || ev.channel === 'yell' || ev.channel === 'emote') &&
            ev.entityId !== undefined
          ) {
            const masked = this.maskChat(this.questLinkPlainText(ev.text));
            const bubble = ev.channel === 'emote' ? `${ev.from} ${masked}` : masked;
            this.renderer.showChatBubble(ev.entityId, bubble, ev.channel === 'yell');
          }
          // Voiced encounter dialogue (boss/NPC yells) — no-op unless a clip was
          // generated for this exact line (scripts/voices/extra_lines.mjs).
          if (ev.channel === 'yell') {
            const voiced = nextVoicedYell(
              this.lastVoicedYell,
              yellVoiceKey(ev.text),
              performance.now(),
            );
            this.lastVoicedYell = voiced.state;
            if (voiced.play) voice.play(voiced.state.key, { gain: voicedYellGain(ev.from) });
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
              this.combatLog(
                t(
                  selfTarget
                    ? ev.crit
                      ? 'hud.combat.healSelfCrit'
                      : 'hud.combat.healSelf'
                    : ev.crit
                      ? 'hud.combat.healOtherCrit'
                      : 'hud.combat.healOther',
                  {
                    ability: abilityDisplayNameFromSource(ev.ability),
                    target: entityDisplayName(tgt),
                    amount: ev.amount,
                  },
                ),
                '#7fdc4f',
              );
            }
          }
          break;
        }
        case 'partyInvite':
          audio.questAccept();
          this.showPrompt(
            t('hud.prompts.partyInvite', { name: `<b>${esc(ev.fromName)}</b>` }),
            t('hud.prompts.joinParty'),
            () => this.sim.partyAccept(),
            () => this.sim.partyDecline(),
          );
          break;
        case 'guildInvite':
          audio.questAccept();
          this.showPrompt(
            t('hud.prompts.guildInvite', {
              name: `<b>${esc(ev.fromName)}</b>`,
              guild: `<span class="gold">&lt;${esc(ev.guildName)}&gt;</span>`,
            }),
            t('hud.prompts.joinGuild'),
            () => this.sim.guildAccept(),
            () => this.sim.guildDecline(),
          );
          break;
        case 'tradeRequest':
          audio.click();
          this.showPrompt(
            t('hud.prompts.tradeRequest', { name: `<b>${esc(ev.fromName)}</b>` }),
            t('hud.prompts.openTrade'),
            () => this.sim.tradeAccept(),
            () => {
              /* let it expire */
            },
          );
          break;
        case 'duelRequest':
          audio.duelChallenge();
          this.showPrompt(
            t('hud.prompts.duelRequest', { name: `<b>${esc(ev.fromName)}</b>` }),
            t('hud.prompts.acceptDuel'),
            () => this.sim.duelAccept(),
            () => this.sim.duelDecline(),
          );
          break;
        case 'duelCountdown':
          this.showBanner(t('hud.system.duelCountdown', { seconds: ev.seconds }));
          audio.duelCountdownTick();
          break;
        case 'duelStart':
          audio.duelStart();
          break;
        case 'duelEnd':
          this.showBanner(
            t('hud.system.duelEndBanner', { winner: ev.winnerName, loser: ev.loserName }),
          );
          this.combatLog(
            t('hud.system.duelEndLog', { winner: ev.winnerName, loser: ev.loserName }),
            '#fa6',
          );
          audio.duelEnd();
          break;
        case 'arenaQueued':
          this.log(
            t('hud.system.arenaQueued', {
              position: formatNumber(ev.position, { maximumFractionDigits: 0 }),
            }),
            '#ffa040',
          );
          break;
        case 'arenaUnqueued':
          this.log(t('hud.system.arenaUnqueued'), '#ffa040');
          break;
        case 'arenaFound': {
          const name =
            ev.enemies.length > 1 ? ev.enemies.map((e) => e.name).join(' & ') : ev.oppName;
          const cls = CLASSES[ev.oppClass] ? classDisplayName(ev.oppClass) : ev.oppClass;
          this.showBanner(t('hud.system.arenaFoundBanner', { name }));
          this.log(
            t('hud.system.arenaFoundLog', {
              name,
              level: formatNumber(ev.oppLevel, { maximumFractionDigits: 0 }),
              className: cls,
            }),
            '#ffa040',
          );
          audio.duelChallenge();
          break;
        }
        case 'arenaCountdown':
          this.showBanner(
            t('hud.system.arenaCountdown', {
              seconds: formatNumber(ev.seconds, { maximumFractionDigits: 0 }),
            }),
          );
          audio.duelCountdownTick();
          break;
        case 'arenaStart':
          this.showBanner(t('hud.system.arenaStart'));
          audio.duelStart();
          break;
        case 'arenaEnd': {
          if (ev.format === 'fiesta') {
            if (ev.draw) {
              this.showBanner(t('fiesta.end.draw'));
              this.combatLog(t('fiesta.end.draw'), '#fa6');
            } else if (ev.won) {
              this.showBanner(t('fiesta.end.win'));
              this.combatLog(t('fiesta.end.win'), '#7fdc4f');
              audio.fiestaWave();
            } else {
              this.showBanner(t('fiesta.end.loss'));
              this.combatLog(t('fiesta.end.loss'), '#ff7a6a');
              audio.death();
            }
            break;
          }
          const delta = ev.ratingAfter - ev.ratingBefore;
          const sign = delta >= 0 ? '+' : '';
          const ratingDelta = `${sign}${formatNumber(delta, { maximumFractionDigits: 0 })}`;
          const ratingAfter = formatNumber(ev.ratingAfter, { maximumFractionDigits: 0 });
          if (ev.draw) {
            this.showBanner(
              t('hud.system.arenaDrawBanner', { name: ev.oppName, delta: ratingDelta }),
            );
            this.combatLog(
              t('hud.system.arenaDrawLog', {
                name: ev.oppName,
                rating: ratingAfter,
                delta: ratingDelta,
              }),
              '#fa6',
            );
          } else if (ev.won) {
            this.showBanner(
              t('hud.system.arenaVictoryBanner', {
                name: ev.oppName,
                rating: ratingAfter,
                delta: ratingDelta,
              }),
            );
            this.combatLog(
              t('hud.system.arenaVictoryLog', {
                name: ev.oppName,
                rating: ratingAfter,
                delta: ratingDelta,
              }),
              '#7fdc4f',
            );
            audio.duelEnd();
          } else {
            this.showBanner(
              t('hud.system.arenaDefeatBanner', {
                name: ev.oppName,
                rating: ratingAfter,
                delta: ratingDelta,
              }),
            );
            this.combatLog(
              t('hud.system.arenaDefeatLog', {
                name: ev.oppName,
                rating: ratingAfter,
                delta: ratingDelta,
              }),
              '#ff7a6a',
            );
            audio.death();
          }
          break;
        }
        case 'fiestaWord': {
          const { text, tier, color } = this.fiestaWordParts(ev.flavor, ev.n);
          this.fiestaWordPop(text, color, tier);
          this.renderer.addShake(0.35 + tier * 0.2);
          audio.fiestaWord(tier);
          break;
        }
        case 'fiestaWave': {
          this.showBanner(
            t('fiesta.banner.wave', {
              wave: formatNumber(ev.wave, { maximumFractionDigits: 0 }),
              total: formatNumber(ev.totalWaves, { maximumFractionDigits: 0 }),
            }),
          );
          this.fiestaWordPop(t('fiesta.word.wave'), '#ffd24a', 2);
          this.renderer.addShake(0.4);
          audio.fiestaWave();
          break;
        }
        case 'fiestaScore':
          break; // the score HUD + ping are driven by the snapshot
        case 'fiestaDown': {
          audio.fiestaDown();
          break;
        }
        case 'augmentOffer':
          break; // the pick modal is driven by the snapshot
        case 'augmentChosen': {
          const name = this.augmentName(ev.augmentId);
          if (ev.mine) {
            this.renderer.fiestaAugmentBurst(this.sim.playerId);
            audio.fiestaAugment();
            this.showBanner(t('fiesta.banner.augmentGained', { name }));
            this.log(t('fiesta.log.augmentGained', { name }), '#ff3df0');
          } else {
            this.log(t('fiesta.log.allyAugment', { player: ev.byName, name }), '#c98bff');
          }
          break;
        }
        case 'fiestaPowerup': {
          const name = tOptional(`fiesta.powerup.${ev.defId}.name`) ?? ev.defId;
          const who = sim.entities.get(ev.entityId)?.name ?? '?';
          this.log(t('fiesta.log.powerup', { player: who, name }), '#ffd24a');
          if (ev.entityId === sim.playerId) {
            audio.fiestaAugment();
            this.showBanner(t('fiesta.banner.powerup', { name }));
            this.fiestaWordPop(name.toUpperCase(), '#32e0ff', 2);
          }
          break;
        }
        case 'lockpickOffer':
          this.openLockpickAnte(ev.objectId, ev.bountiful);
          break;
        case 'lockpickSession':
          this.openLockpickBoard();
          break;
        case 'lockpickStep':
          this.lockpickWindow.onStep(ev.result);
          break;
        case 'lockpickEnd':
          this.endLockpick(ev.outcome, ev.lootTier);
          break;
        case 'lockpickBonus': {
          const tier =
            ev.tier === 'premium'
              ? t('sim.lockpick.tierPremium')
              : ev.tier === 'medium'
                ? t('sim.lockpick.tierMedium')
                : t('sim.lockpick.tierLow');
          this.combatLog(t('sim.lockpick.lockYields', { tier }), '#ffdd88');
          break;
        }
        case 'delveChestLoot':
          this.openDelveLoot(ev.chestId, ev.items);
          break;
        case 'delveComplete':
          this.showBanner(t('delveUi.summary.title'));
          break;
        case 'delveFailed':
          this.showBanner(t('delveUi.run.failed'));
          break;
        case 'companionBark': {
          // Acolyte Tessa's voice line: overhead bubble over her (when on-screen),
          // plus an attributed combat-log line so it is never missed off-screen.
          const KNOWN_BARKS = ['combat_start', 'low_hp', 'trap_spotted', 'boss_pull', 'completion'];
          if (!KNOWN_BARKS.includes(ev.barkId)) break;
          const line = t(`delveUi.companion.tessa.${ev.barkId}` as TranslationKey, {
            playerName: this.sim.player.name,
          });
          const companion = this.sim.companionState;
          if (companion) this.renderer.showChatBubble(companion.entityId, line, false);
          this.combatLog(
            t('delveUi.companion.barkLine', { name: t('delveUi.board.companion.tessa'), line }),
            '#c9a6e0',
          );
          break;
        }
        case 'delveLoreUnlock': {
          const title = t(`delveUi.lore.${ev.loreId}` as TranslationKey);
          this.combatLog(t('delveUi.summary.loreUnlock', { title }), '#cba6f0');
          break;
        }
        case 'log': {
          const text = this.localizeSystemText(ev.text);
          this.log(text, ev.color ?? '#ccc');
          const isNythraxisVisionLine = [
            'My king was a good man.',
            'I swore my blade to him.',
            'I would do so again.',
            'There had to be another way.',
            'I could not let him die.',
            'I only wanted to save him.',
            'The king was already dead.',
            'Malric refused to accept it.',
            'We should have let him rest.',
            'If you find the crypt... end this.',
          ].includes(ev.text);
          if (
            ev.entityId !== undefined &&
            (isNythraxisVisionLine || ev.text.includes(' yells, "'))
          ) {
            this.renderer.showChatBubble(ev.entityId, text, ev.text.includes(' yells, "'));
          }
          break;
        }
        case 'playerDeath': {
          this.log(t('hud.system.playerDeath'), '#ff4444');
          audio.death();
          break;
        }
        case 'respawn':
          this.log(t('hud.system.respawn'), '#7fdc4f');
          break;
        case 'castStart':
          break; // cast-loop SFX is spatial now (see playEventSfx)
        case 'castStop':
          break;
        case 'aura': {
          const tgt = sim.entities.get(ev.targetId);
          const auraName = auraDisplayNameFromSource(ev.name);
          if (ev.name === 'Polymorph' && ev.gained) audio.sheep();
          if (ev.targetId === sim.playerId) {
            this.combatLog(
              t(ev.gained ? 'hud.combat.auraGain' : 'hud.combat.auraFade', { name: auraName }),
              '#d8a0d8',
            );
          } else if (tgt && ev.gained) {
            this.combatLog(
              t('hud.combat.auraAfflicted', { target: entityDisplayName(tgt), name: auraName }),
              '#d8a0d8',
            );
          }
          break;
        }
      }
    }
  }

  log(text: string, color = '#ccc'): void {
    this.appendLog(this.chatLogEl, text, color, true, 'system');
  }

  // Prepend a dim bracketed wall-clock prefix to a chat line when the "Show
  // Timestamps" option is on. No-op otherwise. Wall-clock time is fine here —
  // the determinism ban is sim-only.
  private prependTimestamp(div: HTMLElement): void {
    if (!this.chatTimestamps) return;
    const ts = document.createElement('span');
    ts.className = 'chat-ts';
    ts.textContent = `${formatChatTimestamp(new Date(), this.chatClock)} `;
    div.appendChild(ts);
  }

  private logZoneWelcome(zone: ZoneDef): void {
    if (zone.welcomeQuestId && this.sim.questState(zone.welcomeQuestId) !== 'available') return;
    this.log(zoneWelcome(zone.id), '#ffd100');
  }

  private chatLogFrom(
    name: string,
    text: string,
    color: string,
    templateKey: TranslationKey,
    chan: string,
    fromPid?: number,
  ): void {
    const wasNearBottom =
      this.chatLogEl.scrollHeight - this.chatLogEl.scrollTop - this.chatLogEl.clientHeight < 24;
    const div = document.createElement('div');
    div.style.color = color;
    div.dataset.chan = chan;
    this.hideIfFiltered(div, chan);
    this.prependTimestamp(div);
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
        this.appendChatMessageBody(div, text, fromPid);
        messageAppended = true;
      } else if (part) {
        div.append(document.createTextNode(part));
      }
    }
    if (!senderAppended || !messageAppended) {
      div.textContent = '';
      div.append(sender, document.createTextNode(': '));
      this.appendChatMessageBody(div, text, fromPid);
    }
    this.chatLogEl.appendChild(div);
    while (this.chatLogEl.children.length > 200)
      this.chatLogEl.removeChild(this.chatLogEl.firstChild!);
    if (wasNearBottom) this.chatLogEl.scrollTop = this.chatLogEl.scrollHeight;
  }

  // Append a chat message body, rendering [[q:id]] tokens as clickable quest links
  // and masking only the plain-text segments. Links bind the message author (fromPid)
  // so a click can offer accept to the author's party members.
  private appendChatMessageBody(parent: HTMLElement, text: string, fromPid?: number): void {
    for (const seg of parseChatSegments(text)) {
      if (seg.kind === 'text') {
        if (seg.value) parent.append(document.createTextNode(this.maskChat(seg.value)));
        continue;
      }
      const quest = QUESTS[seg.questId];
      if (!quest) {
        parent.append(document.createTextNode(this.maskChat('[?]')));
        continue;
      }
      const link = document.createElement('span');
      link.className = 'chat-quest-link';
      link.textContent = `[${questTitle(seg.questId)}]`;
      link.setAttribute('role', 'button');
      link.tabIndex = 0;
      const open = (): void => this.openLinkedQuestDialog(seg.questId, fromPid);
      link.addEventListener('click', open);
      link.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        ev.preventDefault();
        open();
      });
      parent.append(link);
    }
  }

  // The plain-text form of a chat string with [[q:id]] tokens replaced by [Name]
  // — used for 3D chat bubbles, which can't host interactive spans.
  private questLinkPlainText(text: string): string {
    return parseChatSegments(text)
      .map((s) =>
        s.kind === 'text' ? s.value : `[${QUESTS[s.questId] ? questTitle(s.questId) : '?'}]`,
      )
      .join('');
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
    // Raid entry while locked: enrich the toast with the live unlock countdown
    // from the mirrored lockout state. Falls through to the base sim_i18n message
    // (still recognized there) if the lockout already cleared client-side.
    if (text === 'You are locked to Nythraxis Raid Arena.') {
      const lock = this.sim.raidLockouts().find((l) => l.id === 'nythraxis_boss_arena');
      if (lock) {
        return t('hudChrome.raidLockout.lockedToast', {
          raid: dungeonDisplayName('nythraxis_boss_arena'),
          time: this.formatLockoutDuration(lock.msRemaining),
        });
      }
    }
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
      "This quest can't be shared.": 'hudChrome.questShare.notShareable',
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
      "You can't assist yourself.": 'hud.errors.assistSelf',
      'Assist whom? Target a player or use /assist <name>.': 'hud.errors.assistWhom',
    };
    const key = exact[text];
    if (key) return t(key);

    let match = /^You must be in (Bear|Wolf) Form\.$/.exec(text);
    if (match)
      return t('hud.errors.requiresForm', {
        form: t(match[1] === 'Bear' ? 'hud.errors.bear' : 'hud.errors.cat'),
      });
    match = /^You can't do that in (Bear|Wolf|Travel) Form\.$/.exec(text);
    if (match)
      return t('hud.errors.cantInForm', {
        form: t(
          match[1] === 'Bear'
            ? 'hud.errors.bear'
            : match[1] === 'Travel'
              ? 'hud.errors.travel'
              : 'hud.errors.cat',
        ),
      });
    match = /^That ability requires the target below (\d+)% health\.$/.exec(text);
    if (match) return t('hud.errors.targetHealthBelow', { percent: match[1] });
    match = /^Not enough (.+)!$/.exec(text);
    if (match) return t('hud.errors.notEnoughResource', { resource: match[1] });
    match = /^Several players match '(.+)'\. Use exact capitalization\.$/.exec(text);
    if (match) return t('hud.errors.whisperAmbiguous', { name: match[1] });
    match = /^There is no player named '(.+)' online\.$/.exec(text);
    if (match) return t('hud.errors.whisperMissing', { name: match[1] });
    match = /^Assisting (.+)\.$/.exec(text);
    if (match) return t('hud.errors.assisting', { name: match[1] });
    // Assist reply only: anchor the name to a single un-punctuated token run so a
    // future unmapped "... has no target." sim line is not mis-localized with a wrong
    // {name}. Player names never contain a period, so excluding "." keeps this specific.
    match = /^([^.]+) has no target\.$/.exec(text);
    if (match) return t('hud.errors.assistNoTarget', { name: match[1] });
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
    match = /^You must be in (.+)'s party to accept that quest\.$/.exec(text);
    if (match) return t('hudChrome.questShare.notInSharerParty', { name: match[1] });
    match = /^You may keep at most (\d+) goods on the market at once\.$/.exec(text);
    if (match)
      return t('itemUi.errors.tooManyListings', {
        count: formatNumber(Number(match[1]), { maximumFractionDigits: 0 }),
      });
    match = /^That is your own listing (?:\u2014|-) cancel it to reclaim it\.$/.exec(text);
    if (match) return t('itemUi.errors.ownListing');
    match = /^All instances of (.+) are busy\. Try again soon\.$/.exec(text);
    if (match) {
      const busyName = match[1];
      // The same line is emitted for dungeons and delves; resolve the name in the
      // matching table so a delve name does not fall through as raw English.
      const delve = Object.values(DELVES).find((d) => d.name === busyName);
      if (delve) return t('sim.delve.instancesBusy', { name: delveDisplayName(delve.id) });
      return t('worldContent.dungeonInstanceBusy', {
        name: dungeonDisplayNameFromSource(busyName),
      });
    }
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
    for (const delve of DELVE_LIST) {
      if (text === delve.enterText) return delveText(delve.id, 'enterText');
      if (text === delve.leaveText) return delveText(delve.id, 'leaveText');
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
    match = /^(.+) accepted your shared quest\.$/.exec(text);
    if (match) return t('hudChrome.questShare.accepted', { name: match[1] });
    match = /^(.+) \(Complete\)$/.exec(text);
    if (match)
      return t('questUi.logs.ready', {
        name: questTitleFromSource(match[1]),
        status: t('questUi.log.readyStatus'),
      });
    match = /^Your market listing of (.+) expired and waits at the Merchant\.$/.exec(text);
    if (match)
      return t('itemUi.logs.expiredListing', { item: itemDisplayNameFromSource(match[1]) });
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
    match = /^Everyone passed on (.+)\.$/.exec(text);
    if (match)
      return t('itemUi.lootRoll.everyonePassed', { item: itemDisplayNameFromSource(match[1]) });
    match = /^Sold (\d+) junk items? for (.+)\.$/.exec(text);
    if (match) {
      const n = Number(match[1]);
      return t(n === 1 ? 'hud.logs.soldJunkOne' : 'hud.logs.soldJunkMany', {
        count: formatNumber(n, { maximumFractionDigits: 0 }),
        money: this.localizeSimMoney(match[2]),
      });
    }
    match = /^Sold (.+) for (.+)\.$/.exec(text);
    if (match)
      return t('hud.logs.soldItem', {
        item: itemDisplayNameFromSource(match[1]),
        money: this.localizeSimMoney(match[2]),
      });
    match = /^Listed (.+?)( x\d+)? on the World Market for (.+)\.$/.exec(text);
    if (match)
      return t('itemUi.logs.listedItem', {
        item: itemStackDisplayName(match[1], match[2]),
        money: this.localizeSimMoney(match[3]),
      });
    match = /^(.+) bought your (.+) for (.+?) (?:\u2014|-) collect (.+) from the Merchant\.$/.exec(
      text,
    );
    if (match)
      return t('itemUi.logs.sellerSold', {
        buyer: match[1],
        item: itemDisplayNameFromSource(match[2]),
        money: this.localizeSimMoney(match[3]),
        proceeds: this.localizeSimMoney(match[4]),
      });
    match = /^Bought back (.+) for (.+)\.$/.exec(text);
    if (match)
      return t('itemUi.logs.boughtBackItem', {
        item: itemDisplayNameFromSource(match[1]),
        money: this.localizeSimMoney(match[2]),
      });
    match = /^Bought (.+?)( x\d+)? for (.+)\.$/.exec(text);
    if (match)
      return t('itemUi.logs.boughtItem', {
        item: itemStackDisplayName(match[1], match[2]),
        money: this.localizeSimMoney(match[3]),
      });
    match = /^Reclaimed (.+?)( x\d+)? from the market\.$/.exec(text);
    if (match)
      return t('itemUi.logs.reclaimedItem', { item: itemStackDisplayName(match[1], match[2]) });
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

  private appendLog(
    el: HTMLElement,
    text: string,
    color: string,
    timestamp = false,
    chan = 'system',
  ): void {
    const wasNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    const div = document.createElement('div');
    div.style.color = color;
    if (timestamp) this.prependTimestamp(div);
    // tag + filter only the chat pane; the combat pane is a separate view
    if (el === this.chatLogEl) {
      div.dataset.chan = chan;
      this.hideIfFiltered(div, chan);
    }
    div.append(document.createTextNode(text));
    el.appendChild(div);
    while (el.children.length > 200) el.removeChild(el.firstChild!);
    if (wasNearBottom) el.scrollTop = el.scrollHeight;
  }

  // A floating note over the local player (e.g. "Can't move!" when a movement
  // command lands while rooted/stunned). Throttling is the caller's job.
  showSelfNote(text: string, color = '#ff8c66'): void {
    this.fct(this.sim.player, text, color, false);
  }

  private fct(target: Entity, text: string, color: string, crit: boolean): void {
    const v = this.renderer.worldToScreen(
      target.pos.x,
      target.pos.y + 2.2 * target.scale,
      target.pos.z,
    );
    if (v.behind) return;
    const el = document.createElement('div');
    el.className = `fct${crit ? ' crit' : ''}`;
    el.style.color = color;
    // worldToScreen() is in the unzoomed renderer viewport, but #ui (this node's
    // parent) is scaled by `zoom`, so divide into author space before writing.
    const z = getUiScale();
    el.style.left = `${(v.x + (Math.random() * 30 - 15)) / z}px`;
    el.style.top = `${v.y / z}px`;
    el.textContent = text;
    document.getElementById('ui')?.appendChild(el);
    setTimeout(() => el.remove(), 1250);
  }

  showError(text: string): void {
    this.errorEl.textContent = this.localizeErrorText(text);
    this.errorEl.style.opacity = '1';
    clearTimeout(this.errorTimer);
    this.errorTimer = window.setTimeout(() => {
      this.errorEl.style.opacity = '0';
    }, 1600);
    audio.error();
  }

  showBanner(text: string): void {
    this.bannerEl.textContent = text;
    this.bannerEl.style.opacity = '1';
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => {
      this.bannerEl.style.opacity = '0';
    }, 2600);
  }

  showSubzone(text: string): void {
    this.subzoneEl.textContent = text;
    this.subzoneEl.style.opacity = '1';
    clearTimeout(this.subzoneTimer);
    this.subzoneTimer = window.setTimeout(() => {
      this.subzoneEl.style.opacity = '0';
    }, 2600);
  }

  // -------------------------------------------------------------------------
  // 2v2 Fiesta HUD — live score, respawn timer, augment picks, word pops.
  // Everything here is driven by the per-frame snapshot (arenaInfo.match.fiesta)
  // so it self-heals on reconnect; one-shot juice (word pops, shake, audio)
  // rides the SimEvents handled in handleEvents().
  // -------------------------------------------------------------------------

  setFiestaPracticeHook(fn: (() => void) | null): void {
    this.fiestaPracticeHook = fn;
  }

  private inFiesta(): boolean {
    const match = this.sim.arenaInfo?.match;
    return !!match?.fiesta && match.state === 'active';
  }

  private updateFiestaHud(): void {
    const match = this.sim.arenaInfo?.match;
    const f = match?.fiesta;
    const active = !!f && match?.state === 'active';
    if (!f || !active) {
      if (this.fiestaActiveSeen) this.teardownFiestaHud();
      this.fiestaActiveSeen = false;
      return;
    }
    this.fiestaActiveSeen = true;
    this.renderFiestaScore(f);
    this.renderFiestaRespawn(f);
    this.renderFiestaOffer(f);
    this.renderFiestaPending(f);
  }

  // "Augment pending" indicator: a banked offer waiting for the player's next
  // death (so it never interrupts a live fight). Hidden once it's on offer.
  private renderFiestaPending(f: import('../world_api').FiestaMatchInfo): void {
    const el = this.getFiestaEl('fiesta-pending', 'fiesta-pending');
    const show = f.augmentPending > 0 && !f.offer && !f.down;
    if (!show) {
      el.style.display = 'none';
      el.dataset.sig = '';
      return;
    }
    el.style.display = 'flex';
    const sig = `${f.augmentPending}`;
    if (el.dataset.sig !== sig) {
      el.dataset.sig = sig;
      el.innerHTML =
        `<span class="fpend-gem">${this.augmentCategorySvg('utility')}</span>` +
        `<span class="fpend-text">${esc(t('fiesta.pending.label'))}</span>`;
    }
  }

  private getFiestaEl(id: string, cls: string): HTMLElement {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.className = cls;
      document.getElementById('ui')?.appendChild(el);
    }
    return el;
  }

  private renderFiestaScore(f: import('../world_api').FiestaMatchInfo): void {
    const el = this.getFiestaEl('fiesta-score', 'fiesta-score');
    const num = (n: number) => formatNumber(n, { maximumFractionDigits: 0 });
    const dots = Array.from(
      { length: f.totalWaves },
      (_, i) => `<span class="fw-dot${i < f.wave ? ' on' : ''}"></span>`,
    ).join('');
    const myTeam = f.team === 'A' ? f.teamA : f.teamB;
    const enemyTeam = f.team === 'A' ? f.teamB : f.teamA;
    const faces = (players: import('../world_api').FiestaScoreboardPlayer[]) =>
      players
        .map(
          (p) =>
            `<div class="fp${p.me ? ' me' : ''}${p.down ? ' down' : ''}" title="${esc(p.name)}">` +
            `<img class="fp-face" src="${iconDataUrl('crest', p.cls)}" alt="" draggable="false">` +
            `<span class="fp-kills">${num(p.kills)}</span></div>`,
        )
        .join('');
    const teamSig = (ps: import('../world_api').FiestaScoreboardPlayer[]) =>
      ps.map((p) => `${p.kills}${p.down ? 'd' : ''}`).join(',');
    const sig = `${f.myScore}|${f.theirScore}|${f.scoreLimit}|${f.wave}|${teamSig(myTeam)}|${teamSig(enemyTeam)}`;
    if (el.dataset.sig === sig) return;
    const scored =
      this.fiestaScoreSeen.a >= 0 &&
      (this.fiestaScoreSeen.a !== f.scoreA || this.fiestaScoreSeen.b !== f.scoreB);
    const myPrev = f.team === 'A' ? this.fiestaScoreSeen.a : this.fiestaScoreSeen.b;
    const theirPrev = f.team === 'A' ? this.fiestaScoreSeen.b : this.fiestaScoreSeen.a;
    el.dataset.sig = sig;
    el.innerHTML = `
      <div class="fs-team mine" aria-hidden="true">${faces(myTeam)}</div>
      <div class="fs-core">
        <span class="fs-num mine">${num(f.myScore)}</span>
        <div class="fs-mid">
          <div class="fs-title">${esc(t('fiesta.score.title'))}</div>
          <div class="fs-waves">${dots}</div>
          <div class="fs-limit">${esc(t('fiesta.score.toWin', { n: num(f.scoreLimit) }))}</div>
        </div>
        <span class="fs-num theirs">${num(f.theirScore)}</span>
      </div>
      <div class="fs-team theirs" aria-hidden="true">${faces(enemyTeam)}</div>`;
    el.setAttribute(
      'aria-label',
      t('fiesta.score.aria', {
        mine: num(f.myScore),
        theirs: num(f.theirScore),
        limit: num(f.scoreLimit),
      }),
    );
    if (scored) {
      const mineScored = f.myScore > myPrev;
      audio.fiestaScorePing(mineScored);
      el.classList.remove('flash-mine', 'flash-theirs');
      void el.offsetWidth; // restart the CSS flash
      el.classList.add(mineScored ? 'flash-mine' : 'flash-theirs');
      // Confetti rains in the killing team's colour (from this viewer's POV).
      if (f.myScore > myPrev) this.fiestaConfetti('#1b9fff');
      if (f.theirScore > theirPrev) this.fiestaConfetti('#ff2d66');
    }
    this.fiestaScoreSeen = { a: f.scoreA, b: f.scoreB };
  }

  // A burst of CSS confetti raining down the screen in a team colour.
  private fiestaConfetti(color: string): void {
    const ui = document.getElementById('ui')!;
    const layer = document.createElement('div');
    layer.className = 'fiesta-confetti';
    const tints = [color, '#ffffff', '#ffd24a'];
    for (let i = 0; i < 36; i++) {
      const bit = document.createElement('i');
      bit.style.left = `${Math.random() * 100}%`;
      bit.style.background = tints[i % tints.length];
      bit.style.animationDelay = `${Math.random() * 0.5}s`;
      bit.style.animationDuration = `${1.4 + Math.random() * 1.1}s`;
      bit.style.transform = `rotate(${Math.random() * 360}deg)`;
      layer.appendChild(bit);
    }
    ui.appendChild(layer);
    setTimeout(() => layer.remove(), 2800);
  }

  private renderFiestaRespawn(f: import('../world_api').FiestaMatchInfo): void {
    const el = this.getFiestaEl('fiesta-respawn', 'fiesta-respawn');
    if (f.down && f.respawnIn > 0) {
      el.style.display = 'flex';
      const sig = `${f.respawnIn}`;
      if (el.dataset.sig !== sig) {
        el.dataset.sig = sig;
        el.innerHTML = `
          <div class="fr-title">${esc(t('fiesta.respawn.title'))}</div>
          <div class="fr-count">${esc(formatNumber(f.respawnIn, { maximumFractionDigits: 0 }))}</div>
          <div class="fr-sub">${esc(t('fiesta.respawn.sub'))}</div>`;
      }
      this.fiestaWasDown = true;
    } else {
      if (this.fiestaWasDown) audio.fiestaRevive();
      this.fiestaWasDown = false;
      el.style.display = 'none';
      el.dataset.sig = '';
    }
  }

  private renderFiestaOffer(f: import('../world_api').FiestaMatchInfo): void {
    const offer = f.offer;
    const key = offer ? `${offer.wave}:${offer.choices.join(',')}` : '';
    if (key === this.fiestaOfferKey) return;
    this.fiestaOfferKey = key;
    if (offer) this.renderFiestaAugments(offer);
    else this.closeFiestaAugments();
  }

  private renderFiestaAugments(offer: import('../world_api').FiestaAugmentOffer): void {
    const el = this.getFiestaEl('fiesta-augments', 'fiesta-augments');
    el.style.display = 'flex';
    const tierLabel = esc(t(`fiesta.tier.${offer.tier}` as TranslationKey));
    el.innerHTML = `<div class="fa-head">${esc(t('fiesta.augment.choose'))} <span class="fa-tier ${offer.tier}">${tierLabel}</span></div>
      <div class="fa-cards"></div>`;
    const cards = el.querySelector('.fa-cards')!;
    for (const id of offer.choices) {
      const cat = augmentCategory(id);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `fa-card ${offer.tier}`;
      card.innerHTML =
        `<span class="fa-icon cat-${cat}">${this.augmentCategorySvg(cat)}</span>` +
        `<span class="fa-name">${esc(this.augmentName(id))}</span>` +
        `<span class="fa-desc">${esc(this.augmentDesc(id))}</span>` +
        `<span class="fa-cat cat-${cat}">${esc(t(`fiesta.category.${cat}` as TranslationKey))}</span>`;
      card.setAttribute(
        'aria-label',
        `${this.augmentName(id)} (${t(`fiesta.category.${cat}` as TranslationKey)}) — ${this.augmentDesc(id)}`,
      );
      card.addEventListener('click', () => {
        audio.click();
        this.sim.arenaAugmentPick(id);
        this.closeFiestaAugments();
      });
      cards.appendChild(card);
    }
  }

  private closeFiestaAugments(): void {
    const el = document.getElementById('fiesta-augments');
    if (el) {
      el.style.display = 'none';
      el.innerHTML = '';
    }
  }

  // A small inline-SVG glyph per augment category (offense/defense/sustain/
  // mobility/utility). currentColor is set by the .cat-* CSS class.
  private augmentCategorySvg(cat: AugmentCategory): string {
    const p: Record<AugmentCategory, string> = {
      offense: '<path d="M3 21l6-6m0 0l9-9 2 2-9 9m-2-2l-2 2 2 2 2-2m-2-2l2 2"/>', // sword
      defense: '<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/>', // shield
      sustain:
        '<path d="M12 21s-7-4.6-9.2-9C1.3 8.7 3 5 6.5 5c2 0 3.5 1.5 5.5 4 2-2.5 3.5-4 5.5-4C21 5 22.7 8.7 21.2 12 19 16.4 12 21 12 21z"/>', // heart
      mobility: '<path d="M5 18l6-6-6-6m7 12l6-6-6-6"/>', // chevrons
      utility:
        '<path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.8 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z"/>', // star
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${p[cat]}</svg>`;
  }

  private teardownFiestaHud(): void {
    for (const id of ['fiesta-score', 'fiesta-respawn', 'fiesta-augments', 'fiesta-pending']) {
      const el = document.getElementById(id);
      if (el) {
        el.style.display = 'none';
        el.innerHTML = '';
        el.dataset.sig = '';
      }
    }
    this.fiestaScoreSeen = { a: -1, b: -1 };
    this.fiestaOfferKey = '';
    this.fiestaWasDown = false;
  }

  private augmentName(id: string): string {
    return tOptional(`fiesta.augment.${id}.name`) ?? id;
  }

  private augmentDesc(id: string): string {
    return tOptional(`fiesta.augment.${id}.desc`) ?? '';
  }

  // Map a sim word-pop flavor to its localized text, dopamine tier (0..3), and
  // accent colour.
  private fiestaWordParts(
    flavor: string,
    n?: number,
  ): { text: string; tier: number; color: string } {
    switch (flavor) {
      case 'firstblood':
        return { text: t('fiesta.word.firstblood'), tier: 3, color: '#ff3df0' };
      case 'doublekill':
        return { text: t('fiesta.word.doublekill'), tier: 3, color: '#ffae00' };
      case 'shutdown':
        return { text: t('fiesta.word.shutdown'), tier: 3, color: '#00e5ff' };
      case 'spree':
        return {
          text: t('fiesta.word.spree', { n: formatNumber(n ?? 3, { maximumFractionDigits: 0 }) }),
          tier: 2,
          color: '#ff7a1a',
        };
      case 'revived':
        return { text: t('fiesta.word.revived'), tier: 0, color: '#7fdc4f' };
      case 'ringclose':
        return { text: t('fiesta.word.ringclose'), tier: 1, color: '#ff3df0' };
      default:
        return { text: t('fiesta.word.kill'), tier: 1, color: '#ffd24a' };
    }
  }

  // A big exaggerated word that punches in at screen-centre and fades out.
  private fiestaWordPop(text: string, color: string, tier: number): void {
    const el = document.createElement('div');
    el.className = `fiesta-word tier${tier}`;
    el.textContent = text;
    el.style.setProperty('--fw-color', color);
    document.getElementById('ui')?.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }

  // -------------------------------------------------------------------------
  // Quest dialog (gossip)
  // -------------------------------------------------------------------------

  openQuestDialog(npcId: number): void {
    const npc = this.sim.entities.get(npcId);
    if (npc?.kind !== 'npc') return;
    this.questDialogOpenedAtMs = performance.now();
    if ($('#quest-dialog').style.display !== 'block')
      this.questDialogReturnFocus = this.currentFocusableElement();
    this.closeOtherWindows('#quest-dialog');
    // Voice the greeting only on the initial open — renderGossip also runs when
    // navigating back from a quest detail or after accept/turn-in, where a
    // re-greeting would be noise.
    voice.play(`greeting__${npc.templateId}`);
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
      return (
        (st === 'available' && QUESTS[q].giverNpcId === npc.templateId) ||
        (st === 'ready' && isQuestTurnInNpc(QUESTS[q], npc.templateId))
      );
    });
    const discussionQuests = [...this.sim.questLog.values()]
      .filter((qp) => qp.state === 'active' && npc.questIds.includes(qp.questId))
      .filter((qp) =>
        QUESTS[qp.questId].objectives.some(
          (objective, objectiveIndex) =>
            objective.type === 'interact' &&
            objective.targetNpcId === npc.templateId &&
            qp.counts[objectiveIndex] < objective.count,
        ),
      )
      .map((qp) => qp.questId);
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    el.setAttribute('aria-labelledby', 'quest-dialog-title');
    el.setAttribute('tabindex', '-1');
    const npcName = def ? npcDisplayName(npc.templateId) : mobDisplayName(npc.templateId);
    const npcTitle = def ? npcDisplayTitle(def.id) : '';
    let html = `<div class="panel-title"><span id="quest-dialog-title">${esc(npcName)}<span class="quest-muted"> &lt;${esc(npcTitle)}&gt;</span></span><button type="button" class="x-btn" data-close aria-label="${esc(t('questUi.dialog.close'))}">${svgIcon('close')}</button></div>`;
    html += `<div class="qd-text">"${esc(def ? npcGreeting(def.id, this.sim.cfg.playerClass, this.sim.player.name) : t('questUi.dialog.greetingFallback'))}"</div>`;
    if (interesting.length > 0) {
      for (const qid of interesting) {
        const st = this.sim.questState(qid);
        const icon =
          st === 'ready' ? '<span class="gold">?</span> ' : '<span class="gold">!</span> ';
        const title = questTitle(qid);
        const aria =
          st === 'ready'
            ? t('questUi.dialog.readyQuestAria', { name: title })
            : t('questUi.dialog.availableQuestAria', { name: title });
        html += `<button type="button" class="qd-list-item" data-quest="${esc(qid)}" aria-label="${esc(aria)}">${icon}${esc(title)}</button>`;
      }
    }
    if (discussionQuests.length > 0) {
      for (const qid of discussionQuests) {
        const title = questTitle(qid);
        html += `<button type="button" class="qd-list-item" data-discuss="${esc(qid)}" aria-label="${esc(t('questUi.dialog.discussQuestAria', { name: title }))}"><span class="gold">?</span> ${esc(t('questUi.dialog.discussQuest', { name: title }))}</button>`;
      }
    }
    if (npc.vendorItems.length > 0) {
      html += `<button type="button" class="qd-list-item" data-vendor="1" aria-label="${esc(t('questUi.dialog.browseGoodsAria', { name: npcName }))}"><span class="quest-complete">$</span> ${esc(t('questUi.dialog.browseGoods'))}</button>`;
    }
    if (def?.market) {
      html += `<button type="button" class="qd-list-item" data-market="1" aria-label="${esc(t('questUi.dialog.worldMarketAria'))}"><span class="gold">${svgIcon('market')}</span> ${esc(t('questUi.dialog.worldMarket'))}</button>`;
    }
    if (Object.values(DELVES).some((d) => d.boardNpcId === npc.templateId)) {
      html += `<button type="button" class="qd-list-item" data-delve-board="1" aria-label="${esc(t('delveUi.board.openDelveAria', { name: npcName }))}"><span class="gold">${svgIcon('skull')}</span> ${esc(t('delveUi.board.openDelve'))}</button>`;
    }
    el.innerHTML = html;
    el.querySelectorAll('[data-quest]').forEach((item) => {
      item.addEventListener('click', () =>
        this.renderQuestDetail(npc, (item as HTMLElement).dataset.quest!),
      );
    });
    el.querySelectorAll('[data-discuss]').forEach((item) => {
      item.addEventListener('click', () => {
        const _questId = (item as HTMLElement).dataset.discuss!;
        this.sim.targetEntity(npc.id);
        this.sim.interact();
        (item as HTMLButtonElement).disabled = true;
      });
    });
    el.querySelector('[data-vendor]')?.addEventListener('click', () => {
      this.closeQuestDialog(false);
      this.openVendor(npc.id);
    });
    el.querySelector('[data-market]')?.addEventListener('click', () => {
      this.closeQuestDialog(false);
      this.openMarket();
    });
    el.querySelector('[data-delve-board]')?.addEventListener('click', () => {
      this.closeQuestDialog(false);
      this.openDelveBoard(npc.id);
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
    const text = questNarrative(
      questId,
      state === 'ready' ? 'completion' : 'text',
      this.sim.player.name,
    );
    voice.play(state === 'ready' ? `quest__${questId}__complete` : `quest__${questId}__offer`);
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    el.setAttribute('aria-labelledby', 'quest-dialog-title');
    el.setAttribute('tabindex', '-1');
    let html = `<div class="panel-title"><span id="quest-dialog-title">${esc(questTitle(questId))}${this.questSuggestedPlayersHtml(quest.suggestedPlayers)}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('questUi.dialog.close'))}">${svgIcon('close')}</button></div>`;
    if (state === 'available' && quest.minLevel) {
      html += `<div class="qd-req">${esc(t('questUi.detail.requiresLevel', { level: this.questNumber(quest.minLevel) }))}</div>`;
    }
    html += `<div class="qd-text">${esc(text)}</div>`;
    if (state !== 'ready') {
      const qp = this.sim.questLog.get(questId);
      html += `<div class="qd-sub">${esc(t('questUi.detail.objectives'))}</div>`;
      html += quest.objectives
        .map(
          (o, i) =>
            `<div class="qd-obj">${esc(this.questProgressText(questObjectiveLabel(questId, i), qp ? Math.min(qp.counts[i], o.count) : 0, o.count))}</div>`,
        )
        .join('');
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
    if (rewardRow && rewardItem)
      this.attachTooltip(rewardRow, () => this.itemTooltip(ITEMS[rewardItem]));

    if (state === 'available') {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.type = 'button';
      btn.textContent = t('questUi.dialog.accept');
      btn.addEventListener('click', () => {
        this.sim.acceptQuest(questId);
        this.sim.reportTelemetry('quest_accept', {
          timeMs: performance.now() - this.questDialogOpenedAtMs,
        });
        this.renderGossip(npc);
      });
      el.appendChild(btn);
    } else if (state === 'ready') {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.type = 'button';
      btn.textContent = t('questUi.dialog.completeQuest');
      btn.addEventListener('click', () => {
        this.sim.turnInQuest(questId);
        this.sim.reportTelemetry('quest_turnin', {
          timeMs: performance.now() - this.questDialogOpenedAtMs,
        });
        this.renderGossip(npc);
      });
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

  // Open the read-only quest detail for a chat-link click. Shows Accept only when the
  // viewer is in the link author's party AND the quest is available; the server
  // re-validates on accept. Non-party / ineligible viewers see view-only info.
  openLinkedQuestDialog(questId: string, fromPid?: number): void {
    const quest = QUESTS[questId];
    if (!quest) return;
    this.openGossipNpcId = null;
    if ($('#quest-dialog').style.display !== 'block')
      this.questDialogReturnFocus = this.currentFocusableElement();
    this.closeOtherWindows('#quest-dialog');
    const el = $('#quest-dialog');
    const state = this.sim.questState(questId);
    const inSharerParty =
      fromPid !== undefined &&
      (this.sim.partyInfo?.members.some((m) => m.pid === fromPid) ?? false);
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    el.setAttribute('aria-labelledby', 'quest-dialog-title');
    el.setAttribute('tabindex', '-1');
    let html = `<div class="panel-title"><span id="quest-dialog-title">${esc(questTitle(questId))}${this.questSuggestedPlayersHtml(quest.suggestedPlayers)} <span class="quest-muted">&lt;${esc(t('hudChrome.questShare.dialogTitle'))}&gt;</span></span><button type="button" class="x-btn" data-close aria-label="${esc(t('questUi.dialog.close'))}">${svgIcon('close')}</button></div>`;
    if (quest.minLevel)
      html += `<div class="qd-req">${esc(t('questUi.detail.requiresLevel', { level: this.questNumber(quest.minLevel) }))}</div>`;
    html += `<div class="qd-text">${esc(questNarrative(questId, 'text', this.sim.player.name))}</div>`;
    html += `<div class="qd-sub">${esc(t('questUi.detail.objectives'))}</div>`;
    html += quest.objectives
      .map(
        (o, i) =>
          `<div class="qd-obj">${esc(this.questProgressText(questObjectiveLabel(questId, i), 0, o.count))}</div>`,
      )
      .join('');
    html += `<div class="qd-sub">${esc(t('questUi.detail.rewards'))}</div>`;
    html += `<div class="qd-obj">${esc(t('questUi.detail.xpReward', { xp: this.questNumber(quest.xpReward) }))} &nbsp; ${this.moneyHtml(quest.copperReward)}</div>`;
    const rewardItem = questRewardItem(quest, this.sim.cfg.playerClass);
    if (rewardItem) {
      const item = ITEMS[rewardItem];
      html += `<div class="qd-reward-row" data-reward><span class="qd-reward-label">${esc(t('questUi.detail.itemReward'))}</span>${this.itemIcon(item)}<span class="qd-reward-name" style="color:${QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff'}">${esc(itemDisplayName(item))}</span></div>`;
    }
    el.innerHTML = html;
    const rewardRow = el.querySelector('[data-reward]') as HTMLElement | null;
    if (rewardRow && rewardItem)
      this.attachTooltip(rewardRow, () => this.itemTooltip(ITEMS[rewardItem]));
    if (inSharerParty && state === 'available') {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.type = 'button';
      btn.textContent = t('questUi.dialog.accept');
      btn.addEventListener('click', () => {
        this.sim.acceptLinkedQuest(questId, fromPid!);
        this.closeQuestDialog();
      });
      el.appendChild(btn);
    } else {
      // View-only: explain why no Accept. Non-party -> join hint; in-party but
      // ineligible -> the reason (already on it / done / requirements unmet).
      const hint = document.createElement('div');
      hint.className = 'qd-req';
      hint.textContent = !inSharerParty
        ? t('hudChrome.questShare.viewOnlyHint')
        : state === 'done'
          ? t('hudChrome.questShare.alreadyDone')
          : state === 'active' || state === 'ready'
            ? t('hudChrome.questShare.alreadyOn')
            : t('hudChrome.questShare.ineligible');
      el.appendChild(hint);
    }
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeQuestDialog());
    el.style.display = 'block';
    this.focusFirstInteractive(el);
  }

  private renderQuestDiscussion(npc: Entity, questId: string, page: number): void {
    const el = $('#quest-dialog');
    const pages = [
      questNarrative(questId, 'text', this.sim.player.name),
      questNarrative(questId, 'completion', this.sim.player.name),
    ];
    const clampedPage = Math.max(0, Math.min(page, pages.length - 1));
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    el.setAttribute('aria-labelledby', 'quest-dialog-title');
    el.setAttribute('tabindex', '-1');
    el.innerHTML =
      `<div class="panel-title"><span id="quest-dialog-title">${esc(questTitle(questId))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('questUi.dialog.close'))}">${svgIcon('close')}</button></div>` +
      `<div class="qd-text">${esc(pages[clampedPage])}</div>`;
    const action = document.createElement('button');
    action.className = 'btn';
    action.type = 'button';
    if (clampedPage < pages.length - 1) {
      action.textContent = t('questUi.dialog.continue');
      action.addEventListener('click', () =>
        this.renderQuestDiscussion(npc, questId, clampedPage + 1),
      );
    } else {
      action.textContent = t('questUi.dialog.done');
      action.addEventListener('click', () => {
        this.sim.targetEntity(npc.id);
        this.sim.interact();
        this.renderGossip(npc);
      });
    }
    el.appendChild(action);
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

  private lootRollRoot(): HTMLElement {
    let root = document.getElementById('loot-rolls');
    const uiRoot = document.getElementById('ui');
    if (!root) {
      root = document.createElement('div');
      root.id = 'loot-rolls';
      root.setAttribute('aria-live', 'polite');
    }
    if (uiRoot && root.parentElement !== uiRoot) uiRoot.appendChild(root);
    else if (!root.parentElement) document.body.appendChild(root);
    return root;
  }

  private showLootRoll(ev: Extract<SimEvent, { type: 'lootRoll' }>): void {
    this.activeLootRolls.set(ev.rollId, {
      event: ev,
      receivedAt: performance.now(),
      durationMs: 30_000,
    });
    this.renderLootRolls();
  }

  private submitLootRoll(rollId: number, choice: LootRollChoice): void {
    this.sim.submitLootRoll(rollId, choice);
    this.activeLootRolls.delete(rollId);
    this.dismissedLootRolls.add(rollId);
    this.renderLootRolls();
  }

  // Reconcile the shown loot-roll prompts against the server's authoritative
  // open-roll mirror. Loot-roll events are best-effort (a single frame), so this
  // both RE-SHOWS an open roll whose event was missed (reconnect, interest
  // churn, a dropped snapshot) and RETIRES a shown roll the server has since
  // resolved (the mirror drops it to []), so a stale dead-button prompt no
  // longer lingers until the 30s local timer. The three-way decision lives in
  // the pure computeLootRollReconcile; here we apply it to the live DOM state.
  private reconcileLootRolls(): void {
    const open = this.sim.activeLootRolls();
    // Steady state (no open rolls and nothing shown/tracked): nothing to do, and
    // skip allocating the decision arrays every frame.
    if (
      open.length === 0 &&
      this.activeLootRolls.size === 0 &&
      this.dismissedLootRolls.size === 0 &&
      this.confirmedLootRolls.size === 0
    ) {
      return;
    }
    const promptById = new Map(open.map((p) => [p.rollId, p] as const));
    const decision = computeLootRollReconcile({
      open: open.map((p) => p.rollId),
      shown: [...this.activeLootRolls.keys()],
      dismissed: [...this.dismissedLootRolls],
      confirmed: [...this.confirmedLootRolls],
    });
    this.confirmedLootRolls = new Set(decision.confirmed);
    for (const id of decision.toPrune) this.dismissedLootRolls.delete(id); // server confirmed it is gone
    let changed = false;
    for (const id of decision.toRetire) {
      this.activeLootRolls.delete(id);
      changed = true;
    }
    for (const id of decision.toShow) {
      const p = promptById.get(id);
      if (!p) continue;
      this.activeLootRolls.set(id, {
        event: { type: 'lootRoll', ...p },
        receivedAt: performance.now(),
        durationMs: 30_000,
      });
      changed = true;
    }
    if (changed) this.renderLootRolls();
  }

  private updateLootRollTimers(now: number): void {
    if (this.activeLootRolls.size === 0) return;
    let changed = false;
    for (const [rollId, roll] of this.activeLootRolls) {
      if (now - roll.receivedAt >= roll.durationMs) {
        this.activeLootRolls.delete(rollId);
        this.dismissedLootRolls.add(rollId); // expired locally; don't let reconcile re-show it
        changed = true;
      }
    }
    if (changed) this.renderLootRolls();
    const root = document.getElementById('loot-rolls');
    if (!root) return;
    for (const row of root.querySelectorAll<HTMLElement>('.loot-roll')) {
      const rollId = Number(row.dataset.rollId);
      const roll = this.activeLootRolls.get(rollId);
      if (!roll) continue;
      const remaining = Math.max(0, 1 - (now - roll.receivedAt) / roll.durationMs);
      row.style.setProperty('--loot-roll-frac', remaining.toFixed(3));
    }
  }

  private closeLootRollsForItem(text: string): void {
    const match = /^.+ wins (.+) \(\d+\)$/.exec(text) ?? /^Everyone passed on (.+)\.$/.exec(text);
    if (!match) return;
    for (const [rollId, roll] of this.activeLootRolls) {
      if (roll.event.itemName === match[1]) this.activeLootRolls.delete(rollId);
    }
    this.renderLootRolls();
  }

  private renderLootRolls(): void {
    const root = this.lootRollRoot();
    if (this.activeLootRolls.size === 0) {
      root.style.display = 'none';
      root.innerHTML = '';
      return;
    }
    root.style.display = 'flex';
    root.innerHTML = '';
    for (const [rollId, roll] of this.activeLootRolls) {
      const ev = roll.event;
      const item = ITEMS[ev.itemId];
      const itemName = item ? itemDisplayName(item) : ev.itemName;
      const quality = item?.quality ?? ev.quality ?? 'common';
      const row = document.createElement('div');
      row.className = 'loot-roll panel';
      row.dataset.rollId = String(rollId);
      row.style.setProperty('--loot-roll-frac', '1');
      row.innerHTML = `
        <div class="loot-roll-item">
          ${item ? this.itemIcon(item) : `<img class="item-icon q-${quality}" src="${iconDataUrl('item', ev.itemId)}" alt="" draggable="false">`}
          <div class="loot-roll-copy">
            <div class="loot-roll-title">${esc(t('itemUi.lootRoll.title'))}</div>
            <div class="loot-roll-name" style="color:${QUALITY_COLOR[quality] ?? '#fff'}">${esc(itemName)}</div>
          </div>
        </div>
        <div class="loot-roll-timer" aria-hidden="true"><span></span></div>
        <div class="loot-roll-actions">
          <button type="button" class="loot-roll-btn need" data-choice="need">${esc(t('itemUi.lootRoll.need'))}</button>
          <button type="button" class="loot-roll-btn greed" data-choice="greed">${esc(t('itemUi.lootRoll.greed'))}</button>
          <button type="button" class="loot-roll-btn pass" data-choice="pass">${esc(t('itemUi.lootRoll.pass'))}</button>
        </div>`;
      if (item)
        this.attachTooltip(row.querySelector('.loot-roll-item') as HTMLElement, () =>
          this.itemTooltip(item),
        );
      row.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach((btn) => {
        const choice = btn.dataset.choice as LootRollChoice;
        btn.setAttribute('aria-label', t(`itemUi.lootRoll.${choice}Aria`, { item: itemName }));
        btn.addEventListener('click', () => this.submitLootRoll(rollId, choice));
      });
      root.appendChild(row);
    }
  }

  openLoot(mobId: number, screenX: number, screenY: number): void {
    const mob = this.sim.entities.get(mobId);
    if (!mob?.loot) return;
    const visibleItems = mob.loot.items.filter(
      (s) => !s.personalFor || s.personalFor.includes(this.sim.playerId),
    );
    if (mob.loot.copper <= 0 && visibleItems.length === 0) return;
    this.closeOtherWindows('#loot-window');
    this.openLootMobId = mobId;
    this.openLootChestId = null;
    const el = $('#loot-window');
    let html = `<div class="panel-title"><span>${esc(entityDisplayName(mob))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('itemUi.loot.close'))}">${svgIcon('close')}</button></div>`;
    if (mob.loot.copper > 0) {
      html += `<div class="loot-item"><img class="item-icon q-common" src="${iconDataUrl('item', 'coin_gold')}" alt="" draggable="false"><span>${this.moneyHtml(mob.loot.copper)}</span></div>`;
    }
    for (const s of visibleItems) {
      const item = ITEMS[s.itemId];
      html += `<div class="loot-item" data-item="${s.itemId}">${this.itemIcon(item)}<span style="font-size:12px">${esc(itemDisplayName(item))}${s.count > 1 ? ` x${s.count}` : ''}</span></div>`;
    }
    el.innerHTML = html;
    el.querySelectorAll('[data-item]').forEach((row) => {
      const itemId = (row as HTMLElement).dataset.item!;
      this.attachTooltip(row as HTMLElement, () => this.itemTooltip(ITEMS[itemId]));
    });
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = t('itemUi.loot.takeAll');
    btn.addEventListener('click', () => {
      this.sim.lootCorpse(mobId);
      this.closeLoot();
    });
    el.appendChild(btn);
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeLoot());
    this.placePopupAt(el, screenX - 115, screenY - 30, 260, 280, 10, 10);
    el.style.transform = 'none'; // loot pops at the cursor, not the centred slot
    el.style.display = 'block';
  }

  closeLoot(): void {
    $('#loot-window').style.display = 'none';
    this.openLootMobId = null;
    this.openLootChestId = null;
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
    const junk = this.sim.inventory.filter((slot) => {
      const item = ITEMS[slot.itemId];
      return (
        !!item &&
        item.quality === 'poor' &&
        item.kind !== 'quest' &&
        !item.noVendorSell &&
        slot.count > 0
      );
    });
    const junkProceeds = junk.reduce(
      (sum, slot) => sum + ITEMS[slot.itemId]?.sellValue * slot.count,
      0,
    );
    const buyAndRefresh = (buy: () => void) => {
      buy();
      if ($('#bags').style.display !== 'none') this.renderBags();
      this.renderVendor();
    };
    renderVendorWindow(
      $('#vendor-window'),
      entityDisplayName(npc),
      buildVendorView(npc.vendorItems, this.sim.vendorBuyback, ITEMS),
      {
        itemIcon: (item) => this.itemIcon(item),
        moneyHtml: (copper) => this.moneyHtml(copper),
        itemTooltip: (item) => this.itemTooltip(item),
        attachTooltip: (el, html) => this.attachTooltip(el, html),
        hideTooltip: () => this.hideTooltip(),
        onBuy: (itemId) => buyAndRefresh(() => this.sim.buyItem(npc.id, itemId)),
        onBuyBack: (itemId) => buyAndRefresh(() => this.sim.buyBackItem(itemId)),
        onSellJunk: () => buyAndRefresh(() => this.sim.sellAllJunk()),
        onClose: () => this.closeVendor(),
        sellJunk: {
          enabled: junk.length > 0,
          proceeds: junkProceeds,
        },
      },
    );
  }

  closeVendor(): void {
    const closeMobileBags =
      document.body.classList.contains('mobile-touch') && $('#bags').style.display !== 'none';
    $('#vendor-window').style.display = 'none';
    this.openVendorNpcId = null;
    document.body.classList.remove('vendor-open'); // bags (if still open) re-centres
    this.hideTooltip();
    if (closeMobileBags) {
      $('#bags').style.display = 'none';
      this.cancelPetFeed();
    } else if ($('#bags').style.display !== 'none') {
      this.renderBags();
    }
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
    this.marketItemTypeFilter = 'all';
    this.marketSubtypeFilter = 'all';
    this.marketRarityFilter = 'all';
    this.marketBrowsePage = 0;
    this.marketSellItem = null;
    this.marketSearchQuery = '';
    this.sim.marketSearch('');
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

  private marketItemTypeLabelKey(filter: MarketItemTypeFilter): TranslationKey {
    if (filter === 'weapon') return 'itemUi.market.filterTypeWeapon';
    if (filter === 'armor') return 'itemUi.market.filterTypeArmor';
    if (filter === 'consumable') return 'itemUi.market.filterTypeConsumable';
    if (filter === 'material') return 'itemUi.market.filterTypeMaterial';
    if (filter === 'cosmetic') return 'itemUi.market.filterTypeCosmetic';
    if (filter === 'other') return 'itemUi.market.filterTypeOther';
    return 'itemUi.market.filterTypeAll';
  }

  private marketRarityLabelKey(filter: MarketRarityFilter): TranslationKey {
    if (filter === 'poor') return 'itemUi.market.rarityPoor';
    if (filter === 'common') return 'itemUi.market.rarityCommon';
    if (filter === 'uncommon') return 'itemUi.market.rarityUncommon';
    if (filter === 'rare') return 'itemUi.market.rarityRare';
    if (filter === 'epic') return 'itemUi.market.rarityEpic';
    return 'itemUi.market.filterRarityAll';
  }

  private marketSubtypeOptions(): readonly MarketSubtypeFilter[] {
    if (this.marketItemTypeFilter === 'armor') return MARKET_ARMOR_TYPE_FILTERS;
    if (this.marketItemTypeFilter === 'weapon') return MARKET_WEAPON_TYPE_FILTERS;
    return ['all'];
  }

  private marketSubtypeLabel(): string {
    return t(
      this.marketItemTypeFilter === 'armor'
        ? 'itemUi.market.filterArmorType'
        : 'itemUi.market.filterWeaponType',
    );
  }

  private marketSubtypeOptionLabel(filter: MarketSubtypeFilter): string {
    if (filter === 'all')
      return t(
        this.marketItemTypeFilter === 'armor'
          ? 'itemUi.market.filterArmorAll'
          : 'itemUi.market.filterWeaponAll',
      );
    if (this.marketItemTypeFilter === 'armor') return itemSlotName(filter as EquipSlot);
    if (filter === 'sword') return t('itemUi.market.weaponSword');
    if (filter === 'dagger') return t('itemUi.market.weaponDagger');
    if (filter === 'staff') return t('itemUi.market.weaponStaff');
    if (filter === 'mace') return t('itemUi.market.weaponMace');
    if (filter === 'axe') return t('itemUi.market.weaponAxe');
    return t('itemUi.market.weaponOther');
  }

  private renderMarketFilterMenu(
    menu: 'itemType' | 'subtype' | 'rarity',
    label: string,
    value: string,
    options: readonly string[],
    optionLabel: (option: string) => string,
  ): string {
    const current = optionLabel(value);
    const optionHtml = options
      .map((option) => {
        const selected = option === value;
        return `<button type="button" class="mkt-select-option${selected ? ' sel' : ''}" role="option" aria-selected="${selected ? 'true' : 'false'}" data-market-filter-option="${option}">${esc(optionLabel(option))}</button>`;
      })
      .join('');
    return (
      `<div class="mkt-filter"><span>${esc(label)}</span><div class="mkt-select" data-market-filter-menu="${menu}">` +
      `<button type="button" class="mkt-select-btn" aria-haspopup="listbox" aria-expanded="false" aria-label="${esc(`${label}: ${current}`)}"><span>${esc(current)}</span><span class="mkt-select-chevron" aria-hidden="true"></span></button>` +
      `<div class="mkt-select-menu" role="listbox" hidden>${optionHtml}</div>` +
      `</div></div>`
    );
  }

  private renderMarketFilters(): string {
    if (this.marketTab !== 'browse') return '';
    const hasSubtype =
      this.marketItemTypeFilter === 'armor' || this.marketItemTypeFilter === 'weapon';
    return (
      `<div class="mkt-filters${hasSubtype ? ' has-subtype' : ''}" role="group" aria-label="${esc(t('itemUi.market.filters'))}">` +
      this.renderMarketFilterMenu(
        'itemType',
        t('itemUi.market.filterType'),
        this.marketItemTypeFilter,
        MARKET_ITEM_TYPE_FILTERS,
        (filter) => t(this.marketItemTypeLabelKey(filter as MarketItemTypeFilter)),
      ) +
      (hasSubtype
        ? this.renderMarketFilterMenu(
            'subtype',
            this.marketSubtypeLabel(),
            this.marketSubtypeFilter,
            this.marketSubtypeOptions(),
            (filter) => this.marketSubtypeOptionLabel(filter as MarketSubtypeFilter),
          )
        : '') +
      this.renderMarketFilterMenu(
        'rarity',
        t('itemUi.market.filterRarity'),
        this.marketRarityFilter,
        MARKET_RARITY_FILTERS,
        (filter) => t(this.marketRarityLabelKey(filter as MarketRarityFilter)),
      ) +
      `</div>`
    );
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
        ? t('itemUi.market.collectWithCount', {
            count: formatNumber(collectN, { maximumFractionDigits: 0 }),
          })
        : t('itemUi.market.collect');
    };
    const tab = (id: typeof this.marketTab) =>
      `<button type="button" class="mkt-tab${this.marketTab === id ? ' sel' : ''}" data-tab="${id}" aria-pressed="${this.marketTab === id ? 'true' : 'false'}">${esc(tabLabel(id))}</button>`;
    el.innerHTML =
      `<div class="panel-title"><span>${esc(t('itemUi.market.title'))} <span class="panel-subtitle">${esc(t('itemUi.market.subtitle'))}</span></span><button type="button" class="x-btn" data-close aria-label="${esc(t('itemUi.market.close'))}">${svgIcon('close')}</button></div>` +
      `<div class="mkt-tabs">` +
      tab('browse') +
      tab('sell') +
      tab('collect') +
      `</div>` +
      this.renderMarketFilters() +
      `<div id="market-body"></div>`;
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeMarket());
    el.querySelectorAll('[data-tab]').forEach((t) => {
      t.addEventListener('click', () => {
        const next = (t as HTMLElement).dataset.tab as typeof this.marketTab;
        if (next === this.marketTab) return;
        this.marketTab = next;
        this.marketBrowsePage = 0;
        this.lastMarketSig = '';
        audio.click();
        this.renderMarket();
      });
    });
    const closeFilterMenus = () => {
      el.querySelectorAll<HTMLElement>('.mkt-select.open').forEach((menu) => {
        menu.classList.remove('open');
        menu
          .querySelector<HTMLButtonElement>('.mkt-select-btn')
          ?.setAttribute('aria-expanded', 'false');
        const list = menu.querySelector<HTMLElement>('.mkt-select-menu');
        if (list) list.hidden = true;
      });
    };
    el.querySelectorAll<HTMLButtonElement>('.mkt-select-btn').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const menu = button.closest<HTMLElement>('.mkt-select');
        if (!menu) return;
        const open = !menu.classList.contains('open');
        closeFilterMenus();
        menu.classList.toggle('open', open);
        button.setAttribute('aria-expanded', open ? 'true' : 'false');
        const list = menu.querySelector<HTMLElement>('.mkt-select-menu');
        if (list) list.hidden = !open;
      });
    });
    el.querySelectorAll<HTMLButtonElement>('[data-market-filter-option]').forEach((option) => {
      option.addEventListener('click', () => {
        const menu = option.closest<HTMLElement>('[data-market-filter-menu]');
        const key = menu?.dataset.marketFilterMenu;
        const value = option.dataset.marketFilterOption ?? 'all';
        if (key === 'itemType') {
          const next = value as MarketItemTypeFilter;
          if (next !== this.marketItemTypeFilter) {
            this.marketItemTypeFilter = next;
            this.marketSubtypeFilter = 'all';
            this.marketBrowsePage = 0;
          }
        } else if (key === 'subtype') {
          this.marketSubtypeFilter = value as MarketSubtypeFilter;
          this.marketBrowsePage = 0;
        } else if (key === 'rarity') {
          this.marketRarityFilter = value as MarketRarityFilter;
          this.marketBrowsePage = 0;
        } else {
          return;
        }
        this.lastMarketSig = '';
        audio.click();
        this.renderMarket();
      });
    });
    el.addEventListener('click', closeFilterMenus);
    this.renderMarketContent(info);
  }

  // Per-frame: refresh the live lists (Browse/Collect) when they change. The
  // Sell tab holds typed inputs, so it is only rebuilt on explicit actions.
  private refreshMarket(): void {
    if (!this.marketOpen || this.marketTab === 'sell') return;
    const info = this.sim.marketInfo;
    const collectN = info ? (info.collectionCopper > 0 ? 1 : 0) + info.collectionItems.length : 0;
    const sig = JSON.stringify([
      this.marketTab,
      this.marketItemTypeFilter,
      this.marketSubtypeFilter,
      this.marketRarityFilter,
      this.marketBrowsePage,
      info?.listings,
      info?.totalCount,
      info?.filter,
      info?.collectionCopper,
      info?.collectionItems,
    ]);
    if (sig === this.lastMarketSig) return;
    this.lastMarketSig = sig;
    const collectTab = $('#market-window').querySelector('[data-tab="collect"]');
    if (collectTab) {
      collectTab.textContent =
        collectN > 0
          ? t('itemUi.market.collectWithCount', {
              count: formatNumber(collectN, { maximumFractionDigits: 0 }),
            })
          : t('itemUi.market.collect');
    }
    this.renderMarketContent(info);
  }

  private renderMarketContent(info: MarketInfo | null): void {
    const body = document.getElementById('market-body');
    if (!body) return;
    if (!info) {
      body.innerHTML = `<div class="mkt-empty">${esc(t('itemUi.market.noMerchant'))}</div>`;
      return;
    }
    if (this.marketTab === 'browse') this.renderMarketBrowse(body, info);
    else if (this.marketTab === 'sell') this.renderMarketSell(body, info);
    else this.renderMarketCollect(body, info);
  }

  private renderMarketBrowse(body: HTMLElement, info: MarketInfo): void {
    // Reuse the search field and list container across refreshes so typing in
    // the box never loses focus when the server streams back filtered results.
    let search = body.querySelector('.mkt-search') as HTMLInputElement | null;
    let list = body.querySelector('.mkt-list') as HTMLElement | null;
    if (!search || !list) {
      body.innerHTML = '';
      search = document.createElement('input');
      search.type = 'search';
      search.className = 'mkt-search';
      search.placeholder = t('itemUi.market.searchPlaceholder');
      search.setAttribute('aria-label', t('itemUi.market.searchAria'));
      search.value = this.marketSearchQuery;
      search.addEventListener('input', () => {
        if (!search) return;
        this.marketSearchQuery = search.value;
        this.marketBrowsePage = 0;
        this.sim.marketSearch(search.value);
      });
      body.appendChild(search);
      list = document.createElement('div');
      list.className = 'mkt-list';
      body.appendChild(list);
    }
    // Keep the field in sync on external resets, but never clobber active typing.
    if (document.activeElement !== search && search.value !== this.marketSearchQuery) {
      search.value = this.marketSearchQuery;
    }
    list.innerHTML = '';
    if (info.listings.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'mkt-empty';
      empty.textContent = info.filter.trim()
        ? t('itemUi.market.emptySearch')
        : t('itemUi.market.emptyBrowse');
      list.appendChild(empty);
      return;
    }
    const listings = filterMarketListings(info.listings, {
      itemType: this.marketItemTypeFilter,
      subtype: this.marketSubtypeFilter,
      rarity: this.marketRarityFilter,
    });
    if (listings.length === 0) {
      this.marketBrowsePage = 0;
      const empty = document.createElement('div');
      empty.className = 'mkt-empty';
      empty.textContent = t('itemUi.market.emptyFiltered');
      list.appendChild(empty);
      return;
    }
    const page = paginateMarketListings(listings, this.marketBrowsePage, MARKET_PAGE_SIZE);
    this.marketBrowsePage = page.page;
    const note = document.createElement('div');
    note.className = 'mkt-note';
    const shown = `${formatNumber(page.start + 1, { maximumFractionDigits: 0 })}-${formatNumber(page.end, { maximumFractionDigits: 0 })}`;
    const total = formatNumber(page.total, { maximumFractionDigits: 0 });
    note.textContent = t('itemUi.market.pageRange', { shown, total });
    list.appendChild(note);
    for (const l of page.items) {
      const item = ITEMS[l.itemId];
      if (!item) continue;
      const qColor = QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff';
      const row = document.createElement('div');
      row.className = 'mkt-row';
      const itemName = itemDisplayName(item);
      const each =
        l.count > 1
          ? `<br><span class="seller">${esc(t('itemUi.market.each', { money: formatLocalizedMoney(Math.ceil(l.price / l.count)) }))}</span>`
          : '';
      const stack =
        l.count > 1
          ? ` <span class="stack">${esc(t('itemUi.market.stackCount', { count: formatNumber(l.count, { maximumFractionDigits: 0 }) }))}</span>`
          : '';
      row.innerHTML =
        `${this.itemIcon(item)}` +
        `<span class="mkt-name"><span class="nm" style="color:${qColor}">${esc(itemName)}${stack}</span>` +
        `<span class="seller${l.house ? ' house' : ''}">${esc(l.house ? t('itemUi.market.merchantStock') : l.sellerName)}</span></span>` +
        `<span class="mkt-price">${this.moneyHtml(l.price)}${each}</span>`;
      const btn = document.createElement('button');
      btn.className = `mkt-btn${l.mine ? ' cancel' : ''}`;
      btn.textContent = l.mine ? t('itemUi.market.reclaim') : t('itemUi.market.buy');
      btn.setAttribute(
        'aria-label',
        t(l.mine ? 'itemUi.market.reclaimAria' : 'itemUi.market.buyAria', {
          item: itemName,
          price: formatLocalizedMoney(l.price),
        }),
      );
      btn.addEventListener('click', () => {
        if (l.mine) this.sim.marketCancel(l.id);
        else this.sim.marketBuy(l.id);
        audio.click();
      });
      row.appendChild(btn);
      this.attachTooltip(row, () => this.itemTooltip(item));
      list.appendChild(row);
    }
    if (page.pageCount > 1) {
      const pager = document.createElement('div');
      pager.className = 'mkt-page';
      const pageNumber = formatNumber(page.page + 1, { maximumFractionDigits: 0 });
      const pageCount = formatNumber(page.pageCount, { maximumFractionDigits: 0 });
      pager.innerHTML =
        `<button type="button" class="mkt-page-btn" data-market-page="prev"${page.page <= 0 ? ' disabled' : ''} aria-label="${esc(t('itemUi.market.pagePrevAria'))}">${esc(t('itemUi.market.pagePrev'))}</button>` +
        `<span class="mkt-page-info">${esc(t('itemUi.market.pageStatus', { current: pageNumber, total: pageCount }))}</span>` +
        `<button type="button" class="mkt-page-btn" data-market-page="next"${page.page >= page.pageCount - 1 ? ' disabled' : ''} aria-label="${esc(t('itemUi.market.pageNextAria'))}">${esc(t('itemUi.market.pageNext'))}</button>`;
      pager.querySelectorAll<HTMLButtonElement>('[data-market-page]').forEach((button) => {
        button.addEventListener('click', () => {
          if (button.disabled) return;
          this.marketBrowsePage += button.dataset.marketPage === 'next' ? 1 : -1;
          this.lastMarketSig = '';
          audio.click();
          this.renderMarketContent(info);
          body.scrollTop = 0;
        });
      });
      list.appendChild(pager);
    }
  }

  private renderMarketSell(body: HTMLElement, info: MarketInfo): void {
    body.innerHTML = `<div class="mkt-note">${esc(
      t('itemUi.market.sellNote', {
        cut: formatNumber(info.cutPct, { maximumFractionDigits: 0 }),
        used: formatNumber(info.myListingCount, { maximumFractionDigits: 0 }),
        max: formatNumber(info.maxListings, { maximumFractionDigits: 0 }),
      }),
    )}</div>`;
    const item = this.marketSellItem ? ITEMS[this.marketSellItem] : null;
    const have = this.marketSellItem ? this.bagCount(this.marketSellItem) : 0;
    const pick = document.createElement('div');
    if (!item || have <= 0) {
      pick.className = 'mkt-sell-pick empty';
      pick.textContent = t('itemUi.market.sellPickEmpty');
      body.appendChild(pick);
      return;
    }
    if (item.kind === 'quest' || item.noMarketList) {
      this.marketSellItem = null;
      pick.className = 'mkt-sell-pick empty';
      pick.textContent = t('itemUi.tooltip.cannotMarket');
      body.appendChild(pick);
      return;
    }
    const qColor = QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff';
    pick.className = 'mkt-sell-pick';
    pick.innerHTML = `${this.itemIcon(item)}<span class="ps-name" style="color:${qColor}">${esc(itemDisplayName(item))}</span>`;
    body.appendChild(pick);

    const form = document.createElement('div');
    form.className = 'mkt-price-form';
    const qtyRow =
      have > 1
        ? `<div class="mkt-price-row"><label for="mkt-qty">${esc(t('itemUi.market.quantity'))}</label><input class="coininput" id="mkt-qty" type="number" min="1" max="${have}" value="1"> <span class="mkt-coin-tag">${esc(t('itemUi.market.quantityOf', { count: formatNumber(have, { maximumFractionDigits: 0 }) }))}</span></div>`
        : '';
    // a gentle starting ask: a few times vendor value, never below 1c
    const suggested = Math.max(1, item.buyValue ?? Math.max(1, item.sellValue) * 4);
    const g = Math.floor(suggested / 10000),
      s = Math.floor((suggested % 10000) / 100),
      c = suggested % 100;
    form.innerHTML =
      qtyRow +
      `<div class="mkt-price-row"><label>${esc(t('itemUi.market.priceEach'))}</label>` +
      `<input class="coininput" id="mkt-g" type="number" min="0" value="${g}" aria-label="${esc(t('itemUi.money.gold'))}"><span class="coin g" aria-hidden="true"></span><span class="mkt-coin-tag">${esc(t('itemUi.money.goldShort'))}</span>` +
      `<input class="coininput" id="mkt-s" type="number" min="0" max="99" value="${s}" aria-label="${esc(t('itemUi.money.silver'))}"><span class="coin s" aria-hidden="true"></span><span class="mkt-coin-tag">${esc(t('itemUi.money.silverShort'))}</span>` +
      `<input class="coininput" id="mkt-c" type="number" min="0" max="99" value="${c}" aria-label="${esc(t('itemUi.money.copper'))}"><span class="coin c" aria-hidden="true"></span><span class="mkt-coin-tag">${esc(t('itemUi.money.copperShort'))}</span></div>`;
    body.appendChild(form);

    const listBtn = document.createElement('button');
    listBtn.className = 'mkt-list-btn';
    listBtn.textContent = t('itemUi.market.listButton');
    listBtn.addEventListener('click', () => {
      const qty =
        have > 1
          ? Math.max(
              1,
              Math.min(have, parseInt(($('#mkt-qty') as HTMLInputElement)?.value || '1', 10) || 1),
            )
          : 1;
      const gg = Math.max(0, parseInt(($('#mkt-g') as HTMLInputElement)?.value || '0', 10) || 0);
      const ss = Math.max(0, parseInt(($('#mkt-s') as HTMLInputElement)?.value || '0', 10) || 0);
      const cc = Math.max(0, parseInt(($('#mkt-c') as HTMLInputElement)?.value || '0', 10) || 0);
      const each = gg * 10000 + ss * 100 + cc;
      if (each < 1) {
        this.showError(t('itemUi.market.minPriceError'));
        return;
      }
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
      const stack =
        s.count > 1
          ? ` ${t('itemUi.market.stackCount', { count: formatNumber(s.count, { maximumFractionDigits: 0 }) })}`
          : '';
      row.innerHTML = `<span style="display:flex;gap:8px;align-items:center">${this.itemIcon(item)}<span style="color:${qColor}">${esc(itemDisplayName(item))}${esc(stack)}</span></span>`;
      this.attachTooltip(row, () => this.itemTooltip(item));
      body.appendChild(row);
    }
    const btn = document.createElement('button');
    btn.className = 'mkt-list-btn';
    btn.textContent = t('itemUi.market.collectAll');
    btn.addEventListener('click', () => {
      this.sim.marketCollect();
      audio.coin();
    });
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
    if (el.style.display !== 'none') {
      el.style.display = 'none';
      this.hideTooltip();
      audio.bagClose();
      this.cancelPetFeed();
      return;
    }
    this.closeOtherWindows('#bags');
    this.renderBags();
    el.style.display = 'flex';
    audio.bagOpen();
    // Pull a fresh on-chain $WOC balance for the footer; the async result
    // re-renders the bag via the onWalletUiChange listener wired in the ctor.
    this.optionsHooks?.refreshWocBalance();
  }

  // Called when an authoritative inventory delta lands (online snapshots
  // carry inventory separately from the event frames that normally redraw).
  onInventoryChanged(): void {
    if ($('#bags').style.display !== 'none') this.renderBags();
    if (this.openVendorNpcId !== null) this.renderVendor();
    this.renderCharIfOpen();
  }

  onCosmeticsChanged(): void {
    this.renderCharIfOpen();
  }

  private renderCharIfOpen(): void {
    if ($('#char-window').style.display === 'block') this.renderChar();
  }

  private persistBagFilter(): void {
    try {
      localStorage.setItem(Hud.BAG_FILTER_KEY, serializeBagFilter(this.bagFilter));
    } catch {
      /* storage unavailable (private mode); filter still works in-session */
    }
  }

  // The category-chip + sort + search controls above the bag grid. Each control
  // mutates this.bagFilter, persists, and re-renders; the actual filtering is the
  // pure applyBagFilter() in bag_filter.ts.
  private buildBagFilterBar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'bag-filter-bar';

    const chips = document.createElement('div');
    chips.className = 'bag-chips';
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', t('hudChrome.bags.filterGroupAria'));
    for (const category of BAG_CATEGORIES) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `bag-chip${this.bagFilter.category === category ? ' active' : ''}`;
      chip.textContent = t(BAG_CATEGORY_LABEL_KEYS[category]);
      chip.setAttribute('aria-pressed', this.bagFilter.category === category ? 'true' : 'false');
      chip.addEventListener('click', () => {
        if (this.bagFilter.category === category) return;
        this.bagFilter.category = category;
        this.persistBagFilter();
        audio.click();
        this.renderBags();
      });
      chips.appendChild(chip);
    }
    bar.appendChild(chips);

    const tools = document.createElement('div');
    tools.className = 'bag-tools';

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'bag-search';
    search.placeholder = t('hudChrome.bags.searchPlaceholder');
    search.setAttribute('aria-label', t('hudChrome.bags.searchAria'));
    search.value = this.bagFilter.search;
    search.addEventListener('input', () => {
      this.bagFilter.search = search.value;
      this.persistBagFilter();
      this.refreshBagGrid();
    });
    tools.appendChild(search);

    const sort = document.createElement('select');
    sort.className = 'bag-sort';
    sort.setAttribute('aria-label', t('hudChrome.bags.sortAria'));
    for (const option of BAG_SORTS) {
      const opt = document.createElement('option');
      opt.value = option;
      opt.textContent = t(BAG_SORT_LABEL_KEYS[option]);
      if (this.bagFilter.sort === option) opt.selected = true;
      sort.appendChild(opt);
    }
    sort.addEventListener('change', () => {
      this.bagFilter.sort = sort.value as BagSort;
      this.persistBagFilter();
      audio.click();
      this.renderBags();
    });
    tools.appendChild(sort);

    bar.appendChild(tools);
    return bar;
  }

  renderBags(): void {
    const el = $('#bags');
    const sim = this.sim;
    // .bag-grid (not #bags) is the scroll container; it is recreated on every
    // rebuild, so capture its scroll offset and reapply it to the fresh grid —
    // otherwise using an item (e.g. a potion) snaps the list back to the top.
    const prevScrollTop = el.querySelector('.bag-grid')?.scrollTop ?? 0;
    el.innerHTML = `<div class="panel-title"><span>${esc(t('itemUi.bags.title'))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('itemUi.bags.close'))}">${svgIcon('close')}</button></div>`;
    // Skip the chip/search row entirely when the bag is empty: a full filter bar
    // above a single "(empty)" line is just noise.
    if (sim.inventory.length > 0) el.appendChild(this.buildBagFilterBar());
    const grid = document.createElement('div');
    grid.className = 'bag-grid';
    this.fillBagGrid(grid);
    el.appendChild(grid);
    grid.scrollTop = prevScrollTop;
    const moneyRow = document.createElement('div');
    moneyRow.className = 'money';
    moneyRow.innerHTML = `${this.wocBalanceHtml()}${this.moneyHtml(sim.copper)}`;
    el.appendChild(moneyRow);
    el.querySelector('[data-close]')?.addEventListener('click', () => {
      if (this.vendorOpen && document.body.classList.contains('mobile-touch')) {
        this.closeVendor();
        return;
      }
      el.style.display = 'none';
      this.hideTooltip();
      this.cancelPetFeed();
    });
  }

  // Populate (or repopulate) the .bag-grid scroll container from the current
  // filter state. Split out so a search keystroke can refresh just the grid
  // (refreshBagGrid) without rebuilding the filter bar and stealing input focus.
  private fillBagGrid(grid: HTMLElement): void {
    const sim = this.sim;
    const visible = applyBagFilter(sim.inventory, (id) => ITEMS[id], this.bagFilter);
    if (sim.inventory.length === 0) {
      grid.innerHTML = `<div class="bag-empty">${esc(t('itemUi.bags.empty'))}</div>`;
      return;
    } else if (visible.length === 0) {
      grid.innerHTML = `<div class="bag-empty">${esc(t('hudChrome.bags.noMatch'))}</div>`;
      return;
    }
    for (const s of visible) {
      const item = ITEMS[s.itemId];
      if (!item) continue;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'bag-item';
      const qColor = QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff';
      const itemName = itemDisplayName(item);
      row.setAttribute(
        'aria-label',
        t('itemUi.bags.itemAria', {
          item: itemName,
          count: formatNumber(s.count, { maximumFractionDigits: 0 }),
        }),
      );
      row.innerHTML = `${this.itemIcon(item)}<span style="color:${qColor}">${esc(itemName)}</span><span class="bi-count">${s.count > 1 ? esc(t('itemUi.bags.stackCount', { count: formatNumber(s.count, { maximumFractionDigits: 0 }) })) : ''}</span>`;
      row.addEventListener('click', (ev) => {
        if (this.tradeOpen) {
          this.addItemToTrade(s.itemId);
        } else if (this.marketOpen && this.marketTab === 'sell') {
          if (item.kind === 'quest') {
            this.showError(t('itemUi.errors.noQuestItems'));
            return;
          }
          if (item.noMarketList) {
            this.showError(t('itemUi.tooltip.cannotMarket'));
            return;
          }
          this.marketSellItem = s.itemId;
          this.renderMarket();
        } else if (this.vendorOpen) {
          this.sellBagItem(s, ev);
        } else if (this.pendingPetFeed) {
          if (item.kind !== 'food') {
            this.showError(t('hud.pet.petEatsFoodOnly'));
            return;
          }
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
        if (this.tradeOpen)
          extra = `<div class="tt-sub">${esc(t('itemUi.tooltip.clickTradeOffer'))}</div>`;
        else if (this.marketOpen && this.marketTab === 'sell')
          extra =
            item.kind === 'quest' || item.noMarketList
              ? `<div class="tt-sub">${esc(t('itemUi.tooltip.cannotMarket'))}</div>`
              : `<div class="tt-sub">${esc(t('itemUi.tooltip.clickMarketList'))}</div>`;
        else if (this.vendorOpen)
          extra =
            item.kind === 'quest'
              ? `<div class="tt-sub">${esc(t('itemUi.tooltip.cannotVendor'))}</div>`
              : `<div class="tt-sub">${esc(t('itemUi.tooltip.clickSell'))}</div>`;
        else if (item.kind === 'quest')
          extra = `<div class="tt-sub">${esc(t('itemUi.tooltip.clickDestroy'))}</div>`;
        else if (item.kind === 'weapon' || item.kind === 'armor')
          extra = `<div class="tt-sub">${esc(t('itemUi.tooltip.clickEquip'))}</div>`;
        else if (item.kind === 'food' || item.kind === 'drink')
          extra = `<div class="tt-sub">${esc(t('itemUi.tooltip.clickConsume'))}</div>`;
        else if (item.kind === 'potion')
          extra = `<div class="tt-sub">${esc(t('itemUi.tooltip.clickUseInstant'))}</div>`;
        else if (item.use) extra = `<div class="tt-sub">${esc(t('itemUi.tooltip.clickUse'))}</div>`;
        return this.itemTooltip(item) + extra;
      });
      grid.appendChild(row);
    }
  }

  // Refresh only the grid contents (used by live search) so the search input
  // keeps focus and caret position across keystrokes.
  private refreshBagGrid(): void {
    const grid = $('#bags').querySelector('.bag-grid') as HTMLElement | null;
    if (!grid) return;
    const prevScrollTop = grid.scrollTop;
    grid.innerHTML = '';
    this.fillBagGrid(grid);
    grid.scrollTop = prevScrollTop;
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
    document.querySelectorAll('.discard-item-prompt').forEach((el) => {
      el.remove();
    });
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
      const count = input
        ? Math.max(1, Math.min(maxCount, Math.floor(Number(input.value) || 0)))
        : 1;
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
    if (input)
      window.setTimeout(() => {
        input.focus();
        input.select();
      }, 0);
  }

  private showSellQuantityPrompt(itemId: string, maxCount: number): void {
    document.querySelectorAll('.sell-quantity-prompt').forEach((el) => {
      el.remove();
    });
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
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  // -------------------------------------------------------------------------
  // Character window
  // -------------------------------------------------------------------------

  toggleChar(): void {
    const el = $('#char-window');
    if (el.style.display === 'block') {
      el.style.display = 'none';
      this.hideTooltip();
      return;
    }
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
    let html = `<div class="panel-title char-title-portrait">${portraitChipHtml({ cls: sim.cfg.playerClass, skin: p.skin ?? 0, name: p.name, variant: 'md' })}<span class="char-title-text">${esc(p.name)} <span class="panel-subtitle">${esc(t('itemUi.equipment.levelClass', { level: formatNumber(p.level, { maximumFractionDigits: 0 }), className }))}</span></span><button type="button" class="x-btn" data-close aria-label="${esc(t('hud.options.returnToGame'))}">${svgIcon('close')}</button></div>`;
    html += `<div class="paperdoll">
      <div class="equip-col" id="equip-col-left"></div>
      <div class="char-model-panel">
        <div id="char-model-preview" class="char-model-preview"></div>
        <div id="char-skin-row" class="skin-row char-skin-row" role="list" aria-label="${esc(t('auth.appearance'))}"></div>
      </div>
      <div class="equip-col equip-col-right" id="equip-col-right"></div>
    </div>`;
    // Ten focusable stat cells, primaries down the left column and derived stats
    // down the right. The cell markup, value formatting, and the visually-hidden
    // aria breakdown all come from the pure, unit-tested stat_tooltip_view module;
    // each cell's value is read from the model so it cannot drift from the tooltip
    // it opens, and the post-render pass below attaches the floating breakdown.
    const statCell = (stat: StatId) => statCellHtml(this.statModel(stat), STAT_VIEW_DEPS);
    html += `<div class="char-stats">
      ${statCell('str')}${statCell('armor')}
      ${statCell('agi')}${statCell('attackPower')}
      ${statCell('sta')}${statCell('dps')}
      ${statCell('int')}${statCell('critChance')}
      ${statCell('spi')}${statCell('dodge')}
    </div>`;
    html += this.talentSummaryHtml();
    html += this.progressionHtml(p.level);
    const shareGlyph = `<svg class="pc-share-ico" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M18 16.1a3 3 0 0 0-2.3 1.1l-6.7-3.9a3 3 0 0 0 0-2.6l6.7-3.9A3 3 0 1 0 15 4l-6.7 3.9a3 3 0 1 0 0 8.2L15 20a3 3 0 1 0 3-3.9z"/></svg>`;
    html += `<div class="pc-share-row"><button type="button" class="btn pc-share-btn" data-act="share-card">${shareGlyph}<span>${esc(t('playerCard.shareButton'))}</span></button></div>`;
    el.innerHTML = html;
    hydratePortraits(el);
    el.querySelector('[data-act="prestige"]')?.addEventListener('click', () =>
      this.openPrestigeDialog(),
    );
    el.querySelector('[data-act="share-card"]')?.addEventListener('click', () => {
      audio.click();
      void this.openPlayerCard();
    });
    const leftCol = el.querySelector('#equip-col-left')!;
    const rightCol = el.querySelector('#equip-col-right')!;
    // Two columns flanking the model, like the classic WoW character sheet:
    // the left column holds head/shoulder/chest (+ weapon, since we have no
    // neck/back/wrist slots to fill it) and the right column holds the
    // hands/waist/legs/feet quartet.
    const leftSlots: { key: EquipSlot; name: string }[] = [
      { key: 'helmet', name: itemSlotName('helmet') },
      { key: 'shoulder', name: itemSlotName('shoulder') },
      { key: 'chest', name: itemSlotName('chest') },
      { key: 'mainhand', name: itemSlotName('mainhand') },
    ];
    const rightSlots: { key: EquipSlot; name: string }[] = [
      { key: 'gloves', name: itemSlotName('gloves') },
      { key: 'waist', name: itemSlotName('waist') },
      { key: 'legs', name: itemSlotName('legs') },
      { key: 'feet', name: itemSlotName('feet') },
    ];
    const buildSlotRow = (slot: { key: EquipSlot; name: string }): HTMLElement => {
      const itemId = sim.equipment[slot.key];
      const item = itemId ? ITEMS[itemId] : null;
      const row = document.createElement('div');
      row.className = 'equip-slot';
      // Stable id + programmatic focusability so the corner-× rebuild can hand
      // focus back to this slot (the rebuilt row may be empty, with no × to focus).
      row.id = `equip-slot-${slot.key}`;
      row.tabIndex = -1;
      const qColor = !item ? '#666' : (QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff');
      row.innerHTML = `${item ? this.itemIcon(item) : `<img class="item-icon" style="border-color:#444" src="${iconDataUrl('item', 'slot_empty')}" alt="" draggable="false">`}
        <div><div class="slot-name">${esc(slot.name)}</div><div class="slot-item" style="color:${qColor}">${item ? esc(itemDisplayName(item)) : esc(t('itemUi.equipment.empty'))}</div></div>`;
      if (item) {
        // Remove the piece back to bags, leaving the slot empty (equipping only
        // ever swaps in a replacement — this is the way to fully unequip). Three
        // affordances all route through here: the corner ×, right-click, and
        // dragging the piece out onto the bags window.
        // `keepFocus` rebuilds the paperdoll (renderChar replaces the subtree via
        // innerHTML, which otherwise drops focus to <body>) and hands focus back to
        // the now-empty slot row — the keyboard/touch × path needs this; right-click
        // and drag are mouse-only and don't.
        const doUnequip = (keepFocus = false) => {
          this.sim.unequipItem(slot.key);
          audio.click();
          this.hideTooltip();
          this.renderBags();
          this.renderCharIfOpen();
          if (keepFocus) {
            const rebuilt = document.getElementById(`equip-slot-${slot.key}`);
            this.restoreFocus(rebuilt instanceof HTMLElement ? rebuilt : null);
          }
        };
        this.attachTooltip(
          row,
          () =>
            `${this.itemTooltip(item)}<div class="tt-sub">${esc(t('hudChrome.paperdoll.unequipHint'))}</div>`,
        );
        // Corner ×: a styled glyph control (not an in-game icon), revealed on
        // hover/focus and always shown on touch where right-click is unavailable.
        const unequip = document.createElement('button');
        unequip.type = 'button';
        unequip.className = 'equip-unequip-btn';
        unequip.textContent = '×';
        unequip.setAttribute(
          'aria-label',
          t('hudChrome.paperdoll.unequipAria', { item: itemDisplayName(item) }),
        );
        unequip.addEventListener('click', (ev) => {
          ev.stopPropagation();
          doUnequip(true);
        });
        row.appendChild(unequip);
        // Right-click the slot (classic-MMO muscle memory; matches the bags grid).
        row.addEventListener('contextmenu', (ev) => {
          ev.preventDefault();
          doUnequip();
        });
        // Drag the piece out onto the bags window to unequip it.
        row.draggable = true;
        row.addEventListener('dragstart', (e) => {
          this.dragUnequipSlot = slot.key;
          e.dataTransfer!.effectAllowed = 'move';
          this.hideTooltip();
          // Open the bags window if it's closed so there's a visible drop target —
          // otherwise the drag silently snaps back with no feedback.
          const bags = $('#bags');
          if (bags.style.display !== 'block') {
            bags.style.display = 'block';
            this.renderBags();
          }
        });
        row.addEventListener('dragend', () => {
          this.dragUnequipSlot = null;
          $('#bags').classList.remove('drop-target');
        });
      } else {
        // Empty slot: still swallow the native browser menu so right-click feels
        // consistent across the paperdoll (an empty slot has nothing to unequip).
        row.addEventListener('contextmenu', (ev) => ev.preventDefault());
      }
      return row;
    };
    for (const slot of leftSlots) leftCol.appendChild(buildSlotRow(slot));
    for (const slot of rightSlots) rightCol.appendChild(buildSlotRow(slot));
    for (const cell of el.querySelectorAll<HTMLElement>('.char-stats [data-stat]')) {
      const stat = cell.dataset.stat as StatId;
      // Resolve the model lazily, on show, so the breakdown reflects the player's
      // current stats (gear/buffs/talents) at the moment they hover, not at render.
      this.attachTooltip(cell, () => statTooltipHtml(this.statModel(stat), STAT_VIEW_DEPS));
    }
    this.renderCharPreview();
    this.renderCharSkinPicker();
    el.querySelector('[data-close]')?.addEventListener('click', () => {
      el.style.display = 'none';
      this.hideTooltip();
    });
  }

  private renderCharPreview(): void {
    const container = $('#char-model-preview') as HTMLElement | null;
    if (!container) return;
    const preview = activeCharacterAppearancePreview(
      this.sim.cfg.playerClass,
      this.sim.player.skin ?? 0,
      this.sim.player.skinCatalog ?? 'class',
    );
    if (preview.visualKey !== 'player_mech') {
      this.mountCharPreview(container, this.sim.cfg.playerClass, preview.skin, preview.visualKey);
      return;
    }
    if (!this.mechAssetsPromise) this.mechAssetsPromise = preloadMechAssets();
    const mechAssets = this.mechAssetsPromise;
    void mechAssets
      .then(() => {
        const charWindow = $('#char-window') as HTMLElement | null;
        if (charWindow?.style.display !== 'block') return;
        const currentPreview = activeCharacterAppearancePreview(
          this.sim.cfg.playerClass,
          this.sim.player.skin ?? 0,
          this.sim.player.skinCatalog ?? 'class',
        );
        if (currentPreview.visualKey === 'player_mech') {
          this.mountCharPreview(
            container,
            this.sim.cfg.playerClass,
            currentPreview.skin,
            currentPreview.visualKey,
          );
        }
      })
      .catch((err) => console.error('failed to load mech cosmetic preview:', err));
  }

  /** Mount the shared character turntable into `container` showing `cls`/`skin`.
   *  The single CharacterPreview canvas is moved between hosts (char sheet, the
   *  skin-select overlay) via setContainer, so only one WebGL context exists. */
  private mountCharPreview(
    container: HTMLElement,
    cls: PlayerClass,
    skin: number,
    previewKey?: string,
  ): void {
    if (!this.charPreviewCanvas) this.charPreviewCanvas = document.createElement('canvas');
    if (!this.charPreview) {
      container.appendChild(this.charPreviewCanvas);
      this.charPreview = new CharacterPreview(container, this.charPreviewCanvas);
    } else {
      this.charPreview.setContainer(container);
    }
    // Show the player's currently equipped mainhand on the character sheet, so the
    // 3D model reflects gear changes (re-runs on each renderChar after an equip).
    const weapon = this.sim.equipment.mainhand ?? null;
    if (previewKey) this.charPreview.setVisualKey(previewKey, weapon);
    else this.charPreview.setClass(cls, weapon);
    this.charPreview.setSkin(skin);
  }

  private renderCharSkinPicker(): void {
    const row = $('#char-skin-row') as HTMLElement | null;
    if (!row) return;
    const cls = this.sim.cfg.playerClass;
    const options = characterAppearanceOptions(cls, this.sim.accountCosmetics.mechChromaIds);
    row.innerHTML = '';
    row.style.setProperty('--class-color', classCss(cls));
    if (options.length <= 1) return;
    if (options.some((option) => option.kind === 'mech') && !this.mechAssetsPromise) {
      this.mechAssetsPromise = preloadMechAssets();
    }
    const current = Math.max(0, this.sim.player.skin ?? 0);
    const currentCatalog = this.sim.player.skinCatalog ?? 'class';
    for (const option of options) {
      const labelNumber = formatNumber(option.label, { maximumFractionDigits: 0 });
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `skin-swatch${option.kind === currentCatalog && option.skin === current ? ' sel' : ''}`;
      b.textContent = labelNumber;
      b.setAttribute('role', 'listitem');
      b.setAttribute(
        'aria-label',
        option.kind === 'class'
          ? t('auth.chromaOption', { n: labelNumber })
          : this.mechChromaName(option.chromaId),
      );
      b.addEventListener('click', () => {
        row.querySelectorAll('.skin-swatch').forEach((x) => {
          x.classList.remove('sel');
        });
        b.classList.add('sel');
        if (option.kind === 'class') {
          this.sim.changeSkin(option.skin, 'class');
          const preview = activeCharacterAppearancePreview(
            this.sim.cfg.playerClass,
            option.skin,
            'class',
          );
          this.mountCharPreview(
            $('#char-model-preview'),
            this.sim.cfg.playerClass,
            preview.skin,
            preview.visualKey,
          );
          return;
        }
        this.sim.changeSkin(option.skin, 'mech');
        if (!this.mechAssetsPromise) this.mechAssetsPromise = preloadMechAssets();
        const mechAssets = this.mechAssetsPromise;
        void mechAssets
          .then(() => {
            if (
              ($('#char-window') as HTMLElement).style.display === 'block' &&
              b.classList.contains('sel')
            ) {
              const preview = activeCharacterAppearancePreview(
                this.sim.cfg.playerClass,
                option.skin,
                'mech',
              );
              this.mountCharPreview(
                $('#char-model-preview'),
                this.sim.cfg.playerClass,
                preview.skin,
                preview.visualKey,
              );
            }
          })
          .catch((err) => console.error('failed to load mech cosmetic preview:', err));
        audio.click();
      });
      if (option.kind === 'mech') {
        this.attachTooltip(
          b,
          () =>
            `<div class="tt-name">${esc(this.mechChromaName(option.chromaId))}</div><div class="tt-sub">${esc(t('skinEvent.unlocked'))}</div>`,
        );
      }
      row.appendChild(b);
    }
    const currentChroma = currentCatalog === 'mech' ? MECH_CHROMAS[current] : null;
    if (currentChroma && this.sim.accountCosmetics.mechChromaIds.includes(currentChroma.id)) {
      const unequip = document.createElement('button');
      unequip.type = 'button';
      unequip.className = 'skin-unequip-btn';
      unequip.textContent = t('skinEvent.unequip');
      unequip.setAttribute('aria-label', t('skinEvent.unequip'));
      unequip.addEventListener('click', () => {
        this.sim.unequipMechChroma(currentChroma.id);
        audio.click();
        this.renderBags();
        this.renderCharIfOpen();
      });
      this.attachTooltip(
        unequip,
        () =>
          `<div class="tt-name">${esc(this.mechChromaName(currentChroma.id))}</div><div class="tt-sub">${esc(t('skinEvent.unequip'))}</div>`,
      );
      row.appendChild(unequip);
    }
  }

  // -------------------------------------------------------------------------
  // Cosmetic skin-select event overlay (opened by the server-rolled `skinEvent`
  // cue). Left column: rank-gated tier list of selectable skins. Right column:
  // the shared rotatable 3D preview + a Lock In button that commits the choice
  // through IWorld.claimEventSkin (re-validated server-side against the rank).
  // -------------------------------------------------------------------------

  private static readonly SKIN_RANK_NAME_KEY: Record<SkinRank, TranslationKey> = {
    uncommon: 'itemUi.quality.uncommon',
    rare: 'itemUi.quality.rare',
    epic: 'itemUi.quality.epic',
  };

  private skinRankName(rank: SkinRank): string {
    return t(Hud.SKIN_RANK_NAME_KEY[rank]);
  }

  // Combat Mech chroma id -> display-name key. Keyed by MECH_CHROMAS[].id.
  private static readonly MECH_NAME_KEY: Record<string, TranslationKey> = {
    amber_crimson: 'skinEvent.mech.amber_crimson',
    crimson_amber: 'skinEvent.mech.crimson_amber',
    cyan_magenta: 'skinEvent.mech.cyan_magenta',
    magenta_cyan: 'skinEvent.mech.magenta_cyan',
    orange_steel: 'skinEvent.mech.orange_steel',
    steel_orange: 'skinEvent.mech.steel_orange',
    forest_pink: 'skinEvent.mech.forest_pink',
    pink_forest: 'skinEvent.mech.pink_forest',
    amethyst_silver: 'skinEvent.mech.amethyst_silver',
    ivory_copper: 'skinEvent.mech.ivory_copper',
    onyx_gold: 'skinEvent.mech.onyx_gold',
    imperial_crimson: 'skinEvent.mech.imperial_crimson',
    imperial_gold: 'skinEvent.mech.imperial_gold',
    vanguard_azure: 'skinEvent.mech.vanguard_azure',
    vanguard_chrome: 'skinEvent.mech.vanguard_chrome',
  };

  private mechChromaName(id: string): string {
    const key = Hud.MECH_NAME_KEY[id];
    return key ? t(key) : id;
  }

  // The selectable skins for the current overlay mode, each carrying its rank,
  // skin index, a stable choice key, and (mech only) the chroma id for naming.
  private skinEventChoices(): { rank: SkinRank; index: number; key: string; id?: string }[] {
    if (this.skinEventMode === 'mech') {
      return MECH_CHROMAS.map((c, i) => ({ rank: c.rank, index: i, key: `mech:${i}`, id: c.id }));
    }
    return this.skinEventTiers.map((tier) => ({
      rank: tier.rank,
      index: tier.skin,
      key: this.skinTierKey(tier),
    }));
  }

  private skinEventPreviewKey(): string {
    return this.skinEventMode === 'mech' ? 'player_mech' : `player_${this.sim.cfg.playerClass}`;
  }

  // Whether a choice's skin actually exists to render. Mech chromas always do;
  // class skins are bounded by how many that class's model ships.
  private skinChoiceAvailable(index: number): boolean {
    if (this.skinEventMode === 'mech') return true;
    return index < skinCount(`player_${this.sim.cfg.playerClass}`);
  }

  private skinChoiceThumb(index: number): string | null {
    return this.skinEventMode === 'mech'
      ? visualPortraitDataUrl('player_mech', index)
      : playerPortraitDataUrl(this.sim.cfg.playerClass, index);
  }

  /** Best choice the rolled rank unlocks AND that exists, or null. Works for
   *  both modes via skinEventChoices(). */
  private defaultChoiceSelection(rank: SkinRank): { index: number; key: string } | null {
    const granted = skinRankOrder(rank);
    let best: { index: number; key: string } | null = null;
    let bestOrder = -1;
    for (const ch of this.skinEventChoices()) {
      const order = skinRankOrder(ch.rank);
      if (order > granted || !this.skinChoiceAvailable(ch.index)) continue;
      if (order > bestOrder) {
        bestOrder = order;
        best = { index: ch.index, key: ch.key };
      }
    }
    return best;
  }

  /** Open the skin-select overlay for a server-rolled rank, defaulting the
   *  selection to the best skin the rank unlocks.
   *  `opts.mech` opens the real Combat Mech cosmetic catalog. */
  openSkinEvent(rank: SkinRank, opts?: { mech?: boolean }): void {
    for (let i = 0; i < 20 && this.closeAll(); i++) {
      /* close stacked HUD overlays before the roll reveal */
    }
    this.skinEventRank = rank;
    this.skinEventMode = opts?.mech ? 'mech' : 'class';
    if (this.skinEventMode === 'mech') {
      // Kick off the lazy asset fetch; the reveal waits on it before rendering.
      this.mechAssetsPromise = preloadMechAssets();
    } else {
      this.skinEventTiers = EVENT_SKIN_TIERS;
    }
    this.skinEventWheelAngle = this.randomSkinEventLandingAngle(rank);
    const selected = this.defaultChoiceSelection(rank);
    this.skinEventSelected = selected?.index ?? -1;
    this.skinEventSelectedKey = selected?.key ?? '';
    this.hideTooltip();
    // Render the tier list once data + assets are ready. For mech that means the
    // lazy GLB/chromas; otherwise once portraits finish their boot preload.
    const reveal = (): void => {
      if (this.skinEventRank === null) return;
      if (this.skinEventMode === 'mech' && this.mechAssetsPromise) {
        void this.mechAssetsPromise.then(() => {
          if (this.skinEventRank !== null) this.renderSkinEvent();
        });
      } else {
        this.renderSkinEvent();
      }
    };
    onPortraitsReady(() => {
      if (this.skinEventEl?.classList.contains('open') && this.skinEventRevealTimer === null)
        reveal();
    });
    this.renderSkinEventWheel();
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (this.skinEventRevealTimer !== null) window.clearTimeout(this.skinEventRevealTimer);
    this.skinEventRevealTimer = window.setTimeout(
      () => {
        this.skinEventRevealTimer = null;
        reveal();
      },
      reduceMotion ? 140 : 6600,
    );
    audio.bagOpen();
  }

  closeSkinEvent(): void {
    if (!this.skinEventEl) return;
    if (this.skinEventRevealTimer !== null) {
      window.clearTimeout(this.skinEventRevealTimer);
      this.skinEventRevealTimer = null;
    }
    this.skinEventEl.classList.remove('open');
    this.skinEventRank = null;
    this.skinEventTiers = EVENT_SKIN_TIERS;
    this.skinEventMode = 'class';
    this.skinEventSelectedKey = '';
    this.skinEventWheelAngle = 0;
    audio.bagClose();
  }

  private skinTierKey(tier: SkinTier): string {
    return `${tier.rank}:${tier.skin}`;
  }

  private randomSkinEventLandingAngle(rank: SkinRank): number {
    // CSS wheel uses `conic-gradient(from -90deg, ...)`, so the visual centers
    // are shifted 90deg from the raw stop midpoints. Add bounded per-roll
    // jitter so repeat rolls of the same rarity do not stop at the same point.
    const jitter = (span: number): number => (Math.random() - 0.5) * span;
    switch (rank) {
      case 'uncommon':
        return -15 + jitter(150);
      case 'rare':
        return -172.5 + jitter(72);
      case 'epic':
        return -247.5 + jitter(28);
    }
    return 0;
  }

  private renderSkinEventWheel(): void {
    const rank = this.skinEventRank;
    if (rank === null) return;

    let el = this.skinEventEl;
    if (!el) {
      el = document.createElement('div');
      el.id = 'skin-event';
      el.className = 'skin-event-overlay';
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this.closeSkinEvent();
      });
      el.addEventListener('mousedown', (e) => {
        if (e.target === el) this.closeSkinEvent();
      });
      document.body.appendChild(el);
      this.skinEventEl = el;
    }

    const title = esc(t('skinEvent.title'));
    const landed = esc(this.skinRankName(rank));
    el.innerHTML =
      `<div class="se-wheel-stage" role="dialog" aria-modal="true" aria-label="${title}">` +
      `<div class="se-wheel-pointer" aria-hidden="true"></div>` +
      `<div class="se-wheel" style="--land-angle:${this.skinEventWheelAngle}deg" aria-hidden="true">` +
      `<svg class="se-wheel-labels" viewBox="0 0 200 200">` +
      `<defs><path id="se-wheel-label-ring" d="M 100 25 A 75 75 0 1 1 99.9 25"/></defs>` +
      `<text class="se-wheel-label-bg uncommon"><textPath href="#se-wheel-label-ring" startOffset="4%">${esc(this.skinRankName('uncommon'))}</textPath></text>` +
      `<text class="se-wheel-label-bg rare"><textPath href="#se-wheel-label-ring" startOffset="48%">${esc(this.skinRankName('rare'))}</textPath></text>` +
      `<text class="se-wheel-label-bg epic"><textPath href="#se-wheel-label-ring" startOffset="69%">${esc(this.skinRankName('epic'))}</textPath></text>` +
      `<text class="se-wheel-label-fg"><textPath href="#se-wheel-label-ring" startOffset="4%">${esc(this.skinRankName('uncommon'))}</textPath></text>` +
      `<text class="se-wheel-label-fg"><textPath href="#se-wheel-label-ring" startOffset="48%">${esc(this.skinRankName('rare'))}</textPath></text>` +
      `<text class="se-wheel-label-fg"><textPath href="#se-wheel-label-ring" startOffset="69%">${esc(this.skinRankName('epic'))}</textPath></text>` +
      `</svg>` +
      `</div>` +
      `<div class="se-wheel-result" style="--tier-color:${QUALITY_COLOR[rank] ?? '#fff'}">` +
      `<span>${landed}</span>` +
      `<i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>` +
      `<b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b>` +
      `<b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b></div>` +
      `</div>`;
    el.classList.add('open');
  }

  private renderSkinEvent(): void {
    const rank = this.skinEventRank;
    if (rank === null) return;
    const cls = this.sim.cfg.playerClass;
    const granted = skinRankOrder(rank);
    const mech = this.skinEventMode === 'mech';
    const previewKey = this.skinEventPreviewKey();

    // Build the shell once and reuse it across opens so the single 3D canvas
    // can be moved in/out via setContainer without being recreated.
    let el = this.skinEventEl;
    if (!el) {
      el = document.createElement('div');
      el.id = 'skin-event';
      el.className = 'skin-event-overlay';
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this.closeSkinEvent();
      });
      el.addEventListener('mousedown', (e) => {
        if (e.target === el) this.closeSkinEvent();
      });
      document.body.appendChild(el);
      this.skinEventEl = el;
    }

    const title = esc(t('skinEvent.title'));
    const rankName = this.skinRankName(rank);
    el.innerHTML =
      `<div class="panel skin-event-panel" role="dialog" aria-modal="true" aria-label="${title}">` +
      `<div class="se-body"><div class="se-left">` +
      `<div class="se-roll-banner" style="--tier-color:${QUALITY_COLOR[rank] ?? '#fff'}">${esc(t('skinEvent.rolled', { rank: rankName }))}</div>` +
      `<div class="se-tiers" role="radiogroup" aria-label="${title}"></div>` +
      `<button type="button" class="btn se-lockin" data-lockin>${esc(t('skinEvent.lockIn'))}</button>` +
      `</div><div class="se-preview-col">` +
      `<div class="se-preview"><div class="se-preview-hint">${esc(t('skinEvent.previewHint'))}</div></div>` +
      `<div class="se-preview-name" data-preview-name></div>` +
      `</div></div></div>`;

    const tiersEl = el.querySelector('.se-tiers') as HTMLElement;
    const lockInBtn = el.querySelector('[data-lockin]') as HTMLButtonElement;
    const swatches: HTMLButtonElement[] = [];

    const syncSelection = (): void => {
      let selectedCanLock = false;
      for (const b of swatches) {
        const sel = b.dataset.choice === this.skinEventSelectedKey;
        b.classList.toggle('sel', sel);
        b.setAttribute('aria-checked', String(sel));
        b.tabIndex = sel ? 0 : -1;
        if (sel && b.dataset.lockable === 'true') selectedCanLock = true;
      }
      lockInBtn.disabled = !selectedCanLock;
    };

    const nameEl = el.querySelector('[data-preview-name]') as HTMLElement;
    const choiceName = (ch: { rank: SkinRank; id?: string }): string =>
      mech && ch.id ? this.mechChromaName(ch.id) : this.skinRankName(ch.rank);

    const select = (ch: { rank: SkinRank; index: number; key: string; id?: string }): void => {
      this.skinEventSelected = ch.index;
      this.skinEventSelectedKey = ch.key;
      this.charPreview?.setSkin(ch.index);
      nameEl.textContent = choiceName(ch);
      syncSelection();
      audio.click();
    };

    const choices = this.skinEventChoices();
    // Highest rank at the top (epic → uncommon), matching the design sketch.
    // Class mode shows one swatch per tier; mech mode shows every chroma in it.
    for (const tierRank of [...SKIN_RANKS].reverse()) {
      const rankChoices = choices.filter((c) => c.rank === tierRank);
      if (!rankChoices.length) continue;
      const order = skinRankOrder(tierRank);
      const unlocked = order <= granted;
      const anyAvailable = rankChoices.some((c) => this.skinChoiceAvailable(c.index));
      const rawName = this.skinRankName(tierRank);
      const row = document.createElement('div');
      row.className = `se-tier${unlocked ? '' : ' locked'}`;
      row.style.setProperty('--tier-color', QUALITY_COLOR[tierRank] ?? '#fff');
      const hint = !unlocked
        ? `<span class="se-tier-hint">${svgIcon('lock')}${esc(t('skinEvent.lockedHint', { rank: rawName }))}</span>`
        : !anyAvailable
          ? `<span class="se-tier-hint">${esc(t('skinEvent.unavailable'))}</span>`
          : '';
      row.innerHTML =
        `<div class="se-tier-head"><span class="se-tier-name">${esc(rawName)}</span>${hint}</div>` +
        `<div class="se-swatches"></div>`;
      const swatchesEl = row.querySelector('.se-swatches') as HTMLElement;

      rankChoices.forEach((ch, i) => {
        const available = this.skinChoiceAvailable(ch.index);
        const label = choiceName(ch);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'se-swatch';
        b.dataset.skin = String(ch.index);
        b.dataset.choice = ch.key;
        b.dataset.lockable = String(unlocked && available);
        b.setAttribute('role', 'radio');
        if (available) {
          const url = this.skinChoiceThumb(ch.index);
          if (!unlocked) b.classList.add('locked');
          b.innerHTML = url ? `<img src="${esc(url)}" alt="">` : String(i + 1);
          b.setAttribute(
            'aria-label',
            mech ? label : t('skinEvent.optionAria', { rank: rawName, index: i + 1 }),
          );
          b.addEventListener('click', () => select(ch));
          this.attachTooltip(
            b,
            () =>
              `<div class="tt-name">${esc(label)}</div>` +
              (unlocked
                ? ''
                : `<div class="tt-sub">${esc(t('skinEvent.lockedHint', { rank: rawName }))}</div>`),
          );
          swatches.push(b);
        } else {
          b.classList.add('unavailable');
          b.setAttribute('aria-disabled', 'true');
          b.innerHTML = unlocked
            ? '<span class="se-lock">—</span>'
            : `<span class="se-lock">${svgIcon('lock')}</span>`;
          b.setAttribute(
            'aria-label',
            unlocked ? t('skinEvent.unavailable') : t('skinEvent.locked'),
          );
          this.attachTooltip(
            b,
            () =>
              `<div class="tt-name">${esc(rawName)}</div><div class="tt-sub">${esc(t('skinEvent.unavailable'))}</div>`,
          );
        }
        swatchesEl.appendChild(b);
      });
      tiersEl.appendChild(row);
    }

    lockInBtn.addEventListener('click', () => {
      if (this.skinEventSelected < 0 || lockInBtn.disabled) return;
      if (mech) {
        this.sim.claimEventSkin(this.skinEventSelected);
        this.showBanner(t('skinEvent.unlocked'));
        audio.levelUp();
        this.closeSkinEvent();
        if ($('#bags').style.display !== 'none') this.renderBags();
        return;
      }
      this.sim.claimEventSkin(this.skinEventSelected);
      this.showBanner(t('skinEvent.unlocked'));
      audio.levelUp();
      this.closeSkinEvent();
      if ($('#bags').style.display !== 'none') this.renderBags();
    });

    // Show, mount the shared 3D preview into the right column, focus the choice.
    el.classList.add('open');
    this.mountCharPreview(
      el.querySelector('.se-preview') as HTMLElement,
      cls,
      this.skinEventSelected >= 0 ? this.skinEventSelected : 0,
      mech ? previewKey : undefined,
    );
    const selChoice = choices.find((c) => c.key === this.skinEventSelectedKey);
    if (selChoice) nameEl.textContent = choiceName(selChoice);
    syncSelection();
    (swatches.find((b) => b.dataset.choice === this.skinEventSelectedKey) ?? swatches[0])?.focus();
  }

  // -------------------------------------------------------------------------
  // Shareable player card. Captures a crisp close-up of the character from the
  // character-window preview, composites it with the player's stats, gear, and
  // $WOC holder badge, and offers share/download/publish actions. Hosting a
  // public card link is online-only (requires the injected uploader); offline
  // play still gets download + native share.
  // -------------------------------------------------------------------------

  private async openPlayerCard(): Promise<void> {
    // The button lives in the character window, so the preview already exists;
    // create it defensively in case that ever changes.
    if (!this.charPreview) this.renderCharPreview();
    const preview = this.charPreview;
    if (!preview) return;

    this.closePlayerCardModal(false);
    // Pull a fresh on-chain $WOC balance so the holder badge isn't stale. The
    // async result lands via onWalletUiChange → recomposeOpenCard (below), which
    // re-composites the card with the current pose once the new value arrives.
    this.optionsHooks?.refreshWocBalance();
    this.cardModalReturnFocus = this.currentFocusableElement();
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.id = 'player-card-modal';
    const poseBtns = CARD_POSES.map(
      (p, i) =>
        `<button type="button" class="btn pc-pose${i === 0 ? ' sel' : ''}" data-pose="${i}">${esc(t(p.labelKey))}</button>`,
    ).join('');
    back.innerHTML =
      `<div class="panel pc-modal" role="dialog" aria-modal="true" aria-labelledby="player-card-modal-title">` +
      `<div class="panel-title"><span id="player-card-modal-title">${esc(t('playerCard.title'))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('playerCard.close'))}">${svgIcon('close')}</button></div>` +
      `<div class="pc-preview pc-loading">${esc(t('playerCard.loading'))}</div>` +
      `<div class="pc-poses" role="group" aria-label="${esc(t('playerCard.poseGroup'))}">${poseBtns}</div>` +
      `<div class="pc-options"><button type="button" class="btn pc-wallet-toggle" data-wallet-card-toggle><span>${esc(t('hudChrome.playerCard.showWalletBadge'))}</span><span class="pc-toggle-state"></span></button></div>` +
      `<div class="pc-actions"></div>` +
      `<div class="pc-link" hidden><span class="pc-link-label">${esc(t('playerCard.referralLinkLabel'))}</span>` +
      `<input class="pc-link-input" type="text" readonly aria-label="${esc(t('playerCard.referralLinkAria'))}"></div>` +
      `<div class="pc-status" aria-live="polite"></div>` +
      `</div>`;
    document.body.appendChild(back);
    this.cardModalEl = back;
    const close = () => this.closePlayerCardModal();
    back.addEventListener('click', (e) => {
      if (e.target === back) close();
    });
    back.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    });
    back.querySelector('[data-close]')?.addEventListener('click', () => {
      audio.click();
      close();
    });
    this.focusFirstInteractive(back, '[data-close]');

    const previewBox = back.querySelector('.pc-preview') as HTMLElement;
    const status = back.querySelector('.pc-status') as HTMLElement;
    const linkRow = back.querySelector('.pc-link') as HTMLElement;
    const setStatus = (msg: string) => {
      status.textContent = msg;
    };
    const walletToggle = back.querySelector<HTMLButtonElement>('[data-wallet-card-toggle]');
    const walletToggleState = walletToggle?.querySelector<HTMLElement>('.pc-toggle-state') ?? null;

    // Current card state, shared with the action handlers by reference so a pose
    // change (which re-captures + re-composites) also invalidates any publish.
    const state: {
      canvas: HTMLCanvasElement | null;
      data: PlayerCardData | null;
      published: PublishedCard | null;
    } = { canvas: null, data: null, published: null };

    const poseButtons = Array.from(back.querySelectorAll<HTMLButtonElement>('.pc-pose'));
    let requestedPoseIndex = 0;
    let showWalletOnCard =
      walletDisplayAvailable() &&
      (this.optionsHooks?.settings.get('showWalletOnPlayerCard') ?? true);
    let metadataReady = false;
    let referral: Awaited<ReturnType<typeof fetchReferralInfo>> = null;
    let standing: CharacterStanding | null = null;
    const selectPose = (poseIndex: number): void => {
      requestedPoseIndex = poseIndex;
      poseButtons.forEach((b, i) => {
        b.classList.toggle('sel', i === poseIndex);
      });
    };
    const syncWalletToggle = (): void => {
      if (!walletToggle || !walletToggleState) return;
      const on = walletDisplayAvailable() && showWalletOnCard;
      walletToggle.classList.toggle('off', !on);
      walletToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
      walletToggle.setAttribute('aria-label', t('hudChrome.playerCard.showWalletBadge'));
      walletToggleState.textContent = on ? t('hud.options.on') : t('hud.options.off');
    };
    syncWalletToggle();
    // Generation guard: rapid pose clicks fire concurrent async renders; only the
    // most recent one may apply its result, or a slow earlier render could
    // overwrite a newer pose and desync state.canvas from what's shown.
    let composeSeq = 0;
    const compose = async (poseIndex: number): Promise<void> => {
      const seq = ++composeSeq;
      const pose = CARD_POSES[poseIndex];
      selectPose(poseIndex);
      try {
        const characterImage = preview.captureCloseup({
          poseClips: pose.clips,
          poseFraction: pose.fraction,
        });
        const data = this.buildPlayerCardData(
          characterImage,
          referral,
          standing,
          walletDisplayAvailable() && showWalletOnCard,
        );
        const canvas = await renderPlayerCardCanvas(data);
        if (this.cardModalEl !== back || seq !== composeSeq) return; // closed or superseded
        canvas.classList.add('pc-card-canvas');
        previewBox.classList.remove('pc-loading');
        previewBox.innerHTML = '';
        previewBox.appendChild(canvas);
        // A new pose is a different image, so any prior publish is stale.
        state.canvas = canvas;
        state.data = data;
        state.published = null;
        linkRow.hidden = true;
        setStatus('');
      } catch {
        // A failed capture/composite must not leave the modal stuck on "Forging…".
        if (this.cardModalEl !== back || seq !== composeSeq) return;
        previewBox.classList.remove('pc-loading');
        previewBox.textContent = t('playerCard.renderFailed');
        setStatus(t('playerCard.renderFailedStatus'));
      }
    };

    poseButtons.forEach((b, i) => {
      b.addEventListener('click', () => {
        if (requestedPoseIndex === i) return;
        audio.click();
        if (!metadataReady) {
          selectPose(i);
          return;
        }
        void compose(i);
      });
    });
    walletToggle?.addEventListener('click', () => {
      if (!walletDisplayAvailable()) return;
      audio.click();
      showWalletOnCard = !showWalletOnCard;
      this.optionsHooks?.onSettingChange('showWalletOnPlayerCard', showWalletOnCard);
      syncWalletToggle();
      state.published = null;
      linkRow.hidden = true;
      setStatus('');
      if (metadataReady) void compose(requestedPoseIndex);
    });

    // Re-composite the card with the current pose whenever the wallet balance
    // (or availability) changes while this modal is open — e.g. the fresh read
    // kicked at open lands, or tokens move during the session. Registered BEFORE
    // the awaits below so a balance landing during that window isn't dropped; it
    // no-ops until metadataReady, and the first compose picks up the fresh store
    // value anyway.
    this.recomposeOpenCard = () => {
      if (this.cardModalEl === back && metadataReady) void compose(requestedPoseIndex);
    };

    // Referral info + realm standing are online-only (null offline). Fetch once
    // and reuse across pose re-renders. Pose clicks before this resolves update
    // requestedPoseIndex, so the latest visible choice renders when ready.
    [referral, standing] = await Promise.all([fetchReferralInfo(), fetchStanding()]);
    metadataReady = true;
    if (this.cardModalEl !== back) return; // modal closed while awaiting

    await compose(requestedPoseIndex);
    if (this.cardModalEl !== back) return;
    this.wireCardActions(back, state, setStatus);
  }

  private closePlayerCardModal(restoreFocus = true): void {
    const back = this.cardModalEl;
    if (!back) return;
    back.remove();
    if (this.cardModalEl === back) this.cardModalEl = null;
    this.recomposeOpenCard = null;
    const target = this.cardModalReturnFocus;
    this.cardModalReturnFocus = null;
    if (restoreFocus) this.restoreFocus(target);
  }

  private wireCardActions(
    back: HTMLElement,
    state: {
      canvas: HTMLCanvasElement | null;
      data: PlayerCardData | null;
      published: PublishedCard | null;
    },
    setStatus: (msg: string) => void,
  ): void {
    const actions = back.querySelector('.pc-actions') as HTMLElement;
    const linkRow = back.querySelector('.pc-link') as HTMLElement;
    const linkInput = back.querySelector('.pc-link-input') as HTMLInputElement;
    const fileName = () =>
      `${(state.data?.referralHandle || t('playerCard.fileNameFallback')).replace(/[^a-z0-9-]/g, '')}-woc-card.png`;
    const mkBtn = (label: string, cls = ''): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn${cls ? ` ${cls}` : ''}`;
      b.textContent = label;
      actions.appendChild(b);
      return b;
    };
    const errMsg = () => t('playerCard.statusGenericError');

    // Publish-once per pose: hosting a public card is needed for X / copy-link.
    // The result is cached on `state` and cleared whenever the pose changes, so
    // switching pose after publishing re-uploads the new image on next share.
    const publishOnce = async (): Promise<PublishedCard> => {
      if (state.published) return state.published;
      if (!state.canvas) throw new Error(t('playerCard.statusStillRendering'));
      setStatus(t('playerCard.statusPublishing'));
      const pub = await publishCard(await cardCanvasToUploadBlob(state.canvas), {
        level: state.data?.level ?? this.sim.player.level,
      });
      state.published = pub;
      linkInput.value = pub.url;
      linkRow.hidden = false;
      setStatus(t('playerCard.statusPublished'));
      return pub;
    };

    if (cardHostingAvailable()) {
      const xb = mkBtn(t('playerCard.actionShareX'), 'cd-ok');
      xb.addEventListener('click', async () => {
        audio.click();
        xb.disabled = true;
        try {
          // X's intent URL can only carry text + a link; it cannot attach media.
          // So copy the card PNG to the clipboard first (inside the click gesture,
          // passing the blob promise to ClipboardItem so the write stays valid
          // while the PNG encodes) for the user to paste (⌘V) into the post. The
          // link still rides along and unfurls the card image on a public domain.
          let copied = false;
          if (state.canvas && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
            try {
              await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': cardCanvasToBlob(state.canvas) }),
              ]);
              copied = true;
            } catch {
              copied = false; /* clipboard blocked → fall back to link-only */
            }
          }
          const pub = await publishOnce();
          const text = state.data
            ? this.cardShareText(state.data)
            : t('playerCard.nativeShareTitle');
          const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(pub.url)}`;
          window.open(intent, '_blank', 'noopener,noreferrer');
          setStatus(
            copied ? t('playerCard.statusOpenedXWithImage') : t('playerCard.statusOpenedXWithLink'),
          );
        } catch {
          setStatus(errMsg());
        } finally {
          xb.disabled = false;
        }
      });
      const cb = mkBtn(t('playerCard.actionCopyReferral'));
      cb.addEventListener('click', async () => {
        audio.click();
        cb.disabled = true;
        try {
          const pub = await publishOnce();
          await navigator.clipboard.writeText(pub.url);
          linkInput.select();
          setStatus(t('playerCard.statusReferralCopied'));
        } catch {
          setStatus(errMsg());
        } finally {
          cb.disabled = false;
        }
      });
    }

    const dl = mkBtn(t('playerCard.actionDownload'));
    dl.addEventListener('click', async () => {
      audio.click();
      if (!state.canvas) return;
      const blob = await cardCanvasToBlob(state.canvas);
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = fileName();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 4000);
      setStatus(t('playerCard.statusDownloaded'));
    });

    // Native share (mobile): share the PNG file, plus the hosted link when one
    // is available. navigator.canShare with files is the capability gate.
    const nav = navigator as Navigator & { canShare?: (d?: ShareData) => boolean };
    if (typeof nav.canShare === 'function') {
      const sb = mkBtn(t('playerCard.actionShareNative'));
      sb.addEventListener('click', async () => {
        audio.click();
        if (!state.canvas) return;
        sb.disabled = true;
        try {
          const file = new File([await cardCanvasToBlob(state.canvas)], fileName(), {
            type: 'image/png',
          });
          const payload: ShareData = {
            files: [file],
            title: t('playerCard.nativeShareTitle'),
            text: state.data ? this.cardShareText(state.data) : t('playerCard.nativeShareTitle'),
          };
          // Attach the hosted link when hosting is available; if publishing
          // fails, fall back to sharing just the image file.
          if (cardHostingAvailable()) {
            try {
              payload.url = (await publishOnce()).url;
            } catch {
              /* share file-only */
            }
          }
          if (nav.canShare?.(payload)) await nav.share?.(payload);
          else if (nav.canShare?.({ files: [file] })) await nav.share?.({ files: [file] });
          else setStatus(t('playerCard.statusShareUnsupported'));
        } catch (err) {
          if (!(err instanceof Error && err.name === 'AbortError')) setStatus(errMsg());
        } finally {
          sb.disabled = false;
        }
      });
    }
  }

  private cardShareText(data: PlayerCardData): string {
    const tier = holderTierForBalance(data.balance);
    const tierBit = tier ? t('playerCard.shareTierBit', { tier: holderTierDisplayName(tier) }) : '';
    // The URL X appends to this text is the player's card page; it unfurls the
    // card image and credits the referral when a recruit joins through it.
    return t('playerCard.shareText', {
      level: formatNumber(data.level, { maximumFractionDigits: 0 }),
      className: data.className,
      tierBit,
    });
  }

  private buildPlayerCardData(
    characterImage: string,
    referral: { count: number; slug: string | null } | null,
    standing: CharacterStanding | null,
    showWallet: boolean,
  ): PlayerCardData {
    const sim = this.sim;
    const p = sim.player;
    const cls = sim.cfg.playerClass;
    const classColor = `#${(p.color & 0xffffff).toString(16).padStart(6, '0')}`;
    const num = (n: number) => formatNumber(n, { maximumFractionDigits: 0 });
    const pct = (n: number) =>
      `${formatNumber(n * 100, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

    // Realm standing by lifetime XP: the same metric the in-game leaderboard
    // ranks on (server: lifetimeXpStanding). Surfaced as a "TOP N%" flex when the
    // realm has enough players to be meaningful and the character is in the top
    // half, since no one wants to broadcast "Top 90%".
    let topPercent: number | null = null;
    if (standing && standing.total >= 5 && standing.rank >= 1) {
      const p100 = (standing.rank / standing.total) * 100;
      if (p100 <= 50) topPercent = p100;
    }

    const wpn = sim.equipment.mainhand ? ITEMS[sim.equipment.mainhand] : null;
    const dps = weaponDps(wpn?.weapon, p.attackPower);

    const primaryStats: PlayerCardStat[] = [
      { label: t('itemUi.stats.str'), value: num(p.stats.str) },
      { label: t('itemUi.stats.agi'), value: num(p.stats.agi) },
      { label: t('itemUi.stats.sta'), value: num(p.stats.sta) },
      { label: t('itemUi.stats.int'), value: num(p.stats.int) },
      { label: t('itemUi.stats.spi'), value: num(p.stats.spi) },
      { label: t('itemUi.stats.armor'), value: num(p.stats.armor) },
    ];
    const combatStats: PlayerCardStat[] = [
      { label: t('itemUi.stats.attackPower'), value: num(p.attackPower) },
      {
        label: t('itemUi.stats.dps'),
        value: formatNumber(dps, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      },
      { label: t('itemUi.stats.critChance'), value: pct(p.critChance) },
      { label: t('itemUi.stats.dodge'), value: pct(p.dodgeChance) },
    ];
    const rating = sim.arenaInfo?.rating ?? null;
    if (rating !== null) combatStats.push({ label: t('playerCard.arenaStat'), value: num(rating) });
    if (sim.prestigeRank > 0)
      combatStats.push({ label: t('game.prestige.rank'), value: num(sim.prestigeRank) });

    const slots: EquipSlot[] = ['mainhand', 'chest', 'legs', 'feet'];
    const gear = slots.map((slot) => {
      const id = sim.equipment[slot];
      const item = id ? ITEMS[id] : null;
      return {
        slot: itemSlotName(slot),
        name: item ? itemDisplayName(item) : t('itemUi.equipment.empty'),
        color: item ? (QUALITY_COLOR[item.quality ?? 'common'] ?? '#cfc3a0') : '#7c7058',
      };
    });

    return {
      name: p.name,
      className: classDisplayName(cls),
      classColor,
      level: p.level,
      realm: sim.realm,
      characterImage,
      primaryStats,
      combatStats,
      gear,
      topPercent,
      balance: showWallet ? verifiedWocBalance() : null,
      referralHandle: referral?.slug ?? this.cardSlug(p.name),
      referralCount: referral?.count ?? null,
      siteUrl: 'worldofclaudecraft.com',
    };
  }

  // Client-side mirror of the server's slugify (server/player_card.ts), used
  // only for the footer handle preview before the card is published.
  private cardSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }

  // -------------------------------------------------------------------------
  // Post-cap progression (Max-Level XP Overflow): character-sheet block,
  // milestone badges, prestige dialog, and the lifetime-XP leaderboard panel.
  // -------------------------------------------------------------------------

  private milestoneName(id: string): string {
    switch (id) {
      case 'veteran':
        return t('game.milestone.veteran');
      case 'champion':
        return t('game.milestone.champion');
      case 'paragon':
        return t('game.milestone.paragon');
      case 'mythic':
        return t('game.milestone.mythic');
      case 'eternal':
        return t('game.milestone.eternal');
      default:
        return id;
    }
  }

  // Character-sheet summary of the current specialization, role, and Mastery
  // (FR-8.6). Reuses the progression-block styling.
  private talentSummaryHtml(): string {
    const ct = talentsFor(this.sim.cfg.playerClass);
    if (!ct) return '';
    const sp = ct.specs.find((s) => s.id === this.sim.talentSpec);
    const specName = sp
      ? esc(tTalent({ kind: 'talentSpec', spec: sp, field: 'name' }))
      : t('game.talents.noSpec');
    let html = `<div class="char-progression"><div class="cp-title">${t('game.talents.specTab')}</div>`;
    html += `<div class="char-stats cp-stats"><span>${t('game.talents.specTab')}: <b>${specName}</b></span>`;
    if (sp) html += `<span>${t('game.talents.role')}: <b>${this.roleLabel(sp.role)}</b></span>`;
    html += `</div>`;
    if (sp)
      html += `<div class="cp-milestones"><span class="cp-ms-label">${t('game.talents.mastery')}:</span> <b style="color:var(--gold)">${esc(tTalent({ kind: 'talentMastery', spec: sp, field: 'name' }))}</b> <span class="cp-none">${esc(tTalent({ kind: 'talentMastery', spec: sp, field: 'description' }))}</span></div>`;
    return `${html}</div>`;
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
    if (sim.prestigeRank > 0)
      html += `<span>${t('game.progression.prestigeRank')}: <b>★ ${sim.prestigeRank}</b></span>`;
    html += `</div>`;
    html += `<div class="cp-milestones"><span class="cp-ms-label">${t('game.progression.milestones')}:</span> ${badges || `<span class="cp-none">${t('game.progression.none')}</span>`}</div>`;
    if (level >= MAX_LEVEL) {
      // The button reflects the server's authoritative prestige gate (post-cap
      // XP earned). It's disabled — and the requirement shown — until eligible;
      // the server re-checks regardless, so a forged click does nothing.
      const ready = canPrestige(level, sim.lifetimeXp, sim.prestigeRank);
      html += `<div class="cp-actions"><button class="btn" data-act="prestige"${ready ? '' : ' disabled'}>${t('game.prestige.action')}${sim.prestigeRank > 0 ? ` (★ ${sim.prestigeRank})` : ''}</button>`;
      if (!ready)
        html += `<span class="cp-hint">${formatXp(xpUntilNextPrestige(sim.lifetimeXp, sim.prestigeRank))} ${t('game.prestige.needXp')}</span>`;
      html += `</div>`;
    }
    return `<div class="char-progression">${html}</div>`;
  }

  private openPrestigeDialog(): void {
    const p = this.sim.player;
    // Mirror the server's gate; the server enforces it authoritatively anyway.
    if (!canPrestige(p.level, this.sim.lifetimeXp, this.sim.prestigeRank)) {
      this.showError(
        p.level < MAX_LEVEL
          ? t('game.prestige.needCap')
          : `${formatXp(xpUntilNextPrestige(this.sim.lifetimeXp, this.sim.prestigeRank))} ${t('game.prestige.needXp')}`,
      );
      return;
    }
    this.confirmDialog(
      t('game.prestige.title'),
      t('game.prestige.body'),
      t('game.prestige.confirm'),
      t('game.prestige.cancel'),
      () => {
        this.sim.prestige();
        audio.click();
      },
    );
  }

  // Minimal modal confirm dialog (reuses the .window/.panel chrome). Built on
  // demand and removed on dismiss.
  private confirmDialog(
    title: string,
    body: string,
    okText: string,
    cancelText: string,
    onOk: () => void,
  ): void {
    document.getElementById('confirm-dialog')?.remove();
    const el = document.createElement('div');
    el.id = 'confirm-dialog';
    el.className = 'window panel';
    el.style.display = 'block';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML =
      `<div class="panel-title"><span>${esc(title)}</span><button type="button" class="x-btn" data-cancel aria-label="${esc(cancelText)}">${svgIcon('close')}</button></div>` +
      `<div class="cd-body">${esc(body)}</div>` +
      `<div class="cd-actions"><button type="button" class="btn" data-cancel>${esc(cancelText)}</button><button type="button" class="btn cd-ok" data-ok>${esc(okText)}</button></div>`;
    document.body.appendChild(el);
    this.bringWindowToFront(el);
    el.querySelector<HTMLElement>('[data-ok]')?.focus();
    const close = () => el.remove();
    el.querySelectorAll('[data-cancel]').forEach((b) => {
      b.addEventListener('click', () => {
        audio.click();
        close();
      });
    });
    el.querySelector('[data-ok]')?.addEventListener('click', () => {
      close();
      onOk();
    });
  }

  // In-app text-input modal (reuses the confirm-dialog chrome) — replaces native
  // window.prompt for build name / import / export. `readOnly` + `copy` powers
  // the export view (selectable string + Copy button).
  private inputDialog(opts: {
    title: string;
    label?: string;
    value?: string;
    placeholder?: string;
    multiline?: boolean;
    readOnly?: boolean;
    copy?: boolean;
    selectText?: boolean;
    okText?: string;
    cancelText?: string;
    onOk?: (value: string) => void;
  }): void {
    document.getElementById('confirm-dialog')?.remove();
    const el = document.createElement('div');
    el.id = 'confirm-dialog';
    el.className = 'window panel';
    el.style.display = 'block';
    const field = opts.multiline
      ? `<textarea class="cd-input" rows="3" ${opts.readOnly ? 'readonly' : ''} placeholder="${esc(opts.placeholder ?? '')}">${esc(opts.value ?? '')}</textarea>`
      : `<input class="cd-input" type="text" ${opts.readOnly ? 'readonly' : ''} placeholder="${esc(opts.placeholder ?? '')}" value="${esc(opts.value ?? '')}">`;
    el.innerHTML =
      `<div class="panel-title"><span>${esc(opts.title)}</span><span class="x-btn" data-cancel>${svgIcon('close')}</span></div>` +
      (opts.label ? `<div class="cd-body">${esc(opts.label)}</div>` : '') +
      `<div class="cd-field">${field}</div>` +
      `<div class="cd-actions"><button class="btn" data-cancel>${esc(opts.cancelText ?? t('game.talents.cancel'))}</button>` +
      (opts.copy ? `<button class="btn" data-copy>${t('game.talents.copy')}</button>` : '') +
      (opts.onOk
        ? `<button class="btn cd-ok" data-ok>${esc(opts.okText ?? t('game.talents.save'))}</button>`
        : '') +
      `</div>`;
    document.body.appendChild(el);
    const input = el.querySelector('.cd-input') as HTMLInputElement | HTMLTextAreaElement;
    const close = () => el.remove();
    const submit = () => {
      const v = input?.value ?? '';
      close();
      opts.onOk?.(v);
    };
    el.querySelectorAll('[data-cancel]').forEach((b) => {
      b.addEventListener('click', () => {
        audio.click();
        close();
      });
    });
    el.querySelector('[data-ok]')?.addEventListener('click', submit);
    el.querySelector('[data-copy]')?.addEventListener('click', () => {
      input.select();
      navigator.clipboard?.writeText(input.value).catch(() => {
        /* clipboard blocked; manual select still works */
      });
      this.showError(t('game.talents.exportCopied'));
    });
    if (!opts.multiline)
      input?.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') {
          e.preventDefault();
          submit();
        }
      });
    input?.focus();
    if (opts.readOnly || opts.selectText) input?.select?.();
  }

  // Generic in-app dropdown (replaces native <select>). The selected value lives
  // in root.dataset.value; pass onChange to react live. Closes on click-away.
  // Implements the WAI-ARIA listbox pattern so it keeps the keyboard + screen
  // reader semantics a native <select> has: the trigger is aria-haspopup, the
  // menu is role="listbox" with aria-selected options, and Enter/Space/Arrows/
  // Home/End/Esc are all handled (see dropdown_nav.ts for the pure key math).
  private buildDropdown(
    options: { value: string; label: string }[],
    current: string,
    onChange?: (value: string) => void,
    placeholder?: string,
    a11y?: { ariaLabel?: string; labelledBy?: string },
  ): HTMLElement {
    const uid = `ui-dd-${++Hud.ddSeq}`;
    const root = document.createElement('div');
    root.className = 'ui-dd';
    root.dataset.value = current;
    // Accessible name for both the trigger button and the listbox: prefer an
    // explicit aria-label, else associate an existing <label>/heading via id.
    const nameAttr = a11y?.ariaLabel
      ? ` aria-label="${esc(a11y.ariaLabel)}"`
      : a11y?.labelledBy
        ? ` aria-labelledby="${esc(a11y.labelledBy)}"`
        : '';
    const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? placeholder ?? '';
    root.innerHTML =
      `<button type="button" class="btn ui-dd-btn" aria-haspopup="listbox" aria-expanded="false" aria-controls="${uid}"${nameAttr}><span class="ui-dd-label">${esc(labelOf(current))}</span><span class="ui-dd-caret" aria-hidden="true">▾</span></button>` +
      `<div class="ui-dd-menu" id="${uid}" role="listbox"${nameAttr} hidden>${options.map((o, i) => `<div class="ui-dd-item${o.value === current ? ' sel' : ''}" id="${uid}-o${i}" role="option" aria-selected="${o.value === current ? 'true' : 'false'}" data-val="${esc(o.value)}">${esc(o.label)}</div>`).join('')}</div>`;
    const btn = root.querySelector('.ui-dd-btn') as HTMLButtonElement;
    const menu = root.querySelector('.ui-dd-menu') as HTMLElement;
    const labelEl = root.querySelector('.ui-dd-label') as HTMLElement;
    const items = [...root.querySelectorAll<HTMLElement>('.ui-dd-item')];
    const isOpen = () => !menu.hasAttribute('hidden');
    const focusedIndex = () =>
      document.activeElement instanceof HTMLElement ? items.indexOf(document.activeElement) : -1;

    const open = (focusIndex: number) => {
      menu.removeAttribute('hidden');
      btn.setAttribute('aria-expanded', 'true');
      items[focusIndex]?.focus();
      setTimeout(() => document.addEventListener('click', onAway, { once: true }), 0);
    };
    const close = (returnFocus = true) => {
      if (!isOpen()) return;
      menu.setAttribute('hidden', '');
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', onAway);
      if (returnFocus) btn.focus();
    };
    const onAway = () => close(false);
    const commit = (item: HTMLElement) => {
      const v = item.getAttribute('data-val') ?? '';
      root.dataset.value = v;
      labelEl.textContent = labelOf(v);
      items.forEach((x) => {
        const sel = x === item;
        x.classList.toggle('sel', sel);
        x.setAttribute('aria-selected', sel ? 'true' : 'false');
      });
      close();
      onChange?.(v);
    };

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isOpen()) close(false);
      else
        open(
          Math.max(
            0,
            items.findIndex((it) => it.classList.contains('sel')),
          ),
        );
    });
    // tabindex=-1 keeps options out of the Tab order but programmatically focusable.
    items.forEach((item) => {
      item.tabIndex = -1;
      item.addEventListener('click', () => commit(item));
    });
    root.addEventListener('keydown', (e) => {
      const action = dropdownKeyNav(e.key, isOpen(), focusedIndex(), items.length);
      if (action.kind === 'none') return;
      // Tab closes the menu and returns focus to the trigger button (a real
      // tab-order element) WITHOUT preventDefault, so the native Tab/Shift+Tab
      // then deterministically advances/retreats from there. Without returning
      // focus, display:none-ing the focused option would drop focus to <body>.
      if (action.kind === 'tab') {
        close(true);
        return;
      }
      e.preventDefault();
      switch (action.kind) {
        case 'open':
          open(action.index);
          break;
        case 'move':
          items[action.index]?.focus();
          break;
        case 'select': {
          const cur = items[focusedIndex()];
          if (cur) commit(cur);
          break;
        }
        case 'close':
          close();
          break;
      }
    });
    return root;
  }

  // Reset a buildDropdown's visible label + dataset.value + aria-selected to a
  // value in place, WITHOUT firing onChange or rebuilding the node. Used to
  // revert the language picker after a failed locale switch so the trigger never
  // advertises a language that never loaded (and so the adjacent aria-live status
  // node survives to announce the failure). Mirrors commit()'s DOM writes.
  private setDropdownValue(root: HTMLElement, value: string): void {
    const items = [...root.querySelectorAll<HTMLElement>('.ui-dd-item')];
    const match = items.find((x) => x.getAttribute('data-val') === value) ?? null;
    root.dataset.value = value;
    const labelEl = root.querySelector('.ui-dd-label');
    if (labelEl && match) labelEl.textContent = match.textContent;
    items.forEach((x) => {
      const sel = x === match;
      x.classList.toggle('sel', sel);
      x.setAttribute('aria-selected', sel ? 'true' : 'false');
    });
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
    pop.innerHTML = (node.choices ?? [])
      .map((o) => {
        const sel = stage.choices[node.id] === o.id;
        return (
          `<div class="tal-choice-opt${sel ? ' sel' : ''}" role="menuitemradio" tabindex="0" aria-checked="${sel}" data-opt="${esc(o.id)}"><span class="tco-icon" style="background-image:url(${esc(talentChoiceIconDataUrl(o))})"></span>` +
          `<span class="tco-text"><b>${esc(tTalent({ kind: 'talentChoice', choice: o, field: 'name' }))}</b><span>${esc(tTalent({ kind: 'talentChoice', choice: o, field: 'description' }))}</span></span></div>`
        );
      })
      .join('');
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
        cand.ranks[node.id] = 1;
        cand.choices[node.id] = optId;
        if (!validateAllocation(cls, cand, total).ok) {
          pop.remove();
          return;
        } // can't afford / gated
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
        if (ke.key === 'Escape') {
          ke.preventDefault();
          pop.remove();
          anchor.focus();
          return;
        }
        this.keyboardActivate(ke, () => choose(optEl));
      });
    });
    const firstOpt = (pop.querySelector('.tal-choice-opt.sel') ??
      pop.querySelector('.tal-choice-opt')) as HTMLElement | null;
    firstOpt?.focus();
    setTimeout(() => document.addEventListener('click', () => pop.remove(), { once: true }), 0);
  }

  toggleLeaderboard(): void {
    const el = $('#leaderboard-window');
    if (el.style.display === 'block') {
      el.style.display = 'none';
      this.hideTooltip();
      return;
    }
    this.closeOtherWindows('#leaderboard-window');
    this.leaderboardPage = 0;
    el.style.display = 'block';
    void this.renderLeaderboard();
  }

  async renderLeaderboard(): Promise<void> {
    const el = $('#leaderboard-window');
    const myName = this.sim.player.name;
    el.innerHTML =
      `<div class="panel-title"><span>${t('game.leaderboard.title')} <span style="color:#998d6a;font-size:11px">${t('game.leaderboard.subtitle')}${this.sim.realm ? ` &middot; ${this.sim.realm}` : ''}</span></span><span class="x-btn" data-close>${svgIcon('close')}</span></div>` +
      `<div class="lb-body"><div class="lb-loading">${t('game.leaderboard.loading')}</div></div>`;
    el.querySelector('[data-close]')?.addEventListener('click', () => {
      el.style.display = 'none';
    });

    let result: LeaderboardPage | null = null;
    try {
      result = await this.sim.leaderboard(this.leaderboardPage, LEADERBOARD_PAGE_SIZE);
    } catch {
      result = null;
    }
    // panel may have been closed while the fetch was in flight
    if (el.style.display !== 'block') return;
    const body = el.querySelector('.lb-body')!;
    const rows = result?.leaders ?? [];
    if (rows.length === 0) {
      body.innerHTML = `<div class="lb-empty">${t('game.leaderboard.empty')}</div>`;
      return;
    }
    // The server clamps the requested page; mirror its answer so the pager state
    // never drifts past the real last page.
    this.leaderboardPage = result?.page ?? 0;
    const header = `<div class="lb-row lb-head"><span class="lb-rank">${t('game.leaderboard.rank')}</span><span class="lb-name">${t('game.leaderboard.name')}</span><span class="lb-lvl">${t('game.leaderboard.level')}</span><span class="lb-vlvl">${t('game.leaderboard.vlevel')}</span><span class="lb-xp">${t('game.leaderboard.lifetimeXp')}</span></div>`;
    const rowHtml = (r: LeaderboardEntry, mine: boolean): string => {
      const cls = CLASSES[r.cls];
      const star =
        r.prestigeRank > 0
          ? `<span class="lb-prestige" title="${t('game.prestige.rank')} ${r.prestigeRank}">★${r.prestigeRank}</span> `
          : '';
      const title = cls ? ` title="${esc(classDisplayName(r.cls))}"` : '';
      return (
        `<div class="lb-row${mine ? ' lb-mine' : ''}"><span class="lb-rank">${r.rank}</span>` +
        `<span class="lb-name"${title}>${star}${r.name}${mine ? ` <span class="lb-you">(${t('game.leaderboard.you')})</span>` : ''}</span>` +
        `<span class="lb-lvl">${r.level}</span><span class="lb-vlvl">${r.virtualLevel}</span><span class="lb-xp">${formatXp(r.lifetimeXp)}</span></div>`
      );
    };
    const mineIndex = rows.findIndex((r) => r.name === myName);
    let html = header + rows.map((r) => rowHtml(r, r.name === myName)).join('');
    // sticky "your standing" row when the viewer is outside the visible page
    if (mineIndex === -1) {
      html += `<div class="lb-sticky"><div class="lb-row lb-mine"><span class="lb-rank">—</span><span class="lb-name">${myName} <span class="lb-you">(${t('game.leaderboard.you')})</span></span><span class="lb-lvl">${this.sim.player.level}</span><span class="lb-vlvl">${virtualLevel(this.sim.lifetimeXp)}</span><span class="lb-xp">${formatXp(this.sim.lifetimeXp)}</span></div></div>`;
    }
    html += this.leaderboardPagerHtml(result!);
    body.innerHTML = html;
    body.querySelectorAll<HTMLButtonElement>('[data-leaderboard-page]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.disabled) return;
        this.leaderboardPage += button.dataset.leaderboardPage === 'next' ? 1 : -1;
        if (this.leaderboardPage < 0) this.leaderboardPage = 0;
        void this.renderLeaderboard();
      });
    });
  }

  // Prev/Next pager for the leaderboard, mirroring the World Market browse pager.
  // Reuses the Market pager's generic, fully-localized page strings ("Page X of
  // Y", "Prev"/"Next"); the visible button text is the accessible name. Hidden
  // when the whole board fits on one page.
  private leaderboardPagerHtml(page: LeaderboardPage): string {
    if (page.pageCount <= 1) return '';
    const current = formatNumber(page.page + 1, { maximumFractionDigits: 0 });
    const total = formatNumber(page.pageCount, { maximumFractionDigits: 0 });
    const status = t('itemUi.market.pageStatus', { current, total });
    return (
      `<div class="lb-pager">` +
      `<button type="button" class="lb-page-btn" data-leaderboard-page="prev"${page.page <= 0 ? ' disabled' : ''}>${esc(t('itemUi.market.pagePrev'))}</button>` +
      `<span class="lb-page-status">${esc(status)}</span>` +
      `<button type="button" class="lb-page-btn" data-leaderboard-page="next"${page.page >= page.pageCount - 1 ? ' disabled' : ''}>${esc(t('itemUi.market.pageNext'))}</button>` +
      `</div>`
    );
  }

  // -------------------------------------------------------------------------
  // Spellbook
  // -------------------------------------------------------------------------

  toggleSpellbook(): void {
    const el = $('#spellbook');
    if (el.style.display === 'block') {
      el.style.display = 'none';
      this.hideTooltip();
      return;
    }
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
    // "Reset bar" only applies to classes with per-form bars (druid); other
    // classes have a single bar, so the button is omitted for them.
    const resetBtnHtml = this.classHasFormBars()
      ? `<button type="button" class="x-btn spellbook-reset" data-reset-bar aria-label="${esc(t('abilityUi.spellbook.resetBarAria'))}">${esc(t('abilityUi.spellbook.resetBar'))}</button>`
      : '';
    el.innerHTML = `<div class="panel-title"><span>${esc(t('abilityUi.spellbook.title'))} <span class="spellbook-class">${esc(t('abilityUi.spellbook.classSubtitle', { className }))}</span></span><div class="panel-title-actions">${resetBtnHtml}<button type="button" class="x-btn" data-close aria-label="${esc(t('abilityUi.spellbook.close'))}">${svgIcon('close')}</button></div></div>`;
    const list = document.createElement('div');
    list.className = 'spell-list';
    list.setAttribute('role', 'list');
    el.appendChild(list);
    let rendered = 0;
    for (const abilityId of cls.abilities) {
      const def = ABILITIES[abilityId];
      const known = sim.known.find((k) => k.def.id === abilityId) ?? null;
      const row = document.createElement('div');
      row.className = `spell-row${known ? '' : ' locked'}`;
      row.tabIndex = 0;
      row.setAttribute('role', 'listitem');
      const locked = !known;
      const summary = known ? describeAbilitySummary(known, sim.player.resourceType) : '';
      const name = abilityDisplayName(def);
      const learnLevel = formatAbilityNumber(def.learnLevel);
      row.setAttribute(
        'aria-label',
        known
          ? t('abilityUi.spellbook.knownAbilityAria', {
              name,
              rank: formatAbilityNumber(known.rank),
              summary,
            })
          : t('abilityUi.spellbook.unlearnedAbilityAria', { name, level: learnLevel }),
      );
      row.innerHTML = `<div class="spell-icon" style="background-image:url(${iconDataUrl('ability', abilityId)})"></div>
        <div class="spell-text"><div class="spell-name">${esc(name)}${known && known.rank > 1 ? ` <span class="spell-rank">${esc(t('abilityUi.tooltip.rank', { rank: formatAbilityNumber(known.rank) }))}</span>` : ''}</div>
        <div class="spell-sub">${locked ? esc(t('abilityUi.spellbook.trainableAtLevel', { level: learnLevel })) : esc(summary)}</div></div>`;
      if (known) {
        const onBar = this.hotbarIndexForAbility(known.def.id) !== -1;
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = `spell-hotbar-toggle${onBar ? ' remove' : ''}`;
        toggle.dataset.abilityId = known.def.id;
        toggle.textContent = onBar ? '-' : '+';
        toggle.setAttribute('aria-label', `${name} ${onBar ? '-' : '+'}`);
        toggle.setAttribute('aria-pressed', onBar ? 'true' : 'false');
        toggle.disabled = !onBar && this.firstEmptyHotbarIndex() === -1;
        toggle.addEventListener('pointerdown', (ev) => ev.stopPropagation());
        toggle.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const changed =
            this.hotbarIndexForAbility(known.def.id) !== -1
              ? this.removeAbilityFromHotbar(known.def.id)
              : this.addAbilityToHotbar(known.def.id);
          if (!changed) return;
          audio.click();
          this.refreshSpellbookHotbarControls();
        });
        row.appendChild(toggle);
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
        this.attachTooltip(
          row,
          () =>
            `<div class="tt-title">${esc(name)}</div><div class="tt-sub">${esc(t('abilityUi.spellbook.learnAtLevel', { level: learnLevel }))}</div>`,
        );
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
    el.querySelector('[data-close]')?.addEventListener('click', () => {
      el.style.display = 'none';
      this.hideTooltip();
    });
    const resetBtn = el.querySelector('[data-reset-bar]');
    resetBtn?.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    resetBtn?.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.resetActiveFormBarToDefault();
      audio.click();
    });
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
    if (el.style.display === 'block') {
      el.style.display = 'none';
      this.hideTooltip();
      this.talentStage = null;
      return;
    }
    this.closeOtherWindows('#talents-window');
    this.talentStage = cloneAllocation(this.sim.talents);
    this.renderTalents();
    el.style.display = 'block';
  }

  private roleLabel(role: Role): string {
    return role === 'tank'
      ? t('game.talents.roleTank')
      : role === 'healer'
        ? t('game.talents.roleHealer')
        : t('game.talents.roleDps');
  }

  private keyboardActivate(e: KeyboardEvent, action: () => void): void {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    action();
  }

  renderTalents(): void {
    const el = $('#talents-window');
    if (el.style.display !== 'block' && this.talentStage === null) return;
    const cls = this.sim.cfg.playerClass;
    const ct = talentsFor(cls);
    const close = `<span class="x-btn" data-close>${svgIcon('close')}</span>`;
    if (!ct) {
      el.innerHTML =
        `<div class="panel-title"><span>${t('game.talents.title')} <span style="color:#998d6a;font-size:11px">${esc(classDisplayName(cls))}</span></span>${close}</div>` +
        `<div class="tal-empty tal-coming-soon" data-talents-coming-soon>` +
        `<b>${t('game.talents.comingSoonTitle')}</b>` +
        `<span>${t('game.talents.comingSoonBody')}</span>` +
        `</div>`;
      el.querySelector('[data-close]')?.addEventListener('click', () => {
        el.style.display = 'none';
        this.hideTooltip();
      });
      return;
    }
    if (!this.talentStage) this.talentStage = cloneAllocation(this.sim.talents);
    const stage = this.talentStage;
    const total = this.sim.talentPoints().total;
    const spent = pointsSpent(stage);
    const treeSpent = (tree: 'class' | 'spec') =>
      ct.nodes
        .filter((n) => n.tree === tree && (tree === 'class' || n.specId === stage.spec))
        .reduce((a, n) => a + (stage.ranks[n.id] ?? 0), 0);

    el.innerHTML =
      `<div class="panel-title"><span>${t('game.talents.title')} <span style="color:#998d6a;font-size:11px">${esc(classDisplayName(cls))}</span></span>${close}</div>` +
      `<div class="tal-head"><span>${t('game.talents.available')}: <b>${Math.max(0, total - spent)}</b> / ${total}</span><span>${t('game.talents.spent')}: <b>${spent}</b></span></div>` +
      `<div class="tal-help">${esc(t('game.talents.pointSource').replace('{first}', String(FIRST_TALENT_LEVEL)).replace('{cap}', String(MAX_LEVEL)))}</div>` +
      `<div class="tal-tabs" role="tablist" aria-label="${esc(t('game.talents.title'))}">` +
      `<div class="tal-tab${this.talentTab === 'class' ? ' active' : ''}" role="tab" tabindex="${this.talentTab === 'class' ? '0' : '-1'}" aria-selected="${this.talentTab === 'class'}" aria-controls="tal-body" data-tab="class"><span class="tal-tab-label">${t('game.talents.classTab')}</span><span class="tt-pts">${treeSpent('class')}</span></div>` +
      `<div class="tal-tab${this.talentTab === 'spec' ? ' active' : ''}" role="tab" tabindex="${this.talentTab === 'spec' ? '0' : '-1'}" aria-selected="${this.talentTab === 'spec'}" aria-controls="tal-body" data-tab="spec"><span class="tal-tab-label">${t('game.talents.specTab')}</span><span class="tt-pts">${treeSpent('spec')}</span></div>` +
      `</div><div id="tal-body" role="tabpanel"></div>` +
      this.talentFooterHtml(stage, total, spent);

    const switchTab = (tab: HTMLElement) => {
      this.talentTab = tab.dataset.tab as 'class' | 'spec';
      this.renderTalents();
    };
    el.querySelectorAll('.tal-tab').forEach((tab) => {
      tab.addEventListener('click', () => switchTab(tab as HTMLElement));
      tab.addEventListener('keydown', (e) =>
        this.keyboardActivate(e as KeyboardEvent, () => switchTab(tab as HTMLElement)),
      );
    });
    el.querySelector('[data-close]')?.addEventListener('click', () => {
      el.style.display = 'none';
      this.hideTooltip();
      this.talentStage = null;
    });

    const body = el.querySelector('#tal-body') as HTMLElement;
    if (this.talentTab === 'class') {
      const tree = document.createElement('div');
      tree.className = 'tal-tree';
      body.appendChild(tree);
      this.renderTalentTree(tree, ct, stage, 'class', undefined);
    } else {
      this.renderSpecTab(body, ct, stage);
    }
    this.wireTalentFooter(el, stage, total);
  }

  private renderSpecTab(
    body: HTMLElement,
    ct: NonNullable<ReturnType<typeof talentsFor>>,
    stage: TalentAllocation,
  ): void {
    const picker = document.createElement('div');
    picker.className = 'tal-specs';
    picker.setAttribute('role', 'radiogroup');
    picker.setAttribute('aria-label', t('game.talents.specTab'));
    for (const sp of ct.specs) {
      const card = document.createElement('div');
      const selected = stage.spec === sp.id;
      card.className = `tal-spec${selected ? ' sel' : ''}`;
      card.setAttribute('role', 'radio');
      card.setAttribute('tabindex', selected || !stage.spec ? '0' : '-1');
      card.setAttribute('aria-checked', String(selected));
      const specName = tTalent({ kind: 'talentSpec', spec: sp, field: 'name' });
      const specDescription = tTalent({ kind: 'talentSpec', spec: sp, field: 'description' });
      const masteryName = tTalent({ kind: 'talentMastery', spec: sp, field: 'name' });
      const masteryDescription = tTalent({ kind: 'talentMastery', spec: sp, field: 'description' });
      card.setAttribute('aria-label', `${specName}, ${this.roleLabel(sp.role)}`);
      card.innerHTML = `<div class="ts-icon">${esc(sp.icon)}</div><div class="ts-name">${esc(specName)}</div><div class="ts-role">${this.roleLabel(sp.role)}</div>`;
      this.attachTooltip(
        card,
        () =>
          `<div class="tt-title">${esc(specName)}</div><div class="tt-sub">${esc(specDescription)}</div>` +
          `<div class="tt-sub" style="color:#ffd100">${t('game.talents.signature')}: ${esc(ABILITIES[sp.signature] ? abilityDisplayName(ABILITIES[sp.signature]) : sp.signature)}</div>` +
          `<div class="tt-sub">${t('game.talents.mastery')}: ${esc(masteryName)} — ${esc(masteryDescription)}</div>`,
      );
      card.addEventListener('click', () => this.stageSetSpec(stage, sp.id));
      card.addEventListener('keydown', (e) =>
        this.keyboardActivate(e as KeyboardEvent, () => this.stageSetSpec(stage, sp.id)),
      );
      picker.appendChild(card);
    }
    body.appendChild(picker);
    const sp = ct.specs.find((s) => s.id === stage.spec);
    if (!sp) {
      const e = document.createElement('div');
      e.className = 'tal-empty';
      e.textContent = t('game.talents.chooseSpec');
      body.appendChild(e);
      return;
    }
    const m = document.createElement('div');
    m.className = 'tal-mastery';
    m.innerHTML = `<b>${t('game.talents.mastery')}: ${esc(tTalent({ kind: 'talentMastery', spec: sp, field: 'name' }))}</b> — ${esc(tTalent({ kind: 'talentMastery', spec: sp, field: 'description' }))}`;
    body.appendChild(m);
    const tree = document.createElement('div');
    tree.className = 'tal-tree';
    body.appendChild(tree);
    this.renderTalentTree(tree, ct, stage, 'spec', sp.id);
  }

  private stageSetSpec(stage: TalentAllocation, specId: string): void {
    if (stage.spec === specId) return;
    stage.spec = specId;
    const ct = talentsFor(this.sim.cfg.playerClass);
    for (const id of Object.keys(stage.ranks)) {
      const n = ct?.nodes.find((x) => x.id === id);
      if (n?.tree === 'spec' && n.specId !== specId) {
        delete stage.ranks[id];
        delete stage.choices[id];
      }
    }
    this.renderTalents();
  }

  private renderTalentTree(
    host: HTMLElement,
    ct: NonNullable<ReturnType<typeof talentsFor>>,
    stage: TalentAllocation,
    tree: 'class' | 'spec',
    specId: string | undefined,
  ): void {
    const cls = this.sim.cfg.playerClass;
    const nodes = ct.nodes.filter(
      (n) => n.tree === tree && (tree === 'class' || n.specId === specId),
    );
    if (nodes.length === 0) {
      host.innerHTML = `<div class="tal-empty">${t('game.talents.pickSpecFirst')}</div>`;
      return;
    }
    const cols = Math.max(...nodes.map((n) => n.col)) + 1;
    const rows = Math.max(...nodes.map((n) => n.row)) + 1;
    const CW = 86,
      CH = 70,
      NS = 46,
      TOP = 6;
    const W = cols * CW,
      H = rows * CH + TOP;
    host.style.width = `${W}px`;
    host.style.height = `${H}px`;
    const cx = (n: TalentNode) => n.col * CW + CW / 2;
    const cy = (n: TalentNode) => n.row * CH + TOP + NS / 2;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const dormant = dormantNodes(cls, stage);
    const total = this.sim.talentPoints().total;

    let svg = `<svg class="tal-arrows" width="${W}" height="${H}">`;
    for (const n of nodes)
      for (const req of n.requires ?? []) {
        const r = byId.get(req);
        if (!r) continue;
        const filled = (stage.ranks[req] ?? 0) > 0;
        svg += `<line x1="${cx(r)}" y1="${cy(r) + NS / 2}" x2="${cx(n)}" y2="${cy(n) - NS / 2}" stroke="${filled ? '#f5c843' : '#5a4a22'}" stroke-width="2"/>`;
      }
    host.insertAdjacentHTML('beforeend', `${svg}</svg>`);

    for (const n of nodes) {
      const ranks = stage.ranks[n.id] ?? 0;
      const isDormant = dormant.has(n.id);
      const cand = cloneAllocation(stage);
      cand.ranks[n.id] = ranks + 1;
      if (n.kind === 'choice' && !cand.choices[n.id] && n.choices?.[0]) {
        cand.choices[n.id] = n.choices[0].id;
      }
      const canAdd = ranks < n.maxRank && validateAllocation(cls, cand, total).ok;
      const shape = n.kind === 'active' ? 'square' : n.kind === 'choice' ? 'octagon' : 'circle';
      const state = isDormant
        ? 'dormant'
        : ranks >= n.maxRank
          ? 'maxed'
          : ranks > 0
            ? 'filled'
            : canAdd
              ? 'avail'
              : 'locked';
      const chosen =
        n.kind === 'choice' ? n.choices?.find((c) => c.id === stage.choices[n.id]) : undefined;
      const div = document.createElement('div');
      div.className = `tal-node ${shape} ${state}`;
      div.setAttribute('role', 'button');
      div.setAttribute('tabindex', '0');
      div.setAttribute('aria-pressed', String(ranks > 0));
      if (!canAdd && ranks <= 0) div.setAttribute('aria-disabled', 'true');
      const nodeName = tTalent({ kind: 'talentNode', node: n, field: 'name' });
      const chosenLabel = chosen
        ? `, ${tTalent({ kind: 'talentChoice', choice: chosen, field: 'name' })}`
        : '';
      div.setAttribute(
        'aria-label',
        `${nodeName}${chosenLabel}, ${t('game.talents.rank')} ${ranks}/${n.maxRank}`,
      );
      div.style.left = `${n.col * CW + (CW - NS) / 2}px`;
      div.style.top = `${n.row * CH + TOP}px`;
      const icon = document.createElement('span');
      icon.className = 'tal-icon';
      icon.style.backgroundImage = `url(${chosen ? talentChoiceIconDataUrl(chosen) : talentNodeIconDataUrl(n)})`;
      div.appendChild(icon);
      if (ranks > 0 || n.maxRank > 1) {
        const badge = document.createElement('span');
        badge.className = 'tal-rank';
        badge.textContent = `${ranks}/${n.maxRank}`;
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
      div.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.talentNodeRemove(stage, n);
      });
      host.appendChild(div);
    }
  }

  private talentNodeClick(stage: TalentAllocation, n: TalentNode): void {
    const cls = this.sim.cfg.playerClass;
    const total = this.sim.talentPoints().total;
    const ranks = stage.ranks[n.id] ?? 0;
    if (ranks >= n.maxRank) return;
    const cand = cloneAllocation(stage);
    cand.ranks[n.id] = ranks + 1;
    if (!validateAllocation(cls, cand, total).ok) return;
    stage.ranks[n.id] = ranks + 1;
    this.renderTalents();
  }

  private talentNodeRemove(stage: TalentAllocation, n: TalentNode): void {
    const ranks = stage.ranks[n.id] ?? 0;
    if (ranks <= 0) return;
    if (ranks - 1 <= 0) {
      delete stage.ranks[n.id];
      delete stage.choices[n.id];
    } else stage.ranks[n.id] = ranks - 1;
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
      const names = n.requires
        .map((r) => {
          const required = ct?.nodes.find((x) => x.id === r);
          return required ? tTalent({ kind: 'talentNode', node: required, field: 'name' }) : r;
        })
        .join(', ');
      html += `<div class="tt-sub" style="color:#caa">${t('game.talents.requires')}: ${esc(names)}</div>`;
    }
    if (n.pointsGate)
      html += `<div class="tt-sub" style="color:#caa">${n.pointsGate} ${t('game.talents.pointsGate')}</div>`;
    if (isDormant)
      html += `<div class="tt-sub" style="color:#e0635a">${t('game.talents.dormant')}</div>`;
    html += `<div class="tt-sub" style="color:#8aa">${t('game.talents.editHint')}</div>`;
    return html;
  }

  private talentFooterHtml(stage: TalentAllocation, total: number, spent: number): string {
    const cls = this.sim.cfg.playerClass;
    const valid = validateAllocation(cls, stage, total).ok;
    return (
      `<div class="tal-foot">` +
      `<section class="tal-build-card tal-build-current" aria-label="${esc(t('game.talents.currentBuild'))}">` +
      `<div class="tal-build-head"><span>${t('game.talents.currentBuild')}</span><span class="tal-loadslot"></span></div>` +
      `<div class="tal-build-actions">` +
      `<button class="btn tal-primary" data-act="save"${valid ? '' : ' disabled'}>${t('game.talents.saveBuild')}</button>` +
      `<button class="btn tal-secondary" data-act="export">${t('game.talents.export')}</button>` +
      `<button class="btn tal-secondary" data-act="del"${this.sim.activeLoadout >= 0 ? '' : ' disabled'}>${t('game.talents.deleteBuild')}</button>` +
      `<button class="btn tal-secondary" data-act="clear"${spent > 0 ? '' : ' disabled'}>${t('game.talents.clear')}</button>` +
      `</div>` +
      `<div class="tal-build-help">${t('game.talents.currentBuildHint')}</div>` +
      `</section>` +
      `<section class="tal-build-card tal-build-create" aria-label="${esc(t('game.talents.createBuild'))}">` +
      `<div class="tal-build-head"><span>${t('game.talents.createBuild')}</span></div>` +
      `<div class="tal-build-actions">` +
      `<button class="btn tal-primary" data-act="new"${valid ? '' : ' disabled'}>${t('game.talents.newBuild')}</button>` +
      `<button class="btn tal-secondary" data-act="import">${t('game.talents.import')}</button>` +
      `</div>` +
      `<div class="tal-build-help">${t('game.talents.createBuildHint')}</div>` +
      `</section>` +
      `</div>`
    );
  }

  private wireTalentFooter(el: HTMLElement, stage: TalentAllocation, total: number): void {
    const cls = this.sim.cfg.playerClass;
    el.querySelector('[data-act="clear"]')?.addEventListener('click', () => {
      stage.ranks = {};
      stage.choices = {};
      this.renderTalents();
    });
    const saveStagedBuild = (name: string): void => {
      const n = name.trim();
      if (!n) return;
      this.sim.saveLoadout(
        n,
        this.hotbarActions.map((a) => (a && a.type === 'ability' ? a.id : null)),
        cloneAllocation(stage),
      );
      this.talentStage = cloneAllocation(stage);
      this.renderTalents();
    };
    const promptNewBuild = (): void => {
      this.inputDialog({
        title: t('game.talents.saveBuildAs'),
        label: t('game.talents.namePrompt'),
        value: t('hudChrome.talents.defaultBuildName', { n: this.sim.loadouts.length + 1 }),
        okText: t('game.talents.save'),
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
      const current =
        this.sim.activeLoadout >= 0
          ? String(this.sim.activeLoadout)
          : this.sim.loadouts.length
            ? ''
            : '-1';
      slot.replaceWith(
        this.buildDropdown(
          opts,
          current,
          (v) => {
            const i = parseInt(v, 10);
            const lo = this.sim.loadouts[i];
            if (!lo) return;
            this.sim.switchLoadout(i);
            this.applyLoadoutBar(lo.bar);
            this.talentStage = cloneAllocation(lo.alloc);
            this.renderTalents();
          },
          t('game.talents.loadouts'),
          { ariaLabel: t('game.talents.loadouts') },
        ),
      );
    }
    el.querySelector('[data-act="del"]')?.addEventListener('click', () => {
      if (this.sim.activeLoadout < 0) {
        this.showError(t('game.talents.selectBuildFirst'));
        return;
      }
      const active = this.sim.loadouts[this.sim.activeLoadout];
      if (!active) {
        this.showError(t('game.talents.selectBuildFirst'));
        return;
      }
      const body = t('game.talents.deleteBuildBody', { name: active.name });
      this.confirmDialog(
        t('game.talents.deleteBuildTitle'),
        body,
        t('game.talents.deleteBuildConfirm'),
        t('game.talents.cancel'),
        () => {
          this.sim.deleteLoadout(this.sim.activeLoadout);
          this.renderTalents();
        },
      );
    });
    el.querySelector('[data-act="export"]')?.addEventListener('click', () => {
      const active = this.sim.activeLoadout >= 0 ? this.sim.loadouts[this.sim.activeLoadout] : null;
      this.inputDialog({
        title: t('game.talents.export'),
        label: t('game.talents.exportTitle'),
        value: exportBuild(cls, active?.alloc ?? stage),
        multiline: true,
        readOnly: true,
        copy: true,
        cancelText: t('game.talents.close'),
      });
    });
    el.querySelector('[data-act="import"]')?.addEventListener('click', () => {
      this.inputDialog({
        title: t('game.talents.import'),
        label: t('game.talents.importPrompt'),
        placeholder: 'eyJ2Ijox…',
        multiline: true,
        okText: t('game.talents.import'),
        onOk: (str) => {
          const res = importBuild(str.trim());
          if (!res.ok || res.cls !== cls) {
            this.showError(t('game.talents.invalidBuild'));
            return;
          }
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
    if (el.style.display === 'block') {
      this.closeQuestLog();
      return;
    }
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
    el.innerHTML = `<div class="panel-title"><span id="quest-log-title">${esc(t('questUi.log.title'))} <span class="quest-muted">${esc(
      t('questUi.log.summary', {
        active: this.questNumber(sim.questLog.size),
        completed: this.questNumber(sim.questsDone.size),
      }),
    )}</span></span><button type="button" class="x-btn" data-close aria-label="${esc(t('questUi.log.close'))}">${svgIcon('close')}</button></div>`;
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
      detail.innerHTML = `<div class="ql-detail-body"><div class="qd-text">${esc(t('questUi.log.emptyHint'))}</div></div>`;
    }
    if (!this.selectedQuestLogId || !sim.questLog.has(this.selectedQuestLogId)) {
      this.selectedQuestLogId = quests[0]?.questId ?? null;
    }
    for (const qp of quests) {
      const _quest = QUESTS[qp.questId];
      const item = document.createElement('button');
      const status =
        qp.state === 'ready' ? t('questUi.log.readyStatus') : t('questUi.log.activeStatus');
      const title = questTitle(qp.questId);
      item.type = 'button';
      item.className = `ql-item${qp.questId === this.selectedQuestLogId ? ' sel' : ''}`;
      item.setAttribute('aria-pressed', qp.questId === this.selectedQuestLogId ? 'true' : 'false');
      item.setAttribute('aria-label', t('questUi.log.selectedQuestAria', { name: title, status }));
      item.title = t('hudChrome.questShare.linkTitle');
      item.innerHTML = `${esc(title)}${qp.state === 'ready' ? ` <span class="quest-complete">(${esc(t('questUi.log.readyStatus'))})</span>` : ''}`;
      item.addEventListener('click', (ev) => {
        if (ev.shiftKey) {
          this.insertQuestChatLink(qp.questId);
          return;
        }
        this.selectedQuestLogId = qp.questId;
        this.renderQuestLog();
      });
      list.appendChild(item);
    }
    if (this.selectedQuestLogId) {
      const qp = sim.questLog.get(this.selectedQuestLogId)!;
      const quest = QUESTS[this.selectedQuestLogId];
      let html = `<div class="qd-sub ql-detail-title">${esc(questTitle(this.selectedQuestLogId))}${this.questSuggestedPlayersHtml(quest.suggestedPlayers)}</div>`;
      html += quest.objectives
        .map(
          (o, i) =>
            `<div class="qd-obj${qp.counts[i] >= o.count ? ' done' : ''}">${esc(this.questProgressText(questObjectiveLabel(this.selectedQuestLogId!, i), qp.counts[i], o.count))}</div>`,
        )
        .join('');
      html += `<div class="qd-text ql-detail-text">${esc(questNarrative(this.selectedQuestLogId, 'text', sim.player.name))}</div>`;
      html += `<div class="qd-sub">${esc(t('questUi.detail.rewards'))}</div><div class="qd-obj">${esc(t('questUi.detail.xpReward', { xp: this.questNumber(quest.xpReward) }))} &nbsp; ${this.moneyHtml(quest.copperReward)}</div>`;
      const rewardItem = questRewardItem(quest, sim.cfg.playerClass);
      if (rewardItem) {
        const item = ITEMS[rewardItem];
        html += `<div class="qd-reward-row" data-reward><span class="qd-reward-label">${esc(t('questUi.detail.itemReward'))}</span>${this.itemIcon(item)}<span class="qd-reward-name" style="color:${QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff'}">${esc(itemDisplayName(item))}</span></div>`;
      }
      const giver = NPCS[quest.turnInNpcId];
      html += `<div class="qd-obj quest-return">${esc(t('questUi.log.returnTo', { name: giver ? npcDisplayName(giver.id) : '?' }))}</div>`;
      const body = document.createElement('div');
      body.className = 'ql-detail-body';
      body.innerHTML = html;
      detail.replaceChildren(body);
      const rewardRow = body.querySelector('[data-reward]') as HTMLElement | null;
      if (rewardRow && rewardItem)
        this.attachTooltip(rewardRow, () => this.itemTooltip(ITEMS[rewardItem]));
      const actions = document.createElement('div');
      actions.className = 'ql-detail-actions';
      const abandon = document.createElement('button');
      abandon.className = 'btn';
      abandon.type = 'button';
      abandon.textContent = t('questUi.log.abandon');
      abandon.addEventListener('click', () => {
        const questId = this.selectedQuestLogId;
        if (!questId) return;
        this.confirmDialog(
          t('questUi.log.abandonConfirmTitle'),
          t('questUi.log.abandonConfirmBody', { name: questTitle(questId) }),
          t('questUi.log.abandonConfirm'),
          t('questUi.log.abandonCancel'),
          () => {
            sim.abandonQuest(questId);
            this.selectedQuestLogId = null;
            this.renderQuestLog();
          },
        );
      });
      actions.appendChild(abandon);
      detail.appendChild(actions);
    }
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeQuestLog());
    this.focusFirstInteractive(el);
  }

  // -------------------------------------------------------------------------
  // Party frames
  // -------------------------------------------------------------------------

  private updatePartyFrames(): void {
    const el = $('#party-frames');
    const target =
      this.sim.player.targetId !== null ? this.sim.entities.get(this.sim.player.targetId) : null;
    el.classList.toggle('below-target', !!target && target.kind !== 'object');
    const info = this.sim.partyInfo;
    if (!info) {
      if (el.innerHTML !== '') el.innerHTML = '';
      this.lastPartySig = '';
      return;
    }
    const myGroup = info.members.find((m) => m.pid === this.sim.playerId)?.group ?? 1;
    const others = selectPartyFrameMembers(info, this.sim.playerId, this.sim.player.pos);
    // include combat/range state so the frames rebuild when a badge changes
    const sig = `${others.map((m) => `${m.pid}:${m.group}:${m.hp}/${m.mhp}:${m.res}:${m.dead}:${m.inCombat}:${m.oor ? 1 : 0}:${m.level}`).join('|')}L${info.leader}:R${info.raid ? 1 : 0}:G${myGroup}`;
    if (sig === this.lastPartySig) return;
    this.lastPartySig = sig;
    el.innerHTML = '';
    for (const m of others) {
      const frame = document.createElement('div');
      frame.className =
        'party-frame panel' +
        (m.dead ? ' dead' : m.inCombat ? ' combat' : '') +
        (m.oor ? ' oor' : '');
      frame.style.setProperty('--cls', classCss(m.cls));
      const resClass = m.rtype === 'rage' ? 'rage' : m.rtype === 'energy' ? 'energy' : 'mana';
      const badge = m.dead
        ? `<span class="pf-badge dead" title="${esc(t('hud.social.status.dead'))}">${svgIcon('skull')}</span>`
        : m.inCombat
          ? `<span class="pf-badge combat" title="${esc(t('hud.social.status.combat'))}">${svgIcon('arena')}</span>`
          : '';
      const range = m.oor
        ? `<span class="pf-badge oor" title="${esc(t('hud.errors.outOfRange'))}">⤢</span>`
        : '';
      const crest = m.cls
        ? `<img class="pfm-crest" src="${iconDataUrl('crest', `class_${m.cls}`, 20)}" alt="">`
        : '';
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

  private openSelfContextMenu(x: number, y: number): void {
    const el = $('#ctx-menu');
    const party = this.sim.partyInfo;
    const canConvert =
      !!party && party.leader === this.sim.playerId && !party.raid && party.members.length >= 5;
    const canUnconvert =
      !!party && party.leader === this.sim.playerId && party.raid && party.members.length <= 5;
    let html = `<div class="ctx-title ctx-title-player">${portraitChipHtml({ cls: this.sim.cfg.playerClass, skin: this.sim.player.skin ?? 0, name: this.sim.player.name, variant: 'sm' })}<span class="ctx-title-name">${esc(this.sim.player.name)}</span></div>`;
    if (canConvert)
      html += `<div class="ctx-item" data-act="convert-raid">${esc(t('hud.chat.context.convertToRaid'))}</div>`;
    if (canUnconvert)
      html += `<div class="ctx-item" data-act="convert-party">${esc(t('hud.chat.context.convertToParty'))}</div>`;
    html += `<div class="ctx-item" data-act="close">${esc(t('hud.chat.context.cancel'))}</div>`;
    el.innerHTML = html;
    hydratePortraits(el);
    el.style.left = `${Math.min(window.innerWidth - 170, x)}px`;
    el.style.top = `${Math.min(window.innerHeight - 160, y)}px`;
    el.style.display = 'block';
    this.bindContextMenuActions((act) => {
      if (act === 'convert-raid') {
        this.sim.convertPartyToRaid();
        this.socialTab = 'raid';
        if ($('#social-window').classList.contains('open')) this.renderSocial();
      } else if (act === 'convert-party') {
        this.sim.convertRaidToParty();
        this.socialTab = 'raid';
        if ($('#social-window').classList.contains('open')) this.renderSocial();
      }
    });
  }

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
    const ent = this.sim.entities.get(pid);
    const entCls = ent && ent.kind === 'player' ? (ent.templateId as PlayerClass) : null;
    let html = `<div class="ctx-title ctx-title-player">${entCls ? portraitChipHtml({ cls: entCls, skin: ent?.skin ?? 0, name, variant: 'sm' }) : ''}<span class="ctx-title-name">${esc(name)}</span></div>`;
    if (entCls)
      html += `<div class="ctx-item" data-act="inspect">${esc(t('character.viewProfile'))}</div>`;
    if (!isMember)
      html += `<div class="ctx-item" data-act="invite">${esc(t('hud.chat.context.invite'))}</div>`;
    html += `<div class="ctx-item" data-act="trade">${esc(t('hud.chat.context.trade'))}</div>`;
    html += `<div class="ctx-item" data-act="duel">${esc(t('hud.chat.context.challengeDuel'))}</div>`;
    if (online)
      html += `<div class="ctx-item" data-act="${isFriend ? 'unfriend' : 'friend'}">${esc(t(isFriend ? 'hud.chat.context.removeFriend' : 'hud.chat.context.addFriend'))}</div>`;
    if (inGuildWithInvite && !alreadyGuilded)
      html += `<div class="ctx-item" data-act="ginvite">${esc(t('hud.chat.context.inviteGuild'))}</div>`;
    html += `<div class="ctx-item" data-act="ignore">${esc(
      t(
        ignored
          ? online
            ? 'hud.chat.context.unignore'
            : 'hud.chat.context.unignoreChat'
          : online
            ? 'hud.chat.context.ignore'
            : 'hud.chat.context.ignoreChat',
      ),
    )}</div>`;
    if (this.reportHooks && pid !== this.sim.playerId)
      html += `<div class="ctx-item" data-act="report">${esc(t('hud.chat.context.report'))}</div>`;
    if (isLeader && isMember && pid !== this.sim.playerId)
      html += `<div class="ctx-item" data-act="kick">${esc(t('hud.chat.context.removeParty'))}</div>`;
    html += `<div class="ctx-item" data-act="close">${esc(t('hud.chat.context.cancel'))}</div>`;
    el.innerHTML = html;
    hydratePortraits(el);
    this.placePopupAt(el, x, y, 170, 240);
    el.style.display = 'block';
    this.bindContextMenuActions((act) => {
      if (act === 'inspect') this.openInspect(pid);
      else if (act === 'invite') this.sim.partyInvite(pid);
      else if (act === 'trade') this.sim.tradeRequest(pid);
      else if (act === 'duel') this.sim.duelRequest(pid);
      else if (act === 'friend') this.sim.friendAdd(name);
      else if (act === 'unfriend') this.sim.friendRemove(name);
      else if (act === 'ginvite') this.sim.guildInvite(name);
      else if (act === 'ignore') {
        if (online) {
          ignored ? this.sim.blockRemove(name) : this.sim.blockAdd(name);
        } else this.toggleChatIgnore(name);
      } else if (act === 'report') this.openReportWindow({ pid, name });
      else if (act === 'kick') this.sim.partyKick(pid);
    });
  }

  /** Inspect another player: a profile window with their portrait, name, level
   *  and class — rendered locally from their entity's class + skin. */
  openInspect(pid: number): void {
    const e = this.sim.entities.get(pid);
    if (e?.kind !== 'player') return;
    const cls = e.templateId as PlayerClass;
    const className = classDisplayName(cls);
    const el = $('#inspect-window');
    this.closeOtherWindows('#inspect-window');
    // $WOC holder-tier flair: cosmetic badge for a connected/holder wallet,
    // broadcast per-entity via the `ht`/`hb` identity fields (server-set). Shown
    // only when the inspected player has a tier (> 0); the exact balance rides
    // along in `hb` and reads out beneath the rung name when present.
    const tierDef = holderTierByIndex(e.holderTier ?? 0);
    const holderHtml = tierDef
      ? `<div class="inspect-holder">` +
        `<img class="inspect-holder-badge" src="${holderTierBadgeDataUrl(tierDef)}" alt="" draggable="false">` +
        `<div class="inspect-holder-text">` +
        `<div class="inspect-holder-name">${esc(holderTierDisplayName(tierDef))}</div>` +
        `<div class="inspect-holder-sub">${e.holderBalance ? esc(t('wallet.balanceAmount', { amount: formatNumber(e.holderBalance, { maximumFractionDigits: 0 }) })) : esc(t('wallet.holder'))}</div>` +
        `</div></div>`
      : '';
    el.innerHTML =
      `<div class="panel-title"><span>${esc(t('character.profile'))}</span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('character.closeProfile'))}">${svgIcon('close')}</button></div>` +
      `<div class="inspect-card">` +
      portraitChipHtml({ cls, skin: e.skin ?? 0, name: e.name, variant: 'lg' }) +
      `<div class="inspect-name">${esc(e.name)}</div>` +
      `<div class="inspect-meta">${esc(t('itemUi.equipment.levelClass', { level: formatNumber(e.level, { maximumFractionDigits: 0 }), className }))}</div>` +
      holderHtml +
      `</div>`;
    hydratePortraits(el);
    el.querySelector('[data-close]')?.addEventListener('click', () => {
      el.style.display = 'none';
    });
    el.style.display = 'block';
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
      const aria =
        current === i
          ? t('hud.markers.markerSelectedAria', { marker: markerName })
          : t('hud.markers.markerAria', { marker: markerName });
      const check = current === i ? ' ✓' : '';
      html += `<div class="ctx-item" role="button" tabindex="0" data-act="m${i}" aria-label="${esc(aria)}"><span class="ctx-mark" style="background-image:url(${raidMarkerDataUrl(i)})"></span>${esc(markerName)}${check}</div>`;
    }
    html += `<div class="ctx-item" role="button" tabindex="0" data-act="clear">${esc(t('hud.markers.clear'))}</div>`;
    html += `<div class="ctx-item" role="button" tabindex="0" data-act="close">${esc(t('hud.markers.cancel'))}</div>`;
    el.innerHTML = html;
    this.placePopupAt(el, x, y, 170, 340);
    el.style.display = 'block';
    el.querySelectorAll('.ctx-item').forEach((item) => {
      const activate = () => {
        const act = (item as HTMLElement).dataset.act;
        el.style.display = 'none';
        if (act === 'clear') this.sim.clearMarker(entityId);
        else if (act?.startsWith('m')) this.sim.setMarker(entityId, Number(act.slice(1)));
      };
      item.addEventListener('click', activate);
      item.addEventListener('keydown', (e) => {
        if (!(e instanceof KeyboardEvent) || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        activate();
      });
    });
  }

  openPetMenu(_entityId: number, name: string, dead: boolean, x: number, y: number): void {
    const el = $('#ctx-menu');
    const isWarlock = this.sim.cfg.playerClass === 'warlock';
    let html = `<div class="ctx-title">${esc(name)}</div>`;
    html += `<div class="ctx-item" data-act="rename">${esc(t('hud.pet.rename'))}</div>`;
    if (dead) html += `<div class="ctx-item" data-act="revive">${esc(t('hud.pet.revive'))}</div>`;
    if (!isWarlock)
      html += `<div class="ctx-item" data-act="abandon">${esc(t('hud.pet.abandon'))}</div>`;
    html += `<div class="ctx-item" data-act="close">${esc(t('hud.pet.cancel'))}</div>`;
    el.innerHTML = html;
    this.placePopupAt(el, x, y, 170, 240);
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
    // If the player is in view we know their class+skin, so show a portrait and
    // a "View Profile" entry; otherwise the menu is name-only as before.
    const livePidForMenu = this.playerPidByName(name);
    const ent = livePidForMenu !== null ? this.sim.entities.get(livePidForMenu) : undefined;
    const entCls = ent && ent.kind === 'player' ? (ent.templateId as PlayerClass) : null;
    const titleHtml = `<div class="ctx-title ctx-title-player">${entCls ? portraitChipHtml({ cls: entCls, skin: ent?.skin ?? 0, name, variant: 'sm' }) : ''}<span class="ctx-title-name">${esc(name)}</span></div>`;
    const inspectHtml = entCls
      ? `<div class="ctx-item" data-act="inspect">${esc(t('character.viewProfile'))}</div>`
      : '';
    el.innerHTML =
      titleHtml +
      inspectHtml +
      actions.map((a) => `<div class="ctx-item" data-act="${a.id}">${esc(a.label)}</div>`).join('');
    hydratePortraits(el);
    this.placePopupAt(el, x, y, 170, 240);
    el.style.display = 'block';
    this.bindContextMenuActions((act) => {
      const livePid = this.playerPidByName(name);
      if (act === 'inspect') {
        if (livePid !== null) this.openInspect(livePid);
      } else if (act === 'whisper') this.startWhisper(name);
      else if (act === 'invite') {
        if (livePid !== null) this.sim.partyInvite(livePid);
        else this.showError(t('hud.system.playerNotNearby'));
      } else if (act === 'friend') this.sim.friendAdd(name);
      else if (act === 'unfriend') this.sim.friendRemove(name);
      else if (act === 'ginvite') this.sim.guildInvite(name);
      else if (act === 'ignore') {
        if (online) {
          ignored ? this.sim.blockRemove(name) : this.sim.blockAdd(name);
        } else this.toggleChatIgnore(name);
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
    const reasonDD = this.buildDropdown(
      [
        { value: 'harassment', label: t('hud.report.reasons.harassment') },
        { value: 'spam', label: t('hud.report.reasons.spam') },
        { value: 'cheating', label: t('hud.report.reasons.cheating') },
        { value: 'offensive_name_or_chat', label: t('hud.report.reasons.offensiveNameOrChat') },
        { value: 'other', label: t('hud.report.reasons.other') },
      ],
      'harassment',
      undefined,
      undefined,
      { ariaLabel: t('hud.report.reason') },
    );
    // Give the trigger the id the <label for="report-reason"> points at, so the
    // label (which lost its original target when the slot div was replaced)
    // associates with a real focusable control again.
    reasonDD.querySelector('.ui-dd-btn')?.setAttribute('id', 'report-reason');
    el.querySelector('#report-reason-slot')?.replaceWith(reasonDD);
    el.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => {
        el.style.display = 'none';
      });
    });
    const submit = $('#report-submit') as HTMLButtonElement;
    submit.addEventListener('click', () => {
      const reason = reasonDD.dataset.value ?? 'other';
      const details = ($('#report-details') as HTMLTextAreaElement).value;
      submit.disabled = true;
      const request =
        pid !== undefined
          ? this.reportHooks?.submit(pid, reason, details)
          : this.reportHooks?.submitByName?.(name, reason, details);
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
      return new Set(
        Array.isArray(parsed)
          ? parsed.filter((name): name is string => typeof name === 'string')
          : [],
      );
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
    if (el.classList.contains('open')) {
      el.classList.remove('open');
      return;
    }
    this.closeOtherWindows('#social-window');
    el.classList.add('open');
    this.socialNotice = null;
    this.lastSocialStruct = this.socialStructSig();
    this.lastSocialContent = JSON.stringify({
      social: this.sim.socialInfo,
      party: this.sim.partyInfo,
    });
    this.renderSocial();
  }

  // structural identity of the panel: which tab, online or not, and the guild
  // membership/rank (which changes the footer). Content within a tab — a
  // friend's zone, the roster — doesn't count, so it can refresh in place.
  private socialStructSig(): string {
    const g = this.sim.socialInfo?.guild;
    const p = this.sim.partyInfo;
    const raidSig = p
      ? `${p.raid ? 1 : 0}:${p.leader}:${p.members.map((m) => `${m.pid}.${m.group}`).join(',')}`
      : 'solo';
    return `${this.socialTab}|${this.sim.socialInfo !== null}|${g?.id ?? 0}|${g?.rank ?? ''}|${raidSig}`;
  }

  // Full rebuild: title, tabs, body, notice, and the tab's footer (with its
  // typeahead). Used on open, tab switch, and guild-membership changes.
  private renderSocial(): void {
    const el = $('#social-window');
    if (!el.classList.contains('open')) return;
    const tab = this.socialTab;
    const online = this.sim.socialInfo !== null;
    const realmTag =
      online && this.sim.realm
        ? ` <span class="soc-realm-tag">- ${esc(this.sim.realm)}</span>`
        : '';
    el.innerHTML =
      `<div class="panel-title"><span>${esc(t('hud.social.title'))}${realmTag}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('hud.options.returnToGame'))}">${svgIcon('close')}</button></div>` +
      `<div class="soc-tabs">` +
      `<button type="button" class="soc-tab ${tab === 'friends' ? 'on' : ''}" data-tab="friends" aria-pressed="${tab === 'friends' ? 'true' : 'false'}">${esc(t('hud.social.friendsTab'))}</button>` +
      `<button type="button" class="soc-tab ${tab === 'guild' ? 'on' : ''}" data-tab="guild" aria-pressed="${tab === 'guild' ? 'true' : 'false'}">${esc(t('hud.social.guildTab'))}</button>` +
      `<button type="button" class="soc-tab ${tab === 'ignore' ? 'on' : ''}" data-tab="ignore" aria-pressed="${tab === 'ignore' ? 'true' : 'false'}">${esc(t('hud.social.ignoreTab'))}</button>` +
      `<button type="button" class="soc-tab ${tab === 'raid' ? 'on' : ''}" data-tab="raid" aria-pressed="${tab === 'raid' ? 'true' : 'false'}">${esc(t('hud.social.raidTab'))}</button>` +
      `</div>` +
      `<div class="soc-body"></div>` +
      `<div class="soc-notice"></div>` +
      (tab === 'raid' ? '' : online ? this.socialFooter() : '');
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
    body.innerHTML =
      this.socialTab === 'raid'
        ? this.raidHtml()
        : !online
          ? `<div class="soc-empty">${esc(t('hud.social.offlineEmpty'))}</div>`
          : this.socialTab === 'friends'
            ? this.friendsHtml()
            : this.socialTab === 'guild'
              ? this.guildHtml()
              : this.ignoreHtml();
    this.wireSocialRows(body);
  }

  private friendsHtml(): string {
    const friends = this.sim.socialInfo?.friends ?? [];
    if (friends.length === 0)
      return `<div class="soc-empty">${esc(t('hud.social.friendsEmpty'))}</div>`;
    return friends
      .map((f) => {
        const dot = f.online ? (f.status ?? 'online') : 'off';
        const meta = f.online
          ? `<span class="zone">${esc(f.zone ? localizeZone(f.zone) : '')}</span><br>${esc(statusLabel(f.status))}`
          : esc(t('hud.social.status.offline'));
        const name = f.online
          ? `<button type="button" class="soc-name soc-link" data-whisper="${esc(f.name)}" title="${esc(t('hud.social.whisperTitle', { name: f.name }))}">${esc(f.name)}</button>`
          : `<span class="soc-name">${esc(f.name)}</span>`;
        const whisper = f.online
          ? `<button type="button" class="soc-x" data-whisper="${esc(f.name)}" title="${esc(t('hud.social.whisperTitle', { name: f.name }))}">${svgIcon('whisper')}</button>`
          : '';
        const tip = esc(dotTitle(f.online, f.status, f.zone));
        return (
          `<div class="soc-row">` +
          `<span class="soc-dot ${dot === 'off' ? '' : dot}" title="${tip}"></span>` +
          `<span class="soc-id">${name}<span class="soc-sub">${esc(t('hud.social.levelClass', { level: formatNumber(f.level, { maximumFractionDigits: 0 }), className: playerClassDisplayName(f.cls) }))}</span></span>` +
          `<span class="soc-meta" title="${tip}">${meta}</span>` +
          `<span class="soc-actions">${whisper}<button type="button" class="soc-x" data-act="unfriend" data-name="${esc(f.name)}" title="${esc(t('hud.social.removeFriendTitle', { name: f.name }))}">${svgIcon('close')}</button></span>` +
          `</div>`
        );
      })
      .join('');
  }

  private ignoreHtml(): string {
    const blocks = this.sim.socialInfo?.blocks ?? [];
    if (blocks.length === 0)
      return `<div class="soc-empty">${esc(t('hud.social.ignoreEmpty'))}</div>`;
    return blocks
      .map(
        (b) =>
          `<div class="soc-row">` +
          `<span class="soc-name">${esc(b.name)}</span>` +
          `<span class="soc-actions" style="margin-left:auto"><button type="button" class="soc-x" data-act="unblock" data-name="${esc(b.name)}" title="${esc(t('hud.social.stopIgnoringTitle', { name: b.name }))}">${svgIcon('close')}</button></span>` +
          `</div>`,
      )
      .join('');
  }

  private guildHtml(): string {
    const guild = this.sim.socialInfo?.guild ?? null;
    if (!guild) return `<div class="soc-empty">${esc(t('hud.social.noGuild'))}</div>`;
    const me = guild.rank;
    const memberCount = guild.members.length;
    const guildCount = formatNumber(memberCount, { maximumFractionDigits: 0 });
    const head = `<div class="soc-guild-head">&lt;${esc(guild.name)}&gt; <span class="gm">${esc(tPlural('hudChrome.plurals.guildMembers', memberCount, { rank: rankLabel(me), count: guildCount }))}</span></div>`;
    const rows = guild.members
      .map((m) => {
        const dot = m.online ? (m.status ?? 'online') : 'off';
        const meta = m.online
          ? `<span class="zone">${esc(m.zone ? localizeZone(m.zone) : '')}</span><br>${esc(statusLabel(m.status))}`
          : esc(t('hud.social.status.offline'));
        const self = m.name === this.sim.player.name;
        const nameInner = `${esc(m.name)}<span class="rank">${esc(rankLabel(m.rank))}</span>`;
        const name =
          m.online && !self
            ? `<button type="button" class="soc-name soc-link" data-whisper="${esc(m.name)}" title="${esc(t('hud.social.whisperTitle', { name: m.name }))}">${nameInner}</button>`
            : `<span class="soc-name">${nameInner}</span>`;
        let actions =
          m.online && !self
            ? `<button type="button" class="soc-x" data-whisper="${esc(m.name)}" title="${esc(t('hud.social.whisperTitle', { name: m.name }))}">${svgIcon('whisper')}</button>`
            : '';
        if (!self && me === 'leader')
          actions += `<button type="button" class="soc-x" data-act="gtransfer" data-name="${esc(m.name)}" title="${esc(t('hud.social.makeGuildMasterTitle', { name: m.name }))}">${svgIcon('crown')}</button>`;
        if (!self && me === 'leader' && m.rank === 'member')
          actions += `<button type="button" class="soc-x" data-act="promote" data-name="${esc(m.name)}" title="${esc(t('hud.social.promoteTitle', { name: m.name }))}">▲</button>`;
        if (!self && me === 'leader' && m.rank === 'officer')
          actions += `<button type="button" class="soc-x" data-act="demote" data-name="${esc(m.name)}" title="${esc(t('hud.social.demoteTitle', { name: m.name }))}">▼</button>`;
        // leaders may remove members + officers; officers may remove only members
        const canKick =
          !self &&
          ((me === 'leader' && m.rank !== 'leader') || (me === 'officer' && m.rank === 'member'));
        if (canKick)
          actions += `<button type="button" class="soc-x" data-act="gkick" data-name="${esc(m.name)}" title="${esc(t('hud.social.removeGuildTitle', { name: m.name }))}">${svgIcon('close')}</button>`;
        const tip = esc(dotTitle(m.online, m.status, m.zone));
        return (
          `<div class="soc-row">` +
          `<span class="soc-dot ${dot === 'off' ? '' : dot}" title="${tip}"></span>` +
          `<span class="soc-id">${name}<span class="soc-sub">${esc(t('hud.social.levelClass', { level: formatNumber(m.level, { maximumFractionDigits: 0 }), className: playerClassDisplayName(m.cls) }))}</span></span>` +
          `<span class="soc-meta" title="${tip}">${meta}</span>` +
          (actions ? `<span class="soc-actions">${actions}</span>` : '') +
          `</div>`
        );
      })
      .join('');
    return head + rows;
  }

  private raidHtml(): string {
    const party = this.sim.partyInfo;
    if (!party?.raid) {
      const canConvert = !!party && party.leader === this.sim.playerId && party.members.length >= 5;
      return `<div class="soc-empty">${esc(t('hud.social.raidEmpty'))}${canConvert ? `<div class="soc-empty-action"><button type="button" class="soc-x" data-act="convert-raid">${esc(t('hud.chat.context.convertToRaid'))}</button></div>` : ''}</div>`;
    }
    const leader = party.leader === this.sim.playerId;
    const groups: Record<1 | 2, typeof party.members> = {
      1: party.members.filter((m) => m.group === 1),
      2: party.members.filter((m) => m.group === 2),
    };
    const groupHtml = (group: 1 | 2): string => {
      const rows =
        groups[group]
          .map((m) => {
            const isLead = m.pid === party.leader;
            const otherGroup = group === 1 ? 2 : 1;
            const otherFull = groups[otherGroup].length >= 5;
            const move =
              leader && !otherFull
                ? `<button type="button" class="soc-x" data-act="raid-move" data-pid="${m.pid}" data-group="${otherGroup}" title="${esc(t('hud.social.raidMoveToGroup', { group: formatNumber(otherGroup, { maximumFractionDigits: 0 }) }))}">${esc(formatNumber(otherGroup, { maximumFractionDigits: 0 }))}</button>`
                : '';
            return (
              `<div class="soc-row raid-row">` +
              `<span class="soc-id"><span class="soc-name">${esc(m.name)}${isLead ? `<span class="rank">${esc(t('hud.social.raidLeader'))}</span>` : ''}</span><span class="soc-sub">${esc(t('hud.social.levelClass', { level: formatNumber(m.level, { maximumFractionDigits: 0 }), className: playerClassDisplayName(m.cls) }))}</span></span>` +
              `<span class="soc-meta">${esc(formatNumber(Math.round((m.hp / Math.max(1, m.mhp)) * 100), { maximumFractionDigits: 0 }))}%</span>` +
              (move ? `<span class="soc-actions">${move}</span>` : '') +
              `</div>`
            );
          })
          .join('') || `<div class="soc-empty">${esc(t('hud.social.raidGroupEmpty'))}</div>`;
      return `<div class="raid-group"><div class="soc-guild-head">${esc(t('hud.social.raidGroupTitle', { position: formatNumber(group, { maximumFractionDigits: 0 }), count: formatNumber(groups[group].length, { maximumFractionDigits: 0 }) }))}</div>${rows}</div>`;
    };
    // Raid groups cannot enter standard instances; let the leader fold a small raid
    // (<= one party's worth) back into a normal party. Larger raids must shed members first.
    const canUnconvert = leader && party.members.length <= 5;
    const footer = canUnconvert
      ? `<div class="soc-empty-action"><button type="button" class="soc-x" data-act="convert-party">${esc(t('hud.chat.context.convertToParty'))}</button></div>`
      : '';
    return `<div class="raid-groups">${groupHtml(1)}${groupHtml(2)}</div>${footer}`;
  }

  // The add/action row changes with the tab (and guild membership). Inputs
  // tagged data-suggest get the username typeahead.
  private socialFooter(): string {
    if (this.socialTab === 'friends')
      return this.addRow(
        'friend',
        'friend-add',
        t('hud.social.friendSearchPlaceholder'),
        t('hud.social.add'),
        16,
        true,
      );
    if (this.socialTab === 'ignore')
      return this.addRow(
        'ignore',
        'block-add',
        t('hud.social.ignoreSearchPlaceholder'),
        t('hud.social.ignoreAction'),
        16,
        true,
      );
    const guild = this.sim.socialInfo?.guild ?? null;
    if (!guild)
      return this.addRow(
        'gname',
        'guild-create',
        t('hud.social.guildNamePlaceholder'),
        t('hud.social.found'),
        24,
        false,
      );
    let foot = '';
    if (guild.rank !== 'member')
      foot += this.addRow(
        'ginvite',
        'guild-invite',
        t('hud.social.guildInvitePlaceholder'),
        t('hud.social.invite'),
        16,
        true,
      );
    // classic MMOs: a Guild Master with other members can't just leave — they disband
    // (or hand over leadership via the crown action). Everyone else can leave.
    foot +=
      guild.rank === 'leader' && guild.members.length > 1
        ? `<div class="soc-add soc-leave"><button class="btn" data-act="guild-disband">${esc(t('hud.social.disbandGuild'))}</button></div>`
        : `<div class="soc-add soc-leave"><button class="btn" data-act="guild-leave">${esc(t('hud.social.leaveGuild'))}</button></div>`;
    return foot;
  }

  private addRow(
    field: string,
    act: string,
    placeholder: string,
    label: string,
    maxlen: number,
    suggest: boolean,
  ): string {
    return (
      `<div class="soc-add">` +
      (suggest ? `<div class="soc-suggest" data-for="${field}" role="listbox"></div>` : '') +
      `<input maxlength="${maxlen}" aria-label="${esc(placeholder)}" placeholder="${esc(placeholder)}" data-field="${field}"${suggest ? ' data-suggest="1" aria-autocomplete="list"' : ''} autocomplete="off" spellcheck="false"/>` +
      `<button class="btn" data-act="${act}">${esc(label)}</button></div>`
    );
  }

  // Wire the parts that survive a content refresh: close, tabs, footer + search.
  private wireSocialChrome(el: HTMLElement): void {
    el.querySelector('[data-close]')?.addEventListener('click', () => this.toggleSocial());
    el.querySelectorAll('.soc-tab').forEach((t) => {
      t.addEventListener('click', () => {
        this.socialTab = (t as HTMLElement).dataset.tab as 'friends' | 'guild' | 'ignore' | 'raid';
        this.socialNotice = null;
        this.lastSocialStruct = this.socialStructSig();
        this.renderSocial();
      });
    });
    const field = (sel: string): string =>
      (el.querySelector(`input[data-field="${sel}"]`) as HTMLInputElement | null)?.value.trim() ??
      '';
    const submit = (act: string | undefined): void => {
      if (act === 'friend-add') void this.socialResolveAndAct('friend', field('friend'));
      else if (act === 'block-add') void this.socialResolveAndAct('ignore', field('ignore'));
      else if (act === 'guild-invite') void this.socialResolveAndAct('ginvite', field('ginvite'));
      else if (act === 'guild-create') {
        const n = field('gname');
        if (n) {
          this.sim.guildCreate(n);
          this.clearSocialInput('gname');
        }
      } else if (act === 'guild-leave')
        this.showPrompt(
          esc(t('hud.social.leavePrompt')),
          t('hud.social.leaveGuild'),
          () => this.sim.guildLeave(),
          () => {},
        );
      else if (act === 'guild-disband')
        this.showPrompt(
          esc(t('hud.social.disbandPrompt')),
          t('hud.social.disbandConfirm'),
          () => this.sim.guildDisband(),
          () => {
            /* keep */
          },
        );
    };
    el.querySelectorAll('.soc-add .btn').forEach((b) => {
      b.addEventListener('click', () => {
        submit((b as HTMLElement).dataset.act);
      });
    });
    // Enter-to-submit only for plain inputs (the guild name). Search inputs get
    // richer keyboard handling — arrows + Enter to pick a suggestion — below.
    el.querySelectorAll('.soc-add input:not([data-suggest])').forEach((inp) => {
      inp.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key !== 'Enter') return;
        submit((inp.parentElement?.querySelector('.btn') as HTMLElement | null)?.dataset.act);
      });
    });
    this.wireSuggest(el);
  }

  // Wire per-row actions (re-run on every list refresh).
  private wireSocialRows(scope: HTMLElement): void {
    scope.querySelectorAll('.soc-x').forEach((x) => {
      x.addEventListener('click', () => {
        const act = (x as HTMLElement).dataset.act;
        const name = (x as HTMLElement).dataset.name ?? '';
        if (act === 'unfriend') this.sim.friendRemove(name);
        else if (act === 'unblock') this.sim.blockRemove(name);
        else if (act === 'gkick') this.sim.guildKick(name);
        else if (act === 'promote') this.sim.guildPromote(name);
        else if (act === 'demote') this.sim.guildDemote(name);
        else if (act === 'gtransfer')
          this.showPrompt(
            t('hud.social.transferPrompt', { name: `<b>${esc(name)}</b>` }),
            t('hud.social.transferConfirm'),
            () => this.sim.guildTransfer(name),
            () => {
              /* keep */
            },
          );
        else if (act === 'raid-move') {
          const pid = Number((x as HTMLElement).dataset.pid);
          const group = Number((x as HTMLElement).dataset.group);
          if (Number.isFinite(pid) && (group === 1 || group === 2))
            this.sim.moveRaidMember(pid, group);
        } else if (act === 'convert-raid') {
          this.sim.convertPartyToRaid();
          this.socialTab = 'raid';
          this.renderSocial();
        } else if (act === 'convert-party') {
          this.sim.convertRaidToParty();
          this.socialTab = 'raid';
          this.renderSocial();
        }
      });
    });
    scope.querySelectorAll('[data-whisper]').forEach((w) => {
      w.addEventListener('click', () => {
        this.startWhisper((w as HTMLElement).dataset.whisper ?? '');
      });
    });
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
        if (!q) {
          this.renderSuggest(field, []);
          return;
        }
        this.socialSuggestTimer = window.setTimeout(async () => {
          const results = await this.sim.searchCharacters(q);
          this.renderSuggest(
            field,
            results.filter((r) => r.name !== this.sim.player.name).slice(0, 8),
          );
        }, 160);
      });
      input.addEventListener('keydown', (e) => {
        const ke = e as KeyboardEvent;
        const open = this.socialSuggest.field === field && this.socialSuggest.items.length > 0;
        if (ke.key === 'ArrowDown' && open) {
          ke.preventDefault();
          this.moveSuggest(field, 1);
        } else if (ke.key === 'ArrowUp' && open) {
          ke.preventDefault();
          this.moveSuggest(field, -1);
        } else if (ke.key === 'Escape' && open) {
          ke.preventDefault();
          this.renderSuggest(field, []);
        } else if (ke.key === 'Enter') {
          ke.preventDefault();
          const picked =
            open && this.socialSuggest.index >= 0
              ? this.socialSuggest.items[this.socialSuggest.index].name
              : input.value;
          void this.socialResolveAndAct(this.suggestKind(field), picked);
        }
      });
      // let a suggestion's mousedown fire before blur clears the list
      input.addEventListener('blur', () =>
        window.setTimeout(() => this.renderSuggest(field, []), 150),
      );
    });
  }

  private renderSuggest(
    field: string,
    results: { name: string; cls: string; level: number }[],
  ): void {
    const box = $('#social-window').querySelector(
      `.soc-suggest[data-for="${field}"]`,
    ) as HTMLElement | null;
    if (!box) return;
    this.socialSuggest = { field, items: results, index: -1 };
    if (results.length === 0) {
      box.style.display = 'none';
      box.innerHTML = '';
      return;
    }
    const kind = this.suggestKind(field);
    box.innerHTML = results
      .map((r, i) => {
        const meta = t('hud.social.levelClass', {
          level: formatNumber(r.level, { maximumFractionDigits: 0 }),
          className: playerClassDisplayName(r.cls),
        });
        return `<button type="button" class="soc-sugg-item" data-i="${i}" data-name="${esc(r.name)}" role="option"><span class="soc-name">${esc(r.name)}</span><span class="soc-meta">${esc(meta)}</span></button>`;
      })
      .join('');
    box.style.display = 'block';
    box.querySelectorAll('.soc-sugg-item').forEach((it) => {
      it.addEventListener('mousedown', (e) => {
        e.preventDefault();
        void this.socialResolveAndAct(kind, (it as HTMLElement).dataset.name ?? '');
      });
      it.addEventListener('mousemove', () => {
        this.socialSuggest.index = Number((it as HTMLElement).dataset.i);
        this.highlightSuggest(field);
      });
    });
  }

  private moveSuggest(field: string, delta: number): void {
    const n = this.socialSuggest.items.length;
    if (n === 0) return;
    // start at the top when nothing is highlighted yet, then wrap
    this.socialSuggest.index =
      this.socialSuggest.index < 0
        ? delta > 0
          ? 0
          : n - 1
        : (this.socialSuggest.index + delta + n) % n;
    this.highlightSuggest(field);
  }

  private highlightSuggest(field: string): void {
    const box = $('#social-window').querySelector(
      `.soc-suggest[data-for="${field}"]`,
    ) as HTMLElement | null;
    if (!box) return;
    box.querySelectorAll('.soc-sugg-item').forEach((it) => {
      const on = Number((it as HTMLElement).dataset.i) === this.socialSuggest.index;
      it.classList.toggle('active', on);
      if (on) (it as HTMLElement).scrollIntoView({ block: 'nearest' });
    });
  }

  // Authoritative existence check (realm-scoped) before acting, so we can give
  // clear inline "no such player" feedback instead of a silent failure.
  private async socialResolveAndAct(
    kind: 'friend' | 'ignore' | 'ginvite',
    rawName: string,
  ): Promise<void> {
    const name = rawName.trim();
    if (!name) return;
    const results = await this.sim.searchCharacters(name);
    const exact = results.find((r) => r.name.toLowerCase() === name.toLowerCase());
    if (!exact) {
      this.setSocialNotice(
        t('hud.social.noPlayerNamed', {
          name,
          realm: this.sim.realm || t('hud.social.currentRealm'),
        }),
        true,
      );
      return;
    }
    if (exact.name === this.sim.player.name) {
      this.setSocialNotice(t('hud.social.selfNotice'), true);
      return;
    }
    if (kind === 'friend') {
      this.sim.friendAdd(exact.name);
      this.setSocialNotice(t('hud.social.friendAdded', { name: exact.name }), false);
      this.clearSocialInput('friend');
    } else if (kind === 'ignore') {
      this.sim.blockAdd(exact.name);
      this.setSocialNotice(t('hud.social.nowIgnoring', { name: exact.name }), false);
      this.clearSocialInput('ignore');
    } else {
      this.sim.guildInvite(exact.name);
      this.setSocialNotice(t('hud.social.guildInvited', { name: exact.name }), false);
      this.clearSocialInput('ginvite');
    }
    this.renderSuggest(kind, []);
  }

  private clearSocialInput(field: string): void {
    const inp = $('#social-window').querySelector(
      `input[data-field="${field}"]`,
    ) as HTMLInputElement | null;
    if (inp) inp.value = '';
  }

  private setSocialNotice(text: string, error: boolean): void {
    this.socialNotice = { text, error };
    this.renderSocialNotice();
  }

  private renderSocialNotice(): void {
    const box = $('#social-window').querySelector('.soc-notice') as HTMLElement | null;
    if (!box) return;
    if (!this.socialNotice) {
      box.style.display = 'none';
      box.textContent = '';
      return;
    }
    box.textContent = this.socialNotice.text;
    box.className = `soc-notice${this.socialNotice.error ? ' err' : ' ok'}`;
    box.style.display = 'block';
  }

  // Open the chat bar pre-filled with a whisper to this player (classic-MMO-style DM).
  private startWhisper(name: string): void {
    if (!name || name === this.sim.player.name) return;
    const input = $('#chat-input') as unknown as HTMLTextAreaElement;
    input.value = `/w ${name} `;
    input.style.display = 'block';
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    // Re-anchor + autosize the bar for the pre-filled value even if it was
    // already open (focus alone won't re-fire); main.ts listens for 'input'.
    input.dispatchEvent(new Event('input'));
  }

  // -------------------------------------------------------------------------
  // Prompts (party invite / trade request / duel challenge)
  // -------------------------------------------------------------------------

  private showPrompt(
    text: string,
    acceptLabel: string,
    onAccept: () => void,
    onDecline: () => void,
  ): void {
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
    accept.addEventListener('click', () => {
      prompt.remove();
      onAccept();
    });
    decline.addEventListener('click', () => {
      prompt.remove();
      onDecline();
    });
    prompt.append(accept, decline);
    stack.appendChild(prompt);
    window.setTimeout(() => {
      if (prompt.isConnected) {
        prompt.remove();
        onDecline();
      }
    }, 28000);
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
    const sig = JSON.stringify([
      info.myOffer,
      info.theirOffer,
      info.myAccepted,
      info.theirAccepted,
      this.stagedTrade,
    ]);
    if (sig === this.lastTradeSig) return;
    this.lastTradeSig = sig;

    const itemRow = (s: InvSlot, mine: boolean) => {
      const item = ITEMS[s.itemId];
      const label = `${item ? itemDisplayName(item) : s.itemId}${s.count > 1 ? ` x${formatNumber(s.count, { maximumFractionDigits: 0 })}` : ''}`;
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
          <div class="trade-money"><span class="trade-money-label">${esc(t('hud.trade.money'))}:</span>
            <span class="trade-coins">
              <input class="coininput" id="trade-g" type="number" min="0" value="${Math.floor(this.stagedTrade.copper / 10000)}" aria-label="${esc(t('itemUi.money.gold'))}"><span class="coin g" aria-hidden="true"></span><span class="mkt-coin-tag">${esc(t('itemUi.money.goldShort'))}</span>
              <input class="coininput" id="trade-s" type="number" min="0" max="99" value="${Math.floor((this.stagedTrade.copper % 10000) / 100)}" aria-label="${esc(t('itemUi.money.silver'))}"><span class="coin s" aria-hidden="true"></span><span class="mkt-coin-tag">${esc(t('itemUi.money.silverShort'))}</span>
              <input class="coininput" id="trade-c" type="number" min="0" max="99" value="${this.stagedTrade.copper % 100}" aria-label="${esc(t('itemUi.money.copper'))}"><span class="coin c" aria-hidden="true"></span><span class="mkt-coin-tag">${esc(t('itemUi.money.copperShort'))}</span>
            </span>
          </div>
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
    const goldInput = el.querySelector('#trade-g') as HTMLInputElement;
    const silverInput = el.querySelector('#trade-s') as HTMLInputElement;
    const copperInput = el.querySelector('#trade-c') as HTMLInputElement;
    const syncTradeMoney = () => {
      const gg = Math.max(0, Math.floor(Number(goldInput?.value) || 0));
      const ss = Math.max(0, Math.floor(Number(silverInput?.value) || 0));
      const cc = Math.max(0, Math.floor(Number(copperInput?.value) || 0));
      this.stagedTrade.copper = gg * 10000 + ss * 100 + cc;
      this.pushTradeOffer();
    };
    [goldInput, silverInput, copperInput].forEach((input) => {
      input?.addEventListener('change', syncTradeMoney);
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

  // Only wired online (main.ts), so its presence is what gates the "Report a Bug"
  // option (the offline browser world has no server to receive reports).
  attachBugReporting(hooks: BugReportHooks): void {
    this.bugReportHooks = hooks;
  }

  get optionsOpen(): boolean {
    return $('#options-menu').style.display === 'block';
  }

  // True while a menu that should pause character movement is up.
  isModalOpen(): boolean {
    return (
      this.optionsOpen ||
      this.emoteWheelOpen ||
      $('#emote-editor').style.display === 'block' ||
      this.cardModalEl !== null
    );
  }

  // True when any interactive HUD surface is open: a modal OR a managed window
  // (bags, vendor, character, etc.). Drives the gamepad's virtual-cursor mode so a
  // controller can point at bag slots / vendor items, not just modal dialogs.
  isWindowOpen(): boolean {
    return this.isModalOpen() || this.topmostOpenWindow() !== null;
  }

  toggleOptionsMenu(): void {
    if (this.optionsOpen) {
      this.closeOptions();
      return;
    }
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
    this.optionsHooks?.perfOverlay.setPlacement(false);
    this.hideTooltip();
    music.resumeFromMenu();
  }

  private renderOptions(): void {
    // The wide multi-column layouts belong to their own sub-views; clear each when
    // leaving it so the other sub-views (and the main menu) keep their default width.
    if (this.optionsView !== 'keybinds') $('#options-menu').classList.remove('kb-wide');
    if (this.optionsView !== 'performance') $('#options-menu').classList.remove('perf-wide');
    // The overlay is draggable only while the Performance sub-view is open.
    this.optionsHooks?.perfOverlay.setPlacement(this.optionsView === 'performance');
    if (this.optionsView === 'keybinds') {
      this.renderKeybinds();
      return;
    }
    if (this.optionsView === 'graphics') {
      this.renderGraphics();
      return;
    }
    if (this.optionsView === 'audio') {
      this.renderAudio();
      return;
    }
    if (this.optionsView === 'interface') {
      this.renderInterface();
      return;
    }
    if (this.optionsView === 'controller') {
      this.renderController();
      return;
    }
    if (this.optionsView === 'performance') {
      this.renderPerformance();
      return;
    }
    if (this.optionsView === 'bugreport') {
      this.renderBugReport();
      return;
    }
    const el = $('#options-menu');
    el.innerHTML = `<div class="panel-title"><span>${esc(t('hud.options.gameMenu'))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('hud.options.returnToGame'))}">${svgIcon('close')}</button></div>`;
    const list = document.createElement('div');
    list.className = 'opt-list';
    const add = (text: string, onClick: () => void) => {
      const b = document.createElement('button');
      b.className = 'btn opt-btn';
      b.textContent = text;
      b.addEventListener('click', () => {
        audio.click();
        onClick();
      });
      list.appendChild(b);
    };
    const goto = (
      view:
        | 'keybinds'
        | 'graphics'
        | 'audio'
        | 'interface'
        | 'performance'
        | 'controller'
        | 'bugreport',
    ) => {
      this.optionsView = view;
      this.keybindNote = '';
      this.renderOptions();
    };
    add(t('hud.options.keyBindings'), () => goto('keybinds'));
    add(t('hudChrome.controller.title'), () => goto('controller'));
    add(t('hud.options.graphics'), () => goto('graphics'));
    add(t('hud.options.interface'), () => goto('interface'));
    add(t('hud.options.audio'), () => goto('audio'));
    add(t('hudChrome.perf.title'), () => goto('performance'));
    // Online-only: capturing realm/character/position needs an authoritative server.
    if (this.bugReportHooks) add(t('hudChrome.bugReport.menuButton'), () => goto('bugreport'));
    add(t('hud.options.logout'), () => this.optionsHooks?.logout());
    add(t('hud.options.returnToGame'), () => this.closeOptions());
    el.appendChild(list);
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeOptions());
  }

  // A labelled slider bound to a numeric setting; live-applies via the hook.
  // opts.fmt renders the readout (default: a percentage); opts.step overrides the
  // 0.05 increment for settings measured in whole units (e.g. FOV degrees).
  private settingSlider(
    parent: HTMLElement,
    label: string,
    key: NumericSettingKey,
    opts?: { fmt?: (v: number) => string; step?: number },
  ): void {
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
    slider.step = String(opts?.step ?? 0.05);
    slider.value = String(hooks.settings.get(key));
    slider.setAttribute('aria-label', label);
    const val = document.createElement('span');
    val.className = 'set-val';
    const fmt =
      opts?.fmt ?? ((v: number) => formatNumber(v, { style: 'percent', maximumFractionDigits: 0 }));
    const readout = () => fmt(hooks.settings.get(key));
    val.textContent = readout();
    // Paint a gold fill up to the current value on every engine (CSS alone can't
    // read the value; --range-fill drives the webkit track gradient and Firefox's
    // native progress is recolored to match). Set initially + on every input.
    const paintFill = () => {
      const min = Number(slider.min),
        max = Number(slider.max),
        v = Number(slider.value);
      const pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
      slider.style.setProperty('--range-fill', `${Math.max(0, Math.min(100, pct))}%`);
    };
    paintFill();
    slider.addEventListener('input', () => {
      hooks.onSettingChange(key, Number(slider.value));
      val.textContent = readout();
      paintFill();
    });
    row.append(name, slider, val);
    parent.appendChild(row);
  }

  private settingToggle(
    parent: HTMLElement,
    label: string,
    key: 'fullscreen' | 'showOverflowXp' | 'weather',
  ): void {
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

  // Like settingToggle but for a true/false BOOL_SETTINGS key (Interface panel).
  private settingBoolToggle(parent: HTMLElement, label: string, key: BoolSettingKey): void {
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
      const on = hooks.settings.get(key);
      toggle.textContent = on ? t('hud.options.on') : t('hud.options.off');
      toggle.classList.toggle('off', !on);
      toggle.setAttribute('aria-pressed', String(on));
      toggle.setAttribute('aria-label', label);
    };
    sync();
    toggle.addEventListener('click', () => {
      audio.click();
      hooks.onSettingChange(key, hooks.settings.set(key, !hooks.settings.get(key)));
      sync();
    });
    row.append(name, toggle);
    parent.appendChild(row);
  }

  private settingChoice(
    parent: HTMLElement,
    label: string,
    key: NumericSettingKey,
    options: { value: number; label: string }[],
    onChange?: () => void,
  ): void {
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
      if (all)
        for (const k of Object.keys(all) as (keyof GameSettings)[])
          this.optionsHooks?.onSettingChange(k, all[k]);
      this.renderOptions();
    });
    const back = document.createElement('button');
    back.className = 'btn';
    back.textContent = t('hud.options.back');
    back.addEventListener('click', () => {
      audio.click();
      this.optionsView = 'main';
      this.renderOptions();
    });
    el.append(reset, back);
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeOptions());
  }

  private renderBugReport(): void {
    const hooks = this.bugReportHooks;
    if (!hooks) {
      this.optionsView = 'main';
      this.renderOptions();
      return;
    }
    const body = this.settingsViewShell(t('hudChrome.bugReport.menuButton'));
    const p = this.sim.player;
    const realm = this.sim.realm || t('hudChrome.bugReport.unknown');
    const coords =
      `${formatNumber(p.pos.x, { maximumFractionDigits: 0, useGrouping: false })}, ` +
      `${formatNumber(p.pos.y, { maximumFractionDigits: 0, useGrouping: false })}, ` +
      `${formatNumber(p.pos.z, { maximumFractionDigits: 0, useGrouping: false })}`;

    const info = document.createElement('div');
    info.className = 'bug-info';
    const row = (label: string, value: string): string =>
      `<div class="bug-info-row"><span class="bug-info-label">${esc(label)}</span><span class="bug-info-val">${esc(value)}</span></div>`;
    info.innerHTML =
      row(t('hudChrome.bugReport.realm'), realm) +
      row(t('hudChrome.bugReport.character'), p.name) +
      row(t('hudChrome.bugReport.position'), coords);
    body.appendChild(info);

    // Capture once when the form opens so the screenshot reflects what the player
    // saw, not a later frame. null when capture is unavailable/failed.
    const shot = hooks.capture();

    const descLabel = document.createElement('label');
    descLabel.className = 'bug-label';
    descLabel.setAttribute('for', 'bug-desc');
    descLabel.textContent = t('hudChrome.bugReport.description');
    const desc = document.createElement('textarea');
    desc.id = 'bug-desc';
    desc.className = 'bug-desc';
    desc.maxLength = 2000;
    desc.setAttribute('placeholder', t('hudChrome.bugReport.descriptionPlaceholder'));
    desc.setAttribute('aria-describedby', 'bug-error');
    body.append(descLabel, desc);

    let includeShot = shot !== null;
    if (shot) {
      const shotWrap = document.createElement('div');
      shotWrap.className = 'bug-shot';
      const img = document.createElement('img');
      img.className = 'bug-shot-img';
      img.src = shot;
      img.alt = t('hudChrome.bugReport.screenshotAlt');
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'btn set-toggle';
      const syncToggle = () => {
        toggle.textContent = includeShot ? t('hud.options.on') : t('hud.options.off');
        toggle.classList.toggle('off', !includeShot);
        toggle.setAttribute('aria-pressed', String(includeShot));
        toggle.setAttribute('aria-label', t('hudChrome.bugReport.includeScreenshot'));
        img.style.display = includeShot ? '' : 'none';
      };
      toggle.addEventListener('click', () => {
        audio.click();
        includeShot = !includeShot;
        syncToggle();
      });
      syncToggle();
      const toggleRow = document.createElement('div');
      toggleRow.className = 'set-row';
      const name = document.createElement('span');
      name.className = 'set-name';
      name.textContent = t('hudChrome.bugReport.includeScreenshot');
      toggleRow.append(name, toggle);
      shotWrap.append(toggleRow, img);
      body.appendChild(shotWrap);
    }

    const error = document.createElement('div');
    error.className = 'report-error';
    error.id = 'bug-error';
    // role="alert" already implies an assertive live region; a second aria-live
    // would conflict, so it is the only announcement hook on this node.
    error.setAttribute('role', 'alert');
    body.appendChild(error);

    const actions = document.createElement('div');
    actions.className = 'report-actions';
    const submit = document.createElement('button');
    submit.className = 'btn';
    submit.type = 'button';
    submit.textContent = t('hudChrome.bugReport.submit');
    const back = document.createElement('button');
    back.className = 'btn';
    back.type = 'button';
    back.textContent = t('hud.options.back');
    back.addEventListener('click', () => {
      audio.click();
      this.optionsView = 'main';
      this.renderOptions();
    });
    actions.append(submit, back);
    body.appendChild(actions);

    submit.addEventListener('click', () => {
      const description = desc.value.trim();
      if (!description) {
        error.textContent = t('hudChrome.bugReport.describeFirst');
        return;
      }
      submit.disabled = true;
      error.textContent = '';
      const sentShot = includeShot && shot !== null;
      hooks
        .submit({ description, screenshot: includeShot ? shot : null, meta: hooks.collectMeta() })
        .then(({ screenshotStored }) => {
          // Be honest when the server dropped a screenshot the player asked to send.
          const droppedShot = sentShot && !screenshotStored;
          this.log(
            t(
              droppedShot ? 'hudChrome.bugReport.submittedNoShot' : 'hudChrome.bugReport.submitted',
            ),
            '#ffd100',
          );
          this.optionsView = 'main';
          this.renderOptions();
        })
        .catch((err: unknown) => {
          submit.disabled = false;
          error.textContent = this.localizeBugReportError(err);
        });
    });

    $('#options-menu')
      .querySelector('[data-close]')
      ?.addEventListener('click', () => this.closeOptions());
    // Focus the description so a keyboard/screen-reader user lands in the field.
    window.setTimeout(() => desc.focus(), 0);
  }

  private localizeBugReportError(err: unknown): string {
    const text = err instanceof Error ? err.message : '';
    const keyByMessage: Record<string, TranslationKey> = {
      'describe the bug': 'hudChrome.bugReport.describeFirst',
      'bug report too large': 'hudChrome.bugReport.tooLarge',
      'too many bug reports, try again later': 'hudChrome.bugReport.rateLimited',
    };
    const key = keyByMessage[text.toLowerCase()];
    return key ? t(key) : t('hudChrome.bugReport.failed');
  }

  private renderGraphics(): void {
    const body = this.settingsViewShell(t('hud.options.graphics'));
    this.settingChoice(
      body,
      t('hud.options.graphicsQuality'),
      'graphicsPreset',
      [
        { value: 1, label: t('hud.options.graphicsPresetLow') },
        { value: 2, label: t('hud.options.graphicsPresetMedium') },
        { value: 3, label: t('hud.options.graphicsPresetHigh') },
        { value: 4, label: t('hud.options.graphicsPresetUltra') },
        { value: 5, label: t('hud.options.graphicsPresetAdvanced') },
      ],
      () => this.renderGraphics(),
    );
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
    // Adaptive CSS-effects tier (DOM layer, separate from the WebGL preset above).
    // Auto detects the browser engine/version + device; manual values pin it.
    this.settingChoice(body, t('hudChrome.options.browserEffects'), 'browserEffects', [
      { value: 0, label: t('hudChrome.options.browserEffectsAuto') },
      { value: 1, label: t('hudChrome.options.browserEffectsFull') },
      { value: 2, label: t('hudChrome.options.browserEffectsReduced') },
      { value: 3, label: t('hudChrome.options.browserEffectsMinimal') },
    ]);
    const fxNote = document.createElement('div');
    fxNote.className = 'set-note';
    fxNote.textContent = t('hudChrome.options.browserEffectsNote');
    body.appendChild(fxNote);
    // Desktop keyboard/mouse vs the on-screen touch controls. Auto detects the
    // device; Desktop/Touch force one (e.g. a tablet with a keyboard picks
    // Desktop). Re-render so the touch-only sliders below show/hide to match.
    // Hidden in the native app shell, which forces the touch UI regardless.
    if (!isNativeAppShell()) {
      this.settingChoice(
        body,
        t('hudChrome.options.interfaceMode'),
        'interfaceMode',
        [
          { value: 0, label: t('hudChrome.options.interfaceModeAuto') },
          { value: 1, label: t('hudChrome.options.interfaceModeDesktop') },
          { value: 2, label: t('hudChrome.options.interfaceModeTouch') },
        ],
        () => this.renderGraphics(),
      );
      const interfaceNote = document.createElement('div');
      interfaceNote.className = 'set-note';
      interfaceNote.textContent = t('hudChrome.options.interfaceModeNote');
      body.appendChild(interfaceNote);
    }
    this.settingSlider(body, t('hud.options.cameraSpeed'), 'cameraSpeed');
    // Camera Speed only scales mouselook; on touch the camera joystick has its
    // own rate, so phones get a dedicated sensitivity slider here.
    if (useTouchInterface())
      this.settingSlider(body, t('hud.options.touchLookSpeed'), 'touchLookSpeed');
    this.settingSlider(body, t('hud.options.brightness'), 'brightness');
    this.settingSlider(body, t('hud.options.fieldOfView'), 'cameraFov', {
      fmt: (v) => `${formatNumber(Math.round(v), { maximumFractionDigits: 0 })}°`,
      step: 1,
    });
    this.settingSlider(body, t('hud.options.renderQuality'), 'renderScale');
    this.settingToggle(body, t('hud.options.fullscreen'), 'fullscreen');
    this.settingToggle(body, t('game.settings.showOverflowXp'), 'showOverflowXp');
    // Touch-only: lets phone players dim the on-screen joysticks + buttons.
    if (useTouchInterface())
      this.settingSlider(body, t('hud.options.touchOpacity'), 'touchOpacity');
    this.settingToggle(body, t('game.settings.weather'), 'weather');
    // Touch-only: lets phone players size the on-screen joysticks to their hands.
    if (useTouchInterface())
      this.settingSlider(body, t('hud.options.joystickSize'), 'joystickScale');
    // Touch-only: lets phone players size the on-screen action buttons to taste.
    if (useTouchInterface())
      this.settingSlider(body, t('hud.options.buttonSize'), 'actionButtonScale');
    // Touch-only: a larger deadzone resists accidental drift from a resting
    // thumb on the move stick; only meaningful with on-screen controls.
    if (useTouchInterface())
      this.settingSlider(body, t('hud.options.joystickDeadzone'), 'joystickDeadzone');
    // Touch-only: flips the vertical axis of the on-screen camera joystick + swipe-look.
    if (useTouchInterface())
      this.settingBoolToggle(body, t('hud.options.invertLook'), 'touchInvertLook');
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
    reload.addEventListener('click', () => {
      audio.click();
      location.reload();
    });
    $('#options-menu').append(reloadNote, reload);
    this.settingsViewFooter();
  }

  private renderAudio(): void {
    const body = this.settingsViewShell(t('hud.options.audio'));
    this.settingSlider(body, t('hud.options.soundEffects'), 'sfxVolume');
    this.settingSlider(body, t('hud.options.musicVolume'), 'musicVolume');
    this.settingSlider(body, t('hud.options.voiceVolume'), 'voiceVolume');
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
    toggle.addEventListener('click', () => {
      audio.click();
      music.setEnabled(!music.enabled);
      sync();
    });
    row.append(name, toggle);
    body.appendChild(row);
    this.settingBoolToggle(body, t('hud.options.npcVoices'), 'voiceEnabled');
    this.settingBoolToggle(body, t('hudChrome.options.footstepSounds'), 'footstepSfx');
    this.settingBoolToggle(body, t('hudChrome.options.clickFeedback'), 'clickFeedback');
    this.settingsViewFooter();
  }

  // Interface & Comfort panel: presentational HUD tuning + accessibility toggles
  // (sliders/toggles persisted to the GameSettings store, applied via CSS in
  // main.ts) plus the classic client-side "Show Timestamps" chat option. None of
  // it touches the simulation.
  // In-game language picker (Options > Interface). Mirrors the homepage footer picker so a
  // player can switch locales without leaving the world. Switching is delegated to the
  // OptionsHooks.changeLanguage seam (main.ts owns the locale load + page relocalization);
  // the HUD itself relocalizes its dynamic UI off the woc:languagechange event (see ctor).
  private languageSelect(parent: HTMLElement): void {
    const hooks = this.optionsHooks;
    if (!hooks) return;
    const row = document.createElement('div');
    row.className = 'set-row';
    const name = document.createElement('span');
    name.className = 'set-name';
    name.textContent = t('hud.options.language');
    // Custom gold-themed dropdown (.ui-dd) rather than a native <select>, so the
    // open option list matches the MMO theme; buildDropdown carries the listbox
    // ARIA + keyboard semantics a native <select> would have.
    const options = supportedLanguages.map((lang) => ({
      value: lang,
      label: LANGUAGE_ENDONYMS[lang],
    }));
    // aria-live status for the async locale load (loading / load-failed).
    const status = document.createElement('span');
    status.className = 'visually-hidden';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    let busy = false;
    const dropdown = this.buildDropdown(
      options,
      getLanguage(),
      (selected) => {
        if (busy || !isSupportedLanguage(selected) || selected === getLanguage()) return;
        audio.click();
        busy = true;
        void hooks
          .changeLanguage(selected, (msg) => {
            status.textContent = msg;
          })
          .then((ok) => {
            if (ok) {
              // Success: rebuild the panel in the new language (re-creates this picker
              // at the now-active locale).
              if (this.optionsOpen && this.optionsView === 'interface') {
                this.renderInterface();
                // Return keyboard focus to the fresh picker trigger so it isn't lost to <body>.
                this.focusFirstInteractive($('#options-menu'), '.set-lang-select .ui-dd-btn');
              }
            } else {
              // Graceful failure (the locale chunk failed to load): the active locale
              // is unchanged. Revert the trigger IN PLACE — don't renderInterface(),
              // which would rebuild and wipe the aria-live `status` node that
              // changeLanguage just wrote the failure message into.
              this.setDropdownValue(dropdown, getLanguage());
            }
          })
          .catch(() => {
            // Defensive: changeLanguage swallows load errors and resolves false, so
            // this is unreachable today — but if it ever throws, keep the same
            // in-place revert + intact live region rather than rebuilding.
            status.textContent = t('settings.languageLoadFailed');
            this.setDropdownValue(dropdown, getLanguage());
          })
          .finally(() => {
            busy = false;
          });
      },
      undefined,
      { ariaLabel: t('hud.options.language') },
    );
    dropdown.classList.add('set-lang-select');
    row.append(name, dropdown);
    parent.append(row, status);
  }

  // UI theme picker: a preset selector plus a full-palette custom-colour block.
  // Preset/custom changes route through OptionsHooks.theme; main.ts persists and
  // live-applies the resulting CSS variables, so no reload is needed.
  private renderThemeControls(body: HTMLElement): void {
    const hooks = this.optionsHooks;
    if (!hooks) return;
    const theme = hooks.theme;

    const presetRow = document.createElement('div');
    presetRow.className = 'set-row';
    const presetName = document.createElement('span');
    presetName.className = 'set-name';
    presetName.textContent = t('hudChrome.theme.preset');
    const seg = document.createElement('div');
    seg.className = 'set-seg theme-presets';
    const presetLabel = (id: PresetId): string =>
      t(`hudChrome.theme.presets.${id}` as TranslationKey);
    for (const id of PRESET_ORDER) {
      const btn = document.createElement('button');
      btn.className = 'btn set-seg-btn';
      btn.textContent = presetLabel(id);
      btn.classList.toggle('active', theme.get().preset === id);
      btn.addEventListener('click', () => {
        audio.click();
        theme.setPreset(id);
        this.renderInterface(); // refresh active state + custom pickers
      });
      seg.appendChild(btn);
    }
    presetRow.append(presetName, seg);
    body.appendChild(presetRow);

    // Custom palette: one colour input per knob, seeded with the effective value.
    const effective = resolveTheme(theme.get());
    const customCount = Object.keys(theme.get().custom).length;
    const customRow = document.createElement('div');
    customRow.className = 'set-row theme-custom-head';
    const customName = document.createElement('span');
    customName.className = 'set-name';
    customName.textContent = t('hudChrome.theme.customColors');
    const reset = document.createElement('button');
    reset.className = 'btn set-toggle';
    reset.textContent = t('hudChrome.theme.reset');
    reset.disabled = customCount === 0;
    reset.addEventListener('click', () => {
      audio.click();
      theme.resetCustom();
      this.renderInterface();
    });
    customRow.append(customName, reset);
    body.appendChild(customRow);

    const grid = document.createElement('div');
    grid.className = 'theme-color-grid';
    for (const knob of THEME_KNOB_ORDER) {
      const row = document.createElement('label');
      row.className = 'theme-color-row';
      const swatchLabel = document.createElement('span');
      swatchLabel.textContent = t(
        `hudChrome.theme.knob.${THEME_KNOB_LABEL_KEY[knob]}` as TranslationKey,
      );
      const input = document.createElement('input');
      input.type = 'color';
      input.value = effective[knob];
      input.setAttribute('aria-label', swatchLabel.textContent);
      // 'input' fires continuously while dragging the picker → live preview.
      input.addEventListener('input', () => theme.setCustom(knob, input.value));
      input.addEventListener('change', () => {
        theme.setCustom(knob, input.value);
        reset.disabled = false;
      });
      row.append(input, swatchLabel);
      grid.appendChild(row);
    }
    body.appendChild(grid);
  }

  private renderInterface(): void {
    const body = this.settingsViewShell(t('hud.options.interface'));
    this.languageSelect(body);
    this.renderThemeControls(body);
    this.settingSlider(body, t('hudChrome.options.uiScale'), 'uiScale');
    this.settingSlider(body, t('hud.options.hudOpacity'), 'hudOpacity');
    this.settingSlider(body, t('hud.options.tooltipScale'), 'tooltipScale');
    this.settingSlider(body, t('hud.options.fctScale'), 'fctScale');
    this.settingSlider(body, t('hud.options.chatFontScale'), 'chatFontScale');
    this.settingSlider(body, t('hud.options.chatOpacity'), 'chatOpacity');
    this.settingBoolToggle(body, t('hud.options.compactChat'), 'compactChat');
    this.settingBoolToggle(body, t('hud.options.frostedPanels'), 'frostedPanels');
    this.settingBoolToggle(body, t('hud.options.highContrastText'), 'highContrastText');
    this.settingBoolToggle(body, t('hud.options.reduceMotion'), 'reduceMotion');
    this.settingBoolToggle(
      body,
      t('hudChrome.options.showWalletOnCharacterScreen'),
      'showWalletOnCharacterScreen',
    );
    this.settingBoolToggle(
      body,
      t('hudChrome.options.showWalletOnPlayerCard'),
      'showWalletOnPlayerCard',
    );
    this.settingBoolToggle(
      body,
      t('hudChrome.options.highContrastBackground'),
      'landingHighContrast',
    );
    this.settingBoolToggle(body, t('hud.options.invertLookY'), 'invertLookY');

    // On/off toggle for chat timestamps.
    const tsRow = document.createElement('div');
    tsRow.className = 'set-row';
    const tsName = document.createElement('span');
    tsName.className = 'set-name';
    tsName.textContent = t('hudChrome.chatTimestamps.show');
    const tsToggle = document.createElement('button');
    tsToggle.className = 'btn set-toggle';

    // 12/24-hour format selector — two segmented buttons, dimmed when off.
    const fmtRow = document.createElement('div');
    fmtRow.className = 'set-row';
    const fmtName = document.createElement('span');
    fmtName.className = 'set-name';
    fmtName.textContent = t('hudChrome.chatTimestamps.format');
    const seg = document.createElement('div');
    seg.className = 'set-seg';
    const btn12 = document.createElement('button');
    btn12.className = 'btn set-seg-btn';
    btn12.textContent = t('hudChrome.chatTimestamps.clock12h');
    const btn24 = document.createElement('button');
    btn24.className = 'btn set-seg-btn';
    btn24.textContent = t('hudChrome.chatTimestamps.clock24h');
    seg.append(btn12, btn24);
    fmtRow.append(fmtName, seg);

    const sync = () => {
      tsToggle.textContent = this.chatTimestamps ? t('hud.options.on') : t('hud.options.off');
      tsToggle.classList.toggle('off', !this.chatTimestamps);
      tsToggle.setAttribute('aria-pressed', String(this.chatTimestamps));
      btn12.classList.toggle('active', this.chatClock === '12h');
      btn24.classList.toggle('active', this.chatClock === '24h');
      fmtRow.classList.toggle('disabled', !this.chatTimestamps);
      btn12.disabled = !this.chatTimestamps;
      btn24.disabled = !this.chatTimestamps;
    };
    sync();

    tsToggle.addEventListener('click', () => {
      audio.click();
      this.chatTimestamps = !this.chatTimestamps;
      localStorage.setItem('chatTimestamps', this.chatTimestamps ? '1' : '0');
      sync();
    });
    const setClock = (clock: ChatClock) => {
      if (!this.chatTimestamps) return;
      audio.click();
      this.chatClock = clock;
      localStorage.setItem('chatClock', clock);
      sync();
    };
    btn12.addEventListener('click', () => setClock('12h'));
    btn24.addEventListener('click', () => setClock('24h'));

    tsRow.append(tsName, tsToggle);
    body.append(tsRow, fmtRow);

    // Reset the movable/resizable chat window back to its default placement.
    const resetRow = document.createElement('div');
    resetRow.className = 'set-row';
    const resetName = document.createElement('span');
    resetName.className = 'set-name';
    resetName.textContent = t('hudChrome.chatWindow.reset');
    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn set-toggle';
    resetBtn.textContent = t('hudChrome.chatWindow.resetAction');
    resetBtn.addEventListener('click', () => {
      audio.click();
      this.resetChatWindow();
    });
    resetRow.append(resetName, resetBtn);
    body.append(resetRow);

    const note = document.createElement('div');
    note.className = 'set-note';
    note.textContent = t('hudChrome.chatTimestamps.note');
    $('#options-menu').appendChild(note);

    const chatWinNote = document.createElement('div');
    chatWinNote.className = 'set-note';
    chatWinNote.textContent = t('hudChrome.chatWindow.note');
    $('#options-menu').appendChild(chatWinNote);

    const back = document.createElement('button');
    back.className = 'btn';
    back.textContent = t('hud.options.back');
    back.addEventListener('click', () => {
      audio.click();
      this.optionsView = 'main';
      this.renderOptions();
    });
    $('#options-menu').appendChild(back);
    $('#options-menu')
      .querySelector('[data-close]')
      ?.addEventListener('click', () => this.closeOptions());
  }

  // ---- Performance overlay panel -----------------------------------------
  // Customizable in-game stats overlay (FPS, frame time, ping, draw calls, …).
  // The wide, categorized panel lives in perf_overlay_settings.ts (the pure
  // consumer of the overlay's config store); the HUD only owns this thin delegate
  // + the master on/off wiring (showFps rides on GameSettings).

  private renderPerformance(): void {
    const hooks = this.optionsHooks;
    if (!hooks) return;
    this.perfSettings ??= new PerfOverlaySettingsPanel(this.perfSettingsHost(hooks));
    this.perfSettings.render($('#options-menu'));
  }

  private perfSettingsHost(hooks: OptionsHooks): PerfSettingsHost {
    return {
      perf: hooks.perfOverlay,
      getShowFps: () => hooks.settings.get('showFps'),
      setShowFps: (on) => hooks.onSettingChange('showFps', on),
      click: () => audio.click(),
      onClose: () => this.closeOptions(),
      onBack: () => {
        this.optionsView = 'main';
        this.renderOptions();
      },
      closeIconHtml: svgIcon('close'),
    };
  }

  /** Called by main.ts when a drag settles on the live overlay: push the dropped
   *  normalized position into the open panel's Horizontal/Vertical sliders so they
   *  do not lag behind the drag. No-op when the panel is not on screen. */
  onPerfOverlayMoved(x: number, y: number): void {
    this.perfSettings?.syncPosition(x, y);
  }

  // Display name for an action row. Action-bar slots show the shortcut that
  // currently occupies them (slot 0 is always Attack); everything else uses
  // its registry label.
  private actionDisplayName(actionId: string, fallback: string): string {
    if (!actionId.startsWith('slot'))
      return BIND_ACTION_LABEL_KEYS[actionId] ? t(BIND_ACTION_LABEL_KEYS[actionId]) : fallback;
    const slot = Number(actionId.slice(4));
    if (slot === 0) return t('hud.keybinds.actions.attack');
    const known = this.abilityForSlot(slot);
    if (known) return abilityDisplayName(known.def);
    const item = this.itemForSlot(slot);
    return item
      ? itemDisplayName(item)
      : t('hud.keybinds.actions.actionBarSlot', { slot: slot + 1 });
  }

  // Toggle row styled for the Key Bindings panel. Handles the bool Mouse Camera
  // setting and the numeric (0/1) Click to Move setting, which both live here
  // alongside the rebindable keys.
  private settingToggleKeybind(
    parent: HTMLElement,
    label: string,
    key: BoolSettingKey | 'clickToMove',
    help?: string,
  ): void {
    const hooks = this.optionsHooks;
    if (!hooks) return;
    const isOn = () =>
      key === 'clickToMove' ? hooks.settings.get(key) >= 0.5 : hooks.settings.get(key);
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
      // Attack Move reveals/hides its rebindable key row, so redraw the panel.
      if (key === 'attackMove') this.renderKeybinds();
    });
    row.append(name, toggle);
    parent.appendChild(row);
    if (help) {
      const hint = document.createElement('div');
      hint.className = 'kb-note kb-toggle-help';
      hint.textContent = help;
      parent.appendChild(hint);
    }
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
      toggle.textContent = t(
        normalizeClickMoveButton(hooks.settings.get('clickToMoveButton')) === 2
          ? 'hudChrome.options.clickMoveRight'
          : 'hudChrome.options.clickMoveLeft',
      );
      toggle.setAttribute(
        'aria-label',
        `${t('hud.options.clickMoveButton')}: ${toggle.textContent}`,
      );
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

  // Action ids a gamepad button may be bound to: explicit unbind, the game menu,
  // plus every one-shot (edge) keybind action and Jump. Movement-axis actions
  // (forward/strafe/turn) are excluded, they live on the analog stick.
  private gamepadActionOptions(): { value: string; label: string }[] {
    const opts: { value: string; label: string }[] = [
      { value: GAMEPAD_NONE, label: t('hud.options.unbound') },
      { value: 'escape', label: t('hudChrome.controller.menuAction') },
    ];
    for (const a of BIND_ACTIONS) {
      if (a.id === 'attackMove') continue; // mode-gated; not a useful pad default
      if (a.kind !== 'edge' && a.id !== 'jump') continue;
      opts.push({ value: a.id, label: this.actionDisplayName(a.id, a.label) });
    }
    return opts;
  }

  // Controller panel: enable/invert toggles, deadzone/camera/vibration sliders,
  // and a remap row per bindable button (dropdown of actions). Mirrors the
  // separate woc_gamepad profile; keyboard Key Bindings are untouched.
  private renderController(): void {
    const hooks = this.optionsHooks;
    const body = this.settingsViewShell(t('hudChrome.controller.title'));
    this.settingBoolToggle(body, t('hudChrome.controller.enable'), 'gamepadEnabled');
    this.settingBoolToggle(body, t('hudChrome.controller.invertY'), 'gamepadInvertY');
    this.settingSlider(body, t('hudChrome.controller.deadzone'), 'gamepadStickDeadzone');
    this.settingSlider(body, t('hudChrome.controller.cameraSpeed'), 'gamepadCameraSpeed', {
      fmt: (v) => formatNumber(v, { maximumFractionDigits: 1 }),
    });
    this.settingSlider(body, t('hudChrome.controller.vibration'), 'gamepadVibration');

    const note = document.createElement('div');
    note.className = 'set-note';
    note.textContent = t('hudChrome.controller.help');
    body.appendChild(note);

    const head = document.createElement('div');
    head.className = 'kb-cat';
    head.textContent = t('hudChrome.controller.buttons');
    body.appendChild(head);

    if (hooks) {
      const opts = this.gamepadActionOptions();
      for (const { button, action } of hooks.gamepad.entries()) {
        const row = document.createElement('div');
        row.className = 'set-row';
        const name = document.createElement('span');
        name.className = 'set-name';
        name.textContent = GAMEPAD_BUTTON_LABELS[button] ?? `#${button}`;
        const dd = this.buildDropdown(opts, action, (v) => hooks.gamepad.bind(button, v));
        row.append(name, dd);
        body.appendChild(row);
      }
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'btn';
      reset.textContent = t('hudChrome.controller.resetButtons');
      reset.addEventListener('click', () => {
        audio.click();
        hooks.gamepad.reset();
        this.renderController();
      });
      body.appendChild(reset);
    }
    this.settingsViewFooter();
  }

  private renderKeybinds(): void {
    const el = $('#options-menu');
    // Wide, multi-column layout for the key-binding view only; other options
    // sub-views (graphics/audio/interface) keep the default 420px width.
    el.classList.add('kb-wide');
    el.innerHTML = `<div class="panel-title"><span>${esc(t('hud.options.keyBindings'))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('hud.options.returnToGame'))}">${svgIcon('close')}</button></div>`;
    this.settingToggleKeybind(el, t('hud.options.mouseCamera'), 'mouseCamera');
    this.settingToggleKeybind(
      el,
      t('hudChrome.options.lockCursorOnRotate'),
      'lockCursorOnRotate',
      t('hudChrome.options.keybindHelpLockCursorOnRotate'),
    );
    this.settingToggleKeybind(el, t('hud.options.clickToMove'), 'clickToMove');
    this.clickMoveMouseButtonRow(el);
    this.settingToggleKeybind(el, t('hud.keybinds.actions.attackMove'), 'attackMove');
    this.settingToggleKeybind(el, t('hud.options.leftHandedTouch'), 'leftHandedTouch');
    this.settingToggleKeybind(el, t('hud.options.filterProfanity'), 'filterProfanity');
    const note = document.createElement('div');
    note.className = 'kb-note';
    note.textContent = this.keybindNote || t('hud.options.keybindHelpMouseCamera');
    el.appendChild(note);
    const cols = document.createElement('div');
    cols.className = 'kb-cols';
    // The Attack Move key is only meaningful (and only rebindable) while its mode
    // is on; otherwise hide its row so it can't shadow Turn Left's A in the list.
    const attackMoveOn = !!this.optionsHooks?.settings.get('attackMove');
    for (const category of BIND_CATEGORIES) {
      const visible = BIND_ACTIONS.filter(
        (a) => a.category === category && (a.id !== 'attackMove' || attackMoveOn),
      );
      if (visible.length === 0) continue;
      // Each category is its own column block (header + its rows) so the wide
      // grid can flow categories side by side; on mobile they stack to one column.
      const col = document.createElement('div');
      col.className = 'kb-col';
      const header = document.createElement('div');
      header.className = 'kb-cat';
      header.textContent = BIND_CATEGORY_LABEL_KEYS[category]
        ? t(BIND_CATEGORY_LABEL_KEYS[category])
        : category;
      col.appendChild(header);
      const rows = document.createElement('div');
      rows.className = 'kb-rows';
      for (const action of visible) {
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
          const capturing =
            this.capturingKey?.action === action.id && this.capturingKey?.index === index;
          const key = document.createElement('button');
          key.className = `btn kb-key${capturing ? ' capturing' : ''}`;
          key.textContent = capturing
            ? '...'
            : this.keybinds.labelAt(action.id, index) || t('hud.options.unbound');
          key.title = index === 0 ? t('hud.options.primary') : t('hud.options.alternate');
          key.setAttribute(
            'aria-label',
            `${this.actionDisplayName(action.id, action.label)} ${key.title}`,
          );
          key.addEventListener('click', () => this.beginCapture(action.id, index, action.label));
          row.appendChild(key);
        }
        rows.appendChild(row);
      }
      col.appendChild(rows);
      cols.appendChild(col);
    }
    el.appendChild(cols);
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
    back.addEventListener('click', () => {
      audio.click();
      this.optionsView = 'main';
      this.capturingKey = null;
      this.renderOptions();
    });
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
        // Label what was actually stored: bind() strips modifiers from held
        // (movement) actions, so a captured "Shift+KeyW" is saved bare as "KeyW".
        // Reading it back keeps the confirmation in sync with the action-bar keycap.
        this.keybindNote = t('hud.options.keybindBound', {
          action: name,
          key: keyLabel(this.keybinds.codeAt(actionId, index)),
        });
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
    if (this.openLootChestId !== null) {
      this.closeLoot();
      return true;
    }
    if (this.cardModalEl) {
      this.closePlayerCardModal();
      return true;
    }
    const ctx = $('#ctx-menu');
    if (ctx.style.display !== 'none' && ctx.style.display !== '') {
      this.closeContextMenu();
      return true;
    }
    if (this.emoteWheelOpen) {
      this.hideEmoteWheel();
      return true;
    }
    const top = this.topmostOpenWindow();
    if (!top) return false;
    this.closeManagedWindow(top);
    return true;
  }
}

function describeAbilitySummary(known: ResolvedAbility, resourceType: ResourceType | null): string {
  const parts: string[] = [];
  if (known.cost > 0) {
    parts.push(
      t('abilityUi.tooltip.cost', {
        cost: formatAbilityNumber(known.cost),
        resource: resourceDisplayName(resourceType),
      }),
    );
  }
  parts.push(abilityCastLine(known));
  if (known.def.cooldown > 0) {
    parts.push(
      t('abilityUi.tooltip.cooldownSeconds', { seconds: formatAbilityNumber(known.def.cooldown) }),
    );
  }
  return parts.join(' · ');
}

function abilityDisplayName(def: AbilityDef): string {
  return tEntity({ kind: 'ability', id: def.id, field: 'name' });
}

function abilityDisplayDescription(def: AbilityDef, damageText: string): string {
  return tEntity({
    kind: 'ability',
    id: def.id,
    field: 'description',
    values: { damage: damageText },
  });
}

function classDisplayName(cls: PlayerClass): string {
  return tEntity({ kind: 'class', id: cls, field: 'name' });
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
  return tEntity({
    kind: 'npc',
    id: npcId,
    field: 'greeting',
    values: { className, classNameLower: className.toLocaleLowerCase(), playerName },
  });
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

function delveText(delveId: string, field: 'enterText' | 'leaveText'): string {
  return tEntity({ kind: 'delve', id: delveId, field });
}

function dungeonDisplayNameFromSource(name: string): string {
  const dungeon = DUNGEON_LIST.find((candidate) => candidate.name === name);
  return dungeon ? dungeonDisplayName(dungeon.id) : name;
}

function entityDisplayName(entity: Entity): string {
  if (entity.kind === 'mob')
    return entity.ownerId !== null ? entity.name : mobDisplayName(entity.templateId);
  if (entity.kind === 'npc') return npcDisplayName(entity.templateId);
  return entity.name;
}

function delveDisplayName(delveId: string): string {
  return tEntity({ kind: 'delve', id: delveId, field: 'name' });
}

/** Render SchematicPrimitive[] onto a canvas context (shared by minimap and world-map). */
function drawSchematicPrimitives(ctx: CanvasRenderingContext2D, prims: SchematicPrimitive[]): void {
  for (const prim of prims) {
    ctx.save();
    if (prim.kind === 'circle') {
      ctx.beginPath();
      ctx.arc(prim.cx, prim.cy, prim.r, 0, Math.PI * 2);
      ctx.fillStyle = prim.fill;
      ctx.fill();
      if (prim.stroke) {
        ctx.strokeStyle = prim.stroke;
        ctx.lineWidth = prim.strokeWidth ?? 1;
        ctx.stroke();
      }
    } else if (prim.kind === 'rect') {
      ctx.fillStyle = prim.fill;
      ctx.fillRect(prim.x, prim.y, prim.w, prim.h);
      if (prim.stroke) {
        ctx.strokeStyle = prim.stroke;
        ctx.lineWidth = prim.strokeWidth ?? 1;
        ctx.strokeRect(prim.x, prim.y, prim.w, prim.h);
      }
    } else if (prim.kind === 'text') {
      ctx.font = prim.font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = prim.fill;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.strokeText(prim.text, prim.cx, prim.cy);
      ctx.fillText(prim.text, prim.cx, prim.cy);
    } else if (prim.kind === 'arrow') {
      ctx.translate(prim.cx, prim.cy);
      ctx.rotate(prim.angle);
      ctx.fillStyle = prim.fill;
      ctx.strokeStyle = prim.stroke;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -prim.size);
      ctx.lineTo(prim.size * 0.6, prim.size * 0.8);
      ctx.lineTo(-prim.size * 0.6, prim.size * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}

function abilityDisplayNameFromSource(name: string): string {
  const ability = Object.values(ABILITIES).find((candidate) => candidate.name === name);
  if (ability) return abilityDisplayName(ability);
  // Boss/mob mechanic names (War Stomp, etc.) surface as a damage-log ability label but
  // are not in ABILITIES; route them through the shared sim aura/mechanic localizer.
  return localizeSimAuraName(name) ?? name;
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
  return formatNumber(value, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
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
    return t('abilityUi.tooltip.channeledSeconds', {
      seconds: formatAbilityNumber(known.def.channel.duration),
    });
  }
  if (known.castTime > 0) {
    return t('abilityUi.tooltip.castSeconds', { seconds: formatAbilityNumber(known.castTime) });
  }
  return t('abilityUi.tooltip.instant');
}

function abilityRequirementLines(def: AbilityDef): string[] {
  const lines: string[] = [];
  if (def.requiresForm)
    lines.push(t('abilityUi.tooltip.requiresForm', { form: t(FORM_LABEL_KEYS[def.requiresForm]) }));
  if (def.requiresStealth) lines.push(t('abilityUi.tooltip.requiresStealth'));
  if (def.spendsCombo) lines.push(t('abilityUi.tooltip.requiresCombo'));
  if (def.requiresDodgeProc) lines.push(t('abilityUi.tooltip.requiresDodge'));
  if (def.requiresOutOfCombat) lines.push(t('abilityUi.tooltip.requiresOutOfCombat'));
  if (def.requiresTargetHpBelow !== undefined) {
    lines.push(
      t('abilityUi.tooltip.requiresTargetHealthBelow', {
        percent: formatAbilityNumber(def.requiresTargetHpBelow * 100),
      }),
    );
  }
  if (def.onNextSwing) lines.push(t('abilityUi.tooltip.onNextSwing'));
  if (def.offGcd) lines.push(t('abilityUi.tooltip.offGlobalCooldown'));
  if (def.targetType === 'friendly') lines.push(t('abilityUi.tooltip.friendlyTarget'));
  else if (def.requiresTarget) lines.push(t('abilityUi.tooltip.enemyTarget'));
  return lines;
}

function abilityEffectText(effects: AbilityEffect[]): string {
  const primary = effects.find(
    (eff) =>
      eff.type === 'directDamage' ||
      eff.type === 'heal' ||
      eff.type === 'weaponDamage' ||
      eff.type === 'weaponStrike' ||
      eff.type === 'aoeDamage' ||
      eff.type === 'aoeRoot' ||
      eff.type === 'finisherDamage' ||
      eff.type === 'drainTick',
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

  const secondary = effects.find(
    (eff) =>
      eff.type === 'dot' || eff.type === 'hot' || eff.type === 'absorb' || eff.type === 'imbue',
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
    case 'combat':
      return t('hud.social.status.combat');
    case 'dungeon':
      return t('hud.social.status.dungeon');
    case 'dead':
      return t('hud.social.status.dead');
    default:
      return t('hud.social.status.online');
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
