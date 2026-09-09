// Pure, host-agnostic core for the "Unlock interface" option: the declarative
// table of which HUD frames the toggle governs, and the two decisions the
// coordinator makes on every flip (which label the option row shows, and which
// frames are eligible right now).
//
// DOM-free and game-free: a frame is named by its element id and its storage
// key, both plain strings the DOM adapter (interface_unlock.ts) resolves. Kept
// declarative so adding a frame is a row here plus its `isActive` probe at the
// wiring site, never a new branch in the coordinator. Registered in
// tests/architecture.test.ts UI_PURE_CORES.

import { isPetClass, type PlayerClass } from '../sim/types';
// The descriptor MODULE, not the domain barrel: the barrel re-exports the
// painter and the host, and a pure core must not reach a DOM-owning painter
// even one hop removed (tests/architecture.test.ts forbiddenUiCoreImport).
import {
  AURA_TRACK_FRAME_PREFIX,
  AURA_TRACKS,
  type AuraTrackSettingKey,
  auraTrackForFrameId,
} from './hud/aura_tracks/aura_track_descriptors';
import type { TranslationKey } from './i18n.catalog';

/** One movable HUD frame under the global unlock toggle. */
export interface HudFrameSpec {
  /** Stable identifier used by the coordinator's registry and by tests. */
  id: string;
  /** The element id in index.html the adapter looks up. */
  elementId: string;
  /** localStorage key its chosen position + size persist under. */
  storageKey: string;
  /** Name chip shown on the frame while unlocked, so a dimmed placeholder is
   *  never an anonymous floating box. Reuses an existing key where one already
   *  names the frame (the unit-frame aria labels, the target-aura tab names). */
  labelKey: TranslationKey;
  /** Nominal size used to clamp a saved spot while the frame is hidden. */
  fallbackSize: { w: number; h: number };
  /**
   * True when the frame lives inside a TRANSFORMED ancestor (#bottom-bar carries
   * a centering transform), which hijacks absolute positioning by becoming the
   * containing block. Those frames are re-homed onto #ui while positioned, the
   * same move the player frame already makes; the rest are already #ui children.
   */
  detachToUiRoot: boolean;
  /**
   * What a SIDE-edge drag does, defaulting to 'scale' (zoom the whole frame).
   * Only a frame whose contents genuinely REFLOW sets 'box' (a real layout
   * width/height): the wrapping aura rows. Everything else here is fixed
   * content (46px action slots, a minimap canvas, a portrait), where stretching
   * one axis only ever grew empty space, which is why those side resizes read
   * as broken. See MovableFrameConfig.resizeMode.
   */
  resizeMode?: 'scale' | 'box';
  /** This frame's own zoom ceiling, replacing the shared FRAME_SCALE_MAX
   *  (see MovableFrameConfig.maxScale); Infinity means no upper limit. */
  maxScale?: number;
  /**
   * The stock slot a detaching frame returns to, RESOLVED at release time rather
   * than remembered from detach time. Only a frame whose stock parent holds
   * another detaching frame needs it: a remembered `nextSibling` can itself have
   * left the parent by the time the frame comes back (both aura rows detached,
   * then reset in registration order), and a parent remembered while the frame
   * was somewhere else entirely (the buff row on #ui when the auras-on-frame
   * option captured it) is not a stock slot at all. 'first' inserts before the
   * parent's current first child; 'last' appends.
   */
  stockHome?: { parentId: string; slot: 'first' | 'last' };
}

/**
 * Every frame the "Unlock interface" option moves and scales, in the order the
 * coordinator registers them. The three unit frames that predate this option
 * (player, target, party) keep their own corner buttons and are joined to the
 * same toggle at the wiring site, so they are deliberately NOT rows here: their
 * storage keys and labels already live in frame_pos_reset.ts.
 */
