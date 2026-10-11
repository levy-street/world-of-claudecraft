// The Goblin Rocket Sled plume's program on a real WebGL driver: the browser
// half of tests/goblin_rocket_sled_fx.test.ts and the plume case in
// tests/mount_lifecycle.test.ts (the ignivar_prewarm_programs pattern).
// renderer.info.programs is three's own list, and the patched three keeps a
// released program in it while it sits in the retention FIFO
// (info.retainedPrograms), so a count that grows is a real new link.
//
// Each leg mirrors the mount gate: the plume is built hidden on the rig, the
// gate lists the rig's pieces (linkPiecesOf, the gate's own enumeration) and
// compiles each representative in place with compileAsync, then the plume
// flares and draws. Two tiers: the canvas (Low: tone mapped at the draw) and
// a render target (Ultra: the composer's target, no tone mapping in the
// plume), each its own program. The fix leg also draws a forward and a
// reversing rider in one render call and reads each plume's colour back:
// with one shared pair, only the per-draw push keeps the two apart.
//
// The control leg is the release shape, a material pair per rider disposed on
// dismount (clones of the shared pair: same source, same options). It pins
// the finding behind the fix: three keys a ShaderMaterial program on its
// shader-stage ids, the stages die with the last material compiled from
// them, and the next rider after everyone dismounted links a NEW program
// while the old one sits in the FIFO under a key nobody can produce again.
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { linkPiecesOf } from '../../src/render/compile_gate_pieces';
import { GFX, gfxInternalsForTest } from '../../src/render/gfx';
import {
  GoblinRocketSledFx,
  goblinRocketSledPlumeMaterials,
  resetGoblinRocketSledProfileCaches,
} from '../../src/render/goblin_rocket_sled_fx';

const WIDTH = 320;
const HEIGHT = 240;

type RetainingInfo = { retainedPrograms?: object[] };

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  resetGoblinRocketSledProfileCaches();
});

interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  target: THREE.WebGLRenderTarget | null;
  draw(): void;
  programs(): number;
  retained(): object[];
  programOf(material: THREE.Material): object | undefined;
}

function stage(tier: 'low' | 'ultra'): Stage {
  const restoreGfx = gfxInternalsForTest.overrideSettings({ composer: tier === 'ultra' });
  resetGoblinRocketSledProfileCaches();
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const target =
    tier === 'ultra'
      ? new THREE.WebGLRenderTarget(WIDTH, HEIGHT, { type: THREE.HalfFloatType })
      : null;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 0.1, 200);
  camera.position.set(0, 6, 12);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  cleanup = () => {
    renderer.setRenderTarget(null);
    target?.dispose();
    renderer.dispose();
    canvas.remove();
    restoreGfx();
  };
  const properties = renderer.properties as unknown as {
    get(material: THREE.Material): { currentProgram?: object };
  };
  return {
    renderer,
    scene,
    camera,
    target,
    draw() {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
    },
    programs: () => renderer.info.programs?.length ?? 0,
    retained: () => (renderer.info as RetainingInfo).retainedPrograms ?? [],
    programOf: (material) => properties.get(material).currentProgram,
  };
}

interface Rider {
  root: THREE.Group;
  fx: GoblinRocketSledFx;
  materials: THREE.ShaderMaterial[];
}

/** A sled rig with its two authored exhaust sockets and its plume, built the
 *  way syncMountVisual builds it: hidden, before the gate. `perRider` swaps in
 *  a private clone pair, the release shape. */
function mount(s: Stage, x: number, perRider: boolean): Rider {
  const root = new THREE.Group();
  root.position.x = x;
  for (const [side, offset] of [
    ['L', -0.6],
    ['R', 0.6],
  ] as const) {
    const socket = new THREE.Object3D();
    socket.name = `Socket_Exhaust_${side}`;
    socket.position.set(offset, 1, -1);
    root.add(socket);
  }
  const fx = GoblinRocketSledFx.create(root);
  if (!fx) throw new Error('the sled rig carries both exhaust sockets');
  const materials: THREE.ShaderMaterial[] = [];
  if (perRider) {
    const shared = goblinRocketSledPlumeMaterials();
    const outer = shared.outer.clone();
    const core = shared.core.clone();
    materials.push(outer, core);
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.material === shared.outer) mesh.material = outer;
      else if (mesh.material === shared.core) mesh.material = core;
    });
  }
  s.scene.add(root);
  return { root, fx, materials };
}

/** The mount gate's colour arm over the rig: the pieces it lists, each
 *  representative compiled in place under the tier's render target. */
async function gate(s: Stage, rider: Rider): Promise<void> {
  expect(rider.root.getObjectByName('GoblinRocketPlume_L')?.visible).toBe(false);
  s.renderer.setRenderTarget(s.target);
  await Promise.all(
    linkPiecesOf(rider.root).map(([representative]) =>
      s.renderer.compileAsync(representative, s.camera, s.scene),
    ),
  );
}

function flare(rider: Rider, time: number): void {
  for (let step = 0; step < 30; step++) {
    rider.fx.update(0.05, time + step * 0.05, true, false, false, 14, false, true, null);
  }
  expect(rider.root.getObjectByName('GoblinRocketPlume_L')?.visible).toBe(true);
}

function reverse(rider: Rider, time: number): void {
  for (let step = 0; step < 20; step++) {
    rider.fx.update(0.05, time + step * 0.05, true, true, false, 4, false, true, null);
  }
  expect(rider.root.getObjectByName('GoblinRocketPlume_L')?.visible).toBe(true);
}

/** A camera straight above the plumes, which run rearward (-z) from the
 *  sockets: on screen each runs up, so a pixel row crosses it. */
function overheadCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 0.1, 50);
  camera.position.set(0, 4, -1.6);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 1, -1.6);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return camera;
}

type Rgb = { r: number; g: number; b: number };

/** The brightest pixel of the row crossing a rider's left plume at 70% of its
 *  outer cone, past the core's tip: the outer layer alone, so neither tier's
 *  read saturates. The brightest one, so the flame's own sway cannot move the
 *  plume off the probe. Read from the float target on Ultra and from the
 *  canvas on Low, in the same task as the render, before it is presented. */
function plumePixel(s: Stage, rider: Rider, camera: THREE.Camera): Rgb {
  const outer = rider.root.getObjectByName('GoblinRocketPlume_L_Outer');
  if (!outer) throw new Error('the rider has a left outer plume');
  outer.updateWorldMatrix(true, false);
  const ndc = new THREE.Vector3(0, 0.7, 0).applyMatrix4(outer.matrixWorld).project(camera);
  const x = Math.floor((ndc.x + 1) * 0.5 * WIDTH);
  const y = Math.floor((ndc.y + 1) * 0.5 * HEIGHT);
  const span = 24;
  const gl = s.renderer.getContext() as WebGL2RenderingContext;
  s.renderer.setRenderTarget(s.target);
  const row = s.target ? new Float32Array(span * 2 * 4) : new Uint8Array(span * 2 * 4);
  gl.readPixels(x - span, y, span * 2, 1, gl.RGBA, s.target ? gl.FLOAT : gl.UNSIGNED_BYTE, row);
  let best: Rgb = { r: 0, g: 0, b: 0 };
  for (let i = 0; i < row.length; i += 4) {
    if (row[i] + row[i + 1] + row[i + 2] > best.r + best.g + best.b) {
      best = { r: row[i], g: row[i + 1], b: row[i + 2] };
    }
  }
  return best;
}

function dismount(s: Stage, rider: Rider): void {
  rider.fx.dispose();
  for (const material of rider.materials) material.dispose();
  s.scene.remove(rider.root);
}

describe.each(['low', 'ultra'] as const)('the rocket sled plume program (%s)', (tier) => {
  it('links once behind the first gate and serves every later rider, remount included', async () => {
    const s = stage(tier);
    expect(GFX.composer).toBe(tier === 'ultra');
    const shared = goblinRocketSledPlumeMaterials();
    s.draw();
    const baseline = s.programs();

    const first = mount(s, -3, false);
    await gate(s, first);
    expect(s.programs(), 'the gate links the plume program').toBe(baseline + 1);
    flare(first, 1);
    s.draw();
    expect(s.programs(), 'the first flare links nothing live').toBe(baseline + 1);
    const program = s.programOf(shared.outer);
    expect(program).toBeDefined();
    expect(s.programOf(shared.core)).toBe(program);

    const second = mount(s, 3, false);
    await gate(s, second);
    flare(second, 2);
    s.draw();
    expect(s.programs(), 'a second rider').toBe(baseline + 1);

    // Each draw wears its own rider's values: one render call draws the
    // forward rider (orange outer layer) and the reversing rider (blue outer
    // layer) with the same two materials, side by side under the camera so
    // each plume covers pixels of its own.
    reverse(second, 3);
    first.root.position.x = -1;
    second.root.position.x = 1;
    const overhead = overheadCamera();
    s.renderer.setRenderTarget(s.target);
    s.renderer.render(s.scene, overhead);
    const forwardPixel = plumePixel(s, first, overhead);
    const reversePixel = plumePixel(s, second, overhead);
    expect(forwardPixel.r, 'the forward plume is orange').toBeGreaterThan(forwardPixel.b);
    expect(reversePixel.b, 'the reversing plume is blue').toBeGreaterThan(reversePixel.r);
    expect(s.programs(), 'the two riders in one draw').toBe(baseline + 1);

    // Everyone dismounts: the moment the release lost the stages.
    dismount(s, first);
    dismount(s, second);
    s.draw();
    expect(s.retained()).not.toContain(program);

    const remount = mount(s, -3, false);
    await gate(s, remount);
    flare(remount, 3);
    s.draw();
    const third = mount(s, 0, false);
    await gate(s, third);
    flare(third, 4);
    s.draw();
    expect(s.programs(), 'a remount and a third rider').toBe(baseline + 1);
    expect(s.programOf(shared.outer)).toBe(program);
    expect(s.programOf(shared.core)).toBe(program);
    expect(s.retained()).not.toContain(program);
  });

  it('control: per-rider pairs disposed on dismount relink, and the FIFO cannot serve it', async () => {
    const s = stage(tier);
    s.draw();
    const baseline = s.programs();

    const first = mount(s, -3, true);
    await gate(s, first);
    flare(first, 1);
    s.draw();
    expect(s.programs()).toBe(baseline + 1);
    const program = s.programOf(first.materials[0]);
    expect(program).toBeDefined();

    // A joiner while a plume lives shares the live stages: no link.
    const second = mount(s, 3, true);
    await gate(s, second);
    flare(second, 2);
    s.draw();
    expect(s.programs(), 'a joiner while a plume lives').toBe(baseline + 1);
    expect(s.programOf(second.materials[0])).toBe(program);

    dismount(s, first);
    dismount(s, second);
    s.draw();
    expect(s.retained(), 'the released program is parked').toContain(program);

    const remount = mount(s, -3, true);
    await gate(s, remount);
    flare(remount, 3);
    s.draw();
    expect(s.programs(), 'the remount links a new program').toBe(baseline + 2);
    const relinked = s.programOf(remount.materials[0]);
    expect(relinked).toBeDefined();
    expect(relinked).not.toBe(program);
    expect(s.retained(), 'the parked program was never taken back').toContain(program);
  });
});
