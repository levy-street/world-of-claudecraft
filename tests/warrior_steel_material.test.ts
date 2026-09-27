import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { SignatureCrests } from '../src/render/ability_vfx/signature_crests';
import type { CrestKind } from '../src/render/ability_vfx/signature_shapes';
import { buildWarriorArea, warriorAreaPoint } from '../src/render/ability_vfx/warrior_area_shapes';
import {
  buildWarriorBlade,
  warriorBladePoint,
} from '../src/render/ability_vfx/warrior_blade_shape';
import {
  buildWarriorHeavyShape,
  WARRIOR_HEAVY_POINTS,
} from '../src/render/ability_vfx/warrior_heavy_shapes';

const cases = [
  {
    kind: 'steel_cut',
    build: () => buildWarriorBlade(),
    paths: [warriorBladePoint],
    minimum: [4.3, 0.8, 0.8],
    triangles: 1000,
  },
  ...(['steel_chop', 'steel_counter', 'steel_execution'] as const).map((kind) => ({
    kind,
    build: () => buildWarriorHeavyShape(kind),
    paths: [WARRIOR_HEAVY_POINTS[kind]],
    minimum: [4.3, 1.2, 0.75],
    triangles: 1000,
  })),
  ...(['steel_reap', 'steel_storm'] as const).map((kind) => ({
    kind,
    build: () => buildWarriorArea(kind),
    paths: Array.from(
      { length: kind === 'steel_storm' ? 2 : 1 },
      (_, blade) => (u: number, v: number, out: { x: number; y: number; z: number }) =>
        warriorAreaPoint(kind, blade, u, v, out),
    ),
    minimum: [9, 0.6, 9],
    triangles: 1800,
  })),
];

describe('steel wake material geometry contract', () => {
  it.each(cases)(
    '$kind assigns the cutting and trailing edges consistently on both faces',
    ({ build, paths }) => {
      const geometry = build();
      try {
        const position = geometry.getAttribute('position');
        const uv = geometry.getAttribute('uv');
        const point = new THREE.Vector3();
        // Locate physical edges using the authored contact paths rather than
        // vertex order, face winding or the UV value being verified.
        const along = [...new Set(Array.from({ length: uv.count }, (_, i) => uv.getX(i)))].filter(
          (u) => u > 0.15 && u < 0.85,
        );
        for (const path of paths) {
          for (const u of along) {
            for (const edge of [0, 1]) {
              path(u, edge, point);
              const matching: number[] = [];
              for (let i = 0; i < position.count; i++) {
                if (Math.abs(uv.getX(i) - u) > 1e-6) continue;
                if (
                  Math.hypot(
                    position.getX(i) - point.x,
                    position.getY(i) - point.y,
                    position.getZ(i) - point.z,
                  ) < 0.01201
                )
                  matching.push(i);
              }
              expect(matching, `both faces at physical edge ${edge}, u=${u}`).toHaveLength(2);
              for (const i of matching) expect(uv.getY(i)).toBe(edge);
            }
          }
        }
      } finally {
        geometry.dispose();
      }
    },
  );

  it.each(cases)(
    '$kind retains its authored scale, valid normals and geometry budget',
    ({ build, minimum, triangles }) => {
      const geometry = build();
      try {
        const position = geometry.getAttribute('position');
        const normal = geometry.getAttribute('normal');
        const uv = geometry.getAttribute('uv');
        for (const attribute of [position, normal, uv])
          expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
        for (let i = 0; i < uv.count; i++) {
          expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
          expect(uv.getX(i)).toBeLessThanOrEqual(1);
          expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
          expect(uv.getY(i)).toBeLessThanOrEqual(1);
          // Collapsed end caps may have zero normals; all actual face normals
          // must remain normalized after the UV change.
          const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i));
          if (length > 1e-6) expect(length).toBeCloseTo(1, 5);
        }
        geometry.computeBoundingBox();
        const size = geometry.boundingBox!.getSize(new THREE.Vector3()).toArray();
        for (let axis = 0; axis < 3; axis++) expect(size[axis]).toBeGreaterThan(minimum[axis]);
        const indices = geometry.getIndex()!;
        expect(indices.count / 3).toBeLessThanOrEqual(triangles);
        for (const index of indices.array) {
          expect(index).toBeGreaterThanOrEqual(0);
          expect(index).toBeLessThan(position.count);
        }
      } finally {
        geometry.dispose();
      }
    },
  );
});

it('reuses the prepared steel material and geometry without accumulating slots or shader versions', () => {
  const scene = new THREE.Scene();
  const crests = new SignatureCrests(scene);
  const meshes = scene.children.filter((child) => child.name === 'signatureCrest') as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.ShaderMaterial
  >[];
  expect(meshes).toHaveLength(8);
  const materials = meshes.map((mesh) => mesh.material);
  const versions = materials.map((material) => material.version);
  const geometryByKind = new Map<string, THREE.BufferGeometry>();
  const ready = vi.spyOn(crests.preparation, 'ready').mockReturnValue(false);
  expect(crests.spawn(0, 0, 0, 1, 1, 0x777777, 0xffffff, 'steel_cut')).toBe(false);
  expect(meshes.some((mesh) => mesh.visible)).toBe(false);
  ready.mockReturnValue(true);
  try {
    for (let cycle = 0; cycle < 3; cycle++) {
      for (const { kind } of cases) {
        crests.update(0, cycle === 1);
        expect(
          crests.spawn(3, 2, 1, 1.8, 1.2, 0x879397, 0xe2edef, kind as CrestKind, 0.7, 0.2, -0.4),
        ).toBe(true);
        const live = meshes.filter((mesh) => mesh.visible);
        expect(live).toHaveLength(1);
        const mesh = live[0];
        expect(mesh.material).toBe(materials[0]);
        expect(mesh.material.uniforms.uMotion.value).toBe(cycle === 1 ? 0 : 1);
        expect(mesh.material.uniforms.uStorm.value).toBe(kind === 'steel_storm' ? 1 : 0);
        expect(mesh.material.uniforms.uKind.value).toBe(
          kind === 'steel_storm' || kind === 'steel_reap' ? 16 : 15,
        );
        if (geometryByKind.has(kind)) expect(mesh.geometry).toBe(geometryByKind.get(kind));
        else geometryByKind.set(kind, mesh.geometry);
        crests.update(0.21, cycle === 1);
        expect(meshes.some((item) => item.visible)).toBe(false);
        expect(meshes.map((item) => item.material.version)).toEqual(versions);
      }
    }
    expect(scene.children.filter((child) => child.name === 'signatureCrest')).toEqual(meshes);
    const disposal = materials.map((material) => vi.spyOn(material, 'dispose'));
    const geometryDisposal = [...geometryByKind.values()].map((geometry) =>
      vi.spyOn(geometry, 'dispose'),
    );
    crests.dispose();
    crests.dispose();
    for (const disposed of [...disposal, ...geometryDisposal])
      expect(disposed).toHaveBeenCalledOnce();
    expect(scene.children).toHaveLength(0);
    expect(crests.spawn(0, 0, 0, 1, 1, 0, 0, 'steel_cut')).toBe(false);
  } finally {
    crests.dispose();
  }
});