export const HUD_FRAME_SPECS: readonly HudFrameSpec[] = [
  {
    id: 'actionBar1',
    elementId: 'actionbar',
    storageKey: 'woc_hud_frame_actionbar',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.actionBar1',
    fallbackSize: { w: 612, h: 46 },
    detachToUiRoot: true,
  },
  {
    id: 'actionBar2',
    elementId: 'actionbar2',
    storageKey: 'woc_hud_frame_actionbar2',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.actionBar2',
    fallbackSize: { w: 612, h: 46 },
    detachToUiRoot: true,
  },
  {
    id: 'actionBar3',
    elementId: 'actionbar3',
    storageKey: 'woc_hud_frame_actionbar3',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.actionBar3',
    fallbackSize: { w: 612, h: 46 },
    detachToUiRoot: true,
  },
  // The whole action-bar block as ONE frame, live only while the "Combine
  // Action Bars" option is on; the three rows above go inactive in that mode so
  // exactly one of the two shapes is ever movable.
  {
    id: 'actionBarGroup',
    elementId: 'actionbar-group',
    storageKey: 'woc_hud_frame_actionbar_group',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.actionBarGroup',
    fallbackSize: { w: 612, h: 150 },
    detachToUiRoot: true,
  },
  {
    id: 'castBar',
    elementId: 'castbar',
    storageKey: 'woc_hud_frame_castbar',
    labelKey: 'hudChrome.castBar.playerAria',
    fallbackSize: { w: 300, h: 24 },
    detachToUiRoot: false,
  },
  // The auto-attack swing timer. Hidden except while auto-attacking a live
  // target, so editing shows it as a dimmed placeholder like the cast bar.
  {
    id: 'swingBar',
    elementId: 'swingbar',
    storageKey: 'woc_hud_frame_swingbar',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.swingBar',
    fallbackSize: { w: 220, h: 12 },
    detachToUiRoot: false,
  },
  // The Wishlist on Steam reminder chip (#community-hud, PR 3616), movable
  // like any other corner chrome so a player can park it out of the way.
  // Already absolutely positioned in #ui, so no re-home is needed. Its zoom
  // has no ceiling (owner request): a chip meant to be noticed may grow as
  // large as the player likes, and the shared floor keeps it grabbable.
  {
    id: 'steamWishlist',
    elementId: 'community-hud',
    storageKey: 'woc_hud_frame_community',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.steamWishlist',
    fallbackSize: { w: 160, h: 30 },
    detachToUiRoot: false,
    maxScale: Number.POSITIVE_INFINITY,
  },
  {
    id: 'menu',
    elementId: 'side-buttons',
    storageKey: 'woc_hud_frame_side_buttons',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.menu',
    fallbackSize: { w: 200, h: 220 },
    detachToUiRoot: false,
  },
  {
    id: 'minimap',
    elementId: 'minimap-wrap',
    storageKey: 'woc_hud_frame_minimap',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.minimap',
    fallbackSize: { w: 170, h: 240 },
    detachToUiRoot: false,
  },
  {
    id: 'petFrame',
    elementId: 'pet-frame',
    storageKey: 'woc_hud_frame_pet',
    labelKey: 'hudChrome.unitFrame.petLabel',
    fallbackSize: { w: 180, h: 54 },
    detachToUiRoot: true,
  },
  // The pet ACTION bar, the command half of #pet-cluster. Its own row rather
  // than a cluster-wide frame so the two halves place independently (the
  // shipped mobile layout splits them the same way) and the pet frame's saved
  // spots stay valid. renderPetBar wipes only its .petbar-group children, so
  // the mover chrome minted beside them survives every rebuild.
  {
    id: 'petBar',
    elementId: 'petbar',
    storageKey: 'woc_hud_frame_petbar',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.petBar',
    fallbackSize: { w: 300, h: 44 },
    detachToUiRoot: true,
  },
  // The stance-style choice bar (warrior stances, paladin auras) sits inside
  // the transformed #actionbar-stack like the action bars, so it detaches too.
  {
    id: 'stanceBar',
    elementId: 'stancebar',
    storageKey: 'woc_hud_frame_stancebar',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.stanceBar',
    fallbackSize: { w: 180, h: 44 },
    detachToUiRoot: true,
  },
  {
    id: 'xpBar',
    elementId: 'xpbar',
    storageKey: 'woc_hud_frame_xpbar',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.xpBar',
    fallbackSize: { w: 612, h: 12 },
    detachToUiRoot: true,
  },
  // The buff and debuff rows are independent frames (each placed on its own).
  // Both genuinely REFLOW (the icons re-wrap as the width changes), so their
  // side edges resize the real box rather than zooming, which keeps each
  // outline an honest picture of the area its auras will occupy. Both detach:
  // their stock parent is the #aura-stack flex column (the clearance between the
  // rows comes from flow, hud.css), so a saved position must lift a row onto #ui
  // for its left/top to resolve against the viewport. Both declare their stock
  // slot in the column (buff row first, debuff row last): the buff row's
  // remembered sibling is the debuff row, which can be detached too, and the
  // Buffs on the Player Frame option moves the buff row onto the player frame
  // at runtime (hud.ts applyAuraAnchor), which restores it through
  // restoreFrameHome; the debuff row declares its slot so the pair stays
  // symmetric and neither depends on the other being home first.
  {
    id: 'buffBar',
    elementId: 'buff-bar',
    storageKey: 'woc_hud_frame_buffbar',
    labelKey: 'hudChrome.targetAuras.buffs',
    fallbackSize: { w: 320, h: 32 },
    detachToUiRoot: true,
    resizeMode: 'box',
    stockHome: { parentId: 'aura-stack', slot: 'first' },
  },
  {
    id: 'debuffBar',
    elementId: 'debuff-bar',
    storageKey: 'woc_hud_frame_debuffbar',
    labelKey: 'hudChrome.targetAuras.debuffs',
    fallbackSize: { w: 320, h: 32 },
    detachToUiRoot: true,
    resizeMode: 'box',
    stockHome: { parentId: 'aura-stack', slot: 'last' },
  },
  // The Target dots tracker. It genuinely REFLOWS (a wider frame is a longer
  // timer bar and more room for the "<aura> on <target>" label before it
  // ellipses), so its side edges resize the real box. Already a #ui child, so it
  // does not detach. Hidden whenever the player has no dots out, which is why
  // the unlock mode's placeholder chip matters here.
  {
    id: 'targetDots',
    elementId: 'target-dots',
    storageKey: 'woc_hud_frame_target_dots',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.targetDots',
    fallbackSize: { w: 232, h: 150 },
    detachToUiRoot: false,
    resizeMode: 'box',
  },
  // The quest and Reliquary trackers live inside the positioned
  // #right-tracker-stack flex column, whose box would become the containing
  // block for their saved left/top, so both re-home onto #ui while positioned
  // (the stack keeps seating the trackers that stay docked). The Reliquary
  // row's show/hide checkbox drives the existing showReliquaryTracker setting
  // through a rowOverride at the wiring site, the optional action bars' shape.
  {
    id: 'questTracker',
    elementId: 'quest-tracker',
    storageKey: 'woc_hud_frame_quest_tracker',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.questTracker',
    fallbackSize: { w: 240, h: 160 },
    detachToUiRoot: true,
  },
  {
    id: 'reliquaryTracker',
    elementId: 'reliquary-tracker',
    storageKey: 'woc_hud_frame_reliquary_tracker',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.reliquaryTracker',
    fallbackSize: { w: 240, h: 120 },
    detachToUiRoot: true,
  },
  // The class resource bars, previously movable outside this option (the
  // devotion medallion's grab-drag, the doom meter's own corner button), now
  // ordinary governed frames so they hide and resize like everything else.
  // The devotion medallion is position:fixed on #ui already; its centering
  // translate is dropped by the stylesheet while a custom position applies.
  {
    id: 'paladinDevotion',
    elementId: 'paladin-devotion-frame',
    storageKey: 'woc_hud_frame_paladin_devotion',
    labelKey: 'hudChrome.paladin.devotion',
    fallbackSize: { w: 96, h: 96 },
    detachToUiRoot: false,
  },
  // The doom meter docks beside the player frame inside the transformed
  // #actionbar-stack, so it detaches like the action bars. Its storage key is
  // the one its pre-registry MovableFrame persisted under, so every saved
  // spot survives the move into this table. The chip reuses the resource's
  // own in-game name (Condemnation, hudChrome.warlock.doomLabel): mechanic
  // frames name themselves the way the game names the mechanic.
  {
    id: 'doomMeter',
    elementId: 'warlock-doom-frame',
    storageKey: 'woc_warlock_doom_frame_pos',
    labelKey: 'hudChrome.warlock.doomLabel',
    fallbackSize: { w: 300, h: 48 },
    detachToUiRoot: true,
  },
  // The spell-proc overlay (the mage birds, the warlock soul bank and Ruin
  // ritual), previously movable only through its own always-on grab-drag. It
  // is minted straight onto #ui and position:fixed with a centering translate
  // the stylesheet drops while a custom position applies, the devotion
  // medallion's shape exactly.
  {
    id: 'procOverlay',
    elementId: 'proc-overlay',
    storageKey: 'woc_hud_frame_proc_overlay',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.procOverlay',
    fallbackSize: { w: 300, h: 232 },
    detachToUiRoot: false,
  },
  // The tabbed combat meter (#meters-window). Its two pop-out windows (heal,
  // threat) keep their own MeterFrame drag: they are transient windows, not
  // standing HUD chrome. Box resize: the row list genuinely reflows and the
  // detached column scrolls inside the chosen height.
  {
    id: 'damageMeter',
    elementId: 'meters-window',
    storageKey: 'woc_hud_frame_meters',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.damageMeter',
    fallbackSize: { w: 240, h: 220 },
    detachToUiRoot: true,
    resizeMode: 'box',
  },
  // The remaining right-stack trackers (the deed watch list, the delve run
  // tracker, the rift floor tracker, the gathering goal tracker), re-homed
  // like the quest and Reliquary rows. The delve, rift and gathering goal
  // controllers rebuild their paint target's HTML, so each paints an inner
  // body element (#delve-body / #rift-body / #gathering-goal-body) and the
  // frame chrome lives beside it on the root; the deed painter builds its
  // skeleton once, so its root is safe as-is.
  {
    id: 'deedTracker',
    elementId: 'deed-tracker',
    storageKey: 'woc_hud_frame_deed_tracker',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.deedTracker',
    fallbackSize: { w: 240, h: 120 },
    detachToUiRoot: true,
  },
  {
    id: 'delveTracker',
    elementId: 'delve-tracker',
    storageKey: 'woc_hud_frame_delve_tracker',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.delveTracker',
    fallbackSize: { w: 240, h: 140 },
    detachToUiRoot: true,
  },
  {
    id: 'riftTracker',
    elementId: 'rift-tracker',
    storageKey: 'woc_hud_frame_rift_tracker',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.riftTracker',
    fallbackSize: { w: 240, h: 100 },
    detachToUiRoot: true,
  },
  // The gathering goal tracker (Intentional Gathering PR4). It sits in the
  // same #right-tracker-stack column as the three rows above and repaints on
  // its own signature gate (gathering_goal_controller.ts); reuses the
  // existing, previously-unwired `hudChrome.gatheringGoal.title` key
  // ("Gathering Goal") as the mover chrome's name chip rather than minting a
  // new frameNames.* string, since that key already names exactly this panel.
  {
    id: 'gatheringGoalTracker',
    elementId: 'gathering-goal-tracker',
    storageKey: 'woc_hud_frame_gathering_goal_tracker',
    labelKey: 'hudChrome.gatheringGoal.title',
    fallbackSize: { w: 240, h: 140 },
    detachToUiRoot: true,
  },
  // The off-hand swing timer, the main-hand row's dual-wield sibling: same
  // placeholder posture as the cast and swing bars (hidden outside combat,
  // force-shown dimmed while editing).
  {
    id: 'swingBarOffhand',
    elementId: 'swingbar-offhand',
    storageKey: 'woc_hud_frame_swingbar_offhand',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.swingBarOffhand',
    fallbackSize: { w: 220, h: 12 },
    detachToUiRoot: false,
  },
  // The six aura tracks (src/ui/hud/aura_tracks/). Generated from the descriptor
  // table rather than written out six times: the table already names each
  // track's element, storage key and label, and a seventh track should not mean
  // a seventh row here. All REFLOW (a wider frame is a longer bar and more room
  // for a name before it ellipses), so their side edges resize the real box, the
  // same choice the two aura rows above make. Already #ui children, so none
  // detaches. Their menu rows drive the track's own setting (frameRowSettingKey
  // below), the Target dots shape.
  ...AURA_TRACKS.map(
    (track): HudFrameSpec => ({
      id: `${AURA_TRACK_FRAME_PREFIX}${track.id}`,
      elementId: track.elementId,
      storageKey: track.storageKey,
      labelKey: track.labelKey,
      fallbackSize: { w: 236, h: 120 },
      detachToUiRoot: false,
      resizeMode: 'box',
    }),
  ),
] as const;

