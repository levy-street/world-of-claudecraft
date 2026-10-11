// Character visual system — rigged glTF replacements for the old procedural
// rigs. Asset fetches start at module import (see assets.ts) and register
// with the preload gate, so createCharacterVisual is synchronous by the time
// the Renderer constructs views.
import { type Entity, isMechWearer, type PlayerClass } from '../../sim/types';
import { renderLayerDisabled } from '../render_dev_flags';
import { logAssetMissOnce } from './asset_miss_log';
import { type AssembleOptions, modularHeadFor } from './assets';
import { type CharacterFormKey, characterFormAssetKey } from './form_visual_selection_core';
import { composedLookPiecesFor, type LookPieceQueue, type LookPieces } from './look_pieces';
import {
  mechHeldWeaponOverride,
  modularVisualKey,
  npcHeldProps,
  VISUALS,
  type VisualDef,
  visualKeyFor,
} from './manifest';
import { MODULAR_WARRIOR_KEY, type ModularLook, wocBodyScaleOf } from './modular';
import { npcLookFor } from './npc_looks';
import { CharacterVisual } from './visual';
import { ensureWocHeadForAppearance } from './woc_head_packs';

export {
  type AnimOverrideFacts,
  applyDisplayedAnimMotion,
  applyEntityAnimOverrides,
} from './anim_state_entity_core';
export type { AssembleOptions } from './assets';
export { type LookPiecesStats, lookPiecesStats } from './look_pieces';
export { npcLookFor } from './npc_looks';
export { CharacterPreview } from './preview';
export {
  type AppearancePreviewRow,
  type PreviewAppearance,
  previewAppearanceForRow,
} from './preview_appearance';
export type { PreviewFramingName } from './preview_framing';
export type { AnimState, FarBakeGate } from './visual';
export { CharacterVisual, setWeaponVfxViewportHeight } from './visual';

// A composed (modular) body is opt-in per entity: the app installs a provider
// that maps a PLAYER to its authored look, and anything it does not claim
// keeps the fixed class rig it has always used. Every class is a WOC body now
// (woc_parts_core.ts classBodyComposes), so the provider answers null for each
// of them and nothing in the shipped world composes; the seam stays for a
// class that ever does. The look itself still rides the `app` identity wire
// field (set at join from the character's own column), which is what a WOC
// body's modular head reads. The RULE for what an entity wears is app-level
// (see src/render/characters/player_look_core.ts), while this module only
// needs the answer. An NPC never composes either: its authored look rides the
// WOC def of its class (npc_looks.ts, the factory below).
let modularLookProvider: ((e: Entity) => ModularLook | null) | null = null;

/** Install (or clear, with null) the entity-to-look mapping. */
export function setModularLookProvider(fn: ((e: Entity) => ModularLook | null) | null): void {
  modularLookProvider = fn;
}

/** The look an entity composes with, or null if it keeps its fixed class rig.
 *  The same answer the visual factory uses, exposed so the UI can draw a
 *  PORTRAIT of the composed character instead of a generic class one. */
export function modularLookFor(e: Entity): ModularLook | null {
  return modularLookProvider?.(e) ?? null;
}

/** The composed-body visual key for a player the look provider claimed: the
 *  class's own modular def (its clips, ability mapping and hand layout), with
 *  the warrior's as the fallback for a templateId without one. Only a player
 *  composes: an NPC wears its authored look on a WOC body (npc_looks.ts). */
export function modularKeyFor(e: Entity): string {
  const key = modularVisualKey(e.templateId as PlayerClass);
  return VISUALS[key] ? key : MODULAR_WARRIOR_KEY;
}

/** The composed body an entity's BASE visual will build from, resolved the
 *  same way createCharacterVisual resolves it (a mech wearer never composes;
 *  forms are separate lazy slots over this base), or null when the entity
 *  keeps a fixed rig. */
function composedLookOf(e: Entity): { def: VisualDef; look: ModularLook } | null {
  if (isMechWearer(e)) return null;
  const look = modularLookProvider?.(e) ?? null;
  if (!look) return null;
  return { def: VISUALS[modularKeyFor(e)], look };
}

