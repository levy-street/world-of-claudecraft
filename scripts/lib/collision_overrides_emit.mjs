// Shared emit + validation for the Collision Master override table: used by
// scripts/gen_collision_overrides.mjs (CLI) and the vite dev save endpoint
// (vite.config.ts collisionMasterSavePlugin), so both write byte-identical
// modules. Pure: no filesystem access here.

// A namespace segment plus one OR MORE path segments: two-segment ids like
// `props/well` and deeper nested-pack ids like `medieval_village_v2/environment/
// Bridge_01` both pass. Still requires a leading namespace and rejects empty,
// leading, or trailing segments.
const ASSET_ID_RE = /^[a-z0-9_]+(?:\/[a-z0-9_.-]+)+$/i;
const MAX_BOXES = 64;
// Raised from 16 for the authored Tidehold interiors: a multi-storey building
// needs a walkable deck per storey, and each one gets cut into pieces around
// its stair run so no (x,z) has two decks fighting over it. The runtime just
// iterates a plain array, so this is a sanity guard, not an engine limit.
const MAX_RAMPS = 24;
const MAX_MESHES = 24;
const MAX_MESH_VERTS = 3000; // xyz triplets flat length
const MAX_MESH_TRIS = 6000; // index triplets flat length

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round = (v, places = 4) => {
  const p = 10 ** places;
  return Math.round(v * p) / p;
};

/** Validate one override entry; returns an error string or null. */
export function validateOverride(assetId, o) {
  if (!ASSET_ID_RE.test(assetId)) return `bad asset id: ${assetId}`;
  if (!o || typeof o !== 'object') return `${assetId}: not an object`;
  if (o.mode !== 'baked' && o.mode !== 'basic' && o.mode !== 'none') {
    return `${assetId}: bad mode`;
  }
  if (o.shape !== undefined && o.shape !== 'square') return `${assetId}: bad shape`;
  if (o.radius !== undefined && !(isNum(o.radius) && o.radius > 0 && o.radius <= 60)) {
    return `${assetId}: bad radius`;
  }
  if (o.boxes !== undefined) {
    if (!Array.isArray(o.boxes) || o.boxes.length > MAX_BOXES) return `${assetId}: bad boxes`;
    for (const b of o.boxes) {
      if (
        !b ||
        !isNum(b.x) ||
        !isNum(b.y) ||
        !isNum(b.z) ||
        !isNum(b.hx) ||
        !isNum(b.hy) ||
        !isNum(b.hz) ||
        b.hx <= 0 ||
        b.hy <= 0 ||
        b.hz <= 0 ||
        Math.max(Math.abs(b.x), Math.abs(b.y), Math.abs(b.z)) > 100 ||
        Math.max(b.hx, b.hy, b.hz) > 60 ||
        (b.ry !== undefined && !isNum(b.ry))
      ) {
        return `${assetId}: bad box`;
      }
    }
  }
  if (o.ramps !== undefined) {
    // Collision Master authored walkable ramp decks: the placement raises the
    // walkable ground along the deck instead of blocking.
    if (!Array.isArray(o.ramps) || o.ramps.length > MAX_RAMPS) return `${assetId}: bad ramps`;
    for (const r of o.ramps) {
      if (
        !r ||
        !isNum(r.x) ||
        !isNum(r.z) ||
        !isNum(r.hx) ||
        !isNum(r.hz) ||
        !isNum(r.y0) ||
        !isNum(r.y1) ||
        r.hx <= 0 ||
        r.hz <= 0 ||
        Math.max(r.hx, r.hz) > 60 ||
        Math.max(Math.abs(r.x), Math.abs(r.z), Math.abs(r.y0), Math.abs(r.y1)) > 100 ||
        (r.ry !== undefined && !isNum(r.ry))
      ) {
        return `${assetId}: bad ramp`;
      }
    }
  }
  if (
    o.mode === 'baked' &&
    (!o.boxes || o.boxes.length === 0) &&
    (!o.ramps || o.ramps.length === 0)
  ) {
    return `${assetId}: baked override needs boxes or ramps`;
  }
  if (o.meshes !== undefined) {
    // Collision Master v3 authored meshes: the editor's editable truth (the
    // sim only reads the derived boxes). Same bounds as the editor sanitizer.
    if (!Array.isArray(o.meshes) || o.meshes.length > MAX_MESHES) {
      return `${assetId}: bad meshes`;
    }
    for (const m of o.meshes) {
      if (
        !m ||
        !Array.isArray(m.verts) ||
        !Array.isArray(m.tris) ||
        m.verts.length % 3 !== 0 ||
        m.tris.length % 3 !== 0 ||
        m.verts.length < 9 ||
        m.verts.length > MAX_MESH_VERTS ||
        m.tris.length > MAX_MESH_TRIS
      ) {
        return `${assetId}: bad mesh`;
      }
      const vertCount = m.verts.length / 3;
      for (const v of m.verts) {
        if (!isNum(v) || Math.abs(v) > 100) return `${assetId}: bad mesh vert`;
      }
      for (const t of m.tris) {
        if (!Number.isInteger(t) || t < 0 || t >= vertCount) return `${assetId}: bad mesh tri`;
      }
      if (m.ramp !== undefined && m.ramp !== true) return `${assetId}: bad mesh ramp flag`;
    }
  }
  return null;
}

