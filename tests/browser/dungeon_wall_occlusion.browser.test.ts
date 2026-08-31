// The raid-shell backface wall's outside-to-inside first re-show on a real
// WebGL driver: the browser half of the twin-staging contract in
// tests/dungeon_wall_occlusion.test.ts. The staged warm on the first advanced
// frame plus the readiness hold on the re-show out of the fully hidden state
// (rationale in dungeon_wall_occlusion.ts) must leave NO synchronous program
// link for any camera frame to pay. Observable directly here:
// renderer.info.programs.length grows when a draw links a program, so the
// control wall (no gate installed, nothing staged) proves the harness sees
// the re-show link, and the staged wall proves the staging plus the hold
// removed it. The treatment host DEFERS its compiles the way the production
// reveal lane does (a queued link can sit for seconds), so the held re-show
// while both links are pending is exercised against the real driver too.
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { updateWallOcclusion, type WallHideable } from '../../src/render/dungeon_wall_occlusion';
import { occluderFadeMat, occluderFadeReady } from '../../src/render/occluder_fade';
import {
  installOccluderFadeGate,
  resetOccluderFadeGateForTest,
} from '../../src/render/occluder_fade_gate';

const DT = 1 / 60;
const WIDTH = 320;
const HEIGHT = 240;
// The unit suite's geometry: wall centreline z -58 facing outward -z; camera
// inside at z -40, outside at z -70 (within WALL_BACKFACE_CULL_RANGE).
const PLANE = { x: 0, z: -58, nx: 0, nz: -1 };
const FOOTPRINT = { x: 0, z: -58, hw: 6, hd: 1, topY: 16 };
interface CameraStand {
  cam: readonly [number, number, number];
  eye: readonly [number, number, number];
}
const INSIDE: CameraStand = { cam: [0, 4, -40], eye: [0, 2, -20] };
const OUTSIDE: CameraStand = { cam: [0, 4, -70], eye: [0, 2, -40] };

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

let dispose: (() => void) | null = null;

afterEach(() => {
  resetOccluderFadeGateForTest();
  dispose?.();
  dispose = null;
});

function advance(h: WallHideable, at: CameraStand): void {
  const [camX, camY, camZ] = at.cam;
  const [eyeX, eyeY, eyeZ] = at.eye;
  updateWallOcclusion([h], [], camX, camY, camZ, eyeX, eyeY, eyeZ, DT);
}

/** A wall slab mesh at the shell face, sized to fill the inside camera view. */
function slab(geometry: THREE.BufferGeometry, material: THREE.Material, x: number): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, 4, -58);
  return mesh;
}

function countLitPixels(renderer: THREE.WebGLRenderer): number {
  const gl = renderer.getContext();
  const rgba = new Uint8Array(WIDTH * HEIGHT * 4);
  gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  expect(gl.getError()).toBe(gl.NO_ERROR);
  let lit = 0;
  for (let index = 0; index < WIDTH * HEIGHT; index++) {
    if (rgba[index * 4] + rgba[index * 4 + 1] + rgba[index * 4 + 2] > 20) lit++;
  }
  return lit;
}

