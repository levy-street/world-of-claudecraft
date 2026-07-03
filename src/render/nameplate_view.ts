// Pure view model for the overhead nameplates. DOM/Three/i18n-free so it can be unit-tested without a WebGL context or
// a localized catalog: it decides, per entity, whether the nameplate shows at
// all, how high above the rig its anchor sits (the projection INPUT, not the
// Three projection itself), whether this entity must refresh every pass (urgent),
// and the threat/combo state. The NameplatePainter turns that into Three
// projection + DOM writes and localizes the names; this core never touches three,
// a *_painter, or t()/tEntity (RENDER_PURE_CORES, tests/architecture.test.ts),
// the same Three- and i18n-free contract cast_bar.ts already follows.
//
// It delegates the two existing narrow helpers rather than re-implement them:
// comboPipsFor (nameplate_combo) for the local player's combo pips on this entity
// and isMobThreateningViewer (nameplate_threat) for the red threat plate. The
// Three projection helpers (nameplate_projection) stay on the painter side, since
// they import three and this core must not.
//
// Allocation-light: nameplatePlanInto writes into a caller-owned NameplatePlan so
// the painter reuses ONE plan across every entity each frame (no per-entity
// garbage on the hot path), mirroring the speedStreaksInto / cameraSpace out-param
// idiom elsewhere in src/render.

import type { Entity } from '../sim/types';
import { INTERACT_RANGE } from '../sim/types';
import { comboPipsFor } from './nameplate_combo';
import { isMobThreateningViewer } from './nameplate_threat';

// Beyond this many yards an entity's nameplate is hidden entirely (it reads as a
// sub-pixel label long before this). Was a renderer-local const; it is a
// nameplate-visibility concern, so it lives with the view model now.
export const NAMEPLATE_RANGE = 55;
export const NAMEPLATE_RANGE_SQ = NAMEPLATE_RANGE * NAMEPLATE_RANGE;

// Within this many yards (or when targeted / casting) a nameplate refreshes its
// content every render pass, not just on the throttled full pass, so a nearby
// mob's hp/cast bar never lags. Squared once at module load.
export const NAMEPLATE_URGENT_RANGE = 14;
const NAMEPLATE_URGENT_RANGE_SQ = NAMEPLATE_URGENT_RANGE * NAMEPLATE_URGENT_RANGE;

// Vertical lift (world units) of the nameplate anchor above the rig top before
// projection: the normal label sits a touch higher than the self overhead-emote
// bubble, which hugs the head.
export const NAMEPLATE_ANCHOR_LIFT = 0.8;
export const NAMEPLATE_SELF_EMOTE_ANCHOR_LIFT = 0.2;

// The crypt's sealed royal door carries no floating label (it reads as back wall,
// not a portal billboard).
const UNLABELED_DOOR_DUNGEON_ID = 'nythraxis_boss_arena';

/** Per-entity nameplate decisions the painter consumes. Mutated in place by
 *  nameplatePlanInto so the painter can reuse one instance across all entities. */
export interface NameplatePlan {
  /** the nameplate is not drawn this frame (off, too far, dead, etc.) */
  hidden: boolean;
  /** world-space lift added to the rig anchor before the painter projects it */
  anchorYOffset: number;
  /** refresh content every pass (targeted, very close, or casting), bypassing the
   *  throttled full-pass gate */
  urgent: boolean;
  /** a live player with an overhead party/raid emote (drives the has-emote class
   *  and the lower anchor lift) */
  hasOverheadEmote: boolean;
  /** tint the hp bar red: a hostile mob actively aggroed on the viewer */
  threat: boolean;
  /** combo pips the viewer has built on this entity (0 = hide the row) */
  comboPips: number;
}

/** A zeroed plan for the painter to own and reuse. */
export function newNameplatePlan(): NameplatePlan {
  return {
    hidden: true,
    anchorYOffset: 0,
    urgent: false,
    hasOverheadEmote: false,
    threat: false,
    comboPips: 0,
  };
}

/**
 * Compute the nameplate plan for `e` as seen by `player`, writing into `out` and
 * returning it. `viewHeight` is the rig's unscaled height (EntityView.height);
 * `showNameplates` is the player's mob-nameplate toggle. `showOwnNameplate` is the
 * player's own-plate toggle (the setting defaults off): when on, the self plate is
 * no longer suppressed and it anchors at the normal lift like any other
 * player's. Pure: same inputs give the same plan, no DOM/Three/i18n, no
 * Math.random/Date.now/performance.now.
 */
export function nameplatePlanInto(
  out: NameplatePlan,
  e: Entity,
  player: Entity,
  viewHeight: number,
  showNameplates: boolean,
  showOwnNameplate: boolean,
): NameplatePlan {
  const dx = e.pos.x - player.pos.x;
  const dz = e.pos.z - player.pos.z;
  const d2 = dx * dx + dz * dz;
  const isSelf = e.id === player.id;
  const hasOverheadEmote = !!(e.kind === 'player' && e.overheadEmoteId && !e.dead);
  const isDoor = e.templateId === 'dungeon_door' || e.templateId === 'dungeon_exit';
  const isDelveInteract =
    e.templateId === 'delve_locked_chest' ||
    e.templateId === 'delve_reward_chest' ||
    e.templateId === 'delve_surface_exit' ||
    e.templateId === 'delve_drowned_reliquary' ||
    e.templateId === 'delve_drowned_reliquary_open' ||
    e.templateId?.startsWith('delve_rite_shrine_') ||
    // Marsh room puzzle interactables (and their spent variants): the plates
    // carry the localized delveUi.object.* labels so the puzzles read at a
    // glance, matching the rite shrines above.
    e.templateId === 'delve_sluice_valve' ||
    e.templateId === 'delve_sluice_valve_open' ||
    e.templateId === 'delve_grave_tablet' ||
    e.templateId === 'delve_grave_tablet_lit' ||
    e.templateId === 'delve_corpse_candle' ||
    e.templateId === 'delve_corpse_candle_lit' ||
    e.templateId === 'delve_bell_rope' ||
    e.templateId === 'delve_bell_rope_pulled';
  const delveInteractNear = isDelveInteract && d2 <= (INTERACT_RANGE + 1) * (INTERACT_RANGE + 1);

  out.hidden =
    (isSelf && !hasOverheadEmote && !showOwnNameplate) ||
    d2 > NAMEPLATE_RANGE_SQ ||
    (e.dead && !e.lootable && e.kind === 'mob') ||
    (e.kind === 'object' && !isDoor && !delveInteractNear) ||
    (isDoor && e.dungeonId === UNLABELED_DOOR_DUNGEON_ID) ||
    (!showNameplates && e.kind === 'mob' && !e.dead);
  out.anchorYOffset =
    viewHeight * e.scale +
    (isSelf && hasOverheadEmote && !showOwnNameplate
      ? NAMEPLATE_SELF_EMOTE_ANCHOR_LIFT
      : NAMEPLATE_ANCHOR_LIFT);
  out.urgent =
    e.id === player.targetId || d2 < NAMEPLATE_URGENT_RANGE_SQ || e.castingAbility !== null;
  out.hasOverheadEmote = hasOverheadEmote;
  out.threat = isMobThreateningViewer(e, player.id);
  out.comboPips = comboPipsFor(player, e);
  return out;
}
