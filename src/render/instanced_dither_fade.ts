// The dithered camera ghost for ONE instance of an InstancedMesh (world trees,
// Yumi maze wall stubs, battleground placements), the per-instance twin of
// occluder_dither_fade.ts. The instance stays in its batch and drops fragments
// on the shared Bayer pattern from a per-instance attribute read inside the
// SOURCE material's one program: no zero-scale swap, no pooled stand-in, no
// transparent clone, so no second program to prewarm or gate.
//
// The attribute carries the HIDE amount (1 - alpha), never the fade: a material
// wearing this layer also draws geometries that lack the attribute (prewarm
// twins, other batches of the same material), and WebGL feeds a missing
// attribute as 0, which must read "fully drawn".
//
// Depth materials are never decorated, so a ghosted instance keeps its shadow,
// like a ghosted building does.
import * as THREE from 'three';
import {
  ditherFadeEnabled,
  GHOST_DITHER_ANCHOR,
  ghostDitherDiscardGlsl,
} from './occluder_dither_fade';

const PROGRAM_CACHE_KEY = 'instanced-ghost-dither-v1';
const VERTEX_ANCHOR = '#include <begin_vertex>';

export const GHOST_HIDE_ATTRIBUTE = 'aGhostHide';

// USE_INSTANCING only reaches the vertex stage, so the varying is declared and
// written on every variant: a plain Mesh of the same material links and draws
// fully.
const VERTEX_DECLARATION = `#ifdef USE_INSTANCING
  attribute float ${GHOST_HIDE_ATTRIBUTE};
#endif
varying float vGhostHide;
`;
const VERTEX_WRITE = `${VERTEX_ANCHOR}
#ifdef USE_INSTANCING
  vGhostHide = ${GHOST_HIDE_ATTRIBUTE};
#else
  vGhostHide = 0.0;
#endif`;
const FRAGMENT_DECLARATION = 'varying float vGhostHide;\n';
const FRAGMENT_DISCARD = `${GHOST_DITHER_ANCHOR}${ghostDitherDiscardGlsl('( 1.0 - vGhostHide )')}`;

// The userData stamp survives clone() while the hook functions do not, so
// "already attached" is tracked apart from "the source carried it".
const decorated = new WeakSet<THREE.Material>();

/** Chain the per-instance screen-door layer onto a batch material. Attach it
 *  where the material is made, ahead of every compile. Idempotent. */
export function attachInstancedDitherFade<T extends THREE.Material>(material: T): T {
  if (decorated.has(material)) return material;
  const previousCompile = material.onBeforeCompile.bind(material);
  // Three's default key is the CURRENT hook's source, which is this layer's
  // once it is installed: snapshot the previous hook's source instead.
  const previousSource = material.onBeforeCompile.toString();
  const previousCacheKey = Object.hasOwn(material, 'customProgramCacheKey')
    ? material.customProgramCacheKey.bind(material)
    : null;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile(shader, renderer);
    shader.vertexShader = `${VERTEX_DECLARATION}${shader.vertexShader}`.replace(
      VERTEX_ANCHOR,
      VERTEX_WRITE,
    );
    shader.fragmentShader = `${FRAGMENT_DECLARATION}${shader.fragmentShader}`.replace(
      GHOST_DITHER_ANCHOR,
      FRAGMENT_DISCARD,
    );
  };
  material.customProgramCacheKey = () =>
    `${previousCacheKey ? previousCacheKey() : previousSource}|${PROGRAM_CACHE_KEY}`;
  material.userData.instancedDitherFade = PROGRAM_CACHE_KEY;
  decorated.add(material);
  material.needsUpdate = true;
  return material;
}

/** `attachInstancedDitherFade` when the dithered ghost is the page's style,
 *  the material untouched otherwise. */
export function withInstancedDitherFade<T extends THREE.Material>(material: T): T {
  return ditherFadeEnabled() ? attachInstancedDitherFade(material) : material;
}

export function hasInstancedDitherFade(material: THREE.Material): boolean {
  return (
    (material.userData as { instancedDitherFade?: string }).instancedDitherFade ===
    PROGRAM_CACHE_KEY
  );
}

