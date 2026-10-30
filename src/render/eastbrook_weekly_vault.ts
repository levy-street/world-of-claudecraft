// Static stone hall. Built before the town's reveal roots are registered, so
// the existing town GPU gate prepares every mesh and its occluder-fade twin.
//
// Its surfaces wear the town's surface atlas (eastbrook_surface_atlas.ts),
// tiled at world scale with grime toward the footing, a value shift per
// quarried block and a gently settled shape (eastbrook_surface_dressing.ts):
// the hall used to draw as flat vertex colour with no texture or relief at
// all. The SHAPE is unchanged (WEEKLY_VAULT_TRIANGLES, the boxes the Studio
// placeable model `vault.glb` was exported from); the drawn hall subdivides
// faces larger than one texture repeat so the pattern can tile and the roof
// can sag (WEEKLY_VAULT_DRAWN_TRIANGLES).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EASTBROOK_LAYOUT, localToWorld } from '../sim/eastbrook_layout';
import {
  EASTBROOK_SURFACE_CELLS,
  type EastbrookAtlasTextures,
  type EastbrookSurfaceSemantic,
  eastbrookAtlasPartMaterial,
  eastbrookSurfaceAtlasTexture,
  eastbrookSurfaceNormalTexture,
  eastbrookSurfaceRoughnessTexture,
} from './eastbrook_surface_atlas';
import {
  dressEastbrookSurface,
  EASTBROOK_BLOCK_VALUE_SPREAD,
  EASTBROOK_BUILDING_GRIME,
} from './eastbrook_surface_dressing';
import type { SurfaceTileMode } from './eastbrook_surface_tiling_core';
import { type OccluderFadeMat, occluderFadeRecordFor } from './occluder_fade';
import { activeWorldPromoted } from './promoted_scenery_gate';
import {
  type ShapeImperfectionAmplitudes,
  type ShapeImperfectionFrame,
  TOWN_BUILDING_IMPERFECTION,
} from './town_shape_imperfection_core';

// The authored shape's triangle count, pinned against the generated geometry
// by weekly_vault_building.test.ts and against the exported `vault.glb` by
// eastbrook_vault_placement.test.ts (the same boxes, triangle for triangle).
export const WEEKLY_VAULT_TRIANGLES = 4572;
// What the town draws: the same shape with every face larger than one atlas
// repeat clipped along the repeat grid (and the footing band split for its
// grime). Pinned by weekly_vault_building.test.ts.
export const WEEKLY_VAULT_DRAWN_TRIANGLES = 5698;

/** One modelled piece of a material group: what it wears and how it maps. */
interface VaultPiece {
  geometry: THREE.BufferGeometry;
  /** The atlas cell, or one per face from its normal (slate roofs vs panels). */
  semantic: EastbrookSurfaceSemantic | ((ny: number) => EastbrookSurfaceSemantic);
  /** 'island' (the default: a block keeps its own patch, larger faces tile),
   *  'fit' (hidden: one stretched repeat, no subdivision), or one per face. */
  mode: SurfaceTileMode | ((ny: number) => SurfaceTileMode);
  /** Floors and tops (|n.y| over 0.95) take 'fit': under a roof or a slab. */
  flatFit?: boolean;
}

const HIDDEN_FLAT = 0.95;

/** A heavy ashlar hall settles less than a timber house: about a third of a
 *  degree of lean, a 4 cm bow, the full 0.15 yd ridge sag. The art stays
 *  inside the hall's declared 14 x 12 footing (weekly_vault_building.test.ts). */
export const WEEKLY_VAULT_IMPERFECTION: Readonly<ShapeImperfectionAmplitudes> = Object.freeze({
  ...TOWN_BUILDING_IMPERFECTION,
  leanRadians: 0.006,
  bowYards: 0.04,
  wobbleYards: 0.02,
});

function slateSemantic(ny: number): EastbrookSurfaceSemantic {
  // a slope is roof; an upright slate panel reads as dressed dark stone
  return Math.abs(ny) > 0.3 && Math.abs(ny) < HIDDEN_FLAT
    ? 'cobaltRoofShingles'
    : 'irregularDarkStone';
}

/** Merge one material group's pieces into a soup with per-triangle cells and
 *  modes, paint its vertex colour, and dress it in the hall's frame. */
