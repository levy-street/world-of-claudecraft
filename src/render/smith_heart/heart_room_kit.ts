// The Heart dressed with its Blender kit (phase 2J: heart_room_kit_plan_core.ts
// plans every piece; heart_kit.ts bakes them): the Anvil of the World's walk,
// balustrade and keel, the Arrival Terrace's, the Heart Bridge, the heart's
// bed deep in the chasm (one static instanced draw each), and the four veins'
// own pieces, each altar and its root of the mountain, whose crystal burns in
// its vein's colour (`heartVeinGlowMaterial`): the vein's light running down
// its root into its altar, each vein lit and dimmed on its own
// (`setVein`, the final fight's later altar drags; the heart's death dims
// them all).
//
// Built only when the kit has landed when the interior is built (the
// interior waits for it, capped); otherwise the blockout's chains, keels and
// altar placeholders stand, as before.
//
// GPU preparation: every material is built with the interior (the compile
// gate links it); the vein glow is one small shader, no texture.

import * as THREE from 'three';
import {
  SMITH_HEART_VEIN_COLORS,
  SMITH_HEART_VEINS,
  type SmithHeartVein,
} from '../../sim/content/smith_heart_layout';
import { GFX, sharedUniforms } from '../gfx';
import type { HeartFallAltar } from './heart_collapse_rig';
import {
  ensureHeartKit,
  heartKitLoaded,
  heartKitMeshes,
  heartKitPlacementMatrix,
  instanceHeartKit,
  SMITH_HEART_HEART_KIT_URL,
} from './heart_kit';
import { HEART_PLATFORM_ORDER } from './heart_quarters_core';
import {
  HEART_ALTAR_PIECES,
  HEART_KIT_KINDS,
  planHeartCoreBed,
  planHeartRoomKit,
  planHeartVeinPieces,
} from './heart_room_kit_plan_core';
import { heartRootEmissiveGlsl, heartVeinDimGlsl } from './heart_root_look_core';

/** Wait (capped) for the Heart kit before the interior is built. */
export function ensureHeartRoomKit(): Promise<void> {
  return ensureHeartKit(SMITH_HEART_HEART_KIT_URL);
}

/** Has the Heart kit landed? */
export function heartRoomKitReady(): boolean {
  return heartKitLoaded(SMITH_HEART_HEART_KIT_URL);
}

export { HEART_KIT_KINDS };

/**
 * A vein's crystal (the kit's glow slot: pale facet greys per vertex): its
 * vein's colour times the facets, `uLevel` its strength (0 dark, 1 lit),
 * and the vein's light running down it in slow bands (by the piece's own
 * height, so a root's light runs from the crown down into its altar).
 */
