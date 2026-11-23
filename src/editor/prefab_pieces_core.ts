// Prefab pieces: split a placed Blender-built building (one GLB placement)
// into its kit pieces + hand-built shell, each an ordinary placement of a
// node of the building's parts GLB, so every piece can be moved, rotated,
// scaled or deleted on its own in Studio.
//
// Pure math over the generated manifest (src/editor/prefab_pieces.generated.ts,
// measured by the installer from the parts GLB): no DOM, no three, testable.
//
// Frames. The manifest is in MODEL yards of the building's parts GLB (the
// same frame as the building GLB: origin at the kit origin, y up). The
// renderer seats a placement by normalizing the model's largest dimension to
// TARGET_HEIGHT (2.2) and multiplying by the placement scale, so one model
// yard of the building is `kb = scale * 2.2 / maxDim` world yards, and a
// piece's local mesh (unscaled) gets its own `2.2 / maxDim_piece` factor.
import type { MapPlacement } from '../sim/map_doc';

export const PIECE_TARGET = 2.2;

export interface PrefabPieceDef {
  /** Catalogue id of the piece (a `#node:` path into the parts GLB). */
  assetId: string;
  /** Node world translation in model yards (root scale included). */
  x: number;
  y: number;
  z: number;
  /** Node yaw (radians, three's Y rotation). */
  rotY: number;
  /** Uniform node scale (x axis) and the y/z ratios to it. */
  s: number;
  sy: number;
  sz: number;
  /** The node's own unscaled mesh: largest extent and lowest y. */
  maxDim: number;
  minY: number;
}

export interface PrefabPiecesDef {
  /** The whole building's catalogue id, e.g. "tidehold/hall". */
  assetId: string;
  building: string;
  /** The building GLB's largest extent and lowest y (model yards). */
  maxDim: number;
  minY: number;
  /** The joined hand-built geometry (`#group:shell_`), composed in model
   *  space, or null when a building is kit pieces only. */
  shell: { assetId: string; maxDim: number; minY: number } | null;
  pieces: readonly PrefabPieceDef[];
}

export interface ExplodeOptions {
  /** Terrain height at a world point (yards); the building's seat. */
  groundAt: (x: number, z: number) => number;
  /** Placement cap headroom: how many placements may still be added. */
  room?: number;
}

/** Where the building's model origin sits in world space (its base is
 *  seated on the ground, so the origin is minY model yards above the seat,
 *  scaled), plus the authored y offset. */
export function buildingOriginY(
  p: Pick<MapPlacement, 'x' | 'z' | 'scale' | 'y' | 'detached' | 'groundY'>,
  def: Pick<PrefabPiecesDef, 'maxDim' | 'minY'>,
  groundAt: (x: number, z: number) => number,
): number {
  const kb = worldPerModelYard(p.scale, def.maxDim);
  const ground = p.detached ? (p.groundY ?? 0) : groundAt(p.x, p.z);
  return ground - def.minY * kb + (p.y ?? 0);
}

export function worldPerModelYard(scale: number, maxDim: number): number {
  return (scale * PIECE_TARGET) / (maxDim || 1);
}

/** The placements that reproduce `building` exactly, piece by piece. Every
 *  piece is DETACHED at its own frozen ground height so an upper-storey wall
 *  does not drop to the terrain; the shell keeps the building's transform. */
export function explodePrefab(
  building: MapPlacement,
  def: PrefabPiecesDef,
  opts: ExplodeOptions,
): MapPlacement[] {
  const out: MapPlacement[] = [];
  const kb = worldPerModelYard(building.scale, def.maxDim);
  const originY = buildingOriginY(building, def, opts.groundAt);
  const cos = Math.cos(building.rotY);
  const sin = Math.sin(building.rotY);
  // Per-axis building scale (the gizmo's scaleX/Y/Z) is uniform-only here:
  // a stretched building explodes with its uniform scale, which is the
  // 99% case (the Tidehold buildings ship at uniform placement scale).
  const base = (): Omit<MapPlacement, 'assetId' | 'x' | 'z' | 'rotY' | 'scale'> => ({
    collide: building.collide,
  });
  if (def.shell) {
    // The shell is composed in model space: same origin, same yaw, same
    // world-per-model-yard, so its scale is the maxDim ratio and its seat
    // puts the model origin back where the building's was.
    const scale = (kb * def.shell.maxDim) / PIECE_TARGET;
    out.push({
      ...base(),
      assetId: def.shell.assetId,
      x: building.x,
      z: building.z,
      rotY: building.rotY,
      scale,
      detached: true,
      groundY: originY + def.shell.minY * kb,
    });
  }
  for (const piece of def.pieces) {
    // Node translation, rotated by the building yaw into world (three's
    // rotation about +Y takes +x toward -z for a positive angle).
    const dx = piece.x * kb;
    const dz = piece.z * kb;
    const wx = building.x + dx * cos + dz * sin;
    const wz = building.z - dx * sin + dz * cos;
    // The piece's local mesh is normalized by its own maxDim; its world size
    // must be mesh * node scale * kb.
    const sw = piece.s * kb; // world yards per local mesh unit
    const scale = (sw * piece.maxDim) / PIECE_TARGET;
    const p: MapPlacement = {
      ...base(),
      assetId: piece.assetId,
      x: wx,
      z: wz,
      rotY: building.rotY + piece.rotY,
      scale,
      detached: true,
      // Seat: the renderer puts the model origin at groundY - minY*sy, and we
      // want it at the building origin + the node's y.
      groundY: originY + piece.y * kb + piece.minY * sw * piece.sy,
    };
    if (Math.abs(piece.sy - 1) > 1e-4) p.scaleY = piece.sy;
    if (Math.abs(piece.sz - 1) > 1e-4) p.scaleZ = piece.sz;
    out.push(p);
  }
  return opts.room !== undefined ? out.slice(0, Math.max(0, opts.room)) : out;
}
