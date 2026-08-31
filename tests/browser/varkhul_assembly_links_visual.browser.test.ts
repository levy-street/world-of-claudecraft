// The Links rune clock on a real WebGL driver, through the production owner
// (VarkhulForgestormVisuals.syncWorld), not the assembly painter alone: this is
// the browser half of the orphaning pin. It drives a Links interaction the way
// the sim reports one (a held control reaching full progress, then the rune
// locking) and asserts the actionable geometry actually links and draws.
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { VarkhulForgestormVisuals } from '../../src/render/varkhul_forgestorm_visual';
import {
  type ActiveVarkhulAssembly,
  VARKHUL_ASSEMBLY_RUNE_CONTROL_RADIUS,
  varkhulAssemblyRuneSlots,
  varkhulAssemblyRuneStation,
} from '../../src/sim/varkhul_assembly';

type ProgramDiagnostics = { diagnostics?: { runnable?: boolean } };

let dispose: (() => void) | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
});

const SLOTS = varkhulAssemblyRuneSlots('normal', 0);

function linksAssembly(over: {
  control: 'off' | 'counterclockwise' | 'clockwise';
  controlProgress: number;
  locked: boolean;
}): ActiveVarkhulAssembly {
  const runes = Array.from({ length: 10 }, (_, symbol) => ({
    symbol,
    ...varkhulAssemblyRuneStation({ x: 0, z: 0 }, SLOTS[symbol]),
    radius: VARKHUL_ASSEMBLY_RUNE_CONTROL_RADIUS,
    assignedPlayerId: symbol < 5 ? symbol + 100 : null,
    orphaned: false,
    locked: symbol === 0 ? over.locked : false,
    targetAngle: 0.4,
    glyphAngle: 0.7,
    control: symbol === 0 ? over.control : ('off' as const),
    controlProgress: symbol === 0 ? over.controlProgress : 0,
    alignmentProgress: 0,
    aligned: false,
  }));
  return {
    bossId: 42,
    difficulty: 'normal',
    phase: 'links',
    forgeX: 0,
    forgeZ: 22,
    forgeHp: 60,
    forgeMaxHp: 100,
    forgeOverheat: 0,
    forgeBeamActiveMask: 0,
    forgeBeamWarmupRemaining: 0,
    forgeMeltdownRemaining: 0,
    addWave: 0,
    addWaves: 0,
    addsRemaining: 0,
    forgeBeams: [],
    interceptBeam: null,
    cores: [],
    deliveryWindowRemaining: 0,
    assignments: runes
      .filter((rune) => rune.assignedPlayerId !== null)
      .map((rune) => ({
        playerId: rune.assignedPlayerId ?? 0,
        symbol: rune.symbol,
        locked: rune.locked,
      })),
    runes,
    round: 0,
    rounds: 2,
    remaining: 18,
  };
}

function worldWith(assembly: ActiveVarkhulAssembly) {
  return {
    activeVarkhulForgestormWarnings: [],
    activeVarkhulCinderFires: [],
    activeVarkhulCinderOrbProjectiles: [],
    activeVarkhulAssemblies: [assembly],
    player: { id: 100, pos: { x: 0, z: 0 }, auras: [] },
    entities: new Map<number, { auras: { id: string; remaining: number; duration: number }[] }>(),
  };
}

function countLitPixels(renderer: THREE.WebGLRenderer, width: number, height: number): number {
  const gl = renderer.getContext();
  const rgba = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  expect(gl.getError()).toBe(gl.NO_ERROR);
  let lit = 0;
  for (let index = 0; index < width * height; index++) {
    if (rgba[index * 4] + rgba[index * 4 + 1] + rgba[index * 4 + 2] > 20) lit++;
  }
  return lit;
}

describe('Varkhul Assembly Links visuals on a real WebGL driver', () => {
  it('links and draws the rune clock through the owner, across a control hold and lock', () => {
    const width = 320;
    const height = 240;
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050100);
    const visuals = new VarkhulForgestormVisuals(scene, () => 0);
    visuals.syncWorld(
      worldWith(linksAssembly({ control: 'off', controlProgress: 0, locked: false })),
    );
    visuals.update(0, true);

    const viewHeight = 26;
    const aspect = width / height;
    const camera = new THREE.OrthographicCamera(
      -viewHeight * aspect,
      viewHeight * aspect,
      viewHeight,
      -viewHeight,
      0.1,
      120,
    );
    camera.position.set(0, 60, 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();

    renderer.compile(scene, camera);
    const programs = renderer.info.programs as ProgramDiagnostics[] | null;
    expect(programs?.length).toBeGreaterThan(0);
    expect(programs?.filter((program) => program.diagnostics?.runnable === false)).toHaveLength(0);
    renderer.render(scene, camera);
    const idleLit = countLitPixels(renderer, width, height);
    expect(idleLit).toBeGreaterThan(width * height * 0.004);

    const root = scene.getObjectByName('varkhul-assembly-42') as THREE.Group;
    expect(root).toBeTruthy();
    const rune = root.getObjectByName('varkhul-rune-0') as THREE.Group;
    expect(rune.userData.visualMode).toBe('focused');
    expect(rune.getObjectByName('varkhul-rune-control-counterclockwise')?.visible).toBe(true);
    expect(rune.getObjectByName('varkhul-rune-control-clockwise')?.visible).toBe(true);
    expect(root.getObjectByName('varkhul-rune-player-guide')?.visible).toBe(true);

    // The interaction, as the sim reports it: the viewer holds the CCW control
    // to full progress, and the control pad reads charged (white).
    visuals.syncWorld(
      worldWith(linksAssembly({ control: 'counterclockwise', controlProgress: 1, locked: false })),
    );
    visuals.update(0, true);
    renderer.render(scene, camera);
    const inner = rune.getObjectByName('varkhul-rune-control-counterclockwise') as THREE.Mesh;
    expect((inner.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xffffff);
    expect(countLitPixels(renderer, width, height)).toBeGreaterThan(width * height * 0.004);

    // ... then the rune locks: the controls drop and the floor seal draws.
    visuals.syncWorld(
      worldWith(linksAssembly({ control: 'off', controlProgress: 0, locked: true })),
    );
    visuals.update(0.4, false);
    renderer.render(scene, camera);
    expect(rune.getObjectByName('varkhul-rune-lock-burst')?.visible).toBe(true);
    expect(rune.getObjectByName('varkhul-rune-control-counterclockwise')?.visible).toBe(false);
    expect(countLitPixels(renderer, width, height)).toBeGreaterThan(width * height * 0.004);

    dispose = () => {
      visuals.dispose();
      renderer.dispose();
      canvas.remove();
    };
  });
});
