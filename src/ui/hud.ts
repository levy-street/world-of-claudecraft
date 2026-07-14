import { audio } from '../game/audio';
import type { GamepadKind } from '../game/gamepad_map';
import { type Keybinds, keyCapLabel } from '../game/keybinds';
import { music, musicZoneForLocation, shouldResetMusicForDungeonEntry } from '../game/music';
import type { GameSettings, Settings } from '../game/settings';
import { sfx } from '../game/sfx';
import type { UiEffectsTier } from '../game/ui_effects_profile';
import {
  auraRefreshIntervalMs,
  cadenceDue,
  coerceFxTier,
  minimapRedrawIntervalMs,
  nonSelfRepaintDue,
  targetFrameNonSelfIntervalMs,
} from '../game/ui_tier_knobs';
import { voice, voiceDistanceGain } from '../game/voice';
import type { ClaudiumStoreItem } from '../net/economy_sdk';
import { castBarState, consumeBarState } from '../render/cast_bar';
import { CharacterPreview } from '../render/characters';
import { preloadMechAssets } from '../render/characters/assets';
import { mechHeldWeaponOverride, skinCount } from '../render/characters/manifest';
import {
  onPortraitsReady,
  playerPortraitDataUrl,
  visualPortraitDataUrl,
} from '../render/characters/portrait';
import { isFriendlyPet, mobTooltipConColor } from '../render/reaction';
import type { Renderer } from '../render/renderer';
import {
  type ChatSenderFlair,
  normalizeStreamerLink,
  type StreamerLinks,
} from '../sim/account_flair';
import { type AugmentCategory, augmentCategory } from '../sim/content/augments';
import { DEED_ORDER, DEEDS } from '../sim/content/deeds';
import { HEROIC_MARK_ITEM_ID } from '../sim/content/dungeon_difficulty';
import { HEROIC_VENDOR_STOCK } from '../sim/content/heroic_vendor';
import {
  EVENT_SKIN_TIERS,
  MECH_CHROMAS,
  SKIN_RANKS,
  type SkinTier,
  skinRankOrder,
} from '../sim/content/skins';
import { FIRST_TALENT_LEVEL, type TalentAllocation, talentsFor } from '../sim/content/talents';
import { SPORT_ABILITIES } from '../sim/content/vale_cup';
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
  QUESTS,
  questRewardItem,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_X,
  WORLD_MIN_Z,
  ZONES,
  zoneAt,
} from '../sim/data';
import { CHRONICLER_TEMPLATE_IDS } from '../sim/deeds';
import { specialRoleColor } from '../sim/discord_roles';
import { armorTypeForItem, canEquipItem, weaponArchetypeForItem } from '../sim/equipment_rules';
import { isItemLevelEligible, itemLevel, itemScore } from '../sim/item_level';
import { requiredLevelFor } from '../sim/item_level_req';
import type { Ante, PickAction } from '../sim/lockpick';
import { PICK_ACTIONS } from '../sim/lockpick';
import { FOCUS_POINT_BUDGET, isInTownZone } from '../sim/professions/focus';
import { type QuestObjectiveRef, questObjectivesForMob } from '../sim/quest_targets';
import type { ResolvedAbility } from '../sim/sim';
import type {
  AbilityDef,
  CalendarResultCode,
  EquipSlot,
  HonorReason,
  InvSlot,
  ItemSlot,
  LootRollChoice,
  MailResultCode,
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
  FAERIE_FIRE_ARMOR_PCT,
  FISHING_CAST_ID,
  type ItemDef,
  isQuestTurnInNpc,
  MAX_LEVEL,
  MELEE_RANGE,
  MILESTONES,
  type RiteIntensity,
  type SimEvent,
  SUNDER_ARMOR_PCT_PER_STACK,
  virtualLevel,
  xpUntilNextPrestige,
} from '../sim/types';
import { isAtSowfield } from '../sim/vale_cup_layout';
import { worldBossIdFromLockout } from '../sim/world_boss';
import {
  type CharacterProfile,
  type DailyRewardStatus,
  type DelveRunInfo,
  type IWorld,
  isOverheadEmoteId,
  OVERHEAD_EMOTES,
  type OverheadEmoteId,
  type PartyInfo,
} from '../world_api';
import {
  type AbilityScaling,
  abilityBuffValue,
  abilityDamageBonus,
  abilityDurationValue,
  abilityOverTimeEffect,
  abilityPrimaryEffect,
  abilitySecondaryEffect,
} from './ability_damage';
import { isSelfOnlyAbility } from './ability_self_only';
import { ActionBarPainter, type ActionBarSlotElements } from './action_bar_painter';
import {
  ABILITY_ICON_PREFIX,
  type ActionBarView,
  ATTACK_ICON_KEY,
  createActionBarView,
  EMPTY_ICON_KEY,
  ITEM_ICON_PREFIX,
} from './action_bar_view';
import { ArenaWindow } from './arena_window';
import {
  abilityStartsAutoAttack,
  deferAutoAttackUntilCastEnd,
  hasAutoAttackTarget,
} from './attack_on_ability';
import { type AuraEffectInput, auraEffectDescriptor } from './aura_effect';
import { AurasPainter, type AurasPainterDeps } from './auras_painter';
import { type AurasDeps, createAurasView } from './auras_view';
import { attachAvatarFallback } from './avatar_fallback';
import { bagsWindowShown } from './bags_view';
import { BagsWindow, dismissBagPrompts } from './bags_window';
import { BankWindow } from './bank_window';
import { CalendarWindow } from './calendar_window';
import { CastBarPainter } from './cast_bar_painter';
import { buildPaperdollView, type PaperdollSlot } from './char_view';
import { CharWindow } from './char_window';
import {
  activeCharacterAppearancePreview,
  characterAppearanceOptions,
} from './character_appearance';
import { ChatAnnouncer } from './chat_announcer';
import {
  CHANNEL_LABEL_KEYS,
  CHAT_TAB_CHANNELS,
  type ChatOpenTab,
  type ChatTabChannel,
  type ChatTabId,
  channelNeedsJoin,
  chatOpenTabLabelKey,
  composeChatLine,
  composeWhisperReply,
  isChatOpenTab,
  isChatTabChannel,
  parseChatTabs,
  serializeChatTabs,
  WHISPER_TAB,
  WHISPER_TAB_LABEL_KEY,
} from './chat_channels';
import {
  ignoreKey,
  type PlayerSocialFlags,
  parseIgnoreList,
  resolvePlayerSocialFlags,
  serializeIgnoreList,
} from './chat_ignore_core';
import { appendChatLineParts, CHAT_MESSAGE_TOKEN, CHAT_NAME_TOKEN, chatAiTagEl } from './chat_line';
import { type ChatClock, clampChatClock, formatChatTimestamp } from './chat_timestamp';
import { type ChatBoxGeometry, clampChatBox, parseChatBox, serializeChatBox } from './chat_window';
import type { ClaudiumRail, ClaudiumSnapshot } from './claudium_window';
import { ClaudiumWindow } from './claudium_window';
import { formatClockTime } from './clock';
import { CombatAnnouncer } from './combat_announcer';
import {
  auraApplyCue,
  castCueForAbility,
  impactCueForDamage,
  mobVoiceCue,
  playerSwingCueForDamage,
  shouldPlayCombatImpactForTarget,
  shouldPlayCritSfxForTarget,
  shouldPlayMobVoiceSfxForEntity,
  spellFxCue,
} from './combat_sfx';
import { type CardinalId, compassView } from './compass';
import { CONSUMABLE_BAR_SLOTS, consumableBarItems } from './consumable_bar_view';
import { formatMinimapCoords } from './coords';
import { corpseHarvestView } from './corpse_harvest_view';
import { renderCorpseHarvestPicker } from './corpse_harvest_window';
import { buildCraftingView } from './crafting_view';
import { renderCraftingWindow } from './crafting_window';
import { DailyRewardsWindow } from './daily_rewards_window';
import {
  deedBroadcastLine,
  deedName,
  deedTitleText,
  type TitledNameDecoration,
  titledDisplayName,
  titledNameDecoration,
} from './deed_i18n';
import { DeedTrackerPainter } from './deed_tracker_painter';
import {
  buildDeedTrackerViewInto,
  buildDeedUnlockPlan,
  type DeedDisplayCategory,
  makeDeedTrackerView,
} from './deeds_view';
import { DeedsWindow } from './deeds_window';
import { DelveMapPainter } from './delve_map_painter';
import { devTierBadgeDataUrl, devTierByIndex, devTierDisplayName } from './dev_tier';
import { markDialogRoot } from './dialog_root';
import { discordRoleTagLabel } from './discord_role_tag';
import { discordStatusBadgeDataUrl, discordStatusDisplayName } from './discord_tier';
import { dropdownKeyNav } from './dropdown_nav';
import { emoteIconUrl } from './emote_icons';
import {
  classDisplayName,
  dungeonDisplayName,
  itemDisplayName,
  tEntity,
  zoneDisplayName,
  zonePoiLabel,
} from './entity_i18n';
import { ERROR_LOG_COLOR, shouldMirrorErrorToast } from './error_toast_log';
import { esc } from './esc';
import { fctSpawnShape } from './fct_event';
import { FctPainter } from './fct_painter';
import { FocusManager, type FocusTrapHandle } from './focus_manager';
import {
  PLAYER_FRAME_POS_KEY,
  resetFramePositionsOnce,
  TARGET_FRAME_POS_KEY,
} from './frame_pos_reset';
import { gossipMenuIsEmpty } from './gossip_menu';
import {
  type AimPoint,
  abilityAoeRadius,
  cancelGroundAim,
  clampAimToRange,
  commitGroundAim,
  createGroundAimState,
  enterGroundAim,
  type GroundAimState,
} from './ground_aim';
import { buildHeroicVendorView } from './heroic_vendor_view';
import { renderHeroicVendorWindow } from './heroic_vendor_window';
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
  resolveMobileHotbarDrop,
  shouldSeedFormBar,
  swapHotbarSlots,
  syncHotbarActions,
} from './hotbar';
import {
  formatMoney as formatLocalizedMoney,
  formatNumber,
  getLanguage,
  moneyParts,
  type SupportedLanguage,
  type TranslationKey,
  t,
  tOptional,
  tPlural,
} from './i18n';
import { iconDataUrl, QUALITY_COLOR, raidMarkerDataUrl } from './icons';
import { itemArmorTypeLabelKey } from './item_armor_type';
import { itemStatDeltas } from './item_compare';
import { itemSetMemberCounts, itemSetTooltipModel } from './item_set_tooltip_view';
import { LeaderboardWindow } from './leaderboard_window';
import { ReannounceMarker } from './live_region_reannounce';
import { PICK_ACTION_HOTKEYS } from './lockpick_panel';
import { LockpickWindow } from './lockpick_window';
import { reconcileLootRolls as computeLootRollReconcile } from './loot_roll_reconcile';
import {
  computeLootRollStatusRows,
  type LootRollStatusRow,
  lootRollStatusFingerprint,
} from './loot_roll_status_view';
import { lootSettingsView } from './loot_settings_view';
import { renderLootSettingsWindow } from './loot_settings_window';
import { lowHealthVignette } from './low_health';
import { lowResourceView } from './low_resource';
import { mailIndicatorView } from './mailbox_view';
import { MailboxWindow } from './mailbox_window';
import { type MapRegion, mapCanvasHeight, paintTerrainRows } from './map_terrain';
import { MapWindowPainter } from './map_window_painter';
import {
  MAP_MAX_ZOOM,
  type MapNpcMarker,
  type MapQuestAreaMarker,
  mapWindowMode,
  npcMarkerAt,
  questAreaObjectivesAt,
} from './map_window_view';
import { MarketWindow } from './market_window';
import { Meters } from './meters';
import { minimapMode } from './minimap_markers';
import { MINIMAP_SIZE, MinimapPainter } from './minimap_painter';
import {
  clampMinimapZoom,
  isMaxMinimapZoom,
  isMinMinimapZoom,
  MINIMAP_ZOOM_DEFAULT,
  minimapZoomValue,
  nextMinimapZoom,
} from './minimap_zoom';
import { type MobTooltipI18n, type MobTooltipModel, mobTooltipHtml } from './mob_tooltip_view';
import {
  clampMobilePage,
  mobilePageCount,
  nextMobilePage,
  sourceSlotForMobileButton,
} from './mobile_action_page_view';
import { MobileActionRingPainter } from './mobile_action_ring_painter';
import { MovableFrame } from './movable_frame';
import { OptionsWindow } from './options_window';
import { makeWriterFacet, type PainterHostPresentation } from './painter_host';
import { loadPartyCollapsed, savePartyCollapsed } from './party_collapse';
import type { PartyRowAuraDeps } from './party_frame_row';
import { partyFrameSignature, selectPartyFrameMembers } from './party_frames';
import { PartyFramesPainter } from './party_frames_painter';
import type { PerfOverlayHooks } from './perf_overlay_settings';
import { PET_ACTION_ICONS } from './pet_action_icons';
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
import {
  chatPlayerContextActions,
  type PlayerContextAction,
  type PlayerContextActionId,
  streamerActionPlatform,
  streamerMenuActions,
} from './player_context_menu';
import { hydratePortraits, portraitChipHtml } from './portrait_chip';
import { maskProfanity } from './profanity';
import { encodeItemLink, encodeQuestLink, parseChatSegments } from './quest_link';
import { QuestProgressBanner } from './quest_progress_banner';
import { type QuestTrackerView, questTrackerView, type TrackedQuest } from './quest_tracker';
import { QuestLogWindow } from './questlog_window';
import { lockoutParts, lockoutShape } from './raid_lockout';
import { type RaidLockoutI18n, raidLockoutPanelHtml } from './raid_lockout_view';
import { restView } from './rest_indicator';
import { RiteWindow } from './rite_window';
import { localizeServerText } from './server_i18n';
import { localizeSimAuraName, localizeSimText } from './sim_i18n';
import { SocialWindow } from './social_window';
import { SpellbookWindow } from './spellbook_window';
import {
  type BuffStatSource,
  buildStatTooltip,
  type GearStatSource,
  type StatId,
  type StatTooltipModel,
  weaponDps,
} from './stat_tooltip';
import {
  type StatTooltipI18n,
  statCellHtml,
  statNameKey,
  statTooltipHtml,
} from './stat_tooltip_view';
import { nearestSubzone } from './subzone';
import { swingTimerState } from './swing_timer';
import { SwingTimerPainter } from './swing_timer_painter';
import { localizeTalentTitle, roleLabel, tTalent } from './talent_i18n';
import { TalentsWindow } from './talents_window';
import type { PresetId, ThemeKnob, ThemeState } from './theme';
import { TOOLTIP_PEEK_MS, TouchPeekGuard } from './touch_peek';
import { bindTouchDoubleTap, bindTouchTap, CLICK_SUPPRESS_MS, TAP_SLOP_PX } from './touch_tap';
import { buildTownFocusView, stepTownFocus } from './town_focus_view';
import { renderTownFocusWindow } from './town_focus_window';
import { TutorialOverlay } from './tutorial';
import { svgIcon } from './ui_icons';
import { getUiScale } from './ui_scale';
import { type UnitFrameDescriptor, unitFrameView } from './unit_frame';
import { UnitFramePainter } from './unit_frame_painter';
import { crestIdForEntity } from './unit_portrait';
import { UnitPortraitPainter } from './unit_portrait_painter';
import { ValeCupBetting } from './vale_cup_betting';
import { buildVcupBettingView } from './vale_cup_betting_view';
import { ValeCupBriefing } from './vale_cup_briefing';
import { buildVcupBriefingView } from './vale_cup_briefing_view';
import { ValeCupCharge } from './vale_cup_charge';
import { buildVcupChargeView } from './vale_cup_charge_view';
import { ValeCupHud } from './vale_cup_hud';
import { buildVcupHudView } from './vale_cup_hud_view';
import { ValeCupIndicator } from './vale_cup_indicator';
import { buildVcupIndicatorView } from './vale_cup_indicator_view';
import { ValeCupWindow, vcupNationName } from './vale_cup_window';
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
import { type WeaponProcEffectDesc, weaponProcLines } from './weapon_proc_view';
import {
  installWindowDrag,
  isWindowDragPreviewMutation,
  type WindowDragController,
} from './window_drag';
import { makeWindowFocus } from './window_focus';
import { installWindowResize, markResizableWindow } from './window_resize';
import { stackedWindowsVisible } from './window_stack_state_core';
import { formatXp, xpBarView } from './xp_bar';
import { XpBarPainter } from './xp_bar_painter';
import { YumiMatchPainter } from './yumi_match_painter';

let lpAdvancedLast = -1;

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
  // Account deed-broadcast opt-out seam (accounts.deed_broadcasts): whether a
  // marquee deed unlock fans out to guildmates and followers. main.ts wires the
  // REST read/write pair ONLINE ONLY; the options row renders only when the
  // seam is present (offline characters have no account, so no row).
  deedBroadcasts?: {
    get(): Promise<boolean>;
    set(enabled: boolean): Promise<boolean>;
  };
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
  // Detected brand of the connected pad, so the panel labels each button with the
  // glyph printed on that controller ('generic' combined labels when none/unknown).
  kind(): GamepadKind;
}

export interface ReportHooks {
  submit(targetPid: number, reason: string, details: string): Promise<void>;
  submitByName?(targetName: string, reason: string, details: string): Promise<void>;
}

/**
 * Online-only glue that backs the Claudium store window. main.ts wires this from
 * the client economy SDK (which hits the game server's /api/claudium/* routes).
 * snapshot() reads the current service state; buy()/spend() begin the client-signed
 * purchase / cosmetic-redeem flows. All values originate in the economy service.
 */
export interface ClaudiumHooks {
  balance(): Promise<number | null>;
  storeSnapshot(): Promise<{
    available: boolean;
    balance: number | null;
    storeItems: readonly ClaudiumStoreItem[];
  }>;
  snapshot(): Promise<ClaudiumSnapshot>;
  buy(rail: ClaudiumRail, sku: string): Promise<void>;
  spend(
    itemId: string,
    kind: 'cosmetic' | 'skin' | 'item',
    expectedCostClaudium: number,
  ): Promise<{
    granted: boolean;
    balance: number | null;
    costClaudium: number | null;
    reason: string | null;
  }>;
}

export interface HudFeatures {
  dailyRewardsEnabled: boolean;
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
// The player frame's stable portrait-identity key. The player portrait is drawn at
// character setup (drawPlayerFramePortrait), not by the unit_frame painter, so the
// painter's repaint gate never fires for it; the constant just pins the key so the
// gate stays a no-op (target/party pass a per-unit key).
const PLAYER_PORTRAIT_KEY = 'player';
// Vale Cup hold-to-charge shoot: full power after this long held, and the charge
// a NON-held tap (touch / gamepad / a mouse click on the slot) fires at.
const SHOOT_CHARGE_MS = 850;
const SHOOT_TAP_CHARGE = 0.6;
const MOBILE_CONTEXT_LONG_PRESS_MS = 650;
// Vale Cup walk-up "theatre": the anchored kickoff/goal/save/golden/end/countdown
// banners + crowd fx. The real Sowfield match's theatre is gated to the stadium
// footprint (isAtSowfield, the same predicate that arms the stadium music), so no
// alert leaves the football ground; a private practice pitch (a far, isolated
// instance) shows its theatre only to someone within VCUP_THEATRE_RADIUS of that
// pitch. Personal events (vcupFound/Result/BetSettled) are NOT here and always
// reach their owner.
const VCUP_WALKUP_EVENTS = new Set([
  'vcupCountdown',
  'vcupKickoff',
  'vcupGoal',
  'vcupSave',
  'vcupGolden',
  'vcupEnd',
]);
// Stadium-scale: covers the pitch + stands + approach, but nowhere near another
// match's pitch (the real Sowfield and practice instances are >600yd apart).
const VCUP_THEATRE_RADIUS = 200;
// The target frame's boss glyph (a skull replaces the numeric level chip for a
// boss-rank target) and the number of combo pips, named so the per-frame target
// paint carries no bare literal at the call site.
const BOSS_SKULL_GLYPH = '☠';
const COMBO_PIP_COUNT = 5;
// The mob-hover tooltip's fixed desktop bottom-right slot (the WoW default
// GameTooltip corner), in author-space px: the right margin clears the sidebar
// icon rail, the bottom margin the community-links row, both fixed right-edge
// chrome. Touch uses the slot immediately left of the minimap instead so it does
// not cover the bottom action controls.
const MOB_TOOLTIP_MARGIN_RIGHT = 56;
const MOB_TOOLTIP_MARGIN_BOTTOM = 60;
const MOB_TOOLTIP_MOBILE_MINIMAP_GAP = 8;
const MOB_TOOLTIP_MOBILE_EDGE_GAP = 8;
// The descriptor for a hidden target frame (no target, or a targeted world object).
// unitFrameView reads only `present` when hiding, so the rest are no-op defaults; a
// shared const avoids allocating a fresh descriptor for every hidden frame.
const ABSENT_TARGET_DESCRIPTOR: UnitFrameDescriptor = {
  present: false,
  hpFrac: 0,
  hpText: '',
  resourceKind: 'none',
  resFrac: 0,
  resText: '',
  levelText: null,
  name: '',
  portraitKey: '',
  absorb: null,
  dead: false,
  outOfRange: false,
};
const trackMetaPixel = (
  eventName: string,
  data?: Record<string, unknown>,
  options?: Record<string, unknown>,
): void => {
  const fbq = (window as Window & { fbq?: (...args: unknown[]) => void }).fbq;
  if (typeof fbq !== 'function') return;
  if (options) fbq('trackCustom', eventName, data ?? {}, options);
  else fbq('trackCustom', eventName, data ?? {});
};
// The HUD's i18n + number-formatting surface, handed to the pure stat-tooltip
// view so it can render localized breakdowns without importing the i18n runtime.
// Ghost-mode display thresholds, mirroring src/sim/spirit.ts (CORPSE_REZ_RANGE and
// SPIRIT_HEALER_RANGE). The server re-validates both ranges; these only decide whether
// the death-overlay resurrect buttons are shown, so keep them in sync.
const GHOST_CORPSE_REZ_RANGE = 35;
const GHOST_HEALER_RANGE = 8;

const STAT_VIEW_DEPS: StatTooltipI18n = {
  t: (key, params) => t(key as TranslationKey, params),
  fmt: (value, opts) => formatNumber(value, opts),
};
// Same i18n + number-formatting surface, handed to the pure mob-hover tooltip view.
const MOB_TOOLTIP_VIEW_DEPS: MobTooltipI18n = {
  t: (key, params) => t(key as TranslationKey, params),
  fmt: (value, opts) => formatNumber(value, opts),
};
const castDisplayName = (id: string): string => {
  if (id === FISHING_CAST_ID) return t('abilityUi.cast.fishing');
  if (id === 'demon_heal') return t('abilityUi.cast.demonHeal');
  if (id === 'thunzharr_stormcall') return t('abilityUi.cast.thunzharrStormcall');
  const ability = ABILITIES[id];
  return ability ? abilityDisplayName(ability) : id;
};

const RESOURCE_LABEL_KEYS: Record<ResourceType, TranslationKey> = {
  mana: 'abilityUi.resources.mana',
  rage: 'abilityUi.resources.rage',
  energy: 'abilityUi.resources.energy',
};
// Ravenpost mailResult refusal codes to their toast lines. `sent`/`collected`
// are successes rendered as chat-log lines in handleEvents, but they map here
// too so every code resolves without a fallback.
const MAIL_RESULT_ERROR_KEYS: Record<MailResultCode, TranslationKey> = {
  sent: 'hudChrome.mailbox.result.sent',
  collected: 'hudChrome.mailbox.result.collected',
  tooFar: 'hudChrome.mailbox.result.tooFar',
  needRecipient: 'hudChrome.mailbox.result.needRecipient',
  noRecipient: 'hudChrome.mailbox.result.noRecipient',
  tooManyParcels: 'hudChrome.mailbox.result.tooManyParcels',
  noMailQuestItems: 'hudChrome.mailbox.result.noMailQuestItems',
  noMailSoulbound: 'hudChrome.itemSoulbound',
  notEnoughItems: 'hudChrome.mailbox.result.notEnoughItems',
  cantAffordPostage: 'hudChrome.mailbox.result.cantAffordPostage',
  recipientBoxFull: 'hudChrome.mailbox.result.recipientBoxFull',
  letterGone: 'hudChrome.mailbox.result.letterGone',
  takeParcelsFirst: 'hudChrome.mailbox.result.takeParcelsFirst',
};
// Guild calendar outcome lines (created/removed are chat-log successes).
const CALENDAR_RESULT_KEYS: Record<CalendarResultCode, TranslationKey> = {
  created: 'hudChrome.calendar.result.created',
  removed: 'hudChrome.calendar.result.removed',
  notInGuild: 'hudChrome.calendar.result.notInGuild',
  notOfficer: 'hudChrome.calendar.result.notOfficer',
  badInput: 'hudChrome.calendar.result.badInput',
  calendarFull: 'hudChrome.calendar.result.calendarFull',
  eventGone: 'hudChrome.calendar.result.eventGone',
};
const HONOR_REASON_KEYS: Record<HonorReason, TranslationKey> = {
  arena_win: 'hudChrome.warfare.reasons.arenaWin',
  fiesta_kill: 'hudChrome.warfare.reasons.fiestaKill',
  fiesta_complete: 'hudChrome.warfare.reasons.fiestaComplete',
  fiesta_win: 'hudChrome.warfare.reasons.fiestaWin',
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
const ITEM_SLOT_LABEL_KEYS: Record<ItemSlot, TranslationKey> = {
  mainhand: 'itemUi.slots.mainhand',
  helmet: 'itemUi.slots.helmet',
  neck: 'itemUi.slots.neck',
  shoulder: 'itemUi.slots.shoulder',
  chest: 'itemUi.slots.chest',
  waist: 'itemUi.slots.waist',
  legs: 'itemUi.slots.legs',
  gloves: 'itemUi.slots.gloves',
  feet: 'itemUi.slots.feet',
  // The three ring forms share one player-facing label ("Finger"): items
  // declare 'ring', the paperdoll cells are the concrete ring1/ring2 keys.
  ring: 'itemUi.slots.ring',
  ring1: 'itemUi.slots.ring',
  ring2: 'itemUi.slots.ring',
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
  bag: 'itemUi.kind.bag',
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
// The OFFLINE ignore store. Online, the ignore list is server-persisted and
// arrives on the `social` frame, so this set is not consulted at all (see the
// chat event filter): keeping a second, name-keyed local list live online is
// exactly how you get "I unignored them and still cannot see them".
const LOCAL_IGNORES_KEY = 'woc_ignored_chat_names';
// Classic-style chat tabs: the ordered channel tabs the player has opened, and the
// tab that was active last session. The built-in `all`/`combat` views are
// implicit and never stored.
const CHAT_TABS_KEY = 'woc_chat_tabs';
const CHAT_ACTIVE_TAB_KEY = 'woc_chat_active_tab';
// Persisted chat-window geometry (drag position + resize size). Desktop only —
// the mobile layout owns its own placement and ignores this.
const CHAT_GEOMETRY_KEY = 'woc_chat_geometry';
// Persisted MOBILE chat panel size: the panel's bottom inset in px, dragged via the
// bottom resize handle. CSS clamps it to a valid range for the live viewport, so a value
// saved in one orientation stays safe in another (never an off-screen / tiny panel).
const MOBILE_CHAT_BOTTOM_KEY = 'woc_mobile_chat_bottom';
// The persisted top-left keys for the movable unit frames live in
// frame_pos_reset.ts (imported above) so the one-time reset clears the same
// keys the MovableFrames read.
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
type HotbarForm = 'normal' | 'bear' | 'cat' | 'cat_stealth' | 'stealth' | 'sport';

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
// MAP_MAX_ZOOM (zoomMap clamp) and MAP_DETAIL_ZOOM live in map_window_view.ts now,
// alongside the overworld map geometry that uses them.

// --- spatial sound-effect mapping (clips generated by scripts/gen_sfx.mjs;
// engine in src/game/sfx.ts) ------------------------------------------------
// Combat/spell/creature SFX are trimmed this much under movement/ambience so the
// soundscape doesn't get fatiguing in a long fight. One knob for the whole layer.
const COMBAT_GAIN = 0.7;

/** Append an inline span child (className '' for a plain text slot) and return
 *  it; used to split a pre-existing single-text element into separately
 *  writable children (the target name line's title decoration). */
function appendChildSpan(parent: HTMLElement, className: string): HTMLElement {
  const span = document.createElement('span');
  if (className) span.className = className;
  parent.appendChild(span);
  return span;
}

function availableMobVoiceCue(
  templateId: string,
  action: 'aggro' | 'attack' | 'death',
): string | null {
  return mobVoiceCue(templateId, action, (key) => sfx.hasVariants(key));
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
  // Ability slots across both rows: 1..11 on the primary bar, 12..22 on the
  // secondary bar (slot 0 is the fixed Attack toggle on the primary bar). The
  // two rows share one hotbarActions array, so drag/drop, persistence, and the
  // keybind dispatch all work across both with no per-bar bookkeeping.
  private static readonly PRIMARY_BAR_ABILITY_SLOTS = 11;
  private static readonly BAR_ABILITY_SLOTS = 22;
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
  }[] = [];
  // The action bar's pure core + thin painter. Built in buildActionBar once
  // the slot buttons exist; tick(world) -> ActionBarState, painted via the shared
  // elided writer facet. The descriptor parameterizes the single existing bar so a
  // second/third bar is another descriptor, not a code fork.
  private actionBarView!: ActionBarView;
  private actionBarPainter!: ActionBarPainter;
  // The mobile action ring: a SECOND createActionBarView instance over a 6-slot
  // descriptor (slot 0 attack, slots 1-5 resolve through
  // sourceSlotForMobileButton(mobileActionPage, i-1)). mobileActionPage is the
  // only mutable state; cycling it never rebuilds the descriptor (the closures
  // re-resolve), which is what keeps the view allocation-stable across page
  // flips. Both fields stay undefined on desktop-only sessions where the ring DOM
  // is absent (buildActionBar only builds them when #mobile-action-ring exists).
  private mobileActionPage = 0;
  private mobileActionRingView: ActionBarView | undefined;
  private mobileActionRingPainter: MobileActionRingPainter | undefined;
  // Consumables quick bar (touch): the auto-populated potion/elixir/food/drink
  // row behind the chevron chip next to the top-left trio. consumableBarIds is
  // the ONE reused array the pure core fills WHEN THE ROW OPENS and that stays
  // FROZEN while it is open: slots must not shift under the player's thumb the
  // frame a stack depletes (a depleted item stays in place, greyed at count 0,
  // exactly like a desktop bar item shortcut). Reopening refreshes the list.
  private consumableBarView: ActionBarView | undefined;
  private consumableBarPainter: ActionBarPainter | undefined;
  private consumableBarSlotBtns: HTMLButtonElement[] = [];
  private readonly consumableBarIds: string[] = [];
  private consumablesOpen = false;
  /** Ring button refs so castSlot's used-flash can hit the ring too (the
   *  desktop bar is display:none under body.mobile-touch). */
  private mobileRingAttackBtn: HTMLButtonElement | null = null;
  private mobileRingSlotBtns: HTMLButtonElement[] = [];
  // Acquire-nearest fallback for the ring's attack toggle when the player has
  // no live hostile target: wired by main.ts to the same nearest-attackable
  // pick the touch layer uses (the HUD cannot resolve attackability itself,
  // that helper lives behind the game-layer seam). Null until wired; the
  // attack handler then falls back to the plain castSlot(0) toggle.
  onMobileAttackNearest: (() => void) | null = null;
  private hotbarActions: HotbarAction[] = []; // index = barSlot-1
  private loadedSlotMapFromStorage = false;
  private knownAbilityIdsAtLastSlotSync: Set<string> | null = null;
  private activeHotbarForm: HotbarForm = 'normal';
  private groundAim: GroundAimState = createGroundAimState();
  private groundAimPoint: AimPoint | null = null;
  private groundAimClamped = false;
  // Vale Cup hold-to-charge shoot: the bar slot being held and when the hold
  // started; the power meter fills to chargeFrac() while held and the shot fires
  // at that fraction on release. The meter itself is the ValeCupCharge painter
  // (declared with the other Vale Cup painters, after writerFacet) driven off
  // the pure vale_cup_charge_view core; only the input timing state lives here.
  private shootChargeSlot: number | null = null;
  private shootChargeStartMs = 0;
  private dragAction: { action: Exclude<HotbarAction, null>; sourceIndex: number | null } | null =
    null;
  // Set while dragging an equipped piece out of the paperdoll onto the bags window.
  private dragUnequipSlot: EquipSlot | null = null;
  private mobileHotbarDrag: MobileHotbarDrag | null = null;
  private suppressNextActionClick = false;
  private optionsHooks: OptionsHooks | null = null;
  private reportHooks: ReportHooks | null = null;
  private bugReportHooks: BugReportHooks | null = null;
  // Only wired online (main.ts owns the Discord account/panel state); its presence
  // gates whether #mm-discord does anything on a build with Discord disabled.
  private discordHook: (() => void) | null = null;
  // Soft swear terms from the server (online only), masked in chat when the
  // player's "Filter Profanity" setting is on. Fed by main.ts from ClientWorld.
  private profanityWords: string[] = [];
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
  // Off-screen polite live region for the throttled combat summary. The 3D
  // world / game canvas is OUT of accessibility scope (not screen-readable), so this
  // announces only the combat-log text, never the game world.
  private combatLiveEl = $('#combat-live');
  private readonly combatAnnouncer = new CombatAnnouncer((summary) => {
    this.combatLiveEl.textContent = summary;
  });
  // Off-screen polite live region for the current target's name, announced once per target
  // CHANGE, never per frame. A separate node from #combat-live so it never
  // re-announces what the combat summary speaks. The announce writes textContent DIRECTLY
  // (NOT the per-frame elided setText, like the combat + chat announcer sinks): two distinct
  // mobs of the same TEMPLATE share a display name, and the elided writer skips an identical
  // write, so routing through it would swallow every same-named re-target and the region would
  // fall silent on a screen reader. The path is change-gated on the target id, so it is an
  // event write, not a per-frame write; the perf tour acquires no target, so the floor holds.
  private targetLiveEl = $('#target-live');
  // The last target id announced into #target-live, tracked SEPARATELY from the paint
  // cadence id (lastTargetFrameId) so the announce fires on the real id change, not the
  // throttled repaint; reset to null on no-target so re-acquiring the SAME target re-announces.
  private lastAnnouncedTargetId: number | null = null;
  // Forces a byte-different write when consecutive targets share a display name (a pack of
  // identically-named mobs) so the polite region re-reads on every re-target, mirroring the
  // combat-summary re-announce. The shared DOM-free deterministic marker.
  private readonly targetReannounce = new ReannounceMarker();
  // Dedicated tab-independent off-screen polite live region for chat:
  // #chatlog goes display:none on the combat tab (a display:none live region is silent), so
  // chat rides this always-present region instead, throttled by ChatAnnouncer so a chat
  // burst never floods the screen reader.
  private chatLiveEl = $('#chat-live');
  private readonly chatAnnouncer = new ChatAnnouncer((summary) => {
    this.chatLiveEl.textContent = summary;
  });
  // The ONE shared focus manager: trap (Tab/Shift+Tab cycle) + focus-first +
  // return-to-opener, unifying the former ad-hoc Hud focus helpers. See
  // ./focus_manager. Escape is NOT handled here: it stays with the existing unified
  // dispatcher (main.ts game input -> hud.closeAll()), so there is one Escape path.
  private readonly focusManager = new FocusManager();
  // Classic-style chat tabs. `chatTabs` are the player-added tabs (send-capable
  // channels plus the optional filter-only whisper collector; the built-in
  // `all`/`combat` views are implicit); `activeChatTab` is the one currently
  // shown, and drives both the log filter and the send channel.
  private chatTabs: ChatOpenTab[] = [];
  private activeChatTab: ChatTabId = 'all';
  // Bind the tab-strip wheel-to-horizontal-scroll listener exactly once (renderChatTabs
  // rebuilds the strip's children but the bar element itself persists).
  private chatTabsWheelBound = false;
  // The control that opened the shared #ctx-menu (the chat "+" button), so the
  // outside-click closer can defer to that opener's own toggle click. Cleared on
  // every close path (closeContextMenu + item activation).
  private ctxMenuOpener: HTMLElement | null = null;
  private errorEl = $('#error-msg');
  private bannerEl = $('#banner');
  // The WoW-style quest-progress flash (quest_progress_banner.ts): yellow
  // top-center lines fed by the questProgress event, aria-hidden decoration
  // (the chat log + live region carry the announced copy).
  private readonly questBanner = new QuestProgressBanner($('#quest-banner'));
  private subzoneEl = $('#subzone-banner');
  private tooltipEl = $('#tooltip');
  // Distinguishes a touch long-press "peek" (inspect, no action) from a tap.
  private peekGuard = new TouchPeekGuard();
  // The mob whose world-hover tooltip is currently shown (showMobHoverTooltip),
  // so main.ts's per-frame updateHoverCursor can call it every frame while the
  // same mob stays hovered without rebuilding the tooltip HTML each time.
  // A small composite key (id:level:hostile:playerLevel), not just the mob id, so
  // the hover tooltip repaints when a mid-hover change moves its model. See
  // showMobHoverTooltip.
  private lastMobTooltipId: string | null = null;
  private errorTimer: number | undefined;
  private lastMirroredErrorText: string | undefined;
  private bannerTimer: number | undefined;
  private pfLevelEl = $('#pf-level');
  private pfHpEl = $('#pf-hp');
  private pfHpTextEl = $('#pf-hp-text');
  private pfResEl = $('#pf-res');
  private pfResTextEl = $('#pf-res-text');
  private pfResourceEl = $('#pf-resource');
  private pfAbsorbEl = $('#pf-absorb');
  private buffBarEl = $('#buff-bar');
  private debuffBarEl = $('#debuff-bar');
  private targetFrameEl = $('#target-frame');
  private targetEliteTagEl = $('#tf-elite-tag');
  private targetNameEl = $('#tf-name');
  // The target name line splits into three inline children (pre-decoration,
  // name text, post-decoration) so the painter can write the Book of Deeds
  // title in its own muted-gold spans without setText clobbering them, while
  // the OUTER #tf-name keeps the nowrap ellipsis, the hostile/friendly color
  // write, and the frame's single-line height. Built here (not in the HTML)
  // so both game entries pick it up.
  private targetTitlePreEl = appendChildSpan(this.targetNameEl, 'uf-title');
  private targetNameTextEl = appendChildSpan(this.targetNameEl, '');
  private targetTitlePostEl = appendChildSpan(this.targetNameEl, 'uf-title');
  private targetLevelEl = $('#tf-level');
  private targetDiscordEl = $('#tf-discord');
  // Diff key for the target-frame Discord line, so its per-frame update only rebuilds
  // innerHTML (and re-attaches the avatar fallback) when the Discord content changes.
  private targetDiscordSig = '';
  private targetHpEl = $('#tf-hp');
  private targetHpTextEl = $('#tf-hp-text');
  private targetPortraitEl = $('#tf-portrait') as unknown as HTMLCanvasElement;
  // The target absorb-shield overlay node, resolved ONCE here instead of the old
  // per-frame updateAbsorb document query by hardcoded selector (per-frame
  // discipline). The unit_frame painter drives it through the elided
  // writers, exactly as the player frame drives its own absorb node.
  private targetAbsorbEl = $('#tf-absorb');
  // The target's resource bar (mana / rage / energy), the classic target-frame
  // power readout. The painter's type classes drive it; a target with no
  // resource (a plain beast) keeps every type class off and the rail stays as
  // an empty dark bar (classic WoW look: the frame never changes height).
  private targetResourceEl = $('#tf-resource');
  private targetResEl = $('#tf-res');
  private targetResTextEl = $('#tf-res-text');
  private targetDebuffsEl = $('#tf-debuffs');
  // The target whose portrait the family painter's repaint gate redraws this frame.
  // The gate fires synchronously inside the targetFramePainter.paint() call below,
  // so this holds the subject for that one call (the old inline block read `target`
  // from its enclosing scope; the gate now lives in the painter, so the redraw
  // closure reads it from here).
  private targetPortraitSubject: Entity | null = null;
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
  // XP + swing bar element refs cached once for their painters (the #xpbar /
  // .rested / #player-frame / #swingbar refs were re-queried via $()/querySelector
  // every frame, the leak this fixes).
  private xpbarEl = $('#xpbar');
  private xpRestedEl = $('#xpbar .rested');
  private playerFrameEl = $('#player-frame');
  // The party-frames container, resolved once (was re-queried every frame); the
  // keyed-pool party painter owns its children.
  private partyFramesEl = $('#party-frames');
  private swingbarEl = $('#swingbar');
  private swingFillEl = this.swingbarEl.querySelector('.fill') as HTMLElement;
  private swingLabelEl = this.swingbarEl.querySelector('.label') as HTMLElement;
  private deathOverlayEl = $('#death-overlay');
  private releaseSpiritBtnEl = $('#release-btn');
  private ghostPromptEl = $('#ghost-prompt');
  private resurrectCorpseBtnEl = $('#resurrect-corpse-btn');
  private resurrectHealerBtnEl = $('#resurrect-healer-btn');
  // Cached once (was re-queried every frame): the near-death screen-edge overlay.
  private lowHealthVignetteEl = document.getElementById('low-health-vignette');
  private hotWriteCache = new Map<HTMLElement, string>();
  // Multi-slot caches for the per-frame writers: one element holds many
  // custom properties / toggled classes, so these key per (element, prop) and
  // (element, class) instead of the single slot per element hotWriteCache uses.
  private hotStylePropCache = new Map<HTMLElement, Map<string, string>>();
  private hotClassCache = new Map<HTMLElement, Map<string, string>>();
  // Multi-slot cache for the action-bar setAttr writer: the action-bar
  // aria-label is a per-frame attribute write, keyed per (element, attr name).
  private hotAttrCache = new Map<HTMLElement, Map<string, string>>();
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
  // compassView is a pure function of the player facing, so an unchanged facing
  // skips the whole rose repositioning pass (and this scratch Set avoids a
  // per-call allocation on the frames that do reposition)
  private lastCompassFacing = Number.NaN;
  private compassVisibleScratch = new Set<string>();
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
  private openLootMobId: number | null = null;
  private openLootChestId: number | null = null;
  private activeLootRolls = new Map<
    number,
    { event: Extract<SimEvent, { type: 'lootRoll' }>; receivedAt: number; durationMs: number }
  >();
  // rolls the player has answered or let expire locally, mapped to the wall-clock
  // time of that dismissal. The reconcile keeps them out of the DOM while the
  // authoritative mirror still lists them open, re-showing only if one stays open
  // past a short grace (a genuinely dropped submit) so a normal answer does not
  // flash back; the entry is forgotten once the server drops the roll.
  private dismissedLootRolls = new Map<number, number>();
  // shown rolls already observed in the open-roll mirror at least once, so their
  // later absence from the mirror means the server resolved them (retire), not
  // that the mirror simply has not caught up to a just-shown event yet.
  private confirmedLootRolls = new Set<number>();
  // Group vote strip (the XLoot-style monitor): the authoritative per-candidate
  // choices on every open roll, polled from IWorld.lootRollGroupStatus and
  // re-rendered only when the fingerprint changes. A status row with no local
  // prompt renders as a watch-only row, which is what keeps the roll frame up
  // after the player answers until the server resolves the roll.
  private lootRollStatusRows: LootRollStatusRow[] = [];
  private lootRollStatusFp = '';
  // rollId -> receivedAt for the watch-only rows' countdown bar (a prompt row
  // keeps its own receivedAt; a watch row starts timing at first sight).
  private lootRollWatchTimers = new Map<number, number>();
  // Master-loot assignment prompts, shown only to the master looter alongside
  // the loot-roll rail. Same lifetime/expiry as a need/greed roll.
  private activeMasterRolls = new Map<
    number,
    { event: Extract<SimEvent, { type: 'masterLoot' }>; receivedAt: number; durationMs: number }
  >();
  private openVendorNpcId: number | null = null;
  private openHeroicVendorNpcId: number | null = null;
  private openDelveBoardNpcId: number | null = null;
  private lastDelveTrackerSig = '';
  private selectedDelveTier: 'normal' | 'heroic' = 'normal';
  private delveBoardTab: 'delve' | 'shop' = 'delve';
  private delveTrap: FocusTrapHandle | null = null;
  private lockpickTrap: FocusTrapHandle | null = null;
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
  // Drowned Reliquary Rite difficulty popup. Opened on the delveRiteChoosePrompt
  // cue (approaching the risen reliquary), closed once playback starts.
  private riteTrap: FocusTrapHandle | null = null;
  private readonly riteWindow = new RiteWindow({
    onChoose: (intensity) => this.submitRiteChoose(intensity),
    onClose: () => this.closeRitePanel(),
  });
  private openGossipNpcId: number | null = null;
  private openQuestDetailId: string | null = null;
  // Ordered so two base/heroic items with the same display name retain their
  // distinct tokens when the readable draft is converted for sending.
  private pendingChatLinks: readonly { display: string; token: string }[] = [];
  private questDialogTrap: FocusTrapHandle | null = null;
  private questDialogOpenedAtMs = 0;
  // The NPC whose voice line is currently sounding, so update() can fade it by
  // distance as the player walks away. Outlives the dialog window (which closes at
  // 8) and is cleared once the clip ends. null when no dialogue voice is playing.
  private voiceNpcId: number | null = null;
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
  // Loot Settings window (opened on demand from the right-click menu): whether it is
  // open, and a separate LOW-frequency signature (loot settings + leadership +
  // membership, no hp/res) so it repaints from authoritative state without churning
  // on every combat tick.
  private lootSettingsOpen = false;
  private lastLootSettingsSig = '';
  private lootSettingsTrap: FocusTrapHandle | null = null;
  // Loot Settings window docks below the party frames; these track when to re-measure
  // (party row count / raid grouping changed) and the last auto-placed position so a
  // manual drag is respected (we stop auto-docking once the player moves it).
  private lastLootGeomSig = '';
  private lootSettingsAutoLeft = '';
  private lootSettingsAutoTop = '';
  // Tracks whether the local player was the party leader last frame, so we can
  // auto-open the Loot Settings panel the moment they BECOME leader: on forming a
  // group (creator is leader), on being promoted, or on succeeding a leader who left.
  private wasLeaderOfParty = false;
  private lastArenaStatusSig = '';
  private arenaMatchSeen = false; // closes the queue panel once a bout starts
  // 2v2 Fiesta UI state (all transient)
  private fiestaScoreSeen = { a: -1, b: -1 }; // last rendered tally (for score-ping)
  private fiestaOfferKey = ''; // identity of the currently-shown augment offer
  private fiestaActiveSeen = false; // were we in a fiesta bout last frame
  private fiestaWasDown = false; // were we benched last frame (for the revive cue)
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
  // The quest-objective areas of the last overworld map paint (canvas-pixel
  // space), kept for the hover tooltip's hit-test. Empty in delve mode.
  private mapQuestAreas: MapQuestAreaMarker[] = [];
  // The quest-giver glyphs of the last overworld map paint, for the hover
  // tooltip's hit-test (quest names + level requirements). Empty in delve mode.
  private mapNpcMarkers: MapNpcMarker[] = [];
  private windowDragController: WindowDragController | null = null;
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
  // Mobile chat resize gesture (drag the bottom handle to set the panel's bottom inset).
  private mobileChatResize: { pointerId: number; startY: number; startBottom: number } | null =
    null;
  // Movable unit frames (the shared MovableFrame controller, movable_frame.ts):
  // the target frame and the player frame each get a corner move/lock button, a
  // pointer drag, and a persisted top-left. Constructed once in initFrameMovers.
  private targetFrameMover: MovableFrame | null = null;
  private playerFrameMover: MovableFrame | null = null;
  private windowObserver: MutationObserver | null = null;
  private windowZ = 50;
  private localIgnoredNames = new Set<string>();
  private lastHudFastAt = 0;
  private lastHudMediumAt = 0;
  private lastHudSlowAt = 0;
  private dailyRewardsButtonEl: HTMLButtonElement | null = null;
  // Mobile More-tray entry mirroring the desktop chest button's hidden/spin-ready
  // state (folded off the top-right rail so it never overlaps the buff/debuff bars).
  private mobileDailyRewardsButtonEl: HTMLButtonElement | null = null;
  private dailyRewardsLauncherSeq = 0;
  private lastDailyRewardsLauncherRefreshAt = 0;
  // Per-element tier cadence stamps (graphics-tier knobs). Each gates a non-self /
  // canvas redraw to a slower interval on the LOW static preset; on every other tier the
  // interval is 0 (cadenceDue is always true), so these are no-ops and the path is the
  // unchanged per-frame path. The SELF/player frame has no stamp (it always paints), and
  // party frames are deliberately not stamped (party-member HP is a healer's actionable
  // signal, so it stays on the mediumHud band for every tier: see ui_tier_knobs).
  private lastMinimapDrawAt = 0;
  private lastBuffBarPaintAt = 0;
  private lastTargetDebuffsPaintAt = 0;
  private lastTargetFramePaintAt = 0;
  private lastTargetFrameId: number | null = null;
  // Title resolve elision for the target frame (the lastIcon pattern): the
  // pattern-key composition re-runs only when the (language, title id)
  // signature changes; every steady frame reuses the cached decoration and
  // the elided setText writes nothing.
  private lastTargetTitleSig: string | null = null;
  private targetTitleDecoration: TitledNameDecoration = { pre: '', post: '' };
  private charPreview: CharacterPreview | null = null;
  private charPreviewCanvas: HTMLCanvasElement | null = null;
  // Cosmetic skin-select event overlay (opened by the skinEvent cue). The shared
  // CharacterPreview above is borrowed for the rotatable 3D preview.
  private skinEventEl: HTMLElement | null = null;
  private skinEventTrap: FocusTrapHandle | null = null;
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
  private cardModalTrap: FocusTrapHandle | null = null;
  // Shared by the confirm + input modals (one #confirm-dialog id; they never coexist).
  private confirmTrap: FocusTrapHandle | null = null;
  // Set while the player-card modal is open: re-composites the card with the
  // current pose so a $WOC balance change (the bag-footer path can't reach the
  // card's canvas) is reflected. Cleared when the modal closes.
  private recomposeOpenCard: (() => void) | null = null;
  private meters: Meters;
  private tutorial = new TutorialOverlay();
  private lastPetBarSig = '';
  // Value-diffed body-class flag: true while a live pet bar is shown. The mobile
  // top-band layout reads body.mobile-pet-active to yield the top-centre line to the
  // pet bar (the sideways consumables row and the Vale Cup indicator drop a band).
  private lastPetPresent = false;
  // Ravenpost envelope indicator (slow-band, value-diffed; see updateMailIndicator).
  private mailIndicatorEl: HTMLElement | null = null;
  private lastMailUnread = -1;
  private pendingPetFeed = false;
  private petModeMenuOpen = false;
  // Talents: the local staged allocation the user edits before committing it on save
  // or loadout switch. Owned here; TalentsWindow reads/replaces it via its deps.
  private talentStage: TalentAllocation | null = null;

  constructor(
    private sim: IWorld,
    private renderer: Renderer,
    private keybinds: Keybinds,
    private readonly features: HudFeatures = { dailyRewardsEnabled: true },
  ) {
    this.localIgnoredNames = this.loadLocalIgnoredNames();
    this.meters = new Meters(sim);
    this.initChatTabs();
    this.initChatBoxGeometry();
    this.initFrameMovers();
    this.initWindowManagement();
    this.emoteWheelSlots = this.loadEmoteWheelSlots();
    this.loadSlotMap();
    this.buildActionBar();
    this.initMailIndicator();
    this.refreshKeybindLabels();
    this.buildXpTicks();
    document.addEventListener('woc:languagechange', () => this.refreshLocalizedDynamicUi());
    // re-render the bag footer (and re-composite an open player card) when the
    // connected wallet's $WOC balance changes
    onWalletUiChange(() => {
      if ($('#bags').style.display !== 'none') this.renderBags();
      this.recomposeOpenCard?.();
    });
    $('#pf-name').textContent = sim.player.name;
    this.drawPlayerFramePortrait();
    // Character GLBs preload after the HUD mounts; once the real 3D portraits are
    // ready, upgrade the player frame and force the target frame to redraw.
    onPortraitsReady(() => {
      this.drawPlayerFramePortrait();
      this.targetFramePainter.invalidatePortrait();
    });
    const mm = $('#minimap') as unknown as HTMLCanvasElement;
    this.minimapCtx = require2dContext(mm);
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
    this.resurrectCorpseBtnEl.addEventListener('click', () => this.sim.resurrectAtCorpse());
    this.resurrectHealerBtnEl.addEventListener('click', () => this.sim.resurrectAtSpiritHealer());
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
    const moreClose = document.getElementById('mobile-more-close');
    if (moreClose) {
      // bindTouchTap so the close X works from a second finger too (a click
      // never fires for a non-primary touch).
      bindTouchTap(moreClose, () => {
        document.body.classList.remove('mobile-more-open');
        document.getElementById('mobile-controls')?.classList.remove('expanded');
        document.getElementById('mobile-more')?.classList.remove('active');
      });
    }
    // Dismiss the shared #ctx-menu (right-click menus and the chat "+" channel
    // picker) on any pointerdown outside it. A pointerdown inside the menu is left
    // to the item's own click; a pointerdown on the opener is left to that opener's
    // toggle (so a second click on + closes rather than reopens). Escape still
    // closes it through the unified closeAll dispatcher.
    document.addEventListener('pointerdown', (ev) => {
      const menu = $('#ctx-menu');
      if (menu.style.display !== 'block') return;
      const target = ev.target as Node | null;
      if (!target) return;
      if (menu.contains(target)) return;
      if (this.ctxMenuOpener?.contains(target)) return;
      this.closeContextMenu();
    });
    // classic-style minimap clock: real local time under the minimap; click it to
    // flip between 12-hour (AM/PM) and 24-hour display. Real-time clocks are a
    // UI-only concern, so `new Date()` here is fine (the sim-only time ban
    // doesn't apply — cf. meters.ts using performance.now()).
    this.clockEl = $('#minimap-clock');
    // raid-lockout badge on the minimap rim: a lock icon whose hover/tap panel
    // lists the player's raid lockouts (the unlock countdown). Always visible;
    // it lights up (.locked) while any raid is on cooldown. attachTooltip handles
    // desktop hover, mobile long-press, and keyboard focus; mobile tap below opens
    // the same panel immediately because the badge has no primary action.
    this.raidLockoutEl = document.getElementById('raid-lockout');
    if (this.raidLockoutEl) {
      this.raidLockoutEl.innerHTML = svgIcon('lock');
      this.raidLockoutEl.hidden = false;
      this.attachTooltip(this.raidLockoutEl, () => this.raidLockoutPanelView());
      this.raidLockoutEl.addEventListener('click', (ev) => {
        if (!document.body.classList.contains('mobile-touch')) return;
        ev.preventDefault();
        ev.stopPropagation();
        this.showRaidLockoutTooltip();
      });
    }
    const dailyRewardsButton = document.getElementById(
      'daily-rewards-button',
    ) as HTMLButtonElement | null;
    const mobileDailyRewardsButton = document.getElementById(
      'mobile-daily-rewards',
    ) as HTMLButtonElement | null;
    if (!this.dailyRewardsEnabled()) {
      dailyRewardsButton?.setAttribute('hidden', '');
      mobileDailyRewardsButton?.setAttribute('hidden', '');
      $('#daily-rewards-window').style.display = 'none';
    } else if (dailyRewardsButton) {
      this.dailyRewardsButtonEl = dailyRewardsButton;
      this.mobileDailyRewardsButtonEl = mobileDailyRewardsButton;
      dailyRewardsButton.innerHTML =
        '<img class="daily-rewards-icon" src="/ui/daily-rewards/treasure_chest.webp" alt="" draggable="false" decoding="async">';
      this.syncDailyRewardsSurfaceLabels();
      dailyRewardsButton.classList.remove('spin-ready');
      this.applyDailyRewardsChestButtonVisibility();
      dailyRewardsButton.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.button !== 0) return;
        this.toggleDailyRewards();
      });
      dailyRewardsButton.addEventListener('pointerup', (event) => event.stopPropagation());
      dailyRewardsButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      this.refreshDailyRewardsLauncher(true);
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
      this.openTargetFrameMenuAt((ev as MouseEvent).clientX, (ev as MouseEvent).clientY);
    });
    // Touch has no right-click, so a double-tap on the target frame opens the same
    // unit menu (slop-guarded, so dragging the movable frame never triggers it).
    // Mobile-gated: bindTouchDoubleTap already ignores mouse pointers, and the
    // desktop path above owns the contextmenu case.
    bindTouchDoubleTap($('#target-frame'), (ev) => {
      if (!this.isMobileLayout()) return;
      const pe = ev as PointerEvent;
      this.openTargetFrameMenuAt(pe.clientX, pe.clientY);
    });
    this.bindMobileFrameLongPress($('#target-frame'), (x, y) => this.openTargetFrameMenuAt(x, y));
    $('#player-frame').addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      this.openSelfContextMenu((ev as MouseEvent).clientX, (ev as MouseEvent).clientY);
    });
    this.bindMobileFrameLongPress($('#player-frame'), (x, y) => this.openSelfContextMenu(x, y), {
      ignoreSelector: 'button, #buff-bar, #debuff-bar',
    });
    $('#mm-char').addEventListener('click', () => this.toggleChar());
    $('#mm-spell').addEventListener('click', () => this.toggleSpellbook());
    $('#mm-talents')?.addEventListener('click', () => this.toggleTalents());
    $('#mm-town-focus')?.addEventListener('click', () => this.toggleTownFocus());
    $('#mm-quest').addEventListener('click', () => this.toggleQuestLog());
    $('#mm-deeds').addEventListener('click', () => this.toggleDeeds());
    // Collapse/expand the on-screen quest tracker by clicking its header. The
    // overlay is click-through (pointer-events:none) except the header button, so
    // delegate on the stable container (the header is rebuilt on each render).
    $('#quest-tracker').addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.qt-header')) this.toggleQuestTrackerCollapsed();
      // A quest row jumps to that quest's detail in the quest log window.
      const row = (e.target as HTMLElement).closest<HTMLElement>('.qt-title');
      if (row?.dataset.quest) this.questlogWindow.openWithQuest(row.dataset.quest);
    });
    // Keyboard activation: handle Enter/Space here and stop the event before it
    // bubbles to the window-level game keybinds (Enter is bound to Open Chat,
    // Space is preventDefault'd for jump), which would otherwise hijack the
    // focused header button's native activation. The tracker is a non-modal
    // overlay, so canUseGameKeys() stays true and those binds fire while it has
    // focus; stopping propagation here keeps the toggle reachable by keyboard.
    $('#quest-tracker').addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      if (e.key !== 'Enter' && e.key !== ' ' && e.code !== 'Space') return;
      if (target.closest('.qt-header')) {
        e.preventDefault();
        e.stopPropagation();
        this.toggleQuestTrackerCollapsed();
        return;
      }
      // Keyboard activation for the quest rows (role=button), stopped before
      // the window-level game keybinds hijack Enter/Space (same as the header).
      const row = target.closest<HTMLElement>('.qt-title');
      if (row?.dataset.quest) {
        e.preventDefault();
        e.stopPropagation();
        this.questlogWindow.openWithQuest(row.dataset.quest);
      }
    });
    // Collapse/expand the deed tracker from its header (the quest tracker
    // delegation pattern: click plus the Enter/Space keydown arm below,
    // stopped before the window-level chat-open/jump binds hijack the
    // focused header button; see the quest-tracker guard above). On the
    // compact touch tier the rows are folded away (hud.mobile.css) and the
    // header is a count chip: activation opens the Book of Deeds instead of
    // toggling a collapse the player cannot see.
    $('#deed-tracker').addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('.dt-header')) return;
      const body = document.body.classList;
      if (body.contains('mobile-touch') && body.contains('hud-mobile-compact')) {
        this.openDeeds();
        return;
      }
      this.toggleDeedTrackerCollapsed();
    });
    $('#deed-tracker').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.code !== 'Space') return;
      if (!(e.target as HTMLElement).closest('.dt-header')) return;
      e.preventDefault();
      e.stopPropagation();
      const body = document.body.classList;
      if (body.contains('mobile-touch') && body.contains('hud-mobile-compact')) {
        this.openDeeds();
        return;
      }
      this.toggleDeedTrackerCollapsed();
    });
    // The delve board, lockpick panel, map window, and the bank + bags cluster are
    // non-modal overlays, so canUseGameKeys() stays true and the global jump (Space)
    // / chat (Enter) binds would otherwise hijack those keys on a focused panel
    // button (the map's Quests toggle, a bank grid cell, and each close button
    // included). Stop propagation (but NOT the default, so the button's native
    // activation still fires) when a panel button has focus, mirroring the
    // quest-tracker guard above.
    for (const panelId of [
      '#delve-board',
      '#lockpick-panel',
      '#delve-rite-panel',
      '#map-window',
      '#bank-window',
      '#bags',
      '#deeds-window',
    ]) {
      $(panelId).addEventListener('keydown', (e) => {
        if ((e.target as HTMLElement).tagName !== 'BUTTON') return;
        if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') e.stopPropagation();
      });
    }
    $('#mm-map').addEventListener('click', () => this.toggleMap());
    $('#map-close').addEventListener('click', () => {
      $('#map-window').style.display = 'none';
      this.hideTooltip(); // a touch marker tip can outlive the window otherwise
      this.syncAnyWindowOpenState();
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
    // The map reveals a marker's quest text as a tooltip: on desktop it follows
    // the mouse (hover); on touch there is no hover, so a TAP on a marker shows it
    // (a press that moves beyond the tolerance is a pan, not a tap). Priority: a
    // quest-giver glyph ('!'/'?', quest names + level requirements) sits ON TOP of
    // the blobs, so it wins; otherwise a quest-objective area shows its objectives
    // with live tracker progress. Both hit-tests run against the markers of the
    // last paint, scaled from CSS px to the canvas backing space the model projects
    // into.
    const TAP_MOVE_TOLERANCE_PX = 10;
    let mapAreaTipShown = false;
    let mapTapStart: { x: number; y: number } | null = null;
    const hideMapAreaTip = (): void => {
      if (!mapAreaTipShown) return;
      mapAreaTipShown = false;
      this.hideTooltip();
    };
    // Paint the shared #tooltip for the marker under a client-space point and
    // report whether one was shown (the attachTooltip idiom: map into author
    // space, then clamp the tooltip box against the viewport).
    const showMapTipAt = (clientX: number, clientY: number): boolean => {
      if (this.mapQuestAreas.length === 0 && this.mapNpcMarkers.length === 0) return false;
      const rect = mapCanvas.getBoundingClientRect();
      const cx = ((clientX - rect.left) * mapCanvas.width) / rect.width;
      const cy = ((clientY - rect.top) * mapCanvas.height) / rect.height;
      const glyph = npcMarkerAt(this.mapNpcMarkers, cx, cy);
      const html = glyph
        ? this.questGiverTooltipHtml(glyph)
        : this.questAreaTooltipHtml(questAreaObjectivesAt(this.mapQuestAreas, cx, cy));
      if (!html) return false;
      // Same as desktop hover: paint the tip at the pointer (a tap on touch, the
      // cursor on mouse). paintTooltipAt clamps the box on-screen either way.
      this.paintTooltipAt(html, clientX, clientY);
      mapAreaTipShown = true;
      return true;
    };
    mapCanvas.addEventListener('pointermove', (ev) => {
      if (ev.pointerType !== 'mouse' || this.mapDrag) {
        hideMapAreaTip();
        return;
      }
      if (!showMapTipAt(ev.clientX, ev.clientY)) hideMapAreaTip();
    });
    // Mouse only: a touch pointer fires pointerleave the instant the finger lifts
    // (and again when a zoomed-in drag releases its pointer capture), which would
    // wipe the tip the tap just opened. Touch dismisses via the next pointerdown.
    mapCanvas.addEventListener('pointerleave', (ev) => {
      if (ev.pointerType === 'mouse') hideMapAreaTip();
    });
    // A new press clears any open tip; for touch, remember where it started so the
    // release can tell a stationary marker tap from a pan.
    mapCanvas.addEventListener('pointerdown', (ev) => {
      hideMapAreaTip();
      mapTapStart = ev.pointerType === 'mouse' ? null : { x: ev.clientX, y: ev.clientY };
    });
    // A stationary touch release reveals the marker under the finger. iOS can raise
    // pointercancel (not pointerup) for a tap it briefly mistook for a gesture, so
    // both end the tap; a release that moved past the tolerance was a pan.
    const endMapTap = (ev: PointerEvent): void => {
      if (ev.pointerType === 'mouse' || !mapTapStart) return;
      const moved = Math.hypot(ev.clientX - mapTapStart.x, ev.clientY - mapTapStart.y);
      mapTapStart = null;
      if (moved <= TAP_MOVE_TOLERANCE_PX) showMapTipAt(ev.clientX, ev.clientY);
    };
    mapCanvas.addEventListener('pointerup', endMapTap);
    mapCanvas.addEventListener('pointercancel', endMapTap);
    $('#mm-bag').addEventListener('click', () => this.toggleBags());
    // Drop an equipped piece dragged out of the paperdoll onto the bags window.
    const bagsEl = $('#bags');
    bagsEl.addEventListener('dragover', (e) => {
      if (this.dragUnequipSlot === null) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
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
    $('#mm-valecup').addEventListener('click', () => this.toggleValeCup());
    $('#mm-leaderboard').addEventListener('click', () => this.toggleLeaderboard());
    $('#mm-discord')?.addEventListener('click', () => this.discordHook?.());
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

  // Note: the per-frame transform + width writers live only on the painter facet now
  // (makeWriterFacet's setTransform/setWidth, painter_host.ts). The target hp bar was
  // the last Hud-direct setTransform caller and the cast bars were the last
  // setWidth caller; with both on their painters, every transform/width write
  // routes through the facet over the SAME hotWriteCache + `transform:`/`width:` keys,
  // so the Hud no longer mirrors a private setTransform or setWidth.

  // Write-elision extension. setStyleProp drives a custom
  // property (or any standard property) and toggleClass drives a class, each
  // keyed in a MULTI-SLOT cache: one element can hold many props / toggled
  // classes, so collapsing these into the single-slot hotWriteCache would
  // silently break elision (Top risk 1). The facet in painter_host.ts binds the
  // same two writers over these same caches + counters, so Hud-direct writes and
  // painter writes share one skip-rate.
  private setStyleProp(el: HTMLElement, prop: string, value: string): void {
    let slots = this.hotStylePropCache.get(el);
    if (slots === undefined) {
      slots = new Map();
      this.hotStylePropCache.set(el, slots);
    }
    if (slots.get(prop) === value) {
      this.hotDomSkippedWrites++;
      return;
    }
    slots.set(prop, value);
    this.hotDomWrites++;
    el.style.setProperty(prop, value);
  }

  private toggleClass(el: HTMLElement, cls: string, on: boolean): void {
    const state = on ? 'on' : 'off';
    let slots = this.hotClassCache.get(el);
    if (slots === undefined) {
      slots = new Map();
      this.hotClassCache.set(el, slots);
    }
    if (slots.get(cls) === state) {
      this.hotDomSkippedWrites++;
      return;
    }
    slots.set(cls, state);
    this.hotDomWrites++;
    el.classList.toggle(cls, on);
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
      // Piggyback the resize-grip stamp on this one observer (window_resize.ts
      // deliberately runs no body-wide observer of its own).
      markResizableWindow(el);
    };
    this.windowObserver = new MutationObserver((mutations) => {
      const windowsToSync = new Set<HTMLElement>();
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
          if (isWindowDragPreviewMutation(m.attributeName, m.target)) continue;
          windowsToSync.add(m.target);
        }
      }
      for (const win of windowsToSync) this.syncWindowOpenState(win);
    });
    document.querySelectorAll<HTMLElement>('.window.panel').forEach(observeWindow);
    this.windowObserver.observe(document.body, { childList: true, subtree: true });
    this.syncAnyWindowOpenState();

    this.windowDragController = installWindowDrag({
      getScale: () => getUiScale(),
      isDragHandle: (target, el) => this.isWindowDragHandle(target, el),
      bringToFront: (el) => this.bringWindowToFront(el),
      hideTooltip: () => this.hideTooltip(),
      pinWindow: (el, rect) => this.setWindowPixelPosition(el, rect.left, rect.top, rect),
      commitWindow: (el, left, top, rect) => this.setWindowPixelPosition(el, left, top, rect),
    });
    installWindowResize({
      getScale: () => getUiScale(),
      pinWindow: (el, rect) => this.setWindowPixelPosition(el, rect.left, rect.top, rect),
    });
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
    // The mobile More tray is a class-driven modal (body.mobile-more-open): it
    // stays display:flex and hides via visibility/opacity for its fade, so a
    // computed-display test would read it as permanently open. Report its real
    // open state from the body class, mirroring the social-window case above.
    if (el.id === 'mobile-extra-controls')
      return document.body.classList.contains('mobile-more-open');
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
      // A window moved or resized at an earlier viewport keeps its inline
      // left/top while hidden; the viewport-resize re-clamp skips hidden
      // windows, so re-clamp at show time or it can reopen off-screen.
      if (el.dataset.windowMoved === '1') {
        const rect = el.getBoundingClientRect();
        this.setWindowPixelPosition(el, rect.left, rect.top, rect);
      }
      this.bringWindowToFront(el);
    }
    this.syncAnyWindowOpenState();
  }

  private syncAnyWindowOpenState(): void {
    const windows = [...document.querySelectorAll<HTMLElement>('.window.panel')];
    const anyOpen = windows
      .filter((win) => win.id !== 'mobile-extra-controls')
      .some((win) => this.isWindowVisible(win));
    document.body.classList.toggle('mobile-window-open', anyOpen);
    const storeWindow = document.getElementById('daily-rewards-window') as HTMLElement | null;
    const claudiumWindow = document.getElementById('claudium-window') as HTMLElement | null;
    document.body.classList.toggle(
      'store-stack-open',
      stackedWindowsVisible(
        !!storeWindow && this.isWindowVisible(storeWindow),
        !!claudiumWindow && this.isWindowVisible(claudiumWindow),
      ),
    );
    const mapWindow = document.getElementById('map-window');
    const questLogWindow = document.getElementById('quest-log-window');
    document.body.classList.toggle(
      'mobile-map-quest-open',
      !!mapWindow &&
        !!questLogWindow &&
        this.isWindowVisible(mapWindow) &&
        this.isWindowVisible(questLogWindow),
    );
  }

  private placeNewWindow(el: HTMLElement): void {
    // Desktop-only cascade: mobile windows are full-screen/modal (see
    // src/styles/hud.mobile.css), so the pixel-offset cascade here would hijack
    // their inset:0 CSS with an inline top/left/right:auto/bottom:auto that
    // never gets reset, breaking the full-screen layout for the rest of the
    // session (issue 1577 char/talents redo).
    if (
      document.body.classList.contains('mobile-touch') ||
      el.dataset.windowMoved === '1' ||
      el.id === 'loot-window' ||
      el.id === 'confirm-dialog'
    )
      return;
    if (
      document.body.classList.contains('vendor-open') &&
      (el.id === 'vendor-window' || el.id === 'bags')
    )
      return;
    // The bank docks its bags companion the same way the vendor does (a fixed
    // side-by-side cluster driven by body.bank-open, mobile-paired 50/50); baking a
    // cascade-offset inline position onto either half would defeat that layout (the
    // inline inset beats the docking CSS), so skip the cascade for the bank cluster.
    if (
      document.body.classList.contains('bank-open') &&
      (el.id === 'bank-window' || el.id === 'bags')
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
    // The confirm/input prompt is the topmost modal by definition and never
    // joins the 50-89 window band: banding it (a pointerdown raise, or the
    // normalize sweep) drops it BEHIND the armory inspect overlay (z 90), so a
    // real mouse press on the dialog demotes it mid-click and its own OK
    // button becomes unclickable (the "phantom dead confirm" bug).
    if (el.id === 'confirm-dialog') {
      el.style.zIndex = String(Math.max(this.windowZValue(el), 95));
      return;
    }
    if (this.windowZ >= 89) this.normalizeWindowZ();
    el.style.zIndex = String(++this.windowZ);
  }

  private normalizeWindowZ(): void {
    const open = [...document.querySelectorAll<HTMLElement>('.window.panel')]
      .filter((el) => el.id !== 'confirm-dialog' && this.isWindowVisible(el))
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

  // Second-pass clamp for a popup that is TALLER (or wider) than the reserve
  // placePopupAt was given: measure the real rendered box and pull it back on-screen.
  // The unit context menu with the 40px mobile-floor items can exceed a fixed reserve
  // on a short landscape phone; getBoundingClientRect reflects the laid-out box (so it
  // is reliable even on the first open, where an offset read can still be stale), and
  // this only ever moves the popup UP/LEFT, never past the top/left edge.
  private keepPopupOnScreen(el: HTMLElement): void {
    const clamp = () => {
      const z = getUiScale();
      const r = el.getBoundingClientRect();
      const overBottom = r.bottom - window.innerHeight;
      if (overBottom > 0) {
        const top = Number.parseFloat(el.style.top) || 0;
        el.style.top = `${Math.max(0, top - overBottom / z)}px`;
      }
      const overRight = r.right - window.innerWidth;
      if (overRight > 0) {
        const left = Number.parseFloat(el.style.left) || 0;
        el.style.left = `${Math.max(0, left - overRight / z)}px`;
      }
    };
    clamp();
    // A popup shown for the FIRST time can report a stale (pre-layout) box on this
    // synchronous pass, so re-clamp once the browser has laid it out. Subsequent
    // opens are already correct above; this only ever nudges a still-overflowing
    // menu up/left by a frame, never off the top/left edge.
    requestAnimationFrame(clamp);
  }

  private centerPopupInViewport(el: HTMLElement, margin = 10): void {
    const z = getUiScale();
    const vw = window.innerWidth / z;
    const vh = window.innerHeight / z;
    const rect = el.getBoundingClientRect();
    const width = Math.min(rect.width / z, vw - margin * 2);
    const height = Math.min(rect.height / z, vh - margin * 2);
    el.style.left = `${Math.max(margin, (vw - width) / 2)}px`;
    el.style.top = `${Math.max(margin, (vh - height) / 2)}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.transform = 'none';
  }

  private topmostOpenWindow(): HTMLElement | null {
    return (
      [...document.querySelectorAll<HTMLElement>('.window.panel')]
        .filter((el) => this.isWindowVisible(el))
        .sort((a, b) => this.windowZValue(b) - this.windowZValue(a))[0] ?? null
    );
  }

  private closeManagedWindow(el: HTMLElement): void {
    this.windowDragController?.cancel(el);
    delete el.dataset.windowOpen;
    switch (el.id) {
      case 'confirm-dialog':
        this.confirmTrap?.release();
        this.confirmTrap = null;
        el.remove();
        break;
      case 'options-menu':
        this.closeOptions();
        break;
      case 'social-window':
        // Route through the painter so focus returns to the opener (WCAG 2.2 AA),
        // consistent with the toggle/X close path.
        this.socialWindow.close();
        break;
      case 'char-window':
        // Route through the painter so focus returns to the opener (WCAG 2.2 AA).
        this.charWindow.close();
        break;
      case 'trade-window':
        this.sim.tradeCancel();
        this.hideTooltip();
        break;
      case 'market-window':
        this.closeMarket();
        break;
      case 'mailbox-window':
        // Route through the painter so focus returns to the opener (WCAG 2.2 AA).
        this.mailboxWindow.close();
        break;
      case 'bank-window':
        // Route through the painter so focus returns to the opener (WCAG 2.2 AA).
        this.closeBank();
        break;
      case 'calendar-window':
        // Route through the painter so focus returns to the opener (WCAG 2.2 AA).
        this.calendarWindow.close();
        break;
      case 'deeds-window':
        // Route through the painter so focus returns to the opener (WCAG 2.2 AA).
        this.deedsWindow.close();
        break;
      case 'arena-window':
        // Route through the painter so focus returns to the opener (WCAG 2.2 AA),
        // consistent with the toggle / X close path.
        this.arenaWindow.close();
        break;
      case 'valecup-window':
        // Route through the painter so focus returns to the opener (WCAG 2.2 AA).
        this.valeCupWindow.close();
        break;
      case 'vendor-window':
        this.closeVendor();
        this.closeHeroicVendor();
        break;
      case 'town-focus-window':
        this.closeTownFocus();
        break;
      case 'crafting-window':
        this.closeCrafting();
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
      case 'loot-settings-window':
        this.closeLootSettings();
        break;
      case 'bags':
        if (this.vendorOpen && document.body.classList.contains('mobile-touch')) this.closeVendor();
        // The bank cluster is one unit on touch exactly like the vendor cluster
        // (the bank hides its own x-btn under the pairing), so the managed close
        // of bags closes the bank companion too, never leaving a half-width orphan.
        else if (this.bankWindow.isOpen && document.body.classList.contains('mobile-touch'))
          this.closeBank();
        // Route through the painter so focus returns to the opener (WCAG 2.4.3),
        // consistent with the toggle / X close path. NON-MODAL: no trap is released.
        else this.bagsWindow.close();
        break;
      case 'talents-window':
        // Route through the painter so the staged buffer is dropped AND focus
        // returns to the opener (WCAG), consistent with the toggle/X close path.
        this.talentsWindow.close();
        break;
      case 'spellbook':
        // Route through the painter so focus returns to the opener (WCAG 2.2 AA).
        this.spellbookWindow.close();
        break;
      case 'quest-log-window':
        this.questlogWindow.close();
        break;
      case 'leaderboard-window':
        this.leaderboardWindow.close();
        break;
      case 'daily-rewards-window':
        this.dailyRewardsWindow.close();
        break;
      case 'emote-editor':
        this.closeEmoteEditor();
        break;
      case 'mobile-extra-controls':
        // The More tray is class-driven (body.mobile-more-open), NOT inline
        // display: setting el.style.display='none' here would stamp an inline
        // rule that permanently outranks the stylesheet and the tray could never
        // reopen. Close it the way its own controls do (the tap-outside handler
        // + the X + mobile_controls.closeMoreModal all remove these three).
        document.body.classList.remove('mobile-more-open');
        document.getElementById('mobile-controls')?.classList.remove('expanded');
        document.getElementById('mobile-more')?.classList.remove('active');
        this.hideTooltip();
        break;
      default:
        el.style.display = 'none';
        this.hideTooltip();
        break;
    }
    this.syncAnyWindowOpenState();
  }

  // -------------------------------------------------------------------------
  // Chat tabs (classic-style): the built-in "Chat" (all) and "Combat Log" views,
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
      (isChatOpenTab(savedActive) && this.chatTabs.includes(savedActive))
        ? (savedActive as ChatTabId)
        : 'all';
    // re-join any opt-in global channels whose tabs were restored, so messages
    // typed there are delivered this session too (the whisper tab never joins)
    for (const ch of this.chatTabs)
      if (isChatTabChannel(ch) && channelNeedsJoin(ch)) this.sim.chat(`/join ${ch}`);
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

    // Mobile-only resize handle: a BODY-LEVEL bar pinned by CSS to the open panel's bottom
    // edge (it shares the panel's --mobile-chat-bottom var, so they move together) with a
    // very high z-index so nothing can overlay it, and touch-action:none so a drag on it is
    // a RESIZE, not a page scroll. Dragging it sets --mobile-chat-bottom (clamped by CSS).
    // It is a direct child of body (not #ui / the wrap) so its z-index is not capped by an
    // ancestor stacking context. Hidden on desktop via CSS.
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'chat-mobile-resize';
    resizeHandle.title = t('hudChrome.chatWindow.resize');
    resizeHandle.setAttribute('aria-hidden', 'true');
    document.body.appendChild(resizeHandle);
    resizeHandle.addEventListener('pointerdown', (ev) =>
      this.onMobileChatResizeStart(ev, resizeHandle),
    );
    resizeHandle.addEventListener('pointermove', (ev) => this.onMobileChatResizeMove(ev));
    const endMobileResize = (ev: PointerEvent) => this.onMobileChatResizeEnd(ev);
    resizeHandle.addEventListener('pointerup', endMobileResize);
    resizeHandle.addEventListener('pointercancel', endMobileResize);
    try {
      const savedBottom = localStorage.getItem(MOBILE_CHAT_BOTTOM_KEY);
      if (savedBottom) {
        // Clamp on restore so a value saved from a larger viewport (or an earlier build)
        // cannot land out of range and make the first drag feel dead.
        const clamped = this.clampMobileChatBottom(Number.parseInt(savedBottom, 10) || 52);
        document.documentElement.style.setProperty('--mobile-chat-bottom', `${clamped}px`);
      }
    } catch {
      /* storage unavailable */
    }

    // touch-action lives in CSS now: `none` on desktop so a touch-drag on the empty
    // strip moves the chat box (the move gesture is desktop-only, see
    // onChatBoxMoveStart), and `pan-x` on mobile so overflowed tabs can be swiped
    // (hud.mobile.css). An inline style here would override those rules.
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

  // Clamp the panel's bottom inset to the same range the CSS clamp uses (12px .. viewport
  // minus a reserved top band), so the stored value never drifts out of range. If it did,
  // the CSS clamps it for display but a drag starting from the out-of-range raw value would
  // not move the (already-clamped) panel until the raw crossed back in, which reads as a
  // dead drag. Clamping in JS too keeps the drag responsive from the first pixel.
  private clampMobileChatBottom(v: number): number {
    const hi = Math.max(12, window.innerHeight - 320);
    return Math.min(hi, Math.max(12, v));
  }

  // Mobile chat resize: drag the bottom handle to set --mobile-chat-bottom (the panel's
  // bottom inset). Dragging DOWN lowers the inset (taller panel); UP raises it (shorter).
  // The handle has touch-action:none and captures the pointer, so the drag is a resize (not
  // a scroll) and follows the finger.
  private onMobileChatResizeStart(ev: PointerEvent, handle: HTMLElement): void {
    if (!this.isMobileLayout()) return;
    ev.preventDefault();
    ev.stopPropagation();
    const raw = document.documentElement.style.getPropertyValue('--mobile-chat-bottom');
    const startBottom = this.clampMobileChatBottom(raw ? Number.parseInt(raw, 10) || 52 : 52);
    this.mobileChatResize = { pointerId: ev.pointerId, startY: ev.clientY, startBottom };
    document.body.classList.add('chat-box-dragging');
    try {
      handle.setPointerCapture?.(ev.pointerId);
    } catch {
      /* synthetic pointer */
    }
  }

  private onMobileChatResizeMove(ev: PointerEvent): void {
    const g = this.mobileChatResize;
    if (!g || g.pointerId !== ev.pointerId) return;
    ev.preventDefault();
    // Finger moving down (clientY grows) shrinks the bottom inset so the panel grows down.
    const bottom = this.clampMobileChatBottom(g.startBottom - (ev.clientY - g.startY));
    document.documentElement.style.setProperty('--mobile-chat-bottom', `${Math.round(bottom)}px`);
  }

  private onMobileChatResizeEnd(ev: PointerEvent): void {
    const g = this.mobileChatResize;
    if (!g || g.pointerId !== ev.pointerId) return;
    this.mobileChatResize = null;
    document.body.classList.remove('chat-box-dragging');
    const bottom = document.documentElement.style.getPropertyValue('--mobile-chat-bottom');
    try {
      if (bottom) localStorage.setItem(MOBILE_CHAT_BOTTOM_KEY, bottom.trim());
    } catch {
      /* storage unavailable */
    }
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

  // -------------------------------------------------------------------------
  // Movable / lockable unit frames (desktop only). The DOM wiring (corner
  // move/lock button, pointer drag, localStorage persistence) lives in the
  // shared MovableFrame controller (movable_frame.ts); the pure position math
  // in target_frame_pos.ts. Two instances: the target frame keeps its stock
  // look wherever it lands; the player frame DETACHES from the action-bar
  // stack once moved (pf-detached: position fixed + the compact target-frame
  // bar width), so it can sit anywhere and read like the target frame.
  // -------------------------------------------------------------------------

  private initFrameMovers(): void {
    // One-time v0.24.1 cleanup: drop frame drags saved against the reverted
    // PR #1736 overhaul layout BEFORE the movers read them back (a saved
    // position applies, and detaches the player frame, at construction).
    resetFramePositionsOnce(localStorage);
    const isMobileLayout = () => this.isMobileLayout();
    // A live desktop-to-mobile viewport flip must re-home the anchored aura
    // bars (mobile owns its own aura placement), and the flip back re-anchors.
    window.addEventListener('resize', () => this.applyAuraAnchor());
    if (this.targetFrameEl) {
      this.targetFrameMover = new MovableFrame({
        frame: this.targetFrameEl,
        storageKey: TARGET_FRAME_POS_KEY,
        unlockLabelKey: 'hudChrome.targetFrame.unlock',
        lockLabelKey: 'hudChrome.targetFrame.lock',
        draggingBodyClass: 'target-frame-dragging',
        fallbackSize: { w: 220, h: 92 },
        isMobileLayout,
      });
    }
    if (this.playerFrameEl) {
      // Classic self-target: clicking the player frame body targets yourself.
      // The corner move button stops its own propagation; buttons inside the
      // frame and the anchored aura rows (aurasOnPlayerFrame) never self-target,
      // so a buff right-click-cancel or a stray icon click stays what it was.
      this.playerFrameEl.addEventListener('click', (ev) => {
        const clicked = ev.target as HTMLElement | null;
        if (clicked?.closest('button, #buff-bar, #debuff-bar')) return;
        this.sim.targetEntity(this.sim.playerId);
      });
      this.playerFrameMover = new MovableFrame({
        frame: this.playerFrameEl,
        storageKey: PLAYER_FRAME_POS_KEY,
        unlockLabelKey: 'hudChrome.playerFrame.unlock',
        lockLabelKey: 'hudChrome.playerFrame.lock',
        draggingBodyClass: 'player-frame-dragging',
        fallbackSize: { w: 260, h: 84 },
        isMobileLayout,
        onPositioned: (active) => this.setPlayerFrameDetached(active),
      });
    }
  }

  // Public: snap both movable unit frames back to their stock CSS spots and
  // forget the saved drags. Wired to the "Reset Frame Positions" interface option.
  resetUnitFrames(): void {
    this.targetFrameMover?.reset();
    this.playerFrameMover?.reset();
  }

  // The player frame docks inside #actionbar-stack, whose #bottom-bar ancestor
  // carries a centering transform, and a transformed ancestor hijacks any
  // fixed/absolute positioning (it becomes the containing block). Detaching
  // therefore REPARENTS the frame to #ui, the target frame's own parent, so the
  // saved left/top resolve in the same HUD coordinates the target frame uses;
  // re-docking (the mobile layout) puts it back at the head of the stack. The
  // painters' element refs (pf-hp etc.) are live nodes, so they survive the move.
  private setPlayerFrameDetached(active: boolean): void {
    const frame = this.playerFrameEl;
    frame.classList.toggle('pf-detached', active);
    if (active) {
      const uiRoot = $('#ui');
      if (frame.parentElement !== uiRoot) uiRoot.appendChild(frame);
    } else {
      const stack = $('#actionbar-stack');
      if (frame.parentElement !== stack) stack.insertBefore(frame, stack.firstChild);
    }
  }

  // Buffs on the Player Frame (aurasOnPlayerFrame): reparent the player's own
  // BUFF row into #player-frame, where CSS anchors it to the frame (above it
  // while docked over the action bars, below it once moved) and the frame's
  // children-zoom scale applies. The DEBUFF row never rides the frame: with the
  // option on it slides up beside the minimap into the spot the buff row
  // vacated (body.auras-on-frame, hud.css), classic WoW's debuff corner, so
  // incoming debuffs stay in one glanceable place. Off (or the mobile layout,
  // which owns its stock aura placement) restores the classic two-row corner;
  // the aura painters' element refs are live nodes, so they survive the moves.
  private aurasOnPlayerFrame = false;
  private buffBarHome: { parent: ParentNode; next: Node | null } | null = null;

  setAurasOnPlayerFrame(on: boolean): void {
    this.aurasOnPlayerFrame = on;
    this.applyAuraAnchor();
  }

  private applyAuraAnchor(): void {
    const on = this.aurasOnPlayerFrame && !this.isMobileLayout();
    document.body.classList.toggle('auras-on-frame', on);
    const frame = this.playerFrameEl;
    // The buff bar's stock home: right before its sibling debuff bar (which
    // stays put in the DOM; only its CSS spot shifts with the body class).
    this.buffBarHome ??= {
      parent: this.buffBarEl.parentNode as ParentNode,
      next: this.debuffBarEl,
    };
    if (on) {
      if (this.buffBarEl.parentElement !== frame) frame.appendChild(this.buffBarEl);
    } else if (this.buffBarEl.parentElement === frame) {
      this.buffBarHome.parent.insertBefore(this.buffBarEl, this.buffBarHome.next);
    }
  }

  private renderChatTabs(): void {
    const bar = $('#chatlog-tabs');
    // Overflowed tabs scroll horizontally (see #chatlog-tabs in hud.css); translate
    // a vertical wheel into that scroll (bound once, the bar element persists across
    // these innerHTML rebuilds) so a mouse without a horizontal wheel can still reach
    // them. A no-op until the strip actually overflows.
    if (!this.chatTabsWheelBound) {
      this.chatTabsWheelBound = true;
      bar.addEventListener(
        'wheel',
        (ev) => {
          if (ev.deltaY === 0 || bar.scrollWidth <= bar.clientWidth) return;
          ev.preventDefault();
          bar.scrollLeft += ev.deltaY;
        },
        { passive: false },
      );
    }
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
      const label = t(chatOpenTabLabelKey(ch));
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
      // Toggle: a second click on + closes the picker it opened.
      const menu = $('#ctx-menu');
      if (menu.style.display === 'block' && this.ctxMenuOpener === add) {
        this.closeContextMenu();
        return;
      }
      const r = add.getBoundingClientRect();
      this.openChatChannelMenu(r.left, r.bottom, add);
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
  private addChatTab(channel: ChatOpenTab, opts: { join?: boolean; select?: boolean } = {}): void {
    const { join = true, select = false } = opts;
    if (!this.chatTabs.includes(channel)) {
      this.chatTabs.push(channel);
      // The whisper tab is filter-only (no channel to /join); only real channels join.
      if (join && isChatTabChannel(channel) && channelNeedsJoin(channel))
        this.sim.chat(`/join ${channel}`);
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

  private removeChatTab(channel: ChatOpenTab): void {
    const i = this.chatTabs.indexOf(channel);
    if (i < 0) return;
    this.chatTabs.splice(i, 1);
    // closing a tab does not /leave the channel (you stay subscribed, classic behavior)
    if (this.activeChatTab === channel) this.activeChatTab = 'all';
    this.renderChatTabs();
    this.selectChatTab(this.activeChatTab, true);
  }

  // The "+" menu: a toggle list of every openable tab. Open tabs show a check and
  // toggle off; the rest add a tab. Whisper is offered alongside the channels as
  // a filter-only tab that gathers every whisper in one place. Reuses the shared
  // #ctx-menu, so it inherits its outside-click / Escape close behaviour.
  private openChatChannelMenu(x: number, y: number, opener: HTMLElement | null = null): void {
    const el = $('#ctx-menu');
    this.ctxMenuOpener = opener;
    let html = `<div class="ctx-title">${esc(t('hud.core.chatChannels.addTitle'))}</div>`;
    // A trailing check mark flags already-open tabs, exactly as the channel list
    // did before this whisper tab was added. Built from its char code so no literal
    // glyph sits in source, keeping the no-emoji source guard green.
    const checkMark = ` ${String.fromCharCode(0x2713)}`;
    const item = (id: ChatOpenTab, labelKey: TranslationKey): string => {
      const open = this.chatTabs.includes(id);
      return `<div class="ctx-item" data-act="${id}">${esc(t(labelKey))}${open ? checkMark : ''}</div>`;
    };
    for (const ch of CHAT_TAB_CHANNELS) html += item(ch, CHANNEL_LABEL_KEYS[ch]);
    html += item(WHISPER_TAB, WHISPER_TAB_LABEL_KEY);
    html += `<div class="ctx-item" data-act="close">${esc(t('hud.chat.context.cancel'))}</div>`;
    el.innerHTML = html;
    this.placePopupAt(el, x, y, 170, 320, 0, 8);
    el.style.display = 'block';
    this.bindContextMenuActions((act) => {
      if (!isChatOpenTab(act)) return;
      if (this.chatTabs.includes(act)) this.removeChatTab(act);
      // Focus the whisper tab on open so the effect is visible (channels stay put,
      // as opening one must not hijack where the player's typed text goes).
      else this.addChatTab(act, { select: act === WHISPER_TAB });
    });
  }

  // The tab that FILTERS the log (which messages show): null on all/combat, else
  // the active tab, including the whisper collector (its messages carry chan
  // 'whisper', so the same dataset.chan filter gathers them).
  private chatFilterTab(): ChatOpenTab | null {
    return this.activeChatTab === 'all' || this.activeChatTab === 'combat'
      ? null
      : this.activeChatTab;
  }

  // The SEND channel a plain typed line targets: null on all/combat AND on the
  // whisper tab (whisper has no generic send channel; the whisper tab replies via
  // /r instead, handled in composeChatSend).
  private chatSendChannel(): ChatTabChannel | null {
    const tab = this.chatFilterTab();
    return tab !== null && isChatTabChannel(tab) ? tab : null;
  }

  private applyChatFilter(): void {
    const filter = this.chatFilterTab();
    for (const child of Array.from(this.chatLogEl.children)) {
      const chan = (child as HTMLElement).dataset.chan;
      (child as HTMLElement).classList.toggle('chat-hidden', filter !== null && chan !== filter);
    }
    this.chatLogEl.scrollTop = this.chatLogEl.scrollHeight;
  }

  private hideIfFiltered(div: HTMLElement, chan: string): void {
    const filter = this.chatFilterTab();
    if (filter !== null && chan !== filter) div.classList.add('chat-hidden');
  }

  private syncChatPlaceholder(): void {
    const input = document.getElementById('chat-input') as HTMLTextAreaElement | null;
    if (input) input.placeholder = this.activeChatPlaceholder();
  }

  // The line actually sent for what the player typed, honoring the active tab.
  // main.ts calls this on Enter so a channel tab works without retyping the slash
  // command; an explicit "/..." the player typed still wins. On the whisper tab,
  // plain text replies to the last whisperer (/r) instead of binding a channel.
  composeChatSend(typed: string): string {
    const withLinks = this.applyPendingChatLinks(typed);
    if (this.activeChatTab === WHISPER_TAB) return composeWhisperReply(withLinks);
    const ch = this.chatSendChannel();
    return ch ? composeChatLine(ch, withLinks) : withLinks.trim();
  }

  // Shift-click a quest-log entry: open the chat input and insert a readable
  // [Name] link. composeChatSend swaps it for the canonical [[q:id]] token on send.
  insertQuestChatLink(questId: string): void {
    this.insertChatLink(`[${questTitle(questId)}]`, encodeQuestLink(questId));
  }

  // Shift-click a bag item: insert a readable [Item Name] link into chat. On send,
  // composeChatSend swaps it for the canonical [[i:id]] token (name resolved at render).
  insertItemChatLink(itemId: string): void {
    const item = ITEMS[itemId];
    if (!item) return;
    this.insertChatLink(`[${itemDisplayName(item)}]`, encodeItemLink(itemId));
  }

  // Shared affordance: append a readable [Name] to the chat input and remember the
  // token it stands for, so applyPendingChatLinks can swap it back in on send.
  private insertChatLink(display: string, token: string): void {
    const input = $('#chat-input') as unknown as HTMLInputElement;
    this.pendingChatLinks = [...this.pendingChatLinks, { display, token }];
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
  clearPendingChatLinks(): void {
    this.pendingChatLinks = [];
  }

  // Replace any inserted readable [Name] with its [[q:id]]/[[i:id]] token, then forget them.
  private applyPendingChatLinks(typed: string): string {
    if (this.pendingChatLinks.length === 0) return typed;
    const pending = this.pendingChatLinks;
    this.pendingChatLinks = [];
    let out = typed;
    for (const { display, token } of pending) out = out.replace(display, token);
    return out;
  }

  // Intercept "/share": link the selected quest into party chat. Returns true when
  // handled (the caller then skips normal send). Not-in-a-party is left to the sim's
  // existing "You are not in a party." error from the /p path.
  maybeHandleQuestShareCommand(raw: string): boolean {
    if (!/^\/share(?:\s|$)/i.test(raw.trim())) return false;
    const id = this.questlogWindow.selectedQuestId;
    if (!id || !this.sim.questLog.has(id)) {
      this.showError(t('hudChrome.questShare.noQuestSelected'));
      return true;
    }
    this.sim.chat(`/p ${encodeQuestLink(id)}`);
    return true;
  }

  // Placeholder for the chat input reflecting the active tab.
  activeChatPlaceholder(): string {
    if (this.activeChatTab === WHISPER_TAB)
      return t('hud.core.chatChannels.sendingTo', { channel: t(WHISPER_TAB_LABEL_KEY) });
    const ch = this.chatSendChannel();
    if (ch) return t('hud.core.chatChannels.sendingTo', { channel: t(CHANNEL_LABEL_KEYS[ch]) });
    // The compact touch composer has no room for the desktop slash-command legend
    // (/s, /w, /r, ...), so use a short prompt on the mobile HUD. The channel-aware
    // "Message {channel}" variants above are already short and stay as-is.
    return this.isMobileLayout()
      ? t('hudChrome.mobile.chatPlaceholder')
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

  // PainterHost facets (painter_host.ts). The write-elision facet binds the six
  // private hot writers as closures over the SAME caches + counters (no visibility
  // change), so the HUD and painters share one skip-rate; the delve painter uses it
  // for the '#zone-label' text, the xp/swing painters for their per-frame writes.
  // The presentation bag is the shared icon/money/tooltip surface item windows
  // compose (today only the vendor window).
  private readonly writerFacet = makeWriterFacet(
    this.hotWriteCache,
    this.hotStylePropCache,
    this.hotClassCache,
    this.hotAttrCache,
    () => {
      this.hotDomWrites++;
    },
    () => {
      this.hotDomSkippedWrites++;
    },
  );
  private readonly delvePainter = new DelveMapPainter(this.writerFacet, classCss);
  // The Protect Yumi match strip + bench overlay (yumi_match_painter.ts):
  // facet-routed; structure from arenaInfo.match.yumi, dynamics from the
  // yumiStatus/yumiDown events fed in handleEvents. Runs on the mediumHud
  // band next to the fiesta HUD (values change at 1Hz).
  private readonly yumiPainter = new YumiMatchPainter(this.writerFacet, () =>
    document.getElementById('ui'),
  );
  // Per-frame XP + swing painters. Each caches its element refs once and
  // routes every write through the same six-writer facet, so their --xp-fill /
  // .rested / swing writes share the one skip-rate.
  private readonly xpBarPainter = new XpBarPainter(
    this.writerFacet,
    this.xpbarEl,
    this.xpFillEl,
    this.xpRestedEl,
    this.xpLabelEl,
    this.playerFrameEl,
  );
  private readonly swingTimerPainter = new SwingTimerPainter(
    this.writerFacet,
    this.swingbarEl,
    this.swingFillEl,
    this.swingLabelEl,
  );
  // The per-frame FCT painter: the pooled-div ring that replaced the per-event
  // createElement + setTimeout fct() below. handleEvents + showSelfNote feed spawn(), which
  // projects the head anchor ONCE (screen-anchored, byte-faithful to the old fct() and to
  // classic combat text: the number rises in screen space, it does not chase the camera) and
  // behind-culls; the every-frame tier of update() drives step(), which ONLY TTL-recycles
  // expired floaters (no per-frame reposition). It owns FCT_POOL_CAP pre-allocated #ui
  // children, projecting through renderer.worldToScreen and dividing by getUiScale into
  // author space (the same zoom correction the old fct() applied). All writes route through
  // the write-elision facet; the per-kind colour is a CSS class token,
  // never an inline hex.
  private readonly fctPainter = new FctPainter(
    this.writerFacet,
    document.getElementById('ui') as HTMLElement,
    (x, y, z) => this.renderer.worldToScreen(x, y, z),
    getUiScale,
    // Tier the pool cap / TTL from the STATIC preset (data-fx-level), never the
    // governor. spawn() reads this per event.
    { getFxTier: () => this.fxTier() },
  );
  // The player frame is the FIRST instance of the unit_frame family. It owns
  // its own element set; target/party become further instances of this exact
  // painter. The element set + options deliberately mirror the inline block
  // exactly, so the player path stays byte-faithful: no `name` (the player name is
  // static, set once at login, not on the hot path); no `stateClasses` (the player
  // frame never carries dead/out-of-range, those are party-only); no `shownDisplay`
  // (the frame is always visible via CSS, never toggled); no `repaintPortrait` (its
  // portrait is drawn at character setup, drawPlayerFramePortrait, not per frame).
  private readonly playerFramePainter = new UnitFramePainter(this.writerFacet, {
    frame: this.playerFrameEl,
    level: this.pfLevelEl,
    hpFill: this.pfHpEl,
    hpText: this.pfHpTextEl,
    absorb: this.pfAbsorbEl,
    resource: { container: this.pfResourceEl, fill: this.pfResEl, text: this.pfResTextEl },
  });
  // The two cast bars are ONE instance-parameterized painter, over the
  // castBarState core. The PLAYER instance localizes the cast id (castDisplayName),
  // layers the eat/drink overlay (consumeBarState, player-only), and clears the bar
  // on hide (its inline block did). The TARGET instance shows the raw cast id
  // (byte-faithful: the target block set the raw `label`), has no eat/drink (the
  // target never eats/drinks, so its paint omits `consume`), and hides with only
  // display:none (its inline block did not clear).
  private readonly playerCastBarPainter = new CastBarPainter(
    this.writerFacet,
    {
      bar: this.castbarEl,
      fill: this.castbarFillEl,
      label: this.castbarLabelEl,
      timer: this.castbarTimerEl,
    },
    { resolveCastLabel: (s) => castDisplayName(s.label), clearOnHide: true },
  );
  private readonly targetCastBarPainter = new CastBarPainter(
    this.writerFacet,
    {
      bar: this.targetCastbarEl,
      fill: this.targetCastbarFillEl,
      label: this.targetCastbarLabelEl,
      timer: this.targetCastbarTimerEl,
    },
    { resolveCastLabel: (s) => s.label },
  );
  // The target frame is the SECOND instance of the unit_frame family: the same
  // painter + core as the player, over the target's element set. It supplies the
  // per-unit `name`, the cached `#tf-absorb` overlay node (no per-frame query), the
  // `shownDisplay` show/hide path, and the portrait repaint gate (the painter owns
  // the gate, so the old `lastPortraitTarget` sentinel is now the painter's
  // `lastPortraitKey`). It passes NO resource group (the target has no power bar) and
  // NO `stateClasses` (the target carries its own `elite` class, painted at the call
  // site, not the party dead/out-of-range classes). The target-only concerns the
  // family does not express (the elite class + tag, the hostile/friendly name
  // color) route through the SAME elided writers in update() below.
  private readonly targetFramePainter = new UnitFramePainter(
    this.writerFacet,
    {
      frame: this.targetFrameEl,
      // The name writes into the TEXT-ONLY middle child; the title decoration
      // writes into the muted-gold siblings (setText would clobber children of
      // the outer #tf-name, which keeps the color/class writes below).
      name: this.targetNameTextEl,
      titlePre: this.targetTitlePreEl,
      titlePost: this.targetTitlePostEl,
      level: this.targetLevelEl,
      hpFill: this.targetHpEl,
      hpText: this.targetHpTextEl,
      absorb: this.targetAbsorbEl,
      resource: {
        container: this.targetResourceEl,
        fill: this.targetResEl,
        text: this.targetResTextEl,
      },
    },
    {
      shownDisplay: 'flex',
      repaintPortrait: () => this.drawTargetPortrait(),
    },
  );
  // Deferred "Auto-Attack on Ability Use" for TIMED casts: set by castSlot when
  // the QoL would engage but the ability has a cast time, consumed by the
  // castStop event (engage on success, drop on interrupt), so starting a Smite
  // never aggros the target before its damage lands.
  private pendingAutoAttackOnCastEnd = false;
  // The party rows' mini aura strips share these deps (each row builds its own
  // view + painter instance over them). The wire summaries carry no remaining
  // time (Infinity reaches the core, so the duration label stays blank), which
  // is why the tooltip here is NAME-ONLY: no seconds line, no effect summary.
  private readonly partyAurasDeps: PartyRowAuraDeps = {
    view: {
      iconId: (a) => (ABILITIES[a.id] ? a.id : `aura_${a.kind}`),
      auraName: (a) =>
        ABILITIES[a.id] ? abilityDisplayName(ABILITIES[a.id]) : auraDisplayNameFromSource(a.name),
      formatStacks: (n) => formatNumber(n, { maximumFractionDigits: 0 }),
      // Units are never rendered here (Infinity remaining -> blank label), so the
      // shared container is returned unrefreshed.
      durationUnits: () => this.auraDurationUnits,
      auraEffectHtml: () => '',
      // The party rows' wire summaries carry no sourceId and the mini strips are
      // not ownFirst views, so nothing here is ever "own".
      isOwn: () => false,
    },
    painter: {
      resolveIconUrl: (iconKey) => `url(${iconDataUrl('aura', iconKey)})`,
      renderTooltip: (name) => `<div class="tt-title">${esc(name)}</div>`,
      attachTooltip: (el, html) => this.attachTooltip(el, html),
    },
  };
  // The persisted mobile party-collapse choice (default collapsed). Only consulted on
  // the touch HUD; the chip's tap flips + persists it and re-drives setCollapse. It is
  // a pure USER toggle (party HP is actionable info), never influenced by
  // data-fx-level, reduce-motion, or the FPS governor.
  private partyCollapsed = loadPartyCollapsed();
  // The party frames are N further instances of the unit_frame family, one per
  // member, behind a keyed node pool that replaces the old per-rebuild innerHTML wipe
  // + click/contextmenu re-attach. The pool owns #party-frames; updatePartyFrames
  // feeds it the pure selectPartyFrameMembers result only when the cheap signature
  // changed. All closures are lazy, so this field initializer is safe.
  private readonly partyFramesPainter = new PartyFramesPainter(
    this.writerFacet,
    this.partyFramesEl,
    {
      classCss,
      onTarget: (pid) => this.sim.targetEntity(pid),
      onContextMenu: (pid, name, x, y) => this.openContextMenu(pid, name, x, y),
      onLeave: () => this.sim.partyLeave(),
      leaveLabel: () => t('hud.social.leaveParty'),
      chipLabel: () => t('hudChrome.unitFrame.partyChip'),
      onToggleCollapse: () => this.togglePartyCollapsed(),
      partyAuras: this.partyAurasDeps,
    },
  );
  // Overworld world-map painter (the delve branch stays with delvePainter). Owns
  // the cached whole-world decorations; redraws from the mediumHud band while open.
  private readonly mapPainter = new MapWindowPainter();
  // The aura strips are the keyed-pool aura painter, two instances of the
  // auras_view core + AurasPainter: the player buff bar (#buff-bar, mode
  // 'all') and the target strip (#tf-debuffs, mode 'all' too: a target's buffs AND
  // debuffs, classic target-frame behavior). The shared deps fire
  // the i18n lookups every frame (so a language switch lands on the next tick) and the
  // painter's tooltip closure reads the pool's LIVE record (Top risk 3, never a captured
  // aura). All closures are lazy, so these field initializers are safe.
  // REUSED container for the per-frame durationUnits() dep (allocation-light
  // contract): the values re-resolve through t() each frame so a language
  // switch lands next tick, but the object itself is never reallocated.
  private readonly auraDurationUnits = { s: 's', m: 'm', h: 'h', d: 'd' };
  private readonly aurasViewDeps: AurasDeps = {
    iconId: (a) => (ABILITIES[a.id] ? a.id : `aura_${a.kind}`),
    auraName: (a) =>
      ABILITIES[a.id] ? abilityDisplayName(ABILITIES[a.id]) : auraDisplayNameFromSource(a.name),
    formatStacks: (n) => formatNumber(n, { maximumFractionDigits: 0 }),
    durationUnits: () => {
      const u = this.auraDurationUnits;
      u.s = t('hudChrome.unitFrame.durationUnitSeconds');
      u.m = t('hudChrome.unitFrame.durationUnitMinutes');
      u.h = t('hudChrome.unitFrame.durationUnitHours');
      u.d = t('hudChrome.unitFrame.durationUnitDays');
      return u;
    },
    auraEffectHtml: (a) => this.auraEffectTooltipHtml(a),
    // Own-aura check for the target strip's ownFirst prominence: a missing/zero
    // sourceId (an old server's mirror) is never own, so the strip degrades to
    // the un-prioritized layout instead of misattributing another caster's dot.
    isOwn: (a) => a.sourceId !== undefined && a.sourceId !== 0 && a.sourceId === this.sim.playerId,
  };
  private readonly aurasPainterDeps: AurasPainterDeps = {
    resolveIconUrl: (iconKey) => `url(${iconDataUrl('aura', iconKey)})`,
    renderTooltip: (name, remaining, effectHtml) =>
      `<div class="tt-title">${esc(name)}</div>${effectHtml}<div class="tt-sub">${esc(tPlural('hudChrome.plurals.secondsRemaining', Math.ceil(remaining)))}</div>`,
    attachTooltip: (el, html) => this.attachTooltip(el, html),
  };
  // Player auras split across two rows (classic layout): buffs in #buff-bar, debuffs in
  // #debuff-bar, so a fresh debuff is never buried under a wall of long-lived buffs.
  private readonly buffBarView = createAurasView('buffs', this.aurasViewDeps);
  private readonly debuffBarView = createAurasView('debuffs', this.aurasViewDeps);
  // The target strip shows EVERY aura (classic target-frame behavior): a friendly
  // target's buffs (the shield you just cast on an ally) alongside its debuffs, and
  // an enemy's buffs (a mob's frenzy) alongside the DoTs you keep on it. The element
  // keeps its historical #tf-debuffs id; only the view mode widened.
  // ownFirst: YOUR dots/hots on the target lead the strip and render larger (the
  // painter's `own` class), so what you are maintaining reads at a glance among
  // other casters' auras. Extra prominence only, never less information, so every
  // graphics tier keeps it (gameplay-neutral-graphics invariant).
  private readonly targetDebuffsView = createAurasView('all', this.aurasViewDeps, {
    ownFirst: true,
  });
  // The buff-bar painter alone gets attachCancel: right-clicking one of the local player's
  // own helpful buffs cancels it (classic convention). The debuff / target painters reuse
  // the shared deps (no cancel: a debuff or another entity's aura is never cancelable).
  private readonly buffBarPainterDeps: AurasPainterDeps = {
    ...this.aurasPainterDeps,
    attachCancel: (el, cancelableAuraId) => {
      el.addEventListener('contextmenu', (ev) => {
        const auraId = cancelableAuraId();
        if (auraId === null) return;
        ev.preventDefault();
        this.hideTooltip();
        this.sim.cancelAura(auraId);
      });
    },
  };
  private readonly buffBarPainter = new AurasPainter(
    this.writerFacet,
    this.buffBarEl,
    this.buffBarPainterDeps,
    document,
    // Cap the visible aura count on the LOW static preset (never the
    // governor).
    () => this.fxTier(),
  );
  private readonly debuffBarPainter = new AurasPainter(
    this.writerFacet,
    this.debuffBarEl,
    this.aurasPainterDeps,
    document,
    () => this.fxTier(),
  );
  private readonly targetDebuffsPainter = new AurasPainter(
    this.writerFacet,
    this.targetDebuffsEl,
    this.aurasPainterDeps,
    document,
    () => this.fxTier(),
  );
  // Overworld minimap canvas painter (the delve branch stays with delvePainter). Owns
  // the marker core; redraws from the fastHud (~10Hz) band. classCss colors the party
  // discs/arrows; zoneDisplayName localizes the '#zone-label' it writes via setText.
  private readonly minimapPainter = new MinimapPainter(this.writerFacet, classCss, (zoneId) =>
    zoneDisplayName(zoneId),
  );
  private readonly presentationBag: PainterHostPresentation = {
    itemIcon: (item) => this.itemIcon(item),
    moneyHtml: (copper) => this.moneyHtml(copper),
    itemTooltip: (item) => this.itemTooltip(item),
    attachTooltip: (el, html) => this.attachTooltip(el, html),
  };
  // The interactive talents window. Hud stays the coordinator (closeOtherWindows
  // needs its private window state) and owns the single staged edit buffer
  // (talentStage); the painter reads/replaces it via getStage/setStage and mutates
  // it in place. All closures are lazy, so this field initializer is safe even
  // though this.sim is assigned in the ctor body.
  private readonly talentsWindow = new TalentsWindow({
    ...this.presentationBag,
    root: () => $('#talents-window'),
    hideTooltip: () => this.hideTooltip(),
    ...this.windowFocus('#talents-window'),
    getStage: () => this.talentStage,
    setStage: (s) => {
      this.talentStage = s;
    },
    playerClass: () => this.sim.cfg.playerClass,
    totalPoints: () => this.sim.talentPoints().total,
    currentAllocation: () => this.sim.talents,
    activeLoadout: () => this.sim.activeLoadout,
    loadouts: () => this.sim.loadouts,
    currentBar: () => this.hotbarActions.map((a) => (a && a.type === 'ability' ? a.id : null)),
    saveLoadout: (name, bar, alloc) => this.sim.saveLoadout(name, bar, alloc),
    switchLoadout: (i) => this.sim.switchLoadout(i),
    deleteLoadout: (i) => this.sim.deleteLoadout(i),
    applyLoadoutBar: (bar) => this.applyLoadoutBar(bar),
    buildDropdown: (options, current, onChange, placeholder, a11y) =>
      this.buildDropdown(options, current, onChange, placeholder, a11y),
    inputDialog: (opts) => this.inputDialog(opts),
    confirmDialog: (title, body, okText, cancelText, onOk) =>
      this.confirmDialog(title, body, okText, cancelText, onOk),
    showError: (text) => this.showError(text),
  });
  // Social panel painter (social_view.ts core + social_window.ts painter). The
  // window renders no item rows, so it composes no PainterHostPresentation bag; it
  // reads/commands the live world and routes the shared chrome (whisper, confirm
  // prompt, close-others, focus return) through these lazy closures.
  private readonly socialWindow = new SocialWindow({
    root: () => $('#social-window'),
    world: () => this.sim,
    closeOthers: () => this.closeOtherWindows('#social-window'),
    hideTooltip: () => this.hideTooltip(),
    ...this.windowFocus('#social-window'),
    showPrompt: (text, acceptLabel, onAccept, onDecline) =>
      this.showPrompt(text, acceptLabel, onAccept, onDecline),
    startWhisper: (name) => this.startWhisper(name),
  });
  // Bags window painter (bags_view.ts core + bags_window.ts painter). It composes
  // the shared presentation bag (icon/money/tooltip) and adds the inventory-cluster
  // surface: world reads, cross-window mode flags + commands, pet-feed / drag /
  // wallet plumbing. The cross-window modes stay HUD state, read each click.
  private readonly bagsWindow = new BagsWindow({
    ...this.presentationBag,
    root: () => $('#bags'),
    world: () => this.sim,
    wocBalanceHtml: () => this.wocBalanceHtml(),
    claudiumLauncherHtml: () => this.claudiumLauncherHtml(),
    openClaudium: () => this.toggleClaudium(),
    hideTooltip: () => this.hideTooltip(),
    consumePeek: () => this.peekGuard.consume(),
    cancelPetFeed: () => this.cancelPetFeed(),
    // Non-trapping focus capture/return (bags is a non-modal companion of vendor /
    // trade / market): NOT windowFocus('#bags'), which would install a Tab trap and
    // break the inventory cluster.
    captureFocus: () => this.focusManager.activeFocusable(),
    restoreFocus: (target) => this.focusManager.restore(target),
    renderCharIfOpen: () => this.renderCharIfOpen(),
    vendorOpen: () => this.vendorOpen,
    tradeOpen: () => this.tradeOpen,
    isMarketSell: () => this.marketWindow.isSellTab,
    isMailAttach: () => this.mailboxWindow.isSendTab,
    isBankOpen: () => this.bankWindow.isOpen,
    pendingPetFeed: () => this.pendingPetFeed,
    closeVendor: () => this.closeVendor(),
    closeBank: () => this.closeBank(),
    onClosed: () => this.onBagsClosed(),
    addItemToTrade: (itemId) => this.addItemToTrade(itemId),
    stageMarketSell: (itemId) => this.marketWindow.stageSell(itemId),
    stageMailParcel: (itemId) => this.mailboxWindow.stageParcel(itemId),
    insertItemChatLink: (itemId) => this.insertItemChatLink(itemId),
    showError: (text) => this.showError(text),
    setPendingPetFeed: (active) => {
      this.pendingPetFeed = active;
    },
    resetPetBarSig: () => {
      this.lastPetBarSig = '';
    },
    isHotbarItemId: (itemId) => this.isHotbarItemId(itemId),
    setDragAction: (action) => {
      this.dragAction = action ? { action, sourceIndex: null } : null;
    },
    clearActionDropTargets: () => this.clearActionDropTargets(),
  });
  // World Market window painter (market_view.ts core + market_window.ts painter).
  // It composes the shared presentation bag (icon/money/tooltip) and owns the
  // market's view-state (tab, filters, page, staged sell item, search). The bags
  // window stays HUD-coordinated (it rides alongside and stages the Sell tab), so
  // the cross-window bag sync routes back through these lazy closures.
  private readonly marketWindow = new MarketWindow({
    ...this.presentationBag,
    root: () => $('#market-window'),
    world: () => this.sim,
    closeOthers: () => this.closeOtherWindows('#market-window'),
    hideTooltip: () => this.hideTooltip(),
    ...this.windowFocus('#market-window'),
    showError: (text) => this.showError(text),
    slotName: (slot) => itemSlotName(slot),
    syncBags: (open) => {
      if (open) {
        this.renderBags();
        $('#bags').style.display = 'flex';
      } else if ($('#bags').style.display !== 'none') {
        this.renderBags();
      }
    },
  });
  // Ravenpost mailbox window painter (mailbox_view.ts core + mailbox_window.ts
  // painter). It owns the mailbox view-state (tab, opened letter, staged
  // parcels); the bags window rides alongside the Send tab and stages parcels
  // through the same cross-window closures the market Sell tab uses.
  private readonly mailboxWindow = new MailboxWindow({
    ...this.presentationBag,
    root: () => $('#mailbox-window'),
    world: () => this.sim,
    closeOthers: () => this.closeOtherWindows('#mailbox-window'),
    hideTooltip: () => this.hideTooltip(),
    ...this.windowFocus('#mailbox-window'),
    showError: (text) => this.showError(text),
    syncBags: (open) => {
      if (open) {
        this.renderBags();
        $('#bags').style.display = 'flex';
      } else if ($('#bags').style.display !== 'none') {
        this.renderBags();
      }
    },
  });
  // Bank window painter (bank_view.ts core + bank_window.ts painter). A non-modal
  // companion of the bags cluster (the vendor-open docking pattern): it composes the
  // shared presentation bag (icon/money/tooltip) and reads/commands the pooled bank
  // through IWorld. Non-trapping focus capture/return (NOT windowFocus, which would
  // install a Tab trap and break the bank + bags cluster); onClosed drops the docking
  // body class and resyncs bags.
  private readonly bankWindow = new BankWindow({
    ...this.presentationBag,
    root: () => $('#bank-window'),
    world: () => this.sim,
    closeOthers: () => this.closeOtherWindows(['#bank-window', '#bags']),
    hideTooltip: () => this.hideTooltip(),
    consumePeek: () => this.peekGuard.consume(),
    // Non-trapping focus capture/return (bank is a non-modal companion of bags):
    // NOT windowFocus('#bank-window'), which would install a Tab trap.
    captureFocus: () => this.focusManager.activeFocusable(),
    restoreFocus: (target) => this.focusManager.restore(target),
    onClosed: () => this.onBankClosed(),
    // A bank op (withdraw / deposit-all / buy-slots) moved inventory or coin: repaint
    // the bags companion (and vendor/char if open) through the same coordinator the
    // online inventory-delta path calls. Offline this is the ONLY repaint; online the
    // snapshot echo repaints again authoritatively.
    onInventoryChanged: () => this.onInventoryChanged(),
  });
  // Book of Deeds window painter (deeds_view.ts core + deeds_window.ts
  // painter): the deed catalog browser and title picker over the IWorldDeeds
  // facet. A standalone trapping window (windowFocus), not a docked
  // companion; onWatchChanged repaints the HUD tracker immediately so a
  // watch toggle never waits for the slow band.
  private readonly deedsWindow = new DeedsWindow({
    ...this.presentationBag,
    root: () => $('#deeds-window'),
    world: () => this.sim,
    closeOthers: () => this.closeOtherWindows('#deeds-window'),
    hideTooltip: () => this.hideTooltip(),
    consumePeek: () => this.peekGuard.consume(),
    ...this.windowFocus('#deeds-window'),
    onWatchChanged: () => this.updateDeedTracker(),
  });
  // Watchlist HUD tracker (#deed-tracker): slow-band painter over the one
  // reused tracker-view container (allocation-light by contract).
  private readonly deedTrackerView = makeDeedTrackerView();
  private readonly deedTrackerPainter = new DeedTrackerPainter({
    root: () => $('#deed-tracker'),
    writers: this.writerFacet,
  });
  // Event calendar window painter (calendar_view.ts month-grid core +
  // calendar_window.ts painter). System events expand from data rules; guild
  // events read the socialInfo mirror and book/remove through IWorld.
  private readonly calendarWindow = new CalendarWindow({
    root: () => $('#calendar-window'),
    world: () => this.sim,
    closeOthers: () => this.closeOtherWindows('#calendar-window'),
    ...this.windowFocus('#calendar-window'),
    showError: (text) => this.showError(text),
  });
  // Ashen Coliseum window painter (arena_window_view.ts offline/live model +
  // arena_window.ts painter). It owns the selected bracket, the all-time-ladder
  // cache + fetch throttle, the render-skip signature, and focus-return; Hud
  // forwards the keybind toggle and drives render() from the mediumHud band.
  private readonly arenaWindow = new ArenaWindow({
    root: () => $('#arena-window'),
    world: () => this.sim,
    closeOthers: () => this.closeOtherWindows('#arena-window'),
    ...this.windowFocus('#arena-window'),
  });
  // Vale Cup window painter (vale_cup_window_view.ts model + vale_cup_window.ts
  // painter, the ArenaWindow shape). It owns the bracket / nation / role
  // selections, the render-skip signature, and focus-return; Hud forwards the
  // keybind toggle and drives render() from the mediumHud band.
  private readonly valeCupWindow = new ValeCupWindow({
    root: () => $('#valecup-window'),
    world: () => this.sim,
    closeOthers: () => this.closeOtherWindows('#valecup-window'),
    ...this.windowFocus('#valecup-window'),
  });
  // Persistent Vale Cup indicator button (queued / live-at-the-Sowfield states;
  // hidden inside my own match). Never tier-shed: queue position and the live
  // score are information, not cosmetics (gameplay-neutral graphics invariant).
  private readonly vcupIndicator = new ValeCupIndicator({
    root: () => $('#vcup-indicator'),
    open: () => this.toggleValeCup(),
    writers: this.writerFacet,
  });
  // In-match Vale Cup score strip (flags, score, count-down clock, phase line),
  // snapshot-driven from cupInfo.match on the mediumHud band; one-shot juice
  // (banners, horn) rides the vcup SimEvents in handleEvents.
  private readonly vcupMatchHud = new ValeCupHud({
    layer: () => document.getElementById('ui'),
    writers: this.writerFacet,
  });
  // Pre-match Vale Cup briefing overlay (rules + role kit + team sheet + Ready).
  // Self-mounting full-screen card shown only while cupInfo.match.phase is
  // 'briefing'; drives itself off view.visible (no toggle wiring), rides the
  // mediumHud band, and readies up through the IWorld command.
  private readonly vcupBriefing = new ValeCupBriefing({
    layer: () => document.getElementById('ui'),
    writers: this.writerFacet,
    onReady: () => this.sim.vcupReady(),
  });
  // Spectator parimutuel betting banner + card (walk-up at the Sowfield).
  private readonly vcupBetting = new ValeCupBetting({
    layer: () => document.getElementById('ui'),
    writers: this.writerFacet,
    onBet: (side, copper) => this.sim.vcupBet(side, copper),
  });
  // The shoot power meter (hold-to-charge): the charge input state lives on the
  // Hud (shootChargeSlot / shootChargeStartMs); this painter only draws it.
  private readonly vcupCharge = new ValeCupCharge({
    layer: () => document.getElementById('ui'),
    rootId: 'vcup-charge',
    writers: this.writerFacet,
  });
  // Latch for the kickoff auto-close of the queue window (arena pattern).
  private vcupMatchSeen = false;
  // Character window painter (char_view.ts paperdoll core + char_window.ts painter).
  // It composes the presentation bag (icon/tooltip) for the equip slots and routes
  // the HUD-built stat / talent / progression fragments plus the unequip + drag
  // plumbing. The shared 3D turntable preview and the cosmetic skin picker stay
  // HUD-owned (the single WebGL preview is borrowed by the skin-event overlay and
  // the player card), so the painter triggers them through renderPreview /
  // renderSkinPicker closures rather than building them.
  private readonly charWindow = new CharWindow({
    ...this.presentationBag,
    root: () => $('#char-window'),
    world: () => this.sim,
    closeOthers: () => this.closeOtherWindows('#char-window'),
    hideTooltip: () => this.hideTooltip(),
    ...this.windowFocus('#char-window'),
    slotName: (slot) => itemSlotName(slot),
    statCellHtml: (stat) => statCellHtml(this.statModel(stat), STAT_VIEW_DEPS),
    statTooltipHtml: (stat) => statTooltipHtml(this.statModel(stat), STAT_VIEW_DEPS),
    talentSummaryHtml: () => this.talentSummaryHtml(),
    progressionHtml: (level) => this.progressionHtml(level),
    unequip: (slot) => {
      this.sim.unequipItem(slot);
      audio.click();
      this.hideTooltip();
      this.renderBags();
      this.renderCharIfOpen();
    },
    beginUnequipDrag: (slot) => {
      this.dragUnequipSlot = slot;
      // Open the bags window if it's closed so there's a visible drop target,
      // otherwise the drag silently snaps back with no feedback.
      const bags = $('#bags');
      // Match the common open path (display: flex): opening as 'block' would drop the
      // flex-column layout, and re-forcing 'block' on an already-open (flex) bag would
      // clobber it mid-drag. Open as flex only when it is not already shown as flex (this
      // also covers the never-yet-opened state, where the inline display is '').
      if (bags.style.display !== 'flex') {
        bags.style.display = 'flex';
        this.renderBags();
      }
    },
    endUnequipDrag: () => {
      this.dragUnequipSlot = null;
      $('#bags').classList.remove('drop-target');
    },
    renderPreview: () => this.renderCharPreview(),
    renderSkinPicker: () => this.renderCharSkinPicker(),
    openPlayerCard: () => {
      void this.openPlayerCard();
    },
    openPrestige: () => this.openPrestigeDialog(),
    openDeeds: () => this.openDeeds(),
  });
  // Options window painter (options_view.ts core + options_window.ts painter). The
  // window renders no item rows, so it composes no PainterHostPresentation bag; it
  // reads only the world's bug-report slice and routes the options/bug-report seams,
  // the keybind store, the shared dropdown, focus management, and the chat-timestamp
  // state through these lazy closures.
  private readonly optionsWindow = new OptionsWindow({
    root: () => $('#options-menu'),
    world: () => this.sim,
    options: () => this.optionsHooks,
    bugReport: () => this.bugReportHooks,
    keybinds: () => this.keybinds,
    slotActionName: (slot) => {
      const ability = this.abilityForSlot(slot);
      if (ability) return abilityDisplayName(ability.def);
      const item = this.itemForSlot(slot);
      return item ? itemDisplayName(item) : null;
    },
    refreshKeybindLabels: () => this.refreshKeybindLabels(),
    buildDropdown: (options, current, onChange, placeholder, a11y) =>
      this.buildDropdown(options, current, onChange, placeholder, a11y),
    setDropdownValue: (root, value) => this.setDropdownValue(root, value),
    focusFirstInteractive: (root, preferredSelector) =>
      this.focusManager.focusFirst(root, preferredSelector),
    closeOthers: () => this.closeOtherWindows('#options-menu'),
    hideTooltip: () => this.hideTooltip(),
    ...this.windowFocus('#options-menu'),
    // The gold log tint stays Hud-side so the painter carries no color literal.
    log: (message) => this.log(message, '#ffd100'),
    resetChatWindow: () => this.resetChatWindow(),
    resetUnitFrames: () => this.resetUnitFrames(),
    getChatTimestamps: () => this.chatTimestamps,
    setChatTimestamps: (on) => {
      this.chatTimestamps = on;
      localStorage.setItem('chatTimestamps', on ? '1' : '0');
    },
    getChatClock: () => this.chatClock,
    setChatClock: (clock) => {
      this.chatClock = clock;
      localStorage.setItem('chatClock', clock);
    },
  });
  // Leaderboard window painter (leaderboard_view.ts async-free core + leaderboard_
  // window.ts painter). It owns the page index + focus opener and the one
  // consumed-new signature: it awaits the paged leaderboard() and renders the page
  // (or the loading / empty / error state). All closures are lazy.
  private readonly leaderboardWindow = new LeaderboardWindow({
    root: () => $('#leaderboard-window'),
    world: () => this.sim,
    closeOthers: () => this.closeOtherWindows('#leaderboard-window'),
    ...this.windowFocus('#leaderboard-window'),
    onVisibilityChange: () => this.syncAnyWindowOpenState(),
    showDevBadges: () => this.optionsHooks?.settings.get('showDevBadges') ?? true,
  });
  // Daily rewards window painter. It owns the async rewards reads, spin action,
  // focus opener, and a low-rate refresh while open. All closures are lazy.
  private readonly dailyRewardsWindow = new DailyRewardsWindow({
    root: () => $('#daily-rewards-window'),
    world: () => this.sim,
    closeOthers: () => this.closeOtherWindows('#daily-rewards-window'),
    onStatus: (status) => this.applyDailyRewardsLauncherStatus(status),
    onWalletConnect: () => {
      window.dispatchEvent(new CustomEvent('woc:wallet-verify'));
    },
    storeEnabled: () => this.claudiumHooks !== null,
    storeSnapshot: async () => {
      const snapshot = await this.claudiumHooks?.storeSnapshot();
      if (!snapshot) return { available: false, balance: null, items: [] };
      this.setClaudiumLauncherBalance(snapshot.balance);
      return {
        available: snapshot.available,
        balance: snapshot.balance,
        items: [...snapshot.storeItems],
      };
    },
    spendStoreItem: async (itemId, kind, expectedCostClaudium) => {
      const result = await this.claudiumHooks?.spend(itemId, kind, expectedCostClaudium);
      if (result?.balance !== null && result?.balance !== undefined) {
        this.setClaudiumLauncherBalance(result.balance);
      }
      return (
        result ?? {
          granted: false,
          balance: null,
          costClaudium: null,
          reason: 'unavailable',
        }
      );
    },
    openClaudium: () => this.toggleClaudium(),
    confirmDialog: (title, body, okText, cancelText, onOk) =>
      this.confirmDialog(title, body, okText, cancelText, onOk),
    ...this.windowFocus('#daily-rewards-window'),
    onVisibilityChange: () => this.syncAnyWindowOpenState(),
  });
  // Claudium (server-authoritative soft currency) window. main.ts injects the
  // economy hooks when online via attachClaudium; until then (and offline) the
  // hooks are null and the window renders its clean disabled/empty state. The
  // window computes NOTHING; every number rides in through these hooks.
  private claudiumHooks: ClaudiumHooks | null = null;
  private claudiumLauncherBalance: number | null = null;
  private claudiumLauncherBalancePending = false;
  private claudiumLauncherBalanceLastMs = 0;
  private claudiumLauncherBalanceSeq = 0;
  private readonly claudiumWindow = new ClaudiumWindow({
    root: () => $('#claudium-window'),
    closeOthers: () => this.closeOtherWindows('#claudium-window'),
    snapshot: async () => {
      const snapshot =
        (await this.claudiumHooks?.snapshot()) ??
        ({
          balance: null,
          skus: [],
          nativeRails: { sol: false, woc: false },
        } satisfies ClaudiumSnapshot);
      this.setClaudiumLauncherBalance(snapshot.balance);
      return snapshot;
    },
    buy: (rail, sku) => this.claudiumHooks?.buy(rail, sku) ?? Promise.resolve(),
    ...this.windowFocus('#claudium-window'),
    onVisibilityChange: () => this.syncAnyWindowOpenState(),
  });
  // Spellbook window painter (spellbook_view.ts core + spellbook_window.ts painter).
  // The window renders ability rows (not item rows), so it composes no presentation
  // bag; it reads the class kit + bar state from the world and routes the hotbar /
  // drag / tooltip seams through these lazy closures. refreshHotbarControls keeps
  // the +/- toggles in sync from hud.update() while the window is open.
  private readonly spellbookWindow = new SpellbookWindow({
    root: () => $('#spellbook'),
    world: () => this.sim,
    closeOthers: () => this.closeOtherWindows('#spellbook'),
    ...this.windowFocus('#spellbook'),
    hideTooltip: () => this.hideTooltip(),
    attachTooltip: (el, html) => this.attachTooltip(el, html),
    abilitySummary: (known) =>
      describeAbilitySummary(
        known,
        this.sim.player.resourceType,
        playerSpellHasteFrac(this.sim.player),
      ),
    abilityTooltip: (known) => this.abilityTooltip(known),
    barAbilityIds: () =>
      this.hotbarActions.flatMap((a) => (a && a.type === 'ability' ? [a.id] : [])),
    // Index 0 = barSlot 1 (hotbarActions' own index = barSlot-1 convention), used
    // to derive each row's mobile action-ring page (Phase 4). Non-ability slots
    // (empty or an item) map to null, never mistaken for an ability id.
    abilityIdByBarSlot: () =>
      this.hotbarActions.map((a) => (a && a.type === 'ability' ? a.id : null)),
    hasFreeSlot: () => this.firstEmptyHotbarIndex() !== -1,
    addToBar: (id) => this.addAbilityToHotbar(id),
    removeFromBar: (id) => this.removeAbilityFromHotbar(id),
    hasFormBars: () => this.classHasFormBars(),
    resetFormBar: () => this.resetActiveFormBarToDefault(),
    setDragAction: (action) => {
      this.dragAction = action ? { action, sourceIndex: null } : null;
    },
    clearActionDropTargets: () => this.clearActionDropTargets(),
  });
  // Quest-log window painter (questlog_view.ts core + questlog_window.ts painter).
  // It composes the presentation bag (icon/money/tooltip) for the reward row and
  // owns the selected quest id (Hud's quest-share command reads it back); the
  // abandon / chat-link / confirm seams route through these lazy closures.
  private readonly questlogWindow = new QuestLogWindow({
    ...this.presentationBag,
    root: () => $('#quest-log-window'),
    world: () => this.sim,
    closeOthers: () => this.closeOtherWindows('#quest-log-window'),
    ...this.windowFocus('#quest-log-window'),
    hideTooltip: () => this.hideTooltip(),
    focusFirstInteractive: (root, preferredSelector) =>
      this.focusManager.focusFirst(root, preferredSelector),
    onVisibilityChange: () => this.syncAnyWindowOpenState(),
    confirmDialog: (title, body, okText, cancelText, onOk) =>
      this.confirmDialog(title, body, okText, cancelText, onOk),
    insertQuestChatLink: (questId) => this.insertQuestChatLink(questId),
  });

  private drawPlayerFramePortrait(): void {
    this.portraits.drawClass(
      $('#pf-portrait') as unknown as HTMLCanvasElement,
      this.sim.cfg.playerClass,
      this.sim.player.skin ?? 0,
    );
  }

  // Redraw the target portrait canvas. Called by the unit_frame painter's repaint
  // gate ONLY when the target identity changes (or after invalidatePortrait), never
  // per frame, and reads the subject set just before that frame's paint() call. A
  // player target shows its real 3D class headshot (rendered locally from the synced
  // class + skin); any other entity shows its faction/family crest.
  private drawTargetPortrait(): void {
    const target = this.targetPortraitSubject;
    if (!target) return;
    if (target.kind === 'player') {
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

  private claudiumLauncherHtml(): string {
    if (!this.claudiumHooks) return '';
    this.refreshClaudiumLauncherBalance();
    const label =
      this.claudiumLauncherBalance === null
        ? '--'
        : formatNumber(this.claudiumLauncherBalance, { maximumFractionDigits: 0 });
    const aria = t('hudChrome.claudium.open');
    return `<button type="button" class="claudium-launcher" data-claudium-launcher title="${esc(aria)}" aria-label="${esc(aria)}"><img class="claudium-coin" src="/claudium/icons/claudium_coin_64.webp" alt=""><span class="claudium-launcher-balance">${esc(label)}</span></button>`;
  }

  private setClaudiumLauncherBalance(balance: number | null): void {
    this.claudiumLauncherBalance = balance;
    this.claudiumLauncherBalanceLastMs = Date.now();
  }

  private refreshClaudiumLauncherBalance(force = false): void {
    if (!this.claudiumHooks || this.claudiumLauncherBalancePending) return;
    const now = Date.now();
    if (!force && now - this.claudiumLauncherBalanceLastMs < 30_000) return;
    this.claudiumLauncherBalancePending = true;
    const seq = ++this.claudiumLauncherBalanceSeq;
    void this.claudiumHooks
      .balance()
      .then((balance) => {
        if (seq !== this.claudiumLauncherBalanceSeq) return;
        this.setClaudiumLauncherBalance(balance);
        if ($('#bags').style.display !== 'none') this.renderBags();
      })
      .catch(() => {
        if (seq !== this.claudiumLauncherBalanceSeq) return;
        this.setClaudiumLauncherBalance(null);
      })
      .finally(() => {
        if (seq === this.claudiumLauncherBalanceSeq) {
          this.claudiumLauncherBalancePending = false;
        }
      });
  }

  // One-line aura effect summary HTML for the buff/debuff tooltip: the pure descriptor
  // (aura_effect.ts) resolved to localized, esc'd text. Empty when the aura has no
  // descriptor. Injected into the auras view so the i18n-free core never calls t().
  private auraEffectTooltipHtml(a: AuraEffectInput & { id?: string }): string {
    const effect = auraEffectDescriptor(a);
    if (!effect) return '';
    const values: Record<string, string> = {};
    if (effect.nums) {
      for (const [k, n] of Object.entries(effect.nums)) {
        values[k] = formatNumber(n, { maximumFractionDigits: 0 });
      }
    }
    // Resolve the {school} placeholder in the dot/absorb/thorns summaries. Prefer
    // the SOURCE ability's school: it is authoritative and always present
    // client-side, unlike the aura's own school, which the ability-tooltip call
    // site omits (only kind+value) and the online wire mirror drops. Without this
    // a magic reflect like Lightning Shield read a raw "{school}" (ability tooltip)
    // or the wrong "Physical" (online buff frame) instead of its real school.
    const school = (a.id ? ABILITIES[a.id]?.school : undefined) ?? effect.school;
    if (school) {
      values.school = t(`hudChrome.auraEffect.school.${school}` as TranslationKey);
    }
    return `<div class="tt-effect">${esc(t(effect.key as TranslationKey, values))}</div>`;
  }

  attachTooltip(el: HTMLElement, html: () => string): void {
    let touchTimer: number | undefined;
    // tooltip box size, measured once in showAt (right after the content is set)
    // and reused by every mousemove: the content cannot change between showAt
    // calls, so re-reading offsetWidth/Height per mousemove only forced a reflow
    let ttW = 0;
    let ttH = 0;
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
      const size = this.paintTooltipAt(html(), x, y);
      // cache the measured box for the mousemove clamp below (no forced reflow)
      ttW = size.w;
      ttH = size.h;
    };
    const showNearElement = () => {
      const rect = el.getBoundingClientRect();
      showAt(rect.right, rect.top + rect.height / 2, 'focus');
    };
    // A mouse click or a tap focuses the button as a side effect (the browser
    // moves focus to whatever was pressed), which used to fire showNearElement
    // on EVERY action-bar press, not just real keyboard (Tab) navigation. Flag
    // the pointer press so the very next focusin it causes is skipped; Tab
    // never fires pointerdown first, so keyboard users still get the tooltip.
    let pointerFocusPending = false;
    el.addEventListener('pointerdown', () => {
      pointerFocusPending = true;
    });
    el.addEventListener('focusin', () => {
      if (pointerFocusPending) {
        pointerFocusPending = false;
        return;
      }
      showNearElement();
    });
    el.addEventListener('mouseenter', () => {
      if (mobile()) return;
      const rect = el.getBoundingClientRect();
      showAt(rect.right, rect.top + rect.height / 2, 'mouse');
    });
    el.addEventListener('mousemove', (e) => {
      if (mobile()) return;
      const z = getUiScale();
      // reuse the box size measured in showAt: same content, no forced reflow
      const tw = ttW,
        th = ttH;
      this.tooltipEl.style.left = `${Math.min(window.innerWidth / z - tw - 8, e.clientX / z + 14)}px`;
      this.tooltipEl.style.top = `${Math.max(8, e.clientY / z - th - 10)}px`;
    });
    el.addEventListener('mouseleave', () => {
      clearTouchTimer();
      this.tooltipEl.style.display = 'none';
    });
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
    el.addEventListener('pointerup', () => {
      clearTouchTimer();
      // Safari desktop never focuses a button on click, so pointerdown's flag
      // above would otherwise never get consumed by a focusin and could wrongly
      // swallow a later, real keyboard-focus tooltip; drop it once the press ends.
      pointerFocusPending = false;
    });
    el.addEventListener('pointercancel', () => {
      clearTouchTimer();
      pointerFocusPending = false;
    });
  }

  private bindMobileFrameLongPress(
    el: HTMLElement,
    onLongPress: (x: number, y: number) => void,
    opts: { ignoreSelector?: string } = {},
  ): void {
    let timer: number | undefined;
    let downId: number | null = null;
    let downX = 0;
    let downY = 0;
    let suppressUntil = 0;
    const clear = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      downId = null;
    };
    el.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType !== 'touch' || !this.isMobileLayout()) return;
      const target = ev.target as HTMLElement | null;
      if (opts.ignoreSelector && target?.closest(opts.ignoreSelector)) return;
      clear();
      downId = ev.pointerId;
      downX = ev.clientX;
      downY = ev.clientY;
      timer = window.setTimeout(() => {
        timer = undefined;
        suppressUntil = Date.now() + CLICK_SUPPRESS_MS;
        onLongPress(downX, downY);
      }, MOBILE_CONTEXT_LONG_PRESS_MS);
    });
    el.addEventListener('pointermove', (ev) => {
      if (ev.pointerType !== 'touch' || ev.pointerId !== downId) return;
      if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > TAP_SLOP_PX) clear();
    });
    el.addEventListener('pointerup', (ev) => {
      if (ev.pointerId === downId) clear();
    });
    el.addEventListener('pointercancel', (ev) => {
      if (ev.pointerId === downId) clear();
    });
    el.addEventListener(
      'click',
      (ev) => {
        if (Date.now() > suppressUntil) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
      },
      true,
    );
    el.addEventListener(
      'contextmenu',
      (ev) => {
        if (!this.isMobileLayout() || Date.now() > suppressUntil) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
      },
      true,
    );
  }

  hideTooltip(): void {
    this.tooltipEl.style.display = 'none';
    this.tooltipEl.classList.remove('mob-tooltip');
  }

  private showRaidLockoutTooltip(): void {
    const el = this.raidLockoutEl;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    this.paintTooltipAt(this.raidLockoutPanelView(), rect.right, rect.top + rect.height / 2);
  }

  // Paints the shared #tooltip box at a screen point, used by attachTooltip's
  // element-hover showAt (item/ability/stat tooltips). Drops the mob-tooltip
  // size modifier so a leftover world-hover tooltip never leaks its bigger
  // sizing onto one of these. Returns the measured author-space box size so the
  // caller can cache it (attachTooltip's mousemove clamp reuses it instead of
  // re-reading offsetWidth/Height, which would force a reflow per mousemove).
  private paintTooltipAt(html: string, x: number, y: number): { w: number; h: number } {
    this.tooltipEl.classList.remove('mob-tooltip');
    this.tooltipEl.innerHTML = html;
    this.tooltipEl.style.display = 'block';
    // offsetWidth/Height are author-space (zoom-immune) layout sizes, but x/y
    // arrive in visual (zoomed) space, so map x/y into author space (÷ scale)
    // before clamping against the author-space tooltip box + viewport.
    const z = getUiScale();
    const tw = this.tooltipEl.offsetWidth,
      th = this.tooltipEl.offsetHeight;
    this.tooltipEl.style.left = `${Math.max(8, Math.min(window.innerWidth / z - tw - 8, x / z + 14))}px`;
    this.tooltipEl.style.top = `${Math.max(8, y / z - th - 10)}px`;
    return { w: tw, h: th };
  }

  // Anchors the mob-hover tooltip to a fixed viewport corner instead of the
  // cursor. Desktop keeps the WoW default bottom-right slot; touch moves to the
  // left of the minimap so selected enemy info does not cover the bottom action
  // controls.
  // Deliberately NOT tied to the player frame: that frame is player-movable
  // (MovableFrame), and an anchor riding it wanders wherever the frame was dragged.
  private paintMobTooltipBottomRight(html: string): void {
    this.tooltipEl.classList.add('mob-tooltip');
    this.tooltipEl.innerHTML = html;
    this.tooltipEl.style.display = 'block';
    const z = getUiScale();
    const tw = this.tooltipEl.offsetWidth,
      th = this.tooltipEl.offsetHeight;
    const isMobileTouch = document.body.classList.contains('mobile-touch');
    const minimapRect = isMobileTouch
      ? (document.getElementById('minimap-wrap')?.getBoundingClientRect() ?? null)
      : null;
    const left =
      minimapRect !== null
        ? Math.max(
            MOB_TOOLTIP_MOBILE_EDGE_GAP,
            minimapRect.left / z - tw - MOB_TOOLTIP_MOBILE_MINIMAP_GAP,
          )
        : Math.max(8, window.innerWidth / z - tw - MOB_TOOLTIP_MARGIN_RIGHT);
    const top =
      minimapRect !== null
        ? Math.max(MOB_TOOLTIP_MOBILE_EDGE_GAP, minimapRect.top / z)
        : Math.max(8, window.innerHeight / z - th - MOB_TOOLTIP_MARGIN_BOTTOM);
    this.tooltipEl.style.left = `${left}px`;
    this.tooltipEl.style.top = `${top}px`;
  }

  // Shows the WoW-style mouseover tooltip (name / level / creature type) for a
  // mob hovered in the 3D world. Called every frame main.ts's updateHoverCursor
  // finds a hovered mob; gated on a small key (not just the id) so re-hovering the
  // same mob each frame does not rebuild the HTML, yet a mid-hover change that
  // moves the rendered model (the mob aggros so hostile flips, the mob or the
  // viewer dings a level so the con-color shifts) still repaints. Colored by the
  // tooltip's own classic con spread (mobTooltipConColor), deliberately independent
  // of the overhead nameplate bands (mobNameColor). Shown at a fixed spot (the
  // bottom-right corner, see paintMobTooltipBottomRight) rather than following the cursor.
  showMobHoverTooltip(entity: Entity, pvpOpponents: ReadonlySet<number>): void {
    // Questie-style quest lines: the objectives this mob advances, with live
    // counts. They ride the rebuild key so a kill mid-hover repaints 3/8 -> 4/8.
    const mobQuests = questObjectivesForMob(this.sim.questLog, entity.templateId);
    const questKey = mobQuests
      .map((q) => `${q.questId}#${q.objectiveIndex}:${q.current}/${q.total}`)
      .join(',');
    const key = `${entity.id}:${entity.level}:${entity.hostile ? 1 : 0}:${this.sim.player.level}:${questKey}`;
    if (key === this.lastMobTooltipId) return;
    this.lastMobTooltipId = key;
    const template = MOBS[entity.templateId];
    if (!template) {
      this.hideTooltip();
      return;
    }
    const diff = entity.level - this.sim.player.level;
    const friendlyPet = isFriendlyPet(entity, this.sim.entities, (p) => pvpOpponents.has(p.id));
    const familyLabel =
      template.family === 'demon'
        ? t('hudChrome.mobTooltip.familyDemon')
        : t(`guide.family.${template.family}.name` as TranslationKey);
    const model: MobTooltipModel = {
      name: mobDisplayName(entity.templateId),
      level: entity.level,
      familyLabel,
      color: mobTooltipConColor(diff, entity.dead, friendlyPet),
      hostile: entity.hostile,
      quests: mobQuests.map((q) => ({
        title: questTitle(q.questId),
        progress: this.questProgressText(
          questObjectiveLabel(q.questId, q.objectiveIndex),
          q.current,
          q.total,
        ),
      })),
    };
    this.paintMobTooltipBottomRight(mobTooltipHtml(model, MOB_TOOLTIP_VIEW_DEPS));
  }

  // Clears the world-hover mob tooltip; a no-op if none is showing, so main.ts
  // can call it unconditionally every frame nothing (or a non-mob) is hovered.
  clearMobHoverTooltip(): void {
    if (this.lastMobTooltipId === null) return;
    this.lastMobTooltipId = null;
    this.hideTooltip();
  }

  private itemTooltip(item: ItemDef, compare = true): string {
    const qColor = QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff';
    let html = `<div class="tt-title" style="color:${qColor}">${esc(itemDisplayName(item))}</div>`;
    // Quality/kind line, e.g. "Epic Armor". Heroic upgraded variants append a gold
    // "[HEROIC]" tag here (never in the name) so the drop reads "Epic Armor [HEROIC]".
    let qualityKindHtml = esc(
      t('itemUi.tooltip.qualityKind', {
        quality: itemQualityLabel(item.quality),
        kind: itemKindLabel(item.kind),
      }),
    );
    if (item.heroicOf) {
      qualityKindHtml += ` <span style="color:#e5cc80">${esc(t('hudChrome.itemHeroicTag'))}</span>`;
    }
    html += `<div class="tt-sub">${qualityKindHtml}</div>`;
    if (item.slot) {
      // Classic layout: slot name on the left, armor subtype (Cloth/Leather/Mail)
      // right-aligned on the same line so it is clear which classes the gear suits.
      const armorTypeKey = itemArmorTypeLabelKey(item);
      if (armorTypeKey) {
        // Red armor type = the viewing player's class cannot wear this armor weight
        // (e.g. a mage hovering Mail), so they know it is not for them at a glance.
        const badClass = canEquipItem(this.sim.cfg.playerClass, item) ? '' : ' tt-armor-bad';
        html += `<div class="tt-sub tt-row"><span>${esc(itemSlotName(item.slot))}</span><span class="tt-armor${badClass}">${esc(t(armorTypeKey))}</span></div>`;
      } else {
        html += `<div class="tt-sub">${esc(itemSlotName(item.slot))}</div>`;
      }
    }
    // Optional item-level readout (off by default; src/sim/item_level.ts derives it
    // from where the item drops). Read live, so toggling it takes effect on the next
    // hover. Combat gear only: sourceless items (vendor/starter) have no level,
    // and non-combat items never get an item-level line.
    if (isItemLevelEligible(item) && this.optionsHooks?.settings.get('showItemLevel')) {
      const level = itemLevel(item);
      if (level !== undefined) {
        html += `<div class="tt-stat" style="color:#ffd100">${esc(
          t('hudChrome.options.itemLevelLine', { level: itemNumber(level) }),
        )}</div>`;
        html += `<div class="tt-sub">${esc(
          t('hudChrome.options.itemScoreLine', { score: itemNumber(itemScore(item), 1) }),
        )}</div>`;
      }
    }
    // Bound-to-owner marker (marks and other soulbound tokens): shown like the
    // classic "Soulbound" line so a player can see it cannot be traded or destroyed.
    if (item.soulbound) {
      html += `<div class="tt-sub" style="color:#ffd100">${esc(t('hudChrome.itemSoulbound'))}</div>`;
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
    const warfareRating = Math.min(item.pvpOffenseRating ?? 0, item.pvpDefenseRating ?? 0);
    if (warfareRating > 0) {
      html += `<div class="tt-green">${esc(
        t('itemUi.tooltip.stat', {
          value: itemNumber(warfareRating),
          stat: t(statNameKey('warfare') as TranslationKey),
        }),
      )}</div>`;
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
    if (item.kind === 'bag' && item.bagSlots)
      html += `<div class="tt-stat">${esc(t('itemUi.tooltip.bagSlots', { slots: itemNumber(item.bagSlots) }))}</div>`;
    if (item.requiredClass && !armorTypeForItem(item) && !weaponArchetypeForItem(item)) {
      html += `<div class="tt-sub">${esc(t('itemUi.tooltip.classes', { classes: item.requiredClass.map(classDisplayName).join(', ') }))}</div>`;
    }
    // Classic "Requires Level N" line for equippable gear gated above level 1.
    // Red when the viewer is below the requirement (cannot equip yet), otherwise
    // a normal sub line. Level math/data lives in the pure sim leaf.
    const req = requiredLevelFor(item);
    if ((item.kind === 'weapon' || item.kind === 'armor') && req > 1) {
      const meets = this.sim.player.level >= req;
      html += `<div class="${meets ? 'tt-sub' : 'tt-red'}">${esc(t('hudChrome.itemTooltip.requiresLevel', { level: itemNumber(req) }))}</div>`;
    }
    html += this.itemProcBlock(item);
    html += this.itemSetBlock(item);
    if (item.sellValue > 0)
      html += `<div class="tt-sub">${esc(t('itemUi.tooltip.sellPrice', { money: formatLocalizedMoney(item.sellValue) }))}</div>`;
    if (compare) html += this.itemCompareBlock(item);
    return html;
  }

  // Legendary "chance on action" procs: one green trigger line per proc, each
  // wrapping its joined effect fragments. Reads ItemDef.weaponProcs through the
  // pure weapon_proc_view core so the derived numbers stay unit-tested.
  private itemProcBlock(item: ItemDef): string {
    const lines = weaponProcLines(item.kind === 'weapon' ? item.weaponProcs : undefined);
    if (!lines.length) return '';
    let html = '';
    for (const line of lines) {
      const effect = line.effects.map((e) => this.procEffectText(e)).join(' ');
      const triggerKey =
        // onMeleeHit is the legacy key id; its English reads the generic "Chance on
        // hit", correct for a weaponHit proc that fires on melee AND hunter ranged.
        line.trigger === 'weaponHit'
          ? 'hudChrome.itemProc.onMeleeHit'
          : line.trigger === 'spellDamage'
            ? 'hudChrome.itemProc.onSpellDamage'
            : 'hudChrome.itemProc.onHeal';
      html += `<div class="tt-green">${esc(
        t(triggerKey, {
          chance: formatNumber(line.chancePct, { maximumFractionDigits: 0 }),
          effect,
        }),
      )}</div>`;
    }
    return html;
  }

  // One effect fragment (chain arc / attack slow / dot / hot) as localized text.
  private procEffectText(e: WeaponProcEffectDesc): string {
    const n = (v: number | undefined): string => formatNumber(v ?? 0, { maximumFractionDigits: 0 });
    switch (e.kind) {
      case 'chainArc':
        return t('hudChrome.itemProc.chainArc', {
          school: e.school ?? '',
          name: e.name ?? '',
          damage: n(e.damage),
          jumps: n(e.jumps),
        });
      case 'attackSlow':
        return t('hudChrome.itemProc.attackSlow', { pct: n(e.slowPct), duration: n(e.duration) });
      case 'dot':
        return t('hudChrome.itemProc.dot', {
          name: e.name ?? '',
          school: e.school ?? '',
          total: n(e.total),
          duration: n(e.duration),
        });
      case 'hot':
        return t('hudChrome.itemProc.hot', {
          name: e.name ?? '',
          total: n(e.total),
          duration: n(e.duration),
        });
    }
  }

  // How many equipped pieces belong to the given set (read from IWorld.equipment
  // so it is identical offline and online).
  private equippedSetPieces(setId: string): number {
    let n = 0;
    for (const equippedId of Object.values(this.sim.equipment)) {
      if (equippedId && ITEMS[equippedId]?.set === setId) n += 1;
    }
    return n;
  }

  // Classic tier-set block: the set name with the live (have/total) piece count,
  // then each bonus tier - lit when its threshold is met, greyed otherwise. Set
  // name and bonus text localize through entity_i18n (English source in
  // content/item_sets.ts).
  private itemSetBlock(item: ItemDef): string {
    if (!item.set) return '';
    const model = itemSetTooltipModel({
      itemSetId: item.set,
      equippedPieces: this.equippedSetPieces(item.set),
      itemSetMembers: itemSetMemberCounts(),
    });
    if (!model) return '';
    const name = tEntity({ kind: 'itemSet', id: model.setId, field: 'name' });
    let html = `<div class="tt-set-name">${esc(t('hudChrome.itemSet.header', { name, have: formatNumber(model.equippedPieces, { maximumFractionDigits: 0 }), total: formatNumber(model.totalPieces, { maximumFractionDigits: 0 }) }))}</div>`;
    for (const tier of model.bonusTiers) {
      const field = tier.pieces === 2 ? 'bonus2' : tier.pieces === 3 ? 'bonus3' : 'bonus4';
      const text = tEntity({ kind: 'itemSet', id: model.setId, field });
      html += `<div class="tt-set-bonus${tier.active ? ' active' : ''}">${esc(t('hudChrome.itemSet.bonusLine', { pieces: formatNumber(tier.pieces, { maximumFractionDigits: 0 }), bonus: text }))}</div>`;
    }
    return html;
  }

  // Classic-style item comparison: when hovering an equippable item, append the
  // item currently worn in that slot plus the stat change you'd see if you
  // swapped to it (green = gain, red = loss). Reads IWorld.equipment, so it
  // works identically offline and online.
  private itemCompareBlock(item: ItemDef): string {
    if (!item.slot) return '';
    // A hovered ring compares against BOTH worn rings (classic behavior); every
    // other slot kind is its own single equipment key.
    const slots: readonly EquipSlot[] = item.slot === 'ring' ? ['ring1', 'ring2'] : [item.slot];
    return slots.map((slot) => this.itemCompareBlockForSlot(item, slot)).join('');
  }

  private itemCompareBlockForSlot(item: ItemDef, slot: EquipSlot): string {
    const equippedId = this.sim.equipment[slot];
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
        return `<div class="${cls}">${sign}${magnitude} ${esc(
          t(statNameKey(d.stat) as TranslationKey),
        )}</div>`;
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
    // Equipped items + active auras feed the upstream "Made up of:" source
    // breakdown; names resolve the same way the buff bar resolves them.
    const gear: GearStatSource[] = [];
    for (const id of Object.values(sim.equipment)) {
      const item = id ? ITEMS[id] : null;
      if (!item || (!item.stats && !item.spellPower)) continue;
      gear.push({ name: itemDisplayName(item), stats: item.stats, spellPower: item.spellPower });
    }
    const buffs: BuffStatSource[] = p.auras.map((a) => ({
      kind: a.kind,
      value: a.value,
      name: ABILITIES[a.id]
        ? abilityDisplayName(ABILITIES[a.id])
        : auraDisplayNameFromSource(a.name),
    }));
    return buildStatTooltip(stat, {
      cls: sim.cfg.playerClass,
      stats: p.stats,
      level: p.level,
      attackPower: p.attackPower,
      spellPower: p.spellPower,
      critChance: p.critChance,
      dodgeChance: p.dodgeChance,
      critRating: p.critRating,
      hasteRating: p.hasteRating,
      dps: weaponDps(wpn?.weapon, p.attackPower),
      gear,
      buffs,
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

  // The {captureFocus, restoreFocus} pair for a painter window. The bridge logic
  // (open the trap on capture, release-and-return on close, leaving an in-window
  // refocus alone) lives in ./window_focus, so hud.ts and the keyboard E2E share
  // ONE implementation; this thin wrapper binds it to the shared focus manager
  // and the window root. Escape is handled by the existing unified
  // dispatcher (main.ts game input -> hud.closeAll()), not by the trap.
  private windowFocus(rootSel: string): {
    captureFocus: () => HTMLElement | null;
    restoreFocus: (target: HTMLElement | null) => void;
  } {
    return makeWindowFocus(this.focusManager, () => $(rootSel));
  }

  private refreshLocalizedDynamicUi(): void {
    this.syncDailyRewardsSurfaceLabels();
    this.refreshKeybindLabels();
    this.updateQuestTracker();
    this.updateDelveTracker();
    // The keyed-pool party rows reuse their DOM, so a rebuild never re-runs t() on
    // their badge tooltips / leave label; re-localize them in place on a switch.
    this.partyFramesPainter.relocalize();
    // The unit-frame move/lock buttons' labels are set once at construction + on
    // toggle, so re-localize them in place on a language switch (same reason as
    // the party rows above).
    this.targetFrameMover?.relocalize();
    this.playerFrameMover?.relocalize();
    if (this.questlogWindow.isOpen) this.questlogWindow.render();
    if ($('#bags').style.display !== 'none') this.renderBags();
    if (this.openVendorNpcId !== null && $('#vendor-window').style.display === 'block')
      this.renderVendor();
    if (this.openHeroicVendorNpcId !== null && $('#vendor-window').style.display === 'block')
      this.renderHeroicVendor();
    if (this.marketWindow.isOpen) this.marketWindow.render();
    if (this.bankWindow.isOpen) this.bankWindow.render();
    if (this.deedsWindow.isOpen) this.deedsWindow.render();
    // The deed tracker's texts re-localize on its next elided paint; run one
    // now so the strip never shows a stale language for up to a slow tick.
    this.updateDeedTracker();
    this.charWindow.renderIfOpen();
    // The arena window's render-skip signature is text-independent (offline sentinel or a
    // JSON of ids/numbers), so a language switch alone never moves it; relocalize() forces
    // one rebuild with fresh t() (self-gated on isOpen).
    this.arenaWindow.relocalize();
    // Same text-independent-sig contract for the Vale Cup surfaces: clear the
    // sigs so the next render/update rebuilds with fresh t().
    this.valeCupWindow.relocalize();
    this.vcupBetting.relocalize();
    this.vcupIndicator.relocalize();
    this.vcupMatchHud.relocalize();
    this.vcupBriefing.relocalize();
    this.vcupCharge.relocalize();
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
    const p = this.sim.player;
    const scaling: AbilityScaling = {
      spellPower: p.spellPower,
      rangedPower: p.rangedPower,
      attackPower: p.attackPower,
    };
    const damageText = abilityEffectText(res, scaling);
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
    const castLine = [abilityCastLine(res, playerSpellHasteFrac(this.sim.player))];
    // Use the RESOLVED cooldown (res.cooldown), not res.def.cooldown, so talents that
    // reduce cooldown (Improved Mortal Strike, Barrage, Improved Fire Blast, ...) show
    // their effect in the tooltip.
    if (res.cooldown > 0)
      castLine.push(
        t('abilityUi.tooltip.cooldownSeconds', { seconds: formatAbilityNumber(res.cooldown) }),
      );
    html += `<div class="tt-stat">${castLine.map(esc).join(' &nbsp; ')}</div>`;
    html += `<div class="tt-desc">${esc(abilityDisplayDescription(res, damageText, scaling))}</div>`;
    // Resolved buff/aura effect line(s). Reads the RESOLVED effect value, so a buff's
    // tooltip reflects rank AND talents that strengthen it (Improved Devotion Aura /
    // Aspect of the Hawk / Fortitude via buffPct) - which the static description can't.
    for (const eff of res.effects) {
      if (eff.type === 'selfBuff' || eff.type === 'buffTarget') {
        // Pass the ability id so the effect line can resolve its damage school
        // (the {school} placeholder in the thorns/dot/absorb summaries).
        html += this.auraEffectTooltipHtml({ kind: eff.kind, value: eff.value, id: a.id });
      }
    }
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
    // Vale Cup sport kit: keyed off the IWorld snapshot (cupInfo.match with me
    // on a roster), NOT off meta.known contents, because the snapshot and the
    // wireRev-gated known swap ride the same server flush, so the bar and the
    // kit flip together offline AND online. The form deliberately holds through
    // phase 'over': the sim restores the class kit in the SAME tick it nulls
    // the match (teardownCupMatch), so flipping to 'normal' any earlier would
    // load the saved class bar while known is still the sport kit, and
    // syncSlotMap would drop every "unlearned" class ability from it and SAVE
    // the wipe. Checked before the druid/rogue arms: the sport standardize
    // strips forms/stealth on kickoff anyway.
    const cupMatch = this.sim.cupInfo?.match;
    if (cupMatch && cupMatch.team !== null) return 'sport';
    if (this.sim.cfg.playerClass === 'druid') {
      if (this.sim.player.auras.some((a) => a.kind === 'form_bear')) return 'bear';
      if (this.sim.player.auras.some((a) => a.kind === 'form_cat')) {
        if (this.sim.player.auras.some((a) => a.kind === 'stealth')) return 'cat_stealth';
        return 'cat';
      }
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

  // Whether an ability belongs on a given form's default bar. Bear/Wolf bars hold
  // only that form's kit (its `requiresForm` abilities) plus the shift toggles;
  // the caster ('normal') bar excludes form-only abilities so they no longer
  // auto-dump onto it. Stealth pages are intentionally manual: they begin empty
  // and never receive automatic placements.
  private shouldAutoPlaceOnForm(id: string, form: HotbarForm): boolean {
    // The sport bar holds ONLY the sport kit; conversely no sport id may ever
    // auto-place onto (and pollute) a persisted class bar.
    if (form === 'sport') return !!SPORT_ABILITIES[id];
    if (SPORT_ABILITIES[id]) return false;
    if (this.isStealthHotbarForm(form)) return false;
    if (form === 'bear' || form === 'cat') {
      return ABILITIES[id]?.requiresForm === form || Hud.FORM_TOGGLE_IDS.has(id);
    }
    return !ABILITIES[id]?.requiresForm;
  }

  // The known abilities that make up a form's default bar, in class/learn order.
  private formKitAbilityIds(form: HotbarForm): string[] {
    return this.sim.known.map((k) => k.def.id).filter((id) => this.shouldAutoPlaceOnForm(id, form));
  }

  // True only for the druid form bars that seed a form-specific kit. Rogue and
  // Wolf stealth pages take the separate blank/manual path below.
  private isFormKitBar(form: HotbarForm = this.activeHotbarForm): boolean {
    return this.sim.cfg.playerClass === 'druid' && (form === 'bear' || form === 'cat');
  }

  private isStealthHotbarForm(form: HotbarForm = this.activeHotbarForm): boolean {
    return form === 'stealth' || form === 'cat_stealth';
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

  // Versioned separately from the druid form-kit migration. The first blank-page
  // rollout also clears a byte-identical parent clone created by the previous
  // behavior, while leaving every customized stealth layout untouched.
  private stealthBarInitializedKey(form: HotbarForm = this.activeHotbarForm): string {
    return `${this.slotMapKey(form)}_blank_v1`;
  }

  private loadStealthSlotMap(
    parsed: HotbarAction[],
    stored: boolean,
    storedRaw: string | null,
  ): void {
    let initialized = false;
    try {
      initialized = localStorage.getItem(this.stealthBarInitializedKey()) === '1';
    } catch {
      /* storage unavailable */
    }

    let actions = parsed;
    let shouldPersist = !stored;
    if (!initialized) {
      const parentForm: HotbarForm = this.activeHotbarForm === 'cat_stealth' ? 'cat' : 'normal';
      let parentStoredRaw: string | null = null;
      try {
        parentStoredRaw = localStorage.getItem(this.slotMapKey(parentForm));
      } catch {
        /* storage unavailable */
      }
      if (!stored || (storedRaw !== null && storedRaw === parentStoredRaw)) {
        actions = Array.from({ length: Hud.BAR_ABILITY_SLOTS }, () => null);
        shouldPersist = true;
      }
    }

    this.loadedSlotMapFromStorage = true;
    this.hotbarActions = actions;
    this.knownAbilityIdsAtLastSlotSync = null;
    try {
      // Persist first so a failed page write never leaves a success marker that
      // suppresses the next migration attempt.
      if (shouldPersist) localStorage.setItem(this.slotMapKey(), JSON.stringify(actions));
      if (!initialized) localStorage.setItem(this.stealthBarInitializedKey(), '1');
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
      (id) => !!ABILITIES[id] || !!SPORT_ABILITIES[id],
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
    let storedRaw: string | null = null;
    try {
      storedRaw = localStorage.getItem(this.slotMapKey());
      arr = JSON.parse(storedRaw ?? 'null');
      stored = Array.isArray(arr);
    } catch {
      /* corrupt */
    }
    const parsed = parseHotbarActions(
      arr,
      Hud.BAR_ABILITY_SLOTS,
      (id) => !!ABILITIES[id] || !!SPORT_ABILITIES[id],
      (id) => this.isHotbarItemId(id),
    );
    // The Vale Cup sport bar seeds from the sport kit (buildDefaultFormBar over
    // the current known list, which IS the role kit during a match, so Kick /
    // the role moves / Second Wind land in slots 1-4). It must NEVER inherit
    // the class bar via the empty-form fallback below: class abilities are not
    // castable on the pitch. A player's mid-match rearrangement still persists
    // under the dedicated `_sport` storage key.
    if (this.activeHotbarForm === 'sport') {
      if (parsed.every((action) => action === null)) {
        this.hotbarActions = buildDefaultFormBar(
          this.formKitAbilityIds('sport'),
          Hud.BAR_ABILITY_SLOTS,
        );
        this.loadedSlotMapFromStorage = true;
        this.knownAbilityIdsAtLastSlotSync = null;
        return;
      }
      this.loadedSlotMapFromStorage = stored;
      this.hotbarActions = parsed;
      this.knownAbilityIdsAtLastSlotSync = null;
      return;
    }
    if (this.isStealthHotbarForm()) {
      this.loadStealthSlotMap(parsed, stored, storedRaw);
      return;
    }
    // Druid bear/cat bars auto-populate with that form's kit instead of cloning
    // the caster bar; existing characters are migrated once (see seedFormBarIfNeeded).
    if (this.isFormKitBar()) {
      if (this.seedFormBarIfNeeded(parsed)) return;
      this.loadedSlotMapFromStorage = stored;
      this.hotbarActions = parsed;
      this.knownAbilityIdsAtLastSlotSync = null;
      return;
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

  // Rebuild the active bar from its default kit: druid forms get their form kit,
  // caster bars get filtered known abilities, and stealth pages reset to blank.
  // Item shortcuts and manual arrangement are intentionally discarded; it's a reset.
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
    this.spellbookWindow.refreshHotbarControls();
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
    this.clearMobileHotbarDrag();
    this.loadSlotMap();
    this.mobileActionPage = clampMobilePage(this.mobileActionPage);
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
    this.mobileActionPage = clampMobilePage(this.mobileActionPage);
  }

  private actionForSlot(barSlot: number): HotbarAction {
    // barSlot 1..22 (1..11 primary bar, 12..22 secondary bar)
    return this.hotbarActions[barSlot - 1] ?? null;
  }

  abilityForSlot(barSlot: number): ResolvedAbility | null {
    // barSlot 1..22 (1..11 primary bar, 12..22 secondary bar)
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

  // Where a ground-targeted ability should land: the current target's position if
  // one is selected (the usual "cast on that pack" intent), else the caster's own
  // spot for an open-ground cast. The sim clamps this to the ability's range.
  private groundTargetAim(): { x: number; z: number } {
    const me = this.sim.player;
    const tid = me.targetId;
    const t = tid !== null ? this.sim.entities.get(tid) : null;
    if (t && !t.dead && t.id !== me.id) return { x: t.pos.x, z: t.pos.z };
    return { x: me.pos.x, z: me.pos.z };
  }

  // The Vale Cup sport moves are AUTOCAST on press: no ground-target reticle, no
  // point-and-click. Pressing the key fires the move at once toward where the
  // player faces (a kick/boot/slide down the field), so the football controls are
  // press-to-play. The sim still resolves the natural target (sport_pass seeks the
  // selected teammate first; the kicks scale power by the aim's distance, so a
  // facing-length aim is a full-power "empowered" kick).
  private isSportAbilityId(id: string): boolean {
    return id.startsWith('sport_');
  }

  private castSportMove(abilityId: string, range: number): void {
    const me = this.sim.player;
    const r = range > 0 ? range : MELEE_RANGE;
    this.sim.castAbilityAt(abilityId, {
      x: me.pos.x + Math.sin(me.facing) * r,
      z: me.pos.z + Math.cos(me.facing) * r,
    });
  }

  // A direct (non-held) sport cast: a Shoot fired this way (touch / gamepad /
  // mouse click) has no charge, so it uses a medium default power instead of the
  // full-range aim, which would balloon over the bar.
  private castSportTap(abilityId: string, range: number): void {
    this.castSportMove(abilityId, abilityId === 'sport_shoot' ? SHOOT_TAP_CHARGE * range : range);
  }

  // My first sport move (Shoot) while seated in a Vale Cup match, else null. Used
  // so key 1 (the class Attack slot, inert under the harvest truce) casts a real
  // move on the pitch instead of toggling a useless auto-attack.
  private firstSportAbilityId(): string | null {
    // Seated in a match => my known list IS the sport kit (Shoot first). Keyed off
    // cupInfo.match, not the bar form, so it holds the instant the whistle swaps
    // the kit in (the bar-form flip can lag a frame behind).
    if (!this.sim.cupInfo?.match) return null;
    const first = this.sim.known[0];
    return first && this.isSportAbilityId(first.def.id) ? first.def.id : null;
  }

  // The ability a bar slot would cast right now (slot 0 remaps to the first sport
  // move on the pitch). Used to decide whether a slot press charges (shoot).
  private abilityIdForSlot(slot: number): string | null {
    if (slot === 0) return this.firstSportAbilityId();
    return this.abilityForSlot(slot)?.def.id ?? null;
  }

  private shootRangeForSlot(slot: number): number {
    if (slot === 0) return this.sim.known[0]?.def.range ?? MELEE_RANGE;
    return this.abilityForSlot(slot)?.def.range ?? MELEE_RANGE;
  }

  // The held-charge fraction 0..1 (time held / SHOOT_CHARGE_MS).
  private shootChargeFrac(): number {
    return Math.min(1, (performance.now() - this.shootChargeStartMs) / SHOOT_CHARGE_MS);
  }

  // Slot key DOWN: a shoot slot starts CHARGING (hold to build power); every
  // other slot fires immediately (a tap is down + up, so this is the press).
  pressSlot(slot: number): void {
    if (this.abilityIdForSlot(slot) === 'sport_shoot') {
      this.shootChargeSlot = slot;
      this.shootChargeStartMs = performance.now();
      this.updateShootCharge(); // show the meter at 0 this frame
      return;
    }
    this.castSlot(slot);
  }

  // Slot key UP: release a charging shoot at the built power (aim distance encodes
  // the charge). A non-charging slot already fired on press, so this is a no-op.
  releaseSlot(slot: number): void {
    if (this.shootChargeSlot !== slot) return;
    const frac = this.shootChargeFrac();
    const id = this.abilityIdForSlot(slot);
    const range = this.shootRangeForSlot(slot);
    this.shootChargeSlot = null;
    this.updateShootCharge(); // hide the meter this frame
    if (id === 'sport_shoot') {
      this.castSportMove(id, Math.max(1, frac * range));
      this.flashActionSlot(slot);
    }
  }

  // Per-frame: paint the power meter off the pure view core; the core's `cancel`
  // auto-releases if I leave the match or die mid-charge so the meter never sticks.
  private updateShootCharge(): void {
    const charging = this.shootChargeSlot !== null;
    const view = buildVcupChargeView(
      charging,
      !!this.sim.cupInfo?.match,
      this.sim.player.dead,
      // Only read the charge clock while a slot is actually held.
      charging ? this.shootChargeFrac() : 0,
    );
    if (view.cancel) this.shootChargeSlot = null;
    this.vcupCharge.update(view);
  }

  private groundReticleEnabled(): boolean {
    if (document.body.classList.contains('mobile-touch')) return false;
    return this.optionsHooks?.settings.get('groundReticle') ?? true;
  }

  isGroundAimActive(): boolean {
    return this.groundAim.activeAbilityId !== null;
  }

  cancelGroundAim(): boolean {
    if (!this.isGroundAimActive()) return false;
    this.groundAim = cancelGroundAim(this.groundAim);
    this.groundAimPoint = null;
    this.groundAimClamped = false;
    this.renderer.setGroundAimReticle(null);
    return true;
  }

  private beginGroundAim(abilityId: string, slot: number): void {
    this.groundAim = enterGroundAim(this.groundAim, abilityId, slot);
    this.groundAimPoint = null;
  }

  private activeGroundAimAbility(): ResolvedAbility | null {
    const id = this.groundAim.activeAbilityId;
    if (!id) return null;
    return this.sim.known.find((k) => k.def.id === id) ?? null;
  }

  updateGroundAimPoint(rawPoint: AimPoint | null): void {
    if (!this.isGroundAimActive() || !rawPoint) {
      this.groundAimPoint = null;
      this.groundAimClamped = false;
      return;
    }
    const res = this.activeGroundAimAbility();
    if (!res) {
      this.cancelGroundAim();
      return;
    }
    const aim = clampAimToRange(this.sim.player, rawPoint, res.def.range);
    this.groundAimPoint = aim.point;
    this.groundAimClamped = aim.clamped;
  }

  groundAimReticle(): {
    point: AimPoint;
    radius: number;
    school: string;
    clamped: boolean;
  } | null {
    if (!this.isGroundAimActive()) return null;
    const point = this.groundAimPoint;
    if (!point) return null;
    const res = this.activeGroundAimAbility();
    if (!res) return null;
    return {
      point,
      radius: abilityAoeRadius(res),
      school: res.def.school,
      clamped: this.groundAimClamped,
    };
  }

  commitGroundAimAt(rawPoint: AimPoint | null = this.groundAimPoint): boolean {
    if (!this.isGroundAimActive()) return false;
    const res = this.activeGroundAimAbility();
    const abilityId = this.groundAim.activeAbilityId;
    if (!res || !abilityId) {
      this.cancelGroundAim();
      return true;
    }
    const point = rawPoint
      ? clampAimToRange(this.sim.player, rawPoint, res.def.range).point
      : this.groundTargetAim();
    const committed = commitGroundAim(this.groundAim);
    this.groundAim = committed.state;
    this.groundAimPoint = null;
    this.groundAimClamped = false;
    this.renderer.setGroundAimReticle(null);
    this.sim.castAbilityAt(abilityId, point);
    return true;
  }

  // Shared entry point for hotbar clicks and the 1..0-= keybinds.
  castSlot(barSlot: number): void {
    if (this.isGroundAimActive()) {
      if (this.groundAim.activeSlot === barSlot) {
        this.commitGroundAimAt();
        this.flashActionSlot(barSlot);
        return;
      }
      this.cancelGroundAim();
    }
    if (barSlot === 0) {
      // On the pitch, key 1 casts your first sport move (Kick) instead of the
      // harvest-truce-inert auto-attack, which would be a dead key with no useful
      // effect. Off the pitch it is the normal auto-attack toggle.
      const sportFirst = this.firstSportAbilityId();
      if (sportFirst) {
        this.castSportTap(sportFirst, this.sim.known[0]?.def.range ?? MELEE_RANGE);
        this.flashActionSlot(barSlot);
        return;
      }
      if (this.sim.player.autoAttack) this.sim.stopAutoAttack();
      else this.sim.startAutoAttack();
      this.flashActionSlot(barSlot);
      return;
    }
    const action = this.actionForSlot(barSlot);
    if (action?.type === 'ability') {
      // cast by ability id: the server validates against its own known list,
      // so the client-side slot remap never desyncs slot semantics
      const resolved = this.abilityForSlot(barSlot);
      if (resolved) {
        if (resolved.def.targetMode === 'position') {
          if (this.isSportAbilityId(action.id)) {
            // Sport moves autocast toward facing (no reticle, no point-and-click).
            this.castSportTap(action.id, resolved.def.range);
          } else if (this.groundReticleEnabled()) {
            this.beginGroundAim(action.id, barSlot);
          } else {
            this.sim.castAbilityAt(action.id, this.groundTargetAim());
          }
        } else {
          this.sim.castAbility(action.id);
          // Optional QoL: also engage auto-attack when the ability is an offensive
          // attack, so white swings start without a separate Attack press. Gated on
          // the player setting; abilityStartsAutoAttack skips heals/buffs and any
          // damage-breakable CC (gouge/sap/sheep) the swing would shatter. We MUST also
          // gate on hasAutoAttackTarget: many damaging abilities are requiresTarget:false
          // AOEs (Arcane Explosion, Frost Nova, Thunder Clap, ...) cast with no hostile
          // target, where startAutoAttack does NOT no-op but errors "Invalid attack
          // target." (sim/combat/auto_attack.ts). The explicit Attack button keeps that
          // error feedback; this convenience path must not trip it.
          const tid = this.sim.player.targetId;
          const target = tid !== null ? (this.sim.entities.get(tid) ?? null) : null;
          if (
            this.optionsHooks?.settings.get('startAttackOnAbilityUse') &&
            abilityStartsAutoAttack(resolved.effects) &&
            hasAutoAttackTarget(target)
          ) {
            // A TIMED cast must not engage yet: startAutoAttack aggros the target
            // immediately, so engaging at cast start pulled the mob before any
            // damage existed (the aggro-before-damage bug). Defer to the
            // successful castStop (handled in the events switch); instants keep
            // engaging at once since their damage lands this same tick.
            if (deferAutoAttackUntilCastEnd(resolved.castTime)) {
              this.pendingAutoAttackOnCastEnd = true;
            } else {
              this.sim.startAutoAttack();
            }
          }
        }
        this.flashActionSlot(barSlot);
      }
    } else if (action?.type === 'item' && this.isHotbarItemId(action.id)) {
      if (this.tradeOpen) return;
      this.sim.useItem(action.id);
      if ($('#bags').style.display !== 'none') this.renderBags();
      this.flashActionSlot(barSlot);
    }
  }

  // Advance the mobile action ring to its next page. Mutates mobileActionPage
  // ONLY: the ring descriptor's per-slot closures (built once in buildActionBar)
  // resolve sourceSlotForMobileButton(mobileActionPage, i) fresh every tick, so no
  // descriptor rebuild is needed and hidden-page cooldowns keep ticking (their
  // state lives on hotbarActions + sim, not on the view). The next update() call
  // repaints the ring from the new page.
  private cycleMobileActionPage(): void {
    this.mobileActionPage = nextMobilePage(this.mobileActionPage);
  }

  private flashActionSlot(barSlot: number): void {
    const btn = this.abilityButtons[barSlot]?.btn;
    if (btn) this.flashActionButton(btn);
    // Mirror the used-flash onto the mobile ring (the desktop bar is
    // display:none under body.mobile-touch, so without this a ring cast gave
    // no visual acknowledgment at all). barSlot 0 is the attack toggle; the 5
    // paged buttons show sourceSlotForMobileButton(page, i) for the CURRENT page.
    if (barSlot === 0 && this.mobileRingAttackBtn) {
      this.flashActionButton(this.mobileRingAttackBtn);
      return;
    }
    for (let i = 0; i < this.mobileRingSlotBtns.length; i++) {
      if (sourceSlotForMobileButton(this.mobileActionPage, i) === barSlot) {
        this.flashActionButton(this.mobileRingSlotBtns[i]);
        return;
      }
    }
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
    const bar2 = $('#actionbar2');
    // slot 0 (Attack) + slots 1..11 render on the primary bar; slots 12..22 on
    // the secondary bar. One button list (this.abilityButtons), indexed by slot.
    // An entry whose template omits #actionbar2 leaves those buttons detached
    // rather than crashing on appendChild (keybind dispatch by slot still works).
    const totalButtons = 1 + Hud.BAR_ABILITY_SLOTS;
    for (let i = 0; i < totalButtons; i++) {
      const container = i <= Hud.PRIMARY_BAR_ABILITY_SLOTS ? bar : bar2;
      const btn = document.createElement('button');
      btn.className = 'action-btn empty';
      const label = document.createElement('span');
      label.className = 'icon-label';
      const countEl = document.createElement('span');
      countEl.className = 'item-count';
      const kb = document.createElement('span');
      kb.className = 'keybind';
      kb.textContent = this.keybinds.primaryLabel(`slot${i}`); // initial keycap; the ActionBarPainter keeps it current each frame
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
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
          this.hideTooltip();
        });
        btn.addEventListener('dragover', (e) => {
          const dragged = this.dragAction?.action ?? this.readDraggedAction(e.dataTransfer);
          if (!dragged) return;
          if (this.dragAction?.sourceIndex === slot - 1) return;
          e.preventDefault(); // required to permit the drop
          if (e.dataTransfer)
            e.dataTransfer.dropEffect =
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
          // The drop rearranged this slot's contents, but a drop that ends with the
          // cursor already inside the slot fires no mouseenter, so the tooltip would
          // keep the pre-drop text (stale "empty slot" / wrong ability). Clear it so
          // it no longer shows the old slot; the next hover resolves it live (#1485).
          this.hideTooltip();
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
      container?.appendChild(btn);
      this.abilityButtons.push({
        btn,
        label,
        countEl,
        keybindEl: kb,
        cdOverlay,
        cdText,
      });
    }

    // Build the action-bar core + painter now that the slot buttons exist. The core
    // descriptor carries slot identity + the host-resolved binding/keybind accessors
    // (NO element refs); the paint descriptor carries the container + per-slot
    // elements (multiplicity is a constructor arg, not a hardcoded id).
    this.actionBarView = createActionBarView(
      {
        manySpellsSlotMax: Hud.PRIMARY_BAR_ABILITY_SLOTS,
        slots: this.abilityButtons.map((_, i) => {
          // Precompute the keybind lookup key once per slot (not per frame).
          const slotKey = `slot${i}`;
          return {
            slotIndex: i,
            isAttack: i === 0,
            // Raw binding presence (any assigned slot, even one whose ability is
            // unlearned or item id is unknown): the many-spells count source, kept
            // byte-identical to the former hotbarActions.filter(a => a !== null).
            hasAction: () => this.actionForSlot(i) !== null,
            ability: () => this.abilityForSlot(i),
            item: () => this.itemForSlot(i),
            keybindLabel: () => this.keybinds.primaryLabel(slotKey),
          };
        }),
      },
      {
        t,
        abilityName: abilityDisplayName,
        itemName: itemDisplayName,
        slotLabel: (i) => formatAbilityNumber(i + 1),
        formatCount: (n) => formatNumber(n, { maximumFractionDigits: 0 }),
      },
    );
    this.actionBarPainter = new ActionBarPainter(
      this.writerFacet,
      {
        container: this.actionbarEl,
        slots: this.abilityButtons.map((ab) => ({
          btn: ab.btn,
          label: ab.label,
          countEl: ab.countEl,
          keybindEl: ab.keybindEl,
          cdOverlay: ab.cdOverlay,
          cdText: ab.cdText,
        })),
      },
      (iconKey) => this.actionBarIconBg(iconKey),
    );

    this.buildMobileActionRing();
    this.buildMobileConsumableBar();
  }

  // Build the mobile action ring: a SECOND createActionBarView instance over a
  // 6-slot descriptor (slot 0 the fixed attack toggle, slots 1-5 the paged action
  // buttons) plus a MobileActionRingPainter reusing ActionBarPainter for the
  // per-slot writes. The static container/buttons live in index.html/play.html
  // (#mobile-action-ring); on a build that omits them (neither game entry does,
  // but this stays defensive like the #actionbar2-less template case above) the
  // ring silently stays unbuilt and update() skips painting it.
  private buildMobileActionRing(): void {
    const attackBtn = document.getElementById('mobile-action-attack') as HTMLButtonElement | null;
    const slotBtns = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.mobile-action-slot'),
    ).sort((a, b) => Number(a.dataset.mobileIndex ?? 0) - Number(b.dataset.mobileIndex ?? 0));
    const pageToggle = document.getElementById('mobile-action-page-toggle');
    const pageIndicator = pageToggle?.querySelector<HTMLElement>('.mobile-action-page-indicator');
    if (!attackBtn || slotBtns.length !== 5 || !pageToggle || !pageIndicator) return;
    this.mobileRingAttackBtn = attackBtn;
    this.mobileRingSlotBtns = slotBtns;

    const ringButtons = [attackBtn, ...slotBtns];
    const ringEls: ActionBarSlotElements[] = ringButtons.map((btn) => {
      const label = document.createElement('span');
      label.className = 'icon-label';
      const countEl = document.createElement('span');
      countEl.className = 'item-count';
      const keybindEl = document.createElement('span');
      keybindEl.className = 'keybind';
      const cdOverlay = document.createElement('div');
      cdOverlay.className = 'cd-overlay';
      const cdText = document.createElement('div');
      cdText.className = 'cdtext';
      btn.append(label, countEl, keybindEl, cdOverlay, cdText);
      return { btn, label, countEl, keybindEl, cdOverlay, cdText };
    });

    // Wire clicks: attack -> the classic toggle via castSlot(0) while the
    // player is auto-attacking or holds a live hostile target, and the
    // acquire-nearest fallback (the old Closest behavior, injected by main.ts
    // as onMobileAttackNearest) otherwise, so a bare tap with nothing targeted
    // picks the closest enemy and starts swinging instead of erroring. Slot
    // buttons -> castSlot(the resolved source slot for the CURRENT page at
    // click time, not a captured page). Mirrors the desktop action-btn click
    // pattern (audio.click, blur), EXCEPT the peek guard: the ring has no
    // tooltip of its own (see the no-tooltip note below), so a set peek flag
    // here is always STALE cross-talk from some other control's long-press.
    // Each handler clears it and dismisses any lingering tooltip box but never
    // early-returns on it (an early return here ate the player's next cast).
    // bindTouchTap, not 'click': the browser only synthesizes click for the
    // PRIMARY pointer, so click-bound ring buttons went dead the moment the
    // other thumb held the joystick, which is how combat is actually played.
    bindTouchTap(attackBtn, () => {
      this.peekGuard.consume();
      this.hideTooltip();
      audio.click();
      const p = this.sim.player;
      const target = p.targetId !== null ? this.sim.entities.get(p.targetId) : null;
      const hasLiveHostileTarget = !!target && !target.dead && target.hostile;
      if (p.autoAttack || hasLiveHostileTarget || !this.onMobileAttackNearest) {
        this.castSlot(0);
      } else {
        this.onMobileAttackNearest();
      }
      attackBtn.blur();
    });
    slotBtns.forEach((btn, i) => {
      bindTouchTap(btn, () => {
        // A tap that ends a long-press drag (even one released back on its own
        // slot, a cancel) must not also cast: bindMobileRingDrag arms this flag
        // on release from an active drag, same as the desktop drag's click guard.
        if (this.suppressNextActionClick) {
          this.suppressNextActionClick = false;
          btn.blur();
          return;
        }
        this.peekGuard.consume();
        this.hideTooltip();
        audio.click();
        this.castSlot(sourceSlotForMobileButton(this.mobileActionPage, i));
        btn.blur();
      });
      this.bindMobileRingDrag(btn, i);
    });
    bindTouchTap(pageToggle, () => {
      this.peekGuard.consume();
      this.hideTooltip();
      audio.click();
      this.cycleMobileActionPage();
      (pageToggle as HTMLElement).blur();
    });

    // No tooltip on the mobile ring: a long-press-to-inspect wiring lived here
    // (mirroring the desktop bar's attachTooltip), but it read as a stray
    // popup box appearing over the world on an ordinary tap/hold rather than a
    // deliberate inspect gesture, so it is removed entirely on touch. With
    // nothing arming the shared peek guard FROM the ring, a long hold just
    // casts like a normal tap, and the handlers above only ever CLEAR the
    // guard (stale cross-talk from another control), never gate on it.

    this.mobileActionRingView = createActionBarView(
      {
        slots: [
          {
            slotIndex: 0,
            isAttack: true,
            hasAction: () => false,
            ability: () => null,
            item: () => null,
            keybindLabel: () => '',
          },
          ...Array.from({ length: 5 }, (_, i) => ({
            slotIndex: i + 1,
            isAttack: false,
            hasAction: () =>
              this.actionForSlot(sourceSlotForMobileButton(this.mobileActionPage, i)) !== null,
            ability: () => this.abilityForSlot(sourceSlotForMobileButton(this.mobileActionPage, i)),
            item: () => this.itemForSlot(sourceSlotForMobileButton(this.mobileActionPage, i)),
            keybindLabel: () => '',
          })),
        ],
      },
      {
        t,
        abilityName: abilityDisplayName,
        itemName: itemDisplayName,
        slotLabel: (i) => formatAbilityNumber(i + 1),
        formatCount: (n) => formatNumber(n, { maximumFractionDigits: 0 }),
      },
    );
    this.mobileActionRingPainter = new MobileActionRingPainter(
      this.writerFacet,
      {
        bar: {
          container: document.getElementById('mobile-action-ring') as HTMLElement,
          slots: ringEls,
        },
        pageToggle: pageToggle as HTMLElement,
        pageIndicator,
      },
      // The ring's primary attack slot shows the same crisp data-icon="attack"
      // glyph as the (now-secondary) Target Closest button instead of the
      // painted ability-icon background desktop's attack toggle uses: an empty
      // background here leaves the inline SVG hydrateIcons() already inserted
      // into #mobile-action-attack's markup visible underneath. Every other
      // slot (abilities/items/empty) still resolves through actionBarIconBg
      // exactly like desktop, so desktop's own attack toggle is untouched.
      (iconKey) => (iconKey === ATTACK_ICON_KEY ? '' : this.actionBarIconBg(iconKey)),
      t,
    );
  }

  // Consumables quick bar: the chevron chip next to the top-left trio expands a
  // row auto-populated from the carried consumables (consumable_bar_view.ts),
  // painted by another instance of the shared bar family. Touch has no way to
  // drag an item onto the hotbar, so unlike the ring's paged slots this bar
  // needs no setup: tap the chip, tap the potion. Collapsed by default and
  // session-only (no persisted state, no settings entry). Defensive against
  // missing markup like the ring (an older cached template leaves it unbuilt).
  private buildMobileConsumableBar(): void {
    const toggle = document.getElementById('mobile-consumables-toggle');
    const row = document.getElementById('mobile-consumables-row');
    const slotBtns = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.mobile-consumable-slot'),
    ).sort(
      (a, b) => Number(a.dataset.consumableIndex ?? 0) - Number(b.dataset.consumableIndex ?? 0),
    );
    if (!toggle || !row || slotBtns.length !== CONSUMABLE_BAR_SLOTS) return;
    this.consumableBarSlotBtns = slotBtns;

    const slotEls: ActionBarSlotElements[] = slotBtns.map((btn) => {
      const label = document.createElement('span');
      label.className = 'icon-label';
      const countEl = document.createElement('span');
      countEl.className = 'item-count';
      const keybindEl = document.createElement('span');
      keybindEl.className = 'keybind';
      const cdOverlay = document.createElement('div');
      cdOverlay.className = 'cd-overlay';
      const cdText = document.createElement('div');
      cdText.className = 'cdtext';
      btn.append(label, countEl, keybindEl, cdOverlay, cdText);
      return { btn, label, countEl, keybindEl, cdOverlay, cdText };
    });

    // bindTouchTap, not 'click', for the same reason as the ring: the browser
    // only synthesizes click for the PRIMARY pointer, so a click-bound button
    // goes dead while the other thumb holds the joystick.
    bindTouchTap(toggle, () => {
      audio.click();
      this.consumablesOpen = !this.consumablesOpen;
      // Snapshot the consumable list at OPEN time; it stays frozen while open
      // so slot positions are tap-stable (see the field comment). Counts and
      // the potion-cooldown sweep still update live off the sim each frame.
      if (this.consumablesOpen) {
        consumableBarItems(this.sim.inventory, (id) => ITEMS[id], this.consumableBarIds);
      }
      document.body.classList.toggle('mobile-consumables-open', this.consumablesOpen);
      toggle.setAttribute('aria-expanded', this.consumablesOpen ? 'true' : 'false');
      (toggle as HTMLElement).blur();
    });
    slotBtns.forEach((btn, i) => {
      bindTouchTap(btn, () => {
        if (this.peekGuard.consume()) {
          this.hideTooltip();
          btn.blur();
          return;
        }
        audio.click();
        this.useConsumableSlot(i);
        btn.blur();
      });
      // Long-press-to-inspect, arming the peek guard the tap handler consumes
      // (same contract as the ring: a long press must never quaff).
      this.attachTooltip(btn, () => {
        const id = this.consumableBarIds[i];
        const item = id ? (ITEMS[id] ?? null) : null;
        if (!item) return `<div class="tt-sub">${esc(t('abilityUi.actionBar.emptySlot'))}</div>`;
        const count = this.inventoryCount(item.id);
        return (
          this.itemTooltip(item) +
          `<div class="tt-sub">${esc(
            count > 0
              ? t('abilityUi.actionBar.itemInBags', {
                  count: formatNumber(count, { maximumFractionDigits: 0 }),
                })
              : t('abilityUi.actionBar.itemNoneInBags'),
          )}</div>`
        );
      });
    });

    this.consumableBarView = createActionBarView(
      {
        slots: Array.from({ length: CONSUMABLE_BAR_SLOTS }, (_, i) => ({
          slotIndex: i,
          isAttack: false,
          hasAction: () => this.consumableBarIds[i] !== undefined,
          ability: () => null,
          item: () => {
            const id = this.consumableBarIds[i];
            return id ? (ITEMS[id] ?? null) : null;
          },
          keybindLabel: () => '',
        })),
      },
      {
        t,
        abilityName: abilityDisplayName,
        itemName: itemDisplayName,
        slotLabel: (i) => formatAbilityNumber(i + 1),
        formatCount: (n) => formatNumber(n, { maximumFractionDigits: 0 }),
      },
    );
    this.consumableBarPainter = new ActionBarPainter(
      this.writerFacet,
      { container: row, slots: slotEls },
      (iconKey) => this.actionBarIconBg(iconKey),
    );
  }

  // Tap dispatch for a consumables-bar slot: the same seam as castSlot's item
  // arm (IWorld.useItem, so offline runs the sim directly and online sends the
  // authoritative 'use' command), minus the hotbar-eligibility gate: the bar's
  // ids come pre-filtered from consumable_bar_view, which deliberately INCLUDES
  // elixirs (usable from bags, just never hotbar-placeable).
  private useConsumableSlot(i: number): void {
    const id = this.consumableBarIds[i];
    if (!id || this.tradeOpen) return;
    this.sim.useItem(id);
    if ($('#bags').style.display !== 'none') this.renderBags();
    const btn = this.consumableBarSlotBtns[i];
    if (btn) this.flashActionButton(btn);
  }

  // Resolve a core icon key to the slot label's background-image value. Kept on the
  // Hud (not the painter) so the painter holds no icon table or literal URL; the
  // painter calls this only when a slot's icon key changes.
  private actionBarIconBg(iconKey: string): string {
    if (iconKey === EMPTY_ICON_KEY) return '';
    if (iconKey === ATTACK_ICON_KEY) return `url(${iconDataUrl('ability', 'attack')})`;
    if (iconKey.startsWith(ITEM_ICON_PREFIX)) {
      return `url(${iconDataUrl('item', iconKey.slice(ITEM_ICON_PREFIX.length))})`;
    }
    return `url(${iconDataUrl('ability', iconKey.slice(ABILITY_ICON_PREFIX.length))})`;
  }

  private clearActionDropTargets(): void {
    // Both action rows (#actionbar and #actionbar2) hold .action-btn slots; the
    // mobile action ring's paged slots are .mobile-action-slot instead.
    document
      .querySelectorAll('.action-btn.drop-target, .mobile-action-slot.drop-target')
      .forEach((el) => {
        el.classList.remove('drop-target');
      });
  }

  private mobileRingSlotFromPoint(x: number, y: number): number | null {
    const el = document
      .elementFromPoint(x, y)
      ?.closest?.('.mobile-action-slot') as HTMLElement | null;
    const raw = el?.dataset.mobileIndex;
    if (!raw) return null;
    const idx = Number(raw);
    return Number.isInteger(idx) && idx >= 0 && idx < this.mobileRingSlotBtns.length ? idx : null;
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
    document
      .querySelectorAll('.action-btn.mobile-drag-source, .mobile-action-slot.mobile-drag-source')
      .forEach((el) => {
        el.classList.remove('mobile-drag-source');
        el.removeAttribute('aria-grabbed');
      });
    this.clearActionDropTargets();
  }

  private bindMobileActionDrag(btn: HTMLButtonElement, slot: number): void {
    btn.addEventListener('pointerdown', (e) => {
      if (!document.body.classList.contains('mobile-touch') || e.pointerType !== 'touch') return;
      // Any populated slot (ability or item) can be picked up and swapped by
      // touch, matching desktop drag-and-drop which does not special-case
      // items either.
      if (!this.actionForSlot(slot)) return;
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
          btn.setAttribute('aria-grabbed', 'true');
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
        const resolvedTarget = resolveMobileHotbarDrop(drag.sourceIndex, targetIndex);
        if (resolvedTarget !== null) {
          this.hotbarActions = swapHotbarSlots(
            this.hotbarActions,
            drag.sourceIndex,
            resolvedTarget,
          );
          this.saveSlotMap();
          // Match the desktop drop: clear the now-stale tooltip for the rearranged
          // slot so a long-press peek resolves the new content (#1485).
          this.hideTooltip();
        }
      }
      this.clearMobileHotbarDrag();
    };
    btn.addEventListener('pointerup', finish);
    btn.addEventListener('pointercancel', finish);
  }

  // Touch swap for the mobile action ring, the one bar actually visible on a
  // touch device (the desktop #actionbar/#actionbar2 rows bindMobileActionDrag
  // wires above are display:none under body.mobile-touch, so without this the
  // ring had no rearrange path at all). Same long-press-then-drag gesture as
  // bindMobileActionDrag, sharing the one mobileHotbarDrag field (only one
  // drag can be live at a time) and the pure resolveMobileHotbarDrop/
  // swapHotbarSlots helpers; only the point-to-slot hit test differs, since
  // ring buttons are .mobile-action-slot, not .action-btn, and a ring
  // position's underlying bar slot depends on the current paged page.
  private bindMobileRingDrag(btn: HTMLButtonElement, ringIndex: number): void {
    btn.addEventListener('pointerdown', (e) => {
      if (!document.body.classList.contains('mobile-touch') || e.pointerType !== 'touch') return;
      const sourceSlot = sourceSlotForMobileButton(this.mobileActionPage, ringIndex);
      if (!this.actionForSlot(sourceSlot)) return;
      this.clearMobileHotbarDrag();
      const sourceIndex = sourceSlot - 1;
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
          document.body.classList.add('mobile-hotbar-dragging');
          btn.classList.add('mobile-drag-source', 'drop-target');
          btn.setAttribute('aria-grabbed', 'true');
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
      const targetRingIndex = this.mobileRingSlotFromPoint(e.clientX, e.clientY);
      const targetIndex =
        targetRingIndex !== null
          ? sourceSlotForMobileButton(this.mobileActionPage, targetRingIndex) - 1
          : null;
      drag.targetIndex = targetIndex;
      this.clearActionDropTargets();
      const targetBtn = targetRingIndex !== null ? this.mobileRingSlotBtns[targetRingIndex] : null;
      if (targetBtn) targetBtn.classList.add('drop-target');
      btn.classList.add('mobile-drag-source');
    });

    const finish = (e: PointerEvent) => {
      const drag = this.mobileHotbarDrag;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const wasActive = drag.active;
      const targetIndex = drag.targetIndex;
      if (wasActive) {
        e.preventDefault();
        this.suppressNextActionClick = true;
        const resolvedTarget = resolveMobileHotbarDrop(drag.sourceIndex, targetIndex);
        if (resolvedTarget !== null) {
          this.hotbarActions = swapHotbarSlots(
            this.hotbarActions,
            drag.sourceIndex,
            resolvedTarget,
          );
          this.saveSlotMap();
          this.hideTooltip();
        }
      }
      this.clearMobileHotbarDrag();
    };
    btn.addEventListener('pointerup', finish);
    btn.addEventListener('pointercancel', finish);
  }

  // Repaint the side-menu button keycaps + aria labels from the current bindings.
  private refreshKeybindLabels(): void {
    // The action-bar keycaps are owned by the per-frame ActionBarPainter, which writes
    // each slot's keybind label through the elided setText every frame; a rebind or
    // language switch therefore lands on the next update() tick (update() runs every
    // frame in-game). Refreshing them here too would be a second writer bypassing that
    // elision cache. This method owns only the side-menu buttons, which
    // have no per-frame painter.
    const sideButtons: [selector: string, action: string, labelKey: TranslationKey][] = [
      ['#mm-char', 'char', 'hud.keybinds.actions.char'],
      ['#mm-spell', 'spellbook', 'abilityUi.spellbook.title'],
      ['#mm-talents', 'talents', 'game.talents.title'],
      ['#mm-quest', 'questlog', 'questUi.log.title'],
      ['#mm-deeds', 'deeds', 'hudChrome.deeds.title'],
      ['#mm-map', 'map', 'hud.core.mobileMap'],
      ['#mm-bag', 'bags', 'itemUi.bags.title'],
      ['#mm-arena', 'arena', 'hud.core.mobileArena'],
      ['#mm-valecup', 'valecup', 'hudChrome.keybinds.valecup'],
      ['#mm-leaderboard', 'leaderboard', 'game.leaderboard.title'],
      ['#mm-emote', 'emoteWheel', 'hudChrome.emoteWheel.label'],
      ['#mm-social', 'social', 'hud.social.friendsTab'],
      ['#mm-discord', 'discord', 'hudChrome.discord.title'],
    ];
    for (const [selector, action, labelKey] of sideButtons) {
      const btn = document.querySelector<HTMLElement>(selector);
      if (!btn) continue;
      const key = this.keybinds.primaryLabel(action);
      const label = t(labelKey);
      const keyEl = btn.querySelector<HTMLElement>('.keybind');
      if (keyEl) keyEl.textContent = keyCapLabel(key);
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
    // Value-diffed body-class flag the mobile top-band layout reads (see field doc):
    // toggled only on a real transition so the per-frame path stays write-free.
    // Deliberately toggled on EVERY host, not just touch: only body.mobile-touch
    // CSS consumes it, and an always-true flag survives a desktop-to-touch flip
    // mid-session where a mobile-gated toggle would leave it stale until the
    // pet's presence next changed.
    const petPresent = !!pet && !pet.dead;
    if (petPresent !== this.lastPetPresent) {
      this.lastPetPresent = petPresent;
      document.body.classList.toggle('mobile-pet-active', petPresent);
    }
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
      PET_ACTION_ICONS.attack,
      t('hud.pet.attack'),
      petTooltip(t('hud.pet.petAttackTitle'), t('hud.pet.petAttackDesc')),
      () => this.sim.petAttack(),
    );
    addButton(
      commands,
      PET_ACTION_ICONS.taunt,
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
        PET_ACTION_ICONS.healDemon,
        t('hud.pet.healDemon'),
        petTooltip(t('hud.pet.healDemon'), t('hud.pet.healDemonDesc')),
        () => {
          this.sim.healPet();
        },
      );
    } else {
      addButton(
        commands,
        PET_ACTION_ICONS.feed,
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
          $('#bags').style.display = 'flex';
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
      passive: PET_ACTION_ICONS.passive,
      defensive: PET_ACTION_ICONS.defensive,
      aggressive: PET_ACTION_ICONS.aggressive,
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
    const el = this.lowHealthVignetteEl;
    if (!el) return;
    const v = lowHealthVignette(hp, maxHp);
    // Route through the elided writers (the cached ref + setStyleProp /
    // toggleClass): a per-frame query + raw uncounted writes become a counted,
    // change-only write that the skip-rate sees while the player is at full health.
    this.toggleClass(el, 'active', v.active);
    if (!v.active) return;
    this.setStyleProp(el, '--lhv-opacity', v.opacity.toFixed(3));
    this.setStyleProp(el, '--lhv-pulse', `${v.pulseSeconds.toFixed(3)}s`);
  }

  // The STATIC ui effects tier (data-fx-level, written by the preset applier and
  // NEVER the FPS governor: the two-controller hazard). The per-element tier knobs read
  // this, so flipping the graphics preset is the only thing that moves a knob. Read once
  // per update() frame; coerceFxTier defaults an unset/unknown stamp to 'ultra' (full
  // effects), so a missing stamp never silently sheds HUD cost.
  private fxTier(): UiEffectsTier {
    return coerceFxTier(document.documentElement.dataset.fxLevel);
  }

  private dailyRewardsEnabled(): boolean {
    return this.features.dailyRewardsEnabled;
  }

  private syncDailyRewardsSurfaceLabels(): void {
    const storeEnabled = this.claudiumHooks !== null;
    const titleKey = storeEnabled ? 'hudChrome.wocStore.title' : 'hudChrome.dailyRewards.title';
    const labelKey = storeEnabled ? 'hudChrome.wocStore.storeTab' : 'hudChrome.dailyRewards.title';
    const title = t(titleKey);
    for (const button of [this.dailyRewardsButtonEl, this.mobileDailyRewardsButtonEl]) {
      if (!button) continue;
      button.setAttribute('data-i18n-title', titleKey);
      button.setAttribute('data-i18n-aria', titleKey);
      button.title = title;
      button.setAttribute('aria-label', title);
    }
    const label = this.mobileDailyRewardsButtonEl?.querySelector<HTMLElement>('.mobile-label');
    if (label) {
      label.setAttribute('data-i18n', labelKey);
      label.textContent = t(labelKey);
    }
  }

  private showDailyRewardsChestButton(): boolean {
    return this.optionsHooks?.settings.get('showDailyRewardsChest') ?? true;
  }

  private applyDailyRewardsChestButtonVisibility(show = this.showDailyRewardsChestButton()): void {
    const button = this.dailyRewardsButtonEl;
    if (!button) return;
    const visible = this.dailyRewardsEnabled() && show;
    button.toggleAttribute('hidden', !visible);
    if (!visible) button.classList.remove('spin-ready');
    // The mobile More-tray entry is a menu row, not floating chrome: it stays
    // reachable whenever the feature itself is on, regardless of the
    // showDailyRewardsChestButton preference (which only declutters the rail).
    if (!this.dailyRewardsEnabled())
      this.mobileDailyRewardsButtonEl?.classList.remove('spin-ready');
  }

  private setDailyRewardsChestButtonPreference(show: boolean): void {
    if (this.optionsHooks) {
      this.optionsHooks.onSettingChange('showDailyRewardsChest', show);
      return;
    }
    this.setDailyRewardsChestButtonVisible(show);
  }

  setDailyRewardsChestButtonVisible(show: boolean): void {
    this.applyDailyRewardsChestButtonVisibility(show);
    if (show) this.refreshDailyRewardsLauncher(true);
  }

  private applyDailyRewardsLauncherStatus(status: DailyRewardStatus): void {
    if (!this.dailyRewardsEnabled()) return;
    const button = this.dailyRewardsButtonEl;
    const spinReady = !status.eligibility.eligible || !status.spin.claimed;
    this.mobileDailyRewardsButtonEl?.classList.toggle('spin-ready', spinReady);
    if (!button) return;
    if (!this.showDailyRewardsChestButton()) {
      button.hidden = true;
      button.classList.remove('spin-ready');
      return;
    }
    button.hidden = false;
    button.classList.toggle('spin-ready', spinReady);
  }

  private refreshDailyRewardsLauncher(force = false): void {
    if (!this.dailyRewardsEnabled()) return;
    const button = this.dailyRewardsButtonEl;
    if (!button) return;
    this.applyDailyRewardsChestButtonVisibility();
    if (!this.showDailyRewardsChestButton()) return;
    const now = performance.now();
    if (!force && now - this.lastDailyRewardsLauncherRefreshAt < 60_000) return;
    this.lastDailyRewardsLauncherRefreshAt = now;
    const seq = ++this.dailyRewardsLauncherSeq;
    void this.sim
      .dailyRewards()
      .then((status) => {
        if (seq !== this.dailyRewardsLauncherSeq) return;
        this.applyDailyRewardsLauncherStatus(status);
      })
      .catch(() => {
        if (seq !== this.dailyRewardsLauncherSeq) return;
        button.classList.remove('spin-ready');
      });
  }

  update(): void {
    const sim = this.sim;
    const p = sim.player;
    const now = performance.now();
    const fxTier = this.fxTier();
    const fastHud = now - this.lastHudFastAt >= 100;
    if (fastHud) {
      this.lastHudFastAt = now;
      this.reconcileSfx();
    }
    const mediumHud = now - this.lastHudMediumAt >= 250;
    if (mediumHud) this.lastHudMediumAt = now;
    const slowHud = now - this.lastHudSlowAt >= 500;
    if (slowHud) this.lastHudSlowAt = now;

    // Drain a trailing combat-announcement burst to the polite live region (push()
    // already flushes; this catches the last buffered line once combat goes quiet).
    if (fastHud) this.combatAnnouncer.flush(now);
    // Same for the tab-independent chat live region: drain the trailing
    // chat burst on the fast tier once chat goes quiet.
    if (fastHud) this.chatAnnouncer.flush(now);

    // Fade a talking NPC's voice line by distance as the player walks away, so a
    // dialogue trails off naturally instead of holding full volume. Per-frame for a
    // smooth ramp; independent of the dialog window (which closes at 8), so the
    // voice keeps fading until the clip ends or the player is out of earshot.
    if (this.voiceNpcId !== null) {
      if (!voice.isPlaying()) {
        this.voiceNpcId = null;
      } else {
        const vnpc = sim.entities.get(this.voiceNpcId);
        voice.setDistanceGain(vnpc ? voiceDistanceGain(dist2d(p.pos, vnpc.pos)) : 0);
      }
    }
    this.meters.update();
    this.lockpickWindow.repaintIfChanged();
    this.tutorial.update(sim, this.renderer, this.keybinds);
    this.reconcileLootRolls();
    this.reconcileLootRollStatus(now);
    this.updateLootRollTimers(now);
    if (slowHud) this.updateRaidLockoutBadge();
    if (slowHud) this.refreshDailyRewardsLauncher();
    this.syncActiveHotbarForm();
    this.syncSlotMap(); // picks up newly learned abilities mid-session

    // talent buttons glow while the player has unspent points (and a tree exists)
    const tp = sim.talentPoints();
    const talGlow = talentsFor(sim.cfg.playerClass) !== null && tp.spent < tp.total;
    document.getElementById('mm-talents')?.classList.toggle('has-points', talGlow);
    document.getElementById('mobile-talents')?.classList.toggle('has-points', talGlow);

    // Town Focus (#1143): the minimap button (and, if open, the panel's live
    // gate) only ever shows/works while standing in a town hub. Cheap zone
    // check, gated to the slow tier since it changes only on foot travel.
    if (slowHud) {
      const inTown = this.isInTown();
      const townFocusBtn = document.getElementById('mm-town-focus');
      if (townFocusBtn) townFocusBtn.style.display = inTown ? '' : 'none';
      if (this.townFocusOpen) this.renderTownFocus();
    }

    // player frame: the first instance of the unit_frame family. Build a
    // player-shaped descriptor and paint it. The absorb overlay + the resource-type
    // class fold into the painter's elided writers (no more raw updateAbsorb /
    // className swap on the player hot path). updateLowHealthVignette +
    // updateLowResource are player-only side effects with their own cores and stay
    // here, OUT of the shared family (target/party must not inherit them).
    this.playerFramePainter.paint(
      unitFrameView({
        present: true,
        hpFrac: p.hp / Math.max(1, p.maxHp),
        hpText: `${p.hp} / ${p.maxHp}`,
        resourceKind: p.resourceType,
        resFrac: p.resource / Math.max(1, p.maxResource),
        resText: `${Math.round(p.resource)} / ${p.maxResource}`,
        levelText: String(p.level),
        name: p.name,
        portraitKey: PLAYER_PORTRAIT_KEY,
        absorb: p,
        dead: false,
        outOfRange: false,
      }),
    );
    this.updateLowHealthVignette(p.hp, p.maxHp);
    this.updateLowResource(p);

    // combo points: character-bound (retail-style), so the row of pips rides the
    // PLAYER frame (over the hp bar) and stays lit across target swaps until the
    // points are spent or fade. The row is lazy-built ONCE (then only the `on`
    // class is toggled per frame, through the elided writer), never rebuilt.
    if (p.resourceType === 'energy') {
      this.setDisplay(this.comboRowEl, 'flex');
      if (this.comboRowEl.children.length !== COMBO_PIP_COUNT) {
        this.comboRowEl.innerHTML = '';
        for (let i = 0; i < COMBO_PIP_COUNT; i++) {
          const pip = document.createElement('div');
          pip.className = 'combo-pip';
          this.comboRowEl.appendChild(pip);
        }
      }
      // indexed walk over the live collection: no per-frame array copy
      const pips = this.comboRowEl.children;
      for (let i = 0; i < pips.length; i++) {
        this.toggleClass(pips[i] as HTMLElement, 'on', i < p.comboPoints);
      }
    } else {
      this.setDisplay(this.comboRowEl, 'none');
    }

    // buff bar / debuff bar: the keyed-pool aura painter, driven by the auras_view core
    // every frame (the elided writers make a no-op frame free). Buffs and debuffs render to
    // separate rows (classic layout) so a fresh debuff is never lost in a wall of long-lived
    // buffs: two view+painter instances, mode 'buffs' (#buff-bar) and 'debuffs' (#debuff-bar).
    // The graphics tier coarsens the refresh (tick) granularity: full tiers repaint every
    // frame (interval 0, cadenceDue always true); low coarsens to ~4Hz. The visible-count cap
    // is applied inside the painter.
    if (cadenceDue(this.lastBuffBarPaintAt, now, auraRefreshIntervalMs(fxTier))) {
      this.lastBuffBarPaintAt = now;
      this.buffBarPainter.paint(this.buffBarView.tick(p));
      this.debuffBarPainter.paint(this.debuffBarView.tick(p));
    }

    // target frame: the SECOND instance of the unit_frame family. The shared
    // frame (display/name/level/hp/absorb/portrait gate) goes through the family
    // painter; the target-only concerns (the elite class + tag, the hostile/friendly
    // name color) route through the SAME elided writers here, and the target
    // debuffs + cast bar CONSUME the existing auras paint + the cast_bar
    // target instance. (Targeting a world object hides the frame, like no target.)
    const target = p.targetId !== null ? sim.entities.get(p.targetId) : null;
    if (target && target.kind !== 'object') {
      const isBoss = !!MOBS[target.templateId]?.boss;
      // The portrait gate fires inside paint(); hand it the subject to redraw.
      this.targetPortraitSubject = target;
      // The target is a NON-SELF frame; on low throttle its HP/level/
      // portrait refresh (~10Hz), while the SELF/player frame stays full-rate. A target
      // SWAP bypasses the throttle so selecting a new target updates immediately. The full
      // tiers return interval 0 (cadenceDue always true), so this paints every frame as
      // before. The elite tag / name color / debuffs / cast bar below stay
      // full-rate (debuffs are separately tiered; the cast bar is a raid
      // mechanic indicator), so only the unit_frame body is throttled.
      const targetChanged = target.id !== this.lastTargetFrameId;
      // Announce the new target's name into the polite #target-live region once per target
      // CHANGE, tracked by lastAnnouncedTargetId independently of the paint
      // cadence so it fires on the real id change, not the throttled repaint. Write textContent
      // DIRECTLY through the re-announce marker (NOT the elided setText): a pack of same-template
      // mobs share a display name, so the elided writer would skip every same-named re-target and
      // the region would fall silent; the marker forces a byte-different value so it re-reads. The
      // change gate means this is an event write, not a per-frame write.
      if (target.id !== this.lastAnnouncedTargetId) {
        this.targetLiveEl.textContent = this.targetReannounce.mark(
          t('hudChrome.unitFrame.targetAnnounce', { name: entityDisplayName(target) }),
        );
        this.lastAnnouncedTargetId = target.id;
      }
      if (
        nonSelfRepaintDue(
          targetChanged,
          this.lastTargetFramePaintAt,
          now,
          targetFrameNonSelfIntervalMs(fxTier),
        )
      ) {
        this.lastTargetFramePaintAt = now;
        this.lastTargetFrameId = target.id;
        // entity.title is the Book of Deeds deed id on the identity wire
        // (players only; always null/absent for mobs and NPCs).
        const titleSig = `${getLanguage()}|${target.title ?? ''}`;
        if (titleSig !== this.lastTargetTitleSig) {
          this.lastTargetTitleSig = titleSig;
          this.targetTitleDecoration = titledNameDecoration(target.title ?? null);
        }
        this.targetFramePainter.paint(
          unitFrameView({
            present: true,
            hpFrac: target.hp / Math.max(1, target.maxHp),
            hpText: target.dead ? t('hud.core.dead') : `${target.hp} / ${target.maxHp}`,
            // The target's power bar (classic target frame): players and caster
            // mobs show their mana/rage/energy; a resource-less target (a plain
            // beast, rtype null) maps to 'none' EXPLICITLY (unitResourceClass
            // buckets null with mana), so every type class turns off and the
            // rail renders EMPTY (zero fill, no text) but stays visible, the
            // classic look where the frame never changes height. Dead: same.
            resourceKind: target.dead || !target.resourceType ? 'none' : target.resourceType,
            resFrac:
              target.dead || !target.resourceType
                ? 0
                : target.resource / Math.max(1, target.maxResource),
            resText:
              target.dead || !target.resourceType
                ? ''
                : `${Math.round(target.resource)} / ${target.maxResource}`,
            levelText: isBoss ? BOSS_SKULL_GLYPH : String(target.level),
            name: entityDisplayName(target),
            titlePre: this.targetTitleDecoration.pre,
            titlePost: this.targetTitleDecoration.post,
            // id-keyed gate, byte-faithful to the old lastPortraitTarget !== target.id;
            // the painter resets it on hide so an id reused by a new mob still redraws.
            portraitKey: String(target.id),
            absorb: target.dead ? null : target,
            dead: false,
            outOfRange: false,
          }),
        );
      }
      // Target-only sub-parts the family frame does not express, each routed through
      // the elided writers (the elite class + name color are the two writes the four
      // original writers cannot express, hence the toggleClass / setStyleProp).
      this.toggleClass(this.targetFrameEl, 'elite', !!MOBS[target.templateId]?.elite);
      this.setText(this.targetEliteTagEl, isBoss ? t('hud.core.boss') : t('hud.core.elite'));
      // Linked-Discord players get their staff-role name color (else friendly/hostile),
      // plus a Discord info line (nickname + rank + role chips) under the healthbar.
      const tfRoleColor = target.kind === 'player' ? specialRoleColor(target.discordRole) : null;
      this.setStyleProp(
        this.targetNameEl,
        'color',
        tfRoleColor ?? (target.hostile ? 'var(--color-hostile)' : 'var(--color-friendly)'),
      );
      this.updateTargetDiscordLine(target);
      // Redundant non-color cue for forced-colors (high-contrast) mode, where the OS
      // strips the inline color so a hostile and a friendly name would read identically.
      // The base.css forced-colors block underlines #tf-name.hostile; routed through the
      // elided toggleClass writer so the per-frame hot path stays write-elided. Normal
      // mode is unaffected (the rule lives only inside @media (forced-colors: active)).
      this.toggleClass(this.targetNameEl, 'hostile', target.hostile);
      // Tier the target-debuff refresh (tick) granularity like the buff
      // bar. A target SWAP (targetChanged) forces an immediate repaint so the strip never
      // shows the previous target's debuffs while throttled on low; otherwise the full
      // tiers repaint every frame and low coarsens to ~4Hz.
      if (
        nonSelfRepaintDue(
          targetChanged,
          this.lastTargetDebuffsPaintAt,
          now,
          auraRefreshIntervalMs(fxTier),
        )
      ) {
        this.lastTargetDebuffsPaintAt = now;
        this.targetDebuffsPainter.paint(this.targetDebuffsView.tick(target));
      }
      // target/boss cast bar (e.g. Nythraxis' Deathless Rage), shown under the name +
      // HP so the raid sees exactly when to channel the wardstones. The target
      // instance shows the raw cast id and never eats/drinks (no `consume`).
      this.targetCastBarPainter.paint({
        cast: castBarState(target),
        castRemaining: target.castRemaining,
      });
    } else {
      // No target (or a world object): hide the frame. The painter also resets its
      // portrait gate here, so re-acquiring a target repaints (the old -999 reset). Reset
      // the tier cadence id too, so re-acquiring a target bypasses the low-tier throttle
      // and paints immediately (targetChanged becomes true on the next frame with a target).
      this.lastTargetFrameId = null;
      // Clear the target-name live region on the transition to no-target, and reset BOTH the
      // tracker and the re-announce marker so re-acquiring the SAME target re-announces cleanly
      // GATED on the tracker so it fires only on the clear EDGE, never per frame:
      // with no target (e.g. the whole perf tour, which acquires none) the region is never
      // written, so the per-frame floor is unchanged. Direct textContent write (matching the
      // announce above), not the elided setText.
      if (this.lastAnnouncedTargetId !== null) {
        this.targetLiveEl.textContent = '';
        this.targetReannounce.reset();
        this.lastAnnouncedTargetId = null;
      }
      this.targetFramePainter.paint(unitFrameView(ABSENT_TARGET_DESCRIPTOR));
    }

    // cast bar: the player instance localizes the cast id (castDisplayName), layers
    // the player-only eat/drink overlay (consumeBarState), and clears on hide.
    this.playerCastBarPainter.paint({
      cast: castBarState(p),
      castRemaining: p.castRemaining,
      consume: consumeBarState(p.eating, p.drinking),
    });

    // swing timer: fills between melee/ranged auto-attack swings. swingTimer
    // counts DOWN to 0 (ready); swing_timer.ts recovers the full interval from the
    // reset edge so the bar stays accurate under haste and for ranged weapons. The
    // period/timer edge-tracking round-trips through the core (parameter-in /
    // next-state-out): Hud holds the two scalars and feeds them back next frame.
    const swing = swingTimerState(p, target ?? null, this.swingPeriod, this.lastSwingTimer);
    this.swingPeriod = swing.nextPeriod;
    this.lastSwingTimer = swing.nextTimer;
    this.swingTimerPainter.paint(swing);

    // action bar: the slot row, driven by the pure action_bar_view core + the thin
    // ActionBarPainter. Every per-slot icon / cooldown / dimming / count write
    // routes through the elided writer facet; the aria-label keeps its per-frame t()
    // call IN the core while the painter elides the DOM setAttribute (Top risk 4).
    this.renderPetBar();
    if (this.spellbookWindow.isOpen) this.spellbookWindow.tickOpen();
    this.actionBarPainter.paint(
      this.actionBarView.tick({ player: p, target: target ?? null, inventory: sim.inventory }),
    );

    // mobile action ring: the paged touch combat cluster, gated on the touch-mode
    // signal so desktop skips the tick+paint entirely (both the view and painter
    // stay undefined when the ring DOM never got built, e.g. an older cached
    // template). Reuses the exact same world snapshot as the desktop bar.
    if (this.isMobileLayout() && this.mobileActionRingView && this.mobileActionRingPainter) {
      this.mobileActionRingPainter.paint(
        this.mobileActionRingView.tick({
          player: p,
          target: target ?? null,
          inventory: sim.inventory,
        }),
        this.mobileActionPage,
        mobilePageCount(),
      );
    }

    // consumables quick bar: tick+paint ONLY while the row is expanded on touch.
    // The id list is NOT recomputed here: it was snapshotted when the row opened
    // and stays frozen so slots never shift under the player's thumb; counts,
    // usability, and the shared potion-cooldown sweep still derive live from the
    // sim/inventory every tick. Skipping the closed bar entirely is safe for the
    // same reason ring paging is: all of that state lives on the sim, not the
    // view, so the row is correct the frame it opens.
    if (
      this.isMobileLayout() &&
      this.consumablesOpen &&
      this.consumableBarView &&
      this.consumableBarPainter
    ) {
      this.consumableBarPainter.paint(
        this.consumableBarView.tick({
          player: p,
          target: target ?? null,
          inventory: sim.inventory,
        }),
      );
    }

    // xp bar: pre-cap shows the level bar; post-cap fills toward the next virtual
    // level (Max-Level XP Overflow), with distinct prestige/gold styling. The
    // painter caches the #xpbar / .rested / #player-frame refs once and routes the
    // --xp-fill / .rested / class writes through the elided helpers.
    const showOverflow = (this.optionsHooks?.settings.get('showOverflowXp') ?? 1) >= 0.5;
    const bar = xpBarView({
      level: p.level,
      xp: sim.xp,
      lifetimeXp: sim.lifetimeXp,
      restedXp: sim.restedXp,
      showOverflow,
    });
    this.xpBarPainter.paint(bar);

    // FCT painter: drive the pooled floating-combat-text ring on the every-frame
    // tier (folded into the existing `hud` perf bucket, not a second rAF).
    // step() only TTL-recycles each live floater (the number is screen-anchored, positioned
    // once at spawn, so there is no per-frame reposition); an empty pool (no recent combat)
    // returns immediately, so this costs nothing at steady state.
    this.fctPainter.step(now);

    // Death UI. A fresh corpse (dead, spirit not yet released) gets the full-screen
    // Release overlay (a corpse cannot move, so a modal is fine; suppressed in arena).
    // A ghost runs FREELY (no blocking overlay) and the world drains to greyscale; a
    // small non-blocking prompt appears only when in reach of its corpse or a Spirit
    // Healer, carrying just the relevant button. The server re-checks both ranges.
    const ghost = p.dead && p.ghost;
    const deadInArena = p.dead && !!this.sim.arenaInfo?.match;
    document.body.classList.toggle('spirit-mode', ghost);
    this.setDisplay(this.deathOverlayEl, p.dead && !ghost && !deadInArena ? 'flex' : 'none');
    if (ghost) {
      const corpseInRange = !!p.corpsePos && dist2d(p.pos, p.corpsePos) <= GHOST_CORPSE_REZ_RANGE;
      let healerNearby = false;
      for (const ent of this.sim.entities.values()) {
        if (
          ent.kind === 'npc' &&
          ent.templateId === 'spirit_healer' &&
          dist2d(ent.pos, p.pos) <= GHOST_HEALER_RANGE
        ) {
          healerNearby = true;
          break;
        }
      }
      this.setDisplay(this.ghostPromptEl, corpseInRange || healerNearby ? 'flex' : 'none');
      this.setDisplay(this.resurrectCorpseBtnEl, corpseInRange ? '' : 'none');
      this.setDisplay(this.resurrectHealerBtnEl, healerNearby ? '' : 'none');
    } else {
      this.setDisplay(this.ghostPromptEl, 'none');
    }

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
      let bossEngaged = false; // the Nythraxis raid boss is pulled -> its own track
      const dungeon = dungeonAt(p.pos.x);
      const inNythraxisArena = dungeon?.id === 'nythraxis_boss_arena';
      for (const e of sim.entities.values()) {
        if (e.kind !== 'mob' || e.dead) continue;
        if (e.aggroTargetId === sim.playerId) aggroed = true;
        if (e.templateId === 'nythraxis_scourge_of_thornpeak') {
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
      // The Sowfield stadium plays its own jaunty match theme (a positional
      // override inside Eastbrook Vale; the zone LABEL stays Eastbrook Vale,
      // the Sowfield is a poi, not a zone).
      const atSowfield = !inDungeon && isAtSowfield(p.pos.x, p.pos.z);
      const zone = atSowfield
        ? 'vale_cup'
        : musicZoneForLocation(
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
      // Sowfield area music: the 'match' track once a game has kicked off (ball in
      // play or a goal being celebrated), the 'waiting' track any other time you
      // are at the stadium, and silence (procedural score returns) once you leave.
      // Reads whichever match view we hold: our own if playing, else the walk-up
      // spectate view the sim fills only at the Sowfield.
      const cupMatchView = sim.cupInfo?.match ?? sim.cupInfo?.spectate ?? null;
      const cupKickedOff =
        cupMatchView?.phase === 'active' ||
        cupMatchView?.phase === 'goal' ||
        cupMatchView?.phase === 'golden';
      // A private practice bout plays the SAME boarball soundtrack as the real
      // Sowfield (the match beat once it kicks off, the waiting bed before), not
      // the instance/combat theme its far-out pitch would otherwise pick. The
      // practice pitch is an offset instance (match.origin is non-zero); a real
      // match is {0,0} and already covered by atSowfield.
      const myMatch = sim.cupInfo?.match;
      const inPracticeMatch = !!myMatch && (myMatch.origin.x !== 0 || myMatch.origin.z !== 0);
      music.setSowfieldTrack(
        atSowfield || inPracticeMatch ? (cupKickedOff ? 'match' : 'waiting') : null,
      );

      // classic combat indicator: crossed swords + red ring on the player portrait.
      // Routed through the cached ref + the elided toggleClass writer: a counted,
      // change-only write replacing a per-frame raw re-querying classList.toggle.
      this.toggleClass(this.playerFrameEl, 'combat', inCombat);
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
      // Party frames run on the ~4Hz mediumHud band (the enclosing block) for EVERY tier.
      // The tier knobs deliberately do NOT tier them down on low: party-member HP is a healer's
      // only actionable signal (no self-dispel), so a graphics preset must not slow it
      // (ui_tier_knobs). updatePartyFrames already short-circuits an unchanged
      // party via its signature, so an idle frame is near-free without a tier gate.
      this.updatePartyFrames();
      this.updateTradeWindow();
      this.updateArenaStatus();
      this.updateFiestaHud();
      this.yumiPainter.update(this.sim.arenaInfo);
      // Vale Cup surfaces (mediumHud like the arena/fiesta ones): the indicator
      // button, the in-match strip, and the open window redraw.
      this.vcupIndicator.update(buildVcupIndicatorView(this.sim.cupInfo, atSowfield));
      this.vcupMatchHud.update(buildVcupHudView(this.sim.cupInfo));
      this.vcupBriefing.update(buildVcupBriefingView(this.sim.cupInfo));
      this.vcupBetting.update(buildVcupBettingView(this.sim.cupInfo));
      this.updateShootCharge();
      if ($('#map-window').style.display === 'block') this.updateMapWindow();
      if ($('#arena-window').style.display === 'block') this.arenaWindow.render();
      if ($('#valecup-window').style.display === 'block') this.valeCupWindow.render();
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
      if (this.openHeroicVendorNpcId !== null) {
        const npc = sim.entities.get(this.openHeroicVendorNpcId);
        if (!npc || dist2d(p.pos, npc.pos) > 8) this.closeHeroicVendor();
      }
      // Close the quest/gossip dialog once the player walks out of talking range
      // (or the NPC is gone), the same way the vendor window auto-closes above. You
      // open within INTERACT_RANGE (5), so the wider 8 threshold never fires on open.
      if (this.openGossipNpcId !== null) {
        const npc = sim.entities.get(this.openGossipNpcId);
        if (!npc || dist2d(p.pos, npc.pos) > 8) this.closeQuestDialog();
      }
    }

    // when a bout begins, get the queue panel out of the way for the fight. Route through
    // arenaWindow.close() (not a raw hide) so it returns focus to the opener (WCAG 2.4.3):
    // close() guards a not-displayed window and tolerates a stale opener.
    const inArenaMatch = !!this.sim.arenaInfo?.match;
    if (inArenaMatch && !this.arenaMatchSeen && $('#arena-window').style.display === 'block') {
      this.arenaWindow.close();
    }
    this.arenaMatchSeen = inArenaMatch;
    // Same for the Vale Cup: when the whistle calls, get the queue window out of
    // the way of the pitch. Route through close() (focus-return), never a raw hide.
    const inVcupMatch = !!this.sim.cupInfo?.match;
    if (inVcupMatch && !this.vcupMatchSeen && $('#valecup-window').style.display === 'block') {
      this.valeCupWindow.close();
    }
    this.vcupMatchSeen = inVcupMatch;
    if (fastHud) {
      // The minimap canvas redraw is the heaviest fastHud item; tier its
      // cadence (full tiers redraw every fastHud tick = ~10Hz; low throttles to ~3-4Hz).
      // The clock / coords / compass are cheap text and stay at the full fastHud rate.
      if (cadenceDue(this.lastMinimapDrawAt, now, minimapRedrawIntervalMs(fxTier))) {
        this.lastMinimapDrawAt = now;
        this.updateMinimap();
      }
      this.updateClock();
      this.updateMinimapCoords();
      this.updateCompass();
    }
    // Social repaints only on the slow divider, behind the painter's struct/content
    // diff-gate; a content tick swaps the body innerHTML without re-wiring rows.
    if (slowHud) this.socialWindow.refreshIfChanged();
    if (slowHud && this.marketWindow.isOpen) {
      if (!this.nearbyMarketNpc()) this.marketWindow.close();
      else this.marketWindow.refreshIfChanged();
    }
    // The mailbox closes itself when the mail mirror goes null (walked away).
    if (slowHud && this.mailboxWindow.isOpen) this.mailboxWindow.refreshIfChanged();
    // The bank closes itself when the bank mirror goes null (left the banker).
    if (slowHud && this.bankWindow.isOpen) this.bankWindow.refreshIfChanged();
    if (slowHud && this.deedsWindow.isOpen) this.deedsWindow.refreshIfChanged();
    // The deed tracker is always-on chrome (not gated on a window): watched
    // progress climbs from normal play, and earned deeds drop off.
    if (slowHud) this.updateDeedTracker();
    if (slowHud && this.calendarWindow.isOpen) this.calendarWindow.refreshIfChanged();
    if (slowHud) this.updateMailIndicator();
  }

  private initMailIndicator(): void {
    const el = $('#mail-indicator') as HTMLButtonElement;
    this.mailIndicatorEl = el;
    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.openMailbox();
    });
    el.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      ev.stopPropagation();
      this.openMailbox();
    });
  }

  // The envelope indicator by the minimap: visible while unread letters wait.
  // Slow-band, value-diffed writes only (mailUnread changes rarely).
  private updateMailIndicator(): void {
    const el = this.mailIndicatorEl ?? ($('#mail-indicator') as HTMLElement | null);
    if (!el) return;
    this.mailIndicatorEl = el;
    const view = mailIndicatorView(this.sim.mailUnread);
    if (view.count === this.lastMailUnread) return;
    this.lastMailUnread = view.count;
    const count = formatNumber(view.count, { maximumFractionDigits: 0 });
    el.hidden = !view.visible;
    if (view.visible) {
      const badge = el.querySelector<HTMLElement>('.mail-indicator-count');
      if (badge) badge.textContent = count;
      el.setAttribute('aria-label', t('hudChrome.mailbox.indicatorAria', { count }));
      el.title = t('hudChrome.mailbox.indicatorTip', { count });
    }
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
    const bar = this.pfResourceEl; // the cached ref the family painter also writes
    // `.low` is this method's own class (the unit_frame painter toggles only the
    // mutually-exclusive power-type classes, never `low`), so toggling it each frame
    // is cheap and idempotent. Only the expensive style / label writes below are
    // diffed against the cached signature.
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
      // A looted world boss shows in the raid-lockout timer under a world-boss lockout id
      // (see markWorldBossLooted in src/sim/world_boss.ts). worldBossIdFromLockout keeps
      // the prefix convention in one place: it returns the boss mob id (localize as a mob
      // name) or null for an ordinary dungeon/raid id.
      raidName: (id) => {
        const bossId = worldBossIdFromLockout(id);
        if (bossId !== null) return tEntity({ kind: 'mob', id: bossId, field: 'name' });
        // Heroic daily lockouts ride difficulty-scoped ids (<dungeon>:heroic).
        if (id.endsWith(':heroic')) {
          return t('hudChrome.raidLockout.heroicName', {
            name: dungeonDisplayName(id.slice(0, -':heroic'.length)),
          });
        }
        return dungeonDisplayName(id);
      },
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

  private updateQuestTracker(): void {
    const el = $('#quest-tracker');
    const settings = this.optionsHooks?.settings;
    let collapsed = (settings?.get('questTrackerCollapsed') ?? false) === true;
    const quests: TrackedQuest[] = [];
    for (const qp of this.sim.questLog.values()) {
      const quest = QUESTS[qp.questId];
      quests.push({
        id: qp.questId,
        // acceptance-order number, the same one the map badges + side list show
        number: quests.length + 1,
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
      rows += `<div class="qt-title" role="button" tabindex="0" data-quest="${esc(q.id)}"><span class="qt-num">${esc(this.questNumber(q.number))}</span>${esc(q.title)}${q.complete ? ` <span class="quest-complete">(${esc(t('questUi.tracker.complete'))})</span>` : ''}</div>`;
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
      this.delveTrap = this.focusManager.open({ root: () => $('#delve-board') });
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
    const partySize = this.sim.partyInfo?.members.length ?? 1;
    const partyTooLarge = partySize > delve.maxPlayers;
    const canEnter = this.sim.player.level >= delve.minLevel && !partyTooLarge;
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
      const companionId = delve.autoCompanionId ?? 'companion_tessa';
      const companionRank = this.sim.companionUpgrades[companionId] ?? 1;
      const companionRankLabel = t('delveUi.board.companion.rank', {
        rank: formatNumber(companionRank, { maximumFractionDigits: 0 }),
      });
      const companionMaxRank = Math.max(...Object.keys(COMPANION_UPGRADE_COSTS).map(Number));
      const nextRank = companionRank + 1;
      const nextCost = COMPANION_UPGRADE_COSTS[nextRank];
      const companionNameKey = companionId === 'companion_edda' ? 'edda' : 'tessa';
      const companionName = t(`delveUi.board.companion.${companionNameKey}` as TranslationKey);
      let companionAction: string;
      if (companionRank >= companionMaxRank || !nextCost) {
        companionAction = `<div class="delve-companion-max quest-muted">${esc(t('delveUi.board.companion.maxRank'))}</div>`;
      } else {
        const costMarks = formatNumber(nextCost.marks, { maximumFractionDigits: 0 });
        const nextRankLabel = formatNumber(nextRank, { maximumFractionDigits: 0 });
        const affordable = this.sim.delveMarks >= nextCost.marks;
        companionAction =
          `<button type="button" class="btn delve-companion-upgrade" data-companion-upgrade="${esc(companionId)}"` +
          ` aria-label="${esc(t('delveUi.board.companion.upgradeAria', { name: companionName, rank: nextRankLabel, marks: costMarks }))}"` +
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
        `<div class="delve-board-greeting">${esc(t(delve.id === 'drowned_litany' ? 'delveUi.npc.halvenMarsh.greeting' : 'delveUi.npc.halven.greeting', { playerName: this.sim.player.name }))}</div>` +
        `<div class="delve-tier-row">${tierRow}</div>` +
        `<div class="delve-companion-row"><div class="delve-companion-label">${esc(t('delveUi.board.companion.pick'))}</div>` +
        `<div class="delve-companion-name">${esc(companionName)} <span class="quest-muted">(${esc(companionRankLabel)})</span></div>` +
        `<div class="delve-companion-boon quest-muted">${esc(t('delveUi.board.companion.boon'))}</div>` +
        `${companionAction}</div>` +
        `<button type="button" class="btn delve-enter-btn" data-delve-enter aria-label="${esc(t('delveUi.board.enterAria', { delve: delveName, tier: this.selectedDelveTier === 'heroic' ? tierHeroic : tierNormal }))}"${canEnter ? '' : ' disabled'}>${esc(t('delveUi.board.enter'))}</button>`;
    }
    el.innerHTML =
      `<div class="panel-title"><span>${esc(t('delveUi.board.title'))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('questUi.dialog.close'))}">${svgIcon('close')}</button></div>` +
      `<div class="delve-board-name">${esc(delveName)}</div>` +
      `<div class="delve-board-meta">${esc(t('delveUi.board.marks', { count: marks }))}</div>` +
      `<div class="delve-board-req${this.sim.player.level >= delve.minLevel ? '' : ' req-unmet'}">${esc(t('delveUi.board.minLevel', { level: formatNumber(delve.minLevel, { maximumFractionDigits: 0 }) }))}</div>` +
      `<div class="delve-board-req${partyTooLarge ? ' req-unmet' : ''}">${esc(t('delveUi.board.partyTooLarge', { max: formatNumber(delve.maxPlayers, { maximumFractionDigits: 0 }) }))}</div>` +
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
      el.querySelector('[data-companion-upgrade]')?.addEventListener('click', (ev) => {
        const btn = ev.currentTarget as HTMLElement;
        const id = btn.dataset.companionUpgrade;
        if (!id) return;
        this.sim.companionUpgrade(id);
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
    if (focus) this.delveTrap?.focusFirst(tab === 'shop' ? '.delve-shop-buy' : '.delve-enter-btn');
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
    this.delveTrap?.release(restoreFocus);
    this.delveTrap = null;
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
    if (el.style.display !== 'block')
      this.lockpickTrap = this.focusManager.open({ root: () => $('#lockpick-panel') });
    el.style.display = 'block';
    this.bindLockpickKeys();
    this.lockpickWindow.renderAnte(objectId, bountiful);
    this.lockpickTrap?.focusFirst('.lp-ante-btn');
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
    if (el.style.display !== 'block')
      this.lockpickTrap = this.focusManager.open({ root: () => $('#lockpick-panel') });
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
    let html = `<div class="panel-title"><span>${esc(chest ? entityDisplayName(chest) : t('hudChrome.loot.chestTitle'))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('itemUi.loot.close'))}">${svgIcon('close')}</button></div>`;
    for (const s of items) {
      const item = ITEMS[s.itemId];
      html += `<div class="loot-item" data-item="${s.itemId}">${this.itemIcon(item)}<span style="font-size:12px">${esc(itemDisplayName(item))}${s.count > 1 ? ` ${esc(t('itemUi.bags.stackCount', { count: formatNumber(s.count, { maximumFractionDigits: 0 }) }))}` : ''}</span></div>`;
    }
    el.innerHTML = html;
    el.querySelectorAll('[data-item]').forEach((row) => {
      const itemId = (row as HTMLElement).dataset.item ?? '';
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
    el.style.display = 'block';
    this.centerPopupInViewport(el);
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
    this.lockpickWindow.close();
    this.hideTooltip();
    if (this.lockpickKeyHandler) {
      window.removeEventListener('keydown', this.lockpickKeyHandler, true);
      this.lockpickKeyHandler = null;
    }
    this.lockpickTrap?.release(restoreFocus);
    this.lockpickTrap = null;
  }

  // Drowned Reliquary Rite: the difficulty popup opens when a player interacts
  // with the risen reliquary (delveRiteChoosePrompt) and closes once the chosen
  // sequence starts playing (the first delveRitePulse) or on dismiss.
  private openRitePanel(): void {
    const el = $('#delve-rite-panel');
    if (el.style.display !== 'block')
      this.riteTrap = this.focusManager.open({ root: () => $('#delve-rite-panel') });
    el.style.display = 'block';
    this.riteWindow.render();
    this.riteTrap?.focusFirst('.lp-ante-btn');
  }

  private submitRiteChoose(intensity: RiteIntensity): void {
    this.sim.delveRiteChoose(intensity);
    this.closeRitePanel();
  }

  private closeRitePanel(restoreFocus = true): void {
    const el = $('#delve-rite-panel');
    if (el.style.display === 'none') return;
    el.style.display = 'none';
    this.riteTrap?.release(restoreFocus);
    this.riteTrap = null;
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
      // The run ended (walk-out, death release, completion teardown) while the
      // difficulty popup could still be up; do not leave it floating over the
      // outdoor world.
      this.closeRitePanel(false);
      return;
    }
    // State-driven close: the popup is only valid while the rite awaits a
    // choice. The first pulse event also closes it, but that event is
    // interest-scoped to the apse, so a party member elsewhere in the delve
    // relies on this wire-state check instead.
    if (run.rite && run.rite.phase !== 'choose') this.closeRitePanel(false);
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
      run.rite,
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
    // Drowned Reliquary Rite: a phase-by-phase guidance line so the player
    // always knows the next step (approach, watch, repeat with F, claim).
    let riteHint = '';
    if (run.rite) {
      const riteText =
        run.rite.phase === 'choose'
          ? t('delveUi.tracker.riteChoose')
          : run.rite.phase === 'playback'
            ? t('delveUi.tracker.ritePlayback')
            : run.rite.phase === 'input'
              ? t('delveUi.tracker.riteInput', {
                  current: formatNumber(run.rite.current, { maximumFractionDigits: 0 }),
                  total: formatNumber(run.rite.total, { maximumFractionDigits: 0 }),
                })
              : t('delveUi.tracker.riteOpen');
      riteHint = `<div class="dt-obj dt-hint">-> ${esc(riteText)}</div>`;
    }
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
      riteHint +
      exitHint +
      `<div class="dt-obj">- ${esc(t('delveUi.tracker.marks', { count: marks }))}</div>` +
      affixHtml;
    el.querySelectorAll('.dt-affix-icon').forEach((icon) => {
      const affixId = (icon as HTMLElement).dataset.affix ?? '';
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
    const ctx = require2dContext(c);
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
    const ctx = require2dContext(c);
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
    const facing = this.sim.player.facing;
    if (facing === this.lastCompassFacing) return; // pure function of facing: nothing can have changed
    this.lastCompassFacing = facing;
    const view = compassView(facing);
    const visible = this.compassVisibleScratch;
    visible.clear();
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
    // minimapMode (the minimap_markers core) is the single source of truth for the
    // delve-vs-overworld branch (the same isDelvePos + delveRun guard, lifted into the
    // core so hud and the painters never duplicate it).
    const mode = minimapMode(this.sim);
    if (mode === 'delve') {
      // The delve painter owns the '#zone-label' text (written through the
      // write-elision facet) and the full minimap schematic render.
      this.delvePainter.paintMinimapDelve(ctx, this.sim, $('#zone-label'), MINIMAP_SIZE);
      return;
    }
    if (mode === 'yumiMaze') {
      // Protect Yumi: the overworld marker set over the cached maze-wall
      // raster; the strip title stands in for the zone label.
      this.minimapPainter.paintYumiMaze(
        ctx,
        this.sim,
        $('#zone-label'),
        this.minimapZoom,
        t('yumi.hud.title'),
      );
      return;
    }
    // The overworld minimap: a pure marker core (minimap_markers) + the thin canvas
    // painter. It owns the cached terrain blit + the marker draws and writes
    // '#zone-label' through the write-elision facet.
    this.minimapPainter.paintOverworld(
      ctx,
      this.sim,
      $('#zone-label'),
      this.minimapBg,
      this.minimapZoom,
    );
  }

  toggleMeters(): void {
    this.meters.toggle();
  }

  // -------------------------------------------------------------------------
  // The Ashen Coliseum - 1v1 arena panel + in-match banner
  // -------------------------------------------------------------------------

  // The Ashen Coliseum window is owned by arena_window.ts (the painter) + the pure
  // arena_window_view.ts (the offline/live model). Hud stays the coordinator: it
  // forwards the keybind toggle and drives the painter's redraw from the mediumHud
  // band while open. The in-match auto-close + the pinned banner stay here.
  toggleArena(): void {
    this.arenaWindow.toggle();
  }

  toggleValeCup(): void {
    this.valeCupWindow.toggle();
  }

  /** Offline builds enable the Vale Cup practice-vs-bots button (main.ts). */
  setVcupPracticeAvailable(on: boolean): void {
    this.valeCupWindow.setPracticeAvailable(on);
  }

  // The pinned in-match banner: opponent name + countdown / live match timer.
  private updateArenaStatus(): void {
    const el = $('#arena-status');
    const a = this.sim.arenaInfo;
    const m = a?.match ?? null;
    // Protect Yumi carries its own strip (yumi_match_painter) at the same
    // top-center anchor, so the generic VS banner would just overlap it;
    // keep the banner only for the post-bout returning countdown.
    if (!m || (m.yumi && m.state !== 'over')) {
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
      this.hideTooltip(); // a touch marker tip can outlive the window otherwise
      this.syncAnyWindowOpenState();
      return;
    }
    this.closeOtherWindows('#map-window');
    this.mapZoom = 1; // always open at the full-zone view, following the player
    this.mapCenter = null;
    el.style.display = 'block';
    this.updateMapWindow();
    this.syncAnyWindowOpenState();
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

  // The map window shows the zone band the player is standing in (each band is a
  // square); POIs and dungeon portals come from the zone/dungeon data. It redraws
  // while open from hud.update()'s mediumHud band; the painter owns the canvas
  // draw, the cached terrain blit, and the cadence. The delve branch is owned by
  // delve_map_painter (paintWorldMapDelve), the overworld branch by
  // map_window_painter; the pure geometry lives in map_window_view.ts.
  private updateMapWindow(): void {
    const canvas = $('#map-canvas') as unknown as HTMLCanvasElement;
    const ctx = require2dContext(canvas);
    const S = canvas.width;
    const p = this.sim.player;
    const summaryEl = $('#map-summary');

    if (mapWindowMode(this.sim) === 'delve') {
      // The delve painter owns the full world-map schematic render (the area
      // title is drawn on-canvas, since the world map has no DOM zone label).
      this.mapQuestAreas = [];
      this.mapNpcMarkers = [];
      this.delvePainter.paintWorldMapDelve(ctx, this.sim, S);
      const run = this.sim.delveRun;
      const area = run ? delveDisplayName(run.delveId) : '';
      this.setText(summaryEl, t('hud.core.mapSummary', { zone: area }));
      return;
    }

    // inside an instance, show the zone the dungeon's door is in (dungeonAt owns
    // the instance x-band layout); outdoors, follow the committed zone so
    // border-straddling can't thrash the cached terrain regen.
    const dungeon = dungeonAt(p.pos.x);
    const zone: ZoneDef = dungeon
      ? zoneAt(dungeon.doorPos.z)
      : (ZONES.find((z) => z.id === this.lastZoneId) ?? zoneAt(p.pos.z));
    const result = this.mapPainter.paintOverworld(ctx, this.sim, {
      zone,
      bg: this.mapZoneBg(zone), // cached per zone; prewarmed during idle
      canvasSize: S,
      zoom: this.mapZoom,
      center: this.mapCenter,
    });
    this.mapView = result.view;
    this.mapQuestAreas = result.questAreas;
    this.mapNpcMarkers = result.npcs;
    if (!this.mapDrag) canvas.style.cursor = result.cursor;
    this.setText(summaryEl, t('hud.core.mapSummary', { zone: zoneDisplayName(zone.id) }));
  }

  // Tooltip body for a hovered quest-giver glyph on the world map: each quest
  // behind the '!'/'?' shows its title (with the ready-to-turn-in tag on '?'
  // quests) plus its level requirement when the quest declares one, all through
  // existing questUi keys (no new i18n surface).
  private questGiverTooltipHtml(marker: MapNpcMarker): string {
    let html = '';
    for (const ref of marker.quests) {
      const quest = QUESTS[ref.questId];
      if (!quest) continue;
      const readyTag = ref.ready
        ? ` <span class="quest-complete">(${esc(t('questUi.log.readyStatus'))})</span>`
        : '';
      html += `<div class="tt-title">${esc(questTitle(ref.questId))}${readyTag}</div>`;
      if (quest.minLevel) {
        html += `<div class="tt-quest-req">${esc(
          t('questUi.detail.requiresLevel', { level: this.questNumber(quest.minLevel) }),
        )}</div>`;
      }
    }
    return html;
  }

  // Tooltip body for hovered quest-objective areas on the world map: per quest,
  // its title plus each hovered objective's tracker-style "label current/total"
  // line, all through the existing questUi keys + formatters (no new i18n
  // surface). Empty string when nothing under the cursor resolves.
  private questAreaTooltipHtml(refs: readonly QuestObjectiveRef[]): string {
    const byQuest = new Map<string, number[]>();
    for (const ref of refs) {
      const list = byQuest.get(ref.questId);
      if (list) list.push(ref.objectiveIndex);
      else byQuest.set(ref.questId, [ref.objectiveIndex]);
    }
    let html = '';
    for (const [questId, objectiveIndexes] of byQuest) {
      const quest = QUESTS[questId];
      const qp = this.sim.questLog.get(questId);
      if (!quest || !qp) continue;
      let lines = '';
      for (const i of objectiveIndexes) {
        const obj = quest.objectives[i];
        if (!obj) continue;
        const current = Math.min(qp.counts[i] ?? 0, obj.count);
        lines += `<div>${esc(this.questProgressText(questObjectiveLabel(questId, i), current, obj.count))}</div>`;
      }
      if (lines) html += `<div class="tt-title">${esc(questTitle(questId))}</div>${lines}`;
    }
    return html;
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
  // Personal/UI sounds stay on the sampled audio.* facade in handleEvents.
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
        const src = sim.entities.get(ev.sourceId) ?? null;
        const swing = playerSwingCueForDamage(ev, src);
        if (swing && src) {
          this.combat(swing, src.pos.x, src.pos.y, src.pos.z, 0.5, { cooldown: 0.08 });
        }
        if (ev.kind === 'miss' || ev.kind === 'dodge' || ev.kind === 'resist') {
          this.combat('combat_dodge', tp.x, tp.y, tp.z, 0.5);
          return;
        }
        if (ev.kind === 'parry') {
          this.combat('combat_parry', tp.x, tp.y, tp.z, 0.6);
          return;
        }
        if (src?.kind === 'mob') this.playAttackerSfx(src);
        // a struck mob vocalizes its aggro alert the first time it's engaged
        // (camp engage), whether you hit it or it hits you.
        if (tgt.kind === 'mob') this.ensureMobEngaged(tgt);
        const impact = impactCueForDamage(ev, tgt);
        if (shouldPlayCombatImpactForTarget(tgt)) {
          if (impact) this.combat(impact, tp.x, tp.y, tp.z, 0.75, { cooldown: 0.05 });
        }
        if (ev.crit && shouldPlayCritSfxForTarget(tgt))
          this.combat('combat_crit', tp.x, tp.y, tp.z, 0.7);
        // pain vocalization only on a crit — never on ordinary hits.
        if (ev.crit && ev.targetId === sim.playerId) {
          this.combat('player_hurt', tp.x, tp.y, tp.z, 0.55, { cooldown: 0.3 });
        } else if (ev.crit && tgt.kind === 'mob' && shouldPlayCritSfxForTarget(tgt)) {
          const voice = availableMobVoiceCue(tgt.templateId, 'attack');
          if (voice && shouldPlayMobVoiceSfxForEntity(tgt))
            this.combat(voice, tp.x, tp.y, tp.z, 0.6, { rate: 1.25, cooldown: 0.1 });
        }
        return;
      }
      case 'castStart': {
        const ent = sim.entities.get(ev.entityId);
        // Chain Heal uses a custom one-shot healing cast clip (cast_chain_heal)
        // instead of the earthy nature cast loop its school would otherwise pick.
        if (ent && ev.ability === 'chain_heal') {
          this.combat('cast_chain_heal', ent.pos.x, ent.pos.y, ent.pos.z, 0.45);
          return;
        }
        const key = castCueForAbility(ev.ability);
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
        const cue = spellFxCue(ev);
        const anchor = cue ? sim.entities.get(cue.anchorId) : null;
        if (cue && anchor) this.combat(cue.key, anchor.pos.x, anchor.pos.y, anchor.pos.z, 0.6);
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
        const target = sim.entities.get(ev.targetId);
        const aura = ev.gained
          ? (target?.auras.find((entry) => entry.name === ev.name) ?? null)
          : null;
        const cue = auraApplyCue(ev, aura);
        if (!cue) return;
        const p = sim.player.pos;
        this.combat(cue, p.x, p.y, p.z, 0.4, {
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
          const voice = availableMobVoiceCue(ent.templateId, 'death');
          if (voice && shouldPlayMobVoiceSfxForEntity(ent)) this.combat(voice, p.x, p.y, p.z, 0.8);
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
    const voice = availableMobVoiceCue(mob.templateId, 'aggro');
    if (voice && shouldPlayMobVoiceSfxForEntity(mob))
      this.combat(voice, mob.pos.x, mob.pos.y, mob.pos.z, 0.7);
    return true;
  }

  // Attacker side of a mob damage event: it roars on engage, then grunts on
  // subsequent strikes. Player swings are resolved earlier from the damage event.
  private playAttackerSfx(src: Entity): void {
    if (src.kind === 'mob') {
      if (this.ensureMobEngaged(src)) return; // just fired the aggro alert
      const voice = availableMobVoiceCue(src.templateId, 'attack');
      if (voice && shouldPlayMobVoiceSfxForEntity(src))
        this.combat(voice, src.pos.x, src.pos.y, src.pos.z, 0.55, { cooldown: 0.25 });
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
    // Book of Deeds unlocks batch across the whole drain (handleDeedUnlocks):
    // banners coalesce to the last unlock, retro back-credits collapse into
    // one summary line, and the celebration sound plays once.
    const deedUnlocks: { deedId: string; retro?: boolean }[] = [];
    // One spawn clock for the whole batch: FCT floaters spawned from this event burst
    // share a bornAt, and the pooled painter's step() evicts each once now - bornAt >= ttl.
    const now = performance.now();
    for (const ev of events) {
      // Personal events for OTHER players exist only offline: the offline
      // main.ts loop hands the WHOLE sim.tick() batch to this method, so a bot
      // player's pid-scoped events (its queue log lines, its error notices,
      // e.g. Vale Cup practice bots) would surface on the local HUD without
      // this gate. Online the server routes per-session, so every event here
      // is already ours. pid-LESS events (world theatre like the anchored vcup
      // kickoff/goal/save/golden/end) pass through to walk-up bystanders.
      // This gate is deliberately kind-independent: `pid` on a SimEvent MEANS
      // personal / owner-only (src/sim/types.ts SimEvent contract), and the
      // server's router enforces the same rule online (ev.pid === anchorPid in
      // server/game.ts), so an event a bystander should see must be pid-less
      // by construction on every host.
      if (ev.pid !== undefined && ev.pid !== sim.playerId) continue;
      // Vale Cup walk-up theatre (kickoff/goal/save/golden/end/countdown) is
      // anchored at its own match's pitch. Only play it when that pitch is NEAR
      // the local player, so you see the game in front of you (the Sowfield when
      // you walk up, or your OWN private practice pitch) and never another
      // match's alerts leaking in, e.g. a bot showcase on the main pitch spamming
      // a player off in a distant practice instance. Offline hands the whole tick
      // batch here, so this proximity gate is what keeps matches from crossing.
      if (VCUP_WALKUP_EVENTS.has(ev.type)) {
        const a = ev as unknown as { x: number; z: number };
        if (isAtSowfield(a.x, a.z)) {
          // Real Sowfield match: its theatre is gated to the stadium footprint,
          // the same predicate that arms the stadium music, so no kickoff/goal
          // banner leaks into Eastbrook or the wider map.
          if (!isAtSowfield(sim.player.pos.x, sim.player.pos.z)) continue;
        } else {
          // A private practice instance (a far, isolated pitch): show its
          // theatre only to someone standing on that same pitch, never the main
          // match's audience.
          const dx = a.x - sim.player.pos.x;
          const dz = a.z - sim.player.pos.z;
          if (dx * dx + dz * dz > VCUP_THEATRE_RADIUS * VCUP_THEATRE_RADIUS) continue;
        }
      }
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
          if (ev.kind === 'miss' || ev.kind === 'dodge' || ev.kind === 'resist') {
            // self vs other (carried on the shape's isSelf) drives the avoidance colour
            // token (#bbb vs #fff); the localized word stays at the call site. A resisted
            // spell is an avoidance word like miss/dodge (classic fidelity: spells resist,
            // not miss).
            const shape = fctSpawnShape({
              type: 'damage',
              damageKind: ev.kind,
              ability: false,
              crit: false,
              isPlayerSource,
              isPlayerTarget,
            });
            if (shape)
              this.fctPainter.spawn(
                {
                  ...shape,
                  text:
                    ev.kind === 'miss'
                      ? t('hud.combat.floatingMiss')
                      : ev.kind === 'dodge'
                        ? t('hud.combat.floatingDodge')
                        : t('hud.combat.floatingResist'),
                  target: tgt,
                },
                now,
              );
            // Fiesta: a dodge is a moment — pop a big exaggerated word for it.
            if (ev.kind === 'dodge' && (isPlayerSource || isPlayerTarget) && this.inFiesta()) {
              this.fiestaWordPop(t('fiesta.word.dodge'), '#7fd4ff', 1);
              this.renderer.addShake(0.15);
            }
            if (isPlayerSource) {
              const logKey =
                ev.kind === 'miss'
                  ? 'hud.combat.miss'
                  : ev.kind === 'dodge'
                    ? 'hud.combat.dodged'
                    : 'hud.combat.resisted';
              this.combatLog(
                t(logKey, {
                  ability: combatAbilityName(ev.ability),
                  target: entityDisplayName(tgt),
                }),
                '#ccc',
              );
            }
            break;
          }
          // A landed hit: the mapper resolves damage-done (player dealt to other) vs
          // damage-taken (player took) vs null (a hit between two non-player entities, which
          // floats nothing). The amount text + target entity stay at the call site.
          const hitShape = fctSpawnShape({
            type: 'damage',
            damageKind: 'hit',
            ability: !!ev.ability,
            crit: ev.crit,
            isPlayerSource,
            isPlayerTarget,
          });
          if (
            hitShape &&
            (hitShape.kind === 'damage-done-ability' || hitShape.kind === 'damage-done-auto')
          ) {
            this.fctPainter.spawn(
              { ...hitShape, text: `${ev.amount}${ev.crit ? '!' : ''}`, target: tgt },
              now,
            );
            this.combatLog(
              t(ev.crit ? 'hud.combat.damageDoneCrit' : 'hud.combat.damageDone', {
                ability: combatAbilityName(ev.ability),
                target: entityDisplayName(tgt),
                amount: ev.amount,
              }),
              ev.ability ? '#ffe97a' : '#eee',
            );
            // combat SFX (swing + material/school impact + crit) is spatial now;
            // see playEventSfx, which runs for every damage event above.
            // Fiesta: every blow you land kicks the camera (bigger on a crit).
            if (this.inFiesta()) this.renderer.addShake(ev.crit ? 0.3 : 0.12);
          } else if (hitShape && hitShape.kind === 'damage-taken') {
            this.fctPainter.spawn({ ...hitShape, text: `-${ev.amount}`, target: tgt }, now);
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
            const shape = fctSpawnShape({
              type: 'heal',
              crit: false,
              isPlayerTarget: ev.targetId === sim.playerId,
            });
            if (healed && shape)
              this.fctPainter.spawn({ ...shape, text: `+${ev.amount}`, target: healed }, now);
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
          const xpShape = fctSpawnShape({ type: 'xp' });
          if (xpShape)
            this.fctPainter.spawn(
              {
                ...xpShape,
                text: t('hud.core.xpFloat', { amount: ev.amount }),
                target: sim.player,
              },
              now,
            );
          if (ev.rested && ev.rested > 0) {
            const restedShape = fctSpawnShape({ type: 'rested-xp' });
            if (restedShape)
              this.fctPainter.spawn(
                {
                  ...restedShape,
                  text: t('hud.core.xpFloatRested', { amount: ev.rested }),
                  target: sim.player,
                },
                now,
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
        case 'honor': {
          const amount = formatNumber(ev.amount, { maximumFractionDigits: 0 });
          const honorShape = fctSpawnShape({ type: 'honor' });
          if (honorShape) {
            this.fctPainter.spawn(
              {
                ...honorShape,
                text: t('hudChrome.warfare.honorFloat', { amount }),
                target: sim.player,
              },
              now,
            );
          }
          this.combatLog(
            t('hudChrome.warfare.honorGain', {
              amount,
              reason: t(HONOR_REASON_KEYS[ev.reason]),
            }),
            '#ffd100',
          );
          break;
        }
        case 'levelup': {
          this.showBanner(t('hud.core.levelBanner', { level: ev.level }));
          this.log(t('hud.core.levelLog', { level: ev.level }), '#ffd100');
          audio.levelUp();
          if (ev.level === 5) {
            const characterId = (this.sim as unknown as { characterId?: number }).characterId;
            trackMetaPixel(
              'ReachedLevel5',
              { level: ev.level },
              characterId ? { eventID: `lvl5_${characterId}` } : undefined,
            );
          }
          // First talent point (and spec) unlock — nudge the player to the panel.
          if (ev.level === FIRST_TALENT_LEVEL && talentsFor(this.sim.cfg.playerClass)) {
            this.showBanner(t('game.talents.unlockBanner'));
            this.log(t('game.talents.unlockHint'), '#ffd100');
          }
          break;
        }
        case 'virtualLevelUp': {
          // cosmetic post-cap "level up" — reuses the levelup banner + sound
          this.showBanner(
            `${t('game.progression.virtualLevelUp')} ${formatNumber(ev.level, { maximumFractionDigits: 0 })}!`,
          );
          this.log(
            `${t('game.progression.virtualLevelUp')} ${formatNumber(ev.level, { maximumFractionDigits: 0 })}!`,
            '#ffd100',
          );
          audio.levelUp();
          break;
        }
        case 'deedUnlocked': {
          deedUnlocks.push(ev);
          break;
        }
        case 'learnAbility':
          // A newly granted ability (level-up or spec signature) must appear in
          // an open spellbook right away, not on the next manual reopen.
          if (this.spellbookWindow.isOpen) this.spellbookWindow.render();
          break; // logged by sim
        case 'comboPoint':
          break;
        case 'loot': {
          this.log(this.localizeLootText(ev.text), '#7fdc4f');
          if (
            / wins .+ \(\d+\)$/.test(ev.text) ||
            /^Everyone passed on .+\.$/.test(ev.text) ||
            / assigned .+ to .+\.$/.test(ev.text) ||
            /^.+ was not assigned and is free for all\.$/.test(ev.text)
          )
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
        case 'craftResult': {
          if (ev.ok && ev.itemId) {
            const item = ITEMS[ev.itemId];
            const name = item ? itemDisplayName(item) : ev.itemId;
            this.log(t('hudChrome.crafting.craftedToast', { name }), '#7fdc4f');
            audio.lootItem();
          } else if (!ev.ok) {
            this.log(
              t(
                ev.reason === 'unknown_recipe'
                  ? 'hudChrome.crafting.unknownRecipe'
                  : ev.reason === 'combo_requirement_unmet'
                    ? 'hudChrome.crafting.comboRequirementUnmet'
                    : ev.reason === 'not_at_hub'
                      ? 'hudChrome.crafting.notAtHub'
                      : ev.reason === 'throttled'
                        ? 'hudChrome.crafting.throttled'
                        : ev.reason === 'recipe_not_learned'
                          ? 'hudChrome.crafting.recipeNotLearned'
                          : 'hudChrome.crafting.insufficientMaterials',
              ),
              '#ff6b6b',
            );
          }
          if ($('#crafting-window').style.display === 'block') this.renderCrafting();
          break;
        }
        case 'lootRoll': {
          this.showLootRoll(ev);
          break;
        }
        case 'masterLoot': {
          this.showMasterLoot(ev);
          break;
        }
        case 'vendor': {
          if ($('#bags').style.display !== 'none') this.renderBags();
          if (this.openVendorNpcId !== null) this.renderVendor();
          // A Heroic Marks purchase rides the same 'vendor' event; refresh the
          // shop so the balance and per-offer affordability update after a buy.
          if (this.openHeroicVendorNpcId !== null) this.renderHeroicVendor();
          // A delve Marks purchase rides the same 'vendor' event; refresh the shop
          // tab so the balance and per-offer affordability update after a buy.
          if (this.openDelveBoardNpcId !== null) this.renderDelveBoard();
          break;
        }
        case 'skinEvent':
          this.openSkinEvent(ev.rank, ev.catalog === 'mech' ? { mech: true } : undefined);
          break;
        case 'mailbox':
          // Keyboard/sim interact at a mailbox object: open the mail window.
          this.openMailbox();
          break;
        case 'bank':
          // Keyboard/sim interact at a banker NPC: open the bank window.
          this.openBank();
          break;
        case 'mailArrived': {
          // Player names splice verbatim; authored letters carry their
          // letterId, so the sender localizes through the entity dictionary
          // exactly like the mailbox window does.
          const sender = ev.letterId
            ? tEntity({ kind: 'letter', id: ev.letterId, field: 'sender' })
            : ev.senderName;
          audio.whisper();
          this.showBanner(t('hudChrome.mailbox.arrivedBanner', { name: sender }));
          this.log(t('hudChrome.mailbox.arrivedLog', { name: sender }), '#c8f7c5');
          this.lastMailUnread = -1; // force the envelope indicator to repaint
          break;
        }
        case 'mailResult': {
          const values = {
            name: ev.name ?? '',
            count: formatNumber(ev.value ?? 0, { maximumFractionDigits: 0 }),
            amount: formatLocalizedMoney(ev.value ?? 0),
            postage: formatLocalizedMoney(ev.value ?? 0),
          };
          if (ev.code === 'sent') {
            audio.coin();
            this.log(t('hudChrome.mailbox.result.sent', values), '#c8f7c5');
          } else if (ev.code === 'collected') {
            this.log(t('hudChrome.mailbox.result.collected', values), '#c8f7c5');
          } else {
            this.showError(t(MAIL_RESULT_ERROR_KEYS[ev.code], values));
          }
          this.mailboxWindow.onMailResult(ev.code);
          this.lastMailUnread = -1;
          break;
        }
        case 'calendarResult': {
          if (ev.code === 'created' || ev.code === 'removed') {
            this.log(t(CALENDAR_RESULT_KEYS[ev.code]), '#c8f7c5');
          } else {
            this.showError(t(CALENDAR_RESULT_KEYS[ev.code]));
          }
          this.calendarWindow.onCalendarResult(ev.code);
          break;
        }
        case 'deedBroadcast': {
          // A guildmate's or followed friend's marquee unlock. Id-based on
          // the wire (server sends the deed id, never English); the visible
          // line composes in deed_i18n (Node-pinned there), in the guild-chat
          // green so it reads as social news.
          this.log(deedBroadcastLine(ev.characterName, ev.deedId), '#40d264');
          break;
        }
        case 'error':
          this.showError(this.localizeErrorText(ev.text));
          break;
        case 'questAccepted':
          sfx.playUi('quest_accept', { gain: 1.8 });
          this.refreshGossip();
          break;
        case 'questProgress': {
          const progressText = this.localizeQuestProgressText(ev.questId, ev.text);
          this.log(progressText, '#dcd29f');
          // The classic yellow top-center flash ("Forest Wolf slain: 3/8"); the
          // log line above stays the durable, announced copy.
          this.questBanner.show(progressText);
          this.refreshGossip();
          break;
        }
        case 'questReady': {
          this.showBanner(
            t('questUi.logs.ready', {
              name: questTitle(ev.questId),
              status: t('questUi.log.readyStatus'),
            }),
          );
          sfx.playUi('quest_ready', { gain: 4.5 });
          this.refreshGossip();
          break;
        }
        case 'questDone':
          sfx.playUi('quest_complete', { gain: 1.8 });
          this.refreshGossip();
          break;
        case 'chat': {
          // OFFLINE ONLY. Online, the server drops an ignored player's public chat
          // before it reaches us (and honours the whisper/roll carve-outs), so
          // consulting the local list here as well would resurrect stale ignores
          // the player has since cleared from their account.
          if (this.sim.socialInfo === null && this.localIgnoredNames.has(ignoreKey(ev.from))) break;
          switch (ev.channel) {
            case 'party':
              this.chatLogFrom(
                ev.from,
                ev.text,
                '#7fd4ff',
                CHAT_TEMPLATE_KEYS.party,
                'party',
                ev.fromPid,
                ev.flair,
                ev.fromTitle,
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
                ev.flair,
                ev.fromTitle,
              );
              break;
            case 'whisper':
              // The "To {name}" echo DISPLAYS the recipient, so the sender's
              // fromTitle must never decorate it (untitled beats mislabeled).
              if (ev.to)
                this.chatLogFrom(
                  ev.to,
                  ev.text,
                  '#ff80ff',
                  CHAT_TEMPLATE_KEYS.toWhisper,
                  'whisper',
                  ev.fromPid,
                  ev.flair,
                );
              else {
                this.chatLogFrom(
                  ev.from,
                  ev.text,
                  '#ff80ff',
                  CHAT_TEMPLATE_KEYS.whisper,
                  'whisper',
                  ev.fromPid,
                  ev.flair,
                  ev.fromTitle,
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
                ev.flair,
                ev.fromTitle,
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
                ev.flair,
                ev.fromTitle,
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
                ev.flair,
                ev.fromTitle,
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
                ev.flair,
                ev.fromTitle,
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
                ev.flair,
                ev.fromTitle,
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
                ev.flair,
                ev.fromTitle,
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
                ev.flair,
                ev.fromTitle,
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
                ev.flair,
                ev.fromTitle,
              );
              break;
          }
          if (
            (ev.channel === 'say' || ev.channel === 'yell' || ev.channel === 'emote') &&
            ev.entityId !== undefined
          ) {
            const masked = this.maskChat(this.chatLinkPlainText(ev.text));
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
            if (voiced.play) {
              voice.play(voiced.state.key, { gain: voicedYellGain(ev.from) });
              // A distinct overheard yell, not a dialogue: do not let the per-frame
              // distance fade attenuate it by a talked-to NPC's position.
              this.voiceNpcId = null;
            }
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
            const shape = fctSpawnShape({
              type: 'heal',
              crit: ev.crit,
              isPlayerTarget: ev.targetId === sim.playerId,
            });
            if (shape)
              this.fctPainter.spawn(
                { ...shape, text: `+${ev.amount}${ev.crit ? '!' : ''}`, target: tgt },
                now,
              );
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
        case 'readyCheckStart':
          audio.readyCheck();
          this.showPrompt(
            t('hudChrome.readyCheck.prompt', { name: `<b>${esc(ev.fromName)}</b>` }),
            t('hudChrome.readyCheck.ready'),
            () => this.sim.readyCheckRespond(true),
            () => this.sim.readyCheckRespond(false),
            t('hudChrome.readyCheck.notReady'),
            // Ignoring the prompt must read as "no response", not "not ready":
            // let the sim's own 30s timeout bucket the straggler.
            () => {},
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
          if (ev.format === 'yumi3' || ev.format === 'yumi5') {
            // Unranked objective mode; sudden death guarantees no draws.
            // Personal per participant: keep only the local player's copy
            // (offline the sim hands every fighter's copy to the one HUD).
            if (ev.pid !== undefined && ev.pid !== sim.playerId) break;
            this.yumiPainter.reset();
            if (ev.won) {
              this.showBanner(t('yumi.end.win'));
              this.combatLog(t('yumi.end.win'), '#7fdc4f');
              audio.fiestaWave();
            } else {
              this.showBanner(t('yumi.end.loss'));
              this.combatLog(t('yumi.end.loss'), '#ff7a6a');
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
        // The yumi events are personal per participant; offline the sim hands
        // EVERY player's copy to the one local HUD, so each arm keeps only the
        // local player's (the same reason the renderer arm filters).
        case 'yumiStatus':
          if (ev.pid === sim.playerId) this.yumiPainter.onStatus(ev);
          break;
        case 'yumiDown':
          if (ev.pid === sim.playerId) {
            this.yumiPainter.onDown(ev.seconds);
            audio.fiestaDown();
          }
          break;
        case 'yumiSuddenDeath':
          if (ev.pid === sim.playerId) {
            this.showBanner(t('yumi.banner.sudden'));
            this.combatLog(t('yumi.banner.sudden'), '#ff7a6a');
            audio.fiestaWave();
          }
          break;
        case 'yumiTeleport': {
          if (ev.pid !== sim.playerId) break;
          // Two events per relocation (one per cat); cue once, on my team's cat.
          const y = this.sim.arenaInfo?.match?.yumi;
          const myCat = y ? (y.team === 'A' ? y.yumiA.entityId : y.yumiB.entityId) : -1;
          if (ev.catId === myCat) {
            this.showBanner(t('yumi.banner.teleport'));
            this.log(t('yumi.banner.teleport'), '#7fd7ff');
          }
          break;
        }
        // The Vale Cup (docs/prd/vale-cup.md): queue lifecycle events are
        // personal (pid); the match-theatre events (countdown/kickoff/goal/
        // save/golden/end) are pid-LESS with a world anchor so walk-up
        // bystanders at the Sowfield see the same banners; every string here
        // reads correctly for a spectator (nations + score ride the event).
        case 'vcupQueued':
          this.log(
            t('hudChrome.vcup.logQueued', {
              bracket: t('hudChrome.vcup.bracketLabel', {
                n: formatNumber(ev.bracket, { maximumFractionDigits: 0 }),
              }),
              position: formatNumber(ev.position, { maximumFractionDigits: 0 }),
            }),
            '#ffa040',
          );
          break;
        case 'vcupUnqueued':
          this.log(t('hudChrome.vcup.logUnqueued'), '#ffa040');
          break;
        case 'vcupFound': {
          const nationA = vcupNationName(ev.nationA);
          const nationB = vcupNationName(ev.nationB);
          this.showBanner(t('hudChrome.vcup.bannerFound', { nationA, nationB }));
          this.log(t('hudChrome.vcup.logFound', { nationA, nationB }), '#ffa040');
          const allies = [t('hud.core.you'), ...ev.allies.map((c) => c.name)].join(', ');
          const enemies = ev.enemies.map((c) => c.name).join(', ');
          if (enemies) this.log(t('hudChrome.vcup.logRoster', { allies, enemies }), '#ffa040');
          audio.duelChallenge();
          break;
        }
        case 'vcupCountdown':
          this.showBanner(
            t('hudChrome.vcup.bannerCountdown', {
              seconds: formatNumber(ev.seconds, { maximumFractionDigits: 0 }),
            }),
          );
          audio.duelCountdownTick();
          break;
        case 'vcupKickoff':
          this.showBanner(t('hudChrome.vcup.bannerKickoff'));
          audio.duelStart();
          break;
        case 'vcupGoal': {
          const scoringNation = vcupNationName(ev.team === 'A' ? ev.nationA : ev.nationB);
          this.showBanner(t('hudChrome.vcup.bannerGoal', { nation: scoringNation }));
          this.combatLog(
            t('hudChrome.vcup.logGoal', {
              name: ev.scorerName,
              nation: scoringNation,
              nationA: vcupNationName(ev.nationA),
              scoreA: formatNumber(ev.scoreA, { maximumFractionDigits: 0 }),
              nationB: vcupNationName(ev.nationB),
              scoreB: formatNumber(ev.scoreB, { maximumFractionDigits: 0 }),
            }),
            '#ffd24a',
          );
          this.renderer.addShake(0.4);
          // the Sowfield's own horn + crowd (src/game/sfx.ts, render handoff)
          sfx.goalHorn();
          sfx.crowdRoar();
          break;
        }
        case 'vcupSave':
          this.showBanner(t('hudChrome.vcup.bannerSave', { name: ev.keeperName }));
          this.combatLog(t('hudChrome.vcup.logSave', { name: ev.keeperName }), '#7fd4ff');
          audio.fiestaScorePing(true);
          sfx.crowdRoar(0.5);
          break;
        case 'vcupBetSettled': {
          const amount = formatLocalizedMoney(ev.payout);
          if (ev.outcome === 'won') {
            this.showBanner(t('hudChrome.vcup.bet.wonBanner'));
            this.combatLog(t('hudChrome.vcup.bet.wonLog', { amount }), '#ffd24a');
            sfx.crowdRoar(0.5);
          } else if (ev.outcome === 'refunded') {
            this.combatLog(t('hudChrome.vcup.bet.refundLog', { amount }), '#7fd4ff');
          } else {
            this.combatLog(
              t('hudChrome.vcup.bet.lostLog', { amount: formatLocalizedMoney(ev.stake) }),
              '#fa6',
            );
          }
          break;
        }
        case 'vcupGolden':
          this.showBanner(t('hudChrome.vcup.bannerGolden'));
          audio.fiestaWave();
          break;
        case 'vcupEnd':
          this.showBanner(
            t('hudChrome.vcup.bannerEnd', {
              nationA: vcupNationName(ev.nationA),
              scoreA: formatNumber(ev.scoreA, { maximumFractionDigits: 0 }),
              nationB: vcupNationName(ev.nationB),
              scoreB: formatNumber(ev.scoreB, { maximumFractionDigits: 0 }),
            }),
          );
          audio.duelEnd();
          sfx.crowdRoar();
          break;
        case 'vcupResult':
          if (ev.draw) {
            this.showBanner(t('hudChrome.vcup.bannerDraw'));
            this.combatLog(t('hudChrome.vcup.logDraw'), '#fa6');
            audio.duelEnd();
          } else if (ev.won) {
            this.showBanner(t('hudChrome.vcup.bannerWin'));
            this.combatLog(t('hudChrome.vcup.logWin'), '#7fdc4f');
            audio.duelEnd();
          } else {
            this.showBanner(t('hudChrome.vcup.bannerLoss'));
            this.combatLog(t('hudChrome.vcup.logLoss'), '#ff7a6a');
            audio.death();
          }
          break;
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
          sfx.playUi('lockpick_begin');
          break;
        case 'lockpickStep': {
          this.lockpickWindow.onStep(ev.result);
          switch (ev.result) {
            case 'advanced': {
              let pick = Math.floor(Math.random() * 4);
              if (pick === lpAdvancedLast) pick = (pick + 1) % 4;
              lpAdvancedLast = pick;
              sfx.playUi(`lockpick_advanced_${pick + 1}`);
              break;
            }
            case 'slip':
              sfx.playUi('lockpick_slip');
              break;
            case 'bind':
              sfx.playUi('lockpick_bind');
              break;
            case 'trap':
              sfx.playUi('lockpick_trap');
              break;
            case 'pageCleared':
              sfx.playUi('lockpick_page_cleared');
              break;
            case 'retry':
              sfx.playUi('lockpick_retry');
              break;
            case 'success':
              sfx.playUi('lockpick_success');
              break;
            case 'fail':
              sfx.playUi('lockpick_fail');
              break;
          }
          break;
        }
        case 'lockpickEnd':
          this.endLockpick(ev.outcome, ev.lootTier);
          if (ev.outcome === 'success') sfx.playUi('lockpick_end');
          break;
        case 'lockpickBonus': {
          const tier =
            ev.tier === 'premium'
              ? t('sim.lockpick.tierPremium')
              : ev.tier === 'medium'
                ? t('sim.lockpick.tierMedium')
                : t('sim.lockpick.tierLow');
          this.combatLog(t('sim.lockpick.lockYields', { tier }), '#ffdd88');
          sfx.playUi('lockpick_bonus');
          break;
        }
        case 'delveRiteChoosePrompt':
          this.openRitePanel();
          break;
        case 'delveRitePulse':
          // The chosen sequence is playing; the difficulty popup is no longer needed.
          this.closeRitePanel(false);
          break;
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
          const KNOWN_BARKS = [
            'run_start',
            'combat_start',
            'low_hp',
            'trap_spotted',
            'boss_pull',
            'ally_revive',
            'completion',
          ];
          if (!KNOWN_BARKS.includes(ev.barkId)) break;
          // The event carries the speaker: companionState can be momentarily
          // null online (event/snapshot ordering), which used to fall back to
          // Tessa's name and lines during an Edda run.
          const companionKey = ev.companionId === 'companion_edda' ? 'edda' : 'tessa';
          const line = t(`delveUi.companion.${companionKey}.${ev.barkId}` as TranslationKey, {
            playerName: this.sim.player.name,
          });
          const companion = this.sim.companionState;
          if (companion) this.renderer.showChatBubble(companion.entityId, line, false);
          this.combatLog(
            t('delveUi.companion.barkLine', {
              name: t(`delveUi.board.companion.${companionKey}` as TranslationKey),
              line,
            }),
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
          // Deferred "Auto-Attack on Ability Use" (timed casts): engage only when
          // the player's own cast COMPLETES, so the aggro happens as the damage
          // lands, never at cast start (the aggro-before-damage bug). An
          // interrupted/canceled cast just drops the pending engage; the target
          // is re-validated since the cast itself may have killed or cleared it.
          if (ev.entityId === sim.playerId && this.pendingAutoAttackOnCastEnd) {
            this.pendingAutoAttackOnCastEnd = false;
            if (ev.success) {
              const castTid = sim.player.targetId;
              const castTarget = castTid !== null ? (sim.entities.get(castTid) ?? null) : null;
              if (hasAutoAttackTarget(castTarget)) this.sim.startAutoAttack();
            }
          }
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
    if (deedUnlocks.length > 0) this.handleDeedUnlocks(deedUnlocks);
  }

  // The earned moment, planned purely (deeds_view buildDeedUnlockPlan) so the
  // batching rules stay unit-pinned: each fresh unlock gets a gold log line
  // (the durable copy) and title rewards a second hint line; the single
  // banner slot shows the drain's last unlock; one celebration sound per
  // drain. The on-join retro catch-up draws NO banner and NO audio, just one
  // localized summary count.
  private handleDeedUnlocks(events: { deedId: string; retro?: boolean }[]): void {
    const plan = buildDeedUnlockPlan(events, DEEDS);
    for (const id of plan.logIds) {
      this.log(t('hudChrome.deeds.unlockedBanner', { name: deedName(id) }), '#ffd100');
    }
    for (const id of plan.titleHintIds) {
      this.log(t('hudChrome.deeds.unlockedTitleHint', { title: deedTitleText(id) }), '#ffd100');
    }
    if (plan.bannerId !== null) {
      const bannerText = t('hudChrome.deeds.unlockedBanner', { name: deedName(plan.bannerId) });
      this.showBanner(bannerText);
      // The banner div carries no live semantics and the chat log is
      // deliberately aria-live off, so the polite #combat-live region is what
      // a screen reader hears (the throttled self-note precedent above).
      this.combatAnnouncer.push(bannerText, performance.now());
    }
    if (plan.playSound) audio.levelUp();
    if (plan.retroCount > 0) {
      const retroText = t('hudChrome.deeds.retroSummary', {
        count: formatNumber(plan.retroCount, { maximumFractionDigits: 0 }),
      });
      this.log(retroText, '#ffd100');
      this.combatAnnouncer.push(retroText, performance.now());
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
    flair?: ChatSenderFlair,
    fromTitle?: string,
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
    // The DISPLAYED sender may carry the speaker's Book of Deeds title (a
    // deed id on the event, localized here); the context-menu handlers below
    // close over the RAW `name`, so whisper/social lookups stay unaffected.
    sender.textContent = titledDisplayName(name, fromTitle);
    sender.title = t('hudChrome.playerMenu.openFor', { name });
    sender.setAttribute('role', 'button');
    sender.setAttribute('aria-label', t('hudChrome.playerMenu.openFor', { name }));
    sender.tabIndex = 0;
    // Anchor the menu under the name itself for a click/tap/keyboard open, and at
    // the cursor for a right-click.
    const openUnderName = () => {
      const rect = sender.getBoundingClientRect();
      this.openChatPlayerContextMenu(name, rect.left, rect.bottom, sender);
    };
    // bindTouchTap covers BOTH paths: any touch pointer (the browser only
    // synthesizes `click` for the PRIMARY one, so a bare click binding goes dead
    // while the other thumb is steering) AND the ordinary mouse/keyboard click.
    // Do NOT also addEventListener('click', ...) here: bindTouchTap binds click
    // itself, so the handler would fire twice per click and the second call would
    // hit the toggle branch below and slam the menu shut the instant it opened.
    bindTouchTap(sender, openUnderName);
    sender.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      this.openChatPlayerContextMenu(name, ev.clientX, ev.clientY, sender);
    });
    sender.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      openUnderName();
    });
    // The [AI] tag rides the {name} slot, not the head of the line: the localized
    // templates read '[General] {name}: {message}', so it must sit beside the name
    // and not look like part of the channel prefix (see ./chat_line).
    const rendered = t(templateKey, { name: CHAT_NAME_TOKEN, message: CHAT_MESSAGE_TOKEN });
    appendChatLineParts(div, rendered, {
      aiTag: flair?.ai ? chatAiTagEl(document) : null,
      sender,
      appendBody: (parent) => this.appendChatMessageBody(parent, text, fromPid),
    });
    this.chatLogEl.appendChild(div);
    // Announce the player-chat line through the tab-independent #chat-live region.
    this.announceChatLine(div);
    while (this.chatLogEl.children.length > 200) {
      const first = this.chatLogEl.firstChild;
      if (!first) break;
      this.chatLogEl.removeChild(first);
    }
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
      if (seg.kind === 'item') {
        this.appendChatItemLink(parent, seg.itemId);
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

  // Render a [[i:id]] chat segment as a quality-colored, inspectable item link.
  // Hover/focus shows the same item tooltip the bags window uses; an unknown id
  // (e.g. content drift between players) degrades to a plain [?].
  private appendChatItemLink(parent: HTMLElement, itemId: string): void {
    const item = ITEMS[itemId];
    if (!item) {
      parent.append(document.createTextNode(this.maskChat('[?]')));
      return;
    }
    const link = document.createElement('span');
    link.className = 'chat-item-link';
    link.style.color = QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff';
    link.textContent = `[${itemDisplayName(item)}]`;
    link.tabIndex = 0;
    this.attachTooltip(link, () => this.itemTooltip(item));
    parent.append(link);
  }

  // The plain-text form of a chat string with [[q:id]]/[[i:id]] tokens replaced by
  // [Name]: used for 3D chat bubbles, which can't host interactive spans.
  private chatLinkPlainText(text: string): string {
    return parseChatSegments(text)
      .map((s) => {
        if (s.kind === 'text') return s.value;
        if (s.kind === 'item') {
          const item = ITEMS[s.itemId];
          return `[${item ? itemDisplayName(item) : '?'}]`;
        }
        return `[${QUESTS[s.questId] ? questTitle(s.questId) : '?'}]`;
      })
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
    // Heroic daily lockout (any heroic instance): resolve the dungeon name and
    // enrich with the live countdown when the mirrored lockout is present.
    const heroicLock = /^You are locked to Heroic (.+)\.$/.exec(text);
    if (heroicLock) {
      const base = DUNGEON_LIST.find((d) => d.name === heroicLock[1]);
      const name = base ? dungeonDisplayName(base.id) : heroicLock[1];
      const lock = base
        ? this.sim.raidLockouts().find((l) => l.id === `${base.id}:heroic`)
        : undefined;
      if (lock) {
        return t('hudChrome.raidLockout.lockedToast', {
          raid: t('hudChrome.raidLockout.heroicName', { name }),
          time: this.formatLockoutDuration(lock.msRemaining),
        });
      }
      return t('hudChrome.raidLockout.heroicLocked', { name });
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
      'You must be in a party to start a ready check.': 'hudChrome.readyCheck.notInPartyError',
      'A ready check is already in progress.': 'hudChrome.readyCheck.inProgressError',
      'Only the party leader can change the loot method.': 'hudChrome.masterLoot.leaderOnly',
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
      'Not enough honor.': 'hudChrome.warfare.notEnoughHonor',
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
      'Invite whom? Usage: /invite <name>.': 'hudChrome.party.inviteUsage',
    };
    const key = exact[text];
    if (key) return t(key);

    let match = /^You must be in (Bruin|Wolf) Form\.$/.exec(text);
    if (match)
      return t('hud.errors.requiresForm', {
        form: t(match[1] === 'Bruin' ? 'hud.errors.bear' : 'hud.errors.cat'),
      });
    match = /^You can't do that in (Bruin|Wolf|Fleet) Form\.$/.exec(text);
    if (match)
      return t('hud.errors.cantInForm', {
        form: t(
          match[1] === 'Bruin'
            ? 'hud.errors.bear'
            : match[1] === 'Fleet'
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
      'Loot method set to Group Loot.': 'hudChrome.masterLoot.methodGroup',
      'Loot Settings: Group Loot.': 'hudChrome.masterLoot.summaryGroup',
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

    let match = /^Loot method set to Master Loot\. Master Looter: (.+)\.$/.exec(text);
    if (match) return t('hudChrome.masterLoot.methodMaster', { name: match[1] });
    match = /^Master Looter is now (.+)\.$/.exec(text);
    if (match) return t('hudChrome.masterLoot.looterChanged', { name: match[1] });
    match = /^Loot threshold set to (uncommon|rare|epic)\.$/.exec(text);
    if (match)
      return t('hudChrome.masterLoot.thresholdSet', {
        threshold: t(
          `hudChrome.masterLoot.threshold${match[1][0].toUpperCase()}${match[1].slice(1)}` as TranslationKey,
        ),
      });
    match =
      /^Loot Settings: Master Loot, Master Looter (.+), threshold (uncommon|rare|epic)\.$/.exec(
        text,
      );
    if (match)
      return t('hudChrome.masterLoot.summaryMaster', {
        name: match[1],
        threshold: t(
          `hudChrome.masterLoot.threshold${match[2][0].toUpperCase()}${match[2].slice(1)}` as TranslationKey,
        ),
      });
    match = /^You have invited (.+) to your party\.$/.exec(text);
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
    match = /^(\d+) daily rewards points gained\.$/.exec(text);
    if (match)
      return t('hudChrome.dailyRewards.pointsGained', {
        points: formatNumber(Number(match[1]), { maximumFractionDigits: 0 }),
      });
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
    match = /^Rolling for (\[\[i:[A-Za-z0-9_]+\]\])\.$/.exec(text);
    if (match) return t('hudChrome.masterLoot.rollingFor', { item: match[1] });
    match = /^Everyone passed on (.+)\.$/.exec(text);
    if (match) return t('itemUi.lootRoll.everyonePassed', { item: match[1] });
    match = /^Sold (\d+) junk items? for (.+)\.$/.exec(text);
    if (match) {
      const n = Number(match[1]);
      return t(n === 1 ? 'hud.logs.soldJunkOne' : 'hud.logs.soldJunkMany', {
        count: formatNumber(n, { maximumFractionDigits: 0 }),
        money: this.localizeSimMoney(match[2]),
      });
    }
    match = /^(.+) assigned (.+) to (.+)\.$/.exec(text);
    if (match)
      return t('hudChrome.masterLoot.assigned', {
        looter: match[1],
        item: match[2],
        target: match[3],
      });
    match = /^(.+) was not assigned and is free for all\.$/.exec(text);
    if (match)
      return t('hudChrome.masterLoot.unassigned', { item: itemDisplayNameFromSource(match[1]) });
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
    // Mirror the combat line to the off-screen polite live region, throttled so a
    // damage burst does not flood the screen reader (see ./combat_announcer). The
    // text is already a t()-localized line, so nothing new is concatenated here.
    this.combatAnnouncer.push(text, performance.now());
  }

  // Announce a chat line that reached the visible #chatlog pane through the tab-independent
  // #chat-live region, mirroring what the old #chatlog aria-live spoke: a
  // channel-filtered line is .chat-hidden (display:none) and stays silent, exactly as a
  // display:none live-region child did. The relayed text is the rendered line text the
  // screen reader read off the div (sender + message, already localized); ChatAnnouncer
  // coalesces + throttles a burst. Both chat append paths (appendLog's chat case and
  // chatLogFrom) call this so player chat and system chat announce alike, as #chatlog's
  // implicit-polite log did before the decouple.
  private announceChatLine(div: HTMLElement): void {
    if (div.classList.contains('chat-hidden')) return;
    this.chatAnnouncer.push(div.textContent ?? '', performance.now());
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
    // Loot lines carry name-free item tokens ([[i:id]]); render those as clickable
    // links via the shared chat item-link renderer. Plain system/combat lines keep
    // the fast text-node path (the substring test never fires for tokenless lines).
    if (el === this.chatLogEl && text.includes('[[i:')) {
      for (const seg of parseChatSegments(text)) {
        if (seg.kind === 'item') this.appendChatItemLink(div, seg.itemId);
        else if (seg.kind === 'quest')
          div.append(
            document.createTextNode(`[${QUESTS[seg.questId] ? questTitle(seg.questId) : '?'}]`),
          );
        else div.append(document.createTextNode(seg.value));
      }
    } else {
      div.append(document.createTextNode(text));
    }
    el.appendChild(div);
    // Announce chat-pane lines through #chat-live (the combat pane has its own announcer).
    if (el === this.chatLogEl) this.announceChatLine(div);
    while (el.children.length > 200) {
      const first = el.firstChild;
      if (!first) break;
      el.removeChild(first);
    }
    if (wasNearBottom) el.scrollTop = el.scrollHeight;
  }

  // A floating note over the local player (e.g. "Can't move!" when a movement command
  // lands while rooted/stunned). The 8th FCT spawn site: it rides the same pooled painter
  // as the combat floaters via the self-note kind (the #ff8c66 colour token). Throttling
  // is the caller's job (main.ts gates it behind IMMOBILE_NOTE_THROTTLE_MS).
  showSelfNote(text: string): void {
    const shape = fctSpawnShape({ type: 'self-note' });
    if (shape)
      this.fctPainter.spawn({ ...shape, text, target: this.sim.player }, performance.now());
    // Also route the self-note into the polite #combat-live region: the
    // self-note is the one FCT-only event with NO combat-log line, so without this it would
    // never be announced. The text is already t()-localized (e.g. "Can't move!") so nothing
    // new is built here, and the announcer coalesces + throttles so it never streams raw
    // per-damage text. (The xp / rested-xp floats are NOT routed here: those events already
    // emit a textual chat line via log(), so the #chat-live region announces them; adding the
    // float too would double-announce, which the announce contract forbids.)
    this.combatAnnouncer.push(text, performance.now());
  }

  showError(text: string): void {
    const localized = this.localizeErrorText(text);
    this.errorEl.textContent = localized;
    this.errorEl.style.opacity = '1';
    clearTimeout(this.errorTimer);
    this.errorTimer = window.setTimeout(() => {
      this.errorEl.style.opacity = '0';
    }, 1600);
    audio.error();
    // Mirror into the chat log's system channel (the same one loot/level-up/death
    // lines use) so the toast is not lost once it fades: WoW-style error/system
    // logging. The on-screen toast's own timing above is unchanged. Consecutive
    // repeats (mashing a key while an error condition persists) are suppressed
    // so the channel does not flood; a different error still logs normally.
    if (shouldMirrorErrorToast(localized, this.lastMirroredErrorText)) {
      this.log(localized, ERROR_LOG_COLOR);
      this.lastMirroredErrorText = localized;
    }
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
    this.arenaWindow.setPracticeHook(fn);
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
    const ui = document.getElementById('ui');
    if (!ui) return;
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
    const cards = el.querySelector('.fa-cards');
    if (!cards) return;
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
    // A banker never gossips: divert to the sim interact, whose banker intercept
    // emits the bank event this HUD opens on (case 'bank'), identically in both
    // worlds. Routing through the sim keeps proximity server-authoritative; the
    // authored greeting stays un-rendered by design (a deliberate QA adjudication).
    if (NPCS[npc.templateId]?.banker) {
      this.sim.targetEntity(npc.id);
      this.sim.interact();
      return;
    }
    // A chronicler never gossips either: route the talk through the sim (the
    // visited mark + the Saul consecutive-talk counter live there, identically
    // in both worlds), then open the Book at the Chronicles section
    // client-side; the authored greeting stays un-rendered like the banker's.
    if ((CHRONICLER_TEMPLATE_IDS as readonly string[]).includes(npc.templateId)) {
      this.sim.targetEntity(npc.id);
      this.sim.interact();
      this.openDeeds('chronicle');
      return;
    }
    this.questDialogOpenedAtMs = performance.now();
    if ($('#quest-dialog').style.display !== 'block')
      this.questDialogTrap = this.focusManager.open({ root: () => $('#quest-dialog') });
    this.closeOtherWindows('#quest-dialog');
    // Voice the greeting only on the initial open — renderGossip also runs when
    // navigating back from a quest detail or after accept/turn-in, where a
    // re-greeting would be noise.
    voice.play(`greeting__${npc.templateId}`);
    this.voiceNpcId = npc.id;
    this.renderGossip(npc);
  }

  // closeIfEmpty is set only when re-rendering after an accept/turn-in click:
  // a fresh NPC visit (or navigating Back) always shows the greeting even with
  // an empty menu, but once the player has just resolved the one thing the NPC
  // had to offer (the common case for a tutorial giver with a single starter
  // quest), an empty menu means there is nothing left to do here and the
  // window should close itself instead of hanging open with just the greeting.
  private renderGossip(npc: Entity, closeIfEmpty = false): void {
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
    const hasVendor = npc.vendorItems.length > 0;
    const hasMarket = !!def?.market;
    const hasHeroicVendor = !!def?.heroicVendor;
    const hasDelveBoard = Object.values(DELVES).some((d) => d.boardNpcId === npc.templateId);
    const hasVcup = npc.templateId === 'groundskeeper_bram';
    if (
      closeIfEmpty &&
      gossipMenuIsEmpty({
        questCount: interesting.length,
        discussionCount: discussionQuests.length,
        hasVendor,
        hasMarket,
        hasHeroicVendor,
        hasDelveBoard,
        hasVcup,
      })
    ) {
      this.closeQuestDialog();
      return;
    }
    this.openGossipNpcId = npc.id;
    this.openQuestDetailId = null;
    const el = $('#quest-dialog');
    markDialogRoot(el, { labelledBy: 'quest-dialog-title' });
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
    if (hasVendor) {
      html += `<button type="button" class="qd-list-item" data-vendor="1" aria-label="${esc(t('questUi.dialog.browseGoodsAria', { name: npcName }))}"><span class="quest-complete">$</span> ${esc(t('questUi.dialog.browseGoods'))}</button>`;
    }
    if (hasMarket) {
      html += `<button type="button" class="qd-list-item" data-market="1" aria-label="${esc(t('questUi.dialog.worldMarketAria'))}"><span class="gold">${svgIcon('market')}</span> ${esc(t('questUi.dialog.worldMarket'))}</button>`;
    }
    if (hasHeroicVendor) {
      html += `<button type="button" class="qd-list-item" data-heroic-shop="1" aria-label="${esc(t('questUi.dialog.browseGoodsAria', { name: npcName }))}"><span class="quest-complete">$</span> ${esc(t('questUi.dialog.browseGoods'))}</button>`;
    }
    if (hasDelveBoard) {
      const delveForNpc = Object.values(DELVES).find((d) => d.boardNpcId === npc.templateId);
      const openLabel = delveForNpc
        ? delveDisplayName(delveForNpc.id)
        : t('delveUi.board.openDelve');
      html += `<button type="button" class="qd-list-item" data-delve-board="1" aria-label="${esc(t('delveUi.board.openDelveAria', { name: npcName }))}"><span class="gold">${svgIcon('skull')}</span> ${esc(openLabel)}</button>`;
    }
    // Groundskeeper Bram keeps the book of fixtures at the Sowfield gate: his
    // gossip menu opens the Vale Cup window (the delve-board button precedent).
    if (hasVcup) {
      html += `<button type="button" class="qd-list-item" data-vcup="1" aria-label="${esc(t('hudChrome.vcup.gossipOpenAria'))}"><span class="gold">${svgIcon('ball')}</span> ${esc(t('hudChrome.vcup.gossipOpen'))}</button>`;
    }
    el.innerHTML = html;
    el.querySelectorAll('[data-quest]').forEach((item) => {
      item.addEventListener('click', () =>
        this.renderQuestDetail(npc, (item as HTMLElement).dataset.quest ?? ''),
      );
    });
    el.querySelectorAll('[data-discuss]').forEach((item) => {
      item.addEventListener('click', () => {
        this.sim.targetEntity(npc.id);
        this.sim.interact();
        (item as HTMLButtonElement).disabled = true;
      });
    });
    el.querySelector('[data-vendor]')?.addEventListener('click', () => {
      this.closeQuestDialog(false);
      this.openVendor(npc.id);
    });
    el.querySelector('[data-heroic-shop]')?.addEventListener('click', () => {
      this.closeQuestDialog(false);
      this.openHeroicVendor(npc.id);
    });
    el.querySelector('[data-market]')?.addEventListener('click', () => {
      this.closeQuestDialog(false);
      this.openMarket();
    });
    el.querySelector('[data-delve-board]')?.addEventListener('click', () => {
      this.closeQuestDialog(false);
      this.openDelveBoard(npc.id);
    });
    el.querySelector('[data-vcup]')?.addEventListener('click', () => {
      this.closeQuestDialog(false);
      this.toggleValeCup();
    });
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeQuestDialog());
    el.style.display = 'block';
    this.questDialogTrap?.focusFirst();
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
    this.voiceNpcId = npc.id;
    markDialogRoot(el, { labelledBy: 'quest-dialog-title' });
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
        this.renderGossip(npc, true);
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
        this.renderGossip(npc, true);
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
    this.questDialogTrap?.focusFirst();
  }

  // Open the read-only quest detail for a chat-link click. Shows Accept only when the
  // viewer is in the link author's party AND the quest is available; the server
  // re-validates on accept. Non-party / ineligible viewers see view-only info.
  openLinkedQuestDialog(questId: string, fromPid?: number): void {
    const quest = QUESTS[questId];
    if (!quest) return;
    this.openGossipNpcId = null;
    if ($('#quest-dialog').style.display !== 'block')
      this.questDialogTrap = this.focusManager.open({ root: () => $('#quest-dialog') });
    this.closeOtherWindows('#quest-dialog');
    const el = $('#quest-dialog');
    const state = this.sim.questState(questId);
    const inSharerParty =
      fromPid !== undefined &&
      (this.sim.partyInfo?.members.some((m) => m.pid === fromPid) ?? false);
    markDialogRoot(el, { labelledBy: 'quest-dialog-title' });
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
        if (fromPid === undefined) return;
        this.sim.acceptLinkedQuest(questId, fromPid);
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
    this.questDialogTrap?.focusFirst();
  }

  private renderQuestDiscussion(npc: Entity, questId: string, page: number): void {
    const el = $('#quest-dialog');
    const pages = [
      questNarrative(questId, 'text', this.sim.player.name),
      questNarrative(questId, 'completion', this.sim.player.name),
    ];
    const clampedPage = Math.max(0, Math.min(page, pages.length - 1));
    markDialogRoot(el, { labelledBy: 'quest-dialog-title' });
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
    this.questDialogTrap?.focusFirst();
  }

  closeQuestDialog(restoreFocus = true): void {
    $('#quest-dialog').style.display = 'none';
    this.openGossipNpcId = null;
    this.openQuestDetailId = null;
    this.hideTooltip();
    this.questDialogTrap?.release(restoreFocus);
    this.questDialogTrap = null;
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
    // A master-loot prompt that converts to a need/greed roll reuses the same rollId;
    // drop the superseded master panel so the looter sees only the need/greed panel.
    this.activeMasterRolls.delete(ev.rollId);
    this.activeLootRolls.set(ev.rollId, {
      event: ev,
      receivedAt: performance.now(),
      durationMs: 60_000,
    });
    this.renderLootRolls();
  }

  private submitLootRoll(rollId: number, choice: LootRollChoice): void {
    this.sim.submitLootRoll(rollId, choice);
    this.activeLootRolls.delete(rollId);
    this.dismissedLootRolls.set(rollId, performance.now());
    this.renderLootRolls();
  }

  // Reconcile the shown loot-roll prompts against the server's authoritative
  // open-roll mirror. Loot-roll events are best-effort (a single frame), so this
  // both RE-SHOWS an open roll whose event was missed (reconnect, interest
  // churn, a dropped snapshot) and RETIRES a shown roll the server has since
  // resolved (the mirror drops it to []), so a stale dead-button prompt no
  // longer lingers until the local timer. The three-way decision lives in
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
    const dismissedAt: Record<number, number> = {};
    for (const [id, at] of this.dismissedLootRolls) dismissedAt[id] = at;
    const decision = computeLootRollReconcile({
      open: open.map((p) => p.rollId),
      shown: [...this.activeLootRolls.keys()],
      dismissed: [...this.dismissedLootRolls.keys()],
      confirmed: [...this.confirmedLootRolls],
      dismissedAt,
      nowMs: performance.now(),
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
        durationMs: 60_000,
      });
      changed = true;
    }
    if (changed) this.renderLootRolls();
  }

  private showMasterLoot(ev: Extract<SimEvent, { type: 'masterLoot' }>): void {
    this.activeMasterRolls.set(ev.rollId, {
      event: ev,
      receivedAt: performance.now(),
      // The master looter's curate window is 5 minutes (sim MASTER_LOOT_TIMEOUT),
      // longer than a need/greed roll, so the countdown bar must span the full window.
      durationMs: 300_000,
    });
    this.renderLootRolls();
  }

  private assignMasterLoot(rollId: number, targetPids: number[]): void {
    this.sim.assignMasterLoot(rollId, targetPids);
    this.activeMasterRolls.delete(rollId);
    this.renderLootRolls();
  }

  // Poll the authoritative group vote state and re-render the roll rail only
  // when it actually changes (the view core's fingerprint). Also owns the watch
  // timers: a watch-only row starts its countdown at first sight and is dropped
  // the moment the server stops listing the roll (resolution/expiry).
  private reconcileLootRollStatus(now: number): void {
    const statuses = this.sim.lootRollGroupStatus();
    if (statuses.length === 0 && this.lootRollStatusRows.length === 0) return;
    const rows = computeLootRollStatusRows(
      statuses,
      [...this.activeLootRolls.keys()],
      this.sim.playerId,
      !this.isMobileLayout(),
    );
    const fp = lootRollStatusFingerprint(rows);
    if (fp === this.lootRollStatusFp) return;
    this.lootRollStatusFp = fp;
    this.lootRollStatusRows = rows;
    const live = new Set(rows.map((row) => row.rollId));
    for (const rollId of this.lootRollWatchTimers.keys())
      if (!live.has(rollId)) this.lootRollWatchTimers.delete(rollId);
    for (const row of rows)
      if (!this.lootRollWatchTimers.has(row.rollId)) this.lootRollWatchTimers.set(row.rollId, now);
    this.renderLootRolls();
  }

  private updateLootRollTimers(now: number): void {
    if (
      this.activeLootRolls.size === 0 &&
      this.activeMasterRolls.size === 0 &&
      this.lootRollStatusRows.length === 0
    )
      return;
    let changed = false;
    for (const [rollId, roll] of this.activeLootRolls) {
      if (now - roll.receivedAt >= roll.durationMs) {
        this.activeLootRolls.delete(rollId);
        // Expired locally: stamp the dismissal so reconcile only re-shows it if
        // the server still lists it open past the grace, not on the next frame.
        this.dismissedLootRolls.set(rollId, now);
        changed = true;
      }
    }
    for (const [rollId, roll] of this.activeMasterRolls) {
      if (now - roll.receivedAt >= roll.durationMs) {
        this.activeMasterRolls.delete(rollId);
        changed = true;
      }
    }
    if (changed) this.renderLootRolls();
    const root = document.getElementById('loot-rolls');
    if (!root) return;
    for (const row of root.querySelectorAll<HTMLElement>('.loot-roll')) {
      const rollId = Number(row.dataset.rollId);
      if (row.dataset.watch) {
        // Watch-only rows time against first sight; the row itself lives and
        // dies with the server's group status, the bar is purely cosmetic.
        const receivedAt = this.lootRollWatchTimers.get(rollId);
        if (receivedAt === undefined) continue;
        const remaining = Math.max(0, 1 - (now - receivedAt) / 60_000);
        row.style.setProperty('--loot-roll-frac', remaining.toFixed(3));
        continue;
      }
      const roll = row.dataset.master
        ? this.activeMasterRolls.get(rollId)
        : this.activeLootRolls.get(rollId);
      if (!roll) continue;
      const remaining = Math.max(0, 1 - (now - roll.receivedAt) / roll.durationMs);
      row.style.setProperty('--loot-roll-frac', remaining.toFixed(3));
    }
  }

  private closeLootRollsForItem(text: string): void {
    const match =
      /^.+ wins \[\[i:([A-Za-z0-9_]+)\]\] \(\d+\)$/.exec(text) ??
      /^Everyone passed on \[\[i:([A-Za-z0-9_]+)\]\]\.$/.exec(text) ??
      /^.+ assigned \[\[i:([A-Za-z0-9_]+)\]\] to .+\.$/.exec(text) ??
      /^(.+) was not assigned and is free for all\.$/.exec(text);
    if (!match) return;
    const id = match[1];
    for (const [rollId, roll] of this.activeLootRolls) {
      if (roll.event.itemId === id || roll.event.itemName === id)
        this.activeLootRolls.delete(rollId);
    }
    for (const [rollId, roll] of this.activeMasterRolls) {
      if (roll.event.itemId === id || roll.event.itemName === id)
        this.activeMasterRolls.delete(rollId);
    }
    this.renderLootRolls();
  }

  // The per-candidate vote strip (the XLoot-style monitor): one chip per
  // candidate showing their live need/greed/pass choice, or an empty chip while
  // they are still deciding, headed by an "N/M rolled" count so a full raid
  // (RAID_MAX = 10) reads at a glance without scanning every chip. Roll numbers
  // are never shown here; the sim broadcasts them as loot chat lines at
  // resolution. The strip is aria-hidden: it re-renders on every vote, so
  // leaving it in the #loot-rolls live region would spam a screen reader up to
  // ten times per roll. The accessible surface is the prompt (announced once on
  // show) plus the full per-roller reveal in the chat log at resolution.
  private lootRollVotesHtml(status: LootRollStatusRow): string {
    const votes = status.entries
      .map(
        (entry) => `
        <span class="loot-roll-vote${entry.self ? ' self' : ''}">
          <span class="loot-roll-vote-name">${esc(entry.name)}</span>
          <span class="loot-roll-vote-chip ${entry.choice ?? 'undecided'}">${entry.choice ? esc(t(`itemUi.lootRoll.${entry.choice}`)) : ''}</span>
        </span>`,
      )
      .join('');
    const count = t('itemUi.lootRoll.rolled', {
      answered: formatNumber(status.answered, { maximumFractionDigits: 0 }),
      total: formatNumber(status.total, { maximumFractionDigits: 0 }),
    });
    return `<div class="loot-roll-votes" aria-hidden="true">
      <div class="loot-roll-votes-count">${esc(count)}</div>
      <div class="loot-roll-votes-list">${votes}</div>
    </div>`;
  }

  private renderLootRolls(): void {
    const root = this.lootRollRoot();
    if (
      this.activeLootRolls.size === 0 &&
      this.activeMasterRolls.size === 0 &&
      this.lootRollStatusRows.length === 0
    ) {
      root.style.display = 'none';
      root.innerHTML = '';
      return;
    }
    root.style.display = 'flex';
    root.innerHTML = '';
    const statusByRoll = new Map(this.lootRollStatusRows.map((row) => [row.rollId, row]));
    for (const [rollId, roll] of this.activeMasterRolls)
      this.renderMasterLootRow(root, rollId, roll.event);
    for (const [rollId, roll] of this.activeLootRolls) {
      const ev = roll.event;
      const item = ITEMS[ev.itemId];
      const itemName = item ? itemDisplayName(item) : ev.itemName;
      const quality = item?.quality ?? ev.quality ?? 'common';
      const status = statusByRoll.get(rollId);
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
        ${status ? this.lootRollVotesHtml(status) : ''}
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
    // Watch-only rows: open rolls this player is not (or no longer) answering,
    // kept up so the whole group can follow the votes until the server resolves
    // the roll and drops it from the group status.
    for (const status of this.lootRollStatusRows) {
      if (this.activeLootRolls.has(status.rollId) || this.activeMasterRolls.has(status.rollId))
        continue;
      const item = ITEMS[status.itemId];
      const itemName = item ? itemDisplayName(item) : status.itemName;
      const quality = item?.quality ?? status.quality ?? 'common';
      const row = document.createElement('div');
      row.className = 'loot-roll panel watch';
      row.dataset.rollId = String(status.rollId);
      row.dataset.watch = '1';
      row.style.setProperty('--loot-roll-frac', '1');
      row.innerHTML = `
        <div class="loot-roll-item">
          ${item ? this.itemIcon(item) : `<img class="item-icon q-${quality}" src="${iconDataUrl('item', status.itemId)}" alt="" draggable="false">`}
          <div class="loot-roll-copy">
            <div class="loot-roll-title">${esc(t('itemUi.lootRoll.title'))}</div>
            <div class="loot-roll-name" style="color:${QUALITY_COLOR[quality] ?? '#fff'}">${esc(itemName)}</div>
          </div>
        </div>
        <div class="loot-roll-timer" aria-hidden="true"><span></span></div>
        ${this.lootRollVotesHtml(status)}`;
      if (item)
        this.attachTooltip(row.querySelector('.loot-roll-item') as HTMLElement, () =>
          this.itemTooltip(item),
        );
      root.appendChild(row);
    }
  }

  private renderMasterLootRow(
    root: HTMLElement,
    rollId: number,
    ev: Extract<SimEvent, { type: 'masterLoot' }>,
  ): void {
    const item = ITEMS[ev.itemId];
    const itemName = item ? itemDisplayName(item) : ev.itemName;
    const quality = item?.quality ?? ev.quality ?? 'common';
    const row = document.createElement('div');
    row.className = 'loot-roll panel master';
    row.dataset.rollId = String(rollId);
    row.dataset.master = '1';
    row.style.setProperty('--loot-roll-frac', '1');
    const picks = ev.candidates
      .map(
        (c) =>
          `<label><input type="checkbox" class="ml-pick" value="${c.pid}"><span>${esc(c.name)}</span></label>`,
      )
      .join('');
    row.innerHTML = `
      <div class="loot-roll-item">
        ${item ? this.itemIcon(item) : `<img class="item-icon q-${quality}" src="${iconDataUrl('item', ev.itemId)}" alt="" draggable="false">`}
        <div class="loot-roll-copy">
          <div class="loot-roll-title">${esc(t('hudChrome.masterLoot.assignPrompt', { item: itemName }))}</div>
          <div class="loot-roll-name" style="color:${QUALITY_COLOR[quality] ?? '#fff'}">${esc(itemName)}</div>
        </div>
      </div>
      <div class="loot-roll-timer" aria-hidden="true"><span></span></div>
      <div class="master-loot-picks">
        <label class="ml-all-row"><input type="checkbox" class="ml-all"><span>${esc(t('hudChrome.masterLoot.selectAll'))}</span></label>
        ${picks}
      </div>
      <div class="loot-roll-actions"><button type="button" class="loot-roll-btn assign ml-roll" disabled>${esc(t('hudChrome.masterLoot.rollButton'))}</button></div>`;
    if (item)
      this.attachTooltip(row.querySelector('.loot-roll-item') as HTMLElement, () =>
        this.itemTooltip(item),
      );
    // Curate-then-roll: the looter checks a subset and presses Roll. One checked
    // member is granted directly server-side; two or more open a need/greed roll for
    // just that subset. The select-all header mirrors / drives the per-member boxes.
    const all = row.querySelector<HTMLInputElement>('.ml-all')!;
    const pickEls = [...row.querySelectorAll<HTMLInputElement>('.ml-pick')];
    const rollBtn = row.querySelector<HTMLButtonElement>('.ml-roll')!;
    const syncRoll = (): void => {
      const checked = pickEls.filter((p) => p.checked).length;
      rollBtn.disabled = checked === 0;
      all.checked = pickEls.length > 0 && checked === pickEls.length;
    };
    all.addEventListener('change', () => {
      for (const p of pickEls) p.checked = all.checked;
      syncRoll();
    });
    for (const p of pickEls) p.addEventListener('change', syncRoll);
    rollBtn.addEventListener('click', () => {
      const pids = pickEls.filter((p) => p.checked).map((p) => Number(p.value));
      if (pids.length > 0) this.assignMasterLoot(rollId, pids);
    });
    root.appendChild(row);
  }

  openLoot(mobId: number, screenX: number, screenY: number): void {
    const mob = this.sim.entities.get(mobId);
    if (!mob) return;
    const componentTags = MOBS[mob.templateId]?.componentTags;
    const harvestable = !!componentTags?.length && mob.harvestClaimedBy === null;
    const visibleItems = mob.loot
      ? mob.loot.items.filter((s) => !s.personalFor || s.personalFor.includes(this.sim.playerId))
      : [];
    const hasLoot = !!mob.loot && (mob.loot.copper > 0 || visibleItems.length > 0);
    if (!hasLoot && !harvestable) return;
    this.closeOtherWindows('#loot-window');
    this.openLootMobId = mobId;
    this.openLootChestId = null;
    const el = $('#loot-window');
    let html = `<div class="panel-title"><span>${esc(entityDisplayName(mob))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('itemUi.loot.close'))}">${svgIcon('close')}</button></div>`;
    if (mob.loot && mob.loot.copper > 0) {
      html += `<div class="loot-item"><img class="item-icon q-common" src="${iconDataUrl('item', 'coin_gold')}" alt="" draggable="false"><span>${this.moneyHtml(mob.loot.copper)}</span></div>`;
    }
    for (const s of visibleItems) {
      const item = ITEMS[s.itemId];
      html += `<div class="loot-item" data-item="${s.itemId}">${this.itemIcon(item)}<span style="font-size:12px">${esc(itemDisplayName(item))}${s.count > 1 ? ` ${esc(t('itemUi.bags.stackCount', { count: formatNumber(s.count, { maximumFractionDigits: 0 }) }))}` : ''}</span></div>`;
    }
    el.innerHTML = html;
    el.querySelectorAll('[data-item]').forEach((row) => {
      const itemId = (row as HTMLElement).dataset.item ?? '';
      this.attachTooltip(row as HTMLElement, () => this.itemTooltip(ITEMS[itemId]));
    });
    if (hasLoot) {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = t('itemUi.loot.takeAll');
      btn.title = t('hudChrome.loot.takeAllTooltip');
      btn.addEventListener('click', () => {
        this.sim.lootCorpse(mobId);
        this.closeLoot();
      });
      el.appendChild(btn);
    }
    if (harvestable && componentTags) {
      renderCorpseHarvestPicker(el, corpseHarvestView(componentTags, new Set()), {
        onHarvest: (chosen) => {
          this.sim.harvestCorpse(mobId, chosen);
          this.closeLoot();
        },
      });
    }
    el.querySelector('[data-close]')?.addEventListener('click', () => this.closeLoot());
    el.style.display = 'block';
    if (document.body.classList.contains('mobile-touch')) {
      this.centerPopupInViewport(el);
    } else {
      this.placePopupAt(el, screenX - 115, screenY - 30, 260, 280, 10, 10);
      el.style.transform = 'none'; // loot pops at the cursor, not the centred slot
    }
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
    // The bags companion is exclusive (see openBank): close the bank cluster
    // through the painter so onBankClosed clears body.bank-open before the
    // vendor pairing takes over.
    if (this.bankWindowOpen) this.closeBank();
    this.openHeroicVendorNpcId = null; // the marks shop shares the container
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
      buildVendorView(npc.vendorItems, this.sim.vendorBuyback, ITEMS, {
        copper: this.sim.copper,
        honor: this.sim.honor,
      }),
      {
        ...this.presentationBag,
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

  openHeroicVendor(npcId: number): void {
    this.closeOtherWindows('#vendor-window');
    // The bags companion is exclusive (see openBank): close the bank cluster
    // through the painter so onBankClosed clears body.bank-open before the
    // marks shop takes the container.
    if (this.bankWindowOpen) this.closeBank();
    this.openVendorNpcId = null; // shares the container with the copper vendor
    this.openHeroicVendorNpcId = npcId;
    this.renderHeroicVendor();
  }

  private renderHeroicVendor(): void {
    if (this.openHeroicVendorNpcId === null) return;
    const npc = this.sim.entities.get(this.openHeroicVendorNpcId);
    if (!npc) return;
    const balance = this.sim.inventory
      .filter((slot) => slot.itemId === HEROIC_MARK_ITEM_ID)
      .reduce((sum, slot) => sum + slot.count, 0);
    renderHeroicVendorWindow(
      $('#vendor-window'),
      entityDisplayName(npc),
      buildHeroicVendorView(HEROIC_VENDOR_STOCK, ITEMS, balance),
      {
        ...this.presentationBag,
        hideTooltip: () => this.hideTooltip(),
        onBuy: (itemId) => this.sim.buyHeroicVendorItem(itemId),
        onClose: () => this.closeHeroicVendor(),
      },
    );
  }

  closeHeroicVendor(): void {
    if (this.openHeroicVendorNpcId === null) return;
    $('#vendor-window').style.display = 'none';
    this.openHeroicVendorNpcId = null;
    this.hideTooltip();
  }

  closeVendor(): void {
    const closeMobileBags =
      document.body.classList.contains('mobile-touch') && $('#bags').style.display !== 'none';
    $('#vendor-window').style.display = 'none';
    this.openVendorNpcId = null;
    document.body.classList.remove('vendor-open'); // bags (if still open) re-centres
    this.hideTooltip();
    if (closeMobileBags) {
      // Mirror BagsWindow.close()'s teardown backstop: a discard/sell prompt may hold
      // #bags inert (installPromptDialog) and this mobile path hides the grid without
      // running the prompt's dismiss(), so clear inert AND remove the prompt node or
      // it survives as a visible orphaned aria-modal in #prompt-stack that
      // promptModalOpen() keeps gating game keys on (invariant: a hidden #bags is
      // never inert and never owns a live prompt).
      dismissBagPrompts();
      const bags = $('#bags');
      bags.style.display = 'none';
      bags.inert = false;
      this.cancelPetFeed();
    } else if ($('#bags').style.display !== 'none') {
      this.renderBags();
    }
  }

  get vendorOpen(): boolean {
    return this.openVendorNpcId !== null;
  }

  // -------------------------------------------------------------------------
  // Town Focus (#1143): persistent per-player harvest-component focus,
  // settable only while standing in the current zone's town hub (the
  // lightweight town-tag stand-in; see professions/focus.ts). The panel shows
  // the allocation and lets it be edited even out of town (so a player can see
  // what they have), but disables the steppers/save outside town: the real
  // gate is server-side in Sim.setTownFocus, this is a cosmetic usability gate.
  // -------------------------------------------------------------------------

  private townFocusDraft: Record<string, number> | null = null;

  private isInTown(): boolean {
    const pos = this.sim.player.pos;
    return isInTownZone(pos, zoneAt(pos.z));
  }

  toggleTownFocus(): void {
    const el = $('#town-focus-window');
    if (el.style.display === 'block') {
      this.closeTownFocus();
      return;
    }
    this.closeOtherWindows('#town-focus-window');
    this.townFocusDraft = { ...this.sim.townFocus };
    this.renderTownFocus();
  }

  private renderTownFocus(): void {
    const inTown = this.isInTown();
    const allocation = this.townFocusDraft ?? this.sim.townFocus;
    renderTownFocusWindow(
      $('#town-focus-window'),
      buildTownFocusView(allocation, FOCUS_POINT_BUDGET, inTown),
      {
        onStep: (component, delta) => {
          this.townFocusDraft = stepTownFocus(
            this.townFocusDraft ?? this.sim.townFocus,
            component,
            delta,
            FOCUS_POINT_BUDGET,
          );
          this.renderTownFocus();
        },
        onSave: () => {
          this.sim.setTownFocus(this.townFocusDraft ?? {});
          this.townFocusDraft = null;
          this.closeTownFocus();
        },
        onClose: () => this.closeTownFocus(),
      },
    );
  }

  closeTownFocus(): void {
    $('#town-focus-window').style.display = 'none';
    this.townFocusDraft = null;
    this.hideTooltip();
  }

  get townFocusOpen(): boolean {
    return $('#town-focus-window').style.display === 'block';
  }

  // -------------------------------------------------------------------------
  // Crafting (#1127): a minimal common-tier crafting window. Anywhere,
  // anytime (no vendor/NPC gate): lists every known recipe with a Craft
  // button enabled only when the player holds every required reagent.
  // -------------------------------------------------------------------------

  toggleCrafting(): void {
    if ($('#crafting-window').style.display === 'block') {
      this.closeCrafting();
      return;
    }
    this.openCrafting();
  }

  openCrafting(): void {
    this.closeOtherWindows('#crafting-window');
    this.renderCrafting();
  }

  private renderCrafting(): void {
    renderCraftingWindow(
      $('#crafting-window'),
      buildCraftingView(this.sim.recipeList, this.sim.inventory, ITEMS, this.sim.craftSkills),
      {
        ...this.presentationBag,
        hideTooltip: () => this.hideTooltip(),
        onCraft: (recipeId) => {
          this.sim.craftItem(recipeId);
          this.renderCrafting();
          if ($('#bags').style.display !== 'none') this.renderBags();
        },
        onClose: () => this.closeCrafting(),
      },
    );
  }

  closeCrafting(): void {
    $('#crafting-window').style.display = 'none';
    this.hideTooltip();
  }
  // -------------------------------------------------------------------------
  // The World Market — the Merchant's auction house
  // -------------------------------------------------------------------------

  openMarket(): void {
    this.marketWindow.open();
  }

  closeMarket(): void {
    this.marketWindow.close();
  }

  get marketWindowOpen(): boolean {
    return this.marketWindow.isOpen;
  }

  openMailbox(): void {
    this.mailboxWindow.open();
  }

  closeMailbox(): void {
    this.mailboxWindow.close();
  }

  get mailboxWindowOpen(): boolean {
    return this.mailboxWindow.isOpen;
  }

  // The bank docks its bags companion alongside (the vendor-open pattern): a body
  // class drives the side-by-side desktop layout, and the bags window is force-opened
  // so items can be withdrawn into it. closeBank routes through the painter (which
  // fires onClosed) so focus returns to the opener (WCAG 2.4.3).
  openBank(): void {
    // The bags companion is exclusive: every hub has a vendor within simultaneous
    // interact range of its banker, and vendor-open + bank-open together overlap
    // the two windows on the same side of #bags (and on mobile the cluster-close
    // precedence would strand the bank at half-width with its x-btn hidden).
    if (this.vendorOpen) this.closeVendor();
    // The heroic marks shop is a second tenant of #vendor-window that nulls
    // openVendorNpcId, so the vendorOpen guard above never sees it.
    if (this.openHeroicVendorNpcId !== null) this.closeHeroicVendor();
    document.body.classList.add('bank-open');
    this.bankWindow.open();
    this.renderBags();
    $('#bags').style.display = 'flex';
  }

  closeBank(): void {
    this.bankWindow.close();
  }

  private onBankClosed(): void {
    const closeMobileBags =
      document.body.classList.contains('mobile-touch') && $('#bags').style.display !== 'none';
    document.body.classList.remove('bank-open'); // bags (if still open) re-centres
    if (closeMobileBags) {
      // Mirror closeVendor's teardown backstop: a discard/sell/deposit prompt may hold
      // #bags inert (installPromptDialog) and this mobile path hides the grid without
      // running the prompt's dismiss(), so clear inert AND remove the prompt node too
      // (a hidden #bags is never inert and never owns a live prompt; an orphan would
      // keep promptModalOpen() gating game keys).
      dismissBagPrompts();
      const bags = $('#bags');
      bags.style.display = 'none';
      bags.inert = false;
      this.cancelPetFeed();
    } else if ($('#bags').style.display !== 'none') {
      this.renderBags();
    }
  }

  get bankWindowOpen(): boolean {
    return this.bankWindow.isOpen;
  }

  // Fired by the bags painter after its close() teardown. On touch, a bags close
  // that leaves the bank open (the tray/minimap bags toggle; Esc and the bags x-btn
  // close the whole cluster instead) undocks the pairing so the standalone mobile
  // full-screen rule takes over: the bank widens to the full viewport and its own
  // x-btn reappears (the pairing hid it), so a touch close affordance survives.
  // Desktop deliberately keeps the docked offset until the bank closes (the
  // recorded vendor-family behavior); toggleBags re-adds the class on re-open.
  private onBagsClosed(): void {
    if (document.body.classList.contains('mobile-touch') && this.bankWindow.isOpen) {
      document.body.classList.remove('bank-open');
    }
  }

  // The Book of Deeds trio (keybind toggle, chronicler/char-panel opens, Esc
  // close). open() takes an optional section so a chronicler lands on the
  // Chronicles category.
  openDeeds(category?: DeedDisplayCategory | 'titles'): void {
    this.deedsWindow.open(category);
  }

  closeDeeds(): void {
    this.deedsWindow.close();
  }

  toggleDeeds(): void {
    this.deedsWindow.toggle();
  }

  get deedsWindowOpen(): boolean {
    return this.deedsWindow.isOpen;
  }

  // Repaint the deed tracker from the live facet: the slow band, a watch
  // toggle, the collapse toggle, and language switches all funnel here; the
  // elided writers make an unchanged repaint free.
  private updateDeedTracker(): void {
    const collapsed = (this.optionsHooks?.settings.get('deedTrackerCollapsed') ?? false) === true;
    const view = buildDeedTrackerViewInto(
      this.deedTrackerView,
      this.deedsWindow.watched,
      this.sim.deedsEarned,
      this.sim.deedStats,
      DEEDS,
      collapsed,
    );
    // Compact touch tier: the rows are folded away (hud.mobile.css) and the header
    // is a count chip that opens the Book (see the #deed-tracker click/keydown
    // delegation, which reroutes to openDeeds here). Tell the painter so it swaps
    // the header from a disclosure toggle to a dialog opener. Reuse the exact class
    // test the delegation uses so the announced role matches the behavior.
    view.chip =
      document.body.classList.contains('mobile-touch') &&
      document.body.classList.contains('hud-mobile-compact');
    this.deedTrackerPainter.update(view);
  }

  /** Flip the persisted deed-tracker collapse (header click/keyboard delegation). */
  private toggleDeedTrackerCollapsed(): void {
    const settings = this.optionsHooks?.settings;
    if (!settings) return;
    settings.set('deedTrackerCollapsed', !settings.get('deedTrackerCollapsed'));
    audio.click();
    this.updateDeedTracker();
  }

  toggleCalendar(): void {
    this.calendarWindow.toggle();
  }

  closeCalendar(): void {
    this.calendarWindow.close();
  }

  get calendarWindowOpen(): boolean {
    return this.calendarWindow.isOpen;
  }

  private nearbyMarketNpc(): Entity | null {
    const p = this.sim.player;
    for (const e of this.sim.entities.values()) {
      if (e.kind === 'npc' && NPCS[e.templateId]?.market && dist2d(p.pos, e.pos) <= 8) return e;
    }
    return null;
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
    if (bagsWindowShown(el.style.display)) {
      // Close through the painter so focus returns to the opener (WCAG 2.4.3); close()
      // owns the hide + tooltip + pet-feed teardown, so keep only the audio cue here.
      // Only a genuinely shown window closes here: on a cold load the inline display
      // is '' (hidden by the .window CSS rule), which must open on the first press,
      // not take this close branch and play the close sound (issue #1538).
      audio.bagClose();
      this.bagsWindow.close();
      return;
    }
    this.closeOtherWindows('#bags');
    // Record the opener (the minimap bag button / keybind focus) for the focus return.
    this.bagsWindow.noteOpener();
    this.renderBags();
    el.style.display = 'flex';
    // Re-dock the bank pairing when its companion re-opens (the mobile undock in
    // onBagsClosed drops the class while the bank stays up; idempotent on desktop,
    // which never undocks).
    if (this.bankWindow.isOpen) document.body.classList.add('bank-open');
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
    // A grant or apply from another session on the account (or a server
    // correction of an optimistic apply) must refresh an open armory too.
    this.dailyRewardsWindow.onCosmeticsChanged();
  }

  private renderCharIfOpen(): void {
    this.charWindow.renderIfOpen();
  }

  renderBags(): void {
    this.bagsWindow.render();
  }

  // -------------------------------------------------------------------------
  // Character window
  // -------------------------------------------------------------------------

  toggleChar(): void {
    this.charWindow.toggle();
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
    // 3D model reflects gear changes (the char window repaints the preview after an
    // equip via charWindow.renderIfOpen -> renderPreview).
    const weapon = this.sim.equipment.mainhand ?? null;
    if (previewKey) {
      // mech is class-agnostic; mirror the wearer class's hand layout (rogue
      // dual-wields) so the paperdoll matches the in-world render
      const override = previewKey === 'player_mech' ? mechHeldWeaponOverride(cls) : null;
      this.charPreview.setVisualKey(previewKey, weapon, override);
    } else {
      this.charPreview.setClass(cls, weapon);
    }
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
    this.skinEventTrap?.release();
    this.skinEventTrap = null;
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
    if (!this.skinEventTrap)
      this.skinEventTrap = this.focusManager.open({ root: () => this.skinEventEl });
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
    if (!this.skinEventTrap)
      this.skinEventTrap = this.focusManager.open({ root: () => this.skinEventEl });
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
    this.cardModalTrap = this.focusManager.open({ root: () => this.cardModalEl });
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
    this.cardModalTrap?.focusFirst('[data-close]');

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
    this.cardModalTrap?.release(restoreFocus);
    this.cardModalTrap = null;
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

    // Developer badge: a global display preference (no per-card modal toggle
    // like the wallet flair has, since "hide dev badges" is meant to apply
    // everywhere at once, not be re-decided per export).
    const showDevBadges = this.optionsHooks?.settings.get('showDevBadges') ?? true;

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

    // The selected Book of Deeds title, resolved to display text here (the
    // compositor never sees deed ids); untitled/stale resolves '' and the
    // field is omitted so the card stays byte-identical to the pre-title one.
    const cardTitleText = sim.activeTitle ? deedTitleText(sim.activeTitle) : '';
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
      ...(cardTitleText ? { titleText: cardTitleText } : {}),
      topPercent,
      balance: showWallet ? verifiedWocBalance() : null,
      devTier: showDevBadges ? (p.devTier ?? null) : null,
      devMergedPrs: showDevBadges ? (p.devMergedPrs ?? null) : null,
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
    if (sp) html += `<span>${t('game.talents.role')}: <b>${roleLabel(sp.role)}</b></span>`;
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
    // Earned Book of Deeds border rewards join the badge row through the same
    // ms-badge plumbing (nameplate border display is a deliberate v1 cut).
    const borderBadges = DEED_ORDER.filter(
      (id) => DEEDS[id].reward?.kind === 'border' && sim.deedsEarned.has(id),
    )
      .map((id) => `<span class="ms-badge ms-deed-border">${esc(deedName(id))}</span>`)
      .join('');
    const badges =
      MILESTONES.filter((m) => unlocked.has(m.id))
        .map((m) => `<span class="ms-badge ms-${m.kind}">${this.milestoneName(m.id)}</span>`)
        .join('') + borderBadges;
    let html = `<div class="cp-title">${t('game.progression.heading')}</div>`;
    html += `<div class="char-stats cp-stats">
      <span>${t('game.progression.totalXp')}: <b>${formatXp(sim.lifetimeXp)}</b></span>
      <span>${t('game.progression.virtualLevel')}: <b>${vlevel}</b></span>`;
    if (sim.prestigeRank > 0)
      html += `<span>${t('game.progression.prestigeRank')}: <b>★ ${sim.prestigeRank}</b></span>`;
    html += `</div>`;
    html += `<div class="cp-milestones"><span class="cp-ms-label">${t('game.progression.milestones')}:</span> ${badges || `<span class="cp-none">${t('game.progression.none')}</span>`}</div>`;
    // The active Book of Deeds title line; the button opens the Book (its
    // Titles section is one click away). Title text is deed content localized
    // through deed_i18n, never a raw id.
    const activeTitleText = sim.activeTitle ? deedTitleText(sim.activeTitle) : '';
    html += `<div class="cp-milestones"><span class="cp-ms-label">${t('hudChrome.deeds.charTitleLabel')}:</span> ${
      activeTitleText !== ''
        ? `<b class="cp-active-title">${esc(activeTitleText)}</b>`
        : `<span class="cp-none">${t('hudChrome.deeds.charTitleNone')}</span>`
    } <button type="button" class="btn cp-deeds-btn" data-act="open-deeds">${t('hudChrome.deeds.charOpenBook')}</button></div>`;
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
    this.confirmTrap?.release(false);
    this.confirmTrap = null;
    document.getElementById('confirm-dialog')?.remove();
    const el = document.createElement('div');
    el.id = 'confirm-dialog';
    el.className = 'window panel';
    el.style.display = 'block';
    // Kept inline rather than folded onto markDialogRoot: that helper would also set
    // tabindex=-1 on the root, which this focusManager-trapped prompt does not use
    // (byte-preserving on the trap). The dialog is named via aria-labelledby.
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'confirm-dialog-title');
    el.innerHTML =
      `<div class="panel-title"><span id="confirm-dialog-title">${esc(title)}</span><button type="button" class="x-btn" data-cancel aria-label="${esc(cancelText)}">${svgIcon('close')}</button></div>` +
      `<div class="cd-body">${esc(body)}</div>` +
      `<div class="cd-actions"><button type="button" class="btn" data-cancel>${esc(cancelText)}</button><button type="button" class="btn cd-ok" data-ok>${esc(okText)}</button></div>`;
    document.body.appendChild(el);
    this.bringWindowToFront(el);
    // A confirm prompt is the topmost modal by definition: the window band tops
    // out at 89 and the armory inspect overlay sits at 90, so floor it above
    // both or a purchase confirmation opens invisibly underneath.
    el.style.zIndex = String(Math.max(Number(el.style.zIndex) || 0, 95));
    this.confirmTrap = this.focusManager.open({ root: () => el });
    el.querySelector<HTMLElement>('[data-ok]')?.focus();
    const close = () => {
      this.confirmTrap?.release();
      this.confirmTrap = null;
      el.remove();
    };
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
    this.confirmTrap?.release(false);
    this.confirmTrap = null;
    document.getElementById('confirm-dialog')?.remove();
    const el = document.createElement('div');
    el.id = 'confirm-dialog';
    el.className = 'window panel';
    el.style.display = 'block';
    // Same named, modal dialog semantics as confirmDialog (this reuses the #confirm-dialog
    // chrome and is focus-trapped below); without them it announces as a bare unlabelled div.
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'confirm-dialog-title');
    const field = opts.multiline
      ? `<textarea class="cd-input" rows="3" ${opts.readOnly ? 'readonly' : ''} placeholder="${esc(opts.placeholder ?? '')}">${esc(opts.value ?? '')}</textarea>`
      : `<input class="cd-input" type="text" ${opts.readOnly ? 'readonly' : ''} placeholder="${esc(opts.placeholder ?? '')}" value="${esc(opts.value ?? '')}">`;
    el.innerHTML =
      `<div class="panel-title"><span id="confirm-dialog-title">${esc(opts.title)}</span><span class="x-btn" data-cancel>${svgIcon('close')}</span></div>` +
      (opts.label ? `<div class="cd-body">${esc(opts.label)}</div>` : '') +
      `<div class="cd-field">${field}</div>` +
      `<div class="cd-actions"><button class="btn" data-cancel>${esc(opts.cancelText ?? t('game.talents.cancel'))}</button>` +
      (opts.copy ? `<button class="btn" data-copy>${t('game.talents.copy')}</button>` : '') +
      (opts.onOk
        ? `<button class="btn cd-ok" data-ok>${esc(opts.okText ?? t('game.talents.save'))}</button>`
        : '') +
      `</div>`;
    document.body.appendChild(el);
    this.confirmTrap = this.focusManager.open({ root: () => el });
    const input = el.querySelector('.cd-input') as HTMLInputElement | HTMLTextAreaElement;
    const close = () => {
      this.confirmTrap?.release();
      this.confirmTrap = null;
      el.remove();
    };
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
      // Return-to-trigger stays synchronous and OUTSIDE the focus manager: this is the
      // WAI-ARIA listbox pattern (dropdown_nav.ts), not a window trap, and the manager's
      // restore() defers a tick, which would drop focus to <body> before the native Tab
      // handoff below. The dropdown lives inside windows the manager already traps.
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

  // The leaderboard window is the one async/paged window; it lives in
  // LeaderboardWindow (leaderboard_view.ts core + leaderboard_window.ts painter),
  // which consumes the paged leaderboard() and owns the page index + focus.
  toggleLeaderboard(): void {
    this.leaderboardWindow.toggle();
  }

  toggleDailyRewards(): void {
    if (!this.dailyRewardsEnabled()) return;
    this.dailyRewardsWindow.toggle();
    this.refreshDailyRewardsLauncher(true);
  }

  /** Inject the online economy hooks that back the Claudium window (main.ts, online only). */
  attachClaudium(hooks: ClaudiumHooks): void {
    this.claudiumHooks = hooks;
    this.syncDailyRewardsSurfaceLabels();
    this.claudiumLauncherBalance = null;
    this.claudiumLauncherBalanceLastMs = 0;
    this.claudiumLauncherBalanceSeq++;
    this.claudiumLauncherBalancePending = false;
    this.refreshClaudiumLauncherBalance(true);
  }

  /**
   * Open or close the Claudium store. Always renders: with no hooks (offline or the
   * service off) the window shows its clean disabled state, never a boot crash.
   */
  toggleClaudium(): void {
    if (!this.claudiumHooks) return;
    this.claudiumWindow.toggle();
  }

  async refreshClaudium(): Promise<void> {
    this.refreshClaudiumLauncherBalance(true);
    if (!this.claudiumWindow.isOpen) return;
    await this.claudiumWindow.render();
  }

  // -------------------------------------------------------------------------
  // Spellbook
  // -------------------------------------------------------------------------

  // The spellbook window lives in SpellbookWindow (spellbook_view.ts core +
  // spellbook_window.ts painter), which renders the class kit + bar toggles and
  // refreshes the +/- controls from hud.update() while open.
  toggleSpellbook(): void {
    this.spellbookWindow.toggle();
  }

  // -------------------------------------------------------------------------
  // Talents & Specializations panel (bound to 'N'). The interactive staged-edit
  // window (tree, spec tabs, loadout footer) lives in TalentsWindow; Hud stays the
  // coordinator (closeOtherWindows needs its private window state). The staged build
  // commits through the server-authoritative IWorld on save / loadout switch /
  // delete (saveLoadout / switchLoadout / deleteLoadout), never inline.
  // -------------------------------------------------------------------------

  toggleTalents(): void {
    const el = $('#talents-window');
    if (el.style.display === 'block') {
      this.talentsWindow.close();
      return;
    }
    this.closeOtherWindows('#talents-window');
    this.talentsWindow.open();
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

  // The quest-log window lives in QuestLogWindow (questlog_view.ts core +
  // questlog_window.ts painter), which owns the selected quest id (read back by the
  // quest-share command via selectedQuestId) and the abandon / chat-link flows.
  toggleQuestLog(): void {
    this.questlogWindow.toggle();
  }

  // -------------------------------------------------------------------------
  // Party frames
  // -------------------------------------------------------------------------

  /** Flip and persist the mobile party-collapse choice (the chip's tap), then re-drive
   *  the chip immediately so the toggle lands this frame rather than next tick. A pure
   *  USER action; the persisted flag is the only input to the collapse, never a
   *  graphics tier / reduce-motion / governor signal. */
  private togglePartyCollapsed(): void {
    this.partyCollapsed = !this.partyCollapsed;
    savePartyCollapsed(this.partyCollapsed);
    this.partyFramesPainter.setCollapse(
      !!this.sim.partyInfo,
      this.isMobileLayout(),
      this.partyCollapsed,
      this.isMobileChatOpen(),
    );
  }

  /** Whether the mobile chat overlay (body.mobile-chat-open) is up. While it is, the
   *  party UI yields (see setCollapse); a transient read, never persisted. */
  private isMobileChatOpen(): boolean {
    return document.body.classList.contains('mobile-chat-open');
  }

  private updatePartyFrames(): void {
    const target =
      this.sim.player.targetId !== null ? this.sim.entities.get(this.sim.player.targetId) : null;
    this.partyFramesPainter.setBelowTarget(!!target && target.kind !== 'object');
    const info = this.sim.partyInfo;
    if (!info) {
      // Clear only on the transition out of a party (matching the inline `innerHTML
      // !== ''` guard), so a persistently party-less HUD does no per-frame work.
      if (this.lastPartySig !== '') {
        this.partyFramesPainter.clear();
        this.lastPartySig = '';
      }
      if (this.lootSettingsOpen) this.closeLootSettings();
      this.lastLootSettingsSig = '';
      this.wasLeaderOfParty = false;
      return;
    }
    // Drive the mobile collapse chip from (in a party, on the touch HUD, the persisted
    // collapse choice, whether mobile chat is open), every frame. Fully elided: a
    // steady state (unchanged inputs) writes nothing. On desktop the chip is never
    // built and the container carries no collapse class, so the desktop stack is
    // unchanged. While mobile chat is open the party UI yields (chip + frames hide) so
    // the chat overlay owns the top-left; the persisted choice is untouched, so closing
    // chat restores it.
    this.partyFramesPainter.setCollapse(
      true,
      this.isMobileLayout(),
      this.partyCollapsed,
      this.isMobileChatOpen(),
    );
    // The Loot Settings window (opened on demand from the right-click menu) is
    // repainted from authoritative state while open. The signature is low frequency
    // (loot settings + leadership + membership, NO hp/res) so it is not rebuilt every
    // combat tick. The leader's controls and a member's read-only view both track it.
    if (this.lootSettingsOpen) {
      const sig = `${info.master.enabled ? 1 : 0}/${info.master.looter}/${info.master.threshold}/${info.leader}:${info.members.map((m) => `${m.pid}:${m.name}`).join(',')}`;
      if (sig !== this.lastLootSettingsSig) {
        this.lastLootSettingsSig = sig;
        this.paintLootSettings(info);
      }
    }
    // Auto-open the Loot Settings panel the moment the local player BECOMES the party
    // leader (leader last frame -> not, or rather not -> is): forming a group as its
    // creator, being promoted, or succeeding a leader who left. That is when the loot
    // rules become yours to set, so surface them. A non-explicit open: it shows without
    // stealing keyboard focus or closing other windows mid-game. A plain member (never
    // the leader) never triggers it.
    const isLeaderNow = info.leader === this.sim.playerId;
    const becameLeader = isLeaderNow && !this.wasLeaderOfParty;
    this.wasLeaderOfParty = isLeaderNow;
    if (becameLeader && !this.lootSettingsOpen) this.openLootSettings(false);
    // Hoist the cheap signature (a single string pass, no intermediate arrays) AHEAD
    // of the selector so an unchanged party short-circuits before selectPartyFrameMembers
    // allocates its sorted / filtered / mapped arrays.
    const sig = partyFrameSignature(info, this.sim.playerId, this.sim.player.pos);
    if (sig === this.lastPartySig) return;
    this.lastPartySig = sig;
    const others = selectPartyFrameMembers(info, this.sim.playerId, this.sim.player.pos);
    this.partyFramesPainter.sync(others, info.leader, info.raid);
    // Re-dock the Loot Settings panel below the (just re-synced) party frames when their
    // size changes (row count / raid grouping). Gated so the layout measure runs on a real
    // geometry change, not every combat tick; positionLootSettingsPanel honors a manual drag.
    if (this.lootSettingsOpen) {
      const geomSig = `${others.length}/${info.raid ? 1 : 0}`;
      if (geomSig !== this.lastLootGeomSig) {
        this.lastLootGeomSig = geomSig;
        this.positionLootSettingsPanel();
      }
    }
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
    if (party)
      html += `<div class="ctx-item" data-act="loot-settings">${esc(t('hudChrome.lootSettings.menuItem'))}</div>`;
    // Dungeon difficulty (classic portrait-menu placement): the label states
    // the ACTION (switch to the other difficulty). Solo players and party
    // leaders only; the sim refuses the change from other members. The
    // confirmation toast comes back from the sim ("Dungeon difficulty set
    // to ..."), re-localized by sim_i18n like every sim emit.
    if (!party || party.leader === this.sim.playerId) {
      const isHeroic = this.sim.dungeonDifficulty() === 'heroic';
      html += `<div class="ctx-item" data-act="dungeon-difficulty">${esc(
        t(
          isHeroic
            ? 'hudChrome.dungeonDifficulty.setNormal'
            : 'hudChrome.dungeonDifficulty.setHeroic',
        ),
      )}</div>`;
    }
    html += `<div class="ctx-item" data-act="close">${esc(t('hud.chat.context.cancel'))}</div>`;
    el.innerHTML = html;
    hydratePortraits(el);
    el.style.display = 'block';
    const ctxItemCount = (html.match(/class="ctx-item"/g) ?? []).length;
    const ctxReserveBottom = 80 + ctxItemCount * (this.isMobileLayout() ? 44 : 28);
    this.placePopupAt(el, x, y, 170, ctxReserveBottom);
    this.keepPopupOnScreen(el);
    this.bindContextMenuActions((act) => {
      if (act === 'convert-raid') {
        this.sim.convertPartyToRaid();
        this.socialWindow.selectRaidTab();
      } else if (act === 'convert-party') {
        this.sim.convertRaidToParty();
        this.socialWindow.selectRaidTab();
      } else if (act === 'loot-settings') this.openLootSettings();
      else if (act === 'dungeon-difficulty') {
        this.sim.setDungeonDifficulty(
          this.sim.dungeonDifficulty() === 'heroic' ? 'normal' : 'heroic',
        );
      }
    });
  }

  // Open the target-frame unit menu at a viewport point, shared by the desktop
  // right-click (contextmenu) and the touch double-tap. A friendly player (not
  // you) gets the social/party menu; your own pet gets the pet menu; a live wild
  // hostile mob (in a party) gets the raid-marker menu, mirroring Sim.setMarker's
  // markable criteria so the menu never appears where it would be a no-op.
  private openTargetFrameMenuAt(x: number, y: number): void {
    const tid = this.sim.player.targetId;
    const t = tid !== null ? this.sim.entities.get(tid) : null;
    if (t && t.kind === 'player' && t.id !== this.sim.playerId) {
      this.openContextMenu(t.id, t.name, x, y);
    } else if (t && t.kind === 'mob' && t.ownerId === this.sim.playerId) {
      this.openPetMenu(t.id, t.name, t.dead, x, y);
    } else if (
      t &&
      t.kind === 'mob' &&
      !t.dead &&
      t.hostile &&
      t.ownerId === null &&
      this.sim.partyInfo
    ) {
      this.openMarkerMenu(t.id, t.name, x, y);
    }
  }

  /**
   * The stream-link rows both player menus share. Resolved by NAME through
   * IWorld.accountFlair, which works for a player far outside your ~120yd interest
   * scope (a name you only ever saw in chat); the live entity's wire fields are the
   * fallback for the in-view case. streamerMenuActions re-validates every URL, so a
   * link that is not a plain https URL on that platform's own host never becomes a
   * row at all.
   */
  private streamerLinksFor(name: string, ent?: Entity): StreamerLinks | undefined {
    return (
      this.sim.accountFlair(name)?.links ?? (ent?.kind === 'player' ? ent.streamerLinks : undefined)
    );
  }

  private streamerActionsFor(name: string, ent?: Entity): PlayerContextAction[] {
    return streamerMenuActions(this.streamerLinksFor(name, ent));
  }

  /**
   * Is this account AI-operated? Same two sources, same precedence as
   * streamerLinksFor: the by-name flair cache first (so it resolves for a player who
   * is nowhere near you and only ever spoke in chat), then the live entity.
   */
  private isAiAccount(name: string, ent?: Entity): boolean {
    return (
      this.sim.accountFlair(name)?.ai ?? (ent?.kind === 'player' ? ent.aiAccount === true : false)
    );
  }

  /**
   * The player-menu header: portrait chip, then the name, with the [AI] mark inside
   * the name span rather than beside it. The header is a flex row with a wide gap, so
   * a sibling tag would drift away from the name it qualifies; nested, it stays glued
   * to the name and the name's ellipsis still governs the overflow. Shared by both
   * player menus (chat-name and nameplate) so the two cannot drift apart.
   */
  private ctxPlayerTitleHtml(name: string, entCls: PlayerClass | null, ent?: Entity): string {
    const chip = entCls
      ? portraitChipHtml({ cls: entCls, skin: ent?.skin ?? 0, name, variant: 'sm' })
      : '';
    const label = esc(t('hudChrome.playerMenu.aiTagTitle'));
    const ai = this.isAiAccount(name, ent)
      ? `<span class="ai-tag ctx-title-ai" role="img" aria-label="${label}" title="${label}">${esc(t('hudChrome.playerMenu.aiTag'))}</span>`
      : '';
    return `<div class="ctx-title ctx-title-player">${chip}<span class="ctx-title-name">${ai}${esc(name)}</span></div>`;
  }

  /**
   * NEVER interpolate `action.href` into this markup, not even inside a quoted
   * attribute. A streamer link is operator-entered text, and while
   * normalizeStreamerLink pins it to an https URL on the platform's own host, the
   * WHATWG URL parser leaves a single quote (and `&`) UNENCODED in the path: a
   * legal-but-hostile `https://twitch.tv/a'onmouseover=alert(1)'` would break out
   * of a single-quoted or unquoted attribute. The href is deliberately kept in the
   * JS `actions` array and handed straight to window.open by openStreamerLink, so
   * it never becomes HTML. Only the fixed enum id, the fixed-registry icon, and an
   * esc()'d t() label are interpolated here. tests/chat_context_menu.test.ts pins this.
   */
  private ctxItemHtml(action: PlayerContextAction): string {
    const icon = action.icon ? svgIcon(action.icon) : '';
    return `<div class="ctx-item${action.icon ? ' ctx-stream' : ''}" data-act="${action.id}">${icon}${esc(action.label)}</div>`;
  }

  /**
   * Open a stream-link row's channel, if `act` is one; false for every other row.
   * The URL is re-validated HERE, at click time, even though the server validated it
   * on write and streamerLinkList validated it again when the row was built: this is
   * the last gate before an operator-entered string reaches window.open.
   */
  private openStreamerLink(act: string, actions: PlayerContextAction[]): boolean {
    const platform = streamerActionPlatform(act as PlayerContextActionId);
    if (!platform) return false;
    const url = normalizeStreamerLink(platform, actions.find((a) => a.id === act)?.href);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
    return true;
  }

  openContextMenu(pid: number, name: string, x: number, y: number): void {
    const el = $('#ctx-menu');
    const party = this.sim.partyInfo;
    const isLeader = party?.leader === this.sim.playerId;
    const isMember = !!party?.members.some((m) => m.pid === pid);
    // Same flag resolution the chat-name menu uses, so the two menus can never
    // disagree about whether this player is muted, blocked, friended or guilded.
    const flags = this.playerSocialFlags(name);
    const { online, isFriend, ignored, blocked } = flags;
    const inGuildWithInvite = flags.canGuildInvite;
    const alreadyGuilded = flags.alreadyGuilded;
    const ent = this.sim.entities.get(pid);
    const entCls = ent && ent.kind === 'player' ? (ent.templateId as PlayerClass) : null;
    // An official streamer's own channels lead, right under the title, exactly as
    // they do on the chat-name menu (both build their rows from streamerMenuActions).
    const streamActions = this.streamerActionsFor(name, ent);
    let html = this.ctxPlayerTitleHtml(name, entCls, ent);
    html += streamActions.map((a) => this.ctxItemHtml(a)).join('');
    html += `<div class="ctx-item" data-act="info">${esc(t('hudChrome.playerMenu.info'))}</div>`;
    if (pid !== this.sim.playerId)
      html += `<div class="ctx-item" data-act="whisper">${esc(t('hud.chat.context.whisper'))}</div>`;
    if (!isMember)
      html += `<div class="ctx-item" data-act="invite">${esc(t('hud.chat.context.invite'))}</div>`;
    html += `<div class="ctx-item" data-act="trade">${esc(t('hud.chat.context.trade'))}</div>`;
    html += `<div class="ctx-item" data-act="duel">${esc(t('hud.chat.context.challengeDuel'))}</div>`;
    if (online)
      html += `<div class="ctx-item" data-act="${isFriend ? 'unfriend' : 'friend'}">${esc(t(isFriend ? 'hud.chat.context.removeFriend' : 'hud.chat.context.addFriend'))}</div>`;
    if (inGuildWithInvite && !alreadyGuilded)
      html += `<div class="ctx-item" data-act="ginvite">${esc(t('hud.chat.context.inviteGuild'))}</div>`;
    html += `<div class="ctx-item" data-act="ignore">${esc(t(ignored ? 'hud.chat.context.unignore' : 'hud.chat.context.ignore'))}</div>`;
    if (online)
      html += `<div class="ctx-item" data-act="block">${esc(t(blocked ? 'hudChrome.playerMenu.unblock' : 'hudChrome.playerMenu.block'))}</div>`;
    if (this.reportHooks && pid !== this.sim.playerId)
      html += `<div class="ctx-item" data-act="report">${esc(t('hud.chat.context.report'))}</div>`;
    if (isLeader && isMember && pid !== this.sim.playerId) {
      html += `<div class="ctx-item" data-act="promote">${esc(t('hudChrome.party.promoteLeader'))}</div>`;
      html += `<div class="ctx-item" data-act="kick">${esc(t('hud.chat.context.removeParty'))}</div>`;
    }
    if (isMember || pid === this.sim.playerId)
      html += `<div class="ctx-item" data-act="loot-settings">${esc(t('hudChrome.lootSettings.menuItem'))}</div>`;
    html += `<div class="ctx-item" data-act="close">${esc(t('hud.chat.context.cancel'))}</div>`;
    el.innerHTML = html;
    hydratePortraits(el);
    el.style.display = 'block';
    // Reserve the menu's own height (title + one row per item) so placePopupAt seats
    // it fully on-screen. Computed from the item count, not measured, so it is right
    // even on the very first open (a fresh display:none -> block box can read stale).
    // The mobile 40px item floor makes this menu tall enough to matter on a short
    // landscape phone; over-reserving only nudges it higher, never off the top.
    const ctxItemCount = (html.match(/class="ctx-item"/g) ?? []).length;
    const ctxReserveBottom = 80 + ctxItemCount * (this.isMobileLayout() ? 44 : 28);
    this.placePopupAt(el, x, y, 170, ctxReserveBottom);
    this.keepPopupOnScreen(el);
    this.bindContextMenuActions((act) => {
      if (this.openStreamerLink(act, streamActions)) return;
      if (act === 'info') this.openPlayerInfo(name, pid);
      else if (act === 'whisper') this.startWhisper(name);
      else if (act === 'invite') this.sim.partyInvite(pid);
      else if (act === 'trade') this.sim.tradeRequest(pid);
      else if (act === 'duel') this.sim.duelRequest(pid);
      else if (act === 'friend') this.sim.friendAdd(name);
      else if (act === 'unfriend') this.sim.friendRemove(name);
      else if (act === 'ginvite') this.sim.guildInvite(name);
      else if (act === 'ignore') this.togglePlayerIgnore(name, ignored);
      else if (act === 'block') this.togglePlayerBlock(name, blocked);
      else if (act === 'report') this.openReportWindow({ pid, name });
      else if (act === 'promote') this.sim.partyPromote(pid);
      else if (act === 'kick') this.sim.partyKick(pid);
      else if (act === 'loot-settings') this.openLootSettings();
    });
  }

  // Fill the target frame's social/badge line: a linked player's nickname (with
  // PFP), their staff-role tag, Discord rank, and developer badge. Hidden for mobs
  // and players with no linked flair at all.
  private updateTargetDiscordLine(target: Entity): void {
    const el = this.targetDiscordEl;
    const tier = target.discordTier ?? 0;
    const showDevBadges = this.optionsHooks?.settings.get('showDevBadges') ?? true;
    const devIdx = showDevBadges ? (target.devTier ?? 0) : 0;
    // The AI mark rides this line too, so it has to be in BOTH the early-out below
    // and the signature: without it an AI account carrying no Discord/dev flair
    // would never render the line at all, and a live flag flip would never repaint.
    const isAi = target.aiAccount === true;
    if (
      target.kind !== 'player' ||
      (!tier && !target.discordName && !target.discordRole && !devIdx && !isAi)
    ) {
      if (this.targetDiscordSig !== '') {
        this.targetDiscordSig = '';
        el.classList.remove('show');
        el.replaceChildren();
      }
      return;
    }
    // This runs every frame the target frame updates; only rebuild when the Discord
    // content actually changes (else a fresh <img> per frame would re-fetch the
    // avatar and, on a failing CDN load, flicker between the broken glyph and hidden).
    const sig = `${tier}|${target.discordName ?? ''}|${target.discordRole ?? ''}|${target.discordAvatar ?? ''}|${devIdx}|${isAi ? 1 : 0}`;
    if (sig === this.targetDiscordSig) return;
    this.targetDiscordSig = sig;
    const parts: string[] = [];
    const nameInner = target.discordAvatar
      ? `<img src="${esc(target.discordAvatar)}" referrerpolicy="no-referrer" alt="" draggable="false">${esc(target.discordName ?? '')}`
      : esc(target.discordName ?? '');
    if (target.discordName || target.discordAvatar) {
      parts.push(`<span class="uf-dc-name">${nameInner}</span>`);
    }
    const roleLabel = discordRoleTagLabel(target.discordRole);
    if (roleLabel) {
      parts.push(
        `<span class="uf-dc-chip role" style="--role:${specialRoleColor(target.discordRole) ?? '#888'}">${esc(roleLabel)}</span>`,
      );
    }
    if (tier > 0) {
      parts.push(`<span class="uf-dc-chip rank">${esc(discordStatusDisplayName(tier))}</span>`);
    }
    const devDef = devTierByIndex(devIdx);
    if (devDef) {
      parts.push(`<span class="uf-dc-chip dev">${esc(devTierDisplayName(devDef))}</span>`);
    }
    if (isAi) {
      // The shared .ai-tag mark, and deliberately NOT a .uf-dc-chip: the chip rules
      // live UNLAYERED in index.extra.css, and unlayered CSS beats every @layer rule,
      // so the chip's own color/background would override the gradient in
      // @layer components and paint straight over it. The flair line is a flex row,
      // so a bare span sits inline beside the chips anyway.
      parts.push(
        // role=img + aria-label, not just title: this is a DISCLOSURE, and assistive
        // tech announces `title` inconsistently on a non-focusable span. Screen-reader
        // users must hear "AI-operated account", not the bare "[AI]" literal (or, if
        // the title is skipped entirely, nothing at all). Mirrors chatAiTagEl.
        `<span class="ai-tag" role="img" aria-label="${esc(t('hudChrome.playerMenu.aiTagTitle'))}" title="${esc(t('hudChrome.playerMenu.aiTagTitle'))}">${esc(t('hudChrome.playerMenu.aiTag'))}</span>`,
      );
    }
    el.innerHTML = parts.join('');
    // Hide the external Discord avatar if its CDN image fails to load, so the line
    // never shows the browser's broken-image placeholder (the nickname stays).
    const dcAvatar = el.querySelector<HTMLImageElement>('.uf-dc-name img');
    if (dcAvatar) attachAvatarFallback(dcAvatar);
    el.classList.add('show');
  }

  /** Inspect another player: a profile window with their portrait, name, level
   *  and class — rendered locally from their entity's class + skin. */
  /**
   * The out-of-range Player Info card: the same #inspect-window, painted from the
   * public character sheet. Deliberately thinner than openInspect: no worn gear,
   * no wallet balance, no Discord/GitHub identity. Those live on the per-entity
   * wire and stay proximity-gated, so standing next to someone still shows you
   * strictly more than looking their name up from chat.
   */
  private openRemoteProfile(profile: CharacterProfile): void {
    const cls = profile.cls as PlayerClass;
    const el = $('#inspect-window');
    this.closeOtherWindows('#inspect-window');
    const guildHtml = profile.guild ? `<div class="inspect-meta">${esc(profile.guild)}</div>` : '';
    el.innerHTML =
      `<div class="panel-title"><span>${esc(t('character.profile'))}</span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('character.closeProfile'))}">${svgIcon('close')}</button></div>` +
      `<div class="inspect-card">` +
      portraitChipHtml({ cls, skin: profile.skin, name: profile.name, variant: 'lg' }) +
      `<div class="inspect-name">${esc(profile.name)}</div>` +
      `<div class="inspect-meta">${esc(
        t('itemUi.equipment.levelClass', {
          level: formatNumber(profile.level, { maximumFractionDigits: 0 }),
          className: classDisplayName(cls),
        }),
      )}</div>` +
      guildHtml +
      `</div>`;
    hydratePortraits(el);
    el.querySelector('[data-close]')?.addEventListener('click', () => {
      el.style.display = 'none';
    });
    el.style.display = 'block';
  }

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
    // Linked-Discord flair: avatar/badge, nickname, rank, "member since", role.
    const discordTierIdx = e.discordTier ?? 0;
    const discordImg = e.discordAvatar
      ? `<img class="inspect-holder-badge inspect-discord-pfp" src="${esc(e.discordAvatar)}" referrerpolicy="no-referrer" alt="" draggable="false">`
      : `<img class="inspect-holder-badge" src="${discordStatusBadgeDataUrl(discordTierIdx)}" alt="" draggable="false">`;
    const memberDays =
      typeof e.discordJoined === 'number'
        ? Math.max(0, Math.floor((Date.now() - e.discordJoined) / 86_400_000))
        : null;
    const memberSinceHtml =
      memberDays !== null
        ? `<div class="inspect-holder-sub">${esc(t('hudChrome.discord.memberSince'))}: ${esc(t('hudChrome.discord.memberSinceDays', { days: formatNumber(memberDays, { maximumFractionDigits: 0 }) }))}</div>`
        : '';
    const roleLabel = discordRoleTagLabel(e.discordRole);
    const roleHtml = roleLabel
      ? `<div class="inspect-holder-sub inspect-discord-role">${esc(roleLabel)}</div>`
      : '';
    const discordHtml =
      discordTierIdx > 0
        ? `<div class="inspect-holder">` +
          discordImg +
          `<div class="inspect-holder-text">` +
          `<div class="inspect-holder-name">${esc(e.discordName ? e.discordName : discordStatusDisplayName(discordTierIdx))}</div>` +
          `<div class="inspect-holder-sub">${esc(t('hudChrome.discord.title'))} · ${esc(discordStatusDisplayName(discordTierIdx))}</div>` +
          memberSinceHtml +
          roleHtml +
          `</div></div>`
        : '';
    // Developer badge: the cosmetic contributor tier, broadcast per-entity via the
    // `dvt`/`dvc`/`dgl` identity fields. Shown only for an actual contributor
    // (tier > 0), with the merged-PR count and the @login under the rung name,
    // and only while the viewer's own showDevBadges display preference is on.
    const showDevBadges = this.optionsHooks?.settings.get('showDevBadges') ?? true;
    const devTierDef = showDevBadges ? devTierByIndex(e.devTier ?? 0) : undefined;
    const devSub = e.devMergedPrs
      ? t('hudChrome.devBadge.prsLanded', {
          count: formatNumber(e.devMergedPrs, { maximumFractionDigits: 0 }),
        })
      : t('hudChrome.devBadge.contributor');
    const devLoginHtml = e.githubLogin
      ? `<div class="inspect-holder-sub inspect-dev-login">@${esc(e.githubLogin)}</div>`
      : '';
    const devHtml = devTierDef
      ? `<div class="inspect-holder">` +
        `<img class="inspect-holder-badge" src="${devTierBadgeDataUrl(devTierDef)}" alt="" draggable="false">` +
        `<div class="inspect-holder-text">` +
        `<div class="inspect-holder-name">${esc(devTierDisplayName(devTierDef))}</div>` +
        `<div class="inspect-holder-sub">${esc(devSub)}</div>` +
        devLoginHtml +
        `</div></div>`
      : '';
    el.innerHTML =
      `<div class="panel-title"><span>${esc(t('character.profile'))}</span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('character.closeProfile'))}">${svgIcon('close')}</button></div>` +
      `<div class="inspect-card">` +
      portraitChipHtml({ cls, skin: e.skin ?? 0, name: e.name, variant: 'lg' }) +
      `<div class="inspect-name">${esc(e.name)}</div>` +
      // The active Book of Deeds title (the entity `title` wire field, a deed
      // id): a subtitle line under the name, exactly the nameplate surface.
      (e.title && deedTitleText(e.title) !== ''
        ? `<div class="inspect-title">${esc(deedTitleText(e.title))}</div>`
        : '') +
      `<div class="inspect-meta">${esc(t('itemUi.equipment.levelClass', { level: formatNumber(e.level, { maximumFractionDigits: 0 }), className }))}</div>` +
      holderHtml +
      discordHtml +
      devHtml +
      `</div>` +
      // Worn gear, mirrored from the entity's render-only `equippedItems` (the
      // `eq` identity field). Item names/icons/tooltips resolve fully client-side
      // from the static ITEMS table, so only the slot->id map crosses the wire.
      `<div class="inspect-equip">` +
      `<div class="inspect-equip-title">${esc(t('classDetails.sections.equipment'))}</div>` +
      `<div class="paperdoll inspect-paperdoll">` +
      `<div class="equip-col" id="inspect-equip-left"></div>` +
      `<div class="equip-col equip-col-right" id="inspect-equip-right"></div>` +
      `</div></div>`;
    hydratePortraits(el);
    // If the linked-Discord avatar fails to load from the CDN, degrade to exactly the
    // no-avatar rendering (the plain status-tier badge, without the pfp's blue ring)
    // instead of the browser's broken-image placeholder.
    const inspectPfp = el.querySelector<HTMLImageElement>('.inspect-discord-pfp');
    if (inspectPfp) {
      attachAvatarFallback(inspectPfp, (img) => {
        img.classList.remove('inspect-discord-pfp');
        img.src = discordStatusBadgeDataUrl(discordTierIdx);
      });
    }
    const view = buildPaperdollView(e.equippedItems, ITEMS);
    const leftCol = el.querySelector('#inspect-equip-left');
    const rightCol = el.querySelector('#inspect-equip-right');
    for (const cell of view.left) leftCol?.appendChild(this.buildInspectSlotRow(cell));
    for (const cell of view.right) rightCol?.appendChild(this.buildInspectSlotRow(cell));
    el.querySelector('[data-close]')?.addEventListener('click', () => {
      el.style.display = 'none';
    });
    el.style.display = 'block';
  }

  /** Open the Loot Settings window: the leader gets the editable master-loot
   *  method/threshold controls, a member a read-only view of the same state. */
  // explicit = a user-initiated open (right-click): close other windows and trap /
  // move keyboard focus into the panel. Auto-open on forming a group passes false:
  // it just shows the panel, leaving the player's other windows and keyboard focus
  // (movement, chat) untouched.
  openLootSettings(explicit = true): void {
    const info = this.sim.partyInfo;
    if (!info) return;
    if (explicit) this.closeOtherWindows('#loot-settings-window');
    this.lootSettingsOpen = true;
    this.lastLootSettingsSig = '';
    // A fresh open re-docks below the party frames, even if a prior open was dragged away.
    this.lastLootGeomSig = '';
    this.lootSettingsAutoLeft = '';
    this.lootSettingsAutoTop = '';
    this.paintLootSettings(info);
    const el = $('#loot-settings-window');
    const wasHidden = el.style.display !== 'block';
    el.style.display = 'block';
    this.positionLootSettingsPanel();
    if (explicit) {
      if (wasHidden)
        this.lootSettingsTrap = this.focusManager.open({ root: () => $('#loot-settings-window') });
      this.lootSettingsTrap?.focusFirst();
    }
  }

  closeLootSettings(restoreFocus = true): void {
    this.lootSettingsOpen = false;
    this.lastLootGeomSig = '';
    $('#loot-settings-window').style.display = 'none';
    this.lootSettingsTrap?.release(restoreFocus);
    this.lootSettingsTrap = null;
  }

  // Dock the Loot Settings window below the party frames on the left. If the left column
  // would overflow the HUD height (a large raid pushes the panel off the bottom), fall
  // back to docking it to the right of the party frames. Desktop only (mobile keeps the
  // centered .window placement); honors a manual drag (stops auto-docking once moved).
  private positionLootSettingsPanel(): void {
    if (document.body.classList.contains('mobile-touch')) return;
    const el = $('#loot-settings-window');
    if (
      this.lootSettingsAutoLeft &&
      (el.style.left !== this.lootSettingsAutoLeft || el.style.top !== this.lootSettingsAutoTop)
    )
      return; // the player dragged it; leave it where they put it
    const pf = $('#party-frames');
    const gap = 8;
    const belowTop = pf.offsetTop + pf.offsetHeight + gap;
    const avail = (el.offsetParent as HTMLElement | null)?.clientHeight ?? window.innerHeight;
    const fitsBelow = belowTop + el.offsetHeight <= avail - gap;
    el.style.left = `${fitsBelow ? pf.offsetLeft : pf.offsetLeft + pf.offsetWidth + gap}px`;
    el.style.top = `${fitsBelow ? belowTop : pf.offsetTop}px`;
    el.style.transform = 'none';
    this.lootSettingsAutoLeft = el.style.left;
    this.lootSettingsAutoTop = el.style.top;
  }

  private paintLootSettings(info: PartyInfo): void {
    renderLootSettingsWindow(
      $('#loot-settings-window'),
      lootSettingsView(info, this.sim.playerId),
      {
        onChange: (enabled, looter, threshold) =>
          this.sim.setPartyLootMaster(enabled, looter, threshold),
        onClose: () => this.closeLootSettings(),
      },
    );
  }

  // One read-only equipment row for the inspect window: icon, slot name, and the
  // equipped item (quality-tinted) with its tooltip. Unlike the character window's
  // own paperdoll row, there are no unequip / drag affordances (another player's
  // gear is view-only); the quality color comes from the shared QUALITY_COLOR map.
  private buildInspectSlotRow(cell: PaperdollSlot): HTMLElement {
    const { slot, item } = cell;
    const row = document.createElement('div');
    row.className = 'equip-slot';
    const qColor = item ? (QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff') : '';
    const icon = item
      ? this.itemIcon(item)
      : `<img class="item-icon" src="${iconDataUrl('item', 'slot_empty')}" alt="" draggable="false">`;
    row.innerHTML = `${icon}<div><div class="slot-name">${esc(itemSlotName(slot))}</div><div class="slot-item"${item ? ` style="color:${qColor}"` : ''}>${item ? esc(itemDisplayName(item)) : esc(t('itemUi.equipment.empty'))}</div></div>`;
    if (item) this.attachTooltip(row, () => this.itemTooltip(item));
    return row;
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
    el.style.display = 'block';
    this.placePopupAt(el, x, y, 170, 240);
    this.keepPopupOnScreen(el);
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

  private openChatPlayerContextMenu(
    name: string,
    x: number,
    y: number,
    opener?: HTMLElement,
  ): void {
    const el = $('#ctx-menu');
    // Clicking the same name twice closes the menu. Without this branch, the
    // outside-click dismiss refuses to close a menu whose opener was clicked
    // (it treats the opener as "inside"), so the second click would silently
    // re-open it instead of toggling it shut.
    if (opener && el.style.display === 'block' && this.ctxMenuOpener === opener) {
      this.closeContextMenu();
      return;
    }
    const flags = this.playerSocialFlags(name);
    // A portrait chip only when the player is close enough to have a live entity;
    // for a name seen in /world or /lfg the title is name-only. Player Info still
    // works either way (it falls back to the public character sheet).
    const livePidForMenu = this.playerPidByName(name);
    const ent = livePidForMenu !== null ? this.sim.entities.get(livePidForMenu) : undefined;
    const actions = chatPlayerContextActions({
      playerName: name,
      selfName: this.sim.player.name,
      online: flags.online,
      isFriend: flags.isFriend,
      ignored: flags.ignored,
      blocked: flags.blocked,
      canGuildInvite: flags.canGuildInvite,
      alreadyGuilded: flags.alreadyGuilded,
      canReport: !!this.reportHooks?.submitByName,
      streamerLinks: this.streamerLinksFor(name, ent),
    });
    const entCls = ent && ent.kind === 'player' ? (ent.templateId as PlayerClass) : null;
    const titleHtml = this.ctxPlayerTitleHtml(name, entCls, ent);
    el.innerHTML = titleHtml + actions.map((a) => this.ctxItemHtml(a)).join('');
    hydratePortraits(el);
    el.style.display = 'block';
    // Reserve the real height (title + one row per action) instead of a fixed 240,
    // which the mobile 40px item floor now overflows.
    const reserveBottom = 80 + actions.length * (this.isMobileLayout() ? 44 : 28);
    this.placePopupAt(el, x, y, 170, reserveBottom);
    this.keepPopupOnScreen(el);
    this.ctxMenuOpener = opener ?? null;
    this.bindContextMenuActions((act) => {
      if (this.openStreamerLink(act, actions)) return;
      const livePid = this.playerPidByName(name);
      if (act === 'info') this.openPlayerInfo(name, livePid);
      else if (act === 'whisper') this.startWhisper(name);
      else if (act === 'invite') {
        // Route by NAME, not by pid: a chat name from /world, /lfg or /guild has
        // no entity inside our ~120yd interest scope, but the server-side sim
        // resolves /invite against every player on the realm.
        if (livePid !== null) this.sim.partyInvite(livePid);
        else this.sim.chat(`/invite ${name}`);
      } else if (act === 'friend') this.sim.friendAdd(name);
      else if (act === 'unfriend') this.sim.friendRemove(name);
      else if (act === 'ginvite') this.sim.guildInvite(name);
      else if (act === 'ignore') this.togglePlayerIgnore(name, flags.ignored);
      else if (act === 'block') this.togglePlayerBlock(name, flags.blocked);
      else if (act === 'report') this.openReportWindow({ name });
    });
  }

  /**
   * Player Info for a name. In view we have the live entity, so open the full
   * inspect card (gear + $WOC/Discord/dev flair, all of which ride the
   * proximity-gated entity wire). Out of view, fall back to the PUBLIC character
   * sheet, which is the same subset the crawlable /c/<name> page already serves,
   * so looking someone up from chat exposes nothing new about them.
   */
  private openPlayerInfo(name: string, pid: number | null): void {
    if (pid !== null && this.sim.entities.get(pid)?.kind === 'player') {
      this.openInspect(pid);
      return;
    }
    void this.sim.characterProfile(name).then((profile) => {
      if (!profile) {
        this.showError(t('hudChrome.playerMenu.profileUnavailable', { name }));
        return;
      }
      this.openRemoteProfile(profile);
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
        this.closeContextMenu();
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

  /** The per-player flags both context menus render from. */
  private playerSocialFlags(name: string): PlayerSocialFlags {
    return resolvePlayerSocialFlags(name, this.sim.socialInfo, this.localIgnoredNames);
  }

  private loadLocalIgnoredNames(): Set<string> {
    try {
      return parseIgnoreList(localStorage.getItem(LOCAL_IGNORES_KEY));
    } catch {
      return new Set();
    }
  }

  private saveLocalIgnoredNames(): void {
    try {
      localStorage.setItem(LOCAL_IGNORES_KEY, serializeIgnoreList(this.localIgnoredNames));
    } catch {
      // a full or blocked localStorage must never break chat
    }
  }

  /**
   * Toggle an ignore. Online the server owns the list (it is what filters the
   * chat before it ever reaches us, and it follows the account to another
   * browser); offline there is no server, so the local set is the whole store.
   */
  private togglePlayerIgnore(name: string, ignored: boolean): void {
    if (this.sim.socialInfo !== null) {
      ignored ? this.sim.ignoreRemove(name) : this.sim.ignoreAdd(name);
      return;
    }
    const key = ignoreKey(name);
    if (!key) return;
    if (this.localIgnoredNames.has(key)) {
      this.localIgnoredNames.delete(key);
      this.log(t('hud.system.noLongerIgnoring', { name }), '#aaf');
    } else {
      this.localIgnoredNames.add(key);
      this.log(t('hud.system.ignoringChat', { name }), '#aaf');
    }
    this.saveLocalIgnoredNames();
  }

  /** Blocking is a server-side social action, so it only exists online. */
  private togglePlayerBlock(name: string, blocked: boolean): void {
    if (this.sim.socialInfo === null) return;
    blocked ? this.sim.blockRemove(name) : this.sim.blockAdd(name);
  }

  closeContextMenu(): void {
    $('#ctx-menu').style.display = 'none';
    this.ctxMenuOpener = null;
  }

  // -------------------------------------------------------------------------
  // Social panel: friends / guild / ignore / raid (online play).
  //
  // The window is a pure core (social_view.ts) + painter (social_window.ts). Hud
  // stays the coordinator: it owns the open/close keybind, the slow-HUD cadence
  // refresh (update -> socialWindow.refreshIfChanged), the chat-context raid-tab
  // jump (selectRaidTab), and the window-manager close, delegating each to the
  // painter. The painter owns the tab/notice/typeahead state + the listener
  // delegation that keeps a cadence repaint from churning per-row handlers.
  // -------------------------------------------------------------------------

  toggleSocial(): void {
    this.socialWindow.toggle();
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
    declineLabel: string = t('hud.prompts.decline'),
    // Fired only when the prompt auto-dismisses after the wall-clock timeout.
    // Defaults to onDecline so existing callers stay byte-identical; callers that
    // want an ignored prompt to mean "no response" (ready check) pass a no-op and
    // let their own server-side timeout own the outcome.
    onTimeout: () => void = onDecline,
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
    decline.textContent = declineLabel;
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
        onTimeout();
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
        const itemId = (row as HTMLElement).dataset.item ?? '';
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

  // Wired by main.ts to toggleDiscordPanel, giving the desktop micro-menu
  // (#mm-discord) a discoverable path to the same panel the 'U' keybind opens.
  attachDiscordHook(toggle: () => void): void {
    this.discordHook = toggle;
  }

  get optionsOpen(): boolean {
    return this.optionsWindow.isOpen;
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

  // True while an aria-modal quantity/confirm prompt (the bank/bags
  // installPromptDialog family) owns the keyboard. Game keybinds must not fire
  // then: the Enter that confirms a prompt re-focuses a button synchronously, so
  // the same keydown would bubble to the window handler and open chat, stealing
  // the WCAG 2.4.3 focus return. Deliberately NOT part of isModalOpen(): these
  // prompts do not pause movement (the confirm-dialog family precedent), and the
  // party/trade/duel prompts (no aria-modal) stay non-blocking. Called from
  // keydown paths only, never per frame.
  promptModalOpen(): boolean {
    return $('#prompt-stack').querySelector('.prompt[aria-modal="true"]') !== null;
  }

  // True when any interactive HUD surface is open: a modal OR a managed window
  // (bags, vendor, character, etc.). Drives the gamepad's virtual-cursor mode so a
  // controller can point at bag slots / vendor items, not just modal dialogs.
  isWindowOpen(): boolean {
    return this.isModalOpen() || this.topmostOpenWindow() !== null;
  }

  toggleOptionsMenu(): void {
    this.optionsWindow.toggle();
  }

  closeOptions(): void {
    this.optionsWindow.close();
  }

  /** Called by main.ts when a drag settles on the live overlay: forward the
   *  dropped normalized position to the options window's open performance panel. */
  onPerfOverlayMoved(x: number, y: number): void {
    this.optionsWindow.onPerfOverlayMoved(x, y);
  }

  /** Called by main.ts when a pad connects/disconnects: re-label the Controller
   *  panel with the newly detected brand's glyphs if that panel is open. */
  refreshControllerLabels(): void {
    this.optionsWindow.refreshControllerLabels();
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
    if ($('#delve-rite-panel').style.display === 'block') {
      this.closeRitePanel();
      return true;
    }
    const top = this.topmostOpenWindow();
    if (!top) return false;
    this.closeManagedWindow(top);
    return true;
  }
}

function describeAbilitySummary(
  known: ResolvedAbility,
  resourceType: ResourceType | null,
  spellHaste = 0,
): string {
  const parts: string[] = [];
  if (known.cost > 0) {
    parts.push(
      t('abilityUi.tooltip.cost', {
        cost: formatAbilityNumber(known.cost),
        resource: resourceDisplayName(resourceType),
      }),
    );
  }
  parts.push(abilityCastLine(known, spellHaste));
  // Resolved cooldown (after talent cooldown modifiers), not the base def cooldown.
  if (known.cooldown > 0) {
    parts.push(
      t('abilityUi.tooltip.cooldownSeconds', { seconds: formatAbilityNumber(known.cooldown) }),
    );
  }
  return parts.join(' · ');
}

function abilityDisplayName(def: AbilityDef): string {
  return tEntity({ kind: 'ability', id: def.id, field: 'name' });
}

// Fills every description placeholder from the RESOLVED ability: {damage} ($d)
// the primary hit, {overTime} ($o) a hybrid's dot/hot total, {buff} ($b) the
// first buff's value, {duration} ($t) the first timed effect's duration. All are
// rank- and talent-resolved, so the prose can never drift from what a cast does.
function abilityDisplayDescription(
  res: ResolvedAbility,
  damageText: string,
  scaling?: AbilityScaling,
): string {
  const buff = abilityBuffValue(res);
  const duration = abilityDurationValue(res);
  return tEntity({
    kind: 'ability',
    id: res.def.id,
    field: 'description',
    values: {
      damage: damageText,
      overTime: abilityOverTimeText(res, scaling),
      buff: buff === null ? '' : formatAbilityNumber(buff),
      duration: duration === null ? '' : formatAbilityNumber(duration),
    },
  });
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

function zoneWelcome(zoneId: string): string {
  return tEntity({ kind: 'zone', id: zoneId, field: 'welcome' });
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

function itemSlotName(slot: ItemSlot): string {
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

// The live caster's TOTAL spell-haste fraction: the resolved stat (set bonuses + spec
// mastery) PLUS active buff_spellhaste auras (Arcane Power, Icy Veins, Metamorphosis).
// Mirrors the sim's spellHasteMult (spell_combat.ts) EXACTLY, including its
// `Math.max(0, ...)` floor, so a shown cast time never disagrees with the real one (a
// net-negative haste, e.g. a cast-slow debuff, floors at 0 for both). ui/ cannot import
// the sim-combat helper across the seam, so the formula is kept identical here by hand.
function playerSpellHasteFrac(p: Entity | null | undefined): number {
  if (!p) return 0;
  let frac = p.spellHaste;
  for (const a of p.auras) if (a.kind === 'buff_spellhaste') frac += a.value;
  return Math.max(0, frac);
}

// `spellHaste` (the live character's total spell haste, a fraction) shortens the shown
// cast / channel time exactly as the sim does, so a hasted caster's tooltips reflect the
// real, faster cast.
function abilityCastLine(known: ResolvedAbility, spellHaste = 0): string {
  const h = 1 + Math.max(0, spellHaste);
  if (known.def.channel) {
    return t('abilityUi.tooltip.channeledSeconds', {
      seconds: formatAbilityNumber(known.def.channel.duration / h),
    });
  }
  if (known.castTime > 0) {
    return t('abilityUi.tooltip.castSeconds', { seconds: formatAbilityNumber(known.castTime / h) });
  }
  return t('abilityUi.tooltip.instant');
}

export function abilityRequirementLines(def: AbilityDef): string[] {
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
  else if (isSelfOnlyAbility(def)) lines.push(t('abilityUi.tooltip.selfOnly'));
  return lines;
}

// Builds the `$d` damage string for an ability tooltip. When `scaling` (the live
// character's Spell Power / Ranged AP / Attack Power) is given, the BASE damage is
// shown with the scaling contribution called out as a "(+N)" suffix, e.g.
// "66 to 74 (+29)", so a caster sees both the base and exactly what their Spell
// Power adds, and watches it climb as gear changes.
function abilityEffectText(res: ResolvedAbility, scaling?: AbilityScaling): string {
  // " (+N)" callout for the scaling contribution (Spell Power / Attack Power),
  // omitted when there is none. Punctuation + formatted number only (no words).
  const suffix = (eff: AbilityEffect) => {
    const b = scaling ? abilityDamageBonus(res, eff, scaling) : 0;
    return b > 0
      ? ` ${t('hudChrome.abilityScaling.bonus', { value: formatAbilityNumber(b) })}`
      : '';
  };
  // The pickers live in ability_damage.ts so the consistency guard test shares
  // them; this function only formats the picked effect.
  const primary = abilityPrimaryEffect(res);
  if (primary) {
    switch (primary.type) {
      case 'directDamage':
      case 'heal':
      case 'aoeDamage':
      case 'aoeHeal':
      case 'aoeRoot':
      case 'groundAoE':
      case 'drainTick':
        return abilityAmountRange(primary.min, primary.max) + suffix(primary);
      case 'consumeAura':
        if (primary.deal) {
          return abilityAmountRange(primary.deal.min, primary.deal.max) + suffix(primary);
        }
        if (primary.heal) {
          return abilityAmountRange(primary.heal.min, primary.heal.max) + suffix(primary);
        }
        return '';
      case 'weaponDamage':
      case 'weaponStrike':
        return formatAbilityNumber(primary.bonus);
      case 'sunder':
        return formatAbilityNumber(
          SUNDER_ARMOR_PCT_PER_STACK * (primary.full ? primary.maxStacks : 1) * 100,
        );
      case 'faerieFire':
        return formatAbilityNumber(FAERIE_FIRE_ARMOR_PCT * 100);
      case 'lifeTap':
        return formatAbilityNumber(primary.hp);
      case 'finisherDamage':
        return (
          t('abilityUi.tooltip.finisherDamage', {
            base: formatAbilityNumber(primary.base),
            perCombo: formatAbilityNumber(primary.perCombo),
          }) + suffix(primary)
        );
    }
  }

  const secondary = abilitySecondaryEffect(res);
  if (!secondary) return '';
  switch (secondary.type) {
    case 'dot':
      return formatAbilityNumber(secondary.total) + suffix(secondary);
    case 'hot':
      return formatAbilityNumber(secondary.total) + suffix(secondary);
    case 'absorb':
      return formatAbilityNumber(secondary.amount);
    case 'imbue':
      return formatAbilityNumber(secondary.bonus);
    default:
      return '';
  }
}

// Builds the `$o` over-time string (a hybrid's dot/hot TOTAL) the same way
// abilityEffectText builds `$d`, including the "(+N)" scaling callout (which the
// bonus helper zeroes for hybrid riders, matching combat's no-double-dip rule).
function abilityOverTimeText(res: ResolvedAbility, scaling?: AbilityScaling): string {
  const eff = abilityOverTimeEffect(res);
  if (!eff) return '';
  const b = scaling ? abilityDamageBonus(res, eff, scaling) : 0;
  const bonus =
    b > 0 ? ` ${t('hudChrome.abilityScaling.bonus', { value: formatAbilityNumber(b) })}` : '';
  return formatAbilityNumber(eff.total) + bonus;
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

// A 2D canvas context is non-null for any attached canvas in this app; centralize
// the assertion so the call sites do not each carry a non-null bang. Throws (a
// dev-surfaced failure, never reached in practice) rather than asserting.
function require2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return ctx;
}

function raidMarkerDisplayName(index: number): string {
  return t(RAID_MARKER_LABEL_KEYS[index] ?? RAID_MARKER_LABEL_KEYS[0]);
}