/** Every storage key the option owns, so a reset can clear the whole set. */
export const HUD_FRAME_STORAGE_KEYS: readonly string[] = HUD_FRAME_SPECS.map((s) => s.storageKey);

/**
 * The class-conditional half of Hud.isHudFrameActive: could this frame EVER
 * appear for a character of `playerClass`? Only a pet class gets the pet
 * frame and bar placeholders; the stance bar mirrors renderStanceBar's own
 * warrior/paladin gate; the class resource bars and the spell-proc overlay
 * belong to the class that shows them. Returns null for a row this table
 * does not decide (the action-bar shapes, the trackers, the meters), which
 * the wiring site resolves from its own live state.
 */
export function classGatedFrameActive(id: string, playerClass: PlayerClass): boolean | null {
  switch (id) {
    case 'petFrame':
    case 'petBar':
      return isPetClass(playerClass);
    case 'stanceBar':
      return playerClass === 'warrior' || playerClass === 'paladin';
    case 'paladinDevotion':
      return playerClass === 'paladin';
    case 'doomMeter':
      return playerClass === 'warlock';
    case 'procOverlay':
      return playerClass === 'mage' || playerClass === 'warlock';
    default:
      return null;
  }
}

/**
 * Frames whose show/hide menu row drives a real SETTING instead of the
 * per-frame hidden flag: the optional action bars toggle their ENABLED
 * setting (the same state the on-bar plus/minus drives, listed in BOTH bar
 * shapes by owner request), and the Reliquary tracker drives its existing
 * master switch, so the frames-menu checkbox and the Interface option stay
 * one state. Returns null for every ordinary row.
 */
