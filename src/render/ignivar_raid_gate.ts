import * as THREE from 'three';
import {
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_GATE_LOCKED_TEMPLATE,
  IGNIVAR_LIFT_GATE_LOCKED_TEMPLATE,
  IGNIVAR_LIFT_ROOM_ID,
  IGNIVAR_MOLTEN_ASSEMBLY_ID,
  IGNIVAR_SECOND_WING_ID,
} from '../sim/ignivar_raid_ids';
import { EMISSIVE_GLOW, surfaceMat } from './gfx';
import { buildIgnivarLiftGate, IGNIVAR_LIFT_GATE_HEIGHT } from './ignivar_lift_room';

export const IGNIVAR_RAID_GATE_HEIGHT = 6.4;

export interface IgnivarRaidGatePlan {
  open: boolean;
  height: number;
  /** absent = the herald stone gate; 'lift' = the antechamber portcullis */
  kind?: 'lift';
}

export function ignivarRaidGatePlan(
  templateId: string,
  dungeonId: string | null,
): IgnivarRaidGatePlan | null {
  if (templateId === IGNIVAR_GATE_LOCKED_TEMPLATE) {
    return { open: false, height: IGNIVAR_RAID_GATE_HEIGHT };
  }
  if (
    templateId === 'dungeon_door' &&
    (dungeonId === IGNIVAR_MOLTEN_ASSEMBLY_ID || dungeonId === IGNIVAR_SECOND_WING_ID)
  ) {
    return { open: true, height: IGNIVAR_RAID_GATE_HEIGHT };
  }
  if (templateId === IGNIVAR_LIFT_GATE_LOCKED_TEMPLATE) {
    // sealed through the ride; the unlock swaps it to 'dungeon_door',
    // which stays on the lift kind below
    return { open: false, height: IGNIVAR_LIFT_GATE_HEIGHT, kind: 'lift' };
  }
  if (
    (templateId === 'dungeon_door' && dungeonId === IGNIVAR_FORGE_APPROACH_ID) ||
    (templateId === 'dungeon_exit' && dungeonId === IGNIVAR_LIFT_ROOM_ID)
  ) {
    // The lift's opened gate AND its exit portal render NOTHING as entity
    // bodies: the owner fronts each with a placed dungeon_entrance facade
    // wearing the keep entrance's red mist (the lift dressing owns both
    // looks); the entities keep only their walk-in triggers and labels.
    return { open: true, height: IGNIVAR_LIFT_GATE_HEIGHT, kind: 'lift' };
  }
  return null;
}

function block(
  name: string,
  size: readonly [number, number, number],
  position: readonly [number, number, number],
  material: THREE.Material,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Physical raid gate. The closed and opened poses share the same stone frame so
 *  the threshold never pops into a magical portal when Ignivar dies. The
 *  forge-lift antechamber's portcullis rides the same view seam under its
 *  own kind. */
export function buildIgnivarRaidGate(plan: IgnivarRaidGatePlan): THREE.Group {
  if (plan.kind === 'lift') return buildIgnivarLiftGate(plan.open);
  const open = plan.open;
  const group = new THREE.Group();
  group.name = open ? 'ignivar-raid-gate-open' : 'ignivar-raid-gate-locked';
  const stone = surfaceMat({ color: 0x392b26, roughness: 0.92, metalness: 0.05 });
  const iron = surfaceMat({ color: 0x241b18, roughness: 0.52, metalness: 0.78 });
  const ember = surfaceMat({
    color: 0xff5a18,
    emissive: 0xff2a08,
    emissiveIntensity: EMISSIVE_GLOW,
    roughness: 0.4,
  });
  const threshold = surfaceMat({
    color: 0x080403,
    emissive: 0x180603,
    emissiveIntensity: EMISSIVE_GLOW * 0.18,
    roughness: 1,
  });

  group.add(block('left-stone-jamb', [1.2, 6.4, 1.25], [-3.5, 3.2, 0], stone));
  group.add(block('right-stone-jamb', [1.2, 6.4, 1.25], [3.5, 3.2, 0], stone));
  group.add(block('stone-lintel', [8.2, 1.2, 1.25], [0, 6.1, 0], stone));

  const left = block('left-iron-leaf', [3.1, 5.4, 0.42], [-1.58, 2.75, 0], iron);
  const right = block('right-iron-leaf', [3.1, 5.4, 0.42], [1.58, 2.75, 0], iron);
  if (open) {
    // Swing into the room, away from the shell wall behind the frame. The
    // shadowed threshold is the visible transition plane: crossing it still
    // uses the authoritative room teleport instead of pretending both instance
    // spaces are physically adjacent.
    const leafHalfWidth = 1.55;
    const hingeX = 3.13;
    const swing = Math.PI * 0.43;
    const centerXFromHinge = Math.cos(swing) * leafHalfWidth;
    const centerZFromHinge = -Math.sin(swing) * leafHalfWidth;
    left.position.set(-hingeX + centerXFromHinge, 2.75, centerZFromHinge);
    right.position.set(hingeX - centerXFromHinge, 2.75, centerZFromHinge);
    left.rotation.y = swing;
    right.rotation.y = -swing;
    group.add(block('transition-threshold', [6.9, 5.55, 0.3], [0, 2.78, 0.5], threshold));
  }
  group.add(left, right);

  if (!open) {
    group.add(block('ember-lock', [0.28, 3.8, 0.5], [0, 2.9, -0.28], ember));
  }
  return group;
}
