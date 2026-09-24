import type * as THREE from 'three';
import { buildBloodlettingShape } from './bloodletting_shape';
import { buildFuryCutShape } from './fury_shapes';
import { buildHarvestShape } from './harvest_shapes';
import { buildIronguardShape, type IronguardShape } from './ironguard_shapes';
import type { Substance } from './signature_core';
import { buildTwinstrikeShape } from './twinstrike_shape';
import { buildWarriorArea, type WarriorAreaShape } from './warrior_area_shapes';
import { warriorAvatarRuptureShape } from './warrior_avatar_rupture';
import { buildWarriorBark } from './warrior_bark_shape';
import { buildWarriorBlade } from './warrior_blade_shape';
import { warriorGyreShape } from './warrior_gyre_shape';
import { buildWarriorHeavyShape, type WarriorHeavyShape } from './warrior_heavy_shapes';
import { warriorLeapShape } from './warrior_leap_shape';
import { buildWarriorShield } from './warrior_shield_shape';
import {
  buildWarriorPressure,
  WARRIOR_PRESSURE_KINDS,
  type WarriorPressureKind,
} from './warrior_shout_shapes';
export type CrestKind =
  | Substance
  | 'bone'
  | 'ward'
  | 'feather'
  | 'hook'
  | 'chain'
  | 'blood_cut'
  | 'harvest_cut'
  | 'harvest_eruption'
  | 'twinstrike_cut'
  | 'bloodletting_pull'
  | 'bark_pressure'
  | 'shield_contact'
  | 'steel_cut'
  | WarriorHeavyShape
  | 'avatar_rupture'
  | 'blood_gyre'
  | 'leap_rupture'
  | WarriorAreaShape
  | IronguardShape
  | WarriorPressureKind;

/** Open, directional surfaces with genuinely different topology. Generated once
 * during preparation; all animation deforms these existing vertices. */
export function buildSignatureShapes(): Map<CrestKind, THREE.BufferGeometry> {
  const shapes = new Map<CrestKind, THREE.BufferGeometry>();
  shapes.set('blood_cut', buildFuryCutShape());
  shapes.set('harvest_cut', buildHarvestShape(false));
  shapes.set('harvest_eruption', buildHarvestShape(true));
  shapes.set('twinstrike_cut', buildTwinstrikeShape());
  shapes.set('bloodletting_pull', buildBloodlettingShape());
  shapes.set('bark_pressure', buildWarriorBark());
  shapes.set('shield_contact', buildWarriorShield());
  shapes.set('steel_cut', buildWarriorBlade());
  for (const kind of ['steel_chop', 'steel_counter', 'steel_execution'] as const)
    shapes.set(kind, buildWarriorHeavyShape(kind));
  shapes.set('avatar_rupture', warriorAvatarRuptureShape());
  shapes.set('blood_gyre', warriorGyreShape());
  shapes.set('leap_rupture', warriorLeapShape());
  shapes.set('steel_storm', buildWarriorArea('steel_storm'));
  shapes.set('steel_reap', buildWarriorArea('steel_reap'));
  for (const kind of ['iron_counter', 'iron_quake', 'iron_fault', 'breach_wedge'] as const)
    shapes.set(kind, buildIronguardShape(kind));
  for (const kind of WARRIOR_PRESSURE_KINDS) shapes.set(kind, buildWarriorPressure(kind));
  return shapes;
}
