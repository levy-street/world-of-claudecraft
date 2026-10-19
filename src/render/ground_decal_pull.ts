// A flat ground decal that must read through the tall meadow grass (round 10: Old
// Thatchgrin's scorched patches, the Murmurwick Candle's light pool and dancing shadows).
//
// Laid on the ground, such a decal sits under the grass blades and the grass hides it; laid
// above them, it floats over bare stone and paving. Instead each vertex is slid TOWARD THE
// CAMERA along its own view ray by a fixed distance. Sliding along the view ray leaves the
// decal exactly where it was on screen (the projection of a point does not change as it
// moves along the ray through the eye), so it still hugs the ground in every view; only its
// DEPTH comes forward, so the grass blades standing within that distance in front of it
// stop hiding it, while anything farther in front (a tree, a wall, a character between the
// camera and the decal) still does. The feet of whoever stands ON the decal fall within the
// pull and wear it, the way a shadow or a scorch would lie across them.
//
// Pure material plumbing: one extra vertex-shader statement per material, the pull a
// uniform, and a stable program cache key so every material sharing a key shares a program.
import type * as THREE from 'three';

/** Yards a decal's depth is pulled toward the eye: about the height of the meadow grass seen
 *  at a third-person angle. */
export const GROUND_DECAL_PULL = 1.1;

/**
 * Slide `material`'s vertices toward the camera along their view rays by `yards` (see the
 * header). Chains any onBeforeCompile already installed (call this LAST), and keys the
 * program by `key` plus the chained key so variants never share a program by mistake.
 */
export function pullDecalTowardCamera(
  material: THREE.Material,
  key: string,
  yards = GROUND_DECAL_PULL,
): void {
  const inner = material.onBeforeCompile.bind(material);
  // read the inner key NOW: the default key is the hook's own source text, which the
  // reassignment below would replace with this wrapper's
  const innerKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    inner(shader, renderer);
    shader.uniforms.decalPull = { value: yards };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float decalPull;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          float decalDist = length( mvPosition.xyz );
          mvPosition.xyz *= max( 0.05, 1.0 - decalPull / max( decalDist, 1e-3 ) );
          gl_Position = projectionMatrix * mvPosition;
        }`,
      );
  };
  material.customProgramCacheKey = () => `decal-pull:${key}:${innerKey}`;
}