/** Emit the generated TS module for an override map. Returns {source, errors}. */
export function emitCollisionOverridesModule(overrides) {
  const errors = [];
  const ids = Object.keys(overrides).sort();
  for (const id of ids) {
    const err = validateOverride(id, overrides[id]);
    if (err) errors.push(err);
  }
  const lines = [
    '// GENERATED from data/asset_collision_overrides.json - do not edit by hand.',
    "// Authored per-asset collision from the editor's Collision Master tool: the",
    '// dev server endpoint (/__collision_master/save) updates the JSON and this',
    '// module together; scripts/gen_collision_overrides.mjs regenerates it too.',
    "// An entry here is the asset's DEFAULT collision everywhere: authored boxes",
    '// beat the voxel bake (asset_collision.ts), and the mode/shape stamp fresh',
    '// placements (editor collision_defaults.ts).',
    '',
    "import type { AuthoredCollisionRamp, MapHitbox } from './map_doc';",
    '',
    'export interface AssetCollisionOverride {',
    "  /** Placement default: 'baked' renders the authored boxes, 'basic' a circle",
    "   *  or square footprint, 'none' no collision. */",
    "  mode: 'baked' | 'basic' | 'none';",
    '  /** basic-mode footprint shape; absent = circle. */',
    "  shape?: 'square';",
    '  /** basic-mode radius/half-extent in model-space yards at scale 1; absent =',
    '   *  the fitted/derived auto radius. */',
    '  radius?: number;',
    '  /** Authored boxes (normalized model space, optional per-box yaw). Read in',
    "   *  'baked' mode; they replace the asset's voxel-baked set. */",
    '  boxes?: readonly MapHitbox[];',
    '  /** Authored WALKABLE ramp decks: placements raise the walkable ground',
    '   *  along each deck instead of blocking (sim/placement_ramps.ts), so the',
    '   *  player walks up ramps exactly like baked stairs. */',
    '  ramps?: readonly AuthoredCollisionRamp[];',
    "  /** Collision Master's editable mesh volumes (model space, flat xyz vert",
    '   *  triplets + index triplets; `ramp` = a walkable deck volume). Editor-only',
    '   *  truth: reopening a session restores these exactly; `boxes`/`ramps`',
    '   *  above are the sim decomposition. */',
    '  meshes?: readonly { verts: readonly number[]; tris: readonly number[]; ramp?: boolean }[];',
    '}',
    '',
    'export const ASSET_COLLISION_OVERRIDES: Readonly<Record<string, AssetCollisionOverride>> = {',
  ];
  for (const id of ids) {
    const o = overrides[id];
    const parts = [`mode: '${o.mode}'`];
    if (o.shape === 'square') parts.push("shape: 'square'");
    if (o.radius !== undefined) parts.push(`radius: ${round(o.radius)}`);
    if (o.boxes !== undefined && o.boxes.length > 0) {
      const boxes = o.boxes
        .map((b) => {
          const fields = [
            `x: ${round(b.x)}`,
            `y: ${round(b.y)}`,
            `z: ${round(b.z)}`,
            `hx: ${round(b.hx)}`,
            `hy: ${round(b.hy)}`,
            `hz: ${round(b.hz)}`,
          ];
          if (b.ry !== undefined && b.ry !== 0) fields.push(`ry: ${round(b.ry)}`);
          return `{ ${fields.join(', ')} }`;
        })
        .join(', ');
      parts.push(`boxes: [${boxes}]`);
    }
    if (o.ramps !== undefined && o.ramps.length > 0) {
      const ramps = o.ramps
        .map((r) => {
          const fields = [
            `x: ${round(r.x)}`,
            `z: ${round(r.z)}`,
            `hx: ${round(r.hx)}`,
            `hz: ${round(r.hz)}`,
          ];
          if (r.ry !== undefined && r.ry !== 0) fields.push(`ry: ${round(r.ry)}`);
          fields.push(`y0: ${round(r.y0)}`, `y1: ${round(r.y1)}`);
          return `{ ${fields.join(', ')} }`;
        })
        .join(', ');
      parts.push(`ramps: [${ramps}]`);
    }
    if (o.meshes !== undefined && o.meshes.length > 0) {
      const meshes = o.meshes
        .map(
          (m) =>
            `{ verts: [${m.verts.map((v) => round(v)).join(', ')}], tris: [${m.tris.join(', ')}]${
              m.ramp === true ? ', ramp: true' : ''
            } }`,
        )
        .join(', ');
      parts.push(`meshes: [${meshes}]`);
    }
    lines.push(`  '${id}': { ${parts.join(', ')} },`);
  }
  lines.push('};', '');
  return { source: lines.join('\n'), errors };
}
