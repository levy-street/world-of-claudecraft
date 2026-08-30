import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { sharedUniforms } from '../src/render/gfx';
import {
  buildIgnivarFireBeam,
  IGNIVAR_FIRE_BEAM_CORE_NAME,
  IGNIVAR_FIRE_BEAM_EMBERS_NAME,
  IGNIVAR_FIRE_BEAM_FLAMES_NAME,
  IGNIVAR_FIRE_BEAM_FLOOR_BOUNDARY_NAME,
  IGNIVAR_FIRE_BEAM_FLOOR_GLOW_NAME,
  IGNIVAR_FIRE_BEAM_OUTER_NAME,
  IGNIVAR_FIRE_BEAM_VEIL_NAME,
  syncIgnivarFireBeamPresentation,
} from '../src/render/ignivar_fire_beams';
import {
  buildIgnivarRotatingRaysTelegraph,
  IGNIVAR_ROTATING_RAY_BORDER_NAME,
  IGNIVAR_ROTATING_RAY_FILL_NAME,
  IGNIVAR_ROTATING_RAY_TICKS_NAME,
  syncIgnivarRotatingRaysTelegraph,
} from '../src/render/ignivar_rotating_rays';
import {
  IGNIVAR_ROTATING_RAYS_HALF_WIDTH,
  IGNIVAR_ROTATING_RAYS_INNER_RANGE,
  IGNIVAR_ROTATING_RAYS_RANGE,
} from '../src/sim/ignivar_arena';

function expectFireBeamInsideFootprint(
  beam: THREE.Group,
  options: { innerRange: number; range: number; startHalfWidth: number; endHalfWidth: number },
): void {
  const expectPointInside = (x: number, z: number) => {
    expect(z).toBeGreaterThanOrEqual(options.innerRange - 1e-6);
    expect(z).toBeLessThanOrEqual(options.range + 1e-6);
    const progress = (z - options.innerRange) / (options.range - options.innerRange);
    const allowed = THREE.MathUtils.lerp(options.startHalfWidth, options.endHalfWidth, progress);
    expect(Math.abs(x)).toBeLessThanOrEqual(allowed + 1e-6);
  };

  for (const name of [
    IGNIVAR_FIRE_BEAM_OUTER_NAME,
    IGNIVAR_FIRE_BEAM_CORE_NAME,
    IGNIVAR_FIRE_BEAM_FLOOR_BOUNDARY_NAME,
    IGNIVAR_FIRE_BEAM_FLOOR_GLOW_NAME,
    IGNIVAR_FIRE_BEAM_VEIL_NAME,
  ]) {
    const mesh = beam.getObjectByName(name) as THREE.Mesh;
    const positions = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let index = 0; index < positions.count; index++) {
      expectPointInside(positions.getX(index), positions.getZ(index));
    }
  }

  const flames = beam.getObjectByName(IGNIVAR_FIRE_BEAM_FLAMES_NAME) as THREE.InstancedMesh;
  const flamePositions = flames.geometry.getAttribute('position') as THREE.BufferAttribute;
  const matrix = new THREE.Matrix4();
  const point = new THREE.Vector3();
  for (let instance = 0; instance < flames.count; instance++) {
    flames.getMatrixAt(instance, matrix);
    for (let vertex = 0; vertex < flamePositions.count; vertex++) {
      point.fromBufferAttribute(flamePositions, vertex).applyMatrix4(matrix);
      expectPointInside(point.x, point.z);
    }
  }

  const embers = beam.getObjectByName(IGNIVAR_FIRE_BEAM_EMBERS_NAME) as THREE.Points;
  const emberPositions = embers.geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let index = 0; index < emberPositions.count; index++) {
    expectPointInside(emberPositions.getX(index), emberPositions.getZ(index));
  }
}