/** Re-attach the layer to a clone whose userData records it (see
 *  material_clone_hooks.ts). */
export function reapplyInstancedDitherFadeToClone<T extends THREE.Material>(clone: T): T {
  if (!hasInstancedDitherFade(clone)) return clone;
  return attachInstancedDitherFade(clone);
}

const shells = new WeakSet<THREE.BufferGeometry>();

/**
 * The geometry one hideable batch draws with. A per-instance attribute belongs
 * to a geometry, and one source geometry feeds many batches (foliage shares a
 * part's geometry across every bucket), so each batch gets a SHELL: the same
 * attribute and index OBJECTS (three keys GPU buffers on the object, so
 * nothing uploads twice) plus its own hide attribute. Never `clone()`, which
 * deep-copies. Returns `source` itself on the blended style. A consumer that
 * disposes its batches releases the shell with `disposeGhostHideGeometry`;
 * foliage never disposes a tree batch (they live as long as the renderer), so
 * its shells ride that lifetime too.
 */
export function ghostHideGeometry(
  source: THREE.BufferGeometry,
  count: number,
): THREE.BufferGeometry {
  if (!ditherFadeEnabled()) return source;
  // Bounds computed once on the source, not once per shell.
  if (source.boundingSphere === null) source.computeBoundingSphere();
  if (source.boundingBox === null) source.computeBoundingBox();
  const shell = new THREE.BufferGeometry();
  shell.name = source.name;
  shell.index = source.index;
  for (const name in source.attributes) shell.setAttribute(name, source.attributes[name]);
  shell.morphAttributes = { ...source.morphAttributes };
  shell.morphTargetsRelative = source.morphTargetsRelative;
  for (const g of source.groups) shell.addGroup(g.start, g.count, g.materialIndex);
  shell.setDrawRange(source.drawRange.start, source.drawRange.count);
  shell.boundingSphere = source.boundingSphere?.clone() ?? null;
  shell.boundingBox = source.boundingBox?.clone() ?? null;
  // Shared-flagged so a generic per-view disposal skips it: disposing a shell
  // with the source's attributes attached deletes THEIR GPU buffers under
  // every live sibling. `disposeGhostHideGeometry` is its one way out.
  shell.userData = { ...source.userData, sharedRendererResource: true };
  shell.setAttribute(
    GHOST_HIDE_ATTRIBUTE,
    new THREE.InstancedBufferAttribute(new Float32Array(count), 1),
  );
  shells.add(shell);
  return shell;
}

/**
 * Release a shell's own GPU state (its hide buffer and vertex array objects).
 * Three's geometry dispose removes the buffer of EVERY attribute still
 * attached, so the shared ones are detached first. No-op on anything that is
 * not a shell.
 */
export function disposeGhostHideGeometry(geometry: THREE.BufferGeometry): void {
  if (!shells.delete(geometry)) return;
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== GHOST_HIDE_ATTRIBUTE) geometry.deleteAttribute(name);
  }
  geometry.index = null;
  geometry.morphAttributes = {};
  geometry.dispose();
}

/** The hide attribute of a batch, or null when its geometry is not a shell. */
export function ghostHideAttribute(
  mesh: THREE.InstancedMesh,
): THREE.InstancedBufferAttribute | null {
  const attribute = mesh.geometry.getAttribute(GHOST_HIDE_ATTRIBUTE);
  return (attribute as THREE.InstancedBufferAttribute | undefined) ?? null;
}

/** Write one instance's fade alpha (1 = fully drawn). One float uploaded. */
export function writeInstanceGhostAlpha(
  mesh: THREE.InstancedMesh,
  index: number,
  alpha: number,
): void {
  const attribute = ghostHideAttribute(mesh);
  if (!attribute) return;
  // Rounded to the stored precision so a held ghost compares equal and
  // uploads nothing.
  const hide = Math.fround(1 - alpha);
  if (attribute.array[index] === hide) return;
  attribute.array[index] = hide;
  attribute.addUpdateRange(index, 1);
  attribute.needsUpdate = true;
}

export const instancedDitherFadeInternalsForTest = {
  programCacheKey: PROGRAM_CACHE_KEY,
};
