/**
 * The piece cut of a compile gate: which nodes of a gated root share ONE
 * queue unit, and which one of them that unit compiles.
 *
 * A gate used to submit its whole root as one unit (one compileAsync of the
 * root, then the shadow arm). Drivers that compile a shader's source
 * synchronously at submission (Mesa on the Intel iGPU) then pay every
 * never-seen program of the root inside that one unit: a crowd of composed
 * players arriving in a live frame measured 500 to 711 ms of main thread on
 * its first `live-gate` unit, and the queue paces BETWEEN units, never inside
 * one. Three's compile() prepares materials only under the node it is given,
 * so compiling one node yields exactly that node's programs under the same
 * cache keys as compiling the root: cutting the root into one unit per
 * PROGRAM GROUP puts one program group per unit and hands the pacing back to
 * the queue.
 *
 * A group is the set of nodes sharing one piece key: the material tuple PLUS
 * the variant signature that changes a program (skinning, instancing, morph
 * targets, the geometry attributes three's program parameters read), in
 * traversal order. Nodes with the same key share exactly the same programs,
 * so a piece compiles ONE representative node, its first: the others would be
 * cache hits, each paying a whole-scene light walk for nothing. A node whose
 * key an earlier piece already covers joins that piece (it is not compiled),
 * a node with a new key opens the next piece, and a node without a material
 * belongs to no piece. Host-agnostic (RENDER_PURE_CORES,
 * tests/architecture.test.ts): the traversal and the key come from the
 * caller, so a plain Vitest drives it with stubs and compile_gate_pieces.ts
 * binds three's.
 */

export interface LinkPiece<M> {
  /** Every node of the group, the representative first. */
  meshes: M[];
}

export interface LinkPieceOptions<R, M> {
  /** Visits every node under `root`, root included, in traversal order. */
  traverse(root: R, visit: (node: M) => void): void;
  /** The node's piece key (linkPieceKey), or null when it carries no material. */
  pieceKey(node: M): string | null;
}

export function enumerateLinkPieces<R, M>(root: R, opts: LinkPieceOptions<R, M>): LinkPiece<M>[] {
  const pieces: LinkPiece<M>[] = [];
  const byKey = new Map<string, LinkPiece<M>>();
  opts.traverse(root, (node) => {
    const key = opts.pieceKey(node);
    if (key === null) return;
    const piece = byKey.get(key);
    if (piece) {
      piece.meshes.push(node);
      return;
    }
    const opened: LinkPiece<M> = { meshes: [node] };
    byKey.set(key, opened);
    pieces.push(opened);
  });
  return pieces;
}

/** A material tuple's identity from its per-material ids, order kept: two
 *  meshes wearing the same materials in a different slot order draw
 *  different groups. */
export function materialTupleKey(ids: readonly string[]): string {
  return ids.join('|');
}

/** A piece's identity: the material tuple plus the node's program variant
 *  signature (the tuple alone when the caller has no variant), so the same
 *  tuple on a skinned and on a static node draws two groups. */
export function linkPieceKey(materialIds: readonly string[], variant: string): string {
  return variant === ''
    ? materialTupleKey(materialIds)
    : `${materialTupleKey(materialIds)}#${variant}`;
}

/** The queue label of one piece: the gate's own label (its kind stays the
 *  head, so the budget's per-kind estimate is unchanged) plus the piece
 *  index after the root name. */
export function linkPieceLabel(gateLabel: string, index: number): string {
  return `${gateLabel}:${index}`;
}
