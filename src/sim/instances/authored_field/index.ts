// Authored open-air instance fields (G9): terraces, paths, walls, props and
// light zones as one data record; height and collision derived from it.
export { authoredFieldCliffRuns, type FieldCliffRun, surfaceOutline } from './cliffs';
export { authoredFieldColliders, CLIFF_HALF_DEPTH } from './field_colliders';
export { authoredFieldHeight, authoredFieldSurfaceAt } from './height';
export { authoredFieldFor, instancedFieldHeight } from './registry';
export type {
  AuthoredFieldDef,
  FieldEdgeStyle,
  FieldGround,
  FieldLightZone,
  FieldProp,
  FieldSurface,
  FieldWall,
} from './types';
