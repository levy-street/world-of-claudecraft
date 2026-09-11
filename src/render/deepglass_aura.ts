// Team highlights: which of these ten bodies is on my side?
//
// The bell is a sphere with fighters at every attitude, all wearing the same
// chibi rig, at up to forty yards. Nameplates answer the question only if you
// stop and read one, and in a sport played at 26 yd/s nobody reads. So every
// fighter is HIGHLIGHTED in their side's colour (DG_TEAM_COLOR, the same two
// the score strip and the nameplates use), and the answer becomes peripheral
// rather than something you look up.
//
// THE HIGHLIGHT IS THE BODY'S OWN GEOMETRY. Each of the wearer's meshes gets a
// hull twin: the same geometry, the same skeleton, drawn back-faces-only and
// pushed a few millimetres out along its normals. That is the classic
// inverted-hull outline, and it is the right shape for this job for two
// reasons, it traces the actual silhouette of the actual pose (arms, cape,
// hair, the pack on their back), and it costs nothing to keep in sync, because
// sharing the skeleton means the twin skins itself on the GPU exactly the way
// the body does. A sphere or a capsule around the body was the first attempt
// and it read as a bubble, not as a player.
//
// On top of the hull the shader adds a fresnel rim, so the edge facing away
// from you glows hardest and the highlight reads as light coming off the body
// rather than as a coloured sticker over it.
//
// Cost: one extra draw per source mesh (a chibi is a handful), and ONE shader
// program for the whole roster, the source is identical for every wearer and
// only the uniforms differ, so there is no per-body compile stall.

import * as THREE from 'three';
import { DG_TEAM_COLOR } from '../sim/deepglass/layout';

/** Every twin carries this in its name, so a rebuild can tell the body's own
 *  meshes from the ones this module added. */
const HULL_PREFIX = 'dg-aura:';
/** characters/visual.ts names its shadow-only stand-in this. */
const SHADOW_PROXY_NAME = 'character_shadow_proxy';
/**
 * How far the hull is pushed out along the body's normals, as a fraction of the
 * body's DISTANCE from the camera.
 *
 * Distance-scaled, not a fixed size, and that is the whole difference between an
 * outline and a decoration. A constant world-space rim is 5 cm on a 1.8 yd body:
 * legible at five yards and gone by twenty, while the bell is seventy-six
 * across and the fighter you most need to identify is the one furthest away.
 * Scaling with depth holds the rim at a constant WIDTH ON SCREEN, so it reads
 * the same at the far wall as it does in your face.
 */
const HULL_INFLATE = 0.006;
/** Never thinner than this in local units, so a body at point-blank range keeps
 *  a rim rather than a hairline. */
const HULL_INFLATE_MIN = 0.02;
/** Seconds the highlight takes to come up and to fade out. */
const AURA_FADE = 0.22;
/**
 * The local player's own highlight, as a fraction of everyone else's.
 *
 * You already know which side you are on, and a full-strength rim around your
 * own body sits in the middle of the screen for the whole match. Dimmed rather
 * than removed: it still reads for a spectator, and one body with no highlight
 * in a crowd of nine that have one looks like a bug rather than a choice.
 */
const AURA_SELF = 0.4;

export interface AuraSample {
  id: number;
  /** The wearer's visual root. Every mesh under it gets a hull twin. */
  root: THREE.Object3D;
  team: 'A' | 'B';
  /** This is the camera's own body. */
  isSelf: boolean;
  /** Carrying the Tidesow: the highlight pulses harder, so "who has it" is the
   *  same peripheral read as "whose side are they on". */
  carrying: boolean;
}

const VERT = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
#include <morphtarget_pars_vertex>
uniform float uInflate;
uniform float uInflateMin;
varying vec3 vNormalV;
varying vec3 vPosV;
void main() {
  // The standard chunk order, so the twin lands in exactly the pose the source
  // mesh is in: morphs, then skinning, for the normal and the position alike.
  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  // The hull: out along the SKINNED normal, so it stays a constant rim through
  // every pose instead of tearing open where the mesh bends, and scaled by the
  // body's DEPTH, so the rim holds its width on screen at any range.
  vec4 mv0 = modelViewMatrix * vec4(transformed, 1.0);
  float grow = max(uInflateMin, uInflate * max(1.0, -mv0.z));
  transformed += objectNormal * grow;
  vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
  vPosV = mv.xyz;
  vNormalV = normalize(transformedNormal);
  gl_Position = projectionMatrix * mv;
}
`;

// No `precision` line, deliberately: three prepends its own to both stages, and
// a duplicate makes any uniform declared in both disagree so the program will
// not LINK, while both shaders still compile clean, which is a silent nothing
// on screen (see render/jet_fire.ts, which lost an hour to exactly this).
const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
varying vec3 vNormalV;
varying vec3 vPosV;
void main() {
  vec3 n = normalize(vNormalV);
  vec3 v = normalize(-vPosV);
  // Back faces, so the normal points away: the silhouette is where the twin is
  // most edge-on to the eye.
  float f = 1.0 - abs(dot(n, v));
  // The visible fringe is edge-on by construction (it is the part of the shell
  // that clears the silhouette), so this lands near opaque exactly where it is
  // seen and falls away on the few interior pixels that peek through.
  float a = (0.45 + 0.55 * pow(clamp(f, 0.0, 1.0), 2.0)) * uStrength;
  // Lift the colour toward white at the very edge: a rim that is only the team
  // hue reads as flat paint, a hot edge reads as a light on the body.
  gl_FragColor = vec4(mix(uColor, vec3(1.0), pow(clamp(f, 0.0, 1.0), 6.0) * 0.35), a);
}
`;