export function frameRowSettingKey(
  id: string,
):
  | 'showSecondaryActionBar'
  | 'showThirdActionBar'
  | 'showReliquaryTracker'
  | 'showTargetDots'
  | AuraTrackSettingKey
  | null {
  if (id === 'actionBar2') return 'showSecondaryActionBar';
  if (id === 'actionBar3') return 'showThirdActionBar';
  if (id === 'reliquaryTracker') return 'showReliquaryTracker';
  // The Target dots tracker has its own master switch too (the Interface
  // option the 0.42 release shipped it with), so its menu row drives that
  // switch for the same reason: two checkboxes over one tracker must be one
  // state.
  if (id === 'targetDots') return 'showTargetDots';
  // Each aura track has its own master switch as well (all six ship off), so
  // the same rule holds: the row is generated from the descriptor table and
  // resolves back to it here, which is why a seventh track needs no arm.
  const auraTrack = auraTrackForFrameId(id);
  if (auraTrack) return auraTrack.settingKey;
  return null;
}

/**
 * The name chip a frame row wears, resolved per CHARACTER: mechanic frames
 * name themselves the way the game names the mechanic, so the proc overlay
 * chips the active spec's own meter (Soul Fragments for a demonology warlock,
 * Wrack for destruction, Hot Streak / Aether Surge / Icicles for the mage
 * specs) instead of the generic "Spell Procs", which stays the fallback for a
 * character whose spec never lights it (an affliction warlock's placeholder).
 * Every other row keeps its static labelKey. The keys reuse the mechanics'
 * existing names wherever one exists (the meter aria labels, the ability
 * names), so no second copy of an in-game term is minted.
 */
