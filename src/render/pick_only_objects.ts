// Ground-object entities whose ART is drawn by a scenery view, so the entity itself is
// only a pick volume (no body of its own, no generic loot sparkle).
//
// The Realm Builder monument's statue is part of Eastbrook's town batch, the Muster
// Weapon Rack is part of the Mirefen muster camp (src/render/muster_camps.ts), and the
// torchable mudfin huts are the props.ts scenery huts (src/render/mudfin_hut_pick.ts).
// Without a row here each entity would fall through renderer.ts's generic ground-object
// arm, which builds a quest-pickup prop plus a loot sparkle inside the real art. One
// table, one renderer branch: a new scenery-drawn interactable is a row, never another arm.

import type * as THREE from 'three';
import { GURGLEGREEN_CAULDRON_ID } from '../sim/content/gourdlight_eve';
import { MUSTER_RACK_TEMPLATE_ID } from '../sim/content/mirefen_muster';
import { MUDFIN_HUT_TEMPLATE_ID } from '../sim/mudfin_huts';
import { REALM_BUILDER_MONUMENT_TEMPLATE_ID } from '../sim/types';
import { buildMudfinHutPickBody } from './mudfin_hut_pick';
import { buildMusterRackPickBody } from './muster_camps';
import { buildRealmBuilderMonumentPickBody } from './realm_builder_monument_fx';
import { buildToyCauldronPickBody } from './seasonal_toys_fx';

type PickBodyBuilder = () => { group: THREE.Group; height: number };

const PICK_ONLY_OBJECTS: Readonly<Record<string, PickBodyBuilder>> = Object.freeze({
  [REALM_BUILDER_MONUMENT_TEMPLATE_ID]: buildRealmBuilderMonumentPickBody,
  [MUSTER_RACK_TEMPLATE_ID]: buildMusterRackPickBody,
  [MUDFIN_HUT_TEMPLATE_ID]: buildMudfinHutPickBody,
  // Hester's Gurglegreen Cauldron: drawn by the toys' layer (seasonal_toys_fx.ts)
  [`ground_${GURGLEGREEN_CAULDRON_ID}`]: buildToyCauldronPickBody,
});

/** Whether a ground object's art lives in a scenery view (its entity is a pick volume). */
export function isPickOnlyObjectTemplate(templateId: string | null | undefined): boolean {
  return typeof templateId === 'string' && Object.hasOwn(PICK_ONLY_OBJECTS, templateId);
}

/** The pick volume for a template `isPickOnlyObjectTemplate` accepted. */
export function buildPickOnlyObjectBody(templateId: string): {
  group: THREE.Group;
  height: number;
} {
  const build = PICK_ONLY_OBJECTS[templateId];
  if (!build) throw new Error(`no pick-only body for ${templateId}`);
  return build();
}

/** The registered template ids (tests pin the table). */
export const PICK_ONLY_OBJECT_TEMPLATE_IDS: readonly string[] = Object.keys(PICK_ONLY_OBJECTS);
