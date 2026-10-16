// Pointing the shared character turntable at a SUBJECT: whose character the
// stage shows first (it decides the armor detail the body is built at), then the
// composed look wins over an explicit visual key, which wins over the plain
// class rig (the same precedence the world applies in createCharacterVisual),
// then the appearance skin, the Armory weapon skin, a WOC modular body's worn
// set, and the framing.
//
// Pure orchestration over CharacterPreview's own API, no DOM: the HUD keeps
// the canvas and container bookkeeping (which host the one WebGL context sits
// in) and hands the subject here, so the char sheet, the skin-select overlay
// and the inspect stage cannot drift apart in what they mount.
import type { PreviewFramingName } from '../render/characters';
import {
  type BodyPick,
  mechHeldWeaponOverride,
  playerVisualKey,
} from '../render/characters/manifest';
import type { ModularLook } from '../render/characters/modular';
import type { PreviewArmorSurface } from '../render/characters/preview_armor_detail_core';
import type { WocHeadAppearanceInput } from '../render/characters/woc_head_look_core';
import { classBodyComposes } from '../render/characters/woc_parts_core';
import type { EquipSlot, PlayerClass } from '../sim/types';

export interface PreviewSubject {
  cls: PlayerClass;
  skin: number;
  /** An explicit visual key (the Combat Mech body); absent = the class rig. */
  previewKey?: string;
  mainhand: string | null;
  offhand: string | null;
  /** The active Armory weapon-skin cosmetic (null = the item's own model). */
  weaponSkinId: string | null;
  /** The stage's camera framing, which also names the stage: `inspect` shows someone
   *  else's character, whose armor draws the crowd's detail (previewStageSurface). */
  framing: PreviewFramingName;
  /** Compose the turntable from this authored look instead of mounting the
   *  stock class rig. Set for the SELF sheet, whose body must match the one
   *  the world draws; null for a stage showing someone else. */
  look?: ModularLook | null;
  /** The worn set a WOC modular body dresses from: the SELF sheet passes its
   *  own equipment, the inspect stage the inspected player's mirrored set.
   *  ABSENT keeps the body's assembly default (the full kit); an explicit null
   *  or empty map dresses it bare, so the two are never conflated. */
  wornEquipment?: Readonly<Partial<Record<EquipSlot, string>>> | null;
  helmHidden?: boolean;
  /** The stored look a WOC modular body's head, colours and size draw from (the
   *  self sheet: the player's own; the inspect stage: the inspected player's).
   *  ABSENT keeps whatever the stage last drew; ignored when `look` composes. */
  wocAppearance?: WocHeadAppearanceInput;
}

/** The turntable surface the subject is applied through (CharacterPreview). */
export interface PreviewSubjectTarget {
  setModular(
    app: ModularLook['app'],
    worn: ModularLook['worn'],
    cls: PlayerClass,
    weaponItemId?: string | null,
    offhandItemId?: string | null,
  ): void;
  setVisualKey(
    visualKey: string,
    weaponItemId: string | null,
    weaponOverride: ReturnType<typeof mechHeldWeaponOverride>,
    offhandItemId: string | null,
  ): void;
  setClass(cls: PlayerClass, weaponItemId?: string | null, offhandItemId?: string | null): void;
  setSkin(skin: number): void;
  setWeaponSkin(skinId: string | null): void;
  setWocEquipment(
    equipped: Readonly<Partial<Record<EquipSlot, string>>> | null | undefined,
    helmHidden: boolean,
  ): void;
  setFraming(framing: PreviewFramingName): void;
  setWocAppearance(app: WocHeadAppearanceInput): void;
  setArmorSurface(surface: PreviewStageSurface): void;
}

/** What a HUD stage shows, for the armor detail its body draws
 *  (render/characters/preview_armor_detail_core.ts). */
export type PreviewStageSurface = Exclude<PreviewArmorSurface, 'creator'>;

/** The HUD's two stages are named by their framing: the inspect stage shows SOMEONE
 *  ELSE's character (the crowd's armor detail, the files the world already draws that
 *  player with, and never a top file), every other one the player's own (full detail,
 *  as the world draws it). */
export function previewStageSurface(framing: PreviewFramingName): PreviewStageSurface {
  return framing === 'inspect' ? 'inspect' : 'own';
}

export function applyPreviewSubject(preview: PreviewSubjectTarget, s: PreviewSubject): void {
  // before the mount: a body rebuilt for this subject is born at its stage's armor
  // detail (so it never asks for a file it will not draw), a body kept changes in place
  preview.setArmorSurface(previewStageSurface(s.framing));
  // before the mount: a rebuilt WOC body picks the look up as it is built, an
  // unchanged one takes it in place
  if (!s.look && s.wocAppearance !== undefined) preview.setWocAppearance(s.wocAppearance);
  if (s.look) {
    // The composed body wins over the class rig, exactly as it does in the
    // world: same face, hair, kit and helmet choice, holding the real hands.
    preview.setModular(s.look.app, s.look.worn, s.cls, s.mainhand, s.offhand);
  } else if (s.previewKey) {
    // Mech is class-agnostic; mirror the wearer class's hand layout so the
    // paperdoll matches the in-world render.
    const override = s.previewKey === 'player_mech' ? mechHeldWeaponOverride(s.cls) : null;
    preview.setVisualKey(s.previewKey, s.mainhand, override, s.offhand);
  } else {
    preview.setClass(s.cls, s.mainhand, s.offhand);
  }
  preview.setSkin(s.skin);
  preview.setWeaponSkin(s.weaponSkinId);
  if (s.wornEquipment !== undefined) {
    preview.setWocEquipment(s.wornEquipment, s.helmHidden ?? false);
  }
  preview.setFraming(s.framing);
}

/** The explicit preview key a WOC-bodied class needs on a stage: its body file
 *  follows the creation pick (the female warrior), which `setClass` cannot
 *  see. A composing class returns undefined and keeps the class rig. */
export function wocPreviewKey(cls: PlayerClass, appearance: BodyPick): string | undefined {
  return classBodyComposes(cls) ? undefined : playerVisualKey(cls, appearance);
}