/** The pieces of an entity's composed look on the queue (look_pieces.ts):
 *  null for an entity that keeps a fixed rig, otherwise its readiness with the
 *  missing pieces enqueued, the head resolved from the cached part set. */
export function composedLookPiecesOf(
  e: Entity,
  queue: LookPieceQueue,
  priority: number,
): LookPieces | null {
  const composed = composedLookOf(e);
  if (!composed) return null;
  const { def, look } = composed;
  return composedLookPiecesFor(def, look, modularHeadFor(def, look), queue, priority);
}

/** Build a rideable mount's visual: no skin, no held weapon, authored colours
 *  (mount defs carry no tint). The caller gates on mountAssetsReady() first:
 *  mount GLBs are lazyPreload and resolvedGltf throws when not yet fetched. */
export function createMountVisual(visualKey: string): CharacterVisual {
  return new CharacterVisual(visualKey, 0xffffff, 0, null, null);
}

/** Build the visual for an entity (or an explicit shapeshift/polymorph form key).
 *  Returns null when the visual's assets are unavailable (a missed preload, a
 *  lazy fetch that has not landed): callers skip that entity's view for the
 *  frame and the entity stays a future candidate. A synchronous throw here
 *  would stall the per-frame render path forever (issue #2079, the v0.27.0
 *  training dummy freeze). `localPlayer`: the entity is the local player, whose
 *  own WOC armor draws at full detail; every other character the world builds
 *  here (a speculative or prewarm build included) draws the crowd's
 *  (woc_armor_core.ts wocArmorTierFor: cosmetic sharpness only). */
