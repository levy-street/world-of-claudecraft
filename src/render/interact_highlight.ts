// Hover highlight for interactables: a thin gold rim around whatever the mouse
// is over that the player could actually interact with (an NPC, a lootable
// corpse, a chest, a mailbox, a dungeon door, a gather node).
//
// Technique is the classic inverted hull, chosen because the game renders the
// world in ONE forward pass with no composer: a post-process outline would mean
// adding an EffectComposer to the main render path for a cosmetic cue, and a
// second full-scene pass is not a trade this renderer should make. Instead each
// mesh of the hovered subtree gains ONE shell child that shares its geometry
// (and, for a character, its skeleton and morph influences), drawn back-faces
// only and pushed along the view-space normal by a constant number of PIXELS.
// Where the source mesh covers the shell the depth test hides it, so only the
// silhouette survives.
//
// Cost is bounded by construction: exactly one hovered subtree exists at a time,
// shells are built only when the target CHANGES, geometry is shared (no copy, no
// GPU upload), and MAX_SHELLS caps a pathological rig. A shell is parented to
// its source mesh, so it inherits visibility for free: a hidden or
// distance-culled source draws no outline, and nothing has to track LOD state.
//
// Display-only and gameplay-neutral: it marks affordances the player already
// has (the hover cursor already changes over these), never information they act
// on, so it is safe under the graphics-fairness invariant.

import * as THREE from 'three';

/** Rim thickness, in screen pixels, held constant at any distance or FOV. */
const OUTLINE_WIDTH_PX = 1.3;

/** How far the shell is pushed AWAY from the camera, as a fraction of its view
 *  depth (so, like the width, it is scale-free).
 *
 *  This is what keeps the cue reading as a silhouette instead of line art. A
 *  character is many meshes, and each one's own rim survives the depth test
 *  against the parts BEHIND it: without this, a helmet, tabard and boots each
 *  get traced and the result is a gold sketch of the whole model rather than an
 *  outline around it. Sinking the shell a little into the scene lets those
 *  neighbours cover the interior seams while the true outer edge, which has only
 *  distant world behind it, still clears. Raising it thins the rim on
 *  shallow-angle surfaces before it removes any more seams. */
const OUTLINE_DEPTH_PUSH = 0.006;

/** Hard cap on shells per target. A character rig merges to a handful of
 *  meshes and a prop is one or two, so this only bounds a pathological subtree
 *  (and drops the tail rather than the whole outline). */
const MAX_SHELLS = 24;

/** Frames between re-attach checks (see reattachIfStale). Coarse on purpose: a
 *  gear swap or a late async build is a rare, non-urgent event, and a quarter
 *  second of missing rim is invisible next to paying for the walk every frame. */
const STALE_CHECK_FRAMES = 15;

/** Marks a shell in the scene graph, so a rebuild never outlines an outline. */
const OUTLINE_NAME = 'interactOutline';

// Back faces only, no depth write, so the shell never occludes the world or
// itself; depth TEST stays on so terrain and buildings hide an outline behind
// them, which is what keeps the cue "low key" instead of an x-ray.
//
// The vertex shader mirrors meshbasic's chunk order (r165) so skinning and morph
// targets deform the shell exactly like the source mesh. It deliberately does
// NOT use <defaultnormal_vertex>: that chunk flips the normal under FLIP_SIDED,
// which THREE defines for a BackSide material, and an inverted hull must expand
// OUTWARD. Expanding by (-mvPosition.z) makes the offset proportional to view
// depth, which is what holds the rim at a constant pixel width.
const VERTEX_SHADER = /* glsl */ `
#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
uniform float uWidth;
uniform float uDepthPush;
void main() {
  #include <morphinstance_vertex>
  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  vec3 outlineNormal = normalize( normalMatrix * objectNormal );
  vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
  mvPosition.xyz += outlineNormal * uWidth * ( -mvPosition.z );
  // View space looks down -Z, so subtracting moves the shell further away.
  mvPosition.z -= uDepthPush * ( -mvPosition.z );
  gl_Position = projectionMatrix * mvPosition;
}
`;