describe('Ignivar fire beam VFX', () => {
  it('builds a bounded fire wall with flames and embers inside its danger lane', () => {
    const beam = buildIgnivarFireBeam({
      innerRange: 2.5,
      range: 34,
      startHalfWidth: 1,
      endHalfWidth: 1,
    });

    expect(beam.userData.vfxLayer).toBe('fireBeam');
    expect(beam.getObjectByName(IGNIVAR_FIRE_BEAM_OUTER_NAME)).toBeInstanceOf(THREE.Mesh);
    expect(beam.getObjectByName(IGNIVAR_FIRE_BEAM_CORE_NAME)).toBeInstanceOf(THREE.Mesh);
    expect(beam.getObjectByName(IGNIVAR_FIRE_BEAM_FLOOR_BOUNDARY_NAME)).toBeInstanceOf(THREE.Mesh);
    expect(beam.getObjectByName(IGNIVAR_FIRE_BEAM_FLOOR_GLOW_NAME)).toBeInstanceOf(THREE.Mesh);
    expect(beam.getObjectByName(IGNIVAR_FIRE_BEAM_VEIL_NAME)).toBeInstanceOf(THREE.Mesh);
    expect(beam.getObjectByName(IGNIVAR_FIRE_BEAM_FLAMES_NAME)).toBeInstanceOf(THREE.InstancedMesh);
    expect(beam.getObjectByName(IGNIVAR_FIRE_BEAM_EMBERS_NAME)).toBeInstanceOf(THREE.Points);

    const veil = beam.getObjectByName(IGNIVAR_FIRE_BEAM_VEIL_NAME) as THREE.Mesh;
    expect((veil.material as THREE.Material).userData.ignivarFireTime).toBe(sharedUniforms.uTime);
    const outer = beam.getObjectByName(IGNIVAR_FIRE_BEAM_OUTER_NAME) as THREE.Mesh;
    const core = beam.getObjectByName(IGNIVAR_FIRE_BEAM_CORE_NAME) as THREE.Mesh;
    const boundary = beam.getObjectByName(IGNIVAR_FIRE_BEAM_FLOOR_BOUNDARY_NAME) as THREE.Mesh;
    const floor = beam.getObjectByName(IGNIVAR_FIRE_BEAM_FLOOR_GLOW_NAME) as THREE.Mesh;
    const compile = (material: THREE.Material) => {
      const shader = {
        uniforms: {} as Record<string, THREE.IUniform>,
        vertexShader: '#include <common>\n#include <begin_vertex>',
        fragmentShader: '#include <common>\n#include <color_fragment>',
      };
      (
        material.onBeforeCompile as unknown as (stagedShader: typeof shader, renderer: null) => void
      )(shader, null);
      expect(shader.uniforms.uTime).toBe(sharedUniforms.uTime);
      expect(shader.vertexShader).toContain('vIgnivarBeamPosition = position;');
      expect(shader.fragmentShader).toContain('float ignivarFlicker');
    };
    compile(outer.material as THREE.Material);
    compile(veil.material as THREE.Material);
    // The v2 thermal look (PR 3684's restored raid presentation, captured in
    // that PR's committed ignivar-lava-moat screenshot set): brighter flame
    // body layers, an additive white-hot core strip, and a boundary that
    // stays ABOVE the old readability floor so the lethal lane never fades.
    expect((floor.material as THREE.Material).opacity).toBeLessThanOrEqual(0.08);
    expect((outer.material as THREE.Material).opacity).toBeLessThanOrEqual(0.2);
    expect((veil.material as THREE.Material).opacity).toBeLessThanOrEqual(0.14);
    expect((core.material as THREE.Material).opacity).toBeLessThanOrEqual(0.38);
    expect((boundary.material as THREE.Material).opacity).toBeGreaterThanOrEqual(0.46);
    expect((boundary.material as THREE.Material).opacity).toBeLessThanOrEqual(0.54);
    expect((floor.material as THREE.Material).blending).toBe(THREE.NormalBlending);
    expect((outer.material as THREE.Material).blending).toBe(THREE.NormalBlending);
    expect((veil.material as THREE.Material).blending).toBe(THREE.NormalBlending);
    expect((core.material as THREE.Material).blending).toBe(THREE.AdditiveBlending);
    expect((boundary.material as THREE.Material).blending).toBe(THREE.NormalBlending);
    const flames = beam.getObjectByName(IGNIVAR_FIRE_BEAM_FLAMES_NAME) as THREE.InstancedMesh;
    const embers = beam.getObjectByName(IGNIVAR_FIRE_BEAM_EMBERS_NAME) as THREE.Points;
    expect((flames.material as THREE.Material).opacity).toBeLessThanOrEqual(0.34);
    expect((embers.material as THREE.Material).opacity).toBeLessThanOrEqual(0.46);
    const additiveLayers = beam.children.filter((child) => {
      const layerMaterial = (child as THREE.Mesh).material as THREE.Material | undefined;
      return layerMaterial?.blending === THREE.AdditiveBlending;
    });
    expect(additiveLayers.map((layer) => layer.name)).toEqual([
      IGNIVAR_FIRE_BEAM_CORE_NAME,
      IGNIVAR_FIRE_BEAM_EMBERS_NAME,
    ]);
    const corePositions = core.geometry.getAttribute('position') as THREE.BufferAttribute;
    let coreMaxHeight = 0;
    let coreMaxHalfWidth = 0;
    for (let index = 0; index < corePositions.count; index++) {
      coreMaxHeight = Math.max(coreMaxHeight, corePositions.getY(index));
      coreMaxHalfWidth = Math.max(coreMaxHalfWidth, Math.abs(corePositions.getX(index)));
    }
    expect(coreMaxHeight).toBeLessThanOrEqual(1.1);
    expect(coreMaxHalfWidth).toBeLessThanOrEqual(0.16);

    expectFireBeamInsideFootprint(beam, {
      innerRange: 2.5,
      range: 34,
      startHalfWidth: 1,
      endHalfWidth: 1,
    });

    const boundaryPositions = boundary.geometry.getAttribute('position') as THREE.BufferAttribute;
    const boundaryPoints = Array.from({ length: boundaryPositions.count }, (_, index) => [
      boundaryPositions.getX(index),
      boundaryPositions.getZ(index),
    ]);
    expect(boundaryPoints).toContainEqual([-1, 2.5]);
    expect(boundaryPoints).toContainEqual([1, 2.5]);
    expect(boundaryPoints).toContainEqual([-1, 34]);
    expect(boundaryPoints).toContainEqual([1, 34]);
  });

  it('widens a fire beam only as far as its cone footprint', () => {
    const halfAngle = Math.PI / 10;
    const radius = 24;
    const range = Math.cos(halfAngle) * radius;
    const endHalfWidth = Math.sin(halfAngle) * radius;
    const options = {
      innerRange: 0,
      range,
      startHalfWidth: 0,
      endHalfWidth,
    };
    const beam = buildIgnivarFireBeam({
      ...options,
    });
    expectFireBeamInsideFootprint(beam, options);
  });

  it('separates the readable windup lane from the fully active fire wall', () => {
    const beam = buildIgnivarFireBeam({
      innerRange: 2.5,
      range: 34,
      startHalfWidth: 1,
      endHalfWidth: 1,
    });
    const outer = beam.getObjectByName(IGNIVAR_FIRE_BEAM_OUTER_NAME) as THREE.Mesh;
    const core = beam.getObjectByName(IGNIVAR_FIRE_BEAM_CORE_NAME) as THREE.Mesh;
    const floor = beam.getObjectByName(IGNIVAR_FIRE_BEAM_FLOOR_GLOW_NAME) as THREE.Mesh;
    const boundary = beam.getObjectByName(IGNIVAR_FIRE_BEAM_FLOOR_BOUNDARY_NAME) as THREE.Mesh;
    const veil = beam.getObjectByName(IGNIVAR_FIRE_BEAM_VEIL_NAME) as THREE.Mesh;
    const flames = beam.getObjectByName(IGNIVAR_FIRE_BEAM_FLAMES_NAME) as THREE.InstancedMesh;
    const embers = beam.getObjectByName(IGNIVAR_FIRE_BEAM_EMBERS_NAME) as THREE.Points;
    const activeOuterOpacity = (outer.material as THREE.Material).opacity;

    syncIgnivarFireBeamPresentation(beam, 'windup', 0);
    expect(veil.visible).toBe(false);
    expect(core.visible).toBe(false);
    expect(flames.visible).toBe(false);
    expect(embers.visible).toBe(true);

    syncIgnivarFireBeamPresentation(beam, 'windup', 0.5);

    expect(beam.visible).toBe(true);
    expect(beam.userData.phase).toBe('windup');
    expect(outer.scale.y).toBeLessThan(0.5);
    expect((outer.material as THREE.Material).opacity).toBeLessThan(activeOuterOpacity);
    expect(core.visible).toBe(false);
    expect(floor.visible).toBe(true);
    expect(boundary.visible).toBe(true);
    const windupSnapshot = {
      outerOpacity: (outer.material as THREE.Material).opacity,
      outerScale: outer.scale.y,
      veilOpacity: (veil.material as THREE.Material).opacity,
      flameOpacity: (flames.material as THREE.Material).opacity,
    };
    syncIgnivarFireBeamPresentation(beam, 'windup', 0.5);
    expect({
      outerOpacity: (outer.material as THREE.Material).opacity,
      outerScale: outer.scale.y,
      veilOpacity: (veil.material as THREE.Material).opacity,
      flameOpacity: (flames.material as THREE.Material).opacity,
    }).toEqual(windupSnapshot);

    syncIgnivarFireBeamPresentation(beam, 'active', 1);

    expect(beam.userData.phase).toBe('active');
    expect(outer.scale.y).toBe(1);
    expect((outer.material as THREE.Material).opacity).toBe(activeOuterOpacity);
    expect(core.visible).toBe(true);
    expect(floor.visible).toBe(true);
    expect(veil.visible).toBe(true);
    expect(flames.visible).toBe(true);
    expect(embers.visible).toBe(true);

    syncIgnivarFireBeamPresentation(beam, 'hidden', 0);
    expect(beam.visible).toBe(false);
    syncIgnivarFireBeamPresentation(beam, 'active', 1);
    expect(beam.visible).toBe(true);
    expect(
      [floor, boundary, outer, veil, core, flames, embers].every((layer) => layer.visible),
    ).toBe(true);
  });

  it('keeps rotating-ray floor boundaries readable without additive washout', () => {
    const rays = buildIgnivarRotatingRaysTelegraph();
    syncIgnivarRotatingRaysTelegraph(rays, 'active', 1, 1);

    const fills = rays.children.filter(
      (child) => child.name === IGNIVAR_ROTATING_RAY_FILL_NAME,
    ) as THREE.Mesh[];
    const borders = rays.children.filter(
      (child) => child.name === IGNIVAR_ROTATING_RAY_BORDER_NAME,
    ) as THREE.Mesh[];
    const ticks = rays.children.filter(
      (child) => child.name === IGNIVAR_ROTATING_RAY_TICKS_NAME,
    ) as THREE.Group[];

    expect(fills).toHaveLength(3);
    expect(borders).toHaveLength(3);
    expect(ticks).toHaveLength(3);
    for (const fill of fills) {
      expect((fill.material as THREE.Material).blending).toBe(THREE.NormalBlending);
      expect((fill.material as THREE.Material).opacity).toBeLessThanOrEqual(0.03);
    }
    for (const border of borders) {
      expect((border.material as THREE.Material).blending).toBe(THREE.NormalBlending);
      expect((border.material as THREE.Material).opacity).toBeGreaterThanOrEqual(0.1);
      expect((border.material as THREE.Material).opacity).toBeLessThanOrEqual(0.15);
    }
    const boundaryPositions = borders[0].geometry.getAttribute('position') as THREE.BufferAttribute;
    const xs = Array.from({ length: boundaryPositions.count }, (_, index) =>
      boundaryPositions.getX(index),
    );
    const zs = Array.from({ length: boundaryPositions.count }, (_, index) =>
      boundaryPositions.getZ(index),
    );
    expect(Math.min(...xs)).toBeCloseTo(-IGNIVAR_ROTATING_RAYS_HALF_WIDTH, 6);
    expect(Math.max(...xs)).toBeCloseTo(IGNIVAR_ROTATING_RAYS_HALF_WIDTH, 6);
    expect(Math.min(...zs)).toBeCloseTo(IGNIVAR_ROTATING_RAYS_INNER_RANGE, 6);
    expect(Math.max(...zs)).toBeCloseTo(IGNIVAR_ROTATING_RAYS_RANGE, 6);
    for (const tickGroup of ticks) {
      const tickMaterial = (tickGroup.children[0] as THREE.Mesh).material as THREE.Material;
      expect(tickMaterial.blending).toBe(THREE.NormalBlending);
      expect(tickMaterial.opacity).toBeLessThanOrEqual(0.05);
    }
  });
});
