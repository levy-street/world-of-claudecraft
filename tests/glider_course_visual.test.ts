import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { GliderCourseVisual } from '../src/render/glider_course_visual';
import { GLIDER_COURSE, GLIDER_QUEST_ID } from '../src/sim/content/world_quest_glider';
import { GLIDER_COURSES } from '../src/sim/content/world_quest_glider_levels';
import type { IWorld } from '../src/world_api';

function world(): IWorld {
  return {
    player: { pos: { x: 360, y: 90, z: 590 }, facing: 0 },
    worldQuestLog: new Map([
      [GLIDER_QUEST_ID, { state: 'active', glider: { phase: 'flying', vy: -2, passedRings: [] } }],
    ]),
  } as unknown as IWorld;
}

describe('glider course presentation lifecycle', () => {
  it('switches all ring positions and wind corridors to the selected session without rebuilding', async () => {
    const gate = vi.fn(async () => {});
    const visual = new GliderCourseVisual(new THREE.Group(), () => 0, gate);
    await visual.readyForEntry;
    const state = world();
    const ring = visual.group.children[0] as THREE.Mesh;
    const geometry = ring.geometry;
    for (const course of [...GLIDER_COURSES, GLIDER_COURSE]) {
      Object.assign(state.worldQuestLog.get(GLIDER_QUEST_ID)!.glider!, { courseId: course.id });
      visual.update(state);
      for (let i = 0; i < course.rings.length; i++) {
        const mesh = visual.group.children[i];
        expect(mesh.position.toArray()).toEqual([
          course.rings[i].x,
          course.rings[i].y,
          course.rings[i].z,
        ]);
      }
      const visibleWinds = visual.group.children.filter(
        (child) => child.name === 'glider-wind-tunnels' && child.visible,
      );
      expect(visibleWinds).toHaveLength(1);
      expect(visibleWinds[0].children[0].position.toArray()).toEqual([
        course.windTunnels![0].x,
        course.windTunnels![0].y,
        course.windTunnels![0].z,
      ]);
      expect(ring.geometry).toBe(geometry);
    }
    expect(gate).toHaveBeenCalledOnce();
    visual.dispose();
  });
  it('warms wind geometry under the course gate and shares its attempt visibility', async () => {
    let warmedWindCount = 0;
    let hiddenAtCompile = false;
    const gate = vi.fn(async (root: THREE.Object3D) => {
      warmedWindCount = root.getObjectByName('glider-wind-tunnels')?.children.length ?? 0;
      hiddenAtCompile = !root.visible;
    });
    const visual = new GliderCourseVisual(new THREE.Group(), () => 0, gate);
    await visual.readyForEntry;
    expect(gate).toHaveBeenCalledOnce();
    expect(warmedWindCount).toBeGreaterThan(0);
    expect(hiddenAtCompile).toBe(true);
    const state = world();
    visual.update(state);
    const wind = visual.group.getObjectByName('glider-wind-tunnels')!;
    expect(wind.parent).toBe(visual.group);
    expect(visual.group.visible).toBe(true);
    state.worldQuestLog = new Map();
    visual.update(state);
    const visible: THREE.Object3D[] = [];
    visual.group.traverseVisible((child) => visible.push(child));
    expect(visible).not.toContain(wind);
    visual.dispose();
  });

  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2])(
    'tilts the nose upward in its local facing frame at yaw %s',
    async (yaw) => {
      const visual = new GliderCourseVisual(new THREE.Group(), () => 0);
      await visual.readyForEntry;
      const state = world();
      state.player.facing = yaw;
      Object.assign(state.worldQuestLog.get(GLIDER_QUEST_ID)!.glider!, { vy: 8, speed: 16 });
      visual.update(state);
      visual.group.updateMatrixWorld(true);
      const apparatus = visual.group.getObjectByName('glider-apparatus')!;
      const nose = new THREE.Vector3(0, 0, 1).transformDirection(apparatus.matrixWorld);
      expect(nose.y).toBeGreaterThan(0);
      expect(Math.atan2(nose.x, nose.z)).toBeCloseTo(yaw);
      visual.dispose();
    },
  );

  it('hides the course before acceptance, after an attempt, and after a daily reset', async () => {
    const visual = new GliderCourseVisual(new THREE.Group(), () => 0);
    await visual.readyForEntry;
    const state = world();
    const progress = state.worldQuestLog.get(GLIDER_QUEST_ID)!;
    state.worldQuestLog = new Map();
    visual.update(state);
    expect(visual.group.visible).toBe(false);

    state.worldQuestLog = new Map([[GLIDER_QUEST_ID, progress]]);
    for (const phase of ['countdown', 'flying', 'failed', 'countdown', 'won'] as const) {
      progress.glider!.phase = phase;
      visual.update(state);
      expect(visual.group.visible).toBe(phase === 'countdown' || phase === 'flying');
    }
    progress.glider!.phase = 'flying';
    progress.state = 'completed';
    visual.update(state);
    expect(visual.group.visible).toBe(false);
    progress.state = 'active';
    visual.update(state);
    expect(visual.group.visible).toBe(true);
    state.worldQuestLog = new Map();
    visual.update(state);
    expect(visual.group.visible).toBe(false);
    expect(visual.group.getObjectByName('glider-apparatus')?.visible).toBe(false);
    visual.dispose();
  });

  it('keeps every landing-pad vertex above the sampled slope at the authored radius', async () => {
    const ground = (x: number, z: number) => 0.25 * x - 0.4 * z + 100;
    const visual = new GliderCourseVisual(new THREE.Group(), ground);
    await visual.readyForEntry;
    const pad = visual.group.children[GLIDER_COURSE.rings.length] as THREE.Mesh;
    visual.group.updateMatrixWorld(true);
    const positions = pad.geometry.getAttribute('position');
    const point = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(pad.matrixWorld);
      expect(point.y).toBeCloseTo(ground(point.x, point.z) + 0.45, 4);
      const radius = Math.hypot(
        point.x - GLIDER_COURSE.landingPad.x,
        point.z - GLIDER_COURSE.landingPad.z,
      );
      expect(radius).toBeGreaterThanOrEqual(GLIDER_COURSE.landingPad.radius - 0.25 - 0.0001);
      expect(radius).toBeLessThanOrEqual(GLIDER_COURSE.landingPad.radius + 0.0001);
    }
    visual.dispose();
  });

  it('samples dense perimeter edges above curved terrain without spanning the landing area', async () => {
    const ground = (x: number, z: number) => 0.2 * Math.sin(x * 2) + 0.3 * Math.cos(z * 2);
    const visual = new GliderCourseVisual(new THREE.Group(), ground);
    await visual.readyForEntry;
    const mesh = visual.group.children[GLIDER_COURSE.rings.length] as THREE.Mesh;
    const positions = mesh.geometry.getAttribute('position');
    const indices = mesh.geometry.getIndex()!;
    const vertices = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (let i = 0; i < indices.count; i += 3) {
      for (let j = 0; j < 3; j++) vertices[j].fromBufferAttribute(positions, indices.getX(i + j));
      const center = vertices[0]
        .clone()
        .add(vertices[1])
        .add(vertices[2])
        .multiplyScalar(1 / 3);
      expect(center.y - ground(center.x, center.z)).toBeGreaterThan(0.35);
      expect(vertices[0].distanceTo(vertices[1])).toBeLessThan(0.7);
      expect(
        Math.hypot(center.x - GLIDER_COURSE.landingPad.x, center.z - GLIDER_COURSE.landingPad.z),
      ).toBeGreaterThan(GLIDER_COURSE.landingPad.radius - 0.3);
    }
    visual.dispose();
  });

  it('marks the center above the grass without an opaque disc or disabling depth tests', async () => {
    const visual = new GliderCourseVisual(new THREE.Group(), () => 3);
    await visual.readyForEntry;
    const beacon = visual.group.getObjectByName('glider-landing-beacon') as THREE.Mesh;
    expect(beacon).toBeDefined();
    expect(beacon.position.x).toBe(GLIDER_COURSE.landingPad.x);
    expect(beacon.position.z).toBe(GLIDER_COURSE.landingPad.z);
    expect(beacon.position.y).toBeGreaterThan(4);
    const material = beacon.material as THREE.MeshBasicMaterial;
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeLessThan(0.7);
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(false);
    const disposed = vi.spyOn(beacon.geometry, 'dispose');
    visual.dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
  });

  it('holds the course hidden until compilation settles even during active flight', async () => {
    let settle!: () => void;
    const visual = new GliderCourseVisual(
      new THREE.Group(),
      () => 0,
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    visual.update(world());
    expect(visual.group.visible).toBe(false);
    settle();
    await visual.readyForEntry;
    expect(visual.group.visible).toBe(false);
    visual.update(world());
    expect(visual.group.visible).toBe(true);
    visual.dispose();
  });

  it('anchors the apparatus to the rendered avatar pose instead of the authoritative tick pose', async () => {
    const visual = new GliderCourseVisual(new THREE.Group(), () => 0);
    await visual.readyForEntry;
    const body = new THREE.Group();
    body.position.set(358.25, 89.4, 586.2);
    body.rotation.y = 0.75;
    visual.update(world(), body);
    const apparatus = visual.group.getObjectByName('glider-apparatus')!;
    expect(apparatus.position.x).toBe(body.position.x);
    expect(apparatus.position.y).toBeCloseTo(body.position.y + 1.22);
    expect(apparatus.position.z).toBe(body.position.z);
    expect(apparatus.rotation.y).toBe(body.rotation.y);
    visual.dispose();
  });

  it('detaches and disposes once; a pending gate can never revive its retired root', async () => {
    const scene = new THREE.Group();
    let settle!: () => void;
    const visual = new GliderCourseVisual(
      scene,
      () => 0,
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    const ring = visual.group.children[0] as THREE.Mesh;
    const geometryDispose = vi.spyOn(ring.geometry, 'dispose');
    visual.dispose();
    visual.dispose();
    expect(scene.children).not.toContain(visual.group);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    settle();
    await visual.readyForEntry;
    visual.update(world());
    expect(visual.group.visible).toBe(false);
    expect(scene.children).not.toContain(visual.group);
  });

  it('recovers a rejected compile without revealing inactive equipment', async () => {
    const visual = new GliderCourseVisual(
      new THREE.Group(),
      () => 0,
      () => Promise.reject(new Error('driver failure')),
    );
    await visual.readyForEntry;
    const state = world();
    state.worldQuestLog = new Map();
    visual.update(state);
    expect(visual.group.visible).toBe(false);
    expect(visual.group.getObjectByName('glider-apparatus')?.visible).toBe(false);
    visual.dispose();
  });
});