function dressedGroupGeometry(
  pieces: readonly VaultPiece[],
  hex: number,
  frame: ShapeImperfectionFrame,
  transform?: THREE.Matrix4,
): THREE.BufferGeometry {
  const soups = pieces.map((piece) => {
    const soup = piece.geometry.index ? piece.geometry.toNonIndexed() : piece.geometry;
    // keep only the attributes the town contract carries (BoxGeometry's uv is
    // replaced by the dressing's own)
    for (const name of Object.keys(soup.attributes)) {
      if (name !== 'position' && name !== 'normal') soup.deleteAttribute(name);
    }
    if (transform) soup.applyMatrix4(transform);
    return soup;
  });
  const cells: number[] = [];
  const modes: SurfaceTileMode[] = [];
  for (let index = 0; index < pieces.length; index++) {
    const piece = pieces[index];
    const normal = soups[index].getAttribute('normal');
    const triangles = soups[index].getAttribute('position').count / 3;
    for (let triangle = 0; triangle < triangles; triangle++) {
      const ny =
        (normal.getY(triangle * 3) +
          normal.getY(triangle * 3 + 1) +
          normal.getY(triangle * 3 + 2)) /
        3;
      const semantic = typeof piece.semantic === 'function' ? piece.semantic(ny) : piece.semantic;
      cells.push(EASTBROOK_SURFACE_CELLS[semantic]);
      // undersides are never seen, flats under a roof or slab hardly
      const mode = typeof piece.mode === 'function' ? piece.mode(ny) : piece.mode;
      modes.push(ny < -HIDDEN_FLAT || (piece.flatFit && Math.abs(ny) > HIDDEN_FLAT) ? 'fit' : mode);
    }
  }
  const merged = mergeGeometries(soups, false);
  if (!merged) throw new Error('Eastbrook Weekly Vault could not merge a material group');
  for (const soup of new Set([...soups, ...pieces.map((piece) => piece.geometry)])) soup.dispose();
  const count = merged.getAttribute('position').count;
  const tint = new THREE.Color(hex);
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index++) {
    colors[index * 3] = tint.r;
    colors[index * 3 + 1] = tint.g;
    colors[index * 3 + 2] = tint.b;
  }
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const dressed = dressEastbrookSurface(merged, {
    key: EASTBROOK_LAYOUT.weeklyVault.id,
    frame,
    shape: WEEKLY_VAULT_IMPERFECTION,
    grime: EASTBROOK_BUILDING_GRIME,
    valueSpread: 0,
    tiling: {
      cellOfTriangle: (index) => cells[index],
      modeOfTriangle: (index) => modes[index],
      islandValueSpread: EASTBROOK_BLOCK_VALUE_SPREAD,
    },
  });
  merged.dispose();
  return dressed;
}

/** The hall's settled-shape frame in its own coordinates (the door is +z, the
 *  base at the entrance ground, the pediment ridge running front to back). */
function vaultFrame(): ShapeImperfectionFrame {
  return {
    centerX: 0,
    centerZ: 0,
    yaw: 0,
    halfWidth: 7,
    halfDepth: 6,
    baseY: 0,
    height: 12.4,
    eaveY: 8.0,
    ridgeAxis: 'z',
  };
}

/** Door assembly reused by the independent stone hall. Built in the door's own
 *  frame and carried into the hall's by `placement`, so the hall's settled
 *  shape moves it with the facade it hangs on. */
