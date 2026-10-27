// Painter for an authored open-air field's ground: the walkable tops and the
// cliff faces from the pure plan (field_mesh_core.ts), wrapped in Three
// geometry with the shared procedural stone, soil and rock detail. Built once
// per interior; the geometry is owned by the interior group (disposed with
// it), the materials and textures are shared.

import * as THREE from 'three';
import type { AuthoredFieldDef } from '../../sim/instances/authored_field';
import { surfaceMat } from '../gfx';
import {
  type CliffPaint,
  FIELD_TOP_FAMILIES,
  type FieldMeshData,
  type FieldTopFamily,
  GLACIER_CLIFF_UV,
  planFieldCliffs,
  planFieldTops,
} from './field_mesh_core';
import {
  basaltDetail,
  type DetailPair,
  flagstoneDetail,
  glacierWallDetail,
  gratingDetail,
  hearthDetail,
  iceDetail,
  lakeIceDetail,
  mossDetail,
  pavingDetail,
  plateDetail,
  quarryDetail,
  rimeDetail,
  rockDetail,
  scouredDetail,
  slateDetail,
  snowDetail,
  soilDetail,
  strataDetail,
} from './field_textures';

function geometryOf(data: FieldMeshData, indexed: boolean): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
  if (indexed) {
    geo.setIndex(data.indices);
  } else {
    // Tops are emitted as independent triangles already in draw order.
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

export interface FieldTerrainOptions {
  lowGfx: boolean;
  /** Longest top triangle edge; the low tier coarsens it. */
  maxEdge?: number;
  /** Rain-soaked ground: the stone and soil tops take a wet sheen (lower
   *  roughness), so the storm's light glints off the flags. */
  wet?: boolean;
  /** Surfaces whose drop is open air under them (a catwalk, a steel stair):
   *  their drawn face stops this many yards below the walking top instead of
   *  running down to the void floor, so the dungeon's own trusses show. The
   *  sim's lip colliders are unchanged. */
  shallow?: { surfaces: ReadonlySet<string>; depth: number };
  /** The cliff faces' rock: fractured slabs (the default), level bedded
   *  strata (a shelf cut into a mountain), or a glacier crevasse wall (annual
   *  layers and meltwater flutes, a little glossier: wet ice). */
  cliffRock?: 'slabs' | 'strata' | 'glacier';
  /** The cliff faces' vertex paint (the plan's default rock tint otherwise). */
  cliffPaint?: CliffPaint;
  /** Surfaces whose walkable tops the dungeon's own kit draws (FieldTopOptions.omit). */
  omitTops?: ReadonlySet<string>;
  /** A dungeon's own material for one top family (the Smith's Heart's Frozen
   *  Lake draws its ice with depth): handed the family's detail pair, it
   *  returns the material that family's mesh draws with. */
  topMaterial?: Partial<Record<FieldTopFamily, (pair: DetailPair) => THREE.Material>>;
}

/** Build the ground of a field: tops (one mesh per texture family) and cliffs. */
export function buildAuthoredFieldTerrain(
  def: AuthoredFieldDef,
  opts: FieldTerrainOptions,
): THREE.Group {
  const group = new THREE.Group();
  group.name = `authoredField:${def.key}`;
  const tops = planFieldTops(def, {
    maxEdge: opts.maxEdge ?? (opts.lowGfx ? 6 : 3),
    layerLift: 0,
    ...(opts.omitTops ? { omit: opts.omitTops } : {}),
  });
  const rock =
    opts.cliffRock === 'strata'
      ? strataDetail()
      : opts.cliffRock === 'glacier'
        ? glacierWallDetail()
        : rockDetail();
  // Each family's detail pair and its sheen; a material is minted only for a
  // family the field actually draws (the shared cache dedupes the rest).
  const looks: Record<
    FieldTopFamily,
    { detail: () => ReturnType<typeof rockDetail>; rough: number; metal?: number }
  > = {
    stone: { detail: flagstoneDetail, rough: opts.wet ? 0.62 : 0.93 },
    soil: { detail: soilDetail, rough: opts.wet ? 0.72 : 0.98 },
    // Jungle moss stays matte; wet basalt glints.
    moss: { detail: mossDetail, rough: 0.97 },
    basalt: { detail: basaltDetail, rough: opts.wet ? 0.42 : 0.55 },
    // Steel works: deck plate with a dull sheen, grating darker.
    plate: { detail: plateDetail, rough: 0.58, metal: 0.35 },
    grating: { detail: gratingDetail, rough: 0.66, metal: 0.3 },
    // The Gravewyrm Sanctum: matte wind-packed snow, lake and glacier ice
    // with a little cold sheen (never a mirror: the floor stays readable),
    // and slate between the two.
    snow: { detail: snowDetail, rough: 0.92 },
    ice: { detail: iceDetail, rough: 0.46, metal: 0.04 },
    slate: { detail: slateDetail, rough: 0.7 },
    // The Smith's Heart's quarry: dry cut granite, matte.
    quarry: { detail: quarryDetail, rough: 0.9 },
    // The Hammer Gallery's worn paving: dry dressed granite, matte.
    paving: { detail: pavingDetail, rough: 0.88 },
    // The Breath's storm-scoured granite: polished by the wind, a hair less
    // matte than the quarry.
    scoured: { detail: scouredDetail, rough: 0.8 },
    // The Quench (phase 2H): frost-bound granite, matte under its rime; the
    // Frozen Lake's polished ice (its depth is the dungeon's own material).
    rime: { detail: rimeDetail, rough: 0.86 },
    lake_ice: { detail: lakeIceDetail, rough: 0.3, metal: 0.02 },
    // The Heat (phase 2I): the basalt columns' worn heads, matte, the fire
    // in their joints the dungeon's own material.
    hearth: { detail: hearthDetail, rough: 0.84 },
  };
  for (const family of FIELD_TOP_FAMILIES) {
    const data = tops[family];
    if (data.positions.length === 0) continue;
    const pair = looks[family].detail();
    const own = opts.topMaterial?.[family];
    const material = own
      ? own(pair)
      : surfaceMat({
          map: pair.map,
          normalMap: opts.lowGfx ? undefined : pair.normalMap,
          vertexColors: true,
          roughness: looks[family].rough,
          ...(looks[family].metal !== undefined ? { metalness: looks[family].metal } : {}),
        });
    const mesh = new THREE.Mesh(geometryOf(data, false), material);
    mesh.name = `fieldTop:${family}`;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const cliffs = planFieldCliffs(def, {
    voidFloor: def.voidHeight - 25,
    columnStep: opts.lowGfx ? 3 : 1.6,
    rowStep: opts.lowGfx ? 6 : 3,
    flare: 0.22,
    ...(opts.shallow ? { shallow: opts.shallow } : {}),
    ...(opts.cliffPaint ? { paint: opts.cliffPaint } : {}),
    ...(opts.cliffRock === 'glacier' ? { uvScale: GLACIER_CLIFF_UV } : {}),
  });
  if (cliffs.positions.length > 0) {
    const mesh = new THREE.Mesh(
      geometryOf(cliffs, true),
      surfaceMat({
        map: rock.map,
        normalMap: opts.lowGfx ? undefined : rock.normalMap,
        vertexColors: true,
        roughness: opts.cliffRock === 'glacier' ? 0.62 : 0.95,
        side: THREE.DoubleSide,
      }),
    );
    mesh.name = 'fieldCliffs';
    mesh.castShadow = !opts.lowGfx;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
