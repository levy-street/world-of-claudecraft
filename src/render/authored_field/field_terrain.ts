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
  flagstoneDetail,
  glacierWallDetail,
  gratingDetail,
  iceDetail,
  mossDetail,
  plateDetail,
  rockDetail,
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
  };
  for (const family of FIELD_TOP_FAMILIES) {
    const data = tops[family];
    if (data.positions.length === 0) continue;
    const pair = looks[family].detail();
    const material = surfaceMat({
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