describe('backface wall twin staging on a real WebGL driver', () => {
  it('the staged wall re-shows with zero new program links; the unstaged control pays one', async () => {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(1);
    renderer.setSize(WIDTH, HEIGHT, false);
    const programCount = (): number => renderer.info.programs?.length ?? 0;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(2, 8, 2);
    scene.add(sun);

    const camera = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 0.1, 200);
    const look = (at: typeof INSIDE): void => {
      camera.position.set(at.cam[0], at.cam[1], at.cam[2]);
      camera.lookAt(0, 4, -58);
      camera.updateMatrixWorld();
    };
    look(INSIDE);

    // CONTROL wall: one Phong slab, backface plane, NO gate installed, so
    // the stage call in the backface arm is the historical no-op.
    const slabGeometry = new THREE.BoxGeometry(5, 8, 2);
    const controlMat = new THREE.MeshPhongMaterial({ name: 'control', color: 0x8899aa });
    const controlMesh = slab(slabGeometry, controlMat, -3);
    const controlGroup = new THREE.Group();
    controlGroup.add(controlMesh);
    scene.add(controlGroup);
    const control: WallHideable = {
      group: controlGroup,
      mats: [occluderFadeMat(controlMat, controlMesh)],
      hidden: false,
      alpha: 1,
      footprint: FOOTPRINT,
      backface: PLANE,
    };

    // STAGED wall: two records on two programs, the emitArenaHideable shape
    // (an instanced standard-material course plus a plain lambert one).
    const stagedGroup = new THREE.Group();
    const stoneMat = new THREE.MeshStandardMaterial({ name: 'stone', color: 0xaa6644 });
    const stoneMesh = new THREE.InstancedMesh(slabGeometry, stoneMat, 2);
    stoneMesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(3, 4, -58));
    stoneMesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(3, 12, -58));
    stoneMesh.instanceMatrix.needsUpdate = true;
    stagedGroup.add(stoneMesh);
    const beamMat = new THREE.MeshLambertMaterial({ name: 'beam', color: 0x99aa77 });
    stagedGroup.add(slab(slabGeometry, beamMat, 8));
    scene.add(stagedGroup);
    const staged: WallHideable = {
      group: stagedGroup,
      mats: [
        occluderFadeMat(stoneMat, stoneMesh),
        occluderFadeMat(beamMat, stagedGroup.children[1] as THREE.Mesh),
      ],
      hidden: false,
      alpha: 1,
      footprint: FOOTPRINT,
      backface: PLANE,
    };

    dispose = () => {
      renderer.dispose();
      canvas.remove();
    };

    // The interior-attach state: every OPAQUE program linked up front.
    renderer.compile(scene, camera);
    const baseline = programCount();
    expect(baseline).toBeGreaterThan(0);
    renderer.render(scene, camera);
    expect(programCount()).toBe(baseline);
    expect(countLitPixels(renderer)).toBeGreaterThan(WIDTH * HEIGHT * 0.05);

    // CONTROL: no gate, nothing staged. Hide draws nothing new ...
    advance(control, INSIDE);
    advance(control, OUTSIDE);
    expect(control.group.visible).toBe(false);
    renderer.render(scene, camera);
    expect(programCount()).toBe(baseline);
    // ... and the first re-show frame links the transparent program COLD,
    // inside the render call: the exact stall the staging exists to remove,
    // observed by this harness.
    advance(control, INSIDE);
    expect(control.group.visible).toBe(true);
    expect(controlMat.transparent).toBe(true);
    renderer.render(scene, camera);
    expect(programCount()).toBe(baseline + 1);
    // Park the control back at its authored state.
    for (let i = 0; i < 400 && control.alpha < 1; i++) advance(control, INSIDE);
    expect(controlMat.transparent).toBe(false);
    renderer.render(scene, camera);
    const afterControl = programCount();
    expect(afterControl).toBe(baseline + 1);

    // TREATMENT: the production shape. The gate is installed (the renderer
    // does this beside its reveal gates); its compile host DEFERS like the
    // real reveal lane and links each twin through the real driver only when
    // the lane drains, hidden in the scene like the reveal host does.
    const twinStaging = new THREE.Group();
    twinStaging.name = 'twin-staging';
    twinStaging.visible = false;
    scene.add(twinStaging);
    const pendingLinks: { root: THREE.Object3D; resolve: () => void }[] = [];
    installOccluderFadeGate({
      compile: (root: object) =>
        new Promise<void>((resolve) => {
          pendingLinks.push({ root: root as THREE.Object3D, resolve });
        }),
      schedule: () => () => undefined,
    });
    const drainLinks = (): void => {
      for (const link of pendingLinks.splice(0)) {
        twinStaging.add(link.root);
        renderer.compile(scene, camera);
        link.resolve();
      }
    };

    // The first advanced frame, camera still inside: the staging requests
    // one transparent twin per record (the instanced standard program and
    // the plain lambert one); the lane holds both links for now.
    advance(staged, INSIDE);
    expect(pendingLinks).toHaveLength(2);
    expect(programCount()).toBe(afterControl);

    // Outside: the wall culls outright, drawing nothing.
    advance(staged, OUTSIDE);
    expect(staged.group.visible).toBe(false);
    renderer.render(scene, camera);
    expect(programCount()).toBe(afterControl);

    // Back inside while both links are STILL pending: the re-show holds the
    // wall hidden (nothing to pop at alpha 0), so this camera frame draws no
    // transparent twin and links nothing on the real driver. The held edge
    // consult escalates each pending key once.
    advance(staged, INSIDE);
    expect(staged.group.visible).toBe(false);
    expect(staged.alpha).toBe(0);
    expect(pendingLinks).toHaveLength(4);
    renderer.render(scene, camera);
    expect(programCount()).toBe(afterControl);

    // The lane drains: the twins link through the real driver OFF the
    // camera frame (the escalated duplicates are driver cache hits).
    drainLinks();
    await flush();
    const stagedCount = programCount();
    expect(stagedCount).toBe(afterControl + 2);
    expect(occluderFadeReady(staged.mats, 'prefetch')).toBe(true);

    // The next advanced frame re-shows: both wall materials draw
    // transparent with ZERO new program links; the staged twins already
    // linked the exact programs this draw asks for.
    advance(staged, INSIDE);
    expect(staged.group.visible).toBe(true);
    expect(staged.alpha).toBeGreaterThan(0);
    expect(stoneMat.transparent).toBe(true);
    expect(beamMat.transparent).toBe(true);
    renderer.render(scene, camera);
    expect(programCount()).toBe(stagedCount);
    expect(countLitPixels(renderer)).toBeGreaterThan(0);

    // The ease back to opaque links nothing further either.
    for (let i = 0; i < 400 && staged.alpha < 1; i++) advance(staged, INSIDE);
    expect(staged.alpha).toBe(1);
    expect(stoneMat.transparent).toBe(false);
    renderer.render(scene, camera);
    expect(programCount()).toBe(stagedCount);
  });
});
