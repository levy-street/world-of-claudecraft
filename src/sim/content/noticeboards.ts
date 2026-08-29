// Interactable town noticeboards. The active WorldContent supplies this list,
// keeping entity spawn, static collision, and interaction under one authority.

import { EASTBROOK_LAYOUT } from '../eastbrook_layout';
import { FENBRIDGE_LAYOUT } from '../fenbridge_layout';
import {
  assertCanonicalEastbrookNoticeboardDef,
  type MusterBoardDef,
  type NoticeboardDef,
} from '../types';
import { AMBERFALL_ZONE } from './amberfall';
import { DRAKELANDS_ZONE } from './drakelands';
import { EVERGARDEN_ZONE } from './evergarden';
import { FARSHORE_ZONE } from './farshore';
import { FROSTVEIL_ZONE } from './frostveil';
import { GALECREST_ZONE } from './galecrest';
import { NIGHTBLOOM_ZONE } from './nightbloom';
import { PALMREACH_ZONE } from './palmreach';
import { REALM_ZONE } from './realm';
import { WILLOWFEN_ZONE } from './willowfen';
import { WRAITHWOOD_ZONE } from './wraithwood';
import { ZONE3_ZONE } from './zone3';

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

// Dawnrest Camp's board on the tutorial island (the Proving Shore): the same
// canonical board prop and interaction as Eastbrook's, so guild notices posted
// to the board surface reach the newest players too, where they are deciding
// who to travel with. Everything except id, entityId, placement and facing is
// the canonical shape the Sim's constructor asserts on every board.
const PROVING_SHORE_NOTICEBOARD = {
  id: 'proving_shore_noticeboard',
  // The reserved high-range static-service id one past Eastbrook's, so adding
  // a board never shifts the sequential entity allocator (see eastbrook_layout).
  entityId: 2_000_000_002,
  templateId: eastbrook.templateId,
  assetId: eastbrook.assetId,
  name: eastbrook.name,
  // Just south of the camp's south fence run, facing north at its gate, so
  // every recruit walking between the camp and the yard passes its face.
  // z 41 rather than 40 ON PURPOSE: the Wick-path streetlamp plan drops a
  // post at about (-311.8, 41.6), squarely on the board's old reading spot,
  // and the board's own collider clearance (colliders.ts
  // buildStreetlampPlacements' blocked probe, LAMP_CLEARANCE) is what
  // suppresses that post; the
  // authored gate lantern at (-320, 40) carries the light instead
  // (proving_shore.ts decorProps).
  x: -312,
  z: 41,
  rotation: 0,
  width: eastbrook.nativeDimensions.width,
  depth: eastbrook.nativeDimensions.depth,
  height: eastbrook.nativeDimensions.height,
  interactionRadius: eastbrook.interactionRadius,
  // The board is a solid collider, so walkers aim for the reading spot in
  // front of it rather than the board's own point (the Eastbrook pattern).
  frontStandingPoint: { x: -312, z: 42.5 },
} satisfies NoticeboardDef;

assertCanonicalEastbrookNoticeboardDef(PROVING_SHORE_NOTICEBOARD);

// -- One guild board per town (owner decision, 2026-08-25): every town's
// signpost opens the realm guild board (src/ui/hud/guild_board/), so each
// hub settlement gets the canonical Eastbrook board. Placement recipe: a few
// strides off the hub fire on the side AWAY from the town's Ravenpost perch
// (content/mailboxes.ts), 8 yards south of the hub centre facing north back
// at it (rotation 0, the Proving Shore pattern), reading spot 1.5 yards off
// the face. tests/noticeboard_placements.test.ts probes every board's ground
// and reading spot against the real terrain and colliders.
// entityIds are the reserved static-service range, sequential after the
// Proving Shore board; APPEND ONLY, never renumber (the allocator comment on
// PROVING_SHORE_NOTICEBOARD above).
function townBoard(
  id: string,
  entityId: number,
  x: number,
  z: number,
  rotation: number,
  frontStandingPoint: { x: number; z: number },
): NoticeboardDef {
  const def = {
    id,
    entityId,
    templateId: eastbrook.templateId,
    assetId: eastbrook.assetId,
    name: eastbrook.name,
    x,
    z,
    rotation,
    width: eastbrook.nativeDimensions.width,
    depth: eastbrook.nativeDimensions.depth,
    height: eastbrook.nativeDimensions.height,
    interactionRadius: eastbrook.interactionRadius,
    frontStandingPoint,
  } satisfies NoticeboardDef;
  assertCanonicalEastbrookNoticeboardDef(def);
  return def;
}

/** dz yards south of the hub fire (8 by default), dx east or west of it,
 *  facing north back at the fire. A town whose default spot clips an
 *  authored prop carries its probed nudge here (the placements test). */
function hubBoard(
  id: string,
  entityId: number,
  zone: { hub: { x: number; z: number } },
  dx: number,
  dz = -8,
): NoticeboardDef {
  const x = zone.hub.x + dx;
  const z = zone.hub.z + dz;
  return townBoard(id, entityId, x, z, 0, { x, z: z + 1.5 });
}

export const NOTICEBOARDS: readonly NoticeboardDef[] = Object.freeze([
  EASTBROOK_NOTICEBOARD,
  PROVING_SHORE_NOTICEBOARD,
  // Fenbridge: beside the civic muster board at the square's edge, facing
  // the civic centre like its neighbour (FENBRIDGE_LAYOUT civic).
  townBoard('fenbridge_noticeboard', 2_000_000_003, -11, 278, 0, { x: -11, z: 279.5 }),
  hubBoard('highwatch_noticeboard', 2_000_000_004, ZONE3_ZONE, -5),
  // Nudged west off the great tree's root ring (the placements probe).
  hubBoard('eldergleam_noticeboard', 2_000_000_005, REALM_ZONE, -12),
  hubBoard('wyrmwatch_noticeboard', 2_000_000_006, DRAKELANDS_ZONE, 5),
  // Nudged off the pass-side square furniture (the placements probe).
  hubBoard('icemantle_noticeboard', 2_000_000_007, FROSTVEIL_ZONE, -8, -10),
  hubBoard('lanternmere_noticeboard', 2_000_000_008, AMBERFALL_ZONE, -5),
  hubBoard('bridgemere_noticeboard', 2_000_000_009, WILLOWFEN_ZONE, -5),
  hubBoard('moonrest_noticeboard', 2_000_000_010, NIGHTBLOOM_ZONE, -5),
  hubBoard('gallowmere_noticeboard', 2_000_000_011, WRAITHWOOD_ZONE, 5),
  hubBoard('drifthaven_noticeboard', 2_000_000_012, PALMREACH_ZONE, -5),
  hubBoard('hedgewick_noticeboard', 2_000_000_013, EVERGARDEN_ZONE, 5),
  hubBoard('wickharbor_noticeboard', 2_000_000_014, GALECREST_ZONE, -5),
  hubBoard('gullhaven_noticeboard', 2_000_000_015, FARSHORE_ZONE, 5),
]);

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