/**
 * Is this mesh part of the BODY, or is it an effect hanging off it?
 *
 * Only solid, currently-drawn geometry gets a twin. Three things under a
 * fighter would otherwise be outlined and all three look wrong:
 *
 *  - the burner PLUME (jet_fire.ts), whose shader stretches it in object space,
 *    so a twin built from the same geometry without that stretch is a
 *    differently-shaped blob welded to the nozzle;
 *  - the additive nozzle GLOWS, which are billboarding light, not surface;
 *  - the jetpack's authored flame CONES, which are switched off through their
 *    material rather than through `visible` (deepglass_pack.ts explains why),  *    a twin carrying its own material would put them straight back on screen as
 *    coloured cones.
 *
 * The last one is the reason this tests the MATERIAL and not just `visible`.
 */
export function isHullable(mesh: THREE.Mesh): boolean {
  // The character's shadow proxy (characters/visual.ts buildFarMeshes): a
  // STATIC copy of the body in its baked idle pose, drawn colorWrite:false so
  // it only ever exists to cast a shadow in the mid-distance band while the
  // articulated rig is still the body you see. It is not a surface, and a twin
  // of it is an upright, unanimated figure standing inside the swimming one:
  // exactly the "aura is the model standing up at distance" report from the
  // bell, where every body pitches and rolls while the proxy stands to
  // attention. Matched by name AND by the colorWrite tell, so a renamed proxy
  // or any other shadow-only helper mesh stays out of the outline too.
  if (mesh.name === SHADOW_PROXY_NAME) return false;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) {
    if (!m) return false;
    if (m.visible === false) return false;
    if (m.colorWrite === false) return false;
    if ((m as THREE.ShaderMaterial).isShaderMaterial) return false;
    if (m.blending === THREE.AdditiveBlending) return false;
  }
  return mats.length > 0;
}

interface Hull {
  /** The twin, and the source it shadows (kept to follow visibility). */
  mesh: THREE.Mesh;
  src: THREE.Mesh;
}

interface Highlight {
  hulls: Hull[];
  mat: THREE.ShaderMaterial;
  /** The root the hulls were built from; a rebuilt visual invalidates them. */
  root: THREE.Object3D;
  /** 0..1 fade, so a body joining or leaving does not pop. */
  k: number;
}

function hullMaterial(team: 'A' | 'B'): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(DG_TEAM_COLOR[team]) },
      uStrength: { value: 0 },
      uInflate: { value: HULL_INFLATE },
      uInflateMin: { value: HULL_INFLATE_MIN },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    // BackSide is what makes this an OUTLINE: the twin's front faces are
    // discarded and the depth test rejects everything the body itself covers,
    // so all that survives is the fringe standing proud of the silhouette.
    side: THREE.BackSide,
    // SOLID, not additive. Additive was the first attempt and it disappears
    // against a bright background, which in the bell is most of them, since
    // the arena is a lit sphere under a pale sky. A highlight that only reads
    // against dark pixels is not a highlight.
    blending: THREE.NormalBlending,
    toneMapped: false,
  });
}

/**
 * One hidden micro-mesh per program variant the hull shader can be asked for,  * static, skinned, and skinned-with-morphs (the body meshes the twins actually
 * shadow carry both skinning and face morphs, and each combination is its own
 * entry in three's program cache). Parked in the renderer's warm bench so the
 * entry compile links all of them behind the loading screen; without this the
 * first bout's first frame paid the link for the whole roster's outlines.
 */