export function heartVeinGlowMaterial(color: number, name: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name,
    vertexColors: true,
    fog: false,
    toneMapped: false,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uLevel: { value: 1 },
      uTime: sharedUniforms.uTime,
    },
    vertexShader: /* glsl */ `
      varying vec3 vShade;
      varying float vH;
      void main() {
        vShade = color;
        vH = position.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uLevel; uniform float uTime;
      varying vec3 vShade; varying float vH;
      void main() {
        // Bands of light falling down the piece (a root's to its altar).
        float run = 0.5 + 0.5 * sin(vH * 0.32 + uTime * 2.1);
        float pulse = 0.78 + 0.34 * run * run;
        // Dim, a low glow of its colour (heart_root_look_core.ts): never black.
        vec3 dark = ${heartVeinDimGlsl()};
        vec3 lit = uColor * vShade * pulse * 1.15 + vec3(1.0, 0.97, 0.9) * smoothstep(0.92, 1.0, vShade.r) * 0.25;
        gl_FragColor = vec4(mix(dark, lit, clamp(uLevel, 0.0, 1.0)), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

export interface HeartRoomKit {
  group: THREE.Group;
  /** Light (1) or dim (0) one vein's altar and root. */
  setVein(vein: SmithHeartVein, level: number): void;
  /** The heart's bed: its crystal burning (1) or dark (0). */
  setHeart(level: number): void;
  /** A vein's altar, moved with its quarter when it falls (heart_collapse_rig.ts). */
  altar(vein: SmithHeartVein): HeartFallAltar | null;
  /** A vein's root of the mountain, torn out and dropped after its landmark
   *  when its quarter falls (heart_quarters.ts, heart_collapse_core.ts heartRootFall). */
  root(vein: SmithHeartVein): HeartFallAltar | null;
}

const tmp = new THREE.Matrix4();

/** The Heart's kit dressing (instance-local). */
export function buildHeartRoomKit(lowGfx: boolean): HeartRoomKit {
  const group = new THREE.Group();
  group.name = 'smithHeartHeartKit';
  const statics = instanceHeartKit(
    SMITH_HEART_HEART_KIT_URL,
    planHeartRoomKit(),
    lowGfx,
    'smithHeartHeartStatic',
    220,
  );
  // The platform's rim and its joints' dirt draw with the quarters' floors,
  // before the ridges' spines (phase 2L, HEART_PLATFORM_ORDER).
  for (const m of statics.children)
    if (m.name.startsWith('Kit_AnvilFloor:')) m.renderOrder = HEART_PLATFORM_ORDER.floor;
  group.add(statics);
  // The heart's bed, its crystal on its own glow (it dims with the heart).
  const bedGlow = new THREE.MeshBasicMaterial({
    vertexColors: true,
    toneMapped: false,
    name: 'SmithHeartKitGlow',
  });
  const bedPlace = planHeartCoreBed();
  const bed = heartKitMeshes(SMITH_HEART_HEART_KIT_URL, bedPlace.piece);
  if (bed) {
    bed.name = 'Kit_CoreBed:heart';
    bed.matrixAutoUpdate = false;
    bed.matrix.copy(heartKitPlacementMatrix(bedPlace, tmp));
    for (const m of bed.children) {
      if (!(m instanceof THREE.Mesh)) continue;
      if (m.name.endsWith(':glow')) m.material = bedGlow;
      m.castShadow = false;
    }
    group.add(bed);
  }
  // The roots' hand-painted stone in its own colours (heart_root_look_core.ts):
  // the kit's shared fracture stone sank it to near black on the dark crown.
  const rootPainted = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
        name: 'smithHeartRootPainted',
        vertexColors: true,
        metalness: 0,
        roughness: 0.9,
      })
    : new THREE.MeshLambertMaterial({ name: 'smithHeartRootPainted', vertexColors: true });
  rootPainted.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
${heartRootEmissiveGlsl()}`,
    );
  };
  rootPainted.customProgramCacheKey = () => 'smith-heart-root-painted|aaa4';
  const glows = new Map<SmithHeartVein, THREE.ShaderMaterial>();
  const altars = new Map<SmithHeartVein, HeartFallAltar>();
  const roots = new Map<SmithHeartVein, HeartFallAltar>();
  for (const vein of SMITH_HEART_VEINS) {
    const glow = heartVeinGlowMaterial(SMITH_HEART_VEIN_COLORS[vein], `smithHeartVeinGlow:${vein}`);
    glows.set(vein, glow);
    for (const p of planHeartVeinPieces(vein)) {
      const holder = heartKitMeshes(SMITH_HEART_HEART_KIT_URL, p.piece);
      if (!holder) continue;
      holder.name = `${p.piece}:${vein}`;
      holder.matrixAutoUpdate = false;
      holder.matrix.copy(heartKitPlacementMatrix(p, tmp));
      if (p.piece === HEART_ALTAR_PIECES[vein])
        altars.set(vein, { holder, rest: holder.matrix.clone(), x: p.x, z: p.z });
      if (p.piece === 'Kit_HeartRoot')
        roots.set(vein, { holder, rest: holder.matrix.clone(), x: p.x, z: p.z });
      for (const m of holder.children) {
        if (!(m instanceof THREE.Mesh)) continue;
        if (m.name.endsWith(':glow')) m.material = glow;
        // The roots, and the Heat's altar (its dark basalt read as pure black
        // through the shared stone), in their own painted colours.
        else if (
          (p.piece === 'Kit_HeartRoot' || p.piece === 'Kit_AltarHeat') &&
          m.name.endsWith(':stone')
        )
          m.material = rootPainted;
        // The roots are scenery far over the walk: no shadow from them.
        if (p.noShadow || lowGfx) m.castShadow = false;
      }
      group.add(holder);
    }
  }
  return {
    group,
    setVein(vein, level) {
      const g = glows.get(vein);
      const k = Math.round(Math.max(0, Math.min(1, level)) * 100) / 100;
      if (g && g.uniforms.uLevel.value !== k) g.uniforms.uLevel.value = k;
    },
    setHeart(level) {
      const k = 0.12 + 0.88 * Math.max(0, Math.min(1, level));
      if (bedGlow.color.r !== k) bedGlow.color.setScalar(k);
    },
    altar: (vein) => altars.get(vein) ?? null,
    root: (vein) => roots.get(vein) ?? null,
  };
}