// Flat colour, converted to the output colour space so the authored hex is what
// reaches the screen. Tone mapping is deliberately skipped: the world runs
// ACES with a day/night exposure ramp, and an affordance cue that dimmed at
// dusk would be least readable exactly when the world is hardest to read.
const FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
void main() {
  gl_FragColor = vec4( uColor, uOpacity );
  #include <colorspace_fragment>
}
`;

function isOutlineableMesh(o: THREE.Object3D): o is THREE.Mesh {
  const mesh = o as THREE.Mesh & { isInstancedMesh?: boolean; isSprite?: boolean };
  if (!mesh.isMesh || mesh.isInstancedMesh || mesh.isSprite) return false;
  // A geometry with no normals cannot be expanded along one.
  return !!mesh.geometry?.getAttribute('normal');
}

export class InteractHighlight {
  private readonly material: THREE.ShaderMaterial;
  private readonly shells: THREE.Mesh[] = [];
  private target: THREE.Object3D | null = null;

  constructor(color = 0xffd75a, opacity = 0.7) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uWidth: { value: 0 },
        uDepthPush: { value: OUTLINE_DEPTH_PUSH },
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: opacity },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      // A cue, not scenery: the rim is a flat unlit colour, and distance fog
      // would grey it out exactly where a player most wants to spot what is
      // interactable.
      fog: false,
    });
  }

  /** Point the highlight at a subtree (an entity view group or a gather-node
   *  group), or clear it with null. Rebuilds only when the target changes, so
   *  calling this every frame with the same target is free. */
  setTarget(root: THREE.Object3D | null): void {
    if (root === this.target) return;
    this.clearShells();
    this.target = root;
    if (root) this.buildShells(root);
  }

  /** Drop the highlight if it is pointed at `root`. The renderer calls this
   *  when it tears a view down: the shells live INSIDE that subtree and borrow
   *  its geometry, so a disposed view must not be left holding them. */
  clearIfTarget(root: THREE.Object3D): void {
    if (this.target === root) this.setTarget(null);
  }

  /** Refresh the pixel-width uniform for this frame's camera + viewport. The
   *  offset is per unit of view depth, so it needs the projection's vertical
   *  scale (element 5 of the projection matrix) and the drawing-buffer height.
   *  Also re-attaches the shells if the subtree changed under them (below). */
  update(camera: THREE.PerspectiveCamera, viewportHeightPx: number): void {
    this.reattachIfStale();
    if (this.shells.length === 0) return;
    const projectionScale = camera.projectionMatrix.elements[5];
    if (!(projectionScale > 0) || !(viewportHeightPx > 0)) return;
    this.material.uniforms.uWidth.value =
      (OUTLINE_WIDTH_PX * 2) / (viewportHeightPx * projectionScale);
  }

  // The renderer can replace a view's meshes WITHOUT replacing the view: a gear,
  // skin or form swap disposes the old CharacterVisual and detaches its root
  // from the same group, and an async character build fills an initially empty
  // group a frame or two later. Either way the target object is unchanged, so
  // setTarget's identity check cannot see it, and the outline would either
  // vanish for good or never appear. This walks the parent chain of ONE shell
  // (a handful of links) on a coarse cadence and rebuilds when it no longer
  // reaches the target, which covers both cases with no bookkeeping in the
  // renderer.
  private staleCheckCountdown = 0;

  private reattachIfStale(): void {
    if (!this.target) return;
    if (this.staleCheckCountdown-- > 0) return;
    this.staleCheckCountdown = STALE_CHECK_FRAMES;
    const first = this.shells[0];
    if (first && this.reachesTarget(first)) return;
    const root = this.target;
    this.clearShells();
    this.buildShells(root);
  }

  private reachesTarget(shell: THREE.Object3D): boolean {
    for (let o: THREE.Object3D | null = shell.parent; o; o = o.parent) {
      if (o === this.target) return true;
    }
    return false;
  }

  private buildShells(root: THREE.Object3D): void {
    // COLLECT FIRST, then attach. Object3D.traverse reads a node's child list
    // AFTER running the callback on it, so attaching inside the callback feeds
    // each shell straight back into the walk: one cube became MAX_SHELLS nested
    // rims before this was split in two.
    const sources: THREE.Mesh[] = [];
    root.traverse((o) => {
      if (sources.length >= MAX_SHELLS || o.name === OUTLINE_NAME) return;
      if (isOutlineableMesh(o)) sources.push(o);
    });
    for (const source of sources) {
      const shell = this.makeShell(source);
      shell.name = OUTLINE_NAME;
      shell.castShadow = false;
      shell.receiveShadow = false;
      // Skinned source meshes disable frustum culling (their bounds are the bind
      // pose, not the animated one); the shell must match or it pops out at the
      // screen edge.
      shell.frustumCulled = source.frustumCulled;
      shell.renderOrder = source.renderOrder;
      // Parented to the source so it inherits its world matrix AND its
      // visibility: a hidden or LOD-swapped source silently draws no outline.
      source.add(shell);
      this.shells.push(shell);
    }
  }

  private makeShell(source: THREE.Mesh): THREE.Mesh {
    const skinned = source as THREE.SkinnedMesh;
    let shell: THREE.Mesh;
    if (skinned.isSkinnedMesh && skinned.skeleton) {
      const skinnedShell = new THREE.SkinnedMesh(source.geometry, this.material);
      // Share the skeleton rather than cloning it: the shell must deform on the
      // SAME bone matrices the source does, on the same frame, or the rim lags
      // the pose by a frame during fast animation.
      skinnedShell.bindMode = skinned.bindMode;
      skinnedShell.bind(skinned.skeleton, skinned.bindMatrix);
      shell = skinnedShell;
    } else {
      shell = new THREE.Mesh(source.geometry, this.material);
    }
    // Morph influences are shared by REFERENCE (same array object), so a face
    // or blend-shape change moves the rim with it and costs no per-frame copy.
    if (source.morphTargetInfluences) {
      shell.morphTargetInfluences = source.morphTargetInfluences;
      shell.morphTargetDictionary = source.morphTargetDictionary;
    }
    return shell;
  }

  private clearShells(): void {
    for (const shell of this.shells) shell.removeFromParent();
    // Geometry, skeletons and morph arrays are all BORROWED from the source
    // meshes, so a shell owns nothing to dispose; the one owned resource is the
    // shared material, released in dispose().
    this.shells.length = 0;
  }

  dispose(): void {
    this.clearShells();
    this.target = null;
    this.material.dispose();
  }
}
