import type { Document, Node, Root } from '@gltf-transform/core';

/** Every node some scene reaches. */
export function reachableNodes(root: Root): Set<Node>;

/**
 * Move every animation channel that targets a sceneless node onto the in-scene
 * node of the same name, disposing the stale channel it replaces. Returns the
 * moved tracks as `clip:node.path` labels; throws on a missing or ambiguous
 * twin and on two orphan channels claiming one track.
 */
export function retargetOrphanChannels(doc: Document): string[];
