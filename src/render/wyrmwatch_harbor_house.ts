// The Harbormaster's House on screen: its five shell parts (four walls and the roof) as
// their own meshes, and the hearth's firelight. The rest of the house (the frame, the floor,
// the furniture, the clutter) is drawn with the harbor (wyrmwatch_harbor.ts), merged like
// every other harbor part; only the shell has to fade.
//
// The per-frame cutaway is the pure core's call (wyrmwatch_harbor_house_core.ts): with the
// player indoors, the walls whose backs the camera would see and the roof over its sight
// line fade to nothing (the dungeon shells' idiom); with the player outdoors, the whole shell
// ghosts to 20% whenever it stands between the camera and the player (the props idiom). A
// part cut away keeps drawing (transparent at opacity 0, or under the dithered fade opaque
// with every fragment dropped; depth writes off either way) so it keeps casting
// its shadow: the room stays roofed in light whatever the camera does. Everything here is
// camera state: gameplay-neutral, the same on every graphics tier.
//
// GPU work: the shell parts draw with per-part CLONES of the harbor's converted materials
// (cloneMaterialWithHooks: the same opaque programs the props prewarm links through the
// harbor's parts), and their transparent twins are asked for through the occluder fade gate
// before the first fade (prefetchOccluderFadeWithin, the props hideables' warm path); a
// fade that would draw a twin still cold waits for the link (occluderFadeReady). The
// hearth and lantern lights are point lights for the fire-light budget (props.ts pushes
// them with the campfires': they never change the visible point-light count).

import * as THREE from 'three';
import {
  HARBOR_HOUSE,
  HARBOR_HOUSE_LANTERNS,
  HARBOR_HOUSE_PROPS,
} from '../sim/content/wyrmwatch_harbor_house';
import { WATER_LEVEL } from '../sim/world';
import { cloneMaterialWithHooks } from './material_clone_hooks';
import { ditherFadeUniform } from './occluder_dither_fade';
import {
  applyOccluderFade,
  type OccluderFadeMat,
  occluderFadeApplied,
  occluderFadeReady,
  occluderFadeRecordFor,
  prefetchOccluderFadeWithin,
} from './occluder_fade';
import { occluderFadeSettled, stepOccluderFade } from './occluder_fade_core';
import type { VertexColourPart } from './vertex_colour_glb_parts';
import {
  HOUSE_SHELL_PARTS,
  type HouseShellPart,
  houseShellOcclusion,
  newHouseShellState,
} from './wyrmwatch_harbor_house_core';

/** One shell part on screen: its meshes, their fade records, and its fade alpha. */
interface ShellRecord {
  part: HouseShellPart;
  meshes: THREE.Mesh[];
  mats: OccluderFadeMat[];
  alpha: number;
}

let shell: ShellRecord[] = [];
/** The group the shell meshes hang in (hidden past the fog like the harbor's bands). */
let shellGroup: THREE.Group | null = null;
/** Every shell record's fade materials, for the one prefetch latch. */
let allMats: OccluderFadeMat[] = [];
/** Where the house stands (world x, z): the prefetch reach is measured from here. */
let shellAnchorX = 0;
let shellAnchorZ = 0;
const state = newHouseShellState();

/** The house's firelight: the hearth's glow, and the warm light of the lit hanging lanterns
 *  (content HARBOR_HOUSE_LANTERNS, the same spots the model hangs them at). */
export const HARBOR_HOUSE_LIGHTS = {
  hearth: { color: 0xff8a3a, intensity: 14, distance: 12, decay: 2 },
  lantern: { color: 0xffc070, intensity: 7, distance: 9, decay: 2 },
} as const;
/** The house's point lights, world-positioned (the caller adds them to the props root and
 *  the fire-light budget, like a campfire's). */
export function buildHarborHouseLights(floorY: number): THREE.PointLight[] {
  const hearth = HARBOR_HOUSE_PROPS.find((p) => p.kind === 'hearth');
  const h = HARBOR_HOUSE_LIGHTS.hearth;
  const fire = new THREE.PointLight(h.color, h.intensity, h.distance, h.decay);
  fire.name = 'harborHouseHearth';
  // in front of the fire, at the height of the flames
  fire.position.set((hearth?.x ?? 0) + (hearth?.hw ?? 0) + 0.4, floorY + 1.1, hearth?.z ?? 0);
  // the budget's flicker pass drives every contributing fire light from this base (and falls
  // back to its own bright default without it): the hearth flickers round its own level
  fire.userData.baseIntensity = h.intensity;
  const out = [fire];
  const l = HARBOR_HOUSE_LIGHTS.lantern;
  for (const spot of HARBOR_HOUSE_LANTERNS) {
    if (!spot.lit) continue;
    const lamp = new THREE.PointLight(l.color, l.intensity, l.distance, l.decay);
    lamp.name = 'harborHouseLantern';
    lamp.position.set(spot.x, floorY + HARBOR_HOUSE.tieBeam - spot.drop, spot.z);
    lamp.userData.baseIntensity = l.intensity;
    out.push(lamp);
  }
  return out;
}

/**
 * Build the shell meshes in the model's frame (the caller parents them under the harbor
 * model, which stands at the harbor origin on the waterline). `parts` holds each shell
 * part's merged per-material geometry. Replaces the previous build's records.
 */