function buildVaultDoor(
  placement: THREE.Matrix4,
  frame: ShapeImperfectionFrame,
  textures: EastbrookAtlasTextures,
  mats: OccluderFadeMat[],
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'eastbrookWeeklyVault';
  const stone: VaultPiece[] = [];
  const steel: VaultPiece[] = [];
  const brass: VaultPiece[] = [];
  // Metal trim is thin rails, rings and studs: one stretched patch of its
  // plate reads as forged metal, and a repeat grid would only shred it.
  const piece = (
    geometry: THREE.BufferGeometry,
    semantic: EastbrookSurfaceSemantic,
  ): VaultPiece => ({
    geometry,
    semantic,
    mode: semantic === 'mediumGrayStone' ? 'island' : 'fit',
  });
  const box = (
    parts: VaultPiece[],
    semantic: EastbrookSurfaceSemantic,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
  ) => {
    parts.push(piece(new THREE.BoxGeometry(w, h, d).translate(x, y, z), semantic));
  };
  // The hall's shared solid footprint owns collision; the door is facade trim.
  box(stone, 'mediumGrayStone', 5.8, 5.6, 0.22, 0, 2.8, -0.1);
  box(steel, 'darkForgedMetal', 4.8, 4.9, 0.12, 0, 2.6, -0.01);
  const ring = (radius: number, tube: number, y: number, z: number) =>
    new THREE.TorusGeometry(radius, tube, 6, 48).translate(0, y, z);
  brass.push(piece(ring(2.12, 0.1, 2.6, 0.06), 'warmGoldMetal'));
  steel.push(
    piece(
      new THREE.CylinderGeometry(1.98, 1.98, 0.1, 48).rotateX(Math.PI / 2).translate(0, 2.6, 0.07),
      'darkForgedMetal',
    ),
  );
  brass.push(piece(ring(1.78, 0.035, 2.6, 0.13), 'warmGoldMetal'));
  brass.push(piece(ring(0.55, 0.065, 2.6, 0.15), 'warmGoldMetal'));
  steel.push(
    piece(
      new THREE.CylinderGeometry(0.25, 0.25, 0.11, 16).rotateX(Math.PI / 2).translate(0, 2.6, 0.16),
      'darkForgedMetal',
    ),
  );
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    const spoke = new THREE.BoxGeometry(0.075, 1.1, 0.07).rotateZ(angle).translate(0, 2.6, 0.15);
    brass.push(piece(spoke, 'warmGoldMetal'));
  }
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    brass.push(
      piece(
        new THREE.CylinderGeometry(0.07, 0.07, 0.08, 6)
          .rotateX(Math.PI / 2)
          .translate(Math.cos(a) * 1.92, 2.6 + Math.sin(a) * 1.92, 0.14),
        'warmGoldMetal',
      ),
    );
  }
  for (const x of [-2.65, 2.65]) {
    box(brass, 'warmGoldMetal', 0.18, 5.2, 0.1, x, 2.7, 0.05);
    for (const y of [1.35, 3.8]) box(steel, 'darkForgedMetal', 0.55, 0.35, 0.16, x * 0.78, y, 0.08);
  }
  box(brass, 'warmGoldMetal', 5.6, 0.2, 0.1, 0, 5.4, 0.04);
  const groups = [
    { parts: stone, color: 0x77736c, metalness: 0, roughness: 0.95 },
    { parts: steel, color: 0x28353b, metalness: 0.7, roughness: 0.5 },
    { parts: brass, color: 0xc4a15b, metalness: 0.75, roughness: 0.35 },
  ];
  for (const { parts, color, metalness, roughness } of groups) {
    const geometry = dressedGroupGeometry(parts, color, frame, placement);
    const material = eastbrookAtlasPartMaterial({ metalness, roughness }, textures);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    occluderFadeRecordFor(mats, material, mesh);
  }
  return root;
}

/** Ashlar hall with buttressed towers, stepped cornices and a temple pediment.
 * Geometry is merged by material before joining the town reveal/fade service. */