export function createAuraWarmMeshes(): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (const [skinned, morphs] of [
    [false, false],
    [true, false],
    [true, true],
  ] as const) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0]);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
    );
    if (morphs) {
      geo.morphAttributes.position = [new THREE.BufferAttribute(pos.slice(), 3)];
      geo.morphAttributes.normal = [new THREE.BufferAttribute(new Float32Array(9), 3)];
      geo.morphTargetsRelative = true;
    }
    let mesh: THREE.Mesh;
    if (skinned) {
      geo.setAttribute(
        'skinIndex',
        new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4),
      );
      geo.setAttribute(
        'skinWeight',
        new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
      );
      const skinnedMesh = new THREE.SkinnedMesh(geo, hullMaterial('A'));
      const bone = new THREE.Bone();
      skinnedMesh.add(bone);
      skinnedMesh.bind(new THREE.Skeleton([bone]));
      mesh = skinnedMesh;
    } else {
      mesh = new THREE.Mesh(geo, hullMaterial('A'));
    }
    mesh.name = `dg-aura-warm:${skinned ? 'skinned' : 'static'}${morphs ? '+morphs' : ''}`;
    mesh.frustumCulled = false;
    out.push(mesh);
  }
  return out;
}

export class DeepglassAuras {
  private readonly lit = new Map<number, Highlight>();
  private clock = 0;

  /** Build (or rebuild) the hull twins for one body. */
  private build(sample: AuraSample): Highlight {
    const mat = hullMaterial(sample.team);

    // Gather FIRST, build second. Adding a twin inside the traverse mutates the
    // tree being walked, so traverse descends into the twin, twins the twin, and
    // recurses until the stack blows (three's updateMatrixWorld is where it
    // lands, which points nowhere near the actual cause).
    const sources: THREE.Mesh[] = [];
    sample.root.traverse((o) => {
      const src = o as THREE.Mesh;
      if (!src.isMesh || !src.geometry) return;
      if (src.name.startsWith(HULL_PREFIX)) return; // never twin a twin
      if (!isHullable(src)) return;
      sources.push(src);
    });

    const hulls: Hull[] = [];
    for (const src of sources) {
      const skinned = src as THREE.SkinnedMesh;
      let twin: THREE.Mesh;
      if (skinned.isSkinnedMesh && skinned.skeleton) {
        // Same geometry, same skeleton: the twin skins itself on the GPU in
        // lockstep with the body, with nothing to keep in sync per frame.
        const s = new THREE.SkinnedMesh(src.geometry, mat);
        s.bind(skinned.skeleton, skinned.bindMatrix);
        twin = s;
      } else {
        twin = new THREE.Mesh(src.geometry, mat);
      }
      twin.name = `${HULL_PREFIX}${src.name}`;
      twin.frustumCulled = false;
      twin.renderOrder = 12; // under the plumes and the ice, over the world
      twin.castShadow = false;
      twin.receiveShadow = false;
      twin.matrixAutoUpdate = false;
      // Parented to the SOURCE, so it inherits its world transform outright and
      // an identity local matrix is exactly right. (A skinned twin ignores this
      // and rides the skeleton, which is why sharing the bind matrix matters.)
      src.add(twin);
      hulls.push({ mesh: twin, src });
    }
    return { hulls, mat, root: sample.root, k: 0 };
  }

  private retire(h: Highlight): void {
    for (const hull of h.hulls) hull.mesh.removeFromParent();
    h.mat.dispose();
  }

  /** `samples` is every body in the bout. Anyone absent fades out and is
   *  retired, so the final whistle does not leave ten outlines in the water. */
  update(dt: number, samples: Iterable<AuraSample>): void {
    this.clock += dt;
    const live = new Set<number>();
    for (const s of samples) {
      live.add(s.id);
      let h = this.lit.get(s.id);
      // A character visual is rebuilt on a class/skin/mount swap, which orphans
      // the twins; rebuild against the new root rather than highlighting a body
      // that is no longer there.
      if (h && h.root !== s.root) {
        this.retire(h);
        h = undefined;
      }
      if (!h) {
        h = this.build(s);
        this.lit.set(s.id, h);
      }
      h.k = Math.min(1, h.k + dt / AURA_FADE);
      (h.mat.uniforms.uColor.value as THREE.Color).setHex(DG_TEAM_COLOR[s.team]);
      // A slow breath, and a faster harder one on the carrier.
      const rate = s.carrying ? 6.5 : 1.6;
      const depth = s.carrying ? 0.3 : 0.1;
      const pulse = (s.carrying ? 1.4 : 1) * (1 - depth + depth * Math.sin(this.clock * rate));
      h.mat.uniforms.uStrength.value = h.k * pulse * (s.isSelf ? AURA_SELF : 1);
      // Follow the body: a hidden mesh (culled, stealthed, a swapped form) must
      // not leave its outline hanging in the water.
      for (const hull of h.hulls) hull.mesh.visible = hull.src.visible;
    }

    for (const [id, h] of this.lit) {
      if (live.has(id)) continue;
      h.k -= dt / AURA_FADE;
      if (h.k > 0) {
        h.mat.uniforms.uStrength.value = Math.max(0, h.k);
        continue;
      }
      this.retire(h);
      this.lit.delete(id);
    }
  }

  dispose(): void {
    for (const [, h] of this.lit) this.retire(h);
    this.lit.clear();
  }
}