export function buildHarborHouseShell(
  parts: ReadonlyMap<HouseShellPart, readonly VertexColourPart[]>,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'harborHouseShell';
  shellGroup = group;
  shell = [];
  allMats = [];
  for (const part of HOUSE_SHELL_PARTS) {
    const record: ShellRecord = { part, meshes: [], mats: [], alpha: 1 };
    // one clone per material per part, so a part fades alone
    const clones = new Map<THREE.Material, THREE.Material>();
    for (const p of parts.get(part) ?? []) {
      let mat = clones.get(p.material);
      if (!mat) {
        mat = cloneMaterialWithHooks(p.material);
        clones.set(p.material, mat);
      }
      const mesh = new THREE.Mesh(p.geometry, mat);
      mesh.name = part;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      occluderFadeRecordFor(record.mats, mat, mesh);
      record.meshes.push(mesh);
      group.add(mesh);
    }
    shell.push(record);
  }
  return group;
}

/** The shell's (geometry, cloned material) pairs, for the props material prewarm (the
 *  clones link the opaque programs their sources do; listing them warms by identity too). */
export function harborHouseShellParts(): VertexColourPart[] {
  return shell.flatMap((r) =>
    r.meshes.map((m) => ({ geometry: m.geometry, material: m.material as THREE.Material })),
  );
}

/** Every shell mesh (the props merge must leave them alone: they fade one by one). */
export function harborHouseShellMeshes(): readonly THREE.Mesh[] {
  return shell.flatMap((r) => r.meshes);
}

/** One part's fade step toward `occluded ? floor : 1`, gated like advanceOccluderFade: the
 *  flip to transparent waits for its linked program. At rest cut away (alpha 0) it stops
 *  writing depth and colour (neither is a program key, and the shadow pass reads neither),
 *  so the room behind it shows, it costs no blending, and its shadow stays. */
function stepPart(
  r: ShellRecord,
  occluded: boolean,
  floor: number,
  dt: number,
  reducedMotion: boolean,
): void {
  if (occluderFadeSettled(r.alpha, occluded, floor) && occluderFadeApplied(r.mats, r.alpha)) return;
  const next = stepOccluderFade(r.alpha, occluded, dt, reducedMotion, floor);
  if (next < 1) {
    if (!occluded && occluderFadeApplied(r.mats, 1)) {
      r.alpha = next;
      return;
    }
    if (!occluderFadeReady(r.mats, occluded ? 'edge' : 'prefetch')) {
      r.alpha = next;
      return;
    }
  }
  r.alpha = next;
  applyOccluderFade(r.mats, next);
  const cut = next === 0;
  for (const m of r.mats) {
    m.mat.colorWrite = !cut;
    if (cut) m.mat.depthWrite = false;
    // the dithered arm keeps the material opaque and never touches its depth writes
    // (applyOccluderFade), so the cut's drop is undone here once the part draws again
    else if (ditherFadeUniform(m.mat)) m.mat.depthWrite = m.depthWrite;
  }
}

/** Past the fog the shell stops drawing with the rest of the harbor (its bands cull there):
 *  a yard of slack past the house's reach from its anchor. */
export const HARBOR_HOUSE_SHELL_CULL_SLACK = 14;

/** Advance the shell one frame (props.ts update, with the frame's camera and eye). */
export function updateHarborHouseShell(
  camX: number,
  camY: number,
  camZ: number,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  dt: number,
  reducedMotion = false,
  fogFar = Number.POSITIVE_INFINITY,
): void {
  if (shell.length === 0) return;
  const reach = fogFar + HARBOR_HOUSE_SHELL_CULL_SLACK;
  const far = (camX - shellAnchorX) ** 2 + (camZ - shellAnchorZ) ** 2 > reach * reach;
  if (shellGroup && shellGroup.visible === far) shellGroup.visible = !far;
  if (far) return;
  // warm the fade twins once the camera comes within reach of the house
  prefetchOccluderFadeWithin(harborHouseAllMats(), shellAnchorX, shellAnchorZ, camX, camZ);
  houseShellOcclusion(eyeX, eyeY, eyeZ, camX, camY, camZ, WATER_LEVEL, state);
  for (let i = 0; i < shell.length; i++) {
    stepPart(shell[i], state.occluded[i], state.floor, dt, reducedMotion);
  }
}

function harborHouseAllMats(): OccluderFadeMat[] {
  if (allMats.length === 0) allMats = shell.flatMap((r) => r.mats);
  return allMats;
}

/** Where the house stands (world x, z): the prefetch reach is measured from here. */
export function setHarborHouseAnchor(x: number, z: number): void {
  shellAnchorX = x;
  shellAnchorZ = z;
  allMats = [];
}

/** Drop the shell records and dispose their material clones (a graphics-profile rebuild
 *  tears the old props down; a world without the harbor builds none). */
export function clearHarborHouseShell(): void {
  const disposed = new Set<THREE.Material>();
  for (const r of shell) {
    for (const m of r.mats) {
      if (disposed.has(m.mat)) continue;
      disposed.add(m.mat);
      m.mat.dispose();
    }
  }
  shell = [];
  allMats = [];
  shellGroup = null;
}

export const harborHouseInternalsForTest = {
  shell: (): readonly ShellRecord[] => shell,
  state: () => state,
};