export function buildEastbrookWeeklyVault(groundAt: (x: number, z: number) => number) {
  const layout = EASTBROOK_LAYOUT.weeklyVault;
  const group = new THREE.Group();
  group.name = 'eastbrookBuilding:eastbrook_weekly_vault';
  group.userData.eastbrookBuildingId = layout.id;
  group.userData.position = { x: layout.x, z: layout.z };
  group.userData.rotation = layout.rot;
  group.userData.target = { width: layout.w, depth: layout.d, height: layout.height };
  group.userData.front = layout.keeper;
  const mats: OccluderFadeMat[] = [];
  const colors = [0x626b74, 0x969b9c, 0xb8b9b2, 0x29465c, 0xc5a263];
  // each group's default cell: dark stone, mid granite, pale granite, slate, brass
  const groupSemantics: readonly (
    | EastbrookSurfaceSemantic
    | ((ny: number) => EastbrookSurfaceSemantic)
  )[] = ['darkStoneBlocks', 'mediumGrayStone', 'lightGrayStone', slateSemantic, 'warmGoldMetal'];
  // stone and slate keep their blocks' own patches (tiling past one repeat);
  // the brass trim is thin rails and studs, one stretched patch each
  const groupModes: readonly SurfaceTileMode[] = ['island', 'island', 'island', 'island', 'fit'];
  const parts: VaultPiece[][] = colors.map(() => []);
  const add = (
    m: number,
    geometry: THREE.BufferGeometry,
    options: Partial<Omit<VaultPiece, 'geometry'>> = {},
  ) =>
    parts[m].push({
      geometry,
      semantic: options.semantic ?? groupSemantics[m],
      mode: options.mode ?? groupModes[m],
      flatFit: options.flatFit,
    });
  const box = (
    m: number,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    options: Partial<Omit<VaultPiece, 'geometry'>> = {},
  ) => add(m, new THREE.BoxGeometry(w, h, d).translate(x, y, z), options);
  const entrance = localToWorld(layout, layout.rot, 0, layout.d / 2);
  const y = groundAt(entrance.x, entrance.z);
  // A document that owns the vault as a placement (promotedScenery.eastbrookVault)
  // draws and moves that one. The town keeps the hall's slot, so its building
  // lists stay aligned, but the slot is an empty group with nothing to fade.
  if (activeWorldPromoted('eastbrookVault')) {
    group.name = 'eastbrookWeeklyVaultStoodDown';
    return { group, hideTarget: vaultHideTarget(group, mats, y) };
  }
  // Substantial buried footing covers the site's shallow grade without floating edges.
  box(0, 14, 1.8, 12, 0, -0.55, 0, { flatFit: true });
  // The core is seen only through the mortar joints between the ashlar faces.
  box(0, 13.5, 7.8, 11.4, 0, 4, 0, { mode: 'fit' });
  // Surface-only ashlar keeps mortar joints crisp without spending triangles on
  // five buried faces per block. Subtle variation avoids a checkerboard facade.
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 8; col++) {
      const x = -5.94 + col * 1.69;
      for (const side of [-1, 1])
        add(
          (row * 3 + col * 7) % 11 === 0 ? 2 : 1,
          new THREE.PlaneGeometry(1.64, 0.73)
            .rotateY(side === 1 ? 0 : Math.PI)
            .translate(x, 0.7 + row * 0.77, side * 5.82),
        );
    }
    for (let col = 0; col < 7; col++) {
      const z = -4.8 + col * 1.6;
      for (const side of [-1, 1])
        add(
          (row * 3 + col * 7) % 11 === 0 ? 2 : 1,
          new THREE.PlaneGeometry(1.55, 0.73)
            .rotateY((side * Math.PI) / 2)
            .translate(side * 6.78, 0.7 + row * 0.77, z),
        );
    }
  }
  // Corner pavilions: pale quoins, deep blue inset panels and slate crown roofs.
  for (const x of [-5.85, 5.85])
    for (const z of [-4.85, 4.85]) {
      box(1, 2.2, 10.2, 2.2, x, 5.1, z, { semantic: 'lightStoneBlocks', flatFit: true });
      for (const h of [0.7, 3.1, 7.9, 10]) box(2, 2.3, 0.3, 2.3, x, h, z, { flatFit: true });
      box(2, 2.3, 0.25, 2.3, x, 10.4, z, { flatFit: true });
      add(3, new THREE.ConeGeometry(1.6, 1.7, 4).rotateY(Math.PI / 4).translate(x, 11.35, z));
      box(4, 0.16, 0.65, 0.16, x, 12.35, z);
      for (const side of [-1, 1]) {
        box(4, 1.1, 2.55, 0.08, x, 6.05, z + side * 1.12);
        box(3, 0.94, 2.39, 0.08, x, 6.05, z + side * 1.17);
        box(4, 0.08, 2.2, 0.06, x, 6.05, z + side * 1.22);
      }
    }
  // A copper-edged slate gable gives the hall a readable silhouette from above.
  box(2, 13.9, 0.4, 11.9, 0, 8.2, 0, { flatFit: true });
  box(1, 13.4, 0.65, 11.4, 0, 8.7, 0, { semantic: 'lightStoneBlocks', flatFit: true });
  box(2, 13.8, 0.25, 11.8, 0, 9.1, 0, { flatFit: true });
  const pediment = new THREE.Shape();
  pediment.moveTo(-4.7, 0);
  pediment.lineTo(4.7, 0);
  pediment.lineTo(0, 2.8);
  pediment.closePath();
  // The roof: its slopes tile the shingles; its upright end caps sit behind
  // the pale pediments and its floor on the slab, so neither is subdivided.
  add(
    3,
    new THREE.ExtrudeGeometry(pediment, { depth: 10.8, bevelEnabled: false }).translate(
      0,
      9.2,
      -5.4,
    ),
    { mode: (ny) => (Math.abs(ny) < 0.3 ? 'fit' : 'island') },
  );
  for (const z of [-5.65, 5.65]) {
    add(
      2,
      new THREE.ExtrudeGeometry(pediment, { depth: 0.18, bevelEnabled: false }).translate(
        0,
        9.2,
        z,
      ),
    );
    for (const side of [-1, 1])
      add(
        4,
        new THREE.BoxGeometry(5.55, 0.16, 0.16)
          .rotateZ(-side * Math.atan2(2.8, 4.7))
          .translate(side * 2.35, 10.6, z + 0.22),
      );
  }
  box(4, 0.18, 0.18, 11.5, 0, 12.07, 0);
  // Monumental portal: paired stone columns, stepped capitals and a carved arch.
  for (const x of [-4.2, 4.2]) {
    box(2, 1.0, 0.5, 0.7, x, 0.6, 5.77);
    box(1, 0.66, 6.7, 0.55, x, 4.0, 5.8);
    box(2, 0.22, 6.3, 0.13, x, 4.0, 6.12);
    box(2, 1.0, 0.4, 0.7, x, 7.5, 5.77);
    box(4, 1.02, 0.12, 0.72, x, 7.75, 5.77);
  }
  for (let i = 0; i < 13; i++) {
    const a = (i / 12) * Math.PI;
    add(
      2,
      new THREE.BoxGeometry(0.86, 0.55, 0.3)
        .rotateZ(a - Math.PI / 2)
        .translate(Math.cos(a) * 3.65, 4.55 + Math.sin(a) * 3.65, 6.0),
    );
  }
  // Raised lock crest and ornamental lintel studs, visible above the great door.
  add(4, new THREE.TorusGeometry(0.42, 0.1, 6, 20).translate(0, 10.35, 5.95));
  box(4, 0.8, 0.58, 0.15, 0, 9.91, 5.95);
  for (const x of [-3, -2, -1, 1, 2, 3]) box(4, 0.25, 0.25, 0.13, x, 8.7, 5.83);
  const frame = vaultFrame();
  // The town's loaded atlas set; while it is missing the parts draw plain.
  const textures: EastbrookAtlasTextures = {
    atlas: eastbrookSurfaceAtlasTexture(),
    normal: eastbrookSurfaceNormalTexture(),
    rough: eastbrookSurfaceRoughnessTexture(),
  };
  for (const [index, pieces] of parts.entries()) {
    const geometry = dressedGroupGeometry(pieces, colors[index], frame);
    const material = eastbrookAtlasPartMaterial(
      { roughness: index === 4 ? 0.4 : 0.92, metalness: index === 4 ? 0.65 : 0 },
      textures,
    );
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    occluderFadeRecordFor(mats, material, mesh);
  }
  // The great door: scaled up and set into the portal (its own frame is the
  // door plane, the hall's is the building's), dressed in the hall's frame.
  const doorPlacement = new THREE.Matrix4().compose(
    new THREE.Vector3(0, 0.35, 5.95),
    new THREE.Quaternion(),
    new THREE.Vector3(1.28, 1.28, 1.28),
  );
  group.add(buildVaultDoor(doorPlacement, frame, textures, mats));
  group.position.set(layout.x, y, layout.z);
  group.rotation.y = layout.rot;
  return { group, hideTarget: vaultHideTarget(group, mats, y) };
}

/** The hall's entry in the town's roof-hide list: its footprint and the fade
 *  materials of what was built (none when the hall stood down). */
function vaultHideTarget(group: THREE.Group, mats: OccluderFadeMat[], groundY: number) {
  const layout = EASTBROOK_LAYOUT.weeklyVault;
  return {
    group,
    mats,
    hidden: false,
    alpha: 1,
    x: layout.x,
    z: layout.z,
    halfWidth: layout.w / 2,
    halfDepth: layout.d / 2,
    cosine: Math.cos(layout.rot),
    sine: Math.sin(layout.rot),
    topY: groundY + layout.height,
    cullRadius: Math.hypot(layout.w / 2, layout.d / 2),
  };
}
