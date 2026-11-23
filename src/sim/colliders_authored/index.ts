// Public surface of the authored-map collider modules (Studio's additions to
// the static collider build), consumed by colliders.ts. See ./CLAUDE.md.
export { type BoomPushOut, CAMERA_BOOM_STEP, cameraBoomClearDistance } from './camera_boom';
export { passesUnder } from './pass_under';
export {
  emitPlacementBoxes,
  emitPlacementPrisms,
  pushColliderVolumeColliders,
  pushPlacementColliders,
} from './placement_colliders';
export { insidePrism, prismBox, prismPolyAt, pushOutPrism } from './prism';
