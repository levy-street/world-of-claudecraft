// The three-side binding of the compile gate's piece cut (link_piece_core.ts):
// the material carriers of a gated root, grouped by material tuple and program
// variant, and the per-piece work the gate queue runs, one unit per group and
// one representative compile per group. Shared by the live entity gates
// (renderer.ts compileGate) and the streamed-decor reveal host
// (reveal_compile_host.ts): a town kit carries as many material groups as a
// composed crowd.

import type * as THREE from 'three';
import type { CompileGatePiece, PieceDeadline } from './compile_gate';
import { enumerateLinkPieces, linkPieceKey } from './link_piece_core';

type MaterialCarrier = THREE.Object3D & {
  isMesh?: boolean;
  isPoints?: boolean;
  isLine?: boolean;
  isSprite?: boolean;
  isSkinnedMesh?: boolean;
  isInstancedMesh?: boolean;
  isBatchedMesh?: boolean;
  instanceColor?: unknown;
  morphTexture?: unknown;
  _colorsTexture?: unknown;
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[] | null;
};

/** The object- and geometry-level inputs of three's program cache key
 *  (WebGLPrograms.getParameters, pinned three version): skinning, instancing
 *  and its colour/morph textures, batching and its colour texture, the
 *  points-uv path, the morph attribute set and count, and the geometry
 *  attributes the parameters read (normal, tangent, a 4-wide colour, uv,
 *  position). `receiveShadow` is a uniform, not a key input, so it is not
 *  here; neither is `castShadow`: the host's shadow arm swaps a depth twin
 *  onto EVERY mesh of the piece (casting is a runtime distance toggle), so a
 *  caster and a non-caster of one tuple and variant link exactly the same
 *  programs and share one piece. Every carrier has a geometry, so the
 *  attribute set is always part of the string (the plain static mesh is
 *  `Anup`). */
function programVariantOf(carrier: MaterialCarrier): string {
  let variant = '';
  if (carrier.isSkinnedMesh) variant += 's';
  if (carrier.isInstancedMesh) {
    variant += 'i';
    if (carrier.instanceColor) variant += 'c';
    if (carrier.morphTexture) variant += 'm';
  }
  if (carrier.isBatchedMesh) {
    variant += 'b';
    if (carrier._colorsTexture) variant += 'c';
  }
  if (carrier.isPoints) variant += 'p';
  const geometry = carrier.geometry;
  if (!geometry) return variant;
  const morph = geometry.morphAttributes;
  const morphSet = morph.position ?? morph.normal ?? morph.color;
  if (morphSet) {
    variant += `M${morph.position ? 'p' : ''}${morph.normal ? 'n' : ''}${morph.color ? 'c' : ''}${morphSet.length}`;
  }
  const attributes = geometry.attributes;
  const color = attributes.color;
  variant += `A${attributes.normal ? 'n' : ''}${attributes.tangent ? 't' : ''}${
    color && color.itemSize === 4 ? 'c' : ''
  }${attributes.uv ? 'u' : ''}${attributes.position ? 'p' : ''}`;
  return variant;
}

/** Exactly the nodes three's compile() prepares a material for
 *  (WebGLRenderer.compile: mesh, points, line or sprite with a material), so
 *  the pieces together cover the same programs the whole-root compile did. */
function pieceKeyOf(node: THREE.Object3D): string | null {
  const carrier = node as MaterialCarrier;
  if (!(carrier.isMesh || carrier.isPoints || carrier.isLine || carrier.isSprite)) return null;
  const material = carrier.material;
  if (!material) return null;
  return linkPieceKey(
    Array.isArray(material) ? material.map((item) => item.uuid) : [material.uuid],
    programVariantOf(carrier),
  );
}

/** The gated root's material carriers, one array per program group, in
 *  traversal order, the group's representative (its first carrier) first. */
export function linkPiecesOf(target: THREE.Object3D): THREE.Object3D[][] {
  return enumerateLinkPieces<THREE.Object3D, THREE.Object3D>(target, {
    traverse: (root, visit) => root.traverse(visit),
    pieceKey: pieceKeyOf,
  }).map((piece) => piece.meshes);
}

/** The piece's third arm: after both compiles resolved, poll every program
 *  variant the representative's materials carry (its own tuple plus the depth
 *  twins the shadow arm used) until each is ready or the piece's deadline
 *  fires, recording the ready ones for the touch tail
 *  (program_variant_settle.ts). */
export type PieceSettle = (node: THREE.Object3D, deadline: PieceDeadline) => Promise<unknown>;

/** One work function per piece: the representative's colour compile, then its
 *  shadow compile, then the settle over its variants, through the host's own
 *  per-object arms. The other nodes of the group share its programs (same
 *  material tuple, same variant), so compiling them would only repeat the
 *  whole-scene light walk for a cache hit. Nothing is reparented: each arm
 *  compiles the node in place. The first arm runs synchronously inside the
 *  work call, so the queue's syncMs (and the budget it feeds) sees the
 *  piece's compile prologue, as it saw the whole root's before. The settle
 *  gets the piece's own deadline, so its poll ends where the gate's timeout
 *  fires (the compiles themselves are never cut: a driver link is not
 *  cancellable), and a piece that settled proved every variant it carries. */
export function linkPieceWork(
  target: THREE.Object3D,
  compileColor: (node: THREE.Object3D) => Promise<unknown>,
  compileShadow: (node: THREE.Object3D) => Promise<unknown>,
  settle: PieceSettle,
): CompileGatePiece[] {
  return linkPiecesOf(target).map(
    ([representative]) =>
      (deadline) =>
        compileColor(representative)
          .then(() => compileShadow(representative))
          .then(() => settle(representative, deadline)),
  );
}
