// Interactable town noticeboards. The active WorldContent supplies this list,
// keeping entity spawn, static collision, and interaction under one authority.

import { EASTBROOK_LAYOUT } from '../eastbrook_layout';
import { FENBRIDGE_LAYOUT } from '../fenbridge_layout';
import {
  assertCanonicalEastbrookNoticeboardDef,
  type MusterBoardDef,
  type NoticeboardDef,
} from '../types';

export type { NoticeboardDef } from '../types';

const eastbrook = EASTBROOK_LAYOUT.services.noticeboard;

const EASTBROOK_NOTICEBOARD = {
  id: eastbrook.id,
  entityId: eastbrook.entityId,
  templateId: eastbrook.templateId,
  assetId: eastbrook.assetId,
  name: eastbrook.name,
  x: eastbrook.position.x,
  z: eastbrook.position.z,
  rotation: eastbrook.rotation,
  width: eastbrook.nativeDimensions.width,
  depth: eastbrook.nativeDimensions.depth,
  height: eastbrook.nativeDimensions.height,
  interactionRadius: eastbrook.interactionRadius,
  frontStandingPoint: { ...eastbrook.frontStandingPoint },
} satisfies NoticeboardDef;

assertCanonicalEastbrookNoticeboardDef(EASTBROOK_NOTICEBOARD);

export const NOTICEBOARDS: readonly NoticeboardDef[] = Object.freeze([EASTBROOK_NOTICEBOARD]);

const fenbridgeMusterBoard = FENBRIDGE_LAYOUT.civic.musterBoard;

/** Non-interactive boards still live in active-world services so rendering,
 * capture evidence, and static collision all read the same optional record. */
export const MUSTER_BOARDS: readonly MusterBoardDef[] = Object.freeze([
  {
    id: fenbridgeMusterBoard.id,
    assetId: fenbridgeMusterBoard.assetId,
    x: fenbridgeMusterBoard.position.x,
    z: fenbridgeMusterBoard.position.z,
    rotation: fenbridgeMusterBoard.rotation,
    width: fenbridgeMusterBoard.nativeDimensions.width,
    depth: fenbridgeMusterBoard.nativeDimensions.depth,
    height: fenbridgeMusterBoard.nativeDimensions.height,
    frontStandingPoint: { ...fenbridgeMusterBoard.frontStandingPoint },
  } satisfies MusterBoardDef,
]);

/** Resolve only an authored active-world board and validate any untyped boundary. */
export function noticeboardDefByEntityId(
  definitions: readonly NoticeboardDef[] | undefined,
  entityId: number,
): NoticeboardDef | null {
  const definition = definitions?.find((candidate) => candidate.entityId === entityId);
  if (!definition) return null;
  assertCanonicalEastbrookNoticeboardDef(definition);
  return definition;
}