export function frameRowLabelKey(
  spec: HudFrameSpec,
  playerClass: PlayerClass,
  talentSpec: string | null,
): TranslationKey {
  if (spec.id !== 'procOverlay') return spec.labelKey;
  if (playerClass === 'warlock') {
    if (talentSpec === 'demonology') return 'hudChrome.procOverlay.soulFragmentsMeter';
    if (talentSpec === 'destruction') return 'hudChrome.procOverlay.ruinMeter';
    return spec.labelKey;
  }
  if (playerClass === 'mage') {
    if (talentSpec === 'arcane') return 'entities.abilities.arcane_surge.name';
    if (talentSpec === 'frost') return 'hudChrome.interfaceUnlock.frameNames.procOverlayFrost';
    if (talentSpec === 'fire') return 'entities.abilities.hot_streak.name';
    // An unspecced mage falls through: Hot Streak is a fire talent, so naming
    // the frame after it before any points are spent would name a mechanic
    // they do not have (the same rule as the affliction fallback above); the
    // bird they see in edit mode is only the borrowed unlit preview.
  }
  return spec.labelKey;
}

/** Label the Interface option row shows: it names the ACTION the press performs,
 *  so it reads "Unlock interface" while locked and "Lock interface" once every
 *  frame is loose. */
export function interfaceUnlockLabelKey(unlocked: boolean): TranslationKey {
  return unlocked ? 'hudChrome.interfaceUnlock.lock' : 'hudChrome.interfaceUnlock.unlock';
}

/** A registered frame, reduced to the two things the eligibility rule reads. */
export interface UnlockCandidate {
  id: string;
  /** Whether the frame is live for this character right now: a hunter with no
   *  pet out has no pet frame, and the optional action bars are off by default. */
  isActive(): boolean;
}

/**
 * Which frames a flip to `unlocked` should actually loosen. Unlocking asks each
 * candidate whether it is live, so an absent frame (no pet, a disabled action
 * bar) is never made draggable; LOCKING is unconditional, because a frame that
 * went inactive mid-session (the pet was dismissed while the interface was
 * unlocked) must still be told to lock, or it would keep a live drag gesture
 * armed behind a hidden element.
 */
export function framesToLock(
  candidates: readonly UnlockCandidate[],
  unlocked: boolean,
): { id: string; unlocked: boolean }[] {
  return candidates.map((c) => ({ id: c.id, unlocked: unlocked && c.isActive() }));
}