export function createCharacterVisual(
  e: Entity,
  formKey?: CharacterFormKey,
  opts?: AssembleOptions,
  localPlayer = false,
): CharacterVisual | null {
  // Forms are their own models. Skins and held weapons
  // only apply to the base body
  // Shapeshift forms are their own model and never compose, and neither does a
  // Combat Mech wearer: the mech is a whole replacement body, so the cosmetic
  // must win over the authored look (composing over it hid a purchased skin).
  const look = formKey || isMechWearer(e) ? null : (modularLookProvider?.(e) ?? null);
  const key = formKey
    ? characterFormAssetKey(formKey, e.auras)
    : look
      ? modularKeyFor(e)
      : visualKeyFor(e);
  // The class-agnostic Combat Mech adopts the wearer's independent mainhand and
  // offhand layout. e.templateId is the player's class on every host, so this
  // matches offline and online.
  // An NPC, or a quest escortee the sim makes a mob (npc_looks.ts MOB_LOOK_IDS), wears
  // an authored look on its class's WOC body (visualKeyFor names the def): its fixed
  // props take the place of the class's own hands.
  const npcLook = formKey ? null : npcLookFor(e.templateId, e.kind);
  const weaponOverride = npcLook
    ? npcHeldProps(npcLook.props)
    : !formKey && key === 'player_mech' && e.kind === 'player'
      ? mechHeldWeaponOverride(e.templateId as PlayerClass)
      : null;
  // A WOC body's own head files (its type's core, hairstyle and facial hair: a player's
  // look, an authored one on an NPC or escortee, the type's default on any other mob)
  // are asked for beside its base, and the body NEVER waits for a hairstyle or a beard:
  // a player with no body at all is the worse sight. It
  // is built as soon as its head CORE is resident, with whatever pieces of its look are
  // resident too (AssembleOptions.wocHead), and draws at once, the bare head standing in
  // for a hairstyle or a beard still on the wire (or one whose fetch failed), which joins
  // hidden until linked (woc_head_stream_core.ts). The core itself is resident from world
  // entry, with the base and the animation library (woc_entry_preload.ts awaits all three
  // for both fits before the Renderer exists), so NOTHING is waited for here: no file of a
  // WOC body makes this return null quietly. A base or library that is missing anyway is a
  // miss like any other body's and takes the logged fail-soft path below, with the
  // caller's retry cooldown; a core that is missing anyway (a host that built a world
  // without the entry gate) leaves the body drawing without a head until it lands.
  const wocFit = formKey ? undefined : VISUALS[key]?.wocCharacter?.fit;
  const wocHeadApp = e.kind === 'player' ? e.modularAppearance : (npcLook?.app ?? null);
  if (wocFit && opts?.fetchStreamed !== false) ensureWocHeadForAppearance(wocFit, wocHeadApp);
  try {
    // The world path, and the only one with a point-light budget: its weapon
    // light is born hidden and the budget decides when it shines. A rig built
    // directly (previews) keeps a light that lights immediately. It is also the
    // one path that opts a WOC body's armor down to the crowd's detail: anyone
    // but the local player (a body built directly keeps full detail). A WOC body
    // is born with the head pieces of its own look hung (never the library's).
    // A player's weapon slot follows what is equipped, so an empty slot is an empty
    // hand; a mob drawn on a class body equips nothing and keeps the class weapon it
    // is drawn with (the Nythraxis court's visions).
    const born: AssembleOptions = {
      ...opts,
      wocHead: wocHeadApp ?? null,
      bareWhenUnarmed: e.kind === 'player',
    };
    const visual = new CharacterVisual(
      key,
      e.color,
      formKey ? 0 : (e.skin ?? 0),
      formKey ? null : e.mainhandItemId,
      weaponOverride,
      formKey ? null : e.offhandItemId,
      look,
      localPlayer ? born : { ...born, wocArmorDetail: 'crowd' },
    );
    visual.budgetedWeaponLight = true;
    // ...and the only one that draws crowds: a WOC body folds its head's dozen pieces
    // into one draw here (woc_head_merge.ts). A rig built directly (previews, portraits)
    // keeps drawing piece by piece. `?wocmerge=off` keeps the pieces, for an A/B capture.
    visual.setWocDrawMerge(!renderLayerDisabled('wocmerge'));
    // ...and the only one where a body must never wait for its head: the bare head stands
    // in for a hairstyle or a beard still streaming (a preview draws a head only whole).
    visual.setWocBareHeadStandIn(true);
    // A WOC body is born wearing its player's modular head look and body size
    // (no-op elsewhere), so it never draws one frame at the wrong size.
    if (!formKey && e.kind === 'player') {
      visual.setWocHeadLook(e.modularAppearance);
      visual.setBodyScale(wocBodyScaleOf(e.modularAppearance));
    }
    // ...and an NPC its authored one, in its class kit with the head bare, so no
    // helm or hood ever covers the face. Nothing diffs an NPC per frame
    // (live_look_diff.ts dresses players only): its look never changes.
    if (npcLook) {
      visual.setWocHeadLook(npcLook.app);
      visual.setBodyScale(wocBodyScaleOf(npcLook.app));
      visual.setWocDefaultEquipment(true);
    }
    return visual;
  } catch (err) {
    // key the dedupe on visual key PLUS message: two models failing with an
    // identical generic error must both get their first log line
    const detail = err instanceof Error ? err.message : String(err);
    logAssetMissOnce(
      `${key}:${detail}`,
      `character visual unavailable, skipping view (${key}):`,
      err,
    );
    return null;
  }
}

/** A body that wears a roster look (npc_looks.ts) but is no entity of its own: the
 *  driver a caravan's wagon seats. Built through createCharacterVisual as the NPC the
 *  row describes (its class's WOC body, the look's face and size, the head bare, its
 *  fixed props), so it is dressed exactly as the world dresses an NPC. Null for an id
 *  with no row, or a body that failed to build (logged there). */
export function createRosterLookVisual(lookId: string, color: number): CharacterVisual | null {
  if (!npcLookFor(lookId)) return null;
  const npc = {
    kind: 'npc',
    templateId: lookId,
    color,
    skin: 0,
    mainhandItemId: null,
    offhandItemId: null,
  } as unknown as Entity;
  return createCharacterVisual(npc);
}
